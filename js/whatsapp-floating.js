(() => {
  'use strict';

  const WHATSAPP_URL = 'https://wa.me/56963888066?text=' +
    encodeURIComponent('Hola, quisiera información sobre Las Ñañas.');

  function crearBotonWhatsApp() {
    if (document.querySelector('.whatsapp-floating')) return;

    const heroInicio = document.querySelector('#inicio.hero');
    const enlace = document.createElement('a');
    enlace.className = 'whatsapp-floating';
    enlace.href = WHATSAPP_URL;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    enlace.setAttribute('aria-label', 'Contactar a Las Ñañas por WhatsApp');
    enlace.innerHTML = `
      <span class="whatsapp-floating__sign" aria-hidden="true">
        <svg class="whatsapp-floating__svg" viewBox="0 0 16 16" focusable="false">
          <path d="M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z"/>
        </svg>
      </span>
      <span class="whatsapp-floating__label">WhatsApp</span>`;

    if (heroInicio) {
      const actualizarVisibilidad = () => {
        const oculto = heroInicio.getBoundingClientRect().bottom > 0;
        if (enlace.classList.contains('is-before-hero-exit') === oculto) return;
        enlace.classList.toggle('is-before-hero-exit', oculto);
        if (oculto) {
          enlace.setAttribute('aria-hidden', 'true');
          enlace.tabIndex = -1;
          enlace.classList.remove('is-expanded');
          if (document.activeElement === enlace) enlace.blur();
        } else {
          enlace.removeAttribute('aria-hidden');
          enlace.removeAttribute('tabindex');
        }
      };

      // Fija el estado antes de insertar el enlace para evitar un destello en el hero.
      actualizarVisibilidad();
      window.addEventListener('scroll', actualizarVisibilidad, { passive: true });
      window.addEventListener('resize', actualizarVisibilidad);
      window.addEventListener('pageshow', actualizarVisibilidad);
    }

    document.body.appendChild(enlace);

    // En pantallas táctiles abre el rótulo brevemente y después recupera el círculo.
    // El enlace conserva su apertura normal hacia WhatsApp.
    let temporizadorCierre;
    const recogerBoton = () => {
      window.clearTimeout(temporizadorCierre);
      enlace.classList.remove('is-expanded');
      enlace.blur();
    };

    enlace.addEventListener('click', () => {
      const esPantallaTactil = window.matchMedia('(hover: none), (pointer: coarse)').matches;
      if (!esPantallaTactil) return;

      window.clearTimeout(temporizadorCierre);
      enlace.classList.add('is-expanded');
      temporizadorCierre = window.setTimeout(recogerBoton, 900);
    });

    // Garantiza que al volver desde WhatsApp nunca permanezca expandido.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) recogerBoton();
    });

    // En pantallas estrechas un formulario ocupa todo el ancho; el CTA se
    // aparta mientras esa alternativa de contacto está visible.
    const formularios = document.querySelectorAll('[data-contact-form]');
    if (formularios.length && typeof IntersectionObserver === 'function') {
      const formulariosVisibles = new Set();
      const observador = new IntersectionObserver((entradas) => {
        entradas.forEach((entrada) => {
          if (entrada.isIntersecting) formulariosVisibles.add(entrada.target);
          else formulariosVisibles.delete(entrada.target);
        });
        enlace.classList.toggle('is-near-form', formulariosVisibles.size > 0);
      }, { threshold: 0.08 });

      formularios.forEach((formulario) => observador.observe(formulario));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', crearBotonWhatsApp, { once: true });
  } else {
    crearBotonWhatsApp();
  }
})();
