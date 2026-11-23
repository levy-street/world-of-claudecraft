"""The Drakemaw Raptor's anatomy: where its joints sit inside the Tripo mesh.

Every landmark was read off measured orthographic renders of the unrigged
source (a 2.5 cm model-unit grid burned into side, front and top views) and
checked against the vertex cross-sections at each joint, in SOURCE units: the
mesh as extracted, 0.9355 tall, soles on Z = 0, facing -Y, its left on +X
(Blender axes). The build scales everything by SCALE so the model stands at
its ridden height in game yards: one model yard is one game yard, so a planted
foot's speed in the clips IS the manifest's walkRef / runRef.

The rig is a theropod's, built for a mount:
  Root (on the ground, never animated)
    Hips: the body's mover; the saddle and the tail ride it
      Spine1, Spine2 (the chest), Neck1, Neck2, Head
      L/R UpperArm, Forearm, Hand (the tucked forelimbs)
      Tail1..Tail6
      L/R Thigh, Shin, Foot (the metatarsus), Toes: the bird leg,
        knee forward, the heel (the ankle) back, the long foot down to the ball
      Saddle: rigid leather; the rider's seat
There is no jaw: the mouth is one fused surface with the teeth set on its seam,
so a jaw bone could only stretch the face.
"""

SRC_HEIGHT = 0.9355          # rest height of the source mesh
GAME_HEIGHT = 3.4            # the source's rest pose in game yards (the Idle crouches lower;
                             # its measured height is the manifest's `height`)
SCALE = GAME_HEIGHT / SRC_HEIGHT

# Left-side landmarks in source units (x, y, z); the right side mirrors x.
HIP = (0.088, -0.005, 0.470)       # the femur's head, high in the drumstick
KNEE = (0.118, -0.052, 0.290)      # forward, at the front of the thigh's fold
ANKLE = (0.107, 0.012, 0.215)      # the heel: the backward bend above the leather bands
# The toes' root: where the three toes split off the sole pad (read off a view
# from underneath), low by the sole. Any further back and the front of the boot
# rides the metatarsus, so it swings down into the ground as the heel lifts.
BALL = (0.125, -0.077, 0.019)
TOE_TIP = (0.135, -0.190, 0.012)   # the middle claw, along the ground
SHOULDER = (0.105, -0.252, 0.552)
ELBOW = (0.114, -0.220, 0.493)
WRIST = (0.105, -0.300, 0.463)
HAND_TIP = (0.090, -0.298, 0.408)

# The midline chain, root to snout and root to tail tip.
HIPS = (0.0, 0.010, 0.480)
SPINE1 = (0.0, -0.060, 0.500)
SPINE2 = (0.0, -0.150, 0.533)
NECK1 = (0.0, -0.240, 0.575)
NECK2 = (0.0, -0.262, 0.665)
HEAD = (0.0, -0.278, 0.762)        # the skull's pivot on the neck
SNOUT = (0.0, -0.480, 0.800)
TAIL = [(0.0, 0.050, 0.500), (0.0, 0.135, 0.506), (0.0, 0.215, 0.517), (0.0, 0.295, 0.542),
        (0.0, 0.370, 0.575), (0.0, 0.435, 0.610), (0.0, 0.496, 0.660)]
SEAT = (0.0, -0.080, 0.654)        # the front of the saddle's dish, where it starts up to the pommel


def mirror(p):
    return (-p[0], p[1], p[2])


def _bones():
    b = [
        ('Root', None, (0.0, 0.0, 0.0), (0.0, -0.12, 0.0)),
        ('Hips', 'Root', HIPS, SPINE1),
        ('Spine1', 'Hips', SPINE1, SPINE2),
        ('Spine2', 'Spine1', SPINE2, NECK1),
        ('Neck1', 'Spine2', NECK1, NECK2),
        ('Neck2', 'Neck1', NECK2, HEAD),
        ('Head', 'Neck2', HEAD, SNOUT),
        ('Saddle', 'Hips', SEAT, (SEAT[0], SEAT[1], SEAT[2] + 0.1)),
    ]
    for i in range(len(TAIL) - 1):
        b.append((f'Tail{i + 1}', 'Hips' if i == 0 else f'Tail{i}', TAIL[i], TAIL[i + 1]))
    for side, m in (('L_', lambda p: p), ('R_', mirror)):
        b += [
            (side + 'Thigh', 'Hips', m(HIP), m(KNEE)),
            (side + 'Shin', side + 'Thigh', m(KNEE), m(ANKLE)),
            (side + 'Foot', side + 'Shin', m(ANKLE), m(BALL)),
            (side + 'Toes', side + 'Foot', m(BALL), m(TOE_TIP)),
            (side + 'UpperArm', 'Spine2', m(SHOULDER), m(ELBOW)),
            (side + 'Forearm', side + 'UpperArm', m(ELBOW), m(WRIST)),
            (side + 'Hand', side + 'Forearm', m(WRIST), m(HAND_TIP)),
        ]
    return b


def scaled(p, s=SCALE):
    return tuple(float(c) * s for c in p)


# (name, parent, head, tail) in BUILD units (yards), parents before children
BONES = [(n, p, scaled(h), scaled(t)) for n, p, h, t in _bones()]
REST = {n: (h, t) for n, _, h, t in BONES}
PARENT = {n: p for n, p, _, _ in BONES}
DEFORM = [n for n, _, _, _ in BONES if n != 'Root']
TAIL_BONES = [f'Tail{i + 1}' for i in range(len(TAIL) - 1)]
