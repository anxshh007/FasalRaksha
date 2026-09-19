"""Bundle export (PROMPT §5.8): the pipeline's half of every crop × district bundle.

The pipeline owns what it measured: the district benchmark, the 7-day trend, the seasonal
position, arrivals, the conformalised forecast and the layer readings with their measured
weights. It seals that "core" with the canonical hash. The API's publisher verifies the seal,
which is the Python↔TypeScript parity check on every real artefact, then adds the parts that are
not the pipeline's to decide: MSP from the one constants module, and storage and transport from
their registries. It re-seals and serves the result.

    data/bundles/<version>/pipeline/core/<crop>__<district>.json
    data/bundles/<version>/pipeline/climatology/<district>.json
    data/bundles/<version>/pipeline/manifest.json

Everything is deterministic for a given --as-of (PROMPT §14.2). `generatedAt` is therefore the
run's *logical* time: 02:00 IST on the night after the as-of day, when the nightly job runs. It
is not the wall clock, so a rerun is byte-identical.
"""
from __future__ import annotations

import json
import math
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from ml import config
from ml.climatology.climatology import seasonal_profile, weather_climatology, week_of_year
from ml.export.canonical import seal

SCHEMA_VERSION = 3
TREND_DAYS = 7
LAYERS = ("RK-1", "RK-2", "RK-3", "RK-4", "RK-5", "RK-6")


def bundle_version(as_of: date) -> str:
    return f"{as_of.isoformat()}.1"


def logical_run_time(as_of: date) -> str:
    return f"{as_of.isoformat()}T20:30:00Z"  # 02:00 IST on as_of + 1


def _round(value: float | None, digits: int) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return round(float(value), digits)


def usable_rows(part: pd.DataFrame) -> pd.DataFrame:
    return part[part["observed"] & ~part["imputed"] & ~part["outlier"]].sort_values("date")


def trend_points(part: pd.DataFrame, as_of: date) -> list[dict]:
    """The last seven calendar days to the benchmark date. A day with no trading is null —
    shown as a gap, never interpolated — and an imputed day says so."""
    by_date = {row.date: row for row in part.itertuples(index=False)}
    points = []
    for k in range(TREND_DAYS - 1, -1, -1):
        d = as_of - timedelta(days=k)
        row = by_date.get(d)
        if row is None or not (row.observed or row.imputed):
            points.append({"date": d.isoformat(), "modal": None})
            continue
        point = {"date": d.isoformat(), "modal": _round(row.modal, 2)}
        if row.imputed:
            point["imputed"] = True
        points.append(point)
    return points


def seasonal_block(part: pd.DataFrame, as_of: date, p0: float) -> dict | None:
    """This week's norm (RK-2) in ₹: the earlier-years profile, anchored on the trailing year's
    mean price level. None when there is no earlier year for this week."""
    rows = usable_rows(part)
    dates = pd.Series(rows["date"].to_numpy())
    log_p = pd.Series(np.log(rows["modal"].astype(float)).to_numpy())
    profile = seasonal_profile(dates, log_p, exclude_year=as_of.year).set_index("week")
    week = week_of_year(as_of)
    if week not in profile.index or profile.loc[week, ["median", "q25", "q75"]].isna().any():
        return None
    year_ago = as_of - timedelta(days=365)
    anchor = float(log_p[dates.map(lambda d: d > year_ago)].mean())
    median, low, high = (float(np.exp(anchor + profile.at[week, c])) for c in ("median", "q25", "q75"))
    position = "above" if p0 > high else "below" if p0 < low else "within"
    return {"woyMedian": round(median, 2), "woyIQR": [round(low, 2), round(high, 2)], "position": position}


def arrivals_ratio(part: pd.DataFrame, as_of: date) -> float | None:
    """Today's arrivals against the median for this week in earlier years (the RK-3 norm)."""
    today = part[part["date"] == as_of]
    if today.empty or pd.isna(today["arrivals"].iloc[0]):
        return None
    earlier = part[(part["date"].map(lambda d: d.year) < as_of.year) & (part["date"].map(week_of_year) == week_of_year(as_of))]
    norm = float(earlier["arrivals"].median()) if len(earlier) else float("nan")
    if not norm > 0:
        return None
    return round(float(today["arrivals"].iloc[0]) / norm, 3)


def horizon_block(h: dict | None) -> dict | None:
    if h is None or h["status"] != "published" or not h.get("latest"):
        return None
    latest = h["latest"]
    return {
        "q10": latest["q10"], "q50": latest["q50"], "q90": latest["q90"],
        "direction": latest["direction"],
        "agreement": max(round(latest["agreement"], 4), 1 / 3),  # never rounded below its floor
        "skill": round(h["skill_naive"], 4),
        "skillSeasonal": round(h["skill_seasonal"], 4),
        "coverage": round(h["coverage_conformal"], 4),  # held out, not the by-construction number
        "bandKappa": round(h["band_kappa"], 4),
        "confidenceMin": h["confidence_min"],
    }


def layers_block(forecast_source: dict | None) -> dict:
    """The layer readings behind the headline horizon (h7, or h14 when h7 is withheld). With no
    published horizon every layer says nothing and carries no weight."""
    out = {}
    for layer in LAYERS:
        reading = (forecast_source or {}).get("latest", {}).get("layers", {}).get(layer)
        out[layer] = (
            {"bucket": reading["bucket"], "weight": round(reading["weight"], 4), "value": _round(reading["value"], 4)}
            if reading else {"bucket": None, "weight": 0, "value": None}
        )
    return out


def build_core(entry: dict, part: pd.DataFrame, profile: dict, version: str, generated_at: str) -> dict:
    rows = usable_rows(part)
    if rows.empty:
        raise ValueError(f"{entry['crop']} × {entry['district']}: no usable observation to benchmark")
    last = rows.iloc[-1]
    as_of: date = last["date"]
    p0 = float(last["modal"])
    h7, h14 = entry["horizons"].get("h7"), entry["horizons"].get("h14")
    forecast = {"h7": horizon_block(h7), "h14": horizon_block(h14)}
    published = entry["status"] == "published" and (forecast["h7"] is not None or forecast["h14"] is not None)
    for h in (h7, h14):
        if published and h and h.get("latest"):
            # The forecast must be anchored on the very price the device will compare against.
            if h["latest"]["date"] != as_of.isoformat() or h["latest"]["p0"] != round(p0, 2):
                raise ValueError(f"{entry['crop']} × {entry['district']}: forecast anchored on {h['latest']['date']} ₹{h['latest']['p0']}, benchmark is {as_of} ₹{p0:.2f}")
    headline = h7 if forecast["h7"] else h14 if forecast["h14"] else None
    return seal({
        "schemaVersion": SCHEMA_VERSION,
        "version": version,
        "generatedAt": generated_at,
        "asOf": as_of.isoformat(),
        "district": entry["district"],
        "crop": entry["crop"],
        "market": entry["market"],
        "benchmark": {"modal": round(p0, 2), "min": round(float(last["min"]), 2), "max": round(float(last["max"]), 2), "unit": "quintal"},
        "trend": trend_points(part, as_of),
        "seasonal": seasonal_block(part, as_of, p0),
        "arrivalsRatio": arrivals_ratio(part, as_of),
        "forecast": forecast if published else None,
        "raksha": {"layers": layers_block(headline if published else None)},
        "stalenessLimitDays": int(profile["stalenessLimitDays"]),
        "status": "published" if published else "insufficient",
    })


def climatology_bundle(weather: pd.DataFrame, district: str, version: str, generated_at: str) -> dict:
    table = weather_climatology(weather[weather["district"] == district])
    weeks = [
        {"week": int(r.week), "rain7Mean": round(float(r.rain7_mean), 1), "rain7Sd": round(float(r.rain7_sd), 1), "humidityMean": round(float(r.humidity_mean), 1)}
        for r in table.sort_values("week").itertuples(index=False)
    ]
    return seal({"schemaVersion": SCHEMA_VERSION, "kind": "climatology", "version": version, "generatedAt": generated_at, "district": district, "weeks": weeks})


def _write(path: Path, document: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(document, ensure_ascii=False, indent=1) + "\n"
    path.write_text(body, encoding="utf-8", newline="\n")
    return len(body.encode("utf-8"))


def export_bundles(results: list[dict], series: pd.DataFrame, weather: pd.DataFrame, crops: dict, as_of: date, root: Path = config.BUNDLES_DIR) -> dict:
    version, generated_at = bundle_version(as_of), logical_run_time(as_of)
    out = root / version / "pipeline"
    manifest: dict = {
        "schemaVersion": SCHEMA_VERSION, "kind": "pipeline-manifest", "version": version, "generatedAt": generated_at,
        "asOf": as_of.isoformat(), "dataSource": "synthetic", "cores": [], "climatology": [],
    }
    for entry in results:
        part = series[(series["crop"] == entry["crop"]) & (series["district"] == entry["district"])]
        core = build_core(entry, part, crops[entry["crop"]], version, generated_at)
        name = f"core/{entry['crop']}__{entry['district']}.json"
        size = _write(out / name, core)
        manifest["cores"].append({"crop": entry["crop"], "district": entry["district"], "file": name, "status": core["status"], "integrity": core["integrity"], "bytes": size})
    for district in sorted({e["district"] for e in results}):
        document = climatology_bundle(weather, district, version, generated_at)
        name = f"climatology/{district}.json"
        size = _write(out / name, document)
        manifest["climatology"].append({"district": district, "file": name, "integrity": document["integrity"], "bytes": size})
    sealed = seal(manifest)
    _write(out / "manifest.json", sealed)
    return sealed


def format_export(manifest: dict) -> str:
    lines = [f"BUNDLES — version {manifest['version']} ({manifest['dataSource']} data), pipeline cores sealed:"]
    for c in manifest["cores"]:
        lines.append(f"  {c['crop'] + ' × ' + c['district']:<28}{c['status']:<14}{c['bytes']:>6} B  {c['integrity'][:19]}…")
    lines.append(f"  climatology: {', '.join(c['district'] for c in manifest['climatology'])}")
    return "\n".join(lines)
