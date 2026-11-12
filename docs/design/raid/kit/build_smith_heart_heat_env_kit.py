"""The Heat vein (the Hearth) rebuilt in the painted style (docs/design/raid/smith_heart.md,
the Heat vein's painted rebuild): low-poly pieces whose painted textures carry the look,
its element kept (sooted columnar basalt, the first flame's white-gold crystal, molten rock
as an accent only), from the owner's arena concept (docs/design/raid/kit/heat_env_src/
concept/).

  Blender -b --factory-startup --python build_smith_heart_heat_env_kit.py -- \
      --src tmp/heat_env/kit --out tmp/heat_env/smith_heart_heat_env_kit_components.glb

--src holds models/<name>.glb (the Tripo P2 builds from ChatGPT FRONT, LEFT and BACK
sheets) and tex/<name>.png (the ChatGPT paintings and the builds' graded atlases, sized:
scripts/assets/smith_heart_heat_env_kit/prepare_sources.mjs).

Every Env_* node is one piece, on the old Heat kit's frames so the plan keeps every
placement: a rock piece stands with its foot on z 0, its front plane on y 0 facing Blender
-Y (the game's +Z) and its body behind it; a prop stands centred on its foot; the altar-stone
and the ember boulder lie with their length along Y, as the old pieces did; an edge module
runs along X with its origin on the lip, the walk toward +Y and the drop toward -Y. The
pieces are measured in src/render/smith_heart/heat_env_plan_core.ts and pinned against the
shipped GLB. Tex_* nodes carry the floor's, the rock paint's and the sky's paintings.
Deterministic: every draw is the piece's own seeded rng.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import math  # noqa: E402

import bpy  # noqa: E402
from env_kit_blender import EnvKit, bounds  # noqa: E402
from mathutils import Matrix  # noqa: E402


def arg(flag):
    argv = sys.argv[sys.argv.index('--') + 1:]
    return argv[argv.index(flag) + 1]


SRC = os.path.abspath(arg('--src'))
OUT = os.path.abspath(arg('--out'))

# Yards one repeat of a painting covers on the low-poly pieces: the masonry's stumps a
# knee-high wall's two courses, the cliff's columns a few yards each.
TILE = {'block': 4.8, 'cliff': 7.0, 'floor': 6.0}

KIT = EnvKit(SRC, 'SmithHeartHeatEnvKit_ROOT', TILE)


def lying(name, target, length, height_max, width_max):
    """A Tripo build laid with its length along Y (the old altar-stone's and ember
    boulder's frame: their long axis the game's Z), centred on its foot, `length` yards
    long, at most `height_max` tall and `width_max` across (squashed in if the build
    stands taller or wider: the old piece's collider is the box it must stay inside)."""
    mesh_ob = KIT.import_mesh(name)
    me = mesh_ob.data
    # The build's length runs along X once its front faces -Y: turn it a quarter so the
    # length runs along Y.
    me.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
    mn, mx = bounds(me)
    s = length / (mx.y - mn.y)
    squash = min(1.0, height_max / ((mx.z - mn.z) * s))
    narrow = min(1.0, width_max / ((mx.x - mn.x) * s))
    me.transform(
        Matrix.Diagonal((s * narrow, s, s * squash, 1.0))
        @ Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    )
    return KIT.finish_tripo(mesh_ob, name, target)


def standing(name, target, height, reach_max):
    """A Tripo build stood centred on its foot, `height` yards tall, drawn in across so
    no point of it stands past `reach_max` from its axis (the old piece's own reach: a
    placement turns it any way, so the round reach is the box it must stay inside)."""
    mesh_ob = KIT.import_mesh(name)
    me = mesh_ob.data
    mn, mx = bounds(me)
    s = height / (mx.z - mn.z)
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    reach = max(math.hypot(v.co.x - cx, v.co.y - cy) for v in me.vertices) * s
    narrow = min(1.0, reach_max / reach)
    me.transform(
        Matrix.Diagonal((s * narrow, s * narrow, s, 1.0))
        @ Matrix.Translation((-cx, -cy, -mn.z))
    )
    return KIT.finish_tripo(mesh_ob, name, target)


# ---- the Hearth's mouth -------------------------------------------------------------

# The old Kit_HearthMouth's frame (heat_pieces.py): about 74 yards across, its jambs a
# few yards proud of the wall's plane toward the hall, its throat's floor on the hall's.
MOUTH_WIDTH = 74.0
MOUTH_PROUD = 6.6
MOUTH_SINK = 2.0
# The old mouth's mass ran 33 yards under the floor (it stands past the floor's lip over
# the mountain's fall): the build ends at its throat's floor, so a basalt foot carries it
# down, MOUTH_FOOT_DEEP yards, as wide as the mouth and no deeper than it.
MOUTH_FOOT = -33.0


def hearth_mouth():
    """The Hearth's mouth (`Env_HearthMouth`): the fan of basalt columns round its pointed
    arch, its throat crowded with the first flame's crystal; MOUTH_WIDTH across, its front
    MOUTH_PROUD yards toward the hall from the old piece's plane, sunk MOUTH_SINK so its
    throat's stumps meet the floor; on a foot of the basalt bluff down to MOUTH_FOOT."""
    mesh_ob = KIT.import_mesh('hearth_mouth')
    me = mesh_ob.data
    mn, mx = bounds(me)
    s = MOUTH_WIDTH / (mx.x - mn.x)
    depth = (mx.y - mn.y) * s
    me.transform(
        Matrix.Translation((0.0, -MOUTH_PROUD, -MOUTH_SINK))
        @ Matrix.Scale(s, 4)
        @ Matrix.Translation((-(mn.x + mx.x) / 2, -mn.y, -mn.z))
    )
    node = KIT.finish_tripo(mesh_ob, 'hearth_mouth', 'Env_HearthMouth', far_ratio=0.5)
    # The foot: the bluff's build, as wide and as deep as the mouth, its top a breath under
    # the throat's floor, down to MOUTH_FOOT.
    foot_ob = KIT.import_mesh('basalt_wide')
    fm = foot_ob.data
    fmn, fmx = bounds(fm)
    top = -MOUTH_SINK + 0.5
    fm.transform(
        Matrix.Translation((0.0, -MOUTH_PROUD + 0.6, MOUTH_FOOT))
        @ Matrix.Diagonal((
            MOUTH_WIDTH / (fmx.x - fmn.x),
            (depth - 0.6) / (fmx.y - fmn.y),
            (top - MOUTH_FOOT) / (fmx.z - fmn.z),
            1.0,
        ))
        @ Matrix.Translation((-(fmn.x + fmx.x) / 2, -fmn.y, -fmn.z))
    )
    foot = KIT.finish_tripo(foot_ob, 'basalt_wide', 'Env_HearthMouthFoot')
    for ob in list(foot.children):
        ob.parent = node
    bpy.data.objects.remove(foot)
    return node


# ---- the hall's column bundles ------------------------------------------------------

# The old Kit_HearthPillar's frame: a bundle rising out of the chasm, 40 under the floor to
# about 14.6 over it, never reaching past HEAT_PILLAR.r (3.5) round its axis. The build is a
# squat bundle (about twice as tall as wide): drawn PILLAR_REACH round its axis, its upper
# PILLAR_KEEP share keeps its own proportions (the stepped heads and the crystal on its
# side) with its crown at PILLAR_TOP, and its lower share is drawn out into the shaft down
# to PILLAR_FOOT (basalt columns are long prisms: the stretch reads as longer columns).
PILLAR_REACH = 3.4
PILLAR_TOP = 14.6
PILLAR_FOOT = -40.0
PILLAR_KEEP = 0.55


def column_bundle():
    """A bundle of basalt columns (`Env_ColumnBundle`, the old Kit_HearthPillar's frame):
    centred on its axis, within PILLAR_REACH of it, from PILLAR_FOOT to PILLAR_TOP."""
    mesh_ob = KIT.import_mesh('column_bundle')
    me = mesh_ob.data
    mn, mx = bounds(me)
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    reach = max(math.hypot(v.co.x - cx, v.co.y - cy) for v in me.vertices)
    s = PILLAR_REACH / reach
    height = (mx.z - mn.z) * s
    split = height * (1.0 - PILLAR_KEEP)
    top_from = PILLAR_TOP - (height - split)
    for v in me.vertices:
        x = (v.co.x - cx) * s
        y = (v.co.y - cy) * s
        z = (v.co.z - mn.z) * s
        if z >= split:
            z = top_from + (z - split)
        else:
            z = PILLAR_FOOT + (z / split) * (top_from - PILLAR_FOOT)
        v.co = (x, y, z)
    me.update()
    return KIT.finish_tripo(mesh_ob, 'column_bundle', 'Env_ColumnBundle', far_ratio=0.5)


# ---- the masonry along the lips -----------------------------------------------------


def heat_wall(name, seed, broken=False):
    """A 6 yd module of a Heat walk's low wall over the chasm (the old kit's frame: the
    walk toward +Y, the drop toward -Y, nothing over the walk past y 0.05): the basalt cliff
    two lifts deep under the walk, one course of stacked column stumps a knee high on it,
    a coping of stumps on top. Broken: a coping lost, its chips."""
    p = KIT.piece(name, seed)
    r = p.rng
    half = 3.0
    z = -0.05
    for h, out in ((1.5, 0.0), (1.8, 0.12)):
        x = -half
        while x < half - 1e-6:
            w = min(half - x, r.uniform(1.6, 2.8))
            p.box('cliff', (x + w / 2, -0.52 - out, z - h / 2), (w - 0.05, 0.86, h - 0.05), jitter=0.08)
            x += w
        z -= h
    x = -half
    while x < half - 1e-6:
        w = min(half - x, r.uniform(1.3, 2.3))
        p.box('block', (x + w / 2, -0.52, 0.31), (w - 0.05, 0.8, 0.62), jitter=0.05, rot=r.uniform(-0.03, 0.03))
        x += w
    x = -half
    k = 0
    while x < half - 1e-6:
        w = min(half - x, r.uniform(0.95, 1.7))
        if not (broken and k == 2):
            p.box('block', (x + w / 2, -0.52, 0.74), (w - 0.06, 0.88, 0.24), jitter=0.04, taper=0.1)
        x += w
        k += 1
    if broken:
        for _ in range(3):
            s = r.uniform(0.14, 0.26)
            p.box('block', (r.uniform(-0.7, 0.7), r.uniform(-0.85, -0.25), 0.62 + s * 0.2),
                  (s * 1.4, s, s * 0.35), jitter=0.03, rot=r.uniform(0, math.tau))
    p.build()


# ---- the whole kit ----------------------------------------------------------------


def main():
    KIT.reset()
    hearth_mouth()
    # The altar-stone on the old giant anvil's footprint (18 long, 7.2 across, 9 tall).
    lying('altar_stone', 'Env_AltarStone', 18.0, 10.0, 7.1)
    # The ember boulders on the old bellows' footprint (about 14 long, 9 across, 6 tall).
    lying('ember_boulder', 'Env_EmberBoulder', 13.8, 6.2, 8.8)
    # The first flame's crystal, as tall as the old Kit_FireCrystalA and inside its round
    # reach (2.9, the old kit's pin; the B's spot scales it).
    standing('fire_crystal', 'Env_FireCrystal', 6.8, 2.85)
    column_bundle()
    KIT.import_tripo('basalt_tall', 'Env_BasaltTall', width=40, far_ratio=0.45)
    KIT.import_tripo('basalt_wide', 'Env_BasaltWide', width=64, far_ratio=0.45)
    # The dressed concept's seamed basalt: the same bands, thin deep-orange seams down the
    # joints of their fronts.
    KIT.import_tripo('seam_tall', 'Env_SeamTall', width=36, far_ratio=0.45)
    KIT.import_tripo('seam_wide', 'Env_SeamWide', width=64, far_ratio=0.45)
    # The concept's own backdrop: the great fall cliff, the tiered cliff wall with its thin
    # falls, the molten shore at the cliffs' feet.
    KIT.import_tripo('great_fall', 'Env_GreatFall', height=100, far_ratio=0.45)
    KIT.import_tripo('cliff_wall', 'Env_CliffWall', width=120, far_ratio=0.45)
    KIT.import_tripo('molten_shore', 'Env_MoltenShore', width=60, far_ratio=0.5)
    KIT.import_tripo('molten_fall', 'Env_MoltenFall', height=60, far_ratio=0.5)
    heat_wall('Env_HeatWallA', 31)
    heat_wall('Env_HeatWallB', 32, broken=True)
    for name in ('floor', 'floor_n', 'cliff', 'block', 'sky'):
        KIT.tex_quad(f"Tex_{''.join(w.capitalize() for w in name.split('_'))}", name)
    KIT.export(OUT)


main()
