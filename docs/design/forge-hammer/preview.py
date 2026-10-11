"""Art review renders for the Forge Hammer (Blender, headless).

    blender --background --python docs/design/forge-hammer/preview.py

Writes hammer_hero.png and hammer_gameplay.png beside this file, each with a
figure-height post for scale. The glow here is emission only: the fall, the
blow, the ring of fire and the embers are runtime effects.
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




def figure(x, y):
    bpy.ops.mesh.primitive_cylinder_add(radius=0.35, depth=2.0, location=(x, y, 1.0))
    mat = bpy.data.materials.new("figure")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.2, 0.5, 0.75, 1)
    bpy.context.object.data.materials.append(mat)


if __name__ == "__main__":
    reset(); load("forge_hammer_components.glb"); ground((0.1, 0.07, 0.06)); lights(3.0)
    figure(4.5, -2)
    camera((13, -15, 7), (0, 0, 5), lens=40); render("hammer_hero.png")
    reset(); load("forge_hammer_components.glb"); ground((0.14, 0.1, 0.08)); lights(3.2)
    figure(4.5, -2)
    camera((0, -22, 26), (0, -1, 3), lens=35); render("hammer_gameplay.png")
