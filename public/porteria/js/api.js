/* ─── SGAR Portería — Capa de API ────────────────────────────────────────────
   Todas las llamadas al servidor van por aquí.
   Si hay error de red, se registra en Dexie y se sincroniza después.
   ──────────────────────────────────────────────────────────────────────────── */
'use strict';

const porteriaAPI = (() => {
  const getToken = () => localStorage.getItem('sgar_token');

  async function request(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { ...options, headers });
    const data = await res.json();
    return data;
  }

  /* ── LOGIN ────────────────────────────────────────────────────────────────── */
  async function login(email, password) {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.success) {
      const { token, user, tenantConfig } = data.data;
      localStorage.setItem('sgar_token', token);
      localStorage.setItem('sgar_user',  JSON.stringify(user));

      const currentTenantId = user.tenant_id ? String(user.tenant_id) : null;
      const lastTenantId = await dbConfig.get('currentTenantId');

      if (currentTenantId && lastTenantId && String(lastTenantId) !== currentTenantId) {
        await db.visitas.clear();
        await db.vehiculos.clear();
        await db.residentes.clear();
        await db.config.clear();
      }

      if (currentTenantId) {
        await dbConfig.set('currentTenantId', currentTenantId);
        await dbVisitas.purgarOtrosTenants(currentTenantId);
      }

      // Guardar en Dexie para uso offline
      await dbConfig.set('user',    user);
      await dbConfig.set('token',   token);
      if (tenantConfig) {
        localStorage.setItem('sgar_tenant', JSON.stringify(tenantConfig));
        await dbConfig.set('tenant', tenantConfig);
        await dbConfig.set('colorAcento', tenantConfig.colorAcento);
        await dbConfig.set('conjuntoNombre', tenantConfig.nombre);
        await dbConfig.set('deliveryEmpresas', tenantConfig.deliveryEmpresas);
      }

      // Pre-cargar datos para modo offline
      await cargarDatosOffline();
    }

    return data;
  }

  /* ── CARGAR DATOS PARA OFFLINE ────────────────────────────────────────────── */
  async function cargarDatosOffline() {
    try {
      const [vehiculosRes, residentesRes] = await Promise.all([
        request('/api/vehicles?limit=200'),
        request('/api/residents?limit=500'),
      ]);
      if (vehiculosRes?.success)   await dbVehiculos.cargarDesdeServidor(vehiculosRes.data);
      if (residentesRes?.success)  await dbResidentes.cargarDesdeServidor(residentesRes.data);
    } catch (_) {
      // Silencioso: los datos ya están en Dexie de sesiones anteriores
    }
  }

  /* ── REGISTRAR VISITA (Write-Through / Online Sync) ──────────────────────── */
  async function registrarVisita(visitData) {
    const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
    const tenantId = visitData.tenant_id || user.tenant_id;
    if (!visitData.tenant_id && tenantId) {
      visitData.tenant_id = tenantId;
    }

    if (navigator.onLine) {
      try {
        const res = await request('/api/visits', {
          method: 'POST',
          body:   JSON.stringify(visitData),
        });
        if (res?.success && res.data?.visit) {
          const v = res.data.visit;
          await dbVisitas.save({
            ...v,
            tenant_id:  v.tenant_id || tenantId,
            localId:    v.localId || v._id,
            movimiento: res.data.accion || (v.horaSalida ? 'salida' : 'ingreso'),
            syncStatus: 'sincronizado',
          });
          return { success: true, visit: v, accion: res.data.accion, local: false };
        } else if (res && !res.success) {
          // El servidor rechazó por regla de negocio (ej: visitante ya dentro, datos inválidos)
          return { success: false, message: res.message || 'Error al procesar el registro' };
        }
      } catch (err) {
        // Error de red real (sin conexión a internet): proceder a guardar offline
        console.warn('Network error, saving offline:', err.message);
      }
    }

    // PASO: Comprobar duplicado antes de guardar en Dexie offline
    if (visitData.tipo === 'visita' && visitData.cedula) {
      const openVisitor = await dbVisitas.buscarVisitanteAbierto(visitData.cedula);
      if (openVisitor) {
        return {
          success: false,
          message: `El visitante (C.C. ${visitData.cedula}) ya se encuentra dentro de las instalaciones para el Apto ${openVisitor.apartamento}. Debe registrar su salida primero.`
        };
      }
    }

    // Guardar en Dexie offline
    const localRecord = await dbVisitas.save(visitData);
    return { success: true, visit: localRecord, local: true };
  }

  /* ── SINCRONIZACIÓN BATCH ─────────────────────────────────────────────────── */
  async function syncPendientes() {
    const pendientes = await dbVisitas.getPendientes();
    if (!pendientes.length) return { synced: 0 };

    try {
      const res = await request('/api/visits/sync', {
        method: 'POST',
        body:   JSON.stringify({ registros: pendientes }),
      });

      if (res?.success) {
        // Marcar todos como sincronizados
        for (const p of pendientes) {
          await dbVisitas.markSynced(p.id);
        }
        return { synced: pendientes.length, details: res.data };
      }
    } catch (e) {
      console.warn('Sync failed:', e.message);
    }

    return { synced: 0 };
  }

  /* ── VALIDAR CÓDIGO INVITACIÓN ────────────────────────────────────────────── */
  async function validarInvitacion(codigo) {
    if (!navigator.onLine) return { success: false, message: 'Sin conexión para validar código' };
    return request('/api/invitations/validate', { method: 'POST', body: JSON.stringify({ codigo }) });
  }

  /* ── COMPLETAR INVITACIÓN ─────────────────────────────────────────────────── */
  async function completarInvitacion(invitationId) {
    return request(`/api/invitations/${invitationId}/complete`, { method: 'PATCH' });
  }

  /* ── BUSCAR PLACA OCR ─────────────────────────────────────────────────────── */
  async function buscarPlaca(placa) {
    if (navigator.onLine) {
      try {
        const res = await request('/api/vehicle-access/buscar-placa', {
          method: 'POST',
          body: JSON.stringify({ placa }),
        });
        if (res?.success) return res;
      } catch (_) {}
    }

    // Fallback local
    const local = await dbVehiculos.buscarPlaca(placa);
    if (local) return { success: true, data: { vehicle: local, registered: true }, source: 'local' };
    return { success: false, data: { registered: false } };
  }

  /* ── REGISTRAR SALIDA DE VISITANTE ───────────────────────────────────────── */
  async function registrarSalidaVisita(visitId) {
    if (navigator.onLine) {
      try {
        const res = await request(`/api/visits/${visitId}/salida`, {
          method: 'PATCH',
          body: JSON.stringify({ horaSalida: new Date().toISOString(), metodoSalida: 'manual' }),
        });
        if (res?.success && res.data?.visit) {
          await dbVisitas.save({
            ...res.data.visit,
            syncStatus: 'sincronizado',
            movimiento: 'salida',
          });
          return res;
        }
      } catch (e) {
        console.warn('Online exit failed, fallback to local:', e.message);
      }
    }

    // Fallback local en Dexie
    const local = await db.visitas.get(visitId) || await db.visitas.filter(v => v._id === visitId || v.localId === visitId).first();
    if (local) {
      local.horaSalida = new Date().toISOString();
      local.movimiento = 'salida';
      local.syncStatus = 'pendiente';
      await db.visitas.put(local);
      return { success: true, local: true, data: { visit: local } };
    }
    return { success: false, message: 'Registro no encontrado' };
  }

  /* ── OBTENER VISITANTES ACTIVOS ───────────────────────────────────────────── */
  async function obtenerVisitantesActivos() {
    if (navigator.onLine) {
      try {
        const res = await request('/api/visits/activas');
        if (res?.success) return res.data.visitantes || [];
      } catch (_) {}
    }
    return dbVisitas.getVisitantesActivos();
  }

  /* ── OBTENER INVITACIONES PENDIENTES ─────────────────────────────────────── */
  async function obtenerInvitacionesPendientes() {
    if (navigator.onLine) {
      try {
        const res = await request('/api/visits/pendientes');
        if (res?.success) return res.data.invitaciones || [];
      } catch (_) {}
    }
    return [];
  }

  /* ── LOGOUT ────────────────────────────────────────────────────────────────── */
  async function logout() {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    localStorage.clear();
    try {
      await db.visitas.clear();
      await db.vehiculos.clear();
      await db.residentes.clear();
      await db.config.clear();
    } catch (_) {}
    document.cookie = 'token=; Max-Age=0; path=/';
    window.location.href = '/admin/login';
  }

  return {
    login,
    registrarVisita,
    registrarSalidaVisita,
    obtenerVisitantesActivos,
    obtenerInvitacionesPendientes,
    syncPendientes,
    validarInvitacion,
    completarInvitacion,
    buscarPlaca,
    logout,
    cargarDatosOffline,
    request,
  };
})();