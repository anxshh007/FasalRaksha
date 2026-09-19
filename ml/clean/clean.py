"""The cleaner (PROMPT §4.2): detect and repair — with counters — and never repair silently.

Order matters and is fixed:

 1. Impossible rows  — min > max, modal outside [min, max], non-positive or missing prices,
                       future or invalid dates, unknown commodity/district → quarantined to
                       data/raw/_rejected.csv with a reason column.
 2. Unit errors      — rows quoted per kilogram while labelled per quintal: log price ≈ log 100
                       below the crop × district rolling median. Repaired (×100) and counted.
                       This is the most valuable repair: it produces confident wrong answers,
                       not errors, if left in.
 3. Duplicate sessions — the same market × commodity × date reported twice: collapsed by
                       volume-weighted median. Counted.
 4. Zero-arrival days — the market was open and nothing arrived: a real signal for arrival
                       pressure (RK-3), but its carried-over price is not a price. Distinguished
                       from market-closed days (Sundays, the published holiday calendar).
 5. Outliers         — Hampel filter on log price, per market series. Flagged, never deleted;
                       excluded from training targets later, kept in the record.
 6. Missing trading days — imputed in log space only for gaps of at most 3 trading days, marked
                       `imputed`, excluded from validation targets. Longer gaps stay gaps.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from ml import config
from ml.ingest.load import LoadResult

LOG_100 = float(np.log(100.0))
UNIT_TOLERANCE = 0.6  # |log ratio + log 100| below this reads as a per-kilogram quote
HAMPEL_WINDOW = 7
HAMPEL_K = 3.5
HAMPEL_FLOOR = 0.2  # never flag a move under ~22% as an outlier, however calm the series
MAX_IMPUTED_RUN = 3
SEASON_MIN_OBS = 60  # observed trading days that make a year count as a season


@dataclass
class CleanResult:
    market_daily: pd.DataFrame
    district_series: pd.DataFrame
    rejected: pd.DataFrame
    report: dict = field(default_factory=dict)


def weighted_median(values: np.ndarray, weights: np.ndarray) -> float:
    order = np.argsort(values)
    v, w = values[order], weights[order]
    cumulative = np.cumsum(w)
    return float(v[np.searchsorted(cumulative, cumulative[-1] / 2.0)])


def reject_impossible(frame: pd.DataFrame, as_of: date) -> tuple[pd.DataFrame, pd.DataFrame]:
    reason = pd.Series("", index=frame.index, dtype=object)

    def mark(mask: pd.Series, why: str) -> None:
        reason[(reason == "") & mask.fillna(False)] = why

    mark(frame["date"].isna(), "invalid or unparseable date")
    mark(frame["crop"].isna(), "commodity not in the synonym table")
    mark(frame["district"].isna(), "district not in the registry")
    mark(frame[["min", "max", "modal"]].isna().any(axis=1), "price missing or not a number")
    mark((frame["min"] <= 0) | (frame["max"] <= 0) | (frame["modal"] <= 0), "non-positive price")
    mark(frame["min"] > frame["max"], "minimum above maximum")
    mark((frame["modal"] < frame["min"]) | (frame["modal"] > frame["max"]), "modal outside the min–max range")
    mark(frame["date"].map(lambda d: d is not None and d > as_of), "date in the future")
    rejected = frame[reason != ""].assign(reason=reason[reason != ""])
    return frame[reason == ""].copy(), rejected


def repair_units(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame["log_modal"] = np.log(frame["modal"])
    frame["unit_repaired"] = False
    for (_, _), idx in frame.groupby(["crop", "district"]).groups.items():
        part = frame.loc[idx]
        daily = part.groupby("date")["log_modal"].median().sort_index()
        baseline = daily.rolling(15, center=True, min_periods=3).median().fillna(daily.median())
        deviation = part["log_modal"] - part["date"].map(baseline)
        per_kg = (deviation + LOG_100).abs() < UNIT_TOLERANCE
        hits = part.index[per_kg.to_numpy()]
        frame.loc[hits, ["min", "max", "modal"]] = frame.loc[hits, ["min", "max", "modal"]] * 100.0
        frame.loc[hits, "unit_repaired"] = True
    frame["log_modal"] = np.log(frame["modal"])
    return frame


def collapse_duplicates(frame: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    key = ["market", "crop", "date"]
    sizes = frame.groupby(key)["modal"].transform("size")
    single = frame[sizes == 1]
    multi = frame[sizes > 1]
    rows = []
    for _, group in multi.groupby(key):
        weights = group["arrivals"].fillna(0).clip(lower=0).to_numpy() + 1e-6
        first = group.iloc[0].to_dict()
        first.update(
            min=weighted_median(group["min"].to_numpy(), weights),
            max=weighted_median(group["max"].to_numpy(), weights),
            modal=weighted_median(group["modal"].to_numpy(), weights),
            arrivals=float(group["arrivals"].median()),
            unit_repaired=bool(group["unit_repaired"].any()),
        )
        rows.append(first)
    collapsed = pd.concat([single, pd.DataFrame(rows)], ignore_index=True) if rows else single.copy()
    collapsed["log_modal"] = np.log(collapsed["modal"])
    return collapsed, int(len(multi) - len(rows))


def flag_outliers(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.sort_values(["market", "crop", "date"]).copy()
    frame["outlier"] = False
    priced = frame["price_observed"]
    for (_, _), idx in frame[priced].groupby(["market", "crop"]).groups.items():
        x = frame.loc[idx, "log_modal"]
        med = x.rolling(2 * HAMPEL_WINDOW + 1, center=True, min_periods=HAMPEL_WINDOW).median()
        mad = (x - med).abs().rolling(2 * HAMPEL_WINDOW + 1, center=True, min_periods=HAMPEL_WINDOW).median()
        threshold = np.maximum(HAMPEL_K * 1.4826 * mad, HAMPEL_FLOOR)
        frame.loc[idx, "outlier"] = ((x - med).abs() > threshold).fillna(False).to_numpy()
    return frame


def trading_calendar(first: date, last: date, holidays: set[date]) -> list[date]:
    out, d = [], first
    while d <= last:
        if d.weekday() != 6 and d not in holidays:
            out.append(d)
        d += timedelta(days=1)
    return out


def district_series(market_daily: pd.DataFrame, holidays: set[date]) -> tuple[pd.DataFrame, int, int]:
    """One series per crop × district: the reference market (largest total arrivals), on the
    trading calendar, with short gaps imputed and flagged."""
    out = []
    imputed_total = 0
    gaps_left = 0
    for (crop, district), part in market_daily.groupby(["crop", "district"]):
        totals = part.groupby("market")["arrivals"].sum().sort_index()
        reference = str(totals.idxmax())
        ref = part[part["market"] == reference].set_index("date").sort_index()
        calendar = trading_calendar(min(ref.index), max(ref.index), holidays)
        s = ref.reindex(calendar)
        s["crop"], s["district"], s["market"] = crop, district, reference
        # Reindexing onto the calendar leaves NaN in the flag columns for days with no row: a
        # missing day is not a zero-arrival day, not an outlier, not repaired, not observed.
        for column, source in (("zero_arrivals", "zero_arrivals"), ("outlier", "outlier"), ("unit_repaired", "unit_repaired"), ("observed", "price_observed")):
            s[column] = s[source].eq(True)
        log_p = pd.Series(np.where(s["observed"], np.log(s["modal"].where(s["observed"])), np.nan), index=s.index)
        missing = log_p.isna().to_numpy()
        imputed = np.zeros(len(s), dtype=bool)
        i = 0
        while i < len(s):
            if not missing[i]:
                i += 1
                continue
            j = i
            while j < len(s) and missing[j]:
                j += 1
            run = j - i
            if 0 < i and j < len(s) and run <= MAX_IMPUTED_RUN:
                left, right = log_p.iloc[i - 1], log_p.iloc[j]
                for k in range(i, j):
                    log_p.iloc[k] = left + (right - left) * (k - i + 1) / (run + 1)
                    imputed[k] = True
            else:
                gaps_left += run
            i = j
        s["modal"] = np.exp(log_p).round(2)
        s["imputed"] = imputed
        imputed_total += int(imputed.sum())
        s = s.reset_index().rename(columns={"index": "date"})
        out.append(s[["date", "crop", "district", "market", "modal", "min", "max", "arrivals", "observed", "imputed", "outlier", "unit_repaired", "zero_arrivals"]])
    series = pd.concat(out, ignore_index=True)
    return series, imputed_total, gaps_left


def market_closed_days(market_daily: pd.DataFrame, holidays: set[date]) -> int:
    closed = 0
    for _, part in market_daily.groupby("market"):
        first, last = min(part["date"]), max(part["date"])
        d = first
        while d <= last:
            if d.weekday() == 6 or d in holidays:
                closed += 1
            d += timedelta(days=1)
    return closed


def clean(loaded: LoadResult, as_of: date, holidays: set[date]) -> CleanResult:
    frame, rejected = reject_impossible(loaded.frame, as_of)
    frame = repair_units(frame)
    unit_repairs = int(frame["unit_repaired"].sum())
    frame, duplicates = collapse_duplicates(frame)
    frame["zero_arrivals"] = frame["arrivals"].fillna(-1) == 0
    frame["price_observed"] = ~frame["zero_arrivals"]
    frame = flag_outliers(frame)
    series, imputed, gaps_left = district_series(frame, holidays)

    lengths = []
    per_series = []
    for (crop, district), part in series.groupby(["crop", "district"]):
        observed = part[part["observed"]]
        seasons = int((observed.groupby(observed["date"].map(lambda d: d.year)).size() >= SEASON_MIN_OBS).sum())
        lengths.append(len(observed))
        per_series.append({
            "crop": crop, "district": district, "market": str(part["market"].iloc[0]), "observations": int(len(observed)),
            "seasons": seasons, "first": str(min(part["date"])), "last": str(max(part["date"])),
            "sufficient": bool(len(observed) >= config.MIN_SERIES and seasons >= config.MIN_SEASONS),
        })

    reasons = rejected["reason"].value_counts().to_dict() if len(rejected) else {}
    report = {
        "dataset": ", ".join(loaded.mappings),
        "synthetic": True,
        "as_of": as_of.isoformat(),
        "raw_rows": int(loaded.raw_rows),
        "resolved_columns": f"{loaded.resolved_columns[0]}/{loaded.resolved_columns[1]}",
        "unit_errors_repaired": unit_repairs,
        "duplicate_sessions_collapsed": duplicates,
        "impossible_rows_rejected": int(len(rejected)),
        "rejected_by_reason": {str(k): int(v) for k, v in reasons.items()},
        "imputed_trading_days": imputed,
        "gaps_left_unimputed": gaps_left,
        "zero_arrival_days": int(frame["zero_arrivals"].sum()),
        "market_closed_days": market_closed_days(frame, holidays),
        "outliers_flagged": int(frame["outlier"].sum()),
        "unknown_commodity_names": {str(k): int(v) for k, v in loaded.unknown_commodities.items()},
        "series_count": len(per_series),
        "series_length": {"min": int(min(lengths)), "median": int(np.median(lengths)), "max": int(max(lengths))} if lengths else None,
        "series": per_series,
    }
    market_daily = frame.drop(columns=["log_modal"]).sort_values(["crop", "district", "market", "date"])
    return CleanResult(market_daily=market_daily, district_series=series, rejected=rejected, report=report)


def format_report(report: dict) -> str:
    length = report["series_length"]
    rows = [
        ("raw rows", f"{report['raw_rows']:,}"),
        ("resolved columns", report["resolved_columns"]),
        ("unit errors repaired", f"{report['unit_errors_repaired']:,}"),
        ("duplicate sessions collapsed", f"{report['duplicate_sessions_collapsed']:,}"),
        ("impossible rows rejected", f"{report['impossible_rows_rejected']:,}"),
        ("imputed trading days", f"{report['imputed_trading_days']:,}"),
        ("zero-arrival days", f"{report['zero_arrival_days']:,}"),
        ("market-closed days", f"{report['market_closed_days']:,}"),
        ("outliers flagged (kept)", f"{report['outliers_flagged']:,}"),
        ("crop × district series", f"{report['series_count']}  ({length['min']} / {length['median']} / {length['max']})" if length else "0"),
    ]
    label = "synthetic, PROMPT §4.4" if report.get("synthetic") else "supplied"
    lines = [f"INGEST REPORT — {report['dataset']} ({label})"]
    lines += [f"{name:<30}{value}" for name, value in rows]
    if report["rejected_by_reason"]:
        lines.append("rejected, by reason:")
        lines += [f"  {reason:<40}{count:>6}" for reason, count in sorted(report["rejected_by_reason"].items())]
    thin = [f"{s['crop']} × {s['district']} ({s['observations']} obs, {s['seasons']} seasons)" for s in report["series"] if not s["sufficient"]]
    if thin:
        lines.append(f"insufficient (forecast will be withheld): {'; '.join(thin)}")
    return "\n".join(lines)


def write_outputs(result: CleanResult, clean_dir: Path = config.DATA_DIR / "clean", raw_dir: Path = config.RAW_DIR) -> None:
    clean_dir.mkdir(parents=True, exist_ok=True)
    result.market_daily.to_csv(clean_dir / "market_daily.csv", index=False)
    result.district_series.to_csv(clean_dir / "district_series.csv", index=False)
    result.rejected.to_csv(raw_dir / "_rejected.csv", index=False)
    (clean_dir / "ingest_report.json").write_text(json.dumps(result.report, indent=2, ensure_ascii=False), encoding="utf-8")
