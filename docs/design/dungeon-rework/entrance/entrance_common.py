"""Shared scaffolding for the world-entrance set pieces.

Coordinates. The game: +z north, +x WEST, y up. Blender here: X = game x
(minus the door x), Y = -(game z - door z), Z = game y - door terrain y. So a
glTF export with +Y up gives (x, y, z) = game local axes directly, and the GLB
origin is the door at its sampled terrain height (rot 0).

Helpers take LOCAL GAME coords (lx = west, lz = north, y up) and convert.
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

BLENDER_KNIGHT = 'E:/woc/crypt-work/morthen-v2/out/knight_plain.glb'


def B(lx, lz, y=0.0):
    """Local game (west, north, up) to a Blender vector."""
    return Vector((lx, -lz, y))


class Ground:
    """Bilinear sampler over the probe's fine grid (terrainHeight) with the
    coarse grid as the fallback, both relative to the door."""

    def __init__(self, path):
        with open(path) as f:
            g = json.load(f)
        self.raw = g
        self.door = g['door']
        self.dx, self.dz = self.door['x'], self.door['z']
        self.dy = self.door['terrainY']
        self.fine = g['fineTerrain']
        self.fineG = g['fineGround']
        self.coarse = g['coarseTerrain']
        self.water = g.get('waterLevel')

    @staticmethod
    def _sample(grid, gx, gz):
        fx = (gx - grid['originX']) / grid['step']
        fz = (gz - grid['originZ']) / grid['step']
        n = grid['n']
        if fx < 0 or fz < 0 or fx > n - 1 or fz > n - 1:
            return None
        i0, j0 = int(math.floor(fx)), int(math.floor(fz))
        i1, j1 = min(i0 + 1, n - 1), min(j0 + 1, n - 1)
        tx, tz = fx - i0, fz - j0
        r = grid['rows']
        a = r[j0][i0] * (1 - tx) + r[j0][i1] * tx
        b = r[j1][i0] * (1 - tx) + r[j1][i1] * tx
        return a * (1 - tz) + b * tz

    def h(self, lx, lz):
        """Terrain height (relative to the door) at local game coords."""
        gx, gz = self.dx + lx, self.dz + lz
        v = self._sample(self.fine, gx, gz)
        if v is None:
            v = self._sample(self.coarse, gx, gz)
        if v is None:
            v = self.dy
        return v - self.dy

    def walk(self, lx, lz):
        v = self._sample(self.fineG, self.dx + lx, self.dz + lz)
        return (v - self.dy) if v is not None else self.h(lx, lz)

    def minmax(self, pts):
        hs = [self.h(x, z) for (x, z) in pts]
        return min(hs), max(hs)

    def footprint_range(self, cx, cz, hw, hd, rot=0.0, step=0.5):
        """Min and max ground under an OBB (local game coords, rot = yaw)."""
        c, s = math.cos(rot), math.sin(rot)
        lo, hi = 1e9, -1e9
        nx = max(1, int(hw * 2 / step))
        nz = max(1, int(hd * 2 / step))
        for i in range(nx + 1):
            for j in range(nz + 1):
                u = -hw + 2 * hw * i / nx
                v = -hd + 2 * hd * j / nz
                x = cx + u * c + v * s
                z = cz - u * s + v * c
                y = self.h(x, z)
                lo, hi = min(lo, y), max(hi, y)
        return lo, hi


def srgb(c):
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def _hash(x, z):
    h = math.sin(x * 127.1 + z * 311.7) * 43758.5453
    return h - math.floor(h)


def _vn(x, z):
    xi, zi = math.floor(x), math.floor(z)
    xf, zf = x - xi, z - zi
    u, v = xf * xf * (3 - 2 * xf), zf * zf * (3 - 2 * zf)
    a, b = _hash(xi, zi), _hash(xi + 1, zi)
    c, d = _hash(xi, zi + 1), _hash(xi + 1, zi + 1)
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v


def fbm2(x, z):
    return (_vn(x, z) * 2 + _vn(x * 2.1 + 13, z * 2.1 - 7)) / 3


def vertex_color_material(name, rough=0.9, metal=0.0, emission=0.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    if emission:
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emission
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            mat.surface_render_method = 'BLENDED'
        except Exception:
            pass
    return mat


def emissive_material(name, color, strength=8.0, alpha=1.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1.0)
    em.inputs['Strength'].default_value = strength
    if alpha < 1.0:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        mix.inputs['Fac'].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])
        try:
            mat.surface_render_method = 'BLENDED'
        except Exception:
            pass
    else:
        nt.links.new(em.outputs[0], out.inputs['Surface'])
    return mat


def volume_fog_material(name, color, density=0.05):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    vol = nt.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (*color, 1.0)
    vol.inputs['Density'].default_value = density
    nt.links.new(vol.outputs[0], out.inputs['Volume'])
    return mat


TERRAIN_PALETTES = {
    # (low grass, high grass, rock, dirt, wet/dark)
    'thornpeak': ((0.36, 0.40, 0.25), (0.45, 0.46, 0.31), (0.47, 0.45, 0.43), (0.42, 0.36, 0.28),
                  (0.24, 0.24, 0.23)),
    'vale': ((0.33, 0.48, 0.22), (0.42, 0.55, 0.27), (0.52, 0.50, 0.46), (0.45, 0.37, 0.26),
             (0.22, 0.26, 0.17)),
    'fen': ((0.27, 0.33, 0.20), (0.33, 0.38, 0.24), (0.40, 0.40, 0.36), (0.30, 0.27, 0.20),
            (0.16, 0.18, 0.14)),
    'palm': ((0.30, 0.46, 0.20), (0.38, 0.52, 0.24), (0.55, 0.52, 0.44), (0.68, 0.60, 0.44),
             (0.20, 0.26, 0.15)),
}


def build_terrain(gr, palette='thornpeak', name='Terrain', paths=()):
    """Fine 0.5 yd mesh (the sampled grid) plus the coarse 2 yd surround with a
    hole under the fine patch. Vertex colours by slope, noise and paths."""
    pal = TERRAIN_PALETTES[palette]
    mat = vertex_color_material('TerrainMat', rough=0.95)
    objs = []
    for label, grid, hole in (('Fine', gr.fine, None), ('Coarse', gr.coarse, gr.fine)):
        bm = bmesh.new()
        col = bm.loops.layers.color.new('Col')
        n = grid['n']
        st = grid['step']
        verts = []
        for j in range(n):
            row = []
            for i in range(n):
                gx = grid['originX'] + i * st
                gz = grid['originZ'] + j * st
                y = grid['rows'][j][i] - gr.dy
                row.append(bm.verts.new(B(gx - gr.dx, gz - gr.dz, y)))
            verts.append(row)
        if hole:
            hx0 = hole['originX'] + 2 * st
            hz0 = hole['originZ'] + 2 * st
            hx1 = hole['originX'] + (hole['n'] - 1) * hole['step'] - 2 * st
            hz1 = hole['originZ'] + (hole['n'] - 1) * hole['step'] - 2 * st
        for j in range(n - 1):
            for i in range(n - 1):
                if hole:
                    gx0 = grid['originX'] + i * st
                    gz0 = grid['originZ'] + j * st
                    if gx0 >= hx0 and gx0 + st <= hx1 and gz0 >= hz0 and gz0 + st <= hz1:
                        continue
                f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
                f.smooth = True
        bm.normal_update()
        for f in bm.faces:
            for loop in f.loops:
                v = loop.vert
                lx, lz = v.co.x, -v.co.y
                nrm = v.normal
                if nrm.z < 0:
                    nrm = -nrm
                slope = 1 - nrm.z
                nz = fbm2(lx * 0.15, lz * 0.15)
                fine = fbm2(lx * 0.9 + 5, lz * 0.9 - 3)
                gcol = [pal[0][k] + (pal[1][k] - pal[0][k]) * nz for k in range(3)]
                rock_t = max(0.0, min(1.0, (slope - 0.18) * 4.0 + (fine - 0.5) * 0.6))
                c = [gcol[k] * (1 - rock_t) + pal[2][k] * rock_t for k in range(3)]
                dirt_t = max(0.0, (fine - 0.62) * 2.5) * (1 - rock_t)
                for (pts, width) in paths:
                    d = _dist_polyline(lx, lz, pts)
                    if d < width:
                        dirt_t = max(dirt_t, min(1.0, (width - d) / (width * 0.5)) * 0.85)
                c = [c[k] * (1 - dirt_t) + pal[3][k] * dirt_t for k in range(3)]
                k = 0.88 + 0.22 * fine
                c = [min(1.0, x * k) for x in c]
                loop[col] = (*c, 1.0)
        mesh = bpy.data.meshes.new(name + label)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(name + label, mesh)
        bpy.context.scene.collection.objects.link(obj)
        objs.append(obj)
    return objs


def _dist_polyline(x, z, pts):
    best = 1e9
    for (a, b) in zip(pts, pts[1:]):
        ax, az = a
        bx, bz = b
        dx, dz = bx - ax, bz - az
        L = dx * dx + dz * dz
        t = 0.0 if L == 0 else max(0.0, min(1.0, ((x - ax) * dx + (z - az) * dz) / L))
        px, pz = ax + dx * t, az + dz * t
        best = min(best, math.hypot(x - px, z - pz))
    return best


def import_knight(gr, lx, lz, yaw_deg=0.0, name='Knight'):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=BLENDER_KNIGHT)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    holder = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(holder)
    for r in roots:
        r.parent = holder
    bpy.context.view_layer.update()
    lo, hi = 1e9, -1e9
    for o in new:
        if o.type == 'MESH':
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                lo, hi = min(lo, w.z), max(hi, w.z)
    kmat = bpy.data.materials.get('KnightTint') or bpy.data.materials.new('KnightTint')
    kmat.use_nodes = True
    kb = kmat.node_tree.nodes['Principled BSDF']
    kb.inputs['Base Color'].default_value = (0.42, 0.45, 0.52, 1)
    kb.inputs['Metallic'].default_value = 0.5
    kb.inputs['Roughness'].default_value = 0.45
    for o in new:
        if o.type == 'MESH':
            o.data.materials.clear()
            o.data.materials.append(kmat)
    s = 2.6 / max(0.1, hi - lo)
    holder.scale = (s, s, s)
    holder.location = B(lx, lz, gr.walk(lx, lz) - lo * s)
    holder.rotation_euler = (0, 0, math.radians(yaw_deg))
    return holder


def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def add_camera(name, loc, target, lens=35, ortho=None):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.clip_end = 4000
    data.clip_start = 0.1
    if ortho:
        data.type = 'ORTHO'
        data.ortho_scale = ortho
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    look_at(cam, target)
    return cam


def setup_world(sky='storm', strength=1.0, sun_dir=(-0.4, 0.5, 0.75), sun_strength=3.0,
                sun_color=(1.0, 0.95, 0.88), mist=None):
    scene = bpy.context.scene
    world = bpy.data.worlds.new('World') if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    grad = nt.nodes.new('ShaderNodeValToRGB')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    skies = {
        'storm': ((0.52, 0.56, 0.62), (0.36, 0.41, 0.50)),
        'day': ((0.55, 0.66, 0.80), (0.30, 0.48, 0.78)),
        'fog': ((0.50, 0.54, 0.52), (0.40, 0.44, 0.45)),
        'dusk': ((0.62, 0.52, 0.48), (0.20, 0.24, 0.40)),
        'night': ((0.07, 0.08, 0.13), (0.02, 0.025, 0.05)),
    }
    lo, hi = skies[sky]
    grad.color_ramp.elements[0].color = (*srgb(lo), 1)
    grad.color_ramp.elements[1].color = (*srgb(hi), 1)
    grad.color_ramp.elements[0].position = 0.5
    grad.color_ramp.elements[1].position = 0.75
    nt.links.new(sep.outputs['Z'], grad.inputs['Fac'])
    nt.links.new(grad.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    if mist:
        vol = nt.nodes.new('ShaderNodeVolumePrincipled')
        vol.inputs['Density'].default_value = mist[0]
        vol.inputs['Color'].default_value = (*srgb(mist[1]), 1)
        nt.links.new(vol.outputs[0], out.inputs['Volume'])
    sd = bpy.data.lights.new('Sun', 'SUN')
    sd.energy = sun_strength
    sd.color = sun_color
    sd.angle = math.radians(3)
    sun = bpy.data.objects.new('Sun', sd)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector(sun_dir).to_track_quat('Z', 'Y').to_euler()
    return sun


def setup_eevee(res=(1920, 1080), samples=48):
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    ee = scene.eevee
    ee.taa_render_samples = samples
    for attr, val in (('use_shadows', True), ('use_raytracing', True), ('shadow_ray_count', 2),
                      ('use_volumetric_shadows', True), ('volumetric_tile_size', '4'),
                      ('volumetric_end', 300.0)):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
    scene.view_settings.view_transform = 'AgX'
    try:
        scene.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        pass
    scene.render.film_transparent = False
    try:
        scene.render.compositor_device = 'GPU'
    except Exception:
        pass


def setup_workbench(res=(1600, 1600), bg=(0.12, 0.12, 0.13), color='VERTEX', light='STUDIO'):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = 'Standard'
    try:
        scene.view_settings.look = 'None'
    except Exception:
        pass
    sh = scene.display.shading
    sh.light = light
    sh.color_type = color
    sh.show_cavity = False
    sh.show_shadows = False
    sh.background_type = 'VIEWPORT'
    sh.background_color = bg


def render(cam, path):
    scene = bpy.context.scene
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('RENDERED', path)


def flat_mat(name, rgb, emission=1.0):
    """Unlit-ish marker material (emission) so maps read in any engine."""
    return emissive_material(name, srgb(rgb), strength=emission)


def marker_disc(name, lx, lz, y, r, rgb, height=0.15, ring=False, sides=32):
    bm = bmesh.new()
    if ring:
        bmesh.ops.create_circle(bm, cap_ends=False, radius=r, segments=sides)
        edges = list(bm.edges)
        geom = bmesh.ops.extrude_edge_only(bm, edges=edges)
        nv = [g for g in geom['geom'] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.scale(bm, vec=(1 - 0.22 / r, 1 - 0.22 / r, 1), verts=nv)
    else:
        bmesh.ops.create_circle(bm, cap_ends=True, radius=r, segments=sides)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = B(lx, lz, y + height)
    obj.data.materials.append(flat_mat('M_' + name[:40], rgb))
    return obj


def marker_box(name, lx, lz, y, hw, hd, rot, rgb, height=0.2, outline=True):
    """An OBB outline (collider footprint) in local game coords; rot is the
    three.js yaw (rotation.y), which in Blender is a rotation about +Z by the
    same angle (game z flips to -Y, and x stays)."""
    bm = bmesh.new()
    pts = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    vs = [bm.verts.new((x, -z, 0)) for (x, z) in pts]
    if outline:
        inner = [bm.verts.new((x * (1 - 0.18 / max(hw, 0.2)), -z * (1 - 0.18 / max(hd, 0.2)), 0)) for (x, z) in pts]
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((vs[i], vs[j], inner[j], inner[i]))
    else:
        bm.faces.new(vs)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = B(lx, lz, y + height)
    obj.rotation_euler = (0, 0, rot)
    obj.data.materials.append(flat_mat('M_' + name[:40], rgb))
    return obj


def polyline_tube(name, pts3, r, rgb, emission=1.0):
    """pts3 in Blender coords."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts3) - 1)
    for p, c in zip(sp.points, pts3):
        p.co = (c[0], c[1], c[2], 1)
    cu.bevel_depth = r
    cu.bevel_resolution = 1
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(flat_mat('M_' + name[:40], rgb, emission))
    return obj


def text_label(name, text, lx, lz, y, size=1.2, rgb=(1, 1, 1), rot_z=math.pi):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = B(lx, lz, y)
    obj.rotation_euler = (0, 0, rot_z)
    obj.data.materials.append(flat_mat('M_txt_' + name[:30], rgb, 1.0))
    return obj


def contour_lines(gr, half, interval=1.0, rgb=(0.85, 0.85, 0.85), y_off=0.06, name='Contours'):
    """Marching-squares contour segments over the fine grid, as one mesh of
    thin quads draped on the terrain."""
    g = gr.fine
    n, st = g['n'], g['step']
    rows = g['rows']
    bm = bmesh.new()
    lo = min(min(r) for r in rows) - gr.dy
    hi = max(max(r) for r in rows) - gr.dy
    levels = [interval * k for k in range(int(math.floor(lo / interval)), int(math.ceil(hi / interval)) + 1)]
    w = 0.06
    for j in range(n - 1):
        for i in range(n - 1):
            x0 = g['originX'] + i * st - gr.dx
            z0 = g['originZ'] + j * st - gr.dz
            if abs(x0) > half or abs(z0) > half:
                continue
            c = [(x0, z0, rows[j][i] - gr.dy), (x0 + st, z0, rows[j][i + 1] - gr.dy),
                 (x0 + st, z0 + st, rows[j + 1][i + 1] - gr.dy), (x0, z0 + st, rows[j + 1][i] - gr.dy)]
            for L in levels:
                pts = []
                for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
                    ha, hb = c[a][2], c[b][2]
                    if (ha - L) * (hb - L) < 0:
                        t = (L - ha) / (hb - ha)
                        pts.append((c[a][0] + (c[b][0] - c[a][0]) * t, c[a][1] + (c[b][1] - c[a][1]) * t))
                if len(pts) >= 2:
                    (ax, az), (bx, bz) = pts[0], pts[1]
                    dx, dz = bx - ax, bz - az
                    ln = math.hypot(dx, dz) or 1
                    px, pz = -dz / ln * w, dx / ln * w
                    vs = [bm.verts.new(B(ax + px, az + pz, L + y_off)), bm.verts.new(B(bx + px, bz + pz, L + y_off)),
                          bm.verts.new(B(bx - px, bz - pz, L + y_off)), bm.verts.new(B(ax - px, az - pz, L + y_off))]
                    bm.faces.new(vs)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(flat_mat('M_contour', rgb, 0.6))
    return obj


def count_tris(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in objs:
        if o.type != 'MESH':
            continue
        m = o.evaluated_get(dg).to_mesh()
        m.calc_loop_triangles()
        total += len(m.loop_triangles)
    return total


def export_glb(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=True,
    )
    print('WROTE', path, os.path.getsize(path))


def gap_report(gr, obj_bases, step=0.25):
    """For each (name, lx, lz, hw, hd, rot, base_y_local_bottom) footing, the
    worst gap (ground minus footing bottom: negative = floating above ground)."""
    out = []
    for (name, cx, cz, hw, hd, rot, bottom) in obj_bases:
        lo, hi = gr.footprint_range(cx, cz, hw, hd, rot, step)
        out.append({'name': name, 'groundMin': round(lo, 3), 'groundMax': round(hi, 3),
                    'bottom': round(bottom, 3), 'buriedMin': round(lo - bottom, 3),
                    'ok': lo - bottom >= 0.0})
    return out


def set_glare(on):
    """Bloom through the compositor (Blender 5 node-group API, with the 4.x
    fallback); silently skipped when neither is available."""
    scene = bpy.context.scene
    try:
        if not on:
            scene.render.use_compositing = False
            return
        scene.render.use_compositing = True
        if hasattr(scene, 'compositing_node_group'):
            ng = bpy.data.node_groups.get('EntranceGlare')
            if ng is None:
                ng = bpy.data.node_groups.new('EntranceGlare', 'CompositorNodeTree')
                ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
                rl = ng.nodes.new('CompositorNodeRLayers')
                gl = ng.nodes.new('CompositorNodeGlare')
                out = ng.nodes.new('NodeGroupOutput')
                try:
                    gl.glare_type = 'BLOOM'
                except Exception:
                    try:
                        gl.inputs['Type'].default_value = 'Bloom'
                    except Exception:
                        pass
                for key, val in (('Threshold', 1.0), ('Strength', 0.8), ('Size', 0.6)):
                    try:
                        gl.inputs[key].default_value = val
                    except Exception:
                        pass
                ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
                ng.links.new(gl.outputs['Image'], out.inputs[0])
            scene.compositing_node_group = ng
        else:
            scene.use_nodes = True
            nt = scene.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            rl = nt.nodes.new('CompositorNodeRLayers')
            gl = nt.nodes.new('CompositorNodeGlare')
            gl.glare_type = 'FOG_GLOW'
            gl.threshold = 1.0
            comp = nt.nodes.new('CompositorNodeComposite')
            nt.links.new(rl.outputs['Image'], gl.inputs['Image'])
            nt.links.new(gl.outputs['Image'], comp.inputs['Image'])
    except Exception as e:
        print('GLARE_SKIPPED', e)
