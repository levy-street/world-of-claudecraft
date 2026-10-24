"""Rig and animate the gold + teal sprite pair as one buddy, then export a GLB.

blender --background --python animate_sprites.py -- <sprites_dir> <out.glb>

Rig: per sprite, <c>_move (translation) -> <c>_squash (scale, stays upright)
-> <c>_spin (rotation, mesh bound 100% here), so a sprite can squash along the
world vertical while it turns. Bone space for every bone: X right, Y up,
Z toward the viewer (the sprite's front). Clips are baked every frame at 30 fps,
one action per clip (Sprites_<Clip>) on one NLA track per clip (<Clip>).
"""
import math
import sys

import bmesh
import bpy
from mathutils import Euler, Quaternion, Vector

sprites_dir, out_glb = sys.argv[sys.argv.index("--") + 1 :]
FPS = 30
R = 0.5  # sprite radius
SIDE = 0.7  # rest half-spacing: gold at -X (viewer's left), teal at +X
FLOAT = 0.25  # idle hover above the ground
SPRITES = {"gold": -1, "teal": 1}
# Merging goes green only where the two are joined. Each sprite has a green
# shell inside it (no cheeks, and a gradient that only runs vertically, so it
# can turn about the vertical freely). An <c>_aim bone under <c>_spin turns the
# shell to face the other sprite, and a fan of ring bones under the aim, one
# per 7.5 deg away from that facing, pushes each band of the shell out radially
# (a uniform scale about the centre) to just past the surface. So green shows
# as a cap round the seam where they join, which grows as teal sinks in until
# the whole merged sprite is green, and shrinks back as teal pops out.
MERGED_HIDE = 0.9  # shell radius at rest, in sprite radii: hidden inside
MERGED_SHOW = 1.0055  # shown: proud of the sprite even where facets misalign (sag ~0.0043), under the face (1.007)
RING_STEP = math.radians(7.5)  # one ring per row of the sphere
RINGS = 25  # 0 deg (facing the other sprite) .. 180 deg (the far side)
RING_BAND = math.radians(15)  # how far past the far side a full cap reaches
EDGE_SLOPE = (MERGED_SHOW - MERGED_HIDE) / RING_STEP  # shell radius change per radian across the edge
SEAM_MARGIN = math.radians(28)  # how far green reaches past the seam


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def keys(t, pts):
    """Smoothstep between (time, value) key points; holds outside the range."""
    if t <= pts[0][0]:
        return pts[0][1]
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t <= t1:
            return lerp(v0, v1, smooth((t - t0) / (t1 - t0)))
    return pts[-1][1]


def pose(x=0.0, up=0.0, front=0.0, yaw=0.0, pitch=0.0, roll=0.0, sy=1.0, s=1.0, sx=1.0):
    """Sprite pose: centre offset from its rest centre, rotation, squash (sy along
    the vertical, sx sideways along X, volume preserved) and a uniform scale s.
    `up` is the height of the sprite's BOTTOM above the ground; the centre lifts
    by the squash so the bottom stays where it is."""
    return dict(x=x, up=up, front=front, yaw=yaw, pitch=pitch, roll=roll, sy=sy, s=s, sx=sx)


def bob(t, period, amp, phase=0.0):
    return amp * math.sin(2 * math.pi * (t / period + phase))


# --- Idle: float, spiral together, teal dives into gold, pop apart -----------
IDLE_LEN = 6.0


def idle(c, t):
    side = SPRITES[c]
    up = FLOAT + bob(t, 1.5, 0.06, 0.0 if c == "gold" else 0.5)
    yaw0 = -0.3 * side  # each turns a little toward the other
    # Orbit angle: 0 -> 2pi spiralling in, 2pi -> 4pi spiralling out.
    if t < 1.5:
        theta, rad = 0.0, SIDE
    elif t < 3.3:
        k = (t - 1.5) / 1.8
        theta, rad = 2 * math.pi * smooth(k), SIDE * (1 - smooth(k) ** 1.5)
    elif t < 4.3:
        theta, rad = 2 * math.pi, 0.0
    else:
        k = (t - 4.3) / 1.7
        theta, rad = 2 * math.pi * (1 + smooth(k)), SIDE * smooth(k) ** 0.7
    x = side * (rad * math.cos(theta) - SIDE)  # pose x is an offset from the rest centre
    front = side * rad * math.sin(theta)
    yaw = yaw0 + theta  # they spin as they circle; 4pi total so the loop closes
    s, sy = 1.0, 1.0
    if c == "gold":
        # Swell as teal merges in, wobble as one big sprite, shrink as it splits.
        s = keys(t, [(2.8, 1.0), (3.4, 1.16), (4.3, 1.16), (4.7, 1.0)])
        if 3.3 <= t < 4.3:
            sy = 1 + 0.10 * math.sin(2 * math.pi * (t - 3.3) * 2) * (1 - (t - 3.3))
    else:
        # Dive inside gold (hidden at 0.78 within gold's 1.16), pop out stretched.
        s = keys(t, [(2.8, 1.0), (3.3, 0.78), (4.3, 0.78), (4.6, 1.0)])
        if 4.3 <= t < 4.9:
            sy = 1 + 0.25 * math.sin(math.pi * (t - 4.3) / 0.6)
        up += keys(t, [(3.0, 0.0), (3.3, R * (1.16 - 0.78)), (4.3, R * (1.16 - 0.78)), (4.6, 0.0)])
    return pose(x=x, up=up, front=front, yaw=yaw, sy=sy, s=s)


def centre(c, p):
    """A sprite's centre in bone space (right, up, front) and its squash scale."""
    sxz, side = 1 / math.sqrt(p["sy"]), 1 / math.sqrt(p["sx"])
    vert = p["sy"] * side * p["s"]
    pos = Vector((SPRITES[c] * SIDE + p["x"], p["up"] + R * vert, p["front"]))
    return pos, Vector((sxz * p["sx"] * p["s"], vert, sxz * side * p["s"]))


def seam(c, t):
    """Green cap on sprite c at Idle time t: (yaw in c_spin space that turns
    the shell to face the other sprite, cap half-angle). The cap is the seam
    where the spheres cross plus a margin, growing to cover the whole sprite as
    teal is swallowed (depth 0 just touching, 1 swallowed)."""
    other = "teal" if c == "gold" else "gold"
    p, q = idle(c, t), idle(other, t)
    (pc, ps), (qc, _) = centre(c, p), centre(other, q)
    r, ro = R * p["s"], R * q["s"]
    rg, rt = (r, ro) if c == "gold" else (ro, r)
    d = qc - pc
    dist = d.length
    depth = (rg + rt - dist) / (2 * rt)
    local = Euler((p["pitch"], p["yaw"], p["roll"]), "YXZ").to_quaternion().inverted() @ Vector(
        [d[i] / ps[i] for i in range(3)])
    yaw = math.atan2(local.x, local.z) if math.hypot(local.x, local.z) > 1e-6 else None
    if depth <= 0.0:
        return yaw, 0.0
    if dist <= abs(r - ro):
        cross = 0.0 if r > ro else math.pi  # the bigger one shows nothing of the seam
    else:
        cross = math.acos(min(max((r * r + dist * dist - ro * ro) / (2 * r * dist), -1.0), 1.0))
    cap = cross + SEAM_MARGIN * smooth(depth / 0.25)
    cap += (math.pi + RING_BAND - cap) * smooth((depth - 0.4) / 0.6)
    return yaw, min(cap, math.pi + RING_BAND)


def seam_rings(cap):
    """Shell radius (in sprite radii) from each ring for a green cap of this
    half-angle; the shell crosses the surface right at the cap edge."""
    if cap <= 0.0:
        return [MERGED_HIDE] * RINGS
    # A gentle, even slope through the surface (rather than a step) so the edge
    # falls smoothly inside triangles instead of along their edges.
    return [min(max(1.0 + (cap - k * RING_STEP) * EDGE_SLOPE, MERGED_HIDE), MERGED_SHOW)
            for k in range(RINGS)]


# --- Walk / Run: squash-and-stretch bounce cycles ----------------------------
def bounce(p, height, air=0.72, squash=0.30, stretch=0.16):
    """One bounce at cycle phase p in [0,1): airborne for `air` of the cycle,
    ground contact for the rest. Returns (bottom height, sy)."""
    p %= 1.0
    if p < air:
        a = p / air
        h = height * math.sin(math.pi * a)
        sy = 1 + stretch * math.sin(2 * math.pi * a) ** 2  # stretched rising and falling
        return h, sy
    g = (p - air) / (1 - air)
    return 0.0, 1 - squash * math.sin(math.pi * g)


WALK_LEN = 0.8


def walk(c, t):
    p = t / WALK_LEN + (0.0 if c == "gold" else 0.5)
    h, sy = bounce(p, 0.38)
    lean = 0.12 * math.sin(2 * math.pi * p)  # tip forward rising, back landing
    return pose(up=h, sy=sy, pitch=lean, yaw=-0.12 * SPRITES[c])


RUN_LEN = 0.9  # 27 frames: a whole number of frames so the loop closes


def run(c, t):
    p = t / RUN_LEN + (0.0 if c == "gold" else 0.5)
    h, sy = bounce(p, 0.62, air=0.78, squash=0.40, stretch=0.26)  # long, high bounding leaps
    return pose(up=h, sy=sy, pitch=0.25 + 0.08 * math.sin(2 * math.pi * p))


# --- Jump: anticipation, high launch with a spin, land, settle to Idle --------
JUMP_LEN = 1.5


def jump(c, t):
    t = t - (0.0 if c == "gold" else 0.07)  # teal a beat behind
    rest = idle(c, 0.0)
    if t <= 0:
        return rest
    up, sy, yaw = rest["up"], 1.0, rest["yaw"]
    if t < 0.25:  # crouch down to the ground and squash
        k = smooth(t / 0.25)
        up, sy = lerp(rest["up"], 0.0, k), lerp(1.0, 0.62, k)
    elif t < 0.95:  # launch: parabola to ~1.3 above the ground, stretched, spinning
        a = (t - 0.25) / 0.7
        up = 1.3 * 4 * a * (1 - a)
        sy = 1 + 0.3 * (1 - 2 * a) ** 2  # stretched at take-off and landing, round at the apex
        if a < 0.08:
            sy = lerp(0.62, 1.3, a / 0.08)  # snap out of the crouch
        yaw = rest["yaw"] + 2 * math.pi * smooth(a)
    elif t < 1.12:  # landing squash
        k = (t - 0.95) / 0.17
        up, sy = 0.0, 1 - 0.32 * math.sin(math.pi * k)
    else:  # rebound to the hover with a small wobble
        k = smooth((t - 1.12) / 0.28)
        up = lerp(0.0, rest["up"], k)
        sy = 1 + 0.08 * math.sin(math.pi * 2 * k) * (1 - k)
    return pose(x=rest["x"], up=up, front=rest["front"], yaw=yaw, sy=sy)


# --- Search: peer around, teal peeks higher, turn to each other and shrug ----
SEARCH_LEN = 4.0


def search(c, t):
    side = SPRITES[c]
    rest = idle(c, 0.0)
    if c == "gold":
        yaw = keys(t, [(0.0, rest["yaw"]), (0.5, 0.9), (1.2, 0.9), (1.7, -0.9), (2.4, -0.9), (2.9, rest["yaw"])])
    else:
        yaw = keys(t, [(0.0, rest["yaw"]), (0.35, -0.9), (1.0, -0.9), (1.5, 0.7), (2.3, 0.7), (2.9, rest["yaw"])])
    pitch = keys(t, [(0.0, 0.0), (0.5, 0.35), (1.2, 0.35), (1.5, 0.0), (1.8, 0.3), (2.4, 0.3), (2.8, 0.0)])
    up = FLOAT + bob(t, 2.0, 0.04, 0.0 if c == "gold" else 0.5)
    sy = 1.0
    if c == "teal":  # pop up for a higher look
        hop = keys(t, [(1.8, 0.0), (2.05, 0.45), (2.35, 0.45), (2.6, 0.0)])
        up += hop
        if 1.8 <= t < 2.1:
            sy = 1 + 0.2 * math.sin(math.pi * (t - 1.8) / 0.3)
        if 2.55 <= t < 2.8:
            sy = 1 - 0.15 * math.sin(math.pi * (t - 2.55) / 0.25)
    # Turn to each other and shrug (squash), then face front to close the loop.
    face = keys(t, [(2.9, 0.0), (3.15, 1.0), (3.6, 1.0), (3.9, 0.0)])
    yaw = lerp(yaw, -1.1 * side, face)
    if 3.15 <= t < 3.6:
        sy *= 1 - 0.12 * math.sin(math.pi * (t - 3.15) / 0.45)
    return pose(x=rest["x"], up=up, front=rest["front"], yaw=yaw, pitch=pitch, sy=sy)



# --- Idle fidgets: one-shots that start and end on the Idle pose ---------------
# The game plays these at random while the buddy stands still (ClipMap
# idleVariants) and cuts back to Idle the moment it moves, so frame 0 and the
# last frame must both be exactly idle(c, 0).
def hop(t, t0, t1, height):
    """Parabolic hop between t0 and t1 (0 outside)."""
    if t <= t0 or t >= t1:
        return 0.0
    a = (t - t0) / (t1 - t0)
    return height * 4 * a * (1 - a)


def hop_squash(t, t0, t1, amount=0.3):
    """Squash on take-off and landing around a hop, stretch in the air."""
    pre = keys(t, [(t0 - 0.16, 1.0), (t0 - 0.04, 1 - amount), (t0 + 0.06, 1 + amount * 0.8), (t0 + 0.2, 1.0)])
    post = keys(t, [(t1 - 0.06, 1.0), (t1 + 0.04, 1 - amount * 0.8), (t1 + 0.22, 1.0)])
    return pre * post


def giggle(t, t0, t1, phase=0.0):
    """Quick happy jiggle between t0 and t1."""
    on = keys(t, [(t0, 0.0), (t0 + 0.1, 1.0), (t1 - 0.1, 1.0), (t1, 0.0)])
    return 0.05 * math.sin(2 * math.pi * 6 * t + phase) * on


NUZZLE_LEN = 3.2


def nuzzle(c, t):
    """Drift together, squish cheeks and wiggle, drift back."""
    side, rest = SPRITES[c], idle(c, 0.0)
    together = keys(t, [(0.0, 0.0), (0.6, 1.0), (2.3, 1.0), (3.1, 0.0)])
    wiggle = math.sin(2 * math.pi * 3 * (t - 0.6) / 1.7) if 0.6 < t < 2.3 else 0.0
    return pose(
        x=-side * 0.27 * together,
        up=rest["up"] + 0.03 * wiggle * side * together,
        yaw=lerp(rest["yaw"], -side * 0.55, together),
        roll=side * 0.22 * together + 0.06 * wiggle * together,
        sx=1 - 0.14 * together,
    )


PEEK_LEN = 4.4


def peekaboo(c, t):
    """Teal hides behind gold; gold looks around; teal pops up over its head; both giggle."""
    rest = idle(c, 0.0)
    if c == "teal":
        back = keys(t, [(0.0, 0.0), (0.45, -1.15), (3.5, -1.15), (4.3, 0.0)])
        x = keys(t, [(0.2, 0.0), (0.8, -1.4), (3.4, -1.4), (4.3, 0.0)])
        up = keys(t, [(0.1, rest["up"]), (0.5, 0.05), (2.05, 0.05), (2.3, 1.02), (3.2, 1.02), (3.6, 0.6), (4.3, rest["up"])])
        sy = keys(t, [(2.05, 1.0), (2.2, 1.28), (2.45, 0.9), (2.6, 1.0)]) + giggle(t, 2.6, 3.4)
        yaw = keys(t, [(0.0, rest["yaw"]), (2.1, rest["yaw"]), (2.3, 0.5), (3.4, 0.5), (4.3, rest["yaw"])])
        scale = keys(t, [(0.2, 1.0), (0.6, 0.92), (3.6, 0.92), (4.2, 1.0)])
        return pose(x=x, up=up, front=back, yaw=yaw, sy=sy, s=scale)
    look = keys(t, [(0.4, rest["yaw"]), (0.75, 0.75), (1.2, 0.75), (1.55, -0.75), (2.0, -0.75), (2.3, 0.0), (3.4, 0.0), (4.2, rest["yaw"])])
    sy = hop_squash(t, 2.2, 2.6, 0.25) + giggle(t, 2.6, 3.4, 1.0)
    pitch = keys(t, [(0.4, 0.0), (0.8, 0.12), (2.0, 0.12), (2.2, 0.0)])
    return pose(up=rest["up"] + hop(t, 2.2, 2.6, 0.32), yaw=look, sy=sy, pitch=pitch)


DANCE_LEN = 3.6
BEAT = 0.45


def dance(c, t):
    """Bop side to side on the beat, then a twirl on a big hop each (opposite ways)."""
    side, rest = SPRITES[c], idle(c, 0.0)
    beat = t / BEAT
    on = keys(t, [(0.0, 0.0), (0.2, 1.0), (3.2, 1.0), (3.55, 0.0)])
    sway = math.sin(math.pi * beat) * on
    bop = abs(math.sin(math.pi * beat)) * 0.14 * on
    twirl = keys(t, [(2.25, 0.0), (2.85, 1.0)])
    sy = (1 - 0.12 * (1 - abs(math.sin(math.pi * beat))) * on) * hop_squash(t, 2.2, 2.9, 0.2)
    return pose(
        x=0.14 * sway,
        up=rest["up"] + bop + hop(t, 2.2, 2.9, 0.42),
        yaw=rest["yaw"] + 0.25 * sway - side * 2 * math.pi * twirl,
        roll=-0.18 * sway,
        sy=sy,
    )


DOZE_LEN = 5.6


def doze(c, t):
    """Both get drowsy; gold nods off; teal falls asleep leaning on gold, startles awake, giggles."""
    rest = idle(c, 0.0)
    drowsy = keys(t, [(0.0, 0.0), (1.2, 1.0), (3.9, 1.0), (4.3, 0.0)])
    breathe = 0.04 * math.sin(2 * math.pi * (t / 1.3)) * drowsy
    up = rest["up"] - 0.12 * drowsy
    yaw = lerp(rest["yaw"], 0.0, drowsy)
    if c == "gold":
        nod = keys(t, [(1.2, 0.0), (1.9, 0.38), (2.0, 0.0), (2.1, 0.0), (2.9, 0.3), (3.5, 0.3), (3.7, 0.0)])
        roll = keys(t, [(3.4, 0.0), (3.7, 0.1), (4.5, 0.1), (5.2, 0.0)])
        return pose(up=up, yaw=yaw, pitch=nod, sy=1 + breathe + giggle(t, 4.4, 5.1, 1.0), roll=roll)
    lean = keys(t, [(2.2, 0.0), (3.0, 1.0), (3.85, 1.0), (4.05, 0.0)])
    sy = (1 + breathe) * hop_squash(t, 3.9, 4.3, 0.25) + giggle(t, 4.4, 5.1)
    return pose(x=-0.28 * lean, up=up + hop(t, 3.9, 4.3, 0.3), yaw=yaw,
                roll=0.38 * lean, pitch=0.1 * drowsy, sy=sy, sx=1 - 0.08 * lean)


LEAP_LEN = 2.6
LEAPS = {"gold": (0.25, 1.0), "teal": (1.45, 2.2)}  # (take-off, landing) of each one's leap


def leapfrog(c, t):
    """Gold cartwheels over teal while teal scoots underneath to swap places,
    then teal cartwheels back over gold while gold scoots under: both end home."""
    side, rest = SPRITES[c], idle(c, 0.0)
    other = "teal" if c == "gold" else "gold"
    span = 2 * SIDE
    (j0, j1), (d0, d1) = LEAPS[c], LEAPS[other]
    leap = keys(t, [(j0, 0.0), (j1, 1.0)])
    under = keys(t, [(d0, 0.0), (d1, 1.0)])
    # Gold goes out first (-side = toward teal) and comes back under; teal the reverse.
    out_first = c == "gold"
    x = -side * span * (leap if out_first else under) + side * span * (under if out_first else leap)
    duck = keys(t, [(d0 - 0.05, 0.0), (d0 + 0.2, 1.0), (d1 - 0.2, 1.0), (d1 + 0.1, 0.0)])
    up = rest["up"] + hop(t, j0, j1, 1.12) - 0.12 * duck
    roll = side * 2 * math.pi * leap * (1 if out_first else -1)  # cartwheel the way it travels
    sy = hop_squash(t, j0, j1, 0.3) * (1 - 0.22 * duck)
    return pose(x=x, up=up, yaw=rest["yaw"], roll=roll, sy=sy)


CLIPS = [
    ("Idle", IDLE_LEN, idle),
    ("Walk", WALK_LEN, walk),
    ("Run", RUN_LEN, run),
    ("Jump", JUMP_LEN, jump),
    ("Search", SEARCH_LEN, search),
    ("Idle_Nuzzle", NUZZLE_LEN, nuzzle),
    ("Idle_Peekaboo", PEEK_LEN, peekaboo),
    ("Idle_Dance", DANCE_LEN, dance),
    ("Idle_Doze", DOZE_LEN, doze),
    ("Idle_Leapfrog", LEAP_LEN, leapfrog),
]

# --- scene: bring in both sprite meshes --------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = FPS
meshes = {}
for c, side in SPRITES.items():
    with bpy.data.libraries.load(f"{sprites_dir}/{c}_sprite.blend", link=False) as (src, dst):
        dst.objects = [f"{c}_sprite"]
    ob = dst.objects[0]
    sc.collection.objects.link(ob)
    ob.location = (side * SIDE, 0, 0)
    meshes[c] = ob
with bpy.data.libraries.load(f"{sprites_dir}/merged_sprite.blend", link=False) as (src, dst):
    dst.objects = ["merged_sprite"]
for v in dst.objects[0].data.vertices:  # shrink about the sphere centre so it rests inside
    v.co = Vector((v.co.x * MERGED_HIDE, v.co.y * MERGED_HIDE, R + (v.co.z - R) * MERGED_HIDE))
shells = {}
for c, side in SPRITES.items():
    ob = dst.objects[0]
    if c != "gold":
        ob = ob.copy()
        ob.data = ob.data.copy()
    ob.name = f"{c}_merged"
    sc.collection.objects.link(ob)
    ob.location = (side * SIDE, 0, 0)
    shells[c] = ob

# Triangulate every sphere the same fixed way now: left to the exporter, a shell
# can split some quads along the other diagonal from its sprite, and where the
# two surfaces meet that shows as a sawtooth edge.
for ob in [*meshes.values(), *shells.values()]:
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="FIXED", ngon_method="BEAUTY")
    bm.to_mesh(ob.data)
    bm.free()

# --- armature ------------------------------------------------------------------
arm_data = bpy.data.armatures.new("SpritesRig")
rig = bpy.data.objects.new("SpritesRig", arm_data)
sc.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
root = arm_data.edit_bones.new("root")
root.head, root.tail = (0, 0, 0), (0, 0, 0.3)
for c, side in SPRITES.items():
    parent = root
    for part in ("move", "squash", "spin"):
        b = arm_data.edit_bones.new(f"{c}_{part}")
        b.head, b.tail = (side * SIDE, 0, R), (side * SIDE, 0, R + 0.3)
        b.roll = 0
        b.parent, b.use_connect = parent, False
        parent = b
for c, side in SPRITES.items():
    parent = arm_data.edit_bones[f"{c}_spin"]
    for name in [f"{c}_aim"] + [f"{c}_merged_{k:02d}" for k in range(RINGS)]:
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = (side * SIDE, 0, R), (side * SIDE, 0, R + 0.3)
        b.roll = 0
        b.parent, b.use_connect = parent, False
        if name.endswith("_aim"):
            parent = b
bpy.ops.object.mode_set(mode="OBJECT")
# Bone space must be X right, Y up, Z toward the viewer (Blender -Y).
m = arm_data.bones["gold_move"].matrix_local.to_3x3()
assert (m.col[0] - Vector((1, 0, 0))).length < 1e-5, m
assert (m.col[2] - Vector((0, -1, 0))).length < 1e-5, m

for c, ob in meshes.items():
    vg = ob.vertex_groups.new(name=f"{c}_spin")
    vg.add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    ob.parent = rig
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
# Shells: each vertex split between the two rings either side of its angle
# from the aim facing, bone space +Z (X right, Y up, Z front).
for c, ob in shells.items():
    groups = [ob.vertex_groups.new(name=f"{c}_merged_{k:02d}") for k in range(RINGS)]
    for v in ob.data.vertices:
        a = Vector((v.co.x, v.co.z - R, -v.co.y)).angle(Vector((0, 0, 1))) / RING_STEP
        k = min(int(a), RINGS - 2)
        groups[k].add([v.index], 1 - (a - k), "REPLACE")
        groups[k + 1].add([v.index], a - k, "REPLACE")
    ob.parent = rig
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

# --- bake clips ---------------------------------------------------------------
pb = rig.pose.bones
for b in pb:
    b.rotation_mode = "QUATERNION"
rig.animation_data_create()
for clip, length, fn in CLIPS:
    action = bpy.data.actions.new(f"Sprites_{clip}")
    rig.animation_data.action = action
    frames = round(length * FPS)
    aim_yaw = {c: 0.0 for c in SPRITES}
    for f in range(frames + 1):
        t = f / FPS
        for c in SPRITES:
            p = fn(c, t)
            sxz = 1 / math.sqrt(p["sy"])
            side = 1 / math.sqrt(p["sx"])  # a sideways squish bulges up and out
            mv, sq, sp = pb[f"{c}_move"], pb[f"{c}_squash"], pb[f"{c}_spin"]
            vert = p["sy"] * side * p["s"]
            # Centre height: bottom offset + squashed, scaled radius - rest radius.
            centre_up = p["up"] + R * vert - R
            mv.location = (p["x"], centre_up, p["front"])
            sq.scale = (sxz * p["sx"] * p["s"], vert, sxz * side * p["s"])
            sp.rotation_quaternion = Euler((p["pitch"], p["yaw"], p["roll"]), "YXZ").to_quaternion()
            for b, path in ((mv, "location"), (sq, "scale"), (sp, "rotation_quaternion")):
                b.keyframe_insert(path, frame=f)
            for b, path in ((mv, "rotation_quaternion"), (mv, "scale"), (sq, "location"),
                            (sq, "rotation_quaternion"), (sp, "location"), (sp, "scale")):
                b.keyframe_insert(path, frame=f)  # full TRS per bone, no stale values
        for c in SPRITES:
            yaw, cap = seam(c, t) if clip == "Idle" else (None, 0.0)
            if yaw is not None:  # unwrap so the aim never spins the long way round
                aim_yaw[c] = yaw + 2 * math.pi * round((aim_yaw[c] - yaw) / (2 * math.pi))
            aim = pb[f"{c}_aim"]
            aim.rotation_quaternion = Quaternion((0, 1, 0), aim_yaw[c])
            aim.keyframe_insert("rotation_quaternion", frame=f)
            for k, rho in enumerate(seam_rings(cap)):
                rb = pb[f"{c}_merged_{k:02d}"]
                rb.scale = (rho / MERGED_HIDE,) * 3
                rb.keyframe_insert("scale", frame=f)  # location and rotation never leave rest
    rig.animation_data.action = None
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, 0, action)
    track.mute = False

for b in pb:  # rest pose for the bind
    b.location, b.scale = (0, 0, 0), (1, 1, 1)
    b.rotation_quaternion = (1, 0, 0, 0)

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
