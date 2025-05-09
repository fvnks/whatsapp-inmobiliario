const OpenAI = require('openai');
const { getGoogleSheetData } = require('./googleSheetService');
const { query } = require('../config/database');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const crypto = require('crypto'); // Necesario para desencriptar

// Cache para la API Key y el cliente de Gemini
let cachedGeminiApiKey = null;
let genAIInstance = null;

// Constantes para encriptación/desencriptación (deben ser las mismas que en config.routes.js)
const ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY;
const IV_LENGTH = 16;

// Función para desencriptar (debe ser la misma que en config.routes.js)
function decrypt(text) {
  if (!ENCRYPTION_KEY || !text || !text.includes(':')) {
    return text; // Devuelve texto plano si no hay clave o no parece encriptado
  }
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error('Error desencriptando API Key en aiService (podría ser texto plano):', error.message);
    return text; // Devuelve el texto original si falla (podría ser texto plano)
  }
}

// Función para obtener la API Key de Gemini (DB primero, luego .env)
async function getGeminiApiKey() {
  if (cachedGeminiApiKey) {
    return cachedGeminiApiKey;
  }
  try {
    const [configRows] = await query('SELECT config_value FROM app_config WHERE config_key = ?', ['GEMINI_API_KEY']);
    if (configRows.length > 0 && configRows[0].config_value) {
      const decryptedKey = decrypt(configRows[0].config_value);
      if (decryptedKey) {
        cachedGeminiApiKey = decryptedKey;
        return decryptedKey;
      }
    }
  } catch (dbError) {
    console.error('Error obteniendo GEMINI_API_KEY de la base de datos:', dbError);
  }
  // Fallback a variable de entorno si no se encuentra en la DB o hay error
  cachedGeminiApiKey = process.env.GEMINI_API_KEY;
  if (!cachedGeminiApiKey) {
    console.warn('GEMINI_API_KEY no encontrada en la base de datos ni en variables de entorno.');
  }
  return cachedGeminiApiKey;
}

// Función para obtener o inicializar el cliente de Gemini
async function getGenAIClient() {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada.');
  }
  // Si la API key cambió o el cliente no existe, se recrea
  if (!genAIInstance || cachedGeminiApiKey !== apiKey) { // Esta comparación no es ideal si apiKey se actualiza sin limpiar cache
     // Mejor sería invalidar genAIInstance si la key de la DB cambia.
     // Por simplicidad, la instancia se recrea si la key obtenida es diferente a la usada anteriormente (si hubo)
     // o si no hay instancia.
    genAIInstance = new GoogleGenerativeAI(apiKey);
    // Guardamos la key usada para la instancia actual para futuras comparaciones
    // Esto no es perfecto si `cachedGeminiApiKey` se actualiza en otro lado sin actualizar `genAIInstance`.
    // Una solución más robusta podría ser un event emitter o una forma de forzar la recarga.
  }
  return genAIInstance;
}

// Inicializar el cliente de OpenAI (si aún se usa)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuración del modelo de Gemini
const geminiModelConfig = {
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 1024,
  },
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ],
};

// Función para procesar consultas usando el SDK de Gemini
async function processWithGemini(promptContent) {
  try {
    const client = await getGenAIClient(); // Obtener cliente dinámicamente
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
    const model = client.getGenerativeModel({ model: modelName, ...geminiModelConfig });

    const result = await model.generateContent(promptContent);
    const response = result.response;
    const text = response.text();
    
    if (text) {
      return text;
    } else {
      console.error('Respuesta de Gemini no contiene texto:', response);
      if (response.promptFeedback && response.promptFeedback.blockReason) {
        throw new Error(`Contenido bloqueado por Gemini debido a: ${response.promptFeedback.blockReason}`);
      }
      throw new Error('No se pudo generar una respuesta válida de Gemini.');
    }
  } catch (error) {
    console.error('Error llamando al SDK de Gemini:', error);
    // Invalidar la API key cacheada en caso de error de autenticación (o similar)
    if (error.message && (error.message.includes('API key not valid') || error.message.includes('PERMISSION_DENIED'))) {
        cachedGeminiApiKey = null; 
        genAIInstance = null;
        console.log('Cache de API Key de Gemini invalidada debido a error.');
    }
    throw error;
  }
}

/**
 * Extrae detalles de una propiedad de un mensaje de texto usando Gemini.
 * @param {string} messageText - El mensaje del usuario.
 * @returns {Promise<Object|null>} - Un objeto con los detalles extraídos o null si no se pudo procesar.
 */
async function extractPropertyDetailsFromMessage(messageText) {
  // Columnas que Gemini debe intentar extraer. "Busco / Ofrezco" será determinado principalmente por post-procesamiento.
  const sheetColumnsForGemini = [
    // 'Busco / Ofrezco', // Lo quitamos temporalmente de la extracción directa de Gemini
    'Tipo de Operacion', 
    'Propiedad', 
    'Region', 'Ciudad', 
    'Opcion Comuna', 'Opcion Comuna 2', 'Opcion Comuna 3', 'Opcion Comuna 4', 
    'Dormitorios', 'Baños', 'Estacionamiento', 'Bodegas', 
    'Valor', 'Moneda', 'Gastos Comunes', 'Metros Cuadrados', 
    'Telefono', 'Correo Electronico'
  ];
  // Definimos todas las columnas esperadas en la salida, incluyendo la que manejaremos en post-proceso
  const allOutputColumns = [
    'Busco / Ofrezco', 
    ...sheetColumnsForGemini
  ];

  // V7: Simplificar tarea de IA, enfocar en detalles, reforzar post-procesamiento para "Busco / Ofrezco"
  const prompt = `
Analiza el siguiente mensaje sobre propiedades inmobiliarias en Chile. El mensaje puede contener UNA o VARIAS propiedades.

**Instrucciones de Extracción Detalladas para CADA Propiedad Identificada:**

**PASO 1: Determinar el Tipo de Transacción (Campo: "Tipo de Operacion")**
  - ¿Cuál es la naturaleza de la transacción deseada para la propiedad?
  - Asigna "Arriendo", "Venta", o "Compra".
    - "Arriendo": Si la transacción es un alquiler/renta.
    - "Venta": Si la propiedad se está vendiendo.
    - "Compra": Si se busca adquirir la propiedad de forma permanente.

**PASO 2: Determinar el Tipo de Inmueble (Campo: "Propiedad")**
  - Asigna el tipo de inmueble (ej: "Casa", "Departamento", "Oficina", "Local Comercial", "Terreno", "Parcela", "Bodega", "Estacionamiento").

**PASO 3: Extraer Detalles Adicionales (Campos Restantes)**
  - Extrae los valores para: ${sheetColumnsForGemini.slice(2).join(', ')}.

**Reglas Específicas para Chile (aplican al PASO 3):**
  - "Valor" y "Moneda": (Mismas reglas que v6 para lucas, palos, UF, USD -> CLP)
    - "Valor" SIEMPRE debe ser un NÚMERO ENTERO representando Pesos Chilenos (CLP), sin puntos ni comas.
    - "lucas" = MILES de CLP (ej: "500 lucas" -> Valor: 500000, Moneda: "CLP").
    - "palos" = MILLONES de CLP (ej: "5 palos" -> Valor: 5000000, Moneda: "CLP").
    - UF a CLP: 1 UF = 37000 CLP (aprox.). Si el mensaje dice "100 UF", Valor: 3700000, Moneda: "CLP (original UF)".
    - USD a CLP: 1 USD = 950 CLP (aprox.). Si el mensaje dice "1000 USD", Valor: 950000, Moneda: "CLP (original USD)".
    - Si el valor ya está en CLP o es un número que claramente es CLP, Moneda: "CLP".
  - Si un campo no se menciona, déjalo como un string vacío "".
  - Abreviaturas: "D"/"dorm" (Dormitorios), "B"/"baño" (Baños), "Stgo" (Santiago), "Est" (Estacionamiento).
  - Comunas: Comuna principal en 'Opcion Comuna'. Múltiples opciones claras en 'Opcion Comuna 2', etc.
  - Telefono/Correo: Extrae solo si están explícitos.

**Formato de Respuesta (IMPORTANTE):**
- Si identificas UNA SOLA propiedad: devuelve un único objeto JSON.
- Si identificas MÚLTIPLES propiedades: devuelve un ARRAY de objetos JSON.
- CADA objeto JSON debe incluir TODAS las claves solicitadas para la IA: ${sheetColumnsForGemini.join(', ')}.

**Ejemplo Mensaje:** "Colegas, tengo para arriendo un depto en Providencia, 2D 1B, en 600 lucas. Por otro lado, ando buscando urgente una oficina para comprar en Las Condes, idealmente sobre 100m2, presupuesto hasta 7000 UF."

**Ejemplo JSON Esperado de la IA (Array) - (SIN "Busco / Ofrezco" todavía):**
[
  {
    "Tipo de Operacion": "Arriendo",
    "Propiedad": "Departamento",
    "Region": "Metropolitana de Santiago", "Ciudad": "Santiago", "Opcion Comuna": "Providencia",
    "Opcion Comuna 2": "", "Opcion Comuna 3": "", "Opcion Comuna 4": "",
    "Dormitorios": "2", "Baños": "1", "Estacionamiento": "", "Bodegas": "",
    "Valor": "600000", "Moneda": "CLP",
    "Gastos Comunes": "", "Metros Cuadrados": "",
    "Telefono": "", "Correo Electronico": ""
  },
  {
    "Tipo de Operacion": "Compra", 
    "Propiedad": "Oficina",
    "Region": "Metropolitana de Santiago", "Ciudad": "Santiago", "Opcion Comuna": "Las Condes",
    "Opcion Comuna 2": "", "Opcion Comuna 3": "", "Opcion Comuna 4": "",
    "Dormitorios": "", "Baños": "", "Estacionamiento": "", "Bodegas": "",
    "Valor": "259000000", "Moneda": "CLP (original UF)",
    "Gastos Comunes": "", "Metros Cuadrados": "100",
    "Telefono": "", "Correo Electronico": ""
  }
]

Mensaje del usuario a analizar: "${messageText}"

JSON extraído (objeto único o array de objetos):
`;

  try {
    const rawResponse = await processWithGemini(prompt);
    let cleanedResponse = rawResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    
    let extractedDataArrayAI = []; // Datos tal como vienen de la IA

    if (cleanedResponse.startsWith('[') && cleanedResponse.endsWith(']')) {
      try {
        extractedDataArrayAI = JSON.parse(cleanedResponse);
        if (!Array.isArray(extractedDataArrayAI)) {
          console.warn('AI_SERVICE_WARNING: Gemini response looked like array but did not parse as one (v7):', cleanedResponse);
          extractedDataArrayAI = []; 
        }
      } catch (parseError) {
        console.error('AI_SERVICE_ERROR: Failed to parse Gemini JSON array response (v7):', parseError, '\nRaw response:', cleanedResponse);
        return []; 
      }
    } else if (cleanedResponse.startsWith('{') && cleanedResponse.endsWith('}')) {
      try {
        const singleObject = JSON.parse(cleanedResponse);
        extractedDataArrayAI.push(singleObject); 
      } catch (parseError) {
        console.error('AI_SERVICE_ERROR: Failed to parse Gemini JSON single object response (v7):', parseError, '\nRaw response:', cleanedResponse);
        return []; 
      }
    } else {
      console.warn('AI_SERVICE_WARNING: Gemini response was not in expected JSON format (neither object nor array) (v7):', cleanedResponse);
      return []; 
    }

    // --- Inicio del Post-Procesamiento ---    
    const finalOutputArray = [];
    const lowerCaseMessage = messageText.toLowerCase();

    // Palabras clave para post-procesamiento
    const ofreceKeywords = ['tengo', 'ofrezco', 'dispongo', 'vendo', 'arriendo', 'arrendamos', 'vendemos', 'se vende', 'se arrienda', 'disponible para', 'en venta', 'en arriendo'];
    const buscaKeywords = ['busco', 'necesito', 'requiero', 'ando buscando', 'me interesa comprar', 'quiero comprar', 'quiero arrendar', 'buscamos', 'necesitamos'];

    for (const dataFromAI of extractedDataArrayAI) {
      const processedData = {};
      // Inicializar todos los campos esperados en la salida final
      for (const col of allOutputColumns) {
        processedData[col] = dataFromAI[col] !== undefined ? String(dataFromAI[col]).trim() : '';
      }

      // 1. Determinar "Busco / Ofrezco" mediante post-procesamiento
      let determinedBuscoOfrezco = '';
      const foundOfrece = ofreceKeywords.some(keyword => lowerCaseMessage.includes(keyword));
      const foundBusca = buscaKeywords.some(keyword => lowerCaseMessage.includes(keyword));

      if (foundOfrece && !foundBusca) {
        determinedBuscoOfrezco = 'Ofrezco';
      } else if (foundBusca && !foundOfrece) {
        determinedBuscoOfrezco = 'Busco';
      } else if (foundOfrece && foundBusca) {
        // Conflicto o mensaje mixto, podría necesitar análisis más profundo o priorizar
        console.warn(`AI_SERVICE_POST_CONFLICT: Palabras clave conflictivas para "Busco / Ofrezco" en mensaje: "${messageText}". Se usará heurística.`);
        // Heurística simple: si Tipo de Operacion es Compra, probablemente es Busco, sino Ofrezco.
        if (processedData['Tipo de Operacion'] === 'Compra') {
            determinedBuscoOfrezco = 'Busco';
        } else if ([ 'Venta', 'Arriendo'].includes(processedData['Tipo de Operacion'])) {
            determinedBuscoOfrezco = 'Ofrezco';
        }
      } else {
        // No hay palabras clave claras, usar heurística basada en Tipo de Operacion
        console.log(`AI_SERVICE_POST_INFO: No hay palabras clave claras para "Busco / Ofrezco". Usando heurística.`);
        if (processedData['Tipo de Operacion'] === 'Compra') {
          determinedBuscoOfrezco = 'Busco';
        } else if (['Venta', 'Arriendo'].includes(processedData['Tipo de Operacion'])) {
          determinedBuscoOfrezco = 'Ofrezco';
        }
      }
      processedData['Busco / Ofrezco'] = determinedBuscoOfrezco;
      console.log(`AI_SERVICE_POST_RESULT: Mensaje: "${messageText.substring(0,50)}..." -> Busco/Ofrezco: ${determinedBuscoOfrezco}, Tipo Op: ${processedData['Tipo de Operacion']}`);

      // 2. Validar 'Tipo de Operacion' (ya debería ser bueno por el prompt)
      if (!['Arriendo', 'Venta', 'Compra', ''].includes(processedData['Tipo de Operacion'])) {
        console.warn(`AI_SERVICE_POST_VALIDATION: 'Tipo de Operacion' inválido: '${processedData['Tipo de Operacion']}'. Se dejará como está.`);
      }

      // 3. Validar 'Propiedad'
      if (!processedData.Propiedad && processedData['Tipo de Operacion']) {
          console.warn(`AI_SERVICE_POST_VALIDATION: El tipo de 'Propiedad' no fue extraído o está vacío.`);
      }
      
      // 4. Post-procesamiento para 'Valor' y 'Moneda' (como en v6.1)
      if (processedData['Valor']) {
        let valorOriginal = String(processedData['Valor']);
        let monedaOriginal = String(processedData['Moneda']);
        let valorNumericoNormalizado = '';
        let monedaFinal = 'CLP';
        let valorSoloNumeros = valorOriginal.replace(/\D/g, '');

        if (valorSoloNumeros) {
            valorNumericoNormalizado = parseInt(valorSoloNumeros, 10);
            processedData['Valor'] = valorNumericoNormalizado;
            if (monedaOriginal.toUpperCase().includes('UF')) {
                monedaFinal = 'CLP (original UF)'; 
            } else if (monedaOriginal.toUpperCase().includes('USD')) {
                monedaFinal = 'CLP (original USD)';
            } else {
                monedaFinal = 'CLP';
            }
            processedData['Moneda'] = monedaFinal;
        } else {
            processedData['Valor'] = '';
            processedData['Moneda'] = '';
        }
      } else {
         processedData['Valor'] = ''; 
         processedData['Moneda'] = '';
      }
      // --- Fin del Post-Procesamiento ---

      finalOutputArray.push(processedData);
    }
    console.log('AI_SERVICE_INFO: Datos finales procesados (v7):', JSON.stringify(finalOutputArray, null, 2));
    return finalOutputArray; 
  } catch (error) {
    console.error('AI_SERVICE_ERROR: Error en extractPropertyDetailsFromMessage (prompt v7):', error);
    return []; 
  }
}

/**
 * Procesa una consulta de usuario mediante IA
 * @param {string} userQuery - Consulta del usuario
 * @returns {string} - Respuesta de la IA
 */
const processUserQuery = async (userQuery) => {
  try {
    // Obtener todos los IDs de hojas activas
    const [sheets] = await query('SELECT * FROM google_sheets WHERE is_active = 1');
    
    if (sheets.length === 0) {
      return 'Lo siento, no hay información de propiedades disponible en este momento.';
    }
    
    // Obtener datos de todas las hojas activas
    let allPropertiesData = [];
    for (const sheet of sheets) {
      try {
        const sheetData = await getGoogleSheetData(sheet.sheet_id, sheet.range);
        
        if (sheetData && sheetData.length > 0) {
          // Agregar el nombre de la hoja como fuente
          const processedData = sheetData.map(property => ({
            ...property,
            source: sheet.name
          }));
          
          allPropertiesData = [...allPropertiesData, ...processedData];
        }
      } catch (error) {
        console.error(`Error obteniendo datos de la hoja ${sheet.name}:`, error);
      }
    }
    
    if (allPropertiesData.length === 0) {
      return 'Lo siento, no pude encontrar información de propiedades en las hojas disponibles.';
    }
    
    // Convertir los datos a un formato legible para la IA
    const propertiesContext = JSON.stringify(allPropertiesData);
    
    // Crear el prompt para Gemini
    const prompt = `Eres un asistente especializado en propiedades inmobiliarias. Tu tarea es responder preguntas sobre propiedades utilizando únicamente la información proporcionada. Si no encuentras información específica para responder, debes indicarlo claramente. No inventes detalles que no estén en los datos.

Datos de propiedades disponibles:
${propertiesContext}

Pregunta del usuario: ${userQuery}`;

    // Generar respuesta usando Gemini
    const response = await processWithGemini(prompt);
    return response.trim();

  } catch (error) {
    console.error('Error procesando consulta:', error);
    return 'Lo siento, ha ocurrido un error al procesar tu consulta. Por favor, intenta de nuevo más tarde.';
  }
};

/**
 * Analiza una consulta para determinar de qué tipo es
 * @param {string} query - Consulta del usuario
 * @returns {object} - Objeto con el tipo de consulta y entidades extraídas
 */
const analyzeQuery = async (query) => {
  try {
    const prompt = `Analiza la siguiente consulta sobre propiedades inmobiliarias. Identifica el tipo de consulta (búsqueda, información específica, precio, ubicación, etc.) y extrae entidades relevantes como ubicación, precio, tamaño, o características buscadas. Responde en formato JSON con las propiedades "type" y "entities".

Consulta: "${query}"`;

    const jsonResponse = await processWithGemini(prompt);
    
    try {
      // Intentar extraer el JSON de la respuesta
      const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Si no se puede analizar como JSON, devolver un formato básico
      return {
        type: 'unknown',
        entities: {}
      };
    } catch (jsonError) {
      console.error('Error analizando JSON de respuesta:', jsonError);
      return {
        type: 'unknown',
        entities: {}
      };
    }
  } catch (error) {
    console.error('Error analizando consulta:', error);
    return {
      type: 'unknown',
      entities: {}
    };
  }
};

module.exports = {
  processUserQuery,
  analyzeQuery,
  extractPropertyDetailsFromMessage
}; 