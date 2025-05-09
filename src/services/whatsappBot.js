const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { processUserQuery, extractPropertyDetailsFromMessage } = require('./aiService');
const { appendDataToSheet, getSheetInfo, updateSheetRowByUniqueId, searchPropertiesInSheet } = require('./googleSheetService');
const { query } = require('../config/database');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { v4: uuidv4 } = require('uuid');
const { logger, LOG_LEVELS } = require('./loggingService');
const googleSheetService = require('./googleSheetService');

const SERVICE_NAME = 'WhatsappBotService';

// Usar el plugin stealth
puppeteerExtra.use(StealthPlugin());

let client;
let isInitialized = false;
const WHATSAPP_SESSION_PATH = './whatsapp-sessions/';
let guidedConversations = {}; // Objeto para rastrear conversaciones guiadas

/**
 * Crea el directorio de sesiones si no existe
 */
const ensureSessionDirectory = () => {
  if (!fs.existsSync(WHATSAPP_SESSION_PATH)) {
    fs.mkdirSync(WHATSAPP_SESSION_PATH, { recursive: true });
    logger.info('SESSION_DIR_CREATED', `Session directory created: ${WHATSAPP_SESSION_PATH}`, {}, null, null, SERVICE_NAME);
  }
};

/**
 * Verifica si Chrome está disponible en el sistema
 * @returns {boolean} - true si Chrome está disponible, false si no
 */
const isChromeAvailable = () => {
  try {
    // Rutas comunes de Chrome en diferentes sistemas operativos
    const chromePaths = [
      // Linux
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      // Windows
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      // macOS
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
    
    for (const chromePath of chromePaths) {
      if (fs.existsSync(chromePath)) {
        logger.debug('CHROME_CHECK_FOUND', 'Chrome found.', { path: chromePath }, null, null, SERVICE_NAME);
        return { available: true, path: chromePath };
      }
    }
    
    logger.warn('CHROME_CHECK_NOT_FOUND', 'Chrome not found at common paths.', {}, null, null, SERVICE_NAME);
    return { available: false };
  } catch (error) {
    logger.error('CHROME_CHECK_ERROR', 'Error verifying Chrome availability.', { error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    return { available: false };
  }
};

/**
 * Inicializa el bot de WhatsApp
 */
const initWhatsAppBot = async () => {
  logger.info('BOT_INIT_START', 'Attempting to initialize WhatsApp bot...', {}, null, null, SERVICE_NAME);
  try {
    if (client) {
      logger.info('BOT_INIT_ALREADY_EXISTS', 'WhatsApp client already exists.', {}, null, null, SERVICE_NAME);
      return client;
    }

    console.log('Iniciando el bot de WhatsApp...');
    
    // Asegurar que el directorio de sesiones existe
    ensureSessionDirectory();
    
    // Verificar si Chrome está disponible
    const chrome = isChromeAvailable();
    
    // Configuración de Puppeteer
    const puppeteerOptions = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-webgl',
        '--mute-audio',
        '--single-process',
        '--disable-features=site-per-process',
        '--ignore-certificate-errors',
        '--headless=new'
      ],
      headless: 'new', // Siempre usar modo headless
      timeout: 120000, // Mayor tiempo de espera (120 segundos)
      defaultViewport: null,
      // Usar puppeteer-extra en lugar de puppeteer normal
      puppeteer: puppeteerExtra
    };
    
    // Si encontramos Chrome, usarlo explícitamente
    if (chrome.available) {
      logger.info('BOT_INIT_CHROME_PATH', `Using explicit Chrome path: ${chrome.path}`, { path: chrome.path }, null, null, SERVICE_NAME);
      puppeteerOptions.executablePath = chrome.path;
    } else {
      logger.info('BOT_INIT_BUNDLED_BROWSER', 'Chrome not found, using Puppeteer bundled browser.', {}, null, null, SERVICE_NAME);
    }
    
    // Crear nueva instancia del cliente de WhatsApp
    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'property-bot',
        dataPath: WHATSAPP_SESSION_PATH
      }),
      puppeteer: puppeteerOptions,
      webVersionCache: {
        type: 'none'  // Desactivar caché para evitar problemas
      },
      qrMaxRetries: 5,
      restartOnAuthFail: true
    });

    // Evento de generación de código QR para la autenticación
    client.on('qr', (qr) => {
      logger.info('WHATSAPP_QR_RECEIVED', 'QR code received for authentication.', {}, null, null, SERVICE_NAME);
      console.log('QR RECIBIDO, escanéalo con WhatsApp:');
      qrcode.generate(qr, { small: true });
      
      // También guardar el QR en un archivo para acceso remoto
      try {
        const qrFilePath = path.join(WHATSAPP_SESSION_PATH, 'last-qr.txt');
        fs.writeFileSync(qrFilePath, qr);
        logger.info('WHATSAPP_QR_SAVED', 'QR code saved to file.', { path: qrFilePath }, null, null, SERVICE_NAME);
      } catch (qrError) {
        logger.error('WHATSAPP_QR_SAVE_ERROR', 'Error saving QR code to file.', { error: qrError.message, stack: qrError.stack }, null, null, SERVICE_NAME);
      }
    });

    // Eventos de estado y conexión
    client.on('ready', () => {
      logger.info('WHATSAPP_READY', 'WhatsApp client is ready and connected!', {}, null, null, SERVICE_NAME);
      isInitialized = true;
    });
    
    client.on('authenticated', () => {
      logger.info('WHATSAPP_AUTHENTICATED', 'WhatsApp client authenticated successfully.', {}, null, null, SERVICE_NAME);
    });
    
    client.on('auth_failure', (error) => {
      logger.error('WHATSAPP_AUTH_FAILURE', 'WhatsApp authentication failed.', { error: error.message || error }, null, null, SERVICE_NAME);
      isInitialized = false;
    });
    
    client.on('disconnected', (reason) => {
      logger.warn('WHATSAPP_DISCONNECTED', 'WhatsApp client disconnected.', { reason }, null, null, SERVICE_NAME);
      isInitialized = false;
      client = null;
      
      // Intentar reconectar después de un tiempo
      setTimeout(() => {
        logger.info('WHATSAPP_RECONNECT_ATTEMPT', 'Attempting to reconnect WhatsApp client...', {}, null, null, SERVICE_NAME);
        initWhatsAppBot().catch(reconnectError => {
          logger.error('WHATSAPP_RECONNECT_ERROR', 'Error during WhatsApp reconnection attempt.', { error: reconnectError.message, stack: reconnectError.stack }, null, null, SERVICE_NAME);
        });
      }, 10000); // Esperar 10 segundos antes de reconectar
    });

    // Evento cuando se recibe un mensaje
    client.on('message', async (message) => {
      const messageTimestamp = new Date(message.timestamp * 1000).toISOString();
      const from = message.from;
      const body = message.body ? message.body.trim() : '';
      const chat = await message.getChat();
      const isGroup = chat.isGroup;
      const senderId = message.author || from; 
      let senderPhoneNumber = senderId.replace(/@c\.us|@g\.us/g, ''); 
      let senderPushName = 'Desconocido';
      let senderContactId = from; 

      try {
        const contact = await client.getContactById(senderContactId);
        if (contact && contact.pushname) { senderPushName = contact.pushname; }
        else if (contact && contact.name) { senderPushName = contact.name; }
        if (isGroup && message.author) {
            const senderContactInGroup = await client.getContactById(message.author);
             if (senderContactInGroup && senderContactInGroup.pushname) { senderPushName = senderContactInGroup.pushname; }
             else if (senderContactInGroup && senderContactInGroup.name) { senderPushName = senderContactInGroup.name; }
        }
      } catch (contactError) { 
        logger.warn('CONTACT_INFO_FETCH_ERROR', 'Could not fetch contact info.', { senderId: senderContactId, error: contactError.message }, senderPhoneNumber, null, SERVICE_NAME);
      }

      logger.info('MESSAGE_RECEIVED', 
        `From: ${senderPhoneNumber} (${senderPushName}), Group: ${isGroup}, Body: "${body}"`,
        { from, body, isGroup, senderId, senderPhoneNumber, senderPushName, messageId: message.id.id, timestamp: messageTimestamp }, 
        senderPhoneNumber, null, SERVICE_NAME
      );

      try {
          // --- PASO 1: Manejo de Respuestas a Seguimientos (Prioritario) ---
          if (message.hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            if (quotedMsg.fromMe && quotedMsg.body.includes('Respecto a tu publicación con ID [')) {
              logger.info('FOLLOW_UP_RESPONSE_DETECTED', 'Detected a response to a follow-up message.', { quotedMessageId: quotedMsg.id.id, originalSender: senderPhoneNumber }, senderPhoneNumber, null, SERVICE_NAME);
              const match = quotedMsg.body.match(/ID \[([\S]+)\]/);
              if (match && match[1]) {
                const uniqueId = match[1];
                const userResponse = body.toLowerCase().trim();
                logger.info('FOLLOW_UP_RESPONSE_RECEIVED', 'Received follow-up response.', { uniqueId, userResponse }, senderPhoneNumber, uniqueId, SERVICE_NAME);
                let newStatus = null;
                if (['si', 'sí', 'listo', 'vendido', 'arrendado', 'conseguido', 'ya', 'ok'].includes(userResponse)) {
                  newStatus = 'Cerrado';
                } else if (['no', 'aún no', 'todavía', 'aun no', 'sigue disponible', 'sigue'].includes(userResponse)) {
                  await message.reply('Entendido, lo mantendremos activo. ¡Gracias por confirmar!');
                } else {
                  await message.reply('Disculpa, no entendí bien tu respuesta. ¿Se concretó lo de tu publicación (sí/no)?');
                }
                if (newStatus === 'Cerrado') {
                  try {
                    const [designatedSheetsDB] = await query('SELECT sheet_id FROM google_sheets WHERE is_property_log_sheet = TRUE LIMIT 1');
                    if (designatedSheetsDB && designatedSheetsDB.length > 0) {
                      const designatedSheetId = designatedSheetsDB[0].sheet_id;
                      const sheetInfo = await getSheetInfo(designatedSheetId);
                      if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                        const targetSheetName = sheetInfo.sheets[0].title; 
                        const updates = { 'Status': 'Cerrado' }; 
                        const updated = await updateSheetRowByUniqueId(designatedSheetId, targetSheetName, uniqueId, updates);
                        if (updated) { await message.reply('¡Excelente! He actualizado el estado de tu publicación.'); }
                        else { await message.reply('No pude encontrar el registro original para actualizarlo, pero gracias por confirmar.'); }
                      } else { logger.error('DESIGNATED_SHEET_NO_TABS', 'No tabs found in designated sheet for follow-up update.', { designatedSheetId }); await message.reply('Error interno al actualizar (SNT).'); }
                    } else { logger.error('DESIGNATED_SHEET_NOT_FOUND_DB', 'No designated sheet found in DB for follow-up update.'); await message.reply('Error interno al actualizar (SND).'); }
                  } catch (updateError) { logger.error('FOLLOW_UP_UPDATE_ERROR', 'Error updating follow-up status to Cerrado', { uniqueId, error: updateError.message, stack: updateError.stack }, senderPhoneNumber, uniqueId, SERVICE_NAME); await message.reply('Gracias por confirmar. Hubo un problema al actualizar, lo revisaremos.'); }
                }
                logger.info('FOLLOW_UP_RESPONSE_PROCESSED', 'Follow-up response processed.', { uniqueId, userResponse, newStatus }, senderPhoneNumber, uniqueId, SERVICE_NAME);
                return;
              }
            }
          }

        // ---- PASO 2: Identificar si es un comando o texto libre ----
        if (body && !body.toLowerCase().startsWith('/buscar') && !body.toLowerCase().startsWith('/menu') && !body.toLowerCase().startsWith('/ayuda')) {
          logger.info('FREE_TEXT_DETECTED', 'Free text detected, attempting property extraction.', { bodyLength: body.length }, senderPhoneNumber, null, SERVICE_NAME);
          
          // Si es un mensaje en un grupo, no responder para evitar spam
          if (!isGroup) {
            await message.reply('Procesando tu publicación, un momento por favor...');
          }

          try {
            const extractedDetailsArray = await extractPropertyDetailsFromMessage(body);
            
            if (extractedDetailsArray && extractedDetailsArray.length > 0) {
              logger.info('EXTRACTION_SUCCESS', `Extracted ${extractedDetailsArray.length} properties.`, { count: extractedDetailsArray.length, firstPropertySample: JSON.stringify(extractedDetailsArray[0]).substring(0,100) }, senderPhoneNumber, null, SERVICE_NAME);
              
              const [designatedSheetsDB] = await query('SELECT sheet_id FROM google_sheets WHERE is_property_log_sheet = TRUE LIMIT 1');
              if (designatedSheetsDB && designatedSheetsDB.length > 0) {
                const designatedSheetId = designatedSheetsDB[0].sheet_id;
                const sheetInfo = await getSheetInfo(designatedSheetId);
                
                if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                  const targetSheetName = sheetInfo.sheets[0].title; 
                  
                  // *** CORRECCIÓN AQUÍ ***
                  // Llamar a saveExtractedPropertyData en lugar de appendDataToSheet
                  // y pasar senderPushName y senderPhoneNumber
                  const saveResult = await googleSheetService.saveExtractedPropertyData(
                    designatedSheetId, 
                    targetSheetName, 
                    extractedDetailsArray, 
                    senderPushName,    // <--- userName
                    senderPhoneNumber  // <--- userPhone
                  );

                  if (saveResult && saveResult.success && saveResult.savedCount > 0) {
                    if (!isGroup) {
                      await message.reply(`¡Listo! Se guardaron ${saveResult.savedCount} propiedades en la planilla.`);
                    }
                    logger.info('SAVE_TO_SHEET_SUCCESS', `Successfully saved ${saveResult.savedCount} properties.`, { savedCount: saveResult.savedCount }, senderPhoneNumber, null, SERVICE_NAME);
                  } else {
                    if (!isGroup) {
                      await message.reply('No se pudo guardar la información extraída o no se extrajeron detalles válidos. Si el problema persiste, contacta al administrador.');
                    }
                    logger.warn('SAVE_TO_SHEET_FAILURE', 'Failed to save extracted details or no details extracted.', { saveResult }, senderPhoneNumber, null, SERVICE_NAME);
                  }
                } else {
                  logger.error('DESIGNATED_SHEET_NO_TABS_MAIN', 'No tabs found in designated sheet for property logging.', { designatedSheetId }, senderPhoneNumber, null, SERVICE_NAME);
                  if (!isGroup) await message.reply('Error interno al guardar (SNT-M).');
                }
              } else {
                logger.error('DESIGNATED_SHEET_NOT_FOUND_DB_MAIN', 'No designated sheet found in DB for property logging.', {}, senderPhoneNumber, null, SERVICE_NAME);
                if (!isGroup) await message.reply('Error interno al guardar (SND-M).');
              }
            } else {
              if (!isGroup) {
                await message.reply('No pude extraer detalles de propiedades de tu mensaje. Intenta ser más específico o usa el formato sugerido.');
              }
              logger.info('EXTRACTION_NO_DETAILS', 'No property details extracted from message.', { bodyLength: body.length }, senderPhoneNumber, null, SERVICE_NAME);
            }
          } catch (extractionError) {
            logger.error('EXTRACTION_SAVE_ERROR', 'Error during property extraction or saving process.', 
                         { error: extractionError.message, stack: extractionError.stack }, 
                         senderPhoneNumber, null, SERVICE_NAME);
            if (!isGroup) {
              await message.reply('Ocurrió un error al procesar tu mensaje. Ya estamos trabajando en ello.');
            }
          }
          return; // Terminar procesamiento para mensajes de texto libre
        }

        // ---- PASO 3: Lógica diferenciada para GRUPOS y PRIVADOS ----
        if (isGroup) {
            // ---- LÓGICA PARA MENSAJES DE GRUPO ----
            logger.info('GROUP_MESSAGE_PROCESSING', `Processing group message from ${senderPushName} in group '${chat.name}'.`, { bodyLength: body.length }, senderPhoneNumber, null, SERVICE_NAME);
            
            const extractedPropertiesData = await extractPropertyDetailsFromMessage(body);

            if (extractedPropertiesData && extractedPropertiesData.length > 0) {
                logger.info('PROPERTY_EXTRACTION_SUCCESS_GROUP', `AI extracted ${extractedPropertiesData.length} prop(s) from group message.`, { count: extractedPropertiesData.length }, senderPhoneNumber, null, SERVICE_NAME);
                
                const [designatedSheetsDB] = await query('SELECT sheet_id FROM google_sheets WHERE is_property_log_sheet = TRUE LIMIT 1');
                let targetSheetId = process.env.GOOGLE_SHEET_ID;
                let targetSheetName = 'Propiedades';

                if (designatedSheetsDB && designatedSheetsDB.length > 0) {
                    targetSheetId = designatedSheetsDB[0].sheet_id;
                    try {
                        const sheetInfo = await getSheetInfo(targetSheetId);
                        if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                            targetSheetName = sheetInfo.sheets[0].title;
                        } else {
                            logger.error('DESIGNATED_SHEET_NO_TABS_GROUP', 'Hoja designada para grupo no tiene pestañas.', { targetSheetId });
                            throw new Error('Hoja designada (grupo) no tiene pestañas.');
                        }
                    } catch (e) { 
                        logger.error('DESIGNATED_SHEET_INFO_ERROR_GROUP', 'Error obteniendo info de hoja designada para grupo.', {targetSheetId, error: e.message}); 
                        throw e; // Re-lanzar para manejo de error superior
                    }
                } else {
                    logger.warn('DESIGNATED_SHEET_NOT_FOUND_DB_GROUP', 'No se encontró hoja designada para logs de grupo en DB. Usando fallback GOOGLE_SHEET_ID.', { fallbackSheetId: targetSheetId }, senderPhoneNumber, null, SERVICE_NAME);
                    if (!targetSheetId) { 
                        logger.error('MISSING_CONFIG_GROUP_SAVE', 'GOOGLE_SHEET_ID no configurado y no hay hoja designada.'); 
                        throw new Error('Configuración de Hoja de Google (grupo) incompleta.'); 
                    }
                    // Si usamos fallback de GOOGLE_SHEET_ID, igual intentamos obtener el nombre de su primera pestaña
                    try {
                        const sheetInfo = await getSheetInfo(targetSheetId);
                        if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                            targetSheetName = sheetInfo.sheets[0].title;
                        } else {
                            logger.error('FALLBACK_SHEET_NO_TABS_GROUP', 'Hoja de fallback para grupo no tiene pestañas.', { targetSheetId });
                            // Podríamos asignar un nombre por defecto aún más genérico o lanzar error
                            targetSheetName = 'Hoja1'; // Fallback ultra genérico si todo falla
                        }
                    } catch (e) { 
                        logger.error('FALLBACK_SHEET_INFO_ERROR_GROUP', 'Error obteniendo info de hoja de fallback para grupo.', {targetSheetId, error: e.message}); 
                         targetSheetName = 'Hoja1'; // Fallback ultra genérico si todo falla
                    }
                }
                logger.info('TARGET_SHEET_INFO_GROUP', `Sheet for group save: ID=${targetSheetId}, Name=${targetSheetName}`, { targetSheetId, targetSheetName });

                try {
                    const saveResult = await appendDataToSheet(
                        targetSheetId, targetSheetName, extractedPropertiesData, 
                        senderPushName || senderPhoneNumber, // Nombre del remitente original en el grupo
                        senderPhoneNumber // Número del remitente original
                    );
                    logger.info('PROPERTY_SAVE_GROUP_RESULT', `Save result for group: ${saveResult.message}`, { ...saveResult, group: chat.name }, senderPhoneNumber, null, SERVICE_NAME);
                    // No se envía respuesta al grupo para evitar spam.
                } catch (saveError) {
                    logger.error('PROPERTY_SAVE_FATAL_ERROR_GROUP', 'Fatal error saving prop from group.', { error: saveError.message }, senderPhoneNumber, null, SERVICE_NAME);
                }
            } else {
                logger.info('NO_PROPERTIES_EXTRACTED_GROUP', 'No properties extracted from group message.', {groupName: chat.name}, senderPhoneNumber, null, SERVICE_NAME);
            }

        } else { // ---- LÓGICA PARA MENSAJES PRIVADOS ----
            logger.info('PRIVATE_MESSAGE_PROCESSING', `Processing private message from ${senderPushName}.`, { bodyLength: body.length }, senderPhoneNumber, null, SERVICE_NAME);
            await message.react('⏳'); 

            const extractedPropertiesData = await extractPropertyDetailsFromMessage(body);

            if (extractedPropertiesData && extractedPropertiesData.length > 0) {
                logger.info('PROPERTY_EXTRACTION_SUCCESS_PRIVATE', `AI extracted ${extractedPropertiesData.length} prop(s) from private msg.`, { count: extractedPropertiesData.length }, senderPhoneNumber, null, SERVICE_NAME);
                
                const [designatedSheetsDB] = await query('SELECT sheet_id FROM google_sheets WHERE is_property_log_sheet = TRUE LIMIT 1');
                let targetSheetId = process.env.GOOGLE_SHEET_ID;
                let targetSheetName = 'Propiedades';

                if (designatedSheetsDB && designatedSheetsDB.length > 0) {
                    targetSheetId = designatedSheetsDB[0].sheet_id;
                    try {
                        const sheetInfo = await getSheetInfo(targetSheetId);
                        if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                            targetSheetName = sheetInfo.sheets[0].title;
                        } else {
                            logger.error('DESIGNATED_SHEET_NO_TABS_PRIVATE', 'Hoja designada para privado no tiene pestañas.', { targetSheetId });
                            throw new Error('Hoja designada (privado) no tiene pestañas.');
                        }
                    } catch (e) { 
                        logger.error('DESIGNATED_SHEET_INFO_ERROR_PRIVATE', 'Error obteniendo info de hoja designada para privado.', {targetSheetId, error: e.message}); 
                        throw e; // Re-lanzar para manejo de error superior
                    }
                } else {
                    logger.warn('DESIGNATED_SHEET_NOT_FOUND_DB_PRIVATE', 'No se encontró hoja designada para logs privados en DB. Usando fallback GOOGLE_SHEET_ID.', { fallbackSheetId: targetSheetId }, senderPhoneNumber, null, SERVICE_NAME);
                    if (!targetSheetId) { 
                        logger.error('MISSING_CONFIG_PRIVATE_SAVE', 'GOOGLE_SHEET_ID no configurado y no hay hoja designada.'); 
                        throw new Error('Configuración de Hoja de Google (privado) incompleta.'); 
                    }
                    // Si usamos fallback de GOOGLE_SHEET_ID, igual intentamos obtener el nombre de su primera pestaña
                     try {
                        const sheetInfo = await getSheetInfo(targetSheetId);
                        if (sheetInfo && sheetInfo.sheets && sheetInfo.sheets.length > 0) {
                            targetSheetName = sheetInfo.sheets[0].title;
                        } else {
                            logger.error('FALLBACK_SHEET_NO_TABS_PRIVATE', 'Hoja de fallback para privado no tiene pestañas.', { targetSheetId });
                            targetSheetName = 'Hoja1'; 
                        }
                    } catch (e) { 
                        logger.error('FALLBACK_SHEET_INFO_ERROR_PRIVATE', 'Error obteniendo info de hoja de fallback para privado.', {targetSheetId, error: e.message}); 
                        targetSheetName = 'Hoja1'; 
                    }
                }
                logger.info('TARGET_SHEET_INFO_PRIVATE', `Sheet for private save: ID=${targetSheetId}, Name=${targetSheetName}`, { targetSheetId, targetSheetName });

                try {
                    const saveResult = await appendDataToSheet(
                        targetSheetId, targetSheetName, extractedPropertiesData, 
                        senderPushName || senderPhoneNumber, 
                        senderPhoneNumber
                    );

                    if (saveResult.success) {
                        await message.reply('¡Entendido! Información procesada.'); 
                        await message.react('✅');
                    } else {
                        await message.reply(`Hubo problemas al procesar la información. ${saveResult.message || ''}`);
                        await message.react('⚠️');
                    }
                } catch (saveError) {
                    logger.error('PROPERTY_SAVE_FATAL_ERROR_PRIVATE', 'Fatal error saving prop from private.', { error: saveError.message }, senderPhoneNumber, null, SERVICE_NAME);
                    await message.reply('Lo siento, ocurrió un error crítico al guardar.');
                    await message.react('❌');
                }
            } else {
                logger.info('NO_PROPERTIES_EXTRACTED_PRIVATE', 'No properties extracted from private message. Processing as generic query.', {}, senderPhoneNumber, null, SERVICE_NAME);
                const genericResponse = await processUserQuery(body);
                await message.reply(genericResponse);
                await message.react('💡');
            }
        } // Fin del else (Lógica para mensajes privados)

      } catch (error) {
        logger.error('MESSAGE_PROCESSING_ERROR', 'Unhandled error processing message.', { error: error.message, stack: error.stack, messageBody: body, isGroup }, senderPhoneNumber, null, SERVICE_NAME);
        if (!isGroup) { 
            try { await message.reply('Lo siento, ocurrió un error inesperado.'); await message.react('❌'); } catch(e){/* ignore */}
        }
      }
    }); // Fin de client.on('message')

    // Inicializar el cliente
    logger.info('WHATSAPP_CLIENT_INITIALIZING', 'Initializing WhatsApp client...', {}, null, null, SERVICE_NAME);
    await client.initialize();
    logger.info('WHATSAPP_CLIENT_INITIALIZED_SUCCESS', 'WhatsApp client initialization process completed.', {}, null, null, SERVICE_NAME);
    
    return client;

  } catch (error) {
    logger.error('BOT_INIT_FATAL_ERROR', 'Fatal error during WhatsApp bot initialization.', { error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    isInitialized = false;
    client = null; // Asegurar que el cliente se limpie
    throw error; // Re-lanzar para que el proceso principal sepa que falló
  }
};

/**
 * Verifica si el bot está inicializado
 * @returns {boolean} - true si está inicializado, false si no
 */
const isBotInitialized = () => {
  return isInitialized;
};

/**
 * Verifica si un número de teléfono está autorizado para realizar consultas de propiedades.
 * @param {string} phoneNumber - Número de teléfono a verificar (sin @c.us).
 * @returns {Promise<boolean>} - true si está autorizado, false si no.
 */
const checkUserAuthorization = async (phoneNumber, isAdminCheck = false) => {
  const targetConfigKey = isAdminCheck ? 'ADMIN_USERS' : 'AUTHORIZED_USERS';
  logger.debug('AUTH_CHECK_START', `Checking authorization.`, { phoneNumber, targetConfigKey }, phoneNumber, null, SERVICE_NAME);
  try {
    // 1. Buscar al usuario y verificar si está activo
    const [users] = await query('SELECT id, role_id, is_active FROM whatsapp_users WHERE phone_number = ?', [phoneNumber]);

    if (!users || users.length === 0) {
      logger.warn('AUTH_CHECK_USER_NOT_FOUND', `User ${phoneNumber} not found in whatsapp_users.`, {}, phoneNumber, null, SERVICE_NAME);
      return false;
    }

    const user = users[0];
    if (!user.is_active) {
      logger.warn('AUTH_CHECK_USER_NOT_ACTIVE', `User ${phoneNumber} not active.`, {}, phoneNumber, null, SERVICE_NAME);
      return false;
    }

    const userRoleId = user.role_id; // Este role_id es de la tabla 'roles'.
    logger.info('AUTH_CHECK_USER_FOUND', `User ${phoneNumber} found. Role ID (de tabla roles): ${userRoleId}, Activo: ${user.is_active}`, { roleId: userRoleId, isActive: user.is_active }, phoneNumber, null, SERVICE_NAME);

    // 2. Verificar si el rol del usuario (de la tabla 'roles') tiene el permiso para consultar propiedades.
    // Se asume que la tabla 'role_permissions' une 'roles.id' con 'permissions.id'.
    // Y que la tabla 'permissions' tiene una columna 'name'.
    const requiredPermissionName = 'query_properties'; // Define el nombre del permiso necesario.
                                                        // ¡ASEGÚRATE DE QUE ESTE NOMBRE DE PERMISO EXISTA EN TU TABLA 'permissions'!

    // Consulta para verificar si el role_id (de la tabla 'roles') tiene el permiso requerido.
    // Confirmar nombres de tablas: 'role_permissions', 'permissions', 'roles'.
    // Confirmar nombres de columnas de unión: rp.role_id, rp.permission_id, p.id, r.id.
    // EJEMPLO: Si en role_permissions las columnas son FK_role_id y FK_permission_id, ajusta abajo.
    const sqlQuery = `
      SELECT rp.role_id
      FROM role_permissions rp
      JOIN permissions p ON rp.permission_id = p.id
      /* JOIN roles r ON rp.role_id = r.id */
      WHERE rp.role_id = ? AND p.name = ?
    `;
    // En la línea anterior, rp.role_id y rp.permission_id son los nombres de columna asumidos en la tabla 'role_permissions'.
    // ¡DEBES VERIFICAR ESTOS NOMBRES DE COLUMNA CON EL RESULTADO DE 'DESCRIBE role_permissions;'!
    
    logger.info(`AUTH_CHECK_EXECUTING_QUERY_PERMISSIONS`, `Executing query to check permissions for Role ID ${userRoleId} and Permission '${requiredPermissionName}`);
    const [permissionsResult] = await query(sqlQuery, [userRoleId, requiredPermissionName]);

    if (permissionsResult && permissionsResult.length > 0) {
      logger.info(`AUTH_CHECK_USER_AUTHORIZED`, `User ${phoneNumber} (Rol ID: ${userRoleId}) TIENE el permiso '${requiredPermissionName}'. Autorizado.`, { roleId: userRoleId, permissionName: requiredPermissionName }, phoneNumber, null, SERVICE_NAME);
      return true;
    } else {
      logger.warn(`AUTH_CHECK_USER_NOT_AUTHORIZED`, `User ${phoneNumber} (Rol ID: ${userRoleId}) NO tiene el permiso '${requiredPermissionName}'. NO Autorizado.`, { roleId: userRoleId, permissionName: requiredPermissionName }, phoneNumber, null, SERVICE_NAME);
      logger.info(`AUTH_CHECK_VERIFY_PERMISSIONS`, `Verify that:
1. The permission name ('${requiredPermissionName}') is correct in the 'permissions' table.
2. Exista una entrada en 'role_permissions' that links the Rol ID ${userRoleId} with the ID of the permission '${requiredPermissionName}'.`);
      return false;
    }
  } catch (dbError) {
    logger.error(`AUTH_CHECK_DB_ERROR`, `Database error during authorization check.`, { phoneNumber, targetConfigKey, error: dbError.message, stack: dbError.stack }, phoneNumber, null, SERVICE_NAME);
    return false; // En caso de error, denegar por seguridad.
  }
};

/**
 * Parsea una consulta de búsqueda para extraer criterios y determinar el siguiente paso.
 * @param {string} queryBody - El cuerpo del mensaje de consulta.
 * @returns {object|null} - Un objeto con { status, criteria } o null.
 *   status puede ser: 'VALID_QUERY', 'GUIDED_NEEDED'.
 *   criteria es { type, action, location }.
 */
const parseSearchQuery = (queryBody) => {
  const lowerBody = queryBody.toLowerCase();
  let criteria = { type: null, action: null, location: null };
  let intentDetected = false; // Para saber si el usuario quiere buscar algo

  // Palabras clave de intención de búsqueda
  const intentKeywords = ['busco', 'necesito', 'quiero', 'tienes', 'hay', 'ando buscando', 'me interesa', 'información sobre', 'propiedades en', 'listado de'];
  for (const keyword of intentKeywords) {
    if (lowerBody.includes(keyword)) {
      intentDetected = true;
      break;
    }
  }

  // Palabras clave para acciones
  const rentKeywords = ['arriendo', 'arrendar', 'alquilar', 'alquiler', 'renta', 'rentar'];
  const saleKeywords = ['venta', 'vender', 'comprar', 'compra', 'adquirir'];

  // Palabras clave para tipos (ejemplos, ¡EXPANDIR ESTAS LISTAS!)
  const propertyTypes = {
    // Normalizado: [sinónimos...]
    Departamento: ['departamento', 'depto', 'depa', 'apto', 'apartamento'],
    Casa: ['casa', 'chalet', 'vivienda', 'residencia'],
    Oficina: ['oficina', 'despacho'],
    Local: ['local comercial', 'local', 'tienda'],
    Terreno: ['terreno', 'sitio', 'parcela', 'lote'],
    Bodega: ['bodega', 'galpón', 'almacén'],
    Estacionamiento: ['estacionamiento', 'cochera', 'garage', 'parqueadero']
    // ¡AÑADIR MÁS TIPOS Y SINÓNIMOS AQUÍ SEGÚN NECESIDAD!
  };

  // Detectar acción
  for (const keyword of rentKeywords) {
    if (lowerBody.includes(keyword)) {
      criteria.action = 'Arriendo';
      intentDetected = true; // La acción implica intención
      break;
    }
  }
  if (!criteria.action) {
    for (const keyword of saleKeywords) {
      if (lowerBody.includes(keyword)) {
        criteria.action = 'Venta';
        intentDetected = true; // La acción implica intención
        break;
      }
    }
  }

  // Detectar tipo de propiedad
  for (const normalizedType in propertyTypes) {
    for (const keyword of propertyTypes[normalizedType]) {
      if (lowerBody.includes(keyword)) {
        criteria.type = normalizedType; // Usar el nombre normalizado
        intentDetected = true; // El tipo implica intención
        break;
      }
    }
    if (criteria.type) break;
  }

  // Detectar ubicación (¡EXPANDIR ESTA LISTA SIGNIFICATIVAMENTE!)
  // Considerar un enfoque más robusto para ubicaciones si es necesario (ej. normalización, regiones, etc.)
  const locations = [
    'las condes', 'providencia', 'ñuñoa', 'santiago centro', 'santiago', 'vitacura', 'lo barnechea', 
    'san miguel', 'macul', 'la florida', 'maipu', 'puente alto', 'quilicura', 'recoleta', 'independencia', 
    'la reina', 'peñalolen', 'la cisterna', 'estacion central', 'cerrillos', 'lo prado', 'pudahuel', 
    'conchali', 'huechuraba', 'quinta normal', 'lo espejo', 'pedro aguirre cerda', 'san joaquin', 'san ramon', 'el bosque'
    // ¡AÑADIR MÁS COMUNAS/CIUDADES/UBICACIONES RELEVANTES AQUÍ!
  ];
  for (const loc of locations) {
    if (lowerBody.includes(loc)) {
      // Capitalizar cada palabra de la ubicación encontrada
      criteria.location = loc.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      intentDetected = true; // La ubicación implica intención
      break;
    }
  }
  
  // Si no se detectó intención explícita, no es una consulta de búsqueda
  if (!intentDetected) {
    logger.info('QUERY_PARSE_NO_INTENTION', 'No search intention detected.', {}, null, null, SERVICE_NAME);
    return null; 
  }

  // Determinar el estado de la consulta
  // Se considera una consulta válida si tenemos al menos (acción Y ubicación) O (tipo Y ubicación) O (acción Y tipo)
  // O si tenemos los tres: acción, tipo y ubicación.
  // Esta lógica puede ajustarse según qué tan específicos queremos ser antes de buscar.
  const hasAction = !!criteria.action;
  const hasType = !!criteria.type;
  const hasLocation = !!criteria.location;

  // Si tenemos al menos dos de los tres criterios principales, es una consulta válida para buscar directamente.
  // O si tenemos al menos ubicación (podría ser suficiente para una búsqueda inicial si el usuario es vago)
  // Para conversación guiada, podríamos ser más estrictos y requerir que falte algo específico.
  if ((hasAction && hasType) || (hasAction && hasLocation) || (hasType && hasLocation) || (hasAction && hasType && hasLocation)) {
    logger.info('QUERY_VALID', 'Valid query detected.', { query: criteria }, null, null, SERVICE_NAME);
    return { status: 'VALID_QUERY', criteria };
  }
  
  // Si se detectó intención pero no suficientes criterios para una búsqueda directa, necesitamos guía.
  // Esto incluye casos donde solo tenemos un criterio (ej. solo tipo, o solo acción, o solo ubicación)
  // o incluso ningún criterio específico pero sí la intención de búsqueda.
  logger.info('QUERY_INTENTION_DETECTED', 'Intention detected, but missing criteria. Needs guide.', { query: criteria }, null, null, SERVICE_NAME);
  return { status: 'GUIDED_NEEDED', criteria };
};

/**
 * Envía un mensaje a un número específico
 * @param {string} to - Número de teléfono en formato WhatsApp (ej: 123456789@c.us)
 * @param {string} message - Mensaje a enviar
 */
const sendMessage = async (to, messageText) => {
  if (!client || !isInitialized) {
    logger.warn('SEND_MESSAGE_BOT_NOT_READY', 'Attempted to send message, but bot is not ready or client not initialized.', { to, messageLength: messageText.length }, null, null, SERVICE_NAME);
    return;
  }
  try {
    logger.debug('SEND_MESSAGE_ATTEMPT', 'Attempting to send WhatsApp message.', { to, messageLength: messageText.length }, to.replace(/@c\.us|@g\.us/g, ''), null, SERVICE_NAME);
    await client.sendMessage(to, messageText);
    logger.info('SEND_MESSAGE_SUCCESS', 'Message sent successfully.', { to, messageLength: messageText.length }, to.replace(/@c\.us|@g\.us/g, ''), null, SERVICE_NAME);
  } catch (error) {
    logger.error('SEND_MESSAGE_ERROR', 'Error sending WhatsApp message.', { to, messageText, error: error.message, stack: error.stack }, to.replace(/@c\.us|@g\.us/g, ''), null, SERVICE_NAME);
    // Consider re-throwing or specific handling
  }
};

/**
 * Obtiene una lista de todos los chats (individuales y grupos) a los que el bot tiene acceso.
 * @returns {Promise<Array<{id: string, name: string, isGroup: boolean}>>} - Una lista de objetos de chat.
 */
const getBotChats = async () => {
  try {
    if (!client || !isInitialized) {
      throw new Error('Cliente de WhatsApp no inicializado o no listo.');
    }

    const chats = await client.getChats();
    if (!chats) {
      console.log('No se pudieron obtener los chats.');
      return [];
    }

    console.log(`Se encontraron ${chats.length} chats.`);
    return chats.map(chat => ({
      id: chat.id._serialized,
      name: chat.name || (chat.isGroup ? 'Grupo sin nombre' : 'Chat sin nombre'),
      isGroup: chat.isGroup,
      // Puedes añadir más propiedades si las necesitas, por ejemplo:
      // unreadCount: chat.unreadCount,
      // lastMessage: chat.lastMessage ? chat.lastMessage.body : null
    }));
  } catch (error) {
    console.error('Error obteniendo los chats del bot:', error);
    throw error; // O retornar un array vacío o un objeto de error, según prefieras manejarlo
  }
};

// ---- FUNCIONES AUXILIARES PARA CONVERSACIÓN GUIADA ----

/**
 * Determina la siguiente pregunta a realizar o si la conversación está completa.
 * @param {object} criteria - Los criterios recolectados hasta ahora { type, action, location }.
 * @returns {string|null} - El nombre del criterio que falta ('type', 'action', 'location') o null si todo está completo.
 */
const getNextMissingCriteria = (criteria) => {
  if (!criteria.type) return 'type';
  if (!criteria.action) return 'action';
  if (!criteria.location) return 'location';
  return null; 
};

/**
 * Formula la pregunta para el criterio faltante.
 * @param {string} missingCriteria - El nombre del criterio faltante ('type', 'action', 'location').
 * @returns {string} - El texto de la pregunta.
 */
const formulateQuestionForCriteria = (missingCriteria) => {
  switch (missingCriteria) {
    case 'type':
      return '¿Qué tipo de propiedad buscas? (ej: Casa, Departamento, Oficina, Terreno, etc.)';
    case 'action':
      return '¿La propiedad es para Arriendo o Venta?';
    case 'location':
      return '¿En qué comuna o ubicación te interesa buscar?';
    default:
      return 'Hmm, creo que ya tenemos todo. ¡Vamos a buscar!';
  }
};

/**
 * Procesa la respuesta del usuario para un criterio esperado y actualiza el estado de la conversación.
 * @param {string} userResponseText - El texto de la respuesta del usuario.
 * @param {string} expectingCriteria - El criterio que se estaba esperando ('type', 'action', 'location').
 * @param {object} currentCriteria - El objeto de criterios actual.
 * @returns {boolean} - true si la respuesta fue válida para el criterio, false si no.
 */
const processResponseForCriteria = (userResponseText, expectingCriteria, currentCriteria) => {
  const lowerResponse = userResponseText.toLowerCase();
  const propertyTypes = { 
    Departamento: ['departamento', 'depto', 'depa', 'apto', 'apartamento'], Casa: ['casa', 'chalet', 'vivienda', 'residencia'], Oficina: ['oficina', 'despacho'], Local: ['local comercial', 'local', 'tienda'], Terreno: ['terreno', 'sitio', 'parcela', 'lote'], Bodega: ['bodega', 'galpón', 'almacén'], Estacionamiento: ['estacionamiento', 'cochera', 'garage', 'parqueadero'] 
  };
  const rentKeywords = ['arriendo', 'arrendar', 'alquilar', 'alquiler', 'renta', 'rentar'];
  const saleKeywords = ['venta', 'vender', 'comprar', 'compra', 'adquirir'];

  if (expectingCriteria === 'type') {
    for (const normalizedType in propertyTypes) {
      for (const keyword of propertyTypes[normalizedType]) {
        if (lowerResponse.includes(keyword)) { currentCriteria.type = normalizedType; return true; }
      }
    }
    return false;
  }
  if (expectingCriteria === 'action') {
    if (rentKeywords.some(k => lowerResponse.includes(k))) { currentCriteria.action = 'Arriendo'; return true; }
    if (saleKeywords.some(k => lowerResponse.includes(k))) { currentCriteria.action = 'Venta'; return true; }
    return false;
  }
  if (expectingCriteria === 'location') {
    if (userResponseText.trim().length > 1) { 
      currentCriteria.location = userResponseText.trim().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      return true;
    }
    return false; 
  }
  return false; 
};
// ---- FIN FUNCIONES AUXILIARES ----

// ---- NUEVA FUNCIÓN PARA MANEJAR BÚSQUEDA Y RESPUESTA ----
async function handlePropertySearch(message, criteria, senderPhoneNumber) {
  logger.info('HANDLE_SEARCH_START', 'Attempting to handle property search.', { senderPhoneNumber, criteria: JSON.stringify(criteria) }, senderPhoneNumber, null, SERVICE_NAME);
  try {
    const [designatedSheets] = await query('SELECT sheet_id FROM google_sheets WHERE is_property_log_sheet = TRUE LIMIT 1');
    if (!designatedSheets || designatedSheets.length === 0) { 
      await message.reply('Error: No estoy configurado para buscar propiedades en este momento.'); 
      return; 
    }
    const designatedSheetId = designatedSheets[0].sheet_id;
    const sheetInfo = await getSheetInfo(designatedSheetId);
    if (!sheetInfo || !sheetInfo.sheets || !sheetInfo.sheets.length === 0) { 
      await message.reply('Error: Hubo un problema al acceder a los datos de propiedades.'); 
      return; 
    }
    const targetSheetName = sheetInfo.sheets[0].title;
    
    const propertiesFound = await searchPropertiesInSheet(designatedSheetId, targetSheetName, criteria);

    if (propertiesFound && propertiesFound.length > 0) {
      let responseText = '¡Hola! Encontré estas propiedades (' + propertiesFound.length + ') que podrían interesarte según tu búsqueda (';
      responseText += (criteria.type || 'cualquier tipo') + ' para ' + (criteria.action || 'cualquier acción') + ' en ' + (criteria.location || 'cualquier ubicación') + '):\n\n';
      
      propertiesFound.slice(0, 5).forEach((prop, index) => { 
        responseText += (index + 1) + '. ' + (prop.tipoPropiedad || 'Propiedad') + ' (' + (prop.tipoOperacion || 'N/E') + ')\n'; 
        responseText += '   Ubic.: ' + (prop.ubicacion || 'N/E') + '\n';
        if (prop.precio) responseText += '   Precio: ' + prop.precio + '\n';
        if (prop.dormitorios && prop.dormitorios !== 'N/A') responseText += '   Dorms: ' + prop.dormitorios + '\n';
        if (prop.banos && prop.banos !== 'N/A') responseText += '   Baños: ' + prop.banos + '\n';
        responseText += '   (Ref UID: ' + prop.uniqueId + ')\n\n';
      });
      if (propertiesFound.length > 5) {
        responseText += '... y ' + (propertiesFound.length - 5) + ' más.\n';
      }
      responseText += 'Si alguna te interesa, puedes pedir más detalles mencionando el UID o el número de la lista.';
      await message.reply(responseText);
    } else {
      let noResultsMessage = 'Lo siento, no encontré propiedades para: ';
      noResultsMessage += (criteria.type || 'cualquier tipo') + ' ';
      noResultsMessage += (criteria.action || '') + ' en ';
      noResultsMessage += (criteria.location || 'cualquier lugar') + '. ¿Quieres intentar con otros criterios?';
      await message.reply(noResultsMessage);
    }
  } catch (searchError) {
    logger.error('HANDLE_SEARCH_ERROR', 'Error during property search.', { error: searchError.message, stack: searchError.stack }, senderPhoneNumber, null, SERVICE_NAME);
    await message.reply('Hubo un error al buscar. Intenta más tarde.');
  }
}

module.exports = {
  initWhatsAppBot,
  isBotInitialized,
  sendMessage,
  getBotChats
}; 