"""Render Lantern Hall's elemental weapons from their shipped GLBs: a lineup, one weapon alone,
or a card subject, with the glow lit the way the game lights it.

The game derives each skin's glow from the albedo texels inside its emissive window
(src/render/weapon_vfx.ts, weapon_vfx_emissive_core.ts: a hue range plus HSL saturation and
lightness floors). This script rebuilds that same window as a shader mask driving an emission,
so the render shows exactly the parts that burn in game.

  blender --background --factory-startup --python scripts/assets/lantern_hall_arms/render_arms.py -- \
      <out.png> <mode: lineup|single|card> [--blend out.blend] [--res N] [--view front|three] \
      <glb>:<hueLo>:<hueHi>:<minS>:<minL> [...]

'card' renders the subject on a transparent film on the Armory card diagonal. The shipped art is
that subject composed over the painted ground (scripts/assets/lantern_hall_steed/compose_icon.py
<subject.png> <card.png> <r,g,b> --bloom, grounds 52,30,22 fire, 22,40,70 sea storm, 26,44,66
frost, 38,24,58 dusk), saved as the 512 WebP Armory card
(public/ui/store/armory/<skin id>.webp, quality 86) and a 128 JPEG bag preview
(public/ui/weapons/<model>.jpg, quality 88). Original work for this project.
"""
import math
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, MODE = argv[0], argv[1]
BLEND = None
RES = 1024
VIEW = 'three'
specs = []
i = 2
while i < len(argv):
    a = argv[i]
    if a == '--blend':
        BLEND = argv[i + 1]
        i += 2
        continue
    if a == '--res':
        RES = int(argv[i + 1])
        i += 2
        continue
    if a == '--view':
        VIEW = argv[i + 1]
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
    nt.links.new(tex.outputs['Color'], hsl.inputs['Color'])

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
    # the texture node hands Blender linear values; the game tests sRGB bytes, so the window is
    # tested on a gamma-corrected copy
    gam = nt.nodes.new('ShaderNodeGamma')
    gam.inputs['Gamma'].default_value = 1 / 2.2
    nt.links.new(tex.outputs['Color'], gam.inputs['Color'])
    nt.links.new(gam.outputs['Color'], hsl.inputs['Color'])
    h, s, l = hsl.outputs[0], hsl.outputs[1], hsl.outputs[2]
    m = mul(mul(cmp(h, 'GREATER_THAN', lo / 360 - 1e-3), cmp(h, 'LESS_THAN', hi / 360 + 1e-3)),
            mul(cmp(s, 'GREATER_THAN', min_s), cmp(l, 'GREATER_THAN', min_l)))
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    nt.links.new(cmp(m, 'MULTIPLY', 1.6), bsdf.inputs['Emission Strength'])


objs = []
for path, lo, hi, min_s, min_l in specs:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    ob = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
    ob.name = path.replace('\\', '/').split('/')[-1].replace('.glb', '')
    for m in ob.data.materials:
        glow_material(m, lo, hi, min_s, min_l)
    objs.append(ob)

# lay them out: a lineup stands them side by side, upright; a card lies one on the diagonal
if MODE == 'lineup':
    gap = 1.25
    for k, ob in enumerate(objs):
        ob.location = ((k - (len(objs) - 1) / 2) * gap, 0, 0)
        ob.rotation_euler = (0, 0, math.radians(-18 if VIEW == 'three' else 0))
elif MODE == 'card':
    objs[0].rotation_mode = 'XYZ'
    objs[0].rotation_euler = Euler((0, math.radians(38), 0), 'XYZ')
else:
    objs[0].rotation_euler = (0, 0, math.radians(-28 if VIEW == 'three' else 0))

bpy.context.view_layer.update()
pts = [ob.matrix_world @ v.co for ob in objs for v in ob.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
centre = (lo + hi) / 2

sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = RES if MODE != 'lineup' else int(RES * 1.6)
sc.render.resolution_y = RES
sc.render.film_transparent = MODE == 'card'
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'Medium High Contrast'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs[0].default_value = (0.035, 0.04, 0.06, 1)
bg.inputs[1].default_value = 0.6

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = 'ORTHO'
w, h = hi.x - lo.x, hi.z - lo.z
aspect = sc.render.resolution_x / sc.render.resolution_y
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
light('key', 120 * span, (1.0, 0.93, 0.84), centre + Vector((-1.2 * span, -1.6 * span, 1.0 * span)), span)
light('rim', 90 * span, (0.7, 0.8, 1.0), centre + Vector((1.2 * span, 1.2 * span, 0.4 * span)), span * 0.8)
light('fill', 25 * span, (0.8, 0.85, 1.0), centre + Vector((0.8 * span, -1.6 * span, -0.6 * span)), span * 1.4)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
