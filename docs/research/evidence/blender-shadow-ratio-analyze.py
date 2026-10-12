"""Approximate adjustment-mask probe; not a physical shadow decomposition."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import OpenEXR
from PIL import Image

root, evidence = map(Path, sys.argv[1:])
prefix = "ViewLayer.Diffuse Direct"


def read_rgb(path):
    exr = OpenEXR.File(str(path), separate_channels=True)
    part = next(part for part in exr.parts if part.name() == prefix)
    return np.stack([part.channels[f"{prefix}.{c}"].pixels for c in "RGB"], -1)


normal_path = root / "shadow-ratio-normal.exr"
no_shadow_path = root / "shadow-ratio-no_shadow.exr"
normal, no_shadow = map(read_rgb, [normal_path, no_shadow_path])
assert normal.shape == no_shadow.shape == (96, 96, 3)
assert np.isfinite(normal).all() and np.isfinite(no_shadow).all()
weights = np.array([0.2126, 0.7152, 0.0722])
normal_y = normal @ weights
no_shadow_y = no_shadow @ weights
epsilon = 1e-6
valid = no_shadow_y > epsilon
ratio = np.zeros_like(normal_y)
ratio[valid] = 1 - normal_y[valid] / no_shadow_y[valid]
mask = np.clip(ratio, 0, 1)
Image.fromarray(np.rint(mask * 65535).astype(np.uint16)).save(root / "shadow-ratio-mask.png")
bright_y, bright_x = map(int, np.unravel_index(mask.argmax(), mask.shape))
report = {
    "formula": "clamp(1 - L(normal Diffuse Direct) / L(no_shadow Diffuse Direct), 0, 1)",
    "luminance_weights": weights.tolist(), "epsilon": epsilon,
    "zero_denominator_policy": "mask=0", "view_transform_applied": False,
    "normal_sha256": hashlib.sha256(normal_path.read_bytes()).hexdigest(),
    "no_shadow_sha256": hashlib.sha256(no_shadow_path.read_bytes()).hexdigest(),
    "mask_png": str(root / "shadow-ratio-mask.png"),
    "size": [96, 96], "normal_y_range": [float(normal_y.min()), float(normal_y.max())],
    "no_shadow_y_range": [float(no_shadow_y.min()), float(no_shadow_y.max())],
    "mask_range": [float(mask.min()), float(mask.max())],
    "valid_denominator_pixels": int(valid.sum()),
    "mask_pixels_above_0_05": int((mask > .05).sum()),
    "mask_pixels_above_0_5": int((mask > .5).sum()),
    "negative_unclamped_pixels": int((ratio < 0).sum()),
    "max_mask_pixel": {"x": bright_x, "y": bright_y,
                       "normal_y": float(normal_y[bright_y, bright_x]),
                       "no_shadow_y": float(no_shadow_y[bright_y, bright_x]),
                       "mask": float(mask[bright_y, bright_x])},
    "scope": "Synthetic opaque cube/ground; program-derived adjustment mask, not adopted",
}
evidence.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
