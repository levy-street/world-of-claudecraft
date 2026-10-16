"""Organic creature kit for the Hollow Crypt's hero creatures (the Ossuary
Drake, the Chapel Gargoyle).

The first creature pass (creature_kit.py) built chunky, faceted KayKit-style
bodies with flat vertex colours. The hero creatures need more than that: dense,
smooth-shaded anatomy, a baked surface texture (pitted bone, cracked weathered
stone) with its ambient occlusion folded in, a baked normal map for the fine
relief, and membranes that bend with the finger bones instead of tearing.

How a creature is built here:

  * PARTS. Each part is a Piece (docs/design/dungeon-rework/kit/hckit.py
    primitives) bound RIGIDLY to one bone, optionally smooth shaded and
    subdivided. Parts become their own objects with one vertex group, so a
    Subdivision modifier interpolates the binding correctly, then everything is
    joined into one skinned mesh.
  * MEMBRANES. A membrane is a grid spanned between spars (polylines that ride
    bones); every vertex carries weights for the two spars it lies between,
    so a flap bends the skin smoothly.
  * SURFACE. The joined mesh is unwrapped (Smart UV Project), then Cycles bakes
    a procedural surface (the `surface` kind: 'bone' or 'stone', modulated by
    the part vertex colours) and ambient occlusion into one albedo image, and
    the shader's bump into a tangent-space normal map. At export the material
    is a plain image-textured Principled BSDF, which is what the game's
    character material pipeline expects (src/render/characters/assets.ts).
  * GLOW. Emissive parts (eyes, the soul fire in the chest) keep a vertex-
    coloured material named `CreatureGlow`: the runtime pins any material whose
    name contains `Glow` to the emissive glow band.

Conventions are creature_kit.py's: Blender units = yards, +Z up, the creature
FACES -Y (the game's +Z after the glTF export), bones (name, parent, head,
tail) with `.L` mirrored onto `.R`, poses as turns in the rest armature frame.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from creature_kit import FPS, author_clip, expand_bones, loop  # noqa: E402,F401
from creature_kit import hckit  # noqa: E402

Piece = hckit.Piece
srgb_to_linear = hckit.srgb_to_linear

BODY, GLOW, MEMBRANE = 0, 1, 2


# ------------------------------------------------------------------ scene
def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    return scene


class Part(Piece):
    """A Piece bound to one bone. Colours are sRGB; no weathering pass here:
    the baked surface carries the wear."""

    def __init__(self, name, bone, smooth=True, subdiv=0, seed=0):
        super().__init__(name, seed=seed, weather=0.0, lichen=0.0)
        self.bone = bone
        self.smooth = smooth
        self.subdiv = subdiv

    # ------------------------------------------------------ organic primitives
    def tube(self, points, radii, color, sides=10, squash=1.0, cap=True, mat=BODY, up=(0, 0, 1),
             roll=0.0):
        """A tube along `points` with a radius per station (smooth anatomy:
        shafts, horns, claws, ribs). Frames are parallel-transported, so a
        curling horn never twists; `squash` flattens it along the frame's up."""
        pts = [Vector(p) for p in points]
        n = len(pts)
        if len(radii) != n:
            radii = [radii[0] + (radii[-1] - radii[0]) * i / max(1, n - 1) for i in range(n)] \
                if len(radii) == 2 else [radii[min(len(radii) - 1, int(i * len(radii) / n))] for i in range(n)]
        before = set(self.bm.faces)
        tangents = []
        for i in range(n):
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tangents.append(t.normalized() if t.length > 1e-8 else Vector((0, 0, 1)))
        side = tangents[0].cross(Vector(up))
        if side.length < 1e-4:
            side = tangents[0].cross(Vector((0, 1, 0)))
        side.normalize()
        if roll:
            side = Matrix.Rotation(roll, 3, tangents[0]) @ side
        rings = []
        for i in range(n):
            if i > 0:
                side = side - tangents[i] * side.dot(tangents[i])
                if side.length < 1e-6:
                    side = tangents[i].orthogonal()
                side.normalize()
            upv = tangents[i].cross(side).normalized()
            r = radii[i]
            rings.append([self.bm.verts.new(pts[i] + side * math.cos(math.tau * k / sides) * r
                                            + upv * math.sin(math.tau * k / sides) * r * squash)
                          for k in range(sides)])
        for i in range(n - 1):
            for k in range(sides):
                self.bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                                   rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
        if cap:
            if radii[0] > 1e-4:
                self.bm.faces.new(list(reversed(rings[0])))
            if radii[-1] > 1e-4:
                self.bm.faces.new(rings[-1])
        faces = self._new_faces(before)
        if isinstance(color, list):
            ring_of = {}
            for i, ring in enumerate(rings):
                for v in ring:
                    ring_of[v] = i
            self._paint(faces, color[0], mat)
            for face in faces:
                for lp in face.loops:
                    c = color[min(len(color) - 1, ring_of.get(lp.vert, 0))]
                    lp[self.col] = (*c, 1.0)
        else:
            self._paint(faces, color, mat)
        return faces

    def blob(self, center, size, color, rot=(0, 0, 0), segments=12, rings=8, mat=BODY, jitter=0.0,
             flat_bottom=False):
        """A smooth ellipsoid (UV sphere), rotated by Euler `rot` (radians)."""
        before = set(self.bm.faces)
        made = bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=rings, radius=0.5)
        rm = Matrix.Rotation(rot[2], 3, 'Z') @ Matrix.Rotation(rot[1], 3, 'Y') @ Matrix.Rotation(rot[0], 3, 'X')
        for v in made['verts']:
            k = 1 + (self.rng.random() - 0.5) * 2 * jitter if jitter else 1.0
            co = Vector((v.co.x * size[0] * k, v.co.y * size[1] * k, v.co.z * size[2] * k))
            if flat_bottom and co.z < 0:
                co.z *= 0.25
            v.co = rm @ co + Vector(center)
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def loft(self, sections, color, sides=16, mat=BODY, cap=True):
        """A closed solid through superellipse cross-sections. Each section is
        (center, half_width, half_height, exponent, axis): the ring lies in the
        plane normal to `axis` (the loft direction), x across, z up. Exponent 2
        is an ellipse; higher squares the corners (a skull's flat cheeks)."""
        before = set(self.bm.faces)
        rings = []
        for center, hw, hh, e, axis in sections:
            c = Vector(center)
            ax = Vector(axis).normalized()
            x = ax.cross(Vector((0, 0, 1)))
            if x.length < 1e-4:
                x = Vector((1, 0, 0))
            x.normalize()
            z = x.cross(ax).normalized()
            ring = []
            for k in range(sides):
                a = math.tau * k / sides
                ca, sa = math.cos(a), math.sin(a)
                px = math.copysign(abs(ca) ** (2 / e), ca) * hw
                pz = math.copysign(abs(sa) ** (2 / e), sa) * hh
                ring.append(self.bm.verts.new(c + x * px + z * pz))
            rings.append(ring)
        for i in range(len(rings) - 1):
            for k in range(sides):
                self.bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                                   rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
        if cap:
            self.bm.faces.new(list(reversed(rings[0])))
            self.bm.faces.new(rings[-1])
        faces = self._new_faces(before)
        self._paint(faces, color, mat)
        return faces

    def to_object(self, materials):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for face in bm.faces:
            face.smooth = self.smooth
            for lp in face.loops:
                r, g, b, a = lp[self.col]
                lp[self.col] = (*srgb_to_linear((r, g, b)), a)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        group = obj.vertex_groups.new(name=self.bone)
        group.add(list(range(len(mesh.vertices))), 1.0, 'REPLACE')
        if self.subdiv:
            mod = obj.modifiers.new('Sub', 'SUBSURF')
            mod.levels = self.subdiv
            mod.render_levels = self.subdiv
            _apply_modifiers(obj)
        return obj


def _apply_modifiers(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)


# --------------------------------------------------------------- membranes
class Membrane:
    """Skin spanned between spars. A spar is a list of (point, bone) stations
    from root to tip; consecutive spars bound a panel. Each panel is a grid of
    `rows` stations along the spars and `cols` across; its free (far) edge is
    scalloped toward the root and torn by `tear`. Vertices blend the two spar
    bones by their position across the panel."""

    def __init__(self, name, color, seed=1):
        self.name = name
        self.color = color
        self.rng = random.Random(seed)
        self.verts = []   # (co, {bone: w})
        self.faces = []   # (i, j, k, l)
        self.cols_rgb = []

    @staticmethod
    def _along(spar, t):
        """Point and bone weights at fraction t of a spar's length."""
        pts = [Vector(p) for p, _ in spar]
        lens = [0.0]
        for a, b in zip(pts, pts[1:]):
            lens.append(lens[-1] + (b - a).length)
        total = lens[-1] or 1.0
        d = max(0.0, min(1.0, t)) * total
        for i in range(len(pts) - 1):
            if d <= lens[i + 1] or i == len(pts) - 2:
                seg = lens[i + 1] - lens[i] or 1.0
                k = max(0.0, min(1.0, (d - lens[i]) / seg))
                ba, bb = spar[i][1], spar[i + 1][1]
                w = {}
                w[ba] = w.get(ba, 0.0) + (1 - k)
                w[bb] = w.get(bb, 0.0) + k
                return pts[i].lerp(pts[i + 1], k), w
        return pts[-1], {spar[-1][1]: 1.0}

    def panel(self, spar_a, spar_b, rows=10, cols=8, scallop=0.22, tear=0.0, sag=0.0, reach=1.0,
              shade=1.0):
        """Fill the skin between two spars. `reach` < 1 stops the far edge short
        of the tips (a panel that only spans the inner part of a finger)."""
        base = len(self.verts)
        grid = []
        rng = self.rng
        # A torn trailing edge: each column gets its own ragged far limit.
        # A torn trailing edge: long tatters, the odd deep slit, never a regular saw.
        rag = []
        for c in range(cols + 1):
            k = rng.random()
            depth = 0.15 + 0.35 * rng.random() if k > 0.82 else 0.02 + 0.12 * rng.random()
            rag.append(1.0 - tear * depth * (0.4 + 0.6 * math.sin(math.pi * c / cols)))
        for c in range(1, cols):
            rag[c] = (rag[c - 1] + 2 * rag[c] + rag[c + 1]) / 4 if rng.random() < 0.5 else rag[c]
        rag[0] = rag[-1] = 1.0
        for r in range(rows + 1):
            u = r / rows
            row = []
            for c in range(cols + 1):
                v = c / cols
                s = reach * (1.0 - scallop * math.sin(math.pi * v)) * rag[c]
                pa, wa = self._along(spar_a, u * s)
                pb, wb = self._along(spar_b, u * s)
                co = pa.lerp(pb, v)
                # a slack skin bellies downward between its spars
                co.z -= sag * math.sin(math.pi * v) * math.sin(math.pi * min(1.0, u * 1.1))
                w = {}
                for b, x in wa.items():
                    w[b] = w.get(b, 0.0) + x * (1 - v)
                for b, x in wb.items():
                    w[b] = w.get(b, 0.0) + x * v
                row.append(len(self.verts))
                self.verts.append((co, w))
                # Vein-dark near the spars, thinner (lighter) in the middle.
                k = shade * (0.82 + 0.3 * math.sin(math.pi * v) * (0.6 + 0.4 * u))
                self.cols_rgb.append(tuple(min(1.0, ch * k) for ch in self.color))
            grid.append(row)
        for r in range(rows):
            for c in range(cols):
                # Holes: a few cells near the ragged edge rot away.
                if tear > 0 and 0.45 * rows < r < rows - 1 and 0 < c < cols - 1 and rng.random() < tear * 0.015:
                    continue
                self.faces.append((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
        return base

    def to_object(self, materials):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([co for co, _ in self.verts], [], self.faces)
        mesh.update()
        for mat in materials:
            mesh.materials.append(mat)
        for poly in mesh.polygons:
            poly.material_index = MEMBRANE
            poly.use_smooth = True
        col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        for poly in mesh.polygons:
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                col.data[li].color = (*srgb_to_linear(self.cols_rgb[vi]), 1.0)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        groups = {}
        for vi, (_, w) in enumerate(self.verts):
            total = sum(w.values()) or 1.0
            for bone, x in w.items():
                if x <= 1e-4:
                    continue
                g = groups.get(bone)
                if g is None:
                    g = groups[bone] = obj.vertex_groups.new(name=bone)
                g.add([vi], x / total, 'REPLACE')
        return obj


# ---------------------------------------------------------------- materials
def make_materials(surface, membrane_kind='membrane'):
    """Body (baked), Glow (vertex-coloured emissive), Membrane (baked, double sided)."""
    body = bpy.data.materials.new('CreatureBody')
    glow = bpy.data.materials.new('CreatureGlow')
    memb = bpy.data.materials.new('CreatureMembrane')
    for m in (body, glow, memb):
        m.use_nodes = True
    memb.use_backface_culling = False
    body.use_backface_culling = True
    nt = glow.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 3.0
    for m in (body, memb):
        _procedural_surface(m, surface if m is body else membrane_kind)
    return [body, glow, memb]


def _node(nt, kind, loc, **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def _sock(sockets, name, kind='RGBA'):
    for sk in sockets:
        if sk.name == name and sk.type == kind and sk.enabled:
            return sk
    for sk in sockets:
        if sk.name == name and sk.type == kind:
            return sk
    raise KeyError(name)


def _procedural_surface(mat, kind):
    """The bake-time shader: vertex colour x a procedural wear pattern, plus a
    bump. `kind` picks the pattern: pitted, grooved bone; cracked, pocked,
    weathered stone; or a leathery, veined membrane."""
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = nt.nodes.get('Material Output')
    bsdf = _node(nt, 'ShaderNodeBsdfPrincipled', (600, 0))
    bsdf.inputs['Roughness'].default_value = 0.8
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    vc.location = (-900, 300)
    tex = _node(nt, 'ShaderNodeTexCoord', (-1300, 0))
    mapping = _node(nt, 'ShaderNodeMapping', (-1100, 0))
    nt.links.new(tex.outputs['Object'], mapping.inputs['Vector'])
    if kind == 'stone':
        scale_a, scale_b = 1.6, 7.0
    elif kind == 'membrane':
        scale_a, scale_b = 1.2, 5.0
    elif kind == 'iron':
        # Sea-rotted wrought iron (the Sunken Bastion's cage and anchor):
        # fine pitting and blotchy rust over the painted iron and rust.
        scale_a, scale_b = 3.2, 16.0
    elif kind == 'cloth':
        # Tattered shadow cloth (the reaper's robe): soft mottling, fine weave pits.
        scale_a, scale_b = 1.4, 22.0
    else:
        scale_a, scale_b = 2.2, 9.0
    # Broad mottling.
    noise = _node(nt, 'ShaderNodeTexNoise', (-850, -50), Scale=scale_a, Detail=6.0, Roughness=0.6)
    nt.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    # Cracks / grooves: the edge distance of a Voronoi, thinned by a ramp.
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.location = (-850, -300)
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = scale_b
    nt.links.new(mapping.outputs['Vector'], vor.inputs['Vector'])
    crack = nt.nodes.new('ShaderNodeValToRGB')
    crack.location = (-600, -300)
    crack.color_ramp.elements[0].position = 0.0
    crack.color_ramp.elements[0].color = (0, 0, 0, 1)
    crack.color_ramp.elements[1].position = 0.06 if kind == 'stone' else (0.012 if kind in ('iron', 'cloth') else 0.035)
    crack.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(vor.outputs['Distance'], crack.inputs['Fac'])
    # Fine pitting.
    pits = _node(nt, 'ShaderNodeTexNoise', (-850, -550), Scale=scale_b * 5.0, Detail=2.0, Roughness=0.5)
    nt.links.new(mapping.outputs['Vector'], pits.inputs['Vector'])
    pit_ramp = nt.nodes.new('ShaderNodeValToRGB')
    pit_ramp.location = (-600, -550)
    pit_ramp.color_ramp.elements[0].position = 0.55
    pit_ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    pit_ramp.color_ramp.elements[1].position = 0.75
    pit_ramp.color_ramp.elements[1].color = (0.35, 0.35, 0.35, 1)
    nt.links.new(pits.outputs['Fac'], pit_ramp.inputs['Fac'])
    # tone = vertex colour x (0.78..1.08 mottling) x crack darkening x pits
    mott = nt.nodes.new('ShaderNodeMapRange')
    mott.location = (-600, -50)
    mott.inputs['To Min'].default_value = 0.62 if kind in ('stone', 'iron') else 0.78
    mott.inputs['To Max'].default_value = 1.1
    nt.links.new(noise.outputs['Fac'], mott.inputs['Value'])
    m1 = _node(nt, 'ShaderNodeMix', (-350, 200))
    m1.data_type = 'RGBA'
    m1.blend_type = 'MULTIPLY'
    m1.inputs['Factor'].default_value = 1.0
    nt.links.new(vc.outputs['Color'], _sock(m1.inputs, 'A'))
    nt.links.new(mott.outputs['Result'], _sock(m1.inputs, 'B'))
    crack_mix = nt.nodes.new('ShaderNodeMapRange')
    crack_mix.location = (-350, -300)
    crack_mix.inputs['To Min'].default_value = 0.18 if kind == 'stone' else 0.45
    crack_mix.inputs['To Max'].default_value = 1.0
    nt.links.new(crack.outputs['Color'], crack_mix.inputs['Value'])
    m2 = _node(nt, 'ShaderNodeMix', (-150, 150))
    m2.data_type = 'RGBA'
    m2.blend_type = 'MULTIPLY'
    m2.inputs['Factor'].default_value = 1.0
    nt.links.new(_sock(m1.outputs, 'Result'), _sock(m2.inputs, 'A'))
    nt.links.new(crack_mix.outputs['Result'], _sock(m2.inputs, 'B'))
    m3 = _node(nt, 'ShaderNodeMix', (50, 150))
    m3.data_type = 'RGBA'
    m3.blend_type = 'MULTIPLY'
    m3.inputs['Factor'].default_value = 0.6
    nt.links.new(_sock(m2.outputs, 'Result'), _sock(m3.inputs, 'A'))
    nt.links.new(pit_ramp.outputs['Color'], _sock(m3.inputs, 'B'))
    albedo_out = _sock(m3.outputs, 'Result')
    if kind == 'iron':
        # Rust blooms: a broad noise pushes the painted colour toward flaking
        # orange-brown rust, heaviest in the noise's peaks.
        rust_n = _node(nt, 'ShaderNodeTexNoise', (-850, -800), Scale=5.5, Detail=8.0, Roughness=0.7)
        nt.links.new(mapping.outputs['Vector'], rust_n.inputs['Vector'])
        rust_r = nt.nodes.new('ShaderNodeValToRGB')
        rust_r.location = (-600, -800)
        rust_r.color_ramp.elements[0].position = 0.48
        rust_r.color_ramp.elements[0].color = (0, 0, 0, 1)
        rust_r.color_ramp.elements[1].position = 0.7
        rust_r.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(rust_n.outputs['Fac'], rust_r.inputs['Fac'])
        m4 = _node(nt, 'ShaderNodeMix', (250, 150))
        m4.data_type = 'RGBA'
        m4.blend_type = 'MIX'
        nt.links.new(rust_r.outputs['Color'], m4.inputs['Factor'])
        nt.links.new(albedo_out, _sock(m4.inputs, 'A'))
        _sock(m4.inputs, 'B').default_value = (0.2, 0.065, 0.02, 1)
        albedo_out = _sock(m4.outputs, 'Result')
    nt.links.new(albedo_out, bsdf.inputs['Base Color'])
    # Bump from cracks + pits + mottling.
    add = _node(nt, 'ShaderNodeMath', (-150, -450))
    add.operation = 'ADD'
    nt.links.new(crack.outputs['Color'], add.inputs[0])
    nt.links.new(pits.outputs['Fac'], add.inputs[1])
    bump = _node(nt, 'ShaderNodeBump', (300, -300), Strength=0.55 if kind in ('stone', 'iron') else 0.35,
                 Distance=0.04)
    nt.links.new(add.outputs['Value'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    mat['bake_bsdf'] = bsdf.name


# --------------------------------------------------------------- assembly
def join(objects, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    mesh = obj.data
    if mesh.color_attributes:
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
    return obj


def build_armature(name, bones):
    arm_data = bpy.data.armatures.new(name + 'Rig')
    arm = bpy.data.objects.new(name + 'Rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, parent, head, tail in bones:
        eb = arm_data.edit_bones.new(bname)
        eb.head, eb.tail = Vector(head), Vector(tail)
        eb.roll = 0.0
    for bname, parent, head, tail in bones:
        if parent:
            arm_data.edit_bones[bname].parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def bind(body, arm):
    names = {b.name for b in arm.data.bones}
    for g in body.vertex_groups:
        if g.name not in names:
            raise RuntimeError(f'vertex group {g.name} names no bone')
    body.parent = arm
    mod = body.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm


def triangles(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


# ------------------------------------------------------------------ posing
def _axis(a):
    if isinstance(a, str):
        return {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[a]
    return Vector(a)


def _mirror_turn(a, deg):
    if a == 'loc':
        return ('loc', (-deg[0], deg[1], deg[2]))
    v = _axis(a)
    return ((v.x, -v.y, -v.z), deg)


class Rig:
    """Pose authoring over a bone list: aim bones at armature-space directions,
    solve two-bone limbs onto planted targets, add plain turns, and key it.

    A pose is built as Rig.pose(aims=..., ik=..., turns=..., root=...):
      * aims  {bone: direction}: the bone points that way (armature space);
      * ik    {name: (upper, lower, target, pole)}: the pair reaches target;
      * turns {bone: [(axis, deg)]}: rest-frame turns applied after the aim;
      * root  (x, y, z): moves the Root bone.
    `.L` entries are mirrored onto `.R` unless the `.R` twin is given too.
    The result is {bone: Quaternion} in each bone's local pose space, which
    `key()` writes straight onto the armature (no further mirroring)."""

    def __init__(self, bones):
        self.bones = bones
        self.rest = {n: (Vector(h), Vector(t)) for n, _, h, t in bones}
        self.parent = {n: p for n, p, _, _ in bones}

    def _mirror(self, table, kind):
        out = dict(table)
        for k, v in table.items():
            if k.endswith('.L') and k[:-2] + '.R' not in table:
                if kind == 'aim':
                    out[k[:-2] + '.R'] = Vector((-v[0], v[1], v[2]))
                elif kind == 'turns':
                    out[k[:-2] + '.R'] = [_mirror_turn(a, d) for a, d in v]
        return out

    def pose(self, aims=None, ik=None, turns=None, root=(0, 0, 0)):
        from mathutils import Quaternion
        aims = self._mirror({k: Vector(v) for k, v in (aims or {}).items()}, 'aim')
        turns = self._mirror(turns or {}, 'turns')
        ik = dict(ik or {})
        for k, (u, lo, tgt, pole) in list(ik.items()):
            if u.endswith('.L') and (k[:-2] + '.R') not in ik and k.endswith('.L'):
                t = Vector(tgt)
                p = Vector(pole)
                ik[k[:-2] + '.R'] = (u[:-2] + '.R', lo[:-2] + '.R', (-t.x, t.y, t.z), (-p.x, p.y, p.z))
        ik_upper = {u: (lo, Vector(tgt), Vector(pole)) for u, lo, tgt, pole in ik.values()}
        delta = {}
        head = {}
        out = {}
        for name, parent, h, t in self.bones:
            rh, rt = self.rest[name]
            if parent:
                ph = self.rest[parent][0]
                head[name] = head[parent] + delta[parent] @ (rh - ph)
                dp = delta[parent]
            else:
                head[name] = rh + Vector(root)
                dp = Quaternion()
            if name in ik_upper:
                lo, tgt, pole = ik_upper[name]
                l1 = (rt - rh).length
                l2 = (self.rest[lo][1] - self.rest[lo][0]).length
                d1, d2 = two_bone(head[name], l1, l2, tgt, pole)
                aims[name] = d1
                aims[lo] = d2
            q = Quaternion()
            if name in aims:
                r0 = (rt - rh).normalized()
                want = dp.inverted() @ aims[name].normalized()
                q = r0.rotation_difference(want)
            for a, deg in turns.get(name, []):
                if a == 'loc':
                    continue
                q = Quaternion(_axis(a).normalized(), math.radians(deg)) @ q
            delta[name] = dp @ q
            # armature-space rest-frame rotation -> the bone's local pose quaternion
            rest_m = (self.rest_matrix(name))
            local = rest_m.inverted() @ q.to_matrix() @ rest_m
            out[name] = local.to_quaternion()
        out['__root'] = Vector(root)
        return out

    def attach(self, arm):
        """Read each bone's real rest frame off the built armature."""
        self.frames = {b.name: b.matrix_local.to_3x3() for b in arm.data.bones}
        return self

    def rest_matrix(self, name):
        return self.frames[name]


def two_bone(root, l1, l2, target, pole):
    """Directions of an upper and a lower bone reaching `target` from `root`,
    bending toward `pole`."""
    d = Vector(target) - root
    dist = max(1e-4, min(d.length, (l1 + l2) * 0.999))
    dn = d.normalized()
    cos_a = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)))
    a = math.acos(cos_a)
    p = Vector(pole) - dn * Vector(pole).dot(dn)
    if p.length < 1e-6:
        p = dn.orthogonal()
    p.normalize()
    d1 = dn * math.cos(a) + p * math.sin(a)
    joint = root + d1 * l1
    d2 = (root + dn * dist - joint).normalized()
    return d1, d2


def key_pose(arm, pose, frame):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        q = pose.get(pb.name)
        pb.rotation_quaternion = q if q is not None else (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    root = pose.get('__root')
    rb = arm.pose.bones.get('Root')
    if rb is not None and root is not None:
        rest = rb.bone.matrix_local.to_3x3()
        rb.location = rest.inverted() @ root
    for pb in arm.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)


def clip(arm, name, keys, loop_clip=True):
    """keys: [(frame, pose)] from Rig.pose; a looping clip should end on its first pose."""
    from creature_kit import _fcurves
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for frame, pose in keys:
        key_pose(arm, pose, frame)
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.easing = 'AUTO'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'
    return act


def cycle(period, poses, start=1):
    """Evenly spaced keys over `period` frames, closing the loop on the first pose."""
    n = len(poses)
    keys = [(start + round(i * period / n), p) for i, p in enumerate(poses)]
    keys.append((start + period, poses[0]))
    return keys


# ------------------------------------------------------------------- bake
def bake_surface(obj, size=2048, samples=48, ao_strength=0.85, normal=True):
    """Unwrap, then bake albedo (x AO) and a normal map; swap the bake shaders
    for plain image-textured ones."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.device = 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('OPTIX', 'CUDA'):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                if any(d.type == backend for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == backend
                    scene.cycles.device = 'GPU'
                    break
            except TypeError:
                continue
    except Exception:  # noqa: BLE001
        pass
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.004, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    albedo = bpy.data.images.new(obj.name + '_albedo', size, size, alpha=False)
    ao = bpy.data.images.new(obj.name + '_ao', size, size, alpha=False, float_buffer=False)
    nrm = bpy.data.images.new(obj.name + '_normal', size // 2, size // 2, alpha=False)
    nrm.colorspace_settings.name = 'Non-Color'
    # The glow and a translucent smoke keep their vertex colours (and alpha): never baked.
    unbaked = ('CreatureGlow', 'CreatureSmoke')
    baked = [m for m in obj.data.materials if m and m.name not in unbaked]
    glow = [m for m in obj.data.materials if m and m.name in unbaked]

    def target(img):
        for m in obj.data.materials:
            if not m:
                continue
            nt = m.node_tree
            node = nt.nodes.get('BakeTarget') or nt.nodes.new('ShaderNodeTexImage')
            node.name = 'BakeTarget'
            node.image = img
            node.location = (900, 400)
            nt.nodes.active = node

    scene.render.bake.margin = 6
    scene.render.bake.use_selected_to_active = False
    # 1. albedo (colour only)
    target(albedo)
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=6)
    # 2. ambient occlusion
    target(ao)
    scene.world = scene.world or bpy.data.worlds.new('bakeworld')
    bpy.ops.object.bake(type='AO', margin=6)
    # 3. normal (the shader bump)
    if normal:
        target(nrm)
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=6)
    # Fold AO into the albedo.
    import numpy as np
    a = np.array(albedo.pixels[:], dtype=np.float32).reshape(-1, 4)
    o = np.array(ao.pixels[:], dtype=np.float32).reshape(-1, 4)
    print('BAKE_MEANS albedo', a[:, :3].mean(0), 'ao', o[:, 0].mean())
    k = 1.0 - ao_strength * (1.0 - o[:, 0:1])
    a[:, 0:3] *= k
    albedo.pixels[:] = a.ravel().tolist()
    albedo.update()
    # Swap bake shaders for the shipping ones.
    for m in baked:
        nt = m.node_tree
        for n in list(nt.nodes):
            if n.type != 'OUTPUT_MATERIAL':
                nt.nodes.remove(n)
        out = nt.nodes.get('Material Output')
        bsdf = _node(nt, 'ShaderNodeBsdfPrincipled', (300, 0))
        bsdf.inputs['Roughness'].default_value = 0.82
        img = nt.nodes.new('ShaderNodeTexImage')
        img.image = albedo
        img.location = (-200, 200)
        nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
        if normal:
            nimg = nt.nodes.new('ShaderNodeTexImage')
            nimg.image = nrm
            nimg.location = (-200, -200)
            nmap = nt.nodes.new('ShaderNodeNormalMap')
            nmap.location = (50, -200)
            nt.links.new(nimg.outputs['Color'], nmap.inputs['Color'])
            nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    for m in glow:
        node = m.node_tree.nodes.get('BakeTarget')
        if node:
            m.node_tree.nodes.remove(node)
    bpy.data.images.remove(ao)
    # The baked texture now carries the colour: whiten the body's vertex colours
    # (a glTF loader multiplies COLOR_0 into the texture) and keep them only
    # where the unlit glow material still reads them.
    col = obj.data.color_attributes.get('Col')
    if col is not None:
        keep = {i for i, m in enumerate(obj.data.materials) if m and m.name in unbaked}
        for poly in obj.data.polygons:
            if poly.material_index in keep:
                continue
            for li in poly.loop_indices:
                col.data[li].color = (1.0, 1.0, 1.0, 1.0)
    albedo.pack()
    nrm.pack()
    return albedo, nrm


# ------------------------------------------------------------------ export
def export(path, arm, image_format='JPEG', quality=86, extras=False):
    """`extras` writes object custom properties as glTF node extras (userData)."""
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    arm.select_set(True)
    for child in arm.children:
        child.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_yup=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_image_format=image_format, export_jpeg_quality=quality, export_extras=extras,
    )
    print('WROTE', path)


# ----------------------------------------------------------------- preview
def setup_preview(focus, dist, res=(720, 560), height_ref=2.6, ref_x=None):
    """A lit preview stage with a player-sized reference figure beside the creature."""
    scene = bpy.context.scene
    world = bpy.data.worlds.new('preview')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.2, 0.22, 0.28, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    scene.world = world
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.0
    sun.rotation_euler = (0.85, 0.2, 2.5)
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
    fill.data.energy = 1.6
    fill.data.color = (0.65, 0.78, 1.0)
    fill.rotation_euler = (1.1, 0.0, -0.9)
    scene.collection.objects.link(fill)
    rim = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'SUN'))
    rim.data.energy = 2.2
    rim.rotation_euler = (1.2, 0.0, 0.2)
    scene.collection.objects.link(rim)
    ground = bpy.data.meshes.new('ground')
    s = 80
    ground.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    gobj = bpy.data.objects.new('ground', ground)
    gmat = bpy.data.materials.new('groundmat')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09, 0.09, 0.11, 1)
    ground.materials.append(gmat)
    scene.collection.objects.link(gobj)
    if ref_x is not None:
        player_reference(scene, (ref_x, 0, 0), height_ref)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 40
    scene.collection.objects.link(cam)
    scene.camera = cam
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = res
    target = Vector(focus)
    cam.location = target + Vector((dist * 0.8, -dist, dist * 0.32))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    return cam


def player_reference(scene, at, height):
    """A plain capsule figure the height of a player character, for scale."""
    mat = bpy.data.materials.new('refmat')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.12, 0.1, 1)
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.14, location=(at[0], at[1], height * 0.86))
    parts.append(bpy.context.active_object)
    bpy.ops.mesh.primitive_cylinder_add(radius=height * 0.16, depth=height * 0.62,
                                        location=(at[0], at[1], height * 0.41))
    parts.append(bpy.context.active_object)
    for p in parts:
        p.data.materials.append(mat)
        p.name = 'PlayerReference'
    return parts


def render_sheet(arm, clips, out_dir, prefix, frames_per_clip=4):
    """Render `frames_per_clip` evenly spaced frames of every clip (one PNG each).
    scripts/assets/hollow_crypt_creatures/sheet.mjs composes them."""
    scene = bpy.context.scene
    os.makedirs(out_dir, exist_ok=True)
    for clip in clips:
        act = bpy.data.actions[clip]
        arm.animation_data.action = act
        start, end = act.frame_range
        for i in range(frames_per_clip):
            f = int(round(start + (end - start) * (i + 0.5) / frames_per_clip))
            scene.frame_set(f)
            scene.render.filepath = os.path.join(out_dir, f'{prefix}_{clip}_{i}.png')
            bpy.ops.render.render(write_still=True)
    print('SHEET_FRAMES', out_dir)
