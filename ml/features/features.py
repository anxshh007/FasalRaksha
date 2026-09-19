"""Feature construction for RK-1…RK-6 (PROMPT §5.2, §5.3).

Every feature must be available at prediction time. At the close of trading day t we know
today's price and anything published before today; we do **not** know today's arrival volume
(it is reported with the prices, after the fact) — so arrival pressure is lagged one trading day.
`test_leakage.py` fails if any feature at t moves when same-day arrivals or same-day weather
change. That is the single most likely silent error in a pipeline like this one.

Target: log(P_{t+h} / P_t) — the log return to the first trading day on or after t + h calendar
days. Only real, clean observations make targets: an imputed day, an outlier or a zero-arrival
day never becomes something the model is scored against.
"""
from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd

from ml.climatology.climatology import SeasonalProfiles, weather_climatology, week_of_year

HORIZONS = (7, 14)
LAGS = (1, 2, 3, 7, 14, 28)
EWMA_SPANS = (3, 7, 14)
TARGET_SLACK_DAYS = 3  # the target day may be up to 3 days after t + h (weekends, holidays)

FEATURE_COLUMNS = (
    [f"r{k}" for k in LAGS]
    + [f"ewm{s}" for s in EWMA_SPANS]
    + ["momentum", "seasonal_position", "seasonal_drift", "arrival_pressure", "weather_pressure", "shock_z"]
    + ["dow", "woy_sin", "woy_cos", "days_since_trade", "imputed"]
)

#: The scalar each server-side layer contributes to the evidence vote (RK-8).
LAYER_SIGNALS = {"RK-1": "momentum", "RK-2": "seasonal_drift", "RK-3": "arrival_pressure", "RK-4": "weather_pressure", "RK-5": "shock_z"}


def build_features(
    series: pd.DataFrame,
    weather: pd.DataFrame,
    sensitivity: float,
    horizon: int,
) -> pd.DataFrame:
    """One row per trading day of one crop × district series, with features and the target."""
    s = series.sort_values("date").reset_index(drop=True).copy()
    dates = pd.Series(pd.to_datetime(s["date"]).dt.date)
    log_p = np.log(s["modal"].astype(float))
    usable = s["observed"] & ~s["imputed"] & ~s["outlier"]

    out = pd.DataFrame({"date": dates, "log_p": log_p, "usable": usable})

    # ── target ────────────────────────────────────────────────────────────────
    ordinals = np.array([d.toordinal() for d in dates])
    want = ordinals + horizon
    j = np.searchsorted(ordinals, want)
    in_range = j < len(s)
    j_safe = np.minimum(j, len(s) - 1)
    close_enough = in_range & ((ordinals[j_safe] - want) <= TARGET_SLACK_DAYS)
    valid = close_enough & usable.to_numpy() & usable.to_numpy()[j_safe]
    out["target"] = np.where(valid, log_p.to_numpy()[j_safe] - log_p.to_numpy(), np.nan)
    out["target_date"] = [dates.iloc[k] if ok else None for k, ok in zip(j_safe, close_enough)]

    # ── RK-1 market persistence ───────────────────────────────────────────────
    for k in LAGS:
        out[f"r{k}"] = log_p - log_p.shift(k)
    for span in EWMA_SPANS:
        out[f"ewm{span}"] = log_p - log_p.ewm(span=span, adjust=False, ignore_na=True).mean()
    out["momentum"] = out["r7"] - out["r28"] / 4.0

    # ── RK-2 seasonal position (earlier years only: leak-free in validation) ──
    profiles = SeasonalProfiles(dates, log_p)
    trailing = log_p.rolling(250, min_periods=60).mean()
    seasonal_now = np.array([profiles.value(d) for d in dates])
    seasonal_then = np.array([profiles.value(d + timedelta(days=horizon), exclude_year=d.year) for d in dates])
    out["seasonal_position"] = (log_p - trailing).to_numpy() - seasonal_now
    out["seasonal_drift"] = seasonal_then - seasonal_now

    # ── RK-3 arrival pressure, lagged one trading day ─────────────────────────
    # The norm is the median arrival *level* for that week in every earlier year.
    log_arr = np.log1p(s["arrivals"].astype(float))
    frame_arr = pd.DataFrame({"log_arr": log_arr, "week": dates.map(week_of_year), "year": dates.map(lambda d: d.year)}).dropna()
    by_week = {week: part for week, part in frame_arr.groupby("week")}
    norm_cache: dict[tuple[int, int], float] = {}

    def arrival_norm(year: int, week: int) -> float:
        if (year, week) not in norm_cache:
            part = by_week.get(week)
            others = part[part["year"] < year]["log_arr"] if part is not None else pd.Series(dtype=float)
            norm_cache[(year, week)] = float(others.median()) if len(others) else np.nan
        return norm_cache[(year, week)]

    norms = np.array([arrival_norm(d.year, week_of_year(d)) for d in dates])
    pressure = (log_arr - norms).clip(-2.0, 2.0)
    out["arrival_pressure"] = pressure.shift(1)  # yesterday's arrivals: known at prediction time

    # ── RK-4 weather pressure: previous 7 days' rain anomaly × crop sensitivity ─
    rain = weather.set_index("date")["rain_mm"] if len(weather) else pd.Series(dtype=float)
    climate_by_year: dict[int, pd.DataFrame] = {}
    anomalies = []
    for d in dates:
        if d.year not in climate_by_year:  # the norm for judging year Y is built from earlier years only
            climate_by_year[d.year] = weather_climatology(weather, before_year=d.year).set_index("week")
        clim = climate_by_year[d.year]
        window = [(d - timedelta(days=k)).isoformat() for k in range(1, 8)]
        values = [rain.get(w) for w in window]
        if any(v is None or pd.isna(v) for v in values):
            anomalies.append(np.nan)
            continue
        week = week_of_year(d - timedelta(days=1))
        if week not in clim.index:
            anomalies.append(np.nan)
            continue
        anomalies.append((float(np.sum(values)) - float(clim.at[week, "rain7_mean"])) / float(clim.at[week, "rain7_sd"]) * sensitivity)
    out["weather_pressure"] = anomalies

    # ── RK-5 market shock: robust z of today's return ─────────────────────────
    r1 = out["r1"]
    med = r1.rolling(60, min_periods=20).median()
    mad = (r1 - med).abs().rolling(60, min_periods=20).median()
    out["shock_z"] = ((r1 - med) / (1.4826 * mad + 1e-6)).clip(-6, 6)

    # ── calendar and data-quality context ─────────────────────────────────────
    week = dates.map(week_of_year)
    out["dow"] = dates.map(lambda d: d.weekday())
    out["woy_sin"] = np.sin(2 * np.pi * week / 52.0)
    out["woy_cos"] = np.cos(2 * np.pi * week / 52.0)
    observed_dates = pd.Series(np.where(s["observed"], ordinals, np.nan))
    out["days_since_trade"] = ordinals - observed_dates.shift(1).ffill().to_numpy()
    out["imputed"] = s["imputed"].astype(int)
    out["horizon"] = horizon
    return out
