"""Inspect a research EXR without converting its passes to PSD layers."""
import hashlib
import importlib.metadata
import json
import sys
from pathlib import Path

import numpy as np
import OpenEXR

source, target = map(Path, sys.argv[1:])
exr = OpenEXR.File(str(source), separate_channels=True)
parts = []
for part in exr.parts:
    channels = {}
    for name, channel in part.channels.items():
        data = channel.pixels
        channels[name] = {
            "shape": list(data.shape), "dtype": str(data.dtype),
            "min": float(np.min(data)), "max": float(np.max(data)),
            "nonzero_samples": int(np.count_nonzero(data)),
            "all_finite": bool(np.isfinite(data).all()),
        }
    parts.append({"name": part.name(), "channels": channels})
result = {
    "source": str(source), "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "OpenEXR": importlib.metadata.version("OpenEXR"), "part_count": len(parts),
    "parts": parts,
    "scope": "Header/channel inspection only; no Vue-equivalence or PSD mapping claim",
}
target.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"parts": [part["name"] for part in parts]}))
