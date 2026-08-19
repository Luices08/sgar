'use strict';

const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const tf        = require('../middlewares/tenantFilter');
const authorize = require('../middlewares/authorize');
const c         = require('../controllers/notificationController');
const poll      = require('../controllers/pollController');

// ─── POLLING UNIFICADO ───────────────────────────────────────────────────────
router.get('/poll', auth, tf, poll.pollUpdates);

// ─── NOTIFICACIONES DEL USUARIO ──────────────────────────────────────────────
router.get('/',          auth, tf, c.myNotifications);
router.patch('/read',    auth, tf, c.markRead);
router.patch('/read-all',auth, tf, c.markRead);
router.patch('/:id/read',auth, tf, c.markOneRead);

// ─── FLUJO DE AUTORIZACIÓN DE VISITA ─────────────────────────────────────────
router.post('/request-auth', auth, authorize.conjuntoStaff, tf, c.requestAuth);
router.get('/:id/status',    auth, authorize.conjuntoStaff, tf, c.authStatus);
router.post('/:id/resolve',  auth, tf, c.resolveAuth); // Residente lo usa

module.exports = router;
