'use strict';

const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const c         = require('../controllers/visitorController');

// Celador: registrar visitante sin código
router.post('/registro-manual', auth, authorize.conjuntoStaff, tf, c.registroManual);

// Celador: registrar visitante con código de invitación
router.post('/registro-codigo', auth, authorize.conjuntoStaff, tf, c.registroCodigo);

// Celador: validar código antes de confirmar (consulta previa)
router.get('/validar-codigo/:codigo', auth, authorize.conjuntoStaff, tf, c.validarCodigo);

// Listar visitantes (celador y admin)
router.get('/', auth, authorize.conjuntoStaff, tf, c.listar);

module.exports = router;
