"""The Mirefen tavern's jettied upper storey (tavern_shell.py hall_front calls skin(B, p) with the
front wall's part): from LAYOUT['jetty']['y'] up to the gable the front stands a yard further
toward the road than the ground floor, carried on a row of joists whose ends show under a
moulded bressumer, with a carved bracket and a turned drop under each post. Purely outside: the
hall's inner wall face runs on straight up to the roof behind it (the original front wall keeps
its inside, its upper windows and its round window glowing into the room), there is no upper
floor, and nothing of it comes down where a body or the camera walking in goes (the porch canopy
covers the door's width, and the lowest timber of the jetty is well over the door's head).

  HallWallFront*  the upper storey's skin: a timber frame over ochre plaster (hand-hewn posts,
                  rails, braces and St Andrew's crosses), four leaded windows with shutters and
                  window boxes, two small gable windows either side of the king post, the round
                  gable window, the gable's king post, collar and struts and its own bressumer on
                  brackets, the jetty's bressumer, joists, brackets and drops. The front wall's
                  split into three parts (build_tavern.py FRONT_SPLIT) cuts every solid that would
                  run across it, so the camera ghosts only the piece between it and the player.

The upper windows are decorative (no room behind them): their panes are the lanterns' glowing
glass like the rest of the front's, so the storey reads lived in at night.
"""
import math

# the upper storey's windows (local x of the middle, width) and their sill and head: two either
# side of the porch canopy, clear of the tankard sign's mounting board (local x 8.4)
UPPER_WINDOWS = ((-12.4, 1.8), (-5.2, 1.8), (5.2, 1.8), (12.4, 1.8))
UPPER_SILL, UPPER_HEAD = 6.55, 8.45
# the gable's two small windows under the struts, either side of the king post
GABLE_WINDOWS = ((-5.5, 1.1), (5.5, 1.1))
GABLE_SILL, GABLE_HEAD = 10.75, 12.05
# no bracket under the jetty within this far of the door's middle (the porch canopy's own
# brackets carry that span), nor within this far of a door lantern
CANOPY_CLEAR = 4.0
LANTERN_CLEAR = 0.55
DOOR_LANTERNS = (-5.0, 5.0)


def face_z(B):
    """The upper storey's outer face (local z)."""
    return B.HALL['z1'] + B.LAYOUT['jetty']['out']


def skin(B, p):
    """Build the jettied upper storey onto the front wall's part `p`."""
    import tavern_shell as S

    H = B.HALL
    J = B.LAYOUT['jetty']
    jy, out = J['y'], J['out']
    zs = H['z1'] + out / 2
    wall = B.Wall(H['x0'], zs, H['x1'], zs, (0, 1))
    mid = -H['x0']

    def top(u):
        # under the roof's sarking (tavern_shell.py hall_roof: the sarking's underside runs a
        # hand under the roof's line)
        return S.hall_y(B, u - mid) - 0.2

    breaks = (mid - B.FRONT_SPLIT, mid + B.FRONT_SPLIT)
    openings = [(mid + x - w / 2, mid + x + w / 2, UPPER_SILL, UPPER_HEAD) for (x, w) in UPPER_WINDOWS]
    openings += [(mid + x - w / 2, mid + x + w / 2, GABLE_SILL, GABLE_HEAD) for (x, w) in GABLE_WINDOWS]
    posts = B.timber_wall(p, wall, out, top, openings, base_h=0.0, y0=jy, inner=False, bays=3.2, seed=8,
                          breaks=breaks, hewn=0.045)
    # the leaded windows, glazed a hand behind the face: the lanterns' glow, decorative only
    for (a, b, v0, v1) in openings:
        small = v0 > 10
        B.window(p, wall, a, b, v0, v1, out, shutters=not small, lit=True, inner=False, glass_w=out / 2 - 0.2,
                 box_out=out / 2 + 0.2)
    crosses(B, p, wall, posts, openings, jy, top, out, breaks)
    S.gable_timbers(B, p, wall, top, out, H['eave'], mid, H['x1'] - H['x0'], breaks=breaks, faces=(1,))
    S.oculus(B, p, wall, mid, H['eave'] + (H['ridge'] - H['eave']) * 0.62, 1.0, out, lit=True, inner=False)
    jetty_timbers(B, p, [u - mid for u in posts], jy, H['z1'], face_z(B))
    return posts


def crosses(B, p, wall, posts, openings, jy, top, t, breaks):
    """St Andrew's crosses in the upper storey's clear bays over its mid rail (the rails are
    build_tavern.py timber_wall's: the sill beam, the mid rail and the top plate)."""
    eave_line = min(top(0.0), top(wall.length))
    lo = jy + (eave_line - jy) * 0.5 + 0.14
    hi = eave_line - 0.29
    w = t / 2 + 0.03
    col = B.PAL['beam']
    for i in range(len(posts) - 1):
        a, b = posts[i] + 0.17, posts[i + 1] - 0.17
        if b - a < 1.1:
            continue
        if any(oa < b and ob > a and v1 > lo and v0 < hi for (oa, ob, v0, v1) in openings):
            continue
        if any(a < u < b for u in breaks):
            continue
        wall.beam(p, a, lo, b, hi, w, 0.2, 0.1, col, hewn=0.03)
        wall.beam(p, a, hi, b, lo, w, 0.2, 0.1, col, hewn=0.03)


def jetty_timbers(B, p, post_xs, jy, z0, zf):
    """The jetty's carpentry under the upper storey: the joists running out from the ground
    floor's face with their ends under the bressumer, the moulded bressumer along the front,
    and under each of the upper storey's posts a curved bracket from a stone corbel on the wall
    with a turned drop at its head. Every piece stays on one side of the front's split."""
    H = B.HALL
    split = B.FRONT_SPLIT
    dark, beam = B.PAL['beam_dark'], B.PAL['beam']
    b0, b1 = jy - 0.28, jy + 0.32

    def runs(a, b):
        cut = [a] + [x for x in (-split, split) if a < x < b] + [b]
        return list(zip(cut, cut[1:]))

    # the bressumer: a heavy beam with a roll moulding along its lower edge, and the sill plate
    # over the joists' ends behind it
    for (a, b) in runs(H['x0'] - 0.05, H['x1'] + 0.05):
        B.abox(p, a, b, b0, b1, zf - 0.12, zf + 0.26, dark, B.WOOD)
        B.abox(p, a + 0.02, b - 0.02, b0 - 0.05, b0 + 0.06, zf + 0.16, zf + 0.3, beam, B.WOOD)
        B.abox(p, a + 0.02, b - 0.02, b1 - 0.1, b1 - 0.02, zf + 0.26, zf + 0.31, beam, B.WOOD)
    # the joists: their undersides between the wall and the bressumer
    x = H['x0'] + 0.35
    while x < H['x1'] - 0.3:
        if all(abs(x - s) > 0.3 for s in (-split, split)):
            B.abox(p, x - 0.11, x + 0.11, b0 + 0.04, jy, z0 - 0.02, zf - 0.1,
                   B.scale_color(dark, 0.95 + 0.1 * B.hashf(x, 9)), B.WOOD)
        x += 0.62
    # the brackets and drops under the posts
    for xp in post_xs:
        if abs(xp) < CANOPY_CLEAR or any(abs(xp - lx) < LANTERN_CLEAR for lx in DOOR_LANTERNS):
            continue
        if any(abs(xp - s) < 0.3 for s in (-split, split)):
            continue
        bracket(B, p, xp, b0, z0, zf)


def bracket(B, p, x, y_top, z0, zf):
    """One carved bracket: a stone corbel on the ground floor's face, a curved oak bracket from
    it up and out to the bressumer's underside, a scroll at its foot, and a turned drop hung
    under the bressumer's lip."""
    dark = B.PAL['beam_dark']
    reach = zf - z0 - 0.08
    rise = 1.25
    y0 = y_top - rise
    # the stone corbel it springs from
    B.abox(p, x - 0.2, x + 0.2, y0 - 0.26, y0 + 0.02, z0 - 0.02, z0 + 0.22, B.PAL['stone_dark'], B.STONE)
    # the bracket: a quarter curve, thick at the wall and thinning out to the beam
    pts = []
    for k in range(7):
        a = k / 6 * math.pi / 2
        pts.append((x, y0 + 0.12 + (rise - 0.12) * math.sin(a), z0 + 0.1 + reach * (1 - math.cos(a))))
    p.beam(pts, 0.26, 0.24, dark, B.WOOD, up=(1, 0, 0))
    # the back of it, flat to the wall, so it reads as a solid carved block from the side
    B.abox(p, x - 0.12, x + 0.12, y0 + 0.02, y_top, z0 - 0.02, z0 + 0.12, dark, B.WOOD)
    # the scroll at its foot, curled toward the wall
    p.cylinder((x - 0.13, y0 + 0.14, z0 + 0.2), (x + 0.13, y0 + 0.14, z0 + 0.2), 0.11, B.PAL['beam'], B.WOOD,
               sides=8)
    # the turned drop under the bressumer's lip
    zd = zf + 0.1
    p.cylinder((x, y_top - 0.05, zd), (x, y_top - 0.4, zd), 0.08, dark, B.WOOD, sides=6, r1=0.06)
    p.cylinder((x, y_top - 0.4, zd), (x, y_top - 0.52, zd), 0.1, B.PAL['beam'], B.WOOD, sides=6)
    p.box((x, y_top - 0.62, zd), (0.13, 0.16, 0.13), dark, B.WOOD, taper=0.3, pitch=math.pi)
