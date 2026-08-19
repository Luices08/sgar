/* ─── SGAR Residente — Lógica principal ─────────────────────────────────────── */
'use strict';

const API_BASE = '';
let residenteData = null;
let currentResidentId = null;

/* ─── INICIALIZACIÓN ─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/residente/sw.js').catch(console.warn);
  }

  // Aplicar color del tenant guardado
  const colorGuardado = localStorage.getItem('sgar_res_color');
  if (colorGuardado) document.documentElement.style.setProperty('--acento', colorGuardado);

  // Verificar sesión existente
  const token = localStorage.getItem('sgar_token');
  const user  = localStorage.getItem('sgar_user');
  if (token && user) {
    const u = JSON.parse(user);
    if (u.rol === 'residente') {
      await initApp(u);
      return;
    }
  }

  window.location.href = '/admin/login';
});

/* ─── INICIALIZAR APP ────────────────────────────────────────────────────────── */
async function initApp(user) {

  // Cargar datos del residente
  try {
    const profileRes = await apiCall('/api/auth/profile');
    if (profileRes?.success) {
      residenteData = profileRes.data.user;
    }
  } catch (_) { residenteData = user; }

  currentResidentId = residenteData?.resident_id || user.resident_id || user.user_id;

  // UI del menú
  const nombre = residenteData?.nombre || user.nombre || 'Residente';
  document.getElementById('menu-name').textContent   = nombre;
  document.getElementById('menu-avatar').textContent = nombre.charAt(0).toUpperCase();
  document.getElementById('header-title').textContent = 'Mi Portal';

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
      if (btn.dataset.tab === 'vehiculos') loadVehiculos();
    });
  });

  // Menú
  document.getElementById('btn-menu').addEventListener('click', toggleMenu);
  document.getElementById('menu-overlay').addEventListener('click', closeMenu);
  document.getElementById('btn-logout').addEventListener('click', doLogout);

  // Drawer
  document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Nueva invitación
  document.getElementById('btn-nueva-inv').addEventListener('click', openFormInvitacion);
  document.getElementById('btn-mark-read').addEventListener('click', markAllRead);

  // Acciones rápidas
  document.getElementById('qa-historial')?.addEventListener('click', () => switchTab('historial'));
  document.getElementById('qa-invitaciones')?.addEventListener('click', () => switchTab('invitaciones'));
  document.getElementById('qa-vehiculos')?.addEventListener('click', () => {
    switchTab('vehiculos');
    loadVehiculos();
  });

  // Filtro historial
  document.getElementById('filter-historial').addEventListener('change', loadHistorial);

  // Cargar datos iniciales
  await Promise.all([loadNotificaciones(), loadHistorial(), loadInvitaciones(), loadVehiculos()]);

  // Iniciar Polling en tiempo real (~5 segundos)
  if (window.SGARPoll) {
    SGARPoll.start({
      intervalMs: 5000,
      onCounts: (counts) => {
        const badge = document.getElementById('badge-notif');
        if (badge) {
          if (counts.unreadNotifications > 0) {
            badge.textContent = counts.unreadNotifications > 99 ? '99+' : counts.unreadNotifications;
            badge.style.display = 'inline-flex';
          } else {
            badge.style.display = 'none';
          }
        }
      },
      onChanges: (data) => {
        loadNotificaciones();
        if (data.events.some(e => ['visita', 'domicilio', 'residente'].includes(e.type))) {
          loadHistorial();
        }
        if (data.events.some(e => e.type && (e.type.includes('invitacion') || e.type.includes('vehiculo')))) {
          loadVehiculos();
        }
      }
    });
  }
}

/* ─── TABS ───────────────────────────────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`tab-${tab}`)?.classList.add('active');
}

/* ─── NOTIFICACIONES ─────────────────────────────────────────────────────────── */
async function loadNotificaciones() {
  const res = await apiCall('/api/notifications?limit=30');
  if (!res?.success) return;

  const notifs = Array.isArray(res.data) ? res.data : (res.data?.notifications || []);
  const noLeidas = notifs.filter(n => !n.leida).length;

  // Actualizar stats
  const statNoLeidos = document.getElementById('stat-no-leidos');
  const statLeidos   = document.getElementById('stat-leidos');
  if (statNoLeidos) statNoLeidos.textContent = noLeidas;
  if (statLeidos)   statLeidos.textContent   = notifs.length - noLeidas;

  // Badge en el tab
  const badge = document.getElementById('badge-notif');
  if (badge) {
    if (noLeidas > 0) {
      badge.textContent   = noLeidas > 99 ? '99+' : noLeidas;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // Menú apto
  if (notifs.length > 0 && notifs[0].apartamento) {
    const aptoEl = document.getElementById('menu-apto');
    if (aptoEl) aptoEl.textContent = `Apto ${notifs[0].apartamento}`;
  }

  const container = document.getElementById('notif-list');
  if (!notifs.length) {
    container.innerHTML = `
      <div class="empty-state-sm">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#ccc" stroke-width="1.5" style="margin:0 auto 8px"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <p>No tienes notificaciones recientes</p>
      </div>`;
    return;
  }

  container.innerHTML = notifs.map(n => renderNotifCard(n)).join('');

  // Event listeners para marcar como leída al hacer click
  container.querySelectorAll('.notif-card.no-leida').forEach(card => {
    card.addEventListener('click', () => markRead(card.dataset.id));
  });
}

function renderNotifCard(n) {
  const iconMap = {
    visita:                `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2563eb" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    domicilio:             `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#16a34a" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
    vehiculo:              `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#d97706" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`,
    invitacion_vehiculo:   `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2563eb" stroke-width="2"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
    alerta_vehiculo_no_autorizado: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#dc2626" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    sistema:               `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#66708a" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  const icon = iconMap[n.tipo] || iconMap.sistema;
  const isNoLeida = !n.leida ? 'no-leida' : '';

  let actionBtnHtml = '';
  if (n.tipo === 'domicilio') {
    if (n.estadoDomicilio === 'recibido' || n.fechaRecepcion) {
      actionBtnHtml = `
        <div style="margin-top:8px;">
          <span class="badge" style="background:#dcfce7;color:#15803d;font-weight:600;">✓ Domicilio recibido ${n.fechaRecepcion ? 'a las ' + fmtTime(n.fechaRecepcion) : ''}</span>
        </div>`;
    } else {
      actionBtnHtml = `
        <div style="margin-top:10px;">
          <button class="btn-primary-sm" style="background:#16a34a;border-color:#16a34a;cursor:pointer;" onclick="event.stopPropagation(); confirmarRecepcionDomicilio('${n.visit_id || ''}', '${n._id}')">
            📦 Recibí mi domicilio
          </button>
        </div>`;
    }
  }

  return `
    <div class="notif-card ${isNoLeida}" data-id="${n._id}">
      <div class="notif-icon">${icon}</div>
      <div class="notif-content">
        <div class="notif-top">
          <span class="notif-titulo">${escHtml(n.titulo)}</span>
          <span class="notif-time">${fmtTime(n.createdAt)}</span>
        </div>
        <p class="notif-msg">${escHtml(n.mensaje)}</p>
        ${actionBtnHtml}
      </div>
    </div>`;
}

async function confirmarRecepcionDomicilio(visitId, notifId) {
  if (!visitId) return alert('No se encontró el identificador del domicilio');

  const res = await apiCall(`/api/visits/${visitId}/recibir-domicilio`, { method: 'PATCH' });
  if (res?.success) {
    if (notifId) markRead(notifId);
    await Promise.all([loadNotificaciones(), loadHistorial()]);
    alert('✓ ¡Domicilio confirmado como recibido!');
  } else {
    alert(res?.message || 'Error al confirmar la recepción del domicilio');
  }
}

async function markRead(id) {
  await apiCall(`/api/notifications/${id}/read`, { method: 'PATCH' });
  const card = document.querySelector(`.notif-card[data-id="${id}"]`);
  if (card) card.classList.remove('no-leida');
  const statNoLeidos = document.getElementById('stat-no-leidos');
  if (statNoLeidos) {
    const cur = Math.max(0, parseInt(statNoLeidos.textContent || '1') - 1);
    statNoLeidos.textContent = cur;
  }
}

async function markAllRead() {
  await apiCall('/api/notifications/read-all', { method: 'PATCH' });
  document.querySelectorAll('.notif-card.no-leida').forEach(c => c.classList.remove('no-leida'));
  const statNoLeidos = document.getElementById('stat-no-leidos');
  if (statNoLeidos) statNoLeidos.textContent = '0';
  const badge = document.getElementById('badge-notif');
  if (badge) badge.style.display = 'none';
}

/* ─── HISTORIAL ──────────────────────────────────────────────────────────────── */
async function loadHistorial() {
  const tipo = document.getElementById('filter-historial')?.value || '';
  let url = '/api/visits?limit=50';
  if (tipo) url += `&tipo=${tipo}`;

  const res = await apiCall(url);
  if (!res?.success) return;

  const visits = res.data;
  const statHistorial = document.getElementById('stat-historial');
  if (statHistorial) statHistorial.textContent = res.pagination?.total || visits.length;

  const container = document.getElementById('historial-list');
  if (!visits.length) {
    container.innerHTML = '<div class="empty-state-sm">No hay registros de acceso en el historial</div>';
    return;
  }

  container.innerHTML = visits.map(v => {
    const badgeMap = {
      residente:             '<span class="badge" style="background:#eff6ff;color:#1d4ed8">Residente</span>',
      visita:                '<span class="badge" style="background:#f0fdf4;color:#15803d">Visita</span>',
      domicilio:             '<span class="badge" style="background:#fefce8;color:#a16207">Domicilio</span>',
      tecnico_mantenimiento: '<span class="badge" style="background:#f3e8ff;color:#7e22ce">Técnico</span>',
    };

    let estadoStr = '';
    if (v.tipo === 'domicilio') {
      if (v.estadoDomicilio === 'recibido' || v.fechaRecepcion) {
        estadoStr = `<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:600;">✓ Recibido (${fmtTime(v.fechaRecepcion || v.horaSalida)})</span>`;
      } else {
        estadoStr = `
          <button class="btn-primary-sm" style="background:#16a34a;border-color:#16a34a;font-size:12px;padding:4px 8px;cursor:pointer;" onclick="confirmarRecepcionDomicilio('${v._id}')">
            📦 Recibí mi domicilio
          </button>`;
      }
    } else {
      const isDentro = !v.horaSalida;
      estadoStr = isDentro
        ? '<span style="color:#16a34a;font-weight:600">🟢 Dentro</span>'
        : `<span style="color:#64748b">Salida: ${fmtTime(v.horaSalida)}</span>`;
    }

    return `
      <div class="panel-card" style="padding:14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div>${badgeMap[v.tipo] || v.tipo}</div>
          <span style="font-size:12px; color:#94a3b8;">${fmtDate(v.horaIngreso)}</span>
        </div>
        <div style="font-size:15px; font-weight:600; color:var(--text); margin-bottom:4px;">
          ${escHtml(v.nombre || v.empresa || 'Persona')}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px; margin-top:4px;">
          <span>Apto: <strong>${v.apartamento}</strong></span>
          <div>${estadoStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ─── INVITACIONES ───────────────────────────────────────────────────────────── */
async function loadInvitaciones() {
  const container = document.getElementById('invitaciones-list');
  const res = await apiCall('/api/invitations');
  if (!res?.success) {
    if (container) container.innerHTML = '<div class="empty-state-sm">No se pudieron cargar las invitaciones</div>';
    return;
  }

  const invs = Array.isArray(res.data) ? res.data : (res.data?.invitations || []);
  const now = new Date();

  const statInv = document.getElementById('stat-invitaciones');
  if (statInv) {
    statInv.textContent = invs.filter(i => (i.estado === 'pendiente' || i.estado === 'activa') && new Date(i.tiempo_caducidad) >= now).length;
  }

  if (!container) return;
  if (!invs.length) {
    container.innerHTML = '<div class="empty-state-sm">No tienes invitaciones creadas</div>';
    return;
  }

  container.innerHTML = invs.map(i => {
    const isExpirada = (i.estado === 'pendiente' || i.estado === 'activa') && new Date(i.tiempo_caducidad) < now;
    const isActiva = (i.estado === 'pendiente' || i.estado === 'activa') && !isExpirada;

    const estadoBadge = i.estado === 'completado' || i.estado === 'usada'
      ? '<span class="badge" style="background:#f1f5f9;color:#475569">Ingresó</span>'
      : i.estado === 'cancelado' || i.estado === 'cancelada'
      ? '<span class="badge" style="background:#fee2e2;color:#991b1b">Cancelada</span>'
      : isExpirada
      ? '<span class="badge" style="background:#fef3c7;color:#92400e">Expirada</span>'
      : '<span class="badge" style="background:#dcfce7;color:#15803d">Activa</span>';

    return `
      <div class="panel-card" style="padding:14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size:15px;">${escHtml(i.nombreVisitante)}</strong>
          ${estadoBadge}
        </div>
        <div style="font-size:13px; color:var(--text-muted); margin-bottom:8px;">
          Cédula: ${escHtml(i.cedulaVisitante || '—')} &middot; Tipo: ${escHtml(i.tipo || 'visita')}
          ${i.tiempo_caducidad ? ` &middot; Vence: ${fmtTime(i.tiempo_caducidad)}` : ''}
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn-secondary-sm" onclick="showCodigoModal('${i.codigo}', '${escHtml(i.nombreVisitante)}')">Ver código</button>
          <button class="btn-secondary-sm" onclick="copiarCodigo('${i.codigo}')">Copiar</button>
          ${isActiva ? `<button class="btn-secondary-sm" style="color:#dc2626; border-color:#fecaca;" onclick="cancelarInvitacion('${i._id}')">Cancelar</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Helper para presets rápidos de fecha de expiración
window.setExpPreset = function(hours) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const str = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const input = document.getElementById('inv-expiracion');
  if (input) input.value = str;
};

function openFormInvitacion() {
  const drawerBody = document.getElementById('drawer-body');
  const now = new Date();
  const defaultExp = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const pad = (n) => String(n).padStart(2, '0');
  const formatLocalISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const minDatetime = formatLocalISO(now);
  const defaultDatetime = formatLocalISO(defaultExp);

  drawerBody.innerHTML = `
    <form id="form-invitacion" style="display:flex; flex-direction:column; gap:14px;">
      <div class="field">
        <label>Nombre del visitante *</label>
        <input type="text" id="inv-nombre" required placeholder="Nombre completo del visitante" autocomplete="off">
      </div>
      <div class="field">
        <label>Cédula / Documento *</label>
        <input type="text" id="inv-cedula" required placeholder="Número de documento de identidad" inputmode="numeric">
      </div>
      <div class="field">
        <label>Fecha y hora de expiración *</label>
        <input type="datetime-local" id="inv-expiracion" min="${minDatetime}" value="${defaultDatetime}" required style="font-size:14px;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">
          <button type="button" class="btn-secondary-sm" style="font-size:11.5px; padding:4px 8px;" onclick="setExpPreset(12)">+12 Horas</button>
          <button type="button" class="btn-secondary-sm" style="font-size:11.5px; padding:4px 8px;" onclick="setExpPreset(24)">+24 Horas</button>
          <button type="button" class="btn-secondary-sm" style="font-size:11.5px; padding:4px 8px;" onclick="setExpPreset(48)">+2 Días</button>
          <button type="button" class="btn-secondary-sm" style="font-size:11.5px; padding:4px 8px;" onclick="setExpPreset(168)">+7 Días</button>
        </div>
      </div>
      <button type="submit" class="btn-primary" id="btn-submit-inv" style="margin-top:10px; width:100%;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        Crear Invitación
      </button>
    </form>
  `;

  document.getElementById('form-invitacion').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-inv');
    const cedulaVal = document.getElementById('inv-cedula').value.trim();
    const expiracionVal = document.getElementById('inv-expiracion').value;

    if (!cedulaVal) {
      alert('Por favor ingresa la cédula o documento del visitante');
      return;
    }

    if (!expiracionVal) {
      alert('Por favor selecciona la fecha y hora de expiración');
      return;
    }

    const expDate = new Date(expiracionVal);
    if (isNaN(expDate.getTime()) || expDate <= new Date()) {
      alert('La fecha y hora de expiración debe ser en el futuro.');
      return;
    }

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Creando…';
    }

    const payload = {
      nombreVisitante:  document.getElementById('inv-nombre').value.trim(),
      cedulaVisitante:  cedulaVal,
      tipo:             'visita',
      tiempo_caducidad: expDate.toISOString(),
      fechaEsperada:    new Date().toISOString(),
    };

    try {
      const res = await apiCall('/api/invitations', { method: 'POST', body: JSON.stringify(payload) });
      if (res?.success) {
        closeDrawer();
        await loadInvitaciones();
        showCodigoModal(res.data.codigo, payload.nombreVisitante);
      } else {
        alert(res?.message || 'Error al crear la invitación');
      }
    } catch (err) {
      alert('Error de conexión al crear la invitación');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Crear Invitación
        `;
      }
    }
  });

  document.getElementById('bottom-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

/* ─── VEHÍCULOS Y AUTORIZACIONES (NUEVO MÓDULO) ──────────────────────────────── */
async function loadVehiculos() {
  const res = await apiCall('/api/vehicles/mis-vehiculos');
  if (!res?.success) return;

  const { vehicles, sentInvitations, receivedInvitations, resident } = res.data;
  currentResidentId = resident?._id || currentResidentId;

  // 1. Invitaciones Recibidas Pendientes
  const recibidasContainer = document.getElementById('vehiculos-invitaciones-recibidas-container');
  const recibidasList = document.getElementById('vehiculos-recibidas-list');
  const badgeVehiculos = document.getElementById('badge-vehiculos');

  if (receivedInvitations && receivedInvitations.length > 0) {
    recibidasContainer.style.display = 'block';
    if (badgeVehiculos) {
      badgeVehiculos.textContent = receivedInvitations.length;
      badgeVehiculos.style.display = 'flex';
    }

    recibidasList.innerHTML = receivedInvitations.map(inv => `
      <div style="background:white; border:1px solid #bfdbfe; border-radius:var(--radius); padding:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-weight:700; font-size:14px; color:#1e3a8a;">
            ${escHtml(inv.propietario_nombre || 'Un residente')} te invita a usar el vehículo
          </div>
          <div style="font-size:13px; color:#475569; margin-top:2px;">
            Placa: <strong>${escHtml(inv.placa)}</strong> &middot; ${inv.vehicle_id?.marca || ''} ${inv.vehicle_id?.modelo || ''} (${inv.vehicle_id?.tipo || 'Vehículo'})
          </div>
          ${inv.mensaje ? `<div style="font-size:12px; color:#64748b; font-style:italic; margin-top:2px;">"${escHtml(inv.mensaje)}"</div>` : ''}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-primary-sm" onclick="responderInvitacionVehiculo('${inv._id}', 'aceptar')">Aceptar</button>
          <button class="btn-secondary-sm" style="color:#dc2626;" onclick="responderInvitacionVehiculo('${inv._id}', 'rechazar')">Rechazar</button>
        </div>
      </div>
    `).join('');
  } else {
    recibidasContainer.style.display = 'none';
    if (badgeVehiculos) badgeVehiculos.style.display = 'none';
  }

  // 2. Lista de Vehículos
  const listContainer = document.getElementById('vehiculos-list');
  if (!vehicles || !vehicles.length) {
    listContainer.innerHTML = `
      <div class="empty-state-sm">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#ccc" stroke-width="1.5" style="margin:0 auto 8px"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
        <p>No tienes vehículos registrados o asignados</p>
      </div>`;
  } else {
    listContainer.innerHTML = vehicles.map(v => {
      const isPrincipal = (v.responsablePrincipal?._id && String(v.responsablePrincipal._id) === String(currentResidentId)) ||
                          (!v.responsablePrincipal && v.propietarios && String(v.propietarios[0]) === String(currentResidentId));

      const roleBadge = isPrincipal
        ? '<span class="badge" style="background:#fef3c7;color:#92400e;font-weight:700;">⭐ Responsable Principal</span>'
        : '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:600;">👤 Persona Autorizada</span>';

      const fotoHtml = v.foto
        ? `<img src="${v.foto}" style="width:64px; height:64px; border-radius:var(--radius); object-fit:cover;">`
        : `<div style="width:64px; height:64px; border-radius:var(--radius); background:#e2e8f0; display:flex; align-items:center; justify-content:center;">
             <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#94a3b8" stroke-width="1.8"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>
           </div>`;

      // Lista de personas autorizadas
      let autorizadosHtml = '';
      if (v.autorizados && v.autorizados.length > 0) {
        autorizadosHtml = `
          <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
            <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase;">
              Personas Autorizadas:
            </div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${v.autorizados.map(a => `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg); padding:6px 10px; border-radius:6px; font-size:13px;">
                  <span><strong>${escHtml(a.nombre)}</strong> (Apto ${a.apartamento || '—'})</span>
                  ${isPrincipal ? `<button class="link-btn" style="color:#dc2626; font-size:12px;" onclick="removerAutorizado('${v._id}', '${a._id}', '${escHtml(a.nombre)}')">Quitar</button>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      } else if (isPrincipal) {
        autorizadosHtml = `
          <div style="margin-top:8px; font-size:12px; color:var(--text-faint);">
            No hay otras personas autorizadas para este vehículo.
          </div>
        `;
      }

      return `
        <div class="panel-card" style="padding:16px;">
          <div style="display:flex; gap:14px; align-items:flex-start;">
            ${fotoHtml}
            <div style="flex:1;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:4px;">
                <h3 style="font-size:17px; font-weight:800; color:var(--text); letter-spacing:0.5px;">${escHtml(v.placa || 'SIN PLACA')}</h3>
                ${roleBadge}
              </div>
              <div style="font-size:13px; color:var(--text-muted);">
                ${escHtml(v.tipo)} &middot; ${escHtml(v.marca || '')} ${escHtml(v.modelo || '')} ${v.color ? `(${escHtml(v.color)})` : ''}
              </div>
              <div style="font-size:12px; color:var(--text-faint); margin-top:2px;">
                Apto: <strong>${escHtml(v.apartamento)}</strong> &middot; Responsable: ${escHtml(v.responsablePrincipal?.nombre || 'Tú')}
              </div>
            </div>
          </div>

          ${autorizadosHtml}

          ${isPrincipal ? `
            <div style="margin-top:12px; display:flex; justify-content:flex-end;">
              <button class="btn-primary-sm" onclick="openInvitarModal('${v._id}', '${v.placa}')">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Autorizar a un residente
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  // 3. Historial de Invitaciones Enviadas
  const enviadasContainer = document.getElementById('vehiculos-invitaciones-enviadas-container');
  const enviadasList = document.getElementById('vehiculos-enviadas-list');

  if (sentInvitations && sentInvitations.length > 0) {
    enviadasContainer.style.display = 'block';
    enviadasList.innerHTML = sentInvitations.map(inv => {
      const stateBadge = inv.estado === 'pendiente'
        ? '<span class="badge" style="background:#fef3c7;color:#92400e">⏳ Pendiente de aceptación</span>'
        : inv.estado === 'aceptada'
        ? '<span class="badge" style="background:#dcfce7;color:#15803d">✓ Aceptada</span>'
        : inv.estado === 'rechazada'
        ? '<span class="badge" style="background:#fee2e2;color:#991b1b">✕ Rechazada</span>'
        : '<span class="badge" style="background:#f1f5f9;color:#64748b">Cancelada</span>';

      return `
        <div class="panel-card" style="padding:10px 14px; display:flex; justify-content:space-between; align-items:center; font-size:13px;">
          <div>
            <strong>${escHtml(inv.residente_invitado_nombre)}</strong> (Apto ${inv.apartamento || '—'}) &middot; Placa: <strong>${escHtml(inv.placa)}</strong>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${stateBadge}
            ${inv.estado === 'pendiente' ? `<button class="link-btn" style="color:#dc2626; font-size:12px;" onclick="cancelarInvitacionVehiculo('${inv._id}')">Cancelar</button>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } else {
    enviadasContainer.style.display = 'none';
  }
}

/* ─── MODAL: INVITAR A UN RESIDENTE PARA AUTORIZACIÓN VEHICULAR ──────────────── */
async function openInvitarModal(vehicleId, placa) {
  const modalBody = document.getElementById('modal-body');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCard = document.getElementById('modal-card');
  if (!modalBody || !modalOverlay) return;

  modalBody.innerHTML = `
    <h3 style="margin-bottom:6px; font-size:18px; font-weight:800; color:var(--text);">Autorizar a un Residente</h3>
    <p style="font-size:13px; color:var(--text-muted); margin-bottom:16px;">
      Selecciona al residente del conjunto al que deseas autorizar para utilizar el vehículo <strong style="color:var(--text);">${escHtml(placa || 'del apartamento')}</strong>. La persona recibirá una notificación y deberá aceptar la invitación.
    </p>

    <form id="form-invitar-vehiculo" style="display:flex; flex-direction:column; gap:14px;">
      <div class="field" style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:13px; font-weight:600; color:var(--text);">Buscar residente por apartamento o nombre *</label>
        <select id="inv-veh-residente" required style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius); font-size:14px; background:var(--white); color:var(--text); outline:none;">
          <option value="">Cargando residentes del conjunto…</option>
        </select>
      </div>

      <div class="field" style="display:flex; flex-direction:column; gap:6px;">
        <label style="font-size:13px; font-weight:600; color:var(--text);">Mensaje opcional</label>
        <input type="text" id="inv-veh-mensaje" placeholder="Ej. Puedes usar el carro para las compras" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius); font-size:14px; background:var(--white); color:var(--text); outline:none;">
      </div>

      <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
        <button type="submit" class="btn-primary" style="width:100%; padding:12px; font-weight:700;">Enviar Invitación de Autorización</button>
        <button type="button" class="btn-secondary" style="width:100%;" onclick="closeModal()">Cancelar</button>
      </div>
    </form>
  `;

  modalOverlay.style.display = 'flex';
  requestAnimationFrame(() => {
    modalOverlay.classList.add('show');
    if (modalCard) modalCard.classList.add('show');
  });

  // Cargar residentes del conjunto
  try {
    const res = await apiCall('/api/residents?limit=200');
    const select = document.getElementById('inv-veh-residente');
    if (select) {
      if (res?.success && res.data?.length > 0) {
        const validResidents = res.data.filter(r => String(r._id) !== String(currentResidentId));
        if (validResidents.length > 0) {
          select.innerHTML = '<option value="">Selecciona un residente…</option>' + validResidents.map(r => `
            <option value="${r._id}">${r.nombre} &middot; Apto ${r.apartamento} (C.C. ${r.cedula || '—'})</option>
          `).join('');
        } else {
          select.innerHTML = '<option value="">No hay otros residentes disponibles</option>';
        }
      } else {
        select.innerHTML = '<option value="">No se encontraron residentes</option>';
      }
    }
  } catch (err) {
    const select = document.getElementById('inv-veh-residente');
    if (select) select.innerHTML = '<option value="">Error al cargar residentes</option>';
  }

  const form = document.getElementById('form-invitar-vehiculo');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const residenteId = document.getElementById('inv-veh-residente').value;
      const mensaje = document.getElementById('inv-veh-mensaje').value.trim();

      if (!residenteId) return alert('Debes seleccionar un residente');

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando…';
      }

      try {
        const resp = await apiCall(`/api/vehicles/${vehicleId}/invitar`, {
          method: 'POST',
          body: JSON.stringify({ residente_id: residenteId, mensaje })
        });

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar Invitación de Autorización';
        }

        if (resp?.success) {
          closeModal();
          alert('Invitación enviada exitosamente. El residente recibirá la notificación para aceptar.');
          await loadVehiculos();
        } else {
          alert(resp?.message || 'Error al enviar la invitación');
        }
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar Invitación de Autorización';
        }
        alert('Error de conexión al enviar la invitación');
      }
    });
  }
}

async function responderInvitacionVehiculo(invitationId, accion) {
  const actionText = accion === 'aceptar' ? '¿Aceptar la autorización para este vehículo?' : '¿Rechazar esta invitación?';
  if (!confirm(actionText)) return;

  const res = await apiCall(`/api/vehicles/invitaciones/${invitationId}/responder`, {
    method: 'PATCH',
    body: JSON.stringify({ accion })
  });

  if (res?.success) {
    await loadVehiculos();
    await loadNotificaciones();
  } else {
    alert(res?.message || 'Error al procesar la respuesta');
  }
}

async function removerAutorizado(vehicleId, residentId, nombre) {
  if (!confirm(`¿Quitar la autorización a ${nombre} para usar este vehículo?`)) return;

  const res = await apiCall(`/api/vehicles/${vehicleId}/autorizados/${residentId}`, {
    method: 'DELETE',
  });

  if (res?.success) {
    await loadVehiculos();
  } else {
    alert(res?.message || 'Error al remover la persona autorizada');
  }
}

async function cancelarInvitacionVehiculo(invitationId) {
  if (!confirm('¿Cancelar esta invitación de autorización?')) return;

  const res = await apiCall(`/api/vehicles/invitaciones/${invitationId}`, {
    method: 'DELETE',
  });

  if (res?.success) {
    await loadVehiculos();
  } else {
    alert(res?.message || 'Error al cancelar la invitación');
  }
}

window.openInvitarModal = openInvitarModal;
window.responderInvitacionVehiculo = responderInvitacionVehiculo;
window.removerAutorizado = removerAutorizado;
window.cancelarInvitacionVehiculo = cancelarInvitacionVehiculo;

/* ─── UTILIDADES DE MODALES Y CÓDIGOS ────────────────────────────────────────── */
function showCodigoModal(codigo, nombre) {
  const modalBody = document.getElementById('modal-body');
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCard = document.getElementById('modal-card');
  if (!modalBody || !modalOverlay) return;

  modalBody.innerHTML = `
    <div style="text-align:center; padding: 6px 0 2px;">
      <h3 style="margin-bottom:6px; font-size:18px; font-weight:800; color:var(--text-dark);">Código de Invitación</h3>
      <p style="font-size:13.5px; color:var(--text-muted); margin-bottom:18px;">
        Para: <strong style="color:var(--text);">${escHtml(nombre)}</strong>
      </p>
      <div class="inv-codigo" style="display:flex; justify-content:center; flex-direction:column; align-items:center; gap:8px; padding:20px 14px; background:var(--acento-bg); border:2px dashed var(--acento); border-radius:var(--radius); margin-bottom:18px;">
        <span class="inv-codigo-label" style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:1.2px;">Presentar en portería</span>
        <span class="inv-codigo-num" style="font-size:38px; font-weight:800; letter-spacing:8px; color:var(--acento); font-family:monospace;">${codigo}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button type="button" class="btn-primary" style="width:100%;" onclick="copiarCodigo('${codigo}')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copiar Código
        </button>
        <button type="button" class="btn-secondary" style="width:100%;" onclick="closeModal()">
          Cerrar
        </button>
      </div>
      <p style="font-size:12px; color:var(--text-faint); margin-top:12px;">Este código expira cuando sea utilizado o cancelado.</p>
    </div>
  `;

  modalOverlay.style.display = 'flex';
  requestAnimationFrame(() => {
    modalOverlay.classList.add('show');
    if (modalCard) modalCard.classList.add('show');
  });
}

async function copiarCodigo(codigo) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(codigo);
    } else {
      const input = document.createElement('input');
      input.value = codigo;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.focus();
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    alert(`¡Código ${codigo} copiado al portapapeles!`);
  } catch (err) {
    prompt('Copia el código manualmente:', codigo);
  }
}

async function cancelarInvitacion(id) {
  if (!confirm('¿Cancelar esta invitación?')) return;
  const res = await apiCall(`/api/invitations/${id}`, { method: 'DELETE' });
  if (res?.success) await loadInvitaciones();
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

/* ─── DRAWER / MODAL ─────────────────────────────────────────────────────────── */
function closeDrawer() {
  document.getElementById('bottom-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
}
function closeModal() {
  const modalOverlay = document.getElementById('modal-overlay');
  const modalCard = document.getElementById('modal-card');
  if (modalCard) modalCard.classList.remove('show');
  if (modalOverlay) {
    modalOverlay.classList.remove('show');
    setTimeout(() => {
      modalOverlay.style.display = 'none';
    }, 200);
  }
}

/* ─── LOGOUT ─────────────────────────────────────────────────────────────────── */
async function doLogout() {
  try { await apiCall('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  localStorage.removeItem('sgar_token');
  localStorage.removeItem('sgar_user');
  document.cookie = 'token=; Max-Age=0; path=/';
  window.location.href = '/admin/login';
}

/* ─── API HELPER ─────────────────────────────────────────────────────────────── */
async function apiCall(path, options = {}, withAuth = true) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (withAuth) {
    const token = localStorage.getItem('sgar_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res  = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json();
  if (res.status === 401 && withAuth) doLogout();
  return data;
}

/* ─── UTILIDADES ─────────────────────────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function fmtTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
