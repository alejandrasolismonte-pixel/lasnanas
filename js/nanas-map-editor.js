/* Vista de pines del panel de Ñañas. La edición y los datos siguen en map-pins.js. */
(function () {
  'use strict';

  function mount(container, options = {}) {
    if (!container || container.dataset.nanasMapMounted === 'true') return;
    const imageUrl = options.imageUrl || '../assets/img/mapa-araucania-web.webp?v=20260925';
    container.dataset.nanasMapMounted = 'true';
    container.innerHTML = `
      <div class="map-experience" data-map-experience>
        <div class="map-toolbar" role="group" aria-label="Filtrar puntos del mapa">
          <button class="map-filter filter-choice filter-choice--all is-active" type="button" data-filter="all" aria-pressed="true">Todos</button>
          <button class="map-filter filter-choice filter-choice--nanas" type="button" data-filter="nanas" aria-pressed="false">Ñañas</button>
          <button class="map-filter filter-choice filter-choice--experiences" type="button" data-filter="experiences" aria-pressed="false">Experiencias</button>
        </div>
        <div class="map-editor" data-map-editor hidden aria-label="Edición privada de pines del mapa">
          <div class="map-editor__copy">
            <strong>Edición privada del mapa</strong>
            <span data-map-editor-mode>Preparando vista…</span>
            <small data-map-editor-status role="status" aria-live="polite">Activa el movimiento para arrastrar los pines.</small>
          </div>
          <div class="map-editor__actions">
            <button type="button" data-map-add-pin="nanas">+ Pin naranja</button>
            <button type="button" data-map-add-pin="experiences">+ Pin verde</button>
            <button class="map-editor__toggle" type="button" data-map-edit-toggle aria-pressed="false">Activar movimiento</button>
            <button type="button" data-map-edit-save disabled>Guardar</button>
            <button type="button" data-map-edit-cancel disabled>Cancelar</button>
            <button type="button" data-map-edit-reset>Restaurar posiciones</button>
          </div>
          <form class="map-editor__detail" data-map-pin-form hidden>
            <div class="map-editor__detail-heading">
              <strong data-map-pin-form-title>Editar detalle del pin</strong>
              <button type="button" data-map-pin-form-close aria-label="Cerrar edición del detalle">×</button>
            </div>
            <label>Color y tipo
              <select name="category" required>
                <option value="nanas">Naranja · Ñañas</option>
                <option value="experiences">Verde · Experiencia</option>
              </select>
            </label>
            <label>Nombre
              <input name="title" type="text" minlength="2" maxlength="80" required autocomplete="off">
            </label>
            <label class="map-editor__detail-description">Descripción breve
              <textarea name="description" minlength="2" maxlength="280" required></textarea>
            </label>
            <div class="map-editor__detail-actions">
              <button type="submit" data-map-pin-detail-save>Guardar detalle</button>
              <button type="button" data-map-pin-hide>Quitar del mapa</button>
            </div>
            <small data-map-pin-form-status role="status" aria-live="polite"></small>
          </form>
          <section class="map-editor__retired" data-map-inactive-section hidden aria-label="Pines retirados">
            <strong>Pines retirados</strong>
            <div class="map-editor__retired-list" data-map-inactive-list></div>
          </section>
        </div>
        <div class="map-stage" data-map-stage aria-label="Mapa ilustrado de Wallmapu con puntos interactivos">
          <img alt="Mapa ilustrado de Wallmapu y La Araucanía" decoding="async">
        </div>
        <aside class="map-detail" aria-live="polite">
          <p class="map-detail__eyebrow">Explora el territorio</p>
          <h3>Elige un pin</h3>
          <p>Naranja identifica a Ñañas y verde a las experiencias.</p>
        </aside>
      </div>`;
    container.querySelector('.map-stage img').src = imageUrl;

    const filters = Array.from(container.querySelectorAll('.map-filter'));
    const pins = () => Array.from(container.querySelectorAll('.map-pin'));
    const detail = container.querySelector('.map-detail');
    filters.forEach((filter) => filter.addEventListener('click', function () {
      filters.forEach((button) => {
        const selected = button === filter;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      pins().forEach((pin) => {
        pin.classList.toggle('is-hidden', filter.dataset.filter !== 'all' && pin.dataset.category !== filter.dataset.filter);
        pin.classList.remove('is-active');
      });
    }));
    container.querySelector('.map-stage').addEventListener('click', function (event) {
      const pin = event.target.closest('.map-pin');
      if (!pin || pin.hidden || pin.classList.contains('is-hidden')) return;
      pins().forEach((item) => item.classList.toggle('is-active', item === pin));
      detail.replaceChildren();
      const eyebrow = document.createElement('p');
      eyebrow.className = 'map-detail__eyebrow';
      eyebrow.textContent = pin.dataset.category === 'nanas' ? 'Red Las Ñañas' : 'Experiencia territorial';
      const title = document.createElement('h3');
      title.textContent = pin.dataset.title;
      const description = document.createElement('p');
      description.textContent = pin.dataset.text;
      detail.append(eyebrow, title, description);
    });
  }

  window.LasNanasMapEditor = { mount };
  const target = document.querySelector('[data-nanas-map-editor]');
  if (target && new URLSearchParams(window.location.search).get('editar-mapa') === '1') {
    mount(target, { imageUrl: target.dataset.mapImageUrl });
  }
})();
