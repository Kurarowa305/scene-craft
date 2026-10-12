# Research-only: bounded by an external owned-PID stop controller.
import bpy, os, json
from pathlib import Path
root=Path(r"C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe")
scene=bpy.context.scene
scene.render.engine="CYCLES"
scene.cycles.device="CPU"
scene.cycles.samples=100000
scene.cycles.use_adaptive_sampling=False
scene.render.resolution_x=512
scene.render.resolution_y=512
scene.render.resolution_percentage=100
scene.render.threads_mode="FIXED"
scene.render.threads=1
scene.render.filepath=str(root/"render-stop-incomplete.png")
bpy.ops.wm.save_as_mainfile(filepath=str(root/"render-stop-checkpoint.blend"))
def ready(scene):
    (root/"render-stop-ready.json").write_text(json.dumps({"pid":os.getpid(),"token":"scene-craft-issue4-render-stop"}))
bpy.app.handlers.render_init.append(ready)
bpy.ops.render.render(write_still=True)
(root/"render-stop-unexpected-complete.json").write_text("{}")
