"""The Anvil of the World's four quarters (phases 2K to 2M): the pinwheel's own
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

RING_R = 16.0
RIM_R = 60.0
SWEEP = 85.0
POWER = 1.5
RIM_OFFSET = 20.0
RIDGE_HALF = 1.8
ORDER = ('breath', 'quench', 'hammer', 'heat')
# Phase 2M: the room grew to 120 yd across. Each quarter's wall landmark
# stands past the rim at its quarter's middle (its altar's bearing), its
# centre LANDMARK_R out; the altars stand ALTAR_R out at their feet.
LANDMARK_R = 70.0
LANDMARKS = {'breath': 0.0, 'quench': 90.0, 'hammer': 180.0, 'heat': 270.0}
ALTAR_R = 54.0


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


# ---- the arrival's sockets (phase 2L) ---------------------------------------------------
# Where the heart tears the colossus's big rock pieces out of the paving: each
# piece's rest spot (bearing, r) and size, the same as
# src/render/smith_heart_fx/final_fx_core.ts COLOSSUS_PIECES (pinned against
# each other by tests/smith_heart_quarters_kit.test.ts). The kit carves a
# socket there: the paving broken round a pit.
SOCKETS = (
    (340.0, 38.5, 8.0),  # hip
    (20.0, 43.0, 11.0),  # torso
    (112.0, 41.5, 6.8),  # shoulder L
    (292.0, 41.5, 6.8),  # shoulder R
    (150.0, 33.0, 7.8),  # upper arm L
    (325.0, 30.0, 7.8),  # upper arm R
    (104.0, 47.0, 7.5),  # forearm L
    (284.0, 47.0, 7.5),  # forearm R
    (162.0, 46.0, 5.8),  # fist L
    (252.0, 44.0, 5.8),  # fist R
    (62.0, 46.0, 5.7),  # head
)


def socket_radius(size):
    """A socket's pit radius (yards) for a piece of `size`."""
    return 0.85 + size * 0.085


def socket_zone(size):
    """The broken paving round a socket's pit reaches this far."""
    return socket_radius(size) + 1.15


def quarter_of(x, y):
    """The quarter index (ORDER) a Blender point lies in, or -1 in the ring."""
    r, b = polar_of(x, y)
    if r < RING_R:
        return -1
    phi = unwind(b, r)
    return int(((phi - (-45.0 + RIM_OFFSET)) % 360.0) // 90.0)
