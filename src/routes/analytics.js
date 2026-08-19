'use strict';

const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/analyticsController');
const { ROLES } = require('../config/constants');

// GET /api/analytics/global   — Métricas globales agrupadas por conjunto (SuperAdmin)
router.get('/global',   auth, authorize.onlyAdmin, c.getGlobalAnalytics);

// GET /api/analytics/conjunto — Métricas detalladas de accesos y vehículos de un conjunto
router.get('/conjunto', auth, authorize.conjuntoStaff, tf, c.getConjuntoAnalytics);

// GET /api/analytics          — Endpoint inteligente según rol y contexto
router.get('/', auth, tf, (req, res, next) => {
  if (req.user.rol === ROLES.ADMIN_CONTROL && !req.tenantId) {
    return c.getGlobalAnalytics(req, res, next);
  }
  return c.getConjuntoAnalytics(req, res, next);
});

module.exports = router;
