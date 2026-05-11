# Actual Budget Dashboard

~ 70% vibe-coded for my use with Gemini 3.1 Pro

Feel free to fork it for your own use; I have parameterized as much as I can.

---

## Features

- **Monthly Spending Analytics:** Monthly expenses are aggregated by category and visualized using interactive Plotly Sankey diagrams.
- **Budget Health Tracking:** Real-time monitoring of underfunded envelopes for current and future months using official ActualQL queries.
- **Investment Progress:** Year-to-Date (YTD) contribution tracking for specialized accounts (e.g., TFSA).
- **Interactive Forecasting:** Dynamic forecasting for investment horizons (RESP, RRSP, TFSA), allowing for real-time adjustment of expected YoY returns.
- **Historical Net Worth:** Anchored tracking of total wealth across all accounts (on-budget and off-budget) over your entire budget history.
- **Advanced Analytics:** MTD-normalized comparisons and hierarchical spending Treemaps.

---

## Technical Architecture

This dashboard uses a **Hybrid Sidecar Architecture** to provide high performance while bypassing server-side rate limits:

1.  **Node.js Sidecar (`actual-helper.js`):** A lightweight helper that uses the official `@actual-app/api` to establish a single persistent session. It synchronizes your budget to a local cache and fetches a comprehensive data snapshot in one batch.
2.  **Python Data Layer (`data.py`):** Invokes the sidecar once per hour (via a high-TTL cache) and performs precise analytical queries against the local synchronized SQLite database.
3.  **Streamlit UI (`app.py`):** A modern, reactive interface built for rapid financial exploration.

---

## Local Development & Testing

### 1. Configure Secrets
Create a `.streamlit/secrets.toml` file in the project root with your Actual Budget credentials:

```toml
ACTUAL_SERVER_URL = "https://your-actual-server.com"
ACTUAL_PASSWORD   = "your-server-password" # or session token
ACTUAL_SYNC_ID    = "your-budget-sync-id"
# ACTUAL_ENCRYPTION_PASSWORD = "..." # (Optional) if E2E is enabled

[resp]
identifier = "RESP"
default_return_pct = 5.0
horizon_years = 18
monthly_contribution = 200

[rrsp]
identifier = "RRSP"
default_return_pct = 6.0
horizon_years = 25
annual_contribution = 5000

[tfsa]
horizon_years = 20
annual_room = 7000
[tfsa.base]
identifier = "Wealthsimple"
default_return_pct = 5.5
monthly_contribution = 500
[tfsa.catchup]
identifier = "Questrade"
default_return_pct = 7.0
catchup_year_contribution = 10000

[categories]
tfsa_tracking = ["TFSA Contribution"]
budget_tracking = ["Groceries", "Rent", "Utilities"]
```

### 2. Run via Nix (Recommended)
If you use Nix, the environment is fully automated and isolated:

```bash
nix-shell
streamlit run app.py
```
The shell hook will automatically install Node.js dependencies and provide a pre-configured Python 3.12 environment with `ruff` and `pytest` available.

### 3. Run via Docker
To run the dashboard in a containerized production environment:

```bash
docker-compose up --build
```
The dashboard will be available at `http://localhost:8501`.

---

## Quality Assurance

The project maintains a rigorous quality bar enforced via CI:

- **Linting:** `ruff check .`
- **Testing:** `pytest --cov=. tests/`
- **Contract Validation:** `node actual-helper.js --smoke-init`
