"""The Voracious Chest: a mimic whose LID is its upper jaw, rigged and animated in Blender.

A sibling of quadruped_rig.py for a body that script cannot pose: the chest opens
like a mouth. The raw Tripo model (up +Z, facing +X: the lock and the teeth are on
+X) is split along the seam (the line of teeth) by the spec's "seam" plane:

  * the chest shell is CUT along that plane and the two halves separated, so the
    lid swings open as one rigid piece with no face stretched across the seam; the
    two cut openings are capped with a dark maw material (the roof and the floor of
    the mouth);
  * everything above the seam (lid, top bands, spikes, the teeth that hang from it)
    is weighted rigidly to the Lid bone, hinged at the BACK top edge of the chest;
    everything below to Body;
  * the two clawed arms that stand out from the sides are three-bone chains
    (ArmUpper/ArmLower/Hand) weighted by distance along their own shell; the two
    short rear feet (HindFoot) are rigid;
  * an optional spec "tongue" builds a tapered, flattened, curved tube rooted on
    the floor of the mouth and folded over the front lip, weighted to a four-bone
    chain (TongueBase/TongueA/TongueB/TongueTip) under Body, painted by a small
    generated gradient texture; it lies below the seam while the lid is shut and
    only rises onto the floor once the lid is well open (TONGUE_CHECK=1 audits
    its clearance frame by frame);
  * clips are keyed procedurally from world-axis turns: Idle, Walk, Run, Attack
    (the bite: rear back with the lid wide open, lunge and snap it shut about 55%
    in), Hit, Death, Cast (lid open wide, body pumping), Leap (crouch, spring,
    land).

One GLB per clip is written; assemble.mjs merges them into the shipped model:

  blender --background --python mimic_rig.py -- <raw.glb> <out dir> --spec <spec.json> [--blend file]
  node assemble.mjs <key> <out dir> <model.glb> Idle,Walk,Run,Attack,Cast,Hit,Death,Leap
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, geometry

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
BLEND = args[args.index('--blend') + 1] if '--blend' in args else None
ONLY = args[args.index('--only') + 1].split(',') if '--only' in args else None
with open(args[args.index('--spec') + 1], encoding='utf-8') as handle:
    SPEC = json.load(handle)
MOTION = SPEC.get('motion', {})
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene
scene.render.fps = FPS
mesh_obj = next(o for o in scene.objects if o.type == 'MESH')
world = mesh_obj.matrix_world.copy()
mesh_obj.parent = None
mesh_obj.data.transform(world)
mesh_obj.matrix_world = Matrix.Identity(4)
if SPEC.get('rotateZ'):
    mesh_obj.data.transform(Matrix.Rotation(math.radians(SPEC['rotateZ']), 4, 'Z'))
for o in list(scene.objects):
    if o is not mesh_obj:
        bpy.data.objects.remove(o, do_unlink=True)
mesh_obj.name = SPEC['name']

# ---------------------------------------------------------------- skeleton
# name: (parent, head, tail). It faces +X, +Y is its left, +Z is up. "X.*" is
# written once and mirrored to .L (+Y) and .R (-Y).
BONES = []
for name, parent, head, tail in SPEC['bones']:
    if name.endswith('.*'):
        for side, sign in (('L', 1), ('R', -1)):
            mirror = lambda p: (p[0], p[1] * sign, p[2])
            BONES.append((name[:-1] + side, parent[:-1] + side if parent.endswith('.*') else parent,
                          mirror(head), mirror(tail)))
    else:
        BONES.append((name, parent, tuple(head), tuple(tail)))

# ------------------------------------------------------------------ tongue
# Optional spec "tongue": a long fleshy tongue rooted on the floor of the mouth
# (the body side of the seam), lying along the floor and folding over the front
# lip. At rest it is straight along the floor; the clips fold it down the front
# face. Its top sits a hair BELOW the seam, under the floor cap, so the lid
# closes over it; it only rises onto the floor once the lid is well open.
TONGUE = SPEC.get('tongue')
TONGUE_BONES = ('TongueBase', 'TongueA', 'TongueB', 'TongueTip')
if TONGUE:
    _n = Vector(SPEC['seam']['normal'])
    _co = Vector(SPEC['seam']['point'])
    T_NO = _n.normalized()
    T_Y = TONGUE.get('y', 0.0)

    def seam_z(x, y):
        return _co.z - (_n.x * (x - _co.x) + _n.y * (y - _co.y)) / _n.z

    T_START = Vector((TONGUE['start'], T_Y, seam_z(TONGUE['start'], T_Y)))
    T_DIR = (Vector((TONGUE['start'] + 1, T_Y, seam_z(TONGUE['start'] + 1, T_Y))) - T_START).normalized()
    T_SIDE = T_NO.cross(T_DIR).normalized()
    T_LIP = (TONGUE['lip'] - TONGUE['start']) / T_DIR.x
    T_JOINTS = [T_LIP]
    for seg in TONGUE['segments'][:-1]:
        T_JOINTS.append(T_JOINTS[-1] + seg)
    T_LEN = T_LIP + sum(TONGUE['segments'])
    T_SINK = TONGUE.get('sink', 0.003)

    def t_thick(s):
        a, b = TONGUE['thick']
        return a + (b - a) * max(0.0, (s - T_LIP * 0.5) / (T_LEN - T_LIP * 0.5))

    def t_width(s):
        back, lip, tip = TONGUE['width']
        if s < T_LIP:
            return back + (lip - back) * s / T_LIP
        return lip + (tip - lip) * (s - T_LIP) / (T_LEN - T_LIP)

    def t_centre(s):
        return T_START + T_DIR * s - T_NO * (t_thick(s) / 2 + T_SINK)

    _stops = T_JOINTS + [T_LEN]
    BONES.append(('TongueBase', 'Body', tuple(t_centre(T_LIP)), tuple(t_centre(0.0))))
    for i, name in enumerate(TONGUE_BONES[1:]):
        BONES.append((name, TONGUE_BONES[i], tuple(t_centre(_stops[i])), tuple(t_centre(_stops[i + 1]))))
BONE_AT = {n: (Vector(h), Vector(t)) for n, _, h, t in BONES}

arm_data = bpy.data.armatures.new(SPEC['name'] + 'Rig')
arm = bpy.data.objects.new(SPEC['name'] + 'Rig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = Vector(head), Vector(tail)
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

# ------------------------------------------------------ cut the lid off the seam
SEAM = SPEC['seam']
SEAM_CO = Vector(SEAM['point'])
SEAM_NO = Vector(SEAM['normal']).normalized()


def above(p):
    return (p - SEAM_CO).dot(SEAM_NO)


def flood(verts):
    """Connected components over the given vertex set (by edges)."""
    inside = set(verts)
    seen, out = set(), []
    for v in verts:
        if v in seen:
            continue
        stack, group = [v], []
        seen.add(v)
        while stack:
            cur = stack.pop()
            group.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o in inside and o not in seen:
                    seen.add(o)
                    stack.append(o)
        out.append(group)
    return out


maw = bpy.data.materials.new('MimicMaw')
maw.use_nodes = True
bsdf = maw.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = tuple(SPEC.get('mawColor', (0.11, 0.015, 0.018))) + (1.0,)
bsdf.inputs['Roughness'].default_value = 0.85
maw.diffuse_color = bsdf.inputs['Base Color'].default_value
mesh_obj.data.materials.append(maw)
MAW_INDEX = len(mesh_obj.data.materials) - 1

bm = bmesh.new()
bm.from_mesh(mesh_obj.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
shells = sorted(flood(list(bm.verts)), key=len, reverse=True)
chest = shells[0]
chest_set = set(chest)
chest_faces = list({f for v in chest for f in v.link_faces})
chest_edges = list({e for v in chest for e in v.link_edges})
cut = bmesh.ops.bisect_plane(bm, geom=chest + chest_edges + chest_faces, dist=1e-5,
                             plane_co=SEAM_CO, plane_no=SEAM_NO)
cut_edges = [g for g in cut['geom_cut'] if isinstance(g, bmesh.types.BMEdge)]
bmesh.ops.split_edges(bm, edges=cut_edges)
# After the split the chest falls apart into pieces above and below the plane.
# Re-find the chest pieces from its old verts: bisect keeps them and adds cut
# verts, and the split duplicates the cut verts.
stack = [v for v in bm.verts if v in chest_set]
seen = set(stack)
while stack:
    cur = stack.pop()
    for e in cur.link_edges:
        o = e.other_vert(cur)
        if o not in seen:
            seen.add(o)
            stack.append(o)
chest_verts = list(seen)
pieces = flood(chest_verts)
lid_verts = set()
for piece in pieces:
    # After the bisect every face lies wholly on one side: the vertex farthest
    # from the plane tells which side a (possibly thin) piece is on.
    if above(max(piece, key=lambda v: abs(above(v.co))).co) > 0:
        lid_verts.update(piece)
    if os.environ.get('MIMIC_DEBUG'):
        c = sum((v.co for v in piece), Vector()) / len(piece)
        print('PIECE', len(piece), tuple(round(x, 3) for x in c),
              'extent', [round(min(v.co[i] for v in piece), 3) for i in range(3)],
              [round(max(v.co[i] for v in piece), 3) for i in range(3)], 'lid', piece[0] in lid_verts)

# Cap both cut openings (the roof and the floor of the mouth) with the convex
# hull of the cross-section, pulled a little inside the walls. Each cap sits a
# hair past the plane on the OTHER side, so it covers every cut face of its own
# half (no sliver of the groove pokes through it) and still hides when closed.
axis_u = Vector((0, 1, 0)).cross(SEAM_NO).normalized()
axis_v = SEAM_NO.cross(axis_u)


def section_hull(offset):
    """Convex hull (plane coords) of the chest cut by the seam plane moved by
    offset along its normal: taken a little INTO each half, so an overhanging lid
    rim never widens the body's cap, nor a flared body top the lid's."""
    pts = []
    for e in {e for v in chest_verts for e in v.link_edges}:
        a, b = (above(v.co) - offset for v in e.verts)
        if a * b < 0:
            p = e.verts[0].co.lerp(e.verts[1].co, a / (a - b))
            pts.append(((p - SEAM_CO).dot(axis_u), (p - SEAM_CO).dot(axis_v)))
    return [pts[i] for i in geometry.convex_hull_2d(pts)]


INSET = SPEC.get('capInset', 0.965)
CAP_LIFT = SPEC.get('capLift', 0.0015)
DEPTH = SPEC.get('capSection', 0.015)
HULLS = {}
for name, facing in (('Body', 1), ('Lid', -1)):
    hull = HULLS[name] = section_hull(-facing * DEPTH)
    cu = sum(h[0] for h in hull) / len(hull)
    cv = sum(h[1] for h in hull) / len(hull)
    ring = [bm.verts.new(SEAM_CO + axis_u * (cu + (hu - cu) * INSET) + axis_v * (cv + (hv - cv) * INSET)
                         + SEAM_NO * facing * CAP_LIFT) for hu, hv in hull]
    face = bm.faces.new(ring)
    face.normal_update()
    if face.normal.dot(SEAM_NO) * facing < 0:
        face.normal_flip()
    face.material_index = MAW_INDEX
    face.smooth = False
    if name == 'Lid':
        lid_verts.update(ring)
    chest_verts.extend(ring)
print('SEAM pieces', [(len(p), round(sum(above(v.co) for v in p) / len(p), 3)) for p in pieces],
      'hull', len(hull))

# ----------------------------------------------------------------- weights
# Every other shell: a big one is an arm; small ones (teeth, spikes, studs,
# claws) are rigid to the part they sit on.
SIDE = lambda y: 'L' if y > 0 else 'R'
ARM_CHAIN = ('ArmUpper', 'ArmLower', 'Hand')


def seg_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def nearest_arm_bone(p, side):
    return min(('%s.%s' % (n, side) for n in ARM_CHAIN),
               key=lambda n: seg_distance(p, *BONE_AT[n]))


def deep_inside(p, share):
    """True when p projects well inside the body's cross-section: inside the hull
    shrunk to `share` of its size about its centre."""
    hull = HULLS['Body']
    cu = sum(h[0] for h in hull) / len(hull)
    cv = sum(h[1] for h in hull) / len(hull)
    u, v = (p - SEAM_CO).dot(axis_u), (p - SEAM_CO).dot(axis_v)
    u, v = cu + (u - cu) / share, cv + (v - cv) / share
    signs = set()
    for (au, av), (bu, bv) in zip(hull, hull[1:] + hull[:1]):
        signs.add((bu - au) * (v - av) - (bv - av) * (u - au) > 0)
    return len(signs) == 1


weights = {}
junk = []
in_chest = set(chest_verts)
others = flood([v for v in bm.verts if v not in in_chest])
TEETH = SPEC.get('teethBand', 0.07)
FOOT = SPEC['footRegion']
for group in others:
    c = sum((v.co for v in group), Vector()) / len(group)
    side = SIDE(c.y)
    if len(group) > 150 and abs(c.y) > 0.2:
        # An arm: distance weights over its three bones, smoothed along the shell.
        for v in group:
            scored = sorted((seg_distance(v.co, *BONE_AT['%s.%s' % (n, side)]), '%s.%s' % (n, side))
                            for n in ARM_CHAIN)
            w = {n: 1.0 / max(d, 0.01) ** 4 for d, n in scored[:2]}
            total = sum(w.values())
            weights[v] = {n: x / total for n, x in w.items()}
        members = set(group)
        for _ in range(3):
            nxt = {}
            for v in group:
                acc = dict(weights[v])
                for e in v.link_edges:
                    o = e.other_vert(v)
                    if o in members:
                        for n, x in weights[o].items():
                            acc[n] = acc.get(n, 0.0) + x
                total = sum(acc.values())
                nxt[v] = {n: x / total for n, x in acc.items()}
            weights.update(nxt)
        continue
    if os.environ.get('MIMIC_DEBUG'):
        print('SHELL', len(group), tuple(round(x, 3) for x in c), 'above', round(above(c), 3),
              'deep', deep_inside(c, 0.75), 'span', [round(min(above(v.co) for v in group), 3),
                                                    round(max(above(v.co) for v in group), 3)])
    if abs(c.y) > FOOT['armY']:
        bone = nearest_arm_bone(c, side)
    elif (c.z < FOOT['maxZ'] and c.x < FOOT['maxX']
          and seg_distance(c, *BONE_AT['HindFoot.' + side]) < FOOT.get('radius', 0.07)):
        bone = 'HindFoot.' + side
    elif abs(above(c)) < TEETH and deep_inside(c, SPEC.get('junkShare', 0.6)):
        # Stray bits deep inside the chest (hidden while it is shut) would float
        # in the open mouth: drop them.
        junk.extend(group)
        continue
    elif abs(above(c)) < TEETH and len(group) >= SPEC.get('toothVerts', 8):
        # A tooth at the seam belongs to the jaw it grows from. Its tip is the
        # vertex farthest from its centre (the base carries the verts): a tooth
        # pointing DOWN hangs from the lid, one pointing up stands on the body.
        tip = max(group, key=lambda v: (v.co - c).length).co
        bone = 'Lid' if (tip - c).dot(SEAM_NO) < 0 else 'Body'
    else:
        bone = 'Lid' if above(c) > 0 else 'Body'
    for v in group:
        weights[v] = {bone: 1.0}
for v in chest_verts:
    weights[v] = {'Lid' if v in lid_verts else 'Body': 1.0}

print('JUNK dropped', len(junk), 'verts')
bmesh.ops.delete(bm, geom=junk, context='VERTS')


def smooth01(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def tongue_material():
    """Plain flesh like MimicMaw, painted by a small gradient texture: the
    throat end dark, the tip lighter, a darker groove down the middle and a
    little mottling, to sit with the hand-painted chest."""
    size_u, size_v = 32, 64
    img = bpy.data.images.new('MimicTongueTex', size_u, size_v, alpha=False)
    base = Vector(TONGUE.get('color', (0.604, 0.227, 0.353)))
    tip = Vector(TONGUE.get('tipColor', (0.8, 0.45, 0.56)))
    px = []
    for j in range(size_v):
        v = (j + 0.5) / size_v
        for i in range(size_u):
            u = (i + 0.5) / size_u
            ang = 2 * math.pi * u
            col = base.lerp(tip, smooth01((v - 0.5) / 0.5))
            shade = 0.62 + 0.38 * smooth01(v / 0.35)  # darker down the throat
            shade *= 1 - 0.3 * math.exp(-((ang - math.pi / 2) ** 2) / 0.05)  # the groove
            shade *= 0.86 + 0.14 * max(0.0, math.sin(ang))  # underside a touch darker
            shade *= 1 + 0.09 * max(0.0, math.sin(ang)) * math.cos(3 * ang) ** 2  # top sheen
            h = math.sin(i * 12.9898 + j * 78.233) * 43758.5453
            shade *= 0.94 + 0.12 * (h - math.floor(h))  # mottling
            c = col * shade
            px.extend((min(1, c.x), min(1, c.y), min(1, c.z), 1.0))
    img.pixels = px
    img.pack()
    mat = bpy.data.materials.new('MimicTongue')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.6
    mat.diffuse_color = tuple(base) + (1.0,)
    mat.use_backface_culling = False
    return mat


TONGUE_S = {}
if TONGUE:
    mesh_obj.data.materials.append(tongue_material())
    TONGUE_INDEX = len(mesh_obj.data.materials) - 1
    uv_layer = bm.loops.layers.uv.active or bm.loops.layers.uv.new('UVMap')
    sides = TONGUE.get('sides', 10)
    groove = TONGUE.get('groove', 0.35)
    cap_b, cap_t = TONGUE.get('backRound', 0.025), TONGUE.get('tipRound', 0.035)
    # Ring stations: dense over both rounded ends, about 1.6 cm apart between.
    stations = [cap_b * (1 - math.cos(math.pi / 2 * k / 4)) for k in range(1, 5)]
    step = TONGUE.get('ringStep', 0.016)
    n_mid = max(2, round((T_LEN - cap_t - cap_b) / step))
    stations += [cap_b + (T_LEN - cap_t - cap_b) * k / n_mid for k in range(1, n_mid)]
    stations += [T_LEN - cap_t * (1 - math.sin(math.pi / 2 * k / 5)) for k in range(0, 5)]

    def end_scale(s):
        if s < cap_b:
            return math.sqrt(max(0.0, 1 - ((cap_b - s) / cap_b) ** 2))
        if s > T_LEN - cap_t:
            return math.sqrt(max(0.0, 1 - ((s - T_LEN + cap_t) / cap_t) ** 2))
        return 1.0

    rings = []
    for s in stations:
        sc = max(0.18, end_scale(s))
        w, th = t_width(s) * sc / 2, t_thick(s) * sc / 2
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            up = math.sin(ang)
            if up > 0:
                up *= 1 - groove * math.exp(-((ang - math.pi / 2) ** 2) / 0.12)
            v = bm.verts.new(t_centre(s) + T_SIDE * (w * math.cos(ang)) + T_NO * (th * up))
            ring.append(v)
            TONGUE_S[v] = s
        rings.append((s, ring))
    back_pole = bm.verts.new(t_centre(0.0))
    front_pole = bm.verts.new(t_centre(T_LEN))
    TONGUE_S[back_pole], TONGUE_S[front_pole] = 0.0, T_LEN
    t_faces = []

    def add_face(verts, uvs):
        f = bm.faces.new(verts)
        f.material_index = TONGUE_INDEX
        f.smooth = True
        for loop, uv in zip(f.loops, uvs):
            loop[uv_layer].uv = uv
        t_faces.append(f)

    for (s0, r0), (s1, r1) in zip(rings, rings[1:]):
        for k in range(sides):
            k1 = (k + 1) % sides
            u0, u1 = k / sides, (k + 1) / sides
            add_face([r0[k], r0[k1], r1[k1], r1[k]],
                     [(u0, s0 / T_LEN), (u1, s0 / T_LEN), (u1, s1 / T_LEN), (u0, s1 / T_LEN)])
    s0, r0 = rings[0]
    s1, r1 = rings[-1]
    for k in range(sides):
        k1 = (k + 1) % sides
        u0, u1 = k / sides, (k + 1) / sides
        add_face([back_pole, r0[k1], r0[k]], [((u0 + u1) / 2, 0.0), (u1, s0 / T_LEN), (u0, s0 / T_LEN)])
        add_face([front_pole, r1[k], r1[k1]], [((u0 + u1) / 2, 1.0), (u0, s1 / T_LEN), (u1, s1 / T_LEN)])
    bmesh.ops.recalc_face_normals(bm, faces=t_faces)
    # Weights by arc length: rigid segments blended smoothly across each joint.
    blends = TONGUE.get('blend', [0.01, 0.022, 0.022])
    for v, s in TONGUE_S.items():
        fs = [smooth01((s - (j - b)) / (2 * b)) for j, b in zip(T_JOINTS, blends)]
        w = [1 - fs[0], fs[0] * (1 - fs[1]), fs[1] * (1 - fs[2]), fs[2]]
        weights[v] = {n: x for n, x in zip(TONGUE_BONES, w) if x > 0.001}
    print('TONGUE', len(TONGUE_S), 'verts, length', round(T_LEN, 3), 'lip at s', round(T_LIP, 3))
bm.verts.index_update()
order = list(bm.verts)
bm.to_mesh(mesh_obj.data)
bm.free()
me = mesh_obj.data
if me.has_custom_normals:
    with bpy.context.temp_override(object=mesh_obj, active_object=mesh_obj):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
me.shade_smooth()
me.set_sharp_from_angle(angle=math.radians(SPEC.get('sharpAngle', 40)))
for p in me.polygons:
    if p.material_index == MAW_INDEX:
        p.use_smooth = False

groups = {n: mesh_obj.vertex_groups.new(name=n) for n, *_ in BONES if n != 'Root'}
for i, v in enumerate(order):
    for n, w in weights[v].items():
        if w > 0.01:
            groups[n].add([i], w, 'REPLACE')
mesh_obj.parent = arm
mod = mesh_obj.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

# ------------------------------------------------------------------- clips
REST = {b.name: b.matrix_local.copy() for b in arm_data.bones}
PARENT = {b.name: (b.parent.name if b.parent else None) for b in arm_data.bones}
ORDER = [b.name for b in arm_data.bones]
AXES = {'X': Vector((1, 0, 0)), 'Y': Vector((0, 1, 0)), 'Z': Vector((0, 0, 1))}


def apply_pose(pose):
    """pose: bone -> {'turn': [(axis, degrees), ...], 'move': (x, y, z)}; turns
    are about WORLD axes through the bone's posed head, first one innermost."""
    posed = {}
    for name in ORDER:
        parent = PARENT[name]
        base = REST[name] if parent is None else posed[parent] @ REST[parent].inverted() @ REST[name]
        spec = pose.get(name, {})
        # 'frame': a bone whose current deformation carries the turn axes and the
        # move (so the tongue bends about the BODY's axes however the body leans).
        frame = spec.get('frame')
        warp = (posed[frame] @ REST[frame].inverted()).to_3x3() if frame else Matrix.Identity(3)
        rot = Matrix.Identity(4)
        for axis, degrees in spec.get('turn', []):
            about = warp @ (AXES[axis] if isinstance(axis, str) else Vector(axis))
            rot = Matrix.Rotation(math.radians(degrees), 4, about) @ rot
        pivot = base.to_translation()
        final = Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot) @ base
        final = Matrix.Translation(warp @ Vector(spec.get('move', (0, 0, 0)))) @ final
        posed[name] = final
        pb = arm.pose.bones[name]
        pb.rotation_mode = 'QUATERNION'
        pb.matrix_basis = base.inverted() @ final


def wave(t, freq=1.0, lag=0.0):
    return math.sin(2 * math.pi * (t * freq - lag))


def ease(a, b, t):
    t = max(0.0, min(1.0, (t - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bump(a, b, t):
    """0 -> 1 -> 0 over [a, b], smooth."""
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** 2


FOOT_DROP = MOTION.get('footDrop', 0.0)


def body(pose, move=(0, 0, 0), pitch=0.0, roll=0.0, yaw=0.0):
    """pitch > 0 dips the front (the lid lip) toward the ground."""
    pose['Body'] = {'move': move, 'turn': [('Y', pitch), ('X', roll), ('Z', yaw)]}


def lid(pose, open_deg):
    pose['Lid'] = {'turn': [('Y', -open_deg)]}
    pose['_lid'] = open_deg


def tongue(pose, hang=1.0, bend=(0, 0, 0), sway=(0, 0, 0), slide=0.0, yaw=0.0):
    """Pose the tongue (a no-op without a spec "tongue"); call it after lid().
    hang 1 folds it over the lip down the front face (the spec's "hang" bends),
    0 lays it straight out along the floor; bend adds degrees per segment (> 0
    droops, < 0 curls up), sway swings each segment sideways, slide moves it
    along the floor (< 0 pulls it back into the mouth). It lies sunk under the
    floor cap while the lid is near shut and rises onto the floor only as the
    lid opens through the spec's "liftOpen" range, so it never meets the
    closing lid or the teeth that hang from it."""
    if not TONGUE:
        return
    lo, hi = TONGUE.get('liftOpen', (14, 22))
    rise = (TONGUE['thick'][0] + T_SINK + 0.002) * ease(lo, hi, pose.get('_lid', 0.0))
    pose['TongueBase'] = {'frame': 'Body', 'move': tuple(T_DIR * slide + T_NO * rise),
                          'turn': [('Z', yaw)]}
    loll = TONGUE.get('loll', (0, 0, 0))  # its resting lean to one side, as it hangs
    for i, name in enumerate(TONGUE_BONES[1:]):
        pose[name] = {'frame': 'Body',
                      'turn': [('X', loll[i] * (hang - BAKED) + sway[i]),
                               ('Y', TONGUE['hang'][i] * (hang - BAKED) + bend[i])]}


def arm_pose(pose, side, swing=0.0, lift=0.0, elbow=0.0, claw=0.0):
    """swing > 0 reaches the hand forward; lift > 0 raises the whole arm; elbow > 0
    swings the forearm outward (straightens), < 0 tucks it under; claw > 0 curls
    the hand inward."""
    s = 1 if side == 'L' else -1
    out = Vector((0, s, 0))
    hinge = tuple(out.cross(Vector((0, 0, 1))))
    pose['ArmUpper.' + side] = {'turn': [(hinge, lift), ('Z', -swing * s)]}
    pose['ArmLower.' + side] = {'turn': [(hinge, elbow)]}
    pose['Hand.' + side] = {'turn': [(hinge, -claw)]}


def foot(pose, side, swing=0.0, lift=0.0, splay=0.0, shift=0.0):
    """swing > 0 reaches the foot forward, lift raises it and shift slides it
    forward (metres): the feet hang off Root, so they follow a body lunge here."""
    s = 1 if side == 'L' else -1
    pose['HindFoot.' + side] = {'turn': [('Y', -swing), ('X', -splay * s)],
                                'move': (shift, 0.0, lift - FOOT_DROP)}


def rest_feet(pose):
    for side in ('L', 'R'):
        foot(pose, side)


def clip_idle(t):
    pose = {}
    breath = 0.5 * (1 - math.cos(2 * math.pi * t * 2))  # two slow breaths
    crack = bump(0.3, 0.72, t)
    body(pose, move=(0, 0, MOTION.get('idleBob', 0.006) * breath), pitch=-1.2 * breath)
    lid(pose, 1.5 * breath + MOTION.get('idleCrack', 9) * crack)
    for side in ('L', 'R'):
        lag = 0.0 if side == 'L' else 0.2
        arm_pose(pose, side, swing=2 * wave(t, 1, lag), lift=-2 * breath, elbow=1.5 * breath,
                 claw=6 * crack + 2 * wave(t, 2, lag))
    rest_feet(pose)
    # Hangs over the front lip, swaying slowly; a lazy lick as the lid cracks.
    tongue(pose, bend=(2 * wave(t, 2, 0.1), 3 * wave(t, 2, 0.2) - 6 * crack, 4 * wave(t, 2, 0.3) - 14 * crack),
           sway=(3 * wave(t, 1), 5 * wave(t, 1, 0.12), 7 * wave(t, 1, 0.24)))
    return pose


def gait(t, stride, lift, bob, lean, chatter, lid_base, flop=1.0):
    pose = {}
    body(pose, move=(0, 0, bob * (1 - math.cos(4 * math.pi * t)) * 0.5), pitch=lean + 1.5 * wave(t, 2, 0.1),
         roll=3 * wave(t), yaw=4 * wave(t, 1, 0.25))
    lid(pose, lid_base + chatter * (0.5 + 0.5 * wave(t, 2, 0.15)))
    for side, phase in (('L', 0.0), ('R', 0.5)):
        swing = stride * wave(t, 1, phase + 0.25)
        up = max(0.0, wave(t, 1, phase))  # lifted while it swings forward
        arm_pose(pose, side, swing=swing, lift=lift * up, elbow=-0.5 * lift * up, claw=-10 * up + 6)
    for side, phase in (('L', 0.5), ('R', 0.0)):
        up = max(0.0, wave(t, 1, phase))
        foot(pose, side, swing=0.8 * stride * wave(t, 1, phase + 0.25), lift=0.03 * up)
    # Flops with the gait: bounces twice a cycle with the bob, swings with the
    # roll, each segment a little later than the one before.
    tongue(pose, bend=tuple(flop * a * wave(t, 2, 0.2 + 0.08 * i) for i, a in enumerate((6, 9, 12))),
           sway=tuple(flop * a * wave(t, 1, 0.1 + 0.08 * i) for i, a in enumerate((4, 7, 10))))
    return pose


def clip_walk(t):
    return gait(t, MOTION.get('walkStride', 22), MOTION.get('walkLift', 14), 0.012, 2, 4, 1)


def clip_run(t):
    return gait(t, MOTION.get('runStride', 32), MOTION.get('runLift', 20), 0.025, 7, 12, 4, flop=1.6)


def clip_attack(t):
    back = ease(0.0, 0.38, t) * (1 - ease(0.42, 0.55, t))
    lunge = ease(0.42, 0.55, t) * (1 - ease(0.7, 1.0, t))
    wide = MOTION.get('biteOpen', 70)
    opened = wide * ease(0.04, 0.36, t) * (1 - ease(0.46, 0.55, t))
    rebound = 5 * bump(0.55, 0.68, t)
    pose = {}
    body(pose, move=(-0.05 * back + 0.1 * lunge, 0, 0.02 * back - 0.01 * lunge),
         pitch=-14 * back + 12 * lunge)
    lid(pose, opened + rebound)
    for side in ('L', 'R'):
        arm_pose(pose, side, swing=10 * back + 26 * lunge, lift=18 * back - 10 * lunge,
                 elbow=14 * back - 8 * lunge, claw=-18 * back + 22 * lunge)
    for side in ('L', 'R'):
        foot(pose, side, swing=-12 * lunge + 6 * back, shift=-0.04 * back + 0.085 * lunge,
             lift=0.02 * bump(0.4, 0.62, t))
    # Straightens out over the lip, is slurped back into the opening mouth and
    # rears up inside it, then uncurls and lashes forward, flat along the floor,
    # as the lid snaps shut, and flops back over the lip.
    straight = ease(0.02, 0.14, t) * (1 - ease(0.6, 0.92, t))
    slurp = ease(0.12, 0.28, t) * (1 - ease(0.4, 0.5, t))
    rear = ease(0.22, 0.36, t) * (1 - ease(0.38, 0.46, t))
    lash = ease(0.42, 0.52, t) * (1 - ease(0.62, 0.9, t))
    tongue(pose, hang=1 - straight, slide=-0.17 * slurp + 0.05 * lash,
           bend=(-38 * rear + 6 * lash, -40 * rear - 3 * lash, -34 * rear - 8 * lash + 10 * bump(0.7, 0.95, t)),
           sway=(0, 6 * bump(0.45, 0.65, t), 10 * bump(0.48, 0.7, t)))
    return pose


def clip_cast(t):
    up = ease(0.0, 0.2, t) * (1 - ease(0.82, 1.0, t))
    pump = up * max(0.0, math.sin(2 * math.pi * 3 * (t - 0.18) / 0.64)) if 0.18 < t < 0.82 else 0.0
    wide = MOTION.get('castOpen', 75)
    pose = {}
    body(pose, move=(-0.02 * up + 0.015 * pump, 0, 0.012 * up + 0.012 * pump), pitch=-8 * up + 5 * pump)
    lid(pose, wide * up + 8 * pump)
    for side in ('L', 'R'):
        arm_pose(pose, side, swing=-6 * up, lift=-8 * up + 4 * pump, elbow=14 * up, claw=-12 * up)
    rest_feet(pose)
    # Lolls further out and wags side to side while the coins spit.
    wag = up * wave(t, 3)
    tongue(pose, slide=0.03 * up, bend=(4 * up + 5 * pump, 3 * pump, -6 * up),
           sway=(8 * wag, 14 * up * wave(t, 3, 0.08), 20 * up * wave(t, 3, 0.16)))
    return pose


def clip_hit(t):
    jolt = ease(0.0, 0.15, t) * (1 - ease(0.22, 1.0, t))
    clatter = 20 * bump(0.02, 0.4, t)
    pose = {}
    body(pose, move=(-0.04 * jolt, 0, 0.01 * jolt), pitch=-9 * jolt, roll=4 * jolt)
    lid(pose, clatter)
    for side in ('L', 'R'):
        arm_pose(pose, side, swing=-8 * jolt, lift=12 * jolt, elbow=10 * jolt, claw=-10 * jolt)
    for side in ('L', 'R'):
        foot(pose, side, swing=5 * jolt, shift=-0.03 * jolt)
    # Jolts up and out with the blow, then drops back with a small overshoot.
    settle = bump(0.3, 0.8, t)
    tongue(pose, bend=(-22 * jolt + 6 * settle, -16 * jolt + 8 * settle, -12 * jolt + 10 * settle),
           sway=(0, 6 * jolt, 10 * jolt))
    return pose


def clip_death(t):
    stagger = ease(0.0, 0.2, t) * (1 - ease(0.2, 0.5, t))
    fall = ease(0.2, 0.7, t)
    flop = ease(0.35, 0.8, t)
    bounce = 8 * bump(0.8, 0.95, t)
    pose = {}
    body(pose, move=(-0.02 * stagger, 0, 0.015 * stagger - MOTION.get('deathDrop', 0.075) * fall),
         pitch=-8 * stagger + 6 * fall, roll=MOTION.get('deathRoll', 10) * fall)
    lid(pose, 20 * stagger + MOTION.get('deathOpen', 105) * flop - bounce)
    for side in ('L', 'R'):
        arm_pose(pose, side, swing=(8 if side == 'L' else -6) * fall, lift=10 * stagger - 22 * fall,
                 elbow=26 * fall, claw=-20 * stagger + 35 * fall)
    for side in ('L', 'R'):
        foot(pose, side, swing=-6 * fall, lift=MOTION.get('deathDrop', 0.075) * 0.6 * fall, splay=18 * fall)
    # Flicks up in the stagger, then flops out of the gaping mouth, limp.
    limp = MOTION.get('tongueDeath', (18, -12, -30))
    tongue(pose, slide=0.05 * flop, bend=tuple(-12 * stagger + a * flop + 4 * bump(0.8, 0.95, t)
                                                for a in limp),
           sway=(4 * flop, 8 * flop, 10 * flop))
    return pose


def clip_leap(t):
    crouch = ease(0.0, 0.24, t) * (1 - ease(0.26, 0.36, t))
    air = ease(0.28, 0.42, t) * (1 - ease(0.72, 0.84, t))
    land = ease(0.8, 0.87, t) * (1 - ease(0.87, 1.0, t))
    pose = {}
    body(pose, move=(0.01 * air, 0, -0.045 * crouch + 0.07 * air - 0.04 * land),
         pitch=6 * crouch - 10 * air + 8 * land)
    lid(pose, 26 * air + 6 * bump(0.87, 1.0, t))
    for side in ('L', 'R'):
        arm_pose(pose, side, swing=-6 * crouch + 24 * air + 8 * land, lift=-14 * crouch + 26 * air - 18 * land,
                 elbow=-18 * crouch - 10 * air + 22 * land, claw=10 * crouch - 20 * air + 10 * land)
    for side in ('L', 'R'):
        foot(pose, side, swing=6 * crouch - 28 * air, lift=0.05 * air - 0.01 * crouch, splay=10 * land)
    # Trails: dragged down on the way up, floats up on the way down, slaps down
    # on the landing.
    rise = bump(0.28, 0.58, t)
    fallp = bump(0.5, 0.86, t)
    slap = bump(0.8, 1.0, t)
    tongue(pose, bend=(-8 * crouch - 6 * rise - 16 * fallp + 10 * slap,
                       -8 * crouch + 14 * rise - 22 * fallp + 14 * slap,
                       -6 * crouch + 8 * rise - 20 * fallp + 16 * slap),
           sway=(0, 5 * wave(t, 2) * air, 8 * wave(t, 2, 0.1) * air))
    return pose


BAKED = 0.0
if TONGUE:
    # Bake the hanging tongue into the rest pose: the bind pose (and anything
    # that shows the model unanimated) then has it lolling over the lip, not
    # sticking straight out. Each segment's rest turn is X(loll) after Y(hang);
    # tongue() keys the inverse order, so hang=0 undoes it exactly.
    rest_pose = {'TongueBase': {}}
    for i, name in enumerate(TONGUE_BONES[1:]):
        rest_pose[name] = {'turn': [('Y', TONGUE['hang'][i]), ('X', TONGUE.get('loll', (0, 0, 0))[i])]}
    apply_pose(rest_pose)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = mesh_obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    REST.update({b.name: b.matrix_local.copy() for b in arm_data.bones})
    BAKED = 1.0

# name: (function, seconds)
CLIPS = {
    'Idle': (clip_idle, 3.0),
    'Walk': (clip_walk, 1.0),
    'Run': (clip_run, 0.6),
    'Attack': (clip_attack, 1.0),
    'Cast': (clip_cast, 1.2),
    'Hit': (clip_hit, 0.55),
    'Death': (clip_death, 1.7),
    'Leap': (clip_leap, 1.0),
}

os.makedirs(OUT, exist_ok=True)
arm.animation_data_create()
for clip, (fn, seconds) in CLIPS.items():
    if ONLY and clip not in ONLY:
        continue
    action = bpy.data.actions.new(clip)
    action.use_fake_user = True
    arm.animation_data.action = action
    frames = max(2, round(seconds * FPS))
    for f in range(frames + 1):
        apply_pose(fn(f / frames))
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
            pb.keyframe_insert('location', frame=f + 1)
    scene.frame_start, scene.frame_end = 1, frames + 1
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    mesh_obj.select_set(True)
    path = os.path.join(OUT, '%s_%s.glb' % (SPEC['key'], clip.lower()))
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_animations=True, export_animation_mode='ACTIVE_ACTIONS',
        export_optimize_animation_size=False,
    )
    print('WROTE', path, frames + 1, 'frames')
if TONGUE and os.environ.get('TONGUE_CHECK'):
    # Clearance audit: every tongue vertex, every frame, taken back into the
    # lid's and the body's rest space. Flags a vertex above the seam inside the
    # lid (through the roof), in the lid-teeth band while above the floor cap,
    # or (for the part outside the mouth) inside the body's front face.
    FRONT = [(-0.03, 0.25), (-0.05, 0.228), (-0.07, 0.212), (-0.09, 0.2), (-0.12, 0.196), (-0.2, 0.15)]
    t_idx = [i for i, v in enumerate(order) if v in TONGUE_S]
    t_s = [TONGUE_S[order[i]] for i in t_idx]
    bones = arm_data.bones
    for clip in CLIPS:
        act = bpy.data.actions.get(clip)
        if not act:
            continue
        arm.animation_data.action = act
        f0, f1 = (int(x) for x in act.frame_range)
        worst = {}
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            ev = mesh_obj.evaluated_get(dg).data
            inv = {n: (arm.pose.bones[n].matrix @ bones[n].matrix_local.inverted()).inverted()
                   for n in ('Lid', 'Body')}
            hits = {'roof': 0, 'teeth': 0, 'face': 0}
            depth = {'roof': 0.0, 'teeth': 0.0, 'face': 0.0}
            for i, s in zip(t_idx, t_s):
                p = mesh_obj.matrix_world @ ev.vertices[i].co
                pl, pb = inv['Lid'] @ p, inv['Body'] @ p
                al, ab = above(pl), above(pb)
                if al > 0.0005 and pl.x < 0.252 and abs(pl.y) < 0.27:
                    hits['roof'] += 1
                    depth['roof'] = max(depth['roof'], al)
                if 0.17 < pl.x < 0.235 and -0.075 < al < 0 and abs(pl.y) < 0.23 and ab > 0.0015:
                    hits['teeth'] += 1
                    depth['teeth'] = max(depth['teeth'], -al)
                if s > T_LIP + 0.005 and ab < -0.004 and abs(pb.y) < 0.26 and pb.z > -0.25:
                    fx = next((x for z, x in FRONT if pb.z > z), 0.12)
                    if pb.x < fx:
                        hits['face'] += 1
                        depth['face'] = max(depth['face'], fx - pb.x)
            for k, n in hits.items():
                if n and n > worst.get(k, (0,))[0]:
                    worst[k] = (n, f, round(depth[k], 4))
        print('CHECK', clip, worst or 'clean')
if BLEND:
    arm.animation_data.action = bpy.data.actions.get('Idle') or arm.animation_data.action
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print('SAVED', BLEND)
