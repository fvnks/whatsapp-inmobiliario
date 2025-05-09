const express = require('express');
const router = express.Router();
const adminWhatsappUserController = require('../controllers/adminWhatsappUserController');
// const { isAdminAuthenticated } = require('../middlewares/authMiddleware'); // Descomentar cuando tengas tu middleware

// Ruta para obtener todos los usuarios de WhatsApp
// Para producción, deberías activar el middleware: router.get('/users', isAdminAuthenticated, adminWhatsappUserController.handleGetAllUsers);
router.get('/users', adminWhatsappUserController.handleGetAllUsers);

// Ruta para eliminar un usuario de WhatsApp por ID
// Para producción, deberías activar el middleware: router.delete('/users/:userId', isAdminAuthenticated, adminWhatsappUserController.handleDeleteUser);
router.delete('/users/:userId', adminWhatsappUserController.handleDeleteUser);

// Aquí podrías añadir otras rutas para administrar usuarios (crear, actualizar)
// router.post('/users', isAdminAuthenticated, adminWhatsappUserController.handleCreateUser);
// router.put('/users/:userId', isAdminAuthenticated, adminWhatsappUserController.handleUpdateUser);

module.exports = router; 