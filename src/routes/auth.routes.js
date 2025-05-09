const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { ValidationError, UnauthorizedError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * @route POST /api/auth/login
 * @desc Iniciar sesión
 * @access Public
 */
router.post('/login', [
  body('username', 'El nombre de usuario es requerido').notEmpty(),
  body('password', 'La contraseña es requerida').notEmpty()
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    // Verificar si el usuario existe
    const [users] = await query('SELECT * FROM users WHERE username = ? AND is_active = true', [username]);
    
    if (users.length === 0) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const user = users[0];

    // Verificar la contraseña
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    // Actualizar último inicio de sesión
    await query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Crear token JWT
    const payload = {
      id: user.id,
      username: user.username,
      email: user.email,
      role_id: user.role_id
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );

    // Obtener el nombre del rol
    const [roles] = await query('SELECT name FROM roles WHERE id = ?', [user.role_id]);
    const roleName = roles.length > 0 ? roles[0].name : null;

    // Obtener permisos del usuario
    const [permissions] = await query(`
      SELECT p.name
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `, [user.role_id]);

    const userPermissions = permissions.map(p => p.name);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: roleName,
        permissions: userPermissions,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/auth/register
 * @desc Registrar un nuevo usuario (solo para admins)
 * @access Private
 */
router.post('/register', [
  body('username', 'El nombre de usuario es requerido').notEmpty().isLength({ min: 3 }),
  body('email', 'Por favor incluya un email válido').isEmail(),
  body('password', 'La contraseña debe tener al menos 6 caracteres').isLength({ min: 6 }),
  body('fullName', 'El nombre completo es requerido').notEmpty(),
  body('roleId', 'El rol es requerido').isNumeric()
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, fullName, roleId } = req.body;

    // Verificar si el usuario ya existe
    const [existingUsers] = await query(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [username, email]
    );
    
    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      if (existingUser.username === username) {
        throw new ValidationError('El nombre de usuario ya está en uso');
      }
      if (existingUser.email === email) {
        throw new ValidationError('El email ya está en uso');
      }
    }

    // Verificar si el rol existe
    const [roles] = await query('SELECT * FROM roles WHERE id = ?', [roleId]);
    
    if (roles.length === 0) {
      throw new ValidationError('El rol seleccionado no existe');
    }

    // Generar hash de la contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear el nuevo usuario
    const [result] = await query(
      'INSERT INTO users (username, email, password, full_name, role_id) VALUES (?, ?, ?, ?, ?)',
      [username, email, hashedPassword, fullName, roleId]
    );

    // Responder con los datos del usuario creado (sin la contraseña)
    const userId = result.insertId;
    
    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: {
        id: userId,
        username,
        email,
        fullName,
        roleId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/auth/verify
 * @desc Verificar token JWT
 * @access Private
 */
router.get('/verify', async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      throw new UnauthorizedError('Token no proporcionado');
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verificar si el usuario existe y está activo
    const [users] = await query('SELECT * FROM users WHERE id = ? AND is_active = true', [decoded.id]);
    
    if (users.length === 0) {
      throw new UnauthorizedError('Usuario no encontrado o inactivo');
    }
    
    const user = users[0];
    
    // Obtener el nombre del rol
    const [roles] = await query('SELECT name FROM roles WHERE id = ?', [user.role_id]);
    const roleName = roles.length > 0 ? roles[0].name : null;
    
    // Obtener permisos del usuario
    const [permissions] = await query(`
      SELECT p.name
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `, [user.role_id]);
    
    const userPermissions = permissions.map(p => p.name);
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: roleName,
        permissions: userPermissions,
        lastLogin: user.last_login
      }
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new UnauthorizedError('Token inválido o expirado'));
    }
    next(error);
  }
});

/**
 * @route PUT /api/auth/change-password
 * @desc Cambiar contraseña del usuario autenticado
 * @access Private
 */
router.put('/change-password', [
  body('currentPassword', 'La contraseña actual es requerida').notEmpty(),
  body('newPassword', 'La nueva contraseña debe tener al menos 6 caracteres').isLength({ min: 6 })
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Verificar si el usuario existe
    const [users] = await query('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      throw new UnauthorizedError('Usuario no encontrado');
    }

    const user = users[0];

    // Verificar la contraseña actual
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    
    if (!isMatch) {
      throw new ValidationError('La contraseña actual es incorrecta');
    }

    // Verificar que la nueva contraseña sea diferente de la actual
    if (currentPassword === newPassword) {
      throw new ValidationError('La nueva contraseña debe ser diferente de la actual');
    }

    // Generar hash de la nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Actualizar la contraseña
    await query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

    res.json({
      message: 'Contraseña actualizada exitosamente'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 