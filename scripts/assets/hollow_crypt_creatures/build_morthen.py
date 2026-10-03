"""Morthen the Gravecaller as the Lich Bishop: the Hollow Crypt's last boss before
the Knellwyrm (src/sim/encounters/hollow_crypt/morthen_rise.ts, his entrance).

  blender -b --factory-startup --python build_morthen.py -- <out.glb> [--sheet dir] [--blend out.blend] [--fast]

A towering dead prelate who never touches the floor, drawn in the family of Vael
(sunken_bastion_creatures/reaper.py) but unmistakably a bishop (v2, 2026-10-03).
A deep folded COWL of near-black grave shroud hides a gaunt skull whose sockets
burn with green soul fire; over the cowl's crown sits the tall BONE MITRE, his
signature: two plates joined at blackened silver seams, parting into two horns at
the top, ridged with vertebrae, an open slit eye of soul fire on its front plate
with rays and cracks of cold light cut into the bone, and two linen lappets
falling down his back. A short ragged shoulder cape (the mozzetta) rides over a
long tattered cope that parts over an open ribcage of soul fire; a STOLE of old
grave linen hangs down both sides of the ribs and the shroud's flare, sewn with
closed-eye sigils of the Sleep in soul fire. Wide shroud sleeves, bony fists, a
knotted cord cincture, and below the long rags a churning funnel of soul smoke.
In his right hand the BELL STAFF: a vertebral shaft crowned by a gothic iron
cradle with a funeral bell hanging in it, and a folded iron crest over it that
UNFOLDS INTO A GREAT SCYTHE (Blade1 swings down and out of the crest, Blade2
flicks out of it). No candles, no Book of Names: the Chain, Book and BookLid
bones and the candle Flame bones stay in the rig, bare, so every clip keys
exactly what it always did.

Built on the organic kit (organic_kit.py): smooth parts bound one bone each, the
shroud, cope, mozzetta and stole as membranes weighted across hanging spars, a
Cycles bake of the cloth and bone surfaces with their ambient occlusion, a metal
material for the bell, the iron and the silver, the soul fire, eyes, sigils and
runes on the glow material. The soul fire flickers on keyed bone scales.

Scale (yards; a player stands about 2.6): about 6.3 to the mitre's horns at rest;
the game draws him at his template's 1.35, three players tall and more.

Clips (24 fps). The staff set, before his last rites:
  Idle          hovering: a slow bob, the smoke turning, the bell swaying.
  Walk, Run     the glide: leaning in, robes and smoke streaming back.
  StaffStrike   the bell head brought down overhead onto his victim.
  StaffStrike2  a backhand bash across the front with the shaft.
  BellToll      Shadow Pulse: the staff thrust high, the bell tolling hard.
  Rise          the entrance: curled in his robes, he unfurls as he rises.
  SummonSouls   reading the names: the off hand raised, the staff raised,
                the souls whirling (the rise's proclamation, the generic cast).
  ShieldRitual  the ward: the staff held level before him, the souls a ring.
  Hit, Death    a recoil; the fire gutters out and the vestments fold empty.
  Transform     the last rites: the crest unfolds into the scythe, whirled
                overhead and brought round to guard.
The scythe set (the blade out), after it:
  ScytheIdle, ScytheWalk, ScytheRun, ScytheHit, ScytheDeath, ScytheSummon,
  ScytheToll (the pulse), ScytheSweep (a flat reaping sweep), ScytheSweep2
  (a rising diagonal reap brought down across the front).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from organic_kit import (  # noqa: E402
    BODY, GLOW, MEMBRANE, Membrane, Part, Rig, _procedural_surface, bake_surface, bind, build_armature,
    export, expand_bones, join, make_materials, new_scene, render_sheet, setup_preview, triangles, two_bone,
)

METAL = 3

# ------------------------------------------------------------------ palette
# v2 (2026-10-03): Vael's family, a bishop. A near-black grave shroud with a cold
# green cast, a hooded cowl under a tall BONE MITRE, a short shoulder cape
# (the mozzetta) over a long tattered cope, a pale grave-linen stole down the
# front with soul-lit sigils, blackened silver for every fitting, and the green
# soul fire in the ribs, the sockets, the mitre's sigil and the blade's edge.
SHROUD = (0.062, 0.072, 0.07)       # the grave shroud and the hood
SHROUD_HI = (0.12, 0.14, 0.135)
SHROUD_EDGE = (0.2, 0.225, 0.215)
COPE = (0.07, 0.095, 0.085)         # the cope and the mozzetta: a hair greener than the shroud
COPE_DARK = (0.035, 0.045, 0.042)
LINEN = (0.45, 0.43, 0.38)           # the stole and the cope's back orphrey, old grave linen
LINEN_DARK = (0.3, 0.29, 0.26)
SMOKE = (0.16, 0.2, 0.18)
SMOKE_DARK = (0.05, 0.065, 0.06)
SILVER = (0.42, 0.44, 0.43)         # blackened silver: rings, ferrules, the mitre's edges
SILVER_HI = (0.62, 0.65, 0.62)
BONE = (0.8, 0.76, 0.66)
BONE_OLD = (0.62, 0.57, 0.47)
BONE_DARK = (0.32, 0.28, 0.23)
SOCKET = (0.02, 0.018, 0.025)
CAVITY = (0.02, 0.026, 0.024)
SOUL = (0.55, 1.0, 0.45)          # ghost fire: green-white, never cyan
SOUL_HOT = (0.92, 1.0, 0.82)
SOUL_DEEP = (0.14, 0.48, 0.12)
BRONZE = (0.4, 0.3, 0.19)
VERDI = (0.3, 0.52, 0.42)
IRON = (0.13, 0.135, 0.14)
IRON_HI = (0.3, 0.31, 0.32)
LEATHER = (0.12, 0.08, 0.07)
ROPE = (0.2, 0.19, 0.16)

SKIRT = 12   # smoke-robe spars round the waist
CHAS = 11    # chasuble spars round the shoulders (the front stays open)
SMOKE_MAT = 4  # materials: body, glow, membrane, metal, then the translucent soul smoke


def _n(v):
    return Vector(v).normalized()


# ---- the two hands, each a bony fist closed round a bar ------------------------------
# A fist is described by its wrist, `h` (wrist to knuckles), `a` (the bar axis, the
# thumb's side) and `n` (the palm normal, toward the bar). The bar runs through the
# fist at `grip` = wrist + h * FIST_REACH + n * FIST_DEPTH. The staff is modelled IN
# the right fist, so the Staff bone never turns against Hand.R: every swing is carried
# by the shoulder, the elbow, the spine and the floating body. The left fist holds the
# book's chain at rest and closes round the shaft for the two-handed blows.
FIST_REACH = 0.19
FIST_DEPTH = 0.085
GRIP_R_BAR = 0.058                         # the leather-wrapped grip under each hand
ELBOW_L = Vector((1.12, -0.06, 2.9))
WRIST_L = Vector((1.2, -0.4, 2.05))
KNUCK_L = Vector((1.22, -0.5, 1.72))
ELBOW_R = Vector((-1.12, -0.06, 2.9))
# The right forearm is modelled reaching forward, fist upright round the staff.
WRIST_R = ELBOW_R + _n((-0.06, -1.0, 0.12)) * (WRIST_L - ELBOW_L).length
H_R = Vector((0.0, -1.0, 0.0))
A_R = Vector((0.0, 0.0, 1.0))              # the thumb up the staff
N_R = A_R.cross(H_R).normalized()          # the palm toward his middle (+x)
KNUCK_R = WRIST_R + H_R * (KNUCK_L - WRIST_L).length
H_L = _n(KNUCK_L - WRIST_L)
A_L = _n(Vector((0, -1, 0)) - H_L * H_L.dot(Vector((0, -1, 0))))   # the thumb forward
N_L = -(A_L.cross(H_L)).normalized()       # mirror-handed: the palm toward his middle
GRIP = WRIST_R + H_R * FIST_REACH + N_R * FIST_DEPTH   # the staff's grip in the right fist (rest)
GRIP_L = WRIST_L + H_L * FIST_REACH + N_L * FIST_DEPTH  # the left fist's bar (the chain) at rest
GRIP2 = 1.05                               # the off hand's grip, this far down the shaft

SHAFT_BELOW = 1.35
SHAFT_ABOVE = 3.3
APEX = GRIP + Vector((0, 0, SHAFT_ABOVE + 0.12))
BELL_PIVOT = GRIP + Vector((0, 0, SHAFT_ABOVE - 0.42))
CHAIN_MID = GRIP_L - Vector((0, 0, 0.36))
BOOK_TOP = GRIP_L - Vector((0, 0, 0.74))


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


SKULL_C = Vector((0.0, -0.2, 4.42))
EYE_PHI, EYE_THETA = 0.5, 0.1


def _ss(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _g(x):
    return math.exp(-x * x)


def skull_point(phi, theta):
    """A point on the lich's skull at azimuth `phi` (0 dead ahead, -Y) and elevation
    `theta`: (position, outward normal, (socket, nose) darkness 0..1). A long
    cranium; below the brow a flat, gaunt face: deep round-cornered sockets under
    an overhanging brow, the zygomatic arches flaring out as the widest point of
    the face, the cheeks sunk beneath them, a narrow upper jaw pushed forward."""
    ct = math.cos(theta)
    u = Vector((math.sin(phi) * ct, -math.cos(phi) * ct, math.sin(theta)))
    rx = 0.19
    ry = 0.27 if u.y < 0 else 0.31
    rz = 0.36 if u.z > 0 else 0.29
    p0 = Vector((u.x * rx, u.y * ry, u.z * rz))
    # the upper jaw narrows under the arches
    p0.x *= 1.0 - 0.34 * _ss(-0.45, -1.25, theta)
    # the back of the skull rises long behind the mitre
    if u.y > 0:
        p0.z += 0.08 * u.y * max(0.0, u.z)
        p0.y += 0.04 * max(0.0, u.z)
    n = Vector((p0.x / rx ** 2, p0.y / ry ** 2, p0.z / rz ** 2)).normalized()
    front = max(0.0, -u.y)
    face = _ss(0.55, 0.85, front) * _ss(-1.1, -0.8, theta) * (1 - _ss(0.35, 0.6, theta))
    dr = -0.035 * face                     # the face is flat, not an egg
    sock = 0.0
    for s in (-1, 1):
        # the eye socket: a deep bowl with steep walls, slanted so it falls toward the nose
        dp = (phi - s * EYE_PHI) * ct
        dt = theta - EYE_THETA
        sl = s * 0.22
        a_ = dp * math.cos(sl) + dt * math.sin(sl)
        b_ = -dp * math.sin(sl) + dt * math.cos(sl)
        q = (a_ / 0.33) ** 2 + (b_ / 0.25) ** 2
        if q < 1.0:
            dr -= 0.12 * (1.0 - q * q) ** 0.7
            sock = max(sock, (1.0 - q) ** 0.4)
        # the brow ridge over it, dipping to a frown over the nose, overhanging
        brow_t = EYE_THETA + 0.28 - 0.1 * max(0.0, 1.0 - abs(phi) / 0.5)
        dr += 0.05 * _g((theta - brow_t) / 0.08) * _g((phi - s * 0.45) / 0.5) * front
        # the zygomatic arch: a hard blade flaring out from under the eye to the ear
        dr += 0.07 * _g((theta + 0.2) / 0.08) * _g((phi - s * 1.15) / 0.45)
        dr += 0.035 * _g((theta + 0.14) / 0.1) * _g((phi - s * 0.72) / 0.18)
        # the sunken cheek under it
        hollow = _g((theta + 0.52) / 0.18) * _g((phi - s * 0.72) / 0.28)
        dr -= 0.06 * hollow
        sock = max(sock, 0.3 * hollow)
        # the temple, pinched
        dr -= 0.035 * _g((theta - 0.2) / 0.3) * _g((phi - s * 1.5) / 0.35)
    # the nasal cavity: a dark inverted heart between the cheekbones
    nt = theta + 0.3
    half = 0.07 + 0.08 * max(0.0, min(1.0, -nt / 0.18))
    qn = (phi / max(0.02, half)) ** 2 + (nt / 0.19) ** 2
    nose = 0.0
    if qn < 1.0 and front > 0.5:
        dr -= 0.08 * (1.0 - qn) ** 0.9
        nose = (1.0 - qn) ** 0.45
    # the nasal bridge between the sockets, and the upper jaw pushed forward
    dr += 0.022 * _g(phi / 0.09) * _g((theta - 0.06) / 0.14) * front
    dr += 0.04 * _g((theta + 0.85) / 0.18) * front ** 3
    pos = SKULL_C + p0 + n * dr
    return pos, n, (sock, nose)


def sculpt_skull(p, n_phi=48, n_theta=34):
    """The skull as one sculpted surface, vertex-shaded dark in its hollows."""
    before = set(p.bm.faces)
    grid = []
    tones = {}
    for j in range(n_theta + 1):
        theta = -math.pi / 2 + 0.03 + (math.pi - 0.06) * j / n_theta
        row = []
        for i in range(n_phi):
            phi = -math.pi + math.tau * i / n_phi
            pos, _, (sock, nose) = skull_point(phi, theta)
            v = p.bm.verts.new(pos)
            dark = max(sock, nose)
            tones[v] = lerp(lerp(BONE, BONE_OLD, 0.25 + 0.3 * max(0.0, -math.sin(theta))), SOCKET, min(1.0, dark ** 1.2))
            row.append(v)
        grid.append(row)
    for j in range(n_theta):
        for i in range(n_phi):
            p.bm.faces.new((grid[j][i], grid[j][(i + 1) % n_phi], grid[j + 1][(i + 1) % n_phi], grid[j + 1][i]))
    p.bm.faces.new(list(reversed(grid[0])))
    p.bm.faces.new(grid[-1])
    faces = p._new_faces(before)
    p._paint(faces, BONE, BODY)
    for f in faces:
        for lp in f.loops:
            lp[p.col] = (*tones[lp.vert], 1.0)


def blade_curve(t):
    """The unfolded blade's spine, from the hinge at the crest (t=0) to the tip
    (t=1), relative to the hinge: a long crescent sweeping forward and down."""
    ang = t * 1.42
    return Vector((0.0, -math.sin(ang) * 2.75, 0.18 - (1 - math.cos(ang)) * 1.55 + 0.22 * t))


BLADE_MID = 0.48


# ------------------------------------------------------------------- bones
def _skirt_bones():
    out = []
    for k in range(SKIRT):
        st = skirt_spar(k)
        out.append((f'Skirt{k}a', 'Hips', st[0], st[1]))
        out.append((f'Skirt{k}b', f'Skirt{k}a', st[1], st[2]))
        out.append((f'Skirt{k}c', f'Skirt{k}b', st[2], st[3]))
    return out


def skirt_spar(k):
    """Waist to smoke tip: out over the hips, then twisting in to a point."""
    a = math.tau * k / SKIRT
    pts = []
    for z, rx, ry, twist in ((2.46, 0.56, 0.46, 0.0), (1.72, 0.98, 0.9, 0.12), (0.98, 0.66, 0.62, 0.42),
                             (0.16, 0.14, 0.14, 1.05)):
        aa = a + twist
        pts.append((math.sin(aa) * rx, -math.cos(aa) * ry, z))
    return pts


def chas_spar(k):
    """The chasuble's k-th spar: collar, shoulder, chest, waist, hem. theta 0
    hangs down the back; the two ends frame the open front over the ribs."""
    th = math.radians(-150 + 300 * k / (CHAS - 1))
    sx, cy = math.sin(th), math.cos(th)
    back = max(0.0, cy)
    front = max(0.0, -cy)
    return th, [
        (sx * 0.42, cy * 0.32 + 0.02, 3.98),
        (sx * 0.98, cy * 0.52 + 0.04, 3.86),
        (sx * 1.04, cy * 0.66 + 0.08 + back * 0.08, 3.0 + front * 0.1),
        (sx * 1.08, cy * 0.8 + 0.12 + back * 0.25, 2.1 + front * 0.25),
        (sx * 1.1, cy * 0.9 + back * 0.55, 1.28 - back * 0.25 + front * 0.45),
    ]


def _chas_bones():
    out = []
    for k in range(CHAS):
        _, st = chas_spar(k)
        out.append((f'Chas{k}a', 'Chest', st[1], st[2]))
        out.append((f'Chas{k}b', f'Chas{k}a', st[2], st[3]))
        out.append((f'Chas{k}c', f'Chas{k}b', st[3], st[4]))
    return out


# Candle wicks on the left shoulder plate (mirrored onto the right).
CANDLES = [((0.6, 0.02, 4.02), 0.44, 0.058), ((0.78, 0.1, 3.99), 0.32, 0.052), ((0.72, -0.13, 3.98), 0.22, 0.05)]


def _flame_bones():
    out = []
    for i, (base, h, _) in enumerate(CANDLES):
        tip = Vector(base) + Vector((0, 0, h))
        out.append((f'Flame{i}.L', 'Chest', tuple(tip), tuple(tip + Vector((0, 0, 0.2)))))
    # the soul flames burning deep in the eye sockets (they flicker like the candles)
    out.append(('FlameEye.L', 'Head', tuple(EYE), tuple(EYE + Vector((0, 0.02, 0.2)))))
    return out


# The skull is modelled at a man's proportions, then grown about the top of the neck
# so it fills the mitre: a lich's head, not a pin under a hat.
HEAD_PIVOT = Vector((0.0, -0.2, 4.2))
HEAD_SCALE = 1.3
HEAD_XF = Matrix.Translation(HEAD_PIVOT) @ Matrix.Scale(HEAD_SCALE, 4) @ Matrix.Translation(-HEAD_PIVOT)


def _eye():
    pos, n, _ = skull_point(EYE_PHI, EYE_THETA)
    return HEAD_XF @ (pos + n * 0.025)


# The left eye's soul flame, deep in its socket (the right mirrors it).
EYE = _eye()


def _mirror_right(bones):
    """expand_bones mirrors every `.L` bone onto `.R`; the right forearm and fist
    are the exception (the fist is modelled round the upright staff)."""
    out = []
    for name, parent, head, tail in bones:
        if name == 'Fore.R':
            head, tail = tuple(ELBOW_R), tuple(WRIST_R)
        elif name == 'Hand.R':
            head, tail = tuple(WRIST_R), tuple(KNUCK_R)
        out.append((name, parent, head, tail))
    return out


BONES = _mirror_right(expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Hips', 'Root', (0, 0, 2.3), (0, 0, 2.8)),
    ('Spine', 'Hips', (0, 0, 2.8), (0, -0.04, 3.35)),
    ('Chest', 'Spine', (0, -0.04, 3.35), (0, -0.06, 3.95)),
    ('Neck', 'Chest', (0, -0.06, 3.95), (0, -0.12, 4.2)),
    ('Head', 'Neck', (0, -0.12, 4.2), (0, -0.2, 4.62)),
    ('Jaw', 'Head', tuple(HEAD_XF @ Vector((0, -0.235, 4.25))), tuple(HEAD_XF @ Vector((0, -0.46, 4.02)))),
    ('Arm.L', 'Chest', (0.82, -0.02, 3.82), tuple(ELBOW_L)),
    ('Fore.L', 'Arm.L', tuple(ELBOW_L), tuple(WRIST_L)),
    ('Hand.L', 'Fore.L', tuple(WRIST_L), tuple(KNUCK_L)),
    ('Staff', 'Hand.R', tuple(GRIP), tuple(GRIP + Vector((0, 0, 1)))),
    ('Bell', 'Staff', tuple(BELL_PIVOT), tuple(BELL_PIVOT - Vector((0, 0, 0.45)))),
    ('Blade1', 'Staff', tuple(APEX), tuple(APEX + blade_curve(BLADE_MID))),
    ('Blade2', 'Blade1', tuple(APEX + blade_curve(BLADE_MID)), tuple(APEX + blade_curve(1.0))),
    ('Chain1', 'Hand.L', tuple(GRIP_L), tuple(CHAIN_MID)),
    ('Chain2', 'Chain1', tuple(CHAIN_MID), tuple(BOOK_TOP)),
    ('Book', 'Chain2', tuple(BOOK_TOP), tuple(BOOK_TOP - Vector((0, 0, 0.5)))),
    ('BookLid', 'Book', tuple(BOOK_TOP + Vector((0.12, 0, 0))), tuple(BOOK_TOP + Vector((0.12, 0, -0.5)))),
    ('SoulFire', 'Chest', (0, -0.1, 3.32), (0, -0.1, 3.72)),
    ('Souls', 'Root', (0, 0, 3.3), (0, 0, 3.8)),
    ('Smoke', 'Root', (0, 0, 0.2), (0, 0, 1.2)),
    ('SmokeIn', 'Root', (0, 0.01, 0.3), (0, 0.01, 1.3)),
] + _flame_bones() + _skirt_bones() + _chas_bones()))
REST = {n: (Vector(h), Vector(t)) for n, _, h, t in BONES}
FLAMES = [n for n, *_ in BONES if n.startswith('Flame')]
FLICKER = set(FLAMES) | {'SoulFire'}

# The Book of Names opened before him: pages facing out and up at whoever he
# names, the spine left to right (columns: the book's local x, y, z).
BOOK_OPEN = Matrix(((0.0, 1.0, 0.0), (-0.55, 0.0, 0.84), (0.84, 0.0, 0.55))).to_quaternion()


# ------------------------------------------------------------------- parts
def fist(p, wrist, h, a, n, rings=(1, 3), bar=GRIP_R_BAR):
    """A bony hand CLOSED round a bar: the carpal knot, four metacarpals out to the
    knuckles, four fingers wrapped round the bar (axis `a`, through
    wrist + h * FIST_REACH + n * FIST_DEPTH) and the thumb locked over them.
    `h` wrist to knuckles, `a` the bar axis (thumb side), `n` the palm normal."""
    w, h, a, n = Vector(wrist), _n(h), _n(a), _n(n)
    c = w + h * FIST_REACH + n * FIST_DEPTH
    fr = 0.025
    rad = bar + fr + 0.004

    def on_bar(phi, off, r=rad):
        # phi 0 on the back of the bar (the palm side), 90 over its front, 180 behind it
        return c + (-n * math.cos(phi) + h * math.sin(phi)) * r + a * off

    p.blob(w, (0.15, 0.14, 0.13), BONE_OLD, segments=10, rings=7)
    p.blob(w + h * 0.07 - n * 0.01, (0.17, 0.1, 0.16), BONE, rot=(0, 0, 0), segments=10, rings=6)
    for k, off in enumerate((0.078, 0.027, -0.024, -0.072)):
        knuckle = on_bar(math.radians(-8), off)
        base = w + h * 0.04 + a * off * 0.45 - n * 0.02
        p.tube([base, base.lerp(knuckle, 0.5) - n * 0.012, knuckle], [0.024, 0.02, 0.026], BONE, sides=7)
        p.blob(knuckle, (0.064, 0.064, 0.058), BONE_OLD, segments=8, rings=5)
        phi = math.radians(-8)
        pos = knuckle
        for i, ln in enumerate((0.1, 0.084, 0.068)):
            ln *= 1.0 - 0.08 * abs(k - 1.2)
            phi += 2 * math.asin(min(0.99, ln / (2 * rad)))
            end = on_bar(phi, off)
            r0 = fr * (1 - 0.14 * i)
            p.tube([pos, pos.lerp(end, 0.5) + (pos.lerp(end, 0.5) - c - a * off).normalized() * 0.006, end],
                   [r0, r0 * 0.82, r0 * 0.9], lerp(BONE, BONE_OLD, i * 0.3), sides=7)
            p.blob(end, (r0 * 2.1, r0 * 2.1, r0 * 2.1), BONE_OLD, segments=7, rings=5)
            if i == 0 and k in rings:
                mid = pos.lerp(end, 0.55)
                d = (end - pos).normalized()
                p.tube([mid - d * 0.02, mid + d * 0.02], [r0 * 1.75, r0 * 1.75], SILVER, sides=9, mat=METAL)
            pos = end
        # the claw of the fingertip, a hooked point against the bar
        tip = on_bar(phi + 0.42, off, rad - 0.006)
        p.tube([pos, pos.lerp(tip, 0.5), tip], [fr * 0.7, fr * 0.45, 0.003], BONE_DARK, sides=5)
    # the thumb: from the heel of the hand over the bar, locked across the first finger
    tb = w + h * 0.05 + a * 0.085 - n * 0.02
    t_off = 0.13
    j0 = on_bar(math.radians(-58), t_off, rad + 0.01)
    p.tube([tb, tb.lerp(j0, 0.5), j0], [0.028, 0.026, 0.026], BONE, sides=7)
    p.blob(j0, (0.06, 0.06, 0.056), BONE_OLD, segments=8, rings=5)
    phi = math.radians(-58)
    pos = j0
    for i, ln in enumerate((0.09, 0.07)):
        phi -= 2 * math.asin(min(0.99, ln / (2 * (rad + 0.01))))
        end = on_bar(phi, t_off - 0.035 * (i + 1), rad + 0.01)
        p.tube([pos, pos.lerp(end, 0.5), end], [0.026 - 0.004 * i, 0.022, 0.023 - 0.004 * i], BONE, sides=7)
        p.blob(end, (0.05, 0.05, 0.05), BONE_OLD, segments=7, rings=5)
        pos = end
    return c


# The head is modelled in Vael's head frame (sunken_bastion_creatures/reaper.py) and
# carried onto the rig's head by HEAD_M (HEAD_XF stays the bones' frame, so Jaw and
# FlameEye keep their rest heads): a gaunt face deep in a cowl, Vael's family.
HEAD_M = Matrix.Translation((0.0, -0.24, 4.4)) @ Matrix.Scale(0.9, 4) @ Matrix.Translation((0.0, 0.36, -5.6))
# The mitre: one solid of two bone plates joined at the side seams, its band gripping
# the cowl's crown.
MITRE_BASE = 4.86
MITRE_H = 1.36


def _mitre_hw(t):
    return 0.34 * (1 + 0.2 * math.sin(t * math.pi * 0.85)) * (1 - t ** 2.2) + 0.02


def _mitre_hd(t):
    return 0.19 * (1 - t ** 2.4) + 0.03


def _mitre_yc(t):
    return -0.08 - 0.07 * t


def _catmull(pts, n):
    """`n` + 1 points along a Catmull-Rom curve through `pts`."""
    pts = [Vector(p) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(n + 1):
        u = i / n * (len(pts) - 1)
        k = min(int(u), len(pts) - 2)
        f = u - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f))
    return out


COWL_PATH = [(0, 0.12, 4.86), (0, 0.24, 5.3), (0, 0.16, 5.7), (0, -0.12, 5.86), (0, -0.44, 5.82), (0, -0.7, 5.66),
             (0, -0.88, 5.44)]
COWL_R = [0.36, 0.44, 0.42, 0.38, 0.4, 0.48, 0.57]


def cowl(p, n=26, sides=30, squash=1.16):
    """The cowl in Vael's head frame: a folded tube over the skull from the nape to the
    face, open at both ends, its brow drawn forward into a peak. Folds run down it,
    deepening toward the opening; the valleys are shaded dark."""
    before = set(p.bm.faces)
    path = _catmull(COWL_PATH, n)
    radii = []
    for i in range(n + 1):
        u = i / n * (len(COWL_R) - 1)
        k = min(int(u), len(COWL_R) - 2)
        radii.append(COWL_R[k] + (COWL_R[k + 1] - COWL_R[k]) * (u - k))
    grid, tone = [], {}
    rim = []
    for i, c in enumerate(path):
        u = i / n
        tng = (path[min(n, i + 1)] - path[max(0, i - 1)]).normalized()
        side = tng.cross(Vector((1, 0, 0))).normalized()
        upv = tng.cross(side).normalized()
        if side.z < 0:
            side = -side
        row = []
        for k in range(sides):
            a = math.tau * k / sides
            ca, sa = math.cos(a), math.sin(a)
            amp = 0.02 + 0.07 * u ** 1.5
            fold = 0.55 * math.sin(7 * a + 2.1 * u) + 0.45 * math.sin(12 * a - 3.0 * u + 0.7)
            r = radii[i] * (1 + amp * fold)
            pos = c + side * ca * r + upv * sa * r * squash
            # the brow of the cowl drawn forward and down into a peak over the face
            peak = max(0.0, ca) ** 3 * max(0.0, (u - 0.6) / 0.4) ** 2
            pos += tng * 0.13 * peak - side * 0.06 * peak
            # the cheeks of the opening hang a little lower and closer
            pos -= side * 0.06 * max(0.0, -ca) * max(0.0, (u - 0.7) / 0.3)
            v = p.bm.verts.new(pos)
            tone[v] = 0.75 + 0.35 * max(-1.0, min(1.0, fold)) * min(1.0, u * 2)
            row.append(v)
            if i == n:
                rim.append(pos.copy())
        grid.append(row)
    for i in range(n):
        for k in range(sides):
            p.bm.faces.new((grid[i][k], grid[i][(k + 1) % sides], grid[i + 1][(k + 1) % sides], grid[i + 1][k]))
    faces = p._new_faces(before)
    p._paint(faces, SHROUD_HI, MEMBRANE)
    for f in faces:
        for lp in f.loops:
            lp[p.col] = (*[ch * tone[lp.vert] for ch in SHROUD_HI], 1.0)
    p.tube(rim + [rim[0]], [0.02] * (len(rim) + 1), SHROUD_EDGE, sides=6, cap=False)


def build_parts():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    # --- the torso: grave cloth below, an open ribcage of soul fire above ------------------
    torso = part('Torso', 'Spine', subdiv=1)
    torso.loft([
        ((0, 0.04, 2.5), 0.46, 0.34, 2.4, (0, 0, 1)),
        ((0, 0.06, 2.95), 0.42, 0.32, 2.4, (0, 0, 1)),
        ((0, 0.08, 3.3), 0.52, 0.34, 2.6, (0, 0, 1)),
    ], SHROUD, sides=18, mat=MEMBRANE)
    chest = part('ChestShell', 'Chest', subdiv=1)
    chest.loft([
        ((0, 0.1, 3.3), 0.54, 0.3, 2.6, (0, 0, 1)),
        ((0, 0.12, 3.6), 0.74, 0.34, 2.8, (0, 0, 1)),
        ((0, 0.1, 3.88), 0.9, 0.36, 3.0, (0, 0, 1)),
        ((0, 0.04, 4.02), 0.42, 0.26, 2.2, (0, 0, 1)),
    ], CAVITY, sides=18, mat=MEMBRANE)
    ribs = part('Ribs', 'Chest', smooth=True)
    ribs.tube([Vector((0, -0.38, 3.9)), Vector((0, -0.44, 3.6)), Vector((0, -0.4, 3.28))], [0.04, 0.045, 0.034],
              BONE, sides=6)
    for i in range(6):
        z = 3.84 - i * 0.1
        w = 0.36 + 0.05 * math.sin(i * 0.9)
        for s in (-1, 1):
            pts = [Vector((s * (0.03 + w * math.sin(t * math.pi * 0.64)), -0.41 + 0.4 * (1 - math.cos(t * math.pi * 0.64)),
                           z - 0.12 * t)) for t in (j / 7 for j in range(8))]
            ribs.tube(pts, [0.03 - 0.003 * i] * 8, lerp(BONE, BONE_OLD, i / 6), sides=6)
    for i in range(11):
        z = 3.86 - i * 0.12
        y = 0.02 if z > 3.3 else -0.12
        ribs.blob((0, y, z), (0.1, 0.09, 0.07), lerp(BONE, BONE_DARK, i / 14), segments=8, rings=5)
        ribs.box((0, y + 0.08, z), (0.035, 0.08, 0.05), BONE_OLD, bevel=0.01)
        if z <= 3.3:
            for s in (-1, 1):
                ribs.spike((s * 0.05, y - 0.02, z), 0.025, 0.12, BONE_OLD, sides=4, lean=(s * 0.1, -0.02))
    # The soul fire caged in the ribs (flickers on the SoulFire bone): a deep green
    # mass, a hot heart and tongues licking up between the ribs.
    fire = part('SoulFireCore', 'SoulFire', smooth=True)
    fire.blob((0, -0.12, 3.46), (0.42, 0.3, 0.46), SOUL_DEEP, mat=GLOW, segments=12, rings=10)
    fire.blob((0, -0.18, 3.44), (0.27, 0.21, 0.31), SOUL, mat=GLOW, segments=10, rings=8)
    fire.blob((0, -0.22, 3.42), (0.14, 0.11, 0.17), SOUL_HOT, mat=GLOW, segments=8, rings=6)
    for k in range(7):
        a = k * 2.4
        x = math.sin(a) * 0.16
        y = -0.14 + math.cos(a) * 0.08
        h = 0.22 + 0.07 * ((k * 5) % 3)
        fire.spike((x, y, 3.48), 0.065, h, lerp(SOUL, SOUL_HOT, 0.4), sides=5, lean=(x * 0.4, -0.05), mat=GLOW)
    # --- the skull, deep in the cowl (Vael's recipe, a lich bishop's face) -------------------
    # Modelled in Vael's head frame (reaper.py) and carried onto the rig's head by HEAD_M:
    # a long cranium, an overhanging brow, deep sockets with embers of soul fire in them,
    # blade cheekbones, a narrow upper jaw and a compact mandible on the Jaw bone.
    head = part('Skull', 'Head', smooth=True, subdiv=1)
    hm = head.mark()
    head.blob((0, -0.34, 5.72), (0.37, 0.52, 0.5), BONE, segments=18, rings=14)          # the cranium, long
    head.blob((0, -0.56, 5.8), (0.31, 0.24, 0.15), BONE, segments=14, rings=8)           # the brow
    head.loft([
        ((0, -0.5, 5.66), 0.19, 0.12, 2.6, (0, -0.25, -1)),
        ((0, -0.58, 5.5), 0.155, 0.1, 2.4, (0, -0.2, -1)),
        ((0, -0.62, 5.38), 0.115, 0.08, 2.2, (0, -0.2, -1)),
    ], BONE, sides=14)
    for s in (-1, 1):
        head.blob((s * 0.12, -0.68, 5.6), (0.13, 0.09, 0.11), SOCKET, segments=12, rings=8)   # deep sockets
        head.loft([
            ((s * 0.14, -0.6, 5.5), 0.03, 0.04, 2.0, (s * 1, -0.6, -0.2)),
            ((s * 0.22, -0.55, 5.48), 0.04, 0.05, 2.0, (s * 1, -0.6, -0.2)),
            ((s * 0.28, -0.43, 5.5), 0.02, 0.03, 2.0, (s * 1, -0.6, -0.2)),
        ], BONE_OLD, sides=8)
        head.blob((s * 0.25, -0.33, 5.62), (0.07, 0.11, 0.1), BONE_OLD, segments=8, rings=6)   # temples
        head.blob((s * 0.16, -0.6, 5.42), (0.07, 0.05, 0.06), BONE_DARK, segments=8, rings=6)  # sunken cheeks
    head.prism((0, -0.665, 5.5), 3, 0.045, 0.001, 0.09, SOCKET, axis=(0, -0.3, -1))       # nasal cavity
    for k in range(8):
        if k in (2, 6):
            continue
        x = (k - 3.5) * 0.032
        head.box((x, -0.655 + abs(x) * 0.4, 5.365 - 0.008 * (k % 3)), (0.024, 0.022, 0.06 + 0.012 * (k % 2)),
                 BONE_OLD, bevel=0.004)                                                  # upper teeth, two lost
    # cracks over the cranium, two lit from inside by the fire behind the sockets
    for pts, glow in ((((-0.1, -0.7, 5.86), (-0.06, -0.66, 5.98), (-0.11, -0.58, 6.08)), True),
                      (((0.15, -0.6, 5.92), (0.2, -0.5, 6.03), (0.16, -0.38, 6.1)), True),
                      (((0.3, -0.2, 5.8), (0.34, -0.1, 5.7)), False)):
        head.tube([Vector(p) for p in pts], [0.012] * (len(pts) - 1) + [0.004], SOUL if glow else SOCKET,
                  mat=GLOW if glow else BODY, sides=4)
    head.turn(hm, HEAD_M)
    jaw = part('Jaw', 'Jaw', smooth=True)
    jm = jaw.mark()
    jaw.loft([
        ((-0.2, -0.42, 5.36), 0.03, 0.05, 2.0, (1, -0.4, 0)),
        ((-0.12, -0.58, 5.3), 0.04, 0.05, 2.0, (1, -0.4, 0)),
        ((0, -0.63, 5.27), 0.05, 0.055, 2.0, (1, 0, 0)),
        ((0.12, -0.58, 5.3), 0.04, 0.05, 2.0, (1, 0.4, 0)),
        ((0.2, -0.42, 5.36), 0.03, 0.05, 2.0, (1, 0.4, 0)),
    ], BONE, sides=8)
    for s in (-1, 1):
        jaw.tube([Vector((s * 0.2, -0.42, 5.36)), Vector((s * 0.21, -0.36, 5.46)), Vector((s * 0.22, -0.33, 5.52))],
                 [0.035, 0.03, 0.035], BONE_OLD, sides=7)                                 # the ramus to the hinge
    for k in range(7):
        if k in (1, 5):
            continue
        x = (k - 3) * 0.034
        jaw.box((x, -0.615 + abs(x) * 0.4, 5.325), (0.023, 0.02, 0.05), BONE_OLD, bevel=0.004)
    jaw.tube([Vector((0.05, -0.655, 5.3)), Vector((0.07, -0.65, 5.27)), Vector((0.085, -0.64, 5.25))],
             [0.007, 0.006, 0.003], SOCKET, sides=4)                                       # a crack through the chin
    jaw.turn(jm, HEAD_M)
    for i, z in enumerate((3.92, 4.0, 4.08)):
        cv = part(f'Cervical{i}', 'Neck', smooth=True)
        cv.blob((0, -0.1 - 0.02 * i, z), (0.14, 0.12, 0.07), lerp(BONE, BONE_OLD, 0.3 * i), segments=10, rings=6)
    # The soul fire in the sockets, each on its flickering bone: a white-hot ember, a green
    # flare filling the socket's mouth and a tongue of ghost fire licking up over the brow.
    for s, tag in ((1, '.L'), (-1, '.R')):
        fl = part('FlameEye' + tag, 'FlameEye' + tag, smooth=True)
        fm = fl.mark()
        e = Vector((s * 0.12, -0.75, 5.6))
        fl.blob(e + Vector((0, 0.03, 0)), (0.12, 0.03, 0.1), SOUL_DEEP, mat=GLOW, segments=10, rings=6)
        fl.blob(e, (0.075, 0.03, 0.07), SOUL, mat=GLOW, segments=10, rings=6)
        fl.blob(e + Vector((0, -0.012, 0)), (0.04, 0.02, 0.04), SOUL_HOT, mat=GLOW, segments=8, rings=6)
        fl.tube([e + Vector((0, -0.01, 0.02)), e + Vector((s * 0.01, -0.02, 0.07)), e + Vector((s * 0.03, -0.015, 0.13)),
                 e + Vector((s * 0.06, 0.0, 0.19))], [0.03, 0.02, 0.01, 0.001], [SOUL_HOT, SOUL, SOUL, SOUL_DEEP],
                mat=GLOW, sides=6)
        fl.turn(fm, HEAD_M)
    # --- the cowl: Vael's deep hood, folded, the mitre's band gripping its crown --------------
    hood = part('Hood', 'Head', smooth=True, subdiv=1)
    hood_mark = hood.mark()
    cowl(hood)
    hood.turn(hood_mark, HEAD_M)
    # --- the bone mitre: one solid of two plates joined at the side seams ---------------------
    mit = part('Mitre', 'Head', smooth=True)
    MB = lerp(BONE, BONE_OLD, 0.3)
    secs = []
    for i in range(9):
        t = 0.6 * i / 8
        secs.append(((0, _mitre_yc(t), MITRE_BASE + t * MITRE_H), _mitre_hw(t), _mitre_hd(t), 2.0, (0, 0, 1)))
    mit.loft(secs, MB, sides=20)
    # above 0.6 the two plates part into horns, front and back, a dark cleft between
    for face in (-1, 1):
        secs = []
        for i in range(7):
            t = 0.58 + 0.42 * i / 6
            hd = _mitre_hd(t) * 0.5
            off = face * (_mitre_hd(t) * 0.5 + 0.035 * ((t - 0.58) / 0.42) ** 1.5)
            secs.append(((0, _mitre_yc(t) + off, MITRE_BASE + t * MITRE_H), _mitre_hw(t), hd, 2.0, (0, 0, 1)))
        mit.loft(secs, MB if face < 0 else lerp(MB, BONE_DARK, 0.2), sides=16)
    mit.loft([((0, _mitre_yc(0.6), MITRE_BASE + 0.6 * MITRE_H), _mitre_hw(0.6) * 0.9, 0.03, 2.0, (0, 0, 1)),
              ((0, _mitre_yc(0.97), MITRE_BASE + 0.97 * MITRE_H), 0.03, 0.02, 2.0, (0, 0, 1))], SOCKET, sides=10)
    for face in (-1, 1):
        # a vertebral ridge up the middle of each plate
        for i in range(10):
            t = (i + 0.4) / 11
            y = _mitre_yc(t) + face * (_mitre_hd(t) + 0.005)
            mit.blob((0, y, MITRE_BASE + 0.04 + t * MITRE_H * 0.95), (0.07 * (1 - t * 0.5), 0.045, 0.06),
                     BONE_OLD, segments=8, rings=5)
    for s in (-1, 1):
        # blackened silver along the side seams, bone spines along them
        seam = [Vector((s * _mitre_hw(i / 12), _mitre_yc(i / 12), MITRE_BASE + i / 12 * MITRE_H)) for i in range(13)]
        mit.tube(seam, [0.03] * 12 + [0.012], SILVER, sides=6, mat=METAL)
        for i in range(5):
            t = 0.12 + i * 0.15
            mit.spike((s * (_mitre_hw(t) + 0.012), _mitre_yc(t), MITRE_BASE + t * MITRE_H), 0.026,
                      0.12 * (1 - t * 0.5), BONE_OLD, sides=4, lean=(s * 0.1, 0))
    for face in (-1, 1):
        y = _mitre_yc(1.0) + face * 0.05
        mit.spike((0, y, MITRE_BASE + MITRE_H - 0.02), 0.03, 0.14, BONE_OLD, sides=5, lean=(0, face * 0.04))
    # the band: blackened silver gripping the cowl's crown, bone studs round it
    mit.loft([((0, _mitre_yc(0), MITRE_BASE - 0.1), _mitre_hw(0) + 0.05, _mitre_hd(0) + 0.05, 2.2, (0, 0, 1)),
              ((0, _mitre_yc(0), MITRE_BASE + 0.07), _mitre_hw(0) + 0.025, _mitre_hd(0) + 0.025, 2.2, (0, 0, 1))],
             SILVER, sides=24, mat=METAL)
    for i in range(16):
        a = math.tau * i / 16
        mit.blob((math.sin(a) * (_mitre_hw(0) + 0.06), _mitre_yc(0) - math.cos(a) * (_mitre_hd(0) + 0.06),
                  MITRE_BASE - 0.015), (0.045, 0.045, 0.05), BONE_OLD, segments=6, rings=4)
    # The sigil on the front plate: an open eye of soul fire in a silver almond, rays of
    # cold light cut into the bone round it, cracks of fire running up toward the peak.
    ts = 0.32
    fz = MITRE_BASE + ts * MITRE_H
    fy = _mitre_yc(ts) - _mitre_hd(ts)
    ring = []
    for i in range(33):
        a = math.tau * i / 32
        ring.append(Vector((math.sin(a) * abs(math.sin(a)) ** 0.2 * 0.15, fy - 0.004,
                            fz + math.cos(a) * 0.12)))
    mit.tube(ring, [0.02] * 33, SILVER, sides=6, cap=False, mat=METAL)
    mit.blob((0, fy + 0.008, fz), (0.28, 0.04, 0.2), SOCKET, segments=12, rings=8)
    mit.blob((0, fy - 0.01, fz), (0.07, 0.028, 0.17), SOUL, mat=GLOW, segments=12, rings=8)
    mit.blob((0, fy - 0.022, fz), (0.022, 0.018, 0.12), SOUL_HOT, mat=GLOW, segments=8, rings=6)
    for k in range(10):
        a = math.tau * k / 10 + 0.31
        r0, r1 = 0.24, 0.31 + 0.06 * (k % 2)
        p0 = Vector((math.sin(a) * r0 * 0.7, 0, fz + math.cos(a) * r0))
        p1 = Vector((math.sin(a) * r1 * 0.7, 0, fz + math.cos(a) * r1))
        for p in (p0, p1):
            t = (p.z - MITRE_BASE) / MITRE_H
            p.y = _mitre_yc(t) - _mitre_hd(t) * math.sqrt(max(0.0, 1 - (p.x / _mitre_hw(t)) ** 2)) - 0.004
        mit.tube([p0, p1], [0.011, 0.004], SOUL_DEEP, mat=GLOW, sides=4)
    for path in (((0.0, 0.52), (-0.04, 0.62), (0.02, 0.72), (-0.02, 0.84)), ((0.05, 0.55), (0.1, 0.66))):
        pts = []
        for x, t in path:
            pts.append(Vector((x, _mitre_yc(t) - _mitre_hd(t) - 0.004, MITRE_BASE + t * MITRE_H)))
        mit.tube(pts, [0.011] * (len(pts) - 1) + [0.003], SOUL, mat=GLOW, sides=4)
    # the lappets: two strips of grave linen falling from the back of the mitre over the cowl
    for s in (-1, 1):
        base = Vector((s * 0.2, _mitre_yc(0) + _mitre_hd(0) + 0.06, MITRE_BASE - 0.04))
        pts = [base + Vector((s * 0.05 * t, 0.16 * t + 0.14 * t * t, -1.05 * t)) for t in (i / 7 for i in range(8))]
        mit.tube(pts, [0.075] * 8, LINEN_DARK, sides=6, squash=0.22, mat=MEMBRANE, up=(0, 1, 0))
        for e in (-1, 1):
            mit.tube([p + Vector((e * 0.07, 0.012, 0)) for p in pts], [0.011] * 8, SILVER, sides=4, mat=METAL)
        mit.tube([pts[-1] + Vector((-0.075, 0.01, -0.02)), pts[-1] + Vector((0.075, 0.01, -0.02))], [0.02, 0.02],
                 SILVER, sides=6, mat=METAL)
        for j in range(5):
            x = -0.06 + 0.03 * j
            mit.tube([pts[-1] + Vector((x, 0.01, -0.03)), pts[-1] + Vector((x, 0.012, -0.14 - 0.03 * (j % 2)))],
                     [0.008, 0.004], LINEN_DARK, sides=4)
    # --- the cincture: a knotted cord with bone beads ------------------------------------------
    belt = part('Belt', 'Hips', smooth=True)
    belt.tube([Vector((math.sin(math.tau * i / 32) * 0.56, -math.cos(math.tau * i / 32) * 0.46, 2.52 + 0.03 * math.sin(i)))
               for i in range(33)], [0.045] * 33, ROPE, sides=6, cap=False)
    for i in range(10):
        a = math.tau * (i + 0.5) / 10
        belt.blob((math.sin(a) * 0.585, -math.cos(a) * 0.485, 2.52), (0.06, 0.055, 0.06), BONE_OLD, segments=6, rings=4)
    belt.blob((0.16, -0.5, 2.5), (0.11, 0.08, 0.1), ROPE, segments=8, rings=6)   # the knot
    # --- arms: wide shroud sleeves, tattered, bony fists ---------------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        a0, a1 = REST['Arm' + tag]
        up = part('Sleeve' + tag, 'Arm' + tag, smooth=True)
        up.tube([a0.lerp(a1, t) for t in (0, 0.33, 0.66, 1.0)], [0.25, 0.22, 0.21, 0.23], SHROUD_HI, sides=12,
                mat=MEMBRANE)
        f0, f1 = REST['Fore' + tag]
        fd = (f1 - f0).normalized()
        fu = fd.orthogonal().normalized()
        fv = fd.cross(fu).normalized()
        lo = part('Cuff' + tag, 'Fore' + tag, smooth=True)
        lo.tube([f0.lerp(f1, t) for t in (0, 0.3, 0.6, 0.85, 1.0)], [0.21, 0.24, 0.29, 0.35, 0.39], SHROUD, sides=16,
                cap=False, mat=MEMBRANE, up=tuple(fu))
        # a thin hem of grave linen just inside the bell of the sleeve
        lo.tube([f1 - fd * 0.06, f1 - fd * 0.01], [0.365, 0.372], LINEN_DARK, sides=16, cap=False, mat=MEMBRANE)
        # tatters hang from the lower half of the bell, falling (not fanning round the fist)
        down = Vector((0, 0, -1))
        for k in range(11):
            ang = math.tau * k / 11
            ring = fu * math.cos(ang) + fv * math.sin(ang)
            if ring.z > 0.35:
                continue
            base = f1 + ring * 0.37 - fd * 0.06
            ln = 0.3 + 0.35 * ((k * 37) % 5) / 5
            hang = (down * 0.75 + fd * 0.25 + ring * 0.1).normalized()
            lo.tube([base, base + ring * 0.03 + hang * ln * 0.5, base + ring * 0.05 + hang * ln], [0.1, 0.075, 0.015],
                    SHROUD_EDGE if k % 3 == 0 else SHROUD, sides=4, squash=0.14, mat=MEMBRANE, up=tuple(ring))
        hand = part('Hand' + tag, 'Hand' + tag, smooth=True)
        if s > 0:
            fist(hand, WRIST_L, H_L, A_L, N_L, rings=(1,))
        else:
            fist(hand, WRIST_R, H_R, A_R, N_R, rings=(2,))
    # (The Book of Names and its chain are gone: the Chain, Book and BookLid bones stay
    # in the rig, bare, so every clip keys exactly what it always did.)
    # --- the bell staff and the folded scythe ----------------------------------------------------
    st = part('Staff', 'Staff', smooth=True)
    up = Vector((0, 0, 1))
    g = Vector(GRIP)
    bottom = g - up * SHAFT_BELOW
    top = g + up * SHAFT_ABOVE
    n = 30
    grips = [(g, 0.17), (g - up * GRIP2, 0.15)]

    def in_grip(pt, pad=0.0):
        return any(abs((pt - c).dot(up)) < half + pad for c, half in grips)

    for i in range(n):
        t0_ = i / n
        t1_ = (i + 0.8) / n
        a = bottom.lerp(top, t0_)
        b = bottom.lerp(top, t1_)
        if in_grip(a.lerp(b, 0.5), 0.05):
            continue
        st.tube([a, a.lerp(b, 0.5), b], [0.075, 0.062, 0.075], lerp(BONE_OLD, BONE_DARK, (i % 4) / 5), sides=8)
        st.tube([b, bottom.lerp(top, (i + 1) / n)], [0.05, 0.05], BONE_DARK, sides=6)
    for c, half in grips:
        lo_, hi_ = c - up * (half + 0.07), c + up * (half + 0.07)
        st.tube([lo_, c, hi_], [GRIP_R_BAR, GRIP_R_BAR, GRIP_R_BAR], LEATHER, sides=10)
        turns_ = 7
        wrap = [c + up * (-half + 2 * half * j / 48) + Vector((math.cos(j * turns_ * math.tau / 48),
                                                                math.sin(j * turns_ * math.tau / 48), 0)) * (GRIP_R_BAR + 0.004)
                for j in range(49)]
        st.tube(wrap, [0.011] * 49, LINEN_DARK, sides=5, cap=False)
        for e in (-1, 1):
            st.tube([c + up * (e * (half + 0.06) - 0.035), c + up * (e * (half + 0.06) + 0.035)], [0.088, 0.088], SILVER,
                    sides=10, mat=METAL)
    for t in (0.0, 0.62, 0.9):
        c = bottom.lerp(top, t)
        st.tube([c - up * 0.07, c + up * 0.07], [0.1, 0.1], SILVER, sides=10, mat=METAL)
    st.spike(bottom, 0.08, -0.3, IRON, sides=6, mat=METAL)
    st.blob(bottom - up * 0.02, (0.13, 0.13, 0.1), SILVER, segments=8, rings=5, mat=METAL)
    # a ribbon of grave linen knotted under the cradle
    kn = top - up * 1.12
    for k, ln in ((0, 0.9), (1, 0.65)):
        sx = (k * 2 - 1)
        st.tube([kn + Vector((0.06 * sx, 0, 0)), kn + Vector((0.12 * sx, 0.04, -ln * 0.5)), kn + Vector((0.18 * sx, 0.1, -ln))],
                [0.06, 0.05, 0.012], LINEN_DARK, sides=4, squash=0.25, mat=MEMBRANE)
    # the gothic cradle: two iron arms rising to a pointed arch, the bell hung between them
    cb = top - up * 0.95
    st.blob(cb, (0.22, 0.2, 0.16), SILVER, segments=10, rings=6, mat=METAL)
    for s in (-1, 1):
        arm_pts = [cb + Vector((s * 0.08, 0, 0.05)), cb + Vector((s * 0.46, 0, 0.35)), cb + Vector((s * 0.5, 0, 0.72)),
                   cb + Vector((s * 0.36, 0, 0.98)), cb + Vector((s * 0.12, 0, 1.08)), top + up * 0.13]
        st.tube(arm_pts, [0.05, 0.05, 0.048, 0.045, 0.042, 0.04], IRON, sides=7, mat=METAL)
        for k, t in enumerate((0.3, 0.55, 0.8)):
            p = arm_pts[1].lerp(arm_pts[3], t)
            st.spike(p, 0.025, 0.16, IRON_HI, sides=4, lean=(s * 0.12, 0), mat=METAL)
        st.skull(tuple(cb + Vector((s * 0.52, -0.02, 0.55))), size=0.1, yaw=0, color=BONE_OLD)
    st.tube([cb + Vector((-0.44, 0, 0.62)), cb + Vector((0.44, 0, 0.62))], [0.035, 0.035], IRON_HI, sides=6, mat=METAL)
    st.blob(top + up * 0.12, (0.11, 0.11, 0.11), SILVER, segments=8, rings=6, mat=METAL)            # the crest hinge
    bl = part('Bell', 'Bell', smooth=True)
    pv = Vector(BELL_PIVOT)
    bl.tube([pv + Vector((0, 0, 0.02)), pv - Vector((0, 0, 0.1))], [0.04, 0.04], IRON, sides=6, mat=METAL)
    bl.lathe(tuple(pv - Vector((0, 0, 0.56))), [(0.27, 0.0), (0.25, 0.04), (0.2, 0.14), (0.16, 0.3), (0.15, 0.4),
                                                 (0.12, 0.45), (0.0, 0.47)], 18, BRONZE, mat=METAL)
    bl.lathe(tuple(pv - Vector((0, 0, 0.56))), [(0.275, 0.0), (0.28, 0.02), (0.26, 0.045)], 18, VERDI, mat=METAL)
    for k in range(6):
        a = math.tau * k / 6
        bl.blob(pv - Vector((0, 0, 0.36)) + Vector((math.cos(a) * 0.17, math.sin(a) * 0.17, 0)), (0.05, 0.05, 0.05),
                VERDI, segments=6, rings=4, mat=METAL)
    bl.skull(tuple(pv - Vector((0, 0.19, 0.42))), size=0.1, color=BONE_OLD)
    bl.tube([pv - Vector((0, 0, 0.12)), pv - Vector((0, 0, 0.5))], [0.018, 0.018], IRON, sides=5, mat=METAL)
    bl.blob(pv - Vector((0, 0, 0.53)), (0.07, 0.07, 0.08), IRON_HI, segments=8, rings=5, mat=METAL)   # clapper
    bl.blob(pv - Vector((0, 0, 0.44)), (0.16, 0.16, 0.08), SOUL, mat=GLOW, segments=10, rings=5)     # soul light in its throat
    for tag, t_a, t_b, dx in (('Blade1', 0.0, BLADE_MID, 0.0), ('Blade2', BLADE_MID, 1.0, 0.045)):
        bp = part(tag, tag, smooth=True)
        nseg = 10
        spine = [Vector(APEX) + blade_curve(t_a + (t_b - t_a) * i / nseg) + Vector((dx, 0, 0)) for i in range(nseg + 1)]
        secs = []
        for i, pnt in enumerate(spine):
            t = t_a + (t_b - t_a) * i / nseg
            tang = (spine[min(nseg, i + 1)] - spine[max(0, i - 1)]).normalized()
            width = 0.5 * (1 - t) ** 0.65 + 0.03
            secs.append((tuple(pnt + Vector((0, 0, -width * 0.5))), 0.034 * (1 - 0.6 * t) + 0.007, width * 0.5, 2.2,
                         tuple(tang)))
        bp.loft(secs, IRON, sides=10, mat=METAL)
        edge = [pnt + Vector((0, 0, -(0.5 * (1 - (t_a + (t_b - t_a) * i / nseg)) ** 0.65 + 0.03))) for i, pnt in enumerate(spine)]
        bp.tube(edge, [0.034 * (1 - 0.7 * (t_a + (t_b - t_a) * i / nseg)) + 0.008 for i in range(nseg + 1)], SOUL,
                mat=GLOW, sides=5)
        for i in (2, 5, 8):
            bp.spike(spine[i] + Vector((0, 0, 0.02)), 0.05, 0.17, IRON_HI, sides=4, lean=(0, 0.05), mat=METAL)
        rn = [pnt + Vector((0.038, 0, -0.16 * (1 - (t_a + (t_b - t_a) * i / nseg)))) for i, pnt in enumerate(spine)]
        bp.tube(rn, [0.012] * len(rn), SOUL_DEEP, mat=GLOW, sides=4)
        bp.blob(spine[0], (0.13, 0.1, 0.13), SILVER, segments=8, rings=6, mat=METAL)
        if tag == 'Blade1':
            bp.skull(tuple(spine[0] + Vector((0, -0.06, 0.1))), size=0.12, color=BONE)
    # --- the soul smoke the shroud dissolves into ----------------------------------------------
    def wisp(p, k, count, top, bottom, r_out, turns, width, col_top, col_low, alpha, phase=0.0):
        a0 = math.tau * k / count + phase + 0.35 * math.sin(k * 3.1)
        n = 18
        rows = []
        for i in range(n + 1):
            t = i / n
            z = top - t * (top - bottom)
            a = a0 + t * turns
            prof = r_out * (0.22 + 0.78 * math.sin(math.pi * 0.5 * max(0.0, min(1.0, (z - bottom) / max(0.2, top - bottom)))) ** 0.8)
            rr = prof + 0.06 * math.sin(t * 7 + k * 1.7)
            c = Vector((math.sin(a) * rr, -math.cos(a) * rr, z))
            radial = Vector((math.sin(a), -math.cos(a), 0))
            tang = Vector((math.cos(a), math.sin(a), 0)) * rr * turns + Vector((0, 0, -(top - bottom)))
            side = tang.normalized().cross(radial).normalized()
            w = width * (0.35 + 0.65 * math.sin(math.pi * min(1.0, t * 1.1 + 0.05))) * (1.0 - 0.35 * t)
            bow = radial * w * 0.25
            fade = min(1.0, t / 0.18) * (1.0 - t) ** 1.3
            col = lerp(col_top, col_low, t ** 1.2)
            rows.append((c - side * w * 0.5, c + bow, c + side * w * 0.5, col, alpha * fade))
        verts = []
        for l_, m_, r_, col, al in rows:
            verts.append((p.bm.verts.new(l_), p.bm.verts.new(m_), p.bm.verts.new(r_), col, al))
        for i in range(n):
            for j in range(2):
                q = (verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j])
                f = p.bm.faces.new(q)
                f.material_index = SMOKE_MAT
                for lp in f.loops:
                    row = i if lp.vert in verts[i][:3] else i + 1
                    col_ = verts[row][3]
                    edge = lp.vert is verts[row][0] or lp.vert is verts[row][2]
                    lp[p.col] = (*col_, 0.0 if edge else verts[row][4])

    ink = SMOKE_DARK
    murk = lerp(SMOKE, SOUL_DEEP, 0.18)
    sm = part('Smoke', 'Smoke', smooth=True)
    for k in range(16):
        wisp(sm, k, 16, top=1.95 - 0.12 * (k % 3), bottom=0.05 + 0.05 * (k % 2), r_out=1.0, turns=2.5 + 0.35 * (k % 3),
             width=0.42 + 0.1 * (k % 2), col_top=lerp(murk, SMOKE, 0.3 * (k % 2)), col_low=ink, alpha=0.58)
    for k in range(8):
        wisp(sm, k, 8, top=1.6, bottom=0.25, r_out=1.18, turns=1.9, width=0.8, col_top=lerp(murk, ink, 0.4),
             col_low=ink, alpha=0.24, phase=0.3)
    si = part('SmokeIn', 'SmokeIn', smooth=True)
    for k in range(8):
        wisp(si, k, 8, top=1.85, bottom=0.12, r_out=0.6, turns=-2.8, width=0.4, col_top=lerp(SMOKE, SOUL_DEEP, 0.55),
             col_low=lerp(ink, SOUL_DEEP, 0.3), alpha=0.55, phase=0.2)
    # threads of soul light turning inside the smoke (on the body mesh, not the smoke's)
    si = part('SoulThreads', 'SmokeIn', smooth=True)
    for k in range(5):
        a0 = math.tau * k / 5 + 0.4 + 0.5 * math.sin(k * 2.3)
        pts = []
        for i in range(12):
            t = i / 11
            a = a0 - t * (3.0 + 0.6 * (k % 3))
            r = 0.12 + (0.26 + 0.06 * (k % 2)) * math.sin(t * math.pi) + 0.04 * math.sin(t * 9 + k)
            pts.append(Vector((math.sin(a) * r, -math.cos(a) * r, 0.85 + t * (1.15 + 0.12 * (k % 3)))))
        si.tube(pts, [0.003 + 0.011 * math.sin(t * math.pi) for t in (i / 11 for i in range(12))],
                [lerp(SOUL_DEEP, SOUL, math.sin(t * math.pi)) for t in (i / 11 for i in range(12))], mat=GLOW, sides=4)
    return parts


def mozzetta_spar(k):
    """The shoulder cape's k-th spar, just outside the cope's own (chas_spar):
    collar, shoulder, hem. Open over the ribs like the cope."""
    th, st = chas_spar(k)
    sx, cy = math.sin(th), math.cos(th)
    front = max(0.0, -cy)
    return th, [
        (sx * 0.5, cy * 0.38 + 0.03, 4.08),
        (sx * 0.86, cy * 0.55 + 0.05, 4.0),
        (sx * 1.05, cy * 0.67 + 0.08, 3.7 + front * 0.1),
        (sx * 1.11, cy * 0.73 + 0.1, 3.38 + front * 0.24),
    ]


def build_membranes():
    mems = []
    # The shroud: from the waist it flares over the hips and hangs in long rags, slit to
    # the knee, the soul smoke churning out between and under them.
    skirt = Membrane('Shroud', SHROUD, seed=17)
    spars = []
    for k in range(SKIRT):
        st = skirt_spar(k)
        a0, a1 = Vector(st[0]), Vector(st[1])
        b1, c1 = Vector(st[2]), Vector(st[3])
        spars.append([(tuple(a0), 'Hips'), (tuple(a0.lerp(a1, 0.5)), f'Skirt{k}a'), (tuple(a1), f'Skirt{k}a'),
                      (tuple(a1.lerp(b1, 0.5)), f'Skirt{k}b'), (tuple(b1), f'Skirt{k}b'),
                      (tuple(b1.lerp(c1, 0.5)), f'Skirt{k}c'), (tuple(c1), f'Skirt{k}c')])
    for k in range(SKIRT):
        skirt.panel(spars[k], spars[(k + 1) % SKIRT], rows=18, cols=6, scallop=0.12, tear=1.35, shade=0.95,
                    reach=0.82)
    for i, (co, _) in enumerate(skirt.verts):
        k = max(0.0, min(1.0, (2.0 - co.z) / 1.6))
        skirt.cols_rgb[i] = lerp(skirt.cols_rgb[i], lerp(SMOKE_DARK, lerp(SMOKE, SOUL_DEEP, 0.2), k), k ** 1.4 * 0.8)
    mems.append(skirt)
    # The cope: collar to a torn hem over the shoulders, open over the ribs, trailing.
    cope = Membrane('Cope', COPE, seed=23)
    cs = []
    for k in range(CHAS):
        th, st = chas_spar(k)
        sx = math.sin(th)
        mid_bone = f'Chas{k}a'
        if abs(sx) > 0.7:
            mid_bone = 'Arm.L' if sx > 0 else 'Arm.R'
        a3, a4 = Vector(st[3]), Vector(st[4])
        tail = a4 + (a4 - a3) * 0.45
        cs.append([(st[0], 'Neck'), (st[1], 'Chest'), (st[2], mid_bone), (st[3], f'Chas{k}b'), (st[4], f'Chas{k}c'),
                   (tuple(tail), f'Chas{k}c')])
    for k in range(CHAS - 1):
        cope.panel(cs[k], cs[k + 1], rows=20, cols=5, scallop=0.04, tear=1.1, shade=0.95, sag=0.04)
    # The orphrey: a band of grave linen down the cope's back; the front edges in linen too.
    for i, (co, w) in enumerate(cope.verts):
        th = math.atan2(co.x, co.y + 0.001)
        if abs(th) < 0.06 and co.z < 3.75:
            cope.cols_rgb[i] = LINEN_DARK
        elif abs(th) < 0.1 and co.z < 3.75:
            cope.cols_rgb[i] = lerp(cope.cols_rgb[i], SILVER, 0.5)
        elif abs(abs(th) - math.radians(150)) < 0.05:
            cope.cols_rgb[i] = lerp(cope.cols_rgb[i], LINEN_DARK, 0.75)
        if co.z < 1.4:
            cope.cols_rgb[i] = lerp(cope.cols_rgb[i], COPE_DARK, min(1.0, (1.4 - co.z) / 0.8) * 0.7)
    mems.append(cope)
    # The mozzetta: a short shoulder cape over the cope, ragged at its hem, its sides
    # riding the upper arms so a raised arm lifts it.
    moz = Membrane('Mozzetta', COPE, seed=31)
    ms = []
    for k in range(CHAS):
        th, st = mozzetta_spar(k)
        sx = math.sin(th)
        mid = 'Chest'
        hem = f'Chas{k}a'
        if abs(sx) > 0.6:
            hem = 'Arm.L' if sx > 0 else 'Arm.R'
        if abs(sx) > 0.85:
            mid = hem
        ms.append([(st[0], 'Chest'), (st[1], 'Chest'), (st[2], mid), (st[3], hem)])
    for k in range(CHAS - 1):
        moz.panel(ms[k], ms[k + 1], rows=14, cols=8, scallop=0.03, tear=0.22, shade=0.9, sag=0.012)
    for i, (co, w) in enumerate(moz.verts):
        moz.cols_rgb[i] = lerp(moz.cols_rgb[i], SHROUD_HI, 0.35)
    mems.append(moz)
    # The stole: two long bands of grave linen from the collar down either side of the
    # open ribs, over the cincture and down the shroud's flare to a fringed end.
    for s, tag in ((1, 'L'), (-1, 'R')):
        stole = Membrane('Stole' + tag, LINEN, seed=41 + s)
        sk = 1 if s > 0 else SKIRT - 1
        inner, outer = [], []
        for x0, side in ((0.26, inner), (0.42, outer)):
            for (x, y, z), bone in (((x0 - 0.06, -0.36, 4.02), 'Chest'), ((x0 - 0.01, -0.5, 3.72), 'Chest'),
                                    ((x0, -0.54, 3.3), 'Chest'), ((x0 - 0.01, -0.5, 2.9), 'Spine'),
                                    ((x0 - 0.03, -0.5, 2.52), 'Hips'), ((x0 - 0.02, -0.72, 2.08), f'Skirt{sk}a'),
                                    ((x0 - 0.01, -0.9, 1.68), f'Skirt{sk}a'), ((x0, -0.86, 1.3), f'Skirt{sk}b')):
                side.append(((s * x, y, z), bone))
        stole.panel(inner, outer, rows=24, cols=3, scallop=0.0, tear=0.0, shade=1.0)
        for i, (co, w) in enumerate(stole.verts):
            col = i % 4
            if col in (0, 3):
                stole.cols_rgb[i] = SILVER
            elif co.z < 1.45:
                stole.cols_rgb[i] = LINEN_DARK
        mems.append(stole)
    return mems


def build_stole_sigils():
    """The soul-lit sigils sewn down the stole and its fringe, on the bones the stole
    rides there (the stole is a membrane; these are small glow plates over it)."""
    parts = []
    for s in (1, -1):
        sk = 1 if s > 0 else SKIRT - 1
        for z, y, bone in ((3.56, -0.535, 'Chest'), (3.12, -0.535, 'Chest'), (2.72, -0.515, 'Spine'),
                           (1.86, -0.835, f'Skirt{sk}a'), (1.5, -0.905, f'Skirt{sk}b')):
            p = Part(f'Sigil{z}{s}', bone, smooth=True)
            c = Vector((s * 0.335, y - 0.01, z))
            lid = [c + Vector((0.05 * math.cos(a), 0, -0.022 * math.sin(a) + 0.01)) for a in
                   (math.pi * j / 8 for j in range(9))]
            p.tube(lid, [0.0075] * 9, SOUL, mat=GLOW, sides=4)
            for j in (-1, 0, 1):
                b0 = c + Vector((0.026 * j, 0, -0.016 + 0.004 * abs(j)))
                p.tube([b0, b0 + Vector((0.012 * j, 0, -0.03))], [0.0055, 0.002], SOUL, mat=GLOW, sides=4)
            p.tube([c + Vector((0, 0, 0.03)), c + Vector((0, 0, 0.07))], [0.006, 0.002], SOUL_DEEP, mat=GLOW, sides=4)
            parts.append(p)
        # the fringe and a silver weight at the end
        p = Part(f'StoleEnd{s}', f'Skirt{sk}b', smooth=True)
        e = Vector((s * 0.34, -0.87, 1.27))
        p.tube([e + Vector((-0.09, 0, 0)), e + Vector((0.09, 0, 0))], [0.022, 0.022], SILVER, sides=6, mat=METAL)
        for j in range(7):
            x = -0.075 + 0.025 * j
            p.tube([e + Vector((x, 0, -0.01)), e + Vector((x, -0.01, -0.13 - 0.04 * (j % 3)))], [0.008, 0.004],
                   LINEN_DARK, sides=4)
        parts.append(p)
    return parts


# -------------------------------------------------------------------- posing
class RollRig(Rig):
    """The organic kit's Rig with a roll about each aimed bone's own axis
    (`rolls` {bone: degrees}): the staff has to keep its crest and blade facing
    the way the swing goes, which a bare aim cannot say."""

    def pose(self, aims=None, ik=None, turns=None, root=(0, 0, 0), rolls=None, scales=None, absolute=None):
        absolute = dict(absolute or {})
        aims = self._mirror({k: Vector(v) for k, v in (aims or {}).items()}, 'aim')
        turns = self._mirror(turns or {}, 'turns')
        rolls = dict(rolls or {})
        ik = dict(ik or {})
        for k, (u, lo, tgt, pole) in list(ik.items()):
            if u.endswith('.L') and (k[:-2] + '.R') not in ik and k.endswith('.L'):
                t = Vector(tgt)
                p = Vector(pole)
                ik[k[:-2] + '.R'] = (u[:-2] + '.R', lo[:-2] + '.R', (-t.x, t.y, t.z), (-p.x, p.y, p.z))
        ik_upper = {u: (lo, Vector(tgt), Vector(pole)) for u, lo, tgt, pole in ik.values()}
        delta, head, out = {}, {}, {}
        for name, parent, h, t in self.bones:
            rh, rt = self.rest[name]
            if parent:
                ph = self.rest[parent][0]
                head[name] = head[parent] + delta[parent] @ (rh - ph)
                dp = delta[parent]
            else:
                head[name] = rh + Vector(root)
                dp = Quaternion()
            if name in ik_upper:
                lo, tgt, pole = ik_upper[name]
                l1 = (rt - rh).length
                l2 = (self.rest[lo][1] - self.rest[lo][0]).length
                d1, d2 = two_bone(head[name], l1, l2, tgt, pole)
                aims[name] = d1
                aims[lo] = d2
            q = Quaternion()
            if name in absolute:
                q = dp.inverted() @ absolute[name]
            elif name in aims:
                r0 = (rt - rh).normalized()
                want = dp.inverted() @ aims[name].normalized()
                q = r0.rotation_difference(want)
                if name in rolls:
                    q = Quaternion(want, math.radians(rolls[name])) @ q
            for a, deg in turns.get(name, []):
                q = Quaternion(Vector(a) if not isinstance(a, str) else
                               {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[a],
                               math.radians(deg)) @ q
            delta[name] = dp @ q
            rest_m = self.rest_matrix(name)
            out[name] = (rest_m.inverted() @ q.to_matrix() @ rest_m).to_quaternion()
        out['__root'] = Vector(root)
        out['__scale'] = dict(scales or {})
        out['__head'] = head
        out['__delta'] = delta
        return out


def key_pose(arm, pose, frame, flicker=None):
    flicker = FLICKER if flicker is None else flicker
    scales = pose.get('__scale', {})
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        q = pose.get(pb.name)
        pb.rotation_quaternion = q if q is not None else (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        s = scales.get(pb.name, 1.0)
        pb.scale = (s, s, s) if isinstance(s, (int, float)) else s
    rb = arm.pose.bones.get('Root')
    root = pose.get('__root')
    if rb is not None and root is not None:
        rb.location = rb.bone.matrix_local.to_3x3().inverted() @ root
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)
        if pb.name not in flicker:
            pb.keyframe_insert('scale', frame=frame)


def _hash(i, j):
    x = math.sin(i * 12.9898 + j * 78.233) * 43758.5453
    return x - math.floor(x)


def clip(arm, name, keys, loop_clip=True, fire=None, flicker=None):
    """keys: [(frame, pose)]; `fire` [(frame, level)] drives the flames' and the
    soul fire's flicker size (1 = burning as at rest, 0 = snuffed)."""
    import bpy
    from creature_kit import _fcurves
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    bones = FLAMES + ['SoulFire'] if flicker is None else list(flicker)
    for frame, pose in keys:
        key_pose(arm, pose, frame, set(bones))
    # Quaternion continuity (v2): q and -q are the same turn, but the curves interpolate the
    # four components, so a key on the far hemisphere from the one before makes an arm bone
    # spin the long way round between them (a fist or forearm flip in a frame or two). Each key
    # is flipped onto the previous key's hemisphere: every key pose stays exactly what it
    # was, only the in-betweens take the short way.
    quat = {}
    for fc in _fcurves(act):
        # only the arm chain: the smoke, the soul ring and the blade's hinge turn past half a
        # circle between keys on purpose and keep their long way round
        if fc.data_path.endswith('rotation_quaternion') and any(
                f'"{b}' in fc.data_path for b in ('Arm.', 'Fore.', 'Hand.')):
            quat.setdefault(fc.data_path, {})[fc.array_index] = fc
    for chans in quat.values():
        if len(chans) != 4:
            continue
        fcs = [chans[i] for i in range(4)]
        n = len(fcs[0].keyframe_points)
        prev = None
        for k in range(n):
            q = [fc.keyframe_points[k].co[1] for fc in fcs]
            if prev is not None and sum(a * b for a, b in zip(prev, q)) < 0:
                q = [-c for c in q]
                for fc, c in zip(fcs, q):
                    fc.keyframe_points[k].co[1] = c
            prev = q
        for fc in fcs:
            fc.update()
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'
    # The flicker: the flames and the soul fire breathe on their own bones.
    start, end = keys[0][0], keys[-1][0]
    fire = fire or [(start, 1.0), (end, 1.0)]

    def level(f):
        for (fa, la), (fb, lb) in zip(fire, fire[1:]):
            if fa <= f <= fb:
                return la + (lb - la) * (f - fa) / max(1, fb - fa)
        return fire[-1][1] if f > fire[-1][0] else fire[0][1]

    seed = sum(ord(c) for c in name)
    for f in range(start, end + 1, 2):
        lv = level(f)
        last = f + 2 > end
        ff = start if (loop_clip and last) else f
        for bi, bname in enumerate(bones):
            pb = arm.pose.bones[bname]
            j = _hash(seed + bi * 7, ff)
            k = _hash(seed + bi * 13 + 3, ff)
            if bname == 'SoulFire':
                s = (0.9 + 0.22 * j) * lv
                pb.scale = (s * (0.95 + 0.1 * k), s * (0.95 + 0.1 * k), s * (0.88 + 0.3 * j))
            else:
                s = max(0.001, lv) * (0.82 + 0.3 * j)
                pb.scale = (s * (0.9 + 0.15 * k), s * (0.9 + 0.15 * k), s * (0.85 + 0.45 * j))
            pb.keyframe_insert('scale', frame=f)
        if last and f != end:
            for bname in bones:
                arm.pose.bones[bname].keyframe_insert('scale', frame=end)
    for fc in _fcurves(act):
        if any(f'"{b}"' in fc.data_path for b in bones):
            if fc.data_path.endswith('scale'):
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
    return act


def staff_quat(d, face):
    """The world turn of the staff, and so of the right fist that is locked to it:
    the shaft (rest +Z) along `d`, the crest and blade (rest -Y) toward `face`."""
    z1 = _n(d)
    f = Vector(face) - z1 * z1.dot(Vector(face))
    if f.length < 1e-4:
        f = z1.orthogonal()
    y1 = -f.normalized()
    x1 = y1.cross(z1).normalized()
    return Matrix((x1, y1, z1)).transposed().to_quaternion()


def left_grip_quat(d, psi):
    """The left fist closed round the shaft (its bar axis, the thumb side, up the
    shaft toward the head), turned `psi` radians round it."""
    a1 = _n(d)
    e1 = a1.orthogonal().normalized()
    e2 = a1.cross(e1).normalized()
    h1 = e1 * math.cos(psi) + e2 * math.sin(psi)
    n1 = -(a1.cross(h1)).normalized()
    r0 = Matrix((H_L, A_L, N_L)).transposed()
    r1 = Matrix((h1, a1, n1)).transposed()
    return (r1 @ r0.transposed()).to_quaternion()


def _toward(a, b, max_deg):
    """`b` pulled back toward `a` so the two are at most `max_deg` apart."""
    ang = a.angle(b)
    if ang <= math.radians(max_deg):
        return b
    k = math.radians(max_deg) / ang
    return (a * (1 - k) + b * k).normalized()


DIAG = []   # (clip, frame, right wrist bend, left wrist bend, right grip gap, left grip gap, staff vs fist)


def make_clips(arm):
    rig = RollRig(BONES).attach(arm)
    P = rig.pose
    clips = []
    l_up = (REST['Arm.R'][1] - REST['Arm.R'][0]).length
    l_fore_r = (REST['Fore.R'][1] - REST['Fore.R'][0]).length
    l_fore_l = (REST['Fore.L'][1] - REST['Fore.L'][0]).length
    fr_r = (WRIST_R - ELBOW_R).normalized()
    fr_l = (WRIST_L - ELBOW_L).normalized()
    head_rest = (REST['Head'][1] - REST['Head'][0]).normalized()
    neck_rest = (REST['Neck'][1] - REST['Neck'][0]).normalized()

    def add(name, keys, loop_clip=True, fire=None):
        for f, pose in keys:
            dg = pose.get('__diag')
            if dg:
                DIAG.append((name, f) + dg)
        clip(arm, name, keys, loop_clip, fire)
        clips.append(name)

    def solve(sh, l1, l2, wrist, pole):
        d1, d2 = two_bone(sh, l1, l2, wrist, pole)
        over = max(0.0, (wrist - sh).length - 0.995 * (l1 + l2))
        return d1, d2, over

    def stance(root=(0, 0, 0), yaw=0.0, tilt=0.0, lean=0.0, side=0.0, twist=0.0, look=(0, -1, 0.0), jaw=8.0,
               grip=(-1.02, -0.78, 3.0), staff=(0.05, -0.12, 1.0), face=(-0.25, -1.0, 0.0), face_tol=35.0,
               both=False, grip2=GRIP2, left=(1.18, -0.72, 2.25), left_hand=None, left_pole=(1.2, 0.4, -0.4),
               right_pole=(-1.2, 0.5, -0.4), flutter=0.0, stream=0.0, splay=0.0, cape=0.0, crumple=0.0, souls=0.0,
               souls_ring=1.0, swirl=0.0, bell=(0.0, 0.0), blade=(0.0, 0.0), book=None, book_sway=(0.0, 0.0),
               lid=0.0, comfort=0.9):
        """One pose, body first. The torso (`lean`, `side`, `twist` degrees through
        the spine and chest), the whole floating body (`root`, `yaw` and `tilt`
        degrees) and the arms carry the weapon; the staff is never turned against
        the fist. The weapon is placed in the body's own frame: the right fist's
        grip at `grip`, the shaft along `staff`, the crest and blade toward `face`
        (free to turn `face_tol` degrees round the shaft to keep the wrist
        natural). With `both` the left fist closes round the shaft `grip2` below."""
        aims = {
            'Spine': (side * 0.4, -0.07 - lean * 0.6, 1.0),
            'Chest': (side * 0.6, -0.08 - lean, 1.0),
            'Neck': tuple(neck_rest + Vector((look[0] * 0.3, 0.0, look[2] * 0.3))),
            'Head': tuple(head_rest + Vector((look[0], 0.0, look[2] * 1.2))),
            'Souls': (0.0, 0.0, 1.0),
            'Smoke': (0.0, 0.35 * stream, 1.0),
            'SmokeIn': (0.0, 0.3 * stream, 1.0),
        }
        absolute = {}
        bx, by = book_sway
        if book is None:
            dn = _n((0.1 * math.sin(math.radians(bx)) + 0.02, 0.35 * math.sin(math.radians(by)) + 0.1 * stream, -1.0))
            aims['Chain1'] = tuple(dn)
            aims['Chain2'] = tuple(_n(dn + Vector((0.05 * math.sin(math.radians(bx)), 0.05 * stream, 0))))
            aims['Book'] = tuple(_n(dn + Vector((0.08 * math.sin(math.radians(bx)), 0.08 * stream, 0))))
        else:
            aims['Chain1'] = tuple(_n((0.05 + 0.05 * math.sin(math.radians(bx)), -0.2, 1.0)))
            aims['Chain2'] = tuple(_n((0.0, -0.3 + 0.05 * math.sin(math.radians(by)), 1.0)))
            absolute['Book'] = Quaternion(Vector((0, 0, 1)), math.radians(bx * 0.3)) @ BOOK_OPEN
        turns = {
            'Root': [('x', tilt), ('z', yaw)],
            'Spine': [('z', twist * 0.4)],
            'Chest': [('z', twist * 0.6)],
            'Jaw': [('x', jaw)],
            'Souls': [('z', souls)],
            'Smoke': [('z', swirl)],
            'SmokeIn': [('z', -swirl * 1.4)],
            'Blade1': [('x', -100.0 * (1 - blade[0]))],
            'Blade2': [('x', 172.0 * (1 - blade[1]))],
            'BookLid': [('y', -lid * 165.0)],
        }
        for k in range(SKIRT):
            a = math.tau * k / SKIRT
            fwd = -math.cos(a)
            ph = flutter + k * 0.9
            ax = (math.cos(a), math.sin(a), 0)
            sw_ = 4.0 * math.sin(ph) + stream * 12.0 * fwd + splay * 18.0 + crumple * 30
            turns[f'Skirt{k}a'] = [(ax, sw_ * 0.5 + splay * 8)]
            turns[f'Skirt{k}b'] = [(ax, sw_ * 0.7 + 3.0 * math.sin(ph * 1.3) - crumple * 20),
                                   ('z', 6 * math.sin(ph + swirl * 0.02))]
            turns[f'Skirt{k}c'] = [(ax, sw_ * 0.9 + 5.0 * math.sin(ph * 1.7) - crumple * 25),
                                   ('z', 14 * math.sin(ph * 0.8) + swirl * 0.1)]
        for k in range(CHAS):
            th, _ = chas_spar(k)
            ph = flutter * 1.2 + k * 1.1
            back = max(0.0, math.cos(th))
            ax = (math.cos(th), -math.sin(th), 0)
            lift = cape + stream * 0.9
            turns[f'Chas{k}a'] = [(ax, -3 * lift * back - 1.5 * math.sin(ph) - splay * 6 - crumple * 10)]
            turns[f'Chas{k}b'] = [(ax, -8 * lift * back - 3 * math.sin(ph + 0.6) - splay * 8 + crumple * 25)]
            turns[f'Chas{k}c'] = [(ax, -12 * lift * back - 5 * math.sin(ph + 1.2) - splay * 10 + crumple * 30)]
        scales = {'Souls': souls_ring, 'Blade1': 0.42 + 0.58 * min(1.0, blade[0])}
        # pass one: the body alone, to find where the shoulders went
        first = P(aims=dict(aims), turns=turns, root=root, rolls={}, scales=scales, absolute=dict(absolute))
        heads, deltas = first['__head'], first['__delta']
        rr = deltas['Root']
        at = heads['Root']
        sh_r, sh_l = heads['Arm.R'], heads['Arm.L']
        gw = at + rr @ Vector(grip)
        dw = (rr @ _n(staff)).normalized()
        fw = rr @ Vector(face)
        pole_r = rr @ Vector(right_pole)
        pole_l = rr @ Vector(left_pole)
        q0 = staff_quat(dw, fw)
        best = None
        for step in range(-int(face_tol), int(face_tol) + 1, 5):
            q = Quaternion(dw, math.radians(step)) @ q0
            # the arm comfortable: the elbow where a straight wrist puts it, pulled onto
            # the upper arm's reach; the weapon gives way to the body, not the wrist
            e_want = gw + q @ (ELBOW_R - GRIP)
            e_ok = sh_r + (e_want - sh_r).normalized() * l_up
            g = gw.lerp(e_ok - q @ (ELBOW_R - GRIP), comfort)
            wrist = g + q @ (WRIST_R - GRIP)
            # bend the elbow toward where the straight wrist wants it
            pole = pole_r.normalized().lerp((wrist - q @ fr_r * l_fore_r - sh_r).normalized(), comfort)
            _, d2, over = solve(sh_r, l_up, l_fore_r, wrist, pole)
            bend = math.degrees(d2.angle(q @ fr_r))
            score = bend + 0.12 * abs(step) + 25.0 * (g - gw).length + over * 400
            if best is None or score < best[0]:
                best = (score, q, wrist, bend, g, pole)
        _, q_r, wrist_r, bend_r, gw, pole_r = best
        absolute['Hand.R'] = q_r
        # the bell hangs in its cradle: gravity down, swung by `bell`, never through the arch
        down = (Quaternion(Vector((1, 0, 0)), math.radians(bell[0]))
                @ Quaternion(Vector((0, 1, 0)), math.radians(bell[1])) @ Vector((0, 0, -1)))
        aims['Bell'] = tuple(_toward(-dw, down, 70.0))
        bend_l = 0.0
        if both:
            bestl = None
            for slide in (-0.2, -0.15, -0.1, -0.05, 0.0, 0.05, 0.1, 0.15):
                gl = gw - dw * (grip2 + slide)
                for step in range(0, 360, 5):
                    q = left_grip_quat(dw, math.radians(step))
                    wrist = gl + q @ (WRIST_L - GRIP_L)
                    pole = pole_l.normalized().lerp((wrist - q @ fr_l * l_fore_l - sh_l).normalized(), comfort)
                    _, d2, over = solve(sh_l, l_up, l_fore_l, wrist, pole)
                    bend = math.degrees(d2.angle(q @ fr_l))
                    score = bend + 20.0 * abs(slide) + over * 600
                    if bestl is None or score < bestl[0]:
                        bestl = (score, q, wrist, bend, pole)
            _, q_l, wrist_l, bend_l, pole_l = bestl
            absolute['Hand.L'] = q_l
        else:
            wrist_l = at + rr @ Vector(left)
            hand_dir = left_hand if left_hand is not None else (
                (0.2, -0.7, 0.35) if book is not None else (0.12, -0.35, -1.0))
            aims['Hand.L'] = tuple(rr @ _n(hand_dir))
        ik = {'arm.R': ('Arm.R', 'Fore.R', tuple(wrist_r), tuple(pole_r)),
              'arm.L': ('Arm.L', 'Fore.L', tuple(wrist_l), tuple(pole_l))}
        out = P(aims=aims, ik=ik, turns=turns, root=root, rolls={}, scales=scales, absolute=absolute)
        hd, dl = out['__head'], out['__delta']
        got_r = hd['Hand.R'] + dl['Hand.R'] @ (GRIP - WRIST_R)
        gap_r = (got_r - gw).length
        gap_l = 0.0
        if both:
            got_l = hd['Hand.L'] + dl['Hand.L'] @ (GRIP_L - WRIST_L)
            rel = got_l - gw
            gap_l = (rel - dw * rel.dot(dw)).length
        rel_q = dl['Hand.R'].inverted() @ dl['Staff']
        staff_rel = math.degrees(2 * math.acos(min(1.0, abs(rel_q.w))))
        out['__diag'] = (round(bend_r, 1), round(bend_l, 1), round(gap_r, 3), round(gap_l, 3), round(staff_rel, 2))
        return out

    # ------------------------------------------------------------------ the two stances
    staff_hold = dict(grip=(-1.0, -0.8, 2.7), staff=(0.05, -0.12, 1.0), face=(-0.25, -1.0, 0.0))
    scythe_hold = dict(both=True, grip=(-0.32, -1.02, 3.5), staff=(-0.36, -0.08, 1.0), face=(0.35, -1.0, 0.0),
                       blade=(1.0, 1.0), left_pole=(1.0, 0.2, -0.8), right_pole=(-1.2, 0.3, -0.6))

    def rest(ph, scythe, **kw):
        """The standing hover at phase `ph` (radians) in either stance."""
        base = dict(root=(0, 0, 0.1 * math.sin(ph)), flutter=ph, souls=math.degrees(ph) / 4, swirl=math.degrees(ph) / 4,
                    look=(0.06 * math.sin(ph * 0.5), -1, 0.05), jaw=9 + 3 * math.sin(ph * 2),
                    bell=(6 * math.sin(ph + 0.8), 4 * math.sin(ph * 0.5)),
                    book_sway=(6 * math.sin(ph + 1.4), 5 * math.sin(ph)),
                    lean=0.04 * math.sin(ph + 0.6), side=0.03 * math.sin(ph * 0.5))
        hold = dict(scythe_hold if scythe else staff_hold)
        # the held weapon breathes a little behind the body's bob
        hold['grip'] = tuple(Vector(hold['grip']) + Vector((0.0, 0.0, 0.04 * math.sin(ph - 0.9))))
        base.update(hold)
        if scythe:
            base.update(lean=0.08 + 0.03 * math.sin(ph + 0.6), look=(0.08 * math.sin(ph * 0.5), -1, 0.0))
        base.update(kw)
        return stance(**base)

    for scythe, pre in ((False, ''), (True, 'Scythe')):
        keys = []
        for i in range(8):
            ph = math.tau * i / 8
            keys.append((1 + i * 8, rest(ph, scythe, souls=45 * i, swirl=45 * i)))
        keys.append((65, rest(0.0, scythe, souls=360 - 1e-3, swirl=360 - 1e-3)))
        add(pre + 'Idle' if pre else 'Idle', keys)
        # The glide: leaning into it, the weapon trailing at his side.
        if scythe:
            glide = dict(lean=0.35, stream=0.8, look=(0, -1, -0.05), both=True, grip=(-0.75, -0.6, 3.0),
                         staff=(-0.55, 0.75, 0.5), face=(0.0, 0.0, 1.0), blade=(1.0, 1.0),
                         right_pole=(-1.0, 0.6, -0.5), left_pole=(1.0, 0.3, -0.8))
        else:
            glide = dict(lean=0.35, stream=0.8, look=(0, -1, -0.05), grip=(-1.02, -0.72, 2.95),
                         staff=(0.1, 0.35, 1.0), face=(-0.2, -1.0, 0.0))
        walk = []
        for i in range(4):
            ph = i * math.pi / 2
            kw = dict(glide)
            kw['grip'] = tuple(Vector(glide['grip']) + Vector((0, 0.05 * math.sin(ph), 0.05 * math.cos(ph))))
            walk.append((1 + i * 8, rest(ph, scythe, root=(0, 0, 0.1 * math.sin(ph)), flutter=i * 1.6, souls=22.5 * i,
                                         swirl=30 * i, book_sway=(4 * math.sin(i * 1.6), 25), side=0.05 * math.sin(ph),
                                         **kw)))
        walk.append((33, rest(0, scythe, root=(0, 0, 0), flutter=6.4, souls=90 - 1e-3, swirl=120, book_sway=(0, 25),
                              **glide)))
        add(pre + 'Walk' if pre else 'Walk', walk)
        if scythe:
            run = dict(glide, lean=0.6, stream=1.2, look=(0, -1, -0.15), cape=0.6, grip=(-0.7, -0.45, 3.05),
                       staff=(-0.45, 0.85, 0.3))
        else:
            run = dict(glide, lean=0.6, stream=1.2, look=(0, -1, -0.15), cape=0.6, grip=(-1.0, -0.55, 3.0),
                       staff=(0.1, 0.8, 0.75))
        add(pre + 'Run' if pre else 'Run',
            [(1 + i * 5, rest(i * math.pi / 2, scythe, root=(0, 0, 0.14 * math.sin(i * math.pi / 2)), flutter=i * 2.2,
                              souls=22.5 * i, swirl=40 * i, book_sway=(6 * math.sin(i * 2.2), 45), **run))
             for i in range(4)]
            + [(21, rest(0, scythe, flutter=8.8, souls=90 - 1e-3, swirl=160, book_sway=(0, 45), **run))])
        ready = rest(0.0, scythe)
        # Hit: the blow lands, the whole body is knocked back and the weapon with it.
        g0 = Vector((scythe_hold if scythe else staff_hold)['grip'])
        add(pre + 'Hit' if pre else 'Hit',
            [(1, ready),
             (3, rest(0.5, scythe, root=(0, 0.3, 0.12), yaw=8, lean=-0.3, side=-0.08, look=(0.25, -0.8, 0.35), jaw=26,
                      cape=0.4, bell=(-30, 10), book_sway=(20, -30), grip=tuple(g0 + Vector((-0.08, 0.25, 0.15))))),
             (6, rest(0.6, scythe, root=(0, 0.36, 0.1), yaw=10, lean=-0.36, side=-0.1, look=(0.3, -0.8, 0.3), jaw=22,
                      cape=0.5, bell=(20, 0), book_sway=(-10, -20), grip=tuple(g0 + Vector((-0.1, 0.3, 0.1))))),
             (16, ready)], loop_clip=False)
        # Death: the fire flares, he is thrown back, then the vestments fold empty to the floor.
        jolt = rest(0.3, scythe, root=(0, 0.2, 0.25), lean=-0.45, look=(0, -0.6, 0.8), jaw=55, cape=0.9, splay=0.4,
                    left=(1.6, -0.6, 3.6), bell=(-30, 0), book_sway=(-25, -30), both=False,
                    grip=tuple(g0 + Vector((-0.2, 0.2, 0.4))))
        sag = rest(0.6, scythe, root=(0, 0.1, -0.7), lean=0.7, look=(0.2, -1, -0.8), jaw=40, splay=0.6, crumple=0.3,
                   both=False, grip=(-0.9, -1.1, 2.6), staff=(0.5, -0.6, 0.55), face=(0.0, 0.0, 1.0),
                   book_sway=(10, 20))
        heap = rest(0.9, scythe, root=(0, 0.3, -2.25), lean=0.95, look=(0.3, -0.7, -0.9), jaw=46, splay=1.0,
                    crumple=1.0, cape=-0.3, both=False, grip=(-0.7, -1.4, 2.75), staff=(0.9, -0.3, -0.02),
                    face=(0, 0, 1), left=(1.1, -1.3, 2.5), tilt=-6, souls_ring=0.02, bell=(40, 0), book_sway=(60, 30))
        add(pre + 'Death' if pre else 'Death',
            [(1, ready), (7, jolt), (18, sag), (32, heap), (60, heap)], loop_clip=False,
            fire=[(1, 1.0), (7, 2.0), (18, 1.2), (32, 0.4), (48, 0.02), (60, 0.0)])
        # The generic cast / the proclamation: reading the names, the weapon raised in the right hand.
        read_kw = dict(book=True, lid=1.0, left=(0.8, -1.05, 2.95), left_pole=(1.2, 0.5, -0.5), both=False,
                       look=(0.2, -1, -0.3), splay=0.3, cape=0.3, souls_ring=1.25)
        if scythe:
            read_kw.update(grip=(-1.0, -0.75, 3.45), staff=(-0.1, 0.05, 1.0), face=(0.4, -1.0, 0.0), blade=(1.0, 1.0))
        else:
            read_kw.update(grip=(-1.02, -0.8, 3.45), staff=(0.02, -0.08, 1.0), face=(-0.25, -1.0, 0.0))
        summon = []
        for i in range(6):
            ph = math.tau * i / 6
            summon.append((1 + i * 8, stance(root=(0, 0, 0.18 + 0.06 * math.sin(ph)), flutter=ph * 1.5, souls=90 * i,
                                             swirl=60 * i, jaw=12 + 22 * abs(math.sin(ph * 1.5)),
                                             bell=(10 * math.sin(ph * 2), 6 * math.cos(ph)), **read_kw)))
        summon.append((49, stance(root=(0, 0, 0.18), flutter=math.tau * 1.5, souls=540 - 1e-3, swirl=360 - 1e-3,
                                  jaw=12, bell=(0, 6), **read_kw)))
        add(pre + 'Summon' if scythe else 'SummonSouls', summon, fire=[(1, 1.3), (25, 1.5), (49, 1.3)])
        # The pulse: a coil down, then the weapon thrust high in one hand and SHAKEN, the
        # bell tolling on every jolt (the fist and the staff never part).
        high_face = (0.4, -1.0, 0.0) if scythe else (-0.25, -1.0, 0.0)
        extra = dict(blade=(1.0, 1.0)) if scythe else {}
        coil = stance(root=(0, 0.05, -0.18), lean=0.3, twist=-12, look=(0, -1, -0.1), jaw=12, both=False,
                      grip=(-0.95, -0.75, 2.75), staff=(0.1, -0.25, 1.0), face=high_face, left=(1.25, -0.6, 2.6),
                      cape=0.2, souls_ring=0.8, bell=(-15, 0), flutter=0.4, **extra)
        toll = [(1, ready), (6, coil)]
        for i, (f, b, dz) in enumerate(((10, 45, 0.0), (13, -38, -0.14), (16, 32, 0.0), (19, -26, -0.12), (23, 18, 0.0),
                                        (28, -10, -0.06))):
            toll.append((f, stance(root=(0, 0, 0.28 + dz * 0.4), lean=-0.22, twist=6, look=(0, -1, 0.4), jaw=48 - i * 5,
                                   splay=0.9 - i * 0.12, cape=0.7, souls=30 * f, souls_ring=1.6 - i * 0.08,
                                   swirl=20 * f, bell=(b, 0), both=False, grip=(-0.82, -0.62, 4.5 + dz),
                                   staff=(0.04, 0.0, 1.0), face=high_face, left=(1.7, -0.9, 3.45),
                                   left_hand=(0.6, -0.4, 0.6), right_pole=(-1.2, 0.2, -0.5), flutter=f * 0.3, **extra)))
        toll.append((40, ready))
        add('ScytheToll' if scythe else 'BellToll', toll, loop_clip=False, fire=[(1, 1), (10, 1.9), (22, 1.3), (40, 1)])

    # ---------------------------------------------------------------- staff strikes
    # StaffStrike: the bell head brought down overhead in both hands. Anticipation
    # (the body sinks and coils, the staff goes up and back over the right shoulder),
    # a fast committed arc through the vertical, the impact with the whole body
    # dropping into it, a follow-through past the target, and a heavy recovery.
    ready = rest(0.0, False)
    sw = dict(both=True, right_pole=(-1.0, 0.3, -0.7), left_pole=(1.0, 0.1, -0.9))
    fwd_face = (0.0, -1.0, 0.3)
    up_face = (0.0, 0.0, 1.0)
    s_dip = stance(root=(0, 0.05, -0.1), lean=0.12, twist=-8, look=(0, -1, 0.0), jaw=10, grip=(-0.6, -0.9, 3.6),
                   staff=(-0.35, -0.3, 1.0), face=fwd_face, bell=(-8, 0), flutter=0.3, **sw)
    s_wind = stance(root=(0, 0.18, 0.12), yaw=-12, lean=-0.28, twist=-28, side=-0.06, look=(0, -1, 0.3), jaw=20,
                    grip=(-0.62, 0.05, 4.55), staff=(-0.08, 0.72, 0.62), face=fwd_face, cape=0.3, bell=(35, 0),
                    flutter=1.0, **sw)
    s_hold = stance(root=(0, 0.2, 0.15), yaw=-13, lean=-0.3, twist=-30, side=-0.07, look=(0, -1, 0.32), jaw=22,
                    grip=(-0.6, 0.1, 4.6), staff=(-0.08, 0.75, 0.6), face=fwd_face, cape=0.32, bell=(40, 0),
                    flutter=1.2, **sw)
    s_over = stance(root=(0, -0.05, 0.05), yaw=-4, lean=0.15, twist=-8, look=(0, -1, 0.15), jaw=26,
                    grip=(-0.42, -0.9, 4.55), staff=(0.0, -0.35, 1.0), face=fwd_face, stream=0.2, bell=(-20, 0),
                    flutter=1.6, **sw)
    s_smash = stance(root=(0, -0.25, -0.24), yaw=6, lean=0.6, twist=10, look=(0, -1, -0.25), jaw=38,
                     grip=(-0.3, -1.3, 3.05), staff=(0.02, -1.0, -0.28), face=fwd_face, stream=0.45, bell=(60, 0),
                     book_sway=(20, -35), flutter=2.0, **sw)
    s_follow = stance(root=(0, -0.28, -0.32), yaw=9, lean=0.68, twist=14, look=(0, -1, -0.35), jaw=34,
                      grip=(-0.26, -1.3, 2.72), staff=(0.03, -0.85, -0.55), face=fwd_face, stream=0.35, bell=(-35, 0),
                      book_sway=(30, -40), flutter=2.3, **sw)
    s_settle = stance(root=(0, -0.2, -0.22), yaw=6, lean=0.55, twist=8, look=(0, -1, -0.2), jaw=24,
                      grip=(-0.3, -1.25, 2.9), staff=(0.02, -0.95, -0.4), face=fwd_face, stream=0.25, bell=(20, 0),
                      book_sway=(-10, -20), flutter=2.6, **sw)
    s_lift = stance(root=(0, -0.05, -0.05), yaw=2, lean=0.25, twist=0, look=(0, -1, 0.0), jaw=14,
                    grip=(-0.75, -1.0, 3.2), staff=(0.05, -0.55, 1.0), face=fwd_face, bell=(-10, 0), flutter=3.0, **sw)
    add('StaffStrike', [(1, ready), (4, s_dip), (9, s_wind), (11, s_hold), (13, s_over), (14, s_smash), (17, s_follow),
                        (21, s_settle), (26, s_lift), (32, ready)], loop_clip=False)
    # StaffStrike2: the backhand bash, the shaft swung flat across his front in both hands.
    b_wind = stance(root=(0, 0.12, 0.02), yaw=-24, lean=0.05, twist=-38, side=0.05, look=(-0.2, -1, 0.1), jaw=16,
                    grip=(-1.05, -0.2, 3.45), staff=(-0.55, 0.62, 0.42), face=up_face, bell=(0, -30), flutter=1.0, **sw)
    b_hold = stance(root=(0, 0.14, 0.03), yaw=-26, lean=0.04, twist=-42, side=0.06, look=(-0.22, -1, 0.1), jaw=18,
                    grip=(-1.08, -0.15, 3.47), staff=(-0.58, 0.62, 0.4), face=up_face, bell=(0, -34), flutter=1.1, **sw)
    b_mid = stance(root=(0, -0.08, -0.05), yaw=-6, lean=0.25, twist=-8, look=(0.0, -1, 0.05), jaw=24,
                   grip=(-0.65, -1.05, 3.35), staff=(-0.2, -1.0, 0.25), face=up_face, stream=0.3, bell=(0, 20),
                   flutter=1.6, **sw)
    b_hit = stance(root=(0, -0.18, -0.12), yaw=14, lean=0.35, twist=26, look=(0.3, -1, 0.0), jaw=32,
                   grip=(-0.12, -1.25, 3.25), staff=(0.85, -0.55, 0.12), face=up_face, stream=0.45, bell=(0, 55),
                   book_sway=(30, -20), flutter=2.2, **sw)
    b_follow = stance(root=(0, -0.12, -0.14), yaw=24, lean=0.3, twist=40, look=(0.35, -1, -0.05), jaw=26,
                      grip=(0.22, -1.05, 3.15), staff=(0.95, 0.15, 0.05), face=up_face, stream=0.3, bell=(0, 25),
                      book_sway=(40, -10), flutter=2.6, **dict(sw, both=False, left=(1.55, -0.45, 3.3),
                                                                 left_hand=(0.7, -0.2, 0.2)))
    b_back = stance(root=(0, -0.05, -0.06), yaw=10, lean=0.2, twist=14, look=(0.15, -1, 0.0), jaw=16,
                    grip=(-0.45, -1.0, 3.2), staff=(0.35, -0.6, 0.8), face=up_face, bell=(0, -12), flutter=3.0, **sw)
    add('StaffStrike2', [(1, ready), (5, b_wind), (9, b_hold), (12, b_mid), (13, b_hit), (17, b_follow), (24, b_back),
                         (32, ready)], loop_clip=False)

    # ------------------------------------------------------------------- the rise
    curl = dict(lean=0.55, look=(0, -1, -0.9), jaw=4, grip=(-0.5, -0.9, 3.0), staff=(-0.1, -0.3, 1.0),
                face=(-0.2, -1.0, 0.0), left=(0.35, -0.75, 3.2), left_pole=(1.0, 0.2, -0.5), splay=-0.4, cape=-0.2,
                souls_ring=0.35, book_sway=(0, 10))
    spread = dict(lean=-0.3, look=(0, -1, 0.55), jaw=38, grip=(-1.55, -0.55, 4.45), staff=(-0.15, 0.05, 1.0),
                  face=(-0.25, -1.0, 0.0), left=(1.95, -0.4, 4.2), left_hand=(0.7, -0.3, 0.6),
                  left_pole=(1.2, 0.6, -0.2), right_pole=(-1.2, 0.3, -0.6), splay=1.0, cape=1.0, souls_ring=1.5,
                  bell=(15, 0), book_sway=(25, 10))
    add('Rise', [(1, stance(flutter=0.0, souls=0, swirl=0, **curl)),
                 (40, stance(flutter=1.5, souls=90, swirl=120, **curl)),
                 (70, stance(flutter=3.0, souls=180, swirl=240, lean=0.2, look=(0, -1, -0.3), jaw=14,
                             grip=(-0.95, -0.85, 3.4), staff=(-0.05, -0.2, 1.0), face=(-0.25, -1.0, 0.0),
                             left=(1.1, -0.9, 3.3), splay=0.3, cape=0.3, souls_ring=0.8, bell=(-12, 0))),
                 (100, stance(flutter=4.5, souls=270, swirl=360, **spread)),
                 (125, stance(flutter=6.0, souls=360, swirl=480, **dict(spread, jaw=46))),
                 # it ends where the proclamation begins: the book lifted open, the staff high
                 (145, stance(root=(0, 0, 0.18), flutter=7.2, souls=450, swirl=600, jaw=12, book=True, lid=1.0,
                              left=(0.8, -1.05, 2.95), left_pole=(1.2, 0.5, -0.5), look=(0.2, -1, -0.3), splay=0.3,
                              cape=0.3, souls_ring=1.25, grip=(-1.02, -0.8, 3.45), staff=(0.02, -0.08, 1.0),
                              face=(-0.25, -1.0, 0.0)))],
        loop_clip=False, fire=[(1, 0.3), (40, 0.6), (100, 1.6), (145, 1.4)])

    # -------------------------------------------------------------- the shield ritual
    # The staff held level before him in both hands, the bell end out to his right.
    ward = dict(both=True, grip=(-0.55, -1.15, 3.3), staff=(-1.0, -0.08, 0.1), face=up_face, look=(0, -1, -0.35),
                splay=0.5, cape=0.4, souls_ring=1.7, left_pole=(1.2, 0.3, -0.7), right_pole=(-1.2, 0.2, -0.7), lean=0.1)
    wk = []
    for i in range(6):
        ph = math.tau * i / 6
        wk.append((1 + i * 8, stance(root=(0, 0, 0.12 * math.sin(ph)), flutter=ph, souls=60 * i, swirl=45 * i,
                                     jaw=10 + 12 * abs(math.sin(ph)), bell=(8 * math.sin(ph), 0), **ward)))
    wk.append((49, stance(root=(0, 0, 0), flutter=math.tau, souls=360 - 1e-3, swirl=270, jaw=10, bell=(0, 0), **ward)))
    add('ShieldRitual', wk, fire=[(1, 1.2), (25, 1.4), (49, 1.2)])

    # ------------------------------------------------------------------ the transform
    # The last rites: he lifts the staff before him in both hands, the crest splits and
    # the blade unfolds out of it; he hoists the scythe high in exaltation, coils, and
    # brings it down in one great reaping arc across his front, then settles to guard.
    s_ready = rest(0.0, True)
    present = dict(both=True, grip=(-0.3, -1.05, 3.9), staff=(-0.05, -0.12, 1.0), face=(0.0, -1.0, 0.0),
                   look=(0, -1, 0.6), splay=0.4, cape=0.4, left_pole=(1.0, 0.2, -0.8), right_pole=(-1.0, 0.2, -0.8))
    hoist = dict(both=False, grip=(-0.75, -0.55, 4.75), staff=(-0.1, 0.1, 1.0), face=(0.3, -1.0, 0.0),
                 left=(1.8, -0.7, 3.9), left_hand=(0.7, -0.3, 0.6), right_pole=(-1.2, 0.3, -0.4))
    trans = [(1, ready),
             (6, stance(root=(0, 0, -0.08), lean=0.2, jaw=12, souls=20, swirl=20, bell=(6, 0), both=True,
                        grip=(-0.55, -0.95, 3.2), staff=(-0.05, -0.2, 1.0), face=(0.0, -1.0, 0.0),
                        left_pole=(1.0, 0.2, -0.8), right_pole=(-1.0, 0.2, -0.8))),
             (12, stance(root=(0, 0, 0.1), jaw=20, souls=40, swirl=40, bell=(10, 0), **present)),
             (16, stance(root=(0, 0, 0.16), jaw=30, souls=80, swirl=80, bell=(-25, 10), blade=(0.25, 0.0), **present)),
             (21, stance(root=(0, 0, 0.24), jaw=40, souls=120, swirl=120, bell=(35, -10), blade=(1.08, 0.0),
                         **present)),
             (25, stance(root=(0, 0, 0.28), jaw=48, souls=160, swirl=160, bell=(-30, 5), blade=(1.0, 1.1), **present)),
             (31, stance(root=(0, 0, 0.36), lean=-0.25, look=(0, -1, 0.7), jaw=55, splay=1.0, cape=0.9, souls=220,
                         souls_ring=1.9, swirl=240, bell=(20, 0), blade=(1.0, 1.0), flutter=2.0, **hoist)),
             (38, stance(root=(0, 0, 0.38), lean=-0.3, look=(0, -1, 0.72), jaw=58, splay=1.0, cape=1.0, souls=260,
                         souls_ring=1.9, swirl=300, bell=(-15, 0), blade=(1.0, 1.0), flutter=3.0, **hoist))]
    t_coil = dict(both=True, right_pole=(-1.0, 0.4, -0.6), left_pole=(1.0, 0.1, -0.9), blade=(1.0, 1.0))
    trans.append((45, stance(root=(0, 0.22, 0.3), yaw=-22, lean=-0.2, twist=-40, side=-0.08, look=(0, -1, 0.25),
                             jaw=30, grip=(-0.9, 0.05, 4.4), staff=(-0.5, 0.55, 0.7), face=(0.0, 0.3, 1.0), splay=0.6,
                             cape=0.6, souls=320, souls_ring=1.6, swirl=360, bell=(0, 20), flutter=4.0, **t_coil)))
    trans.append((49, stance(root=(0, 0.24, 0.32), yaw=-24, lean=-0.22, twist=-44, side=-0.09, look=(0, -1, 0.25),
                             jaw=32, grip=(-0.92, 0.1, 4.45), staff=(-0.52, 0.55, 0.68), face=(0.0, 0.3, 1.0),
                             splay=0.6, cape=0.6, souls=340, souls_ring=1.6, swirl=380, bell=(0, 22), flutter=4.4,
                             **t_coil)))
    trans.append((52, stance(root=(0, -0.05, 0.05), yaw=-4, lean=0.3, twist=-6, look=(0, -1, 0.0), jaw=40,
                             grip=(-0.6, -1.05, 3.9), staff=(-0.3, -0.9, 0.55), face=(0.8, 0.0, -0.4), stream=0.4,
                             souls=380, swirl=420, bell=(0, 30), flutter=5.0, **t_coil)))
    trans.append((54, stance(root=(0, -0.28, -0.26), yaw=12, lean=0.55, twist=24, look=(0.25, -1, -0.2), jaw=46,
                             grip=(-0.1, -1.3, 2.95), staff=(0.55, -0.8, -0.3), face=(0.7, 0.3, -0.5), stream=0.5,
                             souls=420, swirl=460, bell=(0, 40), flutter=6.0, **t_coil)))
    trans.append((57, stance(root=(0, -0.3, -0.32), yaw=18, lean=0.6, twist=36, look=(0.3, -1, -0.25), jaw=40,
                             grip=(0.1, -1.2, 2.75), staff=(0.85, -0.45, -0.3), face=(0.4, 0.7, -0.4), stream=0.4,
                             souls=440, swirl=480, bell=(0, 30), flutter=6.5, **t_coil)))
    trans.append((64, s_ready))
    add('Transform', trans, loop_clip=False, fire=[(1, 1.0), (16, 1.4), (25, 2.4), (45, 1.9), (54, 2.2), (64, 1.3)])

    # ------------------------------------------------------------------ scythe sweeps
    # ScytheSweep: a flat reaping sweep right to left, both hands on the snath, the
    # tip leading, the body unwinding from a deep coil through the cut.
    ss = dict(both=True, blade=(1.0, 1.0), right_pole=(-1.0, 0.4, -0.7), left_pole=(1.0, 0.2, -0.9))
    c_dip = stance(root=(0, 0.05, -0.08), yaw=-8, lean=0.18, twist=-12, look=(0, -1, 0.0), jaw=12,
                   grip=(-0.5, -0.95, 3.35), staff=(-0.45, -0.15, 0.95), face=(0.35, -1.0, 0.0), flutter=0.4, **ss)
    c_wind = stance(root=(0, 0.2, 0.04), yaw=-22, lean=0.1, twist=-34, side=0.05, look=(-0.15, -1, 0.05), jaw=18,
                    grip=(-1.05, 0.05, 3.25), staff=(-0.8, 0.45, 0.15), face=(0.0, -0.4, 1.0), stream=0.2,
                    bell=(0, -20), flutter=1.0, **ss)
    c_hold = stance(root=(0, 0.22, 0.02), yaw=-24, lean=0.1, twist=-37, side=0.06, look=(-0.16, -1, 0.05), jaw=20,
                    grip=(-1.07, 0.1, 3.22), staff=(-0.82, 0.45, 0.12), face=(0.0, -0.4, 1.0), stream=0.2,
                    flutter=1.1, **ss)
    c_cut = stance(root=(0, -0.1, -0.1), yaw=-2, lean=0.4, twist=0, look=(0.0, -1, -0.05), jaw=30,
                   grip=(-0.55, -1.25, 3.0), staff=(-0.1, -1.0, -0.12), face=(0.95, 0.0, 0.25), stream=0.5,
                   bell=(0, 40), flutter=1.8, **ss)
    c_hit = stance(root=(0, -0.2, -0.16), yaw=16, lean=0.42, twist=28, look=(0.3, -1, -0.05), jaw=34,
                   grip=(-0.05, -1.3, 2.95), staff=(0.6, -0.8, -0.15), face=(0.75, 0.6, 0.2), stream=0.5, bell=(0, 45),
                   book_sway=(35, -25), flutter=2.2, **ss)
    c_follow = stance(root=(0, -0.15, -0.14), yaw=28, lean=0.3, twist=46, look=(0.4, -1, -0.05), jaw=24,
                      grip=(0.35, -1.0, 3.05), staff=(0.95, 0.3, -0.1), face=(-0.2, 1.0, 0.25), stream=0.3,
                      bell=(0, 25), flutter=2.6, **ss)
    c_rec = stance(root=(0, -0.04, -0.04), yaw=10, lean=0.18, twist=16, look=(0.15, -1, 0.0), jaw=14,
                   grip=(-0.15, -1.05, 3.3), staff=(0.2, -0.5, 0.85), face=(0.4, -1.0, 0.0), flutter=3.0, **ss)
    add('ScytheSweep', [(1, s_ready), (4, c_dip), (8, c_wind), (10, c_hold), (12, c_cut), (14, c_hit), (18, c_follow),
                        (24, c_rec), (32, s_ready)], loop_clip=False)
    # ScytheSweep2: the blade raised high over the right shoulder, then a diagonal reap
    # brought down across his front to the floor at his left, the tip leading.
    r_wind = stance(root=(0, 0.16, 0.18), yaw=-18, lean=-0.3, twist=-30, side=-0.06, look=(0, -1, 0.35), jaw=22,
                    grip=(-0.85, 0.05, 4.55), staff=(-0.3, 0.55, 0.78), face=(0.0, 0.1, 1.0), cape=0.3,
                    bell=(-30, 0), flutter=1.0, **ss)
    r_hold = stance(root=(0, 0.18, 0.2), yaw=-20, lean=-0.32, twist=-33, side=-0.07, look=(0, -1, 0.37), jaw=24,
                    grip=(-0.86, 0.1, 4.6), staff=(-0.3, 0.55, 0.8), face=(0.0, 0.1, 1.0), cape=0.32, flutter=1.2,
                    **ss)
    r_mid = stance(root=(0, -0.05, 0.02), yaw=-4, lean=0.2, twist=-6, look=(0, -1, 0.1), jaw=30,
                   grip=(-0.62, -1.0, 4.1), staff=(-0.1, -0.75, 0.6), face=(0.6, -0.2, -0.6), stream=0.3,
                   flutter=1.7, **ss)
    r_chop = stance(root=(0, -0.28, -0.3), yaw=12, lean=0.62, twist=20, look=(0.15, -1, -0.3), jaw=38,
                    grip=(-0.2, -1.3, 2.9), staff=(0.45, -0.85, -0.35), face=(0.5, 0.2, -0.8), stream=0.45,
                    bell=(45, 0), book_sway=(25, -35), flutter=2.2, **ss)
    r_follow = stance(root=(0, -0.3, -0.36), yaw=18, lean=0.68, twist=30, look=(0.2, -1, -0.35), jaw=32,
                      grip=(0.0, -1.2, 2.7), staff=(0.75, -0.55, -0.45), face=(0.3, 0.5, -0.8), stream=0.35,
                      flutter=2.5, **ss)
    r_rec = stance(root=(0, -0.08, -0.08), yaw=8, lean=0.25, twist=10, look=(0.1, -1, -0.05), jaw=16,
                   grip=(-0.3, -1.05, 3.25), staff=(0.15, -0.55, 0.85), face=(0.4, -1.0, 0.0), flutter=3.0, **ss)
    add('ScytheSweep2', [(1, s_ready), (5, c_dip), (10, r_wind), (12, r_hold), (14, r_mid), (15, r_chop),
                         (19, r_follow), (26, r_rec), (33, s_ready)], loop_clip=False)
    return clips


def smoke_material():
    """The translucent soul smoke: vertex colour and vertex alpha, unlit by the bake."""
    import bpy
    m = bpy.data.materials.new('CreatureSmoke')
    m.use_nodes = True
    m.use_backface_culling = False
    try:
        m.surface_render_method = 'BLENDED'
    except (AttributeError, TypeError):
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(vc.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 1.0
    return m


if __name__ == '__main__':
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    fast = '--fast' in argv
    new_scene()
    mats = make_materials('bone', membrane_kind='cloth')
    metal = bpy.data.materials.new('CreatureMetal')
    metal.use_nodes = True
    metal.use_backface_culling = True
    _procedural_surface(metal, 'bone')
    mats.append(metal)
    mats.append(smoke_material())
    parts = build_parts() + build_stole_sigils()
    mems = build_membranes()
    if '--solo' in argv:   # a debugging aid: build only the named parts
        keep = argv[argv.index('--solo') + 1].split(',')
        parts = [pt for pt in parts if pt.name in keep]
        mems = []
    # The translucent smoke is its own mesh: unbaked, it casts no shadow and has no
    # frozen far-LOD form (glTF node extras the character pipeline reads).
    smoke_parts = [pt for pt in parts if pt.name in ('Smoke', 'SmokeIn')]
    objects = [pt.to_object(mats) for pt in parts if pt not in smoke_parts] + [m.to_object(mats) for m in mems]
    body = join(objects, 'MorthenLich')
    smoke = join([pt.to_object(mats) for pt in smoke_parts], 'MorthenSmoke') if smoke_parts else None
    if smoke is not None:
        smoke['shadowCaster'] = False
        smoke['farBake'] = False
    print('TRIANGLES', triangles(body) + (triangles(smoke) if smoke is not None else 0))
    if '--nobake' not in argv:
        bake_surface(body, size=512 if fast else 2048, samples=16 if fast else 40)
    # The metal keeps its shine: gold, iron and bronze read as metal, not cloth.
    nt = metal.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.6
    bsdf.inputs['Roughness'].default_value = 0.45
    arm = build_armature('MorthenLich', BONES)
    bind(body, arm)
    if smoke is not None:
        bind(smoke, arm)
    clips = make_clips(arm)
    # The staff is locked in the fist: report the wrists, the grips and the staff turn.
    worst = {}
    for name, f, bend_r, bend_l, gap_r, gap_l, rel in DIAG:
        w = worst.setdefault(name, [0, 0, 0, 0, 0])
        for i, v in enumerate((bend_r, bend_l, gap_r, gap_l, rel)):
            w[i] = max(w[i], v)
        if '--diag' in argv:
            print('DIAG', name, f, 'bendR', bend_r, 'bendL', bend_l, 'gapR', gap_r, 'gapL', gap_l, 'staffRel', rel)
    for name, (br, bl, gr, gl, rel) in worst.items():
        print('GRIP', name, 'maxBendR', br, 'maxBendL', bl, 'maxGapR', gr, 'maxGapL', gl, 'maxStaffRel', rel)
    # The game measures him half a second into Idle (src/render/characters/assets.ts).
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(13)
    dg = bpy.context.evaluated_depsgraph_get()
    zs = []
    for ob in (body, smoke):
        if ob is None:
            continue
        ev = ob.evaluated_get(dg)
        zs += [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3), 'MAXZ', round(max(zs), 3))
    for pb in arm.pose.bones:
        pb.scale = (1, 1, 1)
    if out != '-':
        export(out, arm, extras=True)
    if '--sheet' in argv:
        setup_preview((0, -0.4, 3.1), 11, ref_x=3.4)
        only = argv[argv.index('--clips') + 1].split(',') if '--clips' in argv else clips
        render_sheet(arm, [c for c in clips if c in only], argv[argv.index('--sheet') + 1], 'morthen',
                     frames_per_clip=int(argv[argv.index('--frames') + 1]) if '--frames' in argv else 5)
    if '--blend' in argv:
        arm.animation_data.action = bpy.data.actions['Idle']
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
