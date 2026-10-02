# Publicación estática segura en Render

El repositorio contiene archivos de trabajo que no deben estar en el directorio publicado. `scripts/build-public.mjs` genera `dist/` con una lista explícita de páginas y recursos del sitio. La carpeta `dist/` se ignora en Git.

## Servicio existente de Render

Antes del despliegue que incluya estos cambios, configurar **ambos** campos del sitio estático existente:

- **Build Command:** `node scripts/generate-supabase-config.mjs && node scripts/build-public.mjs`
- **Publish Directory:** `dist`

Conservar las variables `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` ya usadas por el build. El primer comando valida que la clave sea publicable; el segundo vuelve a validarla antes de copiarla. No poner claves de `service_role` en variables del navegador.

La configuración del servicio existente vive en el panel de Render. Agregar `render.yaml` al repositorio no cambiaría por sí solo ese servicio. Si el Build Command actual contiene más pasos que la generación de configuración, conservarlos y añadir `node scripts/build-public.mjs` al final. No cambiar únicamente uno de los dos campos: publicar la raíz seguiría exponiendo archivos de trabajo, y apuntar a `dist` sin construirla dejaría el sitio incompleto.

Se documentó anteriormente que el servicio despliega `main`. Verificar que siga siendo así: subir esta rama por sí solo no debería publicar producción. Configurar los dos campos **antes de desplegar estos cambios desde `main`**. El cambio de configuración puede iniciar un nuevo despliegue; revisar primero el estado del servicio y coordinar el momento de publicación.

## Verificación tras el despliegue

En **ambos** dominios (`https://lasnanas-construccion.onrender.com` y `https://xn--lasaas-ywab.cl`), comprobar HTTP 200 para `/`, `/robots.txt`, `/sitemap.xml`, `/pages/voluntariado.html`, `/pages/mi-voluntariado.html`, `/css/desarrollo.css`, `/js/supabase-config.js` y un recurso usado por la portada. Verificar que la configuración del navegador contenga únicamente URL y clave publicable, sin imprimir la clave en registros.

Comprobar HTTP 404 para `/docs/voluntariado-etapa-1.md`, `/supabase/config.toml`, `/scripts/generate-supabase-config.mjs`, `/tests/portal-security.test.cjs`, `/output/pdf/manual-y-diagrama-voluntariado.pdf`, `/.env.example` y `/pages/maqueta-flujo-inscripcion.html`. Repetir con una consulta nueva o sin caché. Si Render devuelve 404 y el dominio público 200, revisar la caché de Cloudflare. Si ambos siguen devolviendo 200, confirmar que el servicio realmente publica `dist` y que terminó el despliegue nuevo.

Los paneles y flujos de autenticación se mantienen en `dist` porque son parte del funcionamiento del sitio. Su protección sigue dependiendo de autenticación y controles de acceso reales, no de `robots.txt`.
