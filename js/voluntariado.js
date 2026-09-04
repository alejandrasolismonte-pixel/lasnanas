document.addEventListener('DOMContentLoaded', () => {
  // 3. Comportamiento de los selectores de periodicidad y moneda.
  const priceControls = document.querySelector('.membership-controls');
  const prices = Array.from(document.querySelectorAll('[data-price]'));
  const currencyLabels = Array.from(document.querySelectorAll('[data-currency-label]'));
  const periodLabels = Array.from(document.querySelectorAll('[data-period-label]'));

  const formatPrice = (value, currency) => {
    const formattedValue = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(value);
    return currency === 'clp' ? `$${formattedValue}` : `US$${formattedValue}`;
  };

  const updateMembershipPrices = () => {
    if (!priceControls) return;

    const billing = priceControls.elements.billing.value;
    const currency = priceControls.elements.currency.value;
    const priceKey = `${billing}${currency.charAt(0).toUpperCase()}${currency.slice(1)}`;

    prices.forEach(price => {
      price.textContent = formatPrice(Number(price.dataset[priceKey]), currency);
    });
    currencyLabels.forEach(label => { label.textContent = currency.toUpperCase(); });
    periodLabels.forEach(label => { label.textContent = billing === 'monthly' ? 'mes' : 'año'; });
  };

  if (priceControls) {
    priceControls.addEventListener('change', updateMembershipPrices);
    updateMembershipPrices();
  }

  // Vincular los selectores con sus paneles de experiencias.
  const volunteerTabs = Array.from(document.querySelectorAll('.volunteer-person[role="tab"]'));
  const volunteerEntries = Array.from(document.querySelectorAll('.volunteer-entry[role="tabpanel"]'));

  // Activar una bitácora y sincronizar sus atributos accesibles.
  const activateVolunteerEntry = (activeTab, moveFocus = false) => {
    volunteerTabs.forEach(tab => {
      const isActive = tab === activeTab;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    // Mostrar únicamente el panel controlado por el selector activo.
    volunteerEntries.forEach(entry => {
      const isActive = entry.id === activeTab.dataset.entry;
      entry.classList.toggle('is-active', isActive);
      entry.hidden = !isActive;
    });

    // Trasladar el foco solo cuando la activación viene del teclado.
    if (moveFocus) activeTab.focus();
  };

  // Cambiar la experiencia al hacer clic, tocar o usar el teclado.
  volunteerTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateVolunteerEntry(tab));

    // Admitir flechas, Inicio y Fin según el patrón accesible de pestañas.
    tab.addEventListener('keydown', event => {
      let nextIndex = null;

      // Calcular el siguiente selector según la tecla pulsada.
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % volunteerTabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + volunteerTabs.length) % volunteerTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = volunteerTabs.length - 1;

      // Evitar desplazar la página cuando la tecla controla las pestañas.
      if (nextIndex !== null) {
        event.preventDefault();
        activateVolunteerEntry(volunteerTabs[nextIndex], true);
      }
    });
  });

});
