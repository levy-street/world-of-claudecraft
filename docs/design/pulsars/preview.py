"""Art review renders for the Bound Pulsar orb (Blender, headless).

    blender --background --python docs/design/pulsars/preview.py

Writes orb_hero.png (close) and orb_pair.png (two orbs beside a figure-height
post, roughly as they ride a boss's shoulders) beside this file. The glow here is
emission only: the spin, the beams, the links and the break-up are runtime.
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




def place(z, x=0.0, scale=1.0, clone=False):
    roots = [o for o in bpy.context.scene.objects if o.parent is None and o.type == "EMPTY"]
    for obj in roots:
        obj.location = (x, 0, z)
        obj.scale = (scale, scale, scale)


def figure(x, height=2.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=height, location=(x, 0, height / 2))
    mat = bpy.data.materials.new("figure")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.7, 0.25, 0.2, 1)
    bpy.context.object.data.materials.append(mat)


if __name__ == "__main__":
    reset(); load("pulsar_components.glb"); place(1.6); ground((0.05, 0.06, 0.1)); lights(1.2)
    camera((2.9, -3.2, 3.0), (0, 0, 1.6), lens=55); render("orb_hero.png", 1200, 1200)
    reset(); load("pulsar_components.glb"); place(2.6, x=2.2); ground((0.07, 0.08, 0.12)); lights(1.6)
    figure(0)
    camera((1.2, -9, 3.2), (1.1, 0, 1.8), lens=45); render("orb_pair.png")
