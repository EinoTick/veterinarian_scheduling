#!/usr/bin/env bash
# Generate self-signed TLS certs for local production-compose smoke tests.
# Prefers openssl on PATH; otherwise uses a one-shot Docker openssl container.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/deploy/certs"
mkdir -p "$OUT"

gen_with_openssl() {
  local bin="$1"
  "$bin" req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$OUT/privkey.pem" \
    -out "$OUT/fullchain.pem" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
}

if command -v openssl >/dev/null 2>&1; then
  gen_with_openssl openssl
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$OUT:/certs" alpine/openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout /certs/privkey.pem \
    -out /certs/fullchain.pem \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
else
  echo "Neither openssl nor docker is available." >&2
  exit 1
fi

chmod 600 "$OUT/privkey.pem" 2>/dev/null || true
echo "Wrote $OUT/fullchain.pem and $OUT/privkey.pem"
echo "Browse https://localhost (accept the browser warning for self-signed certs)."
