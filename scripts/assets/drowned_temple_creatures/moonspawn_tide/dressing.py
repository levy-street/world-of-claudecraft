"""The Moonspawn's dressing: its eyes (two glowing moon-pearls), glassy teeth
along its jaws, and the pool of moonlit water it pours back into (Pool)."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    return (hi, o)


def build(sculpts):
    eyes = K.Part('Eyes', 'glow_eye', bone='Head')
    for s in (1, -1):
        eyes.sphere(np.array((s * 0.23, -1.46, 1.2)), (0.06, 0.08, 0.045), seg=10, rings=6)
    teeth = K.Part('Teeth', 'glow_teeth', bone='Head')
    low = K.Part('LowTeeth', 'glow_teeth', bone='Jaw')
    for i in range(7):
        y = -1.48 - 0.07 * i
        for s in (1, -1):
            x = s * (0.19 - 0.014 * i)
            teeth.tube([np.array((x, y, 1.01)), np.array((x, y - 0.01, 0.95))], [0.018, 0.003], sides=4)
            low.tube([np.array((x * 0.95, y, 1.0)), np.array((x * 0.95, y - 0.01, 1.06))], [0.016, 0.003], sides=4)
    pool = K.Part('MoonPool', 'glow_pool', bone='Pool')
    pool.sphere(A.POOL_AT + np.array((0, 0, 0.012)), (1.5, 1.8, 0.014), seg=28, rings=6)
    rim = K.Part('MoonFoam', 'glow_eye', bone='Pool')
    rim.torus(A.POOL_AT + np.array((0, 0, 0.025)), (0, 0, 1), 1.45, 0.03, seg=40, sides=5, squash=(1.0, 1.2))
    _ = math
    return [_pair(eyes), _pair(teeth), _pair(low), _pair(pool), _pair(rim)]
