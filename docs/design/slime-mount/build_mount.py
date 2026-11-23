"""Paint, rig and animate the slime mount, then export a GLB.

blender --background --python build_mount.py -- <slime_static.glb> <out.glb>

Idle, Walk, Run, Jump, Land at 30 fps, plus the ambient Bubbles loop, and a
`saddle` bone the rider sits on. The slime sits on the ground in
its idle (the sprite hovers) and hops to move, and everything jiggles.

Rig: root -> move (translation, yaw) -> squash (scale, pivot on the ground so
the slime stays planted) -> base -> mid -> top, a three-bone jelly spine. The
body and the lower tack blend along the spine by height, so leaning the spine
bones by different amounts bends the jelly and lets the top lag behind or
overshoot the bottom. move -> saddle carries the seat, cap and pommel rigidly:
every frame it is placed where the spine carries the top of the body, turned
with it but never squashed, so the saddle keeps its shape and the rider rides
the wobble (MountSeatSpec bone `saddle`). Bone space for every bone: X right,
Y up, Z toward the viewer (the mount's front, Blender -Y).

The body texture is painted here: a sky-blue jelly gradient with an aqua glow
at its base and soft highlights, equirect over the body
(u = (phi + pi) / 2pi with phi = 0 at the front, v = 1 - theta / 180). The
jelly is translucent (alpha blended, single-sided); the tack is double-sided so
its underside shows through the jelly instead of vanishing.

Bubbles: NB little spheres inside the jelly, one bone each (`bubble_00`...,
children of `base`, so they squash and lean with the body). They have a clip
of their own, `Bubbles`, which the game loops for the mount's whole life beside
whichever body clip is playing (VisualDef.ambientClips), so they never jump
when the body changes clips. The body clips carry no bubble keys and Bubbles
carries nothing else. Each bubble rises along a seeded random, wobbling path,
swells in, and pops near the end of it. The bubbles are spread out: each keeps
to its own slice of the body around the vertical axis, rides out toward the
skin rather than the middle, and is staggered in time so they never bunch at
one height. Each path repeats on a period that divides the clip length, so the
loop stays seamless; a popped bubble jumps back to its start at scale zero.
"""
import math
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

src_glb, out_glb = sys.argv[sys.argv.index("--") + 1 :]
FPS = 30
JELLY_ALPHA = 0.7
NB = 7  # bubbles


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


# --- scene: the static mount -------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=src_glb)
body = next(o for o in sc.objects if o.type == "MESH")
body.name = "slime"
body.data.transform(body.matrix_world)
body.matrix_world = Matrix.Identity(4)
mesh = body.data
mesh.name = "slime"
for im in bpy.data.images:  # the Tripo maps, named for what they are
    for kind in ("Color", "ORM", "NormalGL"):
        if im.name.startswith(kind + "_"):
            im.name = "SlimeTack" + kind
slime_index = next(i for i, m in enumerate(mesh.materials) if m.name == "slime")
jelly_z = [mesh.vertices[v].co.z for p in mesh.polygons if p.material_index == slime_index for v in p.vertices]
H = max(jelly_z)  # top of the jelly, under the seat
print("BODY top", round(H, 3))

# --- body texture ------------------------------------------------------------------
TW, TH = 1024, 512
STOPS = [  # (theta from the top, sRGB)
    (0, (0.46, 0.78, 1.0)),
    (55, (0.22, 0.60, 0.99)),
    (105, (0.10, 0.44, 0.95)),
    (150, (0.14, 0.60, 1.0)),
    (180, (0.50, 0.96, 1.0)),
]

th = np.radians(180 * (1 - (np.arange(TH) + 0.5) / TH))[:, None] * np.ones((1, TW))
ph = (-np.pi + 2 * np.pi * (np.arange(TW) + 0.5) / TW)[None, :] * np.ones((TH, 1))
deg = np.degrees(th)
col = np.zeros((TH, TW, 3))
for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
    t = np.clip((deg - a) / (b - a), 0, 1)
    t = t * t * (3 - 2 * t)
    seg = (deg >= a) & (deg <= b)
    for k in range(3):
        col[..., k] = np.where(seg, ca[k] + (cb[k] - ca[k]) * t, col[..., k])
D = np.stack([np.sin(th) * np.sin(ph), -np.sin(th) * np.cos(ph), np.cos(th)], -1)
# Watery mottling: a few slow waves across the direction sphere.
mott = (np.sin(5.1 * D[..., 0] + 2.3 * D[..., 2]) * np.sin(4.3 * D[..., 1] - 3.1 * D[..., 2] + 0.7)
        + 0.6 * np.sin(9.7 * D[..., 2] + 3.3 * D[..., 0]) * np.sin(7.9 * D[..., 1]))
col *= 1 + 0.05 * mott[..., None]
# Soft gloss: a lighter crown and two long highlights high on the flanks.
col += (0.10 * np.exp(-((deg - 28) / 16) ** 2))[..., None]
for hp in (1.25, -1.25):
    dph = np.angle(np.exp(1j * (ph - hp)))
    col += (0.16 * np.exp(-((deg - 62) / 9) ** 2 - (dph / 0.22) ** 2))[..., None]
col = np.clip(col, 0, 1)
px = np.concatenate([col, np.ones((TH, TW, 1))], -1).reshape(-1)  # row 0 is v = 0, the bottom
img = bpy.data.images.new("SlimeColor", TW, TH)
img.pixels[:] = px.astype(np.float32)
img.pack()
mat = mesh.materials[slime_index]
nt = mat.node_tree
tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
tex.image = img
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Roughness"].default_value = 0.25
nt.links.new(tex.outputs[0], bsdf.inputs["Emission Color"])  # jelly glows a little in shade
bsdf.inputs["Emission Strength"].default_value = 0.2
bsdf.inputs["Alpha"].default_value = JELLY_ALPHA
mat.use_backface_culling = True  # single-sided: only the near wall of the jelly draws
if hasattr(mat, "surface_render_method"):
    mat.surface_render_method = "BLENDED"
for tack_mat in mesh.materials:
    if tack_mat is not mat:
        tack_mat.use_backface_culling = False  # double-sided, seen from under the jelly

# --- bubble paths -------------------------------------------------------------------
jelly_faces = [p for p in mesh.polygons if p.material_index == slime_index]
jelly_bvh = BVHTree.FromPolygons([v.co for v in mesh.vertices], [tuple(p.vertices) for p in jelly_faces])


def inside(h, psi, rho):
    """A point inside the jelly: at height h (share of H), azimuth psi, rho of
    the way out from the axis to the skin."""
    z = h * H
    d = Vector((math.cos(psi), math.sin(psi), 0.0))
    hit, *_ = jelly_bvh.ray_cast(Vector((0.0, 0.0, z)), d)
    reach = (hit.xy.length if hit is not None else 1.0)
    return Vector((0.0, 0.0, z)) + d * reach * rho


rng = random.Random(11)
BUBBLE_R = [rng.uniform(0.12, 0.3) for _ in range(NB)]


def bubble_path(i, clip_len, kind):
    """Bubble i's loop in a clip: start and end points, period, phase, wobble.
    Bubble i keeps to its own slice of azimuth and its own share of the phase,
    so the few bubbles there are stay apart in space and in time."""
    slot = (i + rng.uniform(0.2, 0.8)) / NB
    if kind == "idle":  # slow, the whole height of the body
        period = clip_len / rng.choice((1, 2))
        h0, h1 = rng.uniform(0.08, 0.25), rng.uniform(0.65, 0.86)
    else:  # moving: short trips, swept back as the slime pushes forward
        period = clip_len
        h0 = 0.1 + 0.4 * slot
        h1 = h0 + rng.uniform(0.2, 0.3)
    psi = 2 * math.pi * slot
    a = inside(h0, psi, rng.uniform(0.35, 0.75))
    b = inside(h1, psi + rng.uniform(-0.35, 0.35), rng.uniform(0.3, 0.6))
    if kind != "idle":
        b += Vector((0.0, rng.uniform(0.15, 0.35), 0.0))  # +Y is the back
    phase = (rng.choice((1, 3, 5)) * i / NB + rng.uniform(0, 0.4 / NB)) % 1.0  # interleaved
    return dict(a=a, b=b, period=period, phase=phase, amp=rng.uniform(0.06, 0.14),
                waves=rng.choice((1, 2)), turn=rng.uniform(0, 2 * math.pi))


def bubble_at(path, t):
    """Position and scale of a bubble at clip time t."""
    u = (t / path["period"] + path["phase"]) % 1.0
    rise = u * (0.6 + 0.4 * u)  # it speeds up as it rises
    w = 2 * math.pi * path["waves"] * u + path["turn"]
    pos = path["a"].lerp(path["b"], rise) + Vector((math.sin(w), math.cos(w), 0.0)) * path["amp"]
    if u >= 0.95:  # popped
        size = 0.0
    else:
        size = smooth(u / 0.12) * (0.75 + 0.35 * u) * (1 + 0.25 * smooth((u - 0.86) / 0.09))
    return pos, max(size, 1e-4)


PATH_KIND = {"Idle": "idle", "Walk": "move", "Run": "move", "Jump": "move", "Land": "move"}
PATH_LEN = {"Idle": 6.0, "Walk": 1.0, "Run": 0.9, "Jump": 0.5, "Land": 0.6}
BUBBLE_PATHS = {c: [bubble_path(i, PATH_LEN[c], PATH_KIND[c]) for i in range(NB)] for c in PATH_KIND}
BUBBLE_REST = [BUBBLE_PATHS["Idle"][i]["a"].copy() for i in range(NB)]
BUBBLES_LEN = PATH_LEN["Idle"]  # the Bubbles clip runs the Idle draw's paths

# --- armature -----------------------------------------------------------------------
arm_data = bpy.data.armatures.new("SlimeRig")
rig = bpy.data.objects.new("SlimeRig", arm_data)
sc.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones
SPINE = [("base", 0.0, 0.4), ("mid", 0.4, 0.75), ("top", 0.75, 1.0)]
parent = None
for name, a, b in [("root", 0, 0.3), ("move", 0, 0.3), ("squash", 0, 0.3)] + SPINE:
    bone = eb.new(name)
    bone.head, bone.tail = (0, 0, a * H), (0, 0, b * H)
    bone.roll = 0
    bone.parent, bone.use_connect = parent, False
    parent = bone
saddle = eb.new("saddle")
saddle.head, saddle.tail = (0, 0, H), (0, 0, 1.3 * H)
saddle.roll = 0
saddle.parent, saddle.use_connect = eb["move"], False
for i, rest in enumerate(BUBBLE_REST):
    bb = eb.new(f"bubble_{i:02d}")
    bb.head, bb.tail = rest, rest + Vector((0, 0, 0.3))
    bb.roll = 0
    bb.parent, bb.use_connect = eb["base"], False
bpy.ops.object.mode_set(mode="OBJECT")
m = arm_data.bones["move"].matrix_local.to_3x3()
assert (m.col[0] - Vector((1, 0, 0))).length < 1e-5, m
assert (m.col[2] - Vector((0, -1, 0))).length < 1e-5, m

# Weights by rest height: the spine blends base -> mid -> top up the body, and
# everything near the top (the seat, its cap and pommel, the body just under it)
# rides the saddle bone. The blanket, straps and stirrups below follow the jelly.
SADDLE_NONE, SADDLE_FULL = H - 0.22 * H, H - 0.10 * H
groups = {n: body.vertex_groups.new(name=n) for n in ("base", "mid", "top", "saddle")}
for v in mesh.vertices:
    z = v.co.z
    h = z / H
    ws = smooth((z - SADDLE_NONE) / (SADDLE_FULL - SADDLE_NONE))
    wb = 1 - smooth((h - 0.15) / 0.35)
    wt = smooth((h - 0.55) / 0.35)
    wm = max(0.0, 1 - wb - wt)
    for n, w in (("base", wb), ("mid", wm), ("top", wt)):
        if w * (1 - ws) > 1e-4:
            groups[n].add([v.index], w * (1 - ws), "REPLACE")
    if ws > 1e-4:
        groups["saddle"].add([v.index], ws, "REPLACE")
body.parent = rig
body.modifiers.new("Armature", "ARMATURE").object = rig

# The bubbles: one mesh, a little sphere per bone, pale and faintly glowing so
# they read through the blue.
bubble_mesh = bpy.data.meshes.new("slime_bubbles")
bubbles = bpy.data.objects.new("slime_bubbles", bubble_mesh)
sc.collection.objects.link(bubbles)
bverts, bfaces, owner = [], [], []
for i, (rest, r) in enumerate(zip(BUBBLE_REST, BUBBLE_R)):
    ibm = bmesh.new()
    bmesh.ops.create_icosphere(ibm, subdivisions=2, radius=r)
    o = len(bverts)
    bverts += [tuple(rest + v.co) for v in ibm.verts]
    bfaces += [tuple(o + v.index for v in f.verts) for f in ibm.faces]
    owner += [i] * len(ibm.verts)
    ibm.free()
bubble_mesh.from_pydata(bverts, [], bfaces)
for p in bubble_mesh.polygons:
    p.use_smooth = True
bmat = bpy.data.materials.new("bubble")
bmat.use_nodes = True
bb_bsdf = next(n for n in bmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bb_bsdf.inputs["Base Color"].default_value = (0.9, 0.98, 1.0, 1)
bb_bsdf.inputs["Emission Color"].default_value = (0.85, 0.97, 1.0, 1)
bb_bsdf.inputs["Emission Strength"].default_value = 0.8
bb_bsdf.inputs["Roughness"].default_value = 0.15
bubble_mesh.materials.append(bmat)
for i in range(NB):
    bubbles.vertex_groups.new(name=f"bubble_{i:02d}").add([k for k, b in enumerate(owner) if b == i], 1.0, "REPLACE")
bubbles.parent = rig
bubbles.modifiers.new("Armature", "ARMATURE").object = rig


# --- motion helpers -----------------------------------------------------------------
def pose(up=0.0, sy=1.0, lean=0.0, side=0.0, yaw=0.0):
    """`up`: height off the ground (model units); `sy`: vertical squash with
    volume kept; `lean`: forward bend of the jelly spine (radians at the top,
    + toward the front); `side`: bend toward the mount's left; `yaw`: turn."""
    return dict(up=up, sy=sy, lean=lean, side=side, yaw=yaw)


def ring(x, f, tau, period=None, phase=math.pi / 2):
    """A damped wobble starting at x = 0: cos-shaped by default (starts at its
    peak), sin-shaped with phase 0. With `period`, the tails of earlier cycles
    are summed in, so a looped clip carries its jiggle across the seam."""
    total = 0.0
    for k in range(6 if period else 1):
        xx = x + k * (period or 0.0)
        if xx >= 0:
            total += math.exp(-xx / tau) * math.sin(2 * math.pi * f * xx + phase)
    return total


def bump(p, a, b):
    """A smooth hump over [a, b], zero outside."""
    if p <= a or p >= b:
        return 0.0
    return math.sin(math.pi * (p - a) / (b - a)) ** 2


def wave(t, period, amp, phase=0.0):
    return amp * math.sin(2 * math.pi * (t / period + phase))


# --- clips --------------------------------------------------------------------------
# Idle: sat on the ground, breathing, swaying, with two little shivers.
IDLE_LEN = 6.0


def idle(t):
    sy = 1 + wave(t, 3.0, 0.02)
    lean = wave(t, 2.0, 0.015) + wave(t, 1.2, 0.006, 0.3)
    side = wave(t, 3.0, 0.018, 0.2) + wave(t, 0.75, 0.004)
    for at, amp, tilt in ((1.3, 0.045, 0.0), (3.9, 0.035, 0.03)):
        if t > at:
            sy -= amp * ring(t - at, 3.0, 0.32)
            side += tilt * ring(t - at, 2.4, 0.36, phase=0.0)
    return pose(sy=sy, lean=lean, side=side, yaw=wave(t, 6.0, 0.04))


def hop(t, length, air_from, height, land, squash_in, stretch, lag, follow, f, tau, tilt=0.0):
    """One slime hop per loop: lands at t = 0 and jiggles down from it, gathers
    (squashes) before take-off at `air_from` of the cycle, stretches as it
    leaves the ground. The top lags back on take-off and carries on forward
    when it lands. Earlier landings' jiggle carries over the loop seam."""
    p = (t / length) % 1.0
    tm = t % length if length - t % length > 1e-6 else 0.0  # the last frame lands again, like the first
    a = max(0.0, (p - air_from) / (1 - air_from))
    up = height * 4 * a * (1 - a) if p > air_from else 0.0
    sy = 1 - land * ring(tm, f, tau, length)
    sy -= squash_in * bump(p, air_from - 0.14, air_from + 0.02)
    if p > air_from:
        sy += stretch * math.sin(math.pi * a) * (1 - a) * 2.5
    lean = tilt + follow * ring(tm, f * 0.8, tau * 1.3, length, phase=0.0)
    lean -= lag * bump(p, air_from - 0.02, air_from + 0.3 * (1 - air_from))
    side = 0.012 * math.sin(2 * math.pi * p)
    return pose(up=up, sy=sy, lean=lean, side=side)


WALK_LEN = 1.0
RUN_LEN = 0.9  # 27 frames: whole frames so the loop closes


def walk(t):
    return hop(t, WALK_LEN, 0.45, 0.07 * H, land=0.09, squash_in=0.06, stretch=0.035,
               lag=0.05, follow=0.06, f=2.8, tau=0.18)


def run(t):
    return hop(t, RUN_LEN, 0.35, 0.26 * H, land=0.14, squash_in=0.08, stretch=0.05,
               lag=0.07, follow=0.08, f=3.2, tau=0.15, tilt=0.05)


# Jump and Land follow the game's held-jump contract (ClipMap.land in
# src/render/characters/manifest.ts): the arc is the game's, so neither clip
# carries a rise. Jump is the gather and the spring, settling on an airborne
# pose (stretched tall, top lagging back) that the game CLAMPS on for however
# long the slime is off the ground; Land fires on touchdown: a splat that
# jiggles out and ends on the idle pose.
#
# The game lifts the mount off the ground on the jump frame, so a crouch played
# in place would happen in mid-air. Jump instead holds the body down against the
# game's rise for its first CROUCH seconds (the slime stays planted and squashes)
# and then springs up to meet the arc, overshooting into a tall stretch: the
# push-off reads as the slime gaining its height. GAME_RISE is the mounted
# jump's rise in model units: v = JUMP_VELOCITY * MOUNT_JUMP_MULT = 7.5 yd/s,
# g = GRAVITY = 16 (src/sim/player_motion.ts), at 6.61 model units to the
# manifest's 4.0 yd.
JUMP_LEN = 0.6  # 18 frames: whole frames so it ends exactly on the held pose
LAND_LEN = 0.6
CROUCH, SPRING = 0.1, 0.08
CROUCH_SY = 0.76
LAUNCH = 0.07  # the extra upward stretch as it leaves the ground, peaking mid-spring
AIR = dict(sy=1.12, lean=-0.04)  # the held airborne pose: Jump's last frame, Land's first
YD_TO_MODEL = 6.607 / 4.0


def game_rise(t):
    return (7.5 * t - 8.0 * t * t) * YD_TO_MODEL


def jump(t):
    if t < CROUCH:
        k = smooth(t / CROUCH)
        return pose(up=-game_rise(t), sy=lerp(1.0, CROUCH_SY, k), lean=-0.03 * k)
    x = t - CROUCH
    held = game_rise(CROUCH) * (1 - smooth(x / SPRING))  # snaps up to the arc
    sy = AIR["sy"] - (AIR["sy"] - CROUCH_SY) * math.exp(-x / 0.09) * math.cos(2 * math.pi * 3.2 * x)
    sy += LAUNCH * bump(x, 0.0, 0.3)
    lean = AIR["lean"] - 0.07 * ring(x, 2.5, 0.12, phase=0.0)
    side = 0.025 * ring(x, 2.2, 0.12, phase=0.0)
    k = smooth((t - 0.4) / 0.2)  # lands exactly on the held pose
    return pose(up=-held, sy=lerp(sy, AIR["sy"], k), lean=lerp(lean, AIR["lean"], k),
                side=lerp(side, 0.0, k))


def land(t):
    if t < 0.05:
        k = smooth(t / 0.05)
        return pose(sy=lerp(AIR["sy"], 0.72, k), lean=AIR["lean"] * (1 - k))
    x = t - 0.05
    sy = 1 - 0.28 * math.exp(-x / 0.15) * math.cos(2 * math.pi * 2.8 * x)
    lean = 0.08 * ring(x, 2.2, 0.18, phase=0.0)
    side = 0.03 * ring(x, 1.9, 0.2, phase=0.0)
    k = smooth((t - 0.45) / 0.15)  # ends on the idle pose
    return pose(sy=lerp(sy, 1.0, k), lean=lerp(lean, 0.0, k), side=lerp(side, 0.0, k))


CLIPS = [
    ("Idle", IDLE_LEN, idle),
    ("Walk", WALK_LEN, walk),
    ("Run", RUN_LEN, run),
    ("Jump", JUMP_LEN, jump),
    ("Land", LAND_LEN, land),
    ("Bubbles", BUBBLES_LEN, None),  # bubble bones only, looped beside the others
]

# --- bake ---------------------------------------------------------------------------
SPINE_SHARE = {"base": 0.25, "mid": 0.4, "top": 0.35}  # of the lean, per spine bone
pb = rig.pose.bones
for b in pb:
    b.rotation_mode = "QUATERNION"
rig.animation_data_create()
SEAT = Vector((0, 0, H))  # armature space, rest
top_rest_inv = arm_data.bones["top"].matrix_local.inverted()
saddle_rest = arm_data.bones["saddle"].matrix_local.copy()
def key(bone, f):
    for path in ("location", "rotation_quaternion", "scale"):
        bone.keyframe_insert(path, frame=f)  # full TRS per bone, no stale values


BUBBLE_BONES = [f"bubble_{i:02d}" for i in range(NB)]
BODY_BONES = ["move", "squash", "base", "mid", "top", "saddle"]
for clip, length, fn in CLIPS:
    action = bpy.data.actions.new(f"Slime_{clip}")
    rig.animation_data.action = action
    for f in range(round(length * FPS) + 1):
        if fn is None:
            for i in range(NB):
                pos, size = bubble_at(BUBBLE_PATHS["Idle"][i], f / FPS)
                d = pos - BUBBLE_REST[i]
                bb = pb[BUBBLE_BONES[i]]
                bb.location = (d.x, d.z, -d.y)  # bone space: X right, Y up, Z front
                bb.scale = (size, size, size)
                key(bb, f)
            continue
        p = fn(f / FPS)
        sxz = 1 / math.sqrt(p["sy"])
        pb["move"].location = (0.0, p["up"], 0.0)
        pb["move"].rotation_quaternion = Matrix.Rotation(p["yaw"], 3, "Y").to_quaternion()
        pb["squash"].scale = (sxz, p["sy"], sxz)
        for name, share in SPINE_SHARE.items():
            pb[name].rotation_quaternion = (
                Matrix.Rotation(p["lean"] * share, 3, "X") @ Matrix.Rotation(-p["side"] * share, 3, "Z")
            ).to_quaternion()
        bpy.context.view_layer.update()
        # The seat goes where the spine carries the top of the body, turned with
        # the top bone but unscaled.
        carry = pb["top"].matrix @ top_rest_inv
        seat = carry @ SEAT
        turn = carry.to_3x3().normalized().to_4x4()
        pb["saddle"].matrix = Matrix.Translation(seat) @ turn @ Matrix.Translation(-SEAT) @ saddle_rest
        bpy.context.view_layer.update()
        for b in BODY_BONES:
            key(pb[b], f)
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, 0, action)
    # Muted while the later clips bake: inserting a new clip's first key
    # re-evaluates the rig, and live tracks would overwrite the pose just set,
    # keying the previous clip's pose onto frame 0 (a pop at every loop seam).
    track.mute = True
for track in rig.animation_data.nla_tracks:
    track.mute = False

for b in pb:  # rest pose for the bind
    b.location, b.scale = (0, 0, 0), (1, 1, 1)
    b.rotation_quaternion = (1, 0, 0, 0)

for screen in bpy.data.screens:  # open the .blend textured, not in plain Solid
    for area in screen.areas:
        if area.type == "VIEW_3D":
            area.spaces[0].shading.type = "MATERIAL"
bpy.ops.wm.save_as_mainfile(filepath=out_glb.replace(".glb", ".blend"))
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_animation_mode="NLA_TRACKS",
    export_frame_range=False,
    export_force_sampling=True,
    export_optimize_animation_size=False,
)
print("EXPORTED", out_glb, [c[0] for c in CLIPS])
