"""Give the sprites morphable faces and bake per-clip expressions.

blender --background sprites_buddy.blend --python faces.py -- <sprites_dir>

Each sprite gets a <c>_face mesh: eyes and mouth as thin glowing patches that
hug the sphere just above its surface, skinned 100% to <c>_spin. Every feature
is three rows (top, middle, bottom) of the same N points, so any expression is
just new point positions: those become shape keys (glTF morph targets). Shapes
are authored in FRONT-VIEW coords (unit disc, x right, y up), the same space the
texture was painted in. Expression weights are baked per frame into one action
per clip on the face's shape keys, on an NLA track named like the rig's, so the
exporter merges them into the same glTF animation. Saves sprites_buddy.blend.
"""
import math
import sys

import bpy

sprites_dir = sys.argv[sys.argv.index("--") + 1]
FPS = 30
R = 0.5
LIFT = 1.007  # just above the faceted sphere (max chord sag is ~0.2% of R)
N = 16
SPRITES = {"gold": -1, "teal": 1}
FEATURE = {"gold": (1.0, 0.9, 0.45), "teal": (0.78, 1.0, 0.86)}
GLOW = {"gold": (1.0, 0.92, 0.55), "teal": (0.82, 1.0, 0.90)}

XS = [-math.cos(math.pi * i / (N - 1)) for i in range(N)]  # dense at the ends


def rows(top, bottom):
    """Feature outline as (top, middle, bottom) rows of N (x, y) points."""
    mid = [((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in zip(top, bottom)]
    return [top, mid, bottom]


def lens(cx, cy, rx, top_h, bot_h, line=lambda u: 0.0):
    """Closed shape: centre line cy+line(u), top and bottom bulging by the given
    heights times sqrt(1-u^2), so the ends pinch to a point."""
    top, bot = [], []
    for u in XS:
        s = math.sqrt(max(1 - u * u, 0.0))
        y = cy + line(u)
        top.append((cx + rx * u, y + top_h(u) * s))
        bot.append((cx + rx * u, y - bot_h(u) * s))
    return rows(top, bot)


def const(v):
    return lambda u: v


# --- eyes (one per side; `side` -1 = viewer's left eye) ------------------------
EYE_X, EYE_Y, EYE_RX, EYE_RY = 0.455, 0.01, 0.115, 0.12


def eye(side, shape):
    cx = side * EYE_X
    if shape == "neutral":
        return lens(cx, EYE_Y, EYE_RX, const(EYE_RY), const(EYE_RY))
    if shape == "blink":  # closed, a soft downward curve
        return lens(cx, EYE_Y - 0.03, EYE_RX * 1.05, const(0.016), const(0.016), lambda u: -0.035 * (1 - u * u))
    if shape == "happy":  # ^ ^
        return lens(cx, EYE_Y - 0.03, EYE_RX * 1.05, const(0.02), const(0.02), lambda u: 0.07 * (1 - u * u))
    if shape == "wide":
        return lens(cx, EYE_Y + 0.01, EYE_RX * 1.22, const(EYE_RY * 1.3), const(EYE_RY * 1.3))
    if shape == "squint":  # determined: flat lid tilted down toward the nose
        return lens(cx, EYE_Y - 0.02, EYE_RX, const(EYE_RY * 0.35), const(EYE_RY * 0.85), lambda u: 0.035 * u * side)
    if shape in ("lookL", "lookR"):
        shift = -0.075 if shape == "lookL" else 0.075
        return lens(cx + shift, EYE_Y + 0.01, EYE_RX * 0.9, const(EYE_RY), const(EYE_RY))
    raise ValueError(shape)


# --- mouth ----------------------------------------------------------------------
def mouth(shape):
    if shape == "neutral":  # thick smile stroke along a circle (matches the old texture)
        cy, r, a_max = -0.03, 0.18, math.radians(56)
        top, bot = [], []
        for u in XS:
            a = u * a_max
            hw = (0.068 - 0.018 * u * u) * math.sqrt(max(1 - u ** 6, 0.0)) ** 0.5  # rounded tips
            px, py = r * math.sin(a), cy - r * math.cos(a)
            nx, ny = math.sin(a), -math.cos(a)  # away from the circle's centre
            top.append((px - nx * hw, py - ny * hw))
            bot.append((px + nx * hw, py + ny * hw))
        return rows(top, bot)
    if shape == "bigSmile":  # open D: nearly flat top, deep round bottom
        return lens(0.0, -0.10, 0.21, const(0.012), lambda u: 0.17 * (1 - u * u) ** 0.2 + 0.0, lambda u: 0.03 * u * u)
    if shape == "o":
        return lens(0.0, -0.17, 0.075, const(0.09), const(0.09))
    if shape == "flat":
        return lens(0.0, -0.15, 0.13, const(0.022), const(0.022), lambda u: -0.008 * math.sin(math.pi * u))
    raise ValueError(shape)


EYE_KEYS = {"EyesBlink": "blink", "EyesHappy": "happy", "EyesWide": "wide", "EyesSquint": "squint",
            "EyesLookL": "lookL", "EyesLookR": "lookR"}
MOUTH_KEYS = {"MouthBigSmile": "bigSmile", "MouthO": "o", "MouthFlat": "flat"}


def face_points(eye_shape="neutral", mouth_shape="neutral"):
    feats = [eye(-1, eye_shape), eye(1, eye_shape), mouth(mouth_shape)]
    return [p for f in feats for row in f for p in row]


def to_world(pt, centre):
    fx, fy = pt
    d2 = min(fx * fx + fy * fy, 0.995)
    # Front view looks along +Y at the sprite's front (-Y): x right = +X, y up = +Z.
    return (centre[0] + R * LIFT * fx, centre[1] - R * LIFT * math.sqrt(1 - d2), centre[2] + R * LIFT * fy)


rig = bpy.data.objects["SpritesRig"]
arm = rig.data
sc = bpy.context.scene
faces_obj = {}
for c in SPRITES:
    centre = arm.bones[f"{c}_spin"].head_local
    base = face_points()
    verts = [to_world(p, centre) for p in base]
    polys = []
    for f in range(3):  # 3 features x (3 rows of N)
        o = f * 3 * N
        for r in range(2):
            for i in range(N - 1):
                a, b = o + r * N + i, o + r * N + i + 1
                polys.append((a, b, b + N, a + N))
    mesh = bpy.data.meshes.new(f"{c}_face")
    mesh.from_pydata(verts, [], polys)
    mesh.update()
    # Normals must face the camera (outward, -Y); flip if the winding came out inward.
    if mesh.polygons[len(mesh.polygons) // 2].normal.y > 0:
        for p in mesh.polygons:
            p.flip()
        mesh.update()
    ob = bpy.data.objects.new(f"{c}_face", mesh)
    sc.collection.objects.link(ob)
    mat = bpy.data.materials.new(f"{c}_face_mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*FEATURE[c], 1)
    bsdf.inputs["Emission Color"].default_value = (*GLOW[c], 1)
    bsdf.inputs["Emission Strength"].default_value = 0.3  # glow, but keep the pale tint
    bsdf.inputs["Roughness"].default_value = 0.6
    mesh.materials.append(mat)
    vg = ob.vertex_groups.new(name=f"{c}_spin")
    vg.add(list(range(len(verts))), 1.0, "REPLACE")
    ob.parent = rig
    ob.modifiers.new("Armature", "ARMATURE").object = rig
    ob.shape_key_add(name="Basis", from_mix=False)
    for key, shape in EYE_KEYS.items():
        kb = ob.shape_key_add(name=key, from_mix=False)
        for i, p in enumerate(face_points(eye_shape=shape)):
            kb.data[i].co = to_world(p, centre)
    for key, shape in MOUTH_KEYS.items():
        kb = ob.shape_key_add(name=key, from_mix=False)
        for i, p in enumerate(face_points(mouth_shape=shape)):
            kb.data[i].co = to_world(p, centre)
    faces_obj[c] = ob


# --- expression timelines ---------------------------------------------------------
def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def env(t, a, b, c, d):
    """0 before a, ramps to 1 by b, holds, back to 0 from c to d."""
    if t <= a or t >= d:
        return 0.0
    if t < b:
        return smooth((t - a) / (b - a))
    if t <= c:
        return 1.0
    return 1 - smooth((t - c) / (d - c))


def blink(t, at, dur=0.18):
    return env(t, at, at + dur * 0.35, at + dur * 0.5, at + dur)


def idle(c, t):
    w = {}
    blinks = (1.0, 5.55) if c == "gold" else (1.25, 5.7)
    w["EyesBlink"] = max(blink(t, b) for b in blinks)
    play = env(t, 1.6, 1.9, 3.0, 3.25)  # giggling as they spiral in
    w["EyesHappy"] = play
    w["MouthBigSmile"] = play * 0.8
    if c == "gold":  # beaming while merged, still pleased as they part
        merged = env(t, 3.2, 3.4, 4.6, 5.2)
        w["EyesHappy"] = max(w["EyesHappy"], merged)
        w["MouthBigSmile"] = max(w["MouthBigSmile"], merged)
    else:  # pops out surprised, then grins
        pop = env(t, 4.25, 4.35, 4.6, 4.85)
        w["EyesWide"] = pop
        w["MouthO"] = pop
        grin = env(t, 4.7, 4.9, 5.1, 5.45)
        w["EyesHappy"] = max(w["EyesHappy"], grin)
        w["MouthBigSmile"] = max(w["MouthBigSmile"], grin * 0.7)
    return w


def bounce_phase(t, length, c):
    return (t / length + (0.0 if c == "gold" else 0.5)) % 1.0


def walk(c, t):
    p = bounce_phase(t, 0.8, c)
    land = math.sin(math.pi * (p - 0.72) / 0.28) if p > 0.72 else 0.0
    return {"MouthBigSmile": 0.35, "EyesHappy": 0.15, "EyesSquint": 0.55 * land}


def run(c, t):
    p = bounce_phase(t, 0.9, c)
    land = math.sin(math.pi * (p - 0.78) / 0.22) if p > 0.78 else 0.0
    return {"EyesSquint": 0.75 + 0.25 * land, "MouthFlat": 0.7}


def jump(c, t):
    t = t - (0.0 if c == "gold" else 0.07)
    wind = env(t, 0.0, 0.12, 0.22, 0.3)
    whee = env(t, 0.24, 0.32, 0.45, 0.6)
    joy = env(t, 0.5, 0.62, 0.85, 0.98)
    land = env(t, 0.93, 0.98, 1.03, 1.15)
    return {
        "EyesSquint": wind,
        "MouthFlat": wind,
        "EyesWide": whee,
        "MouthO": whee,
        "EyesHappy": joy,
        "MouthBigSmile": joy,
        "EyesBlink": land,
    }


def search(c, t):
    # Glance the way each sprite turns (matches animate_sprites.search yaw keys).
    if c == "gold":
        right = env(t, 0.1, 0.5, 1.2, 1.5)
        left = env(t, 1.45, 1.75, 2.4, 2.85)
    else:
        left = env(t, 0.0, 0.35, 1.0, 1.3)
        right = env(t, 1.25, 1.55, 2.3, 2.85)
    w = {"EyesLookR": right, "EyesLookL": left}
    if c == "teal":
        w["EyesWide"] = env(t, 1.85, 2.0, 2.3, 2.55)
        w["MouthO"] = env(t, 1.9, 2.05, 2.25, 2.5) * 0.7
    shrug = env(t, 3.1, 3.25, 3.55, 3.85)
    w["EyesBlink"] = max(shrug * 0.55, blink(t, 0.6 if c == "gold" else 2.95))
    w["MouthFlat"] = shrug
    return w



# --- Idle fidgets (timings match animate_sprites.py) -------------------------------
def nuzzle(c, t):
    squish = env(t, 0.45, 0.7, 2.2, 2.6)
    return {"EyesHappy": squish, "MouthBigSmile": squish * 0.85, "EyesBlink": blink(t, 2.85)}


def peekaboo(c, t):
    if c == "gold":
        hunt = env(t, 0.35, 0.6, 1.95, 2.15)
        return {
            "EyesLookR": env(t, 0.5, 0.75, 1.15, 1.35),
            "EyesLookL": env(t, 1.35, 1.55, 1.95, 2.15),
            "MouthFlat": hunt * 0.6,
            "EyesWide": env(t, 2.15, 2.22, 2.45, 2.6),
            "MouthO": env(t, 2.15, 2.22, 2.45, 2.6),
            "EyesHappy": env(t, 2.6, 2.7, 3.35, 3.7),
            "MouthBigSmile": env(t, 2.6, 2.7, 3.35, 3.7),
        }
    sneaky = env(t, 0.1, 0.35, 1.95, 2.1)
    boo = env(t, 2.05, 2.15, 2.5, 2.65)
    joy = env(t, 2.6, 2.7, 3.35, 3.8)
    return {
        "EyesSquint": sneaky * 0.5,
        "MouthBigSmile": max(sneaky * 0.4, boo, joy),
        "EyesWide": boo,
        "EyesHappy": joy,
    }


def dance(c, t):
    fun = env(t, 0.0, 0.25, 3.1, 3.5)
    whee = env(t, 2.25, 2.35, 2.75, 2.9)
    return {
        "EyesHappy": fun * (1 - whee),
        "MouthBigSmile": fun * (1 - whee),
        "EyesWide": whee,
        "MouthO": whee,
    }


def doze(c, t):
    sleepy = env(t, 0.0, 1.2, 3.85, 3.95)
    if c == "gold":
        startle = env(t, 1.95, 2.0, 2.1, 2.35)  # the nod jerks it awake for a moment
        awake = env(t, 3.55, 3.7, 4.3, 4.6)  # turns to its sleepy friend
        joy = env(t, 4.35, 4.5, 5.0, 5.3)
        return {
            "EyesBlink": max(0.0, sleepy * (0.75 - 0.75 * startle) * (1 - awake)),
            "EyesWide": startle * 0.6,
            "EyesLookR": awake * (1 - joy),
            "MouthBigSmile": max(awake * 0.5, joy),
            "EyesHappy": joy,
        }
    asleep = env(t, 1.5, 2.0, 3.85, 3.95)
    startle = env(t, 3.9, 3.97, 4.3, 4.45)
    joy = env(t, 4.4, 4.55, 5.0, 5.35)
    return {
        "EyesBlink": max(sleepy * 0.7, asleep),
        "MouthO": asleep * 0.45,  # little snore
        "EyesWide": startle,
        "EyesHappy": joy,
        "MouthBigSmile": joy,
    }


def leapfrog(c, t):
    jump_t, land_t = (0.25, 1.0) if c == "gold" else (1.45, 2.2)
    duck_t = (1.45, 2.2) if c == "gold" else (0.25, 1.0)
    whee = env(t, jump_t - 0.1, jump_t + 0.05, land_t - 0.1, land_t + 0.1)
    duck = env(t, duck_t[0] - 0.05, duck_t[0] + 0.15, duck_t[1] - 0.15, duck_t[1] + 0.05)
    joy = env(t, 2.1, 2.25, 2.4, 2.58)
    return {
        "EyesWide": whee,
        "MouthBigSmile": max(whee, joy),
        "EyesBlink": duck,
        "MouthFlat": duck * 0.6,
        "EyesHappy": joy,
    }


CLIPS = {
    "Idle": (6.0, idle),
    "Walk": (0.8, walk),
    "Run": (0.9, run),
    "Jump": (1.5, jump),
    "Search": (4.0, search),
    "Idle_Nuzzle": (3.2, nuzzle),
    "Idle_Peekaboo": (4.4, peekaboo),
    "Idle_Dance": (3.6, dance),
    "Idle_Doze": (5.6, doze),
    "Idle_Leapfrog": (2.6, leapfrog),
}
ALL_KEYS = list(EYE_KEYS) + list(MOUTH_KEYS)

for c, ob in faces_obj.items():
    key = ob.data.shape_keys
    key.animation_data_create()
    for clip, (length, fn) in CLIPS.items():
        action = bpy.data.actions.new(f"Face_{c}_{clip}")
        key.animation_data.action = action
        for f in range(round(length * FPS) + 1):
            w = fn(c, f / FPS)
            for name in ALL_KEYS:
                kb = key.key_blocks[name]
                kb.value = min(max(w.get(name, 0.0), 0.0), 1.0)
                kb.keyframe_insert("value", frame=f)
        key.animation_data.action = None
        track = key.animation_data.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 0, action)
    for name in ALL_KEYS:
        key.key_blocks[name].value = 0.0

bpy.ops.wm.save_mainfile()
print("FACES", {c: len(ob.data.vertices) for c, ob in faces_obj.items()}, ALL_KEYS)
