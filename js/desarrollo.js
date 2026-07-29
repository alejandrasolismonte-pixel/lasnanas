document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('[data-header]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-nav');
  const welcomeMessage = document.querySelector('.welcome-message');

  // Mostrar el mensaje de bienvenida "Mari mari..." animado
  window.setTimeout(() => welcomeMessage?.classList.add('is-visible'), 350);
  window.setTimeout(() => welcomeMessage?.classList.remove('is-visible'), 3350);

  // Header scroll state
  const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 16);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  // Menú móvil
  menuButton?.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    navigation.classList.toggle('is-open', !isOpen);
    document.body.classList.toggle('menu-open', !isOpen);
  });

  // Cerrar menú móvil al hacer clic en un enlace
  navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    navigation.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  }));

  // Animaciones Fade In al scrollear
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('is-visible'); });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

  // Mapa Interactivo
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

  // Tarjetas Giratorias
  document.querySelectorAll('.person-card').forEach((card) => card.addEventListener('click', () => {
    const flipped = card.classList.toggle('is-flipped');
    card.setAttribute('aria-pressed', String(flipped));
  }));

  // Lógica del Acordeón FAQ (Cerrar los otros al abrir uno)
  const detailsElements = document.querySelectorAll('.faq-list details');
  detailsElements.forEach((targetDetail) => {
    targetDetail.addEventListener('click', () => {
      detailsElements.forEach((detail) => {
        if (detail !== targetDetail) {
          detail.removeAttribute('open');
        }
      });
    });
  });

  // Filtros de Productos
  document.querySelectorAll('.product-filter').forEach((filter) => {
    filter.addEventListener('click', () => {
      document.querySelectorAll('.product-filter').forEach((button) => button.classList.toggle('is-active', button === filter));
      document.querySelectorAll('.product-card').forEach((card) => {
        card.classList.toggle('is-hidden', filter.dataset.productFilter !== 'all' && card.dataset.productCategory !== filter.dataset.productFilter);
      });
    });
  });

  // Canasta de Productos (Transferencia)
  const cart = [];
  const cartCount = document.querySelector('[data-cart-count]');
  const cartSummary = document.querySelector('[data-cart-summary]');
  const cartContact = document.querySelector('[data-cart-contact]');
  
  document.querySelectorAll('.add-to-cart').forEach((button) => button.addEventListener('click', () => {
    cart.push(button.dataset.product);
    
    // Verificamos que los elementos existan en la página actual
    if(cartCount) cartCount.textContent = cart.length;
    if(cartSummary) cartSummary.textContent = cart.length === 1 ? `${cart[0]} agregado.` : `${cart.length} productos agregados a tu canasta.`;
    
    if(cartContact) {
      cartContact.classList.remove('is-disabled');
      cartContact.href = `mailto:equipolasnanas.aiep@gmail.com?subject=${encodeURIComponent('Consulta de compra - Productos Las Ñañas')}&body=${encodeURIComponent(`Mari mari, me interesa coordinar la compra/transferencia de los siguientes productos:\n\n- ${cart.join('\n- ')}\n\nQuedo atento/a a la disponibilidad y datos de pago.`)}`;
    }
    
    button.textContent = 'Agregado ✓';
    window.setTimeout(() => { button.textContent = 'Agregar a canasta'; }, 1100);
  }));

  // Envío del Formulario Principal
  const form = document.querySelector('[data-contact-form]');
  const feedback = document.querySelector('[data-form-feedback]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = data.get('nombre');
    const body = `Nombre: ${name}\nPaís: ${data.get('pais')}\nCorreo: ${data.get('email')}\nWhatsApp: ${data.get('whatsapp') || 'No indicado'}\n\nMensaje:\n${data.get('mensaje')}`;
    feedback.textContent = 'Abriremos tu aplicación de correo para enviar el mensaje.';
    window.location.href = `mailto:alejandra.solis.monte@gmail.com?subject=${encodeURIComponent(`Contacto web - ${name}`)}&body=${encodeURIComponent(body)}`;
  });

  // Año footer
  const yearEl = document.querySelector('[data-current-year]');
  if(yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // Efecto de partículas (fondo de estrellas) - Territorio y Ecosistema
  function createStarField(canvas, { count = 120, color = '255,255,255', speed = 0.20 } = {}) {
    const ctx = canvas.getContext('2d');
    let width, height, dpr, stars = [];

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      width = canvas.parentElement.clientWidth;
      height = canvas.parentElement.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const createStars = () => {
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.4 + 0.4,
        vx: (Math.random() - 0.9) * speed,
        vy: (Math.random() - 0.) * speed,
        alpha: Math.random() * 0.5 + 0.3,
        twinkle: Math.random() * Math.PI * 2
      }));
    };

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      stars.forEach((star) => {
        star.x += star.vx;
        star.y += star.vy;
        star.twinkle += 0.02;

        if (star.x < 0) star.x = width;
        if (star.x > width) star.x = 0;
        if (star.y < 0) star.y = height;
        if (star.y > height) star.y = 0;

        const twinkleAlpha = Math.max(0, star.alpha + Math.sin(star.twinkle) * 0.2);
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${color}, ${twinkleAlpha})`;
        ctx.fill();
      });
      requestAnimationFrame(animate);
    };

    resize();
    createStars();
    window.addEventListener('resize', () => { resize(); createStars(); });
    animate();
  }

  document.querySelectorAll('.particles-canvas').forEach((canvas) => createStarField(canvas));
});