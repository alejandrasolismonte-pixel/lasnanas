/* Construye la carpeta que Render debe publicar. Los recursos del navegador
   se enumeran individualmente para que archivos antiguos o nuevos no entren
   en producción sin una revisión de sus dependencias. */
import { cp, lstat, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
if (path.dirname(output) !== root) throw new Error('Directorio de salida inesperado.');

const rootFiles = [
  'index.html',
  'desarrollo.html',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
];

const pageFiles = [
  'activar-gestion-nanas.html',
  'actualizar-contrasena.html',
  'auth-callback.html',
  'coordinacion-voluntariado.html',
  'gestion-nanas.html',
  'mi-voluntariado.html',
  'nanas.html',
  'politica-privacidad.html',
  'productos.html',
  'protocolo-acuerdos-voluntariado.html',
  'servicios.html',
  'voluntariado.html',
];

const cssFiles = [
  'cinematic-entry.css',
  'coordinacion-voluntariado.css',
  'desarrollo.css',
  'gestion-nanas.css',
  'loading-overlay.css',
  'mi-voluntariado.css',
  'monthly-story.css',
  'nanas.css',
  'public-backgrounds.css',
  'public-faq.css',
  'public-theme.css',
  'servicios.css',
  'site-activity-dashboard.css',
  'voluntariado-demo.css',
  'voluntariado.css',
  'whatsapp-floating.css',
];

const jsFiles = [
  'activar-gestion-nanas.js',
  'actualizar-contrasena.js',
  'auth-callback.js',
  'cinematic-entry.js',
  'coordinacion-voluntariado.js',
  'desarrollo.js',
  'gestion-nanas.js',
  'loading-overlay.js',
  'map-pins.js',
  'mi-voluntariado.js',
  'monthly-story.js',
  'motion-lifecycle.js',
  'nanas-map-editor.js',
  'nanas.js',
  'site-activity-dashboard.js',
  'site-activity.js',
  'star-field.js',
  'supabase-client.js',
  'supabase-config.js',
  'theme-init.js',
  'transfer-config.js',
  'transfer-payments.js',
  'voluntariado-demo.js',
  'voluntariado.js',
  'volunteer-credential.js',
  'whatsapp-floating.js',
];

const assetFiles = [
  'compuerta/las-nanas-compuerta-24-42.mp3',
  'icons/productos-still.png',
  'icons/productos-web.webp',
  'icons/service-card-icons.svg',
  'icons/servicios-still.png',
  'icons/servicios-web.webp',
  'icons/voluntariado-still.png',
  'icons/voluntariado-web.webp',
  'icons/volunteer-button-leaves.svg',
  'img/Alejandra-voluntaria.jpeg',
  'img/Ayla-voluntaria.jpeg',
  'img/Belen-voluntaria.jpeg',
  'img/Carlos-voluntaria.jpeg',
  'img/apple-touch-icon.png',
  'img/carrusel/cosecha-comunitaria-06-web.webp',
  'img/carrusel/encuentro-comunitario-01-web.webp',
  'img/carrusel/gallina-del-territorio-07-web.webp',
  'img/carrusel/paisaje-territorio-02-web.webp',
  'img/carrusel/trabajo-agricola-03-web.webp',
  'img/carrusel/trabajo-en-la-huerta-05-web.webp',
  'img/carrusel/vida-rural-animales-04-web.webp',
  // desarrollo.js construye estas ocho rutas al mostrar los servicios.
  'img/carrusel_servicios/chipeadora-web.webp',
  'img/carrusel_servicios/cosmovision_lengua_mapuche-web.webp',
  'img/carrusel_servicios/diseño_agroecologico-web.webp',
  'img/carrusel_servicios/diseño_web-web.webp',
  'img/carrusel_servicios/motocultivador-web.webp',
  'img/carrusel_servicios/servicios_iot-web.webp',
  'img/carrusel_servicios/taller_agroecologia-web.webp',
  'img/carrusel_servicios/taller_permacultura-web.webp',
  'img/favicon-32x32.png',
  'img/letreros/productos-web.webp',
  'img/letreros/servicios-web.webp',
  'img/letreros/voluntariado-web.webp',
  'img/libro-3d/despedida.webp',
  'img/libro-3d/somos0.webp',
  'img/libro-3d/somos1.webp',
  'img/libro-3d/somos2.webp',
  'img/libro-3d/somos3.webp',
  'img/logo-web.png',
  'img/logo.png',
  'img/machi.jpeg',
  'img/mapa-araucania-web.webp',
  'img/marcos/ventana-rustica-transparente-web.webp',
  'img/nanas-red-apoyo.png',
  'img/planes/keyuwun.svg',
  'img/planes/kimun.svg',
  'img/planes/pulli.svg',
  'img/porque/ciclos_luna.webp',
  'img/porque/conectividad.webp',
  'img/porque/conservacion.webp',
  'img/porque/ferias.webp',
  'img/porque/lahuen.webp',
  'img/porque/rotacion.webp',
  'img/post/post-1.jpeg',
  'img/prisci.jpeg',
  'img/share-las-nanas-1200x630.png',
  'img/sorteo/joya-artesanal-plata-web.png',
  'img/vivi.jpeg',
  'img/voluntariado/credencial-voluntariado-fondo.png',
  // La plantilla y la función de correo de Supabase usan esta URL pública.
  'img/voluntariado/nana-bienvenida.png',
  'img/voluntariado/nana-preguntas-inicio.webp',
  'img/voluntariado/nana-preguntas-web.webp',
  'videos/video-header-iphone.mp4',
  'videos/video-header-web.webm',
  'videos/video-mes.mp4',
];

async function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Archivo público inválido: ${relativePath}`);
  const target = path.join(output, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

async function validateBrowserConfig() {
  const source = path.join(root, 'js', 'supabase-config.js');
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Falta la configuración pública del navegador.');
  const text = await readFile(source, 'utf8');
  const match = text.match(/^\/\* Archivo generado: no editar ni versionar\. \*\/\r?\nwindow\.LAS_NANAS_CONFIG = Object\.freeze\((\{[^\r\n]+\})\);\r?\n?$/);
  if (!match) throw new Error('Formato inesperado de la configuración pública.');
  const config = JSON.parse(match[1]);
  if (Object.keys(config).sort().join(',') !== 'supabasePublishableKey,supabaseUrl' ||
      !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.supabaseUrl) ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)) {
    throw new Error('La configuración contiene valores no publicables.');
  }
}

await validateBrowserConfig();
try {
  const existing = await lstat(output);
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('dist no es un directorio generado seguro.');
  await rm(output, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(output);
for (const file of rootFiles) await copyFile(file);
for (const file of pageFiles) await copyFile(path.join('pages', file));
for (const file of cssFiles) await copyFile(path.join('css', file));
for (const file of jsFiles) await copyFile(path.join('js', file));
for (const file of assetFiles) await copyFile(path.join('assets', file));
console.log('dist listo: solo páginas y recursos públicos permitidos.');
