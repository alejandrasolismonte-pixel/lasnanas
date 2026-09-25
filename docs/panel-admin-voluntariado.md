# Panel administrativo de voluntariado

## Acceso

Una sesión verificada con rol `admin` activo abre el panel de coordinación. El acceso desde Mi Ruka y desde las tarjetas de membresía dirige a la misma página. Las consultas y los cambios privados siguen sujetos a las políticas RLS y a las funciones de Supabase.

La migración `supabase/migrations/202609250001_volunteer_admin_workflow.sql` debe aplicarse al proyecto correcto antes de publicar el frontend. Crea `admin_list_membership_applications_v2()` con estado de pago y membresía vigente y conserva la lista anterior para los accesos existentes. También agrega la transición protegida de revisión, aclaración y rechazo, y habilita a un `admin` activo para leer agendas. El rol `coordination` sigue necesitando `agenda_access` para esa lectura. No volver a ejecutar migraciones anteriores a ciegas en un proyecto donde el esquema se aplicó manualmente.

## Categorías

| Pestaña | Condición |
| --- | --- |
| Pendientes | Solicitud enviada (`submitted`) sin membresía vigente. |
| En proceso | Borrador, revisión, aclaración solicitada o aprobación pendiente de activación. |
| Rechazadas | Solicitud rechazada sin membresía vigente. |
| Activas | Membresía activa dentro de su período de vigencia. |
| Retiradas | Solicitud retirada. |

La pestaña «Todas» incluye los cinco grupos. Una membresía vigente tiene prioridad sobre el estado histórico de la solicitud.

## Funciones

- Aclaraciones: mensaje visible para la voluntaria y cambio de estado en una sola transacción. El rechazo exige un motivo visible. Las notas internas se guardan por separado.
- Pagos: revisión del comprobante privado y confirmación bancaria con el flujo existente.
- Documentos: consulta y carga privada asociada a la solicitud; liberación condicionada por membresía activa.
- Actividades oficiales: creación, edición y archivo para una voluntaria concreta.
- Agendas permitidas: lectura de registros personales y oficiales por una cuenta autorizada.
- Pines: enlace al editor territorial existente.

Antes de publicar, verificar la migración en el proyecto destino y recorrer el panel con una cuenta admin activa y otra sin ese rol. Las pruebas estáticas del repositorio no sustituyen esa comprobación con sesiones reales.
