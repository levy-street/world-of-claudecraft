"""Render the Smith's Heart raid weapons from their shipped GLBs, with the glow lit the way the
game lights it (the skin's emissive window rebuilt as a shader mask, as
scripts/assets/lantern_hall_arms/render_arms.py does).

  blender --background --factory-startup --python scripts/assets/smith_heart_arms/render_heart_arms.py -- \
      <out.png> <mode: hero|card|lineup|side> [--res N] [--glow S] [--bg r,g,b] [--blend out.blend] \
      <glb>:<hueLo>:<hueHi>:<minS>:<minL> [...]

hero: a low three-quarter perspective close-up on a dark painted ground, with bloom.
card: the subject on a transparent film on the Armory card diagonal (composed later by
      scripts/assets/lantern_hall_steed/compose_icon.py into the 512 WebP card + 128 JPEG preview).
lineup: every GLB side by side, upright. side: one weapon, straight side view (silhouette check).

Original work for this project.
"""
import math
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, MODE = argv[0], argv[1]
BLEND, RES, GLOW, BG = None, 1024, 2.2, (0.03, 0.032, 0.045)
specs = []
i = 2
while i < len(argv):
    a = argv[i]
    if a in ('--blend', '--res', '--glow', '--bg'):
        v = argv[i + 1]
        if a == '--blend':
            BLEND = v
        elif a == '--res':
            RES = int(v)
        elif a == '--glow':
            GLOW = float(v)
        else:
            BG = tuple(float(c) for c in v.split(','))
        i += 2
        continue
    path, lo, hi, s, l = a.rsplit(':', 4)
    specs.append((path, float(lo), float(hi), float(s), float(l)))
    i += 1

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def glow_material(mat, lo, hi, min_s, min_l):
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and 'color' in n.image.name)
    hsl = nt.nodes.new('ShaderNodeSeparateColor')
    hsl.mode = 'HSL'

    def cmp(sock, op, v):
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = op
        m.inputs[1].default_value = v
        nt.links.new(sock, m.inputs[0])
        return m.outputs[0]

    def mul(a, b):
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY'
        nt.links.new(a, m.inputs[0])
        nt.links.new(b, m.inputs[1])
        return m.outputs[0]
    gam = nt.nodes.new('ShaderNodeGamma')
    gam.inputs['Gamma'].default_value = 1 / 2.2
    nt.links.new(tex.outputs['Color'], gam.inputs['Color'])
    nt.links.new(gam.outputs['Color'], hsl.inputs['Color'])
    h, s, l = hsl.outputs[0], hsl.outputs[1], hsl.outputs[2]
    if lo <= hi:
        hue = mul(cmp(h, 'GREATER_THAN', lo / 360 - 1e-3), cmp(h, 'LESS_THAN', hi / 360 + 1e-3))
    else:  # a window that wraps through red
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'MAXIMUM'
        nt.links.new(cmp(h, 'GREATER_THAN', lo / 360 - 1e-3), add.inputs[0])
        nt.links.new(cmp(h, 'LESS_THAN', hi / 360 + 1e-3), add.inputs[1])
        hue = add.outputs[0]
    m = mul(hue, mul(cmp(s, 'GREATER_THAN', min_s), cmp(l, 'GREATER_THAN', min_l)))
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    nt.links.new(cmp(m, 'MULTIPLY', GLOW), bsdf.inputs['Emission Strength'])


objs = []
for path, lo, hi, min_s, min_l in specs:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    ob = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
    ob.name = path.replace('\\', '/').split('/')[-1].replace('.glb', '')
    for m in ob.data.materials:
        glow_material(m, lo, hi, min_s, min_l)
    objs.append(ob)

if MODE == 'lineup':
    gap = 1.0
    for k, ob in enumerate(objs):
        ob.location = ((k - (len(objs) - 1) / 2) * gap, 0, 0)
        ob.rotation_euler = (0, 0, math.radians(-22))
elif MODE == 'card':
    objs[0].rotation_mode = 'XYZ'
    objs[0].rotation_euler = Euler((0, math.radians(38), 0), 'XYZ')
elif MODE == 'side':
    objs[0].rotation_euler = (0, 0, math.radians(90))
else:
    objs[0].rotation_euler = (0, 0, math.radians(-32))

bpy.context.view_layer.update()
pts = [ob.matrix_world @ v.co for ob in objs for v in ob.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2

sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = int(RES * 1.6) if MODE == 'lineup' else (int(RES * 0.75) if MODE == 'hero' else RES)
sc.render.resolution_y = RES
sc.render.film_transparent = MODE == 'card'
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'Medium High Contrast'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (*BG, 1)
bg.inputs[1].default_value = 0.5

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
w, h = hi.x - lo.x, hi.z - lo.z
aspect = sc.render.resolution_x / sc.render.resolution_y
if MODE == 'hero':
    cam.data.lens = 70
    dist = max(h, w / aspect) * 2.55
    cam.location = centre + Vector((dist * 0.18, -dist, -h * 0.12))
else:
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(w, h * aspect) * 1.12
    cam.location = centre + Vector((0, -12, 0.0))
cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()


def light(name, energy, color, loc, size):
    obj = bpy.data.objects.new(name, bpy.data.lights.new(name, 'AREA'))
    obj.data.energy = energy
    obj.data.color = color
    obj.data.size = size
    obj.location = loc
    obj.rotation_euler = (centre - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(obj)


span = max(w, h)
light('key', 140 * span, (1.0, 0.92, 0.82), centre + Vector((-1.2 * span, -1.6 * span, 1.0 * span)), span)
light('rim', 160 * span, (0.65, 0.78, 1.0), centre + Vector((1.3 * span, 1.2 * span, 0.5 * span)), span * 0.7)
light('fill', 30 * span, (0.8, 0.85, 1.0), centre + Vector((0.8 * span, -1.6 * span, -0.6 * span)), span * 1.4)

# bloom: the compositor's fog glow over the lit glow (Blender 5 node-group compositor)
try:
    tree = bpy.data.node_groups.new('bloom', 'CompositorNodeTree')
    sc.compositing_node_group = tree
    rl = tree.nodes.new('CompositorNodeRLayers')
    gl = tree.nodes.new('CompositorNodeGlare')
    for key, val in (('Type', 'Fog Glow'), ('Quality', 'High')):
        if key in gl.inputs:
            gl.inputs[key].default_value = val
    if 'Threshold' in gl.inputs:
        gl.inputs['Threshold'].default_value = 0.9
    if 'Strength' in gl.inputs:
        gl.inputs['Strength'].default_value = 0.6
    if 'Size' in gl.inputs:
        gl.inputs['Size'].default_value = 0.6
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    out = tree.nodes.new('NodeGroupOutput')
    tree.links.new(rl.outputs['Image'], gl.inputs['Image'])
    tree.links.new(gl.outputs['Image'], out.inputs[0])
except Exception as err:  # older compositor API: render without bloom
    print('NO BLOOM', err)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
