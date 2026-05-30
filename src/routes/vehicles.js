'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/vehicleController');

router.get('/',        auth, authorize.conjuntoStaff,   tf, c.list);
router.post('/',       auth, authorize.adminAndConjunto, tf, c.create);
router.put('/:id',     auth, authorize.adminAndConjunto, tf, c.update);
router.delete('/:id',  auth, authorize.adminAndConjunto, tf, c.remove);

module.exports = router;
