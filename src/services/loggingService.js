const { query } = require('../config/database');

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

/**
 * Logs a message to the console and to the bot_activity_log table.
 *
 * @param {string} level - The severity level of the log (e.g., INFO, WARN, ERROR).
 * @param {string} event_type - A specific type for the event (e.g., 'GOOGLE_SHEET_API_ERROR').
 * @param {string} message - The main log message.
 * @param {object} [details={}] - Optional. An object containing additional structured data.
 * @param {string} [user_phone=null] - Optional. The user's phone number if relevant.
 * @param {string} [unique_id_related=null] - Optional. A related UniqueID if relevant.
 * @param {string} [service_component=null] - Optional. The service or component originating the log.
 */
async function log(level, event_type, message, details = {}, user_phone = null, unique_id_related = null, service_component = null) {
  const timestamp = new Date();
  const formattedTimestamp = timestamp.toISOString().slice(0, 19).replace('T', ' ');

  // Console logging
  let consoleMessage = `[${formattedTimestamp}][${level}][${service_component || 'App'}][${event_type}] ${message}`;
  if (Object.keys(details).length > 0) {
    consoleMessage += ` | Details: ${JSON.stringify(details)}`;
  }
  if (user_phone) {
    consoleMessage += ` | User: ${user_phone}`;
  }
  if (unique_id_related) {
    consoleMessage += ` | UniqueID: ${unique_id_related}`;
  }

  switch (level) {
    case LOG_LEVELS.ERROR:
    case LOG_LEVELS.CRITICAL:
      console.error(consoleMessage);
      break;
    case LOG_LEVELS.WARN:
      console.warn(consoleMessage);
      break;
    case LOG_LEVELS.DEBUG:
      console.debug(consoleMessage);
      break;
    case LOG_LEVELS.INFO:
    default:
      console.log(consoleMessage);
      break;
  }

  // Database logging
  try {
    const sql = 'INSERT INTO bot_activity_log (timestamp, event_type, level, message, details, user_phone, unique_id_related, service_component) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    await query(sql, [
      timestamp, // Store as full JS Date object, MySQL will handle conversion
      event_type,
      level,
      message,
      Object.keys(details).length > 0 ? JSON.stringify(details) : null,
      user_phone,
      unique_id_related,
      service_component
    ]);
  } catch (dbError) {
    console.error(`[LoggingService] CRITICAL_DB_LOG_FAILURE: Failed to write log to database. Original log: ${consoleMessage} | DB Error:`, dbError);
    // Consider a fallback notification if DB logging fails consistently for critical errors
    if (level === LOG_LEVELS.CRITICAL || event_type === 'DB_CONNECTION_ERROR') {
        // Avoid circular dependency if notificationService itself uses loggingService for all logs
        // For now, just a console error. A more robust solution might be a direct, simple notifier here.
    }
  }
}

// Helper functions for each log level
const logger = {
  debug: (event_type, message, details, user_phone, unique_id_related, service_component) => 
    log(LOG_LEVELS.DEBUG, event_type, message, details, user_phone, unique_id_related, service_component),
  info: (event_type, message, details, user_phone, unique_id_related, service_component) => 
    log(LOG_LEVELS.INFO, event_type, message, details, user_phone, unique_id_related, service_component),
  warn: (event_type, message, details, user_phone, unique_id_related, service_component) => 
    log(LOG_LEVELS.WARN, event_type, message, details, user_phone, unique_id_related, service_component),
  error: (event_type, message, details, user_phone, unique_id_related, service_component) => 
    log(LOG_LEVELS.ERROR, event_type, message, details, user_phone, unique_id_related, service_component),
  critical: (event_type, message, details, user_phone, unique_id_related, service_component) => 
    log(LOG_LEVELS.CRITICAL, event_type, message, details, user_phone, unique_id_related, service_component),
};

module.exports = {
  logger,
  LOG_LEVELS // Exporting for use in other modules if needed for comparisons
}; 