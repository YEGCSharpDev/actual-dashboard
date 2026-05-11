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
from typing import TypedDict, List, Dict, Any, Optional

try:
    import fcntl
except ImportError:
    fcntl = None

import pandas as pd
import streamlit as st
from dateutil.relativedelta import relativedelta


class DashboardData(TypedDict):
    """Explicit type for the unified dashboard data blob. (P2-J)"""
    accounts: List[Dict[str, Any]]
    categories: List[Dict[str, Any]]
    transactions: pd.DataFrame
    budgets: Dict[str, Any]
    error: Optional[str]


# --- Concurrency & Path Control ---
_cli_lock = threading.Lock()
_cached_db_path = None # P2-3: Cache the resolved db.sqlite path


def normalize_transactions(raw_txns: list) -> pd.DataFrame:
    """
    Standardize raw transactions from the API into a consistent DataFrame. (P2-10)
    
    Sign Invariant: (P2-11)
    - 'amount_dollars': Inflow = Positive, Outflow = Negative.
    - 'amount': Inflow = Negative, Outflow = Positive (Cost to User convention).
    """
    if not raw_txns:
        return pd.DataFrame()

    df = pd.DataFrame(raw_txns)
    
    # Map column names for compatibility
    df = df.rename(columns={
        "payee.name": "Payee_Name",
        "category.name": "Category_Name",
        "category.id": "category",
        "category.is_income": "is_income",
        "category.group.name": "Group_Name"
    })

    # Amount conversion constants
    CENTS_DIVISOR = -100.0
    
    # Conversions
    df["amount_dollars"] = df["amount"] / 100.0
    df["amount"] = df["amount"] / CENTS_DIVISOR # Standard expense signage
    
    # Final cleanup
    df["Payee_Name"] = df["Payee_Name"].fillna("Unknown")
    df["Category_Name"] = df["Category_Name"].fillna("Uncategorized")
    df["Group_Name"] = df["Group_Name"].fillna("Other")
    df["date"] = pd.to_datetime(df["date"])
    
    return df


@st.cache_data(ttl=3600) # Cached for 1 hour
def fetch_all_dashboard_data() -> dict:
    """
    Invokes the Node.js sidecar to fetch all budget data in a single session.
    """
    global _cached_db_path
    _cached_db_path = None # Invalidate path cache on fresh fetch
    
    data_dir = os.path.join(os.getcwd(), ".actual-data")
    os.makedirs(data_dir, exist_ok=True)
    
    # P2-O: File-based locking to prevent multi-process races on .actual-data
    lock_path = os.path.join(data_dir, ".lock")
    
    # Pass configuration and secrets via env vars (P0-2, P0-A)
    env = os.environ.copy()
    env["ACTUAL_SERVER_URL"] = st.secrets["ACTUAL_SERVER_URL"]
    env["ACTUAL_PASSWORD"] = st.secrets["ACTUAL_PASSWORD"]
    env["ACTUAL_SYNC_ID"] = st.secrets["ACTUAL_SYNC_ID"]
    env["ACTUAL_DATA_DIR"] = data_dir
    
    if "ACTUAL_ENCRYPTION_PASSWORD" in st.secrets:
        env["ACTUAL_ENCRYPTION_PASSWORD"] = st.secrets["ACTUAL_ENCRYPTION_PASSWORD"]

    # Sidecar invoked with no secrets in argv
    args = ["node", "actual-helper.js"]

    with _cli_lock:
        if fcntl:
            with open(lock_path, "w") as lock_file:
                try:
                    # Exclusive non-blocking lock
                    fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return {"error": "Another process is currently syncing. Please wait.", 
                            "accounts": [], "categories": [], "transactions": pd.DataFrame(), "budgets": {}}

                return _invoke_sidecar(args, env)
        else:
            # Fallback for non-Unix (P1-B)
            st.warning("File locking not supported on this platform. Concurrent syncs may be unsafe.")
            return _invoke_sidecar(args, env)


def _invoke_sidecar(args, env) -> DashboardData:
    """Internal helper to execute the Node.js sidecar."""
    try:
        # Use Popen + communicate for safe large payload handling (P2-D)
        process = subprocess.Popen(
            args,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        try:
            stdout, stderr = process.communicate(timeout=300)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            return {"error": "Sidecar timed out — check server connectivity", 
                    "accounts": [], "categories": [], "transactions": pd.DataFrame(), "budgets": {}}

        if process.returncode != 0:
            return {"error": f"Sidecar failed: {stderr}", 
                    "accounts": [], "categories": [], "transactions": pd.DataFrame(), "budgets": {}}
        
        # Extract JSON between markers
        output = stdout
        start_marker = "__ACTUAL_JSON_START__"
        end_marker = "__ACTUAL_JSON_END__"
        
        if start_marker not in output or end_marker not in output:
            raise RuntimeError(f"Malformed output from sidecar: {output}")
        
        raw_json = output.split(start_marker)[1].split(end_marker)[0].strip()
        res = json.loads(raw_json)
        
        # Post-process transactions into DataFrame (P2-10)
        res["transactions"] = normalize_transactions(res.get("transactions", []))
        res["error"] = None
        return res
    except Exception as e:
        return {"error": str(e), 
                "accounts": [], "categories": [], "transactions": pd.DataFrame(), "budgets": {}}


# --- SQLite Helpers ---

def query_local_db(query: str, params: tuple = ()) -> list:
    """
    Run a read-only SQL query against the locally synchronized Actual database.
    """
    global _cached_db_path
    
    if not _cached_db_path:
        data_dir = os.path.join(os.getcwd(), ".actual-data")
        for root, dirs, files in os.walk(data_dir):
            if "db.sqlite" in files:
                _cached_db_path = os.path.join(root, "db.sqlite")
                break
            
    if not _cached_db_path:
        raise FileNotFoundError("Local Actual database (db.sqlite) not found. Run sync first.")

    conn = sqlite3.connect(f"file:{_cached_db_path}?mode=ro", uri=True)
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
    tfsa_id = st.secrets["tfsa"]["base"]["identifier"].upper() # P1-1: Use identifier from secrets
    
    for acc in all_data.get("accounts", []):
        if acc.get("closed"):
            continue
            
        name = acc["name"].upper()
        acc_type = None
        if resp_id in name: acc_type = "RESP"
        elif rrsp_id in name: acc_type = "RRSP"
        elif tfsa_id in name: acc_type = "TFSA"
        
        if acc_type:
            raw_balance = acc.get("balance_current")
            if raw_balance is None:
                raw_balance = 0
            balances[acc_type][acc["name"]] = raw_balance / 100.0
    return balances


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
    if len(month_str) == 6 and month_str.isdigit():
        month_str = f"{month_str[:4]}-{month_str[4:]}"
    
    budget_data = all_data.get("budgets", {}).get(month_str, [])
    
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
