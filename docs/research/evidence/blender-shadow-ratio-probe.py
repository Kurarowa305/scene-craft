"""Synthetic research: compare raw direct diffuse with/without shadow rays."""
import json
import time
from pathlib import Path

import bpy

root = Path(r"C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe")
bpy.ops.wm.open_mainfile(filepath=str(root / "render-input.blend"))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.cycles.seed = 173
scene.cycles.use_animated_seed = False
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = False
scene.render.resolution_x = 96
scene.render.resolution_y = 96
scene.render.resolution_percentage = 100
scene.render.image_settings.media_type = "MULTI_LAYER_IMAGE"
scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
scene.render.image_settings.color_depth = "32"
view = bpy.context.view_layer
view.use_pass_diffuse_direct = True
view.cycles.use_pass_shadow_catcher = False
meshes = [obj for obj in scene.objects if obj.type == "MESH"]
settings = []
for obj in meshes:
    property_exists = obj.bl_rna.properties.get("visible_shadow") is not None
    if not property_exists:
        raise RuntimeError(f"Missing visible_shadow on {obj.name}")
    settings.append({"name": obj.name, "property_exists": property_exists,
                     "original_visible_shadow": obj.visible_shadow,
                     "original_shadow_catcher": obj.is_shadow_catcher})
    assert not obj.is_shadow_catcher
    assert obj.visible_shadow

timings = {}
for key, enabled in [("normal", True), ("no_shadow", False)]:
    for obj in meshes:
        obj.visible_shadow = enabled
    scene.render.filepath = str(root / f"shadow-ratio-{key}.exr")
    start = time.monotonic()
    bpy.ops.render.render(write_still=True)
    timings[key] = time.monotonic() - start

report = {
    "blender": bpy.app.version_string, "engine": scene.render.engine,
    "device": "CPU", "samples": 64, "seed": 173,
    "adaptive_sampling": False, "denoising": False, "size": [96, 96],
    "input": str(root / "render-input.blend"), "mesh_settings": settings,
    "timings_seconds": timings, "input_saved_over": False,
    "changed_between_renders": "visible_shadow on all mesh objects",
}
(root / "shadow-ratio-render.json").write_text(json.dumps(report, indent=2))
print("SCENE_CRAFT_SHADOW_RATIO=" + json.dumps(report))
