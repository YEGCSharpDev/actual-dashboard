from datetime import datetime

import pandas as pd
import pytest

from transforms import (
    calculate_budget_pacing,
    calculate_mom_metrics,
    calculate_mtd_normalized_total,
    calculate_yoy_metrics,
    split_income_expenses,
)


def test_split_income_returns_positive_amounts():
    df = pd.DataFrame(
        {
            "is_income": [True, False, True, False],
            "amount": [-200, 100, -300, 50],  # negative = income in our invariant
        }
    )
    inc, exp = split_income_expenses(df)
    # Both should be positive for UI
    assert (inc["amount"] > 0).all()
    assert (exp["amount"] > 0).all()
    assert inc["amount"].sum() == 500
    assert exp["amount"].sum() == 150


def test_mtd_normalized_total():
    data = {
        "date": ["2024-05-01", "2024-05-05", "2024-05-10", "2024-05-15"],
        "amount": [100, 200, 300, 400],
    }
    df = pd.DataFrame(data)

    # Cutoff at 10th
    assert calculate_mtd_normalized_total(df, 10) == 600
    # Cutoff at 1st
    assert calculate_mtd_normalized_total(df, 1) == 100
    # Cutoff at 20th
    assert calculate_mtd_normalized_total(df, 20) == 1000


def test_mom_metrics():
    df_curr = pd.DataFrame(
        {
            "date": ["2024-05-01", "2024-05-05"],
            "amount": [100, 150],  # Total MTD (day 5) = 250
        }
    )
    df_prev = pd.DataFrame(
        {
            "date": ["2024-04-01", "2024-04-05", "2024-04-10"],
            "amount": [100, 100, 500],  # Total MTD (day 5) = 200
        }
    )

    current_date = datetime(2024, 5, 5)
    metrics = calculate_mom_metrics(df_curr, df_prev, current_date)

    assert metrics["current_mtd"] == 250
    assert metrics["prev_mtd"] == 200
    assert metrics["delta"] == 50
    assert metrics["pct_change"] == 25.0


def test_yoy_metrics():
    df_curr = pd.DataFrame(
        {
            "date": ["2024-05-01", "2024-05-05"],
            "amount": [200, 300],  # Total MTD (day 5) = 500
        }
    )
    df_last_year = pd.DataFrame(
        {
            "date": ["2023-05-01", "2023-05-05", "2023-05-10"],
            "amount": [100, 150, 400],  # Total MTD (day 5) = 250
        }
    )

    current_date = datetime(2024, 5, 5)
    metrics = calculate_yoy_metrics(df_curr, df_last_year, current_date)

    assert metrics["current_mtd"] == 500
    assert metrics["last_year_mtd"] == 250
    assert metrics["delta"] == 250
    assert metrics["pct_change"] == 100.0


def test_budget_pacing():
    current_date = datetime(2024, 5, 15)  # 15th of May (31 days)
    # time_pct = 15/31 = 0.4838709677419355

    # Spent exactly on track
    spent = 48.38709677419355
    budget = 100.0
    pacing = calculate_budget_pacing(spent, budget, current_date)
    assert pytest.approx(pacing) == 0.0

    # Overspent
    spent = 70.0
    pacing = calculate_budget_pacing(spent, budget, current_date)
    assert pacing > 0

    # Underspent
    spent = 20.0
    pacing = calculate_budget_pacing(spent, budget, current_date)
    assert pacing < 0


def test_budget_pacing_month_end():
    current_date = datetime(2024, 5, 31)
    # time_pct = 31/31 = 1.0

    spent = 100
    budget = 100
    assert calculate_budget_pacing(spent, budget, current_date) == 0.0

    spent = 110
    assert pytest.approx(calculate_budget_pacing(spent, budget, current_date)) == 0.1
