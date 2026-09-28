# Diagrama del flujo de voluntariado

Este diagrama acompaña al [manual de funcionamiento](manual-funcionamiento-voluntariado.md). Las flechas continuas describen el flujo preparado en el código local. La flecha punteada señala la cancelación solicitada para una etapa posterior.

```mermaid
flowchart TD
    A[Elegir Keyuwün, Kimün o Pülli; anual = seis mensualidades] --> B[Crear cuenta o ingresar]
    B --> C{¿Correo confirmado?}
    C -- No --> D[Correo 1 con logo y ñaña: confirmar enlace]
    D --> C
    C -- Sí --> E[Revisar borrador y aceptar acuerdos]
    E --> F[Enviar solicitud]
    F --> G[Coordinación revisa]
    G --> H{¿Resultado?}
    H -- Aclaración --> I[Voluntaria responde]
    I --> G
    H -- Rechazo --> J[Se comunica el motivo]
    H -- Aprobación --> K[Elegir transferencia nacional o internacional y moneda CLP, USD o EUR]
    K --> L{¿Falta un dato bancario?}
    L -- Sí --> M[Solicitar dato a coordinación]
    M --> N[Realizar transferencia]
    L -- No --> N
    N --> O[Subir comprobante privado]
    O --> P[Coordinación verifica abono real en el banco]
    P --> Q{¿Importe, moneda y referencia correctos?}
    Q -- No --> R[Pago pendiente: resolver diferencia]
    R --> P
    Q -- Sí --> S[Registrar abono y activar membresía]
    S --> T[Correo 2 con logo y ñaña: bienvenida y credencial adjunta sin foto]
    S --> U[Habilitar documentos y credencial PNG]
    U --> V[Guardar foto privada y descargar credencial]
    T --> V
    U -. Cancelación pendiente de implementar .-> W[Botón para cancelar suscripción]
```

**Lectura clave:** la voluntaria recibe dos correos en el recorrido normal. Subir un comprobante no activa la membresía: coordinación verifica el abono y activa. La bienvenida adjunta la credencial inicial sin foto y enlaza el panel; en Mis documentos están el comprobante, el protocolo y la credencial actualizada. Los avisos a coordinación se conservan. El botón de cancelación todavía no existe en la interfaz publicada ni en el código local.
