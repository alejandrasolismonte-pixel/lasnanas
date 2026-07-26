document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('floating-environment');
    const esMovil = window.innerWidth <= 600;

    /* ==========================================================================
       ELEMENTOS FLOTANTES (posiciones de escritorio, en % de pantalla)
       EDITAR AQUÍ:
       - Para cambiar una PALABRA: modifica "content" en un type:'text'.
       - Para cambiar un COLOR de ícono: modifica "color" ("R, G, B").
       - Para cambiar la POSICIÓN: modifica "x" (izquierda) e "y" (arriba), en %.
       ========================================================================== */
    const elementosDesktop = [
        { type: 'box',  x: 6,  y: 8,  color: "16, 185, 129", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 10a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3" /><path d="M12 14a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3" /><path d="M12 20l0 -10" />' }, // manos / comunidad
        { type: 'text', x: 27, y: 6,  content: "agroecología" },
        { type: 'text', x: 68, y: 6,  content: "voluntariado" },
        { type: 'box',  x: 91, y: 8,  color: "245, 158, 11", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><polyline points="5 12 3 12 12 3 21 12 19 12" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" /><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />' }, // casa
        { type: 'box',  x: 5,  y: 35, color: "139, 92, 246", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 21c-4 -1 -7 -6 -7 -12v-3h3c5 0 9 3 9 8" /><path d="M12 21c4 -1 7 -6 7 -12v-3h-3c-3 0 -6 1 -8 3" /><path d="M12 21v-8" />' }, // semilla
        { type: 'box',  x: 92, y: 35, color: "59, 130, 246", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M3 12h18" /><path d="M12 8l4 4" /><path d="M12 16l-4 -4" />' }, // cultrún
        { type: 'text', x: 5,  y: 63, content: "bioinsumos" },
        { type: 'text', x: 92, y: 63, content: "naturaleza" },
        { type: 'text', x: 8,  y: 91, content: "kvme mogen" },
        { type: 'box',  x: 27, y: 92, color: "20, 184, 166", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 22l0 -14" /><path d="M9 13l3 -5" /><path d="M15 13l-3 -5" /><path d="M12 6l-2 -3" /><path d="M12 6l2 -3" />' }, // araucaria
        { type: 'text', x: 46, y: 93, content: "tecnología rural" },
        { type: 'text', x: 73, y: 91, content: "neyen y neyen" },
        { type: 'box',  x: 90, y: 92, color: "234, 179, 8",  content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><line x1="3" y1="6" x2="3" y2="19" /><line x1="12" y1="6" x2="12" y2="19" /><line x1="21" y1="6" x2="21" y2="19" />' } // educación
    ];

    /* En teléfono el panel ocupa casi toda la pantalla, así que solo dejamos
       4 íconos chicos en las esquinas reales — nada de palabras (chocarían). */
    const elementosMovil = [
        { type: 'box', x: 5,  y: 4,  small: true, color: "16, 185, 129", content: elementosDesktop[0].content },
        { type: 'box', x: 82, y: 4,  small: true, color: "245, 158, 11", content: elementosDesktop[3].content },
        { type: 'box', x: 5,  y: 90, small: true, color: "20, 184, 166", content: elementosDesktop[9].content },
        { type: 'box', x: 82, y: 90, small: true, color: "234, 179, 8",  content: elementosDesktop[12].content }
    ];

    const elementos = esMovil ? elementosMovil : elementosDesktop;
    elementos.forEach(el => createFloatingElement(container, el));
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
        el.innerText = data.content;
    }

    // Posición puesta directo en el elemento: no depende de que ninguna
    // clase CSS externa coincida, así que no se puede "romper" al copiar.
    el.style.position = 'absolute';
    el.style.left = `${data.x}vw`;
    el.style.top = `${data.y}vh`;
    container.appendChild(el);

    /* ==========================================================================
       ANIMACIÓN DE MOVIMIENTO — EDITAR AQUÍ la velocidad:
       "duration" más bajo = se mueve más rápido.
       ========================================================================== */
    const moveX = (Math.random() - 0.5) * 4;
    const moveY = (Math.random() - 0.5) * 4;
    const duration = 12 + Math.random() * 8; // 12 a 20 segundos
    const delay = Math.random() * -15;

    el.animate([
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