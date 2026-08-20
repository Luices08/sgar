'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error } = require('../utils/response');
const Visit        = require('../models/Visit');
const Invitation   = require('../models/Invitation');
const Notification = require('../models/Notification');
const Resident     = require('../models/Resident');
const { VISIT_TYPES, SYNC_STATUS, ID_METHODS } = require('../config/constants');

// ─── Validaciones de campo ─────────────────────────────────────────────────────
const SOLO_LETRAS    = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/;
const SOLO_NUMEROS   = /^\d+$/;

function validarCamposVisitante({ nombre, documento, telefono }) {
  const errores = [];
  if (!nombre || !SOLO_LETRAS.test(nombre.trim())) {
    errores.push('El nombre solo puede contener letras y espacios.');
  }
  if (!documento || !SOLO_NUMEROS.test(documento.trim())) {
    errores.push('El documento solo puede contener números.');
  }
  if (telefono && !SOLO_NUMEROS.test(telefono.trim())) {
    errores.push('El teléfono solo puede contener números.');
  }
  return errores;
}

function validarFormatoPlaca(tipo, placa) {
  if (!placa) return { valida: false, mensaje: 'La placa del vehículo es requerida.' };
  const clean = placa.toUpperCase().replace(/[\s-]/g, '').trim();
  const t = (tipo || 'Carro').toLowerCase();

  if (t === 'motocicleta' || t === 'moto') {
    const regexMoto = /^[A-Z]{3}[0-9]{2}[A-Z]$/;
    if (!regexMoto.test(clean)) {
      return {
        valida: false,
        mensaje: 'Formato de placa de moto inválido. Debe tener estrictamente 3 letras, 2 números y 1 letra (Ej: ABC 12D).'
      };
    }
  } else if (t === 'carro' || t === 'automovil' || t === 'automóvil') {
    const regexCarro = /^[A-Z]{3}[0-9]{3}$/;
    if (!regexCarro.test(clean)) {
      return {
        valida: false,
        mensaje: 'Formato de placa de carro inválido. Debe tener estrictamente 3 letras y 3 números (Ej: ABC 123).'
      };
    }
  } else {
    const regexGenerico = /^[A-Z0-9]{5,7}$/;
    if (!regexGenerico.test(clean)) {
      return {
        valida: false,
        mensaje: 'Formato de placa inválido.'
      };
    }
  }

  return { valida: true, cleanPlaca: clean };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR VISITANTE — MANUAL (sin código de invitación)
// POST /api/visitors/registro-manual
// Uso: visitantes externos y técnicos de mantenimiento
// ─────────────────────────────────────────────────────────────────────────────
const registroManual = asyncHandler(async (req, res) => {
  const {
    nombre,
    documento,
    telefono,
    apartamento,
    tipoVisita,     // 'visita' | 'tecnico_mantenimiento'
    empresa,        // opcional para técnicos
    observaciones,
    localId,
    placa,
    tipoVehiculo,
    marcaVehiculo,
    modeloVehiculo,
  } = req.body;

  // Validaciones de formato
  const errores = validarCamposVisitante({ nombre, documento, telefono });
  if (!apartamento) errores.push('El apartamento es requerido.');

  let cleanPlaca = null;
  if (placa && String(placa).trim()) {
    const valPlaca = validarFormatoPlaca(tipoVehiculo, placa);
    if (!valPlaca.valida) {
      errores.push(valPlaca.mensaje);
    } else {
      cleanPlaca = valPlaca.cleanPlaca;
    }
  }

  if (errores.length > 0) return error(res, errores.join(' '), 422, errores);

  // Deduplicar offline
  if (localId) {
    const existing = await Visit.findOne({ localId, tenant_id: req.tenantId });
    if (existing) return ok(res, { visit: existing }, 'Ya sincronizado');
  }

  // Determinar el tipo correcto para el schema
  const tipoVisitaFinal = tipoVisita === 'tecnico_mantenimiento'
    ? VISIT_TYPES.TECNICO
    : VISIT_TYPES.VISITA;

  const visit = await Visit.create({
    tenant_id:            req.tenantId,
    tipo:                 tipoVisitaFinal,
    nombre:               nombre.trim(),
    cedula:               documento.trim(),
    empresa:              empresa?.trim() || null,
    apartamento:          apartamento.toUpperCase().trim(),
    placa:                cleanPlaca,
    tipoVehiculo:         tipoVehiculo || (cleanPlaca ? 'Carro' : null),
    marcaVehiculo:        marcaVehiculo?.trim() || null,
    modeloVehiculo:       modeloVehiculo?.trim() || null,
    horaIngreso:          new Date(),
    celador_id:           req.user.user_id,
    celador_nombre:       req.user.nombre,
    metodoIdentificacion: ID_METHODS.MANUAL,
    syncStatus:           SYNC_STATUS.SINCRONIZADO,
    localId:              localId || null,
    observaciones:        observaciones?.trim() || null,
  });

  // Notificar al residente del apartamento destino
  await _notificarResidente(visit, req.tenantId);

  return created(res, { visit }, 'Visitante registrado');
});

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRAR VISITANTE — CON CÓDIGO DE INVITACIÓN
// POST /api/visitors/registro-codigo
// ─────────────────────────────────────────────────────────────────────────────
const registroCodigo = asyncHandler(async (req, res) => {
  const { codigo, localId } = req.body;

  if (!codigo) return error(res, 'El código de invitación es requerido', 400);

  // Buscar la invitación activa con ese código
  const invitation = await Invitation.findOne({
    tenant_id: req.tenantId,
    codigo:    String(codigo).trim(),
    estado:    'pendiente',
  });

  if (!invitation) {
    return error(res, 'Código de invitación inválido o ya utilizado', 404);
  }

  // Verificar que no haya expirado (si tiene fecha límite)
  if (invitation.fechaEsperada) {
    const limite = new Date(invitation.fechaEsperada);
    limite.setDate(limite.getDate() + 1);  // Válida durante el día de la cita
    if (new Date() > limite) {
      return error(res, 'La invitación ha expirado', 410);
    }
  }

  // Deduplicar offline
  if (localId) {
    const existing = await Visit.findOne({ localId, tenant_id: req.tenantId });
    if (existing) return ok(res, { visit: existing }, 'Ya sincronizado');
  }

  // Crear el registro de visita
  const visit = await Visit.create({
    tenant_id:            req.tenantId,
    tipo:                 VISIT_TYPES.VISITA,
    nombre:               invitation.nombreVisitante,
    apartamento:          invitation.apartamento,
    horaIngreso:          new Date(),
    invitation_id:        invitation._id,
    celador_id:           req.user.user_id,
    celador_nombre:       req.user.nombre,
    metodoIdentificacion: ID_METHODS.CODIGO,
    syncStatus:           SYNC_STATUS.SINCRONIZADO,
    localId:              localId || null,
  });

  // Marcar la invitación como completada
  invitation.estado         = 'completado';
  invitation.horaIngresReal = new Date();
  await invitation.save();

  // Notificar al residente
  await _notificarResidente(visit, req.tenantId);

  return created(res, { visit, invitation }, 'Ingreso con invitación registrado');
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAR CÓDIGO (el celador consulta antes de confirmar)
// GET /api/visitors/validar-codigo/:codigo
// ─────────────────────────────────────────────────────────────────────────────
const validarCodigo = asyncHandler(async (req, res) => {
  const invitation = await Invitation.findOne({
    tenant_id: req.tenantId,
    codigo:    String(req.params.codigo).trim(),
    estado:    'pendiente',
  }).lean();

  if (!invitation) {
    return error(res, 'Código no válido o ya utilizado', 404);
  }

  return ok(res, {
    valido:           true,
    nombreVisitante:  invitation.nombreVisitante,
    apartamento:      invitation.apartamento,
    fechaEsperada:    invitation.fechaEsperada,
    invitation_id:    invitation._id,
  }, 'Código válido');
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTAR REGISTROS DE VISITANTES DEL DÍA
// GET /api/visitors
// ─────────────────────────────────────────────────────────────────────────────
const listar = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip  = (page - 1) * limit;

  const validTypes = [VISIT_TYPES.VISITA, VISIT_TYPES.DOMICILIO, VISIT_TYPES.TECNICO, 'visita', 'domicilio', 'tecnico_mantenimiento'];

  const filter = {
    tenant_id: req.tenantId,
    eliminado: false,
    tipo:      req.query.tipo ? req.query.tipo : { $in: validTypes },
  };

  if (req.query.apartamento) filter.apartamento = req.query.apartamento.toUpperCase().trim();

  if (req.query.estado === 'dentro' || req.query.estadoAcceso === 'dentro') {
    filter.horaSalida = null;
  } else if (req.query.estado === 'fuera' || req.query.estado === 'salida' || req.query.estadoAcceso === 'fuera') {
    filter.horaSalida = { $ne: null };
  }

  if (req.query.q) {
    const term = req.query.q.trim();
    const regex = new RegExp(term, 'i');
    filter.$or = [
      { nombre: regex },
      { cedula: regex },
      { apartamento: regex },
      { empresa: regex },
      { placa: regex },
    ];
  }

  if (req.query.fecha) {
    const parts = req.query.fecha.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const start = new Date(year, month, day, 0, 0, 0, 0);
      const end = new Date(year, month, day, 23, 59, 59, 999);
      filter.horaIngreso = { $gte: start, $lte: end };
    }
  }

  const [visits, total, insideCount] = await Promise.all([
    Visit.find(filter).sort({ horaIngreso: -1 }).skip(skip).limit(limit).lean(),
    Visit.countDocuments(filter),
    Visit.countDocuments({
      tenant_id: req.tenantId,
      eliminado: false,
      tipo: { $in: validTypes },
      horaSalida: null,
    }),
  ]);

  const decoratedVisits = visits.map(v => ({
    ...v,
    estadoAcceso: v.horaSalida ? 'fuera' : 'dentro',
  }));

  return res.status(200).json({
    success: true,
    data: decoratedVisits,
    meta: {
      dentroCount: insideCount,
    },
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── HELPER: Notificar al residente del apartamento destino ───────────────────
async function _notificarResidente(visit, tenantId) {
  try {
    const resident = await Resident.findOne({
      tenant_id:   tenantId,
      apartamento: visit.apartamento,
      activo:      true,
    });
    if (!resident?.user_id) return;

    await Notification.create({
      tenant_id:   tenantId,
      user_id:     resident.user_id,
      apartamento: visit.apartamento,
      tipo:        visit.tipo,
      titulo:      visit.tipo === VISIT_TYPES.TECNICO
        ? `Técnico en portería — Apto ${visit.apartamento}`
        : `Visita de ${visit.nombre} — Apto ${visit.apartamento}`,
      mensaje: `Registrado a las ${new Date(visit.horaIngreso).toLocaleTimeString('es-CO')}`,
      visit_id: visit._id,
    });
  } catch (_) { /* No interrumpir el flujo */ }
}

module.exports = { registroManual, registroCodigo, validarCodigo, listar };
