"""The Gravewyrm Sanctum kit's SCULPTED figures (build_gravewyrm_sanctum_kit.py).

Everything organic in the Sanctum kit is sculpted as a signed-distance field
(smooth unions, carved subtractions, eroded by noise) and meshed in one pass
through OpenVDB, the way the Wildheart jaguar head is (jaguar_head_sculpt.py,
whose primitives this module reuses), then decimated to a budget and handed
back as plain faces with a KIND each (hide, belly, horn, skin, armour, cloth,
leather...) so the kit's weathering (GPiece.finish: tone drift, cavity
darkening, worn edges, rime on every upward face) runs over it like every
other piece:

  wyrm_field()        Korzul inside the ice: a coiled great wyrm, one wing half
                      spread across the face, the head turned toward the lake,
                      ribs over a hollow in the chest where the shard beats
  humanoid_field()    one figure from a pose (joint positions): the Smith's
                      chain-gang giants (mid-haul, gripping a mast-thick link)
                      and the held dead (soldiers and climbers, whole and
                      rimed, never skeletons)

Coordinates: the kit's (yards, +Z up, the front toward -Y). Deterministic:
every noise is seeded, nothing reads the clock.
"""
import math
import os
import tempfile

import numpy as np

from jaguar_head_sculpt import BIG, Ellipsoid, Field, Noise, Polyline, Prim, RoundBox, RoundCone, rot, smax

# The wyrm, in the Calving Face's frame (the face's front base centre is the
# origin, the lake toward -Y). The runtime's Korzul swap and the heartbeat
# glow (Kit_WyrmHeart) key on these.
WYRM_CHEST = (-4.0, 21.0, 17.0)
WYRM_HEART = (-4.0, 18.4, 17.2)
WYRM_HEAD = (-19.5, 6.5, 28.5)
WYRM_SNOUT = (-21.5, 1.6, 25.4)


# ------------------------------------------------------------------ extra primitives
class Tri(Prim):
    """A thick triangle (a wing membrane panel)."""

    def __init__(self, a, b, c, th):
        self.a, self.b, self.c = (np.asarray(v, dtype=np.float64) for v in (a, b, c))
        self.th = th
        pts = np.stack([self.a, self.b, self.c])
        self.lo = pts.min(axis=0) - th
        self.hi = pts.max(axis=0) + th

    def dist(self, X, Y, Z):
        a, b, c = self.a, self.b, self.c
        P = np.stack([X - a[0], Y - a[1], Z - a[2]], axis=-1)
        ba, cb, ac = b - a, c - b, a - c
        nor = np.cross(ba, ac)
        pa = P
        pb = P - (b - a)
        pc = P - (c - a)

        def dot(u, v):
            return (u * v).sum(-1)

        s = (np.sign(dot(pa, np.cross(ba, nor))) + np.sign(dot(pb, np.cross(cb, nor)))
             + np.sign(dot(pc, np.cross(ac, nor))))

        def edge(e, p):
            t = np.clip(dot(p, e) / float(e @ e), 0, 1)
            q = e * t[..., None] - p
            return dot(q, q)

        inside = dot(pa, nor) ** 2 / float(nor @ nor)
        outside = np.minimum(np.minimum(edge(ba, pa), edge(cb, pb)), edge(ac, pc))
        return np.sqrt(np.where(s < 2.0, outside, inside)) - self.th


class Link(Prim):
    """A chain link: a stadium ring round its normal (u the long axis)."""

    def __init__(self, c, u, n, half, ring, bar):
        self.c = np.asarray(c, dtype=np.float64)
        u = np.asarray(u, dtype=np.float64)
        u /= np.linalg.norm(u)
        n = np.asarray(n, dtype=np.float64)
        n = n - u * (n @ u)
        n /= np.linalg.norm(n)
        v = np.cross(n, u)
        self.F = np.stack([u, v, n])
        self.half, self.ring, self.bar = half, ring, bar
        e = half + ring + bar
        self.lo, self.hi = self.c - e, self.c + e

    def dist(self, X, Y, Z):
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        F = self.F
        lx = F[0, 0] * px + F[0, 1] * py + F[0, 2] * pz
        ly = F[1, 0] * px + F[1, 1] * py + F[1, 2] * pz
        lz = F[2, 0] * px + F[2, 1] * py + F[2, 2] * pz
        qx = np.maximum(np.abs(lx) - self.half, 0)
        d = np.sqrt(qx * qx + ly * ly) - self.ring
        return np.sqrt(d * d + lz * lz) - self.bar


class Union(Prim):
    def __init__(self, prims):
        self.prims = prims
        self.lo = np.min([p.lo for p in prims], axis=0)
        self.hi = np.max([p.hi for p in prims], axis=0)

    def dist(self, X, Y, Z):
        out = None
        for p in self.prims:
            d = p.dist(X, Y, Z)
            out = d if out is None else np.minimum(out, d)
        return out


class Sculpt(Field):
    """A Field that remembers which labelled part made which material, so
    the mesh's faces can be classified (the nearest labelled part wins)."""

    def __init__(self, lo, hi, voxel):
        super().__init__(lo, hi, voxel)
        self.parts = []

    def put(self, label, prim, k=0.5):
        self.add(prim, k)
        self.parts.append((label, prim))

    def cut_above(self, h, k=0.0):
        """Flatten everything above z = h (a deck, a lip)."""
        Z = self.axes[2][None, None, :]
        self.d = smax(self.d, (Z - h).astype(np.float32) + np.zeros_like(self.d), k) if k else np.maximum(self.d, (Z - h).astype(np.float32))

    def cut_below(self, h):
        Z = self.axes[2][None, None, :]
        self.d = np.maximum(self.d, (h - Z).astype(np.float32))

    def classify(self, centres, default='hide'):
        best = np.full(len(centres), np.inf)
        kind = np.array([default] * len(centres), dtype=object)
        for label, prim in self.parts:
            d = prim.at(centres)
            better = d < best - 0.02
            best = np.where(better, d, best)
            kind[better] = label
        return kind


def mesh_sculpt(field, bpy, name, target_tris):
    """Mesh the zero set (OpenVDB + Blender's Volume to Mesh), decimate to the
    budget, return (vertices (n, 3), polygons)."""
    import bmesh
    import openvdb as vdb

    g = vdb.FloatGrid(background=float(BIG))
    g.copyFromArray(field.d)
    g.transform = vdb.createLinearTransform(voxelSize=field.voxel)
    g.name = 'density'
    path = os.path.join(tempfile.gettempdir(), f'gravewyrm_sanctum_{name}_{os.getpid()}.vdb')
    vdb.write(path, grids=[g])
    before = set(bpy.data.objects)
    bpy.ops.object.volume_import(filepath=path)
    vol = [o for o in bpy.data.objects if o not in before][0]
    me = bpy.data.meshes.new(name + 'Sculpt')
    ob = bpy.data.objects.new(name + 'Sculpt', me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('v2m', 'VOLUME_TO_MESH')
    mod.object = vol
    mod.grid_name = 'density'
    mod.threshold = 0.0
    mod.adaptivity = 0.0
    mod.resolution_mode = 'GRID'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = mesh
    vdata = vol.data
    bpy.data.objects.remove(vol, do_unlink=True)
    bpy.data.volumes.remove(vdata)
    try:
        os.remove(path)
    except OSError:
        pass
    mesh.calc_loop_triangles()
    tris = max(1, len(mesh.loop_triangles))
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = min(1.0, target_tris / tris)
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new()
    bm.from_mesh(out)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    verts = np.array([tuple(v.co) for v in bm.verts]) + field.lo
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bpy.data.objects.remove(ob, do_unlink=True)
    return verts, faces


def _n(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def _lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


# ------------------------------------------------------------------ the wyrm
def _spine():
    """Korzul's spine, snout to tail tip: (point, radius). The neck rises from
    the chest, arches back and brings the head round toward the lake; the
    tail runs off the hips and coils round the front of the body."""
    return [
        ((-18.6, 12.4, 31.2), 2.5),   # the back of the skull
        ((-17.6, 17.0, 34.4), 2.4),
        ((-14.4, 21.4, 34.8), 2.7),
        ((-10.4, 23.4, 31.6), 3.1),
        ((-7.0, 23.0, 26.4), 3.8),
        ((-4.6, 22.2, 21.2), 5.2),    # the withers
        ((0.0, 23.6, 17.6), 6.0),
        ((6.0, 24.6, 15.6), 5.6),
        ((11.6, 25.4, 14.4), 4.8),    # the hips
        ((17.0, 25.8, 11.8), 3.9),
        ((22.4, 24.4, 8.6), 3.2),
        ((25.4, 19.6, 5.6), 2.7),
        ((24.0, 13.6, 3.8), 2.3),
        ((18.0, 9.6, 3.2), 2.0),
        ((10.0, 7.6, 3.0), 1.75),
        ((1.0, 7.4, 3.0), 1.5),
        ((-8.0, 8.8, 3.2), 1.2),
        ((-15.6, 11.6, 4.0), 0.9),
        ((-21.4, 15.0, 5.4), 0.6),
        ((-24.6, 18.8, 7.4), 0.35),
    ]


def _wing_open():
    """The right wing, half spread across the face (bones, then membranes)."""
    sh = (5.0, 26.2, 22.0)
    el = (14.0, 28.4, 33.0)
    wr = (21.0, 29.2, 44.0)
    tips = [(39.0, 31.0, 51.0), (45.0, 31.4, 38.0), (40.0, 30.6, 24.0), (30.0, 29.4, 14.0)]
    knuckles = [_lerp(wr, t, 0.48) for t in tips]
    return sh, el, wr, tips, knuckles


def _wing_folded():
    sh = (-6.0, 27.6, 21.0)
    el = (6.0, 31.2, 29.0)
    wr = (-3.0, 31.6, 31.0)
    tips = [(16.0, 31.8, 24.0), (20.0, 31.4, 19.0), (14.0, 30.6, 16.0)]
    return sh, el, wr, tips


def wyrm_field(voxel=0.36):
    f = Sculpt((-31, -1, -1.5), (50, 36, 57), voxel)
    spine = _spine()
    pts = [p for p, _ in spine]
    rad = [r for _, r in spine]
    f.put('hide', Polyline(pts, rad), 2.4)
    # The barrel of the chest and the belly, the hips' mass.
    f.put('hide', Ellipsoid(WYRM_CHEST, (7.2, 6.6, 7.4), rot(rz=0.2)), 3.0)
    f.put('belly', Ellipsoid((-2.0, 19.4, 13.6), (6.0, 4.2, 4.8)), 2.4)
    f.put('hide', Ellipsoid((11.0, 25.0, 13.4), (5.4, 5.0, 5.0)), 2.6)
    # Ventral plates down the throat, the chest and the tail.
    for i in range(1, len(spine) - 2):
        (a, ra), (b, rb) = spine[i], spine[i + 1]
        mid = np.add(a, b) / 2
        f.put('belly', Ellipsoid((mid[0], mid[1] - ra * 0.55, mid[2] - ra * 0.5), (ra * 0.7, ra * 0.55, ra * 0.45)),
              ra * 0.4)
    # The head: a long wedge skull, heavy brow, jaws shut on a snarl, the
    # snout down toward the lake.
    hd = _n(np.subtract(WYRM_SNOUT, (-18.6, 12.4, 31.2)))
    skull = np.array((-18.8, 11.0, 30.6))
    f.put('hide', Ellipsoid(skull, (3.0, 3.6, 2.6), rot(rx=-0.55, rz=-0.15)), 1.2)
    # A long flat wedge of a snout and a heavy jaw (a frame along the head).
    ly = -hd
    lx = _n(np.cross(ly, (0.0, 0.0, 1.0)))
    lz = np.cross(lx, ly)
    HR = np.stack([lx, ly, lz], axis=1)
    L = float(np.linalg.norm(np.subtract(WYRM_SNOUT, skull)))
    for t, (rw, rl, rh) in ((0.3, (2.3, 2.8, 1.8)), (0.55, (1.9, 2.6, 1.35)), (0.8, (1.45, 2.2, 1.0)),
                            (0.95, (1.05, 1.3, 0.85))):
        f.put('hide', Ellipsoid(skull + hd * L * t, (rw, rl, rh), HR), 0.9)
    for t, (rw, rl, rh) in ((0.35, (1.9, 3.0, 0.9)), (0.62, (1.5, 2.6, 0.75)), (0.86, (1.05, 1.8, 0.6))):
        f.put('hide', Ellipsoid(skull + hd * L * t - lz * (1.5 + t * 0.4), (rw, rl, rh), HR), 0.5)
    # The nose ridge and the chin spur.
    f.put('horn', RoundCone(skull + hd * L * 0.25 + lz * 1.7, skull + hd * L * 0.9 + lz * 1.0, 0.45, 0.25), 0.4)
    f.put('horn', RoundCone(skull + hd * L * 0.86 - lz * 2.1, skull + hd * L * 1.0 - lz * 2.9, 0.4, 0.06), 0.3)
    # A frill of spines back along the jaw.
    for s_ in (-1, 1):
        for k in range(4):
            a0 = skull + hd * L * (0.1 - k * 0.08) - lz * 1.2 + lx * s_ * 2.2
            f.put('horn', RoundCone(a0, a0 + lx * s_ * 1.6 - hd * 1.8 - lz * 0.6, 0.35, 0.05), 0.25)
    for s in (-1, 1):
        # Brow ridges and the cheek spurs.
        f.put('horn', RoundCone(skull + np.array((s * 1.7, -2.4, 1.6)), skull + np.array((s * 2.0, 1.8, 2.4)), 0.75, 0.5),
              0.5)
        f.put('horn', RoundCone(skull + np.array((s * 2.6, 0.6, -1.2)), skull + np.array((s * 4.4, 3.2, -1.6)), 0.6, 0.12),
              0.35)
        # The great horns: swept back and up off the crown, then curling.
        horn = [skull + np.array((s * 1.6, 1.4, 1.8)), skull + np.array((s * 2.8, 4.4, 3.6)),
                skull + np.array((s * 3.6, 8.0, 4.4)), skull + np.array((s * 3.4, 11.0, 3.2)),
                skull + np.array((s * 2.6, 12.4, 1.2))]
        f.put('horn', Polyline(horn, [1.25, 1.0, 0.75, 0.45, 0.12]), 0.6)
        # Teeth over the lip line.
        for k in range(5):
            t = 0.25 + k * 0.15
            q = np.add(skull + hd * 1.5, (np.subtract(WYRM_SNOUT, skull + hd * 1.5)) * t)
            f.put('horn', RoundCone(q + np.array((s * 1.25, 0, -1.0)), q + np.array((s * 1.3, -0.2, -2.1)), 0.3, 0.05),
                  0.15)
    eye = skull + hd * 1.6 + np.array((0, 0, 0.9))
    for s in (-1, 1):
        f.sub(Ellipsoid(eye + np.array((s * 2.1, 0.0, 0.0)), (0.9, 0.6, 0.45)), 0.3)
    for s in (-1, 1):
        f.sub(Ellipsoid(np.add(WYRM_SNOUT, (s * 0.7, 0.4, 0.5)), (0.35, 0.35, 0.3)), 0.2)
    # Dorsal spines along the neck, the back and the tail.
    for i in range(2, len(spine) - 3):
        (a, ra), (b, rb) = spine[i], spine[i + 1]
        for t in (0.0, 0.5):
            q = np.add(a, np.subtract(b, a) * t)
            r = ra + (rb - ra) * t
            up = np.array((0.0, 0.35, 1.0))
            up = up / np.linalg.norm(up)
            f.put('horn', RoundCone(q + up * r * 0.7, q + up * (r * 1.0 + 1.0 + r * 0.32) + np.array((0.4, 0.6, 0)),
                                    r * 0.22, 0.05), 0.35)
    # The legs, folded under him: the forelegs tucked, the hind leg crouched.
    for (sh, el, paw) in (((-9.0, 19.6, 13.4), (-12.4, 14.8, 7.6), (-9.6, 11.6, 2.4)),
                          ((2.4, 19.2, 12.0), (4.6, 14.4, 6.0), (0.8, 11.4, 2.2))):
        f.put('hide', RoundCone(sh, el, 2.4, 1.5), 1.2)
        f.put('hide', RoundCone(el, paw, 1.5, 1.1), 0.8)
        for k in range(4):
            a = -0.7 + k * 0.45
            tip = np.add(paw, (math.sin(a) * 1.8, -1.6 - math.cos(a) * 0.4, -1.0))
            f.put('horn', RoundCone(np.add(paw, (math.sin(a) * 0.8, -0.6, -0.2)), tip, 0.35, 0.05), 0.2)
    f.put('hide', Ellipsoid((13.0, 21.6, 10.6), (3.6, 4.6, 4.4), rot(rx=0.4)), 1.6)
    f.put('hide', RoundCone((14.4, 18.4, 8.0), (13.0, 19.6, 2.6), 1.6, 1.0), 0.8)
    f.put('hide', RoundCone((13.0, 19.6, 2.6), (12.2, 14.6, 1.4), 1.0, 0.8), 0.6)
    for k in range(4):
        a = -0.6 + k * 0.4
        f.put('horn', RoundCone((12.2 + math.sin(a), 14.2, 1.4), (12.0 + math.sin(a) * 2.2, 12.2, 0.4), 0.35, 0.05), 0.2)
    # The open wing: arm bones, finger bones, torn membranes.
    sh, el, wr, tips, knuckles = _wing_open()
    f.put('hide', RoundCone(sh, el, 2.0, 1.3), 1.2)
    f.put('hide', RoundCone(el, wr, 1.3, 0.9), 0.7)
    f.put('horn', RoundCone(wr, np.add(wr, (-1.6, -1.4, 2.8)), 0.6, 0.08), 0.3)
    for t, k in zip(tips, knuckles):
        f.put('hide', Polyline([wr, k, t], [0.8, 0.55, 0.22]), 0.4)
    hip = (12.0, 26.2, 16.0)
    panels = [(wr, tips[0], tips[1]), (wr, tips[1], tips[2]), (wr, tips[2], tips[3]), (wr, tips[3], el),
              (el, tips[3], hip), (sh, el, hip)]
    for (a, b, c) in panels:
        f.put('membrane', Tri(a, b, c, 0.32), 0.25)
    # Scalloped trailing edges between the fingers, and old tears.
    for a, b in zip(tips, tips[1:] + [hip]):
        mid = np.add(a, b) / 2
        inward = _n(np.subtract(wr, mid))
        span = np.linalg.norm(np.subtract(a, b))
        f.sub(Ellipsoid(mid + inward * span * 0.12, (span * 0.36, 2.0, span * 0.36)), 0.6)
    for (c, r) in (((31.0, 30.6, 33.0), (3.0, 1.2, 0.8)), ((26.0, 29.6, 21.0), (0.7, 1.2, 2.6)),
                   ((36.0, 31.0, 44.0), (0.8, 1.2, 2.2))):
        f.sub(Ellipsoid(c, r, rot(ry=0.5)), 0.3)
    # The folded wing along the far flank.
    sh, el, wr, tips = _wing_folded()
    f.put('hide', RoundCone(sh, el, 1.9, 1.2), 1.0)
    f.put('hide', RoundCone(el, wr, 1.2, 0.8), 0.6)
    for t in tips:
        f.put('hide', RoundCone(wr, t, 0.6, 0.2), 0.4)
        f.put('membrane', Tri(wr, t, el, 0.3), 0.3)
    # The hollow in the chest where the shard beats: ribs arching over it.
    f.sub(Ellipsoid(WYRM_HEART, (3.8, 3.2, 4.4)), 1.0)
    for k in range(4):
        z = WYRM_HEART[2] - 3.0 + k * 2.0
        bow = [(WYRM_HEART[0] - 4.2, WYRM_HEART[1] + 1.2, z - 0.4), (WYRM_HEART[0] - 1.8, WYRM_HEART[1] - 2.8, z + 0.3),
               (WYRM_HEART[0] + 1.6, WYRM_HEART[1] - 2.9, z + 0.3), (WYRM_HEART[0] + 4.0, WYRM_HEART[1] + 1.0, z - 0.4)]
        f.put('horn', Polyline(bow, [0.55, 0.5, 0.5, 0.55]), 0.4)
    # Scale and age: a pebbled hide, old frost-scars.
    n1, n2 = Noise(41), Noise(43)
    f.displace(lambda X, Y, Z: 0.18 * n1.fbm(X * 0.5, Y * 0.5, Z * 0.5, 3)
               + 0.42 * n2.fbm(X * 0.09, Y * 0.09, Z * 0.09, 3), band=1.2)
    return f


def wyrm_mesh(bpy, target_tris=22000):
    f = wyrm_field()
    verts, faces = mesh_sculpt(f, bpy, 'Wyrm', target_tris)
    return f, verts, faces


# ------------------------------------------------------------------ figures
def _yaw_rot(facing):
    d = _n((facing[0], facing[1], 0.0))
    return rot(rz=math.atan2(d[0], -d[1]))


def humanoid_field(pose, scale=1.0, voxel=None, kit='soldier', chain=None):
    """A figure from a pose (joint positions in yards at human scale, height
    about 1.9; `scale` grows it: the giants are 3.3).

    kit: 'giant' (smith's apron, bracers, beard and topknot, a brute's
    build), 'soldier' (helm, pauldrons, cloak), 'spear' (a soldier with a
    spear), 'climber' (hood, pack, rope coil, ice axe).
    chain: link centres and long axes for a mast-thick chain in the hands."""
    S = scale
    J = {k: np.asarray(v, dtype=np.float64) * S for k, v in pose.items() if k not in ('facing', 'look')}
    facing = _n(pose['facing'])
    look = _n(pose['look'])
    up = np.array((0.0, 0.0, 1.0))
    allp = np.stack(list(J.values()))
    lo = allp.min(axis=0) - 0.5 * S
    hi = allp.max(axis=0) + 0.6 * S
    if chain:
        cps = np.stack([np.asarray(c) for c, _ in chain])
        lo = np.minimum(lo, cps.min(axis=0) - 3.2)
        hi = np.maximum(hi, cps.max(axis=0) + 3.2)
    lo[2] = min(lo[2], -0.05)
    f = Sculpt(lo, hi, voxel or 0.04 * S)
    giant = kit == 'giant'
    bulk = 1.55 if giant else 1.0
    R = _yaw_rot(facing)
    k = 0.06 * S
    # Torso: pelvis, belly, the barrel of the chest.
    f.put('skin' if giant else 'cloth', Ellipsoid(J['pelvis'], np.array((0.17, 0.12, 0.12)) * S * bulk, R), k)
    f.put('skin' if giant else 'cloth', RoundCone(J['pelvis'], J['chest'], 0.14 * S * bulk, 0.17 * S * bulk), k * 1.5)
    f.put('skin' if giant else 'armour', Ellipsoid(J['chest'], np.array((0.21, 0.135, 0.17)) * S * bulk * 1.08, R), k * 1.2)
    if giant:
        # Slabs of muscle: pectorals and the gut.
        for s in (-1, 1):
            side = np.array((math.cos(math.atan2(facing[1], facing[0]) + s * math.pi / 2),
                             math.sin(math.atan2(facing[1], facing[0]) + s * math.pi / 2), 0))
            f.put('skin', Ellipsoid(J['chest'] + facing * 0.07 * S + side * 0.09 * S + up * 0.02 * S,
                                    np.array((0.1, 0.07, 0.08)) * S, R), k)
        f.put('skin', Ellipsoid((J['chest'] + J['pelvis']) / 2 + facing * 0.08 * S, np.array((0.16, 0.12, 0.13)) * S, R),
              k * 1.5)
    f.put('skin', RoundCone(J['neck'], J['head'], 0.065 * S * bulk, 0.06 * S), k)
    # The head, the jaw and the face toward `look`.
    head = J['head']
    f.put('skin', Ellipsoid(head, np.array((0.095, 0.105, 0.12)) * S, R), k * 0.6)
    f.put('skin', Ellipsoid(head + look * 0.04 * S - up * 0.06 * S, np.array((0.075, 0.07, 0.05)) * S, R), k * 0.5)
    f.put('skin', Ellipsoid(head + look * 0.1 * S - up * 0.01 * S, np.array((0.018, 0.03, 0.035)) * S), k * 0.3)
    f.put('skin', Ellipsoid(head + look * 0.08 * S + up * 0.045 * S, np.array((0.08, 0.03, 0.02)) * S, R), k * 0.3)
    side = _n(np.cross(look, up)) if abs(look[2]) < 0.95 else np.array((1.0, 0, 0))
    for s in (-1, 1):
        f.sub(Ellipsoid(head + look * 0.085 * S + up * 0.02 * S + side * s * 0.038 * S, np.array((0.02, 0.02, 0.014)) * S),
              0.01 * S)
    # Arms: upper arm, forearm, hand.
    for s in ('l', 'r'):
        sh, el, ha = J['shoulder_' + s], J['elbow_' + s], J['hand_' + s]
        f.put('skin', RoundCone(sh, el, 0.07 * S * bulk, 0.055 * S * bulk), k)
        f.put('skin', Ellipsoid((sh * 0.55 + el * 0.45), np.array((0.075, 0.075, 0.11)) * S * bulk), k)
        f.put('skin', RoundCone(el, ha, 0.055 * S * bulk, 0.045 * S * bulk), k * 0.8)
        f.put('skin', Ellipsoid(ha + _n(ha - el) * 0.04 * S, np.array((0.055, 0.05, 0.06)) * S * bulk), k * 0.5)
        # Legs: thigh, shin, foot.
        hp, kn, ft = J['hip_' + s], J['knee_' + s], J['foot_' + s]
        f.put('cloth' if not giant else 'leather', RoundCone(hp, kn, 0.095 * S * bulk, 0.07 * S * bulk), k)
        f.put('cloth' if not giant else 'leather', RoundCone(kn, ft, 0.065 * S * bulk, 0.05 * S * bulk), k)
        toe = ft + facing * 0.15 * S - up * 0.04 * S
        f.put('leather', RoundCone(ft - facing * 0.03 * S, toe, 0.06 * S * bulk, 0.05 * S * bulk), k * 0.6)
    if giant:
        # The smith's leather apron, the belt, bracers, a beard and a topknot.
        f.put('leather', RoundBox(J['pelvis'] + facing * 0.15 * S - up * 0.12 * S, np.array((0.2, 0.03, 0.34)) * S * bulk,
                                  0.02 * S, R), k * 0.6)
        f.put('leather', RoundBox(J['chest'] + facing * 0.19 * S - up * 0.02 * S, np.array((0.16, 0.03, 0.12)) * S * bulk,
                                  0.02 * S, R), k * 0.6)
        f.put('iron', RoundCone(J['pelvis'] + up * 0.08 * S - facing * 0.01 * S, J['pelvis'] + up * 0.1 * S, 0.2 * S * bulk,
                                0.2 * S * bulk), k * 0.4)
        for s in ('l', 'r'):
            el, ha = J['elbow_' + s], J['hand_' + s]
            f.put('iron', RoundCone(el * 0.35 + ha * 0.65, el * 0.1 + ha * 0.9, 0.07 * S * bulk, 0.066 * S * bulk),
                  k * 0.3)
        f.put('hair', Ellipsoid(head + look * 0.07 * S - up * 0.1 * S, np.array((0.08, 0.06, 0.09)) * S, R), k * 0.6)
        f.put('hair', RoundCone(head - look * 0.06 * S + up * 0.09 * S, head - look * 0.13 * S + up * 0.19 * S, 0.045 * S,
                                0.02 * S), k * 0.4)
    if kit in ('soldier', 'spear'):
        f.put('armour', Ellipsoid(head + up * 0.04 * S - look * 0.01 * S, np.array((0.115, 0.125, 0.1)) * S, R), k * 0.4)
        f.put('armour', RoundBox(head + look * 0.1 * S + up * 0.03 * S, np.array((0.012, 0.012, 0.05)) * S, 0.005 * S),
              k * 0.2)
        for s in ('l', 'r'):
            f.put('armour', Ellipsoid(J['shoulder_' + s] + up * 0.04 * S, np.array((0.095, 0.095, 0.07)) * S), k * 0.4)
        f.put('cloth', RoundBox(J['chest'] - facing * 0.15 * S - up * 0.42 * S, np.array((0.22, 0.03, 0.52)) * S, 0.02 * S,
                                R @ rot(rx=-0.08)), k)
        f.put('leather', RoundCone(J['pelvis'] + up * 0.07 * S, J['pelvis'] + up * 0.09 * S, 0.17 * S, 0.17 * S), k * 0.3)
    if kit == 'spear':
        ha = J['hand_r']
        a = ha - up * 1.0 * S
        b = ha + up * 0.9 * S
        f.put('wood', RoundCone(a, b, 0.022 * S, 0.02 * S), 0.01)
        f.put('iron', RoundCone(b, b + up * 0.22 * S, 0.04 * S, 0.004 * S), 0.01)
    if kit == 'climber':
        f.put('cloth', Ellipsoid(head + up * 0.03 * S - look * 0.03 * S, np.array((0.13, 0.135, 0.13)) * S, R), k * 0.5)
        f.put('cloth', Ellipsoid(J['neck'], np.array((0.12, 0.11, 0.06)) * S, R), k)
        f.put('leather', RoundBox(J['chest'] - facing * 0.2 * S - up * 0.06 * S, np.array((0.14, 0.08, 0.2)) * S, 0.04 * S,
                                  R), k)
        from jaguar_head_sculpt import Torus
        f.put('rope', Torus(J['chest'] + up * 0.08 * S, 0.17 * S, 0.025 * S, (facing[0], facing[1], 0.6)), 0.01)
        ha = J['hand_l']
        f.put('wood', RoundCone(ha - up * 0.3 * S, ha + up * 0.35 * S, 0.02 * S, 0.018 * S), 0.01)
        f.put('iron', RoundCone(ha + up * 0.33 * S - facing * 0.12 * S, ha + up * 0.36 * S + facing * 0.16 * S, 0.025 * S,
                                0.008 * S), 0.01)
    if chain:
        # Alternate links turn a quarter, as a real chain hangs.
        for i, (c, u) in enumerate(chain):
            u = _n(u)
            n = np.cross(u, up)
            if np.linalg.norm(n) < 1e-3:
                n = np.array((1.0, 0, 0))
            n = _n(n)
            if i % 2:
                n = _n(np.cross(u, n))
            f.put('iron', Link(c, u, n, 1.55, 1.15, 0.42), 0.1)
    # Rime and age over everything.
    n1 = Noise(61 + int(S * 10))
    f.displace(lambda X, Y, Z: 0.012 * S * n1.fbm(X * 9 / S, Y * 9 / S, Z * 9 / S, 3), band=0.1 * S)
    return f


def pose_points(pelvis, lean, facing, look, arms, legs, crouch=0.0):
    """Joint positions from a few numbers (human scale).

    pelvis: (x, y, z); lean: torso tilt (rx, ry) radians; arms: (elbow_l,
    hand_l, elbow_r, hand_r) relative to the shoulders; legs: (knee_l, foot_l,
    knee_r, foot_r) absolute."""
    facing = _n(facing)
    up = np.array((0.0, 0.0, 1.0))
    side = _n(np.cross(facing, up))   # the figure's left
    tilt = rot(rx=lean[0], ry=lean[1])
    p = np.asarray(pelvis, dtype=np.float64)
    spine = tilt @ np.array((0, 0, 1.0))
    chest = p + spine * (0.32 - crouch * 0.05)
    neck = chest + spine * 0.2
    head = neck + spine * 0.13 + _n(look) * 0.02
    sh_l = chest + side * 0.2 + spine * 0.1
    sh_r = chest - side * 0.2 + spine * 0.1
    out = dict(pelvis=p, chest=chest, neck=neck, head=head, shoulder_l=sh_l, shoulder_r=sh_r,
               hip_l=p + side * 0.1 - up * 0.05, hip_r=p - side * 0.1 - up * 0.05, facing=facing, look=look)
    el_l, ha_l, el_r, ha_r = arms
    out['elbow_l'] = sh_l + np.asarray(el_l)
    out['hand_l'] = sh_l + np.asarray(ha_l)
    out['elbow_r'] = sh_r + np.asarray(el_r)
    out['hand_r'] = sh_r + np.asarray(ha_r)
    kl, fl, kr, fr = legs
    out['knee_l'], out['foot_l'], out['knee_r'], out['foot_r'] = (np.asarray(v, dtype=np.float64) for v in (kl, fl, kr, fr))
    return out


# ------------------------------------------------------------------ ice and slate
class Planes(Prim):
    """A convex block cut by planes (local normals and offsets): crisp facets
    for ice and cleaved slate."""

    def __init__(self, c, normals, offsets, R=None):
        self.c = np.asarray(c, dtype=np.float64)
        self.N = np.asarray(normals, dtype=np.float64)
        self.d = np.asarray(offsets, dtype=np.float64)
        self.R = np.eye(3) if R is None else R
        e = float(np.max(self.d)) * 1.75
        self.lo, self.hi = self.c - e, self.c + e

    def dist(self, X, Y, Z):
        Ri = self.R.T
        px, py, pz = X - self.c[0], Y - self.c[1], Z - self.c[2]
        lx = Ri[0, 0] * px + Ri[0, 1] * py + Ri[0, 2] * pz
        ly = Ri[1, 0] * px + Ri[1, 1] * py + Ri[1, 2] * pz
        lz = Ri[2, 0] * px + Ri[2, 1] * py + Ri[2, 2] * pz
        out = None
        for n, d in zip(self.N, self.d):
            v = n[0] * lx + n[1] * ly + n[2] * lz - d
            out = v if out is None else np.maximum(out, v)
        return out


class HalfSpace(Prim):
    """Everything below z = h (intersect with it to flatten a deck or a lip)."""

    def __init__(self, h, lo, hi):
        self.h = h
        self.lo, self.hi = np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)

    def dist(self, X, Y, Z):
        return Z - self.h


def block(rng, c, size, cuts=6, chamfer=(0.72, 0.94), R=None, top_tilt=0.0):
    """A faceted block: a box `size` with `cuts` random chamfer planes (a
    slanted top when top_tilt is given)."""
    half = np.asarray(size, dtype=np.float64) / 2
    N = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, -1)]
    D = [half[0], half[0], half[1], half[1], half[2]]
    t = rng.uniform(-top_tilt, top_tilt, 2)
    up = _n((t[0], t[1], 1.0))
    N.append(tuple(up))
    D.append(half[2] * float(up[2]))
    for _ in range(cuts):
        n = rng.normal(size=3)
        n[2] = abs(n[2]) * rng.choice([-0.4, 1.0])
        n = _n(n)
        support = float(np.abs(n) @ half)
        N.append(tuple(n))
        D.append(support * rng.uniform(*chamfer))
    return Planes(c, N, D, R)


def ice_noise(f, seed, amp=0.35, stria=0.5, scale=1.0, band=1.2):
    """Weather an ice field: broad melt undulation, vertical striation (noise
    stretched up Z) and fine fracture chatter."""
    n1, n2 = Noise(seed), Noise(seed + 1)
    s = scale
    f.displace(lambda X, Y, Z: amp * n1.fbm(X * 0.12 / s, Y * 0.12 / s, Z * 0.12 / s, 3)
               + stria * 0.4 * n2.fbm(X * 0.9 / s, Y * 0.9 / s, Z * 0.06 / s, 2)
               + 0.08 * s * n2.fbm(X * 2.2 / s + 5, Y * 2.2 / s, Z * 2.2 / s, 2), band=band)


def slate_noise(f, seed, amp=0.3, scale=1.0, dip=(0.0, 0.35, 1.0), band=1.0):
    """Weather a slate field: cleavage ridges along the dip, ridged chatter."""
    n1, n2 = Noise(seed), Noise(seed + 7)
    d = _n(dip)
    s = scale
    f.displace(lambda X, Y, Z: amp * n1.fbm(X * 0.25 / s, Y * 0.25 / s, Z * 0.25 / s, 2)
               + 0.05 * s * n2.fbm(X * 1.5 / s, Y * 1.5 / s, Z * 1.5 / s, 2), band=band)
