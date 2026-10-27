"""The Smith's Heart's Breath kit (phase 2G, build_smith_heart_breath_kit.py):
the north vein that climbs out of the mountain into the storm, up to the
Storm Cornice where the Guardian of the Breath waits.

Primal and divine (E:/woc/entregas/raid_corazon/DECISIONES_DISENO.md): the
Breath is the mountain's own wind, not a machine, so nothing here is metal.
The stone is Stormcrag's granite scoured pale by the gale (cool pale greys,
a cold blue-grey in the hollows, never the quarry's warm dust, a grey-green
lichen in the lee); the light is the vein's teal-white, in crystal only, a
value under a telegraph's. Every piece is a few big masses (the style
guide's S5), bent in one slow arc (H2), its small work clustered where the
eye goes (R2): the Smith's carved bands, the wind's bores, the crowns.

  - Kit_StormRod: a lightning rod of living stone (the layout's
    `sh_lightning_rod`, collider r 1.3, about 24 tall): five great drums of
    granite stacked and turned, the stack leaning in one arc, the wind's
    bores through two of them, the Smith's carved collar with its chevrons,
    a forked crown of two horns cradling a cluster of the vein's crystal
    (where the lightning strikes), the strikes' fused glass running down
    from it in dark branching veins.
  - Kit_WindHorn: a great horn of carved stone lying on the summit (the
    layout's `sh_broken_bellows` box, 8.8 by 15 by 7): its bell open to the
    rim with a rolled lip, its body ringed with carved bands and twisted by
    three flutes, curling at its end into a coil; the vein's light deep in
    its throat. The wind sounds it (the Breath's voice, never a bellows).
  - Kit_WindShelter: a windbreak on the bridge (the layout's
    `sh_wind_shelter` box, 4.8 by 1.4 by 2): a thick leaning slab on a
    footing course, scalloped by the gale on its windward face, the Smith's
    chevron cut in its lee.
  - Kit_WindBridge: the natural rock arch the Wind Bridge's ramp rides
    (WIND_BRIDGE, 16 up to 40 over 51 yd): a rib of scoured granite under
    the deck, a great wind-eye open under its middle, its legs plunging
    into the mist, beds and spalls along its flanks.
  - Kit_BreathWallA, B: the low walls along every Breath walk over the void
    (an edge module, 6 yd at stretch 1): rough-hewn storm granite a body's
    knee high under rounded copings, its face down the cliff two lifts deep.
    B: a coping blown off, its bed showing.
  - Kit_ChannelJamb: a cheek stone flanking a wind channel's mouth (the
    notches in the Cornice's rim): a tall leaning blade fluted by the
    updraft, bored near its head, a crystal shard in its crown.
  - Kit_StormStone: a wind-carved standing stone for the landings' rims,
    twisted, scalloped and holed, the vein's crystal in its bore.
  - Kit_PlateauCrackA, B: the cracked plateau's fissures (flat inlays), the
    vein's light faint in the widest.
  - Kit_StrikeScar: lightning's scar at a rod's foot (a flat inlay): a star
    of fused dark glass with the vein's light in its veins.
  - Kit_WindGroove: one of the channels the Smith cut in the Cornice's floor
    to lead the updraft from a notch toward the horns (a flat inlay): a
    polished dark bed between two worn lips.

Frames (yards, +Z up, the game's +Z is Blender -Y):
  - props (Kit_StormRod, Kit_WindHorn, Kit_WindShelter, Kit_ChannelJamb,
    Kit_StormStone) and inlays: the foot's centre; the horn's bell toward
    -Y (the layout's local +Z), the shelter's windward face toward -Y;
  - Kit_BreathWall*: the edge planner's frame (along X, origin on the lip at
    the walk's height, the drop toward -Y, nothing over the walk (y > 0.05)
    above the walk's height);
  - Kit_WindBridge: origin on the ramp's centre line at its start (the deck
    at z 0), the ramp along +X for BRIDGE_RUN yd rising BRIDGE_RISE; nothing
    of it stands over the deck (z <= deck - 0.3 within the walk).
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
from mathutils import Vector

import gravewyrm_sculpt as gs
from gravewyrm_sculpt import Sculpt, block
from gwkit import add_sculpt, crystal, mix, slab, sstep
from hckit import STONE, _fbm
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, RoundBox, Torus, rot
from ring_sculpt import facet_crystal
from shkit import DRESSED, GLOW, PAINT, RAW, TAU, SPiece

# ---- the storm's stone (sRGB) ---------------------------------------------------------
# Scoured pale: a value over the Ring's granite, cooler; the hollows a cold
# blue-grey (never black, L6), a grey-green lichen in the lee.
STORM = (0.5, 0.505, 0.515)
STORM_COOL = (0.43, 0.45, 0.48)
STORM_PALE = (0.6, 0.6, 0.6)
STORM_WARM = (0.53, 0.515, 0.5)
STORM_DARK = (0.31, 0.33, 0.37)
STORM_DEEP = (0.2, 0.22, 0.26)
LICHEN = (0.5, 0.56, 0.46)
LICHEN_PALE = (0.66, 0.68, 0.6)
GRIME = (0.22, 0.24, 0.28)
FULGURITE = (0.15, 0.16, 0.2)
# The vein's teal-white light (BREATH 0x5ab8e8), in crystal only, a value
# under a telegraph's: the deep crystal, its brighter heart.
BREATH_GLOW = (0.34, 0.66, 0.82)
BREATH_CORE = (0.62, 0.86, 0.95)

STORM_COLOURS = {
    'g0': STORM, 'g1': STORM_COOL, 'g2': STORM_PALE, 'g3': STORM_DARK, 'g4': (0.46, 0.47, 0.49),
    'g5': STORM_WARM, 'dressed': (0.6, 0.6, 0.6), 'fulg': FULGURITE, 'deep': STORM_DEEP,
}
STORM_KINDS = {k: RAW for k in STORM_COLOURS}
STORM_KINDS['dressed'] = DRESSED
STORM_KINDS['fulg'] = PAINT
STORM_KINDS['deep'] = PAINT
TONES = ('g0', 'g1', 'g4', 'g5', 'g2', 'g1')

# ---- the Wind Bridge's measures (smith_heart_layout.ts WIND_BRIDGE) --------------------
BRIDGE_RUN = math.hypot(-101.0 - -67.0, 159.0 - 121.0)
BRIDGE_RISE = 24.0
BRIDGE_HALF = 6.5

SHARP = math.radians(30)


# ---- the weather -------------------------------------------------------------------------
class BreathPiece(SPiece):
    """SPiece with the storm's own weather on its RAW and DRESSED faces: the
    big value groups first (pale scoured crests, mid faces, cold blue-grey
    joints, never black), rain streaks under every ledge, a grey-green
    lichen and its pale rosettes only on the tops, no dust; crisp where the
    rock breaks, soft over a swell."""

    def __init__(self, name, seed=0, lichen=1.0, **kw):
        kw.setdefault('ao', 0.75)
        kw.setdefault('dust', 0.0)
        super().__init__(name, seed=seed, **kw)
        self.lichen = lichen

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
        overhang = []
        for f in bm.faces:
            if f.normal.z < -0.35 and f.calc_area() > 0.03:
                c = f.calc_center_median()
                overhang.append((c.x, c.y, c.z))
        oh = np.array(overhang) if overhang else np.zeros((0, 3))
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
                if kind in (RAW, DRESSED):
                    height = p.z - floor
                    up = max(0.0, n.z)
                    fine = kind == DRESSED
                    tone = (0.9 if fine else 0.86) + (0.16 if fine else 0.26) * _fbm(
                        p.x * 0.18 + 3.0, p.y * 0.18, p.z * 0.14)
                    bed = 1.0 if fine else 0.96 + 0.06 * math.sin(
                        p.z * 1.7 + _fbm(p.x * 0.1, p.y * 0.1, p.z * 0.1) * 5.0)
                    foot = 0.82 + 0.18 * min(1.0, height / max(1.2, span * 0.25))
                    under = 0.84 if n.z < -0.3 else 1.0
                    # The gale's polish: the crests chipped pale, the joints
                    # and hollows sunk to a cold blue-grey (the value range
                    # carried by the form, never a speckle).
                    wear = 1.0 + 0.42 * max(0.0, c) - (0.6 if fine else 0.5) * max(0.0, -c)
                    k = tone * bed * foot * under * wear
                    col = tuple(ch * k for ch in col)
                    col = mix(col, STORM_COOL, max(0.0, -c) * 0.35)
                    if len(oh) and abs(n.z) < 0.6:
                        dx = oh[:, 0] - p.x
                        dy = oh[:, 1] - p.y
                        dz = oh[:, 2] - p.z
                        near = (np.abs(dx) < 0.9) & (np.abs(dy) < 1.2) & (dz > 0.15) & (dz < 5.0)
                        if near.any():
                            fade = 1.0 - float(dz[near].min()) / 5.0
                            run = 0.5 + 0.5 * _fbm(p.x * 2.2 + 9.0, p.y * 2.2, 0.0)
                            col = mix(col, GRIME, min(0.38, 0.38 * fade * run))
                    # Lichen in drifts on the tops (grey-green, its pale
                    # rosettes), never a coat over the stone (M6).
                    patch = _fbm(p.x * 0.7 + 11.0, p.y * 0.7 - 5.0, p.z * 0.7)
                    lich = sstep(0.45, 0.85, n.z) * sstep(0.56, 0.74, patch) * self.lichen
                    col = mix(col, LICHEN, min(0.5, lich * 0.6))
                    ros = sstep(0.3, 0.7, up) * sstep(0.8, 0.88, _fbm(p.x * 3.1, p.y * 3.1, p.z * 3.1))
                    col = mix(col, LICHEN_PALE, min(0.45, ros * 0.6 * self.lichen))
                elif kind == PAINT:
                    k = 0.9 + 0.18 * _fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6)
                    col = tuple(ch * k for ch in col)
                if occ is not None:
                    o = occ[loop.vert.index] * self.ao
                    col = tuple(ch * (1 - 0.68 * o) for ch in col)
                # Never black (L6): the deepest joint keeps a cold grey.
                col = tuple(max(lo, ch) for ch, lo in zip(col, (0.11, 0.12, 0.14)))
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


def BP(name, **kw):
    return BreathPiece('Kit_' + name, **kw)


# ---- sculpt helpers --------------------------------------------------------------------
def _mesh(bpy, p, f, name, target, smooth=True):
    verts, faces = gs.mesh_sculpt(f, bpy, name, target)
    add_sculpt(p, f, verts, faces, STORM_COLOURS, STORM_KINDS, smooth=smooth)


def _axes(f):
    return f.axes[0][:, None, None], f.axes[1][None, :, None], f.axes[2][None, None, :]


def _clamp(f, d):
    """Intersect the field with a region (d < 0 inside)."""
    f.d = np.maximum(f.d, (d + np.zeros_like(f.d)).astype(np.float32))


def _scour(f, seed, amp=0.1, scale=0.6, band=0.45, along=(1.0, 0.0, 0.0), flutes=0.45):
    """The gale's polish: a broad swell, and shallow flutes running along
    `along` (the wind's line over the piece)."""
    n1 = Noise(seed)
    ax, ay, az = along

    def fn(X, Y, Z):
        s = X * ax + Y * ay + Z * az
        cross = (Y * ax - X * ay) + Z * 0.7 * (1 - abs(az)) + X * 0.7 * abs(az)
        return (amp * n1.fbm(X * scale, Y * scale, Z * scale, 2)
                + amp * flutes * np.sin(cross * 3.1 + n1.fbm(s * 0.15, cross * 0.4, 0.0, 2) * 3.0))
    f.displace(fn, band=band)


def _on_surface(f, pts, lift=0.0):
    """Points moved onto the sculpt's surface (plus `lift` out of it)."""
    return [tuple(q) for q in f.snap(np.array(pts, dtype=np.float64), lift=lift, steps=8)]


def _carve(f, pts, depth, width):
    """A groove cut along a line laid on the surface."""
    f.groove(Polyline(_on_surface(f, pts), 0.02), depth, width)


def _vein(f, pts, r0, r1, label='fulg', lift=0.02):
    """A raised vein (fused glass, a rib) laid on the surface."""
    on = _on_surface(f, pts, lift)
    radii = [r0 + (r1 - r0) * i / max(1, len(on) - 1) for i in range(len(on))]
    f.put(label, Polyline(on, radii), 0.04)


def _rubble(p, rng, r0, r1, count, size=(0.18, 0.42), tone=STORM_DARK):
    """Stones lying round a foot (flat, a body walks over them)."""
    with p.as_kind(RAW):
        for _ in range(count):
            a = rng.uniform(0, TAU)
            r = rng.uniform(r0, r1)
            s = rng.uniform(*size)
            crystal(p, (math.cos(a) * r, math.sin(a) * r, s * 0.22), (s * 1.4, s * 1.1, s * 0.45),
                    p.vary(tone, 0.07), n=10, boxy=0.55, jitter=0.2, yaw=rng.uniform(0, TAU), floor=0.0)


# ===================================================================== the rod
ROD_DRUMS = ((4.6, 3.3), (4.3, 2.9), (4.0, 2.5), (3.6, 2.15), (3.2, 1.85))


def _rod_spine(z):
    """The rod's lean: one slow arc, out to about 1.3 yd at its crown."""
    t = max(0.0, z) / 20.0
    return 0.9 * t * t, -0.75 * t * t


def storm_rod(bpy):
    """The lightning rod (see the module doc): about 24 tall, its touchable
    foot inside r 1.75 (the collider's 1.3 and a body's width)."""
    p = BP('StormRod', seed=5101, ao=0.7, ao_dist=2.0)
    rng = np.random.default_rng(5101)
    f = Sculpt((-3.0, -3.0, -0.6), (3.4, 3.0, 25.2), 0.085)
    z = 0.0
    joints = []
    mids = []
    for k, (h, w) in enumerate(ROD_DRUMS):
        cx, cy = _rod_spine(z + h / 2)
        f.put(TONES[k % len(TONES)], block(rng, (cx, cy, z + h / 2), (w, w * 0.88, h * 1.04), cuts=14,
                                           chamfer=(0.8, 0.95),
                                           R=rot(rz=0.34 * k + 0.2, rx=float(rng.uniform(-0.03, 0.03)),
                                                 ry=float(rng.uniform(-0.03, 0.03)))), 0.22)
        mids.append((cx, cy, z + h / 2, w))
        z += h * 0.9
        joints.append((z, w))
    crown_z = z + 0.2
    tx, ty = _rod_spine(crown_z)
    # The foot: fused boulders heaped round it.
    for j in range(5):
        a = TAU * j / 5 + float(rng.uniform(-0.3, 0.3))
        s = float(rng.uniform(0.75, 1.05))
        f.put('g3' if j % 2 else 'g4', block(rng, (math.cos(a) * 1.1, math.sin(a) * 1.1, s * 0.38),
                                             (s * 1.3, s, s * 0.85), cuts=9, chamfer=(0.76, 0.93), R=rot(rz=a)), 0.3)
    # The crown: two horns of stone forking out of the top drum, a cradle
    # cut between them for the crystal.
    for s in (-1, 1):
        pts = [(tx + s * 0.5, ty, crown_z - 1.3), (tx + s * 1.0, ty + 0.1, crown_z + 1.1),
               (tx + s * 1.35, ty + 0.15, crown_z + 3.0), (tx + s * 1.12, ty + 0.05, crown_z + 4.6)]
        f.put('g2', Polyline(pts, [0.95, 0.72, 0.48, 0.2]), 0.35)
    f.sub(Ellipsoid((tx, ty, crown_z + 0.15), (0.75, 0.65, 0.55)), 0.15)
    # The wind's bores: through the second drum and the fourth.
    for k, (rz, r) in ((1, (0.6, (0.26, 2.2, 0.85))), (3, (-0.5, (0.2, 1.8, 0.6)))):
        cx, cy, cz, _ = mids[k]
        f.sub(Ellipsoid((cx, cy, cz + 0.2), r, rot(rz=rz, ry=0.5)), 0.12)
    # The joints read as stacked stones: a shallow groove round each.
    for zj, w in joints[:-1]:
        cx, cy = _rod_spine(zj)
        ring = [(cx + math.cos(a) * w * 0.62, cy + math.sin(a) * w * 0.55, zj) for a in np.linspace(0, TAU, 33)]
        _carve(f, ring, 0.14, 0.09)
    # The Smith's collar on the third drum: a raised band, chevrons cut in it.
    cx, cy, cz, w = mids[2]
    f.put('dressed', RoundBox((cx, cy, cz + 0.6), (w * 0.55, w * 0.5, 0.36), 0.3, rot(rz=0.34 * 2 + 0.2)), 0.2)
    zig = []
    for i in range(41):
        a = TAU * i / 40
        zig.append((cx + math.cos(a) * w * 0.7, cy + math.sin(a) * w * 0.62, cz + 0.6 + (0.2 if i % 2 else -0.2)))
    _carve(f, zig, 0.07, 0.05)
    _scour(f, 5101, amp=0.09, scale=0.55, band=0.35, along=(0.0, 0.0, 1.0), flutes=0.35)
    # Fulgurite: the strikes' fused glass running down from the crown in
    # branching veins, scorching the horns' tips.
    for j in range(3):
        a = TAU * j / 3 + float(rng.uniform(-0.4, 0.4))
        pts = []
        zc = crown_z - 0.6
        while zc > 8.0 - j * 0.8:
            sx, sy = _rod_spine(zc)
            rr = 2.4
            pts.append((sx + math.cos(a) * rr, sy + math.sin(a) * rr, zc))
            a += float(rng.uniform(-0.18, 0.18))
            zc -= float(rng.uniform(0.6, 1.1))
        _vein(f, pts, 0.07, 0.025)
        if len(pts) > 5:
            m = len(pts) // 2
            b = [pts[m]]
            a2 = a + (0.5 if j % 2 else -0.5)
            zc = pts[m][2]
            for _ in range(4):
                zc -= 0.8
                sx, sy = _rod_spine(zc)
                b.append((sx + math.cos(a2) * 2.4, sy + math.sin(a2) * 2.4, zc))
                a2 += 0.15
            _vein(f, b, 0.045, 0.02)
    for s in (-1, 1):
        f.put('fulg', RoundCone_tip(tx + s * 1.1, ty + 0.05, crown_z + 4.3), 0.05)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - 1.75 - np.maximum(0.0, Z - 3.0) * 0.35)
    _mesh(bpy, p, f, 'StormRod', 3800)
    prng = p.rng
    # The crown's crystal (glow: the vein's teal-white), a cluster of long
    # needles fanning up out of the cradle, the brightest at the heart.
    for j in range(8):
        a = TAU * j / 8 + prng.uniform(-0.3, 0.3)
        spread = 0.0 if j == 0 else prng.uniform(0.16, 0.42)
        d = (math.cos(a) * spread, math.sin(a) * spread, 1.0)
        off = 0.0 if j == 0 else 0.22
        base = (tx + math.cos(a) * off, ty + math.sin(a) * off, crown_z - 0.1)
        with p.as_kind(PAINT):
            facet_crystal(p, base, d, prng.uniform(1.5, 2.6) if j else 3.3, prng.uniform(0.14, 0.24),
                          BREATH_CORE if j == 0 else p.vary(BREATH_GLOW, 0.05))
    _rubble(p, prng, 1.5, 1.8, 6)
    return p


def RoundCone_tip(x, y, z):
    """A horn's scorched tip: a small capsule at its end."""
    from jaguar_head_sculpt import RoundCone
    return RoundCone((x, y, z - 0.5), (x + 0.05, y, z + 0.45), 0.22, 0.16)


# ===================================================================== the horn
def _horn_path():
    """The horn's line and radius: from the bell (open toward -Y, resting
    on the ground) back along its cradle, sinking as it narrows, then
    curling up, back over itself and down into a coil in the Y-Z plane (a
    ram's horn lying on its side). Returns (points, radii, coil_start)."""
    pts = []
    radii = []
    n = 20
    y0, y1 = -6.75, 4.45
    for i in range(n):
        t = i / (n - 1)
        y = y0 + t * (y1 - y0)
        r = 2.62 * (1 - t) ** 1.25 + 0.98 * t ** 0.8
        z = 2.66 - 0.76 * t ** 1.4
        x = 0.4 * math.sin(t * 2.4)
        pts.append((x, y, z))
        radii.append(r)
    start = len(pts)
    cy, cz, R0 = y1, pts[-1][2] + 2.2, 2.2
    x0 = pts[-1][0]
    m = 30
    for i in range(1, m + 1):
        u = i / m
        th = -math.pi / 2 + u * TAU * 0.9
        R = R0 * (1 - u * 0.62)
        pts.append((x0 + u * 0.7, cy + R * math.cos(th), cz + R * math.sin(th)))
        radii.append(0.98 * (1 - u) ** 0.85 + 0.2)
    return pts, radii, start


def start_of(pts):
    return 20


def _frame(pts, i):
    a = np.array(pts[max(0, i - 1)])
    b = np.array(pts[min(len(pts) - 1, i + 1)])
    t = b - a
    t /= np.linalg.norm(t)
    up = np.array((0.0, 0.0, 1.0)) if abs(t[2]) < 0.9 else np.array((1.0, 0.0, 0.0))
    n1 = np.cross(t, up)
    n1 /= np.linalg.norm(n1)
    n2 = np.cross(t, n1)
    return t, n1, n2


def wind_horn(bpy):
    """The great stone wind-horn (see the module doc): inside the layout's
    box (x 4.4, y 7.5, z 7); the bell toward -Y."""
    p = BP('WindHorn', seed=5201, ao=0.7, ao_dist=2.4)
    rng = np.random.default_rng(5201)
    f = Sculpt((-4.6, -7.8, -0.6), (4.6, 7.8, 7.3), 0.08)
    pts, radii, coil = _horn_path()
    f.put('g0', Polyline(pts, radii), 0.25)
    # The bell's rolled lip and the throat hollowed deep into the horn.
    mouth = np.array(pts[0])
    f.put('dressed', Torus((mouth[0], mouth[1] - 0.05, mouth[2]), 2.55, 0.42, (0.0, 1.0, 0.0)), 0.2)
    f.put('dressed', Polyline([tuple(mouth + (0, -0.2, 0)), tuple(mouth + (0, 0.5, 0))], [2.85, 2.75]), 0.2)
    throat = [tuple(np.array(q) + (0, 0, 0.02)) for q in pts[:13]]
    f.sub(Polyline([tuple(mouth + (0, -1.0, 0))] + throat, [2.3] + [r * 0.8 for r in radii[:13]]), 0.2)
    # The Smith's two carved bands round its body: raised rings, dressed,
    # a chevron cut round each.
    for i in (6, 13):
        t, n1, n2 = _frame(pts, i)
        f.put('dressed', Torus(pts[i], radii[i] + 0.02, 0.32, tuple(t)), 0.1)
        zig = []
        for k in range(37):
            phi = TAU * k / 36
            q = (np.array(pts[i]) + t * (0.16 if k % 2 else -0.16)
                 + (n1 * math.cos(phi) + n2 * math.sin(phi)) * (radii[i] + 0.4))
            zig.append(tuple(q))
        _carve(f, zig, 0.08, 0.06)
    # One slow flute down its back (the horn's growth line), faint.
    line = []
    for i in range(1, start_of(pts) + 10):
        t, n1, n2 = _frame(pts, i)
        q = np.array(pts[i]) + (n1 * math.cos(2.2 + i * 0.05) + n2 * math.sin(2.2 + i * 0.05)) * radii[i] * 1.03
        line.append(tuple(q))
    _carve(f, line, 0.12, 0.14)
    # The cradle: a rough block under the bell, a carved saddle under the
    # body's end, wedges at their feet.
    f.put('g3', block(rng, (0.0, -3.9, 0.45), (3.6, 2.2, 1.0), cuts=10, chamfer=(0.8, 0.95), top_tilt=0.08), 0.3)
    f.put('g4', block(rng, (0.4, 2.4, 0.6), (2.8, 2.6, 1.2), cuts=10, chamfer=(0.82, 0.96)), 0.3)
    for (cx, cy) in ((1.9, -3.3), (-1.8, -4.6), (1.7, 3.4)):
        f.put('g1', block(rng, (cx, cy, 0.35), (0.9, 1.1, 0.75), cuts=8, chamfer=(0.76, 0.93),
                          R=rot(rz=float(rng.uniform(0, TAU)))), 0.2)
    _scour(f, 5201, amp=0.06, scale=0.7, band=0.3, along=(0.0, 1.0, 0.0), flutes=0.3)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.maximum(np.maximum(np.abs(X) - 4.35, np.abs(Y) - 7.45), Z - 6.95))
    _mesh(bpy, p, f, 'WindHorn', 4300)
    # The vein's light deep in the throat (glow), a ring of crystals grown
    # out of its walls, pointing out of the bell.
    prng = p.rng
    for j in range(9):
        a = TAU * j / 9 + prng.uniform(-0.2, 0.2)
        i = int(prng.uniform(4, 9))
        cx, cy, cz = pts[i]
        rr = radii[i] * 0.78
        base = (cx + math.cos(a) * rr * 0.92, cy, cz + math.sin(a) * rr * 0.92)
        d = (-math.cos(a) * 0.55, -0.7, -math.sin(a) * 0.55)
        with p.as_kind(PAINT):
            facet_crystal(p, base, d, prng.uniform(0.6, 1.1), prng.uniform(0.11, 0.2),
                          BREATH_CORE if j == 0 else p.vary(BREATH_GLOW, 0.05))
    _rubble(p, prng, 2.5, 4.2, 7)
    return p


# ================================================================== the shelter
def wind_shelter(bpy):
    """A windbreak on the bridge (see the module doc): inside x 2.4, y 0.7,
    z 2.1; its scalloped windward face toward -Y."""
    p = BP('WindShelter', seed=5301, ao=0.6, ao_dist=0.9)
    rng = np.random.default_rng(5301)
    f = Sculpt((-2.7, -1.0, -0.4), (2.7, 1.0, 2.4), 0.045)
    # The footing course: two long dark blocks, a hand wider.
    f.put('g3', block(rng, (-1.2, 0.0, 0.2), (2.5, 1.36, 0.46), cuts=8, chamfer=(0.82, 0.95)), 0.08)
    f.put('g4', block(rng, (1.25, 0.02, 0.2), (2.4, 1.32, 0.42), cuts=8, chamfer=(0.82, 0.95)), 0.08)
    # The slab: leaning a breath into the wind, its top rounded by it.
    f.put('g0', block(rng, (0.0, 0.05, 1.08), (4.62, 1.12, 1.66), cuts=12, chamfer=(0.88, 0.98),
                      R=rot(rx=0.06), top_tilt=0.04), 0.14)
    f.put('g2', RoundBox((0.05, -0.02, 1.78), (2.2, 0.5, 0.2), 0.2, rot(rx=0.06)), 0.18)
    # The windward scallops, overlapping hollows.
    for j in range(6):
        cx = -1.9 + j * 0.76 + float(rng.uniform(-0.12, 0.12))
        f.sub(Ellipsoid((cx, -0.72, 1.05 + float(rng.uniform(-0.25, 0.3))), (0.42, 0.34, 0.6)), 0.1)
    # The windward top worn away into a long rounded slope.
    f.sub(Ellipsoid((0.0, -1.25, 2.3), (3.4, 0.9, 0.75)), 0.25)
    # The lee's chevron, the Smith's mark: two grooves meeting.
    _carve(f, [(-0.8, 0.7, 1.6), (0.0, 0.7, 0.85), (0.8, 0.7, 1.6)], 0.09, 0.05)
    _carve(f, [(-0.55, 0.7, 1.75), (0.0, 0.7, 1.15), (0.55, 0.7, 1.75)], 0.06, 0.04)
    _scour(f, 5301, amp=0.035, scale=1.4, band=0.2, along=(1.0, 0.0, 0.0), flutes=0.6)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.maximum(np.abs(X) - 2.38, np.abs(Y) - 0.69))
    _mesh(bpy, p, f, 'WindShelter', 1500)
    return p


# ================================================================= the bridge
def wind_bridge(bpy):
    """The Wind Bridge's natural arch (see the module doc)."""
    p = BP('WindBridge', seed=5401, ao=0.6, ao_dist=5.0, lichen=0.6)
    rng = np.random.default_rng(5401)
    L = BRIDGE_RUN
    lo = (-12.0, -BRIDGE_HALF - 7.0, -50.0)
    hi = (L + 12.0, BRIDGE_HALF + 7.0, BRIDGE_RISE + 1.0)
    f = Sculpt(lo, hi, 0.28)
    nf = Noise(5403)
    X, Y, Z = _axes(f)

    def deck(x):
        return np.clip(x / L, 0.0, 1.0) * BRIDGE_RISE

    D = deck(X)
    # The wind-eye under the middle: from leg to leg, its crown some yards
    # under the deck, a pointed arch a little off centre, its soffit rugged.
    a0, a1 = 8.0, L - 7.0
    mid = (a0 + a1) / 2 + 1.5
    half = (a1 - a0) / 2
    u = np.clip((X - mid) / half, -1.0, 1.0)
    crown = float(deck(mid)) - 7.5
    intrados = -50.0 + (crown + 50.0) * np.sqrt(np.maximum(0.0, 1.0 - u ** 2)) ** 0.7
    intrados = intrados - 1.6 * nf.fbm(X * 0.12, Y * 0.12, 3.0, 2)
    inside_span = (X > a0) & (X < a1)
    # The rib's width: the walk's own at the top and a little past it, the
    # granite's beds stepping out one after another as they fall (each bed
    # its own shoulder, a lit ledge on top, a shadowed drip under), wider
    # still and flaring at the legs.
    depth_under = D - Z
    BED = 5.5
    q = np.maximum(0.0, depth_under) / BED
    step = np.floor(q) + np.clip((q - np.floor(q) - 0.82) / 0.18, 0.0, 1.0)
    bed_out = 0.55 * nf.fbm(np.floor(q) * 3.1, X * 0.035, 7.0, 2)
    width = BRIDGE_HALF + 0.6 + step * 0.62 + bed_out
    into = np.minimum(X - a0, a1 - X)
    legw = 1.0 - np.clip(into / 6.0, 0.0, 1.0) ** 2 * (3.0 - 2.0 * np.clip(into / 6.0, 0.0, 1.0))
    leg = legw * (2.2 + np.maximum(0.0, depth_under - 10.0) * 0.07)
    width = width + leg + 0.5 * nf.fbm(X * 0.05, Z * 0.05, 0.0, 2)
    side = np.abs(Y) - width
    top = Z - (D - 0.35)
    bottom = np.where(inside_span, intrados - Z, -50.0 - Z)
    # The legs' far ends rough and battered back into the mountain.
    rough = 2.5 * nf.fbm(Y * 0.12, Z * 0.08, 11.0, 2) + np.maximum(0.0, depth_under) * 0.05
    ends = np.maximum(-X - 10.0 - rough, X - (L + 10.0) - rough)
    body = np.maximum(np.maximum(side * 0.8, top), np.maximum(bottom, ends))
    f.d = np.minimum(f.d, body.astype(np.float32))
    # The beds' tones (each band of the rib its own grey).
    for k, zb in enumerate(np.arange(-50.0, BRIDGE_RISE + 2.0, 5.5)):
        f.parts.append((('g0', 'g1', 'g4', 'g5', 'g3', 'g0')[k % 6],
                        RoundBox(((lo[0] + hi[0]) / 2, 0.0, zb + 2.75), (60.0, 16.0, 2.75), 0.2)))
    # A few spalls broken out of its flanks.
    for j in range(5):
        sx = float(rng.uniform(4.0, L - 4.0))
        s = -1.0 if j % 2 else 1.0
        zc = float(deck(sx)) - float(rng.uniform(6.0, 20.0))
        f.sub(Ellipsoid((sx, s * (BRIDGE_HALF + 3.6), zc), (float(rng.uniform(2.0, 3.2)), 1.6,
                                                              float(rng.uniform(1.1, 1.9))),
                        rot(rz=float(rng.uniform(-0.3, 0.3)))), 0.4)
    _scour(f, 5401, amp=0.45, scale=0.07, band=1.4, along=(1.0, 0.0, 0.0), flutes=0.0)
    # Nothing over the deck within the walk.
    X, Y, Z = _axes(f)
    _clamp(f, np.where(np.abs(Y) < BRIDGE_HALF + 0.05, Z - (deck(X) - 0.3), -50.0))
    f.cut_below(-50.0)
    _mesh(bpy, p, f, 'WindBridge', 12000)
    return p


# ================================================================== the walls
def breath_wall(variant):
    """A 6 yd module of a Breath walk's low wall over the void (an edge
    piece: the walk toward +Y, the drop toward -Y): the cliff's carved face
    two lifts deep under the walk, a wall of rough-hewn storm granite on it a
    body's knee high (0.9), rounded scoured copings. B: a coping blown off."""
    p = BP('BreathWall' + variant, seed=5501 + ord(variant), ao=0.55, ao_dist=0.9)
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
                         p.vary(STORM_COOL if rng.random() < 0.6 else STORM_DARK, 0.05), chamfer=0.2, jitter=0.1)
                x += length
            z -= h
        # The wall: one course of long rough blocks (y -0.95 to -0.1).
        x = -half
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(1.2, 2.2))
            slab(p, (x + length / 2, -0.52, 0.29), (length - 0.06, 0.8, 0.62),
                 p.vary(STORM if rng.random() < 0.6 else STORM_WARM, 0.06), chamfer=0.2,
                 jitter=0.1, yaw=rng.uniform(-0.03, 0.03))
            x += length
        # The copings: rounded, scoured pale, a little proud of the wall.
        x = -half
        k = 0
        while x < half - 1e-6:
            length = min(half - x, rng.uniform(0.95, 1.7))
            if not (variant == 'B' and k == 2):
                slab(p, (x + length / 2, -0.52, 0.75), (length - 0.06, 0.88, 0.3),
                     p.vary(STORM_PALE if rng.random() < 0.55 else STORM, 0.05), chamfer=0.42, jitter=0.06)
            x += length
            k += 1
    if variant == 'B':
        with p.as_kind(RAW):
            for _ in range(4):
                s = rng.uniform(0.12, 0.26)
                slab(p, (rng.uniform(-0.6, 0.6), rng.uniform(-0.85, -0.2), 0.63 + s * 0.15), (s * 1.4, s, s * 0.3),
                     p.vary(STORM_PALE, 0.08), yaw=rng.uniform(0, TAU), chamfer=0.22, jitter=0.15)
    return p


# ================================================================ the channels
def channel_jamb(bpy):
    """A wind channel's cheek stone (see the module doc): about 9 tall, a
    blade leaning out over the channel, fluted by the updraft, its foot
    inside r 1.4."""
    p = BP('ChannelJamb', seed=5601, ao=0.65, ao_dist=1.6)
    rng = np.random.default_rng(5601)
    f = Sculpt((-2.4, -2.0, -0.6), (2.6, 2.0, 10.0), 0.07)
    f.put('g0', block(rng, (0.0, 0.0, 2.6), (2.7, 1.7, 5.4), cuts=14, chamfer=(0.82, 0.97), R=rot(ry=-0.06)), 0.4)
    f.put('g2', block(rng, (0.55, 0.05, 6.6), (2.1, 1.3, 4.6), cuts=14, chamfer=(0.8, 0.96),
                      R=rot(ry=-0.2, rz=0.25), top_tilt=0.5), 0.6)
    # The bore near its head.
    f.sub(Ellipsoid((0.45, 0.0, 6.4), (0.22, 1.5, 0.95), rot(ry=-0.55)), 0.12)
    # The updraft's flutes: a few long irregular grooves up both broad faces.
    for s in (-1, 1):
        for j in range(2):
            x0 = -0.5 + j * 0.9 + float(rng.uniform(-0.12, 0.12))
            pts = [(x0 + 0.12 * math.sin(z * 0.5 + j) + z * 0.06, s * 1.0, z) for z in np.linspace(0.7, 6.4, 9)]
            _carve(f, pts, 0.24, 0.16)
    _scour(f, 5601, amp=0.05, scale=0.9, band=0.3, along=(0.0, 0.0, 1.0), flutes=0.5)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - 1.4 - np.maximum(0.0, Z - 3.0) * 0.3)
    _mesh(bpy, p, f, 'ChannelJamb', 2200)
    prng = p.rng
    for j in range(3):
        a = TAU * j / 3 + 0.5
        with p.as_kind(PAINT):
            facet_crystal(p, (1.15 + math.cos(a) * 0.15, math.sin(a) * 0.15, 8.15),
                          (0.35 + math.cos(a) * 0.35, math.sin(a) * 0.35, 1.0),
                          prng.uniform(0.6, 1.0), prng.uniform(0.12, 0.17), p.vary(BREATH_GLOW, 0.05))
    _rubble(p, prng, 1.45, 1.9, 6)
    return p


def storm_stone(bpy):
    """A wind-carved standing stone for the landings' rims: about 7.5 tall,
    one twisted mass leaning down the wind, scalloped on its windward face
    (-Y), bored through near its head with the vein's crystal in the bore,
    a lichen crust in its lee."""
    p = BP('StormStone', seed=5701, ao=0.65, ao_dist=1.6)
    rng = np.random.default_rng(5701)
    f = Sculpt((-2.4, -2.4, -0.6), (2.6, 2.4, 8.6), 0.07)
    f.put('g0', block(rng, (0.0, 0.0, 2.3), (2.8, 1.95, 4.8), cuts=14, chamfer=(0.8, 0.96), R=rot(ry=0.05)), 0.6)
    f.put('g1', block(rng, (0.35, 0.05, 5.5), (1.9, 1.4, 3.9), cuts=14, chamfer=(0.8, 0.96),
                      R=rot(ry=0.13, rz=0.55), top_tilt=0.45), 0.75)
    for j in range(3):
        f.sub(Ellipsoid((float(rng.uniform(-0.7, 0.8)), -1.25, 1.6 + j * 1.7), (0.9, 0.42, 0.7)), 0.3)
    f.sub(Ellipsoid((0.35, 0.0, 5.0), (0.2, 1.7, 0.85), rot(rz=0.4, ry=0.6)), 0.12)
    _scour(f, 5701, amp=0.06, scale=0.9, band=0.3, along=(0.0, 0.0, 1.0), flutes=0.4)
    f.cut_below(0.0)
    X, Y, Z = _axes(f)
    _clamp(f, np.sqrt(X * X + Y * Y) - 1.95 - np.maximum(0.0, Z - 3.0) * 0.3)
    _mesh(bpy, p, f, 'StormStone', 2200)
    prng = p.rng
    for j in range(3):
        a = TAU * j / 3
        with p.as_kind(PAINT):
            facet_crystal(p, (0.75 + math.cos(a) * 0.15, math.sin(a) * 0.12, 6.95), (math.cos(a) * 0.4, math.sin(a) * 0.4, 1.0),
                          prng.uniform(0.5, 0.85), prng.uniform(0.11, 0.16), p.vary(BREATH_GLOW, 0.05))
    _rubble(p, prng, 1.5, 2.2, 7)
    return p


# ================================================================== the inlays
def plateau_crack(variant):
    """The cracked plateau's fissures (flat: under 0.05 tall, so every
    telegraph draws over them): A a long fissure (about 11 yd) with its
    branches, B a star of cracks; the vein's light faint in the widest."""
    p = BP('PlateauCrack' + variant, seed=5801 + ord(variant), ao=0.0)
    rng = p.rng

    def run(x, y, ang, length, w, depth=0):
        seg = 0.5
        n = max(2, int(length / seg))
        for i in range(n):
            ang += rng.uniform(-0.12, 0.12) + (rng.choice([-1, 1]) * rng.uniform(0.4, 0.8) if rng.random() < 0.14 else 0)
            nx, ny = x + math.cos(ang) * seg, y + math.sin(ang) * seg
            ww = w * (1 - i / n * 0.8)
            with p.as_kind(PAINT):
                p.box(((x + nx) / 2, (y + ny) / 2, 0.006), (seg * 1.08, max(0.035, ww), 0.012), STORM_DEEP, yaw=ang)
            if ww > 0.09:
                with p.as_kind(PAINT):
                    p.box(((x + nx) / 2, (y + ny) / 2, 0.009), (seg * 1.02, ww * 0.38, 0.012),
                          p.vary(BREATH_GLOW, 0.04), yaw=ang, mat=GLOW)
            if depth < 1 and rng.random() < 0.09:
                run(nx, ny, ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.1), length * rng.uniform(0.25, 0.45),
                    ww * 0.6, depth + 1)
            x, y = nx, ny

    if variant == 'A':
        run(-5.5, 0.0, 0.0, 11.0, 0.16)
    else:
        for k in range(4):
            run(0.0, 0.0, TAU * k / 4 + rng.uniform(-0.5, 0.5), rng.uniform(2.5, 5.5), 0.13)
    xs = [v.co.x for v in p.bm.verts]
    ys = [v.co.y for v in p.bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    for v in p.bm.verts:
        v.co.x -= cx
        v.co.y -= cy
    return p


def strike_scar():
    """Lightning's scar at a rod's foot (flat, under 0.05): fused dark glass
    in a star of branching runs, the vein's light in its widest veins."""
    p = BP('StrikeScar', seed=5901, ao=0.0)
    rng = p.rng
    with p.as_kind(PAINT):
        crystal(p, (0, 0, 0.012), (2.0, 1.8, 0.024), FULGURITE, n=18, boxy=0.0, jitter=0.3)
    for k in range(9):
        ang = TAU * k / 9 + rng.uniform(-0.25, 0.25)
        x, y = math.cos(ang) * 0.8, math.sin(ang) * 0.8
        length = rng.uniform(1.6, 3.6)
        seg = 0.35
        for i in range(int(length / seg)):
            ang += rng.uniform(-0.35, 0.35)
            nx, ny = x + math.cos(ang) * seg, y + math.sin(ang) * seg
            w = 0.16 * (1 - i * seg / length)
            with p.as_kind(PAINT):
                p.box(((x + nx) / 2, (y + ny) / 2, 0.008), (seg * 1.1, max(0.04, w), 0.014), FULGURITE, yaw=ang)
                if i < 3:
                    p.box(((x + nx) / 2, (y + ny) / 2, 0.012), (seg, max(0.02, w * 0.4), 0.014),
                          p.vary(BREATH_GLOW, 0.04), yaw=ang, mat=GLOW)
            x, y = nx, ny
    return p


def wind_groove():
    """A channel the Smith cut in the Cornice's floor (flat, under 0.05):
    about 12 yd along +Y (the notch's end at -Y), a polished dark bed
    between two worn pale lips, narrowing as it runs in."""
    p = BP('WindGroove', seed=6001, ao=0.0)
    rng = p.rng
    length = 12.0
    steps = 16
    for i in range(steps):
        t0, t1 = i / steps, (i + 1) / steps
        y0, y1 = -length / 2 + t0 * length, -length / 2 + t1 * length
        w = 1.05 - 0.45 * (t0 + t1) / 2
        x0 = 0.18 * math.sin(t0 * 3.1)
        x1 = 0.18 * math.sin(t1 * 3.1)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        yaw = math.atan2(y1 - y0, x1 - x0)
        seg = math.hypot(x1 - x0, y1 - y0) * 1.04
        with p.as_kind(PAINT):
            p.box((cx, cy, 0.008), (seg, w, 0.016), p.vary(STORM_DARK, 0.04), yaw=yaw)
            for s in (-1, 1):
                ox = -math.sin(yaw) * s * (w / 2 + 0.09)
                oy = math.cos(yaw) * s * (w / 2 + 0.09)
                p.box((cx + ox, cy + oy, 0.014), (seg * rng.uniform(0.85, 1.0), 0.2, 0.028),
                      p.vary(STORM_PALE, 0.05), yaw=yaw)
    return p
