/* ─── SGAR Portería — Dexie.js (IndexedDB) ───────────────────────────────────
   Write-Through: toda escritura va primero aquí, luego a MongoDB al sincronizar.
   Offline-First: la app funciona completamente sin conexión.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

const db = new Dexie('sgar_porteria');

db.version(1).stores({
  visitas: '++id, localId, syncStatus, horaIngreso, tipo, apartamento, tenant_id',
  config: 'key',
  vehiculos: 'placa, apartamento',
  residentes: '_id, apartamento, cedula, nombre, faceId',
});

// Fase 1: Nueva estructura de Vehículos, migración de llave primaria
// Dexie requiere eliminar la tabla y volverla a crear para cambiar el Primary Key
db.version(2).stores({
  vehiculos: null // Eliminar tabla anterior con PK string (placa)
});

db.version(3).stores({
  vehiculos: '_id, placa, apartamento, resident_id',
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
  // Helper para obtener el tenant_id del usuario logueado actualmente
  getCurrentTenantId() {
    try {
      const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
      return user.tenant_id ? String(user.tenant_id) : null;
    } catch (_) {
      return null;
    }
  },

  // Crear localId único
  newLocalId() {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  },

  // Purgar visitas de otros tenants de la BD local
  async purgarOtrosTenants(currentTenantId) {
    const tid = currentTenantId || dbVisitas.getCurrentTenantId();
    if (!tid) return;
    try {
      const all = await db.visitas.toArray();
      const idsToDelete = all
        .filter(v => !v.tenant_id || String(v.tenant_id) !== String(tid))
        .map(v => v.id);
      if (idsToDelete.length > 0) {
        await db.visitas.bulkDelete(idsToDelete);
      }
    } catch (e) {
      console.warn('Error purgando visitas de otros tenants:', e);
    }
  },

  // Guardar visita local (pendiente de sync o cacheada)
  async save(visitData) {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const tenantId = visitData.tenant_id ? String(visitData.tenant_id) : currentTenantId;

    // Si ya existe por _id o localId, actualizarlo dentro del mismo tenant
    if (visitData._id || visitData.localId) {
      const existing = await db.visitas.filter(v =>
        ((visitData._id && v._id === visitData._id) ||
          (visitData.localId && v.localId === visitData.localId)) &&
        (!tenantId || !v.tenant_id || String(v.tenant_id) === String(tenantId))
      ).first();

      if (existing) {
        const updatedRow = {
          ...existing,
          ...visitData,
          tenant_id: tenantId || existing.tenant_id,
          horaSalida: visitData.horaSalida !== undefined ? visitData.horaSalida : existing.horaSalida,
          estadoDomicilio: visitData.estadoDomicilio !== undefined ? visitData.estadoDomicilio : existing.estadoDomicilio,
          fechaRecepcion: visitData.fechaRecepcion !== undefined ? visitData.fechaRecepcion : existing.fechaRecepcion,
          movimiento: visitData.movimiento || (visitData.horaSalida ? 'salida' : (existing.horaSalida && !visitData.horaSalida ? 'ingreso' : existing.movimiento)),
        };
        await db.visitas.update(existing.id, updatedRow);
        return { ...updatedRow, id: existing.id };
      }
    }

    const localId = visitData.localId || dbVisitas.newLocalId();
    const row = {
      ...visitData,
      localId,
      tenant_id: tenantId,
      syncStatus: visitData.syncStatus || 'pendiente',
      horaIngreso: visitData.horaIngreso || new Date().toISOString(),
      movimiento: visitData.movimiento || (visitData.horaSalida ? 'salida' : 'ingreso'),
    };
    const id = await db.visitas.add(row);
    return { ...row, id };
  },

  // Buscar ingreso activo de un residente (filtrando por tenant actual)
  async buscarIngresoAbierto(residentId, cedula, apto) {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const all = await db.visitas.toArray();
    const list = all.filter(v =>
      v.tipo === 'residente' &&
      (!currentTenantId || !v.tenant_id || String(v.tenant_id) === String(currentTenantId))
    );
    return list.reverse().find(v =>
      !v.horaSalida &&
      ((residentId && v.resident_id === residentId) ||
        (cedula && v.cedula === cedula) ||
        (apto && v.apartamento === apto.toUpperCase()))
    ) || null;
  },

  // Buscar ingreso abierto de un visitante (por cédula en el tenant actual)
  async buscarVisitanteAbierto(cedula) {
    if (!cedula) return null;
    const cedTrim = String(cedula).trim().toLowerCase();
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const all = await db.visitas.toArray();
    const list = all.filter(v =>
      v.tipo === 'visita' &&
      !v.horaSalida &&
      (!currentTenantId || !v.tenant_id || String(v.tenant_id) === String(currentTenantId))
    );
    return list.reverse().find(v => v.cedula && String(v.cedula).trim().toLowerCase() === cedTrim) || null;
  },

  // Obtener visitantes y domicilios activos dentro del conjunto (horaSalida == null)
  async getVisitantesActivos() {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const all = await db.visitas.toArray();
    const list = all.filter(v =>
      (v.tipo === 'visita' || v.tipo === 'domicilio') &&
      !v.horaSalida &&
      (!currentTenantId || !v.tenant_id || String(v.tenant_id) === String(currentTenantId))
    );
    list.sort((a, b) => new Date(b.horaIngreso || 0) - new Date(a.horaIngreso || 0));
    return list;
  },

  // Obtener residentes activos dentro del conjunto (horaSalida == null)
  async getResidentesActivos() {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const all = await db.visitas.toArray();
    const list = all.filter(v =>
      v.tipo === 'residente' &&
      !v.horaSalida &&
      (!currentTenantId || !v.tenant_id || String(v.tenant_id) === String(currentTenantId))
    );
    list.sort((a, b) => new Date(b.horaIngreso || 0) - new Date(a.horaIngreso || 0));
    return list;
  },

  // Obtener visitas no sincronizadas del tenant actual
  async getPendientes() {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const all = await db.visitas.toArray();
    return all.filter(v =>
      v.syncStatus === 'pendiente' &&
      (!currentTenantId || !v.tenant_id || String(v.tenant_id) === String(currentTenantId))
    );
  },

  // Marcar como sincronizada
  async markSynced(id) {
    await db.visitas.update(id, { syncStatus: 'sincronizado' });
  },

  // Obtener las últimas N visitas (para la franja reciente, solo del tenant actual)
  async getRecientes(n = 3) {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const all = await db.visitas.toArray();
    const filtered = all.filter(v =>
      !currentTenantId || !v.tenant_id || String(v.tenant_id) === String(currentTenantId)
    );
    filtered.sort((a, b) => {
      const timeA = new Date(a.horaSalida || a.horaIngreso || 0).getTime();
      const timeB = new Date(b.horaSalida || b.horaIngreso || 0).getTime();
      return timeB - timeA;
    });
    return filtered.slice(0, n);
  },

  // Obtener todas las del turno (misma sesión y mismo tenant)
  async getTurno(desde) {
    const currentTenantId = dbVisitas.getCurrentTenantId();
    const iso = desde || new Date().toISOString().split('T')[0]; // desde hoy
    const all = await db.visitas.toArray();
    const filtered = all.filter(v => {
      if (currentTenantId && v.tenant_id && String(v.tenant_id) !== String(currentTenantId)) {
        return false;
      }
      const t = v.horaSalida || v.horaIngreso;
      return t && t >= iso;
    });
    filtered.sort((a, b) => {
      const timeA = new Date(a.horaSalida || a.horaIngreso || 0).getTime();
      const timeB = new Date(b.horaSalida || b.horaIngreso || 0).getTime();
      return timeB - timeA;
    });
    return filtered;
  },

  // Actualizar visita local (para correcciones en turno)
  async update(id, fields) {
    await db.visitas.update(id, fields);
  },

  // Eliminar visita local (solo si está pendiente)
  async delete(id) {
    await db.visitas.delete(id);
  },

  // Contar pendientes del tenant actual
  async countPendientes() {
    const pendientes = await dbVisitas.getPendientes();
    return pendientes.length;
  },
};

/* ─── VEHÍCULOS HELPERS ──────────────────────────────────────────────────────── */
const dbVehiculos = {
  async buscarPlaca(placa) {
    if (!placa) return null;
    return db.vehiculos.where('placa').equals(placa.toUpperCase()).first();
  },
  async buscarPorResidente(residentId) {
    if (!residentId) return [];
    return db.vehiculos.where('resident_id').equals(residentId).toArray();
  },
  async upsert(vehiculo) {
    await db.vehiculos.put({ ...vehiculo, placa: vehiculo.placa ? vehiculo.placa.toUpperCase() : undefined });
  },
  async cargarDesdeServidor(vehiculos) {
    await db.vehiculos.clear();
    await db.vehiculos.bulkPut(vehiculos.map(v => ({ ...v, placa: v.placa ? v.placa.toUpperCase() : undefined })));
  },
};

/* ─── RESIDENTES HELPERS ─────────────────────────────────────────────────────── */
const dbResidentes = {
  async buscarPorApartamento(apt) {
    if (!apt) return [];
    return db.residentes.where('apartamento').equals(apt.toUpperCase()).toArray();
  },
  async buscarPorCedula(cedula) {
    if (!cedula) return null;
    const cleanCed = String(cedula).trim();
    // 1. Búsqueda directa indexada
    const r = await db.residentes.where('cedula').equals(cleanCed).first();
    if (r) return r;
    // 2. Búsqueda insensible a mayúsculas o espacios
    const all = await db.residentes.toArray();
    return all.find(x => x.cedula && String(x.cedula).trim().toLowerCase() === cleanCed.toLowerCase()) || null;
  },
  async buscarPorId(id) {
    if (!id) return null;
    return db.residentes.get(id);
  },
  async cargarDesdeServidor(residentes) {
    await db.residentes.clear();
    await db.residentes.bulkPut(residentes);
  },
};
