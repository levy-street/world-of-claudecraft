"""Review staging for the harbor route marker: a stretch of pier over water, sky and sun, a
player-scale figure, the exported sign pointing right with a sample destination, and an
instance of the same sign turned about to point left with its own sample destination.

Nothing here is exported: build_harbor_route_marker.py exports the HarborRouteMarker_ROOT
hierarchy before this module adds anything. The sample names are review text only (the game
writes the destination at runtime, on both faces, never mirrored).

  blender --background --python scripts/assets/harbor_route_marker/build_harbor_route_marker.py -- \
      --save harbor_route_marker.blend --preview OUT_DIR
  blender harbor_route_marker.blend --python scripts/assets/harbor_route_marker/open_marker.py
"""
import math
import os

import bpy
from shiplib import P

PLAYER_H = 2.6  # the player model, pivot to crown (HUMANOID_H in render/characters/manifest.ts)
LEFT_X = -8.5   # where the left-pointing copy stands
FIGURE = (1.4, 0.0, 1.35)
SAMPLES = (('The Nightbloom', 0.0, False), ('Eastbrook', LEFT_X, True))


def _mat(name, color, rough=0.8, emit=0.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*color, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m


def _collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def _move(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def _box(name, center, size, mat, coll):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=P(*center))
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[2], size[1])
    o.data.materials.append(mat)
    _move(o, coll)
    return o


def figure(name, x, y, z, coll, mat_body, mat_head):
    """The chibi player stand-in the ferry review uses: 2.6 yd to the crown, big head."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.42, depth=1.45, location=P(x, y + 0.72, z))
    body = bpy.context.object
    body.name = f'{name}_body'
    body.data.materials.append(mat_body)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.58, location=P(x, y + 1.98, z))
    head = bpy.context.object
    head.name = f'{name}_head'
    head.data.materials.append(mat_head)
    for o in (body, head):
        _move(o, coll)
    return body, head


def sample_text(label, anchor_world, face_offset, width, height, coll, ink):
    """A review-only destination label on the face turned toward the camera (+z)."""
    curve = bpy.data.curves.new(f'Dest_{label}', 'FONT')
    curve.body = label
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.size = height * 0.9
    obj = bpy.data.objects.new(f'SampleDestination_{label}', curve)
    coll.objects.link(obj)
    obj.data.materials.append(ink)
    x, y, z = anchor_world
    obj.location = P(x, y, z + face_offset)
    obj.rotation_euler = (math.pi / 2, 0.0, 0.0)
    bpy.context.view_layer.update()
    w = obj.dimensions.x
    if w > width * 0.92:
        k = width * 0.92 / w
        obj.scale = (k, k, k)
    return obj


def stage(objs):
    scene = bpy.context.scene
    root = objs['root']
    # the sign lives in its own collection so a turned instance can stand beside it
    sign = _collection('HarborRouteMarker')
    for o in [root] + list(root.children_recursive):
        _move(o, sign)
    left = bpy.data.objects.new('HarborRouteMarker_LeftCopy', None)
    left.instance_type = 'COLLECTION'
    left.instance_collection = sign
    left.location = P(LEFT_X, 0.0, 0.0)
    left.rotation_euler = (0.0, 0.0, math.pi)
    coll = _collection('Preview (not exported)')
    coll.objects.link(left)

    wood = _mat('PierWood', (0.42, 0.3, 0.2))
    post = _mat('PierPost', (0.26, 0.19, 0.13))
    water = _mat('Water', (0.07, 0.24, 0.3), rough=0.1)
    bpy.ops.mesh.primitive_plane_add(size=300, location=P(0, -2.2, 0))
    w = bpy.context.object
    w.name = 'Water'
    w.data.materials.append(water)
    _move(w, coll)
    # a stretch of pier deck under both signs, planks across it
    for k in range(20):
        x = -14.0 + k * 1.05
        _box(f'Pier_Plank_{k}', (x, -0.08, 0.0), (0.98, 0.16, 4.4), wood, coll)
    for s in (-1, 1):
        _box(f'Pier_Beam_{s}', (-3.5, -0.3, s * 2.06), (21.5, 0.24, 0.24), post, coll)
        for k in range(8):
            _box(f'Pier_Stilt_{s}_{k}', (-13.0 + k * 2.9, -1.5, s * 1.9), (0.3, 2.8, 0.3), post, coll)

    body = _mat('FigureBody', (0.55, 0.12, 0.1))
    head = _mat('FigureHead', (0.93, 0.75, 0.6))
    figure('PlayerReference_2p6yd', *FIGURE, coll, body, head)
    figure('PlayerReference_2p6yd_Left', LEFT_X - 1.4, 0.0, 1.35, coll, body, head)

    ink = _mat('SampleInk', (0.09, 0.06, 0.04), rough=0.9)
    anchor = objs['anchor']
    extras = anchor['destinationText']
    ax = anchor.location.x
    ay = anchor.location.z
    for label, x0, turned in SAMPLES:
        cx = x0 - ax if turned else x0 + ax
        sample_text(label, (cx, ay, 0.0), float(extras['faceOffset']),
                    float(extras['width']) * float(extras['textWidth']),
                    float(extras['height']) * float(extras['textHeight']), coll, ink)

    # sky and sun
    world = bpy.data.worlds.new('Sky')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.62, 0.72, 0.8, 1)
    ramp.color_ramp.elements[1].position = 0.75
    ramp.color_ramp.elements[1].color = (0.28, 0.46, 0.72, 1)
    nt.links.new(coord.outputs['Window'], sep.inputs[0])
    nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.6
    sun.data.angle = math.radians(4)
    sun.data.color = (1.0, 0.95, 0.86)
    sun.rotation_euler = (math.radians(50), 0, math.radians(28))
    coll.objects.link(sun)
    fill = bpy.data.objects.new('SkyFill', bpy.data.lights.new('SkyFill', 'SUN'))
    fill.data.energy = 0.8
    fill.data.color = (0.7, 0.8, 1.0)
    fill.data.use_shadow = False
    fill.rotation_euler = (math.radians(-60), 0, math.radians(200))
    coll.objects.link(fill)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.lens = 35
    cam.data.clip_end = 1000
    coll.objects.link(cam)
    scene.camera = cam
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    try:
        scene.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    for vt in ('AgX', 'Filmic', 'Standard'):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    return cam


VIEWS = {
    # name: camera position, look-at (game frame), lens, low tier only
    'pair_front': ((-4.2, 4.2, 17.0), (-4.2, 3.1, 0.0), 35, False),
    'three_quarter': ((7.5, 4.6, 8.5), (1.2, 3.4, 0.0), 32, False),
    'gameplay_medium': ((10.0, 7.0, 13.0), (1.5, 3.2, 0.0), 30, False),
    'side_along_arrow': ((13.0, 3.6, 1.6), (0.5, 3.8, 0.0), 35, False),
    'back': ((1.5, 4.0, -8.5), (1.2, 3.8, 0.0), 35, False),
    'detail_icon': ((2.2, 6.2, 3.4), (0.0, 5.6, 0.0), 45, False),
    'far': ((34.0, 12.0, 42.0), (-3.5, 3.0, 0.0), 35, False),
    'low_tier': ((7.5, 4.6, 8.5), (1.2, 3.4, 0.0), 32, True),
}

SHED_ON_LOW = ('MetalTrim', 'OptionalLantern', 'OptionalChain', 'OptionalRope')


def render_all(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene
    cam = scene.camera
    for name, (pos, at, lens, low) in VIEWS.items():
        for n in SHED_ON_LOW:
            o = bpy.data.objects.get(n)
            if o is not None:
                o.hide_render = low
        cam.location = P(*pos)
        cam.data.lens = lens
        direction = P(*at) - P(*pos)
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(out_dir, f'harbor_route_marker_{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath)
    for n in SHED_ON_LOW:
        o = bpy.data.objects.get(n)
        if o is not None:
            o.hide_render = False


def save(path):
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path))
    print('SAVED', path)


