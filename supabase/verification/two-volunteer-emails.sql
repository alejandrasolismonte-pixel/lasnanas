-- Verificacion de solo lectura; no encola ni envia correos.
select
  not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'enqueue_welcome_after_email_confirmation' and not tgisinternal
  ) as confirmacion_sin_bienvenida_extra,
  pg_catalog.pg_get_functiondef('private.enqueue_application_notifications()'::regprocedure)
    not like '%''volunteer_welcome''%' as inscripcion_sin_correo_extra,
  pg_catalog.pg_get_functiondef('private.enqueue_payment_activation_notifications()'::regprocedure)
    not like '%''payment_confirmed''%' as activacion_sin_correo_de_pago_separado,
  pg_catalog.pg_get_functiondef('public.ensure_activation_notifications(uuid)'::regprocedure)
    not like '%''payment_confirmed''%' as reintento_sin_correo_de_pago_separado,
  not exists (
    select 1 from private.volunteer_notification_queue
    where notification_type in ('volunteer_welcome', 'payment_confirmed')
      and delivery_status <> 'sent' and attempts < 5
  ) as sin_correos_antiguos_pendientes,
  not has_function_privilege('anon', 'public.claim_volunteer_notifications(uuid,integer)', 'execute')
    as cola_protegida_de_acceso_anonimo,
  not has_function_privilege('authenticated', 'public.claim_volunteer_notifications(uuid,integer)', 'execute')
    as cola_protegida_de_acceso_directo_del_panel;
