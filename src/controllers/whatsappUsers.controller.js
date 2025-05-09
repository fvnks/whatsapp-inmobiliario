const whatsappUserService = require('../services/whatsappUserService');
const logger = require('../utils/logger');

// Definir nombre del servicio para el logging
const SERVICE_NAME = 'WhatsappUsersController';

/**
 * Obtener todos los usuarios de WhatsApp
 */
const getAllWhatsappUsers = async (req, res) => {
  try {
    const users = await whatsappUserService.getAllUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    logger.error(`Error in getAllWhatsappUsers: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener usuarios de WhatsApp',
      error: error.message 
    });
  }
};

/**
 * Obtener un usuario de WhatsApp por ID
 */
const getWhatsappUserById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID de usuario es requerido' 
      });
    }
    
    const user = await whatsappUserService.getUserById(id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuario de WhatsApp no encontrado' 
      });
    }
    
    res.json({ success: true, data: user });
  } catch (error) {
    logger.error(`Error in getWhatsappUserById: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener usuario de WhatsApp',
      error: error.message 
    });
  }
};

/**
 * Crear un nuevo usuario de WhatsApp
 */
const createWhatsappUser = async (req, res) => {
  try {
    const { phoneNumber, name, email, roleId, isActive, validUntil } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Número de teléfono es requerido' 
      });
    }
    
    // Verificar si ya existe un usuario con ese número
    const existingUser = await whatsappUserService.getUserByPhoneNumber(phoneNumber);
    
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'Ya existe un usuario con ese número de teléfono' 
      });
    }
    
    const newUser = await whatsappUserService.createOrUpdateUser({
      phoneNumber,
      name,
      email,
      roleId,
      isActive,
      validUntil
    });
    
    res.status(201).json({ 
      success: true, 
      message: 'Usuario de WhatsApp creado exitosamente',
      data: newUser 
    });
  } catch (error) {
    logger.error(`Error in createWhatsappUser: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error al crear usuario de WhatsApp',
      error: error.message 
    });
  }
};

/**
 * Actualizar un usuario de WhatsApp
 */
const updateWhatsappUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { phoneNumber, name, email, roleId, isActive, validUntil } = req.body;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID de usuario es requerido' 
      });
    }
    
    // Verificar si el usuario existe
    const existingUser = await whatsappUserService.getUserById(id);
    
    if (!existingUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuario de WhatsApp no encontrado' 
      });
    }
    
    // Si se intenta cambiar el número, verificar que no exista otro usuario con ese número
    if (phoneNumber && phoneNumber !== existingUser.phone_number) {
      const userWithSamePhone = await whatsappUserService.getUserByPhoneNumber(phoneNumber);
      
      if (userWithSamePhone && userWithSamePhone.id !== parseInt(id)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Ya existe otro usuario con ese número de teléfono' 
        });
      }
    }
    
    const updatedUser = await whatsappUserService.createOrUpdateUser({
      id,
      phoneNumber: phoneNumber || existingUser.phone_number,
      name,
      email,
      roleId,
      isActive,
      validUntil
    });
    
    res.json({ 
      success: true, 
      message: 'Usuario de WhatsApp actualizado exitosamente',
      data: updatedUser 
    });
  } catch (error) {
    logger.error(`Error in updateWhatsappUser: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error al actualizar usuario de WhatsApp',
      error: error.message 
    });
  }
};

/**
 * Obtener todos los roles de WhatsApp
 */
const getAllRoles = async (req, res) => {
  try {
    const roles = await whatsappUserService.getAllRoles();
    res.json({ success: true, data: roles });
  } catch (error) {
    logger.error(`Error in getAllRoles: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error al obtener roles de WhatsApp',
      error: error.message 
    });
  }
};

/**
 * Eliminar un usuario de WhatsApp
 */
const deleteWhatsappUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID de usuario es requerido' 
      });
    }
    
    // Verificar si el usuario existe
    const existingUser = await whatsappUserService.getUserById(id);
    
    if (!existingUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'Usuario de WhatsApp no encontrado' 
      });
    }
    
    // Eliminar el usuario
    const deleted = await whatsappUserService.deleteUser(id);
    
    if (!deleted) {
      return res.status(500).json({ 
        success: false, 
        message: 'No se pudo eliminar el usuario' 
      });
    }
    
    // Registrar la acción
    logger.info(
      'USER_DELETED',
      `Usuario de WhatsApp eliminado: ${existingUser.phone_number}`,
      { userId: id, phoneNumber: existingUser.phone_number },
      req.user ? req.user.id : null,
      req.ip,
      SERVICE_NAME
    );
    
    res.json({ 
      success: true, 
      message: 'Usuario de WhatsApp eliminado exitosamente' 
    });
  } catch (error) {
    logger.error(`Error in deleteWhatsappUser: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: 'Error al eliminar usuario de WhatsApp',
      error: error.message 
    });
  }
};

module.exports = {
  getAllWhatsappUsers,
  getWhatsappUserById,
  createWhatsappUser,
  updateWhatsappUser,
  getAllRoles,
  deleteWhatsappUser
}; 