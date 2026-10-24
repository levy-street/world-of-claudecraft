"""Review stage for the Great Saurian (adapted from the Balgath kit): lights, ground, a player-sized reference figure, the
camera rig, and still/sequence rendering. Authoring aid only; nothing here ships.

The player reference is a 2.6-yard figure (HUMANOID_H in the render manifest), so
every render shows him at the scale a raid sees him. When the KayKit knight has
been decoded to a Blender-readable GLB (`--knight path`), the knight stands in
for the capsule.
"""
import math
import os

import bpy
from mathutils import Vector


def _sun(scene, name, energy, rot, color=(1, 1, 1), angle=0.03):
    light = bpy.data.lights.new(name, 'SUN')
    light.energy = energy
    light.color = color
    light.angle = angle
    obj = bpy.data.objects.new(name, light)
    obj.rotation_euler = rot
    scene.collection.objects.link(obj)
    return obj


def setup(res=(1280, 960), knight=None, ref_at=(5.8, -7.0, 0.0), ground=True, sky=(0.2, 0.22, 0.27),
          engine='EEVEE', exposure=0.0, ref_height=2.6):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('stage')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (*sky, 1)
    bg.inputs[1].default_value = 0.55
    scene.world = world
    _sun(scene, 'key', 5.2, (math.radians(50), math.radians(8), math.radians(150)), (1.0, 0.93, 0.84))
    _sun(scene, 'fill', 0.9, (math.radians(62), 0, math.radians(-55)), (0.62, 0.74, 1.0), angle=0.4)
    _sun(scene, 'rim', 3.6, (math.radians(72), 0, math.radians(12)), (0.8, 0.92, 1.0))
    if ground:
        me = bpy.data.meshes.new('ground')
        s = 400
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new('ground', me)
        mat = bpy.data.materials.new('groundmat')
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (0.07, 0.08, 0.05, 1)
        bsdf.inputs['Roughness'].default_value = 0.95
        me.materials.append(mat)
        scene.collection.objects.link(g)
    if knight:
        place_knight(knight, ref_at, ref_height)
    else:
        player_capsule(ref_at, ref_height)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 45
    cam.data.clip_end = 2000
    scene.collection.objects.link(cam)
    scene.camera = cam
    if engine == 'CYCLES':
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = 64
        scene.cycles.use_denoising = True
        use_gpu(scene)
    else:
        scene.render.engine = 'BLENDER_EEVEE'
        try:
            scene.eevee.use_shadows = True
            scene.eevee.use_raytracing = True
        except AttributeError:
            pass
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = exposure
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    return cam


def use_gpu(scene):
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                if any(d.type == backend for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == backend
                    scene.cycles.device = 'GPU'
                    return backend
            except TypeError:
                continue
    except Exception:  # noqa: BLE001
        pass
    scene.cycles.device = 'CPU'
    return 'CPU'


def player_capsule(at, height=2.6):
    mat = bpy.data.materials.new('refmat')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.75, 0.12, 0.1, 1)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.14, location=(at[0], at[1], height * 0.86))
    a = bpy.context.active_object
    bpy.ops.mesh.primitive_cylinder_add(radius=height * 0.16, depth=height * 0.62, location=(at[0], at[1], height * 0.41))
    b = bpy.context.active_object
    for p in (a, b):
        p.data.materials.append(mat)
        p.name = 'PlayerReference'


def place_knight(path, at, height=2.6):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in list(new):
        if o.type == 'MESH' and o.parent is None and o.name.startswith('Icosphere'):
            new.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    for o in new:
        o.animation_data_clear()
        if o.type == 'ARMATURE':
            for pb in o.pose.bones:
                pb.matrix_basis.identity()
        o.name = 'Knight_' + o.name
    root = [o for o in new if o.parent is None][0]
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    zs = []
    for m in (o for o in new if o.type == 'MESH'):
        ev = m.evaluated_get(dg)
        zs += [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    k = height / (max(zs) - min(zs))
    root.scale = tuple(x * k for x in root.scale)
    root.location = (at[0], at[1], at[2] - min(zs) * k)
    pass  # facing left as imported
    return new


def aim(cam, az, el, dist, focus, lens=None):
    """az 0 looks at his face (camera on -Y), positive az orbits toward his left (+X)."""
    a, e = math.radians(az), math.radians(el)
    f = Vector(focus)
    cam.location = f + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (f - cam.location).to_track_quat('-Z', 'Y').to_euler()
    if lens:
        cam.data.lens = lens


def still(path):
    scene = bpy.context.scene
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


STANDARD_VIEWS = (
    # name, az, el, dist, focus, lens
    ('front', 0, 8, 62, (0.0, -1.0, 7.0), 45),
    ('threeq', 38, 12, 66, (0.0, 1.5, 7.0), 45),
    ('side', 90, 6, 66, (0.0, 2.5, 7.0), 45),
    ('back', 160, 10, 64, (0.0, 2.0, 7.0), 45),
    ('face', 40, 6, 11.0, (0.0, -10.6, 13.7), 50),
    ('low', 25, -2, 40, (0.0, -2.0, 8.5), 28),
)


def clay(objects, color=(0.55, 0.52, 0.48)):
    mat = bpy.data.materials.new('clay')
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = 0.62
    for o in objects:
        o.data.materials.clear()
        o.data.materials.append(mat)
    return mat
