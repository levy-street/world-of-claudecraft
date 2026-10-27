"""The Smith's Heart's Quench kit (phase 2H, build_smith_heart_quench_kit.py):
the east vein that sinks out of the Ring into the cold, landing by landing,
down to the Frozen Lake on the Quench Basin's shelf where the Guardian of the
Quench waits.

Primal and divine (E:/woc/entregas/raid_corazon/DECISIONES_DISENO.md): the
Quench is the cold water the Smith cooled his work in, so nothing here is
metal. The stone is Stormcrag's granite gone pale and blue with frost
(frost-cracked, rime on every upward face, a cold blue in the hollows, never
black, L6); the ice is the lake's own, clear and blue, dense in its core;
the vein's pale light lives in crystal and deep in the ice only, a value
under a telegraph's. The braziers' fire is the one warm thing in the cold.
Every piece is a few big masses (the style guide's S5), bent in one slow arc
(H2), its small work clustered where the eye goes (R2): the bowls' carved
rims, the blades' fullers, the cracks' frost.

  - Kit_LakeBrazier: a carved stone fire bowl on the shelf (the layout's
    `sh_brazier`, collider r 1.5): a stepped plinth, a fluted pedestal, a
    wide bowl with a rolled rim and the Smith's chevrons cut round it, four
    lugs, a bed of live coals; the fire has melted the rime off its top and
    sooted the rim, and its meltwater hangs frozen under the belly.
  - Kit_SunkBlade: one of the Smith's great blades of ice sunk point first in
    the lake (`sh_sunk_blade`, r 1.6, about 12 tall): a broad blade of clear
    ice with a fuller down both faces and the vein's light deep in it, a
    crossguard of two swept horns of ice, a frost-wrapped grip, a crystal
    pommel; the lake heaved up round it in broken plates.
  - Kit_IceShelfA, B: the old ice heaped against the basin's walls past the
    shelf's rim (`sh_ice_shelf`, render only): great tilted slabs shoved up
    over one another, banded with old dust, snow on their tops, icicles
    under their brows, a root plunging into the mist.
  - Kit_SteamVent: a vent in the shelf's rock (`sh_steam_vent`, flat: under
    a hand): a ring of wet dark stone the steam keeps free of frost, pale
    mineral crust, a dark throat with a faint light down it.
  - Kit_IceBlade: a cluster of ice blades heaved up through the Singing Ice
    (`sh_ice_blade`, r 0.8).
  - Kit_FrostStone: a squat standing stone at a landing's rim
    (`sh_frost_stone`, r 1.6): two frost-cracked blocks, a band of chevrons,
    ice growing out of its cracks, a crystal deep in one, snow on its head.
  - Kit_QuenchWallA, B: the low walls along every Quench walk over the void
    (an edge module, 6 yd at stretch 1): frost granite a knee high under
    rounded copings with a pillow of snow on them, icicles hanging off the
    outer face, its face down the cliff two lifts deep. B: a coping lost.
  - Kit_FrozenFallA, B: a waterfall frozen on the vein's walls (render
    only): fused columns of ice bulging in freeze rings, deep blue in their
    grooves, pale on their lobes, a frozen splash at the foot, a snowy lip
    of rock at the head. A tall, B short.
  - Kit_IceCrackA, B: the Singing Ice's cracks (flat inlays): A a long crack
    and its branches, B a web of radial and ring cracks; frost bloom along
    them, the vein's light faint in the widest.
  - Kit_SnowDriftA, B: low drifts of snow (under a hand) at the lake's edge
    and the walls' feet.

Frames (yards, +Z up, the game's +Z is Blender -Y):
  - props and inlays: the foot's centre; Kit_IceShelf*'s face toward -Y
    (the layout's local +Z, toward the lake);
  - Kit_QuenchWall*: the edge planner's frame (along X, origin on the lip at
    the walk's height, the drop toward -Y, nothing over the walk (y > 0.05)
    above the walk's height);
  - Kit_FrozenFall*: origin at the head of the fall on the rock's face, the
    ice hanging down -Z in front of it (toward -Y), its back into the rock.
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
from mathutils import Vector

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Sculpt, block
from gwkit import GLASS as ICE_SLOT
from gwkit import ICE, SNOW, add_sculpt, crystal, hull, mix, slab, sstep
from hckit import GLOW, STONE, _fbm
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, Prim, RoundBox, RoundCone, Torus, rot
from ring_sculpt import facet_crystal
from shkit import DRESSED, PAINT, RAW, TAU, SPiece

# ---- the frozen stone (sRGB) ----------------------------------------------------------
# Stormcrag's granite under the frost: a value over the Ring's, pale and
# blue; the hollows a cold slate blue (never black, L6).
FROST = (0.5, 0.54, 0.6)
FROST_COOL = (0.42, 0.47, 0.55)
FROST_PALE = (0.64, 0.68, 0.73)
FROST_WARM = (0.53, 0.53, 0.55)
FROST_DARK = (0.3, 0.34, 0.41)
FROST_DEEP = (0.19, 0.22, 0.29)
WET = (0.2, 0.22, 0.26)
SOOT = (0.13, 0.12, 0.12)
SINTER = (0.74, 0.74, 0.68)
HOAR = (0.78, 0.86, 0.93)
# Snow and rime.
RIME = (0.85, 0.89, 0.93)
SNOW_SHADE = (0.6, 0.7, 0.82)
# The lake's ice: the dense core, the clear body, the pale worn faces.
ICE_CORE = (0.09, 0.25, 0.42)
DEEP_ICE = (0.17, 0.41, 0.6)
ICE_MID = (0.34, 0.6, 0.79)
ICE_CLEAR = (0.46, 0.72, 0.88)
ICE_PALE = (0.7, 0.86, 0.95)
ICE_OLD = (0.44, 0.54, 0.62)
# The vein's pale light (QUENCH 0x9ad8ff), in crystal and deep in the ice
# only, a value under a telegraph's: the deep crystal, its brighter heart.
QUENCH_GLOW = (0.4, 0.66, 0.84)
QUENCH_CORE = (0.66, 0.88, 0.98)
# The braziers' coals: the one warm colour in the vein.
COAL = (0.92, 0.45, 0.13)
COAL_HOT = (1.0, 0.74, 0.36)
COAL_DEEP = (0.58, 0.2, 0.05)
CHAR = (0.1, 0.09, 0.085)

FROST_COLOURS = {
    'g0': FROST, 'g1': FROST_COOL, 'g2': FROST_PALE, 'g3': FROST_DARK, 'g4': (0.46, 0.5, 0.56),
    'g5': FROST_WARM, 'dressed': (0.62, 0.65, 0.7), 'soot': SOOT, 'deep': FROST_DEEP,
    'ice': ICE_MID, 'ice2': ICE_CLEAR, 'ice_deep': DEEP_ICE, 'ice_old': ICE_OLD, 'ice_pale': ICE_PALE,
    'snow': RIME, 'wet': WET,
}
FROST_KINDS = {k: RAW for k in FROST_COLOURS}
FROST_KINDS['dressed'] = DRESSED
FROST_KINDS['soot'] = PAINT
FROST_KINDS['deep'] = PAINT
FROST_KINDS['wet'] = PAINT
for _k in ('ice', 'ice2', 'ice_deep', 'ice_old', 'ice_pale'):
    FROST_KINDS[_k] = (ICE, ICE_SLOT)
FROST_KINDS['snow'] = SNOW
TONES = ('g0', 'g1', 'g4', 'g5', 'g2', 'g1')

SHARP = math.radians(30)


# ---- the weather -------------------------------------------------------------------------
class QuenchPiece(SPiece):
    """SPiece with the Quench's own weather. Stone (RAW, DRESSED): the big
    value groups first (pale frosted crests, mid faces, cold slate-blue
    joints, never black), rime laid on every upward face in drifts, a pale
    hoarfrost bloom on the worn edges; within `melt` (a centre and a radius:
    a brazier's fire) the rime gives way to wet stone and soot. Ice (ICE, on
    the ice slot): the dense blue core in the creases and low down, clear on
    the faces, pale on the worn lobes, vertical striation, a crust where the
    faces turn up. Snow (SNOW): white, a cold blue in the hollows and under."""

    def __init__(self, name, seed=0, rime=1.0, melt=None, depth_k=1.0, **kw):
        kw.setdefault('ao', 0.75)
        kw.setdefault('dust', 0.0)
        super().__init__(name, seed=seed, **kw)
        self.rime = rime
        self.depth_k = depth_k
        self.melt = (Vector(melt[0]), melt[1]) if melt else None

    def finish(self, materials, parent):
        import bmesh
        import bpy
        bm = self.bm
        free = [f for f in bm.faces if not f[self.keep]]
        if free:
            bmesh.ops.recalc_face_normals(bm, faces=free)
        bm.normal_update()
        bm.verts.index_update()
        floor = min(v.co.z for v in bm.verts) if bm.verts else 0.0
        top = max(v.co.z for v in bm.verts) if bm.verts else 1.0
        span = max(0.5, top - floor)
        conv = [0.0] * len(bm.verts)
        for v in bm.verts:
            if not v.link_edges:
                continue
            mean = Vector()
            length = 0.0
            for e in v.link_edges:
                mean += e.other_vert(v).co
                length += e.calc_length()
            n = len(v.link_edges)
            mean /= n
            length = max(1e-3, length / n)
            conv[v.index] = max(-1.0, min(1.0, (v.co - mean).dot(v.normal) / length * 1.6))
        occ = self._bake_ao(span) if self.ao > 0 else None
        for face in bm.faces:
            if face.material_index not in (STONE, ICE_SLOT):
                continue
            kind = face[self.kind]
            fn = face.normal
            for loop in face.loops:
                n = loop.vert.normal if face.smooth else fn
                p = loop.vert.co
                c = conv[loop.vert.index]
                r, g, b, _ = loop[self.col]
                col = (r, g, b)
                height = p.z - floor
                h01 = min(1.0, max(0.0, height / span))
                up = max(0.0, n.z)
                o = occ[loop.vert.index] * self.ao if occ is not None else 0.0
                melt = 0.0
                if self.melt is not None:
                    d = (p - self.melt[0]).length
                    melt = sstep(self.melt[1], self.melt[1] * 0.45, d)
                if kind == ICE:
                    # Big value groups (M4): the dense core in every crease,
                    # under every brow and low down; clear on the open faces;
                    # pale and milky on the worn lobes and the thin edges; a
                    # white crust only where the faces turn up.
                    deep = max(0.0, -c) * 1.25 + (1 - h01) * 0.22 * self.depth_k
                    if n.z < -0.35:
                        deep += 0.35
                    col = mix(col, ICE_CORE, min(0.85, deep))
                    col = mix(col, ICE_PALE, min(0.7, max(0.0, c) * 1.1))
                    stria = 0.88 + 0.2 * _fbm(p.x * 1.3 + p.y * 1.3, p.y * 0.4 - p.x * 0.4, p.z * 0.1)
                    col = tuple(ch * stria for ch in col)
                    cloud = sstep(0.55, 0.8, _fbm(p.x * 0.35 + 4.0, p.y * 0.35, p.z * 0.35))
                    col = mix(col, ICE_PALE, cloud * 0.25)
                    crust = sstep(0.55, 0.9, n.z) * (0.6 + 0.4 * _fbm(p.x * 0.6, p.y * 0.6, p.z))
                    col = mix(col, RIME, min(0.9, crust * 0.9 * self.rime))
                    col = mix(col, ICE_CORE, min(0.9, o * 1.8))
                elif kind == SNOW:
                    shade = (1 - up) * 0.4 + max(0.0, -c) * 0.55
                    if n.z < -0.3:
                        shade += 0.3
                    col = mix(col, SNOW_SHADE, min(0.85, shade))
                    col = tuple(ch * (0.96 + 0.06 * _fbm(p.x * 2.2, p.y * 2.2, p.z * 2.2)) for ch in col)
                    col = tuple(ch * (1 - 0.35 * o) for ch in col)
                elif kind in (RAW, DRESSED):
                    fine = kind == DRESSED
                    tone = (0.9 if fine else 0.86) + (0.16 if fine else 0.26) * _fbm(
                        p.x * 0.18 + 3.0, p.y * 0.18, p.z * 0.14)
                    bed = 1.0 if fine else 0.96 + 0.06 * math.sin(
                        p.z * 1.7 + _fbm(p.x * 0.1, p.y * 0.1, p.z * 0.1) * 5.0)
                    foot = 0.84 + 0.16 * min(1.0, height / max(1.2, span * 0.25))
                    under = 0.86 if n.z < -0.3 else 1.0
                    # The frost's wear: worn crests pale, the joints and
                    # hollows sunk to a cold slate blue (the value range
                    # carried by the form, never a speckle).
                    wear = 1.0 + 0.4 * max(0.0, c) - (0.55 if fine else 0.5) * max(0.0, -c)
                    k = tone * bed * foot * under * wear
                    col = tuple(ch * k for ch in col)
                    col = mix(col, FROST_DEEP, max(0.0, -c) * 0.3)
                    # Hoarfrost blooms on the worn edges, rime drifts on the
                    # upward faces (M6: where the cold settles, never a coat).
                    hoar = max(0.0, c) * (0.35 + 0.65 * sstep(0.45, 0.7, _fbm(p.x * 1.9, p.y * 1.9, p.z * 1.9)))
                    col = mix(col, HOAR, min(0.4, hoar * 0.5) * self.rime * (1 - melt))
                    patch = _fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                    rime = sstep(0.42, 0.82, n.z) * sstep(0.36, 0.62, patch)
                    rime += max(0.0, c) * 0.25 * up
                    col = mix(col, RIME, min(0.92, rime * self.rime * (1 - melt)))
                    # Near a fire: the stone wet and dark, sooted toward the rim.
                    if melt > 0:
                        col = mix(col, WET, melt * 0.4)
                        col = mix(col, SOOT, melt * 0.55 * sstep(0.4, 1.0, h01))
                    col = tuple(ch * (1 - 0.7 * o) for ch in col)
                elif kind == PAINT:
                    k = 0.9 + 0.18 * _fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6)
                    col = tuple(ch * k for ch in col)
                    col = tuple(ch * (1 - 0.5 * o) for ch in col)
                # Never black (L6): the deepest joint keeps a cold slate.
                col = tuple(max(lo, ch) for ch, lo in zip(col, (0.1, 0.11, 0.14)))
                loop[self.col] = (min(1.0, col[0]), min(1.0, col[1]), min(1.0, col[2]), 1.0)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b2 = e.link_faces
                if a.normal.angle(b2.normal, 0.0) > SHARP:
                    e.smooth = False
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def QP(name, **kw):
    return QuenchPiece('Kit_' + name, **kw)


# ---- sculpt helpers --------------------------------------------------------------------
class Fn(Prim):
    """A distance field given as a function over a box (custom shapes)."""

    def __init__(self, lo, hi, fn):
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)
        self.fn = fn

    def dist(self, X, Y, Z):
        return self.fn(X, Y, Z)


def _mesh(bpy, p, f, name, target, smooth=True):
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    return add_sculpt(p, f, verts, faces, FROST_COLOURS, FROST_KINDS, smooth=smooth)


def _axes(f):
    return f.axes[0][:, None, None], f.axes[1][None, :, None], f.axes[2][None, None, :]


def _clamp(f, d):
    """Intersect the field with a region (d < 0 inside)."""
    f.d = np.maximum(f.d, (d + np.zeros_like(f.d)).astype(np.float32))


def _frost(f, seed, amp=0.08, scale=0.6, band=0.4, cracks=0.4):
    """The frost's work on stone: a broad swell, and a few thin wandering
    cracks (the freeze splitting the granite), never a fine noise."""
    n1 = Noise(seed)
    n2 = Noise(seed + 3)

    def fn(X, Y, Z):
        crack = np.maximum(0.0, 0.08 - np.abs(n2.fbm(X * 0.35, Y * 0.35, Z * 0.35, 2))) * 12.0
        return amp * n1.fbm(X * scale, Y * scale, Z * scale, 2) + amp * cracks * crack
    f.displace(fn, band=band)


def _ice_noise(f, seed, amp=0.14, scale=1.0, band=0.6):
    """Ice's own relief: a slow melt undulation, striation running down it."""
    n1, n2 = Noise(seed), Noise(seed + 1)
    s = scale
    f.displace(lambda X, Y, Z: amp * n1.fbm(X * 0.18 / s, Y * 0.18 / s, Z * 0.18 / s, 2)
               + amp * 0.45 * n2.fbm(X * 1.1 / s, Y * 1.1 / s, Z * 0.08 / s, 2), band=band)


def _on_surface(f, pts, lift=0.0):
    return [tuple(q) for q in f.snap(np.array(pts, dtype=np.float64), lift=lift, steps=8)]


def _carve(f, pts, depth, width):
    """A groove cut along a line laid on the surface."""
    f.groove(Polyline(_on_surface(f, pts), 0.02), depth, width)


def _icicles(p, roots, length, r, rng, colour=ICE_PALE):
    """Icicles hanging from root points (each a long faceted cone down)."""
    with p.as_kind(ICE):
        for q in roots:
            L = length * rng.uniform(0.45, 1.0)
            rr = r * rng.uniform(0.6, 1.2)
            p.prism((q[0], q[1], q[2] + 0.03), 5, rr, 0.0001, -L, p.vary(colour, 0.05), mat=ICE_SLOT,
                    phase=rng.uniform(0, TAU),
                    lean=(rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03)))


def _under_roots(faces, rng, count, region=None, min_area=0.02):
    """Roots for icicles: the centres of downward faces (a brow, an
    overhang, a coping's edge), optionally inside `region(c)`."""
    picks = []
    for fc in faces:
        if not fc.is_valid:
            continue
        fc.normal_update()
        if fc.normal.z > -0.55 or fc.calc_area() < min_area:
            continue
        c = fc.calc_center_median()
        if region and not region(c):
            continue
        picks.append((c.x, c.y, c.z))
    rng.shuffle(picks)
    out = []
    for q in picks:
        if all((q[0] - o[0]) ** 2 + (q[1] - o[1]) ** 2 > 0.09 for o in out):
            out.append(q)
        if len(out) >= count:
            break
    return out


def _ice_slab(p, center, size, colour, yaw=0.0, pitch=0.0, roll=0.0):
    """A broken plate of lake ice (a chamfered box, hulled, on the ice slot)."""
    with p.as_kind(ICE):
        return crystal(p, center, size, colour, n=14, yaw=yaw, pitch=pitch, roll=roll, boxy=0.25, jitter=0.12,
                       mat=ICE_SLOT)


def _snow_pillow(p, center, size, yaw=0.0):
    """A soft pillow of snow: a smooth dome (many points, round), so it
    reads as snow lying, never as a white chip."""
    with p.as_kind(SNOW):
        faces = crystal(p, center, size, p.vary(RIME, 0.02), n=26, yaw=yaw, boxy=1.0, jitter=0.05)
    return p.smooth(faces)


def _rubble(p, rng, r0, r1, count, size=(0.18, 0.42), tone=FROST_DARK, snowy=0.5):
    """Stones lying round a foot (flat, a body walks over them), some under
    a cap of snow."""
    for _ in range(count):
        a = rng.uniform(0, TAU)
        r = rng.uniform(r0, r1)
        s = rng.uniform(*size)
        with p.as_kind(RAW):
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.2), (s * 1.4, s * 1.1, s * 0.42),
                    p.vary(tone, 0.07), n=10, boxy=0.55, jitter=0.2, yaw=rng.uniform(0, TAU), floor=0.0)
        if rng.uniform(0, 1) < snowy:
            _snow_pillow(p, (math.cos(a) * r, math.sin(a) * r, s * 0.4), (s * 1.3, s * 1.0, s * 0.22),
                         yaw=rng.uniform(0, TAU))


def _paint_by(p, faces, fn):
    """Repaint sculpted faces by their centre (`fn(c)` an sRGB colour, or None
    to keep the label's): a colour that follows the form, not the labels."""
    for fc in faces:
        if not fc.is_valid:
            continue
        c = fn(fc.calc_center_median())
        if c is None:
            continue
        for loop in fc.loops:
            loop[p.col] = (*c, 1.0)


def _top_z(f, pts, below=-1e9):
    """The highest surface point over each (x, y): marched down the field
    from its top (None where the column is empty)."""
    zs = np.linspace(f.axes[2][-1], f.axes[2][0], len(f.axes[2]) * 2)
    out = []
    for (x, y) in pts:
        P = np.stack([np.full_like(zs, x), np.full_like(zs, y), zs], axis=1)
        d = f.sample(P)
        inside = np.nonzero(d < 0)[0]
        if len(inside) == 0 or zs[inside[0]] < below:
            out.append(None)
            continue
        i = inside[0]
        z0, z1, d0, d1 = zs[i - 1], zs[i], d[i - 1], d[i]
        out.append(float(z0 + (z1 - z0) * d0 / (d0 - d1)) if i > 0 else float(zs[i]))
    return out


def _lean(a):
    """A point turned about +Y by `a` (a blade's lean toward +X)."""
    ca, sa = math.cos(a), math.sin(a)

    def f(q):
        x, y, z = q
        return (x * ca + z * sa, y, -x * sa + z * ca)
    return f


# ===================================================================== the brazier
BRAZIER_FIRE = (0.0, 0.0, 2.05)


def lake_brazier(bpy):
    """The carved fire bowl (see the module doc): its fire's bed at
    BRAZIER_FIRE (the runtime lights its flame there), its touchable body
    inside r 2.0 (the collider's 1.5 and a body's width)."""
    p = QP('LakeBrazier', seed=7101, ao=0.7, ao_dist=1.0, melt=((0.0, 0.0, 2.3), 1.9))
    rng = np.random.default_rng(7101)
    f = Sculpt((-2.0, -2.0, -0.4), (2.0, 2.0, 2.6), 0.04)
    # The plinth: two rough courses, each turned its own way.
    f.put('g3', block(rng, (0.0, 0.0, 0.17), (2.5, 2.35, 0.42), cuts=10, chamfer=(0.86, 0.97),
                      R=rot(rz=0.12)), 0.05)
    f.put('g1', block(rng, (0.0, 0.0, 0.52), (1.95, 1.9, 0.36), cuts=10, chamfer=(0.86, 0.97),
                      R=rot(rz=-0.42)), 0.05)
    # The pedestal: a stout drum swelling into the bowl.
    f.put('dressed', RoundCone((0.0, 0.0, 0.55), (0.0, 0.0, 1.4), 0.72, 0.6), 0.12)
    # The bowl: wide and shallow, a rolled rim, hollowed deep.
    f.put('dressed', Ellipsoid((0.0, 0.0, 1.8), (1.55, 1.55, 0.62)), 0.15)
    f.put('dressed', Torus((0.0, 0.0, 2.12), 1.4, 0.22, (0.0, 0.0, 1.0)), 0.06)
    f.put('dressed', Torus((0.0, 0.0, 1.62), 1.5, 0.08, (0.0, 0.0, 1.0)), 0.05)
    X, Y, Z = _axes(f)
    _clamp(f, Z - 2.3)
    f.sub(Ellipsoid((0.0, 0.0, 2.34), (1.2, 1.2, 0.5)), 0.08)
    # Four lugs at the rim, between the chevrons.
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        f.put('dressed', RoundBox((math.cos(a) * 1.55, math.sin(a) * 1.55, 1.98), (0.2, 0.3, 0.2), 0.08,
                                  rot(rz=a)), 0.06)
    # The pedestal's flutes.
    for k in range(10):
        a = TAU * k / 10 + 0.15
        pts = [(math.cos(a) * (0.72 - 0.14 * t), math.sin(a) * (0.72 - 0.14 * t), 0.62 + 0.72 * t)
               for t in np.linspace(0.0, 1.0, 6)]
        _carve(f, pts, 0.07, 0.07)
    # The Smith's chevrons round the bowl's belly.
    zig = []
    for i in range(49):
        a = TAU * i / 48
        zz = 1.86 + (0.1 if i % 2 else -0.1)
        rr = 1.55 * math.sqrt(max(0.0, 1.0 - ((zz - 1.8) / 0.62) ** 2)) + 0.02
        zig.append((math.cos(a) * rr, math.sin(a) * rr, zz))
    _carve(f, zig, 0.035, 0.035)
    _frost(f, 7101, amp=0.03, scale=1.4, band=0.18, cracks=0.3)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - 1.95)
    made = _mesh(bpy, p, f, 'LakeBrazier', 3400)
    prng = p.rng
    # The coals (glow: the fire's bed), heaped in the bowl, hottest at the
    # heart, black char among them.
    for j in range(36):
        a = prng.uniform(0, TAU)
        r = math.sqrt(prng.uniform(0, 1)) * 1.0
        s = prng.uniform(0.13, 0.26) * (1.15 - r * 0.3)
        z = 1.98 + 0.2 * (1 - r * r) + prng.uniform(-0.02, 0.04)
        hot = r < 0.4 or prng.random() < 0.15
        crystal(p, (math.cos(a) * r, math.sin(a) * r, z), (s * 1.3, s, s * 0.75),
                p.vary(COAL_HOT if hot else (COAL if prng.random() < 0.7 else COAL_DEEP), 0.06), n=10, boxy=0.5,
                jitter=0.25, yaw=prng.uniform(0, TAU), mat=GLOW)
    with p.as_kind(PAINT):
        for j in range(12):
            a = prng.uniform(0, TAU)
            r = prng.uniform(0.35, 1.05)
            s = prng.uniform(0.14, 0.24)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, 2.0 + 0.1 * (1 - r)), (s * 1.3, s, s * 0.7),
                    p.vary(CHAR, 0.1), n=10, boxy=0.5, jitter=0.25, yaw=prng.uniform(0, TAU))
    # Its meltwater frozen under the belly.
    roots = []
    for k in range(16):
        a = TAU * k / 16 + prng.uniform(-0.12, 0.12)
        roots.append((math.cos(a) * 1.0, math.sin(a) * 1.0, 1.32))
    _icicles(p, roots, 0.42, 0.06, prng)
    # Snow drifted against the plinth's lee.
    _snow_pillow(p, (0.85, 0.95, 0.12), (1.5, 0.9, 0.3), yaw=0.6)
    _snow_pillow(p, (-1.15, 0.5, 0.1), (0.8, 0.7, 0.22), yaw=1.9)
    _rubble(p, prng, 1.55, 1.9, 5, snowy=0.6)
    return p


# ===================================================================== the blade
BLADE_LEAN = 0.17


def sunk_blade(bpy):
    """A great blade of ice sunk point first in the lake (see the module
    doc): about 12 tall, leaning toward +X; its touchable foot inside r 2.1."""
    p = QP('SunkBlade', seed=7201, ao=0.6, ao_dist=1.8, rime=0.6)
    rng = np.random.default_rng(7201)
    L = _lean(BLADE_LEAN)
    f = Sculpt((-4.2, -1.8, -0.6), (6.4, 1.8, 13.2), 0.06)
    ca, sa = math.cos(BLADE_LEAN), math.sin(BLADE_LEAN)

    def local(X, Z):
        return X * ca - Z * sa, X * sa + Z * ca

    def half_w(lz):
        return 1.12 + 0.035 * np.clip(lz, 0.0, 9.0)

    def blade(X, Y, Z):
        lx, lz = local(X, Z)
        w = half_w(lz)
        t = 0.5 + 0.01 * np.clip(lz, 0.0, 9.0)
        # A flat diamond: the faces bevelled to a keen edge.
        d = (np.abs(lx) * t + np.abs(Y) * w - w * t) / np.sqrt(w * w + t * t)
        # The ricasso squared off under the guard.
        return np.maximum(d, lz - 8.5)

    f.put('ice2', Fn((-3.4, -1.0, -0.6), (4.6, 1.0, 9.8), blade), 0.04)
    # The fuller down both faces: a broad shallow channel.
    for s in (-1, 1):
        pts = [L((0.0, s * 0.5, z)) for z in np.linspace(0.3, 7.6, 10)]
        f.groove(Polyline(pts, 0.02), 0.16, 0.3)
    # The crossguard: two faceted horns of ice swept up at their tips, a
    # boss of ice at the cross.
    for s in (-1, 1):
        for (x, z, w, h, t, ang) in ((1.15, 8.65, 1.35, 0.62, 0.7, 0.06), (2.35, 8.95, 1.2, 0.48, 0.58, 0.42),
                                     (3.2, 9.6, 0.95, 0.36, 0.46, 0.85)):
            q = L((s * x, 0.0, z))
            f.put('ice', block(rng, q, (w, t, h), cuts=8, chamfer=(0.7, 0.9),
                               R=rot(ry=BLADE_LEAN - s * ang)), 0.3)
    f.put('ice_deep', block(rng, L((0.0, 0.0, 8.7)), (1.25, 0.95, 0.85), cuts=10, chamfer=(0.72, 0.9),
                            R=rot(ry=BLADE_LEAN, rz=0.785)), 0.1)
    # The grip, hexagonal, wrapped by frost, and the pommel.
    grip = [(math.cos(TAU * k / 6), math.sin(TAU * k / 6), 0.0) for k in range(6)]
    f.put('ice_deep', gs.Planes(L((0.0, 0.0, 9.95)), [*grip, (0.0, 0.0, 1.0), (0.0, 0.0, -1.0)],
                                [0.34] * 6 + [1.05, 1.05], rot(ry=BLADE_LEAN)), 0.06)
    for k in range(5):
        f.put('ice', Torus(L((0.0, 0.0, 9.15 + k * 0.4)), 0.36, 0.07,
                           (math.sin(BLADE_LEAN), 0.0, math.cos(BLADE_LEAN))), 0.04)
    f.put('ice', block(rng, L((0.0, 0.0, 11.35)), (1.1, 0.95, 1.05), cuts=12, chamfer=(0.7, 0.9),
                       R=rot(ry=BLADE_LEAN, rz=0.3)), 0.1)
    _ice_noise(f, 7201, amp=0.045, scale=0.7, band=0.25)
    # Chips broken out of its edges: the frost's work on the quench.
    for j in range(11):
        z = float(rng.uniform(0.6, 7.9))
        s = -1.0 if j % 2 else 1.0
        w = 1.12 + 0.035 * z
        f.sub(Ellipsoid(L((s * w, 0.0, z)), (float(rng.uniform(0.18, 0.32)), 0.7, float(rng.uniform(0.2, 0.55))),
                        rot(ry=float(rng.uniform(-0.5, 0.5)))), 0.03)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.where(Z < 3.0, np.sqrt(X * X + Y * Y) - 2.05, -1.0))
    made = _mesh(bpy, p, f, 'SunkBlade', 4600, smooth=False)

    def colour(c):
        lx, lz = c.x * ca - c.z * sa, c.x * sa + c.z * ca
        if lz > 8.3:
            return None
        e = min(1.0, abs(lx) / float(half_w(lz)))
        # The keen edges thin and milky, the thick heart of the blade dense.
        col = mix(DEEP_ICE, ICE_CLEAR, sstep(0.25, 0.75, e))
        return mix(col, ICE_PALE, sstep(0.82, 0.98, e))
    _paint_by(p, made, colour)
    prng = p.rng
    # The vein's light deep in the fuller, both faces (a thin unbroken seam).
    for s in (-1, 1):
        q = L((0.0, s * 0.4, 4.0))
        p.box(q, (0.05, 0.02, 7.2), p.vary(QUENCH_GLOW, 0.03), mat=GLOW, roll=BLADE_LEAN)
    # The pommel's crystal crown.
    top = L((0.0, 0.0, 11.8))
    for j in range(6):
        a = TAU * j / 6 + prng.uniform(-0.2, 0.2)
        spread = 0.0 if j == 0 else 0.45
        d = (math.cos(a) * spread + sa, math.sin(a) * spread, ca)
        with p.as_kind(PAINT):
            facet_crystal(p, top, d, prng.uniform(0.5, 0.9) if j else 1.15, prng.uniform(0.1, 0.15),
                          QUENCH_CORE if j == 0 else p.vary(QUENCH_GLOW, 0.05))
    # The lake heaved up round the blade: broken plates shoved up and out,
    # snow caught in their lee.
    a = prng.uniform(0, TAU)
    for j in range(7):
        a += TAU / 7 * prng.uniform(0.7, 1.3)
        r = prng.uniform(1.25, 1.6)
        _ice_slab(p, (math.cos(a) * r, math.sin(a) * r, 0.14), (prng.uniform(0.8, 1.5), prng.uniform(0.45, 0.8),
                                                               prng.uniform(0.2, 0.3)),
                  p.vary(ICE_CLEAR if j % 3 else ICE_MID, 0.06), yaw=a + math.pi / 2 + prng.uniform(-0.3, 0.3),
                  pitch=prng.uniform(0.2, 0.7))
    for j in range(6):
        a = prng.uniform(0, TAU)
        _snow_pillow(p, (math.cos(a) * 1.7, math.sin(a) * 1.7, 0.05), (1.0, 0.6, 0.2), yaw=a + math.pi / 2)
    return p


# ================================================================ the ice shelves
def _plate(rng, c, radius, thick, sides=8, R=None):
    """A broken plate of lake ice: flat top and bottom, an irregular polygon
    outline (each side its own cut), crisp."""
    N = [(0.0, 0.0, 1.0), (0.0, 0.0, -1.0)]
    D = [thick / 2, thick / 2]
    a0 = float(rng.uniform(0, TAU))
    for k in range(sides):
        a = a0 + TAU * k / sides + float(rng.uniform(-0.25, 0.25))
        N.append((math.cos(a), math.sin(a), float(rng.uniform(-0.12, 0.12))))
        D.append(radius * float(rng.uniform(0.7, 1.05)))
    N = [tuple(np.array(n) / np.linalg.norm(n)) for n in N]
    return gs.Planes(c, N, D, R)


def ice_shelf(bpy, variant):
    """The old ice heaped against the basin's walls (see the module doc):
    its face toward -Y no further than 6 out, its root plunging 14 down."""
    seed = 7301 + ord(variant)
    p = QP('IceShelf' + variant, seed=seed, ao=0.7, ao_dist=3.0, rime=1.0, depth_k=1.4)
    rng = np.random.default_rng(seed)
    f = Sculpt((-10.5, -6.6, -16.0), (10.5, 9.5, 11.0), 0.14)
    flip = -1.0 if variant == 'B' else 1.0
    n1 = Noise(seed + 5)
    # The root: an old glacier tongue clinging to the wall, a wedge tapering
    # down into the mist, fluted by melt.

    def root(X, Y, Z):
        t = np.clip(-Z / 15.0, 0.0, 1.0)
        hx = 8.6 * (1.0 - 0.55 * t) + 0.8 * n1.fbm(X * 0.08, Y * 0.08, Z * 0.05, 2)
        hy = 3.6 * (1.0 - 0.5 * t)
        yc = 2.4 + 1.4 * t
        d = np.maximum(np.abs(X) - hx, np.abs(Y - yc) - hy)
        return np.maximum(d, Z - 0.4)
    f.put('ice_old', Fn((-10.0, -2.0, -16.0), (10.0, 7.0, 1.0), root), 0.8)
    # The plates: lake ice shoved up and over itself, the front ones lying
    # low, the back ones upended in a jagged crest against the wall (the
    # heap's silhouette).
    count = 11 if variant == 'A' else 9
    for k in range(count):
        u = k / max(1, count - 1)
        row = k % 3
        x = (-7.5 + 15.0 * u + float(rng.uniform(-0.9, 0.9))) * flip
        y = -3.0 + row * 2.6 + float(rng.uniform(-0.5, 0.5))
        radius = float(rng.uniform(2.6, 3.8)) + row * 0.4
        thick = float(rng.uniform(0.9, 1.4))
        tilt = (0.35, 0.85, 1.25)[row] + float(rng.uniform(-0.15, 0.2))
        z = 0.5 + row * 1.6 + radius * math.sin(tilt) * 0.55
        yaw = float(rng.uniform(-0.45, 0.45))
        f.put(('ice2', 'ice', 'ice_pale', 'ice_deep')[k % 4],
              _plate(rng, (x, y, z), radius, thick, R=rot(rx=tilt, ry=float(rng.uniform(-0.35, 0.35)), rz=yaw)),
              0.12)
    _ice_noise(f, seed, amp=0.12, scale=1.1, band=0.45)
    n2 = Noise(seed + 9)
    f.displace(lambda X, Y, Z: 0.3 * np.abs(n2.fbm(X * 0.45, Y * 0.45, Z * 0.04, 2)) * (Z < -0.5), band=0.6)
    X, Y, Z = _axes(f)
    _clamp(f, -6.0 - Y)
    f.cut_below(-15.0)
    made = _mesh(bpy, p, f, 'IceShelf' + variant, 5600, smooth=False)
    prng = p.rng
    # Snow lying in the heap's hollows and on its tops (found from above).
    grid = [(x, y) for x in np.linspace(-8.0, 8.0, 9) for y in np.linspace(-4.5, 5.0, 5)]
    tops = _top_z(f, grid, below=-1.5)
    for (x, y), z in zip(grid, tops):
        if z is None or prng.random() < 0.35:
            continue
        g = f.gradient(np.array([[x, y, z]]))[0]
        if g[2] < 0.75:
            continue
        _snow_pillow(p, (x + prng.uniform(-0.3, 0.3), y, z + 0.12),
                     (prng.uniform(2.2, 3.4), prng.uniform(1.6, 2.4), prng.uniform(0.5, 0.8)),
                     yaw=prng.uniform(0, TAU))
    # Icicles under the brows facing the lake.
    roots = _under_roots(made, prng, 34, region=lambda c: c.y < 1.5 and c.z > -3.0)
    _icicles(p, roots, 1.6, 0.12, prng)
    return p


# ================================================================== the vent
def steam_vent():
    """A vent in the shelf's rock (flat: nothing past 0.25 over the floor)."""
    p = QP('SteamVent', seed=7401, ao=0.0, rime=0.0)
    rng = p.rng
    # The throat.
    with p.as_kind(PAINT):
        crystal(p, (0.0, 0.0, 0.012), (1.5, 1.2, 0.024), FROST_DEEP, n=16, boxy=0.0, jitter=0.2)
    p.box((0.0, 0.0, 0.026), (0.5, 0.36, 0.012), p.vary(QUENCH_GLOW, 0.05), mat=GLOW, yaw=0.4)
    # The sinter crust in rings round it.
    with p.as_kind(PAINT):
        for k in range(14):
            a = TAU * k / 14 + rng.uniform(-0.1, 0.1)
            r = rng.uniform(1.05, 1.5)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, 0.012), (rng.uniform(0.6, 1.0), rng.uniform(0.35, 0.55), 0.024),
                    p.vary(SINTER, 0.06), n=12, boxy=0.15, jitter=0.25, yaw=a + math.pi / 2)
    # The wet dark stone the steam keeps free of frost.
    with p.as_kind(RAW):
        for k in range(11):
            a = TAU * k / 11 + rng.uniform(-0.15, 0.15)
            r = rng.uniform(0.72, 1.05)
            s = rng.uniform(0.28, 0.5)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, 0.03), (s * 1.3, s, 0.2), p.vary((0.42, 0.44, 0.49), 0.08),
                    n=12, boxy=0.85, jitter=0.12, yaw=a, floor=0.0)
    for v in p.bm.verts:
        v.co.z = min(v.co.z, 0.22)
    return p


# ============================================================== the ice blades
def ice_blade(bpy):
    """Ice blades heaved up through the Singing Ice: the tallest about 4,
    the touchable foot inside r 1.3."""
    p = QP('IceBlade', seed=7501, ao=0.55, ao_dist=0.9, rime=0.6)
    rng = p.rng
    with p.as_kind(ICE):
        for (h, r, lx, ly, yaw, col) in ((4.0, 0.5, 0.12, 0.04, 0.3, ICE_CLEAR), (2.7, 0.38, -0.16, 0.1, 1.4, ICE_MID),
                                          (1.8, 0.32, 0.05, -0.18, 2.6, ICE_PALE), (1.2, 0.26, -0.1, -0.14, 4.0, ICE_MID)):
            ox = 0.0 if h > 3.5 else math.cos(yaw) * 0.42
            oy = 0.0 if h > 3.5 else math.sin(yaw) * 0.42
            pts = []
            tilt = rng.uniform(0, TAU)
            for k, (z, rr) in enumerate(((-0.2, 1.0), (h * 0.45, 0.9), (h * 0.82, 0.72))):
                for i in range(5):
                    a = yaw + TAU * i / 5 + rng.uniform(-0.25, 0.25)
                    rj = r * rr * (1 + rng.uniform(-0.2, 0.2))
                    zz = z + (math.cos(a - tilt) * h * 0.1 if k == 2 else 0.0)
                    t = max(0.0, zz) / h
                    pts.append((ox + math.cos(a) * rj * 1.5 + lx * t * h, oy + math.sin(a) * rj * 0.55 + ly * t * h, zz))
            pts.append((ox + lx * h * 0.95, oy + ly * h * 0.95, h))
            hull(p, pts, p.vary(col, 0.05), mat=ICE_SLOT)
    for j in range(6):
        a = TAU * j / 6 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.75, 1.1)
        _ice_slab(p, (math.cos(a) * r, math.sin(a) * r, 0.1), (rng.uniform(0.6, 0.9), rng.uniform(0.45, 0.7), 0.18),
                  p.vary(ICE_CLEAR, 0.06), yaw=a + math.pi / 2, pitch=rng.uniform(0.2, 0.45) * (1 if j % 2 else -1))
    for v in p.bm.verts:
        v.co.z = max(v.co.z, 0.0)
    return p


# ============================================================ the standing stone
def frost_stone(bpy):
    """A squat frost-cracked standing stone for a landing's rim: about 5.6
    tall, its touchable foot inside r 2.1, ice grown in its cracks."""
    p = QP('FrostStone', seed=7601, ao=0.32, ao_dist=1.4)
    rng = np.random.default_rng(7601)
    f = Sculpt((-2.6, -2.6, -0.6), (2.6, 2.6, 6.6), 0.06)
    # Two heavy blocks, the head turned on the body and leaning a breath,
    # battered at the foot (heavy at the bottom, S3).
    f.put('g2', block(rng, (0.0, 0.0, 1.7), (3.3, 2.7, 3.5), cuts=20, chamfer=(0.72, 0.93),
                      R=rot(ry=0.05, rz=0.1)), 0.55)
    f.put('g3', block(rng, (0.05, 0.0, 0.35), (3.7, 3.1, 0.9), cuts=14, chamfer=(0.78, 0.95)), 0.4)
    f.put('g4', block(rng, (0.25, 0.1, 4.25), (2.7, 2.25, 2.4), cuts=18, chamfer=(0.7, 0.92),
                      R=rot(ry=-0.1, rx=0.06, rz=0.55), top_tilt=0.35), 0.6)
    # The Smith's band of chevrons where the head sits on the body.
    f.put('dressed', RoundBox((0.05, 0.02, 3.15), (1.6, 1.3, 0.27), 0.24, rot(rz=0.1)), 0.2)
    zig = []
    for i in range(41):
        a = TAU * i / 40
        zig.append((math.cos(a) * 1.85, math.sin(a) * 1.55, 3.15 + (0.15 if i % 2 else -0.15)))
    _carve(f, zig, 0.06, 0.05)
    # The frost's cracks: three wandering splits, deep and wide.
    cracks = []
    for j in range(3):
        a = TAU * j / 3 + 0.6
        pts = []
        for z in np.linspace(5.3, 0.7, 10):
            a += float(rng.uniform(-0.09, 0.09))
            pts.append((math.cos(a) * 2.0, math.sin(a) * 1.7, z))
        _carve(f, pts, 0.3, 0.17)
        cracks.append(pts)
    _frost(f, 7601, amp=0.2, scale=0.32, band=0.45, cracks=0.25)
    _frost(f, 7602, amp=0.06, scale=1.1, band=0.25, cracks=0.4)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - 2.05 - np.maximum(0.0, Z - 3.0) * 0.2)
    made = _mesh(bpy, p, f, 'FrostStone', 3000)
    prng = p.rng
    # Ice grown in the cracks: a vein of clear ice down each, crystals
    # breaking out of it.
    for pts in cracks:
        on = _on_surface(f, pts[1:-1], lift=-0.06)
        for q0, q1 in zip(on, on[1:]):
            a = Vector(q0)
            b = Vector(q1)
            mid = (a + b) / 2
            seg = b - a
            with p.as_kind(ICE):
                crystal(p, tuple(mid), (0.24, 0.24, seg.length * 1.05), p.vary(ICE_CLEAR, 0.05), n=10, boxy=0.4,
                        jitter=0.15, yaw=math.atan2(seg.x, -seg.y), pitch=math.atan2(math.hypot(seg.x, seg.y), seg.z),
                        mat=ICE_SLOT)
        for q in on[1::3]:
            out = Vector((q[0], q[1], 0.0)).normalized()
            for k in range(3):
                d = Vector((out.x + prng.uniform(-0.5, 0.5), out.y + prng.uniform(-0.5, 0.5),
                            prng.uniform(0.1, 0.9))).normalized()
                length = prng.uniform(0.5, 0.95)
                # Low down the crystals keep inside the collider and a body
                # (r 2.05): shorter, turned up the face.
                if q[2] < 3.2:
                    room = 2.0 - math.hypot(q[0], q[1])
                    out_k = math.hypot(d.x, d.y)
                    if out_k > 1e-3:
                        length = min(length, max(0.0, room / out_k))
                if length < 0.25:
                    continue
                with p.as_kind(ICE):
                    facet_crystal(p, q, tuple(d), length, prng.uniform(0.1, 0.17),
                                  p.vary(ICE_PALE if k else ICE_CLEAR, 0.05), mat=ICE_SLOT)
    # The vein's light deep in the highest crack.
    q = _on_surface(f, [cracks[0][2]], lift=-0.14)[0]
    for k in range(3):
        a = TAU * k / 3
        with p.as_kind(PAINT):
            facet_crystal(p, q, (math.cos(a) * 0.5 + q[0] * 0.3, math.sin(a) * 0.5 + q[1] * 0.3, 0.7),
                          prng.uniform(0.4, 0.6), prng.uniform(0.08, 0.11), p.vary(QUENCH_GLOW, 0.05))
    # Snow on its head and its shoulders, icicles under its brow.
    tops = _top_z(f, [(0.2, 0.1), (-1.2, -0.5), (1.3, 0.6)], below=2.5)
    for (x, y), z, s in zip([(0.2, 0.1), (-1.2, -0.5), (1.3, 0.6)], tops, ((2.1, 1.8, 0.6), (1.2, 1.0, 0.35),
                                                                        (1.1, 0.9, 0.3))):
        if z is not None:
            _snow_pillow(p, (x, y, z - 0.12), s, yaw=0.45)
    roots = _under_roots(made, prng, 12, region=lambda c: c.z > 2.4)
    _icicles(p, roots, 0.7, 0.08, prng)
    _rubble(p, prng, 1.7, 2.3, 8, snowy=0.7)
    return p


# ================================================================== the walls
def quench_wall(variant):
    """A 6 yd module of a Quench walk's low wall over the void (an edge
    piece: the walk toward +Y, the drop toward -Y): the cliff's carved face
    two lifts deep under the walk, frost granite on it a body's knee high,
    rounded copings with a pillow of snow on them, icicles off the outer
    face. B: a coping lost to the frost."""
    p = QP('QuenchWall' + variant, seed=7701 + ord(variant), ao=0.55, ao_dist=0.9)
    rng = p.rng
    half = 3.0
    with p.as_kind(RAW):
        z = -0.25
        for h in (1.4, 1.7):
            x = -half - rng.uniform(0.0, 0.9)
            while x < half:
                length = rng.uniform(1.4, 2.7)
                a, b = max(-half, x), min(half, x + length)
                if b - a > 0.25:
                    slab(p, ((a + b) / 2, -0.52, z - h / 2), (b - a - 0.07, 0.88, h - 0.07),
                         p.vary(FROST_COOL if rng.random() < 0.6 else FROST_DARK, 0.05), chamfer=0.2, jitter=0.1)
                x += length
            z -= h
        x = -half
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(1.2, 2.2))
            slab(p, (x + length / 2, -0.52, 0.29), (length - 0.06, 0.8, 0.62),
                 p.vary(FROST if rng.random() < 0.6 else FROST_WARM, 0.06), chamfer=0.2,
                 jitter=0.1, yaw=rng.uniform(-0.03, 0.03))
            x += length
        x = -half
        k = 0
        copings = []
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(0.95, 1.7))
            if not (variant == 'B' and k == 2):
                slab(p, (x + length / 2, -0.52, 0.74), (length - 0.06, 0.88, 0.28),
                     p.vary(FROST_PALE if rng.random() < 0.55 else FROST, 0.05), chamfer=0.42, jitter=0.06)
                copings.append((x + length / 2, length))
            x += length
            k += 1
    for (cx, length) in copings:
        _snow_pillow(p, (cx, -0.55, 0.9), (length * 0.85, 0.7, 0.16), yaw=rng.uniform(-0.05, 0.05))
    roots = []
    for (cx, length) in copings:
        for _ in range(int(length * 2.2)):
            roots.append((cx + rng.uniform(-length * 0.42, length * 0.42), -0.96, 0.6))
    _icicles(p, roots, 0.75, 0.05, rng)
    if variant == 'B':
        for _ in range(3):
            s = rng.uniform(0.12, 0.24)
            with p.as_kind(RAW):
                slab(p, (rng.uniform(-0.6, 0.6), rng.uniform(-0.85, -0.2), 0.63 + s * 0.15), (s * 1.4, s, s * 0.3),
                     p.vary(FROST_PALE, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.22, jitter=0.15)
    return p


# ============================================================== the frozen falls
def frozen_fall(bpy, variant):
    """A waterfall frozen on the rock (see the module doc): A about 22 tall,
    B about 14; its front at most 2.6 out of the rock, its back 3 into it."""
    seed = 7801 + ord(variant)
    p = QP('FrozenFall' + variant, seed=seed, ao=0.75, ao_dist=2.2, rime=0.8, depth_k=1.3)
    rng = np.random.default_rng(seed)
    H = 22.0 if variant == 'A' else 14.0
    W0, W1 = (4.6, 8.6) if variant == 'A' else (3.4, 6.2)
    f = Sculpt((-W1 * 0.8, -3.4, -H - 3.0), (W1 * 0.8, 3.2, 2.4), 0.15 if variant == 'A' else 0.12)
    n = Noise(seed)
    # A sheet of deep ice behind the columns (the gaps between them show
    # the dense core, never the rock), its back into the rock.
    f.put('ice_deep', Fn((-W1, 0.6, -H - 1.0), (W1, 3.2, 1.0),
                         lambda X, Y, Z: np.maximum(
                             np.maximum(np.abs(X) - (W0 + (W1 - W0) * np.clip(-Z / H, 0, 1)) * 0.46, Z - 0.0),
                             np.maximum(np.abs(Y - 2.0) - 1.2, -Z - H * 0.92))), 0.6)
    # The head: the ice swelling a little out of the notch it poured from.
    f.put('ice_pale', Ellipsoid((0.0, 0.9, -0.9), (W0 * 0.42, 1.1, 1.0)), 0.6)
    # The fused columns: each wandering down, bulging in freeze rings, the
    # middle ones longest (the outline stepped and ragged, never a board).
    cols = 8 if variant == 'A' else 6
    for k in range(cols):
        u = (k + 0.5) / cols - 0.5
        x0 = u * W0 * 0.95
        x1 = u * W1 * 1.02
        phase = float(rng.uniform(0, TAU))
        r0 = float(rng.uniform(0.55, 0.85)) * (1.15 - abs(u) * 0.5)
        length = H * float(rng.uniform(0.86, 1.0)) * (1.0 - abs(u) * 0.38)
        pts = []
        radii = []
        for t in np.linspace(0.0, 1.0, 14):
            z = -0.4 - length * t
            x = x0 + (x1 - x0) * t + 0.3 * math.sin(t * 4.0 + phase)
            bulge = 0.25 + 1.15 * t ** 0.65 + 0.35 * max(0.0, math.sin(t * 9.0 + phase))
            pts.append((x, 0.4 - bulge, z))
            ring = 1.0 + 0.28 * max(0.0, math.sin(z * 0.85 + phase)) ** 2
            radii.append(r0 * (0.8 + 0.5 * t) * ring)
        f.put(('ice2', 'ice', 'ice_pale', 'ice2')[k % 4], Polyline(pts, radii), 0.5)
        # Its icicle beard: a few thin columns running on below it.
        for j in range(2):
            xs = pts[-1][0] + float(rng.uniform(-0.6, 0.6))
            zt = pts[-1][2]
            f.put('ice_pale', RoundCone((xs, pts[-1][1] + 0.2, zt + 0.8), (xs + float(rng.uniform(-0.1, 0.1)),
                                         pts[-1][1] + 0.3, zt - float(rng.uniform(1.0, 2.6))), 0.32, 0.04), 0.15)
    # The frozen splash at its foot.
    f.put('ice_pale', Ellipsoid((0.0, -1.0, -H - 0.8), (W1 * 0.5, 1.9, 1.6)), 0.9)
    # The lip of rock it poured over (frosted granite, snow on it).
    f.put('g2', block(rng, (0.0, 2.0, 0.7), (W0 * 1.1, 2.4, 1.4), cuts=12, chamfer=(0.72, 0.92)), 0.5)
    _ice_noise(f, seed, amp=0.1, scale=0.8, band=0.45)
    f.displace(lambda X, Y, Z: 0.1 * n.fbm(X * 0.7, Y * 0.7, Z * 0.12, 2), band=0.35)
    X, Y, Z = _axes(f)
    _clamp(f, -2.6 - Y)
    _clamp(f, Y - 3.0)
    _clamp(f, Z - 2.2)
    made = _mesh(bpy, p, f, 'FrozenFall' + variant, 4800 if variant == 'A' else 3400)
    prng = p.rng
    tops = _top_z(f, [(0.0, 1.4), (-W0 * 0.4, 1.0), (W0 * 0.4, 1.2)], below=0.0)
    for (x, y), z in zip([(0.0, 1.4), (-W0 * 0.4, 1.0), (W0 * 0.4, 1.2)], tops):
        if z is not None:
            _snow_pillow(p, (x, y + 0.3, z - 0.12), (W0 * 0.42, 1.3, 0.32), yaw=prng.uniform(-0.2, 0.2))
    roots = _under_roots(made, prng, 22, region=lambda c: c.y < -0.4)
    _icicles(p, roots, 1.3, 0.11, prng)
    return p


# ================================================================== the inlays
def ice_crack(variant):
    """The Singing Ice's cracks (flat: under 0.05, so every telegraph draws
    over them): A a long crack (about 13 yd) and its branches, B a web of
    radial and ring cracks; frost bloom along them, the vein's light in the
    widest."""
    p = QP('IceCrack' + variant, seed=7901 + ord(variant), ao=0.0, rime=0.0)
    rng = p.rng

    def seg(x, y, nx, ny, w, glow, bloom=True):
        ang = math.atan2(ny - y, nx - x)
        length = math.hypot(nx - x, ny - y)
        with p.as_kind(PAINT):
            if bloom:
                p.box(((x + nx) / 2, (y + ny) / 2, 0.006), (length * 1.12, w * 3.2, 0.01), p.vary(HOAR, 0.04),
                      yaw=ang)
            p.box(((x + nx) / 2, (y + ny) / 2, 0.012), (length * 1.08, max(0.03, w), 0.012),
                  p.vary(ICE_CORE, 0.05), yaw=ang)
        if glow and w > 0.07:
            p.box(((x + nx) / 2, (y + ny) / 2, 0.018), (length, max(0.02, w * 0.35), 0.012),
                  p.vary(QUENCH_GLOW, 0.04), yaw=ang, mat=GLOW)

    def run(x, y, ang, length, w, depth=0):
        step = 0.5
        n = max(2, int(length / step))
        for i in range(n):
            ang += rng.uniform(-0.14, 0.14) + (rng.choice([-1, 1]) * rng.uniform(0.35, 0.7) if rng.random() < 0.12 else 0)
            nx, ny = x + math.cos(ang) * step, y + math.sin(ang) * step
            ww = w * (1 - i / n * 0.75)
            seg(x, y, nx, ny, ww, True)
            if depth < 1 and rng.random() < 0.1:
                run(nx, ny, ang + rng.choice([-1, 1]) * rng.uniform(0.6, 1.1), length * rng.uniform(0.2, 0.4),
                    ww * 0.6, depth + 1)
            x, y = nx, ny

    if variant == 'A':
        run(-6.5, 0.0, 0.0, 13.0, 0.15)
    else:
        spokes = 7
        rings = (0.9, 1.9, 3.0)
        ends = []
        for k in range(spokes):
            a = TAU * k / spokes + rng.uniform(-0.25, 0.25)
            length = rng.uniform(3.0, 4.2)
            pts = []
            x, y = 0.0, 0.0
            for i in range(int(length / 0.6)):
                a2 = a + rng.uniform(-0.12, 0.12)
                nx, ny = x + math.cos(a2) * 0.6, y + math.sin(a2) * 0.6
                seg(x, y, nx, ny, 0.12 * (1 - i * 0.6 / length * 0.7), True)
                pts.append((nx, ny))
                x, y = nx, ny
            ends.append((a, pts))
        # The rings, broken from spoke to spoke (the web).
        for r in rings:
            for k in range(spokes):
                if rng.random() < 0.2:
                    continue
                a0 = ends[k][0]
                a1 = ends[(k + 1) % spokes][0]
                if a1 < a0:
                    a1 += TAU
                steps = max(2, int((a1 - a0) * r / 0.7))
                for i in range(steps):
                    t0, t1 = i / steps, (i + 1) / steps
                    rr0 = r * (1 + rng.uniform(-0.06, 0.06))
                    rr1 = r * (1 + rng.uniform(-0.06, 0.06))
                    b0 = a0 + (a1 - a0) * t0
                    b1 = a0 + (a1 - a0) * t1
                    seg(math.cos(b0) * rr0, math.sin(b0) * rr0, math.cos(b1) * rr1, math.sin(b1) * rr1,
                        0.06 * (1.3 - r / 4), False, bloom=False)
    xs = [v.co.x for v in p.bm.verts]
    ys = [v.co.y for v in p.bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    if variant == 'A':
        for v in p.bm.verts:
            v.co.x -= cx
            v.co.y -= cy
    return p


def snow_drift(bpy, variant):
    """Low drifts of snow (under a hand: nothing past 0.3 over the floor):
    A a long drift along a wall's foot or the lake's edge, B a round one.
    One smooth mound each (sculpted), its crest wandering, its ends
    tapering into the floor."""
    p = QP('SnowDrift' + variant, seed=8001 + ord(variant), ao=0.0, rime=0.0)
    rng = np.random.default_rng(8001 + ord(variant))
    f = Sculpt((-4.6, -2.2, -0.4), (4.6, 2.2, 0.6), 0.06)
    if variant == 'A':
        for k in range(6):
            x = -3.2 + k * 1.3 + float(rng.uniform(-0.2, 0.2))
            r = 1.0 - abs(x) / 4.6
            f.put('snow', Ellipsoid((x, float(rng.uniform(-0.15, 0.15)), -0.05),
                                    (1.5, 0.75 + 0.35 * r, 0.12 + 0.2 * r)), 0.5)
    else:
        for k in range(4):
            a = TAU * k / 4 + float(rng.uniform(-0.3, 0.3))
            f.put('snow', Ellipsoid((math.cos(a) * 0.45, math.sin(a) * 0.4, -0.04),
                                    (1.3, 1.1, 0.3)), 0.5)
    n = Noise(8001 + ord(variant))
    f.displace(lambda X, Y, Z: 0.03 * n.fbm(X * 0.8, Y * 0.8, Z, 2), band=0.15)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, Z - 0.27)
    _mesh(bpy, p, f, 'SnowDrift' + variant, 320 if variant == 'A' else 220)
    for v in p.bm.verts:
        v.co.z = max(0.0, min(v.co.z, 0.28))
    return p
