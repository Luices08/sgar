/* ─── SGAR Portería — Lógica principal ──────────────────────────────────────── */
'use strict';

let currentScreen = 'login';
let deliveryEmpresas = ['Rappi', 'iFood', 'DidiFood', 'Otro'];
let syncInterval = null;
let residentesActivosList = [];

/* ─── INICIALIZACIÓN ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Registrar Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/porteria/sw.js').catch(console.warn);
  }

  // Aplicar color del tenant desde Dexie (antes de cualquier petición)
  const colorGuardado = await dbConfig.get('colorAcento');
  if (colorGuardado) document.documentElement.style.setProperty('--acento', colorGuardado);

  // Verificar si ya hay sesión
  const token = localStorage.getItem('sgar_token');
  const user = localStorage.getItem('sgar_user');
  if (token && user) {
    await initApp();
  } else {
    window.location.href = '/admin/login';
    return;
  }

  // Monitorear conexión
  initConnectionMonitor();
});

/* ─── INICIALIZAR APP (post-login) ───────────────────────────────────────────── */
async function initApp() {
  const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const currentTenantId = user.tenant_id ? String(user.tenant_id) : null;
  const lastTenantId = await dbConfig.get('currentTenantId');

  // Si cambió de tenant o no coincide el tenant local, purgar almacenamiento local del tenant anterior
  if (currentTenantId && lastTenantId && String(lastTenantId) !== currentTenantId) {
    console.log('[Portería] Cambio de tenant detectado. Limpiando almacenamiento local anterior...');
    await db.visitas.clear();
    await db.vehiculos.clear();
    await db.residentes.clear();
    await db.config.clear();
  }

  if (currentTenantId) {
    await dbConfig.set('currentTenantId', currentTenantId);
    await dbVisitas.purgarOtrosTenants(currentTenantId);
  }

  // Sincronizar datos de tenant desde localStorage si están presentes
  const sgarTenant = localStorage.getItem('sgar_tenant');
  if (sgarTenant) {
    try {
      const tc = JSON.parse(sgarTenant);
      await dbConfig.set('tenant', tc);
      if (tc.colorAcento) await dbConfig.set('colorAcento', tc.colorAcento);
      if (tc.nombre) await dbConfig.set('conjuntoNombre', tc.nombre);
      if (tc.deliveryEmpresas) await dbConfig.set('deliveryEmpresas', tc.deliveryEmpresas);
    } catch (_) { }
  }

  const tenant = await dbConfig.get('tenant');

  // Nombre del conjunto en header
  const nombre = tenant?.nombre || await dbConfig.get('conjuntoNombre') || 'Portería';
  document.getElementById('conjunto-nombre').textContent = nombre;
  document.getElementById('menu-name').textContent = user.nombre || 'Celador';
  document.getElementById('menu-avatar').textContent = (user.nombre || 'C').charAt(0).toUpperCase();
  document.getElementById('menu-conjunto').textContent = nombre;
  const welcomeNameEl = document.getElementById('welcome-name');
  if (welcomeNameEl) welcomeNameEl.textContent = (user.nombre || 'Celador').split(' ')[0];

  // Empresas de domicilio
  const emps = await dbConfig.get('deliveryEmpresas');
  if (emps) deliveryEmpresas = emps;

  // Eventos de la pantalla principal (Acciones Online / Normal)
  const btnRegistroRes = document.getElementById('btn-registro-residente');
  if (btnRegistroRes) btnRegistroRes.addEventListener('click', () => facialModule.openFacialScreen({ expectedMode: 'ingreso' }));

  const btnSalidaRes = document.getElementById('btn-salida-residente');
  if (btnSalidaRes) btnSalidaRes.addEventListener('click', () => { navigate('salidas-residentes'); loadSalidasResidentes(); });

  const btnScanSalidaRes = document.getElementById('btn-scan-salida-residente');
  if (btnScanSalidaRes) btnScanSalidaRes.addEventListener('click', () => facialModule.openFacialScreen({ expectedMode: 'salida' }));

  const btnQuickScanSalida = document.getElementById('btn-quick-scan-salida');
  if (btnQuickScanSalida) btnQuickScanSalida.addEventListener('click', () => facialModule.openFacialScreen({ expectedMode: 'salida' }));

  const btnVisita = document.getElementById('btn-registro-visita');
  if (btnVisita) btnVisita.addEventListener('click', () => { navigate('visitas'); loadPendientes(); });

  const btnSalidaVisita = document.getElementById('btn-salida-visita');
  if (btnSalidaVisita) btnSalidaVisita.addEventListener('click', () => { navigate('salidas-visitas'); loadSalidasVisitantes(); });

  const btnDomicilio = document.getElementById('btn-registro-domicilio');
  if (btnDomicilio) btnDomicilio.addEventListener('click', () => openFormDomicilio());

  // Eventos de modo Offline/Manual
  const btnManualRes = document.getElementById('btn-manual-residente');
  if (btnManualRes) btnManualRes.addEventListener('click', () => openFormVisita({ isResidentManual: true }));

  const btnManualVis = document.getElementById('btn-manual-visita');
  if (btnManualVis) btnManualVis.addEventListener('click', () => openFormVisita());

  const btnManualSalidaVis = document.getElementById('btn-manual-salida-visita');
  if (btnManualSalidaVis) btnManualSalidaVis.addEventListener('click', () => { navigate('salidas-visitas'); loadSalidasVisitantes(); });

  const btnManualDom = document.getElementById('btn-manual-domicilio');
  if (btnManualDom) btnManualDom.addEventListener('click', () => openFormDomicilio());

  // Historial y otros
  document.getElementById('btn-ver-historial').addEventListener('click', () => { navigate('historial'); switchHistorialTab('hoy'); });
  document.getElementById('btn-back-historial').addEventListener('click', () => navigate('main'));
  document.getElementById('tab-historial-hoy')?.addEventListener('click', () => switchHistorialTab('hoy'));
  document.getElementById('tab-historial-completo')?.addEventListener('click', () => switchHistorialTab('completo'));
  document.getElementById('btn-cargar-mas-historial')?.addEventListener('click', cargarMasHistorial);
  document.getElementById('btn-back-analiticas').addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-visitas')?.addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-salidas-visitas')?.addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-salidas-residentes')?.addEventListener('click', () => navigate('main'));

  // Eventos de la pantalla de visitas (Entrada)
  document.getElementById('btn-manual-visita-online')?.addEventListener('click', () => openSearchResidentForVisit());
  document.getElementById('btn-verificar')?.addEventListener('click', verificarCodigoCentro);
  document.getElementById('search-invitations')?.addEventListener('input', filtrarTarjetas);
  document.getElementById('btn-refresh-invitations')?.addEventListener('click', loadPendientes);

  // Eventos de la pantalla de salidas de visitas
  document.getElementById('search-salidas')?.addEventListener('input', filtrarSalidas);
  document.getElementById('btn-refresh-salidas')?.addEventListener('click', () => loadSalidasVisitantes());

  // Eventos de la pantalla de salidas de residentes
  document.getElementById('search-salidas-res')?.addEventListener('input', filtrarSalidasResidentes);
  document.getElementById('btn-refresh-salidas-res')?.addEventListener('click', () => loadSalidasResidentes());

  document.getElementById('btn-sync').addEventListener('click', doSync);
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Menú lateral
  document.getElementById('btn-menu').addEventListener('click', toggleMenu);
  document.getElementById('menu-overlay').addEventListener('click', closeMenu);

  // Drawer
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  navigate('main');
  await refreshRecientes();
  await updateAllBadges();
  await updateSyncBanner();

  // Inicializar módulo facial
  facialModule.init();

  // Sincronizar cada 30 segundos si hay conexión
  syncInterval = setInterval(async () => {
    if (navigator.onLine) {
      const r = await porteriaAPI.syncPendientes();
      if (r.synced > 0) await updateSyncBanner();
    }
  }, 30000);

  // Iniciar Polling en tiempo real (~3.5 segundos)
  if (window.SGARPoll) {
    SGARPoll.start({
      intervalMs: 3500,
      onCounts: (counts) => {
        if (counts && typeof counts.activeVisitors === 'number') {
          const badgeSalidas = document.getElementById('badge-visitantes-dentro');
          if (badgeSalidas) {
            if (counts.activeVisitors > 0) {
              badgeSalidas.textContent = `${counts.activeVisitors} adentro`;
              badgeSalidas.style.display = 'inline-flex';
            } else {
              badgeSalidas.style.display = 'none';
            }
          }
        }
        if (counts && typeof counts.pendingInvitations === 'number') {
          const badgeEntradas = document.getElementById('badge-invitaciones-pendientes');
          if (badgeEntradas) {
            if (counts.pendingInvitations > 0) {
              badgeEntradas.textContent = `${counts.pendingInvitations} ${counts.pendingInvitations === 1 ? 'pendiente' : 'pendientes'}`;
              badgeEntradas.style.display = 'inline-flex';
            } else {
              badgeEntradas.style.display = 'none';
            }
          }
        }
      },
      onChanges: async (data) => {
        await refreshRecientes();
        await updateAllBadges();
        if (currentScreen === 'historial') {
          switchHistorialTab(currentHistorialTab || 'hoy');
        } else if (currentScreen === 'visitas') {
          await loadPendientes();
        } else if (currentScreen === 'salidas-visitas') {
          await loadSalidasVisitantes();
        }
        data.events.forEach(evt => {
          if (evt.type === 'nueva_invitacion') {
            showToast(`Invitación esperada: ${evt.nombreVisitante || 'Visitante'} (Apto ${evt.apartamento}) · Código: ${evt.codigo}`);
          }
          if (evt.type === 'domicilio' && evt.estadoDomicilio === 'recibido') {
            showToast(`Domicilio para Apto ${evt.apartamento || '—'} confirmado como recibido por el residente`);
          }
          if (evt.type === 'solicitud_ayuda' || evt.type === 'panico' || evt.type === 'emergencia') {
            showToast(`EMERGENCIA: ${evt.titulo || 'Solicitud de ayuda'} - ${evt.mensaje || ''}`, 'error');
          }
        });
      }
    });
  }

  // Refresco activo en tiempo real cada 4 segundos para sincronización garantizada
  setInterval(async () => {
    if (navigator.onLine) {
      try {
        if (currentScreen === 'main') {
          await refreshRecientes();
          await updateAllBadges();
        } else if (currentScreen === 'visitas') {
          await loadPendientes();
          await updateAllBadges();
        } else if (currentScreen === 'salidas-visitas') {
          await loadSalidasVisitantes();
          await updateAllBadges();
        } else if (currentScreen === 'salidas-residentes') {
          await loadSalidasResidentes();
          await updateAllBadges();
        }
      } catch (_) { }
    }
  }, 4000);
}

/* ─── NAVEGACIÓN ─────────────────────────────────────────────────────────────── */
function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');
  currentScreen = screen;
  closeMenu();

  if (screen === 'historial') switchHistorialTab(currentHistorialTab || 'hoy');
  if (screen === 'visitas') loadPendientes();
  if (screen === 'salidas-visitas') loadSalidasVisitantes();
  if (screen === 'salidas-residentes') loadSalidasResidentes();
  if (screen === 'facial') { } // Manejado por facialModule
}

/* ─── MENÚ ───────────────────────────────────────────────────────────────────── */
function toggleMenu() {
  document.getElementById('side-menu').classList.toggle('open');
  document.getElementById('menu-overlay').classList.toggle('open');
}
function closeMenu() {
  document.getElementById('side-menu').classList.remove('open');
  document.getElementById('menu-overlay').classList.remove('open');
}

/* ─── DRAWER ─────────────────────────────────────────────────────────────────── */
function openDrawer(title, html) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML = html;
  document.getElementById('bottom-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  document.getElementById('bottom-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ─── VALIDACIÓN ESTRICTA DE PLACAS SEGÚN TIPO ───────────────────────────────── */
function validarPlacaVehiculo(tipo, placa) {
  if (!placa || !String(placa).trim()) {
    return { valida: false, mensaje: 'La placa del vehículo es obligatoria' };
  }
  const clean = String(placa).toUpperCase().replace(/[\s-]/g, '').trim();
  const t = (tipo || 'Carro').toLowerCase();

  if (t === 'motocicleta' || t === 'moto') {
    // Formato obligatorio: 3 letras, 2 números y 1 letra (ej: ABC 12D o ABC12D)
    const regexMoto = /^[A-Z]{3}[0-9]{2}[A-Z]$/;
    if (!regexMoto.test(clean)) {
      return {
        valida: false,
        mensaje: 'Placa de moto inválida. Debe tener estrictamente 3 letras, 2 números y 1 letra (Ej: ABC 12D).'
      };
    }
  } else if (t === 'carro' || t === 'automovil' || t === 'automóvil') {
    // Formato obligatorio: 3 letras y 3 números (ej: ABC 123 o ABC123)
    const regexCarro = /^[A-Z]{3}[0-9]{3}$/;
    if (!regexCarro.test(clean)) {
      return {
        valida: false,
        mensaje: 'Placa de carro inválida. Debe tener estrictamente 3 letras y 3 números (Ej: ABC 123).'
      };
    }
  } else {
    const regexOtro = /^[A-Z0-9]{5,7}$/;
    if (!regexOtro.test(clean)) {
      return {
        valida: false,
        mensaje: 'Formato de placa inválido. Debe tener entre 5 y 7 caracteres alfanuméricos.'
      };
    }
  }

  return { valida: true, cleanPlaca: clean };
}

/* ─── FORMULARIO VISITA / RESIDENTE MANUAL ───────────────────────────────────── */
function openFormVisita(editData = null) {
  const isResident = editData && editData.isResidentManual;
  const isEdit = editData && !editData.isResidentManual && editData.id;
  let selectedMode = (editData && editData.placa) ? 'vehiculo' : 'pie';

  const html = `
    <div id="f-error" class="form-error" style="display:none"></div>
    <div id="res-status-info" style="display:none; padding:12px 14px; border-radius:var(--radius); font-size:13px; font-weight:600; margin-bottom:14px; line-height:1.4;"></div>
    
    <!-- Selector de Modo: A pie / En vehículo -->
    <div class="form-field" style="margin-bottom:12px;">
      <label style="font-weight:700; margin-bottom:6px; display:block;">¿Cómo ${isResident ? 'se desplaza?' : 'ingresa?'} *</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <button type="button" class="btn-mode-selector ${selectedMode === 'pie' ? 'active' : ''}" id="btn-visita-pie" style="padding:10px; border-radius:8px; border:${selectedMode === 'pie' ? '1.5px solid var(--acento, #2563eb)' : '1px solid var(--border)'}; background:${selectedMode === 'pie' ? 'rgba(37,99,235,0.08)' : 'var(--bg)'}; color:${selectedMode === 'pie' ? 'var(--text)' : 'var(--text-muted)'}; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M7 21l3-7 3 3v5"/><path d="M17 11l-3-3-3 1-2 5"/></svg>
          A pie
        </button>
        <button type="button" class="btn-mode-selector ${selectedMode === 'vehiculo' ? 'active' : ''}" id="btn-visita-vehiculo" style="padding:10px; border-radius:8px; border:${selectedMode === 'vehiculo' ? '1.5px solid var(--acento, #2563eb)' : '1px solid var(--border)'}; background:${selectedMode === 'vehiculo' ? 'rgba(37,99,235,0.08)' : 'var(--bg)'}; color:${selectedMode === 'vehiculo' ? 'var(--text)' : 'var(--text-muted)'}; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="7" cy="21" r="2"/><circle cx="17" cy="21" r="2"/><path d="M14 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/></svg>
          En vehículo
        </button>
      </div>
    </div>

    <!-- Bloque de datos del vehículo -->
    <div id="box-vehiculo-visita" style="display:${selectedMode === 'vehiculo' ? 'block' : 'none'}; padding:12px; border-radius:var(--radius); background:var(--bg); border:1px solid var(--border); margin-bottom:14px;">
      <div id="res-vehiculos-suggest" style="display:none; margin-bottom:10px;"></div>
      <div class="form-row" style="margin-bottom:8px;">
        <div class="form-field" style="margin-bottom:0;">
          <label style="font-size:12px;">Tipo *</label>
          <select id="f-veh-tipo" style="width:100%; padding:8px; font-size:13px;">
            <option value="Carro" ${editData?.tipoVehiculo === 'Carro' ? 'selected' : ''}>Carro</option>
            <option value="Motocicleta" ${editData?.tipoVehiculo === 'Motocicleta' ? 'selected' : ''}>Motocicleta</option>
            <option value="Otro" ${editData?.tipoVehiculo === 'Otro' ? 'selected' : ''}>Otro</option>
          </select>
        </div>
        <div class="form-field" style="margin-bottom:0;">
          <label style="font-size:12px;">Placa *</label>
          <input type="text" id="f-veh-placa" placeholder="PLACA" value="${editData?.placa || ''}" style="width:100%; padding:8px; font-size:13px; text-transform:uppercase; font-family:monospace; font-weight:700;">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field" style="margin-bottom:0;">
          <label style="font-size:12px;">Marca (opcional)</label>
          <input type="text" id="f-veh-marca" placeholder="Ej. Chevrolet" value="${editData?.marcaVehiculo || ''}" style="width:100%; padding:8px; font-size:13px;">
        </div>
        <div class="form-field" style="margin-bottom:0;">
          <label style="font-size:12px;">Modelo (opcional)</label>
          <input type="text" id="f-veh-modelo" placeholder="Ej. Spark" value="${editData?.modeloVehiculo || ''}" style="width:100%; padding:8px; font-size:13px;">
        </div>
      </div>
      <div id="box-veh-registered-alert" style="display:none; margin-top:8px;"></div>
    </div>

    ${isResident ? `
    <!-- Modo Residente: Cédula como campo principal de búsqueda y validación -->
    <div class="form-field">
      <label style="font-weight:700;">Cédula del Residente *</label>
      <div style="position:relative;">
        <input type="text" id="f-cedula" placeholder="Ingrese número de cédula" value="${editData?.cedula || ''}" inputmode="numeric" style="font-size:16px; font-weight:700; padding:11px 14px;" autofocus required>
        <span id="cedula-spinner" style="display:none; position:absolute; right:12px; top:50%; transform:translateY(-50%); font-size:12px; color:var(--text-muted); font-weight:600;">Buscando…</span>
      </div>
      <small style="color:var(--text-muted); font-size:11px; margin-top:3px; display:block;">El sistema validará que la cédula pertenezca a un residente registrado.</small>
    </div>
    
    <div class="form-row">
      <div class="form-field" style="flex:1.4;">
        <label>Nombre del Residente</label>
        <input type="text" id="f-nombre" placeholder="Nombre completo" value="${editData?.nombre || ''}" readonly style="background:var(--bg); color:var(--text); cursor:not-allowed; font-weight:600;" required>
      </div>
      <div class="form-field" style="flex:0.8;">
        <label>Apartamento</label>
        <input type="text" id="f-apto" placeholder="Apto" value="${editData?.apartamento || ''}" readonly style="background:var(--bg); color:var(--text); cursor:not-allowed; font-weight:600;" required>
      </div>
    </div>
    ` : `
    <div class="form-field">
      <label>Nombre del visitante *</label>
      <input type="text" id="f-nombre" placeholder="Nombre completo" value="${editData?.nombre || ''}" autocomplete="off" required>
    </div>
    <div class="form-row">
      <div class="form-field">
        <label>Cédula *</label>
        <input type="text" id="f-cedula" placeholder="1234567890" value="${editData?.cedula || ''}" inputmode="numeric" required>
      </div>
      <div class="form-field">
        <label>Apartamento *</label>
        <input type="text" id="f-apto" placeholder="101" value="${editData?.apartamento || ''}" autocomplete="off" required>
      </div>
    </div>
    <div class="form-field">
      <label>Código de invitación</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="f-codigo" placeholder="000000" maxlength="6" inputmode="numeric" style="flex:1">
        <button type="button" class="btn-action-secondary" id="btn-validate-code" style="width:auto;padding:0 14px;margin:0;font-size:13px">Validar</button>
      </div>
    </div>
    <div id="inv-info" style="display:none" class="form-ocr-bar found"></div>
    `}

    <input type="hidden" id="f-inv-id">
    <input type="hidden" id="f-is-resident" value="${isResident ? 'true' : 'false'}">
    <input type="hidden" id="f-resident-id" value="${editData?.resident_id || ''}">
    <input type="hidden" id="f-is-verified" value="${(isResident && editData?.resident_id) ? 'true' : 'false'}">
    <input type="hidden" id="f-veh-authorized-id" value="">
    <button class="btn-action" id="btn-submit-visita" ${isResident && !editData?.resident_id ? 'disabled style="opacity:0.6; cursor:not-allowed;"' : ''}>
      ${isEdit ? 'Actualizar' : (isResident ? (editData?.resident_id ? 'Registrar Entrada' : 'Ingrese cédula registrada') : 'Registrar visita')}
    </button>
  `;

  openDrawer(isResident ? 'Registro Manual de Residente' : 'Registrar Visita', html);

  const btnPie = document.getElementById('btn-visita-pie');
  const btnVeh = document.getElementById('btn-visita-vehiculo');
  const boxVeh = document.getElementById('box-vehiculo-visita');

  btnPie.addEventListener('click', () => {
    selectedMode = 'pie';
    btnPie.style.borderColor = 'var(--acento, #2563eb)';
    btnPie.style.background = 'rgba(37,99,235,0.08)';
    btnPie.style.color = 'var(--text)';
    btnVeh.style.borderColor = 'var(--border)';
    btnVeh.style.background = 'var(--bg)';
    btnVeh.style.color = 'var(--text-muted)';
    boxVeh.style.display = 'none';
  });

  btnVeh.addEventListener('click', () => {
    selectedMode = 'vehiculo';
    btnVeh.style.borderColor = 'var(--acento, #2563eb)';
    btnVeh.style.background = 'rgba(37,99,235,0.08)';
    btnVeh.style.color = 'var(--text)';
    btnPie.style.borderColor = 'var(--border)';
    btnPie.style.background = 'var(--bg)';
    btnPie.style.color = 'var(--text-muted)';
    boxVeh.style.display = 'block';
    document.getElementById('f-veh-placa')?.focus();
  });

  const btnSubmit = document.getElementById('btn-submit-visita');
  btnSubmit.addEventListener('click', () => submitVisita(isEdit ? editData.id : null, selectedMode));

  if (!isResident) {
    document.getElementById('btn-validate-code').addEventListener('click', validateCode);
  } else {
    // ─── VALIDACIÓN EN TIEMPO REAL DE CÉDULA DE RESIDENTE ──────────────────────────
    const cedulaInput = document.getElementById('f-cedula');
    const nombreInput = document.getElementById('f-nombre');
    const aptoInput = document.getElementById('f-apto');
    const residentIdInput = document.getElementById('f-resident-id');
    const isVerifiedInput = document.getElementById('f-is-verified');
    const infoEl = document.getElementById('res-status-info');
    const spinnerEl = document.getElementById('cedula-spinner');
    const vehSuggestBox = document.getElementById('res-vehiculos-suggest');

    let debounceTimer = null;

    const verificarCedulaLive = async () => {
      const cedula = cedulaInput ? cedulaInput.value.trim() : '';
      if (!cedula) {
        if (infoEl) infoEl.style.display = 'none';
        if (nombreInput) nombreInput.value = '';
        if (aptoInput) aptoInput.value = '';
        if (residentIdInput) residentIdInput.value = '';
        if (isVerifiedInput) isVerifiedInput.value = 'false';
        if (vehSuggestBox) vehSuggestBox.style.display = 'none';
        if (btnSubmit) {
          btnSubmit.textContent = 'Ingrese cédula registrada';
          btnSubmit.style.background = '';
          btnSubmit.disabled = true;
          btnSubmit.style.opacity = '0.6';
          btnSubmit.style.cursor = 'not-allowed';
        }
        return;
      }

      if (spinnerEl) spinnerEl.style.display = 'block';

      try {
        const verif = await porteriaAPI.verificarResidentePorCedula(cedula);
        if (spinnerEl) spinnerEl.style.display = 'none';

        const resData = (verif && verif.data) ? verif.data : verif;
        const exists = resData && (resData.exists === true || resData.exists === 'true');
        const r = resData ? (resData.resident || (resData._id ? resData : null)) : null;

        if (exists && r && (r.nombre || r._id)) {
          if (nombreInput) nombreInput.value = r.nombre || '';
          if (aptoInput) aptoInput.value = r.apartamento || '';
          if (residentIdInput) residentIdInput.value = r._id || '';
          if (isVerifiedInput) isVerifiedInput.value = 'true';

          const vehiculos = resData.vehiculos || [];
          const dentro = !!resData.dentro;
          const openVisit = resData.openVisit || null;

          // Manejar sugerencias de vehículos vinculados con indicación de presencia
          if (vehSuggestBox && vehiculos.length > 0) {
            vehSuggestBox.style.display = 'block';
            vehSuggestBox.innerHTML = `
              <label style="font-size:12px; font-weight:700; color:var(--text-muted); display:block; margin-bottom:4px;">Vehículos vinculados a este residente:</label>
              <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${vehiculos.map(v => {
              const isDentro = v.dentro || v.estadoAcceso === 'dentro';
              const badgeColor = isDentro ? '#059669' : '#6b7280';
              const badgeBg = isDentro ? 'rgba(5,150,105,0.12)' : 'rgba(107,114,128,0.12)';
              const icon = (v.tipo || '').toLowerCase().includes('moto') ? '🏍️' : '🚗';
              return `
                    <button type="button" class="btn-tag-vehiculo" onclick="document.getElementById('f-veh-placa').value='${v.placa}'; document.getElementById('f-veh-tipo').value='${v.tipo || 'Carro'}'; document.getElementById('f-veh-marca').value='${v.marca || ''}'; document.getElementById('f-veh-modelo').value='${v.modelo || ''}';" style="padding:5px 9px; border-radius:6px; font-size:12px; background:var(--white); border:1px solid var(--border); cursor:pointer; font-weight:600; display:flex; align-items:center; gap:6px; transition:all .15s;">
                      <span>${icon} <strong>${v.placa}</strong> (${v.tipo || 'Carro'})</span>
                      <span style="font-size:10px; font-weight:700; color:${badgeColor}; background:${badgeBg}; padding:2px 6px; border-radius:4px;">${isDentro ? '● DENTRO' : '○ FUERA'}</span>
                    </button>
                  `;
            }).join('')}
              </div>
            `;
          } else if (vehSuggestBox) {
            vehSuggestBox.style.display = 'none';
          }

          if (infoEl) {
            infoEl.style.display = 'block';
            if (dentro) {
              infoEl.style.background = 'rgba(239, 68, 68, 0.12)';
              infoEl.style.color = '#dc2626';
              infoEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
              const horaIngresoStr = openVisit?.horaIngreso ? fmtHora(openVisit.horaIngreso) : '';
              infoEl.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:16px;">👤</span>
                  <div>
                    <strong>✓ Residente:</strong> ${r.nombre} &middot; Apto <strong>${r.apartamento}</strong><br>
                    Estado actual: <strong>DENTRO</strong> ${horaIngresoStr ? `(desde las ${horaIngresoStr})` : ''} &middot; Se registrará su <strong>SALIDA</strong>.<br>
                    <small style="color:var(--text-muted); font-size:11px; margin-top:2px; display:block;">Si sale a pie, los vehículos que hayan ingresado permanecerán dentro del conjunto.</small>
                  </div>
                </div>
              `;
              btnSubmit.textContent = 'Registrar Salida de Residente';
              btnSubmit.style.background = '#dc2626';
              btnSubmit.disabled = false;
              btnSubmit.style.opacity = '1';
              btnSubmit.style.cursor = 'pointer';
            } else {
              infoEl.style.background = 'rgba(16, 185, 129, 0.12)';
              infoEl.style.color = '#059669';
              infoEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
              infoEl.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:16px;">👤</span>
                  <div>
                    <strong>✓ Residente:</strong> ${r.nombre} &middot; Apto <strong>${r.apartamento}</strong><br>
                    Estado actual: <strong>FUERA</strong> &middot; Se registrará su <strong>ENTRADA</strong>.
                  </div>
                </div>
              `;
              btnSubmit.textContent = 'Registrar Entrada de Residente';
              btnSubmit.style.background = '';
              btnSubmit.disabled = false;
              btnSubmit.style.opacity = '1';
              btnSubmit.style.cursor = 'pointer';
            }
          }
        } else {
          // No existe
          if (nombreInput) nombreInput.value = '';
          if (aptoInput) aptoInput.value = '';
          if (residentIdInput) residentIdInput.value = '';
          if (isVerifiedInput) isVerifiedInput.value = 'false';
          if (vehSuggestBox) vehSuggestBox.style.display = 'none';

          if (infoEl) {
            infoEl.style.display = 'block';
            infoEl.style.background = 'rgba(239, 68, 68, 0.10)';
            infoEl.style.color = '#dc2626';
            infoEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            infoEl.innerHTML = `
              <div style="display:flex; align-items:flex-start; gap:8px;">
                <span style="font-size:16px;"></span>
                <div>
                  <strong>Cédula no registrada:</strong> No existe ningún residente registrado con la cédula <strong>${cedula}</strong> en este conjunto residencial.<br>
                  <small style="color:var(--text-muted); display:block; margin-top:4px;">Si se trata de un visitante o tercero, debe registrarlo en el módulo de Visitas.</small>
                </div>
              </div>
            `;
          }

          if (btnSubmit) {
            btnSubmit.textContent = 'Cédula no registrada';
            btnSubmit.style.background = '#9ca3af';
            btnSubmit.disabled = true;
            btnSubmit.style.opacity = '0.6';
            btnSubmit.style.cursor = 'not-allowed';
          }
        }
      } catch (err) {
        if (spinnerEl) spinnerEl.style.display = 'none';
        console.warn('Error verificando cédula:', err);
      }
    };

    cedulaInput?.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(verificarCedulaLive, 300);
    });

    cedulaInput?.addEventListener('blur', verificarCedulaLive);

    // Si ya trae cédula precargada (ej. editData), ejecutar verificación inicial
    if (cedulaInput && cedulaInput.value.trim()) {
      verificarCedulaLive();
    }
  }

  // ─── VALIDACIÓN EN TIEMPO REAL DE PLACA VEHICULAR (VISITANTES Y RESIDENTES) ───────
  const placaInput = document.getElementById('f-veh-placa');
  const alertVehBox = document.getElementById('box-veh-registered-alert');
  const tipoVehInput = document.getElementById('f-veh-tipo');
  const marcaVehInput = document.getElementById('f-veh-marca');
  const modeloVehInput = document.getElementById('f-veh-modelo');
  let vehDebounceTimer = null;
  let currentVehPollInterval = null;

  const verificarPlacaLive = async () => {
    if (currentVehPollInterval) {
      clearInterval(currentVehPollInterval);
      currentVehPollInterval = null;
    }
    const rawPlaca = placaInput ? placaInput.value.trim().toUpperCase() : '';
    if (!rawPlaca || rawPlaca.length < 3) {
      if (alertVehBox) { alertVehBox.style.display = 'none'; alertVehBox.innerHTML = ''; }
      return;
    }

    try {
      const vRes = await porteriaAPI.request('/api/vehicle-access/buscar-placa', {
        method: 'POST',
        body: JSON.stringify({ placa: rawPlaca }),
      });

      if (vRes?.success && vRes.data?.registered && vRes.data?.vehicle) {
        const vh = vRes.data.vehicle;
        const resp = vRes.data.responsablePrincipal;
        const autorizados = vRes.data.autorizados || [];
        const propietarios = vRes.data.propietarios || [];

        // Autocompletar datos del vehículo
        if (tipoVehInput && vh.tipo) tipoVehInput.value = vh.tipo;
        if (marcaVehInput && !marcaVehInput.value && vh.marca) marcaVehInput.value = vh.marca;
        if (modeloVehInput && !modeloVehInput.value && vh.modelo) modeloVehInput.value = vh.modelo;

        // Validar si el conductor actual está autorizado
        const curResidentId = document.getElementById('f-resident-id')?.value;
        const isCurrentResident = isResident && curResidentId;
        const isDriverAuthorized = isCurrentResident && (
          (resp && String(resp._id) === String(curResidentId)) ||
          autorizados.some(a => String(a._id) === String(curResidentId)) ||
          propietarios.some(p => String(p._id || p) === String(curResidentId))
        );

        if (!isDriverAuthorized) {
          // Alertar al celador: Vehículo registrado con conductor no autorizado
          const titularNombre = resp?.nombre || 'Residente titular';
          const titularApto = resp?.apartamento || vh.apartamento || 'S/N';
          const titularTel = resp?.telefono || '';
          const titularUserId = resp?.user_id || '';

          if (alertVehBox) {
            alertVehBox.style.display = 'block';
            alertVehBox.innerHTML = `
              <div style="background:rgba(245, 158, 11, 0.12); border:1.5px solid #f59e0b; border-radius:8px; padding:12px; margin-top:8px;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:#b45309; font-size:13px;">
                  <span style="font-size:16px;"></span>
                  <span>VEHÍCULO REGISTRADO EN EL CONJUNTO</span>
                </div>
                <div style="font-size:12px; color:#92400e; margin-top:4px; line-height:1.4;">
                  Este vehículo pertenece al Apto <strong>${escHtml(titularApto)}</strong> &middot; Titular: <strong>${escHtml(titularNombre)}</strong>.
                  ${isResident ? '<br><span style="color:#b91c1c; font-weight:700;">El residente ingresado no figura como titular ni autorizado de esta placa.</span>' : '<br>El conductor es un visitante / persona externa.'}
                </div>
                <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
                  ${titularTel ? `
                    <a href="tel:${titularTel}" class="btn-action-sm" style="background:#059669; color:#fff; text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:6px; font-size:12px; font-weight:700; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
                       Llamar a ${escHtml(titularNombre)} (${escHtml(titularTel)})
                    </a>
                  ` : '<span style="font-size:11px; color:var(--text-muted);">Sin teléfono registrado</span>'}
                  <button type="button" id="btn-request-veh-perm" class="btn-action-sm" style="background:#d97706; color:#fff; border:none; border-radius:6px; padding:7px 12px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                     Pedir autorización al residente
                  </button>
                </div>
                <div id="veh-live-poll-status" style="margin-top:10px; font-size:13px; font-weight:700; display:none;"></div>
              </div>
            `;

            // Event listener para pedir autorización digital
            document.getElementById('btn-request-veh-perm')?.addEventListener('click', async () => {
              const statusTag = document.getElementById('veh-live-poll-status');
              const condNombre = document.getElementById('f-nombre')?.value.trim() || 'Conductor visitante';
              const condCedula = document.getElementById('f-cedula')?.value.trim() || '';

              if (statusTag) {
                statusTag.style.display = 'block';
                statusTag.innerHTML = '<span style="color:#2563eb;">Enviando solicitud al residente titular...</span>';
              }

              try {
                const pReq = await porteriaAPI.request('/api/notifications/request-auth', {
                  method: 'POST',
                  body: JSON.stringify({
                    user_id: titularUserId,
                    apartamento: titularApto,
                    visitorName: condNombre,
                    cedula: condCedula,
                    tipo: 'permiso_vehiculo',
                    placa: rawPlaca,
                    vehicle_id: vh._id,
                    accion: 'ingreso',
                  }),
                });

                if (!pReq?.success) throw new Error(pReq?.message || 'Error solicitando permiso');

                const notifId = pReq.data.notification_id;
                const permId = pReq.data.permission_id;
                if (permId) {
                  const hiddenPerm = document.getElementById('f-veh-authorized-id');
                  if (hiddenPerm) hiddenPerm.value = permId;
                }

                statusTag.innerHTML = `
                  <div style="background:#eff6ff; border:1px solid #93c5fd; border-radius:6px; padding:8px 10px; color:#1e40af; display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <span style="display:flex; align-items:center; gap:6px;">
                      <span style="display:inline-block; width:12px; height:12px; border:2px solid #3b82f6; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span>
                      <span>Esperando respuesta de <strong>${escHtml(titularNombre)}</strong> (actualizando en vivo)...</span>
                    </span>
                  </div>
                `;

                // Iniciar Polling en vivo cada 2.5 segundos
                currentVehPollInterval = setInterval(async () => {
                  if (!document.getElementById('veh-live-poll-status')) {
                    clearInterval(currentVehPollInterval);
                    currentVehPollInterval = null;
                    return;
                  }

                  try {
                    const sRes = await porteriaAPI.request(`/api/notifications/${notifId}/status`);
                    if (sRes?.success) {
                      if (sRes.data.status === 'aprobado' || sRes.data.permissionStatus === 'aprobado') {
                        statusTag.innerHTML = `
                          <div style="background:#ecfdf5; border:1px solid #6ee7b7; border-radius:6px; padding:8px 10px; color:#065f46; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:16px;"></span>
                            <div>
                              <strong>¡ACCESO AUTORIZADO POR EL RESIDENTE!</strong><br>
                              <small>${escHtml(titularNombre)} aprobó el uso del vehículo.</small>
                            </div>
                          </div>
                        `;
                        clearInterval(currentVehPollInterval);
                        currentVehPollInterval = null;
                      } else if (sRes.data.status === 'rechazado' || sRes.data.permissionStatus === 'rechazado') {
                        statusTag.innerHTML = `
                          <div style="background:#fef2f2; border:1px solid #fca5a5; border-radius:6px; padding:8px 10px; color:#991b1b; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:16px;"></span>
                            <div>
                              <strong>ACCESO RECHAZADO POR EL RESIDENTE</strong><br>
                              <small>${escHtml(titularNombre)} denegó el uso del vehículo.</small>
                            </div>
                          </div>
                        `;
                        clearInterval(currentVehPollInterval);
                        currentVehPollInterval = null;
                      }
                    }
                  } catch (_) { }
                }, 2500);

              } catch (err) {
                if (statusTag) statusTag.innerHTML = `<span style="color:#dc2626;">Error: ${escHtml(err.message)}</span>`;
              }
            });
          }
        } else {
          // Conductor autorizado
          if (alertVehBox) {
            alertVehBox.style.display = 'block';
            alertVehBox.innerHTML = `
              <div style="background:rgba(5, 150, 105, 0.08); border:1px solid #10b981; border-radius:6px; padding:8px 10px; font-size:12px; color:#065f46; display:flex; align-items:center; gap:6px;">
                <span></span>
                <span>Vehículo registrado · Residente autorizado como titular/conductor.</span>
              </div>
            `;
          }
        }
      } else {
        if (alertVehBox) { alertVehBox.style.display = 'none'; alertVehBox.innerHTML = ''; }
      }
    } catch (_) {
      if (alertVehBox) { alertVehBox.style.display = 'none'; alertVehBox.innerHTML = ''; }
    }
  };

  placaInput?.addEventListener('input', () => {
    clearTimeout(vehDebounceTimer);
    vehDebounceTimer = setTimeout(verificarPlacaLive, 300);
  });

  placaInput?.addEventListener('blur', verificarPlacaLive);

  if (placaInput && placaInput.value.trim()) {
    verificarPlacaLive();
  }
}

async function validateCode() {
  const codigo = document.getElementById('f-codigo').value.trim();
  if (!codigo) return;
  const res = await porteriaAPI.validarInvitacion(codigo);
  if (res?.success) {
    const inv = res.data;
    document.getElementById('f-nombre').value = inv.nombreVisitante || '';
    if (inv.cedulaVisitante) {
      document.getElementById('f-cedula').value = inv.cedulaVisitante;
    }
    document.getElementById('f-apto').value = inv.apartamento || '';
    document.getElementById('f-inv-id').value = inv.invitation_id || '';
    document.getElementById('inv-info').style.display = '';
    document.getElementById('inv-info').textContent = `Invitación válida — Apto ${inv.apartamento}`;
  } else {
    showToast(res?.message || 'Código inválido o ya utilizado', 'error');
  }
}

async function submitVisita(editLocalId = null, modoIngreso = 'pie') {
  const isResident = document.getElementById('f-is-resident').value === 'true';
  const isVerified = document.getElementById('f-is-verified')?.value === 'true';
  let nombre = document.getElementById('f-nombre').value.trim();
  const cedula = document.getElementById('f-cedula').value.trim();
  let apto = document.getElementById('f-apto').value.trim();
  const invId = document.getElementById('f-inv-id').value.trim();
  let residentId = document.getElementById('f-resident-id')?.value.trim();
  const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant = await dbConfig.get('tenant');

  if (!cedula) { document.getElementById('f-error').textContent = 'La cédula es obligatoria'; document.getElementById('f-error').style.display = ''; return; }

  // Validación estricta para residentes: La cédula debe pertenecer a un residente registrado
  if (isResident) {
    if (!residentId || !isVerified) {
      const checkRes = await porteriaAPI.verificarResidentePorCedula(cedula);
      const resData = (checkRes && checkRes.data) ? checkRes.data : checkRes;
      const exists = resData && (resData.exists === true || resData.exists === 'true');
      const r = resData ? (resData.resident || (resData._id ? resData : null)) : null;

      if (!exists || !r) {
        document.getElementById('f-error').textContent = `No es posible registrar el acceso: La cédula ${cedula} no pertenece a ningún residente registrado en este conjunto residencial.`;
        document.getElementById('f-error').style.display = '';
        return;
      }
      residentId = r._id;
      nombre = r.nombre;
      apto = r.apartamento;
      document.getElementById('f-resident-id').value = residentId;
      document.getElementById('f-nombre').value = nombre;
      document.getElementById('f-apto').value = apto;
      document.getElementById('f-is-verified').value = 'true';
    }
  } else {
    if (!nombre) { document.getElementById('f-error').textContent = 'El nombre es obligatorio'; document.getElementById('f-error').style.display = ''; return; }
    if (!apto) { document.getElementById('f-error').textContent = 'El apartamento es requerido'; document.getElementById('f-error').style.display = ''; return; }
  }

  let placa = null;
  let tipoVehiculo = null;
  let marcaVehiculo = null;
  let modeloVehiculo = null;

  if (modoIngreso === 'vehiculo') {
    tipoVehiculo = document.getElementById('f-veh-tipo')?.value || 'Carro';
    const rawPlaca = document.getElementById('f-veh-placa')?.value || '';
    marcaVehiculo = document.getElementById('f-veh-marca')?.value.trim() || null;
    modeloVehiculo = document.getElementById('f-veh-modelo')?.value.trim() || null;

    const valPlaca = validarPlacaVehiculo(tipoVehiculo, rawPlaca);
    if (!valPlaca.valida) {
      document.getElementById('f-error').textContent = valPlaca.mensaje;
      document.getElementById('f-error').style.display = '';
      return;
    }
    placa = valPlaca.cleanPlaca;
  }

  // Si es visitante (no residente), verificar que no tenga ingreso activo en local Dexie
  if (!isResident && cedula) {
    const openVisitor = await dbVisitas.buscarVisitanteAbierto(cedula);
    if (openVisitor) {
      document.getElementById('f-error').textContent = `El visitante ${openVisitor.nombre || nombre} (C.C. ${cedula}) ya se encuentra dentro de las instalaciones para el Apto ${openVisitor.apartamento}. Debe registrar su salida antes de un nuevo ingreso.`;
      document.getElementById('f-error').style.display = '';
      return;
    }
  }

  // Si tiene invitación, completarla en servidor
  if (invId && navigator.onLine && !isResident) {
    const res = await porteriaAPI.request('/api/visits/registrar-ingreso', {
      method: 'POST',
      body: JSON.stringify({
        codigo: document.getElementById('f-codigo')?.value.trim(),
        modo: modoIngreso,
        placa,
        tipoVehiculo,
        marcaVehiculo,
        modeloVehiculo,
      })
    });
    if (res?.success) {
      closeDrawer();
      await refreshRecientes();
      await updateAllBadges();
      showToast('Visita registrada con invitación');
      return;
    } else {
      document.getElementById('f-error').textContent = res?.message || 'Error al completar la invitación';
      document.getElementById('f-error').style.display = '';
      return;
    }
  }

  const visitData = {
    tipo: isResident ? 'residente' : 'visita',
    nombre,
    cedula,
    apartamento: apto,
    resident_id: residentId || null,
    placa,
    tipoVehiculo,
    marcaVehiculo,
    modeloVehiculo,
    celador_id: user.user_id,
    celador_nombre: user.nombre,
    tenant_id: user.tenant_id || tenant?.tenant_id || tenant?._id,
    horaIngreso: new Date().toISOString(),
    metodoIdentificacion: isResident ? 'manual' : (invId ? 'codigo_invitacion' : 'manual'),
    invitation_id: invId || null,
    movimiento: 'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateAllBadges();
    await updateSyncBanner();
    if (isResident) {
      const isSalida = res.accion === 'salida' || res.visit?.horaSalida;
      showToast(isSalida ? 'Salida de residente registrada' : 'Entrada de residente registrada');
    } else {
      showToast(res.local ? 'Registro guardado offline' : 'Registro exitoso');
    }
  } else {
    document.getElementById('f-error').textContent = res.message || 'Error al registrar';
    document.getElementById('f-error').style.display = '';
  }
}

/* ─── FORMULARIO DOMICILIO ───────────────────────────────────────────────────── */
function openFormDomicilio() {
  const empresaOptions = deliveryEmpresas.map(e =>
    `<option value="${e}">${e}</option>`
  ).join('');

  const html = `
    <div id="fd-error" class="form-error" style="display:none"></div>
    <div class="form-field">
      <label>Empresa *</label>
      <select id="fd-empresa"><option value="">Seleccionar…</option>${empresaOptions}</select>
    </div>
    <div class="form-field">
      <label>Apartamento *</label>
      <input type="text" id="fd-apto" placeholder="101" autocomplete="off" inputmode="text">
    </div>
    <div class="form-field">
      <label>Nombre del mensajero</label>
      <input type="text" id="fd-mensajero" placeholder="Opcional" autocomplete="off">
    </div>
    <button class="btn-action" id="btn-submit-domicilio">Registrar domicilio</button>
  `;

  openDrawer('Registrar Domicilio', html);
  document.getElementById('btn-submit-domicilio').addEventListener('click', submitDomicilio);
}

async function submitDomicilio() {
  const empresa = document.getElementById('fd-empresa').value;
  const apto = document.getElementById('fd-apto').value.trim();
  const mensajero = document.getElementById('fd-mensajero').value.trim();
  const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant = await dbConfig.get('tenant');

  if (!empresa) { document.getElementById('fd-error').textContent = 'Selecciona la empresa'; document.getElementById('fd-error').style.display = ''; return; }
  if (!apto) { document.getElementById('fd-error').textContent = 'El apartamento es requerido'; document.getElementById('fd-error').style.display = ''; return; }

  const visitData = {
    tipo: 'domicilio',
    empresa,
    nombre: mensajero || empresa,
    apartamento: apto,
    celador_id: user.user_id,
    celador_nombre: user.nombre,
    tenant_id: user.tenant_id || tenant?.tenant_id || tenant?._id,
    horaIngreso: new Date().toISOString(),
    metodoIdentificacion: 'manual',
    movimiento: 'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(res.local ? 'Domicilio guardado offline' : 'Domicilio registrado');
  }
}

/* ─── FORMULARIO PLACA ───────────────────────────────────────────────────────── */
function openFormPlaca() {
  const html = `
    <div id="fp-error" class="form-error" style="display:none"></div>
    <div class="form-field">
      <label>Número de placa *</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="fp-placa" placeholder="ABC 123" maxlength="8" autocomplete="off"
          style="text-transform:uppercase;flex:1;font-weight:700;letter-spacing:1px;" inputmode="text">
        <button type="button" class="btn-action-secondary" id="btn-buscar-placa"
          style="width:auto;padding:0 14px;margin:0;font-size:13px">Buscar</button>
      </div>
    </div>
    <div id="fp-ocr-info" class="form-ocr-bar" style="display:none"></div>
    <div class="form-field">
      <label>Nombre del conductor</label>
      <input type="text" id="fp-conductor" placeholder="Nombre de la persona al volante" autocomplete="off">
      <small style="color:#64748b; font-size:11px;">Si no es el responsable o persona autorizada, se generará una alerta preventiva.</small>
    </div>
    <div class="form-field">
      <label>Apartamento *</label>
      <input type="text" id="fp-apto" placeholder="101" autocomplete="off">
    </div>
    <input type="hidden" id="fp-vehicle-id">
    <input type="hidden" id="fp-open-log-id">
    <input type="hidden" id="fp-is-salida" value="false">
    <button class="btn-action" id="btn-submit-placa">Registrar ingreso vehicular</button>
  `;

  openDrawer('Escanear / Registrar Vehículo', html);

  const placaEl = document.getElementById('fp-placa');
  placaEl.addEventListener('input', () => { placaEl.value = placaEl.value.toUpperCase(); });
  placaEl.addEventListener('blur', buscarPlaca);
  document.getElementById('btn-buscar-placa').addEventListener('click', buscarPlaca);
  document.getElementById('btn-submit-placa').addEventListener('click', submitPlaca);
}

async function buscarPlaca() {
  const placa = document.getElementById('fp-placa').value.trim().toUpperCase();
  if (!placa) return;

  const res = await porteriaAPI.buscarPlaca(placa);
  const info = document.getElementById('fp-ocr-info');
  const btnSubmit = document.getElementById('btn-submit-placa');
  const isSalidaInput = document.getElementById('fp-is-salida');
  const openLogInput = document.getElementById('fp-open-log-id');
  const vehicleIdInput = document.getElementById('fp-vehicle-id');

  if (res?.success && res.data) {
    const { vehicle, responsablePrincipal, autorizados, openAccess, estadoAcceso } = res.data;

    if (openAccess) {
      isSalidaInput.value = 'true';
      openLogInput.value = openAccess._id;
      if (btnSubmit) {
        btnSubmit.textContent = 'Registrar salida vehicular';
        btnSubmit.className = 'btn-action danger';
      }
    } else {
      isSalidaInput.value = 'false';
      openLogInput.value = '';
      if (btnSubmit) {
        btnSubmit.textContent = 'Registrar ingreso vehicular';
        btnSubmit.className = 'btn-action';
      }
    }

    if (vehicle) {
      vehicleIdInput.value = vehicle._id;
      document.getElementById('fp-apto').value = vehicle.apartamento;
      const respName = responsablePrincipal?.nombre || 'Propietario';
      const authCount = autorizados?.length || 0;

      info.style.display = '';
      info.className = 'form-ocr-bar found';
      info.innerHTML = `
        <strong>Vehículo SGAR (${vehicle.tipo})</strong><br>
        Responsable: <strong>${respName}</strong> (Apto ${vehicle.apartamento})
        ${authCount > 0 ? `<br><small>${authCount} persona(s) autorizada(s)</small>` : ''}
        ${openAccess ? '<br><span style="color:#d97706;font-weight:700;">Actualmente dentro (Registrar Salida)</span>' : ''}
      `;
    } else {
      vehicleIdInput.value = '';
      info.style.display = '';
      info.className = 'form-ocr-bar';
      info.innerHTML = `
        Vehículo externo / visitante.${openAccess ? ' <strong style="color:#d97706;">(Actualmente dentro)</strong>' : ' Ingresa el apartamento de destino.'}
      `;
    }
  } else {
    info.style.display = '';
    info.className = 'form-ocr-bar';
    info.textContent = 'Placa no encontrada en el catálogo. Se registrará como vehículo externo.';
  }
}

async function submitPlaca() {
  const placa = document.getElementById('fp-placa').value.trim().toUpperCase();
  const apto = document.getElementById('fp-apto').value.trim();
  const conductor = document.getElementById('fp-conductor')?.value.trim() || '';
  const vehicleId = document.getElementById('fp-vehicle-id')?.value || null;
  const isSalida = document.getElementById('fp-is-salida')?.value === 'true';
  const openLogId = document.getElementById('fp-open-log-id')?.value || null;
  const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant = await dbConfig.get('tenant');

  if (!placa) { document.getElementById('fp-error').textContent = 'Ingresa la placa'; document.getElementById('fp-error').style.display = ''; return; }
  if (!apto) { document.getElementById('fp-error').textContent = 'Ingresa el apartamento'; document.getElementById('fp-error').style.display = ''; return; }

  // Registro en /api/vehicle-access
  if (navigator.onLine) {
    try {
      if (isSalida) {
        await porteriaAPI.request(`/api/vehicle-access/${openLogId || 'undefined'}/salida`, {
          method: 'PATCH',
          body: JSON.stringify({ placa, conductor_nombre: conductor })
        });
      } else {
        await porteriaAPI.request('/api/vehicle-access/ingreso', {
          method: 'POST',
          body: JSON.stringify({
            placa,
            conductor_nombre: conductor,
            apartamento: apto,
            esExterno: !vehicleId,
          })
        });
      }
    } catch (_) { }
  }

  const visitData = {
    tipo: 'vehiculo',
    placa,
    nombre: conductor || 'Conductor vehicular',
    apartamento: apto,
    celador_id: user.user_id,
    celador_nombre: user.nombre,
    tenant_id: user.tenant_id || tenant?.tenant_id || tenant?._id,
    horaIngreso: new Date().toISOString(),
    metodoIdentificacion: 'manual',
    movimiento: isSalida ? 'salida' : 'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(isSalida ? 'Salida vehicular registrada' : 'Ingreso vehicular registrado');
  } else {
    document.getElementById('fp-error').textContent = res.message || 'Error al registrar vehículo';
    document.getElementById('fp-error').style.display = '';
  }
}

/* ─── RECIENTES (Últimos 10 registros) ───────────────────────────────────────── */
async function refreshRecientes() {
  const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const currentTenantId = user.tenant_id ? String(user.tenant_id) : null;

  if (navigator.onLine) {
    try {
      const res = await porteriaAPI.request('/api/visits?limit=10');
      if (res?.success && Array.isArray(res.data)) {
        for (const v of res.data) {
          await dbVisitas.save({
            ...v,
            tenant_id: v.tenant_id ? String(v.tenant_id) : currentTenantId,
            localId: v.localId || v._id,
            movimiento: v.horaSalida ? 'salida' : 'ingreso',
            syncStatus: 'sincronizado',
          });
        }
      }
    } catch (_) { }
  }

  const recientes = await dbVisitas.getRecientes(10);
  const listEl = document.getElementById('recent-list');
  if (!listEl) return;

  if (!recientes.length) {
    listEl.innerHTML = '<div class="empty-recent">Sin registros en este turno</div>';
    return;
  }

  listEl.innerHTML = recientes.map(v => {
    let extraBadge = '';
    if (v.tipo === 'domicilio' && (v.estadoDomicilio === 'recibido' || v.fechaRecepcion)) {
      extraBadge = '<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:10.5px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:4px;">Recibido</span>';
    }

    return `
    <div class="recent-item">
      <span class="ri-badge ${v.tipo}">${v.tipo}</span>
      <div class="ri-info">
        <div class="ri-name">${v.nombre || v.empresa || (v.placa ? 'Vehículo ' + v.placa : '—')} ${v.placa && v.nombre ? `(${v.placa})` : ''} ${extraBadge}</div>
        <div class="ri-meta">Apto ${v.apartamento} · ${fmtHora(v.movimiento === 'salida' ? (v.horaSalida || v.horaIngreso) : v.horaIngreso)} · <b style="color:${v.movimiento === 'salida' ? '#e53e3e' : '#38a169'}">${(v.movimiento || 'ingreso').toUpperCase()}</b></div>
      </div>
      ${v.syncStatus === 'pendiente'
        ? `<div class="ri-actions"><button class="btn-del" onclick="eliminarVisita(${v.id})" title="Eliminar">✕</button></div>`
        : ''}
    </div>
  `}).join('');
}

/* ─── CENTRO DE CONTROL DE VISITAS ───────────────────────────────────────────── */
let invitacionesActivas = [];

async function loadPendientes() {
  if (!navigator.onLine) {
    document.getElementById('cards-container').innerHTML = '<p style="color:#e53e3e; padding: 20px;">Sin conexión. No se pueden cargar las invitaciones en espera.</p>';
    return;
  }

  const list = await porteriaAPI.obtenerInvitacionesPendientes();
  invitacionesActivas = Array.isArray(list) ? list : [];
  renderTarjetas('');
  updatePendingInvitationsBadge();
}

function renderTarjetas(filtro = '') {
  const container = document.getElementById('cards-container');
  if (!container) return;
  container.innerHTML = '';

  const termo = filtro.toLowerCase();
  const filtradas = invitacionesActivas.filter(inv =>
    (inv.apartamento || '').toLowerCase().includes(termo) ||
    (inv.nombreVisitante || '').toLowerCase().includes(termo)
  );

  if (filtradas.length === 0) {
    container.innerHTML = '<div class="empty-recent" style="padding:24px 0;">No hay invitaciones en espera</div>';
    return;
  }

  filtradas.forEach(inv => {
    const card = document.createElement('div');
    card.className = 'history-item';
    card.style.cursor = 'pointer';
    card.style.borderLeftColor = 'var(--acento)';
    card.style.marginBottom = '8px';

    const fechaCaducidad = new Date(inv.tiempo_caducidad);
    const hh = fechaCaducidad.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const dd = fechaCaducidad.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
    const fmtCaduca = isNaN(fechaCaducidad.getTime()) ? 'N/A' : `${dd} ${hh}`;

    card.innerHTML = `
      <div class="hi-info">
        <div class="hi-name">${inv.nombreVisitante}</div>
        <div class="hi-apto">Apto ${inv.apartamento} &middot; ${inv.personasEsperadas || 1} persona(s) &middot; Vence ${fmtCaduca}</div>
      </div>
      <div style="background:var(--bg); border:1px solid var(--border); border-radius:var(--radius); padding:6px 12px; font-family:monospace; font-weight:700; font-size:16px; letter-spacing:4px; color:var(--text); flex-shrink:0;">${inv.codigo}</div>
    `;

    card.addEventListener('click', () => {
      const codigoInput = document.getElementById('codigo-input');
      if (codigoInput) {
        codigoInput.value = inv.codigo;
        codigoInput.focus();
        codigoInput.style.borderColor = 'var(--acento)';
      }
    });

    container.appendChild(card);
  });
}

function filtrarTarjetas(e) {
  renderTarjetas(e.target.value);
}

async function verificarCodigoCentro() {
  const code = document.getElementById('codigo-input').value.trim();
  if (code.length < 6) return alert('Por favor, ingrese un código válido de 6 dígitos.');

  if (!navigator.onLine) return alert('Se requiere conexión para verificar códigos.');

  try {
    const btn = document.getElementById('btn-verificar');
    btn.disabled = true;
    btn.textContent = 'Verificando...';

    // Llamar a verificar-codigo primero
    const res = await porteriaAPI.request('/api/visits/verificar-codigo', {
      method: 'POST',
      body: JSON.stringify({ codigo: code })
    });

    if (!res.success) {
      throw new Error(res.message);
    }

    const inv = res.data.invitation;
    let selectedInvMode = 'pie';

    const html = `
      <!-- Tarjeta resumen del visitante -->
      <div style="background:var(--bg); border-radius:var(--radius); padding:16px; margin-bottom:14px; border:1px solid var(--border);">
        <div class="ri-badge visita" style="margin-bottom:10px; display:inline-block;">Invitación válida</div>
        <div style="font-size:16px; font-weight:700; color:var(--text); margin-bottom:4px;">${escHtml(inv.nombreVisitante)}</div>
        <div style="font-size:13px; color:var(--text-muted);">Apto <strong>${escHtml(inv.apartamento)}</strong></div>
        <div style="margin-top:12px; display:flex; gap:16px;">
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;">Personas</div>
            <div style="font-size:15px; font-weight:600;">${inv.personasEsperadas || 1}</div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;">Cédula</div>
            <div style="font-size:15px; font-weight:600;">${escHtml(inv.cedulaVisitante || '—')}</div>
          </div>
        </div>
      </div>

      <!-- Selector de Modo: A pie / En vehículo -->
      <div class="form-field" style="margin-bottom:12px;">
        <label style="font-weight:700; margin-bottom:6px; display:block;">¿Cómo ingresa el visitante? *</label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <button type="button" class="btn-mode-inv active" id="btn-inv-pie" style="padding:10px; border-radius:8px; border:1.5px solid var(--acento, #2563eb); background:rgba(37,99,235,0.08); color:var(--text); font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
            A pie
          </button>
          <button type="button" class="btn-mode-inv" id="btn-inv-vehiculo" style="padding:10px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--text-muted); font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
            En vehículo
          </button>
        </div>
      </div>

      <!-- Bloque de datos del vehículo -->
      <div id="box-inv-vehiculo" style="display:none; padding:12px; border-radius:var(--radius); background:var(--bg); border:1px solid var(--border); margin-bottom:14px;">
        <div class="form-row" style="margin-bottom:8px;">
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Tipo *</label>
            <select id="f-inv-veh-tipo" style="width:100%; padding:8px; font-size:13px;">
              <option value="Carro">Carro</option>
              <option value="Motocicleta">Motocicleta</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Placa *</label>
            <input type="text" id="f-inv-veh-placa" placeholder="PLACA" style="width:100%; padding:8px; font-size:13px; text-transform:uppercase; font-family:monospace; font-weight:700;">
          </div>
        </div>
        <div class="form-row">
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Marca (opcional)</label>
            <input type="text" id="f-inv-veh-marca" placeholder="Ej. Renault" style="width:100%; padding:8px; font-size:13px;">
          </div>
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Modelo (opcional)</label>
            <input type="text" id="f-inv-veh-modelo" placeholder="Ej. Sandero" style="width:100%; padding:8px; font-size:13px;">
          </div>
        </div>
      </div>

      <div id="f-inv-error" class="form-error" style="display:none; margin-bottom:10px;"></div>

      <button id="btn-confirmar-ingreso-inv" class="btn-action">
        Confirmar Ingreso
      </button>
    `;

    openDrawer('Confirmar Invitación', html);

    const btnInvPie = document.getElementById('btn-inv-pie');
    const btnInvVeh = document.getElementById('btn-inv-vehiculo');
    const boxInvVeh = document.getElementById('box-inv-vehiculo');

    btnInvPie.addEventListener('click', () => {
      selectedInvMode = 'pie';
      btnInvPie.style.borderColor = 'var(--acento, #2563eb)';
      btnInvPie.style.background = 'rgba(37,99,235,0.08)';
      btnInvPie.style.color = 'var(--text)';
      btnInvVeh.style.borderColor = 'var(--border)';
      btnInvVeh.style.background = 'var(--bg)';
      btnInvVeh.style.color = 'var(--text-muted)';
      boxInvVeh.style.display = 'none';
    });

    btnInvVeh.addEventListener('click', () => {
      selectedInvMode = 'vehiculo';
      btnInvVeh.style.borderColor = 'var(--acento, #2563eb)';
      btnInvVeh.style.background = 'rgba(37,99,235,0.08)';
      btnInvVeh.style.color = 'var(--text)';
      btnInvPie.style.borderColor = 'var(--border)';
      btnInvPie.style.background = 'var(--bg)';
      btnInvPie.style.color = 'var(--text-muted)';
      boxInvVeh.style.display = 'block';
      document.getElementById('f-inv-veh-placa')?.focus();
    });

    document.getElementById('btn-confirmar-ingreso-inv').addEventListener('click', async () => {
      const errEl = document.getElementById('f-inv-error');
      errEl.style.display = 'none';

      let placa = null;
      let tipoVehiculo = null;
      let marcaVehiculo = null;
      let modeloVehiculo = null;

      if (selectedInvMode === 'vehiculo') {
        tipoVehiculo = document.getElementById('f-inv-veh-tipo')?.value || 'Carro';
        const rawPlaca = document.getElementById('f-inv-veh-placa')?.value || '';
        marcaVehiculo = document.getElementById('f-inv-veh-marca')?.value.trim() || null;
        modeloVehiculo = document.getElementById('f-inv-veh-modelo')?.value.trim() || null;

        const valPlaca = validarPlacaVehiculo(tipoVehiculo, rawPlaca);
        if (!valPlaca.valida) {
          errEl.textContent = valPlaca.mensaje;
          errEl.style.display = 'block';
          return;
        }
        placa = valPlaca.cleanPlaca;
      }

      try {
        const btnConfirm = document.getElementById('btn-confirmar-ingreso-inv');
        btnConfirm.disabled = true;
        btnConfirm.textContent = 'Registrando...';

        const regRes = await porteriaAPI.request('/api/visits/registrar-ingreso', {
          method: 'POST',
          body: JSON.stringify({
            codigo: code,
            modo: selectedInvMode,
            placa,
            tipoVehiculo,
            marcaVehiculo,
            modeloVehiculo,
          })
        });

        if (!regRes.success) throw new Error(regRes.message);

        const visit = regRes.data?.visit;
        if (visit) {
          visit.syncStatus = 'sincronizado';
          visit.localId = visit._id;
          await db.visitas.put(visit);
        }

        closeDrawer();
        showToast('Visita confirmada y registrada exitosamente');

        // Remover de la lista activa localmente, recargar historial
        invitacionesActivas = invitacionesActivas.filter(i => i.codigo !== code);
        document.getElementById('codigo-input').value = '';
        renderTarjetas(document.getElementById('search-invitations')?.value || '');
        updatePendingInvitationsBadge();

        // Si queremos regresar y actualizar recientes
        navigate('main');
        await refreshRecientes();
        await updateAllBadges();
      } catch (err) {
        errEl.textContent = err.message || 'Error al registrar.';
        errEl.style.display = 'block';
      } finally {
        const btnConfirm = document.getElementById('btn-confirmar-ingreso-inv');
        if (btnConfirm) {
          btnConfirm.disabled = false;
          btnConfirm.textContent = 'Confirmar Ingreso';
        }
      }
    });

  } catch (err) {
    alert(err.message || 'Error al procesar. Verifique código o caducidad.');
  } finally {
    const btn = document.getElementById('btn-verificar');
    btn.disabled = false;
    btn.textContent = 'Verificar e Ingresar';
  }
}

/* ─── CENTRO DE CONTROL DE SALIDAS DE VISITANTES ────────────────────────────── */
let visitantesActivosList = [];

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updatePendingInvitationsBadge() {
  const count = Array.isArray(invitacionesActivas) ? invitacionesActivas.length : 0;
  const badge = document.getElementById('badge-invitaciones-pendientes');
  if (badge) {
    if (count > 0) {
      badge.textContent = `${count} ${count === 1 ? 'pendiente' : 'pendientes'}`;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function updatePendingInvitationsCount() {
  try {
    const list = await porteriaAPI.obtenerInvitacionesPendientes();
    invitacionesActivas = Array.isArray(list) ? list : [];
    updatePendingInvitationsBadge();
  } catch (_) { }
}

async function updateActiveVisitorsCount() {
  try {
    const list = await porteriaAPI.obtenerVisitantesActivos();
    visitantesActivosList = Array.isArray(list) ? list : [];
    const badge = document.getElementById('badge-visitantes-dentro');
    if (badge) {
      if (visitantesActivosList.length > 0) {
        badge.textContent = `${visitantesActivosList.length} adentro`;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (_) { }
}

async function updateActiveResidentsCount() {
  try {
    const list = await porteriaAPI.obtenerResidentesActivos();
    residentesActivosList = Array.isArray(list) ? list : [];
    const badge = document.getElementById('badge-residentes-dentro');
    if (badge) {
      if (residentesActivosList.length > 0) {
        badge.textContent = `${residentesActivosList.length} adentro`;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (_) { }
}

async function updateAllBadges() {
  await Promise.all([
    updateActiveVisitorsCount(),
    updateActiveResidentsCount(),
    updatePendingInvitationsCount(),
  ]);
}

/* ─── SALIDAS DE RESIDENTES ─────────────────────────────────────────────────── */
async function loadSalidasResidentes() {
  const container = document.getElementById('salidas-residentes-cards-container');
  if (container) {
    container.innerHTML = '<div class="empty-recent" style="padding:24px 0;">Cargando residentes activos…</div>';
  }
  await updateActiveResidentsCount();
  renderTarjetasSalidasResidentes(document.getElementById('search-salidas-res')?.value || '');
}

function renderTarjetasSalidasResidentes(filtro = '') {
  const container = document.getElementById('salidas-residentes-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const termo = filtro.toLowerCase().trim();
  const filtradas = residentesActivosList.filter(v =>
    (v.apartamento || '').toLowerCase().includes(termo) ||
    (v.nombre || '').toLowerCase().includes(termo) ||
    (v.cedula || '').toLowerCase().includes(termo)
  );

  if (filtradas.length === 0) {
    container.innerHTML = '<div class="empty-recent" style="padding:28px 0;">No hay residentes activos dentro del conjunto</div>';
    return;
  }

  const fmtHoraLocal = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return String(d);
    }
  };

  const calcularTiempo = (d) => {
    if (!d) return '';
    try {
      const diff = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
      if (diff < 60) return `hace ${diff} min`;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return `hace ${h}h ${m}m`;
    } catch (_) {
      return '';
    }
  };

  filtradas.forEach(v => {
    const card = document.createElement('div');
    card.className = 'history-item';
    card.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-left:4px solid #8b5cf6; margin-bottom:10px; padding:14px 16px; background:var(--white); border-radius:var(--radius); box-shadow:var(--shadow-xs); gap:12px;';

    const nombreResidente = v.nombre && v.nombre.trim() ? v.nombre : 'Residente';
    const cedulaResidente = v.cedula && v.cedula.trim() ? v.cedula : '—';
    const aptoResidente = v.apartamento || '—';
    const tiempoTxt = calcularTiempo(v.horaIngreso);

    const typeBadge = `<span class="ri-badge" style="background:#ede9fe; color:#6d28d9; font-size:11px; padding:2px 7px; border-radius:4px; font-weight:700; text-transform:uppercase; margin-left:6px;">Residente</span>`;

    card.innerHTML = `
      <div class="hi-info" style="flex:1;">
        <div class="hi-name" style="font-size:15.5px; font-weight:800; color:var(--text); display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
          <span>${escHtml(nombreResidente)}</span>
          ${typeBadge}
        </div>
        <div class="hi-apto" style="font-size:13px; color:var(--text-muted); margin-top:3px;">
          Apto <strong>${escHtml(aptoResidente)}</strong>
          ${v.cedula ? ` &middot; Cédula: <strong>${escHtml(cedulaResidente)}</strong>` : ''}
          ${v.placa ? ` &middot; Placa: <strong>${escHtml(v.placa)}</strong>` : ''}
        </div>
        <div style="font-size:12px; color:var(--text-faint); margin-top:4px;">
          Ingreso: <strong>${fmtHoraLocal(v.horaIngreso)}</strong> ${tiempoTxt ? `<span style="color:#7c3aed; font-weight:600;">(${tiempoTxt})</span>` : ''}
        </div>
      </div>
      <button class="btn-action-sm" style="background:#ede9fe; color:#6d28d9; border:1px solid #ddd6fe; padding:9px 15px; border-radius:8px; font-weight:700; cursor:pointer; flex-shrink:0; font-size:13px; transition:all .15s;">
        Registrar Salida
      </button>
    `;

    const btnSalida = card.querySelector('button');
    btnSalida.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirDrawerSalidaResidente(v);
    });

    container.appendChild(card);
  });
}

function filtrarSalidasResidentes(e) {
  renderTarjetasSalidasResidentes(e.target.value);
}

async function abrirDrawerSalidaResidente(v) {
  const nombreResidente = v.nombre || 'Residente';
  const aptoResidente = v.apartamento || '—';
  const placaIngreso = v.placa || null;
  let selectedModeSalida = placaIngreso ? 'vehiculo' : 'pie';
  let vehiculosResidente = [];

  try {
    const aptoQuery = encodeURIComponent(aptoResidente);
    const vRes = await porteriaAPI.request(`/api/vehicles?apartamento=${aptoQuery}&limit=50`);
    if (vRes?.success && Array.isArray(vRes.data)) {
      vehiculosResidente = vRes.data;
    }
  } catch (_) { }

  const fmtHoraLocal = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return String(d);
    }
  };

  const vehiclesOptionsHtml = vehiculosResidente.map((vh, idx) => {
    const isMismo = placaIngreso && vh.placa && vh.placa.toUpperCase() === placaIngreso.toUpperCase();
    const isChecked = isMismo || (!placaIngreso && idx === 0);
    const isDentro = vh.dentro || vh.estadoAcceso === 'dentro';
    const badgeColor = isDentro ? '#059669' : '#6b7280';
    const badgeBg = isDentro ? 'rgba(5,150,105,0.12)' : 'rgba(107,114,128,0.12)';
    return `
      <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; font-weight:600; cursor:pointer; padding:6px 8px; border-radius:6px; background:var(--white); border:1px solid var(--border);">
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="radio" name="radio-salida-res-placa" value="${vh.placa}" data-tipo="${vh.tipo || 'Carro'}" ${isChecked ? 'checked' : ''}>
          <span><strong>${escHtml(vh.placa || 'Sin placa')}</strong> · ${escHtml(vh.marca || '')} ${escHtml(vh.modelo || '')} (${escHtml(vh.tipo || 'Carro')}) ${isMismo ? '<span style="color:#7c3aed; font-size:11px;">(Ingreso)</span>' : ''}</span>
        </div>
        <span style="font-size:10px; font-weight:700; color:${badgeColor}; background:${badgeBg}; padding:2px 6px; border-radius:4px; white-space:nowrap;">${isDentro ? '● DENTRO' : '○ FUERA'}</span>
      </label>
    `;
  }).join('');

  const html = `
    <div id="f-salida-res-error" class="form-error" style="display:none; margin-bottom:10px;"></div>
    <div style="background:var(--bg); border-radius:var(--radius); padding:14px; margin-bottom:14px; border:1px solid var(--border);">
      <div style="font-size:16px; font-weight:800; color:var(--text);">${escHtml(nombreResidente)}</div>
      <div style="font-size:13px; color:var(--text-muted); margin-top:2px;">
        Apto <strong>${escHtml(aptoResidente)}</strong> ${v.cedula ? `&middot; C.C. <strong>${escHtml(v.cedula)}</strong>` : ''}
      </div>
      <div style="font-size:12px; color:var(--text-faint); margin-top:6px;">
        Ingresó a las <strong>${fmtHoraLocal(v.horaIngreso)}</strong> ${placaIngreso ? `en vehículo (<strong style="font-family:monospace; color:#7c3aed;">${escHtml(placaIngreso)}</strong>)` : 'a pie'}.
      </div>
    </div>

    <!-- Selector de Modo: A pie / En vehículo -->
    <div class="form-field" style="margin-bottom:12px;">
      <label style="font-weight:700; margin-bottom:6px; display:block;">¿Cómo sale el residente? *</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <button type="button" class="btn-mode-salida-res" id="btn-salida-res-pie" style="padding:10px; border-radius:8px; border:${selectedModeSalida === 'pie' ? '1.5px solid #7c3aed' : '1px solid var(--border)'}; background:${selectedModeSalida === 'pie' ? 'rgba(124,58,237,0.08)' : 'var(--bg)'}; color:${selectedModeSalida === 'pie' ? 'var(--text)' : 'var(--text-muted)'}; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M7 21l3-7 3 3v5"/><path d="M17 11l-3-3-3 1-2 5"/></svg>
          A pie
        </button>
        <button type="button" class="btn-mode-salida-res" id="btn-salida-res-vehiculo" style="padding:10px; border-radius:8px; border:${selectedModeSalida === 'vehiculo' ? '1.5px solid #7c3aed' : '1px solid var(--border)'}; background:${selectedModeSalida === 'vehiculo' ? 'rgba(124,58,237,0.08)' : 'var(--bg)'}; color:${selectedModeSalida === 'vehiculo' ? 'var(--text)' : 'var(--text-muted)'}; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="7" cy="21" r="2"/><circle cx="17" cy="21" r="2"/><path d="M14 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/></svg>
          En vehículo
        </button>
      </div>
    </div>

    <!-- Bloque de datos de salida vehicular -->
    <div id="box-vehiculo-salida-res" style="display:${selectedModeSalida === 'vehiculo' ? 'block' : 'none'}; padding:12px; border-radius:var(--radius); background:var(--bg); border:1px solid var(--border); margin-bottom:14px;">
      <label style="font-size:12px; font-weight:700; margin-bottom:6px; display:block;">Seleccionar vehículo de salida:</label>
      <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:10px;">
        ${vehiclesOptionsHtml}
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer; padding:6px 8px; border-radius:6px; background:var(--white); border:1px dashed var(--border);">
          <input type="radio" name="radio-salida-res-placa" id="radio-res-otro-veh" value="otro" ${vehiculosResidente.length === 0 ? 'checked' : ''}>
          <span>Otro vehículo (no vinculado / temporal)</span>
        </label>
      </div>

      <div id="sub-box-res-otro-veh" style="display:${vehiculosResidente.length === 0 ? 'block' : 'none'}; border-top:1px solid var(--border); padding-top:10px;">
        <div class="form-row" style="margin-bottom:8px;">
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Tipo de vehículo</label>
            <select id="f-salida-res-tipo" style="width:100%; padding:8px; font-size:13px;">
              <option value="Carro">Carro</option>
              <option value="Motocicleta">Motocicleta</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Placa de salida *</label>
            <input type="text" id="f-salida-res-placa" placeholder="PLACA" style="width:100%; padding:8px; font-size:13px; text-transform:uppercase; font-family:monospace; font-weight:700;">
          </div>
        </div>
        <div class="form-row" style="margin-bottom:0;">
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Marca (opcional)</label>
            <input type="text" id="f-salida-res-marca" placeholder="Ej. Chevrolet" style="width:100%; padding:8px; font-size:13px;">
          </div>
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Modelo (opcional)</label>
            <input type="text" id="f-salida-res-modelo" placeholder="Ej. Onix" style="width:100%; padding:8px; font-size:13px;">
          </div>
        </div>
      </div>

      <!-- Alerta de autorización para salida vehicular de residente -->
      <div id="box-salida-res-veh-alert" style="display:none; margin-top:10px;"></div>
      <input type="hidden" id="f-salida-res-perm-id" value="">
    </div>

    <button class="btn-action" id="btn-submit-salida-residente" style="background:#7c3aed; color:#fff;">
      Confirmar Salida
    </button>
  `;

  openDrawer(`Salida — ${nombreResidente}`, html);

  const btnPie = document.getElementById('btn-salida-res-pie');
  const btnVeh = document.getElementById('btn-salida-res-vehiculo');
  const boxVeh = document.getElementById('box-vehiculo-salida-res');
  const radios = document.querySelectorAll('input[name="radio-salida-res-placa"]');
  const subBoxOtro = document.getElementById('sub-box-res-otro-veh');
  const alertSalidaResBox = document.getElementById('box-salida-res-veh-alert');
  let salidaResPollInterval = null;
  let salidaResDebounce = null;

  const verificarPlacaSalidaResLive = async (targetPlaca) => {
    if (salidaResPollInterval) {
      clearInterval(salidaResPollInterval);
      salidaResPollInterval = null;
    }
    const cleanPlaca = (targetPlaca || '').replace(/[\s-]/g, '').trim().toUpperCase();
    if (!cleanPlaca || cleanPlaca.length < 3) {
      if (alertSalidaResBox) { alertSalidaResBox.style.display = 'none'; alertSalidaResBox.innerHTML = ''; }
      return;
    }

    try {
      const vRes = await porteriaAPI.request('/api/vehicle-access/buscar-placa', {
        method: 'POST',
        body: JSON.stringify({ placa: cleanPlaca }),
      });

      if (vRes?.success && vRes.data?.registered && vRes.data?.vehicle) {
        const vh = vRes.data.vehicle;
        const resp = vRes.data.responsablePrincipal;
        const autorizados = vRes.data.autorizados || [];
        const propietarios = vRes.data.propietarios || [];

        // Validar si el residente que va a salir está formalmente autorizado
        const isDriverAuthorized = (
          (resp && (String(resp._id) === String(v.resident_id) || String(resp.cedula) === String(v.cedula))) ||
          autorizados.some(a => String(a._id) === String(v.resident_id) || String(a.cedula) === String(v.cedula)) ||
          propietarios.some(p => String(p._id || p) === String(v.resident_id) || String(p.cedula) === String(v.cedula))
        );

        if (!isDriverAuthorized) {
          const titularNombre = resp?.nombre || 'Residente titular';
          const titularApto = resp?.apartamento || vh.apartamento || 'S/N';
          const titularTel = resp?.telefono || '';
          const titularUserId = resp?.user_id || '';

          if (alertSalidaResBox) {
            alertSalidaResBox.style.display = 'block';
            alertSalidaResBox.innerHTML = `
              <div style="background:rgba(245, 158, 11, 0.12); border:1.5px solid #f59e0b; border-radius:8px; padding:12px;">
                <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:#b45309; font-size:13px;">
                  <span style="font-size:16px;"></span>
                  <span>VEHÍCULO REGISTRADO — REQUIERE AUTORIZACIÓN DE SALIDA</span>
                </div>
                <div style="font-size:12px; color:#92400e; margin-top:4px; line-height:1.4;">
                  Este vehículo (<strong>${escHtml(vh.placa || cleanPlaca)}</strong>) pertenece al Apto <strong>${escHtml(titularApto)}</strong> &middot; Titular: <strong>${escHtml(titularNombre)}</strong>.
                  <br><span style="color:#b91c1c; font-weight:700;">El residente ${escHtml(nombreResidente)} no figura como conductor autorizado de esta placa.</span>
                </div>
                <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
                  ${titularTel ? `
                    <a href="tel:${titularTel}" class="btn-action-sm" style="background:#059669; color:#fff; text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:6px; font-size:12px; font-weight:700; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
                       Llamar a ${escHtml(titularNombre)} (${escHtml(titularTel)})
                    </a>
                  ` : '<span style="font-size:11px; color:var(--text-muted);">Sin teléfono registrado</span>'}
                  <button type="button" id="btn-request-salida-res-perm" class="btn-action-sm" style="background:#d97706; color:#fff; border:none; border-radius:6px; padding:7px 12px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                     Pedir autorización de salida al titular
                  </button>
                </div>
                <div id="salida-res-live-poll-status" style="margin-top:10px; font-size:13px; font-weight:700; display:none;"></div>
              </div>
            `;

            document.getElementById('btn-request-salida-res-perm')?.addEventListener('click', async () => {
              const statusTag = document.getElementById('salida-res-live-poll-status');
              if (statusTag) {
                statusTag.style.display = 'block';
                statusTag.innerHTML = `<span style="color:#d97706;"> Enviando solicitud de salida al residente...</span>`;
              }

              try {
                const authReq = await porteriaAPI.request('/api/notifications/request-auth', {
                  method: 'POST',
                  body: JSON.stringify({
                    user_id: titularUserId,
                    apartamento: titularApto,
                    visitorName: nombreResidente,
                    cedula: v.cedula || '',
                    tipo: 'permiso_vehiculo',
                    placa: vh.placa || cleanPlaca,
                    vehicle_id: vh._id,
                    accion: 'salida',
                  }),
                });

                if (!authReq?.success) throw new Error(authReq?.message || 'Error al enviar solicitud');

                const notifId = authReq.data.notification_id;
                const permId = authReq.data.permission_id;
                if (permId) {
                  const fPerm = document.getElementById('f-salida-res-perm-id');
                  if (fPerm) fPerm.value = permId;
                }

                if (statusTag) {
                  statusTag.innerHTML = `
                    <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:6px; padding:8px 10px; color:#92400e; display:flex; align-items:center; gap:8px;">
                      <span class="spinner-inline" style="display:inline-block; width:14px; height:14px; border:2px solid #d97706; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span>
                      <span>Esperando respuesta de salida de <strong>${escHtml(titularNombre)}</strong> en tiempo real...</span>
                    </div>`;
                }

                salidaResPollInterval = setInterval(async () => {
                  try {
                    const st = await porteriaAPI.request(`/api/notifications/${notifId}/status`);
                    if (st?.success && st.data) {
                      const curStatus = st.data.status;
                      if (curStatus === 'aprobado') {
                        clearInterval(salidaResPollInterval);
                        salidaResPollInterval = null;
                        if (statusTag) {
                          statusTag.innerHTML = `
                            <div style="background:#dcfce7; border:1.5px solid #16a34a; border-radius:6px; padding:10px; color:#15803d; font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px;">
                              <span style="font-size:18px;"></span>
                              <span>¡SALIDA AUTORIZADA POR EL TITULAR DEL VEHÍCULO!</span>
                            </div>`;
                        }
                      } else if (curStatus === 'rechazado') {
                        clearInterval(salidaResPollInterval);
                        salidaResPollInterval = null;
                        if (statusTag) {
                          statusTag.innerHTML = `
                            <div style="background:#fee2e2; border:1.5px solid #dc2626; border-radius:6px; padding:10px; color:#991b1b; font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px;">
                              <span style="font-size:18px;"></span>
                              <span>SALIDA RECHAZADA POR EL TITULAR DEL VEHÍCULO</span>
                            </div>`;
                        }
                      }
                    }
                  } catch (_) { }
                }, 2500);

              } catch (err) {
                if (statusTag) {
                  statusTag.innerHTML = `<span style="color:#dc2626;">Error: ${escHtml(err.message)}</span>`;
                }
              }
            });
          }
        } else {
          if (alertSalidaResBox) { alertSalidaResBox.style.display = 'none'; alertSalidaResBox.innerHTML = ''; }
        }
      } else {
        if (alertSalidaResBox) { alertSalidaResBox.style.display = 'none'; alertSalidaResBox.innerHTML = ''; }
      }
    } catch (_) {
      if (alertSalidaResBox) { alertSalidaResBox.style.display = 'none'; alertSalidaResBox.innerHTML = ''; }
    }
  };

  const updateSalidaMode = (mode) => {
    selectedModeSalida = mode;
    if (mode === 'pie') {
      btnPie.style.borderColor = '#7c3aed';
      btnPie.style.background = 'rgba(124,58,237,0.08)';
      btnPie.style.color = 'var(--text)';
      btnVeh.style.borderColor = 'var(--border)';
      btnVeh.style.background = 'var(--bg)';
      btnVeh.style.color = 'var(--text-muted)';
      boxVeh.style.display = 'none';
      if (alertSalidaResBox) { alertSalidaResBox.style.display = 'none'; alertSalidaResBox.innerHTML = ''; }
      if (salidaResPollInterval) { clearInterval(salidaResPollInterval); salidaResPollInterval = null; }
    } else {
      btnVeh.style.borderColor = '#7c3aed';
      btnVeh.style.background = 'rgba(124,58,237,0.08)';
      btnVeh.style.color = 'var(--text)';
      btnPie.style.borderColor = 'var(--border)';
      btnPie.style.background = 'var(--bg)';
      btnPie.style.color = 'var(--text-muted)';
      boxVeh.style.display = 'block';

      const selRadio = document.querySelector('input[name="radio-salida-res-placa"]:checked');
      if (selRadio) {
        if (selRadio.value === 'otro') {
          verificarPlacaSalidaResLive(document.getElementById('f-salida-res-placa')?.value);
        } else {
          verificarPlacaSalidaResLive(selRadio.value);
        }
      }
    }
  };

  btnPie.addEventListener('click', () => updateSalidaMode('pie'));
  btnVeh.addEventListener('click', () => updateSalidaMode('vehiculo'));

  radios.forEach(r => {
    r.addEventListener('change', () => {
      if (r.value === 'otro') {
        subBoxOtro.style.display = 'block';
        document.getElementById('f-salida-res-placa')?.focus();
        verificarPlacaSalidaResLive(document.getElementById('f-salida-res-placa')?.value);
      } else {
        subBoxOtro.style.display = 'none';
        verificarPlacaSalidaResLive(r.value);
      }
    });
  });

  const inpPlacaRes = document.getElementById('f-salida-res-placa');
  if (inpPlacaRes) {
    inpPlacaRes.addEventListener('input', (e) => {
      clearTimeout(salidaResDebounce);
      salidaResDebounce = setTimeout(() => {
        verificarPlacaSalidaResLive(e.target.value);
      }, 300);
    });
  }

  // Comprobación inicial de placa al abrir si sale en vehículo
  if (selectedModeSalida === 'vehiculo') {
    const checkedRadio = document.querySelector('input[name="radio-salida-res-placa"]:checked');
    if (checkedRadio && checkedRadio.value !== 'otro') {
      verificarPlacaSalidaResLive(checkedRadio.value);
    }
  }

  document.getElementById('btn-submit-salida-residente').addEventListener('click', async () => {
    const errEl = document.getElementById('f-salida-res-error');
    errEl.style.display = 'none';

    let placaSalidaFinal = null;
    let tipoVehiculoSalida = 'Carro';
    let vehiculoSalidaNuevo = null;

    if (selectedModeSalida === 'vehiculo') {
      const selectedRadio = document.querySelector('input[name="radio-salida-res-placa"]:checked');
      if (!selectedRadio) {
        errEl.textContent = 'Debes seleccionar o ingresar un vehículo';
        errEl.style.display = 'block';
        return;
      }
      if (selectedRadio.value === 'otro') {
        const inpPlaca = document.getElementById('f-salida-res-placa')?.value || '';
        tipoVehiculoSalida = document.getElementById('f-salida-res-tipo')?.value || 'Carro';
        const valPlaca = validarPlacaVehiculo(tipoVehiculoSalida, inpPlaca);
        if (!valPlaca.valida) {
          errEl.textContent = valPlaca.mensaje;
          errEl.style.display = 'block';
          return;
        }
        placaSalidaFinal = valPlaca.cleanPlaca;
        vehiculoSalidaNuevo = {
          tipo: tipoVehiculoSalida,
          placa: valPlaca.cleanPlaca,
          marca: document.getElementById('f-salida-res-marca')?.value.trim(),
          modelo: document.getElementById('f-salida-res-modelo')?.value.trim(),
        };
      } else {
        placaSalidaFinal = selectedRadio.value;
        tipoVehiculoSalida = selectedRadio.dataset.tipo || 'Carro';
      }
    }

    const btnSubmit = document.getElementById('btn-submit-salida-residente');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Registrando salida…';

    try {
      const exitData = {
        modoSalida: selectedModeSalida,
        placaSalida: placaSalidaFinal,
        tipoVehiculoSalida,
        vehiculoSalidaNuevo,
        permission_id: document.getElementById('f-salida-res-perm-id')?.value || null,
      };

      const res = await porteriaAPI.registrarSalidaVisita(v._id || v.localId, exitData);
      if (res?.success) {
        if (salidaResPollInterval) { clearInterval(salidaResPollInterval); salidaResPollInterval = null; }
        closeDrawer();
        showToast(`Salida registrada: ${nombreResidente} (Apto ${aptoResidente})`);
        await loadSalidasResidentes();
        await refreshRecientes();
        await updateAllBadges();
      } else {
        errEl.textContent = res?.message || 'Error al registrar la salida';
        errEl.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Salida';
      }
    } catch (err) {
      errEl.textContent = err.message || 'Error de conexión';
      errEl.style.display = 'block';
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Confirmar Salida';
    }
  });
}

async function loadSalidasVisitantes() {
  const container = document.getElementById('salidas-cards-container');
  if (container) {
    container.innerHTML = '<div class="empty-recent" style="padding:24px 0;">Cargando visitantes activos…</div>';
  }
  await updateActiveVisitorsCount();
  renderTarjetasSalidas(document.getElementById('search-salidas')?.value || '');
}

function renderTarjetasSalidas(filtro = '') {
  const container = document.getElementById('salidas-cards-container');
  if (!container) return;
  container.innerHTML = '';

  const termo = filtro.toLowerCase().trim();
  const filtradas = visitantesActivosList.filter(v =>
    (v.apartamento || '').toLowerCase().includes(termo) ||
    (v.nombre || '').toLowerCase().includes(termo) ||
    (v.empresa || '').toLowerCase().includes(termo) ||
    (v.cedula || '').toLowerCase().includes(termo) ||
    (v.tipo || '').toLowerCase().includes(termo)
  );

  if (filtradas.length === 0) {
    container.innerHTML = '<div class="empty-recent" style="padding:28px 0;">No hay visitantes ni domicilios activos dentro del conjunto</div>';
    return;
  }

  const fmtHoraLocal = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return String(d);
    }
  };

  const calcularTiempo = (d) => {
    if (!d) return '';
    try {
      const diff = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
      if (diff < 60) return `hace ${diff} min`;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      return `hace ${h}h ${m}m`;
    } catch (_) {
      return '';
    }
  };

  filtradas.forEach(v => {
    const card = document.createElement('div');
    card.className = 'history-item';
    card.style.cssText = 'display:flex; justify-content:space-between; align-items:center; border-left:4px solid #ef4444; margin-bottom:10px; padding:14px 16px; background:var(--white); border-radius:var(--radius); box-shadow:var(--shadow-xs); gap:12px;';

    const isDom = v.tipo === 'domicilio';
    const isRecibido = isDom && (v.estadoDomicilio === 'recibido' || v.fechaRecepcion);
    const nombreVisitante = isDom
      ? (v.empresa ? `${v.empresa}${v.nombre ? ' (' + v.nombre + ')' : ''}` : (v.nombre || 'Domicilio'))
      : (v.nombre && v.nombre.trim() ? v.nombre : 'Visitante');

    const cedulaVisitante = v.cedula && v.cedula.trim() ? v.cedula : '—';
    const aptoVisitante = v.apartamento || '—';
    const tiempoTxt = calcularTiempo(v.horaIngreso);

    const typeBadge = isDom
      ? `<span class="ri-badge domicilio" style="font-size:11px; padding:2px 7px; border-radius:4px; font-weight:700; text-transform:uppercase; margin-left:6px;">Domicilio</span>${isRecibido ? '<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:4px;">Recibido por residente</span>' : ''}`
      : `<span class="ri-badge visita" style="font-size:11px; padding:2px 7px; border-radius:4px; font-weight:700; text-transform:uppercase; margin-left:6px;">Visita</span>`;

    card.innerHTML = `
      <div class="hi-info" style="flex:1;">
        <div class="hi-name" style="font-size:15.5px; font-weight:800; color:var(--text); display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
          <span>${escHtml(nombreVisitante)}</span>
          ${typeBadge}
        </div>
        <div class="hi-apto" style="font-size:13px; color:var(--text-muted); margin-top:3px;">
          Apto <strong>${escHtml(aptoVisitante)}</strong>
          ${v.cedula ? ` &middot; Cédula: <strong>${escHtml(cedulaVisitante)}</strong>` : ''}
          ${v.placa ? ` &middot; Placa: <strong>${escHtml(v.placa)}</strong>` : ''}
        </div>
        <div style="font-size:12px; color:var(--text-faint); margin-top:4px;">
          Ingreso: <strong>${fmtHoraLocal(v.horaIngreso)}</strong> ${tiempoTxt ? `<span style="color:#b91c1c; font-weight:600;">(${tiempoTxt})</span>` : ''}
        </div>
      </div>
      <button class="btn-action-sm" style="background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; padding:9px 15px; border-radius:8px; font-weight:700; cursor:pointer; flex-shrink:0; font-size:13px; transition:all .15s;">
        Registrar Salida
      </button>
    `;

    const btnSalida = card.querySelector('button');
    btnSalida.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirDrawerSalidaVisitante(v);
    });

    container.appendChild(card);
  });
}

function filtrarSalidas(e) {
  renderTarjetasSalidas(e.target.value);
}

function abrirDrawerSalidaVisitante(v) {
  const isDom = v.tipo === 'domicilio';
  const nombreVisitante = isDom
    ? (v.empresa ? `${v.empresa}${v.nombre ? ' (' + v.nombre + ')' : ''}` : (v.nombre || 'Domicilio'))
    : (v.nombre && v.nombre.trim() ? v.nombre : 'Visitante');
  const aptoVisitante = v.apartamento || '—';
  const placaIngreso = v.placa || null;
  let selectedModeSalida = placaIngreso ? 'vehiculo' : 'pie';

  const fmtHoraLocal = (d) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return String(d);
    }
  };

  const html = `
    <div id="f-salida-error" class="form-error" style="display:none; margin-bottom:10px;"></div>
    <div style="background:var(--bg); border-radius:var(--radius); padding:14px; margin-bottom:14px; border:1px solid var(--border);">
      <div style="font-size:16px; font-weight:800; color:var(--text);">${escHtml(nombreVisitante)}</div>
      <div style="font-size:13px; color:var(--text-muted); margin-top:2px;">
        Apto <strong>${escHtml(aptoVisitante)}</strong> ${v.cedula ? `&middot; C.C. <strong>${escHtml(v.cedula)}</strong>` : ''}
      </div>
      <div style="font-size:12px; color:var(--text-faint); margin-top:6px;">
        Ingresó a las <strong>${fmtHoraLocal(v.horaIngreso)}</strong> ${placaIngreso ? `en vehículo (<strong style="font-family:monospace; color:var(--acento);">${escHtml(placaIngreso)}</strong>)` : 'a pie'}.
      </div>
    </div>

    <!-- Selector de Modo: A pie / En vehículo -->
    <div class="form-field" style="margin-bottom:12px;">
      <label style="font-weight:700; margin-bottom:6px; display:block;">¿Cómo sale el visitante? *</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <button type="button" class="btn-mode-salida ${selectedModeSalida === 'pie' ? 'active' : ''}" id="btn-salida-pie" style="padding:10px; border-radius:8px; border:${selectedModeSalida === 'pie' ? '1.5px solid var(--acento, #2563eb)' : '1px solid var(--border)'}; background:${selectedModeSalida === 'pie' ? 'rgba(37,99,235,0.08)' : 'var(--bg)'}; color:${selectedModeSalida === 'pie' ? 'var(--text)' : 'var(--text-muted)'}; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M7 21l3-7 3 3v5"/><path d="M17 11l-3-3-3 1-2 5"/></svg>
          A pie
        </button>
        <button type="button" class="btn-mode-salida ${selectedModeSalida === 'vehiculo' ? 'active' : ''}" id="btn-salida-vehiculo" style="padding:10px; border-radius:8px; border:${selectedModeSalida === 'vehiculo' ? '1.5px solid var(--acento, #2563eb)' : '1px solid var(--border)'}; background:${selectedModeSalida === 'vehiculo' ? 'rgba(37,99,235,0.08)' : 'var(--bg)'}; color:${selectedModeSalida === 'vehiculo' ? 'var(--text)' : 'var(--text-muted)'}; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="7" cy="21" r="2"/><circle cx="17" cy="21" r="2"/><path d="M14 11V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4"/></svg>
          En vehículo
        </button>
      </div>
    </div>

    <!-- Bloque de datos de salida vehicular -->
    <div id="box-vehiculo-salida" style="display:${selectedModeSalida === 'vehiculo' ? 'block' : 'none'}; padding:12px; border-radius:var(--radius); background:var(--bg); border:1px solid var(--border); margin-bottom:14px;">
      ${placaIngreso ? `
        <div style="margin-bottom:10px; display:flex; flex-direction:column; gap:6px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer;">
            <input type="radio" name="radio-salida-placa" id="radio-mismo-veh" value="mismo" checked>
            <span>Mismo vehículo de ingreso (<strong style="font-family:monospace; color:var(--acento);">${escHtml(placaIngreso)}</strong>)</span>
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer;">
            <input type="radio" name="radio-salida-placa" id="radio-otro-veh" value="otro">
            <span>Salir en otro vehículo</span>
          </label>
        </div>
      ` : ''}

      <div id="sub-box-otro-veh" style="display:${placaIngreso ? 'none' : 'block'};">
        <div class="form-row" style="margin-bottom:0;">
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Tipo de vehículo</label>
            <select id="f-salida-tipo" style="width:100%; padding:8px; font-size:13px;">
              <option value="Carro">Carro</option>
              <option value="Motocicleta">Motocicleta</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div class="form-field" style="margin-bottom:0;">
            <label style="font-size:12px;">Placa de salida *</label>
            <input type="text" id="f-salida-placa" placeholder="PLACA" style="width:100%; padding:8px; font-size:13px; text-transform:uppercase; font-family:monospace; font-weight:700;">
          </div>
        </div>
      </div>

      <!-- Alerta de autorización para salida vehicular de visitante -->
      <div id="box-salida-vis-veh-alert" style="display:none; margin-top:10px;"></div>
      <input type="hidden" id="f-salida-vis-perm-id" value="">
    </div>

    <button class="btn-action" id="btn-submit-salida-visita" style="background:#dc2626; color:#fff;">
      Confirmar Salida
    </button>
  `;

  openDrawer(`Salida — ${nombreVisitante}`, html);

  const btnPie = document.getElementById('btn-salida-pie');
  const btnVeh = document.getElementById('btn-salida-vehiculo');
  const boxVeh = document.getElementById('box-vehiculo-salida');
  const radioMismo = document.getElementById('radio-mismo-veh');
  const radioOtro = document.getElementById('radio-otro-veh');
  const subBoxOtro = document.getElementById('sub-box-otro-veh');
  const alertSalidaVisBox = document.getElementById('box-salida-vis-veh-alert');
  let salidaVisPollInterval = null;
  let salidaVisDebounce = null;

  const verificarPlacaSalidaVisLive = async (targetPlaca) => {
    if (salidaVisPollInterval) {
      clearInterval(salidaVisPollInterval);
      salidaVisPollInterval = null;
    }
    const cleanPlaca = (targetPlaca || '').replace(/[\s-]/g, '').trim().toUpperCase();
    if (!cleanPlaca || cleanPlaca.length < 3) {
      if (alertSalidaVisBox) { alertSalidaVisBox.style.display = 'none'; alertSalidaVisBox.innerHTML = ''; }
      return;
    }

    try {
      const vRes = await porteriaAPI.request('/api/vehicle-access/buscar-placa', {
        method: 'POST',
        body: JSON.stringify({ placa: cleanPlaca }),
      });

      if (vRes?.success && vRes.data?.registered && vRes.data?.vehicle) {
        const vh = vRes.data.vehicle;
        const resp = vRes.data.responsablePrincipal;
        const titularNombre = resp?.nombre || 'Residente titular';
        const titularApto = resp?.apartamento || vh.apartamento || 'S/N';
        const titularTel = resp?.telefono || '';
        const titularUserId = resp?.user_id || '';

        if (alertSalidaVisBox) {
          alertSalidaVisBox.style.display = 'block';
          alertSalidaVisBox.innerHTML = `
            <div style="background:rgba(245, 158, 11, 0.12); border:1.5px solid #f59e0b; border-radius:8px; padding:12px;">
              <div style="display:flex; align-items:center; gap:8px; font-weight:800; color:#b45309; font-size:13px;">
                <span style="font-size:16px;"></span>
                <span>VEHÍCULO REGISTRADO — SALIDA DE VISITANTE</span>
              </div>
              <div style="font-size:12px; color:#92400e; margin-top:4px; line-height:1.4;">
                Este vehículo (<strong>${escHtml(vh.placa || cleanPlaca)}</strong>) pertenece al Apto <strong>${escHtml(titularApto)}</strong> &middot; Titular: <strong>${escHtml(titularNombre)}</strong>.
                <br>El conductor que va a salir es un visitante / persona externa.
              </div>
              <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center;">
                ${titularTel ? `
                  <a href="tel:${titularTel}" class="btn-action-sm" style="background:#059669; color:#fff; text-decoration:none; display:inline-flex; align-items:center; gap:6px; padding:7px 12px; border-radius:6px; font-size:12px; font-weight:700; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
                     Llamar a ${escHtml(titularNombre)} (${escHtml(titularTel)})
                  </a>
                ` : '<span style="font-size:11px; color:var(--text-muted);">Sin teléfono registrado</span>'}
                <button type="button" id="btn-request-salida-vis-perm" class="btn-action-sm" style="background:#d97706; color:#fff; border:none; border-radius:6px; padding:7px 12px; font-size:12px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
                   Pedir autorización de salida al residente
                </button>
              </div>
              <div id="salida-vis-live-poll-status" style="margin-top:10px; font-size:13px; font-weight:700; display:none;"></div>
            </div>
          `;

          document.getElementById('btn-request-salida-vis-perm')?.addEventListener('click', async () => {
            const statusTag = document.getElementById('salida-vis-live-poll-status');
            if (statusTag) {
              statusTag.style.display = 'block';
              statusTag.innerHTML = `<span style="color:#d97706;"> Enviando solicitud de salida al residente...</span>`;
            }

            try {
              const authReq = await porteriaAPI.request('/api/notifications/request-auth', {
                method: 'POST',
                body: JSON.stringify({
                  user_id: titularUserId,
                  apartamento: titularApto,
                  visitorName: nombreVisitante,
                  cedula: v.cedula || '',
                  tipo: 'permiso_vehiculo',
                  placa: vh.placa || cleanPlaca,
                  vehicle_id: vh._id,
                  accion: 'salida',
                }),
              });

              if (!authReq?.success) throw new Error(authReq?.message || 'Error al enviar solicitud');

              const notifId = authReq.data.notification_id;
              const permId = authReq.data.permission_id;
              if (permId) {
                const fPerm = document.getElementById('f-salida-vis-perm-id');
                if (fPerm) fPerm.value = permId;
              }

              if (statusTag) {
                statusTag.innerHTML = `
                  <div style="background:#fef3c7; border:1px solid #f59e0b; border-radius:6px; padding:8px 10px; color:#92400e; display:flex; align-items:center; gap:8px;">
                    <span class="spinner-inline" style="display:inline-block; width:14px; height:14px; border:2px solid #d97706; border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite;"></span>
                    <span>Esperando respuesta de salida de <strong>${escHtml(titularNombre)}</strong> en tiempo real...</span>
                  </div>`;
              }

              salidaVisPollInterval = setInterval(async () => {
                try {
                  const st = await porteriaAPI.request(`/api/notifications/${notifId}/status`);
                  if (st?.success && st.data) {
                    const curStatus = st.data.status;
                    if (curStatus === 'aprobado') {
                      clearInterval(salidaVisPollInterval);
                      salidaVisPollInterval = null;
                      if (statusTag) {
                        statusTag.innerHTML = `
                          <div style="background:#dcfce7; border:1.5px solid #16a34a; border-radius:6px; padding:10px; color:#15803d; font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:18px;"></span>
                            <span>¡SALIDA AUTORIZADA POR EL RESIDENTE!</span>
                          </div>`;
                      }
                    } else if (curStatus === 'rechazado') {
                      clearInterval(salidaVisPollInterval);
                      salidaVisPollInterval = null;
                      if (statusTag) {
                        statusTag.innerHTML = `
                          <div style="background:#fee2e2; border:1.5px solid #dc2626; border-radius:6px; padding:10px; color:#991b1b; font-size:13px; font-weight:800; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:18px;"></span>
                            <span>SALIDA RECHAZADA POR EL RESIDENTE</span>
                          </div>`;
                      }
                    }
                  }
                } catch (_) { }
              }, 2500);

            } catch (err) {
              if (statusTag) {
                statusTag.innerHTML = `<span style="color:#dc2626;">Error: ${escHtml(err.message)}</span>`;
              }
            }
          });
        }
      } else {
        if (alertSalidaVisBox) { alertSalidaVisBox.style.display = 'none'; alertSalidaVisBox.innerHTML = ''; }
      }
    } catch (_) {
      if (alertSalidaVisBox) { alertSalidaVisBox.style.display = 'none'; alertSalidaVisBox.innerHTML = ''; }
    }
  };

  const updateSalidaMode = (mode) => {
    selectedModeSalida = mode;
    if (mode === 'pie') {
      btnPie.style.borderColor = 'var(--acento, #2563eb)';
      btnPie.style.background = 'rgba(37,99,235,0.08)';
      btnPie.style.color = 'var(--text)';
      btnVeh.style.borderColor = 'var(--border)';
      btnVeh.style.background = 'var(--bg)';
      btnVeh.style.color = 'var(--text-muted)';
      boxVeh.style.display = 'none';
      if (alertSalidaVisBox) { alertSalidaVisBox.style.display = 'none'; alertSalidaVisBox.innerHTML = ''; }
      if (salidaVisPollInterval) { clearInterval(salidaVisPollInterval); salidaVisPollInterval = null; }
    } else {
      btnVeh.style.borderColor = 'var(--acento, #2563eb)';
      btnVeh.style.background = 'rgba(37,99,235,0.08)';
      btnVeh.style.color = 'var(--text)';
      btnPie.style.borderColor = 'var(--border)';
      btnPie.style.background = 'var(--bg)';
      btnPie.style.color = 'var(--text-muted)';
      boxVeh.style.display = 'block';

      if (placaIngreso && radioMismo && radioMismo.checked) {
        verificarPlacaSalidaVisLive(placaIngreso);
      } else {
        verificarPlacaSalidaVisLive(document.getElementById('f-salida-placa')?.value);
      }
    }
  };

  btnPie.addEventListener('click', () => updateSalidaMode('pie'));
  btnVeh.addEventListener('click', () => updateSalidaMode('vehiculo'));

  if (radioMismo && radioOtro) {
    radioMismo.addEventListener('change', () => {
      if (radioMismo.checked) {
        subBoxOtro.style.display = 'none';
        verificarPlacaSalidaVisLive(placaIngreso);
      }
    });
    radioOtro.addEventListener('change', () => {
      if (radioOtro.checked) {
        subBoxOtro.style.display = 'block';
        document.getElementById('f-salida-placa')?.focus();
        verificarPlacaSalidaVisLive(document.getElementById('f-salida-placa')?.value);
      }
    });
  }

  const inpPlacaVis = document.getElementById('f-salida-placa');
  if (inpPlacaVis) {
    inpPlacaVis.addEventListener('input', (e) => {
      clearTimeout(salidaVisDebounce);
      salidaVisDebounce = setTimeout(() => {
        verificarPlacaSalidaVisLive(e.target.value);
      }, 300);
    });
  }

  // Comprobación inicial de placa al abrir si sale en vehículo
  if (selectedModeSalida === 'vehiculo' && placaIngreso) {
    verificarPlacaSalidaVisLive(placaIngreso);
  }

  document.getElementById('btn-submit-salida-visita').addEventListener('click', async () => {
    const errEl = document.getElementById('f-salida-error');
    errEl.style.display = 'none';

    let placaSalidaFinal = null;
    let tipoVehiculoSalida = 'Carro';

    if (selectedModeSalida === 'vehiculo') {
      if (placaIngreso && radioMismo && radioMismo.checked) {
        placaSalidaFinal = placaIngreso;
      } else {
        const inpPlaca = document.getElementById('f-salida-placa')?.value || '';
        tipoVehiculoSalida = document.getElementById('f-salida-tipo')?.value || 'Carro';
        const valPlaca = validarPlacaVehiculo(tipoVehiculoSalida, inpPlaca);
        if (!valPlaca.valida) {
          errEl.textContent = valPlaca.mensaje;
          errEl.style.display = 'block';
          return;
        }
        placaSalidaFinal = valPlaca.cleanPlaca;
      }
    }

    const btnSubmit = document.getElementById('btn-submit-salida-visita');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Registrando salida…';

    try {
      const exitData = {
        modoSalida: selectedModeSalida,
        placaSalida: placaSalidaFinal,
        tipoVehiculoSalida,
        permission_id: document.getElementById('f-salida-vis-perm-id')?.value || null,
      };

      const res = await porteriaAPI.registrarSalidaVisita(v._id || v.localId, exitData);
      if (res?.success) {
        if (salidaVisPollInterval) { clearInterval(salidaVisPollInterval); salidaVisPollInterval = null; }
        closeDrawer();
        showToast(`Salida registrada: ${nombreVisitante} (Apto ${aptoVisitante})`);
        await loadSalidasVisitantes();
        await refreshRecientes();
        await updateAllBadges();
      } else {
        errEl.textContent = res?.message || 'Error al registrar la salida';
        errEl.style.display = 'block';
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Confirmar Salida';
      }
    } catch (err) {
      errEl.textContent = err.message || 'Error de conexión';
      errEl.style.display = 'block';
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Confirmar Salida';
    }
  });
}

/* ─── VISITA NO ESPERADA (AUTORIZACIÓN) ──────────────────────────────────────── */
function openSearchResidentForVisit() {
  const html = `
    <div style="padding: 10px;">
      <p style="margin-bottom:10px; font-size:1rem;">Busca el residente al que se dirige la visita:</p>
      <input type="text" id="sr-input" class="search-input" placeholder="Nombre o Cédula" style="width:100%; margin-bottom:15px; font-size:1.1rem;">
      <div id="sr-results" style="max-height: 250px; overflow-y: auto;"></div>
    </div>
  `;
  openDrawer('Buscar Residente', html);

  // Actualizar datos de residentes en background
  if (navigator.onLine) {
    porteriaAPI.request('/api/residents?limit=1000').then(res => {
      if (res && res.success) dbResidentes.cargarDesdeServidor(res.data);
    }).catch(console.warn);
  }

  const srInput = document.getElementById('sr-input');
  srInput.addEventListener('input', async (e) => {
    const q = e.target.value.toLowerCase().trim();
    const resultsContainer = document.getElementById('sr-results');
    if (q.length < 2) {
      resultsContainer.innerHTML = '';
      return;
    }
    const allRes = await db.residentes.toArray();
    const matches = allRes.filter(r =>
      (r.nombre || '').toLowerCase().includes(q) ||
      (r.cedula || '').toLowerCase().includes(q)
    ).slice(0, 10);

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<p style="color:#666;">No se encontraron residentes.</p>';
      return;
    }

    resultsContainer.innerHTML = matches.map(r => `
      <div style="padding: 12px; border: 1px solid #e5e7eb; margin-bottom: 8px; border-radius: 6px; cursor:pointer; background:#f9fafb;" onclick="selectResidentForAuth('${r._id}')">
        <strong style="color:#111827;">${r.nombre}</strong><br>
        <span style="color:#4b5563; font-size:0.9rem;">Cédula: ${r.cedula || 'N/A'} | Apto: ${r.apartamento}</span>
      </div>
    `).join('');
  });
}

window.selectResidentForAuth = async function (id) {
  const resident = await db.residentes.get(id);
  const html = `
    <div style="background:var(--bg); border-radius:var(--radius); padding:16px; margin-bottom:16px; display:flex; align-items:center; gap:14px;">
      <div style="width:48px; height:48px; border-radius:50%; background:var(--acento); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; flex-shrink:0;">${resident.nombre.charAt(0).toUpperCase()}</div>
      <div>
        <div style="font-size:16px; font-weight:700; color:var(--text);">${resident.nombre}</div>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Apto ${resident.apartamento}</div>
        ${resident.telefono ? `<div style="font-size:12px; color:var(--text-muted);">&#128222; ${resident.telefono}</div>` : '<div style="font-size:12px; color:var(--text-muted);">Sin teléfono registrado</div>'}
      </div>
    </div>

    <div class="form-field">
      <label>Nombre del visitante *</label>
      <input type="text" id="sr-visitor-name" placeholder="Ej: María García" autocomplete="off" required>
    </div>

    <div class="form-field">
      <label>Cédula del visitante *</label>
      <input type="text" id="sr-visitor-cedula" placeholder="Número de cédula" inputmode="numeric" required>
    </div>

    <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
      ${resident.telefono ? `
        <a href="tel:${resident.telefono}" class="btn-action" style="text-align:center; text-decoration:none; background:var(--success);">
          &#128222; Llamar al Residente
        </a>
      ` : ''}

      <button class="btn-action" onclick="enviarNotificacionAutorizacion('${resident.user_id}', '${resident.apartamento}')" style="background:var(--warning);">
        &#128276; Notificar desde la App
      </button>

      <button class="btn-action-secondary" onclick="openFormVisita({ apartamento: '${resident.apartamento}', nombre: document.getElementById('sr-visitor-name')?.value, cedula: document.getElementById('sr-visitor-cedula')?.value })">
        Registrar visita manualmente
      </button>
    </div>

    <div id="sr-auth-status" style="margin-top:20px; text-align:center;"></div>
  `;
  openDrawer('Autorizar Visita — Apto ' + resident.apartamento, html);
}

window.enviarNotificacionAutorizacion = async function (userId, apto) {
  const visitorName = document.getElementById('sr-visitor-name')?.value.trim() || 'Alguien';
  const visitorCedula = document.getElementById('sr-visitor-cedula')?.value.trim() || '';

  if (!visitorCedula) {
    alert('La cédula del visitante es requerida');
    document.getElementById('sr-visitor-cedula')?.focus();
    return;
  }

  try {
    const statusEl = document.getElementById('sr-auth-status');
    statusEl.textContent = 'Enviando notificación...';

    const res = await porteriaAPI.request('/api/notifications/request-auth', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, apartamento: apto, visitorName, cedula: visitorCedula })
    });

    if (!res.success) throw new Error(res.message);

    statusEl.innerHTML = '<span style="color:#2563eb;">Notificación enviada. Esperando respuesta del residente...</span>';

    // Iniciar polling
    const notifId = res.data.notification_id;
    const pollInterval = setInterval(async () => {
      // Si el drawer se cierra, dejamos de consultar
      if (!document.getElementById('sr-auth-status')) {
        clearInterval(pollInterval);
        return;
      }

      const st = await porteriaAPI.request(`/api/notifications/${notifId}/status`);
      if (st.success) {
        if (st.data.status === 'aprobado') {
          statusEl.innerHTML = '<span style="color:#10b981; font-size:1.4rem;">¡VISITA APROBADA!</span>';
          statusEl.innerHTML += `<br><button onclick="openFormVisita({ apartamento: '${apto}', nombre: '${visitorName}', cedula: '${visitorCedula}', isResidentManual: false })" class="btn-primary" style="margin-top:15px; width:100%;">Proceder a Registrar</button>`;
          clearInterval(pollInterval);
        } else if (st.data.status === 'rechazado') {
          statusEl.innerHTML = '<span style="color:#ef4444; font-size:1.4rem;">VISITA RECHAZADA</span>';
          clearInterval(pollInterval);
        }
      }
    }, 3000);

  } catch (e) {
    alert(e.message || 'Error al enviar la notificación. ¿Hay conexión?');
    document.getElementById('sr-auth-status').textContent = '';
  }
}

/* ─── HISTORIAL (Hoy vs Completo paginado por lotes de 20) ────────────────────── */
let currentHistorialTab = 'hoy';
let historialPage = 1;
let historialTotalPages = 1;
let historialCompletoItems = [];

async function switchHistorialTab(tab) {
  currentHistorialTab = tab;
  const tabHoy = document.getElementById('tab-historial-hoy');
  const tabCompleto = document.getElementById('tab-historial-completo');
  const paginEl = document.getElementById('historial-pagination');

  if (tab === 'hoy') {
    if (tabHoy) {
      tabHoy.style.background = 'var(--acento)';
      tabHoy.style.color = '#fff';
    }
    if (tabCompleto) {
      tabCompleto.style.background = 'var(--bg)';
      tabCompleto.style.color = 'var(--text-muted)';
    }
    if (paginEl) paginEl.style.display = 'none';
    await loadHistorialHoy();
  } else {
    if (tabCompleto) {
      tabCompleto.style.background = 'var(--acento)';
      tabCompleto.style.color = '#fff';
    }
    if (tabHoy) {
      tabHoy.style.background = 'var(--bg)';
      tabHoy.style.color = 'var(--text-muted)';
    }
    historialPage = 1;
    historialCompletoItems = [];
    await loadHistorialCompleto(1);
  }
}

async function loadHistorialHoy() {
  const listEl = document.getElementById('historial-list');
  if (!listEl) return;
  const user = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const currentTenantId = user.tenant_id ? String(user.tenant_id) : null;

  if (navigator.onLine) {
    try {
      const res = await porteriaAPI.request('/api/visits?fecha=hoy&limit=100');
      if (res?.success && Array.isArray(res.data)) {
        for (const v of res.data) {
          await dbVisitas.save({
            ...v,
            tenant_id: v.tenant_id ? String(v.tenant_id) : currentTenantId,
            localId: v.localId || v._id,
            movimiento: v.horaSalida ? 'salida' : 'ingreso',
            syncStatus: 'sincronizado',
          });
        }
      }
    } catch (_) { }
  }

  const turno = await dbVisitas.getTurno();

  if (!turno.length) {
    listEl.innerHTML = '<div class="empty-recent" style="padding:40px 16px">Sin registros en el día de hoy</div>';
    return;
  }

  listEl.innerHTML = turno.map(v => renderHistorialItemHTML(v)).join('');
}

async function loadHistorialCompleto(page = 1) {
  const listEl = document.getElementById('historial-list');
  const paginEl = document.getElementById('historial-pagination');
  const btnMore = document.getElementById('btn-cargar-mas-historial');
  if (!listEl) return;

  if (page === 1) {
    listEl.innerHTML = '<div class="empty-recent" style="padding:30px 16px">Cargando registros…</div>';
  }

  try {
    let items = [];
    if (navigator.onLine) {
      try {
        const res = await porteriaAPI.request(`/api/visits?page=${page}&limit=20`);
        if (res?.success) {
          items = res.data || [];
          historialTotalPages = res.pagination?.totalPages || 1;
        }
      } catch (_) { }
    }

    // Fallback offline a IndexedDB si no hay conexión
    if (!items.length && !navigator.onLine) {
      const all = await dbVisitas.getRecientes(1000);
      const start = (page - 1) * 20;
      items = all.slice(start, start + 20);
      historialTotalPages = Math.ceil(all.length / 20) || 1;
    }

    if (page === 1) {
      historialCompletoItems = items;
    } else {
      historialCompletoItems = historialCompletoItems.concat(items);
    }

    if (!historialCompletoItems.length) {
      listEl.innerHTML = '<div class="empty-recent" style="padding:40px 16px">No hay registros históricos</div>';
      if (paginEl) paginEl.style.display = 'none';
      return;
    }

    listEl.innerHTML = historialCompletoItems.map(v => renderHistorialItemHTML(v, true)).join('');

    if (paginEl) {
      if (page < historialTotalPages) {
        paginEl.style.display = 'block';
        if (btnMore) {
          btnMore.disabled = false;
          btnMore.textContent = `Cargar más registros (Página ${page + 1} de ${historialTotalPages})`;
        }
      } else {
        paginEl.style.display = 'none';
      }
    }
  } catch (err) {
    console.error('Error al cargar historial completo:', err);
    if (page === 1) {
      listEl.innerHTML = '<div class="empty-recent" style="padding:40px 16px; color:#e53e3e">Error al cargar registros históricos</div>';
    }
  }
}

async function cargarMasHistorial() {
  const btnMore = document.getElementById('btn-cargar-mas-historial');
  if (btnMore) {
    btnMore.disabled = true;
    btnMore.textContent = 'Cargando…';
  }
  historialPage++;
  await loadHistorialCompleto(historialPage);
}

function renderHistorialItemHTML(v, showFullDate = false) {
  const isSalida = v.movimiento === 'salida' || (v.horaSalida && !v.movimiento);
  const time = isSalida ? (v.horaSalida || v.horaIngreso) : v.horaIngreso;
  const timeFormatted = showFullDate ? fmtDate(time) : fmtHora(time);

  let extraBadge = '';
  if (v.tipo === 'domicilio' && (v.estadoDomicilio === 'recibido' || v.fechaRecepcion)) {
    extraBadge = `<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px;">Recibido (${fmtHora(v.fechaRecepcion || v.horaSalida)})</span>`;
  }

  return `
    <div class="history-item">
      <span class="hi-time" style="font-size:12px;line-height:1.2;text-align:right;">${timeFormatted}</span>
      <div class="ri-badge ${v.tipo}" style="flex-shrink:0">${v.tipo}</div>
      <div class="hi-info">
        <div class="hi-name">${v.nombre || v.empresa || (v.placa ? 'Vehículo ' + v.placa : '—')} ${v.placa && v.nombre ? `(${v.placa})` : ''} ${extraBadge}</div>
        <div class="hi-apto">Apto ${v.apartamento} · <b style="color:${isSalida ? '#e53e3e' : '#38a169'}">${(isSalida ? 'salida' : 'ingreso').toUpperCase()}</b> &middot; <small style="color:var(--text-muted)">${v.metodoSalida || v.metodoIdentificacion || 'manual'}</small></div>
      </div>
      ${v.syncStatus === 'pendiente' ? '<span class="hi-pending">↯ Pendiente</span>' : ''}
    </div>
  `;
}

/* ─── EDITAR / ELIMINAR ──────────────────────────────────────────────────────── */
async function editarVisita(id) {
  const visits = await dbVisitas.getTurno();
  const v = visits.find(x => x.id === id);
  if (!v) return;
  if (v.tipo === 'visita') openFormVisita(v);
  if (v.tipo === 'domicilio') openFormDomicilio(); // simplificado
}

async function eliminarVisita(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await dbVisitas.delete(id);
  await refreshRecientes();
  await updateSyncBanner();
}

/* ─── SYNC BANNER ────────────────────────────────────────────────────────────── */
async function updateSyncBanner() {
  const count = await dbVisitas.countPendientes();
  const banner = document.getElementById('sync-banner');
  const countEl = document.getElementById('sync-count');
  if (count > 0) {
    banner.style.display = 'flex';
    countEl.textContent = `${count} registro${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''} de sincronización`;
  } else {
    banner.style.display = 'none';
  }
}

async function doSync() {
  const dot = document.getElementById('conn-dot');
  dot.className = 'conn-dot syncing';
  const res = await porteriaAPI.syncPendientes();
  await updateSyncBanner();
  dot.className = navigator.onLine ? 'conn-dot' : 'conn-dot offline';
  showToast(`${res.synced} registro${res.synced !== 1 ? 's' : ''} sincronizado${res.synced !== 1 ? 's' : ''}`);
}

/* ─── LOGOUT ─────────────────────────────────────────────────────────────────── */
async function doLogout() {
  if (await dbVisitas.countPendientes() > 0) {
    if (!confirm('Hay registros pendientes de sincronizar. ¿Cerrar sesión de todas formas?')) return;
  }
  clearInterval(syncInterval);
  await porteriaAPI.logout();
}

/* ─── CONNECTION MONITOR ─────────────────────────────────────────────────────── */
function initConnectionMonitor() {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');

  function update() {
    if (navigator.onLine) {
      dot.className = 'conn-dot';
      label.textContent = 'Online';
    } else {
      dot.className = 'conn-dot offline';
      label.textContent = 'Offline';
    }
  }

  window.addEventListener('online', async () => {
    update();
    const res = await porteriaAPI.syncPendientes();
    if (res.synced > 0) {
      await updateSyncBanner();
      showToast(`${res.synced} registros sincronizados al reconectar`);
    }
  });
  window.addEventListener('offline', update);
  update();
}

/* ─── UTILIDADES ─────────────────────────────────────────────────────────────── */
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtHora(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}