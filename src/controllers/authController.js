'use strict';

const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const asyncHandler= require('../utils/asyncHandler');
const { ok, error } = require('../utils/response');
const { ROLES }   = require('../config/constants');

// User model se carga dinámicamente para evitar errores si ZIP 3 aún no está
let User;
const getUser = () => {
  if (!User) User = require('../models/User');
  return User;
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const generateToken = (user) => {
  const payload = {
    user_id:     user._id,
    rol:         user.rol,
    tenant_id:   user.tenant_id ? user.tenant_id.toString() : null,
    nombre:      user.nombre,
    email:       user.email,
    // Incluir resident_id cuando el usuario es un residente
    // (necesario para validar permisos de respuesta de vehículos)
    resident_id: user.resident_id ? user.resident_id.toString() : null,
  };

  // Celadores reciben token de larga duración (tablet dedicada)
  const expiresIn = user.rol === ROLES.CELADOR
    ? (process.env.JWT_EXPIRES_CELADOR || '30d')
    : (process.env.JWT_EXPIRES_IN      || '8h');

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return error(res, 'Email y contraseña son requeridos', 400);
  }

  const UserModel = getUser();
  const user = await UserModel.findOne({ email: email.toLowerCase().trim() })
                               .select('+password');

  if (!user || !user.activo) {
    return error(res, 'Credenciales inválidas', 401);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return error(res, 'Credenciales inválidas', 401);
  }

  const token = generateToken(user);

  // Actualizar último acceso
  user.ultimoAcceso = new Date();
  await user.save();

  // Cookie httpOnly opcional (complementa localStorage en el cliente)
  res.cookie('token', token, {
    httpOnly: true,
    maxAge:   30 * 24 * 60 * 60 * 1000, // 30 días
    sameSite: 'lax',
  });

  // Determinar configuración de tenant para el frontend
  let tenantConfig = null;
  if (user.tenant_id) {
    const Tenant = require('../models/Tenant');
    const tenant = await Tenant.findById(user.tenant_id)
                               .select('nombre colorAcento imagenUrl tenant_id deliveryEmpresas');
    if (tenant) {
      tenantConfig = {
        tenant_id:        tenant.tenant_id,
        nombre:           tenant.nombre,
        colorAcento:      tenant.colorAcento,
        imagenUrl:        tenant.imagenUrl,
        deliveryEmpresas: tenant.deliveryEmpresas,
      };
    }
  }

  return ok(res, {
    token,
    user: {
      user_id:   user._id,
      nombre:    user.nombre,
      email:     user.email,
      rol:       user.rol,
      tenant_id: user.tenant_id,
    },
    tenantConfig,
    defaultColor: process.env.DEFAULT_ACCENT_COLOR || '#1a1a2e',
  }, 'Login exitoso');
});

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
const logout = asyncHandler(async (req, res) => {
  res.clearCookie('token');
  return ok(res, {}, 'Sesión cerrada');
});

// ─── PERFIL PROPIO ────────────────────────────────────────────────────────────
const profile = asyncHandler(async (req, res) => {
  const UserModel = getUser();
  const user = await UserModel.findById(req.user.user_id).select('-password');
  if (!user) return error(res, 'Usuario no encontrado', 404);
  return ok(res, { user });
});

// ─── CAMBIAR CONTRASEÑA ───────────────────────────────────────────────────────
const changePassword = asyncHandler(async (req, res) => {
  const { passwordActual, passwordNueva } = req.body;
  if (!passwordActual || !passwordNueva) {
    return error(res, 'Contraseña actual y nueva son requeridas', 400);
  }
  if (passwordNueva.length < 6) {
    return error(res, 'La nueva contraseña debe tener al menos 6 caracteres', 400);
  }

  const UserModel = getUser();
  const user = await UserModel.findById(req.user.user_id).select('+password');
  if (!user) return error(res, 'Usuario no encontrado', 404);

  const match = await bcrypt.compare(passwordActual, user.password);
  if (!match) return error(res, 'Contraseña actual incorrecta', 401);

  user.password = await bcrypt.hash(passwordNueva, 12);
  await user.save();

  return ok(res, {}, 'Contraseña actualizada correctamente');
});

module.exports = { login, logout, profile, changePassword };
