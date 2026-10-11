"""Small editable native Blender building blocks for the art scene."""
import math
import random
import bpy
from mathutils import Vector


def collection(name, parent):
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def attach(obj, name, coll, parent=None):
    obj.name = name
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    coll.objects.link(obj)
    obj.parent = parent
    return obj


def empty(name, coll, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    coll.objects.link(obj)
    obj.parent = parent
    obj.location = location
    obj.empty_display_size = 0.25
    return obj


def material(name, color, emission=0, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = 0.38
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def ico(name, coll, parent, location, scale, mat, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1)
    obj = attach(bpy.context.object, name, coll, parent)
    obj.location = location
    obj.scale = scale
    obj.data.materials.append(mat)
    return obj


def curves(name, paths, width, mat, coll, parent=None):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 1
    data.bevel_depth = width
    data.bevel_resolution = 0
    data.resolution_u = 1
    data.use_fill_caps = True
    for path in paths:
        spline = data.splines.new('POLY')
        spline.points.add(len(path) - 1)
        for i, point in enumerate(path):
            spline.points[i].co = (*point, 1)
            # Taper branches and give open filaments sharp ends.
            spline.points[i].radius = 0.25 if i in (0, len(path) - 1) else 1
    obj = bpy.data.objects.new(name, data)
    coll.objects.link(obj)
    obj.parent = parent
    data.materials.append(mat)
    return obj


def ring(radius, z=0, start=0, sweep=math.tau, points=64):
    return [(radius * math.cos(start + sweep * i / points),
             radius * math.sin(start + sweep * i / points), z) for i in range(points + 1)]


def bolt(start, end, seed, steps=15, jitter=0.18):
    rng = random.Random(seed)
    a, b = Vector(start), Vector(end)
    axis = (b - a).normalized()
    u = axis.cross(Vector((0, 0, 1)))
    if u.length < 0.01:
        u = Vector((1, 0, 0))
    u.normalize()
    v = axis.cross(u).normalized()
    points = []
    for i in range(steps + 1):
        t = i / steps
        p = a.lerp(b, t)
        if 0 < i < steps:
            p += jitter * (rng.uniform(-1, 1) * u + rng.uniform(-1, 1) * v)
        points.append(tuple(p))
    return points


def key(obj, path, values, cfg):
    for seconds, value in values:
        setattr(obj, path, value)
        obj.keyframe_insert(data_path=path, frame=cfg.frame(seconds))


def scale_keys(obj, values, cfg, base=(1, 1, 1)):
    key(obj, 'scale', [(t, tuple(s * v for v in base)) for t, s in values], cfg)


def visibility(obj, start, end, cfg):
    for t, hidden in [(0, True), (start, False), (end, True)]:
        obj.hide_render = hidden
        obj.hide_viewport = hidden
        obj.keyframe_insert(data_path='hide_render', frame=cfg.frame(t))
        obj.keyframe_insert(data_path='hide_viewport', frame=cfg.frame(t))


def emission_keys(mat, values, cfg):
    socket = mat.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength']
    for t, value in values:
        socket.default_value = value * cfg.emission_intensity
        socket.keyframe_insert(data_path='default_value', frame=cfg.frame(t))


def linear_animation():
    # Blender 5 layered actions, no legacy action.fcurves assumption.
    for action in bpy.data.actions:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for p in curve.keyframe_points:
                            p.interpolation = 'CONSTANT' if 'hide_' in curve.data_path else 'LINEAR'
