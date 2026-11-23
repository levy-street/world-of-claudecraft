"""The wolf armature and its skin weights.

The shipped bodies are triangle soup: every triangle owns its three corners (8574
corners for 2858 triangles on the pack wolf), so nothing in the file says which
corners are the same point of skin. The weights are therefore solved on a WELDED
copy (one vertex per position) and copied back to every corner at that position,
which keeps the surface closed under any pose (the mouth stays shut, as modeled).

Weights, in order:
  1. Blender's bone heat over the welded body (every bone that deforms); any point
     it cannot reach takes the nearest weighted point's weights.
  2. The loose pieces (eyeballs, the tongue and fangs inside the mouth, Greyjaw's
     claws, scars and spikes) move as one piece each: every corner of a piece
     takes the piece's mean weights.
  3. The shoulders. Bone heat hands the Scapula and Humerus the whole flank, up
     over the withers and across the sternum, so a raised foreleg (the Jump) lifted
     the chest into the face. Their share fades out toward the withers and toward
     the midline, and the Chest keeps a share of the shoulder blade's skin.
  4. At most four influences (the glTF limit), tiny weights dropped, normalised.
"""
import bpy
import numpy as np
from mathutils import Vector

import anatomy as A

DEFORM_SKIP = {'Root'}


# ------------------------------------------------------------------ skeleton
def resample(points, n):
    """n + 1 points evenly spaced along a polyline (the tail's joints)."""
    P = np.array(points, float)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.linspace(0.0, s[-1], n + 1)
    return [tuple(float(np.interp(v, s, P[:, k])) for k in range(3)) for v in t]


def bone_table(model):
    bones = list(model['bones'])
    joints = resample(model['tail_curve'], A.TAIL_BONES)
    for i in range(A.TAIL_BONES):
        parent = 'Pelvis' if i == 0 else f'Tail{i}'
        bones.append((f'Tail{i + 1}', parent, joints[i], joints[i + 1]))
    return bones


def build_armature(model, name):
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    table = bone_table(model)
    for bname, _parent, head, tail in table:
        eb = data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        # Local X across the body (world +X) on every bone, so a turn about local X
        # is always a bend in the body's own plane.
        eb.align_roll(Vector((1.0, 0.0, 0.0)).cross(eb.tail - eb.head))
    for bname, parent, head, _tail in table:
        if parent:
            eb = data.edit_bones[bname]
            eb.parent = data.edit_bones[parent]
            eb.use_connect = (data.edit_bones[parent].tail - Vector(head)).length < 1e-5
    bpy.ops.object.mode_set(mode='OBJECT')
    for bname in DEFORM_SKIP:
        data.bones[bname].use_deform = False
    data.display_type = 'OCTAHEDRAL'
    return arm


def deform_bones(arm):
    return [b.name for b in arm.data.bones if b.use_deform]


# ------------------------------------------------------------------ welding
def mesh_soup(obj):
    """World-space corner positions and the triangle corner indices of a mesh."""
    me = obj.data
    S = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', S)
    S = S.reshape(-1, 3)
    M = np.array(obj.matrix_world)
    S = S @ M[:3, :3].T + M[:3, 3]
    me.calc_loop_triangles()
    F = np.zeros(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', F)
    return S, F.reshape(-1, 3)


def weld(S, F, tol=1e-5):
    """Merge corners at the same position. Returns the welded positions, the welded
    triangles, the corner -> welded vertex map and the connected islands."""
    key = np.round(S / tol).astype(np.int64)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    P = S[first]
    T = inverse[F]
    T = T[(T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
    # islands by union-find over triangle edges
    parent = np.arange(len(P))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in T:
        for u, v in ((a, b), (b, c)):
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
    roots = np.array([find(i) for i in range(len(P))])
    islands = [np.nonzero(roots == r)[0] for r in np.unique(roots)]
    islands.sort(key=len, reverse=True)
    return P, T, inverse, islands


def edges_of(T):
    E = np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    E.sort(axis=1)
    return np.unique(E, axis=0)


# ------------------------------------------------------------------ weights
def heat_weights(arm, P, T, bones):
    """Blender's bone heat over a temporary welded mesh."""
    me = bpy.data.meshes.new('wolf_heat_tmp')
    me.from_pydata([tuple(p) for p in P], [], [tuple(int(i) for i in t) for t in T])
    me.update()
    ob = bpy.data.objects.new('wolf_heat_tmp', me)
    bpy.context.scene.collection.objects.link(ob)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ob.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    with bpy.context.temp_override(active_object=arm, object=arm,
                                   selected_objects=[ob, arm], selected_editable_objects=[ob, arm]):
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    W = np.zeros((len(P), len(bones)))
    col = {b: j for j, b in enumerate(bones)}
    names = {g.index: g.name for g in ob.vertex_groups}
    for v in me.vertices:
        for g in v.groups:
            j = col.get(names[g.group])
            if j is not None:
                W[v.index, j] = g.weight
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    return W


def fill_unweighted(P, W):
    """Points bone heat could not reach (whole loose pieces: two of Greyjaw's fangs
    inside the snarl and a scar on his haunch) take the weights of the nearest
    weighted point; with none, the exporter pinned them to one bone and the fangs
    hung in the air when the head moved."""
    lost = np.nonzero(W.sum(axis=1) < 1e-3)[0]
    found = np.nonzero(W.sum(axis=1) >= 1e-3)[0]
    for i in lost:
        W[i] = W[found[np.argmin(np.linalg.norm(P[found] - P[i], axis=1))]]
    return W


def rigid_islands(P, islands, W):
    """Every loose piece moves as one: its corners all take the piece's mean."""
    for isl in islands[1:]:
        W[isl] = W[isl].mean(axis=0)
    return W


def _smooth01(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def shoulder_fade(model, P, W, bones):
    """Hand the Chest the shoulder skin the front legs must not drag."""
    f = model['shoulder_fade']
    chest = bones.index('Chest')
    lat = np.abs(P[:, 0] - model['midline_x'])
    keep = _smooth01((f['top_z1'] - P[:, 2]) / (f['top_z1'] - f['top_z0'])) * \
        _smooth01((lat - f['mid_lat0']) / (f['mid_lat1'] - f['mid_lat0']))
    for side in ('L', 'R'):
        for name, share in ((f'Scapula_{side}', 1.0 - f['chest_share']), (f'Humerus_{side}', 1.0)):
            j = bones.index(name)
            moved = W[:, j] * (1.0 - keep * share)
            W[:, j] -= moved
            W[:, chest] += moved
    return W


def cap4(W, floor=0.01):
    W = W.copy()
    if W.shape[1] > 4:
        drop = np.argsort(-W, axis=1)[:, 4:]
        np.put_along_axis(W, drop, 0.0, axis=1)
    W[W < floor] = 0.0
    s = W.sum(axis=1, keepdims=True)
    return W / np.maximum(s, 1e-9)


def write_groups(obj, bones, Wc):
    obj.vertex_groups.clear()
    groups = [obj.vertex_groups.new(name=b) for b in bones]
    for j, g in enumerate(groups):
        col = Wc[:, j]
        for i in np.nonzero(col > 0)[0]:
            g.add([int(i)], float(col[i]), 'REPLACE')


def skin(model, body, arm):
    """Weight `body` (the shipped mesh, in rest pose) to `arm`. Returns a report."""
    bones = deform_bones(arm)
    S, F = mesh_soup(body)
    P, T, corner_to_weld, islands = weld(S, F)
    W = heat_weights(arm, P, T, bones)
    unweighted = int((W.sum(axis=1) < 1e-3).sum())
    W = fill_unweighted(P, W)
    W = shoulder_fade(model, P, W, bones)
    W = rigid_islands(P, islands, W)
    W = cap4(W)
    Wc = W[corner_to_weld]
    write_groups(body, bones, Wc)
    mod = body.modifiers.get('Armature') or body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return {
        'corners': len(S), 'welded': len(P), 'islands': [len(i) for i in islands],
        'heat_unweighted': unweighted, 'max_influences': int((Wc > 0).sum(axis=1).max()),
    }
