'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { ok, created, error, paginated } = require('../utils/response');
const { VISIT_TYPES, SYNC_STATUS, ROLES, ID_METHODS } = require('../config/constants');

const Visit = require('../models/Visit');
const Notification = require('../models/Notification');
const Resident = require('../models/Resident');
const User = require('../models/User');

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
        mensaje: 'Formato de placa inválido. Debe tener entre 5 y 7 caracteres alfanuméricos.'
      };
    }
  }

  return { valida: true, cleanPlaca: clean };
}

// ─── LISTAR VISITAS ───────────────────────────────────────────────────────────
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const skip = (page - 1) * limit;

  const filter = {
    eliminado: false,
  };

  if (req.tenantId) {
    filter.tenant_id = req.tenantId;
  }

  // Si el usuario autenticado es RESIDENTE, restringir solo a sus propios accesos y los de su apartamento
  if (req.user && req.user.rol === ROLES.RESIDENTE) {
    let residentId = req.user.resident_id || null;
    let residentApto = null;

    if (residentId) {
      const r = await Resident.findById(residentId).select('_id apartamento').lean();
      if (r) residentApto = r.apartamento;
    } else {
      const r = await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).select('_id apartamento').lean();
      if (r) {
        residentId = r._id;
        residentApto = r.apartamento;
      }
    }

    if (residentId && residentApto) {
      filter.$or = [
        { resident_id: residentId },
        { apartamento: residentApto.toUpperCase() },
      ];
    } else if (residentId) {
      filter.resident_id = residentId;
    } else if (residentApto) {
      filter.apartamento = residentApto.toUpperCase();
    }
  }

  if (req.query.tipo) filter.tipo = req.query.tipo;
  if (req.query.apartamento && (!req.user || req.user.rol !== ROLES.RESIDENTE)) {
    filter.apartamento = req.query.apartamento.toUpperCase().trim();
  }
  if (req.query.celador_id) filter.celador_id = req.query.celador_id;
  if (req.query.estado === 'dentro' || req.query.estado === 'abierto') {
    filter.horaSalida = null;
  } else if (req.query.estado === 'salida' || req.query.estado === 'completado') {
    filter.horaSalida = { $ne: null };
  }

  if (req.query.q || req.query.search) {
    const term = (req.query.q || req.query.search).trim();
    const regex = new RegExp(term, 'i');
    const searchCondition = {
      $or: [
        { nombre: regex },
        { cedula: regex },
        { apartamento: regex },
        { placa: regex },
        { empresa: regex },
      ]
    };
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, searchCondition];
      delete filter.$or;
    } else {
      filter.$or = searchCondition.$or;
    }
  }

  // Filtro de fecha robusto con cobertura de zona horaria
  if (req.query.fecha === 'hoy' || req.query.hoy === 'true') {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    filter.horaIngreso = { $gte: start, $lte: end };
  } else if (req.query.fecha) {
    const parts = req.query.fecha.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);

      const localStart = new Date(year, month, day, 0, 0, 0, 0);
      const localEnd = new Date(year, month, day, 23, 59, 59, 999);
      const utcStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - 12 * 3600 * 1000);
      const utcEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) + 12 * 3600 * 1000);

      filter.horaIngreso = {
        $gte: new Date(Math.min(localStart.getTime(), utcStart.getTime())),
        $lte: new Date(Math.max(localEnd.getTime(), utcEnd.getTime())),
      };
    } else {
      const d = new Date(req.query.fecha);
      filter.horaIngreso = {
        $gte: new Date(new Date(d).setHours(0, 0, 0, 0)),
        $lte: new Date(new Date(d).setHours(23, 59, 59, 999)),
      };
    }
  }

  const [visits, total] = await Promise.all([
    Visit.find(filter).sort({ horaIngreso: -1 }).skip(skip).limit(limit).lean(),
    Visit.countDocuments(filter),
  ]);

  return paginated(res, visits, total, page, limit);
});

// ─── OBTENER UNA VISITA ───────────────────────────────────────────────────────
const getOne = asyncHandler(async (req, res) => {
  const query = { _id: req.params.id, eliminado: false };
  if (req.tenantId) query.tenant_id = req.tenantId;

  const visit = await Visit.findOne(query);
  if (!visit) return error(res, 'Registro no encontrado', 404);

  // Si es residente, verificar que sea de su apartamento
  if (req.user && req.user.rol === ROLES.RESIDENTE) {
    const resident = req.user.resident_id
      ? await Resident.findById(req.user.resident_id).lean()
      : await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();
    if (resident && resident.apartamento !== visit.apartamento && String(resident._id) !== String(visit.resident_id)) {
      return error(res, 'Acceso denegado a este registro', 403);
    }
  }

  return ok(res, { visit });
});

// ─── CREAR VISITA / REGISTRAR ACCESO ─────────────────────────────────────────
const create = asyncHandler(async (req, res) => {
  const {
    tipo, nombre, cedula, empresa, placa,
    apartamento, horaIngreso, horaSalida, metodoIdentificacion,
    invitation_id, resident_id, localId, syncStatus,
    tipoVehiculo, marcaVehiculo, modeloVehiculo,
  } = req.body;

  if (!tipo || !apartamento) {
    return error(res, 'tipo y apartamento son requeridos', 400);
  }

  const aptoUpper = apartamento.toUpperCase().trim();
  const nomTrim = (nombre || '').trim();
  const cedTrim = (cedula || '').trim();
  let cleanPlaca = null;

  if (placa && String(placa).trim()) {
    const valPlaca = validarFormatoPlaca(tipoVehiculo, placa);
    if (!valPlaca.valida) {
      return error(res, valPlaca.mensaje, 400);
    }
    cleanPlaca = valPlaca.cleanPlaca;
  }

  // ── CICLO RESIDENTE: Entrada → Salida unificado ────────────────────────────
  if (tipo === VISIT_TYPES.RESIDENTE) {
    if (!cedTrim && !resident_id) {
      return error(res, 'La cédula del residente es requerida para el registro', 400);
    }

    // 1. Buscar el residente en BD para asegurar su ID y datos oficiales
    let resident = null;
    if (resident_id) {
      resident = await Resident.findOne({ _id: resident_id, tenant_id: req.tenantId });
    }
    if (!resident && cedTrim) {
      resident = await Resident.findOne({
        tenant_id: req.tenantId,
        cedula: { $regex: new RegExp(`^${cedTrim.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') },
      });
    }

    // Validación estricta: La cédula DEBE pertenecer a un residente registrado
    if (!resident) {
      return error(
        res,
        `No se puede registrar el acceso: La cédula ${cedTrim || ''} no pertenece a ningún residente registrado en este conjunto residencial.`,
        404
      );
    }

    if (resident.activo === false) {
      return error(
        res,
        `El residente ${resident.nombre} (C.C. ${resident.cedula}) se encuentra inactivo en el sistema.`,
        400
      );
    }

    const resId = resident._id;
    const residentNombre = resident.nombre;
    const residentCedula = resident.cedula || cedTrim;
    const residentApto = resident.apartamento || aptoUpper;

    // 2. Comprobar si ya tiene un acceso abierto (horaSalida == null)
    const openFilter = {
      tenant_id: req.tenantId,
      tipo: VISIT_TYPES.RESIDENTE,
      resident_id: resId,
      horaSalida: null,
      eliminado: false,
    };

    const openVisit = await Visit.findOne(openFilter).sort({ horaIngreso: -1 });

    // CASO A: Ya tiene acceso abierto → Registrar SALIDA en el mismo registro
    if (openVisit) {
      openVisit.horaSalida = horaSalida || new Date();
      openVisit.metodoSalida = metodoIdentificacion || ID_METHODS.MANUAL;
      openVisit.celador_salida_id = req.user.user_id;
      openVisit.celador_salida_nombre = req.user.nombre;
      if (cleanPlaca) {
        if (!openVisit.placa) openVisit.placa = cleanPlaca;
        else openVisit.placaSalida = cleanPlaca;
      }
      await openVisit.save();

      // Gestionar logs vehiculares:
      // SOLO si el residente sale EN VEHÍCULO (cleanPlaca existe), cerrar o crear log de ESE vehículo.
      // Si el residente sale A PIE (no cleanPlaca), los vehículos previamente ingresados permanecen DENTRO.
      if (cleanPlaca) {
        try {
          const VehicleAccessLog = require('../models/VehicleAccessLog');
          const Vehicle = require('../models/Vehicle');
          const placaRegex = new RegExp(`^${cleanPlaca.slice(0, 3)}\\s?${cleanPlaca.slice(3)}$`, 'i');

          const openVehLog = await VehicleAccessLog.findOne({
            tenant_id: req.tenantId,
            placa: { $regex: placaRegex },
            horaSalida: null,
          }).sort({ horaIngreso: -1 });

          if (openVehLog) {
            openVehLog.horaSalida = openVisit.horaSalida;
            openVehLog.celador_salida_id = req.user.user_id;
            openVehLog.celador_salida_nombre = req.user.nombre;
            await openVehLog.save();
          } else {
            // Si no tenía log abierto previo (ej. vehículo dentro sin registro anterior o externo), crear log cerrado
            const regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: { $regex: placaRegex } }).lean();
            await VehicleAccessLog.create({
              tenant_id: req.tenantId,
              vehicle_id: regVeh?._id || null,
              placa: cleanPlaca,
              tipoVehiculo: tipoVehiculo || regVeh?.tipo || 'Carro',
              esVehiculoRegistrado: !!regVeh,
              responsablePrincipal_id: regVeh?.responsablePrincipal || resId,
              apartamento: residentApto,
              conductor_nombre: residentNombre,
              conductor_tipo: 'residente',
              esAutorizado: true,
              horaIngreso: openVisit.horaIngreso,
              horaSalida: openVisit.horaSalida,
              celador_id: openVisit.celador_id || req.user.user_id,
              celador_nombre: openVisit.celador_nombre || req.user.nombre,
              celador_salida_id: req.user.user_id,
              celador_salida_nombre: req.user.nombre,
              registradoEnPorteria: true,
              visit_id: openVisit._id,
            });
          }
        } catch (errVeh) {
          console.warn('[VisitController] Error actualizando log vehicular en salida:', errVeh.message);
        }
      }

      return ok(res, {
        visit: openVisit,
        accion: 'salida',
        esSalida: true,
        resident: {
          _id: resident._id,
          nombre: resident.nombre,
          cedula: resident.cedula,
          apartamento: resident.apartamento,
        },
      }, 'Salida de residente registrada');
    }

    // CASO B: No tiene acceso abierto → Registrar ENTRADA (nuevo registro)
    if (localId) {
      const existing = await Visit.findOne({ localId, tenant_id: req.tenantId });
      if (existing) return ok(res, { visit: existing, accion: 'ingreso', esIngreso: true }, 'Ya sincronizado');
    }

    const visit = await Visit.create({
      tenant_id: req.tenantId,
      tipo: VISIT_TYPES.RESIDENTE,
      nombre: residentNombre,
      cedula: residentCedula,
      apartamento: residentApto,
      resident_id: resId,
      placa: cleanPlaca,
      tipoVehiculo: tipoVehiculo || (cleanPlaca ? 'Carro' : null),
      marcaVehiculo: marcaVehiculo?.trim() || null,
      modeloVehiculo: modeloVehiculo?.trim() || null,
      horaIngreso: horaIngreso || new Date(),
      horaSalida: null,
      celador_id: req.user.user_id,
      celador_nombre: req.user.nombre,
      metodoIdentificacion: metodoIdentificacion || ID_METHODS.MANUAL,
      localId: localId || null,
      syncStatus: SYNC_STATUS.SINCRONIZADO,
    });

    if (cleanPlaca) {
      try {
        const VehicleAccessLog = require('../models/VehicleAccessLog');
        const Vehicle = require('../models/Vehicle');
        const placaRegex = new RegExp(`^${cleanPlaca.slice(0, 3)}\\s?${cleanPlaca.slice(3)}$`, 'i');
        const regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: { $regex: placaRegex } }).lean();

        // Cerrar defensivamente cualquier log abierto previo de la misma placa para evitar duplicados
        await VehicleAccessLog.updateMany(
          { tenant_id: req.tenantId, placa: { $regex: placaRegex }, horaSalida: null },
          {
            horaSalida: visit.horaIngreso,
            celador_salida_id: req.user.user_id,
            celador_salida_nombre: req.user.nombre,
          }
        );

        await VehicleAccessLog.create({
          tenant_id: req.tenantId,
          vehicle_id: regVeh?._id || null,
          placa: cleanPlaca,
          tipoVehiculo: tipoVehiculo || regVeh?.tipo || 'Carro',
          esVehiculoRegistrado: !!regVeh,
          responsablePrincipal_id: regVeh?.responsablePrincipal || resId,
          apartamento: residentApto,
          conductor_nombre: residentNombre,
          conductor_tipo: 'residente',
          esAutorizado: true,
          horaIngreso: visit.horaIngreso,
          celador_id: req.user.user_id,
          celador_nombre: req.user.nombre,
          registradoEnPorteria: true,
          visit_id: visit._id,
        });
      } catch (_) { }
    }

    return created(res, {
      visit,
      accion: 'ingreso',
      esIngreso: true,
      resident: {
        _id: resident._id,
        nombre: resident.nombre,
        cedula: resident.cedula,
        apartamento: resident.apartamento,
      },
    }, 'Ingreso de residente registrado');
  }

  // ── DEMÁS TIPOS (visita, domicilio, vehiculo, tecnico) ──────────────────────
  // Deduplicar: si ya existe un registro con el mismo localId, retornar OK
  if (localId) {
    const existing = await Visit.findOne({ localId, tenant_id: req.tenantId });
    if (existing) return ok(res, { visit: existing }, 'Ya sincronizado');
  }

  // REGLA PARA VISITANTES: Cédula obligatoria y control de ciclo cerrado (no duplicar entrada si ya está dentro)
  if (tipo === 'visita' || tipo === VISIT_TYPES.VISITA) {
    if (!cedTrim) {
      return error(res, 'La cédula del visitante es obligatoria', 400);
    }
    if (!nomTrim) {
      return error(res, 'El nombre del visitante es obligatorio', 400);
    }

    const openVisitor = await Visit.findOne({
      tenant_id: req.tenantId,
      tipo: { $in: ['visita', VISIT_TYPES.VISITA] },
      cedula: { $regex: new RegExp(`^${cedTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      horaSalida: null,
      eliminado: false,
    });

    if (openVisitor) {
      return error(
        res,
        `El visitante ${openVisitor.nombre || nomTrim} (C.C. ${cedTrim}) ya se encuentra dentro de las instalaciones para el Apto ${openVisitor.apartamento} (Hora de ingreso: ${new Date(openVisitor.horaIngreso).toLocaleTimeString('es-CO')}). Debe registrar su salida antes de un nuevo ingreso.`,
        409
      );
    }
  }

  const isDomicilio = tipo === 'domicilio' || tipo === VISIT_TYPES.DOMICILIO;

  const visit = await Visit.create({
    tenant_id: req.tenantId,
    tipo,
    nombre: nomTrim,
    cedula: cedTrim,
    empresa,
    placa: cleanPlaca,
    tipoVehiculo: tipoVehiculo || (cleanPlaca ? 'Carro' : null),
    marcaVehiculo: marcaVehiculo?.trim() || null,
    modeloVehiculo: modeloVehiculo?.trim() || null,
    apartamento: aptoUpper,
    horaIngreso: horaIngreso || new Date(),
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    metodoIdentificacion: metodoIdentificacion || 'manual',
    invitation_id: invitation_id || null,
    localId: localId || null,
    syncStatus: SYNC_STATUS.SINCRONIZADO,
    estadoDomicilio: isDomicilio ? 'pendiente' : null,
    fechaLlegada: isDomicilio ? (horaIngreso || new Date()) : null,
    fechaNotificacion: isDomicilio ? new Date() : null,
  });

  // Si ingresó con vehículo, crear log de acceso vehicular
  if (cleanPlaca) {
    try {
      const VehicleAccessLog = require('../models/VehicleAccessLog');
      const Vehicle = require('../models/Vehicle');
      const placaRegex = new RegExp(`^${cleanPlaca.slice(0, 3)}\\s?${cleanPlaca.slice(3)}$`, 'i');
      const regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: { $regex: placaRegex } }).lean();

      // Cerrar logs abiertos previos defensivamente
      await VehicleAccessLog.updateMany(
        { tenant_id: req.tenantId, placa: { $regex: placaRegex }, horaSalida: null },
        {
          horaSalida: visit.horaIngreso,
          celador_salida_id: req.user.user_id,
          celador_salida_nombre: req.user.nombre,
        }
      );

      await VehicleAccessLog.create({
        tenant_id: req.tenantId,
        vehicle_id: regVeh?._id || null,
        placa: cleanPlaca,
        tipoVehiculo: tipoVehiculo || regVeh?.tipo || 'Carro',
        esVehiculoRegistrado: !!regVeh,
        responsablePrincipal_id: regVeh?.responsablePrincipal || null,
        apartamento: aptoUpper || regVeh?.apartamento || null,
        conductor_nombre: nomTrim || (isDomicilio ? empresa : 'Visitante'),
        conductor_tipo: isDomicilio ? 'tercero' : 'visitante',
        esAutorizado: true,
        horaIngreso: visit.horaIngreso,
        celador_id: req.user.user_id,
        celador_nombre: req.user.nombre,
        registradoEnPorteria: true,
        visit_id: visit._id,
        permission_id: req.body.permission_id || null,
      });
    } catch (errVeh) {
      console.warn('[VisitController] Error creando VehicleAccessLog para visitante:', errVeh.message);
    }
  }

  // Crear notificación interna para el residente del apartamento
  await _crearNotificacion(visit, req.tenantId);

  return created(res, { visit, accion: 'ingreso' }, 'Registro creado');
});

// ─── SINCRONIZACIÓN BATCH (múltiples registros desde Dexie.js) ───────────────
const syncBatch = asyncHandler(async (req, res) => {
  const { registros } = req.body;

  if (!Array.isArray(registros) || registros.length === 0) {
    return error(res, 'Se requiere el array "registros"', 400);
  }

  const results = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const reg of registros) {
    try {
      if (reg.localId) {
        const existing = await Visit.findOne({ localId: reg.localId, tenant_id: req.tenantId });
        if (existing) {
          if (reg.horaSalida && !existing.horaSalida) {
            existing.horaSalida = reg.horaSalida;
            existing.metodoSalida = reg.metodoSalida || 'manual';
            existing.celador_salida_id = reg.celador_salida_id || req.user.user_id;
            existing.celador_salida_nombre = reg.celador_salida_nombre || req.user.nombre;
            await existing.save();
            results.updated++;
          } else {
            results.skipped++;
          }
          continue;
        }
      }

      if (reg.tipo === VISIT_TYPES.RESIDENTE || reg.tipo === 'residente') {
        let resident = null;
        if (reg.resident_id) {
          resident = await Resident.findOne({ _id: reg.resident_id, tenant_id: req.tenantId });
        }
        if (!resident && reg.cedula) {
          resident = await Resident.findOne({
            tenant_id: req.tenantId,
            cedula: { $regex: new RegExp(`^${String(reg.cedula).trim().replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i') },
          });
        }
        if (!resident) {
          results.errors.push({
            localId: reg.localId,
            error: `Cédula ${reg.cedula || 'desconocida'} no pertenece a ningún residente registrado en este conjunto. Registro omitido.`
          });
          continue;
        }
        reg.resident_id = resident._id;
        reg.nombre = resident.nombre;
        reg.cedula = resident.cedula || reg.cedula;
        reg.apartamento = resident.apartamento;
      }

      const createdVisit = await Visit.create({
        tenant_id: req.tenantId,
        tipo: reg.tipo,
        nombre: reg.nombre,
        cedula: reg.cedula,
        resident_id: reg.resident_id || null,
        empresa: reg.empresa,
        placa: reg.placa,
        tipoVehiculo: reg.tipoVehiculo || null,
        marcaVehiculo: reg.marcaVehiculo || null,
        modeloVehiculo: reg.modeloVehiculo || null,
        apartamento: (reg.apartamento || '').toUpperCase(),
        horaIngreso: reg.horaIngreso || new Date(),
        horaSalida: reg.horaSalida || null,
        metodoSalida: reg.metodoSalida || null,
        celador_id: reg.celador_id || req.user.user_id,
        celador_nombre: reg.celador_nombre || req.user.nombre,
        celador_salida_id: reg.celador_salida_id || null,
        celador_salida_nombre: reg.celador_salida_nombre || null,
        metodoIdentificacion: reg.metodoIdentificacion || 'manual',
        localId: reg.localId || null,
        syncStatus: SYNC_STATUS.SINCRONIZADO,
      });

      await _crearNotificacion(createdVisit, req.tenantId);

      results.created++;
    } catch (e) {
      results.errors.push({ localId: reg.localId, error: e.message });
    }
  }

  return ok(res, results, `Sincronización completada: ${results.created} creados, ${results.updated} actualizados, ${results.skipped} omitidos`);
});

// ─── REGISTRAR SALIDA ─────────────────────────────────────────────────────────
const registerExit = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  if (visit.horaSalida) return error(res, 'Este registro ya tiene hora de salida', 400);

  const { horaSalida, metodoSalida, modoSalida, placaSalida, tipoVehiculoSalida } = req.body;
  const exitTime = horaSalida || new Date();
  let cleanPlacaSalida = null;

  if (modoSalida === 'vehiculo' && placaSalida && String(placaSalida).trim()) {
    const valPlaca = validarFormatoPlaca(tipoVehiculoSalida, placaSalida);
    if (!valPlaca.valida) {
      return error(res, valPlaca.mensaje, 400);
    }
    cleanPlacaSalida = valPlaca.cleanPlaca;
  }

  visit.horaSalida = exitTime;
  visit.metodoSalida = metodoSalida || ID_METHODS.MANUAL;
  visit.celador_salida_id = req.user.user_id;
  visit.celador_salida_nombre = req.user.nombre;

  if (cleanPlacaSalida) {
    visit.placaSalida = cleanPlacaSalida;
  }

  await visit.save();

  // Gestión de salida vehicular:
  // SOLO si la salida es en vehículo y tiene placa, cerrar o registrar el log de ESE vehículo.
  // Si sale a pie, los vehículos que ingresaron previamente permanecen DENTRO.
  if (cleanPlacaSalida) {
    try {
      const VehicleAccessLog = require('../models/VehicleAccessLog');
      const Vehicle = require('../models/Vehicle');
      const placaRegex = new RegExp(`^${cleanPlacaSalida.slice(0, 3)}\\s?${cleanPlacaSalida.slice(3)}$`, 'i');

      const openVehLog = await VehicleAccessLog.findOne({
        tenant_id: req.tenantId,
        placa: { $regex: placaRegex },
        horaSalida: null,
      }).sort({ horaIngreso: -1 });

      if (openVehLog) {
        openVehLog.horaSalida = exitTime;
        openVehLog.celador_salida_id = req.user.user_id;
        openVehLog.celador_salida_nombre = req.user.nombre;
        if (req.body.permission_id) openVehLog.permission_id = req.body.permission_id;
        await openVehLog.save();
      } else {
        const regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: { $regex: placaRegex } }).lean();
        await VehicleAccessLog.create({
          tenant_id: req.tenantId,
          vehicle_id: regVeh?._id || null,
          placa: cleanPlacaSalida,
          tipoVehiculo: tipoVehiculoSalida || regVeh?.tipo || 'Carro',
          esVehiculoRegistrado: !!regVeh,
          responsablePrincipal_id: regVeh?.responsablePrincipal || visit.resident_id || null,
          apartamento: visit.apartamento || regVeh?.apartamento || null,
          conductor_nombre: visit.nombre || (visit.empresa || 'Visitante'),
          conductor_tipo: visit.tipo === 'residente' ? 'residente' : 'visitante',
          esAutorizado: true,
          permission_id: req.body.permission_id || null,
          horaIngreso: visit.horaIngreso,
          horaSalida: exitTime,
          celador_id: visit.celador_id || req.user.user_id,
          celador_nombre: visit.celador_nombre || req.user.nombre,
          celador_salida_id: req.user.user_id,
          celador_salida_nombre: req.user.nombre,
          registradoEnPorteria: true,
          visit_id: visit._id,
        });
      }
    } catch (err) {
      console.warn('[VisitController] Error actualizando VehicleAccessLog en salida:', err.message);
    }
  }

  return ok(res, { visit, accion: 'salida' }, 'Salida registrada');
});

// ─── EDITAR VISITA (solo turno activo — auditLog obligatorio) ─────────────────
const update = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  if (visit.eliminado) return error(res, 'No se puede editar un registro eliminado', 400);

  const camposEditables = ['nombre', 'cedula', 'empresa', 'placa', 'apartamento', 'horaIngreso', 'horaSalida'];
  const camposAnteriores = {};
  const camposNuevos = {};

  for (const campo of camposEditables) {
    if (req.body[campo] !== undefined && req.body[campo] !== visit[campo]) {
      camposAnteriores[campo] = visit[campo];
      camposNuevos[campo] = req.body[campo];
      visit[campo] = campo === 'apartamento' ? req.body[campo].toUpperCase() : req.body[campo];
    }
  }

  if (Object.keys(camposNuevos).length === 0) {
    return ok(res, { visit }, 'Sin cambios');
  }

  // Registrar en auditLog
  visit.auditLog.push({
    timestamp: new Date(),
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    accion: 'edicion',
    camposAnteriores,
    camposNuevos,
  });

  await visit.save();
  return ok(res, { visit }, 'Registro actualizado');
});

// ─── ELIMINAR VISITA (soft delete + auditLog) ─────────────────────────────────
const remove = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro no encontrado', 404);
  if (visit.eliminado) return error(res, 'El registro ya fue eliminado', 400);

  visit.eliminado = true;
  visit.auditLog.push({
    timestamp: new Date(),
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    accion: 'eliminacion',
    camposAnteriores: visit.toObject(),
    camposNuevos: null,
  });

  await visit.save();
  return ok(res, {}, 'Registro eliminado (soft delete)');
});

// ─── ANALYTICS DEL CONJUNTO ───────────────────────────────────────────────────
const analytics = asyncHandler(async (req, res) => {
  const hoy = new Date();
  const inicio = new Date(hoy.setHours(0, 0, 0, 0));
  const fin = new Date(hoy.setHours(23, 59, 59, 999));

  const [porTipo, porFranja] = await Promise.all([
    // Distribución por tipo hoy
    Visit.aggregate([
      { $match: { tenant_id: req.tenantId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: '$tipo', count: { $sum: 1 } } },
    ]),
    // Picos por franja de 2 horas
    Visit.aggregate([
      { $match: { tenant_id: req.tenantId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      {
        $group: {
          _id: { $floor: { $divide: [{ $hour: '$horaIngreso' }, 2] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  return ok(res, { porTipo, porFranja });
});

// ─── HELPER PRIVADO: CREAR NOTIFICACIÓN ───────────────────────────────────────
async function _crearNotificacion(visit, tenantId) {
  try {
    const aptoClean = (visit.apartamento || '').trim();
    if (!aptoClean) return;

    // Buscar residentes del apartamento para encontrar sus user_id
    const residents = await Resident.find({
      tenant_id: tenantId,
      apartamento: { $regex: new RegExp(`^${aptoClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      activo: { $ne: false },
    }).lean();

    const tipo = visit.tipo;
    const isDom = tipo === 'domicilio' || tipo === VISIT_TYPES.DOMICILIO;

    const titulo = isDom
      ? `Domicilio — Apto ${visit.apartamento}`
      : tipo === 'vehiculo'
        ? `Vehículo ${visit.placa} — Apto ${visit.apartamento}`
        : `Visita de ${visit.nombre || 'persona'} — Apto ${visit.apartamento}`;

    const mensaje = isDom
      ? `Ha ingresado un domicilio de ${visit.empresa || 'empresa'}${visit.nombre ? ' (' + visit.nombre + ')' : ''} a las ${new Date(visit.horaIngreso).toLocaleTimeString('es-CO')}.`
      : `Ingreso registrado a las ${new Date(visit.horaIngreso).toLocaleTimeString('es-CO')}`;

    let createdAny = false;
    if (residents && residents.length > 0) {
      for (const res of residents) {
        if (res.user_id) {
          await Notification.create({
            tenant_id: tenantId,
            user_id: res.user_id,
            apartamento: visit.apartamento,
            tipo,
            titulo,
            mensaje,
            visit_id: visit._id,
            estadoDomicilio: isDom ? 'ingresado' : null,
            requiereRespuesta: false,
          });
          createdAny = true;
        }
      }
    }

    // Si no había user_id asignado directamente, crear una notificación ligada al apartamento
    if (!createdAny) {
      await Notification.create({
        tenant_id: tenantId,
        user_id: null,
        apartamento: visit.apartamento,
        tipo,
        titulo,
        mensaje,
        visit_id: visit._id,
        estadoDomicilio: isDom ? 'ingresado' : null,
        requiereRespuesta: false,
      });
    }
  } catch (err) {
    console.warn('Error al crear notificacion:', err.message);
  }
}

// ─── CONFIRMAR RECEPCIÓN DE DOMICILIO (RESIDENTE O STAFF) ─────────────────────
const recibirDomicilio = asyncHandler(async (req, res) => {
  const visit = await Visit.findOne({ _id: req.params.id, tenant_id: req.tenantId });
  if (!visit) return error(res, 'Registro de domicilio no encontrado', 404);

  if (visit.tipo !== VISIT_TYPES.DOMICILIO && visit.tipo !== 'domicilio') {
    return error(res, 'El registro no corresponde a un domicilio', 400);
  }

  let residentId = null;
  let residentNombre = req.user.nombre || 'Residente';

  if (req.user.rol === ROLES.RESIDENTE) {
    const resident = req.user.resident_id
      ? await Resident.findById(req.user.resident_id).lean()
      : await Resident.findOne({ user_id: req.user.user_id, tenant_id: req.tenantId }).lean();
    if (resident) {
      residentId = resident._id;
      residentNombre = resident.nombre;
    }
  }

  const now = new Date();
  visit.estadoDomicilio = 'recibido';
  visit.fechaRecepcion = now;
  // NOTA: La hora de salida NO se establece aquí; el celador es quien confirma la salida física.
  visit.recibidoPor = residentId || req.user.user_id;
  visit.recibidoPorNombre = residentNombre;
  await visit.save();

  // Actualizar notificaciones asociadas
  await Notification.updateMany(
    { tenant_id: req.tenantId, visit_id: visit._id },
    {
      $set: {
        estadoDomicilio: 'recibido',
        fechaRecepcion: now,
        requiereRespuesta: false,
        leida: true,
      }
    }
  );

  return ok(res, { visit }, 'Domicilio marcado como recibido exitosamente');
});

// ─── VERIFICAR CÓDIGO DE INVITACIÓN ──────────────────────────────────────────
const verificarCodigo = asyncHandler(async (req, res) => {
  const { codigo } = req.body;
  const Invitation = require('../models/Invitation');
  const inv = await Invitation.findOne({ codigo, tenant_id: req.tenantId, estado: { $in: ['pendiente', 'activa'] } });

  if (!inv) return error(res, 'Código inválido o ya utilizado', 404);

  if (inv.tiempo_caducidad && new Date(inv.tiempo_caducidad) < new Date()) {
    inv.estado = 'cancelado';
    await inv.save();
    return error(res, 'El código de invitación ha expirado', 400);
  }

  // Verificar si ya tiene un ingreso abierto sin registrar salida
  if (inv.cedulaVisitante) {
    const cedTrim = String(inv.cedulaVisitante).trim();
    const openVisitor = await Visit.findOne({
      tenant_id: req.tenantId,
      tipo: { $in: ['visita', VISIT_TYPES.VISITA] },
      cedula: { $regex: new RegExp(`^${cedTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      horaSalida: null,
      eliminado: false,
    });
    if (openVisitor) {
      return error(
        res,
        `El visitante ${inv.nombreVisitante} (C.C. ${cedTrim}) ya se encuentra dentro de las instalaciones para el Apto ${openVisitor.apartamento} (Hora de ingreso: ${new Date(openVisitor.horaIngreso).toLocaleTimeString('es-CO')}). Debe registrar su salida antes de un nuevo ingreso.`,
        409
      );
    }
  }

  return ok(res, { invitation: inv }, 'Código verificado exitosamente');
});

// ─── REGISTRAR INGRESO CON CÓDIGO ────────────────────────────────────────────
const registrarIngreso = asyncHandler(async (req, res) => {
  const { codigo, modo, placa, tipoVehiculo, marcaVehiculo, modeloVehiculo } = req.body;
  const Invitation = require('../models/Invitation');

  const inv = await Invitation.findOne({ codigo, tenant_id: req.tenantId, estado: { $in: ['pendiente', 'activa'] } });
  if (!inv) return error(res, 'Código inválido o ya utilizado', 404);

  if (inv.tiempo_caducidad && new Date(inv.tiempo_caducidad) < new Date()) {
    inv.estado = 'cancelado';
    await inv.save();
    return error(res, 'El código de invitación ha expirado', 400);
  }

  // Verificar si ya tiene un ingreso abierto sin registrar salida
  if (inv.cedulaVisitante) {
    const cedTrim = String(inv.cedulaVisitante).trim();
    const openVisitor = await Visit.findOne({
      tenant_id: req.tenantId,
      tipo: { $in: ['visita', VISIT_TYPES.VISITA] },
      cedula: { $regex: new RegExp(`^${cedTrim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      horaSalida: null,
      eliminado: false,
    });
    if (openVisitor) {
      return error(
        res,
        `El visitante ${inv.nombreVisitante} (C.C. ${cedTrim}) ya se encuentra dentro de las instalaciones para el Apto ${openVisitor.apartamento}. Debe registrar su salida primero.`,
        409
      );
    }
  }

  let cleanPlaca = null;
  if (modo === 'vehiculo' || (placa && String(placa).trim())) {
    if (!placa || !String(placa).trim()) {
      return error(res, 'La placa es requerida para el ingreso en vehículo', 400);
    }
    const valPlaca = validarFormatoPlaca(tipoVehiculo, placa);
    if (!valPlaca.valida) {
      return error(res, valPlaca.mensaje, 400);
    }
    cleanPlaca = valPlaca.cleanPlaca;
  }

  // Registrar la visita real
  const visit = await Visit.create({
    tenant_id: req.tenantId,
    tipo: 'visita',
    nombre: inv.nombreVisitante,
    cedula: inv.cedulaVisitante,
    apartamento: inv.apartamento,
    placa: cleanPlaca,
    tipoVehiculo: tipoVehiculo || (cleanPlaca ? 'Carro' : null),
    marcaVehiculo: marcaVehiculo?.trim() || null,
    modeloVehiculo: modeloVehiculo?.trim() || null,
    horaIngreso: new Date(),
    celador_id: req.user.user_id,
    celador_nombre: req.user.nombre,
    metodoIdentificacion: 'codigo_invitacion',
    invitation_id: inv._id,
    syncStatus: SYNC_STATUS.SINCRONIZADO,
  });

  // Si ingresa en vehículo, crear log de acceso vehicular
  if (cleanPlaca) {
    try {
      const VehicleAccessLog = require('../models/VehicleAccessLog');
      const Vehicle = require('../models/Vehicle');
      const regVeh = await Vehicle.findOne({ tenant_id: req.tenantId, placa: cleanPlaca }).lean();

      await VehicleAccessLog.create({
        tenant_id: req.tenantId,
        vehicle_id: regVeh?._id || null,
        placa: cleanPlaca,
        tipoVehiculo: tipoVehiculo || regVeh?.tipo || 'Carro',
        esVehiculoRegistrado: !!regVeh,
        responsablePrincipal_id: regVeh?.responsablePrincipal || null,
        apartamento: inv.apartamento || regVeh?.apartamento || null,
        conductor_nombre: inv.nombreVisitante,
        conductor_tipo: 'visitante',
        esAutorizado: true,
        horaIngreso: visit.horaIngreso,
        celador_id: req.user.user_id,
        celador_nombre: req.user.nombre,
        registradoEnPorteria: true,
        visit_id: visit._id,
      });
    } catch (errVeh) {
      console.warn('[VisitController] Error creando VehicleAccessLog con código:', errVeh.message);
    }
  }

  // Marcar invitación como completada
  inv.estado = 'completado';
  inv.visit_id = visit._id;
  inv.fechaResolucion = new Date();
  await inv.save();

  // Notificar al residente que su visita ingresó
  await _crearNotificacion(visit, req.tenantId);

  return created(res, { visit, invitation: inv }, 'Ingreso registrado exitosamente');
});

// ─── OBTENER INVITACIONES PENDIENTES DEL CONJUNTO ────────────────────────────
const getPendientes = asyncHandler(async (req, res) => {
  const Invitation = require('../models/Invitation');
  const now = new Date();
  const pendientes = await Invitation.find({
    tenant_id: req.tenantId,
    estado: { $in: ['pendiente', 'activa'] },
    $or: [
      { tiempo_caducidad: { $gte: now } },
      { tiempo_caducidad: null },
      { tiempo_caducidad: { $exists: false } },
    ]
  }).sort({ createdAt: -1 }).lean();

  return ok(res, { invitaciones: pendientes });
});

// ─── OBTENER VISITANTES Y DOMICILIOS ACTIVOS DENTRO DEL CONJUNTO ───────────
const getActiveVisitors = asyncHandler(async (req, res) => {
  const visitors = await Visit.find({
    tenant_id: req.tenantId,
    tipo: { $in: ['visita', 'domicilio', VISIT_TYPES.VISITA, VISIT_TYPES.DOMICILIO] },
    horaSalida: null,
    eliminado: false,
  }).sort({ horaIngreso: -1 }).limit(100).lean();

  return ok(res, { visitantes: visitors });
});

// ─── OBTENER RESIDENTES ACTIVOS DENTRO DEL CONJUNTO ─────────────────────────
const getActiveResidents = asyncHandler(async (req, res) => {
  const residentsInside = await Visit.find({
    tenant_id: req.tenantId,
    tipo: { $in: ['residente', VISIT_TYPES.RESIDENTE] },
    horaSalida: null,
    eliminado: false,
  }).sort({ horaIngreso: -1 }).limit(200).lean();

  return ok(res, { residentes: residentsInside });
});

module.exports = {
  list,
  getOne,
  create,
  syncBatch,
  registerExit,
  update,
  remove,
  analytics,
  verificarCodigo,
  registrarIngreso,
  getPendientes,
  getActiveVisitors,
  getActiveResidents,
  recibirDomicilio,
};
