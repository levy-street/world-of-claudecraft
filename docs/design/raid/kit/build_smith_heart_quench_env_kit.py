"""The Quench vein rebuilt in the painted style (docs/design/raid/smith_heart.md, the
Quench vein's painted rebuild): low-poly pieces whose painted textures carry the look,
its element kept (frozen slate, glacier ice, cyan crystal, snow, an aurora night), from
the owner's arena concept (docs/design/raid/kit/quench_env_src/concept/).

  Blender -b --factory-startup --python build_smith_heart_quench_env_kit.py -- \
      --src tmp/quench_env/kit --out tmp/quench_env/smith_heart_quench_env_kit_components.glb

--src holds models/<name>.glb (the Tripo P2 builds from ChatGPT FRONT, LEFT and BACK
sheets) and tex/<name>.png (the ChatGPT paintings and the builds' graded atlases, sized:
scripts/assets/smith_heart_quench_env_kit/prepare_sources.mjs).

Every Env_* node is one piece, on the old Quench kit's frames so the plan keeps every
placement: a rock piece stands with its foot on z 0, its front plane on y 0 facing
Blender -Y (the game's +Z) and its body behind it; a prop stands centred on its foot; an
edge module runs along X with its origin on the lip, the walk toward +Y and the drop
toward -Y; a frozen fall hangs from its head at the origin, down -Z, its back into the
rock. The fight's sword stands as the old sunk blade did: the lake's face on z 0, leaning
BLADE_LEAN toward +X, its point BLADE_TIP under the ice. The pieces are measured in
src/render/smith_heart/quench_env_plan_core.ts and pinned against the shipped GLB. Tex_*
nodes carry the floors', the rock paint's and the sky's paintings.
Deterministic: every draw is the piece's own seeded rng.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import math  # noqa: E402

import bpy  # noqa: E402
from env_kit_blender import EnvKit, bounds  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402


def arg(flag):
    argv = sys.argv[sys.argv.index('--') + 1:]
    return argv[argv.index(flag) + 1]


SRC = os.path.abspath(arg('--src'))
OUT = os.path.abspath(arg('--out'))

# Yards one repeat of a painting covers on the low-poly pieces: the masonry's courses a
# knee-high wall's two, the cliff's ledges a few yards each, the lake's cracks a stride,
# the snow's drifts a body's length.
TILE = {'block': 4.8, 'cliff': 7.0, 'lake': 5.0, 'snow': 3.2, 'throat': 2.0, 'glow': 1.0}

KIT = EnvKit(SRC, 'SmithHeartQuenchEnvKit_ROOT', TILE)

# The old sunk blade's frame (quench_pieces.py): leaning toward +X, the lake's face on
# z 0, its crown about 12.8 over it, its point 3.2 under it (quench_fight_fx_core.ts
# BLADE_TIP: what a risen blade shows).
BLADE_LEAN = 0.17
BLADE_TIP = 3.2
BLADE_LENGTH = 16.0


# ---- the fight's sword ------------------------------------------------------------


def surface_y(bvh, x, z, side):
    """Where a ray from far out on one side (`side` -1 or +1 in y) meets the sword."""
    hit = bvh.ray_cast(Vector((x, side * 20.0, z)), Vector((0.0, -side, 0.0)))
    return hit[0].y if hit[0] is not None else None


def ice_sword():
    """The Smith's great sword of ice (the fight's blade, `Env_IceSword`): the Tripo build
    upright, BLADE_LENGTH long from point to crown, its point BLADE_TIP under the ice,
    leaning BLADE_LEAN toward +X (the old piece's lean, which the fight takes out as the
    blade rises), and the fuller's light (`glow`): a thin strip laid on each broad face
    down the blade's middle, a breath proud of the ice, which the fight lights blade by
    blade."""
    mesh_ob = KIT.import_mesh('ice_sword')
    me = mesh_ob.data
    mn, mx = bounds(me)
    s = BLADE_LENGTH / (mx.z - mn.z)
    me.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)))
    me.transform(Matrix.Translation((0.0, 0.0, -BLADE_TIP)))
    me.update()
    bpy.context.view_layer.update()
    # The fuller's strips, found on the upright sword: down the blade's middle from just
    # above the point to under the guard (the guard: the sword's widest band, its foot
    # where the width falls back to the blade's own).
    bvh = BVHTree.FromObject(mesh_ob, bpy.context.evaluated_depsgraph_get())
    co = [v.co for v in me.vertices]

    def width_at(z):
        band = [c.x for c in co if abs(c.z - z) < 0.25]
        return (max(band) - min(band)) if band else 0.0

    top = BLADE_LENGTH - BLADE_TIP
    zs = [z / 10 for z in range(0, int(top * 10))]
    guard_mid = max(zs, key=width_at)
    blade_w = width_at(guard_mid * 0.45)
    guard = guard_mid
    while guard > 0.5 and width_at(guard) > blade_w * 1.3:
        guard -= 0.1
    z0 = -BLADE_TIP + 1.4
    z1 = guard - 0.35
    strip = KIT.piece('Env_IceSwordGlow', 1)
    steps = 14
    for side in (-1, 1):
        prev = None
        for k in range(steps + 1):
            z = z0 + (z1 - z0) * k / steps
            y = surface_y(bvh, 0.0, z, side)
            if y is None:
                prev = None
                continue
            w = 0.09 + 0.03 * math.sin(k * 1.7)
            y += side * 0.03
            cur = ((-w, y, z), (w, y, z))
            if prev:
                quad = [prev[0], prev[1], cur[1], cur[0]] if side < 0 else [prev[1], prev[0], cur[0], cur[1]]
                strip.add_face('glow', quad, [(0, 0), (1, 0), (1, 1), (0, 1)])
            prev = cur
    lean = Matrix.Rotation(BLADE_LEAN, 4, 'Y')
    me.transform(lean)
    node = KIT.finish_tripo(mesh_ob, 'ice_sword', 'Env_IceSword')
    glow = strip.build()
    for ob in glow.children:
        ob.data.transform(lean)
        ob.parent = node
    bpy.data.objects.remove(glow)
    print(f'SWORD guard at {guard:.2f}, strips {z0:.2f} to {z1:.2f}')
    return node


def ice_collar():
    """The lake heaved up round a sunk sword's foot (`Env_IceCollar`, inside r 2.1): slabs
    of lake ice shoved up and out, snow caught in their lee. The fight draws it at the
    sword's home whatever the sword does."""
    p = KIT.piece('Env_IceCollar', 7201)
    r = p.rng
    a = r.uniform(0, math.tau)
    for j in range(8):
        a += math.tau / 8 * r.uniform(0.75, 1.25)
        rad = r.uniform(1.2, 1.6)
        w, d, t = r.uniform(0.9, 1.5), r.uniform(0.5, 0.85), r.uniform(0.2, 0.32)
        yaw = a + math.pi / 2 + r.uniform(-0.3, 0.3)
        pitch = r.uniform(0.25, 0.75)
        slab(p, 'lake', (math.cos(a) * rad, math.sin(a) * rad, 0.12), (w, d, t), yaw, pitch)
    for j in range(5):
        b = r.uniform(0, math.tau)
        p.box('snow', (math.cos(b) * 1.8, math.sin(b) * 1.8, 0.04), (1.0, 0.55, 0.16), jitter=0.06,
              taper=0.35, rot=b + math.pi / 2)
    return p.build()


def slab(p, mat, c, s, yaw, pitch):
    """A tilted plate: a box pitched up about its long axis, then turned by `yaw`."""
    hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
    m = Matrix.Translation(c) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(pitch, 4, 'X')
    corners = [m @ Vector((sx * hx * (0.85 if sz > 0 else 1.0), sy * hy, sz * hz))
               for sz in (-1, 1) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    off = (p.rng.random(), p.rng.random())
    for idx in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        vs = [tuple(corners[i]) for i in idx]
        p.add_face(mat, vs, p.quad_uv(vs, mat, off))


# ---- the hung falls ------------------------------------------------------------------


FALL_HEIGHT = 27.0
FALL_DEPTH = 5.6
FALL_WIDTH = 9.6


def frozen_fall():
    """A waterfall frozen on the vein's walls (`Env_FrozenFall`, the old Kit_FrozenFall*'s
    frame): its head at the origin with its notch of rock a breath over it, hanging down
    -Z, FALL_HEIGHT long, at most FALL_WIDTH across (the old fall's span on the rock);
    flattened against the rock, FALL_DEPTH deep from its back (y 3, in the rock) to its
    front."""
    mesh_ob = KIT.import_mesh('frozen_fall')
    me = mesh_ob.data
    mn, mx = bounds(me)
    s = FALL_HEIGHT / (mx.z - mn.z)
    squash = min(1.0, FALL_DEPTH / ((mx.y - mn.y) * s))
    narrow = min(1.0, FALL_WIDTH / ((mx.x - mn.x) * s))
    me.transform(
        Matrix.Translation((0.0, 3.0, 1.5))
        @ Matrix.Diagonal((s * narrow, s * squash, s, 1.0))
        @ Matrix.Translation((-(mn.x + mx.x) / 2, -mx.y, -mx.z))
    )
    return KIT.finish_tripo(mesh_ob, 'frozen_fall', 'Env_FrozenFall', far_ratio=0.5)


# ---- the heaped ice ---------------------------------------------------------------------


PLATES_WIDTH = 21.0
PLATES_DEPTH = 12.4


def ice_plates():
    """The old ice heaped against the basin's walls past the shelf's rim (`Env_IcePlates`,
    the old Kit_IceShelf*'s frame): centred on its foot, its face toward -Y (the lake),
    PLATES_WIDTH across and at most PLATES_DEPTH deep (the old heap's box)."""
    mesh_ob = KIT.import_mesh('ice_plates')
    me = mesh_ob.data
    mn, mx = bounds(me)
    s = PLATES_WIDTH / (mx.x - mn.x)
    squash = min(1.0, PLATES_DEPTH / ((mx.y - mn.y) * s))
    me.transform(
        Matrix.Diagonal((s, s * squash, s, 1.0))
        @ Matrix.Translation((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z))
    )
    return KIT.finish_tripo(mesh_ob, 'ice_plates', 'Env_IcePlates')


# ---- the masonry along the lips -----------------------------------------------------


def quench_wall(name, seed, broken=False):
    """A 6 yd module of a Quench walk's low wall over the void (the old kit's frame: the
    walk toward +Y, the drop toward -Y, nothing over the walk past y 0.05): the frozen
    cliff two lifts deep under the walk, one course of frost granite a body's knee high on
    it, its copings pillowed with snow, icicles off the outer face. Broken: a coping lost,
    its chips."""
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
            p.box('block', (x + w / 2, -0.52, 0.74), (w - 0.06, 0.88, 0.24), jitter=0.04, taper=0.1, top='snow')
            # A pillow of snow on the coping.
            p.box('snow', (x + w / 2, -0.52, 0.9), (w - 0.2, 0.7, 0.12), jitter=0.03, taper=0.3)
        x += w
        k += 1
    # Icicles off the outer face, under the copings.
    for j in range(7):
        ix = -half + 0.4 + (2 * half - 0.8) * (j + r.uniform(0.2, 0.8)) / 7
        ln = r.uniform(0.35, 0.8)
        p.box('lake', (ix, -0.98, 0.62 - ln / 2), (0.12, 0.1, ln), jitter=0.01, taper=0.0)
    if broken:
        for _ in range(3):
            s = r.uniform(0.14, 0.26)
            p.box('block', (r.uniform(-0.7, 0.7), r.uniform(-0.85, -0.25), 0.62 + s * 0.2),
                  (s * 1.4, s, s * 0.35), jitter=0.03, rot=r.uniform(0, math.tau), top='snow')
    p.build()


# ---- the shelf's small pieces -----------------------------------------------------------


def steam_vent():
    """A vent in the shelf's rock (`Env_SteamVent`, flat: under a hand, inside r 1.7): a
    ring of wet dark stones round a dark throat."""
    p = KIT.piece('Env_SteamVent', 7301)
    r = p.rng
    for j in range(9):
        a = math.tau * j / 9 + r.uniform(-0.12, 0.12)
        rad = r.uniform(1.05, 1.3)
        p.box('cliff', (math.cos(a) * rad, math.sin(a) * rad, 0.05), (r.uniform(0.55, 0.8), 0.42, 0.12),
              jitter=0.04, taper=0.25, rot=a + math.pi / 2)
    ring = 10
    for j in range(ring):
        a0 = math.tau * j / ring
        a1 = math.tau * (j + 1) / ring
        rr = 0.95
        p.add_face('throat', [(0, 0, 0.012), (math.cos(a0) * rr, math.sin(a0) * rr, 0.012),
                              (math.cos(a1) * rr, math.sin(a1) * rr, 0.012)],
                   [(0.5, 0.5), (0.5 + math.cos(a0) * 0.5, 0.5 + math.sin(a0) * 0.5),
                    (0.5 + math.cos(a1) * 0.5, 0.5 + math.sin(a1) * 0.5)])
    p.build()


# ---- the whole kit ----------------------------------------------------------------


def main():
    KIT.reset()
    ice_sword()
    ice_collar()
    KIT.import_tripo('glacier_tall', 'Env_GlacierTall', width=40, far_ratio=0.45)
    KIT.import_tripo('glacier_wide', 'Env_GlacierWide', width=64, far_ratio=0.45)
    KIT.import_tripo('ice_spires', 'Env_IceSpires', width=30, far_ratio=0.5)
    # The Singing Ice's crystal: the same spires centred on a prop's foot, as tall as the
    # old cluster (the same painting, so no new texture).
    KIT.import_tripo('ice_spires', 'Env_IceCluster', height=4.0, centred=True)
    frozen_fall()
    ice_plates()
    KIT.import_tripo('fire_bowl', 'Env_FireBowl', height=2.32, centred=True)
    KIT.import_tripo('chevron_stone', 'Env_ChevronStone', height=5.8, centred=True)
    quench_wall('Env_QuenchWallA', 21)
    quench_wall('Env_QuenchWallB', 22, broken=True)
    steam_vent()
    for name in ('lake', 'lake_n', 'rime', 'rime_n', 'cliff', 'block', 'snow', 'sky'):
        KIT.tex_quad(f"Tex_{''.join(w.capitalize() for w in name.split('_'))}", name)
    KIT.export(OUT)


main()
