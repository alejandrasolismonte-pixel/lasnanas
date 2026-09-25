(() => {
  const start = () => {
    const cinema = document.querySelector('.cinema');
    if (!cinema || !document.documentElement.classList.contains('cinema-enabled')) return;

    const site = document.querySelector('#site-content');
    const siteMain = document.querySelector('#contenido');
    const fire = document.querySelector('[data-scene="fire"]');
    const story = document.querySelector('[data-scene="story"]');
    const gate = document.querySelector('[data-scene="gate"]');
    const video = fire?.querySelector('video');
    const places = [...story.querySelectorAll('.cinema__places li')];
    const title = story.querySelector('.cinema__title');
    const subtitle = story.querySelector('.cinema__subtitle');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let leaving = false;

    site.inert = true;
    site.setAttribute('aria-hidden', 'true');

    // VELOCIDAD: cambia estos milisegundos para ajustar la entrada.
    // Cada frase tarda 3000 ms y la siguiente comienza al terminar la anterior.
    // Con las tres frases ya visibles, la compuerta espera 5000 ms antes de cerrarse.
    const TIMING = {
      video: 3000,
      sceneFade: 1400,
      placeStep: 630,
      titleHold: 1500,
      subtitleHold: 1700,
      gatePause: 600,
      seamReveal: 850,
      doorOpen: 1600,
      doorDelay: 240,
      doorClose: 2100,
      messageReveal: 3000,
      messageStagger: 3000,
      messageWindow: 5000,
      messageExit: 550,
      afterClose: 300,
      exitFade: 950
    };

    // Mantiene los fundidos CSS sincronizados con los tiempos anteriores.
    document.documentElement.style.setProperty('--cinema-scene-fade', `${TIMING.sceneFade}ms`);
    document.documentElement.style.setProperty('--cinema-door-open', `${TIMING.doorOpen}ms`);
    document.documentElement.style.setProperty('--cinema-door-delay', `${TIMING.doorDelay}ms`);
    document.documentElement.style.setProperty('--cinema-door-close', `${TIMING.doorClose}ms`);
    document.documentElement.style.setProperty('--cinema-message-reveal', `${TIMING.messageReveal}ms`);
    document.documentElement.style.setProperty('--cinema-message-stagger', `${TIMING.messageStagger}ms`);
    document.documentElement.style.setProperty('--cinema-message-exit', `${TIMING.messageExit}ms`);
    document.documentElement.style.setProperty('--cinema-exit-fade', `${TIMING.exitFade}ms`);

    const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const activate = (scene) => {
      for (const current of [fire, story, gate]) {
        const active = current === scene;
        current.classList.toggle('is-active', active);
        current.setAttribute('aria-hidden', String(!active));
      }
    };
    const revealSite = (focusSite = false) => {
      site.inert = false;
      site.removeAttribute('aria-hidden');
      cinema.hidden = true;
      document.documentElement.classList.remove('cinema-enabled');
      if (focusSite) {
        siteMain?.setAttribute('tabindex', '-1');
        siteMain?.focus({ preventScroll: true });
      }
    };
    const enterSite = async (focusSite = false) => {
      if (leaving) return;
      leaving = true;
      video?.pause();
      cinema.classList.add('is-leaving');
      await wait(reducedMotion.matches ? 0 : TIMING.exitFade);
      revealSite(focusSite);
    };

    cinema.querySelector('[data-skip-intro]')?.addEventListener('click', () => enterSite(true));

    window.addEventListener('pagehide', () => {
      leaving = true;
      video?.pause();
    }, { once: true });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && leaving) revealSite();
    });

    if (reducedMotion.matches) {
      video?.pause();
      activate(gate);
      gate.classList.add('is-opening', 'is-message-visible');
      window.setTimeout(enterSite, TIMING.messageWindow);
      return;
    }

    const playAttempt = video?.play();
    playAttempt?.catch(() => {
      // La pantalla permanece oscura si el navegador bloquea la reproducción.
    });

    const playSequence = async () => {
      // Escena 1: tres segundos de video a pantalla completa, sin texto ni controles.
      await wait(TIMING.video);
      if (leaving) return;

      // Escena 2: el recorrido territorial se funde sobre el video.
      activate(story);
      await wait(TIMING.sceneFade);
      if (leaving) return;
      video?.pause();

      // Escena 3: los territorios aparecen en orden y preceden al título.
      for (const place of places) {
        place.classList.add('is-revealed');
        await wait(TIMING.placeStep);
        if (leaving) return;
      }
      title.classList.add('is-visible');
      await wait(TIMING.titleHold);
      if (leaving) return;
      subtitle.classList.add('is-visible');
      await wait(TIMING.subtitleHold);
      if (leaving) return;

      // Escena 4: la compuerta se abre por completo antes de mostrar el texto.
      activate(gate);
      await wait(TIMING.sceneFade + TIMING.gatePause);
      if (leaving) return;
      gate.classList.add('has-seam');
      await wait(TIMING.seamReveal);
      if (leaving) return;
      gate.classList.add('is-opening');
      await wait(TIMING.doorDelay + TIMING.doorOpen + 100);
      if (leaving) return;
      gate.classList.add('is-message-visible');
      await wait(TIMING.messageReveal + TIMING.messageStagger * 2);
      if (leaving) return;
      await wait(TIMING.messageWindow);
      if (leaving) return;
      gate.classList.remove('is-message-visible');
      gate.classList.add('is-closing');
      await wait(TIMING.messageExit);
      if (leaving) return;
      gate.classList.remove('is-opening', 'has-seam');
      await wait(TIMING.doorClose + TIMING.afterClose);
      if (leaving) return;
      enterSite();
    };

    playSequence();
  };

  // La entrada comienza con el HTML ya presente, sin esperar scripts externos del Inicio.
  start();
})();
