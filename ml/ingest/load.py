"""Load every market file in data/raw/ into one canonical frame — tolerant on input.

Values are parsed, not repaired: a malformed date or price is carried as missing with its raw text
kept, so the cleaner can reject it *with a reason*. Commodity names are canonicalised only through
the auditable synonym table (data/reference/commodity_synonyms.csv) — never a fuzzy merge; an
unknown name is quarantined and reported. District and market names resolve through the district
registry (data/reference/districts.json).
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from ml import config
from ml.ingest.columns import SYNONYMS, describe_mapping, resolve_columns

SKIP_FILES = {"_rejected.csv", "weather_history.csv"}


def fold(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", str(text)).strip().lower().split())


def load_commodity_table(path: Path = config.REFERENCE_DIR / "commodity_synonyms.csv") -> dict[str, str]:
    table = pd.read_csv(path, dtype=str, keep_default_na=False)
    return {fold(raw): crop for raw, crop in zip(table["raw_name"], table["crop_id"])}


def load_district_lookup(path: Path = config.REFERENCE_DIR / "districts.json") -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    """district name/synonym → id; market name/synonym → (district id, market id)."""
    registry = json.loads(path.read_text(encoding="utf-8"))
    districts: dict[str, str] = {}
    markets: dict[str, tuple[str, str]] = {}
    for d in registry["districts"]:
        for name in [*d["synonyms"], *d["names"].values()]:
            districts[fold(name)] = d["id"]
        for m in d["markets"]:
            for name in [*m["synonyms"], *m["names"].values()]:
                markets[fold(name)] = (d["id"], m["id"])
    return districts, markets


def parse_date(text: str) -> date | None:
    value = str(text).strip()
    for pattern, order in ((r"^(\d{2})/(\d{2})/(\d{4})$", "dmy"), (r"^(\d{2})-(\d{2})-(\d{4})$", "dmy"), (r"^(\d{4})-(\d{2})-(\d{2})$", "ymd")):
        match = re.match(pattern, value)
        if match:
            a, b, c = (int(g) for g in match.groups())
            try:
                return date(c, b, a) if order == "dmy" else date(a, b, c)
            except ValueError:
                return None
    return None


def to_number(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series.astype(str).str.replace(",", "", regex=False).str.strip(), errors="coerce")


@dataclass
class LoadResult:
    frame: pd.DataFrame
    raw_rows: int
    mappings: dict[str, dict[str, str]] = field(default_factory=dict)
    resolved_columns: tuple[int, int] = (0, 0)
    unknown_commodities: dict[str, int] = field(default_factory=dict)


def load_raw(raw_dir: Path = config.RAW_DIR) -> LoadResult:
    commodities = load_commodity_table()
    districts, markets = load_district_lookup()
    frames = []
    mappings: dict[str, dict[str, str]] = {}
    raw_rows = 0
    resolved = total = 0
    unknown: dict[str, int] = {}
    for path in sorted(raw_dir.glob("*.csv")):
        if path.name in SKIP_FILES or path.name.startswith("_"):
            continue
        table = pd.read_csv(path, dtype=str, keep_default_na=False)
        raw_rows += len(table)
        mapping = resolve_columns(list(table.columns), path.name)
        mappings[path.name] = mapping
        resolved += len(mapping)
        total += len(SYNONYMS)
        col = lambda name: table[mapping[name]] if name in mapping else pd.Series([""] * len(table))  # noqa: E731
        frame = pd.DataFrame({
            "source_file": path.name,
            "raw_date": col("date"),
            "raw_commodity": col("commodity"),
            "raw_district": col("district"),
            "raw_market": col("market"),
            "variety": col("variety"),
            "min": to_number(col("min_price")),
            "max": to_number(col("max_price")),
            "modal": to_number(col("modal_price")),
            "arrivals": to_number(col("arrivals")) if "arrivals" in mapping else np.nan,
            "unit": col("unit"),
        })
        frame["date"] = frame["raw_date"].map(parse_date)
        frame["crop"] = frame["raw_commodity"].map(lambda c: commodities.get(fold(c)))
        for name in frame.loc[frame["crop"].isna(), "raw_commodity"]:
            unknown[name] = unknown.get(name, 0) + 1
        market_hits = frame["raw_market"].map(lambda m: markets.get(fold(m)))
        frame["market"] = [hit[1] if hit is not None else re.sub(r"[^0-9a-z]+", "-", fold(m)).strip("-") for hit, m in zip(market_hits, frame["raw_market"])]
        frame["district"] = [
            hit[0] if hit is not None else districts.get(fold(d)) for hit, d in zip(market_hits, frame["raw_district"])
        ]
        frames.append(frame)
    if not frames:
        raise FileNotFoundError(f"No market files in {raw_dir}. Generate the synthetic dataset first (pnpm ml:generate).")
    return LoadResult(pd.concat(frames, ignore_index=True), raw_rows, mappings, (resolved, total), unknown)


def print_mappings(result: LoadResult) -> str:
    return "\n\n".join(describe_mapping(source, mapping) for source, mapping in result.mappings.items())
