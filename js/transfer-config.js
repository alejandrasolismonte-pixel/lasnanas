/* Transferencia manual autorizada. Las instrucciones internacionales siguen pendientes. */
window.LAS_NANAS_TRANSFER = Object.freeze({
  enabled: true,
  bank: Object.freeze({
    holder: 'Chakrasur',
    taxId: '77.311.825-6',
    bankName: 'Banco Estado',
    accountType: 'Cuenta vista / chequera electrónica',
    accountNumber: '725-7-025245-4',
    referenceInstructions: 'Escribe el código de tu solicitud en el comentario o referencia de la transferencia'
  }),
  international: Object.freeze({ confirmed: false, instructions: Object.freeze([]) })
});
