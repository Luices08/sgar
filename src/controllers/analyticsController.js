'use strict';

const mongoose     = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { ok, error } = require('../utils/response');
const { ROLES }     = require('../config/constants');
const Visit         = require('../models/Visit');
const VehicleAccessLog = require('../models/VehicleAccessLog');
const Tenant        = require('../models/Tenant');
const Resident      = require('../models/Resident');
const Vehicle       = require('../models/Vehicle');

// Helper para parsear año, mes y día de forma robusta sin desfasar zona horaria
function parseDateParts(fechaStr) {
  if (!fechaStr) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  }
  const parts = String(fechaStr).split('T')[0].split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return { year: y, month: m, day: d };
    }
  }
  const fallback = new Date(fechaStr);
  return { year: fallback.getFullYear(), month: fallback.getMonth(), day: fallback.getDate() };
}

// Helper para calcular rango de fechas [inicio, fin] según periodo
function getRangoFechas(periodo = 'dia', fechaRefStr) {
  const { year, month, day } = parseDateParts(fechaRefStr);
  let inicio, fin;

  if (periodo === 'dia') {
    inicio = new Date(year, month, day, 0, 0, 0, 0);
    fin    = new Date(year, month, day, 23, 59, 59, 999);
  } else if (periodo === 'semana') {
    fin    = new Date(year, month, day, 23, 59, 59, 999);
    inicio = new Date(year, month, day, 0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - 6);
  } else if (periodo === 'mes') {
    fin    = new Date(year, month, day, 23, 59, 59, 999);
    inicio = new Date(year, month, day, 0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - 29);
  } else {
    inicio = new Date(year, month, day, 0, 0, 0, 0);
    fin    = new Date(year, month, day, 23, 59, 59, 999);
  }

  return { inicio, fin };
}

const TIMEZONE_BOGOTA = 'America/Bogota';

// ─── ANALÍTICAS DE CONJUNTO (AdminConjunto & Drilldown de SuperAdmin) ─────────
const getConjuntoAnalytics = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return error(res, 'No se ha especificado un conjunto residencial', 400);
  }

  const periodo  = req.query.periodo || 'dia';
  const fechaRef = req.query.fecha || null;
  const { inicio, fin } = getRangoFechas(periodo, fechaRef);

  const tId = new mongoose.Types.ObjectId(tenantId);

  // 1. ACCESOS PEATONALES / GENERALES (Visitas, Residentes, Domicilios, Técnicos)
  const [
    entradasTotales,
    salidasTotales,
    personasDentro,
    entradasPorHoraAgg,
    salidasPorHoraAgg,
    entradasPorDiaAgg,
    salidasPorDiaAgg,
    porTipoAgg,
  ] = await Promise.all([
    // Conteo total de entradas en el rango
    Visit.countDocuments({
      tenant_id: tId,
      horaIngreso: { $gte: inicio, $lte: fin },
      eliminado: false,
    }),
    // Conteo total de salidas en el rango
    Visit.countDocuments({
      tenant_id: tId,
      horaSalida: { $gte: inicio, $lte: fin },
      eliminado: false,
    }),
    // Personas actualmente dentro
    Visit.countDocuments({
      tenant_id: tId,
      horaSalida: null,
      eliminado: false,
    }),
    // Distribución horaria de entradas (0..23) en zona horaria local
    Visit.aggregate([
      { $match: { tenant_id: tId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: { $hour: { date: '$horaIngreso', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Distribución horaria de salidas (0..23) en zona horaria local
    Visit.aggregate([
      { $match: { tenant_id: tId, horaSalida: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: { $hour: { date: '$horaSalida', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Distribución por días de entradas (para semana o mes)
    Visit.aggregate([
      { $match: { tenant_id: tId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$horaIngreso', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Distribución por días de salidas (para semana o mes)
    Visit.aggregate([
      { $match: { tenant_id: tId, horaSalida: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$horaSalida', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Distribución por tipo de acceso
    Visit.aggregate([
      { $match: { tenant_id: tId, horaIngreso: { $gte: inicio, $lte: fin }, eliminado: false } },
      { $group: { _id: '$tipo', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  // Estructurar array de 24 horas para visualización continua
  const horasAccesos = [];
  const entradasMap = new Map(entradasPorHoraAgg.map(x => [x._id, x.count]));
  const salidasMap  = new Map(salidasPorHoraAgg.map(x => [x._id, x.count]));

  for (let h = 0; h < 24; h++) {
    horasAccesos.push({
      hora: h,
      label: `${String(h).padStart(2, '0')}:00`,
      entradas: entradasMap.get(h) || 0,
      salidas: salidasMap.get(h) || 0,
    });
  }

  // Estructurar días para semana / mes
  const diasAccesos = [];
  if (periodo === 'semana' || periodo === 'mes') {
    const dEntradasMap = new Map(entradasPorDiaAgg.map(x => [x._id, x.count]));
    const dSalidasMap  = new Map(salidasPorDiaAgg.map(x => [x._id, x.count]));
    const numDias = periodo === 'semana' ? 7 : 30;

    for (let i = 0; i < numDias; i++) {
      const d = new Date(inicio.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
      const diaNom = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
      diasAccesos.push({
        fecha: dateStr,
        label: diaNom,
        entradas: dEntradasMap.get(dateStr) || 0,
        salidas: dSalidasMap.get(dateStr) || 0,
      });
    }
  }

  // 2. ACCESOS VEHICULARES (VehicleAccessLog)
  const [
    ingresosVehiculosTotales,
    salidasVehiculosTotales,
    vehiculosDentro,
    vehiculosPorHoraAgg,
    vehiculosSalidasPorHoraAgg,
    vehiculosPorDiaAgg,
    topVehiculosAgg,
  ] = await Promise.all([
    VehicleAccessLog.countDocuments({
      tenant_id: tId,
      horaIngreso: { $gte: inicio, $lte: fin },
    }),
    VehicleAccessLog.countDocuments({
      tenant_id: tId,
      horaSalida: { $gte: inicio, $lte: fin },
    }),
    VehicleAccessLog.countDocuments({
      tenant_id: tId,
      horaSalida: null,
    }),
    VehicleAccessLog.aggregate([
      { $match: { tenant_id: tId, horaIngreso: { $gte: inicio, $lte: fin } } },
      { $group: { _id: { $hour: { date: '$horaIngreso', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    VehicleAccessLog.aggregate([
      { $match: { tenant_id: tId, horaSalida: { $gte: inicio, $lte: fin } } },
      { $group: { _id: { $hour: { date: '$horaSalida', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    VehicleAccessLog.aggregate([
      { $match: { tenant_id: tId, horaIngreso: { $gte: inicio, $lte: fin } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$horaIngreso', timezone: TIMEZONE_BOGOTA } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    // Agrupación por placa con mayor movimiento (Ingresos + Salidas)
    VehicleAccessLog.aggregate([
      {
        $match: {
          tenant_id: tId,
          $or: [
            { horaIngreso: { $gte: inicio, $lte: fin } },
            { horaSalida: { $gte: inicio, $lte: fin } },
          ],
        },
      },
      {
        $group: {
          _id: '$placa',
          tipoVehiculo: { $first: '$tipoVehiculo' },
          apartamento: { $first: '$apartamento' },
          responsablePrincipal: { $first: '$responsablePrincipal_nombre' },
          ingresos: {
            $sum: {
              $cond: [{ $and: [{ $gte: ['$horaIngreso', inicio] }, { $lte: ['$horaIngreso', fin] }] }, 1, 0],
            },
          },
          salidas: {
            $sum: {
              $cond: [{ $and: [{ $ne: ['$horaSalida', null] }, { $gte: ['$horaSalida', inicio] }, { $lte: ['$horaSalida', fin] }] }, 1, 0],
            },
          },
          alertasNoAutorizado: {
            $sum: { $cond: ['$alertaNoAutorizado', 1, 0] },
          },
        },
      },
      {
        $project: {
          placa: '$_id',
          tipoVehiculo: 1,
          apartamento: 1,
          responsablePrincipal: 1,
          ingresos: 1,
          salidas: 1,
          totalMovimientos: { $add: ['$ingresos', '$salidas'] },
          alertasNoAutorizado: 1,
        },
      },
      { $sort: { totalMovimientos: -1 } },
      { $limit: 20 },
    ]),
  ]);

  // Estructurar horas de vehículos
  const horasVehiculos = [];
  const vIngresosMap = new Map(vehiculosPorHoraAgg.map(x => [x._id, x.count]));
  const vSalidasMap  = new Map(vehiculosSalidasPorHoraAgg.map(x => [x._id, x.count]));

  for (let h = 0; h < 24; h++) {
    horasVehiculos.push({
      hora: h,
      label: `${String(h).padStart(2, '0')}:00`,
      ingresos: vIngresosMap.get(h) || 0,
      salidas: vSalidasMap.get(h) || 0,
    });
  }

  // Estructurar días de vehículos para semana / mes
  const diasVehiculos = [];
  if (periodo === 'semana' || periodo === 'mes') {
    const dVIngresosMap = new Map(vehiculosPorDiaAgg.map(x => [x._id, x.count]));
    const numDias = periodo === 'semana' ? 7 : 30;

    for (let i = 0; i < numDias; i++) {
      const d = new Date(inicio.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const diaNom = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
      diasVehiculos.push({
        fecha: dateStr,
        label: diaNom,
        ingresos: dVIngresosMap.get(dateStr) || 0,
      });
    }
  }

  // Información del conjunto
  const tenantInfo = await Tenant.findById(tId).select('nombre tenant_id ciudad colorAcento estado activo').lean();

  return ok(res, {
    tenant: tenantInfo,
    periodo,
    rango: {
      inicio,
      fin,
      inicioStr: inicio.toISOString(),
      finStr: fin.toISOString(),
    },
    accesos: {
      totalEntradas: entradasTotales,
      totalSalidas: salidasTotales,
      totalMovimientos: entradasTotales + salidasTotales,
      personasDentro,
      porHora: horasAccesos,
      porDia: diasAccesos,
      porTipo: porTipoAgg.map(t => ({ tipo: t._id, count: t.count })),
    },
    vehiculos: {
      totalIngresos: ingresosVehiculosTotales,
      totalSalidas: salidasVehiculosTotales,
      totalMovimientos: ingresosVehiculosTotales + salidasVehiculosTotales,
      vehiculosDentro,
      porHora: horasVehiculos,
      porDia: diasVehiculos,
      topVehiculos: topVehiculosAgg,
    },
  });
});

// ─── ANALÍTICAS GLOBALES (SuperAdmin) ─────────────────────────────────────────
const getGlobalAnalytics = asyncHandler(async (req, res) => {
  const periodo  = req.query.periodo || 'dia';
  const fechaRef = req.query.fecha || null;
  const { inicio, fin } = getRangoFechas(periodo, fechaRef);

  const tenants = await Tenant.find({ eliminado: false })
    .select('nombre tenant_id nit ciudad colorAcento estado activo')
    .sort({ nombre: 1 })
    .lean();

  let granTotalEntradas = 0;
  let granTotalSalidas  = 0;
  let granTotalIngresosVehiculos = 0;
  let granTotalSalidasVehiculos  = 0;

  const conjuntoStats = await Promise.all(
    tenants.map(async (t) => {
      const [
        entradas,
        salidas,
        ingresosVeh,
        salidasVeh,
        totalResidentes,
        totalVehiculos,
      ] = await Promise.all([
        Visit.countDocuments({
          tenant_id: t._id,
          horaIngreso: { $gte: inicio, $lte: fin },
          eliminado: false,
        }),
        Visit.countDocuments({
          tenant_id: t._id,
          horaSalida: { $gte: inicio, $lte: fin },
          eliminado: false,
        }),
        VehicleAccessLog.countDocuments({
          tenant_id: t._id,
          horaIngreso: { $gte: inicio, $lte: fin },
        }),
        VehicleAccessLog.countDocuments({
          tenant_id: t._id,
          horaSalida: { $gte: inicio, $lte: fin },
        }),
        Resident.countDocuments({ tenant_id: t._id, activo: true }),
        Vehicle.countDocuments({ tenant_id: t._id }),
      ]);

      granTotalEntradas += entradas;
      granTotalSalidas  += salidas;
      granTotalIngresosVehiculos += ingresosVeh;
      granTotalSalidasVehiculos  += salidasVeh;

      return {
        _id:                  t._id,
        nombre:               t.nombre,
        slug:                 t.tenant_id,
        nit:                  t.nit,
        ciudad:               t.ciudad,
        colorAcento:          t.colorAcento,
        estado:               t.estado,
        activo:               t.activo,
        entradas,
        salidas,
        totalAccesos:         entradas + salidas,
        ingresosVehiculos:    ingresosVeh,
        salidasVehiculos:     salidasVeh,
        totalMovimientosVeh:  ingresosVeh + salidasVeh,
        totalMovimientos:     entradas + salidas + ingresosVeh + salidasVeh,
        totalResidentes,
        totalVehiculos,
      };
    })
  );

  return ok(res, {
    periodo,
    rango: {
      inicio,
      fin,
      inicioStr: inicio.toISOString(),
      finStr: fin.toISOString(),
    },
    resumenGlobal: {
      totalConjuntos: tenants.length,
      granTotalEntradas,
      granTotalSalidas,
      granTotalAccesos: granTotalEntradas + granTotalSalidas,
      granTotalIngresosVehiculos,
      granTotalSalidasVehiculos,
      granTotalVehiculos: granTotalIngresosVehiculos + granTotalSalidasVehiculos,
      granTotalMovimientos: granTotalEntradas + granTotalSalidas + granTotalIngresosVehiculos + granTotalSalidasVehiculos,
    },
    conjuntos: conjuntoStats,
  });
});

module.exports = {
  getConjuntoAnalytics,
  getGlobalAnalytics,
};
