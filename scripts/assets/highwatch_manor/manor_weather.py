"""The Highwatch manor's weathering, baked into the vertex colours after the warm light: the
painted maps carry the brushwork's own age (lichen, stains, chipped edges), the vertex colours
the manor's, per face, over the paint.

  - ambient occlusion: a fixed fan of short rays off every face against the whole model, so
    corners, reveals, the undersides of copings and the ground under the eaves go darker;
  - grime: exterior faces darken and brown toward the ground line (rain splash on the plinth);
  - moss: the shaded north faces near the ground take a green cast;
  - eaves: an exterior wall face with a roof right over it sits in the eaves' shadow;
  - sun: exterior tops (copings, sills, the garden wall's cap, slates) bleach a little.

Each rule reads the material the builders gave a face (the painter remembers it), whatever map
the face now wears; on a painted face the grime, the moss and the sun are mixed in the paint's
own terms (over its family's reference, under the headroom: manor_texture.Painter.to_paint), so
they weather the paint as they weathered the palette, and the slates keep a grey tint (their
blue is the map's).

Deterministic: fixed ray directions, no randomness. Glow and glass keep their colours.
"""
import math

import bmesh  # noqa: F401
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from shiplib import G as game

from manor_lib import EMISSIVE, SLATE, STONE

AO_REACH = 1.6
AO_RAYS = 12
GRIME = (0.33, 0.29, 0.22)
MOSS = (0.3, 0.4, 0.2)
SUN = (0.9, 0.88, 0.84)


def _fan():
    """AO_RAYS directions on the upper hemisphere (z up), cosine-spread by a golden spiral."""
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(AO_RAYS):
        t = (i + 0.5) / AO_RAYS
        r = math.sqrt(t)
        a = golden * i
        out.append(Vector((math.cos(a) * r, math.sin(a) * r, math.sqrt(max(0.0, 1 - t)))))
    return out


def _frame(n):
    """A tangent frame round the Blender-space normal n."""
    up = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    t = n.cross(up).normalized()
    b = n.cross(t)
    return t, b


def _bvh(parts, names):
    verts, polys = [], []
    for name in names:
        bm = parts[name].bm
        base = len(verts)
        verts.extend(v.co.copy() for v in bm.verts)
        bm.verts.index_update()
        polys.extend([base + v.index for v in f.verts] for f in bm.faces)
    return BVHTree.FromPolygons(verts, polys)


def _mix(c, target, k):
    return tuple(c[i] + (target[i] - c[i]) * k for i in range(3))


def bake_weather(parts, inside, painter, roof_name='ManorRoof'):
    solid = [n for n in parts if n != 'ManorGlow']
    world = _bvh(parts, solid)
    roofs = _bvh(parts, [roof_name])
    fan = _fan()
    up = Vector((0, 0, 1))
    for name in solid:
        piece = parts[name]
        bm = piece.bm
        bm.normal_update()
        for f in bm.faces:
            # the builders' material: the stone takes the moss, the slates the sun
            mat = painter.source_material(piece, f)
            if mat in EMISSIVE:
                continue
            n = f.normal.normalized()
            c = f.calc_center_median()
            o = c + n * 0.03
            # ambient occlusion: the share of the fan that meets the model within reach
            t, b = _frame(n)
            hit = 0.0
            for d in fan:
                ray = (t * d.x + b * d.y + n * d.z).normalized()
                loc, _, _, dist = world.ray_cast(o, ray, AO_REACH)
                if loc is not None:
                    hit += 1.0 - dist / AO_REACH
            ao = 1.0 - 0.6 * hit / len(fan)
            g = game(c)
            gn = game(n)
            exterior = not inside(g.x, g.y, g.z)
            mult = ao
            tint = []
            if exterior and mat != SLATE:
                if abs(gn.y) < 0.5:
                    # rain splash and grime up the lowest yard and a half of the walls
                    k = max(0.0, min(1.0, (1.4 - g.y) / 1.8))
                    mult *= 1.0 - 0.3 * k
                    tint.append((GRIME, 0.24 * k))
                    # moss on the shaded north faces near the ground
                    if mat == STONE and gn.z > 0.3 and g.y < 1.2:
                        tint.append((MOSS, 0.5 * gn.z * max(0.0, min(1.0, (1.2 - g.y) / 1.4))))
                    # the eaves' shadow: a roof right over the face
                    loc, _, _, dist = roofs.ray_cast(o, up, 2.6)
                    if loc is not None:
                        mult *= 0.8 + 0.2 * dist / 2.6
                elif gn.y > 0.7:
                    tint.append((SUN, 0.1))
            if exterior and mat == SLATE and gn.y > 0.3:
                tint.append((SUN, 0.06))
            # each target in the face's own colour terms (the paint's on a painted face)
            tint = [(painter.to_paint(piece, f, target), k) for (target, k) in tint]
            for loop in f.loops:
                r, gg, bb, a = loop[piece.col]
                col = (r, gg, bb)
                for (target, k) in tint:
                    col = _mix(col, target, k)
                loop[piece.col] = (*painter.store(f, (col[0] * mult, col[1] * mult, col[2] * mult)), a)
