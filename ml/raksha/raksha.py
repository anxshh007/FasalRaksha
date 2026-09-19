"""RAKSHA-QAD, server side: RK-1…RK-6 and RK-8 (PROMPT §5).

Honesty about novelty (PROMPT §5.1): gradient boosting under the pinball loss is not an
invention of this project — LightGBM's `objective='quantile'` is used exactly as published. What
this module adds is the decision architecture around it:

  1. every signal layer's weight is its own *measured* out-of-fold skill against the naive
     baseline — never a hand-set constant — recomputed on every run and shipped in the bundle;
  2. the evidence vote (RK-8) is skill-weighted across three buckets, so unanimous calm reads as
     confident calm rather than as "unclear" (a signed sum would have cancelled to zero);
  3. the quantile band is conformalised on the final forward-chaining folds — widened, never
     narrowed — until its empirical coverage reaches the nominal 80 %;
  4. every number in the validation table that depends on something *learned from* out-of-fold
     rows (the widening, the layer weights, the confidence threshold) is scored held out: fold k
     is judged only with what the folds before k taught. Calibration coverage is printed as well,
     but it is >= nominal by construction and labelled as such.

Validation is forward-chaining only (expanding window, purged so no training target overlaps a
test day). A random split on a time series would leak the future into the past; `test_raksha.py`
asserts that no fold ever does.

Model split, with the evidence behind it (PROMPT §5.3): one model per crop × district × horizon ×
τ. On the synthetic run every published series has more than 2 × MIN_SERIES usable targets and the
two crops traded in two districts (onion, tomato) have different arrival calendars and price
levels, so pooling would buy heterogeneity, not data. The only thin series (grapes × Nashik,
~290 observations over two seasons) is below MIN_SERIES and is withheld outright — pooling could
not rescue a crop with one district. The per-series lengths are printed in the validation table.
"""
from __future__ import annotations

import math
import warnings
from dataclasses import dataclass, field

import lightgbm as lgb
import numpy as np
import pandas as pd

from ml import config
from ml.features.features import FEATURE_COLUMNS, LAYER_SIGNALS

warnings.filterwarnings("ignore", category=UserWarning, module="lightgbm")

MIN_TRAIN = 500  # usable targets before the first test block (~2 years of trading days)
BLOCK = 120  # test block, in usable targets (~5 months)
CALIBRATION_FOLDS = 2  # the final folds used for split-conformal calibration
NOMINAL_COVERAGE = 0.8  # q10…q90
FLAT_SHARE = 1 / 3  # thresholds put a third of outcomes in the FLAT bucket

#: Representative carry used only to *score* the pipeline's wait signal in validation; the device
#: always uses the farmer's own warehouse, spoilage and credit (RK-7).
VALIDATION_CARRY_PER_7_DAYS = {"perishable": 0.02, "grain": 0.006}

LGB_PARAMS = dict(
    n_estimators=250, learning_rate=0.03, num_leaves=15, min_child_samples=30, subsample=0.8, subsample_freq=1,
    colsample_bytree=0.8, random_state=config.SEED, deterministic=True, force_row_wise=True, verbose=-1,
)


def forward_chaining_folds(frame: pd.DataFrame) -> list[tuple[pd.DataFrame, pd.DataFrame]]:
    """Expanding-window folds over rows with a usable target, in date order, purged: a training
    row is used only if its *target* date falls before the test block begins."""
    rows = frame[frame["target"].notna()].sort_values("date")
    folds = []
    for start in range(MIN_TRAIN, len(rows), BLOCK):
        test = rows.iloc[start : start + BLOCK]
        if len(test) < BLOCK // 3:
            break
        first_test_day = test["date"].min()
        train = rows.iloc[:start]
        train = train[train["target_date"].map(lambda d: d is not None and d < first_test_day)]
        folds.append((train, test))
    return folds


def fit_quantiles(train: pd.DataFrame) -> dict[float, lgb.LGBMRegressor]:
    models = {}
    for tau in config.QUANTILES:
        model = lgb.LGBMRegressor(objective="quantile", alpha=tau, **LGB_PARAMS)
        model.fit(train[FEATURE_COLUMNS], train["target"])
        models[tau] = model
    return models


def predict_band(models: dict[float, lgb.LGBMRegressor], rows: pd.DataFrame) -> np.ndarray:
    """(n, 3) array of q10, q50, q90 log returns — sorted per row, so q10 ≤ q50 ≤ q90 always."""
    raw = np.column_stack([models[tau].predict(rows[FEATURE_COLUMNS]) for tau in config.QUANTILES])
    return np.sort(raw, axis=1)


def skill(y: np.ndarray, prediction: np.ndarray, baseline: np.ndarray) -> float:
    """1 − SSE(prediction) / SSE(baseline): > 0 means the prediction beat the baseline."""
    denominator = float(np.sum((y - baseline) ** 2))
    return float(1.0 - np.sum((y - prediction) ** 2) / denominator) if denominator > 0 else float("nan")


@dataclass
class LayerFit:
    coefficient: float  # standalone least-squares response through the origin
    threshold: float  # |oriented signal| below this reads FLAT

    def predict(self, x: np.ndarray) -> np.ndarray:
        return np.where(np.isnan(x), 0.0, self.coefficient * x)

    def bucket(self, x: float) -> str | None:
        if math.isnan(x) or self.coefficient == 0:
            return None
        oriented = math.copysign(1.0, self.coefficient) * x
        return "up" if oriented > self.threshold else "down" if oriented < -self.threshold else "flat"


def fit_layer(train: pd.DataFrame, column: str) -> LayerFit:
    part = train[[column, "target"]].dropna()
    x, y = part[column].to_numpy(), part["target"].to_numpy()
    denom = float(np.sum(x * x))
    coefficient = float(np.sum(x * y) / denom) if denom > 0 else 0.0
    threshold = float(np.quantile(np.abs(x), FLAT_SHARE)) if len(x) else 0.0
    return LayerFit(coefficient, threshold)


def return_bucket(value: float, epsilon: float) -> str:
    return "up" if value > epsilon else "down" if value < -epsilon else "flat"


def evidence_vote(buckets: dict[str, str | None], weights: dict[str, float]) -> tuple[str, float]:
    """RK-8: score(b) = Σ weights of layers reading b; direction = argmax; agreement = share.
    Unanimous calm is confident calm. A tie for first place is evidence that contradicts itself,
    so it reads FLAT (at the leading share); with no weight anywhere there is no evidence: FLAT at 1/3."""
    scores = {"up": 0.0, "flat": 0.0, "down": 0.0}
    for layer, bucket in buckets.items():
        if bucket is not None:
            scores[bucket] += max(0.0, weights.get(layer, 0.0))
    total = sum(scores.values())
    if total <= 0:
        return "flat", 1 / 3
    top = max(scores.values())
    leaders = [b for b in ("flat", "up", "down") if scores[b] == top]
    return ("flat" if len(leaders) > 1 else leaders[0]), top / total


def conformal_widening(y: np.ndarray, band: np.ndarray, alpha: float = 1 - NOMINAL_COVERAGE) -> float:
    """Split-conformal (CQR) widening for the q10/q90 band. Never negative: never narrows."""
    scores = np.maximum(band[:, 0] - y, y - band[:, 2])
    n = len(scores)
    if n == 0:
        return 0.0
    k = math.ceil((n + 1) * (1 - alpha))
    q = float(np.sort(scores)[min(k, n) - 1])
    return max(q, 0.0)


def coverage(y: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> float:
    return float(np.mean((y >= lower) & (y <= upper))) if len(y) else float("nan")


def vote_frame(frame: pd.DataFrame, weights: dict[str, float]) -> tuple[np.ndarray, np.ndarray]:
    """`evidence_vote` over every row at once (the same rule: a tie for first reads FLAT)."""
    order = ("flat", "up", "down")
    scores = np.zeros((len(frame), 3))
    for layer in [*LAYER_SIGNALS, "RK-6"]:
        w = max(0.0, weights.get(layer, 0.0))
        buckets = frame[f"bucket_{layer}"].to_numpy(dtype=object)
        for i, b in enumerate(order):
            scores[:, i] += w * (buckets == b)
    total = scores.sum(axis=1)
    top = scores.max(axis=1)
    tied = (scores == top[:, None]).sum(axis=1) > 1
    best = np.array(order, dtype=object)[np.argmax(scores, axis=1)]
    direction = np.where((total > 0) & ~tied, best, "flat")
    agreement = np.where(total > 0, top / np.where(total > 0, total, 1.0), 1 / 3)
    return direction, agreement


def price_confidence(q10: np.ndarray, q50: np.ndarray, q90: np.ndarray, widening: float) -> np.ndarray:
    """GR-3's measure exactly as the device computes it, (q50 - p0) / (q90 - q10) in price terms,
    here with log-return quantiles and p0 = 1, after the conformal widening."""
    width = np.maximum(np.exp(q90 + widening) - np.exp(q10 - widening), 1e-9)
    return (np.exp(q50) - 1.0) / width


#: The wait precision a crop's confidence threshold must reach in validation before "wait" can be
#: suggested at all. A wrong wait costs principal, storage and spoilage, so a coin flip is not enough.
WAIT_PRECISION_TARGET = 0.6
MIN_WAIT_SAMPLES = 15


@dataclass
class Calibration:
    """Everything learned *from* out-of-fold rows: the layer weights, the conformal widening and
    the crop's confidence threshold."""

    layer_skill: dict[str, float]
    widening: float
    confidence_min: float

    @property
    def weights(self) -> dict[str, float]:
        return {layer: max(0.0, s) for layer, s in self.layer_skill.items()}


def wait_candidates(direction: np.ndarray, agreement: np.ndarray, q50: np.ndarray, carry: float) -> np.ndarray:
    return (direction == "up") & (agreement >= config.AGREEMENT_MIN) & (q50 > carry)


def calibrate(oof: pd.DataFrame, carry: float) -> Calibration:
    """Learn the weights, the widening (from the final CALIBRATION_FOLDS folds) and confidence_min
    (the lowest threshold whose suggested waits reach WAIT_PRECISION_TARGET, else 1.0: never)."""
    y = oof["y"].to_numpy()
    zero = np.zeros_like(y)
    layer_skill = {layer: skill(y, oof[f"pred_{layer}"].to_numpy(), zero) for layer in LAYER_SIGNALS}
    layer_skill["RK-6"] = skill(y, oof["q50"].to_numpy(), zero)
    last = sorted(oof["fold"].unique())[-CALIBRATION_FOLDS:]
    tail = oof[oof["fold"].isin(last)]
    widening = conformal_widening(tail["y"].to_numpy(), tail[["q10", "q50", "q90"]].to_numpy())
    weights = {layer: max(0.0, v) for layer, v in layer_skill.items()}
    direction, agreement = vote_frame(oof, weights)
    q10, q50, q90 = (oof[c].to_numpy() for c in ("q10", "q50", "q90"))
    confidence = price_confidence(q10, q50, q90, widening)
    candidates = wait_candidates(direction, agreement, q50, carry)
    confidence_min = 1.0
    for threshold in np.arange(0.1, 1.001, 0.05):
        chosen = candidates & (confidence >= threshold)
        if chosen.sum() >= MIN_WAIT_SAMPLES and float(np.mean(y[chosen] > carry)) >= WAIT_PRECISION_TARGET:
            confidence_min = round(float(threshold), 2)
            break
    return Calibration(layer_skill, widening, confidence_min)


@dataclass
class HorizonResult:
    horizon: int
    status: str  # 'published' | 'insufficient'
    reason: str | None
    folds: int
    oof_rows: int
    skill_naive: float
    skill_seasonal: float
    directional_accuracy: float
    wait_precision: float | None  # held out: each fold judged with thresholds learned before it
    wait_count: int
    coverage_raw: float
    coverage_conformal: float  # held out the same way: the coverage a farmer's band actually earns
    coverage_calibration: float  # on the calibration folds themselves: >= nominal by construction
    widening: float
    layer_skill: dict[str, float]
    confidence_min: float
    epsilon: float
    band_width: float
    band_kappa: float
    latest: dict = field(default_factory=dict)


KAPPA_BOUNDS = (0.005, 0.2)  # per day of data age: at least visible widening, at most +20 %/day
STALENESS_AGES = range(1, 8)


def staleness_kappa(dates: pd.Series, log_p: pd.Series, band_width: float) -> float:
    """κ for the device's band_multiplier(age) = 1 + κ · age (PROMPT §5.3), measured, not chosen.

    A band read `a` days late must also cover the `a`-day move nobody has seen yet, so its width
    becomes √(W² + R_a²) — W the calibrated width, R_a the empirical 10–90 % range of `a`-calendar-day
    log returns in this series. κ is the least-squares slope of that growth over a = 1…7."""
    daily = pd.Series(log_p.to_numpy(), index=pd.to_datetime(dates)).asfreq("D").ffill()
    ages, growth = [], []
    for a in STALENESS_AGES:
        moves = (daily - daily.shift(a)).dropna()
        if len(moves) < 30:
            continue
        spread = float(np.quantile(moves, 0.9) - np.quantile(moves, 0.1))
        ages.append(a)
        growth.append(math.sqrt(band_width**2 + spread**2) / band_width - 1.0)
    if not ages or band_width <= 0:
        return KAPPA_BOUNDS[1]  # nothing measured: widen as fast as allowed, never as slowly
    x, y = np.array(ages, dtype=float), np.array(growth)
    return float(np.clip(np.sum(x * y) / np.sum(x * x), *KAPPA_BOUNDS))


def out_of_fold(frame: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    """Every forward-chaining fold's test rows, predicted by models that never saw them."""
    folds = forward_chaining_folds(frame)
    oof = []
    for fold_id, (train, test) in enumerate(folds):
        models = fit_quantiles(train)
        band = predict_band(models, test)
        layers = {layer: fit_layer(train, column) for layer, column in LAYER_SIGNALS.items()}
        epsilon = float(np.quantile(np.abs(train["target"]), FLAT_SHARE))
        part = pd.DataFrame({
            "fold": fold_id, "date": test["date"].to_numpy(), "y": test["target"].to_numpy(),
            "q10": band[:, 0], "q50": band[:, 1], "q90": band[:, 2],
            "seasonal": test["seasonal_drift"].fillna(0.0).to_numpy(), "epsilon": epsilon,
        })
        for layer, column in LAYER_SIGNALS.items():
            x = test[column].to_numpy(dtype=float)
            part[f"pred_{layer}"] = layers[layer].predict(x)
            part[f"bucket_{layer}"] = [layers[layer].bucket(v) for v in x]
        part["bucket_RK-6"] = [return_bucket(v, epsilon) for v in band[:, 1]]
        oof.append(part)
    if not oof:
        raise ValueError("not enough usable targets for a single forward-chaining fold")
    return pd.concat(oof, ignore_index=True), len(folds)


def evaluate_horizon(frame: pd.DataFrame, horizon: int, crop_class: str) -> HorizonResult:
    oof, n_folds = out_of_fold(frame)
    y = oof["y"].to_numpy()
    carry = VALIDATION_CARRY_PER_7_DAYS[crop_class] * horizon / 7
    shipped = calibrate(oof, carry)  # what the bundle carries: learned from every fold

    skill_seasonal = skill(y, oof["q50"].to_numpy(), oof["seasonal"].to_numpy())
    moving = np.abs(y) > oof["epsilon"].to_numpy()
    directional = float(np.mean(np.sign(oof["q50"].to_numpy()[moving]) == np.sign(y[moving]))) if moving.any() else float("nan")

    # Held-out judgement: fold k is scored with a widening, weights and threshold learned only from
    # folds before k, so neither the coverage nor the wait precision grades its own homework.
    covered: list[bool] = []
    suggested_hits: list[bool] = []
    for k in range(CALIBRATION_FOLDS, n_folds):
        prior, test = oof[oof["fold"] < k], oof[oof["fold"] == k]
        learned = calibrate(prior, carry)
        q10, q50, q90, yk = (test[c].to_numpy() for c in ("q10", "q50", "q90", "y"))
        covered.extend(((yk >= q10 - learned.widening) & (yk <= q90 + learned.widening)).tolist())
        direction, agreement = vote_frame(test, learned.weights)
        confidence = price_confidence(q10, q50, q90, learned.widening)
        chosen = wait_candidates(direction, agreement, q50, carry) & (confidence >= max(config.CONFIDENCE_FLOOR, learned.confidence_min))
        suggested_hits.extend((yk[chosen] > carry).tolist())

    lower, upper = oof["q10"].to_numpy() - shipped.widening, oof["q90"].to_numpy() + shipped.widening
    cal_mask = oof["fold"].to_numpy() >= n_folds - CALIBRATION_FOLDS
    beats_naive = shipped.layer_skill["RK-6"] > 0
    return HorizonResult(
        horizon=horizon,
        status="published" if beats_naive else "insufficient",
        reason=None if beats_naive else "the model does not beat the naive (no-change) baseline",
        folds=n_folds,
        oof_rows=len(oof),
        skill_naive=shipped.layer_skill["RK-6"],
        skill_seasonal=skill_seasonal,
        directional_accuracy=directional,
        wait_precision=float(np.mean(suggested_hits)) if suggested_hits else None,
        wait_count=len(suggested_hits),
        coverage_raw=coverage(y, oof["q10"].to_numpy(), oof["q90"].to_numpy()),
        coverage_conformal=float(np.mean(covered)) if covered else float("nan"),
        coverage_calibration=coverage(y[cal_mask], lower[cal_mask], upper[cal_mask]),
        widening=shipped.widening,
        layer_skill=shipped.layer_skill,
        confidence_min=shipped.confidence_min,
        epsilon=float(np.quantile(np.abs(frame["target"].dropna()), FLAT_SHARE)),
        band_width=float(np.mean(upper - lower)),
        band_kappa=staleness_kappa(frame["date"], frame["log_p"], float(np.mean(upper - lower))),
    )


def latest_forecast(frame: pd.DataFrame, result: HorizonResult) -> dict:
    """Fit on everything, predict at the latest *usable* trading day — a real, clean observation,
    never an imputed day — because its modal is the benchmark p0 the device measures against."""
    train = frame[frame["target"].notna()]
    models = fit_quantiles(train)
    latest = frame[frame["usable"] & frame["log_p"].notna()].iloc[[-1]]
    band = predict_band(models, latest)[0]
    q10, q50, q90 = band[0] - result.widening, band[1], band[2] + result.widening
    layers = {layer: fit_layer(train, column) for layer, column in LAYER_SIGNALS.items()}
    weights = {layer: max(0.0, s) for layer, s in result.layer_skill.items()}
    readings = {}
    for layer, column in LAYER_SIGNALS.items():
        value = float(latest[column].iloc[0])
        readings[layer] = {"bucket": layers[layer].bucket(value), "weight": round(weights[layer], 6), "value": None if math.isnan(value) else round(value, 6)}
    readings["RK-6"] = {"bucket": return_bucket(q50, result.epsilon), "weight": round(weights["RK-6"], 6), "value": round(float(q50), 6)}
    direction, agreement = evidence_vote({k: v["bucket"] for k, v in readings.items()}, weights)
    p0 = float(math.exp(latest["log_p"].iloc[0]))
    return {
        "date": latest["date"].iloc[0].isoformat(),
        "p0": round(p0, 2),
        "q10": round(p0 * math.exp(q10), 2),
        "q50": round(p0 * math.exp(q50), 2),
        "q90": round(p0 * math.exp(q90), 2),
        "direction": direction,
        "agreement": round(agreement, 6),
        "layers": readings,
    }
