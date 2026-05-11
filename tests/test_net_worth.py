import pandas as pd
from transforms import build_net_worth_series

def test_anchors_on_current_balance():
    df = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-15", "2024-02-15", "2024-03-15"]),
        "amount_dollars": [1000.0, 500.0, -200.0],  # total delta = 1300
    })
    out = build_net_worth_series(df, current_balance=5000.0)
    # Last row must equal anchor exactly.
    assert out.iloc[-1]["net_worth"] == 5000.0
    # total delta = 1300. Start = 5000 - 1300 = 3700.
    # Row 0: 3700 + 1000 = 4700
    assert out.iloc[0]["net_worth"] == 4700.0
    # Monthly change column preserved.
    assert out.iloc[0]["monthly_change"] == 1000.0

def test_empty_returns_empty():
    assert build_net_worth_series(pd.DataFrame(), 1000.0).empty

def test_zero_current_balance_still_walks():
    df = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-15"]),
        "amount_dollars": [100.0],
    })
    out = build_net_worth_series(df, current_balance=0.0)
    assert out.iloc[-1]["net_worth"] == 0.0
