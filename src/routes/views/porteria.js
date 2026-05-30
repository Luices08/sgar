'use strict';
const router = require('express').Router();

// La PWA carga siempre index.html; el SW toma el control
router.get('*', (req, res) => {
  res.render('porteria/index', { title: 'Portería — SGAR' });
});

module.exports = router;
