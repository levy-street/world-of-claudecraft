"""Art review renders for the Abyssal Maw's tentacles (Blender, headless).

    blender --background --python docs/design/tentacles/preview.py

Writes tentacle_hero.png (one tentacle standing over its broken floor) and
tentacle_poses.png (standing, reared for the lash, landed, low for the sweep)
beside this file, each with a figure-height post for scale.

The game never ships a posed tentacle: the runtime bends a chain of the ONE
segment every frame (src/render/hoard_tentacles_core.ts). chain() below is that
file's pose maths, copied, so these renders are what the game draws.
"""
import math
import os

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
LINKS = 16
LENGTH = 11.0
BASE_RADIUS = 1.0
TIP_RADIUS = 0.3
HALF_PI = math.pi / 2


def smooth(v):
    t = min(1.0, max(0.0, v))
    return t * t * (3 - 2 * t)


def idle_pitch(s):
    return 0.16 + 0.5 * s ** 1.5 + 1.5 * max(0.0, s - 0.7) ** 1.3


def rear_pitch(s):
    return -0.8 * s ** 0.85 + 1.1 * max(0.0, s - 0.78)


def flat_pitch(s, bend_share, droop):
    return (HALF_PI + droop) * smooth(s / bend_share)


POSES = {
    # name: (rear, slam, low, stretch)
    'idle': (0, 0, 0, 1.0),
    'rear': (1, 0, 0, 1.06),
    'slam': (0, 1, 0, 1.5),
    'low': (0, 0, 1, 0.83),
}


def chain(pose, heading, sway=0.0):
    rear, slam, low, stretch = POSES[pose]
    calm = 1 - max(rear, slam, low)
    step = LENGTH / LINKS * stretch
    x = y = z = 0.0
    out = []
    for link in range(LINKS):
        s = (link + 0.5) / LINKS
        pitch = idle_pitch(s) * calm + rear_pitch(s) * rear + flat_pitch(s, 0.24, 0.5) * slam + flat_pitch(s, 0.3, 0.2) * low
        pitch += calm * 0.12 * math.sin(sway + s * 2.6)
        h = heading + calm * 0.4 * s * math.sin(sway * 0.7 + s * 1.7)
        radius = BASE_RADIUS + (TIP_RADIUS - BASE_RADIUS) * s ** 0.85
        floor = radius * 0.55
        if z <= floor + 1e-3 and link > 0:
            z = floor
            pitch = min(pitch, HALF_PI)
        out.append((x, y, z, pitch, h, radius, step))
        x += math.sin(h) * math.sin(pitch) * step
        y += math.cos(h) * math.sin(pitch) * step
        z += math.cos(pitch) * step
    return out, (x, y, max(z, 0.2), out[-1][3], out[-1][4])


def basis(pitch, heading):
    axis = Vector((math.sin(heading) * math.sin(pitch), math.cos(heading) * math.sin(pitch), math.cos(pitch)))
    belly = Vector((math.sin(heading) * math.cos(pitch), math.cos(heading) * math.cos(pitch), -math.sin(pitch)))
    # The segment is authored axis +Z, belly -Y.
    local_y = -belly
    local_x = local_y.cross(axis)
    return local_x, local_y, axis


def place(source, origin, position, pitch, heading, radius, length):
    lx, ly, lz = basis(pitch, heading)
    m = Matrix((
        (lx.x * radius, ly.x * radius, lz.x * length, origin[0] + position[0]),
        (lx.y * radius, ly.y * radius, lz.y * length, origin[1] + position[1]),
        (lx.z * radius, ly.z * radius, lz.z * length, origin[2] + position[2]),
        (0, 0, 0, 1),
    ))
    copy = source.copy()
    copy.parent = None
    bpy.context.scene.collection.objects.link(copy)
    copy.matrix_world = m
    return copy


def tentacle(parts, origin, pose, heading, sway=0.0):
    links, tip = chain(pose, heading, sway)
    for x, y, z, pitch, h, radius, step in links:
        place(parts['Tentacle_Seg'], origin, (x, y, z), pitch, h, radius, step * 1.22)
    r = links[-1][5] * 0.94
    place(parts['Tentacle_Tip'], origin, tip[:3], tip[3], tip[4], r, r)
    for name in ('Tentacle_Rubble', 'Tentacle_Pool'):
        copy = parts[name].copy()
        copy.parent = None
        bpy.context.scene.collection.objects.link(copy)
        copy.matrix_world = Matrix.Translation(origin)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load():
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, 'tentacle_components.glb'))
    parts = {obj.name: obj for obj in bpy.context.scene.objects if obj.type == 'MESH'}
    for obj in parts.values():
        obj.hide_render = True
        obj.hide_viewport = True
    return parts


def unhide_copies():
    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH' and '.' in obj.name:
            obj.hide_render = False
            obj.hide_viewport = False


def ground(color, size=90, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    mat = bpy.data.materials.new('ground')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    bpy.context.object.data.materials.append(mat)


def lights(strength):
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = strength
    sun.angle = math.radians(12)
    obj = bpy.data.objects.new('sun', sun)
    obj.rotation_euler = (math.radians(52), 0, math.radians(-38))
    bpy.context.scene.collection.objects.link(obj)
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.1, 0.17, 0.2, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    bpy.context.scene.world = world


def camera(location, target, lens=50):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    obj = bpy.data.objects.new('cam', cam)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.scene.camera = obj


def render(name, width=1600, height=900):
    scene = bpy.context.scene
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = os.path.join(HERE, name)
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)


def figure(x, y):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=2.0, location=(x, y, 1.0))
    mat = bpy.data.materials.new('figure')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.85, 0.55, 0.2, 1)
    bpy.context.object.data.materials.append(mat)


if __name__ == '__main__':
    reset()
    parts = load()
    tentacle(parts, (0, 0, 0), 'idle', math.radians(-100), sway=0.8)
    unhide_copies()
    ground((0.07, 0.09, 0.1))
    lights(3.0)
    figure(3.6, -2.4)
    camera((-15, -17, 7), (-2, 0, 4.6), lens=32)
    render('tentacle_hero.png')

    reset()
    parts = load()
    for i, pose in enumerate(('idle', 'rear', 'slam', 'low')):
        tentacle(parts, (i * 20 - 38, 0, 0), pose, math.radians(90), sway=0.4 + i)
        figure(i * 20 - 38 - 3.4, -2.6)
    unhide_copies()
    ground((0.07, 0.09, 0.1), size=260)
    lights(3.0)
    camera((-2, -62, 22), (-2, 0, 3), lens=42)
    render('tentacle_poses.png', width=2000, height=800)
