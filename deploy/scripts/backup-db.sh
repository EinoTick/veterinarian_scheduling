#!/usr/bin/env bash
# Backup Postgres from docker-compose.prod.yml into ./backups/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENV_FILE="${ENV_FILE:-.env.prod}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/vetclinic-${STAMP}.sql.gz"

echo "Dumping database to $OUT ..."
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$OUT"
echo "Done. Size: $(du -h "$OUT" | cut -f1)"
echo "Retention tip: keep daily dumps for at least 7 days; test restore quarterly."
