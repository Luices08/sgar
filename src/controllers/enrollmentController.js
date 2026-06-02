'use strict';

/**
 * enrollmentController
 * ─────────────────────────────────────────────────────────────────────────────
 * Gestiona el ciclo de vida del enrolamiento facial de residentes.
 *
 * Rutas cubiertas (montadas bajo /api/facial-enrollment):
 *   POST   /:residentId/descriptor  → guardar facial landmarks (face-api.js)  ← NUEVO
 *   POST   /:residentId/enrolar     → enrolar desde foto vía Face++ (opcional)
 *   PATCH  /:residentId/faceid      → actualizar token manualmente
 *   DELETE /:residentId/faceid      → eliminar token y descriptor locales
 *   GET    /:residentId/historial   → auditoría de enrolamientos
 */

const asyncHandler      = require('../utils/asyncHandler');
const { ok, created, error } = require('../utils/response');
const Resident          = require('../models/Resident');
const FacialEnrollment  = require('../models/FacialEnrollment');
const faceppService     = require('../services/faceppService');

const buildPublicImageUrl = (req, imagePath) => {
  if (!imagePath) return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}${imagePath}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// GUARDAR DESCRIPTOR FACIAL LOCAL (face-api.js)
// POST /api/facial-enrollment/:residentId/descriptor
// Body: { descriptor: [128 números Float32] }
//
// El frontend usa face-api.js para extraer los facial landmarks directamente
// desde la cámara y envía el descriptor de 128 dimensiones.
// No se guarda ninguna foto. No requiere API externa.
// ─────────────────────────────────────────────────────────────────────────────
const guardarDescriptor = asyncHandler(async (req, res) => {
  const { descriptor } = req.body;

  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    return error(res, 'Se requiere un array "descriptor" de exactamente 128 números (face-api.js).', 400);
  }

  // Validar que todos sean números
  if (!descriptor.every(n => typeof n === 'number' && isFinite(n))) {
    return error(res, 'Todos los elementos del descriptor deben ser números válidos.', 400);
  }

  const resident = await Resident.findOne({
    _id: req.params.residentId,
    tenant_id: req.tenantId,
  });
  if (!resident) return error(res, 'Residente no encontrado', 404);

  // ── Validar que no exista otro residente con el mismo rostro ─────────────
  const THRESHOLD = Number(process.env.FACE_DESCRIPTOR_THRESHOLD) || 0.6;

  const otrosResidentes = await Resident.find({
    tenant_id:      req.tenantId,
    _id:            { $ne: resident._id },   // excluir el propio residente (re-enrolamiento)
    faceDescriptor: { $exists: true, $ne: null, $type: 'array' },
  }).select('_id nombre apartamento faceDescriptor').lean();

  for (const otro of otrosResidentes) {
    if (!Array.isArray(otro.faceDescriptor) || otro.faceDescriptor.length !== 128) continue;

    let sum = 0;
    for (let i = 0; i < 128; i++) {
      const diff = descriptor[i] - otro.faceDescriptor[i];
      sum += diff * diff;
    }
    const distancia = Math.sqrt(sum);

    if (distancia < THRESHOLD) {
      return error(
        res,
        `Este rostro ya está registrado para el residente "${otro.nombre}" (Apto ${otro.apartamento}). No se puede enrolar el mismo rostro dos veces.`,
        409
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const eraEnrolado = !!resident.faceDescriptor;

  resident.faceDescriptor = descriptor;
  // Limpiar faceId de Face++ si existía (ya no es necesario)
  resident.faceId = `local-descriptor-v1:${Date.now()}`;
  await resident.save();

  await FacialEnrollment.create({
    tenant_id:           req.tenantId,
    resident_id:         resident._id,
    faceId:              resident.faceId,
    accion:              eraEnrolado ? 'actualizado' : 'enrolado',
    realizadoPor_id:     req.user?.user_id || null,
    realizadoPor_nombre: req.user?.nombre || null,
    fuente:              'automatico',
    observaciones:       'Descriptor facial local (face-api.js, 128 dimensiones). Sin foto almacenada.',
  });

  return created(res, {
    resident: {
      _id:        resident._id,
      nombre:     resident.nombre,
      faceId:     resident.faceId,
      enrolado:   true,
    },
  }, eraEnrolado ? 'Descriptor facial actualizado' : 'Enrolamiento facial completado (descriptor local)');
});

// ─────────────────────────────────────────────────────────────────────────────
// ENROLAR DESDE FOTO EXISTENTE (Face++ API — opcional, requiere credenciales)
// POST /api/facial-enrollment/:residentId/enrolar
// ─────────────────────────────────────────────────────────────────────────────
const enrolar = asyncHandler(async (req, res) => {
  if (!faceppService.isConfigured) {
    return error(res, 'El servicio de reconocimiento facial no está configurado (FACEPP_API_KEY/FACEPP_API_SECRET faltantes).', 503);
  }

  const resident = await Resident.findOne({ _id: req.params.residentId, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);
  if (!resident.fotoUrl) return error(res, 'El residente no tiene foto. Suba una foto antes de enrolar.', 400);

  const previousFaceId = resident.faceId;
  let faceppResult;
  try {
    faceppResult = await faceppService.enrollFace(buildPublicImageUrl(req, resident.fotoUrl));
  } catch (faceppErr) {
    return error(res, `Error al enrolar en Face++: ${faceppErr.message}`, 502);
  }

  if (!faceppResult?.faceId) {
    return error(res, 'Face++ no devolvió un face_token válido.', 502);
  }

  resident.faceId = faceppResult.faceId;
  await resident.save();

  await FacialEnrollment.create({
    tenant_id:            req.tenantId,
    resident_id:          resident._id,
    faceId:               faceppResult.faceId,
    accion:               previousFaceId ? 'actualizado' : 'enrolado',
    realizadoPor_id:      req.user.user_id,
    realizadoPor_nombre:  req.user.nombre,
    fuente:               'automatico',
    observaciones:        faceppResult.faceCount > 1
      ? `Face++ detectó ${faceppResult.faceCount} rostros; se guardó el primero.`
      : null,
  });

  return created(res, { resident }, 'Enrolamiento facial completado');
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTUALIZAR token MANUAL
// PATCH /api/facial-enrollment/:residentId/faceid
// Body: { faceId|faceToken, fuente? }
// ─────────────────────────────────────────────────────────────────────────────
const actualizarFaceId = asyncHandler(async (req, res) => {
  const { faceId, faceToken, fuente = 'manual' } = req.body;
  const token = faceId || faceToken;
  if (!token) return error(res, 'faceId o faceToken es requerido', 400);

  const resident = await Resident.findOneAndUpdate(
    { _id: req.params.residentId, tenant_id: req.tenantId },
    { faceId: token },
    { new: true }
  );
  if (!resident) return error(res, 'Residente no encontrado', 404);

  await FacialEnrollment.create({
    tenant_id:           req.tenantId,
    resident_id:         resident._id,
    faceId:              token,
    accion:              'actualizado',
    realizadoPor_id:     req.user.user_id,
    realizadoPor_nombre: req.user.nombre,
    fuente:              ['automatico', 'manual', 'porteria'].includes(fuente) ? fuente : 'manual',
  });

  return ok(res, { resident }, 'Token facial actualizado');
});

// ─────────────────────────────────────────────────────────────────────────────
// ELIMINAR token facial y descriptor (desactivar biometría del residente)
// DELETE /api/facial-enrollment/:residentId/faceid
// ─────────────────────────────────────────────────────────────────────────────
const eliminarFaceId = asyncHandler(async (req, res) => {
  const resident = await Resident.findOne({ _id: req.params.residentId, tenant_id: req.tenantId });
  if (!resident) return error(res, 'Residente no encontrado', 404);
  if (!resident.faceId && !resident.faceDescriptor) {
    return error(res, 'Este residente no tiene datos biométricos registrados', 400);
  }

  const faceIdAnterior = resident.faceId;

  resident.faceId = null;
  resident.faceDescriptor = null;
  await resident.save();

  await FacialEnrollment.create({
    tenant_id:           req.tenantId,
    resident_id:         resident._id,
    faceId:              faceIdAnterior,
    accion:              'eliminado',
    realizadoPor_id:     req.user.user_id,
    realizadoPor_nombre: req.user.nombre,
    observaciones:       req.body.motivo || null,
  });

  return ok(res, { resident }, 'Datos biométricos eliminados y biometría desactivada');
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORIAL DE ENROLAMIENTOS
// GET /api/facial-enrollment/:residentId/historial
// ─────────────────────────────────────────────────────────────────────────────
const historialEnrolamiento = asyncHandler(async (req, res) => {
  const resident = await Resident.findOne({
    _id: req.params.residentId,
    tenant_id: req.tenantId,
  }).lean();
  if (!resident) return error(res, 'Residente no encontrado', 404);

  const registros = await FacialEnrollment
    .find({ tenant_id: req.tenantId, resident_id: resident._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return ok(res, {
    resident: {
      _id:          resident._id,
      nombre:       resident.nombre,
      faceId:       resident.faceId,
      tieneDescriptor: Array.isArray(resident.faceDescriptor) && resident.faceDescriptor.length === 128,
    },
    registros,
  });
});

module.exports = {
  guardarDescriptor,
  enrolar,
  actualizarFaceId,
  eliminarFaceId,
  historialEnrolamiento,
};