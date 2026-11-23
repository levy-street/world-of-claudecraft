"""The destrier's hide: a heavy war horse grown out of our valorsteed riding horse.

The valorsteed is a slim, low-poly riding horse (about two thousand faceted triangles). Its rig
and its authored gaits are good, its body is not a destrier. So the body is rebuilt here and the
rig is kept:

1. The source hide is welded (its triangles are split along every colour seam), its hair is cut
   away, and the rest is voxel-remeshed into one closed, evenly tessellated skin.
2. The source's skin weights are carried onto the new skin from the surface they were painted
   on, before anything moves, so every vertex keeps the bones it had.
3. The skin is then grown into a destrier bone by bone: each vertex is pushed away from the bone
   segments that carry it (by its own weights), so the barrel deepens, the chest and croup
   broaden, the crest of the neck thickens and the legs grow heavy, and the joints blend because
   the weights do. Legs grow only in the horizontal plane, so the hooves keep the ground.
4. The skin is relaxed, decimated to a game budget and painted: an iron dapple grey coat that
   darkens down the legs to black points, a pale muzzle, dark hooves.
5. New hair is grown from the rig's own hair and tail bones (a heavy crest mane that falls to the
   off side, a forelock, a full tail), white feathering over every hoof and glossy eyes.

Original procedural work for this project: no imported meshes beyond our own horse.
"""
import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree
from mathutils.noise import voronoi

from steed_kit import L, fu, rigid, sphere, tube

HAIR_PREFIXES = ('hair_', 'c_tail_')

# Growth per bone family: (lateral, fore-aft or vertical, mode). Legs grow horizontally only;
# the trunk widens and deepens below the spine (the back and the saddle line stay put); the neck
# grows round its own axis, wider than deep, so the crest reads heavy from the side and the front.
GROW = {
    # trunk
    'root.x_02': (1.30, 1.16, 'trunk'),
    'spine_01.x_021': (1.30, 1.22, 'trunk'),
    'spine_02.x_022': (1.32, 1.20, 'trunk'),
    'clavicle.l_042': (1.30, 1.18, 'trunk'),
    'clavicle.r_049': (1.30, 1.18, 'trunk'),
    # neck
    'c_subneck_1.x_023': (1.55, 1.3, 'axis'),
    'c_subneck_2.x_024': (1.5, 1.3, 'axis'),
    'neck.x_027': (1.36, 1.2, 'axis'),
    # head: the jaw carries the heavy cheek of a draught horse
    'jaw_041': (1.2, 1.08, 'axis'),
    'head.x_031': (1.08, 1.04, 'axis'),
    # hind leg: haunch, gaskin, hock, cannon, fetlock, hoof
    'c_thigh_b.l_07': (1.30, 1.18, 'leg'),
    'c_thigh_b.r_014': (1.30, 1.18, 'leg'),
    'thigh_stretch.l_08': (1.34, 1.22, 'leg'),
    'thigh_stretch.r_015': (1.34, 1.22, 'leg'),
    'thigh_twist.l_013': (1.34, 1.22, 'leg'),
    'thigh_twist.r_020': (1.34, 1.22, 'leg'),
    'leg_stretch.l_09': (1.34, 1.26, 'leg'),
    'leg_stretch.r_016': (1.34, 1.26, 'leg'),
    'leg_twist.l_012': (1.40, 1.30, 'leg'),
    'leg_twist.r_019': (1.40, 1.30, 'leg'),
    'foot.l_010': (1.55, 1.45, 'leg'),
    'foot.r_017': (1.55, 1.45, 'leg'),
    'toes_01.l_011': (1.50, 1.40, 'leg'),
    'toes_01.r_018': (1.50, 1.40, 'leg'),
    # foreleg: shoulder, forearm, knee, cannon, fetlock, hoof
    'c_thigh_b_dupli_001.l_043': (1.28, 1.2, 'leg'),
    'c_thigh_b_dupli_001.r_050': (1.28, 1.2, 'leg'),
    'thigh_stretch_dupli_001.l_044': (1.40, 1.26, 'leg'),
    'thigh_stretch_dupli_001.r_051': (1.40, 1.26, 'leg'),
    'thigh_twist_dupli_001.l_048': (1.40, 1.26, 'leg'),
    'thigh_twist_dupli_001.r_056': (1.40, 1.26, 'leg'),
    'leg_stretch_dupli_001.l_045': (1.36, 1.28, 'leg'),
    'leg_stretch_dupli_001.r_052': (1.36, 1.28, 'leg'),
    'leg_twist_dupli_001.l_047': (1.40, 1.30, 'leg'),
    'leg_twist_dupli_001.r_055': (1.40, 1.30, 'leg'),
    'foot_dupli_001.l_00': (1.55, 1.45, 'leg'),
    'foot_dupli_001.r_053': (1.55, 1.45, 'leg'),
    'toes_01_dupli_001.l_046': (1.50, 1.40, 'leg'),
    'toes_01_dupli_001.r_054': (1.50, 1.40, 'leg'),
}


# The legs grow by height, not by bone, so each joint can read: a heavy forearm and gaskin, a
# bony knee and hock, flat cannons, and the big round fetlock a feathered draught horse stands
# on. (u, growth) pairs, u up from the hooves in model units.
LEG_FRONT = ((0.0, 1.45), (0.04, 1.45), (0.08, 1.5), (0.13, 1.62), (0.2, 1.3), (0.34, 1.26),
             (0.42, 1.46), (0.48, 1.34), (0.62, 1.44), (0.8, 1.3), (1.1, 1.22))
LEG_HIND = ((0.0, 1.45), (0.04, 1.45), (0.08, 1.5), (0.12, 1.62), (0.2, 1.3), (0.31, 1.26),
            (0.38, 1.4), (0.44, 1.36), (0.56, 1.4), (0.72, 1.3), (1.05, 1.28))


def leg_profile(front, u):
    table = LEG_FRONT if front else LEG_HIND
    if u <= table[0][0]:
        return table[0][1]
    for (u0, k0), (u1, k1) in zip(table, table[1:]):
        if u <= u1:
            t = (u - u0) / (u1 - u0)
            t = t * t * (3 - 2 * t)
            return k0 + (k1 - k0) * t
    return table[-1][1]


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def _closest_on_segment(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return a + ab * t, t


def _dominant(v, names):
    if not v.groups:
        return ''
    g = max(v.groups, key=lambda g: g.weight)
    return names[g.group]


def weld_source(body):
    """A welded working copy of the source hide (the GLB splits it along every colour seam)."""
    me = body.data.copy()
    ob = bpy.data.objects.new('HideSource', me)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = body.matrix_world.copy()
    # the group names travel with the mesh data: only add any the copy lacks
    for g in body.vertex_groups:
        if ob.vertex_groups.get(g.name) is None:
            ob.vertex_groups.new(name=g.name)
    # the source's custom split normals and sharp flags belong to its faceted look
    for attr in ('custom_normal', 'sharp_face', 'sharp_edge'):
        if attr in me.attributes:
            me.attributes.remove(me.attributes[attr])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
    bm.to_mesh(me)
    bm.free()
    return ob


def cut_hair(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    dl = bm.verts.layers.deform.active
    hair = set()
    for v in bm.verts:
        d = v[dl]
        if d:
            g = max(d.items(), key=lambda kv: kv[1])[0]
            if names[g].startswith(HAIR_PREFIXES):
                hair.add(v.index)
    drop = [f for f in bm.faces if sum(1 for v in f.verts if v.index in hair) >= 2]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()


def close_holes(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm, edges=bm.edges[:], sides=0)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    left = sum(1 for e in bm.edges if e.is_boundary)
    bm.to_mesh(ob.data)
    bm.free()
    return left


class HairRef:
    """The source's own hair, kept as a weight field: every new lock takes, point by point,
    the skin weights of the nearest vertex of the old mane or tail, so it rides the hair and
    tail bones exactly as the clips were authored to move them."""

    def __init__(self, ob):
        names = {g.index: g.name for g in ob.vertex_groups}
        pts, ws = [], []
        for v in ob.data.vertices:
            w = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
            if w and max(w.items(), key=lambda kv: kv[1])[0].startswith(HAIR_PREFIXES):
                pts.append(v.co.copy())
                ws.append(w)
        self.tree = KDTree(len(pts))
        for i, c in enumerate(pts):
            self.tree.insert(c, i)
        self.tree.balance()
        self.ws = ws

    def weights(self, co, prefix):
        """Weights of the nearest source hair vertex whose own top bone starts with `prefix`."""
        for _, i, _ in self.tree.find_n(Vector(co), 24):
            w = self.ws[i]
            if max(w.items(), key=lambda kv: kv[1])[0].startswith(prefix):
                return dict(w)
        _, i, _ = self.tree.find(Vector(co))
        return dict(self.ws[i])


HAIR_REF = None


def capture_hair_ref(ob):
    global HAIR_REF
    HAIR_REF = HairRef(ob)


def make_hide(body, voxel=0.011):
    """The new skin, weighted, before it grows: see steps 1 and 2 of the module header.

    The voxel remesher needs a closed surface (an open one comes back as a doubled sheet), so the
    whole welded horse is remeshed first, hair and all; the hair is then cut out of that clean
    skin, whose holes are simple loops that fill shut, and the closed result is remeshed again.
    The weights come from the source with its hair cut away, so no strand of the old mane
    leaves a hair bone's pull on the crest."""
    full = weld_source(body)
    capture_hair_ref(full)
    # round the source's flat facets off before anything samples it: the remesh would
    # otherwise copy every facet of the low-poly horse into the new skin as a dent
    sub = full.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2
    bpy.context.view_layer.objects.active = full
    bpy.ops.object.modifier_apply(modifier=sub.name)
    skin = weld_source(full)
    skin.name = 'DestrierHide'
    remesh(skin, voxel)
    transfer_weights(skin, full)
    cut_hair(skin)
    left = close_holes(skin)
    if left:
        print('WARN hide holes left open:', left)
    remesh(skin, voxel)
    bare = weld_source(full)
    cut_hair(bare)
    transfer_weights(skin, bare)
    normalize_top4(skin)
    bpy.data.objects.remove(full)
    bpy.data.objects.remove(bare)
    return skin


def remesh(ob, voxel):
    me = ob.data
    me.remesh_voxel_size = voxel
    me.remesh_voxel_adaptivity = 0.0
    me.use_remesh_fix_poles = True
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.voxel_remesh()


def transfer_weights(dst, src):
    for g in src.vertex_groups:
        if dst.vertex_groups.get(g.name) is None:
            dst.vertex_groups.new(name=g.name)
    mod = dst.modifiers.new('wt', 'DATA_TRANSFER')
    mod.object = src
    mod.use_vert_data = True
    mod.data_types_verts = {'VGROUP_WEIGHTS'}
    mod.vert_mapping = 'POLYINTERP_NEAREST'
    mod.layers_vgroup_select_src = 'ALL'
    mod.layers_vgroup_select_dst = 'NAME'
    bpy.context.view_layer.objects.active = dst
    bpy.ops.object.modifier_apply(modifier=mod.name)


def normalize_top4(ob):
    for v in ob.data.vertices:
        gs = sorted(((g.group, g.weight) for g in v.groups), key=lambda kv: -kv[1])
        keep = [kv for kv in gs[:4] if kv[1] > 1e-3]
        s = sum(w for _, w in keep) or 1.0
        drop = [gi for gi, _ in gs if gi not in {k for k, _ in keep}]
        for gi in drop:
            ob.vertex_groups[gi].remove([v.index])
        for gi, w in keep:
            ob.vertex_groups[gi].add([v.index], w / s, 'REPLACE')


def grow(ob, arm):
    """Push each vertex away from the bones that carry it (see the module header)."""
    bones = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    names = {g.index: g.name for g in ob.vertex_groups}
    me = ob.data
    out = []
    for v in me.vertices:
        p = v.co.copy()
        disp = Vector((0, 0, 0))
        tot = 0.0
        for g in v.groups:
            name = names[g.group]
            spec = GROW.get(name)
            if spec is None or g.weight <= 0:
                continue
            kl, kv, mode = spec
            a, b = bones[name]
            q, _ = _closest_on_segment(p, a, b)
            r = p - q
            if mode == 'leg':
                k = leg_profile('dupli' in name, fu(p)[2])
                d = Vector((r.x * (k - 1), r.y * (k * 0.96 - 1), 0.0))
            elif mode == 'trunk':
                down = r.z if r.z < 0 else 0.0
                # the barrel swells below; the top of the back, where the saddle sits and the
                # rider's thighs close round it, stays near the riding horse's width so a rider
                # can straddle it with his knees outside the barding
                top = smoothstep(0.92, 1.12, fu(p)[2])
                # and the girth, under the saddle where the rider's legs hang, stays close to
                # the riding horse's: the heavy chest and quarters carry the destrier's bulk, a
                # barrel as broad as them would leave no rider's legs room to close round it
                fg = fu(p)[1]
                girth = smoothstep(-0.36, -0.2, fg) * (1 - smoothstep(0.2, 0.36, fg))
                kx = 1 + (kl - 1) * (1 - 0.65 * top) * (1 - 0.8 * girth)
                d = Vector((r.x * (kx - 1), 0.0, down * (kv - 1)))
            else:  # round the bone's own axis, wider across than deep
                ax = (b - a).normalized()
                rr = r - ax * r.dot(ax)
                lat = Vector((rr.x, 0, 0))
                rest = rr - lat
                d = lat * (kl - 1) + rest * (kv - 1)
            disp += d * g.weight
            tot += g.weight
        out.append(p + disp)
    for v, co in zip(me.vertices, out):
        v.co = co


def shape_details(ob):
    """Hand-placed anatomy the bone growth cannot give: the arched crest of the neck, a deep
    breast between the forelegs, the round double croup, a heavy jowl. Each is a soft swell
    measured in the rest frame (x left, f forward, u up)."""
    for v in ob.data.vertices:
        x, f, u = fu(v.co)
        # the crest: the top line of the neck arches up and the upper neck thickens
        neck = smoothstep(0.32, 0.45, f) * (1 - smoothstep(0.62, 0.74, f))
        top = smoothstep(1.12, 1.36, u)
        v.co.z += 0.045 * neck * top * (1 - smoothstep(0.0, 0.12, abs(x)) * 0.0)
        # the breast: the point of the chest swells forward between the forelegs
        chest = math.exp(-(((f - 0.47) / 0.1) ** 2) - (((u - 0.86) / 0.16) ** 2))
        v.co.y -= 0.05 * chest * (1 - smoothstep(0.1, 0.24, abs(x)))
        # the croup: a split, rounded rump either side of the spine
        croup = math.exp(-(((f + 0.52) / 0.16) ** 2) - (((u - 1.0) / 0.14) ** 2))
        side = smoothstep(0.02, 0.14, abs(x))
        v.co.x += math.copysign(0.035 * croup * side, x)
        v.co.z += 0.02 * croup * side
        # the jowl: the round of the cheek behind the jaw
        jowl = math.exp(-(((f - 0.79) / 0.06) ** 2) - (((u - 1.41) / 0.07) ** 2))
        v.co.x += math.copysign(0.025 * jowl, x) if abs(x) > 0.01 else 0.0


def relax(ob, factor=0.5, repeat=4, protect=('c_ear_', 'eye.')):
    """A light Laplacian relax, masked off the ears and eyes (thin parts a relax would melt)."""
    mask = ob.vertex_groups.new(name='_relax')
    names = {g.index: g.name for g in ob.vertex_groups}
    for v in ob.data.vertices:
        w = 1.0
        for g in v.groups:
            if names.get(g.group, '').startswith(protect):
                w -= g.weight
        mask.add([v.index], max(0.0, w), 'REPLACE')
    mod = ob.modifiers.new('relax', 'SMOOTH')
    mod.factor = factor
    mod.iterations = repeat
    mod.vertex_group = mask.name
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.vertex_groups.remove(ob.vertex_groups['_relax'])


def decimate(ob, tris):
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, tris / max(n, 1))
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=mod.name)




# ---------------------------------------------------------------------------
# The coat: an iron dapple grey, painted per vertex and smooth across faces (one
# continuous coat, not a patchwork of facets). Round pale dapples over the barrel,
# shoulder and quarters on a dark steel ground, darker under the belly and the
# jaw, black points from the knees and hocks down, a dark face and a soft grey
# muzzle. A little light is painted into the top of every form, the way the hand
# painted mounts carry it, so the anatomy still reads under flat midday light.
# ---------------------------------------------------------------------------
COAT = {
    'base': (0.125, 0.13, 0.142),
    'dapple': (0.36, 0.37, 0.38),
    'shade': (0.03, 0.032, 0.038),
    'point': (0.012, 0.012, 0.015),
    'face': (0.07, 0.072, 0.08),
    'muzzle': (0.16, 0.155, 0.155),
    'nostril': (0.012, 0.01, 0.011),
    'ear_in': (0.02, 0.016, 0.017),
}

LEG_KEYS = ('leg_', 'foot', 'toes', 'thigh_stretch', 'thigh_twist')


def coat_colour(co, nrm, names_w):
    x, f, u = fu(co)
    leg = sum(w for n, w in names_w.items() if any(k in n for k in LEG_KEYS))
    head = sum(w for n, w in names_w.items() if n.startswith(('head', 'jaw', 'eye', 'c_ear')))
    ear = sum(w for n, w in names_w.items() if n.startswith('c_ear'))
    c = Vector(COAT['base'])
    # dapples: round pale spots in a darker net, densest over the barrel and quarters
    d = voronoi(Vector((x * 8.0, f * 8.0, u * 8.0)))[0]
    spot = 1.0 - smoothstep(0.08, 0.52, d[0])
    net = smoothstep(0.0, 0.22, d[1] - d[0])
    body = (1 - min(1.0, leg * 1.3)) * (1 - head) * smoothstep(0.62, 0.8, u)
    neck = smoothstep(0.3, 0.55, f)
    dap = body * (1 - 0.55 * neck) * spot * net
    c = c.lerp(Vector(COAT['dapple']), min(1.0, dap * 0.95 + body * 0.18))
    # shade under the belly, the chest and the throat
    under = smoothstep(0.92, 0.6, u) * (1 - leg)
    c = c.lerp(Vector(COAT['shade']), under * 0.6)
    # points: black from the forearm and gaskin down
    c = c.lerp(Vector(COAT['point']), smoothstep(0.58, 0.32, u) * 0.96)
    # the face: darker than the neck, a soft grey muzzle, dark nostrils, dark inner ears
    if head > 0.05:
        c = c.lerp(Vector(COAT['face']), 0.7 * head)
        muzzle = smoothstep(0.84, 0.94, f) * head
        c = c.lerp(Vector(COAT['muzzle']), muzzle * 0.85)
        nose = smoothstep(0.95, 0.99, f) * smoothstep(1.3, 1.36, u) * head
        c = c.lerp(Vector(COAT['nostril']), nose * 0.7)
    if ear > 0.5:
        c = c.lerp(Vector(COAT['ear_in']), 0.5)
    # painted top light: forms catch a little more light where they face the sky
    lift = 0.82 + 0.34 * max(0.0, nrm.z) + 0.06 * max(0.0, -nrm.y)
    return c * lift


def paint_coat(ob):
    me = ob.data
    names = {g.index: g.name for g in ob.vertex_groups}
    vcol = []
    for v in me.vertices:
        w = {names[g.group]: g.weight for g in v.groups}
        vcol.append(coat_colour(v.co, v.normal, w))
    col = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    for li, loop in enumerate(me.loops):
        c = vcol[loop.vertex_index]
        col.data[li].color = (c.x, c.y, c.z, 1.0)
    for p in me.polygons:
        p.use_smooth = True


# ---------------------------------------------------------------------------
# Hair. Every lock is a lofted clump: an oval section that tapers from a full root
# to a point, swept along a curve and bound along the bones it should ride, so the
# mane and tail swing with the rig's own hair and tail bones in every clip.
# ---------------------------------------------------------------------------
HAIR = {
    'root': (0.2, 0.205, 0.215),
    'mid': (0.58, 0.59, 0.6),
    'tip': (0.9, 0.9, 0.9),
    'feather': (0.86, 0.85, 0.83),
    'feather_root': (0.02, 0.02, 0.024),
    'hoof': (0.035, 0.03, 0.03),
    'hoof_band': (0.09, 0.08, 0.075),
    'sole': (0.02, 0.018, 0.018),
}


def hair_col(t):
    c = Vector(HAIR['root']).lerp(Vector(HAIR['mid']), min(1.0, t * 2.2))
    if t > 0.45:
        c = c.lerp(Vector(HAIR['tip']), min(1.0, (t - 0.45) / 0.55))
    return tuple(c)


def clump(p, pts, r0, weights, col_fn, up_hint, flat=0.5, sides=5, mat='steed_hair', taper=0.85):
    """A tapered oval tube through `pts`, wider along `up_hint`'s side axis than through it."""
    n = len(pts)
    rings = []
    for k in range(n):
        t = k / (n - 1)
        a = pts[k]
        along = (pts[min(k + 1, n - 1)] - pts[max(k - 1, 0)]).normalized()
        upv = Vector(up_hint) - along * Vector(up_hint).dot(along)
        if upv.length < 1e-5:
            upv = Vector((0, 0, 1)) - along * along.z
        upv.normalize()
        side = along.cross(upv).normalized()
        r = r0 * max(0.0, 1 - t) ** taper
        ring = []
        for s in range(sides):
            q = 2 * math.pi * s / sides
            ring.append(p.v(a + side * (math.cos(q) * r) + upv * (math.sin(q) * r * flat), weights[k]))
        rings.append(ring)
    for k in range(n - 1):
        c0, c1 = col_fn(k / (n - 1)), col_fn((k + 1) / (n - 1))
        for s in range(sides):
            ss = (s + 1) % sides
            # a little light down the top of the lock, its underside in shade
            lit = [0.78 + 0.22 * max(0.0, math.sin(2 * math.pi * q / sides)) for q in (s, ss)]
            cols = [tuple(x * lit[0] for x in c0), tuple(x * lit[0] for x in c1),
                    tuple(x * lit[1] for x in c1), tuple(x * lit[1] for x in c0)]
            p.f([rings[k][s], rings[k + 1][s], rings[k + 1][ss], rings[k][ss]], mat, cols, True)
    p.f(list(reversed(rings[0])), mat, col_fn(0), True)


def _blend(a, b, t):
    out = {}
    for k, w in a.items():
        out[k] = out.get(k, 0) + w * (1 - t)
    for k, w in b.items():
        out[k] = out.get(k, 0) + w * t
    out = {k: w for k, w in out.items() if w > 1e-4}
    top = sorted(out.items(), key=lambda kv: -kv[1])[:4]
    s = sum(w for _, w in top) or 1
    return {k: w / s for k, w in top}



# The crest, withers to poll, as rest-frame (f, u) points the locks root along (cast down
# onto the hide), and which of the source's hair chains each stretch of the mane rides.
CREST = ((0.36, 1.2), (0.44, 1.31), (0.52, 1.42), (0.59, 1.52), (0.645, 1.6))
MANE_CHAINS = ((0.0, 'hair_03'), (0.3, 'hair_02'), (0.62, 'hair_01'))


def _crest_point(s):
    k = s * (len(CREST) - 1)
    i0 = min(int(k), len(CREST) - 2)
    (f0, u0), (f1, u1) = CREST[i0], CREST[i0 + 1]
    fr = k - i0
    return f0 + (f1 - f0) * fr, u0 + (u1 - u0) * fr


def mane(p, sampler, rng):
    """A heavy crest mane in layered rows. The locks root along the crest and fall over to the
    off (right) side of the neck in waves, lying on the hide, the longest at mid-neck. The rig's
    hair chains rest streaming back off the crest and the clips toss them from there, so each
    lock rides the nearest strand of the source's own mane only partway: enough to lift and
    stream at a gallop, not so much that the idle stands it up like a fin."""
    mane_roll(p, sampler)
    rows = ((0.018, 11, 0.75), (0.0, 14, 1.0), (-0.016, 13, 1.05), (-0.03, 11, 0.9))
    for lat, locks, scale in rows:
        for i in range(locks):
            s = min(1.0, (i + 0.5 * rng()) / (locks - 1))
            f, u = _crest_point(s)
            hit = sampler.ray(L(lat, f, u + 0.4), Vector((0, 0, -1)))
            if not hit:
                continue
            root = hit[0] - hit[1] * 0.014
            chain = [c for th, c in MANE_CHAINS if s >= th][-1]
            length = (0.16 + 0.14 * math.sin(math.pi * min(1.0, 0.12 + s * 0.85))) * scale
            length *= 0.85 + 0.3 * rng()
            w_root = sampler.weights_at(root)
            segs = 7
            pts, ws = [], []
            for j in range(segs):
                t = j / (segs - 1)
                # over the crest and down the off side, sweeping a little back, a wave in it
                over = -(0.02 + 0.07 * math.sin(min(1.0, t * 1.6) * math.pi / 2)) * (0.8 + scale * 0.3)
                drop = -length * max(0.0, t - 0.12) ** 1.15
                rise = 0.035 * math.sin(min(1.0, t * 2.5) * math.pi / 2) * (1 - t)
                back = 0.045 * t + 0.012 * math.sin(t * 6 + i * 0.8)
                q = root + Vector((over, back, rise + drop))
                if t > 0.08:
                    # draped: past the root every point lies ON the neck at the lock's own
                    # depth (over the crinet's lames where they are), so no tip stands off it
                    nh = sampler.nearest(q)
                    if nh[0] is not None:
                        lie = 0.016 + 0.012 * (1 - scale) + 0.05 * _over_crinet(q)
                        hug = smoothstep(0.08, 0.3, t)
                        gap = (q - nh[0]).dot(nh[1])
                        q = q + nh[1] * ((lie - gap) * hug if gap > lie else (lie - gap))
                pts.append(q)
                ws.append(_blend(w_root, HAIR_REF.weights(q, chain), 0.14 * min(1.0, t / 0.6)))
            r0 = (0.05 + 0.012 * rng()) * scale
            clump(p, pts, r0, ws, hair_col, up_hint=(-0.3, 0, 1), flat=0.42, taper=0.65)


def mane_roll(p, sampler):
    """The body of the mane: one thick roll of hair along the crest under the locks, so the
    crest reads as a mass of hair rather than a row of separate spikes against the sky."""
    pts, ws = [], []
    n = 14
    for i in range(n):
        f, u = _crest_point(0.02 + 0.96 * i / (n - 1))
        hit = sampler.ray(L(0, f, u + 0.4), Vector((0, 0, -1)))
        if not hit:
            continue
        pts.append(hit[0] + hit[1] * 0.012 + Vector((-0.012, 0, 0)))
        ws.append(sampler.weights_at(hit[0]))
    if len(pts) < 3:
        return
    rings = []
    sides = 8
    for k, a in enumerate(pts):
        along = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        upv = Vector((0, 0, 1)) - along * along.z
        upv.normalize()
        side = along.cross(upv).normalized()
        t = k / (len(pts) - 1)
        r = 0.05 * (0.55 + 0.45 * math.sin(math.pi * min(1.0, 0.1 + t)))
        ring = []
        for q in range(sides):
            ang = 2 * math.pi * q / sides
            ring.append(p.v(a + side * (math.cos(ang) * r * 1.15) + upv * (math.sin(ang) * r * 0.7), ws[k]))
        rings.append(ring)
    for k in range(len(rings) - 1):
        for q in range(sides):
            qq = (q + 1) % sides
            lit = [0.75 + 0.25 * max(0.0, math.sin(2 * math.pi * x / sides)) for x in (q, qq)]
            c = [tuple(v * lit[0] for v in HAIR['mid']), tuple(v * lit[0] for v in HAIR['mid']),
                 tuple(v * lit[1] for v in HAIR['mid']), tuple(v * lit[1] for v in HAIR['mid'])]
            p.f([rings[k][q], rings[k + 1][q], rings[k + 1][qq], rings[k][qq]], 'steed_hair', c, True)
    p.f(list(reversed(rings[0])), 'steed_hair', HAIR['mid'], True)
    p.f(rings[-1], 'steed_hair', HAIR['mid'], True)


def _over_crinet(co):
    """How far into the crinet's height band a point on the neck is (0 outside, 1 inside):
    there the mane lies over the steel lames instead of on the hide."""
    _, f, u = fu(co)
    return smoothstep(1.14, 1.2, u) * (1 - smoothstep(1.56, 1.62, u)) * smoothstep(0.38, 0.44, f)


def forelock(p, sampler, head):
    """A thick forelock between the ears, falling over the brow to one side of the chanfron."""
    for ox, ln in ((0.02, 0.15), (-0.005, 0.18), (-0.03, 0.14)):
        hit = sampler.ray(L(ox, 0.64, 2.0), Vector((0, 0, -1)))
        if not hit:
            continue
        root = hit[0] - hit[1] * 0.008
        pts, ws = [], []
        for j in range(6):
            t = j / 5
            q = root + Vector((ox * 1.2 * t - 0.03 * t, -0.07 * t,
                               0.025 * math.sin(t * math.pi) - ln * t ** 1.2))
            nh = sampler.nearest(q)
            if nh[0] is not None and t > 0.1:
                gap = (q - nh[0]).dot(nh[1])
                if gap < 0.025:
                    q = q + nh[1] * (0.025 - gap)
            pts.append(q)
            ws.append(rigid(head))
        clump(p, pts, 0.026, ws, hair_col, up_hint=(0, -1, 0.3), flat=0.5)




def tail(p, sampler, arm, rng):
    """A full, heavy tail. Like the mane, the tail chain rests straight back off the croup and
    the clips let it fall and stream, so the locks are authored along it: a fan rooted round the
    dock that swells to a full switch and tapers to the end, each point riding the nearest strand
    of the source's own tail."""
    dock = arm.data.bones['c_tail_00.x_03'].head_local.copy()
    w_root = sampler.weights_at(dock + Vector((0, -0.02, 0)))
    locks = 22
    for i in range(locks):
        a = 2 * math.pi * i / locks + 0.3 * rng()
        # a switch, not a fan: deeper than it is wide, so a gallop streams it as one bundle
        rad = Vector((math.cos(a) * 0.5, 0, math.sin(a) * 0.7))
        length = 0.98 + 0.12 * rng()
        segs = 9
        pts, ws = [], []
        for j in range(segs):
            t = j / (segs - 1)
            spread = 0.026 + 0.06 * math.sin(min(1.0, t * 1.25) * math.pi / 2) - 0.03 * t ** 3
            wave = 0.018 * math.sin(t * 5.0 + i * 0.9) * t
            q = dock + Vector((0, length * t, 0.015 * math.sin(t * math.pi))) + rad * spread
            q.x += wave
            pts.append(q)
            ws.append(_blend(w_root, HAIR_REF.weights(q, 'c_tail'), min(1.0, t / 0.2)))
        clump(p, pts, 0.044 + 0.012 * rng(), ws, hair_col, up_hint=(rad.x, 0, rad.z), flat=0.62,
              taper=0.65)



# ---------------------------------------------------------------------------
# Hooves and feathering. A draught horse stands on big round hooves under long white
# feathers that fall from the back of the fetlock over the coronet.
# ---------------------------------------------------------------------------
FEET = (
    ('foot.l_010', 'toes_01.l_011'),
    ('foot.r_017', 'toes_01.r_018'),
    ('foot_dupli_001.l_00', 'toes_01_dupli_001.l_046'),
    ('foot_dupli_001.r_053', 'toes_01_dupli_001.r_054'),
)


def leg_radius(sampler, centre, u, n=16, reach=0.16):
    """Mean horizontal radius of the hide round `centre` at height `u`, and its centre."""
    c = Vector((centre.x, centre.y, L(0, 0, u).z))
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        d = Vector((math.cos(a), math.sin(a), 0))
        hit = sampler.ray(c + d * reach, -d)
        if hit and (hit[0] - c).length < reach:
            pts.append(hit[0])
    if len(pts) < n // 2:
        return 0.05, c
    m = sum(pts, Vector()) / len(pts)
    m.z = c.z
    return sum((Vector((q.x, q.y, m.z)) - m).length for q in pts) / len(pts), m


def hoof(p, sampler, arm, foot, toes):
    """A hoof: a horn wall flaring from the coronet to the ground, its toe sloping forward, a
    darker coronet band, a sole underneath. Rigid on the toe bone."""
    h = arm.data.bones[toes].head_local
    r_top, c = leg_radius(sampler, h, 0.055)
    r_top *= 1.08
    r_bot = r_top * 1.22
    W = rigid(toes)
    sides = 18
    rows = ((0.0, r_bot, HAIR['sole']), (0.008, r_bot, HAIR['hoof']), (0.05, r_top * 1.06, HAIR['hoof']),
            (0.072, r_top, HAIR['hoof_band']), (0.08, r_top * 0.86, HAIR['hoof_band']))
    rings = []
    for (uu, r, col) in rows:
        ring = []
        for s in range(sides):
            q = 2 * math.pi * s / sides
            dx, dy = math.cos(q), math.sin(q)
            fore = max(0.0, -dy)  # -y is forward: the toe reaches out and slopes
            rr = r * (1 + 0.14 * fore - 0.06 * max(0.0, dy))
            lean = -0.018 * fore * (1 - uu / 0.08)
            ring.append(p.v(Vector((c.x + dx * rr, c.y + dy * rr * 1.08 + lean, L(0, 0, uu).z)), W))
        rings.append((ring, col))
    for (ra, ca), (rb, _) in zip(rings, rings[1:]):
        for s in range(sides):
            ss = (s + 1) % sides
            p.f([ra[s], ra[ss], rb[ss], rb[s]], 'steed_hoof', ca, True)
    p.f(list(reversed(rings[0][0])), 'steed_hoof', HAIR['sole'])
    p.f(rings[-1][0], 'steed_hoof', HAIR['hoof_band'])
    return r_top, c


def feather(p, sampler, arm, foot, toes, hoof_r, hoof_c, rng):
    """The feathering: long white hair falling from the back of the cannon and round the
    fetlock, flaring out over the hoof to the ground behind, shorter over the toe so the horn
    shows, its hem broken into points. Rooted in the black of the leg so it grows out of it
    rather than sitting on it like a cuff. Two-sided, bound to the leg at the top and the toe
    bone at the hem."""
    sides = 18
    rows = 6
    top_c = arm.data.bones[foot].head_local
    outer, inner = [], []
    for rI in range(rows):
        t = rI / (rows - 1)
        ring_o, ring_i = [], []
        for s in range(sides):
            q = 2 * math.pi * s / sides
            dx, dy = math.cos(q), math.sin(q)
            back = max(0.0, dy)  # +y toward the tail
            # the root line climbs the back of the cannon; the hem sweeps the ground behind
            top_u = 0.2 + 0.12 * back
            jag = (0.026, -0.02, 0.01)[s % 3] + 0.012 * (rng() - 0.5)
            hem = max(0.006, 0.07 - 0.065 * back + jag)
            u = top_u + (hem - top_u) * t
            r_leg, c_leg = leg_radius(sampler, top_c, u if t < 0.6 else 0.12)
            flare = r_leg * (1.0 + 0.08 * t) + (hoof_r * 1.5 + 0.02 * back - r_leg) * max(0.0, t - 0.25) ** 1.2
            ctr = c_leg.lerp(Vector((hoof_c.x, hoof_c.y + 0.01, 0)), smoothstep(0.3, 1.0, t))
            base = Vector((ctr.x + dx * flare, ctr.y + dy * flare * 1.06, L(0, 0, u).z))
            root_pt = Vector((c_leg.x + dx * r_leg, c_leg.y + dy * r_leg, L(0, 0, top_u).z))
            w = sampler.weights_at(root_pt)
            if t > 0.3:
                w = _blend(w, {toes: 1.0}, smoothstep(0.3, 0.9, t))
            inward = Vector((dx, dy, 0)) * 0.007
            ring_o.append(p.v(base, w))
            ring_i.append(p.v(base - inward, w))
        outer.append(ring_o)
        inner.append(ring_i)

    def fcol(t, s):
        c = Vector(HAIR['feather_root']).lerp(Vector(HAIR['feather']), smoothstep(0.0, 0.45, t))
        streak = (1.0, 0.84, 0.93)[s % 3]
        return tuple(c * streak)

    for rI in range(rows - 1):
        t0, t1 = rI / (rows - 1), (rI + 1) / (rows - 1)
        for s in range(sides):
            ss = (s + 1) % sides
            c = [fcol(t0, s), fcol(t1, s), fcol(t1, ss), fcol(t0, ss)]
            o0, o1, i0, i1 = outer[rI], outer[rI + 1], inner[rI], inner[rI + 1]
            p.f([o0[s], o1[s], o1[ss], o0[ss]], 'steed_hair', c, True)
            p.f([i0[ss], i1[ss], i1[s], i0[s]], 'steed_hair', [c[3], c[2], c[1], c[0]], True)
    for s in range(sides):
        ss = (s + 1) % sides
        o, i = outer[-1], inner[-1]
        p.f([o[s], o[ss], i[ss], i[s]], 'steed_hair', HAIR['feather'])


def hooves_and_feathers(p, sampler, arm, rng):
    for foot, toes in FEET:
        r, c = hoof(p, sampler, arm, foot, toes)
        feather(p, sampler, arm, foot, toes, r, c, rng)


def ellipsoid(p, c, frame, radii, mat, col, w, seg=12, rings=8):
    """A sphere stretched along an arbitrary frame (three unit axes) by three radii."""
    first = len(p.verts)
    sphere(p, c, 1.0, mat, col, w, seg=seg, rings=rings)
    for k in range(first, len(p.verts)):
        dv = p.verts[k] - c
        p.verts[k] = c + sum((ax * (dv[i] * radii[i]) for i, ax in enumerate(frame)), Vector())


def eyes(p, sampler, sockets):
    """The eyes, seated in the openings of the chanfron's eye guards (`sockets`: the guard
    ring's point on the plate and its outward normal). Each is a dark glossy eyeball, almond
    in shape, under a heavy upper lid and a bony brow ridge, with a soft lower lid, a deep
    brown iris and a bright catchlight high and to the front, so the eye reads as wet and
    alive even at a rider's distance. All rigid on the head."""
    W = rigid('head.x_031')
    for loc, nrm in sockets:
        hit = sampler.ray(loc + nrm * 0.1, -nrm)
        if not hit:
            continue
        base, n = hit[0], hit[1].normalized()
        fwd = Vector((0, -1, -0.35)).normalized()  # down the face, toward the nose
        fwd = (fwd - n * fwd.dot(n)).normalized()
        up = n.cross(fwd).normalized()
        if up.z < 0:
            up = -up
        c = base + n * 0.003
        frame = (fwd, up, n)

        def P(a, b, d=0.0, c=c, fwd=fwd, up=up, n=n):
            return c + fwd * a + up * b + n * d

        r = 0.03
        # the eyeball: an almond, longer along the face than it is tall, set into the head
        ellipsoid(p, c, frame, (r * 1.2, r * 0.82, r * 0.6), 'steed_eye', (0.012, 0.008, 0.006), W,
                  seg=16, rings=10)
        # a deep brown iris just under the gloss
        ellipsoid(p, P(0.003, -0.001, r * 0.42), frame, (r * 0.62, r * 0.5, r * 0.22), 'steed_eye',
                  (0.07, 0.03, 0.012), W, seg=12, rings=6)
        ellipsoid(p, P(0.003, -0.001, r * 0.5), frame, (r * 0.36, r * 0.3, r * 0.16), 'steed_eye',
                  (0.004, 0.003, 0.003), W, seg=10, rings=6)
        # the catchlight, high and toward the front where the sky sits, and a faint second one
        ellipsoid(p, P(0.009, 0.008, r * 0.6), frame, (0.0062, 0.0052, 0.0025), 'steed_hair',
                  (1.0, 0.98, 0.94), W, seg=8, rings=5)
        ellipsoid(p, P(-0.008, -0.006, r * 0.56), frame, (0.003, 0.0026, 0.0015), 'steed_hair',
                  (0.75, 0.76, 0.8), W, seg=6, rings=4)
        # lids: a heavy upper lid arching over the eye, a thinner lower one
        for (bb, th, col) in ((0.84, 0.0085, (0.03, 0.031, 0.036)), (-0.86, 0.006, (0.055, 0.057, 0.065))):
            pts = [P(t * r * 1.3, bb * r * (1 - 0.42 * t * t), r * 0.34 * (1 - 0.55 * t * t))
                   for t in (-1 + 2 * i / 10 for i in range(11))]
            for a_, b_ in zip(pts, pts[1:]):
                tube(p, a_, b_, th, 'steed_hide', col, W, sides=6)
        # the brow ridge: a soft bony shelf above and a little behind the eye
        ellipsoid(p, P(-0.005, r * 1.45, 0.0), frame, (0.034, 0.012, 0.012), 'steed_hide',
                  (0.08, 0.083, 0.094), W, seg=10, rings=6)


# ---------------------------------------------------------------------------
# Ambient occlusion, baked into the vertex colours of the finished, joined horse in its
# rest pose: the crease under the saddle skirts, the shade between the crinet lames,
# the inside of the legs and the hollow under the belly. The renderer has no ambient
# occlusion of its own on a skinned mount, so without this the barding reads as pasted
# on and the body as flat.
# ---------------------------------------------------------------------------
def bake_ao(ob, skip_materials=(), distance=0.16, samples=48, strength=0.8):
    sc = bpy.context.scene
    engine = sc.render.engine
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.device = 'CPU'
    if sc.world is None:
        sc.world = bpy.data.worlds.new('bake')
    sc.world.light_settings.distance = distance
    me = ob.data
    base = me.color_attributes['Color']
    ao = me.color_attributes.new('AO', 'BYTE_COLOR', 'CORNER')
    me.color_attributes.active_color = ao
    sc.render.bake.target = 'VERTEX_COLORS'
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO')
    skip = {i for i, m in enumerate(me.materials) if m and m.name in skip_materials}
    base = me.color_attributes['Color']
    ao = me.color_attributes['AO']
    for poly in me.polygons:
        if poly.material_index in skip:
            continue
        for li in poly.loop_indices:
            k = ao.data[li].color[0]
            m = 1.0 - strength * (1.0 - k)
            r, g, b, a = base.data[li].color
            base.data[li].color = (r * m, g * m, b * m, a)
    me.color_attributes.remove(me.color_attributes['AO'])
    me.color_attributes.active_color = me.color_attributes['Color']
    sc.render.engine = engine
