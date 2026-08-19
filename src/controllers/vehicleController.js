'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { ROLES } = require('../config/constants');
const Vehicle = require('../models/Vehicle');
const VehicleInvitation = require('../models/VehicleInvitation');
const Resident = require('../models/Resident');
const User = require('../models/User');
const Notification = require('../models/Notification');

// ─── LISTAR VEHÍCULOS (ADMIN / CELADOR) ───────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const skip  = (page - 1) * limit;

  const filter = { tenant_id: req.tenantId };
  if (req.query.activo !== undefined) filter.activo = req.query.activo !== 'false';
  if (req.query.esExterno !== undefined) filter.esExterno = req.query.esExterno === 'true';
  if (req.query.tipo) filter.tipo = req.query.tipo;
  if (req.query.apartamento) filter.apartamento = req.query.apartamento.toUpperCase().trim();

  if (req.query.q) {
    const re = new RegExp(req.query.q.trim(), 'i');
    filter.$or = [{ placa: re }, { apartamento: re }, { marca: re }, { modelo: re }];
  }

  const [vehicles, total] = await Promise.all([
    Vehicle.find(filter)
      .populate('responsablePrincipal', 'nombre apartamento telefono email cedula')
      .populate('autorizados', 'nombre apartamento telefono email cedula')
      .populate('propietarios', 'nombre apartamento')
      .sort({ placa: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Vehicle.countDocuments(filter),
  ]);

  return paginated(res, vehicles, total, page, limit);
});

// ─── OBTENER UN VEHÍCULO ───────────────────────────────────────────────────────
const getOne = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findOne({ _id: req.params.id, tenant_id: req.tenantId })
    .populate('responsablePrincipal', 'nombre apartamento telefono email cedula')
    .populate('autorizados', 'nombre apartamento telefono email cedula')
    .lean();

  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  const invitaciones = await VehicleInvitation.find({
    tenant_id:  req.tenantId,
    vehicle_id: vehicle._id,
    estado:     'pendiente',
  }).populate('residente_invitado_id', 'nombre apartamento').lean();

  return ok(res, { vehicle, invitaciones });
});

// ─── MIS VEHÍCULOS (PORTAL DEL RESIDENTE) ─────────────────────────────────────
const misVehiculos = asyncHandler(async (req, res) => {
  let resident = null;
  if (req.user.resident_id) {
    resident = await Resident.findById(req.user.resident_id).lean();
  } else {
    resident = await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();
  }

  if (!resident) {
    return error(res, 'Perfil de residente no encontrado para este usuario', 404);
  }

  // Buscar vehículos donde el residente es responsable principal o persona autorizada
  const vehicles = await Vehicle.find({
    tenant_id: req.tenantId,
    activo:    true,
    $or: [
      { responsablePrincipal: resident._id },
      { autorizados: resident._id },
      { propietarios: resident._id },
    ],
  })
    .populate('responsablePrincipal', 'nombre apartamento telefono email')
    .populate('autorizados', 'nombre apartamento telefono email')
    .sort({ placa: 1 })
    .lean();

  // Buscar invitaciones enviadas pendientes (si es responsable principal)
  const sentInvitations = await VehicleInvitation.find({
    tenant_id:      req.tenantId,
    propietario_id: resident._id,
    estado:         { $in: ['pendiente', 'aceptada', 'rechazada'] },
  })
    .populate('residente_invitado_id', 'nombre apartamento telefono email')
    .sort({ createdAt: -1 })
    .lean();

  // Buscar invitaciones recibidas pendientes para este residente
  const receivedInvitations = await VehicleInvitation.find({
    tenant_id:             req.tenantId,
    residente_invitado_id: resident._id,
    estado:                'pendiente',
  })
    .populate('vehicle_id', 'placa tipo marca modelo color apartamento')
    .populate('propietario_id', 'nombre apartamento')
    .sort({ createdAt: -1 })
    .lean();

  return ok(res, {
    resident: { _id: resident._id, nombre: resident.nombre, apartamento: resident.apartamento },
    vehicles,
    sentInvitations,
    receivedInvitations,
  });
});

// ─── LISTAR VEHÍCULOS POR RESIDENTE ───────────────────────────────────────────
const listByResident = asyncHandler(async (req, res) => {
  const residentId = req.params.residentId;
  const vehicles = await Vehicle.find({
    tenant_id: req.tenantId,
    activo:    true,
    $or: [
      { responsablePrincipal: residentId },
      { autorizados: residentId },
      { propietarios: residentId },
    ],
  })
    .populate('responsablePrincipal', 'nombre apartamento')
    .populate('autorizados', 'nombre apartamento')
    .sort({ placa: 1 })
    .lean();

  return ok(res, { vehicles, total: vehicles.length });
});

// ─── CREAR VEHÍCULO (ADMIN) ───────────────────────────────────────────────────
const create = asyncHandler(async (req, res) => {
  const {
    placa,
    tipo,
    marca,
    modelo,
    anio,
    color,
    foto,
    apartamento,
    responsablePrincipal,
    autorizados,
    propietarios, // compatibilidad
    esExterno,
    esTemporal,
  } = req.body;

  if (!tipo || !apartamento) return error(res, 'Tipo y apartamento son requeridos', 400);
  if ((tipo === 'Carro' || tipo === 'Motocicleta') && !placa) {
    return error(res, 'La placa es obligatoria para carros y motocicletas', 400);
  }

  // Normalizar lista de autorizados y responsable principal
  const principalId = responsablePrincipal || (Array.isArray(propietarios) && propietarios[0]) || null;
  let authList = Array.isArray(autorizados) ? autorizados.filter(Boolean) : (autorizados ? [autorizados] : []);
  if (principalId && !authList.includes(principalId)) {
    // Lista completa de involucrados para propietarios (compatibilidad)
  }

  const allAssigned = Array.from(new Set([principalId, ...authList].filter(Boolean)));

  try {
    const vehicle = await Vehicle.create({
      tenant_id:            req.tenantId,
      tipo,
      placa:                placa ? placa.toUpperCase().trim() : undefined,
      marca:                marca?.trim(),
      modelo:               modelo?.trim(),
      anio:                 anio ? parseInt(anio, 10) : undefined,
      color:                color?.trim(),
      foto:                 foto || '',
      apartamento:          apartamento.toUpperCase().trim(),
      responsablePrincipal: principalId,
      autorizados:          authList.filter(id => String(id) !== String(principalId)),
      propietarios:         allAssigned,
      esExterno:            esExterno === true,
      esTemporal:           esTemporal === true,
    });

    // Sincronizar en Resident.vehiculos
    if (allAssigned.length > 0) {
      await Resident.updateMany(
        { _id: { $in: allAssigned }, tenant_id: req.tenantId },
        { $addToSet: { vehiculos: vehicle._id } }
      );
    }

    const populated = await Vehicle.findById(vehicle._id)
      .populate('responsablePrincipal', 'nombre apartamento')
      .populate('autorizados', 'nombre apartamento')
      .lean();

    return created(res, { vehicle: populated }, 'Vehículo registrado correctamente');
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return error(res, messages.join(', '), 400);
    }
    throw err;
  }
});

// ─── ACTUALIZAR VEHÍCULO (ADMIN) ──────────────────────────────────────────────
const update = asyncHandler(async (req, res) => {
  const {
    placa,
    tipo,
    marca,
    modelo,
    anio,
    color,
    foto,
    apartamento,
    activo,
    responsablePrincipal,
    autorizados,
    propietarios,
    esExterno,
    esTemporal,
  } = req.body;

  const vehicle = await Vehicle.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  const updateData = {};
  if (tipo !== undefined)        updateData.tipo        = tipo;
  if (placa !== undefined)       updateData.placa       = placa ? placa.toUpperCase().trim() : undefined;
  if (marca !== undefined)       updateData.marca       = marca?.trim();
  if (modelo !== undefined)      updateData.modelo      = modelo?.trim();
  if (anio !== undefined)        updateData.anio        = anio ? parseInt(anio, 10) : undefined;
  if (color !== undefined)       updateData.color       = color?.trim();
  if (foto !== undefined)        updateData.foto        = foto;
  if (apartamento !== undefined) updateData.apartamento = apartamento.toUpperCase().trim();
  if (activo !== undefined)      updateData.activo      = activo === true || activo === 'true';
  if (esExterno !== undefined)   updateData.esExterno   = esExterno === true || esExterno === 'true';
  if (esTemporal !== undefined)  updateData.esTemporal  = esTemporal === true || esTemporal === 'true';

  const oldAssigned = Array.from(new Set([
    vehicle.responsablePrincipal?.toString(),
    ...(vehicle.autorizados || []).map(id => id.toString()),
    ...(vehicle.propietarios || []).map(id => id.toString()),
  ].filter(Boolean)));

  let newPrincipal = vehicle.responsablePrincipal;
  if (responsablePrincipal !== undefined) {
    newPrincipal = responsablePrincipal || null;
    updateData.responsablePrincipal = newPrincipal;
  }

  let newAuthList = vehicle.autorizados;
  if (autorizados !== undefined) {
    newAuthList = Array.isArray(autorizados) ? autorizados.filter(Boolean) : (autorizados ? [autorizados] : []);
    // Quitar el responsable de la lista de autorizados para evitar redundancia
    if (newPrincipal) {
      newAuthList = newAuthList.filter(id => String(id) !== String(newPrincipal));
    }
    updateData.autorizados = newAuthList;
  }

  const newAssigned = Array.from(new Set([
    newPrincipal?.toString(),
    ...(newAuthList || []).map(id => id.toString()),
  ].filter(Boolean)));

  updateData.propietarios = newAssigned;

  try {
    const updatedVehicle = await Vehicle.findOneAndUpdate(
      { _id: req.params.id, tenant_id: req.tenantId },
      updateData,
      { new: true, runValidators: true }
    )
      .populate('responsablePrincipal', 'nombre apartamento')
      .populate('autorizados', 'nombre apartamento')
      .lean();

    // Sincronizar Resident.vehiculos en cascada
    const removed = oldAssigned.filter(id => !newAssigned.includes(id));
    const added   = newAssigned.filter(id => !oldAssigned.includes(id));

    if (removed.length > 0) {
      await Resident.updateMany(
        { _id: { $in: removed }, tenant_id: req.tenantId },
        { $pull: { vehiculos: vehicle._id } }
      );
    }
    if (added.length > 0) {
      await Resident.updateMany(
        { _id: { $in: added }, tenant_id: req.tenantId },
        { $addToSet: { vehiculos: vehicle._id } }
      );
    }

    return ok(res, { vehicle: updatedVehicle }, 'Vehículo actualizado');
  } catch (err) {
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(e => e.message);
      return error(res, messages.join(', '), 400);
    }
    throw err;
  }
});

// ─── INVITAR A UN RESIDENTE PARA AUTORIZACIÓN VEHICULAR ────────────────────────
const invitarAutorizado = asyncHandler(async (req, res) => {
  const { residente_id, mensaje } = req.body;
  const vehicleId = req.params.id;

  if (!residente_id) {
    return error(res, 'Debe especificar el residente a autorizar', 400);
  }

  const vehicle = await Vehicle.findOne({ _id: vehicleId, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  // Obtener perfil del emisor
  let callerResident = null;
  if (req.user.rol === ROLES.RESIDENTE) {
    callerResident = req.user.resident_id
      ? await Resident.findById(req.user.resident_id).lean()
      : await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();

    if (!callerResident || String(vehicle.responsablePrincipal) !== String(callerResident._id)) {
      return error(res, 'Solo el responsable principal del vehículo puede enviar invitaciones de autorización', 403);
    }
  } else {
    // Si es admin quien usa este flujo
    if (vehicle.responsablePrincipal) {
      callerResident = await Resident.findById(vehicle.responsablePrincipal).lean();
    }
  }

  const targetResident = await Resident.findOne({ _id: residente_id, tenant_id: req.tenantId });
  if (!targetResident) return error(res, 'El residente a autorizar no existe en este conjunto', 404);

  if (callerResident && String(targetResident._id) === String(callerResident._id)) {
    return error(res, 'No puedes invitarte a ti mismo', 400);
  }

  if (String(vehicle.responsablePrincipal) === String(targetResident._id)) {
    return error(res, 'El residente ya es el responsable principal de este vehículo', 400);
  }

  if (vehicle.autorizados?.some(id => String(id) === String(targetResident._id))) {
    return error(res, 'El residente ya se encuentra autorizado para este vehículo', 400);
  }

  // Verificar si ya existe una invitación pendiente
  const existingInv = await VehicleInvitation.findOne({
    tenant_id:             req.tenantId,
    vehicle_id:            vehicle._id,
    residente_invitado_id: targetResident._id,
    estado:                'pendiente',
  });

  if (existingInv) {
    return error(res, 'Ya existe una invitación pendiente para este residente y vehículo', 400);
  }

  const propietarioNombre = callerResident?.nombre || req.user.nombre || 'El propietario';

  const invitation = await VehicleInvitation.create({
    tenant_id:                 req.tenantId,
    vehicle_id:                vehicle._id,
    placa:                     vehicle.placa || 'Sin placa',
    propietario_id:            callerResident?._id || vehicle.responsablePrincipal || req.user.user_id,
    propietario_nombre:        propietarioNombre,
    residente_invitado_id:     targetResident._id,
    residente_invitado_nombre: targetResident.nombre,
    apartamento:               targetResident.apartamento,
    estado:                    'pendiente',
    mensaje:                   mensaje || '',
  });

  // Notificar al residente invitado
  let targetUser = null;
  if (targetResident.user_id) {
    targetUser = await User.findById(targetResident.user_id).lean();
  }

  await Notification.create({
    tenant_id:             req.tenantId,
    user_id:               targetUser?._id || null,
    apartamento:           targetResident.apartamento,
    tipo:                  'invitacion_vehiculo',
    titulo:                'Invitación de autorización vehicular',
    mensaje:               `${propietarioNombre} te ha invitado a estar autorizado en el vehículo ${vehicle.placa || ''} (${vehicle.marca || ''} ${vehicle.modelo || ''}). Acepta la invitación desde tu portal.`,
    vehicle_invitation_id: invitation._id,
    vehicle_id:            vehicle._id,
    requiereRespuesta:     true,
    estadoAprobacion:      'pendiente',
  });

  return created(res, { invitation }, 'Invitación de autorización enviada');
});

// ─── RESPONDER A INVITACIÓN VEHICULAR (RESIDENTE INVITADO) ────────────────────
const responderInvitacion = asyncHandler(async (req, res) => {
  const { accion } = req.body; // 'aceptar' | 'rechazar'
  const invitationId = req.params.invitationId;

  if (!['aceptar', 'rechazar'].includes(accion)) {
    return error(res, 'Acción inválida. Debe ser "aceptar" o "rechazar"', 400);
  }

  const invitation = await VehicleInvitation.findOne({
    _id:       invitationId,
    tenant_id: req.tenantId,
  });

  if (!invitation) return error(res, 'Invitación no encontrada', 404);
  if (invitation.estado !== 'pendiente') {
    return error(res, `La invitación ya fue ${invitation.estado}`, 400);
  }

  // Verificar que el usuario sea el invitado
  if (req.user.rol === ROLES.RESIDENTE) {
    let resident = req.user.resident_id
      ? await Resident.findById(req.user.resident_id).lean()
      : await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();

    if (!resident || String(resident._id) !== String(invitation.residente_invitado_id)) {
      return error(res, 'No tienes autorización para responder a esta invitación', 403);
    }
  }

  const vehicle = await Vehicle.findOne({ _id: invitation.vehicle_id, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'El vehículo asociado ya no existe', 404);

  if (accion === 'aceptar') {
    invitation.estado       = 'aceptada';
    invitation.respondidoEn = new Date();
    await invitation.save();

    // Añadir a autorizados en Vehicle y sincronizar en Resident
    await Vehicle.findByIdAndUpdate(vehicle._id, {
      $addToSet: {
        autorizados:  invitation.residente_invitado_id,
        propietarios: invitation.residente_invitado_id,
      },
    });

    await Resident.findByIdAndUpdate(invitation.residente_invitado_id, {
      $addToSet: { vehiculos: vehicle._id },
    });

    // Notificar al propietario principal
    const propietario = await Resident.findById(invitation.propietario_id).lean();
    if (propietario?.user_id) {
      await Notification.create({
        tenant_id:   req.tenantId,
        user_id:     propietario.user_id,
        apartamento: propietario.apartamento,
        tipo:        'invitacion_vehiculo_aceptada',
        titulo:      'Autorización vehicular aceptada',
        mensaje:     `${invitation.residente_invitado_nombre} ha aceptado tu invitación y ahora está autorizado para usar el vehículo ${vehicle.placa}.`,
        vehicle_id:  vehicle._id,
      });
    }

    return ok(res, { invitation }, 'Has aceptado la autorización para el vehículo');
  } else {
    invitation.estado       = 'rechazada';
    invitation.respondidoEn = new Date();
    await invitation.save();

    // Notificar al propietario principal
    const propietario = await Resident.findById(invitation.propietario_id).lean();
    if (propietario?.user_id) {
      await Notification.create({
        tenant_id:   req.tenantId,
        user_id:     propietario.user_id,
        apartamento: propietario.apartamento,
        tipo:        'invitacion_vehiculo_rechazada',
        titulo:      'Autorización vehicular rechazada',
        mensaje:     `${invitation.residente_invitado_nombre} ha rechazado la invitación para el vehículo ${vehicle.placa}.`,
        vehicle_id:  vehicle._id,
      });
    }

    return ok(res, { invitation }, 'Has rechazado la invitación');
  }
});

// ─── REMOVER PERSONA AUTORIZADA ──────────────────────────────────────────────
const removerAutorizado = asyncHandler(async (req, res) => {
  const { id: vehicleId, residentId } = req.params;

  const vehicle = await Vehicle.findOne({ _id: vehicleId, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  // Verificar que el usuario sea el Responsable Principal o Admin
  if (req.user.rol === ROLES.RESIDENTE) {
    let resident = req.user.resident_id
      ? await Resident.findById(req.user.resident_id).lean()
      : await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();

    if (!resident || String(vehicle.responsablePrincipal) !== String(resident._id)) {
      return error(res, 'Solo el responsable principal puede remover autorizados', 403);
    }
  }

  // Quitar de autorizados en Vehicle y de Resident.vehiculos
  await Vehicle.findByIdAndUpdate(vehicleId, {
    $pull: {
      autorizados:  residentId,
      propietarios: residentId,
    },
  });

  await Resident.findByIdAndUpdate(residentId, {
    $pull: { vehiculos: vehicle._id },
  });

  // Cancelar invitaciones previas
  await VehicleInvitation.updateMany(
    { vehicle_id: vehicleId, residente_invitado_id: residentId, estado: { $in: ['pendiente', 'aceptada'] } },
    { $set: { estado: 'cancelada', respondidoEn: new Date() } }
  );

  return ok(res, {}, 'Persona autorizada removida correctamente');
});

// ─── CANCELAR INVITACIÓN PENDIENTE ────────────────────────────────────────────
const cancelarInvitacion = asyncHandler(async (req, res) => {
  const { invitationId } = req.params;

  const invitation = await VehicleInvitation.findOne({
    _id:       invitationId,
    tenant_id: req.tenantId,
    estado:    'pendiente',
  });

  if (!invitation) return error(res, 'Invitación pendiente no encontrada', 404);

  invitation.estado = 'cancelada';
  invitation.respondidoEn = new Date();
  await invitation.save();

  return ok(res, {}, 'Invitación cancelada');
});

// ─── ELIMINAR VEHÍCULO (ADMIN) ────────────────────────────────────────────────
const remove = asyncHandler(async (req, res) => {
  const vehicle = await Vehicle.findOneAndDelete({ _id: req.params.id, tenant_id: req.tenantId });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  // Limpieza en cascada
  await Resident.updateMany(
    { vehiculos: vehicle._id },
    { $pull: { vehiculos: vehicle._id } }
  );

  await VehicleInvitation.deleteMany({ vehicle_id: vehicle._id });

  return ok(res, {}, 'Vehículo y referencias eliminados en cascada');
});

module.exports = {
  list,
  getOne,
  misVehiculos,
  listByResident,
  create,
  update,
  invitarAutorizado,
  responderInvitacion,
  removerAutorizado,
  cancelarInvitacion,
  remove,
};
