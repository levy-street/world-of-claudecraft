# Review renders of the Quarryheart Charger from its authoring .blend (build_charger.py --blend).
#
#   blender --background <charger.blend> --python scripts/assets/quarryheart_charger/render_charger.py \
#     -- --out <dir> [--shots front34,side,back,core,horns,run,rear] [--size 1600x1200]
#
# EEVEE, a dark forge backdrop, a warm key and a cold rim; the emissive atlas is driven a little
# hotter than the shipped material so the stills read the way the game's bloom does.

import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


OUT = os.path.abspath(arg("--out", "tmp/quarryheart/renders"))
SHOTS = arg("--shots", "front34,side,back,core,horns").split(",")
W, H = (int(x) for x in arg("--size", "1600x1200").split("x"))
GLOW = float(arg("--glow", "2.6"))
os.makedirs(OUT, exist_ok=True)

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
sc.render.resolution_x = W
sc.render.resolution_y = H
sc.render.film_transparent = False
sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
sc.view_settings.look = "AgX - Medium High Contrast" if sc.view_settings.view_transform == "AgX" else "None"
try:
    sc.eevee.use_bloom = True
except Exception:
    pass


def add_glare():
    """Bloom for the stills (the game blooms its emissive; EEVEE no longer does)."""
    try:
        tree = bpy.data.node_groups.new("Glow", "CompositorNodeTree")
        sc.compositing_node_group = tree
        rl = tree.nodes.new("CompositorNodeRLayers")
        gl = tree.nodes.new("CompositorNodeGlare")
        for k, v in (("glare_type", "FOG_GLOW"), ("quality", "HIGH")):
            if hasattr(gl, k):
                setattr(gl, k, v)
        for name, v in (("Threshold", 0.7), ("Size", 0.75), ("Strength", 1.0), ("Saturation", 1.0)):
            if name in gl.inputs:
                gl.inputs[name].default_value = v
        if "Type" in gl.inputs:
            try:
                gl.inputs["Type"].default_value = "Bloom"
            except Exception:
                pass
        out = tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        go = tree.nodes.new("NodeGroupOutput")
        tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
        tree.links.new(gl.outputs["Image"], go.inputs[0])
        del out
        print("GLARE ok")
    except Exception as e:  # an older compositor API: render without bloom
        print("GLARE skipped", e)


sc.render.use_compositing = True
add_glare()
try:
    sc.eevee.taa_render_samples = 32
except Exception:
    pass

arm = bpy.data.objects["QuarryheartCharger"]
body = bpy.data.objects["Quarryheart"]

# hotter glow for the stills, and the wind ribbons as a soft additive-looking sheen
stone = bpy.data.materials["QuarryheartStone"]
bsdf = next(n for n in stone.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Emission Strength"].default_value = GLOW
wind = bpy.data.materials["QuarryheartWind"]
wb = next(n for n in wind.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
wt = wind.node_tree
for n in list(wt.nodes):
    if n.type != "OUTPUT_MATERIAL":
        wt.nodes.remove(n)
outn = next(n for n in wt.nodes if n.type == "OUTPUT_MATERIAL")
uvn = wt.nodes.new("ShaderNodeTexCoord")
sep = wt.nodes.new("ShaderNodeSeparateXYZ")
wt.links.new(uvn.outputs["UV"], sep.inputs["Vector"])
wave = wt.nodes.new("ShaderNodeTexWave")
wave.wave_type = "BANDS"
wave.bands_direction = "X"
wave.inputs["Scale"].default_value = 3.0
wave.inputs["Distortion"].default_value = 6.0
wt.links.new(uvn.outputs["UV"], wave.inputs["Vector"])
# fade: strongest mid-ribbon, gone at the tip, soft across the width
fade = wt.nodes.new("ShaderNodeMath")
fade.operation = "MULTIPLY"
tipf = wt.nodes.new("ShaderNodeMapRange")
tipf.inputs["From Min"].default_value = 1.0
tipf.inputs["From Max"].default_value = 0.4
wt.links.new(sep.outputs["X"], tipf.inputs["Value"])
across = wt.nodes.new("ShaderNodeMath")
across.operation = "PINGPONG"
across.inputs[1].default_value = 0.5
wt.links.new(sep.outputs["Y"], across.inputs[0])
acr = wt.nodes.new("ShaderNodeMapRange")
acr.inputs["From Min"].default_value = 0.0
acr.inputs["From Max"].default_value = 0.35
wt.links.new(across.outputs[0], acr.inputs["Value"])
wt.links.new(tipf.outputs["Result"], fade.inputs[0])
wt.links.new(acr.outputs["Result"], fade.inputs[1])
mix_streak = wt.nodes.new("ShaderNodeMath")
mix_streak.operation = "MULTIPLY"
wr = wt.nodes.new("ShaderNodeMapRange")
wr.inputs["To Min"].default_value = 0.35
wr.inputs["To Max"].default_value = 1.0
wt.links.new(wave.outputs["Fac"], wr.inputs["Value"])
wt.links.new(fade.outputs[0], mix_streak.inputs[0])
wt.links.new(wr.outputs["Result"], mix_streak.inputs[1])
em = wt.nodes.new("ShaderNodeEmission")
em.inputs["Color"].default_value = (0.62, 0.92, 1.0, 1)
em.inputs["Strength"].default_value = 3.0
tr = wt.nodes.new("ShaderNodeBsdfTransparent")
addn = wt.nodes.new("ShaderNodeAddShader")
mixn = wt.nodes.new("ShaderNodeMixShader")
wt.links.new(mix_streak.outputs[0], mixn.inputs["Fac"])
wt.links.new(tr.outputs[0], mixn.inputs[1])
wt.links.new(em.outputs[0], addn.inputs[0])
wt.links.new(tr.outputs[0], addn.inputs[1])
wt.links.new(addn.outputs[0], mixn.inputs[2])
wt.links.new(mixn.outputs[0], outn.inputs["Surface"])

world = bpy.data.worlds.new("Forge")
sc.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.012, 0.011, 0.014, 1)
bg.inputs["Strength"].default_value = 1.0

# floor: a dark slate disc so the hooves read as planted
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=9, fill_type="NGON", location=(0, 0, 0))
floor = bpy.context.active_object
fm = bpy.data.materials.new("Floor")
fm.use_nodes = True
fb = next(n for n in fm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
fb.inputs["Base Color"].default_value = (0.035, 0.032, 0.03, 1)
fb.inputs["Roughness"].default_value = 0.6
floor.data.materials.append(fm)


def light(name, kind, loc, energy, color, size=2.0, rot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if hasattr(ld, "size"):
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    sc.collection.objects.link(ob)
    ob.location = loc
    if rot:
        ob.rotation_euler = rot
    return ob


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


key = light("Key", "AREA", (-5.5, -6.0, 7.0), 1500, (1.0, 0.86, 0.7), size=4)
aim(key, (0, 0, 2.2))
rim = light("Rim", "AREA", (5.0, 6.5, 5.0), 1500, (0.55, 0.75, 1.0), size=3)
aim(rim, (0, 0, 2.6))
fill = light("Fill", "AREA", (7.0, -3.0, 2.5), 260, (0.8, 0.85, 1.0), size=5)
aim(fill, (0, 0, 2.0))

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

# Shots: (clip, frame, camera position, look-at, lens)
VIEWS = {
    "front34": ("Idle", 1, (-7.2, -8.6, 4.4), (0, -0.25, 2.45), 50),
    "side": ("Idle", 1, (-11.5, -0.2, 3.0), (0, 0.0, 2.35), 50),
    "back": ("Idle", 1, (6.0, 9.2, 4.8), (0, 0.2, 2.4), 50),
    "core": ("Idle", 1, (-3.3, -1.6, 2.4), (0.4, -0.55, 2.1), 50),
    "horns": ("Idle", 1, (-2.6, -4.2, 4.6), (0, -2.1, 3.95), 50),
    "front": ("Idle", 1, (0, -10.5, 3.2), (0, 0, 2.4), 50),
    "top": ("Idle", 1, (0.01, 0, 14), (0, 0, 2.0), 50),
    "run": ("Run", 4, (-9.5, -4.5, 3.6), (0, -0.2, 2.2), 45),
    "run2": ("Run", 12, (-9.5, -4.5, 3.6), (0, -0.2, 2.2), 45),
    "walk": ("Walk", 10, (-10.5, -2.5, 3.2), (0, 0, 2.2), 45),
    "rear": ("Rear", 16, (-10.5, -3.5, 3.4), (0, -0.2, 2.6), 45),
    "jump": ("Jump", 15, (-10.5, -2.5, 3.2), (0, 0, 2.2), 45),
    "land": ("Land", 7, (-10.5, -2.5, 3.2), (0, 0, 2.2), 45),
}

for shot in SHOTS:
    clip, frame, pos, look, lens = VIEWS[shot]
    if ":" in shot:
        pass
    arm.animation_data.action = bpy.data.actions[f"Charger|{clip}"]
    sc.frame_set(frame)
    cam.location = pos
    aim(cam, look)
    cam_data.lens = lens
    sc.render.filepath = os.path.join(OUT, f"{shot}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", shot)
