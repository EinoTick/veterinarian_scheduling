#!/usr/bin/env bash
# Restore a gzipped pg_dump into the prod compose database.
# WARNING: replaces all data in POSTGRES_DB.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env.prod}"
DUMP="${1:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "Usage: $0 path/to/vetclinic-YYYYMMDD.sql.gz" >&2
  exit 1
fi

echo "This will DROP and recreate the public schema, then restore from:"
echo "  $DUMP"
read -r -p "Type RESTORE to continue: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
  echo "Aborted."
  exit 1
fi

echo "Restoring..."
gunzip -c "$DUMP" | docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T db \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'

echo "Restarting API so migrations/startup re-check..."
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" restart api

echo "Waiting for readiness..."
for i in $(seq 1 30); do
  if curl -fsS "https://localhost/health/ready" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:8000/health/ready" >/dev/null 2>&1; then
    echo "Ready."
    exit 0
  fi
  sleep 2
done
echo "Restore finished but /health/ready not reachable yet — check api logs." >&2
exit 1
