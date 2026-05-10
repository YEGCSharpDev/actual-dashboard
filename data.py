"""
Data layer for Actual Budget Dashboard.

Handles all API communication via Node.js Sidecar (Actual API) and raw data retrieval.
"""
import json
import os
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
    
    args = [
        "node", "actual-helper.js",
        "--server-url", st.secrets["ACTUAL_SERVER_URL"],
        "--password", st.secrets["ACTUAL_PASSWORD"],
        "--sync-id", st.secrets["ACTUAL_SYNC_ID"],
        "--data-dir", data_dir
    ]
    
    if "ACTUAL_ENCRYPTION_PASSWORD" in st.secrets:
        args.extend(["--encryption-password", st.secrets["ACTUAL_ENCRYPTION_PASSWORD"]])

    with _cli_lock:
        try:
            result = subprocess.run(
                args,
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


# --- Data Extractors (Logic-only, no CLI calls) ---

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
        if not isinstance(rules, list): return 0.0
        max_goal = 0.0
        for rule in rules:
            if rule.get("type") == "simple":
                amt = rule.get("monthly", 0)
                max_goal = max(max_goal, amt / 100.0)
        return max_goal
    except Exception:
        return 0.0


def fetch_underbudgeted_amounts(all_data: dict) -> tuple[dict, list, str | None]:
    """
    For the current and next two months, calculate the total underfunded
    amount across all budget categories.

    Returns (results_dict, target_month_objects, error_message_or_None).
    """
    now = datetime.now()
    target_months = [now + relativedelta(months=i) for i in range(3)]
    months_str = [m.strftime("%Y%m") for m in target_months]

    results = {m: 0.0 for m in months_str}
    error_msg = all_data.get("error")

    if error_msg:
        return results, target_months, error_msg

    goal_map = {c["id"]: _parse_monthly_goal(c.get("goal_def")) for c in all_data.get("categories", [])}

    for m_obj in target_months:
        m_str_api = m_obj.strftime("%Y-%m")
        m_str_key = m_obj.strftime("%Y%m")
        budget_data = all_data.get("budgets", {}).get(m_str_api, [])
        categories = _get_categories_from_budget_data(budget_data)
        
        underfunded_total = 0.0
        for cat in categories:
            target = goal_map.get(cat.get("id"), 0.0)
            budgeted = cat.get("budgeted", 0) / 100.0
            
            # Match the legacy SQL: SUM(goal - amount) where amount < goal
            if budgeted < target:
                underfunded_total += (target - budgeted)
        
        results[m_str_key] = underfunded_total
        
    return results, target_months, None


def get_month_budgets(all_data: dict, month_str: str) -> dict:
    if len(month_str) == 6 and month_str.isdigit():
        month_str = f"{month_str[:4]}-{month_str[4:]}"
    
    budget_data = all_data.get("budgets", {}).get(month_str, [])
    categories = _get_categories_from_budget_data(budget_data)
    return {cat["name"]: cat.get("budgeted", 0) / 100.0 for cat in categories}
