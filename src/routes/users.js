'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/userController');

router.get('/',                 auth, authorize.adminAndConjunto, tf, c.list);
router.post('/',                auth, authorize.adminAndConjunto, tf, c.create);
router.patch('/:id/toggle',     auth, authorize.adminAndConjunto, tf, c.toggleActive);
router.patch('/:id/password',   auth, authorize.adminAndConjunto, tf, c.resetPassword);

module.exports = router;
