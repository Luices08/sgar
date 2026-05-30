'use strict';

const asyncHandler   = require('../utils/asyncHandler');
const { ok, error }  = require('../utils/response');
const Notification   = require('../models/Notification');

// Obtener notificaciones del usuario autenticado
const myNotifications = asyncHandler(async (req, res) => {
  const notifs = await Notification.find({
    user_id: req.user.user_id,
    tenant_id: req.tenantId,
  }).sort({ createdAt: -1 }).limit(50).lean();

  const unread = notifs.filter((n) => !n.leida).length;
  return ok(res, { notifications: notifs, unread });
});

// Marcar como leída
const markRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user_id: req.user.user_id, tenant_id: req.tenantId, leida: false },
    { leida: true }
  );
  return ok(res, {}, 'Notificaciones marcadas como leídas');
});

module.exports = { myNotifications, markRead };
