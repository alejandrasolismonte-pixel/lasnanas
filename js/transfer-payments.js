/* Recepción privada: subir/finalizar nunca confirma el abono bancario. */
(function (root) {
  'use strict';
  const MAX_BYTES = 5 * 1024 * 1024;
  const BUCKET = 'transfer-receipts';
  const fail = code => { throw new Error(code); };
  const unwrap = result => { if (result.error) throw result.error; return result.data; };
  const configured = config => config?.enabled === true &&
    ['holder','taxId','bankName','accountType','accountNumber','referenceInstructions'].every(key =>
      typeof config.bank?.[key] === 'string' && config.bank[key].trim());
  const internationalReady = config => config?.international?.confirmed === true &&
    Array.isArray(config.international.instructions) && config.international.instructions.length > 0 &&
    config.international.instructions.every(line => typeof line === 'string' && line.trim());
  // La moneda de origen no modifica ni limita la moneda cotizada.
  // El tipo de transferencia se elige explícitamente; no se deduce de la moneda.
  const canSend = (config, route, sourceCurrency) => configured(config) &&
    ['CLP','USD','EUR'].includes(sourceCurrency) &&
    (route === 'domestic' || (route === 'international' && internationalReady(config)));

  async function validate(file) {
    if (!file || !['application/pdf','image/jpeg','image/png'].includes(file.type) ||
        file.size < 1 || file.size > MAX_BYTES) fail('invalid_receipt_file');
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const signatures = { 'application/pdf':[37,80,68,70,45], 'image/jpeg':[255,216,255],
      'image/png':[137,80,78,71,13,10,26,10] };
    if (!signatures[file.type].every((value,index) => bytes[index] === value)) fail('invalid_receipt_file');
  }
  function createService(client) {
    const receipt = async applicationId => unwrap(await client.from('transfer_receipts')
      .select('id,application_id,owner_id,original_name,mime_type,byte_size,storage_path,status,received_at')
      .eq('application_id', applicationId).maybeSingle());
    const finalize = async id => {
      const row = unwrap(await client.rpc('finalize_transfer_receipt_upload', { p_receipt_id:id }))?.[0];
      if (!row?.received_at) fail('receipt_not_received');
      return row;
    };
    return {
      receipt,
      async upload(applicationId, file) {
        await validate(file);
        // Recuperar una carga que ya llegó a Storage pero cuya finalización falló.
        const existing = await receipt(applicationId);
        if (existing) {
          if (existing.status === 'received') return existing;
          try { return await finalize(existing.id); }
          catch (error) { if (error.message !== 'receipt_object_not_found') throw error; }
        }
        const reserved = unwrap(await client.rpc('reserve_transfer_receipt_upload', {
          p_application_id:applicationId, p_original_name:file.name,
          p_mime_type:file.type, p_byte_size:file.size
        }))?.[0];
        if (!reserved?.receipt_id || !reserved.storage_path) fail('receipt_reservation_failed');
        const uploaded = await client.storage.from(BUCKET).upload(reserved.storage_path, file,
          { contentType:file.type, upsert:false });
        // Ante respuesta perdida o conflicto, la RPC verifica si ya existe el objeto.
        if (uploaded.error) {
          try { return await finalize(reserved.receipt_id); }
          catch (_) { throw uploaded.error; }
        }
        return finalize(reserved.receipt_id);
      },
      finalize,
      async download(record) {
        const blob = unwrap(await client.storage.from(BUCKET).download(record.storage_path));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = record.original_name; link.rel = 'noopener';
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    };
  }

  function mountVolunteer(client, config, section) {
    const service = createService(client);
    const find = selector => section.querySelector(selector);
    const form = find('[data-receipt-form]');
    const status = find('[data-receipt-status]');
    const download = find('[data-receipt-download]');
    const report = find('[data-receipt-report]');
    const retry = find('[data-receipt-finalize]');
    const route = find('[data-transfer-route]');
    const sourceCurrency = find('[data-transfer-source-currency]');
    const readyToSend = () => canSend(config, route.value, sourceCurrency.value);
    let application, record, busy = false, generation = 0;
    function lock(value) {
      busy = value;
      form.querySelectorAll('input,button').forEach(node => { node.disabled = value; });
    retry.disabled = value; download.disabled = value; report.disabled = value;
      route.disabled = value; sourceCurrency.disabled = value;
    }
    async function refresh(nextApplication) {
      application = nextApplication;
      const token = ++generation;
     record = null; form.hidden = true; retry.hidden = true; download.hidden = true; report.hidden = true;
      find('[data-transfer-instructions]').replaceChildren();
      find('[data-transfer-options]').hidden = !configured(config);
      if (application?.status !== 'approved') return;
      find('[data-transfer-quote]').textContent = `Importe cotizado: ${application.quoted_amount} ${application.currency}. La moneda desde la que envías no modifica este precio. No calculamos conversiones.`;
      status.textContent = 'Consultando estado del pago…';
      try {
        const [nextRecord, paymentResult] = await Promise.all([
          service.receipt(application.id), client.from('payments').select('status')
            .eq('application_id', application.id).maybeSingle()
        ]);
        const payment = unwrap(paymentResult);
        if (token !== generation) return;
        record = nextRecord;
        download.hidden = !record || record.status !== 'received';
        report.hidden = !record || record.status !== 'received';
        if (payment?.status === 'confirmed') { status.textContent = 'Pago confirmado por administración.'; return; }
        if (payment && payment.status !== 'pending') { status.textContent = 'El pago requiere atención de administración.'; return; }
        if (record?.status === 'received') {
          status.textContent = 'Comprobante recibido. El pago está pendiente de verificación del abono bancario.'; return;
        }
        if (!configured(config)) {
          status.textContent = 'La transferencia todavía no está habilitada. No realices un pago por ahora.'; return;
        }
        if (route.value === 'international' && !internationalReady(config)) {
          status.textContent = 'Las instrucciones para recibir transferencias internacionales están pendientes de confirmación. No envíes una transferencia internacional todavía.'; return;
        }
        if (!readyToSend()) {
          status.textContent = 'Selecciona la moneda desde la que envías y el tipo de transferencia.'; return;
        }
        const instructions = find('[data-transfer-instructions]');
        const bank = config.bank;
        const bankLines = route.value === 'international' ? config.international.instructions :
          [`Titular: ${bank.holder}`, `Identificador: ${bank.taxId}`, `Banco: ${bank.bankName}`,
          `Tipo de cuenta: ${bank.accountType}`, `Número de cuenta: ${bank.accountNumber}`,
          `Referencia del pago: ${bank.referenceInstructions}`];
        for (const line of [...bankLines, `Código de tu solicitud: ${application.id}`, `Moneda desde la que envías: ${sourceCurrency.value}`,
          'Consulta con tu banco la conversión y las comisiones que correspondan. Administración verificará el importe efectivamente abonado antes de confirmar el pago.']) {
          const p = document.createElement('p'); p.textContent = line; instructions.append(p);
        }
        status.textContent = record ? 'Carga pendiente de completar. Puedes reintentar su recepción o subir el mismo archivo.' :
          'Realiza la transferencia con estos datos y adjunta el comprobante. Subirlo no confirma el pago.';
        retry.hidden = !record; form.hidden = false;
      } catch (_) {
        if (token === generation) status.textContent = 'No se pudo consultar el pago. Recarga la página antes de continuar.';
      }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !application || !readyToSend()) return;
      lock(true); status.textContent = 'Enviando comprobante privado…';
      try { await service.upload(application.id, form.elements.receipt.files[0]); form.reset(); await refresh(application); }
      catch (error) {
        status.textContent = error.message === 'invalid_receipt_file' ? 'Selecciona un PDF, JPG o PNG válido de hasta 5 MiB.' :
          'No se pudo completar la recepción. Reintenta con el mismo archivo; el pago no ha sido confirmado.';
      } finally { lock(false); }
    });
    retry.addEventListener('click', async () => {
      if (busy || !record || !readyToSend()) return;
      lock(true);
      try { await service.finalize(record.id); await refresh(application); }
      catch (_) { status.textContent = 'No se pudo finalizar. Vuelve a seleccionar el mismo archivo y envíalo.'; }
      finally { lock(false); }
    });
    download.addEventListener('click', async () => {
      if (busy || !record) return;
      lock(true);
      try { await service.download(record); }
      catch (_) { status.textContent = 'No se pudo descargar el comprobante privado.'; }
      finally { lock(false); }
    });
    report.addEventListener('click', () => {
  if (!application || !record) return;

  const phone = '56963888066';

  const message =
    `Hola, cargué por error un comprobante incorrecto en mi solicitud de membresía de Las Ñañas.%0A%0A` +
    `Código de solicitud: ${application.id}%0A` +
    `Necesito informar el error antes de que el pago sea validado.`;

  window.open(
    `https://wa.me/${phone}?text=${message}`,
    '_blank',
    'noopener,noreferrer'
  );
});
    for (const control of [route, sourceCurrency]) control.addEventListener('change', () => {
      if (!busy && application) refresh(application);
    });
    return { refresh };
  }
  root.LasNanasTransfers = { createService, mountVolunteer, validate, configured, canSend, MAX_BYTES };
})(typeof window === 'undefined' ? globalThis : window);
