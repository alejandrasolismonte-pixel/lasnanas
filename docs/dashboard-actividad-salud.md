# Dashboard privado de actividad y salud

El dashboard y la captura están activos en el sitio real. El usuario aplicó la migración y autorizó la publicación; se desplegó `collect-site-activity` y se comprobó el dashboard con una sesión administradora real. La captura empezó el 27 de septiembre de 2026 a las 23:21, hora de Chile. WhatsApp sigue sin integrar ni programar.

El 28 de septiembre el usuario cambió la estrategia: reportes por correo al alcanzar 100, 200, 300… visitas de cada día de Chile. La nueva cola y su worker están preparados y probados localmente; su publicación y activación siguen pendientes. Ver [reportes de actividad por correo](reportes-actividad-correo.md).

La comprobación de activación devolvió `ready = true`; las 17 comprobaciones HTTP pasaron, incluidas las respuestas 401 para consultas anónimas a la RPC administrativa y a la tabla de eventos. Se verificó que los archivos publicados corresponden al código local. El resumen del 27 de septiembre quedó guardado una sola vez y se comprobó su contenido; esto no implica que se haya enviado por WhatsApp.

## Dónde se abre

En el panel existente: **Mi Ruka → Coordinación → Actividad y salud**.

Ruta: `/pages/coordinacion-voluntariado.html?view=activity`.

La navegación y los datos permanecen ocultos hasta comprobar una sesión de Supabase Auth y `staff_roles.role = 'admin'` con `revoked_at IS NULL`. Las cuentas de coordinación, gestión de Ñañas y voluntariado no acceden a estas métricas.

## Revisar ahora, sin modificar Supabase

Desde la raíz del proyecto:

```powershell
python scripts/preview-site-activity.py
```

Abrir <http://127.0.0.1:8765/pages/coordinacion-voluntariado.html?view=activity>. El servidor escucha únicamente en `127.0.0.1`. Esta vista tiene una franja **REVISIÓN LOCAL · DATOS DE PRUEBA** y no consulta Supabase. Las cifras son ficticias y sirven para revisar diseño, filtros y resumen.

Probar Hoy, 7 días y 30 días; cambiar el ancho del navegador; abrir Resumen diario y generar el resumen. Cerrar el servidor con Ctrl+C cuando se termine la revisión. No se crea una página de demostración en el sitio real ni un modo para omitir su autenticación.

Las capturas de revisión están en `output/activity-dashboard/`. Contienen exclusivamente datos ficticios.

## Datos reales y definiciones

La captura propia comienza al habilitar la función y los scripts. No reconstruye visitas anteriores.

| Métrica | Fuente y definición |
| --- | --- |
| Visitas hoy / 7 / 30 días | Sesiones distintas con al menos una página pública vista en el intervalo. Una sesión corresponde a una pestaña y se renueva tras 30 minutos de inactividad. Los períodos son días calendario de Chile, incluyendo el día actual hasta la consulta. |
| Visitantes únicos | Identificadores anónimos de navegador distintos con páginas vistas. No son personas identificadas; cambiar navegador o borrar almacenamiento cambia el identificador. |
| Nuevos / recurrentes | Visitantes únicos cuya primera observación fue dentro / antes del intervalo. La suma coincide con visitantes únicos. |
| Países principales | Sesiones agrupadas por país cuando la infraestructura entrega el encabezado `cf-ipcountry`. Sin ese dato: “Sin determinar”. No se usa el idioma ni el país declarado en una cuenta, ni un proveedor GeoIP externo. |
| Páginas más visitadas | Número de páginas vistas, por ruta pública. Puede superar las visitas porque una sesión recorre varias páginas. |
| Visitas a Voluntariado | Sesiones que vieron `/pages/voluntariado.html`. |
| Registros iniciados | Visitantes distintos que interactuaron mediante un evento `input` con el formulario de registro durante el período. No incluye su contenido ni significa cuenta creada. |
| Solicitudes enviadas | Registros de `membership_applications.submitted_at` dentro del período, independientemente del estado posterior. Incluye el historial existente de solicitudes. |
| Online / Offline | Resultado puntual de una petición HTTP sin caché a `index.html`, desde el navegador del administrador. Incluye hora y latencia; no es monitoreo continuo ni garantiza disponibilidad desde otras redes. |
| Velocidad | Promedio de `Navigation Timing` de las páginas vistas y número de muestras. Se muestra “Sin datos” si no hubo mediciones compatibles. No se presenta como puntuación Lighthouse ni Core Web Vitals. |
| Última actualización | Hora del servidor de la consulta, presentada en `America/Santiago`. |

El dashboard se actualiza cada minuto mientras esa vista está abierta y la pestaña visible. Al ocultarla, cambiar de vista, cerrar sesión o perder autorización, se borran sus datos del DOM y se descartan respuestas tardías. Los valores y el resumen no se guardan en `localStorage` ni `sessionStorage`.

La captura respeta Do Not Track y Global Privacy Control. Guarda solamente UUID aleatorios, ruta pública permitida, tipo de evento, duración de carga y país disponible en infraestructura. No guarda IP, correo, nombres, campos de formularios, tokens, querystrings ni fragmentos. No instrumenta paneles privados, callbacks de Auth ni páginas de maqueta. Los fallos de medición no interrumpen ningún flujo.

## Resumen diario disponible y solicitud anterior de WhatsApp

`generate_daily_site_activity_summary(p_date, p_cutoff_hour)` genera o recupera un resumen en hora de Chile. Admite corte a las 23:00 o a las 24:00 y exige que el corte ya haya ocurrido. Sin parámetros, el panel pide ayer completo. Devuelve `{summary_date, generated_at, metrics, message}`; `metrics.period` contiene el intervalo y el corte. La fecha es clave primaria y un bloqueo transaccional evita duplicados simultáneos: volver a pedir la misma fecha recupera el mismo resumen, sin recalcular ni enviar mensajes. Si se solicita otro corte para una fecha ya resumida, prevalece el primer snapshot y su intervalo se conserva explícito en el mensaje.

La solicitud anterior era entrega por WhatsApp a las 23:00, zona `America/Santiago`; fue reemplazada por la estrategia de correo por hitos. El resumen admite el período del día en curso desde las 00:00 hasta las 23:00. **No existe envío ni programación por WhatsApp habilitada.** No se configura ese canal como parte de la nueva entrega por correo. El horario UTC no debe fijarse permanentemente porque Chile cambia su desfase.

El resumen usa las mismas consultas y definiciones del dashboard. Incluye métricas, países, páginas, muestras de carga y la última comprobación de salud anterior al cierre, con su fecha. Un estado antiguo no equivale a la disponibilidad de todo el día. La generación autoriza únicamente a admin activo o `service_role`; no permite consultas anónimas.

`prepare_site_activity_daily_report()` está disponible exclusivamente para `service_role` y prepara el último corte de las 23:00: hoy cuando ya son las 23:00 de Chile o más tarde; ayer antes de esa hora, para permitir reintentos después de medianoche. Esta función no programa tareas ni envía mensajes. La futura entrega debe respetar la fecha de inicio solicitada y no enviar reportes de días anteriores a la activación. El texto indica si la cobertura es parcial o aún no hay datos de captura; no presenta la ausencia de captura como ausencia de tráfico real.

Se recibió el número de destino en la conversación. El usuario indicó que no tiene un canal de WhatsApp Business/API configurado. El número no se añadió a código ni a archivos versionados. El repositorio actual solo contiene enlaces `wa.me` para comunicación manual y un worker de correos; esos enlaces no proporcionan envíos diarios automáticos.

## Habilitación para pruebas con datos reales

Para repetir estas pruebas, usar un proyecto Supabase de prueba con las migraciones existentes. El usuario ya aplicó la migración de actividad en su proyecto y autorizó la activación en producción. Los fixtures SQL completos deben ejecutarse solamente en un proyecto de prueba sin tráfico concurrente.

1. Aplicar `supabase/migrations/202609270004_private_site_activity.sql` al proyecto de prueba. No editar las migraciones anteriores.
2. Ejecutar `supabase/diagnostics/site-activity-security.sql`. Debe mostrar RLS y FORCE RLS activos, permisos directos de tablas en `false` y `matches_expected = true` para la matriz de RPC. Ejecutar también `tests/site-activity-database.sql` como `postgres` en el proyecto de prueba sin tráfico concurrente: comprueba autorizaciones, revocación, agregados, países por sesión, idempotencia y cuota de eventos; sus fixtures están encerrados en una transacción que termina en `ROLLBACK`.
3. Habilitar `collect-site-activity` en ese proyecto. Configurar `SITE_ACTIVITY_ALLOWED_ORIGINS` con los orígenes de prueba exactos separados por coma (por ejemplo `http://localhost:8080,http://127.0.0.1:8080`). Si se omite, utiliza `PUBLIC_SITE_URL`. Las claves de servicio quedan exclusivamente en el entorno de la Edge Function; nunca en el navegador.
4. Generar `js/supabase-config.js` con el script existente y la URL/clave **publicable** del proyecto de prueba. Servir el sitio mediante el servidor local habitual (para datos reales no usar `preview-site-activity.py`, que es ficticio).
5. Visitar Inicio, Voluntariado, Servicios, Productos y Ñañas. Interactuar con el formulario de registro para comprobar “registros iniciados”. Enviar una solicitud de prueba mediante el flujo habitual para comprobar `submitted_at`.
6. Entrar con una cuenta que ya tenga rol admin activo. Abrir la ruta del dashboard, cambiar períodos y actualizar. Las visitas aparecen desde la captura; la lista de países puede indicar “Sin determinar” si el runtime no entrega geografía.
7. Abrir la ruta sin sesión, con una voluntaria y con rol `coordination`: no deben mostrarse métricas. Intentar las RPC con estas cuentas también debe devolver acceso denegado; cambiar a mano HTML, URL o JavaScript no concede permisos de consulta.
8. Generar dos veces el resumen de ayer: misma fecha, mensaje y `generated_at`. Comprobar cierre de sesión y navegación: no quedan valores privados visibles. WhatsApp no debe recibir ningún mensaje.

La función de captura tiene `verify_jwt = false` porque recibe visitas anónimas. Es únicamente de escritura: exige origen autorizado, limita el tamaño y las rutas, valida UUID y duración, y utiliza una RPC que solo puede ejecutar `service_role`. Las consultas del dashboard y los resúmenes siguen protegidos por Auth y rol admin en el servidor. CORS no sustituye la autenticación de estas consultas.

## Pruebas ejecutables

Con Deno instalado, ejecutar desde la raíz:

```powershell
deno test --allow-read tests/site-activity-tracking.test.cjs tests/site-activity-dashboard.test.cjs tests/volunteer-admin-panel.test.cjs tests/auth-confirmation.test.cjs tests/portal-security.test.cjs tests/transfer-payments.test.cjs supabase/functions/collect-site-activity/index.test.ts
deno check supabase/functions/collect-site-activity/index.ts js/site-activity.js js/site-activity-dashboard.js js/coordinacion-voluntariado.js
```

Resultado local: **97 pruebas pasan**. Cubren captura, privacidad, permisos de interfaz, filtros, concurrencia de respuestas, logout, resumen y regresiones de registro/portal/pagos. La migración incluye verificaciones transaccionales de permisos. El smoke de PostgreSQL está preparado en `tests/site-activity-database.sql`; se reserva para un proyecto de prueba sin tráfico concurrente. En producción se comprobaron permisos, consultas administrativas reales, captura de visitas y almacenamiento de un único resumen diario.

## Archivos de esta implementación

Nuevos:

- `css/site-activity-dashboard.css`
- `js/site-activity-dashboard.js`
- `js/site-activity.js`
- `supabase/migrations/202609270004_private_site_activity.sql`
- `supabase/diagnostics/site-activity-security.sql`
- `supabase/diagnostics/site-activity-activation.sql`: comprobación de activación de solo lectura.
- `supabase/functions/collect-site-activity/index.ts`
- `supabase/functions/collect-site-activity/index.test.ts`
- `supabase/functions/collect-site-activity/deno.json`
- `scripts/preview-site-activity.py`
- `tests/site-activity-dashboard.test.cjs`
- `tests/site-activity-tracking.test.cjs`
- `tests/site-activity-database.sql`
- `docs/dashboard-actividad-salud.md`
- `output/activity-dashboard/desktop.png` y `mobile.png` (capturas con datos de prueba)

Modificados:

- `pages/coordinacion-voluntariado.html` y `js/coordinacion-voluntariado.js`: nueva vista y conexión con la autorización/navegación existentes.
- `index.html`, `pages/voluntariado.html`, `pages/servicios.html`, `pages/productos.html`, `pages/nanas.html`: carga del script pasivo de medición y configuración pública donde faltaba.
- `supabase/config.toml`: configuración de la función de captura.
- `tests/volunteer-admin-panel.test.cjs`, `tests/portal-security.test.cjs`, `tests/transfer-payments.test.cjs`: únicamente mocks de navegador actualizados para ejecutar las comprobaciones existentes, conservando sus assertions.
- `output/activity-dashboard/verify-live.py`: comprobación HTTP de publicación, captura y rechazo de consultas anónimas, sin crear visitas de prueba.

No se añadieron dependencias de producción. Los archivos de correos/credenciales que puedan aparecer modificados simultáneamente en el workspace pertenecen a otros cambios y no fueron editados para este dashboard.
