'use strict';

/**
 * Respuesta exitosa estándar
 */
const ok = (res, data = {}, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

/**
 * Respuesta de creación exitosa
 */
const created = (res, data = {}, message = 'Creado exitosamente') =>
  ok(res, data, message, 201);

/**
 * Respuesta de error estándar
 */
const error = (res, message = 'Error interno', status = 500, details = null) =>
  res.status(status).json({
    success: false,
    message,
    ...(details && { details }),
  });

/**
 * Respuesta paginada
 */
const paginated = (res, data, total, page, limit) =>
  res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page:       Number(page),
      limit:      Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  });

module.exports = { ok, created, error, paginated };
