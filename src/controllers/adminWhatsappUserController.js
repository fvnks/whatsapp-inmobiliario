const whatsappUserService = require('../services/whatsappUserService');
// Asegúrate que la ruta a loggingService sea la correcta.
// Si loggingService está en src/services:
const { logger } = require('../services/loggingService'); 

const SERVICE_NAME = 'AdminWhatsappUserController';

const handleGetAllUsers = async (req, res) => {
  logger.info('HANDLE_GET_ALL_USERS_REQUEST', 'Received request to get all WhatsApp users.', {}, null, null, SERVICE_NAME);
  try {
    const users = await whatsappUserService.getAllUsers();
    logger.info('HANDLE_GET_ALL_USERS_SUCCESS', `Successfully fetched ${users.length} users via controller.`, { count: users.length }, null, null, SERVICE_NAME);
    return res.status(200).json({ success: true, users });
  } catch (error) {
    logger.error('HANDLE_GET_ALL_USERS_CONTROLLER_ERROR', 'Controller error while attempting to fetch all users.', { error: error.message, stack: error.stack }, null, null, SERVICE_NAME);
    return res.status(500).json({ success: false, message: 'Error interno del servidor al obtener los usuarios.' });
  }
};

const handleDeleteUser = async (req, res) => {
  const { userId } = req.params;
  logger.info('HANDLE_DELETE_USER_REQUEST', `Received request to delete user.`, { userId }, null, String(userId), SERVICE_NAME);

  if (!userId || isNaN(parseInt(userId))) {
    logger.warn('HANDLE_DELETE_USER_INVALID_ID', 'Invalid user ID provided in request.', { userIdReceived: userId }, null, String(userId), SERVICE_NAME);
    return res.status(400).json({ success: false, message: 'ID de usuario inválido.' });
  }

  try {
    const success = await whatsappUserService.deleteUser(parseInt(userId));
    if (success) {
      logger.info('HANDLE_DELETE_USER_SUCCESS', 'User successfully deleted via controller.', { userId }, null, String(userId), SERVICE_NAME);
      return res.status(200).json({ success: true, message: 'Usuario eliminado exitosamente.' });
    } else {
      logger.warn('HANDLE_DELETE_USER_NOT_FOUND_OR_FAILED', 'User not found or deletion failed at service level.', { userId }, null, String(userId), SERVICE_NAME);
      return res.status(404).json({ success: false, message: 'Usuario no encontrado o no se pudo eliminar.' });
    }
  } catch (error) { 
    logger.error('HANDLE_DELETE_USER_CONTROLLER_ERROR', 'Controller error while attempting to delete user.', { userId, error: error.message, stack: error.stack }, null, String(userId), SERVICE_NAME);
    return res.status(500).json({ success: false, message: 'Error interno del servidor al intentar eliminar el usuario.' });
  }
};

module.exports = {
  handleGetAllUsers,
  handleDeleteUser,
}; 