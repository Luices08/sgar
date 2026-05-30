'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error } = require('../utils/response');
const { INVITATION_STATUS, ROLES } = require('../config/constants');
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
  const { nombreVisitante, fechaEsperada } = req.body;
  if (!nombreVisitante || !fechaEsperada) {
    return error(res, 'nombreVisitante y fechaEsperada son requeridos', 400);
  }

  const resident = await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);

  const codigo = await generateCode();
  const inv = await Invitation.create({
    tenant_id:       req.tenantId,
    resident_id:     resident._id,
    user_id:         req.user.user_id,
    apartamento:     resident.apartamento,
    nombreVisitante,
    fechaEsperada:   new Date(fechaEsperada),
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
    valid:          true,
    invitation_id:  inv._id,
    nombreVisitante:inv.nombreVisitante,
    apartamento:    inv.apartamento,
    fechaEsperada:  inv.fechaEsperada,
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

  // Crear registro de visita vinculado
  const visit = await Visit.create({
    tenant_id:            req.tenantId,
    tipo:                 'visita',
    nombre:               inv.nombreVisitante,
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

  return ok(res, { visit, invitation: inv }, 'Invitación completada y visita registrada');
});

// ─── LISTAR MIS INVITACIONES ──────────────────────────────────────────────────
const myInvitations = asyncHandler(async (req, res) => {
  const invitations = await Invitation.find({
    user_id:   req.user.user_id,
    tenant_id: req.tenantId,
  }).sort({ createdAt: -1 }).limit(20).lean();
  return ok(res, { invitations });
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
