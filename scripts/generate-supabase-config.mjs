/* Genera configuración pública para el navegador desde variables de Render.
   Nunca acepta ni escribe service_role, secret keys o contraseñas. */
import { writeFile } from 'node:fs/promises';

const url = process.env.SUPABASE_URL?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
if (!url || !publishableKey) throw new Error('Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY.');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) throw new Error('SUPABASE_URL debe ser la URL HTTPS completa del proyecto Supabase.');
if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) || /service_role|secret/i.test(publishableKey)) throw new Error('SUPABASE_PUBLISHABLE_KEY no tiene formato de clave publicable.');

const publicConfig = `/* Archivo generado: no editar ni versionar. */\nwindow.LAS_NANAS_CONFIG = Object.freeze(${JSON.stringify({ supabaseUrl: url, supabasePublishableKey: publishableKey })});\n`;
await writeFile(new URL('../js/supabase-config.js', import.meta.url), publicConfig, { encoding: 'utf8', mode: 0o600 });
console.log('Configuración pública de Supabase generada.');
