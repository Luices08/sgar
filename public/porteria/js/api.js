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

      // Guardar en Dexie para uso offline
      await dbConfig.set('user',    user);
      await dbConfig.set('token',   token);
      if (tenantConfig) {
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

  /* ── REGISTRAR VISITA (Write-Through) ────────────────────────────────────── */
  async function registrarVisita(visitData) {
    // PASO 1: Guardar en Dexie siempre (Write-Through)
    const localRecord = await dbVisitas.save(visitData);

    // PASO 2: Intentar sincronizar inmediatamente si hay conexión
    if (navigator.onLine) {
      try {
        const res = await request('/api/visits', {
          method: 'POST',
          body:   JSON.stringify({ ...visitData, localId: localRecord.localId }),
        });
        if (res?.success) {
          await dbVisitas.markSynced(localRecord.id);
          return { success: true, visit: res.data.visit, local: false };
        }
      } catch (_) {
        // Sin conexión o error: queda pendiente en Dexie
      }
    }

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

  /* ── BUSCAR PLACA OCR (llamada al servidor, requiere conexión) ────────────── */
  async function buscarPlaca(placa) {
    // Primero en caché local
    const local = await dbVehiculos.buscarPlaca(placa);
    if (local) return { success: true, data: { vehicle: local }, source: 'local' };

    // Luego en servidor
    if (!navigator.onLine) return { success: false };
    const res = await request(`/api/vehicles?q=${encodeURIComponent(placa)}&limit=1`);
    return res;
  }

  /* ── LOGOUT ────────────────────────────────────────────────────────────────── */
  async function logout() {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch (_) {}
    localStorage.clear();
    document.cookie = 'token=; Max-Age=0; path=/';
    window.location.href = '/admin/login';
  }

  return { login, registrarVisita, syncPendientes, validarInvitacion, completarInvitacion, buscarPlaca, logout, cargarDatosOffline, request };
})();