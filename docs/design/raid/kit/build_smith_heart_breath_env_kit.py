"""The Breath vein rebuilt in the painted style (docs/design/raid/smith_heart.md, the
Breath vein's painted rebuild): low-poly pieces whose painted textures carry the look,
its element kept (storm granite, sky-blue crystal, pale lichen, a storm sky).

  Blender -b --factory-startup --python build_smith_heart_breath_env_kit.py -- \
      --src tmp/breath_env/kit --out tmp/breath_env/smith_heart_breath_env_kit_components.glb

--src holds models/<name>.glb (the Tripo P2 builds from ChatGPT FRONT, LEFT and BACK
sheets) and tex/<name>.png (the ChatGPT paintings and the builds' graded atlases, sized:
scripts/assets/smith_heart_breath_env_kit/prepare_sources.mjs).

Every Env_* node is one piece. A rock piece stands with its foot on z 0, its front plane
on y 0 facing Blender -Y (the game's +Z) and its body behind it; the standing stone
stands centred on its foot; an edge module runs along X with its origin on the lip, the
walk toward +Y and the drop toward -Y (the old Breath kit's frames, so the plan keeps
every placement). The pieces are measured by BREATH_ENV_ROCK and BREATH_ENV_STONE_H
(src/render/smith_heart/breath_env_plan_core.ts) and pinned against the shipped GLB.
Tex_* nodes carry the floor's, the rock paint's and the sky's paintings.
Deterministic: every draw is the piece's own seeded rng.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import math  # noqa: E402

from env_kit_blender import EnvKit  # noqa: E402


def arg(flag):
    argv = sys.argv[sys.argv.index('--') + 1:]
    return argv[argv.index(flag) + 1]


SRC = os.path.abspath(arg('--src'))
OUT = os.path.abspath(arg('--out'))

# Yards one repeat of a painting covers on the low-poly masonry: the masonry's eight
# courses a knee-high wall's two, the cliff's ledges a few yards each, the slabs a stride.
TILE = {'block': 4.8, 'cliff': 7.0, 'slab': 6.0}

KIT = EnvKit(SRC, 'SmithHeartBreathEnvKit_ROOT', TILE)


def Piece(name, seed):
    return KIT.piece(name, seed)


# ---- the masonry along the lips -----------------------------------------------------


def breath_wall(name, seed, broken=False):
    """A 6 yd module of a Breath walk's low wall over the void (the old kit's frame: the
    walk toward +Y, the drop toward -Y, nothing over the walk past y 0.05): the cliff
    two lifts deep under the walk, one course of dry-laid storm granite a body's knee
    high on it, rounded copings scoured pale. Broken: a coping blown off, its chips."""
    p = Piece(name, seed)
    r = p.rng
    half = 3.0
    # The cliff's face under the walk, two lifts, each a little further out.
    z = -0.05
    for h, out in ((1.5, 0.0), (1.8, 0.12)):
        x = -half
        while x < half - 1e-6:
            w = min(half - x, r.uniform(1.6, 2.8))
            p.box('cliff', (x + w / 2, -0.52 - out, z - h / 2), (w - 0.05, 0.86, h - 0.05), jitter=0.08)
            x += w
        z -= h
    # The wall: one course of long rough blocks.
    x = -half
    while x < half - 1e-6:
        w = min(half - x, r.uniform(1.3, 2.3))
        p.box('block', (x + w / 2, -0.52, 0.31), (w - 0.05, 0.8, 0.62), jitter=0.05, rot=r.uniform(-0.03, 0.03))
        x += w
    # The copings: rounded slabs a little proud of the wall, their tops scoured pale.
    x = -half
    k = 0
    while x < half - 1e-6:
        w = min(half - x, r.uniform(0.95, 1.7))
        if not (broken and k == 2):
            p.box('block', (x + w / 2, -0.52, 0.77), (w - 0.06, 0.88, 0.3), jitter=0.04, taper=0.12, top='slab')
        x += w
        k += 1
    if broken:
        for _ in range(3):
            s = r.uniform(0.14, 0.26)
            p.box('block', (r.uniform(-0.7, 0.7), r.uniform(-0.85, -0.25), 0.62 + s * 0.2),
                  (s * 1.4, s, s * 0.35), jitter=0.03, rot=r.uniform(0, math.tau), top='slab')
    p.build()


def wind_shelter():
    """A windbreak on the bridge (the old kit's frame: inside x 2.4, y 0.7, z 2.1, its
    windward face toward -Y): a footing course and a thick slab of storm granite leaning
    a breath into the wind, its top rounded by it."""
    p = Piece('Env_WindShelter', 71)
    p.box('block', (-1.2, 0.0, 0.21), (2.3, 1.3, 0.42), jitter=0.04)
    p.box('block', (1.22, 0.02, 0.2), (2.3, 1.26, 0.4), jitter=0.04)
    p.box('block', (0.0, 0.05, 1.05), (4.5, 1.05, 1.3), jitter=0.06, taper=0.06)
    p.box('block', (0.05, 0.06, 1.86), (3.9, 0.9, 0.36), jitter=0.05, taper=0.18, top='slab')
    p.build()


# ---- the whole kit ----------------------------------------------------------------


def main():
    KIT.reset()
    KIT.import_tripo('storm_spire', 'Env_StormSpire', width=40, far_ratio=0.45)
    KIT.import_tripo('storm_bluff', 'Env_StormBluff', width=64, far_ratio=0.45)
    KIT.import_tripo('storm_arch', 'Env_StormArch', width=48, far_ratio=0.5)
    KIT.import_tripo('storm_stone', 'Env_StormStone', height=8, centred=True)
    breath_wall('Env_BreathWallA', 11)
    breath_wall('Env_BreathWallB', 12, broken=True)
    wind_shelter()
    for name in ('slab', 'slab_n', 'cliff', 'block', 'sky'):
        KIT.tex_quad(f"Tex_{''.join(w.capitalize() for w in name.split('_'))}", name)
    KIT.export(OUT)


main()
