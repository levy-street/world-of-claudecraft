"""The Sentinel's dressing: its heart pearl (Pearl, glowing), the same pearl
gone dark that rolls out when it dies (PearlFree), the silver crescent crest on
its head, a row of pearls along the back valve's crown, silver hinge bands
with moons where the valves meet its hips, and the nacre shards scattered by
its death (Shards)."""
import math

import numpy as np

import anatomy as A
import mesh_kit as K


def _pair(part):
    o = part.to_object()
    hi = K.duplicate(o, o.name + '_hi')
    return (hi, o)


def build_pearls():
    heart = K.Part('HeartPearl', 'glow_pearl', bone='Pearl')
    heart.sphere(A.PEARL_AT, (A.PEARL_R, A.PEARL_R, A.PEARL_R), seg=24, rings=14)
    dark = K.Part('DarkPearl', 'pearl', bone='PearlFree')
    dark.sphere(A.PEARL_AT, (A.PEARL_R, A.PEARL_R, A.PEARL_R), seg=24, rings=14)
    return [_pair(heart), _pair(dark)]


def build_crest():
    sil = K.Part('Crest', 'silver', bone='Head')
    c = A.HEAD_C + np.array((0, -0.06, 0.34))
    arc, rad = [], []
    for i in range(19):
        a = math.radians(200 + 140 * i / 18)
        arc.append(c + np.array((0.22 * math.cos(a), 0.0, 0.22 * math.sin(a) + 0.14)))
        rad.append(0.012 + 0.04 * math.sin(math.pi * i / 18))
    sil.tube(arc, rad, sides=7, up=(0, -1, 0))
    band = []
    for i in range(21):
        th = math.radians(-110 + 220 * i / 20)
        band.append(A.HEAD_C + np.array((0.31 * math.sin(th), -0.29 * math.cos(th) - 0.02, 0.12)))
    sil.tube(band, 0.022, sides=6)
    gem = K.Part('CrestPearl', 'glow_pearl', bone='Head')
    gem.sphere(c + np.array((0, -0.02, 0.0)), (0.05, 0.05, 0.05), seg=10, rings=6)
    return [_pair(sil), _pair(gem)]


def build_valve_pearls():
    """Pearls set along the back valve's crown, and a silver band with a moon
    over each hinge."""
    H, Xa, U, N = A.valve_frame(False)
    p = K.Part('ValvePearls', 'pearl', bone='ValveB')
    for i in range(13):
        x = -A.VALVE_W * 0.85 + 2 * A.VALVE_W * 0.85 * i / 12
        v = A._valve_top(np.array(x), False) - 0.06
        cv = A.VALVE_H - 0.05
        tt = max(0.0, 1 - (x / A.VALVE_W) ** 2 - ((v - cv) / (A.VALVE_H + 0.15)) ** 2)
        w = A.VALVE_D * math.sqrt(tt) + 0.02
        q = H + Xa * x + U * v + N * w
        p.sphere(q, (0.05, 0.05, 0.05), seg=10, rings=6)
    out = [_pair(p)]
    for front, bone in ((True, 'ValveF'), (False, 'ValveB')):
        H, Xa, U, N = A.valve_frame(front)
        sil = K.Part(f'Hinge{bone}', 'silver', bone=bone)
        pts = [H + Xa * x + U * 0.05 + N * (0.28 * math.sqrt(max(0.0, 1 - (x / 0.75) ** 2)) + 0.05)
               for x in np.linspace(-0.7, 0.7, 13)]
        sil.tube(pts, 0.035, sides=6)
        c = H + U * 0.12 + N * 0.36
        arc, rad = [], []
        for i in range(13):
            a = math.radians(200 + 140 * i / 12)
            arc.append(c + Xa * 0.1 * math.cos(a) + U * (0.1 * math.sin(a) + 0.04))
            rad.append(0.008 + 0.022 * math.sin(math.pi * i / 12))
        sil.tube(arc, rad, sides=6, up=tuple(N))
        out.append(_pair(sil))
    return out


def build_shards():
    p = K.Part('Shards', 'shell_shard', bone='Shards')
    rng = np.random.default_rng(29)
    for i in range(16):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(0.4, 1.9)
        c = np.array((math.cos(a) * r, -1.2 + math.sin(a) * r * 0.8 + 1.2, 0.04))
        s = rng.uniform(0.08, 0.18)
        p.box(c, (s, s * 0.7, 0.03), bevel=0.01)
    return [_pair(p)]


def build(sculpts):
    return build_pearls() + build_crest() + build_valve_pearls() + build_shards()
