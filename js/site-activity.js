/* Medición propia y ligera. No captura formularios, consultas de URL ni identidad de Auth. */
(function () {
  'use strict';
  const allowedPaths = new Set(['/', '/index.html', '/pages/voluntariado.html', '/pages/servicios.html', '/pages/productos.html', '/pages/nanas.html']);
  const path = window.location.pathname === '/index.html' ? '/' : window.location.pathname;
  const config = window.LAS_NANAS_CONFIG;
  if (!allowedPaths.has(path) || !/^https?:$/.test(window.location.protocol) ||
      !config?.supabaseUrl || !config?.supabasePublishableKey ||
      /secret|service_role/i.test(config.supabasePublishableKey) ||
      !window.crypto?.randomUUID || !window.fetch ||
      window.navigator.globalPrivacyControl || ['1', 'yes'].includes(window.navigator.doNotTrack)) return;

  const VISITOR_KEY = 'lasnanas_activity_visitor_v1';
  const VISIT_KEY = 'lasnanas_activity_visit_v1';
  const VISITOR_LIFETIME = 365 * 24 * 60 * 60 * 1000;
  const VISIT_TIMEOUT = 30 * 60 * 1000;
  const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
  const read = (storage, key) => { try { return JSON.parse(window[storage].getItem(key) || 'null'); } catch (_) { return null; } };
  const write = (storage, key, value) => { try { window[storage].setItem(key, JSON.stringify(value)); } catch (_) { /* El sitio sigue funcionando sin almacenamiento. */ } };
  const now = Date.now();
  let visitor = read('localStorage', VISITOR_KEY);
  if (!validId(visitor?.id) || !Number.isFinite(visitor.createdAt) || now - visitor.createdAt >= VISITOR_LIFETIME || visitor.createdAt > now) {
    visitor = { id: window.crypto.randomUUID(), createdAt: now };
    write('localStorage', VISITOR_KEY, visitor);
  }
  let visit = read('sessionStorage', VISIT_KEY);
  if (!validId(visit?.id) || !Number.isFinite(visit.lastActivityAt) || now - visit.lastActivityAt >= VISIT_TIMEOUT || visit.lastActivityAt > now) {
    visit = { id: window.crypto.randomUUID(), lastActivityAt: now, registrationStarted: false };
  }
  visit.lastActivityAt = now;
  write('sessionStorage', VISIT_KEY, visit);

  function send(eventType, loadMs = null) {
    const body = {
      event_id: window.crypto.randomUUID(), visitor_id: visitor.id, visit_id: visit.id,
      event_type: eventType, path, load_ms: loadMs
    };
    // Una caída de analítica nunca bloquea navegación, registro ni envío de solicitudes.
    try {
      Promise.resolve(window.fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/collect-site-activity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.supabasePublishableKey },
        body: JSON.stringify(body), keepalive: true, referrerPolicy: 'no-referrer'
      })).catch(() => {});
    } catch (_) { /* Medición opcional. */ }
  }

  let pageRecorded = false;
  function pageView() {
    if (pageRecorded) return;
    pageRecorded = true;
    let loadMs = null;
    try {
      const navigation = window.performance?.getEntriesByType('navigation')?.[0];
      const duration = navigation && navigation.loadEventEnd - navigation.startTime;
      if (Number.isFinite(duration) && duration > 0 && duration <= 120000) loadMs = Math.round(duration);
    } catch (_) { /* Navegadores sin Navigation Timing. */ }
    send('page_view', loadMs);
  }
  // Al diferir el callback, loadEventEnd ya está registrado por el navegador.
  if (document.readyState === 'complete') pageView();
  else window.addEventListener('load', () => window.setTimeout(pageView, 0), { once: true });

  document.addEventListener('input', event => {
    keepVisitActive();
    if (path !== '/pages/voluntariado.html' || visit.registrationStarted || !event.target?.closest?.('[data-register-form]')) return;
    visit.registrationStarted = true;
    visit.lastActivityAt = Date.now();
    write('sessionStorage', VISIT_KEY, visit);
    send('registration_started');
  }, { passive: true, capture: true });

  function keepVisitActive() {
    const time = Date.now();
    if (time - visit.lastActivityAt >= VISIT_TIMEOUT) {
      visit = { id: window.crypto.randomUUID(), lastActivityAt: time, registrationStarted: false };
      write('sessionStorage', VISIT_KEY, visit);
      pageRecorded = false;
      pageView();
      return;
    }
    if (time - visit.lastActivityAt < 60000) return;
    visit.lastActivityAt = time;
    write('sessionStorage', VISIT_KEY, visit);
  }
  document.addEventListener('pointerdown', keepVisitActive, { passive: true, capture: true });
  document.addEventListener('keydown', keepVisitActive, { passive: true, capture: true });
})();
