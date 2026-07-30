# Restore a gzipped SQL dump into the prod compose database.
# WARNING: replaces data in POSTGRES_DB.
param(
  [Parameter(Mandatory = $true)][string]$DumpPath,
  [string]$EnvFile = ".env.prod"
)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root
if (-not (Test-Path $DumpPath)) { throw "Dump not found: $DumpPath" }

Write-Host "This will restore into the compose database from:`n  $DumpPath"
$confirm = Read-Host "Type RESTORE to continue"
if ($confirm -ne "RESTORE") { Write-Host "Aborted."; exit 1 }

Write-Host "Restoring (pipe gunzip via Docker alpine)..."
Get-Content -AsByteStream $DumpPath | docker run --rm -i alpine sh -c "gzip -dc" |
  docker compose -f docker-compose.prod.yml --env-file $EnvFile exec -T db `
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'

docker compose -f docker-compose.prod.yml --env-file $EnvFile restart api
Write-Host "Restore submitted. Verify: curl https://localhost/health/ready"
Write-Host "Quarterly drill checklist: backup → restore on staging → login → open bookings → confirm row counts."
