'use strict';

const asyncHandler      = require('../utils/asyncHandler');
const { ok }            = require('../utils/response');
const { ROLES }          = require('../config/constants');
const Notification      = require('../models/Notification');
const Visit             = require('../models/Visit');
const VehicleInvitation = require('../models/VehicleInvitation');
const Resident          = require('../models/Resident');

/**
 * GET /api/notifications/poll
 * Endpoint unificado de polling ligero en tiempo real.
 * Consulta únicamente si existen cambios o eventos nuevos desde 'since'
 * respetando roles y aislamiento multitenant.
 */
const pollUpdates = asyncHandler(async (req, res) => {
  const user = req.user;
  let since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 30 * 1000);
  if (isNaN(since.getTime())) {
    since = new Date(Date.now() - 30 * 1000);
  }

  const now = new Date();
  const events = [];
  let counts = {
    unreadNotifications: 0,
    pendingDeliveries: 0,
    pendingInvitations: 0,
    activeVisits: 0,
    unresolvedAlerts: 0,
  };

  // 1. RESIDENTE
  if (user.rol === ROLES.RESIDENTE) {
    let residentId = user.resident_id;
    let apartamento = user.apartamento;

    if (!residentId || !apartamento) {
      const resDoc = await Resident.findOne({ user_id: user.user_id, tenant_id: req.tenantId }).lean();
      if (resDoc) {
        residentId = resDoc._id;
        apartamento = resDoc.apartamento;
      }
    }

    // A) Notificaciones nuevas o actualizadas
    const notifQuery = {
      tenant_id: req.tenantId,
      $or: [
        { user_id: user.user_id },
        ...(apartamento ? [{ apartamento }] : []),
      ],
    };

    const [recentNotifs, unreadCount, pendingDeliveriesCount, pendingInvitationsCount] = await Promise.all([
      Notification.find({
        ...notifQuery,
        updatedAt: { $gt: since },
      }).sort({ updatedAt: -1 }).limit(10).lean(),
      Notification.countDocuments({
        ...notifQuery,
        leida: false,
      }),
      apartamento ? Visit.countDocuments({
        tenant_id: req.tenantId,
        apartamento,
        tipo: 'domicilio',
        estadoDomicilio: 'pendiente',
        eliminado: false,
      }) : 0,
      residentId ? VehicleInvitation.countDocuments({
        tenant_id: req.tenantId,
        residenteInvitado_id: residentId,
        estado: 'pendiente',
      }) : 0,
    ]);

    counts.unreadNotifications = unreadCount;
    counts.pendingDeliveries = pendingDeliveriesCount;
    counts.pendingInvitations = pendingInvitationsCount;

    recentNotifs.forEach(n => {
      events.push({
        type: n.tipo,
        id: n._id,
        titulo: n.titulo,
        mensaje: n.mensaje,
        estadoDomicilio: n.estadoDomicilio,
        estadoAprobacion: n.estadoAprobacion,
        requiereRespuesta: n.requiereRespuesta,
        timestamp: n.updatedAt,
      });
    });

    // B) Visitas / Domicilios del apartamento actualizados recientemente
    if (apartamento) {
      const recentVisits = await Visit.find({
        tenant_id: req.tenantId,
        apartamento,
        updatedAt: { $gt: since },
        eliminado: false,
      }).sort({ updatedAt: -1 }).limit(5).lean();

      recentVisits.forEach(v => {
        if (!events.some(e => e.id && e.id.toString() === v._id.toString())) {
          events.push({
            type: v.tipo === 'domicilio' ? 'domicilio' : 'visita',
            id: v._id,
            nombre: v.nombre || v.empresa,
            estadoDomicilio: v.estadoDomicilio,
            fechaRecepcion: v.fechaRecepcion,
            recibidoPorNombre: v.recibidoPorNombre,
            horaIngreso: v.horaIngreso,
            horaSalida: v.horaSalida,
            timestamp: v.updatedAt,
          });
        }
      });
    }
  }

  // 2. CELADOR / ADMIN CONJUNTO
  else if (user.rol === ROLES.CELADOR || user.rol === ROLES.ADMIN_CONJUNTO) {
    const [recentVisits, recentAlerts, recentInvitations, activeVisitorsCount, pendingInvitationsCount] = await Promise.all([
      // Visitas, salidas y domicilios en el conjunto actualizados recientemente
      Visit.find({
        tenant_id: req.tenantId,
        updatedAt: { $gt: since },
        eliminado: false,
      }).sort({ updatedAt: -1 }).limit(15).lean(),
      // Alertas de ayuda, emergencias o respuestas de residentes
      Notification.find({
        tenant_id: req.tenantId,
        tipo: { $in: ['solicitud_ayuda', 'panico', 'emergencia', 'permiso_aprobado', 'permiso_rechazado', 'alerta_vehiculo_no_autorizado'] },
        updatedAt: { $gt: since },
      }).sort({ updatedAt: -1 }).limit(5).lean(),
      // Invitaciones creadas o actualizadas recientemente
      Invitation.find({
        tenant_id: req.tenantId,
        updatedAt: { $gt: since },
      }).sort({ updatedAt: -1 }).limit(15).lean(),
      // Visitantes y domiciliarios activos adentro (sin salida)
      Visit.countDocuments({
        tenant_id: req.tenantId,
        tipo: { $in: ['visita', 'domicilio'] },
        horaSalida: null,
        eliminado: false,
      }),
      // Invitaciones vigentes pendientes por ingresar
      Invitation.countDocuments({
        tenant_id: req.tenantId,
        estado: { $in: ['pendiente', 'activa'] },
        $or: [
          { tiempo_caducidad: { $gte: now } },
          { tiempo_caducidad: null },
          { tiempo_caducidad: { $exists: false } },
        ],
      }),
    ]);

    counts.activeVisitors = activeVisitorsCount;
    counts.pendingInvitations = pendingInvitationsCount;
    counts.activeVisits = activeVisitorsCount;

    recentVisits.forEach(v => {
      events.push({
        type: v.tipo || 'visita',
        id: v._id,
        nombre: v.nombre || v.empresa,
        apartamento: v.apartamento,
        tipoAcceso: v.tipo,
        metodoIngreso: v.metodoIngreso,
        metodoSalida: v.metodoSalida,
        estadoDomicilio: v.estadoDomicilio,
        fechaRecepcion: v.fechaRecepcion,
        recibidoPorNombre: v.recibidoPorNombre,
        horaIngreso: v.horaIngreso,
        horaSalida: v.horaSalida,
        timestamp: v.updatedAt,
      });
    });

    recentAlerts.forEach(a => {
      events.push({
        type: a.tipo,
        id: a._id,
        titulo: a.titulo,
        mensaje: a.mensaje,
        apartamento: a.apartamento,
        timestamp: a.updatedAt,
      });
    });

    recentInvitations.forEach(inv => {
      events.push({
        type: 'nueva_invitacion',
        id: inv._id,
        nombreVisitante: inv.nombreVisitante,
        apartamento: inv.apartamento,
        codigo: inv.codigo,
        estado: inv.estado,
        tiempo_caducidad: inv.tiempo_caducidad,
        timestamp: inv.updatedAt,
      });
    });
  }

  // 3. SUPERADMIN
  else if (user.rol === ROLES.ADMIN_CONTROL) {
    const [activeVisitsCount] = await Promise.all([
      Visit.countDocuments({ horaSalida: null, eliminado: false }),
    ]);
    counts.activeVisits = activeVisitsCount;
  }

  return ok(res, {
    timestamp: now.toISOString(),
    hasChanges: events.length > 0,
    counts,
    events,
  });
});

module.exports = {
  pollUpdates,
};
