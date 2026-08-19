'use strict';

const asyncHandler   = require('../utils/asyncHandler');
const { ok, error }  = require('../utils/response');
const Notification   = require('../models/Notification');

const Resident = require('../models/Resident');

// Obtener notificaciones del usuario autenticado
const myNotifications = asyncHandler(async (req, res) => {
  let resident = null;
  if (req.user.resident_id) {
    resident = await Resident.findById(req.user.resident_id).lean();
  }
  if (!resident) {
    resident = await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();
  }

  const query = {
    tenant_id: req.tenantId,
  };
  if (resident && resident.apartamento) {
    const aptoReg = new RegExp(`^${resident.apartamento.trim()}$`, 'i');
    query.$or = [
      { user_id: req.user.user_id },
      { apartamento: aptoReg },
    ];
  } else {
    query.user_id = req.user.user_id;
  }

  const notifs = await Notification.find(query).sort({ createdAt: -1 }).limit(50).lean();

  const unread = notifs.filter((n) => !n.leida).length;
  return ok(res, notifs, 'Notificaciones obtenidas');
});

// Marcar todas como leídas
const markRead = asyncHandler(async (req, res) => {
  let resident = null;
  if (req.user.resident_id) {
    resident = await Resident.findById(req.user.resident_id).lean();
  }
  if (!resident) {
    resident = await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();
  }

  const query = {
    tenant_id: req.tenantId,
    leida: false,
  };
  if (resident && resident.apartamento) {
    const aptoReg = new RegExp(`^${resident.apartamento.trim()}$`, 'i');
    query.$or = [
      { user_id: req.user.user_id },
      { apartamento: aptoReg },
    ];
  } else {
    query.user_id = req.user.user_id;
  }

  await Notification.updateMany(query, { leida: true });
  return ok(res, {}, 'Notificaciones marcadas como leídas');
});

// Marcar una notificación individual como leída
const markOneRead = asyncHandler(async (req, res) => {
  await Notification.updateOne(
    { _id: req.params.id, tenant_id: req.tenantId },
    { leida: true }
  );
  return ok(res, {}, 'Notificación marcada como leída');
});

// ─── AUTORIZACIÓN DE VISITA ────────────────────────────────────────────────────

// Celador solicita autorización
const requestAuth = asyncHandler(async (req, res) => {
  const { user_id, apartamento, visitorName } = req.body;
  const nombreVis = visitorName || 'Alguien';
  
  const notif = await Notification.create({
    tenant_id: req.tenantId,
    user_id: user_id,
    apartamento: apartamento,
    tipo: 'autorizacion_visita',
    titulo: 'Solicitud de Ingreso',
    mensaje: `${nombreVis} solicita ingresar a tu apartamento.`,
    requiereRespuesta: true,
    estadoAprobacion: 'pendiente'
  });

  return ok(res, { notification_id: notif._id }, 'Notificación enviada');
});

// Celador consulta el estado
const authStatus = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id).lean();
  if (!notif) return error(res, 'Notificación no encontrada', 404);
  return ok(res, { status: notif.estadoAprobacion });
});

// Residente acepta/rechaza
const resolveAuth = asyncHandler(async (req, res) => {
  const { status } = req.body; // 'aprobado' o 'rechazado'
  if (!['aprobado', 'rechazado'].includes(status)) return error(res, 'Estado inválido', 400);

  const notif = await Notification.findOne({ _id: req.params.id, user_id: req.user.user_id });
  if (!notif) return error(res, 'Notificación no encontrada', 404);

  notif.estadoAprobacion = status;
  notif.requiereRespuesta = false; // ya respondió
  notif.leida = true;
  await notif.save();

  return ok(res, { notif }, `Visita ${status}`);
});

module.exports = { myNotifications, markRead, markOneRead, requestAuth, authStatus, resolveAuth };
