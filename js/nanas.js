document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.querySelector('[data-carousel]');
  const track = carousel?.querySelector('[data-carousel-track]');
  if (!carousel || !track) return;

  const originalSlides = Array.from(track.children);
  const prevButton = carousel.querySelector('[data-carousel-prev]');
  const nextButton = carousel.querySelector('[data-carousel-next]');
  const toggleButton = carousel.querySelector('[data-carousel-toggle]');
  const toggleIcon = carousel.querySelector('[data-carousel-toggle-icon]');
  const toggleLabel = carousel.querySelector('[data-carousel-toggle-label]');
  const status = carousel.querySelector('[data-carousel-status]');

  /* VELOCIDAD DEL MOVIMIENTO HACIA LA IZQUIERDA:
     Edita este número para cambiar la velocidad, expresada en píxeles por segundo. */
  const VELOCIDAD_HACIA_LA_IZQUIERDA = 30;

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
  let isPaused = false;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartPosition = 0;

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
  }

  // Deslizamiento lineal y constante: las fotografías avanzan visualmente hacia la izquierda.
  function animate(currentTime) {
    if (previousTime === undefined) previousTime = currentTime;
    const elapsedSeconds = Math.min((currentTime - previousTime) / 1000, 0.05);
    previousTime = currentTime;

    if (!isPaused && !isDragging) {
      position += VELOCIDAD_HACIA_LA_IZQUIERDA * elapsedSeconds;
      renderPosition();
    }

    window.requestAnimationFrame(animate);
  }

  function getSlideStep() {
    const firstSlide = originalSlides[0];
    const secondSlide = originalSlides[1];
    if (!firstSlide) return 0;
    return secondSlide
      ? secondSlide.offsetLeft - firstSlide.offsetLeft
      : firstSlide.getBoundingClientRect().width;
  }

  prevButton?.addEventListener('click', () => {
    position -= getSlideStep();
    renderPosition();
  });

  nextButton?.addEventListener('click', () => {
    position += getSlideStep();
    renderPosition();
  });

  toggleButton?.addEventListener('click', () => {
    isPaused = !isPaused;
    toggleButton.setAttribute('aria-pressed', String(isPaused));
    toggleButton.setAttribute('aria-label', isPaused
      ? 'Reanudar movimiento automático'
      : 'Pausar movimiento automático');
    if (toggleIcon) toggleIcon.textContent = isPaused ? '▶' : 'Ⅱ';
    if (toggleLabel) toggleLabel.textContent = isPaused ? 'Reanudar' : 'Pausar';
    if (status) status.textContent = isPaused
      ? 'Movimiento automático pausado.'
      : 'Movimiento automático reanudado.';
    previousTime = undefined;
  });

  track.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    isDragging = true;
    dragStartX = event.clientX;
    dragStartPosition = position;
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

  window.requestAnimationFrame(() => {
    position = getLoopWidth();
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
