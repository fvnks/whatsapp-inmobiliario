const express = require('express');
const { query } = require('../config/database');
const { checkPermissions } = require('../middleware/authMiddleware');
const { NotFoundError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * @route GET /admin
 * @desc Página principal del panel de administración
 * @access Private
 */
router.get('/', checkPermissions('view_dashboard'), async (req, res, next) => {
  try {
    // Obtener estadísticas para el dashboard
    const [userCount] = await query('SELECT COUNT(*) as count FROM users');
    const [sheetCount] = await query('SELECT COUNT(*) as count FROM google_sheets');
    const [queryCount] = await query('SELECT COUNT(*) as count FROM queries');
    const [pendingQueryCount] = await query('SELECT COUNT(*) as count FROM queries WHERE status = "pending"');
    
    // Obtener consultas recientes
    const [recentQueries] = await query(`
      SELECT q.*, gs.name as sheet_name
      FROM queries q
      LEFT JOIN google_sheets gs ON q.google_sheet_id = gs.id
      ORDER BY q.created_at DESC
      LIMIT 10
    `);
    
    // Renderizar el dashboard
    res.render('admin/dashboard', {
      title: 'Panel de Administración',
      path: '/admin',
      layout: 'layouts/admin',
      user: req.user,
      stats: {
        users: userCount[0].count,
        sheets: sheetCount[0].count,
        queries: queryCount[0].count,
        pendingQueries: pendingQueryCount[0].count
      },
      recentQueries,
      script: ''
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/users
 * @desc Página de gestión de usuarios
 * @access Private
 */
router.get('/users', checkPermissions('manage_users'), async (req, res, next) => {
  try {
    res.render('admin/users', {
      title: 'Gestión de Usuarios',
      user: req.user
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/sheets
 * @desc Página de gestión de hojas de Google
 * @access Private
 */
router.get('/sheets', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    res.render('admin/sheets', {
      title: 'Gestión de Hojas de Google',
      user: req.user
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/sheet-explorer
 * @desc Página para explorar datos de hojas de Google
 * @access Private
 */
router.get('/sheet-explorer', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    // Obtener todas las hojas de Google para el selector
    const [sheets] = await query('SELECT * FROM google_sheets WHERE is_active = 1 ORDER BY name ASC');
    
    res.render('admin/sheet-explorer', {
      title: 'Explorador de Datos',
      user: req.user,
      sheets,
      selectedSheet: null
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/sheet-explorer/:id
 * @desc Página para explorar datos de una hoja de Google específica
 * @access Private
 */
router.get('/sheet-explorer/:id', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    // Obtener todas las hojas de Google para el selector
    const [sheets] = await query('SELECT * FROM google_sheets WHERE is_active = 1 ORDER BY name ASC');
    
    // Si se proporcionó un ID específico
    let selectedSheet = null;
    if (req.params.id) {
      const [selectedSheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [req.params.id]);
      if (selectedSheets.length > 0) {
        selectedSheet = selectedSheets[0];
      }
    }
    
    res.render('admin/sheet-explorer', {
      title: 'Explorador de Datos',
      user: req.user,
      sheets,
      selectedSheet
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/googlesheets
 * @desc Página para gestionar Google Sheets con la nueva API
 * @access Private
 */
router.get('/googlesheets', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    // Obtener todas las hojas de Google
    const [sheets] = await query('SELECT * FROM google_sheets ORDER BY name ASC');
    
    res.render('admin/googlesheets', {
      title: 'Gestión de Google Sheets',
      user: req.user,
      sheets
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/queries
 * @desc Página de visualización de consultas
 * @access Private
 */
router.get('/queries', checkPermissions('view_queries'), async (req, res, next) => {
  try {
    // Obtener parámetros de paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    // Obtener el parámetro de status
    const currentStatus = req.query.status;
    
    // Construir consulta base
    let queryString = `
      SELECT q.*, gs.name as sheet_name
      FROM queries q
      LEFT JOIN google_sheets gs ON q.google_sheet_id = gs.id
    `;
    
    let queryParams = [];
    
    // Añadir filtro por estado si se especifica
    if (currentStatus) {
      queryString += ` WHERE q.status = ?`;
      queryParams.push(currentStatus);
    }
    
    // Añadir orden y paginación
    queryString += ` ORDER BY q.created_at DESC LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);
    
    // Obtener consultas paginadas y filtradas
    const [queries] = await query(queryString, queryParams);
    
    // Obtener el total de consultas para la paginación (considerando filtros)
    let countQuery = `SELECT COUNT(*) as total FROM queries`;
    let countParams = [];
    
    if (currentStatus) {
      countQuery += ` WHERE status = ?`;
      countParams.push(currentStatus);
    }
    
    const [totalResult] = await query(countQuery, countParams);
    const total = totalResult[0].total;
    
    res.render('admin/queries', {
      title: 'Consultas de Usuarios',
      user: req.user,
      queries,
      currentStatus,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/queries/:id
 * @desc Ver detalle de una consulta
 * @access Private
 */
router.get('/queries/:id', checkPermissions('view_queries'), async (req, res, next) => {
  try {
    const queryId = req.params.id;
    
    // Obtener datos de la consulta
    const [queries] = await query(`
      SELECT q.*, gs.name as sheet_name, gs.sheet_id
      FROM queries q
      LEFT JOIN google_sheets gs ON q.google_sheet_id = gs.id
      WHERE q.id = ?
    `, [queryId]);
    
    if (queries.length === 0) {
      throw new NotFoundError('Consulta no encontrada');
    }
    
    // Obtener datos de la hoja de Google si existe
    let sheet = null;
    if (queries[0].google_sheet_id) {
      const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [queries[0].google_sheet_id]);
      if (sheets.length > 0) {
        sheet = sheets[0];
      }
    }
    
    res.render('admin/query', {
      title: 'Detalle de Consulta',
      user: req.user,
      query: queries[0],
      sheet
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/profile
 * @desc Página de perfil del usuario
 * @access Private
 */
router.get('/profile', async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Obtener datos del usuario
    const [users] = await query(`
      SELECT u.id, u.username, u.email, u.full_name, u.created_at, u.last_login,
             r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);
    
    if (users.length === 0) {
      throw new NotFoundError('Usuario no encontrado');
    }
    
    // Obtener permisos del usuario
    const [permissions] = await query(`
      SELECT p.name, p.description
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN roles r ON rp.role_id = r.id
      JOIN users u ON u.role_id = r.id
      WHERE u.id = ?
    `, [userId]);
    
    res.render('admin/profile', {
      title: 'Mi Perfil',
      user: req.user,
      userData: users[0],
      permissions
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/whatsapp-users
 * @desc Página de gestión de usuarios de WhatsApp
 * @access Private
 */
router.get('/whatsapp-users', checkPermissions('manage_users'), async (req, res, next) => {
  try {
    // Obtener roles para el formulario de creación/edición
    const [roles] = await query('SELECT * FROM whatsapp_roles ORDER BY id');
    
    res.render('admin/whatsapp-users', {
      title: 'Gestión de Usuarios de WhatsApp',
      user: req.user,
      roles
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /admin/whatsapp-roles
 * @desc Página de gestión de roles de WhatsApp
 * @access Private
 */
router.get('/whatsapp-roles', async (req, res, next) => {
  try {
    const user = req.user || {};
    
    res.render('admin/whatsapp-roles', {
      title: 'Gestión de Roles de WhatsApp',
      user: user,
      path: req.path
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 