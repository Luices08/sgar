'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const user = SGAR.requireAuth();
  if (!user) return;

  if (user.rol === 'adminControl') {
    document.getElementById('view-admincontrol').style.display = 'block';
    document.getElementById('analytics-subtitle').textContent = 'Métricas globales del sistema';
    loadGlobalAnalytics();
  } else {
    document.getElementById('view-conjunto').style.display = 'block';
    document.getElementById('analytics-subtitle').textContent = 'Métricas del conjunto — hoy';
    loadConjuntoAnalytics();
  }
});

/* ── ADMIN CONTROL ──────────────────────────────────────────────────────────── */
async function loadGlobalAnalytics() {
  const data = await SGAR.api('/api/tenants/analytics');
  if (!data?.success) return;

  const items   = data.data.analytics;
  const labels  = items.map(i => i.nombre);
  const color   = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim();

  buildBar('chart-ingresos-conjuntos', labels, items.map(i => i.ingresos7d),
    'Ingresos últimos 7 días', color);

  buildBar('chart-residentes-conjuntos', labels, items.map(i => i.totalResidentes),
    'Residentes registrados', color);
}

/* ── ADMIN CONJUNTO / CELADOR ───────────────────────────────────────────────── */
async function loadConjuntoAnalytics() {
  const data = await SGAR.api('/api/visits/analytics');
  if (!data?.success) return;

  const { porTipo, porFranja } = data.data;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--acento').trim();

  // Por tipo
  const tipoMap = { visita: 'Visitas', domicilio: 'Domicilios', vehiculo: 'Vehículos' };
  const tipoLabels = porTipo.map(t => tipoMap[t._id] || t._id);
  buildBar('chart-tipo', tipoLabels, porTipo.map(t => t.count), 'Cantidad', color);

  // Por franja horaria (cada entrada es bloque de 2h)
  const franjaLabels = porFranja.map(f => {
    const h = f._id * 2;
    return `${String(h).padStart(2,'0')}:00–${String(h+2).padStart(2,'0')}:00`;
  });
  buildBar('chart-franjas', franjaLabels, porFranja.map(f => f.count), 'Registros', color);
}

/* ── CHART BUILDER ──────────────────────────────────────────────────────────── */
function buildBar(canvasId, labels, values, label, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Destruir instancia previa si existe
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: color + '99',
        borderColor:     color,
        borderWidth: 2,
        borderRadius: 5,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 12 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: '#f0f0f0' },
          ticks: { precision: 0 },
        },
      },
    },
  });
}
