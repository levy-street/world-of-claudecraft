# Two repairs to my own damage:
#  1. bl_fix_spire.py canonicalised the re-imported spire's material by
#     splitting the name at the dot, which folded CartoonTown_Roof (the BLUE
#     roof atlas) into CartoonTown_01 (the orange town atlas). Rebuild the roof
#     material and put the spires back on it.
#  2. The decimate modifier leaves loose edges behind, invisible in a render
#     but drawn as black spikes all over the viewport, and pure waste.
import bpy, bmesh, traceback
try:
    roof = bpy.data.materials.get('CartoonTown_Roof')
    if roof is None:
        roof = bpy.data.materials.new('CartoonTown_Roof')
    roof.use_nodes = True
    nt = roof.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); out.location = (400, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (120, 0)
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Metallic'].default_value = 0.0
    img = bpy.data.images.get('CartoonTown_RoofBlue')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.location = (-200, 0)
    tex.image = img
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if img and not img.packed_file:
        try: img.pack()
        except Exception: pass

    b = bpy.data.objects.get('BLDG')
    spires = 0
    done = set()
    for g in b.children:
        for o in g.children:
            if o.type != 'MESH': continue
            if 'ChurchTower' in o.name or 'ChurchTower' in o.data.name:
                if o.data.name not in done:
                    o.data.materials.clear(); o.data.materials.append(roof)
                    done.add(o.data.name)
                spires += 1
    print(f'spires put back on CartoonTown_Roof (image {img.name if img else "MISSING"}): {spires} objects, {len(done)} meshes')

    cleaned = 0; edges = 0
    seen = set()
    for g in b.children:
        for o in g.children:
            if o.type != 'MESH' or o.data.name in seen: continue
            seen.add(o.data.name)
            bm = bmesh.new(); bm.from_mesh(o.data)
            loose_e = [e for e in bm.edges if not e.link_faces]
            if loose_e:
                bmesh.ops.delete(bm, geom=loose_e, context='EDGES')
                loose_v = [v for v in bm.verts if not v.link_edges]
                if loose_v: bmesh.ops.delete(bm, geom=loose_v, context='VERTS')
                bm.to_mesh(o.data); o.data.update()
                cleaned += 1; edges += len(loose_e)
            bm.free()
    print(f'stripped {edges} loose edges from {cleaned} meshes')
except Exception:
    print(traceback.format_exc())
