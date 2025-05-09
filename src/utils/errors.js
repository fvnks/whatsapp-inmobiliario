/**
 * Clase base para errores personalizados
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error para recursos no encontrados (404)
 */
class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404);
  }
}

/**
 * Error para validaciones fallidas (400)
 */
class ValidationError extends AppError {
  constructor(message = 'Datos inválidos') {
    super(message, 400);
  }
}

/**
 * Error para autenticación fallida (401)
 */
class AuthenticationError extends AppError {
  constructor(message = 'No autenticado') {
    super(message, 401);
  }
}

/**
 * Error para acceso no autorizado (403)
 */
class AuthorizationError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 403);
  }
}

/**
 * Error para conflictos de recursos (409)
 */
class ConflictError extends AppError {
  constructor(message = 'Conflicto de recursos') {
    super(message, 409);
  }
}

/**
 * Error para servicio no disponible (503)
 */
class ServiceUnavailableError extends AppError {
  constructor(message = 'Servicio no disponible') {
    super(message, 503);
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ServiceUnavailableError
}; 