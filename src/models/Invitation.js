'use strict';

const mongoose = require('mongoose');
const { INVITATION_STATUS } = require('../config/constants');

const invitationSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  // Quién crea la invitación
  resident_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Resident',
    required: true,
  },
  user_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },
  apartamento: {
    type:     String,
    required: true,
    trim:     true,
    uppercase: true,
  },
  // El visitante esperado
  nombreVisitante: {
    type:     String,
    required: true,
    trim:     true,
    maxlength: 100,
  },
  // Fecha y hora estimada de llegada
  fechaEsperada: {
    type:     Date,
    required: true,
  },
  // Código numérico de 6 dígitos para presentar en portería
  codigo: {
    type:     String,
    required: true,
    length:   6,
    unique:   true,
    index:    true,
  },
  estado: {
    type:    String,
    enum:    Object.values(INVITATION_STATUS),
    default: INVITATION_STATUS.PENDIENTE,
    index:   true,
  },
  // Referencia al registro de visita al completarse
  visit_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Visit',
    default: null,
  },
  // Fecha en que se completó o canceló
  fechaResolucion: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

invitationSchema.index({ tenant_id: 1, estado: 1 });

module.exports = mongoose.model('Invitation', invitationSchema);
