# The building kit for the Eastbrook houses.
#
# Everything is real geometry: walls with timber members standing proud of the plaster,
# roofs with thickness, bargeboards and a ridge beam, windows whose glass sits back behind a
# frame, a lintel and a flower box, shutters hung open on their hinges, doors set back in a
# stone arch. The ChatGPT paintings (paint.py) are only ever the TEXTURE of that geometry.
#
# Three kinds of surface:
#   - tiles ("stone", "timber", "slate", "hull", "glass") mapped at world scale;
#   - trim bands ("bargeboard", "gilded", "oak", "plaster", "planks", "teal"): strips that
#     run along a beam or a board;
#   - parts: crops of the painted cut-outs. A part can be the face of a box, or a RELIEF: a
#     slab whose front carries the painting and whose edge wall follows the traced outline of
#     the paint, so a carved bracket or a stone arch has real thickness along its real shape.
#
# Conventions: yards, Z up while building (the exporter turns that into Y up), the building
# centred on the origin with its floor at z = 0 and its FRONT on the -Y side. A Frame is a
# place to build on: x runs to the right along a wall seen from outside, y runs up, z comes
# out toward the viewer.
import math

import bmesh
import bpy
from mathutils import Vector

UP = Vector((0.0, 0.0, 1.0))
# World size of one repeat of each tile, in yards.
TILE = {"stone": (4.0, 4.0), "timber": (4.0, 3.6), "slate": (2.8, 2.8), "hull": (2.8, 2.8), "glass": (1.3, 1.3), "ashlar": (2.6, 2.6), "stained": (1.3, 1.3)}
STOREY = TILE["timber"][1]
ATLAS_PX = 2048
# Filled by build.py from paint.prepare().
PARTS = {}
BANDS = {}
# Where the painted members sit in the timber tile (measured off the painting): posts as
# (left, right) in fractions of its width, beams as fractions of its height from the top.
TIMBER_POSTS = ((0.2451, 0.3125), (0.4668, 0.5361), (0.6895, 0.7568))
TIMBER_EDGE = (0.0518, 0.9521)
TIMBER_PLATE = 0.1113
TIMBER_SILL = 0.9229
# How far every wall runs on below the ground line, so a house can stand on a slope.
FOOTING = 3.0


class Frame:
    """A place to build: an origin and three unit axes, r (right), u (up), n (out)."""

    def __init__(self, o, r, u=UP, n=None):
        self.o = Vector(o)
        self.r = Vector(r).normalized()
        self.u = Vector(u).normalized()
        self.n = Vector(n).normalized() if n is not None else self.r.cross(self.u).normalized()

    def p(self, x=0.0, y=0.0, z=0.0):
        return self.o + self.r * x + self.u * y + self.n * z

    def d(self, x=0.0, y=0.0, z=0.0):
        return self.r * x + self.u * y + self.n * z

    def at(self, x=0.0, y=0.0, z=0.0):
        return Frame(self.p(x, y, z), self.r, self.u, self.n)

    def turned(self, degrees):
        """Swung about its up axis: positive brings the right-hand end out toward the viewer."""
        a = math.radians(degrees)
        return Frame(self.o, self.r * math.cos(a) + self.n * math.sin(a), self.u, self.n * math.cos(a) - self.r * math.sin(a))

    def tilted(self, degrees):
        """Leaned about its right axis: positive brings the top out toward the viewer."""
        a = math.radians(degrees)
        return Frame(self.o, self.r, self.u * math.cos(a) + self.n * math.sin(a), self.n * math.cos(a) - self.u * math.sin(a))

    def facing_out(self):
        """The frame of a board fixed square to this wall: its x runs out from the wall."""
        return Frame(self.o, self.n, self.u, -self.r)


def side_frame(side, x0, x1, y0, y1, z=0.0):
    """The frame of one side of a box in plan, origin at that side's left foot seen from
    outside. Returns (frame, length)."""
    if side == "front":
        return Frame((x0, y0, z), (1, 0, 0)), x1 - x0
    if side == "right":
        return Frame((x1, y0, z), (0, 1, 0)), y1 - y0
    if side == "back":
        return Frame((x1, y1, z), (-1, 0, 0)), x1 - x0
    return Frame((x0, y1, z), (0, -1, 0)), y1 - y0


SIDES = ("front", "right", "back", "left")


# -- texture coordinates ----------------------------------------------------------------------


def uv_tile(mat, a, b):
    tw, th = TILE[mat]
    return (a / tw, b / th)


def uv_band(name, s, t, depth):
    """A point on a trim band: s yards along it, t across it (0 at its lower edge, 1 at its
    upper), `depth` the world width the band is meant to be seen at."""
    v0, v1, aspect = BANDS[name]
    return (s / (depth * aspect), v0 + (v1 - v0) * t)


def uv_part(name, fx, fy):
    """A point on a part: fx across it, fy DOWN from its top, both 0 to 1."""
    u0, v0, u1, v1 = PARTS[name]["uv"]
    return (u0 + (u1 - u0) * fx, v1 - (v1 - v0) * fy)


def arch_points(x0, x1, top, spring, bottom, power=2.0, steps=10):
    """The outline of an arched opening (the same shape paint.py punches), anticlockwise
    from the bottom left, in whatever units it is given, y measured DOWN like the paintings."""
    cx, a, b = (x0 + x1) / 2.0, (x1 - x0) / 2.0, spring - top
    pts = [(x0, bottom), (x1, bottom)]
    for i in range(steps + 1):
        angle = math.pi * i / steps
        c, s = math.cos(angle), math.sin(angle)
        px = cx + a * math.copysign(abs(c) ** (2.0 / power), c)
        py = spring - b * abs(s) ** (2.0 / power)
        pts.append((px, py))
    return pts


class Model:
    """Collects faces by material, then becomes one mesh object."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Color")
        self.materials = []
        # collision boxes in model yards, Z up: (cx, cy, cz, hx, hy, hz)
        self.boxes = []
        # furniture a body cannot walk through, noted while the room is furnished (part 1):
        # (centre x, centre y, bottom z, top z, half along its length, half across, turn)
        self.furniture = []
        self.base = None
        self.roof_tips = {}
        self.tower = None
        # 0 while building the outside, 1 while building rooms and furniture: the two leave
        # as separate meshes, the way the town renderer expects an interior
        self.part = 0
        self.part_layer = self.bm.faces.layers.int.new("part")
        # Parts the game shows and hides by name (named_part): part number -> object name.
        self.named = {}
        # a colour every face built from here on is multiplied by (through its vertex
        # colour): how a painted band becomes iron, canvas, tar or an apple
        self.tint = (1.0, 1.0, 1.0)
        # named points a loader looks up on the model (a lamp's light, a mailbox's glow)
        self.sockets = {}

    # -- low level ----------------------------------------------------------------------------

    def _mat(self, name):
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def face(self, points, uvs, mat, shade=1.0, facing=None, smooth=False):
        """One polygon. `facing` is a direction its front must look toward: the winding is
        turned over when it does not, so no part can end up inside out."""
        points = [Vector(p) for p in points]
        uvs = list(uvs)
        shades = list(shade) if isinstance(shade, (list, tuple)) else [shade] * len(points)
        if facing is not None:
            normal = Vector((0.0, 0.0, 0.0))
            for i in range(len(points)):
                a, b = points[i], points[(i + 1) % len(points)]
                normal += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
            if normal.dot(Vector(facing)) < 0.0:
                points.reverse()
                uvs.reverse()
                shades.reverse()
        try:
            f = self.bm.faces.new([self.bm.verts.new(p) for p in points])
        except ValueError:
            return None
        f.material_index = self._mat(mat)
        f.smooth = smooth
        f[self.part_layer] = self.part
        for i, loop in enumerate(f.loops):
            loop[self.uv].uv = uvs[i]
            s = max(0.0, min(1.0, shades[i]))
            loop[self.col] = (s * self.tint[0], s * self.tint[1], s * self.tint[2], 1.0)
        return f

    def collide(self, x0, x1, y0, y1, z0, z1):
        self.boxes.append(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, abs(x1 - x0) / 2, abs(y1 - y0) / 2, abs(z1 - z0) / 2))

    def furnish(self, centre, z0, z1, half_along, half_across, turn=0.0):
        """Notes one piece of indoor furniture as solid: a box standing on `centre` (kit x, y),
        `half_along` its own length and `half_across` it, turned `turn` radians. Only what is
        built into a room counts (part 1): the same helpers dress yards and quays, which the
        game collides from their own records."""
        if self.part == 1:
            self.furniture.append((centre[0], centre[1], z0, z1, half_along, half_across, turn))

    def named_part(self, name):
        """A part exported as an object of its own under `name`, for the pieces the game
        shows and hides by name (Lantern Hall's trophies, render/highwatch_guild_trophies.ts).
        Returns the part number: set `self.part` to it while building the piece, and back
        after. A name holding `_INT_` joins the building's interior in the town views."""
        number = 2 + len(self.named)
        self.named[number] = name
        return number

    # -- boxes and beams ----------------------------------------------------------------------

    def box(self, fr, x0, x1, y0, y1, z0, z1, skin, shade=1.0, skip="", front=None):
        """A box in a frame. `skin` textures it:
          ("tile", material)            the tile at world scale;
          ("band", name, axis, depth)   a trim band running along the frame axis "x", "y", "z";
          ("rect", material, u0, v0, u1, v1)  one rectangle of a texture on the front, its
                                        edges smeared round the sides.
        `front` paints the outward face with a part instead: (part, fx0, fy0, fx1, fy1).
        `skip` leaves faces out: f(ront) k(back) l(eft) r(ight) t(op) b(ottom)."""
        kind = skin[0]
        faces = {
            "f": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 1), fr.n, 0.97),
            "k": ([(x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0)], (0, 1), -fr.n, 0.8),
            "l": ([(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)], (2, 1), -fr.r, 0.84),
            "r": ([(x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1)], (2, 1), fr.r, 0.84),
            "t": ([(x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0)], (0, 2), fr.u, 1.0),
            "b": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, 2), -fr.u, 0.58),
        }
        lo = (x0, y0, z0)
        size = (x1 - x0, y1 - y0, z1 - z0)
        for key, (corners, (ia, ib), facing, lit) in faces.items():
            if key in skip:
                continue
            pts = [fr.p(*c) for c in corners]
            if key == "f" and front is not None:
                part, fx0, fy0, fx1, fy1 = front
                uvs = [uv_part(part, fx0 + (fx1 - fx0) * (c[0] - x0) / size[0], fy1 - (fy1 - fy0) * (c[1] - y0) / size[1]) for c in corners]
                self.face(pts, uvs, "parts_solid", shade * lit, facing)
                continue
            if kind == "tile":
                mat = skin[1]
                uvs = [uv_tile(mat, c[ia], c[ib]) for c in corners]
            elif kind == "band":
                _, name, axis, depth = skin
                along = "xyz".index(axis)
                mat = "trim"
                if ia == along:
                    uvs = [uv_band(name, c[ia], (c[ib] - lo[ib]) / size[ib], depth) for c in corners]
                elif ib == along:
                    uvs = [uv_band(name, c[ib], (c[ia] - lo[ia]) / size[ia], depth) for c in corners]
                else:
                    uvs = [uv_band(name, c[ia], (c[ib] - lo[ib]) / size[ib], depth) for c in corners]
            else:
                _, mat, u0, v0, u1, v1 = skin
                if key in "fk":
                    uvs = [(u0 + (u1 - u0) * (c[0] - x0) / size[0], v0 + (v1 - v0) * (c[1] - y0) / size[1]) for c in corners]
                elif key in "lr":
                    ue = u0 + (u1 - u0) * (0.08 if key == "l" else 0.92)
                    uvs = [(ue + (u1 - u0) * 0.04 * (c[2] - z0) / size[2], v0 + (v1 - v0) * (c[1] - y0) / size[1]) for c in corners]
                else:
                    ve = v0 + (v1 - v0) * (0.92 if key == "t" else 0.08)
                    uvs = [(u0 + (u1 - u0) * (c[0] - x0) / size[0], ve + (v1 - v0) * 0.04 * (c[2] - z0) / size[2]) for c in corners]
            self.face(pts, uvs, mat, shade * lit, facing)

    def sweep(self, points, sizes, band, depth=None, up=UP, shade=1.0, caps=True, offset=0.0):
        """A rectangular beam along a path, with a (width, height) at every point so it can
        taper. The trim band runs along it."""
        points = [Vector(p) for p in points]
        up = Vector(up)
        sections = []
        for i, p in enumerate(points):
            tangent = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
            side = tangent.cross(up)
            if side.length < 1e-5:
                side = tangent.cross(Vector((1.0, 0.0, 0.0)))
            side.normalize()
            normal = side.cross(tangent).normalized()
            w, h = sizes[i] if isinstance(sizes, list) else sizes
            sections.append((p, side * (w / 2), normal * (h / 2)))
        depth = depth or (sizes[0][1] if isinstance(sizes, list) else sizes[1])
        s = offset
        for i in range(len(points) - 1):
            (p0, s0, n0), (p1, s1, n1) = sections[i], sections[i + 1]
            length = (p1 - p0).length
            ring0 = [p0 - s0 - n0, p0 + s0 - n0, p0 + s0 + n0, p0 - s0 + n0]
            ring1 = [p1 - s1 - n1, p1 + s1 - n1, p1 + s1 + n1, p1 - s1 + n1]
            outward = [-(n0 + n1), (s0 + s1), (n0 + n1), -(s0 + s1)]
            lit = [0.6, 0.86, 1.0, 0.86]
            for k in range(4):
                j = (k + 1) % 4
                pts = [ring0[k], ring0[j], ring1[j], ring1[k]]
                uvs = [uv_band(band, s, 0.0, depth), uv_band(band, s, 1.0, depth), uv_band(band, s + length, 1.0, depth), uv_band(band, s + length, 0.0, depth)]
                self.face(pts, uvs, "trim", shade * lit[k], outward[k])
            s += length
        if caps:
            for (p, sd, nm), sign in ((sections[0], -1.0), (sections[-1], 1.0)):
                tangent = (points[1] - points[0]) if sign < 0 else (points[-1] - points[-2])
                pts = [p - sd - nm, p + sd - nm, p + sd + nm, p - sd + nm]
                uvs = [uv_band(band, 0.0, 0.2, depth), uv_band(band, depth * 0.3, 0.2, depth), uv_band(band, depth * 0.3, 0.8, depth), uv_band(band, 0.0, 0.8, depth)]
                self.face(pts, uvs, "trim", shade * 0.9, tangent * sign)
        return s

    def gem(self, centre, size, band="gilded", stretch=1.4, shade=1.0):
        """A faceted stud or finial: a little octahedron."""
        c = Vector(centre)
        tips = [c + UP * size * stretch, c - UP * size * stretch]
        ring = [c + Vector((size, 0, 0)), c + Vector((0, size, 0)), c + Vector((-size, 0, 0)), c + Vector((0, -size, 0))]
        for i in range(4):
            a, b = ring[i], ring[(i + 1) % 4]
            for tip, lit in ((tips[0], 1.0), (tips[1], 0.72)):
                mid = (a + b + tip) / 3 - c
                uvs = [uv_band(band, 0.02, 0.25, 0.3), uv_band(band, 0.12, 0.25, 0.3), uv_band(band, 0.07, 0.75, 0.3)]
                self.face([a, b, tip], uvs, "trim", shade * lit, mid)

    # -- round things -----------------------------------------------------------------------

    def lathe(self, fr, profile, sides=8, skin=("tile", "stone"), smooth=True, shade=1.0, lean=None, phase=0.5, v0=0.0, arc=None):
        """A surface of revolution about the frame's up axis. `profile` is [(radius, height)]
        going up the OUTSIDE (and inward across a top). `lean` shifts each ring's centre:
        [(dx, dz)]. `skin`: ("tile", material), ("band", name, depth), or ("part", name,
        repeats), which wraps a painting round the shape, mirrored each repeat so it meets
        itself."""
        lean = lean or [(0.0, 0.0)] * len(profile)
        start, end = arc if arc else (0.0, 360.0)
        steps = sides
        angles = [math.radians(start + (end - start) * (i + (phase if arc is None else 0.0)) / steps) for i in range(steps + 1)]
        max_r = max(r for r, _h in profile)
        lengths = [0.0]
        for (r0, h0), (r1, h1) in zip(profile, profile[1:]):
            lengths.append(lengths[-1] + math.hypot(r1 - r0, h1 - h0))
        total = lengths[-1] or 1.0
        for j in range(len(profile) - 1):
            (r0, h0), (r1, h1) = profile[j], profile[j + 1]
            dr, dh = r1 - r0, h1 - h0
            seg = math.hypot(dr, dh) or 1.0
            nr, nu = dh / seg, -dr / seg
            for i in range(steps):
                a0, a1 = angles[i], angles[i + 1]
                am = (a0 + a1) / 2

                def ring(r, h, a, k):
                    return fr.p(r * math.cos(a) + lean[k][0], h, r * math.sin(a) + lean[k][1])

                pts = [ring(r0, h0, a0, j), ring(r0, h0, a1, j), ring(r1, h1, a1, j + 1), ring(r1, h1, a0, j + 1)]
                facing = fr.d(math.cos(am) * nr, nu, math.sin(am) * nr)
                f0, f1 = i / steps, (i + 1) / steps
                if skin[0] == "tile":
                    mat = skin[1]
                    around = math.radians(end - start) * max_r
                    uvs = [uv_tile(mat, f0 * around, v0 + lengths[j]), uv_tile(mat, f1 * around, v0 + lengths[j]), uv_tile(mat, f1 * around, v0 + lengths[j + 1]), uv_tile(mat, f0 * around, v0 + lengths[j + 1])]
                elif skin[0] == "band":
                    mat = "trim"
                    _, name, depth = skin
                    around = math.radians(end - start) * max_r
                    t0, t1 = lengths[j] / total, lengths[j + 1] / total
                    uvs = [uv_band(name, f0 * around, t0, depth), uv_band(name, f1 * around, t0, depth), uv_band(name, f1 * around, t1, depth), uv_band(name, f0 * around, t1, depth)]
                else:
                    mat = skin[3] if len(skin) > 3 else "parts_solid"
                    name, repeats = skin[1], skin[2]
                    per = steps / repeats

                    def across(f_index):
                        t = (f_index % per) / per
                        return t if int(f_index // per) % 2 == 0 else 1.0 - t

                    k0 = across(i)
                    k1 = across(i + 1) if (i + 1) % per else (1.0 if int(i // per) % 2 == 0 else 0.0)
                    t0, t1 = lengths[j] / total, lengths[j + 1] / total
                    uvs = [uv_part(name, k0, 1.0 - t0), uv_part(name, k1, 1.0 - t0), uv_part(name, k1, 1.0 - t1), uv_part(name, k0, 1.0 - t1)]
                if r1 < 1e-5:
                    pts, uvs = pts[:3], uvs[:3]
                elif r0 < 1e-5:
                    pts, uvs = [pts[0], pts[2], pts[3]], [uvs[0], uvs[2], uvs[3]]
                lit = shade * (0.74 + 0.26 * max(0.0, min(1.0, 0.5 + 0.5 * nu + 0.25)))
                self.face(pts, uvs, mat, lit, facing, smooth=smooth)

    # -- painted parts with real thickness ----------------------------------------------------

    def relief(self, fr, name, width, thick, back=False, mirror=False, anchor=(0.0, 0.0), shade=1.0, edge=0.78, front=True):
        """A painted part as a solid slab: the painting on its front, an edge wall that
        follows the traced outline of the paint from the frame's plane out to `thick`.
        `anchor` is where the frame's origin sits in the part, (0, 0) its bottom left,
        (0.5, 1) the middle of its top. Returns its height."""
        part = PARTS[name]
        height = width / part["aspect"]
        ax, ay = anchor

        def place(fx, fy, z):
            x = ((1.0 - fx) if mirror else fx) * width - ax * width
            return fr.p(x, (1.0 - fy) * height - ay * height, z)

        corners = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
        if front:
            self.face([place(fx, fy, thick) for fx, fy in corners], [uv_part(name, fx, fy) for fx, fy in corners], "parts", shade, fr.n)
        if back:
            self.face([place(fx, fy, 0.0) for fx, fy in corners], [uv_part(name, fx, fy) for fx, fy in corners], "parts", shade * 0.9, -fr.n)
        u0, v0, u1, v1 = part["uv"]
        px_w, px_h = (u1 - u0) * ATLAS_PX, (v1 - v0) * ATLAS_PX
        inset = 5.0
        for loop in part["loops"]:
            n = len(loop)
            for i in range(n):
                a, b = loop[i], loop[(i + 1) % n]
                if abs(a[0] - b[0]) < 1e-6 and abs(a[1] - b[1]) < 1e-6:
                    continue
                # the wall takes its colour from just inside the paint at each outline point
                ua = uv_part(name, min(1.0, max(0.0, a[0] + a[2] * inset / px_w)), min(1.0, max(0.0, a[1] + a[3] * inset / px_h)))
                ub = uv_part(name, min(1.0, max(0.0, b[0] + b[2] * inset / px_w)), min(1.0, max(0.0, b[1] + b[3] * inset / px_h)))
                pts = [place(a[0], a[1], 0.0), place(b[0], b[1], 0.0), place(b[0], b[1], thick), place(a[0], a[1], thick)]
                # outward is away from the paint, at right angles to this stretch of outline
                ex, ey = b[0] - a[0], b[1] - a[1]
                out_x, out_y = ey * px_h, -ex * px_w
                facing = fr.d(-out_x if mirror else out_x, -out_y, 0.0)
                lit = edge * (1.0 if out_y < 0 else 0.82)
                self.face(pts, [ua, ub, ub, ua], "parts_solid", shade * lit, facing)
        return height

    def cloth(self, fr, name, width, bulge=0.0, wave=0.0, cols=3, rows=3, anchor=(0.0, 1.0), shade=1.0, sub=(0.0, 0.0, 1.0, 1.0)):
        """A sheet of cloth or netting: the painting on a mesh that billows a little, cut to
        its painted edge. `anchor` as for a relief. Returns its height."""
        part = PARTS[name]
        fx0, fy0, fx1, fy1 = sub
        height = width / part["aspect"] * (fy1 - fy0) / (fx1 - fx0)
        ax, ay = anchor

        def place(tx, ty):
            x = tx * width - ax * width
            y = (1.0 - ty) * height - ay * height
            z = bulge * math.sin(math.pi * tx) * (0.35 + 0.65 * ty) + wave * math.sin(tx * math.pi * 2.2 + ty * 2.0) * ty
            return fr.p(x, y, z)

        for i in range(cols):
            for j in range(rows):
                t = [(i / cols, j / rows), ((i + 1) / cols, j / rows), ((i + 1) / cols, (j + 1) / rows), (i / cols, (j + 1) / rows)]
                pts = [place(tx, ty) for tx, ty in t]
                uvs = [uv_part(name, fx0 + (fx1 - fx0) * tx, fy0 + (fy1 - fy0) * ty) for tx, ty in t]
                self.face(pts, uvs, "parts", shade, fr.n, smooth=True)
        return height

    def poly(self, fr, pts2d, z, uv, mat, shade=1.0, facing=None):
        """A flat polygon in the frame's plane, `z` out from it. `uv` maps (x, y) to a UV."""
        self.face([fr.p(x, y, z) for x, y in pts2d], [uv(x, y) for x, y in pts2d], mat, shade, fr.n if facing is None else facing)

    # -- walls --------------------------------------------------------------------------------

    def wall(self, fr, width, height, mat, u0=0.0, v0=0.0, batter=0.0, shade=(0.8, 1.0), fit=False):
        """A plain wall panel: x from 0 to width, y from 0 to height. `batter` leans the top
        back. `fit` squeezes the tile a touch so a whole number of bays fills the wall."""
        tw, th = TILE[mat]
        su = (max(1, round(width)) / width) if fit else 1.0
        pts = [fr.p(0, 0, 0), fr.p(width, 0, 0), fr.p(width, height, -batter), fr.p(0, height, -batter)]
        uvs = [((u0) * su / tw, v0 / th), ((u0 + width) * su / tw, v0 / th), ((u0 + width) * su / tw, (v0 + height) / th), (u0 * su / tw, (v0 + height) / th)]
        self.face(pts, uvs, mat, [shade[0], shade[0], shade[1], shade[1]], fr.n)

    def timber_wall(self, fr, width, height=STOREY, proud=0.07, ends=True, plate=True, sill=True, shade=(0.86, 1.0)):
        """One storey of framed wall. The plaster and the arch braces are the painting; every
        post, the sill beam and the top plate are real members standing proud of it, each one
        carrying its own strip of the same painting."""
        tw, th = TILE["timber"]
        bays = max(1, round(width))
        tiles = bays / tw
        self.face(
            [fr.p(0, 0, 0), fr.p(width, 0, 0), fr.p(width, height, 0), fr.p(0, height, 0)],
            [(0.0, 0.0), (tiles, 0.0), (tiles, 1.0), (0.0, 1.0)],
            "timber",
            [shade[0], shade[0], shade[1], shade[1]],
            fr.n,
        )
        per = width / tiles  # yards per repeat of the tile, after fitting
        v_top = 1.0
        y_sill = (1.0 - TIMBER_SILL) * height
        y_plate = height - TIMBER_PLATE * height
        mid_post = TIMBER_POSTS[1]
        post_w = (mid_post[1] - mid_post[0]) * per
        wrap = proud if ends else 0.0
        if ends:
            # a full post on each corner, wrapping round to meet the next wall's
            self.box(fr, -wrap, post_w, 0.0, height, 0.0, proud, ("rect", "timber", mid_post[0], 0.0, mid_post[1], v_top), skip="k", shade=0.98)
            self.box(fr, width - post_w, width + wrap, 0.0, height, 0.0, proud, ("rect", "timber", mid_post[0], 0.0, mid_post[1], v_top), skip="k", shade=0.98)
        for k in range(int(math.ceil(tiles)) + 1):
            for left, right in TIMBER_POSTS + ((-(1.0 - TIMBER_EDGE[1]), TIMBER_EDGE[0]),):
                x0, x1 = (k + left) * per, (k + right) * per
                if x0 < post_w + 0.05 or x1 > width - post_w - 0.05:
                    continue
                self.box(fr, x0, x1, 0.0, height, 0.0, proud, ("rect", "timber", k + left, 0.0, k + right, v_top), skip="k", shade=0.98)
        if sill:
            self.box(fr, -wrap - 0.035, width + wrap + 0.035, 0.0, y_sill, 0.0, proud + 0.035, ("rect", "timber", 0.0, 0.0, tiles, 1.0 - TIMBER_SILL), skip="k")
        if plate:
            self.box(fr, -wrap - 0.035, width + wrap + 0.035, y_plate, height, 0.0, proud + 0.035, ("rect", "timber", 0.0, v_top - TIMBER_PLATE, tiles, v_top), skip="k")

    def storey(self, x0, x1, y0, y1, z0, z1, kind="timber", sides=SIDES, batter=0.0, collide=True, plate=True, sill=True):
        """The walls of one storey of a rectangular building."""
        for side in sides:
            fr, length = side_frame(side, x0, x1, y0, y1, z0)
            if kind == "timber":
                self.timber_wall(fr, length, z1 - z0, plate=plate, sill=sill)
            else:
                self.wall(fr, length, z1 - z0, kind, batter=batter)
        if collide:
            self.collide(x0, x1, y0, y1, max(z0, 0.0), z1)

    def stone_base(self, x0, x1, y0, y1, z1, batter=0.16, plinth=0.55, flare=0.2, gap=None, back_gap=None):
        """A stone ground floor, battered, on a sloped plinth, with a footing that runs into
        the ground so sloping grass never shows a gap. `gap` = (from x, to x, height) leaves
        a doorway open in the front wall."""
        corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        top = [(x0 + batter, y0 + batter), (x1 - batter, y0 + batter), (x1 - batter, y1 - batter), (x0 + batter, y1 - batter)]
        skirt = [(x0 - flare, y0 - flare), (x1 + flare, y0 - flare), (x1 + flare, y1 + flare), (x0 - flare, y1 + flare)]
        mid = [(x0 - 0.04, y0 - 0.04), (x1 + 0.04, y0 - 0.04), (x1 + 0.04, y1 + 0.04), (x0 - 0.04, y1 + 0.04)]
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        run = 0.0
        for i in range(4):
            j = (i + 1) % 4
            length = math.hypot(corners[j][0] - corners[i][0], corners[j][1] - corners[i][1])
            out = Vector(((corners[i][0] + corners[j][0]) / 2 - cx, (corners[i][1] + corners[j][1]) / 2 - cy, 0.0))
            if i == 0 and gap:
                # the front wall in three pieces round the doorway (walls with a doorway
                # stand plumb), and no plinth across the threshold
                ga, gb, gtop = gap
                for xa, xb, za, zb in ((x0, ga, -FOOTING, z1), (gb, x1, -FOOTING, z1), (ga, gb, gtop, z1)):
                    pts = [(xa, y0, za), (xb, y0, za), (xb, y0, zb), (xa, y0, zb)]
                    uvs = [uv_tile("stone", xa - x0, za), uv_tile("stone", xb - x0, za), uv_tile("stone", xb - x0, zb), uv_tile("stone", xa - x0, zb)]
                    self.face(pts, uvs, "stone", [0.86, 0.86, 1.0, 1.0], out)
                    if za < 0.0:
                        skirt_pts = [(xa, y0 - flare, 0.0), (xb, y0 - flare, 0.0), (xb, y0 - 0.04, plinth - 0.06), (xa, y0 - 0.04, plinth - 0.06)]
                        self.face(skirt_pts, [uv_tile("stone", xa - x0, 0.0), uv_tile("stone", xb - x0, 0.0), uv_tile("stone", xb - x0, plinth), uv_tile("stone", xa - x0, plinth)], "stone", [0.74, 0.74, 0.9, 0.9], out)
                        ledge = [(xa, y0 - 0.04, plinth - 0.06), (xb, y0 - 0.04, plinth - 0.06), (xb, y0, plinth), (xa, y0, plinth)]
                        self.face(ledge, [uv_tile("stone", xa - x0, plinth), uv_tile("stone", xb - x0, plinth), uv_tile("stone", xb - x0, plinth + 0.12), uv_tile("stone", xa - x0, plinth + 0.12)], "stone", 1.0, Vector((0.0, -1.0, 4.0)))
                        foot = [(xa, y0 - flare, -FOOTING), (xb, y0 - flare, -FOOTING), (xb, y0 - flare, 0.0), (xa, y0 - flare, 0.0)]
                        self.face(foot, [uv_tile("stone", xa - x0, -FOOTING), uv_tile("stone", xb - x0, -FOOTING), uv_tile("stone", xb - x0, 0.0), uv_tile("stone", xa - x0, 0.0)], "stone", 0.7, out)
                run += length
                continue
            # the wall proper (the back wall in three pieces when a wing opens off it)
            if i == 2 and back_gap:
                ga, gb, gtop = back_gap
                for xa, xb, za, zb in ((x0, ga, plinth, z1), (gb, x1, plinth, z1), (ga, gb, gtop, z1)):
                    pts = [(xb, y1, za), (xa, y1, za), (xa, y1, zb), (xb, y1, zb)]
                    uvs = [uv_tile("stone", x1 - xb, za), uv_tile("stone", x1 - xa, za), uv_tile("stone", x1 - xa, zb), uv_tile("stone", x1 - xb, zb)]
                    self.face(pts, uvs, "stone", [0.9, 0.9, 1.0, 1.0], out)
            else:
                pts = [(*corners[i], plinth), (*corners[j], plinth), (*top[j], z1), (*top[i], z1)]
                uvs = [uv_tile("stone", run, plinth), uv_tile("stone", run + length, plinth), uv_tile("stone", run + length, z1), uv_tile("stone", run, z1)]
                self.face(pts, uvs, "stone", [0.9, 0.9, 1.0, 1.0], out)
            # the plinth: a sloped course, its little top ledge, and the footing below ground
            pts = [(*skirt[i], 0.0), (*skirt[j], 0.0), (*mid[j], plinth - 0.06), (*mid[i], plinth - 0.06)]
            uvs = [uv_tile("stone", run, 0.0), uv_tile("stone", run + length, 0.0), uv_tile("stone", run + length, plinth), uv_tile("stone", run, plinth)]
            self.face(pts, uvs, "stone", [0.74, 0.74, 0.9, 0.9], out)
            pts = [(*mid[i], plinth - 0.06), (*mid[j], plinth - 0.06), (*corners[j], plinth), (*corners[i], plinth)]
            uvs = [uv_tile("stone", run, plinth), uv_tile("stone", run + length, plinth), uv_tile("stone", run + length, plinth + 0.12), uv_tile("stone", run, plinth + 0.12)]
            self.face(pts, uvs, "stone", 1.0, Vector((out.x, out.y, 4.0)))
            pts = [(*skirt[i], -FOOTING), (*skirt[j], -FOOTING), (*skirt[j], 0.0), (*skirt[i], 0.0)]
            uvs = [uv_tile("stone", run, -FOOTING), uv_tile("stone", run + length, -FOOTING), uv_tile("stone", run + length, 0.0), uv_tile("stone", run, 0.0)]
            self.face(pts, uvs, "stone", 0.7, out)
            run += length
        self.collide(x0, x1, y0, y1, 0.0, z1)
        self.base = dict(x0=x0, x1=x1, y0=y0, y1=y1, z1=z1, batter=batter, plinth=plinth)

    def base_frame(self, side, along, height=0.0):
        """A frame ON the battered stone base: `along` yards from that side's left corner,
        `height` up from the ground, leaning back with the wall so a door or a window set on
        it sits flush from top to bottom."""
        b = self.base
        fr, _length = side_frame(side, b["x0"], b["x1"], b["y0"], b["y1"], 0.0)
        slope = b["batter"] / (b["z1"] - b["plinth"])
        lean = Frame(fr.o, fr.r, UP - fr.n * slope, None)
        # the wall plane passes through the top of the plinth
        origin = fr.p(along, b["plinth"], 0.0) + lean.u * ((height - b["plinth"]) / lean.u.z)
        return Frame(origin, fr.r, lean.u, None)

    def soffit(self, outer, inner, z, band="planks", shade=0.55):
        """The boarded underside of an overhanging storey, as four strips of boards: `outer`
        and `inner` are (x0, x1, y0, y1) of the storey above and of the wall below."""
        ox0, ox1, oy0, oy1 = outer
        ix0, ix1, iy0, iy1 = inner
        strips = (
            ((ox0, oy0), (ox1, oy0), (ix1, iy0), (ix0, iy0)),
            ((ox1, oy0), (ox1, oy1), (ix1, iy1), (ix1, iy0)),
            ((ox1, oy1), (ox0, oy1), (ix0, iy1), (ix1, iy1)),
            ((ox0, oy1), (ox0, oy0), (ix0, iy0), (ix0, iy1)),
        )
        for a, b, c, d in strips:
            length = math.hypot(b[0] - a[0], b[1] - a[1])
            uvs = [uv_band(band, 0.0, 0.0, 0.6), uv_band(band, length, 0.0, 0.6), uv_band(band, length, 1.0, 0.6), uv_band(band, 0.0, 1.0, 0.6)]
            self.face([(*a, z), (*b, z), (*c, z), (*d, z)], uvs, "trim", shade, (0, 0, -1))

    # -- roofs --------------------------------------------------------------------------------

    def swept_roof(
        self,
        x0,
        x1,
        y0,
        y1,
        z,
        rise,
        ridge="y",
        eave_out=0.95,
        eave_drop=0.45,
        curve=1.55,
        gable_out=0.55,
        prow=1.5,
        sweep=0.7,
        thick=0.24,
        mat="slate",
        board=0.5,
        horn=1.5,
        ends=(True, True),
        gable="timber",
        gable_v0=0.0,
        collide=True,
    ):
        """The roof every house here wears: a bell-cast slope that flares at the eave, a
        saddle ridge that rises toward both gables, each gable pushed out further at the
        ridge than at the eave so it leans over the street like a prow, thick gold-studded
        bargeboards on its edges and the ridge beam running on into an upturned horn.
        `ends` says which gables get the prow, (low end, high end) along the ridge axis.
        Returns a function giving the roof surface: surface(along, across) -> height."""
        along_y = ridge == "y"
        length = (y1 - y0) if along_y else (x1 - x0)
        half = ((x1 - x0) if along_y else (y1 - y0)) / 2.0
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        span = half + eave_out
        t_grid = [0.0, 0.16, 0.38, 0.66, 1.0]
        f_grid = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0]
        prows = prow if isinstance(prow, tuple) else (prow, prow)
        horns = horn if isinstance(horn, tuple) else (horn, horn)
        reach = length / 2 + gable_out + max(prows)

        def profile(t):
            return span * (1.0 - t), -eave_drop + (rise + eave_drop) * t**curve

        def out_at(t, f):
            end = 0 if f < 0 else 1
            return gable_out + prows[end] * t**1.6 if ends[end] else 0.0

        def lift(a, t):
            return sweep * (a / reach) ** 2 * (0.3 + 0.7 * t)

        def world(a, s, h):
            return Vector((cx + s, cy + a, z + h)) if along_y else Vector((cx + a, cy + s, z + h))

        def point(f, t, sign):
            s, h = profile(t)
            a = f * (length / 2 + out_at(t, f))
            return world(a, sign * s, h + lift(a, t))

        def across_dir(sign):
            return Vector((sign, 0.0, 0.0)) if along_y else Vector((0.0, sign, 0.0))

        def along_dir(sign):
            return Vector((0.0, sign, 0.0)) if along_y else Vector((sign, 0.0, 0.0))

        tw, th = TILE[mat]
        arc = [0.0]
        for k in range(len(t_grid) - 1):
            s0, h0 = profile(t_grid[k])
            s1, h1 = profile(t_grid[k + 1])
            arc.append(arc[-1] + math.hypot(s1 - s0, h1 - h0))
        down = UP * thick
        for sign in (-1.0, 1.0):
            facing = UP + across_dir(sign) * 0.4
            for i in range(len(f_grid) - 1):
                for k in range(len(t_grid) - 1):
                    quad = [(f_grid[i], t_grid[k]), (f_grid[i + 1], t_grid[k]), (f_grid[i + 1], t_grid[k + 1]), (f_grid[i], t_grid[k + 1])]
                    pts = [point(f, t, sign) for f, t in quad]
                    ks = [k, k, k + 1, k + 1]
                    uvs = []
                    for (f, t), kk in zip(quad, ks):
                        a = f * (length / 2 + out_at(t, f))
                        uvs.append(((a + length) / tw, arc[kk] / th))
                    lit = [0.8 + 0.2 * t for _f, t in quad]
                    self.face(pts, uvs, mat, lit, facing, smooth=True)
                    # the boarded underside
                    under = [p - down for p in pts]
                    uvu = []
                    for (f, t), across in zip(quad, (0.0, 0.0, 1.0, 1.0)):
                        a = f * (length / 2 + out_at(t, f))
                        uvu.append(uv_band("planks", a, across, 0.6))
                    self.face(under, uvu, "trim", 0.5, -facing)
                # the eave fascia
                e0, e1 = point(f_grid[i], 0.0, sign), point(f_grid[i + 1], 0.0, sign)
                a0 = f_grid[i] * (length / 2 + out_at(0.0, f_grid[i]))
                a1 = f_grid[i + 1] * (length / 2 + out_at(0.0, f_grid[i + 1]))
                uvs = [uv_band("bargeboard", a0, 0.0, 0.34), uv_band("bargeboard", a1, 0.0, 0.34), uv_band("bargeboard", a1, 1.0, 0.34), uv_band("bargeboard", a0, 1.0, 0.34)]
                self.face([e0 - down - UP * 0.06, e1 - down - UP * 0.06, e1 + UP * 0.04, e0 + UP * 0.04], uvs, "trim", 0.92, across_dir(sign))
        # bargeboards: a thick board hanging from each gable edge of the roof
        for end_index, f in ((0, -1.0), (1, 1.0)):
            outward = along_dir(f)
            for sign in (-1.0, 1.0):
                run = 0.0
                for k in range(len(t_grid) - 1):
                    p0, p1 = point(f, t_grid[k], sign), point(f, t_grid[k + 1], sign)
                    seg = (p1 - p0).length
                    lift_up = UP * 0.07
                    drop = UP * board
                    off = outward * 0.1
                    a, b = p0 + off + lift_up, p1 + off + lift_up
                    u_a, u_b = run, run + seg
                    uvs = [uv_band("bargeboard", u_a, 0.0, board), uv_band("bargeboard", u_b, 0.0, board), uv_band("bargeboard", u_b, 1.0, board), uv_band("bargeboard", u_a, 1.0, board)]
                    if not ends[end_index]:
                        uvs = [uv_band("oak", u_a, 0.0, board), uv_band("oak", u_b, 0.0, board), uv_band("oak", u_b, 1.0, board), uv_band("oak", u_a, 1.0, board)]
                    self.face([a - drop, b - drop, b, a], uvs, "trim", 1.0, outward)
                    self.face([a - drop - off * 1.6, b - drop - off * 1.6, b - off * 1.6, a - off * 1.6], uvs, "trim", 0.62, -outward)
                    edge_uv = [uv_band("oak", u_a, 0.1, 0.4), uv_band("oak", u_b, 0.1, 0.4), uv_band("oak", u_b, 0.5, 0.4), uv_band("oak", u_a, 0.5, 0.4)]
                    self.face([a - drop - off * 1.6, b - drop - off * 1.6, b - drop, a - drop], edge_uv, "trim", 0.5, -UP)
                    self.face([a - off * 1.6, b - off * 1.6, b, a], edge_uv, "trim", 0.95, UP)
                    run += seg
        # the ridge beam, running on into an upturned horn at each prow
        ridge_pts = [point(f, 1.0, 1.0) + UP * 0.1 for f in f_grid]
        sizes = [(0.34, 0.3)] * len(ridge_pts)
        for end_index, f in ((0, -1.0), (1, 1.0)):
            horn = horns[end_index]
            if not ends[end_index] or horn <= 0.0:
                continue
            tip = ridge_pts[0] if f < 0 else ridge_pts[-1]
            inner = ridge_pts[1] if f < 0 else ridge_pts[-2]
            direction = (tip - inner).normalized()
            extra = [tip + direction * horn * 0.4 + UP * horn * 0.1, tip + direction * horn * 0.72 + UP * horn * 0.34, tip + direction * horn * 0.9 + UP * horn * 0.68, tip + direction * horn * 0.84 + UP * horn * 1.0]
            extra_sizes = [(0.3, 0.3), (0.26, 0.26), (0.2, 0.2), (0.1, 0.1)]
            if f < 0:
                ridge_pts = list(reversed(extra)) + ridge_pts
                sizes = list(reversed(extra_sizes)) + sizes
            else:
                ridge_pts = ridge_pts + extra
                sizes = sizes + extra_sizes
        self.sweep(ridge_pts, sizes, "gilded", depth=0.34)
        self.roof_tips = {}
        for end_index, f in ((0, -1.0), (1, 1.0)):
            self.roof_tips[end_index] = (point(f, 1.0, 1.0), along_dir(f))

        def surface(a, s):
            """Height of the roof top over a point `a` along the ridge from the centre and
            `s` out from the ridge line."""
            t = max(0.0, min(1.0, 1.0 - abs(s) / span))
            return z + profile(t)[1] + lift(a, t)

        if gable:
            gw, gh = TILE[gable] if gable in TILE else (1.0, 1.0)
            for end_index, f in ((0, -1.0), (1, 1.0)):
                a = f * length / 2
                outward = along_dir(f)
                outline = [(-half, 0.0), (half, 0.0)]
                steps = 10
                for i in range(steps + 1):
                    s = half - 2 * half * i / steps
                    outline.append((s, max(0.02, surface(a, s) - z - thick * 0.6)))
                pts = [world(a, s, h) for s, h in outline]
                # read left to right from outside
                mirror = (f > 0) if along_y else (f < 0)
                bays = max(1, round(2 * half))
                tiles = bays / gw if gable == "timber" else 2 * half / gw
                uvs = []
                for s, h in outline:
                    u = (half - s if mirror else s + half) / (2 * half) * tiles
                    uvs.append((u, (gable_v0 + h) / gh))
                shades = [0.86 + 0.14 * min(1.0, max(0.0, h) / max(rise, 0.01)) for _s, h in outline]
                self.face(pts, uvs, gable, shades, outward)
        if collide:
            for lo_f, hi_f, width_f in ((0.0, 0.45, 0.74), (0.45, 0.9, 0.34)):
                w = half * width_f
                if along_y:
                    self.collide(cx - w, cx + w, y0, y1, z + rise * lo_f, z + rise * hi_f)
                else:
                    self.collide(x0, x1, cy - w, cy + w, z + rise * lo_f, z + rise * hi_f)
        return surface

    def shed_roof(self, p_low_a, p_low_b, p_high_b, p_high_a, thick=0.2, mat="slate"):
        """A single-pitch roof from its four corners (low edge a to b, then the high edge b
        to a), with a boarded underside and a studded fascia on the low edge."""
        pts = [Vector(p) for p in (p_low_a, p_low_b, p_high_b, p_high_a)]
        run = (pts[1] - pts[0]).length
        slope = (pts[3] - pts[0]).length
        self.face(pts, [uv_tile(mat, 0.0, 0.0), uv_tile(mat, run, 0.0), uv_tile(mat, run, slope), uv_tile(mat, 0.0, slope)], mat, [0.84, 0.84, 1.0, 1.0], UP)
        under = [p - UP * thick for p in pts]
        self.face(under, [uv_band("planks", 0.0, 0.0, 0.6), uv_band("planks", run, 0.0, 0.6), uv_band("planks", run, 1.0, 0.6), uv_band("planks", 0.0, 1.0, 0.6)], "trim", 0.5, -UP)
        out = (pts[0] - pts[3])
        out.z = 0.0
        uvs = [uv_band("bargeboard", 0.0, 0.0, 0.34), uv_band("bargeboard", run, 0.0, 0.34), uv_band("bargeboard", run, 1.0, 0.34), uv_band("bargeboard", 0.0, 1.0, 0.34)]
        self.face([under[0] - UP * 0.1, under[1] - UP * 0.1, pts[1] + UP * 0.04, pts[0] + UP * 0.04], uvs, "trim", 0.92, out)
        for a, b in ((0, 3), (1, 2)):
            side = (pts[a] - pts[1 - a]) if a < 2 else out
            self.face([under[a], under[b], pts[b], pts[a]], [uv_band("oak", 0.0, 0.0, 0.3), uv_band("oak", slope, 0.0, 0.3), uv_band("oak", slope, 1.0, 0.3), uv_band("oak", 0.0, 1.0, 0.3)], "trim", 0.8, side)

    # -- joinery: windows, doors and the rest ----------------------------------------------------

    def glass(self, fr, pts2d, z=0.02, shade=1.0, kind="glass"):
        """Lit leaded glass over a polygon in the frame's plane: `kind` is "glass", the amber
        quarries every house has, or "stained", the same leading in sapphire and rose (a
        chapel's lights)."""
        self.poly(fr, pts2d, z, lambda x, y: uv_tile(kind, x + 0.31, y + 0.17), kind, shade)

    def casement(self, fr, width=1.6, shutters=True, flowers=True, open_deg=26.0):
        """A casement window, centred on the frame's origin at sill height: glass set back
        behind a real frame and mullion, a carved lintel standing further out again, a flower
        box below, two shutters hung open on their hinges."""
        k = 340.0 / width  # painting pixels per yard

        def x(sx):
            return (sx - 366.0) / k

        def y(sy):
            return (410.0 - sy) / k

        self.glass(fr, [(x(240), y(326)), (x(490), y(326)), (x(490), y(128)), (x(240), y(128))])
        self.relief(fr.at(x(196), y(410)), "win_frame", 340.0 / k, 0.13)
        self.relief(fr.at(x(128), y(116)), "win_lintel", 462.0 / k, 0.3)
        if flowers:
            self.relief(fr.at(x(148), y(518)), "win_box", 414.0 / k, 0.42)
            # plants standing in the box: one row upright at the back, one leaning out
            self.cloth(fr.at(0.0, y(432), 0.2), "flowers_a", 380.0 / k, anchor=(0.5, 0.0), cols=2, rows=1)
            self.cloth(fr.at(0.0, y(440), 0.36).tilted(34), "flowers_b", 350.0 / k, anchor=(0.5, 0.0), cols=2, rows=1)
        if shutters:
            w = 140.0 / k
            a = math.radians(open_deg)
            # left shutter: hinged on its right edge, its free edge swung out from the wall
            hinge = fr.p(x(204), y(404), 0.05)
            r = fr.r * math.cos(a) - fr.n * math.sin(a)
            self.relief(Frame(hinge - r * w, r, fr.u), "shutter", w, 0.07, back=True)
            hinge = fr.p(x(528), y(404), 0.05)
            r = fr.r * math.cos(a) + fr.n * math.sin(a)
            self.relief(Frame(hinge, r, fr.u), "shutter", w, 0.07, back=True, mirror=True)
        return 306.0 / k

    def arch_window(self, fr, width=1.75, keystone=True, sink=0.0):
        """An arched window in a stone surround, centred on the frame's origin at the foot of
        the surround: the glass sits back inside the arch, behind a wooden cross."""
        k = 410.0 / width

        def x(sx):
            return (sx - 949.0) / k

        def y(sy):
            return (476.0 - sy) / k

        opening = [(x(px), y(py)) for px, py in arch_points(857, 1041, 127, 215, 387)]
        self.glass(fr, opening)
        self.box(fr, x(943), x(955), y(386), y(130), 0.02, 0.075, ("band", "oak", "y", 0.12), skip="k", shade=0.7)
        self.box(fr, x(860), x(1038), y(240), y(229), 0.02, 0.075, ("band", "oak", "x", 0.12), skip="k", shade=0.7)
        self.relief(fr.at(x(744), y(476), -sink), "arch_surround", 410.0 / k, 0.24 + sink)
        if keystone:
            self.relief(fr.at(x(902), y(114), 0.24), "keystone", 104.0 / k, 0.13)
        return 470.0 / k

    def lancet(self, fr, width=1.3, height=4.8, kind="stained", proud=0.16, jamb=0.24, band="plaster", steps=6, shade=0.96, border=0.15):
        """A tall pointed light, centred on the frame's origin at its sill: leaded glass under
        an equilateral arch, between dressed jambs that stand proud of the wall, a moulded
        head that follows both arcs up to the point, and a sill under it. With `border`, the
        light is two colours the way a glazier sets one: a margin of the amber house glass
        that wide round a field of `kind`. Returns its height."""
        half = width / 2.0
        rise = width * math.sqrt(3.0) / 2.0
        spring = height - rise
        # the opening, anticlockwise from its bottom left: each arc is struck from the
        # opposite springer, so the two meet in a point
        opening = [(-half, 0.0), (half, 0.0), (half, spring)]
        for i in range(1, steps + 1):
            a = math.radians(60.0 * i / steps)
            opening.append((-half + width * math.cos(a), spring + width * math.sin(a)))
        for i in range(1, steps + 1):
            a = math.radians(120.0 + 60.0 * i / steps)
            opening.append((half + width * math.cos(a), spring + width * math.sin(a)))
        if border and kind != "glass":
            self.glass(fr, opening, z=0.03)
            # the field: the same outline drawn in toward the middle of the light
            mid = height * 0.46
            kx, ky = 1.0 - 2.0 * border / width, 1.0 - 2.0 * border / height
            self.glass(fr, [(px * kx, mid + (py - mid) * ky) for px, py in opening], z=0.042, kind=kind)
        else:
            self.glass(fr, opening, z=0.03, kind=kind)
        dress = jamb * 2.2
        for xa, xb in ((-half - jamb, -half), (half, half + jamb)):
            self.box(fr, xa, xb, 0.0, spring, 0.0, proud, ("band", band, "y", dress), skip="k", shade=shade)
        self.box(fr, -half - jamb - 0.08, half + jamb + 0.08, -0.24, 0.0, 0.0, proud + 0.1, ("band", band, "x", 0.5), skip="k", shade=shade)
        profile = [(width + jamb, 0.0), (width + jamb, proud), (width, proud), (width, 0.0)]
        for cx, arc in ((-half, (0.0, 60.0)), (half, (120.0, 180.0))):
            axis = Frame(fr.p(cx, spring, 0.0), fr.r, fr.n, fr.u)
            self.lathe(axis, profile, sides=steps, skin=("band", band, dress), smooth=False, shade=shade, arc=arc)
        return height

    def rose(self, fr, radius=1.8, petals=8, proud=0.2, ring=0.28, band="plaster", shade=0.96):
        """A rose window, centred on the frame's origin: a wheel of leaded lights, sapphire
        and amber by turns, between stone spokes that run from a round eye to a moulded ring,
        and a gilded boss on the eye. The lights are the leaded tile behind built tracery,
        not a painting of a window. Returns its outer radius."""
        eye = radius * 0.3
        sub = 3
        for k in range(petals):
            kind = "stained" if k % 2 == 0 else "glass"
            for j in range(sub):
                a0 = 2.0 * math.pi * (k + j / sub) / petals
                a1 = 2.0 * math.pi * (k + (j + 1) / sub) / petals
                quad = [
                    (eye * math.cos(a0), eye * math.sin(a0)),
                    (radius * math.cos(a0), radius * math.sin(a0)),
                    (radius * math.cos(a1), radius * math.sin(a1)),
                    (eye * math.cos(a1), eye * math.sin(a1)),
                ]
                self.glass(fr, quad, z=0.03, kind=kind)
        self.glass(fr, [(eye * math.cos(2.0 * math.pi * i / 12), eye * math.sin(2.0 * math.pi * i / 12)) for i in range(12)], z=0.03)
        for k in range(petals):
            a = 2.0 * math.pi * k / petals
            spoke = Frame(fr.o, fr.r * math.cos(a) + fr.u * math.sin(a), fr.u * math.cos(a) - fr.r * math.sin(a), fr.n)
            self.box(spoke, eye, radius, -0.075, 0.075, 0.0, proud * 0.8, ("band", band, "x", 0.3), skip="k", shade=shade)
        axis = Frame(fr.o, fr.r, fr.n, fr.u)
        self.lathe(axis, [(eye + 0.1, 0.0), (eye + 0.1, proud), (eye - 0.08, proud), (eye - 0.08, 0.0)], sides=12, skin=("band", band, 0.4), smooth=False, shade=shade)
        self.lathe(axis, [(radius + ring, 0.0), (radius + ring, proud + 0.08), (radius - 0.05, proud + 0.08), (radius - 0.05, 0.0)], sides=24, skin=("band", band, 0.6), smooth=False, shade=shade)
        self.lathe(axis, [(eye * 0.42, proud * 0.5), (eye * 0.3, proud + 0.1), (0.0, proud + 0.16)], sides=8, skin=("band", "gilded", 0.3), smooth=False)
        return radius + ring

    def arched_wall(self, fr, width, height, span, spring, thick=0.5, mat="stone", steps=8, lit=1.0):
        """A wall with one round-headed opening right through it: x from 0 to width and y
        from 0 to height in the frame, `thick` back from its plane; the opening is `span`
        wide, centred, and springs `spring` above the foot. Both faces, the jambs and the
        soffit are built, so the wall can stand in the open (a belfry stage)."""
        x0, x1 = (width - span) / 2.0, (width + span) / 2.0
        r, cx = span / 2.0, width / 2.0

        def uv(x, y):
            return uv_tile(mat, x, y)

        arc = [(cx + r * math.cos(math.pi * i / steps), spring + r * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
        for z, facing, k in ((0.0, fr.n, lit), (-thick, -fr.n, lit * 0.62)):
            for xa, xb in ((0.0, x0), (x1, width)):
                self.poly(fr, [(xa, 0.0), (xb, 0.0), (xb, height), (xa, height)], z, uv, mat, k, facing)
            for pa, pb in zip(arc, arc[1:]):
                self.poly(fr, [pa, (pa[0], height), (pb[0], height), pb], z, uv, mat, k, facing)
        for x, facing in ((x0, fr.r), (x1, -fr.r)):
            pts = [fr.p(x, 0.0, 0.0), fr.p(x, 0.0, -thick), fr.p(x, spring, -thick), fr.p(x, spring, 0.0)]
            self.face(pts, [uv_tile(mat, 0.0, 0.0), uv_tile(mat, thick, 0.0), uv_tile(mat, thick, spring), uv_tile(mat, 0.0, spring)], mat, lit * 0.7, facing)
        run = 0.0
        for pa, pb in zip(arc, arc[1:]):
            seg = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
            pts = [fr.p(pa[0], pa[1], 0.0), fr.p(pb[0], pb[1], 0.0), fr.p(pb[0], pb[1], -thick), fr.p(pa[0], pa[1], -thick)]
            uvs = [uv_tile(mat, run, 0.0), uv_tile(mat, run + seg, 0.0), uv_tile(mat, run + seg, thick), uv_tile(mat, run, thick)]
            self.face(pts, uvs, mat, lit * 0.6, fr.d(cx - (pa[0] + pb[0]) / 2.0, spring - (pa[1] + pb[1]) / 2.0, 0.0))
            run += seg

    def bell(self, crown, size=1.0, sides=12):
        """A bronze bell hung by its crown from `crown`: the flared mouth, the waist and the
        shoulder, and a dark throat so nobody sees the sky through it from below."""
        fr = Frame(crown, (1, 0, 0), UP, (0, 1, 0))
        s = size
        profile = [(0.95 * s, -1.6 * s), (0.8 * s, -1.44 * s), (0.6 * s, -1.05 * s), (0.5 * s, -0.5 * s), (0.36 * s, -0.16 * s), (0.0, -0.05 * s)]
        self.lathe(fr, profile, sides=sides, skin=("band", "gilded", 1.6 * s), smooth=True, shade=0.92)
        throat = [fr.p(0.86 * s * math.cos(2.0 * math.pi * i / sides), -1.5 * s, 0.86 * s * math.sin(2.0 * math.pi * i / sides)) for i in range(sides)]
        self.face(throat, [uv_band("oak", 0.2 + 0.1 * math.cos(2.0 * math.pi * i / sides), 0.5 + 0.3 * math.sin(2.0 * math.pi * i / sides), 0.4) for i in range(sides)], "trim", 0.22, -UP)

    def door(self, fr, width=3.9, steps=2, step_rise=0.22, sink=0.0):
        """An arched double door, centred on the frame's origin at ground level: stone steps,
        the leaf set back inside a deep stone arch, a gold keystone standing proud of it."""
        k = 623.0 / width
        lift = steps * step_rise

        def x(sx):
            return (sx - 333.5) / k

        def y(sy):
            return (1132.0 - sy) / k + lift

        leaf = arch_points(160, 507, 650, 765, 1132)

        def leaf_uv(px, py):
            return uv_part("door_leaf", (px * k + 333.5 - 160.0) / 347.0, (1132.0 - (py - lift) * k - 650.0) / 480.0)

        self.poly(fr, [(x(px), y(py)) for px, py in leaf], 0.07, leaf_uv, "parts_solid", 0.96)
        self.relief(fr.at(x(26), y(1132), -sink), "door_surround", 623.0 / k, 0.44 + sink)
        self.relief(fr.at(x(294), y(654), 0.44), "door_key", 96.0 / k, 0.14)
        half = (504 - 163) / k / 2 + 0.62
        for i in range(steps):
            reach = 0.44 + 0.5 * (steps - i)
            grow = 0.3 * (steps - 1 - i)
            self.box(fr, -half - grow, half + grow, -FOOTING, step_rise * (i + 1), 0.0, reach, ("tile", "stone"), skip="k", shade=0.96)
        return 591.0 / k + lift

    def doorway(self, fr, opening=2.6, lift=0.45, depth=0.55):
        """An OPEN arched doorway, centred on the frame's origin at ground level: the stone
        arch and its keystone, the steps up to the floor, the two leaves swung out, and the
        stone of the wall's thickness round the opening. `opening` is the clear width.
        Returns the height of the top of the opening above the ground."""
        width = opening * 623.0 / 341.0
        k = 623.0 / width

        def x(sx):
            return (sx - 333.5) / k

        def y(sy):
            return (1132.0 - sy) / k + lift

        self.relief(fr.at(x(26), y(1132)), "door_surround", 623.0 / k, 0.44)
        self.relief(fr.at(x(294), y(654), 0.44), "door_key", 96.0 / k, 0.14)
        half = opening / 2
        spring, top = y(765), y(653)
        # the wall's thickness: jambs and the floor of the threshold
        for sx in (-1.0, 1.0):
            pts = [fr.p(sx * half, lift, 0.0), fr.p(sx * half, lift, -depth), fr.p(sx * half, spring + 0.5, -depth), fr.p(sx * half, spring + 0.5, 0.0)]
            self.face(pts, [uv_tile("stone", 0.0, lift), uv_tile("stone", depth, lift), uv_tile("stone", depth, spring + 0.5), uv_tile("stone", 0.0, spring + 0.5)], "stone", 0.7, fr.r * -sx)
        pts = [fr.p(-half, top + 0.02, 0.0), fr.p(half, top + 0.02, 0.0), fr.p(half, top + 0.02, -depth), fr.p(-half, top + 0.02, -depth)]
        self.face(pts, [uv_tile("stone", 0.0, 0.0), uv_tile("stone", opening, 0.0), uv_tile("stone", opening, depth), uv_tile("stone", 0.0, depth)], "stone", 0.55, -fr.u)
        pts = [fr.p(-half, lift, 0.3), fr.p(half, lift, 0.3), fr.p(half, lift, -depth), fr.p(-half, lift, -depth)]
        self.face(pts, [uv_tile("stone", 0.0, 0.0), uv_tile("stone", opening, 0.0), uv_tile("stone", opening, depth + 0.3), uv_tile("stone", 0.0, depth + 0.3)], "stone", 0.95, fr.u)
        # the two leaves, swung out and standing open
        leaf_h = (spring - lift) + (top - spring) * 0.45
        for sx in (-1.0, 1.0):
            a = math.radians(112.0)
            direction = fr.r * (-sx * math.cos(a)) + fr.n * math.sin(a)
            hinge = fr.p(sx * half, lift, 0.42)
            pts = [hinge, hinge + direction * half, hinge + direction * half + fr.u * leaf_h, hinge + fr.u * leaf_h]
            u_h, u_c = (0.02, 0.5) if sx < 0 else (0.98, 0.5)
            fy_top = 1.0 - leaf_h / (top - lift)
            uvs = [uv_part("door_leaf", u_h, 1.0), uv_part("door_leaf", u_c, 1.0), uv_part("door_leaf", u_c, fy_top), uv_part("door_leaf", u_h, fy_top)]
            self.face(pts, uvs, "parts_solid", 0.92, fr.n)
        reach = 0.44 + 0.95
        steps = max(1, round(lift / 0.225))
        for i in range(steps):
            rise = lift * (i + 1) / steps
            out = 0.44 + 0.5 * (steps - i)
            grow = 0.3 * (steps - 1 - i)
            self.box(fr, -half - 0.62 - grow, half + 0.62 + grow, -FOOTING, rise, 0.0, out, ("tile", "stone"), skip="k", shade=0.96)
        del reach
        return top

    def boards(self, x0, x1, y0, y1, z, strip=1.9, shade=0.92, facing=UP):
        """A boarded floor (or the boards of a ceiling): rows of the plank band, each row a
        run of short boards, the rows staggered and no two the same shade."""
        count = max(1, round((y1 - y0) / strip))
        step = (y1 - y0) / count
        for i in range(count):
            ya, yb = y0 + i * step, y0 + (i + 1) * step
            off = (i * 1.37) % 2.9
            lit = shade * (1.0 - 0.07 * ((i * 5) % 3))
            pts = [(x0, ya, z), (x1, ya, z), (x1, yb, z), (x0, yb, z)]
            uvs = [uv_band("planks", x0 + off, 0.02, step), uv_band("planks", x1 + off, 0.02, step), uv_band("planks", x1 + off, 0.98, step), uv_band("planks", x0 + off, 0.98, step)]
            self.face(pts, uvs, "trim", lit, facing)

    def chandelier(self, x, y, ceiling, drop=1.5, size=2.3):
        """A gilded wheel hung flat under the ceiling on three chains, a lamp burning under
        its hub and one on each of four spokes."""
        z = ceiling - drop
        self.relief(Frame((x, y, z), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)), "wheel", size, 0.08, back=True, anchor=(0.5, 0.5))
        for k in range(3):
            a = math.radians(90.0 + 120.0 * k)
            px, py = x + math.cos(a) * size * 0.36, y + math.sin(a) * size * 0.36
            self.sweep([(px, py, z + 0.04), (x + (px - x) * 0.12, y + (py - y) * 0.12, ceiling - 0.02)], (0.035, 0.035), "oak", depth=0.08, caps=False, shade=0.5)
        self.hung_lamp(x, y, z - 0.08, 1.25)
        for k in range(4):
            a = math.radians(45.0 + 90.0 * k)
            self.hung_lamp(x + math.cos(a) * size * 0.42, y + math.sin(a) * size * 0.42, z - 0.05, 0.7)

    def hung_lamp(self, x, y, z, size=1.0):
        """A lantern body hanging straight down from (x, y, z)."""
        s = size
        body = Frame((x, y, z - 0.1 * s), (1.0, 0.0, 0.0), UP, (0.0, -1.0, 0.0))
        r = 0.2 * s
        self.lathe(body, [(r * 1.3, -0.1 * s), (r * 0.62, 0.0), (0.0, 0.1 * s)], sides=6, skin=("band", "oak", 0.2), smooth=False, shade=0.6)
        self.lathe(body, [(r * 0.78, -0.5 * s), (r * 1.02, -0.1 * s)], sides=6, skin=("part", "lantern_glass", 6, "parts_glow"), smooth=False)
        self.lathe(body, [(0.0, -0.66 * s), (r * 0.55, -0.56 * s), (r * 0.9, -0.5 * s)], sides=6, skin=("band", "oak", 0.2), smooth=False, shade=0.6)
        self.gem(body.p(0, -0.7 * s, 0), 0.045 * s)

    def rug(self, x, y, z, width=2.4, turn=0.0):
        """The sun banner's cloth laid on the floor as a rug, centred on (x, y)."""
        r = Vector((math.cos(turn), math.sin(turn), 0.0))
        u = Vector((-math.sin(turn), math.cos(turn), 0.0))
        fr = Frame((x, y, z + 0.03), tuple(r), tuple(u), (0.0, 0.0, 1.0))
        length = width / PARTS["banner"]["aspect"]
        return self.cloth(fr.at(-width / 2, length / 2, 0.0), "banner", width, cols=2, rows=2)

    def room(self, x0, x1, y0, y1, floor, ceiling, door=None, wall="timber", beams=True, back_door=None):
        """The inside of a storey, as the interior part: a boarded floor, the inner faces of
        the four walls, and a beamed ceiling. (x0, x1, y0, y1) is the room itself, inside the
        wall thickness; `door` = (from x, to x, height) leaves the doorway open in the front
        inner wall."""
        self.part = 1
        height = ceiling - floor
        # The floor and ceiling wear the painted ship planking. (Plain boards, lit windows in
        # stone surrounds, rugs and a wheel of lamps were all tried and dropped: warm boards
        # read as one flat orange, the lamps hang in the camera.)
        pts = [(x0, y0, floor), (x1, y0, floor), (x1, y1, floor), (x0, y1, floor)]
        self.face(pts, [uv_tile("hull", py, px) for px, py, _z in pts], "hull", 0.9, UP)
        pts = [(x0, y0, ceiling), (x1, y0, ceiling), (x1, y1, ceiling), (x0, y1, ceiling)]
        self.face(pts, [uv_tile("hull", px, py) for px, py, _z in pts], "hull", 0.5, -UP)
        if beams:
            count = max(2, round((x1 - x0) / 2.6))
            for i in range(count):
                bx = x0 + (x1 - x0) * (i + 0.5) / count
                fr = Frame((bx, y0, ceiling - 0.38), (0.0, 1.0, 0.0), UP, (1.0, 0.0, 0.0))
                self.box(fr, 0.0, y1 - y0, 0.0, 0.38, -0.17, 0.17, ("band", "oak", "x", 0.4), skip="t", shade=0.85)
        # inner faces: each wall seen from inside the room
        sides = (
            ((x1, y0), (-1.0, 0.0, 0.0), x1 - x0, "front"),
            ((x1, y1), (0.0, -1.0, 0.0), y1 - y0, "right"),
            ((x0, y1), (1.0, 0.0, 0.0), x1 - x0, "back"),
            ((x0, y0), (0.0, 1.0, 0.0), y1 - y0, "left"),
        )
        for (ox, oy), run, length, side in sides:
            fr = Frame((ox, oy, floor), run)
            # Frame's n is run x up, which for these runs points INTO the room
            if (side == "front" and door) or (side == "back" and back_door):
                if side == "front":
                    da, db, dtop = door
                    # along this wall x runs from x1 down to x0
                    a0, a1 = x1 - db, x1 - da
                else:
                    da, db, dtop = back_door
                    a0, a1 = da - x0, db - x0
                for wa, wb, za, zb in ((0.0, a0, 0.0, height), (a1, length, 0.0, height), (a0, a1, dtop - floor, height)):
                    if wb - wa < 0.05 or zb - za < 0.05:
                        continue
                    if wall == "timber":
                        self.timber_wall(fr.at(wa, za, 0.0), wb - wa, zb - za, ends=False, sill=za == 0.0)
                    else:
                        self.wall(fr.at(wa, za, 0.0), wb - wa, zb - za, wall, u0=wa, v0=za)
            elif wall == "timber":
                self.timber_wall(fr, length, height, ends=False)
            else:
                self.wall(fr, length, height, wall)
        self.part = 0

    def passage(self, xa, xb, ya, yb, floor, top, mat="stone"):
        """The inside of an opening through a wall's thickness, from y = ya to y = yb: its
        two jambs, its head and its floor."""
        self.part = 1
        for x, facing in ((xa, (1.0, 0.0, 0.0)), (xb, (-1.0, 0.0, 0.0))):
            pts = [(x, ya, floor), (x, yb, floor), (x, yb, top), (x, ya, top)]
            self.face(pts, [uv_tile(mat, ya, floor), uv_tile(mat, yb, floor), uv_tile(mat, yb, top), uv_tile(mat, ya, top)], mat, 0.72, facing)
        pts = [(xa, ya, top), (xb, ya, top), (xb, yb, top), (xa, yb, top)]
        self.face(pts, [uv_tile(mat, xa, ya), uv_tile(mat, xb, ya), uv_tile(mat, xb, yb), uv_tile(mat, xa, yb)], mat, 0.55, -UP)
        self.boards(xa, xb, ya, yb, floor, strip=yb - ya)
        self.part = 0

    def inner_frame(self, x0, x1, y0, y1, side, along, height):
        """A frame on the INSIDE face of one wall of a room, `along` yards from its left end
        as seen from inside, `height` above the ground."""
        if side == "front":
            return Frame((x1 - along, y0, height), (-1.0, 0.0, 0.0))
        if side == "right":
            return Frame((x1, y1 - along, height), (0.0, -1.0, 0.0))
        if side == "back":
            return Frame((x0 + along, y1, height), (1.0, 0.0, 0.0))
        return Frame((x0, y0 + along, height), (0.0, 1.0, 0.0))

    def table(self, x, y, z, length=2.4, width=1.0, height=0.95, turn=0.0):
        """A plank table on four legs."""
        fr = Frame((x, y, z), (math.cos(turn), math.sin(turn), 0.0), UP)
        self.furnish((x, y), z, z + height, length / 2, width / 2, turn)
        self.box(fr, -length / 2, length / 2, height - 0.12, height, -width / 2, width / 2, ("band", "planks", "x", 0.5))
        for sx in (-1.0, 1.0):
            for sz in (-1.0, 1.0):
                self.box(fr, sx * (length / 2 - 0.16) - 0.07, sx * (length / 2 - 0.16) + 0.07, 0.0, height - 0.12, sz * (width / 2 - 0.14) - 0.07, sz * (width / 2 - 0.14) + 0.07, ("band", "oak", "y", 0.2), skip="tb", shade=0.8)

    def bench(self, x, y, z, length=2.2, turn=0.0, height=0.55):
        """A plain bench."""
        fr = Frame((x, y, z), (math.cos(turn), math.sin(turn), 0.0), UP)
        self.furnish((x, y), z, z + height, length / 2, 0.2, turn)
        self.box(fr, -length / 2, length / 2, height - 0.1, height, -0.2, 0.2, ("band", "planks", "x", 0.4))
        for sx in (-1.0, 1.0):
            self.box(fr, sx * (length / 2 - 0.2) - 0.06, sx * (length / 2 - 0.2) + 0.06, 0.0, height - 0.1, -0.17, 0.17, ("band", "oak", "y", 0.2), skip="tb", shade=0.8)

    def counter(self, fr, length, height=1.15, depth=0.8, band="bargeboard"):
        """A serving counter standing on the frame's line: a carved front under a board top."""
        mid = fr.p(length / 2, 0.0, depth / 2)
        self.furnish((mid.x, mid.y), mid.z, mid.z + height, length / 2, depth / 2, math.atan2(fr.r.y, fr.r.x))
        self.box(fr, 0.0, length, 0.0, height - 0.1, 0.0, depth, ("band", band, "x", height - 0.1), skip="b")
        self.box(fr, -0.08, length + 0.08, height - 0.1, height, -0.06, depth + 0.1, ("band", "planks", "x", 0.5))

    def hearth(self, fr, width=2.6, height=4.2, depth=0.9):
        """A stone chimney breast against a wall with a fire burning in its arched mouth."""
        # solid to a walker only up to the mantel: the indoor camera's room has to stay clear of
        # tall pieces (tests/placed_town_interior_core.test.ts), and nobody climbs a chimney breast
        mid = fr.p(0.0, 0.0, depth / 2)
        self.furnish((mid.x, mid.y), mid.z, mid.z + min(height, 1.7), width / 2, depth / 2, math.atan2(fr.r.y, fr.r.x))
        self.box(fr, -width / 2, width / 2, 0.0, height, 0.0, depth, ("tile", "stone"), skip="k")
        mouth = [(px / 100.0 * width * 0.55, py / 100.0 * 1.5 + 0.12) for px, py in ((-50, 0), (50, 0), (50, 60), (35, 85), (0, 100), (-35, 85), (-50, 60))]
        self.face([fr.p(px, py, depth + 0.02) for px, py in mouth], [uv_part("lantern_glass", 0.5 + px / (width * 0.6), 1.0 - py / 1.7) for px, py in mouth], "parts_glow", 1.0, fr.n)
        self.box(fr, -width / 2 - 0.12, width / 2 + 0.12, 1.75, 1.98, 0.0, depth + 0.16, ("band", "oak", "x", 0.24), skip="k")

    def corbel(self, fr, size=0.9, thick=0.26):
        """A carved bracket under a jetty or an eave: the frame's origin is where the wall
        meets the underside of what it carries."""
        side = fr.facing_out()
        self.relief(side.at(0.0, 0.0, -thick / 2), "corbel", size, thick, back=True, anchor=(0.0, 1.0))

    def lantern(self, fr, reach=0.8, size=1.0):
        """A wrought lantern on an arm out from the wall, the frame's origin where the arm is
        fixed: a six-sided glass body under a peaked cap, hung on a link."""
        s = size
        self.box(fr, -0.04 * s, 0.04 * s, -0.04 * s, 0.04 * s, 0.0, reach, ("band", "oak", "z", 0.1), skip="k", shade=0.55)
        self.sweep([fr.p(0, -0.42 * s, 0.03), fr.p(0, -0.2 * s, reach * 0.45), fr.p(0, -0.05 * s, reach * 0.8)], (0.05 * s, 0.05 * s), "oak", depth=0.1, shade=0.55, up=fr.n)
        hang = Frame(fr.p(0, 0, reach - 0.08 * s), fr.r, fr.u, fr.n)
        self.box(hang, -0.02 * s, 0.02 * s, -0.2 * s, -0.02 * s, -0.02 * s, 0.02 * s, ("band", "oak", "y", 0.06), shade=0.5)
        body = hang.at(0, -0.2 * s, 0)
        r = 0.2 * s
        # the peaked cap, the glass, the cap's underside, the base
        self.lathe(body, [(r * 1.3, -0.1 * s), (r * 0.62, 0.0), (0.0, 0.06 * s)], sides=6, skin=("band", "oak", 0.2), smooth=False, shade=0.6)
        self.lathe(body, [(r * 0.78, -0.5 * s), (r * 1.02, -0.1 * s)], sides=6, skin=("part", "lantern_glass", 6, "parts_glow"), smooth=False)
        self.lathe(body, [(r * 1.02, -0.1 * s), (r * 1.3, -0.1 * s)], sides=6, skin=("band", "oak", 0.2), smooth=False, shade=0.45)
        self.lathe(body, [(0.0, -0.66 * s), (r * 0.55, -0.56 * s), (r * 0.9, -0.5 * s)], sides=6, skin=("band", "oak", 0.2), smooth=False, shade=0.6)
        self.gem(body.p(0, -0.7 * s, 0), 0.045 * s)
        self.gem(body.p(0, 0.09 * s, 0), 0.04 * s)

    def hanging_sign(self, fr, width=2.2, thick=0.14):
        """The gilded fish sign on its scrolled iron bracket, fixed square to the wall at the
        frame's origin (the top of the bracket's wall plate)."""
        side = fr.facing_out()
        self.relief(side.at(0.0, 0.0, -thick / 2), "sign", width, thick, back=True, anchor=(0.0, 1.0))

    def banner(self, fr, width=1.35, reach=None, flat=False):
        """The navy banner with the gold sun on a turned pole. By default the pole stands out
        from the wall and the cloth hangs along it; `flat` hangs it against the wall."""
        if flat:
            pole = [fr.p(-width * 0.62, 0, 0.3), fr.p(width * 0.62, 0, 0.3)]
            self.sweep(pole, (0.09, 0.09), "oak", depth=0.12, up=fr.n)
            for p in pole:
                self.gem(p, 0.08)
                self.box(Frame(p, fr.r, fr.u, fr.n), -0.035, 0.035, -0.035, 0.035, -0.3, 0.0, ("band", "oak", "z", 0.1), shade=0.6)
            return self.cloth(fr.at(-width / 2, -0.03, 0.3), "banner", width, bulge=0.12)
        reach = reach or width + 0.55
        side = fr.facing_out()
        self.sweep([fr.p(0, 0, 0), fr.p(0, 0, reach)], (0.1, 0.1), "oak", depth=0.12, up=fr.u)
        self.gem(fr.p(0, 0, reach + 0.06), 0.09)
        self.sweep([fr.p(0, -0.55, 0.02), fr.p(0, -0.05, 0.6)], (0.06, 0.06), "oak", depth=0.1, shade=0.6, up=fr.n)
        return self.cloth(side.at(reach - width - 0.12, -0.03, 0.0), "banner", width, bulge=0.1)

    def awning(self, fr, width=3.2, depth=1.5, drop=0.85, flare=0.18):
        """A striped canvas awning over a shop front, centred on the frame's origin at its
        top edge: a sloped canopy, a scalloped valance, cloth cheeks, a front rod on struts."""
        h = width / 2
        top = [(-h, 0.0, 0.04), (h, 0.0, 0.04), (h + flare, -drop, depth), (-h - flare, -drop, depth)]
        uvs = [uv_part("awning_top", 0.04, 0.03), uv_part("awning_top", 0.96, 0.03), uv_part("awning_top", 0.98, 0.97), uv_part("awning_top", 0.02, 0.97)]
        self.face([fr.p(*c) for c in top], uvs, "parts_solid", 1.0, fr.d(0, 1, 0.6))
        val = 0.34
        pts = [fr.p(-h - flare, -drop - val, depth), fr.p(h + flare, -drop - val, depth), fr.p(h + flare, -drop, depth), fr.p(-h - flare, -drop, depth)]
        uvs = [uv_part("awning_valance", 0.01, 1.0), uv_part("awning_valance", 0.99, 1.0), uv_part("awning_valance", 0.99, 0.08), uv_part("awning_valance", 0.01, 0.08)]
        self.face(pts, uvs, "parts", 0.95, fr.n)
        for sign in (-1.0, 1.0):
            cheek = [fr.p(sign * h, 0.0, 0.04), fr.p(sign * (h + flare), -drop, depth), fr.p(sign * h, -drop, 0.04)]
            uvs = [uv_part("awning_top", 0.1, 0.05), uv_part("awning_top", 0.2, 0.95), uv_part("awning_top", 0.1, 0.95)]
            self.face(cheek, uvs, "parts_solid", 0.8, fr.r * sign)
            self.sweep([fr.p(sign * h, -drop - 0.1, 0.02), fr.p(sign * (h + flare), -drop, depth)], (0.07, 0.07), "oak", depth=0.1, shade=0.7, up=fr.u)
        rod = [fr.p(-h - flare - 0.12, -drop, depth), fr.p(h + flare + 0.12, -drop, depth)]
        self.sweep(rod, (0.08, 0.08), "oak", depth=0.1, up=fr.u)
        for p in rod:
            self.gem(p, 0.07)

    def net(self, fr, width=3.0):
        """A fishing net with its floats and buoy, draped from two pegs on the wall."""
        return self.cloth(fr.at(-width / 2, 0, 0.12), "net", width, bulge=0.22, cols=4, rows=3)

    def chimney(self, x, y, w, d, z0, z1, lean=(0.0, 0.0), pots=3, taper=0.1, mat="stone"):
        """A stone stack that leans a little, a corbelled cap, and clay pots of mixed height
        turned as real cylinders. `mat` is its stone (the houses' rubble unless told)."""
        base = [(x - w / 2, y - d / 2), (x + w / 2, y - d / 2), (x + w / 2, y + d / 2), (x - w / 2, y + d / 2)]
        top = [(px + (x - px) * taper + lean[0], py + (y - py) * taper + lean[1]) for px, py in base]
        run = 0.0
        for i in range(4):
            j = (i + 1) % 4
            length = math.hypot(base[j][0] - base[i][0], base[j][1] - base[i][1])
            out = Vector(((base[i][0] + base[j][0]) / 2 - x, (base[i][1] + base[j][1]) / 2 - y, 0.0))
            pts = [(*base[i], z0), (*base[j], z0), (*top[j], z1), (*top[i], z1)]
            uvs = [uv_tile(mat, run, z0), uv_tile(mat, run + length, z0), uv_tile(mat, run + length, z1), uv_tile(mat, run, z1)]
            self.face(pts, uvs, mat, [0.82, 0.82, 1.0, 1.0], out)
            run += length
        tx, ty = x + lean[0], y + lean[1]
        tw, td = w * (1 - taper), d * (1 - taper)
        cap = Frame((tx, ty, z1), (1, 0, 0), UP, (0, -1, 0))
        self.box(cap, -tw / 2 - 0.1, tw / 2 + 0.1, 0.0, 0.16, -td / 2 - 0.1, td / 2 + 0.1, ("tile", mat), shade=0.95)
        self.box(cap, -tw / 2 - 0.2, tw / 2 + 0.2, 0.16, 0.36, -td / 2 - 0.2, td / 2 + 0.2, ("tile", mat))
        heights = [0.95, 0.7, 0.52, 0.8][:pots]
        for i, hgt in enumerate(heights):
            px = tx + (i - (pots - 1) / 2) * (tw + 0.1) / max(pots, 1) * 0.92
            py = ty + (0.06 if i % 2 else -0.06)
            r = 0.17 if i == 0 else 0.15
            pot = Frame((px, py, z1 + 0.36), (1, 0, 0), UP, (0, -1, 0))
            self.lathe(pot, [(r * 1.08, 0.0), (r * 1.12, hgt * 0.1), (r * 0.9, hgt * 0.16), (r * 0.86, hgt * 0.74), (r * 1.14, hgt * 0.8), (r * 1.18, hgt * 0.96), (r * 0.8, hgt), (r * 0.72, hgt * 0.9)], sides=8, skin=("part", "pot", 2))
        return z1 + 0.36

    def bay_faces(self, fr, plan, y0, y1, skin, shade=1.0, grow=0.0):
        """Faces round a bay's plan (points (x, z) from the wall on the left, round the
        front, back to the wall on the right) between two heights. `skin`: ("band", name,
        depth), ("tile", material) or ("part", name), which spreads the part round the bay."""
        cx = sum(p[0] for p in plan) / len(plan)
        cz = sum(p[1] for p in plan) / len(plan)
        if grow:
            plan = [(x + (x - cx) * grow / max(abs(x - cx), 0.3) if abs(x - cx) > 0.05 else x, z + (grow if z > 0.05 else 0.0)) for x, z in plan]
        lengths = [0.0]
        for a, b in zip(plan, plan[1:]):
            lengths.append(lengths[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        total = lengths[-1]
        for i in range(len(plan) - 1):
            (ax, az), (bx, bz) = plan[i], plan[i + 1]
            facing = fr.d((ax + bx) / 2 - cx, 0.0, (az + bz) / 2 - cz + 0.4)
            pts = [fr.p(ax, y0, az), fr.p(bx, y0, bz), fr.p(bx, y1, bz), fr.p(ax, y1, az)]
            s0, s1 = lengths[i], lengths[i + 1]
            if skin[0] == "band":
                uvs = [uv_band(skin[1], s0, 0.0, skin[2]), uv_band(skin[1], s1, 0.0, skin[2]), uv_band(skin[1], s1, 1.0, skin[2]), uv_band(skin[1], s0, 1.0, skin[2])]
                mat = "trim"
            elif skin[0] == "tile":
                uvs = [uv_tile(skin[1], s0, y0), uv_tile(skin[1], s1, y0), uv_tile(skin[1], s1, y1), uv_tile(skin[1], s0, y1)]
                mat = skin[1]
            else:
                f0, f1 = s0 / total, s1 / total
                uvs = [uv_part(skin[1], f0, 1.0), uv_part(skin[1], f1, 1.0), uv_part(skin[1], f1, 0.0), uv_part(skin[1], f0, 0.0)]
                mat = "parts_solid"
            self.face(pts, uvs, mat, shade * (1.0 if abs(bz - az) < 0.05 else 0.88), facing)

    def oriel(self, fr, width=3.0, depth=0.95, storeys=1, corbels=True):
        """A canted bay window hung on the wall, centred on the frame's origin at the
        underside of its base: carved apron, glazing on all three faces between real corner
        posts, a head beam, and its own little bell-cast slate roof with a gold finial.
        Returns the height of the top of its roof above the origin."""
        half, front = width / 2, width * 0.29
        plan = [(-half, 0.0), (-front, depth), (front, depth), (half, 0.0)]
        if corbels:
            for x in (-front * 0.82, front * 0.82):
                self.corbel(fr.at(x, 0.0, 0.0), size=min(0.85, depth * 0.92), thick=0.22)
        # the base slab and its underside
        self.bay_faces(fr, plan, 0.0, 0.2, ("band", "bargeboard", 0.2), grow=0.07)
        self.face([fr.p(x, 0.0, z) for x, z in plan], [uv_band("planks", x, min(1.0, z / depth), 0.6) for x, z in plan], "trim", 0.5, -fr.u)
        y = 0.2
        for _storey in range(storeys):
            self.bay_faces(fr, plan, y, y + 0.55, ("part", "apron"))
            self.bay_faces(fr, plan, y + 0.55, y + 0.67, ("band", "gilded", 0.12), grow=0.05)
            glass_lo, glass_hi = y + 0.67, y + 1.85
            self.bay_faces(fr, plan, glass_lo, glass_hi, ("tile", "glass"))
            # posts on every corner, a mullion on the front, a transom right round
            for x, z in plan:
                self.sweep([fr.p(x, glass_lo, z), fr.p(x, glass_hi, z)], (0.17, 0.17), "bargeboard", depth=0.26, up=fr.n, caps=False)
            self.sweep([fr.p(0.0, glass_lo, depth + 0.01), fr.p(0.0, glass_hi, depth + 0.01)], (0.1, 0.1), "oak", depth=0.14, up=fr.n, caps=False)
            self.bay_faces(fr, plan, glass_lo + 0.74, glass_lo + 0.82, ("band", "oak", 0.1), grow=0.035)
            self.bay_faces(fr, plan, glass_hi, glass_hi + 0.28, ("band", "bargeboard", 0.28), grow=0.04)
            y = glass_hi + 0.28
        # the cornice and the roof
        self.bay_faces(fr, plan, y, y + 0.12, ("band", "gilded", 0.12), grow=0.14)
        eave = [(-half - 0.3, 0.0), (-front - 0.2, depth + 0.3), (front + 0.2, depth + 0.3), (half + 0.3, 0.0)]
        mid = [(-half * 0.62, 0.0), (-front * 0.6, depth * 0.52), (front * 0.6, depth * 0.52), (half * 0.62, 0.0)]
        top = [(-half * 0.16, 0.0), (-front * 0.1, depth * 0.1), (front * 0.1, depth * 0.1), (half * 0.16, 0.0)]
        rings = [(eave, y + 0.06), (mid, y + 0.42), (top, y + 1.15)]
        self.face([fr.p(x, y + 0.02, z) for x, z in eave], [uv_band("planks", x, 0.5, 0.6) for x, z in eave], "trim", 0.5, -fr.u)
        run = 0.0
        for (lo, ylo), (hi, yhi) in zip(rings, rings[1:]):
            slope = math.hypot(yhi - ylo, depth * 0.45)
            for i in range(3):
                pts = [fr.p(lo[i][0], ylo, lo[i][1]), fr.p(lo[i + 1][0], ylo, lo[i + 1][1]), fr.p(hi[i + 1][0], yhi, hi[i + 1][1]), fr.p(hi[i][0], yhi, hi[i][1])]
                uvs = [uv_tile("slate", lo[i][0] + lo[i][1], run), uv_tile("slate", lo[i + 1][0] + (2 * depth - lo[i + 1][1] if i == 2 else lo[i + 1][1]), run), uv_tile("slate", hi[i + 1][0] + (2 * depth - hi[i + 1][1] if i == 2 else hi[i + 1][1]), run + slope), uv_tile("slate", hi[i][0] + hi[i][1], run + slope)]
                facing = fr.d((lo[i][0] + lo[i + 1][0]) / 2, 1.2, (lo[i][1] + lo[i + 1][1]) / 2 + 0.3)
                self.face(pts, uvs, "slate", [0.84, 0.84, 1.0, 1.0], facing, smooth=True)
            run += slope
        # gold hips and a finial
        for i in (1, 2):
            self.sweep([fr.p(eave[i][0], y + 0.1, eave[i][1]), fr.p(mid[i][0], y + 0.46, mid[i][1]), fr.p(top[i][0], y + 1.18, top[i][1])], [(0.1, 0.1), (0.09, 0.09), (0.07, 0.07)], "gilded", depth=0.14, up=fr.n)
        self.gem(fr.p(0.0, y + 1.32, depth * 0.1), 0.11, stretch=1.7)
        return y + 1.45

    def dormer(self, surface, cx, cy, ridge, along, out, side=1.0, width=1.9):
        """A little gabled window standing on a roof slope. `surface` is what swept_roof
        returned, (cx, cy) the roof's centre in plan and `ridge` its ridge axis; `along` is
        where the dormer sits along the ridge from the centre, `out` how far its face stands
        from the ridge line, `side` which slope (+1 or -1)."""
        along_y = ridge == "y"
        across = Vector((side, 0.0, 0.0)) if along_y else Vector((0.0, side, 0.0))
        ridge_dir = UP.cross(across)
        base = surface(along, out)
        origin = (Vector((cx, cy + along, 0.0)) if along_y else Vector((cx + along, cy, 0.0))) + across * out + UP * base
        fr = Frame(origin, ridge_dir, UP, across)
        sgn = ridge_dir.y if along_y else ridge_dir.x

        def roof_at(x, z):
            return surface(along + x * sgn, out + z) - base

        def back_to(x, height):
            """How far back from the face the roof climbs to `height` above the sill."""
            lo, hi = -out, 0.0
            for _ in range(24):
                mid = (lo + hi) / 2
                if roof_at(x, mid) > height:
                    lo = mid
                else:
                    hi = mid
            return (lo + hi) / 2

        part = PARTS["dormer_front"]
        height = width / part["aspect"]
        half = width / 2
        sink = 0.18
        # the painted front with its pointed opening, glass set back behind it
        face = fr.at(0.0, -sink, 0.0)
        k = 462.0 / width
        opening = [((px - 1283.0) / k, (517.0 - py) / k) for px, py in arch_points(1204, 1367, 200, 300, 435, 1.45)]
        self.glass(face, opening, z=-0.1)
        self.box(face, -0.035, 0.035, (517.0 - 432.0) / k, (517.0 - 215.0) / k, -0.1, -0.03, ("band", "oak", "y", 0.1), skip="k", shade=0.7)
        self.box(face, (1207 - 1283.0) / k, (1364 - 1283.0) / k, (517.0 - 325.0) / k, (517.0 - 315.0) / k, -0.1, -0.03, ("band", "oak", "x", 0.1), skip="k", shade=0.7)
        self.relief(face.at(0.0, 0.0, -0.12), "dormer_front", width, 0.12, anchor=(0.5, 0.0))
        peak = height - sink
        eave_y = height * 0.42 - sink
        eave_x = half * 0.74
        # two slate planes running back into the roof, with a little overhang at the face
        for sx in (-1.0, 1.0):
            front_peak = fr.p(0.0, peak + 0.06, 0.22)
            front_eave = fr.p(sx * (eave_x + 0.2), eave_y - 0.12, 0.22)
            back_peak = fr.p(0.0, peak + 0.06, back_to(0.0, peak + 0.06) - 0.05)
            back_eave = fr.p(sx * (eave_x + 0.2), eave_y - 0.12, back_to(sx * (eave_x + 0.2), eave_y - 0.12) - 0.05)
            slope = (front_peak - front_eave).length
            run_peak = (front_peak - back_peak).length
            run_eave = (front_eave - back_eave).length
            pts = [front_eave, back_eave, back_peak, front_peak]
            uvs = [uv_tile("slate", 0.0, 0.0), uv_tile("slate", run_eave, 0.0), uv_tile("slate", run_peak, slope), uv_tile("slate", 0.0, slope)]
            self.face(pts, uvs, "slate", [0.86, 0.8, 0.9, 1.0], fr.d(sx, 1.2, 0.0), smooth=False)
            under = [p - UP * 0.1 for p in pts]
            self.face(under, [uv_band("planks", 0.0, 0.0, 0.6), uv_band("planks", run_eave, 0.0, 0.6), uv_band("planks", run_peak, 1.0, 0.6), uv_band("planks", 0.0, 1.0, 0.6)], "trim", 0.5, fr.d(-sx, -1.2, 0.0))
            self.sweep([front_eave, front_peak], (0.08, 0.1), "gilded", depth=0.14, up=fr.n)
            # the cheek: a plastered side wall under the dormer's eave
            foot = fr.p(sx * eave_x, -sink, -0.02)
            head = fr.p(sx * eave_x, eave_y - 0.1, -0.02)
            tail = fr.p(sx * eave_x, eave_y - 0.1, back_to(sx * eave_x, eave_y - 0.1))
            uvs = [uv_band("plaster", 0.0, 0.0, 1.2), uv_band("plaster", 0.0, 1.0, 1.2), uv_band("plaster", (head - tail).length, 1.0, 1.2)]
            self.face([foot, head, tail], uvs, "trim", 0.86, fr.r * sx)
        self.sweep([fr.p(0.0, peak + 0.1, 0.24), fr.p(0.0, peak + 0.1, back_to(0.0, peak + 0.1))], (0.12, 0.12), "gilded", depth=0.16)
        self.gem(fr.p(0.0, peak + 0.34, 0.2), 0.1, stretch=1.7)

    def figurehead(self, end=0, width=3.2, thick=0.5, back=0.9, drop=0.5):
        """The golden figurehead riding the prow of the last roof built: a carved slab in
        the plane of the ridge, leaning out over the street."""
        tip, direction = self.roof_tips[end]
        fr = Frame(tip - direction * back - UP * drop, direction, UP)
        self.relief(fr.at(0.0, 0.0, -thick / 2), "figurehead", width, thick, back=True)

    def ivy(self, fr, width=2.4):
        """A patch of ivy climbing a wall from the frame's origin."""
        return self.cloth(fr.at(0.0, 0.0, 0.06), "ivy", width, anchor=(0.5, 0.0), cols=2, rows=2, bulge=0.05)

    # -- towers -----------------------------------------------------------------------------------

    def drum(self, cx, cy, r0, r1, z0, z1, sides=12, mat="stone", v0=0.0):
        """A faceted tower wall, wider at the foot than the head, on a flared plinth."""
        fr = Frame((cx, cy, 0.0), (1, 0, 0), UP, (0, 1, 0))
        self.lathe(fr, [(r0 + 0.45, -FOOTING), (r0 + 0.45, z0), (r0 + 0.1, z0 + 0.6), (r0, z0 + 0.6)], sides=sides, skin=("tile", mat), smooth=False, shade=0.85)
        self.lathe(fr, [(r0, z0 + 0.6), (r1, z1)], sides=sides, skin=("tile", mat), smooth=False, v0=v0 + 0.6)
        self.collide(cx - r0, cx + r0, cy - r0, cy + r0, 0.0, z1)
        self.tower = dict(cx=cx, cy=cy, r0=r0, r1=r1, z0=z0 + 0.6, z1=z1, sides=sides)

    def drum_frame(self, degrees, height):
        """A frame on the flat of the last drum built that faces `degrees` (0 = +X, 90 = +Y,
        -90 = the front), `height` above the ground, leaning back with the wall. Flats face
        every 360 / sides degrees."""
        t = self.tower
        a = math.radians(degrees)
        radial = Vector((math.cos(a), math.sin(a), 0.0))
        tangent = Vector((-math.sin(a), math.cos(a), 0.0))
        flat = math.cos(math.pi / t["sides"])
        slope = (t["r0"] - t["r1"]) * flat / (t["z1"] - t["z0"])
        radius = (t["r0"] + (t["r1"] - t["r0"]) * (height - t["z0"]) / (t["z1"] - t["z0"])) * flat
        up = (UP - radial * slope).normalized()
        return Frame(Vector((t["cx"], t["cy"], height)) + radial * radius, tangent, up)

    def spiral_stair(self, cx, cy, radius, width, z0, z1, start_deg, sweep_deg, steps=16, parapet=1.05, wall=0.34, close=(True, True)):
        """Stone steps winding round a tower from `z0` up to `z1` (the same height makes a
        level landing), on a solid base, with a parapet on the outside. Positive sweep climbs
        anticlockwise seen from above. `close` walls off the (low, high) ends."""
        inner, outer = radius - 0.25, radius + width

        def at(r, degrees, z):
            a = math.radians(degrees)
            return Vector((cx + r * math.cos(a), cy + r * math.sin(a), z))

        def radial(degrees):
            a = math.radians(degrees)
            return Vector((math.cos(a), math.sin(a), 0.0))

        def tangent(degrees):
            a = math.radians(degrees)
            return Vector((-math.sin(a), math.cos(a), 0.0)) * (1.0 if sweep_deg > 0 else -1.0)

        arc = abs(math.radians(sweep_deg)) * (outer + wall) / steps
        for i in range(steps):
            d0 = start_deg + sweep_deg * i / steps
            d1 = start_deg + sweep_deg * (i + 1) / steps
            dm = (d0 + d1) / 2
            low, high = z0 + (z1 - z0) * i / steps, z0 + (z1 - z0) * (i + 1) / steps
            u0, u1 = arc * i, arc * (i + 1)
            # the tread and the riser up to it
            pts = [at(inner, d0, high), at(outer, d0, high), at(outer, d1, high), at(inner, d1, high)]
            self.face(pts, [uv_tile("stone", p.x, p.y) for p in pts], "stone", 1.0, UP)
            pts = [at(inner, d0, low), at(outer, d0, low), at(outer, d0, high), at(inner, d0, high)]
            self.face(pts, [uv_tile("stone", 0.0, low), uv_tile("stone", width, low), uv_tile("stone", width, high), uv_tile("stone", 0.0, high)], "stone", 0.78, -tangent(d0))
            # the outside wall, from under the ground to the top of the parapet
            top0, top1 = low + parapet + 0.25, high + parapet + 0.25
            pts = [at(outer + wall, d0, -FOOTING), at(outer + wall, d1, -FOOTING), at(outer + wall, d1, top1), at(outer + wall, d0, top0)]
            uvs = [uv_tile("stone", u0, -FOOTING), uv_tile("stone", u1, -FOOTING), uv_tile("stone", u1, top1), uv_tile("stone", u0, top0)]
            self.face(pts, uvs, "stone", [0.74, 0.74, 1.0, 1.0], radial(dm))
            # the parapet's inner face and its cap
            pts = [at(outer, d0, high), at(outer, d1, high), at(outer, d1, top1), at(outer, d0, top0)]
            uvs = [uv_tile("stone", u0, high), uv_tile("stone", u1, high), uv_tile("stone", u1, top1), uv_tile("stone", u0, top0)]
            self.face(pts, uvs, "stone", 0.8, -radial(dm))
            pts = [at(outer, d0, top0), at(outer + wall, d0, top0), at(outer + wall, d1, top1), at(outer, d1, top1)]
            self.face(pts, [uv_tile("stone", u0, 0.0), uv_tile("stone", u0, wall), uv_tile("stone", u1, wall), uv_tile("stone", u1, 0.0)], "stone", 1.0, UP)
        # close the two ends of the mass
        end = start_deg + sweep_deg
        if close[1]:
            pts = [at(inner, end, -FOOTING), at(outer + wall, end, -FOOTING), at(outer + wall, end, z1 + parapet + 0.25), at(outer, end, z1 + parapet + 0.25), at(outer, end, z1), at(inner, end, z1)]
            self.face(pts, [uv_tile("stone", (p - at(inner, end, 0.0)).length, p.z) for p in pts], "stone", 0.82, tangent(end))
        if close[0]:
            pts = [at(outer, start_deg, -FOOTING), at(outer + wall, start_deg, -FOOTING), at(outer + wall, start_deg, z0 + parapet + 0.25), at(outer, start_deg, z0 + parapet + 0.25)]
            self.face(pts, [uv_tile("stone", (p - at(outer, start_deg, 0.0)).length, p.z) for p in pts], "stone", 0.82, -tangent(start_deg))

    # -- things that stand about -------------------------------------------------------------------

    def barrel(self, x, y, z=0.0, size=1.0, turn=0.0):
        """A coopered barrel: bulged staves, two iron hoops, a sunk lid."""
        fr = Frame((x, y, z), (math.cos(turn), math.sin(turn), 0.0), UP)
        h, r = 1.2 * size, 0.44 * size
        self.furnish((x, y), z, z + h, r * 0.9, r * 0.9)
        body = [(r * 0.8, 0.0), (r * 0.95, h * 0.22), (r, h * 0.5), (r * 0.95, h * 0.78), (r * 0.8, h)]
        self.lathe(fr, body, sides=10, skin=("band", "planks", 0.36 * size))
        self.lathe(fr, [(r * 0.8, h), (r * 0.7, h), (r * 0.7, h - 0.07 * size), (0.0, h - 0.07 * size)], sides=10, skin=("band", "planks", 0.5 * size), smooth=False, shade=0.8)
        def radius_at(t):
            for (r0, h0), (r1, h1) in zip(body, body[1:]):
                if h0 <= t * h <= h1:
                    return r0 + (r1 - r0) * (t * h - h0) / (h1 - h0)
            return r

        for lo, hi in ((0.13, 0.21), (0.79, 0.87)):
            self.lathe(fr, [(radius_at(lo) + 0.02 * size, h * lo), (radius_at(hi) + 0.02 * size, h * hi)], sides=10, skin=("band", "oak", 0.12), shade=0.5)

    def crate(self, x, y, z=0.0, size=1.0, turn=0.0):
        """A boarded crate with battens on its corners."""
        fr = Frame((x, y, z), (math.cos(turn), math.sin(turn), 0.0), UP)
        h = size / 2
        self.furnish((x, y), z, z + size, h, h, turn)
        self.box(fr, -h, h, 0.0, size, -h, h, ("band", "planks", "x", size * 0.5), skip="b")
        b = 0.09 * size
        for sx in (-1.0, 1.0):
            for sz in (-1.0, 1.0):
                self.box(fr, sx * h - b / 2, sx * h + b / 2, 0.0, size + 0.01, sz * h - b / 2, sz * h + b / 2, ("band", "oak", "y", 0.2), skip="b", shade=0.8)
        # a framed and braced face on all four sides, and a strap round the lid
        proud = 0.025 * size
        for k in range(4):
            a = turn + math.pi / 2 * k
            side = Frame(fr.p(0.0, 0.0, 0.0) + Vector((math.cos(a), math.sin(a), 0.0)) * 0.0, (math.cos(a + math.pi / 2), math.sin(a + math.pi / 2), 0.0), UP)
            face = side.at(0.0, 0.0, h)
            for z0, z1 in ((0.02 * size, 0.02 * size + b), (size - b - 0.02 * size, size - 0.02 * size)):
                self.box(face, -h + b / 2, h - b / 2, z0, z1, 0.0, proud, ("band", "oak", "x", b * 2.2), skip="k", shade=0.78)
            self.sweep([face.p(-h + b, b * 1.3, proud / 2), face.p(h - b, size - b * 1.3, proud / 2)], (b * 0.8, proud), "oak", depth=b * 2.2, up=face.n, caps=False, shade=0.74)
        for sx in (-0.5, 0.5):
            self.box(fr, sx * h - b / 2, sx * h + b / 2, size, size + proud, -h, h, ("band", "gilded", "z", b * 1.2), skip="b")

    def lean(self, kx=0.0, ky=0.0, above=0.0):
        """Racks the whole building a little, the way an old timber house settles: every
        point above `above` slides (kx, ky) yards per yard of height."""
        for v in self.bm.verts:
            if v.co.z > above:
                v.co.x += kx * (v.co.z - above)
                v.co.y += ky * (v.co.z - above)

    def stud_row(self, p0, p1, count, size=0.06):
        """Gold studs along a line (for boards and beams that want more sparkle)."""
        p0, p1 = Vector(p0), Vector(p1)
        for i in range(count):
            self.gem(p0 + (p1 - p0) * ((i + 0.5) / count), size, stretch=1.0)

    # -- finishing ------------------------------------------------------------------------------

    def finish(self, materials, turn=False):
        """Returns the finished objects: the building, and its interior as a second mesh
        when it has one (named with _INT so the town renderer treats it as indoors). `turn`
        spins the building half way round, for the town's own lots: their models face the
        other way (front on the GLB's -Z)."""
        if turn:
            for v in self.bm.verts:
                v.co.x, v.co.y = -v.co.x, -v.co.y
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=0.0005)
        self.bm.normal_update()
        for edge in self.bm.edges:
            if len(edge.link_faces) == 2:
                a, b = edge.link_faces
                if not (a.smooth and b.smooth) or a.normal.angle(b.normal, 0.0) > math.radians(38):
                    edge.smooth = False
            else:
                edge.smooth = False
        objects = []
        has_inside = any(f[self.part_layer] == 1 for f in self.bm.faces)
        for part, suffix in ((0, "_L0"), (1, "_INT_L0")):
            if part == 1 and not has_inside:
                continue
            piece = self.bm.copy()
            layer = piece.faces.layers.int["part"]
            bmesh.ops.delete(piece, geom=[f for f in piece.faces if f[layer] != part], context="FACES")
            mesh = bpy.data.meshes.new(self.name + suffix)
            piece.to_mesh(mesh)
            piece.free()
            for name in self.materials:
                mesh.materials.append(materials[name])
            obj = bpy.data.objects.new(self.name + (suffix if has_inside else ""), mesh)
            bpy.context.scene.collection.objects.link(obj)
            objects.append(obj)
        for part, name in sorted(self.named.items()):
            piece = self.bm.copy()
            layer = piece.faces.layers.int["part"]
            bmesh.ops.delete(piece, geom=[f for f in piece.faces if f[layer] != part], context="FACES")
            mesh = bpy.data.meshes.new(name)
            piece.to_mesh(mesh)
            piece.free()
            for material in self.materials:
                mesh.materials.append(materials[material])
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.scene.collection.objects.link(obj)
            objects.append(obj)
        self.bm.free()
        return objects


def make_material(name, textures):
    """One Principled material per surface. "parts", "parts_solid" and "parts_glow" share the atlas;
    build.py sets alpha mode, glow and the rest in the exported file."""
    image_key = {"parts_solid": "parts", "parts_glow": "parts"}.get(name, name)
    mat = bpy.data.materials.new(f"eh_{name}")
    mat.use_nodes = True
    mat.use_backface_culling = False
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Metallic"].default_value = 0.0
    node = nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(textures[image_key], check_existing=True)
    links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if image_key == "parts":
        clip = nodes.new("ShaderNodeMath")
        clip.operation = "ROUND"
        links.new(node.outputs["Alpha"], clip.inputs[0])
        links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    if name in ("glass", "stained", "parts_glow"):
        links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat
