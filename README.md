# Actual Budget Dashboard

> [!IMPORTANT]
> This solution is explicitly **vibe-coded**—designed and built entirely through interactive AI agent pair programming.

A lightweight, single-process dashboard for **Actual Budget**. It features a modern, responsive **React (Vite + TypeScript)** frontend styled with a premium glassmorphic dark theme and a high-performance **Node.js (Express + SQLite3)** backend.

---

## Functionality

- **Monthly Spending Analytics:** Real-time progress tracking for income and expenses.
- **Custom Cashflow Sankey:** Zero-dependency, responsive, pure SVG-based cashflow visualization.
- **Budget Envelope Health:** Direct monitoring of underbudget/underfunded categories for current and future months.
- **Yearly Room & TFSA Contributions:** Progress monitoring of YTD contributions relative to YTD Limit and Total Room.
- **Interactive Investment Projections:** Compound interest growth models for RESP, RRSP, and TFSA accounts with live projection adjustment sliders.
- **Safe Math Evaluator:** Built-in calculation engine that parses and safely evaluates simple mathematical expressions (e.g. `100+50-10`) without calling unsafe `eval`.

---

## Architecture

The dashboard runs as a single process for lightweight hosting and a minimal resource footprint:

- **Backend (Express + TypeScript):** Synchronizes with the budget via the official `@actual-app/api` and queries the local synchronized SQLite cache (`db.sqlite`) directly to aggregate metrics.
- **Frontend (Vite + React + TypeScript):** Served statically by the backend in production. Renders interactive charts using Chart.js and maps responsive layouts dynamically based on environment configurations.

---

## Development & Deployment

### Dev Environment (Nix Shell)
A Nix development flake is included for a fully isolated, self-contained workspace. Activate the environment:
```bash
nix develop
# or
nix-shell
```

### Configuration
Configure credentials and optional tracking settings in a root `.env` file (see `.env.example`):
```ini
ACTUAL_SERVER_URL="https://your-actual-server.com"
ACTUAL_PASSWORD="your-sync-password"
ACTUAL_SYNC_ID="your-budget-sync-id"
ACTUAL_TFSA_TOTAL_ROOM=7000.0
ACTUAL_TFSA_YTD_LIMIT=7000.0
```

### Local Dev Server
Install dependencies and spin up both backend and frontend concurrently:
```bash
npm install
npm run dev
```
Open `http://localhost:5173` in a web browser.

### Quality Assurance
- **Unit Tests:** `npm test` runs vitest suites verifying safe math evaluator parsing.
- **Compilation Check:** `npm run build` compiles and validates the entire TypeScript pipeline.

### Docker Deployment
Build and run the container locally:
```bash
docker compose up -d --build
```
Access the dashboard on port `8501`. A TrueNAS-specific configuration template is also available in docker-compose.truenas.yml

### Screenshots

<img width="3694" height="2097" alt="Screenshot_20260607_163626" src="https://github.com/user-attachments/assets/003049fd-2b9e-4a7c-97d1-4578682f7108" />

<img width="3694" height="1067" alt="Screenshot_20260607_163906" src="https://github.com/user-attachments/assets/e0c59cad-472d-4443-a5f3-3d11c4ccc890" />

<img width="1248" height="700" alt="Screenshot_20260607_164014" src="https://github.com/user-attachments/assets/712bc148-26aa-4d42-8d7a-d8baf155874c" />

<img width="3694" height="1653" alt="Screenshot_20260607_164114" src="https://github.com/user-attachments/assets/d81c5aaa-c734-44e3-8934-3a632273fe90" />

<img width="3694" height="1969" alt="Screenshot_20260607_164204" src="https://github.com/user-attachments/assets/4e92dad6-5488-499d-b2cc-e26d0a0639e6" />



