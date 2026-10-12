"""Synthetic research experiment; not a production PSD exporter.

Run with the isolated environment described in ../psd-export-validation.md.
No Blender/Photoshop application calls or real artwork are involved.
"""
import argparse
import hashlib
import importlib.metadata
import json
import platform
import struct
from pathlib import Path

import numpy as np
import photoshopapi as psapi
from psd_tools import PSDImage

NAMES = [
    "Combined", "Material ID", "Object ID", "Material color",
    "Specular Lighting", "Diffuse Lighting", "Z Depth", "Global Alpha Mask",
    "Shadows", "Refractions", "Reflections", "Indirect Lighting",
    "Ambient Occlusion",
]
WIDTH, HEIGHT = 32, 24


def pixels(index):
    # Deliberately contains values not representable by an 8-bit expansion.
    ramp = np.arange(WIDTH * HEIGHT, dtype=np.uint32).reshape(HEIGHT, WIDTH)
    return np.stack([
        (ramp * 67 + index * 1237 + channel * 823) % 65536
        for channel in range(3)
    ]).astype(np.uint16)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output_psd", type=Path)
    parser.add_argument("evidence_json", type=Path)
    args = parser.parse_args()
    args.output_psd.parent.mkdir(parents=True, exist_ok=True)
    document = psapi.LayeredFile_16bit(psapi.enum.ColorMode.rgb, WIDTH, HEIGHT)
    for index, name in enumerate(NAMES):
        layer = psapi.ImageLayer_16bit(
            pixels(index), name, width=WIDTH, height=HEIGHT,
            pos_x=WIDTH / 2, pos_y=HEIGHT / 2,
            is_visible=(name == "Combined"),
        )
        document.add_layer(layer)
    raw_path = args.output_psd.with_suffix(".raw.psd")
    document.write(raw_path, force_overwrite=False)
    raw_parsed = PSDImage.open(raw_path)
    raw_names = [layer.name for layer in raw_parsed]
    # 0.9.1 writes a terminal NUL in Unicode layer names. Preserve the
    # raw result and explicitly normalize names with the second library.
    for layer in raw_parsed:
        layer.name = layer.name.rstrip("\x00")
    if args.output_psd.exists():
        raise FileExistsError(args.output_psd)
    raw_parsed.save(args.output_psd)

    binary = args.output_psd.read_bytes()
    signature, version, _, channels, height, width, depth, color = struct.unpack(
        ">4sH6sHIIHH", binary[:26]
    )
    assert (signature, version, width, height, depth, color) == (
        b"8BPS", 1, WIDTH, HEIGHT, 16, 3,
    )
    # Independent parser: inspect stored channel samples, avoiding PIL's
    # display-oriented conversion to an 8-bit image.
    parsed = PSDImage.open(args.output_psd)
    assert len(parsed) == len(NAMES)
    assert {layer.name for layer in parsed} == set(NAMES)
    evidence_layers = []
    for layer in parsed:
        assert layer.kind == "pixel"
        assert layer.visible == (layer.name == "Combined")
        assert layer.bbox == (0, 0, WIDTH, HEIGHT), layer.bbox
        expected = pixels(NAMES.index(layer.name))
        channel_results = []
        for info, data in zip(layer._record.channel_info, layer._channels):
            if int(info.id) not in (0, 1, 2):
                continue
            raw = data.get_data(WIDTH, HEIGHT, depth, version)
            actual = np.frombuffer(raw, dtype=">u2").reshape(HEIGHT, WIDTH)
            assert np.array_equal(actual, expected[int(info.id)])
            channel_results.append(int(info.id))
        assert sorted(channel_results) == [0, 1, 2]
        evidence_layers.append({
            "name": layer.name, "visible": layer.visible, "kind": layer.kind,
            "bbox": list(layer.bbox), "rgb_16bit_samples_exact": True,
        })
    evidence = {
        "experiment_date": "2026-10-12", "platform": platform.platform(),
        "python": platform.python_version(),
        "packages": {name: importlib.metadata.version(name)
                     for name in ["PhotoshopAPI", "psd-tools", "numpy"]},
        "output_psd": str(args.output_psd.resolve()),
        "raw_psd": str(raw_path.resolve()),
        "raw_layer_names": raw_names,
        "name_normalization": "psd-tools rstrip terminal NUL and re-save",
        "sha256": hashlib.sha256(binary).hexdigest(), "bytes": len(binary),
        "header": {"version": version, "channels": channels, "width": width,
                   "height": height, "depth": depth, "color_mode": "RGB"},
        "layer_count": len(evidence_layers),
        "layers_parser_order_bottom_to_top": evidence_layers,
        "checks": {"header_16bit_rgb_psd": True, "exact_names": True,
                   "only_combined_visible": True, "all_rgb_samples_exact": True},
        "limitations": [
            "Synthetic 32x24 RGB arrays only; no real render passes",
            "Photoshop application has not opened or validated the file",
            "No ICC profile or alpha-channel preservation experiment",
            "PhotoshopAPI documents no valid merged preview; not repaired here",
            "No large-file/performance or PSD size-limit validation",
        ],
    }
    args.evidence_json.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"result": "pass", "layer_count": len(parsed),
                      "depth": depth, "output": str(args.output_psd)}))


if __name__ == "__main__":
    main()
