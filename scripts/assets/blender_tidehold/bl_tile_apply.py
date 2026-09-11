# Stage 3: wire the baked maps into a material, put it on the 12-tri tile, and
# repoint every tile in the castle at it.
import bpy, traceback
try:
    S = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    lo = bpy.data.objects['TILE_LO']
    me = lo.data
    me.name = 'TPL_environment_Tile_01_BAKED'

    mat = bpy.data.materials.get('TileBaked') or bpy.data.materials.new('TileBaked')
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (600, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (280, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = 0.88
    bsdf.inputs['Metallic'].default_value = 0.0

    def img(path, name, data):
        for i in list(bpy.data.images):
            if i.name == name: bpy.data.images.remove(i)
        im = bpy.data.images.load(path)
        im.name = name
        im.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        im.pack()
        return im

    ctex = nt.nodes.new('ShaderNodeTexImage'); ctex.location = (-160, 160)
    ctex.image = img(f'{S}/tile_color_ao.png', 'TileBaked_Color', False)
    nt.links.new(ctex.outputs['Color'], bsdf.inputs['Base Color'])

    ntex = nt.nodes.new('ShaderNodeTexImage'); ntex.location = (-160, -220)
    ntex.image = img(f'{S}/tile_normal.png', 'TileBaked_Normal', True)
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nmap.location = (60, -220)
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

    me.materials.clear(); me.materials.append(mat)

    # repoint every tile in the castle
    b = bpy.data.objects.get('BLDG')
    n = 0
    for g in b.children:
        for o in g.children:
            if o.type != 'MESH': continue
            if 'Tile_01' in o.name or 'Tile_01' in o.data.name:
                o.data = me; n += 1
    me['_opt'] = 1
    lo.location = (0, 0, -1000)
    def tris(m):
        m.calc_loop_triangles(); return len(m.loop_triangles)
    total = sum(tris(o.data) for g in b.children for o in g.children if o.type == 'MESH')
    print(f'repointed {n} tiles at the baked 12-tri tile')
    print(f'castle scene now ~{total:,} tris (pre-join)')
except Exception:
    print(traceback.format_exc())
