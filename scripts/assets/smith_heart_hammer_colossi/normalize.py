"""Normalize the three Tripo statues into the Hammer kit's colossus frames and write one source GLB.

Each statue: parents flattened and joined into one mesh, turned by its `yaw` (these Tripo builds
face +X in Blender, and -90 about Z turns them to -Y, which is +z in glTF: the kit's forward, toward
the pit), scaled uniformly to its `height`, its footprint centred on the origin, its base sunk to
`minY` (a yard into its step). One material per statue, renamed to its painting (no tripo_ prefix,
so its atlas takes ETC1S) with only the base colour kept (the painted kit reads the map alone).
Then orthographic front, left and back renders per statue for review.

  "<blender>" -b --factory-startup --python scripts/assets/smith_heart_hammer_colossi/normalize.py -- scripts/assets/smith_heart_hammer_colossi/normalize.json
"""
import bpy, json, math, os, sys
from mathutils import Matrix, Vector

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1]))
# Paths in the config are relative to the repo root, where this runs from.
P = os.path.abspath
bpy.ops.wm.read_factory_settings(use_empty=True)
done = []

for st in cfg['statues']:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=P(st['raw']))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for o in new:
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if st.get('yaw'):
        # On the mesh data: the glTF importer leaves objects in quaternion mode, where
        # rotation_euler does nothing.
        ob.data.transform(Matrix.Rotation(math.radians(st['yaw']), 4, 'Z'))
        ob.data.update()
    vs = [v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    s = st['height'] / (mx.z - mn.z)
    foot = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    lift = Vector((0, 0, st['minY']))
    for v in ob.data.vertices:
        v.co = (v.co - foot) * s + lift
    ob.data.update()
    ob.name = st['node']
    ob.data.name = st['node']
    # One painting: keep the base colour, unlink and drop every other image.
    for i, mat in enumerate(ob.data.materials):
        mat.name = st['material'] if i == 0 else f"{st['material']}_{i}"
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        keep = set()
        if bsdf:
            for link in list(nt.links):
                if link.to_node == bsdf and link.to_socket.name == 'Base Color':
                    keep.add(link.from_node)
            for link in list(nt.links):
                if link.to_node == bsdf and link.to_socket.name != 'Base Color':
                    nt.links.remove(link)
            bsdf.inputs['Roughness'].default_value = 0.95
            bsdf.inputs['Metallic'].default_value = 0.0
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and n not in keep:
                nt.nodes.remove(n)
    if len(ob.data.materials) > 1:
        print('WARN', st['node'], 'has', len(ob.data.materials), 'materials')
    vs = [v.co for v in ob.data.vertices]
    size = [max(v[k] for v in vs) - min(v[k] for v in vs) for k in range(3)]
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print('STATUE', st['node'], 'tris', tris, 'size x/y/z', ' '.join(f'{d:.1f}' for d in size),
          'scale', round(s, 4))
    done.append(ob)

# One source GLB with the three statues.
bpy.ops.object.select_all(action='DESELECT')
for ob in done:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=P(cfg['out']), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True, export_animations=False)
print('WROTE', cfg['out'], os.path.getsize(P(cfg['out'])))

# Review renders: orthographic, flat texture colour, front (looking down +Y at the -Y face), left, back.
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'TEXTURE'
scene.render.resolution_x = 640
scene.render.resolution_y = 720
scene.render.film_transparent = False
world = bpy.data.worlds.new('w')
scene.world = world
cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
for ob in done:
    for other in done:
        other.hide_render = other is not ob
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    h = max(v.z for v in vs) - min(v.z for v in vs)
    w = max(max(v.x for v in vs) - min(v.x for v in vs), max(v.y for v in vs) - min(v.y for v in vs))
    cam_data.ortho_scale = max(h, w) * 1.1
    mid_z = (max(v.z for v in vs) + min(v.z for v in vs)) / 2
    d = 200
    out_dir = os.path.join(P(cfg['renders']), ob.name)
    os.makedirs(out_dir, exist_ok=True)
    # The statue faces -Y: the front camera stands at -Y looking +Y.
    for view, (x, y, rz) in {'front': (0, -d, 0), 'left': (d, 0, 90), 'back': (0, d, 180)}.items():
        cam.location = (x, y, mid_z)
        cam.rotation_euler = (math.radians(90), 0, math.radians(rz))
        scene.render.filepath = os.path.join(out_dir, f'{view}.png')
        bpy.ops.render.render(write_still=True)
print('RENDERS', P(cfg['renders']))
