"""The props' low-poly sources, baked from Tripo's dense models (run once per new model; build_atlas.mjs
reads what it writes):

  blender -b --factory-startup --python scripts/assets/mirefen_tavern/props/bake_low.py -- [ID ...]

(no ids: every prop in props/props.json whose `dense` model is newer than its low one)

Tripo's multi-view models come dense, about two thousand quads, so its texture paints onto their
real shape; the props ship at a few hundred triangles each (props.json `triangles`). Simplifying the
dense mesh in place cannot get there: its texture is cut into hundreds of small islands, and every
seam holds its edges (a simplifier let across them smears the paint along them). So each prop is
brought down the way a painted game prop is made: a copy welded into one surface and decimated to its
budget (Blender's collapse decimation, triangulated), unwrapped afresh (smart projection, its islands packed with a margin),
and the dense model's painted colour baked onto it (Cycles, the diffuse colour alone, no light: the
paint carries its own light and shade), at twice the tile and brought down to it, so the map stays
soft. It writes LOW/<id>.glb: the low mesh in the dense model's frame, its 512 map embedded.
Every step is deterministic, so a rebuild writes the same file.

The dense models and the low ones are a maintainer-local source pack (tmp/asset_src, gitignored, as
the repo keeps every raw pack): props.json names each piece's files there, and the tavern's build
reads only what build_atlas.mjs makes of them (props_data.json and the atlas), which is checked in.
"""
import json
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
LOW = os.path.join(ROOT, 'tmp', 'asset_src', 'mirefen_tavern_props', 'low')
TILE = 512         # the atlas tile each prop's map fills (props.json tile side)
BAKE = 2 * TILE     # baked this big, then brought down to the tile
MARGIN = 6          # the bake's bleed past each island's edge, in tile pixels


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def dense_mesh(path):
    """The dense model imported and joined into one mesh object, its transforms applied."""
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    hi = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return hi


def low_copy(hi, triangles):
    """A copy of the dense mesh decimated to about `triangles`, unwrapped afresh."""
    lo = hi.copy()
    lo.data = hi.data.copy()
    lo.name = 'low'
    bpy.context.scene.collection.objects.link(lo)
    # welded into one surface first: its texture's seams split it into hundreds of pieces, and the
    # decimation would hold every piece's edge and shatter thin parts (its UVs are made afresh)
    for o in bpy.context.scene.objects:
        o.select_set(o is lo)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=max(lo.dimensions) * 1e-4)
    bpy.ops.object.mode_set(mode='OBJECT')
    tris = sum(len(p.vertices) - 2 for p in lo.data.polygons)
    if tris > triangles:
        mod = lo.modifiers.new('decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = triangles / tris
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = lo
        for o in bpy.context.scene.objects:
            o.select_set(o is lo)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # its own fresh UVs, the dense model's left for the bake to read
    while lo.data.uv_layers:
        lo.data.uv_layers.remove(lo.data.uv_layers[0])
    lo.data.uv_layers.new(name='UVMap')
    for o in bpy.context.scene.objects:
        o.select_set(o is lo)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=MARGIN * 2 / BAKE)
    bpy.ops.object.mode_set(mode='OBJECT')
    for poly in lo.data.polygons:
        poly.use_smooth = True
    return lo


def bake(hi, lo, out_png):
    """The dense model's painted colour baked onto the low copy's UVs, saved at the tile's size."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.seed = 0
    image = bpy.data.images.new('baked', BAKE, BAKE, alpha=False)
    mat = bpy.data.materials.new('baked')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    nodes.active = tex
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    lo.data.materials.clear()
    lo.data.materials.append(mat)
    size = max(hi.dimensions)
    for o in scene.objects:
        o.select_set(o in (hi, lo))
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_selected_to_active=True,
                        cage_extrusion=size * 0.03, max_ray_distance=size * 0.1, margin=MARGIN * 2,
                        margin_type='EXTEND')
    image.scale(TILE, TILE)
    image.filepath_raw = out_png
    image.file_format = 'PNG'
    image.save()
    tex.image = image
    return mat


def export(lo, out_glb):
    for o in bpy.context.scene.objects:
        o.select_set(o is lo)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', use_selection=True,
                              export_image_format='JPEG', export_jpeg_quality=92, export_materials='EXPORT',
                              export_normals=True, export_texcoords=True, export_apply=True)


def main(ids):
    with open(os.path.join(HERE, 'props.json'), encoding='utf8') as fh:
        props = {p['id']: p for p in json.load(fh)['props']}
    os.makedirs(LOW, exist_ok=True)
    todo = ids or [i for i, p in props.items() if p.get('dense')]
    for pid in todo:
        p = props[pid]
        dense = os.path.join(ROOT, p['dense'])
        out = os.path.join(LOW, f'{pid}.glb')
        if not ids and os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(dense):
            continue
        clear()
        hi = dense_mesh(dense)
        lo = low_copy(hi, p['triangles'])
        png = os.path.join(bpy.app.tempdir, f'{pid}_baked.png')
        bake(hi, lo, png)
        bpy.data.objects.remove(hi, do_unlink=True)
        export(lo, out)
        tris = sum(len(q.vertices) - 2 for q in lo.data.polygons)
        print(f'BAKED {pid}: {tris} triangles -> {os.path.relpath(out, ROOT)}')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    main(argv)
