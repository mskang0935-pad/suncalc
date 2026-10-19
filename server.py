#!/usr/bin/env python3
"""SUNCALC — 태양광 발전·경제성 웹 서비스"""

from __future__ import annotations

import json
import mimetypes
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
sys.path.insert(0, str(ROOT))

from lib.solar import DEFAULTS, REGIONS, CalculationError, calculate  # noqa: E402

HOST = "127.0.0.1"
PORT = 3000


class SunCalcHandler(BaseHTTPRequestHandler):
    server_version = "SUNCALC/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise CalculationError(["JSON 형식이 올바르지 않습니다."]) from exc
        if not isinstance(data, dict):
            raise CalculationError(["요청 본문은 JSON 객체여야 합니다."])
        return data

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path

        if path == "/api/health":
            self._json(
                200,
                {
                    "ok": True,
                    "service": "SUNCALC",
                    "version": "1.0.0",
                    "time": datetime.now(timezone.utc).isoformat(),
                },
            )
            return

        if path == "/api/regions":
            self._json(200, {"regions": REGIONS})
            return

        if path == "/api/defaults":
            self._json(200, {"defaults": DEFAULTS, "regions": REGIONS})
            return

        if path.startswith("/api/"):
            self._json(404, {"ok": False, "message": "API를 찾을 수 없습니다."})
            return

        self._serve_static(path)

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path != "/api/calculate":
            self._json(404, {"ok": False, "message": "API를 찾을 수 없습니다."})
            return

        try:
            payload = self._read_json()
            result = calculate(payload)
            self._json(200, {"ok": True, **result})
        except CalculationError as exc:
            self._json(400, {"ok": False, "message": str(exc), "errors": exc.errors})
        except Exception as exc:  # noqa: BLE001
            self._json(500, {"ok": False, "message": f"서버 오류: {exc}"})

    def _serve_static(self, path: str) -> None:
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        target = (PUBLIC / rel).resolve()

        if not str(target).startswith(str(PUBLIC.resolve())):
            self._json(403, {"ok": False, "message": "접근이 거부되었습니다."})
            return

        if target.is_dir():
            target = target / "index.html"

        if not target.exists() or not target.is_file():
            # SPA fallback
            target = PUBLIC / "index.html"
            if not target.exists():
                self._send(404, b"Not Found", "text/plain; charset=utf-8")
                return

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in (
            "application/javascript",
            "application/json",
        ):
            content_type = f"{content_type}; charset=utf-8"

        self._send(200, target.read_bytes(), content_type)


def main() -> None:
    if not PUBLIC.exists():
        raise SystemExit(f"public 폴더가 없습니다: {PUBLIC}")

    server = ThreadingHTTPServer((HOST, PORT), SunCalcHandler)
    print(f"SUNCALC web service running at http://{HOST}:{PORT}")
    print("종료하려면 Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
        server.server_close()


if __name__ == "__main__":
    main()
