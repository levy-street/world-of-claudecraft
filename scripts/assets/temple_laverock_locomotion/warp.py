"""The game's stylization pass: Laverock's proportions widened to sit beside the
chibi player and the broad, rounded NPCs (round 4: "in person he looks very,
very thin").

The sculpt (anatomy.py) stays in its DESIGN space, where the procedural surfaces
(surface.py: the stole's crescents, the hem bands, the face masks) read their
positions, and the bake runs there. Then every low mesh is moved through a set of
per-bone maps, blended by its own skin weights (the same weights the armature
uses, so the blend is smooth wherever the skin is):

  * core   the torso, the cassock, the cape, the legs and the skirt panels:
           widened about the body's axis, SX(z) across and SY(z) front to back,
           flaring toward the hem
  * arm    the upper arm, the elbow, the forearm and the sleeve drape: carried
           out with the shoulder and thickened across the arm's own axis
  * hand   the hand and the fingers: scaled up uniformly about the wrist
  * head   the head and the jaw: scaled up uniformly about the skull's base
  * staff  the shaft thickened across its axis (never lengthened: the foot must
           still reach the floor), the crescent scaled up whole

Joints meet: each map agrees with its parent's at the joint (the arm map is the
core map at the shoulder, the hand map the arm map at the wrist, the head map the
core map at the skull's base), so the skeleton warped bone by bone stays one
piece. `commit()` then rewrites the anatomy landmarks the rig and the clips read
(BONES, REST, SHOULDER, WRIST, hand_frame, finger_chain, skirt_point, GRIP...),
so every clip is solved on the warped body.
"""
import math

import numpy as np

import anatomy as A

# ------------------------------------------------------------------ the knobs
# (z, SX, SY) stations of the core map: shoulders broad, a stout middle, the
# cassock flaring to a broad hem
CORE_PROF = [(-0.2, 1.72, 1.42), (0.5, 1.68, 1.38), (1.4, 1.6, 1.32), (2.1, 1.55, 1.3), (2.8, 1.6, 1.3),
             (3.4, 1.6, 1.3), (4.4, 1.5, 1.3)]
ARM_THICK = 1.38       # across the arm's axis
ARM_LONG = 1.05        # along it (the staff arm keeps its reach out to the broader hem)
HAND_S = 1.52          # the hands, uniformly
HEAD_S = 1.34          # the head, uniformly
STAFF_THICK = 1.42     # the shaft across its axis
CRESCENT_S = 1.3       # the carved moon, whole
MEDALLION_S = 1.35     # the nacre crescent and its bail, whole
YC = float(A.SKIRT_C[1])

# design-space landmarks (anatomy's values before commit)
D_SHOULDER = np.array(A.SHOULDER, float)
D_ELBOW = np.array(A.ELBOW, float)
D_WRIST = np.array(A.WRIST, float)
D_HAND_TIP = np.array(A.HAND_TIP, float)
D_GRIP = np.array(A.GRIP, float)
D_STAFF_UP = np.array(A.STAFF_UP, float) / np.linalg.norm(A.STAFF_UP)
D_HEAD_PIVOT = np.array(A.REST['Head'][0], float)
D_REST = {n: (np.array(h, float), np.array(t, float)) for n, (h, t) in A.REST.items()}
D_BONES = list(A.BONES)
D_finger_chain = A.finger_chain
D_skirt_point = A.skirt_point
D_skirt_dir = A.skirt_dir


def _design_skirt_point(k, level):
    # anatomy.skirt_point reads the module's skirt_dir, which commit() replaces
    d = D_skirt_dir(k)
    r = A.SKIRT_R[level] * (1.0 + 0.12 * max(0.0, d[1]) * (level > 0))
    return np.array((A.SKIRT_C[0] + d[0] * r, A.SKIRT_C[1] + d[1] * r, A.SKIRT_Z[level]))
D_STAFF_HEAD_T = 2.32   # dressing.STAFF_HEAD (the crescent's seat)

_ZS = np.array([z for z, _, _ in CORE_PROF])
_SX = np.array([x for _, x, _ in CORE_PROF])
_SY = np.array([y for _, _, y in CORE_PROF])


def sx_sy(z):
    z = np.asarray(z, float)
    return np.interp(z, _ZS, _SX), np.interp(z, _ZS, _SY)


# ------------------------------------------------------------------ the maps
def core(P):
    P = np.atleast_2d(np.asarray(P, float))
    sx, sy = sx_sy(P[:, 2])
    out = P.copy()
    out[:, 0] = P[:, 0] * sx
    out[:, 1] = YC + (P[:, 1] - YC) * sy
    return out


def core_inv(Q):
    Q = np.atleast_2d(np.asarray(Q, float))
    sx, sy = sx_sy(Q[:, 2])
    out = Q.copy()
    out[:, 0] = Q[:, 0] / sx
    out[:, 1] = YC + (Q[:, 1] - YC) / sy
    return out


def _m(p, s):
    p = np.asarray(p, float)
    return np.array((p[0] * s, p[1], p[2]))


def _arm_frame(s):
    S = _m(D_SHOULDER, s)
    a = _m(D_WRIST, s) - S
    a /= np.linalg.norm(a)
    M = ARM_LONG * np.outer(a, a) + ARM_THICK * (np.eye(3) - np.outer(a, a))
    return S, core(S)[0], M


def arm(P, s):
    S, S2, M = _arm_frame(s)
    P = np.atleast_2d(np.asarray(P, float))
    return S2 + (P - S) @ M.T


def hand(P, s):
    Wr = _m(D_WRIST, s)
    W2 = arm(Wr, s)[0]
    P = np.atleast_2d(np.asarray(P, float))
    return W2 + (P - Wr) * HAND_S


def head(P):
    N2 = core(D_HEAD_PIVOT)[0]
    P = np.atleast_2d(np.asarray(P, float))
    return N2 + (P - D_HEAD_PIVOT) * HEAD_S


def head_inv(Q):
    N2 = core(D_HEAD_PIVOT)[0]
    Q = np.atleast_2d(np.asarray(Q, float))
    return D_HEAD_PIVOT + (Q - N2) / HEAD_S


def staff(P):
    """The shaft: carried with the right fist, thickened across its axis."""
    G2 = hand(D_GRIP, -1)[0]
    u = D_STAFF_UP
    P = np.atleast_2d(np.asarray(P, float))
    d = P - D_GRIP
    along = d @ u
    perp = d - np.outer(along, u)
    return G2 + np.outer(along, u) + perp * STAFF_THICK


def crescent(P):
    seat = D_GRIP + D_STAFF_UP * D_STAFF_HEAD_T
    seat2 = staff(seat)[0]
    P = np.atleast_2d(np.asarray(P, float))
    return seat2 + (P - seat) * CRESCENT_S


def bone_map(name):
    """The map a bone's region follows (a function of design points)."""
    side = 1 if name.startswith('L_') else (-1 if name.startswith('R_') else 0)
    base = name[2:] if side else name
    if base in ('UpperArm', 'ElbowFix', 'Forearm', 'Sleeve'):
        return lambda P, s=side: arm(P, s)
    if base == 'Hand' or base.rstrip('12') in A.FINGERS:
        return lambda P, s=side: hand(P, s)
    if base in ('Head', 'Jaw'):
        return head
    if base == 'Staff':
        return staff
    return core


# ------------------------------------------------------------------ meshes
def _groups_matrix(obj):
    names = [g.name for g in obj.vertex_groups]
    W = np.zeros((len(obj.data.vertices), len(names)))
    for v in obj.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    return names, W


def warp_object(obj):
    """Move a low mesh's vertices through the maps of the bones that carry it."""
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get('co', co)
    P = co.reshape(-1, 3)
    mw = np.array(obj.matrix_world)
    Pw = P @ mw[:3, :3].T + mw[:3, 3]
    name = obj.name
    if name.startswith('StaffCrescent'):
        Q = crescent(Pw)
    elif name.startswith('Staff'):
        Q = staff(Pw)
    elif name.startswith('MedallionNacre') or name.startswith('MedallionBail'):
        c = Pw.mean(axis=0)
        Q = core(c)[0] + (Pw - c) * MEDALLION_S
    else:
        names, W = _groups_matrix(obj)
        tot = W.sum(axis=1)
        if names and (tot < 1e-6).any():
            raise RuntimeError(f'{name}: {int((tot < 1e-6).sum())} vertices carry no weight')
        if not names:
            raise RuntimeError(f'{name}: no vertex groups to warp by')
        Q = np.zeros_like(Pw)
        for j, b in enumerate(names):
            w = W[:, j]
            m = w > 0
            if not m.any():
                continue
            Q[m] += bone_map(b)(Pw[m]) * w[m, None]
        Q /= tot[:, None]
    inv = np.linalg.inv(mw)
    Ql = Q @ inv[:3, :3].T + inv[:3, 3]
    me.vertices.foreach_set('co', Ql.ravel())
    me.update()


# ------------------------------------------------------------------ the skeleton and landmarks
def warped_bones():
    out = []
    for name, parent, h, t in D_BONES:
        f = bone_map(name)
        if name == 'Staff':
            g2 = staff(D_GRIP)[0]
            ln = float(np.linalg.norm(np.array(t) - np.array(h)))
            h2, t2 = g2, g2 + D_STAFF_UP * ln
        else:
            h2, t2 = f(np.array(h, float))[0], f(np.array(t, float))[0]
        out.append((name, parent, tuple(float(x) for x in h2), tuple(float(x) for x in t2)))
    return out


def _check_joints(bones):
    head_of = {n: np.array(h) for n, _, h, _ in bones}
    tail_of = {n: np.array(t) for n, _, _, t in bones}
    D_tail = {n: D_REST[n][1] for n in D_REST}
    for n, p, h, _ in bones:
        if not p:
            continue
        # a child whose design head sat on its parent's design tail must still
        if np.linalg.norm(D_REST[n][0] - D_tail[p]) < 1e-6:
            gap = float(np.linalg.norm(head_of[n] - tail_of[p]))
            if gap > 1e-4:
                raise RuntimeError(f'warp opened the joint {p} -> {n} by {gap:.4f}')


def commit():
    """Rewrite anatomy's landmarks to the warped body (the rig and the clips read
    them). Call once, after the bake and the mesh warp."""
    if getattr(A, 'WARPED', False):
        return
    bones = warped_bones()
    _check_joints(bones)
    A.BONES = bones
    A.REST = {n: (np.array(h, float), np.array(t, float)) for n, _, h, t in bones}
    A.PARENT = {n: p for n, p, _, _ in bones}
    A.SHOULDER = core(D_SHOULDER)[0]
    A.ELBOW = arm(D_ELBOW, 1)[0]
    A.WRIST = arm(D_WRIST, 1)[0]
    A.HAND_TIP = hand(D_HAND_TIP, 1)[0]
    for nm in ('HIP', 'KNEE', 'ANKLE', 'BALL', 'TOE'):
        setattr(A, nm, core(getattr(A, nm))[0])
    A.EYE = head(A.EYE)[0]
    A.EYE_R = A.EYE_R * HEAD_S
    A.GRIP = staff(D_GRIP)[0]
    A.STAFF_FOOT = A.GRIP + D_STAFF_UP * A.STAFF_FOOT_T
    A.STAFF_TOP = A.GRIP + D_STAFF_UP * 2.7
    A.STAFF_FLAME = A.GRIP + D_STAFF_UP * A.STAFF_FLAME_T

    def finger_chain(side, name):
        return tuple(hand(p, side)[0] for p in D_finger_chain(side, name))
    A.finger_chain = finger_chain

    def skirt_point(k, level):
        return core(_design_skirt_point(k, level))[0]
    A.skirt_point = skirt_point

    def skirt_dir(k):
        d = skirt_point(k, 2) - np.array((A.SKIRT_C[0], YC, 0.0))
        d[2] = 0.0
        return d / np.linalg.norm(d)
    A.skirt_dir = skirt_dir
    A.wp = lambda p: tuple(core(p)[0])
    A.wh = lambda p: tuple(head(p)[0])
    # a reach out from the shoulder: carried with it, a little longer (the bigger
    # hand sits further out on the same arm)
    A.wreach = lambda p, s: tuple(core(_m(D_SHOULDER, s))[0] + (np.asarray(p, float) - _m(D_SHOULDER, s)) * 1.1)
    A.WARPED = True


# ------------------------------------------------------------------ collision probes
class WarpedPrim:
    """A design-space primitive evaluated at warped points (through the inverse
    map); `k` rescales its distances to warped yards (conservatively low)."""

    def __init__(self, prim, inv, k):
        self.prim, self.inv, self.k, self.bone = prim, inv, k, prim.bone

    def dist_pts(self, Q):
        return self.prim.dist_pts(self.inv(Q)) * self.k


def wrap_prims(prims):
    """{bone: [design prims]} -> the same probes for the warped body."""
    out = {}
    for bone, plist in prims.items():
        if bone in ('Head', 'Jaw', 'Brow'):
            inv, k = head_inv, HEAD_S
        else:
            inv, k = core_inv, float(_SY.min())
        out[bone] = [WarpedPrim(p, inv, k) for p in plist]
    return out


COLLIDE = ('Hips', 'Spine1', 'Spine2', 'Neck', 'Head')     # clips.COLLIDE


def clip_body_prims():
    """The cassock probes the clips keep the arms out of (clips.body_prims), built
    in the design space (call BEFORE commit) and wrapped for the warped body."""
    assert not getattr(A, 'WARPED', False), 'build the probes from the design landmarks'
    d = {}
    for F in (A.build_robe(voxel=0.06, detail=False), A.build_surplice(voxel=0.06, detail=False)):
        for prim, _ in F.prims:
            if prim.bone in COLLIDE and not isinstance(prim, A.Polyline):
                d.setdefault(prim.bone, []).append(prim)
    return wrap_prims(d)


def patch_clips(prims):
    """Point the clips' clearance at the warped body: the cassock probes, and the
    arm's own girth (the sleeve thickened, the hand scaled up)."""
    import clips as C
    assert tuple(C.COLLIDE) == COLLIDE
    C._BODY_PRIMS = prims
    C.ARM_SAMPLES = tuple((seg, t, r * (HAND_S if seg == 'Hand' else ARM_THICK), u)
                          for seg, t, r, u in C.ARM_SAMPLES)
    C.FINGER_SAMPLES = tuple((seg, t, r * HAND_S) for seg, t, r in C.FINGER_SAMPLES)


def summary():
    s = {}
    s['shoulder_x'] = (float(D_SHOULDER[0]), float(core(D_SHOULDER)[0][0]))
    s['hem_r'] = (float(A.SKIRT_R[2]), float(core((A.SKIRT_R[2], YC, A.SKIRT_Z[2]))[0][0]))
    return s


if __name__ == '__main__':
    print(summary())
    b = warped_bones()
    _check_joints(b)
    print('joints ok', len(b))
