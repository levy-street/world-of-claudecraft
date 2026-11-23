"""The Mirefen tavern's painted surfaces: the hand-painted tiling maps of the painted town in
its Fenrire (moss) look, the look the painted Fenbridge buildings beside the tavern wear, laid
on the tavern's own geometry. build_tavern.py builds its parts, each face already on its
material with its colour a tint over that material's map (the inn_*.py builders give both),
then calls its paint_faces() before the warm bake, which uses the helpers here.

  textures.json   the maps each painted material wears (tex/), their repeat in yards (the town
                  kit's own, bl_town_lib.py K, at the scale Fenbridge stands its inn), roughness
                  and normal strength, and the vertex colours' headroom
  tex/            the Fenrire maps, every one tiling seamlessly: the limewash, the dressed stone
                  and the cloth as painted, the mossy rubble, the weathered oak and the mossy
                  slates lifted to the light Fenbridge's buildings show them in, and the boards
                  a weathered brown (regrade_map.mjs)

A face on a painted material keeps its colour as a tint over the map, so the dark oak and the
pale limewash stay, and the warm light baked into the inside afterwards lands on top of the
paint. The tint is stored under textures.json's headroom (divided by it), so that light can lift
the paint above the map itself instead of only shifting its hue; the runtime multiplies the
colour back (vertex_colour_scale(), written by build.mjs into each painted material's extras).
The slates tint by brightness alone (their moss is in the map). The metal, the glow and the plain
material (glass, flowers, food, the dog) wear no map.

The map is laid sheet by sheet (sheets(), lay_sheet()), never face by face: each solid's faces
of one material that meet smoothly (a bowed wall, a sagging slope of slates, a hewn beam's side,
the tower's drum, a round post) are one sheet and wear one projection, so the stones, the slates
and the grain run on unbroken across every edge inside it, and only a sharp corner (a block's)
breaks them. A flat sheet is projected on its mean plane, snapped to the world's axes where it
nearly faces one, so every wall of a face wears the same projection whatever part or solid it is
(the front's three parts, a stack's blocks, the storey over its plinth); plaster, stone, dressed
stone, cloth and the roof lie level (courses, folds and slate rows run level), timber and boards
run along the solid (the grain runs down a beam; each timber starts its own stretch of the map,
from a stable hash of where it stands, so neighbours never repeat). A round sheet is laid round
its axis (Round): the drum's stones turn round it unbroken, the hat's slates run in level
courses up it, narrowing toward its tip, and a post's grain runs down it. The tints are blended
across each sheet (blend_tints()) and build_tavern.SheetShade shades it smoothly, so no face of a
sheet stands out from its neighbours as a panel.
"""
import json
import math
import os

from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'textures.json'), encoding='utf8') as fh:
    CONFIG = json.load(fh)

# The material slots. The first five keep the builders' own indices (build_tavern.py WOOD,
# METAL, STONE, PLASTER, GLOW; the warm bake reads GLOW at 4), the painted ones and the plain one
# follow.
MATERIALS = ('TavernTimber', 'TavernMetal', 'TavernStone', 'TavernPlaster', 'TavernGlow',
             'TavernRoof', 'TavernFloor', 'TavernCloth', 'TavernDressed', 'TavernPlain', 'TavernProps')
TIMBER, METAL, STONE, PLASTER, GLOW, ROOF, FLOOR, CLOTH, DRESSED, PLAIN, PROPS = range(len(MATERIALS))
PAINTED = frozenset((TIMBER, STONE, PLASTER, ROOF, FLOOR, CLOTH, DRESSED, PROPS))
# the props' atlas (inn_props.py): its faces carry their own UVs into it, laid by their builder
ATLAS = frozenset((PROPS,))
# grain: the map's long axis runs down the solid (a beam, a board)
GRAIN = frozenset((TIMBER, FLOOR))
# (roughness, metallic, emission) of the materials that wear no map
PLAIN_SPECS = {METAL: (0.45, 0.55, 0.0), GLOW: (0.5, 0.0, 2.4), PLAIN: (0.9, 0.0, 0.0)}

# parts that keep their own colours whatever they are on (the dog's coat)
PLAIN_PARTS = frozenset(('TavernDog',))

# a painted face's colour is stored divided by this (textures.json): room above the map for the
# warm light, which lifts a colour up to 1.5 times near a flame (build_tavern.bake_warm_light)
HEADROOM = CONFIG['headroom']


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def vertex_colour_scale():
    """The linear factor that undoes the headroom at runtime. shiplib's finish() and the glTF
    exporter together ship a stored (gamma) colour v as COLOR_0 = srgbToLinear(v), so a tint of
    1 stored at 1 / HEADROOM draws as the map itself under this factor (build.mjs computes the
    same number for the painted materials' extras)."""
    return 1.0 / _srgb_to_linear(1.0 / HEADROOM)


def yards(slot):
    return CONFIG['materials'][MATERIALS[slot]]['yards']


def fit(t):
    """A colour brought under 1 by its brightest channel, so its hue survives (a per-channel
    clamp turns a warm tint white)."""
    m = max(t)
    if m > 1.0:
        return (t[0] / m, t[1] / m, t[2] / m)
    return (max(0.0, t[0]), max(0.0, t[1]), max(0.0, t[2]))


def components(bm):
    """The connected solids of a part (faces sharing a vertex), in face order."""
    seen = set()
    comps = []
    for f in bm.faces:
        if f in seen:
            continue
        stack, comp = [f], []
        seen.add(f)
        while stack:
            g = stack.pop()
            comp.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h not in seen:
                        seen.add(h)
                        stack.append(h)
        comps.append(comp)
    return comps


UP = Vector((0.0, 0.0, 1.0))  # Blender's up (the game's +y)
LEVEL = Vector((1.0, 0.0, 0.0))


def _canon(a):
    """An axis turned so its largest component is positive (a stable sign)."""
    k = max(range(3), key=lambda i: abs(a[i]))
    return -a if a[k] < 0 else a


class Frame:
    """A solid's long axis, its second axis (principal axes of its corners) and the stretch of
    the map it starts at."""

    def __init__(self, comp):
        import numpy as np

        # (the corners in the solid's own face order, never a set's: a set of BMVerts orders by
        # address, so the sums, and a round solid's axes, would change from build to build)
        verts = dict.fromkeys(v for f in comp for v in f.verts)
        pts = np.array([v.co[:] for v in verts], dtype=float)
        c = pts.mean(axis=0)
        x = pts - c
        w, vecs = np.linalg.eigh(x.T @ x)
        long, second = Vector(vecs[:, 2].tolist()), Vector(vecs[:, 1].tolist())
        scale = max(w[2], 1e-9)
        if w[2] - w[1] < 1e-4 * scale:
            # a round solid (a ring, a wheel, a post's cap) has no one long axis: take the one in
            # its plane nearest the world's up, else nearest its x, so the grain lies the same way
            # on every build
            plane_n = Vector(vecs[:, 0].tolist())
            long = _in_plane(UP, plane_n) or _in_plane(LEVEL, plane_n) or long
            second = plane_n.cross(long)
        elif w[1] - w[0] < 1e-4 * scale:
            second = _in_plane(UP, long) or _in_plane(LEVEL, long) or second
        self.long = _canon(long.normalized())
        self.second = _canon(second.normalized())
        h = math.sin(round(c[0], 2) * 12.9898 + round(c[1], 2) * 78.233 + round(c[2], 2) * 37.719) * 43758.5453
        h -= math.floor(h)
        k = math.sin(round(c[0], 2) * 93.989 + round(c[1], 2) * 67.345 + round(c[2], 2) * 11.135) * 24634.6345
        k -= math.floor(k)
        self.offset = (h, k)


def _in_plane(a, n):
    u = a - n * a.dot(n)
    return u.normalized() if u.length > 1e-4 else None


def _axes(slot, n, frame):
    """The map's (u, v) directions on a face of normal n: u the map's rows (level, or down the
    grain), v = n x u, so the map is never mirrored seen from the front."""
    u = None
    # (a level floor's boards run along the world x whatever the floor's outline: a floor's own
    # long axis lies askew where its outline is cut away round the hearth, the bar's platform and
    # the stage, and its boards would run on the slant)
    if slot in GRAIN and not (slot == FLOOR and abs(n.z) >= 0.97):
        for a in (frame.long, frame.second):
            if abs(a.dot(n)) < 0.7:
                u = _in_plane(a, n)
                if u is not None:
                    break
    elif abs(n.z) < 0.97:
        u = UP.cross(n).normalized()
    if u is None:
        # a level face (a floor, a rug, a tread): the map's rows along the world x
        u = _in_plane(LEVEL, n) or _in_plane(Vector((0.0, 1.0, 0.0)), n)
    return u, n.cross(u)


# ---------------------------------------------------------------------------
# Sheets: the map laid on unbroken across every smooth surface
# ---------------------------------------------------------------------------
# Two faces of one solid and one material meeting within SHEET_ANGLE (or SOFT_ANGLE when both are
# soft, a round post's or a sweep's sides) are one sheet: a bowed wall, a sagging slope, a hewn
# beam's side, a drum. Across a sharper edge (a block's corner) the map may break.
SHEET_ANGLE = math.radians(30.0)
SOFT_ANGLE = math.radians(65.0)
# a sheet whose faces all stand within FLAT_SPREAD of its mean is laid flat on that mean
FLAT_SPREAD = math.radians(40.0)
# a flat sheet facing within SNAP of a world axis (in plan) is laid on that axis, and one within
# PLUMB of plumb (or of level) on the plumb (or level) plane: every wall of a face, whatever part
# or solid it is, then wears the one projection, so the stones and the limewash run on across
# the parts' joins (the front's three parts, the stone storey over its plinth)
SNAP = math.radians(12.0)
PLUMB = math.radians(15.0)


def sheets(comp, soft, soft_angle=SOFT_ANGLE):
    """A solid's smooth sheets: its faces of one material joined across every edge where they
    meet within SHEET_ANGLE (soft_angle for two soft faces). Lists of faces in the solid's face
    order, the first face's sheet first."""
    index = {f: i for i, f in enumerate(comp)}
    parent = list(range(len(comp)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, f in enumerate(comp):
        for e in f.edges:
            if len(e.link_faces) != 2:
                continue
            g = e.link_faces[0] if e.link_faces[1] == f else e.link_faces[1]
            j = index.get(g)
            if j is None or j <= i or g.material_index != f.material_index:
                continue
            limit = soft_angle if (f[soft] and g[soft]) else SHEET_ANGLE
            if f.normal.angle(g.normal, math.pi) < limit:
                a, b = find(i), find(j)
                if a != b:
                    parent[max(a, b)] = min(a, b)
    groups = {}
    for i, f in enumerate(comp):
        groups.setdefault(find(i), []).append(f)
    return list(groups.values())


def _snapped(n):
    """A flat sheet's normal laid on the world's axes where it nearly faces one (SNAP, PLUMB)."""
    h = math.hypot(n.x, n.y)
    pitch = math.atan2(n.z, h)
    if abs(abs(pitch) - math.pi / 2) <= PLUMB:
        return Vector((0.0, 0.0, 1.0 if n.z > 0 else -1.0))
    az = math.atan2(n.y, n.x)
    q = round(az / (math.pi / 2)) * (math.pi / 2)
    if abs(az - q) <= SNAP:
        az = q
    if abs(pitch) <= PLUMB:
        pitch = 0.0
    return Vector((math.cos(pitch) * math.cos(az), math.cos(pitch) * math.sin(az), math.sin(pitch)))


def _mean_normal(faces):
    """A sheet's area-weighted mean normal and its faces' areas."""
    areas = [max(f.calc_area(), 1e-9) for f in faces]
    s = Vector((0.0, 0.0, 0.0))
    for f, a in zip(faces, areas):
        s += f.normal * a
    return (s.normalized() if s.length > 1e-9 else faces[0].normal.normalized()), areas


class Round:
    """A sheet that turns round an axis (a drum, a post, a barrel's staves, a witch's hat): every
    normal of a surface of revolution crosses its axis, so the axis is the line the faces'
    normal lines all pass nearest. A drum's or a cone's normals all lean the same way off it (the
    one direction their spread leaves out); a bellied or domed one's are found as the line
    meeting them all (a Pluecker fit). ok is False when no line passes near them all (a lump
    curved every way, two slopes folded at a ridge): such a sheet is laid by the world's axes."""

    def __init__(self, faces, areas):
        import numpy as np

        self.ok = False
        A = np.array(areas, dtype=float)
        A = A / A.sum()
        C = np.array([f.calc_center_median()[:] for f in faces], dtype=float)
        N = np.array([f.normal[:] for f in faces], dtype=float)
        c0 = (C * A[:, None]).sum(axis=0)
        size = max(float(np.sqrt((((C - c0) ** 2).sum(axis=1) * A).sum())), 1e-3)
        P = (C - c0) / size
        m = (N * A[:, None]).sum(axis=0)
        mv = Vector(m.tolist())
        cands = []
        # a drum or a cone: the direction the normals never vary along
        D = N - m
        w, vecs = np.linalg.eigh((D * A[:, None]).T @ D)
        if w[0] <= 0.12 * max(w.sum(), 1e-12):
            cands.append(vecs[:, 0])
        # any other surface of revolution: the line (direction a, moment q = o x a) meeting
        # every normal line (p, n), where a . (p x n) + n . q = 0, the moment solved out
        Ra = np.cross(P, N) * np.sqrt(A)[:, None]
        Rq = N * np.sqrt(A)[:, None]
        G = np.linalg.pinv(Rq.T @ Rq)
        S = Ra.T @ Ra - Ra.T @ Rq @ G @ Rq.T @ Ra
        ws, vs = np.linalg.eigh(S)
        if ws[1] > 4.0 * max(ws[0], 1e-12):
            cands.append(vs[:, 0])
        best = None
        for a in cands:
            a = a / np.linalg.norm(a)
            # the axis' point: nearest every normal line, across the axis
            Q = np.cross(N, a)
            M = np.zeros((3, 3))
            b = np.zeros(3)
            for p, q, wt in zip(P, Q, A):
                lq = np.linalg.norm(q)
                if lq < 0.15:
                    continue
                d = q / lq
                M += wt * np.outer(d, d)
                b += wt * d * np.dot(d, p)
            try:
                # (nothing pins the point along the axis: a a^T holds it on the plane through 0)
                o = np.linalg.solve(M + np.outer(a, a), b)
            except np.linalg.LinAlgError:
                continue
            o -= a * np.dot(a, o)
            # how far the normal lines pass from it, over the sheet's radius round it
            res, rad, wsum = 0.0, 0.0, 0.0
            for p, n, q, wt in zip(P, N, Q, A):
                lq = np.linalg.norm(q)
                x = p - o
                rad += wt * np.linalg.norm(x - a * np.dot(a, x))
                if lq < 0.15:
                    continue
                res += wt * (np.dot(x, q) / lq) ** 2
                wsum += wt
            if wsum < 0.5 or rad < 1e-6:
                continue
            score = math.sqrt(res / wsum) / rad
            if score < 0.2 and (best is None or score < best[0]):
                best = (score, a, o)
        if best is None:
            return
        _, a, o = best
        a = Vector(a.tolist()).normalized()
        # (the axis turned the way the faces lean along it, a cone's toward its apex for its
        # slates; a drum's, which lean neither way, up)
        if abs(a.dot(mv)) > 0.05:
            a = a if a.dot(mv) > 0 else -a
        else:
            a = _canon(a)
        self.a = a
        self.o = Vector((o * size + c0).tolist())
        # the angles measured from the sheet's middle, so an open sheet (the drum, open at the
        # arch; the nook's plaster inside it) never meets the cut where they wrap
        mid = Vector(c0.tolist()) - self.o
        mid -= a * a.dot(mid)
        self.e1 = mid.normalized() if mid.length > 1e-3 * size else (_in_plane(LEVEL, a) or _in_plane(UP, a))
        self.e2 = a.cross(self.e1)
        self.bend = None
        verts = list(dict.fromkeys(v for f in faces for v in f.verts))
        # a closed ring (a post, a barrel, the hat): its faces' spans of angle cover the whole
        # turn; an open one (the drum, open at the arch) leaves its opening
        spans = []
        for f in faces:
            _, _, pc = self.cyl(f.calc_center_median())
            ds = [math.remainder(self.cyl(v.co)[2] - pc, math.tau) for v in f.verts]
            spans.append((pc + min(ds), pc + max(ds)))
        self.closed = _covers_turn(spans)
        # its corners in bands up the axis: where every band is a whole ring round it (the hat's
        # courses, the drum's), each band's own middle and radius are followed; a sheet whose
        # bands are scraps of rings (a short sweep, a lump of a lathe) takes a straight axis and
        # a straight profile instead (a band of scraps has no middle of its own)
        hv = [((v.co - self.o).dot(a), v) for v in verts]
        lo, hi = min(h for h, _ in hv), max(h for h, _ in hv)
        nb = max(1, min(24, int((hi - lo) / max(0.05, 0.02 * size)) + 1))
        bands = [[] for _ in range(nb)]
        for h, v in hv:
            bands[min(nb - 1, int((h - lo) / max(hi - lo, 1e-9) * nb))].append((h, v))
        bands = [b for b in bands if b]
        whole = math.tau if self.closed else _coverage([self.cyl(v.co)[2] for v in verts])
        clean = len(bands) > 1 and all(len(b) >= 3 and _coverage([self.cyl(v.co)[2] for _, v in b]) >= 0.75 * whole
                                       for b in bands)
        if clean and self.closed:
            # a closed ring's middle followed up it (the hat leans and twists off true toward its
            # tip): each height's corners turn round their own middle, never round a line beside
            # it, and the angles start at its first corner
            bend = []
            for b in bands:
                c = Vector((0.0, 0.0, 0.0))
                for h, v in b:
                    d = v.co - self.o
                    c += d - a * d.dot(a)
                bend.append((sum(h for h, _ in b) / len(b), c / len(b)))
            self.bend = bend
        if self.closed:
            q = verts[0].co - self.o
            h0 = q.dot(a)
            q = q - a * h0 - self.offset(h0)
            if q.length > 1e-6:
                self.e1 = q.normalized()
                self.e2 = a.cross(self.e1)
        hs, rs = [], []
        for v in verts:
            h, r, _ = self.cyl(v.co)
            hs.append(h)
            rs.append(r)
        # the radius the map keeps its size at round the axis: the sheet's narrowest (so nowhere
        # is the map squeezed round it; a closed ring that wraps a whole number of times takes
        # its area-weighted mean, a cone's courses narrowing toward the tip as slates do)
        rsorted = sorted(rs)
        self.r_min = max(rsorted[0], 1e-3)
        self.r = max(sum(wt * self.cyl(f.calc_center_median())[1] for f, wt in zip(faces, A)), 1e-3)
        # (a sheet the axis runs through, a cap or a dome's crown, has no ring to wrap: the angle
        # spins round its pole; a cone's tip, a sliver of the whole, is let be)
        pole = 0.2 * self.r
        self.ok = sum(wt for f, wt in zip(faces, A) if min(self.cyl(v.co)[1] for v in f.verts) < pole) < 0.1
        # the profile: the distance along the surface up its meridian, as a function of the
        # height up the axis (rows level round it, evenly spaced up a cone's slope or a dome)
        self.h0 = lo
        if clean:
            prof = []
            for b in bands:
                prof.append((sum(h for h, _ in b) / len(b), sum(self.cyl(v.co)[1] for _, v in b) / len(b)))
        else:
            # a straight profile: the radius' best line up the axis (a drum's, a cone's slope)
            hm = sum(hs) / len(hs)
            rm = sum(rs) / len(rs)
            shh = sum((h - hm) ** 2 for h in hs)
            slope = (sum((h - hm) * (r - rm) for h, r in zip(hs, rs)) / shh) if shh > 1e-12 else 0.0
            prof = [(lo, rm + slope * (lo - hm)), (hi, rm + slope * (hi - hm))]
        self.hs = [prof[0][0]]
        self.ss = [0.0]
        for (h0, r0), (h1, r1) in zip(prof, prof[1:]):
            self.hs.append(h1)
            self.ss.append(self.ss[-1] + math.hypot(h1 - h0, r1 - r0))
        self.length = self.ss[-1] if len(prof) > 1 else (hi - lo)

    def offset(self, h):
        """How far a closed ring's middle stands off the axis at height h (0 for an open one)."""
        b = self.bend
        if not b:
            return Vector((0.0, 0.0, 0.0))
        if h <= b[0][0]:
            return b[0][1]
        for (h0, c0), (h1, c1) in zip(b, b[1:]):
            if h <= h1:
                t = (h - h0) / max(h1 - h0, 1e-9)
                return c0.lerp(c1, t)
        return b[-1][1]

    def cyl(self, p):
        d = p - self.o
        h = d.dot(self.a)
        q = d - self.a * h
        if self.bend:
            q = q - self.offset(h)
        return h, q.length, math.atan2(q.dot(self.e2), q.dot(self.e1))

    def along(self, h):
        """The distance up the meridian at height h up the axis."""
        hs, ss = self.hs, self.ss
        if len(hs) < 2:
            return h - self.h0
        if h <= hs[0]:
            k = (ss[1] - ss[0]) / max(hs[1] - hs[0], 1e-9)
            return ss[0] + (h - hs[0]) * k
        for i in range(1, len(hs)):
            if h <= hs[i]:
                t = (h - hs[i - 1]) / max(hs[i] - hs[i - 1], 1e-9)
                return ss[i - 1] + (ss[i] - ss[i - 1]) * t
        k = (ss[-1] - ss[-2]) / max(hs[-1] - hs[-2], 1e-9)
        return ss[-1] + (h - hs[-1]) * k


def _coverage(angles):
    """How much of the turn a set of angles spans: the turn less its widest gap."""
    if len(angles) < 2:
        return 0.0
    ring = sorted(angles)
    gaps = [y - x for x, y in zip(ring, ring[1:])] + [ring[0] + math.tau - ring[-1]]
    return math.tau - max(gaps)


def _covers_turn(spans):
    """Whether angle spans (start, end), end - start under a half turn, cover the whole turn."""
    if not spans:
        return False
    iv = sorted(((a + math.pi) % math.tau - math.pi, (a + math.pi) % math.tau - math.pi + (b - a)) for a, b in spans)
    # sweep from the first start round to it again a turn on
    start = iv[0][0]
    reach = start
    for a, b in iv + [(x + math.tau, y + math.tau) for x, y in iv]:
        if a > reach + math.radians(1.0):
            return False
        reach = max(reach, b)
        if reach >= start + math.tau - math.radians(1.0):
            return True
    return False


# a closed ring with at least this many repeats round it wraps the map a whole number of times
# (stretched or squeezed under 5%); a smaller one turns the map back on itself halfway round
# instead (mirrored, at its own size), so neither squeezes it nor cuts it
WRAP_TURNS = 6


def _lay_round(rnd, faces, uv, k, off, grain_long):
    """A round sheet's UVs: round the axis by angle, up it by the distance along the surface (so
    rows run level round it, evenly spaced up a cone's slope). A big closed ring takes a whole
    number of repeats round it, so the map closes on itself; a small one is mirrored round from
    its first corner, so the map meets itself again at the far side. Returns how it went round
    ('turns', 'mirror' or 'open')."""
    mirror = False
    kind = 'open'
    around = rnd.r_min * k
    if rnd.closed:
        turns = math.floor(math.tau * rnd.r * k * 1.049)
        if turns >= WRAP_TURNS:
            around = turns / math.tau
            kind = 'turns'
        else:
            mirror = True
            kind = 'mirror'
    for f in faces:
        _, _, phic = rnd.cyl(f.calc_center_median())
        for loop in f.loops:
            h, r, phi = rnd.cyl(loop.vert.co)
            # (each face's corners unwrapped round its own middle: a face across the angles' cut
            # keeps its own span of the map, and a whole number of repeats round makes the cut
            # invisible)
            phi = phic + math.remainder(phi - phic, math.tau)
            if mirror:
                phi = abs(math.remainder(phi, math.tau))
            a, b = phi * around, rnd.along(h) * k
            loop[uv].uv = (b + off[0], a + off[1]) if grain_long else (a + off[0], b + off[1])
    return kind


def _stretched(faces, uv, k, over=1.049):
    """The share of a sheet's edges its map runs along faster than its repeat."""
    seen = set()
    n = bad = 0
    for f in faces:
        for e in f.edges:
            if e in seen:
                continue
            seen.add(e)
            length = e.calc_length()
            if length < 0.1:
                continue
            a, b = e.verts
            la = next(lp for lp in f.loops if lp.vert == a)[uv].uv
            lb = next(lp for lp in f.loops if lp.vert == b)[uv].uv
            n += 1
            if (la - lb).length > length * k * over:
                bad += 1
    return bad / n if n else 0.0


def _signed_uv_area(f, uv):
    s = 0.0
    loops = list(f.loops)
    for i, la in enumerate(loops):
        a = la[uv].uv
        b = loops[(i + 1) % len(loops)][uv].uv
        s += a.x * b.y - b.x * a.y
    return s / 2


def _lay_flat(faces, uv, slot, frame, n, k, off):
    u, v = _axes(slot, n, frame)
    for f in faces:
        for loop in f.loops:
            p = loop.vert.co
            loop[uv].uv = (p.dot(u) * k + off[0], p.dot(v) * k + off[1])


def _lay_box(faces, uv, slot, frame, k, off):
    for f in faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        d = Vector((0.0, 0.0, 0.0))
        d[ax] = 1.0 if n[ax] > 0 else -1.0
        u, v = _axes(slot, d, frame)
        for loop in f.loops:
            p = loop.vert.co
            loop[uv].uv = (p.dot(u) * k + off[0], p.dot(v) * k + off[1])


def cuts(faces, uv, tol=0.004):
    """The edges inside a sheet across which its map jumps (by more than tol of a repeat; a
    whole number of repeats is no jump, the map tiles), and the jumps' sum."""
    inside = set(faces)
    seen = set()
    n, total = 0, 0.0
    for f in faces:
        for e in f.edges:
            if e in seen or len(e.link_faces) != 2:
                continue
            seen.add(e)
            g = e.link_faces[0] if e.link_faces[1] == f else e.link_faces[1]
            if g not in inside:
                continue
            gap = 0.0
            for v in e.verts:
                a = next(lp for lp in f.loops if lp.vert == v)[uv].uv
                b = next(lp for lp in g.loops if lp.vert == v)[uv].uv
                gap = max(gap, math.hypot(a.x - b.x - round(a.x - b.x), a.y - b.y - round(a.y - b.y)))
            if gap > tol:
                n += 1
                total += gap
    return n, total


# a curved sheet no axis fits cleanly is laid flat on its mean if its faces stand within this of
# it (some stretch, no cut), else by the world's axes
LOOSE_SPREAD = math.radians(60.0)


def lay_sheet(faces, uv, slot, frame, soft=None):
    """Lay the map on a sheet: one projection for all its faces, so it runs on unbroken across
    every edge inside it. A flat sheet is projected on its mean plane (snapped to the world's
    axes where it nearly faces one); a round one round its axis (Round); a curved one no axis
    fits cleanly flat on its mean if it is shallow enough, else on the world axis each face most
    nearly faces, whichever cuts it least. The map is turned so it reads the right way round
    from the front. Returns how it was laid."""
    k = 1.0 / yards(slot)
    off = frame.offset if slot == TIMBER else (0.0, 0.0)
    mean, areas = _mean_normal(faces)
    spread = max(f.normal.angle(mean, math.pi) for f in faces)
    if spread <= FLAT_SPREAD:
        _lay_flat(faces, uv, slot, frame, _snapped(mean), k, off)
        return 'flat'
    tried = []

    def keep(kind):
        c = cuts(faces, uv)
        tried.append((c, len(tried), kind, {lp: tuple(lp[uv].uv) for f in faces for lp in f.loops}))
        return c[0] == 0

    rnd = Round(faces, areas)
    if rnd.ok:
        # timber runs its grain down the solid's length: along the axis (a post, a barrel's
        # staves) unless the ring is flat (a hoop, a wheel's rim), when it runs round it
        grain_long = slot in GRAIN and rnd.length >= rnd.r
        wrapped = _lay_round(rnd, faces, uv, k, off, grain_long)
        mirrored = wrapped == 'mirror'
        # never mirrored from the front: the corners run round each face the way its normal turns
        # (on a mirrored ring, its first half round)
        front = [f for f in faces if not mirrored or 0.0 < rnd.cyl(f.calc_center_median())[2] < math.pi] or faces
        if sum(_signed_uv_area(f, uv) for f in front) < 0:
            for f in faces:
                for loop in f.loops:
                    t = loop[uv].uv
                    loop[uv].uv = (-t.x, t.y) if not grain_long else (t.x, -t.y)
        # (an axis fitted to a sheet that only roughly turns round one shows as edges the map
        # runs along faster than they are long: then the sheet is laid flat or by the world's
        # axes instead, which never stretch it; a whole-turn wrap squeezes the map toward a
        # cone's tip by design)
        if wrapped == 'turns' or _stretched(faces, uv, k) == 0.0:
            if keep('round'):
                return 'round'
    if spread <= LOOSE_SPREAD:
        _lay_flat(faces, uv, slot, frame, mean, k, off)
        if keep('flat'):
            return 'flat'
    if soft is not None:
        # a soft sheet folded at a crease (two slopes of boards meeting at a ridge): each side of
        # the crease laid on its own, the map breaking only along the crease
        parts = sheets(faces, soft, soft_angle=SHEET_ANGLE)
        if len(parts) > 1:
            for part in parts:
                pm, _ = _mean_normal(part)
                if max(f.normal.angle(pm, math.pi) for f in part) <= FLAT_SPREAD:
                    _lay_flat(part, uv, slot, frame, _snapped(pm), k, off)
                else:
                    _lay_box(part, uv, slot, frame, k, off)
            keep('creased')
    _lay_box(faces, uv, slot, frame, k, off)
    keep('box')
    (_, _), _, kind, uvs = min(tried, key=lambda t: (t[0][0], t[0][1], t[1]))
    for f in faces:
        for lp in f.loops:
            lp[uv].uv = uvs[lp]
    return kind


def blend_tints(faces, col):
    """A sheet's tint made continuous: each corner the mean of the tints its sheet's faces give
    it, so the per-face variation the builders paint (a stone cell a shade off its neighbour, a
    slate a little lighter) shades softly across the sheet instead of cutting it into panels."""
    acc = {}
    for f in faces:
        for loop in f.loops:
            c = loop[col]
            a = acc.get(loop.vert)
            if a is None:
                acc[loop.vert] = [c[0], c[1], c[2], 1]
            else:
                a[0] += c[0]
                a[1] += c[1]
                a[2] += c[2]
                a[3] += 1
    for f in faces:
        for loop in f.loops:
            a = acc[loop.vert]
            loop[col] = (a[0] / a[3], a[1] / a[3], a[2] / a[3], loop[col][3])


def vertex_normals(faces):
    """A sheet's smooth normal at each corner (area-weighted over the sheet's faces round it)."""
    acc = {}
    for f in faces:
        w = f.normal * max(f.calc_area(), 1e-9)
        for v in f.verts:
            if v in acc:
                acc[v] += w
            else:
                acc[v] = w.copy()
    return {v: (n.normalized() if n.length > 1e-12 else Vector((0.0, 0.0, 1.0))) for v, n in acc.items()}


# ---------------------------------------------------------------------------
# Materials (the Blender side: what the scene review renders; the glTF export carries the
# factors, build.mjs embeds the maps)
# ---------------------------------------------------------------------------
def make_materials():
    import bpy

    mats = []
    for slot, name in enumerate(MATERIALS):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        attr = nt.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'Col'
        spec = CONFIG['materials'].get(name)
        if spec:
            bsdf.inputs['Roughness'].default_value = spec['roughness']
            bsdf.inputs['Metallic'].default_value = 0.0
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = bpy.data.images.load(os.path.join(HERE, spec['color']), check_existing=True)
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(tex.outputs['Color'], mix.inputs[6])
            nt.links.new(attr.outputs['Color'], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            if spec.get('normal'):
                tn = nt.nodes.new('ShaderNodeTexImage')
                tn.image = bpy.data.images.load(os.path.join(HERE, spec['normal']), check_existing=True)
                tn.image.colorspace_settings.name = 'Non-Color'
                nm = nt.nodes.new('ShaderNodeNormalMap')
                nm.inputs['Strength'].default_value = spec['normalStrength']
                nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
                nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        else:
            rough, metal, emission = PLAIN_SPECS[slot]
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
            if emission:
                nt.links.new(attr.outputs['Color'], bsdf.inputs['Emission Color'])
                bsdf.inputs['Emission Strength'].default_value = emission
        mat.use_backface_culling = True
        mats.append(mat)
    return mats


def show_headroom(mats):
    """For the review scene only (build_tavern.py --save, after the export): multiply each painted
    material's colour attribute by the runtime's vertex_colour_scale(), so Blender draws what the
    game draws. Never before the export: the exporter reads its vertex colours off this graph."""
    scale = vertex_colour_scale()
    for mat in mats:
        if mat.name not in CONFIG['materials']:
            continue
        nt = mat.node_tree
        attr = next(n for n in nt.nodes if n.type == 'VERTEX_COLOR')
        mix = next(n for n in nt.nodes if n.type == 'MIX')
        up = nt.nodes.new('ShaderNodeVectorMath')
        up.operation = 'SCALE'
        up.inputs['Scale'].default_value = scale
        nt.links.new(attr.outputs['Color'], up.inputs[0])
        nt.links.new(up.outputs['Vector'], mix.inputs[7])
