'use strict';
let currentPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
  if (!SGAR.requireAuth()) return;
  SGAR.initDrawer('drawer-visit');

  const searchEl = document.getElementById('filter-search');
  const dateEl   = document.getElementById('filter-date');
  const tipoEl   = document.getElementById('filter-tipo');
  const estadoEl = document.getElementById('filter-estado');

  // Por defecto: hoy
  if (dateEl) dateEl.value = SGAR.todayISO();

  let searchTimer = null;
  searchEl?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadVisits(); }, 300);
  });

  dateEl?.addEventListener('change',   () => { currentPage = 1; loadVisits(); });
  tipoEl?.addEventListener('change',   () => { currentPage = 1; loadVisits(); });
  estadoEl?.addEventListener('change', () => { currentPage = 1; loadVisits(); });

  loadVisits();
});

async function loadVisits() {
  const search = document.getElementById('filter-search')?.value.trim() || '';
  const date   = document.getElementById('filter-date')?.value || '';
  const tipo   = document.getElementById('filter-tipo')?.value || '';
  const estado = document.getElementById('filter-estado')?.value || '';
  let url = `/api/visits?page=${currentPage}&limit=20`;
  if (search) url += `&q=${encodeURIComponent(search)}`;
  if (date)   url += `&fecha=${date}`;
  if (tipo)   url += `&tipo=${tipo}`;
  if (estado) url += `&estado=${estado}`;

  const data = await SGAR.api(url);
  if (!data?.success) return;

  const { data: visits, pagination } = data;
  document.getElementById('sub-count').textContent = `${pagination.total} registros`;

  const tbody = document.getElementById('visits-tbody');
  if (!visits.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="table-loading">Sin registros para los filtros seleccionados</td></tr>';
    return;
  }

  tbody.innerHTML = visits.map(v => {
    const isDentro = !v.horaSalida;
    let estadoBadge = isDentro
      ? '<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:600">🟢 Dentro</span>'
      : `<span class="badge" style="background:#f1f5f9;color:#475569">Salida: ${SGAR.fmtTime(v.horaSalida)}</span>`;

    if (v.tipo === 'domicilio') {
      if (v.estadoDomicilio === 'recibido' || v.fechaRecepcion) {
        estadoBadge = '<span class="badge" style="background:#dcfce7;color:#15803d;font-weight:600">✓ Recibido</span>';
      } else {
        estadoBadge = '<span class="badge" style="background:#fef3c7;color:#92400e;font-weight:600">🟡 En portería</span>';
      }
    }

    const metodoStr = v.metodoSalida && v.metodoSalida !== v.metodoIdentificacion
      ? `${v.metodoIdentificacion || 'manual'} → ${v.metodoSalida}`
      : (v.metodoIdentificacion || 'manual');

    return `
    <tr>
      <td>${SGAR.fmtTime(v.horaIngreso)}</td>
      <td>${SGAR.tipoBadge(v.tipo)}</td>
      <td>${v.nombre || v.empresa || (v.placa ? 'Vehículo ' + v.placa : '—')}</td>
      <td><strong>${v.apartamento}</strong></td>
      <td>${estadoBadge}</td>
      <td><span class="badge" style="background:#f0f0f0;color:#555">${metodoStr}</span></td>
      <td>
        <button class="btn-secondary btn-sm" onclick="openDetail('${v._id}')">Detalle</button>
      </td>
    </tr>
  `;
  }).join('');

  SGAR.renderPagination('pagination', pagination, (p) => { currentPage = p; loadVisits(); });
}

function calcularDuracion(inicio, fin) {
  if (!inicio || !fin) return null;
  const ms = new Date(fin) - new Date(inicio);
  if (ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rMin = mins % 60;
  return `${hrs}h ${rMin}m`;
}

async function openDetail(id) {
  const data = await SGAR.api(`/api/visits/${id}`);
  if (!data?.success) return;
  const v    = data.data.visit;
  const body = document.getElementById('visit-detail-body');

  const duracion = calcularDuracion(v.horaIngreso, v.horaSalida);

  const fields = [
    ['Tipo de acceso',        SGAR.tipoBadge(v.tipo)],
    ['Nombre / Persona',      v.nombre || v.empresa || '—'],
    ['Cédula',                v.cedula || '—'],
    ['Apartamento',           v.apartamento],
    ['Vehículo / Placa',      v.placa || '—'],
    ['Estado actual',         v.horaSalida ? '⚪ Salida registrada' : '<span style="color:#15803d;font-weight:700">🟢 Dentro del conjunto</span>'],
  ];

  if (v.tipo === 'domicilio') {
    fields.push(
      ['── DETALLES DEL DOMICILIO ──', '────────────────────'],
      ['Estado del domicilio',   v.estadoDomicilio === 'recibido' ? '<span style="color:#15803d;font-weight:700;">✓ Recibido por residente</span>' : '<span style="color:#d97706;font-weight:700;">🟡 En portería (Pendiente de reclamar)</span>'],
      ['Llegada a portería',     SGAR.fmtDate(v.fechaLlegada || v.horaIngreso)],
      ['Notificación enviada',   v.fechaNotificacion ? SGAR.fmtDate(v.fechaNotificacion) : '—'],
      ['Recepción confirmada',   v.fechaRecepcion ? SGAR.fmtDate(v.fechaRecepcion) : 'Pendiente por el residente'],
      ['Recibido por',           v.recibidoPorNombre || (v.estadoDomicilio === 'recibido' ? 'Residente' : '—')]
    );
  }

  fields.push(
    ['── ENTRADA ──',         '────────────────────'],
    ['Hora de entrada',       SGAR.fmtDate(v.horaIngreso)],
    ['Método de entrada',     v.metodoIdentificacion || 'manual'],
    ['Celador que ingresó',   v.celador_nombre || '—'],
    ['── SALIDA ──',          '────────────────────'],
    ['Hora de salida',        v.horaSalida ? SGAR.fmtDate(v.horaSalida) : '🟢 Aún dentro del conjunto'],
    ['Método de salida',      v.horaSalida ? (v.metodoSalida || 'manual') : '—'],
    ['Celador que dio salida',v.horaSalida ? (v.celador_salida_nombre || '—') : '—'],
    ['Duración de estadía',   duracion || (v.horaSalida ? '—' : 'En curso…')]
  );

  let html = fields.map(([l, val]) => {
    if (l.startsWith('──')) {
      return `<div class="form-divider" style="margin:16px 0 8px;font-weight:700;color:var(--text-muted);font-size:12px">${l.replace(/─/g, '').trim()}</div>`;
    }
    return `
    <div class="detail-field">
      <div class="detail-label">${l}</div>
      <div class="detail-value">${val}</div>
    </div>
  `;
  }).join('');

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
