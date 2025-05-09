const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../utils/prisma');
const logger = require('../utils/logger');

// Cargar credenciales
const keyFile = path.join(process.cwd(), 'credentials.json');
let credentials;

try {
  credentials = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
} catch (error) {
  logger.error(`Error loading Google API credentials: ${error.message}`);
}

// Función para autorizar y crear cliente
const getClient = () => {
  if (!credentials) {
    throw new Error('Google API credentials not available');
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    return {
      sheets: google.sheets({ version: 'v4', auth })
    };
  } catch (error) {
    logger.error(`Error creating Google client: ${error.message}`);
    throw new Error('Failed to create Google client');
  }
};

// Verificar acceso a una hoja de Google
const verifySheetAccess = async (sheetId, range) => {
  try {
    const { sheets } = getClient();
    
    // Intentar leer la hoja para verificar acceso
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: range || 'A1:A2'
    });
    
    return { success: true, data: response.data };
  } catch (error) {
    logger.error(`Error verifying sheet access: ${error.message}`);
    return { 
      success: false, 
      error: error.message.includes('not found') 
        ? 'Google Sheet no encontrada' 
        : error.message.includes('permission') 
          ? 'No tienes permisos para acceder a esta hoja'
          : 'Error al verificar acceso a la hoja'
    };
  }
};

// Leer datos de una hoja
const readSheetData = async (sheetId, range) => {
  try {
    const { sheets } = getClient();
    
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range
    });
    
    return { success: true, data: response.data.values };
  } catch (error) {
    logger.error(`Error reading sheet data: ${error.message}`);
    return { success: false, error: `Error reading sheet data: ${error.message}` };
  }
};

// Obtener información de la hoja (metadatos)
const getSheetInfo = async (sheetId) => {
  try {
    const { sheets } = getClient();
    
    const response = await sheets.spreadsheets.get({
      spreadsheetId: sheetId
    });
    
    const sheetInfo = {
      title: response.data.properties.title,
      sheets: response.data.sheets.map(sheet => ({
        id: sheet.properties.sheetId,
        title: sheet.properties.title,
        index: sheet.properties.index,
        rowCount: sheet.properties.gridProperties.rowCount,
        columnCount: sheet.properties.gridProperties.columnCount
      }))
    };
    
    return { success: true, data: sheetInfo };
  } catch (error) {
    logger.error(`Error getting sheet info: ${error.message}`);
    return { success: false, error: `Error getting sheet info: ${error.message}` };
  }
};

// Exportar datos de la hoja a diferentes formatos
const exportSheetData = async (sheetId, range, format = 'json') => {
  try {
    const result = await readSheetData(sheetId, range);
    
    if (!result.success) {
      return result;
    }
    
    const data = result.data;
    
    if (format === 'json') {
      // Si los datos tienen encabezados (primera fila), convertir a objetos JSON
      if (data && data.length > 1) {
        const headers = data[0];
        const jsonData = data.slice(1).map(row => {
          const obj = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] || '';
          });
          return obj;
        });
        
        return { success: true, data: jsonData };
      } else {
        return { success: true, data: data || [] };
      }
    } else if (format === 'csv') {
      // Convertir a CSV
      if (!data || data.length === 0) {
        return { success: false, error: 'No data found' };
      }
      
      const csvContent = data.map(row => row.join(',')).join('\n');
      return { success: true, data: csvContent };
    } else {
      return { success: false, error: 'Unsupported format' };
    }
  } catch (error) {
    logger.error(`Error exporting sheet data: ${error.message}`);
    return { success: false, error: `Error exporting sheet data: ${error.message}` };
  }
};

// Crear una nueva conexión a Google Sheets en la base de datos
const createSheetConnection = async (data) => {
  try {
    // Verificar acceso a la hoja antes de guardar
    const accessCheck = await verifySheetAccess(data.sheetId, data.range);
    if (!accessCheck.success) {
      return { success: false, error: accessCheck.error };
    }
    
    const sheet = await prisma.googleSheet.create({
      data: {
        name: data.name,
        sheetId: data.sheetId,
        description: data.description || '',
        range: data.range || 'A1:Z1000',
        status: 'active'
      }
    });
    
    // Transform database response to match API format
    const transformedSheet = {
      id: sheet.id,
      name: sheet.name,
      sheetId: sheet.sheet_id,
      description: sheet.description,
      range: sheet.range,
      status: sheet.is_active ? 'active' : 'inactive',
      createdAt: sheet.created_at
    };
    
    return { success: true, data: transformedSheet };
  } catch (error) {
    logger.error(`Error creating sheet connection: ${error.message}`);
    return { success: false, error: `Error creating sheet connection: ${error.message}` };
  }
};

// Obtener todas las conexiones de Google Sheets
const getAllSheets = async () => {
  try {
    const sheets = await prisma.googleSheet.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    // Transform database response to match API format
    const transformedSheets = sheets.map(sheet => ({
      id: sheet.id,
      name: sheet.name,
      sheetId: sheet.sheet_id,
      description: sheet.description,
      range: sheet.range,
      status: sheet.is_active ? 'active' : 'inactive',
      createdAt: sheet.created_at
    }));
    
    return { success: true, data: transformedSheets };
  } catch (error) {
    logger.error(`Error fetching sheets: ${error.message}`);
    return { success: false, error: `Error fetching sheets: ${error.message}` };
  }
};

// Obtener una conexión de Google Sheets por ID
const getSheetById = async (id) => {
  try {
    const sheet = await prisma.googleSheet.findUnique({
      where: { id: parseInt(id) }
    });
    
    if (!sheet) {
      return { success: false, error: 'Sheet connection not found' };
    }
    
    // Transform database response to match API format
    const transformedSheet = {
      id: sheet.id,
      name: sheet.name,
      sheetId: sheet.sheet_id,
      description: sheet.description,
      range: sheet.range,
      status: sheet.is_active ? 'active' : 'inactive',
      createdAt: sheet.created_at
    };
    
    return { success: true, data: transformedSheet };
  } catch (error) {
    logger.error(`Error fetching sheet: ${error.message}`);
    return { success: false, error: `Error fetching sheet: ${error.message}` };
  }
};

// Actualizar una conexión de Google Sheets
const updateSheet = async (id, data) => {
  try {
    // Verificar acceso a la hoja antes de actualizar
    if (data.sheetId) {
      const accessCheck = await verifySheetAccess(data.sheetId, data.range);
      if (!accessCheck.success) {
        return { success: false, error: accessCheck.error };
      }
    }
    
    const sheet = await prisma.googleSheet.update({
      where: { id: parseInt(id) },
      data: {
        name: data.name,
        sheetId: data.sheetId,
        description: data.description,
        range: data.range,
        status: data.status
      }
    });
    
    // Transform database response to match API format
    const transformedSheet = {
      id: sheet.id,
      name: sheet.name,
      sheetId: sheet.sheet_id,
      description: sheet.description,
      range: sheet.range,
      status: sheet.is_active ? 'active' : 'inactive',
      createdAt: sheet.created_at
    };
    
    return { success: true, data: transformedSheet };
  } catch (error) {
    logger.error(`Error updating sheet: ${error.message}`);
    return { success: false, error: `Error updating sheet: ${error.message}` };
  }
};

// Eliminar una conexión de Google Sheets
const deleteSheet = async (id) => {
  try {
    await prisma.googleSheet.delete({
      where: { id: parseInt(id) }
    });
    
    return { success: true };
  } catch (error) {
    logger.error(`Error deleting sheet: ${error.message}`);
    return { success: false, error: `Error deleting sheet: ${error.message}` };
  }
};

module.exports = {
  verifySheetAccess,
  readSheetData,
  getSheetInfo,
  exportSheetData,
  createSheetConnection,
  getAllSheets,
  getSheetById,
  updateSheet,
  deleteSheet
}; 