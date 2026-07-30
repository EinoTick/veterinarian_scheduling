# Generate self-signed TLS certs for local production-compose smoke tests.
# Prefers openssl on PATH; otherwise uses a one-shot Docker openssl container.
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$OutDir = Join-Path $RepoRoot "deploy\certs"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Key = Join-Path $OutDir "privkey.pem"
$Cert = Join-Path $OutDir "fullchain.pem"

function Invoke-OpenSslCerts {
  param([string]$OpenSslExe)
  & $OpenSslExe req -x509 -nodes -newkey rsa:2048 -days 825 `
    -keyout $Key `
    -out $Cert `
    -subj "/CN=localhost" `
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  if ($LASTEXITCODE -ne 0) { throw "openssl failed with exit $LASTEXITCODE" }
}

$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if ($openssl) {
  Invoke-OpenSslCerts -OpenSslExe $openssl.Source
} else {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw "Neither openssl nor docker is available. Install OpenSSL, or start Docker Desktop and re-run."
  }
  # Mount deploy/certs and write PEM files via alpine/openssl (no host OpenSSL needed).
  $mount = "${OutDir}:/certs"
  docker run --rm -v $mount alpine/openssl req -x509 -nodes -newkey rsa:2048 -days 825 `
    -keyout /certs/privkey.pem `
    -out /certs/fullchain.pem `
    -subj "/CN=localhost" `
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
  if ($LASTEXITCODE -ne 0) { throw "docker openssl failed with exit $LASTEXITCODE" }
}

Write-Host "Wrote $Cert and $Key"
Write-Host "Browse https://localhost (accept the browser warning for self-signed certs)."
