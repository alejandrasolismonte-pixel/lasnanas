document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('[data-header]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-nav');
  const welcomeMessage = document.querySelector('.welcome-message');

  window.setTimeout(() => welcomeMessage?.classList.add('is-visible'), 350);
  window.setTimeout(() => welcomeMessage?.classList.remove('is-visible'), 3350);

  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 16);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  menuButton?.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    navigation.classList.toggle('is-open', !isOpen);
    document.body.classList.toggle('menu-open', !isOpen);
  });

  navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  }));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

  const mapDetail = document.querySelector('.map-detail');
  const mapPins = document.querySelectorAll('.map-pin');
  document.querySelectorAll('.map-filter').forEach((filter) => {
    filter.addEventListener('click', () => {
      document.querySelectorAll('.map-filter').forEach((button) => button.classList.toggle('is-active', button === filter));
      mapPins.forEach((pin) => pin.classList.toggle('is-hidden', filter.dataset.filter !== 'all' && pin.dataset.category !== filter.dataset.filter));
    });
  });
  mapPins.forEach((pin) => pin.addEventListener('click', () => {
    mapPins.forEach((item) => item.classList.toggle('is-active', item === pin));
    mapDetail.innerHTML = `<p class="map-detail__eyebrow">${pin.dataset.category === 'nanas' ? 'Red Las Ñañas' : 'Territorio vivo'}</p><h3>${pin.dataset.title}</h3><p>${pin.dataset.text}</p>`;
  }));

  document.querySelectorAll('.person-card').forEach((card) => card.addEventListener('click', () => {
    const flipped = card.classList.toggle('is-flipped');
    card.setAttribute('aria-pressed', String(flipped));
  }));

  document.querySelectorAll('.product-filter').forEach((filter) => {
    filter.addEventListener('click', () => {
      document.querySelectorAll('.product-filter').forEach((button) => button.classList.toggle('is-active', button === filter));
      document.querySelectorAll('.product-card').forEach((card) => {
        card.classList.toggle('is-hidden', filter.dataset.productFilter !== 'all' && card.dataset.productCategory !== filter.dataset.productFilter);
      });
    });
  });

  const cart = [];
  const cartCount = document.querySelector('[data-cart-count]');
  const cartSummary = document.querySelector('[data-cart-summary]');
  const cartContact = document.querySelector('[data-cart-contact]');
  document.querySelectorAll('.add-to-cart').forEach((button) => button.addEventListener('click', () => {
    cart.push(button.dataset.product);
    cartCount.textContent = cart.length;
    cartSummary.textContent = cart.length === 1 ? `${cart[0]} agregado.` : `${cart.length} productos agregados a tu consulta.`;
    cartContact.classList.remove('is-disabled');
    cartContact.href = `mailto:equipolasnanas.aiep@gmail.com?subject=${encodeURIComponent('Consulta de productos - Las Ñañas')}&body=${encodeURIComponent(`Hola, me interesa consultar por: ${cart.join(', ')}.`)}`;
    button.textContent = 'Agregado ✓';
    window.setTimeout(() => { button.textContent = 'Agregar a canasta'; }, 1100);
  }));

  const form = document.querySelector('[data-contact-form]');
  const feedback = document.querySelector('[data-form-feedback]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = data.get('nombre');
    const body = `Nombre: ${name}\nPaís: ${data.get('pais')}\nCorreo: ${data.get('email')}\nWhatsApp: ${data.get('whatsapp') || 'No indicado'}\n\nMensaje:\n${data.get('mensaje')}`;
    feedback.textContent = 'Abriremos tu aplicación de correo para enviar el mensaje.';
    window.location.href = `mailto:equipolasnanas.aiep@gmail.com?subject=${encodeURIComponent(`Contacto web - ${name}`)}&body=${encodeURIComponent(body)}`;
  });

  document.querySelector('[data-current-year]').textContent = new Date().getFullYear();
});
