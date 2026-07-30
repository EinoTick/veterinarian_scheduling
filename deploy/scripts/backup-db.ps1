# Backup Postgres from docker-compose.prod.yml into .\backups\
# Compresses inside the container, then copies the binary .sql.gz out (avoids
# PowerShell text encoding corrupting the dump).
param(
  [string]$EnvFile = ".env.prod",
  [string]$BackupDir = ""
)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root
if (-not $BackupDir) { $BackupDir = Join-Path $Root "backups" }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMddTHHmmssZ"
$FileName = "vetclinic-$Stamp.sql.gz"
$Out = Join-Path $BackupDir $FileName
$Remote = "/tmp/$FileName"

Write-Host "Dumping database to $Out ..."
docker compose -f docker-compose.prod.yml --env-file $EnvFile exec -T db `
  sh -c "pg_dump -U `"`$POSTGRES_USER`" `"`$POSTGRES_DB`" | gzip -c > $Remote"
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)" }

docker compose -f docker-compose.prod.yml --env-file $EnvFile cp "db:$Remote" $Out
if ($LASTEXITCODE -ne 0) { throw "docker compose cp failed (exit $LASTEXITCODE)" }

docker compose -f docker-compose.prod.yml --env-file $EnvFile exec -T db rm -f $Remote | Out-Null
Write-Host "Done."
Write-Host "Retention tip: keep daily dumps for at least 7 days; test restore quarterly."
