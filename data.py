"""
Data layer for Actual Budget Dashboard.

Handles all API communication, SQLite export caching, and raw data retrieval.
"""

import io
import os
import sqlite3
import tempfile
import zipfile
from datetime import datetime

import pandas as pd
import requests
import streamlit as st
from dateutil.relativedelta import relativedelta


# --- Configuration ---
API_URL = st.secrets["ACTUAL_URL"]
HEADERS = {"x-api-key": st.secrets["ACTUAL_API_KEY"]}
API_TIMEOUT = 15

# Amount conversion: Actual stores amounts as negative integer cents.
# Expenses are negative (so dividing by -100 makes them positive).
# Income is positive in Actual (so dividing by -100 makes it negative; we re-flip later).
CENTS_DIVISOR = -100.0


def _api_get(path: str) -> dict:
    """Make an authenticated GET request to the Actual API."""
    resp = requests.get(f"{API_URL}/{path}", headers=HEADERS, timeout=API_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


@st.cache_data(ttl=300)
def _fetch_export_db_bytes() -> bytes:
    """
    Download the Actual budget export ZIP and extract the SQLite database bytes.

    Cached so that multiple functions needing the export DB share a single download.
    """
    resp = requests.get(f"{API_URL}/export", headers=HEADERS, timeout=API_TIMEOUT)
    resp.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(resp.content)) as z:
        return z.read("db.sqlite")


def query_export_db(query: str, params: tuple = ()) -> list:
    """
    Run a read-only SQL query against the cached Actual export database.

    Returns a list of tuples (rows).
    """
    db_bytes = _fetch_export_db_bytes()
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = os.path.join(tmp_dir, "db.sqlite")
        with open(tmp_path, "wb") as f:
            f.write(db_bytes)

        conn = sqlite3.connect(tmp_path)
        try:
            cursor = conn.cursor()
            cursor.execute(query, params)
            return cursor.fetchall()
        finally:
            conn.close()


@st.cache_data(ttl=300)
def fetch_actual_data() -> pd.DataFrame:
    """
    Fetch all on-budget transactions for the current year, merged with
    category and payee names.

    Returns a cleaned DataFrame with amounts in dollars (positive = expense,
    negative = income before re-flip).
    """
    cats_res = _api_get("categories")["data"]
    payees_res = _api_get("payees")["data"]
    accounts_res = _api_get("accounts")["data"]

    active_accounts = [
        acc["id"]
        for acc in accounts_res
        if not acc.get("offbudget") and not acc.get("closed")
    ]

    current_year = datetime.now().year
    raw_txns = []

    for acc_id in active_accounts:
        try:
            data = _api_get(
                f"accounts/{acc_id}/transactions?since_date={current_year}-01-01"
            )
        except requests.RequestException as exc:
            st.warning(f"Failed to fetch transactions for account {acc_id}: {exc}")
            continue

        txns = data.get("data", [])
        for txn in txns:
            if txn.get("subtransactions"):
                for sub in txn["subtransactions"]:
                    sub["date"] = txn["date"]
                    sub["payee"] = sub.get("payee") or txn.get("payee")
                    raw_txns.append(sub)
            else:
                raw_txns.append(txn)

    df_txns = pd.DataFrame(raw_txns)
    if df_txns.empty:
        return df_txns

    df_cats = pd.DataFrame(cats_res)[["id", "name", "is_income"]].rename(
        columns={"id": "category", "name": "Category_Name"}
    )
    df_payees = pd.DataFrame(payees_res)[["id", "name"]].rename(
        columns={"id": "payee", "name": "Payee_Name"}
    )

    df_merged = df_txns.merge(df_cats, on="category", how="left")
    df_merged = df_merged.merge(df_payees, on="payee", how="left")

    df_merged["Payee_Name"] = (
        df_merged["Payee_Name"].fillna(df_merged["imported_payee"]).fillna("Unknown")
    )
    df_merged["Category_Name"] = df_merged["Category_Name"].fillna("Uncategorized")

    # Convert from negative-integer-cents to dollars
    df_merged["amount"] = df_merged["amount"] / CENTS_DIVISOR

    df_clean = df_merged[
        df_merged["category"].notna() & ~df_merged["tombstone"].astype(bool)
    ].copy()

    df_clean["date"] = pd.to_datetime(df_clean["date"])
    return df_clean


@st.cache_data(ttl=300)
def fetch_investment_balances() -> dict:
    """
    Fetch current balances for off-budget investment accounts (RESP, RRSP, TFSA).

    Returns a dict like {'RESP': {name: balance}, 'RRSP': {...}, 'TFSA': {...}}.
    """
    accounts_res = _api_get("accounts").get("data", [])
    balances: dict[str, dict[str, float]] = {"RESP": {}, "RRSP": {}, "TFSA": {}}

    resp_id = st.secrets["resp"]["identifier"].upper()
    rrsp_id = st.secrets["rrsp"]["identifier"].upper()
    tfsa_id = "TFSA"

    for acc in accounts_res:
        if not (acc.get("offbudget") and not acc.get("closed")):
            continue

        name = acc["name"].upper()
        acc_type = None

        # Match in priority order to avoid substring collisions
        if resp_id in name:
            acc_type = "RESP"
        elif rrsp_id in name:
            acc_type = "RRSP"
        elif tfsa_id in name:
            acc_type = "TFSA"

        if acc_type:
            try:
                bal_res = _api_get(f"accounts/{acc['id']}/balance")
                balances[acc_type][acc["name"]] = bal_res.get("data", 0) / 100.0
            except requests.RequestException as exc:
                st.warning(
                    f"Failed to fetch balance for {acc['name']}: {exc}"
                )

    return balances


@st.cache_data(ttl=300)
def fetch_underbudgeted_amounts() -> tuple[dict, list, str | None]:
    """
    For the current and next two months, calculate the total underfunded
    amount across all budget categories.

    Returns (results_dict, target_month_objects, error_message_or_None).
    """
    now = datetime.now()
    target_months = [now + relativedelta(months=i) for i in range(3)]
    months_str = [m.strftime("%Y%m") for m in target_months]

    results = {m: 0.0 for m in months_str}
    error_msg = None

    try:
        for m in months_str:
            rows = query_export_db(
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
        error_msg = f"Failed to fetch underbudgeted amounts: {e}"

    return results, target_months, error_msg


@st.cache_data(ttl=300)
def fetch_month_budgets(month_str: str) -> dict:
    """
    Fetch the assigned (budgeted) amounts for all categories for a specific month.

    Args:
        month_str: Month in YYYYMM format.

    Returns a dict mapping category name -> budgeted dollar amount.
    """
    budgets: dict[str, float] = {}
    try:
        rows = query_export_db(
            """
            SELECT categories.name, COALESCE(zero_budgets.amount, 0) / 100.0
            FROM zero_budgets
            INNER JOIN categories ON categories.id = zero_budgets.category
            WHERE month = ?
            """,
            (month_str,),
        )
        for row in rows:
            budgets[row[0]] = row[1]
    except Exception as e:
        st.warning(f"Failed to fetch category budgets: {e}")

    return budgets