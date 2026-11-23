"""The body clips whose LEFT hand went to the haft, with only the left arm
re-solved off it: MaulArc (the one-handed cleave's left hand closed on the
pommel), ThresholdCharge and its run loop (the charge carried the maul like a
ram in both hands). Their body, right arm, maul and timing stay the clip's own;
the left arm swings free as a counterbalance (out to his side and ahead, never
behind his back), blended in from the clip's own arm where the clip starts and
ends on Idle; the run loop pumps it in time with his stride.
"""
import math
from mathutils import Vector

V = Vector


def build(rig):
    import bpy
    out = {}
    # MaulArc: 2.43 s; the left hand comes off the haft for the whole cleave
    n = round(bpy.data.actions['MaulArc'].frame_range[1])
    out['MaulArc'] = {
        'length': n, 'base': 'MaulArc',
        'left_w': {0: 0.0, 8: 1.0, n - 10: 1.0, n: 0.0},
        'left_off': {0: (0, 0, 0), 10: (0.45, -0.7, 0.5), 30: (0.6, -0.8, 0.6), 45: (0.8, -0.6, 0.45),
                     55: (0.7, -0.6, 0.4), n: (0.2, -0.2, 0.1)},
        'left_curl': {0: 0, 12: 25, n - 12: 25, n: 0},
        'pole_l': {0: V((1, 0.5, -0.6)), n: V((1, 0.5, -0.6))},
    }
    # the run loop: the left arm pumps opposite the right leg
    L = round(bpy.data.actions['ThresholdChargeLoop'].frame_range[1])
    ys = [(f, rig.pose_of('ThresholdChargeLoop', f)['foot.r'].translation.y) for f in range(L)]
    f_fwd = min(ys, key=lambda x: x[1])[0]  # right foot furthest ahead (-Y)

    def pump(f):
        a = 2 * math.pi * (f - f_fwd) / L
        # left hand ahead when the right foot is ahead
        return (0.45 + 0.1 * math.cos(a), -0.6 - 0.8 * math.cos(a), 0.5 + 0.35 * math.cos(a))

    loop_off = {f: pump(f) for f in range(0, L + 1, 2)}
    loop_off[L] = pump(L)
    out['ThresholdChargeLoop'] = {
        'length': L, 'base': 'ThresholdChargeLoop',
        'left_w': {0: 1.0, L: 1.0},
        'left_off': loop_off,
        'left_curl': {0: 35, L: 35},
        'pole_l': {0: V((1, 0.6, -0.5)), L: V((1, 0.6, -0.5))},
    }
    # the charge's wind-up ends exactly where the loop begins
    m = round(bpy.data.actions['ThresholdCharge'].frame_range[1])
    out['ThresholdCharge'] = {
        'length': m, 'base': 'ThresholdCharge',
        'left_w': {0: 0.0, 8: 1.0, m: 1.0},
        'left_off': {0: (0, 0, 0), 10: (0.5, -0.9, 0.8), 40: (0.6, -1.0, 0.8), m - 6: pump(-6 + 0), m: pump(0)},
        'left_curl': {0: 0, 10: 35, m: 35},
        'pole_l': {0: V((1, 0.5, -0.6)), m: V((1, 0.6, -0.5))},
    }
    return out
