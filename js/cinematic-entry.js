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
    const gateAudio = gate.querySelector('[data-gate-audio]');
    const gateDoor = gate.querySelector('.cinema__door--left');
    const skipButton = cinema.querySelector('[data-skip-intro]');
    const soundButton = cinema.querySelector('[data-mute-gate-audio]');
    const places = [...story.querySelectorAll('.cinema__places li')];
    const title = story.querySelector('.cinema__title');
    const subtitle = story.querySelector('.cinema__subtitle');
    const translationButton = gate.querySelector('.cinema__translate');
    const translationTooltip = gate.querySelector('.cinema__translation');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileSoundButton = window.matchMedia('(max-width: 600px)').matches;
    let leaving = false;
    let gateIsOpen = false;
    let soundOff = false;
    let needsSoundGesture = false;
    let gateOpenedAt = 0;

    if (soundButton && !mobileSoundButton) soundButton.hidden = false;

    const stopGateAudio = () => {
      gateIsOpen = false;
      needsSoundGesture = false;
      gateAudio?.pause();
      if (soundButton) soundButton.hidden = true;
    };
    const playGateAudio = () => {
      if (!gateAudio || !gateIsOpen || leaving || soundOff) return;
      try { gateAudio.currentTime = 0; } catch (_) {
        // En móviles el archivo puede no tener metadatos todavía.
      }
      const attempt = gateAudio.play();
      attempt?.then(() => {
        if (soundOff || leaving || !gateIsOpen) gateAudio.pause();
      }).catch(() => {
        // La entrada continúa aunque el navegador bloquee el sonido automático.
        if (mobileSoundButton && soundButton && gateIsOpen && !soundOff && !leaving) {
          needsSoundGesture = true;
          soundButton.textContent = 'Activar sonido';
          soundButton.hidden = false;
        } else if (soundButton) {
          soundButton.hidden = true;
        }
      });
    };

    soundButton?.addEventListener('click', () => {
      if (leaving || !gateAudio) return;
      if (needsSoundGesture && gateIsOpen) {
        const syncGateAudio = () => {
          if (!gateIsOpen || leaving || !Number.isFinite(gateAudio.duration) || gateAudio.duration <= 0) return;
          const elapsed = Math.max(0, (performance.now() - gateOpenedAt) / 1000);
          if (elapsed >= gateAudio.duration) {
            gateAudio.pause();
            soundButton.hidden = true;
            return;
          }
          try {
            gateAudio.currentTime = Math.min(elapsed, gateAudio.duration - .05);
          } catch (_) {
            // La reproducción continúa desde el inicio si el navegador aún no permite buscar.
          }
        };
        if (gateAudio.readyState >= 1) {
          syncGateAudio();
          if (soundButton.hidden) return;
        } else {
          gateAudio.addEventListener('loadedmetadata', syncGateAudio, { once: true });
        }
        const attempt = gateAudio.play();
        attempt?.then(() => {
          if (gateIsOpen && !leaving && !soundOff && !gateAudio.paused) {
            needsSoundGesture = false;
            soundButton.textContent = 'Apagar sonido';
            soundButton.hidden = false;
          }
        }).catch(() => {
          if (gateIsOpen && !leaving) soundButton.hidden = false;
        });
        return;
      }
      soundOff = true;
      gateAudio.pause();
      soundButton.hidden = true;
    });

    gateAudio?.addEventListener('ended', () => {
      if (soundButton) soundButton.hidden = true;
    });
    gateAudio?.addEventListener('playing', () => {
      if (mobileSoundButton && soundButton && gateIsOpen && !soundOff && !leaving) {
        needsSoundGesture = false;
        soundButton.textContent = 'Apagar sonido';
        soundButton.hidden = false;
      }
    });
    gateAudio?.addEventListener('pause', () => {
      if (mobileSoundButton && soundButton && !needsSoundGesture) soundButton.hidden = true;
    });

    gateDoor?.addEventListener('transitionstart', (event) => {
      if (event.target !== gateDoor || event.propertyName !== 'transform' || leaving || gate.classList.contains('is-closing')) return;
      gateIsOpen = true;
      gateOpenedAt = performance.now();
      playGateAudio();
    });
    gateDoor?.addEventListener('transitionend', (event) => {
      if (event.target === gateDoor && event.propertyName === 'transform' && gate.classList.contains('is-closing')) {
        stopGateAudio();
      }
    });

    if (translationButton && translationTooltip) {
      translationTooltip.textContent = translationButton.dataset.translation || '';
      translationButton.addEventListener('click', () => {
        const isOpen = translationButton.getAttribute('aria-expanded') === 'true';
        translationButton.setAttribute('aria-expanded', String(!isOpen));
        translationButton.setAttribute('aria-label', isOpen ? 'Mostrar traducción del saludo' : 'Ocultar traducción del saludo');
      });
      translationButton.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          translationButton.setAttribute('aria-expanded', 'false');
          translationButton.setAttribute('aria-label', 'Mostrar traducción del saludo');
          translationButton.blur();
        }
      });
    }

    site.inert = true;
    site.setAttribute('aria-hidden', 'true');

    // VELOCIDAD: cambia estos milisegundos para ajustar la entrada.
    // Cada frase tarda 3000 ms y la siguiente comienza al terminar la anterior.
    // Con las tres frases ya visibles, la compuerta espera 5000 ms antes de cerrarse.
    const TIMING = {
      video: window.matchMedia('(max-width: 600px)').matches ? 5000 : 3000,
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
      exitFade: 1600
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
    const waitForTranslation = async () => {
      while (translationButton && (
        translationButton.getAttribute('aria-expanded') === 'true' ||
        (window.matchMedia('(hover: hover)').matches && translationButton.matches(':hover'))
      )) {
        await wait(250);
        if (leaving) return;
      }
    };
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
      stopGateAudio();
      cinema.classList.add('is-leaving');
      await wait(reducedMotion.matches ? 0 : TIMING.exitFade);
      revealSite(focusSite);
    };

    skipButton?.addEventListener('click', () => enterSite(true));

    window.addEventListener('pagehide', () => {
      leaving = true;
      video?.pause();
      stopGateAudio();
    }, { once: true });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && leaving) revealSite();
    });

    if (reducedMotion.matches) {
      video?.pause();
      if (skipButton) skipButton.hidden = false;
      activate(gate);
      gate.classList.add('is-opening', 'is-message-visible');
      window.setTimeout(async () => {
        await waitForTranslation();
        if (!leaving) enterSite();
      }, TIMING.messageWindow);
      return;
    }

    const playAttempt = video?.play();
    playAttempt?.catch(() => {
      // La pantalla permanece oscura si el navegador bloquea la reproducción.
    });

    const playSequence = async () => {
      // Escena 1: cinco segundos en móvil y tres en escritorio, sin texto ni controles.
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
      if (skipButton) skipButton.hidden = false;
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
      window.setTimeout(() => {
        if (leaving || gateIsOpen || gate.classList.contains('is-closing')) return;
        gateIsOpen = true;
        gateOpenedAt = performance.now();
        playGateAudio();
      }, TIMING.doorDelay + 50);
      await wait(TIMING.doorDelay + TIMING.doorOpen + 100);
      if (leaving) return;
      gate.classList.add('is-message-visible');
      await wait(TIMING.messageReveal + TIMING.messageStagger * 2);
      if (leaving) return;
      await wait(TIMING.messageWindow);
      if (leaving) return;
      await waitForTranslation();
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
