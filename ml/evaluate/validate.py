"""Run RAKSHA over every clean crop × district series and produce the validation table
(PROMPT §5.7) — regenerated on every run, per crop. A series that is thin, or whose model does not
beat the naive baseline, is marked `insufficient` and its forecast is withheld from the bundle.

Onion, tomato and chilli are volatile and regime-switching; policy shocks are unforecastable.
Expect visibly lower skill and wider bands on them, and a guardrail more likely to refuse. That is
the honest result and nothing here tunes it away.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict
from pathlib import Path

import pandas as pd

from ml import config
from ml.features.features import HORIZONS, build_features
from ml.raksha.raksha import evaluate_horizon, latest_forecast

CLEAN_DIR = config.DATA_DIR / "clean"


def load_inputs(clean_dir: Path = CLEAN_DIR, raw_dir: Path = config.RAW_DIR) -> tuple[pd.DataFrame, pd.DataFrame, dict, dict]:
    series = pd.read_csv(clean_dir / "district_series.csv", parse_dates=["date"])
    series["date"] = series["date"].dt.date
    for column in ("observed", "imputed", "outlier", "unit_repaired", "zero_arrivals"):
        series[column] = series[column].astype(bool)
    weather = pd.read_csv(raw_dir / "weather_history.csv")
    report = json.loads((clean_dir / "ingest_report.json").read_text(encoding="utf-8"))
    crops = {c["id"]: c for c in json.loads((config.REFERENCE_DIR / "crops.json").read_text(encoding="utf-8"))["crops"]}
    return series, weather, report, crops


def run_raksha(clean_dir: Path = CLEAN_DIR, raw_dir: Path = config.RAW_DIR, out_dir: Path | None = None) -> list[dict]:
    series, weather, report, crops = load_inputs(clean_dir, raw_dir)
    out_dir = out_dir or clean_dir / "raksha"
    out_dir.mkdir(parents=True, exist_ok=True)
    sufficiency = {(s["crop"], s["district"]): s for s in report["series"]}
    results = []
    for (crop, district), part in series.groupby(["crop", "district"]):
        info = sufficiency[(crop, district)]
        profile = crops[crop]
        entry: dict = {"crop": crop, "district": district, "market": info["market"], "observations": info["observations"], "seasons": info["seasons"], "horizons": {}}
        if not info["sufficient"]:
            entry["status"] = "insufficient"
            entry["reason"] = f"thin series: {info['observations']} observations over {info['seasons']} seasons (needs {config.MIN_SERIES} and {config.MIN_SEASONS})"
            results.append(entry)
            (out_dir / f"{crop}__{district}.json").write_text(json.dumps(entry, indent=2), encoding="utf-8")
            continue
        district_weather = weather[weather["district"] == district]
        for horizon in HORIZONS:
            frame = build_features(part, district_weather, float(profile.get("weatherSensitivity", 0.3)), horizon)
            result = evaluate_horizon(frame, horizon, profile["class"])
            if result.status == "published":
                result.latest = latest_forecast(frame, result)
            entry["horizons"][f"h{horizon}"] = {k: v for k, v in asdict(result).items()}
        published = [h for h in entry["horizons"].values() if h["status"] == "published"]
        entry["status"] = "published" if published else "insufficient"
        entry["reason"] = None if published else "the model does not beat the naive (no-change) baseline at either horizon"
        results.append(entry)
        (out_dir / f"{crop}__{district}.json").write_text(json.dumps(entry, indent=2), encoding="utf-8")
    (clean_dir / "validation_report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def fmt(value: float | None, signed: bool = False, digits: int = 3) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "—"
    return f"{value:+.{digits}f}" if signed else f"{value:.{digits}f}"


def format_validation(results: list[dict]) -> str:
    head = f"{'crop × district':<26}{'h':>3}  {'obs':>5}  {'skill/naive':>11}  {'skill/seasonal':>14}  {'direction':>9}  {'wait prec (n)':>13}  {'coverage raw→held (cal)':>24}  {'band':>5}  {'κ/day':>6}  status"
    lines = [
        "VALIDATION — forward-chaining, out-of-fold (synthetic data, PROMPT §4.4; nominal band coverage 0.80)",
        "held = scored with the widening, weights and wait threshold learned only from earlier folds;",
        "cal  = coverage on the calibration folds themselves, >= nominal by construction;",
        "band = mean q10–q90 width in log units after widening; κ/day = measured staleness widening",
        head,
        "─" * len(head),
    ]
    for r in results:
        name = f"{r['crop']} × {r['district']}"
        if not r["horizons"]:
            lines.append(f"{name:<26}{'—':>3}  {r['observations']:>5}  {'':>11}  {'':>14}  {'':>9}  {'':>13}  {'':>24}  {'':>5}  {'':>6}  insufficient — {r['reason']}")
            continue
        for key, h in r["horizons"].items():
            wait = "—" if h["wait_precision"] is None else f"{h['wait_precision']:.2f} ({h['wait_count']})"
            cov = f"{h['coverage_raw']:.2f}→{h['coverage_conformal']:.2f} ({h['coverage_calibration']:.2f})"
            status = h["status"] if h["status"] == "published" else f"insufficient — {h['reason']}"
            lines.append(
                f"{name:<26}{key[1:]:>3}  {r['observations']:>5}  {fmt(h['skill_naive'], True):>11}  {fmt(h['skill_seasonal'], True):>14}  {fmt(h['directional_accuracy'], digits=2):>9}  {wait:>13}  {cov:>24}  {fmt(h['band_width'], digits=2):>5}  {fmt(h['band_kappa'], digits=3):>6}  {status}"
            )
    return "\n".join(lines)
