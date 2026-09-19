"""Procedurally rendered produce lots: the only images the grading models have ever seen.

There are no field-labelled grading photographs for this build (ARCHITECTURE G-3). Rather than
borrow a laboratory leaf-disease corpus and inherit its near-perfect, meaningless accuracy
(PROMPT §7.6), the grader is trained on lots rendered here, from written descriptions of what a
grader looks at. Every artefact trained on them says `fieldValidated: false`.

A lot is a packed layer of objects (bulbs, fruit, kernels, bolls) on a background (gunny cloth,
tarpaulin, concrete, soil). Each object may carry one defect. The grade label is a function of the
rendered defect fraction, not of the sampling parameter, so a lot sampled "near the boundary" gets
the label its pixels actually support:

    A  fewer than 6% of visible objects defective
    B  6% to 20%
    C  20% or more

Rendering is vectorised: every pixel belongs to its nearest object centre on a jittered grid in a
stretched coordinate frame (so elongated produce lies roughly aligned), which is how a poured lot
packs. The same renderer draws the E2E camera scenes (`data/fixtures/camera`).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

GRADES = ("A", "B", "C")
GRADE_EDGES = (0.06, 0.20)


def grade_for(fraction: float) -> int:
    if fraction < GRADE_EDGES[0]:
        return 0
    if fraction < GRADE_EDGES[1]:
        return 1
    return 2


def hsv_to_rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    """h in degrees, s and v in [0, 1]; returns [..., 3] RGB in [0, 1]."""
    h = np.mod(h, 360.0) / 60.0
    c = v * s
    x = c * (1 - np.abs(np.mod(h, 2) - 1))
    m = v - c
    z = np.zeros_like(h)
    sector = np.floor(h).astype(int)
    r = np.choose(np.clip(sector, 0, 5), [c, x, z, z, x, c])
    g = np.choose(np.clip(sector, 0, 5), [x, c, c, x, z, z])
    b = np.choose(np.clip(sector, 0, 5), [z, z, x, c, c, x])
    return np.stack([r + m, g + m, b + m], axis=-1)


Range = tuple[float, float]


@dataclass(frozen=True)
class Colour:
    hue: Range
    sat: Range
    val: Range

    def sample(self, rng: np.random.Generator, n: int) -> np.ndarray:
        h = rng.uniform(*self.hue, n)
        s = rng.uniform(*self.sat, n)
        v = rng.uniform(*self.val, n)
        return hsv_to_rgb(h, s, v)


@dataclass(frozen=True)
class Defect:
    kind: str  # blotch · spots · line · tint · offcolour · foreign · hole · split
    weight: float
    colour: Colour
    #: For foreign matter: how much narrower than a kernel the object is (1 = same shape).
    narrow: float = 1.0


@dataclass(frozen=True)
class Variant:
    crop: str
    colour: Colour
    radius: Range  # long semi-axis as a fraction of the image side
    aspect: Range  # short / long
    gloss: float
    texture: float
    defects: tuple[Defect, ...]
    mould: bool = False
    fluffy: bool = False


DARK_ROT = Colour((10, 30), (0.45, 0.75), (0.08, 0.22))
BLACK_SPOT = Colour((0, 40), (0.2, 0.6), (0.04, 0.14))
SPROUT = Colour((85, 115), (0.55, 0.8), (0.45, 0.7))
SCUFF = Colour((30, 45), (0.15, 0.3), (0.75, 0.9))
GREENING = Colour((70, 95), (0.45, 0.7), (0.4, 0.65))
STONE = Colour((20, 60), (0.02, 0.1), (0.38, 0.6))
CHAFF = Colour((42, 52), (0.2, 0.4), (0.78, 0.92))
DISCOLOURED = Colour((15, 30), (0.5, 0.75), (0.2, 0.35))
PURPLE_STAIN = Colour((275, 305), (0.35, 0.6), (0.3, 0.5))
YELLOWING = Colour((42, 52), (0.3, 0.5), (0.7, 0.85))
TRASH = Colour((15, 35), (0.4, 0.7), (0.12, 0.3))

GRAIN_DEFECTS = (
    Defect("foreign", 0.3, STONE),
    Defect("foreign", 0.25, CHAFF, narrow=0.3),
    Defect("hole", 0.2, BLACK_SPOT),
    Defect("offcolour", 0.25, DISCOLOURED),
)

VARIANTS: dict[str, tuple[Variant, ...]] = {
    "tuber_bulb": (
        Variant("onion", Colour((-22, 12), (0.35, 0.68), (0.45, 0.82)), (0.075, 0.1), (0.82, 1.0), 0.15, 0.03,
                (Defect("blotch", 0.35, DARK_ROT), Defect("line", 0.3, SPROUT), Defect("line", 0.15, SCUFF), Defect("spots", 0.2, BLACK_SPOT))),
        Variant("potato", Colour((28, 42), (0.3, 0.55), (0.55, 0.85)), (0.075, 0.1), (0.62, 0.85), 0.05, 0.05,
                (Defect("tint", 0.35, GREENING), Defect("blotch", 0.25, DARK_ROT), Defect("line", 0.2, SPROUT), Defect("spots", 0.2, BLACK_SPOT))),
    ),
    "solanaceous_fruit": (
        Variant("tomato", Colour((-5, 10), (0.68, 0.9), (0.55, 0.9)), (0.08, 0.11), (0.85, 1.0), 0.35, 0.01,
                (Defect("offcolour", 0.35, Colour((55, 100), (0.5, 0.8), (0.45, 0.8))), Defect("blotch", 0.25, Colour((5, 20), (0.6, 0.85), (0.18, 0.32))),
                 Defect("line", 0.2, BLACK_SPOT), Defect("spots", 0.2, BLACK_SPOT))),
        Variant("chilli", Colour((85, 120), (0.5, 0.85), (0.35, 0.7)), (0.1, 0.15), (0.13, 0.2), 0.3, 0.01,
                (Defect("offcolour", 0.35, Colour((-5, 10), (0.7, 0.9), (0.45, 0.8))), Defect("spots", 0.35, BLACK_SPOT), Defect("offcolour", 0.3, Colour((40, 60), (0.2, 0.4), (0.25, 0.4))))),
    ),
    "tropical_fruit": (
        Variant("banana", Colour((48, 58), (0.6, 0.85), (0.75, 0.95)), (0.15, 0.2), (0.25, 0.35), 0.15, 0.01,
                (Defect("spots", 0.4, Colour((20, 35), (0.5, 0.8), (0.15, 0.3))), Defect("blotch", 0.3, DARK_ROT), Defect("offcolour", 0.3, Colour((70, 90), (0.5, 0.8), (0.45, 0.7))))),
        Variant("mango", Colour((35, 55), (0.6, 0.9), (0.7, 0.95)), (0.1, 0.13), (0.65, 0.8), 0.25, 0.01,
                (Defect("spots", 0.4, BLACK_SPOT), Defect("blotch", 0.3, DARK_ROT), Defect("offcolour", 0.3, Colour((75, 100), (0.5, 0.75), (0.4, 0.65))))),
    ),
    "grain_lot": (
        Variant("wheat", Colour((30, 40), (0.45, 0.65), (0.6, 0.85)), (0.018, 0.025), (0.5, 0.65), 0.05, 0.04, GRAIN_DEFECTS, mould=True),
        Variant("maize", Colour((40, 50), (0.7, 0.9), (0.75, 0.95)), (0.025, 0.03), (0.8, 0.95), 0.1, 0.03, GRAIN_DEFECTS, mould=True),
        Variant("jowar", Colour((35, 50), (0.08, 0.22), (0.78, 0.95)), (0.018, 0.022), (0.85, 1.0), 0.05, 0.03, GRAIN_DEFECTS, mould=True),
        Variant("paddy", Colour((38, 48), (0.45, 0.65), (0.65, 0.85)), (0.025, 0.03), (0.3, 0.4), 0.05, 0.04, GRAIN_DEFECTS, mould=True),
    ),
    "legume_lot": (
        Variant("tur", Colour((28, 38), (0.5, 0.75), (0.55, 0.8)), (0.02, 0.025), (0.8, 0.95), 0.1, 0.03,
                (Defect("split", 0.3, SCUFF), Defect("hole", 0.25, BLACK_SPOT), Defect("offcolour", 0.25, DISCOLOURED), Defect("foreign", 0.2, STONE)), mould=True),
        Variant("gram", Colour((25, 35), (0.4, 0.6), (0.45, 0.7)), (0.022, 0.028), (0.75, 0.9), 0.05, 0.05,
                (Defect("split", 0.3, SCUFF), Defect("hole", 0.25, BLACK_SPOT), Defect("offcolour", 0.25, DISCOLOURED), Defect("foreign", 0.2, STONE)), mould=True),
    ),
    "oilseed_lot": (
        Variant("soybean", Colour((40, 50), (0.25, 0.45), (0.75, 0.92)), (0.022, 0.026), (0.85, 0.95), 0.15, 0.02,
                (Defect("tint", 0.3, PURPLE_STAIN), Defect("offcolour", 0.25, DISCOLOURED), Defect("split", 0.25, SCUFF), Defect("foreign", 0.2, STONE)), mould=True),
    ),
    "fibre_lot": (
        Variant("cotton", Colour((40, 55), (0.02, 0.1), (0.82, 0.97)), (0.05, 0.08), (0.7, 1.0), 0.0, 0.08,
                (Defect("spots", 0.5, TRASH), Defect("tint", 0.3, YELLOWING), Defect("blotch", 0.2, Colour((30, 45), (0.3, 0.5), (0.5, 0.65)))), fluffy=True),
    ),
}

FAMILIES = tuple(VARIANTS)

BACKGROUNDS: dict[str, Colour] = {
    "gunny": Colour((25, 38), (0.3, 0.45), (0.35, 0.55)),
    "tarp": Colour((200, 220), (0.45, 0.7), (0.35, 0.6)),
    "concrete": Colour((20, 60), (0.0, 0.06), (0.45, 0.65)),
    "soil": Colour((18, 30), (0.35, 0.55), (0.22, 0.38)),
}


@dataclass
class Lot:
    image: np.ndarray  # [H, W, 3] float32 in [0, 1]
    defective: int
    visible: int
    covered: np.ndarray = field(repr=False)  # [H, W] bool: pixel shows produce

    @property
    def fraction(self) -> float:
        return self.defective / max(self.visible, 1)

    @property
    def grade(self) -> int:
        return grade_for(self.fraction)


def _background(rng: np.random.Generator, kind: str, h: int, w: int, ys: np.ndarray, xs: np.ndarray) -> np.ndarray:
    base = BACKGROUNDS[kind].sample(rng, 1)[0]
    tex = rng.normal(0, 0.035, (h, w))
    if kind == "gunny":  # woven jute
        period = rng.uniform(3.0, 5.0)
        tex += 0.06 * np.sin(xs * 2 * np.pi / period) * np.sin(ys * 2 * np.pi / period)
    elif kind == "tarp":
        tex += 0.04 * np.sin((xs + ys) * 2 * np.pi / rng.uniform(40, 90))
    return np.clip(base[None, None, :] * (1 + tex[..., None]), 0, 1)


def render_lot(
    rng: np.random.Generator,
    variant: Variant,
    p_defect: float,
    height: int = 224,
    width: int | None = None,
    background: str | None = None,
    region: np.ndarray | None = None,
    scale: float = 1.0,
) -> Lot:
    """Render one lot. `region` (bool [H, W]) confines produce to part of the frame (camera scenes);
    `scale` multiplies object size relative to the frame (a camera held further away is < 1)."""
    width = width or height
    side = min(height, width)
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float64) + 0.5
    bg_kind = background or rng.choice(list(BACKGROUNDS))
    bg = _background(rng, bg_kind, height, width, ys, xs)

    theta = rng.uniform(0, np.pi)
    ct, st = np.cos(theta), np.sin(theta)
    aspect = rng.uniform(*variant.aspect)
    a = rng.uniform(*variant.radius) * side * scale
    X = ct * xs + st * ys
    Y = (-st * xs + ct * ys) / aspect
    spacing = 2 * a * rng.uniform(0.9, 1.02)
    x0, y0 = X.min() - spacing, Y.min() - spacing
    nx = int((X.max() - x0) / spacing) + 3
    ny = int((Y.max() - y0) / spacing) + 3
    n = nx * ny
    jitter = rng.uniform(-0.28, 0.28, (ny, nx, 2)) * spacing
    cx = (x0 + (np.arange(nx)[None, :] + 0.5) * spacing + jitter[..., 0]).ravel()
    cy = (y0 + (np.arange(ny)[:, None] + 0.5) * spacing + jitter[..., 1]).ravel()
    size = rng.uniform(0.88, 1.08, n)

    gi = np.floor((X - x0) / spacing).astype(int)
    gj = np.floor((Y - y0) / spacing).astype(int)
    best = np.full(X.shape, np.inf)
    idx = np.zeros(X.shape, dtype=int)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            k = np.clip(gj + di, 0, ny - 1) * nx + np.clip(gi + dj, 0, nx - 1)
            d = ((X - cx[k]) ** 2 + (Y - cy[k]) ** 2) / size[k] ** 2
            closer = d < best
            best[closer] = d[closer]
            idx[closer] = k[closer]

    phi = rng.uniform(-0.3, 0.3, n)
    dx, dy = X - cx[idx], Y - cy[idx]
    rad = a * size[idx]
    u = (np.cos(phi[idx]) * dx + np.sin(phi[idx]) * dy) / rad
    v = (-np.sin(phi[idx]) * dx + np.cos(phi[idx]) * dy) / rad

    # Per-object attributes.
    colour = variant.colour.sample(rng, n)
    has_defect = rng.random(n) < p_defect
    weights = np.array([d.weight for d in variant.defects])
    kind = rng.choice(len(variant.defects), n, p=weights / weights.sum())
    defect_colour = np.stack([variant.defects[i].colour.sample(rng, 1)[0] for i in range(len(variant.defects))])
    defect_colour = defect_colour[kind] * rng.uniform(0.9, 1.1, (n, 1))
    kinds = np.array([d.kind for d in variant.defects])[kind]
    narrow = np.array([d.narrow for d in variant.defects])[kind]

    foreign = has_defect & (kinds == "foreign")
    offcolour = has_defect & (kinds == "offcolour")
    colour = np.where((foreign | offcolour)[:, None], defect_colour, colour)
    # Foreign matter: stones are rounder, chaff far thinner than a kernel.
    v = np.where(foreign[idx], v / narrow[idx], v)
    r = np.sqrt(u**2 + v**2)
    inside = r < (1.0 if not variant.fluffy else 1.0 + 0.18 * np.sin(7 * np.arctan2(v, u) + phi[idx] * 9))
    if region is not None:
        inside &= region

    shade = 1.0 - 0.3 * r**2 + variant.gloss * np.exp(-((u + 0.35) ** 2 + (v + 0.35) ** 2) / 0.05)
    shade *= 1 - 0.45 * np.clip((r - 0.82) / 0.18, 0, 1)
    if variant.fluffy:
        shade = 1.0 - 0.12 * r**2
    img = colour[idx] * shade[..., None]
    img *= 1 + rng.normal(0, variant.texture, img.shape[:2])[..., None]

    # Defects, each confined to its object.
    d_u0 = rng.uniform(-0.45, 0.45, n)
    d_v0 = rng.uniform(-0.45, 0.45, n)
    d_rad = rng.uniform(0.28, 0.55, n)
    alpha = np.zeros(X.shape)
    blotch = has_defect[idx] & (kinds[idx] == "blotch")
    rb = np.sqrt((u - d_u0[idx]) ** 2 + (v - d_v0[idx]) ** 2) / d_rad[idx]
    alpha = np.where(blotch, np.clip(1.4 - rb, 0, 0.9), alpha)
    spots = has_defect[idx] & (kinds[idx] == "spots")
    for s in range(3):
        su, sv = rng.uniform(-0.6, 0.6, n), rng.uniform(-0.6, 0.6, n)
        sr = rng.uniform(0.1, 0.2, n)
        rs = np.sqrt((u - su[idx]) ** 2 + (v - sv[idx]) ** 2) / sr[idx]
        alpha = np.where(spots, np.maximum(alpha, np.clip(1.5 - rs, 0, 0.95)), alpha)
    hole = has_defect[idx] & (kinds[idx] == "hole")
    rh = np.sqrt((u - d_u0[idx] * 0.6) ** 2 + (v - d_v0[idx] * 0.6) ** 2) / 0.32
    alpha = np.where(hole, np.clip(1.5 - rh, 0, 0.95), alpha)
    line = has_defect[idx] & (kinds[idx] == "line")
    ang = rng.uniform(0, np.pi, n)
    lu, lv = np.cos(ang)[idx], np.sin(ang)[idx]
    along = u * lu + v * lv
    across = np.abs(-u * lv + v * lu)
    alpha = np.where(line & (np.abs(along) < 0.75), np.maximum(alpha, np.clip(1.6 - across / 0.09, 0, 0.95)), alpha)
    tint = has_defect[idx] & (kinds[idx] == "tint")
    alpha = np.where(tint, np.clip((u * lu + v * lv - d_u0[idx] * 0.5) * 2.5, 0, 0.7), alpha)
    split = has_defect[idx] & (kinds[idx] == "split")
    alpha = np.where(split, np.where(u * lu + v * lv > 0, 0.55, 0.0), alpha)
    img = img * (1 - alpha[..., None]) + defect_colour[idx] * shade[..., None] * alpha[..., None]

    # Visible mould on a grain lot: a grey-green bloom over a patch of kernels.
    mould_hit = np.zeros(n, dtype=bool)
    if variant.mould and rng.random() < min(p_defect * 1.6, 0.6):
        mx, my = rng.uniform(0.2, 0.8) * width, rng.uniform(0.2, 0.8) * height
        mr = rng.uniform(0.08, 0.2) * side * max(p_defect * 3, 0.5)
        dm = np.sqrt((xs - mx) ** 2 + (ys - my) ** 2) / mr
        m_alpha = np.clip(1.2 - dm, 0, 0.75) * (0.7 + 0.3 * rng.random(X.shape))
        mould = Colour((75, 110), (0.1, 0.25), (0.5, 0.7)).sample(rng, 1)[0]
        img = img * (1 - m_alpha[..., None]) + mould * m_alpha[..., None]
        hit = inside & (dm < 0.8)
        mould_hit[np.unique(idx[hit])] = True

    # Gaps between objects show the background, in shadow.
    gap_shadow = np.clip(0.55 + 0.45 * (np.sqrt(best) - 1.0) / 0.6, 0.55, 1.0)
    img = np.where(inside[..., None], img, bg * gap_shadow[..., None])

    # Counting: an object is visible if a meaningful part of it is on screen.
    counts = np.bincount(idx[inside], minlength=n)
    visible = counts >= max(4, int(0.25 * np.pi * (a * aspect) * a))
    defective = int(np.sum(visible & (has_defect | mould_hit)))

    # Light, white balance, sensor noise, occasional softness.
    img = img * rng.uniform(0.8, 1.15) * rng.uniform(0.95, 1.05, 3)[None, None, :]
    img += rng.normal(0, rng.uniform(0.008, 0.02), img.shape)
    if rng.random() < 0.3:
        img = (img + np.roll(img, 1, 0) + np.roll(img, -1, 0) + np.roll(img, 1, 1) + np.roll(img, -1, 1)) / 5
    return Lot(np.clip(img, 0, 1).astype(np.float32), defective, int(visible.sum()), inside)


def sample_p_defect(rng: np.random.Generator) -> float:
    """Spread lots across the three grades, with plenty of borderline cases."""
    band = rng.integers(0, 3)
    lo, hi = ((0.0, 0.07), (0.05, 0.22), (0.18, 0.45))[band]
    return float(rng.uniform(lo, hi))
