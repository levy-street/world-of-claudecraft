"""Shared forge for Lantern Hall's elemental weapon appearances (Hearthbrand, Squallcrest, the
Rimelight Staff and the Duskwick Staff), sold by the guild quartermaster for Lantern Seals.

Each build script paints its parts with a small palette of flat surfaces, models the weapon out
of the helpers below into ONE bmesh, then calls `finish`, which UV-unwraps, bakes the palette into
a single 512 albedo + ORM + a forge-grain normal map, swaps the parts for one material and writes
the GLB. That is the Season 1 skin texture set the game's weapon path and its prewarm host expect
(tests/weapon_skin_prewarm_host.test.ts: one textured, opaque, single-sided material with
base colour, metal-rough, normal and occlusion maps; POSITION, NORMAL and TEXCOORD_0 only).

The glow is never a separate material: the weapon VFX derives it from the albedo's painted texels
inside each skin's emissive window (src/render/weapon_vfx.ts, weapon_vfx_emissive_core.ts), so a
palette entry meant to burn is painted bright and saturated inside its hue window and every metal
is kept outside it (darker, or another hue).

Frames (Blender, +Z up = glTF +Y): the grip sits at the origin. Swords run from the pommel near
z -0.38 to the point near z 1.62 (VAR_SWORD clamps a held model to 2.0 tall); staves run from the
foot at z -0.91 to the crown near z 1.45 (VAR_STAFF clamps at 2.4).

Original procedural work for this project (no imported meshes, no reference art).
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


class Forge:
    """One weapon under construction: its palette, its bmesh and the shape helpers."""

    def __init__(self, name, surfaces, no_grain=(), no_bump=()):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.name = name
        self.surf = surfaces
        self.order = list(surfaces)
        self.no_grain = tuple(no_grain)
        self.no_bump = tuple(no_bump)
        self.mats = {}
        for key, (col, rough, metal) in surfaces.items():
            m = bpy.data.materials.new(f'{name}_{key}')
            m.use_nodes = True
            b = m.node_tree.nodes['Principled BSDF']
            b.inputs['Base Color'].default_value = (*[srgb_to_lin(c) for c in col], 1)
            b.inputs['Roughness'].default_value = rough
            b.inputs['Metallic'].default_value = metal
            self.mats[key] = m
        self.bm = bmesh.new()

    # -- primitives ---------------------------------------------------------------------------
    def V(self, co):
        return self.bm.verts.new(Vector(co))

    def face(self, vs, mat, smooth=False):
        f = self.bm.faces.new(vs)
        f.material_index = self.order.index(mat)
        f.smooth = smooth
        return f

    def loft(self, rings, mat, smooth=False, cap0=True, cap1=True, mats=None):
        """Join successive rings (equal-length point lists) into a closed surface. `mats` paints
        band k (between ring k and k+1) on its own."""
        vr = [[self.V(p) for p in r] for r in rings]
        n = len(rings[0])
        for k in range(len(vr) - 1):
            for i in range(n):
                j = (i + 1) % n
                self.face([vr[k][i], vr[k][j], vr[k + 1][j], vr[k + 1][i]],
                          mats[k] if mats else mat, smooth)
        if cap0:
            self.face(list(reversed(vr[0])), mats[0] if mats else mat)
        if cap1:
            self.face(vr[-1], mats[-1] if mats else mat)
        return vr

    @staticmethod
    def ring(cz, rx, ry, sides, x0=0.0, y0=0.0, rot=0.0):
        return [Vector((x0 + math.cos(rot + 2 * math.pi * i / sides) * rx,
                        y0 + math.sin(rot + 2 * math.pi * i / sides) * ry, cz)) for i in range(sides)]

    @staticmethod
    def frame(z):
        z = Vector(z).normalized()
        x = Vector((0, 0, 1)).cross(z)
        if x.length < 1e-4:
            x = Vector((1, 0, 0))
        x.normalize()
        return x, z.cross(x), z

    def tube(self, a, b, r, mat, sides=8, r2=None, smooth=True, cap=True):
        a, b = Vector(a), Vector(b)
        x, y, _ = self.frame(b - a)
        r2 = r if r2 is None else r2
        ts = [2 * math.pi * i / sides for i in range(sides)]
        ra = [a + (x * math.cos(t) + y * math.sin(t)) * r for t in ts]
        rb = [b + (x * math.cos(t) + y * math.sin(t)) * r2 for t in ts]
        self.loft([ra, rb], mat, smooth, cap, cap)

    def path_tube(self, pts, radii, mat, sides=8, smooth=True, mats=None, flat=1.0):
        """A tube along a polyline with parallel-transported frames (horns, quillons, coils).
        `flat` squashes the section along the frame's second axis (1 = round)."""
        pts = [Vector(p) for p in pts]
        tangents = []
        for i in range(len(pts)):
            a = pts[max(0, i - 1)]
            b = pts[min(len(pts) - 1, i + 1)]
            tangents.append((b - a).normalized())
        x, y, _ = self.frame(tangents[0])
        rings = []
        for i, p in enumerate(pts):
            if i > 0:
                q = tangents[i - 1].rotation_difference(tangents[i])
                x = q @ x
                y = q @ y
            r = radii[i] if isinstance(radii, (list, tuple)) else radii
            rings.append([p + (x * math.cos(t) + y * math.sin(t) * flat) * r
                          for t in (2 * math.pi * k / sides for k in range(sides))])
        return self.loft(rings, mat, smooth, True, True, mats)

    def torus(self, c, axis, R, r, mat, seg=12, sides=6):
        c = Vector(c)
        x, y, z = self.frame(axis)
        rings = []
        for i in range(seg + 1):
            t = 2 * math.pi * i / seg
            radial = x * math.cos(t) + y * math.sin(t)
            rings.append([c + radial * (R + r * math.cos(s)) + z * (r * math.sin(s))
                          for s in (2 * math.pi * k / sides for k in range(sides))])
        self.loft(rings, mat, True, False, False)

    def gem(self, c, r, h, mat, sides=8, axis=(0, 0, 1), crown=0.35):
        """A cut stone: a girdle ring, a flat-topped crown and a pointed pavilion."""
        c = Vector(c)
        x, y, z = self.frame(axis)
        ring = [c + (x * math.cos(t) + y * math.sin(t)) * r
                for t in (2 * math.pi * i / sides for i in range(sides))]
        table = [c + z * (h * crown) + (x * math.cos(t) + y * math.sin(t)) * r * 0.55
                 for t in (2 * math.pi * i / sides + math.pi / sides for i in range(sides))]
        vr = [self.V(p) for p in ring]
        vt = [self.V(p) for p in table]
        tip = self.V(c - z * h)
        for i in range(sides):
            j = (i + 1) % sides
            self.face([vr[i], vr[j], vt[i]], mat)
            self.face([vt[i], vr[j], vt[j]], mat)
            self.face([vr[j], vr[i], tip], mat)
        self.face(vt, mat)

    def shard(self, base, tip, r, mat, sides=6, taper=0.85, twist=0.0, mats=None):
        """A crystal: a faceted prism from `base` that narrows a little, then a pointed cap."""
        base, tip = Vector(base), Vector(tip)
        x, y, z = self.frame(tip - base)
        length = (tip - base).length
        body = base + z * (length * 0.72)

        def rr(p, rad, rot):
            return [p + (x * math.cos(t + rot) + y * math.sin(t + rot)) * rad
                    for t in (2 * math.pi * i / sides for i in range(sides))]
        r0 = rr(base, r, 0)
        r1 = rr(body, r * taper, twist)
        vr = self.loft([r0, r1], mat, False, True, False, mats)
        tv = self.V(tip)
        top = vr[-1]
        for i in range(sides):
            j = (i + 1) % sides
            self.face([top[i], top[j], tv], mats[-1] if mats else mat)

    def plate(self, pts2, y0, thick, face_mat, side_mat=None, plane='xz', origin=(0, 0, 0), rot=None):
        """A flat extruded plate from a 2D outline (counter-clockwise in the plate's plane),
        centred on y0 through `thick`. plane 'xz' lays it in the blade plane. `rot` (a Matrix)
        then turns it about `origin`."""
        side_mat = side_mat or face_mat
        o = Vector(origin)

        def put(u, v, w):
            p = Vector((u, w, v)) if plane == 'xz' else Vector((w, u, v))
            if rot is not None:
                p = rot @ p
            return o + p
        front = [self.V(put(u, v, y0 + thick / 2)) for u, v in pts2]
        back = [self.V(put(u, v, y0 - thick / 2)) for u, v in pts2]
        self.face(list(reversed(front)), face_mat)
        self.face(back, face_mat)
        n = len(pts2)
        for i in range(n):
            j = (i + 1) % n
            self.face([back[i], back[j], front[j], front[i]], side_mat)

    def blade(self, z0, z1, half_w, thick, steps, edge_mat, flat_mat, edge_frac=0.5,
              right_w=None, x_off=None):
        """A lozenge-section blade from z0 to z1. half_w(t) and thick(t) take t 0..1 up the blade;
        right_w(t) gives an asymmetric right edge (the left keeps half_w), x_off(t) bends the
        centreline. The outer `edge_frac` of each half paints `edge_mat` (the bright bevel)."""
        rings, mats = [], []
        for k in range(steps + 1):
            t = k / steps
            z = z0 + (z1 - z0) * t
            wl = max(half_w(t), 0.002)
            wr = max(right_w(t), 0.002) if right_w else wl
            th = max(thick(t), 0.0015)
            xo = x_off(t) if x_off else 0.0
            bl, br = min(wl * 0.24, 0.03), min(wr * 0.24, 0.03)
            rings.append([Vector((xo + x, y, z)) for x, y in (
                (wr, 0), (wr - br, th * 0.5), (wr * 0.35, th), (-wl * 0.35, th), (-wl + bl, th * 0.5),
                (-wl, 0), (-wl + bl, -th * 0.5), (-wl * 0.35, -th), (wr * 0.35, -th), (wr - br, -th * 0.5))])
            mats.append(flat_mat)
        vr = self.loft(rings, flat_mat, False, True, True, mats)
        # paint the bevel bands bright: in each ring, the faces between the edge tip and shoulder
        n = 10
        for k in range(len(vr) - 1):
            for i in (0, 4, 5, 9):
                j = (i + 1) % n
                for f in vr[k][i].link_faces:
                    if vr[k][j] in f.verts and vr[k + 1][i] in f.verts:
                        f.material_index = self.order.index(edge_mat)
        return vr

    def inlay(self, path, width, lift, mat, side=1, steps=None):
        """A painted strip laid just proud of a blade face: `path` is [(z, half_width_scale)] with
        lift(z) the face height at z (the blade's half thickness)."""
        for (z0, s0), (z1, s1) in zip(path, path[1:]):
            q = [self.V((-width(z0) * s0, side * lift(z0), z0)), self.V((width(z0) * s0, side * lift(z0), z0)),
                 self.V((width(z1) * s1, side * lift(z1), z1)), self.V((-width(z1) * s1, side * lift(z1), z1))]
            self.face(q if side > 0 else list(reversed(q)), mat)

    # -- finishing ----------------------------------------------------------------------------
    def finish(self, out, blend=None, size=512):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for key in self.order:
            me.materials.append(self.mats[key])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=1e-5)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.008)
        bpy.ops.object.mode_set(mode='OBJECT')
        print(self.name, 'verts', len(me.vertices), 'faces', len(me.polygons))

        sc = bpy.context.scene
        sc.render.engine = 'CYCLES'
        sc.cycles.samples = 4
        sc.cycles.device = 'CPU'
        albedo = self._bake(f'{self.name}_color', size,
                            lambda k: [srgb_to_lin(c) for c in self.surf[k][0]], 'sRGB', grain=True)
        orm = self._bake(f'{self.name}_orm', size, lambda k: (1.0, self.surf[k][1], self.surf[k][2]),
                         'Non-Color')
        normal = self._bake_normal(size)

        final = bpy.data.materials.new(self.name)
        final.use_nodes = True
        final.use_backface_culling = True
        nt = final.node_tree
        b = nt.nodes['Principled BSDF']
        tc = nt.nodes.new('ShaderNodeTexImage')
        tc.image = albedo
        nt.links.new(tc.outputs['Color'], b.inputs['Base Color'])
        to = nt.nodes.new('ShaderNodeTexImage')
        to.image = orm
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
        gltf_out = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        gltf_out.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        grp = nt.nodes.new('ShaderNodeGroup')
        grp.node_tree = gltf_out
        nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
        me.materials.clear()
        me.materials.append(final)
        for poly in me.polygons:
            poly.material_index = 0
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_image_format='WEBP',
                                  export_apply=True, use_selection=True)
        if blend:
            bpy.ops.wm.save_as_mainfile(filepath=blend)
        print('BUILT', out)

    def _grain(self, nt, base_rgb):
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 38.0
        noise.inputs['Detail'].default_value = 6.0
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0, 1.0, 0.18)
        tcn = nt.nodes.new('ShaderNodeTexCoord')
        nt.links.new(tcn.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], noise.inputs['Vector'])
        return noise

    def _bake(self, img_name, size, value_of, colorspace, grain=False):
        img = bpy.data.images.new(img_name, size, size, alpha=False)
        img.colorspace_settings.name = colorspace
        saved = {}
        for key, m in self.mats.items():
            nt = m.node_tree
            out = nt.nodes['Material Output']
            saved[key] = out.inputs['Surface'].links[0].from_socket
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (*value_of(key), 1)
            if grain and not key.startswith(self.no_grain):
                # forge grain: a fine streaked noise, so metal and wood read as worked surfaces
                noise = self._grain(nt, value_of(key))
                mr = nt.nodes.new('ShaderNodeMapRange')
                mr.inputs['To Min'].default_value = 0.8
                mr.inputs['To Max'].default_value = 1.16
                nt.links.new(noise.outputs['Fac'], mr.inputs['Value'])
                mul = nt.nodes.new('ShaderNodeMix')
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                mul.inputs['Factor'].default_value = 1.0
                mul.inputs['A'].default_value = (*value_of(key), 1)
                nt.links.new(mr.outputs['Result'], mul.inputs['B'])
                nt.links.new(mul.outputs['Result'], em.inputs['Color'])
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            nt.nodes.active = tex
        bpy.ops.object.bake(type='EMIT', margin=4)
        for key, m in self.mats.items():
            nt = m.node_tree
            nt.links.new(saved[key], nt.nodes['Material Output'].inputs['Surface'])
        return img

    def _bake_normal(self, size):
        img = bpy.data.images.new(f'{self.name}_normal', size, size, alpha=False)
        img.colorspace_settings.name = 'Non-Color'
        for key, m in self.mats.items():
            nt = m.node_tree
            bsdf = nt.nodes['Principled BSDF']
            noise = self._grain(nt, None)
            bump = nt.nodes.new('ShaderNodeBump')
            bump.inputs['Strength'].default_value = 0.0 if key.startswith(self.no_bump) else 0.12
            nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
            nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            nt.nodes.active = tex
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=4)
        return img


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Z')


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Y')


def lerp(a, b, t):
    return a + (b - a) * t


__all__ = ['Forge', 'srgb_to_lin', 'rot_z', 'rot_y', 'lerp', 'Quaternion', 'Vector', 'Matrix']
