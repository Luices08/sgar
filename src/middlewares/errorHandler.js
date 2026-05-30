'use strict';

/**
 * Middleware 404 — ruta no encontrada
 */
const notFound = (req, res, next) => {
  const error = new Error(`Ruta no encontrada: ${req.originalUrl}`);
  error.status = 404;
  next(error);
};

/**
 * Middleware de manejo global de errores
 */
const errorHandler = (err, req, res, next) => {
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  // Log detallado solo en desarrollo
  if (process.env.NODE_ENV === 'development') {
    console.error(`[ERROR ${status}] ${message}`);
    if (err.stack) console.error(err.stack);
  }

  // Respuesta JSON para rutas de API
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({
      success: false,
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  // Respuesta HTML para rutas de vistas
  return res.status(status).render('error', {
    title:   `Error ${status}`,
    message,
    status,
  });
};

module.exports = { notFound, errorHandler };
