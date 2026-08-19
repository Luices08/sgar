/* ─── SGAR Portería — Lógica principal ──────────────────────────────────────── */
'use strict';

let currentScreen = 'login';
let deliveryEmpresas = ['Rappi', 'iFood', 'DidiFood', 'Otro'];
let syncInterval = null;

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
  const user  = localStorage.getItem('sgar_user');
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
    } catch (_) {}
  }

  const tenant = await dbConfig.get('tenant');

  // Nombre del conjunto en header
  const nombre = tenant?.nombre || await dbConfig.get('conjuntoNombre') || 'Portería';
  document.getElementById('conjunto-nombre').textContent = nombre;
  document.getElementById('menu-name').textContent       = user.nombre || 'Celador';
  document.getElementById('menu-avatar').textContent     = (user.nombre || 'C').charAt(0).toUpperCase();
  document.getElementById('menu-conjunto').textContent   = nombre;
  const welcomeNameEl = document.getElementById('welcome-name');
  if (welcomeNameEl) welcomeNameEl.textContent = (user.nombre || 'Celador').split(' ')[0];

  // Empresas de domicilio
  const emps = await dbConfig.get('deliveryEmpresas');
  if (emps) deliveryEmpresas = emps;

  // Eventos de la pantalla principal (Acciones Online / Normal)
  document.getElementById('btn-registro-residente').addEventListener('click', () => facialModule.openFacialScreen());
  
  const btnVisita = document.getElementById('btn-registro-visita');
  if(btnVisita) btnVisita.addEventListener('click', () => { navigate('visitas'); loadPendientes(); });

  const btnSalidaVisita = document.getElementById('btn-salida-visita');
  if(btnSalidaVisita) btnSalidaVisita.addEventListener('click', () => { navigate('salidas-visitas'); loadSalidasVisitantes(); });
  
  const btnDomicilio = document.getElementById('btn-registro-domicilio');
  if(btnDomicilio) btnDomicilio.addEventListener('click', () => openFormDomicilio());

  // Eventos de modo Offline/Manual
  const btnManualRes = document.getElementById('btn-manual-residente');
  if(btnManualRes) btnManualRes.addEventListener('click', () => openFormVisita({ isResidentManual: true }));

  const btnManualVis = document.getElementById('btn-manual-visita');
  if(btnManualVis) btnManualVis.addEventListener('click', () => openFormVisita());

  const btnManualDom = document.getElementById('btn-manual-domicilio');
  if(btnManualDom) btnManualDom.addEventListener('click', () => openFormDomicilio());

  // Historial y otros
  document.getElementById('btn-ver-historial').addEventListener('click', () => { navigate('historial'); switchHistorialTab('hoy'); });
  document.getElementById('btn-back-historial').addEventListener('click', () => navigate('main'));
  document.getElementById('tab-historial-hoy')?.addEventListener('click', () => switchHistorialTab('hoy'));
  document.getElementById('tab-historial-completo')?.addEventListener('click', () => switchHistorialTab('completo'));
  document.getElementById('btn-cargar-mas-historial')?.addEventListener('click', cargarMasHistorial);
  document.getElementById('btn-back-analiticas').addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-visitas')?.addEventListener('click', () => navigate('main'));
  document.getElementById('btn-back-salidas-visitas')?.addEventListener('click', () => navigate('main'));
  
  // Eventos de la pantalla de visitas (Entrada)
  document.getElementById('btn-manual-visita-online')?.addEventListener('click', () => openSearchResidentForVisit());
  document.getElementById('btn-verificar')?.addEventListener('click', verificarCodigoCentro);
  document.getElementById('search-invitations')?.addEventListener('input', filtrarTarjetas);
  document.getElementById('btn-refresh-invitations')?.addEventListener('click', loadPendientes);

  // Eventos de la pantalla de salidas de visitas
  document.getElementById('search-salidas')?.addEventListener('input', filtrarSalidas);
  document.getElementById('btn-refresh-salidas')?.addEventListener('click', () => loadSalidasVisitantes());

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
            showToast(`🎟️ Invitación esperada: ${evt.nombreVisitante || 'Visitante'} (Apto ${evt.apartamento}) · Código: ${evt.codigo}`);
          }
          if (evt.type === 'domicilio' && evt.estadoDomicilio === 'recibido') {
            showToast(`📦 Domicilio para Apto ${evt.apartamento || '—'} confirmado como recibido por el residente ✓`);
          }
          if (evt.type === 'solicitud_ayuda' || evt.type === 'panico' || evt.type === 'emergencia') {
            showToast(`🚨 EMERGENCIA: ${evt.titulo || 'Solicitud de ayuda'} - ${evt.mensaje || ''}`, 'error');
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
        }
      } catch (_) {}
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
  if (screen === 'facial') {} // Manejado por facialModule
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
  document.getElementById('drawer-body').innerHTML    = html;
  document.getElementById('bottom-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  document.getElementById('bottom-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ─── FORMULARIO VISITA / RESIDENTE MANUAL ───────────────────────────────────── */
function openFormVisita(editData = null) {
  const isResident = editData && editData.isResidentManual;
  const isEdit = editData && !editData.isResidentManual && editData.id;

  const html = `
    <div id="f-error" class="form-error" style="display:none"></div>
    <div id="res-status-info" style="display:none; padding:10px 14px; border-radius:var(--radius); font-size:13px; font-weight:600; margin-bottom:12px;"></div>
    <div class="form-field">
      <label>${isResident ? 'Nombre del Residente *' : 'Nombre del visitante *'}</label>
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
    ${!isResident ? `
    <div class="form-field">
      <label>Código de invitación</label>
      <div style="display:flex;gap:8px">
        <input type="text" id="f-codigo" placeholder="000000" maxlength="6" inputmode="numeric" style="flex:1">
        <button type="button" class="btn-action-secondary" id="btn-validate-code" style="width:auto;padding:0 14px;margin:0;font-size:13px">Validar</button>
      </div>
    </div>
    <div id="inv-info" style="display:none" class="form-ocr-bar found"></div>
    ` : ''}
    <input type="hidden" id="f-inv-id">
    <input type="hidden" id="f-is-resident" value="${isResident ? 'true' : 'false'}">
    <input type="hidden" id="f-resident-id" value="${editData?.resident_id || ''}">
    <button class="btn-action" id="btn-submit-visita">${isEdit ? 'Actualizar' : (isResident ? 'Registrar Entrada' : 'Registrar visita')}</button>
  `;

  openDrawer(isResident ? 'Registro Manual de Residente' : 'Registrar Visita', html);

  const btnSubmit = document.getElementById('btn-submit-visita');
  btnSubmit.addEventListener('click', () => submitVisita(isEdit ? editData.id : null));

  if (!isResident) {
    document.getElementById('btn-validate-code').addEventListener('click', validateCode);
  } else {
    // Si es residente, escuchar cambios para verificar si está dentro o fuera
    const cedulaInput = document.getElementById('f-cedula');
    const aptoInput   = document.getElementById('f-apto');
    const nombreInput = document.getElementById('f-nombre');

    let debounceTimer = null;
    const checkStatus = async () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const cedula = cedulaInput?.value.trim();
        const apto   = aptoInput?.value.trim();
        const nombre = nombreInput?.value.trim();
        const infoEl = document.getElementById('res-status-info');
        if (!infoEl) return;

        if (!cedula && !apto) {
          infoEl.style.display = 'none';
          btnSubmit.textContent = 'Registrar Entrada';
          btnSubmit.style.background = '';
          return;
        }

        // 1. Buscar en BD local / offline
        let openVisit = await dbVisitas.buscarIngresoAbierto(null, cedula, apto);
        
        // 2. Si no lo encuentra local y hay red, chequear servidor
        if (!openVisit && navigator.onLine && (cedula || (apto && nombre))) {
          try {
            const searchRes = await porteriaAPI.request(`/api/residents?limit=1&q=${encodeURIComponent(cedula || apto)}`);
            if (searchRes?.success && searchRes.data?.length > 0) {
              const resObj = searchRes.data[0];
              if (resObj.estadoAcceso === 'dentro') {
                openVisit = resObj.ingresoActivo || { horaIngreso: new Date() };
              }
            }
          } catch (_) {}
        }

        if (openVisit) {
          infoEl.style.display = 'block';
          infoEl.style.background = 'rgba(239, 68, 68, 0.12)';
          infoEl.style.color = '#dc2626';
          infoEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          const horaIngresoStr = openVisit.horaIngreso ? fmtHora(openVisit.horaIngreso) : '';
          infoEl.innerHTML = `⚠️ Residente <strong>DENTRO</strong> ${horaIngresoStr ? `(desde las ${horaIngresoStr})` : ''} &middot; Se registrará su <strong>SALIDA</strong>.`;
          btnSubmit.textContent = 'Registrar Salida';
          btnSubmit.style.background = '#dc2626';
        } else {
          infoEl.style.display = 'block';
          infoEl.style.background = 'rgba(16, 185, 129, 0.12)';
          infoEl.style.color = '#059669';
          infoEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          infoEl.innerHTML = `✓ Residente <strong>FUERA</strong> &middot; Se registrará su <strong>ENTRADA</strong>.`;
          btnSubmit.textContent = 'Registrar Entrada';
          btnSubmit.style.background = '';
        }
      }, 300);
    };

    cedulaInput?.addEventListener('input', checkStatus);
    aptoInput?.addEventListener('input', checkStatus);
    nombreInput?.addEventListener('input', checkStatus);
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
    document.getElementById('f-apto').value   = inv.apartamento || '';
    document.getElementById('f-inv-id').value = inv.invitation_id || '';
    document.getElementById('inv-info').style.display = '';
    document.getElementById('inv-info').textContent   = `✓ Invitación válida — Apto ${inv.apartamento}`;
  } else {
    showToast(res?.message || 'Código inválido o ya utilizado', 'error');
  }
}

async function submitVisita(editLocalId = null) {
  const nombre = document.getElementById('f-nombre').value.trim();
  const cedula = document.getElementById('f-cedula').value.trim();
  const apto   = document.getElementById('f-apto').value.trim();
  const invId  = document.getElementById('f-inv-id').value.trim();
  const residentId = document.getElementById('f-resident-id')?.value.trim();
  const user   = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant = await dbConfig.get('tenant');

  const isResident = document.getElementById('f-is-resident').value === 'true';

  if (!nombre) { document.getElementById('f-error').textContent = 'El nombre es obligatorio'; document.getElementById('f-error').style.display = ''; return; }
  if (!cedula) { document.getElementById('f-error').textContent = 'La cédula es obligatoria'; document.getElementById('f-error').style.display = ''; return; }
  if (!apto) { document.getElementById('f-error').textContent = 'El apartamento es requerido'; document.getElementById('f-error').style.display = ''; return; }

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
    const res = await porteriaAPI.completarInvitacion(invId);
    if (res?.success) {
      closeDrawer();
      await refreshRecientes();
      await updateAllBadges();
      showToast('Visita registrada con invitación ✓');
      return;
    } else {
      document.getElementById('f-error').textContent = res?.message || 'Error al completar la invitación';
      document.getElementById('f-error').style.display = '';
      return;
    }
  }

  const visitData = {
    tipo:         isResident ? 'residente' : 'visita',
    nombre,
    cedula,
    apartamento:  apto,
    resident_id:  residentId || null,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    user.tenant_id || tenant?.tenant_id || tenant?._id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: isResident ? 'manual' : (invId ? 'codigo_invitacion' : 'manual'),
    invitation_id: invId || null,
    movimiento:   'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateAllBadges();
    await updateSyncBanner();
    if (isResident) {
      const isSalida = res.accion === 'salida' || res.visit?.horaSalida;
      showToast(isSalida ? 'Salida de residente registrada ✓' : 'Entrada de residente registrada ✓');
    } else {
      showToast(res.local ? 'Registro guardado offline ↯' : 'Registro exitoso ✓');
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
  const empresa   = document.getElementById('fd-empresa').value;
  const apto      = document.getElementById('fd-apto').value.trim();
  const mensajero = document.getElementById('fd-mensajero').value.trim();
  const user      = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant    = await dbConfig.get('tenant');

  if (!empresa) { document.getElementById('fd-error').textContent = 'Selecciona la empresa'; document.getElementById('fd-error').style.display = ''; return; }
  if (!apto)    { document.getElementById('fd-error').textContent = 'El apartamento es requerido'; document.getElementById('fd-error').style.display = ''; return; }

  const visitData = {
    tipo:         'domicilio',
    empresa,
    nombre:       mensajero || empresa,
    apartamento:  apto,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    user.tenant_id || tenant?.tenant_id || tenant?._id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: 'manual',
    movimiento:   'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(res.local ? 'Domicilio guardado offline ↯' : 'Domicilio registrado ✓');
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

  const res   = await porteriaAPI.buscarPlaca(placa);
  const info  = document.getElementById('fp-ocr-info');
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
      info.className     = 'form-ocr-bar found';
      info.innerHTML   = `
        <strong>✓ Vehículo SGAR (${vehicle.tipo})</strong><br>
        Responsable: <strong>${respName}</strong> (Apto ${vehicle.apartamento})
        ${authCount > 0 ? `<br><small>${authCount} persona(s) autorizada(s)</small>` : ''}
        ${openAccess ? '<br><span style="color:#d97706;font-weight:700;">🟢 Actualmente dentro (Registrar Salida)</span>' : ''}
      `;
    } else {
      vehicleIdInput.value = '';
      info.style.display = '';
      info.className     = 'form-ocr-bar';
      info.innerHTML   = `
        Vehículo externo / visitante.${openAccess ? ' <strong style="color:#d97706;">(Actualmente dentro)</strong>' : ' Ingresa el apartamento de destino.'}
      `;
    }
  } else {
    info.style.display = '';
    info.className     = 'form-ocr-bar';
    info.textContent   = 'Placa no encontrada en el catálogo. Se registrará como vehículo externo.';
  }
}

async function submitPlaca() {
  const placa     = document.getElementById('fp-placa').value.trim().toUpperCase();
  const apto      = document.getElementById('fp-apto').value.trim();
  const conductor = document.getElementById('fp-conductor')?.value.trim() || '';
  const vehicleId = document.getElementById('fp-vehicle-id')?.value || null;
  const isSalida  = document.getElementById('fp-is-salida')?.value === 'true';
  const openLogId = document.getElementById('fp-open-log-id')?.value || null;
  const user      = JSON.parse(localStorage.getItem('sgar_user') || '{}');
  const tenant    = await dbConfig.get('tenant');

  if (!placa) { document.getElementById('fp-error').textContent = 'Ingresa la placa'; document.getElementById('fp-error').style.display = ''; return; }
  if (!apto)  { document.getElementById('fp-error').textContent = 'Ingresa el apartamento'; document.getElementById('fp-error').style.display = ''; return; }

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
    } catch (_) {}
  }

  const visitData = {
    tipo:         'vehiculo',
    placa,
    nombre:       conductor || 'Conductor vehicular',
    apartamento:  apto,
    celador_id:   user.user_id,
    celador_nombre: user.nombre,
    tenant_id:    user.tenant_id || tenant?.tenant_id || tenant?._id,
    horaIngreso:  new Date().toISOString(),
    metodoIdentificacion: 'manual',
    movimiento:   isSalida ? 'salida' : 'ingreso',
  };

  const res = await porteriaAPI.registrarVisita(visitData);
  if (res.success) {
    closeDrawer();
    await refreshRecientes();
    await updateSyncBanner();
    showToast(isSalida ? 'Salida vehicular registrada ✓' : 'Ingreso vehicular registrado ✓');
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
    } catch (_) {}
  }

  const recientes = await dbVisitas.getRecientes(10);
  const listEl    = document.getElementById('recent-list');
  if (!listEl) return;

  if (!recientes.length) {
    listEl.innerHTML = '<div class="empty-recent">Sin registros en este turno</div>';
    return;
  }

  listEl.innerHTML = recientes.map(v => {
    let extraBadge = '';
    if (v.tipo === 'domicilio' && (v.estadoDomicilio === 'recibido' || v.fechaRecepcion)) {
      extraBadge = '<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:10.5px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:4px;">✓ Recibido</span>';
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
      if(codigoInput) {
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
    const html = `
      <!-- Tarjeta resumen del visitante -->
      <div style="background:var(--bg); border-radius:var(--radius); padding:16px; margin-bottom:16px;">
        <div class="ri-badge visita" style="margin-bottom:10px; display:inline-block;">Invitación válida</div>
        <div style="font-size:16px; font-weight:700; color:var(--text); margin-bottom:4px;">${inv.nombreVisitante}</div>
        <div style="font-size:13px; color:var(--text-muted);">Apto <strong>${inv.apartamento}</strong></div>
        <div style="margin-top:12px; display:flex; gap:16px;">
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;">Personas</div>
            <div style="font-size:15px; font-weight:600;">${inv.personasEsperadas || 1}</div>
          </div>
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:.4px;">Cédula</div>
            <div style="font-size:15px; font-weight:600;">${inv.cedulaVisitante || '—'}</div>
          </div>
        </div>
      </div>
      <button id="btn-confirmar-ingreso-inv" class="btn-action">
        Confirmar Ingreso
      </button>
    `;
    
    openDrawer('Confirmar Invitación', html);
    
    document.getElementById('btn-confirmar-ingreso-inv').addEventListener('click', async () => {
      try {
        document.getElementById('btn-confirmar-ingreso-inv').disabled = true;
        document.getElementById('btn-confirmar-ingreso-inv').textContent = 'Registrando...';
        
        const regRes = await porteriaAPI.request('/api/visits/registrar-ingreso', {
          method: 'POST',
          body: JSON.stringify({ codigo: code })
        });
        
        if (!regRes.success) throw new Error(regRes.message);
        
        const visit = regRes.data?.visit;
        if (visit) {
           visit.syncStatus = 'sincronizado';
           visit.localId = visit._id;
           await db.visitas.put(visit);
        }

        closeDrawer();
        alert('Visita confirmada y registrada exitosamente.');
        
        // Remover de la lista activa localmente, recargar historial
        invitacionesActivas = invitacionesActivas.filter(i => i.codigo !== code);
        document.getElementById('codigo-input').value = '';
        renderTarjetas(document.getElementById('search-invitations')?.value || '');
        updatePendingInvitationsBadge();
        
        // Si queremos regresar y actualizar recientes
        navigate('main');
        await refreshRecientes();
        await updateAllBadges();
      } catch(err) {
        alert(err.message || 'Error al registrar.');
      } finally {
        document.getElementById('btn-confirmar-ingreso-inv').disabled = false;
        document.getElementById('btn-confirmar-ingreso-inv').textContent = 'Confirmar Ingreso';
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
  } catch (_) {}
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
  } catch (_) {}
}

async function updateAllBadges() {
  await Promise.all([
    updateActiveVisitorsCount(),
    updatePendingInvitationsCount(),
  ]);
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
      ? `<span class="ri-badge domicilio" style="font-size:11px; padding:2px 7px; border-radius:4px; font-weight:700; text-transform:uppercase; margin-left:6px;">🛵 Domicilio</span>${isRecibido ? '<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:4px;">✓ Recibido por residente</span>' : ''}`
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
      const labelConfirm = isDom ? `el domicilio de ${nombreVisitante}` : `${nombreVisitante}`;
      confirmarSalidaVisitante(v._id || v.localId, labelConfirm, aptoVisitante);
    });

    container.appendChild(card);
  });
}

function filtrarSalidas(e) {
  renderTarjetasSalidas(e.target.value);
}

async function confirmarSalidaVisitante(id, nombre, apto) {
  if (!confirm(`¿Confirmar la salida de ${nombre || 'Visitante'} (Apto ${apto})?`)) return;

  try {
    const res = await porteriaAPI.registrarSalidaVisita(id);
    if (res?.success) {
      showToast(`Salida registrada: ${nombre || 'Visitante'} (Apto ${apto}) ✓`);
      await loadSalidasVisitantes();
      await refreshRecientes();
      await updateAllBadges();
    } else {
      alert(res?.message || 'Error al registrar la salida');
    }
  } catch (err) {
    alert(err.message || 'Error de conexión al registrar la salida');
  }
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
      (r.nombre||'').toLowerCase().includes(q) || 
      (r.cedula||'').toLowerCase().includes(q)
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

window.selectResidentForAuth = async function(id) {
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

window.enviarNotificacionAutorizacion = async function(userId, apto) {
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

  } catch(e) {
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
    } catch (_) {}
  }

  const turno = await dbVisitas.getTurno();

  if (!turno.length) {
    listEl.innerHTML = '<div class="empty-recent" style="padding:40px 16px">Sin registros en el día de hoy</div>';
    return;
  }

  listEl.innerHTML = turno.map(v => renderHistorialItemHTML(v)).join('');
}

async function loadHistorialCompleto(page = 1) {
  const listEl  = document.getElementById('historial-list');
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
      } catch (_) {}
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
    extraBadge = `<span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:11px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px;">✓ Recibido (${fmtHora(v.fechaRecepcion || v.horaSalida)})</span>`;
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
  if (v.tipo === 'visita')    openFormVisita(v);
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
  const count   = await dbVisitas.countPendientes();
  const banner  = document.getElementById('sync-banner');
  const countEl = document.getElementById('sync-count');
  if (count > 0) {
    banner.style.display  = 'flex';
    countEl.textContent   = `${count} registro${count > 1 ? 's' : ''} pendiente${count > 1 ? 's' : ''} de sincronización`;
  } else {
    banner.style.display  = 'none';
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
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');

  function update() {
    if (navigator.onLine) {
      dot.className    = 'conn-dot';
      label.textContent = 'Online';
    } else {
      dot.className    = 'conn-dot offline';
      label.textContent = 'Offline';
    }
  }

  window.addEventListener('online',  async () => {
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