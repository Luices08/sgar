'use strict';

/**
 * routes/facialAccess.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Rutas de acceso en portería mediante reconocimiento facial.
 * Montadas bajo /api/facial-access en app.js.
 *
 * Solo celadores y personal del conjunto pueden usar estas rutas.
 *
 * Rutas relacionadas que ya NO están aquí:
 *   - Enrolamiento/faceId  → /api/facial-enrollment (enrollmentController)
 *   - Historial residente  → /api/residents/:id/historial (residentController)
 *   - Vehículos residente  → /api/vehicles/residente/:id (vehicleController)
 */

const router   = require('express').Router();
const auth     = require('../middlewares/auth');
const authorize= require('../middlewares/authorize');
const tf       = require('../middlewares/tenantFilter');
const c        = require('../controllers/facialAccessController');

// Verificar quién es el rostro antes de decidir la acción (pre-ingreso)
router.post('/verificar',        auth, authorize.conjuntoStaff, tf, c.verificarIdentidad);

// Registrar ingreso (con o sin vehículo)
router.post('/ingreso',          auth, authorize.conjuntoStaff, tf, c.registrarIngreso);

// Registrar salida
router.patch('/:visitId/salida', auth, authorize.conjuntoStaff, tf, c.registrarSalida);

module.exports = router;
