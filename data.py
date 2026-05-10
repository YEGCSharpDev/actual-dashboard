"""
Data layer for Actual Budget Dashboard.

Handles all API communication via Node.js Sidecar (Actual API) and raw data retrieval.
"""
import json
import os
import sqlite3
import subprocess
import threading
from datetime import datetime

import pandas as pd
import streamlit as st
from dateutil.relativedelta import relativedelta


# --- Concurrency Control ---
_cli_lock = threading.Lock()


@st.cache_data(ttl=3600) # Cached for 1 hour
def fetch_all_dashboard_data() -> dict:
    """
    Invokes the Node.js sidecar to fetch all budget data in a single session.
    """
    data_dir = os.path.join(os.getcwd(), ".actual-data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Use official Actual CLI environment variable names for the sidecar
    env = {
        **os.environ,
        "ACTUAL_SERVER_URL": st.secrets["ACTUAL_SERVER_URL"],
        "ACTUAL_PASSWORD": st.secrets["ACTUAL_PASSWORD"],
        "ACTUAL_SYNC_ID": st.secrets["ACTUAL_SYNC_ID"],
        "ACTUAL_DATA_DIR": data_dir,
    }
    
    if "ACTUAL_ENCRYPTION_PASSWORD" in st.secrets:
        env["ACTUAL_ENCRYPTION_PASSWORD"] = st.secrets["ACTUAL_ENCRYPTION_PASSWORD"]

    args = ["node", "actual-helper.js"]

    with _cli_lock:
        try:
            result = subprocess.run(
                args,
                env=env,
                capture_output=True,
                text=True,
                check=True
            )
            
            # Extract JSON between markers
            output = result.stdout
            start_marker = "__ACTUAL_JSON_START__"
            end_marker = "__ACTUAL_JSON_END__"
            
            if start_marker not in output or end_marker not in output:
                raise RuntimeError(f"Malformed output from sidecar: {output}")
            
            raw_json = output.split(start_marker)[1].split(end_marker)[0].strip()
            res = json.loads(raw_json)
            
            # Post-process transactions into DataFrame
            if res.get("transactions"):
                df = pd.DataFrame(res["transactions"])
                # Map column names for compatibility
                df = df.rename(columns={
                    "payee.name": "Payee_Name",
                    "category.name": "Category_Name",
                    "category.id": "category",
                    "category.is_income": "is_income",
                    "category.group.name": "Group_Name"
                })
                # Conversions
                df["amount_dollars"] = df["amount"] / 100.0
                df["amount"] = df["amount"] / -100.0 # Standard expense signage
                df["Payee_Name"] = df["Payee_Name"].fillna("Unknown")
                df["Category_Name"] = df["Category_Name"].fillna("Uncategorized")
                df["Group_Name"] = df["Group_Name"].fillna("Other")
                df["date"] = pd.to_datetime(df["date"])
                res["transactions"] = df
            else:
                res["transactions"] = pd.DataFrame()
                
            res["error"] = None
            return res
            
        except subprocess.CalledProcessError as e:
            err_msg = e.stderr or ""
            return {"error": f"Sidecar failed: {err_msg}", "transactions": pd.DataFrame()}
        except Exception as e:
            return {"error": str(e), "transactions": pd.DataFrame()}


# --- SQLite Helpers (for precise analytical queries) ---

def query_local_db(query: str, params: tuple = ()) -> list:
    """
    Run a read-only SQL query against the locally synchronized Actual database.
    """
    data_dir = os.path.join(os.getcwd(), ".actual-data")
    # Find the first db.sqlite in the data directory (Actual API nested structure)
    db_path = None
    for root, dirs, files in os.walk(data_dir):
        if "db.sqlite" in files:
            db_path = os.path.join(root, "db.sqlite")
            break
            
    if not db_path:
        raise FileNotFoundError("Local Actual database (db.sqlite) not found. Run sync first.")

    # Use a read-only connection
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cursor = conn.cursor()
        cursor.execute(query, params)
        return cursor.fetchall()
    finally:
        conn.close()


# --- Data Extractors ---

def get_onbudget_transactions(all_data: dict) -> pd.DataFrame:
    df = all_data.get("transactions", pd.DataFrame())
    if df.empty: return df
    
    onbudget_ids = {
        acc["id"] for acc in all_data.get("accounts", []) 
        if not acc.get("offbudget") and not acc.get("closed")
    }
    return df[df["account"].isin(onbudget_ids)].copy()


def get_investment_balances(all_data: dict) -> dict:
    balances = {"RESP": {}, "RRSP": {}, "TFSA": {}}
    resp_id = st.secrets["resp"]["identifier"].upper()
    rrsp_id = st.secrets["rrsp"]["identifier"].upper()
    
    for acc in all_data.get("accounts", []):
        if not (acc.get("offbudget") and not acc.get("closed")):
            continue
        name = acc["name"].upper()
        acc_type = None
        if resp_id in name: acc_type = "RESP"
        elif rrsp_id in name: acc_type = "RRSP"
        elif "TFSA" in name: acc_type = "TFSA"
        
        if acc_type:
            balances[acc_type][acc["name"]] = acc.get("balance", 0) / 100.0
    return balances


@st.cache_data(ttl=300)
def fetch_underbudgeted_amounts(all_data: dict) -> tuple[dict, list, str | None]:
    """
    Calculate underfunded amounts by querying the 'zero_budgets' view in the local SQLite DB.
    """
    now = datetime.now()
    target_months = [now + relativedelta(months=i) for i in range(3)]
    months_str = [m.strftime("%Y%m") for m in target_months]

    results = {m: 0.0 for m in months_str}
    error_msg = all_data.get("error")

    if error_msg:
        return results, target_months, error_msg

    try:
        for m in months_str:
            # Replicating the legacy SQL logic that works perfectly with Actual's internal view
            rows = query_local_db(
                """
                SELECT COALESCE(SUM(zero_budgets.goal - zero_budgets.amount), 0) / 100.0
                FROM zero_budgets
                INNER JOIN categories ON categories.id = zero_budgets.category
                WHERE month = ?
                  AND amount < goal;
                """,
                (m,),
            )
            if rows and rows[0][0]:
                results[m] = rows[0][0]
    except Exception as e:
        error_msg = f"Failed to fetch underbudgeted amounts from SQLite: {e}"

    return results, target_months, error_msg


def get_month_budgets(all_data: dict, month_str: str) -> dict:
    """
    Retrieves monthly assignments using the pre-fetched API data for speed.
    """
    if len(month_str) == 6 and month_str.isdigit():
        month_str = f"{month_str[:4]}-{month_str[4:]}"
    
    budget_data = all_data.get("budgets", {}).get(month_str, [])
    
    # API parsing logic
    cats = []
    if isinstance(budget_data, list):
        for group in budget_data:
            if isinstance(group, dict): cats.extend(group.get("categories", []))
    elif isinstance(budget_data, dict):
        if "categories" in budget_data: cats = budget_data["categories"]
        elif "categoryGroups" in budget_data:
            for group in budget_data["categoryGroups"]:
                if isinstance(group, dict): cats.extend(group.get("categories", []))
                
    return {cat["name"]: cat.get("budgeted", 0) / 100.0 for cat in cats}
