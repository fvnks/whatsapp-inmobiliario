/**
 * Middleware para manejar errores en la aplicación
 * @param {Error} err - Error capturado
 * @param {Object} req - Objeto de solicitud
 * @param {Object} res - Objeto de respuesta
 * @param {Function} next - Función para pasar al siguiente middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.stack);

  // Determinar el tipo de error para respuestas personalizadas
  let statusCode = 500;
  let message = 'Error interno del servidor';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError' || err.message === 'Unauthorized') {
    statusCode = 401;
    message = 'No autorizado';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    message = 'Acceso prohibido';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    message = 'Recurso no encontrado';
  }

  // Formatear respuesta según el tipo de solicitud
  if (req.accepts('json')) {
    res.status(statusCode).json({
      error: {
        status: statusCode,
        message: message,
        ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
      }
    });
  } else {
    res.status(statusCode).render('error', {
      title: 'Error',
      statusCode,
      message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : ''
    });
  }
};

/**
 * Clase personalizada para errores de validación
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Clase personalizada para errores de recursos no encontrados
 */
class NotFoundError extends Error {
  constructor(message = 'Recurso no encontrado') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Clase personalizada para errores de autorización
 */
class UnauthorizedError extends Error {
  constructor(message = 'No autorizado') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Clase personalizada para errores de permisos
 */
class ForbiddenError extends Error {
  constructor(message = 'Acceso prohibido') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

module.exports = {
  errorHandler,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError
}; 