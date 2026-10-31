"""Windows Blender: use its bundled OCIO configuration, write 16bit RGB PNGs.

Input linear RGB EXRs have no alpha; auxiliary planes stay full-canvas opaque.
The separate Global Alpha Mask records object coverage, not layer transparency.
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy

root = Path(sys.argv[sys.argv.index('--') + 1])
scene = bpy.context.scene
scene.display_settings.display_device = 'sRGB'
scene.view_settings.look = 'None'
scene.view_settings.gamma = 1
scene.render.image_settings.media_type = 'IMAGE'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '16'
report = []
for name in ('Combined', 'Material color', 'Specular Lighting', 'Diffuse Lighting',
             'Refractions', 'Reflections', 'Indirect Lighting'):
    image = bpy.data.images.load(str(root / (name + '.exr')), check_existing=False)
    image.colorspace_settings.name = 'Linear Rec.709'
    # Material color receives the sRGB transfer only, without AgX or exposure.
    scene.view_settings.view_transform = 'Standard' if name == 'Material color' else 'AgX'
    scene.view_settings.exposure = 0
    image.save_render(str(root / (name + '.png')), scene=scene)
    report.append({'name': name, 'view': scene.view_settings.view_transform,
                   'exposure': 0, 'input_space': image.colorspace_settings.name})
    bpy.data.images.remove(image)
# Additional control: an exposure change must affect radiometric images.
image = bpy.data.images.load(str(root / 'Combined.exr'))
scene.view_settings.view_transform = 'AgX'
scene.view_settings.exposure = 1
image.save_render(str(root / 'Combined-exposure1.png'), scene=scene)
config = Path(bpy.utils.system_resource('DATAFILES', path='colormanagement')) / 'config.ocio'
(root / 'transform.json').write_text(json.dumps({
    'blender': bpy.app.version_string, 'ocio_config_sha256': hashlib.sha256(config.read_bytes()).hexdigest(),
    'images': report, 'look': 'None', 'gamma': 1, 'display': 'sRGB',
}, indent=2) + '\n')
