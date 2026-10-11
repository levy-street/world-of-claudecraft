"""Art review renders for the Ice Age pillars (Blender, headless).

    blender --background --python docs/design/ice-age/preview.py

Writes pillars_hero.png (the three variants side by side, with a figure-height
post for scale) and pillars_gameplay.png (roughly the chase camera) beside this
file. The glow here is emission only: the falling, the frost burst, the storm
and the break-up are runtime effects.
"""
import math
import os

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(name):
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, name))


def ground(color, size=60, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    mat = bpy.data.materials.new("ground")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    bpy.context.object.data.materials.append(mat)


def lights(strength):
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = strength
    sun.angle = math.radians(12)
    obj = bpy.data.objects.new("sun", sun)
    obj.rotation_euler = (math.radians(52), 0, math.radians(-38))
    bpy.context.scene.collection.objects.link(obj)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.2, 0.24, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    bpy.context.scene.world = world


def camera(location, target, lens=50):
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    obj = bpy.data.objects.new("cam", cam)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.scene.camera = obj


def render(name, width=1600, height=900):
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = os.path.join(HERE, name)
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)



def spread(step):
    roots = sorted(
        (o for o in bpy.context.scene.objects if o.parent is None and o.type == "EMPTY"),
        key=lambda o: o.name,
    )
    for index, obj in enumerate(roots):
        obj.location.x = step * (index - (len(roots) - 1) / 2)


def figure(x):
    """A two yard post: how tall a player stands beside the ice."""
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=2.0, location=(x, -4.5, 1.0))
    mat = bpy.data.materials.new("figure")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.7, 0.25, 0.2, 1)
    bpy.context.object.data.materials.append(mat)


if __name__ == "__main__":
    reset(); load("ice_pillar_components.glb"); spread(9); ground((0.1, 0.13, 0.17)); lights(3.0)
    figure(-9); figure(0); figure(9)
    camera((0, -30, 9), (0, 0, 4.5), lens=40); render("pillars_hero.png")
    reset(); load("ice_pillar_components.glb"); spread(11); ground((0.16, 0.2, 0.22)); lights(3.2)
    figure(-11); figure(0); figure(11)
    camera((0, -26, 30), (0, -1, 1.5), lens=35); render("pillars_gameplay.png")
