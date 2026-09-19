"""Forecast-layer precondition: the pinned numerical stack provides what the estimator needs.

The forecast layer is LightGBM under the pinball loss (PROMPT §5.3), and the validation table
is only meaningful if the pipeline is reproducible (PROMPT §14.2). Both are properties of the
installed toolchain before they are properties of any code, so they are checked first.
"""
from __future__ import annotations

import numpy as np
import pytest

from ml import config


def _fit_quantile(alpha: float, seed: int) -> np.ndarray:
    import lightgbm as lgb

    import pandas as pd

    rng = np.random.default_rng(seed)
    x = pd.DataFrame(rng.normal(size=(600, 4)), columns=["f0", "f1", "f2", "f3"])
    y = x["f0"] * 0.5 + rng.normal(scale=0.3, size=600)
    model = lgb.LGBMRegressor(
        objective="quantile",
        alpha=alpha,
        n_estimators=40,
        learning_rate=0.1,
        num_leaves=15,
        random_state=seed,
        deterministic=True,
        force_row_wise=True,
        verbose=-1,
    )
    model.fit(x, y)
    return np.asarray(model.predict(x.iloc[:50]))


def test_lightgbm_supports_the_quantile_objective() -> None:
    lower = _fit_quantile(0.1, config.SEED)
    upper = _fit_quantile(0.9, config.SEED)
    # On the training distribution, the 0.9 quantile sits above the 0.1 quantile on average.
    assert float(np.mean(upper - lower)) > 0.0


def test_quantile_fit_is_deterministic_under_the_pinned_seed() -> None:
    first = _fit_quantile(0.5, config.SEED)
    second = _fit_quantile(0.5, config.SEED)
    assert np.array_equal(first, second)


def test_spec_constants_match_the_prompt() -> None:
    assert config.QUANTILES == (0.1, 0.5, 0.9)
    assert config.HORIZONS_DAYS == (7, 14)
    assert (config.MIN_SERIES, config.MIN_SEASONS) == (400, 2)


@pytest.mark.parametrize("module", ["pandas", "sklearn", "onnx", "onnxruntime"])
def test_pipeline_dependencies_import(module: str) -> None:
    __import__(module)
