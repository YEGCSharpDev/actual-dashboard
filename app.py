import streamlit as st
import pandas as pd
import requests
from datetime import datetime
import altair as alt

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
    
    raw_txns = []
    for acc_id in active_accounts:
        current_year = datetime.now().year
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
    
    df_merged['amount'] = (df_merged['amount'] / -100.0)
    
    df_expenses = df_merged[
        (df_merged['is_income'] != True) & 
        (df_merged['category'].notna()) & 
        (df_merged['tombstone'] == False)
    ].copy()
    
    df_expenses['date'] = pd.to_datetime(df_expenses['date'])
    return df_expenses

@st.cache_data(ttl=300)
def fetch_investment_balances():
    accounts_res = requests.get(f"{API_URL}/accounts", headers=HEADERS).json().get('data', [])
    balances = {'RESP': {}, 'RRSP': {}, 'TFSA': {}}
    
    for acc in accounts_res:
        if acc.get('offbudget') and not acc.get('closed'):
            name = acc['name'].upper()
            acc_type = None
            
            if "RESP" in name: acc_type = 'RESP'
            elif "RRSP" in name: acc_type = 'RRSP'
            elif "TFSA" in name: acc_type = 'TFSA'
            
            if acc_type:
                bal_res = requests.get(f"{API_URL}/accounts/{acc['id']}/balance", headers=HEADERS).json()
                balances[acc_type][acc['name']] = bal_res.get('data', 0) / 100.0
                
    return balances

# --- UI Rendering ---
st.title("💸 Actual Budget Dashboard")

with st.spinner("Fetching data from Actual API..."):
    df = fetch_actual_data()

# Sidebar Filters
st.sidebar.header("Filters")
month_options = sorted(df['date'].dt.strftime('%Y-%m').unique(), reverse=True)
selected_month = st.sidebar.selectbox("Select Month", month_options)

# Apply Filter
df_filtered = df[df['date'].dt.strftime('%Y-%m') == selected_month]

# --- Dashboard Layout ---
total_spent = df_filtered['amount'].sum()
st.metric(label=f"Total Expenses for {selected_month}", value=f"${total_spent:,.2f}")

col1, col2 = st.columns(2)

with col1:
    st.subheader("Spending by Category")
    cat_summary = df_filtered.groupby('Category_Name')['amount'].sum().sort_values(ascending=False)
    st.bar_chart(cat_summary, horizontal=True)

with col2:
    st.subheader("Transaction Log")
    display_df = df_filtered[['date', 'Payee_Name', 'Category_Name', 'amount']].sort_values(by='date', ascending=False)
    display_df['date'] = display_df['date'].dt.strftime('%Y-%m-%d')
    st.dataframe(display_df, width="stretch", hide_index=True)

# --- TFSA Contributions (YTD) ---
st.markdown("---")
st.header("📈 TFSA Contributions (YTD)")

tfsa_cats = st.secrets["categories"]["tfsa_tracking"]
df_tfsa = df[df['Category_Name'].isin(tfsa_cats)].copy()

if not df_tfsa.empty:
    tfsa_total = df_tfsa['amount'].sum()
    
    # Dynamically match totals based on configured category names
    cat_totals = {}
    for cat in tfsa_cats:
        cat_totals[cat] = df_tfsa[df_tfsa['Category_Name'] == cat]['amount'].sum()
    
    TFSA_LIMIT = float(st.secrets["tfsa"]["ytd_limit"])
    progress_pct = min(tfsa_total / TFSA_LIMIT, 1.0)

    # Dynamic columns based on number of configured TFSA categories
    cols = st.columns(len(tfsa_cats) + 1)
    for i, (cat, total) in enumerate(cat_totals.items()):
        cols[i].metric(cat, f"${total:,.2f}")
    cols[-1].metric("Total Contributed", f"${tfsa_total:,.2f}", f"{(tfsa_total/TFSA_LIMIT)*100:.1f}% of ${TFSA_LIMIT:,.2f} Limit")

    st.progress(progress_pct)
    
    st.subheader("Contribution Velocity")
    daily_tfsa = df_tfsa.groupby(['date', 'Category_Name'])['amount'].sum().reset_index()
    chart_data = daily_tfsa.pivot(index='date', columns='Category_Name', values='amount').fillna(0)
    chart_data = chart_data.cumsum()
    st.area_chart(chart_data)
else:
    st.info("No TFSA contributions found for this year yet.")

# --- Investment Forecasting ---
st.markdown("---")
st.header("🔮 Investment Forecasts")

balances = fetch_investment_balances()
current_year = datetime.now().year

def render_forecast_section(title, account_dict, years_to_track, return_rate, annual_contribution=0):
    if not account_dict:
        return
        
    st.subheader(title)
    
    cols = st.columns(len(account_dict))
    for i, (name, bal) in enumerate(account_dict.items()):
        cols[i].metric(name, f"${bal:,.2f}")
        
    forecast_data = []
    
    for name, initial_balance in account_dict.items():
        current_balance = initial_balance
        
        for year_offset in range(years_to_track + 1):
            future_year = current_year + year_offset
            is_milestone = (year_offset % 5 == 0) or (year_offset == years_to_track)
            
            forecast_data.append({
                "Year": future_year,
                "Account": name,
                "Projected Balance": current_balance,
                "Label": f"${current_balance:,.0f}" if is_milestone else ""
            })
            
            current_balance = (current_balance * (1 + return_rate)) + annual_contribution
            
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
resp_cfg = st.secrets["resp"]
resp_return_pct = st.slider("RESP Expected YoY Return (%)", min_value=0.0, max_value=15.0, value=float(resp_cfg["default_return_pct"]), step=0.5)
render_forecast_section(
    f"🎓 RESP Forecast ({resp_cfg['horizon_years']}-Year Horizon, ${resp_cfg['monthly_contribution']}/mo Contribution)", 
    balances.get('RESP', {}), 
    years_to_track=int(resp_cfg["horizon_years"]), 
    return_rate=(resp_return_pct / 100.0), 
    annual_contribution=(float(resp_cfg["monthly_contribution"]) * 12)
)
st.markdown("---")

# --- RRSP Section ---
rrsp_cfg = st.secrets["rrsp"]
rrsp_return_pct = st.slider("RRSP Expected YoY Return (VEQT Average) (%)", min_value=0.0, max_value=15.0, value=float(rrsp_cfg["default_return_pct"]), step=0.5)
render_forecast_section(
    f"🏦 RRSP Forecast ({rrsp_cfg['horizon_years']}-Year Horizon, 100% VEQT, ${rrsp_cfg['annual_contribution']}/yr Contribution)", 
    balances.get('RRSP', {}), 
    years_to_track=int(rrsp_cfg["horizon_years"]), 
    return_rate=(rrsp_return_pct / 100.0), 
    annual_contribution=float(rrsp_cfg["annual_contribution"])
)
st.markdown("---")

# --- TFSA Section ---
tfsa_cfg = st.secrets["tfsa"]
st.subheader(f"📈 TFSA Forecast ({tfsa_cfg['horizon_years']}-Year Horizon, Custom Catch-up Rules)")

col_t1, col_t2 = st.columns(2)
with col_t1:
    tfsa_base_return_pct = st.slider("Base TFSA Expected YoY Return (%)", min_value=0.0, max_value=15.0, value=float(tfsa_cfg["base"]["default_return_pct"]), step=0.5)
with col_t2:
    tfsa_ws_return_pct = st.slider("Catch-up TFSA Expected YoY Return (%)", min_value=0.0, max_value=15.0, value=float(tfsa_cfg["catchup"]["default_return_pct"]), step=0.5)

tfsa_balances = balances.get('TFSA', {})

if tfsa_balances:
    cols = st.columns(len(tfsa_balances))
    for i, (name, bal) in enumerate(tfsa_balances.items()):
        cols[i].metric(name, f"${bal:,.2f}")
        
    forecast_data = []
    
    # Load Financial Configuration from Secrets
    ANNUAL_TFSA_ROOM = float(tfsa_cfg["annual_room"])
    BASE_TFSA_MONTHLY = float(tfsa_cfg["base"]["monthly_contribution"])
    BASE_TFSA_ANNUAL = BASE_TFSA_MONTHLY * 12
    WS_CATCHUP_YEAR_ANNUAL = float(tfsa_cfg["catchup"]["catchup_year_contribution"])
    WS_FUTURE_ANNUAL = ANNUAL_TFSA_ROOM - BASE_TFSA_ANNUAL
    
    base_match = tfsa_cfg["base"]["identifier"].upper()
    catchup_match = tfsa_cfg["catchup"]["identifier"].upper()
    
    for name, initial_balance in tfsa_balances.items():
        current_balance = initial_balance
        
        is_catchup = catchup_match in name.upper()
        return_rate = (tfsa_ws_return_pct / 100.0) if is_catchup else (tfsa_base_return_pct / 100.0)
        
        for year_offset in range(int(tfsa_cfg["horizon_years"]) + 1):
            future_year = current_year + year_offset
            is_milestone = (year_offset % 5 == 0) or (year_offset == int(tfsa_cfg["horizon_years"]))
            
            forecast_data.append({
                "Year": future_year,
                "Account": name,
                "Projected Balance": current_balance,
                "Label": f"${current_balance:,.0f}" if is_milestone else ""
            })
            
            if is_catchup:
                contrib = WS_CATCHUP_YEAR_ANNUAL if year_offset == 0 else WS_FUTURE_ANNUAL
            else:
                contrib = BASE_TFSA_ANNUAL
                
            current_balance = (current_balance * (1 + return_rate)) + contrib
            
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
    
    st.altair_chart(chart, use_container_width=True)