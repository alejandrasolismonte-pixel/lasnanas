import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { buildBrevoMessage, cleanPlainText, escapeHtml, type ConfirmedPayment, type NotificationRow } from "./index.ts";

const base: NotificationRow = {
  notification_id: "10000000-0000-4000-8000-000000000001",
  application_id: "20000000-0000-4000-8000-000000000002",
  notification_type: "volunteer_welcome",
  recipient_email: "volunteer@example.test",
  first_name: "Ana",
  last_name: "Pérez",
  volunteer_email: "volunteer@example.test",
  plan_id: "keyuwün",
  billing: "monthly",
  currency: "CLP",
  application_status: "draft",
  application_created_at: "2026-09-10T12:00:00Z",
  idempotency_key: "30000000-0000-4000-8000-000000000003",
  attempt_number: 1,
};
const config = { brevoApiKey: "not-used", senderEmail: "sender@example.test", adminEmail: "admin@example.test", publicSiteUrl: "https://example.test/" };
const payment: ConfirmedPayment = {
  paymentId: "40000000-0000-4000-8000-000000000004", amount: 15000,
  currency: "CLP", reference: "TRANSFER-123", confirmedAt: "2026-09-26T16:00:00Z",
  startsAt: "2026-09-26T16:00:00Z", endsAt: "2026-10-26T16:00:00Z",
  settledAmount: 14980, settledCurrency: "CLP", sourceCurrency: "EUR", transferRoute: "international",
};

Deno.test("escapa HTML controlado por la persona", () => {
  assertEquals(escapeHtml('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  assertEquals(cleanPlainText("Ana\r\nBcc: otra@example.test"), "Ana Bcc: otra@example.test");
});

Deno.test("bienvenida usa destinatario propio, HTTPS e idempotencia estable", () => {
  const message = buildBrevoMessage(base, config);
  assertEquals(message.to[0].email, base.volunteer_email);
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assert(message.htmlContent.includes("https://example.test/pages/mi-voluntariado.html"));
  assert(!message.htmlContent.match(/password|contraseñ|adjunto|credencial|comprobante/i));
});

Deno.test("aviso administrativo queda separado", () => {
  const message = buildBrevoMessage({ ...base, notification_type: "admin_registration", recipient_email: null }, config);
  assertEquals(message.to[0].email, config.adminEmail);
  assert(message.htmlContent.includes("coordinacion-voluntariado.html"));
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
});

Deno.test("rechaza URL pública que no sea HTTPS", () => {
  assertThrows(() => buildBrevoMessage(base, { ...config, publicSiteUrl: "http://example.test" }), Error, "invalid_public_site_url");
});

Deno.test("rechaza destinatario de bienvenida alterado", () => {
  assertThrows(() => buildBrevoMessage({ ...base, recipient_email: "other@example.test" }, config), Error, "invalid_notification_recipient");
});

Deno.test("el comprobante de pago solo usa datos de un pago confirmado y se envía a la titular", () => {
  const row = { ...base, notification_type: "payment_confirmed" as const, plan_id: "kimün" as const };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, base.volunteer_email);
  assert(message.htmlContent.includes("15.000"));
  assert(message.htmlContent.includes(payment.paymentId));
  assert(message.htmlContent.includes(payment.reference));
  assert(message.htmlContent.includes("Abono bancario verificado"));
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assertThrows(() => buildBrevoMessage(row, config), Error, "invalid_confirmed_payment");
});

Deno.test("la activación enlaza un documento distinto y exige fechas de vigencia", () => {
  const row = { ...base, notification_type: "membership_activated" as const };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, base.volunteer_email);
  assert(message.htmlContent.includes("protocolo-acuerdos-voluntariado.html"));
  assert(message.htmlContent.includes("mi-voluntariado.html"));
  assertThrows(() => buildBrevoMessage(row, config, { ...payment, endsAt: payment.startsAt }), Error, "invalid_confirmed_payment");
});

Deno.test("los nuevos avisos rechazan otro destinatario", () => {
  for (const notification_type of ["payment_confirmed", "membership_activated"] as const) {
    assertThrows(() => buildBrevoMessage({ ...base, notification_type, recipient_email: "other@example.test" }, config, payment), Error, "invalid_notification_recipient");
  }
});
