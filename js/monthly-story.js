(() => {
  'use strict';

  // Actualiza este objeto para cada historia o invitación mensual. El video debe durar 120 segundos o menos.
  // Al publicar un cambio, incrementa la versión de js/monthly-story.js en index.html para renovar la caché.
  const monthlyFeature = {
    kind: 'Video de muestra',
    month: '',
    territory: '',
    title: 'El fuego de bienvenida',
    description: 'Cada mes, una Ñaña compartirá una historia, un saber o una invitación desde su territorio,',
    src: 'assets/videos/video-header.mp4',
    poster: 'assets/img/carrusel/paisaje-territorio-02-web.webp',
    captionsSrc: '',
    actionLabel: '',
    actionUrl: ''
  };

  const story = document.querySelector('[data-monthly-story]');
  if (!story) return;

  const title = story.querySelector('[data-monthly-story-title]');
  const description = story.querySelector('[data-monthly-story-description]');
  const meta = story.querySelector('[data-monthly-story-meta]');
  const action = story.querySelector('[data-monthly-story-action]');
  const placeholder = story.querySelector('[data-monthly-story-placeholder]');
  const video = story.querySelector('[data-monthly-story-video]');
  if (!title || !description || !meta || !placeholder || !video) return;

  const showPlaceholder = () => {
    video.pause();
    video.hidden = true;
    placeholder.hidden = false;
    title.textContent = 'El fuego de bienvenida';
    description.textContent = 'Cada mes, una Ñaña compartirá una historia, un saber o una invitación desde su territorio,';
    meta.textContent = 'Primer video próximamente · Hasta 2 minutos';
    if (action) action.hidden = true;
  };

  if (!monthlyFeature.src) {
    showPlaceholder();
    return;
  }

  title.textContent = monthlyFeature.title;
  description.textContent = monthlyFeature.description;
  video.setAttribute('aria-label', monthlyFeature.title);
  if (monthlyFeature.poster) video.poster = monthlyFeature.poster;
  placeholder.hidden = true;
  video.hidden = false;
  if (monthlyFeature.captionsSrc) {
    const captions = document.createElement('track');
    captions.kind = 'captions';
    captions.src = monthlyFeature.captionsSrc;
    captions.srclang = 'es';
    captions.label = 'Español';
    video.appendChild(captions);
  }

  video.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 120) {
      console.warn('El video mensual debe durar como máximo 2 minutos.');
      showPlaceholder();
      video.removeAttribute('src');
      video.load();
      return;
    }

    const totalSeconds = Math.ceil(video.duration);
    const duration = `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
    meta.textContent = [monthlyFeature.kind, monthlyFeature.month, monthlyFeature.territory, duration]
      .filter(Boolean).join(' · ');
    if (action && monthlyFeature.actionLabel && monthlyFeature.actionUrl) {
      action.textContent = monthlyFeature.actionLabel;
      action.href = monthlyFeature.actionUrl;
      action.hidden = false;
    }
  }, { once: true });

  video.addEventListener('error', () => {
    showPlaceholder();
  }, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) video.pause();
    }, { threshold: .1 });
    observer.observe(story);
  }

  video.preload = 'metadata';
  video.src = monthlyFeature.src;
})();
