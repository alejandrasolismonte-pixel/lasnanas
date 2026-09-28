"""Verify the published dashboard without inserting analytics or exposing keys.

Run only when network access is authorized. Output is one JSON object containing
check names, HTTP statuses, overall status, and the public Supabase project URL.
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


SITE_ORIGIN = "https://xn--lasaas-ywab.cl"
WORKSPACE = Path(__file__).resolve().parents[2]
MAX_PUBLIC_BODY = 2 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class IntegrationHTML(HTMLParser):
    def __init__(self, page_url: str):
        super().__init__()
        self.page_url = page_url
        self.scripts: list[str] = []
        self.styles: list[str] = []
        self.hidden_activity_view = False
        self.hidden_activity_content = False
        self.activity_button = False

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == "script" and attributes.get("src"):
            self.scripts.append(self._path(attributes["src"]))
        if tag == "link" and attributes.get("rel") == "stylesheet" and attributes.get("href"):
            self.styles.append(self._path(attributes["href"]))
        if attributes.get("data-admin-view") == "activity" and "hidden" in attributes:
            self.hidden_activity_view = True
        if "data-activity-content" in attributes and "hidden" in attributes:
            self.hidden_activity_content = True
        if attributes.get("data-admin-view-button") == "activity":
            self.activity_button = True

    def _path(self, link: str) -> str:
        url = urllib.parse.urlsplit(urllib.parse.urljoin(self.page_url, link))
        origin = f"{url.scheme}://{url.netloc}"
        return url.path if origin == SITE_ORIGIN else "external"


def fresh_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    if parsed.path.startswith("/rest/v1/"):
        # PostgREST treats unknown query names as column filters. A supported
        # offset is a valid cache nonce; the table still has limit=0 and neither
        # REST response body is read. Permission denial remains the expectation.
        query.append(("offset", str(uuid.uuid4().int % 2147483647)))
    else:
        query.append(("activity_verification", uuid.uuid4().hex))
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def request(url: str, *, method: str = "GET", headers=None, body=None,
            read_public_body: bool = False, timeout: float = 15):
    """Do not read response bodies from collectors, REST tables, or RPCs."""
    request_headers = {
        "Cache-Control": "no-cache", "Pragma": "no-cache",
        "User-Agent": "LasNanas-activity-verification/1.0",
        **(headers or {}),
    }
    outgoing = urllib.request.Request(fresh_url(url), data=body, headers=request_headers, method=method)
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(outgoing, timeout=timeout) as response:
            payload = response.read(MAX_PUBLIC_BODY + 1) if read_public_body else None
            if payload is not None and len(payload) > MAX_PUBLIC_BODY:
                return "response_too_large", None
            return response.status, payload
    except urllib.error.HTTPError as error:
        # Error bodies can contain database details; never read or print them.
        status = error.code
        error.close()
        return status, None
    except (urllib.error.URLError, OSError, TimeoutError):
        return "network_error", None


def normalize_text(payload: bytes) -> str:
    return payload.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def parse_config(payload: bytes, expected_ref: str):
    text = normalize_text(payload)
    match = re.search(r"Object\.freeze\s*\(\s*(\{.*?\})\s*\)", text, re.DOTALL)
    if not match:
        return None
    config = json.loads(match.group(1))
    url = config.get("supabaseUrl")
    key = config.get("supabasePublishableKey")
    expected_url = f"https://{expected_ref}.supabase.co"
    if not isinstance(url, str) or url.rstrip("/") != expected_url:
        return None
    if not isinstance(key, str) or not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        return None
    if re.search(r"secret|service_role", key, re.IGNORECASE):
        return None
    return expected_url, key


def run(args) -> int:
    checks = []
    project_url = None

    def record(name, ok, status):
        checks.append({"check": name, "ok": bool(ok), "status": status})

    def output():
        passed = bool(checks) and all(check["ok"] for check in checks)
        print(json.dumps({"checks": checks, "status": "passed" if passed else "failed",
                          "projectURL": project_url}, ensure_ascii=True))
        return 0 if passed else 1

    status, payload = request(f"{SITE_ORIGIN}/js/supabase-config.js", read_public_body=True, timeout=args.timeout)
    record("public_config_http", status == 200 and payload is not None, status)
    if status != 200 or payload is None:
        return output()
    try:
        config = parse_config(payload, args.expected_project_ref)
    except (ValueError, TypeError, AttributeError, UnicodeError):
        config = None
    record("expected_project_and_publishable_config", config is not None, "valid" if config else "invalid")
    if config is None:
        return output()
    project_url, publishable_key = config
    collector_url = f"{project_url}/functions/v1/collect-site-activity"
    public_headers = {"Origin": SITE_ORIGIN, "apikey": publishable_key}

    status, _ = request(collector_url, method="OPTIONS", headers={
        "Origin": SITE_ORIGIN, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, apikey",
    }, timeout=args.timeout)
    record("collector_allowed_preflight", status == 204, status)

    status, _ = request(collector_url, method="POST", headers={
        **public_headers, "Content-Type": "application/json",
    }, body=b"{}", timeout=args.timeout)
    record("collector_rejects_empty_payload_without_insert", status == 400, status)

    status, _ = request(collector_url, method="POST", headers={
        **public_headers, "Origin": "https://unauthorized-site.invalid", "Content-Type": "application/json",
    }, body=b"{}", timeout=args.timeout)
    record("collector_rejects_other_origin", status == 403, status)

    status, _ = request(collector_url, method="GET", headers=public_headers, timeout=args.timeout)
    record("collector_rejects_get", status == 405, status)

    # The publishable key alone carries no authenticated user's JWT.
    anonymous_headers = {"apikey": publishable_key, "Content-Type": "application/json"}
    status, _ = request(f"{project_url}/rest/v1/rpc/admin_get_site_activity", method="POST",
                        headers=anonymous_headers, body=b'{"p_days":1}', timeout=args.timeout)
    record("anonymous_admin_rpc_denied", status in (401, 403), status)

    status, _ = request(f"{project_url}/rest/v1/site_activity_events?select=event_id&limit=0",
                        headers={"apikey": publishable_key}, timeout=args.timeout)
    record("anonymous_activity_table_denied", status in (401, 403), status)

    if args.published:
        for path in ("js/site-activity.js", "js/site-activity-dashboard.js", "css/site-activity-dashboard.css"):
            status, payload = request(f"{SITE_ORIGIN}/{path}", read_public_body=True, timeout=args.timeout)
            matches = False
            if status == 200 and payload is not None:
                try:
                    matches = normalize_text(payload) == normalize_text((WORKSPACE / path).read_bytes())
                except (OSError, UnicodeError):
                    pass
            record(f"published_asset_matches_local:{path}", status == 200 and matches, status)

        for path in ("index.html", "pages/voluntariado.html", "pages/servicios.html", "pages/productos.html", "pages/nanas.html"):
            page_url = f"{SITE_ORIGIN}/{path}"
            status, payload = request(page_url, read_public_body=True, timeout=args.timeout)
            integrated = False
            if status == 200 and payload is not None:
                try:
                    parsed = IntegrationHTML(page_url)
                    parsed.feed(normalize_text(payload))
                    integrated = (parsed.scripts.count("/js/site-activity.js") == 1 and
                                  "/js/supabase-config.js" in parsed.scripts and
                                  parsed.scripts.index("/js/supabase-config.js") < parsed.scripts.index("/js/site-activity.js"))
                except (ValueError, UnicodeError):
                    pass
            record(f"published_public_html_integration:{path}", status == 200 and integrated, status)

        path = "pages/coordinacion-voluntariado.html"
        page_url = f"{SITE_ORIGIN}/{path}"
        status, payload = request(page_url, read_public_body=True, timeout=args.timeout)
        integrated = False
        if status == 200 and payload is not None:
            try:
                parsed = IntegrationHTML(page_url)
                parsed.feed(normalize_text(payload))
                integrated = ("/css/site-activity-dashboard.css" in parsed.styles and
                              parsed.scripts.count("/js/site-activity-dashboard.js") == 1 and
                              "/js/coordinacion-voluntariado.js" in parsed.scripts and
                              parsed.scripts.index("/js/site-activity-dashboard.js") < parsed.scripts.index("/js/coordinacion-voluntariado.js") and
                              parsed.hidden_activity_view and parsed.hidden_activity_content and parsed.activity_button)
            except (ValueError, UnicodeError):
                pass
        record("published_private_html_integration", status == 200 and integrated, status)

    return output()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-project-ref", required=True)
    parser.add_argument("--published", action="store_true", help="Compare published assets and HTML integrations with local code.")
    parser.add_argument("--timeout", type=float, default=15, help="Timeout in seconds for each HTTP request.")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]{20}", args.expected_project_ref) or not 0 < args.timeout <= 60:
        print(json.dumps({"checks": [{"check": "arguments", "ok": False, "status": "invalid"}],
                          "status": "failed", "projectURL": None}))
        return 1
    try:
        return run(args)
    except Exception:
        # Never emit a traceback containing request headers or response contents.
        print(json.dumps({"checks": [{"check": "verifier_execution", "ok": False, "status": "error"}],
                          "status": "failed", "projectURL": None}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
