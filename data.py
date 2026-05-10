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


@st.cache_data(ttl=3600) # Cached for 1 hour as requested
def fetch_all_dashboard_data() -> dict:
    """
    The 'One Fetch' function. Retrieves all accounts, categories, 
    historical transactions, and budget data for the 3-month health window.
    
    Returns a dictionary containing all raw data for local processing.
    """
    data = {
        "accounts": [],
        "categories": [],
        "transactions": pd.DataFrame(),
        "budgets": {}, # month_str -> category_data
        "error": None
    }
    
    try:
        # 1. Accounts
        data["accounts"] = run_actual_query(["accounts", "list"])
        
        # 2. Categories (with goals)
        data["categories"] = run_actual_query([
            "query", "run", 
            "--table", "categories",
            "--select", "id,name,goal_def,is_income,group.name"
        ])
        
        # 3. All Transactions
        q_filter = {"is_parent": False}
        raw_txns = run_actual_query([
            "query", "run", 
            "--table", "transactions",
            "--filter", json.dumps(q_filter),
            "--select", "date,amount,account,account.name,payee.name,category.id,category.name,category.is_income,category.group.name"
        ])
        
        if raw_txns:
            df = pd.DataFrame(raw_txns)
            # Map column names
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
            data["transactions"] = df

        # 4. Budgets (3-month window)
        now = datetime.now()
        target_months = [now + relativedelta(months=i) for i in range(3)]
        for m_obj in target_months:
            m_str = m_obj.strftime("%Y-%m")
            data["budgets"][m_str] = run_actual_query(["budgets", "month", m_str])
            
    except Exception as e:
        data["error"] = str(e)
        st.error(f"Unified data fetch failed: {e}")

    return data


def run_actual_query(args: list) -> any:
    """
    Execute an Actual CLI command using explicit flags for connectivity.
    No internal cache here - we rely on fetch_all_dashboard_data caching.
    """
    data_dir = os.path.join(os.getcwd(), ".actual-data")
    os.makedirs(data_dir, exist_ok=True)
    
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
            err_msg = e.stderr or ""
            raise RuntimeError(err_msg if "too-many-requests" not in err_msg else "too-many-requests")
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON from CLI: {result.stdout}")


# Amount conversion constants
CENTS_DIVISOR = -100.0


def _get_categories_from_budget_data(data: any) -> list:
    if isinstance(data, list):
        cats = []
        for group in data:
            if isinstance(group, dict):
                cats.extend(group.get("categories", []))
        return cats
    elif isinstance(data, dict):
        if "categories" in data:
            return data["categories"]
        if "categoryGroups" in data:
            cats = []
            for group in data["categoryGroups"]:
                if isinstance(group, dict):
                    cats.extend(group.get("categories", []))
            return cats
    return []


def _parse_monthly_goal(goal_def: str | None) -> float:
    if not goal_def:
        return 0.0
    try:
        rules = json.loads(goal_def)
        if not isinstance(rules, list):
            return 0.0
        max_goal = 0.0
        for rule in rules:
            if rule.get("type") == "simple":
                amt = rule.get("monthly", 0)
                max_goal = max(max_goal, amt / 100.0)
        return max_goal
    except Exception:
        return 0.0


# --- Data Extractors (Logic-only, no CLI calls) ---

def get_onbudget_transactions(all_data: dict) -> pd.DataFrame:
    df = all_data["transactions"]
    if df.empty: return df
    
    onbudget_ids = {
        acc["id"] for acc in all_data["accounts"] 
        if not acc.get("offbudget") and not acc.get("closed")
    }
    return df[df["account"].isin(onbudget_ids)].copy()


def get_investment_balances(all_data: dict) -> dict:
    balances = {"RESP": {}, "RRSP": {}, "TFSA": {}}
    resp_id = st.secrets["resp"]["identifier"].upper()
    rrsp_id = st.secrets["rrsp"]["identifier"].upper()
    
    for acc in all_data["accounts"]:
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


def get_underfunded_amounts(all_data: dict) -> tuple[dict, list]:
    now = datetime.now()
    target_months = [now + relativedelta(months=i) for i in range(3)]
    results = {}
    
    goal_map = {c["id"]: _parse_monthly_goal(c.get("goal_def")) for c in all_data["categories"]}

    for m_obj in target_months:
        m_str = m_obj.strftime("%Y-%m")
        budget_data = all_data["budgets"].get(m_str, [])
        categories = _get_categories_from_budget_data(budget_data)
        
        total = 0.0
        for cat in categories:
            target = goal_map.get(cat.get("id"), 0.0)
            budgeted = cat.get("budgeted", 0) / 100.0
            if budgeted < target:
                total += (target - budgeted)
            balance = cat.get("balance", 0) / 100.0
            if balance < 0 and budgeted >= target:
                total += abs(balance)
        results[m_str.replace("-", "")] = total
        
    return results, target_months


def get_month_budgets(all_data: dict, month_str: str) -> dict:
    if len(month_str) == 6 and month_str.isdigit():
        month_str = f"{month_str[:4]}-{month_str[4:]}"
    
    budget_data = all_data["budgets"].get(month_str, [])
    categories = _get_categories_from_budget_data(budget_data)
    return {cat["name"]: cat.get("budgeted", 0) / 100.0 for cat in categories}
