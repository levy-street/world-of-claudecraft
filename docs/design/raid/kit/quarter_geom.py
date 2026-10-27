"""The Anvil of the World's four quarters (phase 2K): the pinwheel's own
numbers, the same as the sim's geometry core
(src/sim/content/smith_heart_quarters.ts, pinned against each other by
tests/smith_heart_heart_kit.test.ts through the shipped pieces).

Bearings are degrees clockwise from the game's north (+Z, Blender -Y), 90 =
east (+X); `bp(r, deg)` is the Blender point. The quarters in bearing order:
Breath (0), Quench (90), Hammer (180), Heat (270). Ridge k runs between
quarter k and quarter k + 1: swept back by SWEEP at the ring, straight out at
the rim, where it ends at 45 + 90 k + RIM_OFFSET.

Pure Python (math only).
"""
import math

RING_R = 11.0
RIM_R = 42.0
SWEEP = 85.0
POWER = 1.5
RIM_OFFSET = 20.0
RIDGE_HALF = 1.7
ORDER = ('breath', 'quench', 'hammer', 'heat')


def sweep_share(r):
    u = max(0.0, min(1.0, (r - RING_R) / (RIM_R - RING_R)))
    return (1.0 - u) ** POWER


def ridge_deg(k, r):
    """Ridge k's bearing at radius r (degrees, unwrapped near 45 + 90 k)."""
    return 45.0 + 90.0 * k + RIM_OFFSET - SWEEP * sweep_share(r)


def unwind(deg, r):
    """A bearing with the sweep at radius r taken out: the ridges become
    the straight lines 45 + 90 k + RIM_OFFSET."""
    return deg + SWEEP * sweep_share(r)


def wind(phi, r):
    """The inverse of `unwind`."""
    return phi - SWEEP * sweep_share(r)


def sector(i):
    """Quarter i's unwound sector (degrees): (start, end), 90 wide."""
    a = -45.0 + RIM_OFFSET + 90.0 * i
    return a, a + 90.0


def bp(r, deg):
    a = math.radians(deg)
    return (r * math.sin(a), -r * math.cos(a))


def polar_of(x, y):
    """(r, bearing degrees) of a Blender point."""
    return math.hypot(x, y), math.degrees(math.atan2(x, -y))


def rim_ends():
    """Each ridge's bearing where it meets the rim."""
    return [(45.0 + 90.0 * k + RIM_OFFSET) % 360.0 for k in range(4)]
