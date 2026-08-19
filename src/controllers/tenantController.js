'use strict';

const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { ROLES, DEFAULT_DELIVERY_COMPANIES } = require('../config/constants');

const Tenant = require('../models/Tenant');
const User   = require('../models/User');

// Helper para generar slug a partir del nombre
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ─── LISTAR TENANTS ───────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const filter = {};
  
  // Por defecto solo mostrar no eliminados
  if (req.query.incluirEliminados !== 'true') {
    filter.eliminado = false;
  }

  if (req.query.estado) {
    filter.estado = req.query.estado;
  } else if (req.query.activo !== undefined) {
    filter.activo = req.query.activo === 'true';
  }

  if (req.query.q) {
    const qRe = new RegExp(req.query.q.trim(), 'i');
    filter.$or = [
      { nombre: qRe },
      { tenant_id: qRe },
      { nit: qRe },
      { ciudad: qRe },
      { emailContacto: qRe },
    ];
  }

  const [tenants, total] = await Promise.all([
    Tenant.find(filter)
      .populate('adminPrincipal', 'nombre email telefono')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Tenant.countDocuments(filter),
  ]);

  // Adjuntar estadísticas operativas básicas por conjunto
  const Resident = require('../models/Resident');
  const Visit = require('../models/Visit');

  const tenantsWithStats = await Promise.all(
    tenants.map(async (t) => {
      const [celadores, residentes, visitas] = await Promise.all([
        User.countDocuments({ tenant_id: t._id, rol: ROLES.CELADOR, activo: true }),
        Resident.countDocuments({ tenant_id: t._id, activo: true }),
        Visit.countDocuments({ tenant_id: t._id, eliminado: false }),
      ]);
      return {
        ...t.toObject(),
        stats: { celadores, residentes, visitas },
      };
    })
  );

  return paginated(res, tenantsWithStats, total, page, limit);
});

// ─── OBTENER TENANT ───────────────────────────────────────────────────────────
const getOne = asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.params.id)
    .populate('adminPrincipal', 'nombre email telefono activo ultimoAcceso');

  if (!tenant || tenant.eliminado) {
    return error(res, 'Conjunto no encontrado', 404);
  }

  // Métricas completas
  const Resident = require('../models/Resident');
  const Visit = require('../models/Visit');
  const Vehicle = require('../models/Vehicle');

  const [celadores, residentes, vehiculos, visitasTotales, visitasDentro] = await Promise.all([
    User.countDocuments({ tenant_id: tenant._id, rol: ROLES.CELADOR, activo: true }),
    Resident.countDocuments({ tenant_id: tenant._id, activo: true }),
    Vehicle.countDocuments({ tenant_id: tenant._id }),
    Visit.countDocuments({ tenant_id: tenant._id, eliminado: false }),
    Visit.countDocuments({ tenant_id: tenant._id, horaSalida: null, eliminado: false }),
  ]);

  return ok(res, {
    tenant,
    stats: { celadores, residentes, vehiculos, visitasTotales, visitasDentro },
  });
});

// ─── CREAR TENANT (onboarding automático y atómico) ───────────────────────────
const create = asyncHandler(async (req, res) => {
  let {
    tenant_id, nombre, nit, direccion, ciudad, telefono, emailContacto, descripcion, colorAcento,
    adminEmail, adminNombre, adminPassword, adminCedula,
    deliveryEmpresas,
  } = req.body;

  // 1. Validaciones básicas de campos obligatorios
  if (!nombre || nombre.trim().length < 3) {
    return error(res, 'El nombre del conjunto es obligatorio y debe tener al menos 3 caracteres', 400);
  }

  nombre = nombre.trim();

  if (!adminEmail) {
    return error(res, 'El correo electrónico del Administrador Principal es obligatorio', 400);
  }

  adminEmail = adminEmail.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(adminEmail)) {
    return error(res, 'El correo del Administrador Principal tiene un formato inválido', 400);
  }

  // 2. Generación y validación de tenant_id
  if (!tenant_id || !tenant_id.trim()) {
    tenant_id = slugify(nombre);
  } else {
    tenant_id = slugify(tenant_id);
  }

  if (tenant_id.length < 3) {
    tenant_id = `${tenant_id}_conjunto`;
  }

  // 3. Comprobación de unicidad previa
  const [existingTenant, existingNit, existingAdminUser] = await Promise.all([
    Tenant.findOne({ tenant_id }),
    nit ? Tenant.findOne({ nit: nit.trim(), eliminado: false }) : null,
    User.findOne({ email: adminEmail }),
  ]);

  if (existingTenant) {
    return error(res, `El identificador único (slug) '${tenant_id}' ya se encuentra en uso`, 409);
  }

  if (existingNit) {
    return error(res, `El NIT / Identificación '${nit.trim()}' ya pertenece a otro conjunto registrado`, 409);
  }

  if (existingAdminUser) {
    return error(res, `El correo '${adminEmail}' ya está registrado por otro usuario en la plataforma`, 409);
  }

  let createdTenant = null;
  let createdAdmin  = null;

  try {
    const imagenUrl = req.file ? `/uploads/conjuntos/${req.file.filename}` : undefined;

    // PASO 1 — Crear registro del Tenant
    createdTenant = await Tenant.create({
      tenant_id,
      nombre,
      nit:           nit ? nit.trim() : null,
      direccion:     direccion ? direccion.trim() : null,
      ciudad:        ciudad ? ciudad.trim() : 'Bogotá',
      telefono:      telefono ? telefono.trim() : null,
      emailContacto: emailContacto ? emailContacto.toLowerCase().trim() : null,
      descripcion:   descripcion ? descripcion.trim() : null,
      colorAcento:   colorAcento || '#2563eb',
      imagenUrl,
      estado:        'activo',
      activo:        true,
      deliveryEmpresas: deliveryEmpresas || DEFAULT_DELIVERY_COMPANIES,
    });

    // PASO 2 — Crear cuenta de Administrador Principal
    const rawPwd = adminPassword && adminPassword.length >= 6 ? adminPassword : 'admin' + Math.floor(1000 + Math.random() * 9000);
    const hashedPwd = await bcrypt.hash(rawPwd, 12);

    createdAdmin = await User.create({
      nombre:    adminNombre ? adminNombre.trim() : `Admin ${nombre}`,
      email:     adminEmail,
      password:  hashedPwd,
      rol:       ROLES.ADMIN_CONJUNTO,
      tenant_id: createdTenant._id,
      cedula:    adminCedula ? adminCedula.trim() : undefined,
      activo:    true,
    });

    // PASO 3 — Asociar Administrador Principal al Tenant
    createdTenant.adminPrincipal = createdAdmin._id;
    await createdTenant.save();

    return created(res, {
      tenant: createdTenant,
      adminPrincipal: {
        id:              createdAdmin._id,
        nombre:          createdAdmin.nombre,
        email:           createdAdmin.email,
        passwordInicial: rawPwd,
      },
    }, 'Conjunto residencial y Administrador Principal creados exitosamente');

  } catch (err) {
    // COMPENSACIÓN ATÓMICA en caso de error
    if (createdAdmin)  await User.findByIdAndDelete(createdAdmin._id).catch(() => {});
    if (createdTenant) await Tenant.findByIdAndDelete(createdTenant._id).catch(() => {});
    throw err;
  }
});

// ─── ACTUALIZAR TENANT ────────────────────────────────────────────────────────
const update = asyncHandler(async (req, res) => {
  const {
    nombre, nit, direccion, ciudad, telefono, emailContacto,
    descripcion, colorAcento, estado, motivoSuspension, activo,
    deliveryEmpresas, adminPrincipal,
  } = req.body;

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant || tenant.eliminado) {
    return error(res, 'Conjunto no encontrado', 404);
  }

  // Validar NIT único si se modifica
  if (nit && nit.trim() !== tenant.nit) {
    const nitExists = await Tenant.findOne({ _id: { $ne: tenant._id }, nit: nit.trim(), eliminado: false });
    if (nitExists) return error(res, `El NIT '${nit.trim()}' ya pertenece a otro conjunto`, 409);
    tenant.nit = nit.trim();
  } else if (nit === null || nit === '') {
    tenant.nit = null;
  }

  if (nombre           !== undefined) tenant.nombre           = nombre.trim();
  if (direccion        !== undefined) tenant.direccion        = direccion.trim();
  if (ciudad           !== undefined) tenant.ciudad           = ciudad.trim();
  if (telefono         !== undefined) tenant.telefono         = telefono.trim();
  if (emailContacto    !== undefined) tenant.emailContacto    = emailContacto.toLowerCase().trim();
  if (descripcion      !== undefined) tenant.descripcion      = descripcion.trim();
  if (colorAcento      !== undefined) tenant.colorAcento      = colorAcento;
  if (deliveryEmpresas !== undefined) tenant.deliveryEmpresas = deliveryEmpresas;
  if (adminPrincipal   !== undefined) tenant.adminPrincipal   = adminPrincipal || null;
  if (req.file)                       tenant.imagenUrl        = `/uploads/conjuntos/${req.file.filename}`;

  // Manejo de estado operativo
  if (estado !== undefined) {
    tenant.estado = estado;
    if (estado === 'activo') {
      tenant.activo = true;
      tenant.motivoSuspension = null;
    } else if (estado === 'suspendido' || estado === 'inactivo') {
      tenant.activo = false;
      if (motivoSuspension) tenant.motivoSuspension = motivoSuspension.trim();
    }
  } else if (activo !== undefined) {
    const isActivo = activo === true || activo === 'true';
    tenant.activo = isActivo;
    tenant.estado = isActivo ? 'activo' : 'inactivo';
    if (isActivo) tenant.motivoSuspension = null;
  }

  await tenant.save();

  return ok(res, { tenant }, 'Conjunto actualizado exitosamente');
});

// ─── CAMBIAR ESTADO RÁPIDO (Activar / Suspender / Inactivar) ──────────────────
const cambiarEstado = asyncHandler(async (req, res) => {
  const { estado, motivoSuspension } = req.body;
  
  if (!['activo', 'inactivo', 'suspendido'].includes(estado)) {
    return error(res, "El estado debe ser 'activo', 'inactivo' o 'suspendido'", 400);
  }

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant || tenant.eliminado) {
    return error(res, 'Conjunto no encontrado', 404);
  }

  tenant.estado = estado;
  tenant.activo = (estado === 'activo');
  tenant.motivoSuspension = (estado === 'suspendido' && motivoSuspension) ? motivoSuspension.trim() : null;
  await tenant.save();

  return ok(res, { tenant }, `Estado del conjunto cambiado a '${estado}' exitosamente`);
});

// ─── ELIMINAR / ARCHIVAR TENANT (SOFT-DELETE CON PRESERVACIÓN HISTÓRICA) ──────
const remove = asyncHandler(async (req, res) => {
  const { password, forcePurge } = req.body;
  if (!password) {
    return error(res, 'Debe proporcionar su contraseña de SuperAdmin para confirmar la acción', 400);
  }

  // Verificar contraseña de SuperAdmin (req.user)
  const currentUser = await User.findById(req.user.user_id).select('+password');
  if (!currentUser) return error(res, 'Usuario no encontrado', 404);

  const match = await bcrypt.compare(password, currentUser.password);
  if (!match) return error(res, 'Contraseña de confirmación incorrecta', 401);

  const tenantId = req.params.id;
  const tenant = await Tenant.findById(tenantId);
  if (!tenant || tenant.eliminado) return error(res, 'Conjunto no encontrado', 404);

  // PURGA COMPLETA FÍSICA SOLO SI SE SOLICITA EXPLÍCITAMENTE
  if (forcePurge === true || forcePurge === 'true') {
    const Resident = require('../models/Resident');
    const Visit = require('../models/Visit');
    const VehicleAccessLog = require('../models/VehicleAccessLog');
    const FacialEnrollment = require('../models/FacialEnrollment');
    const Notification = require('../models/Notification');
    const Invitation = require('../models/Invitation');
    const Vehicle = require('../models/Vehicle');
    const VehicleInvitation = require('../models/VehicleInvitation');

    await Promise.all([
      User.deleteMany({ tenant_id: tenantId }),
      Resident.deleteMany({ tenant_id: tenantId }),
      Visit.deleteMany({ tenant_id: tenantId }),
      Vehicle.deleteMany({ tenant_id: tenantId }),
      VehicleInvitation.deleteMany({ tenant_id: tenantId }),
      VehicleAccessLog.deleteMany({ tenant_id: tenantId }),
      FacialEnrollment.deleteMany({ tenant_id: tenantId }),
      Notification.deleteMany({ tenant_id: tenantId }),
      Invitation.deleteMany({ tenant_id: tenantId }),
      Tenant.findByIdAndDelete(tenantId),
    ]);

    return ok(res, {}, 'Conjunto y registros purgados definitivamente');
  }

  // POR DEFECTO: SOFT-DELETE SEGURO (PRESERVACIÓN DE HISTÓRICO)
  tenant.activo           = false;
  tenant.estado           = 'archivado';
  tenant.eliminado        = true;
  tenant.fechaEliminacion = new Date();
  tenant.tenant_id        = `${tenant.tenant_id}_archived_${Date.now()}`; // libera el slug original
  if (tenant.nit) tenant.nit = `${tenant.nit}_archived_${Date.now()}`;
  await tenant.save();

  // Inactivar usuarios para impedir cualquier acceso
  await User.updateMany({ tenant_id: tenantId }, { $set: { activo: false } });

  return ok(res, {}, 'Conjunto archivado y desactivado. Las bitácoras históricas se han preservado.');
});

// ─── MÉTRICAS GLOBALES DE ANALYTICS ───────────────────────────────────────────
const analytics = asyncHandler(async (req, res) => {
  const Visit    = require('../models/Visit');
  const Resident = require('../models/Resident');

  const tenants = await Tenant.find({ eliminado: false }).lean();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const data = await Promise.all(
    tenants.map(async (t) => {
      const [ingresos7d, totalResidentes] = await Promise.all([
        Visit.countDocuments({ tenant_id: t._id, horaIngreso: { $gte: since7d }, eliminado: false }),
        Resident.countDocuments({ tenant_id: t._id, activo: true }),
      ]);
      return {
        tenant_id:       t._id,
        slug:            t.tenant_id,
        nombre:          t.nombre,
        colorAcento:     t.colorAcento,
        estado:          t.estado,
        activo:          t.activo,
        ingresos7d,
        totalResidentes,
      };
    })
  );

  return ok(res, { analytics: data });
});

module.exports = {
  list,
  getOne,
  create,
  update,
  cambiarEstado,
  analytics,
  remove,
};
