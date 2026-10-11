"""Art review renders for Grask's Rolling Boulder (Blender, headless).

    blender --background --python docs/design/boulder/preview.py

Writes boulder_hero.png (the whole rock beside a figure-height post) and
boulder_shards.png (the pieces it breaks into, thrown outward the way the
runtime throws them). The roll, the dust, the marks on the floor and the throw
back are runtime effects.
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
    reset(); load("boulder_components.glb"); ground((0.16, 0.13, 0.1)); lights(3.2)
    for obj in bpy.context.scene.objects:
        if obj.name.startswith("Boulder_Shard"):
            obj.hide_render = True
        if obj.name == "Boulder_ROOT":
            obj.location.z = 2.3
    figure(3.6, -1.5)
    camera((8, -10, 4.2), (0.6, 0, 2.2), lens=42); render("boulder_hero.png")

    reset(); load("boulder_components.glb"); ground((0.16, 0.13, 0.1)); lights(3.2)
    for obj in bpy.context.scene.objects:
        if obj.name in ("Boulder_Rock", "Boulder_Bands", "Boulder_Cracks"):
            obj.hide_render = True
        if obj.name == "Boulder_ROOT":
            obj.location.z = 2.3
        if obj.name.startswith("Boulder_Shard"):
            out = Vector(obj.location)
            obj.location = out * 2.6
            obj.rotation_euler = (out.x, out.y * 1.7, out.z * 2.3)
    figure(6.5, -1.5)
    camera((11, -14, 6), (0, 0, 2.2), lens=42); render("boulder_shards.png")
