"""Pipeline-wide configuration: paths, the seed, and the constants the specification fixes.

Every value here is either a path or a number PROMPT.md states explicitly. Policy constants
(MSP, tariffs, spoilage curves) do not live here — they belong to the single `constants`
module of @fasal/shared, each with the source it must be confirmed against (PROMPT §0.4).
"""
from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
REFERENCE_DIR = DATA_DIR / "reference"
GOLDEN_DIR = DATA_DIR / "golden"
BUNDLES_DIR = DATA_DIR / "bundles"

#: One seed for every random source in the pipeline (PROMPT §14.2): two consecutive runs
#: must produce the same numbers or the validation table means nothing. 26132 is the
#: problem-statement number, chosen so nobody is tempted to shop for a luckier one.
SEED = 26132

#: RK-6 quantile levels and forecast horizons (PROMPT §5.3).
QUANTILES = (0.1, 0.5, 0.9)
HORIZONS_DAYS = (7, 14)

#: Thin-series thresholds (PROMPT §4.3). Below either, the forecast is withheld.
MIN_SERIES = 400
MIN_SEASONS = 2
