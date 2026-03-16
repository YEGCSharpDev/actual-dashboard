import streamlit as st
import pandas as pd
import requests
from datetime import datetime
import altair as alt
import zipfile
import io
import tempfile
import os
import sqlite3

# --- Configuration ---
st.set_page_config(page_title="Actual Budget Dashboard", layout="wide")
API_URL = st.secrets["ACTUAL_URL"]
HEADERS = {"x-api-key": st.secrets["ACTUAL_API_KEY"]}

# --- Data Fetching (Cached) ---
@st.cache_data(ttl=300)
def fetch_actual_data():    
    cats_res = requests.get(f"{API_URL}/categories", headers=HEADERS).json()['data']
    payees_res = requests.get(f"{API_URL}/payees", headers=HEADERS).json()['data']
    
    accounts_res = requests.get(f"{API_URL}/accounts", headers=HEADERS).json()['data']
    active_accounts = [acc['id'] for acc in accounts_res if not acc.get('offbudget') and not acc.get('closed')]
    
    current_year = datetime.now().year  # moved out of loop; same value every iteration
    raw_txns = []
    for acc_id in active_accounts:
        txns = requests.get(f"{API_URL}/accounts/{acc_id}/transactions?since_date={current_year}-01-01", headers=HEADERS).json().get('data', [])
        
        for txn in txns:
            if txn.get('subtransactions'):
                for sub in txn['subtransactions']:
                    sub['date'] = txn['date']
                    sub['payee'] = sub.get('payee') or txn.get('payee')
                    raw_txns.append(sub)
            else:
                raw_txns.append(txn)

    df_txns = pd.DataFrame(raw_txns)
    df_cats = pd.DataFrame(cats_res)[['id', 'name', 'is_income']]
    df_payees = pd.DataFrame(payees_res)[['id', 'name']]
    
    df_cats.rename(columns={'id': 'category', 'name': 'Category_Name'}, inplace=True)
    df_payees.rename(columns={'id': 'payee', 'name': 'Payee_Name'}, inplace=True)
    
    df_merged = df_txns.merge(df_cats, on='category', how='left')
    df_merged = df_merged.merge(df_payees, on='payee', how='left')
    
    df_merged['Payee_Name'] = df_merged['Payee_Name'].fillna(df_merged['imported_payee']).fillna("Unknown")
    df_merged['Category_Name'] = df_merged['Category_Name'].fillna("Uncategorized")
    
    # Actual stores amounts as negative integer cents; flip sign and scale to dollars
    df_merged['amount'] = (df_merged['amount'] / -100.0)
    
    # income/expense split happens downstream after the month filter
    df_clean = df_merged[
        (df_merged['category'].notna()) & 
        (df_merged['tombstone'] == False)
    ].copy()
    
    df_clean['date'] = pd.to_datetime(df_clean['date'])
    return df_clean

@st.cache_data(ttl=300)
def fetch_investment_balances():
    accounts_res = requests.get(f"{API_URL}/accounts", headers=HEADERS).json().get('data', [])
    balances = {'RESP': {}, 'RRSP': {}, 'TFSA': {}}
    
    resp_id = st.secrets["resp"]["identifier"].upper()
    rrsp_id = st.secrets["rrsp"]["identifier"].upper()
    tfsa_id = "TFSA" 
    
    for acc in accounts_res:
        if acc.get('offbudget') and not acc.get('closed'):
            name = acc['name'].upper()
            acc_type = None
            
            if resp_id in name: acc_type = 'RESP'
            elif rrsp_id in name: acc_type = 'RRSP'
            elif tfsa_id in name: acc_type = 'TFSA'
            
            if acc_type:
                bal_res = requests.get(f"{API_URL}/accounts/{acc['id']}/balance", headers=HEADERS).json()
                balances[acc_type][acc['name']] = bal_res.get('data', 0) / 100.0
                
    return balances

@st.cache_data(ttl=300)
def fetch_underbudgeted_amounts():
    now = datetime.now()
    target_months = [(now + pd.DateOffset(months=i)) for i in range(3)]
    months_str = [m.strftime('%Y%m') for m in target_months]
    
    results = {m: 0.0 for m in months_str}
    
    export_url = f"{API_URL}/export"
    try:
        resp = requests.get(export_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        
        with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
            db_bytes = z.read('db.sqlite')
            
        with tempfile.NamedTemporaryFile(delete=False, suffix='.sqlite') as tmp:
            tmp.write(db_bytes)
            tmp_path = tmp.name

        conn = None  # guard for finally block if connect() raises
        try:
            conn = sqlite3.connect(tmp_path)
            cursor = conn.cursor()
            for m in months_str:
                cursor.execute("""
                    SELECT COALESCE(SUM(zero_budgets.goal - zero_budgets.amount), 0) / 100.0
                    FROM zero_budgets
                    INNER JOIN categories ON categories.id = zero_budgets.category
                    WHERE month = ?
                      AND amount < goal;
                """, (m,))
                # amount < goal excludes over-funded categories; <> would let them offset the sum
                row = cursor.fetchone()
                results[m] = row[0] if row and row[0] else 0.0
        finally:
            if conn:
                conn.close()
            os.remove(tmp_path) 
            
    except Exception as e:
        st.warning(f"Failed to fetch underbudgeted amounts: {e}")
        
    return results, target_months

# --- UI Rendering ---
st.title("💸 Actual Budget Dashboard")

with st.spinner("Fetching data from Actual API..."):
    df = fetch_actual_data()

# Sidebar Filters
st.sidebar.header("Filters")
month_options = sorted(df['date'].dt.strftime('%Y-%m').unique(), reverse=True)
selected_month = st.sidebar.selectbox("Select Month", month_options)

df_filtered = df[df['date'].dt.strftime('%Y-%m') == selected_month]

df_income = df_filtered[df_filtered['is_income'] == True].copy()
# Income was flipped to negative by the global /−100 conversion; restore to positive
df_income['amount'] = df_income['amount'] * -1

df_expenses = df_filtered[df_filtered['is_income'] != True].copy()

# --- Dashboard Layout ---
st.subheader("Monthly Overview")

total_income = df_income['amount'].sum()
total_spent = df_expenses['amount'].sum()
net_income = total_income - total_spent

col_inc, col_exp, col_net = st.columns(3)
col_inc.metric("Income", f"${total_income:,.2f}")
col_exp.metric("Expenses", f"${total_spent:,.2f}")

# Savings rate as delta gives more signal than restating net income
if total_income > 0:
    savings_rate = (net_income / total_income) * 100
    savings_delta = f"{savings_rate:.1f}% savings rate"
else:
    savings_delta = None
col_net.metric("Net Income", f"${net_income:,.2f}", delta=savings_delta, delta_color="normal")

# Scale bars relative to each other so the larger value always fills the track
max_val = max(total_income, total_spent)
if max_val == 0:
    max_val = 1.0

inc_pct = (total_income / max_val) * 100
exp_pct = (total_spent / max_val) * 100

# When a bar is too narrow to contain its label, render the label outside the fill
LABEL_THRESHOLD = 20

def bar_html(pct, color_solid, color_bg, color_border, label, amount_str):
    label_inside = pct > LABEL_THRESHOLD
    fill_content = f'<span style="color:white;font-weight:bold;font-size:13px;padding:0 10px">{amount_str}</span>' if label_inside else ''
    outside_label = f'<span style="margin-left:8px;font-weight:bold;font-size:13px;color:{color_solid}">{amount_str}</span>' if not label_inside else ''
    return (
        f'<div style="display:flex;align-items:center;margin-bottom:10px">'
        f'<div style="width:85px;font-weight:bold;color:{color_solid};font-size:14px">{label}</div>'
        f'<div style="flex-grow:1;background-color:{color_bg};border-radius:6px;height:28px;border:1px solid {color_border};display:flex;align-items:center">'
        f'<div style="background-color:{color_solid};width:{pct}%;height:100%;border-radius:5px;display:flex;align-items:center;justify-content:flex-end">'
        f'{fill_content}</div>{outside_label}</div></div>'
    )

st.markdown(
    f'<div style="margin-bottom:25px">'
    f'{bar_html(inc_pct, "#28a745", "rgba(40,167,69,0.15)", "rgba(40,167,69,0.3)", "Income", f"${total_income:,.2f}")}'
    f'{bar_html(exp_pct, "#dc3545", "rgba(220,53,69,0.15)", "rgba(220,53,69,0.3)", "Expenses", f"${total_spent:,.2f}")}'
    f'</div>',
    unsafe_allow_html=True
)


st.subheader("Future Envelope Health")
underbudget_data, target_months = fetch_underbudgeted_amounts()
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
            delta_color="inverse" 
        )
    else:
        m_cols[i].metric(
            label=f"Underfunded ({m_label})", 
            value=f"${val:,.2f}",
            delta="Fully Funded",
            delta_color="normal" 
        )

st.markdown("---")

col1, col2 = st.columns(2)

with col1:
    st.subheader("Spending by Category")
    cat_summary = df_expenses.groupby('Category_Name')['amount'].sum().reset_index()
    
    bar_chart = alt.Chart(cat_summary).mark_bar().encode(
        x=alt.X('amount:Q', title='Amount', axis=alt.Axis(format='$,.0f')),
        y=alt.Y('Category_Name:N', sort='-x', title=''),
        tooltip=[
            alt.Tooltip('Category_Name:N', title='Category'), 
            alt.Tooltip('amount:Q', format='$,.2f', title='Total Spent')
        ]
    )
    
    st.altair_chart(bar_chart, width="stretch")

with col2:
    st.subheader("Transaction Log")
    display_df = df_expenses[['date', 'Payee_Name', 'Category_Name', 'amount']].copy()
    display_df = display_df.sort_values(by='date', ascending=False)
    display_df['date'] = display_df['date'].dt.strftime('%Y-%m-%d')
    st.dataframe(display_df, width="stretch", hide_index=True)

# --- TFSA Contributions (YTD) ---
st.markdown("---")
st.header("📈 TFSA Contributions (YTD)")

tfsa_cats = st.secrets["categories"]["tfsa_tracking"]

# df is unfiltered YTD; df_expenses is scoped to the selected month
df_ytd_expenses = df[df['is_income'] != True]
df_tfsa = df_ytd_expenses[df_ytd_expenses['Category_Name'].isin(tfsa_cats)].copy()

if not df_tfsa.empty:
    tfsa_total = df_tfsa['amount'].sum()
    
    cat_totals = {}
    for cat in tfsa_cats:
        cat_totals[cat] = df_tfsa[df_tfsa['Category_Name'] == cat]['amount'].sum()
    
    TFSA_LIMIT = float(st.secrets["tfsa"]["ytd_limit"])
    progress_pct = min(tfsa_total / TFSA_LIMIT, 1.0)
    remaining = max(TFSA_LIMIT - tfsa_total, 0.0)

    cols = st.columns(len(tfsa_cats) + 1)
    for i, (cat, total) in enumerate(cat_totals.items()):
        cols[i].metric(cat, f"${total:,.2f}")
    cols[-1].metric("Total Contributed", f"${tfsa_total:,.2f}", f"{(tfsa_total/TFSA_LIMIT)*100:.1f}% of ${TFSA_LIMIT:,.2f} Limit")

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
            alt.Tooltip('Cumulative:Q', format='$,.2f', title='Cumulative')
        ]
    ).properties(height=300).interactive()

    st.altair_chart(area_chart, width="stretch")
else:
    st.info("No TFSA contributions found for this year yet.")

# --- Investment Forecasting ---
st.markdown("---")
st.header("🔮 Investment Forecasts")

balances = fetch_investment_balances()
current_year = datetime.now().year

tab_resp, tab_rrsp, tab_tfsa = st.tabs(["🎓 RESP", "🏦 RRSP", "📈 TFSA"])

def render_forecast_section(title, account_dict, years_to_track, return_rate, annual_contribution=0):
    if not account_dict:
        st.info("No accounts found for this category.")
        return
        
    st.subheader(title)
    
    forecast_data = []
    
    total_current = sum(account_dict.values())
    total_halfway = 0.0
    total_final = 0.0
    halfway_offset = years_to_track // 2
    
    for name, initial_balance in account_dict.items():
        current_balance = initial_balance
        
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
                "Label": f"${current_balance:,.0f}" if is_milestone else ""
            })
            
            current_balance = (current_balance * (1 + return_rate)) + annual_contribution
            
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
        tooltip=[alt.Tooltip('Year:O'), alt.Tooltip('Account:N'), alt.Tooltip('Projected Balance:Q', format='$,.2f', title='Balance')]
    )
    text = base.mark_text(align='left', baseline='middle', dx=8, dy=-10, fontSize=12, fontWeight='bold').encode(text='Label:N')
    chart = (line + text).properties(height=350).interactive()
    
    st.altair_chart(chart, width="stretch")

# --- RESP Section ---
with tab_resp:
    resp_cfg = st.secrets["resp"]
    resp_return_pct = st.slider("RESP Expected YoY Return (%)", min_value=0.0, max_value=15.0, value=float(resp_cfg["default_return_pct"]), step=0.5)
    render_forecast_section(
        f"{resp_cfg.get('identifier', 'RESP')} Forecast ({resp_cfg['horizon_years']}-Year Horizon, ${resp_cfg['monthly_contribution']}/mo)", 
        balances.get('RESP', {}), 
        years_to_track=int(resp_cfg["horizon_years"]), 
        return_rate=(resp_return_pct / 100.0), 
        annual_contribution=(float(resp_cfg["monthly_contribution"]) * 12)
    )

# --- RRSP Section ---
with tab_rrsp:
    rrsp_cfg = st.secrets["rrsp"]
    rrsp_return_pct = st.slider(f"{rrsp_cfg.get('identifier', 'RRSP')} Expected YoY Return (%)", min_value=0.0, max_value=15.0, value=float(rrsp_cfg["default_return_pct"]), step=0.5)
    render_forecast_section(
        f"{rrsp_cfg.get('identifier', 'RRSP')} Forecast ({rrsp_cfg['horizon_years']}-Year Horizon, ${rrsp_cfg['annual_contribution']}/yr)", 
        balances.get('RRSP', {}), 
        years_to_track=int(rrsp_cfg["horizon_years"]), 
        return_rate=(rrsp_return_pct / 100.0), 
        annual_contribution=float(rrsp_cfg["annual_contribution"])
    )

# --- TFSA Section ---
with tab_tfsa:
    tfsa_cfg = st.secrets["tfsa"]
    st.subheader(f"TFSA Forecast ({tfsa_cfg['horizon_years']}-Year Horizon, Custom Catch-up Rules)")

    col_t1, col_t2 = st.columns(2)
    with col_t1:
        tfsa_base_return_pct = st.slider(f"Base TFSA ({tfsa_cfg['base']['identifier']}) YoY Return (%)", min_value=0.0, max_value=15.0, value=float(tfsa_cfg["base"]["default_return_pct"]), step=0.5)
    with col_t2:
        tfsa_ws_return_pct = st.slider(f"Catch-up TFSA ({tfsa_cfg['catchup']['identifier']}) YoY Return (%)", min_value=0.0, max_value=15.0, value=float(tfsa_cfg["catchup"]["default_return_pct"]), step=0.5)

    tfsa_balances = balances.get('TFSA', {})

    if tfsa_balances:
        forecast_data = []
        
        years_to_track = int(tfsa_cfg["horizon_years"])
        total_current = sum(tfsa_balances.values())
        total_halfway = 0.0
        total_final = 0.0
        halfway_offset = years_to_track // 2
        
        ANNUAL_TFSA_ROOM = float(tfsa_cfg["annual_room"])
        BASE_TFSA_MONTHLY = float(tfsa_cfg["base"]["monthly_contribution"])
        BASE_TFSA_ANNUAL = BASE_TFSA_MONTHLY * 12
        WS_CATCHUP_YEAR_ANNUAL = float(tfsa_cfg["catchup"]["catchup_year_contribution"])
        WS_FUTURE_ANNUAL = ANNUAL_TFSA_ROOM - BASE_TFSA_ANNUAL
        
        catchup_match = tfsa_cfg["catchup"]["identifier"].upper()
        
        for name, initial_balance in tfsa_balances.items():
            current_balance = initial_balance
            
            is_catchup = catchup_match in name.upper()
            return_rate = (tfsa_ws_return_pct / 100.0) if is_catchup else (tfsa_base_return_pct / 100.0)
            
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
                    "Label": f"${current_balance:,.0f}" if is_milestone else ""
                })
                
                # catchup account gets a higher first-year contribution while clearing its backlog
                if is_catchup:
                    contrib = WS_CATCHUP_YEAR_ANNUAL if year_offset == 0 else WS_FUTURE_ANNUAL
                else:
                    contrib = BASE_TFSA_ANNUAL
                    
                current_balance = (current_balance * (1 + return_rate)) + contrib
                
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
            tooltip=[alt.Tooltip('Year:O'), alt.Tooltip('Account:N'), alt.Tooltip('Projected Balance:Q', format='$,.2f', title='Balance')]
        )
        text = base.mark_text(align='left', baseline='middle', dx=8, dy=-10, fontSize=12, fontWeight='bold').encode(text='Label:N')
        chart = (line + text).properties(height=350).interactive()
        
        st.altair_chart(chart, width="stretch")
    else:
        st.info("No TFSA accounts found.")
