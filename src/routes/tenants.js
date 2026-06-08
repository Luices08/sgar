'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const upload    = require('../config/multer');
const c         = require('../controllers/tenantController');

// GET    /api/tenants            — lista todos (AdminControl)
// GET    /api/tenants/analytics  — métricas globales
// GET    /api/tenants/:id        — detalle
// POST   /api/tenants            — crear (AdminControl)
// PUT    /api/tenants/:id        — actualizar

router.get('/analytics', auth, authorize.onlyAdmin, c.analytics);
router.get('/',          auth, authorize.onlyAdmin, c.list);
router.get('/:id',       auth, authorize.adminAndConjunto, c.getOne);
router.post('/',         auth, authorize.onlyAdmin, upload.single('imagen_conjunto'), c.create);
router.put('/:id',       auth, authorize.onlyAdmin, upload.single('imagen_conjunto'), c.update);
router.delete('/:id',    auth, authorize.onlyAdmin, c.remove);

module.exports = router;
