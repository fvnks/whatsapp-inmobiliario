const express = require('express');
const router = express.Router();
const sheetsController = require('../controllers/googleSheets.controller');
const { authMiddleware } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(authMiddleware);

// Verify sheet access
router.post('/verify', sheetsController.verifySheetAccess);

// Get all sheets
router.get('/', sheetsController.getAllSheets);

// Get all sheets (alternative endpoint)
router.get('/all', sheetsController.getAllSheets);

// Create a new sheet connection
router.post('/', sheetsController.createSheet);

// Get sheet by ID
router.get('/:id', sheetsController.getSheetById);

// Update sheet
router.put('/:id', sheetsController.updateSheet);

// Delete sheet
router.delete('/:id', sheetsController.deleteSheet);

// Read data from a sheet
router.post('/read', sheetsController.readSheetData);

// Read data from a specific sheet by ID
router.get('/:id/data', sheetsController.getSheetData);

// Export data from a sheet
router.get('/:id/export/:format', sheetsController.exportSheetData);

module.exports = router; 