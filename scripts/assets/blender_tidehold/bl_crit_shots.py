# Render the CURRENT castle for critique, with 1.8yd player proxies for scale.
#
# RENDER-ONLY SCENE. This re-runs the build from scratch (reset_build) and adds
# proxy cylinders UNDER the BLDG root, so the scene it leaves behind is NOT
# safe to bake, a bake straight after this exports the red proxies into the
# game asset. Always re-run bl_author.py before baking.
import traceback
try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/371e0850-63a3-4b4d-b1ae-21b54c4ddf13/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    exec(open(SCRATCH + '/bl_build_common.py').read())
    import bpy
    exec(open(SCRATCH + '/bl_castle.py').read().split("finalize('tidehold_castle'")[0].split("try:")[1].replace("\n    ", "\n"))
    # Player proxies: 0.9 kit tall (1.8 yd at S=2), 0.3 wide.
    def proxy(x, y, z=0.0, name='P'):
        me = bpy.data.meshes.new('proxy')
        h, r = 0.9, 0.17
        vs, fs = [], []
        import math as _m
        for i in range(10):
            a = i / 10 * 2 * _m.pi
            vs.append((x + _m.cos(a) * r, y + _m.sin(a) * r, z))
            vs.append((x + _m.cos(a) * r, y + _m.sin(a) * r, z + h))
        for i in range(10):
            j = (i + 1) % 10
            fs.append((i * 2, j * 2, j * 2 + 1, i * 2 + 1))
        fs.append(tuple(range(1, 20, 2)))
        me.from_pydata(vs, [], fs); me.update()
        mat = bpy.data.materials.new('proxyMat'); mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.95, 0.15, 0.15, 1)
        me.materials.append(mat)
        o = bpy.data.objects.new(name, me); o.parent = group('L0')
        bpy.context.scene.collection.objects.link(o)
    proxy(0, 2.0)          # mid hall
    proxy(0, -2.6)         # at the foot of the dais steps
    proxy(0, -5.0, 1.0)    # standing ON the dais beside the throne
    proxy(-6.4, -5.2)      # foot of the west flight
    proxy(-6.4, 0.4, 4.4)  # near the head of the west flight
    proxy(6.4, -5.2, 5.0)  # foot of the east flight
    proxy(4.0, 4.0)        # by the door
    proxy(0, 14.0)         # courtyard
    _ROOT.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    D = SCRATCH + '/crit8/'
    # elevations (narrow fov from far = near-orthographic)
    render_shot(D + 'c_elev_south.png', (0, -95, 16), (0, 0, 12), w=1500, h=1000, fov=22)
    render_shot(D + 'c_elev_east.png', (95, 8, 16), (0, 8, 12), w=1500, h=1000, fov=22)
    render_shot(D + 'c_elev_north.png', (0, 110, 16), (0, 8, 12), w=1500, h=1000, fov=22)
    render_shot(D + 'c_hero.png', (44, -52, 34), (0, 4, 10), w=1500, h=1000, fov=40)
    render_shot(D + 'c_tower_top.png', (26, -30, 30), (-9.8, -8.55, 17), w=1400, h=1000, fov=34)
    # interiors: hide the terrace so we can see in
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(True)
    render_shot(D + 'c_in_door_to_dais.png', (0, 9.5, 3.2), (0, -8, 2.0), w=1500, h=1000, fov=68)
    render_shot(D + 'c_in_dais.png', (0, 0.0, 2.4), (0, -7.0, 1.4), w=1500, h=1000, fov=54)
    render_shot(D + 'c_in_dais_steps.png', (2.6, -0.4, 1.9), (-0.6, -5.2, 1.0), w=1500, h=1000, fov=54)
    render_shot(D + 'c_in_dais_side.png', (6.5, -3.0, 2.6), (-2.0, -6.0, 1.4), w=1500, h=1000, fov=60)
    render_shot(D + 'c_stair_low.png', (-2.0, 6.0, 3.4), (-6.4, -3.0, 2.6), w=1400, h=1000, fov=60)
    render_shot(D + 'c_stair_low_head.png', (-2.4, -1.0, 7.2), (-6.4, -4.6, 4.6), w=1400, h=1000, fov=58)
    render_shot(D + 'c_stair_up.png', (2.0, -6.5, 8.4), (6.4, 0.0, 7.6), w=1400, h=1000, fov=58)
    render_shot(D + 'c_stair_up_head.png', (2.0, 5.0, 12.4), (6.4, 1.6, 9.8), w=1400, h=1000, fov=58)
    render_shot(D + 'c_stair_side.png', (-11.5, -6.0, 4.0), (-6.4, -0.5, 2.4), w=1400, h=1000, fov=60)
    render_shot(D + 'c_in_gallery.png', (-10.0, 9.0, 9.5), (4.0, -6.0, 6.0), w=1500, h=1000, fov=62)
    render_shot(D + 'c_in_top_down.png', (0, -1.0, 26), (0, -1.0, 0), w=1400, h=1200, fov=52)
    for o in list(_GROUPS.get('H2').children):
        o.hide_set(False)
    print('CRIT SHOTS DONE')
except Exception:
    print(traceback.format_exc())
