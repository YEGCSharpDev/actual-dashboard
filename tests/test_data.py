from data import normalize_transactions


def test_normalize_transactions_empty():
    assert normalize_transactions([]).empty


def test_normalize_transactions_renaming_and_conversion():
    raw = [
        {
            "date": "2024-05-01",
            "amount": -10000,  # $100.00 outflow
            "payee.name": "Test Payee",
            "category.name": "Test Category",
            "category.id": "cat1",
            "category.is_income": False,
            "category.group.name": "Test Group",
        }
    ]

    df = normalize_transactions(raw)

    assert df.iloc[0]["Payee_Name"] == "Test Payee"
    assert df.iloc[0]["Category_Name"] == "Test Category"
    assert df.iloc[0]["Group_Name"] == "Test Group"

    # Signage check
    # amount_dollars: inflow positive, outflow negative
    assert df.iloc[0]["amount_dollars"] == -100.0
    # amount: cost_to_user (outflow positive)
    assert df.iloc[0]["amount"] == 100.0


def test_normalize_transactions_null_handling():
    raw = [
        {
            "date": "2024-05-01",
            "amount": 5000,  # $50.00 inflow
            "payee.name": None,
            "category.name": None,
            "category.id": "cat2",
            "category.is_income": True,
            "category.group.name": None,
        }
    ]

    df = normalize_transactions(raw)

    assert df.iloc[0]["Payee_Name"] == "Unknown"
    assert df.iloc[0]["Category_Name"] == "Uncategorized"
    assert df.iloc[0]["Group_Name"] == "Other"

    # amount_dollars: inflow positive
    assert df.iloc[0]["amount_dollars"] == 50.0
    # amount: cost_to_user (inflow negative)
    assert df.iloc[0]["amount"] == -50.0
