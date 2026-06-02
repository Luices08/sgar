'use strict';

const mongoose = require('mongoose');

/**
 * FacialEnrollment
 * ─────────────────────────────────────────────────────────────────────────────
 * Registra cada vez que un residente enrola, actualiza o elimina su faceId.
 * Permite auditoría y trazabilidad del módulo biométrico.
 */
const facialEnrollmentSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  resident_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Resident',
    required: true,
    index:    true,
  },
  faceId: {
    type:    String,
    default: null,
  },
  accion: {
    type:     String,
    enum:     ['enrolado', 'actualizado', 'eliminado'],
    required: true,
  },
  // Quién ejecutó la acción (adminConjunto o el propio sistema)
  realizadoPor_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
  },
  realizadoPor_nombre: {
    type:    String,
    default: null,
  },
  // Fuente del enrolamiento
  fuente: {
    type:    String,
    enum:    ['automatico', 'manual', 'porteria'],
    default: 'automatico',
  },
  observaciones: {
    type:    String,
    default: null,
  },
}, {
  timestamps: true,
});

facialEnrollmentSchema.index({ tenant_id: 1, resident_id: 1, createdAt: -1 });

module.exports = mongoose.model('FacialEnrollment', facialEnrollmentSchema);
