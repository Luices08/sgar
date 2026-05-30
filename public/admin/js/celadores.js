'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-celador');
  document.getElementById('btn-nuevo').addEventListener('click', openNew);
  document.getElementById('form-celador').addEventListener('submit', submitCelador);
  loadCeladores();
});

async function loadCeladores() {
  const data = await SGAR.api('/api/users?rol=celador&limit=50');
  if (!data?.success) return;

  const tbody = document.getElementById('celadores-tbody');
  const users = data.data;

  document.getElementById('sub-count').textContent = `${data.pagination.total} celadores`;

  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-loading">No hay celadores registrados</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.nombre}</td>
      <td>${u.email}</td>
      <td>${SGAR.fmtDate(u.ultimoAcceso)}</td>
      <td>${SGAR.activeBadge(u.activo)}</td>
      <td>
        <button class="btn-secondary btn-sm" onclick="toggleUser('${u._id}', ${u.activo})">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join('');
}

function openNew() {
  document.getElementById('c-edit-id').value = '';
  document.getElementById('form-celador').reset();
  SGAR.clearFormError('c-form-error');
  SGAR.openDrawer('drawer-celador');
}

async function submitCelador(e) {
  e.preventDefault();
  const body = {
    nombre:   document.getElementById('c-nombre').value.trim(),
    email:    document.getElementById('c-email').value.trim(),
    password: document.getElementById('c-pwd').value,
    rol:      'celador',
  };
  SGAR.clearFormError('c-form-error');
  const res = await SGAR.api('/api/users', { method: 'POST', body: JSON.stringify(body) });
  if (!res?.success) { SGAR.showFormError('c-form-error', res?.message || 'Error'); return; }
  SGAR.closeDrawer('drawer-celador');
  loadCeladores();
}

async function toggleUser(id, activo) {
  if (!confirm(`¿${activo ? 'Desactivar' : 'Activar'} este celador?`)) return;
  const res = await SGAR.api(`/api/users/${id}/toggle`, { method: 'PATCH' });
  if (!res?.success) { alert(res?.message || 'Error'); return; }
  loadCeladores();
}
