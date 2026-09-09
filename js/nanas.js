document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('[data-carousel]');
  const track = carousel?.querySelector('[data-carousel-track]');
  if (!carousel || !track) return;

  const originalSlides = Array.from(track.children);
  const dots = Array.from(carousel.querySelectorAll('.nn-carousel__dot'));
  const status = carousel.querySelector('[data-carousel-status]');

  /* VELOCIDAD DEL MOVIMIENTO HACIA LA IZQUIERDA:
     Edita este número para cambiar la velocidad, expresada en píxeles por segundo. */
  const VELOCIDAD_HACIA_LA_IZQUIERDA = 30;
  const PAUSA_CENTRAL_MS = 1000;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Dos copias permiten mantener el movimiento continuo sin un salto visible.
  for (let copyIndex = 0; copyIndex < 2; copyIndex += 1) {
    originalSlides.forEach(slide => {
      const clone = slide.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.removeAttribute('aria-label');
      clone.querySelectorAll('img').forEach(image => image.setAttribute('alt', ''));
      track.appendChild(clone);
    });
  }

  let position = 0;
  let previousTime;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartPosition = 0;
  let autoPauseUntil = 0;
  let activeIndex = -1;

  const getLoopWidth = () => track.scrollWidth / 3;

  function normalizePosition() {
    const loopWidth = getLoopWidth();
    if (!loopWidth) return;

    while (position >= loopWidth * 2) position -= loopWidth;
    while (position < loopWidth) position += loopWidth;
  }

  function renderPosition() {
    normalizePosition();
    track.scrollLeft = position;
    updateActiveIndicator();
  }

  // Marca el punto correspondiente a la fotografía más cercana al centro de la ventana.
  function updateActiveIndicator() {
    const viewportCenter = position + (track.clientWidth / 2);
    let closestIndex = 0;
    let closestDistance = Infinity;

    Array.from(track.children).forEach((slide, index) => {
      const slideCenter = slide.offsetLeft + (slide.offsetWidth / 2);
      const distance = Math.abs(slideCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index % originalSlides.length;
      }
    });

    if (closestIndex === activeIndex) return;
    activeIndex = closestIndex;
    dots.forEach((dot, index) => dot.classList.toggle('is-active', index === activeIndex));
    if (status) {
      status.textContent = `Fotografía ${activeIndex + 1} de ${originalSlides.length}.`;
    }
  }

  // Localiza el próximo centro sin alterar el tamaño, orden o separación de las tarjetas.
  function getNextCenteredPosition() {
    const viewportCenterOffset = track.clientWidth / 2;
    const slides = Array.from(track.children);

    for (const slide of slides) {
      const centeredPosition = slide.offsetLeft + (slide.offsetWidth / 2) - viewportCenterOffset;
      if (centeredPosition > position + 0.5) return centeredPosition;
    }

    return null;
  }

  // Conserva la velocidad lineal y pausa un segundo sólo al centrar una foto automáticamente.
  function animate(currentTime) {
    if (previousTime === undefined) previousTime = currentTime;
    const elapsedSeconds = Math.min((currentTime - previousTime) / 1000, 0.05);
    previousTime = currentTime;

    if (!isDragging && !reducedMotion.matches && currentTime >= autoPauseUntil) {
      const distance = VELOCIDAD_HACIA_LA_IZQUIERDA * elapsedSeconds;
      const nextCenteredPosition = getNextCenteredPosition();

      if (nextCenteredPosition !== null && position + distance >= nextCenteredPosition) {
        position = nextCenteredPosition;
        autoPauseUntil = currentTime + PAUSA_CENTRAL_MS;
      } else {
        position += distance;
      }
      renderPosition();
    }

    window.requestAnimationFrame(animate);
  }

  track.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartPosition = position;
    autoPauseUntil = 0;
    track.classList.add('is-dragging');
    track.setPointerCapture(event.pointerId);
  });

  track.addEventListener('pointermove', event => {
    if (!isDragging) return;
    position = dragStartPosition - (event.clientX - dragStartX);
    renderPosition();
  });

  function finishDrag(event) {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove('is-dragging');
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    previousTime = undefined;
  }

  track.addEventListener('pointerup', finishDrag);
  track.addEventListener('pointercancel', finishDrag);
  track.addEventListener('dragstart', event => event.preventDefault());

  // Los cambios de preferencia del sistema detienen o reanudan únicamente el avance automático.
  reducedMotion.addEventListener('change', () => {
    previousTime = undefined;
    autoPauseUntil = 0;
  });

  window.requestAnimationFrame(() => {
    // Elige la copia de la primera foto que queda centrada dentro del tramo infinito normalizado.
    const loopWidth = getLoopWidth();
    const firstSlideCopies = [0, originalSlides.length, originalSlides.length * 2]
      .map(index => track.children[index])
      .filter(Boolean);
    const centeredStart = firstSlideCopies
      .map(slide => slide.offsetLeft + (slide.offsetWidth / 2) - (track.clientWidth / 2))
      .find(candidate => candidate >= loopWidth && candidate < loopWidth * 2);
    position = centeredStart ?? loopWidth;
    autoPauseUntil = performance.now() + PAUSA_CENTRAL_MS;
    renderPosition();
    window.requestAnimationFrame(animate);
  });
});

// CORTINAS KIMÜN: abre una cartilla y cierra cualquier otra que estuviera abierta.
document.addEventListener('DOMContentLoaded', () => {
  const reciprocity = document.querySelector('[data-reciprocity]');
  const cards = reciprocity ? Array.from(reciprocity.querySelectorAll('.reciprocity-card')) : [];

  cards.forEach(card => {
    card.addEventListener('click', () => {
      const willOpen = card.getAttribute('aria-expanded') !== 'true';

      cards.forEach(item => {
        item.setAttribute('aria-expanded', 'false');
        item.setAttribute('aria-label', item.getAttribute('aria-label').replace('Volver al relato', 'Mostrar ilustración'));
      });

      card.setAttribute('aria-expanded', String(willOpen));
      card.setAttribute('aria-label', card.getAttribute('aria-label').replace(
        willOpen ? 'Mostrar ilustración' : 'Volver al relato',
        willOpen ? 'Volver al relato' : 'Mostrar ilustración'
      ));
    });
  });
});
