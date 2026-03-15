# actual-dashboard

~ 70% vibe-coded for my use with Gemini 3.1 Pro

Feel Free to fork it for your own use, I have paramterized as much as I can

---

## Features

- Monthly Spending Analytics: Monthly expenses are aggregated and visualized. A sortable transaction log and an Altair-powered spending bar chart are dynamically generated for any selected month.

- Envelope Health Checks: Underfunded budget amounts for the current month and the next two consecutive months are calculated and displayed with color-coded alerts. This is achieved by securely fetching the Actual Budget SQLite database export in-memory and querying the internal envelope goals.

- Contribution Tracking: Year-to-date (YTD) investment contributions are tracked against an adjustable annual limit. Contribution velocity is charted over time, and progress is visually represented via dynamic metric columns.

- Interactive Investment Forecasting: Tabbed forecasting models are available for various investment vehicles (e.g., RESP, RRSP, TFSA). Interactive sliders allow the expected Year-over-Year (YoY) return percentage to be adjusted in real-time. Current, halfway, and final projected balances are calculated automatically based on parameterized contribution horizons, expected returns, and custom catch-up rules.