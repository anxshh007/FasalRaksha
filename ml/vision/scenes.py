"""Camera scenes for the Gate C walkthrough and the vision rule tests (PROMPT §7.7).

    node tools/py.mjs -m ml.vision.scenes

Writes 640x480 PNGs to data/fixtures/camera/: lots that should pass, the conditions each
viewfinder message exists for (too dark, too bright, too far, off to one side, blurred), and
the things §7.2 says must be rejected before grading (a wall, a ceiling, a face, a shoe, an
unrelated object). The E2E suite plays them through a fake camera; the shared vision tests
decode them with node's zlib. Deterministic: the same seed draws the same pixels.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ml.vision.png import write_png
from ml.vision.render import VARIANTS, Colour, render_lot

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "fixtures" / "camera" / "png"  # intermediate; tools/fixtures/camera.mjs makes the JPEGs
H, W = 480, 640
YS, XS = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5


def variant(crop: str):
    return next(v for vs in VARIANTS.values() for v in vs if v.crop == crop)


def box_blur(img: np.ndarray, radius: int) -> np.ndarray:
    out = img.copy()
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-radius, radius + 1):
            acc += np.roll(out, d, axis=axis)
        out = acc / (2 * radius + 1)
    return out


def plain(rng: np.random.Generator, colour: Colour, noise: float = 0.012) -> np.ndarray:
    base = colour.sample(rng, 1)[0]
    vignette = 1 - 0.18 * (((XS - W / 2) / W) ** 2 + ((YS - H / 2) / H) ** 2) * 4
    img = base[None, None, :] * vignette[..., None]
    return np.clip(img + rng.normal(0, noise, img.shape), 0, 1)


def ellipse(cx: float, cy: float, rx: float, ry: float, angle: float = 0.0) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    u = (c * (XS - cx) + s * (YS - cy)) / rx
    v = (-s * (XS - cx) + c * (YS - cy)) / ry
    return u**2 + v**2


def paint(img: np.ndarray, mask: np.ndarray, colour: np.ndarray, shade: np.ndarray | None = None) -> np.ndarray:
    fill = colour[None, None, :] * (1.0 if shade is None else shade[..., None])
    return np.where(mask[..., None], fill, img)


def face(rng: np.random.Generator) -> np.ndarray:
    img = plain(rng, Colour((200, 215), (0.15, 0.25), (0.55, 0.65)))
    d = ellipse(W / 2, H / 2 + 20, 150, 190)
    skin = Colour((18, 28), (0.35, 0.5), (0.6, 0.75)).sample(rng, 1)[0]
    img = paint(img, d < 1, skin, 1 - 0.25 * np.clip(d, 0, 1))
    img = paint(img, (ellipse(W / 2, H / 2 - 110, 165, 110) < 1) & (YS < H / 2 - 60), np.array([0.08, 0.06, 0.05]))
    for ex in (W / 2 - 55, W / 2 + 55):
        img = paint(img, ellipse(ex, H / 2 - 10, 24, 12) < 1, np.array([0.95, 0.95, 0.93]))
        img = paint(img, ellipse(ex, H / 2 - 10, 9, 9) < 1, np.array([0.12, 0.08, 0.06]))
    img = paint(img, ellipse(W / 2, H / 2 + 95, 50, 12) < 1, np.array([0.55, 0.28, 0.26]))
    return np.clip(img + rng.normal(0, 0.01, img.shape), 0, 1)


def shoe(rng: np.random.Generator) -> np.ndarray:
    img = plain(rng, Colour((20, 40), (0.02, 0.06), (0.5, 0.6)))
    d = ellipse(W / 2, H / 2, 230, 95, 0.15)
    leather = Colour((15, 25), (0.5, 0.65), (0.22, 0.3)).sample(rng, 1)[0]
    img = paint(img, d < 1, leather, 1 - 0.35 * np.clip(d, 0, 1) + 0.25 * np.exp(-ellipse(W / 2 - 60, H / 2 - 40, 60, 20) * 2))
    img = paint(img, (d < 1) & (d > 0.82), np.array([0.06, 0.05, 0.05]))  # the sole's edge
    for i in range(6):  # laces
        img = paint(img, ellipse(W / 2 + 40 + i * 18, H / 2 - 20 + (i % 2) * 8, 12, 3, 0.6) < 1, np.array([0.85, 0.85, 0.8]))
    return np.clip(img + rng.normal(0, 0.01, img.shape), 0, 1)


def bucket(rng: np.random.Generator) -> np.ndarray:
    img = plain(rng, Colour((25, 40), (0.05, 0.12), (0.55, 0.7)))
    body = (np.abs(XS - W / 2) < 170 - (YS - 60) * 0.12) & (YS > 60) & (YS < 440)
    shade = 0.75 + 0.3 * np.cos((XS - W / 2) / 170 * 1.4)
    img = paint(img, body, np.array([0.1, 0.35, 0.75]), shade)
    img = paint(img, (np.abs(YS - 70) < 10) & (np.abs(XS - W / 2) < 175), np.array([0.08, 0.28, 0.62]))
    return np.clip(img + rng.normal(0, 0.01, img.shape), 0, 1)


def ceiling(rng: np.random.Generator) -> np.ndarray:
    img = plain(rng, Colour((40, 50), (0.02, 0.06), (0.8, 0.88)))
    tube = (np.abs(YS - 180) < 14) & (np.abs(XS - W / 2) < 220)
    return paint(img, tube, np.array([1.0, 1.0, 1.0]))


def lot(rng: np.random.Generator, crop: str, p: float, background: str = "gunny", **kw) -> np.ndarray:
    return render_lot(rng, variant(crop), p, height=H, width=W, background=background, **kw).image.astype(np.float64)


def scenes() -> dict[str, np.ndarray]:
    rng = np.random.default_rng(7)
    onion = lot(rng, "onion", 0.02)
    far_region = ellipse(W / 2, H / 2, 150, 120) < 1
    edge_region = XS < W * 0.2
    return {
        "onion-lot": onion,
        "onion-lot-poor": lot(rng, "onion", 0.4),
        "onion-far": lot(rng, "onion", 0.02, background="concrete", region=far_region, scale=0.35),
        "onion-edge": lot(rng, "onion", 0.02, background="concrete", region=edge_region),
        "onion-dark": onion * 0.1,
        "onion-bright": np.clip(onion * 0.25 + 0.8, 0, 1),
        "onion-blurred": box_blur(onion, 9),
        "tomato-lot": lot(rng, "tomato", 0.03),
        "wheat-lot": lot(rng, "wheat", 0.03, background="tarp"),
        "cotton-lot": lot(rng, "cotton", 0.03, background="soil"),
        "wall": plain(rng, Colour((30, 40), (0.18, 0.28), (0.72, 0.8))),
        "ceiling": ceiling(rng),
        "face": face(rng),
        "shoe": shoe(rng),
        "bucket": bucket(rng),
    }


def main() -> None:
    for name, image in scenes().items():
        write_png(OUT / f"{name}.png", image)
        print(name)


if __name__ == "__main__":
    main()
