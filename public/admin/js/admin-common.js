/* ─── SGAR Admin Common — utilidades compartidas ─────────────────────────────── */
'use strict';

const SGAR = (() => {
  /* ── TOKEN & USER ──────────────────────────────────────────────────────────── */
  const getToken  = () => localStorage.getItem('sgar_token');
  const getUser   = () => JSON.parse(localStorage.getItem('sgar_user') || 'null');
  const getTenant = () => {
    const imp = localStorage.getItem('sgar_impersonate_tenant');
    if (imp) return JSON.parse(imp);
    return JSON.parse(localStorage.getItem('sgar_tenant') || 'null');
  };

  function requireAuth() {
    const user = getUser();
    const token = getToken();
    if (!user || !token) { window.location.href = '/admin/login'; return null; }
    return user;
  }

  /* ── ACCENT COLOR & IMPERSONATION UI ───────────────────────────────────────── */
  function applyAccent() {
    const user   = getUser();
    const tenant = getTenant();
    const imp    = localStorage.getItem('sgar_impersonate_tenant');
    let color;
    
    if (user && user.rol === 'adminControl') {
      if (imp) {
        // Impersonando
        document.getElementById('nav-admincontrol').style.display = 'none';
        document.getElementById('nav-adminconjunto').style.display = '';
        document.getElementById('btn-exit-impersonate').style.display = 'flex';
        color = (tenant && tenant.colorAcento) ? tenant.colorAcento : '#2563eb';
      } else {
        // Normal adminControl
        document.getElementById('nav-admincontrol').style.display = '';
        document.getElementById('nav-adminconjunto').style.display = 'none';
        color = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim() || '#2563eb';
      }
    } else {
      color = (tenant && tenant.colorAcento) ? tenant.colorAcento : '#2563eb';
    }
    document.documentElement.style.setProperty('--acento', color);
  }

  /* ── API FETCH ─────────────────────────────────────────────────────────────── */
  async function api(path, options = {}) {
    const token = getToken();
    const user = getUser();
    const imp = localStorage.getItem('sgar_impersonate_tenant');

    if (user && user.rol === 'adminControl' && imp) {
      const impTenant = JSON.parse(imp);
      if (options.method && options.method !== 'GET' && options.method !== 'HEAD') {
        if (!options.body) options.body = '{}';
        const bodyObj = JSON.parse(options.body);
        bodyObj.tenant_id = impTenant._id;
        options.body = JSON.stringify(bodyObj);
      } else {
        const sep = path.includes('?') ? '&' : '?';
        path += `${sep}tenant_id=${impTenant._id}`;
      }
    }

    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(path, { ...options, headers });

    if (res.status === 401) { logout(); return null; }

    const data = await res.json();
    return data;
  }

  async function apiForm(path, formData, method = 'POST') {
    const token = getToken();
    const user = getUser();
    const imp = localStorage.getItem('sgar_impersonate_tenant');
    if (user && user.rol === 'adminControl' && imp) {
      const impTenant = JSON.parse(imp);
      formData.append('tenant_id', impTenant._id);
    }

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(path, { method, headers, body: formData });
    if (res.status === 401) { logout(); return null; }
    return res.json();
  }

  /* ── LOGOUT ────────────────────────────────────────────────────────────────── */
  function logout() {
    localStorage.removeItem('sgar_token');
    localStorage.removeItem('sgar_user');
    localStorage.removeItem('sgar_tenant');
    localStorage.removeItem('sgar_impersonate_tenant');
    document.cookie = 'token=; Max-Age=0; path=/';
    window.location.href = '/admin/login';
  }

  /* ── DRAWER ────────────────────────────────────────────────────────────────── */
  function openDrawer(drawerId) {
    document.getElementById(drawerId).classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer(drawerId) {
    document.getElementById(drawerId).classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  function initDrawer(drawerId) {
    const overlay = document.getElementById('drawer-overlay');
    const closeBtn = document.getElementById('drawer-close');
    if (overlay) overlay.addEventListener('click', () => closeDrawer(drawerId));
    if (closeBtn) closeBtn.addEventListener('click', () => closeDrawer(drawerId));
  }

  /* ── PAGINATION ────────────────────────────────────────────────────────────── */
  function renderPagination(containerId, pagination, onPage) {
    const el = document.getElementById(containerId);
    if (!el || !pagination) return;
    const { page, totalPages } = pagination;
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    let html = '';
    html += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} data-p="${page - 1}">←</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" data-p="${i}">${i}</button>`;
      } else if (Math.abs(i - page) === 2) {
        html += `<span class="page-btn" style="pointer-events:none">…</span>`;
      }
    }
    html += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} data-p="${page + 1}">→</button>`;
    el.innerHTML = html;
    el.querySelectorAll('button[data-p]').forEach(btn =>
      btn.addEventListener('click', () => onPage(Number(btn.dataset.p)))
    );
  }

  /* ── DATE UTILS ────────────────────────────────────────────────────────────── */
  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function fmtTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  function todayISO() {
    return new Date().toISOString().split('T')[0];
  }

  /* ── BADGE ─────────────────────────────────────────────────────────────────── */
  function tipoBadge(tipo) {
    const map = { visita: 'Visita', domicilio: 'Domicilio', vehiculo: 'Vehículo' };
    return `<span class="badge badge-${tipo}">${map[tipo] || tipo}</span>`;
  }
  function activeBadge(activo) {
    return activo
      ? '<span class="badge badge-active">Activo</span>'
      : '<span class="badge badge-inactive">Inactivo</span>';
  }

  /* ── LOGOUT BUTTON ─────────────────────────────────────────────────────────── */
  function initLogout() {
    const btn = document.getElementById('btn-logout');
    if (btn) btn.addEventListener('click', logout);
    
    const exitBtn = document.getElementById('btn-exit-impersonate');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        localStorage.removeItem('sgar_impersonate_tenant');
        window.location.href = '/admin/dashboard';
      });
    }
  }

  /* ── SHOW ERROR ────────────────────────────────────────────────────────────── */
  function showFormError(elId, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent    = msg;
    el.style.display  = 'block';
  }
  function clearFormError(elId) {
    const el = document.getElementById(elId);
    if (el) el.style.display = 'none';
  }

  return {
    getToken, getUser, getTenant, requireAuth, applyAccent,
    api, apiForm, logout,
    openDrawer, closeDrawer, initDrawer,
    renderPagination,
    fmtDate, fmtTime, todayISO,
    tipoBadge, activeBadge,
    initLogout, showFormError, clearFormError,
  };
})();

/* Inicializar al cargar la página */
document.addEventListener('DOMContentLoaded', () => {
  SGAR.initLogout();
  SGAR.applyAccent();
});
