/**
 * SGAR Reusable Real-Time Polling Engine
 * Polling ligero unificado cada ~5 segundos para sincronización automática
 * de domicilios, visitas, solicitudes de ayuda, invitaciones y cambios.
 */
'use strict';

const SGARPoll = (() => {
  let timer = null;
  let intervalMs = 5000;
  let lastTimestamp = null;
  let isPolling = false;
  let isRunning = false;
  let endpoint = '/api/notifications/poll';
  const listeners = new Map(); // eventType -> Set of callbacks
  let globalOnChanges = null;
  let globalOnCounts = null;

  function getToken() {
    return localStorage.getItem('sgar_token') || localStorage.getItem('token') || '';
  }

  async function tick() {
    if (!isRunning || isPolling) return;
    const token = getToken();

    isPolling = true;
    try {
      const url = new URL(endpoint, window.location.origin);
      if (lastTimestamp) {
        url.searchParams.set('since', lastTimestamp);
      }

      const headers = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers,
        credentials: 'same-origin',
      });

      if (res.status === 401 || res.status === 403) {
        // Sesión expirada o suspendida
        stop();
        return;
      }

      if (!res.ok) {
        return;
      }

      const json = await res.json();
      if (json && json.success && json.data) {
        const { timestamp, hasChanges, counts, events } = json.data;
        lastTimestamp = timestamp;

        if (globalOnCounts && counts) {
          globalOnCounts(counts);
        }

        if (hasChanges || (Array.isArray(events) && events.length > 0)) {
          if (globalOnChanges) {
            globalOnChanges(json.data);
          }

          if (Array.isArray(events)) {
            events.forEach(evt => {
              const handlers = listeners.get(evt.type);
              if (handlers) {
                handlers.forEach(fn => {
                  try { fn(evt); } catch (err) { console.error('[SGARPoll] Event handler error:', err); }
                });
              }

              const wildcard = listeners.get('*');
              if (wildcard) {
                wildcard.forEach(fn => {
                  try { fn(evt); } catch (err) { console.error('[SGARPoll] Wildcard handler error:', err); }
                });
              }
            });
          }
        }
      }
    } catch (err) {
      // Error silencioso de red (ej. reconexión)
    } finally {
      isPolling = false;
    }
  }

  function start(options = {}) {
    if (options.intervalMs && options.intervalMs >= 2000) {
      intervalMs = options.intervalMs;
    }
    if (options.endpoint) {
      endpoint = options.endpoint;
    }
    if (typeof options.onChanges === 'function') {
      globalOnChanges = options.onChanges;
    }
    if (typeof options.onCounts === 'function') {
      globalOnCounts = options.onCounts;
    }

    if (isRunning) return;
    isRunning = true;
    lastTimestamp = new Date(Date.now() - 10000).toISOString(); // Iniciar con los últimos 10s

    // Primer tick inmediato
    tick();

    timer = setInterval(tick, intervalMs);

    // Ajustar cuando la pestaña cambia de visibilidad
    document.addEventListener('visibilitychange', handleVisibility);
  }

  function stop() {
    isRunning = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    document.removeEventListener('visibilitychange', handleVisibility);
  }

  function handleVisibility() {
    if (document.visibilityState === 'visible' && isRunning) {
      tick(); // Comprobar cambios inmediatamente al volver a la pestaña
    }
  }

  function on(eventType, callback) {
    if (typeof callback !== 'function') return;
    if (!listeners.has(eventType)) {
      listeners.set(eventType, new Set());
    }
    listeners.get(eventType).add(callback);
  }

  function off(eventType, callback) {
    if (listeners.has(eventType)) {
      listeners.get(eventType).delete(callback);
    }
  }

  function trigger() {
    return tick();
  }

  return {
    start,
    stop,
    on,
    off,
    trigger,
    get isRunning() { return isRunning; },
  };
})();

if (typeof window !== 'undefined') {
  window.SGARPoll = SGARPoll;
}
