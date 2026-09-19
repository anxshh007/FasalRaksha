"""RK-1 · RK-2 · RK-3 · RK-4 · RK-5 · RK-6 · RK-8 · FR-08 · GR-2 — RAKSHA server side (PROMPT §5.2–§5.7).

The leakage tests come first because a leak is the failure that looks like success: a pipeline
that reads same-day arrivals, or a seasonal profile that has seen later years, posts a better
validation table than an honest one. Each test perturbs something that must not be visible at
prediction time and asserts that no feature on or before that day moves.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ml import config
from ml.climatology.climatology import seasonal_profile, weather_climatology
from ml.evaluate.validate import format_validation, run_raksha
from ml.features.features import FEATURE_COLUMNS, LAYER_SIGNALS, build_features
from ml.generate.synth import SERIES, load_holidays, simulate_series, trading_days, weather_history
from ml.raksha.raksha import (
    CALIBRATION_FOLDS,
    KAPPA_BOUNDS,
    NOMINAL_COVERAGE,
    conformal_widening,
    coverage,
    evaluate_horizon,
    evidence_vote,
    fit_quantiles,
    forward_chaining_folds,
    latest_forecast,
    predict_band,
    price_confidence,
    skill,
    staleness_kappa,
    vote_frame,
)

AS_OF = date(2026, 9, 18)
SOYBEAN = next(s for s in SERIES if s.crop == "soybean")


def _series_frame(rows: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame(rows)[["date", "modal", "arrivals"]]
    frame["observed"] = True
    frame["imputed"] = False
    frame["outlier"] = False
    return frame.reset_index(drop=True)


@pytest.fixture(scope="session")
def market():
    """One clean crop × district series and its district weather, from the seeded generator."""
    rng = np.random.default_rng(config.SEED)
    start = date.fromisoformat(SOYBEAN.start)
    weather = weather_history({SOYBEAN.district}, start - timedelta(days=30), AS_OF, rng)
    days = trading_days(start, AS_OF, load_holidays(config.REFERENCE_DIR / "market_holidays.csv"))
    series = _series_frame(simulate_series(SOYBEAN, days, weather, rng))
    return series, weather[weather["district"] == SOYBEAN.district].reset_index(drop=True)


@pytest.fixture(scope="session")
def frame(market):
    series, weather = market
    return build_features(series, weather, 0.3, 7)


@pytest.fixture(scope="session")
def result(frame):
    return evaluate_horizon(frame, 7, "grain")


def _same(a: pd.DataFrame, b: pd.DataFrame, upto: int) -> None:
    left = a.loc[: upto, FEATURE_COLUMNS].to_numpy(dtype=float)
    right = b.loc[: upto, FEATURE_COLUMNS].to_numpy(dtype=float)
    np.testing.assert_allclose(left, right, rtol=0, atol=1e-12, equal_nan=True)


# ── leakage (PROMPT §5.3: "the single most likely silent error in the pipeline") ─────────


def test_rk3_no_feature_reads_a_same_day_arrival(market, frame):
    series, weather = market
    t = 900
    shocked = series.copy()
    shocked.loc[t, "arrivals"] = shocked.loc[t, "arrivals"] * 25.0
    after = build_features(shocked, weather, 0.3, 7)
    _same(frame, after, t)  # nothing on or before day t may see day t's arrivals
    assert after.loc[t + 1, "arrival_pressure"] != pytest.approx(frame.loc[t + 1, "arrival_pressure"])  # …the next day does


def test_rk4_no_feature_reads_same_day_weather(market, frame):
    series, weather = market
    t = 900
    day = series.loc[t, "date"].isoformat()
    soaked = weather.copy()
    soaked.loc[soaked["date"] == day, "rain_mm"] = 400.0
    after = build_features(series, soaked, 0.3, 7)
    _same(frame, after, t)
    assert not np.isclose(after.loc[t + 1, "weather_pressure"], frame.loc[t + 1, "weather_pressure"])


def test_rk2_no_feature_reads_a_later_price(market, frame):
    """Truncating the future must not change a single feature of the past — this is what catches a
    seasonal profile or arrival norm built from later years."""
    series, weather = market
    cut = 800
    truncated = build_features(series.iloc[:cut].copy(), weather, 0.3, 7)
    _same(frame, truncated, cut - 1)


def test_rk2_the_seasonal_profile_is_built_from_earlier_years_only(market):
    series, _ = market
    dates = pd.Series(series["date"])
    log_p = np.log(series["modal"].astype(float))
    through_2023 = dates.map(lambda d: d.year <= 2023)
    full = seasonal_profile(dates, log_p, exclude_year=2024)
    past_only = seasonal_profile(dates[through_2023], log_p[through_2023], exclude_year=2024)
    pd.testing.assert_frame_equal(full.reset_index(drop=True), past_only.reset_index(drop=True))


def test_rk4_the_weather_climatology_is_built_from_earlier_years_only(market):
    _, weather = market
    early = weather[weather["date"] < "2024-01-01"]
    pd.testing.assert_frame_equal(weather_climatology(weather, before_year=2024), weather_climatology(early, before_year=2024))


def test_rk3_arrival_pressure_is_winsorised_and_lagged_one_trading_day(frame):
    pressure = frame["arrival_pressure"].dropna()
    assert pressure.between(-2.0, 2.0).all()
    assert np.isnan(frame.loc[0, "arrival_pressure"])  # day one has no yesterday


def test_rk5_shock_z_is_a_robust_clipped_z_of_returns(market):
    series, weather = market
    spiked = series.copy()
    spiked.loc[700, "modal"] = spiked.loc[700, "modal"] * 3
    shocked = build_features(spiked, weather, 0.3, 7)
    assert shocked.loc[700, "shock_z"] == pytest.approx(6.0)  # clipped, not unbounded
    assert shocked["shock_z"].dropna().abs().max() <= 6.0


def test_rk1_persistence_features_are_log_differences_over_the_stated_lags(frame):
    for lag in (1, 2, 3, 7, 14, 28):
        np.testing.assert_allclose(frame[f"r{lag}"].iloc[100:110], (frame["log_p"] - frame["log_p"].shift(lag)).iloc[100:110])
    np.testing.assert_allclose(frame["momentum"].iloc[100:110], (frame["r7"] - frame["r28"] / 4).iloc[100:110])


# ── forward chaining (PROMPT §5.7: "assert against a random split") ──────────────────────


def test_rk6_folds_are_forward_chaining_purged_and_never_random(frame):
    folds = forward_chaining_folds(frame)
    assert len(folds) >= CALIBRATION_FOLDS + 2
    previous_train, previous_test_end = 0, None
    for train, test in folds:
        first_test = test["date"].min()
        assert train["date"].max() < first_test  # the past trains, the future tests
        assert all(d < first_test for d in train["target_date"])  # purged: no training target peeks into the test block
        assert len(train) >= previous_train  # the window expands
        if previous_test_end is not None:
            assert first_test > previous_test_end  # blocks move forward and never overlap
        previous_train, previous_test_end = len(train), test["date"].max()


# ── the estimator and its band ────────────────────────────────────────────────────────────


class _Fixed:
    def __init__(self, value: float):
        self.value = value

    def predict(self, rows: pd.DataFrame) -> np.ndarray:
        return np.full(len(rows), self.value)


def test_rk6_quantiles_never_cross_even_when_the_models_disagree(frame):
    crossing = {0.1: _Fixed(0.05), 0.5: _Fixed(-0.01), 0.9: _Fixed(0.02)}
    band = predict_band(crossing, frame.iloc[:5])
    assert (band[:, 0] <= band[:, 1]).all() and (band[:, 1] <= band[:, 2]).all()


def test_rk6_every_out_of_fold_band_is_ordered(frame):
    train, test = forward_chaining_folds(frame)[0]
    band = predict_band(fit_quantiles(train), test)
    assert (np.diff(band, axis=1) >= 0).all()


def test_rk6_conformal_widening_widens_until_nominal_and_never_narrows():
    rng = np.random.default_rng(config.SEED)
    y = rng.normal(0, 1, 2000)
    narrow = np.column_stack([np.full(2000, -0.3), np.zeros(2000), np.full(2000, 0.3)])
    w = conformal_widening(y, narrow)
    assert w > 0
    assert coverage(y, narrow[:, 0] - w, narrow[:, 2] + w) >= NOMINAL_COVERAGE
    wide = np.column_stack([np.full(2000, -5.0), np.zeros(2000), np.full(2000, 5.0)])
    assert conformal_widening(y, wide) == 0.0  # an over-wide band is left alone, never narrowed


def test_rk6_calibration_coverage_reaches_nominal_and_held_out_coverage_is_reported(result):
    assert result.coverage_calibration >= NOMINAL_COVERAGE
    assert result.widening >= 0
    assert 0.0 < result.coverage_conformal <= 1.0  # the honest number: judged with earlier folds' widening
    assert result.coverage_raw <= result.coverage_calibration + 1e-12 or result.widening == 0


def test_rk6_staleness_kappa_is_measured_and_grows_with_volatility(result):
    rng = np.random.default_rng(config.SEED)
    dates = pd.Series(pd.date_range("2023-01-01", periods=900, freq="D").date)
    calm = pd.Series(np.cumsum(rng.normal(0, 0.005, 900)))
    wild = pd.Series(np.cumsum(rng.normal(0, 0.03, 900)))
    k_calm, k_wild = staleness_kappa(dates, calm, 0.15), staleness_kappa(dates, wild, 0.15)
    assert KAPPA_BOUNDS[0] <= k_calm < k_wild <= KAPPA_BOUNDS[1]
    assert KAPPA_BOUNDS[0] <= result.band_kappa <= KAPPA_BOUNDS[1]
    assert staleness_kappa(dates.iloc[:5], calm.iloc[:5], 0.15) == KAPPA_BOUNDS[1]  # unmeasurable: widen fastest


def test_rk6_training_is_deterministic(frame):
    train, test = forward_chaining_folds(frame)[0]
    first = predict_band(fit_quantiles(train), test)
    second = predict_band(fit_quantiles(train), test)
    np.testing.assert_array_equal(first, second)


def test_rk6_skill_is_improvement_over_the_baseline():
    y = np.array([0.1, -0.2, 0.05, 0.0])
    base = np.zeros(4)
    assert skill(y, y, base) == 1.0
    assert skill(y, base, base) == 0.0
    assert skill(y, -y, base) < 0


# ── RK-8 evidence agreement ───────────────────────────────────────────────────────────────


def test_rk8_unanimous_calm_is_confident_calm_not_unclear():
    buckets = {layer: "flat" for layer in [*LAYER_SIGNALS, "RK-6"]}
    weights = {layer: 0.1 for layer in buckets}
    assert evidence_vote(buckets, weights) == ("flat", 1.0)


def test_rk8_ties_resolve_to_flat_and_no_measured_skill_means_no_evidence():
    assert evidence_vote({"RK-1": "up", "RK-2": "down"}, {"RK-1": 0.2, "RK-2": 0.2}) == ("flat", 0.5)
    assert evidence_vote({"RK-1": "up", "RK-2": "up"}, {"RK-1": 0.0, "RK-2": -0.3}) == ("flat", pytest.approx(1 / 3))


def test_rk8_a_layer_with_negative_skill_gets_no_vote():
    direction, agreement = evidence_vote({"RK-1": "up", "RK-3": "down", "RK-6": "down"}, {"RK-1": 0.3, "RK-3": -0.5, "RK-6": 0.1})
    assert (direction, agreement) == ("up", pytest.approx(0.75))


def test_rk8_the_vectorised_vote_is_the_scalar_vote():
    rng = np.random.default_rng(config.SEED)
    layers = [*LAYER_SIGNALS, "RK-6"]
    choices = np.array(["up", "flat", "down", None], dtype=object)
    frame = pd.DataFrame({f"bucket_{layer}": rng.choice(choices, 300) for layer in layers})
    weights = {layer: float(w) for layer, w in zip(layers, rng.uniform(-0.1, 0.3, len(layers)))}
    direction, agreement = vote_frame(frame, weights)
    for i in range(300):
        expected = evidence_vote({layer: frame.at[i, f"bucket_{layer}"] for layer in layers}, weights)
        assert (direction[i], agreement[i]) == (expected[0], pytest.approx(expected[1]))


def test_rk8_weights_are_measured_out_of_fold_non_negative_and_shipped(frame, result):
    assert set(result.layer_skill) == {*LAYER_SIGNALS, "RK-6"}
    assert result.skill_naive == result.layer_skill["RK-6"]
    latest = latest_forecast(frame, result)
    for layer, reading in latest["layers"].items():
        assert reading["weight"] == pytest.approx(max(0.0, result.layer_skill[layer]), abs=1e-6)
    assert 1 / 3 - 1e-9 <= latest["agreement"] <= 1.0


# ── FR-08 · GR-2: the published forecast and the withheld one ─────────────────────────────


def test_fr08_the_published_band_is_ordered_and_carries_the_conformal_widening(frame, result):
    latest = latest_forecast(frame, result)
    assert latest["q10"] <= latest["q50"] <= latest["q90"]
    assert np.log(latest["q90"] / latest["q10"]) >= 2 * result.widening - 1e-6
    assert latest["direction"] in ("up", "flat", "down")


def test_fr08_confidence_is_the_device_gr3_measure_in_price_terms():
    p0, q10, q50, q90, w = 1850.0, -0.04, 0.03, 0.09, 0.02
    device = (p0 * np.exp(q50) - p0) / (p0 * np.exp(q90 + w) - p0 * np.exp(q10 - w))
    assert price_confidence(np.array([q10]), np.array([q50]), np.array([q90]), w)[0] == pytest.approx(device)


def test_gr2_a_series_that_cannot_beat_naive_is_marked_insufficient():
    """A driftless random walk: tomorrow-equals-today is the best forecast there is, and the model
    must not ship a band that pretends otherwise."""
    rng = np.random.default_rng(config.SEED)
    days = [date(2021, 1, 1) + timedelta(days=i) for i in range(1500)]
    walk = pd.DataFrame({
        "date": days,
        "modal": 2000 * np.exp(np.cumsum(rng.normal(0, 0.02, len(days)))),
        "arrivals": rng.uniform(500, 1500, len(days)),
        "observed": True, "imputed": False, "outlier": False,
    })
    weather = pd.DataFrame({"date": [d.isoformat() for d in days], "district": "x", "rain_mm": rng.gamma(0.5, 4, len(days)), "humidity_pct": 60.0})
    verdict = evaluate_horizon(build_features(walk, weather, 0.3, 7), 7, "grain")
    assert verdict.skill_naive <= 0
    assert verdict.status == "insufficient"
    assert "naive" in verdict.reason


def test_gr2_a_thin_series_is_withheld_before_any_model_is_fitted(tmp_path: Path):
    clean_dir, raw_dir = tmp_path / "clean", tmp_path / "raw"
    clean_dir.mkdir()
    raw_dir.mkdir()
    days = pd.date_range("2025-01-02", periods=60, freq="D").date
    pd.DataFrame({
        "crop": "grapes", "district": "nashik", "date": days, "modal": 3200.0, "arrivals": 40.0,
        "observed": True, "imputed": False, "outlier": False, "unit_repaired": False, "zero_arrivals": False,
    }).to_csv(clean_dir / "district_series.csv", index=False)
    pd.DataFrame({"date": [d.isoformat() for d in days], "district": "nashik", "rain_mm": 0.0, "humidity_pct": 50.0}).to_csv(raw_dir / "weather_history.csv", index=False)
    (clean_dir / "ingest_report.json").write_text(json.dumps({"series": [
        {"crop": "grapes", "district": "nashik", "market": "Nashik", "observations": 60, "seasons": 1, "sufficient": False},
    ]}), encoding="utf-8")
    results = run_raksha(clean_dir, raw_dir)
    assert results[0]["status"] == "insufficient" and results[0]["horizons"] == {}
    assert "thin series" in results[0]["reason"]
    assert json.loads((clean_dir / "raksha" / "grapes__nashik.json").read_text(encoding="utf-8"))["status"] == "insufficient"
    assert "insufficient — thin series" in format_validation(results)


def test_fr08_the_validation_table_reports_every_metric_the_prompt_requires(frame, result):
    table = format_validation([{
        "crop": "soybean", "district": "latur", "observations": len(frame), "status": result.status,
        "horizons": {"h7": result.__dict__},
    }])
    for heading in ("skill/naive", "skill/seasonal", "direction", "wait prec", "coverage raw→held (cal)", "nominal band coverage 0.80"):
        assert heading in table
