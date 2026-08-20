'use strict';

/**
 * facialAccessController
 * ─────────────────────────────────────────────────────────────────────────────
 * Gestiona el flujo de acceso en portería mediante reconocimiento facial.
 *
 * Estrategia de identificación (en orden de prioridad):
 *
 *   1. Descriptor local (face-api.js):
 *      El frontend envía { descriptor: [128 números] } capturado en portería.
 *      El backend compara con los descriptores guardados en BD usando
 *      distancia euclidiana. No requiere ninguna API externa.
 *
 *   2. Coincidencia directa por faceId:
 *      Si el frontend envía { faceToken } que coincide exactamente con el
 *      campo faceId de un residente (caso de tokens Face++ ya almacenados).
 *
 *   3. Face++ API (fallback):
 *      Si los métodos anteriores fallan y Face++ está configurado,
 *      se intenta la comparación remota con imageUrl o imageBase64.
 */

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error } = require('../utils/response');
const Resident = require('../models/Resident');
const Vehicle = require('../models/Vehicle');
const Visit = require('../models/Visit');
const VehicleAccessLog = require('../models/VehicleAccessLog');
const Notification = require('../models/Notification');
const { VISIT_TYPES, SYNC_STATUS, ID_METHODS } = require('../config/constants');
const faceppService = require('../services/faceppService');

// Umbral de distancia euclidiana para face-api.js (0.6 es el estándar recomendado)
const DESCRIPTOR_DISTANCE_THRESHOLD = Number(process.env.FACE_DESCRIPTOR_THRESHOLD) || 0.6;

const buildPublicImageUrl = (req, imagePath) => {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}${imagePath}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Distancia euclidiana entre dos descriptores de 128 dims (face-api.js)
// ─────────────────────────────────────────────────────────────────────────────
function euclideanDistance(d1, d2) {
  if (!Array.isArray(d1) || !Array.isArray(d2) || d1.length !== 128 || d2.length !== 128) {
    return Infinity;
  }
  let sum = 0;
  for (let i = 0; i < 128; i++) {
    const diff = d1[i] - d2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparar descriptor de la cámara contra todos los residentes enrolados.
// Devuelve el residente con menor distancia si está bajo el umbral.
// ─────────────────────────────────────────────────────────────────────────────
async function findResidentByDescriptor(tenantId, probeDescriptor) {
  const candidates = await Resident.find({
    tenant_id: tenantId,
    activo: true,
    faceDescriptor: { $ne: null, $exists: true, $type: 'array' },
  }).select('_id nombre cedula apartamento fotoUrl faceId faceDescriptor').lean();

  if (!candidates.length) return null;

  let best = null;
  let bestDist = Infinity;

  for (const candidate of candidates) {
    if (!Array.isArray(candidate.faceDescriptor) || candidate.faceDescriptor.length !== 128) continue;
    const dist = euclideanDistance(probeDescriptor, candidate.faceDescriptor);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }

  if (!best || bestDist > DESCRIPTOR_DISTANCE_THRESHOLD) return null;

  return {
    resident: best,
    distance: bestDist,
    threshold: DESCRIPTOR_DISTANCE_THRESHOLD,
    // Convertir distancia a "confianza" en escala 0-100 para compatibilidad
    confidence: Math.max(0, Math.round((1 - bestDist / DESCRIPTOR_DISTANCE_THRESHOLD) * 100)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Función principal: identifica al residente por el medio disponible
// ─────────────────────────────────────────────────────────────────────────────
const findResidentByFace = async (req) => {
  const body = req.body;

  // ── Método 1: descriptor local (face-api.js) ─────────────────────────────
  if (Array.isArray(body.descriptor) && body.descriptor.length === 128) {
    const result = await findResidentByDescriptor(req.tenantId, body.descriptor);
    if (result) {
      return {
        resident: result.resident,
        probe: { descriptorMethod: true },
        comparison: {
          matched: true,
          confidence: result.confidence,
          threshold: result.threshold,
          distance: result.distance,
          method: 'local-descriptor',
        },
      };
    }
    // No encontrado — no continuar con métodos por imagen
    return {
      resident: null,
      probe: { descriptorMethod: true },
      comparison: { matched: false, method: 'local-descriptor' },
    };
  }

  // ── Método 2: coincidencia directa por faceToken/faceId ──────────────────
  const faceToken = body.faceToken || body.faceId || null;
  if (faceToken) {
    const directResident = await Resident.findOne({
      faceId: faceToken,
      tenant_id: req.tenantId,
      activo: true,
    }).lean();

    if (directResident) {
      return {
        resident: directResident,
        probe: { faceToken },
        comparison: { matched: true, confidence: 100, threshold: 100, method: 'direct-token' },
      };
    }
  }

  // ── Método 3: Face++ API (fallback si está configurado) ───────────────────
  if (!faceppService.isConfigured) {
    throw new Error(
      'Rostro no identificado. Configure Face++ o use reconocimiento con descriptor local.'
    );
  }

  const imageUrl = body.imageUrl || null;
  const imageBase64 = body.imageBase64 || body.image || null;
  if (!faceToken && !imageUrl && !imageBase64) {
    throw new Error('Debe enviar descriptor (128 nums), faceToken, imageUrl o imageBase64.');
  }

  const candidates = await Resident.find({
    tenant_id: req.tenantId,
    activo: true,
    $or: [
      { faceId: { $nin: [null, ''] } },
      { fotoUrl: { $nin: [null, ''] } },
    ],
  }).select('_id nombre cedula apartamento fotoUrl faceId').lean();

  if (!candidates.length) {
    return { resident: null, probe: { faceToken, imageUrl }, comparison: null };
  }

  const probe = faceToken
    ? { faceToken }
    : { imageUrl, imageBase64 };

  const best = await faceppService.findBestMatch(
    probe,
    candidates,
    (candidate) => {
      const imgUrl = buildPublicImageUrl(req, candidate.fotoUrl);
      if (imgUrl) return { imageUrl: imgUrl };
      return { faceToken: candidate.faceId };
    }
  );

  if (!best?.comparison?.matched) {
    return { resident: null, probe, comparison: best?.comparison || null };
  }

  return {
    resident: best.candidate,
    probe,
    comparison: { ...best.comparison, method: 'facepp' },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICAR IDENTIDAD FACIAL
// POST /api/facial-access/verificar
// Body: { descriptor: [128] } o { faceToken } o { imageUrl|imageBase64 }
// ─────────────────────────────────────────────────────────────────────────────
const verificarIdentidad = asyncHandler(async (req, res) => {
  let match;
  try {
    match = await findResidentByFace(req);
  } catch (faceErr) {
    return error(res, faceErr.message, 400);
  }

  if (!match.resident) {
    return error(res, 'Rostro no identificado en este conjunto', 404);
  }

  const { resident } = match;
  const [vehiculos, openVisit] = await Promise.all([
    Vehicle.find({
      tenant_id: req.tenantId,
      activo: true,
      $or: [
        { responsablePrincipal: resident._id },
        { autorizados: resident._id },
        { propietarios: resident._id },
      ],
    }).lean(),
    Visit.findOne({
      tenant_id: req.tenantId,
      resident_id: resident._id,
      tipo: VISIT_TYPES.RESIDENTE,
      horaSalida: null,
      eliminado: false,
    }).sort({ horaIngreso: -1 }).lean(),
  ]);

  let openVehicleLog = null;
  if (openVisit) {
    openVehicleLog = await VehicleAccessLog.findOne({
      tenant_id: req.tenantId,
      visit_id: openVisit._id,
      horaSalida: null,
    }).lean();
  }

  return ok(res, {
    resident: {
      _id: resident._id,
      nombre: resident.nombre,
      apartamento: resident.apartamento,
      fotoUrl: resident.fotoUrl || null,
      cedula: resident.cedula,
    },
    vehiculos,
    tieneVehiculos: vehiculos.length > 0,
    openVisit: openVisit || null,
    openVehicleLog: openVehicleLog || null,
    estadoAcceso: openVisit ? 'dentro' : 'fuera',
    dentro: !!openVisit,
    facial: {
      confidence: match.comparison?.confidence || null,
      threshold: match.comparison?.threshold || null,
      distance: match.comparison?.distance || null,
      method: match.comparison?.method || null,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR INGRESO (o salida si ya tiene acceso abierto)
// POST /api/facial-access/ingreso
// ─────────────────────────────────────────────────────────────────────────────
const registrarIngreso = asyncHandler(async (req, res) => {
  const { vehicle_id, vehiculoNuevo, localId } = req.body;

  let match;
  try {
    match = await findResidentByFace(req);
  } catch (faceErr) {
    return error(res, faceErr.message, 400);
  }

  if (!match.resident) {
    return error(res, 'Residente no reconocido. Verifique el enrolamiento facial.', 404);
  }
  const resident = match.resident;

  // Comprobar si el residente ya tiene un acceso abierto (horaSalida == null)
  const openVisit = await Visit.findOne({
    tenant_id: req.tenantId,
    resident_id: resident._id,
    tipo: VISIT_TYPES.RESIDENTE,
    horaSalida: null,
    eliminado: false,
  }).sort({ horaIngreso: -1 });

  // CASO SALIDA: Ya estaba adentro → cerrar el mismo acceso
  if (openVisit) {
    openVisit.horaSalida = req.body.horaSalida || new Date();
    openVisit.metodoSalida = ID_METHODS.FACIAL;
    openVisit.celador_salida_id = req.user.user_id;
    openVisit.celador_salida_nombre = req.user.nombre;

    let vehicleLog = null;
    const reqPlacaSalida = (req.body.placa || req.body.placaSalida || '').toUpperCase().trim();
    const reqVehId = req.body.vehicle_id;

    if (reqPlacaSalida || reqVehId) {
      const filterVeh = { tenant_id: req.tenantId, horaSalida: null };
      if (reqVehId) filterVeh.vehicle_id = reqVehId;
      else if (reqPlacaSalida) filterVeh.placa = reqPlacaSalida;

      vehicleLog = await VehicleAccessLog.findOneAndUpdate(
        filterVeh,
        {
          horaSalida: openVisit.horaSalida,
          celador_salida_id: req.user.user_id,
          celador_salida_nombre: req.user.nombre,
        },
        { new: true }
      );

      if (reqPlacaSalida) openVisit.placaSalida = reqPlacaSalida;
    }

    await openVisit.save();

    return ok(res, {
      visit: openVisit,
      accion: 'salida',
      esSalida: true,
      residente: {
        _id: resident._id,
        nombre: resident.nombre,
        apartamento: resident.apartamento,
      },
      vehicleLog,
      facial: {
        confidence: match.comparison?.confidence || null,
        distance: match.comparison?.distance || null,
        method: match.comparison?.method || null,
      },
    }, 'Salida de residente registrada');
  }

  // CASO ENTRADA: No tiene acceso abierto → crear nuevo registro
  // Deduplicación offline→online
  if (localId) {
    const existing = await Visit.findOne({ localId, tenant_id: req.tenantId });
    if (existing) return ok(res, { visit: existing, accion: 'ingreso', esIngreso: true }, 'Ya sincronizado');
  }

  const visit = await Visit.create({
    tenant_id: req.tenantId,
    tipo: VISIT_TYPES.RESIDENTE,
    nombre: resident.nombre,
    cedula: resident.cedula,
    apartamento: resident.apartamento,
    resident_id: resident._id,
    horaIngreso: new Date(),
    horaSalida: null,
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    metodoIdentificacion: ID_METHODS.FACIAL,
    syncStatus: SYNC_STATUS.SINCRONIZADO,
    localId: localId || null,
  });

  let vehicleLog = null;
  let vehicleInfo = null;

  if (vehicle_id) {
    const vehicle = await Vehicle.findOne({
      _id: vehicle_id,
      tenant_id: req.tenantId,
      activo: true,
    }).lean();

    if (!vehicle) {
      return error(res, 'Vehículo no encontrado o no pertenece a este conjunto', 404);
    }

    const isPrincipal = vehicle.responsablePrincipal && String(vehicle.responsablePrincipal) === String(resident._id);
    const isAuth = vehicle.autorizados?.some(a => String(a) === String(resident._id)) || vehicle.propietarios?.some(p => String(p) === String(resident._id));
    const esAutorizado = isPrincipal || isAuth;

    vehicleLog = await VehicleAccessLog.create({
      tenant_id: req.tenantId,
      vehicle_id: vehicle._id,
      placa: vehicle.placa,
      tipoVehiculo: vehicle.tipo || 'Carro',
      esVehiculoRegistrado: !vehicle.esExterno,
      responsablePrincipal_id: vehicle.responsablePrincipal || resident._id,
      responsablePrincipal_nombre: resident.nombre,
      propietario_id: vehicle.responsablePrincipal || resident._id,
      propietario_nombre: resident.nombre,
      apartamento: vehicle.apartamento || resident.apartamento,
      conductor_id: resident._id,
      conductor_nombre: resident.nombre,
      conductor_tipo: 'residente',
      esAutorizado: esAutorizado,
      alertaNoAutorizado: !esAutorizado,
      esPropietario: esAutorizado,
      horaIngreso: new Date(),
      celador_id: req.user.user_id,
      celador_nombre: req.user.nombre,
      visit_id: visit._id,
    });
    vehicleInfo = vehicle;

  } else if (vehiculoNuevo && (vehiculoNuevo.placa || vehiculoNuevo.tipo)) {
    const rawPlaca = (vehiculoNuevo.placa || '').replace(/[\s-]/g, '').trim().toUpperCase();
    const placaRegex = rawPlaca.length >= 3
      ? new RegExp(`^${rawPlaca.slice(0, 3)}\\s?${rawPlaca.slice(3)}$`, 'i')
      : new RegExp(`^${rawPlaca}$`, 'i');

    let regVeh = null;
    if (rawPlaca) {
      regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: { $regex: placaRegex } }).lean();
    }

    if (regVeh) {
      const isPrincipal = regVeh.responsablePrincipal && String(regVeh.responsablePrincipal) === String(resident._id);
      const isAuth = regVeh.autorizados?.some(a => String(a) === String(resident._id)) || regVeh.propietarios?.some(p => String(p) === String(resident._id));
      const esAutorizado = isPrincipal || isAuth || !!req.body.permission_id;

      vehicleLog = await VehicleAccessLog.create({
        tenant_id: req.tenantId,
        vehicle_id: regVeh._id,
        placa: regVeh.placa || vehiculoNuevo.placa,
        tipoVehiculo: regVeh.tipo || vehiculoNuevo.tipo || 'Carro',
        esVehiculoRegistrado: true,
        responsablePrincipal_id: regVeh.responsablePrincipal || resident._id,
        responsablePrincipal_nombre: resident.nombre,
        propietario_id: regVeh.responsablePrincipal || resident._id,
        propietario_nombre: resident.nombre,
        apartamento: regVeh.apartamento || resident.apartamento,
        conductor_id: resident._id,
        conductor_nombre: resident.nombre,
        conductor_tipo: 'residente',
        esAutorizado: esAutorizado,
        alertaNoAutorizado: !esAutorizado,
        permission_id: req.body.permission_id || null,
        horaIngreso: new Date(),
        celador_id: req.user.user_id,
        celador_nombre: req.user.nombre,
        visit_id: visit._id,
      });
      vehicleInfo = regVeh;
    } else {
      const nuevoVehiculo = await Vehicle.create({
        tenant_id: req.tenantId,
        tipo: vehiculoNuevo.tipo || 'Otro',
        placa: vehiculoNuevo.placa ? vehiculoNuevo.placa.toUpperCase().trim() : undefined,
        marca: vehiculoNuevo.marca || null,
        modelo: vehiculoNuevo.modelo || null,
        apartamento: resident.apartamento,
        resident_id: resident._id,
        registradoEnPorteria: true,
      });

      vehicleLog = await VehicleAccessLog.create({
        tenant_id: req.tenantId,
        vehicle_id: nuevoVehiculo._id,
        placa: nuevoVehiculo.placa || 'SIN PLACA',
        propietario_id: resident._id,
        propietario_nombre: resident.nombre,
        conductor_id: resident._id,
        conductor_nombre: resident.nombre,
        esPropietario: true,
        permission_id: req.body.permission_id || null,
        horaIngreso: new Date(),
        celador_id: req.user.user_id,
        celador_nombre: req.user.nombre,
        registradoEnPorteria: true,
        visit_id: visit._id,
      });
      vehicleInfo = nuevoVehiculo;

      try {
        await Notification.create({
          tenant_id: req.tenantId,
          user_id: null,
          apartamento: resident.apartamento,
          tipo: 'vehiculo_nuevo',
          titulo: `Nuevo vehículo temporal registrado en portería`,
          mensaje: `El celador ${req.user.nombre} registró el vehículo ${nuevoVehiculo.placa || 'sin placa'} a nombre de ${resident.nombre} (Apto ${resident.apartamento}).`,
          visit_id: visit._id,
        });
      } catch (_) { }
    }
  }

  return created(res, {
    visit,
    accion: 'ingreso',
    esIngreso: true,
    residente: {
      _id: resident._id,
      nombre: resident.nombre,
      apartamento: resident.apartamento,
    },
    vehicleLog,
    vehiculo: vehicleInfo,
    facial: {
      confidence: match.comparison?.confidence || null,
      distance: match.comparison?.distance || null,
      method: match.comparison?.method || null,
    },
  }, vehicleLog ? 'Ingreso de residente y vehículo registrado' : 'Ingreso de residente registrado');
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR SALIDA
// PATCH /api/facial-access/:visitId/salida
// ─────────────────────────────────────────────────────────────────────────────
const registrarSalida = asyncHandler(async (req, res) => {
  const visitIdParam = req.params.visitId || req.params.id;
  const visit = await Visit.findOne({
    _id: visitIdParam,
    tenant_id: req.tenantId,
    tipo: VISIT_TYPES.RESIDENTE,
  });

  if (!visit) return error(res, 'Registro de ingreso no encontrado', 404);
  if (visit.horaSalida) return error(res, 'Este residente ya tiene hora de salida registrada', 400);

  const { horaSalida, metodoSalida, vehicle_id, vehicleLogId, vehiculoSalidaNuevo, placaSalida, tipoVehiculoSalida, permission_id } = req.body;
  const exitTime = horaSalida || new Date();

  visit.horaSalida = exitTime;
  visit.metodoSalida = metodoSalida || ID_METHODS.FACIAL;
  visit.celador_salida_id = req.user.user_id;
  visit.celador_salida_nombre = req.user.nombre;

  // Determinar placa de salida
  let cleanPlacaSalida = placaSalida ? placaSalida.toUpperCase().trim() : null;
  if (vehiculoSalidaNuevo?.placa) cleanPlacaSalida = vehiculoSalidaNuevo.placa.toUpperCase().trim();

  if (vehicle_id && !cleanPlacaSalida) {
    const vDoc = await Vehicle.findOne({ _id: vehicle_id, tenant_id: req.tenantId }).lean();
    if (vDoc) cleanPlacaSalida = vDoc.placa;
  }

  if (cleanPlacaSalida) {
    visit.placaSalida = cleanPlacaSalida;
  }

  await visit.save();

  let vehicleLog = null;
  if (cleanPlacaSalida || vehicleLogId || vehicle_id) {
    if (vehicleLogId) {
      vehicleLog = await VehicleAccessLog.findOneAndUpdate(
        { _id: vehicleLogId, tenant_id: req.tenantId, horaSalida: null },
        {
          horaSalida: exitTime,
          celador_salida_id: req.user.user_id,
          celador_salida_nombre: req.user.nombre,
          ...(permission_id ? { permission_id } : {}),
        },
        { new: true }
      );
    } else if (cleanPlacaSalida) {
      const placaRegex = new RegExp(`^${cleanPlacaSalida.slice(0, 3)}\\s?${cleanPlacaSalida.slice(3)}$`, 'i');
      vehicleLog = await VehicleAccessLog.findOneAndUpdate(
        { tenant_id: req.tenantId, placa: { $regex: placaRegex }, horaSalida: null },
        {
          horaSalida: exitTime,
          celador_salida_id: req.user.user_id,
          celador_salida_nombre: req.user.nombre,
          ...(permission_id ? { permission_id } : {}),
        },
        { new: true }
      );
    }

    // Si no existía log abierto para esta placa de salida, crear registro de salida cerrado
    if (!vehicleLog && cleanPlacaSalida) {
      try {
        const regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: cleanPlacaSalida }).lean();
        vehicleLog = await VehicleAccessLog.create({
          tenant_id: req.tenantId,
          vehicle_id: regVeh?._id || null,
          placa: cleanPlacaSalida,
          tipoVehiculo: tipoVehiculoSalida || vehiculoSalidaNuevo?.tipo || regVeh?.tipo || 'Carro',
          esVehiculoRegistrado: !!regVeh,
          responsablePrincipal_id: regVeh?.responsablePrincipal || visit.resident_id || null,
          apartamento: visit.apartamento || regVeh?.apartamento || null,
          conductor_id: visit.resident_id || null,
          conductor_nombre: visit.nombre,
          conductor_tipo: 'residente',
          esAutorizado: true,
          horaIngreso: visit.horaIngreso,
          horaSalida: exitTime,
          celador_id: visit.celador_id || req.user.user_id,
          celador_nombre: visit.celador_nombre || req.user.nombre,
          celador_salida_id: req.user.user_id,
          celador_salida_nombre: req.user.nombre,
          registradoEnPorteria: true,
          visit_id: visit._id,
        });
      } catch (e) {
        console.warn('Error creando VehicleAccessLog en salida de residente:', e.message);
      }
    }
  }

  return ok(res, { visit, vehicleLog, accion: 'salida', esSalida: true }, 'Salida de residente registrada');
});

module.exports = {
  verificarIdentidad,
  registrarIngreso,
  registrarSalida,
};
