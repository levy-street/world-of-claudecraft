"""Cantor Ilvane, the Hollow Crypt's third boss (src/sim/encounters/hollow_crypt/ilvane.ts):
the parish cantor who sang the dead to rest, now singing them awake.

  blender -b --factory-startup --python build_cantor.py -- <out.glb> [--sheet dir] [--blend out.blend] [--fast]

A tall skeletal choir mistress, upright and elegant where the Sexton is hunched:
about 6.5 yd to the top of her crown, two and a half players. A long cassock of
faded violet that blackens to soot at its torn hem; a torn white surplice over it
with wide bell sleeves that fall back when she lifts her arms; a great pleated
millstone ruff round the neck; a stole of deep violet stitched with silver staves
and notes of violet song. The skull is long and fine, the sockets burning violet,
a veil of black lace falling from a crown of tarnished silver ORGAN PIPES over the
ruff, the last of her long pale hair straggling from under it. In her left hand
the HYMNAL, bound in black leather with silver corners and clasps, held open on
her long bony fingers (its covers hinge on their own bones, so it shuts and falls
open); in her right fist the conductor's BATON, a long finger bone with a violet
light at its tip. Her song is Gravecaller violet: the eyes, the voice in her open
mouth, the baton's light, the notes on the stole and on the pages. Never green.

Built on the organic kit (organic_kit.py) as Morthen is (build_morthen.py): smooth
parts bound one bone each, the cassock, surplice, sleeves, veil, hair and stole as
membranes weighted across hanging spars, one Cycles bake of the bone and cloth
surfaces with their occlusion, a metal material for the silver, the glow material
for the song. The pose language is Morthen's RollRig (aims, two-bone IK, rest-frame
turns, world rotations) with three additions here:
  * hands placed in the chest's frame and turned by their frame (the baton across
    the right fist, the palm under the hymnal), the wrist bend clamped;
  * cloth that follows the legs (the cassock and surplice spars turn with the
    thighs and shins) and a floor guard (any hem a pose would push under the
    flags is swung out until it clears, so the robe pools when she kneels);
  * a keyed bone offset, so the hymnal can leave her hand: it hangs before her
    over the organ's keys while she plays and falls open on the floor when she dies.

Scale (yards, the creature faces -Y): authored at full size, about 6.5 tall; the
template draws her at scale 1.

Clips (24 fps). One-shots start and end on CombatIdle.
  Idle        out of combat: head bowed over the open hymnal, a slow sway, humming.
  CombatIdle  upright, the chin up, the baton raised, the hymnal out at her side.
  Walk, Run   a long gliding stride, the cassock swinging with the legs.
  Attack      the baton slash: wound high over the right shoulder, cut down across.
  Attack2     the hymnal backhand: the book swung across and snapped shut on impact.
  Hit, Death  a recoil; she cries out, sinks to her knees in her robes and falls
              forward, the hymnal slipping from her hand and falling open.
  Sing        the Dirge (a 2.5 s bar, 1.8 s in Crescendo): a breath, then the arms
              spread and rise, the head thrown back, the mouth open on violet light;
              the peak is reached by 1.75 s and held, climbing, to 2.5 s.
  Conduct     a 2 s bar of four beats (down, in, out, up) with the baton, looping.
  PlayOrgan   about 4.2 s at the Bone Organ's keys (facing the pipes): fists pounding
              chords, the hymnal hanging open before her, the head swaying; loops.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Matrix, Quaternion, Vector  # noqa: E402
from organic_kit import (  # noqa: E402
    BODY, GLOW, MEMBRANE, Membrane, Part, _procedural_surface, bake_surface, bind, build_armature, export,
    expand_bones, join, make_materials, new_scene, render_sheet, setup_preview, triangles, two_bone,
)
from build_morthen import RollRig, _hash, fist  # noqa: E402

METAL = 3

# ------------------------------------------------------------------ palette
BONE = (0.84, 0.79, 0.68)
BONE_OLD = (0.66, 0.6, 0.5)
BONE_DARK = (0.34, 0.3, 0.25)
SOCKET = (0.03, 0.02, 0.04)
VIOLET = (0.37, 0.26, 0.45)          # the cassock, faded
VIOLET_DARK = (0.2, 0.13, 0.25)
VIOLET_DEEP = (0.15, 0.08, 0.19)     # the stole
SOOT = (0.055, 0.05, 0.058)
SOOT_HI = (0.13, 0.12, 0.13)
LINEN = (0.88, 0.86, 0.8)            # the surplice and the ruff
LINEN_OLD = (0.63, 0.61, 0.55)
LINEN_DIRT = (0.38, 0.36, 0.33)
LACE = (0.06, 0.05, 0.065)           # the black lace veil
LACE_HI = (0.15, 0.13, 0.17)
HAIR = (0.84, 0.82, 0.76)
HAIR_DARK = (0.56, 0.54, 0.5)
SILVER = (0.66, 0.66, 0.67)          # tarnished silver
SILVER_HI = (0.84, 0.84, 0.83)
SILVER_DARK = (0.27, 0.27, 0.28)
LEATHER = (0.075, 0.055, 0.065)
PAGE = (0.78, 0.72, 0.58)
INK = (0.17, 0.11, 0.14)
SONG = (0.8, 0.34, 1.0)              # Gravecaller violet: the song
SONG_HOT = (1.0, 0.8, 1.0)
SONG_DEEP = (0.56, 0.1, 0.76)

CAS = 14     # cassock spars round the waist
SUR = 14     # surplice spars round the collar
VEIL = 9     # veil spars round the back of the head
SLV = 8      # hanging sleeve spars round each forearm


def _n(v):
    return Vector(v).normalized()


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def _ss(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _g(x):
    return math.exp(-x * x)


# ------------------------------------------------------------------- skeleton geometry
SH_L = Vector((0.6, 0.04, 4.64))
EL_L = Vector((0.86, 0.1, 3.5))
WR_L = Vector((0.98, -0.52, 2.72))
H_L = Vector((0.0, -1.0, 0.0))            # left hand: fingers forward, palm up under the book
N_L = Vector((0.0, 0.0, 1.0))
KN_L = WR_L + H_L * 0.4
WR_R = Vector((-WR_L.x, WR_L.y, WR_L.z))
H_R = Vector((0.0, -1.0, 0.0))            # right fist round the baton, the baton up through it
A_R = Vector((0.0, 0.0, 1.0))
N_R = A_R.cross(H_R).normalized()         # the palm toward her middle (+x)
FIST_C = WR_R + H_R * 0.19 + N_R * 0.085  # the baton's grip (build_morthen.fist's bar)
BATON_LEN = 1.28
BATON_TIP = FIST_C + A_R * BATON_LEN

HIP_L = Vector((0.27, 0.0, 3.0))
KNEE_L = Vector((0.3, -0.06, 1.62))
ANKLE_L = Vector((0.31, 0.04, 0.24))
TOE_L = Vector((0.33, -0.38, 0.04))

# The hymnal, laid open on the left palm: the spine along the fingers, the pages up.
BOOK_C = WR_L + H_L * 0.3 + N_L * 0.075   # the spine's middle, on the fingers
BOOK_HALF = 0.36                           # half the spine's length
BOOK_W = 0.46                              # one page's width
BOOK_X = Vector((1.0, 0.0, 0.0))           # across the spread, toward PageA (H_L x BOOK_X = N_L)
SPINE0 = BOOK_C - H_L * BOOK_HALF
SPINE1 = BOOK_C + H_L * BOOK_HALF

# The skull, a long fine head, modelled at a man's proportions and grown about the neck.
SKULL_C = Vector((0.0, -0.06, 5.55))
EYE_PHI, EYE_THETA = 0.6, 0.08
HEAD_PIVOT = Vector((0.0, -0.02, 5.2))
HEAD_SCALE = 1.32
HEAD_XF = Matrix.Translation(HEAD_PIVOT) @ Matrix.Scale(HEAD_SCALE, 4) @ Matrix.Translation(-HEAD_PIVOT)
JAW_HINGE = Vector((0.0, -0.03, 5.39))
JAW_CHIN = Vector((0.0, -0.26, 5.14))
VOICE_AT = Vector((0.0, -0.17, 5.3))


def skull_point(phi, theta, relief=1.0):
    """A point on her skull at azimuth `phi` (0 dead ahead, -Y) and elevation `theta`:
    (position, outward normal, (socket, nose) darkness). Morthen's sculpt made finer:
    a long smooth cranium, a soft brow, large round sockets, light cheekbones and a
    narrow upper jaw."""
    ct = math.cos(theta)
    u = Vector((math.sin(phi) * ct, -math.cos(phi) * ct, math.sin(theta)))
    rx = 0.2
    ry = 0.255 if u.y < 0 else 0.3
    rz = 0.35 if u.z > 0 else 0.275
    p0 = Vector((u.x * rx, u.y * ry, u.z * rz))
    p0.x *= 1.0 - 0.36 * _ss(-0.45, -1.25, theta)
    if u.y > 0:
        p0.z += 0.07 * u.y * max(0.0, u.z)
        p0.y += 0.035 * max(0.0, u.z)
    n = Vector((p0.x / rx ** 2, p0.y / ry ** 2, p0.z / rz ** 2)).normalized()
    front = max(0.0, -u.y)
    face = _ss(0.55, 0.85, front) * _ss(-1.1, -0.8, theta) * (1 - _ss(0.35, 0.6, theta))
    dr = -0.028 * face
    sock = 0.0
    for s in (-1, 1):
        dp = (phi - s * EYE_PHI) * ct
        dt = theta - EYE_THETA
        sl = s * 0.14
        a_ = dp * math.cos(sl) + dt * math.sin(sl)
        b_ = -dp * math.sin(sl) + dt * math.cos(sl)
        q = (a_ / 0.3) ** 2 + (b_ / 0.27) ** 2
        if q < 1.0:
            dr -= 0.1 * (1.0 - q * q) ** 0.7
            sock = max(sock, (1.0 - q) ** 0.4)
        brow_t = EYE_THETA + 0.29 - 0.05 * max(0.0, 1.0 - abs(phi) / 0.5)
        dr += 0.03 * _g((theta - brow_t) / 0.08) * _g((phi - s * 0.58) / 0.45) * front
        dr += 0.05 * _g((theta + 0.2) / 0.08) * _g((phi - s * 1.2) / 0.42)
        dr += 0.028 * _g((theta + 0.16) / 0.1) * _g((phi - s * 0.85) / 0.18)
        hollow = _g((theta + 0.5) / 0.18) * _g((phi - s * 0.78) / 0.26)
        dr -= 0.05 * hollow
        sock = max(sock, 0.3 * hollow)
        dr -= 0.03 * _g((theta - 0.2) / 0.3) * _g((phi - s * 1.5) / 0.35)
    nt = theta + 0.3
    half = 0.06 + 0.07 * max(0.0, min(1.0, -nt / 0.18))
    qn = (phi / max(0.02, half)) ** 2 + (nt / 0.17) ** 2
    nose = 0.0
    if qn < 1.0 and front > 0.5:
        dr -= 0.075 * (1.0 - qn) ** 0.9
        nose = (1.0 - qn) ** 0.45
    dr += 0.02 * _g(phi / 0.09) * _g((theta - 0.06) / 0.14) * front
    dr += 0.032 * _g((theta + 0.85) / 0.18) * front ** 3
    return SKULL_C + p0 + n * dr * relief, n, (sock, nose)


def _eye():
    # the socket's mouth (the skull's surface before the socket is pressed in), the
    # flame set a little way into it: never on the socket's floor, which slopes to the nose
    pos, n, _ = skull_point(EYE_PHI, EYE_THETA, relief=0.0)
    return HEAD_XF @ (pos - n * 0.045)


EYE = _eye()


def band_theta(phi):
    """The crown's band runs over the brow in front and lower round the back."""
    return 0.47 - 0.22 * (1 - math.cos(phi)) / 2


def band_point(phi, out=0.05):
    pos, n, _ = skull_point(phi, band_theta(phi))
    return HEAD_XF @ (pos + n * out)


# ------------------------------------------------------------------- cloth spars
def cas_spar(k):
    """The cassock's k-th spar, waist to hem (k 0 dead ahead)."""
    a = math.tau * k / CAS
    sx, cy = math.sin(a), -math.cos(a)
    back = max(0.0, -cy)
    return a, [(sx * 0.34, cy * 0.29, 3.15), (sx * 0.56, cy * 0.47, 2.6), (sx * 0.73, cy * 0.64 + back * 0.04, 1.45),
               (sx * 0.95, cy * 0.86 + back * 0.1, 0.2)]


def sur_spar(k):
    """The surplice's k-th spar: collar, shoulder, chest, waist, hem."""
    a = math.tau * k / SUR
    sx, cy = math.sin(a), -math.cos(a)
    side = abs(sx)
    return a, [(sx * 0.3, cy * 0.26 + 0.03, 4.86), (sx * (0.5 + 0.28 * side), cy * 0.44 + 0.04, 4.66),
               (sx * 0.66, cy * 0.45 + 0.04, 4.12), (sx * 0.58, cy * 0.46 + 0.04, 3.4),
               (sx * 0.78, cy * 0.68 + 0.05, 2.45)]


VEIL_PHI = [0.88 + (math.tau - 1.76) * i / (VEIL - 1) for i in range(VEIL)]


def veil_spar(i):
    """The veil's i-th spar: the crown's band, the ruff's edge, the hem (azimuth from the front)."""
    phi = VEIL_PHI[i]
    s2 = math.sin(phi) ** 2
    top = band_point(phi, 0.035)
    nape = Vector((math.sin(phi) * 0.72, -math.cos(phi) * 0.68 + 0.05, 5.03))
    end_r = 0.8 + 0.18 * s2
    end = Vector((math.sin(phi) * end_r, -math.cos(phi) * (end_r - 0.04) + 0.1, 3.92 + 0.42 * s2))
    return phi, [top, nape, end]


def _sleeve_frame(tag):
    s = 1 if tag == '.L' else -1
    el = Vector((s * EL_L.x, EL_L.y, EL_L.z))
    wr = Vector((s * WR_L.x, WR_L.y, WR_L.z))
    fd = (wr - el).normalized()
    fu = fd.cross(Vector((0, 0, 1))).normalized()
    fv = fd.cross(fu).normalized()
    return el, wr, fd, fu, fv


SLV_T = 0.42
SLV_R = 0.25
SLV_LEN = 0.66


def sleeve_spar(tag, k):
    el, wr, fd, fu, fv = _sleeve_frame(tag)
    c = el.lerp(wr, SLV_T)
    a = math.tau * k / SLV
    ring = fu * math.cos(a) + fv * math.sin(a)
    root = c + ring * SLV_R
    hang = (fd * 0.85 + ring * 0.3).normalized()
    return root, hang, ring


# ------------------------------------------------------------------- bones
def _cloth_bones():
    out = []
    for k in range(CAS):
        _, p = cas_spar(k)
        out.append((f'Cas{k}a', 'Hips', p[0], p[1]))
        out.append((f'Cas{k}b', f'Cas{k}a', p[1], p[2]))
        out.append((f'Cas{k}c', f'Cas{k}b', p[2], p[3]))
    for k in range(SUR):
        _, p = sur_spar(k)
        out.append((f'Sur{k}a', 'Chest', p[2], p[3]))
        out.append((f'Sur{k}b', f'Sur{k}a', p[3], p[4]))
    for i in range(VEIL):
        _, p = veil_spar(i)
        out.append((f'Veil{i}a', 'Head', tuple(p[0]), tuple(p[1])))
        out.append((f'Veil{i}b', f'Veil{i}a', tuple(p[1]), tuple(p[2])))
    for k in range(SLV):
        root, hang, _ = sleeve_spar('.L', k)
        out.append((f'Slv{k}.L', 'Fore.L', tuple(root), tuple(root + hang * SLV_LEN)))
    return out


BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.6)),
    ('Hips', 'Root', (0, 0, 3.0), (0, 0, 3.35)),
    ('Spine', 'Hips', (0, 0, 3.35), (0, 0.02, 3.95)),
    ('Chest', 'Spine', (0, 0.02, 3.95), (0, 0.04, 4.78)),
    ('Neck', 'Chest', (0, 0.04, 4.78), (0, 0.0, 5.18)),
    ('Head', 'Neck', (0, 0.0, 5.18), (0, -0.04, 5.75)),
    ('Jaw', 'Head', tuple(HEAD_XF @ JAW_HINGE), tuple(HEAD_XF @ JAW_CHIN)),
    ('Voice', 'Head', tuple(HEAD_XF @ VOICE_AT), tuple(HEAD_XF @ (VOICE_AT + Vector((0, 0, 0.14))))),
    ('FlameEye.L', 'Head', tuple(EYE), tuple(EYE + Vector((0, 0.02, 0.16)))),
    ('Arm.L', 'Chest', tuple(SH_L), tuple(EL_L)),
    ('Fore.L', 'Arm.L', tuple(EL_L), tuple(WR_L)),
    ('Hand.L', 'Fore.L', tuple(WR_L), tuple(KN_L)),
    ('Hymnal', 'Hand.L', tuple(SPINE0), tuple(SPINE1)),
    ('PageA', 'Hymnal', tuple(SPINE0), tuple(SPINE1)),
    ('PageB', 'Hymnal', tuple(SPINE0), tuple(SPINE1)),
    ('Baton', 'Hand.R', tuple(FIST_C), tuple(FIST_C + A_R * 0.6)),
    ('BatonLight', 'Baton', tuple(BATON_TIP), tuple(BATON_TIP + A_R * 0.15)),
    ('Thigh.L', 'Hips', tuple(HIP_L), tuple(KNEE_L)),
    ('Shin.L', 'Thigh.L', tuple(KNEE_L), tuple(ANKLE_L)),
    ('Foot.L', 'Shin.L', tuple(ANKLE_L), tuple(TOE_L)),
] + _cloth_bones())
REST = {n: (Vector(h), Vector(t)) for n, _, h, t in BONES}
FIRE_BONES = ['FlameEye.L', 'FlameEye.R', 'BatonLight']
VOICE_BONES = ['Voice']
FLICKER = set(FIRE_BONES) | set(VOICE_BONES)
LEN = {n: (t - h).length for n, (h, t) in REST.items()}


# ------------------------------------------------------------------- parts
def sculpt_skull(p, n_phi=46, n_theta=32):
    before = set(p.bm.faces)
    grid, tones = [], {}
    for j in range(n_theta + 1):
        theta = -math.pi / 2 + 0.03 + (math.pi - 0.06) * j / n_theta
        row = []
        for i in range(n_phi):
            phi = -math.pi + math.tau * i / n_phi
            pos, _, (sock, nose) = skull_point(phi, theta)
            v = p.bm.verts.new(pos)
            dark = max(sock, nose)
            tones[v] = lerp(lerp(BONE, BONE_OLD, 0.2 + 0.3 * max(0.0, -math.sin(theta))), SOCKET, min(1.0, dark ** 1.2))
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


def open_hand(p, wrist, h, n):
    """The left hand, open and palm up under the hymnal: a carpal knot, four long
    metacarpals and long jointed fingers curling up at the tips to cradle the book,
    and the thumb along the near cover. `h` wrist to knuckles, `n` the palm normal."""
    w, h, n = Vector(wrist), _n(h), _n(n)
    s = h.cross(n).normalized()          # the thumb's side for this (left) hand
    p.blob(w, (0.14, 0.13, 0.12), BONE_OLD, segments=10, rings=7)
    p.blob(w + h * 0.07, (0.16, 0.1, 0.15), BONE, segments=10, rings=6,
           rot=(0, 0, math.atan2(h.x, -h.y)))
    for k, off in enumerate((0.075, 0.025, -0.025, -0.072)):
        base = w + h * 0.06 + s * off * 0.5
        knuck = w + h * 0.27 + s * off * 1.1 + n * 0.005
        p.tube([base, base.lerp(knuck, 0.5) - n * 0.008, knuck], [0.022, 0.018, 0.024], BONE, sides=7)
        p.blob(knuck, (0.056, 0.056, 0.05), BONE_OLD, segments=8, rings=5)
        pos = knuck
        d = (h + s * off * 0.5).normalized()
        curl = 0.0
        ln_k = 1.0 - 0.1 * abs(k - 1.2)
        for i, ln in enumerate((0.13, 0.105, 0.085)):
            curl += (8, 16, 22)[i]
            dd = (d * math.cos(math.radians(curl)) + n * math.sin(math.radians(curl))).normalized()
            end = pos + dd * ln * ln_k
            r0 = 0.021 * (1 - 0.14 * i)
            p.tube([pos, pos.lerp(end, 0.5), end], [r0, r0 * 0.82, r0 * 0.9], lerp(BONE, BONE_OLD, i * 0.3), sides=7)
            p.blob(end, (r0 * 2.1, r0 * 2.1, r0 * 2.1), BONE_OLD, segments=7, rings=5)
            if i == 0 and k == 1:
                mid = pos.lerp(end, 0.55)
                p.tube([mid - dd * 0.018, mid + dd * 0.018], [r0 * 1.7, r0 * 1.7], SILVER, sides=9, mat=METAL)
            pos = end
        tip_d = (d * math.cos(math.radians(curl + 25)) + n * math.sin(math.radians(curl + 25))).normalized()
        p.tube([pos, pos + tip_d * 0.05], [0.014, 0.002], BONE_DARK, sides=5)
    tb = w + h * 0.05 + s * 0.08
    pos = tb
    td = (h * 0.6 + s * 0.75 + n * 0.25).normalized()
    for i, ln in enumerate((0.11, 0.09, 0.07)):
        td = (td + h * 0.25 + n * 0.12).normalized()
        end = pos + td * ln
        p.tube([pos, pos.lerp(end, 0.5), end], [0.026 - 0.004 * i, 0.021, 0.022 - 0.004 * i], BONE, sides=7)
        p.blob(end, (0.045, 0.045, 0.045), BONE_OLD, segments=7, rings=5)
        pos = end


def foot_parts(p, ankle, toe):
    """A long bony foot: heel, ankle knot, metatarsals and clawed toes on the flags."""
    a, t = Vector(ankle), Vector(toe)
    fwd = Vector((t.x - a.x, t.y - a.y, 0)).normalized()
    side = fwd.cross(Vector((0, 0, 1))).normalized()
    p.blob(a, (0.13, 0.13, 0.12), BONE_OLD, segments=10, rings=7)
    heel = a - fwd * 0.09 + Vector((0, 0, -0.15))
    p.blob(heel, (0.13, 0.16, 0.12), BONE, segments=10, rings=7)
    p.blob(a + fwd * 0.09 + Vector((0, 0, -0.1)), (0.17, 0.14, 0.1), BONE, segments=10, rings=6)
    for k, off in enumerate((-0.07, -0.025, 0.02, 0.06, 0.095)):
        base = a + fwd * 0.12 + side * off * 0.6 + Vector((0, 0, -0.12))
        ball = a + fwd * (0.34 - 0.03 * k) + side * off * 1.2 + Vector((0, 0, -0.19))
        p.tube([base, base.lerp(ball, 0.5) + Vector((0, 0, 0.012)), ball], [0.024, 0.019, 0.022], BONE, sides=6)
        p.blob(ball, (0.045, 0.045, 0.04), BONE_OLD, segments=7, rings=5)
        tip = ball + fwd * (0.14 - 0.02 * k) + side * off * 0.3 + Vector((0, 0, -0.03))
        p.tube([ball, ball.lerp(tip, 0.5) + Vector((0, 0, 0.012)), tip], [0.018, 0.014, 0.004], BONE_OLD, sides=5)


def ruff(p, c, r_mid=0.46, half_w=0.28, half_h=0.1, pleats=30, n_a=150, n_v=10):
    """The millstone ruff: a deep ring of linen set in figure-eight pleats, the outer
    edge rippling up and down, the folds shaded dark in their valleys."""
    before = set(p.bm.faces)
    grid, tone = [], {}
    for i in range(n_a):
        a = math.tau * i / n_a
        ph = pleats * a
        row = []
        for j in range(n_v):
            v = math.tau * j / n_v
            w = max(0.0, math.cos(v))
            rr = r_mid + math.cos(v) * half_w + 0.03 * math.cos(ph) * w
            z = math.sin(v) * half_h * (1.0 + 0.55 * math.cos(ph) * w) + 0.05 * math.sin(ph) * w ** 1.5
            pos = Vector(c) + Vector((math.sin(a) * rr, -math.cos(a) * rr * 0.96, z))
            vt = p.bm.verts.new(pos)
            tone[vt] = 0.62 + 0.38 * (0.5 + 0.5 * math.cos(ph)) * (0.4 + 0.6 * w)
            row.append(vt)
        grid.append(row)
    for i in range(n_a):
        for j in range(n_v):
            p.bm.faces.new((grid[i][j], grid[(i + 1) % n_a][j], grid[(i + 1) % n_a][(j + 1) % n_v],
                            grid[i][(j + 1) % n_v]))
    faces = p._new_faces(before)
    p._paint(faces, LINEN, MEMBRANE)
    for f in faces:
        for lp in f.loops:
            k = tone[lp.vert]
            lp[p.col] = (*lerp(LINEN_DIRT, LINEN, k), 1.0)


def organ_pipe(p, base, axis, height, r, glow_mouth=False):
    """One silver organ pipe of the crown: a conical foot, the mouth with its lip,
    the open top."""
    mk = p.mark()
    foot = 0.07
    p.lathe((0, 0, 0), [(0.006, 0.0), (r * 0.6, foot * 0.6), (r, foot), (r, height - 0.015), (r * 1.12, height - 0.01),
                        (r * 1.12, height), (r * 0.8, height), (r * 0.8, height - 0.03)], 10, SILVER, mat=METAL)
    mz = foot + 0.05
    p.box((0, -r * 0.92, mz + 0.03), (r * 1.2, r * 0.3, 0.06), SOCKET)
    p.box((0, -r * 1.02, mz), (r * 1.4, r * 0.25, 0.014), SILVER_HI, mat=METAL)
    if glow_mouth:
        p.box((0, -r * 0.85, mz + 0.03), (r * 0.8, r * 0.22, 0.04), SONG, mat=GLOW)
    rot = Vector((0, 0, 1)).rotation_difference(_n(axis)).to_matrix().to_4x4()
    p.turn(mk, Matrix.Translation(Vector(base)) @ rot)


def note_glyph(p, c, right, up, size=1.0, lines=True, head_col=SONG):
    """A stitched staff with a note on it: five silver lines and a violet note."""
    c, right, up = Vector(c), _n(right), _n(up)
    out = right.cross(up).normalized()
    if lines:
        for i in range(5):
            o = c + up * (i - 2) * 0.022 * size + out * 0.004
            p.tube([o - right * 0.075 * size, o + right * 0.075 * size], [0.0045 * size, 0.0045 * size], SILVER_DARK,
                   sides=4, mat=METAL)
    hd = c + up * 0.011 * size - right * 0.02 * size + out * 0.01
    p.blob(hd, (0.04 * size, 0.018, 0.028 * size), head_col, mat=GLOW, segments=8, rings=5)
    st = hd + right * 0.018 * size
    p.tube([st, st + up * 0.1 * size], [0.0055 * size, 0.0045 * size], head_col, mat=GLOW, sides=4)
    p.tube([st + up * 0.1 * size, st + up * 0.07 * size + right * 0.035 * size], [0.005 * size, 0.003 * size],
           head_col, mat=GLOW, sides=4)


def page_h(v):
    """The page block's height at `v` across one page: bowed up toward the spine."""
    return 0.048 + 0.034 * (1 - v / BOOK_W) ** 2


def slab(p, origin, ax_u, ax_v, ax_w, u0, u1, v0, v1, top, color, nu=4, nv=6, mat=BODY):
    """A closed block over [u0, u1] x [v0, v1] from w 0 up to `top(v)`."""
    before = set(p.bm.faces)
    o = Vector(origin)

    def at(u, v, w):
        return o + ax_u * u + ax_v * v + ax_w * w

    us = [u0 + (u1 - u0) * i / nu for i in range(nu + 1)]
    vs = [v0 + (v1 - v0) * j / nv for j in range(nv + 1)]
    tg = [[p.bm.verts.new(at(u, v, top(v))) for v in vs] for u in us]
    bg = [[p.bm.verts.new(at(u, v, 0.0)) for v in vs] for u in us]
    for i in range(nu):
        for j in range(nv):
            p.bm.faces.new((tg[i][j], tg[i + 1][j], tg[i + 1][j + 1], tg[i][j + 1]))
            p.bm.faces.new((bg[i][j + 1], bg[i + 1][j + 1], bg[i + 1][j], bg[i][j]))
    for i in range(nu):
        p.bm.faces.new((bg[i][0], bg[i + 1][0], tg[i + 1][0], tg[i][0]))
        p.bm.faces.new((tg[i][nv], tg[i + 1][nv], bg[i + 1][nv], bg[i][nv]))
    for j in range(nv):
        p.bm.faces.new((tg[0][j], tg[0][j + 1], bg[0][j + 1], bg[0][j]))
        p.bm.faces.new((bg[nu][j], bg[nu][j + 1], tg[nu][j + 1], tg[nu][j]))
    faces = p._new_faces(before)
    p._paint(faces, color, mat)
    for f in faces:
        for lp in f.loops:
            k = 0.85 + 0.15 * math.sin(lp.vert.co.x * 90 + lp.vert.co.z * 40)
            lp[p.col] = (*[c * k for c in color], 1.0)
    return faces


def build_parts():
    parts = []

    def part(name, bone, **kw):
        pt = Part(name, bone, **kw)
        parts.append(pt)
        return pt

    # --- the body under the vestments --------------------------------------------------------
    hips = part('HipsCore', 'Hips', subdiv=1)
    hips.loft([((0, 0.02, 2.82), 0.38, 0.3, 2.4, (0, 0, 1)), ((0, 0.02, 3.05), 0.42, 0.32, 2.4, (0, 0, 1)),
               ((0, 0.02, 3.28), 0.34, 0.27, 2.4, (0, 0, 1))], VIOLET_DARK, sides=16, mat=MEMBRANE)
    core = part('Bodice', 'Chest', subdiv=1)
    core.loft([((0, 0.02, 3.3), 0.36, 0.27, 2.4, (0, 0, 1)), ((0, 0.03, 3.7), 0.44, 0.31, 2.4, (0, 0, 1)),
               ((0, 0.04, 4.15), 0.55, 0.36, 2.6, (0, 0, 1)), ((0, 0.04, 4.55), 0.62, 0.37, 2.8, (0, 0, 1)),
               ((0, 0.04, 4.82), 0.26, 0.22, 2.2, (0, 0, 1))], VIOLET, sides=18, mat=MEMBRANE)
    # the neck: bare vertebrae rising out of the ruff
    for i, z in enumerate((4.86, 4.95, 5.04, 5.13)):
        cv = part(f'Cervical{i}', 'Neck', smooth=True)
        cv.blob((0, 0.04 - 0.012 * i, z), (0.15, 0.13, 0.075), lerp(BONE, BONE_OLD, 0.25 * i), segments=10, rings=6)
        cv.box((0, 0.13 - 0.012 * i, z), (0.04, 0.09, 0.05), BONE_OLD, bevel=0.01)
    # --- the ruff --------------------------------------------------------------------------------
    rf = part('Ruff', 'Chest', smooth=True)
    ruff(rf, (0, 0.03, 4.93))
    # --- the skull -------------------------------------------------------------------------------
    head = part('Skull', 'Head', smooth=True)
    hm = head.mark()
    sculpt_skull(head)
    # the upper teeth on the narrow jaw, two lost
    for k in range(10):
        if k in (2, 7):
            continue
        phi = (k - 4.5) * 0.105
        pos, n, _ = skull_point(phi, -0.98)
        head.box(tuple(pos + Vector((0, -0.006, -0.03))), (0.022, 0.02, 0.05 + 0.01 * (k % 2)), BONE_OLD, bevel=0.004,
                 yaw=-phi)
    # a hairline crack over the brow, lit from inside
    head.tube([Vector((0.06, -0.3, 5.82)), Vector((0.09, -0.27, 5.9)), Vector((0.07, -0.21, 5.97))],
              [0.007, 0.007, 0.002], SONG_DEEP, mat=GLOW, sides=4)
    head.turn(hm, HEAD_XF)
    jaw = part('Jaw', 'Jaw', smooth=True)
    jm = jaw.mark()
    path = [Vector((-0.158, -0.035, 5.39)), Vector((-0.162, -0.05, 5.27)), Vector((-0.15, -0.09, 5.175)),
            Vector((-0.1, -0.19, 5.15)), Vector((0.0, -0.245, 5.14)), Vector((0.1, -0.19, 5.15)),
            Vector((0.15, -0.09, 5.175)), Vector((0.162, -0.05, 5.27)), Vector((0.158, -0.035, 5.39))]
    jaw.tube(path, [0.02, 0.022, 0.024, 0.024, 0.026, 0.024, 0.024, 0.022, 0.02], BONE, sides=8, squash=2.1,
             up=(0, 0, 1))
    jaw.blob((0, -0.24, 5.12), (0.08, 0.05, 0.05), BONE_OLD, segments=8, rings=5)
    for k in range(9):
        if k in (1, 6):
            continue
        t = (k + 0.5) / 9
        x = -0.12 + 0.24 * t
        y = -0.245 + 0.11 * (x / 0.12) ** 2
        jaw.box((x, y + 0.004, 5.2), (0.021, 0.019, 0.045), BONE_OLD, bevel=0.004, yaw=math.atan2(x, 0.12))
    jaw.turn(jm, HEAD_XF)
    # the voice: violet light deep in the throat, seen when the jaw drops
    vc = part('Voice', 'Voice', smooth=True)
    vm = vc.mark()
    vc.blob(tuple(VOICE_AT + Vector((0, 0.04, 0))), (0.13, 0.11, 0.1), SONG_DEEP, mat=GLOW, segments=10, rings=6)
    vc.blob(tuple(VOICE_AT), (0.08, 0.06, 0.06), SONG, mat=GLOW, segments=10, rings=6)
    vc.blob(tuple(VOICE_AT + Vector((0, -0.02, 0))), (0.04, 0.03, 0.03), SONG_HOT, mat=GLOW, segments=8, rings=5)
    vc.turn(vm, HEAD_XF)
    # violet soul fire in the sockets, each on its flickering bone
    for s, tag in ((1, '.L'), (-1, '.R')):
        fl = part('FlameEye' + tag, 'FlameEye' + tag, smooth=True)
        e = Vector((s * EYE.x, EYE.y, EYE.z))
        fl.blob(e + Vector((0, 0.02, 0)), (0.085, 0.03, 0.08), SONG_DEEP, mat=GLOW, segments=10, rings=6)
        fl.blob(e, (0.055, 0.026, 0.052), SONG, mat=GLOW, segments=10, rings=6)
        fl.blob(e + Vector((0, -0.01, 0)), (0.028, 0.018, 0.028), SONG_HOT, mat=GLOW, segments=8, rings=6)
        fl.tube([e + Vector((0, -0.01, 0.02)), e + Vector((s * 0.012, -0.018, 0.07)),
                 e + Vector((s * 0.03, -0.012, 0.13)), e + Vector((s * 0.055, 0.0, 0.18))],
                [0.026, 0.018, 0.009, 0.001], [SONG_HOT, SONG, SONG, SONG_DEEP], mat=GLOW, sides=6)
    # --- the crown of organ pipes on its band ----------------------------------------------------
    cr = part('Crown', 'Head', smooth=True)
    ring = [band_point(math.tau * i / 40, 0.05) for i in range(41)]
    cr.tube(ring, [0.032] * 41, SILVER, sides=6, squash=1.9, cap=False, mat=METAL, up=(0, 0, 1))
    cr.tube([p + Vector((0, 0, -0.045)) for p in ring], [0.014] * 41, SILVER_DARK, sides=5, cap=False, mat=METAL)
    for i in range(0, 40, 4):
        cr.blob(tuple(ring[i] + (ring[i] - HEAD_XF @ SKULL_C).normalized() * 0.02), (0.04, 0.04, 0.045), BONE_OLD,
                segments=6, rings=4)
    heights = [0.44, 0.35, 0.35, 0.27, 0.27, 0.2, 0.2]
    for j, ht in enumerate(heights):
        side = 0 if j == 0 else (1 if j % 2 else -1)
        rank = (j + 1) // 2
        phi = side * rank * 0.3
        base = band_point(phi, 0.075) + Vector((0, 0, 0.02))
        outw = Vector((math.sin(phi), -math.cos(phi), 0)) * 0.12 + Vector((side * 0.05 * rank, 0, 0))
        organ_pipe(cr, base, Vector((0, 0, 1)) + outw * 0.6, ht, 0.05 - 0.005 * rank, glow_mouth=rank < 2)
    # --- the arms: surplice sleeves, the violet cuffs, bony wrists --------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        el, wr, fd, fu, fv = _sleeve_frame(tag)
        sh = Vector((s * SH_L.x, SH_L.y, SH_L.z))
        up = part('Sleeve' + tag, 'Arm' + tag, smooth=True, subdiv=1)
        up.tube([sh.lerp(el, t) for t in (0.0, 0.33, 0.66, 1.0)], [0.17, 0.145, 0.145, 0.17], LINEN, sides=10,
                mat=MEMBRANE)
        lo = part('Forearm' + tag, 'Fore' + tag, smooth=True, subdiv=1)
        lo.tube([el, el.lerp(wr, 0.2), el.lerp(wr, SLV_T + 0.02)], [0.17, 0.2, SLV_R + 0.005], LINEN, sides=12,
                cap=False, mat=MEMBRANE, up=tuple(fu))
        cuff = part('Cuff' + tag, 'Fore' + tag, smooth=True)
        cuff.tube([el.lerp(wr, 0.4), el.lerp(wr, 0.68), el.lerp(wr, 0.84)], [0.13, 0.12, 0.115], VIOLET, sides=10,
                  mat=MEMBRANE, up=tuple(fu))
        cuff.tube([el.lerp(wr, 0.83), el.lerp(wr, 0.86)], [0.122, 0.122], SILVER_DARK, sides=10, mat=METAL,
                  up=tuple(fu))
        for off, r in ((0.035, 0.03), (-0.03, 0.024)):
            cuff.tube([el.lerp(wr, 0.84) + fu * off, el.lerp(wr, 0.97) + fu * off * 0.7], [r, r * 0.9], BONE, sides=6)
        hand = part('Hand' + tag, 'Hand' + tag, smooth=True)
        if s > 0:
            open_hand(hand, WR_L, H_L, N_L)
        else:
            fist(hand, WR_R, H_R, A_R, N_R, rings=(1,), bar=0.042)
    # --- the hymnal ------------------------------------------------------------------------------
    for tag, side in (('PageA', 1), ('PageB', -1)):
        bk = part(tag, tag, smooth=True)
        x = BOOK_X * side
        hl = H_L
        nn = N_L
        # the cover (black leather, a hair larger than the pages)
        secs = []
        for i in range(7):
            u = -BOOK_HALF - 0.02 + (2 * BOOK_HALF + 0.04) * i / 6
            secs.append((tuple(BOOK_C + hl * u + x * (BOOK_W * 0.5 + 0.02) - nn * 0.012), BOOK_W * 0.5 + 0.03, 0.014,
                         6.0, tuple(hl)))
        bk.loft(secs, LEATHER, sides=12)
        # the page block, bowed up toward the spine, and three staves of violet notes on it
        slab(bk, BOOK_C, hl, x, nn, -BOOK_HALF + 0.01, BOOK_HALF - 0.01, 0.018, BOOK_W - 0.01, page_h, PAGE)
        for st in range(3):
            u = -0.17 + st * 0.17
            for ln in range(5):
                uu = u + (ln - 2) * 0.013
                pts = [BOOK_C + hl * uu + x * v + nn * (page_h(v) + 0.003) for v in (0.05, 0.2, BOOK_W - 0.04)]
                bk.tube(pts, [0.0035] * 3, INK, sides=4)
            for nidx in range(4):
                v = 0.09 + nidx * 0.08
                hp = BOOK_C + hl * (u + (((nidx * 7 + st * 3) % 5) - 2) * 0.013) + x * v + nn * (page_h(v) + 0.008)
                bk.blob(tuple(hp), (0.022, 0.016, 0.012), SONG, mat=GLOW, segments=6, rings=4)
        # silver corners and the clasp on the fore edge, a boss on the cover
        for u in (-BOOK_HALF, BOOK_HALF):
            cc = BOOK_C + hl * u + x * (BOOK_W + 0.01) - nn * 0.01
            bk.box(tuple(cc), (0.06 + abs(x.x) * 0.0, 0.06, 0.035), SILVER, mat=METAL, bevel=0.006)
        bk.box(tuple(BOOK_C + x * (BOOK_W + 0.04) + nn * 0.01), (0.04, 0.09, 0.05), SILVER, mat=METAL, bevel=0.008)
        boss = BOOK_C + x * (BOOK_W * 0.5 + 0.02) - nn * 0.032
        bk.blob(tuple(boss), (0.12, 0.12, 0.03), SILVER, mat=METAL, segments=10, rings=5)
        bk.blob(tuple(boss - nn * 0.012), (0.05, 0.05, 0.02), SONG_DEEP, mat=GLOW, segments=8, rings=4)
    spine = part('BookSpine', 'Hymnal', smooth=True)
    spine.tube([SPINE0 - H_L * 0.02 - N_L * 0.01, SPINE1 + H_L * 0.02 - N_L * 0.01], [0.035, 0.035], LEATHER, sides=8)
    for u in (-0.2, 0.0, 0.2):
        c = BOOK_C + H_L * u - N_L * 0.01
        spine.tube([c - H_L * 0.015, c + H_L * 0.015], [0.042, 0.042], SILVER, sides=8, mat=METAL)
    # --- the baton: a long finger bone, joint on joint, the violet light at its tip -------------
    bt = part('Baton', 'Baton', smooth=True)
    c = Vector(FIST_C)
    a = A_R
    bt.blob(tuple(c - a * 0.2), (0.1, 0.1, 0.11), BONE_OLD, segments=8, rings=6)          # the knuckle end
    bt.tube([c - a * 0.25, c - a * 0.29], [0.06, 0.02], SILVER, sides=8, mat=METAL)
    joints = [0.0, 0.5, 0.92, BATON_LEN - 0.08]
    radii = [0.058, 0.05, 0.04, 0.028]
    for i in range(3):
        j0, j1 = joints[i], joints[i + 1]
        p0, p1 = c + a * (j0 + 0.04), c + a * (j1 - 0.04)
        r0, r1 = radii[i], radii[i + 1]
        bt.tube([p0, p0.lerp(p1, 0.3), p0.lerp(p1, 0.7), p1], [r0 * 1.15, r0 * 0.82, r1 * 0.9, r1 * 1.12],
                lerp(BONE, BONE_OLD, 0.2 * i), sides=8)
        if i > 0:
            bt.blob(tuple(c + a * j0), (r0 * 2.6, r0 * 2.6, r0 * 2.2), BONE_OLD, segments=8, rings=5)
            bt.tube([c + a * (j0 - 0.012), c + a * (j0 + 0.012)], [r0 * 1.45, r0 * 1.45], SILVER, sides=8, mat=METAL)
    bt.tube([c + a * (BATON_LEN - 0.08), c + a * (BATON_LEN - 0.02)], [0.024, 0.016], SILVER, sides=8, mat=METAL)
    lt = part('BatonLight', 'BatonLight', smooth=True)
    tip = Vector(BATON_TIP)
    lt.blob(tuple(tip), (0.17, 0.17, 0.17), SONG_DEEP, mat=GLOW, segments=10, rings=6)
    lt.blob(tuple(tip), (0.1, 0.1, 0.1), SONG, mat=GLOW, segments=10, rings=6)
    lt.blob(tuple(tip), (0.035, 0.035, 0.035), SONG_HOT, mat=GLOW, segments=8, rings=5)
    lt.tube([tip + a * 0.03, tip + a * 0.1, tip + a * 0.17], [0.03, 0.015, 0.001], [SONG_HOT, SONG, SONG_DEEP],
            mat=GLOW, sides=5)
    # --- the legs: long bare bones, the feet on the flags ----------------------------------------
    for s, tag in ((1, '.L'), (-1, '.R')):
        hp = Vector((s * HIP_L.x, HIP_L.y, HIP_L.z))
        kn = Vector((s * KNEE_L.x, KNEE_L.y, KNEE_L.z))
        an = Vector((s * ANKLE_L.x, ANKLE_L.y, ANKLE_L.z))
        to = Vector((s * TOE_L.x, TOE_L.y, TOE_L.z))
        th = part('Thigh' + tag, 'Thigh' + tag, smooth=True)
        th.blob(tuple(hp), (0.17, 0.17, 0.17), BONE_OLD, segments=8, rings=6)
        th.tube([hp.lerp(kn, t) for t in (0.05, 0.4, 0.8, 0.95)], [0.07, 0.058, 0.062, 0.075], BONE, sides=8)
        th.blob(tuple(kn + Vector((0, 0, 0.06))), (0.18, 0.15, 0.13), BONE_OLD, segments=8, rings=6)
        sn = part('Shin' + tag, 'Shin' + tag, smooth=True)
        sn.blob(tuple(kn + Vector((0, -0.07, 0))), (0.1, 0.07, 0.11), BONE, segments=8, rings=6)
        sn.tube([kn.lerp(an, t) for t in (0.05, 0.45, 0.9)], [0.062, 0.048, 0.052], BONE, sides=8)
        sn.tube([kn.lerp(an, t) + Vector((s * 0.06, 0.03, 0)) for t in (0.08, 0.5, 0.92)], [0.025, 0.02, 0.024],
                BONE_OLD, sides=6)
        ft = part('Foot' + tag, 'Foot' + tag, smooth=True)
        foot_parts(ft, an, to)
    return parts


# ------------------------------------------------------------------- membranes
def build_membranes():
    mems = []
    # The cassock: faded violet from the waist to a torn hem gone black with soot.
    cas = Membrane('Cassock', VIOLET, seed=11)
    spars = []
    for k in range(CAS):
        _, p = cas_spar(k)
        a0, a1, b1, c1 = (Vector(x) for x in p)
        spars.append([(tuple(a0), 'Hips'), (tuple(a1), f'Cas{k}a'), (tuple(a1.lerp(b1, 0.5)), f'Cas{k}b'),
                      (tuple(b1), f'Cas{k}b'), (tuple(b1.lerp(c1, 0.5)), f'Cas{k}c'), (tuple(c1), f'Cas{k}c')])
    for k in range(CAS):
        cas.panel(spars[k], spars[(k + 1) % CAS], rows=26, cols=4, scallop=0.04, tear=0.55, shade=0.95, reach=1.0)
    for i, (co, _) in enumerate(cas.verts):
        k = max(0.0, min(1.0, (1.25 - co.z) / 1.1))
        cas.cols_rgb[i] = lerp(cas.cols_rgb[i], SOOT, k ** 1.2 * 0.92)
    mems.append(cas)
    # The surplice: white linen from the collar to a torn lace hem at mid-thigh.
    sur = Membrane('Surplice', LINEN, seed=21)
    ss = []
    for k in range(SUR):
        a, p = sur_spar(k)
        sx = math.sin(a)
        mid = 'Chest'
        if abs(sx) > 0.72:
            mid = 'Arm.L' if sx > 0 else 'Arm.R'
        c0, c1, c2, c3, c4 = (Vector(x) for x in p)
        ss.append([(tuple(c0), 'Chest'), (tuple(c1), mid), (tuple(c2), 'Chest'), (tuple(c2.lerp(c3, 0.5)), f'Sur{k}a'),
                   (tuple(c3), f'Sur{k}a'), (tuple(c3.lerp(c4, 0.5)), f'Sur{k}b'), (tuple(c4), f'Sur{k}b')])
    for k in range(SUR):
        sur.panel(ss[k], ss[(k + 1) % SUR], rows=22, cols=5, scallop=0.05, tear=1.25, shade=0.92, sag=0.0)
    for i, (co, _) in enumerate(sur.verts):
        k = max(0.0, min(1.0, (2.6 - co.z) / 0.6))
        sur.cols_rgb[i] = lerp(sur.cols_rgb[i], LINEN_DIRT, k ** 1.5 * 0.7)
    mems.append(sur)
    # The hanging sleeves: bells of surplice linen falling from the forearms.
    for s, tag in ((1, '.L'), (-1, '.R')):
        sl = Membrane('SleeveBell' + tag, LINEN, seed=31 + s)
        sp = []
        for k in range(SLV):
            root, hang, _ = sleeve_spar('.L', k)
            if s < 0:
                root = Vector((-root.x, root.y, root.z))
                hang = Vector((-hang.x, hang.y, hang.z))
            bn = f'Slv{k}{tag}'
            sp.append([(tuple(root), 'Fore' + tag), (tuple(root + hang * SLV_LEN * 0.4), bn),
                       (tuple(root + hang * SLV_LEN), bn)])
        for k in range(SLV):
            a, b = (sp[k], sp[(k + 1) % SLV]) if s > 0 else (sp[(k + 1) % SLV], sp[k])
            sl.panel(a, b, rows=9, cols=3, scallop=0.06, tear=1.1, shade=0.95)
        for i, (co, w) in enumerate(sl.verts):
            tip = sum(x for b, x in w.items() if b.startswith('Slv'))
            sl.cols_rgb[i] = lerp(sl.cols_rgb[i], LINEN_DIRT, max(0.0, tip - 0.5) * 1.2)
        mems.append(sl)
    # The veil: black lace from the crown's band over the ruff, down her back.
    vl = Membrane('Veil', LACE, seed=41)
    vs = []
    for i in range(VEIL):
        _, p = veil_spar(i)
        vs.append([(tuple(p[0]), 'Head'), (tuple(p[0].lerp(p[1], 0.5)), f'Veil{i}a'), (tuple(p[1]), f'Veil{i}a'),
                   (tuple(p[1].lerp(p[2], 0.5)), f'Veil{i}b'), (tuple(p[2]), f'Veil{i}b')])
    for i in range(VEIL - 1):
        vl.panel(vs[i], vs[i + 1], rows=16, cols=5, scallop=0.08, tear=1.0, shade=1.1)
    for i, (co, _) in enumerate(vl.verts):
        # lace: the cells alternate a little lighter, the edge a hair of grey
        vl.cols_rgb[i] = lerp(vl.cols_rgb[i], LACE_HI, 0.35 * (0.5 + 0.5 * math.sin(co.z * 31 + co.x * 23)))
    mems.append(vl)
    # Her hair: long pale strands under the veil, straggling out below it.
    hr = Membrane('Hair', HAIR, seed=53)
    hs = []
    for i in range(VEIL):
        _, p = veil_spar(i)
        r = Vector((p[1].x, p[1].y - 0.05, 0)).normalized()
        top = p[0] + Vector((0, 0, -0.04)) - r * 0.02
        nape = p[1] - r * 0.06
        end = p[2] + (p[2] - p[1]) * 0.42 - r * 0.08
        hs.append([(tuple(top), 'Head'), (tuple(top.lerp(nape, 0.5)), f'Veil{i}a'), (tuple(nape), f'Veil{i}a'),
                   (tuple(nape.lerp(end, 0.5)), f'Veil{i}b'), (tuple(end), f'Veil{i}b')])
    for i in range(VEIL - 1):
        hr.panel(hs[i], hs[i + 1], rows=16, cols=6, scallop=0.0, tear=2.4, shade=1.0)
    for i, (co, _) in enumerate(hr.verts):
        hr.cols_rgb[i] = lerp(HAIR, HAIR_DARK, 0.5 + 0.5 * math.sin(co.x * 57 + co.y * 41))
    mems.append(hr)
    # The stole: two bands of deep violet from the shoulders down the front to the knee.
    for s, tag in ((1, 'L'), (-1, 'R')):
        st = Membrane('Stole' + tag, VIOLET_DEEP, seed=61 + s)
        ks = 1 if s > 0 else SUR - 1
        kc = 1 if s > 0 else CAS - 1
        inner, outer = [], []
        for x0, side in ((0.24, inner), (0.42, outer)):
            for (x, y, z), bone in (((x0 + 0.02, -0.33, 4.74), 'Chest'), ((x0, -0.52, 4.3), 'Chest'),
                                    ((x0, -0.56, 3.8), 'Chest'), ((x0 - 0.01, -0.55, 3.4), f'Sur{ks}a'),
                                    ((x0 - 0.01, -0.64, 2.9), f'Sur{ks}b'), ((x0, -0.76, 2.45), f'Sur{ks}b'),
                                    ((x0 + 0.01, -0.8, 1.55), f'Cas{kc}b'), ((x0 + 0.02, -0.78, 1.32), f'Cas{kc}b')):
                side.append(((s * x, y, z), bone))
        st.panel(inner, outer, rows=30, cols=4, scallop=0.0, tear=0.0, shade=1.0)
        for i, (co, w) in enumerate(st.verts):
            if i % 5 in (0, 4):
                st.cols_rgb[i] = SILVER
        mems.append(st)
    return mems


def build_stole_notes():
    """The stole's stitched notation: silver staves with violet notes, on the bones the
    stole rides at each station, and its silver-weighted fringe."""
    parts = []
    for s in (1, -1):
        ks = 1 if s > 0 else SUR - 1
        kc = 1 if s > 0 else CAS - 1
        for z, y, bone in ((4.3, -0.535, 'Chest'), (3.8, -0.575, 'Chest'), (3.4, -0.565, f'Sur{ks}a'),
                           (2.45, -0.775, f'Sur{ks}b'), (1.55, -0.815, f'Cas{kc}b')):
            p = Part(f'Note{z}{s}', bone, smooth=True)
            note_glyph(p, (s * 0.33, y, z), (1, 0, 0), (0, 0, 1), size=1.0)
            parts.append(p)
        p = Part(f'StoleEnd{s}', f'Cas{kc}b', smooth=True)
        e = Vector((s * 0.34, -0.8, 1.3))
        p.tube([e + Vector((-0.1, 0, 0)), e + Vector((0.1, 0, 0))], [0.022, 0.022], SILVER, sides=6, mat=METAL)
        for j in range(8):
            x = -0.085 + 0.024 * j
            p.tube([e + Vector((x, 0, -0.01)), e + Vector((x, -0.01, -0.12 - 0.04 * (j % 3)))], [0.008, 0.004],
                   VIOLET_DEEP, sides=4)
        parts.append(p)
    return parts


def face_out(obj):
    """Turn every face of a cloth membrane to face away from what it hangs round (the
    body's axis; a sleeve's forearm), so the bake's occlusion lands on the inside."""
    import bmesh
    name = obj.name
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    if name.startswith('SleeveBell'):
        s = 1 if name.endswith('.L') else -1
        el = Vector((s * EL_L.x, EL_L.y, EL_L.z))
        wr = Vector((s * WR_L.x, WR_L.y, WR_L.z))
        d = (wr - el).normalized()

        def axis(c):
            return el + d * (c - el).dot(d)
    else:
        def axis(c):
            return Vector((0.0, 0.03, c.z))
    flipped = 0
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.dot(c - axis(c)) < 0:
            f.normal_flip()
            flipped += 1
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return flipped


# -------------------------------------------------------------------- posing
def key_pose(arm, pose, frame):
    scales = pose.get('__scale', {})
    locs = pose.get('__loc', {})
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        q = pose.get(pb.name)
        pb.rotation_quaternion = q if q is not None else (1, 0, 0, 0)
        pb.location = locs.get(pb.name, (0, 0, 0))
        s = scales.get(pb.name, 1.0)
        pb.scale = (s, s, s) if isinstance(s, (int, float)) else s
    rb = arm.pose.bones['Root']
    rb.location = rb.bone.matrix_local.to_3x3().inverted() @ pose['__root']
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)
        if pb.name not in FLICKER:
            pb.keyframe_insert('scale', frame=frame)


def clip(arm, name, keys, loop_clip=True, fire=None, voice=None):
    """keys [(frame, pose)]; `fire` [(frame, level)] the eyes' and the baton light's
    flicker size, `voice` the song in her throat (0 hidden, 1 a full note)."""
    import bpy
    from creature_kit import _fcurves
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for frame, pose in keys:
        key_pose(arm, pose, frame)
    # Quaternion continuity: q and -q are one turn, but the curves interpolate the
    # components, so a key on the far hemisphere spins the long way round. Every key is
    # flipped onto the previous key's hemisphere (the key poses are unchanged).
    quat = {}
    for fc in _fcurves(act):
        if fc.data_path.endswith('rotation_quaternion'):
            quat.setdefault(fc.data_path, {})[fc.array_index] = fc
    for chans in quat.values():
        if len(chans) != 4:
            continue
        fcs = [chans[i] for i in range(4)]
        prev = None
        for k in range(len(fcs[0].keyframe_points)):
            q = [fc.keyframe_points[k].co[1] for fc in fcs]
            if prev is not None and sum(x * y for x, y in zip(prev, q)) < 0:
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
    start, end = keys[0][0], keys[-1][0]

    def level(curve, f):
        curve = curve or [(start, 1.0), (end, 1.0)]
        for (fa, la), (fb, lb) in zip(curve, curve[1:]):
            if fa <= f <= fb:
                return la + (lb - la) * (f - fa) / max(1, fb - fa)
        return curve[-1][1] if f > curve[-1][0] else curve[0][1]

    seed = sum(ord(c) for c in name)
    voice = voice or [(start, 0.25), (end, 0.25)]
    for f in range(start, end + 1, 2):
        last = f + 2 > end
        ff = start if (loop_clip and last) else f
        for bi, bname in enumerate(FIRE_BONES + VOICE_BONES):
            pb = arm.pose.bones[bname]
            j = _hash(seed + bi * 7, ff)
            k = _hash(seed + bi * 13 + 3, ff)
            if bname in VOICE_BONES:
                lv = level(voice, ff)
                s = max(0.001, lv) * (0.88 + 0.24 * j)
                pb.scale = (s * (0.95 + 0.1 * k), s * (0.95 + 0.1 * k), s * (0.9 + 0.2 * j))
            else:
                lv = level(fire, ff)
                s = max(0.001, lv) * (0.84 + 0.28 * j)
                pb.scale = (s * (0.9 + 0.15 * k), s * (0.9 + 0.15 * k), s * (0.85 + 0.4 * j))
            pb.keyframe_insert('scale', frame=f)
        if last and f != end:
            for bname in FIRE_BONES + VOICE_BONES:
                arm.pose.bones[bname].keyframe_insert('scale', frame=end)
    for fc in _fcurves(act):
        if fc.data_path.endswith('scale') and any(f'"{b}"' in fc.data_path for b in FLICKER):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    return act


def frame_quat(x0, y0, x1, y1):
    """The world turn taking the rest frame (x0, y0) onto (x1, y1)."""
    x0, y0 = _n(x0), _n(y0)
    x1, y1 = _n(x1), _n(y1)
    y1 = (y1 - x1 * x1.dot(y1)).normalized()
    r0 = Matrix((x0, y0, x0.cross(y0))).transposed()
    r1 = Matrix((x1, y1, x1.cross(y1))).transposed()
    return (r1 @ r0.transposed()).to_quaternion()


def _slerp_dir(a, b, t):
    a, b = _n(a), _n(b)
    ang = a.angle(b)
    if ang < 1e-6:
        return a
    return (a * math.sin((1 - t) * ang) + b * math.sin(t * ang)) / math.sin(ang)


def _clamp_dir(a, b, max_deg):
    a, b = _n(a), _n(b)
    ang = a.angle(b)
    if ang <= math.radians(max_deg):
        return b
    return _slerp_dir(a, b, math.radians(max_deg) / ang)


DIAG = []   # (clip, frame, right wrist bend, left wrist bend, hem fixes)
FLOOR = 0.1


def make_clips(arm):
    rig = RollRig(BONES).attach(arm)
    P = rig.pose
    clips = []
    chest_rest = REST['Chest'][0]
    l_up = LEN['Arm.L']
    l_fore = LEN['Fore.L']
    foot_rest = (TOE_L - ANKLE_L).normalized()
    rest_dirs = {n: (t - h).normalized() for n, (h, t) in REST.items()}

    def add(name, keys, loop_clip=True, fire=None, voice=None):
        for f, pose in keys:
            dg = pose.get('__diag')
            if dg:
                DIAG.append((name, f) + dg)
        clip(arm, name, keys, loop_clip, fire, voice)
        clips.append(name)

    def stance(root=(0, 0, -0.05), yaw=0.0, tilt=0.0, roll=0.0, lean=0.0, side=0.0, twist=0.0,
               look=(0.0, -0.07, 1.0), jaw=4.0, bow=None,
               feet=None, knee_pole=(0.0, -1.0, 0.25),
               r_wrist=(-0.95, -0.55, 4.5), r_baton=(0.2, -0.45, 0.87), r_pole=(-1.0, 0.6, -0.3), r_bend=32.0,
               r_frame='chest',
               l_wrist=(0.9, -0.62, 3.65), l_h=None, l_n=(0.0, 0.15, 1.0), l_pole=(1.0, 0.6, -0.3), l_bend=35.0,
               l_frame='chest',
               book=1.0, flap=0.0, book_at=None, book_h=None, book_n=None,
               flutter=0.0, stream=0.0, splay=0.0, veil=(0.0, 0.0), legs_cloth=1.0, drape=0.0):
        """One pose. The body (`root`, whole-body `yaw` / `tilt` / `roll` degrees about the
        floor, `lean`, `side`, `twist` through the spine and chest, `look` the head's aim,
        `jaw` degrees open), the feet planted where `feet` says ({'.L': (ankle, foot
        dir)}, world), the hands placed in the chest's frame (`r_frame`/`l_frame` 'root'
        for the body's frame): the right wrist, the baton's direction (it runs through
        the fist, so the wrist bends at most `r_bend` toward it); the left wrist, its
        fingers `l_h` (default: on from the forearm) and palm `l_n`. `book` opens the
        hymnal (1 open, 0 shut); `book_at` hangs it in the air (world) with its spine
        along `book_h` and its pages facing `book_n`. The cloth: `flutter` phase,
        `stream` (trailing back), `splay` (flaring out), `veil` sway (x, y)."""
        feet = dict(feet or {})
        feet.setdefault('.L', ((0.38, 0.02, 0.24), tuple(foot_rest)))
        feet.setdefault('.R', ((-0.38, 0.02, 0.24), tuple(Vector((-foot_rest.x, foot_rest.y, foot_rest.z)))))
        neck_dir = _n(Vector((0, -0.04, 1.0)) * 0.6 + _n(look) * 0.4)
        if bow is None:
            spine_dir, chest_dir = (side * 0.4, 0.03 - lean * 0.6, 1.0), (side * 0.6, 0.02 - lean, 1.0)
        else:
            b = math.radians(bow)
            spine_dir = (side * 0.4, -math.sin(b * 0.55), math.cos(b * 0.55))
            chest_dir = (side * 0.6, -math.sin(b), math.cos(b))
        aims = {
            'Spine': spine_dir,
            'Chest': chest_dir,
            'Neck': tuple(neck_dir),
            'Head': tuple(_n(look)),
        }
        for s in ('.L', '.R'):
            aims['Foot' + s] = tuple(_n(feet[s][1]))
        turns = {
            'Root': [('y', roll), ('x', tilt), ('z', yaw)],
            'Spine': [('z', twist * 0.4)],
            'Chest': [('z', twist * 0.6)],
            'Jaw': [('x', jaw)],
            'PageA': [((0, -1, 0), 88.0 * (1 - book) + flap)],
            'PageB': [((0, -1, 0), -88.0 * (1 - book) - flap * 0.7)],
        }
        ik = {}
        for s in ('.L', '.R'):
            sx = 1 if s == '.L' else -1
            kp = Vector(knee_pole)
            ik['leg' + s] = ('Thigh' + s, 'Shin' + s, tuple(feet[s][0]), (sx * 0.15 + kp.x * sx, kp.y, kp.z))
        # pass one: the body and the legs alone
        one = P(aims=dict(aims), ik=ik, turns=turns, root=root)
        hd, dl = one['__head'], one['__delta']
        rr = dl['Root']
        ch_h, ch_d = hd['Chest'], dl['Chest']

        def place(v, frame):
            v = Vector(v)
            if frame == 'chest':
                return ch_h + ch_d @ (v - chest_rest)
            if frame == 'world':
                return v
            return hd['Root'] + rr @ v

        def turnv(v, frame):
            v = Vector(v)
            if frame == 'world':
                return v
            return (ch_d if frame == 'chest' else rr) @ v

        # the arms: two-bone onto the wrists
        bends = {}
        absolute = {}
        for s, wrist, pole, frame in (('.R', r_wrist, r_pole, r_frame), ('.L', l_wrist, l_pole, l_frame)):
            sh = hd['Arm' + s]
            w = place(wrist, frame)
            d1, d2 = two_bone(sh, l_up, l_fore, w, turnv(pole, frame))
            aims['Arm' + s] = tuple(d1)
            aims['Fore' + s] = tuple(d2)
            f = d2
            if s == '.R':
                bd = _n(turnv(r_baton, r_frame))
                perp = bd - f * f.dot(bd)
                perp = perp.normalized() if perp.length > 1e-5 else f.orthogonal().normalized()
                bd_eff = _clamp_dir(perp, bd, r_bend)
                h = (f - bd_eff * f.dot(bd_eff)).normalized()
                absolute['Hand.R'] = frame_quat(H_R, A_R, h, bd_eff)
                bends[s] = math.degrees(f.angle(h))
                palm = absolute['Hand.R'] @ N_R
            else:
                h = _n(turnv(l_h, l_frame)) if l_h is not None else f
                h = _clamp_dir(f, h, l_bend)
                nn = _n(turnv(l_n, l_frame))
                absolute['Hand.L'] = frame_quat(H_L, N_L, h, nn)
                bends[s] = math.degrees(f.angle(h))
                palm = absolute['Hand.L'] @ N_L
            # The forearm carries the hand's twist (pronation): its frame is the aimed
            # direction plus the palm's normal, so it never takes the swing-only twist,
            # which jumps where the forearm points near the opposite of its rest.
            fr = rest_dirs['Fore' + s]
            n0 = N_R if s == '.R' else N_L
            ref0 = n0 - fr * fr.dot(n0)
            ref1 = palm - f * f.dot(palm)
            if ref0.length > 1e-4 and ref1.length > 1e-4:
                absolute['Fore' + s] = frame_quat(fr, ref0, f, ref1)
        if book_at is not None:
            absolute['Hymnal'] = frame_quat(H_L, N_L, _n(book_h), _n(book_n))
        # the cloth: the cassock and the surplice follow the legs and the motion
        pitch = {}
        for s in ('.L', '.R'):
            dt = dl['Thigh' + s] @ rest_dirs['Thigh' + s]
            dsh = dl['Shin' + s] @ rest_dirs['Shin' + s]
            pitch[s] = (math.degrees(math.atan2(-dt.y, -dt.z)), math.degrees(math.atan2(-dsh.y, -dsh.z)))
        for k in range(CAS):
            a, _ = cas_spar(k)
            sx = math.sin(a)
            wl = max(0.0, min(1.0, 0.5 + 0.9 * sx))
            fol = (0.55 + 0.35 * math.cos(a)) * legs_cloth
            th = wl * pitch['.L'][0] + (1 - wl) * pitch['.R'][0]
            sh_ = wl * (pitch['.L'][1] - pitch['.L'][0]) + (1 - wl) * (pitch['.R'][1] - pitch['.R'][0])
            out = (-math.cos(a), -math.sin(a), 0.0)
            ph = flutter + k * 0.9
            turns[f'Cas{k}a'] = [('x', stream * 3), (out, splay * 5 + 1.5 * math.sin(ph))]
            turns[f'Cas{k}b'] = [('x', -th * fol + stream * 8), (out, splay * 8 + 2.5 * math.sin(ph + 0.7))]
            turns[f'Cas{k}c'] = [('x', -sh_ * fol * 0.75 + stream * 12 + 3 * math.sin(ph + 1.4)),
                                 (out, splay * 10 + 3.5 * math.sin(ph * 1.3))]
        for k in range(SUR):
            a, _ = sur_spar(k)
            sx = math.sin(a)
            wl = max(0.0, min(1.0, 0.5 + 0.9 * sx))
            fol = (0.25 + 0.3 * math.cos(a)) * legs_cloth
            th = wl * pitch['.L'][0] + (1 - wl) * pitch['.R'][0]
            out = (-math.cos(a), -math.sin(a), 0.0)
            ph = flutter * 1.2 + k * 1.1
            turns[f'Sur{k}a'] = [('x', stream * 2), (out, splay * 4 + 1.0 * math.sin(ph))]
            turns[f'Sur{k}b'] = [('x', -th * fol + stream * 10 + 2.5 * math.sin(ph + 0.5)),
                                 (out, splay * 9 + 3 * math.sin(ph * 1.2))]
        if drape > 0:
            # fallen forward, the surplice slides off her back toward the floor
            for k in range(SUR):
                a, _ = sur_spar(k)
                radial = Vector((math.sin(a), -math.cos(a), 0.0))
                cur = ch_d @ rest_dirs[f'Sur{k}b']
                aims[f'Sur{k}b'] = tuple(_n(cur * (1 - drape) + Vector((0, 0, -1)) * drape + radial * 0.12 * drape))
                turns[f'Sur{k}b'] = []
        # the veil and the hair hang from the crown: aimed in the chest's frame, pulled to the floor
        down = Vector((0, 0, -1))
        for i in range(VEIL):
            phi = VEIL_PHI[i]
            radial = Vector((math.sin(phi), -math.cos(phi), 0.0))
            base = ch_d @ rest_dirs[f'Veil{i}b']
            want = _n(base * 0.7 + down * 0.3 + Vector((veil[0], veil[1] + stream * 0.35, 0.0))
                      + radial * splay * 0.15
                      + Vector((0.04 * math.sin(flutter + i), 0.05 * math.sin(flutter * 1.3 + i * 0.7), 0)))
            aims[f'Veil{i}b'] = tuple(want)
        # the hanging sleeves fall from the forearm toward the floor
        for s in ('.L', '.R'):
            fd = _n(aims['Fore' + s])
            for k in range(SLV):
                root_, hang, ring = sleeve_spar('.L', k)
                if s == '.R':
                    hang = Vector((-hang.x, hang.y, hang.z))
                rest_fore = rest_dirs['Fore' + s]
                rot = rest_fore.rotation_difference(fd)
                h_now = rot @ hang
                want = _n(h_now * 0.45 + down * 0.55 + Vector((0, stream * 0.3, 0))
                          + Vector((0.05 * math.sin(flutter + k), 0.05 * math.cos(flutter + k), 0)))
                aims[f'Slv{k}{s}'] = tuple(want)
        # pass two: everything
        two = P(aims=dict(aims), ik=ik, turns=turns, root=root, absolute=dict(absolute))
        # the floor guard: cloth the pose pushes under the flags swings out until it clears,
        # the thigh-length spars first, then (re-posed) the hems below them
        fixes = 0

        def guard(stage, pose):
            nonlocal fixes
            hdg, dlg = pose['__head'], pose['__delta']
            hit = 0
            for bn, parent, a in stage:
                head = hdg[bn]
                vec = dlg[bn] @ (REST[bn][1] - REST[bn][0])
                if head.z + vec.z >= FLOOR:
                    continue
                ax_w = dlg['Root'] @ Vector((-math.cos(a), -math.sin(a), 0.0))
                best = 180
                for deg in range(5, 181, 5):
                    v = Quaternion(ax_w, math.radians(deg)) @ vec
                    if head.z + v.z >= FLOOR:
                        best = deg
                        break
                local_ax = dlg[parent].inverted() @ ax_w
                turns[bn] = list(turns.get(bn, [])) + [(tuple(local_ax), float(best))]
                hit += 1
            fixes += hit
            return hit

        if guard([(f'Cas{k}b', f'Cas{k}a', cas_spar(k)[0]) for k in range(CAS)], two):
            two = P(aims=dict(aims), ik=ik, turns=turns, root=root, absolute=dict(absolute))
        guard([(f'Cas{k}c', f'Cas{k}b', cas_spar(k)[0]) for k in range(CAS)]
              + [(f'Sur{k}b', f'Sur{k}a', sur_spar(k)[0]) for k in range(SUR)], two)
        hd2 = two['__head']
        for prefix in ('Veil', 'Slv'):
            for bn in [b for b in aims if b.startswith(prefix) and (b.endswith('b') or prefix == 'Slv')]:
                head = hd2[bn]
                d = _n(aims[bn])
                ln = LEN[bn]
                if head.z + d.z * ln < FLOOR:
                    flat = Vector((d.x, d.y, 0.0))
                    flat = flat.normalized() if flat.length > 1e-4 else Vector((0, 1, 0))
                    dz = max(-1.0, min(1.0, (FLOOR - head.z) / ln))
                    aims[bn] = tuple(_n(flat * math.sqrt(max(0.0, 1 - dz * dz)) + Vector((0, 0, dz))))
                    fixes += 1
        out = P(aims=aims, ik=ik, turns=turns, root=root, absolute=absolute) if fixes else two
        if book_at is not None:
            hd3, dl3 = out['__head'], out['__delta']
            disp = Vector(book_at) - hd3['Hymnal']
            loc = rig.rest_matrix('Hymnal').inverted() @ (dl3['Hand.L'].inverted() @ disp)
            out['__loc'] = {'Hymnal': tuple(loc)}
        out['__diag'] = (round(bends['.R'], 1), round(bends['.L'], 1), fixes)
        return out

    # ------------------------------------------------------------------ the stances
    def combat(ph=0.0, **kw):
        """CombatIdle at phase `ph`: upright, the baton raised, the hymnal open at her side."""
        base = dict(root=(0.0, 0.0, -0.08 + 0.025 * math.sin(ph)), lean=-0.02 + 0.015 * math.sin(ph + 0.5),
                    side=0.02 * math.sin(ph * 0.5), twist=-6 + 3 * math.sin(ph * 0.5),
                    look=(0.05 * math.sin(ph * 0.5), -0.12, 1.0), jaw=6 + 3 * math.sin(ph * 2),
                    feet={'.L': ((0.42, -0.28, 0.24), tuple(_n((0.15, -0.9, -0.42)))),
                          '.R': ((-0.4, 0.22, 0.24), tuple(_n((-0.25, -0.88, -0.42))))},
                    r_wrist=(-0.98 + 0.05 * math.cos(ph), -0.58 + 0.05 * math.sin(ph), 4.52 + 0.04 * math.sin(ph)),
                    r_baton=(0.22 + 0.08 * math.cos(ph), -0.5, 0.86), r_pole=(-1.0, 0.5, -0.5),
                    l_wrist=(0.95, -0.72, 3.8 + 0.03 * math.sin(ph + 1.0)), l_h=(-0.15, -0.6, 0.75),
                    l_n=(0.3, -0.7, 0.65), l_pole=(1.0, 0.7, -0.3),
                    flutter=ph, veil=(0.0, 0.0))
        base.update(kw)
        return stance(**base)

    ready = combat(0.0)

    # CombatIdle: the braced choir mistress, breathing, the baton's light turning slowly.
    add('CombatIdle', [(1 + i * 8, combat(math.tau * i / 6)) for i in range(6)] + [(49, ready)],
        fire=[(1, 1.1), (49, 1.1)], voice=[(1, 0.3), (49, 0.3)])

    # Idle: out of combat, the head bowed over the hymnal, swaying, humming.
    def idle(ph):
        return stance(root=(0.03 * math.sin(ph), 0.0, -0.05 + 0.02 * math.sin(ph * 2)), lean=0.1,
                      side=0.05 * math.sin(ph), twist=4 * math.sin(ph + 0.4),
                      look=(0.08 * math.sin(ph + 0.6), -0.62, 0.78), jaw=4 + 4 * abs(math.sin(ph * 2)),
                      r_wrist=(-0.6, -0.62, 3.72 + 0.03 * math.sin(ph + 1)), r_baton=(0.3, -0.45, -0.84),
                      r_pole=(-1.0, 0.6, -0.2),
                      l_wrist=(0.42 + 0.03 * math.sin(ph), -0.82, 4.1), l_h=(-0.45, -0.85, 0.3),
                      l_n=(0.0, 0.62, 0.78), l_pole=(1.0, 0.4, -0.5), flap=3 * math.sin(ph * 2),
                      flutter=ph, veil=(0.04 * math.sin(ph), 0.0))
    add('Idle', [(1 + i * 8, idle(math.tau * i / 8)) for i in range(8)] + [(65, idle(0.0))],
        fire=[(1, 0.85), (65, 0.85)], voice=[(1, 0.3), (17, 0.45), (33, 0.3), (49, 0.45), (65, 0.3)])

    # ------------------------------------------------------------------ the gait
    def gait(period, step, lift, bob, lean, base_z, stream, arm_swing, run=False):
        keys = []
        n = 10 if run else 8
        for i in range(n + 1):
            ph = math.tau * i / n
            feet = {}
            for s, off in (('.L', 0.0), ('.R', math.pi)):
                sx = 1 if s == '.L' else -1
                q = (ph + off) % math.tau
                if q < math.pi:            # stance: heel strike in front, sliding back
                    t = q / math.pi
                    y = -step / 2 + step * t
                    z = 0.24 + 0.16 * max(0.0, t - 0.65) / 0.35
                    fd = _n((sx * 0.08, -0.9, -0.42 + 0.25 * (1 - t) - 0.12 * t))
                else:                       # swing: lifted and carried forward
                    t = (q - math.pi) / math.pi
                    y = step / 2 - step * (0.5 - 0.5 * math.cos(math.pi * t))
                    z = 0.24 + lift * math.sin(math.pi * t)
                    fd = _n((sx * 0.08, -0.9, -0.4 + 0.25 * math.sin(math.pi * t)))
                feet[s] = ((sx * 0.36, y, z), tuple(fd))
            hip_z = base_z + bob * (math.cos(2 * ph) * -1)
            lift_side = math.sin(ph)
            sw = math.sin(ph)
            kw = dict(root=(0.04 * lift_side, 0.0, hip_z), lean=lean, side=-0.04 * lift_side, twist=7 * sw,
                      legs_cloth=0.55 if run else 1.0,
                      look=(0.0, -0.14 - lean * 0.6, 1.0), jaw=5, feet=feet, stream=stream, flutter=ph * 1.5,
                      veil=(0.0, 0.06 * stream))
            if run:
                kw.update(r_wrist=(-0.82, 0.05 + arm_swing * sw, 3.75 - 0.1 * abs(sw)),
                          r_baton=(0.1, 0.55, -0.83), r_pole=(-1.0, 0.8, 0.2),
                          l_wrist=(0.36, -0.62 - 0.05 * sw, 4.15), l_h=(-0.6, -0.4, 0.6), l_n=(-0.7, 0.6, 0.3),
                          l_pole=(1.0, 0.5, -0.6), book=0.0)
            else:
                kw.update(r_wrist=(-0.82, -0.25 + arm_swing * sw, 3.42), r_baton=(0.12, 0.25, -0.96),
                          r_pole=(-1.0, 0.6, 0.2),
                          l_wrist=(0.55, -0.68, 3.88 + 0.03 * math.cos(2 * ph)), l_h=(-0.35, -0.9, 0.2),
                          l_n=(0.0, 0.3, 0.95), l_pole=(1.0, 0.5, -0.5))
            keys.append((1 + round(i * period / n), stance(**kw)))
        return keys

    add('Walk', gait(36, 1.5, 0.32, 0.05, 0.06, -0.12, 0.25, 0.22), fire=[(1, 0.9), (37, 0.9)])
    add('Run', gait(20, 2.4, 0.55, 0.09, 0.3, -0.3, 1.0, 0.35, run=True), fire=[(1, 1.0), (21, 1.0)],
        voice=[(1, 0.2), (21, 0.2)])

    # ------------------------------------------------------------------ the strikes
    # Attack: the baton slash. Wound up high over the right shoulder (the body turned
    # away, weight back), a fast cut down and across to her lower left, the body
    # unwinding into it, a follow-through and the recovery to guard.
    feet_fight = {'.L': ((0.42, -0.28, 0.24), tuple(_n((0.15, -0.9, -0.42)))),
                  '.R': ((-0.4, 0.22, 0.24), tuple(_n((-0.25, -0.88, -0.42))))}
    a_wind = combat(0.3, root=(0.0, 0.16, -0.04), twist=-38, lean=-0.14, side=-0.06, look=(-0.15, -0.2, 1.0),
                    jaw=12, r_wrist=(-1.12, 0.18, 5.1), r_baton=(-0.05, 0.55, 0.83), r_pole=(-1.0, 0.1, -0.7),
                    l_wrist=(1.2, -0.55, 4.0), l_h=(0.4, -1.0, 0.2), flutter=0.4)
    a_hold = combat(0.4, root=(0.0, 0.18, -0.03), twist=-42, lean=-0.16, side=-0.07, look=(-0.17, -0.2, 1.0),
                    jaw=14, r_wrist=(-1.14, 0.24, 5.16), r_baton=(-0.08, 0.6, 0.79), r_pole=(-1.0, 0.1, -0.7),
                    l_wrist=(1.24, -0.52, 4.05), l_h=(0.4, -1.0, 0.2), flutter=0.6)
    a_top = combat(0.5, root=(0.0, 0.06, -0.06), twist=-26, lean=-0.04, look=(-0.08, -0.25, 1.0), jaw=18,
                   r_wrist=(-1.0, -0.55, 5.3), r_baton=(-0.02, -0.25, 0.97), r_pole=(-1.0, 0.2, -0.7),
                   l_wrist=(1.2, -0.5, 3.95), l_h=(0.4, -1.0, 0.2), flutter=0.8)
    a_mid = combat(0.6, r_bend=58, root=(0.0, -0.08, -0.1), twist=-8, lean=0.14, look=(0.0, -0.35, 1.0), jaw=22,
                   r_wrist=(-0.72, -1.3, 4.75), r_baton=(0.12, -0.78, 0.62), r_pole=(-1.0, 0.3, -0.6),
                   l_wrist=(1.17, -0.42, 3.95), l_h=(0.5, -0.8, 0.2), stream=0.2, flutter=1.0)
    a_hit = combat(0.8, r_bend=58, root=(0.0, -0.3, -0.2), twist=30, lean=0.36, look=(0.18, -0.5, 1.0), jaw=30,
                   r_wrist=(0.28, -1.5, 3.9), r_baton=(0.6, -0.72, -0.35), r_pole=(-0.6, 0.4, -0.9),
                   l_wrist=(1.2, -0.15, 4.05), l_h=(0.6, -0.6, 0.2), stream=0.4, splay=0.2, flutter=1.4)
    a_follow = combat(1.0, r_bend=58, root=(0.0, -0.32, -0.22), twist=40, lean=0.38, look=(0.25, -0.5, 1.0), jaw=24,
                      r_wrist=(0.62, -1.2, 3.5), r_baton=(0.7, -0.15, -0.7), r_pole=(-0.5, 0.4, -0.9),
                      l_wrist=(1.25, -0.05, 4.1), l_h=(0.6, -0.6, 0.2), stream=0.3, splay=0.15, flutter=1.8)
    a_rec = combat(1.4, root=(0.0, -0.1, -0.12), twist=12, lean=0.12, look=(0.05, -0.22, 1.0), jaw=10,
                   r_wrist=(-0.55, -0.9, 4.25), r_baton=(0.3, -0.6, 0.6), flutter=2.4)
    a_cut = combat(0.7, r_bend=58, root=(0.0, -0.2, -0.15), twist=12, lean=0.26, look=(0.08, -0.45, 1.0), jaw=27,
                   r_wrist=(-0.28, -1.48, 4.35), r_baton=(0.45, -0.85, 0.12), r_pole=(-0.8, 0.35, -0.8),
                   l_wrist=(1.18, -0.3, 4.0), l_h=(0.55, -0.7, 0.2), stream=0.3, splay=0.1, flutter=1.2)
    add('Attack', [(1, ready), (5, a_wind), (8, a_hold), (10, a_mid), (11, a_cut), (12, a_hit), (15, a_follow), (20, a_rec),
                   (26, ready)], loop_clip=False, fire=[(1, 1.1), (10, 1.5), (14, 1.3), (26, 1.1)])

    # Attack2: the hymnal backhand. The book drawn across her body to the right
    # shoulder and shut, then swung out to her left at head height, the cover leading,
    # and opened again on the way back to guard.
    b_wind = combat(0.3, root=(0.0, 0.1, -0.06), twist=-30, lean=0.04, look=(-0.2, -0.2, 1.0), jaw=10,
                    l_wrist=(-0.35, -0.85, 4.4), l_h=(-0.8, -0.3, 0.5), l_n=(-0.2, -0.9, 0.3),
                    l_pole=(0.6, 0.2, -1.0), book=0.4, r_wrist=(-1.15, -0.15, 4.25), r_baton=(-0.1, 0.3, 0.95),
                    flutter=0.4)
    b_hold = combat(0.4, root=(0.0, 0.12, -0.05), twist=-40, lean=0.02, look=(-0.22, -0.2, 1.0), jaw=12,
                    l_wrist=(-0.55, -0.65, 4.6), l_h=(-0.75, -0.2, 0.65), l_n=(-0.4, -0.9, 0.2),
                    l_pole=(0.6, 0.3, -1.0), book=0.0, r_wrist=(-1.2, -0.1, 4.2), r_baton=(-0.1, 0.3, 0.95),
                    flutter=0.6)
    b_sw = combat(0.5, root=(0.0, 0.02, -0.08), twist=-22, lean=0.1, look=(-0.1, -0.26, 1.0), jaw=16,
                  l_wrist=(-0.1, -1.15, 4.62), l_h=(-0.1, -0.85, 0.5), l_n=(0.2, -0.9, 0.3),
                  l_pole=(0.7, 0.3, -1.0), book=0.0, r_wrist=(-1.16, -0.2, 4.15), r_baton=(-0.12, 0.32, 0.94),
                  flutter=0.8)
    b_mid = combat(0.6, root=(0.0, -0.08, -0.12), twist=-4, lean=0.18, look=(0.0, -0.32, 1.0), jaw=20,
                   l_wrist=(0.35, -1.45, 4.55), l_h=(0.55, -0.85, 0.1), l_n=(0.2, -0.95, 0.2),
                   l_pole=(0.8, 0.3, -1.0), book=0.0, r_wrist=(-1.12, -0.3, 4.1), r_baton=(-0.15, 0.35, 0.92),
                   stream=0.25, flutter=1.0)
    b_hit = combat(0.8, root=(0.0, -0.26, -0.18), twist=34, lean=0.26, look=(0.35, -0.35, 1.0), jaw=30,
                   l_wrist=(1.2, -1.32, 4.5), l_h=(0.85, -0.5, 0.1), l_n=(0.8, -0.3, 0.45),
                   l_pole=(0.6, 0.6, -1.0), book=0.0, r_wrist=(-1.25, 0.0, 4.0), r_baton=(-0.2, 0.4, 0.9),
                   stream=0.4, splay=0.2, flutter=1.4)
    b_follow = combat(1.0, root=(0.0, -0.26, -0.18), twist=44, lean=0.22, look=(0.42, -0.3, 1.0), jaw=22,
                      l_wrist=(1.42, -0.55, 4.3), l_h=(0.8, 0.45, 0.0), l_n=(0.3, -0.2, 0.9),
                      l_pole=(0.5, 0.8, -0.8), book=0.2, r_wrist=(-1.2, -0.1, 4.05), stream=0.3,
                      flutter=1.8)
    b_rec = combat(1.4, root=(0.0, -0.08, -0.1), twist=14, lean=0.08, look=(0.15, -0.2, 1.0), jaw=10,
                   l_wrist=(1.05, -0.65, 3.85), book=0.8, flutter=2.4)
    add('Attack2', [(1, ready), (5, b_wind), (9, b_hold), (11, b_mid), (13, b_hit), (17, b_follow), (22, b_rec),
                    (28, ready)], loop_clip=False, fire=[(1, 1.1), (11, 1.5), (16, 1.3), (28, 1.1)])

    # Hit: knocked back a step, the head snapped up, the arms flung.
    h1 = combat(0.5, root=(0.0, 0.28, -0.04), lean=-0.25, side=-0.06, twist=-12, look=(0.2, 0.15, 1.0), jaw=26,
                r_wrist=(-1.2, -0.25, 4.75), r_baton=(-0.2, 0.2, 0.95), l_wrist=(1.15, -0.3, 3.95), book=0.7,
                splay=0.2, stream=-0.2, flutter=0.8)
    h2 = combat(0.6, root=(0.0, 0.32, -0.08), lean=-0.3, side=-0.08, twist=-14, look=(0.25, 0.1, 1.0), jaw=22,
                r_wrist=(-1.25, -0.2, 4.7), r_baton=(-0.25, 0.25, 0.92), l_wrist=(1.2, -0.25, 3.92), book=0.8,
                splay=0.25, stream=-0.25, flutter=1.0)
    add('Hit', [(1, ready), (3, h1), (6, h2), (16, ready)], loop_clip=False, fire=[(1, 1.1), (3, 1.6), (16, 1.1)])

    # ------------------------------------------------------------------ the dirge
    # Sing: a breath, then the arms spread and rise, the hymnal lifted high, the head
    # thrown back, the jaw open on violet light. The peak lands by frame 43 (1.75 s:
    # the Crescendo bar is 1.8 s) and is held, climbing, to the 2.5 s bar's end.
    def sing(f, lift, back, spread, jaw, vib=0.0, ph=0.0, **kw):
        vz = vib * math.sin(ph)
        base = dict(root=(0.0, 0.04 * back, -0.12 + lift), lean=-0.3 * back, side=0.0, twist=-2,
                    look=(0.0, -0.45 + 1.05 * back + 0.03 * vz, 1.0 - 0.25 * back), jaw=jaw + 3 * vz,
                    r_wrist=(-0.5 - 1.3 * spread, -0.72 + 0.55 * spread, 4.2 + 1.85 * spread + 0.04 * vz),
                    r_baton=(-0.1 - 0.4 * spread, -0.3 + 0.25 * spread, 0.95), r_pole=(-1.0, 0.7, -0.4),
                    l_wrist=(0.46 + 1.3 * spread, -0.75 + 0.57 * spread, 4.1 + 1.95 * spread - 0.04 * vz),
                    l_h=(-0.3 + 0.7 * spread, -0.9 + 0.5 * spread, 0.3 + 0.6 * spread),
                    l_n=(-0.2 - 0.3 * spread, 0.4 - 1.0 * spread, 0.9 - 0.2 * spread), l_pole=(1.0, 0.8, -0.3),
                    splay=0.7 * spread, flap=4 * spread * math.sin(ph * 1.7), flutter=f * 0.15,
                    veil=(0.0, 0.1 * back))
        base.update(kw)
        return stance(**base)

    s_keys = [(1, ready),
              (8, sing(8, 0.0, -0.15, 0.0, 3)),
              (20, sing(20, 0.1, 0.25, 0.38, 18)),
              (32, sing(32, 0.18, 0.62, 0.72, 32)),
              (43, sing(43, 0.22, 0.95, 0.94, 42))]
    for f, ph in ((47, 1.6), (51, -1.6), (55, 1.6)):
        s_keys.append((f, sing(f, 0.22 + 0.01 * (f - 43) / 4, 0.97 + 0.01 * (f - 43) / 4,
                               0.95 + 0.012 * (f - 43) / 4, 42 + (f - 43) * 0.3, vib=1.0, ph=ph)))
    s_keys.append((60, sing(60, 0.25, 1.0, 1.0, 46)))
    add('Sing', s_keys, loop_clip=False, fire=[(1, 1.1), (20, 1.3), (43, 1.9), (60, 2.0)],
        voice=[(1, 0.3), (8, 0.15), (20, 0.75), (32, 1.15), (43, 1.55), (60, 1.75)])

    # Conduct: one bar of four beats, the baton's ictus down, in, out and up, the head
    # nodding on each and the body leaning into the second and third.
    beats = [((-0.75, -0.98, 4.0), (0.1, -0.95, -0.05), 0), ((-0.6, -0.95, 4.42), (0.15, -0.75, 0.5), 0),
             ((-0.18, -1.0, 4.08), (0.5, -0.85, 0.05), 6), ((-0.32, -0.95, 4.5), (0.4, -0.7, 0.5), 4),
             ((-1.28, -0.85, 4.12), (-0.45, -0.88, 0.05), -6), ((-1.18, -0.85, 4.58), (-0.35, -0.7, 0.55), -4),
             ((-0.72, -0.95, 4.9), (0.1, -0.6, 0.8), 0), ((-0.74, -0.9, 5.22), (0.05, -0.4, 0.92), 0)]
    c_keys = []
    for i, (w, bd, tw) in enumerate(beats):
        ictus = i % 2 == 0
        c_keys.append((1 + i * 6, combat(math.tau * i / 8, r_wrist=w, r_baton=bd, twist=-6 + tw,
                                         look=(tw * 0.01, -0.22 if ictus else -0.1, 1.0), jaw=14 if ictus else 8,
                                         l_wrist=(0.98, -0.62, 3.82 + (0.08 if i in (0, 1) else 0.0)))))
    c_keys.append((49, c_keys[0][1]))
    add('Conduct', c_keys, fire=[(1, 1.3), (49, 1.3)], voice=[(1, 0.5), (13, 0.7), (25, 0.5), (37, 0.7), (49, 0.5)])

    # PlayOrgan: at the Bone Organ's keys, facing the pipes. The fists pound chords on the
    # keys (keys in the body's frame, a body length's reach ahead at the waist), the head
    # sways with the music, the hymnal hangs open in the air over the keys.
    KEY_Y, KEY_Z = -1.62, 3.22

    def organ(f, lz, rz, lx=0.42, rx=-0.42, sway=0.0, lean=0.42, dip=0.0, **kw):
        bob = 0.04 * math.sin(f * math.tau / 50)
        base = dict(root=(0.04 * sway, 0.0, -0.14 - dip), lean=lean + 0.06 * dip, side=0.05 * sway, twist=6 * sway,
                    look=(0.22 * sway, -0.62, 0.78), jaw=10 + 10 * abs(sway),
                    feet={'.L': ((0.46, 0.02, 0.24), tuple(_n((0.15, -0.9, -0.42)))),
                          '.R': ((-0.46, 0.06, 0.24), tuple(_n((-0.15, -0.9, -0.42))))},
                    r_wrist=(rx, KEY_Y + 0.2, KEY_Z + 0.1 + rz), r_baton=(-0.35, 0.55, 0.75), r_frame='root',
                    r_pole=(-1.0, 0.4, -0.6), r_bend=40,
                    l_wrist=(lx, KEY_Y + 0.2, KEY_Z + 0.1 + lz), l_h=(0.0, -0.75, -0.65), l_n=(0.0, -0.4, -0.95),
                    l_frame='root', l_pole=(1.0, 0.4, -0.6), l_bend=45,
                    book_at=(0.0, -1.78, 4.32 + bob), book_h=(0.0, -0.6, 0.8), book_n=(0.0, 0.8, 0.6),
                    flap=5 * math.sin(f * 0.4), flutter=f * 0.12, veil=(0.05 * sway, 0.0))
        base.update(kw)
        return stance(**base)

    up_, hi_ = 0.5, 0.78
    seq = [(1, 0, 0, 0.42, -0.42, 0.0, 0.25), (7, up_, up_, 0.42, -0.42, 0.2, 0.0),
           (12, 0, up_, 0.58, -0.42, 0.4, 0.0), (17, up_, 0, 0.58, -0.3, 0.6, 0.0),
           (22, 0, up_, 0.3, -0.3, 0.8, 0.0), (27, up_, 0, 0.3, -0.62, 0.6, 0.0),
           (33, hi_, hi_, 0.45, -0.45, 0.2, -0.15), (38, -0.04, -0.04, 0.45, -0.45, 0.0, 0.16),
           (44, up_, up_, 0.45, -0.45, -0.2, 0.0), (50, 0, up_, 0.66, -0.42, -0.4, 0.0),
           (55, up_, 0, 0.66, -0.22, -0.6, 0.0), (60, 0, up_, 0.22, -0.22, -0.8, 0.0),
           (65, up_, 0, 0.22, -0.66, -0.6, 0.0), (71, hi_, hi_, 0.45, -0.45, -0.3, -0.15),
           (76, -0.04, -0.04, 0.45, -0.45, -0.1, 0.16), (82, 0, up_, 0.5, -0.4, 0.05, 0.0),
           (88, up_, 0, 0.5, -0.4, 0.0, 0.0), (94, up_, up_, 0.42, -0.42, 0.0, 0.0)]
    o_keys = [(f, organ(f, lz, rz, lx, rx, sway=sw, dip=dp)) for f, lz, rz, lx, rx, sw, dp in seq]
    o_keys.append((101, o_keys[0][1]))
    add('PlayOrgan', o_keys, fire=[(1, 1.4), (101, 1.4)],
        voice=[(1, 0.6), (33, 0.9), (38, 1.1), (71, 0.9), (76, 1.1), (101, 0.6)])

    # ------------------------------------------------------------------ the death
    # She cries out once, arched back; the knees go and she sinks into her robes; she
    # slumps forward and falls on her face, the hymnal slipping from her hand to fall
    # open on the flags before her.
    kneel_feet = {'.L': ((0.42, 1.08, 0.27), tuple(_n((0.05, 0.88, -0.42)))),
                  '.R': ((-0.42, 1.08, 0.27), tuple(_n((-0.05, 0.88, -0.42))))}
    fold_feet = {'.L': ((0.4, 1.0, 0.27), tuple(_n((0.05, 0.9, -0.4)))),
                 '.R': ((-0.4, 1.0, 0.27), tuple(_n((-0.05, 0.9, -0.4))))}
    kneel = dict(knee_pole=(0.0, -1.0, -0.6))
    d1 = combat(0.4, root=(0.0, 0.1, 0.02), lean=-0.32, look=(0.0, 0.7, 0.7), jaw=48,
                r_wrist=(-1.35, -0.25, 5.0), r_baton=(-0.4, 0.2, 0.9), l_wrist=(1.35, -0.3, 5.0), l_h=(0.6, -0.4, 0.7),
                l_n=(0.3, -0.4, 0.85), splay=0.4, flutter=0.8)
    d2 = stance(root=(0.0, -0.1, -0.75), lean=0.3, look=(0.0, -0.55, 0.85), jaw=30,
                feet=dict(feet_fight), r_wrist=(-1.05, -0.65, 3.55), r_baton=(0.2, -0.6, -0.75),
                l_wrist=(0.95, -0.72, 3.6), l_h=(0.1, -1.0, -0.2), l_n=(0.2, 0.3, 0.9), splay=0.3, flutter=1.4)
    d3 = stance(root=(0.0, -0.05, -1.45), bow=24, look=(0.1, -0.7, 0.6), jaw=18, feet=kneel_feet,
                r_wrist=(-0.85, -0.85, 2.45), r_baton=(0.3, -0.5, -0.8), r_frame='root',
                l_wrist=(0.8, -0.95, 2.4), l_h=(0.2, -0.6, -0.8), l_n=(0.4, 0.4, 0.8), l_frame='root',
                splay=0.4, flutter=2.0, drape=0.3, **kneel)
    d4 = stance(root=(0.04, 0.4, -1.85), bow=68, look=(0.2, -0.8, -0.45), jaw=24, feet=fold_feet,
                r_wrist=(-1.0, -1.75, 0.45), r_baton=(-0.3, -0.8, 0.2), r_frame='world',
                l_wrist=(1.05, -1.65, 0.45), l_h=(0.3, -0.9, -0.2), l_n=(0.0, 0.3, -1.0), l_frame='world',
                book_at=(1.3, -2.25, 0.55), book_h=(0.4, -0.8, 0.45), book_n=(0.3, 0.4, 0.85), book=0.7,
                splay=0.6, flutter=2.6, drape=0.8, **kneel)
    d5 = stance(root=(0.05, 0.72, -2.08), bow=98, look=(0.5, -0.55, -0.7), jaw=30, feet=fold_feet,
                r_wrist=(-1.05, -2.0, 0.25), r_baton=(-0.5, -0.85, 0.0), r_frame='world',
                l_wrist=(1.1, -1.85, 0.25), l_h=(0.3, -0.95, 0.0), l_n=(0.0, 0.0, -1.0), l_frame='world',
                book_at=(1.5, -2.75, 0.07), book_h=(0.35, -1.0, 0.0), book_n=(0.0, 0.0, 1.0), book=1.0,
                splay=0.7, flutter=3.0, drape=1.0, **kneel)
    d2b = stance(root=(0.0, -0.08, -1.1), lean=0.42, look=(0.05, -0.65, 0.75), jaw=24,
                 feet={'.L': ((0.42, 0.42, 0.34), tuple(_n((0.05, 0.9, -0.25)))),
                       '.R': ((-0.42, 0.42, 0.34), tuple(_n((-0.05, 0.9, -0.25))))},
                 r_wrist=(-0.95, -0.8, 3.0), r_baton=(0.25, -0.55, -0.8),
                 l_wrist=(0.88, -0.9, 3.0), l_h=(0.15, -0.8, -0.5), l_n=(0.3, 0.35, 0.85),
                 splay=0.35, flutter=1.7, drape=0.15, **kneel)
    add('Death', [(1, ready), (6, d1), (15, d2), (20, d2b), (26, d3), (37, d4), (46, d5), (72, d5)], loop_clip=False,
        fire=[(1, 1.1), (6, 2.0), (15, 1.2), (26, 0.8), (37, 0.4), (52, 0.03), (72, 0.0)],
        voice=[(1, 0.3), (6, 1.6), (15, 0.6), (26, 0.2), (40, 0.0), (72, 0.0)])
    return clips


if __name__ == '__main__':
    import bpy
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    fast = '--fast' in argv
    new_scene()
    mats = make_materials('bone', membrane_kind='cloth')
    # finer bone: the kit's crack pattern is sized for the drake's great bones, so on her
    # skull and fingers it is drawn finer and fainter
    for nd in mats[0].node_tree.nodes:
        if nd.type == 'TEX_VORONOI':
            nd.inputs['Scale'].default_value = 15.0
        elif nd.type == 'VALTORGB' and abs(nd.color_ramp.elements[1].position - 0.035) < 1e-4:
            nd.color_ramp.elements[1].position = 0.02
        elif nd.type == 'MAP_RANGE' and abs(nd.inputs['To Min'].default_value - 0.45) < 1e-4:
            nd.inputs['To Min'].default_value = 0.72
    metal = bpy.data.materials.new('CreatureMetal')
    metal.use_nodes = True
    metal.use_backface_culling = True
    _procedural_surface(metal, 'bone')
    mats.append(metal)
    parts = build_parts() + build_stole_notes()
    mems = build_membranes()
    if '--solo' in argv:
        keep = argv[argv.index('--solo') + 1].split(',')
        parts = [pt for pt in parts if pt.name in keep]
        mems = [m for m in mems if m.name in keep]
    cloth = [m.to_object(mats) for m in mems]
    for ob in cloth:
        face_out(ob)
    objects = [pt.to_object(mats) for pt in parts] + cloth
    body = join(objects, 'CantorIlvane')
    print('TRIANGLES', triangles(body))
    if '--nobake' not in argv:
        bake_surface(body, size=512 if fast else 2048, samples=16 if fast else 40, ao_strength=0.6)
    nt = metal.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Metallic'].default_value = 0.4
    bsdf.inputs['Roughness'].default_value = 0.5
    arm = build_armature('CantorIlvane', BONES)
    bind(body, arm)
    clips = make_clips(arm)
    worst = {}
    for name, f, br, bl, fixes in DIAG:
        w = worst.setdefault(name, [0, 0, 0])
        w[0], w[1], w[2] = max(w[0], br), max(w[1], bl), max(w[2], fixes)
        if '--diag' in argv:
            print('DIAG', name, f, 'bendR', br, 'bendL', bl, 'hemFixes', fixes)
    for name, (br, bl, fx) in worst.items():
        print('WRIST', name, 'maxBendR', br, 'maxBendL', bl, 'maxHemFixes', fx)
    # The game measures her half a second into Idle (src/render/characters/assets.ts).
    arm.animation_data.action = bpy.data.actions['Idle']
    bpy.context.scene.frame_set(13)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    print('IDLE_HEIGHT', round(max(zs) - min(zs), 3), 'MINZ', round(min(zs), 3), 'MAXZ', round(max(zs), 3))
    for name in clips:
        arm.animation_data.action = bpy.data.actions[name]
        act = bpy.data.actions[name]
        lo = 99.0
        for fr in range(int(act.frame_range[0]), int(act.frame_range[1]) + 1, 2):
            bpy.context.scene.frame_set(fr)
            ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
            lo = min(lo, min((ev.matrix_world @ v.co).z for v in ev.data.vertices))
        print('MINZ_CLIP', name, round(lo, 3))
    for pb in arm.pose.bones:
        pb.scale = (1, 1, 1)
    if out != '-':
        export(out, arm)
    if '--sheet' in argv:
        setup_preview((0.9, -0.6, 3.0), 7.6, res=(640, 760), ref_x=3.4)
        only = argv[argv.index('--clips') + 1].split(',') if '--clips' in argv else clips
        render_sheet(arm, [c for c in clips if c in only], argv[argv.index('--sheet') + 1], 'cantor',
                     frames_per_clip=int(argv[argv.index('--frames') + 1]) if '--frames' in argv else 4)
    if '--blend' in argv:
        arm.animation_data.action = bpy.data.actions['Idle']
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
