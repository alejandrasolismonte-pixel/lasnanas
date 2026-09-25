# Preparación de la primera prueba real

Actualización local del 25 de septiembre de 2026: el panel administrativo ya incluye navegación, categorías y rechazo en el código fuente. Véase [panel-admin-voluntariado.md](panel-admin-voluntariado.md) para la migración y el estado actual. Las observaciones de la prueba anterior que siguen abajo describen el sitio previo a esta actualización; no acreditan que los cambios locales estén publicados.

Actualización: Render ya publica v20 (`5f216a4`). Se verificaron las funciones de transferencia contra el SQL local y se reparó el acceso a la identidad de sesión con `202609230001_transfer_receipt_identity.sql`, aplicada en Supabase. La prueba transaccional de reserva/reintento/aislamiento pasó sin dejar registros. Los puntos de publicación y correspondencia de RPC descritos abajo corresponden al diagnóstico anterior. La carga binaria con una sesión real y la comprobación del abono bancario siguen sin ejecutarse.

Revisión del 23 de septiembre de 2026. Alcance inicial: registro, correo confirmado, solicitud, aprobación administrativa, transferencia nacional, comprobante privado y activación de membresía. No se realizaron registros, envíos de correo, pagos ni despliegues durante esta revisión.

## Conexiones observadas directamente

- Render: servicio `lasnanas-construccion`, sitio estático publicado con commit `1f3b1a9` (v19), desde `main`. Build: `node scripts/generate-supabase-config.mjs`. Los cambios locales posteriores aún no están publicados.
- Supabase: proyecto `lasnanas-voluntariado-dev`, referencia `xnntqjaztwcqljgivkds`, estado Healthy. El nombre dev no demuestra aislamiento: es necesario comprobar a qué proyecto apunta el sitio publicado antes de generar datos de prueba.
- Auth: Site URL `https://xn--lasaas-ywab.cl`. Están permitidas `/pages/auth-callback.html` y `/pages/actualizar-contrasena.html` en ese dominio. En `https://lasnanas-construccion.onrender.com` solo se observó `/pages/mi-voluntariado.html`; no usar ese origen para la prueba de registro y recuperación sin completar las redirecciones.
- Correo de Auth: SMTP personalizado habilitado, host `smtp-relay.brevo.com`, puerto 587 y nombre de remitente Las Ñañas. No se revelaron credenciales ni se comprobó entrega.
- Storage: existe `transfer-receipts`, con 8 políticas indicadas por el panel, límite mostrado de 5 MB y MIME PDF/JPEG/PNG. También existen `volunteer-documents` y `volunteer-attachments`. La lista no acredita el carácter privado, las condiciones de cada política ni las RPC de finalización.
- Edge Functions: `send-volunteer-registration-notifications` está desplegada. No se verificaron secretos, webhook, programación, cola ni entrega de avisos.

Estas observaciones sustituyen las afirmaciones históricas de que el bucket o la función no estaban desplegados. No volver a aplicar migraciones a ciegas: el panel puede mostrar «No migrations» aunque se haya ejecutado SQL manualmente.

## Pendiente antes del recorrido completo

1. Comparar la URL pública de Supabase generada por Render con el proyecto elegido y verificar carga del cliente sin errores desde el dominio principal. Comprobar dominio/HTTPS y abrir login, callback, recuperación y ambos paneles.
2. Ejecutar los diagnósticos de solo lectura `supabase/diagnostics/security-readonly.sql` y `supabase/diagnostics/transfer-receipts-readonly.sql`. Comparar tablas, funciones, roles y políticas con el SQL local, incluidas las operaciones administrativas y documentales. La existencia del bucket no acredita la migración completa. Cualquier corrección de esquema requiere revisar primero las diferencias; permanece la instrucción previa de no ejecutar la migración sin autorización.
3. Verificar una cuenta administradora vigente y dos cuentas controladas A/B. Probar que A no puede leer archivos o solicitudes de B; tampoco un usuario anónimo, coordinación sin rol admin o un admin revocado. No usar service_role para certificar estos permisos.
4. Validar precios y moneda vigentes, datos bancarios y condiciones que recibirá la participante. Una transferencia internacional sigue bloqueada. El navegador no calcula tipos de cambio ni comisiones.
5. Publicar los cambios locales revisados mediante Git/Render, evitando incluir archivos de entorno. El build publica la raíz del repositorio: revisar el contenido publicable antes del despliegue. Verificar la nueva revisión publicada y los textos en pantalla.
6. Recorrer registro → correo de confirmación → acceso → guardar y enviar solicitud → aprobación por admin → carga PDF/JPG/PNG → recepción pendiente → revisión del abono por admin → confirmación → membresía activa → documento autorizado. Cerrar sesión, volver a entrar y comprobar persistencia. Verificar también recuperación de contraseña, archivo inválido/sobredimensionado, reintento y ausencia de pagos duplicados.
7. Si la prueba incluye avisos automáticos de inscripción y bienvenida, comprobar configuración de la función, webhook, reintentos y entrega a ambos destinatarios. El SMTP de Auth y esos avisos son mecanismos distintos. Sin avisos, la revisión manual desde el panel debe ser explícita.

## Textos y límites de la interfaz

Se reemplazó el aviso del login que pedía datos ficticios para un prototipo por una indicación de acceso normal. Los errores de carga de solicitudes y respuesta de aclaraciones ya no muestran instrucciones de migraciones.

Se mantienen los estados reales: comprobante pendiente de verificación bancaria, correo sin confirmar, adjuntos de aclaraciones deshabilitados y credencial sin descarga. Quitar esos avisos no implementaría sus funciones. El rechazo administrativo y varias secciones del panel siguen deshabilitados; no forman parte del recorrido inicial de aprobación. La fotografía del perfil es una vista previa local, no una carga persistida.

Las páginas independientes de maqueta conservan su identificación de demostración. No deben utilizarse como acceso operativo ni presentarse como evidencia de una membresía o pago real.

La finalización del comprobante verifica objeto y metadatos de Storage; no analiza malware ni valida la firma binaria en servidor. La RPC de confirmación de pago existente no exige comprobante: la exigencia de descarga y declaración de revisión bancaria está en la interfaz. Son limitaciones que deben resolverse antes de ampliar la recepción a público general.
