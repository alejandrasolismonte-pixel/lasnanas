/* Construye la carpeta que Render debe publicar. Todo archivo nuevo requiere
   una decisión explícita antes de entrar en el sitio público. */
import { cp, lstat, mkdir, readdir, readFile, rm } from 'node:fs/promises';
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

const allowedExtensions = new Map([
  ['assets', new Set(['.gif', '.jpeg', '.jpg', '.mp3', '.mp4', '.png', '.svg', '.webm', '.webp'])],
  ['css', new Set(['.css'])],
  ['js', new Set(['.js'])],
]);

async function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Archivo público inválido: ${relativePath}`);
  const target = path.join(output, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

async function copyDirectory(relativePath, extensions) {
  const source = path.join(root, relativePath);
  const stat = await lstat(source);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Directorio público inválido: ${relativePath}`);
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const child = path.join(relativePath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Enlace simbólico no permitido: ${child}`);
    if (entry.isDirectory()) {
      await copyDirectory(child, extensions);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      await copyFile(child);
    } else {
      throw new Error(`Archivo no previsto en carpeta pública: ${child}`);
    }
  }
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
for (const [directory, extensions] of allowedExtensions) await copyDirectory(directory, extensions);
console.log('dist listo: solo páginas y recursos públicos permitidos.');
