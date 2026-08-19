'use strict';

module.exports = {
  // ─── ROLES ────────────────────────────────────────────────────────────────
  ROLES: {
    ADMIN_CONTROL:  'adminControl',
    ADMIN_CONJUNTO: 'adminConjunto',
    CELADOR:        'celador',
    RESIDENTE:      'residente',
  },

  // ─── TIPOS DE VISITA ───────────────────────────────────────────────────────
  VISIT_TYPES: {
    VISITA:               'visita',
    DOMICILIO:            'domicilio',
    VEHICULO:             'vehiculo',
    TECNICO:              'tecnico_mantenimiento',   // Personal externo de mantenimiento
    RESIDENTE:            'residente',               // Ingreso/salida de residente
  },

  // ─── ESTADOS DE PERMISO VEHICULAR ─────────────────────────────────────────
  PERMISSION_STATUS: {
    PENDIENTE:   'pendiente',
    APROBADO:    'aprobado',
    RECHAZADO:   'rechazado',
    EXPIRADO:    'expirado',
    COMPLETADO:  'completado',
  },

  // ─── TIMEOUT PARA PERMISOS VEHICULARES (ms) ────────────────────────────────
  VEHICLE_PERMISSION_TIMEOUT_MS: 3 * 60 * 1000,   // 3 minutos

  // ─── ESTADOS DE SINCRONIZACIÓN ─────────────────────────────────────────────
  SYNC_STATUS: {
    PENDIENTE:    'pendiente',
    SINCRONIZADO: 'sincronizado',
  },

  // ─── ESTADOS DE INVITACIÓN ─────────────────────────────────────────────────
  INVITATION_STATUS: {
    PENDIENTE:   'pendiente',
    COMPLETADO:  'completado',
    CANCELADO:   'cancelado',
  },

  // ─── MÉTODOS DE IDENTIFICACIÓN ─────────────────────────────────────────────
  ID_METHODS: {
    FACIAL: 'facial',
    OCR:    'ocr',
    MANUAL: 'manual',
    CODIGO: 'codigo_invitacion',
  },

  // ─── PAGINACIÓN ────────────────────────────────────────────────────────────
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE:     100,

  // ─── COLOR POR DEFECTO ─────────────────────────────────────────────────────
  DEFAULT_ACCENT_COLOR: '#2563eb',

  // ─── EMPRESAS DOMICILIO PRECONFIGURADAS ────────────────────────────────────
  DEFAULT_DELIVERY_COMPANIES: [
    'Rappi', 'iFood', 'DidiFood', 'Domicilios.com', 'MercadoShops', 'Otro'
  ],
};
