"""FR-01 · FR-04 — ingest and cleaning on the synthetic dataset (PROMPT §4). The generator records
exactly which defects it injected; these tests hold the cleaner to that ground truth."""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from ml import config
from ml.clean.clean import MAX_IMPUTED_RUN, clean, format_report, weighted_median
from ml.generate.synth import generate, load_holidays
from ml.ingest.columns import UnresolvedColumns, describe_mapping, normalise_header, resolve_columns
from ml.ingest.load import load_commodity_table, load_raw, parse_date
from ml.run_pipeline import main

AS_OF = date(2026, 9, 18)
HOLIDAYS = load_holidays(config.REFERENCE_DIR / "market_holidays.csv")


@pytest.fixture(scope="session")
def world(tmp_path_factory: pytest.TempPathFactory):
    raw = tmp_path_factory.mktemp("raw")
    manifest = generate(AS_OF, out_dir=raw)
    loaded = load_raw(raw)
    result = clean(loaded, AS_OF, HOLIDAYS)
    return raw, json.loads((raw / "_injected.json").read_text(encoding="utf-8")), loaded, result, manifest


# ── column resolution (PROMPT §4.1) ──────────────────────────────────────────────────────


def test_fr01_resolves_agmarknet_headers_including_escaped_spaces():
    headers = ["State", "District", "Market", "Commodity", "Variety", "Grade", "Arrival_Date", "Min_x0020_Price", "Max_x0020_Price", "Modal_x0020_Price", "Arrivals"]
    mapping = resolve_columns(headers, "agmarknet.csv")
    assert mapping["min_price"] == "Min_x0020_Price"
    assert mapping["date"] == "Arrival_Date"
    assert mapping["arrivals"] == "Arrivals"


def test_fr01_resolves_msamb_headers_and_ignores_case_and_punctuation():
    mapping = resolve_columns(["PRICE-DATE", "District Name", "apmc", "Crop", "minimum_price", "maximum_price", "Modal Price"], "msamb.csv")
    assert mapping == {"date": "PRICE-DATE", "district": "District Name", "market": "apmc", "commodity": "Crop", "min_price": "minimum_price", "max_price": "maximum_price", "modal_price": "Modal Price"}
    assert normalise_header("Modal_x0020_Price") == "modal price"


def test_fr01_stops_and_asks_when_a_required_column_cannot_be_resolved():
    with pytest.raises(UnresolvedColumns) as problem:
        resolve_columns(["Date", "District", "Market", "Commodity", "Min", "Max", "Rate"], "mystery.csv")
    assert problem.value.missing == ["min_price", "max_price", "modal_price"]
    assert "nothing is guessed" in str(problem.value)


def test_fr01_the_mapping_is_printed_with_required_and_optional_marked():
    text = describe_mapping("x.csv", {"date": "Arrival_Date"})
    assert "date         ←  Arrival_Date  [required]" in text
    assert "state        ←  (absent)  [optional]" in text


def test_fr01_pipeline_exits_with_a_question_on_an_unresolvable_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    (tmp_path / "odd.csv").write_text("When,Where,What,Rate\n04/09/2026,Nashik,Onion,1840\n", encoding="utf-8")
    monkeypatch.setattr(config, "RAW_DIR", tmp_path)
    monkeypatch.setattr("ml.ingest.load.config.RAW_DIR", tmp_path)
    monkeypatch.setattr("ml.run_pipeline.load_raw", lambda: load_raw(tmp_path))
    assert main(["--stage", "ingest", "--as-of", "2026-09-18"]) == 2
    assert "cannot resolve required column(s)" in capsys.readouterr().err


# ── parsing and canonicalisation ───────────────────────────────────────────────────────────


def test_fr01_parses_published_date_formats_and_refuses_impossible_dates():
    assert parse_date("04/09/2026") == date(2026, 9, 4)
    assert parse_date("04-09-2026") == date(2026, 9, 4)
    assert parse_date("2026-09-04") == date(2026, 9, 4)
    assert parse_date("31/02/2024") is None
    assert parse_date("Sept 4") is None


def test_fr01_commodity_names_resolve_only_through_the_auditable_table():
    table = load_commodity_table()
    assert table["onion(red)"] == "onion"
    assert table["तूर"] == "tur"
    assert table["arhar (tur/red gram)(whole)"] == "tur"
    assert "onyon" not in table  # never a fuzzy merge


def test_fr01_every_raw_commodity_in_the_dataset_is_canonicalised(world):
    _, _, loaded, _, _ = world
    assert loaded.unknown_commodities == {}
    assert set(loaded.frame["crop"].dropna()) == {"onion", "soybean", "tur", "gram", "banana", "orange", "tomato", "potato", "pomegranate", "grapes"}


def test_fr01_markets_resolve_to_registry_ids_and_their_districts(world):
    _, _, loaded, _, _ = world
    lasalgaon = loaded.frame[loaded.frame["raw_market"] == "Lasalgaon"]
    assert set(lasalgaon["market"]) == {"lasalgaon"}
    assert set(lasalgaon["district"]) == {"nashik"}


# ── the cleaner against the injected ground truth (PROMPT §4.2) ────────────────────────────


def test_fr01_impossible_rows_are_quarantined_with_a_reason(world):
    _, injected, _, result, _ = world
    reasons = set(result.rejected["reason"])
    assert reasons <= {"invalid or unparseable date", "commodity not in the synonym table", "district not in the registry", "price missing or not a number",
                       "non-positive price", "minimum above maximum", "modal outside the min–max range", "date in the future"}
    expected = injected["injected"]["impossible"] + injected["injected"]["invalid_date"]
    # A duplicated impossible row is rejected twice — at most a handful more than injected.
    assert expected <= len(result.rejected) <= expected + 10
    clean_rows = result.market_daily
    assert (clean_rows["min"] <= clean_rows["max"]).all()
    assert ((clean_rows["modal"] >= clean_rows["min"]) & (clean_rows["modal"] <= clean_rows["max"])).all()
    assert (clean_rows["modal"] > 0).all()
    assert all(d <= AS_OF for d in clean_rows["date"])


def test_fr04_per_kilogram_quotes_are_found_and_repaired(world):
    _, injected, _, result, _ = world
    truth = {tuple(k) for k in injected["unit_rows"]}
    repaired = result.market_daily[result.market_daily["unit_repaired"]]
    market_names = {"lasalgaon": "Lasalgaon", "pimpalgaon-baswant": "Pimpalgaon Baswant", "nashik-apmc": "Nashik", "rahuri": "Rahuri", "latur-apmc": "Latur",
                    "jalgaon-apmc": "Jalgaon", "raver": "Raver", "kalamna": "Kalamna", "narayangaon": "Narayangaon", "manchar": "Manchar"}
    found = {(market_names.get(m, m), c, d.isoformat()) for m, c, d in zip(repaired["market"], repaired["crop"], repaired["date"])}
    recall = len(truth & found) / len(truth)
    false_repairs = len(found - truth)
    assert recall >= 0.95, f"recall {recall:.3f}"
    assert false_repairs <= 3


def test_fr04_no_per_kilogram_magnitude_survives_cleaning(world):
    _, _, _, result, _ = world
    series = result.district_series[result.district_series["observed"]]
    medians = series.groupby(["crop", "district"])["modal"].median()
    for (crop, district), median in medians.items():
        part = series[(series["crop"] == crop) & (series["district"] == district)]
        assert (part["modal"] > median / 20).all(), f"{crop} × {district} still holds a per-kg magnitude"


def test_fr01_duplicate_sessions_collapse_to_one_row(world):
    _, injected, _, result, _ = world
    keys = result.market_daily.groupby(["market", "crop", "date"]).size()
    assert keys.max() == 1
    assert abs(result.report["duplicate_sessions_collapsed"] - injected["injected"]["duplicates"]) <= 10


def test_fr01_weighted_median_follows_volume():
    assert weighted_median(np.array([1800.0, 1900.0]), np.array([10.0, 1000.0])) == 1900.0
    assert weighted_median(np.array([1800.0, 1900.0, 2000.0]), np.array([1.0, 1.0, 1.0])) == 1900.0


def test_fr04_zero_arrival_days_are_told_apart_from_closed_markets(world):
    _, injected, _, result, _ = world
    assert result.report["zero_arrival_days"] == injected["injected"]["zero_arrivals"]
    zero = result.market_daily[result.market_daily["zero_arrivals"]]
    assert (zero["arrivals"] == 0).all()
    assert not zero["price_observed"].any()
    # Markets are closed on Sundays and listed holidays: no row falls on one, and they are counted.
    assert not any(d.weekday() == 6 or d in HOLIDAYS for d in result.market_daily["date"])
    assert result.report["market_closed_days"] > 0


def test_fr01_outliers_are_flagged_not_deleted(world):
    _, injected, loaded, result, _ = world
    truth = {tuple(k) for k in injected["outlier_rows"]}
    flagged = result.market_daily[result.market_daily["outlier"]]
    by_name = {m: raw for m, raw in zip(loaded.frame["market"], loaded.frame["raw_market"])}
    found = {(by_name[m], c, d.isoformat()) for m, c, d in zip(flagged["market"], flagged["crop"], flagged["date"])}
    assert len(truth & found) / len(truth) >= 0.9
    # Flagged rows remain in the record.
    assert len(flagged) == result.report["outliers_flagged"] > 0


def test_fr01_missing_days_are_imputed_only_in_short_runs_and_always_marked(world):
    _, _, _, result, _ = world
    series = result.district_series
    assert result.report["imputed_trading_days"] == int(series["imputed"].sum()) > 0
    assert not (series["imputed"] & series["observed"]).any()
    for _, part in series.groupby(["crop", "district"]):
        flags = part["imputed"].to_numpy()
        longest = max((len(run) for run in "".join("1" if f else "0" for f in flags).split("0")), default=0)
        assert longest <= MAX_IMPUTED_RUN
    assert result.report["gaps_left_unimputed"] > 0  # grapes' off-season is not invented


def test_fr01_thin_series_are_marked_insufficient(world):
    _, _, _, result, _ = world
    verdict = {(s["crop"], s["district"]): s["sufficient"] for s in result.report["series"]}
    assert verdict[("grapes", "nashik")] is False
    assert verdict[("onion", "nashik")] is True
    assert sum(verdict.values()) == len(verdict) - 1


def test_fr01_the_reference_market_is_the_one_with_most_arrivals(world):
    _, _, _, result, _ = world
    onion = result.district_series[(result.district_series["crop"] == "onion") & (result.district_series["district"] == "nashik")]
    assert set(onion["market"]) == {"lasalgaon"}


def test_fr01_the_report_is_printed_in_the_prompt_form(world):
    _, _, _, result, _ = world
    text = format_report(result.report)
    for label in ("raw rows", "resolved columns", "unit errors repaired", "duplicate sessions collapsed", "impossible rows rejected", "imputed trading days", "crop × district series"):
        assert label in text
    assert "synthetic, PROMPT §4.4" in text
    assert "grapes × nashik" in text


def test_fr01_generation_is_deterministic(tmp_path: Path):
    a, b = tmp_path / "a", tmp_path / "b"
    generate(AS_OF, out_dir=a)
    generate(AS_OF, out_dir=b)
    for name in ("agmarknet_synthetic.csv", "msamb_synthetic.csv", "weather_history.csv"):
        assert hashlib.sha256((a / name).read_bytes()).hexdigest() == hashlib.sha256((b / name).read_bytes()).hexdigest()


def test_fr04_arrivals_are_kept_as_a_signal(world):
    _, _, _, result, _ = world
    onion = result.district_series[(result.district_series["crop"] == "onion") & (result.district_series["district"] == "nashik")]
    assert onion["arrivals"].notna().mean() > 0.9
    assert pd.api.types.is_numeric_dtype(onion["arrivals"])
