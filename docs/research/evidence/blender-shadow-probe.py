"""Research only: load the synthetic fixture; designate one shadow receiver."""
import json
import os
import time
from pathlib import Path

import bpy

root = Path(r"C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe")
bpy.ops.wm.open_mainfile(filepath=str(root / "render-input.blend"))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.render.resolution_x = 96
scene.render.resolution_y = 96
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
receiver = bpy.data.objects["Probe_Ground"]
receiver.is_shadow_catcher = True
bpy.context.view_layer.cycles.use_pass_shadow_catcher = True
scene.render.image_settings.media_type = "MULTI_LAYER_IMAGE"
scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
scene.render.image_settings.color_depth = "32"
scene.render.filepath = str(root / "shadow-catcher-passes.exr")
start = time.monotonic()
bpy.ops.render.render(write_still=True)
report = {
    "blender": bpy.app.version_string,
    "engine": scene.render.engine, "device": scene.cycles.device,
    "samples": scene.cycles.samples, "size": [96, 96],
    "pid": os.getpid(), "seconds": time.monotonic() - start,
    "input": str(root / "render-input.blend"),
    "output": scene.render.filepath, "receiver_objects": [receiver.name],
    "use_pass_shadow_catcher": bpy.context.view_layer.cycles.use_pass_shadow_catcher,
    "input_saved_over": False,
}
(root / "shadow-catcher-render.json").write_text(json.dumps(report, indent=2))
print("SCENE_CRAFT_SHADOW=" + json.dumps(report))
