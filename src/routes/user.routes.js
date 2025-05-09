const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { checkAdmin, checkPermissions } = require('../middleware/authMiddleware');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * @route GET /api/users
 * @desc Obtener todos los usuarios
 * @access Private (admin)
 */
router.get('/', checkPermissions('manage_users'), async (req, res, next) => {
  try {
    const [users] = await query(`
      SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.created_at, u.last_login, 
             r.id as role_id, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      ORDER BY u.id DESC
    `);
    
    // Eliminar las contraseñas de los resultados
    const safeUsers = users.map(user => {
      const { password, ...safeUser } = user;
      return safeUser;
    });
    
    res.json(safeUsers);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/users/:id
 * @desc Obtener un usuario por ID
 * @access Private (admin)
 */
router.get('/:id', checkPermissions('manage_users'), async (req, res, next) => {
  try {
    const userId = req.params.id;
    
    const [users] = await query(`
      SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.created_at, u.last_login, 
             r.id as role_id, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);
    
    if (users.length === 0) {
      throw new NotFoundError('Usuario no encontrado');
    }
    
    // Eliminar la contraseña del resultado
    const { password, ...safeUser } = users[0];
    
    // Obtener permisos del usuario
    const [permissions] = await query(`
      SELECT p.name
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `, [safeUser.role_id]);
    
    safeUser.permissions = permissions.map(p => p.name);
    
    res.json(safeUser);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/users
 * @desc Crear un nuevo usuario
 * @access Private (admin)
 */
router.post('/', [
  checkPermissions('manage_users'),
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
    
    const { username, email, password, fullName, roleId, isActive = true } = req.body;
    
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
      'INSERT INTO users (username, email, password, full_name, role_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, hashedPassword, fullName, roleId, isActive ? 1 : 0]
    );
    
    // Responder con los datos del usuario creado (sin la contraseña)
    const userId = result.insertId;
    
    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: userId,
        username,
        email,
        fullName,
        roleId,
        isActive
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/users/:id
 * @desc Actualizar un usuario
 * @access Private (admin)
 */
router.put('/:id', [
  checkPermissions('manage_users'),
  body('username', 'El nombre de usuario es requerido').optional().isLength({ min: 3 }),
  body('email', 'Por favor incluya un email válido').optional().isEmail(),
  body('password', 'La contraseña debe tener al menos 6 caracteres').optional().isLength({ min: 6 }),
  body('fullName', 'El nombre completo es requerido').optional().notEmpty(),
  body('roleId', 'El rol es requerido').optional().isNumeric(),
  body('isActive', 'El estado debe ser booleano').optional().isBoolean()
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const userId = req.params.id;
    
    // Verificar si el usuario a actualizar existe
    const [users] = await query('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      throw new NotFoundError('Usuario no encontrado');
    }
    
    const { username, email, password, fullName, roleId, isActive } = req.body;
    
    // Si se intenta cambiar el username o email, verificar que no exista
    if (username || email) {
      const [existingUsers] = await query(
        'SELECT * FROM users WHERE (username = ? OR email = ?) AND id != ?',
        [username || '', email || '', userId]
      );
      
      if (existingUsers.length > 0) {
        const existingUser = existingUsers[0];
        if (username && existingUser.username === username) {
          throw new ValidationError('El nombre de usuario ya está en uso');
        }
        if (email && existingUser.email === email) {
          throw new ValidationError('El email ya está en uso');
        }
      }
    }
    
    // Si se actualiza el roleId, verificar que exista
    if (roleId) {
      const [roles] = await query('SELECT * FROM roles WHERE id = ?', [roleId]);
      
      if (roles.length === 0) {
        throw new ValidationError('El rol seleccionado no existe');
      }
    }
    
    // Preparar los datos para actualizar
    let updateData = {};
    let params = [];
    let query_string = 'UPDATE users SET ';
    
    if (username) {
      updateData.username = username;
    }
    if (email) {
      updateData.email = email;
    }
    if (password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }
    if (fullName) {
      updateData.full_name = fullName;
    }
    if (roleId) {
      updateData.role_id = roleId;
    }
    if (isActive !== undefined) {
      updateData.is_active = isActive ? 1 : 0;
    }
    
    // Si no hay datos para actualizar
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No hay datos para actualizar' });
    }
    
    // Construir la consulta SQL
    let i = 0;
    for (const [key, value] of Object.entries(updateData)) {
      query_string += `${key} = ?`;
      params.push(value);
      
      if (i < Object.keys(updateData).length - 1) {
        query_string += ', ';
      }
      i++;
    }
    
    query_string += ' WHERE id = ?';
    params.push(userId);
    
    // Ejecutar la actualización
    await query(query_string, params);
    
    // Obtener el usuario actualizado
    const [updatedUsers] = await query(`
      SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.created_at, u.last_login, 
             r.id as role_id, r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);
    
    // Eliminar la contraseña del resultado
    const { password: _, ...safeUser } = updatedUsers[0];
    
    res.json({
      message: 'Usuario actualizado exitosamente',
      user: safeUser
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/users/:id
 * @desc Eliminar un usuario
 * @access Private (admin)
 */
router.delete('/:id', checkPermissions('manage_users'), async (req, res, next) => {
  try {
    const userId = req.params.id;
    
    // Verificar si el usuario existe
    const [users] = await query('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      throw new NotFoundError('Usuario no encontrado');
    }
    
    // No permitir eliminar el propio usuario
    if (parseInt(userId) === req.user.id) {
      throw new ValidationError('No puedes eliminar tu propio usuario');
    }
    
    // Eliminar el usuario
    await query('DELETE FROM users WHERE id = ?', [userId]);
    
    res.json({
      message: 'Usuario eliminado exitosamente'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/users/roles
 * @desc Obtener todos los roles
 * @access Private (admin)
 */
router.get('/roles/all', checkPermissions('manage_users'), async (req, res, next) => {
  try {
    const [roles] = await query('SELECT * FROM roles ORDER BY id');
    res.json(roles);
  } catch (error) {
    next(error);
  }
});

module.exports = router; 