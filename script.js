document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('floating-environment');

    // Cada elemento tiene una posición fija en % del viewport (x, y),
    // ubicada en el PERÍMETRO de la pantalla para dejar libre la zona
    // central donde vive el panel de cristal (glass-panel).
    const elementos = [
        // --- Borde superior ---
        { type: 'box',  x: 6,  y: 8,  color: "16, 185, 129", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 10a6 6 0 0 0 -6 -6h-3v2a6 6 0 0 0 6 6h3" /><path d="M12 14a6 6 0 0 1 6 -6h3v1a6 6 0 0 1 -6 6h-3" /><path d="M12 20l0 -10" />' }, // manos / comunidad
        { type: 'text', x: 27, y: 6,  content: "agroecología" },
        { type: 'text', x: 68, y: 6,  content: "voluntariado" },
        { type: 'box',  x: 91, y: 8,  color: "245, 158, 11", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><polyline points="5 12 3 12 12 3 21 12 19 12" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" /><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />' }, // casa

        // --- Costados, franja superior ---
        { type: 'text', x: 5,  y: 35, content: "tecnología rural" },
        { type: 'box',  x: 92, y: 35, color: "59, 130, 246", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M3 12h18" /><path d="M12 8l4 4" /><path d="M12 16l-4 -4" />' }, // cultrún

        // --- Costados, franja inferior ---
        { type: 'text', x: 5,  y: 63, content: "bioinsumos" },
        { type: 'text', x: 92, y: 63, content: "naturaleza" },

        // --- Borde inferior ---
        { type: 'text', x: 10, y: 90, content: "kvme mogen" },
        { type: 'box',  x: 30, y: 91, color: "20, 184, 166", content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 22l0 -14" /><path d="M9 13l3 -5" /><path d="M15 13l-3 -5" /><path d="M12 6l-2 -3" /><path d="M12 6l2 -3" />' }, // araucaria
        { type: 'text', x: 66, y: 90, content: "neyen" },
        { type: 'box',  x: 90, y: 91, color: "234, 179, 8",  content: '<path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><path d="M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0" /><line x1="3" y1="6" x2="3" y2="19" /><line x1="12" y1="6" x2="12" y2="19" /><line x1="21" y1="6" x2="21" y2="19" />' } // educación
    ];

    elementos.forEach(el => createFloatingElement(container, el));
});

function createFloatingElement(container, data) {
    const el = document.createElement('div');

    if (data.type === 'box') {
        el.classList.add('floating-box');
        el.style.backgroundColor = `rgba(${data.color}, 0.14)`;
        el.style.border = `1px solid rgba(${data.color}, 0.4)`;
        el.style.boxShadow = `0 4px 24px rgba(${data.color}, 0.35), 0 0 30px rgba(${data.color}, 0.15)`;
        el.innerHTML = `<svg viewBox="0 0 24 24" stroke="rgb(${data.color})" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${data.content}</svg>`;
    } else if (data.type === 'text') {
        el.classList.add('floating-word');
        el.innerText = data.content;
    }

    // Pequeño jitter aleatorio para que no se vean perfectamente alineados
    const jitterX = (Math.random() - 0.5) * 2; // +-1vw
    const jitterY = (Math.random() - 0.5) * 2; // +-1vh

    el.style.left = `${data.x + jitterX}vw`;
    el.style.top = `${data.y + jitterY}vh`;
    container.appendChild(el);

    // Movimiento sutil dentro de su propia zona (siempre lejos del centro)
    const moveX = (Math.random() - 0.5) * 3; // vw
    const moveY = (Math.random() - 0.5) * 3; // vh

    const duration = 25 + Math.random() * 20; // 25 a 45 segundos
    const delay = Math.random() * -30;

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