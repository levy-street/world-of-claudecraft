"""The Smith's Heart's Heat kit (phase 2I, build_smith_heart_heat_kit.py):
the west vein, level with the Ring, that runs from its mouth through the
hall and across the casting floor and the bridge to the Hearth, where the
Guardian of the Heat waits.

The Heat is no forge (E:/woc/entregas/raid_corazon/DECISIONES_DISENO.md,
"no repetir a Varkhul / Ignivar"): no anvil, bellows, crucible, chain, coal
or tool. It is the Hearth, the Smith's first flame: white-gold fire (never
volcanic red) sealed in living crystal and in the mountain's dark basalt.
The basalt stands in the columns it cooled into (bundled hexagonal prisms,
the one shape the vein is known by), sooted by the fire, ash settled on
every upward face, split by seams the fire still burns in. The fire lives
in crystal and in the seams only; the stone is never painted orange.
Every piece is a few big masses (the style guide's S5), its small work
clustered where the eye goes (R2): the crystals, the seams, the socket.

  - Kit_HearthMouth: the great hearth in the Forge's west wall (the
    layout's `sh_great_hearth`, render only, past the floor's lip): a vast
    natural mouth in the mountain, its jambs bundles of basalt columns
    leaning in under a lintel of black rock, its throat full of the first
    flame's crystal (great white-gold prisms rising from the floor, hanging
    from the roof, crowding the back). The story's wink: by the left jamb a
    scorched, empty socket in the crystal where a spark was torn out.
  - Kit_AltarStone: the great altar-stone before it (`sh_giant_anvil`'s
    footprint, box 3.2 by 8.5): a stepped foot of column stumps, a long
    slab of fire-veined basalt, a crack of white-gold fire down its table,
    crystal breaking out of its north end, a smaller cluster at its south.
  - Kit_Wellspring: the pour's source on the casting floor
    (`sh_pour_crucible`, r 3): a cracked mound of basalt brimming with
    white-gold fire, crystal crowding its back, its lip split toward the
    Pour Channel where the fire spills.
  - Kit_FireCrystalA, B: clusters of fire crystal on a bed of column
    stumps (`sh_crucible`, r 2.4): A tall, B broad.
  - Kit_EmberBoulder: a long boulder of basalt split open by a seam of fire,
    crystal grown in the split (`sh_great_bellows`, box 4 by 6.5).
  - Kit_HearthPillar: a bundle of basalt columns rising out of the chasm at
    a corner of the Forge (render only, past the lip): the hall's sides as
    carved mountain, each column topped at its own height, fire in a joint.
  - Kit_HeatBridge: the anvil bridge's natural arch of basalt under its deck,
    fire-glazed in the chasm's light.
  - Kit_HeatWallA, B: the low walls along every Heat walk over the void (an
    edge module, 6 yd at stretch 1): a parapet of short basalt columns a
    knee high, ash on their heads, a fire seam at a foot here and there. B:
    one column broken off.
  - Kit_PourChannel: a 6 yd module of the Pour Channel cut in the casting
    floor (flat: its bed under 0.05, its kerbs under 0.25): a bed of dark
    fire-glazed rock, the last pour's residue glowing in its cracks.
  - Kit_PourSpill: the channel's mouth at the floor's south lip (render
    only, past the lip): the notch the fire pours through, the glaze it has
    run down the cliff in.
  - Kit_FireCrackA, B: seams of fire in the floor (flat inlays): A a long
    seam and its branches, B a star of seams.
  - Kit_AshDriftA, B: low drifts of ash and cinder (under a hand).

Frames (yards, +Z up, the game's +Z is Blender -Y):
  - props and inlays: the foot's centre; their front (the layout's local
    +Z) toward -Y;
  - Kit_HearthMouth: the mouth's centre at the floor's height, its front
    toward -Y (to the Forge), its body into the mountain (+Y);
  - Kit_HearthPillar: its centre at the floor's height, plunging down;
  - Kit_HeatBridge: the bridge's east end on its axis at the deck's height,
    the bridge running along +X;
  - Kit_HeatWall*, Kit_PourChannel: the edge planner's frame (along X,
    origin on the lip at the walk's height, the drop toward -Y);
  - Kit_PourSpill: on the lip at the walk's height, the drop toward -Y.
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
from mathutils import Vector

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Sculpt, block
from gwkit import add_sculpt, crystal, hull, mix, slab, sstep
from hckit import GLOW, STONE, _fbm
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, Prim, RoundBox, RoundCone, rot
from ring_sculpt import facet_crystal
from shkit import DRESSED, PAINT, RAW, TAU, SPiece

# ---- the basalt (sRGB) ------------------------------------------------------------------
# The mountain's basalt where the first flame cooled it: a dark warm grey
# (never black, L6), the crests a value paler, the joints a deep warm slate,
# soot in streaks above every fire, ash settled pale on every upward face.
BASALT = (0.29, 0.27, 0.26)
BASALT_COOL = (0.25, 0.25, 0.27)
BASALT_WARM = (0.33, 0.3, 0.27)
BASALT_PALE = (0.4, 0.37, 0.34)
BASALT_DARK = (0.19, 0.18, 0.18)
BASALT_DEEP = (0.12, 0.11, 0.11)
SOOT = (0.1, 0.095, 0.09)
ASH = (0.58, 0.55, 0.51)
ASH_WARM = (0.62, 0.56, 0.48)
CINDER = (0.24, 0.2, 0.18)
# The fire's touch on the stone round a seam: rock baked a warm umber and
# glazed (lit, so it takes the sun; the seam itself is the glow).
BAKED = (0.42, 0.3, 0.2)
GLAZE = (0.5, 0.36, 0.2)
SCORCH = (0.075, 0.07, 0.068)
# The first flame (the glow slot, read as emitted colour): white-gold at its
# heart, gold in the body, a deep amber in the shade of a facet. Never red.
# The dressing's fire stays a value under a telegraph's: the seams are the
# deep and the body, only the throat's heart burns white.
FIRE_CORE = (1.0, 0.93, 0.72)
FIRE_PALE = (0.98, 0.85, 0.56)
FIRE = (0.9, 0.66, 0.32)
FIRE_DEEP = (0.6, 0.36, 0.12)
FIRE_DIM = (0.38, 0.2, 0.06)

HEAT_COLOURS = {
    'b0': BASALT, 'b1': BASALT_COOL, 'b2': BASALT_PALE, 'b3': BASALT_DARK, 'b4': (0.31, 0.29, 0.28),
    'b5': BASALT_WARM, 'dressed': (0.36, 0.34, 0.32), 'soot': SOOT, 'deep': BASALT_DEEP,
    'baked': BAKED, 'ash': ASH, 'cinder': CINDER,
}
HEAT_KINDS = {k: RAW for k in HEAT_COLOURS}
HEAT_KINDS['dressed'] = DRESSED
for _k in ('soot', 'deep', 'cinder'):
    HEAT_KINDS[_k] = PAINT
TONES = ('b0', 'b1', 'b4', 'b5', 'b2', 'b0', 'b3')

SHARP = math.radians(30)


# ---- the weather -------------------------------------------------------------------------
class HeatPiece(SPiece):
    """SPiece with the Heat's own weather. Stone (RAW, DRESSED): the big value
    groups first (pale worn crests, the dark warm basalt, deep joints, never
    black), ash settled pale on the upward faces in drifts, soot streaked up
    the faces; within `seam_r` of a fire seam (`seams`: polylines) the stone
    baked a warm umber and glazed toward it, scorched black right at its lip.
    `soot` scales the soot; `ash` the ash."""

    def __init__(self, name, seed=0, ash=1.0, soot=1.0, seam_r=0.55, soot_fn=None, glaze_fn=None, **kw):
        kw.setdefault('ao', 0.75)
        kw.setdefault('dust', 0.0)
        super().__init__(name, seed=seed, **kw)
        self.ash = ash
        self.soot_k = soot
        self.seam_r = seam_r
        self.seams = []
        # `soot_fn(p)`: how sooted the stone is at p (0..1: above a fire);
        # `glaze_fn(p, n)`: how far the fire's light has baked it (0..1).
        self.soot_fn = soot_fn
        self.glaze_fn = glaze_fn

    def seam_dist(self, p):
        best = 1e9
        for pts in self.seams:
            for a, b in zip(pts, pts[1:]):
                ab = b - a
                L2 = ab.length_squared
                t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
                d = (p - (a + ab * t)).length
                if d < best:
                    best = d
        return best

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
        seam_cache = {}
        for face in bm.faces:
            if face.material_index != STONE:
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
                up = max(0.0, n.z)
                o = occ[loop.vert.index] * self.ao if occ is not None else 0.0
                if kind in (RAW, DRESSED):
                    fine = kind == DRESSED
                    tone = (0.9 if fine else 0.85) + (0.16 if fine else 0.26) * _fbm(
                        p.x * 0.16 + 3.0, p.y * 0.16, p.z * 0.12)
                    under = 0.84 if n.z < -0.3 else 1.0
                    foot = 0.86 + 0.14 * min(1.0, max(0.0, height) / max(1.2, span * 0.2))
                    # Worn crests pale, joints and hollows sunk to a deep warm
                    # slate (the value range carried by the form).
                    wear = 1.0 + 0.42 * max(0.0, c) - (0.5 if fine else 0.55) * max(0.0, -c)
                    k = tone * under * foot * wear
                    col = tuple(ch * k for ch in col)
                    col = mix(col, BASALT_DEEP, max(0.0, -c) * 0.25)
                    # Soot streaked up the faces (M6: above anything with a fire).
                    streak = sstep(0.55, 0.85, _fbm(p.x * 0.9 + p.y * 0.9, p.y * 0.3 - p.x * 0.3, p.z * 0.06))
                    col = mix(col, SOOT, streak * 0.4 * (1 - up) * self.soot_k)
                    # Ash settled on the upward faces in drifts, never a coat.
                    patch = _fbm(p.x * 0.6 + 11.0, p.y * 0.6 - 5.0, p.z * 0.6)
                    ash = sstep(0.5, 0.88, n.z) * sstep(0.34, 0.62, patch) + max(0.0, c) * 0.18 * up
                    col = mix(col, ASH_WARM if patch > 0.55 else ASH, min(0.75, ash * self.ash))
                    if self.soot_fn is not None:
                        sz = self.soot_fn(p)
                        if sz > 0:
                            col = mix(col, SOOT, min(0.85, sz * (0.75 + 0.25 * streak)))
                    if self.glaze_fn is not None:
                        gz = self.glaze_fn(p, n)
                        if gz > 0:
                            col = mix(col, BAKED, min(0.7, gz * 0.7))
                elif kind == PAINT:
                    k = 0.9 + 0.18 * _fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6)
                    col = tuple(ch * k for ch in col)
                # The fire's touch round a seam: baked, glazed, scorched at
                # the lip (by the vertex, so a face shades across it).
                if self.seams and kind != PAINT:
                    key = loop.vert.index
                    d = seam_cache.get(key)
                    if d is None:
                        d = self.seam_dist(p)
                        seam_cache[key] = d
                    if d < self.seam_r * 3.0:
                        bake = sstep(self.seam_r * 3.0, self.seam_r * 0.6, d)
                        col = mix(col, BAKED, bake * 0.55)
                        col = mix(col, GLAZE, sstep(self.seam_r * 1.2, self.seam_r * 0.35, d) * 0.6)
                        col = mix(col, SCORCH, sstep(self.seam_r * 0.45, 0.0, d) * 0.7)
                col = tuple(ch * (1 - 0.72 * o) for ch in col)
                # Never black (L6): the deepest joint keeps a warm slate.
                col = tuple(max(lo, ch) for ch, lo in zip(col, (0.07, 0.065, 0.062)))
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


def HP(name, **kw):
    return HeatPiece('Kit_' + name, **kw)


# ---- sculpt helpers --------------------------------------------------------------------
class Fn(Prim):
    """A distance field given as a function over a box (custom shapes)."""

    def __init__(self, lo, hi, fn):
        self.lo = np.asarray(lo, dtype=np.float64)
        self.hi = np.asarray(hi, dtype=np.float64)
        self.fn = fn

    def dist(self, X, Y, Z):
        return self.fn(X, Y, Z)


def _mesh(bpy, p, f, name, target, smooth=False):
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    return add_sculpt(p, f, verts, faces, HEAT_COLOURS, HEAT_KINDS, smooth=smooth)


def _axes(f):
    return f.axes[0][:, None, None], f.axes[1][None, :, None], f.axes[2][None, None, :]


def _clamp(f, d):
    """Intersect the field with a region (d < 0 inside)."""
    f.d = np.maximum(f.d, (d + np.zeros_like(f.d)).astype(np.float32))


def hex_column(c, r, z0, z1, phase=0.0, tilt=(0.0, 0.0), top_tilt=(0.0, 0.0)):
    """One basalt column: a hexagonal prism of circumradius `r` from z0 to
    z1 about (c.x, c.y), leaning by `tilt` (radians about Y and X), its head
    cut at a slant (`top_tilt`, the column's broken top)."""
    N = []
    D = []
    ap = r * math.cos(math.pi / 6)
    for k in range(6):
        a = phase + TAU * k / 6
        N.append((math.cos(a), math.sin(a), 0.0))
        D.append(ap)
    h = (z1 - z0) / 2
    up = np.array((top_tilt[0], top_tilt[1], 1.0))
    up = up / np.linalg.norm(up)
    N.append(tuple(up))
    D.append(h * float(up[2]))
    N.append((0.0, 0.0, -1.0))
    D.append(h)
    R = rot(rx=tilt[1], ry=tilt[0])
    prim = gs.Planes((c[0], c[1], (z0 + z1) / 2), N, D, R)
    # Tight bounds (Planes guesses a cube from its largest offset: a tall
    # column would sweep the whole field).
    spread = r + h * (abs(math.sin(tilt[0])) + abs(math.sin(tilt[1]))) + 0.2
    prim.lo = np.array((c[0] - spread, c[1] - spread, z0 - 0.3))
    prim.hi = np.array((c[0] + spread, c[1] + spread, z1 + r * 0.6 + 0.3))
    return prim


def hex_prism(a, b, r, phase=0.0, cap=0.0):
    """A basalt column along any axis: a hexagonal prism of circumradius `r`
    from point a to point b (its far end cut at a slant by `cap`)."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    d = b - a
    L = float(np.linalg.norm(d))
    z = d / max(1e-6, L)
    up = np.array((0.0, 0.0, 1.0)) if abs(z[2]) < 0.95 else np.array((1.0, 0.0, 0.0))
    x = np.cross(up, z)
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    R = np.stack([x, y, z], axis=1)
    ap = r * math.cos(math.pi / 6)
    N = [(math.cos(phase + TAU * k / 6), math.sin(phase + TAU * k / 6), 0.0) for k in range(6)]
    D = [ap] * 6
    top = np.array((cap, 0.0, 1.0))
    top /= np.linalg.norm(top)
    N += [tuple(top), (0.0, 0.0, -1.0)]
    D += [L / 2 * float(top[2]), L / 2]
    prim = gs.Planes(tuple((a + b) / 2), N, D, R)
    prim.lo = np.minimum(a, b) - r - 0.3
    prim.hi = np.maximum(a, b) + r + 0.3
    return prim


def _columns(f, seed, cell=1.7, depth=0.14, width=0.09, band=0.5, axis='z', amp_fn=None):
    """Columnar jointing: shallow grooves along the edges of a jittered
    hexagonal lattice in the plane across `axis`, so a face of the rock reads
    as bundled basalt columns (the vein's own grain, low frequency)."""
    rng = np.random.default_rng(seed)
    J = rng.uniform(-0.32, 0.32, (64, 64, 2))

    def fn(X, Y, Z):
        if axis == 'z':
            U, V = X, Y
        elif axis == 'x':
            U, V = Y, Z
        else:
            U, V = X, Z
        u = U / cell
        v = V / (cell * 0.866)
        j0 = np.floor(v)
        best = np.full(np.shape(u), 9.0)
        second = np.full(np.shape(u), 9.0)
        for dj in (-1.0, 0.0, 1.0):
            j = j0 + dj
            off = np.mod(j, 2.0) * 0.5
            i0 = np.floor(u - off)
            for di in (-1.0, 0.0, 1.0):
                i = i0 + di
                ii = np.mod(i, 64).astype(int)
                jj = np.mod(j, 64).astype(int)
                cx = i + off + 0.5 + J[ii, jj, 0]
                cy = j + 0.5 + J[ii, jj, 1]
                dx = u - cx
                dy = (v - cy) * 0.866
                d = np.sqrt(dx * dx + dy * dy)
                second = np.where(d < best, best, np.minimum(second, d))
                best = np.minimum(best, d)
        edge = (second - best) * cell * 0.5
        cut = depth * np.exp(-(edge / width) ** 2)
        return cut * (amp_fn(X, Y, Z) if amp_fn else 1.0)
    f.displace(fn, band=band)


def _basalt(f, seed, amp=0.1, scale=0.35, band=0.45):
    """The basalt's broad relief: a slow swell, never a fine noise."""
    n1 = Noise(seed)
    f.displace(lambda X, Y, Z: amp * n1.fbm(X * scale, Y * scale, Z * scale, 2), band=band)


def _on_surface(f, pts, lift=0.0):
    return [tuple(q) for q in f.snap(np.array(pts, dtype=np.float64), lift=lift, steps=8)]


def _top_z(f, pts, below=-1e9):
    """The highest surface point over each (x, y) (None where empty)."""
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


def fire_crystal(p, base, direction, h, r, hot=0.0, sides=6, tip=0.24, squash=1.0):
    """A prism of the first flame's crystal (the glow slot), each facet its
    own value of the fire (a deep amber facet in the shade, gold on the
    body, white-gold toward the heat at its foot when `hot`), so the
    unlit crystal still reads faceted."""
    faces = facet_crystal(p, base, direction, h, r, FIRE, sides=sides, tip=tip, mat=GLOW, squash=squash,
                          twist=p.rng.uniform(0, TAU))
    d = Vector(direction).normalized()
    b = Vector(base)
    light = Vector((0.35, -0.55, 0.76)).normalized()
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(light)
        t = max(0.0, min(1.0, (fc.calc_center_median() - b).dot(d) / max(1e-3, h)))
        col = mix(FIRE_DEEP, FIRE, sstep(0.1, 0.8, k))
        col = mix(col, FIRE_PALE, sstep(0.72, 1.0, k) * 0.7 + sstep(0.75, 1.0, t) * 0.25)
        if hot > 0:
            col = mix(col, FIRE_CORE, hot * (1 - t) * 0.8)
        for loop in fc.loops:
            loop[p.col] = (*col, 1.0)
    return faces


def crystal_cluster(p, base, count, height, radius, rng, spread=0.45, lean=(0.0, 0.0), hot=0.0, reach=None,
                    up=(0.0, 0.0, 1.0)):
    """A cluster of fire crystals from a point: the tallest at the heart, the
    rest fanned out round it (shorter, leaning further). `reach` (a radius)
    keeps every crystal's foot within that of the base's axis below 3 yd."""
    out = []
    b = Vector(base)
    u = Vector(up).normalized()
    side = u.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    fwd = u.cross(side).normalized()
    for k in range(count):
        if k == 0:
            dirn = u + side * lean[0] + fwd * lean[1]
            h = height
            rr = radius
            q = b
        else:
            a = TAU * k / max(1, count - 1) + rng.uniform(-0.4, 0.4)
            s = spread * rng.uniform(0.5, 1.0)
            dirn = u + (side * math.cos(a) + fwd * math.sin(a)) * s + side * lean[0] + fwd * lean[1]
            h = height * rng.uniform(0.35, 0.75)
            rr = radius * rng.uniform(0.5, 0.85)
            q = b + (side * math.cos(a) + fwd * math.sin(a)) * radius * rng.uniform(0.6, 1.3)
        dirn.normalize()
        if reach is not None:
            # Below 3 yd the crystal keeps inside the reach: its foot pulled
            # in, its lean steepened (its height kept).
            rq = math.hypot(q.x, q.y)
            if rq + rr > reach:
                k = max(0.0, reach - rr - 0.05) / max(1e-3, rq)
                q = Vector((q.x * k, q.y * k, q.z))
            for f_ in (1.0, 0.8, 0.6, 0.4, 0.2, 0.0):
                d_ = Vector((dirn.x * f_, dirn.y * f_, max(0.05, dirn.z))).normalized()
                s = min(h, max(0.0, 3.0 - q.z) / max(0.05, d_.z))
                if math.hypot(q.x + d_.x * s, q.y + d_.y * s) + rr <= reach:
                    break
            dirn = d_
        out.append(fire_crystal(p, tuple(q), tuple(dirn), h, rr, hot=hot))
    return out


def fire_seam(p, f, pts, width=0.12, depth=0.18, lift=-0.04, glow=FIRE, carve=True):
    """A seam of fire in a sculpt: a groove cut along a line laid on the
    surface, the fire burning in it (thin glow segments), and the line kept
    so the weather bakes the stone round it."""
    on = _on_surface(f, pts)
    if carve:
        f.groove(Polyline(on, 0.02), depth, width)
    p.seams.append([Vector(q) for q in on])
    return on


def lay_seam_glow(p, f, on, width, lift=-0.05, colour=FIRE):
    """The fire in a seam already carved (after meshing: snapped to the cut
    surface, a hair inside it)."""
    pts = _on_surface(f, on, lift=lift)
    for q0, q1 in zip(pts, pts[1:]):
        a = Vector(q0)
        b = Vector(q1)
        mid = (a + b) / 2
        seg = b - a
        if seg.length < 1e-3:
            continue
        crystal(p, tuple(mid), (width, width, seg.length * 1.08), p.vary(colour, 0.05), n=10, boxy=0.4,
                jitter=0.12, yaw=math.atan2(seg.x, -seg.y), pitch=math.atan2(math.hypot(seg.x, seg.y), seg.z),
                mat=GLOW)


def wander(rng, a, b, steps, amp):
    """A line from a to b that wanders (a seam's path)."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    d = b - a
    side = np.cross(d, (0.0, 0.0, 1.0))
    n = np.linalg.norm(side)
    side = side / n if n > 1e-6 else np.array((1.0, 0.0, 0.0))
    out = []
    off = 0.0
    for i in range(steps + 1):
        t = i / steps
        off += rng.uniform(-amp, amp)
        off *= 0.8
        out.append(tuple(a + d * t + side * off * math.sin(t * math.pi)))
    return out


def _rubble(p, rng, r0, r1, count, size=(0.18, 0.42), ashy=0.5, centre=(0.0, 0.0)):
    """Shards of basalt and cinder lying round a foot (flat, a body walks
    over them), some under ash."""
    for _ in range(count):
        a = rng.uniform(0, TAU)
        r = rng.uniform(r0, r1)
        s = rng.uniform(*size)
        x, y = centre[0] + math.cos(a) * r, centre[1] + math.sin(a) * r
        with p.as_kind(RAW):
            crystal(p, (x, y, s * 0.2), (s * 1.4, s * 1.1, s * 0.42),
                    p.vary(BASALT_DARK if rng.random() < 0.6 else CINDER, 0.07), n=10, boxy=0.55, jitter=0.2,
                    yaw=rng.uniform(0, TAU), floor=0.0)
        if rng.uniform(0, 1) < ashy:
            with p.as_kind(PAINT):
                crystal(p, (x, y, s * 0.35), (s * 1.3, s * 1.0, s * 0.2), p.vary(ASH, 0.04), n=18, boxy=1.0,
                        jitter=0.05, yaw=rng.uniform(0, TAU))


def _column_bundle(f, rng, cols, label_cycle=TONES, k=0.06):
    """Union a list of columns (centre, r, z0, z1, phase, tilt, top_tilt) into
    a sculpt, each its own grey."""
    for i, c in enumerate(cols):
        f.put(label_cycle[i % len(label_cycle)], hex_column(*c), k)


def _bundle_layout(rng, radius, r_col, centre=(0.0, 0.0), jitter=0.18):
    """Column centres packed in a hexagonal lattice inside a radius."""
    pts = []
    step = r_col * 1.73
    n = int(radius / step) + 2
    for j in range(-n, n + 1):
        for i in range(-n, n + 1):
            x = (i + (j % 2) * 0.5) * step
            y = j * step * 0.866
            if math.hypot(x, y) > radius - r_col * 0.6:
                continue
            pts.append((centre[0] + x + rng.uniform(-jitter, jitter) * r_col,
                        centre[1] + y + rng.uniform(-jitter, jitter) * r_col))
    return pts


# ================================================================ the hearth mouth
# The mouth's measures (yards): its opening's half width at the floor and
# its crown, its mass's outer half width, how far forward its face stands
# (toward -Y, the Forge's lip at 7), how deep its throat runs, its top.
MOUTH = dict(open_half=17.0, crown=30.0, outer=34.0, face=-4.6, depth=26.0, top=47.0)


def _mouth_roof(x, t):
    """The throat's roof over x at depth t (0 the mouth, 1 the back)."""
    M = MOUTH
    half = M['open_half'] * (1.0 - 0.36 * t)
    crown = M['crown'] * (1.0 - 0.3 * t)
    u = min(1.0, abs(x) / max(1.0, half))
    # A pointed natural arch: steep at the feet, drawn to a blunt point.
    return crown * (1.0 - u ** 1.6) ** 0.62


def hearth_mouth(bpy):
    """The great hearth (see the module doc): its front no further than
    MOUTH['face'] toward the Forge, its root plunging into the chasm."""
    M = MOUTH

    def soot(q):
        # Soot over the opening up the face to its top (the smoke of the
        # first flame), thinning out to the sides.
        over = sstep(-2.0, 6.0, q.z - _mouth_roof(q.x, 0.0)) * (
            1 - sstep(M['open_half'] - 2, M['open_half'] + 9, abs(q.x)))
        return over * (1 - sstep(M['face'] + 6.0, M['face'] + 12.0, q.y)) * 0.85

    def glaze(q, n):
        # Inside the throat the first flame has baked the rock warm.
        t = (q.y - M['face']) / (M['depth'] - M['face'])
        inside = sstep(0.05, 0.3, t) * (1 - sstep(M['open_half'] * 0.9, M['open_half'] + 3, abs(q.x)))
        return inside * (0.6 + 0.4 * max(0.0, -n.y))

    p = HP('HearthMouth', seed=9101, ao=0.75, ao_dist=6.0, ash=0.9, soot=1.2, seam_r=0.9, soot_fn=soot,
           glaze_fn=glaze)
    rng = np.random.default_rng(9101)
    f = Sculpt((-M['outer'] - 5, M['face'] - 2.5, -34.0), (M['outer'] + 5, M['depth'] + 4, M['top'] + 4), 0.3)
    n1 = Noise(9103)

    def mass(X, Y, Z):
        lean = np.clip(Z, 0.0, None) * 0.1
        face = (M['face'] + 0.6 + lean + 0.9 * n1.fbm(X * 0.05, Z * 0.05, 1.0, 2)) - Y
        back = Y - (M['depth'] + 2.0)
        sides = np.abs(X) - (M['outer'] - np.clip(Z - 18.0, 0.0, None) * 0.3
                             + 2.0 * n1.fbm(Y * 0.07, Z * 0.05, 4.0, 2))
        topz = Z - (M['top'] - 5.0 * (np.abs(X) / M['outer']) ** 2 + 3.0 * n1.fbm(X * 0.05, Y * 0.06, 7.0, 2))
        return np.maximum(np.maximum(face, back), np.maximum(sides, topz))
    f.put('b0', Fn((-M['outer'] - 4, M['face'] - 1, -34.0), (M['outer'] + 4, M['depth'] + 3, M['top'] + 3), mass),
          0.8)
    # The mountain's shoulders round it: great masses of basalt bulging out
    # of the face at its flanks and crown, so its outline is rock, never a box.
    for (x, y, z, rx, ry, rz) in ((-29.0, 4.0, 12.0, 8.0, 9.0, 16.0), (30.0, 5.0, 16.0, 7.5, 9.0, 18.0),
                                  (-16.0, 8.0, 41.0, 14.0, 9.0, 7.0), (14.0, 9.0, 43.0, 15.0, 9.0, 6.5),
                                  (0.0, 12.0, 45.0, 12.0, 10.0, 5.0)):
        f.put('b3' if x < 0 else 'b4', Ellipsoid((x, y, z), (rx, ry, rz), rot(rz=float(rng.uniform(-0.2, 0.2)))),
              2.5)
    # The arch's frame: the basalt cooled in columns radiating from the
    # vent, as real basalt does round a throat of fire, so the mouth is
    # framed by a fan of prisms standing out of the face (the vein's one
    # shape, its silhouette from across the Forge).
    cz = M['crown'] * 0.36
    outline = []
    for k in range(9):
        outline.append((M['open_half'] + 0.2, k * cz / 8.0))
    for k in range(1, 30):
        x = M['open_half'] * math.cos(math.pi * k / 30.0)
        outline.append((x, max(cz, _mouth_roof(x, 0.0))))
    for k in range(9):
        outline.append((-(M['open_half'] + 0.2), cz - k * cz / 8.0))
    last = None
    for i, (x, z) in enumerate(outline):
        if last is not None and math.hypot(x - last[0], z - last[1]) < 2.5:
            continue
        last = (x, z)
        if z <= cz + 0.01:
            nx, nz = (1.0 if x > 0 else -1.0), 0.0
        else:
            nx, nz = x, z - cz * 0.55
            L = math.hypot(nx, nz)
            nx, nz = nx / L, nz / L
        r = float(rng.uniform(1.25, 1.6))
        length = float(rng.uniform(5.0, 8.5)) * (1.2 if z > cz else 1.0)
        y = M['face'] + 0.4 + float(rng.uniform(-0.4, 0.3))
        a = (x - nx * 0.4, y, z - nz * 0.4)
        b = (x + nx * length, y + float(rng.uniform(0.5, 2.0)), z + nz * length)
        f.put(TONES[i % len(TONES)], hex_prism(a, b, r, phase=float(rng.uniform(0, 1)),
                                               cap=float(rng.uniform(-0.3, 0.3))), 0.1)
        # A second rank behind, shorter, so the fan reads deep.
        if i % 2 == 0:
            a2 = (x + nx * 1.5, y + 2.0, z + nz * 1.5)
            b2 = (x + nx * (length * 0.75), y + 3.0, z + nz * (length * 0.75))
            f.put(TONES[(i + 3) % len(TONES)], hex_prism(a2, b2, r * 0.95, phase=float(rng.uniform(0, 1))), 0.1)

    # The opening and the throat.
    def throat(X, Y, Z):
        t = np.clip((Y - M['face']) / (M['depth'] - M['face']), 0.0, 1.0)
        half = M['open_half'] * (1.0 - 0.36 * t) + 0.7 * n1.fbm(Y * 0.1, Z * 0.1, 2.0, 2)
        crown = M['crown'] * (1.0 - 0.3 * t) + 1.0 * n1.fbm(X * 0.08, Y * 0.08, 3.0, 2)
        u = np.clip(np.abs(X) / np.maximum(half, 1.0), 0.0, 1.0)
        roof = crown * np.power(np.maximum(0.0, 1.0 - u ** 1.6), 0.62)
        inside = np.maximum(np.abs(X) - half, Z - roof)
        floorz = -0.6 + 1.6 * t ** 2 - Z
        front = (M['face'] - 3.0) - Y
        back = Y - (M['depth'] - 1.0)
        return np.maximum(np.maximum(inside, floorz), np.maximum(front, back))
    f.sub(Fn((-M['open_half'] - 3, M['face'] - 4, -1.5), (M['open_half'] + 3, M['depth'], M['crown'] + 3), throat),
          0.5)
    _basalt(f, 9101, amp=0.25, scale=0.08, band=0.8)
    _columns(f, 9102, cell=2.4, depth=0.22, width=0.13, band=0.6, axis='z',
             amp_fn=lambda X, Y, Z: np.clip((np.abs(X) - M['open_half'] - 6.0) / 4.0, 0.0, 1.0))
    X, Y, Z = _axes(f)
    _clamp(f, (M['face'] - 1.6) - Y)
    f.cut_below(-33.0)
    # Seams of fire: between the frame's columns down each jamb, across the
    # sill out of the throat to its lip.
    seams = []
    for s in (-1, 1):
        seams.append(fire_seam(p, f, wander(rng, (s * (M['open_half'] + 2.4), M['face'] - 1.2, 12.0),
                                            (s * (M['open_half'] + 1.6), M['face'] - 1.0, 0.5), 10, 0.25),
                               width=0.16, depth=0.24))
    for (x0, x1) in ((-4.0, -9.0), (5.0, 11.0)):
        seams.append(fire_seam(p, f, wander(rng, (x0, M['face'] + 3.0, -0.3), (x1, M['face'] - 1.4, -0.5), 6, 0.3),
                               width=0.16, depth=0.2))
    _mesh(bpy, p, f, 'HearthMouth', 11500)
    for on in seams:
        lay_seam_glow(p, f, on, 0.18)
    prng = p.rng

    def floor_at(y):
        t = (y - M['face']) / (M['depth'] - M['face'])
        return -0.6 + 1.6 * max(0.0, t) ** 2

    # The first flame's crystal: two great prisms in the throat's heart, the
    # tallest leaning toward the Forge, a crowd at their feet and up the back
    # wall (a wall of light), more hanging from the roof.
    for (x, y, h, r, n, lean) in ((-1.5, 14.0, 25.0, 2.8, 7, 0.16), (6.0, 16.5, 19.0, 2.2, 6, 0.1),
                                  (-8.0, 17.5, 16.0, 1.9, 6, 0.08), (2.0, 21.0, 17.0, 2.0, 6, 0.04),
                                  (-4.5, 5.5, 11.0, 1.5, 6, 0.22), (6.5, 4.5, 10.0, 1.4, 5, 0.2),
                                  (12.0, 2.0, 7.0, 1.1, 4, 0.2), (-12.5, 1.5, 7.5, 1.15, 4, 0.2),
                                  (-10.5, 10.5, 12.0, 1.5, 5, 0.12), (10.5, 11.0, 13.0, 1.5, 5, 0.12),
                                  (0.5, 2.0, 5.0, 1.0, 5, 0.25)):
        crystal_cluster(p, (x, y, floor_at(y) - 0.4), n, h, r, prng, spread=0.5,
                        lean=(prng.uniform(-0.08, 0.08), -lean), hot=0.55 if y > 12 else 0.3)
    # The first flame itself, sealed in its crystal at the back of the
    # throat: a great faceted heart burning white, crystal crowding it.
    heart = []
    for k in range(40):
        z_ = 1 - 2 * (k + 0.5) / 40
        rr = math.sqrt(max(0.0, 1 - z_ * z_))
        a = k * 2.39996
        heart.append((-0.5 + math.cos(a) * rr * 6.5, M['depth'] - 4.0 + math.sin(a) * rr * 3.0, 9.0 + z_ * 8.5))
    faces = hull(p, heart, FIRE_CORE, mat=GLOW)
    light = Vector((0.2, -0.9, 0.35)).normalized()
    for fc in faces:
        fc.normal_update()
        k = 0.5 + 0.5 * fc.normal.dot(light)
        col = mix(FIRE, FIRE_PALE, sstep(0.2, 0.75, k))
        col = mix(col, FIRE_CORE, sstep(0.8, 1.0, k))
        for loop in fc.loops:
            loop[p.col] = (*col, 1.0)
    # The back wall's bed of crystal, turned toward the Forge.
    for k in range(16):
        x = prng.uniform(-9.5, 9.5)
        z = prng.uniform(1.0, 17.0)
        if z > _mouth_roof(x, 0.95) - 2.0:
            continue
        crystal_cluster(p, (x, M['depth'] - 0.6, z), 3, prng.uniform(3.0, 6.0), prng.uniform(0.6, 1.0), prng,
                        spread=0.4, up=(prng.uniform(-0.3, 0.3), -1.0, prng.uniform(0.0, 0.5)), hot=0.8)
    # Hanging from the roof.
    for (x, y) in ((-5.0, 9.0), (4.0, 8.0), (0.0, 12.0), (-9.0, 14.0), (8.0, 15.0), (2.5, 19.0), (-4.0, 21.0)):
        t = (y - M['face']) / (M['depth'] - M['face'])
        crystal_cluster(p, (x, y, _mouth_roof(x, t) + 0.9), 4, prng.uniform(4.5, 8.5), prng.uniform(0.7, 1.0), prng,
                        spread=0.5, up=(0.0, -0.12, -1.0), hot=0.3)
    # The arch's teeth of light: crystal breaking out of the frame's inner
    # edge into the opening.
    for k in range(11):
        u = (k + 0.5) / 11
        x = M['open_half'] * math.cos(math.pi * u) * 0.97
        z = max(cz, _mouth_roof(x, 0.0)) - 0.2
        if z <= cz + 0.01:
            continue
        d = (-x * 0.6, -0.5, -(z - cz * 0.55) * 0.6)
        crystal_cluster(p, (x * 1.02, M['face'] + 0.6, z + 0.4), 3, prng.uniform(2.0, 3.6), prng.uniform(0.4, 0.6),
                        prng, spread=0.35, up=d, hot=0.2)
    # The story's wink: on the left jamb's inner face, a cluster of crystal
    # with its heart torn out, the socket scorched black and cracked.
    on = _on_surface(f, [(-(M['open_half'] - 0.8), M['face'] + 2.4, 8.0)])[0]
    sock = Vector(on)
    nrm = Vector(tuple(f.gradient(np.array([on]))[0]))
    t1 = nrm.cross(Vector((0, 0, 1)))
    if t1.length < 1e-3:
        t1 = Vector((0, 1, 0))
    t1.normalize()
    t2 = nrm.cross(t1).normalized()
    for k in range(7):
        a = TAU * k / 7 + 0.3
        ring = t1 * math.cos(a) + t2 * math.sin(a)
        base = sock - nrm * 0.35 + ring * 1.3
        d = (nrm * 1.0 + ring * 0.55).normalized()
        fire_crystal(p, tuple(base), tuple(d), prng.uniform(1.8, 2.8), prng.uniform(0.34, 0.46), hot=0.0)
    with p.as_kind(PAINT):
        p.prism(tuple(sock - nrm * 0.25), 6, 1.0, 0.72, 0.32, SCORCH, phase=0.3, axis=tuple(nrm))
        for k in range(9):
            a = TAU * k / 9 + prng.uniform(-0.2, 0.2)
            ring = t1 * math.cos(a) + t2 * math.sin(a)
            L = prng.uniform(1.4, 2.8)
            q0 = sock + nrm * 0.04 + ring * 0.95
            q1 = sock + nrm * 0.04 + ring * (0.95 + L)
            pts = _on_surface(f, [tuple(q0), tuple((q0 + q1) / 2), tuple(q1)], lift=0.03)
            for u0, u1 in zip(pts, pts[1:]):
                a0, b0 = Vector(u0), Vector(u1)
                seg = b0 - a0
                if seg.length < 1e-3:
                    continue
                crystal(p, tuple((a0 + b0) / 2), (0.08, 0.08, seg.length * 1.05), SCORCH, n=8, boxy=0.4,
                        jitter=0.1, yaw=math.atan2(seg.x, -seg.y),
                        pitch=math.atan2(math.hypot(seg.x, seg.y), seg.z))
    for k in range(5):
        a = TAU * k / 5
        ring = t1 * math.cos(a) + t2 * math.sin(a)
        with p.as_kind(PAINT):
            facet_crystal(p, tuple(sock - nrm * 0.15 + ring * 0.55), tuple((nrm + ring * 0.3).normalized()),
                          prng.uniform(0.25, 0.45), 0.16, (0.2, 0.15, 0.12), mat=STONE)
    # Ash and cinder banked on the sill and at the jambs' feet.
    for (x, y, s) in ((-14.5, M['face'] - 0.5, 1.5), (14.0, M['face'] - 0.4, 1.3), (-7.0, 1.5, 1.0),
                      (8.0, 2.0, 1.1)):
        with p.as_kind(PAINT):
            crystal(p, (x, y, floor_at(y) - 0.3), (s * 2.6, s * 1.4, s * 0.5), p.vary(ASH, 0.04), n=24, boxy=1.0,
                    jitter=0.06, yaw=prng.uniform(0, TAU))
    return p


# ================================================================ the altar-stone
ALTAR = dict(hw=3.2, hd=8.5, table=5.3)


def altar_stone(bpy):
    """The great altar-stone (see the module doc): its touchable body inside
    the collider's box (3.2 by 8.5) and a body's width below 3 yd, its table
    at ALTAR['table'], the north end (-Y) its tall crystal."""
    p = HP('AltarStone', seed=9201, ao=0.7, ao_dist=2.0, ash=1.1, seam_r=0.45)
    rng = np.random.default_rng(9201)
    A = ALTAR
    f = Sculpt((-4.4, -10.0, -0.4), (4.4, 10.0, A['table'] + 1.2), 0.08)
    # The altar is a dolmen of the mountain's basalt: three pairs of columns
    # standing in a low bed of stumps, a great capstone laid across them
    # (the old anvil's footprint and height, its shape the oldest altar
    # there is). Below the capstone the eye sees through between the
    # uprights.
    for (cx, cy) in _bundle_layout(rng, 9.4, 0.8):
        if abs(cx) > A['hw'] + 0.1 or abs(cy) > A['hd'] + 0.1:
            continue
        if rng.random() < 0.35:
            continue
        top = 0.3 + float(rng.uniform(0.0, 0.35))
        f.put(TONES[int(rng.integers(0, len(TONES)))],
              hex_column((cx, cy), 0.8, -0.4, top, phase=float(rng.uniform(0, 1)),
                         top_tilt=(float(rng.uniform(-0.15, 0.15)), float(rng.uniform(-0.15, 0.15)))), 0.03)
    for y in (-5.8, 0.2, 5.9):
        for s in (-1, 1):
            for (dx, dy, r, h) in ((1.55, 0.0, 0.9, 3.75), (2.3, 1.0, 0.7, 2.6), (0.9, -0.9, 0.65, 2.1)):
                f.put(TONES[int(rng.integers(0, len(TONES)))],
                      hex_column((s * dx + float(rng.uniform(-0.1, 0.1)), y + s * dy * 0.6), r, -0.4,
                                 h + float(rng.uniform(-0.15, 0.1)), phase=float(rng.uniform(0, 1)),
                                 top_tilt=(float(rng.uniform(-0.1, 0.1)), float(rng.uniform(-0.1, 0.1)))), 0.05)
    # The capstone: one great slab, thick, its edges broken and worn round,
    # a breath off level and off square.
    f.put('dressed', block(rng, (0.05, 0.1, 4.4), (A['hw'] * 2 - 0.35, A['hd'] * 2 - 0.4, 1.95), cuts=30,
                           chamfer=(0.66, 0.9), R=rot(rz=-0.025, rx=0.015, ry=0.02), top_tilt=0.06), 0.35)
    _basalt(f, 9203, amp=0.09, scale=0.4, band=0.3)
    # The crack of fire down the table, a branch off it, and two down the
    # flanks (the fire breaking out of the stone, never a groove cut in it).
    seams = [
        fire_seam(p, f, wander(rng, (0.2, -7.2, A['table'] + 0.2), (-0.3, 6.6, A['table'] + 0.2), 18, 0.35),
                  width=0.12, depth=0.3),
        fire_seam(p, f, wander(rng, (0.0, -1.5, A['table'] + 0.2), (2.4, 2.6, A['table'] + 0.1), 6, 0.2),
                  width=0.09, depth=0.18),
    ]
    for s in (-1, 1):
        # The crack running out over the capstone's edge and down its flank.
        seams.append(fire_seam(p, f, wander(rng, (s * (A['hw'] - 0.6), s * 2.0, A['table'] + 0.1),
                                            (s * (A['hw'] - 0.1), s * 2.6, 3.6), 5, 0.12), width=0.1, depth=0.2))
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.where(Z < 3.0, np.maximum(np.abs(X) - (A['hw'] + 0.45), np.abs(Y) - (A['hd'] + 0.45)), -1.0))
    _mesh(bpy, p, f, 'AltarStone', 5200)
    for on in seams:
        lay_seam_glow(p, f, on, 0.12)
    prng = p.rng
    # The crystal breaking out of its north end (the old anvil's horn, now
    # the stone's crown of fire), and a smaller cluster at its south.
    crystal_cluster(p, (0.2, -6.8, A['table'] - 0.6), 7, 4.4, 0.64, prng, spread=0.5, lean=(0.05, 0.2), hot=0.7)
    # And rising out of the ground under its north end, hugging the stone.
    crystal_cluster(p, (0.0, -7.6, 0.0), 5, 3.4, 0.55, prng, spread=0.5, lean=(0.0, 0.3), hot=0.5, reach=8.9)
    crystal_cluster(p, (-0.4, 6.8, A['table'] - 0.3), 4, 2.6, 0.48, prng, spread=0.32, lean=(-0.1, 0.22), hot=0.4)
    # Rubble at the foot.
    for _ in range(9):
        x = prng.uniform(-A['hw'] - 0.4, A['hw'] + 0.4)
        y = prng.choice([-1, 1]) * prng.uniform(A['hd'] - 0.2, A['hd'] + 0.4)
        s = prng.uniform(0.18, 0.36)
        with p.as_kind(RAW):
            crystal(p, (x, y, s * 0.2), (s * 1.4, s * 1.1, s * 0.4), p.vary(BASALT_DARK, 0.07), n=10, boxy=0.55,
                    jitter=0.2, yaw=prng.uniform(0, TAU), floor=0.0)
    return p


# ================================================================ the wellspring
WELL = dict(r=3.25, rim=2.35, fire=2.22)


def wellspring(bpy):
    """The pour's source (see the module doc): its touchable body inside r
    WELL['r'] (the collider's 3 and a hair) below 3 yd, its fire brimming at
    WELL['fire'], its lip split toward -Y (the Pour Channel)."""
    p = HP('Wellspring', seed=9301, ao=0.7, ao_dist=1.6, ash=0.8, seam_r=0.5)
    rng = np.random.default_rng(9301)
    W = WELL
    f = Sculpt((-3.6, -3.8, -0.4), (3.6, 3.6, 3.6), 0.07)
    n1 = Noise(9303)
    # The mound: a heaped ring of column stumps round a basin, higher at the
    # back, split open at the front.
    for (cx, cy) in _bundle_layout(rng, 3.4, 0.62):
        r = math.hypot(cx, cy)
        a = math.atan2(cy, cx)
        if r < 1.55:
            continue
        front = max(0.0, -math.sin(a))
        top = W['rim'] + 0.4 * max(0.0, math.sin(a)) - 1.1 * sstep(0.75, 0.98, front) + float(rng.uniform(-0.2, 0.25))
        top -= 0.5 * max(0.0, (r - 2.4)) * 1.4
        f.put(TONES[int(rng.integers(0, len(TONES)))],
              hex_column((cx, cy), 0.62, -0.4, max(0.35, top), phase=float(rng.uniform(0, 1)),
                         tilt=(math.cos(a) * 0.08, -math.sin(a) * 0.08),
                         top_tilt=(math.cos(a) * 0.25 + float(rng.uniform(-0.1, 0.1)),
                                   math.sin(a) * 0.25 + float(rng.uniform(-0.1, 0.1)))), 0.05)
    f.put('b3', Ellipsoid((0.0, 0.2, 0.6), (2.7, 2.7, 1.2)), 0.4)
    # The basin, hollowed to the brim.
    f.sub(Ellipsoid((0.0, 0.0, W['fire'] + 0.2), (1.65, 1.65, 0.75)), 0.25)
    # The split lip: a cleft through the front of the ring, the chute it
    # spills down to the floor.
    f.sub(Fn((-0.9, -3.8, 0.3), (0.9, -0.8, 3.6),
             lambda X, Y, Z: np.maximum(np.abs(X + 0.15 * np.sin(Y * 1.5)) - (0.55 + 0.12 * (-Y - 1.0)),
                                        np.maximum(Y + 0.9, (0.35 + 0.42 * np.clip(-Y - 1.0, 0.0, 3.0) * 0.0
                                                             + (W['fire'] - 0.15) * np.clip(1.0 - (-Y - 1.2) / 2.2,
                                                                                            0.0, 1.0)) - Z))),
          0.15)
    _basalt(f, 9301, amp=0.06, scale=0.7, band=0.25)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - W['r'] - np.maximum(0.0, Z - 3.0) * 0.1)
    seams = [fire_seam(p, f, wander(rng, (math.cos(a) * 1.7, math.sin(a) * 1.7, W['rim'] + 0.2),
                                    (math.cos(a) * 3.1, math.sin(a) * 3.1, 0.35), 6, 0.12), width=0.08, depth=0.16)
             for a in (0.4, 1.9, 2.8, 4.1, 5.6)]
    _mesh(bpy, p, f, 'Wellspring', 4200)
    for on in seams:
        lay_seam_glow(p, f, on, 0.09)
    prng = p.rng
    # The brim: a low dome of fire filling the basin to its lip, its heart
    # white-gold, gold to the rim, darker gold in its folds; a few plates of
    # cooled crust riding on it.
    faces = p.lathe((0.0, 0.0, 0.0), [(1.78, W['fire'] - 0.14), (1.5, W['fire']), (1.05, W['fire'] + 0.07),
                                      (0.55, W['fire'] + 0.13), (0.0001, W['fire'] + 0.16)], 20, FIRE_PALE, mat=GLOW)
    for fc in faces:
        c = fc.calc_center_median()
        r = math.hypot(c.x, c.y)
        fold = 0.5 + 0.5 * math.sin(math.atan2(c.y, c.x) * 5.0 + r * 3.0)
        col = mix(FIRE_CORE, FIRE_PALE, sstep(0.2, 1.4, r))
        col = mix(col, FIRE, sstep(1.2, 1.75, r) * 0.7 + fold * 0.15)
        for loop in fc.loops:
            loop[p.col] = (*col, 1.0)
    with p.as_kind(PAINT):
        for k in range(5):
            a = prng.uniform(0, TAU)
            r = prng.uniform(0.8, 1.35)
            s = prng.uniform(0.22, 0.36)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, W['fire'] + 0.08 - r * 0.04), (s * 1.4, s, 0.07),
                    p.vary(CINDER, 0.08), n=10, boxy=0.6, jitter=0.25, yaw=prng.uniform(0, TAU))
    # The tongue spilling through the split lip and down its chute: one
    # stream, broad and flat, narrowing as it falls to the floor.
    tongue = []
    for k in range(12):
        t = k / 11
        tongue.append(Vector((0.1 * math.sin(t * 4), -1.2 - t * 2.4,
                              W['fire'] - 0.05 - (W['fire'] - 0.14) * sstep(0.0, 1.0, t))))
    p.sweep(tongue, 0.62, 0.42, FIRE_PALE, sides=8, mat=GLOW, squash=0.22)
    # The crystal crowding its back half: a crown of fire leaning out.
    for (a, h, r) in ((math.pi / 2, 6.2, 0.6), (math.pi / 2 + 0.7, 4.6, 0.5), (math.pi / 2 - 0.75, 5.0, 0.52),
                      (math.pi / 2 + 1.35, 3.2, 0.42), (math.pi / 2 - 1.45, 3.4, 0.44), (math.pi / 2 + 0.3, 3.6, 0.4)):
        base = (math.cos(a) * 2.0, math.sin(a) * 2.0, W['rim'] - 0.2)
        d = (math.cos(a) * 0.32, math.sin(a) * 0.32, 1.0)
        crystal_cluster(p, base, 3, h, r, prng, spread=0.35, lean=(0.0, 0.0), hot=0.5, reach=W['r'],
                        up=d)
    _rubble(p, prng, 3.0, 3.4, 6, ashy=0.5)
    return p


# ============================================================== the fire crystals
def fire_crystals(bpy, variant):
    """A cluster of fire crystal on a bed of column stumps: A tall (about
    6.5), B broad (about 4.5); the touchable foot inside r 2.9."""
    seed = 9401 + ord(variant)
    p = HP('FireCrystal' + variant, seed=seed, ao=0.6, ao_dist=1.0, ash=1.0, seam_r=0.4)
    rng = np.random.default_rng(seed)
    f = Sculpt((-3.0, -3.0, -0.4), (3.0, 3.0, 2.0), 0.06)
    for (cx, cy) in _bundle_layout(rng, 2.7, 0.55):
        r = math.hypot(cx, cy)
        top = 1.2 - r * 0.38 + float(rng.uniform(-0.15, 0.3))
        if top < 0.2:
            continue
        a = math.atan2(cy, cx)
        f.put(TONES[int(rng.integers(0, len(TONES)))],
              hex_column((cx, cy), 0.55, -0.4, top, phase=float(rng.uniform(0, 1)),
                         top_tilt=(math.cos(a) * 0.3, math.sin(a) * 0.3)), 0.04)
    _basalt(f, seed, amp=0.04, scale=0.8, band=0.2)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - 2.85)
    _mesh(bpy, p, f, 'FireCrystal' + variant, 1800)
    prng = p.rng
    if variant == 'A':
        crystal_cluster(p, (0.0, 0.0, 0.6), 7, 6.2, 0.62, prng, spread=0.42, lean=(0.06, 0.04), hot=0.7, reach=2.85)
        crystal_cluster(p, (1.2, -0.8, 0.5), 3, 2.6, 0.38, prng, spread=0.5, hot=0.3, reach=2.85,
                        up=(0.4, -0.2, 1.0))
    else:
        crystal_cluster(p, (0.0, 0.2, 0.5), 9, 4.2, 0.55, prng, spread=0.62, lean=(0.0, 0.0), hot=0.6, reach=2.85)
        crystal_cluster(p, (-1.3, 0.6, 0.4), 3, 2.2, 0.34, prng, spread=0.5, hot=0.3, reach=2.85,
                        up=(-0.5, 0.3, 1.0))
    _rubble(p, prng, 2.4, 2.85, 6, ashy=0.6)
    return p


# ============================================================== the ember boulder
def ember_boulder(bpy):
    """A long boulder of basalt split open by a seam of fire (see the module
    doc): about 5.5 tall, its touchable body inside the box 4 by 6.5 and a
    body's width, the split along Y with crystal grown in it."""
    p = HP('EmberBoulder', seed=9501, ao=0.7, ao_dist=2.0, ash=1.1, seam_r=0.7)
    rng = np.random.default_rng(9501)
    f = Sculpt((-4.7, -7.2, -0.4), (4.7, 7.2, 6.2), 0.09)
    n1 = Noise(9503)
    # Two halves parted along the split, each its own heavy block, their
    # faces columnar where the rock cooled.
    for s in (-1, 1):
        f.put('b0' if s < 0 else 'b5', block(rng, (s * 1.9, 0.2 * s, 2.3), (3.4, 12.0, 4.6), cuts=26,
                                             chamfer=(0.66, 0.9), R=rot(ry=s * 0.09, rz=s * 0.05), top_tilt=0.35),
              0.5)
        f.put('b4' if s < 0 else 'b2', block(rng, (s * 2.2, -2.0 * s, 4.0), (2.6, 5.0, 2.4), cuts=16,
                                             chamfer=(0.66, 0.9), R=rot(ry=s * 0.2, rz=s * 0.3), top_tilt=0.4), 0.5)
        f.put('b3', block(rng, (s * 2.1, -s * 0.5, 0.7), (3.8, 12.8, 1.4), cuts=12, chamfer=(0.8, 0.95)), 0.4)
    f.sub(Fn((-1.0, -7.0, 0.4), (1.0, 7.0, 6.2),
             lambda X, Y, Z: np.abs(X - 0.3 * n1.fbm(Y * 0.15, Z * 0.15, 1.0, 2)) - (0.35 + 0.08 * Z)), 0.3)
    _columns(f, 9502, cell=1.5, depth=0.14, width=0.08, band=0.35, axis='y',
             amp_fn=lambda X, Y, Z: np.clip((1.6 - np.abs(X)) / 0.8, 0.0, 1.0))
    _basalt(f, 9504, amp=0.16, scale=0.22, band=0.45)
    _columns(f, 9505, cell=1.4, depth=0.1, width=0.07, band=0.3, axis='z',
             amp_fn=lambda X, Y, Z: np.clip((np.abs(X) - 2.6) / 0.8, 0.0, 1.0))
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.where(Z < 3.0, np.maximum(np.abs(X) - 4.45, np.abs(Y) - 6.95), -1.0))
    seams = [fire_seam(p, f, wander(rng, (0.0, -5.6, 0.5), (0.0, 5.4, 0.5), 14, 0.2), width=0.22, depth=0.2,
                       carve=False)]
    _mesh(bpy, p, f, 'EmberBoulder', 4200)
    prng = p.rng
    # The fire in the split's floor, crystal grown up out of it.
    for k in range(14):
        y = -5.6 + k * 0.85
        crystal(p, (0.1 * math.sin(k), y, 0.45), (0.5, 1.0, 0.16), p.vary(FIRE_PALE if k % 3 else FIRE, 0.05), n=10,
                boxy=0.6, jitter=0.15, mat=GLOW)
    for (y, h) in ((-3.6, 3.2), (-0.5, 4.4), (2.4, 3.6), (4.6, 2.4)):
        crystal_cluster(p, (0.0, y, 0.5), 4, h, 0.4, prng, spread=0.25, lean=(0.0, 0.0), hot=0.6, reach=4.4)
    for _ in range(8):
        x = prng.choice([-1, 1]) * prng.uniform(3.6, 4.4)
        y = prng.uniform(-6.0, 6.0)
        s = prng.uniform(0.2, 0.4)
        with p.as_kind(RAW):
            crystal(p, (x, y, s * 0.2), (s * 1.4, s * 1.1, s * 0.4), p.vary(BASALT_DARK, 0.07), n=10, boxy=0.55,
                    jitter=0.2, yaw=prng.uniform(0, TAU), floor=0.0)
    return p


# ============================================================== the forge's pillars
PILLAR = dict(r=3.1, top=14.5, root=-40.0)


def hearth_pillar(bpy):
    """A bundle of basalt columns rising out of the chasm (see the module
    doc): inside r PILLAR['r'] of its centre, its tallest head about
    PILLAR['top'] over the floor, its root at PILLAR['root']."""
    p = HP('HearthPillar', seed=9601, ao=0.7, ao_dist=3.0, ash=1.0, seam_r=0.6)
    rng = np.random.default_rng(9601)
    P = PILLAR
    f = Sculpt((-P['r'] - 0.6, -P['r'] - 0.6, P['root'] - 1), (P['r'] + 0.6, P['r'] + 0.6, P['top'] + 1.5), 0.14)
    cols = _bundle_layout(rng, P['r'], 0.85, jitter=0.12)
    order = sorted(range(len(cols)), key=lambda i: math.hypot(cols[i][0] + 0.6, cols[i][1] - 0.4))
    tall = order[0]
    for i, (cx, cy) in enumerate(cols):
        r = math.hypot(cx + 0.6, cy - 0.4)
        # Stepped heads: the crown's few near the top, the rest falling away
        # in terraces (the columns' broken heads).
        rank = order.index(i)
        top = P['top'] - (0.7 * rank if rank < 3 else 2.4 + 1.1 * (rank - 3)) - r * 0.6
        top = max(2.5, top + float(rng.uniform(-0.6, 0.6)))
        if i == tall:
            top = P['top']
        f.put(TONES[i % len(TONES)],
              hex_column((cx, cy), 0.85, P['root'] - 1, top, phase=float(rng.uniform(0, 1)),
                         tilt=(float(rng.uniform(-0.015, 0.015)), float(rng.uniform(-0.015, 0.015))),
                         top_tilt=(float(rng.uniform(-0.25, 0.25)), float(rng.uniform(-0.25, 0.25)))), 0.05)
    _basalt(f, 9603, amp=0.06, scale=0.3, band=0.3)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - P['r'])
    f.cut_below(P['root'])
    # A seam of fire down one joint, from the floor's height into the dark.
    cx, cy = cols[tall]
    seams = [fire_seam(p, f, wander(rng, (cx + 0.9, cy - 0.9, P['top'] - 4.0), (cx + 1.6, cy - 1.7, -14.0), 16, 0.12),
                       width=0.12, depth=0.25)]
    _mesh(bpy, p, f, 'HearthPillar', 4200)
    for on in seams:
        lay_seam_glow(p, f, on, 0.12)
    prng = p.rng
    # A crown of crystal on the tallest head, ash on the lower ones.
    # A cluster of crystal breaking out of a joint high on its side (a crown
    # on its head read as a torch): at the outermost column of the tallest
    # few, a body's height under its head.
    tallest = [cols[i] for i in order[:4]]
    ox, oy = max(tallest, key=lambda c: math.hypot(c[0], c[1]))
    rr = math.hypot(ox, oy) or 1.0
    dx, dy = ox / rr, oy / rr
    zc = P['top'] - 4.5
    crystal_cluster(p, (ox + dx * 0.55, oy + dy * 0.55, zc), 5, 2.6, 0.42, prng, spread=0.45,
                    up=(dx * 0.8, dy * 0.8, 0.9), hot=0.5)
    for (x, y) in cols:
        if (x, y) == cols[tall] or prng.random() < 0.5:
            continue
        z = _top_z(f, [(x, y)], below=-30.0)[0]
        if z is None:
            continue
        with p.as_kind(PAINT):
            crystal(p, (x, y, z + 0.05), (1.2, 1.0, 0.14), p.vary(ASH, 0.04), n=18, boxy=1.0, jitter=0.05,
                    yaw=prng.uniform(0, TAU))
    return p


# ================================================================ the bridge
BRIDGE = dict(run=18.0, half=7.0, span0=3.6, span1=14.4)


def heat_bridge(bpy):
    """The anvil bridge's natural arch (see the module doc): along +X from
    its east end, the deck at z 0, nothing over the deck within its walk,
    its eye between BRIDGE['span0'] and BRIDGE['span1']."""
    def glaze(q, n):
        # The chasm's fire has baked its soffit and the eye's sides warm.
        inside = sstep(BRIDGE['span0'] - 1.0, BRIDGE['span0'] + 1.0, q.x) * (
            1 - sstep(BRIDGE['span1'] - 1.0, BRIDGE['span1'] + 1.0, q.x))
        return inside * (0.4 + 0.6 * max(0.0, -n.z)) * sstep(-2.0, -10.0, q.z)

    p = HP('HeatBridge', seed=9701, ao=0.65, ao_dist=4.0, ash=0.6, seam_r=0.7, glaze_fn=glaze)
    rng = np.random.default_rng(9701)
    B = BRIDGE
    L = B['run']
    lo = (-6.0, -B['half'] - 4.0, -46.0)
    hi = (L + 6.0, B['half'] + 4.0, 1.0)
    f = Sculpt(lo, hi, 0.24)
    nf = Noise(9703)
    X, Y, Z = _axes(f)
    a0, a1 = B['span0'], B['span1']
    mid = (a0 + a1) / 2
    half = (a1 - a0) / 2
    u = np.clip((X - mid) / half, -1.0, 1.0)
    crown = -3.2
    intrados = -46.0 + (crown + 46.0) * np.power(np.maximum(0.0, 1.0 - np.abs(u) ** 1.7), 0.5)
    intrados = intrados - 1.4 * nf.fbm(X * 0.12, Y * 0.12, 3.0, 2)
    inside_span = (X > a0) & (X < a1)
    depth_under = -Z
    # The rib flares as it falls (heavy at the foot), ragged at its flanks.
    width = (B['half'] + 0.5 + np.clip(depth_under - 2.0, 0.0, None) * 0.09
             + 0.8 * nf.fbm(X * 0.07, Z * 0.06, 0.0, 2))
    side = np.abs(Y) - width
    top = Z - (-0.3)
    bottom = np.where(inside_span, intrados - Z, -46.0 - Z)
    ends = np.maximum(-X - 5.0, X - (L + 5.0))
    body = np.maximum(np.maximum(side * 0.8, top), np.maximum(bottom, ends))
    f.d = np.minimum(f.d, body.astype(np.float32))
    for k in range(9):
        x = -4.0 + k * (L + 8.0) / 8.0
        f.parts.append((TONES[k % len(TONES)], RoundBox((x, 0.0, -22.0), (1.6, 16.0, 26.0), 0.2)))
    _columns(f, 9702, cell=1.9, depth=0.2, width=0.1, band=0.45, axis='z')
    _basalt(f, 9704, amp=0.12, scale=0.18, band=0.4)
    X, Y, Z = _axes(f)
    _clamp(f, np.where(np.abs(Y) < B['half'] + 0.05, Z - (-0.3), -50.0))
    f.cut_below(-46.0)
    # Seams of fire down its flanks, glazed by the chasm's light.
    seams = []
    for s in (-1, 1):
        for x in (1.5, 16.0):
            seams.append(fire_seam(p, f, wander(rng, (x, s * (B['half'] + 0.6), -1.2),
                                                (x + float(rng.uniform(-1, 1)), s * (B['half'] + 1.6), -22.0), 12, 0.3),
                                   width=0.14, depth=0.22))
    _mesh(bpy, p, f, 'HeatBridge', 7000)
    for on in seams:
        lay_seam_glow(p, f, on, 0.14)
    return p


# ================================================================== the walls
def heat_wall(variant):
    """A 6 yd module of a Heat walk's low wall over the void (an edge piece:
    the walk toward +Y, the drop toward -Y): a rank of basalt columns
    standing on the cliff's face, their bodies running down it two lifts
    deep, their heads a knee high over the walk (about 1.0), each its own
    height, ash on them, a seam of fire in a joint here and there. B: one
    column broken off low."""
    p = HP('HeatWall' + variant, seed=9801 + ord(variant), ao=0.55, ao_dist=0.9, ash=1.0)
    rng = p.rng
    half = 3.0
    x = -half + 0.3
    k = 0
    tops = []
    while x < half - 0.25:
        r = rng.uniform(0.4, 0.42)
        h = rng.uniform(0.86, 1.02)
        if variant == 'B' and k == 3:
            h = 0.3
        yy = -0.54 + rng.uniform(-0.02, 0.0)
        with p.as_kind(RAW):
            p.prism((x + rng.uniform(-0.03, 0.03), yy, -3.3 - rng.uniform(0.0, 0.4)), 6, r * 1.03, r,
                    h + 3.3, p.vary(BASALT if rng.random() < 0.5 else BASALT_WARM, 0.07),
                    phase=rng.uniform(0, 1), lean=(rng.uniform(-0.02, 0.02), rng.uniform(-0.02, 0.0)))
        with p.as_kind(PAINT):
            crystal(p, (x, yy, h + 0.02), (r * 1.6, r * 1.5, 0.08), p.vary(ASH, 0.04), n=16, boxy=1.0, jitter=0.05)
        tops.append((x, h, r))
        x += r * 1.72 + rng.uniform(0.0, 0.06)
        k += 1
    # Centre the rank in its module (the planner stretches modules end to
    # end: a gap left at one end would show at every join).
    xs = [v.co.x for v in p.bm.verts]
    shift = -(min(xs) + max(xs)) / 2
    for v in p.bm.verts:
        v.co.x += shift
    tops = [(t[0] + shift, t[1], t[2]) for t in tops]
    if variant == 'B':
        with p.as_kind(PAINT):
            crystal(p, (tops[3][0], -0.5, 0.36), (0.9, 0.7, 0.16), p.vary(ASH, 0.04), n=18, boxy=1.0, jitter=0.06)
    # A seam of fire burning in a joint down the face.
    if variant == 'A':
        j = len(tops) // 2
        xj = (tops[j][0] + tops[j - 1][0]) / 2
        for i in range(7):
            z = -0.15 - i * 0.42
            crystal(p, (xj + 0.03 * math.sin(i * 2.1), -0.93, z), (0.07, 0.05, 0.46), p.vary(FIRE_DEEP, 0.05), n=10,
                    boxy=0.5, jitter=0.12, mat=GLOW)
    return p


# ================================================================ the Pour Channel
def pour_channel():
    """A 6 yd module of the Pour Channel (flat: its bed under 0.05, its lips
    under 0.25), along X, its middle on the channel's axis: the groove the
    fire has worn, 5 yd across, its bed one dark glassy skin of the cooled
    pour (a few cracks in it, the last pour's residue glowing faint down its
    middle), its two lips the worn heads of the floor's columns, rounded by
    the fire, a hand proud of the floor, broken here and there."""
    p = HP('PourChannel', seed=9901, ao=0.0, ash=0.0, soot=0.0)
    rng = p.rng
    half = 3.0
    with p.as_kind(PAINT):
        # The bed: one long skin, dark and glassy, a breath of warmer glaze
        # toward its middle where the fire runs deepest.
        crystal(p, (0.0, 0.0, 0.012), (2 * half + 0.1, 4.8, 0.024), (0.15, 0.135, 0.125), n=18, boxy=0.08,
                jitter=0.03)
        crystal(p, (0.0, 0.0, 0.02), (2 * half + 0.1, 2.2, 0.02), (0.2, 0.15, 0.11), n=16, boxy=0.12, jitter=0.04)
        # Its cracks: short wandering lines of scorch across the skin.
        for k in range(6):
            x0 = rng.uniform(-half + 0.3, half - 0.3)
            y0 = rng.uniform(-2.0, 2.0)
            a0 = rng.uniform(0, TAU)
            for j in range(4):
                x1 = x0 + math.cos(a0) * 0.42
                y1 = y0 + math.sin(a0) * 0.42
                if abs(y1) > 2.2 or abs(x1) > half:
                    break
                crystal(p, ((x0 + x1) / 2, (y0 + y1) / 2, 0.028), (0.44, 0.05, 0.008), SCORCH, n=8, boxy=0.4,
                        jitter=0.1, yaw=a0)
                x0, y0 = x1, y1
                a0 += rng.uniform(-0.5, 0.5)
    # The residue burning faint down its middle (one unbroken thread).
    crystal(p, (0.0, 0.03 * math.sin(rng.uniform(0, 6)), 0.032), (2 * half + 0.05, 0.1, 0.01), FIRE_DIM, n=12,
            boxy=0.3, jitter=0.05, mat=GLOW)
    # The lips: long worn rolls of the floor's basalt along both edges, a
    # hand proud, broken into lengths, each its own tone.
    for s in (-1, 1):
        x = -half
        while x < half - 0.05:
            length = min(half - x, rng.uniform(1.1, 2.1))
            with p.as_kind(RAW):
                crystal(p, (x + length / 2, s * (2.62 + rng.uniform(-0.04, 0.04)), 0.07),
                        (length - 0.12, 0.62, 0.2 + rng.uniform(0.0, 0.05)),
                        p.vary(BASALT_WARM if rng.random() < 0.5 else BASALT, 0.06), n=16, boxy=0.45,
                        jitter=0.08)
            x += length
    for v in p.bm.verts:
        v.co.z = min(v.co.z, 0.24)
    return p


def pour_spill(bpy):
    """The channel's mouth at the casting floor's south lip (render only:
    nothing toward +Y past 0.05 over the walk): two cheek stones past the
    lip either side of the notch, the spout's glazed lip, and the fire's
    glaze run down the cliff in a broad tongue."""
    def glaze(q, n):
        # The tongue: the pours' glaze, warm and glossy where they ran.
        return sstep(2.6, 1.6, abs(q.x)) * sstep(0.2, -0.3, q.y) * (0.45 + 0.35 * sstep(0.5, 0.8, _fbm(
            q.x * 1.4, q.z * 0.12, 0.0)))

    p = HP('PourSpill', seed=9951, ao=0.6, ao_dist=1.2, ash=0.4, seam_r=0.6, glaze_fn=glaze)
    rng = np.random.default_rng(9951)
    f = Sculpt((-5.0, -3.0, -24.0), (5.0, 0.4, 2.6), 0.09)
    n1 = Noise(9953)
    for s in (-1, 1):
        f.put('b3' if s < 0 else 'b0', block(rng, (s * 3.4, -1.4, -3.0), (2.6, 2.4, 7.6), cuts=14,
                                             chamfer=(0.72, 0.92), R=rot(rz=s * 0.1), top_tilt=0.3), 0.4)
        f.put(TONES[s + 1], hex_column((s * 3.6, -1.0), 0.9, -6.0, 1.6 + float(rng.uniform(0, 0.6)),
                                       phase=float(rng.uniform(0, 1)), top_tilt=(s * 0.2, -0.2)), 0.1)
    # The glaze tongue down the cliff: a broad lobe of cooled fire-rock
    # hugging the face, fluted by the runs.
    f.put('b3', Fn((-2.8, -2.0, -24.0), (2.8, 0.2, 0.4),
                      lambda X, Y, Z: np.maximum(np.abs(X) - (2.2 - np.clip(-Z, 0.0, 24.0) * 0.045
                                                              + 0.3 * n1.fbm(Z * 0.2, 1.0, 2.0, 2)),
                                                 np.maximum(-Y - (0.8 + 0.4 * n1.fbm(X * 0.6, Z * 0.1, 0.0, 2)),
                                                            np.maximum(Y + 0.05, Z - 0.0)))), 0.3)
    _columns(f, 9952, cell=1.2, depth=0.1, width=0.06, band=0.3, axis='y',
             amp_fn=lambda X, Y, Z: np.clip((np.abs(X) - 2.4) / 0.6, 0.0, 1.0))
    X, Y, Z = _axes(f)
    _clamp(f, np.where(Z > 0.04, Y + 0.06, -1.0))
    f.cut_below(-24.0)
    _mesh(bpy, p, f, 'PourSpill', 3000)
    prng = p.rng
    # The last pour's glaze still glowing in the tongue's runs, faint.
    for k in range(5):
        x = -1.6 + k * 0.8 + prng.uniform(-0.15, 0.15)
        pts = [(x + 0.1 * math.sin(z * 0.4), -0.55 - 0.3 * prng.random(), z) for z in np.linspace(-0.3, -18.0, 12)]
        on = _on_surface(f, pts, lift=-0.04)
        for q0, q1 in zip(on, on[1:]):
            a = Vector(q0)
            b = Vector(q1)
            seg = b - a
            crystal(p, tuple((a + b) / 2), (0.1, 0.1, seg.length * 1.05), p.vary(FIRE_DEEP, 0.06), n=10, boxy=0.4,
                    jitter=0.1, yaw=math.atan2(seg.x, -seg.y), pitch=math.atan2(math.hypot(seg.x, seg.y), seg.z),
                    mat=GLOW)
    return p


# ================================================================== the inlays
def fire_crack(variant):
    """A seam of fire in the floor (flat: under 0.05, so every telegraph
    draws over it): A a long seam and its branches (about 12 yd), B a star
    of seams; scorched and baked stone round them, the fire deep and dim,
    never a telegraph's value."""
    p = HP('FireCrack' + variant, seed=9971 + ord(variant), ao=0.0, ash=0.0, soot=0.0)
    rng = p.rng

    def seg(x, y, nx, ny, w):
        ang = math.atan2(ny - y, nx - x)
        length = math.hypot(nx - x, ny - y)
        with p.as_kind(PAINT):
            p.box(((x + nx) / 2, (y + ny) / 2, 0.006), (length * 1.12, w * 3.6, 0.01), p.vary((0.16, 0.135, 0.12), 0.05),
                  yaw=ang)
            p.box(((x + nx) / 2, (y + ny) / 2, 0.012), (length * 1.08, max(0.05, w * 1.8), 0.012),
                  p.vary(SCORCH, 0.05), yaw=ang)
        p.box(((x + nx) / 2, (y + ny) / 2, 0.02), (length, max(0.025, w * 0.5), 0.012),
              p.vary(FIRE_PALE if w > 0.09 else FIRE, 0.04), yaw=ang, mat=GLOW)

    def run(x, y, ang, length, w, depth=0):
        step = 0.5
        n = max(2, int(length / step))
        for i in range(n):
            ang += rng.uniform(-0.16, 0.16) + (rng.choice([-1, 1]) * rng.uniform(0.3, 0.6) if rng.random() < 0.1 else 0)
            nx, ny = x + math.cos(ang) * step, y + math.sin(ang) * step
            ww = w * (1 - i / n * 0.7)
            seg(x, y, nx, ny, ww)
            if depth < 1 and rng.random() < 0.1:
                run(nx, ny, ang + rng.choice([-1, 1]) * rng.uniform(0.6, 1.1), length * rng.uniform(0.2, 0.4),
                    ww * 0.6, depth + 1)
            x, y = nx, ny

    if variant == 'A':
        run(-6.0, 0.0, 0.0, 12.0, 0.14)
    else:
        # An uneven fork: one long seam, two shorter breaking off it at odd
        # angles, a fourth stub (never a symmetric star).
        a0 = rng.uniform(0, TAU)
        run(-2.5 * math.cos(a0), -2.5 * math.sin(a0), a0, 6.5, 0.13, depth=1)
        run(0.0, 0.0, a0 + 1.9 + rng.uniform(-0.3, 0.3), 3.6, 0.11, depth=1)
        run(0.6 * math.cos(a0), 0.6 * math.sin(a0), a0 - 1.3 + rng.uniform(-0.3, 0.3), 2.4, 0.09, depth=1)
    xs = [v.co.x for v in p.bm.verts]
    ys = [v.co.y for v in p.bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    if variant == 'A':
        for v in p.bm.verts:
            v.co.x -= cx
            v.co.y -= cy
    return p


def ash_drift(bpy, variant):
    """Low drifts of ash and cinder (under a hand: nothing past 0.3 over the
    floor): A a long drift along a wall's foot, B a round one."""
    p = HP('AshDrift' + variant, seed=9991 + ord(variant), ao=0.0, ash=0.0, soot=0.0)
    rng = np.random.default_rng(9991 + ord(variant))
    f = Sculpt((-4.6, -2.2, -0.4), (4.6, 2.2, 0.6), 0.06)
    if variant == 'A':
        for k in range(6):
            x = -3.2 + k * 1.3 + float(rng.uniform(-0.2, 0.2))
            r = 1.0 - abs(x) / 4.6
            f.put('ash', Ellipsoid((x, float(rng.uniform(-0.15, 0.15)), -0.05), (1.6, 0.95 + 0.4 * r, 0.1 + 0.14 * r)),
                  0.8)
    else:
        for k in range(4):
            a = TAU * k / 4 + float(rng.uniform(-0.3, 0.3))
            f.put('ash', Ellipsoid((math.cos(a) * 0.45, math.sin(a) * 0.4, -0.04), (1.3, 1.1, 0.3)), 0.5)
    n = Noise(9991 + ord(variant))
    f.displace(lambda X, Y, Z: 0.03 * n.fbm(X * 0.8, Y * 0.8, Z, 2), band=0.15)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, Z - 0.27)
    made = _mesh(bpy, p, f, 'AshDrift' + variant, 320 if variant == 'A' else 220)
    # Cinder speckled in the ash, in broad patches (never a noise).
    for fc in made:
        c = fc.calc_center_median()
        k = sstep(0.55, 0.75, _fbm(c.x * 0.5 + 3.0, c.y * 0.5, 0.0))
        col = mix((0.44, 0.41, 0.38), CINDER, k * 0.6)
        col = mix(col, (0.3, 0.27, 0.25), sstep(0.0, 0.12, -c.z + 0.12) * 0.5)
        for loop in fc.loops:
            loop[p.col] = (*col, 1.0)
    for v in p.bm.verts:
        v.co.z = max(0.0, min(v.co.z, 0.28))
    return p
