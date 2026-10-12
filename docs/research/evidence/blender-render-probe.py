# Research-only probe; synthetic scene, never load user artwork.
import bpy, json, os, time
from pathlib import Path
root=Path(r"C:\Users\oy_ta\AppData\Local\Temp\scene-craft-issue4-probe")
scene=bpy.context.scene
scene.render.engine="CYCLES"
scene.cycles.device="CPU"
scene.cycles.samples=4
scene.render.resolution_x=96
scene.render.resolution_y=96
scene.render.resolution_percentage=100
scene.render.film_transparent=True
layer=bpy.context.view_layer
for name in ("z","object_index","material_index","diffuse_direct","diffuse_indirect","diffuse_color","glossy_direct","glossy_indirect","glossy_color","transmission_direct","transmission_indirect","transmission_color","ambient_occlusion","shadow"):
    setattr(layer,"use_pass_"+name,True)
cube=bpy.data.objects["Cube"]
cube.pass_index=1
cube.data.materials.clear()
mat=bpy.data.materials.new("Probe_Red")
mat.use_nodes=True
mat.pass_index=1
mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value=(0.6,0.08,0.03,1)
cube.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-1))
floor=bpy.context.object
floor.name="Probe_Ground"
floor.pass_index=2
floor_mat=bpy.data.materials.new("Probe_Ground_Material")
floor_mat.use_nodes=True
floor_mat.pass_index=2
floor.data.materials.append(floor_mat)
scene.render.image_settings.media_type="MULTI_LAYER_IMAGE"
scene.render.image_settings.file_format="OPEN_EXR_MULTILAYER"
scene.render.image_settings.color_depth="32"
scene.render.filepath=str(root/"render-passes.exr")
bpy.ops.wm.save_as_mainfile(filepath=str(root/"render-input.blend"))
started=time.monotonic()
bpy.ops.render.render(write_still=True)
scene.render.image_settings.media_type="IMAGE"
scene.render.image_settings.file_format="PNG"
scene.render.image_settings.color_mode="RGBA"
scene.render.image_settings.color_depth="16"
bpy.data.images["Render Result"].save_render(str(root/"combined.png"),scene=scene)
bpy.ops.wm.save_as_mainfile(filepath=str(root/"render-output.blend"))
report={"blender":bpy.app.version_string,"pid":os.getpid(),"engine":scene.render.engine,"size":[96,96],"seconds":time.monotonic()-started,"exr_bytes":(root/"render-passes.exr").stat().st_size,"png_bytes":(root/"combined.png").stat().st_size,"scene_saved":True,"view_transform":scene.view_settings.view_transform,"display_device":scene.display_settings.display_device}
(root/"render-probe.json").write_text(json.dumps(report,indent=2))
print("SCENE_CRAFT_RESULT="+json.dumps(report))
