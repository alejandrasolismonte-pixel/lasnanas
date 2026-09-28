"""Revisión local del dashboard con datos ficticios; no conecta con Supabase.

Uso: python scripts/preview-site-activity.py [--port 8765]
Abrir /pages/coordinacion-voluntariado.html?view=activity
Agregar &qa=denied para comprobar el acceso sin rol o &qa=anonymous sin sesión.
"""
from argparse import ArgumentParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = r"""
(function () {
  const mode = new URLSearchParams(location.search).get('qa');
  const callbacks = [];
  const mockUser = mode === 'anonymous' ? null : {id:'qa-admin'};
  const authorized = mode !== 'denied' && !!mockUser;
  const denied = {code:'42501',message:'admin_access_required'};
  let health = null;
  const query = new Proxy({}, { get(_, name) {
    if (name === 'then') return (resolve) => resolve({data:[],error:null});
    return () => query;
  }});
  window.LasNanasSupabase = {client:{
    auth:{getUser:async()=>({data:{user:mockUser},error:null}),
      onAuthStateChange:cb=>callbacks.push(cb),signOut:async()=>callbacks.forEach(cb=>cb('SIGNED_OUT',null))},
    from:()=>query,
    rpc:async(name,args)=>{
      if (!authorized) return {data:null,error:denied};
      if (name === 'is_site_activity_admin') return {data:true,error:null};
      if (name === 'can_read_agenda') return {data:false,error:null};
      if (name === 'admin_record_site_health') {
        health = {online:args.p_online,latency_ms:args.p_latency_ms,checked_at:new Date().toISOString()};
        return {data:health,error:null};
      }
      if (name === 'admin_get_site_activity') {
        const multiplier = args.p_days === 1 ? 1 : args.p_days === 7 ? 4 : 12;
        return {error:null,data:{updated_at:new Date().toISOString(),timezone:'America/Santiago',
          visits:{today:36,last7:144,last30:432,selected:36*multiplier},
          unique_visitors:24*multiplier,new_visitors:16*multiplier,returning_visitors:8*multiplier,
          volunteer_visits:18*multiplier,registration_starts:5*multiplier,applications_submitted:3*multiplier,
          top_countries:[{country_code:'CL',visits:23*multiplier},{country_code:'AR',visits:7*multiplier},
            {country_code:null,visits:6*multiplier}],
          top_pages:[{path:'/',views:39*multiplier},{path:'/pages/voluntariado.html',views:23*multiplier},
            {path:'/pages/servicios.html',views:10*multiplier}],
          performance:{avg_load_ms:1280,samples:31*multiplier},health,
          tracking_started_at:'2026-09-27T12:00:00Z'}};
      }
      if (name === 'generate_daily_site_activity_summary') return {error:null,data:{summary_date:'2026-09-26',
        generated_at:new Date().toISOString(),message:'Las Ñañas · resumen diario (DATOS DE PRUEBA)\n26/09/2026\nVisitas: 36 · visitantes únicos: 24\nNuevos: 16 · recurrentes: 8\nVoluntariado: 18 · registros iniciados: 5\nSolicitudes enviadas: 3\nSitio: Online (comprobación puntual)\nCarga media: 1.280 ms\nPaíses: Chile 23, Argentina 7, sin determinar 6\nPáginas: Inicio 39, Voluntariado 23, Servicios 10'}};
      return {data:[],error:null};
    }
  }};
  document.querySelector('.demo-bar strong').textContent = 'REVISIÓN LOCAL · DATOS DE PRUEBA:';
})();
"""


class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        route = unquote(urlsplit(self.path).path)
        if route == '/':
            self.send_response(302)
            self.send_header('Location', '/pages/coordinacion-voluntariado.html?view=activity')
            self.end_headers()
            return
        if route == '/__qa-fixture.js':
            self.respond(FIXTURE, 'application/javascript; charset=utf-8')
            return
        resolved = (ROOT / route.lstrip('/')).resolve()
        if not resolved.is_relative_to(ROOT) or any(part.startswith('.') for part in Path(route).parts) or route.endswith('supabase-config.js'):
            self.send_error(404)
            return
        if route == '/pages/coordinacion-voluntariado.html':
            html = resolved.read_text(encoding='utf-8')
            html = re.sub(r'\s*<script src="(?:https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2|\.\./js/supabase-config\.js|\.\./js/supabase-client\.js[^\"]*)"></script>', '', html)
            html = html.replace('  <script src="../js/loading-overlay.js', '  <script src="/__qa-fixture.js"></script>\n  <script src="../js/loading-overlay.js')
            self.respond(html, 'text/html; charset=utf-8')
            return
        if not (route.startswith(('/css/', '/js/', '/assets/', '/pages/')) or route == '/index.html') or not resolved.is_file():
            self.send_error(404)
            return
        super().do_GET()

    def respond(self, content, content_type):
        data = content.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    print(f'Revisión local con datos de prueba: http://127.0.0.1:{args.port}/pages/coordinacion-voluntariado.html?view=activity', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), PreviewHandler).serve_forever()
