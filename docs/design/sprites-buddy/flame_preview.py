"""Preview the transparent flame over each sprite in Blender (look only; in game
the flame runs live, so nothing here is exported).

blender --background sprites_buddy.blend --python flame_preview.py -- <out.blend>

Each sprite gets a see-through flame shell a little bigger than it, drawn out
into a flame above. The shader scrolls noise upward so tongues lick off the top
and flicker; the shell is clear in the middle and glows at the rim, so the face
reads through it. A <c>_flame bone under <c>_squash (so the flame follows the
sprite and its squash, but not its spin) bends the top half: per clip it leans
away from the sprite's motion through the air (Walk and Run count as travelling
forward) on a spring, and stretches with speed. Custom properties on that bone,
keyed per clip, drive the colour: teal's flame fades as it sinks into gold, and
in Idle gold's turns green while they are merged.
"""
import math
import sys

import bpy
from mathutils import Vector

out_blend = sys.argv[sys.argv.index("--") + 1]
FPS = 30
R = 0.5
SIDE = 0.7
SPRITES = {"gold": -1, "teal": 1}
UP = Vector((0, 0, 1))
SHELL = 1.15  # flame radius round the sprite, in sprite radii
RISE = 2.1  # how far the flame's tip reaches above the shell top, in sprite radii
PALETTE = {  # (core, body, tip)
    "gold": [(1.0, 0.97, 0.70), (1.0, 0.82, 0.15), (1.0, 0.55, 0.05)],
    "teal": [(0.80, 1.0, 1.0), (0.25, 0.90, 1.0), (0.10, 0.50, 1.0)],
    "green": [(0.88, 1.0, 0.72), (0.45, 1.0, 0.30), (0.15, 0.80, 0.20)],
}
# clip -> (loops?, travel speed: the buddy moves forward (-Y) at this pace in game)
CLIPS = {
    "Idle": (True, 0.0), "Walk": (True, 1.6), "Run": (True, 4.0), "Search": (True, 0.0),
    **{k: (False, 0.0) for k in ("Jump", "Idle_Nuzzle", "Idle_Peekaboo", "Idle_Dance", "Idle_Doze",
                                 "Idle_Leapfrog")},
}
LEAN = 0.22  # lean per unit of air speed
MAX_LEAN = math.radians(55)
STIFF, DAMP = 90.0, 11.0  # flame spring (a little under critical, so it overshoots)

sc = bpy.context.scene
rig = bpy.data.objects["SpritesRig"]
arm = rig.data
pb = rig.pose.bones


def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


# --- bones ------------------------------------------------------------------------
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for c, side in SPRITES.items():
    b = arm.edit_bones.new(f"{c}_flame")
    b.head, b.tail = (side * SIDE, 0, R), (side * SIDE, 0, R + 0.3)
    b.roll = 0
    b.parent, b.use_connect = arm.edit_bones[f"{c}_squash"], False
bpy.ops.object.mode_set(mode="OBJECT")
for c in SPRITES:
    p = pb[f"{c}_flame"]
    p.rotation_mode = "QUATERNION"
    p["green"] = 0.0
    p["fade"] = 1.0


# --- shell mesh -------------------------------------------------------------------
def flame_mesh(c, side):
    centre = Vector((side * SIDE, 0, R))
    me = bpy.data.meshes.new(f"{c}_flame")
    verts, faces = [], []
    rings, segs = 32, 48
    for i in range(rings + 1):
        lat = math.pi * i / rings - math.pi / 2
        for j in range(segs):
            lon = 2 * math.pi * j / segs
            ring = Vector((math.cos(lon), math.sin(lon), 0))
            if lat <= 0:  # round bottom hugging the sprite
                p = (ring * math.cos(lat) + Vector((0, 0, math.sin(lat)))) * (SHELL * R)
            else:  # a cone up to a point: leaves the equator upright, tapers nearly straight
                t = lat / (math.pi / 2)
                p = ring * (SHELL * R * (1 - t ** 1.3) ** 1.1) + Vector((0, 0, t * (SHELL + RISE) * R))
            verts.append(centre + p)
    for i in range(rings):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    me.from_pydata(verts, [], faces)
    me.validate()
    for f in me.polygons:
        f.use_smooth = True
    ob = bpy.data.objects.new(f"{c}_flame", me)
    sc.collection.objects.link(ob)
    # Bottom half rides the sprite; the top bends with the flame bone.
    squash, flame = ob.vertex_groups.new(name=f"{c}_squash"), ob.vertex_groups.new(name=f"{c}_flame")
    for v in me.vertices:
        w = smooth((v.co.z - centre.z + 0.3 * R) / (SHELL * R + RISE * R))
        flame.add([v.index], w, "REPLACE")
        squash.add([v.index], 1 - w, "REPLACE")
    ob.parent = rig
    ob.modifiers.new("Armature", "ARMATURE").object = rig
    ob.data.materials.append(flame_material(c))
    return ob


def flame_material(c):
    mat = bpy.data.materials.new(f"{c}_flame")
    mat.use_nodes = True
    mat.surface_render_method = "BLENDED"
    mat.use_backface_culling = True
    mat.use_transparency_overlap = False
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")

    def node(kind, **inputs):
        n = nodes.new(kind)
        for k, v in inputs.items():
            if isinstance(v, bpy.types.NodeSocket):
                links.new(v, n.inputs[k])
            else:
                n.inputs[k].default_value = v
        return n

    def math_node(op, a, b=0.0, clamp=False):
        n = nodes.new("ShaderNodeMath")
        n.operation, n.use_clamp = op, clamp
        for sock, v in zip(n.inputs, (a, b)):
            if isinstance(v, bpy.types.NodeSocket):
                links.new(v, sock)
            else:
                sock.default_value = v
        return n.outputs[0]

    def driven_value(path, expr, var_bone=None):
        n = nodes.new("ShaderNodeValue")
        fc = n.outputs[0].driver_add("default_value")
        d = fc.driver
        d.type = "SCRIPTED"
        if var_bone:
            v = d.variables.new()
            v.name = "x"
            v.targets[0].id = rig
            v.targets[0].data_path = f'pose.bones["{var_bone}"]["{path}"]'
        d.expression = expr
        return n.outputs[0]

    time = driven_value(None, f"frame / {FPS}")
    green = driven_value("green", "x", f"{c}_flame")
    fade = driven_value("fade", "x", f"{c}_flame")

    coords = nodes.new("ShaderNodeTexCoord")
    sep = node("ShaderNodeSeparateXYZ", Vector=coords.outputs["Generated"])
    h = sep.outputs["Z"]  # 0 at the bottom of the shell, 1 at the flame top
    # Noise stretched tall and scrolling upward, so it reads as rising streaks.
    stretch = node("ShaderNodeVectorMath", Vector=coords.outputs["Generated"])
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (3.0, 3.0, 1.0)
    scroll = node("ShaderNodeVectorMath", Vector=stretch.outputs[0])
    scroll.operation = "SUBTRACT"
    comb = node("ShaderNodeCombineXYZ", Z=math_node("MULTIPLY", time, 1.1))
    links.new(comb.outputs[0], scroll.inputs[1])
    noise = node("ShaderNodeTexNoise", Vector=scroll.outputs[0], Scale=2.4, Detail=1.0, Roughness=0.5)
    noise.noise_dimensions = "4D"
    links.new(math_node("ADD", math_node("MULTIPLY", time, 0.45), 7.0 if c == "teal" else 0.0),
              noise.inputs["W"])
    n = node("ShaderNodeMapRange", Value=noise.outputs["Fac"], **{"From Min": 0.3, "From Max": 0.7})
    n = n.outputs["Result"]  # noise with its contrast pulled up to 0..1
    # One whole flame: it thins with height and the noise flickers its top.
    edge = math_node("ADD", math_node("SUBTRACT", 1.0, math_node("POWER", h, 1.2)),
                     math_node("MULTIPLY", math_node("SUBTRACT", n, 0.5), 0.35))
    tongue = node("ShaderNodeMapRange", Value=edge, **{"From Min": 0.0, "From Max": 0.3})
    tongue.interpolation_type = "SMOOTHSTEP"
    # Round the sprite only a flickering rim glows, so the sprite shows through
    # clearly; above it the flame fills in.
    lw = node("ShaderNodeLayerWeight", Blend=0.3)
    rim = math_node("POWER", lw.outputs["Facing"], 2.0)
    rim = math_node("MULTIPLY", rim, math_node("ADD", 0.5, math_node("MULTIPLY", n, 0.8)))
    low = node("ShaderNodeMapRange", Value=h, **{"From Min": 0.05, "From Max": 0.45})
    low.interpolation_type = "SMOOTHSTEP"  # and fades out toward the bottom
    rim = math_node("MULTIPLY", rim, low.outputs["Result"])
    above = node("ShaderNodeMapRange", Value=h, **{"From Min": 0.4, "From Max": 0.62})
    above.interpolation_type = "SMOOTHSTEP"
    # Soften the shell's outline up there so only the tongues draw the edge.
    soft = math_node("SUBTRACT", 1.0, math_node("MULTIPLY", math_node("POWER", lw.outputs["Facing"], 3.0), 0.8))
    # Inside the flame the noise only brightens and dims it (no holes, which read as soot).
    soft = math_node("MULTIPLY", soft, math_node("ADD", 0.5, math_node("MULTIPLY", n, 0.5)))
    cover = node("ShaderNodeMix", Factor=above.outputs["Result"], A=rim, B=soft)
    alpha = math_node("MULTIPLY", math_node("MULTIPLY", tongue.outputs["Result"], cover.outputs["Result"]),
                      fade, clamp=True)

    # Colour: a pale core low down to the full colour at the tips, sprite palette
    # blending to green. The glow is additive (it only ever lightens), like fire.
    def ramp(cols):
        r = nodes.new("ShaderNodeValToRGB")
        links.new(h, r.inputs["Fac"])
        el = r.color_ramp.elements
        el[0].position, el[0].color = 0.2, (*cols[0], 1)
        el[1].position, el[1].color = 0.95, (*cols[2], 1)
        mid = el.new(0.45)
        mid.color = (*cols[1], 1)
        return r.outputs["Color"]

    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    links.new(green, mix.inputs["Factor"])
    a, b = (next(i for i in mix.inputs if i.name == k and i.enabled) for k in "AB")
    links.new(ramp(PALETTE[c]), a)
    links.new(ramp(PALETTE["green"]), b)
    emit = node("ShaderNodeEmission", Color=mix.outputs["Result"], Strength=math_node("MULTIPLY", alpha, 2.2))
    clear = nodes.new("ShaderNodeBsdfTransparent")
    shader = nodes.new("ShaderNodeAddShader")
    links.new(clear.outputs[0], shader.inputs[0])
    links.new(emit.outputs[0], shader.inputs[1])
    links.new(shader.outputs[0], out.inputs["Surface"])
    return mat


for c, side in SPRITES.items():
    flame_mesh(c, side)


# --- motion: lean, stretch, colour per clip --------------------------------------------
def to_bone(w):
    """World vector to bone space (X right, Y up, Z front = Blender -Y)."""
    return Vector((w.x, w.z, -w.y))


def sample(act, frames):
    rig.animation_data.action = act
    out = []
    for f in range(frames + 1):
        sc.frame_set(f)
        out.append({c: (rig.matrix_world @ pb[f"{c}_squash"].matrix).copy() for c in SPRITES})
    return out


def merge_depth(m):
    g, t = m["gold"], m["teal"]
    rg, rt = (R * sum(x.to_scale()) / 3 for x in (g, t))
    return (rg + rt - (t.translation - g.translation).length) / (2 * rt)


def simulate(mats, travel, passes, start=None):
    """Spring the flame direction toward 'up, leaning away from the air speed'."""
    n = len(mats) - 1
    state = start or {c: [UP.copy(), Vector()] for c in SPRITES}
    state = {c: [d.copy(), v.copy()] for c, (d, v) in state.items()}
    sub = 4
    dt = 1 / (FPS * sub)
    rec, first = [], None
    for p in range(passes):
        keep = p == passes - 1
        for f in range(n + 1 if keep else n):
            if keep and f == 0:
                first = {c: [d.copy(), v.copy()] for c, (d, v) in state.items()}
            row = {}
            for c in SPRITES:
                a, b = mats[max(f - 1, 0)][c].translation, mats[min(f + 1, n)][c].translation
                vel = (b - a) / (2 / FPS) + Vector((0, -travel, 0))
                tilt = min(LEAN * vel.length, math.tan(MAX_LEAN))
                lean = vel.normalized() * -tilt if vel.length > 1e-6 else Vector()
                lean.z = 0  # only sideways motion tips it; vertical motion stretches it
                target = (UP + lean).normalized()
                d, v = state[c]
                for _ in range(sub):
                    v += ((target - d) * STIFF - v * DAMP) * dt
                    d += v * dt
                d.normalize()
                state[c] = [d, v]
                row[c] = (d.copy(), vel.length)
            if keep:
                rec.append(row)
    return rec, first


def key_clip(clip, act, mats, rec):
    rig.animation_data.action = act
    for f, row in enumerate(rec):
        depth = merge_depth(mats[f])
        for c, (d, speed) in row.items():
            b = pb[f"{c}_flame"]
            b.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(to_bone(d))
            s = 1 + min(0.06 * speed, 0.35)
            b.scale = (1 / math.sqrt(s), s, 1 / math.sqrt(s))
            b["green"] = smooth((depth - 0.35) / 0.3) if (c == "gold" and clip == "Idle") else 0.0
            b["fade"] = 1 - smooth((depth - 0.45) / 0.4) if c == "teal" else 1.0
            b.keyframe_insert("rotation_quaternion", frame=f)
            b.keyframe_insert("scale", frame=f)
            b.keyframe_insert('["green"]', frame=f)
            b.keyframe_insert('["fade"]', frame=f)


def blend_rows(rec, target, nframes, at_end):
    n = len(rec) - 1
    for k in range(nframes + 1):
        f = n - nframes + k if at_end else k
        w = smooth(k / nframes) if at_end else 1 - smooth(k / nframes)
        for c in SPRITES:
            d0, s0 = rec[f][c]
            d1, s1 = target[c]
            rec[f][c] = (d0.lerp(d1, w).normalized(), s0 + (s1 - s0) * w)


actions = {tr.name: tr.strips[0].action for tr in rig.animation_data.nla_tracks}
for tr in rig.animation_data.nla_tracks:
    tr.mute = True
idle0 = None
for clip in ["Idle"] + [k for k in CLIPS if k != "Idle"]:
    loops, travel = CLIPS[clip]
    act = actions[clip]
    frames = int(act.frame_range[1])
    mats = sample(act, frames)
    if loops:
        rec, first = simulate(mats, travel, 4)
        blend_rows(rec, rec[0], 8, True)
        if clip == "Idle":
            idle0 = (rec[0], first)
    else:
        rec, _ = simulate(mats, travel, 1, start=idle0[1])
        blend_rows(rec, idle0[0], 10, True)
        blend_rows(rec, idle0[0], 5, False)
    key_clip(clip, act, mats, rec)
    print("FLAME", clip, frames + 1)
rig.animation_data.action = None
for tr in rig.animation_data.nla_tracks:
    tr.mute = False
for b in pb:
    b.location, b.scale = (0, 0, 0), (1, 1, 1)
    b.rotation_quaternion = (1, 0, 0, 0)
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print("SAVED", out_blend)
