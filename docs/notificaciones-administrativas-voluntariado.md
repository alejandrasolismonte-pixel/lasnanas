# Correos de inscripción de voluntariado

## Alcance implementado

Esta etapa prepara dos notificaciones independientes e idempotentes:

- `admin_registration`: avisa al correo administrativo cuando PostgreSQL crea realmente una inscripción con plan.
- `volunteer_welcome`: da la bienvenida al correo de la voluntaria únicamente después de que Supabase Auth confirme ese correo.

El frontend no dispara ni autoriza correos. Un trigger `AFTER INSERT` sobre `membership_applications` crea el registro administrativo. La bienvenida se crea al insertar la inscripción si el correo ya está confirmado, o mediante el cambio real de `email_confirmed_at` si la confirmación ocurre después. La restricción `unique (application_id, notification_type)` impide duplicar cualquiera de los dos tipos.

La cola vive en el esquema `private`, tiene RLS activado y forzado y no concede privilegios a `anon` ni `authenticated`. Solamente las funciones servidoras autorizadas para `service_role` pueden reclamar o finalizar trabajos. No cambian Auth, HTML, CSS, planes, precios, pagos, membresías ni documentos.

## Contenido permitido

El aviso administrativo contiene nombre, apellido, correo, plan, periodicidad, moneda, fecha/hora, estado y enlace al panel. La bienvenida contiene nombre, bienvenida a Las Ñañas, plan, periodicidad, moneda, estado inicial, explicación de revisión y enlace HTTPS a Mi voluntariado.

Ninguno incluye archivos, PDF, credenciales, comprobantes, contraseñas, mensajes, notas administrativas, agenda, base de datos ni información territorial. Los documentos privados continúan sujetos a las políticas existentes: solo una membresía activa, creada después de un pago confirmado, puede leer documentos autorizados para su plan.

## Archivos

- `supabase/migrations/202609100003_volunteer_admin_notifications.sql`
- `supabase/functions/send-volunteer-registration-notifications/index.ts`
- `supabase/functions/send-volunteer-registration-notifications/index.test.ts`
- `supabase/functions/send-volunteer-registration-notifications/deno.json`
- `tests/volunteer-notifications-smoke.ps1`

## Secretos necesarios en Supabase

Configurar únicamente durante la etapa autorizada de despliegue:

- `BREVO_API_KEY`: clave transaccional de Brevo.
- `BREVO_SENDER_EMAIL`: remitente previamente validado en Brevo.
- `ADMIN_NOTIFICATION_EMAIL`: destinatario administrativo.
- `PUBLIC_SITE_URL`: origen HTTPS público usado para construir ambos enlaces.
- `NOTIFICATION_WEBHOOK_SECRET`: valor aleatorio para autenticar el webhook interno.

No guardar estos valores en HTML, JavaScript público, Render, GitHub ni archivos versionados. La función usa además las variables servidoras que Supabase proporciona para acceder a las RPC privadas. Ninguna clave administrativa llega al navegador.

## Instalación posterior — no ejecutar todavía

1. Revisar y aplicar `202609100003_volunteer_admin_notifications.sql` en el proyecto de pruebas, después de las migraciones `001` y `002`.
2. Configurar los cinco secretos anteriores en **Edge Functions → Secrets**. No copiarlos al `.env.local` del frontend.
3. Ejecutar las pruebas Deno localmente con `deno test supabase/functions/send-volunteer-registration-notifications/index.test.ts`.
4. Desplegar la función con verificación JWT desactivada únicamente porque ella aplica su propia autenticación constante mediante `x-notification-secret`.
5. Crear un Database Webhook `AFTER INSERT` para `private.volunteer_notification_queue` que invoque la función con `POST` y envíe `x-notification-secret`. El cuerpo no se considera fuente de datos: solo despierta al worker, que reclama la cola desde PostgreSQL.
6. Configurar además una invocación programada cada minuto para recuperar reintentos. Almacenar la credencial de invocación en Supabase Vault; nunca escribirla dentro de la migración.
7. Crear una inscripción de prueba con correo confirmado y verificar exactamente dos filas: una por tipo. Confirmar que cada una pase a `sent` con un `brevo_message_id` diferente.
8. Repetir el webhook y comprobar que no se envíen correos nuevos.
9. Probar un error transitorio de Brevo y confirmar el incremento de `attempts`, el error sanitizado y el uso del mismo `idempotency_key`.

## Reintentos y entrega exactamente una vez

La cola evita duplicados permanentes dentro de la aplicación. Brevo recibe el mismo UUID en todos los reintentos. Como Brevo documenta una ventana de idempotencia de 30 minutos, el worker limita el procesamiento automático a 25 minutos desde el primer intento. Un caso ambiguo fuera de esa ventana queda `failed` con `next_attempt_at = infinity` para revisión manual contra los registros de Brevo; no se reenvía a ciegas.

## Datos y decisiones pendientes

- URL HTTPS definitiva del sitio para `PUBLIC_SITE_URL`.
- Correos de remitente y administración validados.
- Creación de la clave Brevo y del secreto interno de webhook.
- Confirmar la política para múltiples inscripciones históricas de una misma cuenta. El esquema actual permite más de una; cada inscripción legítima genera sus propios dos registros idempotentes.

No se ha aplicado la migración, configurado secretos, desplegado la función ni creado el webhook o la tarea programada.
