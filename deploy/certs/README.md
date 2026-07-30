# Place TLS material here (gitignored). Required for docker-compose.prod.yml.
#
# Generate a local self-signed cert for smoke tests:
#
#   PowerShell:  .\deploy\scripts\gen-dev-certs.ps1
#   Bash:        ./deploy/scripts/gen-dev-certs.sh
#
# Scripts use host `openssl` when available; otherwise `docker run alpine/openssl`.
#
# Expected files:
#   fullchain.pem  — certificate (and chain if any)
#   privkey.pem    — private key
#
# For real deployments, replace these with certificates from your CA or
# terminate TLS at a cloud load balancer / Traefik and adjust the nginx
# config accordingly (see DEPLOY.md).
