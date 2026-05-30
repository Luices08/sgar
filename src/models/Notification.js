'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  // Destinatario
  user_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
    index:    true,
  },
  apartamento: {
    type:  String,
    trim:  true,
    uppercase: true,
  },
  // Contenido
  tipo: {
    type:    String,
    enum:    ['visita', 'domicilio', 'vehiculo', 'sistema'],
    default: 'sistema',
  },
  titulo: {
    type:     String,
    required: true,
    maxlength: 120,
  },
  mensaje: {
    type:     String,
    required: true,
    maxlength: 500,
  },
  // Referencia al registro de visita que generó la notificación
  visit_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Visit',
    default: null,
  },
  leida: {
    type:    Boolean,
    default: false,
    index:   true,
  },
}, {
  timestamps: true,
});

notificationSchema.index({ user_id: 1, leida: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
