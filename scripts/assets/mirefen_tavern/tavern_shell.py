"""The Mirefen tavern's shell (build_tavern.py calls build(B, parts) with itself as B): the walls
and roofs the camera cuts away when a player is outdoors behind them, each its own part, and
whatever hangs on a wall with it (windows, the door, the notice board, trophies, the stage's
curtain, the kitchen hatch, the wall fireplace and its river-stone chimney).

  HallWallFront   the front gable: the doorway and its open doors, two windows, two high
                  lights and the round gable window (their glass glowing like the lanterns':
                  the lit hall behind), the door lanterns (tavern_facade.py)
  HallPorch       the porch canopy on its brackets and the giant tankard hanging from its
                  iron arm, the arm's carved board and scrollwork and the painted board under
                  the tankard (tavern_facade.py): its own part, so a camera behind it ghosts
                  it alone, never the whole front
  HallWallBack    the back gable: the arch onto the tower's nook with its voussoirs, the
                  kitchen's serving hatch with its sill and shutters, the stage's curtain
                  under its pelmet, the garnet banner over it, a shield and crossed spears
  HallWallLeft    the long south side: three windows, two high lights, the antlered skull,
                  the troll's club and the notice board by the door
  HallWallRight   the long north side, the one travellers from Fenbridge see: three windows,
                  two high lights, the wall fireplace with its fire and the great jawbone over
                  its mantel, and the river-stone chimney outside
  HallRoof        the dark green slate roof, its sarking, rafters, purlins and ridge, and the
                  hammerbeam trusses: every timber of them over HALL['truss'], so none
                  crosses the room where the camera flies
  WingWall*       the wing's stone lower storey and timber-framed upper storey
  WingRoof        its slate roof
  TowerWall       the round tower's wall, open to the hall under the arch: coursed ashlar
                  both sides over a mortar core, arrow slits in dressed frames
  TowerRoof       its slate cone, the rafters seen from the nook under it, and its finial
"""
import math

import tavern_facade as FA
import tavern_jetty as JET
import tavern_roofing as RF

# the two ground-floor windows in the front gable, either side of the door (u along the
# wall from its left end, v up): the window booths inside look out of them
FRONT_WINDOWS = ((6.2, 7.8, 2.8, 5.0), (24.2, 25.8, 2.8, 5.0))
# the two upper windows (high lights) either side of the porch canopy
FRONT_UPPER_WINDOWS = ((9.4, 10.6, 6.6, 8.4), (21.4, 22.6, 6.6, 8.4))
# the front wall's posts (local x), filled by hall_front
FRONT_POSTS = []


def build(B, parts):
    hall_front(B, parts['HallWallFront'], parts['HallPorch'])
    hall_back(B, parts['HallWallBack'], parts['TavernTrim'])
    hall_left(B, parts['HallWallLeft'])
    hall_right(B, parts['HallWallRight'])
    hall_roof(B, parts['HallRoof'], parts['TavernClutter'])
    wing_walls(B, parts)
    wing_roof(B, parts['WingRoof'])
    tower_wall(B, parts['TowerWall'], parts['TavernTrim'])
    tower_roof(B, parts['TowerRoof'])


def pitch(B):
    H = B.HALL
    return (H['ridge'] - H['eave']) / H['x1']


def hall_y(B, x):
    """The hall roof's line over x (the slates' underside)."""
    return B.HALL['ridge'] - abs(x) * pitch(B)


def wing_pitch(B):
    W = B.WING
    return (W['ridge'] - W['eave']) / ((W['x1'] - W['x0']) / 2)


def wing_y(B, x):
    W = B.WING
    return W['ridge'] - abs(x - (W['x0'] + W['x1']) / 2) * wing_pitch(B)


# ---------------------------------------------------------------------------
# Small wall furniture
# ---------------------------------------------------------------------------
def lantern(B, p, x, y, z, s=0.34):
    """An iron lantern with warm panes (the harbor's lantern, the tavern's glow)."""
    iron = B.PAL['iron']
    p.box((x, y, z), (s * 1.1, s * 1.4, s * 1.1), iron, B.METAL)
    p.box((x, y, z), (s * 0.82, s * 1.12, s * 1.18), B.PAL['lamp'], B.GLOW)
    p.box((x, y, z), (s * 1.18, s * 1.12, s * 0.82), B.PAL['lamp'], B.GLOW)
    p.box((x, y + s * 0.86, z), (s * 0.8, s * 0.34, s * 0.8), iron, B.METAL, taper=0.4)
    p.box((x, y - s * 0.76, z), (s * 0.74, s * 0.12, s * 0.74), iron, B.METAL, taper=0.8)
    p.box((x, y + s * 1.12, z), (0.06, 0.16, 0.06), iron, B.METAL)


def oculus(B, p, wall, u, v, r, t, lit=False, outer=True, inner=True):
    """A round window: a timber ring round warm glass (glowing when `lit`), a cross of
    glazing bars; `outer`/`inner` pick the faces its ring dresses."""
    half = t / 2
    for s in ([1] if outer else []) + ([-1] if inner else []):
        c = wall.pt(u, v, s * (half + 0.05))
        p.ring(c, r, 0.2, B.PAL['beam_dark'], segments=14, axis=(wall.nx, 0, wall.nz), mat=B.WOOD, depth=0.14)
    c = wall.pt(u, v, 0)
    p.cylinder(wall.pt(u, v, -half - 0.04), wall.pt(u, v, half + 0.04), r - 0.05,
               B.PAL['glass_lit'] if lit else B.PAL['glass'], B.GLOW if lit else B.STONE, sides=14)
    wall.box(p, u - r, u + r, v - 0.05, v + 0.05, -half - 0.08, half + 0.08, B.PAL['beam_dark'], B.WOOD)
    wall.box(p, u - 0.05, u + 0.05, v - r, v + r, -half - 0.08, half + 0.08, B.PAL['beam_dark'], B.WOOD)
    return c


def corbels(B, p, wall, u0, u1, v, t, every=3.2):
    """Carved brackets under a jettied beam on the outer face."""
    n = max(1, int((u1 - u0) / every))
    for k in range(n + 1):
        u = u0 + (u1 - u0) * k / n
        wall.box(p, u - 0.16, u + 0.16, v - 0.9, v - 0.2, t / 2, t / 2 + 0.35, B.PAL['beam_dark'], B.WOOD)
        wall.box(p, u - 0.16, u + 0.16, v - 0.2, v, t / 2, t / 2 + 0.5, B.PAL['beam_dark'], B.WOOD)


def gable_timbers(B, p, wall, top, t, eave, mid_u, span, breaks=(), faces=(1, -1), bressumer=True):
    """The gable's king post, collar and struts on `faces` (1 outside, -1 inside), and the
    jettied bressumer on its brackets; the collar and the bressumer part at `breaks` (where the
    wall is split into shell parts)."""
    apex = top(mid_u)
    collar = eave + (apex - eave) * 0.42

    def runs(a, b):
        cut = [a] + sorted(u for u in breaks if a + 0.05 < u < b - 0.05) + [b]
        return list(zip(cut, cut[1:]))

    for s in faces:
        w = s * (t / 2 + 0.03)
        wall.beam(p, mid_u, eave + 0.2, mid_u, apex - 0.1, w, 0.36, 0.12, B.PAL['beam'], hewn=0.02)
        cu = (B.HALL['ridge'] - 0.1 - collar) / pitch(B)
        for (a, b) in runs(mid_u - cu + 0.2, mid_u + cu - 0.2):
            wall.beam(p, a, collar, b, collar, w, 0.3, 0.12, B.PAL['beam'])
        for d in (-1, 1):
            ua, va, ub, vb = mid_u + d * span * 0.42, eave + 0.2, mid_u + d * 0.2, collar - 0.1
            cut = [0.0] + sorted((u - ua) / (ub - ua) for u in breaks if min(ua, ub) < u < max(ua, ub)) + [1.0]
            for (f0, f1) in zip(cut, cut[1:]):
                wall.beam(p, ua + (ub - ua) * f0, va + (vb - va) * f0, ua + (ub - ua) * f1, va + (vb - va) * f1, w,
                          0.26, 0.12, B.PAL['beam'])
    if not bressumer:
        return collar
    # the jettied bressumer beam across the eave line, on carved brackets
    for (a, b) in runs(0.0, wall.length):
        wall.box(p, a, b, eave - 0.1, eave + 0.45, t / 2 - 0.1, t / 2 + 0.4, B.PAL['beam_dark'], B.WOOD)
    corbels(B, p, wall, 0.6, wall.length - 0.6, eave - 0.1, t)
    return collar


def wall_plate(B, p, wall, v, t):
    """The dark wall plate along a side wall's top, inside, under the rafters."""
    wall.box(p, 0.0, wall.length, v, v + 0.4, -t / 2 - 0.15, t / 2 - 0.1, B.PAL['beam_dark'], B.WOOD)


# ---------------------------------------------------------------------------
# The front gable
# ---------------------------------------------------------------------------
def tankard(B, p, x, y, z):
    """The giant wooden beer tankard hung as the tavern's sign: honey staves bound by three
    iron hoops, a D handle, a head of foam spilling over the rim."""
    h, r0, r1 = 2.8, 1.2, 1.06
    n = 16
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = a0 + 2 * math.pi / n
        col = B.pick(B.PAL['honey'], i)
        pts = [(x + math.sin(a0) * r0, y, z + math.cos(a0) * r0), (x + math.sin(a1) * r0, y, z + math.cos(a1) * r0),
               (x + math.sin(a1) * (r0 - 0.16), y, z + math.cos(a1) * (r0 - 0.16)),
               (x + math.sin(a0) * (r0 - 0.16), y, z + math.cos(a0) * (r0 - 0.16)),
               (x + math.sin(a0) * r1, y + h, z + math.cos(a0) * r1),
               (x + math.sin(a1) * r1, y + h, z + math.cos(a1) * r1),
               (x + math.sin(a1) * (r1 - 0.16), y + h, z + math.cos(a1) * (r1 - 0.16)),
               (x + math.sin(a0) * (r1 - 0.16), y + h, z + math.cos(a0) * (r1 - 0.16))]
        B.hexa(p, pts, col, B.WOOD)
    p.cylinder((x, y, z), (x, y + 0.2, z), r0 - 0.1, B.PAL['beam'], B.WOOD, sides=n)
    for yy, rr in ((0.35, r0 - 0.02), (h * 0.5, (r0 + r1) / 2 - 0.01), (h - 0.35, r1 + 0.01)):
        p.ring((x, y + yy, z), rr + 0.04, 0.16, B.PAL['iron'], segments=n, axis=(0, 1, 0), mat=B.METAL,
               depth=0.06)
    # the handle on the +x side, square-section, a D in profile
    pts = [(x + r0 - 0.05, y + h - 0.45, z), (x + r0 + 0.7, y + h - 0.5, z), (x + r0 + 0.95, y + h * 0.5, z),
           (x + r0 + 0.7, y + 0.6, z), (x + r0 - 0.05, y + 0.55, z)]
    p.beam(pts, 0.34, 0.3, B.PAL['honey'][1], B.WOOD, up=(0, 0, 1))
    # the foam: a flat head and lumps over the rim, two spills down the front
    p.cylinder((x, y + h - 0.2, z), (x, y + h + 0.22, z), r1 - 0.05, B.PAL['foam'], B.PLASTER, sides=n)
    for k in range(8):
        a = 2 * math.pi * k / 8 + 0.2
        p.rock_blob((x + math.sin(a) * (r1 - 0.25), y + h + 0.28, z + math.cos(a) * (r1 - 0.25)), (0.7, 0.45, 0.7),
                    B.PAL['foam'], B.PLASTER, jitter=0.1, subdivisions=1)
    p.rock_blob((x, y + h + 0.5, z), (0.9, 0.55, 0.9), B.PAL['foam'], B.PLASTER, jitter=0.1)
    for a, dy in ((0.35, 0.7), (-0.5, 0.45)):
        p.rock_blob((x + math.sin(a) * (r1 + 0.02), y + h - dy * 0.6, z + math.cos(a) * (r1 + 0.02)),
                    (0.3, dy + 0.3, 0.2), B.PAL['foam'], B.PLASTER, jitter=0.05, subdivisions=1)


def notice_board(B, p, wall, u0, u1, v0, v1, t):
    """The notice board on a wall's inner face: a framed board under a little shingled hood,
    papers pinned at angles, a garnet pin in each."""
    f = -t / 2
    wall.box(p, u0, u1, v0, v1, f - 0.12, f, B.PAL['board'][2], B.WOOD)
    for (a, b, c, d) in ((u0 - 0.1, u1 + 0.1, v1, v1 + 0.14), (u0 - 0.1, u1 + 0.1, v0 - 0.14, v0),
                         (u0 - 0.1, u0, v0, v1), (u1, u1 + 0.1, v0, v1)):
        wall.box(p, a, b, c, d, f - 0.18, f, B.PAL['beam_dark'], B.WOOD)
    wall.box(p, u0 - 0.3, u1 + 0.3, v1 + 0.14, v1 + 0.3, f - 0.5, f, B.PAL['beam'], B.WOOD)
    papers = ((0.2, 0.25, 0.7, 0.9, 0.08), (1.05, 0.15, 0.6, 0.75, -0.12), (1.8, 0.35, 0.8, 0.6, 0.05),
              (0.35, 1.2, 0.9, 0.6, -0.06), (1.35, 1.05, 0.55, 0.8, 0.14), (2.1, 1.15, 0.6, 0.55, -0.1))
    for i, (u, v, w, h, roll) in enumerate(papers):
        cu, cv = u0 + u + w / 2, v0 + v + h / 2
        if cu + w / 2 > u1 or cv + h / 2 > v1:
            continue
        x, y, z = wall.pt(cu, cv, f - 0.14)
        yaw = math.atan2(-wall.nx, -wall.nz)
        p.box((x, y, z), (w, h, 0.02), B.PAL['parchment'] if i % 3 else B.PAL['cream'], B.PLASTER, yaw=yaw,
              roll=roll)
        x, y, z = wall.pt(cu, cv + h / 2 - 0.08, f - 0.16)
        p.box((x, y, z), (0.07, 0.07, 0.03), B.PAL['garnet'], B.METAL, yaw=yaw)


def hall_front(B, p, porch_part):
    H, t = B.HALL, B.HALL['wall']
    zc = H['z1'] - t / 2
    wall = B.Wall(H['x0'], zc, H['x1'], zc, (0, 1))
    mid = -H['x0']
    door = B.LAYOUT['door']
    d0, d1 = mid + door['x'] - door['width'] / 2, mid + door['x'] + door['width'] / 2

    def top(u):
        return hall_y(B, u - mid) - 0.1

    openings = [(d0, d1, 0.0, door['height']), *FRONT_WINDOWS, *FRONT_UPPER_WINDOWS]
    # the wall parts either side of the door (build_tavern.py FRONT_SPLIT): nothing runs across
    breaks = (mid - B.FRONT_SPLIT, mid + B.FRONT_SPLIT)
    jy = B.LAYOUT['jetty']['y']
    # the posts' local x, for the weathering at their feet (tavern_facade.py); outside, the
    # ground floor's frame stops under the jettied upper storey, whose own frame stands a yard
    # further out (tavern_jetty.py)
    FRONT_POSTS[:] = [u - mid for u in B.timber_wall(p, wall, t, top, openings, base_h=1.4, bays=3.6, seed=1,
                                                      breaks=breaks, outer_to=jy)]
    # the front's windows glow like the lanterns: the lit hall behind them, seen from the road;
    # the upper ones and the round gable window keep only their inside (the jettied storey
    # stands in front of them outside, with its own windows)
    for (a, b, v0, v1) in openings[1:]:
        low = v0 < 5
        B.window(p, wall, a, b, v0, v1, t, shutters=low, lit=True, outer=low)
    gable_timbers(B, p, wall, top, t, H['eave'], mid, H['x1'] - H['x0'], breaks=breaks, faces=(-1,),
                  bressumer=False)
    oculus(B, p, wall, mid, H['eave'] + (H['ridge'] - H['eave']) * 0.62, 1.0, t, lit=True, outer=False)
    # the jettied upper storey over it all, a yard toward the road
    JET.skin(B, p)
    # the doorway: heavy posts, a lintel with carved spandrel braces, a stone step
    col = B.PAL['beam_dark']
    for s in (1, -1):
        w = s * (t / 2 + 0.04)
        wall.beam(p, d0 - 0.24, 0.0, d0 - 0.24, door['height'] + 0.5, w, 0.48, 0.16, col)
        wall.beam(p, d1 + 0.24, 0.0, d1 + 0.24, door['height'] + 0.5, w, 0.48, 0.16, col)
        wall.beam(p, d0 - 0.6, door['height'] + 0.3, d1 + 0.6, door['height'] + 0.3, w, 0.6, 0.18, col)
        wall.beam(p, d0, door['height'] - 0.9, d0 + 0.9, door['height'], w, 0.22, 0.14, B.PAL['beam'])
        wall.beam(p, d1, door['height'] - 0.9, d1 - 0.9, door['height'], w, 0.22, 0.14, B.PAL['beam'])
    # the doors, swung right open against the inside of the wall
    zi = H['z1'] - t - 0.02
    half = door['width'] / 2
    for s in (1, -1):
        xa, xb = sorted((s * (half + 0.05), s * (half * 2 + 0.05)))
        n = 5
        for k in range(n):
            a = xa + (xb - xa) * k / n
            B.abox(p, a + 0.01, a + (xb - xa) / n - 0.01, 0.05, door['height'] - 0.1, zi - 0.18, zi,
                   B.pick(B.PAL['honey'], k + (s > 0)), B.WOOD)
        for yy in (0.8, door['height'] * 0.5, door['height'] - 0.9):
            B.abox(p, xa + 0.05, xb - 0.05, yy - 0.08, yy + 0.08, zi - 0.24, zi - 0.16, B.PAL['iron'], B.METAL)
        ring_x = xa + 0.35 if s > 0 else xb - 0.35
        p.ring((ring_x, 2.4, zi - 0.28), 0.16, 0.05, B.PAL['iron'], segments=8, axis=(0, 0, 1), mat=B.METAL)
    # the door lanterns either side of the canopy
    for x in (-5.0, 5.0):
        FA.door_lantern(B, p, x, 4.2, H['z1'])
    # the porch canopy: a small slate gable on two great curved brackets (its own part), its
    # back against the jettied storey's face
    p = porch_part
    q = B.LAYOUT['porch']
    zj = JET.face_z(B)
    ez, eave, ridge, hwc = q['z1'] + 0.6, 6.2, 8.4, 3.9
    front = ez
    for s in (1, -1):
        x = s * 3.3
        pts = [(x, 4.4, H['z1'] + 0.05), (x, 5.1, H['z1'] + 1.2), (x, 5.7, H['z1'] + 2.2), (x, 6.0, front - 0.2)]
        p.beam(pts, 0.34, 0.4, col, B.WOOD, up=(1, 0, 0))
        B.abox(p, x - 0.2, x + 0.2, 3.8, 4.6, H['z1'], H['z1'] + 0.35, B.PAL['stone_dark'], B.STONE)
    B.abox(p, -hwc, hwc, eave - 0.2, eave + 0.1, front - 0.25, front, col, B.WOOD)
    L = front - zj
    lu = math.hypot(hwc, ridge - eave)
    for s in (1, -1):
        up = (-s * hwc / lu, (ridge - eave) / lu, 0.0)
        RF.shingle_plane(B, p, (s * (hwc + 0.1), eave + 0.1, zj), (0, 0, 1), up, L + 0.3, lu, seed=5 + s,
                         step=0.42, size=0.62, moss=0.35)
        B.hexa(p, [(s * (hwc + 0.1), eave - 0.05, zj), (0, ridge - 0.05, zj), (0, ridge - 0.05, front + 0.3),
                   (s * (hwc + 0.1), eave - 0.05, front + 0.3), (s * (hwc + 0.1), eave + 0.1, zj),
                   (0, ridge + 0.1, zj), (0, ridge + 0.1, front + 0.3), (s * (hwc + 0.1), eave + 0.1, front + 0.3)],
               B.PAL['sarking'], B.WOOD)
        B.beam(p, (s * (hwc + 0.2), eave - 0.1, front + 0.35), (0, ridge + 0.05, front + 0.35), 0.14, 0.4, col)
    # the canopy's little gable face over the door
    B.hexa(p, [(-hwc, eave, front - 0.1), (hwc, eave, front - 0.1), (hwc, eave, front), (-hwc, eave, front),
               (-0.05, ridge - 0.1, front - 0.1), (0.05, ridge - 0.1, front - 0.1), (0.05, ridge - 0.1, front),
               (-0.05, ridge - 0.1, front)], B.PAL['plaster'][0], B.PLASTER)
    # the giant tankard on its iron arm, out over the porch's right side toward the road
    # (the tankard hangs where it always has; its arm now springs from the jettied storey)
    tx, tz, arm = 8.4, H['z1'] + 3.8, 12.0
    B.beam(p, (tx, arm, zj + 0.1), (tx, arm, tz + 0.7), 0.24, 0.24, B.PAL['iron'], B.METAL)
    p.box((tx, arm + 0.2, tz + 0.75), (0.3, 0.3, 0.3), B.PAL['iron'], B.METAL, taper=0.2)
    # the arm's carved mounting board and the wrought scrollwork under it
    FA.sign_ironwork(B, p, tx, arm, zj, tz)
    top_y = arm - 1.6
    for dz in (-0.7, 0.7):
        B.chain(p, (tx, arm - 0.1, tz + dz * 0.5), (tx, top_y + 0.3, tz + dz), links=5)
    base = top_y - 2.8 + 0.3
    tankard(B, p, tx, base, tz)
    # the painted board hung under the tankard: a picture, no lettering
    FA.sign_board(B, p, tx, base, tz)


# ---------------------------------------------------------------------------
# The back gable: the arch onto the nook, the kitchen hatch, the stage's backdrop
# ---------------------------------------------------------------------------
def hall_back(B, p, trim):
    H, t = B.HALL, B.HALL['wall']
    zc = H['z0'] + t / 2
    wall = B.Wall(H['x0'], zc, H['x1'], zc, (0, -1))
    mid = -H['x0']
    arch, hatch = B.LAYOUT['arch'], B.LAYOUT['hatch']
    a0, a1 = mid + arch['x0'], mid + arch['x1']
    h0, h1 = mid + hatch['x0'], mid + hatch['x1']

    def top(u):
        return hall_y(B, u - mid) - 0.1

    openings = [(a0, a1, 0.0, arch['height']), (h0, h1, hatch['sill'], hatch['head'])]
    B.timber_wall(p, wall, t, top, openings, base_h=1.4, bays=3.6, seed=2)
    gable_timbers(B, p, wall, top, t, H['eave'], mid, H['x1'] - H['x0'])
    kitchen_hatch(B, p, trim, wall, h0, h1, hatch['sill'], hatch['head'], t)
    stage_backdrop(B, p, trim, wall, mid, t)
    # the arch: a segmental head in dressed voussoirs, spandrels filled over the opening's
    # corners, quoins down both jambs
    um, half = (a0 + a1) / 2, (a1 - a0) / 2
    rise = arch['height'] - 3.9
    R = (half * half + rise * rise) / (2 * rise)
    cy = arch['height'] - R
    n = 12
    for k in range(n):
        ua = a0 + (a1 - a0) * k / n
        ub = a0 + (a1 - a0) * (k + 1) / n
        va = cy + math.sqrt(max(0.0, R * R - (ua - um) ** 2))
        vb = cy + math.sqrt(max(0.0, R * R - (ub - um) ** 2))
        wall.box(p, ua, ub, min(va, vb), arch['height'] + 0.02, -t / 2 + 0.04, t / 2 - 0.04,
                 B.pick(B.PAL['plaster'], k), B.PLASTER)
    th0 = math.asin(half / R)
    m = 13
    for k in range(m):
        ta = -th0 + 2 * th0 * k / m
        tb = -th0 + 2 * th0 * (k + 1) / m
        big = 0.85 if k == m // 2 else 0.62
        pts = []
        for (rr, th) in ((R, ta), (R, tb), (R + big, tb), (R + big, ta)):
            pts.append((um + rr * math.sin(th), cy + rr * math.cos(th)))
        corners = [wall.pt(u, v, -t / 2 - 0.08) for (u, v) in pts] + [wall.pt(u, v, t / 2 + 0.08) for (u, v) in pts]
        # the tower's dressed limestone, the keystone palest
        tone = B.PAL['ashlar_hi'] if k == m // 2 else B.scale_color(B.pick(B.PAL['ashlar'], k * 2), 0.97)
        B.hexa(p, [corners[0], corners[1], corners[5], corners[4], corners[3], corners[2], corners[6], corners[7]],
               tone, B.STONE)
    # a hood mould over the voussoirs on both faces: the arch's frame (trim: medium and up)
    rh0, rh1 = R + 0.9, R + 1.08
    for k in range(m + 2):
        ta = -th0 - 0.06 + (2 * th0 + 0.12) * k / (m + 2)
        tb = -th0 - 0.06 + (2 * th0 + 0.12) * (k + 1) / (m + 2)
        pts = [(um + rr * math.sin(th), cy + rr * math.cos(th)) for (rr, th) in
               ((rh0, ta), (rh0, tb), (rh1, tb), (rh1, ta))]
        for (w0, w1) in ((-t / 2 - 0.2, -t / 2 + 0.02), (t / 2 - 0.02, t / 2 + 0.2)):
            corners = [wall.pt(u, v, w0) for (u, v) in pts] + [wall.pt(u, v, w1) for (u, v) in pts]
            B.hexa(trim, [corners[0], corners[1], corners[5], corners[4], corners[3], corners[2], corners[6],
                          corners[7]], B.PAL['ashlar_dark'], B.STONE)
    for s, ue in ((-1, a0), (1, a1)):
        v = 0.0
        k = 0
        while v < 3.9:
            wide = 0.55 if k % 2 else 0.85
            ua, ub = (ue - wide, ue) if s < 0 else (ue, ue + wide)
            wall.box(p, ua, ub, v + 0.03, min(3.9, v + 0.62) - 0.03, -t / 2 - 0.08, t / 2 + 0.08,
                     B.scale_color(B.pick(B.PAL['ashlar'], k + 2), 0.94 + 0.08 * (k % 2)), B.STONE)
            v += 0.62
            k += 1
    # the garnet banner over the stage's curtain: a golden tankard on it
    zi = H['z0'] + t + 0.03
    x0, x1, y0, y1 = -13.8, -10.8, 6.3, 9.3
    B.abox(p, x0 - 0.3, x1 + 0.3, y1, y1 + 0.18, zi, zi + 0.12, B.PAL['beam_dark'], B.WOOD)
    B.abox(p, x0, x1, y0, y1, zi, zi + 0.06, B.PAL['garnet'], B.PLASTER)
    for (a, b, c, d) in ((x0, x1, y0, y0 + 0.2), (x0, x0 + 0.2, y0, y1), (x1 - 0.2, x1, y0, y1)):
        B.abox(p, a, b, c, d, zi + 0.02, zi + 0.08, B.PAL['gold'], B.PLASTER)
    for k in range(5):
        xt = x0 + 0.15 + (x1 - x0 - 0.3) * k / 4
        p.box((xt, y0 - 0.14, zi + 0.05), (0.14, 0.26, 0.05), B.PAL['gold'], B.PLASTER, taper=0.3)
    cx, cy2 = (x0 + x1) / 2, (y0 + y1) / 2 + 0.1
    B.abox(p, cx - 0.55, cx + 0.45, cy2 - 0.8, cy2 + 0.5, zi + 0.06, zi + 0.1, B.PAL['gold'], B.PLASTER)
    B.abox(p, cx + 0.45, cx + 0.8, cy2 - 0.45, cy2 + 0.2, zi + 0.06, zi + 0.1, B.PAL['gold'], B.PLASTER)
    B.abox(p, cx - 0.62, cx + 0.52, cy2 + 0.5, cy2 + 0.8, zi + 0.06, zi + 0.1, B.PAL['cream'], B.PLASTER)
    # the shield and spears, between the stage and the arch
    sx, sy = -7.3, 6.4
    for d in (-1, 1):
        B.beam(p, (sx - d * 1.4, sy - 1.5, zi + 0.12), (sx + d * 1.4, sy + 1.5, zi + 0.12), 0.08, 0.08,
               B.PAL['beam'], B.WOOD)
        p.box((sx + d * 1.5, sy + 1.62, zi + 0.12), (0.2, 0.4, 0.06), B.PAL['iron_hi'], B.METAL, taper=0.1)
    p.cylinder((sx, sy, zi + 0.02), (sx, sy, zi + 0.2), 0.8, B.PAL['garnet_dark'], B.WOOD, sides=14)
    p.ring((sx, sy, zi + 0.2), 0.8, 0.12, B.PAL['iron'], segments=14, axis=(0, 0, 1), mat=B.METAL, depth=0.06)
    p.cylinder((sx, sy, zi + 0.2), (sx, sy, zi + 0.34), 0.22, B.PAL['iron_hi'], B.METAL, sides=8)


def kitchen_hatch(B, p, trim, wall, u0, u1, v0, v1, t):
    """The kitchen's serving hatch: an oak frame round the opening both faces, a deep sill
    board the plates come across, a pair of garnet shutters folded back on the hall side on
    iron strap hinges, and a brass bell on a bracket beside it."""
    half = t / 2
    col = B.PAL['beam_dark']
    for s_ in (1, -1):
        w = s_ * (half + 0.04)
        wall.beam(p, u0 - 0.18, v0 - 0.2, u0 - 0.18, v1 + 0.28, w, 0.34, 0.16, col)
        wall.beam(p, u1 + 0.18, v0 - 0.2, u1 + 0.18, v1 + 0.28, w, 0.34, 0.16, col)
        wall.beam(p, u0 - 0.45, v1 + 0.2, u1 + 0.45, v1 + 0.2, w, 0.4, 0.18, col)
    # the sill: a thick scrubbed board through the wall, out over both faces
    wall.box(p, u0 - 0.3, u1 + 0.3, v0 - 0.16, v0, -half - 0.42, half + 0.3, B.PAL['honey'][2], B.WOOD)
    wall.box(p, u0 - 0.3, u1 + 0.3, v0 - 0.34, v0 - 0.16, -half - 0.16, -half, B.PAL['beam'], B.WOOD)
    # the reveals, planked
    for (a, b) in ((u0 - 0.02, u0 + 0.06), (u1 - 0.06, u1 + 0.02)):
        wall.box(p, a, b, v0, v1, -half, half, B.PAL['board'][1], B.WOOD)
    wall.box(p, u0, u1, v1 - 0.06, v1 + 0.02, -half, half, B.PAL['board'][1], B.WOOD)
    # the shutters, folded back flat against the hall's face
    width = (u1 - u0) / 2
    for side, ue in ((-1, u0), (1, u1)):
        a, b = (ue - width - 0.2, ue - 0.2) if side < 0 else (ue + 0.2, ue + width + 0.2)
        n = 3
        for k in range(n):
            wall.box(p, a + (b - a) * k / n + 0.01, a + (b - a) * (k + 1) / n - 0.01, v0 + 0.05, v1 - 0.05,
                     -half - 0.16, -half - 0.08, B.pick([B.PAL['garnet'], B.PAL['garnet_dark']], k), B.WOOD)
        for vv in (v0 + 0.3, v1 - 0.3):
            wall.box(trim, a + 0.05, b - 0.05, vv - 0.05, vv + 0.05, -half - 0.2, -half - 0.16, B.PAL['iron'],
                     B.METAL)
    # the bell on its bracket, right of the hatch
    ub = u1 + width + 0.55
    bx, by, bz = wall.pt(ub, v1 + 0.1, -half - 0.45)
    B.beam(trim, wall.pt(ub, v1 + 0.1, -half), (bx, by, bz), 0.06, 0.06, B.PAL['iron'], B.METAL)
    B.beam(trim, wall.pt(ub, v1 - 0.35, -half), wall.pt(ub, v1 + 0.08, -half - 0.3), 0.04, 0.04, B.PAL['iron'],
           B.METAL)
    trim.cylinder((bx, by - 0.42, bz), (bx, by - 0.05, bz), 0.19, B.PAL['gold'], B.METAL, sides=10, r1=0.07)
    trim.cylinder((bx, by - 0.46, bz), (bx, by - 0.42, bz), 0.21, B.PAL['copper_dark'], B.METAL, sides=10)


def stage_backdrop(B, p, trim, wall, mid, t):
    """The stage's backdrop on the back wall: a pleated garnet curtain from the deck to a
    carved pelmet, a gold hem, drawn in at its two edges by gold cords."""
    st = B.LAYOUT['stage']
    face = -t / 2
    ua, ub = mid - 14.3, mid - 10.3
    v0, v1 = st['lift'] + 0.02, 5.35
    n = 16
    for k in range(n):
        a = ua + (ub - ua) * k / n
        b = ua + (ub - ua) * (k + 1) / n
        deep = 0.22 if k % 2 else 0.1
        col = B.PAL['garnet'] if k % 2 else B.PAL['garnet_dark']
        # the pleats bow out a little more toward the curtain's middle
        bow = 0.06 * math.sin(math.pi * (k + 0.5) / n)
        wall.box(p, a, b, v0 + 0.2, v1, face - deep - bow, face, col, B.PLASTER)
        wall.box(p, a, b, v0, v0 + 0.2, face - deep - bow - 0.02, face, B.PAL['gold'], B.PLASTER)
    # the gathers at the edges, cords round them
    for u in (ua + 0.25, ub - 0.25):
        x, y, z = wall.pt(u, 2.4, face - 0.32)
        p.cylinder((x, y - 1.2, z), (x, y + 1.6, z), 0.26, B.PAL['garnet_dark'], B.PLASTER, sides=8, r1=0.2)
        trim.ring((x, y + 0.2, z), 0.28, 0.05, B.PAL['gold'], segments=8, axis=(0, 1, 0), mat=B.METAL)
    # the pelmet: a carved oak board with a gold bead, over the curtain's head
    wall.box(p, ua - 0.25, ub + 0.25, v1, v1 + 0.62, face - 0.42, face, B.PAL['beam_dark'], B.WOOD)
    wall.box(trim, ua - 0.25, ub + 0.25, v1 + 0.08, v1 + 0.16, face - 0.46, face - 0.42, B.PAL['gold'], B.METAL)
    for k in range(7):
        u = ua + (ub - ua) * k / 6
        wall.box(p, u - 0.12, u + 0.12, v1 - 0.18, v1, face - 0.4, face - 0.1, B.PAL['beam_dark'], B.WOOD)


# ---------------------------------------------------------------------------
# The long side walls
# ---------------------------------------------------------------------------
def elk_skull(B, p, x, y, z, s):
    """A mounted antlered skull on a shield-shaped board (s: +1 facing +x, -1 facing -x)."""
    p.box((x + s * 0.06, y, z), (0.12, 1.4, 1.0), B.PAL['beam_dark'], B.WOOD)
    p.box((x + s * 0.4, y + 0.1, z), (0.6, 0.55, 0.5), B.PAL['bone'], B.PLASTER, taper=0.8)
    p.box((x + s * 0.8, y - 0.1, z), (0.5, 0.3, 0.3), B.PAL['bone'], B.PLASTER, taper=0.7)
    for d in (-1, 1):
        pts = [(x + s * 0.4, y + 0.3, z + d * 0.2), (x + s * 0.5, y + 0.8, z + d * 0.6), (x + s * 0.45, y + 1.3, z + d * 1.1),
               (x + s * 0.4, y + 1.7, z + d * 1.3)]
        p.sweep(pts, 0.08, 0.04, B.PAL['cream'], sides=5, mat=B.PLASTER)
        for (a, b) in (((x + s * 0.5, y + 0.8, z + d * 0.6), (x + s * 0.55, y + 1.3, z + d * 0.45)),
                       ((x + s * 0.45, y + 1.3, z + d * 1.1), (x + s * 0.45, y + 1.75, z + d * 0.85))):
            p.sweep([a, b], 0.05, 0.02, B.PAL['cream'], sides=4, mat=B.PLASTER)


def troll_club(B, p, x, y, z, s):
    """A fen troll's club and a round shield crossed on the wall (s: facing +x or -x)."""
    p.cylinder((x + s * 0.15, y, z), (x + s * 0.3, y, z), 0.75, B.PAL['beam'], B.WOOD, sides=12)
    p.ring((x + s * 0.3, y, z), 0.75, 0.1, B.PAL['iron'], segments=12, axis=(1, 0, 0), mat=B.METAL, depth=0.05)
    pts = [(x + s * 0.4, y - 1.3, z - 1.0), (x + s * 0.45, y, z), (x + s * 0.45, y + 1.4, z + 1.1)]
    p.sweep(pts, 0.14, 0.34, B.PAL['honey'][1], sides=6, mat=B.WOOD)
    for k in range(4):
        q = (x + s * 0.6, y + 0.9 + k * 0.15, z + 0.7 + k * 0.13)
        p.box(q, (0.16, 0.16, 0.16), B.PAL['iron_hi'], B.METAL, taper=0.2)


def side_wall(B, p, x, s, windows, clerestories, seed):
    H, t = B.HALL, B.HALL['wall']
    wall = B.Wall(x, H['z0'], x, H['z1'], (s, 0))
    top_v = H['eave'] - 0.1

    def top(u):
        return top_v

    openings = [(u - 0.8, u + 0.8, 2.8, 5.0) for u in windows] + [(u - 0.6, u + 0.6, 6.8, 8.6) for u in clerestories]
    B.timber_wall(p, wall, t, top, openings, base_h=1.4, bays=3.6, seed=seed)
    for (a, b, v0, v1) in openings:
        B.window(p, wall, a, b, v0, v1, t, shutters=v0 < 5)
    wall_plate(B, p, wall, top_v, t)
    return wall


def hall_left(B, p):
    H = B.HALL
    x = H['x0'] + H['wall'] / 2
    side_wall(B, p, x, -1, [4.5, 15.0, 23.0], [9.0, 19.0], 3)
    xi = H['x0'] + H['wall'] + 0.02
    elk_skull(B, p, xi, 3.8, 5.3, 1)
    troll_club(B, p, xi, 3.8, -4.5, 1)
    # the notice board by the door
    wall = B.Wall(H['x0'] + H['wall'] / 2, H['z0'], H['x0'] + H['wall'] / 2, H['z1'], (-1, 0))
    notice_board(B, p, wall, 24.2, 26.8, 1.8, 3.9, H['wall'])


def river_stones(B, p, face, u0, u1, v0, v1, seed):
    """River stones set in a chimney face: rounded, mixed, in loose courses."""
    v = v0
    k = 0
    while v < v1 - 0.1:
        hgt = 0.62 + ((k * 7 + seed) % 4) * 0.06
        u = u0 + (0.3 if k % 2 else 0.0)
        j = 0
        while u < u1 - 0.1:
            wdt = 0.8 + ((j * 5 + k * 3 + seed) % 5) * 0.12
            ub = min(u1, u + wdt)
            face.box(p, u + 0.03, ub - 0.03, v + 0.03, min(v1, v + hgt) - 0.03, -0.02, 0.1 + ((j + k) % 3) * 0.03,
                     B.pick(B.PAL['river'], j * 3 + k + seed), B.STONE)
            u = ub
            j += 1
        v += hgt
        k += 1


def hall_right(B, p):
    H = B.HALL
    t = H['wall']
    x = H['x1'] - t / 2
    side_wall(B, p, x, 1, [5.5, 12.2, 23.0], [9.0, 20.0], 4)
    fire = next(q for q in B.LAYOUT['props'] if q['kind'] == 'fireplace')
    fx0 = fire['x'] - fire['hw']
    fz0, fz1 = fire['z'] - fire['hd'], fire['z'] + fire['hd']
    xin = H['x1'] - t
    # the fireplace inside: stone cheeks, a lintel, the mantel, the breast up to the plate
    stone, dark = B.PAL['stone'], B.PAL['stone_dark']
    B.abox(p, fx0, xin + 0.05, 0.0, 2.0, fz0, fz0 + 0.95, B.pick(stone, 1), B.STONE)
    B.abox(p, fx0, xin + 0.05, 0.0, 2.0, fz1 - 0.95, fz1, B.pick(stone, 2), B.STONE)
    B.abox(p, fx0 - 0.05, xin + 0.05, 1.8, 2.3, fz0, fz1, dark, B.STONE)
    B.abox(p, fx0 - 0.35, xin + 0.05, 2.3, 2.52, fz0 - 0.2, fz1 + 0.2, B.PAL['beam_dark'], B.WOOD)
    B.abox(p, fx0 + 0.25, xin + 0.05, 2.52, H['eave'] - 0.1, fz0 + 0.4, fz1 - 0.4, B.pick(stone, 3), B.STONE)
    y = 3.1
    k = 0
    while y < H['eave'] - 0.6:
        B.abox(p, fx0 + 0.22, fx0 + 0.3, y, y + 0.06, fz0 + 0.4, fz1 - 0.4, dark, B.STONE)
        y += 0.62
        k += 1
    # the firebox: soot-dark, logs on andirons, the fire, the hearthstone before it
    B.abox(p, fx0 + 0.05, xin, 0.0, 1.8, fz0 + 0.95, fz1 - 0.95, B.PAL['soot'], B.STONE)
    B.abox(p, fx0 - 0.9, fx0, -0.02, 0.06, fz0 + 0.3, fz1 - 0.3, dark, B.STONE)
    for dz in (-0.25, 0.25):
        p.cylinder((fx0 + 0.25, 0.3, fire['z'] + dz - 0.6), (fx0 + 0.45, 0.3, fire['z'] + dz + 0.6), 0.14,
                   B.PAL['beam_dark'], B.WOOD, sides=6)
    # the embers (the live flame over them is the game's campfire flame)
    p.box((fx0 + 0.45, 0.28, fire['z']), (0.5, 0.1, 1.3), B.PAL['ember'], B.GLOW)
    # the great jawbone over the mantel: a long skull, its teeth
    jx, jy, jz = fx0 - 0.05, 3.5, fire['z']
    p.box((jx + 0.1, jy, jz), (0.12, 1.2, 2.6), B.PAL['beam_dark'], B.WOOD)
    p.box((jx - 0.2, jy + 0.15, jz), (0.5, 0.5, 2.2), B.PAL['bone'], B.PLASTER, taper=0.85)
    p.box((jx - 0.25, jy - 0.35, jz), (0.4, 0.22, 2.0), B.PAL['bone'], B.PLASTER)
    for k in range(9):
        zt = jz - 0.9 + k * 0.225
        p.box((jx - 0.35, jy - 0.1, zt), (0.1, 0.24, 0.1), B.PAL['cream'], B.PLASTER, taper=0.2)
    # the river-stone chimney outside: a broad base, stepped shoulders, the stack through the
    # eaves, a capping slab and two pots
    xo = H['x1']
    base_top, shoulder, stack_top = 7.0, 8.2, H['eave'] + 4.4
    g = min(B.ground(xo + 1, fz0), B.ground(xo + 1, fz1)) - 0.4
    B.abox(p, xo, xo + 1.9, g, base_top, fz0 + 0.2, fz1 - 0.2, B.PAL['stone_dark'], B.STONE)
    B.hexa(p, [(xo, base_top, fz0 + 0.2), (xo + 1.9, base_top, fz0 + 0.2), (xo + 1.9, base_top, fz1 - 0.2),
               (xo, base_top, fz1 - 0.2), (xo, shoulder, fz0 + 0.8), (xo + 1.4, shoulder, fz0 + 0.8),
               (xo + 1.4, shoulder, fz1 - 0.8), (xo, shoulder, fz1 - 0.8)], B.pick(B.PAL['river'], 2), B.STONE)
    B.abox(p, xo, xo + 1.4, shoulder, stack_top, fz0 + 0.8, fz1 - 0.8, B.PAL['stone_dark'], B.STONE)
    faces = [
        (B.Wall(xo + 1.9, fz0 + 0.2, xo + 1.9, fz1 - 0.2, (1, 0)), g + 0.3, base_top),
        (B.Wall(xo, fz0 + 0.2, xo + 1.9, fz0 + 0.2, (0, -1)), g + 0.3, base_top),
        (B.Wall(xo, fz1 - 0.2, xo + 1.9, fz1 - 0.2, (0, 1)), g + 0.3, base_top),
        (B.Wall(xo + 1.4, fz0 + 0.8, xo + 1.4, fz1 - 0.8, (1, 0)), shoulder, stack_top - 0.3),
        (B.Wall(xo, fz0 + 0.8, xo + 1.4, fz0 + 0.8, (0, -1)), shoulder, stack_top - 0.3),
        (B.Wall(xo, fz1 - 0.8, xo + 1.4, fz1 - 0.8, (0, 1)), shoulder, stack_top - 0.3),
    ]
    for i, (face, v0, v1) in enumerate(faces):
        river_stones(B, p, face, 0.0, face.length, max(v0, g + 0.2), v1, i * 3)
    B.abox(p, xo - 0.15, xo + 1.6, stack_top - 0.2, stack_top + 0.1, fz0 + 0.6, fz1 - 0.6, B.PAL['stone_dark'],
           B.STONE)
    for dz in (-0.45, 0.45):
        p.cylinder((xo + 0.7, stack_top + 0.1, fire['z'] + dz), (xo + 0.7, stack_top + 0.8, fire['z'] + dz), 0.24,
                   B.PAL['copper_dark'], B.STONE, sides=8, r1=0.2)


# ---------------------------------------------------------------------------
# The hall roof
# ---------------------------------------------------------------------------
def hall_roof(B, p, clutter):
    H = B.HALL
    k = pitch(B)
    over = H['eaveOut']
    xe = H['x1'] + over
    zb, zf = H['z0'] - 0.2, H['z1'] + H['vergeOut']
    ye = hall_y(B, xe)
    lu = math.hypot(xe, H['ridge'] - ye)
    for s in (1, -1):
        up = (-s * xe / lu, (H['ridge'] - ye) / lu, 0.0)
        # irregular mossy shingles, a course of battens over the sarking (the roof reads thick
        # at its edges), flaring out a little at the eaves; the north slope, in the shade,
        # carries more moss
        RF.shingle_plane(B, p, (s * xe, ye + 0.17, zb), (0, 0, 1), up, zf - zb + 0.1, lu, seed=11 + s,
                         step=0.66, size=1.1, moss=0.75 if s > 0 else 0.5, bell=1.8)
        RF.moss_clumps(B, clutter, (s * xe, ye + 0.17, zb), (0, 0, 1), up, zf - zb, lu, seed=13 + s, count=34)
        # the sarking under the slates (the room's ceiling between the rafters)
        B.hexa(p, [(s * xe, ye - 0.16, zb), (0, H['ridge'] - 0.16, zb), (0, H['ridge'] - 0.16, zf),
                   (s * xe, ye - 0.16, zf), (s * xe, ye + 0.03, zb), (0, H['ridge'] + 0.03, zb),
                   (0, H['ridge'] + 0.03, zf), (s * xe, ye + 0.03, zf)], B.PAL['sarking'], B.WOOD)
        # rafters, purlins, the soffit over the eave overhang and the fascia
        z = H['z0'] + H['wall'] + 0.5
        while z < H['z1'] - H['wall']:
            B.beam(p, (s * (H['x1'] - H['wall'] - 0.2), hall_y(B, H['x1'] - 1.0) - 0.3, z),
                   (s * 0.3, H['ridge'] - 0.45, z), 0.22, 0.3, B.PAL['beam'])
            z += 1.9
        for xp in (5.5, 11.5):
            B.abox(p, s * xp - 0.25, s * xp + 0.25, hall_y(B, xp) - 0.75, hall_y(B, xp) - 0.2, zb + 0.2, zf - 0.8,
                   B.PAL['beam_dark'], B.WOOD)
        xa, xb = sorted((s * H['x1'], s * xe))
        B.abox(p, xa, xb, ye - 0.3, ye - 0.16, zb, zf, B.PAL['beam'], B.WOOD)
        # a deep fascia board along the eave, the roof's thickness showing over it
        B.abox(p, s * xe - 0.1, s * xe + 0.1, ye - 0.62, ye + 0.3, zb, zf, B.PAL['beam_dark'], B.WOOD)
        # the rafters' feet under the deep eave, their ends showing
        z = zb + 0.6
        while z < zf - 0.3:
            B.abox(p, min(s * H['x1'], s * (xe - 0.1)), max(s * H['x1'], s * (xe - 0.1)), ye - 0.3 + (0.0 if s > 0 else 0.0),
                   ye - 0.16, z - 0.09, z + 0.09, B.PAL['beam_dark'], B.WOOD)
            z += 1.9
        # the bargeboards at both gables: deep, the thick edge of the roof over the verge
        for zz in (zf + 0.1, zb - 0.1):
            B.beam(p, (s * (xe + 0.1), ye - 0.3, zz), (0.0, H['ridge'] + 0.2, zz), 0.2, 0.9, B.PAL['beam_dark'])
    # the ridge beam under the ridge, the ridge cap over it, the finials at the gables
    B.abox(p, -0.3, 0.3, H['ridge'] - 1.1, H['ridge'] - 0.4, zb + 0.2, zf - 0.8, B.PAL['beam_dark'], B.WOOD)
    B.beam(p, (0, H['ridge'] + 0.2, zb), (0, H['ridge'] + 0.2, zf), 0.62, 0.3, B.PAL['slate_ridge'], B.STONE)
    RF.ridge_cappers(B, p, (0, H['ridge'] + 0.36, zb - 0.1), (0, H['ridge'] + 0.36, zf + 0.1), seed=3)
    for zz in (zf + 0.1, zb - 0.1):
        B.post(p, 0, zz, H['ridge'] - 0.8, H['ridge'] + 1.1, 0.28, B.PAL['beam_dark'])
        p.box((0, H['ridge'] + 1.25, zz), (0.32, 0.32, 0.32), B.PAL['beam'], B.WOOD, taper=0.3)
    for zt in H['trusses']:
        hammerbeam_truss(B, p, zt)
    # the dormers: two on the south slope, two on the north clear of the chimney
    for side, zc in ((-1, -6.5), (-1, 6.5), (1, -7.0), (1, 8.0)):
        RF.dormer(B, p, side, zc, 10.4)


# the hammerbeam trusses' collar line and the depth of a principal rafter under the slates
TRUSS_COLLAR = 15.3
PRINCIPAL = 0.42


def hammerbeam_truss(B, p, zt):
    """One hammerbeam truss across the hall at z = zt, every timber of it at or over the
    hammer beams (HALL['truss']): a wall post flush on each side wall on a stone corbel, a
    short curved brace under each hammer beam close to the wall, the hammer beam with a garnet
    shield on its end, a hammer post up to the principal rafter, an arched brace springing
    from it to the collar, the collar and a king post to the ridge beam."""
    H = B.HALL
    k = pitch(B)
    xw = H['x1'] - H['wall']
    tr = H['truss']
    col, dark = B.PAL['beam'], B.PAL['beam_dark']

    def under(x):
        # the principal rafter's middle under the slates at |x|
        return H['ridge'] - abs(x) * k - 0.16 - PRINCIPAL / 2

    for s in (1, -1):
        # the stone corbel and the wall post flush on the wall
        B.abox(p, *sorted((s * (xw - 0.22), s * (xw + 0.05))), 5.9, 6.35, zt - 0.3, zt + 0.3,
               B.PAL['ashlar_dark'], B.STONE)
        B.abox(p, *sorted((s * (xw - 0.18), s * (xw + 0.05))), 6.35, tr, zt - 0.2, zt + 0.2, col, B.WOOD)
        # the brace under the hammer beam, close to the wall
        pts = [(s * (xw - 0.12), 9.3, zt), (s * (xw - 0.5), 9.78, zt), (s * (xw - 1.05), 10.08, zt),
               (s * (xw - 1.7), tr + 0.08, zt)]
        p.beam(pts, 0.26, 0.24, dark, B.WOOD)
        # the hammer beam, its moulded end and the garnet shield on it
        he = xw - 2.35
        B.abox(p, *sorted((s * (xw + 0.15), s * he)), tr, tr + 0.52, zt - 0.2, zt + 0.2, dark, B.WOOD)
        B.abox(p, *sorted((s * he, s * (he + 0.16))), tr - 0.12, tr + 0.64, zt - 0.25, zt + 0.25, col, B.WOOD)
        p.box((s * (he - 0.04), tr + 0.26, zt), (0.08, 0.5, 0.4), B.PAL['garnet'], B.PLASTER, taper=0.6)
        p.box((s * (he - 0.09), tr + 0.34, zt), (0.04, 0.14, 0.14), B.PAL['gold'], B.METAL)
        # the hammer post up to the principal
        xp = xw - 2.05
        B.post(p, s * xp, zt, tr + 0.52, under(xp) - 0.1, 0.3, col)
        # the principal rafter from the wall top to the ridge beam
        B.beam(p, (s * (xw + 0.2), under(xw + 0.2), zt), (s * 0.3, under(0.3), zt), 0.3, PRINCIPAL, dark)
        # the curved brace: from the hammer post's head up under the principal to the collar's
        # end, sagging a little into an arch
        xc = (H['ridge'] - 0.16 - PRINCIPAL - TRUSS_COLLAR) / k
        ya, yb = under(xp) - 0.35, TRUSS_COLLAR - 0.1
        arc = []
        for j in range(5):
            f = j / 4
            arc.append((s * (xp - (xp - xc) * f), ya + (yb - ya) * f - 0.55 * math.sin(math.pi * f), zt))
        p.beam(arc, 0.24, 0.3, col, B.WOOD)
    # the collar between the principals, and the king post from it to the ridge beam
    xc = (H['ridge'] - 0.16 - PRINCIPAL - TRUSS_COLLAR) / k
    B.abox(p, -xc, xc, TRUSS_COLLAR - 0.22, TRUSS_COLLAR + 0.22, zt - 0.17, zt + 0.17, dark, B.WOOD)
    B.post(p, 0, zt, TRUSS_COLLAR + 0.22, H['ridge'] - 1.1, 0.3, col)


# ---------------------------------------------------------------------------
# The wing: a stone lower storey, a timber upper storey, a slate roof
# ---------------------------------------------------------------------------
def wing_walls(B, parts):
    W, G = B.WING, B.G
    t = W['wall']
    top_v = W['eave'] - 0.1

    def flat(u):
        return top_v

    # the east side, flush with the hall's north side
    p = parts['WingWallEast']
    wall = B.Wall(W['x1'] - t / 2, W['z0'], W['x1'] - t / 2, W['z1'], (1, 0))
    openings = [(6.3, 7.7, 2.2, 3.6), (3.3, 4.7, 7.0, 8.6), (10.1, 11.5, 7.0, 8.6)]
    B.timber_wall(p, wall, t, flat, openings, base_h=1.4, stone_to=G, bays=3.6, seed=5)
    for (a, b, v0, v1) in openings:
        B.window(p, wall, a, b, v0, v1, t, shutters=v0 > 5)
    wall.box(p, 0, wall.length, G - 0.1, G + 0.3, -t / 2 - 0.12, t / 2 + 0.12, B.PAL['beam_dark'], B.WOOD)
    wall_plate(B, p, wall, top_v, t)
    # the back gable
    p = parts['WingWallBack']
    wall = B.Wall(W['x0'], W['z0'] + t / 2, W['x1'], W['z0'] + t / 2, (0, -1))

    def gable(u):
        return wing_y(B, W['x0'] + u) - 0.1

    openings = [(2.6, 4.0, 7.0, 8.6), (8.0, 9.4, 7.0, 8.6)]
    B.timber_wall(p, wall, t, gable, openings, base_h=1.4, stone_to=G, bays=3.6, seed=6)
    for (a, b, v0, v1) in openings:
        B.window(p, wall, a, b, v0, v1, t)
    wall.box(p, 0, wall.length, G - 0.1, G + 0.3, -t / 2 - 0.12, t / 2 + 0.12, B.PAL['beam_dark'], B.WOOD)
    oculus(B, p, wall, 6.0, W['eave'] + (W['ridge'] - W['eave']) * 0.45, 0.6, t)
    # the kitchen's back door, shut, under a little hood
    for k in range(4):
        wall.box(p, 5.2 + k * 0.4, 5.58 + k * 0.4, 0.0, 3.4, t / 2, t / 2 + 0.12, B.pick(B.PAL['honey'], k), B.WOOD)
    for vv in (0.7, 2.6):
        wall.box(p, 5.25, 6.75, vv, vv + 0.14, t / 2 + 0.12, t / 2 + 0.18, B.PAL['iron'], B.METAL)
    wall.box(p, 4.9, 7.1, 3.4, 3.8, t / 2, t / 2 + 0.3, B.PAL['beam_dark'], B.WOOD)
    wall.box(p, 4.8, 7.2, 3.8, 3.95, t / 2, t / 2 + 0.9, B.PAL['slate'][0], B.STONE)
    # the west side, from the back corner to the tower
    p = parts['WingWallWest']
    z_end = -21.9
    wall = B.Wall(W['x0'] + t / 2, W['z0'], W['x0'] + t / 2, z_end, (-1, 0))
    openings = [(2.8, 4.2, 7.0, 8.6)]
    B.timber_wall(p, wall, t, flat, openings, base_h=1.4, stone_to=G, bays=3.6, seed=7)
    for (a, b, v0, v1) in openings:
        B.window(p, wall, a, b, v0, v1, t)
    wall.box(p, 0, wall.length, G - 0.1, G + 0.3, -t / 2 - 0.12, t / 2 + 0.12, B.PAL['beam_dark'], B.WOOD)
    wall_plate(B, p, wall, top_v, t)


def wing_roof(B, p):
    W, T = B.WING, B.TOWER
    k = wing_pitch(B)
    xm = (W['x0'] + W['x1']) / 2
    half = (W['x1'] - W['x0']) / 2 + W['eaveOut']
    ye = W['ridge'] - half * k
    zb, zf = W['z0'] - W['vergeOut'], W['z1']
    lu = math.hypot(half, W['ridge'] - ye)
    tower_cut = T['z'] - T['rOut'] - 0.3   # south of this, the west slope stops at the tower
    for s in (1, -1):
        up = (-s * half / lu, (W['ridge'] - ye) / lu, 0.0)
        runs = [(zb, zf)] if s > 0 else [(zb, tower_cut)]
        for (za, zc) in runs:
            RF.shingle_plane(B, p, (xm + s * half, ye + 0.17, za), (0, 0, 1), up, zc - za, lu, seed=21 + s,
                             moss=0.6 if s > 0 else 0.4, bell=1.2)
            B.hexa(p, [(xm + s * half, ye - 0.16, za), (xm, W['ridge'] - 0.16, za), (xm, W['ridge'] - 0.16, zc),
                       (xm + s * half, ye - 0.16, zc), (xm + s * half, ye + 0.03, za), (xm, W['ridge'] + 0.03, za),
                       (xm, W['ridge'] + 0.03, zc), (xm + s * half, ye + 0.03, zc)], B.PAL['sarking'], B.WOOD)
        if s < 0:
            # beside the tower the west slope starts at the tower's east face
            xs = T['x'] + T['rOut'] + 0.3
            hl = xm - xs
            ys = W['ridge'] - hl * k
            lu2 = math.hypot(hl, W['ridge'] - ys)
            up2 = (hl / lu2, (W['ridge'] - ys) / lu2, 0.0)
            RF.shingle_plane(B, p, (xs, ys + 0.17, tower_cut), (0, 0, 1), up2, zf - tower_cut, lu2, seed=25,
                             moss=0.4)
            B.hexa(p, [(xs, ys - 0.16, tower_cut), (xm, W['ridge'] - 0.16, tower_cut), (xm, W['ridge'] - 0.16, zf),
                       (xs, ys - 0.16, zf), (xs, ys + 0.03, tower_cut), (xm, W['ridge'] + 0.03, tower_cut),
                       (xm, W['ridge'] + 0.03, zf), (xs, ys + 0.03, zf)], B.PAL['sarking'], B.WOOD)
        z = W['z0'] + W['wall'] + 0.6
        while z < zf - 0.3:
            B.beam(p, (xm + s * (half - W['eaveOut'] - 0.9), W['eave'] - 0.2, z), (xm + s * 0.3, W['ridge'] - 0.45, z),
                   0.2, 0.28, B.PAL['beam'])
            z += 2.0
        B.beam(p, (xm + s * (half + 0.1), ye - 0.2, zb - 0.1), (xm, W['ridge'] + 0.1, zb - 0.1), 0.16, 0.55,
               B.PAL['beam_dark'])
    B.abox(p, xm - 0.25, xm + 0.25, W['ridge'] - 0.95, W['ridge'] - 0.35, zb + 0.2, zf, B.PAL['beam_dark'], B.WOOD)
    B.beam(p, (xm, W['ridge'] + 0.15, zb), (xm, W['ridge'] + 0.15, zf), 0.55, 0.28, B.PAL['slate_ridge'], B.STONE)


# ---------------------------------------------------------------------------
# The round tower
# ---------------------------------------------------------------------------
def ring_seg(B, p, cx, cz, r0, r1, a0, a1, y0, y1, color, mat):
    pa = (cx + math.sin(a0) * r0, cz + math.cos(a0) * r0)
    pb = (cx + math.sin(a0) * r1, cz + math.cos(a0) * r1)
    pc = (cx + math.sin(a1) * r1, cz + math.cos(a1) * r1)
    pd = (cx + math.sin(a1) * r0, cz + math.cos(a1) * r0)
    B.hexa(p, [(pa[0], y0, pa[1]), (pb[0], y0, pb[1]), (pc[0], y0, pc[1]), (pd[0], y0, pd[1]),
               (pa[0], y1, pa[1]), (pb[0], y1, pb[1]), (pc[0], y1, pc[1]), (pd[0], y1, pd[1])], color, mat)


def _hash(*k):
    """A stable value in [0, 1) from integers (the masonry's per-block variation)."""
    v = math.sin(sum((i + 1) * 12.9898 * (j + 0.37) for i, j in enumerate(k)) + 7.13) * 43758.5453
    return v - math.floor(v)


def ring_face(p, cx, cz, r, a0, a1, y0, y1, color, mat, inward, tag=0):
    """One flat quad on a ring (the chord from a0 to a1 at radius r), facing the centre when
    `inward`, away from it otherwise."""
    from shiplib import G as game

    pa = (cx + math.sin(a0) * r, cz + math.cos(a0) * r)
    pb = (cx + math.sin(a1) * r, cz + math.cos(a1) * r)
    f = p.face([(pa[0], y0, pa[1]), (pb[0], y0, pb[1]), (pb[0], y1, pb[1]), (pa[0], y1, pa[1])], color,
               mat, tag)
    f.normal_update()
    n = game(f.normal)
    mx, mz = (pa[0] + pb[0]) / 2 - cx, (pa[1] + pb[1]) / 2 - cz
    if (n.x * mx + n.z * mz > 0) == inward:
        f.normal_flip()
    return f


def masonry(B, p, cx, cz, r, a_lo, a_hi, y_lo, y_hi, holes, palette, inward, seed, course=0.62,
            block=1.15):
    """Coursed ashlar on one face of the round wall: staggered blocks of varied length and tone,
    each a quad standing a hand proud of the mortar core behind it, so the joints read dark
    between them. `holes` are (a0, a1, y0, y1) runs the courses break round (the openings and
    the slit windows' frames)."""
    gap = 0.05
    n = max(1, round((y_hi - y_lo) / course))
    ch = (y_hi - y_lo) / n
    for c in range(n):
        y0, y1 = y_lo + c * ch, y_lo + (c + 1) * ch
        # this course's free runs between the holes that cross it
        cuts = sorted((h0, h1) for (h0, h1, v0, v1) in holes if v0 < y1 - 1e-6 and v1 > y0 + 1e-6)
        runs, a = [], a_lo
        for (h0, h1) in cuts:
            if h0 > a:
                runs.append((a, min(h0, a_hi)))
            a = max(a, h1)
        if a < a_hi:
            runs.append((a, a_hi))
        for (r0, r1) in runs:
            k = 0
            a = r0
            # every other course starts on a half block, so the joints stagger
            first = 0.5 if (c + seed) % 2 else 1.0
            while r1 - a > 1e-6:
                w = block * (0.7 + 0.6 * _hash(seed, c, k)) * (first if k == 0 else 1.0) / r
                b = a + w
                if r1 - b < 0.45 / r:
                    b = r1
                h = _hash(seed + 11, c, k)
                color = B.scale_color(B.pick(palette, int(h * 97)), 0.9 + 0.18 * _hash(seed + 3, k, c))
                ring_face(p, cx, cz, r, a + gap / 2 / r, b - gap / 2 / r, y0 + gap / 2, y1 - gap / 2,
                          color, B.STONE, inward)
                a = b
                k += 1


def slit_window(B, p, cx, cz, r, am, yb, inward):
    """An arrow slit on one face of the round wall: a dressed frame of pale stone standing
    proud (two jambs, a sill, a lintel), round a narrow pane: a cool glow of daylight inside
    the tower, the amber of a lit room outside."""
    sgn = -1 if inward else 1
    hw, h = 0.16, 1.5
    da = hw / r
    jamb = 0.26 / r
    hi = B.PAL['ashlar_hi']
    # the pane, a hand behind the frame's face: inside, the cool daylight of the sky beyond
    # (kept out of the warm bake), outside the amber of the lit stair
    if inward:
        f = ring_face(p, cx, cz, r - 0.005, am - da, am + da, yb, yb + h, B.PAL['slit_in'], B.STONE, True,
                      tag=B.FLAT)
        B.SKY_FACES.add(f)
    else:
        ring_face(p, cx, cz, r + 0.005, am - da, am + da, yb, yb + h, B.PAL['glass'], B.STONE, False,
                  tag=B.FLAT)
    out = r + sgn * 0.13
    for (a0, a1, y0, y1) in ((am - da - jamb, am - da, yb - 0.02, yb + h + 0.02),
                             (am + da, am + da + jamb, yb - 0.02, yb + h + 0.02),
                             (am - da - jamb - 0.04 / r, am + da + jamb + 0.04 / r, yb - 0.28, yb),
                             (am - da - jamb - 0.02 / r, am + da + jamb + 0.02 / r, yb + h, yb + h + 0.34)):
        rr0, rr1 = sorted((out, r - sgn * 0.02))
        ring_seg(B, p, cx, cz, rr0, rr1, a0, a1, y0, y1,
                 B.scale_color(hi, 0.94 + 0.1 * _hash(int(am * 100), int(y0 * 10))), B.STONE)


def tower_wall(B, p, trim):
    """The round tower's wall: a mortar core faced both sides in coursed ashlar (warm limestone
    inside, the base's blue-grey outside), a plastered, post-framed top band under the cone,
    arrow slits in dressed frames at two heights round the nook, dressed quoins where the ring
    meets the hall's back wall."""
    T = B.TOWER
    cx, cz, ri, ro, top = T['x'], T['z'], T['rIn'], T['rOut'], T['wallTop']
    stone_to = 8.4
    a_start, a_end = math.radians(48), math.radians(312)
    # the slits: a low row over the nook's bench, a high row between them
    slits = [(math.radians(a), 2.9) for a in (98, 152, 208, 262)]
    slits += [(math.radians(a), 6.5) for a in (125, 180, 235)]
    # the core: mortar, full thickness
    n = 36
    for i in range(n):
        a0 = a_start + (a_end - a_start) * i / n
        a1 = a_start + (a_end - a_start) * (i + 1) / n
        ring_seg(B, p, cx, cz, ri + 0.035, ro - 0.06, a0, a1, 0.0, stone_to, B.PAL['mortar'], B.STONE)
        # the plastered top band with its posts, its sill beam and wall plate
        ring_seg(B, p, cx, cz, ri + 0.04, ro - 0.04, a0, a1, stone_to, top - 0.3, B.pick(B.PAL['plaster'], i),
                 B.PLASTER)
        ring_seg(B, p, cx, cz, ri - 0.05, ro + 0.05, a0, a1, top - 0.3, top, B.PAL['beam_dark'], B.WOOD)
        ring_seg(B, p, cx, cz, ri - 0.06, ro + 0.03, a0, a1, stone_to - 0.1, stone_to + 0.2, B.PAL['beam'],
                 B.WOOD)
        if i % 2 == 0:
            for rr in (ro + 0.02, ri - 0.02):
                x, z = cx + math.sin(a0) * rr, cz + math.cos(a0) * rr
                B.post(p, x, z, stone_to + 0.2, top - 0.3, 0.28, B.PAL['beam'])
    # the ashlar both sides, broken round the slits' frames
    for (r, palette, inward, seed, block) in ((ri, B.PAL['ashlar'], True, 3, 1.15),
                                               (ro, B.PAL['stone'], False, 5, 1.3)):
        frames = [(am - 0.46 / r, am + 0.46 / r, yb - 0.32, yb + 1.9) for (am, yb) in slits]
        masonry(B, p, cx, cz, r, a_start, a_end, 0.0, stone_to - 0.1, frames, palette, inward, seed, block=block)
    for (am, yb) in slits:
        slit_window(B, p, cx, cz, ri, am, yb, True)
        slit_window(B, p, cx, cz, ro, am, yb, False)
    # a tapestry on the nook's back wall over its bench, between the low slits: garnet, a
    # gold border and a golden tankard, hung from an iron rod on two brackets
    am, half = math.pi, math.radians(10)
    r = ri - 0.06
    y0, y1 = 1.9, 5.3
    n = 6
    for k in range(n):
        a0 = am - half + 2 * half * k / n
        a1 = am - half + 2 * half * (k + 1) / n
        ring_seg(B, p, cx, cz, r - 0.05, r, a0, a1, y0, y1, B.PAL['garnet'] if k % 2 else B.PAL['garnet_dark'],
                 B.PLASTER)
        ring_seg(B, p, cx, cz, r - 0.07, r - 0.04, a0, a1, y0, y0 + 0.16, B.PAL['gold'], B.PLASTER)
    for a0 in (am - half, am + half - 0.012):
        ring_seg(B, p, cx, cz, r - 0.07, r - 0.04, a0, a0 + 0.012, y0, y1, B.PAL['gold'], B.PLASTER)
    for k in range(5):
        a0 = am - half + 2 * half * (k + 0.5) / 5
        x, z = cx + math.sin(a0) * (r - 0.05), cz + math.cos(a0) * (r - 0.05)
        p.box((x, y0 - 0.12, z), (0.12, 0.24, 0.06), B.PAL['gold'], B.PLASTER, yaw=a0, taper=0.3)
    ring_seg(B, p, cx, cz, r - 0.09, r - 0.05, am - 0.05, am + 0.05, 3.1, 4.0, B.PAL['gold'], B.PLASTER)
    ring_seg(B, p, cx, cz, r - 0.09, r - 0.05, am + 0.05, am + 0.08, 3.25, 3.75, B.PAL['gold'], B.PLASTER)
    ring_seg(B, p, cx, cz, r - 0.09, r - 0.05, am - 0.06, am + 0.06, 4.0, 4.14, B.PAL['cream'], B.PLASTER)
    rod = [(cx + math.sin(am + d) * (r - 0.18), y1 + 0.12, cz + math.cos(am + d) * (r - 0.18)) for d in
           (-half - 0.03, half + 0.03)]
    B.beam(trim, rod[0], rod[1], 0.05, 0.05, B.PAL['iron'], B.METAL)
    for q in rod:
        B.beam(trim, q, (cx + (q[0] - cx) * ri / (ri - 0.18), q[1], cz + (q[2] - cz) * ri / (ri - 0.18)), 0.04,
               0.04, B.PAL['iron'], B.METAL)
    # the ring's two ends at the arch, dressed as quoins where they meet the hall's back wall
    for a, s in ((a_start, 1), (a_end, -1)):
        v, k = 0.0, 0
        while v < stone_to - 0.2:
            wide = 0.36 if k % 2 else 0.22
            ring_seg(B, trim, cx, cz, ri - 0.04, ro + 0.04, a, a + s * wide / ri, v + 0.03,
                     min(stone_to, v + 0.62) - 0.03,
                     B.scale_color(B.PAL['ashlar_hi'], 0.95 + 0.08 * _hash(k, int(a * 10))), B.STONE)
            v += 0.62
            k += 1


def tower_roof(B, p):
    T, H = B.TOWER, B.HALL
    cx, cz = T['x'], T['z']
    r0 = T['rOut'] + T['eaveOut']
    y0, peak = T['wallTop'] - 0.1, T['peak']
    wall_z = H['z0']

    def clip(q):
        # the cone's hall side stops against the hall's back wall
        return (q[0], q[1], min(q[2], wall_z))

    slant = math.hypot(r0, peak - y0)
    rows = 13
    for r in range(rows):
        s0 = slant * r / rows
        s1 = min(slant, s0 + slant / rows * 1.3)
        ra, rb = r0 * (1 - s0 / slant), r0 * (1 - s1 / slant)
        ya, yb = y0 + (peak - y0) * s0 / slant, y0 + (peak - y0) * s1 / slant
        n = max(6, int(2 * math.pi * ra / 2.0))
        for i in range(n):
            a0 = 2 * math.pi * (i + 0.5 * (r % 2)) / n
            a1 = a0 + 2 * math.pi / n - 0.01
            am = (a0 + a1) / 2
            if cz + math.cos(am) * ra > wall_z + 0.3:
                continue
            kick = 0.16
            pts = [(cx + math.sin(a0) * (ra + kick), ya - 0.1, cz + math.cos(a0) * (ra + kick)),
                   (cx + math.sin(a1) * (ra + kick), ya - 0.1, cz + math.cos(a1) * (ra + kick)),
                   (cx + math.sin(a1) * rb, yb - 0.1, cz + math.cos(a1) * rb),
                   (cx + math.sin(a0) * rb, yb - 0.1, cz + math.cos(a0) * rb),
                   (cx + math.sin(a0) * (ra + kick), ya, cz + math.cos(a0) * (ra + kick)),
                   (cx + math.sin(a1) * (ra + kick), ya, cz + math.cos(a1) * (ra + kick)),
                   (cx + math.sin(a1) * rb, yb, cz + math.cos(a1) * rb),
                   (cx + math.sin(a0) * rb, yb, cz + math.cos(a0) * rb)]
            B.hexa(p, [clip(q) for q in pts], B.pick(B.PAL['slate'], i * 3 + r), B.STONE)
    # the sarking cone under it, seen from the landing
    n = 20
    for i in range(n):
        a0 = 2 * math.pi * i / n
        a1 = a0 + 2 * math.pi / n
        pts = [(cx + math.sin(a0) * r0, y0 - 0.2, cz + math.cos(a0) * r0),
               (cx + math.sin(a1) * r0, y0 - 0.2, cz + math.cos(a1) * r0), (cx, peak - 0.25, cz), (cx, peak - 0.25, cz),
               (cx + math.sin(a0) * r0, y0 - 0.05, cz + math.cos(a0) * r0),
               (cx + math.sin(a1) * r0, y0 - 0.05, cz + math.cos(a1) * r0), (cx, peak - 0.1, cz), (cx, peak - 0.1, cz)]
        B.hexa(p, [clip(q) for q in pts], B.PAL['sarking'], B.WOOD)
    # the rafters under the sarking, seen from the nook: radial oak from a ring beam on the wall
    # top to a boss under the point
    m = 12
    for i in range(m):
        a = 2 * math.pi * (i + 0.5) / m
        foot = (cx + math.sin(a) * (T['rIn'] - 0.1), y0 + 0.15, cz + math.cos(a) * (T['rIn'] - 0.1))
        head = (cx + math.sin(a) * 0.35, peak - 0.9, cz + math.cos(a) * 0.35)
        if foot[2] > wall_z - 0.2:
            continue
        B.beam(p, foot, head, 0.2, 0.26, B.PAL['beam_dark'])
    p.cylinder((cx, peak - 1.4, cz), (cx, peak - 0.6, cz), 0.42, B.PAL['beam_dark'], B.WOOD, sides=8)
    # the finial: an iron spike, a ball and a little pennant in garnet
    p.cylinder((cx, peak - 0.3, cz), (cx, peak + 2.2, cz), 0.07, B.PAL['iron'], B.METAL, sides=6)
    p.cylinder((cx, peak - 0.2, cz), (cx, peak + 0.35, cz), 0.3, B.PAL['slate_ridge'], B.STONE, sides=8, r1=0.08)
    p.box((cx, peak + 1.0, cz), (0.24, 0.24, 0.24), B.PAL['gold'], B.METAL, taper=0.6)
    p.box((cx + 0.55, peak + 1.8, cz), (1.0, 0.5, 0.04), B.PAL['garnet'], B.PLASTER, taper=0.3)
