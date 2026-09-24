# Transferencia manual: preparación y bloqueos

## Estado operativo verificado

La versión v20 (`5f216a4`) está publicada en Render. La reserva remota detectó un bloqueo real: el ejecutor no tiene `USAGE` en el esquema administrado `auth`, aunque la migración original intentaba concederlo. Se aplicó `202609230001_transfer_receipt_identity.sql`: las dos RPC y sus siete políticas usan una función sin privilegios elevados con la misma expresión de identidad que `auth.uid()`. Se conservan FORCE RLS, el propietario NOBYPASSRLS y las restricciones de carga y lectura.

La prueba `transfer-reservation-rollback.sql` pasó en Supabase: reserva autenticada, reintento idempotente, rechazo al finalizar sin archivo, ausencia de pago automático y denegación de lectura/finalización ajena. La transacción se revirtió íntegramente. Pasaron además las 31 pruebas Node y las 9 comprobaciones administrativas. No se realizó una transferencia bancaria ni una carga binaria autenticada real; esta validación no certifica esos pasos.

Las secciones siguientes conservan el historial previo. No volver a aplicar la migración inicial de comprobantes sobre el proyecto existente.

**Actualización tras inspección remota:** el 23 de septiembre se observó el bucket `transfer-receipts` ya creado en Supabase. No se acreditó todavía la correspondencia de funciones, roles y políticas con la migración completa. Las afirmaciones históricas de migración pendiente que siguen abajo no justifican volver a ejecutarla. Consultar `docs/primera-prueba-real.md` para el estado observado y los pasos actuales.

## Revisión del 23 de septiembre de 2026

El código local más reciente contiene `enabled:true` en `js/transfer-config.js`, con una nota de autorización de transferencia nacional y pruebas que exigen esa configuración. Se conserva ese cambio previo. La descripción de `enabled:false` más abajo corresponde al estado anterior; la habilitación local no acredita que la migración esté desplegada ni que Storage haya superado las pruebas reales. Las transferencias internacionales siguen bloqueadas.

Se añadió `supabase/diagnostics/transfer-receipts-readonly.sql` para inspeccionar el bucket, el rol ejecutor y sus membresías directas e indirectas, los propietarios y permisos de las RPC, FORCE RLS, las políticas y los privilegios por columna. El diagnóstico general también incluye el bucket y el ejecutor de comprobantes. Ambos archivos son de solo lectura; no se ejecutaron contra Supabase en esta revisión.

El siguiente paso remoto continúa siendo verificar el esquema del proyecto de desarrollo y resolver la autorización pendiente de la migración antes de la prueba binaria descrita abajo. Se mantiene la instrucción registrada de no aplicar todavía la migración.

Validación repetida en esta revisión: 31 pruebas de Node superadas (18 de transferencias y 13 del portal), más 9 comprobaciones estáticas del panel administrativo. Los diagnósticos SQL nuevos no se ejecutaron; estos resultados no validan permisos ni cargas en el servicio remoto.

La interfaz reserva, sube al bucket privado `transfer-receipts` con `upsert:false` y finaliza mediante `finalize_transfer_receipt_upload`. Solo una respuesta del servidor con `received_at` permite presentar la recepción. Los pagos confirmados se consultan en `payments`; un comprobante recibido continúa pendiente de verificación bancaria.

Administración descarga mediante la API autenticada de Storage, revisa el archivo y debe declarar que verificó importe, moneda y referencia en el banco antes de invocar `admin_confirm_transfer`. La RPC existente vuelve a comprobar el rol admin vigente. El checkbox es una declaración humana, no una integración bancaria ni una nueva restricción de la RPC: el servidor actual no exige ese checkbox ni un comprobante para confirmar. No se modificó esa función.

## Configuración pendiente

`js/transfer-config.js` conserva `enabled:false`. Titular Chakrasur, RUT 77.311.825-6, Banco Estado, cuenta vista/chequera electrónica y cuenta 725-7-025245-4 fueron proporcionados por la usuaria. `bank.referenceInstructions` indica escribir el código de solicitud en el comentario de la transferencia. Se muestra el UUID completo de la solicitud tanto en el portal como en el detalle y la confirmación administrativos; no se ha confirmado un límite bancario que requiera acortarlo. La referencia bancaria de la operación se registra por separado. El importe y la moneda cotizados se conservan exactamente como están en la solicitud; no se convierten en el navegador.

La voluntaria puede elegir CLP, USD o EUR como moneda de origen, independientemente de la moneda del precio. Esta selección orienta las instrucciones, no cambia el pago ni se persiste como moneda cotizada. El tipo nacional/internacional se elige por separado: no se deduce de la moneda. Para transferencias internacionales, `international.confirmed` debe ser `true` y `international.instructions` debe contener las instrucciones bancarias completas y verificadas (incluidos los identificadores bancarios y datos de recepción/intermediación que el banco requiera). Hasta entonces no se muestran datos nacionales como alternativa internacional ni se permite continuar por esa vía.

Administración debe verificar el importe y la moneda efectivamente abonados y su correspondencia con la solicitud, incluidas conversiones y comisiones bancarias. No se inventan tipos de cambio y no se confirma un abono con diferencias pendientes. La RPC conserva el importe/moneda de la solicitud: no registra un importe alternativo de liquidación.

## Prueba real de Storage bloqueada

Proyecto autorizado: **lasnanas-voluntariado-dev**, referencia **xnntqjaztwcqljgivkds**. La usuaria confirmó que la migración de comprobantes no está aplicada y ordenó no ejecutarla todavía. No se repitió PGlite ni se hicieron escrituras remotas.

Antes de la prueba binaria, una persona autorizada debe:

1. Confirmar en ese proyecto la correspondencia del esquema con las migraciones 001–005. Las consultas anteriores de metadatos no acreditan el historial.
2. Con autorización de despliegue de esquema, ejecutar **el contenido completo de `supabase/migrations/202609220001_transfer_receipts.sql`**, sin cambios, en el SQL Editor de ese proyecto. Incluye su propia transacción. No ejecutar las migraciones anteriores a ciegas ni usar `db push` contra otro proyecto.
3. Verificar que se crearon bucket, funciones, rol ejecutor NOBYPASSRLS y políticas. El instalador necesita crear roles, conceder permisos y transferir propiedad de funciones. Si falla, conservar el error y no desactivar RLS.
4. Preparar dos cuentas ficticias A/B, solicitudes aprobadas de prueba y una administradora vigente. Acceder con sesiones de usuario, no con service_role para las comprobaciones de aislamiento.
5. Reservar como A y subir bytes reales PDF/JPG/PNG mediante `storage.from('transfer-receipts').upload(...)`. Finalizar y comprobar `received`. Descargar como A y comparar bytes.
6. Probar 5 MiB exactos y 5 MiB + 1 byte. Para verificar el límite del servidor, intentar la carga sobredimensionada directamente mediante la API en una ruta reservada para un archivo permitido, omitiendo deliberadamente el validador del navegador. Storage debe rechazarla. Probar también un MIME no admitido.
7. Como B, intentar leer la fila, descargar el objeto, generar URL firmada, cargar en la ruta de A y finalizar su reserva: todo acceso ajeno debe fallar. Como admin vigente se permite leer; coordinación y admin revocado no pueden leer los comprobantes de A.
8. Probar reintento después de upload exitoso/finalización interrumpida, sobrescritura y borrado. Reintentar finalización no confirma pagos. Usar otra solicitud ficticia para cada archivo distinto: existe una reserva por solicitud y no hay reemplazo habilitado.

Registrar resultados HTTP y errores sin tokens ni datos reales. La interfaz y las pruebas locales con dobles no certifican el servicio Storage real. No activar `enabled` ni publicar hasta superar esta prueba y confirmar los datos/instrucciones bancarias y las condiciones de pago.

## Validación local de la interfaz

Pasaron 18 pruebas de `tests/transfer-payments.test.cjs` (validación de archivos, límite exacto de 5 MiB, errores, reintentos y confirmación administrativa con dobles), 13 pruebas existentes del portal y las 9 comprobaciones estáticas del panel administrativo. Se verificó la sintaxis de los controladores. No se repitió la prueba SQL de PGlite. La prueba binaria de Supabase permanece bloqueada por la migración remota pendiente.
