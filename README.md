# actual-dashboard

~ 70% vibe-coded for my use with Gemini 3.1 Pro

Feel Free to fork it for your own use, I have paramterized as much as I can

---

## Features

- Monthly Spending Analytics: Monthly expenses are aggregated and visualized. A sortable transaction log and an Altair-powered spending bar chart are dynamically generated for any selected month.

- Envelope Health Checks: Underfunded budget amounts for the current month and the next two consecutive months are calculated and displayed with color-coded alerts. This is achieved by securely fetching the Actual Budget SQLite database export in-memory and querying the internal envelope goals.

- Contribution Tracking: Year-to-date (YTD) investment contributions are tracked against an adjustable annual limit. Contribution velocity is charted over time, and progress is visually represented via dynamic metric columns.

- Interactive Investment Forecasting: Tabbed forecasting models are available for various investment vehicles (e.g., RESP, RRSP, TFSA). Interactive sliders allow the expected Year-over-Year (YoY) return percentage to be adjusted in real-time. Current, halfway, and final projected balances are calculated automatically based on parameterized contribution horizons, expected returns, and custom catch-up rules.
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

# ... see app.py for all required sections (rrsp, tfsa, categories)
```

### 2. Run via Nix (Recommended)
If you use Nix, the environment is fully automated:

```bash
nix-shell
streamlit run app.py
```
The shell hook will automatically install the `@actual-app/cli` into a local `.npm-global` folder and add it to your path.

### 3. Run via Docker
To run the dashboard in a containerized environment:

```bash
docker-compose up --build
```
The dashboard will be available at `http://localhost:8501`.
