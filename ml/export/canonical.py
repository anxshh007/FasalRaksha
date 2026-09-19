"""Canonical JSON and the bundle integrity hash, byte-identical to @fasal/shared (SEC-14).

The device refuses a bundle whose canonical JSON no longer hashes to its `integrity` field. The
pipeline seals bundles here, in Python, so the two canonical forms must agree to the byte:

- keys sorted at every depth, no insignificant whitespace;
- strings as `JSON.stringify` writes them (non-ASCII kept as UTF-8, not \\u-escaped);
- numbers in ECMAScript's shortest round-trip form. Python and JavaScript agree on the digits,
  since both print the shortest string that round-trips, but not on the layout: Python writes
  `1850.0`, `1e-07` and `1e+16`, while JavaScript writes `1850`, `1e-7` and `10000000000000000`.
  `js_number` applies the ECMAScript Number::toString layout rules to Python's digits.

`data/golden/canonical.json` pins both implementations to the same bytes (test_export.py here,
integrity.golden.test.ts on the TypeScript side).
"""
from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal


def js_number(value: float | int) -> str:
    """ECMAScript Number::toString(10) for a finite number."""
    if isinstance(value, bool):
        raise TypeError("booleans are not numbers here")
    x = float(value)
    if not math.isfinite(x):
        raise ValueError("canonical JSON cannot represent NaN or Infinity")
    if x == 0:
        return "0"  # also -0
    sign = "-" if x < 0 else ""
    # repr() is the shortest round-trip string; Decimal gives its digits and exponent exactly.
    _, digits_tuple, exponent = Decimal(repr(abs(x))).normalize().as_tuple()
    digits = "".join(map(str, digits_tuple))
    k = len(digits)
    n = k + int(exponent)  # the position of the decimal point relative to the digit string
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    mantissa = digits[0] + ("." + digits[1:] if k > 1 else "")
    return f"{sign}{mantissa}e{'+' if e > 0 else '-'}{abs(e)}"


def canonical_json(value: object) -> str:
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join("null" if item is None else canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise TypeError("canonical JSON keys must be strings")
        # JavaScript compares keys by UTF-16 code unit; big-endian UTF-16 bytes sort the same way.
        items = sorted(value.items(), key=lambda kv: kv[0].encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical_json(v) for k, v in items) + "}"
    raise TypeError(f"canonical JSON cannot represent a {type(value).__name__}")


def compute_integrity(document: dict) -> str:
    content = {k: v for k, v in document.items() if k != "integrity"}
    return "sha256-" + hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest()


def seal(document: dict) -> dict:
    """The document with its `integrity` field set (always last, for readability on disk)."""
    content = {k: v for k, v in document.items() if k != "integrity"}
    return {**content, "integrity": compute_integrity(content)}


def verify_integrity(document: dict) -> bool:
    claimed = document.get("integrity")
    return isinstance(claimed, str) and claimed == compute_integrity(document)
