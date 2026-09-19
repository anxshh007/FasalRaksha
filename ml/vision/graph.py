"""The grading model as an ONNX graph (PROMPT §7.3; ARCHITECTURE G-3).

Contract, identical to a MobileNetV3-Small drop-in:

    input   image        float32 [N, 3, 224, 224], RGB in [0, 1], NCHW
    output  grade_probs  float32 [N, 3], probabilities of grades A, B, C

Inside, it is not a convolutional network trained end to end: with no field photographs and no
deep-learning framework in this build, it is a fixed descriptor stage followed by a small trained
classifier. Swapping in real weights later means replacing this file; the device code that loads
and runs it does not change.

Descriptor stage (all in-graph, so the phone computes exactly what training computed):
  - colour signature: soft assignment of every pixel to K colour prototypes learned from the
    family's lots (a 1x1 convolution and a softmax over prototypes), averaged over the image;
    and how patchy each prototype is (its spatial variance)
  - blemish and texture: local contrast, dark spots against their surroundings, bright specks,
    Laplacian energy, at full and half resolution
  - colour moments: per-channel mean and standard deviation
Head: standardise, dense (INT8 weights), ReLU, dense (INT8 weights), softmax.

Learned weight tensors are stored as INT8 with per-channel scales and dequantised in-graph
(DequantizeLinear), which ONNX Runtime Web executes on the WASM backend.
"""
from __future__ import annotations

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

OPSET = 17
SIDE = 224
#: Softness of the colour assignment: one prototype "owns" a pixel within about this distance.
SIGMA = 0.1
DARK_MARGIN = 0.04


def quantize_per_channel(weights: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Symmetric INT8, one scale per output channel (axis 0)."""
    flat = weights.reshape(weights.shape[0], -1)
    scale = np.maximum(np.abs(flat).max(axis=1), 1e-8) / 127.0
    q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8)
    return q.reshape(weights.shape), scale.astype(np.float32)


def dequantized(weights: np.ndarray) -> np.ndarray:
    q, scale = quantize_per_channel(weights)
    return (q.reshape(q.shape[0], -1).astype(np.float32) * scale[:, None]).reshape(weights.shape)


class _Builder:
    def __init__(self) -> None:
        self.nodes: list[onnx.NodeProto] = []
        self.inits: list[onnx.TensorProto] = []
        self._n = 0

    def name(self, stem: str) -> str:
        self._n += 1
        return f"{stem}_{self._n}"

    def const(self, stem: str, value: np.ndarray) -> str:
        name = self.name(stem)
        self.inits.append(numpy_helper.from_array(np.asarray(value), name))
        return name

    def int8(self, stem: str, weights: np.ndarray) -> str:
        q, scale = quantize_per_channel(weights)
        qn = self.const(f"{stem}_q", q)
        sn = self.const(f"{stem}_scale", scale)
        zn = self.const(f"{stem}_zero", np.zeros(scale.shape, dtype=np.int8))
        return self.op("DequantizeLinear", [qn, sn, zn], stem, axis=0)

    def op(self, kind: str, inputs: list[str], stem: str | None = None, **attrs: object) -> str:
        out = self.name(stem or kind.lower())
        self.nodes.append(helper.make_node(kind, inputs, [out], **attrs))
        return out

    def gap(self, x: str) -> str:
        return self.op("GlobalAveragePool", [x], "gap")

    def avg(self, x: str, k: int, stride: int = 1) -> str:
        pad = (k - 1) // 2 if stride == 1 else 0
        return self.op("AveragePool", [x], "avg", kernel_shape=[k, k], strides=[stride, stride], pads=[pad] * 4, count_include_pad=0)


def prototype_conv(prototypes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Softmax over prototypes of -|p - c_k|^2 / 2σ² equals softmax of (p·c_k - |c_k|²/2) / σ²:
    the |p|² term is the same for every k and cancels."""
    w = (prototypes / SIGMA**2).astype(np.float32)[:, :, None, None]
    b = (-(prototypes**2).sum(axis=1) / (2 * SIGMA**2)).astype(np.float32)
    return w, b


def _features(g: _Builder, image: str, prototypes: np.ndarray) -> str:
    w, b = prototype_conv(prototypes)
    logits = g.op("Conv", [image, g.int8("proto_w", w), g.const("proto_b", b)], "proto_logits")
    resp = g.op("Softmax", [logits], "resp", axis=1)
    hist = g.gap(resp)
    patchy = g.op("Sub", [g.gap(g.op("Mul", [resp, resp])), g.op("Mul", [hist, hist])], "patchy")

    luma = g.op("Conv", [image, g.const("luma_w", np.array([0.299, 0.587, 0.114], dtype=np.float32).reshape(1, 3, 1, 1))], "luma")
    margin = g.const("margin", np.array(DARK_MARGIN, dtype=np.float32))

    def blemish(y: str) -> list[str]:
        m5, m9 = g.avg(y, 5), g.avg(y, 9)
        contrast = g.gap(g.op("Abs", [g.op("Sub", [y, m5])]))
        dark = g.gap(g.op("Relu", [g.op("Sub", [g.op("Sub", [m9, y]), margin])]))
        bright = g.gap(g.op("Relu", [g.op("Sub", [g.op("Sub", [y, m9]), margin])]))
        return [contrast, dark, bright]

    lap = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32).reshape(1, 1, 3, 3)
    laplace = g.gap(g.op("Abs", [g.op("Conv", [luma, g.const("lap", lap)], "laplace", pads=[1, 1, 1, 1])]))
    half = g.avg(luma, 2, stride=2)

    mean = g.gap(image)
    var = g.op("Sub", [g.gap(g.op("Mul", [image, image])), g.op("Mul", [mean, mean])])
    std = g.op("Sqrt", [g.op("Add", [g.op("Relu", [var]), g.const("eps", np.array(1e-6, dtype=np.float32))])])

    parts = [hist, patchy, mean, std, *blemish(luma), laplace, *blemish(half)]
    return g.op("Flatten", [g.op("Concat", parts, "features4d", axis=1)], "features", axis=1)


def feature_count(k: int) -> int:
    return 2 * k + 3 + 3 + 3 + 1 + 3


def _model(g: _Builder, output: str, width: int, out_name: str, doc: str) -> onnx.ModelProto:
    g.nodes.append(helper.make_node("Identity", [output], [out_name]))
    graph = helper.make_graph(
        g.nodes,
        "fasal_grade",
        [helper.make_tensor_value_info("image", TensorProto.FLOAT, ["N", 3, SIDE, SIDE])],
        [helper.make_tensor_value_info(out_name, TensorProto.FLOAT, ["N", width])],
        g.inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", OPSET)], producer_name="fasal-raksha-ml", doc_string=doc)
    model.ir_version = 8
    onnx.checker.check_model(model)
    return model


def feature_model(prototypes: np.ndarray) -> onnx.ModelProto:
    g = _Builder()
    feats = _features(g, "image", prototypes)
    return _model(g, feats, feature_count(len(prototypes)), "features", "descriptor stage only (training)")


def grading_model(
    prototypes: np.ndarray,
    mu: np.ndarray,
    sd: np.ndarray,
    layers: list[tuple[np.ndarray, np.ndarray]],
    doc: str,
) -> onnx.ModelProto:
    """layers: [(W [out, in], b [out]), ...] from the trained classifier; ReLU between them."""
    g = _Builder()
    feats = _features(g, "image", prototypes)
    x = g.op("Div", [g.op("Sub", [feats, g.const("mu", mu.astype(np.float32))]), g.const("sd", sd.astype(np.float32))], "standard")
    for i, (w, b) in enumerate(layers):
        x = g.op("Gemm", [x, g.int8(f"dense{i}_w", w.astype(np.float32)), g.const(f"dense{i}_b", b.astype(np.float32))], f"dense{i}", transB=1)
        if i < len(layers) - 1:
            x = g.op("Relu", [x])
    probs = g.op("Softmax", [x], "probs", axis=1)
    return _model(g, probs, 3, "grade_probs", doc)
