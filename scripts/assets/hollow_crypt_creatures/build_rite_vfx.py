"""The Hollow Crypt finale's effect meshes, modelled in Blender: the shapes the
Rite Ring's shaders animate for Morthen's entrance and the Knellwyrm
(src/render/hollow_crypt/crypt_finale_fx.ts).

  blender -b --factory-startup --python build_rite_vfx.py -- <out.glb> [--blend out.blend] [--preview out.png]

Every piece is authored at unit size (the runtime scales it) and carries the UVs
its shader reads; no materials ship (the runtime owns them):

  Vfx_SoulColumn  a column of souls: three ribbons twisting round a hollow core,
                  frayed at the top; u runs round, v up it (the shader scrolls
                  the souls up v and burns them out at the top).
  Vfx_RuneRing    the ritual circle's glyph band: an outer and inner rim and
                  thirty-two rune glyphs between them (strokes, hooks, dots),
                  flat on the floor; u is the angle round the ring, v the
                  radius (the shader ignites it glyph by glyph).
  Vfx_Debris0..3  shards of the crag floor the rise breaks up: jagged, faceted
                  flagstone chips of four shapes, about a yard across.
  Vfx_FlameCard   a tongue of fire as three crossed cards (it reads from every
                  side), base at the origin; the shader runs the flame atlas on it.
"""
import math
import random
import sys

import bmesh
import bpy
from mathutils import Vector

random.seed(4217)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def obj_from_bm(name, bm):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def soul_column():
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    rings, segs = 40, 10
    for ribbon in range(3):
        phase = ribbon * math.tau / 3
        rows = []
        for r in range(rings + 1):
            v = r / rings
            ang = phase + v * math.tau * 1.35
            rad = 0.55 + 0.45 * math.sin(v * math.pi) ** 0.6
            width = 0.34 * (1 - 0.65 * v)
            row = []
            for s in range(segs + 1):
                w = (s / segs - 0.5) * width
                a = ang + w
                # A frayed crest: the ribbon ripples as it climbs.
                wob = 0.06 * math.sin(v * 31 + s * 1.7 + ribbon)
                row.append(bm.verts.new((math.cos(a) * (rad + wob), math.sin(a) * (rad + wob), v)))
            rows.append(row)
        for r in range(rings):
            for s in range(segs):
                f = bm.faces.new((rows[r][s], rows[r][s + 1], rows[r + 1][s + 1], rows[r + 1][s]))
                for lp, (uu, vv) in zip(f.loops, ((s, r), (s + 1, r), (s + 1, r + 1), (s, r + 1))):
                    lp[uv].uv = ((ribbon + uu / segs) / 3, vv / rings)
    # The hollow core the souls wind round.
    core_rows = []
    sides = 16
    for r in range(rings + 1):
        v = r / rings
        rad = 0.32 * (1 - 0.4 * v)
        core_rows.append([bm.verts.new((math.cos(k / sides * math.tau) * rad, math.sin(k / sides * math.tau) * rad, v))
                          for k in range(sides)])
    for r in range(rings):
        for k in range(sides):
            k2 = (k + 1) % sides
            f = bm.faces.new((core_rows[r][k], core_rows[r][k2], core_rows[r + 1][k2], core_rows[r + 1][k]))
            for lp, (uu, vv) in zip(f.loops, ((k, r), (k + 1, r), (k + 1, r + 1), (k, r + 1))):
                lp[uv].uv = (0.999 - 0.001 * uu / sides, vv / rings)
    return obj_from_bm('Vfx_SoulColumn', bm)


def rune_ring():
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    def quad(pts):
        vs = [bm.verts.new((p[0], p[1], 0)) for p in pts]
        f = bm.faces.new(vs)
        for lp, p in zip(f.loops, pts):
            a = (math.atan2(p[1], p[0]) / math.tau) % 1.0
            lp[uv].uv = (a, math.hypot(p[0], p[1]))
        return f

    def band(r0, r1, n=128):
        for k in range(n):
            a0 = k / n * math.tau
            a1 = (k + 1) / n * math.tau
            quad([(math.cos(a0) * r0, math.sin(a0) * r0), (math.cos(a1) * r0, math.sin(a1) * r0),
                  (math.cos(a1) * r1, math.sin(a1) * r1), (math.cos(a0) * r1, math.sin(a0) * r1)])

    band(0.955, 1.0)
    band(0.9, 0.915)
    band(0.62, 0.645)
    band(0.3, 0.315, 64)

    def stroke(a0, r0, a1, r1, w):
        p0 = Vector((math.cos(a0) * r0, math.sin(a0) * r0))
        p1 = Vector((math.cos(a1) * r1, math.sin(a1) * r1))
        d = (p1 - p0)
        if d.length < 1e-6:
            return
        n = Vector((-d.y, d.x)).normalized() * w
        quad([tuple(p0 - n), tuple(p1 - n), tuple(p1 + n), tuple(p0 + n)])

    glyphs = 32
    for g in range(glyphs):
        c = g / glyphs * math.tau
        span = math.tau / glyphs * 0.34
        kind = random.randrange(4)
        stroke(c - span, 0.68, c - span, 0.87, 0.009)
        if kind == 0:
            stroke(c - span, 0.87, c + span, 0.79, 0.009)
            stroke(c + span, 0.79, c + span * 0.2, 0.7, 0.009)
        elif kind == 1:
            stroke(c - span, 0.77, c + span, 0.77, 0.009)
            stroke(c + span, 0.68, c + span, 0.87, 0.009)
        elif kind == 2:
            stroke(c - span, 0.68, c + span, 0.87, 0.009)
            stroke(c + span * 0.2, 0.83, c + span, 0.72, 0.009)
        else:
            stroke(c - span, 0.72, c + span, 0.72, 0.009)
            stroke(c, 0.72, c, 0.87, 0.009)
        # a dot beside every glyph
        a = c + span * 1.9
        r = 0.775
        stroke(a, r - 0.012, a, r + 0.012, 0.012)
    # spokes from the inner band out to the glyph ring
    for k in range(8):
        a = k / 8 * math.tau + math.tau / 64
        stroke(a, 0.315, a, 0.62, 0.006)
    return obj_from_bm('Vfx_RuneRing', bm)


def debris(i):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    sx, sy, sz = 1.0 + random.random() * 0.8, 0.8 + random.random() * 0.6, 0.35 + random.random() * 0.3
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
        v.co += Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * 0.09
    # flat top: a flagstone chip keeps the floor's face
    for v in bm.verts:
        if v.co.z > sz * 0.28:
            v.co.z = sz * 0.28 + random.uniform(0, 0.015)
    return obj_from_bm(f'Vfx_Debris{i}', bm)


def flame_card():
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for k in range(3):
        a = k / 3 * math.pi
        dx, dy = math.cos(a) * 0.3, math.sin(a) * 0.3
        vs = [bm.verts.new((-dx, -dy, 0)), bm.verts.new((dx, dy, 0)), bm.verts.new((dx, dy, 1)),
              bm.verts.new((-dx, -dy, 1))]
        f = bm.faces.new(vs)
        for lp, t in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            lp[uv].uv = t
    return obj_from_bm('Vfx_FlameCard', bm)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    out = argv[0]
    reset()
    pieces = [soul_column(), rune_ring(), flame_card()] + [debris(i) for i in range(4)]
    for k, o in enumerate(pieces):
        o.location.x = k * 3.0
    bpy.ops.object.select_all(action='DESELECT')
    for o in pieces:
        o.select_set(True)
    for o in pieces:
        print('PIECE', o.name, len(o.data.polygons))
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_materials='NONE',
                              export_yup=True, export_apply=True)
    print('EXPORTED', out)
    if '--blend' in argv:
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
