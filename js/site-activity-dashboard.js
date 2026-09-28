/* Las Ñañas · métricas privadas. No almacena métricas ni resúmenes en el navegador. */
(function () {
  'use strict';
  const root = document.querySelector('[data-admin-view="activity"]');
  if (!root) return;
  const client = window.LasNanasSupabase?.client;
  const find = selector => root.querySelector(selector);
  const content = find('[data-activity-content]');
  const status = find('[data-activity-status]');
  const refreshButton = find('[data-activity-refresh]');
  const periodButtons = [...root.querySelectorAll('[data-activity-period]')];
  const summaryButton = find('[data-activity-summary]');
  const summaryStatus = find('[data-activity-summary-status]');
  const summaryOutput = find('[data-activity-summary-output]');
  const copyButton = find('[data-activity-summary-copy]');
  const healthValue = find('[data-activity-health]');
  const healthDetail = find('[data-activity-health-detail]');
  const numberFormat = new Intl.NumberFormat('es-CL');
  const dateFormat = new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago', hour12: false });
  const metricNames = ['visits-today', 'visits-7', 'visits-30', 'unique', 'new', 'returning', 'volunteer', 'registrations', 'applications'];
  let active = false, userId = null, days = 7, generation = 0, summaryGeneration = 0;
  let probeController = null, pollTimer = null;

  function current(token) { return active && token === generation; }
  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }
  function formatDate(value) {
    if (!value) return 'Sin actualizar';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' : dateFormat.format(date);
  }
  function formatCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? numberFormat.format(Math.floor(value)) : '—';
  }
  function syncPeriod() {
    periodButtons.forEach(button => {
      const selected = Number(button.dataset.activityPeriod) === days;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    find('[data-activity-period-label]').textContent = days === 1 ? 'Hoy' : `${days} días`;
  }
  function clearSummary() {
    summaryStatus.textContent = '';
    summaryOutput.value = '';
    summaryOutput.hidden = true;
    copyButton.hidden = true;
  }
  function clearData() {
    content.hidden = true;
    metricNames.forEach(name => { find(`[data-activity-metric="${name}"]`).textContent = '—'; });
    find('[data-activity-countries]').replaceChildren();
    find('[data-activity-pages]').replaceChildren();
    find('[data-activity-updated]').textContent = 'Sin actualizar';
    find('[data-activity-tracking-started]').textContent = '';
    healthValue.textContent = 'Sin comprobar';
    healthValue.removeAttribute('data-state');
    healthDetail.textContent = 'Comprobación desde este navegador.';
    find('[data-activity-performance]').textContent = 'Sin datos';
    find('[data-activity-performance-detail]').textContent = 'Promedio de las cargas medidas en el período.';
    summaryButton.disabled = true;
    clearSummary();
  }
  function abortProbe() {
    probeController?.abort();
    probeController = null;
  }
  function stopPolling() {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
  }
  function authorityError() {
    const error = new Error('private_access_required');
    error.code = '42501';
    error.authorityFailure = true;
    return error;
  }
  async function authorize(token) {
    if (!current(token)) return false;
    if (!client || !userId) throw authorityError();
    let result;
    try { result = await client.auth.getUser(); }
    catch (_) { throw authorityError(); }
    if (!current(token)) return false;
    if (result.error || !result.data?.user || result.data.user.id !== userId) throw authorityError();
    let permission;
    try { permission = await client.rpc('is_site_activity_admin'); }
    catch (error) {
      error.authorityFailure = true;
      throw error;
    }
    if (!current(token)) return false;
    if (permission.error) {
      permission.error.authorityFailure = true;
      throw permission.error;
    }
    if (permission.data !== true) throw authorityError();
    return true;
  }
  function handlePrivateError(error) {
    clearData();
    if (error?.code === '42501') {
      setStatus('No fue posible validar tu acceso administrativo. Las métricas permanecen protegidas.', true);
    } else {
      setStatus('No fue posible actualizar las métricas. Vuelve a intentarlo en unos minutos.', true);
    }
  }
  async function checkSite(token) {
    const controller = new AbortController();
    probeController = controller;
    const timer = setTimeout(() => controller.abort(), 6000);
    const started = performance.now();
    let online = false;
    try {
      const response = await fetch(new URL('../index.html', window.location.href), { method: 'GET', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      online = response.ok;
    } catch (_) {
      // Solo esta comprobación HTTP determina el estado: un error de Auth no significa Offline.
    } finally {
      clearTimeout(timer);
      if (probeController === controller) probeController = null;
    }
    if (!current(token)) return null;
    return { online, latency_ms: Math.max(0, Math.round(performance.now() - started)), checked_at: new Date().toISOString() };
  }
  function countryName(code) {
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'ZZ') return 'Sin determinar';
    try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(code) || code; }
    catch (_) { return code; }
  }
  function renderRanking(selector, rows, label, valueKey, emptyMessage) {
    const target = find(selector);
    target.replaceChildren();
    const entries = Array.isArray(rows) ? rows.slice(0, 5) : [];
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'activity-ranking-empty';
      empty.textContent = emptyMessage;
      target.append(empty);
      return;
    }
    const largest = Math.max(1, ...entries.map(row => Number(row[valueKey]) || 0));
    entries.forEach(row => {
      const item = document.createElement('li');
      const top = document.createElement('div');
      top.className = 'activity-ranking-top';
      const name = document.createElement('strong');
      name.textContent = label(row);
      const count = document.createElement('span');
      count.textContent = formatCount(row[valueKey]);
      top.append(name, count);
      const track = document.createElement('div');
      track.className = 'activity-ranking-track';
      track.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.style.width = `${Math.max(0, Math.min(100, (Number(row[valueKey]) || 0) / largest * 100))}%`;
      track.append(fill);
      item.append(top, track);
      target.append(item);
    });
  }
  function render(data, health, healthSaved) {
    const values = {
      'visits-today': data.visits?.today, 'visits-7': data.visits?.last7, 'visits-30': data.visits?.last30,
      unique: data.unique_visitors, new: data.new_visitors, returning: data.returning_visitors,
      volunteer: data.volunteer_visits, registrations: data.registration_starts, applications: data.applications_submitted
    };
    Object.entries(values).forEach(([name, value]) => { find(`[data-activity-metric="${name}"]`).textContent = formatCount(value); });
    renderRanking('[data-activity-countries]', data.top_countries, row => countryName(row.country_code), 'visits', 'Aún no hay visitas con país registrado.');
    renderRanking('[data-activity-pages]', data.top_pages, row => row.path === '/' ? 'Inicio · /' : String(row.path || 'Página sin identificar'), 'views', 'Aún no hay páginas registradas en este período.');
    if (health) {
      healthValue.textContent = health.online ? 'Online' : 'Offline';
      healthValue.setAttribute('data-state', health.online ? 'online' : 'offline');
      healthDetail.textContent = `Comprobación desde este navegador · respuesta en ${numberFormat.format(health.latency_ms)} ms · ${formatDate(health.checked_at)}.${healthSaved ? '' : ' No fue posible guardar esta comprobación.'}`;
    }
    const load = data.performance?.avg_load_ms;
    const samples = data.performance?.samples;
    if (typeof load === 'number' && Number.isFinite(load) && load >= 0 && samples > 0) {
      find('[data-activity-performance]').textContent = `${numberFormat.format(Math.round(load))} ms`;
      find('[data-activity-performance-detail]').textContent = `Promedio de carga de visitantes · ${formatCount(samples)} mediciones en el período.`;
    }
    find('[data-activity-updated]').textContent = formatDate(data.updated_at);
    find('[data-activity-tracking-started]').textContent = data.tracking_started_at
      ? `Medición de visitas desde ${formatDate(data.tracking_started_at)}. Las solicitudes enviadas usan el historial disponible.`
      : 'Aún no se han registrado visitas. Las solicitudes enviadas usan el historial disponible.';
    content.hidden = false;
    summaryButton.disabled = false;
    setStatus(data.visits?.selected === 0 ? 'No hay visitas registradas en este período.' : 'Métricas privadas actualizadas.');
  }
  async function refresh() {
    if (!active || document.hidden) return;
    const token = ++generation;
    ++summaryGeneration;
    abortProbe();
    clearData();
    refreshButton.disabled = true;
    setStatus('Actualizando actividad y comprobando el sitio…');
    try {
      if (!(await authorize(token))) return;
      const [result, health] = await Promise.all([
        client.rpc('admin_get_site_activity', { p_days: days }),
        checkSite(token)
      ]);
      if (!current(token)) return;
      if (result.error) throw result.error;
      if (!result.data || Array.isArray(result.data) || typeof result.data !== 'object') throw new Error('invalid_metrics');
      let healthSaved = false;
      if (health) {
        const saved = await client.rpc('admin_record_site_health', { p_online: health.online, p_latency_ms: health.latency_ms });
        if (!current(token)) return;
        if (saved.error?.code === '42501') throw saved.error;
        healthSaved = !saved.error;
      }
      if (current(token)) render(result.data, health, healthSaved);
    } catch (error) {
      if (current(token)) handlePrivateError(error);
    } finally {
      if (current(token)) refreshButton.disabled = false;
    }
  }
  async function generateSummary() {
    if (!active || content.hidden || summaryButton.disabled) return;
    const token = generation;
    const summaryToken = ++summaryGeneration;
    clearSummary();
    summaryButton.disabled = true;
    summaryStatus.textContent = 'Preparando el resumen privado de ayer…';
    try {
      if (!(await authorize(token)) || summaryToken !== summaryGeneration) return;
      const { data, error } = await client.rpc('generate_daily_site_activity_summary');
      if (!current(token) || summaryToken !== summaryGeneration) return;
      if (error) throw error;
      if (!data || typeof data.message !== 'string' || !data.message.trim()) throw new Error('invalid_summary');
      summaryOutput.value = data.message;
      summaryOutput.hidden = false;
      const summaryDate = /^\d{4}-\d{2}-\d{2}$/.test(data.summary_date || '') ? data.summary_date.split('-').reverse().join('/') : 'ayer';
      summaryStatus.textContent = `Resumen del ${summaryDate} · generado ${formatDate(data.generated_at)}. Listo para copiar.`;
      copyButton.hidden = !window.navigator?.clipboard?.writeText;
    } catch (error) {
      if (!current(token) || summaryToken !== summaryGeneration) return;
      if (error?.code === '42501' || error?.authorityFailure) handlePrivateError(error);
      else summaryStatus.textContent = 'No fue posible generar el resumen. Vuelve a intentarlo en unos minutos.';
    } finally {
      if (current(token) && summaryToken === summaryGeneration) summaryButton.disabled = content.hidden;
    }
  }
  periodButtons.forEach(button => button.addEventListener('click', () => {
    if (!active) return;
    const next = Number(button.dataset.activityPeriod);
    if (![1, 7, 30].includes(next) || next === days) return;
    days = next;
    syncPeriod();
    void refresh();
  }));
  refreshButton.addEventListener('click', () => { void refresh(); });
  summaryButton.addEventListener('click', () => { void generateSummary(); });
  copyButton.addEventListener('click', async () => {
    if (!active || content.hidden || summaryOutput.hidden || !summaryOutput.value) return;
    const token = generation, summaryToken = summaryGeneration;
    try {
      if (!(await authorize(token)) || summaryToken !== summaryGeneration) return;
      await window.navigator?.clipboard?.writeText(summaryOutput.value);
      if (current(token) && summaryToken === summaryGeneration) summaryStatus.textContent = 'Resumen copiado.';
    } catch (error) {
      if (!current(token) || summaryToken !== summaryGeneration) return;
      if (error?.code === '42501' || error?.authorityFailure) handlePrivateError(error);
      else summaryStatus.textContent = 'Puedes seleccionar y copiar el texto del resumen.';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) {
      ++generation;
      ++summaryGeneration;
      abortProbe();
      clearData();
      refreshButton.disabled = false;
    } else {
      void refresh();
    }
  });
  window.LasNanasActivityDashboard = {
    open(id) {
      if (typeof id !== 'string' || !id) { this.reset(); return; }
      active = true;
      userId = id;
      stopPolling();
      pollTimer = setInterval(() => { if (active && !document.hidden) void refresh(); }, 60000);
      syncPeriod();
      return refresh();
    },
    close() {
      active = false;
      ++generation;
      ++summaryGeneration;
      stopPolling();
      abortProbe();
      clearData();
      refreshButton.disabled = false;
    },
    reset() {
      this.close();
      userId = null;
      days = 7;
      syncPeriod();
      setStatus('Verificando acceso a las métricas privadas…');
    }
  };
  clearData();
})();
