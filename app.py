"""
Actual Budget Dashboard — Streamlit UI layer.

All data fetching lives in data.py; all business logic lives in transforms.py.
This file is responsible only for layout, widgets, and rendering.
"""

import calendar as cal_lib
from datetime import datetime

import altair as alt
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from dateutil.relativedelta import relativedelta

from data import (
    fetch_all_dashboard_data,
    fetch_underbudgeted_amounts,
    get_investment_balances,
    get_month_budgets,
    get_onbudget_transactions,
)
from transforms import (
    COLOR_GREEN,
    COLOR_GREEN_BG,
    COLOR_RED,
    COLOR_RED_BG,
    FORECAST_CHART_HEIGHT_PX,
    SANKEY_HEIGHT_PX,
    build_category_bar_html,
    build_forecast_data,
    build_net_worth_series,
    build_progress_bar_html,
    build_sankey_data,
    calculate_budget_pacing,
    calculate_milestone_months,
    calculate_mom_metrics,
    calculate_yoy_metrics,
    parse_math_input,
    split_income_expenses,
)

# --- Page Config ---
st.set_page_config(page_title="Actual Budget Dashboard", layout="wide")


# --- Startup: validate critical secrets ---
_REQUIRED_SECRETS = ["ACTUAL_SERVER_URL", "ACTUAL_PASSWORD", "ACTUAL_SYNC_ID"]
_REQUIRED_SECTIONS = ["resp", "rrsp", "tfsa", "categories"]

for key in _REQUIRED_SECRETS:
    if key not in st.secrets:
        st.error(f"Missing required secret: '{key}'. Check your secrets.toml.")
        st.stop()

for section in _REQUIRED_SECTIONS:
    if section not in st.secrets:
        st.error(
            f"Missing required secrets section: '[{section}]'. Check your secrets.toml."
        )
        st.stop()


# --- Constants ---
CURRENT_YEAR = datetime.now().year


# --- Shared Chart Renderers ---
def render_forecast_chart(
    forecast_data: list,
    current_year: int,
    years_to_track: int,
    total_current: float,
    total_halfway: float,
    total_final: float,
):
    """Shared logic for rendering investment line charts with milestones."""
    halfway_offset = years_to_track // 2

    mc1, mc2, mc3 = st.columns(3)
    mc1.metric("Current Total", f"${total_current:,.2f}")
    mc2.metric(
        f"Halfway Projection ({current_year + halfway_offset})",
        f"${total_halfway:,.2f}",
    )
    mc3.metric(
        f"Final Projection ({current_year + years_to_track})",
        f"${total_final:,.2f}",
    )

    df_forecast = pd.DataFrame(forecast_data)

    base = alt.Chart(df_forecast).encode(
        x=alt.X("Year:O", axis=alt.Axis(labelAngle=-45, title="Year")),
        y=alt.Y(
            "Projected Balance:Q",
            axis=alt.Axis(format="$,.0f", title="Balance"),
        ),
        color=alt.Color("Account:N", legend=alt.Legend(orient="bottom", title=None)),
    )

    line = base.mark_line(point=True, strokeWidth=3).encode(
        tooltip=[
            alt.Tooltip("Year:O"),
            alt.Tooltip("Account:N"),
            alt.Tooltip("Projected Balance:Q", format="$,.2f", title="Balance"),
        ]
    )
    text = base.mark_text(
        align="left",
        baseline="middle",
        dx=8,
        dy=-10,
        fontSize=12,
        fontWeight="bold",
    ).encode(text="Label:N")

    chart = (line + text).properties(height=FORECAST_CHART_HEIGHT_PX).interactive()
    st.altair_chart(chart, width="stretch")


def render_forecast_section(
    title: str,
    account_dict: dict,
    years_to_track: int,
    return_rate: float,
    annual_contribution: float = 0,
):
    """High-level wrapper for an investment category (e.g. RRSP)."""
    if not account_dict:
        st.info("No accounts found for this category.")
        return

    st.subheader(title)

    forecast_data, total_current, total_halfway, total_final = build_forecast_data(
        account_dict,
        years_to_track,
        CURRENT_YEAR,
        return_rate_fn=lambda _name: return_rate,
        contribution_fn=lambda _name, _offset: annual_contribution,
    )

    render_forecast_chart(
        forecast_data,
        CURRENT_YEAR,
        years_to_track,
        total_current,
        total_halfway,
        total_final,
    )


# --- Main Dashboard ---
st.title("Actual Budget Dashboard")

with st.spinner("Fetching unified budget data..."):
    all_data = fetch_all_dashboard_data()

if all_data.get("error"):
    st.error(f"Failed to load data: {all_data['error']}")
    st.stop()

# Extract on-budget transactions for filtering
df = get_onbudget_transactions(all_data)

if df.empty:
    st.warning("No transaction data available.")
    st.stop()

# --- Sidebar Filters ---
st.sidebar.header("Global Filters")

# Date Range Filter
min_date = df["date"].min().date()
today = datetime.now().date()
data_max = df["date"].max().date()

# P0-Y Fix: ensure today is selectable while tolerating future transactions
max_date = max(data_max, today)
default_end = min(today, max_date)
default_start = min(today.replace(day=1), default_end)

date_range = st.sidebar.date_input(
    "Date Range",
    value=(default_start, default_end),
    min_value=min_date,
    max_value=max_date,
)

# Standardize reference date for metrics and pacing early to avoid NameErrors
if isinstance(date_range, tuple) and len(date_range) == 2:
    current_date_ref = datetime.combine(date_range[1], datetime.min.time())
else:
    current_date_ref = datetime.now()

# Category Filter
all_categories = sorted(df["Category_Name"].unique())
selected_categories = st.sidebar.multiselect(
    "Categories", options=all_categories, default=all_categories
)

# Payee Filter
all_payees = sorted(df["Payee_Name"].unique())
selected_payees = st.sidebar.multiselect(
    "Payees", options=all_payees, default=all_payees
)

# Apply Filters
mask = df["Category_Name"].isin(selected_categories) & df["Payee_Name"].isin(
    selected_payees
)
if isinstance(date_range, tuple) and len(date_range) == 2:
    start_date, end_date = date_range
    mask &= (df["date"].dt.date >= start_date) & (df["date"].dt.date <= end_date)
elif not isinstance(date_range, tuple):
    mask &= df["date"].dt.date == date_range

df_filtered = df[mask].copy()

# Tabs for different views
tab_overview, tab_net_worth, tab_investments, tab_advanced = st.tabs(
    ["📊 Monthly Overview", "📈 Net Worth", "💰 Investments", "📉 Advanced Analytics"]
)

with tab_overview:
    # ── Monthly Overview ──────────────────────────────────────────────────────────
    st.subheader("Monthly Overview")

    if not df_filtered.empty:  # Consolidated Guard (4.6)
        df_income, df_expenses = split_income_expenses(df_filtered)

        total_income = round(df_income["amount"].sum(), 2)
        total_spent = round(df_expenses["amount"].sum(), 2)
        net_income = round(total_income - total_spent, 2)

        col_inc, col_exp, col_net, col_forecast = st.columns(4)

        with col_inc:
            st.metric("Actual Income", f"${total_income:,.2f}")
            add_inc_str = st.text_input(
                "Forecasted Income (e.g. 500+200)", value="0", key="add_inc"
            )
            expected_income = round(total_income + parse_math_input(add_inc_str), 2)

        with col_exp:
            st.metric("Actual Expenses", f"${total_spent:,.2f}")
            add_exp_str = st.text_input(
                "Forecasted Expense (e.g. 100+50)", value="0", key="add_exp"
            )
            expected_expenses = round(total_spent + parse_math_input(add_exp_str), 2)

        with col_net:
            if total_income > 0:
                savings_rate = round((net_income / total_income) * 100, 2)
                savings_delta = f"{savings_rate:.1f}% savings rate"
            else:
                savings_delta = None
            st.metric(
                "Actual Net",
                f"${net_income:,.2f}",
                delta=savings_delta,
                delta_color="normal",
            )

        with col_forecast:
            forecast_net = round(expected_income - expected_expenses, 2)
            if expected_income > 0:
                forecast_savings_rate = round((forecast_net / expected_income) * 100, 2)
                forecast_delta = f"{forecast_savings_rate:.1f}% expected savings"
            else:
                forecast_delta = None
            st.metric(
                "Expected Net",
                f"${forecast_net:,.2f}",
                delta=forecast_delta,
                delta_color="normal",
            )

        # ── Income / Expense Progress Bars ───────────────────────────────────────────
        max_expected = max(expected_income, expected_expenses, 1.0)
        inc_pct = min((total_income / max_expected) * 100, 100.0)
        exp_pct = min((total_spent / max_expected) * 100, 100.0)

        inc_bar = build_progress_bar_html(
            inc_pct,
            COLOR_GREEN,
            COLOR_GREEN_BG,
            "rgba(40,167,69,0.3)",
            "Income",
            f"${total_income:,.2f}",
            f"${expected_income:,.0f}",
        )
        exp_bar = build_progress_bar_html(
            exp_pct,
            COLOR_RED,
            COLOR_RED_BG,
            "rgba(220,53,69,0.3)",
            "Expenses",
            f"${total_spent:,.2f}",
            f"${expected_expenses:,.0f}",
        )

        st.markdown(
            f'<div style="margin-bottom: 25px;">{inc_bar}{exp_bar}</div>',
            unsafe_allow_html=True,
        )

        # ── Envelope Health Checks ───────────────────────────────────────────────────
        st.subheader("Future Envelope Health")
        underbudget_data, target_months, underbudget_error = (
            fetch_underbudgeted_amounts(all_data)
        )
        if underbudget_error:
            st.warning(underbudget_error)

        m_cols = st.columns(3)
        for i, m_obj in enumerate(target_months):
            m_str = m_obj.strftime("%Y%m")
            m_label = m_obj.strftime("%b %Y")
            val = underbudget_data.get(m_str, 0.0)

            if val > 0:
                m_cols[i].metric(
                    label=f"Underfunded ({m_label})",
                    value=f"${val:,.2f}",
                    delta="Action Required",
                    delta_color="inverse",
                )
            else:
                m_cols[i].metric(
                    label=f"Underfunded ({m_label})",
                    value=f"${val:,.2f}",
                    delta="Fully Funded",
                    delta_color="normal",
                )

        st.markdown("---")

        # ── Budgeted vs Spent (Key Categories) ──────────────────────────────────────
        st.subheader("Key Category Tracking")

        tracked_categories = st.secrets["categories"].get("budget_tracking", [])

        if tracked_categories:
            db_month_str = df_filtered["date"].max().strftime("%Y-%m")
            monthly_budgets = get_month_budgets(all_data, db_month_str)

            for cat in tracked_categories:
                budgeted = monthly_budgets.get(cat, 0.0)
                spent = df_expenses[df_expenses["Category_Name"] == cat]["amount"].sum()
                st.markdown(
                    build_category_bar_html(cat, spent, budgeted),
                    unsafe_allow_html=True,
                )
        else:
            st.info("No budget tracking categories defined in secrets.toml.")

        st.markdown("---")

        # ── Sankey Diagram ───────────────────────────────────────────────────────────
        st.subheader("Monthly Cashflow (Income & Expenses)")

        inc_summary = (
            df_income.groupby("Category_Name")["amount"]
            .sum()
            .reset_index()
            .query("amount > 0")
            .sort_values("amount", ascending=False)
        )
        exp_summary = (
            df_expenses.groupby("Category_Name")["amount"]
            .sum()
            .reset_index()
            .query("amount > 0")
            .sort_values("amount", ascending=False)
        )

        sankey = build_sankey_data(inc_summary, exp_summary)

        if sankey:
            fig = go.Figure(
                data=[
                    go.Sankey(
                        valueformat="$,.2f",
                        node=dict(
                            pad=20,
                            thickness=20,
                            line=dict(color="rgba(0,0,0,0)", width=0),
                            label=sankey["display_labels"],
                            color=sankey["node_colors"],
                            hovertemplate=(
                                "%{label}<br>Total: %{value:$,.2f}<extra></extra>"
                            ),
                        ),
                        link=dict(
                            source=sankey["source"],
                            target=sankey["target"],
                            value=sankey["values"],
                            color=sankey["link_colors"],
                            hovertemplate=(
                                "Source: %{source.label}<br>"
                                "Target: %{target.label}<br>"
                                "Amount: %{value:$,.2f}<extra></extra>"
                            ),
                        ),
                    )
                ]
            )
            fig.update_layout(
                margin=dict(l=0, r=0, t=20, b=20),
                height=SANKEY_HEIGHT_PX,
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                font=dict(size=13),
            )
            st.plotly_chart(fig, width="stretch")
        else:
            st.info("No income or expense data found to chart for this selection.")

        st.markdown("---")

        # ── Transaction Log ──────────────────────────────────────────────────────────
        st.subheader("Transaction Log")
        display_df = df_filtered[
            ["date", "Payee_Name", "Category_Name", "amount"]
        ].copy()
        display_df = display_df.sort_values(by="date", ascending=False)
        display_df["date"] = display_df["date"].dt.strftime("%Y-%m-%d")
        st.dataframe(display_df, width="stretch", hide_index=True)
    else:
        st.info("No transactions found for the current filters.")

with tab_net_worth:
    st.subheader("Historical Net Worth")
    # All transactions already fetched in all_data
    # Correctness Fix P1-3: Anchor on current known balances
    # (using balance_current from API)
    # Note: balance_current is returned in integer cents by the Actual API. (4.5)
    current_assets = round(
        sum(
            (acc.get("balance_current") or 0)
            for acc in all_data.get("accounts", [])
            if not acc.get("closed")
        )
        / 100.0,
        2,
    )
    df_nw = build_net_worth_series(all_data["transactions"], current_assets)

    if not df_nw.empty:
        # Display current net worth
        current_nw = df_nw.iloc[-1]["net_worth"]
        prev_nw = df_nw.iloc[-2]["net_worth"] if len(df_nw) > 1 else current_nw
        nw_delta = round(current_nw - prev_nw, 2)

        # Pass numeric delta to st.metric for robust formatting
        st.metric(
            "Current Net Worth",
            f"${current_nw:,.2f}",
            delta=nw_delta,
            delta_color="normal",
            help="Change vs previous month-end balance. (P2-6)",
        )

        # Net Worth Line Chart
        nw_chart = (
            alt.Chart(df_nw)
            .mark_line(point=True, color=COLOR_GREEN)
            .encode(
                x=alt.X("date:T", title="Month"),
                y=alt.Y(
                    "net_worth:Q",
                    axis=alt.Axis(format="$,.0f", title="Net Worth"),
                ),
                tooltip=[
                    alt.Tooltip("date:T", title="Month"),
                    alt.Tooltip("net_worth:Q", format="$,.2f", title="Net Worth"),
                    alt.Tooltip(
                        "monthly_change:Q",
                        format="$,.2f",
                        title="Monthly Change",
                    ),
                ],
            )
            .properties(height=400)
            .interactive()
        )

        st.altair_chart(nw_chart, width="stretch")
    else:
        # P2-S: Provide better feedback for zero-balance scenarios
        if abs(current_assets) < 1.0:
            st.warning(
                "All active accounts currently have a zero balance. "
                "Trend visualization requires non-zero starting data."
            )
        else:
            st.info("Insufficient data to calculate net worth history.")

with tab_investments:
    # ── TFSA Contributions (YTD) ────────────────────────────────────────────────
    st.header("TFSA Contributions (YTD)")

    tfsa_cats = st.secrets["categories"]["tfsa_tracking"]

    # Filter to current year only
    df_ytd = df[df["date"].dt.year == CURRENT_YEAR]
    df_ytd_expenses = df_ytd[~df_ytd["is_income"].eq(True)]
    df_tfsa = df_ytd_expenses[df_ytd_expenses["Category_Name"].isin(tfsa_cats)].copy()

    if not df_tfsa.empty:
        tfsa_total = round(df_tfsa["amount"].sum(), 2)

        cat_totals = {
            cat: round(df_tfsa[df_tfsa["Category_Name"] == cat]["amount"].sum(), 2)
            for cat in tfsa_cats
        }

        TFSA_LIMIT = float(st.secrets["tfsa"]["ytd_limit"])
        progress_pct = min(tfsa_total / TFSA_LIMIT, 1.0)
        remaining = round(max(TFSA_LIMIT - tfsa_total, 0.0), 2)

        cols = st.columns(len(tfsa_cats) + 1)
        for i, (cat, total) in enumerate(cat_totals.items()):
            cols[i].metric(cat, f"${total:,.2f}")
        cols[-1].metric(
            "Total Contributed",
            f"${tfsa_total:,.2f}",
            f"{(tfsa_total / TFSA_LIMIT) * 100:.1f}% of ${TFSA_LIMIT:,.2f} Limit",
        )

        st.progress(
            progress_pct,
            text=f"${remaining:,.2f} remaining of ${TFSA_LIMIT:,.2f} annual limit",
        )

        st.subheader("Contribution Velocity")
        daily_tfsa = (
            df_tfsa.groupby(["date", "Category_Name"])["amount"].sum().reset_index()
        )
        daily_tfsa = daily_tfsa.sort_values("date")
        daily_tfsa["Cumulative"] = (
            daily_tfsa.groupby("Category_Name")["amount"].cumsum().round(2)
        )
        daily_tfsa["amount"] = daily_tfsa["amount"].round(2)

        area_chart = (
            alt.Chart(daily_tfsa)
            .mark_area(opacity=0.7)
            .encode(
                x=alt.X("date:T", title="Date"),
                y=alt.Y(
                    "Cumulative:Q",
                    axis=alt.Axis(format="$,.0f", title="Cumulative Contribution"),
                ),
                color=alt.Color(
                    "Category_Name:N",
                    legend=alt.Legend(orient="bottom", title=None),
                ),
                tooltip=[
                    alt.Tooltip("date:T", title="Date"),
                    alt.Tooltip("Category_Name:N", title="Contribution Category"),
                    alt.Tooltip("amount:Q", format="$,.2f", title="Transaction Amount"),
                    alt.Tooltip(
                        "Cumulative:Q",
                        format="$,.2f",
                        title="Total YTD (this category)",
                    ),
                ],
            )
            .properties(height=300)
            .interactive()
        )

        st.altair_chart(area_chart, width="stretch")
    else:
        st.info("No TFSA contributions found for this year yet.")

    # ── Investment Forecasts ─────────────────────────────────────────────────────
    st.markdown("---")
    st.header("Investment Forecasts")

    balances = get_investment_balances(all_data)

    tab_resp, tab_rrsp, tab_tfsa = st.tabs(["RESP", "RRSP", "TFSA"])

    # --- RESP ---
    with tab_resp:
        resp_cfg = st.secrets["resp"]
        resp_return_pct = st.slider(
            "RESP Expected YoY Return (%)",
            min_value=0.0,
            max_value=15.0,
            value=float(resp_cfg["default_return_pct"]),
            step=0.5,
        )
        render_forecast_section(
            f"{resp_cfg.get('identifier', 'RESP')} Forecast "
            f"({resp_cfg['horizon_years']}-Year Horizon, "
            f"${resp_cfg['monthly_contribution']}/mo)",
            balances.get("RESP", {}),
            years_to_track=int(resp_cfg["horizon_years"]),
            return_rate=resp_return_pct / 100.0,
            annual_contribution=float(resp_cfg["monthly_contribution"]) * 12,
        )

    # --- RRSP ---
    with tab_rrsp:
        rrsp_cfg = st.secrets["rrsp"]
        rrsp_return_pct = st.slider(
            f"{rrsp_cfg.get('identifier', 'RRSP')} Expected YoY Return (%)",
            min_value=0.0,
            max_value=15.0,
            value=float(rrsp_cfg["default_return_pct"]),
            step=0.5,
        )
        render_forecast_section(
            f"{rrsp_cfg.get('identifier', 'RRSP')} Forecast "
            f"({rrsp_cfg['horizon_years']}-Year Horizon, "
            f"${rrsp_cfg['annual_contribution']}/yr)",
            balances.get("RRSP", {}),
            years_to_track=int(rrsp_cfg["horizon_years"]),
            return_rate=rrsp_return_pct / 100.0,
            annual_contribution=float(rrsp_cfg["annual_contribution"]),
        )

    # --- TFSA ---
    with tab_tfsa:
        tfsa_cfg = st.secrets["tfsa"]
        st.subheader(
            f"TFSA Forecast ({tfsa_cfg['horizon_years']}-Year Horizon, "
            "Custom Catch-up Rules)"
        )

        col_t1, col_t2 = st.columns(2)
        with col_t1:
            tfsa_base_return_pct = st.slider(
                f"Base TFSA ({tfsa_cfg['base']['identifier']}) YoY Return (%)",
                min_value=0.0,
                max_value=15.0,
                value=float(tfsa_cfg["base"]["default_return_pct"]),
                step=0.5,
            )
        with col_t2:
            tfsa_ws_return_pct = st.slider(
                f"Catch-up TFSA ({tfsa_cfg['catchup']['identifier']}) YoY Return (%)",
                min_value=0.0,
                max_value=15.0,
                value=float(tfsa_cfg["catchup"]["default_return_pct"]),
                step=0.5,
            )

        tfsa_balances = balances.get("TFSA", {})

        if tfsa_balances:
            years_to_track = int(tfsa_cfg["horizon_years"])
            ANNUAL_TFSA_ROOM = float(tfsa_cfg["annual_room"])
            BASE_TFSA_MONTHLY = float(tfsa_cfg["base"]["monthly_contribution"])
            BASE_TFSA_ANNUAL = BASE_TFSA_MONTHLY * 12
            WS_CATCHUP_YEAR_ANNUAL = float(
                tfsa_cfg["catchup"]["catchup_year_contribution"]
            )
            WS_FUTURE_ANNUAL = ANNUAL_TFSA_ROOM - BASE_TFSA_ANNUAL
            catchup_match = tfsa_cfg["catchup"]["identifier"].upper()

            def _tfsa_return_rate(name: str) -> float:
                if catchup_match in name.upper():
                    return tfsa_ws_return_pct / 100.0
                return tfsa_base_return_pct / 100.0

            def _tfsa_contribution(name: str, year_offset: int) -> float:
                if catchup_match in name.upper():
                    return (
                        WS_CATCHUP_YEAR_ANNUAL if year_offset == 0 else WS_FUTURE_ANNUAL
                    )
                return BASE_TFSA_ANNUAL

            forecast_data, total_current, total_halfway, total_final = (
                build_forecast_data(
                    tfsa_balances,
                    years_to_track,
                    CURRENT_YEAR,
                    return_rate_fn=_tfsa_return_rate,
                    contribution_fn=_tfsa_contribution,
                )
            )

            render_forecast_chart(
                forecast_data,
                CURRENT_YEAR,
                years_to_track,
                total_current,
                total_halfway,
                total_final,
            )
        else:
            st.info("No TFSA accounts found.")

with tab_advanced:
    st.subheader("Advanced Analytics")

    # 1. Hierarchical Spending Breakdown
    st.markdown("### Hierarchical Spending Breakdown")
    if not df_filtered.empty:
        df_expenses_only = df_filtered[~df_filtered["is_income"].eq(True)].copy()
        if not df_expenses_only.empty:
            fig_tree = px.treemap(
                df_expenses_only,
                path=["Group_Name", "Category_Name"],
                values="amount",
                color="amount",
                color_continuous_scale="RdBu_r",
                title="Spending by Group & Category",
            )
            st.plotly_chart(fig_tree, width="stretch")
        else:
            st.info("No expense data available for the current filters.")
    else:
        st.info("No data selected.")

    st.markdown("---")

    # 2. Spending Comparisons (MoM & YoY)
    st.markdown("### Spending Comparisons")
    # Using pre-fetched all_data["transactions"]
    df_all = all_data["transactions"]

    if not df_all.empty:
        # current_date_ref is already defined early at top of script

        # Current MTD
        curr_month_mask = (df_all["date"].dt.year == current_date_ref.year) & (
            df_all["date"].dt.month == current_date_ref.month
        )
        df_curr_month = df_all[curr_month_mask & ~df_all["is_income"].eq(True)]

        # Prev Month
        prev_month_ref = current_date_ref - relativedelta(months=1)
        prev_month_mask = (df_all["date"].dt.year == prev_month_ref.year) & (
            df_all["date"].dt.month == prev_month_ref.month
        )
        df_prev_month = df_all[prev_month_mask & ~df_all["is_income"].eq(True)]

        # Last Year
        last_year_ref = current_date_ref - relativedelta(years=1)
        last_year_mask = (df_all["date"].dt.year == last_year_ref.year) & (
            df_all["date"].dt.month == last_year_ref.month
        )
        df_last_year = df_all[last_year_mask & ~df_all["is_income"].eq(True)]

        mom_metrics = calculate_mom_metrics(
            df_curr_month, df_prev_month, current_date_ref
        )
        yoy_metrics = calculate_yoy_metrics(
            df_curr_month, df_last_year, current_date_ref
        )

        col_mom, col_yoy = st.columns(2)
        with col_mom:
            st.metric(
                "Month-over-Month (MTD)",
                f"${mom_metrics['current_mtd']:,.2f}",
                delta=mom_metrics["pct_change"],
                delta_color="inverse",
                help="Normalized for partial month comparison.",
            )
        with col_yoy:
            st.metric(
                "Year-over-Year (MTD)",
                f"${yoy_metrics['current_mtd']:,.2f}",
                delta=yoy_metrics["pct_change"],
                delta_color="inverse",
                help="Normalized for partial month comparison.",
            )

        # Comparison Chart
        comp_data = pd.DataFrame(
            [
                {"Period": "Current MTD", "Total": mom_metrics["current_mtd"]},
                {"Period": "Last Month MTD", "Total": mom_metrics["prev_mtd"]},
                {"Period": "Last Year MTD", "Total": yoy_metrics["last_year_mtd"]},
            ]
        )
        fig_comp = px.bar(
            comp_data,
            x="Period",
            y="Total",
            color="Period",
            title="MTD Comparison Across Periods",
        )
        st.plotly_chart(fig_comp, width="stretch")

    st.markdown("---")

    # 3. Budget Pacing
    st.markdown("### Budget Pacing")
    tracked_categories = st.secrets["categories"].get("budget_tracking", [])
    if tracked_categories:
        # P1-3 Fix: Use only the month data for pacing, ignoring global range filters
        real_today = datetime.now()
        pacing_date = min(real_today, current_date_ref)

        _, last_day = cal_lib.monthrange(pacing_date.year, pacing_date.month)
        time_elapsed_pct = pacing_date.day / last_day

        st.info(
            f"Reference date: **{pacing_date.strftime('%Y-%m-%d')}** "
            f"({time_elapsed_pct * 100:.1f}% of month elapsed). "
            "(Date filter ignored for pacing logic)"
        )

        # Get budgets for reference month
        db_month_str = pacing_date.strftime("%Y-%m")
        monthly_budgets = get_month_budgets(all_data, db_month_str)

        # P1-3 Fix: Filter all_data to the pacing month only for accuracy
        df_pacing_month = df_all[
            (df_all["date"].dt.year == pacing_date.year)
            & (df_all["date"].dt.month == pacing_date.month)
            & (~df_all["is_income"].eq(True))
        ]

        for cat in tracked_categories:
            budgeted = monthly_budgets.get(cat, 0.0)
            spent = df_pacing_month[df_pacing_month["Category_Name"] == cat][
                "amount"
            ].sum()

            pacing = calculate_budget_pacing(spent, budgeted, pacing_date)

            st.markdown(
                build_category_bar_html(
                    cat, spent, budgeted, time_elapsed_pct=time_elapsed_pct
                ),
                unsafe_allow_html=True,
            )
            if pacing > 0.05:  # 5% over track
                st.warning(
                    f"**{cat}** is pacing {pacing * 100:.1f}% ahead of schedule."
                )
    else:
        st.info("No budget tracking categories defined in secrets.toml.")

    st.markdown("---")

    # 4. What If? Sandbox
    st.markdown("### 🧪 What If? Sandbox")
    with st.expander("Explore Savings Scenarios", expanded=True):
        col_s1, col_s2 = st.columns(2)
        with col_s1:
            extra_savings = st.slider(
                "Extra Monthly Savings ($)", 0, 5000, 500, step=100
            )
            expected_return = (
                st.slider("Expected Annual Return (%)", 0.0, 15.0, 7.0, step=0.5)
                / 100.0
            )
        with col_s2:
            house_target = st.number_input(
                "House Down Payment Target ($)", value=100000, step=5000
            )
            retire_target = st.number_input(
                "Retirement Goal ($)", value=1000000, step=50000
            )

        # Get current net worth as starting point
        # Use anchored balance from accounts table for accuracy
        # (using balance_current from API)
        current_assets = round(
            sum(
                (acc.get("balance_current") or 0)
                for acc in all_data.get("accounts", [])
                if not acc.get("closed")
            )
            / 100.0,
            2,
        )

        months_house = calculate_milestone_months(
            current_assets, extra_savings, house_target, expected_return
        )
        months_retire = calculate_milestone_months(
            current_assets, extra_savings, retire_target, expected_return
        )

        mc1, mc2 = st.columns(2)
        with mc1:
            if months_house < 9999 and months_house > 0:
                target_date = datetime.now() + relativedelta(months=months_house)
                st.metric(
                    "House Goal",
                    f"{months_house} months",
                    delta=f"Est. {target_date.strftime('%b %Y')}",
                )
            elif months_house == 0:
                st.metric("House Goal", "Reached!", delta="Goal achieved")
            else:
                st.metric("House Goal", "Never", delta="Increase savings!")

        with mc2:
            if months_retire < 9999 and months_retire > 0:
                target_date = datetime.now() + relativedelta(months=months_retire)
                st.metric(
                    "Retirement Goal",
                    f"{months_retire} months",
                    delta=f"Est. {target_date.strftime('%b %Y')}",
                )
            elif months_retire == 0:
                st.metric("Retirement Goal", "Reached!", delta="Goal achieved")
            else:
                st.metric("Retirement Goal", "Never", delta="Increase savings!")

        st.caption(
            f"Calculations start from your current net worth of ${current_assets:,.2f}"
        )
