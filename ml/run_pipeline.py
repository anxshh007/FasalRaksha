"""The nightly pipeline — the only place in Fasal Raksha that ever runs a model (PROMPT §3.1).

    python -m ml.run_pipeline --stage generate   # synthetic dataset (only because none was supplied)
    python -m ml.run_pipeline --stage ingest     # resolve columns, clean, print the INGEST REPORT
    python -m ml.run_pipeline --stage raksha     # RK-1…RK-6, RK-8, forward chaining, conformal, validation table
    python -m ml.run_pipeline --stage bundles    # seal the bundle cores and climatology (needs a raksha run)
    python -m ml.run_pipeline                    # everything

`--as-of` fixes the pipeline's "today" (default: today in India). Two runs with the same as-of
produce identical outputs (PROMPT §14.2).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone

from ml import config
from ml.clean.clean import clean, format_report, write_outputs
from ml.evaluate.validate import CLEAN_DIR, format_validation, load_inputs, run_raksha
from ml.export.bundles import export_bundles, format_export
from ml.generate.synth import generate, load_holidays
from ml.ingest.columns import UnresolvedColumns
from ml.ingest.load import load_raw, print_mappings


def today_in_india() -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--stage", choices=["generate", "ingest", "raksha", "bundles", "all"], default="all")
    parser.add_argument("--as-of", type=date.fromisoformat, default=None)
    args = parser.parse_args(argv)
    as_of: date = args.as_of or today_in_india()
    sys.stdout.reconfigure(encoding="utf-8")  # Devanagari commodity names in the mapping

    if args.stage in ("generate", "all"):
        manifest = generate(as_of)
        print(f"Generated the synthetic dataset as of {as_of} (seed {manifest.seed}): {manifest.rows_clean:,} clean rows, injected {manifest.injected}")

    if args.stage in ("ingest", "all"):
        try:
            loaded = load_raw()
        except UnresolvedColumns as problem:
            print(str(problem), file=sys.stderr)
            return 2
        print(print_mappings(loaded))
        print()
        result = clean(loaded, as_of, load_holidays(config.REFERENCE_DIR / "market_holidays.csv"))
        write_outputs(result)
        print(format_report(result.report))

    results = None
    if args.stage in ("raksha", "all"):
        results = run_raksha()
        print()
        print(format_validation(results))

    if args.stage in ("bundles", "all"):
        if results is None:
            results = json.loads((CLEAN_DIR / "validation_report.json").read_text(encoding="utf-8"))
        series, weather, _, crops = load_inputs()
        print()
        print(format_export(export_bundles(results, series, weather, crops, as_of)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
