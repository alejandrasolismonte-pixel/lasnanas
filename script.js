document.addEventListener('DOMContentLoaded', () => {
    const entryButton = document.querySelector('[data-kupage]');
    let isEntering = false;

    entryButton?.addEventListener('click', event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        event.preventDefault();
        if (isEntering) return;

        isEntering = true;
        entryButton.setAttribute('aria-disabled', 'true');
        window.LasNanasLoader?.show('Ingresando al sitio');

        window.setTimeout(() => {
            window.location.assign(entryButton.href);
        }, 2000);
    });

    const container = document.getElementById('floating-environment');
    const esMovil = window.innerWidth <= 900;

    /* ==========================================================================
       ELEMENTOS FLOTANTES (posiciones de escritorio, en % de pantalla)
       EDITAR AQUÍ:
       - Para cambiar una PALABRA: modifica "content" en un type:'text'.
       - Para cambiar un COLOR de ícono: modifica "color" ("R, G, B").
       - Para cambiar la POSICIÓN: modifica "x" (izquierda) e "y" (arriba), en %.
       ========================================================================== */
    const elementosDesktop = [
        { type: 'box',  x: 10, y: 18, color: "234, 88, 12", content: '<path d="M12 2l8 10-8 10-8-10 8-10z"/><path d="M12 7l4 5-4 5-4-5 4-5z"/><path d="M4 7H1v3M20 7h3v3M4 17H1v-3M20 17h3v-3"/>' }, // geometría inspirada en tejido mapuche
        { type: 'text', x: 7,  y: 10, content: "agroecología" },
        { type: 'box',  x: 84, y: 20, color: "121, 198, 197", content: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="16" r="1.2"/>' }, // kultrún
        { type: 'text', x: 82, y: 33, content: "itrofill mogen" },
        { type: 'text', x: 7,  y: 41, content: "lahuen" },
        { type: 'box',  x: 10, y: 52, color: "52, 211, 153", content: '<path d="M12 21V10"/><path d="M12 13C7 13 4 10 4 5c5 0 8 2 8 6"/><path d="M12 16c5 0 8-3 8-8-5 0-8 2-8 6"/><circle cx="5" cy="18" r="1.5"/><circle cx="19" cy="20" r="1.5"/>' }, // lawen y semillas
        { type: 'box',  x: 84, y: 52, color: "234, 88, 12", content: '<path d="M4 12l3-5h10l3 5M6 11v9h12v-9M9 20v-6h6v6"/><path d="M3 12h18M8 7l4-4 4 4"/>' }, // ruka
        { type: 'text', x: 82, y: 68, content: "soberania alimentaria" },
        { type: 'text', x: 7,  y: 71, content: "nutram" },
        { type: 'box',  x: 10, y: 81, color: "121, 198, 197", content: '<path d="M12 22V7M8 22h8M7 15l5-8 5 8M8.5 11L12 4l3.5 7M10 7l2-5 2 5"/>' }, // araucaria
        { type: 'box',  x: 84, y: 82, color: "52, 211, 153", content: '<path d="M3 14c2-2 4-2 6 0l3 3 3-3c2-2 4-2 6 0"/><path d="M3 14l-2 2 5 5h5l2-2M21 14l2 2-5 5h-5"/><path d="M9 8h6M12 5v6"/>' } // intercambio de saberes
    ];

    /* En teléfono el panel ocupa casi toda la pantalla, así que solo usamos
       las franjas libres de arriba y abajo: 4 íconos chicos en las esquinas
       + 4 palabras chicas entre medio de esos íconos. */
    const elementosMovil = [
        { type: 'box', x: 5,  y: 15, small: true, color: "234, 88, 12", content: elementosDesktop[0].content },
        { type: 'box', x: 82, y: 15, small: true, color: "121, 198, 197", content: elementosDesktop[2].content },
        { type: 'box', x: 5,  y: 88, small: true, color: "52, 211, 153", content: elementosDesktop[4].content },
        { type: 'box', x: 82, y: 88, small: true, color: "234, 88, 12", content: elementosDesktop[5].content }
    ];

    const elementos = esMovil ? elementosMovil : elementosDesktop;
    const floatingAnimations = elementos.map(el => createFloatingElement(container, el));
    const syncLandingAnimations = () => {
        document.documentElement.classList.toggle('is-document-hidden', document.hidden);
        floatingAnimations.forEach(animation => document.hidden ? animation.pause() : animation.play());
    };
    if (window.MotionLifecycle) {
        window.MotionLifecycle.register(container, {
            start: () => floatingAnimations.forEach(animation => animation.play()),
            stop: () => floatingAnimations.forEach(animation => animation.pause())
        });
    } else {
        document.addEventListener('visibilitychange', syncLandingAnimations);
        syncLandingAnimations();
    }
});

function createFloatingElement(container, data) {
    const el = document.createElement('div');

    if (data.type === 'box') {
        el.classList.add('floating-box');
        if (data.small) el.classList.add('floating-box--sm');
        el.style.backgroundColor = `rgba(${data.color}, 0.14)`;
        el.style.border = `1px solid rgba(${data.color}, 0.4)`;
        el.style.boxShadow = `0 4px 24px rgba(${data.color}, 0.35), 0 0 30px rgba(${data.color}, 0.15)`;
        el.innerHTML = `<svg viewBox="0 0 24 24" stroke="rgb(${data.color})" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${data.content}</svg>`;
    } else if (data.type === 'text') {
        el.classList.add('floating-word');
        if (data.small) el.classList.add('floating-word--sm');
        el.innerText = data.content;
    }

    // Posición puesta directo en el elemento: no depende de que ninguna
    // clase CSS externa coincida, así que no se puede "romper" al copiar.
    el.style.position = 'absolute';
    el.style.left = `${data.x}%`;
    el.style.top = `${data.y}vh`;
    container.appendChild(el);

    /* ==========================================================================
       ANIMACIÓN DE MOVIMIENTO — EDITAR AQUÍ la velocidad:
       "duration" más bajo = se mueve más rápido.
       ========================================================================== */
    const moveX = (Math.random() - 0.5) * 6;
    const moveY = (Math.random() - 0.5) * 6;
    const duration = 7 + Math.random() * 6; // 7 a 13 segundos (más rápido)
    const delay = Math.random() * -10;

    return el.animate([
        { transform: `translate(0, 0)` },
        { transform: `translate(${moveX}vw, ${moveY}vh)` }
    ], {
        duration: duration * 1000,
        delay: delay * 1000,
        iterations: Infinity,
        direction: 'alternate',
        easing: 'ease-in-out'
    });
}
