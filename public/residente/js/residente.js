/* ─── SGAR Residente — Lógica principal ─────────────────────────────────────── */
'use strict';

const API_BASE = '';
let residenteData = null;

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

  // UI del menú
  const nombre = residenteData?.nombre || user.nombre || 'Residente';
  document.getElementById('menu-name').textContent   = nombre;
  document.getElementById('menu-avatar').textContent = nombre.charAt(0).toUpperCase();
  document.getElementById('header-title').textContent = 'Mi Portal';

  // Obtener apartamento desde resident_id si disponible
  if (user.tenant_id) {
    // El apartamento se carga desde notificaciones
  }

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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

  // Filtro historial
  document.getElementById('filter-historial').addEventListener('change', loadHistorial);

  // Cargar datos iniciales
  await Promise.all([loadNotificaciones(), loadHistorial(), loadInvitaciones()]);

  // Refrescar notificaciones cada 60s
  setInterval(loadNotificaciones, 60000);
}

/* ─── TABS ───────────────────────────────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

/* ─── NOTIFICACIONES ─────────────────────────────────────────────────────────── */
async function loadNotificaciones() {
  const data = await apiCall('/api/notifications');
  if (!data?.success) return;

  const { notifications, unread } = data.data;
  const list = document.getElementById('notif-list');
  const badge = document.getElementById('badge-notif');

  // Badge
  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }

  if (!notifications.length) {
    list.innerHTML = '<div class="empty-state-sm">Sin avisos recientes</div>';
    return;
  }

  const iconMap = { visita: '👤', domicilio: '📦', vehiculo: '🚗', sistema: '🔔', autorizacion_visita: '❓' };

  list.innerHTML = notifications.map(n => `
    <div class="notif-card ${n.leida ? '' : 'unread'}">
      <div class="notif-icon ${n.tipo}">${iconMap[n.tipo] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-titulo">${escHtml(n.titulo)}</div>
        <div class="notif-msg">${escHtml(n.mensaje)}</div>
        
        ${n.tipo === 'autorizacion_visita' && n.estadoAprobacion === 'pendiente' ? `
          <div style="margin-top: 10px; display:flex; gap:8px;">
            <button class="btn-primary" style="flex:1; padding:8px; font-size:0.9rem; border-radius:4px;" onclick="responderAutorizacion('${n._id}', 'aprobado')">Aceptar</button>
            <button class="btn-outline" style="flex:1; padding:8px; font-size:0.9rem; border-radius:4px; color:#ef4444; border-color:#ef4444;" onclick="responderAutorizacion('${n._id}', 'rechazado')">Rechazar</button>
          </div>
        ` : ''}

        ${n.tipo === 'autorizacion_visita' && n.estadoAprobacion !== 'pendiente' ? `
          <div style="margin-top: 5px; font-size:0.85rem; font-weight:bold; color: ${n.estadoAprobacion === 'aprobado' ? '#10b981' : '#ef4444'}">
            Visita ${n.estadoAprobacion.toUpperCase()}
          </div>
        ` : ''}

        <div class="notif-time" style="margin-top:5px;">${fmtDate(n.createdAt)}</div>
      </div>
    </div>
  `).join('');
}

window.responderAutorizacion = async function(id, status) {
  const res = await apiCall(`/api/notifications/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
  if (res?.success) {
    await loadNotificaciones();
  } else {
    alert(res?.message || 'Error al procesar la respuesta');
  }
}

async function markAllRead() {
  const res = await apiCall('/api/notifications/read', { method: 'PATCH' });
  if (res?.success) await loadNotificaciones();
}

/* ─── HISTORIAL ──────────────────────────────────────────────────────────────── */
async function loadHistorial() {
  const tipo = document.getElementById('filter-historial').value;
  let url = '/api/visits?limit=30';
  // El backend filtra por tenant_id del JWT
  // Para ver solo el apartamento del residente, el backend necesita filtro
  // por apartamento — se pasa si está disponible en residenteData
  if (tipo) url += `&tipo=${tipo}`;

  const data = await apiCall(url);
  if (!data?.success) return;

  const visits = data.data;
  const list   = document.getElementById('historial-list');

  if (!visits.length) {
    list.innerHTML = '<div class="empty-state-sm">Sin registros de visitas</div>';
    return;
  }

  list.innerHTML = visits.map(v => `
    <div class="history-card">
      <span class="hist-badge ${v.tipo}">${v.tipo}</span>
      <div class="hist-info">
        <div class="hist-name">${escHtml(v.nombre || v.empresa || v.placa || '—')}</div>
        <div class="hist-meta">
          Apto ${v.apartamento} · ${fmtDate(v.horaIngreso)}
          ${v.horaSalida ? ' · Salida: ' + fmtTime(v.horaSalida) : ''}
        </div>
      </div>
    </div>
  `).join('');
}

/* ─── INVITACIONES ───────────────────────────────────────────────────────────── */
async function loadInvitaciones() {
  const data = await apiCall('/api/invitations/mine');
  if (!data?.success) return;

  const invs  = data.data.invitations;
  const list  = document.getElementById('invitaciones-list');

  if (!invs.length) {
    list.innerHTML = '<div class="empty-state-sm">No tienes invitaciones activas.<br>Crea una para tu próxima visita.</div>';
    return;
  }

  list.innerHTML = invs.map(inv => `
    <div class="inv-card">
      <div class="inv-card-header">
        <div>
          <span class="inv-visitante">${escHtml(inv.nombreVisitante)}</span>
          ${inv.cedulaVisitante ? `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Céd: ${escHtml(inv.cedulaVisitante)}</div>` : ''}
        </div>
        <span class="inv-status ${inv.estado}">${inv.estado}</span>
      </div>
      <div class="inv-meta">
        ${inv.personasEsperadas > 1 ? `<span>&#128101; ${inv.personasEsperadas} personas</span> &middot; ` : ''}
        Vence: ${fmtDate(inv.tiempo_caducidad)}
      </div>
      ${inv.estado === 'pendiente' ? `
        <div class="inv-codigo">
          <span class="inv-codigo-label">Código para el celador</span>
          <span class="inv-codigo-num">${inv.codigo}</span>
        </div>
        <div class="inv-actions">
          <button class="btn-action-sm" onclick="copiarCodigo('${inv.codigo}')">
            &#128203; Copiar código
          </button>
          <button class="btn-outline" onclick="cancelarInvitacion('${inv._id}')">
            Cancelar
          </button>
        </div>
      ` : ''}
    </div>
  `).join('');
}

function openFormInvitacion() {
  const html = `
    <div id="inv-error" class="form-error" style="display:none"></div>

    <div class="form-field">
      <label>Nombre del visitante *</label>
      <input type="text" id="inv-nombre" placeholder="Ej: Juan Pérez" autocomplete="off">
    </div>

    <div class="form-field">
      <label>Cédula del visitante</label>
      <input type="text" id="inv-cedula" placeholder="Opcional" autocomplete="off" inputmode="numeric">
    </div>

    <div class="form-row">
      <div class="form-field">
        <label>Nº de personas *</label>
        <input type="number" id="inv-personas" value="1" min="1" max="20">
      </div>
      <div class="form-field">
        <label>Vigencia *</label>
        <select id="inv-caducidad">
          <option value="12h">12 Horas</option>
          <option value="1d" selected>1 Día</option>
          <option value="2d">2 Días</option>
          <option value="3d">3 Días</option>
          <option value="5d">5 Días</option>
          <option value="7d">7 Días</option>
        </select>
      </div>
    </div>

    <div class="form-field">
      <label>Fecha y hora de llegada <span style="font-weight:400; text-transform:none; color:var(--text-muted);">(Opcional)</span></label>
      <input type="datetime-local" id="inv-fecha">
    </div>

    <button class="btn-action" id="btn-crear-inv">Crear invitación</button>
  `;

  document.getElementById('drawer-title').textContent = 'Nueva Invitación';
  document.getElementById('drawer-body').innerHTML    = html;
  document.getElementById('bottom-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  document.getElementById('btn-crear-inv').addEventListener('click', crearInvitacion);
}

async function crearInvitacion() {
  const nombre   = document.getElementById('inv-nombre').value.trim();
  const cedula   = document.getElementById('inv-cedula').value.trim();
  const personas = document.getElementById('inv-personas').value;
  const caducidad= document.getElementById('inv-caducidad').value;
  const fecha    = document.getElementById('inv-fecha').value;
  const errEl    = document.getElementById('inv-error');

  if (!nombre) { errEl.textContent = 'El nombre del visitante es requerido'; errEl.style.display = ''; return; }

  errEl.style.display = 'none';

  const bodyData = {
    nombreVisitante: nombre,
    cedulaVisitante: cedula || undefined,
    personasEsperadas: parseInt(personas) || 1,
    tiempo_caducidad: caducidad,
  };
  
  if (fecha) {
    bodyData.fechaEsperada = new Date(fecha).toISOString();
  }

  const res = await apiCall('/api/invitations', {
    method: 'POST',
    body: JSON.stringify(bodyData),
  });

  if (!res?.success) { errEl.textContent = res?.message || 'Error al crear'; errEl.style.display = ''; return; }

  closeDrawer();
  await loadInvitaciones();
  switchTab('invitaciones');

  // Mostrar y copiar código
  const inv = res.data.invitation;
  copiarCodigo(inv.codigo);
}

async function copiarCodigo(codigo) {
  try {
    await navigator.clipboard.writeText(codigo);
    alert('Código copiado al portapapeles: ' + codigo);
  } catch (err) {
    // Fallback
    const input = document.createElement('input');
    input.value = codigo;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('Código copiado: ' + codigo);
  }
}

async function cancelarInvitacion(id) {
  if (!confirm('¿Cancelar esta invitación?')) return;
  const res = await apiCall(`/api/invitations/${id}`, { method: 'DELETE' });
  if (res?.success) await loadInvitaciones();
}

function showCodigoModal(codigo, nombre) {
  document.getElementById('modal-body').innerHTML = `
    <h3 style="margin-bottom:8px">Código de invitación</h3>
    <p style="font-size:13px;color:#777;margin-bottom:16px">Para: ${escHtml(nombre)}</p>
    <div class="inv-codigo" style="justify-content:center;flex-direction:column;gap:8px;padding:16px">
      <span class="inv-codigo-label">Presentar en portería</span>
      <span class="inv-codigo-num" style="font-size:36px;letter-spacing:8px">${codigo}</span>
    </div>
    <p style="font-size:12px;color:#aaa;margin-top:14px">Este código expira cuando sea usado o cancelado.</p>
  `;
  document.getElementById('modal-overlay').style.display = 'flex';
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
  document.getElementById('modal-overlay').style.display = 'none';
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
