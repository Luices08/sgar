'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { VISIT_TYPES, SYNC_STATUS }      = require('../config/constants');

const Visit        = require('../models/Visit');
const Notification = require('../models/Notification');
const Resident     = require('../models/Resident');
const User         = require('../models/User');

// ─── LISTAR VISITAS ───────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = {
    tenant_id: req.tenantId,
    eliminado: false,
  };

  if (req.query.tipo)        filter.tipo        = req.query.tipo;
  if (req.query.apartamento) filter.apartamento = req.query.apartamento.toUpperCase();
  if (req.query.celador_id)  filter.celador_id  = req.query.celador_id;
  if (req.query.fecha) {
    const d = new Date(req.query.fecha);
    filter.horaIngreso = {
      $gte: new Date(d.setHours(0, 0, 0, 0)),
      $lte: new Date(d.setHours(23, 59, 59, 999)),
    };
  }

  const [visits, total] = await Promise.all([
    Visit.find(filter).sort({ horaIngreso: -1 }).skip(skip).limit(limit).lean(),
    Visit.countDocuments(filter),
  ]);

  return paginated(res, visits, total, page, limit);
});

// ─── OBTENER UNA VISITA ───────────────────────────────────────────────────────
const getOne = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  return ok(res, { visit });
});

// ─── CREAR VISITA (regla write-through: viene desde Dexie.js ya guardado) ────
const create = asyncHandler(async (req, res) => {
  const {
    tipo, nombre, cedula, empresa, placa,
    apartamento, horaIngreso, metodoIdentificacion,
    invitation_id, localId, syncStatus,
  } = req.body;

  if (!tipo || !apartamento) {
    return error(res, 'tipo y apartamento son requeridos', 400);
  }

  // Deduplicar: si ya existe un registro con el mismo localId, retornar OK
  if (localId) {
    const existing = await Visit.findOne({ localId, tenant_id: req.tenantId });
    if (existing) return ok(res, { visit: existing }, 'Ya sincronizado');
  }

  const visit = await Visit.create({
    tenant_id:            req.tenantId,
    tipo,
    nombre,
    cedula,
    empresa,
    placa,
    apartamento:          apartamento.toUpperCase(),
    horaIngreso:          horaIngreso || new Date(),
    celador_id:           req.user.user_id,
    celador_nombre:       req.user.nombre,
    metodoIdentificacion: metodoIdentificacion || 'manual',
    invitation_id:        invitation_id || null,
    localId:              localId || null,
    syncStatus:           SYNC_STATUS.SINCRONIZADO,
  });

  // Crear notificación interna para el residente del apartamento
  await _crearNotificacion(visit, req.tenantId);

  return created(res, { visit }, 'Registro creado');
});

// ─── SINCRONIZACIÓN BATCH (múltiples registros desde Dexie.js) ───────────────
const syncBatch = asyncHandler(async (req, res) => {
  const { registros } = req.body;

  if (!Array.isArray(registros) || registros.length === 0) {
    return error(res, 'Se requiere el array "registros"', 400);
  }

  const results = { created: 0, skipped: 0, errors: [] };

  for (const reg of registros) {
    try {
      if (reg.localId) {
        const existing = await Visit.findOne({ localId: reg.localId, tenant_id: req.tenantId });
        if (existing) { results.skipped++; continue; }
      }

      await Visit.create({
        tenant_id:            req.tenantId,
        tipo:                 reg.tipo,
        nombre:               reg.nombre,
        cedula:               reg.cedula,
        empresa:              reg.empresa,
        placa:                reg.placa,
        apartamento:          (reg.apartamento || '').toUpperCase(),
        horaIngreso:          reg.horaIngreso || new Date(),
        horaSalida:           reg.horaSalida || null,
        celador_id:           reg.celador_id || req.user.user_id,
        celador_nombre:       reg.celador_nombre || req.user.nombre,
        metodoIdentificacion: reg.metodoIdentificacion || 'manual',
        localId:              reg.localId || null,
        syncStatus:           SYNC_STATUS.SINCRONIZADO,
      });

      results.created++;
    } catch (e) {
      results.errors.push({ localId: reg.localId, error: e.message });
    }
  }

  return ok(res, results, `Sincronización completada: ${results.created} creados, ${results.skipped} ya existían`);
});

// ─── REGISTRAR SALIDA ─────────────────────────────────────────────────────────
const registerExit = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  if (visit.horaSalida) return error(res, 'Este registro ya tiene hora de salida', 400);

  visit.horaSalida = req.body.horaSalida || new Date();
  await visit.save();
  return ok(res, { visit }, 'Salida registrada');
});

// ─── EDITAR VISITA (solo turno activo — auditLog obligatorio) ─────────────────
const update = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  if (visit.eliminado) return error(res, 'No se puede editar un registro eliminado', 400);

  const camposEditables = ['nombre', 'cedula', 'empresa', 'placa', 'apartamento', 'horaIngreso', 'horaSalida'];
  const camposAnteriores = {};
  const camposNuevos     = {};

  for (const campo of camposEditables) {
    if (req.body[campo] !== undefined && req.body[campo] !== visit[campo]) {
      camposAnteriores[campo] = visit[campo];
      camposNuevos[campo]     = req.body[campo];
      visit[campo] = campo === 'apartamento' ? req.body[campo].toUpperCase() : req.body[campo];
    }
  }

  if (Object.keys(camposNuevos).length === 0) {
    return ok(res, { visit }, 'Sin cambios');
  }

  // Registrar en auditLog
  visit.auditLog.push({
    timestamp:       new Date(),
    celador_id:      req.user.user_id,
    celador_nombre:  req.user.nombre,
    accion:          'edicion',
    camposAnteriores,
    camposNuevos,
  });

  await visit.save();
  return ok(res, { visit }, 'Registro actualizado');
});

// ─── ELIMINAR VISITA (soft delete + auditLog) ─────────────────────────────────
const remove = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  if (visit.eliminado) return error(res, 'El registro ya fue eliminado', 400);

  visit.eliminado = true;
  visit.auditLog.push({
    timestamp:       new Date(),
    celador_id:      req.user.user_id,
    celador_nombre:  req.user.nombre,
    accion:          'eliminacion',
    camposAnteriores: visit.toObject(),
    camposNuevos:    null,
  });

  await visit.save();
  return ok(res, {}, 'Registro eliminado (soft delete)');
});

// ─── ANALYTICS DEL CONJUNTO ───────────────────────────────────────────────────
const analytics = asyncHandler(async (req, res) => {
  const hoy   = new Date();
  const inicio = new Date(hoy.setHours(0, 0, 0, 0));
  const fin    = new Date(hoy.setHours(23, 59, 59, 999));

  const [porTipo, porFranja] = await Promise.all([
    // Distribución por tipo hoy
    Visit.aggregate([
      { $match: { tenant_id: req.tenantId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: '$tipo', count: { $sum: 1 } } },
    ]),
    // Picos por franja de 2 horas
    Visit.aggregate([
      { $match: { tenant_id: req.tenantId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      {
        $group: {
          _id: { $floor: { $divide: [{ $hour: '$horaIngreso' }, 2] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return ok(res, { porTipo, porFranja });
});

// ─── HELPER PRIVADO: CREAR NOTIFICACIÓN ───────────────────────────────────────
async function _crearNotificacion(visit, tenantId) {
  try {
    // Buscar residente del apartamento para encontrar su user_id
    const resident = await Resident.findOne({
      tenant_id: tenantId,
      apartamento: visit.apartamento,
      activo: true,
    });

    if (!resident || !resident.user_id) return;

    const tipo    = visit.tipo;
    const titulo  = tipo === 'domicilio'
      ? `Domicilio de ${visit.empresa || 'empresa'} — Apto ${visit.apartamento}`
      : tipo === 'vehiculo'
        ? `Vehículo ${visit.placa} — Apto ${visit.apartamento}`
        : `Visita de ${visit.nombre || 'persona'} — Apto ${visit.apartamento}`;

    await Notification.create({
      tenant_id:   tenantId,
      user_id:     resident.user_id,
      apartamento: visit.apartamento,
      tipo,
      titulo,
      mensaje:     `Registrado a las ${new Date(visit.horaIngreso).toLocaleTimeString('es-CO')}`,
      visit_id:    visit._id,
    });
  } catch (_) {
    // No interrumpir el flujo si la notificación falla
  }
}

// ─── VERIFICAR CÓDIGO DE INVITACIÓN ──────────────────────────────────────────
const verificarCodigo = asyncHandler(async (req, res) => {
  const { codigo } = req.body;
  const Invitation = require('../models/Invitation');
  const inv = await Invitation.findOne({ codigo, tenant_id: req.tenantId, estado: 'pendiente' });
  
  if (!inv) return error(res, 'Código inválido o ya utilizado', 404);
  
  if (inv.tiempo_caducidad < new Date()) {
    inv.estado = 'archivada';
    await inv.save();
    return error(res, 'El código ha expirado', 400);
  }
  
  return ok(res, { invitation: inv }, 'Código verificado exitosamente');
});

// ─── REGISTRAR INGRESO CON CÓDIGO ────────────────────────────────────────────
const registrarIngreso = asyncHandler(async (req, res) => {
  const { codigo } = req.body;
  const Invitation = require('../models/Invitation');
  
  const inv = await Invitation.findOne({ codigo, tenant_id: req.tenantId, estado: 'pendiente' });
  if (!inv) return error(res, 'Código inválido o ya utilizado', 404);
  
  if (inv.tiempo_caducidad < new Date()) {
    inv.estado = 'archivada';
    await inv.save();
    return error(res, 'El código ha expirado', 400);
  }

  // Registrar la visita real
  const visit = await Visit.create({
    tenant_id: req.tenantId,
    tipo: 'visita',
    nombre: inv.nombreVisitante,
    cedula: inv.cedulaVisitante,
    apartamento: inv.apartamento,
    horaIngreso: new Date(),
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    metodoIdentificacion: 'codigo_invitacion',
    invitation_id: inv._id,
    syncStatus: SYNC_STATUS.SINCRONIZADO,
  });

  // Marcar invitación como completada
  inv.estado = 'completado';
  inv.visit_id = visit._id;
  inv.fechaResolucion = new Date();
  await inv.save();

  // Opcional: Notificar al residente que su visita ingresó
  await _crearNotificacion(visit, req.tenantId);

  return created(res, { visit, invitation: inv }, 'Ingreso registrado exitosamente');
});

// ─── OBTENER INVITACIONES PENDIENTES DEL CONJUNTO ────────────────────────────
const getPendientes = asyncHandler(async (req, res) => {
  const Invitation = require('../models/Invitation');
  // Buscar todas las pendientes que no han expirado
  const now = new Date();
  const pendientes = await Invitation.find({
    tenant_id: req.tenantId,
    estado: 'pendiente',
    tiempo_caducidad: { $gte: now }
  }).sort({ tiempo_caducidad: 1 }).lean();

  return ok(res, { invitaciones: pendientes });
});

module.exports = { list, getOne, create, syncBatch, registerExit, update, remove, analytics, verificarCodigo, registrarIngreso, getPendientes };
