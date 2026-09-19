"""Golden vectors for Python ↔ TypeScript parity (PROMPT §14.1: identical to 1e-9).

Two things are computed on both sides of the wire, so both are pinned here:

- canonical.json: the canonical JSON and SHA-256 of awkward documents (number layout, Devanagari,
  astral-plane keys whose UTF-16 order differs from code-point order, control characters).
  The pipeline seals bundles in Python and the device verifies them in TypeScript, so one
  differing byte would make every honest bundle look tampered with.
- confidence.json: GR-3's confidence measure. The pipeline calibrates each crop's confidenceMin
  on `price_confidence`, and the device compares against that threshold with its own formula
  after staleness widening. If the two measures drifted apart, the calibrated threshold would
  quietly mean something else on the phone.

The device computes no features. Features exist only in the pipeline, so there is no feature
vector to compare, and the parity that matters is the bytes and the decision measure.

    python -m ml.export.golden      # rewrite data/golden (the tests fail if it would change)
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from ml import config
from ml.export.canonical import canonical_json
from ml.raksha.raksha import price_confidence

CANONICAL_CASES: list[tuple[str, object]] = [
    ("integers and integral floats", {"modal": 1850.0, "count": 12, "zero": 0.0, "negative_zero": -0.0, "big": 1e20, "bigger": 1e21}),
    ("shortest round-trip decimals", {"third": 1 / 3, "sum": 0.1 + 0.2, "tenth": 0.1, "q": 3369.99, "agreement": 0.6641, "tiny": 1e-7, "small": 0.000001, "smaller": 1.5e-7}),
    ("extremes", [5e-324, 1.7976931348623157e308, -123456.789, 2.5e-310]),
    ("scripts", {"mr": "कांदा", "hi": "प्याज", "bn": "পেঁয়াজ", "pa": "ਪਿਆਜ਼", "emoji": "🧅", "nukta": "ज़"}),
    ("escapes", {"quote": 'say "कांदा"', "backslash": "a\\b", "newline": "a\nb", "tab": "a\tb", "control": "", "del": "", "line separator": "a b"}),
    ("key order is UTF-16 code-unit order", {"｡": 1, "😀": 2, "B": 3, "a": 4, "_": 5, "aa": 6, "": 7}),
    ("nesting, nulls and empties", {"z": [None, True, False, {}, [], {"b": [1, {"d": None, "c": 2.0}]}], "a": {"y": "", "x": [0.5]}}),
]


def canonical_vectors() -> list[dict]:
    out = []
    for name, value in CANONICAL_CASES:
        text = canonical_json(value)
        out.append({"name": name, "value": value, "canonical": text, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()})
    return out


def confidence_vectors(n: int = 24) -> list[dict]:
    """Bands in ₹ as the bundle ships them, and the confidence the pipeline would compute."""
    rng = np.random.default_rng(config.SEED)
    out = []
    for _ in range(n):
        p0 = float(np.round(rng.uniform(800, 9000), 2))
        q50 = float(rng.normal(0.0, 0.06))
        q10 = q50 - float(rng.uniform(0.02, 0.25))
        q90 = q50 + float(rng.uniform(0.02, 0.25))
        widening = float(rng.uniform(0.0, 0.06))
        kappa = float(rng.uniform(0.005, 0.12))
        age = int(rng.integers(0, 8))
        band = {"q10": p0 * np.exp(q10 - widening), "q50": p0 * np.exp(q50), "q90": p0 * np.exp(q90 + widening)}
        confidence = float(price_confidence(np.array([q10]), np.array([q50]), np.array([q90]), widening)[0])
        # The device widens half-widths about the median by 1 + κ · age (staleness.ts `widenBand`).
        m = 1 + kappa * age
        stale_q10, stale_q90 = band["q50"] - m * (band["q50"] - band["q10"]), band["q50"] + m * (band["q90"] - band["q50"])
        stale = float((band["q50"] - p0) / (stale_q90 - stale_q10))
        out.append({
            "p0": p0, "band": {k: float(v) for k, v in band.items()}, "kappa": kappa, "age": age,
            "confidence": confidence, "staleConfidence": stale,
        })
    return out


def write_golden(directory: Path = config.GOLDEN_DIR) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    written = []
    for name, payload in (("canonical.json", canonical_vectors()), ("confidence.json", confidence_vectors())):
        path = directory / name
        # repr-exact floats: Python's json writes the shortest round-trip form, which JSON.parse reads back to the same double.
        path.write_text(json.dumps({"generatedBy": "ml/export/golden.py", "vectors": payload}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in write_golden():
        print(f"wrote {path.relative_to(config.REPO_ROOT)}")
