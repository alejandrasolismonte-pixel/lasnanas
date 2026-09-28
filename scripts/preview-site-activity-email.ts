// Genera una muestra fuera del directorio público. No consulta Supabase ni envía correo.
import { buildReportMessage } from '../supabase/functions/send-site-activity-reports/index.ts';

const message = buildReportMessage({
  id: '11111111-1111-4111-8111-111111111100',
  report_date: '2026-09-28', milestone: 100,
  reached_at: '2026-09-28T14:00:00.000000Z',
  snapshot_at: '2026-09-28T14:01:00.000000Z',
  metrics: {
    updated_at: '2026-09-28T14:01:00.000000Z', timezone: 'America/Santiago',
    period: { days: 1, starts_at: '2026-09-28T03:00:00.000000Z', ends_at: '2026-09-28T14:00:00.000001Z' },
    visits: { today: 100, last7: 325, last30: 850, selected: 100 },
    unique_visitors: 80, new_visitors: 50, returning_visitors: 30,
    volunteer_visits: 45, registration_starts: 15, applications_submitted: 3,
    top_countries: [{ country_code: 'CL', visits: 85 }, { country_code: 'AR', visits: 10 }, { country_code: null, visits: 5 }],
    top_pages: [{ path: '/', views: 112 }, { path: '/pages/voluntariado.html', views: 52 }],
    performance: { avg_load_ms: 1100, samples: 80 },
    health: { checked_at: '2026-09-28T13:59:00.000000Z', online: true, latency_ms: 60 },
    tracking_started_at: '2026-09-27T23:00:00.000000Z',
  },
}, {
  reportEmail: 'reports@example.test', senderEmail: 'sender@example.test',
  publicSiteUrl: 'https://xn--lasaas-ywab.cl', supabaseUrl: 'https://project.example.test',
  brevoApiKey: 'preview-only', webhookSecret: 'preview-only', supabaseSecretKey: 'preview-only',
});
const temporaryDirectory = Deno.env.get('TEMP') || Deno.env.get('TMPDIR') || '/tmp';
const destination = Deno.args[0] || temporaryDirectory.replace(/[\\/]$/, '') + '/lasnanas-activity-email-preview.html';
const html = message.htmlContent.replace(/(<body[^>]*>)/,
  '$1<p style="max-width:640px;margin:0 auto 16px;text-align:center;color:#8b4800;font:600 13px Arial,sans-serif">' +
  'MUESTRA LOCAL · DATOS FICTICIOS · NO ENVIADO</p>');
await Deno.writeTextFile(destination, html);
console.log(destination);
