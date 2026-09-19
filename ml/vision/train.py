"""Train and export the per-family grading models (PROMPT §7.3, §7.6).

    node tools/py.mjs -m ml.vision.train

For each vision family: render lots (render.py), learn K colour prototypes from their pixels,
compute descriptors with the very graph the phone will run (ONNX Runtime here, ONNX Runtime Web
there), fit a small classifier, store its weights as INT8, and check the INT8 graph against the
float classifier on held-out lots.

Writes:
  apps/web/public/models/<family>.<sha8>.onnx   content-addressed, immutable
  apps/web/src/camera/models.json               what the phone loads and the hash it must match
  data/models/report.json                       held-out figures on synthetic lots, internal only

The report is never shown to a farmer or used as a claim: it measures agreement with a renderer,
not with a grader in a mandi yard (fieldValidated: false).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from sklearn.cluster import KMeans
from sklearn.neural_network import MLPClassifier

from ml.vision.graph import dequantized, feature_model, grading_model
from ml.vision.render import FAMILIES, GRADES, VARIANTS, render_lot, sample_p_defect

ROOT = Path(__file__).resolve().parents[2]
MODELS_DIR = ROOT / "apps" / "web" / "public" / "models"
MANIFEST = ROOT / "apps" / "web" / "src" / "camera" / "models.json"
REPORT = ROOT / "data" / "models" / "report.json"

VERSION = "2026-09-19.1"
PROTOTYPES = 16
HIDDEN = 16
N_TRAIN = 1400
N_TEST = 500
SEED = 20260919

#: What each family's model looks at, for the farmer's screen (§7.3). Moisture is never here.
ASSESSES: dict[str, list[str]] = {
    "tuber_bulb": ["rot", "sprouting", "greening", "surface-damage"],
    "solanaceous_fruit": ["ripeness", "cracks", "spots"],
    "tropical_fruit": ["ripeness", "spots", "bruising"],
    "grain_lot": ["foreign-matter", "chaff", "mould", "pest-damage"],
    "legume_lot": ["foreign-matter", "split-grains", "pest-damage", "discolouration"],
    "oilseed_lot": ["foreign-matter", "seed-stain", "split-seeds", "discolouration"],
    "fibre_lot": ["trash", "yellowing", "stains"],
}


def render_set(rng: np.random.Generator, family: str, n: int) -> tuple[np.ndarray, np.ndarray]:
    variants = VARIANTS[family]
    images = np.empty((n, 3, 224, 224), dtype=np.float32)
    labels = np.empty(n, dtype=np.int64)
    for i in range(n):
        lot = render_lot(rng, variants[i % len(variants)], sample_p_defect(rng))
        images[i] = lot.image.transpose(2, 0, 1)
        labels[i] = lot.grade
    return images, labels


def run(model_bytes: bytes, images: np.ndarray, output: str) -> np.ndarray:
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1  # deterministic reductions
    session = ort.InferenceSession(model_bytes, options, providers=["CPUExecutionProvider"])
    return np.concatenate([session.run([output], {"image": images[i : i + 64]})[0] for i in range(0, len(images), 64)])


def train_family(index: int, family: str) -> tuple[bytes, dict]:
    rng = np.random.default_rng(SEED + index)
    train_x, train_y = render_set(rng, family, N_TRAIN)
    test_x, test_y = render_set(rng, family, N_TEST)

    pixels = train_x[:240].transpose(0, 2, 3, 1).reshape(-1, 3)
    sample = pixels[rng.choice(len(pixels), 40_000, replace=False)]
    prototypes = KMeans(PROTOTYPES, n_init=4, random_state=0).fit(sample).cluster_centers_.astype(np.float32)
    prototypes = prototypes[np.lexsort(prototypes.T[::-1])]  # stable order

    features = feature_model(prototypes).SerializeToString()
    f_train = run(features, train_x, "features")
    f_test = run(features, test_x, "features")
    mu, sd = f_train.mean(axis=0), f_train.std(axis=0) + 1e-6

    clf = MLPClassifier((HIDDEN,), alpha=1e-2, max_iter=4000, random_state=0, tol=1e-6)
    clf.fit((f_train - mu) / sd, train_y)
    layers = [(w.T.copy(), b) for w, b in zip(clf.coefs_, clf.intercepts_)]

    doc = json.dumps({"family": family, "version": VERSION, "fieldValidated": False}, sort_keys=True)
    model = grading_model(prototypes, mu, sd, layers, doc).SerializeToString()
    probs = run(model, test_x, "grade_probs")
    predicted = probs.argmax(axis=1)
    float_predicted = clf.predict((f_test - mu) / sd)

    # The float classifier again, with INT8-rounded weights: how much quantisation costs.
    confident = probs.max(axis=1)
    confusion = np.zeros((3, 3), dtype=int)
    for t, p in zip(test_y, predicted):
        confusion[t, p] += 1
    report = {
        "family": family,
        "crops": [v.crop for v in VARIANTS[family]],
        "heldOutLots": int(N_TEST),
        "gradeCounts": {GRADES[g]: int((test_y == g).sum()) for g in range(3)},
        "accuracy": round(float((predicted == test_y).mean()), 3),
        "withinOneGrade": round(float((np.abs(predicted - test_y) <= 1).mean()), 3),
        "int8AgreesWithFloat": round(float((predicted == float_predicted).mean()), 3),
        "accuracyWhenTop>=0.75": round(float((predicted == test_y)[confident >= 0.75].mean()), 3) if (confident >= 0.75).any() else None,
        "shareTop>=0.75": round(float((confident >= 0.75).mean()), 3),
        "accuracyWhenTop<0.55": round(float((predicted == test_y)[confident < 0.55].mean()), 3) if (confident < 0.55).any() else None,
        "confusion[true][predicted]": confusion.tolist(),
        "maxWeightQuantisationError": round(float(max(np.abs(w - dequantized(w)).max() for w, _ in layers)), 5),
    }
    return model, report


def main() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for old in MODELS_DIR.glob("*.onnx"):
        old.unlink()
    families: dict[str, dict] = {}
    reports = []
    for index, family in enumerate(FAMILIES):
        model, report = train_family(index, family)
        digest = hashlib.sha256(model).hexdigest()
        name = f"{family}.{digest[:8]}.onnx"
        (MODELS_DIR / name).write_bytes(model)
        families[family] = {"path": f"/models/{name}", "sha256": digest, "bytes": len(model), "assesses": ASSESSES[family]}
        reports.append(report)
        print(f"{family:18s} {len(model):6d} B  acc {report['accuracy']:.3f}  within1 {report['withinOneGrade']:.3f}  int8=float {report['int8AgreesWithFloat']:.3f}  "
              f"top>=.75 {report['shareTop>=0.75']:.2f} -> {report['accuracyWhenTop>=0.75']}")
    manifest = {
        "version": VERSION,
        "fieldValidated": False,
        "trainedOn": "procedurally rendered lots (ml/vision/render.py); no field photographs",
        "contract": {"input": "image float32 [N,3,224,224] RGB 0-1", "output": "grade_probs float32 [N,3] (A,B,C)"},
        "families": families,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps({"version": VERSION, "fieldValidated": False, "note": "Held-out synthetic lots only. Not a field accuracy and never shown as one.", "families": reports}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
