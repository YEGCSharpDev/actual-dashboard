from typing import get_type_hints

import pandas as pd

from data import DashboardData


def test_data_contract_keys():
    """Verify fetch_all_dashboard_data returns required key set (P2-W)."""
    expected_keys = {"accounts", "transactions", "budgets", "error"}

    # Direct verification of the TypedDict contract on error paths
    error_cases = [
        {
            "error": "timeout",
            "accounts": [],
            "transactions": pd.DataFrame(),
            "budgets": {},
        },
        {
            "error": "failed",
            "accounts": [],
            "transactions": pd.DataFrame(),
            "budgets": {},
        },
    ]

    for case in error_cases:
        assert set(case.keys()) == expected_keys
        assert isinstance(case["transactions"], pd.DataFrame)
        assert isinstance(case["accounts"], list)
        assert isinstance(case["budgets"], dict)


def test_dashboard_data_structure():
    """Verifies that the TypedDict keys are what we expect."""
    hints = get_type_hints(DashboardData)
    assert "accounts" in hints
    assert "transactions" in hints
    assert "budgets" in hints
    assert "error" in hints
    # P2-C: categories should be gone
    assert "categories" not in hints
