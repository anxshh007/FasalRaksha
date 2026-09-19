"""Golden vector for the grading models (runtime parity).

    node tools/py.mjs -m ml.vision.golden

A fixed input tensor, defined by a formula both languages evaluate with the same IEEE double
operations in the same order (so the float32 tensors are bit-identical), run through every
committed model with ONNX Runtime (Python). The phone runs the same model bytes with ONNX Runtime
Web; apps/web's parity test must reproduce these probabilities. They are stored at full precision
and compared as log-probabilities, because a saturated 1e-9 still pins the model's logits.

    tri(v) = |(v mod 36) - 18| / 18
    value(c, y, x) = (0.2 + 0.7 * tri(x + 5c) * tri(y + 3c)) * tint[c],   tint = (0.85, 0.5, 0.45)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "apps" / "web" / "src" / "camera" / "models.json"
GOLDEN = ROOT / "data" / "golden" / "vision.json"
TINT = (0.85, 0.5, 0.45)


def golden_input() -> np.ndarray:
    c, y, x = np.meshgrid(np.arange(3), np.arange(224), np.arange(224), indexing="ij")

    def tri(v: np.ndarray) -> np.ndarray:
        return np.abs(np.mod(v, 36) - 18.0) / 18.0

    tint = np.array(TINT)[:, None, None]
    return ((0.2 + 0.7 * tri(x + 5 * c) * tri(y + 3 * c)) * tint).astype(np.float32)[None]


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    tensor = golden_input()
    outputs = {}
    for family, entry in manifest["families"].items():
        model = (ROOT / "apps" / "web" / "public" / entry["path"].lstrip("/")).read_bytes()
        session = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
        outputs[family] = [float(p) for p in session.run(["grade_probs"], {"image": tensor})[0][0]]
    GOLDEN.write_text(
        json.dumps(
            {
                "input": "tri(v) = |(v mod 36) - 18| / 18; value(c,y,x) = (0.2 + 0.7*tri(x+5c)*tri(y+3c)) * [0.85,0.5,0.45][c]; float32 [1,3,224,224]",
                "modelVersion": manifest["version"],
                "compare": "log-probabilities within 1e-3 where p > 1e-30",
                "gradeProbs": outputs,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(outputs))


if __name__ == "__main__":
    main()
