'use strict';

const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/vehicleAccessController');

// ── Celador: ingresos ─────────────────────────────────────────────────────────
// Ingreso de vehículo registrado (propietario conduce)
router.post('/ingreso',       auth, authorize.conjuntoStaff, tf, c.registrarIngreso);
// Ingreso de vehículo nuevo (se registra en el momento)
router.post('/ingreso-nuevo', auth, authorize.conjuntoStaff, tf, c.registrarIngresoNuevo);
// Iniciar flujo de permiso (conductor ≠ propietario)
router.post('/solicitar-permiso', auth, authorize.conjuntoStaff, tf, c.solicitarPermiso);

// ── Propietario (Residente): responder a la solicitud de permiso ───────────────
router.patch('/permiso/:id/responder', auth, tf, c.responderPermiso);

// ── Celador: consultar estado del permiso (polling) ───────────────────────────
router.get('/permiso/:id/estado',  auth, authorize.conjuntoStaff, tf, c.estadoPermiso);
// Completar el acceso después de verificar facial del conductor
router.post('/permiso/:id/completar', auth, authorize.conjuntoStaff, tf, c.completarPermisoAcceso);

// ── Salida de vehículo ────────────────────────────────────────────────────────
router.patch('/:logId/salida', auth, authorize.conjuntoStaff, tf, c.registrarSalida);

// ── Historial / auditoría ──────────────────────────────────────────────────────
router.get('/', auth, authorize.conjuntoStaff, tf, c.listarLogs);

module.exports = router;
