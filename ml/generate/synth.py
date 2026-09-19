"""Synthetic Agmarknet/MSAMB-shaped market data (PROMPT §4.4) — used only because no real dataset
was supplied. It is labelled synthetic everywhere it surfaces.

A structural price process, not hand-crafted numbers:

    log P(t) = log base + inflation(t)
             − γ · log(seasonal arrival norm)          harvest calendar: prices fall at harvest
             − β · (log arrivals(t) − log norm)          arrival pressure (same-day, as in real markets)
             + δ · rainfall anomaly (previous week)      weather pressure on perishables
             + u(t),  u AR(1) with φ ≈ 0.97              persistent level deviations
             + regimes                                    policy / trade regimes (export ban, stock
                                                          limit): on and off without warning

Then every defect class in PROMPT §4.2 is injected on purpose, and a manifest of exactly what was
injected is written beside the data, so the cleaner's counters can be checked against truth.
Every random draw comes from one seeded generator (PROMPT §14.2).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from ml import config

MONTHLY = tuple[float, float, float, float, float, float, float, float, float, float, float, float]


@dataclass(frozen=True)
class Market:
    name: str
    district: str
    arrival_share: float
    price_offset: float  # log offset from the district price
    label: str  # the commodity name this market's feed uses (naming inconsistency)


@dataclass(frozen=True)
class Series:
    crop: str
    district: str
    markets: tuple[Market, ...]
    base_price: float  # ₹/qtl at the start
    base_arrivals: float  # tonnes/day across the district
    season: MONTHLY  # arrival multiplier by calendar month
    gamma: float  # seasonal price response
    beta: float  # arrival-pressure response
    delta: float  # rain response
    vol: float  # daily innovation of the AR(1) level
    shock_rate: float  # regime onsets per year
    shock_size: float  # sd of the level a regime imposes (log units)
    source: str = "agmarknet"
    start: str = "2021-01-01"
    variety: str = "FAQ"


ONION: MONTHLY = (1.3, 1.1, 1.3, 1.5, 1.4, 1.0, 0.7, 0.6, 0.6, 0.8, 1.1, 1.4)
SOY: MONTHLY = (0.8, 0.6, 0.5, 0.4, 0.4, 0.3, 0.3, 0.3, 0.6, 1.8, 2.0, 1.4)
TUR: MONTHLY = (2.0, 1.8, 1.2, 0.8, 0.6, 0.5, 0.4, 0.4, 0.4, 0.5, 0.7, 1.5)
GRAM: MONTHLY = (0.6, 0.8, 2.0, 2.2, 1.2, 0.8, 0.6, 0.5, 0.4, 0.4, 0.4, 0.4)
BANANA: MONTHLY = (1.1, 1.1, 1.2, 1.2, 1.1, 0.9, 0.8, 0.8, 0.9, 1.0, 1.0, 1.1)
ORANGE: MONTHLY = (1.6, 1.4, 1.2, 0.8, 0.6, 0.4, 0.3, 0.3, 0.5, 0.8, 1.4, 1.7)
TOMATO: MONTHLY = (1.2, 1.1, 1.0, 0.9, 0.8, 0.7, 0.8, 0.9, 1.0, 1.2, 1.3, 1.3)
POTATO: MONTHLY = (1.3, 1.4, 1.3, 1.0, 0.8, 0.7, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2)
POMEGRANATE: MONTHLY = (1.0, 1.1, 1.2, 1.0, 0.8, 0.7, 0.8, 1.0, 1.2, 1.3, 1.2, 1.0)
GRAPES: MONTHLY = (1.2, 1.8, 2.0, 1.5, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2)

SERIES: tuple[Series, ...] = (
    Series("onion", "nashik", (
        Market("Lasalgaon", "Nashik", 0.55, 0.0, "Onion"),
        Market("Pimpalgaon Baswant", "Nashik", 0.30, -0.02, "ONION"),
        Market("Nashik", "Nashik", 0.15, 0.03, "Onion"),
    ), 1450, 2400, ONION, 0.55, 0.35, 0.8, 0.028, 1.2, 0.30),
    Series("onion", "ahilyanagar", (
        Market("Rahuri", "Ahilyanagar", 1.0, 0.0, "Onion(Red)"),
    ), 1380, 700, ONION, 0.55, 0.35, 0.8, 0.028, 1.2, 0.30),
    Series("soybean", "latur", (Market("Latur", "Latur", 1.0, 0.0, "सोयाबीन"),), 4200, 3000, SOY, 0.18, 0.08, 0.1, 0.009, 0.4, 0.10, source="msamb"),
    Series("tur", "latur", (Market("Latur", "Latur", 1.0, 0.0, "तूर"),), 6300, 900, TUR, 0.20, 0.10, 0.1, 0.011, 0.5, 0.12, source="msamb"),
    Series("gram", "latur", (Market("Latur", "Latur", 1.0, 0.0, "हरभरा"),), 4700, 800, GRAM, 0.16, 0.08, 0.1, 0.008, 0.3, 0.08, source="msamb"),
    Series("banana", "jalgaon", (
        Market("Jalgaon", "Jalgaon", 0.4, 0.0, "Banana"),
        Market("Raver", "Jalgaon", 0.6, -0.04, "Banana - Green"),
    ), 1150, 1500, BANANA, 0.25, 0.20, 0.3, 0.016, 0.4, 0.15),
    Series("orange", "nagpur", (Market("Kalamna", "Nagpur", 1.0, 0.0, "Orange"),), 2600, 600, ORANGE, 0.40, 0.20, 0.3, 0.018, 0.4, 0.15),
    Series("tomato", "pune", (
        Market("Narayangaon", "Pune", 0.6, 0.0, "Tomato"),
        Market("Manchar", "Pune", 0.4, 0.02, "Tomato"),
    ), 1250, 900, TOMATO, 0.60, 0.45, 1.0, 0.040, 1.5, 0.35),
    Series("tomato", "nashik", (Market("Nashik", "Nashik", 1.0, 0.0, "Tomato"),), 1150, 500, TOMATO, 0.60, 0.45, 1.0, 0.040, 1.5, 0.35),
    Series("potato", "pune", (Market("Manchar", "Pune", 1.0, 0.0, "Potato"),), 1350, 700, POTATO, 0.35, 0.25, 0.4, 0.020, 0.6, 0.20),
    Series("pomegranate", "ahilyanagar", (Market("Rahuri", "Ahilyanagar", 1.0, 0.0, "Pomegranate"),), 5200, 250, POMEGRANATE, 0.25, 0.15, 0.4, 0.018, 0.4, 0.15),
    # Deliberately thin: two short seasons of trading — the "insufficient" path must be exercised.
    Series("grapes", "nashik", (Market("Nashik", "Nashik", 1.0, 0.0, "Grapes"),), 3200, 400, GRAPES, 0.30, 0.20, 0.5, 0.020, 0.3, 0.15, start="2025-01-01"),
)

DISTRICT_RAIN = {  # mean monsoon-day rain (mm) and monsoon wet-day chance, by district
    "nashik": (9.0, 0.55), "ahilyanagar": (7.0, 0.45), "latur": (8.5, 0.50), "jalgaon": (8.0, 0.50),
    "nagpur": (12.0, 0.60), "pune": (10.0, 0.55),
}
MONSOON_CHANCE = (0.02, 0.02, 0.04, 0.06, 0.12, 0.55, 0.7, 0.65, 0.5, 0.2, 0.06, 0.02)


def load_holidays(path: Path) -> set[date]:
    table = pd.read_csv(path)
    return {date.fromisoformat(d) for d in table["date"]}


def trading_days(start: date, end: date, holidays: set[date]) -> list[date]:
    out, d = [], start
    while d <= end:
        if d.weekday() != 6 and d not in holidays:  # APMCs close on Sundays and listed holidays
            out.append(d)
        d += timedelta(days=1)
    return out


def season_value(season: MONTHLY, d: date) -> float:
    """Monthly calendar interpolated to the day, so prices do not jump at month boundaries."""
    month_pos = (d.month - 1) + (d.day - 1) / 31.0 - 0.5
    lo = int(np.floor(month_pos)) % 12
    hi = (lo + 1) % 12
    w = month_pos - np.floor(month_pos)
    return float(season[lo] * (1 - w) + season[hi] * w)


@dataclass
class Manifest:
    as_of: str
    seed: int
    rows_clean: int = 0
    injected: dict[str, int] = field(default_factory=dict)
    unit_rows: list[list[str]] = field(default_factory=list)
    outlier_rows: list[list[str]] = field(default_factory=list)


def weather_history(districts: set[str], start: date, end: date, rng: np.random.Generator) -> pd.DataFrame:
    rows = []
    years = range(start.year, end.year + 1)
    strength = {(dist, y): float(np.exp(rng.normal(0, 0.25))) for dist in districts for y in years}  # monsoon strength per year
    d = start
    while d <= end:
        for dist in sorted(districts):
            mean_mm, _ = DISTRICT_RAIN[dist]
            chance = min(0.95, MONSOON_CHANCE[d.month - 1] * (strength[(dist, d.year)] if 6 <= d.month <= 9 else 1.0))
            wet = rng.random() < chance
            rain = float(rng.gamma(0.8, mean_mm / 0.8)) * (strength[(dist, d.year)] if 6 <= d.month <= 9 else 0.4) if wet else 0.0
            humidity = 35 + 50 * MONSOON_CHANCE[d.month - 1] + (10 if wet else 0) + rng.normal(0, 4)
            rows.append({"date": d.isoformat(), "district": dist, "rain_mm": round(rain, 1), "humidity_pct": round(float(np.clip(humidity, 10, 100)), 1)})
        d += timedelta(days=1)
    return pd.DataFrame(rows)


def simulate_series(s: Series, days: list[date], weather: pd.DataFrame, rng: np.random.Generator) -> list[dict]:
    rain = weather[weather["district"] == s.district].set_index("date")["rain_mm"]
    clim = weather[weather["district"] == s.district].assign(month=lambda f: f["date"].str[5:7]).groupby("month")["rain_mm"].mean()
    rows: list[dict] = []
    u = 0.0
    shock = 0.0
    regime_left = 0.0  # calendar days until the current policy regime lifts
    arrival_noise = 0.0
    start = date.fromisoformat(s.start)
    years = 0.0
    prev = None
    for d in days:
        if d < start:
            continue
        season = season_value(s.season, d)
        if season <= 0.05:  # off-season: this crop is not traded at all
            prev = d
            continue
        gap = 1 if prev is None else (d - prev).days
        prev = d
        years = (d - start).days / 365.25
        arrival_noise = 0.6 * arrival_noise + rng.normal(0, 0.25)
        arrivals = s.base_arrivals * season * float(np.exp(arrival_noise))
        u = (0.97 ** gap) * u + rng.normal(0, s.vol) * np.sqrt(gap)
        # A policy regime switches the level on and off without warning, and how long it lasts is
        # unknowable — unlike a decaying shock, nothing in the past says when it will lift.
        if regime_left > 0:
            regime_left -= gap
            if regime_left <= 0:
                shock = 0.0
        elif rng.random() < s.shock_rate / 300.0:
            shock = rng.normal(0, s.shock_size)
            regime_left = 10.0 + rng.exponential(45.0)
        window = [(d - timedelta(days=k)).isoformat() for k in range(1, 8)]
        recent = float(np.mean([rain.get(w, 0.0) for w in window]))
        anomaly = (recent - float(clim.get(f"{d.month:02d}", 0.0))) / 10.0
        log_p = (
            np.log(s.base_price)
            + 0.05 * years
            - s.gamma * np.log(max(season, 0.1))
            - s.beta * arrival_noise
            + s.delta * anomaly * 0.1
            + u
            + shock
        )
        for m in s.markets:
            market_noise = rng.normal(0, 0.015)
            modal = float(np.exp(log_p + m.price_offset + market_noise))
            lo = modal * float(np.exp(-abs(rng.normal(0.12, 0.04))))
            hi = modal * float(np.exp(abs(rng.normal(0.10, 0.04))))
            rows.append({
                "crop": s.crop, "district": s.district, "market": m.name, "district_label": m.district, "label": m.label,
                "variety": s.variety, "date": d, "min": round(lo), "max": round(hi), "modal": round(modal),
                "arrivals": round(arrivals * m.arrival_share * float(np.exp(rng.normal(0, 0.1))), 1), "source": s.source,
            })
    return rows


def inject_defects(rows: list[dict], as_of: date, rng: np.random.Generator, manifest: Manifest) -> list[dict]:
    """Every §4.2 defect class, at rates of the order real extracts show, recorded in the manifest."""
    out: list[dict] = []
    counts = {"unit_per_kg": 0, "duplicates": 0, "missing_days": 0, "zero_arrivals": 0, "impossible": 0, "invalid_date": 0, "outliers": 0}
    for r in rows:
        roll = rng.random()
        if roll < 0.03:  # a trading day nobody reported
            counts["missing_days"] += 1
            continue
        r = dict(r)
        key = [r["market"], r["crop"], r["date"].isoformat()]
        kind = rng.random()
        if kind < 0.005:
            # Quoted per kilogram while the feed says per quintal: the two-orders-of-magnitude defect.
            r.update(min=round(r["min"] / 100, 2), max=round(r["max"] / 100, 2), modal=round(r["modal"] / 100, 2))
            counts["unit_per_kg"] += 1
            manifest.unit_rows.append(key)
        elif kind < 0.007:
            factor = 2.2 if rng.random() < 0.5 else 0.45
            r.update(min=round(r["min"] * factor), max=round(r["max"] * factor), modal=round(r["modal"] * factor))
            counts["outliers"] += 1
            manifest.outlier_rows.append(key)
        elif kind < 0.011:
            r.update(arrivals=0.0)  # reported, but nothing arrived: price carried over, not traded
            counts["zero_arrivals"] += 1
        elif kind < 0.014:
            flavour = rng.integers(0, 4)
            if flavour == 0:
                r.update(min=r["max"] + 50)
            elif flavour == 1:
                r.update(modal=round(r["max"] * 1.3))
            elif flavour == 2:
                r.update(modal=0)
            else:
                r.update(date=as_of + timedelta(days=int(rng.integers(30, 400))))
            counts["impossible"] += 1
        out.append(r)
        if rng.random() < 0.012:
            dup = dict(r)
            dup.update(modal=round(r["modal"] * float(1 + rng.uniform(-0.03, 0.03)), 2), arrivals=round(r["arrivals"] * float(rng.uniform(0.5, 1.5)), 1))
            out.append(dup)
            counts["duplicates"] += 1
    # Two dates that do not exist on any calendar.
    for bad in ("31/02/2024", "00/13/2025"):
        r = dict(out[len(out) // 2])
        r["date_text"] = bad
        out.append(r)
        counts["invalid_date"] += 1
    manifest.injected = counts
    return out


def to_agmarknet(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame({
        "State": "Maharashtra",
        "District": [r["district_label"] for r in rows],
        "Market": [r["market"] for r in rows],
        "Commodity": [r["label"] for r in rows],
        "Variety": [r["variety"] for r in rows],
        "Grade": "FAQ",
        "Arrival_Date": [r.get("date_text") or r["date"].strftime("%d/%m/%Y") for r in rows],
        "Min_x0020_Price": [r["min"] for r in rows],
        "Max_x0020_Price": [r["max"] for r in rows],
        "Modal_x0020_Price": [r["modal"] for r in rows],
        "Arrivals": [r["arrivals"] for r in rows],
        "Unit": "Rs./Quintal",
    })


def to_msamb(rows: list[dict]) -> pd.DataFrame:
    """MSAMB-shaped: different headers, dd-mm-yyyy dates, arrivals in quintals, Marathi names."""
    return pd.DataFrame({
        "Price Date": [r.get("date_text", "").replace("/", "-") or r["date"].strftime("%d-%m-%Y") for r in rows],
        "District Name": [r["district_label"] for r in rows],
        "APMC": [r["market"] for r in rows],
        "Crop": [r["label"] for r in rows],
        "variety_name": [r["variety"] for r in rows],
        "Arrival Qty": [round(r["arrivals"] * 10, 1) for r in rows],
        "minimum_price": [r["min"] for r in rows],
        "maximum_price": [r["max"] for r in rows],
        "modal_price_rs_quintal": [r["modal"] for r in rows],
        "price_unit": "Rs/Quintal",
    })


def generate(as_of: date, out_dir: Path = config.RAW_DIR, seed: int = config.SEED) -> Manifest:
    rng = np.random.default_rng(seed)
    holidays = load_holidays(config.REFERENCE_DIR / "market_holidays.csv")
    start = date(2021, 1, 1)
    days = trading_days(start, as_of, holidays)
    weather = weather_history({s.district for s in SERIES}, start, as_of, rng)
    manifest = Manifest(as_of=as_of.isoformat(), seed=seed)

    clean: list[dict] = []
    for s in SERIES:
        clean.extend(simulate_series(s, days, weather, rng))
    manifest.rows_clean = len(clean)
    dirty = inject_defects(clean, as_of, rng, manifest)

    out_dir.mkdir(parents=True, exist_ok=True)
    agmarknet = [r for r in dirty if r["source"] == "agmarknet"]
    msamb = [r for r in dirty if r["source"] == "msamb"]
    to_agmarknet(agmarknet).to_csv(out_dir / "agmarknet_synthetic.csv", index=False)
    to_msamb(msamb).to_csv(out_dir / "msamb_synthetic.csv", index=False)
    weather.to_csv(out_dir / "weather_history.csv", index=False)
    (out_dir / "_injected.json").write_text(json.dumps(manifest.__dict__, indent=2, default=str), encoding="utf-8")
    return manifest
