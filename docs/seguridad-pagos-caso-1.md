# Caso 1: seguridad y preparación de pagos

## Alcance y estado

Cambios locales: retirada de controles que simulaban aprobación, confirmación de pago y activación; estado de membresía tomado de la respuesta del servidor y comprobado contra titular y vigencia; contenido oculto hasta completar la carga y al cerrar o cambiar la sesión. La descarga de credencial de muestra permanece deshabilitada porque no tiene implementación.

Esto no sustituye RLS. No se aplicaron migraciones, no se publicaron cambios y no se probaron permisos contra Supabase. No está identificado ni autorizado un entorno aislado para pruebas con escrituras. Las migraciones del repositorio expresan la configuración prevista, no prueban la desplegada.

## Hallazgos pendientes de servidor

- La migración 005 exige administrador activo para aprobar y confirmar transferencias; la confirmación puede crear un pago sin comprobante. No existe un flujo completo de recepción, análisis y reemplazo de comprobantes.
- Los documentos de solicitud usan reservas y cargas directas a Storage. La validación binaria del navegador no sustituye validación del servidor. No deben reutilizarse como comprobantes de pago.
- La reserva documental no dispone de finalización ni limpieza de reservas fallidas; el nombre permitido de 180 caracteres puede superar el límite de 160 del título. El bucket admite WebP aunque las RPC documentales admiten PDF, JPEG y PNG.
- La lectura documental para coordinación debe comprobarse contra la necesidad de acceso de cada rol. La existencia de políticas restrictivas no descarta otras políticas permisivas desplegadas.

## Verificación necesaria antes de habilitar pagos

Ejecutar `supabase/diagnostics/security-readonly.sql` en el proyecto de pruebas confirmado. Revisar políticas completas, privilegios, funciones privilegiadas con `search_path` explícito y buckets privados. El archivo solamente inspecciona metadatos; no ejecuta RPC ni modifica configuración.

Después, con autorización para datos ficticios, probar mediante sesiones reales separadas:

| Actor / acción | Resultado exigido |
| --- | --- |
| Anónimo: consultar datos privados, descargar archivos o invocar acciones administrativas | Denegado |
| Titular A: leer y modificar su solicitud en estados permitidos | Permitido según estado |
| Titular B: acceder al identificador o ruta de A, incluso URL firmada solicitada por B | Denegado |
| Voluntario: alterar precio, rol, estado aprobado, pago confirmado o membresía | Denegado |
| Coordinación sin rol admin: aprobar o confirmar pago | Denegado |
| Admin vigente: confirmar transferencia aprobada | Una transacción, un pago y una membresía |
| Admin revocado: repetir acciones administrativas | Denegado |
| Reintento y dos confirmaciones concurrentes | Sin duplicados ni doble activación |
| Storage: archivo sin reserva, ruta ajena, sobrescritura, MIME/tamaño inválido | Denegado |
| Descarga: enlace expirado o documento no habilitado | Denegado; los enlaces ya emitidos pueden durar hasta su expiración |

Registrar entorno, revisión desplegada, actor ficticio, acción, resultado esperado/obtenido y evidencia sin tokens ni datos personales. Los tests locales no certifican esta matriz.

## Contrato propuesto para comprobantes (aún no implementado)

1. El servidor autentica al titular, exige solicitud aprobada y obtiene importe y moneda de la solicitud. No acepta esos valores del navegador. Conserva la versión de condiciones aceptadas cuando las condiciones definitivas estén disponibles.
2. Una operación idempotente reserva un identificador de comprobante y una ruta aleatoria vinculada al titular y solicitud, en un bucket privado dedicado de cuarentena. Aplicar límites por archivo y por usuario; inicialmente PDF, JPEG y PNG de hasta 10 MiB, revisables antes de implementar.
3. Una función segura recibe o finaliza la carga y verifica tamaño real, firma binaria y contenido; analiza malware y trata metadatos de imágenes. Hasta finalizar satisfactoriamente, el archivo no está disponible para revisión o descarga ordinaria. Un archivo fallido no pasa a revisión.
4. Separar estados de comprobante (`reserved`, `scanning`, `in_review`, `needs_correction`, `accepted`, `rejected`, `superseded`) de estados contables del pago. Subir un comprobante nunca confirma el pago ni activa la membresía.
5. El reemplazo crea una nueva versión y ruta; no sobrescribe la evidencia anterior. Validar titular, estado e identificador de versión vigente bajo bloqueo transaccional. Un comprobante aceptado no se reemplaza mediante la operación del titular.
6. Solamente un admin vigente confirma tras revisar evidencia validada; la transacción vincula comprobante, pago, referencia única, importe y membresía y registra auditoría. La RPC actual de confirmación debe adaptarse antes de habilitar este flujo; una nueva interfaz por sí sola no impone este requisito.
7. Descarga mediante autorización del servidor y enlace firmado de duración corta. Sin URL pública, sin adjuntos de correo y sin registro de tokens en logs. Limpiar reservas abandonadas y archivos huérfanos con una tarea controlada; acordar retención antes de automatizar eliminaciones.

No habilitar recepción real hasta implementar este contrato y superar la matriz de aislamiento. La pasarela de pago y sus webhooks requieren un flujo adicional con validación del proveedor; quedan fuera de esta preparación de transferencias.
