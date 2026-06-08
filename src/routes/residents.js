'use strict';
const router    = require('express').Router();
const auth      = require('../middlewares/auth');
const authorize = require('../middlewares/authorize');
const tf        = require('../middlewares/tenantFilter');
const upload    = require('../config/multer');
const c         = require('../controllers/residentController');

router.get('/',              auth, authorize.conjuntoStaff, tf, c.list);
router.get('/:id',           auth, authorize.conjuntoStaff, tf, c.getOne);
router.post('/',             auth, authorize.adminAndConjunto, tf, upload.single('foto'), c.create);
router.put('/:id',           auth, authorize.adminAndConjunto, tf, upload.single('foto'), c.update);
router.patch('/:id/faceid',  auth, authorize.adminAndConjunto, tf, c.updateFaceId);
router.post('/:id/account',  auth, authorize.adminAndConjunto, tf, c.createAccount);
router.get('/:id/open-visit', auth, authorize.conjuntoStaff, tf, c.getOpenVisit);
router.post('/bulk',         auth, authorize.adminAndConjunto, tf, c.bulkImport);
router.delete('/:id',        auth, authorize.adminAndConjunto, tf, c.remove);

module.exports = router;