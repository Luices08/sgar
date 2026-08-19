'use strict';

const mongoose = require('mongoose');
const { DEFAULT_DELIVERY_COMPANIES } = require('../config/constants');

const tenantSchema = new mongoose.Schema({
  // Identificador único (slug) del conjunto para URLs y referencias
  tenant_id: {
    type:      String,
    required:  [true, 'El tenant_id es requerido'],
    unique:    true,
    trim:      true,
    lowercase: true,
    minlength: [3, 'El tenant_id debe tener al menos 3 caracteres'],
    maxlength: [60, 'El tenant_id no puede superar los 60 caracteres'],
    match:     [/^[a-z0-9_-]+$/, 'El tenant_id solo puede contener letras minúsculas, números, guiones y guiones bajos'],
    index:     true,
  },

  // Nombre oficial del conjunto residencial
  nombre: {
    type:      String,
    required:  [true, 'El nombre del conjunto es requerido'],
    trim:      true,
    minlength: [3, 'El nombre debe tener al menos 3 caracteres'],
    maxlength: [120, 'El nombre no puede superar los 120 caracteres'],
  },

  // Identificación tributaria / NIT (opcional pero único si existe)
  nit: {
    type:    String,
    trim:    true,
    default: null,
  },

  // Ubicación y contacto institucional
  direccion: {
    type:      String,
    trim:      true,
    default:   null,
    maxlength: 200,
  },
  ciudad: {
    type:      String,
    trim:      true,
    default:   'Bogotá',
    maxlength: 100,
  },
  telefono: {
    type:      String,
    trim:      true,
    default:   null,
    maxlength: 30,
  },
  emailContacto: {
    type:      String,
    trim:      true,
    lowercase: true,
    default:   null,
    match:     [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Formato de email de contacto inválido'],
  },

  descripcion: {
    type:      String,
    trim:      true,
    maxlength: 500,
  },

  // Administrador Principal asignado al conjunto
  adminPrincipal: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
  },

  // Estado operativo del conjunto
  estado: {
    type:    String,
    enum:    ['activo', 'inactivo', 'suspendido', 'archivado'],
    default: 'activo',
    index:   true,
  },
  motivoSuspension: {
    type:      String,
    default:   null,
    maxlength: 500,
  },
  activo: {
    type:    Boolean,
    default: true,
    index:   true,
  },

  // Personalización visual y empresas de domicilios
  colorAcento: {
    type:    String,
    default: '#2563eb',
    match:   [/^#[0-9A-Fa-f]{6}$/, 'El color de acento debe ser un código hexadecimal válido (ej. #2563eb)'],
  },
  imagenUrl: {
    type:    String,
    default: '/uploads/default-conjunto.jpg',
  },
  deliveryEmpresas: {
    type:    [String],
    default: DEFAULT_DELIVERY_COMPANIES,
  },

  // Preservación histórica y soft-delete
  eliminado: {
    type:    Boolean,
    default: false,
    index:   true,
  },
  fechaEliminacion: {
    type:    Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Índice sparse para NIT
tenantSchema.index({ nit: 1 }, { unique: true, sparse: true });

// Sincronizar automáticamente el campo booleano `activo` según el `estado`
tenantSchema.pre('save', function (next) {
  if (this.isModified('estado')) {
    this.activo = (this.estado === 'activo' && !this.eliminado);
  }
  if (this.isModified('activo') && !this.isModified('estado')) {
    if (!this.activo && this.estado === 'activo') {
      this.estado = 'inactivo';
    } else if (this.activo && this.estado !== 'activo') {
      this.estado = 'activo';
      this.motivoSuspension = null;
    }
  }
  next();
});

module.exports = mongoose.model('Tenant', tenantSchema);
