"""The Drakemaw Raptor's armature and skin.

The armature comes straight from the anatomy table. Every bone's local X axis
is turned to point at the raptor's left (+X), so a rotation about local X is a
pitch (a bend in the side view) on every bone: an animator tweaking a clip in
Blender bends any joint the same way.

Skin weights are Blender's bone heat, solved on a WELDED copy of the body: the
source keeps every UV seam as a split vertex, and heat cannot cross a split.
Each source vertex then takes its welded twin's weights, so both halves of a
seam always move together. On top of the heat:
  - each leg is the only leg its side's skin may follow (no bleed between legs);
  - the saddle's leather and the girth hardware ride the Saddle bone rigidly;
  - the small separate pieces (the teeth, the harness buckles, rings and pins)
    each take one weight set, the skin's at their contact, so none of them bends;
  - every vertex keeps at most four influences (the glTF limit), renormalized.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector, kdtree

import anatomy as A

RIG_NAME = 'DrakemawRaptorRig'


# ------------------------------------------------------------------ armature
def build_armature(name=RIG_NAME):
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, parent, head, tail in A.BONES:
        eb = data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        d = (eb.tail - eb.head).normalized()
        z = Vector((1.0, 0.0, 0.0)).cross(d)
        if z.length < 1e-6:
            z = Vector((0.0, 0.0, 1.0))
        eb.align_roll(z.normalized())
        eb.use_deform = bname != 'Root'
    for bname, parent, head, tail in A.BONES:
        if parent:
            eb = data.edit_bones[bname]
            eb.parent = data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    data.display_type = 'OCTAHEDRAL'
    arm.show_in_front = True
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm


# ------------------------------------------------------------------ weights
LEG_BONES = ('Thigh', 'Shin', 'Foot', 'Toes')
SIDE_BAND = 0.02 * A.SCALE         # within this of the midline a vertex may follow both sides
TORSO_Z = 0.33 * A.SCALE           # leather above this is harness, never a leg's
SADDLE_BOX = dict(y=(-0.18 * A.SCALE, 0.12 * A.SCALE), z0=0.47 * A.SCALE, z1=0.57 * A.SCALE)
HEAD_Y = -0.27 * A.SCALE           # forward of this (and high) is the head: its red is the gums


def mesh_arrays(me):
    P = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', P)
    E = np.zeros(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get('vertices', E)
    return P.reshape(-1, 3), E.reshape(-1, 2)


def weld_map(P, tol=1e-5):
    """Source vertex -> welded id: the split twins of a UV seam share one id."""
    key = np.round(P / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.ravel()


def components(n, E):
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for a, b in E:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return np.array([find(i) for i in range(n)])


def vertex_rgb(me):
    """The base colour under each vertex (the texture sampled at its UV)."""
    img = next(n.image for n in me.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE')
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get('uv', uv)
    lv = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', lv)
    vuv = np.zeros((len(me.vertices), 2))
    vuv[lv] = uv.reshape(-1, 2)
    xi = np.clip((vuv[:, 0] % 1.0) * w, 0, w - 1).astype(int)
    yi = np.clip((vuv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
    return px[yi, xi, :3]


def relax(W, E, iters=1, alpha=0.5):
    n = len(W)
    deg = np.bincount(E.ravel(), minlength=n).astype(float)
    deg[deg == 0] = 1
    for _ in range(iters):
        acc = np.zeros_like(W)
        np.add.at(acc, E[:, 0], W[E[:, 1]])
        np.add.at(acc, E[:, 1], W[E[:, 0]])
        W = (1 - alpha) * W + alpha * acc / deg[:, None]
    return W


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def cap4(W):
    if W.shape[1] > 4:
        idx = np.argsort(-W, axis=1)[:, 4:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W[W < 0.01] = 0.0
    return W / np.maximum(W.sum(axis=1, keepdims=True), 1e-9)


def heat_weights(P_w, F_w, arm, bones):
    """Bone heat over the welded main body (a throwaway proxy). Returns (n, bones)."""
    me = bpy.data.meshes.new('RaptorHeatProxy')
    me.from_pydata([tuple(map(float, p)) for p in P_w], [], [tuple(map(int, f)) for f in F_w])
    me.update()
    proxy = bpy.data.objects.new('RaptorHeatProxy', me)
    bpy.context.scene.collection.objects.link(proxy)
    saddle = arm.data.bones['Saddle']
    saddle.use_deform = False          # the saddle is assigned by hand, never by heat
    for o in bpy.context.selected_objects:
        o.select_set(False)
    proxy.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    saddle.use_deform = True
    W = np.zeros((len(P_w), len(bones)))
    col = {b: j for j, b in enumerate(bones)}
    names = {g.index: g.name for g in proxy.vertex_groups}
    for v in me.vertices:
        for g in v.groups:
            j = col.get(names[g.group])
            if j is not None:
                W[v.index, j] = g.weight
    bpy.data.objects.remove(proxy, do_unlink=True)
    bpy.data.meshes.remove(me)
    return W


def swap_sides(bones):
    """Column permutation exchanging every L_ bone with its R_ twin."""
    col = {b: j for j, b in enumerate(bones)}
    out = []
    for b in bones:
        if b.startswith('L_'):
            out.append(col['R_' + b[2:]])
        elif b.startswith('R_'):
            out.append(col['L_' + b[2:]])
        else:
            out.append(col[b])
    return np.array(out)


def mirror_skin(W, P, bones, solved):
    """The Tripo mesh is only nearly symmetric (mirror twins a few millimetres
    apart), enough for heat to reach the chest from one forearm and not the
    other. The left side's solve is the skin: every right-side vertex takes its
    mirror twin's weights with the sides swapped, and the midline is averaged
    with its own mirror, so the two sides deform identically."""
    swap = swap_sides(bones)
    left = np.nonzero(solved & (P[:, 0] >= -SIDE_BAND))[0]
    tree = kdtree.KDTree(len(left))
    for i, idx in enumerate(left):
        tree.insert(Vector(P[idx]), i)
    tree.balance()
    out = W.copy()
    for i in np.nonzero(solved)[0]:
        x, y, z = P[i]
        if x < -SIDE_BAND:
            _, k, _ = tree.find(Vector((-x, y, z)))
            out[i] = W[left[k]][swap]
        elif x <= SIDE_BAND:
            out[i] = 0.5 * (W[i] + W[i][swap])
    return out


def seg_dist(P, a, b):
    a, b = np.asarray(a), np.asarray(b)
    ab = b - a
    u = np.clip((P - a) @ ab / (ab @ ab), 0.0, 1.0)
    return np.linalg.norm(P - (a + u[:, None] * ab), axis=1)


# A forelimb's influence stays on the forelimb: (radius, falloff) about the bone,
# source units. Past it the weight is handed to the chest.
ARM_ZONES = {'UpperArm': (0.055, 0.025), 'Forearm': (0.04, 0.02), 'Hand': (0.05, 0.02)}
THIGH_MIDLINE = (0.015, 0.045)     # no thigh weight within 1.5 cm of the midline, full by 4.5 cm


def limit_zones(W, P, bones):
    col = {b: j for j, b in enumerate(bones)}
    W = W.copy()
    freed = np.zeros(len(W))
    for side in ('L_', 'R_'):
        for b, (r, f) in ARM_ZONES.items():
            j = col[side + b]
            h, t = A.REST[side + b]
            d = seg_dist(P, h, t)
            k = 1.0 - smoothstep(r * A.SCALE, (r + f) * A.SCALE, d)
            freed += W[:, j] * (1.0 - k)
            W[:, j] *= k
    W[:, col['Spine2']] += freed
    k = smoothstep(THIGH_MIDLINE[0] * A.SCALE, THIGH_MIDLINE[1] * A.SCALE, np.abs(P[:, 0]))
    for side in ('L_', 'R_'):
        j = col[side + 'Thigh']
        W[:, col['Hips']] += W[:, j] * (1.0 - k)
        W[:, j] *= k
    return W


TOE_BAND = 0.06       # yards either side of the ball over which the foot hands over to the toes
TOE_TOP = 0.3         # yards: the toes' region never reaches above the sole


def toe_region(W, P, bones):
    """One toe bone runs down the middle toe, so heat leaves the inner and outer
    claws (a quarter yard off it) partly on the metatarsus, and a claw that
    rides the metatarsus swings into the ground as the heel lifts. Ahead of the
    ball everything the foot carries rides the toes outright, over a short band
    across the joint."""
    col = {b: j for j, b in enumerate(bones)}
    W = W.copy()
    for s in ('L_', 'R_'):
        jf, jt = col[s + 'Foot'], col[s + 'Toes']
        ball_y = A.REST[s + 'Toes'][0][1]
        side = P[:, 0] > 0 if s == 'L_' else P[:, 0] < 0
        t = smoothstep(ball_y + TOE_BAND, ball_y - TOE_BAND, P[:, 1])
        t = np.where(side & (P[:, 2] < TOE_TOP), t, 0.0)
        both = W[:, jf] + W[:, jt]
        toes = both * t + W[:, jt] * (1.0 - t)
        W[:, jt] = toes
        W[:, jf] = both - toes
    return W


def weight_skin(mesh, arm):
    """Skin the source mesh to the armature. Returns (bones, W) on the source vertices."""
    me = mesh.data
    bones = list(A.DEFORM)
    col = {b: j for j, b in enumerate(bones)}
    P, E = mesh_arrays(me)
    weld = weld_map(P)
    nW = int(weld.max()) + 1
    P_w = np.zeros((nW, 3))
    P_w[weld] = P
    E_w = weld[E]
    E_w = np.unique(np.sort(E_w[E_w[:, 0] != E_w[:, 1]], axis=1), axis=0)
    comp = components(nW, E_w)
    labels, counts = np.unique(comp, return_counts=True)
    main = labels[np.argmax(counts)]
    on_main = comp == main

    # the main body's welded faces, re-indexed for the proxy
    loops = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', loops)
    starts = np.zeros(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_start', starts)
    sizes = np.zeros(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get('loop_total', sizes)
    main_ids = np.nonzero(on_main)[0]
    remap = -np.ones(nW, dtype=np.int64)
    remap[main_ids] = np.arange(len(main_ids))
    faces = []
    for s, k in zip(starts, sizes):
        f = remap[weld[loops[s:s + k]]]
        if (f >= 0).all() and len(set(f.tolist())) == k:
            faces.append(f)
    W_main = heat_weights(P_w[main_ids], faces, arm, bones)
    if (W_main.sum(axis=1) <= 0).any():
        raise RuntimeError(f'bone heat left {(W_main.sum(axis=1) <= 0).sum()} body vertices unweighted')
    W = np.zeros((nW, len(bones)))
    W[main_ids] = W_main
    W = mirror_skin(W, P_w, bones, on_main)
    W[main_ids] = limit_zones(W, P_w, bones)[main_ids]

    # classify the surface: leather (saddle, girth, harness, ankle bands) by its paint
    rgb = vertex_rgb(me)
    ratio_w = np.bincount(weld, weights=rgb[:, 0] / np.maximum(rgb[:, 1], 1e-3), minlength=nW)
    ratio_w /= np.bincount(weld, minlength=nW)
    ratio_w = relax(ratio_w[:, None], E_w, iters=1)[:, 0]
    head = (P_w[:, 1] < HEAD_Y) & (P_w[:, 2] > 0.68 * A.SCALE)
    leather = (ratio_w > 1.42) & ~head

    legs = [col[s + b] for s in ('L_', 'R_') for b in LEG_BONES]
    left = [j for b, j in col.items() if b.startswith('L_')]
    right = [j for b, j in col.items() if b.startswith('R_')]

    def masks(W):
        W[np.ix_(P_w[:, 0] > SIDE_BAND, right)] = 0.0
        W[np.ix_(P_w[:, 0] < -SIDE_BAND, left)] = 0.0
        harness = leather & (P_w[:, 2] > TORSO_Z)
        held = W[harness][:, legs].sum(axis=1)
        W[np.ix_(harness, legs)] = 0.0
        # what the legs held goes to the body under the strap
        W[harness, col['Hips']] += held
        return W

    W[main_ids] = masks(W)[main_ids]
    W[main_ids] = relax(W, E_w, iters=2, alpha=0.4)[main_ids]
    W = masks(W)
    W = toe_region(W, P_w, bones)

    # the saddle: its dish, pommel, cantle and skirts are one rigid piece of leather,
    # fading into the skin's own weights down its flaps
    box = SADDLE_BOX
    in_box = leather & (P_w[:, 1] > box['y'][0]) & (P_w[:, 1] < box['y'][1])
    s = np.where(in_box, smoothstep(box['z0'], box['z1'], P_w[:, 2]), 0.0)
    s = np.clip(relax(s[:, None], E_w, iters=2, alpha=0.5)[:, 0], 0.0, 1.0)
    s[~on_main] = 0.0
    W *= (1.0 - s)[:, None]
    W[:, col['Saddle']] += s

    # the small pieces ride the skin they sit on, each as one rigid weight set
    tree = kdtree.KDTree(len(main_ids))
    for i, idx in enumerate(main_ids):
        tree.insert(Vector(P_w[idx]), i)
    tree.balance()
    for lab in labels:
        if lab == main:
            continue
        ids = np.nonzero(comp == lab)[0]
        c = P_w[ids].mean(axis=0)
        hits = tree.find_n(Vector(c), 6)
        acc = np.zeros(len(bones))
        tot = 0.0
        for _, i, d in hits:
            w = 1.0 / (d + 1e-3) ** 2
            acc += W[main_ids[i]] * w
            tot += w
        W[ids] = acc / tot

    W = cap4(W)
    Ws = W[weld]
    write_groups(mesh, bones, Ws)
    mod = mesh.modifiers.get('Armature') or mesh.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    mod.use_deform_preserve_volume = False     # linear blend skinning, as glTF plays it
    mesh.parent = arm
    mesh.matrix_parent_inverse = arm.matrix_world.inverted()
    return bones, Ws, dict(leather=leather[weld], saddle=s[weld], weld=weld)


def foot_ground_points(mesh, bones, W, per_bone=80, foot_top=0.3):
    """The vertices each foot bone carries that could reach the ground (the sole
    and the heel under the metatarsus, every claw on the toes), as rest points
    for the pose solver's ground clamp: the lowest `per_bone` of each, the
    metatarsus's only from its bottom `foot_top` yards (its shank never nears the
    ground). A vertex counts for the bone that owns at least half of it."""
    P, _ = mesh_arrays(mesh.data)
    col = {b: j for j, b in enumerate(bones)}
    out = {}
    for s in ('L_', 'R_'):
        out[s] = {}
        for b in ('Foot', 'Toes'):
            own = W[:, col[s + b]] >= 0.5
            if b == 'Foot':
                own &= P[:, 2] < foot_top        # the mesh is in yards
            pts = np.unique(np.round(P[own], 5), axis=0)
            pts = pts[np.argsort(pts[:, 2])][:per_bone]
            out[s][b] = [Vector(tuple(map(float, q))) for q in pts]
    return out


def write_groups(obj, bones, W):
    obj.vertex_groups.clear()
    for j, b in enumerate(bones):
        g = obj.vertex_groups.new(name=b)
        nz = np.nonzero(W[:, j] > 0)[0]
        for i in nz:
            g.add([int(i)], float(W[i, j]), 'REPLACE')
