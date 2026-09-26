# Diagrama del flujo de voluntariado

Este diagrama acompaña al [manual de funcionamiento](manual-funcionamiento-voluntariado.md). Las flechas continuas describen el flujo preparado en el código local. La flecha punteada señala la cancelación solicitada para una etapa posterior.

```mermaid
flowchart TD
    A[Elegir Keyuwün, Kimün o Pülli; anual = seis mensualidades] --> B[Crear cuenta o ingresar]
    B --> C{¿Correo confirmado?}
    C -- No --> D[Confirmar enlace o pedir uno nuevo desde Mi Ruka]
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
    S --> T[Enviar comprobante de pago y aviso de activación]
    S --> U[Habilitar documentos y credencial PNG]
    U --> V[Guardar foto privada y descargar credencial]
    U -. Cancelación pendiente de implementar .-> W[Botón para cancelar suscripción]
```

**Lectura clave:** subir un comprobante no activa la membresía. Solo la verificación del abono por administración la activa. El correo y el acceso a documentos dependen de esa activación. El botón de cancelación todavía no existe en la interfaz publicada ni en el código local.
