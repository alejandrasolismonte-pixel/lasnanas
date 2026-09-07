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

  /* ============================================================
     LÓGICA DEL LIBRO 3D (Sección Quiénes Somos)
     ============================================================ */
  const leaves = document.querySelectorAll(".nanas-leaf");
  
  if (leaves.length > 0) {
    const N = leaves.length;
    // Limita el recorrido a la portada y cuatro aperturas para no girar hacia una página vacía.
    const lastView = N - 1;
    let cur = 0;
    let anim = false;
    
    const btnPrev = document.getElementById("book-prev");
    const btnNext = document.getElementById("book-next");
    const lblPg = document.getElementById("book-pg");

    // Sincroniza el contador y los botones con la nueva cantidad de vistas.
    function updateBook() {
      if(lblPg) lblPg.textContent = "Página " + (cur + 1) + " de " + N;
      if(btnPrev) btnPrev.disabled = cur === 0;
      if(btnNext) btnNext.disabled = cur >= lastView;
    }
    
    function turnPage(d) {
      if(anim) return;
      if(d > 0 && cur >= lastView) return;
      if(d < 0 && cur <= 0) return;
      
      anim = true;
      const idx = d > 0 ? cur : cur - 1;
      const leaf = leaves[idx];
      
      leaf.style.zIndex = d > 0 ? 99 : N + 10;
      
      if(d > 0) {
          leaf.classList.add("flipped"); 
      } else {
          leaf.classList.remove("flipped");
      }
      
      window.setTimeout(() => {
        leaf.style.zIndex = d > 0 ? idx + 1 : N - idx;
        cur += d;
        anim = false;
        updateBook();
      }, 1080);
    }
    
    // 1. Botones de abajo
    if(btnPrev) btnPrev.addEventListener('click', () => turnPage(-1));
    if(btnNext) btnNext.addEventListener('click', () => turnPage(1));
    
    // 2. Interacción al hacer clic/tocar las páginas
    leaves.forEach((leaf, idx) => {
      const front = leaf.querySelector('.nanas-face:not(.nanas-back)');
      const back = leaf.querySelector('.nanas-back');
      
      // Tocar página derecha -> Avanzar
      if (front) {
        front.style.cursor = 'pointer';
        front.addEventListener('click', (e) => {
          if (e.target.closest('a') || e.target.closest('button')) return;
          if (cur === idx) turnPage(1);
        });
      }
      
      // Tocar página izquierda -> Retroceder
      if (back) {
        back.style.cursor = 'pointer';
        back.addEventListener('click', (e) => {
          if (e.target.closest('a') || e.target.closest('button')) return;
          if (cur === idx + 1) turnPage(-1);
        });
      }
    });

    updateBook();
  }

  /* ============================================================
     INICIALIZACIÓN DE PARTÍCULAS
     ============================================================ */
  document.querySelectorAll('.particles-canvas').forEach((canvas) => createStarField(canvas));
});

/* ============================================================
   CARRUSEL 3D DE SERVICIOS
   Una sola fuente de datos genera tarjetas, puntos y modal.
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const WHATSAPP_NUMBER = ''; // Falta confirmar el número oficial, en formato internacional sin el signo +.
  const AUTOPLAY_DELAY = 4000; // Milisegundos entre cada cambio automático de tarjeta.
  const SERVICES_ASSET_BASE = window.location.pathname.replaceAll('\\', '/').includes('/pages/') ? '../assets' : 'assets';
  const services = [
    {
      id: 'desarrollo-web-territorial', categoria: 'Tecnología', titulo: 'Desarrollo web territorial',
      descripcion: 'Diseño y desarrollo de sitios web para emprendimientos rurales, organizaciones y proyectos con identidad territorial.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/diseño_web.png`, alt: 'Computador con un sitio web de identidad territorial en desarrollo',
      detalles: ['Diseño adaptable a celulares y computadores', 'Arquitectura de contenidos clara y accesible', 'Acompañamiento para publicar y administrar el sitio'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Desarrollo web territorial.'
    },
    {
      id: 'tecnologia-huerta', categoria: 'Tecnología', titulo: 'Tecnología aplicada a la huerta',
      descripcion: 'Soluciones tecnológicas sencillas para mejorar el riego, monitorear los cultivos y hacer más eficiente el trabajo en la huerta.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/servicios_iot.png`, alt: 'Sensores y tecnología de monitoreo instalados en una huerta',
      detalles: ['Diagnóstico de necesidades en terreno', 'Automatización básica de riego y monitoreo', 'Orientación para el uso y mantenimiento de los equipos'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Tecnología aplicada a la huerta.'
    },
    {
      id: 'chipeadora-terreno', categoria: 'Arriendo', titulo: 'Chipeadora en terreno',
      descripcion: 'Chipeado de restos vegetales y podas para producir material destinado al compostaje, senderos y cobertura protectora del suelo.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/chipeadora.png`, alt: 'Chipeadora procesando ramas y restos de poda en terreno',
      detalles: ['Coordinación del trabajo en terreno', 'Procesamiento de podas y restos vegetales', 'Orientación para aprovechar el material resultante'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Chipeadora en terreno.'
    },
    {
      id: 'motocultor', categoria: 'Arriendo', titulo: 'Motocultor',
      descripcion: 'Preparación responsable de terrenos y huertas para labores agrícolas de pequeña escala.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/motocultivador.png`, alt: 'Motocultor preparando suelo para una huerta de pequeña escala',
      detalles: ['Evaluación básica del área de trabajo', 'Preparación superficial y aireación del suelo', 'Coordinación de traslado y operación en terreno'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Motocultor.'
    },
    {
      id: 'diseno-agroecologico', categoria: 'Asesoría', titulo: 'Diseño agroecológico',
      descripcion: 'Planificación predial basada en agroecología y permacultura, incorporando captación de aguas lluvias, corredores biológicos y bosques comestibles.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/diseño_agroecologico.png`, alt: 'Plano de diseño agroecológico con cultivos, agua y corredores biológicos',
      detalles: ['Lectura inicial del predio y sus ciclos', 'Propuesta de zonificación y manejo del agua', 'Recomendaciones de biodiversidad y producción regenerativa'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Diseño agroecológico.'
    },
    {
      id: 'taller-agroecologia', categoria: 'Taller', titulo: 'Taller de agroecología',
      descripcion: 'Aprendizajes prácticos para cuidar el suelo, producir alimentos, elaborar compost y fortalecer sistemas agrícolas sustentables.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/taller_agroecologia.png`, alt: 'Grupo participando en un taller práctico de agroecología',
      detalles: ['Cuidado y recuperación del suelo', 'Producción de compost y abonos naturales', 'Prácticas de cultivo adaptadas al territorio'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Taller de agroecología.'
    },
    {
      id: 'taller-permacultura', categoria: 'Taller', titulo: 'Taller de permacultura',
      descripcion: 'Principios y herramientas para diseñar espacios resilientes, eficientes y conectados con su entorno.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/taller_permacultura.png`, alt: 'Participantes diseñando un espacio productivo con principios de permacultura',
      detalles: ['Principios éticos y de diseño', 'Lectura de patrones naturales y zonas', 'Ejercicio práctico aplicado a un espacio real'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Taller de permacultura.'
    },
    {
      id: 'lengua-cosmovision-mapuche', categoria: 'Taller', titulo: 'Lengua y cosmovisión mapuche',
      descripcion: 'Espacio de acercamiento al Mapuzugun y a la cosmovisión mapuche desde el respeto, la experiencia territorial y el aprendizaje colectivo.',
      imagen: `${SERVICES_ASSET_BASE}/img/carrusel_servicios/cosmovision_lengua_mapuche.png`, alt: 'Encuentro colectivo de aprendizaje sobre Mapuzugun y cosmovisión mapuche',
      detalles: ['Acercamiento respetuoso al Mapuzugun', 'Conceptos vinculados con territorio y comunidad', 'Aprendizaje colectivo desde experiencias situadas'],
      mensajeWhatsApp: 'Hola, quiero consultar por: Lengua y cosmovisión mapuche.'
    }
  ];

  const carousel = document.querySelector('[data-services-carousel]');
  if (!carousel) return;
  const stage = carousel.querySelector('[data-services-stage]');
  const cardsContainer = carousel.querySelector('[data-services-cards]');
  const dotsContainer = carousel.querySelector('[data-services-dots]');
  const liveRegion = carousel.querySelector('[data-services-live]');
  const previousButton = carousel.querySelector('[data-services-prev]');
  const nextButton = carousel.querySelector('[data-services-next]');
  const autoplayButton = carousel.querySelector('[data-services-autoplay]');
  const modal = document.querySelector('[data-services-modal]');
  const modalClose = modal?.querySelector('[data-services-modal-close]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hoverCapable = window.matchMedia('(hover: hover) and (pointer: fine)');
  let currentIndex = 0;
  let modalTrigger = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let autoplayTimer = null;
  let autoplayPausedByUser = false;

  // Crea el contenido visual y los selectores directamente desde el arreglo.
  cardsContainer.innerHTML = services.map((service, index) => `
    <article class="services-showcase__card" data-service-index="${index}" data-category="${service.categoria}" aria-label="${service.titulo}">
      <div class="services-showcase__media">
        <img src="${service.imagen}" alt="${service.alt}" width="900" height="1100" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async">
        <span class="services-showcase__badge">${service.categoria}</span>
      </div>
      <div class="services-showcase__content">
        <h3>${service.titulo}</h3><p>${service.descripcion}</p>
        <button class="services-showcase__detail" type="button" data-service-detail="${index}">Ver detalle <span aria-hidden="true">→</span></button>
      </div>
    </article>`).join('');
  dotsContainer.innerHTML = services.map((service, index) => `
    <button class="services-showcase__dot" type="button" data-service-dot="${index}" aria-label="Ir a ${service.titulo}"></button>`).join('');

  const cards = [...cardsContainer.querySelectorAll('.services-showcase__card')];
  const dots = [...dotsContainer.querySelectorAll('.services-showcase__dot')];

  // Mantiene visibles solo la tarjeta activa y sus dos vecinas, incluso al cerrar el ciclo.
  const showService = (requestedIndex, announce = true) => {
    currentIndex = (requestedIndex + services.length) % services.length;
    const previousIndex = (currentIndex - 1 + services.length) % services.length;
    const nextIndex = (currentIndex + 1) % services.length;
    cards.forEach((card, index) => {
      const isActive = index === currentIndex;
      const isPrevious = index === previousIndex;
      const isNext = index === nextIndex;
      card.classList.toggle('services-showcase__card--active', isActive);
      card.classList.toggle('services-showcase__card--previous', isPrevious);
      card.classList.toggle('services-showcase__card--next', isNext);
      card.classList.toggle('services-showcase__card--hidden', !isActive && !isPrevious && !isNext);
      card.setAttribute('aria-hidden', String(!isActive && !isPrevious && !isNext));
      card.setAttribute('role', isActive ? 'group' : (isPrevious || isNext ? 'button' : 'presentation'));
      card.tabIndex = isPrevious || isNext ? 0 : -1;
      card.querySelector('[data-service-detail]').tabIndex = isActive ? 0 : -1;
    });
    dots.forEach((dot, index) => dot.setAttribute('aria-current', String(index === currentIndex)));
    if (announce) liveRegion.textContent = `${services[currentIndex].titulo}. Tarjeta ${currentIndex + 1} de ${services.length}.`;
  };

  // Avanza según AUTOPLAY_DELAY y evita anuncios repetitivos durante el movimiento autónomo.
  const stopAutoplay = () => {
    window.clearInterval(autoplayTimer);
    autoplayTimer = null;
  };

  const startAutoplay = () => {
    stopAutoplay();
    const pausedByMouse = hoverCapable.matches && carousel.matches(':hover');
    const pausedByKeyboard = Boolean(carousel.querySelector(':focus-visible'));
    if (autoplayPausedByUser || reducedMotion.matches || document.hidden || modal?.open || pausedByMouse || pausedByKeyboard) return;
    autoplayTimer = window.setInterval(() => showService(currentIndex + 1, false), AUTOPLAY_DELAY);
  };

  const updateAutoplayControl = () => {
    if (!autoplayButton) return;
    const isPaused = autoplayPausedByUser || reducedMotion.matches;
    const label = reducedMotion.matches ? 'Movimiento automático desactivado' : (isPaused ? 'Reanudar movimiento automático' : 'Pausar movimiento automático');
    autoplayButton.querySelector('span').textContent = isPaused ? '▶' : 'Ⅱ';
    autoplayButton.setAttribute('aria-label', label);
    autoplayButton.title = label;
    autoplayButton.disabled = reducedMotion.matches;
  };

  const showServiceManually = (index) => {
    showService(index);
    startAutoplay();
  };

  previousButton.addEventListener('click', () => showServiceManually(currentIndex - 1));
  nextButton.addEventListener('click', () => showServiceManually(currentIndex + 1));
  dots.forEach((dot, index) => dot.addEventListener('click', () => showServiceManually(index)));

  // Las tarjetas laterales actúan como controles accesibles.
  cards.forEach((card, index) => {
    const activateSideCard = () => {
      if (card.classList.contains('services-showcase__card--previous') || card.classList.contains('services-showcase__card--next')) showServiceManually(index);
    };
    card.addEventListener('click', (event) => { if (!event.target.closest('[data-service-detail]')) activateSideCard(); });
    card.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-service-detail]')) {
        event.preventDefault(); activateSideCard();
      }
    });
  });

  // Teclado y gesto horizontal táctil sin bloquear el desplazamiento vertical.
  stage.addEventListener('keydown', (event) => {
    if (event.target.closest('button, a')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); showServiceManually(currentIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); showServiceManually(currentIndex + 1); }
  });
  stage.addEventListener('touchstart', (event) => {
    stopAutoplay();
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  }, { passive: true });
  stage.addEventListener('touchend', (event) => {
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY)) showService(currentIndex + (deltaX < 0 ? 1 : -1));
    startAutoplay();
  }, { passive: true });

  carousel.addEventListener('mouseenter', () => { if (hoverCapable.matches) stopAutoplay(); });
  carousel.addEventListener('mouseleave', startAutoplay);
  carousel.addEventListener('focusin', (event) => { if (event.target.matches(':focus-visible')) stopAutoplay(); });
  carousel.addEventListener('focusout', (event) => {
    if (!carousel.contains(event.relatedTarget)) startAutoplay();
  });
  autoplayButton?.addEventListener('click', () => {
    autoplayPausedByUser = !autoplayPausedByUser;
    updateAutoplayControl();
    if (autoplayPausedByUser) stopAutoplay(); else startAutoplay();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopAutoplay(); else startAutoplay();
  });
  reducedMotion.addEventListener('change', () => {
    updateAutoplayControl();
    startAutoplay();
  });

  // El diálogo reutiliza los datos y prepara el mensaje de WhatsApp.
  cardsContainer.addEventListener('click', (event) => {
    const detailButton = event.target.closest('[data-service-detail]');
    if (!detailButton || !modal) return;
    const service = services[Number(detailButton.dataset.serviceDetail)];
    modalTrigger = detailButton;
    modal.querySelector('[data-services-modal-category]').textContent = service.categoria;
    modal.querySelector('[data-services-modal-title]').textContent = service.titulo;
    modal.querySelector('[data-services-modal-description]').textContent = service.descripcion;
    modal.querySelector('[data-services-modal-details]').innerHTML = service.detalles.map((detail) => `<li>${detail}</li>`).join('');
    const whatsappLink = modal.querySelector('[data-services-whatsapp]');
    whatsappLink.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(service.mensajeWhatsApp)}`;
    whatsappLink.setAttribute('aria-label', `Consultar por WhatsApp sobre ${service.titulo}`);
    stopAutoplay();
    modal.showModal();
  });
  modalClose?.addEventListener('click', () => modal.close());
  modal?.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
  modal?.addEventListener('close', () => {
    modalTrigger?.focus();
    startAutoplay();
  });
  showService(0, false);
  updateAutoplayControl();
  startAutoplay();
});
