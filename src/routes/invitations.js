'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/invitationController');
const { ROLES } = require('../config/constants');

router.get('/mine',        auth, authorize(ROLES.RESIDENTE), tf, c.myInvitations);
router.post('/',           auth, authorize(ROLES.RESIDENTE), tf, c.create);
router.delete('/:id',      auth, authorize(ROLES.RESIDENTE), tf, c.cancel);
router.post('/validate',   auth, authorize(ROLES.CELADOR, ROLES.ADMIN_CONJUNTO, ROLES.ADMIN_CONTROL), tf, c.validate);
router.patch('/:id/complete', auth, authorize(ROLES.CELADOR, ROLES.ADMIN_CONJUNTO, ROLES.ADMIN_CONTROL), tf, c.complete);

module.exports = router;
