"""The drowned folk of the temple, on one humanoid rig (the Bastion's drowned
skeleton layout), four bodies of their own:

  templeguard  The Drowned Templeguard: a temple warden drowned at his post,
               in pearl-scaled mail and a finned crest helm, a long trident and
               a great scallop-shell shield, sea light in his helm's slit.
  pilgrim      The Drowned Pilgrim: a bent walker of the Pilgrim Steps in
               sodden rags and a deep hood, prayer beads, a dead lantern on a
               staff, drowned grey hands.
  acolyte      The Pale Choir Acolyte: a chorister in a pale bell robe and cowl,
               a white face with a round singing mouth, a small moon bell.
  selthe       Choirmother Selthe: the choir's mother, tall and terrible, in a
               trailing robe of pale silk, a crown of pearl spires, a veil of
               weed, and the Great Conch's child, a golden conch on her chain.

Each variant has the clips of its own jobs (the Trident Sweep, the pilgrim's
frenzied flail, the Lullaby, the choir mother's Chorus, Solo, Sea-Song and
Tidal Slap).
"""
import math

from sea_kit import GLOW, SeaBody, author_clip, expand_bones, loop, merge, over
from temple_palette import (CORAL, CYAN, DROWNED_SKIN, DROWNED_SKIN_D, EYE_GLOW, GOLD, MOSS, MOSS_D, MOUTH,
                            NACRE, NACRE_PINK, PEARL, PEARL_D, ROBE, ROBE_D, SILVER, TEAL, TEAL_D, TOOTH)

RAG = (0.6, 0.62, 0.56)
RAG_D = (0.44, 0.48, 0.46)
BRONZE = (0.52, 0.5, 0.36)
WOOD = (0.34, 0.3, 0.26)
FACE = (0.9, 0.92, 0.96)

BONES = expand_bones([
    ('Root', None, (0, 0, 0), (0, 0, 0.4)),
    ('Hips', 'Root', (0, 0, 1.05), (0, 0, 1.35)),
    ('Spine', 'Hips', (0, 0, 1.35), (0, 0, 1.75)),
    ('Chest', 'Spine', (0, 0, 1.75), (0, 0, 2.15)),
    ('Head', 'Chest', (0, 0, 2.15), (0, 0, 2.95)),
    ('Jaw', 'Head', (0, -0.18, 2.34), (0, -0.46, 2.26)),
    ('Arm.L', 'Chest', (0.52, 0, 2.02), (0.64, 0, 1.56)),
    ('Fore.L', 'Arm.L', (0.64, 0, 1.56), (0.68, -0.04, 1.12)),
    ('Hand.L', 'Fore.L', (0.68, -0.04, 1.12), (0.68, -0.08, 0.86)),
    ('Thigh.L', 'Hips', (0.22, 0, 1.02), (0.24, 0, 0.58)),
    ('Shin.L', 'Thigh.L', (0.24, 0, 0.58), (0.24, 0.03, 0.16)),
    ('Foot.L', 'Shin.L', (0.24, 0.03, 0.16), (0.24, -0.3, 0.05)),
])


def sides(fn):
    for s, tag in ((1, '.L'), (-1, '.R')):
        fn(s, tag)


def legs(p, cloth, boot, girth=1.0):
    def leg(s, t):
        p.on('Thigh' + t)
        p.tube([(s * 0.22, 0, 1.08), (s * 0.24, 0, 0.58)], [0.2 * girth, 0.16 * girth], cloth, sides=10)
        p.on('Shin' + t)
        p.tube([(s * 0.24, 0, 0.6), (s * 0.24, 0.02, 0.2)], [0.16 * girth, 0.15 * girth], boot, sides=10)
        p.on('Foot' + t)
        p.blob((s * 0.24, -0.1, 0.1), (0.17, 0.3, 0.12), boot, flat_bottom=True)

    sides(leg)


def arms(p, sleeve, hand, girth=1.0, flare=False):
    def arm(s, t):
        p.on('Arm' + t)
        p.blob((s * 0.5, 0, 2.02), (0.2 * girth, 0.2 * girth, 0.18), sleeve)
        p.tube([(s * 0.52, 0, 2.02), (s * 0.64, 0, 1.56)], [0.15 * girth, 0.14 * girth], sleeve, sides=10)
        p.on('Fore' + t)
        if flare:
            # A long trailing sleeve.
            p.tube([(s * 0.64, 0, 1.56), (s * 0.68, -0.04, 1.2), (s * 0.7, 0.05, 0.95)],
                   [0.15, 0.24, 0.3], sleeve, sides=10, cap=False)
        else:
            p.tube([(s * 0.64, 0, 1.56), (s * 0.68, -0.04, 1.16)], [0.13 * girth, 0.12 * girth], sleeve, sides=10)
        p.on('Hand' + t)
        p.blob((s * 0.68, -0.07, 0.98), (0.12, 0.11, 0.13), hand)
        for k in range(3):
            p.tube([(s * (0.62 + k * 0.05), -0.13, 0.94), (s * (0.62 + k * 0.05), -0.17, 0.84)], [0.035, 0.025],
                   hand, sides=5)

    sides(arm)


def robe_bell(p, color, color_d, flare=0.62, hem=0.08):
    """A long bell robe from the waist to the floor (on the hips)."""
    p.on('Hips')
    p.tube([(0, 0.04, 1.35), (0, 0.04, 1.0), (0, 0.06, 0.55), (0, 0.08, hem)], [0.4, 0.46, 0.55, flare], color,
           sides=18, cap=False)
    for k in range(12):
        a = k / 12 * math.tau
        p.tube([(math.cos(a) * 0.44, 0.04 + math.sin(a) * 0.44, 1.1), (math.cos(a) * flare * 0.98,
                                                                     0.08 + math.sin(a) * flare * 0.98, hem + 0.05)],
               [0.05, 0.06], color_d, sides=4, squash=0.5)


# ---- templeguard ------------------------------------------------------------------

def templeguard_body():
    p = SeaBody('DrownedTempleguard', lichen=0.0, weather=0.2)
    legs(p, TEAL_D, PEARL_D, 1.1)
    p.on('Hips')
    p.blob((0, 0, 1.15), (0.44, 0.32, 0.26), TEAL_D)
    # A skirt of pearl scales.
    for k in range(14):
        a = k / 14 * math.tau
        p.blob((math.cos(a) * 0.44, math.sin(a) * 0.34, 0.95), (0.16, 0.06, 0.28), NACRE if k % 2 else PEARL_D,
               yaw=a + math.pi / 2)
    p.on('Spine')
    p.blob((0, 0, 1.52), (0.44, 0.36, 0.32), PEARL_D)
    p.on('Chest')
    p.blob((0, 0, 1.94), (0.56, 0.42, 0.36), PEARL)
    # Scale mail: rows of pearl scales across the chest, a sea-glass boss.
    for row in range(3):
        for k in range(7):
            x = -0.36 + k * 0.12
            p.blob((x, -0.38 + abs(x) * 0.25, 1.78 + row * 0.16), (0.07, 0.04, 0.09), NACRE if (k + row) % 2 else PEARL)
    p.blob((0, -0.44, 2.0), (0.12, 0.05, 0.12), CYAN, mat=GLOW)
    # Shell pauldrons.
    for sx in (-1, 1):
        p.blob((sx * 0.56, 0.02, 2.12), (0.3, 0.3, 0.18), NACRE_PINK, roll=sx * 0.4)
        for k in range(4):
            p.blob((sx * (0.56 + 0.04 * k), 0.02 - 0.12 + k * 0.08, 2.24), (0.05, 0.14, 0.05), NACRE, yaw=0.2 * k)
    arms(p, TEAL_D, DROWNED_SKIN, 1.1)
    p.on('Head')
    # The drowned face under a finned crest helm with a glowing slit.
    p.blob((0, -0.02, 2.5), (0.36, 0.36, 0.38), DROWNED_SKIN)
    p.blob((0, 0.0, 2.62), (0.42, 0.42, 0.34), PEARL, bulge=0.1)
    p.blob((0, -0.38, 2.56), (0.26, 0.04, 0.05), EYE_GLOW, mat=GLOW)
    for k in range(6):
        p.tube([(0, -0.25 + k * 0.12, 2.9), (0, -0.2 + k * 0.14, 3.3 - k * 0.04)], [0.05, 0.02], TEAL, sides=4,
               squash=0.3)
    p.tube([(0, -0.3, 2.95), (0, 0.5, 3.35)], [0.03, 0.03], NACRE, sides=4)
    p.on('Jaw')
    p.blob((0, -0.24, 2.26), (0.22, 0.18, 0.09), DROWNED_SKIN_D)
    # The trident in the right hand and the scallop shield on the left arm.
    # Modelled with its prongs DOWN the hanging arm (-Z) through the fist at
    # z 0.98: the guard stance (the doubled .L/.R arm turns) raises the
    # forearm up and forward, which stands the prongs up and ahead and makes
    # the Attack thrust prongs first. Modelled prongs-up, it held them behind
    # and thrust butt first.
    p.on('Hand.R')
    p.tube([(-0.68, -0.1, 2.16), (-0.68, -0.1, 0.96), (-0.68, -0.1, -1.04)], [0.04, 0.045, 0.04], BRONZE, sides=6)
    for dx in (-0.18, 0.0, 0.18):
        p.tube([(-0.68 + dx, -0.1, -0.99), (-0.68 + dx * 1.2, -0.1, -1.54)], [0.04, 0.005], SILVER, sides=4)
    p.tube([(-0.9, -0.1, -1.04), (-0.46, -0.1, -1.04)], [0.04, 0.04], SILVER, sides=4)
    p.on('Fore.L')
    for k in range(9):
        b = -1.0 + k / 8 * 2.0
        p.box((0.82 + 0.02 * math.cos(b), -0.1 + math.sin(b) * 0.46, 1.35 + math.cos(b) * 0.2), (0.06, 0.2, 0.62),
              NACRE_PINK if k % 2 else NACRE, roll=0.1, yaw=b * 0.3)
    p.blob((0.84, -0.1, 1.2), (0.06, 0.16, 0.16), GOLD)
    return p


def templeguard_clips(arm):
    stand = {'Arm.R': [('x', -24)], 'Fore.R': [('x', -40)], 'Arm.L': [('x', -30), ('y', -10)],
             'Fore.L': [('x', -50)], 'Head': [('x', 4)]}
    names = base_clips(arm, stand, shamble=True)
    back = over(stand, {'Arm.R': [('x', -30)], 'Fore.R': [('x', 20)], 'Chest': [('z', -15)]})
    thrust = over(stand, {'Arm.R': [('x', -70)], 'Fore.R': [('x', 50)], 'Chest': [('z', 12), ('x', 10)],
                          'Thigh.R': [('x', -30)], 'Shin.R': [('x', 25)], 'Hips': [('loc', (0, -0.15, -0.06))]})
    author_clip(arm, 'Attack', [(1, stand), (8, back), (12, thrust), (24, stand)], loop=False)
    bash_back = over(stand, {'Arm.L': [('x', -40), ('y', 30)], 'Chest': [('z', 20)]})
    bash = over(stand, {'Arm.L': [('x', -75), ('y', -15)], 'Fore.L': [('x', -30)], 'Chest': [('z', -18), ('x', 8)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, bash_back), (12, bash), (24, stand)], loop=False)
    # Trident Sweep: the trident lowered level, drawn back to the right, held
    # while the bar runs, then swept in a flat arc across the front.
    drawn = over(stand, {'Arm.R': [('x', -60), ('y', 30)], 'Fore.R': [('x', 20)], 'Chest': [('z', -48)],
                         'Spine': [('z', -20)], 'Hips': [('z', -10)], 'Head': [('z', 30)],
                         'Thigh.L': [('x', -25)], 'Shin.L': [('x', 20)]})
    drawn_b = merge(drawn, {'Chest': [('z', -5)], 'Jaw': [('x', 18)]})
    swept = over(stand, {'Arm.R': [('x', -65), ('y', -25)], 'Fore.R': [('x', 25)], 'Chest': [('z', 58)],
                         'Spine': [('z', 25)], 'Hips': [('z', 12)], 'Head': [('z', -20)],
                         'Thigh.R': [('x', -25)], 'Shin.R': [('x', 20)]})
    author_clip(arm, 'TridentSweep', [(1, stand), (10, drawn), (30, drawn_b), (38, swept), (48, swept)],
                loop=False)
    author_clip(arm, 'Cast', loop(24, [drawn, drawn_b]))
    return names + ['Attack', 'Attack2', 'TridentSweep', 'Cast']


# ---- pilgrim --------------------------------------------------------------------

def pilgrim_body():
    p = SeaBody('DrownedPilgrim', lichen=0.0, weather=0.25)
    legs(p, RAG_D, DROWNED_SKIN_D, 0.85)
    p.on('Hips')
    p.tube([(0, 0.04, 1.3), (0, 0.04, 0.9), (0, 0.06, 0.45)], [0.36, 0.42, 0.48], RAG, sides=14, cap=False)
    for k in range(10):
        a = k / 10 * math.tau
        p.tube([(math.cos(a) * 0.44, 0.04 + math.sin(a) * 0.44, 0.55), (math.cos(a) * 0.5, 0.06 + math.sin(a) * 0.5,
                                                                      0.3 - (k % 3) * 0.08)],
               [0.08, 0.02], RAG_D, sides=4, squash=0.4)
    p.on('Spine')
    p.blob((0, 0.02, 1.52), (0.36, 0.3, 0.3), RAG)
    p.on('Chest')
    p.blob((0, 0.02, 1.92), (0.44, 0.34, 0.32), RAG)
    # Prayer beads of pearl round the neck, a little moon disc on them.
    for k in range(12):
        a = k / 12 * math.pi
        p.blob((math.cos(a) * 0.28, -0.3 + abs(math.cos(a)) * 0.2, 2.1 - math.sin(a) * 0.25), (0.04, 0.04, 0.04),
               NACRE)
    p.blob((0, -0.36, 1.84), (0.08, 0.03, 0.08), SILVER)
    for sx in (-1, 1):
        p.kelp((sx * 0.35, 0.05, 2.12), 0.6, (sx * 0.1, 0.12), 0.06, MOSS if sx > 0 else MOSS_D)
    arms(p, RAG, DROWNED_SKIN_D, 0.85)
    p.on('Head')
    # A deep hood, only the drowned face's slack jaw and two pale lights inside.
    p.blob((0, 0.04, 2.5), (0.42, 0.44, 0.44), RAG_D, bulge=0.2)
    p.cone((0, 0.2, 2.8), (0, 0.55, 3.15), 0.22, RAG_D, sides=6)
    p.blob((0, -0.26, 2.44), (0.26, 0.12, 0.28), (0.04, 0.05, 0.06))
    for sx in (-1, 1):
        p.blob((sx * 0.1, -0.34, 2.5), (0.035, 0.02, 0.035), EYE_GLOW, mat=GLOW)
    p.on('Jaw')
    p.blob((0, -0.28, 2.26), (0.16, 0.12, 0.07), DROWNED_SKIN_D)
    for k in range(3):
        p.cone((-0.05 + k * 0.05, -0.36, 2.28), (-0.05 + k * 0.05, -0.37, 2.33), 0.02, TOOTH, sides=4)
    # The dead lantern on its staff in the left hand.
    p.on('Hand.L')
    p.tube([(0.68, -0.1, -0.1), (0.68, -0.1, 1.2), (0.72, -0.1, 2.9)], [0.035, 0.035, 0.03], WOOD, sides=6)
    p.tube([(0.72, -0.1, 2.9), (0.9, -0.1, 3.05), (1.0, -0.1, 2.9)], [0.03, 0.03, 0.02], WOOD, sides=5)
    p.blob((1.0, -0.1, 2.62), (0.14, 0.14, 0.22), (0.2, 0.22, 0.2))
    p.blob((1.0, -0.1, 2.62), (0.07, 0.07, 0.1), (0.35, 0.6, 0.62), mat=GLOW)
    return p


def pilgrim_clips(arm):
    stand = {'Spine': [('x', 14)], 'Chest': [('x', 10)], 'Head': [('x', 14)], 'Arm.R': [('x', -12)],
             'Arm.L': [('x', -30), ('y', -10)], 'Fore.L': [('x', -40)], 'Jaw': [('x', 12)]}
    names = base_clips(arm, stand, shamble=True)
    wind = over(stand, {'Arm.R': [('x', -40), ('y', -80)], 'Fore.R': [('x', -30)], 'Chest': [('z', 30)]})
    claw = over(stand, {'Arm.R': [('x', -80), ('y', 40)], 'Fore.R': [('x', -10)], 'Chest': [('z', -30)],
                        'Jaw': [('x', 30)]})
    author_clip(arm, 'Attack', [(1, stand), (8, wind), (12, claw), (24, stand)], loop=False)
    swing_b = over(stand, {'Arm.L': [('x', -120), ('y', -30)], 'Chest': [('z', -25)]})
    swing = over(stand, {'Arm.L': [('x', -70), ('y', 20)], 'Chest': [('z', 25)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, swing_b), (13, swing), (24, stand)], loop=False)
    # The frenzy when it is nearly dead: both arms thrashing, head shaking.
    fa = over(stand, {'Arm.R': [('x', -120), ('y', 30)], 'Arm.L': [('x', -60)], 'Head': [('y', 20)],
                      'Jaw': [('x', 40)], 'Chest': [('z', 15)]})
    fb = over(stand, {'Arm.R': [('x', -60), ('y', -30)], 'Arm.L': [('x', -130)], 'Head': [('y', -20)],
                      'Jaw': [('x', 25)], 'Chest': [('z', -15)]})
    author_clip(arm, 'Frenzy', loop(10, [fa, fb]))
    author_clip(arm, 'Cast', loop(24, [stand, merge(stand, {'Head': [('x', 12)], 'Chest': [('x', 8)]})]))
    return names + ['Attack', 'Attack2', 'Frenzy', 'Cast']


# ---- acolyte and Selthe -----------------------------------------------------------

def singer_head(p, hood, face, crown=False):
    p.on('Head')
    p.blob((0, -0.02, 2.52), (0.3, 0.3, 0.34), face)
    for sx in (-1, 1):
        p.blob((sx * 0.1, -0.28, 2.58), (0.06, 0.03, 0.04), (0.06, 0.08, 0.14))
        p.blob((sx * 0.1, -0.3, 2.58), (0.025, 0.015, 0.025), EYE_GLOW, mat=GLOW)
    if hood:
        # The cowl framing the face: open at the front, drawn to a point behind.
        p.blob((0, 0.2, 2.58), (0.4, 0.34, 0.44), hood, bulge=0.2)
        for sx in (-1, 1):
            p.blob((sx * 0.3, -0.08, 2.55), (0.1, 0.28, 0.4), hood)
        p.blob((0, -0.06, 2.9), (0.34, 0.26, 0.1), hood)
        p.cone((0, 0.35, 2.85), (0, 0.65, 3.1), 0.2, hood, sides=6)
    if crown:
        # A crown of pearl spires.
        for k in range(7):
            a = -1.2 + k * 0.4
            h = 0.5 + (0.3 if k == 3 else 0.0) - abs(k - 3) * 0.05
            p.cone((math.sin(a) * 0.3, math.cos(a) * 0.1, 2.8), (math.sin(a) * 0.36, math.cos(a) * 0.1, 2.8 + h),
                   0.05, NACRE, sides=5)
            p.blob((math.sin(a) * 0.36, math.cos(a) * 0.1, 2.82 + h), (0.06, 0.06, 0.06), PEARL, rings=6)
        p.tube([(math.sin(a) * 0.31, math.cos(a) * 0.3, 2.8) for a in [i / 16 * math.tau for i in range(17)]],
               [0.035] * 17, GOLD, sides=5, cap=False)
        # A veil of weed falling behind.
        for k in range(9):
            a = math.pi * 0.2 + k / 8 * math.pi * 0.6
            p.kelp((math.cos(a) * 0.3, 0.1 + math.sin(a) * 0.2, 2.78), 1.6 + 0.2 * (k % 3),
                   (math.cos(a) * 0.2, 0.3), 0.06, MOSS if k % 2 else TEAL_D)
    p.on('Jaw')
    # The round singing mouth.
    p.blob((0, -0.27, 2.34), (0.07, 0.03, 0.08), MOUTH)


def acolyte_body():
    p = SeaBody('PaleChoirAcolyte', lichen=0.0, weather=0.15)
    legs(p, ROBE_D, ROBE_D)
    robe_bell(p, ROBE, ROBE_D)
    p.on('Spine')
    p.blob((0, 0.02, 1.52), (0.34, 0.28, 0.3), ROBE)
    p.on('Chest')
    p.blob((0, 0.02, 1.92), (0.42, 0.32, 0.32), ROBE)
    p.blob((0, -0.3, 1.9), (0.08, 0.04, 0.3), SILVER)
    arms(p, ROBE, FACE, flare=True)
    singer_head(p, ROBE_D, FACE)
    # The moon bell in the right hand.
    p.on('Hand.R')
    p.tube([(-0.68, -0.12, 0.92), (-0.68, -0.12, 0.72)], [0.02, 0.02], SILVER, sides=4)
    p.tube([(-0.68, -0.12, 0.72), (-0.68, -0.12, 0.62), (-0.68, -0.12, 0.45)], [0.05, 0.12, 0.16], SILVER, sides=10)
    p.blob((-0.68, -0.12, 0.44), (0.06, 0.06, 0.06), CYAN, mat=GLOW)
    return p


def selthe_body():
    p = SeaBody('ChoirmotherSelthe', lichen=0.0, weather=0.1)
    legs(p, ROBE_D, ROBE_D)
    robe_bell(p, ROBE, ROBE_D, flare=0.9, hem=0.02)
    # The train sweeping behind.
    p.tube([(0, 0.5, 0.3), (0, 1.2, 0.1), (0, 1.8, 0.04)], [0.5, 0.55, 0.3], ROBE, sides=10, squash=0.2)
    p.on('Spine')
    p.blob((0, 0.02, 1.52), (0.34, 0.28, 0.3), ROBE)
    p.on('Chest')
    p.blob((0, 0.02, 1.92), (0.42, 0.32, 0.32), ROBE)
    # A mantle of shells and pearl strands over her shoulders.
    for k in range(14):
        a = k / 14 * math.pi
        p.blob((math.cos(a) * 0.5, -0.1 + abs(math.cos(a)) * 0.1, 2.1 - math.sin(a) * 0.12), (0.1, 0.1, 0.08),
               NACRE_PINK if k % 2 else NACRE)
    for k in range(3):
        for j in range(9):
            t = j / 8
            p.blob((-0.3 + t * 0.6, -0.31, 1.95 - k * 0.12 - math.sin(t * math.pi) * 0.08), (0.035, 0.035, 0.035),
                   PEARL)
    arms(p, ROBE, FACE, flare=True)
    singer_head(p, None, FACE, crown=True)
    # The golden conch on its chain at her side.
    p.on('Hips')
    p.tube([(0.35, -0.25, 1.3), (0.45, -0.35, 1.0), (0.48, -0.36, 0.85)], [0.015, 0.015, 0.015], GOLD, sides=4)
    p.tube([(0.48, -0.4, 0.4), (0.52, -0.42, 0.62), (0.5, -0.42, 0.85)], [0.02, 0.2, 0.08], GOLD, sides=10)
    p.blob((0.5, -0.5, 0.62), (0.1, 0.05, 0.12), (1.0, 0.8, 0.5), mat=GLOW)
    # A coral sceptre in the left hand.
    p.on('Hand.L')
    p.tube([(0.68, -0.1, 0.2), (0.7, -0.1, 1.4), (0.72, -0.1, 2.5)], [0.035, 0.035, 0.03], CORAL, sides=6)
    p.blob((0.72, -0.1, 2.62), (0.14, 0.14, 0.14), SILVER, mat=GLOW)
    for k in range(4):
        a = k / 4 * math.tau
        p.cone((0.72, -0.1, 2.5), (0.72 + math.cos(a) * 0.2, -0.1 + math.sin(a) * 0.2, 2.8), 0.025, CORAL, sides=4)
    return p


def glide_clips(arm, stand):
    """Idle, Walk, Run, Hit and Death for the robed singers (they glide)."""
    def hum(ph):
        return merge(stand, {'Chest': [('y', 3 * math.sin(ph)), ('x', 2 * math.cos(ph))],
                             'Head': [('z', 6 * math.sin(ph * 0.5)), ('x', -4 + 3 * math.sin(ph))],
                             'Jaw': [('x', 6 + 6 * math.sin(ph * 2))], 'Arm.L': [('y', 4 * math.sin(ph))]})

    author_clip(arm, 'Idle', loop(72, [hum(i / 6 * math.tau) for i in range(6)]))

    def glide(ph, amp=1.0):
        a = math.sin(ph)
        return merge(stand, {'Root': [('loc', (0, 0, 0.04 * abs(math.cos(ph)) * amp))],
                             'Thigh.L': [('x', -20 * a * amp)], 'Thigh.R': [('x', 20 * a * amp)],
                             'Shin.L': [('x', 20 * max(0.0, a) * amp)], 'Shin.R': [('x', 20 * max(0.0, -a) * amp)],
                             'Chest': [('z', 4 * a)], 'Spine': [('x', 4 * amp)]})

    author_clip(arm, 'Walk', loop(32, [glide(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(20, [glide(i / 4 * math.tau, 1.4) for i in range(4)]))
    hit = merge(stand, {'Spine': [('x', -12)], 'Chest': [('x', -8)], 'Head': [('x', -20), ('y', 10)],
                        'Jaw': [('x', 25)]})
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (14, stand)], loop=False)
    kneel = merge(stand, {'Root': [('loc', (0, 0, -0.4))], 'Thigh.L!': [('x', -75)], 'Thigh.R': [('x', -75)],
                          'Shin.L!': [('x', 90)], 'Shin.R': [('x', 90)], 'Spine': [('x', 20)], 'Head': [('x', 30)]})
    flat = merge(stand, {'Root': [('x', 84), ('loc', (0, 1.3, 0.55))], 'Arm.L!': [('x', -150)],
                         'Arm.R': [('x', -150)], 'Head': [('y', 25)]})
    author_clip(arm, 'Death', [(1, stand), (10, kneel), (18, kneel), (30, flat), (40, flat)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Hit', 'Death']


def acolyte_clips(arm):
    stand = {'Arm.R': [('x', -30)], 'Fore.R': [('x', -40)], 'Arm.L': [('x', -20), ('y', -8)],
             'Fore.L': [('x', -30)], 'Head': [('x', -6)]}
    names = glide_clips(arm, stand)
    ring = over(stand, {'Arm.R': [('x', -120), ('y', -20)], 'Fore.R': [('x', -10)], 'Chest': [('z', 12)]})
    strike = over(stand, {'Arm.R': [('x', -50), ('y', 10)], 'Chest': [('z', -12), ('x', 8)]})
    author_clip(arm, 'Attack', [(1, stand), (8, ring), (12, strike), (24, stand)], loop=False)
    push = over(stand, {'Arm.L': [('x', -90)], 'Fore.L': [('x', -5)], 'Chest': [('x', 8)], 'Jaw': [('x', 25)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, push), (18, stand)], loop=False)
    # Pale Hymn: the free hand reaching out, the mouth round in song.
    hymn = over(stand, {'Arm.L': [('x', -85), ('y', -25)], 'Fore.L': [('x', -10)], 'Head': [('x', -14)],
                        'Jaw': [('x', 30)]})
    author_clip(arm, 'Cast', loop(18, [hymn, merge(hymn, {'Chest': [('y', 4)]})]))
    # Lullaby: the arms cradling an unseen child, swaying, the bell rung soft.
    cradle = over(stand, {'Arm.L': [('x', -60), ('z', -40)], 'Fore.L': [('x', -60), ('z', -30)],
                          'Arm.R': [('x', -70), ('z', 30)], 'Fore.R': [('x', -50)], 'Head': [('x', 18), ('y', 12)],
                          'Jaw': [('x', 18)], 'Chest': [('x', 6)]})
    cradle_b = merge(cradle, {'Chest': [('y', 10)], 'Head': [('y', -14)], 'Spine': [('y', 6)]})
    author_clip(arm, 'Lullaby', loop(20, [cradle, cradle_b]))
    return names + ['Attack', 'Attack2', 'Cast', 'Lullaby']


def selthe_clips(arm):
    stand = {'Arm.R': [('x', -18)], 'Fore.R': [('x', -20)], 'Arm.L': [('x', -30), ('y', -10)],
             'Fore.L': [('x', -45)], 'Head': [('x', -8)], 'Chest': [('x', -4)]}
    names = glide_clips(arm, stand)
    rise = over(stand, {'Arm.L': [('x', -150)], 'Fore.L': [('x', -10)], 'Chest': [('x', -12), ('z', -12)]})
    smite = over(stand, {'Arm.L': [('x', -60)], 'Chest': [('x', 12), ('z', 10)]})
    author_clip(arm, 'Attack', [(1, stand), (9, rise), (13, smite), (26, stand)], loop=False)
    # Tidal Slap: a backhand of the free arm across the tank.
    wind = over(stand, {'Arm.R': [('x', -80), ('z', -60)], 'Fore.R': [('x', -40)], 'Chest': [('z', -30)]})
    slap = over(stand, {'Arm.R': [('x', -85), ('z', 70)], 'Fore.R': [('x', -5)], 'Chest': [('z', 35)]})
    author_clip(arm, 'Attack2', [(1, stand), (8, wind), (12, slap), (24, stand)], loop=False)
    author_clip(arm, 'Slap', [(1, stand), (12, wind), (22, wind), (26, slap), (36, stand)], loop=False)
    # Chorus: arms opened wide then drawn in, gathering the choir to one voice.
    wide = over(stand, {'Arm.L': [('y', -80), ('x', -40)], 'Arm.R': [('y', 80), ('x', -40)], 'Head': [('x', -20)],
                        'Jaw': [('x', 30)], 'Chest': [('x', -12)]})
    gather = over(stand, {'Arm.L': [('x', -80), ('z', -35)], 'Arm.R': [('x', -80), ('z', 35)], 'Head': [('x', 5)],
                          'Jaw': [('x', 20)]})
    author_clip(arm, 'Chorus', [(1, stand), (8, wide), (18, gather), (28, stand)], loop=False)
    # Solo: one arm flung out pointing, the voice thrown at one singer.
    point = over(stand, {'Arm.R': [('x', -95), ('y', 10)], 'Fore.R': [('x', 0)], 'Chest': [('z', -20)],
                         'Head': [('z', -15), ('x', -12)], 'Jaw': [('x', 35)]})
    author_clip(arm, 'Solo', [(1, stand), (8, point), (22, point), (30, stand)], loop=False)
    # Sea-Song: the golden conch lifted to her lips, the whole body leaning in.
    blow = over(stand, {'Arm.R': [('x', -110), ('z', 40)], 'Fore.R': [('x', -95), ('z', 20)], 'Head': [('x', -18)],
                        'Chest': [('x', -10)], 'Spine': [('x', -6)]})
    author_clip(arm, 'SeaSong', loop(18, [blow, merge(blow, {'Chest': [('x', -4)], 'Head': [('x', -12)]})]))
    author_clip(arm, 'Cast', loop(18, [wide, merge(wide, {'Jaw': [('x', 40)]})]))
    return names + ['Attack', 'Attack2', 'Slap', 'Chorus', 'Solo', 'SeaSong', 'Cast']


def base_clips(arm, stand, shamble=True):
    """Idle, Walk, Run, Hit and Death for the drowned walkers."""
    sway = merge(stand, {'Spine': [('y', 3)], 'Chest': [('z', 4)], 'Head': [('y', -8), ('z', 6)],
                         'Jaw': [('x', 14)], 'Hips': [('loc', (0, 0, -0.03))]})
    sway_b = merge(stand, {'Spine': [('y', -3)], 'Chest': [('z', -3)], 'Head': [('y', 6), ('x', 6)],
                           'Jaw': [('x', 6)]})
    author_clip(arm, 'Idle', loop(72, [stand, sway, stand, sway_b]))

    def step(ph, amp=1.0, run=False):
        a = math.sin(ph)
        lurch = max(0.0, math.sin(ph)) * (6 if not run else 3)
        return merge(stand, {
            'Hips': [('loc', (0, 0, -0.06 * abs(math.cos(ph)) * amp)), ('y', 4 * a + lurch * 0.5), ('z', -6 * a)],
            'Spine': [('x', 6 + (8 if run else 0)), ('z', 4 * a)], 'Chest': [('z', 5 * a)],
            'Head': [('y', -6 * a), ('x', 6)], 'Jaw': [('x', 10 + 6 * abs(a))],
            'Thigh.L': [('x', -28 * a * amp)], 'Thigh.R': [('x', 28 * a * amp)],
            'Shin.L': [('x', 34 * max(0.0, a) * amp)], 'Shin.R': [('x', 34 * max(0.0, -a) * amp)],
            'Foot.L': [('x', -10 * a)], 'Foot.R': [('x', 10 * a)]})

    author_clip(arm, 'Walk', loop(28, [step(i / 4 * math.tau) for i in range(4)]))
    author_clip(arm, 'Run', loop(18, [step(i / 4 * math.tau, 1.4, True) for i in range(4)]))
    hit = merge(stand, {'Spine': [('x', -12)], 'Chest': [('x', -8)], 'Head': [('x', -20), ('y', 12)],
                        'Jaw': [('x', 25)], 'Arm.L': [('y', -25)], 'Arm.R': [('y', -20)]})
    author_clip(arm, 'Hit', [(1, stand), (4, hit), (14, stand)], loop=False)
    knees = merge(stand, {'Root': [('loc', (0, 0, -0.45))], 'Thigh.L!': [('x', -80)], 'Thigh.R': [('x', -80)],
                          'Shin.L!': [('x', 95)], 'Shin.R': [('x', 95)], 'Spine': [('x', 10)],
                          'Head': [('x', 25)], 'Jaw': [('x', 30)]})
    flat = merge(stand, {'Root': [('x', 84), ('loc', (0, 1.3, 0.55))], 'Thigh.L!': [('x', -10)],
                         'Thigh.R': [('x', 6)], 'Arm.L!': [('x', -150), ('y', -10)], 'Arm.R': [('x', -140)],
                         'Head': [('y', 25)], 'Jaw': [('x', 30)]})
    author_clip(arm, 'Death', [(1, stand), (10, knees), (18, knees), (30, flat), (40, flat)], loop=False)
    return ['Idle', 'Walk', 'Run', 'Hit', 'Death']


VARIANTS = {
    'templeguard': (BONES, templeguard_body, templeguard_clips, 1.8, 8.0),
    'pilgrim': (BONES, pilgrim_body, pilgrim_clips, 1.6, 7.5),
    'acolyte': (BONES, acolyte_body, acolyte_clips, 1.6, 7.5),
    'selthe': (BONES, selthe_body, selthe_clips, 1.8, 8.0),
}
