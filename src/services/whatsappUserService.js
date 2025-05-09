const { query } = require('../config/database');
const { logger } = require('./loggingService');

const SERVICE_NAME = 'WhatsappUserService';

/**
 * Verificar si un número de teléfono está autorizado para usar el bot
 * @param {string} phoneNumber - Número de teléfono con formato internacional
 * @returns {Promise<Object>} - Objeto con información de autorización
 */
const verifyUserAccess = async (phoneNumber) => {
  try {
    // Normalizar el número de teléfono (eliminar espacios, etc.)
    const normalizedPhone = phoneNumber.trim().replace(/\s+/g, '');
    
    // Buscar el usuario
    const [users] = await query(
      `SELECT wu.*, wr.max_daily_messages, wr.max_monthly_messages, wr.name as role_name
       FROM whatsapp_users wu
       LEFT JOIN whatsapp_roles wr ON wu.role_id = wr.id
       WHERE wu.phone_number = ?`,
      [normalizedPhone]
    );
    
    // Si no existe el usuario, denegar acceso
    if (users.length === 0) {
      return {
        authorized: false,
        reason: 'user_not_found',
        message: 'Su número no está autorizado para usar este servicio'
      };
    }
    
    const user = users[0];
    
    // Verificar si el usuario está activo
    if (!user.is_active) {
      return {
        authorized: false,
        reason: 'user_inactive',
        message: 'Su cuenta está desactivada. Contacte al administrador'
      };
    }
    
    // Verificar si la cuenta ha expirado
    if (user.valid_until && new Date(user.valid_until) < new Date()) {
      return {
        authorized: false,
        reason: 'subscription_expired',
        message: 'Su suscripción ha expirado. Contacte al administrador para renovarla'
      };
    }
    
    // Verificar límite diario de mensajes
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Si es un nuevo día, reiniciar contador diario
    if (user.last_message_date !== today) {
      // Reiniciar contador diario
      await query(
        'UPDATE whatsapp_users SET daily_message_count = 0, last_message_date = ? WHERE id = ?',
        [today, user.id]
      );
      
      // Actualizar objeto local
      user.daily_message_count = 0;
      user.last_message_date = today;
    }
    
    // Verificar límite diario
    if (user.max_daily_messages !== null && user.daily_message_count >= user.max_daily_messages) {
      return {
        authorized: false,
        reason: 'daily_limit_exceeded',
        message: `Ha alcanzado el límite diario de ${user.max_daily_messages} mensajes`
      };
    }
    
    // Verificar límite mensual (podría ser implementado de manera similar)
    // Por simplicidad, no se implementa aquí
    
    // El usuario está autorizado
    return {
      authorized: true,
      user: {
        id: user.id,
        phoneNumber: user.phone_number,
        name: user.name,
        role: user.role_name,
        dailyLimit: user.max_daily_messages,
        dailyCount: user.daily_message_count,
        monthlyLimit: user.max_monthly_messages,
        monthlyCount: user.monthly_message_count,
        validUntil: user.valid_until
      }
    };
  } catch (error) {
    logger.error(`Error verifying WhatsApp user access: ${error.message}`);
    // En caso de error, permitir acceso para evitar bloqueos por fallas técnicas
    return {
      authorized: false,
      reason: 'system_error',
      message: 'Error del sistema. Intente más tarde o contacte al soporte'
    };
  }
};

/**
 * Incrementar el contador de mensajes para un usuario
 * @param {number} userId - ID del usuario de WhatsApp
 * @returns {Promise<boolean>} - true si se incrementó correctamente
 */
const incrementMessageCount = async (userId) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Incrementar contador diario
    await query(
      `UPDATE whatsapp_users 
       SET daily_message_count = daily_message_count + 1,
           monthly_message_count = monthly_message_count + 1,
           last_message_date = ?
       WHERE id = ?`,
      [today, userId]
    );
    
    // Registrar uso para estadísticas
    await query(
      `INSERT INTO whatsapp_message_usage (whatsapp_user_id, message_date)
       VALUES (?, ?)`,
      [userId, today]
    );
    
    return true;
  } catch (error) {
    logger.error(`Error incrementing message count: ${error.message}`);
    return false;
  }
};

/**
 * Crear o actualizar un usuario de WhatsApp
 * @param {Object} userData - Datos del usuario
 * @returns {Promise<Object>} - Usuario creado o actualizado
 */
const createOrUpdateUser = async (userData) => {
  try {
    const { phoneNumber, name, email, roleId, isActive, validUntil } = userData;
    
    // Normalizar el número de teléfono
    const normalizedPhone = phoneNumber.trim().replace(/\s+/g, '');
    
    // Verificar si el usuario ya existe
    const [existingUsers] = await query(
      'SELECT * FROM whatsapp_users WHERE phone_number = ?',
      [normalizedPhone]
    );
    
    // Formatear fecha de validez si existe
    let formattedValidUntil = null;
    if (validUntil) {
      formattedValidUntil = new Date(validUntil).toISOString().split('T')[0];
    } else if (roleId) {
      // Si no se proporciona fecha pero sí un rol, calcular basado en el rol
      const [roles] = await query(
        'SELECT valid_until_days FROM whatsapp_roles WHERE id = ?',
        [roleId]
      );
      
      if (roles.length > 0 && roles[0].valid_until_days) {
        const date = new Date();
        date.setDate(date.getDate() + roles[0].valid_until_days);
        formattedValidUntil = date.toISOString().split('T')[0];
      }
    }
    
    if (existingUsers.length > 0) {
      // Actualizar usuario existente
      const userId = existingUsers[0].id;
      
      let updateQuery = 'UPDATE whatsapp_users SET ';
      const updateParams = [];
      const updateFields = [];
      
      if (name !== undefined) {
        updateFields.push('name = ?');
        updateParams.push(name);
      }
      
      if (email !== undefined) {
        updateFields.push('email = ?');
        updateParams.push(email);
      }
      
      if (roleId !== undefined) {
        updateFields.push('role_id = ?');
        updateParams.push(roleId);
      }
      
      if (isActive !== undefined) {
        updateFields.push('is_active = ?');
        updateParams.push(isActive ? 1 : 0);
      }
      
      if (formattedValidUntil !== null) {
        updateFields.push('valid_until = ?');
        updateParams.push(formattedValidUntil);
      }
      
      if (updateFields.length === 0) {
        return existingUsers[0]; // No hay cambios para actualizar
      }
      
      updateQuery += updateFields.join(', ') + ' WHERE id = ?';
      updateParams.push(userId);
      
      await query(updateQuery, updateParams);
      
      // Obtener usuario actualizado
      const [updatedUsers] = await query(
        'SELECT * FROM whatsapp_users WHERE id = ?',
        [userId]
      );
      
      return updatedUsers[0];
    } else {
      // Crear nuevo usuario
      const [result] = await query(
        `INSERT INTO whatsapp_users 
         (phone_number, name, email, role_id, is_active, valid_until) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          normalizedPhone,
          name || null,
          email || null,
          roleId || 1, // Rol básico por defecto
          isActive !== undefined ? (isActive ? 1 : 0) : 1,
          formattedValidUntil
        ]
      );
      
      // Obtener usuario creado
      const [newUsers] = await query(
        'SELECT * FROM whatsapp_users WHERE id = ?',
        [result.insertId]
      );
      
      return newUsers[0];
    }
  } catch (error) {
    logger.error(`Error creating/updating WhatsApp user: ${error.message}`);
    throw error;
  }
};

/**
 * Obtener todos los roles de WhatsApp
 * @returns {Promise<Array>} - Lista de roles
 */
const getAllRoles = async () => {
  try {
    const [roles] = await query('SELECT * FROM whatsapp_roles ORDER BY id');
    return roles;
  } catch (error) {
    logger.error(`Error getting WhatsApp roles: ${error.message}`);
    throw error;
  }
};

/**
 * Obtener todos los usuarios de WhatsApp
 * @returns {Promise<Array>} - Lista de usuarios
 */
const getAllUsers = async () => {
  logger.debug('GET_ALL_USERS_START', 'Attempting to fetch all WhatsApp users.', {}, null, null, SERVICE_NAME);
  try {
    const [users] = await query(
      `SELECT wu.id, wu.phone_number, wu.name as user_name, wu.email, wu.is_active, wu.valid_until, 
              wu.daily_message_count, wu.monthly_message_count, wu.last_message_date, 
              wr.id as role_id, wr.name as role_name 
       FROM whatsapp_users wu 
       LEFT JOIN whatsapp_roles wr ON wu.role_id = wr.id 
       ORDER BY wu.id ASC`
    );
    logger.info('GET_ALL_USERS_SUCCESS', `Successfully fetched ${users.length} users.`, { count: users.length }, null, null, SERVICE_NAME);
    return users;
  } catch (error) {
    logger.error('GET_ALL_USERS_DB_ERROR', 'Database error while fetching all users.', { error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    throw error; // O retornar un arreglo vacío: return [];
  }
};

/**
 * Obtener un usuario de WhatsApp por ID
 * @param {number} userId - ID del usuario
 * @returns {Promise<Object>} - Usuario
 */
const getUserById = async (userId) => {
  logger.debug('GET_USER_BY_ID_START', 'Attempting to fetch user by ID.', { userId }, null, null, SERVICE_NAME);
  if (!userId) {
    logger.warn('GET_USER_BY_ID_INVALID', 'User ID not provided.', {}, null, null, SERVICE_NAME);
    return null;
  }
  try {
    const [users] = await query(
      `SELECT wu.id, wu.phone_number, wu.name as user_name, wu.email, wu.is_active, wu.valid_until, 
              wu.daily_message_count, wu.monthly_message_count, wu.last_message_date, 
              wr.id as role_id, wr.name as role_name 
       FROM whatsapp_users wu 
       LEFT JOIN whatsapp_roles wr ON wu.role_id = wr.id 
       WHERE wu.id = ?`,
      [userId]
    );
    if (users.length > 0) {
      logger.info('GET_USER_BY_ID_SUCCESS', 'Successfully fetched user by ID.', { userId, userName: users[0].user_name }, null, null, SERVICE_NAME);
      return users[0];
    }
    logger.warn('GET_USER_BY_ID_NOT_FOUND', 'User not found by ID.', { userId }, null, null, SERVICE_NAME);
    return null;
  } catch (error) {
    logger.error('GET_USER_BY_ID_DB_ERROR', 'Database error while fetching user by ID.', { userId, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    throw error;
  }
};

/**
 * Obtener un usuario de WhatsApp por número de teléfono
 * @param {string} phoneNumber - Número de teléfono
 * @returns {Promise<Object>} - Usuario
 */
const getUserByPhoneNumber = async (phoneNumber) => {
  const normalizedPhone = phoneNumber.trim().replace(/\s+/g, '');
  logger.debug('GET_USER_BY_PHONE_START', 'Attempting to fetch user by phone number.', { normalizedPhone }, null, null, SERVICE_NAME);
  if (!normalizedPhone) {
    logger.warn('GET_USER_BY_PHONE_INVALID', 'Phone number not provided.', {}, null, null, SERVICE_NAME);
    return null;
  }
  try {
    const [users] = await query(
      `SELECT wu.id, wu.phone_number, wu.name as user_name, wu.email, wu.is_active, wu.valid_until, 
              wu.daily_message_count, wu.monthly_message_count, wu.last_message_date, 
              wr.id as role_id, wr.name as role_name 
       FROM whatsapp_users wu 
       LEFT JOIN whatsapp_roles wr ON wu.role_id = wr.id 
       WHERE wu.phone_number = ?`,
      [normalizedPhone]
    );
    if (users.length > 0) {
      logger.info('GET_USER_BY_PHONE_SUCCESS', 'Successfully fetched user by phone number.', { normalizedPhone, userName: users[0].user_name }, null, null, SERVICE_NAME);
      return users[0];
    }
    logger.warn('GET_USER_BY_PHONE_NOT_FOUND', 'User not found by phone number.', { normalizedPhone }, null, null, SERVICE_NAME);
    return null;
  } catch (error) {
    logger.error('GET_USER_BY_PHONE_DB_ERROR', 'Database error while fetching user by phone number.', { normalizedPhone, error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    throw error;
  }
};

/**
 * Elimina un usuario de WhatsApp por su ID.
 * @param {number} userId - El ID del usuario a eliminar.
 * @returns {Promise<boolean>} - true si se eliminó correctamente, false en caso contrario.
 */
const deleteUser = async (userId) => {
  logger.info('DELETE_USER_ATTEMPT', `Attempting to delete user by ID: ${userId}.`, { userId }, null, String(userId), SERVICE_NAME);
  if (!userId || isNaN(parseInt(userId))) {
    logger.warn('DELETE_USER_INVALID_ID', 'User ID not provided or invalid for deletion.', { userIdReceived: userId }, null, String(userId), SERVICE_NAME);
    return false;
  }

  try {
    const [result] = await query('DELETE FROM whatsapp_users WHERE id = ?', [parseInt(userId)]);
    
    if (result.affectedRows > 0) {
      logger.info('DELETE_USER_SUCCESS', `Successfully deleted user.`, { userId, affectedRows: result.affectedRows }, null, String(userId), SERVICE_NAME);
      return true;
    } else {
      logger.warn('DELETE_USER_NOT_FOUND_OR_NO_CHANGE', `User not found for deletion, or no change needed (already deleted).`, { userId, affectedRows: result.affectedRows }, null, String(userId), SERVICE_NAME);
      return false; // No se encontró el usuario o no se eliminaron filas
    }
  } catch (error) {
    logger.error('DELETE_USER_DB_ERROR', `Database error while deleting user.`, { userId, error: error.message, stack: error.stack }, null, String(userId), SERVICE_NAME);
    return false;
  }
};

module.exports = {
  verifyUserAccess,
  incrementMessageCount,
  createOrUpdateUser,
  getAllRoles,
  getAllUsers,
  getUserById,
  getUserByPhoneNumber,
  deleteUser
}; 