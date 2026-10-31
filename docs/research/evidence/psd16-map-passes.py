"""Research-only EXR -> linear color inputs / uint16 data planes. No artwork."""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import OpenEXR

root = Path(sys.argv[1])
normal, alpha, shadow = [OpenEXR.File(str(root / (name + '.exr')), separate_channels=True)
                         for name in ('normal', 'alpha', 'shadow')]
parts = {p.name().split('.', 1)[-1]: p for p in normal.parts}


def channel(part, key, finite=True):
    value = part.channels[part.name() + "." + key].pixels
    assert value.shape == (128, 192)
    if finite:
        assert np.isfinite(value).all()
    return value


def rgb(name):
    # Missing part/channel raises: never substitute zero for unavailable input.
    return np.stack([channel(parts[name], c) for c in 'RGB'], axis=-1)


def q(value):
    return np.rint(np.clip(value, 0, 1) * 65535).astype(np.uint16)


color = {
    'Combined': rgb('Combined'), 'Material color': rgb('Diffuse Color'),
    'Specular Lighting': rgb('Glossy Direct') * rgb('Glossy Color'),
    'Diffuse Lighting': rgb('Diffuse Direct'),
    'Refractions': (rgb('Transmission Direct') + rgb('Transmission Indirect')) * rgb('Transmission Color'),
    'Reflections': rgb('Glossy Indirect') * rgb('Glossy Color'),
    'Indirect Lighting': rgb('Diffuse Indirect'),
}
data = {}
palette = {0: [0, 0, 0], 1: [65535, 16384, 16384], 2: [16384, 65535, 16384],
           3: [16384, 16384, 65535], 4: [65535, 65535, 16384], 5: [65535, 16384, 65535]}
for name, part in [('Material ID', 'Material Index'), ('Object ID', 'Object Index')]:
    ids = channel(parts[part], 'X')
    assert np.array_equal(ids, np.rint(ids)) and set(np.unique(ids)) <= set(palette)
    data[name] = np.array([palette[int(i)] for i in ids.ravel()], dtype=np.uint16).reshape(128, 192, 3)
z = channel(parts['Depth'], 'Z', finite=False)
assert not np.isnan(z).any() and (z >= 0).all()
# Cycles represents no hit by a large finite sentinel (1e10), clamped to black.
data['Z Depth'] = np.repeat(q((25 - z) / (25 - 5))[..., None], 3, axis=2)
a = channel(next(p for p in alpha.parts if p.name().endswith('.Combined')), 'A')
assert a.min() == 0 and a.max() == 1 and ((a > 0) & (a < 1)).any()
assert np.all(channel(parts['Combined'], 'A') == 1)
data['Global Alpha Mask'] = np.repeat(q(a)[..., None], 3, axis=2)
s = np.stack([channel(next(p for p in shadow.parts if p.name().endswith('.Shadow Catcher')), c)
              for c in 'RGB'], axis=-1)
data['Shadows'] = q(s)
ao_part = parts['Ambient Occlusion']
ao = np.stack([channel(ao_part, c) for c in 'RGB'], axis=-1)
data['Ambient Occlusion'] = q(ao)
np.savez(root / 'data-planes.npz', **data)
report = {'normal_parts': list(parts), 'formulas': {
    'Specular Lighting': 'Glossy Direct * Glossy Color',
    'Refractions': '(Transmission Direct + Transmission Indirect) * Transmission Color',
    'Reflections': 'Glossy Indirect * Glossy Color'},
    'depth_range': [5, 25], 'id_palette': palette, 'alpha': {'min': float(a.min()), 'max': float(a.max()),
    'fractional_samples': int(((a > 0) & (a < 1)).sum())},
    'shadow': {'min': float(s.min()), 'max': float(s.max()), 'above_one': int((s > 1).sum())},
    'linear_inputs': {}, 'source_sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
        for name in ('normal.exr', 'alpha.exr', 'shadow.exr', 'fixture.blend')}}
for name, value in color.items():
    assert np.isfinite(value).all()
    OpenEXR.File({}, {c: value[..., i].copy() for i, c in enumerate('RGB')}).write(str(root / (name + '.exr')))
    report['linear_inputs'][name] = {'min': float(value.min()), 'max': float(value.max()),
                                   'nonzero': int(np.count_nonzero(value))}
# Negative controls: required missing pass is an error; a present all-zero pass is valid.
assert np.array_equal(q(np.zeros((2, 2, 3))), np.zeros((2, 2, 3), dtype=np.uint16))
saved = parts.pop('Transmission Direct')
try:
    rgb('Transmission Direct')
except KeyError:
    report['missing_required_pass_rejected'] = True
else:
    raise AssertionError('Missing required pass accepted')
parts['Transmission Direct'] = saved
report['finite_zero_contribution_accepted'] = True
(root / 'mapping.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
