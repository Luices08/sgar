'use strict';

/**
 * Envuelve funciones async de Express para capturar errores y pasarlos a next()
 * Evita repetir try/catch en todos los controllers
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
