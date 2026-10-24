# Standard review renders of the Tidehold buildings, over the BlenderMCP bridge.
#
#   python3 ~/.claude/tools/blender_bridge.py run <a wrapper that sets the globals>
#
# The wrapper prepends the three globals this reads:
#   SRC   directory of Blender-importable GLBs  (round-trip them through
#         strip_for_blender.mjs (beside this file) first: the shipped files carry
#         EXT_meshopt_compression + KHR_mesh_quantization + EXT_texture_webp
#         and Blender's importer hard-errors on all three)
#   OUT   directory for the PNGs
#   NAMES list of stems, e.g. ['tavern_b', 'house_d']
#   TAG   filename prefix, e.g. 'after'
#
# Six views per building: four corners at eye height (the read a player gets
# walking past), one high three-quarter for the silhouette, one tight crop on
# the front door for the material read. Frames are derived from each model's
# own bounds, so the same camera set works for a cottage and for castle B.
import math
import traceback

try:
    exec(open(BL_HELPERS).read())          # noqa: F821  (wrapper sets BL_HELPERS)
    import bpy
    from mathutils import Vector

    try:
        bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    except Exception as e:
        print('engine:', e)

    def bounds(objs):
        lo = Vector((1e9,) * 3)
        hi = Vector((-1e9,) * 3)
        every = []
        for o in objs:
            every.append(o)
            every += list(o.children_recursive)
        for o in every:
            if o.type != 'MESH':
                continue
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                for i in range(3):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
        return lo, hi

    for name in NAMES:                      # noqa: F821
        clear_scene()                       # noqa: F821
        ensure_sun()                        # noqa: F821
        objs = import_glb(f'{SRC}/{name}.glb')       # noqa: F821
        lo, hi = bounds(objs)
        ctr = (lo + hi) / 2
        size = hi - lo
        R = max(size.x, size.y) * 0.95
        eye_z = lo.z + 2.6                  # a player's head, 1.8 yd, plus a little
        # The first offscreen draw of a fresh scene comes back black: warm it.
        render_shot(f'{OUT}/_warm.png', (ctr.x + R, ctr.y, eye_z),   # noqa: F821
                    (ctr.x, ctr.y, ctr.z), w=64, h=64)
        for i, tag in enumerate(('e', 'n', 'w', 's')):
            a = i / 4 * 2 * math.pi + math.pi / 8
            render_shot(f'{OUT}/{TAG}_{name}_{tag}.png',            # noqa: F821
                        (ctr.x + math.cos(a) * R, ctr.y + math.sin(a) * R, eye_z),
                        (ctr.x, ctr.y, lo.z + size.z * 0.38), w=900, h=680, fov=52)
        render_shot(f'{OUT}/{TAG}_{name}_hero.png',                 # noqa: F821
                    (ctr.x + R * 1.25, ctr.y - R * 1.25, lo.z + size.z * 1.05),
                    (ctr.x, ctr.y, lo.z + size.z * 0.42), w=1100, h=760, fov=40)
        # Tight crop: front is -Y in model space (the build scripts face +Y in
        # Blender and finalize flips), so stand off the -Y face and look in.
        d = size.y / 2 + max(3.0, size.y * 0.16)
        render_shot(f'{OUT}/{TAG}_{name}_detail.png',               # noqa: F821
                    (ctr.x, ctr.y - d, lo.z + min(3.0, size.z * 0.3)),
                    (ctr.x, ctr.y, lo.z + min(3.4, size.z * 0.34)), w=1100, h=760, fov=26)
        print('shot', name, 'size', [round(v, 2) for v in size])
    print('SHOTS OK')
except Exception:
    traceback.print_exc()
