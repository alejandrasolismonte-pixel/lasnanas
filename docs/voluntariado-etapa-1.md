# Voluntariado: integración de la maqueta y preparación de Supabase

## Qué funciona en el navegador

- Las tarjetas públicas, nombres, botones y precios originales permanecen sin reconstruirse.
- CLP y USD funcionan para mensual y anual.
- Cada botón abre un modal compacto con el plan y la periodicidad elegidos.
- El registro separa nombre y apellido. Luego redirige a `mi-voluntariado.html`.
- Una sesión ya iniciada entra directamente al portal y aplica la selección pendiente.
- El portal conserva la organización visual de la maqueta: progreso, navegación lateral, solicitud, revisión, condiciones, pago, documentos y credencial.
- Se puede retroceder, guardar y continuar después dentro de la pestaña de demostración.
- Las aclaraciones admiten respuesta y adjuntos reemplazables o eliminables. La validación local acepta PDF, JPG, PNG y WebP, máximo 5 MB, y rechaza nombres inseguros, MIME/extensión incompatibles, SVG y ejecutables.
- La agenda privada permite crear, editar y eliminar anotaciones, y alternar entre lista y calendario. Las actividades oficiales usan un estilo distinto y no pueden editarse como anotaciones personales.
- Un pago informado queda pendiente; solo la confirmación de coordinación habilita membresía, documentos y credencial.

## Límite deliberado de la demostración

Hasta conectar Supabase, cuentas y avances se guardan en `sessionStorage`, no en `localStorage`. Duran durante la pestaña actual y no son una base de datos ni autenticación real. Las contraseñas no se guardan. Verificación de correo, recuperación, carga privada, limpieza de metadatos, pagos y permisos reales están pendientes; la interfaz nunca afirma que una acción externa ocurrió.

El panel `coordinacion-voluntariado.html` queda cerrado visualmente hasta contar con Supabase Auth y un rol autorizado. Los controles plegables del portal solo recorren estados de demostración.

## Estructura preparada

La migración `supabase/migrations/202609100001_voluntariado.sql` crea perfiles y roles, planes, solicitudes, mensajes visibles, notas administrativas separadas, adjuntos, pagos, membresías, documentos, agenda, buckets privados y políticas RLS.

La clave `service_role` y los secretos de pagos son exclusivamente de servidor. Nunca deben cargarse en HTML, JavaScript público ni Git.

## Auditoría previa a Supabase

- RLS y `FORCE ROW LEVEL SECURITY` cubren todas las tablas privadas.
- `volunteer_profiles` y `staff_roles` están separados; el rol no es una columna editable del perfil.
- Las solicitudes propias solo se editan como borrador y se envían mediante una función controlada.
- Los precios están versionados mediante `plan_prices`, con periodos sin solapamientos y una cotización validada por trigger.
- No existen políticas de escritura desde el navegador para pagos, membresías ni auditoría.
- Confirmar pagos y activar membresías son funciones `SECURITY DEFINER` reservadas a `service_role`, con `search_path` vacío.
- Los adjuntos deben cargarse mediante una Edge Function. Coordinación solo puede descargar archivos marcados como limpios.
- Documentos y objetos de Storage requieren membresía activa, vigente y del plan autorizado.
- La agenda no tiene acceso anónimo: la propietaria administra anotaciones personales y coordinación administra actividades oficiales. La lectura administrativa de agendas exige el alcance `agenda_access`.
- Las relaciones financieras usan `ON DELETE RESTRICT`; los registros personales usan borrado lógico hasta definir y automatizar el plazo legal de conservación.

## Pasos para conectar Supabase

1. Crear un proyecto de prueba en Supabase.
2. En Authentication, activar correo/contraseña y exigir confirmación de correo.
3. Configurar `Site URL` y las URL de redirección para desarrollo y dominio final.
4. Ejecutar la migración SQL en el proyecto de prueba y revisar sus políticas antes de producción.
5. Crear usuarios de coordinación desde Auth y asignar el rol únicamente mediante SQL administrativo o una función de servidor protegida. El navegador nunca debe cambiar roles.
6. Copiar URL y clave pública/anon a las variables de entorno. Conservar `service_role` solo en funciones de servidor.
7. Conectar el cliente oficial de Supabase y sustituir `sessionStorage` por Auth y consultas al servidor.
8. Implementar una Edge Function para adjuntos: comprobar firma binaria, extensión, tamaño y nombre; rechazar SVG y ejecutables; escanear malware; re-encodear imágenes para eliminar EXIF/metadatos; escribir en `owner_id/uuid.ext` y marcar `scan_status=clean`.
9. Usar URL firmadas breves para archivos privados. No convertir los buckets en públicos.
10. Conectar el proveedor de pagos y un webhook idempotente. Crear la membresía solo después de validar referencia, importe, moneda y estado confirmado.
11. Activar MFA para coordinación, auditoría, límites de intentos, copias de seguridad y restauración probada.
12. Probar RLS con dos cuentas miembro y una de coordinación: ninguna debe leer datos ajenos sin autorización.

## Datos todavía necesarios

- URL y clave pública del proyecto Supabase.
- Dominio definitivo y URL local autorizada.
- Correos de coordinación.
- Proveedor de pagos y su clave pública; secretos solo para servidor.
- Datos bancarios confirmados.
- Condiciones legales versionadas.
- Documentos reales y reglas finales de acceso por plan.
- Política de retención y eliminación de adjuntos, perfiles y agenda.

La membresía no reserva alojamiento, fechas ni cupos. Llegadas, salidas, reuniones y notas de agenda nunca son públicas.
