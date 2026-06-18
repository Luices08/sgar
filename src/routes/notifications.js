'use strict';
const router = require('express').Router();
const auth   = require('../middlewares/auth');
const tf     = require('../middlewares/tenantFilter');
const c      = require('../controllers/notificationController');

const authorize = require('../middlewares/authorize');

router.get('/',         auth, tf, c.myNotifications);
router.patch('/read',   auth, tf, c.markRead);

// Flujo de autorización
router.post('/request-auth', auth, authorize.conjuntoStaff, tf, c.requestAuth);
router.get('/:id/status',    auth, authorize.conjuntoStaff, tf, c.authStatus);
router.post('/:id/resolve',  auth, tf, c.resolveAuth); // Residente lo usa

module.exports = router;
