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

The SQLite database (`vet_clinic.db`) and all seed data are created automatically on first startup.
Interactive API docs: http://localhost:8000/docs

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
