import pytest
from transforms import parse_math_input

def test_parse_basic_arithmetic():
    assert parse_math_input("500+200") == 700.0
    assert parse_math_input("100*3-50") == 250.0
    assert parse_math_input("-100") == -100.0
    assert parse_math_input("") == 0.0
    assert parse_math_input(None) == 0.0  # guard

@pytest.mark.parametrize("evil", [
    "__import__('os').system('rm -rf /')",
    "open('/etc/passwd').read()",
    "(lambda: 1)()",
    "x = 1",       # assignments
    "1 if 1 else 0",
    "1 ** 99999",  # potential DoS via large pow
    "exec('print(1)')",
])
def test_parse_rejects_unsafe(evil):
    assert parse_math_input(evil) == 0.0   # silent rejection
