const express = require('express');
const router = express.Router();
const { authMiddleware, checkPermissions } = require('../middleware/authMiddleware');
const whatsappUsersController = require('../controllers/whatsappUsers.controller');

// Apply auth middleware to all routes
router.use(authMiddleware);

// Get all WhatsApp users
router.get('/', checkPermissions('manage_users'), whatsappUsersController.getAllWhatsappUsers);

// Get all WhatsApp roles
router.get('/roles', checkPermissions('manage_users'), whatsappUsersController.getAllRoles);

// Get a WhatsApp user by ID
router.get('/:id', checkPermissions('manage_users'), whatsappUsersController.getWhatsappUserById);

// Create a new WhatsApp user
router.post('/', checkPermissions('manage_users'), whatsappUsersController.createWhatsappUser);

// Update a WhatsApp user
router.put('/:id', checkPermissions('manage_users'), whatsappUsersController.updateWhatsappUser);

// Delete a WhatsApp user
router.delete('/:id', checkPermissions('manage_users'), whatsappUsersController.deleteWhatsappUser);

module.exports = router; 