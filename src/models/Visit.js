'use strict';

const mongoose = require('mongoose');
const { VISIT_TYPES, SYNC_STATUS, ID_METHODS } = require('../config/constants');

// Sub-schema para historial de auditoría (ediciones y eliminaciones)
const auditEntrySchema = new mongoose.Schema({
  timestamp:       { type: Date,   default: Date.now },
  celador_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  celador_nombre:  { type: String },
  accion:          { type: String, enum: ['edicion', 'eliminacion'] },
  camposAnteriores:{ type: mongoose.Schema.Types.Mixed },
  camposNuevos:    { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const visitSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },

  // ─── IDENTIFICACIÓN DEL VISITANTE ─────────────────────────────────────────
  tipo: {
    type:     String,
    required: true,
    enum:     [...Object.values(VISIT_TYPES)],
  },
  nombre: {
    type:  String,
    trim:  true,
  },
  cedula: {
    type:  String,
    trim:  true,
  },
  empresa: {
    type:  String,     // Para domicilios
    trim:  true,
  },
  placa: {
    type:      String,   // Para vehículos
    trim:      true,
    uppercase: true,
  },
  fotoUrl: {
    type:  String,
    default: null,
  },

  // ─── DESTINO ──────────────────────────────────────────────────────────────
  apartamento: {
    type:     String,
    required: true,
    trim:     true,
    uppercase: true,
  },
  resident_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },

  // ─── TIEMPOS ──────────────────────────────────────────────────────────────
  horaIngreso:  { type: Date, default: Date.now },
  horaSalida:   { type: Date, default: null },

  // ─── TRAZABILIDAD ─────────────────────────────────────────────────────────
  celador_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    required: true,
  },
  celador_nombre: {
    type: String,
  },
  metodoIdentificacion: {
    type:    String,
    enum:    Object.values(ID_METHODS),
    default: ID_METHODS.MANUAL,
  },
  // Para registros vinculados a invitación
  invitation_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Invitation',
    default: null,
  },

  // ─── SINCRONIZACIÓN OFFLINE ───────────────────────────────────────────────
  syncStatus: {
    type:    String,
    enum:    Object.values(SYNC_STATUS),
    default: SYNC_STATUS.SINCRONIZADO,
  },
  // ID local de Dexie.js para deduplicación en sincronización
  localId: {
    type:  String,
    default: null,
  },

  // ─── AUDITORÍA ────────────────────────────────────────────────────────────
  observaciones: {
    type:  String,
    trim:  true,
    default: null,    // Usado por técnicos de mantenimiento
  },
  eliminado:  { type: Boolean, default: false },
  auditLog:   { type: [auditEntrySchema], default: [] },
}, {
  timestamps: true,
});

// Índices para queries frecuentes del sistema
visitSchema.index({ tenant_id: 1, horaIngreso: -1 });
visitSchema.index({ tenant_id: 1, apartamento: 1 });
visitSchema.index({ tenant_id: 1, celador_id: 1 });
visitSchema.index({ tenant_id: 1, tipo: 1 });
visitSchema.index({ localId: 1 }, { sparse: true });

module.exports = mongoose.model('Visit', visitSchema);
