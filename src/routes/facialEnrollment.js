'use strict';

/**
 * routes/facialEnrollment.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rutas para el ciclo de vida del enrolamiento biométrico de residentes.
 * Montadas bajo /api/facial-enrollment en app.js.
 *
 * Solo adminConjunto puede enrolar, actualizar y eliminar tokens faciales.
 */

const router   = require('express').Router();
const auth     = require('../middlewares/auth');
const authorize= require('../middlewares/authorize');
const tf       = require('../middlewares/tenantFilter');
const c        = require('../controllers/enrollmentController');

// Guardar descriptor facial local (face-api.js, 128 dimensiones) — PRINCIPAL
// No requiere foto ni API externa. El frontend extrae el descriptor con la cámara.
router.post('/:residentId/descriptor', auth, authorize.adminAndConjunto, tf, c.guardarDescriptor);

// Enrolar automáticamente desde la foto del residente (requiere Face++ API)
router.post('/:residentId/enrolar',   auth, authorize.adminAndConjunto, tf, c.enrolar);

// Guardar faceId/faceToken obtenido externamente
router.patch('/:residentId/faceid',   auth, authorize.adminAndConjunto, tf, c.actualizarFaceId);

// Eliminar faceId + descriptor y desactivar biometría del residente
router.delete('/:residentId/faceid',  auth, authorize.adminAndConjunto, tf, c.eliminarFaceId);

// Historial de enrolamientos (auditoría)
router.get('/:residentId/historial',  auth, authorize.adminAndConjunto, tf, c.historialEnrolamiento);

module.exports = router;
