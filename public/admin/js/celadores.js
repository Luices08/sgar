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
        <button class="btn-secondary btn-sm" onclick="openEdit(${JSON.stringify(u).replace(/"/g,'&quot;')})">Editar</button>
        <button class="btn-secondary btn-sm" style="color:#d32f2f; border-color:#d32f2f; margin-left: 5px;" onclick="deleteCelador('${u._id}')">
          Eliminar
        </button>
      </td>
    </tr>
  `).join('');
}

function openNew() {
  document.getElementById('c-edit-id').value = '';
  document.getElementById('drawer-title').textContent = 'Nuevo Celador';
  document.getElementById('form-celador').reset();
  document.getElementById('c-pwd').required = true;
  document.getElementById('c-pwd-label').textContent = 'Contraseña *';
  document.getElementById('c-pwd-hint').style.display = 'none';
  document.getElementById('field-c-estado').style.display = 'none';
  SGAR.clearFormError('c-form-error');
  SGAR.openDrawer('drawer-celador');
}

function openEdit(c) {
  document.getElementById('c-edit-id').value = c._id;
  document.getElementById('drawer-title').textContent = 'Editar Celador';
  document.getElementById('c-nombre').value = c.nombre || '';
  document.getElementById('c-email').value = c.email || '';
  
  const pwdInput = document.getElementById('c-pwd');
  pwdInput.value = '';
  pwdInput.required = false;
  document.getElementById('c-pwd-label').textContent = 'Contraseña';
  document.getElementById('c-pwd-hint').style.display = 'block';

  document.getElementById('c-activo').value = c.activo ? 'true' : 'false';
  document.getElementById('field-c-estado').style.display = 'block';
  
  SGAR.clearFormError('c-form-error');
  SGAR.openDrawer('drawer-celador');
}

async function submitCelador(e) {
  e.preventDefault();
  const editId = document.getElementById('c-edit-id').value;
  const body = {
    nombre:   document.getElementById('c-nombre').value.trim(),
    email:    document.getElementById('c-email').value.trim(),
    rol:      'celador',
  };
  
  const pwd = document.getElementById('c-pwd').value;
  if (pwd) {
    body.password = pwd;
  }
  
  if (editId) {
    body.activo = document.getElementById('c-activo').value === 'true';
  }

  SGAR.clearFormError('c-form-error');
  
  const res = editId 
    ? await SGAR.api(`/api/users/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
    : await SGAR.api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    
  if (!res?.success) { SGAR.showFormError('c-form-error', res?.message || 'Error'); return; }
  SGAR.closeDrawer('drawer-celador');
  loadCeladores();
}

async function deleteCelador(id) {
  if (!confirm('¿Estás seguro de eliminar este celador? Esta acción no se puede deshacer.')) return;
  const res = await SGAR.api(`/api/users/${id}`, { method: 'DELETE' });
  if (!res?.success) { alert(res?.message || 'Error al eliminar'); return; }
  loadCeladores();
}

