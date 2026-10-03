"""Build one Sunken Bastion creature: model, rigid-skinned rig and clip set.

  blender -b --factory-startup --python build_creature.py -- turretback <out.glb> [--preview out.png] [--blend out.blend]

The creatures (src/render/characters/manifest.ts VISUALS rows; the Gaol Turnkey
has its own organic-kit builder, turnkey.py, run like reaper.py):
  crawler     The Barnacle Crawler (crawler.py): a barnacled rock crab with a face.
  hound       The Bastion Warhound (hound.py): a shark-headed sea hound.
  hag         The Mist Chanter (hag.py): a hunched sea hag with a lure staff.
  drowned_<revenant|watchman|arbalest|sergeant|prisoner>
              The drowned garrison (drowned.py): one rig, five gear sets.
The sea creatures are smooth-bodied (sea_kit.py); ship each to
public/models/creatures/ (bastion_crawler, bastion_warhound, mist_chanter,
drowned_<variant>.glb), then `node scripts/build_media_manifest.mjs generate`.
  turretback  The Turretback Hermit: a colossal hermit crab that took a fallen
              watchtower turret for its shell, the tower (crenels, a broken
              banner, barnacles, a gull's nest) swaying on its back; one huge
              crushing claw and one small picking claw.

Clips: Idle, Walk, Run, Attack, Attack2, Hit, Death, Cast, plus ClawSweep (the
Claw Sweep cast) and ShellSlam (the Shell Slam cast). The shared helpers are
the Hollow Crypt creature kit (scripts/assets/hollow_crypt_creatures/
creature_kit.py): yards, +Z up, facing -Y, every part rigid-skinned to one bone.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'hollow_crypt_creatures')))
from creature_kit import (  # noqa: E402
    GLOW, Body, author_clip, build_rig, expand_bones, export, finish_body, loop, new_scene, preview,
)

SHELL = (0.74, 0.34, 0.2)         # weathered crab orange
SHELL_D = (0.52, 0.22, 0.13)
SHELL_HI = (0.86, 0.5, 0.3)
BELLY = (0.9, 0.78, 0.6)
CLAW_TIP = (0.22, 0.13, 0.1)
EYE = (0.04, 0.04, 0.05)
EYE_HI = (0.95, 0.95, 0.9)
LIME = (0.66, 0.64, 0.56)
LIME_PALE = (0.76, 0.74, 0.66)
LIME_DARK = (0.5, 0.5, 0.45)
SLATE = (0.26, 0.3, 0.31)
WOOD = (0.36, 0.28, 0.2)
WOOD_DARK = (0.22, 0.17, 0.12)
CLOTH = (0.2, 0.3, 0.42)
BARNACLE = (0.81, 0.78, 0.69)
WEED = (0.22, 0.28, 0.16)
ALGAE = (0.37, 0.5, 0.31)
TWIG = (0.42, 0.34, 0.24)
EGG = (0.82, 0.8, 0.7)

TURRETBACK_BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.5)),
    ('Body', 'Root', (0, -0.2, 1.6), (0, -1.8, 1.8)),
    ('Shell', 'Body', (0, 0.6, 1.9), (0, 2.2, 6.0)),
    ('EyeStalk.L', 'Body', (0.42, -2.1, 2.1), (0.5, -2.2, 2.95)),
    ('Antenna.L', 'Body', (0.28, -2.3, 1.8), (0.9, -3.4, 2.6)),
    ('Arm.L', 'Body', (1.1, -1.7, 1.45), (1.9, -2.7, 1.35)),
    ('Fore.L', 'Arm.L', (1.9, -2.7, 1.35), (2.15, -3.7, 1.55)),
    ('Pincer.L', 'Fore.L', (2.15, -3.7, 1.55), (2.3, -5.3, 1.7)),
    ('Jaw.L', 'Pincer.L', (2.1, -3.95, 1.15), (2.25, -5.1, 0.95)),
    ('Leg1.L', 'Body', (1.25, -1.1, 1.45), (2.55, -1.55, 1.95)),
    ('Leg1b.L', 'Leg1.L', (2.55, -1.55, 1.95), (3.35, -1.95, 0.0)),
    ('Leg2.L', 'Body', (1.35, -0.3, 1.45), (2.8, -0.2, 1.95)),
    ('Leg2b.L', 'Leg2.L', (2.8, -0.2, 1.95), (3.65, 0.0, 0.0)),
    ('Leg3.L', 'Body', (1.25, 0.5, 1.45), (2.55, 1.05, 1.85)),
    ('Leg3b.L', 'Leg3.L', (2.55, 1.05, 1.85), (3.2, 1.7, 0.0)),
])


def sides(fn):
    for s, tag in ((1, '.L'), (-1, '.R')):
        fn(s, tag)


def turret_blocks(p, cx, cy, z0, r, h, lean, courses=9):
    """A leaning round turret of coursed stone blocks (its own cylinder axis
    tilted back by `lean` radians about X)."""
    ax = math.sin(lean)
    for i in range(courses):
        zc = z0 + (i + 0.5) * h / courses
        ch = h / courses
        n = 14
        off = (i % 2) * 0.5
        for k in range(n):
            a = (k + off) / n * math.tau + p.rng.uniform(-0.03, 0.03)
            w = math.tau * r / n * p.rng.uniform(0.9, 1.0)
            d = 0.42
            push = p.rng.uniform(-0.03, 0.05)
            x = cx + math.cos(a) * (r - d / 2 + push)
            y = cy + math.sin(a) * (r - d / 2 + push) + ax * (zc - z0)
            broken = i >= courses - 2 and math.sin(a * 3 + 1.3) > 0.45
            if broken:
                continue
            col = SLATE if i == 0 else p.vary(LIME, 0.07)
            p.box((x, y, zc), (w - 0.07, d, ch - 0.07), col, yaw=a + math.pi / 2, bevel=0.05,
                  pitch=-lean * 0.0)
    # The dark core behind the blocks (no daylight through the joints).
    for i in range(courses):
        zc = z0 + (i + 0.5) * h / courses
        p.lathe((cx, cy + ax * (zc - z0), zc - h / courses / 2), [(r * 0.8, 0), (r * 0.8, h / courses)], 12,
                (0.07, 0.07, 0.07))


def turretback_body():
    p = Body('Turretback', lichen=0.25, weather=0.6)
    # ---- the crab: carapace, mouthparts, eyes ----------------------------------
    p.on('Body')
    p.rock((0, -1.0, 1.8), (3.5, 2.9, 1.6), p.vary(SHELL, 0.05), jitter=0.08, subdivisions=2)
    p.rock((0, -1.1, 1.25), (3.1, 2.5, 0.95), p.vary(BELLY, 0.05), jitter=0.08, subdivisions=2)
    # Carapace ridges and knobs.
    for k in range(5):
        x = -0.9 + k * 0.45
        p.box((x, -1.35 + abs(x) * 0.25, 2.35), (0.32, 1.3, 0.18), p.vary(SHELL_HI, 0.08), bevel=0.05,
              pitch=0.25, roll=x * 0.3)
    for k in range(7):
        a = k / 7 * math.pi - math.pi / 2
        p.rock((math.sin(a) * 1.2, -1.9 - math.cos(a) * 0.35, 2.0), (0.28, 0.24, 0.22), SHELL_D, subdivisions=1)
    # Mouthparts.
    for sx in (-0.25, 0.25):
        p.box((sx, -2.25, 1.35), (0.22, 0.35, 0.5), p.vary(SHELL_D), bevel=0.04, pitch=0.3)
    p.box((0, -2.2, 1.1), (0.7, 0.3, 0.2), BELLY, bevel=0.04)
    # Barnacles crusting the carapace.
    for _ in range(26):
        x, y = p.rng.uniform(-1.2, 1.2), p.rng.uniform(-2.0, 0.0)
        p.prism((x, y, 2.3 + 0.25 * math.cos(x)), 5, 0.1, 0.05, 0.14, p.vary(BARNACLE, 0.1))

    def eye(s, t):
        p.on('EyeStalk' + t)
        p.prism((s * 0.42, -2.1, 2.05), 6, 0.1, 0.08, 0.8, SHELL, lean=(s * 0.08, -0.1))
        p.rock((s * 0.5, -2.2, 2.95), (0.34, 0.34, 0.34), EYE, jitter=0.02, subdivisions=2)
        p.rock((s * 0.46, -2.33, 3.05), (0.1, 0.1, 0.1), EYE_HI, jitter=0.0, subdivisions=1, mat=GLOW)
        p.on('Antenna' + t)
        p.sweep(p.bezier((s * 0.28, -2.3, 1.8), (s * 0.7, -3.0, 2.8), (s * 0.95, -3.5, 2.5), 6), 0.05, 0.015,
                SHELL_D, sides=4)

    def claw(s, t):
        # One huge crushing claw (left), one small picking claw (right).
        k = 1.25 if s > 0 else 0.7
        p.on('Arm' + t)
        p.prism((s * 1.1, -1.7, 1.45), 7, 0.36 * k, 0.32 * k, 1.35, p.vary(SHELL, 0.05),
                axis=(s * 0.62, -0.78, -0.05))
        p.rock((s * 1.1, -1.7, 1.45), (0.62 * k, 0.62 * k, 0.6 * k), SHELL_HI, subdivisions=1)
        p.on('Fore' + t)
        p.prism((s * 1.9, -2.7, 1.35), 7, 0.4 * k, 0.36 * k, 1.05, p.vary(SHELL, 0.05),
                axis=(s * 0.24, -0.95, 0.2))
        for _ in range(4):
            p.spike((s * (2.0 + p.rng.uniform(-0.1, 0.2)), -3.0 - p.rng.random() * 0.5, 1.6 + 0.3 * k), 0.07,
                    0.2 * k, SHELL_D, sides=4)
        p.on('Pincer' + t)
        # The palm: a great rounded block, then the fixed upper finger curling in.
        p.rock((s * 2.2, -4.05, 1.55), (1.15 * k, 1.3 * k, 1.0 * k), p.vary(SHELL, 0.05), jitter=0.06,
               subdivisions=2)
        p.sweep(p.bezier((s * 2.25, -4.5, 1.75), (s * 2.35, -5.3, 1.95), (s * 2.1, -5.7, 1.5), 7),
                0.38 * k, 0.08 * k, SHELL, sides=6)
        p.spike((s * 2.1, -5.65, 1.5), 0.1 * k, 0.25 * k, CLAW_TIP, sides=4, lean=(0, -0.1))
        for _ in range(int(10 * k)):
            p.prism((s * (2.2 + p.rng.uniform(-0.4, 0.4)), -4.0 + p.rng.uniform(-0.4, 0.3), 1.55 + 0.45 * k), 5,
                    0.08, 0.04, 0.1, p.vary(BARNACLE, 0.1))
        p.on('Jaw' + t)
        p.sweep(p.bezier((s * 2.15, -4.3, 1.1), (s * 2.3, -5.0, 0.95), (s * 2.15, -5.4, 1.2), 7),
                0.3 * k, 0.07 * k, SHELL_D, sides=6)
        p.spike((s * 2.15, -5.4, 1.2), 0.08 * k, 0.2 * k, CLAW_TIP, sides=4, lean=(0, -0.05))

    def legs(s, t):
        for n, ((ax, ay, az), (bx, by, bz), (cx, cy, cz)) in enumerate((
            ((1.25, -1.1, 1.45), (2.55, -1.55, 1.95), (3.35, -1.95, 0.0)),
            ((1.35, -0.3, 1.45), (2.8, -0.2, 1.95), (3.65, 0.0, 0.0)),
            ((1.25, 0.5, 1.45), (2.55, 1.05, 1.85), (3.2, 1.7, 0.0)),
        )):
            up = f'Leg{n + 1}{t}'
            low = f'Leg{n + 1}b{t}'
            p.on(up)
            p.sweep([(s * ax, ay, az), (s * (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2 + 0.15), (s * bx, by, bz)],
                    0.42, 0.34, p.vary(SHELL, 0.06), sides=7)
            p.rock((s * bx, by, bz), (0.62, 0.62, 0.6), SHELL_HI, subdivisions=1)
            p.spike((s * bx, by, bz + 0.25), 0.1, 0.3, SHELL_D, sides=4)
            p.on(low)
            p.sweep([(s * bx, by, bz), (s * (bx + cx) / 2, (by + cy) / 2, (bz + cz) / 2 + 0.2), (s * cx, cy, cz + 0.12)],
                    0.33, 0.12, p.vary(SHELL, 0.06), sides=7)
            p.box((s * cx, cy, 0.1), (0.24, 0.24, 0.26), CLAW_TIP, bevel=0.03)

    sides(eye)
    sides(claw)
    sides(legs)
    # ---- the shell: the fallen watchtower turret ------------------------------------
    p.on('Shell')
    lean = 0.42
    # The soft abdomen curling up into the tower's mouth.
    p.rock((0, 0.6, 1.7), (2.3, 1.8, 1.1), p.vary(BELLY, 0.05), jitter=0.1, subdivisions=2)
    turret_blocks(p, 0.0, 1.1, 1.6, 2.35, 7.2, lean, courses=10)
    top_y = 1.1 + math.sin(lean) * 7.2
    top_z = 1.6 + 7.2
    # Broken crenels and a coping ring on the top.
    for k in range(8):
        a = k / 8 * math.tau
        if k in (2, 5):
            continue
        p.box((math.cos(a) * 2.3, top_y + math.sin(a) * 2.3, top_z + 0.45), (0.9, 0.55, 0.9), p.vary(LIME_PALE),
              yaw=a + math.pi / 2, bevel=0.05)
    # An arrow slit and a timber hoarding hanging broken off one side.
    p.box((2.36, 1.1 + math.sin(lean) * 4.5, 1.6 + 4.5), (0.08, 0.22, 1.1), (0.03, 0.03, 0.035))
    for i in range(4):
        p.box((-2.6, top_y - 0.6 + i * 0.5, top_z - 1.2 - i * 0.2), (0.35, 0.18, 1.5), WOOD_DARK, roll=0.35,
              bevel=0.02)
    # The broken banner pole with a torn Court banner streaming back.
    p.box((0.9, top_y + 0.8, top_z + 2.2), (0.12, 0.12, 4.2), WOOD, roll=-0.15, bevel=0.02)
    p.box((0.95, top_y + 1.5, top_z + 3.4), (0.05, 1.3, 1.1), CLOTH, roll=-0.15)
    p.box((0.95, top_y + 2.25, top_z + 3.2), (0.05, 0.6, 0.6), CLOTH, roll=-0.15, yaw=0.3)
    # A gull's nest on the broken top, two eggs and a scatter of down.
    for k in range(10):
        a = k / 10 * math.tau
        p.box((-0.8 + math.cos(a) * 0.6, top_y - 0.3 + math.sin(a) * 0.6, top_z + 0.9), (0.9, 0.08, 0.08), TWIG,
              yaw=a + 0.4)
    for k in range(2):
        p.rock((-0.8 + k * 0.25, top_y - 0.3, top_z + 1.05), (0.22, 0.18, 0.18), EGG, subdivisions=1)
    # Barnacles, kelp and weed all over the drowned lower courses.
    for _ in range(60):
        a = p.rng.random() * math.tau
        z = 1.7 + p.rng.random() ** 1.7 * 5.5
        x = math.cos(a) * 2.38
        y = 1.1 + math.sin(a) * 2.38 + math.sin(lean) * (z - 1.6)
        if p.rng.random() < 0.6:
            p.prism((x, y, z), 5, 0.13, 0.06, 0.18, p.vary(BARNACLE, 0.1), axis=(math.cos(a), math.sin(a), 0))
        else:
            ln = p.rng.uniform(0.5, 1.4)
            p.box((x * 1.02, y, z - ln / 2), (0.16, 0.05, ln), p.vary(WEED if p.rng.random() < 0.6 else ALGAE, 0.1),
                  yaw=a + math.pi / 2)
    return p


def turretback_clips(arm):
    stand = {'Arm.L': [('x', -8)], 'Fore.L': [('x', 6)], 'Arm.R': [('x', -12)],
             'EyeStalk.L': [('x', -6)], 'Shell': [('x', 2)]}
    stand_b = dict(stand, Shell=[('x', 4), ('y', 3)], **{'EyeStalk.L': [('x', -2), ('z', 8)],
                                                          'Antenna.L': [('z', 10)], 'Jaw.L': [('x', 8)]})
    author_clip(arm, 'Idle', loop(72, [stand, stand_b]))

    def stride(a, amp=1.0):
        return {'Body': [('z', 3 * a * amp)], 'Root': [('loc', (0, 0, 0.08 * abs(a) * amp))],
                'Shell': [('y', 6 * a * amp), ('x', 3)],
                'Leg1.L': [('x', -18 * a * amp), ('y', 10 * a * amp)], 'Leg1.R': [('x', 18 * a * amp)],
                'Leg2.L': [('x', 16 * a * amp)], 'Leg2.R': [('x', -16 * a * amp), ('y', -10 * a * amp)],
                'Leg3.L': [('x', -16 * a * amp)], 'Leg3.R': [('x', 16 * a * amp)],
                'Leg1b.L': [('x', 10 * a * amp)], 'Leg2b.R': [('x', 10 * a * amp)],
                'Arm.L': [('x', -12)], 'Arm.R': [('x', -16)], 'EyeStalk.L': [('x', -8)]}
    author_clip(arm, 'Walk', loop(32, [stride(1), stride(0), stride(-1), stride(0)]))
    author_clip(arm, 'Run', loop(20, [stride(1, 1.4), stride(0, 1.4), stride(-1, 1.4), stride(0, 1.4)]))
    raise_ = dict(stand, **{'Arm.L': [('x', -45), ('z', 10)], 'Fore.L': [('x', -20)], 'Jaw.L': [('x', 38)]},
                  Body=[('x', -6)])
    snap = dict(stand, **{'Arm.L': [('x', 18), ('z', -8)], 'Fore.L': [('x', 12)], 'Jaw.L': [('x', 0)]},
                Body=[('x', 8)], Shell=[('x', -4)])
    author_clip(arm, 'Attack', [(1, stand), (10, raise_), (15, snap), (30, stand)], loop=False)
    jab = dict(stand, **{'Arm.R': [('x', 25), ('z', 12)], 'Fore.R': [('x', 15)], 'Jaw.R': [('x', 25)]},
               Body=[('z', -6)])
    author_clip(arm, 'Attack2', [(1, stand), (8, dict(stand, **{'Arm.R': [('x', -40)]})), (13, jab), (24, stand)],
                loop=False)
    author_clip(arm, 'Hit', [(1, stand), (5, dict(stand, Body=[('x', -12)], Shell=[('x', 9), ('y', -6)],
                                                  **{'EyeStalk.L': [('x', 25)]})), (16, stand)], loop=False)
    slump = dict(stand, Root=[('loc', (0, 0, -1.1))], Body=[('x', 10)],
                 **{'Leg1.L': [('y', -35)], 'Leg2.L': [('y', -35)], 'Leg3.L': [('y', -35)],
                    'Arm.L': [('x', 30)], 'EyeStalk.L': [('x', 60)]})
    toppled = dict(slump, Shell=[('x', 68), ('y', 18)])
    author_clip(arm, 'Death', [(1, stand), (10, dict(stand, Body=[('x', -14)], Shell=[('x', -10)],
                                                     **{'Arm.L': [('x', -50)]})),
                               (24, slump), (40, toppled), (48, toppled)], loop=False)
    both = dict(stand, **{'Arm.L': [('x', -55), ('z', 18)], 'Fore.L': [('x', -25)], 'Jaw.L': [('x', 35)],
                          'EyeStalk.L': [('x', -20)]}, Shell=[('y', 6)])
    author_clip(arm, 'Cast', loop(24, [both, dict(both, Shell=[('y', -6)])]))
    # Claw Sweep: the great claw drawn far out to one side, held, then raked
    # across the whole front in the bar's last third.
    drawn = dict(stand, **{'Arm.L': [('z', 55), ('x', -25)], 'Fore.L': [('z', 20)], 'Jaw.L': [('x', 40)]},
                 Body=[('z', 14)], Shell=[('y', 8)])
    drawn_b = dict(drawn, **{'Arm.L': [('z', 60), ('x', -28)]})
    swept = dict(stand, **{'Arm.L': [('z', -65), ('x', -5)], 'Fore.L': [('z', -25)], 'Jaw.L': [('x', 5)]},
                 Body=[('z', -16)], Shell=[('y', -10)])
    author_clip(arm, 'ClawSweep', [(1, stand), (10, drawn), (30, drawn_b), (40, swept), (48, swept)], loop=False)
    # Shell Slam: rearing up on its legs, the tower lifted, then slammed down.
    rear = dict(stand, Root=[('loc', (0, 0, 0.9))], Body=[('x', -20)], Shell=[('x', -22)],
                **{'Leg1.L': [('x', 20)], 'Leg2.L': [('x', 10)], 'Arm.L': [('x', -40)], 'Arm.R': [('x', -40)]})
    slam = dict(stand, Root=[('loc', (0, 0, -0.35))], Body=[('x', 14)], Shell=[('x', 16)],
                **{'Leg1.L': [('y', -15)], 'Leg2.L': [('y', -15)], 'Leg3.L': [('y', -15)]})
    author_clip(arm, 'ShellSlam', [(1, stand), (22, rear), (31, slam), (36, slam)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Attack', 'Attack2', 'Hit', 'Death', 'Cast', 'ClawSweep', 'ShellSlam']


CREATURES = {
    'turretback': (TURRETBACK_BONES, turretback_body, turretback_clips, 4.0, 22.0),
}


def sea_creature(which):
    """The smooth-bodied sea creatures live in their own modules (sea_kit.py)."""
    sys.path.insert(0, HERE)
    import importlib
    module, _, variant = SEA_MODULES[which].partition(':')
    mod = importlib.import_module(module)
    return mod.VARIANTS[variant] if variant else mod.CREATURE


# name -> module: each module exports CREATURE = (bones, body, clips, focus, dist).
SEA_MODULES = {
    'crawler': 'crawler',
    'hound': 'hound',
    'hag': 'hag',
    'drowned_revenant': 'drowned:revenant',
    'drowned_watchman': 'drowned:watchman',
    'drowned_arbalest': 'drowned:arbalest',
    'drowned_sergeant': 'drowned:sergeant',
    'drowned_prisoner': 'drowned:prisoner',
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    which, out = argv[0], argv[1]
    bones, body_fn, clips_fn, focus, dist = CREATURES[which] if which in CREATURES else sea_creature(which)
    mats = new_scene()
    body = body_fn()
    obj, names = finish_body(body, mats)
    arm = build_rig(body.name, bones, obj, names)
    clips = clips_fn(arm)
    export(out, arm)
    if '--preview' in argv:
        preview(arm, clips, argv[argv.index('--preview') + 1], focus, dist)
    if '--blend' in argv:
        import bpy
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
