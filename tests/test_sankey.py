import pandas as pd

from transforms import build_sankey_data


def test_sankey_indices_resolve():
    inc = pd.DataFrame({"Category_Name": ["Salary"], "amount": [3000]})
    exp = pd.DataFrame({"Category_Name": ["Rent", "Food"], "amount": [1500, 500]})
    out = build_sankey_data(inc, exp)
    # Every source/target must be a valid index into display_labels.
    n = len(out["display_labels"])
    assert all(0 <= s < n for s in out["source"])
    assert all(0 <= t < n for t in out["target"])
    # values, link_colors must be same length as source.
    assert (
        len(out["source"])
        == len(out["target"])
        == len(out["values"])
        == len(out["link_colors"])
    )


def test_sankey_returns_none_when_empty():
    assert build_sankey_data(pd.DataFrame(), pd.DataFrame()) is None


def test_sankey_deficit_branch():
    inc = pd.DataFrame({"Category_Name": ["Salary"], "amount": [1000]})
    exp = pd.DataFrame({"Category_Name": ["Rent"], "amount": [1500]})
    out = build_sankey_data(inc, exp)
    assert "Overspending (Deficit)" in out["display_labels"]
