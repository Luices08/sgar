'use strict';
const router = require('express').Router();

router.get('*', (req, res) => {
  res.render('residente/index', { title: 'Mi Portal — SGAR' });
});

module.exports = router;
