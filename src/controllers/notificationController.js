'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, error } = require('../utils/response');
const Notification = require('../models/Notification');

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

// ─── AUTORIZACIÓN DE VISITA Y PERMISOS VEHICULARES ─────────────────────────────
const VehiclePermission = require('../models/VehiclePermission');
const Vehicle = require('../models/Vehicle');
const User = require('../models/User');

// Celador solicita autorización (visita peatonal o uso de vehículo registrado)
const requestAuth = asyncHandler(async (req, res) => {
  const {
    user_id,
    apartamento,
    visitorName,
    cedula,
    tipo, // 'autorizacion_visita' | 'permiso_vehiculo'
    placa,
    vehicle_id,
    accion, // 'ingreso' | 'salida'
  } = req.body;

  const nomConductor = visitorName || 'Alguien';
  const esVehiculo = tipo === 'permiso_vehiculo' || !!placa || !!vehicle_id;
  const aptoNorm = apartamento ? String(apartamento).trim().toUpperCase() : null;

  // Resolver el usuario destinatario si no fue provisto
  let targetUserId = user_id || null;
  let targetResident = null;

  if (!targetUserId && aptoNorm) {
    const userRes = await User.findOne({ apartamento: aptoNorm, rol: 'residente', tenant_id: req.tenantId }).lean();
    if (userRes) targetUserId = userRes._id;
  }

  let permissionDoc = null;
  let vehicleDoc = null;

  if (esVehiculo) {
    const cleanPlaca = (placa || '').replace(/[\s-]/g, '').toUpperCase();
    const placaRegex = cleanPlaca.length >= 3
      ? new RegExp(`^${cleanPlaca.slice(0, 3)}\\s?${cleanPlaca.slice(3)}$`, 'i')
      : new RegExp(`^${cleanPlaca}$`, 'i');

    if (vehicle_id) {
      vehicleDoc = await Vehicle.findOne({ _id: vehicle_id, tenant_id: req.tenantId }).lean();
    } else if (cleanPlaca) {
      vehicleDoc = await Vehicle.findOne({ tenant_id: req.tenantId, placa: { $regex: placaRegex } }).lean();
    }

    if (vehicleDoc?.responsablePrincipal) {
      targetResident = await Resident.findById(vehicleDoc.responsablePrincipal).lean();
      if (!targetUserId && targetResident?.user_id) {
        targetUserId = targetResident.user_id;
      }
    }

    if (!targetUserId && vehicleDoc?.apartamento) {
      const userRes = await User.findOne({ apartamento: vehicleDoc.apartamento, rol: 'residente', tenant_id: req.tenantId }).lean();
      if (userRes) targetUserId = userRes._id;
    }

    // Crear registro formal de VehiclePermission
    if (vehicleDoc) {
      permissionDoc = await VehiclePermission.create({
        tenant_id: req.tenantId,
        vehicle_id: vehicleDoc._id,
        placa: vehicleDoc.placa || cleanPlaca,
        propietario_id: vehicleDoc.responsablePrincipal || targetResident?._id || req.user.user_id,
        propietario_nombre: targetResident?.nombre || 'Propietario',
        conductor_nombre: nomConductor,
        estado: 'pendiente',
        expiraEn: new Date(Date.now() + 10 * 60 * 1000), // 10 minutos
        celador_id: req.user.user_id,
        celador_nombre: req.user.nombre,
      });
    }
  }

  const notifTitulo = esVehiculo
    ? (accion === 'salida' ? 'Solicitud de SALIDA con tu vehículo' : 'Solicitud de INGRESO con tu vehículo')
    : (accion === 'salida' ? 'Solicitud de Salida' : 'Solicitud de Ingreso de Visitante');

  const notifMensaje = esVehiculo
    ? `${nomConductor}${cedula ? ` (C.C. ${cedula})` : ''} solicita ${accion === 'salida' ? 'salir' : 'ingresar'} con tu vehículo ${placa || vehicleDoc?.placa || ''} (${vehicleDoc?.marca || ''} ${vehicleDoc?.modelo || ''}). ¿Autorizas el acceso?`
    : `${nomConductor}${cedula ? ` (C.C. ${cedula})` : ''} solicita ingresar a tu apartamento ${aptoNorm || ''}.`;

  const notif = await Notification.create({
    tenant_id: req.tenantId,
    user_id: targetUserId,
    apartamento: aptoNorm || vehicleDoc?.apartamento || null,
    tipo: esVehiculo ? 'permiso_vehiculo' : 'autorizacion_visita',
    titulo: notifTitulo,
    mensaje: notifMensaje,
    vehicle_id: vehicleDoc?._id || null,
    permission_id: permissionDoc?._id || null,
    requiereRespuesta: true,
    estadoAprobacion: 'pendiente',
  });

  return ok(res, {
    notification_id: notif._id,
    permission_id: permissionDoc?._id || null,
    targetUserId,
    tipo: notif.tipo,
  }, 'Solicitud de autorización enviada');
});

// Celador consulta el estado (para polling en portería)
const authStatus = asyncHandler(async (req, res) => {
  const notif = await Notification.findById(req.params.id).lean();
  if (!notif) return error(res, 'Notificación no encontrada', 404);

  let permission = null;
  if (notif.permission_id) {
    permission = await VehiclePermission.findById(notif.permission_id).lean();
  }

  return ok(res, {
    status: notif.estadoAprobacion,
    tipo: notif.tipo,
    permissionStatus: permission?.estado || notif.estadoAprobacion,
    respondidoEn: notif.updatedAt,
    apartamento: notif.apartamento,
  });
});

// Residente acepta/rechaza desde el portal
const resolveAuth = asyncHandler(async (req, res) => {
  const { status } = req.body; // 'aprobado' o 'rechazado'
  if (!['aprobado', 'rechazado'].includes(status)) return error(res, 'Estado inválido. Debe ser "aprobado" o "rechazado"', 400);

  // Buscar la notificación
  const notif = await Notification.findOne({
    _id: req.params.id,
    tenant_id: req.tenantId,
  });

  if (!notif) return error(res, 'Notificación no encontrada', 404);

  // Verificar que el usuario tenga acceso a esta notificación
  if (req.user.rol === 'residente') {
    const isOwner = notif.user_id && String(notif.user_id) === String(req.user.user_id);
    const isSameApto = notif.apartamento && req.user.apartamento && notif.apartamento.toUpperCase() === req.user.apartamento.toUpperCase();
    if (!isOwner && !isSameApto) {
      return error(res, 'No tienes permiso para resolver esta autorización', 403);
    }
  }

  notif.estadoAprobacion = status;
  notif.requiereRespuesta = false; // ya respondió
  notif.leida = true;
  await notif.save();

  // Si tenía VehiclePermission asociado, actualizarlo sincronizadamente
  if (notif.permission_id) {
    await VehiclePermission.findByIdAndUpdate(notif.permission_id, {
      estado: status === 'aprobado' ? 'aprobado' : 'rechazado',
      respondidoEn: new Date(),
    });
  }

  return ok(res, { notif, status }, `Autorización ${status} con éxito`);
});

module.exports = { myNotifications, markRead, markOneRead, requestAuth, authStatus, resolveAuth };
