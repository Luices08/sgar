'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const upload    = require('../config/multer');
const c         = require('../controllers/residentController');

router.get('/',                            auth, tf, c.list);
router.get('/verificar-cedula/:cedula',    auth, authorize.conjuntoStaff, tf, c.verificarCedula);
router.get('/:id',                         auth, authorize.conjuntoStaff, tf, c.getOne);
router.post('/',             auth, authorize.adminAndConjunto, upload.single('foto'), tf, c.create);
router.put('/:id',           auth, authorize.adminAndConjunto, upload.single('foto'), tf, c.update);
router.patch('/:id/faceid',  auth, authorize.adminAndConjunto, tf, c.updateFaceId);
router.post('/:id/account',  auth, authorize.adminAndConjunto, tf, c.createAccount);
router.get('/:id/open-visit', auth, authorize.conjuntoStaff, tf, c.getOpenVisit);
router.post('/bulk',         auth, authorize.adminAndConjunto, tf, c.bulkImport);
router.delete('/:id',        auth, authorize.adminAndConjunto, tf, c.remove);

module.exports = router;