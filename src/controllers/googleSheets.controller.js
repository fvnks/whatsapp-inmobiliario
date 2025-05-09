const sheetsService = require('../services/googleSheets.service');
const logger = require('../utils/logger');

// Verificar el acceso a una hoja de Google
const verifySheetAccess = async (req, res) => {
  try {
    const { sheetId, range } = req.body;
    
    if (!sheetId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID is required' 
      });
    }
    
    const result = await sheetsService.verifySheetAccess(sheetId, range);
    return res.json(result);
  } catch (error) {
    logger.error(`Error in verifySheetAccess: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error verifying sheet access',
      error: error.message 
    });
  }
};

// Crear una nueva conexión de hoja de Google
const createSheet = async (req, res) => {
  try {
    const { name, sheetId, description, range } = req.body;
    
    if (!name || !sheetId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and Sheet ID are required' 
      });
    }
    
    const result = await sheetsService.createSheetConnection({
      name,
      sheetId,
      description,
      range
    });
    
    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    logger.error(`Error in createSheet: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error creating sheet connection',
      error: error.message 
    });
  }
};

// Obtener todas las conexiones de hojas de Google
const getAllSheets = async (req, res) => {
  try {
    const result = await sheetsService.getAllSheets();
    return res.json(result);
  } catch (error) {
    logger.error(`Error in getAllSheets: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error fetching sheets',
      error: error.message 
    });
  }
};

// Obtener una conexión de hoja de Google por ID
const getSheetById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID is required' 
      });
    }
    
    const result = await sheetsService.getSheetById(id);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    logger.error(`Error in getSheetById: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error fetching sheet',
      error: error.message 
    });
  }
};

// Actualizar una conexión de hoja de Google
const updateSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sheetId, description, range, status } = req.body;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID is required' 
      });
    }
    
    const result = await sheetsService.updateSheet(id, {
      name,
      sheetId,
      description,
      range,
      status
    });
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    return res.json(result);
  } catch (error) {
    logger.error(`Error in updateSheet: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error updating sheet',
      error: error.message 
    });
  }
};

// Eliminar una conexión de hoja de Google
const deleteSheet = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID is required' 
      });
    }
    
    const result = await sheetsService.deleteSheet(id);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    return res.json({ success: true, message: 'Sheet deleted successfully' });
  } catch (error) {
    logger.error(`Error in deleteSheet: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error deleting sheet',
      error: error.message 
    });
  }
};

// Leer datos de una hoja de Google
const readSheetData = async (req, res) => {
  try {
    const { sheetId, range } = req.body;
    
    if (!sheetId || !range) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID and range are required' 
      });
    }
    
    const result = await sheetsService.readSheetData(sheetId, range);
    return res.json(result);
  } catch (error) {
    logger.error(`Error in readSheetData: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error reading sheet data',
      error: error.message 
    });
  }
};

// Obtener datos de una hoja de Google por ID
const getSheetData = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID is required' 
      });
    }
    
    // First get the sheet details
    const sheetResult = await sheetsService.getSheetById(id);
    
    if (!sheetResult.success) {
      return res.status(404).json(sheetResult);
    }
    
    const sheet = sheetResult.data;
    const range = req.query.range || sheet.range;
    
    // Then read data from the sheet
    const result = await sheetsService.readSheetData(sheet.sheetId, range);
    return res.json(result);
  } catch (error) {
    logger.error(`Error in getSheetData: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error fetching sheet data',
      error: error.message 
    });
  }
};

// Exportar datos de una hoja de Google
const exportSheetData = async (req, res) => {
  try {
    const { id, format } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Sheet ID is required' 
      });
    }
    
    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Format must be either json or csv' 
      });
    }
    
    // First get the sheet details
    const sheetResult = await sheetsService.getSheetById(id);
    
    if (!sheetResult.success) {
      return res.status(404).json(sheetResult);
    }
    
    const sheet = sheetResult.data;
    const range = req.query.range || sheet.range;
    
    // Then read data from the sheet
    const dataResult = await sheetsService.readSheetData(sheet.sheetId, range);
    
    if (!dataResult.success) {
      return res.status(500).json(dataResult);
    }
    
    const data = dataResult.data;
    
    if (format === 'json') {
      // If the data has headers (first row), convert to JSON objects
      if (data && data.length > 1) {
        const headers = data[0];
        const jsonData = data.slice(1).map(row => {
          const obj = {};
          headers.forEach((header, index) => {
            obj[header] = row[index] || '';
          });
          return obj;
        });
        
        return res.json({
          success: true,
          sheetName: sheet.name,
          data: jsonData
        });
      } else {
        return res.json({
          success: true,
          sheetName: sheet.name,
          data: data || []
        });
      }
    } else if (format === 'csv') {
      // Convert to CSV
      if (!data || data.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No data found in sheet'
        });
      }
      
      // Create CSV content
      const csvContent = data.map(row => row.join(',')).join('\n');
      
      // Set headers for file download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${sheet.name.replace(/\s+/g, '_')}.csv"`);
      
      return res.send(csvContent);
    }
  } catch (error) {
    logger.error(`Error in exportSheetData: ${error.message}`);
    return res.status(500).json({ 
      success: false, 
      message: 'Error exporting sheet data',
      error: error.message 
    });
  }
};

module.exports = {
  verifySheetAccess,
  createSheet,
  getAllSheets,
  getSheetById,
  updateSheet,
  deleteSheet,
  readSheetData,
  getSheetData,
  exportSheetData
}; 