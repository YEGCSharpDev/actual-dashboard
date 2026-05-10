import pytest
from transforms import calculate_milestone_months

def test_milestone_months_linear():
    # $100 starting, $10/mo savings, $200 target, 0% return
    # Needs $100 more, so 10 months
    assert calculate_milestone_months(100, 10, 200, 0) == 10

def test_milestone_months_already_reached():
    assert calculate_milestone_months(500, 10, 200, 0.05) == 0

def test_milestone_months_growth():
    # $10,000 starting, $1,000/mo savings, $25,000 target, 10% annual return
    # Monthly rate = 0.833%
    # Using online calculator for verification: n=13 gives ~$24,822, so n=14 is needed to reach $25k.
    assert calculate_milestone_months(10000, 1000, 25000, 0.10) == 14

def test_milestone_never_reach():
    # Starting 0, saving 0, target 100, no return
    assert calculate_milestone_months(0, 0, 100, 0) == 9999
    # Starting 100, saving -10 (loss), target 200, no return
    assert calculate_milestone_months(100, -10, 200, 0) == 9999

def test_milestone_growth_only():
    # Starting 100, saving 0, target 121, 10% return (monthly compound)
    # 1.1^2 = 1.21. So 2 years = 24 months.
    # Wait, annual return 10%. Monthly rate = 10%/12.
    # (1 + 0.10/12)^n = 1.21
    # n = log(1.21) / log(1 + 0.10/12) = 22.95 -> 23 months
    assert calculate_milestone_months(100, 0, 121, 0.10) == 23
