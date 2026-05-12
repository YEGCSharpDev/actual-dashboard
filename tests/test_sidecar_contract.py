# tests/test_sidecar_contract.py
import os
import shutil
import subprocess

import pytest

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node not installed"
)


def test_missing_env_vars_exits_one():
    """Pins env-var contract so round-2 P0-A class of bug can't return silently."""
    clean_env = {k: v for k, v in os.environ.items() if not k.startswith("ACTUAL_")}
    clean_env["PATH"] = os.environ.get("PATH", "")

    # We expect exit code 1 because required env vars are missing
    out = subprocess.run(
        ["node", "actual-helper.js"],
        capture_output=True,
        text=True,
        timeout=10,
        env=clean_env,
    )
    assert out.returncode == 1
    assert "environment variables are required" in out.stderr
