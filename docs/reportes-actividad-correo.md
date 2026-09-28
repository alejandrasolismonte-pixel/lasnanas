# Reportes de actividad por correo cada 100 visitas

Preparado y probado localmente el 28 de septiembre de 2026 para revisión y activación posterior. Esta nueva entrega **no está habilitada ni programada**. La captura y el dashboard existentes siguen funcionando. El destinatario fue confirmado en la conversación y se configurará exclusivamente como secreto servidor. Antes de aplicar la migración, desplegar el worker o activar envíos, solicitar la autorización de publicación indicada por el usuario.

La entrega utiliza el canal Brevo existente y un worker separado, `send-site-activity-reports`. No modifica los flujos de voluntariado, pagos, administración ni sus notificaciones. No integra WhatsApp.

## Cuándo se prepara un reporte

- Un reporte al alcanzar **100, 200, 300… visitas en cada día calendario de Chile**, zona `America/Santiago`. La cuenta empieza a las 00:00 de cada día y respeta sus cambios de horario.
- Una visita es una sesión de pestaña con hasta 30 minutos de inactividad. No equivale a un visitante único ni a una persona. Varias páginas dentro de una misma sesión no producen varias visitas en ese día.
- Una revisión cada cinco minutos detecta umbrales alcanzados. Si entre revisiones se pasa de 90 a 230 visitas, se preparan los reportes de 100 y 200. Los envíos se procesan en lotes limitados; no se repite un reporte en cada revisión.
- Cada par `(report_date, milestone)` tiene un único registro. Su snapshot conserva las métricas desde las 00:00 hasta `reached_at`, incluyendo la visita que alcanzó el umbral. Los reintentos conservan ese contenido.

Estos snapshots son independientes del resumen diario cerrado de las 23:00 o 24:00 y del botón «Generar resumen de ayer». Incluyen agregados de actividad, países y páginas, rendimiento y la última comprobación de salud disponible hasta el corte, con su hora. Una comprobación antigua no demuestra disponibilidad durante todo el intervalo.

La migración deja la configuración desactivada. Al pasar de `false` a `true`, registra `activated_at` y reinicia `scan_date` al día actual de Chile. Ese primer día se cuenta desde sus 00:00; no desde la hora de activación. Volver a configurar `true` cuando ya está activo conserva el cursor. No se envían reportes de días anteriores al día de activación. Si el worker se retrasa después de activarse, puede recuperar umbrales de días posteriores a esa fecha; el escaneo avanza hasta siete días por llamada y prepara como máximo veinte reportes por llamada.

## Seguridad y reintentos

Las tablas `site_activity_email_settings` y `site_activity_email_reports` tienen RLS y FORCE RLS, políticas SELECT para admin activo y ningún permiso directo para `PUBLIC`, `anon`, `authenticated` ni `service_role`. El acceso del worker pasa exclusivamente por estas cinco RPC, con autorización `service_role` y `SECURITY DEFINER` con `search_path` vacío:

| RPC | Uso |
| --- | --- |
| `configure_site_activity_email_reports(boolean)` | Activar o desactivar desde el backend autorizado. |
| `prepare_site_activity_email_reports(integer)` | Crear los snapshots pendientes; límite entre 1 y 20, predeterminado 20. |
| `claim_site_activity_email_reports(uuid, integer)` | Reclamar hasta cinco reportes; límite entre 1 y 5, predeterminado 5. |
| `mark_site_activity_email_report_sent(uuid, uuid, text)` | Guardar la aceptación de Brevo para el worker que tiene el lease. |
| `mark_site_activity_email_report_failed(uuid, uuid, text, boolean, boolean)` | Registrar un error sanitizado, indicando si es reintentable y si la aceptación es ambigua. |

El UUID del reporte es su `idempotencyKey` estable en Brevo. Se permiten como máximo tres intentos, con lease de cuatro minutos y espera de un minuto antes de poder reintentar. El cron de cinco minutos determina cuándo se hace la próxima invocación. La ventana automática termina catorce minutos después del primer intento: es un margen conservador frente al [TTL de quince minutos documentado para el envío individual de Brevo](https://developers.brevo.com/changelog/2021/11/10).

Los estados son `pending`, `processing`, `sent`, `failed` y `uncertain`. Cuando una aceptación es ambigua y ya no queda una ventana segura de reintento, el reporte queda `uncertain`; no se vuelve a enviar automáticamente después. Revisar los registros de Brevo antes de decidir cualquier recuperación manual. `sent` significa que Brevo aceptó el correo, no que llegó a la bandeja de entrada. No se promete entrega exactamente una vez fuera de la ventana del proveedor.

No se añaden nombres, correos de voluntarias, IP, campos de formularios, comprobantes, tokens ni identificadores de visitantes al mensaje. El destinatario y las credenciales viven exclusivamente en secretos servidores; no se guardan en estas tablas, Git ni el frontend. El endpoint sólo admite POST con `x-notification-secret` y cuerpo vacío o `{}`; rechaza llamadas de navegador y overrides de destinatario o métricas. No tiene modo HTTP de prueba.

## Configuración servidora necesaria

Configurar durante la etapa autorizada, en **Supabase → Edge Functions → Secrets**:

| Variable | Requisito |
| --- | --- |
| `SITE_ACTIVITY_REPORT_EMAIL` | Destinatario explícito y obligatorio. No usa `ADMIN_NOTIFICATION_EMAIL` ni otro correo como fallback. |
| `BREVO_API_KEY` | Reutiliza la clave transaccional del canal actual. |
| `BREVO_SENDER_EMAIL` | Reutiliza el remitente validado en Brevo. |
| `PUBLIC_SITE_URL` | Origen HTTPS del sitio, utilizado para el enlace al dashboard privado. Reutiliza la configuración existente. |
| `SITE_ACTIVITY_REPORT_WEBHOOK_SECRET` | Override opcional del secreto de invocación. |
| `NOTIFICATION_WEBHOOK_SECRET` | Se reutiliza si no hay override. Vault debe contener el mismo valor efectivo. |

La función usa también la configuración servidora de Supabase para las RPC; ninguna clave de servicio debe exponerse al navegador. Los reportes consumen la cuota de la misma cuenta Brevo que los correos existentes. Revisar el plan y la cuota disponible antes de activarlos; no se asume que este volumen sea gratuito. Mil visitas en un día pueden producir diez correos, además de las notificaciones actuales.

## Revisar y probar antes de activar

1. Revisar `supabase/migrations/202609280002_site_activity_email_reports.sql`, el worker y esta guía. Confirmar autorización para aplicar esa migración, desplegar **sólo** este worker y programar la entrega. La autorización anterior del dashboard y su captura no demuestra por sí sola que esta nueva entrega esté habilitada.
2. Probar primero en un proyecto Supabase aislado con las migraciones de actividad existentes. Aplicar allí la nueva migración y ejecutar `supabase/diagnostics/site-activity-email-security.sql`: RLS y FORCE RLS deben estar activos, los permisos de tablas en `false`, y las cinco RPC deben poder ejecutarse sólo como `service_role`.
3. Ejecutar `tests/site-activity-email-database.sql` únicamente en ese proyecto aislado, sin tráfico concurrente. Sus fixtures verifican permisos, umbrales, snapshots, propiedad de los trabajos reclamados y reintentos dentro de una transacción que termina en `ROLLBACK`. **No insertar fixtures ni generar visitas ficticias en producción.**
4. Confirmar una dirección de prueba explícita antes de cualquier correo real. Configurar `SITE_ACTIVITY_REPORT_EMAIL` con esa dirección en el proyecto de prueba. Probar la entrega con visitas controladas que alcancen el umbral en ese proyecto; comprobar un correo por umbral y que repetir la invocación no cree otro envío. No inventar un modo de prueba en producción ni utilizar el destinatario administrativo por defecto.
5. Para la activación autorizada, configurar el destinatario definitivo y los secretos servidores; desplegar `send-site-activity-reports` con `verify_jwt = false`, ya que valida su propio secreto obligatorio. Mantener la configuración de reportes desactivada hasta terminar las comprobaciones.
6. Habilitar `pg_cron` y `pg_net`, guardar las dos entradas indicadas abajo en Vault y crear la programación. Ejecutar de nuevo el diagnóstico: debe reconocer el job y su referencia a Vault, sin exponer el comando ni los valores.
7. Activar mediante una llamada **servidora** a `configure_site_activity_email_reports` con `{ "p_enabled": true }`. La interfaz de administración no activa ni envía correos. Verificar umbrales provenientes del tráfico real y la aceptación en Brevo; no bajar el umbral ni inyectar eventos para forzar un ensayo en producción.

Para detener la entrega, el backend autorizado configura `{ "p_enabled": false }`. Se puede desprogramar el job específico mediante `cron.unschedule`; esto no modifica los jobs ni el worker de notificaciones de voluntariado.

Comprobaciones locales del worker, sin enviar correos:

```powershell
deno check supabase/functions/send-site-activity-reports/index.ts
deno test supabase/functions/send-site-activity-reports/index.test.ts
deno run --no-config --no-lock --allow-read --allow-env tests/run-site-activity-email-database.ts
deno run --allow-env=TEMP,TMPDIR --allow-write scripts/preview-site-activity-email.ts
```

Resultado local: **29 pruebas del worker pasan**, incluido el chequeo de tipos. Las dos migraciones reales y los fixtures de seguridad, hitos, snapshots y reintentos también pasaron en PostgreSQL en memoria con PGlite 0.5.8. Este verificador se descarga únicamente a la caché de Deno; no se añade al sitio ni a las Edge Functions. La prueba SQL no tiene permiso de red y comprueba el `ROLLBACK`. No sustituye la comprobación de configuración y entrega del proveedor en producción.

El script de muestra genera HTML en el directorio temporal y muestra su ruta. Usa el renderizador real con cifras ficticias y una franja «MUESTRA LOCAL · DATOS FICTICIOS · NO ENVIADO». No consulta datos reales, no guarda el destinatario definitivo y no envía correo.

## Programación posterior a la autorización

Crear estas entradas desde la interfaz de **Supabase Vault**, sin pegar sus valores en archivos versionados ni en el comando del cron:

- `site_activity_report_project_url`: URL base del proyecto Supabase autorizado.
- `site_activity_report_webhook_secret`: el secreto efectivo del header `x-notification-secret`.

El SQL siguiente es una receta para la etapa autorizada, **no parte del diagnóstico ni una instrucción de ejecutarlo ahora**. El nombre del job debe ser único. La configuración inicial desactivada impide que las primeras invocaciones preparen o envíen reportes.

```sql
select cron.schedule(
  'site-activity-email-every-5-minutes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select rtrim(decrypted_secret, '/')
      from vault.decrypted_secrets
      where name = 'site_activity_report_project_url'
    ) || '/functions/v1/send-site-activity-reports',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'site_activity_report_webhook_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

La programación funciona sin navegador abierto. El intervalo de cinco minutos no depende del desfase UTC de Chile; el worker y PostgreSQL calculan los días en `America/Santiago`. Supabase documenta esta combinación de [Cron, `pg_net` y Vault para invocar Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

El diagnóstico consulta sólo permisos, RLS, funciones, políticas y metadatos del job. No ejecuta las RPC de preparación o envío, ni lee los valores de Vault, destinatarios, métricas, reportes o información de voluntarias.
