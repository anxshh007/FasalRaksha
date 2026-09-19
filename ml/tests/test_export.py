"""SEC-14 · FR-08 · RK-6 · RK-4 — bundle generation and the Python half of the parity contract
(PROMPT §5.8, §14.1). The TypeScript half is packages/shared/src/bundle/golden.test.ts; both
read the same vectors in data/golden/.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from ml import config
from ml.export.bundles import build_core, climatology_bundle, export_bundles, trend_points
from ml.export.canonical import canonical_json, compute_integrity, js_number, seal, verify_integrity
from ml.export.golden import canonical_vectors, confidence_vectors

# ── canonical JSON (SEC-14) ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("value", "expected"), [
    (1850.0, "1850"), (1850.5, "1850.5"), (0.1, "0.1"), (1e-7, "1e-7"), (1.5e-7, "1.5e-7"), (1e-6, "0.000001"),
    (1e20, "100000000000000000000"), (1e21, "1e+21"), (-0.0, "0"), (5e-324, "5e-324"), (2 / 3, "0.6666666666666666"),
])
def test_sec14_numbers_are_written_as_javascript_writes_them(value, expected):
    assert js_number(value) == expected


def test_sec14_canonical_json_sorts_keys_by_utf16_and_keeps_devanagari_as_utf8():
    assert canonical_json({"｡": 1, "😀": 2, "b": {"z": None, "a": [1.0, True]}}) == '{"b":{"a":[1,true],"z":null},"😀":2,"｡":1}'
    assert canonical_json({"mr": "कांदा"}) == '{"mr":"कांदा"}'
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})


def test_sec14_a_sealed_document_rejects_any_change():
    document = seal({"crop": "onion", "benchmark": {"modal": 1840.0}})
    assert verify_integrity(document)
    assert not verify_integrity({**document, "benchmark": {"modal": 1940.0}})
    assert not verify_integrity({**document, "asOf": "2026-09-18"})
    assert compute_integrity({**document, "integrity": "anything"}) == document["integrity"]  # the field itself is excluded


def test_sec14_the_committed_golden_vectors_are_what_this_code_produces():
    """If the Python canonical form changed, this fails before the TypeScript side ever runs."""
    committed = json.loads((config.GOLDEN_DIR / "canonical.json").read_text(encoding="utf-8"))["vectors"]
    fresh = canonical_vectors()
    assert [v["canonical"] for v in committed] == [v["canonical"] for v in fresh]
    assert [v["sha256"] for v in committed] == [v["sha256"] for v in fresh]


def test_rk6_the_committed_confidence_vectors_are_what_this_code_produces():
    committed = json.loads((config.GOLDEN_DIR / "confidence.json").read_text(encoding="utf-8"))["vectors"]
    for a, b in zip(committed, confidence_vectors(), strict=True):
        assert a["confidence"] == pytest.approx(b["confidence"], abs=1e-12)
        assert a["staleConfidence"] == pytest.approx(b["staleConfidence"], abs=1e-12)


# ── bundle cores (FR-08) ──────────────────────────────────────────────────────────────────

AS_OF = date(2026, 9, 18)


def _series(days: int = 900, end: date = AS_OF) -> pd.DataFrame:
    rng = np.random.default_rng(config.SEED)
    dates = [end - timedelta(days=days - 1 - i) for i in range(days)]
    dates = [d for d in dates if d.weekday() != 6]
    modal = 2000 * np.exp(np.cumsum(rng.normal(0, 0.01, len(dates))))
    return pd.DataFrame({
        "date": dates, "crop": "onion", "district": "nashik", "market": "lasalgaon",
        "modal": np.round(modal), "min": np.round(modal * 0.9), "max": np.round(modal * 1.1), "arrivals": rng.uniform(500, 1500, len(dates)),
        "observed": True, "imputed": False, "outlier": False,
    })


def _horizon(p0: float, d: date, status: str = "published") -> dict:
    return {
        "status": status, "skill_naive": 0.12, "skill_seasonal": 0.2, "coverage_conformal": 0.81, "band_kappa": 0.06, "confidence_min": 0.1,
        "latest": {
            "date": d.isoformat(), "p0": round(p0, 2), "q10": round(p0 * 0.9, 2), "q50": round(p0 * 1.02, 2), "q90": round(p0 * 1.1, 2),
            "direction": "up", "agreement": 1 / 3,
            "layers": {layer: {"bucket": "up", "weight": 0.1, "value": 0.2} for layer in ("RK-1", "RK-2", "RK-3", "RK-4", "RK-5", "RK-6")},
        },
    }


def test_fr08_a_published_core_is_anchored_on_the_benchmark_and_sealed():
    series = _series()
    p0 = float(series["modal"].iloc[-1])
    entry = {"crop": "onion", "district": "nashik", "market": "lasalgaon", "status": "published", "horizons": {"h7": _horizon(p0, AS_OF), "h14": _horizon(p0, AS_OF, "insufficient")}}
    core = build_core(entry, series, {"stalenessLimitDays": 7}, "2026-09-18.1", "2026-09-18T20:30:00Z")
    assert verify_integrity(core)
    assert core["benchmark"]["modal"] == p0 and core["asOf"] == AS_OF.isoformat()
    assert core["forecast"]["h14"] is None  # a horizon that did not beat naive is withheld on its own
    assert core["forecast"]["h7"]["agreement"] >= 1 / 3  # never rounded below its floor
    assert core["forecast"]["h7"]["coverage"] == 0.81  # the held-out coverage, not the by-construction one
    assert core["seasonal"] is not None and core["seasonal"]["woyIQR"][0] <= core["seasonal"]["woyIQR"][1]


def test_fr08_a_forecast_anchored_on_another_day_is_refused():
    series = _series()
    p0 = float(series["modal"].iloc[-1])
    entry = {"crop": "onion", "district": "nashik", "market": "lasalgaon", "status": "published", "horizons": {"h7": _horizon(p0, AS_OF - timedelta(days=1)), "h14": None}}
    with pytest.raises(ValueError, match="anchored"):
        build_core(entry, series, {"stalenessLimitDays": 7}, "2026-09-18.1", "2026-09-18T20:30:00Z")


def test_fr08_a_withheld_core_carries_prices_but_no_forecast_and_no_weights():
    entry = {"crop": "onion", "district": "nashik", "market": "lasalgaon", "status": "insufficient", "horizons": {}}
    core = build_core(entry, _series(), {"stalenessLimitDays": 7}, "2026-09-18.1", "2026-09-18T20:30:00Z")
    assert core["status"] == "insufficient" and core["forecast"] is None
    assert all(layer == {"bucket": None, "weight": 0, "value": None} for layer in core["raksha"]["layers"].values())
    assert core["benchmark"]["modal"] > 0 and len(core["trend"]) == 7


def test_fr08_the_trend_shows_closed_days_as_gaps_and_flags_imputed_days():
    series = _series(60)
    series.loc[series.index[-2], ["observed", "imputed"]] = [False, True]
    points = trend_points(series, AS_OF)
    assert [p["date"] for p in points] == [(AS_OF - timedelta(days=6 - k)).isoformat() for k in range(7)]
    sunday = next(p for p in points if date.fromisoformat(p["date"]).weekday() == 6)
    assert sunday["modal"] is None  # never interpolated
    assert points[-2].get("imputed") is True


def test_fr08_a_crop_with_no_earlier_year_has_no_seasonal_norm():
    series = _series(200)  # all within the as-of year and the end of the one before, but no full earlier year for this week
    series = series[series["date"].map(lambda d: d.year) == AS_OF.year]
    entry = {"crop": "onion", "district": "nashik", "market": "lasalgaon", "status": "insufficient", "horizons": {}}
    assert build_core(entry, series, {"stalenessLimitDays": 7}, "2026-09-18.1", "2026-09-18T20:30:00Z")["seasonal"] is None


def test_rk4_the_climatology_bundle_covers_every_week_and_is_sealed():
    days = pd.date_range("2023-01-01", "2025-12-31", freq="D")
    rng = np.random.default_rng(config.SEED)
    weather = pd.DataFrame({"date": days.strftime("%Y-%m-%d"), "district": "nashik", "rain_mm": rng.gamma(0.5, 4, len(days)), "humidity_pct": 60.0})
    document = climatology_bundle(weather, "nashik", "2026-09-18.1", "2026-09-18T20:30:00Z")
    assert verify_integrity(document)
    assert [w["week"] for w in document["weeks"]] == list(range(1, 53))


def test_fr08_export_is_deterministic_and_the_manifest_lists_every_seal(tmp_path):
    series = _series()
    p0 = float(series["modal"].iloc[-1])
    results = [{"crop": "onion", "district": "nashik", "market": "lasalgaon", "status": "published", "horizons": {"h7": _horizon(p0, AS_OF), "h14": None}}]
    days = pd.date_range("2024-01-01", AS_OF.isoformat(), freq="D")
    weather = pd.DataFrame({"date": days.strftime("%Y-%m-%d"), "district": "nashik", "rain_mm": 1.0, "humidity_pct": 60.0})
    crops = {"onion": {"stalenessLimitDays": 7}}
    first = export_bundles(results, series, weather, crops, AS_OF, tmp_path / "a")
    second = export_bundles(results, series, weather, crops, AS_OF, tmp_path / "b")
    assert first == second
    core_path = tmp_path / "a" / "2026-09-18.1" / "pipeline" / "core" / "onion__nashik.json"
    assert core_path.read_bytes() == (tmp_path / "b" / "2026-09-18.1" / "pipeline" / "core" / "onion__nashik.json").read_bytes()
    assert verify_integrity(first)
    assert first["cores"][0]["integrity"] == json.loads(core_path.read_text(encoding="utf-8"))["integrity"]
    assert first["dataSource"] == "synthetic"
