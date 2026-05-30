'use strict';

const { error }  = require('../utils/response');
const { ROLES }  = require('../config/constants');

/**
 * Middleware de aislamiento de tenant.
 *
 * - AdminControl: puede acceder a cualquier tenant.
 *   Si pasa ?tenant_id=xxx en query, ese valor se usa como filtro.
 *   Si no pasa nada, req.tenantId queda null (acceso global).
 *
 * - Todos los demás roles: solo pueden acceder a su propio tenant.
 *   req.tenantId se establece desde el JWT.
 *
 * Se encadena DESPUÉS de auth().
 */
const tenantFilter = (req, res, next) => {
  if (!req.user) {
    return error(res, 'No autenticado', 401);
  }

  if (req.user.rol === ROLES.ADMIN_CONTROL) {
    // AdminControl puede consultar un tenant específico o todos
    req.tenantId = req.query.tenant_id || req.body.tenant_id || null;
  } else {
    // Demás roles: solo su propio tenant
    if (!req.user.tenant_id) {
      return error(res, 'Usuario sin tenant asignado', 403);
    }
    req.tenantId = req.user.tenant_id;
  }

  next();
};

module.exports = tenantFilter;
