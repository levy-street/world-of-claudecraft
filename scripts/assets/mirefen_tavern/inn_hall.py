"""The hall's four walls (build_tavern.py calls build(B, parts)): a battered stone storey on a
plinth that runs down into the falling ground, a half-timbered upper storey over it (jettied out
over the front, flush along the sides and the back) up under the eaves of the roof that runs
along the road; the cross gable climbing over the door; the two gable ends, each jettied out on
its own bressumer up under the verge (the right one carrying the wall fire's chimney, the left
the loft door and its hay hoist); and everything that hangs on a wall: its windows, its quoins,
its doors, the job board.

The walls stand where the sim's colliders stand (content/mirefen_tavern.ts through layout.json):
the outer faces on the hall's box (x +-16, z +-14), the inner faces 0.8 in (x +-15.2, z +-13.2),
the doorway (4.6 x 5.2) through the front, the arch onto the tower's nook and the kitchen's
serving hatch through the back. Only those three go through; every window is laid on its wall
(a deep stone or timber surround round a glowing pane), so the walls stay a few big bowed faces.

The timbering is framed the way a carpenter frames a box-framed house, the same on every face
(frame_storey, and the gables' trusses): a sill along the stone (on the front, on the jetty's
bressumer), posts on a regular bay grid that lines up with the corners and the windows, a girt
along the windows' sills, a head rail over their heads, the wall plate on top; the windows
framed in their bays; a curved tension brace only in each end bay, from the corner post's head
down onto the girt (a mirrored pair a face). The front and the back share their grid (each pair
of posts a cross frame under the roof), symmetric about the door: a post over the door's middle,
the door bay's posts, the cross gable's corners, three even bays on out to each corner. The
gable ends have eight even bays each, symmetric about the ridge's line. Each gable is a truss
whose members meet: its tie (the bressumer it jetties out on), its rafters up under the verge,
queen posts, a collar and a king post over it, raking struts where the windows leave room (the
cross gable's, the wing's). The frame is never ruler-straight, but only as a whole: each face
has settled (its middle sagged, leaning out a touch as it rises, inn_kit.Settled) and racked a
hair (Racked, a slow drift along the wall), so neighbouring posts lean together.

The front wall is three parts (the door's bay, and either side of it, meeting at TAVERN
FRONT_SPLIT) so a camera at an angle to the door ghosts only the side between it and the player:
every skin on the front is built in three runs that meet on those lines, and every piece on the
front goes to the part its middle stands in (a post on the split goes with the side).

Inside, the common room is lined as a rich old timbered inn is (Lining, in warm oiled oak): a
wainscot of boards round all four walls from the floor (or the stage's and the bar platform's
decks) up to a capping rail under the low windows' sills, stopping at the doorway's swung-back
leaves, the arch and the wall fire's breast, dipping under the hatch's sill board and the job
board, running on behind the furniture; and over it plain plaster up to the timbers that carry
the roof: the wall plate along the eave walls' tops under the eaves (the hammer-beam trusses
landing on it), a lintel over the doorway, and on each gable end its truss against the face, the
tie along the gable's foot, a rafter up each side under the roof's slope, a king post up the
ridge's line and two struts, standing aside for whatever the walls carry. Each wall's panelling
goes to the part its plaster is in, so it fades with it.
"""
import bisect
import itertools
import math

from mathutils import Vector

import inn_kit as K
from inn_kit import (DRESSED, DRESSED_T, GLOW, IRON, METAL, OAK, PANE, PANE_DIM, PLASTER, PLASTER_IN, PLASTER_T,
                     ROOF, SLATE, STONE, STONE_T, TIMBER, Wall, hash01, jit, vnoise)
from inn_roof import CROSS_HALF, Roof

# heights (yards over the ground floor)
JETTY = 5.9         # the upper storey's sill (layout jetty.y)
GABLE_JETTY = 0.3   # the cross gable's own small jetty over the upper storey
SIDE_JETTY = 0.4    # the gable ends' jetty over their storey
SIDE_PLATE = 9.5    # the gable ends' storey runs up to here, where the gable jetties out
INNER_BAND = 9.4    # the inner faces' last course, from here up under the sarking
TOP_STONE = JETTY   # the stone storey runs up to the jetty all round
SILL_TOP = TOP_STONE + 0.28  # the oak sill along the top of the stone (sill_cap): the posts' feet
SHAFT_TOP = 20.95   # the wall fire's chimney shaft, up past the right verge
SHAFT_HALF = 1.1    # its half width along the gable (inside the verge's notch, inn_roof.NOTCH_HALF)
SHAFT_REACH = 1.85  # its reach out of the gable (out to the verge's edge, ROOF_VERGE_OUT)
LOFT_SILL = 13.9    # the left gable's loft door, under the hay hoist
LOFT_HALF = 0.9
# the frames' rails: the casements stand on the girt (its top) up under the head rail (its
# underside); the front's storey sits higher, on its jetty
WIN_SILL = 7.1      # the front storey's girt
WIN_HEAD = 8.55     # ... and its head rails
STOREY_SILL = 6.9   # the gable ends' storeys and the back's
STOREY_HEAD = 8.4
GABLE_SILL = 10.8   # the gable ends' girt (their windows' sills)
GABLE_MID = 13.85   # their middle rail (the loft door stands on it)
GABLE_COLLAR = LOFT_SILL + 3.15  # their collar (the hay hoist's beam runs out of the left one through it)
ROSE_V = 13.1       # the rose window in the cross gable, between its queen posts
ROSE_R = 1.45

# the oak members: (face across, depth out of the plaster)
POST = (0.26, 0.2)
CORNER = (0.32, 0.22)
QUEEN = (0.32, 0.22)  # a truss's king and queen posts, stouter than the studs between them
STUD = (0.22, 0.18)   # a gable's lesser posts
GIRT = (0.2, 0.17)
RAIL = (0.18, 0.16)   # a gable's rails
HEAD = (0.17, 0.16)
PLATE = (0.28, 0.22)
SILL = (0.18, 0.24)   # the front storey's sill, on the bressumer
BRACE = (0.21, 0.15)
RAFTER = (0.3, 0.2)
COLLAR = (0.28, 0.19)
STRUT = (0.2, 0.15)
# how far out of the plaster's line each lies (its middle): the plates and sills a hair proudest
# (a post's head and foot die into them), then the posts, the rails a hair behind them (a rail's
# end dies into the post it meets), the braces and struts behind both; a rafter stands a hair
# proud of the posts that die into it (RAFTER_W more than the posts). No two meet face to face.
POST_W, RAIL_W, BRACE_W, PLATE_W, RAFTER_W = 0.07, 0.055, 0.045, 0.085, 0.03

# ---- the common room's panelling (Lining): the inner faces lined as a rich old timbered inn's
# the oak indoors, oiled by the years, warm and brown. It wears the frame's map (the town's
# weathered oak, moss in its grain: tavern_texture.py), so it takes the furniture's strong warm
# tint (inn_furnish.OAK) that turns the moss to an amber grain (a tint is eased toward the map's
# own value: build_tavern.eased); the wainscot's boards a touch darker than the frame over them
OAK_IN = (0.95, 0.66, 0.42)
FRAME_TONE = 1.0      # the frame's posts, rails, plates and braces
WAIN_TONE = 0.95      # the wainscot's stiles, its capping rail and its skirting
BOARD_TONE = 0.86     # its boards
# the wainscot (over the floor under it): its capping rail's top, a hair under the low windows'
# inner sill ledges (inner_window: the sill 2.5, its ledge from 2.33), the rail's depth, the
# skirting's height, the stiles' width and how far apart they stand (a bay of boards between two
# is always taller than it is wide, so the boards' grain runs up it: tavern_texture.Frame)
CAP_TOP = 2.32
CAP_H = 0.12
SKIRT_H = 0.3
STILE_W = 0.16
STILE_STEP = 1.45
# how far each piece's front stands out into the room: the wainscot's boards, the odd one a hair
# proud of them, its stiles and its skirting off its plumb face line (the plaster's highest point
# behind it: Lining.plumb), its capping rail off the plaster's face where the plaster meets it;
# the frame's posts off the plaster's own face (its belly, at most 0.03 either way of the wall's
# line), and its rails, plates and braces a hair behind them (a rail dies into the post it meets).
# Nothing over the wainscot stands 0.08 off the wall's line, so a piece hung 0.09 off it
# (inn_props.STANDOFF) hangs clear of it. Each piece's back is let a hand into the plaster (SUNK;
# it has no back face: nothing sees it)
PANEL_OUT, BOARD_OUT, STILE_OUT, SKIRT_OUT, CAP_OUT = 0.013, 0.022, 0.036, 0.042, 0.07
FRAME_OUT, RAIL_OUT = 0.05, 0.042
SUNK = -0.025
# the roof's timbers on the inner faces, across their faces: a king post, the wall plate (a
# gable's tie and its rafters), a strut
IN_POST, IN_PLATE, IN_BRACE = 0.26, 0.26, 0.2
# the job board's boarded face on the left wall by the door (_job_board): from u0 to u1 along the
# wall (z), from v0 up to v1 (its frame, hood and notices round it); the panelling stands aside
JOB_BOARD = (10.2, 12.8, 1.8, 3.9)


def front_part(u, split):
    if u < -split:
        return 'HallWallFrontLeft'
    if u > split:
        return 'HallWallFrontRight'
    return 'HallWallFront'


def front_posts(x1, cx, split, corner=None):
    """The front's (and the back's) posts along x, symmetric about the door: one over the door's
    middle, the door bay's posts on the split, the cross gable's corners, three even bays on out
    to each corner (the corner post `corner` from the middle, a hand in from the wall's end)."""
    corner = x1 - 0.12 if corner is None else corner
    us = [0.0, split, cx, cx + (x1 - cx) / 3, cx + (x1 - cx) * 2 / 3, corner]
    return sorted([-u for u in us if u > 0] + us)


def build(B, parts):
    H = B.HALL
    W = Hall(B, parts)
    W.front()
    W.side(-1)
    W.side(1)
    W.back()
    return H


class Racked:
    """A timbered face whose frame has racked a touch over the years: through its storey (v0 up
    to v1) every point drifts along the wall by its height times a slow lean that wanders along
    it (neighbouring posts lean together, never each its own way); over the storey whatever is
    built on it (a gable) rides on it as it stands. Same interface as inn_kit.Wall."""

    def __init__(self, wall, v0, v1, lean, seed, scale=8.0):
        self.wall = wall
        self.n, self.d, self.length = wall.n, wall.d, wall.length
        self.v0, self.v1, self.lean, self.seed, self.scale = v0, v1, lean, seed, scale

    def pt(self, u, v, w=0.0):
        h = min(max(v - self.v0, 0.0), self.v1 - self.v0)
        return self.wall.pt(u + self.lean * vnoise(u / self.scale, 0.0, self.seed) * h, v, w)

    def xz(self, u, w=0.0):
        return self.wall.xz(u, w)


class Plaster:
    """An inner face's plaster as its skins lay it (K.skin: a grid over its u and v breaks, each
    corner depth(u, v) into the room off the wall's line, a skin's `top` pulling its last row down
    under the sarking): how far into the room the face stands at (u, v), read off the grid's own
    cells, so whatever is laid on it lies on the face the room sees, never off it nor in it.
    `layers` are (us, vs, depth, top), rising, the first that reaches v answering; flat(u, v) true
    where the face lies on the wall's own line (over the doorway, over the arch)."""

    def __init__(self, layers, flat=None):
        self.layers = layers
        self.flat = flat

    def __call__(self, u, v):
        if self.flat is not None and self.flat(u, v):
            return 0.0
        for k, (us, vs, depth, top) in enumerate(self.layers):
            if v <= vs[-1] + 1e-9 or k == len(self.layers) - 1:
                return self._on(us, vs, depth, top, u, v)
        return 0.0

    @staticmethod
    def _on(us, vs, depth, top, u, v):
        u = min(max(u, us[0]), us[-1])
        i = max(0, min(len(us) - 2, bisect.bisect_right(us, u) - 1))
        at = []
        for uc in (us[i], us[i + 1]):
            rows = vs
            if top is not None:
                t = max(vs[0], min(vs[-1], top(uc)))
                rows = [vs[0] + (t - vs[0]) * (r - vs[0]) / (vs[-1] - vs[0]) for r in vs]
            vv = min(max(v, rows[0]), rows[-1])
            j = max(0, min(len(rows) - 2, bisect.bisect_right(rows, vv) - 1))
            s = (vv - rows[j]) / max(1e-9, rows[j + 1] - rows[j])
            at.append(depth(uc, rows[j]) * (1.0 - s) + depth(uc, rows[j + 1]) * s)
        s = (u - us[i]) / max(1e-9, us[i + 1] - us[i])
        return at[0] * (1.0 - s) + at[1] * s


class Lining:
    """The panelling on one of the common room's inner faces, as a rich old timbered inn is lined:
    a wainscot of oak boards from the floor up to a capping rail under the low windows' sills (a
    skirting at its foot, stiles every pace or so, the boards between them in the paint, the odd
    one a hair proud), and over it only the timbers that carry the roof (the wall plate up under
    the eaves, a gable's truss), the plaster plain between. Everything lies on the plaster's own
    face (Plaster), so it never stands off it nor sinks into it, and nothing is ruler-straight: the
    stiles and the king posts lean a hair, the boards' tones differ. Each piece is let into
    the plaster at its back (no back face) and dies into what it meets (no end faces but where it
    stops in the open).

    The face (`wall`, an inner Wall: u along it, w out of the room) carries what the frame stands
    aside for in `holds` ((u0, u1, v0, v1): its windows, its doors and openings, the wall fire's
    breast, the trusses' feet, the job board, the stage's hangings, the bar's racks). part(u) is
    the part a piece whose middle stands at u goes to; floor(u) the floor's height at its foot
    (a deck's bevels bend it at `kinks`)."""

    def __init__(self, wall, plaster, part, floor, seed, holds=(), kinks=()):
        self.wall, self.plaster, self.seed = wall, plaster, seed
        self.part = part if callable(part) else (lambda u: part)
        self.floor = floor
        self.kinks = sorted(kinks)
        self.holds = list(holds)
        # the plaster's own breaks (its lowest skin's): its face is flat between them
        self.cols, self.rows = plaster.layers[0][0], plaster.layers[0][1]
        self.inward = -wall.n

    def cols_at(self, v):
        """The plaster's own u breaks at height v (the skin there: a gable's has its own)."""
        for (us, vs, _, _) in self.plaster.layers:
            if v <= vs[-1] + 1e-9:
                return us
        return self.plaster.layers[-1][0]

    def rows_at(self, u):
        """The plaster's own v breaks up the face at u (a skin pulled down under the roof has
        its rows pulled down with it)."""
        rows = set()
        for (_, vs, _, top) in self.plaster.layers:
            if top is None:
                rows.update(vs)
            else:
                t = max(vs[0], min(vs[-1], top(u)))
                rows.update(vs[0] + (t - vs[0]) * (r - vs[0]) / (vs[-1] - vs[0]) for r in vs)
        return sorted(rows)

    def pt(self, u, v, out, ref=None):
        """A point `out` into the room off the plaster's face at (u, v) (or off ref(u, v))."""
        return self.wall.pt(u, v, -((ref or self.plaster)(u, v) + out))

    def plumb(self, u):
        """The wainscot's face line at u: the plaster's highest point from the floor up to the
        capping rail there, so the boards stand plumb in front of every hand of it (wood stands
        flatter than plaster) and it never shows through them."""
        lo, hi = self.floor(u) - 0.05, CAP_TOP
        return max(self.plaster(u, v) for v in [lo, hi] + [r for r in self.rows if lo < r < hi])

    def _along(self, du, dv):
        """A direction in the face (du along it, dv up), in the game frame."""
        d = self.wall.d
        return Vector((d.x * du, dv, d.z * du))

    @staticmethod
    def _quad(p, verts, want, faces):
        try:
            f = p.bm.faces.new(verts)
        except ValueError:
            return
        f.normal_update()
        if f.normal.dot(K.P(*want)) < 0:
            f.normal_flip()
        faces.append(f)

    # ------------------------------------------------------------ pieces
    def member(self, pts, width, out, color, back=SUNK, edges=(True, True), caps=(False, False), part=None,
               ref=None):
        """One oak piece along `pts` ((u, v) on the face): `width` across it in the face, its front
        `out` and its back `back` off the plaster's face wherever it lies (or off ref(u, v)). edges
        are its two long sides (the one on its left going along it, then its right: on a level
        piece laid toward +u, its underside and its top), caps its two ends."""
        p = part if part is not None else self.part(sum(q[0] for q in pts) / len(pts))
        n = len(pts)
        rings = []
        for i, (u, v) in enumerate(pts):
            (ua, va), (ub, vb) = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
            ln = math.hypot(ub - ua, vb - va)
            au, av = -(vb - va) / ln, (ub - ua) / ln
            rings.append([p.bm.verts.new(K.P(*self.pt(u + s * au * width / 2, v + s * av * width / 2, d, ref)))
                          for (s, d) in ((-1.0, back), (-1.0, out), (1.0, out), (1.0, back))])
        faces = []
        for i in range(n - 1):
            a, b = rings[i], rings[i + 1]
            (u0, v0), (u1, v1) = pts[i], pts[i + 1]
            ln = math.hypot(u1 - u0, v1 - v0)
            side = self._along(-(v1 - v0) / ln, (u1 - u0) / ln)
            self._quad(p, [a[1], a[2], b[2], b[1]], self.inward, faces)
            if edges[0]:
                self._quad(p, [a[0], a[1], b[1], b[0]], -side, faces)
            if edges[1]:
                self._quad(p, [a[2], a[3], b[3], b[2]], side, faces)
        for k, (ring, i, j) in enumerate(((rings[0], 0, 1), (rings[-1], n - 1, n - 2))):
            if caps[k]:
                (u0, v0), (u1, v1) = pts[i], pts[j]
                self._quad(p, list(ring), self._along(u0 - u1, v0 - v1), faces)
        p.paint(faces, color, TIMBER)
        for f in faces:
            f[p.soft] = 0
        return faces

    def _cuts(self, u0, u1, v=0.0):
        """Lines from u0 to u1 through every one of the plaster's own at height v (and the floor's
        bends) between them: a piece laid along the face through them lies parallel to it, never
        in it."""
        us = {round(u0, 4), round(u1, 4)}
        us.update(round(c, 4) for c in list(self.cols_at(v)) + list(self.kinks) if u0 + 0.03 < c < u1 - 0.03)
        return sorted(us)

    def boards(self, u0, u1, top, color, out=PANEL_OUT):
        """A bay of boards from u0 to u1 (the stiles' middles), from under the skirting's top up
        to `top` under the capping rail, plumb on the wainscot's face line: one face, its own
        stretch of the map, the boards painted in it running up it (a bay is taller than it is
        wide, tavern_texture.Frame)."""
        p = self.part((u0 + u1) / 2)
        cols = self._cuts(u0, u1)
        grid = [[p.bm.verts.new(K.P(*self.pt(u, v, out, lambda a, b: self.plumb(a))))
                 for v in (self.floor(u) + 0.1, top)] for u in cols]
        faces = []
        for i in range(len(cols) - 1):
            self._quad(p, [grid[i][0], grid[i + 1][0], grid[i + 1][1], grid[i][1]], self.inward, faces)
        p.paint(faces, color, TIMBER)
        for f in faces:
            f[p.soft] = 1
        return faces

    def wainscot(self, u0, u1, seed, top=None, open0=False, open1=False, ends=(True, True)):
        """A run of wainscot from u0 to u1: its bays of boards between stiles every pace or so (one
        a hand in from each end, unless a neighbouring run's stands there: ends), the skirting along
        its foot over the floor and the capping rail along its top; an end in the open (open0,
        open1: the doorway's, the arch's) closed by the rail's and the skirting's end faces, one
        into a corner or a breast left open. top: under a capping rail of its own (None), or the
        height its boards stop at under whatever caps them instead (the hatch's sill board, the job
        board's bottom rail)."""
        capped = top is None
        board_top = CAP_TOP - CAP_H + 0.05 if capped else top
        stile_top = CAP_TOP - CAP_H + 0.03 if capped else top
        hw = STILE_W / 2
        c0, c1 = (u0 + hw if ends[0] else u0), (u1 - hw if ends[1] else u1)
        # (every bay narrower than it is tall)
        tall = board_top - max(self.floor(u0), self.floor(u1)) - 0.1
        n = max(1, round((c1 - c0) / STILE_STEP), math.ceil((c1 - c0) / (0.86 * tall)))
        cs = [c0] + [c0 + (c1 - c0) * k / n + jit(0.06, seed, k) for k in range(1, n)] + [c1]
        trim = K.tint(OAK_IN, WAIN_TONE, seed, 1, spread=0.05)

        def plumb(u, v):
            return self.plumb(u)

        for k in range(n):
            a, b = cs[k], cs[k + 1]
            self.boards(a, b, board_top, K.tint(OAK_IN, BOARD_TONE, seed, 2, k, spread=0.08))
            # the odd board a hair proud of its fellows, shrunk or swollen a little off them
            if hash01(seed, 3, k) < 0.45 and b - a > 0.8:
                w = 0.34 + 0.2 * hash01(seed, 4, k)
                c = a + w / 2 + 0.1 + (b - a - w - 0.2) * hash01(seed, 5, k)
                self.boards(c - w / 2, c + w / 2, board_top - 0.01,
                            K.tint(OAK_IN, BOARD_TONE * (0.9 + 0.2 * hash01(seed, 6, k)), seed, 7, k), out=BOARD_OUT)
        for k, c in enumerate(cs):
            if (k == 0 and not ends[0]) or (k == n and not ends[1]):
                continue
            foot = self.floor(c) + SKIRT_H - 0.03
            # (its sides are a hair deep over the boards: the paint carries its edges)
            self.member([(c, foot), (c + jit(0.012, seed, 8, k), stile_top)], STILE_W * (1.0 + jit(0.08, seed, 9, k)),
                        STILE_OUT, trim, back=PANEL_OUT - 0.004, edges=(False, False), ref=plumb)
        # the skirting over the floor (bending with it where a deck's bevel runs down to the boards)
        self.member([(u, self.floor(u) + (SKIRT_H - 0.04) / 2) for u in self._cuts(u0, u1)], SKIRT_H + 0.04,
                    SKIRT_OUT, trim, edges=(False, True), caps=(open0, open1), ref=plumb)
        if capped:
            # the capping rail, its top a hair under CAP_TOP wherever it wanders: on the plaster's
            # face where it meets it over the wainscot, and always proud of the stiles under it
            def cap(u, v):
                return max(self.plaster(u, CAP_TOP), self.plumb(u) - 0.021)

            self.member([(u, CAP_TOP - CAP_H / 2 - 0.006 * (1.0 + vnoise(u / 1.7, 0.0, seed + 10)))
                         for u in self._cuts(u0, u1)], CAP_H, CAP_OUT, K.tint(OAK_IN, WAIN_TONE * 1.05, seed, 11),
                        back=-0.05, caps=(open0, open1), ref=cap)

    # ------------------------------------------------------------ the frame
    def free(self, lo, hi, a0, a1, upright):
        """The stretches of [lo, hi] a piece may stand in, one standing upright (lo, hi up the face,
        a0..a1 its width along it) or lying level (lo, hi along it, a0..a1 its height), clear of
        every hold; none shorter than a hand or so."""
        cuts = []
        for (u0, u1, v0, v1) in self.holds:
            if upright and u0 < a1 and u1 > a0:
                cuts.append((v0, v1))
            elif not upright and v0 < a1 and v1 > a0:
                cuts.append((u0, u1))
        out, at = [], lo
        for (c, d) in sorted(cuts):
            if d <= at or c >= hi:
                continue
            if c > at + 0.35:
                out.append((at, c))
            at = max(at, d)
        if hi > at + 0.35:
            out.append((at, hi))
        return out

    def post(self, u, v0, v1, seed, width=IN_POST, lean=0.008):
        """A post at u up the face from v0 to v1 (wherever the holds leave it room), leaning a hair
        with the posts beside it (the face has racked as a whole, never post by post), bending
        with the plaster's belly at its rows."""
        tilt = lean * vnoise(u / 8.0, 0.0, self.seed)
        rows = self.rows_at(u)
        for (a, b) in self.free(v0, v1, u - width / 2, u + width / 2, True):
            vs = [a]
            for r in rows:
                if vs[-1] + 1.4 < r < b - 0.7:
                    vs.append(r)
            vs.append(b)
            self.member([(u + tilt * (v - v0), v) for v in vs], width * (1.0 + jit(0.06, seed, 1)), FRAME_OUT,
                        K.tint(OAK_IN, FRAME_TONE, seed, 2), part=self.part(u))

    def plate(self, top, u0, u1, seed, stops=()):
        """The wall plate along the top of the face (its top at top(u), up under the sarking or the
        gable's last course), standing aside for the hammer beams it meets."""
        for (a, b) in self.free(u0, u1, min(top(u0), top(u1)) - IN_PLATE, max(top(u0), top(u1)), False):
            cuts = [a] + [s for s in stops if a + 0.05 < s < b - 0.05] + [b]
            for c, d in itertools.pairwise(cuts):
                # (its top stands up under the sarking or the gable's last course: never seen)
                self.member([(u, top(u) - IN_PLATE / 2) for u in self._cuts(c, d, v=top(c))], IN_PLATE, RAIL_OUT,
                            K.tint(OAK_IN, FRAME_TONE * 0.94, seed, c), edges=(True, False),
                            caps=self._ends(c, d, u0, u1, stops), part=self.part((c + d) / 2))

    @staticmethod
    def _ends(c, d, u0, u1, stops):
        """Which ends of a length from c to d a hold cut (the rest run into a corner or meet the
        next part's length at a split): those take their end faces."""
        def cut(e):
            return all(w is None or abs(e - w) > 1e-6 for w in (u0, u1)) and all(abs(e - s) > 1e-6 for s in stops)
        return (cut(c), cut(d))

    def clear(self, u, v, half):
        """Whether a piece's section `half` either side of (u, v) stands clear of every hold."""
        return all(not (h[0] < u + half and h[1] > u - half and h[2] < v + half and h[3] > v - half)
                   for h in self.holds)

    def beam(self, line, u0, u1, width, seed, steps=0.8, tone=0.94, out=RAIL_OUT):
        """A timber along a line v = line(u) from u0 to u1 (a rafter under the roof's slope, a
        strut), laid in short lengths so it follows the line and the plaster under it, broken
        where it meets a hold (the flue's breast going up through the roof) and its ends closed
        there."""
        n = max(1, math.ceil(abs(u1 - u0) / steps))
        us = [u0 + (u1 - u0) * k / n for k in range(n + 1)]
        runs, run = [], []
        for u in us:
            if self.clear(u, line(u), width / 2):
                run.append(u)
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
        for r in runs:
            if len(r) < 2:
                continue
            self.member([(u, line(u)) for u in r], width, out, K.tint(OAK_IN, FRAME_TONE * tone, seed, r[0]),
                        caps=(r[0] != us[0], r[-1] != us[-1]), part=self.part((r[0] + r[-1]) / 2))

    def truss(self, roof, rz, u0, u1, tie, seed):
        """A gable end's truss against its face, as the room's own trusses stand under the roof: a
        rafter up each side under the roof's slope (roof(u): its underside, a hand under the
        sarking) from the corners to the ridge, a king post up the ridge's line from the tie (the
        plate along the gable's foot, its top at `tie`) into the rafters' meeting, and a strut from
        the king post's foot up to each rafter's middle, each standing aside for what the face
        carries."""
        def rafter(u):
            return roof(u) - IN_PLATE / 2

        self.beam(rafter, u0, rz, IN_PLATE, seed + 1)
        self.beam(rafter, rz, u1, IN_PLATE, seed + 2)
        self.post(rz, tie - 0.03, roof(rz) - IN_PLATE + 0.06, seed + 3, width=IN_POST)
        foot = tie + 0.45
        for k, end in enumerate((u0, u1)):
            s = 1.0 if end > rz else -1.0
            a = rz + s * (IN_POST / 2 + 0.06)
            b = rz + (end - rz) * 0.48
            top = roof(b) - IN_PLATE + 0.04

            def strut(u, a=a, b=b, top=top):
                return foot + (top - foot) * (u - a) / (b - a)

            if all(self.clear(u, strut(u), IN_BRACE / 2) for u in (a + (b - a) * t / 8 for t in range(9))):
                self.beam(strut, a, b, IN_BRACE, seed + 5 + k, steps=99.0, tone=0.96, out=RAIL_OUT - 0.004)


class Hall:
    def __init__(self, B, parts):
        self.B = B
        self.parts = parts
        self.H = B.HALL
        self.split = B.FRONT_SPLIT
        self.t = self.H['wall']
        self.door = B.LAYOUT['door']
        self.arch = B.LAYOUT['arch']
        self.hatch = B.LAYOUT['hatch']
        # the roof's one surface (inn_roof.py): every wall's top and every gable's rake samples it
        self.roof = Roof(B, {})

    # ------------------------------------------------------------------ helpers
    def stone_depth(self, wall, seed, ground):
        """The stone face's bow and its battered foot: a slow belly along the wall, and the
        bottom courses leaning out where the ground falls away under them."""
        def depth(u, v):
            g = ground(u)
            foot = max(0.0, 1.0 - (v - g) / 1.6)
            batter = 0.34 * K._fade(min(1.0, foot))
            bow = 0.06 * vnoise(u / 4.2, v / 3.1, seed) + 0.012 * vnoise(u / 1.3, v / 1.1, seed + 7)
            return batter + bow
        return depth

    def plaster_depth(self, seed, amp=0.045):
        """The plaster's slow belly between its timbers (one soft swell a bay, never a ripple)."""
        def depth(u, v):
            return amp * vnoise(u / 2.4, v / 1.9, seed)
        return depth

    @staticmethod
    def v_at(wall, u, y, w=0.0):
        """How far up a settled face the point at u standing at world height y is (a timber
        set against the roof's underside follows the roof, not the face's settle)."""
        v = y
        for _ in range(3):
            v += y - wall.pt(u, v, w).y
        return v

    @staticmethod
    def meet(f, v, u_in, u_out):
        """Where a level line at v meets a falling line f(u) (a rafter's underside), between u_in
        (f over v there) and u_out (f under it)."""
        a, b = u_in, u_out
        for _ in range(30):
            m = (a + b) / 2
            if f(m) > v:
                a = m
            else:
                b = m
        return (a + b) / 2

    # ============================================================ the panelling
    def _deck(self, q, sgn, x, z):
        """A raised deck's walk height at (x, z) (inn_interior.py deck_h: the bar's platform, sgn
        -1, and the stage, 1): its lift, falling over its rim off its open edges."""
        ox = max(0.0, q['x0'] - x) if sgn < 0 else max(0.0, x - q['x1'])
        oz = max(0.0, z - q['z1'])
        return q['lift'] * max(0.0, 1.0 - math.hypot(ox, oz) / q['rim'])

    def _stood_against(self, x=None, z=None, kinds=('dressing', 'barrels'), reach=0.4):
        """What the sim stands against an inner face (the bar's racks, the dresser, the barrels),
        as holds on it ((u0, u1, v0, v1), u along the face): its footprint along the face, from
        the floor to its top. x (a gable's inner face) or z (the front's or the back's)."""
        holds = []
        for q in self.B.LAYOUT['props']:
            if q['kind'] not in kinds:
                continue
            c, s = math.cos(q['rot']), math.sin(q['rot'])
            pts = [(q['x'] + a * c + b * s, q['z'] - a * s + b * c)
                   for a in (-q['hw'], q['hw']) for b in (-q['hd'], q['hd'])]
            xs, zs = [p[0] for p in pts], [p[1] for p in pts]
            top = q['base'] + q['height'] + 0.02
            if x is not None and min(abs(x - min(xs)), abs(x - max(xs))) < reach:
                holds.append((min(zs) - 0.05, max(zs) + 0.05, -1.0, top))
            if z is not None and min(abs(z - min(zs)), abs(z - max(zs))) < reach:
                holds.append((min(xs) - 0.06, max(xs) + 0.06, -1.0, top))
        return holds

    def _truss_feet(self, foot):
        """The hammer-beam trusses' feet on an eave wall as holds (inn_interior.py _truss_end: the
        stone corbel under the wall post, the post up into the hammer beam): a rail stops a hand
        into the post or the beam, so it dies into it."""
        out = []
        for xt in self.H['trusses']:
            out += [(xt - 0.36, xt + 0.36, foot - 0.48, foot + 0.04), (xt - 0.17, xt + 0.17, foot, 99.0)]
        return out

    @staticmethod
    def _windows(us, sill, head, width):
        """An inner window as a hold (inner_window: its frame, its sill ledge under it and its
        head ledge over it, each running a hand past the frame)."""
        return [(u - width / 2 - 0.22, u + width / 2 + 0.22, sill - 0.175, head + 0.165) for u in us]

    def _line_front(self, inner, hw):
        """The front's inner face lined (Lining): the wainscot either side of the doorway out to
        the corners, stopping at the door's leaves swung back against it; a lintel over the
        doorway and the leaves; and the wall plate up under the eaves between the hammer beams'
        feet. Every piece goes to the part its middle stands in."""
        from inn_interior import FOOT_FRONT
        B, H, P = self.B, self.H, self.parts
        t, split = self.t, self.split
        x1 = H['x1'] - t
        R = self.roof
        plaster_in = self.plaster_depth(21.0, amp=0.03)
        us = sorted({u for (a, b) in ((-x1, -split), (-split, split), (split, x1))
                     for u in K.breaks(a, b, 2.0, keep=(-hw, hw))})
        vs = K.breaks(0.0, INNER_BAND, 1.6, keep=(1.0, 4.25, JETTY))
        plaster = Plaster([(us, vs, plaster_in, None), (us, [INNER_BAND, B.ROOF_EAVE + 1.2], lambda u, v: 0.0, None)],
                          flat=lambda u, v: abs(u) < hw and v <= JETTY + 1e-6)

        def part(u):
            return P[front_part(u * 1.01 if abs(abs(u) - split) < 1e-6 else u, split)]

        # the leaves swung back against the face reach out to 2hw - 0.05 (_doors): the wainscot
        # stops a hand past them, the lintel over the doorway runs a hand past that
        leaves = 2 * hw - 0.05 + 0.07
        lintel = (self.door['height'] + 0.035, self.door['height'] + 0.285)
        holds = [(-leaves, leaves, -1.0, lintel[1])]
        holds += self._windows((-12.6, -8.4, 8.4, 12.6), 2.5, 4.0, 1.4)
        holds += self._windows([u for (u, _) in self.front_windows()], 6.6, 8.4, 1.2)
        holds += self._truss_feet(FOOT_FRONT)
        holds += self._stood_against(z=H['z1'] - t)
        L = Lining(inner, plaster, part, lambda u: 0.0, 2100.0, holds)
        L.wainscot(-x1, -leaves, 2110.0, open1=True)
        L.wainscot(leaves, x1, 2120.0, open0=True)
        # the lintel over the doorway and its leaves, in its three parts
        for k, (a, b) in enumerate(((-leaves - 0.13, -split), (-split, split), (split, leaves + 0.13))):
            L.member([(a, sum(lintel) / 2 + jit(0.01, 2130, k)), (b, sum(lintel) / 2 + jit(0.01, 2130, k + 1))],
                     lintel[1] - lintel[0], FRAME_OUT, K.tint(OAK_IN, FRAME_TONE * 0.92, 2131, k),
                     caps=(a < -split, b > split), part=part((a + b) / 2))
        # the wall plate up under the eaves, where the roof comes down onto the wall, between the
        # hammer beams' feet
        L.plate(lambda u: R.under(u, H['z1'] - t) - 0.06, -x1, x1, 2190.0, stops=(-split, split))

    def _line_back(self, inner, us_in, vs_in, plaster_in, arch, hatch):
        """The back's inner face lined (Lining): the wainscot from the left corner along the stage
        to the arch, and from the arch along the bar's platform to the right corner (dipping under
        the hatch to its sill board); and the wall plate up under the eaves between the hammer
        beams' feet, standing aside for the arch, the hatch, the bar's racks and the stage's
        hanging."""
        from inn_interior import FOOT_BACK
        B, H, P = self.B, self.H, self.parts
        R = self.roof
        t = self.t
        x1 = H['x1'] - t
        z = H['z0'] + t
        a0, a1, ah = arch
        h0, h1, hs, hh = hatch
        st, pl = B.LAYOUT['stage'], B.LAYOUT['platform']

        def depth(u, v):
            return -plaster_in(u, v)

        plaster = Plaster([(us_in, vs_in, depth, None),
                           (us_in, [INNER_BAND, B.ROOF_EAVE + 1.2], depth, lambda u: R.under(u, z) + 0.12)],
                          flat=lambda u, v: a0 <= u <= a1 and v <= TOP_STONE + 1e-6)

        def floor(u):
            return max(self._deck(st, 1, u, z), self._deck(pl, -1, u, z))

        holds = [(a0 - 0.66, a1 + 0.6, -1.0, ah + 0.68), (h0 - 0.35, h1 + 0.35, hs - 0.15, hh + 0.3),
                 # the stage's hanging (inn_interior.py stage)
                 (st['x0'] + 0.9, st['x1'] - 0.9, -1.0, 6.15)]
        holds += self._truss_feet(FOOT_BACK)
        holds += self._stood_against(z=z)
        L = Lining(inner, plaster, P['HallWallBack'], floor, 3100.0, holds, kinks=(st['x1'], st['x1'] + st['rim']))
        L.wainscot(-x1, a0, 3110.0, open1=True)
        # (the hatch's frame posts stand on its sill board a hand either side of it: the rail dies
        # into them, the boards run on under the sill board)
        L.wainscot(a1, h0 - 0.1, 3120.0, open0=True)
        L.wainscot(h0 - 0.1, h1 + 0.1, 3125.0, top=hs - 0.07, ends=(False, False))
        L.wainscot(h1 + 0.1, x1, 3130.0)
        # the wall plate up under the eaves, between the hammer beams' feet
        L.plate(lambda u: R.under(u, z) - 0.06, -x1, x1, 3190.0)

    def _line_side(self, sx, inner, low_wins, fire):
        """A gable end's inner face lined (Lining): the wainscot from corner to corner (standing
        aside for the wall fire's breast on the right, dipping under the job board on the left,
        over the stage's or the bar platform's deck where they run into the wall); the tie along
        the gable's foot and the gable's truss over it (Lining.truss), standing aside for the
        windows, the breast and its flue, the bar beam's foot, the job board and the stage's
        hangings."""
        B, H, P = self.B, self.H, self.parts
        R = self.roof
        t = self.t
        x = sx * (H['x1'] - t)
        z0, z1 = H['z0'] + t, H['z1'] - t
        seed = 4000.0 + sx * 300
        plaster_in = self.plaster_depth(200 + sx * 17 + 4, amp=0.03)
        vs = K.breaks(0.0, INNER_BAND, 1.6, keep=(1.0, JETTY))
        plaster = Plaster([(K.breaks(z0, z1, 2.0), vs, plaster_in, None),
                           (K.breaks(z0, z1, 2.2, keep=(R.rz,)), K.breaks(INNER_BAND, 22.0, 2.6), plaster_in,
                            lambda u: R.under(x, u) + 0.12)])
        holds = self._windows(low_wins, 2.5, 4.0, 1.4) + self._windows(self.storey_inner(sx), 6.8, 8.3, 1.2)
        for (u, sill, hgt, w) in self.gable_windows(sx):
            holds += self._windows([u], sill + 0.25, sill + hgt - 0.05, w - 0.1)
        holds += self._stood_against(x=x)
        if sx > 0:
            q, zc = B.LAYOUT['platform'], fire['z']
            fz0, fz1 = zc - fire['hd'], zc + fire['hd']
            zp = next(p for p in B.LAYOUT['props'] if p['kind'] == 'pillar')['z']
            # the wall fire's breast (inn_interior.py fireplace: its lower breast to the mantel's
            # step, the upper a step narrower up to the set-off, the flue's breast over that), and
            # the bar beam's foot (_bar_foot: its corbel, and its wall post up into the beam)
            holds += [(fz0 + 0.05, fz1 - 0.05, -1.0, 2.8), (fz0 + 0.23, fz1 - 0.23, 2.75, 11.75),
                      (fz0 + 0.58, fz1 - 0.58, 11.2, 99.0), (zp - 0.36, zp + 0.36, 5.78, 6.32),
                      (zp - 0.18, zp + 0.18, 6.32, 11.0)]

            def floor(u):
                return self._deck(q, -1, x, u)

            kinks = (q['z1'], q['z1'] + q['rim'])
            # (a hand into the breast's sides)
            runs = [(z0, fz0 + 0.02, None), (fz1 - 0.02, z1, None)]
        else:
            q = B.LAYOUT['stage']
            win = -10.8
            jb0, jb1, jv0, jv1 = JOB_BOARD
            # the job board (_job_board: its frame, and its hood over it out to a hand off the
            # corner) and the stage's two hangings either side of its window (inn_interior.py stage)
            holds += [(jb0 - 0.4, z1, jv0 - 0.15, jv1 + 0.3), (z0 + 0.37, win - 0.9, -1.0, 5.6),
                      (win + 0.9, q['z1'] - 0.1, -1.0, 5.6)]

            def floor(u):
                return self._deck(q, 1, x, u)

            kinks = (q['z1'], q['z1'] + q['rim'])
            # (the boards run on under the board, its bottom rail capping them; the capping rail
            # either side dies into its frame's sides)
            runs = [(z0, jb0, None), (jb0, jb1, jv0 - 0.06), (jb1, z1, None)]
        L = Lining(inner, plaster, P['HallWallRight' if sx > 0 else 'HallWallLeft'], floor, seed, holds, kinks=kinks)
        for k, (a, b, top) in enumerate(runs):
            L.wainscot(a, b, seed + 10 + k, top=top, ends=(True, True) if top is None else (False, False))
        # the tie along the gable's foot, and the truss over it: its rafters up under the roof's
        # slope (a hand under the sarking), where the roof comes down onto the wall, the king post
        # up the ridge's line and its two struts
        def roof(u):
            return R.under(x, u) - 0.1

        L.plate(lambda u: INNER_BAND, z0, z1, seed + 90)
        L.truss(roof, R.rz, z0, z1, INNER_BAND, seed + 100)

    # ================================================================ front
    def front(self):
        B, H, P = self.B, self.H, self.parts
        z1, t = H['z1'], self.t
        split = self.split
        out = Wall(0.0, z1, 1.0, z1, (0.0, 1.0))           # the outer face, u = x
        inner = Wall(0.0, z1 - t, 1.0, z1 - t, (0.0, 1.0))  # the inner face plane
        hw = self.door['width'] / 2
        dh = self.door['height']
        spring, crown = 4.25, dh
        jetty = B.LAYOUT['jetty']['out']

        def ground(u):
            return B.ground(u, z1 + 0.4) - 0.7

        def arch_v(u):
            """The doorway's intrados (a flat segmental arch from its springing to its crown)."""
            k = max(0.0, 1.0 - (u / hw) ** 2)
            return spring + (crown - spring) * math.sqrt(k)

        stone = self.stone_depth(out, 11.0, ground)
        # everything from the jetty up has settled: its middle sagged, its face leaning out
        up = K.Settled(out, JETTY - 0.35, H['ridge'], sag=0.17, lean=0.15, half=H['x1'] + 0.6)
        # ---- the stone storey's outer face, in three runs (the doorway's whole bay left open:
        # the arch and the spandrels over it close the face round the doorway)
        runs = [(-H['x1'], -split), (-split, split), (split, H['x1'])]
        vs = K.breaks(0.0, TOP_STONE, 1.5, keep=(spring,))
        for (u0, u1) in runs:
            part = P[front_part((u0 + u1) / 2, split)]
            us = K.breaks(u0, u1, 2.0, keep=(-hw, hw))
            self._stone_face(part, out, us, vs, stone, ground,
                             hole=lambda a, b, c, d: (a >= -hw - 1e-6 and b <= hw + 1e-6),
                             seed=11.0)
            # under the floor: the plinth's courses down into the ground
            self._plinth(part, out, us, stone, ground, seed=13.0)
        # ---- the doorway: the arch over it on both faces, its soffit and its jambs
        C = P['HallWallFront']
        self._door_arch(C, out, inner, hw, spring, crown, arch_v, stone)
        # ---- the stone storey's inner face (plaster over a dressed skirting), in three runs
        plaster_in = self.plaster_depth(21.0, amp=0.03)
        for (u0, u1) in [(-H['x1'] + t, -split), (-split, split), (split, H['x1'] - t)]:
            part = P[front_part((u0 + u1) / 2, split)]
            us = K.breaks(u0, u1, 2.0, keep=(-hw, hw))
            self._inner_face(part, inner, us, 0.0, INNER_BAND, plaster_in,
                             hole=lambda a, b, c, d: (a >= -hw - 1e-6 and b <= hw + 1e-6 and d <= JETTY + 1e-6),
                             skirting=1.0, seed=21.0)
        # ---- the jetty: the upper storey thrown out over the front on its joists
        self._front_jetty(out, up, jetty, split)
        # ---- the upper storey's face and the gable over it
        self._front_upper(up, inner, jetty, split)
        # ---- the stone storey's windows, the quoins, the doors
        for u in (-12.6, -8.4, 8.4, 12.6):
            part = P[front_part(u, split)]
            self.arched_window(part, out, u, 2.1, 1.5, stone, seed=u)
            # (inside, the sill stands a hand higher, as on the gable ends: the wainscot's capping
            # rail runs under it)
            self.inner_window(part, inner, u, 2.5, 4.0, 1.4, seed=u + 50)
        for sx in (-1, 1):
            part = P[front_part(sx * 15.0, split)]
            self.quoins(part, (sx * H['x1'], z1), (0.0, 1.0), (sx, 0.0), ground(sx * H['x1']), TOP_STONE,
                        seed=31 + sx)
        self._doors(hw, arch_v, inner)
        # ---- the panelling inside
        self._line_front(inner, hw)

    def _stone_face(self, part, wall, us, vs, depth, ground, hole, seed):
        def cell(i, j, u0, u1, v0, v1):
            return K.tint(STONE_T, 1.0, seed, i, j, spread=0.04), STONE

        K.skin(part, wall, us, vs, depth, 1, cell, hole=hole)

    def _plinth(self, part, wall, us, depth, ground, seed):
        """The stone below the floor line down to the ground (the courses of the plinth)."""
        bottom = min(ground(u) for u in us) - 0.2

        def cell(i, j, u0, u1, v0, v1):
            return K.tint(STONE_T, 0.9, seed, i, j, spread=0.05), STONE

        def low(u):
            return ground(u)

        # a grid from the lowest ground up to the floor line; each column's foot pulled to the
        # ground under it (skin's `top` works on the last row, so the grid is built upside down)
        vs = [0.0, bottom]
        bm = part.bm
        rows = []
        for v in (0.0, None):
            row = []
            for u in us:
                vv = 0.0 if v is not None else low(u)
                row.append(bm.verts.new(K.P(*wall.pt(u, vv, depth(u, vv)))))
            rows.append(row)
        for i in range(len(us) - 1):
            quad = [rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]]
            try:
                f = bm.faces.new(quad)
            except ValueError:
                continue
            f.normal_update()
            if f.normal.dot(K.P(*wall.n)) < 0:
                f.normal_flip()
            c, m = cell(i, 0, us[i], us[i + 1], vs[1], vs[0])
            part.paint([f], c, m)
            f[part.soft] = 1

    def _inner_face(self, part, wall, us, v0, v1, depth, hole, skirting, seed):
        """An inner face: a dressed-stone skirting under limewashed plaster."""
        vs = K.breaks(v0, v1, 1.6, keep=(skirting, 4.25, JETTY))

        def cell(i, j, a, b, c, d):
            if d <= skirting + 1e-6:
                return K.tint(DRESSED_T, 0.92, seed, i, j, spread=0.04), DRESSED
            return K.tint(PLASTER_IN, 1.0, seed, i, j, spread=0.012), PLASTER

        def dep(u, v):
            return -depth(u, v)

        K.skin(part, wall, us, vs, dep, -1, cell, hole=hole)

    def _door_arch(self, C, out, inner, hw, spring, crown, arch_v, stone):
        """The doorway's dressed-stone arch: voussoirs round the intrados on the outer face, the
        soffit through the wall, the jambs' reveals, and the inner face's timber head."""
        n = 9
        t = self.t
        # the band of wall over the arch on the outer face (spandrels): from the intrados up to
        # the storey's top, closing the stone face round the arch
        for i in range(n):
            ua = -hw + 2 * hw * i / n
            ub = -hw + 2 * hw * (i + 1) / n
            va, vb = arch_v(ua), arch_v(ub)
            pts = [out.pt(ua, va, stone(ua, va)), out.pt(ub, vb, stone(ub, vb)),
                   out.pt(ub, TOP_STONE, stone(ub, TOP_STONE)), out.pt(ua, TOP_STONE, stone(ua, TOP_STONE))]
            K.face(C, pts, (0.0, 0.0, 1.0), K.tint(STONE_T, 1.0, 41, i), STONE, soft=True)
            # the inner face over the doorway
            pin = [inner.pt(ua, va, 0.0), inner.pt(ub, vb, 0.0), inner.pt(ub, TOP_STONE, 0.0),
                   inner.pt(ua, TOP_STONE, 0.0)]
            K.face(C, pin, (0.0, 0.0, -1.0), K.tint(PLASTER_IN, 1.0, 42, i), PLASTER)
            # the soffit under the arch, through the wall's depth
            soff = [out.pt(ua, va, stone(ua, va)), out.pt(ub, vb, stone(ub, vb)),
                    inner.pt(ub, vb, 0.0), inner.pt(ua, va, 0.0)]
            K.face(C, soff, (0.0, -1.0, 0.0), K.tint(DRESSED_T, 0.85, 43, i), DRESSED)
            # the voussoir over this stretch of the intrados: a dressed block proud of the face
            mid_u = (ua + ub) / 2
            mid_v = arch_v(mid_u)
            ang = math.atan2(mid_v - spring + 1.2, mid_u)
            r_out = 0.62 + jit(0.08, 44, i)
            ox, oy = math.cos(ang) * r_out, math.sin(ang) * r_out
            d0 = stone(ua, va)
            base = [out.pt(ua, va, d0 + 0.14), out.pt(ub, vb, d0 + 0.14)]
            top = [out.pt(ub + ox * 0.9, vb + oy, d0 + 0.14), out.pt(ua + ox * 0.9, va + oy, d0 + 0.14)]
            back = [out.pt(ua, va, -0.02), out.pt(ub, vb, -0.02),
                    out.pt(ub + ox * 0.9, vb + oy, -0.02), out.pt(ua + ox * 0.9, va + oy, -0.02)]
            K.block(C, [back[0], back[1], back[2], back[3], base[0], base[1], top[0], top[1]],
                    K.tint(DRESSED_T, 1.0 + jit(0.05, 45, i), 46, i), DRESSED)
        # the jambs' reveals (the doorway's sides through the wall) and their quoined blocks
        for sx in (-1, 1):
            u = sx * hw
            vs = K.breaks(0.0, spring, 1.4)
            for j in range(len(vs) - 1):
                a, b = vs[j], vs[j + 1]
                pts = [out.pt(u, a, stone(u, a)), out.pt(u, b, stone(u, b)), inner.pt(u, b, 0.0),
                       inner.pt(u, a, 0.0)]
                K.face(C, pts, (-sx, 0.0, 0.0), K.tint(DRESSED_T, 0.9, 47, sx, j), DRESSED)
            # the jamb's dressed blocks: long and short by turns, each a little off true
            v = 0.0
            k = 0
            while v < spring - 0.2:
                h = min(0.72 + jit(0.08, 48, sx, k), spring - v)
                wide = 0.82 if k % 2 == 0 else 0.5
                d = stone(u, v + h / 2)
                c = out.pt(u + sx * wide / 2 - sx * 0.02, v + h / 2, d + 0.06)
                K.lump(C, (c.x, c.y, c.z), (wide, h - 0.05, 0.3), K.tint(DRESSED_T, 1.0, 49, sx, k),
                       DRESSED, seed=50 + sx * 7 + k, rough=0.12)
                v += h
                k += 1
        # the threshold: a worn stone step across the doorway
        c = out.pt(0.0, 0.06, -t / 2)
        K.lump(C, (c.x, c.y, c.z + 0.05), (2 * hw + 0.3, 0.14, t + 0.25), K.tint(DRESSED_T, 0.9, 51),
               DRESSED, seed=52, rough=0.05)

    def _doors(self, hw, arch_v, inner):
        """The two oak leaves, swung in against the inner face either side of the doorway."""
        P = self.parts
        for sx in (-1, 1):
            part = P[front_part(sx * (hw + 1.0), self.split)]
            leaf_w = hw - 0.05
            # the leaf stands just inside the inner face, hinged at the doorway's side
            z = inner.pt(0, 0, -0.12).z
            u0, u1 = sx * hw, sx * (hw + leaf_w)
            planks = 5
            for k in range(planks):
                a = u0 + (u1 - u0) * k / planks
                b = u0 + (u1 - u0) * (k + 1) / planks
                mid = (a + b) / 2
                # each plank stands as tall as the arch it closed under: swung open, a plank s
                # from the hinge stood s in from the doorway's side when the leaf was shut
                s = abs(mid) - hw
                top = arch_v(hw - s) - 0.1
                K.lump(part, (mid, top / 2 + 0.05, z), (abs(b - a) - 0.02, top - 0.05, 0.14),
                       K.tint(OAK, 1.0, 61, sx, k, spread=0.08), TIMBER, seed=62 + sx * 3 + k, rough=0.04)
            # iron straps across the planks
            for v in (1.1, 3.6):
                c = ((u0 + u1) / 2, v, z - 0.085)
                part.box(c, (abs(u1 - u0) - 0.2, 0.16, 0.03), IRON, METAL)
            # a ring pull
            K.disc(part, (u1 - sx * 0.5, 2.3, z - 0.1), (0, 0, -1), 0.12, IRON, METAL, sides=6)

    def _front_jetty(self, out, up, jetty, split):
        """The jetty: the floor's joists run out through the stone and carry the bressumer the
        upper storey stands on; their ends show under the overhang (one under every post of the
        storey and one between, none quite in line), and the whole of it has sagged a little
        toward the middle (`up` is the settled front)."""
        H, P = self.H, self.parts
        x1 = H['x1']
        # the soffit under the overhang (three runs, so the parts meet at the split): its inner
        # edge on the stone, its outer edge on the settled bressumer
        for (u0, u1) in [(-x1, -split), (-split, split), (split, x1)]:
            part = P[front_part((u0 + u1) / 2, split)]
            us = K.breaks(u0, u1, 2.0)
            for i in range(len(us) - 1):
                a, b = us[i], us[i + 1]
                pts = [out.pt(a, JETTY, 0.0), out.pt(b, JETTY, 0.0), up.pt(b, JETTY, jetty),
                       up.pt(a, JETTY, jetty)]
                K.face(part, pts, (0, -1, 0), K.tint(OAK, 0.8, 71, i), TIMBER)
        # the joists' ends, under the settled soffit: one under each post and one between
        posts = front_posts(x1, CROSS_HALF, split)
        joists = [a + (b - a) * k / 2 for a, b in zip(posts[:-1], posts[1:]) for k in range(2)] + [posts[-1]]
        for k, u in enumerate(joists):
            # (a joist under a post on the split goes with the side, as the post does)
            part = P[front_part(u * 1.01 if abs(abs(u) - split) < 1e-6 else u, split)]
            drop = 0.26 + jit(0.04, 73, k)
            reach = jetty + 0.12 + jit(0.06, 74, k)
            c = up.pt(u, JETTY - drop / 2, reach / 2)
            K.lump(part, (c.x, c.y, c.z), (0.26, drop, reach), K.tint(OAK, 0.92, 75, k), TIMBER,
                   seed=76 + k, rough=0.1)
        # the bressumer: the great beam along the jetty's face, sagging with it
        for (u0, u1) in [(-x1 - 0.25, -split), (-split, split), (split, x1 + 0.25)]:
            part = P[front_part((u0 + u1) / 2, split)]
            pts = [up.pt(u0 + (u1 - u0) * i / 4, JETTY + 0.22, jetty + 0.02) for i in range(5)]
            part.beam(pts, 0.5, 0.42 + jit(0.04, 77, u0), K.tint(OAK, 0.85, 77, u0), TIMBER, up=tuple(out.n))

    def front_windows(self):
        """The front storey's casements (u, width), each centred in its bay: one either side of
        the door's two bays under the cross gable, and two in each run out to the corners (whose end
        bays carry the braces)."""
        posts = front_posts(self.H['x1'], CROSS_HALF, self.split)
        mids = [(a + b) / 2 for a, b in zip(posts[:-1], posts[1:])]
        return [(mids[i], 1.3) for i in (1, 2, 3, 6, 7, 8)]

    def _front_upper(self, out, inner, jetty, split):
        """The upper storey over the jetty along the whole front, plaster in its box frame on the
        front's bay grid, up under the main roof's eaves; and over the door's bays the cross gable,
        the storey running on up into it on a small jetty of its own, its truss round the rose
        window up under its steep rakes."""
        B, H, P = self.B, self.H, self.parts
        x1 = H['x1']
        R = self.roof
        face_w = jetty
        gw = jetty + GABLE_JETTY
        cx = CROSS_HALF
        # the cross gable jetties out at the main eaves' line (its slates' feet ride over them)
        cross_base = B.ROOF_EAVE - 0.9
        plaster = self.plaster_depth(81.0)
        # the frame's face: the settled front, racked a hair through the storey
        fr = Racked(out, JETTY + 0.4, cross_base + 0.4, 0.012, 91.0)

        def pick(u, post=False):
            # (a post on the split goes with the side: the door's part keeps inside the split)
            if post and abs(abs(u) - split) < 1e-6:
                u *= 1.01
            return P[front_part(u, split)]

        def eave_top(u):
            """The storey's top under the main eaves: halfway into the roof's slab over it."""
            return (R.height(u, B.ROOF_FRONT) + R.under(u, B.ROOF_FRONT)) / 2

        def storey_top(u):
            return cross_base + 0.35 if abs(u) <= cx else eave_top(u)

        def rake(u):
            return R.cross_top(abs(u), R.cross_front) - 0.18

        # the storey's plaster face (three runs), and the cross gable's over the door's bay
        for (u0, u1) in [(-x1, -split), (-split, split), (split, x1)]:
            part = P[front_part((u0 + u1) / 2, split)]

            def cell(i, j, a, b, c, d, u0=u0):
                return K.tint(PLASTER_T, 1.0, 82, u0, i, j, spread=0.015), PLASTER

            K.skin(part, fr, K.breaks(u0, u1, 1.6, keep=(-cx, cx)), K.breaks(JETTY + 0.4, B.ROOF_EAVE + 0.4, 1.4),
                   lambda u, v: face_w + plaster(u, v), 1, cell, top=storey_top)
            g0, g1 = max(u0, -cx), min(u1, cx)
            if g1 > g0:
                K.skin(part, fr, K.breaks(g0, g1, 1.3, keep=(0.0,)), K.breaks(cross_base + 0.35, 17.6, 1.3),
                       lambda u, v: gw + plaster(u, v + 20), 1, cell, top=rake)
            # the inner face, up under the sarking (the cross gable is the roof's, outside)
            uin = K.breaks(max(u0, -x1 + self.t), min(u1, x1 - self.t), 1.6)

            def in_cell(i, j, a, b, c, d, u0=u0):
                return K.tint(PLASTER_IN, 0.97, 83, u0, i, j, spread=0.012), PLASTER

            K.skin(part, inner, uin, [INNER_BAND, B.ROOF_EAVE + 1.2], lambda u, v: 0.0, -1, in_cell,
                   top=lambda u: R.under(u, H['z1'] - self.t) + 0.15)
        # the cross gable's jetty and its bressumer (its truss's tie), the storey's sill on the
        # jetty's bressumer, and the wall plates either side of the cross gable
        for (u0, u1) in [(-cx, -split), (-split, split), (split, cx)]:
            part = P[front_part((u0 + u1) / 2, split)]
            K.face(part, [fr.pt(u0, cross_base + 0.35, face_w), fr.pt(u1, cross_base + 0.35, face_w),
                          fr.pt(u1, cross_base + 0.35, gw), fr.pt(u0, cross_base + 0.35, gw)], (0, -1, 0),
                   K.tint(OAK, 0.8, 84, u0), TIMBER)
            K.hewn(part, fr.pt(u0 - (0.25 if u0 <= -cx else 0), cross_base + 0.2, gw - 0.05),
                   fr.pt(u1 + (0.25 if u1 >= cx else 0), cross_base + 0.2, gw - 0.05), 0.32, 0.42,
                   K.tint(OAK, 0.85, 85, u0), TIMBER, seed=86 + u0, sag=0.02)
        # (the jetty's bressumer stands 0.25 either side of JETTY + 0.22: the sill sits on it)
        foot = JETTY + 0.47 + SILL[0]
        for (u0, u1) in [(-x1 - 0.1, -split), (-split, split), (split, x1 + 0.1)]:
            part = P[front_part((u0 + u1) / 2, split)]
            self.plate(part, fr, u0, u1, lambda u: foot - SILL[0] / 2, face_w + PLATE_W, 87 + u0, size=SILL, n=3)
        for (u0, u1) in [(-x1 - 0.15, -cx), (cx, x1 + 0.15)]:
            part = P[front_part((u0 + u1) / 2, split)]
            self.plate(part, fr, u0, u1, lambda u: eave_top(u) - 0.32, face_w + PLATE_W, 89 + u0, n=4)

        def top(u):
            """The posts' heads: under the plates either side, under the cross gable's bressumer
            over the door's bays (its corner posts on up through the plate's end into it)."""
            if abs(u) <= cx + 0.01:
                return cross_base - 0.01
            return eave_top(u) - 0.32 - PLATE[0] / 2

        # the storey's frame on the front's grid: posts, girt, head rails, the end bays' braces, the
        # casements; and the windows seen from inside
        wins = self.front_windows()
        self.frame_storey(pick, fr, front_posts(x1, cx, split), foot, top, WIN_SILL, WIN_HEAD, 90.0, w=face_w,
                          windows=wins, bow=plaster)
        for k, (u, _) in enumerate(wins):
            self.inner_window(pick(u), inner, u, 6.6, 8.4, 1.2, seed=120 + k)
        # the cross gable's truss and its rose
        self._cross_truss(pick, fr, gw, cross_base, split)
        self._rose(P['HallWallFront'], fr, 0.0, ROSE_V, ROSE_R, gw)

    def _cross_truss(self, pick, fr, gw, cross_base, split):
        """The cross gable's frame, a truss whose members meet: its tie the bressumer it jetties out
        on; its rafters up under the verge, crossing at the apex; queen posts on the door bays'
        posts (the storey's grid carried on up); a raking strut from each queen post's foot out to
        the middle of its rafter (over the window below); between the queen posts the rose window
        on a sill rail, a stud under the rail on the door's middle line, a collar over the rose
        and the king post on it up to the apex."""
        R = self.roof
        cx = CROSS_HALF
        C = self.parts['HallWallFront']
        wf = gw + POST_W
        tie = cross_base + 0.2 + 0.21         # the gable's bressumer's top: the posts' feet

        def under(u):
            """The cross gable's slab's underside over its face (world)."""
            return R.cross_top(abs(u), R.cross_front) - 0.55

        def raf_c(u):
            return self.v_at(fr, u, under(u) + 0.05 - RAFTER[0] / 2, wf)

        def raf_lo(u):
            return self.v_at(fr, u, under(u) + 0.1 - RAFTER[0], wf)

        for sx in (-1.0, 1.0):
            # the rafter, from the tie's end up to the apex and a hand past it to cross its fellow
            # (the right one a hair proud of the left where they cross), in the parts its stretches
            # stand in
            wr = wf + RAFTER_W + (0.012 if sx > 0 else 0.0)
            us = [sx * (cx + 0.1 + (split - cx - 0.1) * i / 2) for i in range(3)]
            pick(sx * (cx + split) / 2).beam([fr.pt(u, raf_c(u), wr) for u in us], RAFTER[0], RAFTER[1],
                                             K.tint(OAK, 0.76, 150, sx), TIMBER, up=tuple(fr.n))
            us = [sx * split * (1.0 - i / 3) for i in range(4)]
            pts = [fr.pt(u, raf_c(u), wr) for u in us]
            pts.append(pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.12)
            C.beam(pts, RAFTER[0], RAFTER[1], K.tint(OAK, 0.76, 151, sx), TIMBER, up=tuple(fr.n))
            # the queen post up into the rafter, and the raking strut from its foot out to the
            # rafter's middle
            u = sx * split
            self.oak(pick(u, True), fr, (u, tie - 0.04), (u, self.seat(raf_lo, u, QUEEN[0] / 2)), QUEEN, wf, 152 + sx,
                     caps=False)
            m = sx * (split + cx) / 2
            self.oak(pick(m), fr, (u + sx * (QUEEN[0] / 2 + 0.05), tie + 0.05), (m, raf_lo(m) + 0.02), STRUT,
                     gw + BRACE_W, 154 + sx)
        # the rose's sill rail between the queen posts, and the stud under it on the middle line
        sill = ROSE_V - ROSE_R - 0.27
        self.oak(C, fr, (-split, sill - GIRT[0] / 2), (split, sill - GIRT[0] / 2), GIRT, gw + RAIL_W, 156, caps=False)
        self.oak(C, fr, (0.0, tie - 0.04), (0.0, sill - GIRT[0] + 0.04), POST, wf, 157, caps=False)
        # the collar over the rose, from rafter to rafter, and the king post on it up to the apex
        vc = ROSE_V + ROSE_R + 0.3 + COLLAR[0] / 2
        reach = self.meet(raf_lo, vc + COLLAR[0] / 2, 0.0, split)
        self.oak(C, fr, (-reach - 0.08, vc), (reach + 0.08, vc), COLLAR, gw + RAIL_W, 158)
        self.oak(C, fr, (0.0, vc + COLLAR[0] / 2 - 0.04), (0.0, raf_c(0.0)), QUEEN, wf, 159, caps=False)

    # ------------------------------------------------------------- windows
    def arched_window(self, part, wall, u, sill, width, depth, seed):
        """A window in the stone storey: a dressed sill running a hand past its jambs, quoined
        jambs flush on their outer edge, a voussoir arch springing from them as wide as they are,
        and the warm pane set back between them with an oak mullion and transom."""
        hw = width / 2
        jw = 0.32            # the jambs' width, and the arch's at its springing
        spring = sill + 1.45
        crown = spring + 0.6
        d0 = depth(u, sill + 1.0)
        # the pane (set back into the surround) and its oak cross
        n = 7
        pts = [wall.pt(u - hw, sill + 0.1, d0 + 0.04), wall.pt(u + hw, sill + 0.1, d0 + 0.04)]
        for i in range(n + 1):
            a = math.pi * i / n
            pts.append(wall.pt(u + hw * math.cos(a), spring + (crown - spring) * math.sin(a), d0 + 0.04))
        pts = [pts[0], pts[1]] + pts[2:]
        K.face(part, pts, tuple(wall.n), K.tint(PANE, 1.0, seed, 1, spread=0.05), GLOW, tag=K.FLAT)
        K.hewn(part, wall.pt(u, sill + 0.1, d0 + 0.1), wall.pt(u, crown - 0.05, d0 + 0.1), 0.11, 0.08,
               K.tint(OAK, 0.7, seed, 2), TIMBER, seed=seed + 3, up=tuple(wall.n), segs=1)
        K.hewn(part, wall.pt(u - hw, spring - 0.15, d0 + 0.1), wall.pt(u + hw, spring - 0.15, d0 + 0.1), 0.1,
               0.08, K.tint(OAK, 0.7, seed, 4), TIMBER, seed=seed + 5, segs=1)
        # the sill, a hand past the jambs either side
        c = wall.pt(u, sill - 0.08, d0 + 0.12)
        K.lump(part, (c.x, c.y, c.z), self._along(wall, width + 2 * jw + 0.16, 0.2, 0.36),
               K.tint(DRESSED_T, 0.95, seed, 6), DRESSED, seed=seed + 7, rough=0.04)
        # the jambs: two blocks a side, long and short by turns in their height
        for sx in (-1, 1):
            for k, (v0, v1) in enumerate(((sill, sill + 0.75), (sill + 0.75, spring))):
                c = wall.pt(u + sx * (hw + jw / 2), (v0 + v1) / 2, d0 + 0.09)
                K.lump(part, (c.x, c.y, c.z), self._along(wall, jw, v1 - v0 - 0.04, 0.2),
                       K.tint(DRESSED_T, 1.0, seed, 8, sx, k), DRESSED, seed=seed + 9 + sx * 3 + k, rough=0.06)
        # the arch: four voussoirs fanning over the pane, each a block between the intrados and an
        # extrados as wide as the jambs where it springs from them (a little uneven over the crown),
        # from just behind the face to proud of it
        ex = hw + 0.02
        ey = crown - spring + 0.02
        r0 = (hw + jw) / ex

        def rout(a):
            if a < 1e-6 or a > math.pi - 1e-6:
                return r0
            return r0 + jit(0.05, seed, 10, round(a, 3))

        for i in range(4):
            a0 = math.pi * i / 4
            a1 = math.pi * (i + 1) / 4
            ring = ((1.0, a0), (1.0, a1), (rout(a1), a1), (rout(a0), a0))
            pts = [wall.pt(u + ex * r * math.cos(a), spring + ey * r * math.sin(a), d0 + dd)
                   for dd in (-0.04, 0.2) for (r, a) in ring]
            K.block(part, pts, K.tint(DRESSED_T, 1.0 + jit(0.06, seed, 11, i), seed, 12, i), DRESSED)

    def inner_window(self, part, wall, u, sill, head, width, seed):
        """A window seen from inside: an oak frame on the plaster round a warm pane, a deep ledge
        under it and a head ledge over it, each running a hand past the frame's sides (the frame's
        posts stand on the one and stop under the other)."""
        hw = width / 2
        w = -0.05
        K.face(part, [wall.pt(u - hw, sill, w), wall.pt(u + hw, sill, w), wall.pt(u + hw, head, w),
                      wall.pt(u - hw, head, w)], tuple(-wall.n), K.tint(PANE_DIM, 1.0, seed, spread=0.05),
               GLOW, tag=K.FLAT)
        frame = [((u - hw, sill), (u + hw, sill)), ((u - hw, sill - 0.03), (u - hw, head)),
                 ((u + hw, sill - 0.03), (u + hw, head)), ((u, sill), (u, head))]
        for k, ((a0, b0), (a1, b1)) in enumerate(frame):
            K.hewn(part, wall.pt(a0, b0, -0.1), wall.pt(a1, b1, -0.1), 0.16, 0.12,
                   K.tint(OAK, 0.85, seed, k), TIMBER, seed=seed + k, segs=1, up=tuple(wall.n))
        c = wall.pt(u, sill - 0.1, -0.2)
        K.lump(part, (c.x, c.y, c.z), self._along(wall, width + 0.4, 0.14, 0.42),
               K.tint(OAK, 0.9, seed, 9), TIMBER, seed=seed + 9, rough=0.05)
        c = wall.pt(u, head + 0.07, -0.16)
        K.lump(part, (c.x, c.y, c.z), self._along(wall, width + 0.4, 0.14, 0.32),
               K.tint(OAK, 0.88, seed, 10), TIMBER, seed=seed + 10, rough=0.05)

    def casement(self, part, wall, u, sill, width, height, w0, seed, shutters=True, bow=None, swing=70.0):
        """An upper storey's casement: an oak frame and its mullion round a warm pane on the
        plaster, its head and sill running a hand past its posts, a sill board under it, and shutters
        thrown back (none quite square). bow(u, v), when given, is the
        plaster's belly there: the window sits on it rather than on the wall's line, so it never
        stands off a bowed face; where the plaster bows in, the window stays a hand out of the
        wall's line, its frame standing clear in front of the girt and head rail it sits between
        (never flush with them). `swing` is how far (degrees) the shutters stand open off the wall."""
        hw = width / 2
        head = sill + height
        d = w0 + (max(bow(u, sill + height / 2), 0.03) + 0.03 if bow else 0.06)
        K.face(part, [wall.pt(u - hw, sill, d), wall.pt(u + hw, sill, d), wall.pt(u + hw, head, d),
                      wall.pt(u - hw, head, d)], tuple(wall.n), K.tint(PANE, 0.95, seed, spread=0.06), GLOW,
               tag=K.FLAT)
        lean = jit(0.025, seed, 1)
        frame = [((u - hw - 0.15, sill), (u + hw + 0.15, sill + lean)),
                 ((u - hw - 0.15, head), (u + hw + 0.15, head + lean)),
                 ((u - hw, sill), (u - hw, head)), ((u + hw, sill + lean), (u + hw, head + lean)),
                 ((u, sill), (u, head)), ((u - hw, sill + height * 0.55), (u + hw, sill + height * 0.55))]
        for k, ((a0, b0), (a1, b1)) in enumerate(frame):
            th = 0.17 if k < 4 else 0.08
            K.hewn(part, wall.pt(a0, b0, d + 0.04), wall.pt(a1, b1, d + 0.04), th, 0.16 if k < 4 else 0.12,
                   K.tint(OAK, 0.75, seed, k), TIMBER, seed=seed + k, segs=1, up=tuple(wall.n))
        c = wall.pt(u, sill - 0.08, d + 0.14)
        K.lump(part, (c.x, c.y, c.z), self._along(wall, width + 0.45, 0.12, 0.3),
               K.tint(OAK, 0.8, seed, 8), TIMBER, seed=seed + 8, rough=0.05)
        if shutters:
            for sx in (-1, 1):
                open_ = math.radians(swing + jit(18, seed, 9, sx))
                # the shutter hinged at the frame's side, swung back toward the wall
                hinge = u + sx * (hw + 0.1)
                tip_u = hinge + sx * math.cos(open_) * hw
                tip_w = d + 0.08 + math.sin(open_) * hw
                # a board 0.07 thick: its face swung out, its back toward the wall
                th = wall.d * (sx * math.sin(open_) * 0.07) - wall.n * (math.cos(open_) * 0.07)
                v0, v1 = sill + 0.02, head - 0.02
                front = [wall.pt(hinge, v0, d + 0.08), wall.pt(tip_u, v0, tip_w),
                         wall.pt(tip_u, v1, tip_w), wall.pt(hinge, v1, d + 0.08)]
                rear = [q + th for q in front]
                K.block(part, [front[0], front[1], rear[1], rear[0], front[3], front[2], rear[2], rear[3]],
                        K.tint(OAK, 0.62, seed, 10, sx), TIMBER)

    def _rose(self, part, out, u, v, r, w0):
        """The rose window in the cross gable: a ring of oak round a warm pane and its spokes (the
        loft behind it is over the hall's ceiling, so it is never seen from inside)."""
        n_out = out.n
        c = out.pt(u, v, w0 + 0.07)
        side = out.d
        K.disc(part, tuple(c), tuple(n_out), r, K.tint(PANE, 1.05, 141), GLOW, sides=14, tag=K.FLAT)
        part.ring(tuple(c + n_out * 0.08), r + 0.08, 0.26, K.tint(OAK, 0.7, 142), segments=14,
                  axis=tuple(n_out), mat=TIMBER, depth=0.2)
        for k in range(6):
            a = math.tau * k / 6 + 0.26
            p0 = c + n_out * (0.1 - 0.006 * k)
            p1 = p0 + side * (math.cos(a) * r) + Vector((0.0, math.sin(a) * r, 0.0))
            K.hewn(part, p0, p1, 0.08, 0.07, K.tint(OAK, 0.66, 143, k), TIMBER, seed=144 + k, segs=1,
                   up=tuple(n_out))
        part.ring(tuple(c + n_out * 0.1), r * 0.36, 0.1, K.tint(OAK, 0.66, 145), segments=8,
                  axis=tuple(n_out), mat=TIMBER, depth=0.08)

    # -------------------------------------------------------------- corners
    def quoins(self, part, corner, face_a, face_b, v0, v1, seed):
        """Dressed quoins up a stone corner: long and short by turns on each face, every one a
        little off true, the stack wandering a touch."""
        cx, cz = corner
        na = (face_a[0], face_a[1])
        nb = (face_b[0], face_b[1])
        v = v0
        k = 0
        while v < v1 - 0.15:
            h = min(0.62 + jit(0.08, seed, k), v1 - v)
            long_a = k % 2 == 0
            la, lb = (0.95, 0.55) if long_a else (0.55, 0.95)
            # the block's corner sits a little proud of both faces
            drift = jit(0.04, seed, k, 1)
            ox, oz = cx + na[0] * 0.1 + nb[0] * 0.1 + drift, cz + na[1] * 0.1 + nb[1] * 0.1
            # the block spans la back along face b's direction and lb along face a's
            pts = []
            for yy in (v, v + h - 0.04):
                pts.append((ox, yy, oz))
                pts.append((ox - nb[0] * la, yy, oz - nb[1] * la))
                pts.append((ox - nb[0] * la - na[0] * lb, yy, oz - nb[1] * la - na[1] * lb))
                pts.append((ox - na[0] * lb, yy, oz - na[1] * lb))
            pts = [(x + jit(0.04, seed, k, i), y, z + jit(0.04, seed, k, i + 9)) for i, (x, y, z) in enumerate(pts)]
            K.block(part, pts, K.tint(DRESSED_T, 1.0, seed, k, spread=0.07), DRESSED)
            v += h
            k += 1

    @staticmethod
    def _along(wall, length, height, depth):
        """A box size (game x, y, z) for a block lying along a wall line."""
        if abs(wall.d.x) > 0.5:
            return (length, height, depth)
        return (depth, height, length)

    # ============================================================ the oak frame
    @staticmethod
    def oak(part, wall, a, b, size, w, seed, tone=0.82, sag=0.0, segs=1, caps=True):
        """One oak member lying flat on a timbered face from a to b ((u, v) on it), square to it:
        `size` its face across and its depth (each a little more or less, as hewn), its middle `w`
        out of the wall's line, sagging `sag` at its middle. A member whose two ends die into the
        members it meets (a post into its sill and its plate, a rail into its posts) needs no end
        faces: caps=False leaves them off."""
        pa, pb = wall.pt(a[0], a[1], w), wall.pt(b[0], b[1], w)
        pts = []
        for i in range(segs + 1):
            q = pa.lerp(pb, i / segs)
            q.y -= sag * math.sin(math.pi * i / segs)
            pts.append(q)
        return part.beam(pts, size[0] * (1.0 + jit(0.08, seed, 9.1)), size[1] * (1.0 + jit(0.08, seed, 9.7)),
                         K.tint(OAK, tone, seed), TIMBER, up=tuple(wall.n), caps=caps)

    @staticmethod
    def seat(f, u, half):
        """Where a post `half` wide either side of u stops to die into a sloping timber whose
        underside (a hand into it) is f(u) all across the post's width."""
        return max(f(u - half), f(u + half))

    @staticmethod
    def plate(part, wall, u0, u1, v, w, seed, size=PLATE, n=6, tone=0.8):
        """A long timber along a face (a wall plate, a sill, a bressumer) from u0 to u1 at height
        v(u), through n stretches so it follows the face as it has settled."""
        pts = [wall.pt(u0 + (u1 - u0) * i / n, v(u0 + (u1 - u0) * i / n), w) for i in range(n + 1)]
        return part.beam(pts, size[0], size[1], K.tint(OAK, tone, seed), TIMBER, up=tuple(wall.n))

    @staticmethod
    def rafter(part, wall, ua, ub, v, w, seed, n=6, over=0.12):
        """A gable's rafter up its rake from ua to ub (the apex, `over` on past it to cross its
        fellow there), at height v(u) on the face."""
        pts = [wall.pt(ua + (ub - ua) * i / n, v(ua + (ub - ua) * i / n), w) for i in range(n + 1)]
        if over > 0:
            pts.append(pts[-1] + (pts[-1] - pts[-2]).normalized() * over)
        return part.beam(pts, RAFTER[0], RAFTER[1], K.tint(OAK, 0.76, seed), TIMBER, up=tuple(wall.n))

    def frame_storey(self, pick, wall, posts, foot, top, girt, head, seed, w=0.0, windows=(), bow=None,
                     braces=None, skip=None, swing=70.0):
        """The box frame of a timbered storey on a face, as a carpenter frames one: posts on the
        bay grid `posts` (the first and the last the corner posts, stouter) standing on the sill
        whose top is `foot`, each stopping under the plate (its underside top(u)); a girt between
        each pair with its top at the windows' sills (`girt`); a head rail over each bay at the
        windows' heads (`head`) but the braced ones (`braces`, bay indices: by default the two end
        bays), where a curved tension brace runs from the corner post's head down onto the girt
        by the next post instead (so the two ends' are a mirrored pair); and the windows
        (u, width), casements centred in their bays, standing on the girt up to the head rail.
        pick(u, post) is the part a member whose middle stands at u goes to (or one part);
        skip(u0, u1) true leaves out what stands between u0 and u1 (hidden in a chimney's breast)."""
        part_of = pick if callable(pick) else (lambda u, post=False: pick)
        skip = skip or (lambda a, b: False)
        n = len(posts)
        braces = {0, n - 2} if braces is None else braces
        for k, u in enumerate(posts):
            if skip(u - 0.15, u + 0.15):
                continue
            self.oak(part_of(u, True), wall, (u, foot - 0.04), (u, top(u) + 0.04),
                     CORNER if k in (0, n - 1) else POST, w + POST_W, seed + 1.3 * k, caps=False)
        for i in range(n - 1):
            a, b = posts[i], posts[i + 1]
            if skip(a, b):
                continue
            part = part_of((a + b) / 2)
            gv = girt - GIRT[0] / 2
            self.oak(part, wall, (a, gv), (b, gv), GIRT, w + RAIL_W, seed + 20 + i, caps=False)
            if i in braces:
                # the corner post's end of the bay, and the post in from it
                c, m = (b, a) if i == n - 2 and i != 0 else (a, b)
                s = 1.0 if m > c else -1.0
                self.oak(part, wall, (c + s * (CORNER[0] / 2 - 0.04), top(c) - 0.06),
                         (m - s * (POST[0] / 2 + 0.06), girt + 0.02), BRACE, w + BRACE_W, seed + 40 + i,
                         sag=0.16, segs=4, tone=0.8)
            else:
                hv = head + HEAD[0] / 2
                self.oak(part, wall, (a, hv), (b, hv), HEAD, w + RAIL_W, seed + 60 + i, caps=False)
        for k, (u, width) in enumerate(windows):
            self.casement(part_of(u), wall, u, girt, width, head - girt, w, seed=seed + 80 + k, bow=bow, swing=swing)

    # ======================================================== shared storeys
    def timber_storey(self, part, wall, u0, u1, top, posts, windows, seed, girt=STOREY_SILL, head=STOREY_HEAD,
                      plate=True, braces=None, skip=None, swing=70.0):
        """A half-timbered storey on a face between u0 and u1, standing on the oak sill along the
        stone (sill_cap) up to top(u): bowed plaster, the wall plate along under its top (unless
        the caller lays its own beam there, a gable's tie, whose underside is top(u) - 0.18), and
        its box frame (frame_storey). Returns the plaster's belly."""
        plaster = self.plaster_depth(seed)

        def cell(i, j, a, b, c, d):
            return K.tint(PLASTER_T, 1.0, seed, i, j, spread=0.015), PLASTER

        us = K.breaks(u0, u1, 1.8)
        K.skin(part, wall, us, K.breaks(TOP_STONE + 0.15, max(top(u) for u in us), 1.3), plaster, 1, cell,
               top=top)
        if plate:
            self.plate(part, wall, u0 - 0.05, u1 + 0.05, lambda u: top(u) - 0.22, PLATE_W, seed + 2)

            def frame_top(u):
                return top(u) - 0.22 - PLATE[0] / 2
        else:
            def frame_top(u):
                return top(u) - 0.18
        self.frame_storey(part, wall, posts, SILL_TOP, frame_top, girt, head, seed + 5, windows=windows, bow=plaster,
                          braces=braces, skip=skip, swing=swing)
        return plaster

    def stone_storey(self, part, wall, u0, u1, ground, seed, hole=None, keep=()):
        """A stone storey's outer face from the ground up to the jetty line, battered at its foot,
        and the plinth under it down into the ground."""
        depth = self.stone_depth(wall, seed, ground)
        us = K.breaks(u0, u1, 2.0, keep=keep)
        self._stone_face(part, wall, us, K.breaks(0.0, TOP_STONE, 1.5), depth, ground, hole=hole, seed=seed)
        self._plinth(part, wall, us, depth, ground, seed=seed + 1)
        return depth

    def sill_cap(self, part, wall, u0, u1, seed):
        """The oak sill along the top of a stone storey, where the timbered storey stands."""
        up = tuple(wall.n)
        pts = [wall.pt(u0 + (u1 - u0) * i / 5, TOP_STONE + 0.1, 0.12) for i in range(6)]
        part.beam(pts, 0.36, 0.34, K.tint(OAK, 0.84, seed), TIMBER, up=up)

    # ================================================================ sides
    def side_posts(self):
        """The gable ends' posts along z: eight even bays from the back corner to the jetty's face,
        symmetric about the ridge's line (the gables' middle), the corner posts a hand in."""
        z0, zf = self.H['z0'], self.B.ROOF_FRONT
        bay = (zf - z0) / 8
        return [z0 + 0.15] + [z0 + bay * k for k in range(1, 8)] + [zf - 0.15]

    def side_bays(self):
        """The middles of the gable ends' eight bays along z."""
        z0, zf = self.H['z0'], self.B.ROOF_FRONT
        bay = (zf - z0) / 8
        return [z0 + bay * (k + 0.5) for k in range(8)]

    def storey_windows(self, sx):
        """The gable ends' upper storey casements (z, width), centred in their bays and
        symmetric about the gable's middle: the right's either side of the chimney's breast, the
        left's in two pairs."""
        c = self.side_bays()
        if sx > 0:
            return [(c[1], 1.25), (c[6], 1.25)]
        return [(c[1], 1.25), (c[2], 1.25), (c[5], 1.25), (c[6], 1.25)]

    def storey_inner(self, sx):
        """Where those windows show inside (the right's back one a hand nearer the corner, clear
        of the bar beam's wall post at z -7.6, inn_interior.py _bar_foot)."""
        us = [u for (u, _) in self.storey_windows(sx)]
        if sx > 0:
            us[0] -= 0.19
        return us

    def gable_windows(self, sx):
        """The gable ends' windows, in the gables' bays (_side_gable): (z, sill, height, width). The
        lower ones stand on the gable's girt; the right gable's stand clear of the chimney's shaft
        (the highest a small one between the queen and king posts), the left's of the loft door."""
        c = self.side_bays()
        if sx > 0:
            return [(c[2], GABLE_SILL, 1.5, 1.3), (c[6], GABLE_SILL, 1.3, 1.2), (c[3], 15.2, 1.15, 0.95)]
        return [(c[2], GABLE_SILL, 1.5, 1.3), (c[5], GABLE_SILL, 1.5, 1.3)]

    def breast_span(self, fire, ground):
        """The z the wall fire's chimney breast covers on the right gable's storey (_chimney_stack's
        lean and its rings), a hand in from its sides."""
        zt, lean = fire['z'], 0.35
        g = ground(zt - lean)
        lo, hi = -1e9, 1e9
        for y in (TOP_STONE, SIDE_PLATE):
            zc = zt - lean * (1.0 - min(1.0, max(0.0, (y - g) / (SHAFT_TOP - g))))
            half = 2.05 + (1.95 - 2.05) * (y - 2.6) / (SIDE_PLATE + 0.6 - 2.6)
            lo, hi = max(lo, zc - half + 0.05), min(hi, zc + half - 0.05)
        return lo, hi

    def side(self, sx):
        """A gable end (x = sx * 16): the stone storey with its arched windows, the timbered
        storey flush over it, the gable jettied out over that up under the verge, quoins at the
        back corner; on the right the wall fire's chimney climbing the outside up through the
        verge, on the left the job board inside and the loft door and its hay hoist up in the
        gable."""
        B, H, P = self.B, self.H, self.parts
        R = self.roof
        part = P['HallWallRight' if sx > 0 else 'HallWallLeft']
        x = sx * H['x1']
        t = self.t
        out = Wall(x, 0.0, x, 1.0, (sx, 0.0))            # u = z
        inner = Wall(x - sx * t, 0.0, x - sx * t, 1.0, (sx, 0.0))
        seed = 200 + sx * 17

        def ground(u):
            return B.ground(x + sx * 0.4, u) - 0.7

        z0, z1 = H['z0'], H['z1']
        zf = B.ROOF_FRONT                                # the front eave wall: the jetty's face
        stone = self.stone_storey(part, out, z0, z1, ground, seed)
        # the oak sill along the stone, on over the jetty's end to its face
        self.sill_cap(part, out, z0 - 0.1, zf + 0.12, seed + 2)
        fire = next(q for q in B.LAYOUT['props'] if q['kind'] == 'fireplace')
        # the timbered face: settled (its middle sagged a hand under the gable, leaning out a
        # touch as it rises) and racked a hair through its storey
        face = Racked(K.Settled(out, TOP_STONE, H['ridge'], sag=0.1, lean=0.08, half=(zf - z0) / 2 + 1.0, mid=R.rz),
                      SILL_TOP, SIDE_PLATE, 0.012, seed + 7)
        skip = None
        if sx > 0:
            # (what stands inside the chimney's breast is left out)
            lo, hi = self.breast_span(fire, ground)

            def skip(a, b):
                return a >= lo and b <= hi
        # (it runs on past the front wall to the jetty's face, closing the jetty's end)
        self.timber_storey(part, face, z0, zf, lambda u: SIDE_PLATE, self.side_posts(), self.storey_windows(sx),
                           seed + 3, skip=skip)
        self._side_gable(part, face, sx, fire, seed + 130)
        # the inner face: plaster over a skirting up to its last course, and that course on up
        # under the sarking (the gable's inside, up to the ridge)
        plaster_in = self.plaster_depth(seed + 4, amp=0.03)

        def in_cell(i, j, a, b, c, d):
            if d <= 1.0 + 1e-6:
                return K.tint(DRESSED_T, 0.92, seed, i, j, spread=0.04), DRESSED
            return K.tint(PLASTER_IN, 1.0, seed, i, j, spread=0.012), PLASTER

        K.skin(part, inner, K.breaks(z0 + t, z1 - t, 2.0), K.breaks(0.0, INNER_BAND, 1.6, keep=(1.0, JETTY)),
               lambda u, v: -plaster_in(u, v), -1, in_cell)
        K.skin(part, inner, K.breaks(z0 + t, z1 - t, 2.2, keep=(R.rz,)), K.breaks(INNER_BAND, 22.0, 2.6),
               lambda u, v: -plaster_in(u, v), -1, in_cell, top=lambda u: R.under(x - sx * t, u) + 0.12)
        # the stone storey's arched windows, and every window seen from inside
        low_wins = (-9.6, -4.6, 9.0) if sx > 0 else (-10.8, -4.6, 1.0, 8.2)
        for k, u in enumerate(low_wins):
            self.arched_window(part, out, u, 2.1, 1.5, stone, seed=seed + 40 + k)
            # (inside, the sill stands a hand higher: the square table's chair against the right
            # wall raises its back's top rail under the last one, inn_furnish.py chair)
            self.inner_window(part, inner, u, 2.5, 4.0, 1.4, seed=seed + 60 + k)
        for k, u in enumerate(self.storey_inner(sx)):
            self.inner_window(part, inner, u, 6.8, 8.3, 1.2, seed=seed + 80 + k)
        for k, (u, sill, hgt, w) in enumerate(self.gable_windows(sx)):
            # (inside, the sill stands a hand higher: the gable lanterns' plates come up under it,
            # inn_lights.py LANTERN_H)
            self.inner_window(part, inner, u, sill + 0.25, sill + hgt - 0.05, w - 0.1, seed=seed + 85 + k)
        # quoins up the back corner (the front corner's are the front wall's)
        self.quoins(part, (x, z0), (sx, 0.0), (0.0, -1.0), ground(z0), TOP_STONE, seed=seed + 90)
        if sx > 0:
            self._chimney_stack(part, out, fire, ground, seed + 100)
        else:
            self._job_board(part, inner, seed + 120)
            self._hay_hoist(part, face, seed + 160)
        # the panelling inside
        self._line_side(sx, inner, low_wins, fire)

    def _side_gable(self, part, face, sx, fire, seed):
        """A gable end over its storey: jettied out on a bressumer at the storey's wall plate,
        plaster in oak up under the verge, framed as a truss on the storey's bay grid carried on
        up: the bressumer its tie; its rafters up under the verge, crossing at the apex; a post on
        every bay line up into them (the king post on the ridge's line and the queen posts either
        side of it stouter); a girt under the windows and a middle rail over them; the collar
        from rafter to rafter at the queen posts' heads (the hay hoist's beam runs out of it on
        the left); the windows framed in their bays. The frame stands aside for the chimney's
        shaft on the right and for the loft door and the hoist's hood on the left."""
        B, H, R = self.B, self.H, self.roof
        x = sx * H['x1']
        gw = SIDE_JETTY
        z0, zf = H['z0'], B.ROOF_FRONT
        g0 = SIDE_PLATE + 0.35
        rz = R.rz
        plaster = self.plaster_depth(seed)
        grid = self.side_posts()[1:-1]

        def rake(u):
            return R.height(x + sx * gw, u) - 0.2

        def cell(i, j, a, b, c, d):
            return K.tint(PLASTER_T, 1.0, seed, 1, i, j, spread=0.015), PLASTER

        K.skin(part, face, K.breaks(z0, zf, 2.0, keep=(rz,)), K.breaks(g0, 22.0, 2.1),
               lambda u, v: gw + plaster(u, v), 1, cell, top=rake)
        # the jetty's soffit (from the storey's face out to the gable's), the bressumer along its
        # face (settled with it), and the gable's ends closed under the eaves
        us = K.breaks(z0, zf, 2.4)
        for i in range(len(us) - 1):
            K.face(part, [face.pt(us[i], g0, -0.02), face.pt(us[i + 1], g0, -0.02), face.pt(us[i + 1], g0, gw),
                          face.pt(us[i], g0, gw)], (0.0, -1.0, 0.0), K.tint(OAK, 0.8, seed, 2, i), TIMBER)
        self.plate(part, face, z0 - 0.15, zf + 0.15, lambda u: SIDE_PLATE + 0.2, gw - 0.01, seed + 3, size=(0.32, 0.42),
                   tone=0.85)
        for u, facing in ((z0, -1.0), (zf, 1.0)):
            K.face(part, [face.pt(u, g0, -0.02), face.pt(u, g0, gw), face.pt(u, max(g0, rake(u)) + 0.15, gw),
                          face.pt(u, max(g0, rake(u)) + 0.15, -0.02)], (0.0, 0.0, facing),
                   K.tint(OAK, 0.75, seed, 4, u), TIMBER)
        # ---- the truss
        tie = SIDE_PLATE + 0.2 + 0.16          # the bressumer's top: the posts' feet
        wf = gw + POST_W

        def under(u):
            """The verge's slab's underside over the face (world)."""
            return R.under(x + sx * (gw + 0.1), u)

        def raf_c(u):
            return self.v_at(face, u, under(u) + 0.05 - RAFTER[0] / 2, wf)

        def raf_lo(u):
            return self.v_at(face, u, under(u) + 0.1 - RAFTER[0], wf)

        # what the frame stands aside for: the chimney's shaft (through the verge's notch) on the
        # right; the loft door and the hoist's hood over it on the left (the king post stops under
        # the one and starts again over the other)
        if sx > 0:
            gap = (fire['z'] - SHAFT_HALF - 0.3, fire['z'] + SHAFT_HALF + 0.35)
            blocked = [(gap[0], gap[1], g0, 99.0)]
        else:
            gap = None
            blocked = [(rz - LOFT_HALF - 0.45, rz + LOFT_HALF + 0.45, GABLE_MID - 0.05, LOFT_SILL + 4.65)]

        def free(u, v0, v1, half):
            """The stretches of [v0, v1] at u a member `half` wide either side may stand in."""
            cuts = sorted((c, d) for (a, b, c, d) in blocked if a - half < u < b + half and c < v1 and d > v0)
            out, v = [], v0
            for (c, d) in cuts:
                if c > v + 0.3:
                    out.append((v, c))
                v = max(v, d)
            if v1 > v + 0.3:
                out.append((v, v1))
            return out

        def level(v, size, sd, a=z0, b=zf, at=rz):
            """A level rail with its top at v from a to b (across the whole gable, or a window's
            bay), its ends dying into the rafters wherever they come down under it (`at` stands
            under them), in lengths from post to post, none behind the shaft."""
            back = a if raf_lo(a) >= v else self.meet(raf_lo, v, at, a)
            front = b if raf_lo(b) >= v else self.meet(raf_lo, v, at, b)
            stations = [back] + [g for g in grid if back + 0.2 < g < front - 0.2] + [front]
            for i in range(len(stations) - 1):
                p, q = stations[i], stations[i + 1]
                if gap and gap[0] < (p + q) / 2 < gap[1]:
                    continue
                inside = p in grid and q in grid
                self.oak(part, face, (p, v - size[0] / 2), (q, v - size[0] / 2), size, gw + RAIL_W, sd + i,
                         caps=not inside)

        # the rafters (the right's front one stops either side of the verge's notch round the shaft)
        if sx > 0:
            n0, n1 = R.notch_z
            self.rafter(part, face, zf - 0.02, n1, raf_c, wf + RAFTER_W + 0.012, seed + 5, n=4, over=0.0)
            self.rafter(part, face, n0, rz, raf_c, wf + RAFTER_W + 0.012, seed + 6, n=1)
        else:
            self.rafter(part, face, zf - 0.02, rz, raf_c, wf + RAFTER_W + 0.012, seed + 6, n=5)
        # (the back one a hair behind the front one, where they cross at the apex)
        self.rafter(part, face, z0 + 0.02, rz, raf_c, wf + RAFTER_W, seed + 7, n=5)
        # the posts on the bay lines, from the tie up into the rafters
        for k, u in enumerate(grid):
            size = QUEEN if abs(u - rz) < 4.0 else STUD
            for (va, vb) in free(u, tie - 0.04, self.seat(raf_lo, u, size[0] / 2), size[0] / 2):
                self.oak(part, face, (u, va), (u, vb), size, wf, seed + 10 + k * 1.7)
        # the girt, the middle rail and the collar
        level(GABLE_SILL, RAIL, seed + 30)
        level(GABLE_MID, RAIL, seed + 50)
        vc = GABLE_COLLAR + COLLAR[0] / 2
        back, front = self.meet(raf_lo, vc, rz, z0), self.meet(raf_lo, vc, rz, zf)
        for (p, q) in ([(back, gap[0]), (gap[1], front)] if gap else [(back, front)]):
            self.oak(part, face, (p - 0.06, GABLE_COLLAR), (q + 0.06, GABLE_COLLAR), COLLAR, gw + RAIL_W, seed + 70 + p)
        # the windows: framed in their bays (a head rail over each, a sill rail under one that
        # stands off the girt), casements with their shutters thrown back, the highest small and bare
        wins = self.gable_windows(sx)
        for k, (u, sill, hgt, w) in enumerate(wins):
            a = max([z0] + [g for g in grid if g < u])
            b = min([zf] + [g for g in grid if g > u])
            level(sill + hgt + HEAD[0], HEAD, seed + 80 + k * 5, a, b, u)
            if abs(sill - GABLE_SILL) > 0.05:
                level(sill, HEAD, seed + 83 + k * 5, a, b, u)
            high = sill > 14.0
            self.casement(part, face, u, sill, w, hgt, gw, seed=seed + 20 + k, shutters=not high, bow=plaster)

    def _job_board(self, part, inner, seed):
        """The job board on the left wall by the door, where the old painted one hung: an oak
        frame round a boarded face, a little slate hood over it, the notices pinned up every
        which way, and a lantern beside it to read them by."""
        u0, u1, v0, v1 = JOB_BOARD
        # (the boarded back stands just proud of the plaster's belly, the inner face's 0.03)
        w = 0.025
        n_in = tuple(-inner.n)
        # the boarded back and its frame, the whole board hung a degree or two off level
        tilt = jit(0.04, seed, 1)
        K.face(part, [inner.pt(u0, v0 + tilt, w - 0.06), inner.pt(u1, v0 - tilt, w - 0.06),
                      inner.pt(u1, v1 - tilt, w - 0.06), inner.pt(u0, v1 + tilt, w - 0.06)], n_in,
               K.tint(OAK, 0.95, seed, 2), TIMBER)
        for k, ((a0, b0), (a1, b1)) in enumerate((((u0 - 0.12, v0 + tilt), (u1 + 0.12, v0 - tilt)),
                                                  ((u0 - 0.12, v1 + tilt), (u1 + 0.12, v1 - tilt)),
                                                  ((u0, v0 - 0.1 + tilt), (u0, v1 + 0.1 + tilt)),
                                                  ((u1, v0 - 0.1 - tilt), (u1, v1 + 0.1 - tilt)))):
            K.hewn(part, inner.pt(a0, b0, w - 0.14), inner.pt(a1, b1, w - 0.14), 0.18, 0.16,
                   K.tint(OAK, 0.72, seed, 3, k), TIMBER, seed=seed + 4 + k, segs=1, up=n_in)
        # a little slate hood over it on two brackets (each bracket under the hood, never through it)
        hood = [inner.pt(u0 - 0.35, v1 + 0.25, w - 0.02), inner.pt(u1 + 0.35, v1 + 0.25, w - 0.02),
                inner.pt(u1 + 0.35, v1 + 0.02, w - 0.62), inner.pt(u0 - 0.35, v1 + 0.02, w - 0.62)]
        K.face(part, hood, (n_in[0], 1.0, n_in[2]), (0.86, 0.86, 0.86), ROOF)
        K.face(part, list(reversed(hood)), (-n_in[0], -1.0, -n_in[2]), K.tint(OAK, 0.6, seed, 9), K.FLOOR)
        for u in (u0 - 0.1, u1 + 0.1):
            K.hewn(part, inner.pt(u, v1 - 0.35, w - 0.04), inner.pt(u, v1 - 0.04, w - 0.5), 0.09, 0.09,
                   K.tint(OAK, 0.7, seed, 10, u), TIMBER, seed=seed + 11, segs=1)
        # the notices: parchment of every size, pinned at every angle, a few overlapping
        notes = [(10.55, 3.2, 0.62, 0.78), (11.25, 3.35, 0.55, 0.62), (11.95, 3.15, 0.7, 0.86),
                 (12.5, 3.4, 0.42, 0.5), (10.7, 2.35, 0.7, 0.62), (11.55, 2.4, 0.6, 0.82),
                 (12.3, 2.45, 0.6, 0.66), (11.0, 2.75, 0.4, 0.42)]
        for k, (u, v, nw, nh) in enumerate(notes):
            a = jit(0.18, seed, 12, k)
            ca, sa = math.cos(a), math.sin(a)
            corners = [(-nw / 2, -nh / 2), (nw / 2, -nh / 2), (nw / 2, nh / 2), (-nw / 2, nh / 2)]
            depth = w - 0.09 - 0.008 * k
            pts = [inner.pt(u + cx * ca - cy * sa, v + cx * sa + cy * ca, depth) for (cx, cy) in corners]
            col = (0.93, 0.86, 0.68) if k % 3 else (0.86, 0.78, 0.6)
            K.face(part, pts, n_in, K.tint(col, 1.0, seed, 13, k, spread=0.05), K.PLAIN)
            # a pin, and a few lines of ink across it
            K.lump(part, tuple(inner.pt(u - sa * nh * 0.38, v + ca * nh * 0.38, depth - 0.03)), (0.06, 0.06, 0.06),
                   (0.62, 0.14, 0.12) if k % 2 else (0.22, 0.22, 0.24), K.PLAIN, seed=seed + 14 + k, rough=0.2)
            for line in range(3 if nh > 0.55 else 2):
                ly = nh * (0.18 - 0.2 * line)
                lw = nw * (0.7 - 0.12 * ((k + line) % 3))
                q = [(-lw / 2, ly - 0.02), (lw / 2, ly - 0.02), (lw / 2, ly + 0.02), (-lw / 2, ly + 0.02)]
                K.face(part, [inner.pt(u + cx * ca - cy * sa, v + cx * sa + cy * ca, depth - 0.006) for (cx, cy) in q],
                       n_in, (0.24, 0.2, 0.17), K.PLAIN)

    def _chimney_stack(self, part, out, fire, ground, seed):
        """The wall fire's chimney: a broad stone breast built up the outside of the right gable
        from the ground to the gable's jetty, weathered in there to a tall shaft that climbs the
        gable up through the verge's notch (inn_roof.NOTCH_HALF) past the slates, a dressed band
        where it clears them, an oversailing cap, and two crooked pots (the smoke rises out of
        them, src/render/mirefen_tavern_smoke_core.ts)."""
        zt = fire['z']             # where its pots stand (the smoke rises there)
        x0 = out.pt(0, 0, 0).x
        # the stack leans along the gable: it rises from the ground a little back toward the hall's
        # back and climbs to its pots over the fire (a degree of lean, the whole stack together,
        # so its courses stay one solid piece)
        lean = 0.35
        g = ground(zt - lean)
        breast = SIDE_PLATE + 0.6
        weather = breast + 1.1

        def zc(y):
            return zt - lean * (1.0 - min(1.0, max(0.0, (y - g) / (SHAFT_TOP - g))))

        rings = [(g - 0.3, 2.15, 2.25), (2.6, 2.05, 2.15), (breast, 1.95, 2.0), (weather, SHAFT_REACH, SHAFT_HALF),
                 (SHAFT_TOP, SHAFT_REACH - 0.05, SHAFT_HALF - 0.05)]
        prev = None
        for k, (y, reach, half) in enumerate(rings):
            c = zc(y)
            ring = [(x0 - 0.05, y, c - half), (x0 + reach, y, c - half + jit(0.03, seed, k)),
                    (x0 + reach, y, c + half + jit(0.03, seed, k, 1)), (x0 - 0.05, y, c + half)]
            if prev is not None:
                K.block(part, prev + ring, K.tint(STONE_T, 0.98, seed, k), STONE)
            prev = ring
        # a dressed string at the breast's shoulder, a band where the shaft clears the slates,
        # and the oversailing cap
        R = self.roof
        clear = R.height(x0 + 1.0, zt) + 0.35
        for k, (y, reach, half, th) in enumerate(((breast - 0.05, 2.1, 2.1, 0.24),
                                                  (clear, SHAFT_REACH + 0.12, SHAFT_HALF + 0.08, 0.22),
                                                  (SHAFT_TOP + 0.08, SHAFT_REACH + 0.2, SHAFT_HALF + 0.16, 0.26))):
            K.lump(part, (x0 + reach / 2 - 0.04, y, zc(y)), (reach + 0.08, th, half * 2 + 0.1),
                   K.tint(DRESSED_T, 0.9, seed, 5, k), DRESSED, seed=seed + 6 + k, rough=0.05)
        # two pots, neither quite upright
        for k, dz in enumerate((-0.42, 0.45)):
            base = (x0 + SHAFT_REACH / 2 + jit(0.05, seed, 7, k), SHAFT_TOP + 0.2, zt + dz)
            top = K.lean(base, (base[0], SHAFT_TOP + 0.62 + jit(0.06, seed, 8, k), base[2]), 0.07, seed + k)
            part.cylinder(base, top, 0.26, K.tint(DRESSED_T, 0.7, seed, 9, k), DRESSED, sides=7, r1=0.21)

    def _hay_hoist(self, part, out, seed):
        """The loft door high in the left gable over the stable's yard, its leaves thrown open;
        the hoist beam over it run out past the verge under a little slate hood, the pulley block
        at its end, and the rope down to a hook with a sack of feed swinging on it."""
        R = self.roof
        zc, w = R.rz, SIDE_JETTY
        n = tuple(out.n)
        hw, sill = LOFT_HALF, LOFT_SILL
        head = sill + 2.4
        # the dark loft beyond the doorway, set back into the gable
        K.face(part, [out.pt(zc - hw, sill, w + 0.05), out.pt(zc + hw, sill, w + 0.05),
                      out.pt(zc + hw, head, w + 0.05), out.pt(zc - hw, head, w + 0.05)], n, (0.15, 0.12, 0.1), K.PLAIN,
               tag=K.FLAT)
        # its frame: two posts, a head and a sill board, none quite square
        for k, ((a0, b0), (a1, b1)) in enumerate((((zc - hw - 0.12, sill - 0.1), (zc - hw - 0.1, head + 0.18)),
                                                  ((zc + hw + 0.12, sill - 0.1), (zc + hw + 0.14, head + 0.16)),
                                                  ((zc - hw - 0.35, head + 0.14), (zc + hw + 0.35, head + 0.1)),
                                                  ((zc - hw - 0.3, sill - 0.06), (zc + hw + 0.3, sill - 0.08)))):
            K.hewn(part, out.pt(a0, b0, w + 0.1), out.pt(a1, b1, w + 0.1), 0.26, 0.2, K.tint(OAK, 0.8, seed, k), TIMBER,
                   seed=seed + k, segs=1, up=n)
        # the two leaves, swung back flat against the gable either side, ledged and braced
        for s in (-1, 1):
            a, b = zc + s * (hw + 0.24), zc + s * (2 * hw + 0.2)
            c = out.pt((a + b) / 2, (sill + head) / 2, w + 0.17)
            K.lump(part, (c.x, c.y, c.z), self._along(out, abs(b - a), head - sill - 0.1, 0.1),
                   K.tint(OAK, 0.66, seed, 5, s), TIMBER, seed=seed + 6 + s, rough=0.04)
            for v in (sill + 0.4, head - 0.4):
                K.hewn(part, out.pt(a, v, w + 0.25), out.pt(b, v, w + 0.25), 0.14, 0.06, K.tint(OAK, 0.6, seed, 7, s, v),
                       TIMBER, seed=seed + 8, segs=1, up=n)
            K.hewn(part, out.pt(a, sill + 0.45, w + 0.25), out.pt(b, head - 0.45, w + 0.25), 0.12, 0.06,
                   K.tint(OAK, 0.6, seed, 9, s), TIMBER, seed=seed + 9, segs=1, up=n)
        # the hoist beam, from inside the gable out past the verge, and its little hood
        yb = head + 0.75
        K.hewn(part, out.pt(zc, yb, -0.5), out.pt(zc + 0.04, yb - 0.05, 2.75), 0.34, 0.38, K.tint(OAK, 0.78, seed, 10),
               TIMBER, seed=seed + 10, segs=2, sag=0.03, up=(0.0, 1.0, 0.0))
        eave, ridge, half = yb + 0.35, yb + 1.25, 0.95
        w0, w1 = w - 0.05, 3.05
        for s in (-1, 1):
            q = [out.pt(zc, ridge, w0), out.pt(zc, ridge + 0.04, w1), out.pt(zc + s * half, eave, w1),
                 out.pt(zc + s * half, eave - 0.03, w0)]
            K.face(part, q, (0.0, 1.0, 0.0), K.tint(SLATE, 0.92, seed, 11, s), ROOF)
            K.face(part, list(reversed(q)), (0.0, -1.0, 0.0), K.tint(OAK, 0.6, seed, 12, s), K.FLOOR)
            # its bargeboard down this side of its front, and its teeth
            K.hewn(part, out.pt(zc, ridge - 0.1, w1 + 0.04), out.pt(zc + s * (half + 0.05), eave - 0.18, w1 + 0.04), 0.3,
                   0.08, K.tint(OAK, 0.7, seed, 13, s), TIMBER, seed=seed + 13 + s, segs=1)
        # its gable over the beam's end: a little timbered triangle
        K.face(part, [out.pt(zc - half + 0.1, eave - 0.05, w1 - 0.12), out.pt(zc + half - 0.1, eave - 0.05, w1 - 0.12),
                      out.pt(zc, ridge - 0.12, w1 - 0.12)], n, K.tint(PLASTER_T, 0.95, seed, 14), PLASTER)
        tip = out.pt(zc, ridge + 0.04, w1 + 0.05)
        part.cylinder((tip.x, tip.y - 0.1, tip.z), (tip.x, tip.y + 0.6, tip.z), 0.08, K.tint(OAK, 0.7, seed, 15), TIMBER,
                      sides=5, r1=0.05)
        # the pulley block under the beam's end, its wheel, the rope's two falls, the hook and a sack
        end = out.pt(zc, yb - 0.3, 2.45)
        K.lump(part, (end.x, end.y - 0.12, end.z), (0.3, 0.42, 0.26), K.tint(OAK, 0.65, seed, 16), TIMBER, seed=seed + 16,
               rough=0.1)
        K.disc(part, (end.x, end.y - 0.12, end.z + 0.14), (0.0, 0.0, 1.0), 0.16, IRON, METAL, sides=8)
        rope = (0.62, 0.52, 0.36)
        hook = end.y - 2.6
        for dz in (-0.07, 0.07):
            part.cylinder((end.x, end.y - 0.3, end.z + dz), (end.x + jit(0.04, seed, 17, dz), hook + 0.25, end.z + dz),
                          0.035, rope, K.PLAIN, sides=4)
        part.cylinder((end.x, hook + 0.3, end.z), (end.x, hook, end.z), 0.05, IRON, METAL, sides=5)
        K.lump(part, (end.x, hook - 0.45, end.z), (0.7, 0.85, 0.62), (0.74, 0.62, 0.42), K.PLAIN, seed=seed + 18,
               rough=0.22, yaw=0.4)
        K.lump(part, (end.x, hook - 0.02, end.z), (0.32, 0.22, 0.3), (0.66, 0.55, 0.38), K.PLAIN, seed=seed + 19,
               rough=0.3)
        # the rope's other fall, down the gable to a cleat by the loft door
        cleat = out.pt(zc + hw + 0.5, sill + 0.6, w + 0.2)
        part.cylinder((end.x, end.y - 0.3, end.z - 0.1), tuple(cleat), 0.03, rope, K.PLAIN, sides=4)
        K.lump(part, tuple(cleat), self._along(out, 0.36, 0.1, 0.12), IRON, METAL, seed=seed + 20, rough=0.1)

    # ================================================================ back
    def back(self):
        """The back wall (z = -14): the arch onto the tower's nook and the kitchen's serving
        hatch go through it; outside, the wing and the tower stand against most of it, and its
        timbered storey runs up under the back eaves."""
        B, H, P = self.B, self.H, self.parts
        R = self.roof
        part = P['HallWallBack']
        z0, t = H['z0'], self.t
        out = Wall(0.0, z0, 1.0, z0, (0.0, -1.0))        # u = x
        inner = Wall(0.0, z0 + t, 1.0, z0 + t, (0.0, -1.0))
        a0, a1, ah = self.arch['x0'], self.arch['x1'], self.arch['height']
        h0, h1, hs, hh = self.hatch['x0'], self.hatch['x1'], self.hatch['sill'], self.hatch['head']
        am = (a0 + a1) / 2
        ahw = (a1 - a0) / 2
        spring = ah - 1.5
        seed = 300

        def ground(u):
            return B.ground(u, z0 - 0.4) - 0.7

        def arch_v(u):
            k = max(0.0, 1.0 - ((u - am) / ahw) ** 2)
            return spring + (ah - spring) * math.sqrt(k)

        def in_arch(a, b, c, d):
            return a >= a0 - 1e-6 and b <= a1 + 1e-6

        def in_hatch(a, b, c, d):
            return a >= h0 - 1e-6 and b <= h1 + 1e-6 and c >= hs - 1e-6 and d <= hh + 1e-6

        keep = (a0, a1, h0, h1)
        stone = self.stone_depth(out, seed, ground)
        us = K.breaks(H['x0'], H['x1'], 2.0, keep=keep)
        self._stone_face(part, out, us, K.breaks(0.0, TOP_STONE, 1.5, keep=(hs, hh, spring)), stone, ground,
                         hole=lambda a, b, c, d: in_arch(a, b, c, d) or in_hatch(a, b, c, d), seed=seed)
        self._plinth(part, out, us, stone, ground, seed=seed + 1)
        self.sill_cap(part, out, H['x0'] - 0.1, H['x1'] + 0.1, seed + 2)
        # the arch's spandrels on both faces and its soffit
        n = 9
        for i in range(n):
            ua, ub = a0 + 2 * ahw * i / n, a0 + 2 * ahw * (i + 1) / n
            va, vb = arch_v(ua), arch_v(ub)
            K.face(part, [out.pt(ua, va, stone(ua, va)), out.pt(ub, vb, stone(ub, vb)),
                          out.pt(ub, TOP_STONE, stone(ub, TOP_STONE)), out.pt(ua, TOP_STONE, stone(ua, TOP_STONE))],
                   (0.0, 0.0, -1.0), K.tint(STONE_T, 1.0, seed, 3, i), STONE, soft=True)
            K.face(part, [inner.pt(ua, va, 0.0), inner.pt(ub, vb, 0.0), inner.pt(ub, TOP_STONE, 0.0),
                          inner.pt(ua, TOP_STONE, 0.0)], (0.0, 0.0, 1.0), K.tint(PLASTER_IN, 1.0, seed, 4, i), PLASTER)
            K.face(part, [out.pt(ua, va, stone(ua, va)), out.pt(ub, vb, stone(ub, vb)), inner.pt(ub, vb, 0.0),
                          inner.pt(ua, va, 0.0)], (0.0, -1.0, 0.0), K.tint(DRESSED_T, 0.85, seed, 5, i), DRESSED)
            # a voussoir proud of the inner face (the hall's side of the arch)
            mid = (ua + ub) / 2
            ang = math.atan2(arch_v(mid) - spring + 1.0, mid - am)
            ox, oy = math.cos(ang) * 0.65, math.sin(ang) * 0.65
            q = [inner.pt(ua, va, -0.02), inner.pt(ub, vb, -0.02), inner.pt(ub + ox, vb + oy, -0.02),
                 inner.pt(ua + ox, va + oy, -0.02)]
            r = [inner.pt(ua, va, 0.16), inner.pt(ub, vb, 0.16), inner.pt(ub + ox, vb + oy, 0.16),
                 inner.pt(ua + ox, va + oy, 0.16)]
            K.block(part, q + r, K.tint(DRESSED_T, 1.0 + jit(0.05, seed, 6, i), seed, 7, i), DRESSED)
        for u in (a0, a1):
            s = -1 if u == a0 else 1
            for j, (v0, v1) in enumerate(((0.0, spring / 2), (spring / 2, spring))):
                K.face(part, [out.pt(u, v0, stone(u, v0)), out.pt(u, v1, stone(u, v1)), inner.pt(u, v1, 0.0),
                              inner.pt(u, v0, 0.0)], (-s, 0.0, 0.0), K.tint(DRESSED_T, 0.9, seed, 8, j), DRESSED)
        # the hatch's reveals and its oak frame and sill board
        for (pa, pb, nrm) in (((h0, hs), (h0, hh), (1, 0, 0)), ((h1, hs), (h1, hh), (-1, 0, 0)),
                              ((h0, hh), (h1, hh), (0, -1, 0)), ((h0, hs), (h1, hs), (0, 1, 0))):
            K.face(part, [out.pt(pa[0], pa[1], stone(*pa)), out.pt(pb[0], pb[1], stone(*pb)),
                          inner.pt(pb[0], pb[1], 0.0), inner.pt(pa[0], pa[1], 0.0)], nrm,
                   K.tint(OAK, 0.85, seed, 9, pa[0], pb[1]), TIMBER)
        for (pa, pb) in (((h0 - 0.1, hs), (h0 - 0.1, hh + 0.12)), ((h1 + 0.1, hs), (h1 + 0.1, hh + 0.12)),
                         ((h0 - 0.25, hh + 0.12), (h1 + 0.25, hh + 0.12))):
            K.hewn(part, inner.pt(pa[0], pa[1], -0.08), inner.pt(pb[0], pb[1], -0.08), 0.22, 0.16,
                   K.tint(OAK, 0.8, seed, 10, pa[0]), TIMBER, seed=seed + 11 + pa[0], segs=1, up=(0.0, 0.0, 1.0))
        c = inner.pt((h0 + h1) / 2, hs - 0.04, -0.2)
        K.lump(part, (c.x, c.y, c.z), (h1 - h0 + 0.6, 0.1, 0.6), K.tint(OAK, 0.95, seed, 12), TIMBER, seed=seed + 12,
               rough=0.04)
        # the inner face (plaster over a skirting), round the arch and the hatch, and its last
        # course on up under the sarking
        plaster_in = self.plaster_depth(seed + 13, amp=0.03)
        us_in = K.breaks(H['x0'] + t, H['x1'] - t, 2.0, keep=keep)

        def in_cell(i, j, a, b, c, d):
            if d <= 1.0 + 1e-6:
                return K.tint(DRESSED_T, 0.92, seed, i, j, spread=0.04), DRESSED
            return K.tint(PLASTER_IN, 1.0, seed, i, j, spread=0.012), PLASTER

        K.skin(part, inner, us_in, K.breaks(0.0, INNER_BAND, 1.6, keep=(1.0, hs, hh, spring, JETTY)),
               lambda u, v: plaster_in(u, v), -1, in_cell,
               hole=lambda a, b, c, d: (in_arch(a, b, c, d) and d <= JETTY + 1e-6) or in_hatch(a, b, c, d))
        K.skin(part, inner, us_in, [INNER_BAND, B.ROOF_EAVE + 1.2], lambda u, v: plaster_in(u, v), -1, in_cell,
               top=lambda u: R.under(u, z0 + t) + 0.12)
        # the timbered storey up under the back eaves (its top halfway into the roof's slab there),
        # framed on the front's grid (each pair of posts a cross frame under the roof), settled and
        # racked like the front; its one window over the stage's corner, where the tower and the
        # wing leave the back wall open
        face = Racked(K.Settled(out, TOP_STONE, H['ridge'], sag=0.1, lean=0.06, half=H['x1'] + 0.6), SILL_TOP,
                      B.ROOF_EAVE, 0.012, seed + 17)
        posts = front_posts(H['x1'], CROSS_HALF, self.split, corner=H['x1'])
        self.timber_storey(part, face, H['x0'] - 0.15, H['x1'] + 0.15, lambda u: (R.height(u, z0) + R.under(u, z0)) / 2,
                           posts, [((posts[1] + posts[2]) / 2, 1.25)], seed + 15)
        # the panelling inside
        self._line_back(inner, us_in, K.breaks(0.0, INNER_BAND, 1.6, keep=(1.0, hs, hh, spring, JETTY)), plaster_in,
                        (a0, a1, ah), (h0, h1, hs, hh))
