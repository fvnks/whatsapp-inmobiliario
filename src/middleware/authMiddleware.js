const jwt = require('jsonwebtoken');
const { UnauthorizedError, ForbiddenError } = require('./errorHandler');
const { query } = require('../config/database');

/**
 * Middleware de autenticación para las rutas de la API
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Verificar si hay un token
    let token = req.cookies.token || req.headers.authorization;
    
    if (!token && req.headers.authorization) {
      token = req.headers.authorization.replace('Bearer ', '');
    }
    
    if (!token) {
      return res.redirect('/login');
    }
    
    try {
      // Verificar el token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Buscar al usuario en la base de datos
      const [users] = await query('SELECT * FROM users WHERE id = ?', [decoded.id]);
      
      if (users.length === 0) {
        throw new Error('Usuario no encontrado');
      }
      
      const user = users[0];
      
      // Obtener permisos del usuario
      const [permissions] = await query(`
        SELECT p.name
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = ?
      `, [user.role_id]);
      
      // Agregar permisos al objeto de usuario
      user.permissions = permissions.map(permission => permission.name);
      
      // Agregar usuario al objeto de solicitud
      req.user = user;
      
      // Si es una renderización de vista, añadir usuario a las variables locales
      res.locals.user = user;
      res.locals.path = req.path;
      
      next();
    } catch (error) {
      console.error('Error verifying token:', error.message);
      
      // Redirigir a login si el token es inválido
      return res.redirect('/login');
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware para verificar si el usuario tiene los permisos requeridos
 * @param {String|Array} requiredPermissions - Permisos requeridos para acceder al recurso
 * @returns {Function} Middleware de verificación de permisos
 */
const checkPermissions = (requiredPermissions) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      
      // Convertir a array si es un string
      const permissions = Array.isArray(requiredPermissions) 
        ? requiredPermissions 
        : [requiredPermissions];
      
      // Consultar los permisos del usuario
      const [rows] = await query(`
        SELECT p.name
        FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN users u ON u.role_id = rp.role_id
        WHERE u.id = ?
      `, [userId]);
      
      // Extraer nombres de permisos
      const userPermissions = rows.map(row => row.name);
      
      // Verificar si el usuario tiene al menos uno de los permisos requeridos
      const hasPermission = permissions.some(permission => 
        userPermissions.includes(permission)
      );
      
      if (!hasPermission) {
        throw new ForbiddenError('No tienes permisos para realizar esta acción');
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Middleware para verificar si el usuario es administrador
 * @param {Object} req - Objeto de solicitud
 * @param {Object} res - Objeto de respuesta
 * @param {Function} next - Función para pasar al siguiente middleware
 */
const checkAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Consultar si el usuario tiene rol de administrador
    const [rows] = await query(`
      SELECT r.name as role_name
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);
    
    if (rows.length === 0 || rows[0].role_name !== 'admin') {
      throw new ForbiddenError('Se requiere rol de administrador');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authMiddleware,
  checkPermissions,
  checkAdmin
}; 