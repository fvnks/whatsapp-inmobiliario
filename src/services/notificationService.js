const { query } = require('../config/database');
const whatsappBot = require('./whatsappBot'); // Import a la instancia o funciones necesarias
const { logger } = require('./loggingService'); // Importar el logger

const SERVICE_NAME = 'NotificationService';

let adminWhatsAppNumber = null;
let lastAdminNumberCheck = 0;
const ADMIN_NUMBER_CACHE_DURATION = 5 * 60 * 1000; // 5 minutos en milisegundos

/**
 * Obtiene el número de WhatsApp del administrador desde la base de datos (con caché).
 * @returns {Promise<string|null>} - El número de WhatsApp del administrador o null si no está configurado.
 */
async function getAdminWhatsAppNumber() {
  const now = Date.now();
  if (adminWhatsAppNumber && (now - lastAdminNumberCheck < ADMIN_NUMBER_CACHE_DURATION)) {
    return adminWhatsAppNumber;
  }

  try {
    const [configRows] = await query('SELECT config_value FROM app_config WHERE config_key = ?', ['ADMIN_WHATSAPP_NUMBER']);
    if (configRows.length > 0 && configRows[0].config_value) {
      adminWhatsAppNumber = configRows[0].config_value;
      lastAdminNumberCheck = now;
      logger.info('ADMIN_NUMBER_LOADED', 'Admin WhatsApp number loaded/refreshed.', { adminNumber: adminWhatsAppNumber }, null, null, SERVICE_NAME);
      return adminWhatsAppNumber;
    } else {
      logger.warn('ADMIN_NUMBER_NOT_FOUND', 'ADMIN_WHATSAPP_NUMBER not found in app_config.', {}, null, null, SERVICE_NAME);
      adminWhatsAppNumber = null; // Resetear si ya no está
      return null;
    }
  } catch (error) {
    logger.error('ADMIN_NUMBER_DB_ERROR', 'Error fetching ADMIN_WHATSAPP_NUMBER from database.', { error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    // Mantener el número cacheado anterior si hay un error de DB para no interrumpir notificaciones si la DB falla temporalmente
    return adminWhatsAppNumber; 
  }
}

/**
 * Envía un mensaje de notificación al administrador.
 * @param {string} originalMessageText - El texto del mensaje a enviar.
 * @param {string} eventTypeForLog - El tipo de evento para el log, ej: 'GOOGLE_SHEET_ERROR_ALERT'
 */
async function sendAdminNotification(originalMessageText, eventTypeForLog = 'GENERIC_ADMIN_ALERT') {
  const messageText = `🔔 ALERTA DEL BOT:\n\n${originalMessageText}`;
  if (!whatsappBot.isBotInitialized()) {
    logger.warn('ADMIN_NOTIFY_BOT_NOT_INIT', 'Attempted to send admin notification, but WhatsApp bot is not initialized.', { messageAttempted: originalMessageText }, null, null, SERVICE_NAME);
    return;
  }

  const adminNumber = await getAdminWhatsAppNumber();
  if (adminNumber) {
    try {
      logger.info(eventTypeForLog, `Attempting to send admin notification.`, { adminNumber, messageContent: originalMessageText }, null, null, SERVICE_NAME);
      await whatsappBot.sendMessage(adminNumber, messageText);
      logger.info('ADMIN_NOTIFY_SUCCESS', 'Admin notification sent successfully.', { adminNumber, messageContent: originalMessageText }, null, null, SERVICE_NAME);
    } catch (error) {
      logger.error('ADMIN_NOTIFY_SEND_ERROR', 'Failed to send admin notification.', { adminNumber, messageAttempted: originalMessageText, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    }
  } else {
    logger.warn('ADMIN_NOTIFY_NO_NUMBER', 'Cannot send admin notification because admin number is not configured or fetchable.', { messageAttempted: originalMessageText }, null, null, SERVICE_NAME);
  }
}

module.exports = {
  sendAdminNotification,
  getAdminWhatsAppNumber // Podría ser útil para verificar la configuración
}; 