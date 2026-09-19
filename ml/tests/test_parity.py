"""RK-8 · GR-3 · GR-4 — the pipeline's mirrors of @fasal/shared design constants.

The pipeline scores its own wait signal with AGREEMENT_MIN and CONFIDENCE_FLOOR, so it holds a
copy of each. A copy is a second source of truth unless something fails the moment the two
differ; this is that something (PROMPT §3.2: one implementation of every rule).
"""
from __future__ import annotations

import re

import pytest

from ml import config

POLICY = config.REPO_ROOT / "packages" / "shared" / "src" / "constants" / "policy.ts"


def _ts_value(name: str) -> float:
    text = POLICY.read_text(encoding="utf-8")
    block = re.search(rf"export const {name}\b.*?\n}};", text, re.S)
    assert block, f"{name} is not declared in {POLICY.name}"
    value = re.search(r"\bvalue:\s*([0-9.]+)", block.group(0))
    assert value, f"{name} has no numeric value in {POLICY.name}"
    return float(value.group(1))


@pytest.mark.parametrize("name", ["AGREEMENT_MIN", "CONFIDENCE_FLOOR"])
def test_rk8_gr3_gr4_pipeline_constants_equal_the_shared_constants(name: str):
    assert getattr(config, name) == _ts_value(name)
