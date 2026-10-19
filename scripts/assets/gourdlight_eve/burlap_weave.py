# Old Thatchgrin's sackcloth up close (owner note 2026-10-18: the coat read faceted at
# arm's length). Three surface passes that leave the model's shape, rig and clips alone:
#
#   weave      a tileable burlap weave, generated here (no source image): a coarse plain
#              weave of slubby, uneven threads, the gaps between them dark, a few loose
#              fibres; written as an albedo tile (multiplied over the painted vertex
#              colour) and a matching tangent-space normal tile, so the threads catch the
#              light and the coat reads as cloth from a player's camera;
#   box UVs    every sackcloth face projected along its dominant axis at one texel
#              density, so the weave keeps one thread size over the whole body;
#   occlusion  ambient occlusion baked into the vertex colour (Cycles, in the rest pose),
#              so the folds under the arms, the collar, the belt and the skirt's overlap
#              sit in their own shade instead of reading flat.
#
# Deterministic: the weave is a pure function of its seed (numpy, no clock, no random
# module), the bake a fixed-sample Cycles pass with a fixed seed.

import math

import bpy
import numpy as np

WEAVE_PX = 512
# threads per tile in each direction (warp and weft)
WEAVE_THREADS = 12


def _hash_grid(seed, n):
    """A deterministic [0, 1) value per integer cell (n x n), from a fixed LCG."""
    out = np.empty(n * n, dtype=np.float64)
    x = (seed * 2654435761) & 0xFFFFFFFF
    for i in range(n * n):
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        out[i] = x / float(0x7FFFFFFF)
    return out.reshape(n, n)


def _smooth_noise(seed, cells, px):
    """Tileable value noise: `cells` lattice cells across a px-wide tile, smoothstepped."""
    g = _hash_grid(seed, cells)
    u = np.arange(px) / px * cells
    i0 = np.floor(u).astype(int)
    f = u - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[np.ix_(i0, i0)]
    b = g[np.ix_(i0, i1)]
    c = g[np.ix_(i1, i0)]
    d = g[np.ix_(i1, i1)]
    fx = f[None, :]
    fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def weave_tiles(seed=7):
    """(albedo, height) float arrays px x px in [0, 1]: a plain over-under burlap weave."""
    px = WEAVE_PX
    n = WEAVE_THREADS
    y, x = np.mgrid[0:px, 0:px] / px * n  # thread coordinates
    xi = np.floor(x).astype(int)
    yi = np.floor(y).astype(int)
    fx = x - xi
    fy = y - yi
    # slubs: each thread swells and thins along its length
    slub_w = _smooth_noise(seed + 1, 24, px)
    slub_h = _smooth_noise(seed + 2, 24, px).T
    # thread cross-sections (1 at a thread's middle, 0 at its edge), uneven widths
    wwarp = 0.33 + 0.16 * slub_w
    wweft = 0.33 + 0.16 * slub_h
    warp = np.clip(1.0 - np.abs(fx - 0.5) / wwarp, 0.0, 1.0) ** 0.6
    weft = np.clip(1.0 - np.abs(fy - 0.5) / wweft, 0.0, 1.0) ** 0.6
    # over-under: on even cells the warp lies on top, on odd cells the weft
    over = ((xi + yi) % 2 == 0)
    # along each crossing the top thread bows up in the middle and dips at the ends
    bow_w = np.sin(np.pi * fy) ** 0.8
    bow_h = np.sin(np.pi * fx) ** 0.8
    top_warp = warp * (0.55 + 0.45 * bow_w)
    top_weft = weft * (0.55 + 0.45 * bow_h)
    height = np.where(over, np.maximum(top_warp, top_weft * 0.55), np.maximum(top_weft, top_warp * 0.55))
    # fibres: fine hairy noise riding on the threads, more on the upper ones
    fuzz = _smooth_noise(seed + 3, 128, px)
    height = np.clip(height * (0.88 + 0.24 * fuzz), 0.0, 1.0)
    # albedo: the gaps between threads deep, each thread its own shade of jute
    shade = _smooth_noise(seed + 4, n, px)
    gap = height < 0.08
    # kept near white on average, so the painted coat keeps its tone and the weave only
    # adds its grain: threads 0.82 to 1.0, the gaps between them in shade
    alb = 0.82 + 0.18 * height
    alb = alb * (0.92 + 0.14 * shade) * (0.95 + 0.1 * fuzz)
    alb = np.where(gap, 0.6 + 0.08 * fuzz, alb)
    return np.clip(alb, 0.0, 1.0), height


def _normal_from_height(h, strength=3.0):
    """Tangent-space normal tile (OpenGL +Y) from a tileable height field."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5], axis=-1)


def _image(name, rgb, colorspace):
    px = rgb.shape[0]
    img = bpy.data.images.get(name) or bpy.data.images.new(name, px, px, alpha=False)
    img.colorspace_settings.name = colorspace
    rgba = np.ones((px, px, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def cloth_material(name="ScarecrowCloth", rough=0.97):
    """The sackcloth material: painted vertex colour times the weave, the weave's normal
    tile for its relief. glTF: baseColorTexture + normalTexture, COLOR_0 multiplied in."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    alb, h = weave_tiles()
    a_img = _image(name + "_Weave", np.repeat(alb[:, :, None], 3, axis=2), "sRGB")
    n_img = _image(name + "_WeaveNormal", _normal_from_height(h), "Non-Color")
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = a_img
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = n_img
    # both tiles read the one UV layer box_uvs writes (named, so the glTF texCoord is 0)
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(uvn.outputs["UV"], ntex.inputs["Vector"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.uv_map = "UVMap"
    nmap.inputs["Strength"].default_value = 1.0
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    attr = nt.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mul.inputs["A"])
    nt.links.new(attr.outputs["Color"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = rough
    return mat


def box_uvs(obj, tile):
    """Project every face along its dominant normal axis, `tile` metres per weave tile."""
    me = obj.data
    uv = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    data = uv.data
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                u, v = co.y, co.z
            elif ax == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            data[li].uv = (u / tile, v / tile)


def bake_occlusion(obj, strength=0.7, distance=0.6, samples=48):
    """Bake ambient occlusion into a temporary colour attribute and multiply it into the
    painted `Col` (by `strength`), then drop the temporary one. Cycles, CPU, fixed seed."""
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.seed = 11
    scene.world = scene.world or bpy.data.worlds.new("bake_world")
    scene.world.light_settings.distance = distance
    me = obj.data
    ao = me.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="CORNER")
    me.color_attributes.active_color = ao
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    scene.render.bake.target = "VERTEX_COLORS"
    bpy.ops.object.bake(type="AO")
    col = me.color_attributes["Col"]
    n = len(col.data)
    c = np.empty(n * 4, dtype=np.float32)
    a = np.empty(n * 4, dtype=np.float32)
    col.data.foreach_get("color", c)
    ao.data.foreach_get("color", a)
    c = c.reshape(n, 4)
    a = a.reshape(n, 4)
    occ = 1.0 - strength * (1.0 - np.clip(a[:, 0], 0.0, 1.0))
    c[:, :3] *= occ[:, None]
    col.data.foreach_set("color", c.ravel())
    me.color_attributes.remove(ao)
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.color_attributes.active_color_index = 0
    me.color_attributes.render_color_index = 0
    scene.render.engine = prev_engine
    return math.fsum(float(x) for x in occ) / max(1, len(occ))
