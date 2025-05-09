const express = require('express');
const { body, validationResult } = require('express-validator');
const { google } = require('googleapis');
const { query } = require('../config/database');
const { checkPermissions } = require('../middleware/authMiddleware');
const { ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { validateSheetId, getSheetInfo, getGoogleSheetData, exportSheetData, appendDataToSheet } = require('../services/googleSheetService');

// Configuración para acceder a la API de Google
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const router = express.Router();

/**
 * @route GET /api/google-sheets
 * @desc Obtener todas las hojas de Google
 * @access Private
 */
router.get('/', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const [sheets] = await query(`
      SELECT gs.*, u.username as creator_username
      FROM google_sheets gs
      LEFT JOIN users u ON gs.created_by = u.id
      ORDER BY gs.created_at DESC
    `);
    
    // Convertir campos booleanos para la respuesta
    const formattedSheets = sheets.map(sheet => ({
      ...sheet,
      is_active: sheet.is_active === 1,
      is_property_log_sheet: sheet.is_property_log_sheet === 1
    }));
    
    res.json(formattedSheets);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/google-sheets/:id
 * @desc Obtener una hoja de Google por ID
 * @access Private
 */
router.get('/:id', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const sheetId = req.params.id;
    
    const [sheets] = await query(`
      SELECT gs.*, u.username as creator_username
      FROM google_sheets gs
      LEFT JOIN users u ON gs.created_by = u.id
      WHERE gs.id = ?
    `, [sheetId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const sheetData = sheets[0];
    sheetData.is_active = sheetData.is_active === 1;
    sheetData.is_property_log_sheet = sheetData.is_property_log_sheet === 1;
    
    res.json(sheetData);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/google-sheets
 * @desc Crear una nueva hoja de Google
 * @access Private
 */
router.post('/', [
  checkPermissions('manage_sheets'),
  body('sheetId', 'El ID de la hoja es requerido').notEmpty(),
  body('name', 'El nombre es requerido').notEmpty(),
  body('is_property_log_sheet', 'Indicador de hoja de propiedades debe ser booleano').optional().isBoolean()
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { sheetId, name, description, range = 'A:Z', isActive = true, is_property_log_sheet = false } = req.body;
    const userId = req.user.id;
    
    // Verificar si la hoja de Google Sheets existe y es accesible
    const isValid = await validateSheetId(sheetId);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'El ID de la hoja de Google Sheets no es válido o no es accesible.' });
    }
    
    // Obtener información básica de la hoja
    const sheetInfo = await getSheetInfo(sheetId);
    
    // Si se marca como hoja de propiedades, asegurar que ninguna otra lo esté
    if (is_property_log_sheet === true || is_property_log_sheet === 'true') {
      await query('UPDATE google_sheets SET is_property_log_sheet = FALSE WHERE is_property_log_sheet = TRUE');
    }
    
    // Verificar si la hoja ya existe
    const [existingSheets] = await query(
      'SELECT * FROM google_sheets WHERE sheet_id = ?',
      [sheetId]
    );
    
    if (existingSheets.length > 0) {
      throw new ValidationError('Esta hoja de Google ya está registrada');
    }
    
    // Insertar en la base de datos
    const [result] = await query(
      'INSERT INTO google_sheets (sheet_id, name, description, `range`, is_active, created_by, is_property_log_sheet) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [sheetId, name, description || sheetInfo.title, range, isActive ? 1 : 0, userId, (is_property_log_sheet === true || is_property_log_sheet === 'true') ? 1 : 0]
    );
    
    // Devolver la nueva hoja creada
    const [newSheetRows] = await query(
      'SELECT id, sheet_id, name, description, `range`, is_active, created_at, is_property_log_sheet FROM google_sheets WHERE id = ?',
      [result.insertId]
    );
    const newSheetData = newSheetRows[0];
    
    res.status(201).json({
      message: 'Hoja de Google registrada exitosamente',
      sheet: {
        id: newSheetData.id,
        sheetId: newSheetData.sheet_id,
        name: newSheetData.name,
        description: newSheetData.description,
        range: newSheetData.range,
        isActive: newSheetData.is_active === 1,
        isPropertyLogSheet: newSheetData.is_property_log_sheet === 1,
        googleTitle: sheetInfo.title,
        availableSheets: sheetInfo.sheets
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/google-sheets/:id
 * @desc Actualizar una hoja de Google
 * @access Private
 */
router.put('/:id', [
  checkPermissions('manage_sheets'),
  body('name', 'El nombre es requerido').optional().notEmpty(),
  body('sheetId', 'El ID de la hoja es requerido').optional().notEmpty(),
  body('is_property_log_sheet', 'Indicador de hoja de propiedades debe ser booleano').optional().isBoolean()
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const sheetDbId = req.params.id;
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const { sheetId, name, description, range, isActive, is_property_log_sheet } = req.body;
    
    // Si se marca como hoja de propiedades, asegurar que ninguna otra lo esté (excepto ella misma si ya lo era)
    if (is_property_log_sheet === true || is_property_log_sheet === 'true') {
      await query('UPDATE google_sheets SET is_property_log_sheet = FALSE WHERE is_property_log_sheet = TRUE AND id != ?', [sheetDbId]);
    }
    
    // Construir objeto de datos para actualizar
    const updateData = {};
    if (sheetId) {
      // Verificar si la hoja existe y es accesible
      const isValid = await validateSheetId(sheetId);
      if (!isValid) {
        return res.status(400).json({ success: false, message: 'El ID de la hoja de Google Sheets no es válido o no es accesible.' });
      }
      updateData.sheet_id = sheetId;
    }
    
    if (name) {
      updateData.name = name;
    }
    
    if (description !== undefined) {
      updateData.description = description;
    }
    
    if (range) {
      updateData['range'] = range;
    }
    
    if (isActive !== undefined) {
      updateData.is_active = isActive ? 1 : 0;
    }
    
    if (is_property_log_sheet !== undefined) {
      updateData.is_property_log_sheet = (is_property_log_sheet === true || is_property_log_sheet === 'true') ? 1 : 0;
    }
    
    // Si no hay datos para actualizar
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'No hay datos para actualizar' });
    }
    
    // Construir la consulta SQL
    let query_string = 'UPDATE google_sheets SET ';
    let params = [];
    let i = 0;
    const keys = Object.keys(updateData);

    for (const key of keys) {
      const value = updateData[key];
      let dbKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`); // Convertir camelCase a snake_case
      
      // Escapar `range` específicamente, o podrías escapar todas las claves por seguridad
      if (dbKey === 'range') {
        dbKey = '`range`'; 
      }
      // Si quisieras escapar todas las claves:
      // dbKey = `\`${dbKey}\``;

      query_string += `${dbKey} = ?`;
      params.push(value);
      if (i < keys.length - 1) {
        query_string += ', ';
      }
      i++;
    }
    
    query_string += ' WHERE id = ?';
    params.push(sheetDbId);
    
    // Ejecutar la actualización
    await query(query_string, params);
    
    // Obtener la hoja actualizada
    const [updatedSheets] = await query(`
      SELECT gs.*, u.username as creator_username
      FROM google_sheets gs
      LEFT JOIN users u ON gs.created_by = u.id
      WHERE gs.id = ?
    `, [sheetDbId]);
    
    const updatedSheetData = updatedSheets[0];
    // Transformar is_property_log_sheet y is_active a booleanos para la respuesta JSON
    updatedSheetData.is_active = updatedSheetData.is_active === 1;
    updatedSheetData.is_property_log_sheet = updatedSheetData.is_property_log_sheet === 1;
    
    res.json({
      message: 'Hoja de Google actualizada exitosamente',
      sheet: updatedSheetData
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/google-sheets/:id
 * @desc Eliminar una hoja de Google
 * @access Private
 */
router.delete('/:id', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const sheetDbId = req.params.id;
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    // Verificar si la hoja está siendo usada en consultas
    const [queries] = await query('SELECT COUNT(*) as count FROM queries WHERE google_sheet_id = ?', [sheetDbId]);
    
    if (queries[0].count > 0) {
      throw new ValidationError('No se puede eliminar la hoja porque está siendo usada en consultas');
    }
    
    // Eliminar la hoja
    await query('DELETE FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    res.json({
      message: 'Hoja de Google eliminada exitosamente'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/google-sheets/:id/data
 * @desc Obtener los datos de una hoja de Google Sheet
 * @access Private
 */
router.get('/:id/data', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const sheetDbId = req.params.id;
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const sheet = sheets[0];
    
    // Obtener los datos de la hoja
    const data = await getGoogleSheetData(sheet.sheet_id, sheet.range);
    
    res.json({
      sheetInfo: {
        id: sheet.id,
        name: sheet.name,
        sheetId: sheet.sheet_id,
        range: sheet.range
      },
      data,
      count: data.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/google-sheets/:id/data/filter
 * @desc Filtrar los datos de una hoja de Google Sheet
 * @access Private
 */
router.get('/:id/data/filter', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const sheetDbId = req.params.id;
    const { field, value } = req.query;
    
    if (!field || !value) {
      throw new ValidationError('Se requiere un campo y un valor para filtrar');
    }
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const sheet = sheets[0];
    
    // Obtener los datos de la hoja
    let data = await getGoogleSheetData(sheet.sheet_id, sheet.range);
    
    // Filtrar los datos
    data = data.filter(item => {
      // Hacer que la búsqueda sea insensible a mayúsculas/minúsculas
      const itemValue = item[field]?.toString().toLowerCase() || '';
      const searchValue = value.toLowerCase();
      
      return itemValue.includes(searchValue);
    });
    
    res.json({
      sheetInfo: {
        id: sheet.id,
        name: sheet.name,
        sheetId: sheet.sheet_id,
        range: sheet.range
      },
      filter: { field, value },
      data,
      count: data.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/google-sheets/:id/data/columns
 * @desc Obtener las columnas disponibles en una hoja de Google Sheet
 * @access Private
 */
router.get('/:id/data/columns', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const sheetDbId = req.params.id;
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const sheet = sheets[0];
    
    // Inicializar el cliente de Google Sheets
    const client = await auth.getClient();
    const googleSheets = google.sheets({
      version: 'v4',
      auth: client,
    });
    
    // Obtener solo la primera fila (encabezados)
    const response = await googleSheets.spreadsheets.values.get({
      spreadsheetId: sheet.sheet_id,
      range: `A1:Z1`,
    });
    
    // Extraer los valores
    const headers = response.data.values?.[0] || [];
    
    res.json({
      sheetInfo: {
        id: sheet.id,
        name: sheet.name,
        sheetId: sheet.sheet_id,
        range: sheet.range
      },
      columns: headers
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/google-sheets/:id/data/search
 * @desc Buscar datos en una hoja de Google Sheet con filtros avanzados
 * @access Private
 */
router.post('/:id/data/search', [
  checkPermissions('manage_sheets'),
  body('filters', 'Se requiere al menos un filtro').isArray({ min: 1 }),
  body('filters.*.field', 'Cada filtro debe tener un campo').notEmpty(),
  body('filters.*.value', 'Cada filtro debe tener un valor').notEmpty(),
  body('filters.*.operator', 'Cada filtro debe tener un operador').isIn(['equals', 'contains', 'startsWith', 'endsWith', 'greaterThan', 'lessThan'])
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const sheetDbId = req.params.id;
    const { filters, matchAll = true } = req.body;
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const sheet = sheets[0];
    
    // Obtener los datos de la hoja
    let data = await getGoogleSheetData(sheet.sheet_id, sheet.range);
    
    // Filtrar los datos según los criterios
    data = data.filter(item => {
      // Para cada item, evaluar cada filtro
      const results = filters.map(filter => {
        const { field, value, operator } = filter;
        const itemValue = item[field]?.toString() || '';
        
        switch (operator) {
          case 'equals':
            return itemValue.toLowerCase() === value.toLowerCase();
          case 'contains':
            return itemValue.toLowerCase().includes(value.toLowerCase());
          case 'startsWith':
            return itemValue.toLowerCase().startsWith(value.toLowerCase());
          case 'endsWith':
            return itemValue.toLowerCase().endsWith(value.toLowerCase());
          case 'greaterThan':
            return parseFloat(itemValue) > parseFloat(value);
          case 'lessThan':
            return parseFloat(itemValue) < parseFloat(value);
          default:
            return false;
        }
      });
      
      // Si matchAll es true, todos los filtros deben cumplirse
      // Si matchAll es false, al menos un filtro debe cumplirse
      return matchAll ? results.every(r => r) : results.some(r => r);
    });
    
    res.json({
      sheetInfo: {
        id: sheet.id,
        name: sheet.name,
        sheetId: sheet.sheet_id,
        range: sheet.range
      },
      filters,
      matchAll,
      data,
      count: data.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/google-sheets/validate
 * @desc Validar un ID de hoja de Google
 * @access Private
 */
router.post('/validate', [
  checkPermissions('manage_sheets'),
  body('sheetId', 'El ID de la hoja es requerido').notEmpty()
], async (req, res, next) => {
  try {
    // Validar errores de campos
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { sheetId } = req.body;
    
    // Validar el ID de la hoja
    const isValid = await validateSheetId(sheetId);
    
    if (!isValid) {
      return res.json({
        valid: false,
        message: 'El ID de la hoja de Google no es válido o no se puede acceder'
      });
    }
    
    // Obtener información adicional de la hoja
    const sheetInfo = await getSheetInfo(sheetId);
    
    res.json({
      valid: true,
      sheetInfo
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/google-sheets/:id/export
 * @desc Exportar los datos de una hoja de Google Sheet a diferentes formatos
 * @access Private
 */
router.get('/:id/export', checkPermissions('manage_sheets'), async (req, res, next) => {
  try {
    const sheetDbId = req.params.id;
    const format = req.query.format || 'json';
    const filename = req.query.filename || `sheet-export-${Date.now()}`;
    
    // Verificar formato válido
    if (!['json', 'csv'].includes(format.toLowerCase())) {
      throw new ValidationError('Formato no válido. Formatos soportados: json, csv');
    }
    
    // Verificar si la hoja existe
    const [sheets] = await query('SELECT * FROM google_sheets WHERE id = ?', [sheetDbId]);
    
    if (sheets.length === 0) {
      throw new NotFoundError('Hoja de Google no encontrada');
    }
    
    const sheet = sheets[0];
    
    // Obtener los datos de la hoja
    const data = await getGoogleSheetData(sheet.sheet_id, sheet.range);
    
    // Exportar los datos
    const { content, contentType } = exportSheetData(data, format);
    
    // Establecer headers para la descarga
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${filename}.${format}`);
    
    // Enviar la respuesta
    res.send(content);
  } catch (error) {
    next(error);
  }
});

module.exports = router; 