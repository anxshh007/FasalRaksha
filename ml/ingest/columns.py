"""Column resolution (PROMPT §4.1): never hardcode headers.

Incoming headers are normalised (case, `_x0020_` escapes, punctuation) and matched against a
synonym table. The resolved mapping is printed for confirmation. A *required* column that cannot
be resolved stops the pipeline with a message naming it — the pipeline never guesses and never
synthesises a missing column.
"""
from __future__ import annotations

import re

SYNONYMS: dict[str, tuple[str, ...]] = {
    "date": ("Price Date", "Arrival_Date", "Reported Date", "arrival_date", "Date"),
    "state": ("State", "state_name"),
    "district": ("District", "District Name", "dist"),
    "market": ("Market", "Market Name", "APMC", "mandi"),
    "commodity": ("Commodity", "Crop", "commodity_name"),
    "variety": ("Variety", "variety_name"),
    "grade": ("Grade", "FAQ grade"),
    "min_price": ("Min Price", "Min_x0020_Price", "minimum_price", "min_price"),
    "max_price": ("Max Price", "Max_x0020_Price", "maximum_price", "max_price"),
    "modal_price": ("Modal Price", "Modal_x0020_Price", "modal_price_rs_quintal", "modal_price"),
    "arrivals": ("Arrivals", "Arrival Qty", "arrival_tonnes"),
    "unit": ("Unit", "price_unit"),
}

REQUIRED = ("date", "district", "market", "commodity", "min_price", "max_price", "modal_price")


def normalise_header(header: str) -> str:
    text = header.replace("_x0020_", " ")
    text = re.sub(r"[^0-9a-zA-Z]+", " ", text)
    return " ".join(text.lower().split())


_LOOKUP = {normalise_header(s): canonical for canonical, synonyms in SYNONYMS.items() for s in (*synonyms, canonical)}


class UnresolvedColumns(Exception):
    """A required column could not be resolved. The pipeline stops and asks (PROMPT §4.1)."""

    def __init__(self, source: str, missing: list[str], headers: list[str]):
        self.source = source
        self.missing = missing
        self.headers = headers
        super().__init__(
            f"{source}: cannot resolve required column(s) {', '.join(missing)} from headers {headers}. "
            "Tell me which header carries each, or add it to the synonym table — nothing is guessed."
        )


def resolve_columns(headers: list[str], source: str) -> dict[str, str]:
    """Canonical name → the file's own header. Raises UnresolvedColumns for a missing required one."""
    mapping: dict[str, str] = {}
    for header in headers:
        canonical = _LOOKUP.get(normalise_header(header))
        if canonical is not None and canonical not in mapping:
            mapping[canonical] = header
    missing = [c for c in REQUIRED if c not in mapping]
    if missing:
        raise UnresolvedColumns(source, missing, headers)
    return mapping


def describe_mapping(source: str, mapping: dict[str, str]) -> str:
    width = max(len(c) for c in SYNONYMS)
    lines = [f"COLUMN MAPPING — {source}"]
    for canonical in SYNONYMS:
        header = mapping.get(canonical)
        mark = "required" if canonical in REQUIRED else "optional"
        lines.append(f"  {canonical:<{width}}  ←  {header if header is not None else '(absent)'}  [{mark}]")
    return "\n".join(lines)
