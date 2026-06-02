'use strict';

const asyncHandler      = require('../utils/asyncHandler');
const { ok, created, error } = require('../utils/response');
const Vehicle           = require('../models/Vehicle');
const VehicleAccessLog  = require('../models/VehicleAccessLog');
const VehiclePermission = require('../models/VehiclePermission');
const Resident          = require('../models/Resident');
const Notification      = require('../models/Notification');

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const TIMEOUT_PERMISO_MS = 3 * 60 * 1000; // 3 minutos

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO A: Ingreso de vehículo (propietario conduce)
// POST /api/vehicle-access/ingreso
// Body: { placa, conductor_faceId?, conductor_residentId?, esPropietario? }
// ─────────────────────────────────────────────────────────────────────────────
const registrarIngreso = asyncHandler(async (req, res) => {
  const {
    placa,
    conductor_residentId,  // ID del residente que conduce (ya identificado por biometría)
    registradoEnPorteria,  // true si el vehículo no existía y se acaba de crear
    visit_id,
  } = req.body;

  if (!placa) return error(res, 'La placa es requerida', 400);

  // Buscar el vehículo en el tenant
  const vehicle = await Vehicle.findOne({
    tenant_id: req.tenantId,
    placa:     placa.toUpperCase(),
    activo:    true,
  });

  if (!vehicle) {
    return error(res, 'Vehículo no encontrado. Use /api/vehicle-access/ingreso-nuevo para registrarlo.', 404);
  }

  // Determinar si el conductor es el propietario
  const conductorId = conductor_residentId || null;
  const esPropietario = !conductorId || (vehicle.resident_id &&
    vehicle.resident_id.toString() === conductorId.toString());

  // Si NO es propietario → iniciar flujo de permiso
  if (!esPropietario) {
    return error(res, 'El conductor no es el propietario. Use /api/vehicle-access/solicitar-permiso', 403);
  }

  // Buscar datos del propietario para el log
  let propietario = null;
  if (vehicle.resident_id) {
    propietario = await Resident.findById(vehicle.resident_id).lean();
  }

  const log = await VehicleAccessLog.create({
    tenant_id:           req.tenantId,
    vehicle_id:          vehicle._id,
    placa:               vehicle.placa,
    propietario_id:      vehicle.resident_id || null,
    propietario_nombre:  propietario?.nombre || null,
    conductor_id:        conductorId || vehicle.resident_id,
    conductor_nombre:    propietario?.nombre || null,
    esPropietario:       true,
    horaIngreso:         new Date(),
    celador_id:          req.user.user_id,
    celador_nombre:      req.user.nombre,
    registradoEnPorteria: registradoEnPorteria || false,
    visit_id:            visit_id || null,
  });

  return created(res, { log }, 'Ingreso vehicular registrado');
});

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO B: Registrar vehículo nuevo en portería + log de ingreso
// POST /api/vehicle-access/ingreso-nuevo
// ─────────────────────────────────────────────────────────────────────────────
const registrarIngresoNuevo = asyncHandler(async (req, res) => {
  const {
    placa,
    tipo,              // 'carro' | 'moto'
    descripcion,
    conductor_residentId,   // residente identificado como propietario
    visit_id,
  } = req.body;

  if (!placa || !conductor_residentId) {
    return error(res, 'placa y conductor_residentId son requeridos', 400);
  }

  // Verificar que no exista ya
  const existing = await Vehicle.findOne({ tenant_id: req.tenantId, placa: placa.toUpperCase() });
  if (existing) {
    return error(res, 'La placa ya está registrada. Use /api/vehicle-access/ingreso', 409);
  }

  // Buscar el residente para obtener su apartamento
  const residente = await Resident.findOne({
    _id:       conductor_residentId,
    tenant_id: req.tenantId,
    activo:    true,
  }).lean();

  if (!residente) return error(res, 'Residente no encontrado', 404);

  // Crear el vehículo
  const vehicle = await Vehicle.create({
    tenant_id:            req.tenantId,
    placa:                placa.toUpperCase(),
    descripcion:          descripcion || null,
    apartamento:          residente.apartamento,
    resident_id:          residente._id,
    // Marcador especial para que el AdminConjunto lo valide desde el panel
    registradoEnPorteria: true,
  });

  // Registrar el log de ingreso
  const log = await VehicleAccessLog.create({
    tenant_id:            req.tenantId,
    vehicle_id:           vehicle._id,
    placa:                vehicle.placa,
    propietario_id:       residente._id,
    propietario_nombre:   residente.nombre,
    conductor_id:         residente._id,
    conductor_nombre:     residente.nombre,
    esPropietario:        true,
    horaIngreso:          new Date(),
    celador_id:           req.user.user_id,
    celador_nombre:       req.user.nombre,
    registradoEnPorteria: true,
    visit_id:             visit_id || null,
  });

  // Notificar al AdminConjunto (user de tipo adminConjunto del mismo tenant)
  // La notificación se guarda internamente; el AdminConjunto la ve en su panel
  try {
    await Notification.create({
      tenant_id:   req.tenantId,
      user_id:     null,  // Se mostrará a cualquier adminConjunto del tenant
      apartamento: residente.apartamento,
      tipo:        'vehiculo_nuevo',
      titulo:      `Vehículo nuevo registrado en portería — ${vehicle.placa}`,
      mensaje:     `El celador ${req.user.nombre} registró el vehículo ${vehicle.placa} a nombre de ${residente.nombre} (Apto ${residente.apartamento}). Verifique desde el panel.`,
      visit_id:    null,
    });
  } catch (_) { /* No interrumpir el flujo */ }

  return created(res, { vehicle, log }, 'Vehículo registrado y log de ingreso creado');
});

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO C: Solicitar permiso al propietario (conductor ≠ propietario)
// POST /api/vehicle-access/solicitar-permiso
// ─────────────────────────────────────────────────────────────────────────────
const solicitarPermiso = asyncHandler(async (req, res) => {
  const {
    placa,
    conductor_residentId,
    conductor_nombre_manual,  // si el conductor no está en el sistema
  } = req.body;

  if (!placa) return error(res, 'La placa es requerida', 400);

  // Buscar el vehículo
  const vehicle = await Vehicle.findOne({
    tenant_id: req.tenantId,
    placa:     placa.toUpperCase(),
    activo:    true,
  });
  if (!vehicle) return error(res, 'Vehículo no encontrado', 404);

  if (!vehicle.resident_id) {
    return error(res, 'El vehículo no tiene propietario registrado. Contacte al AdminConjunto.', 422);
  }

  // Buscar al propietario
  const propietario = await Resident.findById(vehicle.resident_id).lean();
  if (!propietario) return error(res, 'Propietario no encontrado', 404);

  // Buscar al conductor si es residente
  let conductor = null;
  if (conductor_residentId) {
    conductor = await Resident.findOne({ _id: conductor_residentId, tenant_id: req.tenantId }).lean();
  }

  // Calcular fecha de expiración del permiso
  const expiraEn = new Date(Date.now() + TIMEOUT_PERMISO_MS);

  // Crear el permiso en estado 'pendiente'
  const permiso = await VehiclePermission.create({
    tenant_id:           req.tenantId,
    vehicle_id:          vehicle._id,
    placa:               vehicle.placa,
    propietario_id:      propietario._id,
    propietario_nombre:  propietario.nombre,
    conductor_id:        conductor?._id || null,
    conductor_nombre:    conductor?.nombre || conductor_nombre_manual || 'Persona desconocida',
    estado:              'pendiente',
    expiraEn,
    celador_id:          req.user.user_id,
    celador_nombre:      req.user.nombre,
  });

  // Notificar al propietario a través de su cuenta de residente
  if (propietario.user_id) {
    try {
      await Notification.create({
        tenant_id:    req.tenantId,
        user_id:      propietario.user_id,
        apartamento:  propietario.apartamento,
        tipo:         'permiso_vehiculo',
        titulo:       `Su vehículo ${vehicle.placa} está siendo usado`,
        mensaje:      `${conductor?.nombre || conductor_nombre_manual || 'Una persona'} intenta ingresar con su vehículo ${vehicle.placa}. ¿Autoriza el ingreso?`,
        permission_id: permiso._id,
        // Los campos si/no se responden desde la PWA del residente
        requiereRespuesta: true,
      });
    } catch (_) { /* No interrumpir el flujo */ }
  }

  return created(res, {
    permiso_id:         permiso._id,
    expiraEn,
    propietario_nombre: propietario.nombre,
    mensaje:            'Notificación enviada al propietario. Esperando respuesta.',
  }, 'Permiso solicitado');
});

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO C.1: Propietario responde al permiso (desde PWA Residente)
// PATCH /api/vehicle-access/permiso/:id/responder
// Body: { aprobado: true | false }
// ─────────────────────────────────────────────────────────────────────────────
const responderPermiso = asyncHandler(async (req, res) => {
  const { aprobado } = req.body;
  if (typeof aprobado !== 'boolean') return error(res, 'El campo "aprobado" es requerido (true o false)', 400);

  const permiso = await VehiclePermission.findOne({
    _id:       req.params.id,
    tenant_id: req.tenantId,
    estado:    'pendiente',
  });

  if (!permiso) return error(res, 'Permiso no encontrado o ya respondido', 404);

  // Verificar que el permiso no haya expirado
  if (new Date() > permiso.expiraEn) {
    permiso.estado = 'expirado';
    await permiso.save();
    return error(res, 'El permiso ha expirado. El celador debe tomar el control.', 410);
  }

  // Solo el propietario puede responder
  if (req.user.resident_id &&
      req.user.resident_id.toString() !== permiso.propietario_id.toString()) {
    return error(res, 'Solo el propietario del vehículo puede responder', 403);
  }

  permiso.estado       = aprobado ? 'aprobado' : 'rechazado';
  permiso.respondidoEn = new Date();
  await permiso.save();

  // Notificar al celador del resultado
  try {
    await Notification.create({
      tenant_id:    req.tenantId,
      user_id:      permiso.celador_id,  // Notificación para el celador
      apartamento:  null,
      tipo:         aprobado ? 'permiso_aprobado' : 'permiso_rechazado',
      titulo:       aprobado
        ? `✅ ${permiso.propietario_nombre} autorizó el uso del vehículo ${permiso.placa}`
        : `🚫 ${permiso.propietario_nombre} RECHAZÓ el uso del vehículo ${permiso.placa}`,
      mensaje: aprobado
        ? 'Proceda con la verificación facial del conductor.'
        : 'No autorice el ingreso. Aplique el protocolo de seguridad del conjunto.',
      permission_id: permiso._id,
    });
  } catch (_) { /* No interrumpir el flujo */ }

  return ok(res, { permiso }, aprobado
    ? 'Permiso aprobado. Proceda con verificación facial del conductor.'
    : 'Permiso rechazado. El celador ha sido notificado.');
});

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO C.2: Verificar estado del permiso (el celador consulta periódicamente)
// GET /api/vehicle-access/permiso/:id/estado
// ─────────────────────────────────────────────────────────────────────────────
const estadoPermiso = asyncHandler(async (req, res) => {
  const permiso = await VehiclePermission.findOne({
    _id:       req.params.id,
    tenant_id: req.tenantId,
  }).lean();

  if (!permiso) return error(res, 'Permiso no encontrado', 404);

  // Marcar como expirado automáticamente si aplica
  if (permiso.estado === 'pendiente' && new Date() > permiso.expiraEn) {
    await VehiclePermission.findByIdAndUpdate(permiso._id, { estado: 'expirado' });
    permiso.estado = 'expirado';
  }

  return ok(res, { permiso });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLUJO C.3: Completar acceso tras aprobación + verificación facial
// POST /api/vehicle-access/permiso/:id/completar
// Body: { conductor_faceVerificado: true }
// ─────────────────────────────────────────────────────────────────────────────
const completarPermisoAcceso = asyncHandler(async (req, res) => {
  const permiso = await VehiclePermission.findOne({
    _id:       req.params.id,
    tenant_id: req.tenantId,
    estado:    'aprobado',
  });

  if (!permiso) return error(res, 'Permiso no encontrado o no aprobado', 404);

  // Crear el log de acceso vehicular
  const log = await VehicleAccessLog.create({
    tenant_id:          req.tenantId,
    vehicle_id:         permiso.vehicle_id,
    placa:              permiso.placa,
    propietario_id:     permiso.propietario_id,
    propietario_nombre: permiso.propietario_nombre,
    conductor_id:       permiso.conductor_id,
    conductor_nombre:   permiso.conductor_nombre,
    esPropietario:      false,
    permission_id:      permiso._id,
    horaIngreso:        new Date(),
    celador_id:         req.user.user_id,
    celador_nombre:     req.user.nombre,
  });

  // Actualizar el permiso
  permiso.estado              = 'completado';
  permiso.verificadoFacialEn  = new Date();
  permiso.accessLog_id        = log._id;
  await permiso.save();

  return ok(res, { log, permiso }, 'Acceso autorizado y registrado correctamente');
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR SALIDA DE VEHÍCULO
// PATCH /api/vehicle-access/:logId/salida
// ─────────────────────────────────────────────────────────────────────────────
const registrarSalida = asyncHandler(async (req, res) => {
  const log = await VehicleAccessLog.findOne({
    _id:       req.params.logId,
    tenant_id: req.tenantId,
  });

  if (!log) return error(res, 'Registro de ingreso no encontrado', 404);
  if (log.horaSalida) return error(res, 'Este vehículo ya tiene hora de salida registrada', 400);

  log.horaSalida = req.body.horaSalida || new Date();
  await log.save();

  return ok(res, { log }, 'Salida vehicular registrada');
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL DE ACCESOS VEHICULARES
// GET /api/vehicle-access
// ─────────────────────────────────────────────────────────────────────────────
const listarLogs = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = { tenant_id: req.tenantId };

  if (req.query.placa)          filter.placa          = req.query.placa.toUpperCase();
  if (req.query.propietario_id) filter.propietario_id = req.query.propietario_id;
  if (req.query.esPropietario !== undefined) {
    filter.esPropietario = req.query.esPropietario === 'true';
  }
  if (req.query.fecha) {
    const d = new Date(req.query.fecha);
    filter.horaIngreso = {
      $gte: new Date(d.setHours(0, 0, 0, 0)),
      $lte: new Date(d.setHours(23, 59, 59, 999)),
    };
  }

  const [logs, total] = await Promise.all([
    VehicleAccessLog.find(filter).sort({ horaIngreso: -1 }).skip(skip).limit(limit).lean(),
    VehicleAccessLog.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    data: logs,
    pagination: {
      total,
      page:       Number(page),
      limit:      Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  });
});

module.exports = {
  registrarIngreso,
  registrarIngresoNuevo,
  solicitarPermiso,
  responderPermiso,
  estadoPermiso,
  completarPermisoAcceso,
  registrarSalida,
  listarLogs,
};
