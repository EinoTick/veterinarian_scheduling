# VetClinic Scheduler

Veterinarian appointment scheduling app with rule-based validation. FastAPI backend, React/Vite frontend, PostgreSQL database.

## Quick Start

Requires: Docker Desktop running, Python 3.11+, Node.js 18+

```
start.bat
```

This opens two new terminal windows (backend + frontend) and starts PostgreSQL in Docker. Give it ~5 seconds for the DB to be ready on first run.

| Service  | URL                          |
|----------|------------------------------|
| Frontend | http://localhost:5173        |
| Backend  | http://localhost:8000        |
| API docs | http://localhost:8000/docs   |

## Demo Credentials

| Role         | Email                        | Password      |
|--------------|------------------------------|---------------|
| System Admin | admin@vetclinic.com          | admin1234     |
| Clinic Admin | manager@riverside.com        | manager1234   |
| Vet / Staff  | sarah.chen@riverside.com     | password123   |

## Stopping

- **Frontend / Backend**: close the terminal windows
- **Database**: `docker compose down` (add `-v` to also delete data)

## First-Time Setup

If `.venv` or `node_modules` are missing, run these once:

```powershell
# Backend
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Frontend
cd ..\frontend
npm install
```

The database schema is applied automatically on backend startup via Alembic
(`alembic upgrade head`). Demo seed data is loaded when `ENVIRONMENT` is not
`production`.

## Production-like Docker stack

For API + SPA images, HTTPS edge proxy, secrets file, and a DB that is **not**
exposed on the host, see **[DEPLOY.md](./DEPLOY.md)**.

```powershell
copy .env.prod.example .env.prod
# edit secrets in .env.prod
.\deploy\scripts\gen-dev-certs.ps1
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d
```

Then open `https://localhost` (accept the self-signed certificate warning for local smoke tests).
