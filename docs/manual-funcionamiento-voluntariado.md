# Manual de funcionamiento del voluntariado

**Las Ñañas · versión de revisión · 26 de septiembre de 2026**

Este manual explica el recorrido de una voluntaria y las tareas de coordinación para los planes **Keyuwün, Kimün y Pülli**. El [diagrama del flujo](diagrama-flujo-voluntariado.md) muestra las decisiones principales en una página.

> **Estado:** el flujo descrito está preparado en el código local. Las migraciones nuevas, la función de correo y la versión actual del sitio aún deben publicarse y probarse con cuentas y transferencias reales. Este manual no confirma que ya funcione en lasnanas.cl.

## 1. Elegir plan y crear cuenta

1. En la página de voluntariado, la persona elige Keyuwün, Kimün o Pülli, periodicidad mensual o anual y precio en CLP o USD.
2. El botón del plan abre el formulario de registro o ingreso. La selección se conserva durante el registro, incluso si el enlace de confirmación se abre en otro dispositivo.
3. Supabase Auth envía el **primer correo a la voluntaria**, con el logo de Las Ñañas, la imagen de la ñaña y el enlace de confirmación. Al abrirlo, la persona llega a **Mi voluntariado**, donde se crea un borrador de solicitud con el plan elegido.
4. Si el enlace ya se utilizó o expiró, debe entrar desde **Mi Ruka** con su contraseña. Si el correo sigue pendiente de confirmación, desde el mismo acceso puede solicitar un nuevo enlace.

Los importes previstos por la nueva versión de precios son:

| Plan | Mensual CLP | Anual CLP | Mensual USD | Anual USD |
| --- | ---: | ---: | ---: | ---: |
| Keyuwün | $10.000 | $60.000 | US$10 | US$60 |
| Kimün | $15.000 | $90.000 | US$15 | US$90 |
| Pülli | $25.000 | $150.000 | US$25 | US$150 |

El precio anual equivale a seis mensualidades: **50 % del total de doce meses**. La cotización definitiva se guarda con la solicitud. La moneda desde la que luego se transfiere **no modifica** ese precio. Las solicitudes y pagos que ya tengan una transferencia informada conservan su cotización anterior para revisión de coordinación.

## 2. Enviar la solicitud

En **Mi voluntariado**, la persona puede revisar el plan, editar el borrador y guardar su perfil. Para enviar la solicitud debe tener el correo confirmado y aceptar los acuerdos de respeto y privacidad y de coordinación de fechas, cupos, traslados y alojamiento.

Al enviarla, el estado pasa a **Solicitud enviada**. Coordinación recibe su aviso de nueva inscripción; la voluntaria sigue el estado en **Mi voluntariado**, sin un correo adicional. El equipo puede ponerla en revisión, pedir una aclaración visible para la voluntaria, aprobarla o rechazarla con un motivo. Una aclaración respondida vuelve a revisión. Los adjuntos de aclaraciones todavía están deshabilitados.

La aprobación **no activa** la membresía ni autoriza cobrar por sí sola: abre la etapa de transferencia.

## 3. Transferir y enviar el comprobante

La voluntaria selecciona dos datos distintos:

- **Tipo de transferencia:** nacional o internacional.
- **Moneda desde la que envía:** CLP, USD o EUR.

En una transferencia nacional se muestran los datos bancarios disponibles. Si el dinero sale en USD o EUR hacia una cuenta nacional en CLP, la persona debe acordar la conversión con su banco antes de transferir. En una transferencia internacional, si faltan instrucciones específicas para esa moneda, la pantalla indica pedirlas a coordinación. **La ausencia de un dato bancario no bloquea la carga posterior del comprobante.** No se inventan códigos SWIFT, bancos corresponsales, comisiones ni tipos de cambio.

Después de pagar, la voluntaria adjunta un **PDF, JPG o PNG de hasta 5 MiB**. El comprobante se guarda de forma privada y queda en estado **recibido**. Puede volver a descargarlo. Si adjuntó uno incorrecto, el portal ofrece un enlace para avisar a coordinación. Recibir el archivo **no equivale a confirmar el pago**.

## 4. Verificación de coordinación

Una cuenta con rol administrativo vigente abre el panel de coordinación, revisa la solicitud y descarga el comprobante privado. Debe comprobar el abono en el banco y cotejar la referencia, el importe y la moneda efectivamente recibidos con el precio de la solicitud, incluidas conversiones y comisiones. Si hay una diferencia pendiente, deja el pago sin confirmar y la resuelve con la voluntaria.

Al confirmar, coordinación registra la referencia bancaria, el origen nacional o internacional, la moneda enviada y el **importe y moneda realmente abonados**. El sistema conserva por separado el precio cotizado. La confirmación crea una membresía activa por un mes o un año, según la periodicidad elegida.

## 5. Correo y documentos tras la activación

Cuando coordinación confirma el abono y activa la membresía, la voluntaria recibe su **segundo y último correo del recorrido**: bienvenida y activación en un solo mensaje. Lleva el logo y la imagen de la ñaña, la vigencia, un enlace directo a **Mi voluntariado** y una **credencial PNG inicial adjunta, sin fotografía**. El mensaje invita a cargar una foto en **Mi perfil**, guardar el perfil y descargar después la credencial actualizada.

En **Mi voluntariado → Mis documentos** puede descargar el comprobante de pago confirmado, la constancia de activación, el [protocolo y acuerdos](../pages/protocolo-acuerdos-voluntariado.html) y la credencial. El protocolo es imprimible. No se envían correos separados por el pago, por el protocolo ni por la creación de la solicitud. Coordinación conserva sus avisos de inscripción, comprobante recibido y pago confirmado.

El correo de activación se envía mediante la función de servidor y requiere que sus migraciones, secretos y despliegue estén operativos. No sale directamente desde el navegador. El correo de confirmación de cuenta corresponde a Supabase Auth.

## 6. Uso de la membresía

Con una membresía activa y vigente, la voluntaria puede abrir los documentos que correspondan a su plan y descargar su **credencial PNG**. En **Mi perfil** puede guardar un nombre de uso y una foto JPG, PNG o WebP de hasta 4 MiB. La foto se guarda en un bucket privado y aparece en la credencial después de pulsar **Guardar perfil**. La agenda personal permite registrar y consultar actividades; coordinación administra por separado las actividades oficiales.

La membresía no reserva automáticamente alojamiento, viaje, fecha, actividad ni cupo presencial. Todo eso requiere confirmación directa de coordinación.

## 7. Cancelación

El [borrador del protocolo](../pages/protocolo-acuerdos-voluntariado.html) dice que la suscripción puede cancelarse cuando la persona quiera. **El botón y la operación de cancelación aún no están implementados en Mi voluntariado.** El sistema actual guarda una vigencia mensual o anual y no ejecuta cobros automáticos de renovación. Hasta implementar y publicar esa operación, coordinación debe gestionar cualquier solicitud de cancelación; la interfaz no debe comunicar que la cancelación se completó automáticamente.

## 8. Qué comprobar antes de usarlo con personas reales

1. Aplicar en el proyecto correcto las migraciones de fotografía privada, avisos de pago, detalles de transferencia y precio anual al 50 %, en ese orden.
2. Desplegar la función de notificaciones con sus secretos y publicar la versión actual del sitio.
3. Probar el registro y la confirmación de correo de los tres planes con cuentas nuevas, incluidos enlaces abiertos en otro dispositivo.
4. Probar una transferencia nacional y una internacional de prueba, la carga privada del comprobante y la confirmación bancaria por administración. Verificar que una persona ajena no pueda leer comprobantes ni fotografías.
5. Verificar que la voluntaria reciba solo el correo de confirmación de cuenta y el de bienvenida tras activar la membresía. Comprobar el logo, la ñaña, la credencial inicial adjunta sin foto y la descarga de la credencial actualizada después de guardar la fotografía.

Las notas técnicas y el historial de pruebas están en [transferencias](transferencia-habilitacion.md), [notificaciones](notificaciones-administrativas-voluntariado.md) y [panel administrativo](panel-admin-voluntariado.md).
