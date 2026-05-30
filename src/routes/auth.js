'use strict';

const router = require('express').Router();
const rateLimit = require('express-rate-limit');

const auth = require('../middlewares/auth');
const { login, logout, profile, changePassword } = require('../controllers/authController');

// Rate limit para login: máximo 10 intentos por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { success: false, message: 'Demasiados intentos. Intente en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// POST /api/auth/login
router.post('/login', loginLimiter, login);

// POST /api/auth/logout
router.post('/logout', auth, logout);

// GET /api/auth/profile
router.get('/profile', auth, profile);

// PUT /api/auth/password
router.put('/password', auth, changePassword);

module.exports = router;
