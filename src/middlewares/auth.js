'use strict';

const jwt = require('jsonwebtoken');
const { error } = require('../utils/response');

/**
 * Verifica el JWT de la petición.
 * Busca el token en: Authorization header (Bearer) o cookie "token"
 */
const auth = (req, res, next) => {
  try {
    let token = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      // Para rutas de vista, redirigir al login
      if (!req.originalUrl.startsWith('/api/')) {
        return res.redirect('/admin/login');
      }
      return error(res, 'Token de autenticación requerido', 401);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;   // { user_id, rol, tenant_id, nombre, email }
    next();
  } catch (err) {
    if (!req.originalUrl.startsWith('/api/')) {
      return res.redirect('/admin/login');
    }
    return error(res, 'Token inválido o expirado', 401);
  }
};

module.exports = auth;
