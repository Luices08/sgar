'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error } = require('../utils/response');
const { INVITATION_STATUS, ROLES, VISIT_TYPES } = require('../config/constants');
const Invitation = require('../models/Invitation');
const Visit      = require('../models/Visit');
const Resident   = require('../models/Resident');

// Generar código único de 6 dígitos
const generateCode = async () => {
  let code, exists;
  do {
    code   = String(Math.floor(100000 + Math.random() * 900000));
    exists = await Invitation.findOne({ codigo: code, estado: INVITATION_STATUS.PENDIENTE });
  } while (exists);
  return code;
};

// ─── CREAR INVITACIÓN (desde PWA Residente) ───────────────────────────────────
const create = asyncHandler(async (req, res) => {
  const { nombreVisitante, fechaEsperada, cedulaVisitante, personasEsperadas, tiempo_caducidad } = req.body;
  if (!nombreVisitante || !nombreVisitante.trim()) {
    return error(res, 'El nombre del visitante es requerido', 400);
  }
  if (!cedulaVisitante || !cedulaVisitante.trim()) {
    return error(res, 'La cédula del visitante es obligatoria para el control de entrada/salida', 400);
  }

  const resident = await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);

  const codigo = await generateCode();
  
  // Calcular tiempo_caducidad real
  const duracion = tiempo_caducidad || '1d';
  let expDate = new Date();
  if (typeof duracion === 'string') {
    if (duracion === '12h') expDate.setHours(expDate.getHours() + 12);
    else if (duracion === '1d') expDate.setDate(expDate.getDate() + 1);
    else if (duracion === '2d') expDate.setDate(expDate.getDate() + 2);
    else if (duracion === '3d') expDate.setDate(expDate.getDate() + 3);
    else if (duracion === '5d') expDate.setDate(expDate.getDate() + 5);
    else if (duracion === '7d') expDate.setDate(expDate.getDate() + 7);
    else {
      const parsed = new Date(duracion);
      if (!isNaN(parsed.getTime())) {
        expDate = parsed;
      } else {
        expDate.setDate(expDate.getDate() + 1);
      }
    }
  } else if (duracion instanceof Date && !isNaN(duracion.getTime())) {
    expDate = duracion;
  } else {
    expDate.setDate(expDate.getDate() + 1);
  }

  if (expDate <= new Date()) {
    return error(res, 'La fecha y hora de expiración debe ser posterior a la actual', 400);
  }

  const inv = await Invitation.create({
    tenant_id:         req.tenantId,
    resident_id:       resident._id,
    user_id:           req.user.user_id,
    apartamento:       resident.apartamento,
    nombreVisitante:   nombreVisitante.trim(),
    cedulaVisitante:   cedulaVisitante ? cedulaVisitante.trim() : undefined,
    personasEsperadas: personasEsperadas || 1,
    fechaEsperada:     fechaEsperada ? new Date(fechaEsperada) : new Date(),
    tiempo_caducidad:  expDate,
    codigo,
  });

  return created(res, { invitation: inv, codigo }, 'Invitación creada');
});

// ─── VALIDAR CÓDIGO (desde portería) ─────────────────────────────────────────
const validate = asyncHandler(async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return error(res, 'codigo es requerido', 400);

  const inv = await Invitation.findOne({
    tenant_id: req.tenantId,
    codigo,
    estado: INVITATION_STATUS.PENDIENTE,
  });

  if (!inv) return error(res, 'Código inválido o ya utilizado', 404);

  return ok(res, {
    valid:           true,
    invitation_id:   inv._id,
    nombreVisitante: inv.nombreVisitante,
    cedulaVisitante: inv.cedulaVisitante,
    apartamento:     inv.apartamento,
    fechaEsperada:   inv.fechaEsperada,
  }, 'Código válido');
});

// ─── COMPLETAR INVITACIÓN ─────────────────────────────────────────────────────
const complete = asyncHandler(async (req, res) => {
  const inv = await Invitation.findOne({
    _id: req.params.id,
    tenant_id: req.tenantId,
    estado: INVITATION_STATUS.PENDIENTE,
  });
  if (!inv) return error(res, 'Invitación no encontrada o ya completada', 404);

  // Verificar si el visitante ya tiene un ingreso abierto
  if (inv.cedulaVisitante) {
    const cedTrim = String(inv.cedulaVisitante).trim();
    const openVisitor = await Visit.findOne({
      tenant_id:  req.tenantId,
      tipo:       { $in: ['visita', VISIT_TYPES.VISITA] },
      cedula:     { $regex: new RegExp(`^${cedTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      horaSalida: null,
      eliminado:  false,
    });
    if (openVisitor) {
      return error(
        res,
        `El visitante ${inv.nombreVisitante} (C.C. ${cedTrim}) ya se encuentra dentro de las instalaciones para el Apto ${openVisitor.apartamento} (Hora de ingreso: ${new Date(openVisitor.horaIngreso).toLocaleTimeString('es-CO')}). Debe registrar su salida antes de un nuevo ingreso.`,
        409
      );
    }
  }

  // Crear registro de visita vinculado
  const visit = await Visit.create({
    tenant_id:            req.tenantId,
    tipo:                 'visita',
    nombre:               inv.nombreVisitante,
    cedula:               inv.cedulaVisitante,
    apartamento:          inv.apartamento,
    horaIngreso:          new Date(),
    celador_id:           req.user.user_id,
    celador_nombre:       req.user.nombre,
    metodoIdentificacion: 'codigo_invitacion',
    invitation_id:        inv._id,
    syncStatus:           'sincronizado',
  });

  inv.estado           = INVITATION_STATUS.COMPLETADO;
  inv.visit_id         = visit._id;
  inv.fechaResolucion  = new Date();
  await inv.save();

  // Notificar al residente
  try {
    const Notification = require('../models/Notification');
    await Notification.create({
      tenant_id:         req.tenantId,
      user_id:           inv.user_id || null,
      apartamento:       inv.apartamento,
      tipo:              'visita',
      titulo:            `Visita de ${inv.nombreVisitante} — Apto ${inv.apartamento}`,
      mensaje:           `Tu invitado ${inv.nombreVisitante} (C.C. ${inv.cedulaVisitante || '—'}) ingresó con código a las ${new Date().toLocaleTimeString('es-CO')}.`,
      visit_id:          visit._id,
      requiereRespuesta: false,
    });
  } catch (_) {}

  return ok(res, { visit, invitation: inv }, 'Invitación completada y visita registrada');
});

// ─── LISTAR MIS INVITACIONES ──────────────────────────────────────────────────
const myInvitations = asyncHandler(async (req, res) => {
  const invitations = await Invitation.find({
    user_id:   req.user.user_id,
    tenant_id: req.tenantId,
  }).sort({ createdAt: -1 }).limit(50).lean();
  return ok(res, invitations);
});

// ─── CANCELAR INVITACIÓN ──────────────────────────────────────────────────────
const cancel = asyncHandler(async (req, res) => {
  const inv = await Invitation.findOne({
    _id:       req.params.id,
    user_id:   req.user.user_id,
    tenant_id: req.tenantId,
    estado:    INVITATION_STATUS.PENDIENTE,
  });
  if (!inv) return error(res, 'Invitación no encontrada', 404);
  inv.estado          = INVITATION_STATUS.CANCELADO;
  inv.fechaResolucion = new Date();
  await inv.save();
  return ok(res, { invitation: inv }, 'Invitación cancelada');
});

module.exports = { create, validate, complete, myInvitations, cancel };
