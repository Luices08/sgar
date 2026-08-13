'use strict';

const mongoose = require('mongoose');
const { DEFAULT_DELIVERY_COMPANIES } = require('../config/constants');

const tenantSchema = new mongoose.Schema({
  tenant_id: {
    type:     String,
    required: true,
    unique:   true,
    trim:     true,
    lowercase: true,
    match:    /^[a-z0-9_]+$/,
  },
  nombre: {
    type:     String,
    required: true,
    trim:     true,
    maxlength: 120,
  },
  descripcion: {
    type:  String,
    trim:  true,
    maxlength: 500,
  },
  colorAcento: {
    type:    String,
    default: '#2563eb',
    match:   /^#[0-9A-Fa-f]{6}$/,
  },
  imagenUrl: {
    type:    String,
    default: '/uploads/default-conjunto.jpg',
  },
  activo: {
    type:    Boolean,
    default: true,
  },
  deliveryEmpresas: {
    type:    [String],
    default: DEFAULT_DELIVERY_COMPANIES,
  },
}, {
  timestamps: true,
});

// Índice en tenant_id ya garantizado por unique:true
module.exports = mongoose.model('Tenant', tenantSchema);
