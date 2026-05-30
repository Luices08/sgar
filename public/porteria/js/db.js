/* ─── SGAR Portería — Dexie.js (IndexedDB) ───────────────────────────────────
   Write-Through: toda escritura va primero aquí, luego a MongoDB al sincronizar.
   Offline-First: la app funciona completamente sin conexión.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

const db = new Dexie('sgar_porteria');

db.version(1).stores({
  // Registros de acceso — tabla principal
  visitas: '++id, localId, syncStatus, horaIngreso, tipo, apartamento, tenant_id',

  // Configuración del celador/tenant (una sola fila)
  config: 'key',

  // Placas registradas para el tenant (caché del servidor)
  vehiculos: 'placa, apartamento',

  // Residentes conocidos (caché para búsqueda offline)
  residentes: '_id, apartamento, cedula, nombre, faceId',
});

/* ─── CONFIG HELPERS ─────────────────────────────────────────────────────────── */
const dbConfig = {
  async get(key) {
    const row = await db.config.get(key);
    return row ? row.value : null;
  },
  async set(key, value) {
    await db.config.put({ key, value });
  },
  async getAll() {
    const rows = await db.config.toArray();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },
};

/* ─── VISIT HELPERS ──────────────────────────────────────────────────────────── */
const dbVisitas = {
  // Crear localId único
  newLocalId() {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  },

  // Guardar visita local (pendiente de sync)
  async save(visitData) {
    const localId = visitData.localId || dbVisitas.newLocalId();
    const row = {
      ...visitData,
      localId,
      syncStatus: 'pendiente',
      horaIngreso: visitData.horaIngreso || new Date().toISOString(),
    };
    const id = await db.visitas.add(row);
    return { ...row, id };
  },

  // Obtener visitas no sincronizadas
  async getPendientes() {
    return db.visitas.where('syncStatus').equals('pendiente').toArray();
  },

  // Marcar como sincronizada
  async markSynced(id) {
    await db.visitas.update(id, { syncStatus: 'sincronizado' });
  },

  // Obtener las últimas N visitas (para la franja reciente)
  async getRecientes(n = 3) {
    const all = await db.visitas.orderBy('horaIngreso').reverse().limit(n).toArray();
    return all;
  },

  // Obtener todas las del turno (misma sesión)
  async getTurno(desde) {
    const iso = desde || new Date().toISOString().split('T')[0]; // desde hoy
    return db.visitas
      .where('horaIngreso').above(iso)
      .reverse()
      .toArray();
  },

  // Actualizar visita local (para correcciones en turno)
  async update(id, fields) {
    await db.visitas.update(id, fields);
  },

  // Eliminar visita local (solo si está pendiente)
  async delete(id) {
    await db.visitas.delete(id);
  },

  // Contar pendientes
  async countPendientes() {
    return db.visitas.where('syncStatus').equals('pendiente').count();
  },
};

/* ─── VEHÍCULOS HELPERS ──────────────────────────────────────────────────────── */
const dbVehiculos = {
  async buscarPlaca(placa) {
    return db.vehiculos.get(placa.toUpperCase());
  },
  async upsert(vehiculo) {
    await db.vehiculos.put({ ...vehiculo, placa: vehiculo.placa.toUpperCase() });
  },
  async cargarDesdeServidor(vehiculos) {
    await db.vehiculos.clear();
    await db.vehiculos.bulkPut(vehiculos.map(v => ({ ...v, placa: v.placa.toUpperCase() })));
  },
};

/* ─── RESIDENTES HELPERS ─────────────────────────────────────────────────────── */
const dbResidentes = {
  async buscarPorApartamento(apt) {
    return db.residentes.where('apartamento').equals(apt.toUpperCase()).toArray();
  },
  async cargarDesdeServidor(residentes) {
    await db.residentes.clear();
    await db.residentes.bulkPut(residentes);
  },
};
