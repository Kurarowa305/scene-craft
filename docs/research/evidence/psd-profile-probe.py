"""Research-only: sRGB profile and small PSD/PSB encoding, not color conversion."""
import hashlib
import json
import runpy
import struct
import sys
from pathlib import Path

import numpy as np
import photoshopapi as psapi
from PIL import ImageCms
from psd_tools import PSDImage
from psd_tools.constants import Resource

fixture = runpy.run_path(str(Path(__file__).with_name("psd-probe.py")))
names, width, height = fixture["NAMES"], fixture["WIDTH"], fixture["HEIGHT"]
root, evidence = map(Path, sys.argv[1:])
profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
results = []
for extension, expected_version in [("psd", 1), ("psb", 2)]:
    target = root / f"13-passes-srgb-probe.{extension}"
    if target.exists():
        raise FileExistsError(target)
    document = psapi.LayeredFile_16bit(psapi.enum.ColorMode.rgb, width, height)
    document.icc = np.frombuffer(profile, dtype=np.uint8)
    for index, name in enumerate(names):
        document.add_layer(psapi.ImageLayer_16bit(
            fixture["pixels"](index), name, width=width, height=height,
            pos_x=width / 2, pos_y=height / 2, is_visible=(index == 0),
        ))
    document.write(target, force_overwrite=False)
    parsed = PSDImage.open(target)
    version = struct.unpack(">H", target.read_bytes()[4:6])[0]
    assert version == expected_version and parsed.depth == 16 and len(parsed) == 13
    assert parsed.image_resources.get_data(Resource.ICC_PROFILE) == profile
    for layer in parsed:
        name = layer.name.rstrip("\x00")
        assert layer.visible == (name == "Combined")
        expected = fixture["pixels"](names.index(name))
        checked = []
        for info, channel in zip(layer._record.channel_info, layer._channels):
            index = int(info.id)
            if index in (0, 1, 2):
                actual = np.frombuffer(channel.get_data(width, height, 16, version), dtype=">u2")
                assert np.array_equal(actual.reshape(height, width), expected[index])
                checked.append(index)
        assert sorted(checked) == [0, 1, 2]
    results.append({"path": str(target), "version": version, "depth": parsed.depth,
                    "layers": len(parsed), "profile_exact": True,
                    "rgb_samples_exact": True, "only_combined_visible": True,
                    "bytes": target.stat().st_size})
evidence.write_text(json.dumps({
    "date": "2026-10-12", "profile": "sRGB", "icc_sha256": hashlib.sha256(profile).hexdigest(),
    "results": results,
    "limits": ["Small synthetic files; not a >2GB fallback test",
               "ICC embedding only, not linear-to-sRGB or AgX conversion",
               "No Photoshop display or merged preview test",
               "Names compared after trimming observed terminal NUL"],
}, indent=2) + "\n")
print(json.dumps(results))
