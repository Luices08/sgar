'use strict';
let currentPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-visit');

  const dateEl = document.getElementById('filter-date');
  const tipoEl = document.getElementById('filter-tipo');

  // Por defecto: hoy
  if (dateEl) dateEl.value = SGAR.todayISO();

  dateEl?.addEventListener('change', () => { currentPage = 1; loadVisits(); });
  tipoEl?.addEventListener('change', () => { currentPage = 1; loadVisits(); });

  loadVisits();
});

async function loadVisits() {
  const date = document.getElementById('filter-date')?.value || '';
  const tipo = document.getElementById('filter-tipo')?.value || '';
  let url = `/api/visits?page=${currentPage}&limit=20`;
  if (date) url += `&fecha=${date}`;
  if (tipo) url += `&tipo=${tipo}`;

  const data = await SGAR.api(url);
  if (!data?.success) return;

  const { data: visits, pagination } = data;
  document.getElementById('sub-count').textContent = `${pagination.total} registros`;

  const tbody = document.getElementById('visits-tbody');
  if (!visits.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Sin registros para los filtros seleccionados</td></tr>';
    return;
  }

  tbody.innerHTML = visits.map(v => `
    <tr>
      <td>${SGAR.fmtTime(v.horaIngreso)}</td>
      <td>${SGAR.tipoBadge(v.tipo)}</td>
      <td>${v.nombre || v.empresa || v.placa || '—'}</td>
      <td><strong>${v.apartamento}</strong></td>
      <td>${v.celador_nombre || '—'}</td>
      <td><span class="badge" style="background:#f0f0f0;color:#555">${v.metodoIdentificacion || 'manual'}</span></td>
      <td>
        <button class="btn-secondary btn-sm" onclick="openDetail('${v._id}')">Detalle</button>
      </td>
    </tr>
  `).join('');

  SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadVisits(); });
}

async function openDetail(id) {
  const data = await SGAR.api(`/api/visits/${id}`);
  if (!data?.success) return;
  const v   = data.data.visit;
  const body = document.getElementById('visit-detail-body');

  const fields = [
    ['Tipo',         SGAR.tipoBadge(v.tipo)],
    ['Nombre / Empresa', v.nombre || v.empresa || v.placa || '—'],
    ['Cédula',       v.cedula || '—'],
    ['Apartamento',  v.apartamento],
    ['Hora de ingreso', SGAR.fmtDate(v.horaIngreso)],
    ['Hora de salida',  SGAR.fmtDate(v.horaSalida)],
    ['Registrado por',  v.celador_nombre || '—'],
    ['Método',          v.metodoIdentificacion || 'manual'],
  ];

  let html = fields.map(([l, v]) => `
    <div class="detail-field">
      <div class="detail-label">${l}</div>
      <div class="detail-value">${v}</div>
    </div>
  `).join('');

  // Audit log
  if (v.auditLog?.length) {
    html += `<div class="form-divider">Historial de cambios</div>`;
    html += v.auditLog.map(e => `
      <div class="audit-entry">
        <div class="audit-meta">${e.accion} — ${e.celador_nombre || 'sistema'} — ${SGAR.fmtDate(e.timestamp)}</div>
        ${e.camposAnteriores ? `<div class="audit-detail">Anterior: ${JSON.stringify(e.camposAnteriores)}</div>` : ''}
      </div>
    `).join('');
  }

  body.innerHTML = html;
  SGAR.openDrawer('drawer-visit');
}
