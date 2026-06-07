# Actual Budget Dashboard (Lean Node.js Migration)

A lightweight, single-process dashboard for **Actual Budget** built on a modern web stack. Fully replaces the previous Python/Streamlit/Node hybrid sidecar architecture with a high-performance **Node.js (Express + SQLite3)** backend and a responsive **React (Vite + TypeScript)** frontend.

---

## Features

- **Monthly Spending Analytics:** Real-time income and expense progress tracking.
- **Custom Cashflow Sankey Diagram:** Zero-dependency, responsive SVG-based Sankey visualizer that automatically stretches to screen width.
- **Budget Envelope Health:** Instant tracking of underbudget/underfunded envelopes for current and future months using official ActualQL queries.
- **Key Category Progress:** Real-time progress monitoring for customized day-to-day spending categories.
- **Investment Velocity:** Cumulative Year-to-Date (YTD) contribution velocity tracking for specialized accounts (e.g. TFSA).
- **Interactive Projections:** Dynamic compound growth charts (using Chart.js) for RESP, RRSP, and TFSA investment accounts with interactive rate/contribution sliders.
- **Inline Math Evaluator:** Parse and safely evaluate basic math expressions (e.g., `500+200-50`) in transaction entry/calculations without using unsafe JavaScript `eval`.

---

## Technical Architecture

The dashboard is run as a single process for simple hosting and minimal memory footprint:

1. **Backend (Express + TypeScript):**
   - Direct integration with `@actual-app/api` in a single Node process to sync your budget.
   - Leverages native `sqlite3` to perform direct read-only queries against the local synchronized SQLite database cache (`db.sqlite`) for complex aggregations.
   - Safe math tokenization and evaluation engine.
2. **Frontend (Vite + React + TypeScript):**
   - High-contrast, glassmorphic dark mode styling.
   - Built-in accessibility: Chart.js elements configured with high-contrast text rendering (`#cbd5e1`) and consistent typography.
   - Pure SVG Sankey flow layouts using `ResizeObserver` for mobile/responsive scaling.

---

## Local Development & Testing

### 1. Configure Environment Variables
Copy `.env.example` to `.env` in the root folder and configure the credentials:

```bash
# Actual Budget Server configuration
ACTUAL_SERVER_URL="https://your-actual-server-domain.com"
ACTUAL_PASSWORD="your-sync-server-password"
ACTUAL_SYNC_ID="your-budget-sync-id"
ACTUAL_ENCRYPTION_PASSWORD="your-optional-encryption-password"

# EVERYTHING BELOW THIS LINE IS OPTIONAL
# Dashboard Configurations
ACTUAL_TFSA_TRACKING=["⛱️🍸ATB TFSA", "⛱️🍸Wealthsimple TFSA"]
ACTUAL_BUDGET_TRACKING=["🥡 Eating Out", "🏬 Groceries", "🏢 Office Going Expenses", "⛽ Petrol"]

# RESP Forecast settings
ACTUAL_RESP_IDENTIFIER="RESP"
ACTUAL_RESP_HORIZON_YEARS=10
ACTUAL_RESP_DEFAULT_RETURN_PCT=4.0
ACTUAL_RESP_MONTHLY_CONTRIBUTION=400.0

# RRSP Forecast settings
ACTUAL_RRSP_IDENTIFIER="RRSP"
ACTUAL_RRSP_HORIZON_YEARS=30
ACTUAL_RRSP_DEFAULT_RETURN_PCT=8.0
ACTUAL_RRSP_ANNUAL_CONTRIBUTION=5000.0

# TFSA Forecast settings
ACTUAL_TFSA_HORIZON_YEARS=30
ACTUAL_TFSA_YTD_LIMIT=7000.0
ACTUAL_TFSA_ANNUAL_ROOM=7000.0

# Base TFSA (e.g. ATB TFSA)
ACTUAL_TFSA_BASE_IDENTIFIER="ATB TFSA"
ACTUAL_TFSA_BASE_DEFAULT_RETURN_PCT=4.0
ACTUAL_TFSA_BASE_MONTHLY_CONTRIBUTION=400.0

# Catchup TFSA (e.g. Wealthsimple TFSA)
ACTUAL_TFSA_CATCHUP_IDENTIFIER="WEALTHSIMPLE TFSA"
ACTUAL_TFSA_CATCHUP_DEFAULT_RETURN_PCT=8.0
ACTUAL_TFSA_CATCHUP_YEAR_CONTRIBUTION=0.0
```

### 2. Install & Run Dev Server
Install dependencies and run the backend/frontend servers concurrently:

```bash
npm install
npm run dev
```
Open your browser at `http://localhost:5173`.

---

## Deployment Options

### Docker Compose
Build and run the container locally using:
```bash
docker compose up -d --build
```
Access the dashboard on port `8501`.

### TrueNAS Deployment (No `.env` File)
A dedicated, self-contained template is available at docker-compose.truenas.yml
- All configuration keys are defined **inline** within the `environment:` block.
- Pre-configured to run under the user/group mapping `568:3002` (standard TrueNAS `apps` permissions) to prevent host dataset permission issues.

---

## Quality Assurance

We maintain code validation pipelines running on GitHub Actions:

- **Unit Tests:** `npm test` runs our safe mathematical expression parser tests using **Vitest**.
- **Compilation Check:** `npm run build` verifies type safety and compiles/bundles the frontend and backend assets.
