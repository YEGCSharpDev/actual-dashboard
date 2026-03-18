import ast
import io
import operator
import os
import re
import sqlite3
import tempfile
import zipfile
from datetime import datetime

import altair as alt
import pandas as pd
import requests
import streamlit as st
from dateutil.relativedelta import relativedelta
import plotly.graph_objects as go

# --- Configuration ---
st.set_page_config(page_title="Actual Budget Dashboard", layout="wide")
API_URL = st.secrets["ACTUAL_URL"]
HEADERS = {"x-api-key": st.secrets["ACTUAL_API_KEY"]}
API_TIMEOUT = 15

# --- Safe Arithmetic Parser ---
_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.USub: operator.neg,
}


def _eval_node(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_OPS:
        return _SAFE_OPS[type(node.op)](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_OPS:
        return _SAFE_OPS[type(node.op)](_eval_node(node.operand))
    raise ValueError("Unsupported expression")


def parse_math_input(expr_str: str) -> float:
    if not expr_str or not expr_str.strip():
        return 0.0
    try:
        tree = ast.parse(expr_str.strip(), mode='eval')
        return float(_eval_node(tree.body))
    except Exception:
        return 0.0


# --- API Helper ---
def _api_get(path: str) -> dict:
    resp = requests.get(f"{API_URL}/{path}", headers=HEADERS, timeout=API_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


# --- Data Fetching (Cached) ---
@st.cache_data(ttl=300)
def fetch_actual_data():
    cats_res = _api_get("categories")['data']
    payees_res = _api_get("payees")['data']
    accounts_res = _api_get("accounts")['data']

    active_accounts = [
        acc['id'] for acc in accounts_res
        if not acc.get('offbudget') and not acc.get('closed')
    ]

    current_year = datetime.now().year
    raw_txns = []
    for acc_id in active_accounts:
        data = _api_get(f"accounts/{acc_id}/transactions?since_date={current_year}-01-01")
        txns = data.get('data', [])

        for txn in txns:
            if txn.get('subtransactions'):
                for sub in txn['subtransactions']:
                    sub['date'] = txn['date']
                    sub['payee'] = sub.get('payee') or txn.get('payee')
                    raw_txns.append(sub)
            else:
                raw_txns.append(txn)

    df_txns = pd.DataFrame(raw_txns)
    df_cats = pd.DataFrame(cats_res)[['id', 'name', 'is_income']].rename(
        columns={'id': 'category', 'name': 'Category_Name'}
    )
    df_payees = pd.DataFrame(payees_res)[['id', 'name']].rename(
        columns={'id': 'payee', 'name': 'Payee_Name'}
    )

    df_merged = df_txns.merge(df_cats, on='category', how='left')
    df_merged = df_merged.merge(df_payees, on='payee', how='left')

    df_merged['Payee_Name'] = df_merged['Payee_Name'].fillna(df_merged['imported_payee']).fillna("Unknown")
    df_merged['Category_Name'] = df_merged['Category_Name'].fillna("Uncategorized")

    # Actual stores amounts as negative integer cents; flip sign and scale to dollars
    df_merged['amount'] = df_merged['amount'] / -100.0

    df_clean = df_merged[
        df_merged['category'].notna() & ~df_merged['tombstone'].astype(bool)
    ].copy()

    df_clean['date'] = pd.to_datetime(df_clean['date'])
    return df_clean


@st.cache_data(ttl=300)
def fetch_investment_balances():
    accounts_res = _api_get("accounts").get('data', [])
    balances = {'RESP': {}, 'RRSP': {}, 'TFSA': {}}

    resp_id = st.secrets["resp"]["identifier"].upper()
    rrsp_id = st.secrets["rrsp"]["identifier"].upper()
    tfsa_id = "TFSA"

    for acc in accounts_res:
        if acc.get('offbudget') and not acc.get('closed'):
            name = acc['name'].upper()
            acc_type = None

            if resp_id in name:
                acc_type = 'RESP'
            elif rrsp_id in name:
                acc_type = 'RRSP'
            elif tfsa_id in name:
                acc_type = 'TFSA'

            if acc_type:
                bal_res = _api_get(f"accounts/{acc['id']}/balance")
                balances[acc_type][acc['name']] = bal_res.get('data', 0) / 100.0

    return balances


@st.cache_data(ttl=300)
def fetch_underbudgeted_amounts():
    now = datetime.now()
    target_months = [now + relativedelta(months=i) for i in range(3)]
    months_str = [m.strftime('%Y%m') for m in target_months]

    results = {m: 0.0 for m in months_str}
    error_msg = None

    try:
        resp = requests.get(f"{API_URL}/export", headers=HEADERS, timeout=API_TIMEOUT)
        resp.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            db_bytes = z.read('db.sqlite')

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = os.path.join(tmp_dir, 'db.sqlite')
            with open(tmp_path, 'wb') as f:
                f.write(db_bytes)

            conn = sqlite3.connect(tmp_path)
            try:
                cursor = conn.cursor()
                for m in months_str:
                    cursor.execute("""
                        SELECT COALESCE(SUM(zero_budgets.goal - zero_budgets.amount), 0) / 100.0
                        FROM zero_budgets
                        INNER JOIN categories ON categories.id = zero_budgets.category
                        WHERE month = ?
                          AND amount < goal;
                    """, (m,))
                    row = cursor.fetchone()
                    results[m] = row[0] if row and row[0] else 0.0
            finally:
                conn.close()

    except Exception as e:
        error_msg = f"Failed to fetch underbudgeted amounts: {e}"

    return results, target_months, error_msg
@st.cache_data(ttl=300)
@st.cache_data(ttl=300)
def fetch_month_budgets(month_str: str) -> dict:
    """Fetches the assigned (budgeted) amounts for all categories for a specific month."""
    budgets = {}
    try:
        resp = requests.get(f"{API_URL}/export", headers=HEADERS, timeout=API_TIMEOUT)
        resp.raise_for_status()

        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            db_bytes = z.read('db.sqlite')

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = os.path.join(tmp_dir, 'db.sqlite')
            with open(tmp_path, 'wb') as f:
                f.write(db_bytes)

            conn = sqlite3.connect(tmp_path)
            try:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT categories.name, COALESCE(zero_budgets.amount, 0) / 100.0
                    FROM zero_budgets
                    INNER JOIN categories ON categories.id = zero_budgets.category
                    WHERE month = ?
                """, (month_str,))
                for row in cursor.fetchall():
                    budgets[row[0]] = row[1]
            finally:
                conn.close()

    except Exception as e:
        st.warning(f"Failed to fetch category budgets: {e}")

    return budgets

# --- Shared Forecast Rendering ---
def render_forecast_chart(forecast_data: list, current_year: int, years_to_track: int,
                          total_current: float, total_halfway: float, total_final: float):
    halfway_offset = years_to_track // 2

    mc1, mc2, mc3 = st.columns(3)
    mc1.metric("Current Total", f"${total_current:,.2f}")
    mc2.metric(f"Halfway Projection ({current_year + halfway_offset})", f"${total_halfway:,.0f}")
    mc3.metric(f"Final Projection ({current_year + years_to_track})", f"${total_final:,.0f}")

    df_forecast = pd.DataFrame(forecast_data)

    base = alt.Chart(df_forecast).encode(
        x=alt.X('Year:O', axis=alt.Axis(labelAngle=-45, title="Year")),
        y=alt.Y('Projected Balance:Q', axis=alt.Axis(format='$,.0f', title="Balance")),
        color=alt.Color('Account:N', legend=alt.Legend(orient='bottom', title=None))
    )

    line = base.mark_line(point=True, strokeWidth=3).encode(
        tooltip=[
            alt.Tooltip('Year:O'),
            alt.Tooltip('Account:N'),
            alt.Tooltip('Projected Balance:Q', format='$,.2f', title='Balance'),
        ]
    )
    text = base.mark_text(
        align='left', baseline='middle', dx=8, dy=-10, fontSize=12, fontWeight='bold'
    ).encode(text='Label:N')

    chart = (line + text).properties(height=350).interactive()
    st.altair_chart(chart, width="stretch")


def build_forecast_data(account_dict: dict, years_to_track: int, current_year: int,
                        return_rate_fn, contribution_fn):
    forecast_data = []
    total_current = sum(account_dict.values())
    total_halfway = 0.0
    total_final = 0.0
    halfway_offset = years_to_track // 2

    for name, initial_balance in account_dict.items():
        current_balance = initial_balance
        rate = return_rate_fn(name)

        for year_offset in range(years_to_track + 1):
            future_year = current_year + year_offset

            if year_offset == halfway_offset:
                total_halfway += current_balance
            if year_offset == years_to_track:
                total_final += current_balance

            is_milestone = (year_offset % 5 == 0) or (year_offset == years_to_track)

            forecast_data.append({
                "Year": future_year,
                "Account": name,
                "Projected Balance": current_balance,
                "Label": f"${current_balance:,.0f}" if is_milestone else "",
            })

            contrib = contribution_fn(name, year_offset)
            current_balance = (current_balance * (1 + rate)) + contrib

    return forecast_data, total_current, total_halfway, total_final


def render_forecast_section(title: str, account_dict: dict, years_to_track: int,
                            return_rate: float, annual_contribution: float = 0):
    if not account_dict:
        st.info("No accounts found for this category.")
        return

    st.subheader(title)
    current_year = datetime.now().year

    forecast_data, total_current, total_halfway, total_final = build_forecast_data(
        account_dict,
        years_to_track,
        current_year,
        return_rate_fn=lambda _name: return_rate,
        contribution_fn=lambda _name, _offset: annual_contribution,
    )

    render_forecast_chart(
        forecast_data, current_year, years_to_track,
        total_current, total_halfway, total_final,
    )


# --- UI Rendering ---
st.title("Actual Budget Dashboard")

with st.spinner("Fetching data from Actual API..."):
    df = fetch_actual_data()

# Sidebar Filters
st.sidebar.header("Filters")
month_options = sorted(df['date'].dt.strftime('%Y-%m').unique(), reverse=True)
selected_month = st.sidebar.selectbox("Select Month", month_options)

df_filtered = df[df['date'].dt.strftime('%Y-%m') == selected_month]

df_income = df_filtered[df_filtered['is_income'].eq(True)].copy()
# Income was flipped to negative by the global /−100 conversion; restore to positive
df_income['amount'] = df_income['amount'] * -1

df_expenses = df_filtered[~df_filtered['is_income'].eq(True)].copy()

# --- Dashboard Layout ---
st.subheader("Monthly Overview")

total_income = df_income['amount'].sum()
total_spent = df_expenses['amount'].sum()
net_income = total_income - total_spent

# 1. Top Line: High Level Metrics & Forecasting Inputs
col_inc, col_exp, col_net, col_forecast = st.columns(4)

with col_inc:
    st.metric("Actual Income", f"${total_income:,.2f}")
    add_inc_str = st.text_input("Forecasted Income (e.g. 500+200)", value="0", key="add_inc")
    expected_income = total_income + parse_math_input(add_inc_str)

with col_exp:
    st.metric("Actual Expenses", f"${total_spent:,.2f}")
    add_exp_str = st.text_input("Forecasted Expense (e.g. 100+50)", value="0", key="add_exp")
    expected_expenses = total_spent + parse_math_input(add_exp_str)

with col_net:
    if total_income > 0:
        savings_rate = (net_income / total_income) * 100
        savings_delta = f"{savings_rate:.1f}% savings rate"
    else:
        savings_delta = None
    st.metric("Actual Net", f"${net_income:,.2f}", delta=savings_delta, delta_color="normal")

with col_forecast:
    forecast_net = expected_income - expected_expenses
    if expected_income > 0:
        forecast_savings_rate = (forecast_net / expected_income) * 100
        forecast_delta = f"{forecast_savings_rate:.1f}% expected savings"
    else:
        forecast_delta = None
    st.metric("Expected Net", f"${forecast_net:,.2f}", delta=forecast_delta, delta_color="normal")

# 2. Second Line: Separate Income and Expense Bars (Paced Against Expected)
max_expected = max(expected_income, expected_expenses, 1.0)

inc_pct = min((total_income / max_expected) * 100, 100.0)
exp_pct = min((total_spent / max_expected) * 100, 100.0)

LABEL_THRESHOLD = 20


def bar_html(pct, color_solid, color_bg, color_border, label, amount_str, expected_str):
    label_inside = pct > LABEL_THRESHOLD
    fill_content = (
        f'<span style="color: white; font-weight: bold; font-size: 13px; padding: 0 10px;">'
        f'{amount_str}</span>'
        if label_inside else ''
    )
    outside_label = (
        '' if label_inside
        else f'<span style="margin-left: 8px; font-weight: bold; font-size: 13px; '
             f'color: {color_solid};">{amount_str}</span>'
    )

    return (
        f'<div style="display: flex; align-items: center; margin-bottom: 10px;">'
        f'<div style="width: 85px; font-weight: bold; color: {color_solid}; font-size: 14px;">'
        f'{label}</div>'
        f'<div style="flex-grow: 1; background-color: {color_bg}; border-radius: 6px; '
        f'height: 28px; border: 1px solid {color_border}; display: flex; align-items: center; '
        f'justify-content: space-between; padding-right: 10px;">'
        f'<div style="display: flex; align-items: center; width: 100%; height: 100%;">'
        f'<div style="background-color: {color_solid}; width: {pct}%; height: 100%; '
        f'border-radius: 5px; display: flex; align-items: center; justify-content: flex-end;">'
        f'{fill_content}</div>{outside_label}</div>'
        f'<span style="color: #999999; font-size: 12px; font-weight: bold; white-space: nowrap;">'
        f'Target: {expected_str}</span></div></div>'
    )


st.markdown(
    f'<div style="margin-bottom: 25px;">'
    f'{bar_html(inc_pct, "#28a745", "rgba(40,167,69,0.15)", "rgba(40,167,69,0.3)", "Income", f"${total_income:,.2f}", f"${expected_income:,.0f}")}'
    f'{bar_html(exp_pct, "#dc3545", "rgba(220,53,69,0.15)", "rgba(220,53,69,0.3)", "Expenses", f"${total_spent:,.2f}", f"${expected_expenses:,.0f}")}'
    f'</div>',
    unsafe_allow_html=True,
)

# 3. Third Line: Envelope Health Checks
st.subheader("Future Envelope Health")
underbudget_data, target_months, underbudget_error = fetch_underbudgeted_amounts()
if underbudget_error:
    st.warning(underbudget_error)

m_cols = st.columns(3)

for i, m_obj in enumerate(target_months):
    m_str = m_obj.strftime('%Y%m')
    m_label = m_obj.strftime('%b %Y')
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
# --- Budgeted vs Spent (Key Categories) ---
st.subheader("Key Category Tracking")

# Dynamically pull the tracked categories directly from secrets.toml
tracked_categories = st.secrets["categories"].get("budget_tracking", [])

if tracked_categories:
    # Format the selected Streamlit month (YYYY-MM) to match Actual's database (YYYYMM)
    db_month_str = selected_month.replace('-', '')
    monthly_budgets = fetch_month_budgets(db_month_str)

    for cat in tracked_categories:
        # Get the assigned budget amount (default to 0 if not found)
        budgeted = monthly_budgets.get(cat, 0.0)
        
        # Calculate how much has been spent so far
        spent = df_expenses[df_expenses['Category_Name'] == cat]['amount'].sum()
        left = budgeted - spent
        
        # Calculate percentages safely
        if budgeted > 0:
            pct = (spent / budgeted) * 100
        else:
            pct = 100.0 if spent > 0 else 0.0

        vis_pct = min(pct, 100.0) # Cap the visual fill at 100% to protect the CSS bounds
        
        # Color logic: Green (< 75%), Yellow (75-90%), Red (> 90%)
        if pct < 75:
            color = "#28a745"
            bg_color = "rgba(40,167,69,0.15)"
        elif pct < 90:
            color = "#ffc107"
            bg_color = "rgba(255,193,7,0.15)"
        else:
            color = "#dc3545"
            bg_color = "rgba(220,53,69,0.15)"
            
        left_str = f"${left:,.2f} left" if left >= 0 else f"${abs(left):,.2f} over!"
        
        # HTML squashed into a single string to prevent Streamlit's markdown parser from breaking
        bar_html = (
            f'<div style="margin-bottom: 18px;">'
            f'<div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 14px; font-weight: bold; color: #e0e0e0;">'
            f'<span>{cat}</span><span style="color: {color};">{left_str}</span></div>'
            f'<div style="position: relative; background-color: {bg_color}; border-radius: 6px; height: 26px; width: 100%; border: 1px solid {color}40; overflow: hidden;">'
            f'<div style="background-color: {color}; width: {vis_pct}%; height: 100%; border-radius: 4px;"></div>'
            f'<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; justify-content: space-between; align-items: center; padding: 0 10px; font-size: 12px; font-weight: bold; color: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">'
            f'<span>{pct:.1f}%</span><span>${spent:,.2f} / ${budgeted:,.0f}</span>'
            f'</div></div></div>'
        )
        st.markdown(bar_html, unsafe_allow_html=True)
else:
    st.info("No budget tracking categories defined in secrets.toml.")

st.markdown("---")

# --- Spending Flow (Sankey Diagram) ---
st.subheader("Spending Flow")

# Group and filter out any zero-dollar categories to keep the diagram clean
cat_summary = df_expenses.groupby('Category_Name')['amount'].sum().reset_index()
cat_summary = cat_summary[cat_summary['amount'] > 0].sort_values('amount', ascending=False)

if not cat_summary.empty:
    # A Sankey requires a list of nodes. 
    # Index 0 is the Root ("Total Expenses"), and Indices 1 through N are the categories.
    labels = ["Total Expenses"] + cat_summary['Category_Name'].tolist()
    
    # The 'source' for all flows is 0 (Total Expenses)
    source = [0] * len(cat_summary)
    
    # The 'target' for the flows are the category indices (1 through N)
    target = list(range(1, len(cat_summary) + 1))
    
    # The 'value' is the width of the flow lines
    values = cat_summary['amount'].tolist()

    # Build the Plotly Sankey figure
    fig = go.Figure(data=[go.Sankey(
        valueformat="$,.2f", # Automatically formats the hover tooltips as currency
        node=dict(
            pad=20,
            thickness=20,
            line=dict(color="rgba(0,0,0,0)", width=0),
            label=labels,
            color="#dc3545" # Bootstrap red to match the Expenses theme
        ),
        link=dict(
            source=source,
            target=target,
            value=values,
            color="rgba(220, 53, 69, 0.3)" # Transparent red for the sweeping flows
        )
    )])

    # Strip out the background so it seamlessly matches your Streamlit dark/light theme
    fig.update_layout(
        margin=dict(l=0, r=0, t=20, b=20),
        height=700, # Massive height boost so labels don't bunch up
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(size=13) # Bumped up the font size slightly for normal page zoom
    )

    # Plotly figures still use use_container_width in Streamlit, unlike dataframes!
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info("No expenses found to chart for this month.")

st.markdown("---")

# --- Transaction Log ---
st.subheader("Transaction Log")
display_df = df_expenses[['date', 'Payee_Name', 'Category_Name', 'amount']].copy()
display_df = display_df.sort_values(by='date', ascending=False)
display_df['date'] = display_df['date'].dt.strftime('%Y-%m-%d')

# Using width="stretch" here to respect the Streamlit deprecation fixes we made earlier
st.dataframe(display_df, width="stretch", hide_index=True)

# --- TFSA Contributions (YTD) ---
st.markdown("---")
st.header("TFSA Contributions (YTD)")

tfsa_cats = st.secrets["categories"]["tfsa_tracking"]

df_ytd_expenses = df[~df['is_income'].eq(True)]
df_tfsa = df_ytd_expenses[df_ytd_expenses['Category_Name'].isin(tfsa_cats)].copy()

if not df_tfsa.empty:
    tfsa_total = df_tfsa['amount'].sum()

    cat_totals = {
        cat: df_tfsa[df_tfsa['Category_Name'] == cat]['amount'].sum()
        for cat in tfsa_cats
    }

    TFSA_LIMIT = float(st.secrets["tfsa"]["ytd_limit"])
    progress_pct = min(tfsa_total / TFSA_LIMIT, 1.0)
    remaining = max(TFSA_LIMIT - tfsa_total, 0.0)

    cols = st.columns(len(tfsa_cats) + 1)
    for i, (cat, total) in enumerate(cat_totals.items()):
        cols[i].metric(cat, f"${total:,.2f}")
    cols[-1].metric(
        "Total Contributed",
        f"${tfsa_total:,.2f}",
        f"{(tfsa_total / TFSA_LIMIT) * 100:.1f}% of ${TFSA_LIMIT:,.2f} Limit",
    )

    st.progress(progress_pct, text=f"${remaining:,.2f} remaining of ${TFSA_LIMIT:,.2f} annual limit")

    st.subheader("Contribution Velocity")
    daily_tfsa = df_tfsa.groupby(['date', 'Category_Name'])['amount'].sum().reset_index()
    daily_tfsa = daily_tfsa.sort_values('date')
    daily_tfsa['Cumulative'] = daily_tfsa.groupby('Category_Name')['amount'].cumsum()

    area_chart = alt.Chart(daily_tfsa).mark_area(opacity=0.7).encode(
        x=alt.X('date:T', title='Date'),
        y=alt.Y('Cumulative:Q', axis=alt.Axis(format='$,.0f', title='Cumulative Contribution')),
        color=alt.Color('Category_Name:N', legend=alt.Legend(orient='bottom', title=None)),
        tooltip=[
            alt.Tooltip('date:T', title='Date'),
            alt.Tooltip('Category_Name:N', title='Category'),
            alt.Tooltip('Cumulative:Q', format='$,.2f', title='Cumulative'),
        ],
    ).properties(height=300).interactive()

    st.altair_chart(area_chart, width="stretch")
else:
    st.info("No TFSA contributions found for this year yet.")

# --- Investment Forecasting ---
st.markdown("---")
st.header("Investment Forecasts")

balances = fetch_investment_balances()
current_year = datetime.now().year

tab_resp, tab_rrsp, tab_tfsa = st.tabs(["RESP", "RRSP", "TFSA"])

# --- RESP Section ---
with tab_resp:
    resp_cfg = st.secrets["resp"]
    resp_return_pct = st.slider(
        "RESP Expected YoY Return (%)",
        min_value=0.0, max_value=15.0,
        value=float(resp_cfg["default_return_pct"]), step=0.5,
    )
    render_forecast_section(
        f"{resp_cfg.get('identifier', 'RESP')} Forecast "
        f"({resp_cfg['horizon_years']}-Year Horizon, ${resp_cfg['monthly_contribution']}/mo)",
        balances.get('RESP', {}),
        years_to_track=int(resp_cfg["horizon_years"]),
        return_rate=resp_return_pct / 100.0,
        annual_contribution=float(resp_cfg["monthly_contribution"]) * 12,
    )

# --- RRSP Section ---
with tab_rrsp:
    rrsp_cfg = st.secrets["rrsp"]
    rrsp_return_pct = st.slider(
        f"{rrsp_cfg.get('identifier', 'RRSP')} Expected YoY Return (%)",
        min_value=0.0, max_value=15.0,
        value=float(rrsp_cfg["default_return_pct"]), step=0.5,
    )
    render_forecast_section(
        f"{rrsp_cfg.get('identifier', 'RRSP')} Forecast "
        f"({rrsp_cfg['horizon_years']}-Year Horizon, ${rrsp_cfg['annual_contribution']}/yr)",
        balances.get('RRSP', {}),
        years_to_track=int(rrsp_cfg["horizon_years"]),
        return_rate=rrsp_return_pct / 100.0,
        annual_contribution=float(rrsp_cfg["annual_contribution"]),
    )

# --- TFSA Section ---
with tab_tfsa:
    tfsa_cfg = st.secrets["tfsa"]
    st.subheader(f"TFSA Forecast ({tfsa_cfg['horizon_years']}-Year Horizon, Custom Catch-up Rules)")

    col_t1, col_t2 = st.columns(2)
    with col_t1:
        tfsa_base_return_pct = st.slider(
            f"Base TFSA ({tfsa_cfg['base']['identifier']}) YoY Return (%)",
            min_value=0.0, max_value=15.0,
            value=float(tfsa_cfg["base"]["default_return_pct"]), step=0.5,
        )
    with col_t2:
        tfsa_ws_return_pct = st.slider(
            f"Catch-up TFSA ({tfsa_cfg['catchup']['identifier']}) YoY Return (%)",
            min_value=0.0, max_value=15.0,
            value=float(tfsa_cfg["catchup"]["default_return_pct"]), step=0.5,
        )

    tfsa_balances = balances.get('TFSA', {})

    if tfsa_balances:
        years_to_track = int(tfsa_cfg["horizon_years"])
        ANNUAL_TFSA_ROOM = float(tfsa_cfg["annual_room"])
        BASE_TFSA_MONTHLY = float(tfsa_cfg["base"]["monthly_contribution"])
        BASE_TFSA_ANNUAL = BASE_TFSA_MONTHLY * 12
        WS_CATCHUP_YEAR_ANNUAL = float(tfsa_cfg["catchup"]["catchup_year_contribution"])
        WS_FUTURE_ANNUAL = ANNUAL_TFSA_ROOM - BASE_TFSA_ANNUAL
        catchup_match = tfsa_cfg["catchup"]["identifier"].upper()

        def _tfsa_return_rate(name: str) -> float:
            if catchup_match in name.upper():
                return tfsa_ws_return_pct / 100.0
            return tfsa_base_return_pct / 100.0

        def _tfsa_contribution(name: str, year_offset: int) -> float:
            if catchup_match in name.upper():
                return WS_CATCHUP_YEAR_ANNUAL if year_offset == 0 else WS_FUTURE_ANNUAL
            return BASE_TFSA_ANNUAL

        forecast_data, total_current, total_halfway, total_final = build_forecast_data(
            tfsa_balances, years_to_track, current_year,
            return_rate_fn=_tfsa_return_rate,
            contribution_fn=_tfsa_contribution,
        )

        render_forecast_chart(
            forecast_data, current_year, years_to_track,
            total_current, total_halfway, total_final,
        )
    else:
        st.info("No TFSA accounts found.")
