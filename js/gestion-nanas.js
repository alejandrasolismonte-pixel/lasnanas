/* Panel independiente. Supabase Auth identifica a la encargada; RLS autoriza cada dato. */
(function () {
  'use strict';

  const config = window.LAS_NANAS_CONFIG;
  const validConfig = config?.supabaseUrl && config?.supabasePublishableKey &&
    !/service_role|secret/i.test(config.supabasePublishableKey) && window.supabase?.createClient;
  const client = validConfig ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storageKey: 'lasnanas-nanas-auth-v1' }
  }) : null;
  // El editor ya existente de pines usa este contrato; esta sesión es distinta
  // de la sesión del portal de voluntariado.
  window.LasNanasSupabase = { client, error: client ? '' : 'La conexión de Supabase no está configurada.' };

  const STATUS = { active: 'Activa', in_process: 'En proceso', inactive: 'Inactiva / archivada' };
  const CATEGORY = {
    espiritualidad_cosmovision: 'Espiritualidad / cosmovisión', turismo_rural: 'Turismo rural',
    agricultura_agroecologia: 'Agricultura / agroecología', artesania: 'Artesanía',
    gastronomia_alimentos: 'Gastronomía / alimentos', oficios_saberes: 'Oficios y saberes', otro: 'Otro'
  };
  const AGRICULTURE = { hortalizas: 'Hortalizas', huevos_aves: 'Huevos / aves', semillas: 'Semillas',
    frutales: 'Frutales', cultivos_varios: 'Cultivos varios', otro: 'Otro' };
  const OFFERING = { paseos_recorridos: 'Paseos o recorridos', comidas: 'Comidas',
    ensenanza_oficio: 'Enseñanza de un oficio', experiencia_cultural: 'Experiencia cultural',
    aprendizaje_agroecologico: 'Aprendizaje agroecológico', otra: 'Otra experiencia' };
  const FOOD = { included: 'Incluida', partial: 'Parcial', not_included: 'No incluida' };
  const FOOD_TYPE = { general: 'General', vegetariana: 'Vegetariana', vegana: 'Vegana', otra: 'Otra' };
  const LODGING = { included: 'Incluido', subject_to_availability: 'Depende de disponibilidad',
    not_included: 'No incluido' };

  document.addEventListener('DOMContentLoaded', function () {
    const loginPanel = document.querySelector('[data-login-panel]');
    const loginForm = document.querySelector('[data-login-form]');
    const loginMessage = document.querySelector('[data-login-message]');
    const panel = document.querySelector('[data-panel]');
    const account = document.querySelector('[data-account]');
    const form = document.querySelector('[data-nana-form]');
    const formMessage = document.querySelector('[data-form-message]');
    const listMessage = document.querySelector('[data-list-message]');
    const detail = document.querySelector('[data-detail]');
    const mapRequested = new URLSearchParams(location.search).get('editar-mapa') === '1';
    let records = [];
    let editingId = null;
    let busy = false;

    function message(node, text, success = false) {
      node.textContent = text;
      node.classList.toggle('is-success', success);
    }

    function showView(view) {
      document.querySelectorAll('[data-view]').forEach(section => {
        section.hidden = section.dataset.view !== view;
      });
      document.querySelectorAll('[data-view-button]').forEach(button => {
        const active = button.dataset.viewButton === view;
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      });
    }

    function labels(values, dictionary) {
      return (values || []).map(value => dictionary[value] || value).join(', ') || '—';
    }

    function setAccess(allowed, user) {
      loginPanel.hidden = allowed;
      panel.hidden = !allowed;
      account.hidden = !allowed;
      document.querySelector('[data-account-email]').textContent = allowed ? user.email : '';
      if (allowed) showView(mapRequested ? 'pines' : 'resumen');
    }

    async function authorize() {
      if (!client) { message(loginMessage, window.LasNanasSupabase.error); return false; }
      const { data: userResult, error: userError } = await client.auth.getUser();
      if (userError || !userResult.user) { setAccess(false); return false; }
      const { data: allowed, error: roleError } = await client.rpc('is_nanas_manager');
      if (roleError || allowed !== true) {
        await client.auth.signOut();
        setAccess(false);
        message(loginMessage, 'Esta cuenta no tiene acceso al panel de Ñañas.');
        return false;
      }
      setAccess(true, userResult.user);
      await loadRecords();
      return true;
    }

    async function loadRecords() {
      const { data, error } = await client.from('nanas')
        .select('id,first_name,last_name,territory,categories,status,status_before_archive,experience_offerings,activities,archived_at,created_at')
        .order('created_at', { ascending: false });
      if (error) {
        records = [];
        renderSummary();
        renderList();
        message(listMessage, 'No fue posible consultar las Ñañas registradas.');
        return;
      }
      records = data || [];
      renderSummary();
      renderList();
      message(listMessage, '');
    }

    function renderSummary() {
      for (const status of ['active', 'in_process', 'inactive']) {
        document.querySelector(`[data-count="${status}"]`).textContent = String(records.filter(row =>
          status === 'inactive' ? row.status === 'inactive' || row.archived_at : row.status === status && !row.archived_at
        ).length);
      }
      const recent = document.querySelector('[data-recent-list]');
      recent.replaceChildren();
      if (!records.length) { recent.textContent = 'Aún no hay registros.'; return; }
      records.slice(0, 5).forEach(row => {
        const item = document.createElement('article');
        const name = document.createElement('strong');
        const date = document.createElement('small');
        name.textContent = `${row.first_name} ${row.last_name}`;
        date.textContent = `${row.territory} · ${new Date(row.created_at).toLocaleDateString('es-CL')}`;
        item.append(name, date);
        recent.append(item);
      });
    }

    function rowButton(label, action, id) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.action = action;
      button.dataset.id = id;
      return button;
    }

    function renderList() {
      const body = document.querySelector('[data-nanas-list]');
      body.replaceChildren();
      if (!records.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.textContent = 'Aún no hay Ñañas registradas.';
        row.append(cell);
        body.append(row);
        return;
      }
      records.forEach(record => {
        const row = document.createElement('tr');
        const fields = [
          `${record.first_name} ${record.last_name}`, record.territory,
          labels(record.categories, CATEGORY), STATUS[record.status] || record.status,
          labels(record.experience_offerings, OFFERING)
        ];
        fields.forEach((value, index) => {
          const cell = document.createElement('td');
          if (index === 3) {
            const badge = document.createElement('span');
            badge.className = `nanas-status nanas-status--${record.status}`;
            badge.textContent = value;
            cell.append(badge);
          } else cell.textContent = value;
          row.append(cell);
        });
        const actions = document.createElement('td');
        actions.className = 'nanas-row-actions';
        actions.append(rowButton('Ver', 'view', record.id), rowButton('Editar', 'edit', record.id),
          rowButton(record.status === 'inactive' ? 'Reactivar' : 'Archivar',
            record.status === 'inactive' ? 'reactivate' : 'archive', record.id));
        row.append(actions);
        body.append(row);
      });
    }

    async function getDetail(id) {
      const { data, error } = await client.from('nanas').select('*').eq('id', id).single();
      if (error || !data) throw new Error('No fue posible abrir esta ficha.');
      return data;
    }

    function renderDetail(row) {
      const data = [
        ['Nombre', `${row.first_name} ${row.last_name}`], ['RUT · privado', row.rut],
        ['Estado', STATUS[row.status]], ['Dirección exacta · privada', row.exact_address],
        ['Territorio / localidad', row.territory], ['Comuna', row.commune],
        ['Rubros', labels(row.categories, CATEGORY)], ['Agricultura / agroecología', labels(row.agriculture_items, AGRICULTURE)],
        ['Reseña de la Ñaña', row.nana_bio], ['Reseña del territorio', row.territory_bio],
        ['Actividades', row.activities], ['Experiencia', labels(row.experience_offerings, OFFERING)],
        ['Alimentación', FOOD[row.food_inclusion]], ['Tipos de alimentación', labels(row.food_types, FOOD_TYPE)],
        ['Observaciones de alimentación', row.food_notes], ['Alojamiento', LODGING[row.lodging_inclusion]],
        ['Descripción del alojamiento', row.lodging_description], ['Notas de administración · privadas', row.admin_notes]
      ];
      const content = document.querySelector('[data-detail-content]');
      content.replaceChildren();
      data.forEach(([label, value]) => {
        const wrapper = document.createElement('div');
        const term = document.createElement('dt');
        const definition = document.createElement('dd');
        term.textContent = label;
        definition.textContent = value || '—';
        wrapper.append(term, definition);
        content.append(wrapper);
      });
      detail.hidden = false;
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function checkedValues(name) {
      return [...form.querySelectorAll(`[data-choices="${name}"] input:checked`)].map(input => input.value);
    }

    function setCheckedValues(name, values) {
      form.querySelectorAll(`[data-choices="${name}"] input`).forEach(input => {
        input.checked = (values || []).includes(input.value);
      });
    }

    function updateAgriculture() {
      const selected = checkedValues('categories').includes('agricultura_agroecologia');
      form.querySelector('[data-agriculture-options]').hidden = !selected;
      if (!selected) setCheckedValues('agriculture_items', []);
    }

    function fillForm(row) {
      editingId = row.id;
      form.reset();
      for (const name of ['first_name', 'last_name', 'rut', 'status', 'exact_address', 'territory',
        'commune', 'nana_bio', 'territory_bio', 'activities', 'food_inclusion', 'food_notes',
        'lodging_inclusion', 'lodging_description', 'admin_notes']) {
        form.elements[name].value = row[name] ?? '';
      }
      for (const name of ['categories', 'agriculture_items', 'experience_offerings', 'food_types']) {
        setCheckedValues(name, row[name]);
      }
      updateAgriculture();
      document.querySelector('#form-title').textContent = 'Editar Ñaña';
      message(formMessage, '');
      showView('agregar');
      document.querySelector('#form-title').scrollIntoView({ block: 'start' });
    }

    function resetForm() {
      editingId = null;
      form.reset();
      updateAgriculture();
      document.querySelector('#form-title').textContent = 'Agregar Ñaña';
      message(formMessage, '');
    }

    function validRut(value) {
      const compact = value.replace(/[.\s-]/g, '').toUpperCase();
      if (!/^\d{6,8}[0-9K]$/.test(compact)) return false;
      const digits = compact.slice(0, -1).split('').reverse();
      const sum = digits.reduce((total, digit, index) => total + Number(digit) * (index % 6 + 2), 0);
      const remainder = 11 - sum % 11;
      const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
      return compact.at(-1) === expected;
    }

    function payload(statusOverride) {
      const value = name => form.elements[name].value.trim();
      return {
        first_name: value('first_name'), last_name: value('last_name'), rut: value('rut').toUpperCase(),
        status: statusOverride || value('status'), exact_address: value('exact_address'),
        territory: value('territory'), commune: value('commune'), categories: checkedValues('categories'),
        agriculture_items: checkedValues('agriculture_items'), nana_bio: value('nana_bio'),
        territory_bio: value('territory_bio'), activities: value('activities'),
        experience_offerings: checkedValues('experience_offerings'), food_inclusion: value('food_inclusion'),
        food_types: checkedValues('food_types'), food_notes: value('food_notes'),
        lodging_inclusion: value('lodging_inclusion'), lodging_description: value('lodging_description'),
        admin_notes: value('admin_notes')
      };
    }

    async function save(statusOverride) {
      if (busy) return;
      message(formMessage, '');
      if (!form.reportValidity()) return;
      const values = payload(statusOverride);
      if (values.first_name.length < 2 || values.last_name.length < 2 ||
          values.territory.length < 2 || values.commune.length < 2 || values.exact_address.length < 2) {
        message(formMessage, 'Completa los datos de identificación con al menos dos caracteres.');
        return;
      }
      if (!validRut(values.rut)) { message(formMessage, 'Revisa el RUT y su dígito verificador.'); return; }
      if (values.status === 'active' && !values.categories.length) {
        message(formMessage, 'Selecciona al menos un rubro para una Ñaña activa.'); return;
      }
      busy = true;
      form.querySelectorAll('button').forEach(button => button.disabled = true);
      message(formMessage, 'Guardando…');
      try {
        const result = editingId
          ? await client.from('nanas').update(values).eq('id', editingId).select('id').single()
          : await client.from('nanas').insert(values).select('id').single();
        if (result.error) throw result.error;
        resetForm();
        await loadRecords();
        showView('registradas');
        detail.hidden = true;
        message(listMessage, 'Ñaña guardada correctamente.', true);
      } catch (error) {
        message(formMessage, error.code === '23505' ? 'Ya existe una Ñaña con ese RUT.' :
          'No fue posible guardar la ficha. Revisa los datos e intenta nuevamente.');
      } finally {
        busy = false;
        form.querySelectorAll('button').forEach(button => button.disabled = false);
      }
    }

    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!client) { message(loginMessage, window.LasNanasSupabase.error); return; }
      const button = loginForm.querySelector('[type="submit"]');
      button.disabled = true;
      message(loginMessage, 'Verificando acceso…');
      const email = loginForm.elements.email.value.trim().toLowerCase();
      const password = loginForm.elements.password.value;
      try {
        const { error } = await client.auth.signInWithPassword({ email, password });
        loginForm.elements.password.value = '';
        if (error) { message(loginMessage, 'Correo o contraseña incorrectos.'); return; }
        if (await authorize() && mapRequested) location.reload();
      } catch (_) {
        message(loginMessage, 'No fue posible iniciar sesión. Intenta nuevamente.');
      } finally { button.disabled = false; }
    });

    document.querySelector('[data-logout]').addEventListener('click', async () => {
      await client.auth.signOut();
      records = [];
      resetForm();
      setAccess(false);
      message(loginMessage, 'Sesión cerrada.', true);
    });

    document.querySelectorAll('button[data-view-button]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.viewButton === 'agregar') resetForm();
        showView(button.dataset.viewButton);
      });
    });
    document.querySelector('[data-detail-close]').addEventListener('click', () => { detail.hidden = true; });
    form.querySelector('[data-choices="categories"]').addEventListener('change', updateAgriculture);
    form.addEventListener('submit', event => { event.preventDefault(); save(); });
    form.querySelector('[data-save-draft]').addEventListener('click', () => save('in_process'));

    document.querySelector('[data-nanas-list]').addEventListener('click', async event => {
      const button = event.target.closest('button[data-action]');
      if (!button || busy) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      button.disabled = true;
      message(listMessage, '');
      try {
        if (action === 'view') renderDetail(await getDetail(id));
        if (action === 'edit') fillForm(await getDetail(id));
        if (action === 'archive' || action === 'reactivate') {
          const nextStatus = action === 'archive' ? 'inactive' :
            records.find(row => row.id === id)?.status_before_archive || 'in_process';
          const { error } = await client.from('nanas').update({ status: nextStatus }).eq('id', id)
            .select('id').single();
          if (error) throw error;
          detail.hidden = true;
          await loadRecords();
          message(listMessage, action === 'archive' ? 'Ñaña archivada.' : 'Ñaña reactivada.', true);
        }
      } catch (_) {
        message(listMessage, 'No fue posible completar esta acción. Intenta nuevamente.');
      } finally { button.disabled = false; }
    });

    authorize().catch(() => message(loginMessage, 'No fue posible verificar el acceso. Recarga la página.'));
  });
})();
