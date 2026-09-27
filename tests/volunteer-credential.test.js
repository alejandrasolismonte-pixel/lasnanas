const assert = (condition, message) => { if (!condition) throw new Error(message); };
const assertEquals = (actual, expected) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} no coincide con ${JSON.stringify(expected)}`);

Deno.test('la credencial compone la fotografía y los datos de la membresía', async () => {
  const previousCredential = globalThis.LasNanasCredential;
  const previousImage = globalThis.Image;
  const calls = { texts: [], images: [] };
  class TestImage {
    naturalWidth = 1586;
    naturalHeight = 992;
    set src(value) {
      this.url = value;
      if (value === 'foto-guardada') { this.naturalWidth = 400; this.naturalHeight = 600; }
      queueMicrotask(() => this.onload());
    }
  }
  const context = {
    font: '',
    scale() {}, save() {}, restore() {}, beginPath() {}, arc() {}, clip() {}, ellipse() {}, fill() {},
    drawImage(image) { calls.images.push(image.url); },
    measureText(text) { return { width: text.length * (Number(this.font.match(/\d+/)?.[0]) || 40) * .55 }; },
    fillText(text) { calls.texts.push(text); }
  };
  const canvas = { getContext: () => context };
  try {
    globalThis.Image = TestImage;
    const source = await Deno.readTextFile(new URL('../js/volunteer-credential.js', import.meta.url));
    new Function(source)();
    await globalThis.LasNanasCredential.renderToCanvas(canvas, {
      templateUrl: 'plantilla', name: 'María Antonia', planId: 'pülli',
      expiresAt: '2026-10-27T03:00:00Z', status: 'active', photoUrl: 'foto-guardada'
    });
    assertEquals([canvas.width, canvas.height], [1586, 992]);
    assertEquals(calls.images, ['plantilla', 'foto-guardada']);
    for (const expected of ['María Antonia', 'Pülli', '27 de octubre de 2026', 'Membresía activa']) {
      assert(calls.texts.includes(expected), `Falta el dato dinámico: ${expected}`);
    }
  } finally {
    globalThis.LasNanasCredential = previousCredential;
    globalThis.Image = previousImage;
  }
});
