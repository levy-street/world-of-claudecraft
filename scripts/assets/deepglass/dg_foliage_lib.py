# Shared Blender builder for the Deepglass foliage kits (bl_dg_trees.py,
# bl_dg_shrubs.py), v2 2026-09-24.
#
# Imported by the headless builders (`Blender -b --python ...`), never run on
# its own. Blender Z-up, one unit = one yard.
#
# Four rules every card here obeys, each one the fix for a defect SPACEY or the
# review found in v1:
#  1. A card is placed by its cell's ANCHOR (the point where its wood enters,
#     paint_foliage.py records it) and grows along its cell's AXIS. The woody
#     end of a bough is therefore always at the branch, never out at the tip , 
#     SPACEY, 2026-09-24: "some of the branches at the bottom of the png are
#     sticking outward from the tree when the base of the branches should
#     always be closest to the tree".
#  2. Every card is emitted as TWO faces on SEPARATE vertices (front and
#     back). v1 shared one vertex set between its two windings and Blender's
#     export deleted the second as a duplicate face, so every v1 card shipped
#     one-sided. With their own vertices the back face can also carry its
#     own look: it is darker when it faces down (a bough's underside) and a
#     snow bough's back shows its green twin cell (snow lies on top of a
#     branch, never under it). finish_*.mjs still adds a twin to any card
#     that lacks one (foliage_glb.mjs), found by position.
#  3. Card normals come from a VOLUME (the canopy's own shape), not from the
#     card: a tree then has a lit top and a shaded underside and reads as a
#     mass instead of a pile of flat planes.
#  4. Vertex colour carries a value gradient (dark low and inside, light high
#     and outside) plus a baked AO, both as contrast only.
#  5. WIND is baked per vertex into a second UV set, "Wind" (glTF TEXCOORD_1,
#     three's `uv1`): x = FLEX, 0 where a card attaches to its branch rising
#     to 1 at its tip (grass: root 0, blade tip 1); y = PHASE, one value per
#     bough (hashed from its anchor) so a bough moves as a unit and its
#     neighbours don't. Bark and stone carry (0, 0). The game's placed-asset
#     wind (render/tree_sway.ts kitWindGlsl) reads it: trunks barely lean,
#     boughs bend from where they attach, leaves flutter at the tips, all in
#     the vertex shader, no animation clips, no per-frame CPU.
import json
import math
import os
import random

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, 'tree_tex')
FOL = os.path.join(TEX, 'foliage')
# SPACEY's hand-painted bark (image-model paintings) and the PBR maps
# derive_pbr.py makes from them, checked in so anyone can rebuild the kit (they
# lived in gitignored tmp/ and a fresh clone silently got other bark)
BARKSRC = os.path.join(TEX, 'src', 'bark')
CELLS = json.load(open(os.path.join(FOL, 'cells.json')))
Z = Vector((0, 0, 1))


# --------------------------------------------------------------------------
# materials
def _tex(nt, path, colour=True):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(path, check_existing=True)
    if not colour:
        n.image.colorspace_settings.name = 'Non-Color'
    return n


def _calm_bark(image):
    """Compress the bark painting's brightest flecks toward its upper mid:
    stretched over a buttress lobe, the few pale lichen specks in the source
    read as white scuffs (flagged three review rounds)."""
    import numpy as np
    px = np.empty(len(image.pixels), np.float32)
    image.pixels.foreach_get(px)
    a = px.reshape(-1, 4)
    L = a[:, :3].mean(1)
    p90, p99 = np.percentile(L, 90), np.percentile(L, 99.5)
    over = np.clip((L - p90) / max(1e-4, p99 - p90), 0, 1)[:, None]
    target = a[:, :3] * (p90 / np.maximum(L, 1e-4))[:, None]
    a[:, :3] = a[:, :3] * (1 - over * 0.85) + target * (over * 0.85)
    image.pixels.foreach_set(a.ravel())
    image.pack()


def bark_material(name, stem, fallback):
    """Bark with derived relief (derive_pbr.py) when present, else the lifted
    terrain-library derive. Vertex colour multiplies the base colour."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    c = os.path.join(BARKSRC, f'{stem}_color.png')
    col = _tex(nt, c if os.path.exists(c) else os.path.join(TEX, fallback))
    _calm_bark(col.image)
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    nt.links.new(col.outputs['Color'], mix.inputs[6])
    nt.links.new(vc.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    if os.path.exists(c):
        n = _tex(nt, os.path.join(BARKSRC, f'{stem}_normal.png'), False)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        o = _tex(nt, os.path.join(BARKSRC, f'{stem}_orm.png'), False)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(o.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    else:
        bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


def rock_material(name='Stone_dg_moss', stem='Rock026'):
    """A pale fjord-stone boulder skin from the terrain library (Rock026, the
    cliff rock the Warden colossus wears), for the
    undergrowth that ships seated on its own stone."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = _tex(nt, os.path.join(HERE, f'../../../public/textures/terrain/{stem}_Color.jpg'))
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    nt.links.new(col.outputs['Color'], mix.inputs[6])
    nt.links.new(vc.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.95
    bsdf.inputs['Metallic'].default_value = 0.0
    return mat


TERRAIN = os.path.join(HERE, '../../../public/textures/terrain')


def bake_stone(obj, slot, mat_name, base='Cliff002', moss='Rock056', size=2048, tile=4.0, moss_up=(0.36, 0.66),
               grade=(0.5, 1.0, 1.0), moss_grade=(0.47, 1.2, 1.3), ao_k=0.65, foot_k=0.4, ao_dist=0.8, samples=24):
    """Give the stone in material `slot` of `obj` its own baked skin, then swap
    that slot for a plain textured material `mat_name` (keep the `Stone_dg_`
    prefix: the runtime never sways stone).

    The skin is painted, not wrapped: a hand-painted cliff (`base`) BOX-
    projected in object space every `tile` yd, so it neither stretches nor
    pinches at a pole (the old spherical wrap smeared Rock026 into a white
    marbled egg); moss where the stone faces UP, its outline taken from the
    painted moss tufts of `moss` and broken by noise; the foot darkened where
    it meets the soil; and ambient occlusion from the wood that grips it, so
    every root and the trunk leave contact shadow on the stone (SPACEY,
    2026-09-24: "find a better rock texture ... add some moss to really sell
    the look"). Cycles bakes EMIT on a copy of the stone alone, with a copy of
    the wood as the only occluder: leaves are cutout cards and would shadow as
    solid squares."""
    import bmesh
    scene = bpy.context.scene
    view = bpy.context.view_layer
    for o in scene.objects:
        o.select_set(False)
    obj.select_set(True)
    view.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    for e in list(bm.verts) + list(bm.edges) + list(bm.faces):
        e.select = False
    for f in bm.faces:
        if f.material_index == slot:
            f.select_set(True)
    bmesh.update_edit_mesh(obj.data)
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.006, area_weight=0.0)
    # smart project leaves half the sheet empty; packing with rotation fills it
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')

    def part(keep):
        o = obj.copy()
        o.data = obj.data.copy()
        scene.collection.objects.link(o)
        b = bmesh.new()
        b.from_mesh(o.data)
        bmesh.ops.delete(b, geom=[f for f in b.faces if not keep(f.material_index)], context='FACES')
        b.to_mesh(o.data)
        b.free()
        return o

    stone = part(lambda m: m == slot)
    wood = part(lambda m: m not in (slot, 1))
    # nothing else may shadow the stone: every plant built earlier in this
    # session stands at the same origin
    hidden = [o for o in scene.objects if o not in (stone, wood) and not o.hide_render]
    for o in hidden:
        o.hide_render = True

    img = bpy.data.images.new(mat_name, size, size, alpha=False)
    src = bpy.data.materials.new(mat_name + '_bake')
    src.use_nodes = True
    nt = src.node_tree
    nt.nodes.clear()
    N, K = nt.nodes.new, nt.links.new

    def math_node(op, a, b=None):
        m = N('ShaderNodeMath')
        m.operation = op
        for k, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[k].default_value = v
            else:
                K(v, m.inputs[k])
        return m.outputs[0]

    def ramp(v, lo, hi):
        m = N('ShaderNodeMapRange')
        m.clamp = True
        m.interpolation_type = 'SMOOTHSTEP'
        K(v, m.inputs['Value'])
        m.inputs['From Min'].default_value = lo
        m.inputs['From Max'].default_value = hi
        return m.outputs['Result']

    def mix(fac, a, b, blend='MIX'):
        m = N('ShaderNodeMix')
        m.data_type = 'RGBA'
        m.blend_type = blend
        for sock, v in ((0, fac), (6, a), (7, b)):
            if isinstance(v, (int, float)):
                m.inputs[sock].default_value = v
            elif isinstance(v, tuple):
                m.inputs[sock].default_value = v
            else:
                K(v, m.inputs[sock])
        return m.outputs[2]

    tc = N('ShaderNodeTexCoord')
    mp = N('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    K(tc.outputs['Object'], mp.inputs['Vector'])

    def box(stem):
        t = _tex(nt, os.path.join(TERRAIN, f'{stem}_Color.jpg'))
        t.projection = 'BOX'
        t.projection_blend = 0.35
        K(mp.outputs['Vector'], t.inputs['Vector'])
        return t.outputs['Color']

    hsv = N('ShaderNodeHueSaturation')
    hsv.inputs['Hue'].default_value, hsv.inputs['Saturation'].default_value, hsv.inputs['Value'].default_value = grade
    K(box(base), hsv.inputs['Color'])
    rock = hsv.outputs['Color']
    moss_raw = box(moss)
    mh = N('ShaderNodeHueSaturation')
    mh.inputs['Hue'].default_value, mh.inputs['Saturation'].default_value, mh.inputs['Value'].default_value = \
        moss_grade
    K(moss_raw, mh.inputs['Color'])
    moss_c = mh.outputs['Color']
    # the moss outline: the painted tufts of the moss sheet (its green where it
    # is greener than it is red or blue) ...
    sc = N('ShaderNodeSeparateColor')
    K(moss_raw, sc.inputs[0])
    green = ramp(math_node('SUBTRACT', sc.outputs[1], math_node('MAXIMUM', sc.outputs[0], sc.outputs[2])), 0.03, 0.12)
    # ... only on faces that look up, the threshold wandering with a noise so
    # the moss line creeps down some flanks and stops short on others
    geo = N('ShaderNodeNewGeometry')
    nz = N('ShaderNodeSeparateXYZ')
    K(geo.outputs['Normal'], nz.inputs[0])
    noise = N('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.8
    noise.inputs['Detail'].default_value = 5.0
    noise.inputs['Roughness'].default_value = 0.6
    K(tc.outputs['Object'], noise.inputs['Vector'])
    wander = math_node('MULTIPLY', math_node('SUBTRACT', noise.outputs['Fac'], 0.5), 0.8)
    up = ramp(math_node('ADD', nz.outputs['Z'], wander), *moss_up)
    moss_m = math_node('MULTIPLY', up, math_node('MAXIMUM', green, math_node('MULTIPLY', up, 0.35)))
    col = mix(moss_m, rock, moss_c)
    # the foot: damp and earth-dark where the stone leaves the soil
    oz = N('ShaderNodeSeparateXYZ')
    K(tc.outputs['Object'], oz.inputs[0])
    foot = math_node('SUBTRACT', 1.0, ramp(oz.outputs['Z'], -0.1, 0.55))
    col = mix(math_node('MULTIPLY', foot, foot_k), col, (0.16, 0.14, 0.11, 1.0), 'MULTIPLY')
    # contact shadow from the wood (the only other geometry in the bake scene)
    ao = N('ShaderNodeAmbientOcclusion')
    ao.samples = 16
    ao.inputs['Distance'].default_value = ao_dist
    col = mix(math_node('MULTIPLY', math_node('SUBTRACT', 1.0, ao.outputs['AO']), ao_k), col, (0, 0, 0, 1))
    em = N('ShaderNodeEmission')
    K(col, em.inputs['Color'])
    out = N('ShaderNodeOutputMaterial')
    K(em.outputs[0], out.inputs['Surface'])
    tgt = N('ShaderNodeTexImage')
    tgt.image = img
    nt.nodes.active = tgt
    stone.data.materials.clear()
    stone.data.materials.append(src)
    for p in stone.data.polygons:
        p.material_index = 0

    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    scene.render.bake.use_selected_to_active = False
    for o in scene.objects:
        o.select_set(False)
    stone.select_set(True)
    view.objects.active = stone
    bpy.ops.object.bake(type='EMIT')
    img.pack()
    for o in (stone, wood):
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    for o in hidden:
        o.hide_render = False

    fin = bpy.data.materials.new(mat_name)
    fin.use_nodes = True
    fn = fin.node_tree
    bsdf = fn.nodes['Principled BSDF']
    t = fn.nodes.new('ShaderNodeTexImage')
    t.image = img
    vc = fn.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    m = fn.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = 'MULTIPLY'
    m.inputs[0].default_value = 1.0
    fn.links.new(t.outputs['Color'], m.inputs[6])
    fn.links.new(vc.outputs['Color'], m.inputs[7])
    fn.links.new(m.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.95
    obj.data.materials[slot] = fin
    # the bake carries the stone's shading: its vertex colour goes neutral
    col_attr = obj.data.color_attributes['Color']
    for p in obj.data.polygons:
        if p.material_index == slot:
            for li in p.loop_indices:
                col_attr.data[li].color = (1.0, 1.0, 1.0, 1.0)
    return img


def leaf_material(sheet):
    """`Leaves_dg_<family>`: the name keys the finisher's alpha-cutout and
    emissive rules and the runtime's full-strength leaf sway."""
    name = 'Leaves_' + sheet.replace('dg_fol_', 'dg_')
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = _tex(nt, os.path.join(FOL, sheet + '.png'))
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs[6])
    nt.links.new(vc.outputs['Color'], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.0
    return mat


def cell(sheet, name):
    m = CELLS[sheet][name]
    return m


# --------------------------------------------------------------------------
class Plant:
    """Accumulates one asset: bark tubes plus foliage cards, then bakes a mesh.

    faces: (vertex indices, material slot, uvs, colours, normals|None). Bark
    is slot 0, leaves slot 1."""

    def __init__(self, name, seed, sheet, bark=None, tint=(1, 1, 1)):
        self.name = name
        self.rng = random.Random(seed)
        self.sheet = sheet
        self.bark = bark
        self.leaves = leaf_material(sheet)
        self.tint = tint
        self.verts = []
        self.faces = []
        self.height = 1.0
        # the canopy volume that drives foliage normals + value
        self.nfield = lambda p: (p - Vector((0, 0, p.z))).normalized() * 0.8 + Z * 0.6
        self.vfield = lambda p: 1.0
        # the wind context of the card being emitted: (anchor, length, base flex,
        # phase), see rule 5
        self._wctx = None
        # wood as (a, b, ra, rb) segments and card anchors, for check_attached
        self.wood = []
        self.anchors = []
        self.blobs = []

    # -- wood -----------------------------------------------------------------
    def tube(self, pts, radii, sides=7, v_scale=0.3, shade=(0.82, 1.0), tip=False, cap_start=True,
             cap_end=True, twist=0.0, lobes=None, lobe_h=0.0, flat=1.0, lobe_z0=-0.7, lobe_base=0.0,
             hug=None, hug_k=0.55):
        """Swept tube with parallel-transport frames. `twist` turns the bark
        UV a fraction of a wrap per yard, so the grain spirals up a twisted
        trunk. Both ends capped unless told otherwise (bark is single-sided,
        an open end is a hole you see straight through). `hug`: per point, the
        normal of a surface the tube lies on (or None); the cross-section is
        squashed to `hug_k` along it, so a root pressed onto a curved stone
        flattens against the STONE, not against world up (`flat`, which laid
        the crag's roots across its crown as planks)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        rings = []
        ref = Vector((1, 0, 0)) if abs((pts[-1] - pts[0]).normalized().x) < 0.9 else Vector((0, 1, 0))
        length = 0.0
        for i in range(n):
            p = pts[i]
            if i:
                length += (p - pts[i - 1]).length
            a = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            a.normalize()
            ref = ref - a * ref.dot(a)
            if ref.length < 1e-4:
                ref = a.orthogonal()
            ref.normalize()
            side = a.cross(ref)
            if tip and i == n - 1:
                self.verts.append(tuple(p))
                ring = [len(self.verts) - 1] * (sides + 1)
            else:
                ring = []
                for s in range(sides):
                    ang = s / sides * math.tau
                    d = ref * math.cos(ang) + side * math.sin(ang)
                    if flat != 1.0:
                        # a flattened cross-section (roots hug the ground)
                        d = Vector((d.x, d.y, d.z * flat))
                    if hug and hug[i] is not None:
                        d = d - hug[i] * (d.dot(hug[i]) * (1.0 - hug_k))
                    r = radii[i]
                    if lobes and p.z < lobe_h:
                        # the FLARED FOOT grown out of the trunk tube itself:
                        # the bole swells toward each root, strongest at the
                        # ground and gone by lobe_h; below the ground the
                        # lobes narrow again so each root dives into the soil.
                        # One mesh, one continuous bark UV, no collar seam
                        # where a separate flare met the trunk (round-5).
                        wa = math.atan2(d.y, d.x)
                        # a SUPER-gaussian (power 3): a buttress with a rounded,
                        # blunt tip and full shoulders instead of a knife-edged
                        # fin (round-6 review: "a starfish outline")
                        g = lobe_base + sum(gain * math.exp(-abs(((wa - la + math.pi) % math.tau - math.pi) / sp) ** 3)
                                            for la, gain, sp in lobes)
                        if p.z >= 0:
                            prof = ((lobe_h - p.z) / lobe_h) ** 2.2
                        else:
                            prof = max(0.25, 1.0 - 0.55 * (p.z / min(-1e-3, lobe_z0)))
                        r *= 1.0 + g * prof
                    self.verts.append(tuple(p + d * r))
                    ring.append(len(self.verts) - 1)
                ring.append(ring[0])
            rings.append((ring, length, i / max(1, n - 1)))
        for i in range(n - 1):
            self.wood.append((pts[i], pts[i + 1], radii[i], 0.0 if (tip and i == n - 2) else radii[i + 1]))
        wraps = max(1, round(max(radii) * math.tau * v_scale))
        for i in range(n - 1):
            ra, la, ta = rings[i]
            rb, lb, tb = rings[i + 1]
            ca = shade[0] + (shade[1] - shade[0]) * ta
            cb = shade[0] + (shade[1] - shade[0]) * tb
            oa, ob = twist * la, twist * lb
            for s in range(sides):
                u0, u1 = s / sides * wraps, (s + 1) / sides * wraps
                quad = [ra[s], ra[s + 1], rb[s + 1], rb[s]]
                uvs = [(u0 + oa, la * v_scale), (u1 + oa, la * v_scale), (u1 + ob, lb * v_scale),
                       (u0 + ob, lb * v_scale)]
                cols = [(ca,) * 3, (ca,) * 3, (cb,) * 3, (cb,) * 3]
                if rb[s] == rb[s + 1]:
                    quad, uvs, cols = quad[:3], uvs[:3], cols[:3]
                self.faces.append((quad, 0, uvs, cols, None))
        # the rings' vertex indices, bottom to top (collision is fitted to them)
        self.last_rings = [r[0][:sides] for r in rings]
        for which, want in ((0, cap_start), (n - 1, cap_end and not tip)):
            if not want:
                continue
            ring = rings[which][0][:sides]
            c = (shade[0] if which == 0 else shade[1],) * 3
            poly = list(reversed(ring)) if which == 0 else list(ring)
            self.faces.append((poly, 0, [(0.5 + 0.4 * math.cos(k / sides * math.tau),
                                          0.5 + 0.4 * math.sin(k / sides * math.tau)) for k in range(sides)],
                               [c] * sides, None))
        return pts[-1]

    def flare(self, axis_fn, r_fn, z0, z1, lobes, rings=7, sides=24, v_scale=0.3, shade=(0.52, 0.68), twist=0.0,
              wraps=None, v_origin=0.0):
        """The trunk's FLARED BASE as one lofted surface: every ring is a
        closed loop whose radius swells toward each root, so trunk, buttress
        and root are one continuous skin that sinks into the ground, no
        separate root logs crossing each other, no seams, no talons (round-2
        review). `lobes` = (angle, reach, spread): at ground level a lobe
        reaches `reach` times the local trunk radius; the swell fades to
        nothing by z1, where the ring matches the trunk exactly. Rings crowd
        toward the ground where the shape changes fastest."""
        zs = [z0 + (z1 - z0) * (i / rings) ** 1.7 for i in range(rings + 1)]
        ringv = []
        for z in zs:
            c = axis_fn(z)
            if z >= 0:
                g = ((z1 - z) / z1) ** 2.2 if z1 > 0 else 0.0
            else:
                # below the ground the lobes DIVE: they narrow again, so a root
                # slopes into the soil and ends in a point rather than a cut
                # face (round-3 review: "square cut faces above ground")
                g = 1.0 - 0.55 * (z / z0)
            row = []
            for sI in range(sides):
                a = sI / sides * math.tau
                bump = 0.0
                for la, reach, sp in lobes:
                    d = ((a - la + math.pi) % math.tau) - math.pi
                    bump += (reach - 1.0) * math.exp(-((d / sp) ** 2))
                r = r_fn(z) * (1.0 + g * bump + 0.12 * g)
                self.verts.append((c.x + math.cos(a) * r, c.y + math.sin(a) * r, z))
                row.append(len(self.verts) - 1)
            ringv.append(row)
        # the SAME texel density and v origin as the trunk tube above it, so
        # the join at z1 is continuous bark, not a band
        wraps = wraps or max(1, round(r_fn(z1) * math.tau * v_scale))
        for j in range(rings):
            a, b = ringv[j], ringv[j + 1]
            ta, tb = j / rings, (j + 1) / rings
            ca = shade[0] + (shade[1] - shade[0]) * ta
            cb = shade[0] + (shade[1] - shade[0]) * tb
            va, vb = (zs[j] - v_origin) * v_scale, (zs[j + 1] - v_origin) * v_scale
            for sI in range(sides):
                s2 = (sI + 1) % sides
                # the twist offset per VERTEX row (v1.0 used the lower row's
                # for both, so the bark jumped at every ring)
                ua0, ua1 = sI / sides * wraps + twist * zs[j], (sI + 1) / sides * wraps + twist * zs[j]
                ub0, ub1 = sI / sides * wraps + twist * zs[j + 1], (sI + 1) / sides * wraps + twist * zs[j + 1]
                self.faces.append(([a[sI], a[s2] if s2 else a[0], b[s2], b[sI]], 0,
                                   [(ua0, va), (ua1, va), (ub1, vb), (ub0, vb)],
                                   [(ca,) * 3, (ca,) * 3, (cb,) * 3, (cb,) * 3], None))
        # cap the underside (bark is single-sided)
        c0 = axis_fn(z0)
        self.verts.append((c0.x, c0.y, z0 - 0.2))
        hub = len(self.verts) - 1
        for sI in range(sides):
            s2 = (sI + 1) % sides
            self.faces.append(([ringv[0][s2], ringv[0][sI], hub], 0, [(0, 0), (1, 0), (0.5, 1)],
                               [(shade[0],) * 3] * 3, None))
        for z in zs:
            self.wood.append((axis_fn(z), axis_fn(min(z1, z + 0.5)), r_fn(z), r_fn(z)))

    def boulder(self, centre, rx, ry, rz, rng, rings=6, sides=12, sink=0.25, slot=0, light=1.0):
        """A lumpy low boulder (slot 0), sunk `sink` of its height into the
        ground, darker toward its base, for a plant that clings to rock."""
        centre = Vector(centre)
        rows = []
        bumps = [rng.uniform(0.82, 1.14) for _ in range(sides)]
        for j in range(rings + 1):
            v = j / rings
            phi = math.pi * (0.5 - v)                       # +90 top .. -90 bottom
            row = []
            for i in range(sides):
                th = i / sides * math.tau
                k = bumps[i] * rng.uniform(0.93, 1.07) if 0 < j < rings else 1.0
                x = math.cos(phi) * math.cos(th) * rx * k
                y = math.cos(phi) * math.sin(th) * ry * k
                z = math.sin(phi) * rz * (1.0 if phi > 0 else 0.6)
                self.verts.append(tuple(centre + Vector((x, y, z - rz * sink))))
                row.append(len(self.verts) - 1)
            rows.append(row)
        for j in range(rings):
            ca = (0.6 + 0.4 * (1 - j / rings)) * light
            cb = (0.6 + 0.4 * (1 - (j + 1) / rings)) * light
            for i in range(sides):
                i2 = (i + 1) % sides
                u0, u1 = i / sides * 2, (i + 1) / sides * 2
                # wound so the face points OUT: the first version pointed in, and
                # with backface culling the game drew the rock's far inside and
                # culled its near outside, SPACEY's "see-through" moss rock
                self.faces.append(([rows[j][i], rows[j + 1][i], rows[j + 1][i2], rows[j][i2]], slot,
                                   [(u0, 1 - j / rings), (u0, 1 - (j + 1) / rings), (u1, 1 - (j + 1) / rings),
                                    (u1, 1 - j / rings)],
                                   [(ca,) * 3, (ca,) * 3, (cb,) * 3, (cb,) * 3], None))

    def crag(self, centre, rx, ry, rz, rng, rings=6, sides=20, slot=2, dip=0.3, cuts=6, rough=0.2, top=0.8):
        """A broken-stone CRAG growing out of the soil: only the part above the
        ground (its last ring dips `dip` yd under it) is built. Every triangle
        of the old buried lower hemisphere was spent where no one sees it, and
        its smooth ellipsoid read as an egg (SPACEY, 2026-09-24: "this rock
        doesnt look very good"). The shape is an ellipsoid pushed about by a
        few broad seeded lumps and shaved by `cuts` planar FACETS, so it reads
        as a fractured boulder. Returns the stone's surface as a BVH (roots
        are laid on it) and its vertex rows (collision is fitted to them).
        UVs are placeholders: bake_stone unwraps and paints it."""
        from mathutils.bvhtree import BVHTree
        centre = Vector(centre)
        planes = []
        for _ in range(cuts):
            th = rng.uniform(0, math.tau)
            el = rng.uniform(0.2, 1.25)
            planes.append((Vector((math.cos(el) * math.cos(th), math.cos(el) * math.sin(th), math.sin(el))),
                           rng.uniform(0.74, 0.88)))
        # a shaved, slightly tilted TOP: a boulder's crown is broad, not a dome
        planes.append((Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 1.0)).normalized(), top))
        lumps = []
        for _ in range(8):
            d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.1, 1))).normalized()
            lumps.append((d, rng.uniform(-1, 1) * rough, rng.uniform(0.4, 0.75)))

        def shape(u):
            s = 1.0 + sum(a * math.exp(-((u - d).length / w) ** 2) for d, a, w in lumps)
            q = u * s
            for n, cut in planes:
                over = q.dot(n) - cut
                if over > 0:
                    q = q - n * over
            return Vector((q.x * rx, q.y * ry, q.z * rz))

        base = len(self.verts)
        sin_last = max(-0.95, min(0.95, (-dip - centre.z) / rz))
        phi_last = math.asin(sin_last)
        rows = []
        self.verts.append(tuple(centre + shape(Z)))
        pole = len(self.verts) - 1
        for j in range(1, rings + 1):
            phi = math.pi / 2 - (math.pi / 2 - phi_last) * j / rings
            row = []
            for i in range(sides):
                th = i / sides * math.tau
                p = centre + shape(Vector((math.cos(phi) * math.cos(th), math.cos(phi) * math.sin(th),
                                           math.sin(phi))))
                if j == rings:
                    p.z = -dip
                self.verts.append(tuple(p))
                row.append(len(self.verts) - 1)
            rows.append(row)
        tris = []
        for j in range(rings):
            ca = 1.0 - 0.12 * j / rings
            cb = 1.0 - 0.12 * (j + 1) / rings
            for i in range(sides):
                i2 = (i + 1) % sides
                if j == 0:
                    quad = [pole, rows[0][i], rows[0][i2]]
                    cols = [(ca,) * 3, (cb,) * 3, (cb,) * 3]
                else:
                    quad = [rows[j - 1][i], rows[j][i], rows[j][i2], rows[j - 1][i2]]
                    cols = [(ca,) * 3, (cb,) * 3, (cb,) * 3, (ca,) * 3]
                uvs = [(0.0, 0.0)] * len(quad)
                self.faces.append((quad, slot, uvs, cols, None))
                tris.append([k - base for k in quad])
        verts = [Vector(v) for v in self.verts[base:]]
        return {'bvh': BVHTree.FromPolygons(verts, tris, all_triangles=False), 'centre': centre,
                'rows': [[Vector(self.verts[k]) for k in row] for row in rows], 'pole': Vector(self.verts[pole])}

    def dome_core(self, c, rx, rz, name, rings=3, sides=9, uv_span=0.3, shade=1.0):
        """A solid, single-sided leafy DOME (a squashed hemisphere dipping just
        under the ground) painted with the middle of a clump cell, projected
        from above. Cards around it carry the silhouette; the dome closes every
        cave, slit and see-through gap a shell of cards leaves (round-9
        review: caves, slits, a dark band, bristly balls), and its true sphere
        normals give a clean lit top and dark belly."""
        m = cell(self.sheet, name)
        u0, v0, u1, v1 = m['box']
        ua, va = m['anchor']
        bw, bh = u1 - u0, v1 - v0
        c = Vector(c)

        def P_(x, y, z):
            p = Vector((c.x + x, c.y + y, z))
            self.verts.append(tuple(p))
            return len(self.verts) - 1, p

        def uv(p):
            return (ua + (p.x - c.x) / rx * uv_span * bw, va + (p.y - c.y) / rx * uv_span * bh)

        def nrm(p):
            n = Vector(((p.x - c.x) / rx, (p.y - c.y) / rx, (p.z - c.z) / rz)).normalized()
            return tuple((n * 0.8 + self.nfield(p).normalized() * 0.2).normalized())

        top = P_(0, 0, c.z + rz)
        rings_v = []
        for j in range(1, rings + 1):
            el = math.pi / 2 * (1 - j / rings * 1.12)
            row = []
            for i in range(sides):
                a = i / sides * math.tau
                row.append(P_(math.cos(a) * math.cos(el) * rx, math.sin(a) * math.cos(el) * rx,
                              c.z + math.sin(el) * rz))
            rings_v.append(row)

        def face(pts):
            # project each face on its OWN plane: a single top-down projection
            # stretched the sides into dark vertical streaks (round-10)
            ps = [p for _, p in pts]
            fc = sum(ps, Vector()) / len(ps)
            fn = (ps[1] - ps[0]).cross(ps[2] - ps[0])
            fn = fn.normalized() if fn.length > 1e-9 else Z.copy()
            if abs(fn.z) > 0.75:
                uvs = [uv(p) for p in ps]
            else:
                tg = Vector((-fn.y, fn.x, 0)).normalized()
                ang = math.atan2(fc.y - c.y, fc.x - c.x)
                off = Vector((math.cos(ang * 3.1), math.sin(ang * 2.3))) * 0.18
                uvs = [(ua + ((p - fc).dot(tg) / rx + off.x) * uv_span * bw,
                        va + ((p.z - fc.z) / rx + off.y) * uv_span * bh) for p in ps]
            self.faces.append(([i for i, _ in pts], 1, uvs,
                               [self._col(p, shade) for _, p in pts], [nrm(p) for _, p in pts],
                               [(0.12, 0.0)] * len(pts)))

        r0 = rings_v[0]
        for i in range(sides):
            face([top, r0[i], r0[(i + 1) % sides]])
        for j in range(rings - 1):
            a, b = rings_v[j], rings_v[j + 1]
            for i in range(sides):
                i2 = (i + 1) % sides
                face([a[i], b[i], b[i2], a[i2]])

    def shade_wood(self, fn):
        """Multiply the vertex colour of every WOOD face by fn(point): e.g. the
        bole sinks into shadow inside the canopy (a lit mid-grey trunk read
        as a stripe through the tiers, three review rounds)."""
        for i, f in enumerate(self.faces):
            if f[1] != 0:
                continue
            cols = [tuple(c * fn(Vector(self.verts[vi])) for c in col) for vi, col in zip(f[0], f[3])]
            self.faces[i] = (f[0], f[1], f[2], cols, f[4]) + tuple(f[5:])

    def anchored(self, p):
        """Remember a card's attach point for check_attached(). Cards placed
        with `suspend` set belong to a cloud checked through its centre."""
        if getattr(self, 'suspend', False):
            return
        self.anchors.append(Vector(p))

    def check_attached(self, tol=0.35):
        """Every anchored card must sit ON wood: its anchor within `tol` yd of
        some branch/trunk surface, and every clump blob must enclose wood.
        A card that fails reads as foliage floating in mid-air (round-2
        review: pads with no limb on root_twin and root_giant_b)."""
        def dist(p):
            best = 1e9
            for a, b, ra, rb in self.wood:
                ab = b - a
                L2 = ab.length_squared
                t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
                q = a + ab * t
                best = min(best, (p - q).length - (ra + (rb - ra) * t))
            return best
        bad = [p for p in self.anchors if dist(p) > tol]
        bad += [c for c, R in self.blobs if dist(c) > R * 0.85]
        if bad:
            raise AssertionError(f'{self.name}: {len(bad)} card(s)/clouds not attached to wood, '
                                 f'e.g. {tuple(round(v, 2) for v in bad[0])}')

    # -- foliage cards ----------------------------------------------------------
    def _face(self, pts, uvs, cols, m, back):
        """One card face (a tri or quad) on its OWN vertices; `back` flips the
        winding. A face that points DOWN shows its cell's `back` twin when it
        has one (a snow bough's green underside: snow lies on top of a branch,
        never under it), decided by the face's real direction, not by which
        winding it is, so both sides of a VERTICAL bough keep their snow.
        Colour and normal respond to that direction too: up-facing sides lift,
        down-facing undersides sink."""
        if back:
            pts, uvs, cols = pts[::-1], uvs[::-1], cols[::-1]
        g = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        g = g.normalized() if g.length > 1e-9 else Z.copy()
        twin = m.get('back') if m else None
        if twin and g.z < -0.3:
            f0 = m['box']
            b0 = CELLS[self.sheet][twin]['box']
            uvs = [(b0[0] + (u - f0[0]) / (f0[2] - f0[0]) * (b0[2] - b0[0]),
                    b0[1] + (v - f0[1]) / (f0[3] - f0[1]) * (b0[3] - b0[1])) for u, v in uvs]
        up = max(0.0, min(1.0, 0.5 + 0.5 * g.z))
        k = 0.8 + 0.2 * up
        ids = []
        for p in pts:
            self.verts.append(tuple(p))
            ids.append(len(self.verts) - 1)
        cols = [tuple(c * k for c in col) for col in cols]
        nrm = [tuple((self.nfield(p).normalized() + g * 0.3).normalized()) for p in pts]
        self.faces.append((ids, 1, list(uvs), cols, nrm, [self._wind_at(p) for p in pts]))

    def _wind(self, anchor, length, base=0.0, axis=None, key=0.0):
        """Set the wind context for the next card: flex grows from `base` at
        the anchor to 1 at `length` along the card's growth `axis` (out along a
        bough, up a grass blade, down a raceme), measured ALONG it, so the
        whole attach edge of a wide card stays pinned; with no axis, by
        distance (a stemless clump). Phase is a hash of the anchor's ground
        position, so a bough's side and plan cards (same anchor) share it."""
        a = Vector(anchor)
        # `key` separates cards that share one root (fern fronds, grass blades)
        h = math.sin(round(a.x, 1) * 12.9898 + round(a.y, 1) * 78.233 + round(key, 1) * 37.719) * 43758.5453
        ax = Vector(axis).normalized() if axis is not None else None
        self._wctx = (a, max(0.2, length), base, h - math.floor(h), ax)

    def _wind_at(self, p):
        if not self._wctx:
            return (0.0, 0.0)
        a, ln, base, ph, ax = self._wctx
        d = Vector(p) - a
        f = (d.dot(ax) if ax is not None else d.length) / ln
        f = min(1.0, max(0.0, f))
        return (base + (1.0 - base) * f, ph)

    def _emit(self, grid, uvgrid, colgrid, m=None):
        """grid[r][c] -> world Vector: a front and a back face per quad."""
        for i in range(len(grid) - 1):
            for j in range(len(grid[0]) - 1):
                ps = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
                uvs = [uvgrid[i][j], uvgrid[i][j + 1], uvgrid[i + 1][j + 1], uvgrid[i + 1][j]]
                cols = [colgrid[i][j], colgrid[i][j + 1], colgrid[i + 1][j + 1], colgrid[i + 1][j]]
                self._face(ps, uvs, cols, m, False)
                self._face(ps, uvs, cols, m, True)

    def _col(self, p, v, tint=None):
        f = self.vfield(p)
        f = f if isinstance(f, tuple) else (f, f, f)
        t = tint or (1.0, 1.0, 1.0)
        return tuple(f[k] * v * self.tint[k] * t[k] for k in range(3))

    def side_card(self, anchor, out, length, name, droop=0.25, roll=0.0, segs=2, shade=1.0, lift=0.0,
                  tint=None):
        """A SIDE-VIEW bough on a VERTICAL card (axis 'right'): the anchor sits
        on the branch, the art runs `length` yards along `out`, its hanging
        sprays hang DOWN. `droop` bends the far end down (radians at the
        tip); `roll` tilts the card plane about `out` (0 = vertical)."""
        m = cell(self.sheet, name)
        u0, v0, u1, v1 = m['box']
        ua, va = m['anchor']
        k = length / max(1e-4, u1 - ua)
        o = Vector((out[0], out[1], 0)).normalized()
        up = Matrix.Rotation(roll, 3, o) @ Z
        anchor = Vector(anchor)
        self.anchored(anchor)
        self._wind(anchor, length, axis=o, key=math.atan2(o.y, o.x))
        # columns: the art behind the anchor, then segs stations to the tip
        us = [u0] + [ua + (u1 - ua) * (j / segs) for j in range(1, segs + 1)]
        grid_cols = []
        for u in us:
            s = (u - ua) * k
            f = max(0.0, s / length)
            # the bough sags as it runs out: a vertical shear, so each column
            # of the art stays upright and the hanging sprays keep hanging
            base = anchor + o * s - up * (length * (droop * 0.5 * f * f - lift * f))
            grid_cols.append((u, base, up))
        grid, uvg, colg = [], [], []
        for v in (v1, v0):             # top row, bottom row
            row, urow, crow = [], [], []
            t = (v - va) * k
            for u, base, upd in grid_cols:
                p = base + upd * t
                row.append(p)
                urow.append((u, v))
                crow.append(self._col(p, shade * (1.0 if v == v1 else 0.95), tint))
            grid.append(row)
            uvg.append(urow)
            colg.append(crow)
        self._emit(grid, uvg, colg, m)

    def plan_card(self, anchor, out, length, name, droop0=0.15, droop1=0.7, roll=0.0, segs=2, shade=1.0,
                  width_mul=1.0, rise=None, tint=None):
        """A PLAN-VIEW card (axis 'down'): lies near horizontal, anchor on the
        branch, runs `length` along `out` bending from droop0 to droop1
        (radians below horizontal; negative rises). `roll` banks it about
        `out`. Also used for hanging racemes with droop ~ pi/2."""
        m = cell(self.sheet, name)
        u0, v0, u1, v1 = m['box']
        ua, va = m['anchor']
        k = length / max(1e-4, va - v0)
        o = Vector((out[0], out[1], out[2] if len(out) > 2 else 0)).normalized()
        side0 = o.cross(Z)
        if side0.length < 1e-4:
            side0 = Vector((1, 0, 0))
        side0.normalize()
        side = Matrix.Rotation(roll, 3, o) @ side0
        anchor = Vector(anchor)
        self.anchored(anchor)
        self._wind(anchor, length, axis=Vector((o.x, o.y, 0)) if (o.x or o.y) else o, key=math.atan2(o.y, o.x))
        vs = [v1] + [va - (va - v0) * (j / segs) for j in range(1, segs + 1)]
        pts = []
        p = anchor.copy()
        prev_s = 0.0
        hz = Vector((o.x, o.y, 0))
        hz = hz.normalized() if hz.length > 1e-4 else o
        for v in vs:
            s = (va - v) * k
            if s <= 0:
                pts.append((v, anchor + o * s))
                continue
            # the bend at the segment's MIDDLE, so a steep rise at the base
            # (a fern frond, a dome card) actually rises
            f = (s + max(0.0, prev_s)) * 0.5 / length
            d = droop0 + (droop1 - droop0) * f
            p = p + (hz * math.cos(d) - Z * math.sin(d)) * (s - prev_s)
            prev_s = s
            pts.append((v, p.copy()))
        grid, uvg, colg = [], [], []
        for v, c in pts:
            row = [c + side * ((u0 - ua) * k * width_mul), c + side * ((u1 - ua) * k * width_mul)]
            grid.append(row)
            uvg.append([(u0, v), (u1, v)])
            f = max(0.0, (va - v) / max(1e-4, va - v0))
            colg.append([self._col(q, shade * (1.0 - 0.05 * f), tint) for q in row])
        self._emit(grid, uvg, colg, m)

    def upright_card(self, base, height, name, yaw, lean=0.0, lean_dir=None, segs=1, shade=1.0, curl=0.0,
                     tint=None):
        """A card standing on its anchor (axis 'up'): crown leaders, grass.
        `lean` tilts it off vertical toward `lean_dir`; `curl` bends the top
        further over (grass arching out)."""
        m = cell(self.sheet, name)
        u0, v0, u1, v1 = m['box']
        ua, va = m['anchor']
        k = height / max(1e-4, v1 - va)
        side = Vector((math.cos(yaw), math.sin(yaw), 0))
        ld = Vector(lean_dir) if lean_dir is not None else Vector((-side.y, side.x, 0))
        ld = Vector((ld.x, ld.y, 0)).normalized()
        base = Vector(base)
        self.anchored(base)
        self._wind(base, height, axis=Z, key=yaw % math.pi)
        vs = [v0] + [va + (v1 - va) * j / segs for j in range(1, segs + 1)]
        grid, uvg, colg = [], [], []
        p = base.copy()
        prev = 0.0
        for v in vs:
            s = (v - va) * k
            if s > 0:
                f = s / height
                a = lean + curl * f
                p = p + (Z * math.cos(a) + ld * math.sin(a)) * (s - prev)
                prev = s
                c = p
            else:
                c = base + Z * s
            row = [c + side * ((u0 - ua) * k), c + side * ((u1 - ua) * k)]
            grid.append(row)
            uvg.append([(u0, v), (u1, v)])
            f = max(0.0, (v - va) / max(1e-4, v1 - va))
            colg.append([self._col(q, shade * (0.72 + 0.36 * f), tint) for q in row])
        grid.reverse()
        uvg.reverse()
        colg.reverse()
        self._emit(grid, uvg, colg, m)

    def clump_card(self, centre, size, name, normal, roll=0.0, shade=1.0, cup=0.0, tint=None):
        """A stemless clump (axis 'centre') facing `normal`, edge `size`.
        With `cup` > 0 it is a shallow PYRAMID (four triangles round a centre
        pushed out along the normal): no angle ever sees it perfectly
        edge-on, which is what drew bright streaks across a canopy."""
        m = cell(self.sheet, name)
        u0, v0, u1, v1 = m['box']
        ua, va = m['anchor']
        k = size / max(u1 - u0, v1 - v0)
        n = Vector(normal).normalized()
        a = n.cross(Z if abs(n.z) < 0.95 else Vector((1, 0, 0))).normalized()
        b = a.cross(n).normalized()
        R = Matrix.Rotation(roll, 3, n)
        a, b = R @ a, R @ b
        centre = Vector(centre)
        # a stemless clump rustles as a whole (base flex 0.3) and a little more
        # at its rim
        self._wind(centre, size * 0.7, 0.3)
        corners = [(u0, v1), (u1, v1), (u1, v0), (u0, v0)]
        pts = [centre + a * ((u - ua) * k) + b * ((v - va) * k) for u, v in corners]
        if not cup:
            cols = [self._col(q, shade, tint) for q in pts]
            self._face(pts, corners, cols, m, False)
            self._face(pts, corners, cols, m, True)
            return
        mid = centre + n * (cup * size)
        mu = (ua, va)
        for j in range(4):
            ps = [pts[j], pts[(j + 1) % 4], mid]
            uvs = [corners[j], corners[(j + 1) % 4], mu]
            cols = [self._col(q, shade * (1.06 if q is mid else 1.0), tint) for q in ps]
            self._face(ps, uvs, cols, m, False)
            self._face(ps, uvs, cols, m, True)

    def hang_card(self, anchor, length, name, facing_yaw, sway=0.0, shade=1.0, tint=None):
        """A hanging raceme (axis 'down') on a VERTICAL card facing
        `facing_yaw`: the anchor at the top on the branch, the art hanging
        straight down (`sway` lets it swing out a little)."""
        m = cell(self.sheet, name)
        u0, v0, u1, v1 = m['box']
        ua, va = m['anchor']
        k = length / max(1e-4, va - v0)
        side = Vector((math.cos(facing_yaw + math.pi / 2), math.sin(facing_yaw + math.pi / 2), 0))
        outv = Vector((math.cos(facing_yaw), math.sin(facing_yaw), 0))
        anchor = Vector(anchor)
        self.anchored(anchor)
        self._wind(anchor, length, axis=-Z)
        grid, uvg, colg = [], [], []
        for v in (v1, va - (va - v0) * 0.5, v0):
            s = (va - v) * k
            f = max(0.0, s / length)
            c = anchor - Z * s + outv * (sway * length * f * f)
            row = [c + side * ((u0 - ua) * k), c + side * ((u1 - ua) * k)]
            grid.append(row)
            uvg.append([(u0, v), (u1, v)])
            colg.append([self._col(q, shade * (1.0 - 0.18 * f), tint) for q in row])
        self._emit(grid, uvg, colg, m)

    # -- bake -------------------------------------------------------------------
    def build(self, ao=True, ao_rays=40):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.verts, [], [f[0] for f in self.faces])
        me.materials.append(self.bark or self.leaves)
        me.materials.append(self.leaves)
        if getattr(self, 'extra', None):
            me.materials.append(self.extra)
        uv = me.uv_layers.new(name='UVMap')
        wind = me.uv_layers.new(name='Wind')      # rule 5: (flex, phase) -> TEXCOORD_1
        col = me.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
        for poly, f in zip(me.polygons, self.faces):
            poly.material_index = f[1]
            poly.use_smooth = True
            wv = f[5] if len(f) > 5 else None
            for k, li in enumerate(poly.loop_indices):
                uv.data[li].uv = f[2][k]
                wind.data[li].uv = wv[k] if wv else (0.0, 0.0)
                c = f[3][k]
                col.data[li].color = (c[0], c[1], c[2], 1.0)
        me.uv_layers.active = uv
        me.update()
        normals = [None] * len(me.loops)
        for poly, f in zip(me.polygons, self.faces):
            for k, li in enumerate(poly.loop_indices):
                normals[li] = tuple(f[4][k]) if f[4] is not None else tuple(me.corner_normals[li].vector)
        me.normals_split_custom_set(normals)
        if ao and os.environ.get('DG_AO') != '0':
            bake_ao(me, self.height, ao_rays)
        normalize_colors(me)
        compress_leaf_range(me)
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        # what the GPU draws: both faces of every card are real geometry now
        self.tri_split = (sum(len(p.vertices) - 2 for p in me.polygons if p.material_index != 1 and self.bark),
                          sum(len(p.vertices) - 2 for p in me.polygons if p.material_index == 1 or not self.bark))
        return obj, sum(self.tri_split)


# --------------------------------------------------------------------------
# Ambient occlusion baked into the vertex colours, as CONTRAST (the mean
# value of each material is restored exactly), per material, from corner
# normals. See the v17 notes in the tree kit memory for why each of those
# three matters.
AO_STRENGTH = 0.6
LEAF_AO_SCALE = 0.4
AO_HARD = (0.45, 1.12)
BARK_AO_CEIL = 1.0       # bark only darkens: a lift on exposed lobes read as pale scuffs


def _hemisphere(n, count):
    n = Vector(n).normalized()
    up = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    t = n.cross(up).normalized()
    b = n.cross(t)
    ga = math.pi * (3.0 - math.sqrt(5.0))
    out = []
    for i in range(count):
        u = (i + 0.5) / count
        cz = math.sqrt(1.0 - u)
        r = math.sqrt(u)
        a = ga * i
        out.append((t * (math.cos(a) * r) + b * (math.sin(a) * r) + n * cz).normalized())
    return out


def bake_ao(me, height, rays=40):
    from mathutils.bvhtree import BVHTree
    verts = [v.co.copy() for v in me.vertices]
    if not verts:
        return
    bvh = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons], all_triangles=False,
                               epsilon=0.0)
    radius = min(6.0, max(0.6, height * 0.25))
    vn = [Vector((0.0, 0.0, 0.0)) for _ in verts]
    for poly in me.polygons:
        for vi, li in zip(poly.vertices, poly.loop_indices):
            vn[vi] += me.corner_normals[li].vector
    ao = [1.0] * len(verts)
    cache = {}
    for vi, co in enumerate(verts):
        n = vn[vi]
        if n.length < 1e-6:
            continue
        n.normalize()
        key = (round(n.x, 2), round(n.y, 2), round(n.z, 2))
        dirs = cache.get(key) or cache.setdefault(key, _hemisphere(n, rays))
        o = co + n * 1e-3
        hits = 0.0
        for d in dirs:
            loc, _n, _i, dist = bvh.ray_cast(o, d, radius)
            if loc is not None:
                hits += 1.0 - (dist / radius) ** 2
        ao[vi] = max(0.0, 1.0 - hits / rays)
    buckets = ([], [])
    for poly in me.polygons:
        leaf = 1 if poly.material_index == 1 else 0
        buckets[leaf].extend(ao[vi] for vi in poly.vertices)
    means = [max(0.12, sum(b) / max(1, len(b))) for b in buckets]
    fac = [1.0] * len(me.loops)
    sums, counts = [0.0, 0.0], [0, 0]
    for poly in me.polygons:
        leaf = 1 if poly.material_index == 1 else 0
        st = AO_STRENGTH * (LEAF_AO_SCALE if leaf else 1.0)
        for vi, li in zip(poly.vertices, poly.loop_indices):
            fac[li] = 1.0 + (ao[vi] / means[leaf] - 1.0) * st
            sums[leaf] += fac[li]
            counts[leaf] += 1
    norm = [1.0 / max(1e-3, sums[i] / max(1, counts[i])) for i in (0, 1)]
    col = me.color_attributes['Color']
    for poly in me.polygons:
        leaf = 1 if poly.material_index == 1 else 0
        for li in poly.loop_indices:
            f = min(AO_HARD[1] if leaf else BARK_AO_CEIL, max(AO_HARD[0], fac[li] * norm[leaf]))
            c = col.data[li].color
            col.data[li].color = (c[0] * f, c[1] * f, c[2] * f, c[3])


def normalize_colors(me):
    """glTF vertex colour is clamped to [0, 1] on export, so every value the
    builders push above 1 (a bright crown, a lit top face) was silently cut
    and the skirt-to-crown gradient came out flat (round-2 review: "crown and
    skirt read at the same value"). Scale each material so its 98th
    percentile lands at 1.0: the gradient keeps its full RATIO."""
    col = me.color_attributes['Color']
    for slot in (0, 1, 2):
        loops = [li for p in me.polygons if p.material_index == slot for li in p.loop_indices]
        if not loops:
            continue
        vals = sorted(max(col.data[li].color[:3]) for li in loops)
        p98 = vals[min(len(vals) - 1, int(len(vals) * 0.98))]
        k = 1.0 / p98 if p98 > 1.0 else 1.0
        for li in loops:
            c = col.data[li].color
            col.data[li].color = (min(1.0, c[0] * k), min(1.0, c[1] * k), min(1.0, c[2] * k), c[3])


LEAF_RANGE = 0.65


def compress_leaf_range(me, k=LEAF_RANGE):
    """Narrow the leaves' baked light-to-dark range toward the light end: each
    corner keeps `k` of its distance below full value, on its luminance (so
    the tint's hue survives). The order of every light and dark is kept; the
    darkest leaves (AO, down-facing cards, the skirt of the crown) lift from
    ~0.3 to ~0.55 (SPACEY, 2026-09-24: "the darkest lighting on the leaves are a
    bit dark ... still keep the variance but reduce the range")."""
    col = me.color_attributes['Color']
    for p in me.polygons:
        if p.material_index != 1:
            continue
        for li in p.loop_indices:
            c = col.data[li].color
            L = max(c[0], c[1], c[2], 1e-4)
            s = (1.0 - (1.0 - min(1.0, L)) * k) / L
            col.data[li].color = (min(1.0, c[0] * s), min(1.0, c[1] * s), min(1.0, c[2] * s), c[3])


def export(obj, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_normals=True, export_vertex_color='ACTIVE',
                              export_all_vertex_colors=False, export_image_format='WEBP',
                              export_image_quality=90)


def refine(path, radii, zmax, k=4):
    """Subdivide every segment of a trunk path that starts below `zmax` into
    k pieces (points and radii interpolated), so a lobed foot has the rings it
    needs to be smooth while the rest of the trunk stays cheap."""
    pts, rad = [path[0]], [radii[0]]
    for i in range(len(path) - 1):
        n = k if path[i].z < zmax else 1
        for j in range(1, n + 1):
            f = j / n
            pts.append(path[i].lerp(path[i + 1], f))
            rad.append(radii[i] + (radii[i + 1] - radii[i]) * f)
    return pts, rad


def fib_dirs(n, up_bias=0.0, min_z=-1.0):
    """n directions spread evenly over the part of the sphere above `min_z`
    (a golden spiral in z), tilted toward +Z by `up_bias`. Exactly n: the old
    version stepped down the whole sphere and dropped what fell below min_z,
    so a dome asked for 12 cards quietly got 6."""
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for k in range(n):
        z = 1 - (k + 0.5) / n * (1 - min_z)
        r = math.sqrt(max(0.0, 1 - z * z))
        a = ga * (k + 1)
        out.append(Vector((math.cos(a) * r, math.sin(a) * r, z + up_bias)).normalized())
    return out
