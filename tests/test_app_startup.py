# tests/test_app_startup.py
from unittest.mock import patch

import pandas as pd
from streamlit.testing.v1 import AppTest


def test_startup_when_no_transactions_today():
    """Reproducer for P0-Y: data max < today must not crash date_input."""
    # Create data where the latest transaction is yesterday
    yesterday_str = "2026-05-09"
    yesterday_df = pd.DataFrame({
        "date": pd.to_datetime([yesterday_str]),
        "amount": [100.0], 
        "amount_dollars": [-1.0],
        "is_income": [False], 
        "Category_Name": ["X"],
        "Payee_Name": ["P"], 
        "Group_Name": ["G"], 
        "account": ["a1"],
    })
    fake_data = {
        "transactions": yesterday_df,
        "accounts": [{"id": "a1", "name": "A", "balance_current": 10000,
                      "closed": False, "offbudget": False}],
        "budgets": {}, 
        "categories": [], 
        "error": None,
    }
    
    # Mock the data fetcher
    with patch("app.fetch_all_dashboard_data", return_value=fake_data):
        # We also need to mock datetime.now() if we want absolute reproducibility,
        # but the logic max(data_max, today) should hold regardless.
        at = AppTest.from_file("app.py").run()
        assert not at.exception, f"App crashed: {at.exception}"
