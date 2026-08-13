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
        <button class="btn-secondary btn-sm" onclick="editCelador('${u._id}', ${JSON.stringify(u).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-secondary btn-sm" style="color:#d32f2f; border-color:#d32f2f; margin-left: 5px;" onclick="deleteCelador('${u._id}')">
          Eliminar
        </button>
      </td>
    </tr>
  `).join('');
}

function openNew() {
  document.getElementById('c-edit-id').value = '';
  document.getElementById('form-celador').reset();
  const pwdEl = document.getElementById('c-pwd');
  if (pwdEl) { pwdEl.value = ''; pwdEl.required = true; }
  const pwdReq = document.getElementById('c-pwd-req');
  if (pwdReq) pwdReq.style.display = 'inline';
  const pwdHint = document.getElementById('c-pwd-hint');
  if (pwdHint) pwdHint.style.display = 'none';
  document.getElementById('field-c-estado').style.display = 'none';
  document.getElementById('drawer-title').textContent = 'Nuevo Celador';
  SGAR.clearFormError('c-form-error');
  SGAR.openDrawer('drawer-celador');
}

window.editCelador = function(id, c) {
  document.getElementById('c-edit-id').value = id;
  document.getElementById('c-nombre').value = c.nombre;
  document.getElementById('c-email').value = c.email;
  const pwdEl = document.getElementById('c-pwd');
  if (pwdEl) { pwdEl.value = ''; pwdEl.required = false; }
  const pwdReq = document.getElementById('c-pwd-req');
  if (pwdReq) pwdReq.style.display = 'none';
  const pwdHint = document.getElementById('c-pwd-hint');
  if (pwdHint) pwdHint.style.display = 'block';
  document.getElementById('c-activo').value = c.activo ? 'true' : 'false';
  document.getElementById('field-c-estado').style.display = 'block';
  document.getElementById('drawer-title').textContent = 'Editar Celador';
  SGAR.clearFormError('c-form-error');
  SGAR.openDrawer('drawer-celador');
}

async function submitCelador(e) {
  e.preventDefault();
  const id = document.getElementById('c-edit-id').value;
  const nombre = document.getElementById('c-nombre').value.trim();
  const email = document.getElementById('c-email').value.trim();
  const pwd = document.getElementById('c-pwd')?.value || '';

  if (!id && (!pwd || pwd.length < 6)) {
    SGAR.showFormError('c-form-error', 'La contraseña es requerida (mínimo 6 caracteres)');
    return;
  }

  const body = {
    nombre,
    email,
    rol: 'celador',
  };
  if (pwd) body.password = pwd;

  SGAR.clearFormError('c-form-error');

  if (id) {
    const activo = document.getElementById('c-activo').value === 'true';
    const res = await SGAR.api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!res?.success) { SGAR.showFormError('c-form-error', res?.message || 'Error al actualizar'); return; }
    
    if (pwd) {
      await SGAR.api(`/api/users/${id}/password`, { method: 'PATCH', body: JSON.stringify({ newPassword: pwd }) });
    }
    
    const currentUser = await SGAR.api(`/api/users?rol=celador`);
    const cUser = currentUser?.data?.find(u => u._id === id);
    if (cUser && cUser.activo !== activo) {
      await SGAR.api(`/api/users/${id}/toggle`, { method: 'PATCH' });
    }
  } else {
    const res = await SGAR.api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    if (!res?.success) { SGAR.showFormError('c-form-error', res?.message || 'Error al guardar celador'); return; }
  }

  SGAR.closeDrawer('drawer-celador');
  loadCeladores();
}

async function deleteCelador(id) {
  if (!confirm('¿Estás seguro de eliminar este celador? Esta acción no se puede deshacer.')) return;
  const res = await SGAR.api(`/api/users/${id}`, { method: 'DELETE' });
  if (!res?.success) { alert(res?.message || 'Error al eliminar'); return; }
  loadCeladores();
}

