'use strict';

const mongoose    = require('mongoose');
const bcrypt      = require('bcryptjs');
const asyncHandler= require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { ROLES, DEFAULT_DELIVERY_COMPANIES } = require('../config/constants');

const Tenant = require('../models/Tenant');
const User   = require('../models/User');

// ─── LISTAR TENANTS ───────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = {};
  if (req.query.activo !== undefined) filter.activo = req.query.activo === 'true';

  const [tenants, total] = await Promise.all([
    Tenant.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Tenant.countDocuments(filter),
  ]);

  // Para cada tenant, adjuntar métricas básicas
  const tenantsWithStats = await Promise.all(
    tenants.map(async (t) => {
      const [celadores, residentes] = await Promise.all([
        User.countDocuments({ tenant_id: t._id, rol: ROLES.CELADOR, activo: true }),
        require('../models/Resident').countDocuments({ tenant_id: t._id, activo: true }),
      ]);
      return {
        ...t.toObject(),
        stats: { celadores, residentes },
      };
    })
  );

  return paginated(res, tenantsWithStats, total, page, limit);
});

// ─── OBTENER TENANT ───────────────────────────────────────────────────────────
const getOne = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) return error(res, 'Conjunto no encontrado', 404);
  return ok(res, { tenant });
});

// ─── CREAR TENANT (onboarding automático) ─────────────────────────────────────
const create = asyncHandler(async (req, res) => {
  const {
    tenant_id, nombre, descripcion, colorAcento,
    adminEmail, adminNombre, adminPassword,
    deliveryEmpresas,
  } = req.body;

  // Validaciones básicas
  if (!tenant_id || !nombre || !adminEmail) {
    return error(res, 'tenant_id, nombre y adminEmail son requeridos', 400);
  }

  // Verificar que tenant_id no exista
  const exists = await Tenant.findOne({ tenant_id });
  if (exists) return error(res, `El tenant_id '${tenant_id}' ya existe`, 409);

  let createdTenant = null;
  let createdAdmin  = null;

  try {
    // PASO 1 — Crear tenant
    const imagenUrl = req.file ? `/uploads/conjuntos/${req.file.filename}` : undefined;
    createdTenant = await Tenant.create({
      tenant_id,
      nombre,
      descripcion,
      colorAcento: colorAcento || '#1a1a2e',
      imagenUrl,
      deliveryEmpresas: deliveryEmpresas || DEFAULT_DELIVERY_COMPANIES,
    });

    // PASO 2 — Crear AdminConjunto
    const rawPwd = adminPassword || '123456';
    const hashedPwd = await bcrypt.hash(rawPwd, 12);
    createdAdmin = await User.create({
      nombre:    adminNombre || `Admin ${nombre}`,
      email:     adminEmail.toLowerCase().trim(),
      password:  hashedPwd,
      rol:       ROLES.ADMIN_CONJUNTO,
      tenant_id: createdTenant._id,
      activo:    true,
    });

    return created(res, {
      tenant:       createdTenant,
      adminConjunto: { id: createdAdmin._id, email: createdAdmin.email },
    }, 'Conjunto creado exitosamente');

  } catch (err) {
    // COMPENSACIÓN: revertir si algo falló
    if (createdTenant) await Tenant.findByIdAndDelete(createdTenant._id).catch(() => {});
    if (createdAdmin)  await User.findByIdAndDelete(createdAdmin._id).catch(() => {});
    throw err;
  }
});

// ─── ACTUALIZAR TENANT ────────────────────────────────────────────────────────
const update = asyncHandler(async (req, res) => {
  const { nombre, descripcion, colorAcento, activo, deliveryEmpresas } = req.body;
  const updateData = {};

  if (nombre           !== undefined) updateData.nombre           = nombre;
  if (descripcion      !== undefined) updateData.descripcion      = descripcion;
  if (colorAcento      !== undefined) updateData.colorAcento      = colorAcento;
  if (activo           !== undefined) updateData.activo           = activo;
  if (deliveryEmpresas !== undefined) updateData.deliveryEmpresas = deliveryEmpresas;
  if (req.file) updateData.imagenUrl = `/uploads/conjuntos/${req.file.filename}`;

  const tenant = await Tenant.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  );

  if (!tenant) return error(res, 'Conjunto no encontrado', 404);
  return ok(res, { tenant }, 'Conjunto actualizado');
});

// ─── MÉTRICAS DE ANALYTICS ───────────────────────────────────────────────────
const analytics = asyncHandler(async (req, res) => {
  const Visit    = require('../models/Visit');
  const Resident = require('../models/Resident');

  const tenants = await Tenant.find({ activo: true }).lean();

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const data = await Promise.all(
    tenants.map(async (t) => {
      const [ingresos7d, totalResidentes] = await Promise.all([
        Visit.countDocuments({ tenant_id: t._id, horaIngreso: { $gte: since7d }, eliminado: false }),
        Resident.countDocuments({ tenant_id: t._id, activo: true }),
      ]);
      return {
        tenant_id:       t._id,
        nombre:          t.nombre,
        colorAcento:     t.colorAcento,
        ingresos7d,
        totalResidentes,
      };
    })
  );

  return ok(res, { analytics: data });
});

module.exports = { list, getOne, create, update, analytics };
