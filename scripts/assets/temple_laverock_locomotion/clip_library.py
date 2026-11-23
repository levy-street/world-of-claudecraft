"""Every clip Laverock ships (24 fps, times in seconds).

He never fights: an old cantor who walks behind the group leaning on his staff,
listens, talks with his free hand, starts at what he sees, kneels at the moon
pool, and at the end sings the rite's last verse at the altar. The staff is
rigid on the right hand in every clip; where it stands on the ground the right
wrist is solved so its foot lands where asked (`planted`).

Game mapping (src/render/characters, npc_laverock): idle Idle, walk and run
Walk, the overhead gestures point Talk, cry Startle, kneel Kneel, and the song's
channel cast (cantor_last_verse) Sing, a loop.
"""
import math

import numpy as np

import anatomy as A
from clips import Body, keys_of, staff_world

TAU = math.tau

# The authored targets are in the sculpt's design space; the body is warped to the
# game's broad proportions (warp.py), so every target goes through the same map:
# wp near the body (the cassock's core), wh by the face (the head), wreach for an
# arm flung out (shoulder-relative), wx for the feet and the walking staff (only
# across: a stride's length, and the staff's slide with the ground, never change).
wp, wh, wreach = A.wp, A.wh, A.wreach


def wx(p):
    return (wp(p)[0], float(p[1]), float(p[2]))


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def _n(v):
    v = np.asarray(v, float)
    return tuple(v / np.linalg.norm(v))


# ------------------------------------------------------------------ the staff
def staff_foot(pose):
    return staff_world(pose, A.STAFF_FOOT_T - 0.06)


def planted(b, foot, iters=6):
    """`b` with its right wrist moved so the staff's foot (the spike's point) stands
    on `foot` (armature space), the shaft keeping the direction `b` gives it."""
    foot = np.asarray(foot, float)
    for _ in range(iters):
        pose = b.pose(resolve=False)
        err = foot - staff_foot(pose)
        if np.linalg.norm(err) < 0.004:
            break
        h = np.asarray(b.p['hand_r'], float) + err
        b = b.but(hand_r=tuple(h))
    return b


def aimed(b, foot, at, iters=6):
    """`b` with the staff leaning from `foot` on the ice toward the point `at` above
    it (its direction set from the two points), and the wrist solved onto it."""
    d = _n(np.asarray(at, float) - np.asarray(foot, float))
    return planted(b.but(staff=d), foot, iters)


# ------------------------------------------------------------------ the stance
STAFF_SPOT = wp((-0.48, -0.5, 0.0))          # where the staff stands at his right in the stance
STOOP = 13                               # degrees his back bows (old, but he stands with dignity)
STOOP_NECK = 14


def stance(rig):
    """An old man's stoop: the back bowed, the head carried forward and a little
    low, his weight on the driftwood staff planted at his right (the fist high on
    the shaft), the free left hand resting loose at the girdle."""
    b = Body(rig, pelvis=(0, 0.03, -0.07), lean=STOOP, neck=STOOP_NECK, look=(0, 4), hip_tilt=-4,
             hand_r=wp((-0.42, -0.5, 2.7)), pole_r=(-0.7, 0.5, -0.6), fist_r=1.0,
             hand_l=wp((0.3, -0.28, 2.18)), pole_l=(0.7, 0.4, -0.5), hand_dir_l=(0.0, -0.3, -0.9),
             hand_roll_l=-20, fist_l=0.35, spread_l=4,
             foot_l=wx((0.18, 0.04, 0.14)), foot_r=wx((-0.19, 0.08, 0.14)), clav_fwd_l=6, clav_fwd_r=8)
    return aimed(b, STAFF_SPOT, wp((-0.4, -0.58, 3.0)))


# ------------------------------------------------------------------ locomotion
REST_ANKLE = np.array(A.ANKLE)
BALL_OFF = np.array(A.BALL) - REST_ANKLE
HEEL_OFF = np.array((0.0, 0.06, -0.12))
SOLE_Z = float(A.ANKLE[2])


def _pitched(v, deg):
    c, s = math.cos(math.radians(-deg)), math.sin(math.radians(-deg))
    return np.array((v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c))


def planted_ankle_z(pitch):
    if pitch >= 0:
        heel = _pitched(HEEL_OFF, pitch)
        return SOLE_Z + (HEEL_OFF[2] - heel[2])
    ball = _pitched(BALL_OFF, pitch)
    return SOLE_Z + (BALL_OFF[2] - ball[2])


def foot_dir(pitch, s, yaw=0.0):
    rest_fd = A.REST['L_Foot'][1] - A.REST['L_Foot'][0]
    fd = np.array((0.0, rest_fd[1], rest_fd[2]))
    c, sn = math.cos(math.radians(-pitch)), math.sin(math.radians(-pitch))
    fd = np.array((fd[0], fd[1] * c - fd[2] * sn, fd[1] * sn + fd[2] * c))
    if yaw:
        cy, sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        fd = np.array((fd[0] * cy - fd[1] * sy, fd[0] * sy + fd[1] * cy, fd[2]))
    return tuple(fd)


def gait_foot(phase, stance_frac, y_front, y_back, lift, side, x_out=wx((0.19, 0.0, 0.14))[0]):
    s = 1 if side > 0 else -1
    if phase < stance_frac:
        u = phase / stance_frac
        y = y_front + (y_back - y_front) * u
        heel = max(0.0, (u - 0.72) / 0.28)
        pitch = 12 * max(0.0, 1 - u / 0.14) - 30 * heel
        z = planted_ankle_z(pitch)
        toe = 28 * heel
    else:
        u = (phase - stance_frac) / (1 - stance_frac)
        e = smooth(u)
        y = y_back + (y_front - y_back) * e
        pitch = -30 * (1 - smooth(u * 1.6)) + 14 * smooth((u - 0.45) / 0.55)
        z = planted_ankle_z(pitch) + lift * math.sin(math.pi * u) ** 1.3
        toe = 28 * (1 - smooth(u * 2.5))
    return (x_out * s, y, z), foot_dir(pitch, s), -toe


WALK_PERIOD = 1.2          # one full cycle (two steps), seconds: unhurried but long-legged
WALK_HALF = 0.6            # half the planted foot's travel, yards (long glides under the cassock: the
                           # game plays it up to ~2.4x at the guide's follow walk with little sliding)
WALK_SPEED = 2 * WALK_HALF / (0.6 * WALK_PERIOD)


def walk_body(rig, ph):
    """A slow processional walk: long gliding steps under the cassock, the shoulders
    nearly still, the head level and hunting; the staff is set down ahead with each
    right step and walked past like a pilgrim's crozier, then swung forward again."""
    st = stance(rig)
    half = WALK_HALF
    fl, dl, tl = gait_foot(ph, 0.6, -half, half, 0.2, 1)
    fr, dr, tr = gait_foot((ph + 0.5) % 1.0, 0.6, -half, half, 0.2, -1)
    c1 = math.cos(TAU * ph)
    c3 = math.cos(TAU * (ph - 0.3))
    bob = -0.05 - 0.025 * math.cos(2 * TAU * ph)
    b = st.but(pelvis=(0.03 * c3, 0.0, bob), hip_twist=-8 * c1, hip_roll=-3 * c3, hip_tilt=0, lean=STOOP + 3,
               twist=5 * c1, side=-1.5 * c3, look=(-2 * c1, 0), neck=STOOP_NECK,
               foot_l=fl, foot_r=fr, foot_dir_l=dl, foot_dir_r=dr, toe_l=tl, toe_r=tr,
               hand_l=wp((0.3, -0.3 - 0.06 * c1, 2.2 + 0.02 * c1)))
    # the staff: planted from the right heel strike (ph 0.5) for 0.55 of the cycle,
    # its foot sliding back with the ground; then lifted and swung through
    # On the warped body the staff walks a shift out from where it walked (not the
    # hem's flare: scaled with it, the foot ran out of the arm's reach and the
    # forearm snapped round), and it is planted for a shorter stroke, so its foot
    # leaves the ice before it slides back into the broad hem.
    q = (ph - 0.5) % 1.0
    plant = 0.32
    y_front, y_back = -0.95, -0.95 + 2 * half * plant / 0.6
    if q < plant:
        u = q / plant
        foot = (-1.0, y_front + (y_back - y_front) * u, 0.0)
        top = (-0.86, foot[1] + 0.25 - 0.2 * u, 3.0)
    else:
        u = (q - plant) / (1 - plant)
        e = smooth(u)
        foot = (-1.0, y_back + (y_front - y_back) * e, 0.22 * math.sin(math.pi * u))
        top = (-0.86, foot[1] + 0.05 + 0.2 * e, 3.0)
    return aimed(b.but(hand_r=(-0.8, foot[1] + 0.2, 2.72)), foot, top)


def walk(rig):
    nfr = int(round(WALK_PERIOD * 24))
    return keys_of([(i / 24, walk_body(rig, (i / nfr) % 1.0), 'linear') for i in range(nfr + 1)], loop=True)


def idle(rig, period=5.0):
    """He leans on the staff and listens: the head tilts slowly one way and the
    other as if to the water, the jaw moves a little (he hums), the long fingers
    of the free hand keep time against the girdle."""
    base = stance(rig)
    hl = base.p['hand_l']
    keys = []
    for i in range(10):
        ph = i / 10
        br = math.sin(TAU * ph)
        b = base.but(lean=STOOP - 1.0 * br, neck=STOOP_NECK + 1.0 * br, clav_l=1.2 * br, clav_r=1.2 * br,
                     look=(10 * math.sin(TAU * ph + 0.4), -4 + 4 * math.sin(TAU * ph * 2)),
                     head_roll=9 * math.sin(TAU * ph + 0.9),
                     hand_l=(hl[0], hl[1], hl[2] + 0.02 * math.sin(TAU * ph * 4)),
                     fist_l=0.35 + 0.2 * max(0.0, math.sin(TAU * ph * 4)),
                     jaw=2.0 + 2.5 * max(0.0, math.sin(TAU * ph * 3)))
        keys.append((period * ph, planted(b, STAFF_SPOT), 'auto'))
    keys.append((period, keys[0][1], 'auto'))
    return keys_of(keys, loop=True)


def talk(rig):
    """He speaks: the free hand lifts palm up and opens toward whoever he speaks
    to, the head nods once with the words, then the hand settles again."""
    st = stance(rig)
    lift = st.but(hand_l=wp((0.36, -0.62, 2.62)), pole_l=(0.8, 0.3, -0.4), hand_dir_l=(0.15, -0.8, 0.5),
                  hand_roll_l=-80, fist_l=0.15, spread_l=14, look=(-6, 4), neck=8, jaw=8)
    open_ = lift.but(hand_l=wp((0.48, -0.72, 2.56)), hand_dir_l=(0.35, -0.8, 0.35), spread_l=22, look=(-4, -2),
                     neck=12, jaw=4)
    nod = open_.but(neck=18, look=(-4, -8), jaw=10)
    return keys_of([(0, planted(st, STAFF_SPOT), 'auto'), (0.45, planted(lift, STAFF_SPOT), 'inout'),
                    (0.95, planted(open_, STAFF_SPOT), 'inout'), (1.35, planted(nod, STAFF_SPOT), 'inout'),
                    (1.8, planted(open_.but(jaw=3), STAFF_SPOT), 'inout'), (2.5, planted(st, STAFF_SPOT), 'auto')])


def startle(rig):
    """He sees what became of someone he knew: a step back off his weight, the
    free hand flies to his mouth, he holds there, then lowers it slowly."""
    st = stance(rig)
    back = st.but(pelvis=(0.0, 0.16, -0.04), lean=4, neck=8, look=(0, 6), foot_l=wx((0.18, 0.3, 0.14)),
                  hand_l=wh((0.1, -0.3, 3.62)), pole_l=(0.8, 0.2, -0.5), hand_dir_l=(-0.4, -0.2, 0.9),
                  hand_roll_l=-60, fist_l=0.5, spread_l=6, jaw=6)
    hold = back.but(lean=8, neck=12, look=(0, 2))
    lower = st.but(hand_l=wp((0.24, -0.4, 2.85)), hand_dir_l=(-0.2, -0.3, 0.8), fist_l=0.5, look=(0, -6), neck=STOOP_NECK)
    spot = (STAFF_SPOT[0], STAFF_SPOT[1] + 0.1, 0.0)
    return keys_of([(0, planted(st, STAFF_SPOT), 'auto'), (0.22, planted(back, spot), 'out'),
                    (1.3, planted(hold, spot), 'inout'), (1.9, planted(lower, STAFF_SPOT), 'inout'),
                    (2.6, planted(st, STAFF_SPOT), 'auto')])


def kneel_body(rig, bow=0.0):
    knees = dict(foot_l=wx((0.2, 0.55, 0.12)), foot_r=wx((-0.2, 0.55, 0.12)), knee_l=(0.1, -1.0, -0.3),
                 foot_dir_l=(0.0, 0.3, -1.0), foot_dir_r=(0.0, 0.3, -1.0), toe_l=-30, toe_r=-30)
    b = Body(rig, pelvis=(0, 0.05, -0.92), hip_tilt=6, lean=16 + 10 * bow, neck=16 + 10 * bow,
             look=(0, -12 - 8 * bow), jaw=2, hand_l=wp((0.18, -0.36, 2.2 - 0.05 * bow)), pole_l=(0.8, 0.4, -0.3),
             hand_dir_l=(-0.3, -0.2, 0.9), fist_l=0.6, hand_r=wp((-0.6, -0.5, 1.95)), pole_r=(-0.7, 0.5, -0.3),
             staff=_n((-0.12, -0.3, 1.0)), **knees)
    return aimed(b, wp((-0.8, -0.72, 0.0)), wp((-0.68, -0.6, 2.0)))


def kneel(rig):
    """At the moon pool where the Choir knelt: he lowers himself down the staff
    onto both knees, bows his head with the free hand on his breast, then climbs
    back up the staff, slowly.
    CONTACT: the knees reach the ground at 1.2 s; he is up again by 4.4 s."""
    st = planted(stance(rig), STAFF_SPOT)
    half = st.mix(kneel_body(rig), 0.5)
    return keys_of([(0, st, 'auto'), (0.6, half, 'inout'), (1.2, kneel_body(rig), 'out'),
                    (2.0, kneel_body(rig, 1.0), 'inout'), (3.0, kneel_body(rig, 1.0), 'inout'),
                    (3.7, half, 'inout'), (4.4, st, 'auto')])


def sing_body(rig, ph):
    """The last verse, a song of the whole body: he straightens as far as his old
    back allows and leans back into the note, the chin lifted to the moon, the free
    arm opened wide and high with the palm up, the staff lifted off the stone in
    his raised right fist; on each long note the arms and the chest rise with the
    breath and the jaw opens wide, then settle; a slow sway through it all."""
    sw = math.sin(TAU * ph)
    note = 0.5 + 0.5 * math.sin(TAU * ph * 2 + 0.6)
    b = Body(rig, pelvis=(0.025 * sw, 0.03, 0.02 * note), lean=-7 - 3 * note, neck=-12 - 5 * note,
             look=(5 * sw, 26 + 8 * note), head_roll=5 * sw, twist=4 * sw, side=2 * sw, hip_tilt=-5,
             hand_l=wreach((0.9 + 0.03 * note, -0.46, 3.2 + 0.14 * note), 1), pole_l=(0.5, 0.6, -0.7),
             hand_dir_l=(0.55, -0.45, 0.45), hand_roll_l=-105, fist_l=0.05, spread_l=24,
             hand_r=wreach((-0.66, -0.44, 3.38 + 0.1 * note), -1), pole_r=(-0.6, 0.6, -0.7), fist_r=1.0,
             staff=_n((-0.16 - 0.03 * sw, -0.14, 1.0)),
             foot_l=wx((0.22, -0.04, 0.14)), foot_r=wx((-0.22, 0.08, 0.14)), clav_l=10 + 5 * note, clav_r=10 + 5 * note,
             jaw=14 + 14 * note)
    return b


def sing(rig, period=4.0):
    """Sing (loop, his channel at the Moon Altar while the fallen rise)."""
    keys = [(period * i / 8, sing_body(rig, i / 8), 'auto') for i in range(8)]
    keys.append((period, keys[0][1], 'auto'))
    return keys_of(keys, loop=True)


# name, builder, loops, march drag (yards/s)
CATALOG = [
    ('Idle', idle, True, 0.0),
    ('Walk', walk, True, WALK_SPEED),
    ('Talk', talk, False, 0.0),
    ('Startle', startle, False, 0.0),
    ('Kneel', kneel, False, 0.0),
    ('Sing', sing, True, 0.0),
]
