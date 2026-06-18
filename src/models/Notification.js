'use strict';

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  tenant_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Tenant',
    required: true,
    index:    true,
  },
  // Destinatario (null = visible para todos los admins del tenant)
  user_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'User',
    default: null,
    index:   true,
  },
  apartamento: {
    type:  String,
    trim:  true,
    uppercase: true,
  },
  // Contenido
  tipo: {
    type:    String,
    enum:    [
      'visita', 'domicilio', 'vehiculo', 'sistema',
      'vehiculo_nuevo',      // Vehículo registrado en portería → aviso al admin
      'permiso_vehiculo',    // Solicitud de permiso → propietario debe responder
      'permiso_aprobado',    // Propietario dijo Sí → aviso al celador
      'permiso_rechazado',   // Propietario dijo No → aviso al celador
      'tecnico_mantenimiento',
      'autorizacion_visita', // Celador pide permiso de ingreso a Residente
    ],
    default: 'sistema',
  },
  estadoAprobacion: {
    type: String,
    enum: ['pendiente', 'aprobado', 'rechazado'],
    default: 'pendiente',
  },
  titulo: {
    type:     String,
    required: true,
    maxlength: 200,
  },
  mensaje: {
    type:     String,
    required: true,
    maxlength: 1000,
  },
  // Referencia al registro de visita que generó la notificación
  visit_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Visit',
    default: null,
  },
  // Referencia al permiso vehicular (cuando tipo = 'permiso_*')
  permission_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'VehiclePermission',
    default: null,
  },
  // Indica si el residente debe dar una respuesta (para permisos vehiculares)
  requiereRespuesta: {
    type:    Boolean,
    default: false,
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
