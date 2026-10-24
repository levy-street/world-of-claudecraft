"""HammerSlam: Korgath's one-handed overhead smash (1.5 s, the blow on frame 18 = f17).

The right fist keeps the grip the body is modeled with (the head on the
little-finger side) and lets the haft slide to its end for the swing; the left
hand never touches the haft.

Beats (30 fps):
  f0   Idle (the maul hangs at his right side)
  f3   anticipation: the head swings a little forward as he dips
  f3-11 the wind-up: the maul swings back past his right hip and up behind him
       (a windmill), the haft sliding to its end in the fist; hips and chest
       coil right, he rises; the left arm reaches forward and out
  f11-13 the top: the maul up over his right shoulder, the head high behind
  f13-17 the smash: the arm whips the maul over, the hips and chest drive
       down and forward, knees bend, the left arm thrown back and out; the head
       meets the terrace in front of him at f17
  f17-21 impact hold, a small rebound, the body sinks after the blow
  f21-36 the haul back to his side, the haft sliding back to its carry
  f36-45 Idle
"""
from mathutils import Vector
import kanim

V = Vector


def build(rig):
    S = rig.S
    H0 = rig.P0['hammer']
    D0 = (H0.to_3x3() @ V((0, 1, 0))).normalized()
    N0 = (H0.to_3x3() @ V((1, 0, 0))).normalized()
    F0 = H0 @ V((0, 0.42, 0))  # the fist's point on the haft at Idle

    def k(F, D, N=None):
        D = V(D).normalized()
        if N is None:
            N = D.cross(V((1, 0, 0)))
        return (V(F), D, V(N).normalized())

    D3 = (D0 + V((0, -0.25, 0))).normalized()
    spec = {
        'length': 45,
        'maul': {
            0: (F0, D0, N0),
            3: (F0 + V((0, -0.05, -0.12)), D3, N0),
            6: k((-2.0, 0.45, 6.0), (-0.1, 0.75, -0.65)),
            9: k((-2.05, 0.6, 7.7), (-0.15, 0.95, 0.25)),
            11: k((-1.9, 0.4, 9.7), (-0.1, 0.35, 0.93)),
            13: k((-1.85, 0.55, 9.85), (-0.08, 0.55, 0.83)),
            15: k((-1.7, -1.0, 9.3), (-0.05, -0.45, 0.89)),
            16: k((-1.5, -2.2, 7.3), (0.0, -0.97, 0.2)),
            17: k((-1.35, -2.6, 4.8), (0.05, -0.8, -0.6)),
            19: k((-1.35, -2.55, 4.95), (0.05, -0.8, -0.57)),
            21: k((-1.35, -2.6, 4.8), (0.05, -0.8, -0.6)),
            28: k((-1.8, -1.4, 5.5), (-0.15, -0.55, -0.82)),
            36: (F0 + V((0, -0.3, -0.05)), (D0 + V((0, -0.08, 0))).normalized(), N0),
            42: (F0, D0, N0),
            45: (F0, D0, N0),
        },
        'maul_ease': {3: 'io', 6: 'io', 9: 'lin', 11: 'out', 13: 'io', 15: 'in', 16: 'lin', 17: 'lin',
                      19: 'out', 21: 'io', 28: 'io', 36: 'io', 42: 'io', 45: 'io'},
        'right_s': {0: 0.42, 3: 0.42, 9: 0.2, 11: 0.12, 21: 0.12, 30: 0.3, 38: 0.42, 45: 0.42},
        'right_phi': 'auto',
        'body': {
            0: {},
            3: {'hips': (0.05, -0.05, -0.15, 2, 0, 3), 'spine': (3, 0, 3), 'chest': (3, 0, 4)},
            7: {'hips': (-0.15, 0.2, -0.05, -1, 0, -8), 'spine': (-2, 1, -8), 'chest': (-4, 2, -10), 'neck': (2, 0, 6), 'head': (2, 0, 4)},
            11: {'hips': (-0.3, 0.35, 0.1, -3, 0, -13), 'spine': (-5, 2, -10), 'chest': (-8, 4, -15), 'neck': (6, 0, 10), 'head': (4, 0, 5)},
            14: {'hips': (-0.32, 0.4, 0.12, -4, 0, -14), 'spine': (-6, 2, -11), 'chest': (-10, 4, -16), 'neck': (8, 0, 11), 'head': (5, 0, 5)},
            15: {'hips': (-0.12, 0.05, -0.1, 3, 0, -3), 'spine': (3, 0, -3), 'chest': (1, 1, -4), 'neck': (-1, 0, 2)},
            16: {'hips': (0.05, -0.25, -0.45, 8, 0, 3), 'spine': (10, 0, 2), 'chest': (10, -1, 4), 'neck': (-10, 0, -1), 'head': (-6, 0, 0)},
            17: {'hips': (0.12, -0.45, -0.8, 12, 0, 6), 'spine': (16, 0, 4), 'chest': (18, -2, 8), 'neck': (-16, 0, -4), 'head': (-10, 0, -2)},
            21: {'hips': (0.12, -0.5, -0.9, 13, 0, 6), 'spine': (17, 0, 4), 'chest': (19, -2, 8), 'neck': (-17, 0, -4), 'head': (-10, 0, -2)},
            30: {'hips': (0.02, -0.15, -0.3, 4, 0, 3), 'spine': (6, 0, 3), 'chest': (7, 0, 4), 'neck': (-5, 0, -2)},
            38: {'hips': (0, -0.05, -0.1, 1, 0, 1), 'spine': (2, 0, 1), 'chest': (2, 0, 1)},
            45: {},
        },
        'body_ease': {3: 'io', 7: 'io', 11: 'out', 14: 'io', 15: 'io', 16: 'lin', 17: 'lin', 21: 'out',
                      30: 'io', 38: 'io', 45: 'io'},
        'left_off': {0: (0, 0, 0), 3: (0.05, -0.2, 0.1), 7: (0.3, -0.9, 0.9), 11: (0.5, -1.3, 1.5),
                     14: (0.55, -1.3, 1.6), 15: (0.75, -0.7, 1.2), 17: (1.0, -1.4, 0.5), 21: (0.95, -1.3, 0.4),
                     30: (0.4, 0.0, 0.2), 40: (0, 0, 0), 45: (0, 0, 0)},
        'left_ease': {15: 'in', 17: 'out'},
        'left_curl': {0: 0, 9: 20, 13: 35, 21: 35, 32: 10, 42: 0, 45: 0},
        'pole_r': {0: 'idle', 3: 'idle', 6: V((-1, 0.3, -0.6)), 11: V((-0.8, -0.5, -0.3)), 14: V((-0.8, -0.4, -0.3)),
                   17: V((-1, 0.2, -0.4)), 30: V((-1, 0.4, -0.5)), 42: 'idle', 45: 'idle'},
        'pole_l': {0: 'idle', 3: 'idle', 9: V((1, 0.4, -0.6)), 14: V((1, 0.2, -0.5)), 17: V((1, 0.6, -0.4)),
                   30: V((1, 0.5, -0.6)), 42: 'idle', 45: 'idle'},
        'sheet': [0, 3, 7, 11, 13, 15, 16, 17, 21, 28, 36, 45],
    }
    return {'HammerSlam': spec}
