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

The database schema and seed data are created automatically on first backend startup.
