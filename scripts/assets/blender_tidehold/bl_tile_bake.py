# Stage 2: bake the high-poly tile's relief down onto a 12-triangle box.
# The cobbles in this kit are GEOMETRY, not texture, the atlas only carries
# flat palette colours, so flattening the tile without a bake leaves plain
# grey bands. Colour + AO + normal together put the stones back.
import bpy, traceback, bmesh
from mathutils import Vector
try:
    S = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    RES = globals().get('RES', 1024)
    hi = bpy.data.objects['TILE_HI']
    HX = HY = 1.25
    Z0, Z1 = -0.003, 0.140

    old = bpy.data.objects.get('TILE_LO')
    if old: bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new('TILE_LO')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= HX * 2; v.co.y *= HY * 2
        v.co.z = Z1 if v.co.z > 0 else Z0
    bm.to_mesh(me); bm.free()
    lo = bpy.data.objects.new('TILE_LO', me)
    bpy.context.scene.collection.objects.link(lo)

    # Planar projection from +Z: the top face lands on exactly 0..1, and the
    # side faces collapse to the border (they are buried between tiles).
    me.uv_layers.new(name='UVMap')
    uv = me.uv_layers[0]
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x + HX) / (2 * HX), (co.y + HY) / (2 * HY))

    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    try: sc.cycles.device = 'CPU'
    except Exception: pass
    sc.render.bake.use_selected_to_active = True
    sc.render.bake.cage_extrusion = 0.09
    sc.render.bake.max_ray_distance = 0.14
    sc.render.bake.use_clear = True
    sc.render.bake.margin = 16

    mat = bpy.data.materials.get('TileBaked') or bpy.data.materials.new('TileBaked')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'): nt.nodes.remove(n)
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    me.materials.clear(); me.materials.append(mat)

    imgs = {}
    def target(name, is_data):
        img = bpy.data.images.get(name)
        if img: bpy.data.images.remove(img)
        img = bpy.data.images.new(name, RES, RES, alpha=False,
                                  float_buffer=False, is_data=is_data)
        node = nt.nodes.new('ShaderNodeTexImage')
        node.image = img
        nt.nodes.active = node
        imgs[name] = (img, node)
        return img, node

    def run(bake_type, name, is_data, samples):
        img, node = target(name, is_data)
        sc.cycles.samples = samples
        for x in bpy.data.objects: x.select_set(False)
        hi.select_set(True); lo.select_set(True)
        bpy.context.view_layer.objects.active = lo
        kw = {'type': bake_type}
        if bake_type == 'DIFFUSE':
            kw['pass_filter'] = {'COLOR'}
        bpy.ops.object.bake(**kw)
        img.filepath_raw = f'{S}/tile_{name}.png'
        img.file_format = 'PNG'
        img.save()
        print(f'  baked {name} -> tile_{name}.png')

    run('DIFFUSE', 'color',  False, 1)
    run('NORMAL',  'normal', True,  1)
    run('AO',      'ao',     True,  64)
    print('TILE BAKE DONE')
except Exception:
    print(traceback.format_exc())
