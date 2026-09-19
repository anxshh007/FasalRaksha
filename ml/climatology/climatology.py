"""Climatology (PROMPT §4.5) and the seasonal price profile (RK-2).

Weather climatology: district × week-of-year norms of 7-day rainfall and humidity, computed from
the historical record and shipped in the bundle. Weather is consumed, never predicted.

Seasonal price profile: for each crop × district, the typical shape of the year — the
week-of-year median (and IQR) of log price *relative to that year's own mean*, so inflation and
level shifts between years do not masquerade as seasonality. Computed from earlier years only:
the profile used for a date in year Y never saw year Y's or any later prices (no look-ahead into the season
being judged).
"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd


def week_of_year(d: date) -> int:
    """1–52; ISO week 53 folds into 52 so every year has the same weeks."""
    return min(d.isocalendar()[1], 52)


def weather_climatology(weather: pd.DataFrame, before_year: int | None = None) -> pd.DataFrame:
    """Per district × week: mean and sd of the 7-day rain sum, mean humidity. With `before_year`,
    only earlier years are used (the leak-free norm for validating that year)."""
    w = weather.copy()
    w["date"] = pd.to_datetime(w["date"])
    if before_year is not None:
        w = w[w["date"].dt.year < before_year]
    w = w.sort_values(["district", "date"])
    w["rain7"] = w.groupby("district")["rain_mm"].transform(lambda s: s.rolling(7, min_periods=7).sum())
    w["week"] = w["date"].dt.date.map(week_of_year)
    table = w.dropna(subset=["rain7"]).groupby(["district", "week"]).agg(
        rain7_mean=("rain7", "mean"), rain7_sd=("rain7", "std"), humidity_mean=("humidity_pct", "mean")
    )
    table["rain7_sd"] = table["rain7_sd"].fillna(0.0).clip(lower=1.0)  # a dry week's sd floor: 1 mm
    return table.reset_index()


def seasonal_profile(dates: pd.Series, log_price: pd.Series, exclude_year: int | None) -> pd.DataFrame:
    """Week-of-year median and IQR of de-meaned log price, from the years *before* `exclude_year`.

    PROMPT §5.2 says leave-current-year-out. At prediction time that is exactly "every earlier
    year". In forward-chaining validation it must also exclude *later* years — a profile built
    with 2025's prices would leak the future into a 2023 test fold — so only prior years are used.
    """
    frame = pd.DataFrame({"date": dates.to_numpy(), "log_p": log_price.to_numpy()}).dropna()
    frame["year"] = frame["date"].map(lambda d: d.year)
    frame["week"] = frame["date"].map(week_of_year)
    if exclude_year is not None:
        frame = frame[frame["year"] < exclude_year]
    if frame.empty:
        return pd.DataFrame(columns=["week", "median", "q25", "q75"])
    frame["dev"] = frame["log_p"] - frame.groupby("year")["log_p"].transform("mean")
    profile = frame.groupby("week")["dev"].agg(median="median", q25=lambda s: s.quantile(0.25), q75=lambda s: s.quantile(0.75))
    # Weeks never seen (off-season crops) inherit nothing: they stay missing, not zero.
    return profile.reindex(range(1, 53)).interpolate(limit_area="inside").reset_index().rename(columns={"index": "week"})


class SeasonalProfiles:
    """Earlier-years-only profiles for one series, cached per judged year."""

    def __init__(self, dates: pd.Series, log_price: pd.Series):
        self.dates = dates
        self.log_price = log_price
        self._cache: dict[int | None, pd.DataFrame] = {}

    def profile(self, exclude_year: int | None) -> pd.DataFrame:
        if exclude_year not in self._cache:
            self._cache[exclude_year] = seasonal_profile(self.dates, self.log_price, exclude_year).set_index("week")
        return self._cache[exclude_year]

    def value(self, d: date, column: str = "median", exclude_year: int | None = -1) -> float:
        """The profile at date d, from the years before d's own year unless told otherwise."""
        year = d.year if exclude_year == -1 else exclude_year
        v = self.profile(year).at[week_of_year(d), column] if week_of_year(d) in self.profile(year).index else np.nan
        return float(v) if pd.notna(v) else float("nan")
