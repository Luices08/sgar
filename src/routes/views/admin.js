'use strict';

const router    = require('express').Router();
const auth      = require('../../middlewares/auth');
const authorize = require('../../middlewares/authorize');
const { ROLES } = require('../../config/constants');

function viewData(req, title, page) {
  return { title, page, user: req.user, tenantConfig: null };
}

router.get('/login', (req, res) => {
  res.render('admin/login', {
    title:        'Iniciar Sesión',
    defaultColor: process.env.DEFAULT_ACCENT_COLOR || '#1a1a2e',
  });
});

router.get(['/', '/dashboard'], auth, (req, res) =>
  res.render('admin/dashboard', viewData(req, 'Panel Principal', 'dashboard')));

router.get('/registros', auth,
  authorize(ROLES.ADMIN_CONTROL, ROLES.ADMIN_CONJUNTO, ROLES.CELADOR),
  (req, res) => res.render('admin/registros', viewData(req, 'Registros de Acceso', 'registros')));

router.get('/residentes', auth,
  authorize(ROLES.ADMIN_CONTROL, ROLES.ADMIN_CONJUNTO),
  (req, res) => res.render('admin/residentes', viewData(req, 'Residentes', 'residentes')));

router.get('/celadores', auth,
  authorize(ROLES.ADMIN_CONTROL, ROLES.ADMIN_CONJUNTO),
  (req, res) => res.render('admin/celadores', viewData(req, 'Celadores', 'celadores')));

router.get('/usuarios', auth, authorize.onlyAdmin,
  (req, res) => res.render('admin/usuarios', viewData(req, 'Usuarios del Sistema', 'usuarios')));

router.get('/analiticas', auth,
  (req, res) => res.render('admin/analiticas', viewData(req, 'Analíticas', 'analiticas')));

module.exports = router;
