'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/visitController');

router.get('/analytics',          auth, authorize.conjuntoStaff,    tf, c.analytics);
router.get('/pendientes',         auth, authorize.conjuntoStaff,    tf, c.getPendientes);
router.get('/activas',            auth, authorize.conjuntoStaff,    tf, c.getActiveVisitors);
router.get('/residentes-activos', auth, authorize.conjuntoStaff,    tf, c.getActiveResidents);
router.get('/',                   auth,                             tf, c.list);
router.get('/:id',              auth,                             tf, c.getOne);
router.post('/',                auth, authorize.conjuntoStaff,    tf, c.create);
router.post('/sync',            auth, authorize.conjuntoStaff,    tf, c.syncBatch);
router.patch('/:id/recibir-domicilio', auth,                         tf, c.recibirDomicilio);
router.patch('/:id/salida',           auth, authorize.conjuntoStaff, tf, c.registerExit);
router.put('/:id',                    auth, authorize.conjuntoStaff, tf, c.update);
router.post('/verificar-codigo',      auth, authorize.conjuntoStaff, tf, c.verificarCodigo);
router.post('/registrar-ingreso',     auth, authorize.conjuntoStaff, tf, c.registrarIngreso);

module.exports = router;
