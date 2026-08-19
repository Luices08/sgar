'use strict';

const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/vehicleAccessController');

// ── Búsqueda de vehículos y placas ────────────────────────────────────────────
router.post('/buscar-placa',   auth, tf, c.buscarPlaca);
router.get('/buscar/:placa',   auth, tf, c.buscarPlaca);

// ── Registro de ingreso y salida ──────────────────────────────────────────────
router.post('/ingreso',        auth, authorize.conjuntoStaff, tf, c.registrarIngreso);
router.post('/salida',         auth, authorize.conjuntoStaff, tf, c.registrarSalida);
router.patch('/:logId/salida', auth, authorize.conjuntoStaff, tf, c.registrarSalida);

// ── Historial / auditoría de accesos vehiculares ──────────────────────────────
router.get('/',                auth, authorize.conjuntoStaff, tf, c.listarLogs);

module.exports = router;
