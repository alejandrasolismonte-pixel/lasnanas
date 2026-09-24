(() => {
  const start = () => {
    const fire = document.querySelector('[data-scene="fire"]');
    const story = document.querySelector('[data-scene="story"]');
    const gate = document.querySelector('[data-scene="gate"]');
    const video = fire?.querySelector('video');
    const places = [...story.querySelectorAll('.cinema__places li')];
    const title = story.querySelector('.cinema__title');
    const subtitle = story.querySelector('.cinema__subtitle');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let leaving = false;

    const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const activate = (scene) => {
      for (const current of [fire, story, gate]) {
        const active = current === scene;
        current.classList.toggle('is-active', active);
        current.setAttribute('aria-hidden', String(!active));
      }
    };
    const enterSite = () => {
      if (!leaving) window.location.assign('desarrollo.html');
    };

    window.addEventListener('pagehide', () => {
      leaving = true;
      video?.pause();
    }, { once: true });

    if (reducedMotion.matches) {
      video?.pause();
      activate(story);
      places.forEach((place) => place.classList.add('is-revealed'));
      title.classList.add('is-visible');
      subtitle.classList.add('is-visible');
      window.setTimeout(enterSite, 1200);
      return;
    }

    const playAttempt = video?.play();
    playAttempt?.catch(() => {
      // La pantalla permanece oscura si el navegador bloquea la reproducción.
    });

    const playSequence = async () => {
      // Escena 1: tres segundos de video a pantalla completa, sin texto ni controles.
      await wait(3000);
      if (leaving) return;

      // Escena 2: el mismo componente de carga que usa el resto del sitio.
      window.LasNanasLoader?.show('Preparando el territorio…');
      activate(null);
      video?.pause();
      await wait(1800);
      if (leaving) return;
      activate(story);
      window.LasNanasLoader?.hide();

      // Escena 3: los territorios aparecen en orden y preceden al título.
      for (const place of places) {
        place.classList.add('is-revealed');
        await wait(570);
        if (leaving) return;
      }
      title.classList.add('is-visible');
      await wait(1500);
      if (leaving) return;
      subtitle.classList.add('is-visible');
      await wait(1700);
      if (leaving) return;

      // Escena 4: estrellas, línea central y apertura horizontal de la compuerta.
      activate(gate);
      await wait(650);
      if (leaving) return;
      gate.classList.add('has-seam');
      await wait(750);
      if (leaving) return;
      gate.classList.add('is-opening');
      await wait(1900);
      enterSite();
    };

    playSequence();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
