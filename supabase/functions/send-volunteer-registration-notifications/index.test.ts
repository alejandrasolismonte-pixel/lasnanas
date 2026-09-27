import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdminDispatch, buildBrevoMessage, cleanPlainText, escapeHtml, handler, loadConfirmedPayment, type ConfirmedPayment, type NotificationRow } from "./index.ts";

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

Deno.test("correo inicial confirma recepción sin anunciar activación anticipada", () => {
  const message = buildBrevoMessage(base, config);
  assertEquals(message.to[0].email, base.volunteer_email);
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assert(message.subject.includes("Recibimos tu inscripción"));
  assert(!message.subject.includes("Bienvenida"));
  assert(message.htmlContent.includes("Estamos cerca"));
  assert(message.htmlContent.includes("tu membresía quedará activa"));
  assert(message.htmlContent.includes("https://example.test/pages/mi-voluntariado.html"));
  assert(message.htmlContent.includes("assets/img/logo-web.png"));
  assert(!message.htmlContent.match(/password|contraseña|comprobante de pago/i));
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
  assert(message.htmlContent.includes("Mi voluntariado"));
  assert(message.htmlContent.includes("Mis documentos"));
  assert(message.htmlContent.includes("mi-voluntariado.html?view=documents"));
  assert(message.htmlContent.includes("Entrar a mi panel"));
  assert(!message.htmlContent.includes(payment.reference));
  assertEquals(message.headers.idempotencyKey, base.idempotency_key);
  assertThrows(() => buildBrevoMessage(row, config), Error, "invalid_confirmed_payment");
});

Deno.test("la bienvenida tras activación dirige a Documentos y al panel", () => {
  const row = { ...base, notification_type: "membership_activated" as const };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, base.volunteer_email);
  assert(message.subject.includes("Bienvenida"));
  assert(message.htmlContent.includes("Gracias por acompañarnos en este camino"));
  assert(message.htmlContent.includes("protocolo"));
  assert(message.htmlContent.includes("credencial"));
  assert(message.htmlContent.includes("pestaña <strong>Mis documentos</strong>"));
  assert(message.htmlContent.includes("assets/img/voluntariado/nana-bienvenida.png"));
  assert(message.htmlContent.includes("mi-voluntariado.html"));
  assert(message.htmlContent.includes("view=documents"));
  assert(message.htmlContent.includes("Entrar a mi panel"));
  assertThrows(() => buildBrevoMessage(row, config, { ...payment, endsAt: payment.startsAt }), Error, "invalid_confirmed_payment");
});

Deno.test("el aviso de pago a administración enlaza el expediente sin exponerlo a la voluntaria", () => {
  const row = { ...base, notification_type: "admin_payment_confirmed" as const, recipient_email: null };
  const message = buildBrevoMessage(row, config, payment);
  assertEquals(message.to[0].email, config.adminEmail);
  assert(message.htmlContent.includes(`coordinacion-voluntariado.html?application=${base.application_id}`));
  assertThrows(() => buildBrevoMessage({ ...row, recipient_email: base.volunteer_email }, config, payment), Error, "invalid_notification_recipient");
});

Deno.test("los nuevos avisos rechazan otro destinatario", () => {
  for (const notification_type of ["payment_confirmed", "membership_activated"] as const) {
    assertThrows(() => buildBrevoMessage({ ...base, notification_type, recipient_email: "other@example.test" }, config, payment), Error, "invalid_notification_recipient");
  }
});

Deno.test("el pago se vincula a la titular de la solicitud, no a un campo ausente de la cola", async () => {
  const ownerId = "50000000-0000-4000-8000-000000000005";
  const records: Record<string, Record<string, unknown>> = {
    membership_applications: { owner_id: ownerId, status: "approved" },
    payments: {
      id: payment.paymentId, owner_id: ownerId, application_id: base.application_id,
      amount: payment.amount, currency: payment.currency, provider_reference: payment.reference,
      confirmed_at: payment.confirmedAt, settled_amount: payment.settledAmount,
      settled_currency: payment.settledCurrency, source_currency: payment.sourceCurrency,
      transfer_route: payment.transferRoute,
    },
    memberships: {
      owner_id: ownerId, application_id: base.application_id, payment_id: payment.paymentId,
      active: true, starts_at: payment.startsAt, ends_at: payment.endsAt,
    },
  };
  const fakeClient = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        single() { return Promise.resolve({ data: records[table], error: null }); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const row = { ...base, notification_type: "payment_confirmed" as const };
  assertEquals((await loadConfirmedPayment(fakeClient, row)).paymentId, payment.paymentId);
  records.membership_applications.owner_id = "60000000-0000-4000-8000-000000000006";
  await assertRejects(() => loadConfirmedPayment(fakeClient, row), Error, "confirmed_payment_unavailable");
  records.membership_applications.owner_id = ownerId;
  records.membership_applications.status = "submitted";
  await assertRejects(() => loadConfirmedPayment(fakeClient, row), Error, "confirmed_payment_unavailable");
  records.membership_applications.status = "approved";
  records.memberships.active = false;
  await assertRejects(() => loadConfirmedPayment(fakeClient, { ...row, notification_type: "membership_activated" }), Error, "active_membership_unavailable");
  records.memberships.active = true;
  records.memberships.starts_at = new Date(Date.now() - 60_000).toISOString();
  records.memberships.ends_at = new Date(Date.now() + 60_000).toISOString();
  assertEquals((await loadConfirmedPayment(fakeClient, { ...row, notification_type: "membership_activated" })).paymentId, payment.paymentId);
});

Deno.test("despacho inmediato exige token validado, rol admin vigente y solicitud concreta", async () => {
  let hasRole = true;
  const fakeClient = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "admin-id" } }, error: null }) },
    from(table: string) {
      assertEquals(table, "staff_roles");
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        maybeSingle: () => Promise.resolve({ data: hasRole ? { user_id: "admin-id" } : null, error: null }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.signature";
  const makeRequest = (authorization = `Bearer ${token}`, body = { application_id: base.application_id }) =>
    new Request("https://example.test/functions/v1/send-volunteer-registration-notifications", {
      method: "POST", headers: { authorization }, body: JSON.stringify(body),
    });
  assertEquals(await authorizeAdminDispatch(fakeClient, makeRequest()), base.application_id);
  hasRole = false;
  await assertRejects(() => authorizeAdminDispatch(fakeClient, makeRequest()), Error, "admin_access_required");
  hasRole = true;
  await assertRejects(() => authorizeAdminDispatch(fakeClient, makeRequest("")), Error, "admin_auth_required");
  await assertRejects(() => authorizeAdminDispatch(fakeClient, makeRequest(`Bearer ${token}`, { application_id: "otro" })), Error, "invalid_application_id");
});

Deno.test("preflight del panel permite solo el origen público configurado", async () => {
  const values: Record<string, string> = {
    BREVO_API_KEY: "test-key", BREVO_SENDER_EMAIL: "sender@example.test",
    ADMIN_NOTIFICATION_EMAIL: "admin@example.test", PUBLIC_SITE_URL: "https://example.test/",
    SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-role-key",
    SUPABASE_SECRET_KEYS: "",
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
    const request = (origin: string) => new Request("https://example.supabase.co/functions/v1/send-volunteer-registration-notifications", {
      method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" },
    });
    const allowed = await handler(request("https://example.test"));
    assertEquals(allowed.status, 204);
    assertEquals(allowed.headers.get("access-control-allow-origin"), "https://example.test");
    assert(allowed.headers.get("access-control-allow-headers")?.includes("authorization"));
    const blocked = await handler(request("https://other.test"));
    assertEquals(blocked.status, 403);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
