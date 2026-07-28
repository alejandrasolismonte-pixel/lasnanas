// Carrusel de Ñañas (página nanas.html)
document.addEventListener('DOMContentLoaded', () => {
  const track = document.querySelector('[data-carousel-track]');
  const prevButton = document.querySelector('[data-carousel-prev]');
  const nextButton = document.querySelector('[data-carousel-next]');
  if (!track) return;

  const scrollAmount = () => (track.querySelector('.carousel-slide')?.offsetWidth || 260) + 16;

  prevButton?.addEventListener('click', () => track.scrollBy({ left: -scrollAmount(), behavior: 'smooth' }));
  nextButton?.addEventListener('click', () => track.scrollBy({ left: scrollAmount(), behavior: 'smooth' }));
});