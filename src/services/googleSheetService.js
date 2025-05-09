const { google } = require('googleapis');
const { sendAdminNotification } = require('./notificationService'); // Importar el servicio de notificación
const { logger, LOG_LEVELS } = require('./loggingService'); // Importar logger y LOG_LEVELS
const crypto = require('crypto'); // Para generar UID
const moment = require('moment-timezone'); // Para formatear fecha y hora

const SERVICE_NAME = 'GoogleSheetService';

// Configuración para acceder a la API de Google
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Definición de la estructura de columnas esperada (A1 a AA1)
// Los nombres de las claves deben coincidir con los que devuelve aiService.js
const COLUMN_MAPPING = {
  'Busco / Ofrezco': { index: 0, header: 'Busco / Ofrezco' },          // A1
  'Tipo de Operacion': { index: 1, header: 'Tipo de Operacion' },      // B1
  'Propiedad': { index: 2, header: 'Propiedad' },                    // C1
  'Region': { index: 3, header: 'Region' },                         // D1
  'Ciudad': { index: 4, header: 'Ciudad' },                         // E1
  'Opcion Comuna': { index: 5, header: 'Opcion Comuna' },              // F1
  'Opcion Comuna 2': { index: 6, header: 'Opcion Comuna 2' },          // G1
  'Opcion Comuna 3': { index: 7, header: 'Opcion Comuna 3' },          // H1
  'Opcion Comuna 4': { index: 8, header: 'Opcion Comuna 4' },          // I1
  'Dormitorios': { index: 9, header: 'Dormitorios' },                // J1
  'Baños': { index: 10, header: 'Baños' },                          // K1
  'Estacionamiento': { index: 11, header: 'Estacionamiento' },          // L1
  'Bodegas': { index: 12, header: 'Bodegas' },                      // M1
  'Valor': { index: 13, header: 'Valor' },                          // N1
  'Moneda': { index: 14, header: 'Moneda' },                        // O1
  'Gastos Comunes': { index: 15, header: 'Gastos Comunes' },            // P1
  'Metros Cuadrados': { index: 16, header: 'Metros Cuadrados' },        // Q1
  'Telefono': { index: 17, header: 'Telefono' },                    // R1
  'Correo Electronico': { index: 18, header: 'Correo Electronico' },    // S1
  'Telefono Corredor': { index: 19, header: 'Telefono Corredor' },    // T1
  'Nombre Whatsapp': { index: 20, header: 'Nombre Whatsapp' },          // U1
  'Fecha Publicacion': { index: 21, header: 'Fecha Publicacion' },      // V1 (Generado)
  'Hora Publicacion': { index: 22, header: 'Hora Publicacion' },        // W1 (Generado)
  'UID': { index: 23, header: 'UID' },                              // X1 (Generado)
  'Status': { index: 24, header: 'Status' },                        // Y1 (Generado)
  'NullColumn': { index: 25, header: '' }, // Columna Z (Null) - el header puede ser vacío o un nombre específico si lo tienes
  'Fecha del Último Seguimiento': { index: 26, header: 'Fecha del Último Seguimiento' } // AA1
};
const TOTAL_COLUMNS = 27; // A hasta AA

// Definir constantes de índice para uso interno y exportación (basadas en COLUMN_MAPPING)
const CURRENT_UNIQUE_ID_COL_INDEX = COLUMN_MAPPING['UID'].index; // 23
const CURRENT_LOG_STATUS_COL_INDEX = COLUMN_MAPPING['Status'].index; // 24
const CURRENT_FOLLOW_UP_STAGE_COL_INDEX = COLUMN_MAPPING['Status'].index; // 24 (Asumiendo que Status es la etapa)
const CURRENT_LAST_FOLLOW_UP_COL_INDEX = COLUMN_MAPPING['Fecha del Último Seguimiento'].index; // 26
// Definimos también las que schedulerService podría necesitar
const CURRENT_FECHA_PUBLICACION_COL_INDEX = COLUMN_MAPPING['Fecha Publicacion'].index; // 21
const CURRENT_TELEFONO_CORREDOR_COL_INDEX = COLUMN_MAPPING['Telefono Corredor'].index; // 19

/**
 * Obtiene los datos de una hoja de Google Sheets
 * @param {string} spreadsheetId - ID de la hoja de Google Sheets
 * @param {string} range - Rango de celdas a obtener (ej: 'A:Z')
 * @returns {Array} - Arreglo de objetos con los datos de la hoja
 */
const getGoogleSheetData = async (spreadsheetId, range = 'A:Z') => {
  logger.debug('GET_GSHEET_DATA_START', 'Attempting to get Google Sheet data.', { spreadsheetId, range }, null, null, SERVICE_NAME);
  try {
    // Inicializar el cliente de Google Sheets
    const client = await auth.getClient();
    const sheets = google.sheets({
      version: 'v4',
      auth: client,
    });

    // Hacer la solicitud a la API de Google Sheets
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    // Extraer los valores
    const rows = response.data.values;
    
    if (!rows || rows.length === 0) {
      logger.info('GET_GSHEET_DATA_EMPTY', 'No data found in sheet or sheet is empty.', { spreadsheetId, range }, null, null, SERVICE_NAME);
      return [];
    }

    // Obtener los encabezados (primera fila)
    const headers = rows[0];
    
    // Convertir los datos a un arreglo de objetos
    const properties = rows.slice(1).map(row => {
      const property = {};
      headers.forEach((header, index) => {
        // Asegurarse de que hay un valor en esa celda
        if (index < row.length) {
          property[header] = row[index];
        } else {
          property[header] = '';
        }
      });
      return property;
    });

    logger.info('GET_GSHEET_DATA_SUCCESS', `Successfully retrieved and processed ${properties.length} properties.`, { spreadsheetId, range, count: properties.length }, null, null, SERVICE_NAME);
    return properties;
  } catch (error) {
    logger.error('GET_GSHEET_DATA_ERROR', 'Error getting data from Google Sheets.', { spreadsheetId, range, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    // Consider if admin notification is needed here too, or if it's too frequent.
    throw error;
  }
};

/**
 * Obtiene información sobre un Google Sheet
 * @param {string} spreadsheetId - ID de la hoja de Google Sheets
 * @returns {Object} - Información sobre la hoja
 */
const getSheetInfo = async (spreadsheetId) => {
  logger.debug('GET_GSHEET_INFO_START', 'Attempting to get Google Sheet info.', { spreadsheetId }, null, null, SERVICE_NAME);
  try {
    // Inicializar el cliente de Google Sheets
    const client = await auth.getClient();
    const sheets = google.sheets({
      version: 'v4',
      auth: client,
    });

    // Hacer la solicitud a la API de Google Sheets
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    const sheetInfo = {
      title: response.data.properties.title,
      sheets: response.data.sheets.map(sheet => ({
        title: sheet.properties.title,
        sheetId: sheet.properties.sheetId,
      })),
    };
    logger.info('GET_GSHEET_INFO_SUCCESS', 'Successfully retrieved sheet info.', { spreadsheetId, title: sheetInfo.title, sheetCount: sheetInfo.sheets.length }, null, null, SERVICE_NAME);
    return sheetInfo;
  } catch (error) {
    logger.error('GET_GSHEET_INFO_ERROR', 'Error getting sheet information.', { spreadsheetId, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    const adminMessage = `Error crítico al obtener información de Google Sheet.\n` +
                         `Spreadsheet ID: ${spreadsheetId}\n` +
                         `Error: ${error.message}`;
    sendAdminNotification(adminMessage, 'GET_SHEET_INFO_ERROR_ALERT')
    .catch(notificationError => {
      logger.error('ADMIN_NOTIFY_SEND_FAILURE', 'Failed to send admin notification about getSheetInfo error.', { originalError: error.message, notificationError: notificationError.message, stack: notificationError.stack }, null, null, SERVICE_NAME);
    });
    throw error;
  }
};

/**
 * Valida si un ID de Google Sheet es válido
 * @param {string} spreadsheetId - ID de la hoja de Google Sheets
 * @returns {boolean} - true si es válido, false si no
 */
const validateSheetId = async (spreadsheetId) => {
  logger.debug('VALIDATE_GSHEET_ID_START', 'Attempting to validate Google Sheet ID.', { spreadsheetId }, null, null, SERVICE_NAME);
  try {
    await getSheetInfo(spreadsheetId);
    logger.info('VALIDATE_GSHEET_ID_SUCCESS', 'Google Sheet ID validated successfully.', { spreadsheetId }, null, null, SERVICE_NAME);
    return true;
  } catch (error) {
    // getSheetInfo already logs the detailed error and sends admin notification
    logger.warn('VALIDATE_GSHEET_ID_FAILURE', 'Google Sheet ID validation failed.', { spreadsheetId, error: error.message }, null, null, SERVICE_NAME); // Log a summary here
    return false;
  }
};

/**
 * Exporta los datos de una hoja de Google Sheets a diferentes formatos
 * @param {Array} data - Los datos a exportar
 * @param {string} format - El formato a exportar (csv, json)
 * @returns {Object} - Objeto con el contenido y el tipo de contenido
 */
const exportSheetData = (data, format = 'json') => {
  logger.debug('EXPORT_GSHEET_DATA_START', 'Attempting to export sheet data.', { format, dataLength: data ? data.length : 0 }, null, null, SERVICE_NAME);
  try {
    if (!data || !Array.isArray(data)) {
      logger.error('EXPORT_GSHEET_DATA_INVALID_INPUT', 'Invalid data provided for export.', { format, type: typeof data }, null, null, SERVICE_NAME);
      throw new Error('Se requieren datos válidos para exportar');
    }

    // Si no hay datos, devolver un objeto vacío
    if (data.length === 0) {
      logger.info('EXPORT_GSHEET_DATA_EMPTY', 'No data to export, returning empty content.', { format }, null, null, SERVICE_NAME);
      return {
        content: format === 'json' ? '[]' : '',
        contentType: format === 'json' ? 'application/json' : 'text/csv'
      };
    }

    // Obtener las claves (encabezados)
    const headers = Object.keys(data[0]);

    switch (format.toLowerCase()) {
      case 'csv': {
        // Generar el CSV
        const csvHeader = headers.join(',');
        const csvRows = data.map(item => {
          return headers.map(header => {
            const value = item[header] || '';
            // Escapar comas y comillas
            return `"${value.toString().replace(/"/g, '""')}"`;
          }).join(',');
        });
        
        const csvContent = [csvHeader, ...csvRows].join('\n');
        
        const result = {
          content: csvContent,
          contentType: 'text/csv'
        };
        logger.info('EXPORT_GSHEET_DATA_SUCCESS', `Data exported successfully to ${format}.`, { format, dataLength: data.length }, null, null, SERVICE_NAME);
        return result;
      }
      
      case 'json':
      default: {
        const result = {
          content: JSON.stringify(data, null, 2),
          contentType: 'application/json'
        };
        logger.info('EXPORT_GSHEET_DATA_SUCCESS', `Data exported successfully to ${format}.`, { format, dataLength: data.length }, null, null, SERVICE_NAME);
        return result;
      }
    }
  } catch (error) {
    logger.error('EXPORT_GSHEET_DATA_ERROR', 'Error exporting sheet data.', { format, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    throw error;
  }
};

/**
 * Añade múltiples filas de datos a una hoja de Google Sheets.
 * @param {string} spreadsheetId - ID de la hoja de Google Sheets.
 * @param {string} sheetName - Nombre de la hoja dentro del spreadsheet (ej: 'Hoja1').
 * @param {Array<Array<any>>} rowsToAdd - Un array de arrays, donde cada array interno representa una fila a añadir.
 * @returns {Promise<Object>} - Respuesta de la API de Google Sheets.
 */
async function appendDataToSheet(spreadsheetId, sheetName, rowsToAdd) {
  logger.debug('APPEND_GSHEET_DATA_START', 'Attempting to append multiple rows to Google Sheet.', { spreadsheetId, sheetName, rowCount: rowsToAdd.length }, null, null, SERVICE_NAME);
  if (!rowsToAdd || rowsToAdd.length === 0) {
    logger.info('APPEND_GSHEET_DATA_EMPTY', 'No rows to append.', { spreadsheetId, sheetName }, null, null, SERVICE_NAME);
    return { success: true, message: 'No data to append.', updates: { updatedRows: 0 } };
  }
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    // SOLUCIÓN CLAVE: Si los datos de entrada son objetos (como los que viene de la IA),
    // convertirlos a arrays usando el orden definido en COLUMN_MAPPING
    let processedRows = [];
    
    // Detectar si rowsToAdd contiene objetos en lugar de arrays
    const containsObjects = rowsToAdd.some(row => !Array.isArray(row) && typeof row === 'object');
    
    if (containsObjects) {
      logger.info('APPEND_GSHEET_DATA_DETECTED_OBJECTS', 'Detected objects in rowsToAdd, converting to arrays.', 
                 { count: rowsToAdd.length, sample: JSON.stringify(rowsToAdd[0]).substring(0, 100) }, 
                 null, null, SERVICE_NAME);
      
      // Convertir objetos a arrays según COLUMN_MAPPING
      processedRows = rowsToAdd.map(obj => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          return []; // Fila inválida, será filtrada después
        }
        
        // Generar datos calculados (para campos como UID, fechas, etc.)
        const uid = obj['UID'] || crypto.randomUUID();
        const now = moment().tz('America/Santiago');
        const fechaPublicacion = obj['Fecha Publicacion'] || now.format('YYYY-MM-DD');
        const horaPublicacion = obj['Hora Publicacion'] || now.format('HH:mm:ss');
        const status = obj['Status'] || 'Nuevo';
        
        // MEJORA: Analizar y asignar "Busco / Ofrezco" correctamente
        let buscoOfrezco = obj['Busco / Ofrezco'] || '';
        buscoOfrezco = buscoOfrezco.trim().toLowerCase();
        
        // Si no es claramente "busco" o "ofrezco", intentar inferirlo solo para esta propiedad
        if (buscoOfrezco !== 'busco' && buscoOfrezco !== 'ofrezco') {
          // Verificar palabras específicas en el texto de la propiedad actual (no todo el mensaje)
          const propTexto = (obj['Propiedad'] || '') + ' ' + 
                            (obj['Tipo de Operacion'] || '') + ' ' + 
                            (obj['Region'] || '') + ' ' + 
                            (obj['Ciudad'] || '');
                            
          const propTextoLower = propTexto.toLowerCase();
          
          // Para cada propiedad, verificar específicamente palabras clave exclusivas
          // que claramente indican la intención
          if (propTextoLower.includes('busco') || 
              propTextoLower.includes('necesito') ||
              propTextoLower.includes('quiero')) {
            buscoOfrezco = 'Busco';
          } else if (propTextoLower.includes('vendo') || 
                    propTextoLower.includes('arriendo') || 
                    propTextoLower.includes('ofrezco')) {
            buscoOfrezco = 'Ofrezco';
          } else {
            // Si no hay palabras específicas, usar 'Ofrezco' como valor predeterminado
            buscoOfrezco = 'Ofrezco';
          }
        } else {
          // Capitalizar correctamente
          buscoOfrezco = buscoOfrezco === 'busco' ? 'Busco' : 'Ofrezco';
        }
        
        // Crear array de valores siguiendo el orden en COLUMN_MAPPING
        return [
          String(buscoOfrezco),                          // A1: Valor procesado
          String(obj['Tipo de Operacion'] || ''),     // B1
          String(obj['Propiedad'] || ''),             // C1
          String(obj['Region'] || ''),                // D1
          String(obj['Ciudad'] || ''),                // E1
          String(obj['Opcion Comuna'] || ''),         // F1
          String(obj['Opcion Comuna 2'] || ''),       // G1 
          String(obj['Opcion Comuna 3'] || ''),       // H1
          String(obj['Opcion Comuna 4'] || ''),       // I1
          String(obj['Dormitorios'] || ''),           // J1
          String(obj['Baños'] || ''),                 // K1
          String(obj['Estacionamiento'] || ''),       // L1
          String(obj['Bodegas'] || ''),               // M1
          String(obj['Valor'] || ''),                 // N1
          String(obj['Moneda'] || ''),                // O1
          String(obj['Gastos Comunes'] || ''),        // P1
          String(obj['Metros Cuadrados'] || ''),      // Q1
          String(obj['Telefono'] || ''),              // R1
          String(obj['Correo Electronico'] || ''),    // S1
          String(obj['Telefono Corredor'] || ''),     // T1: Telefono Corredor
          String(obj['Nombre Whatsapp'] || ''),       // U1: Nombre Whatsapp
          String(fechaPublicacion),                   // V1: Fecha Publicacion
          String(horaPublicacion),                    // W1: Hora Publicacion
          String(uid),                                // X1: UID
          String(status),                             // Y1: Status
          '',                                         // Z1
          String(obj['Fecha del Último Seguimiento'] || '') // AA1
        ];
      });
    } else {
      // Si rowsToAdd ya contiene arrays, usarlos directamente
      processedRows = rowsToAdd;
    }
    
    // VALIDAR y limpiar los datos antes de enviar a la API
    logger.debug('APPEND_GSHEET_DATA_SANITIZING', 'Sanitizing rows before API call', {rowsCount: processedRows.length}, null, null, SERVICE_NAME);
    
    // Verificar que cada fila sea un array, eliminar las que no lo son
    const validatedRows = processedRows.filter(row => {
      const isArray = Array.isArray(row);
      const hasValidLength = isArray && row.length > 0; // Asegurarse que no es un array vacío
      if (!isArray || !hasValidLength) {
        logger.warn('APPEND_GSHEET_DATA_INVALID_ROW', 'Found invalid row in processedRows', {
          isArray: isArray,
          type: typeof row,
          length: isArray ? row.length : 'N/A',
          value: JSON.stringify(row).substring(0, 100)
        }, null, null, SERVICE_NAME);
      }
      return isArray && hasValidLength;
    });
    
    // Solo continuar si aún tenemos filas válidas
    if (validatedRows.length === 0) {
      logger.error('APPEND_GSHEET_DATA_NO_VALID_ROWS', 'No valid rows to append after validation', {
        originalRowCount: rowsToAdd.length, 
        containsObjects: containsObjects
      }, null, null, SERVICE_NAME);
      return { success: false, message: 'No valid rows to append.', updates: { updatedRows: 0 } };
    }
    
    // Asegurar que cada elemento en cada fila sea un string primitivo y tiene la longitud correcta
    const sanitizedRows = validatedRows.map(row => {
      // Convertir cada valor a string
      let processedRow = row.map(cell => cell === null || cell === undefined ? '' : String(cell));
      
      // Asegurarse que tiene la longitud correcta (TOTAL_COLUMNS)
      if (processedRow.length !== TOTAL_COLUMNS) {
        logger.warn('APPEND_GSHEET_DATA_ROW_LENGTH', `Adjusting row length from ${processedRow.length} to ${TOTAL_COLUMNS}`, null, null, SERVICE_NAME);
        // Si es más corto, añadir strings vacíos
        while (processedRow.length < TOTAL_COLUMNS) {
          processedRow.push('');
        }
        // Si es más largo, truncar
        if (processedRow.length > TOTAL_COLUMNS) {
          processedRow = processedRow.slice(0, TOTAL_COLUMNS);
        }
      }
      
      return processedRow;
    });
    
    const resource = { values: sanitizedRows };
    const range = `${sheetName}!A1`; // Añade al final de la hoja especificada.
    
    logger.debug('APPEND_GSHEET_DATA_CALLING_API', 'Calling Google Sheets API to append rows', {
      rowCount: sanitizedRows.length,
      firstRowSample: sanitizedRows.length > 0 ? sanitizedRows[0].slice(0, 3) : []
    }, null, null, SERVICE_NAME);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'RAW', // Cambio a RAW para evitar interpretación de los valores
      resource,
    });
    logger.info('APPEND_GSHEET_DATA_SUCCESS', `Successfully appended ${sanitizedRows.length} rows.`, { spreadsheetId, sheetName, updates: response.data.updates }, null, null, SERVICE_NAME);
    return response.data;
  } catch (error) {
    const googleApiError = error.response && error.response.data && error.response.data.error;
    logger.error(
      'APPEND_GSHEET_DATA_ERROR', 
      'Failed to append data to Google Sheet.', 
      { 
        spreadsheetId, 
        sheetName, 
        error: googleApiError ? googleApiError.message : error.message, 
        stack: error.stack,
        googleApiError: googleApiError || 'N/A'
      }, 
      null, null, SERVICE_NAME
    );

    if (googleApiError) {
        logger.error('APPEND_GSHEET_DATA_GOOGLE_API_ERROR_DETAILS', 'Google API error details during append.', { errorResponse: googleApiError }, null, null, SERVICE_NAME);
    }

    // Mostrar más detalles sobre rowsToAdd en caso de error para depuración
    logger.error('APPEND_GSHEET_DATA_INPUT_DETAILS', 'Details about the input data that caused error', {
      rowsToAddIsArray: Array.isArray(rowsToAdd),
      rowsToAddLength: rowsToAdd ? rowsToAdd.length : 0,
      rowsToAddTypes: rowsToAdd ? rowsToAdd.map(r => typeof r) : [],
      firstRowSample: rowsToAdd && rowsToAdd.length > 0 ? JSON.stringify(rowsToAdd[0]).substring(0, 200) : 'N/A'
    }, null, null, SERVICE_NAME);

    const adminMessage = `Error crítico al agregar datos a Google Sheet.\n` +
                         `Spreadsheet ID: ${spreadsheetId}\nSheet: ${sheetName}\n` +
                         `Error: ${googleApiError ? googleApiError.message : error.message} (Code: ${googleApiError ? googleApiError.code : 'N/A'})`;
    
    // Enviar notificación con retraso para evitar spam en caso de errores masivos rápidos
    setTimeout(() => {
      sendAdminNotification(adminMessage, 'APPEND_DATA_ERROR_ALERT')
      .catch(notificationError => {
        logger.error('ADMIN_NOTIFY_SEND_FAILURE', 'Failed to send admin notification about appendDataToSheet error.', { originalError: error.message, notificationError: notificationError.message }, null, null, SERVICE_NAME);
      });
    }, 1000); // Retraso de 1 segundo

    throw new Error(`Error de Google API: ${googleApiError ? googleApiError.message : error.message} (Code: ${googleApiError ? googleApiError.code : 'N/A'})`);
  }
}

/**
 * Guarda los datos de propiedades extraídas en una hoja de Google Sheets.
 * @param {string} spreadsheetId - ID de la hoja de Google Sheets.
 * @param {string} sheetName - Nombre de la hoja (pestaña).
 * @param {Array<Object>} extractedPropertiesData - Array de objetos, cada uno representando una propiedad.
 * @param {string} userName - Nombre del usuario de WhatsApp que envió el mensaje.
 * @param {string} userPhone - Número de teléfono del usuario de WhatsApp.
 * @returns {Promise<Object>} - Objeto con el resultado de la operación.
 */
async function saveExtractedPropertyData(spreadsheetId, sheetName, extractedPropertiesData, userName = '', userPhone = '') {
  logger.info('SAVE_EXTRACTED_DATA_START', 'Attempting to save extracted property data.', { spreadsheetId, sheetName, propertyCount: extractedPropertiesData.length, userName, userPhone }, userPhone, null, SERVICE_NAME);

  if (!spreadsheetId || !sheetName) {
    logger.error('SAVE_EXTRACTED_DATA_MISSING_PARAMS', 'Missing spreadsheetId or sheetName.', { spreadsheetId, sheetName }, userPhone, null, SERVICE_NAME);
    throw new Error('Spreadsheet ID y Sheet Name son requeridos para guardar datos.');
  }

  if (!extractedPropertiesData || extractedPropertiesData.length === 0) {
    logger.info('SAVE_EXTRACTED_DATA_NO_PROPERTIES', 'No properties to save.', { spreadsheetId, sheetName }, userPhone, null, SERVICE_NAME);
    return { success: true, message: "No se extrajeron propiedades para guardar.", savedCount: 0 };
  }
  
  // MEJORA: Pre-procesamiento para dividir propiedades incorrectamente unidas
  let processedPropertiesData = [];
  
  for (const propertyData of extractedPropertiesData) {
    // Verificar si este objeto necesita ser dividido en múltiples propiedades
    const needsSplitting = detectMultiplePropertiesInObject(propertyData);
    
    if (needsSplitting) {
      logger.info('MULTIPLE_PROPERTIES_DETECTED', 'Detectadas múltiples propiedades en un solo objeto. Separando...', { 
        propertyFields: Object.keys(propertyData).slice(0, 5) + '...' 
      }, userPhone, null, SERVICE_NAME);
      
      // Dividir y añadir a processedPropertiesData
      const splitProperties = splitPropertyObject(propertyData);
      processedPropertiesData.push(...splitProperties);
      
      logger.info('PROPERTIES_SPLIT_COMPLETE', `Objeto dividido en ${splitProperties.length} propiedades separadas.`, { 
        count: splitProperties.length 
      }, userPhone, null, SERVICE_NAME);
    } else {
      // Mantener el objeto tal como está si no necesita división
      processedPropertiesData.push(propertyData);
    }
  }
  
  logger.info('PRE_PROCESSING_COMPLETE', `Pre-procesamiento finalizado. Originalmente ${extractedPropertiesData.length} objetos, ahora ${processedPropertiesData.length} para procesar.`, { 
    originalCount: extractedPropertiesData.length, 
    processedCount: processedPropertiesData.length 
  }, userPhone, null, SERVICE_NAME);
  
  // SOLUCIÓN: usar arrays directamente, no objetos
  const rowsToAppend = [];
  
  logger.debug('PROCESSING_EXTRACTED_DATA', 'Processing extracted data into rows', { 
    count: processedPropertiesData.length,
    sample: JSON.stringify(processedPropertiesData[0]).substring(0, 100)
  }, userPhone, null, SERVICE_NAME);

  // Por cada propiedad extraída, crear un array de valores
  for (let i = 0; i < processedPropertiesData.length; i++) {
    try {
      const propertyData = processedPropertiesData[i];
      
      // Log para ver el propertyData antes de crear rowValues
      logger.debug('PROPERTY_DATA_FOR_ROW_CONSTRUCTION', `Procesando propertyData para fila ${i+1}:`,
                   { 
                     uidAttempt: propertyData['UID'], // Si ya tiene UID de una división previa
                     buscoOfrezco: propertyData['Busco / Ofrezco'],
                     tipoOperacion: propertyData['Tipo de Operacion'],
                     propiedad: propertyData['Propiedad'],
                     region: propertyData['Region'],
                     ciudad: propertyData['Ciudad'],
                     dormitorios: propertyData['Dormitorios']
                   }, 
                   userPhone, null, SERVICE_NAME);

      const uid = propertyData['UID'] || crypto.randomUUID(); // Usar UID si ya existe (de splitPropertyObject), sino generar uno nuevo
      // Re-asignar al propertyData para consistencia si se usa más adelante, aunque rowValues lo toma directo
      if (!propertyData['UID']) propertyData['UID'] = uid; 

      const now = moment().tz('America/Santiago');
      const fechaPublicacion = now.format('YYYY-MM-DD');
      const horaPublicacion = now.format('HH:mm:ss');
      
      let buscoOfrezco = determinarBuscoOfrezco(propertyData);
      
      const rowValues = [
        buscoOfrezco,                                     
        String(propertyData['Tipo de Operacion'] || ''),     
        String(propertyData['Propiedad'] || ''),             
        String(propertyData['Region'] || ''), // REGION_VAL
        String(propertyData['Ciudad'] || ''),                
        String(propertyData['Opcion Comuna'] || ''),         
        String(propertyData['Opcion Comuna 2'] || ''),       
        String(propertyData['Opcion Comuna 3'] || ''),       
        String(propertyData['Opcion Comuna 4'] || ''),       
        String(propertyData['Dormitorios'] || ''),           
        String(propertyData['Baños'] || ''),                 
        String(propertyData['Estacionamiento'] || ''),       
        String(propertyData['Bodegas'] || ''),               
        String(propertyData['Valor'] || ''),                 
        String(propertyData['Moneda'] || ''),                
        String(propertyData['Gastos Comunes'] || ''),        
        String(propertyData['Metros Cuadrados'] || ''),      
        String(propertyData['Telefono'] || ''),              
        String(propertyData['Correo Electronico'] || ''),    
        String(userPhone || ''),                             
        String(userName || ''),                              
        String(fechaPublicacion),                            
        String(horaPublicacion),                             
        String(uid),                                         
        'Nuevo',                                             
        '',                                                  
        ''                                                   
      ];
      
      // Log para ver el valor de la región en rowValues
      logger.debug('ROW_VALUES_REGION_CHECK', `Valor de Región en rowValues[3] para fila ${i+1}:`,
                   { 
                     regionFromPropertyData: propertyData['Region'],
                     regionInRowValues: rowValues[3], // Índice 3 corresponde a Región
                     uid: uid
                   }, 
                   userPhone, uid, SERVICE_NAME);
      
      // Verificar que realmente tenemos un array
      if (!Array.isArray(rowValues)) {
        logger.error('ROW_VALUES_NOT_ARRAY', 'Error: rowValues no es un array', { 
          type: typeof rowValues 
        }, userPhone, null, SERVICE_NAME);
        continue;
      }
      
      // Verificar longitud del array
      if (rowValues.length !== TOTAL_COLUMNS) {
        logger.warn('ROW_VALUES_WRONG_LENGTH', `El array rowValues tiene longitud incorrecta: ${rowValues.length}, debería ser ${TOTAL_COLUMNS}`, { 
          actual: rowValues.length, 
          expected: TOTAL_COLUMNS 
        }, userPhone, null, SERVICE_NAME);
        // Ajustar al tamaño correcto
        while (rowValues.length < TOTAL_COLUMNS) rowValues.push('');
        if (rowValues.length > TOTAL_COLUMNS) rowValues.length = TOTAL_COLUMNS;
      }
      
      // Agregar la fila al array de filas a añadir
      rowsToAppend.push(rowValues);
      
      logger.debug('ROW_PREPARED', `Fila ${i+1} preparada para UID: ${uid}`, { 
        isArray: Array.isArray(rowValues),
        length: rowValues.length,
        first3Values: rowValues.slice(0, 3)
      }, userPhone, uid, SERVICE_NAME);
      
    } catch (error) {
      logger.error('ROW_PREPARATION_ERROR', `Error al preparar fila ${i+1}`, { 
        error: error.message, 
        stack: error.stack 
      }, userPhone, null, SERVICE_NAME);
    }
  }
  
  // Verificar que tenemos filas para agregar
  if (rowsToAppend.length === 0) {
    logger.warn('NO_ROWS_TO_APPEND', 'No hay filas válidas para agregar', {
      originalCount: processedPropertiesData.length
    }, userPhone, null, SERVICE_NAME);
    return { success: false, message: "No se pudieron preparar filas para guardar.", savedCount: 0 };
  }
  
  // Verificar formato final antes de enviar
  logger.info('ROWS_TO_APPEND_READY', `${rowsToAppend.length} filas listas para agregar`, { 
    count: rowsToAppend.length,
    allArrays: rowsToAppend.every(r => Array.isArray(r)),
    firstRowSample: rowsToAppend.length > 0 ? `[${rowsToAppend[0].slice(0, 3).join(', ')}...]` : 'none'
  }, userPhone, null, SERVICE_NAME);

  try {
    // Llamar a appendDataToSheet con las filas preparadas
    logger.info('CALLING_APPEND_DATA', `Enviando ${rowsToAppend.length} filas a Google Sheets`, { 
      spreadsheetId, 
      sheetName 
    }, userPhone, null, SERVICE_NAME);
    
    const appendResult = await appendDataToSheet(spreadsheetId, sheetName, rowsToAppend);
    
    if (appendResult && appendResult.updates && appendResult.updates.updatedRows > 0) {
      logger.info('SAVE_SUCCESS', `Se guardaron ${appendResult.updates.updatedRows} propiedades con éxito`, { 
        spreadsheetId, 
        sheetName, 
        savedCount: appendResult.updates.updatedRows 
      }, userPhone, null, SERVICE_NAME);
      
      return { 
        success: true, 
        message: `Se guardaron ${appendResult.updates.updatedRows} propiedades correctamente.`, 
        savedCount: appendResult.updates.updatedRows 
      };
    } else {
      logger.warn('SAVE_NO_UPDATES', 'La operación no reportó filas actualizadas', { 
        appendResult 
      }, userPhone, null, SERVICE_NAME);
      
      return { 
        success: false, 
        message: "La operación de guardado finalizó, pero no se confirmaron filas actualizadas.", 
        savedCount: 0 
      };
    }
  } catch (error) {
    logger.error('SAVE_ERROR', 'Error al guardar datos en Google Sheets', { 
      spreadsheetId, 
      sheetName, 
      error: error.message, 
      stack: error.stack 
    }, userPhone, null, SERVICE_NAME);
    
    throw error;
  }
}

/**
 * Detecta si un objeto de propiedad contiene información de múltiples propiedades
 * @param {Object} propertyObj - Objeto de propiedad a analizar
 * @returns {boolean} - Verdadero si se detectan múltiples propiedades
 */
function detectMultiplePropertiesInObject(propertyObj) {
  if (!propertyObj || typeof propertyObj !== 'object') return false;
  
  // Convertir todos los valores a string y unirlos para análisis
  const allText = Object.values(propertyObj)
    .filter(val => val && typeof val === 'string')
    .join(' ')
    .toLowerCase();
  
  // Patrones que indican múltiples propiedades
  const multiplePropertyPatterns = [
    // Frases que separan propiedades distintas
    /por un lado.*por otro lado/i,
    /también .*busco/i,
    /además .*vendo/i,
    /además .*ofrezco/i,
    /vendo.*también.*busco/i,
    /ofrezco.*también.*busco/i,
    /busco.*también.*vendo/i,
    /busco.*también.*ofrezco/i,
    
    // Combinaciones incompatibles
    /vendo.*busco/i,
    /ofrezco.*busco/i,
    /arriendo.*busco/i,
    /busco.*vendo/i,
    /busco.*ofrezco/i,
    /busco.*arriendo/i,

    // NUEVOS PATRONES para el caso específico "vendo X ... ofrezco Y"
    /vendo.*ofrezco/i, 
    /ofrezco.*vendo/i
  ];
  
  // Verificar si algún patrón de múltiples propiedades coincide
  const foundPattern = multiplePropertyPatterns.find(pattern => pattern.test(allText));
  if (foundPattern) {
    logger.info('DETECT_MULTIPLE_PATTERN_MATCH', `Patrón detectado para posible división: ${foundPattern.toString()}`, {textLength: allText.length}, null, null, SERVICE_NAME);
    return true;
  }
  return false;
}

/**
 * Divide un objeto de propiedad en múltiples objetos de propiedad
 * @param {Object} propertyObj - Objeto de propiedad a dividir
 * @returns {Array<Object>} - Array de objetos de propiedad
 */
function splitPropertyObject(propertyObj) {
  if (!propertyObj || typeof propertyObj !== 'object') return [propertyObj];
  
  const allPropValues = Object.values(propertyObj)
    .filter(val => val && typeof val === 'string')
    .join(' ');
    
  const allLowerText = allPropValues.toLowerCase();
  
  const vendoCasaPattern = /vendo\s+casa.*dormitorio/i;
  const ofrezcoCasaPattern = /ofrezco\s+casa.*dormitorio/i;
  
  const hasVendoCasa = vendoCasaPattern.test(allLowerText);
  const hasOfrezcoCasa = ofrezcoCasaPattern.test(allLowerText);
  
  if (hasVendoCasa && hasOfrezcoCasa) {
    logger.info('SPECIFIC_PATTERN_DETECTED', 'Detectado patrón específico: "vendo casa..." y "ofrezco casa..."', 
                { originalRegion: propertyObj['Region'], originalCiudad: propertyObj['Ciudad'] }, 
                null, null, SERVICE_NAME);
    
    const vendoProperty = { ...propertyObj };
    const ofrezcoProperty = { ...propertyObj };
    
    vendoProperty['Busco / Ofrezco'] = 'Ofrezco';
    vendoProperty['Tipo de Operacion'] = 'Venta';
    const vendoDormMatch = allLowerText.match(/vendo\s+casa.*?(\d+)\s+dormitorio/i);
    if (vendoDormMatch && vendoDormMatch[1]) {
      vendoProperty['Dormitorios'] = vendoDormMatch[1];
    }
    
    ofrezcoProperty['Busco / Ofrezco'] = 'Ofrezco';
    ofrezcoProperty['Tipo de Operacion'] = 'Venta'; 
    const ofrezcoDormMatch = allLowerText.match(/ofrezco\s+casa.*?(\d+)\s+dormitorio/i);
    if (ofrezcoDormMatch && ofrezcoDormMatch[1]) {
      ofrezcoProperty['Dormitorios'] = ofrezcoDormMatch[1];
    }

    // Log detallado de las propiedades divididas
    logger.debug('SPLIT_PROPERTIES_CONTENT', 'Contenido de las propiedades divididas (patrón específico):',
                 { 
                   vendoPropertyRegion: vendoProperty['Region'], 
                   vendoPropertyCiudad: vendoProperty['Ciudad'],
                   vendoPropertyDorms: vendoProperty['Dormitorios'],
                   ofrezcoPropertyRegion: ofrezcoProperty['Region'],
                   ofrezcoPropertyCiudad: ofrezcoProperty['Ciudad'],
                   ofrezcoPropertyDorms: ofrezcoProperty['Dormitorios']
                 }, 
                 null, null, SERVICE_NAME);
    
    return [vendoProperty, ofrezcoProperty];
  }
  
  // Usar expresiones regulares para encontrar los indicadores de diferentes propiedades
  const buscoIndicators = ['busco', 'necesito', 'requiero', 'looking', 'buscando', 'interesado en'];
  const ofrezcoIndicators = ['ofrezco', 'vendo', 'arriendo', 'dispongo', 'disponible', 'offering', 'tengo', 'se ofrece', 'se vende', 'se arrienda'];
  
  // Crear un objeto clonado que usaremos como base para las propiedades divididas
  const baseProperty = { ...propertyObj };
  
  // Resultados
  const properties = [];
  
  // Buscar todas las posiciones donde aparecen indicadores
  const indicatorPositions = [];
  
  // Añadir posiciones de indicadores "Busco"
  buscoIndicators.forEach(indicator => {
    let pos = allLowerText.indexOf(indicator);
    while (pos !== -1) {
      indicatorPositions.push({ pos, type: 'Busco', indicator });
      pos = allLowerText.indexOf(indicator, pos + 1);
    }
  });
  
  // Añadir posiciones de indicadores "Ofrezco"
  ofrezcoIndicators.forEach(indicator => {
    let pos = allLowerText.indexOf(indicator);
    while (pos !== -1) {
      indicatorPositions.push({ pos, type: 'Ofrezco', indicator });
      pos = allLowerText.indexOf(indicator, pos + 1);
    }
  });
  
  // Si no hay indicadores claros, devolver el objeto original
  if (indicatorPositions.length === 0) {
    properties.push(propertyObj);
    return properties;
  }
  
  // Ordenar por posición
  indicatorPositions.sort((a, b) => a.pos - b.pos);
  
  // Si solo hay un indicador, usar el objeto original con el tipo correcto
  if (indicatorPositions.length === 1) {
    const property = { ...baseProperty };
    property['Busco / Ofrezco'] = indicatorPositions[0].type;
    properties.push(property);
    return properties;
  }
  
  // Para múltiples indicadores, crear propiedades basadas en los indicadores encontrados
  const finalSplitProps = [];
  indicatorPositions.forEach(indicator => {
    const property = { ...baseProperty };
    property['Busco / Ofrezco'] = indicator.type;
    
    // Sobrescribir el tipo de operación dependiendo del tipo
    if (indicator.type === 'Busco') {
      property['Tipo de Operacion'] = inferTipoOperacion(indicator.indicator, 'Busco');
    } else {
      property['Tipo de Operacion'] = inferTipoOperacion(indicator.indicator, 'Ofrezco');
    }
    
    finalSplitProps.push(property);
  });
  
  logger.debug('SPLIT_PROPERTIES_CONTENT_INDICATORS', 'Contenido de las propiedades divididas (indicadores):',
               { 
                 count: finalSplitProps.length,
                 propsSample: finalSplitProps.map(p => ({ 
                     buscoOfrezco: p['Busco / Ofrezco'], 
                     tipoOp: p['Tipo de Operacion'], 
                     region: p['Region'] 
                 }))
               }, 
               null, null, SERVICE_NAME);
  return finalSplitProps;
}

/**
 * Infiere el tipo de operación basado en el indicador
 * @param {string} indicator - Indicador encontrado
 * @param {string} tipoGeneral - Tipo general (Busco/Ofrezco)
 * @returns {string} - Tipo de operación inferido
 */
function inferTipoOperacion(indicator, tipoGeneral) {
  indicator = indicator.toLowerCase();
  
  if (indicator === 'vendo' || indicator === 'se vende') {
    return 'Venta';
  } else if (indicator === 'arriendo' || indicator === 'se arrienda') {
    return 'Arriendo';
  } else if (indicator === 'busco' && tipoGeneral === 'Busco') {
    // Por defecto para "busco" si no hay más información
    return 'Compra';
  } else {
    // Tipo genérico basado en Busco/Ofrezco
    return tipoGeneral === 'Busco' ? 'Compra' : 'Venta';
  }
}

/**
 * Determina si la propiedad es Busco u Ofrezco basado en su contenido
 * @param {Object} propertyData - Datos de la propiedad
 * @returns {string} - "Busco" u "Ofrezco"
 */
function determinarBuscoOfrezco(propertyData) {
  // Si ya tiene un valor explícito, usarlo
  let buscoOfrezco = propertyData['Busco / Ofrezco'] || '';
  buscoOfrezco = buscoOfrezco.trim().toLowerCase();
  
  // Si el valor ya es claramente "busco" o "ofrezco", solo capitalizar
  if (buscoOfrezco === 'busco' || buscoOfrezco === 'ofrezco') {
    return buscoOfrezco === 'busco' ? 'Busco' : 'Ofrezco';
  }
  
  // Palabras clave que indican "busco"
  const buscoPalabras = ['busco', 'necesito', 'requiero', 'looking', 'buscando', 'interesado en', 'quisiera encontrar'];
  
  // Palabras clave que indican "ofrezco"
  const ofrezcoPalabras = ['ofrezco', 'vendo', 'arriendo', 'dispongo', 'disponible', 'offering', 'tengo', 'se ofrece', 'se vende', 'se arrienda'];
  
  // Extraer texto relevante para análisis
  const relevantFields = [
    propertyData['Propiedad'] || '',
    propertyData['Tipo de Operacion'] || '',
    propertyData['Region'] || '',
    propertyData['Ciudad'] || ''
  ];
  
  const textToAnalyze = relevantFields.join(' ').toLowerCase();
  
  // Verificar palabras clave específicas y tipo de operación
  const tipoOperacion = (propertyData['Tipo de Operacion'] || '').toLowerCase();
  
  // Reglas específicas basadas en Tipo de Operacion
  if (['compra', 'arrendar', 'busco', 'necesito'].includes(tipoOperacion)) {
    return 'Busco';
  } else if (['venta', 'arriendo', 'ofrezco', 'vendo'].includes(tipoOperacion)) {
    return 'Ofrezco';
  }
  
  // Contar ocurrencias de palabras clave
  let contadorBusco = 0;
  let contadorOfrezco = 0;
  
  buscoPalabras.forEach(palabra => {
    if (textToAnalyze.includes(palabra.toLowerCase())) contadorBusco++;
  });
  
  ofrezcoPalabras.forEach(palabra => {
    if (textToAnalyze.includes(palabra.toLowerCase())) contadorOfrezco++;
  });
  
  // Determinar basado en el conteo
  if (contadorBusco > contadorOfrezco) {
    return 'Busco';
  } else if (contadorOfrezco > contadorBusco) {
    return 'Ofrezco';
  } else {
    // Por defecto si no hay suficiente información
    return 'Ofrezco';
  }
}

/**
 * Busca propiedades en la hoja de cálculo según los criterios especificados.
 * Solo devuelve propiedades con LogStatus = "Activo".
 * @param {string} spreadsheetId - El ID de la hoja de cálculo.
 * @param {string} sheetName - El nombre de la pestaña.
 * @param {object} criteria - Objeto con criterios de búsqueda { type, action, location }.
 * @returns {Promise<Array<object>>} - Un array de objetos, donde cada objeto representa una propiedad encontrada.
 */
async function searchPropertiesInSheet(spreadsheetId, sheetName, criteria) {
  logger.debug('SEARCH_PROPERTIES_START', 'Attempting to search properties in sheet.', { spreadsheetId, sheetName, criteria }, null, null, SERVICE_NAME);
  try {
    // Asume que los criterios son un objeto donde las claves son los encabezados de columna
    // y los valores son lo que se busca en esa columna.
    // Esto requiere obtener todos los datos y filtrar localmente.
    // Para búsquedas más complejas o eficientes en hojas grandes, se podría usar Google Query Language.
    const range = `${sheetName}!A:Z`; // Ajustar si las columnas exceden Z
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) { // Menos de 2 porque la primera es encabezados
      logger.info('SEARCH_PROPERTIES_NO_DATA', 'No data or only headers in sheet for searching.', { spreadsheetId, sheetName }, null, null, SERVICE_NAME);
      return [];
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    let matchedProperties = [];

    // Mapear los índices de las columnas de los criterios
    const criteriaColumnIndices = {};
    for (const key in criteria) {
      const index = headers.indexOf(key);
      if (index !== -1) {
        criteriaColumnIndices[key] = index;
      } else {
        logger.warn('SEARCH_PROPERTIES_CRITERIA_HEADER_NOT_FOUND', `Header '${key}' from criteria not found in sheet headers.`, { spreadsheetId, sheetName, header: key }, null, null, SERVICE_NAME);
      }
    }

    if (Object.keys(criteriaColumnIndices).length === 0 && Object.keys(criteria).length > 0) {
        logger.warn('SEARCH_PROPERTIES_NO_VALID_CRITERIA_HEADERS', 'None of the provided criteria headers were found in the sheet.', { spreadsheetId, sheetName, criteria }, null, null, SERVICE_NAME);
        return []; // No hay encabezados válidos para buscar
    }
    
    dataRows.forEach(row => {
      let matchesAllCriteria = true;
      for (const key in criteria) {
        const columnIndex = criteriaColumnIndices[key];
        if (columnIndex !== undefined) {
          // Comparación insensible a mayúsculas/minúsculas y eliminando espacios extra
          const cellValue = row[columnIndex] ? String(row[columnIndex]).trim().toLowerCase() : '';
          const criteriaValue = String(criteria[key]).trim().toLowerCase();
          if (cellValue !== criteriaValue) {
            matchesAllCriteria = false;
            break;
          }
        }
      }
      if (matchesAllCriteria) {
        // Construir el objeto propiedad como en getGoogleSheetData
        const property = {};
        headers.forEach((header, index) => {
          property[header] = row[index] !== undefined ? row[index] : '';
        });
        matchedProperties.push(property);
      }
    });
    logger.info('SEARCH_PROPERTIES_SUCCESS', `Search completed. Found ${matchedProperties.length} matching properties.`, { spreadsheetId, sheetName, criteria, count: matchedProperties.length }, null, null, SERVICE_NAME);
    return matchedProperties;

  } catch (error) {
    logger.error('SEARCH_PROPERTIES_ERROR', 'Error searching properties in sheet.', { spreadsheetId, sheetName, criteria, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    throw error;
  }
}

/**
 * Obtiene todas las filas de datos de una hoja junto con su índice de fila.
 * Ideal para buscar y luego actualizar filas.
 * @param {string} spreadsheetId - ID de la hoja.
 * @param {string} sheetName - Nombre de la pestaña.
 * @param {string} rangeA1Notation - Rango en notación A1 (ej: 'A:Z')
 * @returns {Promise<Array<{rowIndex: number, rowData: Array<string>}>>} - Array de objetos con índice y datos de fila.
 */
async function getSheetDataWithRowIndices(spreadsheetId, sheetName, rangeA1Notation = 'A:AA') { // Asegurar que el rango cubra hasta AA
  logger.debug('GET_GSHEET_DATA_WITH_INDICES_START', 'Attempting to get sheet data with row indices.', { spreadsheetId, sheetName, rangeA1Notation }, null, null, SERVICE_NAME);
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const range = `${sheetName}!${rangeA1Notation}`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER' 
    });
    const rows = response.data.values || [];
    // Asume que la primera fila son encabezados, por lo que los datos empiezan en el índice 1 (fila 2 de la hoja)
    const mappedRows = rows.slice(1).map((rowData, index) => ({
      rowIndex: index + 2, // +1 por slice(1), +1 porque los índices de fila son basados en 1
      rowData: rowData
    }));
    logger.info('GET_GSHEET_DATA_WITH_INDICES_SUCCESS', `Successfully retrieved ${mappedRows.length} rows with indices.`, { spreadsheetId, sheetName, rangeA1Notation, count: mappedRows.length }, null, null, SERVICE_NAME);
    return mappedRows;
  } catch (error) {
    logger.error('GET_GSHEET_DATA_WITH_INDICES_ERROR', 'Error getting sheet data with row indices.', { spreadsheetId, sheetName, rangeA1Notation, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    throw error;
  }
}

/**
 * Actualiza celdas específicas en una fila encontrada por UniqueID.
 * @param {string} spreadsheetId ID de la hoja.
 * @param {string} sheetName Nombre de la pestaña.
 * @param {string} uniqueId El ID único a buscar en la columna CURRENT_UNIQUE_ID_COL_INDEX.
 * @param {object} updates Objeto con { HeaderName: newValue } para actualizar.
 * @returns {Promise<Object>} Resultado de la API batchUpdate.
 */
async function updateSheetRowByUniqueId(spreadsheetId, sheetName, uniqueId, updates) {
    logger.debug('UPDATE_GSHEET_ROW_START', 'Attempting to update sheet row by Unique ID.', { spreadsheetId, sheetName, uniqueId, updates }, null, null, SERVICE_NAME);
    try {
        const client = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: client });

        // 1. Encontrar el número de fila (1-indexed) del uniqueId
        // Construir la letra de la columna para el UID
        const uidColumnLetter = String.fromCharCode(65 + CURRENT_UNIQUE_ID_COL_INDEX);
        const searchRange = `${sheetName}!${uidColumnLetter}:${uidColumnLetter}`; 
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: searchRange,
        });

        const rows = response.data.values;
        let rowIndex = -1;
        if (rows) {
            for (let i = 0; i < rows.length; i++) {
                if (rows[i] && rows[i][0] === uniqueId) { // Añadir verificación por si la fila está vacía
                    rowIndex = i + 1; // Google Sheets es 1-indexed
                    break;
                }
            }
        }

        if (rowIndex === -1) {
            logger.warn('UPDATE_GSHEET_ROW_UID_NOT_FOUND', 'Unique ID not found for update.', { spreadsheetId, sheetName, uniqueId }, null, null, SERVICE_NAME);
            throw new Error(`UID '${uniqueId}' no encontrado en la hoja '${sheetName}'.`);
        }

        // 2. Preparar las actualizaciones usando batchUpdate
        const requests = [];
        const sheetId = await getSheetIdByName(spreadsheetId, sheetName, sheets); // Obtener ID numérico de la hoja

        for (const headerKey in updates) {
            if (COLUMN_MAPPING.hasOwnProperty(headerKey)) {
                const columnIndex = COLUMN_MAPPING[headerKey].index;
                requests.push({
                    updateCells: {
                        rows: [
                            {
                                values: [
                                    {
                                        userEnteredValue: {
                                            // Determinar el tipo de valor para la API
                                            [typeof updates[headerKey] === 'number' ? 'numberValue' : 'stringValue']: 
                                                typeof updates[headerKey] === 'number' ? updates[headerKey] : String(updates[headerKey])
                                        }
                                    }
                                ]
                            }
                        ],
                        fields: 'userEnteredValue',
                        start: {
                            sheetId: sheetId, 
                            rowIndex: rowIndex - 1, // API es 0-indexed para filas
                            columnIndex: columnIndex
                        }
                    }
                });
            } else {
                logger.warn('UPDATE_GSHEET_ROW_UNKNOWN_HEADER', `Header '${headerKey}' no encontrado en COLUMN_MAPPING. No se actualizará.`, { headerKey }, null, null, SERVICE_NAME);
            }
        }

        if (requests.length === 0) {
            logger.info('UPDATE_GSHEET_ROW_NO_VALID_UPDATES', 'No valid updates to perform after mapping headers.', { updates }, null, null, SERVICE_NAME);
            return { message: "No hay actualizaciones válidas para realizar." };
        }

        const batchUpdateRequest = { requests };
        const updateResult = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: batchUpdateRequest,
        });

        logger.info('UPDATE_GSHEET_ROW_SUCCESS', 'Sheet row updated successfully.', { spreadsheetId, sheetName, uniqueId, updatedCells: requests.length }, null, null, SERVICE_NAME);
        return updateResult.data;

    } catch (error) {
        logger.error('UPDATE_GSHEET_ROW_ERROR', 'Error updating sheet row by Unique ID.', { spreadsheetId, sheetName, uniqueId, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
        throw error;
    }
}

// Función helper para obtener el ID numérico de una hoja por su nombre
async function getSheetIdByName(spreadsheetId, sheetName, sheetsInstance) {
    // Considerar cachear esto si se llama muy frecuentemente
    if (!sheetsInstance) {
        const client = await auth.getClient();
        sheetsInstance = google.sheets({ version: 'v4', auth: client });
    }
    try {
        const spreadsheet = await sheetsInstance.spreadsheets.get({ spreadsheetId });
        const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
        if (!sheet) {
            throw new Error(`Hoja con nombre "${sheetName}" no encontrada en el spreadsheet ${spreadsheetId}.`);
        }
        return sheet.properties.sheetId;
    } catch(error) {
         logger.error('GET_SHEET_ID_ERROR', `Failed to get sheetId for sheetName ${sheetName}`, { spreadsheetId, sheetName, error: error.message }, null, null, SERVICE_NAME);
         throw error; // Re-lanzar el error
    }    
}

module.exports = {
  getGoogleSheetData,
  getSheetInfo,
  validateSheetId,
  exportSheetData,
  appendDataToSheet,
  getSheetDataWithRowIndices,
  updateSheetRowByUniqueId,
  searchPropertiesInSheet,
  saveExtractedPropertyData,
  COLUMN_MAPPING,
  CURRENT_UNIQUE_ID_COL_INDEX,
  CURRENT_LOG_STATUS_COL_INDEX,
  CURRENT_FOLLOW_UP_STAGE_COL_INDEX,
  CURRENT_LAST_FOLLOW_UP_COL_INDEX,
  CURRENT_FECHA_PUBLICACION_COL_INDEX,
  CURRENT_TELEFONO_CORREDOR_COL_INDEX
}; 