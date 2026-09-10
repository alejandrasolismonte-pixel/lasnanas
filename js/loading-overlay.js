/* CARGADOR GLOBAL: crea una sola capa y expone una API pequeña para cada espera. */
(() => {
  let overlay;
  let messageNode;

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

  window.LasNanasLoader = Object.freeze({
    show(message = 'Cargando…') {
      ensureOverlay();
      messageNode.textContent = message;
      overlay.hidden = false;
      document.body.setAttribute('aria-busy', 'true');
    },
    hide() {
      if (overlay) overlay.hidden = true;
      document.body.removeAttribute('aria-busy');
    }
  });
})();
