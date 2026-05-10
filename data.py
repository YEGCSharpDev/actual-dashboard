"""
Data layer for Actual Budget Dashboard.

Handles all API communication via Actual CLI and raw data retrieval.
"""
import json
import os
import subprocess
import threading
from datetime import datetime

import pandas as pd
import streamlit as st
from dateutil.relativedelta import relativedelta


# --- CLI Wrapper ---
_cli_lock = threading.Lock()


@st.cache_data(ttl=300)
def run_actual_query(args: list) -> any:
    """
    Execute an Actual CLI command using explicit flags for connectivity.
    """
    data_dir = os.path.join(os.getcwd(), ".actual-data")
    os.makedirs(data_dir, exist_ok=True)
    
    # Use explicit flags instead of env vars for maximum reliability
    base_args = [
        "actual",
        "--server-url", st.secrets["ACTUAL_SERVER_URL"],
        "--password", st.secrets["ACTUAL_PASSWORD"],
        "--sync-id", st.secrets["ACTUAL_SYNC_ID"],
        "--data-dir", data_dir,
        "--format", "json"
    ]
    
    if "ACTUAL_ENCRYPTION_PASSWORD" in st.secrets:
        base_args.extend(["--encryption-password", st.secrets["ACTUAL_ENCRYPTION_PASSWORD"]])

    with _cli_lock:
        try:
            # Use 'actual' directly instead of 'npx' for speed and to avoid extra checks
            # This works because we pre-install it in Docker and Nix shell
            result = subprocess.run(
                base_args + args,
                capture_output=True,
                text=True,
                check=True
            )
            if not result.stdout.strip():
                return []
            return json.loads(result.stdout)
        except subprocess.CalledProcessError as e:
            # Check for rate limiting to provide a better UI message
            err_msg = e.stderr or ""
            if "too-many-requests" in err_msg:
                st.error("Actual server is rate-limiting requests. Please wait a minute and refresh.")
            else:
                st.error(f"Actual CLI error: {err_msg}")
            raise RuntimeError(f"CLI command failed: {err_msg}")
        except json.JSONDecodeError as e:
            st.error(f"Failed to parse CLI output: {e}")
            raise RuntimeError(f"Invalid JSON from CLI: {result.stdout}")


# Amount conversion: Actual stores amounts as integers in cents.
# Expenses are negative (so dividing by -100 makes them positive).
# Income is positive in Actual (so dividing by -100 makes it negative; we re-flip later).
CENTS_DIVISOR = -100.0


@st.cache_data(ttl=300)
def fetch_actual_data() -> pd.DataFrame:
    """
    Fetch all on-budget transactions for the current year in a single batch.
    Returns a cleaned DataFrame with amounts in dollars.
    """
    current_year = datetime.now().year
    
    # 1. Fetch metadata in one go (already fast)
    try:
        accounts = run_actual_query(["accounts", "list"])
    except Exception as e:
        st.error(f"Failed to fetch metadata from Actual: {e}")
        return pd.DataFrame()

    active_onbudget_ids = {
        acc["id"] for acc in accounts 
        if not acc.get("offbudget") and not acc.get("closed")
    }

    # 2. Batch fetch transactions for ALL accounts for the year
    # We use AQL to get category and payee names directly via joins
    try:
        # Filter is_parent: false to avoid double counting split transactions
        q_filter = {
            "date": {"$gte": f"{current_year}-01-01"},
            "is_parent": False
        }
        raw_txns = run_actual_query([
            "query", "run", 
            "--table", "transactions",
            "--filter", json.dumps(q_filter),
            "--select", "date,amount,account,account.name,payee.name,category.id,category.name,category.is_income,category.group.name"
        ])
    except Exception as e:
        st.error(f"Failed to batch fetch transactions: {e}")
        return pd.DataFrame()

    if not raw_txns:
        return pd.DataFrame()

    # 3. Clean and filter locally
    df = pd.DataFrame(raw_txns)
    
    # Filter to only on-budget accounts
    df = df[df["account"].isin(active_onbudget_ids)].copy()
    
    if df.empty:
        return df

    # Map column names to maintain compatibility with existing app logic
    df = df.rename(columns={
        "payee.name": "Payee_Name",
        "category.name": "Category_Name",
        "category.id": "category",
        "category.is_income": "is_income",
        "category.group.name": "Group_Name"
    })

    # Convert from negative-integer-cents to dollars
    df["amount"] = df["amount"] / CENTS_DIVISOR

    # Final cleanup
    df["Payee_Name"] = df["Payee_Name"].fillna("Unknown")
    df["Category_Name"] = df["Category_Name"].fillna("Uncategorized")
    df["Group_Name"] = df["Group_Name"].fillna("Other")
    df["date"] = pd.to_datetime(df["date"])
    
    return df


@st.cache_data(ttl=600)
def fetch_all_transactions() -> pd.DataFrame:
    """
    Fetch ALL transactions from ALL accounts for the entire budget history in a single batch.
    Used for historical Net Worth and Advanced Analytics.
    """
    try:
        # Fetch only non-closed accounts to speed up potential future joins
        accounts = run_actual_query(["accounts", "list"])
        active_ids = {acc["id"] for acc in accounts if not acc.get("closed")}
        
        # Batch fetch all transactions
        q_filter = {"is_parent": False} # Get subtransactions for accuracy
        raw_txns = run_actual_query([
            "query", "run", 
            "--table", "transactions",
            "--filter", json.dumps(q_filter),
            "--select", "date,amount,account,account.name,payee.name,category.id,category.name,category.is_income,category.group.name"
        ])
    except Exception as e:
        st.error(f"Failed to batch fetch full history: {e}")
        return pd.DataFrame()

    if not raw_txns:
        return pd.DataFrame()

    df = pd.DataFrame(raw_txns)
    
    # Filter to active accounts
    df = df[df["account"].isin(active_ids)].copy()
    
    # Map column names
    df = df.rename(columns={
        "payee.name": "Payee_Name",
        "category.name": "Category_Name",
        "category.id": "category",
        "category.is_income": "is_income",
        "category.group.name": "Group_Name"
    })

    # Standardize signage (Positive = Inflow, Negative = Outflow)
    df["amount_dollars"] = df["amount"] / 100.0
    
    # Compat: also provide 'amount' in positive-expense format for some logic
    df["amount"] = df["amount"] / CENTS_DIVISOR
    
    # Final cleanup
    df["Payee_Name"] = df["Payee_Name"].fillna("Unknown")
    df["Category_Name"] = df["Category_Name"].fillna("Uncategorized")
    df["Group_Name"] = df["Group_Name"].fillna("Other")
    df["date"] = pd.to_datetime(df["date"])
    
    return df


@st.cache_data(ttl=300)
def fetch_investment_balances() -> dict:
    """
    Fetch current balances for off-budget investment accounts (RESP, RRSP, TFSA).
    Uses data from the accounts list directly to avoid extra CLI calls.
    """
    try:
        accounts_res = run_actual_query(["accounts", "list"])
    except Exception as e:
        st.error(f"Failed to fetch accounts list: {e}")
        return {"RESP": {}, "RRSP": {}, "TFSA": {}}

    balances: dict[str, dict[str, float]] = {"RESP": {}, "RRSP": {}, "TFSA": {}}

    resp_id = st.secrets["resp"]["identifier"].upper()
    rrsp_id = st.secrets["rrsp"]["identifier"].upper()
    tfsa_id = "TFSA"

    for acc in accounts_res:
        if not (acc.get("offbudget") and not acc.get("closed")):
            continue

        name = acc["name"].upper()
        acc_type = None

        if resp_id in name:
            acc_type = "RESP"
        elif rrsp_id in name:
            acc_type = "RRSP"
        elif tfsa_id in name:
            acc_type = "TFSA"

        if acc_type:
            # Account list already contains current balances in integer cents
            balances[acc_type][acc["name"]] = acc.get("balance", 0) / 100.0

    return balances


def _get_categories_from_budget_data(data: any) -> list:
    """
    Extract a flat list of category objects from various Actual CLI budget formats.
    Handles both list-of-groups and root-object-with-categories responses.
    """
    if isinstance(data, list):
        # Format: list of category groups
        cats = []
        for group in data:
            if isinstance(group, dict):
                cats.extend(group.get("categories", []))
        return cats
    elif isinstance(data, dict):
        # Format: root dict with 'categories' or 'categoryGroups'
        if "categories" in data:
            return data["categories"]
        if "categoryGroups" in data:
            cats = []
            for group in data["categoryGroups"]:
                if isinstance(group, dict):
                    cats.extend(group.get("categories", []))
            return cats
    return []


@st.cache_data(ttl=300)
def fetch_underbudgeted_amounts() -> tuple[dict, list, str | None]:
    """
    For the current and next two months, calculate the total underfunded
    amount across all budget categories.
    """
    now = datetime.now()
    target_months = [now + relativedelta(months=i) for i in range(3)]
    months_str = [m.strftime("%Y-%m") for m in target_months]

    results = {m.replace("-", ""): 0.0 for m in months_str}
    error_msg = None

    try:
        for m in months_str:
            data = run_actual_query(["budgets", "month", m])
            categories = _get_categories_from_budget_data(data)
            
            underfunded_total = 0.0
            for cat in categories:
                # In Actual, a category is underfunded if budgeted < goal
                # We check for both 'goal' and 'target' as field names can vary
                goal = cat.get("goal") or cat.get("target") or 0
                budgeted = cat.get("budgeted", 0)
                
                if budgeted < goal:
                    underfunded_total += (goal - budgeted) / 100.0
            
            results[m.replace("-", "")] = underfunded_total
    except Exception as e:
        error_msg = f"Failed to fetch underbudgeted amounts: {e}"

    return results, target_months, error_msg


@st.cache_data(ttl=300)
def fetch_month_budgets(month_str: str) -> dict:
    """
    Fetch the assigned (budgeted) amounts for all categories for a specific month.
    """
    if len(month_str) == 6 and month_str.isdigit():
        month_str = f"{month_str[:4]}-{month_str[4:]}"

    budgets: dict[str, float] = {}
    try:
        data = run_actual_query(["budgets", "month", month_str])
        categories = _get_categories_from_budget_data(data)
        for cat in categories:
            budgets[cat["name"]] = cat.get("budgeted", 0) / 100.0
    except Exception as e:
        st.warning(f"Failed to fetch category budgets: {e}")

    return budgets
