# VetClinic Scheduler — Setup

## Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The backend targets PostgreSQL (see `backend/database.py`); the default
`DATABASE_URL` expects the Postgres container from the root
`docker-compose.yml` (`docker compose up -d`). Copy `backend/.env.example`
to `backend/.env` and adjust as needed. On first startup the app runs
`alembic upgrade head` (full schema from `backend/alembic/versions/`, starting
at `000_schema_baseline`) and then seeds demo data when `ENVIRONMENT` is not
`production`. There is no SQLAlchemy `create_all` — Alembic owns the schema.
Interactive API docs: http://localhost:8000/docs (disabled when
`ENVIRONMENT=production`).

---

## Production checklist

This project's default configuration is tuned for local development. Before
running it anywhere reachable by untrusted traffic:

- Set `ENVIRONMENT=production` — disables demo-data seeding and the
  `/docs`/`/redoc`/`/openapi.json` endpoints, and makes the app refuse to
  start if `COOKIE_SECURE` isn't also `true`.
- Set `COOKIE_SECURE=true` (requires serving over HTTPS).
- Set a real `JWT_SECRET_KEY` — a long random value, e.g.
  `python -c "import secrets; print(secrets.token_urlsafe(48))"`. The app
  refuses to start with a missing/placeholder secret in any environment.
- Set `CORS_ORIGINS` to your actual frontend origin(s) — never `*`.
- Review `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` for
  your session-length requirements.
- Run `alembic upgrade head` (or let the app's startup hook do it) against
  the target database before serving traffic. Alembic is the **only** schema
  ownership path: revision `000_schema_baseline` creates the full table set
  (including `refresh_tokens`); later revisions are incremental and
  idempotent where possible. Do not rely on SQLAlchemy `create_all`.
  See `backend/alembic/versions/`.
- Existing databases already stamped at an older head (e.g. `004_*` / `005_*`)
  keep working: `upgrade head` applies only newer revisions. The baseline is
  an ancestor in the graph and is not re-run for already-stamped databases.
- Back up the database before upgrading. With the default Postgres setup:
  - Backup: `docker exec <db-container> pg_dump -U vetclinic vetclinic > backup.sql`
  - Restore: `docker exec -i <db-container> psql -U vetclinic vetclinic < backup.sql`

---

## Frontend

### 1. Scaffold Vite + React

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
```

### 2. Install Tailwind CSS

```bash
npm install -D tailwindcss @tailwindcss/vite
```

Add to `vite.config.js`:
```js
import tailwindcss from '@tailwindcss/vite'
export default { plugins: [tailwindcss()] }
```

Add to `src/index.css`:
```css
@import "tailwindcss";
```

### 3. Install shadcn/ui

```bash
npx shadcn@latest init
```

Accept defaults (style: Default, base color: Slate, CSS variables: yes).

Then add the components used by this project:

```bash
npx shadcn@latest add card select input button switch label badge dialog tabs
```

Also install lucide-react (peer dep already pulled by shadcn, but just in case):

```bash
npm install lucide-react
```

### 4. Copy source files

Replace `src/App.jsx` and add `src/components/BookingModal.jsx` and
`src/components/RuleBuilder.jsx` from this repo.

### 5. Run

```bash
npm run dev
```

Frontend: http://localhost:5173
