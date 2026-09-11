# One piece, one camera, framed on the piece's own centre, so the only
# difference between the two images is the geometry.
import bpy, traceback, math
from mathutils import Vector
try:
    NAME = globals()['NAME']; WHICH = globals()['WHICH']
    S = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    sc = bpy.context.scene
    hidden = [o for o in bpy.data.objects if not o.hide_render]
    for o in hidden: o.hide_render = True
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{S}/{WHICH}/{NAME}.glb')
    new = [o for o in bpy.data.objects if o not in before]
    for o in new: o.hide_render = False
    bpy.context.view_layer.update()
    lo = Vector((1e9,)*3); hi = Vector((-1e9,)*3)
    for o in new:
        if o.type != 'MESH': continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    ctr = (lo + hi) / 2; span = max(hi.x-lo.x, hi.y-lo.y, hi.z-lo.z, 3.0)
    cam_d = bpy.data.cameras.new('SOLOCAM'); cam = bpy.data.objects.new('SOLOCAM', cam_d)
    sc.collection.objects.link(cam); sc.camera = cam; cam_d.lens = 55
    d = span * 1.6
    cam.location = ctr + Vector((-d*0.5, -d*1.0, d*0.45))
    cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sun_d = bpy.data.lights.new('SOLOSUN', 'SUN'); sun_d.energy = 4.0
    sun = bpy.data.objects.new('SOLOSUN', sun_d); sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(38))
    sc.render.resolution_x, sc.render.resolution_y = 1000, 800
    sc.render.filepath = f'{S}/shots/solo_{NAME}_{WHICH}.png'
    bpy.ops.render.render(write_still=True)
    for o in new + [cam, sun]:
        try: bpy.data.objects.remove(o, do_unlink=True)
        except Exception: pass
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    for o in hidden: o.hide_render = False
    print('solo', NAME, WHICH)
except Exception:
    print(traceback.format_exc())
