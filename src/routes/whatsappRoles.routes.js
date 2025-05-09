const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { body, validationResult } = require('express-validator');
const { checkPermissions } = require('../middleware/authMiddleware');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

/**
 * @route GET /api/whatsapp-roles
 * @desc Obtener todos los roles de WhatsApp
 * @access Public (temporalmente)
 */
router.get('/', async (req, res, next) => {
  try {
    const [roles] = await query('SELECT * FROM whatsapp_roles ORDER BY id');
    
    res.json({
      success: true,
      data: roles
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/whatsapp-roles/:id
 * @desc Obtener un rol de WhatsApp por ID
 * @access Public (temporalmente)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const roleId = req.params.id;
    
    const [roles] = await query('SELECT * FROM whatsapp_roles WHERE id = ?', [roleId]);
    
    if (roles.length === 0) {
      throw new NotFoundError('Rol no encontrado');
    }
    
    res.json({
      success: true,
      data: roles[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/whatsapp-roles
 * @desc Crear un nuevo rol de WhatsApp
 * @access Public (temporalmente)
 */
router.post('/', [
  body('name', 'El nombre del rol es requerido').notEmpty(),
  body('validUntilDays', 'Los días de validez deben ser un número').isInt({ min: 1 })
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Datos inválidos',
        errors: errors.array() 
      });
    }
    
    const { 
      name, 
      description, 
      maxDailyMessages, 
      maxMonthlyMessages, 
      validUntilDays 
    } = req.body;
    
    // Verificar si el rol ya existe
    const [existingRoles] = await query(
      'SELECT * FROM whatsapp_roles WHERE name = ?',
      [name]
    );
    
    if (existingRoles.length > 0) {
      throw new ValidationError('El nombre del rol ya está en uso');
    }
    
    // Crear el nuevo rol
    const [result] = await query(
      `INSERT INTO whatsapp_roles 
        (name, description, max_daily_messages, max_monthly_messages, valid_until_days) 
       VALUES (?, ?, ?, ?, ?)`,
      [name, description, maxDailyMessages, maxMonthlyMessages, validUntilDays]
    );
    
    const roleId = result.insertId;
    
    // Obtener el rol creado
    const [newRoles] = await query('SELECT * FROM whatsapp_roles WHERE id = ?', [roleId]);
    
    res.status(201).json({
      success: true,
      message: 'Rol creado exitosamente',
      data: newRoles[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/whatsapp-roles/:id
 * @desc Actualizar un rol de WhatsApp
 * @access Public (temporalmente)
 */
router.put('/:id', [
  body('name', 'El nombre del rol es requerido').notEmpty(),
  body('validUntilDays', 'Los días de validez deben ser un número').isInt({ min: 1 })
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false,
        message: 'Datos inválidos',
        errors: errors.array() 
      });
    }
    
    const roleId = req.params.id;
    const { 
      name, 
      description, 
      maxDailyMessages, 
      maxMonthlyMessages, 
      validUntilDays 
    } = req.body;
    
    // Verificar si el rol existe
    const [roles] = await query('SELECT * FROM whatsapp_roles WHERE id = ?', [roleId]);
    
    if (roles.length === 0) {
      throw new NotFoundError('Rol no encontrado');
    }
    
    // Verificar si el nombre ya está en uso por otro rol
    const [existingRoles] = await query(
      'SELECT * FROM whatsapp_roles WHERE name = ? AND id != ?',
      [name, roleId]
    );
    
    if (existingRoles.length > 0) {
      throw new ValidationError('El nombre del rol ya está en uso');
    }
    
    // Actualizar el rol
    await query(
      `UPDATE whatsapp_roles SET 
        name = ?, 
        description = ?, 
        max_daily_messages = ?, 
        max_monthly_messages = ?, 
        valid_until_days = ?
       WHERE id = ?`,
      [name, description, maxDailyMessages, maxMonthlyMessages, validUntilDays, roleId]
    );
    
    // Obtener el rol actualizado
    const [updatedRoles] = await query('SELECT * FROM whatsapp_roles WHERE id = ?', [roleId]);
    
    res.json({
      success: true,
      message: 'Rol actualizado exitosamente',
      data: updatedRoles[0]
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/whatsapp-roles/:id
 * @desc Eliminar un rol de WhatsApp
 * @access Public (temporalmente)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const roleId = req.params.id;
    
    // Verificar si el rol existe
    const [roles] = await query('SELECT * FROM whatsapp_roles WHERE id = ?', [roleId]);
    
    if (roles.length === 0) {
      throw new NotFoundError('Rol no encontrado');
    }
    
    // Verificar si el rol está en uso
    const [usersWithRole] = await query(
      'SELECT COUNT(*) as userCount FROM whatsapp_users WHERE role_id = ?',
      [roleId]
    );
    
    if (usersWithRole[0].userCount > 0) {
      throw new ValidationError('No se puede eliminar el rol porque está asignado a uno o más usuarios');
    }
    
    // Eliminar el rol
    await query('DELETE FROM whatsapp_roles WHERE id = ?', [roleId]);
    
    res.json({
      success: true,
      message: 'Rol eliminado exitosamente'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 