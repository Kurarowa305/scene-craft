"""Research-only packaging: real passes, normalized names, exact merged RGB.

Pinned internal psd-tools API; deliberately no compositor or 8bit PIL conversion.
Final output is published by rename only after independent parsing succeeds.
"""
import hashlib
import importlib.metadata
import json
import platform
import resource
import struct
import sys
import time
import zlib
from pathlib import Path

import numpy as np
import png
import photoshopapi as psapi
from PIL import ImageCms
from psd_tools import PSDImage
from psd_tools.constants import Compression, Resource
from psd_tools.psd.image_resources import ImageResource, VersionInfo

NAMES = ['Combined', 'Material ID', 'Object ID', 'Material color',
         'Specular Lighting', 'Diffuse Lighting', 'Z Depth', 'Global Alpha Mask',
         'Shadows', 'Refractions', 'Reflections', 'Indirect Lighting', 'Ambient Occlusion']
WIDTH, HEIGHT = 192, 128
root = Path(sys.argv[1])


def png16(name):
    w, h, rows, info = png.Reader(filename=str(root / (name + '.png'))).read()
    assert (w, h, info['bitdepth'], info['planes']) == (WIDTH, HEIGHT, 16, 3)
    return np.vstack([np.asarray(row, dtype=np.uint16) for row in rows]).reshape(h, w, 3)


planes = dict(np.load(root / 'data-planes.npz'))
for name in NAMES:
    if name not in planes:
        planes[name] = png16(name)
combined = planes['Combined']
reference = png16('combined-reference')
difference = np.abs(combined.astype(np.int32) - reference.astype(np.int32))
assert difference.max() <= 1, difference.max()
assert not np.array_equal(png16('Combined-exposure1'), combined)
# Validate Standard / sRGB transfer independently, away from transfer breakpoints.
import OpenEXR
mat = OpenEXR.File(str(root / 'Material color.exr'), separate_channels=True)
rgb = np.stack([mat.channels()[c].pixels for c in 'RGB'], axis=-1)
encoded = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.maximum(rgb, 0) ** (1 / 2.4) - 0.055)
expected_mat = np.rint(np.clip(encoded, 0, 1) * 65535).astype(np.int32)
mat_difference = np.abs(planes['Material color'].astype(np.int32) - expected_mat)
assert mat_difference.max() <= 2, mat_difference.max()
profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
(root / 'srgb.icc').write_bytes(profile)
results = []
start = time.monotonic()
for extension, version in [('psd', 1), ('psb', 2)]:
    target = root / ('13-passes.' + extension)
    if target.exists():
        raise FileExistsError(target)
    raw = root / ('13-passes.raw.' + extension)
    document = psapi.LayeredFile_16bit(psapi.enum.ColorMode.rgb, WIDTH, HEIGHT)
    document.icc = np.frombuffer(profile, dtype=np.uint8)
    # PhotoshopAPI reverses insertion in parser order; Combined ends up on top.
    for name in NAMES:
        document.add_layer(psapi.ImageLayer_16bit(
            np.ascontiguousarray(planes[name].transpose(2, 0, 1)), name,
            width=WIDTH, height=HEIGHT, pos_x=WIDTH / 2, pos_y=HEIGHT / 2,
            is_visible=(name == 'Combined')))
    document.write(raw, force_overwrite=False)
    parsed = PSDImage.open(raw)
    assert parsed._record.header.channels == 3
    raw_merged_nonzero = any(any(channel) for channel in parsed._record.image_data.get_data(parsed._record.header))
    assert not raw_merged_nonzero
    for layer, name in zip(parsed, reversed(NAMES), strict=True):
        assert layer.name == name + '\x00'
        layer.name = name  # Set expected exact name, not unconditional rstrip.
    parsed._record.image_data.compression = Compression.ZIP
    parsed._record.image_data.set_data(
        [np.ascontiguousarray(combined[..., i], dtype='>u2').tobytes() for i in range(3)],
        parsed._record.header)
    parsed.image_resources[Resource.VERSION_INFO] = ImageResource(
        key=Resource.VERSION_INFO,
        data=VersionInfo(has_composite=True, writer='scene-craft research', reader='Photoshop'))
    staging = root / ('13-passes.staging.' + extension)
    with staging.open('xb') as stream:
        parsed._record.write(stream)
    check = PSDImage.open(staging)
    assert check.depth == 16 and check.size == (WIDTH, HEIGHT)
    assert check._record.header.version == version
    assert check._record.header.color_mode == 3
    assert check._record.header.channels == 3
    assert [layer.name for layer in check] == list(reversed(NAMES))
    assert check.image_resources.get_data(Resource.ICC_PROFILE) == profile
    assert check.image_resources.get_data(Resource.VERSION_INFO).has_composite
    samples = 0
    for layer in check:
        assert layer.kind == 'pixel' and layer.bbox == (0, 0, WIDTH, HEIGHT)
        assert layer.visible == (layer.name == 'Combined') and layer.opacity == 255
        assert layer.blend_mode.value == b'norm'
        ids = []
        for info, channel in zip(layer._record.channel_info, layer._channels, strict=True):
            if int(info.id) in (0, 1, 2):
                index = int(info.id)
                actual = np.frombuffer(channel.get_data(WIDTH, HEIGHT, 16, version), dtype='>u2').reshape(HEIGHT, WIDTH)
                assert np.array_equal(actual, planes[layer.name][..., index])
                ids.append(index)
                samples += actual.size
        assert sorted(ids) == [0, 1, 2]
    for index, channel in enumerate(check._record.image_data.get_data(check._record.header)):
        actual = np.frombuffer(channel, dtype='>u2').reshape(HEIGHT, WIDTH)
        assert np.array_equal(actual, combined[..., index])
    assert len(check) == 13
    # Independent stdlib-only walk of PSD section lengths and merged ZIP data.
    with staging.open('rb') as stream:
        header = stream.read(26)
        assert struct.unpack('>4sH6sHIIHH', header) == (
            b'8BPS', version, bytes(6), 3, HEIGHT, WIDTH, 16, 3)
        for width in (4, 4, 8 if version == 2 else 4):
            length = int.from_bytes(stream.read(width), 'big')
            stream.seek(length, 1)
        assert int.from_bytes(stream.read(2), 'big') == 2  # ZIP without prediction
        merged_bytes = zlib.decompress(stream.read())
    expected_merged = b''.join(np.ascontiguousarray(combined[..., i], dtype='>u2').tobytes()
                               for i in range(3))
    assert merged_bytes == expected_merged
    # Truncation must fail structural/sample verification; header-only is insufficient.
    broken = root / ('truncated.' + extension)
    broken.write_bytes(staging.read_bytes()[:80])
    try:
        bad = PSDImage.open(broken)
        assert len(bad) == 13
        bad._record.image_data.get_data(bad._record.header)
    except Exception:
        truncated_rejected = True
    else:
        raise AssertionError('Truncated file accepted')
    broken.unlink()
    staging.rename(target)
    results.append({'path': str(target), 'bytes': target.stat().st_size,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'version': version,
        'depth': 16, 'layers': 13, 'rgb_samples_exact': samples,
        'exact_names': True, 'only_combined_visible': True, 'icc_exact': True,
        'merged_rgb16_exact': True, 'stdlib_merged_rgb16_exact': True, 'raw_merged_was_zero': not raw_merged_nonzero,
        'truncated_rejected': truncated_rejected})
# Threshold decisions are pure metadata tests, not 2GB writes.
PSD_LIMIT = 2_000_000_000  # conservative decimal boundary below 2 GiB


def choose_format(w, h, estimated_upper_bytes):
    if min(w, h) < 1 or max(w, h) > 300000:
        raise ValueError('PSB dimension limit')
    return 'psb' if max(w, h) > 30000 or estimated_upper_bytes >= PSD_LIMIT else 'psd'


assert choose_format(30000, 1, 0) == 'psd'
assert choose_format(30001, 1, 0) == 'psb'
assert choose_format(1, 1, PSD_LIMIT - 1) == 'psd'
assert choose_format(1, 1, PSD_LIMIT) == 'psb'
try:
    choose_format(300001, 1, 0)
except ValueError:
    pass
else:
    raise AssertionError('PSB dimension limit ignored')
report = {
    'date': '2026-10-31', 'python': platform.python_version(), 'platform': platform.platform(),
    'packages': {n: importlib.metadata.version(n) for n in
                 ['PhotoshopAPI', 'psd-tools', 'numpy', 'OpenEXR', 'pypng', 'pillow']},
    'combined_reference_max_u16_error': int(difference.max()),
    'material_srgb_formula_max_u16_error': int(mat_difference.max()),
    'exposure_change_observed': True, 'format_threshold_unit_checks': True,
    'icc_sha256': hashlib.sha256(profile).hexdigest(), 'results': results,
    'seconds_package_and_verify': time.monotonic() - start,
    'peak_process_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    'limits': ['Small 192x128 synthetic scene, not artwork', 'No Photoshop application used',
               'No >2GB actual file or production memory validation',
               'No volume/transparent-cutout alpha quality validation',
               'All layers full-canvas opaque RGB; Global Alpha Mask is a separate gray RGB image',
               'No general compositor effects; Combined uses raw render and recorded view transform',
               'Scene-specific fixed ID palette, not production persistent-ID allocation'],
}
(root / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
