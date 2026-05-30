'use strict';
const router = require('express').Router();
const auth   = require('../middlewares/auth');
const tf     = require('../middlewares/tenantFilter');
const c      = require('../controllers/notificationController');

router.get('/',         auth, tf, c.myNotifications);
router.patch('/read',   auth, tf, c.markRead);

module.exports = router;
