"""Research fixture only. Windows Blender background; output root after --.

Creates its own scene, never loads artwork. Refuses an existing output directory.
"""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

root = Path(sys.argv[sys.argv.index('--') + 1])
root.mkdir(exist_ok=False)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 32
scene.cycles.seed = 16
scene.render.resolution_x = 192
scene.render.resolution_y = 128
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.15, 0.3, 0.65, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.5
layer = bpy.context.view_layer
for key in ('z', 'object_index', 'material_index', 'diffuse_direct', 'diffuse_indirect',
            'diffuse_color', 'glossy_direct', 'glossy_indirect', 'glossy_color',
            'transmission_direct', 'transmission_indirect', 'transmission_color', 'ambient_occlusion'):
    setattr(layer, 'use_pass_' + key, True)


def material(name, index, color, metallic=0, transmission=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.pass_index = index
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Transmission Weight'].default_value = transmission
    shader.inputs['Roughness'].default_value = 0.15 if metallic or transmission else 0.5
    return mat


def assign(obj, name, index, mat):
    obj.name = name
    obj.pass_index = index
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -1))
ground = assign(bpy.context.object, 'Receiver', 1, material('Ground', 1, (0.4, 0.4, 0.4)))
bpy.ops.mesh.primitive_cube_add(size=1.7, location=(-1.7, 0, 0))
assign(bpy.context.object, 'Diffuse', 2, material('Red', 2, (0.65, 0.025, 0.01)))
for x, name, metallic, transmission in [(0, 'Metal', 1, 0), (1.7, 'Glass', 0, 1)]:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.85, location=(x, 0, 0))
    assign(bpy.context.object, name, 3 if metallic else 4,
           material(name, 3 if metallic else 4, (0.8, 0.9, 0.95), metallic, transmission))
# A finite sky/background board: exclude camera visibility for the mask only.
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 12, 0), rotation=(1.57079632679, 0, 0))
background = assign(bpy.context.object, 'BackgroundBoard', 5, material('SkyBoard', 5, (0.1, 0.3, 0.7)))
bpy.ops.object.light_add(type='AREA', location=(-3, -4, 7))
bpy.context.object.data.energy = 1800
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 3
bpy.ops.object.camera_add(location=(6, -11, 6))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.lens = 45
scene.camera = camera
bpy.ops.wm.save_as_mainfile(filepath=str(root / 'fixture.blend'))


def render(name):
    scene.render.image_settings.media_type = 'MULTI_LAYER_IMAGE'
    scene.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    scene.render.image_settings.color_depth = '32'
    scene.render.filepath = str(root / (name + '.exr'))
    bpy.ops.render.render(write_still=True)


render('normal')
scene.render.image_settings.media_type = 'IMAGE'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_depth = '16'
scene.render.image_settings.color_mode = 'RGB'
bpy.data.images['Render Result'].save_render(str(root / 'combined-reference.png'), scene=scene)
scene.render.film_transparent = True
background.visible_camera = False
render('alpha')
# For receiver comparison restore normal board; work only in this process.
background.visible_camera = True
ground.is_shadow_catcher = True
layer.cycles.use_pass_shadow_catcher = True
render('shadow')
(root / 'render.json').write_text(json.dumps({
    'blender': bpy.app.version_string, 'build_hash': bpy.app.build_hash.decode(),
    'engine': 'CYCLES', 'device': 'CPU', 'samples': 32, 'size': [192, 128],
    'view_transform': scene.view_settings.view_transform, 'look': scene.view_settings.look,
    'exposure': 0, 'gamma': 1, 'display': scene.display_settings.display_device,
    'background_objects': ['BackgroundBoard'], 'receivers': ['Receiver'],
    'depth_range': [5.0, 25.0], 'ao_distance': scene.world.light_settings.distance,
    'object_indices': {o.name: o.pass_index for o in scene.objects if o.type == 'MESH'},
    'material_indices': {m.name: m.pass_index for m in bpy.data.materials if m.users},
}, indent=2) + '\n')
