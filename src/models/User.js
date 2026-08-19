'use strict';

const mongoose = require('mongoose');
const { ROLES } = require('../config/constants');

const userSchema = new mongoose.Schema({
  nombre: {
    type:     String,
    required: true,
    trim:     true,
    maxlength: 100,
  },
  email: {
    type:      String,
    required:  true,
    unique:    true,
    lowercase: true,
    trim:      true,
  },
  password: {
    type:     String,
    required: true,
    select:   false,    // No se devuelve en queries por defecto
  },
  rol: {
    type:     String,
    required: true,
    enum:     Object.values(ROLES),
  },
  tenant_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Tenant',
    default: null,
    index:   true,
  },
  activo: {
    type:    Boolean,
    default: true,
  },
  ultimoAcceso: {
    type: Date,
  },
  // Solo para residente: referencia al documento de Resident
  resident_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Resident',
    default: null,
  },
  cedula: {
    type: String,
    trim: true,
  },
}, {
  timestamps: true,
});

// Índice compuesto para consultas por tenant + rol y tenant + cedula
userSchema.index({ tenant_id: 1, rol: 1 });
userSchema.index({ tenant_id: 1, cedula: 1 });

module.exports = mongoose.model('User', userSchema);
