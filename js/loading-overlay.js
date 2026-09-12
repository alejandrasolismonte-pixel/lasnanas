/* CARGADOR GLOBAL: crea una sola capa y expone una API pequeña para cada espera. */
(() => {
  let overlay;
  let messageNode;
  let navigationTimer;

  const ensureOverlay = () => {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-atomic', 'true');
    overlay.innerHTML = `
      <div class="loading-overlay__content">
        <div class="loading-overlay__loader" aria-hidden="true">
          <svg viewBox="0 0 100 100" focusable="false">
            <path class="loader-path" d="M50 12 L78 50 L50 88 L22 50 Z"></path>
            <path class="loader-inner" d="M50 28 L65 50 L50 72 L35 50 Z"></path>
          </svg>
        </div>
        <p class="loading-overlay__message"></p>
      </div>`;
    document.body.append(overlay);
    messageNode = overlay.querySelector('.loading-overlay__message');
    return overlay;
  };

  const loader = Object.freeze({
    show(message = 'Cargando…') {
      window.clearTimeout(navigationTimer);
      ensureOverlay();
      messageNode.textContent = message;
      overlay.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
    },
    hide() {
      window.clearTimeout(navigationTimer);
      if (overlay) overlay.hidden = true;
      document.body.removeAttribute('aria-busy');
    }
  });

  window.LasNanasLoader = loader;

  const scheduleForNavigation = () => {
    window.clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(() => loader.show('Cargando la página…'), 180);
  };

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return;

    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    scheduleForNavigation();
  });

  document.addEventListener('submit', (event) => {
    if (event.target?.method?.toLowerCase() === 'dialog') return;
    window.setTimeout(() => {
      if (!event.defaultPrevented) scheduleForNavigation();
    }, 0);
  });

  window.addEventListener('pageshow', () => loader.hide());
})();
