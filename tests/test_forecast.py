from transforms import build_forecast_data

def test_forecast_simple_growth_no_contribution():
    accounts = {"TFSA-A": 1000.0}
    data, t_curr, t_half, t_final = build_forecast_data(
        accounts, years_to_track=10, current_year=2024,
        return_rate_fn=lambda _: 0.10,
        contribution_fn=lambda _n, _o: 0.0,
    )
    assert t_curr == 1000.00
    # halfway = year +5, balance = 1000 * 1.1^5 = 1610.51
    assert t_half == 1610.51
    # final  = year +10, balance = 1000 * 1.1^10 = 2593.74
    assert t_final == 2593.74

def test_forecast_with_annual_contribution():
    # offset 0 is current year
    data, *_, t_final = build_forecast_data(
        {"X": 0.0}, years_to_track=1, current_year=2024,
        return_rate_fn=lambda _: 0.0,
        contribution_fn=lambda _n, _o: 1200.0,
    )
    # year 0: balance 0. After contrib 1200.
    # year 1: balance 1200. After contrib 1200.
    # Final is balance at year 1.
    assert t_final == 1200.0
