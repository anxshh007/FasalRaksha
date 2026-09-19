"""FR-11 · PROMPT §7.3 · §7.6 — the grading models as committed: the contract, INT8, under 5 MB, integrity,
`fieldValidated: false`, and deterministic rendering. Training itself (ml.vision.train) is slow
and is not re-run here; these tests check what the phone will load."""
from __future__ import annotations

import hashlib
import json

import numpy as np
import onnx
import onnxruntime as ort
import pytest

from ml.vision.golden import GOLDEN, golden_input
from ml.vision.graph import quantize_per_channel
from ml.vision.png import encode_png, read_png
from ml.vision.render import FAMILIES, VARIANTS, grade_for, render_lot
from ml.vision.train import MANIFEST, MODELS_DIR, ROOT

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))


def model_bytes(family: str) -> bytes:
    return (ROOT / "apps" / "web" / "public" / manifest["families"][family]["path"].lstrip("/")).read_bytes()


def test_every_family_has_a_model_and_nothing_claims_field_validation():
    assert set(manifest["families"]) == set(FAMILIES)
    assert manifest["fieldValidated"] is False
    assert "no field photographs" in manifest["trainedOn"]
    assert len(list(MODELS_DIR.glob("*.onnx"))) == len(FAMILIES)  # no stale weights left behind


@pytest.mark.parametrize("family", FAMILIES)
def test_committed_model_matches_its_manifest_hash_and_is_small(family: str):
    data = model_bytes(family)
    entry = manifest["families"][family]
    assert hashlib.sha256(data).hexdigest() == entry["sha256"]
    assert len(data) == entry["bytes"] < 5 * 1024 * 1024
    assert "moisture" not in " ".join(entry["assesses"])  # §7.3: never claimed


@pytest.mark.parametrize("family", FAMILIES)
def test_contract_is_a_224_rgb_drop_in_with_int8_weights(family: str):
    model = onnx.load_from_string(model_bytes(family))
    onnx.checker.check_model(model)
    (inp,) = model.graph.input
    (out,) = model.graph.output
    dims = [d.dim_param or d.dim_value for d in inp.type.tensor_type.shape.dim]
    assert inp.name == "image" and dims == ["N", 3, 224, 224]
    assert out.name == "grade_probs" and [d.dim_param or d.dim_value for d in out.type.tensor_type.shape.dim] == ["N", 3]
    int8 = [t for t in model.graph.initializer if t.data_type == onnx.TensorProto.INT8 and "_q_" in t.name]
    assert len(int8) >= 3  # prototypes and both dense layers
    assert sum(n.op_type == "DequantizeLinear" for n in model.graph.node) >= 3
    assert json.loads(model.doc_string)["fieldValidated"] is False


@pytest.mark.parametrize("family", FAMILIES)
def test_output_is_a_probability_distribution(family: str):
    session = ort.InferenceSession(model_bytes(family), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(3)
    batch = rng.random((4, 3, 224, 224), dtype=np.float32)
    probs = session.run(["grade_probs"], {"image": batch})[0]
    assert probs.shape == (4, 3)
    assert np.allclose(probs.sum(axis=1), 1, atol=1e-5)
    assert (probs >= 0).all()


def test_golden_vector_is_reproduced_by_the_committed_models():
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert golden["modelVersion"] == manifest["version"]
    tensor = golden_input()
    for family, expected in golden["gradeProbs"].items():
        session = ort.InferenceSession(model_bytes(family), providers=["CPUExecutionProvider"])
        got = session.run(["grade_probs"], {"image": tensor})[0][0]
        live = np.array(expected) > 1e-30
        assert np.allclose(np.log(got[live]), np.log(np.array(expected)[live]), atol=1e-3), family
        assert np.all(got[~live] <= 1e-30), family


def test_quantisation_error_is_at_most_half_a_step_per_channel():
    w = np.random.default_rng(1).normal(0, 3, (8, 5)).astype(np.float32)
    q, scale = quantize_per_channel(w)
    assert q.dtype == np.int8
    assert np.all(np.abs(q.astype(np.float32) * scale[:, None] - w) <= scale[:, None] / 2 + 1e-7)


def test_rendering_is_deterministic_and_labels_follow_the_rendered_pixels():
    variant = VARIANTS["tuber_bulb"][0]
    a = render_lot(np.random.default_rng(11), variant, 0.2)
    b = render_lot(np.random.default_rng(11), variant, 0.2)
    assert np.array_equal(a.image, b.image)
    assert a.grade == grade_for(a.defective / a.visible)
    clean = render_lot(np.random.default_rng(12), variant, 0.0)
    assert clean.defective == 0 and clean.grade == 0


def test_grade_edges():
    assert [grade_for(f) for f in (0.0, 0.059, 0.06, 0.199, 0.2, 0.9)] == [0, 0, 1, 1, 2, 2]


def test_png_round_trip():
    image = np.random.default_rng(2).integers(0, 256, (7, 9, 3), dtype=np.uint8)
    path = ROOT / "data" / "fixtures" / "camera" / "png" / "_roundtrip.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encode_png(image))
    try:
        assert np.array_equal(read_png(path), image)
    finally:
        path.unlink()
