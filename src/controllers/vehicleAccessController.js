'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const Vehicle = require('../models/Vehicle');
const VehicleAccessLog = require('../models/VehicleAccessLog');
const Resident = require('../models/Resident');
const Notification = require('../models/Notification');
const User = require('../models/User');

// ─── BUSCAR INFORMACIÓN DE PLACA ──────────────────────────────────────────────
const buscarPlaca = asyncHandler(async (req, res) => {
  const rawPlaca = (req.body.placa || req.params.placa || req.query.placa || '').trim().toUpperCase();
  if (!rawPlaca) return error(res, 'La placa es requerida', 400);

  const cleanPlaca = rawPlaca.replace(/[\s-]/g, '');
  const placaRegex = cleanPlaca.length >= 3
    ? new RegExp(`^${cleanPlaca.slice(0, 3)}\\s?${cleanPlaca.slice(3)}$`, 'i')
    : new RegExp(`^${cleanPlaca}$`, 'i');

  const vehicle = await Vehicle.findOne({
    tenant_id: req.tenantId,
    placa: { $regex: placaRegex },
    activo: true,
  })
    .populate('responsablePrincipal', 'nombre apartamento telefono email cedula user_id')
    .populate('autorizados', 'nombre apartamento telefono email cedula user_id')
    .populate('propietarios', 'nombre apartamento telefono email cedula user_id')
    .lean();

  const openLog = await VehicleAccessLog.findOne({
    tenant_id: req.tenantId,
    placa: { $regex: placaRegex },
    horaSalida: null,
  }).sort({ horaIngreso: -1 }).lean();

  if (vehicle) {
    // Si responsablePrincipal no tiene user_id directamente en Resident, buscar por user_id o apartamento
    let respUser = null;
    if (vehicle.responsablePrincipal?.user_id) {
      respUser = await User.findById(vehicle.responsablePrincipal.user_id).select('_id nombre email').lean();
    } else if (vehicle.responsablePrincipal?._id) {
      respUser = await User.findOne({ resident_id: vehicle.responsablePrincipal._id, tenant_id: req.tenantId }).select('_id nombre email').lean();
    }
    if (!respUser && vehicle.apartamento) {
      respUser = await User.findOne({ apartamento: vehicle.apartamento, rol: 'residente', tenant_id: req.tenantId }).select('_id nombre email').lean();
    }

    const responsableObj = vehicle.responsablePrincipal ? {
      ...vehicle.responsablePrincipal,
      user_id: respUser?._id || vehicle.responsablePrincipal.user_id || null,
    } : null;

    return ok(res, {
      registered: true,
      vehicle: {
        ...vehicle,
        responsablePrincipal: responsableObj,
      },
      responsablePrincipal: responsableObj,
      autorizados: vehicle.autorizados || [],
      propietarios: vehicle.propietarios || [],
      openAccess: openLog || null,
      estadoAcceso: openLog ? 'dentro' : 'fuera',
    });
  }

  return ok(res, {
    registered: false,
    vehicle: null,
    responsablePrincipal: null,
    autorizados: [],
    propietarios: [],
    openAccess: openLog || null,
    estadoAcceso: openLog ? 'dentro' : 'fuera',
  });
});

// ─── REGISTRAR INGRESO DE VEHÍCULO ────────────────────────────────────────────
const registrarIngreso = asyncHandler(async (req, res) => {
  const {
    placa,
    conductor_id,
    conductor_nombre,
    conductor_tipo, // 'residente' | 'visitante' | 'tercero'
    tipoVehiculo,
    apartamento,
    visit_id,
    registradoEnPorteria,
    esExterno,
  } = req.body;

  if (!placa) return error(res, 'La placa es requerida', 400);

  const cleanPlaca = placa.toUpperCase().trim();

  // Buscar si el vehículo está registrado en el catálogo de SGAR
  const vehicle = await Vehicle.findOne({
    tenant_id: req.tenantId,
    placa: cleanPlaca,
    activo: true,
  })
    .populate('responsablePrincipal', 'nombre apartamento user_id')
    .populate('autorizados', 'nombre apartamento user_id')
    .lean();

  let esVehiculoRegistrado = false;
  let responsableId = null;
  let responsableNombre = null;
  let apto = apartamento ? apartamento.toUpperCase().trim() : null;
  let esAutorizado = true;
  let alertaNoAutorizado = false;

  let conductorObj = null;
  let conductorName = conductor_nombre || null;

  if (conductor_id) {
    conductorObj = await Resident.findById(conductor_id).lean();
    if (conductorObj) {
      conductorName = conductorName || conductorObj.nombre;
      apto = apto || conductorObj.apartamento;
    }
  }

  if (vehicle) {
    esVehiculoRegistrado = !vehicle.esExterno;
    apto = apto || vehicle.apartamento;

    if (vehicle.responsablePrincipal) {
      responsableId = vehicle.responsablePrincipal._id;
      responsableNombre = vehicle.responsablePrincipal.nombre;
    }

    // Verificar si el conductor es el Responsable Principal o está en Autorizados
    if (conductor_id) {
      const isPrincipal = responsableId && String(responsableId) === String(conductor_id);
      const isAuth = vehicle.autorizados?.some(a => String(a._id) === String(conductor_id));
      const isOwnerCompat = vehicle.propietarios?.some(p => String(p) === String(conductor_id));

      if (!isPrincipal && !isAuth && !isOwnerCompat) {
        // Conductor NO autorizado para este vehículo registrado
        esAutorizado = false;
        alertaNoAutorizado = true;
      }
    } else {
      // Conductor no es residente identificado -> Conductor no autorizado
      if (esVehiculoRegistrado) {
        esAutorizado = false;
        alertaNoAutorizado = true;
      }
    }

    // Si salta alerta de conductor no autorizado, notificar al Responsable Principal
    if (alertaNoAutorizado && vehicle.responsablePrincipal?.user_id) {
      await Notification.create({
        tenant_id: req.tenantId,
        user_id: vehicle.responsablePrincipal.user_id,
        apartamento: vehicle.apartamento,
        tipo: 'alerta_vehiculo_no_autorizado',
        titulo: 'Alerta: Acceso con vehículo no autorizado',
        mensaje: `Se ha registrado el ingreso de tu vehículo ${vehicle.placa} (${vehicle.marca || ''} ${vehicle.modelo || ''}) con un conductor no autorizado: ${conductorName || 'Persona externa'}.`,
        vehicle_id: vehicle._id,
      });
    }
  } else {
    // Vehículo externo registrado en portería
    esVehiculoRegistrado = false;
    esAutorizado = true;
    alertaNoAutorizado = false;
  }

  // Verificar si ya tiene un log abierto para cerrarlo defensivamente o actualizar
  const openLog = await VehicleAccessLog.findOne({
    tenant_id: req.tenantId,
    placa: cleanPlaca,
    horaSalida: null,
  });

  if (openLog) {
    // Si ya estaba abierto, cerramos la salida de la anterior antes de abrir la nueva
    openLog.horaSalida = new Date();
    openLog.celador_salida_id = req.user.user_id;
    openLog.celador_salida_nombre = req.user.nombre;
    await openLog.save();
  }

  const log = await VehicleAccessLog.create({
    tenant_id: req.tenantId,
    vehicle_id: vehicle?._id || null,
    placa: cleanPlaca,
    tipoVehiculo: tipoVehiculo || vehicle?.tipo || 'Carro',
    esVehiculoRegistrado,
    responsablePrincipal_id: responsableId,
    responsablePrincipal_nombre: responsableNombre,
    apartamento: apto,
    propietario_id: responsableId,
    propietario_nombre: responsableNombre,
    conductor_id: conductor_id || null,
    conductor_nombre: conductorName,
    conductor_tipo: conductor_tipo || (conductor_id ? 'residente' : 'visitante'),
    esAutorizado,
    alertaNoAutorizado,
    esPropietario: esAutorizado,
    horaIngreso: new Date(),
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    registradoEnPorteria: registradoEnPorteria || esExterno || false,
    visit_id: visit_id || null,
  });

  return created(res, {
    log,
    esVehiculoRegistrado,
    esAutorizado,
    alertaNoAutorizado,
    responsablePrincipal: responsableNombre ? { _id: responsableId, nombre: responsableNombre, apartamento: apto } : null,
  }, alertaNoAutorizado ? 'Ingreso registrado con alerta de conductor no autorizado' : 'Ingreso vehicular registrado');
});

// ─── REGISTRAR SALIDA DE VEHÍCULO ────────────────────────────────────────────
const registrarSalida = asyncHandler(async (req, res) => {
  const { logId } = req.params;
  const {
    placa,
    conductor_id,
    conductor_nombre,
  } = req.body;

  let log = null;
  if (logId && logId !== 'undefined' && logId !== 'null') {
    log = await VehicleAccessLog.findOne({ _id: logId, tenant_id: req.tenantId });
  }

  if (!log && placa) {
    log = await VehicleAccessLog.findOne({
      tenant_id: req.tenantId,
      placa: placa.toUpperCase().trim(),
      horaSalida: null,
    }).sort({ horaIngreso: -1 });
  }

  if (!log) {
    return error(res, 'No se encontró un ingreso vehicular abierto para este registro', 404);
  }

  // Verificar vehículo si está registrado
  const vehicle = log.vehicle_id ? await Vehicle.findById(log.vehicle_id).populate('responsablePrincipal autorizados').lean() : null;

  if (vehicle && vehicle.responsablePrincipal) {
    if (conductor_id) {
      const isPrincipal = String(vehicle.responsablePrincipal._id) === String(conductor_id);
      const isAuth = vehicle.autorizados?.some(a => String(a._id) === String(conductor_id));
      if (!isPrincipal && !isAuth) {
        log.alertaNoAutorizado = true;
        // Notificar al responsable
        if (vehicle.responsablePrincipal.user_id) {
          await Notification.create({
            tenant_id: req.tenantId,
            user_id: vehicle.responsablePrincipal.user_id,
            apartamento: vehicle.apartamento,
            tipo: 'alerta_vehiculo_no_autorizado',
            titulo: 'Alerta: Salida con vehículo no autorizado',
            mensaje: `Se ha registrado la salida de tu vehículo ${vehicle.placa} con un conductor no autorizado: ${conductor_nombre || 'Persona externa'}.`,
            vehicle_id: vehicle._id,
          });
        }
      }
    }
  }

  log.horaSalida = new Date();
  log.celador_salida_id = req.user.user_id;
  log.celador_salida_nombre = req.user.nombre;
  await log.save();

  return ok(res, { log }, 'Salida vehicular registrada');
});

// ─── LISTAR LOGS DE ACCESO VEHICULAR ──────────────────────────────────────────
const listarLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = { tenant_id: req.tenantId };

  if (req.query.placa) filter.placa = req.query.placa.toUpperCase().trim();
  if (req.query.apartamento) filter.apartamento = req.query.apartamento.toUpperCase().trim();
  if (req.query.alerta === 'true') filter.alertaNoAutorizado = true;
  if (req.query.estado === 'dentro') filter.horaSalida = null;
  if (req.query.estado === 'salida') filter.horaSalida = { $ne: null };

  if (req.query.fecha) {
    const d = new Date(req.query.fecha);
    filter.horaIngreso = {
      $gte: new Date(new Date(d).setHours(0, 0, 0, 0)),
      $lte: new Date(new Date(d).setHours(23, 59, 59, 999)),
    };
  }

  const [logs, total] = await Promise.all([
    VehicleAccessLog.find(filter)
      .sort({ horaIngreso: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    VehicleAccessLog.countDocuments(filter),
  ]);

  return paginated(res, logs, total, page, limit);
});

module.exports = {
  buscarPlaca,
  registrarIngreso,
  registrarSalida,
  listarLogs,
};
