# Production deploy (Docker)

This document is the reference for **P0 deploy packaging**: API + SPA images,
HTTPS edge proxy, secrets via env file, and a database that is **not**
published to the host.

Local day-to-day development still uses `docker compose up -d` (Postgres only)
plus `start.bat` / Vite — see `README.md`.

---

## Topology

```
Browser ──HTTPS──► web (nginx) ──► api (uvicorn)
                      │               │
                      │               └──► db (Postgres, internal network only)
                      └── serves SPA + proxies /api and /health
```

- **Same origin**: the SPA calls `/api` with no `VITE_API_BASE`, so httpOnly
  cookies stay first-party.
- **TLS**: nginx terminates HTTPS. The API sets `TRUST_PROXY=true` and
  `COOKIE_SECURE=true`.
- **DB**: no `ports:` mapping on Postgres in `docker-compose.prod.yml`.

---

## One-time prep

### 1. Secrets file

```powershell
copy .env.prod.example .env.prod
```

Edit `.env.prod`:

- Set a strong `POSTGRES_PASSWORD`
- Set `JWT_SECRET_KEY` to a long random value:
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- Set `CORS_ORIGINS` to your public origin (e.g. `https://scheduler.example.com`
  or `https://localhost` for a local smoke test)
- Keep `TRUST_PROXY=true` and `COOKIE_SECURE=true` for this topology
- Keep `VITE_API_BASE` empty

`.env.prod` is gitignored.

### 2. TLS certificates

Place files at:

- `deploy/certs/fullchain.pem`
- `deploy/certs/privkey.pem`

**Local smoke test (self-signed):**

```powershell
.\deploy\scripts\gen-dev-certs.ps1
```

```bash
./deploy/scripts/gen-dev-certs.sh
```

These scripts use `openssl` when it is on `PATH`; otherwise they fall back to a
one-shot `alpine/openssl` Docker container (Docker Desktop must be running).

Browsers will warn on self-signed certs — that is expected.

**Real deployment:** use certificates from your CA, or terminate TLS at a cloud
load balancer / Traefik and adapt `deploy/nginx/default.conf` (or replace the
`web` service). Do not commit private keys.

### 3. Build and run

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
```

Open `https://localhost` (or your configured host).

Stop:

```powershell
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

Add `-v` only if you intend to wipe the production Postgres volume.

---

## Environment modes

| `ENVIRONMENT` | Seed demo data | `/docs` | Notes |
|---------------|----------------|---------|--------|
| `production`  | No             | Off     | Real deploy default in `.env.prod.example` |
| `development` | Yes (if empty) | On      | Optional for local packaging smoke tests **with** `COOKIE_SECURE=true` behind HTTPS |

`ENVIRONMENT=production` refuses to start unless `COOKIE_SECURE=true`.

---

## First admin on a fresh production database

With `ENVIRONMENT=production`, demo users are **not** seeded. After schema
migrations run on API startup you must provision the first clinic/admin out of
band (SQL, a future bootstrap command, or a one-time controlled seed). Do not
leave demo passwords on an internet-facing host.

---

## Operations notes

- **Backups:** use `deploy/scripts/backup-db.sh` (or `.ps1`) against
  `docker-compose.prod.yml`. Keep daily dumps **≥ 7 days**.
- **Restore drill (quarterly):**
  1. Take a fresh backup.
  2. Restore onto a staging stack with `deploy/scripts/restore-db.sh` / `.ps1`.
  3. Confirm `GET /health/ready`, admin login, bookings list, and row counts.
  4. Record date/operator in your ops log.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api web`
- **Health:**
  - `GET /health/live` — process up (Docker API HEALTHCHECK)
  - `GET /health/ready` — DB reachable (load balancers / `https://<host>/health`)
  - Edge `web` container still exposes `/healthz` (nginx only)
- **Privacy:** see `PRIVACY.md` for export/erase and retention.
- **Scaling:** set `RATE_LIMIT_BACKEND=redis` and `REDIS_URL` (add a Redis
  service on the internal network) before running multiple API replicas.
  Default `memory` backend is single-worker only.
- Logout / password reset / user deactivate / role change bump
  `users.session_version` so access JWTs fail immediately, not only after TTL.
- **Double-booking:** only `scheduled` appointments block a slot;
  `completed` / `no_show` / `cancelled` do not.
- **Dev compose** (`docker-compose.yml`) still publishes Postgres `:5432` for
  local uvicorn; never reuse that file as a public production deploy.

---

## Files

| Path | Role |
|------|------|
| `backend/Dockerfile` | API image (`/health/live` HEALTHCHECK) |
| `frontend/Dockerfile` | SPA build + nginx edge |
| `deploy/nginx/default.conf` | TLS, SPA, `/api` + health proxies |
| `docker-compose.prod.yml` | Full stack |
| `.env.prod.example` | Secrets template |
| `deploy/scripts/gen-dev-certs.*` | Self-signed cert helper |
| `deploy/scripts/backup-db.*` / `restore-db.*` | Backup & restore drill |
| `.github/workflows/ci.yml` | Lint/build/import smoke |
| `PRIVACY.md` | GDPR export/erase + retention |
