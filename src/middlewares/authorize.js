'use strict';

const { error } = require('../utils/response');
const { ROLES }  = require('../config/constants');

/**
 * Middleware de autorización por rol.
 * Uso: authorize('adminControl', 'adminConjunto')
 * Se encadena DESPUÉS de auth()
 */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return error(res, 'No autenticado', 401);
  }

  if (!allowedRoles.includes(req.user.rol)) {
    return error(res, 'Acceso denegado: permisos insuficientes', 403);
  }

  next();
};

/**
 * Acceso exclusivo para AdminControl
 */
authorize.onlyAdmin = authorize(ROLES.ADMIN_CONTROL);

/**
 * Acceso para AdminControl y AdminConjunto
 */
authorize.adminAndConjunto = authorize(ROLES.ADMIN_CONTROL, ROLES.ADMIN_CONJUNTO);

/**
 * Acceso para roles operativos del conjunto
 */
authorize.conjuntoStaff = authorize(
  ROLES.ADMIN_CONTROL,
  ROLES.ADMIN_CONJUNTO,
  ROLES.CELADOR
);

module.exports = authorize;
