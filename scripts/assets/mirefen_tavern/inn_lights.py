"""The tavern's lights (build_tavern.py calls build(B, parts)): the iron lanterns hung on wrought
iron arms off the hall's two gable walls, the wagon-wheel chandelier of candles over the room on
its chains from the front purlin, the candle sconces on the walls, and the iron crown of candles
hung high in the tower's hat from its peak. All of it in TavernLights; the warm light they shed is
baked into the vertex colours (build_tavern.bake_warm_light reads the same layout), and the runtime
adds its few point lights at the same places (src/render/mirefen_tavern.ts).

The lanterns, the chandelier and the sconces are real models with their own painted maps (the
props' atlas, inn_props.py), their candles unlit in the paint and a flame stood on every wick
here. The nook's crown keeps tallow candles as inn_furnish.candle turns them (a body a touch
narrower at its top, a run of wax down its side, a teardrop flame on the wick, no dome: no camera
ever looks down on them), stood in iron cups on a hoop of plain bar.

Nothing here comes below the camera's air over the room (y 9 inside |x| 14) or the nook's (the
crown hangs over TAVERN_TOWER_AIR_TOP, render/mirefen_tavern_interior_core.ts): the lanterns hang
a yard off the gable walls with their drops over it and the chandelier's wheel rides a hand over
it. Every chain ends on something solid: an arm, a purlin, the hat's peak.
"""
import math

from mathutils import Vector

import inn_furnish as F
import inn_kit as K
import inn_props as PR
from inn_interior import AIR_TOP, PURLIN_H, under_line
from inn_kit import IRON, METAL, jit
from inn_roof import Roof
from inn_tower import LEAN

# the chandelier's wheel's underside over the camera's air
CHANDELIER_CLEAR = 0.25
# a wall sconce: its height (backplate head to foot), and its wick over the layout's candle
# height (where the old turned candle's dome stood: the bake and the runtime light it there)
SCONCE_H = 1.0
SCONCE_WICK = 0.36
# a gable lantern: its height (its plate's head to its drop), and the middle of its body (its
# amber panes) in its model's own frame, hung at the layout's lantern height; its plate comes up
# under the gable windows' inner sills (inn_hall.py gable_windows: the lowest at 10.8, a hand
# higher inside)
LANTERN_H = 1.6
LANTERN_BODY_Y = -0.142
# the nook's crown: a half yard over the nook's air (TAVERN_TOWER_AIR_TOP, the drum's top less 0.2)
CROWN_OVER = 0.6


def build(B, parts):
    p = parts['TavernLights']
    for k, q in enumerate(B.LAYOUT['lanterns']):
        lantern(p, B, q, seed=900 + k * 7)
    chandelier(p, B, B.LAYOUT['chandelier'], seed=960)
    for k, q in enumerate(B.LAYOUT['sconces']):
        sconce(p, q, seed=980 + k * 5)
    crown(p, B, seed=1010)


def cup(p, at, r, seed, depth=0.07, sides=6, color=IRON, mat=METAL):
    """A candle's iron cup (a chandelier's, a crown's, a sconce's drip pan): a shallow lens, its
    rim at `at`, its foot drawn down to a point under it, its top dished round the candle."""
    F.lathe(p, at, [(r, 0.0)], sides, color, mat, tip0=-depth, tip1=-0.012, phase=jit(0.5, seed, 1))


def lantern(p, B, q, seed):
    """An iron lantern on a link from a scrolled wrought-iron arm off the gable wall beside it
    (the props' model, inn_props.py): the arm's riveted plate on the plaster, the lantern a yard
    out under the arm's scroll, its body at the layout's height, its panes painted amber (a lit
    one lit by the bake and the runtime's light at the layout's point, a yard further in)."""
    x, y, z = q['x'], q['y'], q['z']
    sx = 1.0 if x > 0 else -1.0
    xw = sx * (B.HALL['x1'] - B.HALL['wall'])        # the gable's inner face
    prop = PR.PROPS['wall_lantern']
    scale = LANTERN_H / prop['size'][1]
    PR.hang(p, prop, Vector((xw, y - LANTERN_BODY_Y * scale, z)), (-sx, 0.0), LANTERN_H, 0.0)


def chandelier(p, B, c, seed):
    """The wagon-wheel chandelier (the props' model, inn_props.py): an oak cart wheel shod in
    iron, ten candles in iron cups round its rim and its chains gathered to a ring over the hub,
    hung level over the entry, its tyre round the layout's radius. Its wheel rides a hand over the
    camera's air and its ring comes up under the front purlin (inn_interior.py roof_timbers lays
    that purlin over it), a short link from the ring into the purlin; a flame on every wick. (Too
    tall for the room under the purlin, it is drawn in to fit.)"""
    x, z = c['x'], c['z']
    prop = PR.PROPS['wheel_chandelier']
    foot = AIR_TOP + CHANDELIER_CLEAR
    hook = under_line(Roof(B, {}), x, z, PURLIN_H) - 0.1
    scale = min((2 * c['r'] + 0.2) / prop['size'][0], (hook - foot - 0.04) / prop['size'][1])
    at = PR.stand(p, prop, Vector((x, foot, z)), 0.2, prop['size'][1] * scale)
    ring = foot + prop['size'][1] * scale
    p.beam([(x, ring - 0.03, z), (x, hook, z)], 0.05, 0.05, IRON, METAL, caps=False)
    F.light_wicks(p, 'wheel_chandelier', at, seed + 30)


def sconce(p, q, seed):
    """A candle sconce on a wall (the props' model, inn_props.py): a riveted iron backplate on the
    plaster, its arm curled out under a drip pan and the candle in the pan with its wax run down
    it; its wick at the layout's candle height (SCONCE_WICK over it), a flame on it."""
    x, y, z, nx, nz = q['x'], q['y'], q['z'], q['nx'], q['nz']
    prop = PR.PROPS['wall_sconce']
    wick_y = PR.WICKS['wall_sconce'][2][0][1]
    scale = SCONCE_H / prop['size'][1]
    at = PR.hang(p, prop, Vector((x, y + SCONCE_WICK - wick_y * scale, z)), (nx, nz), SCONCE_H, 0.0)
    F.light_wicks(p, 'wall_sconce', at, seed)


def crown(p, B, seed):
    """The nook's crown: an iron hoop of candles hung high in the tower's hat, iron points
    standing up round it between the candles, over the nook's air, on three chains gathered to a
    boss and one chain from it straight up to an iron boss wedged in the hat's peak (the hat
    leans, inn_tower.py LEAN: the crown hangs plumb under its tip, where the finial comes
    through)."""
    T = B.TOWER
    x, z = T['x'] + LEAN[0], T['z'] + LEAN[1]
    y, r = T['wallTop'] - 0.2 + CROWN_OVER, 1.5
    p.ring((x, y, z), r, 0.12, IRON, segments=10, axis=(0.0, 1.0, 0.0), mat=METAL, depth=0.06)
    n = 6
    for k in range(n):
        a = math.tau * k / n
        cx, cz = x + math.cos(a) * r, z + math.sin(a) * r
        cup(p, (cx, y + 0.07, cz), 0.1, seed + k, depth=0.08)
        F.candle(p, (cx, y + 0.06, cz), 0.28 + jit(0.06, seed, k), 0.06, seed + 20 + k, dome=False, flame_h=0.19)
        # the points standing up round the hoop between the candles
        b = a + math.pi / n
        foot = Vector((x + math.cos(b) * r, y + 0.03, z + math.sin(b) * r))
        head = Vector((x + math.cos(b) * r * 1.03, y + 0.42, z + math.sin(b) * r * 1.03))
        F.lathe(p, foot, [(0.055, 0.0)], 4, IRON, METAL, axis=tuple(head - foot), tip1=(head - foot).length, phase=b,
                soft=False, tag=K.PLAIN_TAG)
    gather = y + 2.4
    for k in range(3):
        a = math.tau * k / 3 + math.pi / 6
        p.beam([(x + math.cos(a) * r, y + 0.05, z + math.sin(a) * r), (x, gather, z)], 0.04, 0.04, IRON, METAL,
               caps=False)
    K.lump(p, (x, gather, z), (0.16, 0.2, 0.16), IRON, METAL, seed=seed + 20, rough=0.15)
    # the boss in the peak: the hat's sarking closes to its tip 0.42 under the peak, and is a
    # fifth of a yard across a yard under that (inn_tower.py _cone)
    boss = T['peak'] - 0.62
    p.beam([(x, gather + 0.08, z), (x, boss, z)], 0.05, 0.05, IRON, METAL, caps=False)
    K.lump(p, (x, boss, z), (0.3, 0.3, 0.3), IRON, METAL, seed=seed + 21, rough=0.1)
