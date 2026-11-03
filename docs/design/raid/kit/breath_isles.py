"""The Islands of the Wind (the Breath's isles, AAA pass of 2026-11-03):
Kit_WindIsleA, Kit_WindIsleB and Kit_IsleShard of the Breath kit
(build_smith_heart_breath_kit.py; breath_pieces.py keeps the rest).

Two islets of the summit's storm granite torn loose and held in the open sky
by the wind, painted-world fantasy (E:/woc/referencias/painted-world-style-
guide: chunky masses, warm key on the tops, cool blue-violet shadow under,
colour drifting inside every material, weathering where weather goes):

  - the walk: a turf cap flat at z 0 whose edge IS the sim's floor (the
    layout's isleSurface polygon for the isle, turned into this frame:
    ISLE_WALKS, pinned by tests/smith_heart_breath_kit.test.ts), a ragged
    turf lip curling over it into a soil band, never a ledge of floor past
    where a body may stand; the ruined wind shrine on it: a broken ring of
    curved flags under the fight's rune ring, the landing pad of the
    Homeward Gale (a dais of wedge stones in a gap of that ring, toward the
    Cornice) and stepping flags in to the middle's wind stone;
  - round the walk, only outside it: runed standing stones on rim
    outcrops, a broken arch (A) or a wind-bent tree and a fallen stone (B),
    grass tufts and loose stones along the lip, crystal on the rim;
  - the hang (what the raid sees from the Cornice): one dominant crag
    tapering to a leaning point, a lesser spire beside it (two on B), a
    shelf jutting from the flank, strata, the stone warm under the turf and
    cooling to a blue-violet at the point; satellite rocks floating beside
    it (each a small isle with its own turf and point); thick roots
    clinging down the rock then hanging in long curves, vines with leaves,
    the vein's crystal out of the point and the flanks (KitGlow).

Frame: Blender yards, +Z up, the walk at z 0 round the origin (the isle's
centre in the layout); the runtime turns each isle by ISLE_KIT's rot
(breath_isles_fx_core.ts), already folded into ISLE_WALKS and ISLE_PADS.
Deterministic: every draw is the piece's own seeded rng.
"""
import math

import numpy as np
from mathutils import Matrix, Vector

import gravewyrm_sculpt as gs
from breath_pieces import (BREATH_CORE, BREATH_GLOW, STORM, STORM_COLOURS, STORM_KINDS, STORM_PALE,
                           BreathPiece, _axes, _on_surface)
from gravewyrm_sculpt import Sculpt, block
from gwkit import add_sculpt, crystal, hull, mix, slab, sstep
from hckit import GLOW, STONE, _fbm
from jaguar_head_sculpt import Ellipsoid, Noise, Polyline, rot
from ring_sculpt import facet_crystal
from shkit import DRESSED, PAINT, RAW, TAU, WOOD

# ---- the sim's walk in the kit's frame -------------------------------------------------
# smith_heart_layout.ts isleSurface(BREATH_ISLES[i]) (24 bearings, each bitten
# in), less the isle's centre, turned by -ISLE_KIT[i].rot and taken to the
# Blender frame ((x, z) game to (x, -z)). Counter-clockwise. The test pins the
# shipped walk to the sim's polygon, so a change of either fails it.
ISLE_WALKS = {
    'A': ((-5.0453, -7.3747), (-2.5369, -7.2131), (-0.6641, -8.6747), (1.5713, -8.3779),
          (3.4365, -7.1654), (4.9738, -5.7984), (7.1329, -4.8799), (7.3858, -2.5977),
          (7.8547, -0.6013), (8.0524, 1.5102), (7.4019, 3.55), (6.5378, 5.6081),
          (4.5343, 6.6278), (2.602, 7.3982), (0.656, 8.5699), (-1.6154, 8.6131),
          (-3.8601, 8.0484), (-5.0232, 5.856), (-6.9363, 4.7454), (-7.7608, 2.7296),
          (-8.1055, 0.6205), (-8.6244, -1.6175), (-7.4776, -3.5863), (-6.5273, -5.599)),
    'B': ((-5.2457, 5.7267), (-6.4422, 4.1057), (-8.1064, 2.5575), (-7.8658, 0.3448),
          (-7.4498, -1.6502), (-6.949, -3.6159), (-6.1167, -5.603), (-4.6857, -7.3522),
          (-2.6192, -8.3021), (-0.3788, -8.6424), (1.7576, -7.9346), (3.5437, -6.8103),
          (5.9174, -6.46), (6.8142, -4.3428), (8.0957, -2.5541), (7.659, -0.3357),
          (8.7848, 1.9459), (6.9537, 3.6183), (5.9332, 5.4349), (4.8075, 7.5435),
          (2.706, 8.5772), (0.3835, 8.7482), (-1.7696, 7.9886), (-4.0369, 7.758)),
}
# breath_isle_geometry.ts isleSpots(): where a ride sets a body down (`land`)
# and the Homeward Gale's circle (`home`, its near edge, toward the Cornice).
ISLE_PADS = {
    'A': dict(land=(-2.8046, -1.4341), home=(-5.164, -2.6406)),
    'B': dict(land=(-2.9581, 1.0826), home=(-5.4467, 1.9934)),
}
# The Gale's circle (ISLE_TUNING.circleR 2.6, its disc drawn 1.2 times that).
PAD_R = 2.95
# The fight's rune ring (breath_isles_fx_core.ts isleRuneRing: r - 3.1 to r - 1.7).
RING_IN, RING_OUT = 5.65, 7.45

# ---- the isles' own paint (sRGB) --------------------------------------------------------
# Warm key, cool shadow (L1): warm greys and a little ochre under the turf,
# blue-violet greys down the hang, never black (L6).
ROCK_WARM = (0.44, 0.38, 0.32)
ROCK_COOL = (0.35, 0.37, 0.42)
ROCK_PALE = (0.57, 0.53, 0.47)
ROCK_DARKBED = (0.39, 0.4, 0.46)
# The hang's cool: a pale blue-violet, never dark (the hang sees only the
# sky's fill from the Cornice; its paint carries the value the light cannot).
ROCK_UNDER = (0.5, 0.51, 0.62)
ROCK_OCHRE = (0.55, 0.45, 0.33)
SOIL = (0.3, 0.23, 0.17)
SOIL_DARK = (0.2, 0.16, 0.13)
TURF = (0.36, 0.38, 0.29)
TURF_SUN = (0.5, 0.47, 0.34)
TURF_COOL = (0.25, 0.3, 0.3)
TURF_DRY = (0.52, 0.46, 0.36)
MOSS = (0.33, 0.4, 0.26)
MOSS_DEEP = (0.24, 0.33, 0.2)
LICHEN = (0.66, 0.66, 0.5)
FLAG = (0.47, 0.47, 0.46)
FLAG_WARM = (0.52, 0.48, 0.42)
FLAG_COOL = (0.43, 0.45, 0.49)
ROOT = (0.34, 0.28, 0.23)
ROOT_PALE = (0.47, 0.41, 0.35)
ROOT_DARK = (0.22, 0.17, 0.14)
VINE = (0.28, 0.37, 0.22)
LEAF = (0.38, 0.5, 0.27)
LEAF_SUN = (0.55, 0.6, 0.3)
BARK = (0.33, 0.27, 0.22)
CRYSTAL_TINT = (0.22, 0.52, 0.62)
# The crag right under the turf: dark, warm and layered (it frames the walk).
CRAG = (0.19, 0.165, 0.15)
CRAG_BED = (0.3, 0.26, 0.22)
FLOWERS = ((0.9, 0.87, 0.78), (0.86, 0.72, 0.32), (0.58, 0.48, 0.74), (0.82, 0.5, 0.42))

# Face kinds of their own (painted in IslePiece.finish).
TURF_K, SOIL_K, LEAF_K, FLAG_K = 20, 21, 22, 23

ISLE_SPECS = {
    # A: one tall leaning crag with a lesser spire, a broken arch on its far
    # rim, three satellites strung off its left and right.
    'A': dict(seed=6101, depth=26.0, lean=(-0.55, 0.95), crown=9.6,
              spires=((0.62, (4.6, -3.2), 0.55),),
              ledges=((1.05, -6.5, 3.4),),
              sats=((5.2, 13.6, 1.2, 2.9, 7.5), (1.66, 14.8, -5.0, 1.8, 4.6), (0.35, 15.0, -9.5, 1.25, 3.2)),
              stones=(0.52, 2.53, 4.71), arch=(5.86, 6.32), tree=None, fallen=None, sun=(-0.98, -0.2)),
    # B: broad and twin-fanged (two spires near as long and a third short),
    # a wind-bent tree on its rim and a fallen stone on a shelf.
    'B': dict(seed=6201, depth=18.5, lean=(0.85, -0.5), crown=11.2,
              spires=((0.8, (-4.4, 2.6), 0.75), (0.48, (3.4, 4.2), 0.5)),
              ledges=((5.24, -4.6, 3.6), (2.2, -9.0, 2.6)),
              sats=((0.7, 14.0, 2.2, 2.3, 5.6), (4.36, 13.6, -3.5, 3.1, 8.5), (1.92, 15.5, -7.5, 1.3, 3.4)),
              stones=(1.4, 4.36, 5.76), arch=None, tree=0.33, fallen=5.24, sun=(0.03, 1.0)),
}


# ---- the walk's polygon ---------------------------------------------------------------
def poly_sd(poly, X, Y):
    """Signed distance from (X, Y) (arrays) to the polygon's edge, negative
    inside."""
    P = np.asarray(poly, dtype=np.float64)
    X = np.asarray(X, dtype=np.float64)
    Y = np.asarray(Y, dtype=np.float64)
    best = np.full(np.broadcast(X, Y).shape, np.inf)
    inside = np.zeros(best.shape, dtype=bool)
    n = len(P)
    for i in range(n):
        ax, ay = P[i]
        bx, by = P[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        t = np.clip(((X - ax) * ex + (Y - ay) * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        dx = X - (ax + ex * t)
        dy = Y - (ay + ey * t)
        best = np.minimum(best, np.sqrt(dx * dx + dy * dy))
        cross = ((ay > Y) != (by > Y)) & (X < (bx - ax) * (Y - ay) / (by - ay + 1e-12) + ax)
        inside ^= cross
    return np.where(inside, -best, best)


def edge_r(poly, a):
    """How far the walk reaches along bearing `a` (radians, from +X)."""
    ux, uy = math.cos(a), math.sin(a)
    best = 0.0
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        den = ux * ey - uy * ex
        if abs(den) < 1e-9:
            continue
        t = (ax * ey - ay * ex) / den
        s = (ax * uy - ay * ux) / den
        if t > 0 and -1e-6 <= s <= 1 + 1e-6:
            best = max(best, t)
    return best


def edge_pt(poly, a, out=0.0, z=0.0):
    r = edge_r(poly, a) + out
    return (math.cos(a) * r, math.sin(a) * r, z)


def resample(poly, step):
    """The polygon's edge every `step` yards (its corners kept), with each
    point's outward normal."""
    pts, nrm = [], []
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        L = math.hypot(bx - ax, by - ay)
        k = max(1, int(math.ceil(L / step)))
        ox, oy = (by - ay) / L, -(bx - ax) / L
        for j in range(k):
            t = j / k
            pts.append((ax + (bx - ax) * t, ay + (by - ay) * t))
            nrm.append((ox, oy))
    # Smooth the normals over the corners.
    sm = []
    for i in range(len(nrm)):
        x = nrm[i - 1][0] + 2 * nrm[i][0] + nrm[(i + 1) % len(nrm)][0]
        y = nrm[i - 1][1] + 2 * nrm[i][1] + nrm[(i + 1) % len(nrm)][1]
        L = math.hypot(x, y)
        sm.append((x / L, y / L))
    return pts, sm


def inside(poly, x, y, inset=0.0):
    return float(poly_sd(poly, np.array([x]), np.array([y]))[0]) < -inset


def smooth_path(pts, per=3):
    """A Catmull-Rom curve through `pts` (`per` points per span)."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return [tuple(p) for p in P]
    out = []
    for i in range(len(P) - 1):
        p0 = P[max(0, i - 1)]
        p1, p2 = P[i], P[i + 1]
        p3 = P[min(len(P) - 1, i + 2)]
        for j in range(per):
            t = j / per
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                       + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(q))
    out.append(tuple(P[-1]))
    return out


# ---- the piece ------------------------------------------------------------------------
class IslePiece(BreathPiece):
    """A BreathPiece painted as a floating isle: turf, soil, stone warm
    under the turf and cooling down the hang to a blue-violet, strata, moss
    on every ledge, the crystal's light on the rock round it; flags, roots,
    leaves each their own paint. Never one flat colour, never black."""

    def __init__(self, name, seed=0, depth=20.0, glows=(), **kw):
        super().__init__(name, seed=seed, **kw)
        self.isle_depth = depth
        # Worn lines across the turf (x0, y0, x1, y1, half width): the way in
        # from the Gale's dais to the middle.
        self.worn = []
        # The list itself (the dressing appends to it before finish()).
        self.glows = glows
        self.cur = RAW

    def finish(self, materials, parent):
        import bmesh
        import bpy
        bm = self.bm
        free = [f for f in bm.faces if not f[self.keep]]
        if free:
            bmesh.ops.recalc_face_normals(bm, faces=free)
        bm.normal_update()
        bm.verts.index_update()
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
        occ = self._bake_ao(self.isle_depth) if self.ao > 0 else None
        glows = np.array(self.glows) if self.glows else np.zeros((0, 3))
        D = self.isle_depth
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
                o = occ[loop.vert.index] * self.ao if occ is not None else 0.0
                if kind in (RAW, DRESSED):
                    col = self._rock(p, n, c, col, kind == DRESSED, D)
                elif kind == TURF_K:
                    col = self._turf(p, n, col)
                elif kind == SOIL_K:
                    k = 0.85 + 0.3 * _fbm(p.x * 0.6, p.y * 0.6, p.z * 0.6)
                    col = mix(tuple(ch * k for ch in col), SOIL_DARK, sstep(-0.2, -0.9, n.z) * 0.5)
                elif kind == FLAG_K:
                    col = self._flag(p, n, c, col)
                elif kind == WOOD:
                    k = 0.85 + 0.3 * _fbm(p.x * 0.9 + 4.0, p.y * 0.9, p.z * 0.35)
                    col = tuple(ch * k for ch in col)
                    # Lit on its top, dark underneath, mossed where it lies on stone.
                    col = mix(col, ROOT_PALE, max(0.0, n.z) * 0.35)
                    col = mix(col, ROOT_DARK, max(0.0, -n.z) * 0.45)
                    col = mix(col, MOSS, sstep(0.5, 0.9, n.z) * sstep(0.55, 0.75, _fbm(p.x * 1.3, p.y * 1.3, p.z)) * 0.6)
                elif kind == LEAF_K:
                    k = 0.88 + 0.26 * _fbm(p.x * 1.7, p.y * 1.7, p.z * 1.7)
                    col = tuple(ch * k for ch in col)
                    col = mix(col, LEAF_SUN, max(0.0, n.z) * 0.4)
                    col = mix(col, MOSS_DEEP, max(0.0, -n.z) * 0.5)
                else:
                    k = 0.9 + 0.18 * _fbm(p.x * 1.6, p.y * 1.6, p.z * 1.6)
                    col = tuple(ch * k for ch in col)
                # The vein's light on the stone round its crystal.
                if len(glows) and kind not in (TURF_K, DRESSED):
                    d2 = ((glows - np.array((p.x, p.y, p.z))) ** 2).sum(axis=1)
                    lit = float(np.exp(-d2.min() / 5.0))
                    if lit > 0.02:
                        col = mix(col, (col[0] * 0.6 + CRYSTAL_TINT[0], col[1] * 0.6 + CRYSTAL_TINT[1],
                                        col[2] * 0.6 + CRYSTAL_TINT[2]), lit * 0.55)
                # Occlusion goes cool, never grey-black (L1).
                if o > 0:
                    col = mix(col, (col[0] * 0.6, col[1] * 0.62, col[2] * 0.78), min(1.0, o * 1.05))
                col = tuple(max(lo, ch) for ch, lo in zip(col, (0.1, 0.1, 0.13)))
                loop[self.col] = (min(1.0, col[0]), min(1.0, col[1]), min(1.0, col[2]), 1.0)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                a, b2 = e.link_faces
                if a.normal.angle(b2.normal, 0.0) > math.radians(52):
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

    def _rock(self, p, n, c, col, fine, D):
        """The isle's granite: big value groups first, colour drifting warm
        and cool, warped strata, warm under the turf to blue-violet at the
        point, moss on every ledge, the lip's soil band, pale chipped crests
        and cool hollows."""
        drift = _fbm(p.x * 0.09 + 7.0, p.y * 0.09, p.z * 0.07)
        base = mix(ROCK_COOL, ROCK_WARM, sstep(0.3, 0.7, drift))
        if fine:
            base = mix(base, col, 0.75)
        else:
            base = mix(base, col, 0.18)
        depth = min(1.0, max(0.0, -p.z / D))
        # Strata: beds of paler and darker stone, warped, broken.
        warp = _fbm(p.x * 0.11, p.y * 0.11, p.z * 0.05) * 5.0
        bed = math.sin(p.z * 0.95 + warp)
        broken = sstep(0.35, 0.6, _fbm(p.x * 0.2 + 3.0, p.y * 0.2, p.z * 0.4))
        if not fine:
            base = mix(base, ROCK_PALE, sstep(0.45, 0.9, bed) * 0.6 * (0.4 + 0.6 * broken) * (1 - depth * 0.4))
            base = mix(base, ROCK_DARKBED, sstep(-0.45, -0.9, bed) * 0.6 * (0.4 + 0.6 * broken))
            base = mix(base, ROCK_OCHRE, sstep(0.62, 0.8, _fbm(p.x * 0.25, p.y * 0.25, p.z * 0.6)) * 0.35
                       * (1 - depth))
        if not fine:
            # Right under the turf the crag is dark, warm and layered: thin
            # beds a body's height apart, the paler ones catching the light.
            crag = sstep(-8.0, -1.5, p.z)
            layer = math.sin(p.z * 3.1 + _fbm(p.x * 0.3, p.y * 0.3, 0.0) * 2.5)
            base = mix(base, mix(CRAG, CRAG_BED, sstep(0.2, 0.8, layer)), crag * 0.92)
        # Warm under the turf, cooling down the hang to a pale blue-violet;
        # what faces down gets a little lift (it sees only the sky's fill).
        base = mix(base, ROCK_UNDER, depth ** 1.1 * 0.6)
        down = max(0.0, -n.z)
        base = mix(base, ROCK_UNDER, down * 0.3)
        base = tuple(ch * (1.0 + 0.18 * down) for ch in base)
        # Chipped pale crests, cool sunk hollows (carried by the form).
        base = mix(base, ROCK_PALE, max(0.0, c) * (0.25 if p.z > -6.0 else 0.5))
        base = mix(base, (base[0] * 0.7, base[1] * 0.72, base[2] * 0.86), max(0.0, -c) * 0.7)
        if not fine:
            # The lip's soil band under the turf, ragged at its foot.
            foot = -1.1 - 0.9 * _fbm(p.x * 0.5, p.y * 0.5, 2.0)
            soil = sstep(foot - 0.25, foot + 0.2, p.z) * sstep(0.35, -0.2, n.z) * (1 - sstep(-0.05, 0.25, p.z))
            soil *= 0.45 + 0.55 * sstep(0.35, 0.6, _fbm(p.x * 0.8 + 2.0, p.y * 0.8, p.z))
            if soil > 0:
                base = mix(base, mix(SOIL, SOIL_DARK, max(0.0, -n.z)), soil * 0.85)
        # Moss and turf on every ledge that faces the sky.
        up = n.z
        patch = _fbm(p.x * 0.45 + 11.0, p.y * 0.45 - 5.0, p.z * 0.45)
        near_top = sstep(-3.5, -0.4, p.z)
        moss = sstep(0.5, 0.85, up) * sstep(0.45, 0.66, patch + near_top * 0.12)
        if moss > 0:
            base = mix(base, mix(MOSS_DEEP, MOSS, sstep(0.4, 0.7, patch)), min(0.85, moss * (0.8 if not fine else 0.75)))
        # Moss creeping down into the joints near the top (the damp).
        base = mix(base, MOSS_DEEP, max(0.0, -c) * near_top * 0.35 * (0 if fine else 1))
        # Lichen rosettes on the mid faces (sparse, M7).
        ros = sstep(0.82, 0.9, _fbm(p.x * 2.6, p.y * 2.6, p.z * 2.6)) * sstep(-0.3, 0.4, up)
        base = mix(base, LICHEN, ros * 0.45 * (1 - depth))
        # Painted grain round each block (low, M3): a soft drift only.
        k = 0.92 + 0.16 * _fbm(p.x * 0.55 + 1.0, p.y * 0.55, p.z * 0.55)
        return tuple(ch * k for ch in base)

    def _turf(self, p, n, col):
        """Wind-combed turf: sunlit yellow-green and cool blue-green drifts,
        dry straw where it thins, darker where it curls under."""
        a = _fbm(p.x * 0.16 + 2.0, p.y * 0.16, 0.0)
        b = _fbm(p.x * 0.55, p.y * 0.55 + 3.0, p.z)
        base = mix(TURF_COOL, TURF, sstep(0.22, 0.5, a))
        base = mix(base, TURF_SUN, sstep(0.5, 0.78, a) * 0.9)
        base = mix(base, TURF_DRY, sstep(0.6, 0.78, b) * 0.6)
        # Shaped patches (sharp-edged, painted): dry gold where it thins,
        # deep moss in the lee; the sun's side of the walk warmer.
        g = _fbm(p.x * 0.3 + 17.0, p.y * 0.3, 3.0)
        base = mix(base, TURF_DRY, sstep(0.6, 0.66, g) * 0.7)
        base = mix(base, MOSS_DEEP, sstep(0.36, 0.3, g) * 0.6)
        sun = getattr(self, 'sun', None)
        if sun is not None:
            r = math.hypot(p.x, p.y)
            lit = (p.x * sun[0] + p.y * sun[1]) / max(1.0, r) * min(1.0, r / 6.0)
            base = mix(base, TURF_SUN, max(0.0, lit) * 0.35)
            base = mix(base, TURF_COOL, max(0.0, -lit) * 0.35)
        # The turf's own form, painted: its swells lit warm, its hollows cool.
        rise = getattr(self, 'turf_rise', None)
        if rise is not None:
            h = rise(p.x, p.y)
            base = mix(base, TURF_SUN, sstep(0.0, 0.05, h) * 0.5)
            base = mix(base, TURF_COOL, sstep(0.0, -0.05, h) * 0.55)
        m = _fbm(p.x * 0.38 + 9.0, p.y * 0.38, 1.0)
        base = mix(base, MOSS_DEEP, sstep(0.44, 0.24, m) * 0.6)
        base = mix(base, TURF_SUN, sstep(0.6, 0.8, m) * 0.45)
        # Clover-dark clumps and pale seed-heads (medium frequency, M3).
        q = _fbm(p.x * 1.05 + 5.0, p.y * 1.05, 2.0)
        base = mix(base, TURF_COOL, sstep(0.36, 0.22, q) * 0.5)
        base = mix(base, TURF_DRY, sstep(0.7, 0.82, q) * 0.4)
        for (x0, y0, x1, y1, w) in self.worn:
            ex, ey = x1 - x0, y1 - y0
            t = max(0.0, min(1.0, ((p.x - x0) * ex + (p.y - y0) * ey) / (ex * ex + ey * ey)))
            d = math.hypot(p.x - x0 - ex * t, p.y - y0 - ey * t)
            wear = sstep(w * 1.6, w * 0.4, d) * (0.6 + 0.4 * _fbm(p.x * 1.1, p.y * 1.1, 4.0))
            base = mix(base, mix(TURF_DRY, SOIL, 0.55), wear * 0.9)
        # Combed by the gale (soft streaks along the wind's line).
        streak = math.sin((p.x * 0.6 + p.y * 0.8) * 2.2 + b * 4.0)
        base = tuple(ch * (1.0 + 0.06 * streak) for ch in base)
        base = mix(base, col, 0.25)
        # A blade's tip catches the light.
        tip = sstep(0.05, 0.4, p.z) if p.z > 0.03 else 0.0
        base = mix(base, TURF_SUN, tip * 0.5)
        # Curling under the lip: darker, cooler.
        base = mix(base, MOSS_DEEP, max(0.0, -n.z) * 0.7)
        return base

    def _flag(self, p, n, c, col):
        """The Smith's dressed flags: pale, warm and cool by stone, worn
        lighter in the middle, chipped edges, moss in the joints."""
        k = 0.92 + 0.14 * _fbm(p.x * 0.9, p.y * 0.9, 1.0)
        base = tuple(ch * k for ch in col)
        base = mix(base, ROCK_PALE, max(0.0, c) * 0.45)
        base = mix(base, MOSS_DEEP, sstep(0.03, -0.03, p.z) * 0.55)
        lich = sstep(0.78, 0.88, _fbm(p.x * 2.2 + 5.0, p.y * 2.2, 0.0))
        base = mix(base, LICHEN, lich * 0.35)
        return base


# ---- the sculpt -----------------------------------------------------------------------
def _hang_r(z, D, crown):
    """The main crag's radius at depth z (under the crown to the point)."""
    t = min(1.0, max(0.0, (-z - 2.0) / (D - 2.0)))
    return (crown - 0.8) * (1.0 - t) ** 1.75 + 0.45


def _hang_c(z, D, lean):
    t = min(1.0, max(0.0, (-z - 2.0) / (D - 2.0)))
    return lean[0] * t * t * 4.0, lean[1] * t * t * 4.0


def _spire(f, rng, top, tip, r0, label='g1'):
    """A hanging fang: a tapered spine and torn blocks round it."""
    pts = []
    for k in range(6):
        t = k / 5
        pts.append((top[0] + (tip[0] - top[0]) * t ** 1.4, top[1] + (tip[1] - top[1]) * t ** 1.4,
                    top[2] + (tip[2] - top[2]) * t))
    radii = [r0 * (1 - t / 5) ** 1.3 + 0.3 for t in range(6)]
    f.put(label, Polyline(pts, radii), 0.7)
    for k in range(1, 4):
        q = pts[k]
        rr = radii[k]
        a = float(rng.uniform(0, TAU))
        f.put('g3', block(rng, (q[0] + math.cos(a) * rr * 0.5, q[1] + math.sin(a) * rr * 0.5, q[2]),
                          (rr * 1.3, rr * 1.1, rr * 2.4), cuts=9, chamfer=(0.72, 0.93),
                          R=rot(rz=a, ry=float(rng.uniform(-0.2, 0.2)))), 0.45)


def _satellite(f, rng, at, top, size, depth):
    """A small isle torn off beside the great one: a rounded crown flat on
    top, a short fang under it."""
    x, y = at
    f.put('g0', Ellipsoid((x, y, top - size * 0.35), (size, size * 0.85, size * 0.55),
                          rot(rz=float(rng.uniform(0, TAU)))), 0.4)
    for k in range(4):
        a = TAU * k / 4 + float(rng.uniform(-0.3, 0.3))
        s = size * float(rng.uniform(0.55, 0.8))
        f.put('g4', block(rng, (x + math.cos(a) * size * 0.55, y + math.sin(a) * size * 0.5, top - size * 0.5),
                          (s, s * 0.8, size * 0.9), cuts=9, chamfer=(0.72, 0.93), R=rot(rz=a)), 0.35)
    lx, ly = rng.uniform(-0.6, 0.6, 2)
    tip = (x + float(lx) * size * 0.5, y + float(ly) * size * 0.5, top - depth)
    f.put('g3', Polyline([(x, y, top - size * 0.5), (x + float(lx) * size * 0.2, y + float(ly) * size * 0.2,
                                                     top - depth * 0.55), tip],
                         [size * 0.75, size * 0.42, 0.12]), 0.5)
    return tip


def _isle_field(S, walk, rng):
    D = S['depth']
    crown = S['crown']
    lean = S['lean']
    f = Sculpt((-20.0, -20.0, -D - 4.0), (20.0, 20.0, 4.5), 0.22)
    X, Y, Z = _axes(f)
    # The crown: a rounded mass under the walk, its belly bulging past the
    # rim, ringed by great blocks (a broken round, never a slab's corners).
    f.put('g0', Ellipsoid((0.0, 0.0, -2.8), (crown - 3.6, crown - 3.8, 2.8)), 0.6)
    for k in range(15):
        a = TAU * k / 15 + float(rng.uniform(-0.15, 0.15))
        r = float(rng.uniform(6.8, crown - 1.4))
        s = float(rng.uniform(3.4, 5.0))
        f.put(('g0', 'g5', 'g2', 'g4')[k % 4], block(
            rng, (math.cos(a) * r, math.sin(a) * r, -2.2 - float(rng.uniform(0, 1.6))), (s, s * 0.8, 4.0),
            cuts=11, chamfer=(0.86, 0.98),
            R=rot(rz=a + float(rng.uniform(-0.4, 0.4)), rx=float(rng.uniform(-0.2, 0.2)))), 0.22)
    # The hang: a leaning spine tapering to the point, torn columns round it
    # leaning in with the taper, their feet staggered down the crag.
    spine = []
    for k in range(8):
        z = -2.0 - (D - 2.0) * (k / 7) ** 0.85
        cx, cy = _hang_c(z, D, lean)
        spine.append((cx, cy, z))
    f.put('g1', Polyline(spine, [_hang_r(q[2], D, crown) * 0.82 for q in spine[:-1]] + [0.3]), 0.9)
    slope = math.atan((crown - 0.8) * 1.35 / (D - 2.0))
    tiers = ((-4.6, 7.0, 13, ('g4', 'g0', 'g5')), (-8.4, 7.0, 11, ('g1', 'g4', 'g0')),
             (-12.4, 6.0, 9, ('g1', 'g3', 'g4')), (-16.2, 5.0, 6, ('g3', 'g1')), (-19.4, 3.6, 4, ('g3',)))
    for (z0, h, n, tones) in tiers:
        if -z0 > D - 2.5:
            continue
        off = float(rng.uniform(0, TAU))
        for j in range(n):
            a = off + TAU * j / n + float(rng.uniform(-0.25, 0.25))
            z = z0 + float(rng.uniform(-1.5, 1.5))
            hh = h * float(rng.uniform(0.7, 1.3))
            r = _hang_r(z, D, crown) * float(rng.uniform(0.66, 0.84))
            cx, cy = _hang_c(z, D, lean)
            w = max(1.2, _hang_r(z, D, crown) * float(rng.uniform(0.34, 0.5)))
            f.put(tones[j % len(tones)], block(
                rng, (cx + math.cos(a) * r, cy + math.sin(a) * r, z), (w, w * 0.78, hh), cuts=10,
                chamfer=(0.72, 0.93),
                R=rot(rz=a + float(rng.uniform(-0.25, 0.25)), ry=slope * float(rng.uniform(0.75, 1.15)),
                      rx=float(rng.uniform(-0.12, 0.12)))), 0.45)
    tip = (lean[0] * 4.0, lean[1] * 4.0, -D)
    f.put('g3', Polyline([(lean[0] * 1.8, lean[1] * 1.8, -D * 0.62), (tip[0] * 0.92, tip[1] * 0.92, -D + 2.6), tip],
                         [2.2, 1.1, 0.22]), 0.6)
    # The lesser spires beside it (their own fangs, a cleft between).
    tips = [tip]
    for (frac, (ox, oy), width) in S['spires']:
        top = (ox * 0.55, oy * 0.55, -4.5)
        sp = (ox, oy, -D * frac - 2.0)
        _spire(f, rng, top, sp, 2.6 * width + 1.0, 'g4')
        tips.append(sp)
    # Shelves jutting from the flank (overhangs that break the taper, their
    # tops mossed).
    for (a, z, reach) in S['ledges']:
        r = _hang_r(z, D, crown)
        cx, cy = _hang_c(z, D, lean)
        c = (cx + math.cos(a) * (r + reach * 0.35), cy + math.sin(a) * (r + reach * 0.35), z)
        f.put('g5', block(rng, c, (reach * 1.5, reach * 1.1, 1.8), cuts=10, chamfer=(0.75, 0.94),
                          R=rot(rz=a, ry=0.08), top_tilt=0.05), 0.4)
        f.put('g1', Polyline([(c[0], c[1], z - 0.6), (c[0] * 0.92, c[1] * 0.92, z - 3.2)], [reach * 0.55, 0.3]), 0.5)
    # Spalls broken out of the flanks.
    for _ in range(8):
        a = float(rng.uniform(0, TAU))
        z = float(rng.uniform(-D * 0.72, -4.0))
        cx, cy = _hang_c(z, D, lean)
        r = _hang_r(z, D, crown) + 0.8
        f.sub(Ellipsoid((cx + math.cos(a) * r, cy + math.sin(a) * r, z), (1.6, 1.2, 1.7), rot(rz=a)), 0.4)
    # The gale's polish over the whole crag: a broad swell, flutes down it.
    n1 = Noise(S['seed'])

    def swell(Xs, Ys, Zs):
        cross = Xs * 0.8 + Ys * 0.6
        return (0.55 * n1.fbm(Xs * 0.2, Ys * 0.2, Zs * 0.16, 3)
                + 0.2 * np.sin(cross * 2.6 + n1.fbm(Xs * 0.1, Ys * 0.1, Zs * 0.05, 2) * 3.0))
    f.displace(swell, band=1.2)
    # The walk: flat at z -0.06 inside the sim's polygon (the turf cap lies on
    # it), the lip rounding down outside it into the belly.
    sd = poly_sd(walk, f.axes[0][:, None], f.axes[1][None, :])[:, :, None]
    out = np.maximum(sd, 0.0)
    f.d = np.maximum(f.d, (Z + 0.06 + out * 2.0 + out * out * 0.1).astype(np.float32))
    # The lip's beds cut sharp into the crown (horizontal joints under the turf).
    joints = (np.abs(np.sin((Z + 0.35) * 2.4 + 0.0 * X)) > 0.92) & (sd > 0.05) & (Z < -0.5) & (Z > -5.0)
    f.d = np.where(joints, f.d + 0.12, f.d)
    # Under the lip, the crag in beds (laid after the lip's fall, so they
    # stand proud of it): flat-topped slabs stepping out round the crown in
    # courses (never a smooth drum under the turf).
    for course, (z0, out0, th) in enumerate(((-1.0, 0.15, 1.0), (-2.2, 0.7, 1.1), (-3.4, 1.1, 1.2),
                                             (-4.7, 0.9, 1.3))):
        n = 20 - course * 3
        off = float(rng.uniform(0, TAU))
        for k in range(n):
            a = off + TAU * k / n + float(rng.uniform(-0.08, 0.08))
            r = edge_r(walk, a) + out0 * float(rng.uniform(0.6, 1.3)) - 0.6
            w = float(rng.uniform(1.6, 2.6))
            f.put(('g5', 'g0', 'g4')[k % 3], block(
                rng, (math.cos(a) * r, math.sin(a) * r, z0 - float(rng.uniform(0, 0.3))),
                (1.6 + out0, w, th * float(rng.uniform(0.8, 1.15))), cuts=6, chamfer=(0.9, 0.99),
                R=rot(rz=a + float(rng.uniform(-0.15, 0.15)), ry=float(rng.uniform(-0.06, 0.06)))), 0.12)
    # A finer grain over everything under the lip (never the walk).
    n2 = Noise(S['seed'] + 7)

    def grain(Xs, Ys, Zs):
        k = np.clip((-Zs - 0.8) / 1.5, 0.0, 1.0)
        return k * 0.16 * n2.fbm(Xs * 0.7, Ys * 0.7, Zs * 0.5, 2)
    f.displace(grain, band=0.6)
    # Satellites, outcrops under the rim's dressing (both after the walk's cut).
    sat_tips = []
    for (a, r, top, size, depth) in S['sats']:
        at = (math.cos(a) * r, math.sin(a) * r)
        sat_tips.append(_satellite(f, rng, at, top, size, depth))
        # Its top flat (a small walk of turf).
        near = ((X - at[0]) ** 2 + (Y - at[1]) ** 2 < (size * 1.8) ** 2) + 0 * Z
        f.d = np.where(near, np.maximum(f.d, (Z - top).astype(np.float32)), f.d)
    outcrops = list(S['stones'])
    if S['arch']:
        outcrops += list(S['arch'])
    if S['tree'] is not None:
        outcrops.append(S['tree'])
    for a in outcrops:
        x, y, _ = edge_pt(walk, a, 1.55)
        f.put('g2', block(rng, (x, y, -1.45), (2.6, 2.3, 1.8), cuts=9, chamfer=(0.76, 0.93), R=rot(rz=a)), 0.3)
    # Strata cut round part of the hang (tilted, broken, never a level ring).
    for k in range(4):
        z = -4.2 - k * (D - 7.0) / 4.0
        tilt = float(rng.uniform(-0.14, 0.14))
        a0 = float(rng.uniform(0, TAU))
        cx, cy = _hang_c(z, D, lean)
        arc = []
        for a in np.linspace(a0, a0 + TAU * float(rng.uniform(0.35, 0.6)), 22):
            w = _hang_r(z, D, crown) * 1.1
            arc.append((cx + math.cos(a) * w, cy + math.sin(a) * w, z + tilt * w * math.cos(a - a0)))
        f.groove(Polyline(_on_surface(f, arc), 0.02), 0.2, 0.16)
    # The belly's beds: two broken ledges stepped round under the lip, so the
    # crown reads as layered stone (never one rounded loaf).
    for z0 in (-1.9, -3.4):
        a0 = float(rng.uniform(0, TAU))
        arc = []
        for a in np.linspace(a0, a0 + TAU * float(rng.uniform(0.45, 0.7)), 26):
            r = edge_r(walk, a) + 1.2 + (-z0 - 1.9) * 0.9
            arc.append((math.cos(a) * r, math.sin(a) * r, z0 + 0.25 * math.sin(a * 3.0 + z0)))
        f.groove(Polyline(_on_surface(f, arc), 0.02), 0.32, 0.22)
    # Nothing of the rock over the walk, whatever the outcrops did.
    inside_walk = (sd < 0.25) & (Z > -0.06)
    f.d = np.where(inside_walk, np.maximum(f.d, 0.05), f.d)
    # And the lip's own fall again just past it (an outcrop never makes a
    # floor-high ledge by the edge).
    near_lip = (sd < 1.0) & (Z > -0.5)
    f.d = np.where(near_lip, np.maximum(f.d, (Z + 0.06 + out * 2.0).astype(np.float32)), f.d)
    f.cut_below(-D - 2.5)
    return f, tips, sat_tips


# ---- the walk's cap -------------------------------------------------------------------
def _cap(p, walk, rng, rise):
    """The turf cap: the sim's polygon exactly, triangulated fine enough to
    carry its paint, swelling gently (`rise`: a few centimetres, nothing at
    its edge, on the shrine's floor or under a foot's snap tolerance), and
    a thick earthen lip curling over its edge, overhanging raggedly, roots
    dangling out of the soil."""
    from mathutils.geometry import delaunay_2d_cdt
    bm = p.bm
    edge, nrm = resample(walk, 0.5)
    pts = [Vector((x, y)) for (x, y) in edge]
    nb = len(pts)
    step = 0.74
    for i in range(-16, 17):
        for j in range(-16, 17):
            x = i * step + (j % 2) * step * 0.5 + float(rng.uniform(-0.12, 0.12))
            y = j * step * 0.88 + float(rng.uniform(-0.12, 0.12))
            if inside(walk, x, y, 0.28):
                pts.append(Vector((x, y)))
    edges = [(i, (i + 1) % nb) for i in range(nb)]
    out = delaunay_2d_cdt(pts, edges, [], 0, 1e-5)
    vco, _, fcs = out[0], out[1], out[2]
    vs = [bm.verts.new((v.x, v.y, rise(v.x, v.y))) for v in vco]
    made = []
    for poly in fcs:
        c = Vector((0.0, 0.0))
        for i in poly:
            c += vco[i]
        c /= len(poly)
        if not inside(walk, c.x, c.y, -0.01):
            continue
        try:
            made.append(bm.faces.new([vs[i] for i in poly]))
        except ValueError:
            pass
    with p.as_kind(TURF_K):
        p._paint(made, TURF, STONE)
    p.facing(made, (0, 0, 1))
    # The lip: four rings down and out round the edge (ragged, never past
    # 0.16 of the walk), its foot tucked into the rock.
    n2 = Noise(int(rng.integers(1, 9999)))
    rings = []
    lip = ((0.0, 0.0), (0.11, -0.12), (0.32, -0.4), (0.18, -0.78), (-0.3, -1.05))
    for k, (o, z) in enumerate(lip):
        ring = []
        for (x, y), (nx, ny) in zip(edge, nrm):
            w = float(n2.fbm(np.array([x * 0.55]), np.array([y * 0.55]), np.array([0.3]), 2)[0])
            v = float(n2.fbm(np.array([x * 1.7]), np.array([y * 1.7]), np.array([2.1]), 2)[0])
            notch = 0.45 if v > 0.68 else 1.0
            oo = o * (0.35 + 1.0 * w + 0.35 * v) * notch if 0 < k < len(lip) - 1 else o
            zz = z * (0.65 + 0.9 * w + 0.4 * v) if 1 < k < len(lip) - 1 else z
            ring.append(bm.verts.new((x + nx * oo, y + ny * oo, zz)))
        rings.append(ring)
    lip_turf, lip_soil = [], []
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(nb):
            f = bm.faces.new((a[i], b[i], b[(i + 1) % nb], a[(i + 1) % nb]))
            (lip_turf if k < 2 else lip_soil).append(f)
    with p.as_kind(TURF_K):
        p._paint(lip_turf, TURF, STONE)
    with p.as_kind(SOIL_K):
        p._paint(lip_soil, SOIL, STONE)
    for f in lip_turf + lip_soil:
        f.smooth = True
    centre = Vector((0.0, 0.0, 1.5))
    p.facing(lip_turf + lip_soil, lambda c: Vector((c.x, c.y, 0.0)).normalized() + Vector((0, 0, 0.35))
             if Vector((c.x, c.y, 0)).length > 1e-3 else centre)
    # Clods of earth bulging out of the lip, the turf's roots holding them.
    with p.as_kind(SOIL_K):
        for i in range(2, nb, 7):
            q = rings[3][i].co
            nx, ny = nrm[i]
            s = float(rng.uniform(0.45, 0.85))
            crystal(p, (q.x + nx * s * 0.2, q.y + ny * s * 0.2, q.z - s * 0.55), (s * 1.3, s, s * 0.9),
                    p.vary(SOIL, 0.1), n=9, boxy=0.45, jitter=0.25, yaw=math.atan2(ny, nx))
    # Rootlets dangling out of the soil under the lip.
    with p.as_kind(WOOD):
        for i in range(0, nb, 3):
            if (i // 9) % 2 or rng.uniform(0, 1) < 0.2:
                continue
            q = rings[3][i].co
            nx, ny = nrm[i]
            L = float(rng.uniform(0.4, 1.4))
            sw = float(rng.uniform(-0.25, 0.25))
            pts = [(q.x, q.y, q.z), (q.x + nx * 0.15 - ny * sw * 0.3, q.y + ny * 0.15 + nx * sw * 0.3, q.z - L * 0.4),
                   (q.x + nx * 0.2 - ny * sw, q.y + ny * 0.2 + nx * sw, q.z - L)]
            p.sweep(smooth_path(pts, 2), float(rng.uniform(0.04, 0.07)), 0.012, p.vary(ROOT, 0.1), sides=3)
    return edge, nrm


def _flagstone(p, outline, rng, color, top=0.03, bevel=0.1):
    """One dressed flag lying in the turf: its top a hair over the walk, its
    chamfer dipping under the turf (a crisp line, never a coplanar fight)."""
    bm = p.bm
    c = Vector((0.0, 0.0))
    for q in outline:
        c += Vector(q)
    c /= len(outline)
    tilt = (float(rng.uniform(-0.015, 0.015)), float(rng.uniform(-0.015, 0.015)))
    # Each stone sits its own way in the turf (a little sunk, a little
    # turned): worn into the ground, never laid by a ruler.
    top = top - float(rng.uniform(0.0, 0.015))
    turn = float(rng.uniform(-0.05, 0.05))
    outline = [(c.x + (q[0] - c.x) * math.cos(turn) - (q[1] - c.y) * math.sin(turn),
                c.y + (q[0] - c.x) * math.sin(turn) + (q[1] - c.y) * math.cos(turn)) for q in outline]
    lo, hi = [], []
    for q in outline:
        v = Vector(q)
        d = v - c
        inner = c + d * max(0.0, 1.0 - bevel / max(1e-3, d.length))
        lo.append(bm.verts.new((v.x, v.y, -0.04)))
        z = top + tilt[0] * (inner.x - c.x) + tilt[1] * (inner.y - c.y)
        hi.append(bm.verts.new((inner.x, inner.y, z)))
    faces = [bm.faces.new(hi)]
    n = len(outline)
    for i in range(n):
        faces.append(bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i])))
    with p.as_kind(FLAG_K):
        p._paint(faces, p.vary(color, 0.06), STONE)
    p.facing(faces, (0, 0, 1))
    return faces


def _arc_stone(c, r0, r1, a0, a1, steps=3):
    out = []
    for k in range(steps + 1):
        a = a0 + (a1 - a0) * k / steps
        out.append((c[0] + math.cos(a) * r1, c[1] + math.sin(a) * r1))
    for k in range(steps, -1, -1):
        a = a0 + (a1 - a0) * k / steps
        out.append((c[0] + math.cos(a) * r0, c[1] + math.sin(a) * r0))
    return out


def _shrine_floor(p, walk, pads, rng):
    """The ruined wind shrine's floor: the broken ring of curved flags under
    the rune ring, the Homeward Gale's dais in a gap of it (toward the
    Cornice), stepping flags from the dais to the landing and on to the
    middle's wind stone."""
    home = pads['home']
    land = pads['land']
    tones = (FLAG, FLAG_WARM, FLAG_COOL)
    # The ring: old flags round the rune ring, each its own size, outline and
    # turn, a third of them lost to the turf (never a ruled band).
    n = 26
    for k in range(n):
        am = TAU * k / n + float(rng.uniform(-0.05, 0.05))
        rm = (RING_IN + RING_OUT) / 2 + float(rng.uniform(-0.35, 0.3))
        cx, cy = math.cos(am) * rm, math.sin(am) * rm
        if math.hypot(cx - home[0], cy - home[1]) < PAD_R + 0.9:
            continue
        if rng.uniform(0, 1) < 0.33:
            continue
        L = float(rng.uniform(0.75, 1.35))
        W = float(rng.uniform(0.6, 1.05))
        turn = am + math.pi / 2 + float(rng.uniform(-0.25, 0.25))
        outline = []
        for j in range(6):
            b = TAU * j / 6 + float(rng.uniform(-0.25, 0.25))
            r = 1.0 + float(rng.uniform(-0.18, 0.12))
            u, v = math.cos(b) * L / 2 * r, math.sin(b) * W / 2 * r
            outline.append((cx + u * math.cos(turn) - v * math.sin(turn), cy + u * math.sin(turn) + v * math.cos(turn)))
        if not all(inside(walk, x, y, 0.3) for (x, y) in outline):
            continue
        _flagstone(p, outline, rng, tones[k % 3], top=float(rng.uniform(0.018, 0.04)))
    # The dais: a round of wedge stones round a centre stone, carved with the
    # wind's five arms (the Gale's own sign); its far stones lost over the edge.
    centre = Vector(home)
    inner = 0.95
    core = [(home[0] + math.cos(TAU * j / 10) * inner, home[1] + math.sin(TAU * j / 10) * inner)
            for j in range(10)]
    _flagstone(p, core, rng, FLAG_WARM, top=0.06)
    # The dais's wedges, then a kerb of small dressed blocks round its rim
    # (gaps between, a few lost): an old shrine's floor, worn at its edges.
    spin = float(rng.uniform(0, TAU))
    lost = set(int(x) for x in rng.choice(9, 2, replace=False))
    for j in range(9):
        a0 = spin + TAU * j / 9 + 0.03 + float(rng.uniform(-0.04, 0.04))
        a1 = spin + TAU * (j + 1) / 9 - 0.03 + float(rng.uniform(-0.04, 0.04))
        if j in lost:
            # One lost to the turf, one cracked across and sunk.
            if j == min(lost):
                continue
            mid = (a0 + a1) / 2
            _flagstone(p, _arc_stone(home, inner + 0.08, PAD_R - 0.55, a0, mid - 0.03, 2), rng, FLAG, top=0.02)
            _flagstone(p, _arc_stone(home, inner + 0.12, PAD_R - 0.6, mid + 0.03, a1, 2), rng, FLAG_COOL,
                       top=0.012)
            continue
        outline = _arc_stone(home, inner + 0.08, PAD_R - 0.55, a0, a1, steps=3)
        if not all(inside(walk, x, y, 0.12) for (x, y) in outline):
            continue
        _flagstone(p, outline, rng, FLAG if j % 2 else FLAG_WARM, top=0.035)
    for j in range(16):
        a0 = TAU * j / 16 + 0.04
        a1 = TAU * (j + 1) / 16 - 0.04
        outline = _arc_stone(home, PAD_R - 0.45, PAD_R, a0, a1, steps=2)
        if rng.uniform(0, 1) < 0.15 or not all(inside(walk, x, y, 0.12) for (x, y) in outline):
            continue
        _flagstone(p, outline, rng, FLAG_COOL if j % 3 else FLAG, top=0.018)
    # The Gale's sign cut in the dais: five arms wheeling out from its centre
    # stone, the vein's light in their grooves (KitGlow, low: the fight's
    # disc burns over it when the Gale opens).
    with p.as_kind(PAINT):
        for j in range(5):
            a = TAU * j / 5 + 0.3
            pts = []
            for t in np.linspace(0.0, 1.0, 6):
                r = inner + 0.12 + (PAD_R - 0.75 - inner - 0.12) * t
                b = a + t * 1.15
                pts.append((home[0] + math.cos(b) * r, home[1] + math.sin(b) * r))
            for i, ((x0, y0), (x1, y1)) in enumerate(zip(pts, pts[1:])):
                if not (inside(walk, x0, y0, 0.25) and inside(walk, x1, y1, 0.25)):
                    break
                z = 0.052
                dx, dy = x1 - x0, y1 - y0
                L = math.hypot(dx, dy)
                w = 0.075 * (1.0 - 0.5 * i / 5)
                sx, sy = -dy / L * w, dx / L * w
                hull(p, [(x0 + sx, y0 + sy, z), (x0 - sx, y0 - sy, z), (x1 + sx * 0.8, y1 + sy * 0.8, z),
                         (x1 - sx * 0.8, y1 - sy * 0.8, z), ((x0 + x1) / 2, (y0 + y1) / 2, z + 0.01)],
                     p.vary(BREATH_GLOW, 0.05), mat=GLOW)
    # Stepping flags from the dais in past the landing to the wind stone.
    d = Vector((-home[0], -home[1]))
    L = d.length
    d.normalize()
    side = Vector((-d.y, d.x))
    for k, t in enumerate((PAD_R + 0.55, PAD_R + 1.55, L - 1.9)):
        q = centre + d * t + side * float(rng.uniform(-0.25, 0.25))
        if (q - centre).length > L - 1.6:
            continue
        s = float(rng.uniform(0.45, 0.8))
        yaw = float(rng.uniform(0, TAU))
        sides = int(rng.integers(5, 8))
        outline = [(q.x + math.cos(yaw + TAU * j / sides) * s * float(rng.uniform(0.75, 1.15)),
                    q.y + math.sin(yaw + TAU * j / sides) * s * float(rng.uniform(0.6, 1.0)))
                   for j in range(sides)]
        _flagstone(p, outline, rng, tones[k % 3])
    # The landing's mark: a worn round where the wind sets a body down.
    outline = [(land[0] + math.cos(TAU * j / 8) * 0.7, land[1] + math.sin(TAU * j / 8) * 0.7) for j in range(8)]
    _flagstone(p, outline, rng, FLAG_COOL, top=0.035)
    # The middle's wind stone: a round with four arms cut in it.
    outline = [(math.cos(TAU * j / 12) * 1.25, math.sin(TAU * j / 12) * 1.25) for j in range(12)]
    _flagstone(p, outline, rng, FLAG_WARM, top=0.05)
    with p.as_kind(PAINT):
        for j in range(3):
            a = TAU * j / 3 + 0.4
            pts = [(math.cos(a + t * 1.6) * (0.2 + 0.8 * t), math.sin(a + t * 1.6) * (0.2 + 0.8 * t))
                   for t in np.linspace(0.0, 1.0, 5)]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                dx, dy = x1 - x0, y1 - y0
                L = math.hypot(dx, dy)
                sx, sy = -dy / L * 0.05, dx / L * 0.05
                hull(p, [(x0 + sx, y0 + sy, 0.052), (x0 - sx, y0 - sy, 0.052), (x1 + sx, y1 + sy, 0.052),
                         (x1 - sx, y1 - sy, 0.052), ((x0 + x1) / 2, (y0 + y1) / 2, 0.062)],
                     p.vary(BREATH_GLOW, 0.05), mat=GLOW)


# ---- dressing -------------------------------------------------------------------------
def _tuft(p, c, h, rng, blades=5, tone=TURF_SUN):
    """A tuft of wind-combed grass (thin three-sided blades leaning with
    the gale)."""
    lean = float(rng.uniform(0, TAU))
    with p.as_kind(TURF_K):
        for _ in range(blades):
            a = float(rng.uniform(0, TAU))
            rr = float(rng.uniform(0.0, 0.18))
            hh = h * float(rng.uniform(0.6, 1.1))
            base = (c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, c[2] - 0.03)
            ld = 0.35 + float(rng.uniform(0, 0.3))
            p.spike(base, float(rng.uniform(0.045, 0.07)), hh, p.vary(tone, 0.1), sides=3,
                    lean=(math.cos(lean + a * 0.2) * ld * hh, math.sin(lean + a * 0.2) * ld * hh), phase=a)


def _rune_stone(p, base, a, h, rng, broken=False):
    """A wind-rune standing stone on the rim: a thick leaning slab, its cap,
    glowing runes up its inner face, a crystal in its crown."""
    x, y, z0 = base
    lean = 0.08 + float(rng.uniform(0, 0.16))
    roll = float(rng.uniform(-0.12, 0.12))
    yaw = a + float(rng.uniform(-0.25, 0.25))
    hh = h * (0.55 if broken else 1.0)
    with p.as_kind(DRESSED):
        # A body of two dressed courses, the upper narrower and turned a
        # little, chipped at its corners: carved and weathered, never a box.
        slab(p, (x + math.cos(a) * hh * lean * 0.3, y + math.sin(a) * hh * lean * 0.3, z0 + hh * 0.33),
             (1.25, 1.85, hh * 0.72), p.vary(ROCK_WARM, 0.06), yaw=yaw, pitch=lean, roll=roll, chamfer=0.34,
             jitter=0.2)
        slab(p, (x + math.cos(a) * hh * lean * 0.7, y + math.sin(a) * hh * lean * 0.7, z0 + hh * 0.75),
             (1.0, 1.5, hh * 0.5), p.vary(ROCK_PALE, 0.06), yaw=yaw + float(rng.uniform(-0.12, 0.12)),
             pitch=lean, roll=roll, chamfer=0.38, jitter=0.22)
        # Chips knocked off it, at its foot.
        for _ in range(2):
            b = a + float(rng.uniform(-1.6, 1.6))
            crystal(p, (x + math.cos(b) * 1.2, y + math.sin(b) * 1.2, z0 - 0.05),
                    (0.55, 0.42, 0.3), p.vary(ROCK_WARM, 0.08), n=9, boxy=0.5, jitter=0.25,
                    yaw=float(rng.uniform(0, TAU)), floor=z0 - 0.25)
        if not broken:
            slab(p, (x + math.cos(a) * hh * lean, y + math.sin(a) * hh * lean, z0 + hh + 0.15),
                 (1.35, 2.0, 0.5), p.vary(STORM, 0.06), yaw=yaw, pitch=lean, chamfer=0.32, jitter=0.12)
        else:
            # The broken top lies at its foot.
            slab(p, (x - math.sin(a) * 1.4, y + math.cos(a) * 1.4, z0 - 0.25), (1.0, 2.0, 0.7),
                 p.vary(ROCK_WARM, 0.06), yaw=a + 1.2, pitch=0.55, chamfer=0.28, jitter=0.15)
    ix, iy = -math.cos(a), -math.sin(a)
    with p.as_kind(PAINT):
        # Rune grooves cut up its inner face, the vein's light in them: each
        # glyph a stem and a slanted bar (never a plain diamond).
        for j in range(5 if not broken else 3):
            z = z0 + 0.8 + j * 0.62
            cx = x + ix * 0.64 + math.cos(a) * (z - z0) * lean
            cy = y + iy * 0.64 + math.sin(a) * (z - z0) * lean
            sx, sy = -math.sin(yaw), math.cos(yaw)
            bar = 0.26 if j % 2 else -0.26
            for (u0, v0, u1, v1) in ((0.0, -0.26, 0.0, 0.26), (-0.24, bar * 0.4, 0.24, bar * 0.4 + 0.2)):
                pts = []
                for (u, v) in ((u0, v0), (u1, v1)):
                    for e in (-0.05, 0.05):
                        pts.append((cx + sx * (u + e), cy + sy * (u + e), z + v))
                pts.append((cx + sx * (u0 + u1) / 2 + ix * 0.05, cy + sy * (u0 + u1) / 2 + iy * 0.05,
                            z + (v0 + v1) / 2))
                hull(p, pts, p.vary(BREATH_CORE, 0.04), mat=GLOW)
        if not broken:
            facet_crystal(p, (x + math.cos(a) * hh * lean, y + math.sin(a) * hh * lean, z0 + hh + 0.3),
                          (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.0), float(rng.uniform(1.0, 1.5)), 0.24,
                          p.vary(BREATH_GLOW, 0.05))
    return (x + ix * 0.6, y + iy * 0.6, z0 + 2.0)


def _drum_pillar(p, base, h, r, rng, broken=0.0, tilt=(0.0, 0.0)):
    """A pillar of chamfered drums (octagonal, turned a little each, each
    a little worn), settled out of true by `tilt` (yards of lean per yard
    up), its top broken off when `broken`."""
    x, y, z = base
    p.prism((x, y, z - 0.3), 8, r * 1.45, r * 1.3, 0.75, p.vary(STORM_PALE, 0.05), phase=0.2)
    cur = z + 0.45
    top = z + h * (1 - broken)
    k = 0
    while cur < top - 0.2:
        dh = min(float(rng.uniform(1.0, 1.4)), top - cur)
        ph = float(rng.uniform(0, 0.4))
        up = cur - z
        off = (float(rng.uniform(-0.07, 0.07)) + tilt[0] * up, float(rng.uniform(-0.07, 0.07)) + tilt[1] * up)
        rr = r * float(rng.uniform(0.88, 1.0))
        p.prism((x + off[0], y + off[1], cur), 7, rr, rr * 0.93, dh - 0.07, p.vary(ROCK_PALE, 0.06), phase=ph,
                lean=(tilt[0] * dh, tilt[1] * dh))
        cur += dh
        k += 1
    if broken:
        for _ in range(3):
            a = float(rng.uniform(0, TAU))
            p.spike((x + math.cos(a) * r * 0.4, y + math.sin(a) * r * 0.4, cur - 0.05), r * 0.5,
                    r * float(rng.uniform(0.5, 1.1)), p.vary(STORM_PALE, 0.05), sides=4)
    return cur


def _broken_arch(p, walk, a0, a1, rng):
    """A broken arch of the wind shrine on the rim, past the walk: two
    pillars, the arch's voussoirs on one side, the rest fallen."""
    pa = edge_pt(walk, a0, 1.35, -1.0)
    pb = edge_pt(walk, a1, 1.35, -1.0)
    with p.as_kind(DRESSED):
        ta = _drum_pillar(p, pa, 5.0, 0.5, rng)
        tb = _drum_pillar(p, pb, 5.0, 0.5, rng)
        # A third pillar fallen out of true beside them, its top broken.
        c = edge_pt(walk, a1 + (a1 - a0) * 0.9, 1.5, -1.0)
        _drum_pillar(p, c, 3.6, 0.45, rng, broken=0.2, tilt=(math.cos(a1) * 0.09, math.sin(a1) * 0.09))
        # The arch's springers on both pillars, its crown fallen.
        A = Vector(pa[:2])
        B = Vector(pb[:2])
        span = (B - A).length
        u = (B - A).normalized()
        rise = span * 0.55
        mark = p.mark()
        top = min(ta, tb)
        p.box((0.0, 0.0, top + 0.2), (1.4, 1.3, 0.4), p.vary(STORM, 0.05), bevel=0.08)
        p.box((span, 0.0, top + 0.2), (1.4, 1.3, 0.4), p.vary(STORM, 0.05), bevel=0.08)
        p.voussoir_arch(span, top + 0.4, rise, 0.75, 0.95, STORM_PALE, pointed=False, blocks=9, broken=0.0,
                        center=(span / 2, 0.0, 0.0), keep=(0, 1, 2, 7, 8))
        ang = math.atan2(u.y, u.x)
        p.turn(mark, Matrix.Translation((pa[0], pa[1], 0.0)) @ Matrix.Rotation(ang, 4, 'Z'))
        # The fallen voussoirs on the outcrop below the broken pillar.
        for k in range(2):
            q = B + u * (0.6 + k * 0.8) + Vector((-u.y, u.x)) * float(rng.uniform(-0.6, 0.6))
            slab(p, (q.x, q.y, -0.95 + k * 0.1), (1.1, 0.8, 0.6), p.vary(STORM_PALE, 0.06),
                 yaw=float(rng.uniform(0, TAU)), pitch=float(rng.uniform(-0.3, 0.3)), chamfer=0.25)
    return (pa, pb, ta, tb)


def _tree(p, base, a, rng):
    """A wind-bent tree on the rim, leaning away from the gale: a twisted
    trunk, three limbs, clumps of foliage combed out downwind."""
    x, y, z = base
    out = Vector((math.cos(a), math.sin(a), 0.0))
    side = Vector((-out.y, out.x, 0.0))
    trunk = [Vector((x, y, z - 0.4)), Vector((x, y, z + 0.8))]
    for k in range(1, 5):
        t = k / 4
        q = Vector((x, y, z + 0.8)) + out * (t * t * 2.4) + side * math.sin(t * 2.4) * 0.5 \
            + Vector((0, 0, t * 4.2))
        trunk.append(q)
    trunk = [Vector(q) for q in smooth_path([tuple(q) for q in trunk], 3)]
    with p.as_kind(WOOD):
        p.sweep([tuple(q) for q in trunk], 0.55, 0.16, p.vary(BARK, 0.05), sides=7)
        # Roots gripping the outcrop.
        for k in range(4):
            b = TAU * k / 4 + float(rng.uniform(-0.3, 0.3))
            d = Vector((math.cos(b), math.sin(b), 0.0))
            pts = [trunk[1] - Vector((0, 0, 0.4)), trunk[0] + d * 0.9 + Vector((0, 0, 0.1)),
                   trunk[0] + d * 1.7 - Vector((0, 0, 0.6))]
            p.sweep([tuple(q) for q in pts], 0.24, 0.06, p.vary(BARK, 0.06), sides=5)
        tips = []
        for k, t in enumerate((0.55, 0.75, 1.0)):
            i = min(len(trunk) - 1, int(t * (len(trunk) - 1)))
            q0 = trunk[i]
            b = (k - 1) * 0.9 + float(rng.uniform(-0.2, 0.2))
            d = (out * math.cos(b) + side * math.sin(b)).normalized()
            L = float(rng.uniform(1.6, 2.4))
            q1 = q0 + d * L * 0.5 + Vector((0, 0, 0.6))
            q2 = q0 + d * L + Vector((0, 0, 0.5)) + out * 0.5
            p.sweep([tuple(q0), tuple(q1), tuple(q2)], 0.22 if k < 2 else 0.16, 0.06, p.vary(BARK, 0.06), sides=5)
            tips.append(q2)
    with p.as_kind(LEAF_K):
        for q in tips + [trunk[-1]]:
            for j in range(3):
                c = q + out * float(rng.uniform(0.0, 1.0)) + side * float(rng.uniform(-0.7, 0.7)) \
                    + Vector((0, 0, float(rng.uniform(-0.2, 0.5))))
                s = float(rng.uniform(1.2, 1.8))
                crystal(p, tuple(c), (s * 1.6, s * 1.1, s * 0.8), p.vary(LEAF_SUN, 0.1), n=22, boxy=1.0,
                        jitter=0.18, yaw=a + float(rng.uniform(-0.4, 0.4)))
    return trunk[-1]


def _flowers(p, c, rng, n=4):
    """A few wildflowers in a clump (small painted heads on short stems)."""
    tone = FLOWERS[int(rng.integers(0, len(FLOWERS)))]
    with p.as_kind(PAINT):
        for _ in range(n):
            a = float(rng.uniform(0, TAU))
            r = float(rng.uniform(0.0, 0.3))
            h = float(rng.uniform(0.12, 0.26))
            q = (c[0] + math.cos(a) * r, c[1] + math.sin(a) * r, c[2] + h)
            crystal(p, q, (0.11, 0.11, 0.06), p.vary(tone, 0.08), n=5, boxy=0.0, jitter=0.2,
                    yaw=float(rng.uniform(0, TAU)))


def _root(p, f, start, a, rng, L, r0, sides=5):
    """A thick root out from under the turf, clinging down the rock a way
    (snapped onto it), then hanging free in a long curve, tapering; a
    rootlet off its knee."""
    cling = [start]
    q = Vector(start)
    for i in range(4):
        q = q + Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, -1.0 - float(rng.uniform(0, 0.4))))
        q = Vector(_on_surface(f, [tuple(q)], lift=r0 * 0.6)[0])
        cling.append(tuple(q))
    base = Vector(cling[-1])
    sway = float(rng.uniform(-0.8, 0.8))
    curl = float(rng.uniform(0.6, 1.4))
    free = []
    for i in range(1, 6):
        t = i / 5
        out = Vector((math.cos(a + sway * t), math.sin(a + sway * t), 0.0))
        side = Vector((-out.y, out.x, 0.0))
        q = base + out * (0.9 * math.sin(t * 2.2)) + side * math.sin(t * 3.1 + a) * curl * t \
            + Vector((0, 0, -L * t ** 1.15))
        free.append(tuple(q))
    pts = smooth_path(cling + free, 2)
    col = p.vary(ROOT if rng.uniform(0, 1) < 0.65 else ROOT_PALE, 0.07)
    with p.as_kind(WOOD):
        made = p.sweep(pts, r0, 0.035, col, sides=sides)
        lowest = min(q[2] for q in pts)
        top = pts[0][2]
        for face in made:
            z = face.calc_center_median().z
            t = max(0.0, min(1.0, (top - z) / max(0.5, top - lowest)))
            p._paint([face], mix(col, ROOT_DARK, sstep(0.45, 1.0, t) * 0.6), STONE)
        k = len(pts) // 2
        kq = Vector(pts[k])
        b = a + (1.1 if rng.uniform(0, 1) < 0.5 else -1.1)
        d = Vector((math.cos(b), math.sin(b), 0.0))
        fork = [tuple(kq), tuple(kq + d * 0.7 + Vector((0, 0, -1.0))), tuple(kq + d * 1.0 + Vector((0, 0, -2.4)))]
        p.sweep(smooth_path(fork, 2), r0 * 0.4, 0.025, col, sides=4)
    return pts


def _vine(p, f, start, a, rng, L):
    """A vine over the lip: draped down the rock, then hanging, leaves in
    small clumps along it."""
    pts = [start]
    q = Vector(start)
    for i in range(3):
        q = q + Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, -1.2))
        q = Vector(_on_surface(f, [tuple(q)], lift=0.1)[0])
        pts.append(tuple(q))
    base = Vector(pts[-1])
    for i in range(1, 4):
        t = i / 3
        pts.append(tuple(base + Vector((math.cos(a) * 0.4 * t, math.sin(a) * 0.4 * t, -L * t))
                         + Vector((math.sin(t * 4 + a), math.cos(t * 3 + a), 0.0)) * 0.25 * t))
    pts = smooth_path(pts, 2)
    with p.as_kind(PAINT):
        p.sweep(pts, 0.075, 0.04, p.vary(VINE, 0.08), sides=4)
    with p.as_kind(LEAF_K):
        for i in range(1, len(pts) - 1, 2):
            q = Vector(pts[i])
            s = float(rng.uniform(0.3, 0.5))
            crystal(p, (q.x + math.cos(a) * 0.12, q.y + math.sin(a) * 0.12, q.z), (s, s * 0.8, s * 0.45),
                    p.vary(MOSS_DEEP, 0.12), n=7, boxy=0.0, jitter=0.3, yaw=float(rng.uniform(0, TAU)),
                    pitch=float(rng.uniform(0.6, 1.2)))


def _crystal_cluster(p, at, d, rng, n=3, big=2.6, r=0.32):
    with p.as_kind(PAINT):
        for j in range(n):
            b = Vector(d) + Vector((float(rng.uniform(-0.5, 0.5)), float(rng.uniform(-0.5, 0.5)),
                                    float(rng.uniform(-0.35, 0.35))))
            facet_crystal(p, at, tuple(b.normalized()), big * float(rng.uniform(0.55, 1.0)),
                          r * float(rng.uniform(0.7, 1.0)), BREATH_CORE if j == 0 else p.vary(BREATH_GLOW, 0.06))


# ---- the isle -------------------------------------------------------------------------
def wind_isle(bpy, variant):
    """A floating islet of the wind (see the module's notes)."""
    S = ISLE_SPECS[variant]
    walk = ISLE_WALKS[variant]
    pads = ISLE_PADS[variant]
    D = S['depth']
    rng = np.random.default_rng(S['seed'])
    f, tips, sat_tips = _isle_field(S, walk, rng)
    glows = []
    p = IslePiece('Kit_WindIsle' + variant, seed=S['seed'], depth=D, ao=0.65, ao_dist=3.0, lichen=1.0,
                  glows=glows)
    verts, faces = gs.mesh_sculpt(f, bpy, 'WindIsle' + variant, 4300)
    add_sculpt(p, f, verts, faces, STORM_COLOURS, STORM_KINDS, smooth=True)
    prng = p.rng
    # The walk: its turf cap and the shrine's floor.
    p.worn.append((pads['home'][0], pads['home'][1], 0.0, 0.0, 0.85))
    # The turf's swells: a few centimetres (within a foot's snap), none at
    # its edge (the sim's rim), on the shrine's flags or the dais.
    n3 = Noise(S['seed'] + 31)

    def rise(x, y):
        r = math.hypot(x, y)
        if RING_IN - 0.5 < r < RING_OUT + 0.4 or r < 1.6:
            return 0.0
        if math.hypot(x - pads['home'][0], y - pads['home'][1]) < PAD_R + 0.6:
            return 0.0
        edge_k = min(1.0, max(0.0, -float(poly_sd(walk, np.array([x]), np.array([y]))[0]) - 0.2) / 1.2)
        return 0.06 * edge_k * float(n3.fbm(np.array([x * 0.22]), np.array([y * 0.22]), np.array([0.5]), 2)[0])
    p.turf_rise = rise
    p.sun = S['sun']
    edge, nrm = _cap(p, walk, rng, rise)
    _shrine_floor(p, walk, pads, rng)
    home_a = math.atan2(pads['home'][1], pads['home'][0])

    def clear_of_home(a, wide=0.85):
        d = abs((a - home_a + math.pi) % TAU - math.pi)
        return d > wide

    # The rim's runed standing stones (one broken on each isle).
    for k, a in enumerate(S['stones']):
        base = edge_pt(walk, a, 1.75, -0.75)
        glows.append(_rune_stone(p, base, a, float(prng.uniform(4.2, 5.4)), rng, broken=(k == 1)))
        for j in range(3):
            b = a + float(rng.uniform(-0.5, 0.5))
            c = edge_pt(walk, b, float(rng.uniform(0.9, 1.9)), -0.75)
            c = _on_surface(f, [(c[0], c[1], c[2] + 0.6)], lift=0.0)[0]
            if inside(walk, c[0], c[1], -0.6):
                continue
            _tuft(p, c, float(rng.uniform(0.45, 0.75)), rng, blades=5)
    if S['arch']:
        _broken_arch(p, walk, S['arch'][0], S['arch'][1], rng)
    if S['tree'] is not None:
        _tree(p, edge_pt(walk, S['tree'], 1.35, -0.6), S['tree'], rng)
    if S['fallen'] is not None:
        # A standing stone fallen onto the shelf below the rim.
        a = S['fallen']
        q = edge_pt(walk, a, 2.6)
        top = _on_surface(f, [(q[0], q[1], -3.6)], lift=0.0)[0]
        with p.as_kind(DRESSED):
            slab(p, (top[0], top[1], top[2] + 0.4), (3.4, 1.4, 0.9), p.vary(STORM_PALE, 0.06), yaw=a + 1.3,
                 pitch=0.18, chamfer=0.26)
    # Grass along the lip (inside the walk only within its last half yard,
    # never on the shrine's floor or the dais) and loose stones.
    for k in range(0, len(edge), 2):
        x, y = edge[k]
        nx, ny = nrm[k]
        if math.hypot(x - pads['home'][0], y - pads['home'][1]) < PAD_R + 0.4:
            continue
        if rng.uniform(0, 1) < 0.2:
            continue
        inset = float(rng.uniform(0.12, 0.42))
        _tuft(p, (x - nx * inset, y - ny * inset, 0.0), float(rng.uniform(0.2, 0.32)), rng,
              blades=int(rng.integers(3, 6)))
    # Grass curling over the lip, hanging down the turf's edge.
    with p.as_kind(TURF_K):
        for k in range(0, len(edge), 2):
            x, y = edge[k]
            nx, ny = nrm[k]
            if rng.uniform(0, 1) < 0.45:
                continue
            for j in range(2):
                o = float(rng.uniform(0.04, 0.12))
                hh = float(rng.uniform(0.25, 0.55))
                p.spike((x + nx * o + ny * (j - 0.5) * 0.2, y + ny * o - nx * (j - 0.5) * 0.2, -0.06),
                        0.06, -hh, p.vary(TURF, 0.12), sides=3, lean=(nx * hh * 0.35, ny * hh * 0.35),
                        phase=float(rng.uniform(0, TAU)))
    # Rock breaking up through the turf by the edge (low, a step's height),
    # flowers and grass gathered against them.
    for k in range(9):
        a = float(rng.uniform(0, TAU))
        if not clear_of_home(a, 0.55):
            continue
        x, y, _ = edge_pt(walk, a, -float(rng.uniform(0.7, 1.1)))
        if RING_IN - 0.6 < math.hypot(x, y) < RING_OUT + 0.4:
            continue
        s = float(rng.uniform(0.45, 0.9))
        with p.as_kind(RAW):
            crystal(p, (x, y, 0.0), (s * 1.5, s, s * 0.5), p.vary(CRAG_BED, 0.08), n=11, boxy=0.75,
                    jitter=0.22, yaw=float(rng.uniform(0, TAU)), floor=-0.1)
        nx, ny = math.cos(a), math.sin(a)
        _tuft(p, (x - nx * s * 0.7, y - ny * s * 0.7, 0.0), 0.26, rng, blades=4)
        _flowers(p, (x + ny * s * 0.6, y - nx * s * 0.6, 0.0), rng, n=3)
    # Bedrock breaking flush through the turf (a step never trips on it).
    placed = 0
    for _ in range(40):
        if placed >= 6:
            break
        x, y = float(rng.uniform(-8.0, 8.0)), float(rng.uniform(-8.0, 8.0))
        r = math.hypot(x, y)
        if not inside(walk, x, y, 0.8) or RING_IN - 0.7 < r < RING_OUT + 0.5 or r < 2.0:
            continue
        if math.hypot(x - pads['home'][0], y - pads['home'][1]) < PAD_R + 0.8:
            continue
        s2 = float(rng.uniform(0.5, 1.0))
        yaw = float(rng.uniform(0, TAU))
        outline = [(x + math.cos(yaw + TAU * j / 7) * s2 * float(rng.uniform(0.6, 1.2)),
                    y + math.sin(yaw + TAU * j / 7) * s2 * float(rng.uniform(0.5, 0.9))) for j in range(7)]
        _flagstone(p, outline, rng, CRAG_BED, top=0.025, bevel=0.14)
        placed += 1
    # Flowers along the lip and at the stones' feet.
    for k in range(0, len(edge), 9):
        x, y = edge[k]
        nx, ny = nrm[k]
        if math.hypot(x - pads['home'][0], y - pads['home'][1]) < PAD_R + 0.4 or rng.uniform(0, 1) < 0.4:
            continue
        _flowers(p, (x - nx * 0.35, y - ny * 0.35, 0.0), rng, n=3)
    for a in S['stones']:
        q = edge_pt(walk, a, 1.0, -0.4)
        q = _on_surface(f, [(q[0], q[1], q[2] + 0.4)], lift=0.0)[0]
        if not inside(walk, q[0], q[1], -0.5):
            _flowers(p, q, rng, n=4)
    # The satellites' dressing: tufts, a root, a crystal.
    for (a, r, top, size, depth), tip in zip(S['sats'], sat_tips):
        cx, cy = math.cos(a) * r, math.sin(a) * r
        for j in range(3 if size > 2 else 1):
            b = float(rng.uniform(0, TAU))
            rr = float(rng.uniform(0.2, 0.7)) * size
            _tuft(p, (cx + math.cos(b) * rr, cy + math.sin(b) * rr, top), float(rng.uniform(0.35, 0.6)), rng)
        _crystal_cluster(p, (tip[0], tip[1], tip[2] + 0.8), (0, 0, -1), rng, n=2, big=1.6, r=0.2)
        glows.append(tip)
    # The vein's crystal: a great cluster out of each point, more out of the
    # flanks, the rock round each lit by it.
    for i, tip in enumerate(tips):
        at = _on_surface(f, [(tip[0], tip[1], tip[2] + 1.2)], lift=-0.2)[0]
        _crystal_cluster(p, at, (0, 0, -1), rng, n=5 if i == 0 else 3, big=6.0 if i == 0 else 3.6,
                         r=0.62 if i == 0 else 0.42)
        glows.append(at)
    for c in range(4):
        a = TAU * c / 4 + float(rng.uniform(-0.35, 0.35))
        z = float(rng.uniform(-D * 0.75, -4.5))
        cx, cy = _hang_c(z, D, S['lean'])
        r = _hang_r(z, D, S['crown']) + 2.0
        at = _on_surface(f, [(cx + math.cos(a) * r, cy + math.sin(a) * r, z)], lift=-0.25)[0]
        _crystal_cluster(p, at, (math.cos(a), math.sin(a), -0.5), rng, n=3, big=2.8, r=0.3)
        glows.append(at)
    # The roots: out from under the turf, clinging down the belly, hanging.
    for k in range(8):
        a = TAU * k / 8 + float(rng.uniform(-0.2, 0.2))
        x, y, _ = edge_pt(walk, a, 0.25)
        start = _on_surface(f, [(x, y, -1.0)], lift=0.15)[0]
        # Out from under the turf, never up over its lip.
        start = (start[0], start[1], min(start[2], -0.6))
        _root(p, f, start, a, rng, float(rng.uniform(4.0, 9.5)) * (1.25 if k % 4 == 0 else 1.0),
              float(rng.uniform(0.2, 0.3)))
    # Vines over the lip.
    for k in range(3):
        a = TAU * k / 3 + 0.31 + float(rng.uniform(-0.2, 0.2))
        x, y, _ = edge_pt(walk, a, 0.18, -0.3)
        _vine(p, f, (x, y, -0.3), a, rng, float(rng.uniform(2.5, 7.0)))
    return p


def isle_shard(bpy):
    """A stone drifting round an isle (the runtime spins and orbits it): a
    craggy lump about 1.6 across, a cap of moss, a shard of the vein's
    crystal in it."""
    p = IslePiece('Kit_IsleShard', seed=6301, depth=2.0, ao=0.5, ao_dist=0.6)
    p.cur = RAW
    rng = p.rng
    with p.as_kind(RAW):
        crystal(p, (0, 0, 0), (1.7, 1.4, 1.2), p.vary(ROCK_WARM, 0.05), n=18, boxy=0.3, jitter=0.35)
        crystal(p, (0.3, 0.2, -0.5), (1.0, 0.9, 0.9), p.vary(CRAG_BED, 0.05), n=12, boxy=0.3, jitter=0.35)
    with p.as_kind(PAINT):
        facet_crystal(p, (0.2, 0.1, 0.3), (0.4, 0.2, 1.0), rng.uniform(0.7, 0.9), 0.14, p.vary(BREATH_GLOW, 0.05))
    return p
