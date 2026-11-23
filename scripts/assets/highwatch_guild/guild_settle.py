"""Lantern Hall settled: the painted world's hand-built character (the team's painted world style
guide, rules H1 to H6 and C1), applied to the assembled hall as a few smooth, whole-building
bends after every builder has run and before the paint is laid, so every part that touches
moves together and every joint stays closed:

  - the great roof's ridge sags toward its middle, the slopes, the cresting, the gables' tops
    and the open roof's timbers inside following it down (a bow that dies away to nothing at
    the wall plate, so the walls stay plumb and the roof stays seated on them);
  - the eaves droop a little between their supports (the gables, the porch's cross gable and
    the trophy hall's roof) and kick up at the corners, in the overhang only;
  - the trophy hall's hipped roof and the porch's cross gable sag at their own ridges;
  - the lantern tower's slated spire, the hall's one hero quirk, bends over toward the yard
    like a hat worn a little rakish (the belfry and the tower under it stand square on the
    hall's gable, so nothing opens up where the two meet);
  - the chimney stacks taper toward their pots, each held flat against the wall it climbs.

Every bend is low-frequency (one arc per long line) and zero where players walk: the floors,
the walls up to their plates, the door, the decks and every collision box keep their place
(gameplay stays square, H6), so the plan's collision rows are unchanged. Deterministic: no
randomness, only the plan's numbers.
"""
import math

from shiplib import G as game
from shiplib import P

from guild_plan import (EAVE_OUT, FLOOR, HALL, HEARTH, PORCH, TOWER, TROPHY, TROPHY_OUT, VERGE_OUT)

H = HALL
# the great roof's ridge sags this much at mid-span (about 2 percent of its length)
RIDGE_SAG = 1.0
# the eaves droop this much between supports, and lift this much at the free corners
EAVE_DROOP = 0.16
EAVE_KICK = 0.22
# the trophy hall's and the porch's ridges
TROPHY_SAG = 0.22
PORCH_SAG = 0.16
# the lantern tower's spire bends over at its tip: out from the hall (+x) and toward the yard (-z)
TOWER_LEAN = (1.45, -0.95)
# the chimneys narrow by this share of their width from foot to pot
CHIMNEY_TAPER = 0.16


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def arch(t):
    """One soft arc over [0, 1]: 0 at both ends, 1 in the middle."""
    if t <= 0.0 or t >= 1.0:
        return 0.0
    return math.sin(math.pi * t)


def _ridge_sag(x, y, z):
    ex0, ex1 = H['ox0'] - VERGE_OUT, H['ox1'] + VERGE_OUT
    if y <= H['plate']:
        return 0.0
    # the great roof's own reach in z (its eaves, a little past): beyond it the trophy hall and
    # the porch settle on their own
    ez = H['oz1'] + EAVE_OUT
    wz = 1.0 - smooth((abs(z) - ez) / 0.8)
    if wz <= 0:
        return 0.0
    f = min(1.0, (y - H['plate']) / (H['ridge'] - H['plate']))
    return -RIDGE_SAG * arch((x - ex0) / (ex1 - ex0)) * f * wz


def _eave_droop(x, y, z):
    """The great roof's eaves, in the overhang past the walls only (the roof stays seated on the
    wall plate): a droop between supports and a lift at the free corners."""
    ex0, ex1 = H['ox0'] - VERGE_OUT, H['ox1'] + VERGE_OUT
    out = abs(z) - H['oz1']
    if out <= 0.0 or y < H['plate'] - 2.0 or y > H['plate'] + 1.0 or x < ex0 - 0.5 or x > ex1 + 0.5:
        return 0.0
    w = smooth(out / EAVE_OUT)
    # the spans between supports: the gables, and the cross roofs that run into each eave
    # (the porch on the front, the trophy hall on the back; the tower stands on the front's left)
    if z < 0:
        stops = [ex0, PORCH['x0'] - 0.6, PORCH['x1'] + 0.6, TOWER['x0']]
    else:
        stops = [ex0, TROPHY['ox0'] - 0.9, TROPHY['ox1'] + 0.9, ex1]
    dy = 0.0
    for a, b in ((stops[0], stops[1]), (stops[2], stops[3])):
        if a <= x <= b:
            dy -= EAVE_DROOP * arch((x - a) / (b - a))
    # the corners kick up (the free ends at the gables), a bell-cast lift over the last yards
    for end in (ex0, ex1):
        if z < 0 and end == ex1:
            continue  # the tower stands on that corner
        d = abs(x - end)
        dy += EAVE_KICK * (1.0 - smooth(d / 3.2))
    return dy * w


def _trophy_sag(x, y, z):
    T = TROPHY
    if y <= T['plate'] or z < H['oz1'] - 0.2:
        return 0.0
    x0, x1 = T['ox0'] - TROPHY_OUT, T['ox1'] + TROPHY_OUT
    rise = 6.0
    f = min(1.0, (y - T['plate']) / rise)
    wz = smooth((z - (H['oz1'] - 0.2)) / 1.0)
    return -TROPHY_SAG * arch((x - x0) / (x1 - x0)) * f * wz


def _porch_sag(x, y, z):
    if y <= PORCH['beam'] or z > H['oz0'] + 0.2:
        return 0.0
    x0, x1 = PORCH['x0'] - 0.8, PORCH['x1'] + 0.8
    if not x0 < x < x1:
        return 0.0
    f = min(1.0, (y - PORCH['beam']) / (PORCH['ridge'] - PORCH['beam']))
    # strongest at the porch's front gable, nothing where its ridge runs into the great roof
    wz = smooth((H['oz0'] + 0.2 - z) / 4.0)
    return -PORCH_SAG * (1.0 - abs((x - (x0 + x1) / 2) / ((x1 - x0) / 2))) * f * wz


def _tower_lean(x, y, z):
    """The tower's spire bends over: zero at and under its foot on the belfry's cornice, curving
    over to TOWER_LEAN at the vane's tip (one arc, steeper toward the tip, the slates and the
    hips following it), and only over the tower's own footprint (a yard of margin, fading over
    another, where nothing else stands that high). The belfry, its lantern and the tower's walls
    stand square on the hall's gable."""
    W = TOWER
    base = W['belfry'] + 0.55
    top = W['spire'] + 2.6
    if y <= base:
        return 0.0, 0.0
    m = 1.0
    dx_out = max(W['x0'] - m - x, x - (W['x1'] + m), 0.0)
    dz_out = max(W['z0'] - m - z, z - (W['z1'] + m), 0.0)
    wxz = 1.0 - smooth(max(dx_out, dz_out) / 1.0)
    if wxz <= 0:
        return 0.0, 0.0
    t = min(1.0, (y - base) / (top - base)) ** 1.8
    return TOWER_LEAN[0] * t * wxz, TOWER_LEAN[1] * t * wxz


def _chimney_taper(x, y, z):
    """The stacks narrow as they climb, each held to the wall it stands against: the hall's on
    the right gable (its inner face on the gable wall's outer face), the trophy hall's behind its
    back wall. Only the stack's part out past the roof's verge or eave moves (its outer face and
    the outer ends of its sides), so the slates it passes through never move with it and nothing
    tears where the two meet."""
    hz = (HEARTH['z0'] + HEARTH['z1']) / 2
    # the great hall's stack: x from H.ox0 - 1.6 (outer face) to H.ox0 (on the wall), z hz +- 1.3;
    # the verge reaches out to H.ox0 - VERGE_OUT
    wall = H['ox0']
    if wall - 1.75 <= x < wall - VERGE_OUT - 0.02 and abs(z - hz) <= 1.45 and y > FLOOR:
        top = H['plate'] + (H['ridge'] - H['plate']) * (H['oz1'] - abs(hz)) / H['oz1'] + 3.2
        k = CHIMNEY_TAPER * smooth((y - FLOOR) / (top - FLOOR))
        return (wall - x) * k, -(z - hz) * k
    # the trophy hall's stack: x +-1.1, z from T.oz1 (on the wall) to T.oz1 + 1.4
    T = TROPHY
    if abs(x) <= 1.25 and T['oz1'] + TROPHY_OUT + 0.02 < z <= T['oz1'] + 1.55 and y > FLOOR:
        top = T['plate'] + 6.2
        k = CHIMNEY_TAPER * smooth((y - FLOOR) / (top - FLOOR))
        return -x * k, -(z - T['oz1']) * k
    return 0.0, 0.0


def offset(x, y, z):
    """The settled offset (dx, dy, dz) of a model-frame point."""
    dy = _ridge_sag(x, y, z) + _eave_droop(x, y, z) + _trophy_sag(x, y, z) + _porch_sag(x, y, z)
    lx, lz = _tower_lean(x, y, z)
    cx, cz = _chimney_taper(x, y, z)
    return lx + cx, dy, lz + cz


def settle(parts, skip=()):
    """Bend every part's corners by offset(), in place (parts named in `skip` stay as built:
    the yard stands on the ground and its gateway carries the painted lettering's anchor)."""
    moved = 0
    for name, piece in parts.items():
        if name in skip:
            continue
        for v in piece.bm.verts:
            g = game(v.co)
            dx, dy, dz = offset(g.x, g.y, g.z)
            if dx or dy or dz:
                v.co = P(g.x + dx, g.y + dy, g.z + dz)
                moved += 1
    return moved


def settled(x, y, z):
    """A model-frame point where the settling carries it (for the extras the runtime reads)."""
    dx, dy, dz = offset(x, y, z)
    return (x + dx, y + dy, z + dz)
