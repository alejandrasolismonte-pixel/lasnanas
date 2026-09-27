/* Compone la credencial con datos del perfil sobre la plantilla visual. */
(() => {
  const referenceWidth = 1586;
  const referenceHeight = 992;
  const imageCache = new Map();
  const planNames = { 'keyuwün': 'Keyuwün', 'kimün': 'Kimün', 'pülli': 'Pülli' };

  function loadImage(url, cache=false) {
    if (cache && imageCache.has(url)) return imageCache.get(url);
    const pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No se pudo cargar la imagen de la credencial.'));
      image.src = url;
    });
    if (!cache) return pending;
    const cached = pending.catch(error => { imageCache.delete(url); throw error; });
    imageCache.set(url, cached);
    return cached;
  }

  function drawPlaceholder(ctx) {
    ctx.fillStyle = '#ded6c8';
    ctx.beginPath(); ctx.arc(333, 501, 67, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(333, 694, 146, 120, 0, 0, Math.PI * 2); ctx.fill();
  }

  async function drawPhoto(ctx, url) {
    ctx.save();
    ctx.beginPath(); ctx.arc(333, 544, 181, 0, Math.PI * 2); ctx.clip();
    if (url) {
      try {
        const image = await loadImage(url);
        const side = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = (image.naturalWidth - side) / 2;
        const sourceY = (image.naturalHeight - side) / 2;
        ctx.drawImage(image, sourceX, sourceY, side, side, 152, 363, 362, 362);
      } catch (_) { drawPlaceholder(ctx); }
    } else drawPlaceholder(ctx);
    ctx.restore();
  }

  function wrapLine(ctx, words, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (ctx.measureText(line + character).width > maxWidth && line) {
          lines.push(line); line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawName(ctx, value) {
    const name = String(value || 'Voluntaria').trim().replace(/\s+/g, ' ');
    ctx.fillStyle = '#fff6e6';
    ctx.textAlign = 'left';
    for (let size = 94; size >= 52; size -= 2) {
      ctx.font = `bold ${size}px Georgia, serif`;
      if (ctx.measureText(name).width <= 725) {
        ctx.fillText(name, 595, 466);
        return;
      }
    }
    for (let size = 62; size >= 34; size -= 2) {
      ctx.font = `bold ${size}px Georgia, serif`;
      const lines = wrapLine(ctx, name.split(' '), 725);
      if (lines.length <= 2) {
        lines.forEach((line, index) => ctx.fillText(line, 595, lines.length === 1 ? 466 : 420 + index * 58));
        return;
      }
    }
    ctx.font = 'bold 34px Georgia, serif';
    const midpoint = Math.ceil(name.length / 2);
    ctx.fillText(name.slice(0, midpoint), 595, 420, 725);
    ctx.fillText(name.slice(midpoint), 595, 478, 725);
  }

  function drawFitted(ctx, text, x, baseline, maxWidth, maxSize, minSize, font, color) {
    ctx.fillStyle = color;
    let size = maxSize;
    do {
      ctx.font = `${font.replace('{size}', size)}`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    } while (size >= minSize);
    ctx.fillText(text, x, baseline, maxWidth);
  }

  async function renderToCanvas(canvas, { templateUrl, name, planId, expiresAt, status, photoUrl }) {
    const template = await loadImage(templateUrl, true);
    canvas.width = template.naturalWidth;
    canvas.height = template.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar la credencial.');
    ctx.scale(canvas.width / referenceWidth, canvas.height / referenceHeight);
    ctx.drawImage(template, 0, 0, referenceWidth, referenceHeight);
    await drawPhoto(ctx, photoUrl);
    drawName(ctx, name);
    const plan = planNames[planId] || (planId ? String(planId) : 'Por definir');
    drawFitted(ctx, plan, 752, 557, 420, 75, 43, 'bold {size}px Georgia, serif', '#f47820');
    let expiry = 'Por confirmar';
    if (expiresAt && !Number.isNaN(Date.parse(expiresAt))) {
      expiry = new Intl.DateTimeFormat('es-CL', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Santiago'
      }).format(new Date(expiresAt));
    }
    drawFitted(ctx, expiry, 737, 702, 575, 43, 30, 'bold {size}px system-ui, sans-serif', '#fff6e6');
    const statusText = status === 'active' ? 'Membresía activa' : status === 'expired' ? 'Membresía vencida' : 'En trámite';
    drawFitted(ctx, statusText, 232, 814, 305, 36, 27, '600 {size}px system-ui, sans-serif', '#fff6e6');
    return canvas;
  }

  globalThis.LasNanasCredential = { renderToCanvas };
})();
