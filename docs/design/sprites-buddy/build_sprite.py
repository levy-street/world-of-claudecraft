"""Build a sprite base form (sphere + painted face) and export GLB + .blend.

blender --background --python build_sprite.py -- <name> <palette> <outdir>
Face features are authored in FRONT-VIEW orthographic coords (unit disc,
x right, y up), measured off the reference sheet, then painted into an
equirectangular texture so they match the drawing when seen from the front.
"""
import math
import sys

import bmesh
import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1 :]
name, palette, outdir = args[:3]
# "noface": leave eyes and mouth off the texture (faces.py builds them as morphable geometry).
PAINT_FACE = "noface" not in args[3:]
# "nocheeks": plain gradient only (the merged shells turn about the vertical).
PAINT_CHEEKS = "nocheeks" not in args[3:]

PALETTES = {
    "gold": dict(  # yellow
        base_lo=(1.0, 0.80, 0.06), base_hi=(1.0, 0.97, 0.45),
        feature=(1.0, 0.98, 0.78), cheek=(1.0, 0.62, 0.28), glow=(1.0, 0.96, 0.70),
    ),
    "teal": dict(
        base_lo=(0.02, 0.56, 0.66), base_hi=(0.20, 0.88, 0.84),
        feature=(0.90, 1.0, 0.92), cheek=(0.46, 0.92, 0.78), glow=(0.82, 1.0, 0.90),
    ),
    "green": dict(  # the merged sprite (gold + teal), shown while they are one
        base_lo=(0.10, 0.52, 0.10), base_hi=(0.50, 0.92, 0.28),
        feature=(0.92, 1.0, 0.80), cheek=(0.62, 0.95, 0.40), glow=(0.88, 1.0, 0.75),
    ),
}
P = PALETTES[palette]
TEX = 1024
SEG, RINGS = 48, 24  # 2,208 tris

# --- mesh: UV sphere with explicit equirectangular UVs (seam at the back) ---
bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new(name)
obj = bpy.data.objects.new(name, mesh)
bpy.context.collection.objects.link(obj)
bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new("UVMap")


def direction(lon, lat):
    # lon 0 = front (Blender -Y, glTF +Z), positive lon toward the sprite's left (+X).
    return (math.sin(lon) * math.cos(lat), -math.cos(lon) * math.cos(lat), math.sin(lat))


R = 0.5
grid = []
for r in range(RINGS + 1):
    lat = math.pi / 2 - math.pi * r / RINGS
    row = []
    for s in range(SEG + 1):
        lon = -math.pi + 2 * math.pi * s / SEG
        d = direction(lon, lat)
        row.append(bm.verts.new((d[0] * R, d[1] * R, d[2] * R + R)))  # sits on Z=0
    grid.append(row)
for r in range(RINGS):
    for s in range(SEG):
        quad = [grid[r][s], grid[r + 1][s], grid[r + 1][s + 1], grid[r][s + 1]]
        uvs = [(s / SEG, 1 - r / RINGS), (s / SEG, 1 - (r + 1) / RINGS),
               ((s + 1) / SEG, 1 - (r + 1) / RINGS), ((s + 1) / SEG, 1 - r / RINGS)]
        if r == 0:
            quad, uvs = [quad[0], quad[1], quad[2]], [((s + 0.5) / SEG, 1.0), uvs[1], uvs[2]]
        elif r == RINGS - 1:
            quad, uvs = [quad[0], quad[1], quad[3]], [uvs[0], ((s + 0.5) / SEG, 0.0), uvs[3]]
        f = bm.faces.new(quad)
        for loop, uv in zip(f.loops, uvs):
            loop[uv_layer].uv = uv
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)  # weld seam + poles (UVs stay split)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(mesh)
bm.free()
for p in mesh.polygons:
    p.use_smooth = True

# --- texture: paint per texel from its sphere direction ---
v, u = np.mgrid[0:TEX, 0:TEX]
lon = -math.pi + 2 * math.pi * (u + 0.5) / TEX
lat = -math.pi / 2 + math.pi * (v + 0.5) / TEX  # row 0 = bottom (Blender image origin)
fx = np.sin(lon) * np.cos(lat)  # front-view x (viewer's right = +X = +lon)
fy = np.sin(lat)
facing = np.cos(lon) * np.cos(lat) > 0.15

t = np.clip(0.5 + 0.5 * fy, 0, 1)[..., None] ** 1.2
col = np.array(P["base_lo"]) * (1 - t) + np.array(P["base_hi"]) * t
glow = np.zeros((TEX, TEX, 3))


def disc(cx, cy, rx, ry, soft=0.012):
    d = np.sqrt(((fx - cx) / rx) ** 2 + ((fy - cy) / ry) ** 2)
    return np.clip((1 - d) / (soft / min(rx, ry)), 0, 1) * facing


def paint(mask, rgb, alpha=1.0, emit=False):
    global col
    m = (mask * alpha)[..., None]
    col = col * (1 - m) + np.array(rgb) * m
    if emit:
        glow[:] = glow * (1 - mask[..., None]) + np.array(P["glow"]) * mask[..., None]


# Measured off the 1024 crop (sphere centre 512,512, radius ~355 px).
if PAINT_CHEEKS:
    paint(disc(-0.59, -0.25, 0.13, 0.14), P["cheek"], 0.6)
    paint(disc(0.59, -0.25, 0.13, 0.14), P["cheek"], 0.6)
for ex in (-0.455, 0.455) if PAINT_FACE else ():
    paint(disc(ex, 0.01, 0.115, 0.12), P["feature"], emit=True)
# Mouth: a chunky smile, a thick stroke along the bottom of a circle with round caps.
mcx, mcy, mr, half_arc = 0.0, 0.03, 0.23, math.radians(35)
ang = np.clip(np.arctan2(fx - mcx, mcy - fy), -half_arc, half_arc)
dist = np.hypot(fx - (mcx + mr * np.sin(ang)), fy - (mcy - mr * np.cos(ang)))
half_w = 0.068 - 0.026 * (ang / half_arc) ** 2  # thickest in the middle, tapering to the tips
mouth = np.clip((half_w - dist) / 0.006, 0, 1) * facing
if PAINT_FACE:
    paint(mouth, P["feature"], emit=True)


def make_image(label, rgb):
    img = bpy.data.images.new(f"{name}_{label}", TEX, TEX, alpha=False)
    px = np.concatenate([rgb, np.ones((TEX, TEX, 1))], axis=2).astype(np.float32)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = f"{outdir}/{name}_{label}.png"
    img.file_format = "PNG"
    img.save()
    return img


albedo = make_image("basecolor", col)
emission = make_image("emissive", glow)

mat = bpy.data.materials.new(f"{name}_mat")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
ta = nt.nodes.new("ShaderNodeTexImage")
ta.image = albedo
te = nt.nodes.new("ShaderNodeTexImage")
te.image = emission
nt.links.new(ta.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.55
mesh.materials.append(mat)

bpy.ops.wm.save_as_mainfile(filepath=f"{outdir}/{name}.blend")
bpy.ops.export_scene.gltf(filepath=f"{outdir}/{name}.glb", export_format="GLB", use_selection=False)
print("BUILT", name, len(mesh.polygons), "faces")
