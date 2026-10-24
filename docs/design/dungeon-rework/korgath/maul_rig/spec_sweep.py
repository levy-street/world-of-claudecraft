"""HammerSweep: Korgath's one-handed flat sweep, his right to his left (1.5 s,
the head crosses his front on frame 18 = f17).

Beats (30 fps):
  f0   Idle
  f3   anticipation: the head swings a little forward as he dips
  f3-11 the load: the maul swung back along his right side and up to shoulder
       height behind him, the haft sliding to its end; hips and chest coil
       right, weight on the right foot; the left arm points ahead
  f11-13 the hang at the top of the load
  f13-17 the sweep: the hips fire first, then the chest, then the arm; the head
       comes round his right side low and crosses his front at f17; the left
       arm pulls back and out
  f17-23 follow-through to his left, the body wound left, the arm across him
  f23-26 the maul's weight stops him
  f26-38 the maul brought back to his side, the haft sliding back
  f38-45 Idle
"""
from mathutils import Vector

V = Vector


def build(rig):
    H0 = rig.P0['hammer']
    D0 = (H0.to_3x3() @ V((0, 1, 0))).normalized()
    N0 = (H0.to_3x3() @ V((1, 0, 0))).normalized()
    F0 = H0 @ V((0, 0.42, 0))

    def k(F, D):
        D = V(D).normalized()
        return (V(F), D, V((0, 0, 1)).cross(D).normalized())

    D3 = (D0 + V((0, -0.25, 0))).normalized()
    spec = {
        'length': 45,
        'maul': {
            0: (F0, D0, N0),
            3: (F0 + V((0, -0.05, -0.12)), D3, N0),
            6: k((-2.0, 0.45, 6.0), (-0.35, 0.85, -0.4)),
            9: k((-2.2, 0.85, 6.9), (-0.55, 0.82, 0.1)),
            11: k((-2.25, 1.0, 7.1), (-0.5, 0.86, 0.14)),
            13: k((-2.3, 1.05, 7.15), (-0.48, 0.86, 0.16)),
            15: k((-2.45, -0.4, 6.4), (-0.97, 0.12, -0.22)),
            16: k((-1.95, -1.6, 6.0), (-0.6, -0.75, -0.3)),
            17: k((-1.0, -2.3, 5.8), (0.0, -0.86, -0.5)),
            20: k((-0.1, -2.15, 6.0), (0.8, -0.55, -0.25)),
            23: k((0.25, -1.65, 6.2), (0.9, 0.0, -0.35)),
            26: k((0.15, -1.65, 6.0), (0.85, 0.1, -0.5)),
            32: k((-1.35, -1.2, 5.8), (-0.2, -0.6, -0.77)),
            38: (F0 + V((0, -0.3, -0.05)), (D0 + V((0, -0.08, 0))).normalized(), N0),
            42: (F0, D0, N0),
            45: (F0, D0, N0),
        },
        'maul_ease': {3: 'io', 6: 'io', 9: 'lin', 11: 'out', 13: 'io', 15: 'in', 16: 'lin', 17: 'lin',
                      20: 'out', 23: 'out', 26: 'io', 32: 'io', 38: 'io', 42: 'io', 45: 'io'},
        'right_s': {0: 0.42, 3: 0.42, 9: 0.2, 11: 0.14, 26: 0.14, 34: 0.32, 40: 0.42, 45: 0.42},
        'right_phi': 'auto',
        'body': {
            0: {},
            3: {'hips': (0.05, -0.05, -0.15, 2, 0, 3), 'spine': (3, 0, 3), 'chest': (3, 0, 4)},
            7: {'hips': (-0.15, 0.15, -0.1, 0, 1, -12), 'spine': (-1, 1, -10), 'chest': (-3, 2, -14), 'neck': (2, 0, 12), 'head': (1, 0, 6)},
            11: {'hips': (-0.35, 0.25, -0.05, 0, 2, -20), 'spine': (-2, 2, -14), 'chest': (-4, 4, -21), 'neck': (4, 0, 18), 'head': (2, 0, 10)},
            14: {'hips': (-0.4, 0.3, -0.1, 0, 3, -22), 'spine': (-2, 3, -15), 'chest': (-5, 5, -23), 'neck': (4, 0, 20), 'head': (2, 0, 11)},
            15: {'hips': (-0.15, 0.0, -0.3, 3, 1, -5), 'spine': (2, 2, -10), 'chest': (2, 3, -14), 'neck': (0, 0, 14), 'head': (0, 0, 8)},
            16: {'hips': (0.05, -0.15, -0.45, 6, 0, 6), 'spine': (5, 0, -2), 'chest': (6, 0, -6), 'neck': (-4, 0, 6), 'head': (-2, 0, 4)},
            17: {'hips': (0.2, -0.25, -0.55, 8, -1, 14), 'spine': (7, -1, 6), 'chest': (8, -2, 6), 'neck': (-6, 0, -2), 'head': (-3, 0, 0)},
            20: {'hips': (0.35, -0.2, -0.45, 6, -2, 22), 'spine': (5, -2, 12), 'chest': (5, -3, 16), 'neck': (-4, 0, -10), 'head': (-2, 0, -4)},
            23: {'hips': (0.38, -0.15, -0.4, 5, -2, 24), 'spine': (4, -2, 14), 'chest': (4, -3, 18), 'neck': (-3, 0, -12), 'head': (-2, 0, -5)},
            26: {'hips': (0.32, -0.15, -0.42, 5, -2, 21), 'spine': (4, -2, 12), 'chest': (4, -3, 15), 'neck': (-3, 0, -10), 'head': (-2, 0, -4)},
            33: {'hips': (0.0, -0.12, -0.25, 3, 0, 4), 'spine': (5, 0, 4), 'chest': (6, 0, 5), 'neck': (-4, 0, -3)},
            40: {'hips': (0, -0.05, -0.1, 1, 0, 1), 'spine': (2, 0, 1), 'chest': (2, 0, 1)},
            45: {},
        },
        'body_ease': {3: 'io', 7: 'io', 11: 'out', 14: 'io', 15: 'in', 16: 'lin', 17: 'lin', 20: 'out', 23: 'out',
                      26: 'io', 33: 'io', 40: 'io', 45: 'io'},
        'left_off': {0: (0, 0, 0), 3: (0.05, -0.2, 0.1), 7: (0.1, -1.0, 0.9), 11: (0.15, -1.5, 1.3),
                     14: (0.15, -1.5, 1.35), 15: (0.4, -0.8, 1.0), 17: (0.8, -1.2, 0.7), 20: (0.85, -1.6, 0.6),
                     23: (0.8, -1.7, 0.5), 26: (0.8, -1.5, 0.45), 30: (0.5, -0.8, 0.25),
                     36: (0.2, -0.2, 0.1), 40: (0, 0, 0), 45: (0, 0, 0)},
        'left_ease': {15: 'in', 17: 'out'},
        'left_curl': {0: 0, 9: 20, 13: 35, 23: 35, 34: 10, 42: 0, 45: 0},
        'pole_r': {0: 'idle', 3: 'idle', 6: V((-1, 0.4, -0.6)), 11: V((-1, 0.2, -0.6)), 14: V((-1, 0.3, -0.5)),
                   17: V((-0.6, 0.4, -0.7)), 23: V((-0.3, 0.3, -1)), 32: V((-1, 0.3, -0.5)), 42: 'idle', 45: 'idle'},
        'pole_l': {0: 'idle', 3: 'idle', 9: V((1, 0.4, -0.6)), 14: V((1, 0.3, -0.6)), 17: V((1, 0.5, -0.5)),
                   30: V((1, 0.5, -0.6)), 42: 'idle', 45: 'idle'},
        'sheet': [0, 3, 7, 11, 13, 15, 16, 17, 20, 23, 32, 45],
    }
    return {'HammerSweep': spec}
