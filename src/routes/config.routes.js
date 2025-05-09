const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database'); // Asumiendo que tienes tu helper de DB aquí
const { checkPermissions } = require('../middleware/authMiddleware'); // Asumiendo middleware de permisos
const crypto = require('crypto');

const router = express.Router();

const ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY; // Debe ser una clave de 32 bytes para AES-256
const IV_LENGTH = 16; // For AES, this is always 16

// Función para encriptar
function encrypt(text) {
  if (!ENCRYPTION_KEY) {
    console.warn('APP_ENCRYPTION_KEY no está definida. La API Key se guardará sin encriptar.');
    return text; // Guardar sin encriptar si no hay clave de encriptación
  }
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (error) {
    console.error('Error encriptando:', error);
    // En un caso real, podrías querer manejar esto de forma más robusta
    return text; // Fallback a guardar sin encriptar en caso de error de encriptación
  }
}

// Función para desencriptar
function decrypt(text) {
  if (!ENCRYPTION_KEY || !text.includes(':')) {
    // Si no hay clave de encriptación o el texto no parece encriptado, devolver como está
    return text;
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
    console.error('Error desencriptando (podría ser texto plano):', error.message);
    return text; // Devolver el texto original si falla la desencriptación (podría ser texto plano)
  }
}

// Ruta para obtener el estado de la API Key de Gemini
router.get('/gemini-api-key', /* checkPermissions('manage_settings'), */ async (req, res, next) => {
  try {
    const [configRows] = await query('SELECT config_value FROM app_config WHERE config_key = ?', ['GEMINI_API_KEY']);
    let apiKeyStatus = 'Not Configured';
    let apiKeyDisplay = '';

    if (configRows.length > 0) {
      const decryptedApiKey = decrypt(configRows[0].config_value);
      if (decryptedApiKey) {
        apiKeyStatus = 'Configured';
        apiKeyDisplay = `********${decryptedApiKey.slice(-4)}`; // Mostrar solo los últimos 4 caracteres
      }
    }
    res.json({ status: apiKeyStatus, display: apiKeyDisplay });
  } catch (error) {
    next(error);
  }
});

// Ruta para guardar/actualizar la API Key de Gemini
router.post(
  '/gemini-api-key',
  /* checkPermissions('manage_settings'), */
  [body('gemini_api_key', 'Gemini API Key is required').notEmpty().trim()],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { gemini_api_key } = req.body;
      const encryptedApiKey = encrypt(gemini_api_key);

      // Usar INSERT ... ON DUPLICATE KEY UPDATE para crear o actualizar
      await query(
        'INSERT INTO app_config (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = ?',
        ['GEMINI_API_KEY', encryptedApiKey, encryptedApiKey]
      );

      res.json({ message: 'Gemini API Key updated successfully.' });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router; 