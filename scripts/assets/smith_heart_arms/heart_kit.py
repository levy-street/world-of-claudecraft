"""Shared forge for the Smith's Heart raid weapon appearances: Seamcaller (the Hammer Council's
maul), Squallcrest (the Breath), the Rimelight Staff (the Quench), Hearthbrand (the Heat) and the
Heartmeld Staff (the Masterless Strength).

Builds on the Lantern Hall arms kit (scripts/assets/lantern_hall_arms/arms_kit.py, the same
single-material GLB contract the weapon path and its prewarm host expect: one textured, opaque,
single-sided material with base colour, metal-rough, normal and occlusion maps; POSITION, NORMAL
and TEXCOORD_0 only) and adds what a raid showpiece needs on top:

- a painted albedo: every non-glowing surface is baked with ambient occlusion folded in (crevices
  and recesses darken, the way a hand-painted texture shades them) and a soft edge light on
  convex corners (Cycles pointiness), so a silhouette reads at gameplay distance without a
  second material;
- quarry helpers: displaced rock chunks, chamfered blocks, faceted crystals and rune glyph
  plates laid onto a face;
- a 1024 texture set, so the painted runes and veins stay crisp in the Armory preview.

The glow is still never a separate material: the weapon VFX derives it from the albedo texels
inside each skin's emissive window (src/render/weapon_vfx.ts). A palette entry meant to burn is
listed in `glow` (never shaded, never grained) and painted bright and saturated inside its hue
window; every metal and stone is kept outside it (darker, or another hue).

Frames (Blender, +Z up = glTF +Y): the grip sits at the origin.

Original procedural work for this project (no imported meshes, no reference art).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'lantern_hall_arms'))
from arms_kit import Forge, lerp, rot_y, rot_z, srgb_to_lin  # noqa: E402,F401


class HeartForge(Forge):
    """A Forge whose albedo bake is painted: AO in the recesses, light on the edges."""

    def __init__(self, name, surfaces, glow=(), no_bump=(), ao=0.55, edge=0.22):
        super().__init__(name, surfaces, no_grain=tuple(glow), no_bump=tuple(no_bump) + tuple(glow))
        self.glow = tuple(glow)
        self.ao = ao
        self.edge = edge

    # -- shape helpers ------------------------------------------------------------------------
    def _faces_since(self, before):
        self.bm.faces.ensure_lookup_table()
        return [f for f in self.bm.faces if f not in before]

    def paint(self, faces, mat, smooth=False):
        idx = self.order.index(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth

    def rock(self, c, r, mat, seed, squash=(1.0, 1.0, 1.0), rough=0.28, subdiv=1, rot=None):
        """A hewn stone chunk: an icosphere whose corners are knocked about, flat shaded."""
        rng = random.Random(seed)
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(c))
        if rot is not None:
            m = m @ rot.to_4x4()
        m = m @ Matrix.Diagonal((*squash, 1.0))
        out = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=r, matrix=m)
        centre = Vector(c)
        for v in out['verts']:
            d = v.co - centre
            v.co = centre + d * (1 + rng.uniform(-rough, rough * 0.6))
        faces = self._faces_since(before)
        self.paint(faces, mat)
        return faces

    def block(self, c, size, mat, bevel=0.02, rot=None, segs=1, mats_by_normal=None):
        """A chamfered box. `mats_by_normal` [(axis vector, mat)] repaints the faces whose
        normal points along a given axis (a striking face, a band)."""
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(c))
        if rot is not None:
            m = m @ rot.to_4x4()
        m = m @ Matrix.Diagonal((*size, 1.0))
        out = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        vs = out['verts']
        es = list({e for v in vs for e in v.link_edges})
        if bevel > 0:
            bmesh.ops.bevel(self.bm, geom=vs + es, offset=bevel, segments=segs, affect='EDGES',
                            profile=0.5, clamp_overlap=True)
        faces = self._faces_since(before)
        self.paint(faces, mat)
        if mats_by_normal:
            for f in faces:
                f.normal_update()
                for axis, mt in mats_by_normal:
                    if f.normal.dot(Vector(axis).normalized()) > 0.92:
                        f.material_index = self.order.index(mt)
        return faces

    def crystal(self, base, tip, r, mat, sides=6, seed=0, mats=None, waist=1.12):
        """A clear-cut crystal: a slightly swelling hexagonal prism with a pointed cap, its cap
        facets a second paint so the cut catches light."""
        base, tip = Vector(base), Vector(tip)
        x, y, z = self.frame(tip - base)
        length = (tip - base).length
        rng = random.Random(seed)
        rot = rng.uniform(0, math.pi)

        def ring(p, rad):
            return [p + (x * math.cos(t + rot) + y * math.sin(t + rot)) * rad
                    for t in (2 * math.pi * i / sides for i in range(sides))]
        r0 = ring(base, r * 0.82)
        r1 = ring(base + z * (length * 0.35), r * waist)
        r2 = ring(base + z * (length * 0.7), r)
        m0 = mats[0] if mats else mat
        m1 = mats[1] if mats else mat
        vr = self.loft([r0, r1, r2], m0, False, True, False)
        tv = self.V(tip)
        top = vr[-1]
        for i in range(sides):
            j = (i + 1) % sides
            self.face([top[i], top[j], tv], m1)

    def glyph(self, origin, u, v, size, mat, seed, lift=0.004, normal=None, width=0.16):
        """A rune glyph laid on a face: three to five straight strokes on a 3x3 lattice, picked by
        seed so no two glyphs match. `u`, `v` are the face's in-plane axes, `normal` its outward
        normal (the strokes sit `lift` proud of it)."""
        o, u, v = Vector(origin), Vector(u).normalized(), Vector(v).normalized()
        n = Vector(normal).normalized() if normal else u.cross(v).normalized()
        rng = random.Random(seed)
        lattice = [(i, j) for i in (-1, 0, 1) for j in (-1, 0, 1)]
        strokes = [((0, -1), (0, 1))]  # every glyph has a stem
        for _ in range(rng.randint(2, 4)):
            a = rng.choice(lattice)
            b = rng.choice([p for p in lattice if p != a and abs(p[0] - a[0]) <= 1 and abs(p[1] - a[1]) <= 2])
            strokes.append((a, b))
        w = size * width
        for (ai, aj), (bi, bj) in strokes:
            pa = o + u * (ai * size * 0.5) + v * (aj * size * 0.5) + n * lift
            pb = o + u * (bi * size * 0.5) + v * (bj * size * 0.5) + n * lift
            d = (pb - pa)
            if d.length < 1e-6:
                continue
            side = d.normalized().cross(n).normalized() * (w * 0.5)
            ext = d.normalized() * (w * 0.5)
            q = [self.V(pa - ext - side), self.V(pa - ext + side), self.V(pb + ext + side), self.V(pb + ext - side)]
            f = self.face(q, mat)
            f.normal_update()
            if f.normal.dot(n) < 0:
                f.normal_flip()

    def mark(self):
        """A marker for `scale_since`: the vertices built so far."""
        return set(self.bm.verts)

    def scale_since(self, marker, origin, sxy, sz):
        """Scale everything built since `marker` about `origin` (a part sized up as a whole)."""
        o = Vector(origin)
        for v in self.bm.verts:
            if v not in marker:
                d = v.co - o
                v.co = o + Vector((d.x * sxy, d.y * sxy, d.z * sz))

    def ring_band(self, cz, rx, ry, h, mat, sides=12, flare=0.0, rot=0.0):
        """A short raised band round a shaft (a collar), slightly flared."""
        self.loft([self.ring(cz - h / 2, rx, ry, sides, rot=rot),
                   self.ring(cz, rx * (1 + flare), ry * (1 + flare), sides, rot=rot),
                   self.ring(cz + h / 2, rx, ry, sides, rot=rot)], mat, True)

    # -- painted bake -------------------------------------------------------------------------
    def _bake(self, img_name, size, value_of, colorspace, grain=False):
        if not grain:
            return super()._bake(img_name, size, value_of, colorspace, grain)
        # the albedo: forge grain as before, then AO into the recesses and light on the edges,
        # for every surface that is not meant to glow
        img = bpy.data.images.new(img_name, size, size, alpha=False)
        img.colorspace_settings.name = colorspace
        saved = {}
        for key, m in self.mats.items():
            nt = m.node_tree
            out = nt.nodes['Material Output']
            saved[key] = out.inputs['Surface'].links[0].from_socket
            em = nt.nodes.new('ShaderNodeEmission')
            col = (*value_of(key), 1)
            if key.startswith(self.glow):
                em.inputs['Color'].default_value = col
            else:
                noise = self._grain(nt, value_of(key))
                mr = nt.nodes.new('ShaderNodeMapRange')
                mr.inputs['To Min'].default_value = 0.82
                mr.inputs['To Max'].default_value = 1.14
                nt.links.new(noise.outputs['Fac'], mr.inputs['Value'])
                mul = nt.nodes.new('ShaderNodeMix')
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                mul.inputs['Factor'].default_value = 1.0
                mul.inputs['A'].default_value = col
                nt.links.new(mr.outputs['Result'], mul.inputs['B'])
                # ambient occlusion, eased so open faces keep their colour
                ao = nt.nodes.new('ShaderNodeAmbientOcclusion')
                ao.inputs['Distance'].default_value = 0.06
                ao.samples = 16
                aor = nt.nodes.new('ShaderNodeMapRange')
                aor.inputs['To Min'].default_value = 1.0 - self.ao
                aor.inputs['To Max'].default_value = 1.0
                nt.links.new(ao.outputs['AO'], aor.inputs['Value'])
                mul2 = nt.nodes.new('ShaderNodeMix')
                mul2.data_type = 'RGBA'
                mul2.blend_type = 'MULTIPLY'
                mul2.inputs['Factor'].default_value = 1.0
                nt.links.new(mul.outputs['Result'], mul2.inputs['A'])
                nt.links.new(aor.outputs['Result'], mul2.inputs['B'])
                # convex edges catch a painted highlight
                geo = nt.nodes.new('ShaderNodeNewGeometry')
                er = nt.nodes.new('ShaderNodeMapRange')
                er.inputs['From Min'].default_value = 0.5
                er.inputs['From Max'].default_value = 0.62
                er.inputs['To Min'].default_value = 0.0
                er.inputs['To Max'].default_value = self.edge
                nt.links.new(geo.outputs['Pointiness'], er.inputs['Value'])
                add = nt.nodes.new('ShaderNodeMix')
                add.data_type = 'RGBA'
                add.blend_type = 'SCREEN'
                nt.links.new(er.outputs['Result'], add.inputs['Factor'])
                nt.links.new(mul2.outputs['Result'], add.inputs['A'])
                add.inputs['B'].default_value = (1, 0.96, 0.9, 1)
                nt.links.new(add.outputs['Result'], em.inputs['Color'])
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            nt.nodes.active = tex
        bpy.context.scene.cycles.samples = 24
        bpy.ops.object.bake(type='EMIT', margin=6)
        bpy.context.scene.cycles.samples = 4
        for key, m in self.mats.items():
            nt = m.node_tree
            nt.links.new(saved[key], nt.nodes['Material Output'].inputs['Surface'])
        return img

    def finish(self, out, blend=None, size=1024):
        super().finish(out, blend, size)


def axis_rot(from_axis, to_axis):
    return Vector(from_axis).rotation_difference(Vector(to_axis)).to_matrix()


__all__ = ['HeartForge', 'axis_rot', 'lerp', 'rot_y', 'rot_z', 'srgb_to_lin', 'Vector', 'Matrix']
