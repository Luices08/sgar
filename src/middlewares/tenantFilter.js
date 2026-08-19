'use strict';

const { error }  = require('../utils/response');
const { ROLES }  = require('../config/constants');
const Tenant     = require('../models/Tenant');

/**
 * Middleware de aislamiento de tenant.
 *
 * - AdminControl (SuperAdmin): puede acceder a cualquier tenant.
 *   Si envía 'x-tenant-id' en headers, o ?tenant_id=xxx en query o body, ese valor se usa como filtro.
 *   Si no pasa nada, req.tenantId queda null (acceso global a todos los conjuntos).
 *
 * - Todos los demás roles (AdminConjunto, Celador, Residente):
 *   req.tenantId se establece EXCLUSIVAMENTE desde el JWT autenticado (req.user.tenant_id).
 *   Cualquier intento de suplantación en headers/query/body es ignorado.
 *   Además, valida en caliente que el conjunto no esté suspendido o archivado.
 *
 * Se encadena DESPUÉS de auth().
 */
const tenantFilter = async (req, res, next) => {
  if (!req.user) {
    return error(res, 'No autenticado', 401);
  }

  if (req.user.rol === ROLES.ADMIN_CONTROL) {
    // AdminControl puede consultar un tenant específico o todos
    req.tenantId = req.headers['x-tenant-id'] || req.query.tenant_id || req.body?.tenant_id || null;
    return next();
  }

  // Demás roles: solo su propio tenant
  if (!req.user.tenant_id) {
    return error(res, 'Usuario sin conjunto residencial asignado', 403);
  }

  req.tenantId = req.user.tenant_id;

  try {
    const tenant = await Tenant.findById(req.user.tenant_id)
      .select('estado activo eliminado motivoSuspension nombre')
      .lean();

    if (!tenant || tenant.eliminado) {
      return error(res, 'El conjunto residencial asignado no existe o ha sido archivado', 403);
    }

    if (tenant.estado === 'suspendido' || !tenant.activo || tenant.estado !== 'activo') {
      const motivo = tenant.motivoSuspension ? ` (${tenant.motivoSuspension})` : '';
      return error(res, `El conjunto residencial '${tenant.nombre}' se encuentra ${tenant.estado || 'inactivo'}${motivo}. Operación no permitida.`, 403);
    }

    next();
  } catch (err) {
    return error(res, 'Error al verificar el estado del conjunto residencial', 500);
  }
};

module.exports = tenantFilter;
