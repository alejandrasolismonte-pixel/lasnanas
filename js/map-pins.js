/* Las Ñañas · pines públicos y editor visual privado del mapa territorial. */
(function () {
  'use strict';

  const EDIT_QUERY = 'editar-mapa';
  const MOBILE_QUERY = '(max-width: 767px)';
  const MIN_POSITION = 2;
  const MAX_POSITION = 98;
  const DRAFT_ID = 'draft-map-pin';

  document.addEventListener('DOMContentLoaded', function () {
    const stage = document.querySelector('[data-map-stage]');
    const editor = document.querySelector('[data-map-editor]');
    if (!stage) return;

    const client = window.LasNanasSupabase && window.LasNanasSupabase.client;
    const loader = window.LasNanasLoader;
    const editRequested = new URLSearchParams(window.location.search).get(EDIT_QUERY) === '1';
    const mobileMedia = window.matchMedia(MOBILE_QUERY);
    const modeLabel = editor?.querySelector('[data-map-editor-mode]');
    const status = editor?.querySelector('[data-map-editor-status]');
    const actions = editor?.querySelector('.map-editor__actions');
    const toggleButton = editor?.querySelector('[data-map-edit-toggle]');
    const saveButton = editor?.querySelector('[data-map-edit-save]');
    const cancelButton = editor?.querySelector('[data-map-edit-cancel]');
    const resetButton = editor?.querySelector('[data-map-edit-reset]');
    const addButtons = Array.from(editor?.querySelectorAll('[data-map-add-pin]') || []);
    const detailForm = editor?.querySelector('[data-map-pin-form]');
    const detailHeading = detailForm?.querySelector('[data-map-pin-form-title]');
    const detailStatus = detailForm?.querySelector('[data-map-pin-form-status]');
    const detailClose = detailForm?.querySelector('[data-map-pin-form-close]');
    const hideButton = detailForm?.querySelector('[data-map-pin-hide]');
    const inactiveSection = editor?.querySelector('[data-map-inactive-section]');
    const inactiveList = editor?.querySelector('[data-map-inactive-list]');
    const pinById = new Map();
    const records = new Map();
    let positions = new Map();
    let savedPositions = new Map();
    let defaultPositions = new Map();
    let editing = false;
    let dirty = false;
    let activePointerId = null;
    let activePin = null;
    let selectedPinId = null;

    function numberFromStyle(pin, property, fallback) {
      const parsed = Number.parseFloat(pin.style.getPropertyValue(property));
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value) {
      return Math.min(MAX_POSITION, Math.max(MIN_POSITION, value));
    }

    function normalizePosition(record, fallback) {
      const normalized = {
        pin_id: record.pin_id,
        x: Number(record.x),
        y: Number(record.y),
        mobile_x: Number(record.mobile_x),
        mobile_y: Number(record.mobile_y)
      };
      ['x', 'y', 'mobile_x', 'mobile_y'].forEach(function (key) {
        if (!Number.isFinite(normalized[key])) normalized[key] = fallback?.[key] ?? 50;
        normalized[key] = clamp(normalized[key]);
      });
      return normalized;
    }

    function normalizeRecord(record, fallback) {
      const category = record.category === 'experiences' ? 'experiences' : (fallback?.category || 'nanas');
      return {
        ...fallback,
        ...record,
        pin_id: record.pin_id,
        category,
        title: String(record.title || fallback?.title || 'Punto territorial'),
        description: String(record.description || fallback?.description || 'Punto vinculado con el territorio.'),
        symbol: String(record.symbol || fallback?.symbol || (category === 'nanas' ? '✦' : '❋')),
        is_active: record.is_active !== false,
        is_builtin: record.is_builtin !== false
      };
    }

    function copyMap(source) {
      return new Map(Array.from(source, ([id, value]) => [id, { ...value }]));
    }

    function setStatus(message, tone) {
      if (!status) return;
      status.textContent = message;
      status.dataset.tone = tone || '';
    }

    function setDetailStatus(message, tone) {
      if (!detailStatus) return;
      detailStatus.textContent = message;
      detailStatus.dataset.tone = tone || '';
    }

    function updateModeLabel() {
      if (!modeLabel) return;
      modeLabel.textContent = mobileMedia.matches
        ? 'Estás ajustando la posición para celulares.'
        : 'Estás ajustando la posición para escritorio y tablet.';
    }

    function updateButtons() {
      if (!toggleButton) return;
      toggleButton.setAttribute('aria-pressed', String(editing));
      toggleButton.textContent = editing ? 'Bloquear movimiento' : 'Activar movimiento';
      saveButton.disabled = !dirty;
      cancelButton.disabled = !dirty;
    }

    function applyPosition(position) {
      const pin = pinById.get(position.pin_id);
      if (!pin) return;
      pin.style.setProperty('--x', `${position.x}%`);
      pin.style.setProperty('--y', `${position.y}%`);
      pin.style.setProperty('--x-movil', `${position.mobile_x}%`);
      pin.style.setProperty('--y-movil', `${position.mobile_y}%`);
    }

    function applyAll(source) {
      source.forEach(applyPosition);
    }

    function applyRecordToPin(record) {
      const pin = pinById.get(record.pin_id);
      if (!pin) return;
      pin.dataset.category = record.category;
      pin.dataset.title = record.title;
      pin.dataset.text = record.description;
      pin.classList.toggle('pin--nanas', record.category === 'nanas');
      pin.classList.toggle('pin--location', record.category === 'nanas');
      pin.classList.toggle('pin--territory', record.category === 'experiences');
      pin.hidden = !record.is_active;
      const activeFilter = document.querySelector('.map-filter.is-active')?.dataset.filter || 'all';
      pin.classList.toggle('is-hidden', activeFilter !== 'all' && activeFilter !== record.category);
      pin.setAttribute('aria-label', `Abrir información de ${record.title}`);
      const symbol = pin.querySelector('span');
      if (symbol) symbol.textContent = record.symbol;
    }

    function createPinElement(record) {
      const pin = document.createElement('button');
      pin.className = 'map-pin';
      pin.type = 'button';
      pin.dataset.pinId = record.pin_id;
      const symbol = document.createElement('span');
      symbol.setAttribute('aria-hidden', 'true');
      pin.appendChild(symbol);
      stage.appendChild(pin);
      pinById.set(record.pin_id, pin);
      bindPin(pin);
      return pin;
    }

    function upsertRecord(rawRecord) {
      const fallback = records.get(rawRecord.pin_id);
      const record = normalizeRecord(rawRecord, fallback);
      records.set(record.pin_id, record);
      if (!pinById.has(record.pin_id)) createPinElement(record);
      applyRecordToPin(record);
      const position = normalizePosition(record, positions.get(record.pin_id));
      positions.set(record.pin_id, position);
      applyPosition(position);
      return record;
    }

    function setEditing(nextEditing) {
      editing = Boolean(nextEditing);
      stage.classList.toggle('is-map-editing', editing);
      document.body.classList.toggle('map-editing-active', editing);
      pinById.forEach(function (pin) {
        pin.setAttribute('aria-grabbed', String(editing && pin === activePin));
        pin.title = editing ? `Mover ${pin.dataset.title || 'pin'}` : '';
      });
      if (editing) {
        document.querySelector('.map-filter[data-filter="all"]')?.click();
        setStatus('Arrastra cualquier pin y luego presiona Guardar.', 'info');
      } else if (!dirty) {
        setStatus('Selecciona un pin para editarlo o activa el movimiento para arrastrarlo.', '');
      }
      updateButtons();
    }

    function markDirty() {
      dirty = true;
      setStatus('Hay cambios de posición sin guardar.', 'warning');
      updateButtons();
    }

    function selectPin(pinId, isNew) {
      const record = records.get(pinId);
      const pin = pinById.get(pinId);
      if (!record || !pin || !detailForm) return;
      selectedPinId = pinId;
      pinById.forEach((item) => item.classList.toggle('is-map-selected', item === pin));
      detailForm.hidden = false;
      detailHeading.textContent = isNew ? 'Completar nuevo pin' : 'Editar detalle del pin';
      detailForm.elements.category.value = record.category;
      detailForm.elements.title.value = isNew ? '' : record.title;
      detailForm.elements.description.value = isNew ? '' : record.description;
      hideButton.hidden = isNew;
      setDetailStatus(isNew ? 'Ubícalo en el mapa y completa sus datos.' : '', '');
      detailForm.elements.title.focus();
    }

    function closeDetail(removeDraft) {
      if (removeDraft && records.has(DRAFT_ID)) {
        pinById.get(DRAFT_ID)?.remove();
        pinById.delete(DRAFT_ID);
        records.delete(DRAFT_ID);
        positions.delete(DRAFT_ID);
      }
      selectedPinId = null;
      pinById.forEach((pin) => pin.classList.remove('is-map-selected'));
      if (detailForm) {
        detailForm.hidden = true;
        detailForm.reset();
      }
    }

    function renderInactivePins() {
      if (!inactiveList || !inactiveSection) return;
      inactiveList.replaceChildren();
      const inactive = Array.from(records.values()).filter((record) => !record.is_active && record.pin_id !== DRAFT_ID);
      inactive.forEach(function (record) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.restorePinId = record.pin_id;
        button.textContent = `Recuperar · ${record.title}`;
        inactiveList.appendChild(button);
      });
      inactiveSection.hidden = inactive.length === 0;
    }

    function updatePinFromPointer(pin, event) {
      const rect = stage.getBoundingClientRect();
      const position = positions.get(pin.dataset.pinId);
      if (!rect.width || !rect.height || !position) return;
      const x = clamp(((event.clientX - rect.left) / rect.width) * 100);
      const y = clamp(((event.clientY - rect.top) / rect.height) * 100);
      if (mobileMedia.matches) {
        position.mobile_x = Number(x.toFixed(2));
        position.mobile_y = Number(y.toFixed(2));
      } else {
        position.x = Number(x.toFixed(2));
        position.y = Number(y.toFixed(2));
      }
      applyPosition(position);
      if (pin.dataset.pinId !== DRAFT_ID) markDirty();
    }

    function beginDrag(pin, event) {
      if (!editing || event.button !== 0 || pin.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      activePointerId = event.pointerId;
      activePin = pin;
      pin.classList.add('is-dragging');
      pin.setAttribute('aria-grabbed', 'true');
      pin.setPointerCapture?.(event.pointerId);
      updatePinFromPointer(pin, event);
    }

    function moveDrag(event) {
      if (!editing || !activePin || event.pointerId !== activePointerId) return;
      event.preventDefault();
      updatePinFromPointer(activePin, event);
    }

    function endDrag(event) {
      if (!activePin || event.pointerId !== activePointerId) return;
      activePin.classList.remove('is-dragging');
      activePin.setAttribute('aria-grabbed', 'false');
      activePin.releasePointerCapture?.(event.pointerId);
      activePin = null;
      activePointerId = null;
    }

    function moveWithKeyboard(pin, event) {
      if (!editing || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const position = positions.get(pin.dataset.pinId);
      if (!position) return;
      const step = event.shiftKey ? 2 : 0.5;
      const xKey = mobileMedia.matches ? 'mobile_x' : 'x';
      const yKey = mobileMedia.matches ? 'mobile_y' : 'y';
      if (event.key === 'ArrowLeft') position[xKey] = clamp(position[xKey] - step);
      if (event.key === 'ArrowRight') position[xKey] = clamp(position[xKey] + step);
      if (event.key === 'ArrowUp') position[yKey] = clamp(position[yKey] - step);
      if (event.key === 'ArrowDown') position[yKey] = clamp(position[yKey] + step);
      applyPosition(position);
      if (pin.dataset.pinId !== DRAFT_ID) markDirty();
    }

    function handlePrivatePinClick(event) {
      if (!editRequested || editor?.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      selectPin(event.currentTarget.dataset.pinId, event.currentTarget.dataset.pinId === DRAFT_ID);
    }

    function bindPin(pin) {
      pin.addEventListener('pointerdown', (event) => beginDrag(pin, event));
      pin.addEventListener('pointermove', moveDrag);
      pin.addEventListener('pointerup', endDrag);
      pin.addEventListener('pointercancel', endDrag);
      pin.addEventListener('keydown', (event) => moveWithKeyboard(pin, event));
      pin.addEventListener('click', handlePrivatePinClick, true);
    }

    Array.from(stage.querySelectorAll('.map-pin[data-pin-id]')).forEach(function (pin) {
      const category = pin.dataset.category === 'experiences' ? 'experiences' : 'nanas';
      const position = normalizePosition({
        pin_id: pin.dataset.pinId,
        x: numberFromStyle(pin, '--x', 50),
        y: numberFromStyle(pin, '--y', 50),
        mobile_x: numberFromStyle(pin, '--x-movil', numberFromStyle(pin, '--x', 50)),
        mobile_y: numberFromStyle(pin, '--y-movil', numberFromStyle(pin, '--y', 50))
      });
      pinById.set(pin.dataset.pinId, pin);
      records.set(pin.dataset.pinId, normalizeRecord({
        pin_id: pin.dataset.pinId,
        category,
        title: pin.dataset.title,
        description: pin.dataset.text,
        symbol: pin.querySelector('span')?.textContent,
        is_active: true,
        is_builtin: true
      }));
      positions.set(position.pin_id, position);
      bindPin(pin);
    });
    defaultPositions = copyMap(positions);
    savedPositions = copyMap(positions);

    async function loadPublicPins() {
      if (!client) return;
      const result = await client.rpc('get_map_pin_positions');
      if (result.error || !Array.isArray(result.data)) return;
      const activeIds = new Set(result.data.map((record) => record.pin_id));
      result.data.forEach(upsertRecord);
      pinById.forEach(function (pin, pinId) {
        if (pinId !== DRAFT_ID && !activeIds.has(pinId)) pin.hidden = true;
      });
      savedPositions = copyMap(positions);
    }

    async function authorizeEditor() {
      if (!editRequested || !editor) return;
      if (!client) {
        editor.hidden = false;
        editor.classList.add('has-error');
        if (actions) actions.hidden = true;
        setStatus('El editor necesita la conexión del sitio para comprobar tu sesión.', 'error');
        return;
      }
      const userResult = await client.auth.getUser();
      if (userResult.error || !userResult.data?.user) {
        window.location.replace('pages/voluntariado.html?access=mi-ruka');
        return;
      }
      const result = await client.rpc('admin_get_map_pin_positions');
      if (result.error || !Array.isArray(result.data)) {
        editor.hidden = false;
        editor.classList.add('has-error');
        if (actions) actions.hidden = true;
        setStatus('No fue posible habilitar la edición con esta sesión administrativa.', 'error');
        return;
      }
      result.data.forEach(function (rawRecord) {
        const record = upsertRecord(rawRecord);
        defaultPositions.set(record.pin_id, normalizePosition({
          pin_id: record.pin_id,
          x: rawRecord.default_x,
          y: rawRecord.default_y,
          mobile_x: rawRecord.default_mobile_x,
          mobile_y: rawRecord.default_mobile_y
        }, positions.get(record.pin_id)));
      });
      savedPositions = copyMap(positions);
      editor.hidden = false;
      updateModeLabel();
      renderInactivePins();
      setEditing(false);
      editor.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center'
      });
    }

    addButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        closeDetail(true);
        const category = button.dataset.mapAddPin === 'experiences' ? 'experiences' : 'nanas';
        const record = upsertRecord({
          pin_id: DRAFT_ID,
          category,
          title: 'Nuevo punto',
          description: 'Descripción pendiente',
          symbol: category === 'nanas' ? '✦' : '❋',
          is_active: true,
          is_builtin: false,
          x: 50,
          y: 50,
          mobile_x: 50,
          mobile_y: 50
        });
        applyRecordToPin(record);
        setEditing(true);
        selectPin(DRAFT_ID, true);
      });
    });

    detailClose?.addEventListener('click', function () {
      closeDetail(selectedPinId === DRAFT_ID);
    });

    detailForm?.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!client || !selectedPinId || !detailForm.reportValidity()) return;
      const submitButton = detailForm.querySelector('[data-map-pin-detail-save]');
      const category = detailForm.elements.category.value;
      const title = detailForm.elements.title.value.trim();
      const description = detailForm.elements.description.value.trim();
      submitButton.disabled = true;
      hideButton.disabled = true;
      setDetailStatus('Guardando…', 'info');
      loader?.show('Guardando pin…');
      let result;
      try {
        if (selectedPinId === DRAFT_ID) {
          const position = positions.get(DRAFT_ID);
          result = await client.rpc('admin_create_map_pin', {
            p_category: category,
            p_title: title,
            p_description: description,
            p_x: position.x,
            p_y: position.y,
            p_mobile_x: position.mobile_x,
            p_mobile_y: position.mobile_y
          });
        } else {
          result = await client.rpc('admin_update_map_pin', {
            p_pin_id: selectedPinId,
            p_category: category,
            p_title: title,
            p_description: description
          });
        }
      } catch (_) {
        result = { data: null, error: true };
      } finally {
        loader?.hide();
        submitButton.disabled = false;
        hideButton.disabled = false;
      }
      if (result.error || !Array.isArray(result.data) || !result.data[0]) {
        setDetailStatus('No fue posible guardar. Revisa los datos e inténtalo nuevamente.', 'error');
        return;
      }
      if (selectedPinId === DRAFT_ID) {
        pinById.get(DRAFT_ID)?.remove();
        pinById.delete(DRAFT_ID);
        records.delete(DRAFT_ID);
        positions.delete(DRAFT_ID);
      }
      const savedRecord = upsertRecord(result.data[0]);
      savedPositions.set(savedRecord.pin_id, { ...positions.get(savedRecord.pin_id) });
      defaultPositions.set(savedRecord.pin_id, normalizePosition({
        pin_id: savedRecord.pin_id,
        x: savedRecord.default_x,
        y: savedRecord.default_y,
        mobile_x: savedRecord.default_mobile_x,
        mobile_y: savedRecord.default_mobile_y
      }, positions.get(savedRecord.pin_id)));
      selectedPinId = savedRecord.pin_id;
      renderInactivePins();
      closeDetail(false);
      setStatus('Pin guardado y publicado correctamente.', 'success');
    });

    hideButton?.addEventListener('click', async function () {
      if (!client || !selectedPinId || selectedPinId === DRAFT_ID) return;
      hideButton.disabled = true;
      loader?.show('Quitando pin del mapa…');
      let result;
      try {
        result = await client.rpc('admin_set_map_pin_active', { p_pin_id: selectedPinId, p_active: false });
      } catch (_) {
        result = { data: null, error: true };
      } finally {
        loader?.hide();
        hideButton.disabled = false;
      }
      if (result.error || !Array.isArray(result.data) || !result.data[0]) {
        setDetailStatus('No fue posible quitar el pin.', 'error');
        return;
      }
      upsertRecord(result.data[0]);
      renderInactivePins();
      closeDetail(false);
      setStatus('El pin fue retirado. Puedes recuperarlo desde la lista inferior.', 'success');
    });

    inactiveList?.addEventListener('click', async function (event) {
      const button = event.target.closest('[data-restore-pin-id]');
      if (!button || !client) return;
      button.disabled = true;
      loader?.show('Recuperando pin…');
      let result;
      try {
        result = await client.rpc('admin_set_map_pin_active', { p_pin_id: button.dataset.restorePinId, p_active: true });
      } catch (_) {
        result = { data: null, error: true };
      } finally {
        loader?.hide();
      }
      if (result.error || !Array.isArray(result.data) || !result.data[0]) {
        button.disabled = false;
        setStatus('No fue posible recuperar el pin.', 'error');
        return;
      }
      upsertRecord(result.data[0]);
      renderInactivePins();
      setStatus('Pin recuperado y visible nuevamente.', 'success');
    });

    toggleButton?.addEventListener('click', () => setEditing(!editing));

    cancelButton?.addEventListener('click', function () {
      positions = copyMap(savedPositions);
      applyAll(positions);
      dirty = false;
      setEditing(false);
      setStatus('Los cambios de posición sin guardar fueron descartados.', 'success');
    });

    resetButton?.addEventListener('click', function () {
      positions = copyMap(defaultPositions);
      applyAll(positions);
      setEditing(true);
      markDirty();
      setStatus('Posiciones originales recuperadas. Presiona Guardar para publicarlas.', 'warning');
    });

    saveButton?.addEventListener('click', async function () {
      if (!client || !dirty) return;
      saveButton.disabled = true;
      toggleButton.disabled = true;
      cancelButton.disabled = true;
      resetButton.disabled = true;
      setStatus('Guardando las nuevas posiciones…', 'info');
      loader?.show('Guardando posiciones…');
      const payload = Array.from(positions.values())
        .filter((position) => position.pin_id !== DRAFT_ID)
        .map((position) => ({
          pin_id: position.pin_id,
          x: position.x,
          y: position.y,
          mobile_x: position.mobile_x,
          mobile_y: position.mobile_y
        }));
      let result;
      try {
        result = await client.rpc('admin_save_map_pin_positions', { p_positions: payload });
      } catch (_) {
        result = { data: null, error: true };
      } finally {
        loader?.hide();
        toggleButton.disabled = false;
        cancelButton.disabled = false;
        resetButton.disabled = false;
      }
      if (result.error || !Array.isArray(result.data)) {
        setStatus('No fue posible guardar. Tus cambios siguen visibles para que puedas intentarlo nuevamente.', 'error');
        saveButton.disabled = false;
        return;
      }
      result.data.forEach(function (record) {
        if (!positions.has(record.pin_id)) return;
        positions.set(record.pin_id, normalizePosition(record, positions.get(record.pin_id)));
      });
      applyAll(positions);
      savedPositions = copyMap(positions);
      dirty = false;
      setEditing(false);
      setStatus('Posiciones guardadas y publicadas correctamente.', 'success');
    });

    mobileMedia.addEventListener?.('change', updateModeLabel);
    window.addEventListener('beforeunload', function (event) {
      if (!dirty && !records.has(DRAFT_ID)) return;
      event.preventDefault();
      event.returnValue = '';
    });

    loadPublicPins()
      .catch(function () { /* El HTML conserva posiciones y contenido de respaldo. */ })
      .finally(function () {
        authorizeEditor().catch(function () {
          if (!editor || !editRequested) return;
          editor.hidden = false;
          editor.classList.add('has-error');
          if (actions) actions.hidden = true;
          setStatus('Ocurrió un problema al preparar la edición del mapa.', 'error');
        });
      });
  });
})();
