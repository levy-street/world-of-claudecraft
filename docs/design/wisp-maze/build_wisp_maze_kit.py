"""The WISPWOOD MAZE kit: an enchanted garden hedge maze and its garden spirits.

  blender --background --python docs/design/wisp-maze/build_wisp_maze_kit.py [-- --preview [--save file.blend]]

Writes wisp_maze_kit_components.glb beside this file (scripts/assets/wisp_maze/build.mjs
ships it to public/models/props/wisp_maze_kit.glb). Modelling helpers: the boss-room
kit library (../boss-rooms/kitlib.py). Runtime: src/render/wisp_maze_kit.ts bakes each
Kit_* node once and src/render/wisp_maze_visual.ts instances it.

Conventions (kitlib's): units are game yards, up is +Z, a piece's FRONT is -Y (the
game's +Z after export). Unlike the unlit boss rooms, the maze stands in the lit
Evergarden, so the painted colours carry only a soft ground shade and per-facet
variation; the sun does the rest.

Three materials: KitSolid (painted, lit), KitTint (painted near-white; the runtime
multiplies it by each guardian's colour), KitGlow (lantern panes and spirit eyes).

The hedge pieces tile the maze's 4yd wall cells. A side that meets another wall cell
is CUT flush at the cell edge so neighbours grow together; an exposed side is a leafy
clipped face set just inside the cell (the collision box is the whole cell). The clipped
top sits at the maze's wall height (WISP_MAZE_WALL_HEIGHT, 1.15): the pieces change the
look, never the sight lines. Canonical orientation (the pure core
src/render/wisp_maze_kit_core.ts turns them): game north is Blender +Y, east +X.
  Post: no neighbours.        End: one neighbour, west.
  Straight: west and east.    Corner: east and south.
  Tee: east, south and west.  Cross: all four.
  Gate: a Straight whose closed garden gate faces north, under a leafy arch.
"""
import math
import os
import random
import sys

sys.dont_write_bytecode = True  # no __pycache__ beside the shared kit library

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'boss-rooms'))
import bmesh  # noqa: E402
import bpy  # noqa: E402
from kitlib import Piece, export_kit, here  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

SOLID, GLOW, TINT = 0, 1, 2
CELL = 4.0
HALF = CELL / 2
HEIGHT = 1.15  # WISP_MAZE_WALL_HEIGHT
INSET = 0.14  # an exposed hedge face sits this far inside the cell edge (its leaves reach it)

LEAF = ((0.4, 0.62, 0.26), (0.46, 0.68, 0.28), (0.36, 0.56, 0.24), (0.5, 0.72, 0.3), (0.42, 0.64, 0.3),
        (0.54, 0.7, 0.26))
LEAF_TOP = ((0.52, 0.74, 0.32), (0.48, 0.7, 0.3), (0.58, 0.78, 0.34), (0.54, 0.72, 0.28))
LEAF_DEEP = (0.28, 0.46, 0.2)
BLOOMS = ((0.96, 0.95, 0.9), (0.98, 0.76, 0.84), (0.82, 0.74, 0.96), (0.99, 0.9, 0.6))
BLOOM_EYE = (1.0, 0.86, 0.3)
STONE = ((0.86, 0.82, 0.74), (0.9, 0.86, 0.76), (0.82, 0.79, 0.72), (0.88, 0.83, 0.72), (0.8, 0.81, 0.76))
MOSS = (0.62, 0.7, 0.46)
WOOD = (0.62, 0.42, 0.26)
WOOD_DARK = (0.46, 0.3, 0.18)
IRON = (0.2, 0.2, 0.22)
LAMP = (1.0, 0.84, 0.46)
TWIG = (0.34, 0.24, 0.16)
TWIG_DARK = (0.22, 0.15, 0.1)
HOLLOW = (0.05, 0.06, 0.04)
WITHERED = ((0.62, 0.42, 0.5), (0.56, 0.4, 0.3), (0.66, 0.54, 0.42), (0.5, 0.36, 0.46))
PALE = ((0.97, 0.97, 0.95), (0.9, 0.9, 0.88), (0.84, 0.85, 0.82), (1.0, 1.0, 1.0))
SPIRIT_EYE = (1.0, 0.95, 0.75)


class GardenPiece(Piece):
    """A kitlib piece painted for a LIT scene: a soft ground shade, facet variation."""

    def tuft(self, center, size, color, mat=SOLID):
        """A leaf clump: a jittered octahedron, 8 facets."""
        c = Vector(center)
        axes = []
        for axis, s in ((Vector((1, 0, 0)), size[0]), (Vector((0, 1, 0)), size[1]), (Vector((0, 0, 1)), size[2])):
            axes.append((axis * s * (0.8 + 0.4 * self.rng.random()), axis * -s * (0.8 + 0.4 * self.rng.random())))
        (xp, xn), (yp, yn), (zp, zn) = axes
        jitter = Vector(((self.rng.random() - 0.5) * size[0] * 0.3, (self.rng.random() - 0.5) * size[1] * 0.3, 0))
        v = {k: self.bm.verts.new(c + off + (jitter if k in ('zp',) else Vector()))
             for k, off in (('xp', xp), ('xn', xn), ('yp', yp), ('yn', yn), ('zp', zp), ('zn', zn))}
        faces = []
        for a, b in (('xp', 'yp'), ('yp', 'xn'), ('xn', 'yn'), ('yn', 'xp')):
            faces.append(self.bm.faces.new((v[a], v[b], v['zp'])))
            faces.append(self.bm.faces.new((v[b], v[a], v['zn'])))
        self._paint(faces, color, mat)

    def leaf(self, base, direction, length, width, color, mat=SOLID, normal=(0, 0, 1)):
        """One almond leaf folded along its midrib, drawn from both sides."""
        base, d = Vector(base), Vector(direction).normalized()
        n = Vector(normal).normalized()
        side = d.cross(n)
        if side.length < 1e-4:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        n = side.cross(d).normalized() * (1 if side.cross(d).dot(n) >= 0 else -1)
        fold = n * width * 0.16
        outline = [base]
        for t, w in ((0.28, 0.44), (0.62, 0.5)):
            outline.append(base + d * length * t + side * width * w + fold)
        outline.append(base + d * length)
        for t, w in ((0.62, 0.5), (0.28, 0.44)):
            outline.append(base + d * length * t - side * width * w + fold)
        front = [self.bm.verts.new(v) for v in outline]
        back = [self.bm.verts.new(v - n * 0.006) for v in outline]
        faces = [self.bm.faces.new(front), self.bm.faces.new(list(reversed(back)))]
        self._paint(faces, color, mat)

    def bloom(self, center, normal, radius, color, petals=5, mat=SOLID, eye=BLOOM_EYE):
        """A little flower facing `normal`: one triangle per petal, a lit eye."""
        c, n = Vector(center), Vector(normal).normalized()
        u = n.cross(Vector((0, 0, 1)))
        if u.length < 1e-3:
            u = n.cross(Vector((1, 0, 0)))
        u.normalize()
        w = n.cross(u).normalized()
        spin = self.rng.random() * math.tau
        hub = self.bm.verts.new(c + n * radius * 0.25)
        faces = []
        for i in range(petals):
            a = spin + math.tau * i / petals
            left = self.bm.verts.new(c + (u * math.cos(a - 0.34) + w * math.sin(a - 0.34)) * radius)
            right = self.bm.verts.new(c + (u * math.cos(a + 0.34) + w * math.sin(a + 0.34)) * radius)
            faces.append(self.bm.faces.new((hub, left, right)))
        self._paint(faces, color, mat)
        if eye:
            e0 = self.bm.verts.new(c + n * radius * 0.3 + u * radius * 0.22)
            e1 = self.bm.verts.new(c + n * radius * 0.3 + (-u * 0.5 + w * 0.87) * radius * 0.22)
            e2 = self.bm.verts.new(c + n * radius * 0.3 + (-u * 0.5 - w * 0.87) * radius * 0.22)
            self._paint([self.bm.faces.new((e0, e1, e2))], eye, mat)

    def slab(self, x0, x1, y0, y1, z0, z1, color, mat=SOLID):
        """An axis box between two corners."""
        self.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), color, mat=mat)

    def finish(self, materials, parent):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        floor = min(v.co.z for v in bm.verts)
        top = max(v.co.z for v in bm.verts)
        span = max(0.4, top - floor)
        for face in bm.faces:
            if face.material_index == GLOW:
                shade = 1.0
            else:
                rise = (face.calc_center_median().z - floor) / span
                ground = 0.8 + 0.2 * min(1.0, rise * 1.6)
                shade = ground * (0.93 + 0.14 * self.rng.random()) * (1.0 + 0.06 * max(0.0, face.normal.z))
            for loop in face.loops:
                r, g, b, _ = loop[self.col]
                # Vertex colours ship linear.
                loop[self.col] = (min(1.0, r * shade) ** 2.2, min(1.0, g * shade) ** 2.2, min(1.0, b * shade) ** 2.2, 1.0)
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        for mat in materials:
            mesh.materials.append(mat)
        for poly in mesh.polygons:
            poly.use_smooth = False
        mesh.color_attributes.active_color = mesh.color_attributes[0]
        mesh.color_attributes.render_color_index = 0
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = parent
        return obj


def piece(name, seed=0):
    return GardenPiece(name, seed=seed)


# ------------------------------------------------------------------ hedges
SIDES = {'N': (0, 1), 'E': (1, 0), 'S': (0, -1), 'W': (-1, 0)}


def hedge_block(p, joined, height=HEIGHT, x_span=(-HALF, HALF), y_span=(-HALF, HALF), flowers=True):
    """A clipped hedge block over one cell: `joined` names the sides cut flush for a
    neighbour; every other side is a leafy face with a rounded shoulder."""
    x0 = x_span[0] + (0 if 'W' in joined else INSET)
    x1 = x_span[1] - (0 if 'E' in joined else INSET)
    y0 = y_span[0] + (0 if 'S' in joined else INSET)
    y1 = y_span[1] - (0 if 'N' in joined else INSET)
    shoulder = 0.16
    # The body, sunk below the lawn so a skirt never shows daylight, and the top
    # course stepped in on every exposed side: the clipped shoulder.
    p.slab(x0, x1, y0, y1, -0.25, height - shoulder, LEAF_DEEP)
    sx0 = x0 + (0 if 'W' in joined else 0.12)
    sx1 = x1 - (0 if 'E' in joined else 0.12)
    sy0 = y0 + (0 if 'S' in joined else 0.12)
    sy1 = y1 - (0 if 'N' in joined else 0.12)
    p.slab(sx0, sx1, sy0, sy1, height - shoulder - 0.01, height - 0.04, LEAF[1])
    # Leaf clumps across every exposed face: two staggered courses, half sunk.
    for side, (nx, ny) in SIDES.items():
        if side in joined:
            continue
        if nx:
            face = x1 if nx > 0 else x0
            lo, hi = y0, y1
        else:
            face = y1 if ny > 0 else y0
            lo, hi = x0, x1
        length = hi - lo
        count = max(2, round(length / 0.46))
        for course, z in enumerate((0.16, 0.5, 0.84)):
            shift = 0.5 if course % 2 else 0.0
            for i in range(count):
                t = lo + (i + 0.5 + shift) * length / (count + (1 if shift else 0))
                if t > hi - 0.14 or t < lo + 0.14:
                    continue
                size = (0.24 + 0.08 * p.rng.random(), 0.24 + 0.08 * p.rng.random(), 0.2 + 0.06 * p.rng.random())
                zz = z + (p.rng.random() - 0.5) * 0.08
                center = (face + nx * 0.0, t, zz) if nx else (t, face + ny * 0.0, zz)
                grow = (size[0] * (0.34 if nx else 1), size[1] * (0.34 if ny else 1), size[2])
                p.tuft(center, grow, LEAF[p.rng.randrange(len(LEAF))])
        if flowers:
            # small flower clusters just under the clipped shoulder
            for i in range(max(1, round(length / 1.6))):
                t = lo + (i + 0.3 + 0.4 * p.rng.random()) * length / max(1, round(length / 1.6))
                tone = BLOOMS[p.rng.randrange(len(BLOOMS))]
                for k in range(3):
                    dt = (k - 1) * 0.14 + (p.rng.random() - 0.5) * 0.06
                    z = height - 0.32 - 0.1 * (k % 2) - 0.12 * p.rng.random()
                    at = (face + nx * 0.08, t + dt, z) if nx else (t + dt, face + ny * 0.08, z)
                    p.bloom(at, (nx, ny, 0.25), 0.08, tone)
    # A carpet of soft clumps over the clipped top, barely proud of it.
    nx_, ny_ = max(2, round((sx1 - sx0) / 0.95)), max(2, round((sy1 - sy0) / 0.95))
    for i in range(nx_):
        for j in range(ny_):
            cx = sx0 + (i + 0.5) * (sx1 - sx0) / nx_ + (p.rng.random() - 0.5) * 0.3
            cy = sy0 + (j + 0.5) * (sy1 - sy0) / ny_ + (p.rng.random() - 0.5) * 0.3
            # never past the cell edge, even where the piece joins a neighbour
            cx = min(max(cx, sx0 + 0.4), sx1 - 0.4)
            cy = min(max(cy, sy0 + 0.4), sy1 - 0.4)
            p.tuft((cx, cy, height - 0.05), (0.36, 0.36, 0.06), LEAF_TOP[p.rng.randrange(len(LEAF_TOP))])
    if flowers and len(joined) < 4:
        cx = (sx0 + sx1) / 2 + (p.rng.random() - 0.5)
        cy = (sy0 + sy1) / 2 + (p.rng.random() - 0.5)
        tone = BLOOMS[p.rng.randrange(len(BLOOMS))]
        for k in range(3):
            p.bloom((cx + (k - 1) * 0.16, cy + 0.08 * (k % 2), height - 0.005), (0, 0, 1), 0.08, tone)


def hedge_piece(name, joined, seed=0):
    def build():
        p = piece(f'Kit_Hedge{name}', seed)
        hedge_block(p, joined)
        return p
    return build


def hedge_gate():
    """The maze's entrance: a hedge run with a closed garden gate on its north face,
    two taller hedge pillars and a leafy arch over it, a lantern hung in the arch."""
    p = piece('Kit_HedgeGate', 7)
    hedge_block(p, {'W', 'E'}, flowers=False)
    front = HALF - INSET
    # pillars
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 1.18, sx * 1.86))
        cx = (x0 + x1) / 2
        p.slab(x0, x1, -0.62, 0.62, HEIGHT - 0.2, 1.95, LEAF_DEEP)
        for z in (1.25, 1.52, 1.79):
            for fy in (-0.62, -0.2, 0.2, 0.62):
                if abs(fy) > 0.5:
                    for dx in (-0.17, 0.17):
                        p.tuft((cx + dx, fy, z), (0.2, 0.1, 0.18), LEAF[p.rng.randrange(len(LEAF))])
            for fx in (x0, x1):
                for fy in (-0.35, 0.35):
                    p.tuft((fx, fy, z), (0.1, 0.22, 0.18), LEAF[p.rng.randrange(len(LEAF))])
        p.tuft((cx, 0, 1.97), (0.36, 0.64, 0.12), LEAF_TOP[1])
    # the arch: leafy blocks along a half ring from pillar to pillar
    span = 1.52
    p.ring((0, 0, 1.9), span, 0.3, LEAF_DEEP, segments=18, arc=(0.0, math.pi), width=0.8)
    for i in range(13):
        a = math.pi * (i + 0.5) / 13
        at = Vector((math.cos(a) * span, 0, 1.9 + math.sin(a) * span))
        out = Vector((math.cos(a), 0, math.sin(a)))
        for fy in (-0.3, 0.3):
            p.tuft(at + out * 0.12 + Vector((0, fy, 0)), (0.2, 0.2, 0.2), LEAF[(i + (fy > 0)) % len(LEAF)])
        if i % 2 == 0:
            p.bloom(at + Vector((0, -0.48, 0.1)), (0, -1, 0.3), 0.09, BLOOMS[i % len(BLOOMS)])
            p.bloom(at + Vector((0, 0.48, 0.1)), (0, 1, 0.3), 0.09, BLOOMS[(i + 1) % len(BLOOMS)])
    # the closed double gate, proud of the north face, taller than the hedge
    gy = front - 0.02
    for i in range(6):
        x = -1.1 + (i + 0.5) * 2.2 / 6
        top = 1.62 + 0.14 * math.cos((x / 1.1) * math.pi / 2)
        p.slab(x - 0.17, x + 0.17, gy - 0.05, gy + 0.05, 0.02, top, WOOD if i % 2 else WOOD_DARK)
    for z in (0.35, 1.2):
        p.slab(-1.12, 1.12, gy + 0.04, gy + 0.1, z, z + 0.14, WOOD_DARK)
    p.slab(-0.02, 0.02, gy + 0.05, gy + 0.11, 0.05, 1.7, IRON)
    for sx in (-1, 1):
        p.ring((sx * 0.2, gy + 0.13, 0.85), 0.09, 0.03, IRON, segments=8)
    # a lantern hung under the arch crown, on the maze side
    p.sweep([(0, 0.0, 3.3), (0, 0.0, 2.85)], 0.02, 0.02, IRON, sides=4)
    lantern(p, (0, 0.0, 2.38), 0.48)
    return p


def lantern(p, base, height):
    """A small four-paned lantern standing on `base`."""
    x, y, z = base
    p.slab(x - 0.14, x + 0.14, y - 0.14, y + 0.14, z, z + 0.06, IRON)
    p.slab(x - 0.11, x + 0.11, y - 0.11, y + 0.11, z + 0.06, z + height * 0.62, LAMP, mat=GLOW)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.slab(x + sx * 0.11 - 0.018, x + sx * 0.11 + 0.018, y + sy * 0.11 - 0.018, y + sy * 0.11 + 0.018,
                   z + 0.06, z + height * 0.62, IRON)
    p.prism((x, y, z + height * 0.62), 4, 0.2, 0.02, height * 0.3, IRON, phase=math.pi / 4)
    p.prism((x, y, z + height * 0.9), 6, 0.035, 0.035, height * 0.12, IRON)


def lantern_post():
    p = piece('Kit_LanternPost', 3)
    p.prism((0, 0, 0), 6, 0.2, 0.16, 0.18, IRON)
    p.prism((0, 0, 0.18), 6, 0.08, 0.06, 1.8, WOOD_DARK)
    p.slab(-0.05, 0.05, -0.05, 0.42, 1.86, 1.94, IRON)
    p.sweep([(0, 0.36, 1.9), (0, 0.36, 1.78)], 0.015, 0.015, IRON, sides=4)
    lantern(p, (0, 0.36, 1.32), 0.46)
    # a twist of ivy up the post, and a bloom at its foot
    pts = [(math.cos(t * 1.9) * 0.09, math.sin(t * 1.9) * 0.09, 0.15 + t * 0.34) for t in range(5)]
    for i, at in enumerate(pts):
        p.leaf(at, (math.cos(i * 1.9), math.sin(i * 1.9), 0.4), 0.2, 0.11, LEAF[i % len(LEAF)],
               normal=(math.cos(i * 1.9 + 1.5), math.sin(i * 1.9 + 1.5), 0))
    for i in range(3):
        a = i * 2.1 + 0.4
        p.tuft((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.1), (0.2, 0.2, 0.14), LEAF[i])
        p.bloom((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.24), (0, 0, 1), 0.08, BLOOMS[i])
    return p


def flagstones():
    """One corridor cell of flagstones: irregular flat stones, lawn in the joints."""
    p = piece('Kit_Flagstones', 11)
    n = 3
    step = CELL / n
    for i in range(n):
        for j in range(n):
            cx = -HALF + (i + 0.5) * step + (p.rng.random() - 0.5) * 0.14
            cy = -HALF + (j + 0.5) * step + (p.rng.random() - 0.5) * 0.14
            r = step * 0.44
            sides = 5 + (i * 2 + j) % 3
            spin = p.rng.random() * math.tau
            tone = STONE[p.rng.randrange(len(STONE))]
            if p.rng.random() < 0.18:
                tone = tuple(0.5 * a + 0.5 * b for a, b in zip(tone, MOSS))
            ring_top, ring_low = [], []
            for k in range(sides):
                a = spin + math.tau * k / sides
                rr = r * (0.74 + 0.3 * p.rng.random())
                rx, ry = math.cos(a) * rr * 1.06, math.sin(a) * rr * 1.06
                ring_top.append(p.bm.verts.new((cx + rx * 0.92, cy + ry * 0.92, 0.07)))
                ring_low.append(p.bm.verts.new((cx + rx, cy + ry, -0.02)))
            faces = [p.bm.faces.new(ring_top)]
            for k in range(sides):
                faces.append(p.bm.faces.new((ring_low[k], ring_low[(k + 1) % sides],
                                             ring_top[(k + 1) % sides], ring_top[k])))
            p._paint(faces, tone, SOLID)
    return p


# ------------------------------------------------------------------ the spirit
def spirit_body():
    """A garden spirit: a hunched body of layered leaves over a twist of trailing
    vines, a leaf hood around a hollow face with two lit eyes, long twig arms that
    reach, withered flowers caught in it. Front is -Y. No dome, no skirt: it tapers
    into its vines and hangs forward."""
    p = piece('Kit_Spirit', 5)
    # the trailing vine tail: three twisted strands from the hips to a curl
    for k in range(3):
        a0 = k * math.tau / 3
        pts = []
        for i in range(8):
            t = i / 7
            a = a0 + t * 2.4
            rad = 0.2 * (1 - t) + 0.05
            pts.append((math.cos(a) * rad, 0.1 * t + math.sin(a) * rad, 0.95 - t * 0.78))
        p.sweep(pts, 0.07, 0.015, TWIG_DARK if k else TWIG, sides=4)
        for i in (2, 4, 6):
            at = Vector(pts[i])
            p.leaf(at, (math.cos(a0 + i), math.sin(a0 + i), -0.5), 0.2, 0.1, PALE[i % len(PALE)], mat=TINT,
                   normal=(-math.sin(a0 + i), math.cos(a0 + i), 0.2))
    # the leaf body: rings of overlapping leaves hanging from a tapered core
    core = [(0.0, 0.95, 0.16), (0.02, 1.2, 0.3), (0.04, 1.42, 0.36), (0.04, 1.56, 0.26)]
    for (y, z, r), (_, z1, r1) in zip(core, core[1:]):
        p.prism((0, y - 0.02, z), 7, r, r1, z1 - z, LEAF_DEEP)
    rings = ((0.98, 0.2, 8, 0.4), (1.1, 0.26, 9, 0.42), (1.22, 0.31, 10, 0.42), (1.34, 0.35, 11, 0.4),
             (1.46, 0.36, 11, 0.36), (1.56, 0.3, 9, 0.3))
    for ri, (z, r, count, length) in enumerate(rings):
        for i in range(count):
            a = math.tau * (i + 0.5 * (ri % 2)) / count
            out = Vector((math.cos(a), math.sin(a), 0))
            base = Vector((out.x * r * 0.9, out.y * r * 0.9 + 0.03, z + 0.16))
            p.leaf(base, out * 0.5 + Vector((0, 0, -1)), length, length * 0.7,
                   PALE[(i + ri) % len(PALE)], mat=TINT, normal=out)
    # the hood: broad leaves cupping the head, leaving the face open to the front
    head = Vector((0, -0.04, 1.74))
    p.prism((0, -0.02, 1.54), 7, 0.2, 0.22, 0.36, LEAF_DEEP)
    p.rock(head, (0.46, 0.44, 0.44), HOLLOW, jitter=0.06)
    for i in range(9):
        a = math.pi * 0.2 + (math.pi * 1.6) * i / 8  # around the back, open at -Y
        d = Vector((math.cos(a - math.pi / 2), math.sin(a - math.pi / 2), 0))
        if d.y < -0.6:
            continue
        base = head + Vector((d.x * 0.2, d.y * 0.2, 0.26))
        p.leaf(base, Vector((d.x * 0.7, d.y * 0.7, -0.6)), 0.5, 0.3, PALE[i % len(PALE)], mat=TINT,
               normal=Vector((d.x, d.y, 0.4)))
    for sx in (-1, 1):
        # brow leaves over the face, drooping forward
        p.leaf(head + Vector((sx * 0.12, -0.12, 0.26)), (sx * 0.35, -0.8, -0.3), 0.36, 0.2,
               PALE[1], mat=TINT, normal=(0, -0.3, 1))
        # the eyes: narrow slanted slits in the hollow
        cx = sx * 0.12
        e = [p.bm.verts.new(head + Vector(v)) for v in ((cx - sx * 0.08, -0.235, 0.02), (cx, -0.24, 0.07),
                                                       (cx + sx * 0.08, -0.235, 0.03), (cx, -0.24, -0.02))]
        p._paint([p.bm.faces.new(e if sx > 0 else list(reversed(e)))], SPIRIT_EYE, GLOW)
        e2 = [p.bm.verts.new(head + Vector(v)) for v in ((cx - sx * 0.08, -0.23, 0.02), (cx, -0.232, 0.07),
                                                        (cx + sx * 0.08, -0.23, 0.03), (cx, -0.232, -0.02))]
        p._paint([p.bm.faces.new(list(reversed(e2)) if sx > 0 else e2)], SPIRIT_EYE, GLOW)
    # twig arms reaching forward, three-fingered, with a few leaves
    for sx in (-1, 1):
        shoulder = Vector((sx * 0.3, 0.0, 1.46))
        elbow = Vector((sx * 0.56, -0.24, 1.3))
        wrist = Vector((sx * 0.58, -0.62, 1.12))
        p.sweep(p.bezier(shoulder, elbow, wrist, steps=5), 0.07, 0.035, TWIG, sides=5)
        for f in (-1, 0, 1):
            tip = wrist + Vector((sx * 0.08 * f + sx * 0.04, -0.26, -0.1 + 0.06 * abs(f)))
            p.sweep([wrist, wrist.lerp(tip, 0.55) + Vector((0, 0, 0.04)), tip], 0.025, 0.006, TWIG_DARK, sides=4)
        for i, t in enumerate((0.3, 0.6)):
            at = shoulder.lerp(wrist, t)
            p.leaf(at, (sx * 0.4, 0.2, 0.6), 0.2, 0.12, PALE[i], mat=TINT, normal=(0, -1, 0.2))
    # withered flowers caught in the chest and shoulders
    for i, (x, z, r) in enumerate(((-0.16, 1.36, 0.09), (0.2, 1.24, 0.08), (0.05, 1.08, 0.07), (-0.3, 1.5, 0.08))):
        at = Vector((x, -0.36 if z > 1.2 else -0.3, z))
        p.bloom(at, (x * 0.8, -1, -0.35), r, WITHERED[i % len(WITHERED)], petals=5, eye=(0.34, 0.26, 0.16))
        p.sweep([at + Vector((0, 0.04, 0)), at + Vector((x * 0.2, 0.12, 0.12))], 0.012, 0.008, TWIG_DARK, sides=3)
    return p


def crest(index):
    """One distinguishing crest per guardian, so the five read apart without tint."""
    def build():
        p = piece(f'Kit_Crest{index}', 20 + index)
        head = Vector((0, -0.04, 1.74))
        if index == 0:  # antlers: two branching twigs sweeping up and out
            for sx in (-1, 1):
                base = head + Vector((sx * 0.22, 0.02, 0.24))
                bend = base + Vector((sx * 0.3, 0.06, 0.26))
                tip = base + Vector((sx * 0.42, 0.02, 0.62))
                p.sweep(p.bezier(base, bend, tip, steps=5), 0.055, 0.015, TWIG, sides=4)
                for t, lean in ((0.45, 0.1), (0.7, -0.1)):
                    at = Vector(p.bezier(base, bend, tip, steps=10)[int(t * 10)])
                    p.sweep([at, at + Vector((sx * -0.08, lean, 0.24))], 0.028, 0.008, TWIG_DARK, sides=4)
                p.leaf(tip, (sx * 0.3, 0, 0.8), 0.2, 0.12, PALE[0], mat=TINT, normal=(0, -1, 0))
        elif index == 1:  # one tall withered bloom on a bowed stalk
            base = head + Vector((0, 0.08, 0.3))
            top = head + Vector((0, -0.14, 0.9))
            p.sweep(p.bezier(base, base + Vector((0, 0.18, 0.4)), top, steps=6), 0.04, 0.025, TWIG, sides=4)
            for i in range(6):
                a = math.tau * i / 6
                d = Vector((math.cos(a), math.sin(a) * 0.8 - 0.3, -0.7))
                p.leaf(top, d, 0.3, 0.2, WITHERED[i % len(WITHERED)], normal=(math.cos(a), math.sin(a), 0.3))
            p.tuft(top + Vector((0, 0, 0.02)), (0.08, 0.08, 0.07), (0.4, 0.3, 0.2))
            for sx in (-1, 1):
                p.leaf(base + Vector((0, 0.1, 0.22)), (sx * 0.8, 0.1, 0.4), 0.26, 0.14, PALE[2], mat=TINT,
                       normal=(0, -1, 0.3))
        elif index == 2:  # a woven twig hoop, tilted, leaves tied round it
            mark = p.mark()
            p.ring((0, 0, 0), 0.46, 0.05, TWIG, segments=14)
            for i in range(5):
                a = math.tau * i / 5
                p.leaf((math.cos(a) * 0.46, 0, math.sin(a) * 0.46), (math.cos(a), 0.3, math.sin(a)), 0.2, 0.12,
                       PALE[i % len(PALE)], mat=TINT, normal=(0, -1, 0))
            p.turn(mark, Matrix.Translation(head + Vector((0, 0.16, 0.2))) @ Matrix.Rotation(-0.5, 4, 'X'))
        elif index == 3:  # a crown of dark thorns ringing the hood
            for i in range(7):
                a = math.tau * i / 7 + 0.2
                base = head + Vector((math.cos(a) * 0.22, math.sin(a) * 0.22 + 0.02, 0.2))
                p.spike(base, 0.06, 0.34 + 0.08 * (i % 2), TWIG_DARK, sides=4,
                        lean=(math.cos(a) * 0.16, math.sin(a) * 0.16))
            p.ring(head + Vector((0, 0.02, 0.22)), 0.24, 0.04, TWIG, segments=12, tilt=(math.pi / 2, 0, 0))
            for i in range(3):
                a = math.tau * i / 3
                p.leaf(head + Vector((math.cos(a) * 0.24, math.sin(a) * 0.24, 0.24)),
                       (math.cos(a), math.sin(a), 0.2), 0.18, 0.1, PALE[i], mat=TINT, normal=(0, 0, 1))
        else:  # a great fan of leaves rising behind the head, on twig spines
            for i in range(7):
                a = -0.9 + 1.8 * i / 6
                d = Vector((math.sin(a), 0.35, math.cos(a))).normalized()
                base = head + Vector((0, 0.2, 0.05))
                tip = base + d * 0.66
                p.sweep([base, tip], 0.03, 0.012, TWIG_DARK, sides=4)
                p.leaf(base + d * 0.24, d, 0.62, 0.3, PALE[i % len(PALE)], mat=TINT, normal=(0, -1, 0.2))
        return p
    return build


HEDGES = (
    hedge_piece('Post', set(), 1),
    hedge_piece('End', {'W'}, 2),
    hedge_piece('Straight', {'W', 'E'}, 3),
    hedge_piece('Corner', {'E', 'S'}, 4),
    hedge_piece('Tee', {'E', 'S', 'W'}, 5),
    hedge_piece('Cross', {'N', 'E', 'S', 'W'}, 6),
)
BUILDERS = (*HEDGES, hedge_gate, lantern_post, flagstones, spirit_body, *(crest(i) for i in range(5)))


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = []
    for name, emission in (('KitSolid', 0.0), ('KitGlow', 3.0), ('KitTint', 0.0)):
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Roughness'].default_value = 0.85
        attribute = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = 'Col'
        mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Base Color'])
        if emission:
            mat.node_tree.links.new(attribute.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emission
        materials.append(mat)
    root = bpy.data.objects.new('WispMazeKit_ROOT', None)
    bpy.context.scene.collection.objects.link(root)
    random.seed(1)
    parts = [builder().finish(materials, root) for builder in BUILDERS]
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in parts:
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        dims = [round(d, 2) for d in obj.dimensions]
        top = max(v.co.z for v in obj.data.vertices)
        print(f'PIECE {obj.name} triangles {len(mesh.loop_triangles)} size {dims} top {round(top, 3)}')
        total += len(mesh.loop_triangles)
    print('KIT_TRIANGLES', total)
    return parts, materials


# ------------------------------------------------------------------ preview
MINI = (
    '#########',
    '#.......#',
    '#.#.#.#.#',
    '#.......#',
    '#.##.##.#',
    '#.......#',
    '#########',
)
GUARDIAN_COLORS = (0xeb6354, 0xb879ec, 0x59baff, 0x70dba4, 0xf0c04a)


def mini_maze_layout():
    """Place hedge pieces over a small sample maze the way the runtime core does."""
    rows, cols = len(MINI), len(MINI[0])
    wall = lambda r, c: 0 <= r < rows and 0 <= c < cols and MINI[r][c] == '#'  # noqa: E731
    canon = {0: 'Post', 8: 'End', 10: 'Straight', 6: 'Corner', 14: 'Tee', 15: 'Cross'}
    placed = []
    for r in range(rows):
        for c in range(cols):
            if not wall(r, c):
                placed.append(('Kit_Flagstones', c, r, 0))
                continue
            mask = (1 if wall(r - 1, c) else 0) | (2 if wall(r, c + 1) else 0) | (4 if wall(r + 1, c) else 0) | (8 if wall(r, c - 1) else 0)
            for q in range(4):
                m = mask
                for _ in range(q):  # undo one quarter turn (a turn carries E to N)
                    m = ((m << 1) & 15) | (m >> 3)
                if m in canon:
                    name = canon[m]
                    if r == rows - 1 and c == cols // 2:
                        name = 'Gate'
                    placed.append((f'Kit_Hedge{name}' if name != 'Gate' else 'Kit_HedgeGate', c, r, q))
                    break
    return rows, cols, placed


def preview(parts, out_png):
    scene = bpy.context.scene
    by_name = {o.name: o for o in parts}
    rows, cols, placed = mini_maze_layout()
    root = bpy.data.objects.new('Preview_Maze', None)
    scene.collection.objects.link(root)
    for name, c, r, q in placed:
        src = by_name[name]
        inst = bpy.data.objects.new(f'{name}.{c}.{r}', src.data)
        scene.collection.objects.link(inst)
        inst.parent = root
        # grid row r grows toward game +Z (south) = Blender -Y
        inst.location = ((c - (cols - 1) / 2) * CELL, -(r - (rows - 1) / 2) * CELL, 0)
        inst.rotation_euler = (0, 0, q * math.pi / 2)
    for sx in (-1, 1):
        for sy in (-1, 1):
            post = bpy.data.objects.new('lantern', by_name['Kit_LanternPost'].data)
            scene.collection.objects.link(post)
            post.location = (sx * (cols * CELL / 2 + 1.0), sy * (rows * CELL / 2 + 1.0), 0)
            post.rotation_euler = (0, 0, math.atan2(-sy, -sx) + math.pi / 2)
    # five spirits, each with its tint and crest, in the corridors
    spots = ((-12, 0), (-6, 0), (0, 0), (6, 0), (12, 0))
    for i, (x, y) in enumerate(spots):
        hexc = GUARDIAN_COLORS[i]
        rgb = tuple(((hexc >> s) & 255) / 255 for s in (16, 8, 0))
        tint = bpy.data.materials['KitTint'].copy()
        tint.name = f'Tint{i}'
        bsdf = tint.node_tree.nodes.get('Principled BSDF')
        mix = tint.node_tree.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        col = next(n for n in tint.node_tree.nodes if n.type == 'VERTEX_COLOR')
        tint.node_tree.links.new(col.outputs['Color'], mix.inputs[6])
        mix.inputs[7].default_value = (*[c ** 2.2 for c in rgb], 1)
        tint.node_tree.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
        bsdf.inputs['Emission Color'].default_value = (*[c ** 2.2 for c in rgb], 1)
        bsdf.inputs['Emission Strength'].default_value = 0.35
        for name in ('Kit_Spirit', f'Kit_Crest{i}'):
            mesh = by_name[name].data.copy()
            for k, slot in enumerate(mesh.materials):
                if slot and slot.name == 'KitTint':
                    mesh.materials[k] = tint
            obj = bpy.data.objects.new(f'Spirit{i}_{name}', mesh)
            scene.collection.objects.link(obj)
            obj.location = (x, y, 0.25)
            obj.rotation_euler = (0, 0, 0.35 * (i - 2))
            obj.scale = (1.18,) * 3 if i == 4 else (1, 1, 1)
    for obj in parts:
        obj.hide_render = True
        obj.hide_set(True)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.55, 0.68, 0.82, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=120, location=(0, 0, 0))
    lawn = bpy.data.materials.new('lawn')
    lawn.use_nodes = True
    lawn.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09, 0.2, 0.05, 1)
    bpy.context.object.data.materials.append(lawn)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (0.75, 0.15, 0.9)
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 32
    scene.collection.objects.link(cam)
    scene.camera = cam
    for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900

    def shot(eye, at, path):
        cam.location = Vector(eye)
        cam.rotation_euler = (Vector(at) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('RENDERED', path)

    shot((6, -30, 20), (0, -2, 0), out_png)
    shot((0, -9.5, 2.6), (0, 0, 1.3), out_png.replace('.png', '_spirits.png'))
    shot((3, -6, 3.2), (0, -12, 1.4), out_png.replace('.png', '_gate.png'))
    if '--save' in sys.argv:
        # the raw pieces, in rows beside the sample maze
        for i, obj in enumerate(parts):
            obj.hide_set(False)
            obj.hide_render = False
            obj.location = (34 + (i % 5) * 6, 18 - (i // 5) * 6, 0)
        target = sys.argv[sys.argv.index('--save') + 1]
        bpy.ops.wm.save_as_mainfile(filepath=target)
        print('SAVED', target)


if __name__ == '__main__':
    parts, _ = build_scene()
    export_kit(os.path.join(here(__file__), 'wisp_maze_kit_components.glb'))
    if '--preview' in sys.argv:
        preview(parts, os.path.join(here(__file__), 'wisp_maze_kit.png'))
