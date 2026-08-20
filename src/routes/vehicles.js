'use strict';

const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/vehicleController');

// ─── CONSULTAS DE VEHÍCULOS ───────────────────────────────────────────────────
router.get('/mis-vehiculos',                      auth, tf, c.misVehiculos);
router.get('/residente/:residentId',              auth, tf, c.listByResident);
router.get('/no-registrados',                     auth, authorize.conjuntoStaff, tf, c.listNoRegistrados);
router.get('/',                                   auth, authorize.conjuntoStaff, tf, c.list);
router.get('/:id',                                auth, tf, c.getOne);

// ─── GESTIÓN ADMIN (CRUD) ─────────────────────────────────────────────────────
router.post('/',                                  auth, authorize.adminAndConjunto, tf, c.create);
router.put('/:id',                                auth, authorize.adminAndConjunto, tf, c.update);
router.delete('/:id',                             auth, authorize.adminAndConjunto, tf, c.remove);

// ─── INVITACIONES Y AUTORIZACIONES (RESIDENTES Y ADMIN) ───────────────────────
router.post('/:id/invitar',                       auth, tf, c.invitarAutorizado);
router.patch('/invitaciones/:invitationId/responder', auth, tf, c.responderInvitacion);
router.delete('/:id/autorizados/:residentId',     auth, tf, c.removerAutorizado);
router.delete('/invitaciones/:invitationId',      auth, tf, c.cancelarInvitacion);

module.exports = router;
