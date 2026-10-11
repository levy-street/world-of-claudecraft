"""Art review renders for the Bone Reaper assets (Blender, headless).

    blender --background --python docs/design/bone-reaper/preview.py

Writes scythe_hero.png (three-quarter close), scythe_top.png (straight down, the
way the hitbox is laid out), scythe_gameplay.png (roughly the chase camera) and
soul_hero.png beside this file. The glow here is emission only: the trail, the
ground scrape, the wisps and the soul's light are runtime effects.
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


def lift(z):
    for obj in bpy.context.scene.objects:
        if obj.parent is None and obj.type == "EMPTY":
            obj.location.z = z


if __name__ == "__main__":
    reset(); load("scythe_components.glb"); lift(1.15); ground((0.09, 0.1, 0.09)); lights(3.0)
    camera((7.5, -1.5, 5.2), (2.2, -6.2, 1.0), lens=38); render("scythe_hero.png")
    reset(); load("scythe_components.glb"); lift(1.15); ground((0.09, 0.1, 0.09)); lights(3.0)
    camera((1.5, -3.6, 17), (1.5, -3.6, 0), lens=40); render("scythe_top.png")
    reset(); load("scythe_components.glb"); lift(1.15); ground((0.2, 0.24, 0.16)); lights(3.2)
    camera((0, 12, 15), (1.0, -3.5, 0.5), lens=35); render("scythe_gameplay.png")
    reset(); load("soul_components.glb"); ground((0.07, 0.08, 0.09)); lights(1.6)
    camera((1.9, -3.3, 1.5), (0, 0.25, 1.0), lens=60); render("soul_hero.png", 900, 900)
