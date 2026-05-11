"""
Business logic and data transforms for Actual Budget Dashboard.

Pure functions that operate on DataFrames and dicts — no Streamlit UI calls.
"""

import ast
import calendar
import html
import math
import operator
from datetime import datetime

import pandas as pd

# --- Constants ---
LABEL_THRESHOLD_PCT = 20
BAR_HEIGHT_PX = 28
SANKEY_HEIGHT_PX = 750
FORECAST_CHART_HEIGHT_PX = 350

# Color palette
COLOR_GREEN = "#28a745"
COLOR_RED = "#dc3545"
COLOR_YELLOW = "#ffc107"
COLOR_GRAY = "#6c757d"
COLOR_GREEN_BG = "rgba(40,167,69,0.15)"
COLOR_RED_BG = "rgba(220,53,69,0.15)"
COLOR_YELLOW_BG = "rgba(255,193,7,0.15)"
COLOR_GREEN_LINK = "rgba(40, 167, 69, 0.4)"
COLOR_RED_LINK = "rgba(220, 53, 69, 0.4)"
COLOR_RED_LINK_LIGHT = "rgba(220, 53, 69, 0.2)"
COLOR_YELLOW_LINK = "rgba(255, 193, 7, 0.4)"


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
    """Safely evaluate a simple arithmetic expression string (e.g. '500+200')."""
    if not expr_str or not expr_str.strip():
        return 0.0
    try:
        tree = ast.parse(expr_str.strip(), mode="eval")
        return float(_eval_node(tree.body))
    except Exception:
        return 0.0


# --- DataFrame Helpers ---
def split_income_expenses(
    df: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split a filtered transaction DataFrame into income and expense frames.

    Invariant: The 'amount' column follows the 'cost_to_user' convention:
    - Positive values represent Expenses (cash outflow).
    - Negative values represent Income (cash inflow).
    (P2-11)
    """
    df_income = df[df["is_income"].eq(True)].copy()
    # Flip back to positive for UI display
    df_income["amount"] = df_income["amount"] * -1

    df_expenses = df[~df["is_income"].eq(True)].copy()
    return df_income, df_expenses


def build_net_worth_series(df_all: pd.DataFrame, current_balance: float) -> pd.DataFrame:
    """
    Calculate historical net worth by performing a cumulative sum of all
    transactions (including off-budget) across all accounts, anchored to the
    known current total balance. (Correctness Fix: P1-3)

    Args:
        df_all: DataFrame containing all transactions from all accounts 
                (on-budget + off-budget). (P2-12)
                Expects 'amount_dollars' where Positive = Inflow.
        current_balance: The current total balance of all active accounts in dollars.

    Returns:
        DataFrame with ['date', 'monthly_change', 'net_worth'] grouped by month.
    """
    if df_all.empty:
        return pd.DataFrame()

    # Guard: If data exists but current balance is negligible, we likely have all accounts 
    # excluded. Return empty to avoid a misleading negative wealth trend. (P2-P, P2-S)
    if abs(current_balance) < 1.0:
        return pd.DataFrame()

    # Sort by date for cumulative sum
    df_sorted = df_all.sort_values("date")

    # Group by month and sum the inflows/outflows
    # Use 'ME' (Month End) or 'M' for resampling
    monthly = (
        df_sorted.set_index("date")
        .resample("ME")["amount_dollars"]
        .sum()
        .reset_index()
    )

    # To anchor the history, we calculate the cumulative sum of deltas backward
    # from the current known balance.
    total_delta = monthly["amount_dollars"].sum()
    history_start = current_balance - total_delta
    
    monthly["net_worth"] = (history_start + monthly["amount_dollars"].cumsum()).round(2)
    monthly["amount_dollars"] = monthly["amount_dollars"].round(2)

    # Rename columns for clarity
    monthly = monthly.rename(columns={"amount_dollars": "monthly_change"})

    return monthly


def calculate_mtd_normalized_total(df: pd.DataFrame, day_cutoff: int) -> float:
    """
    Calculate total 'amount' for transactions where the day of month <= day_cutoff.
    """
    if df.empty:
        return 0.0
    # Create an explicit copy to avoid SettingWithCopyWarning when updating 'date'
    df = df.copy()
    # Ensure date column is datetime
    df["date"] = pd.to_datetime(df["date"])
    mask = df["date"].dt.day <= day_cutoff
    return float(df[mask]["amount"].sum())


def calculate_mom_metrics(
    df_current: pd.DataFrame, 
    df_prev: pd.DataFrame, 
    current_date: datetime
) -> dict:
    """
    Compare current month MTD with previous month MTD.
    """
    day_cutoff = current_date.day
    
    current_mtd = calculate_mtd_normalized_total(df_current, day_cutoff)
    prev_mtd = calculate_mtd_normalized_total(df_prev, day_cutoff)
    
    delta = current_mtd - prev_mtd
    pct_change = (delta / abs(prev_mtd)) * 100 if prev_mtd != 0 else 0.0
    
    return {
        "current_mtd": round(current_mtd, 2),
        "prev_mtd": round(prev_mtd, 2),
        "delta": round(delta, 2),
        "pct_change": round(pct_change, 2)
    }


def calculate_yoy_metrics(
    df_current: pd.DataFrame, 
    df_last_year: pd.DataFrame, 
    current_date: datetime
) -> dict:
    """
    Compare current month MTD with same month last year MTD.
    """
    day_cutoff = current_date.day
    
    current_mtd = calculate_mtd_normalized_total(df_current, day_cutoff)
    last_year_mtd = calculate_mtd_normalized_total(df_last_year, day_cutoff)
    
    delta = current_mtd - last_year_mtd
    pct_change = (delta / abs(last_year_mtd)) * 100 if last_year_mtd != 0 else 0.0
    
    return {
        "current_mtd": round(current_mtd, 2),
        "last_year_mtd": round(last_year_mtd, 2),
        "delta": round(delta, 2),
        "pct_change": round(pct_change, 2)
    }


def calculate_budget_pacing(spent: float, budget: float, current_date: datetime) -> float:
    """
    Calculate budget pacing metric: (spent / budget) - (current_day / days_in_month).
    Positive = Overspending relative to time elapsed.
    """
    if budget <= 0:
        return 0.0
    
    _, last_day = calendar.monthrange(current_date.year, current_date.month)
    day_cutoff = min(current_date.day, last_day)
    
    time_pct = day_cutoff / last_day
    spent_pct = spent / budget
    
    return round(spent_pct - time_pct, 4)


def calculate_milestone_months(
    current_balance: float,
    monthly_savings: float,
    target_amount: float,
    annual_return_rate: float
) -> int:
    """
    Calculate the number of months to reach a target amount with monthly contributions
    and compound interest.
    """
    if current_balance >= target_amount:
        return 0
    
    # If no savings and no growth (or negative), will never reach
    if monthly_savings <= 0 and annual_return_rate <= 0:
        return 9999 # Representing "Infinity"
    
    monthly_rate = annual_return_rate / 12
    
    # Linear calculation for 0% return
    if monthly_rate == 0:
        if monthly_savings <= 0: return 9999
        needed = target_amount - current_balance
        return int(needed / monthly_savings) + (1 if needed % monthly_savings > 0 else 0)
    
    # Compound interest formula
    try:
        numerator = target_amount + (monthly_savings / monthly_rate)
        denominator = current_balance + (monthly_savings / monthly_rate)
        
        if numerator <= 0 or denominator <= 0:
             return 9999
             
        n = math.log(numerator / denominator) / math.log(1 + monthly_rate)
        return int(math.ceil(n))
    except (ValueError, ZeroDivisionError):
        return 9999


# --- HTML Rendering Helpers ---
def _esc(text: str) -> str:
    """Escape a string for safe HTML embedding."""
    return html.escape(str(text))


def build_progress_bar_html(
    pct: float,
    color_solid: str,
    color_bg: str,
    color_border: str,
    label: str,
    amount_str: str,
    expected_str: str,
) -> str:
    """Build an HTML progress bar comparing actual vs expected amounts."""
    label_inside = pct > LABEL_THRESHOLD_PCT
    safe_label = _esc(label)
    safe_amount = _esc(amount_str)
    safe_expected = _esc(expected_str)

    fill_content = (
        f'<span style="color: white; font-weight: bold; font-size: 13px; padding: 0 10px;">'
        f"{safe_amount}</span>"
        if label_inside
        else ""
    )
    outside_label = (
        ""
        if label_inside
        else (
            f'<span style="margin-left: 8px; font-weight: bold; font-size: 13px; '
            f'color: {color_solid};">{safe_amount}</span>'
        )
    )

    return (
        f'<div style="display: flex; align-items: center; margin-bottom: 10px;">'
        f'<div style="width: 85px; font-weight: bold; color: {color_solid}; font-size: 14px;">'
        f"{safe_label}</div>"
        f'<div style="flex-grow: 1; background-color: {color_bg}; border-radius: 6px; '
        f"height: {BAR_HEIGHT_PX}px; border: 1px solid {color_border}; display: flex; "
        f'align-items: center; justify-content: space-between; padding-right: 10px;">'
        f'<div style="display: flex; align-items: center; width: 100%; height: 100%;">'
        f'<div style="background-color: {color_solid}; width: {pct}%; height: 100%; '
        f'border-radius: 5px; display: flex; align-items: center; justify-content: flex-end;">'
        f"{fill_content}</div>{outside_label}</div>"
        f'<span style="color: #999999; font-size: 12px; font-weight: bold; white-space: nowrap;">'
        f"Target: {safe_expected}</span></div></div>"
    )


def build_category_bar_html(
    cat: str,
    spent: float,
    budgeted: float,
    time_elapsed_pct: float | None = None,
) -> str:
    """Build an HTML bar showing spend progress against a category budget."""
    left = budgeted - spent

    if budgeted > 0:
        pct = (spent / budgeted) * 100
    else:
        pct = 100.0 if spent > 0 else 0.0

    vis_pct = min(pct, 100.0)

    if pct < 75:
        color = COLOR_GREEN
        bg_color = COLOR_GREEN_BG
    elif pct < 90:
        color = COLOR_YELLOW
        bg_color = COLOR_YELLOW_BG
    else:
        color = COLOR_RED
        bg_color = COLOR_RED_BG

    safe_cat = _esc(cat)
    left_str = f"${left:,.2f} left" if left >= 0 else f"${abs(left):,.2f} over!"

    marker_html = ""
    if time_elapsed_pct is not None:
        marker_pos = min(time_elapsed_pct * 100, 100.0)
        marker_html = (
            f'<div style="position: absolute; top: 0; left: {marker_pos}%; '
            f'width: 3px; height: 100%; background-color: rgba(255,255,255,0.8); '
            f'z-index: 5; border-radius: 2px;"></div>'
        )

    return (
        f'<div style="margin-bottom: 18px;">'
        f'<div style="display: flex; justify-content: space-between; margin-bottom: 6px; '
        f'font-size: 14px; font-weight: bold; color: #e0e0e0;">'
        f"<span>{safe_cat}</span>"
        f'<span style="color: {color};">{_esc(left_str)}</span></div>'
        f'<div style="position: relative; background-color: {bg_color}; border-radius: 6px; '
        f'height: 26px; width: 100%; border: 1px solid {color}40; overflow: hidden;">'
        f'{marker_html}'
        f'<div style="background-color: {color}; width: {vis_pct}%; height: 100%; '
        f'border-radius: 4px;"></div>'
        f'<div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; '
        f"display: flex; justify-content: space-between; align-items: center; padding: 0 10px; "
        f'font-size: 12px; font-weight: bold; color: white; '
        f'text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">'
        f"<span>{pct:.1f}%</span>"
        f"<span>${spent:,.2f} / ${budgeted:,.0f}</span>"
        f"</div></div></div>"
    )


# --- Forecast Logic ---
def build_forecast_data(
    account_dict: dict,
    years_to_track: int,
    current_year: int,
    return_rate_fn,
    contribution_fn,
) -> tuple[list, float, float, float]:
    """
    Project future balances for a set of investment accounts.

    Returns (forecast_rows, total_current, total_halfway, total_final).
    """
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

            forecast_data.append(
                {
                    "Year": future_year,
                    "Account": name,
                    "Projected Balance": round(current_balance, 2),
                    "Label": f"${current_balance:,.0f}" if is_milestone else "",
                }
            )

            contrib = contribution_fn(name, year_offset)
            current_balance = (current_balance * (1 + rate)) + contrib

    return forecast_data, round(total_current, 2), round(total_halfway, 2), round(total_final, 2)


# --- Sankey Diagram Data ---
def build_sankey_data(
    inc_summary: pd.DataFrame,
    exp_summary: pd.DataFrame,
) -> dict | None:
    """
    Prepare labels, sources, targets, values, and colors for a Plotly Sankey
    diagram of monthly cashflow.

    Returns None if there is no data to chart.
    """
    if inc_summary.empty and exp_summary.empty:
        return None

    total_inc = inc_summary["amount"].sum()
    total_exp = exp_summary["amount"].sum()
    net_flow = total_inc - total_exp

    # Define nodes
    labels = ["Monthly Cashflow", "Total Expenses"]
    if net_flow > 0:
        labels.append("Savings (Net Income)")
    elif net_flow < 0:
        labels.append("Overspending (Deficit)")

    inc_cats = [f"Inc:{row['Category_Name']}" for _, row in inc_summary.iterrows()]
    exp_cats = [f"Exp:{row['Category_Name']}" for _, row in exp_summary.iterrows()]

    labels.extend(inc_cats)
    labels.extend(exp_cats)

    label_idx = {name: i for i, name in enumerate(labels)}

    source, target, values, link_colors = [], [], [], []

    # Income → Cashflow
    for _, row in inc_summary.iterrows():
        source.append(label_idx[f"Inc:{row['Category_Name']}"])
        target.append(label_idx["Monthly Cashflow"])
        values.append(row["amount"])
        link_colors.append(COLOR_GREEN_LINK)

    # Deficit → Cashflow (if overspent)
    if net_flow < 0:
        source.append(label_idx["Overspending (Deficit)"])
        target.append(label_idx["Monthly Cashflow"])
        values.append(abs(net_flow))
        link_colors.append(COLOR_YELLOW_LINK)

    # Cashflow → Total Expenses
    source.append(label_idx["Monthly Cashflow"])
    target.append(label_idx["Total Expenses"])
    values.append(total_exp)
    link_colors.append(COLOR_RED_LINK_LIGHT)

    # Cashflow → Savings
    if net_flow > 0:
        source.append(label_idx["Monthly Cashflow"])
        target.append(label_idx["Savings (Net Income)"])
        values.append(net_flow)
        link_colors.append(COLOR_GREEN_LINK)

    # Total Expenses → Individual categories
    for _, row in exp_summary.iterrows():
        source.append(label_idx["Total Expenses"])
        target.append(label_idx[f"Exp:{row['Category_Name']}"])
        values.append(row["amount"])
        link_colors.append(COLOR_RED_LINK)

    # Node styling
    node_colors = []
    display_labels = []
    for name in labels:
        display_labels.append(name.replace("Inc:", "").replace("Exp:", ""))

        if "Inc:" in name or "Savings" in name:
            node_colors.append(COLOR_GREEN)
        elif "Exp:" in name or name == "Total Expenses":
            node_colors.append(COLOR_RED)
        elif "Overspending" in name:
            node_colors.append(COLOR_YELLOW)
        else:
            node_colors.append(COLOR_GRAY)

    return {
        "display_labels": display_labels,
        "node_colors": node_colors,
        "source": source,
        "target": target,
        "values": values,
        "link_colors": link_colors,
    }
