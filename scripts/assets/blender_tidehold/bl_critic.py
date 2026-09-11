# Critic pack: renders the CURRENT scene (one finalized building) from orbit,
# interior and plan views. Reads the building name from critic_cfg.json.
import json
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/cbf8046f-7d43-48f1-b70b-3b602edd9a6d/scratchpad'
    exec(open(SCRATCH + '/bl_helpers.py').read())
    cfg = json.load(open(SCRATCH + '/critic_cfg.json'))
    name = cfg['name']
    OUT = SCRATCH + '/critic2'
    root = bpy.data.objects.get('BLDG')
    from mathutils import Vector
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    ext = max(hi.x - lo.x, hi.y - lo.y)
    D = ext * 1.05
    H = (hi.z - lo.z) * 0.75
    mid = (hi.z - lo.z) * 0.45
    for tag, eye in [
        ('ext_ne', (cx + D, cy + D, H)), ('ext_nw', (cx - D, cy + D, H)),
        ('ext_sw', (cx - D, cy - D, H)), ('ext_se', (cx + D, cy - D, H)),
        ('ext_front', (cx, cy + D * 1.25, mid)),
    ]:
        render_shot(f'{OUT}/{name}_{tag}.png', eye, (cx, cy, mid), w=1300, h=900, fov=42)
    # interiors + plan: hide upper groups
    hid = []
    for gname in ('G_H1', 'G_H2'):
        g = bpy.data.objects.get(gname)
        if g:
            for o in g.children_recursive:
                o.hide_set(True)
                hid.append(o)
    xr, yr = (hi.x - lo.x) * 0.28, (hi.y - lo.y) * 0.28
    eyeZ = 3.6
    for tag, eye, tgt in [
        ('int_a', (cx + xr, cy + yr, eyeZ), (cx - xr, cy - yr, 1.4)),
        ('int_b', (cx - xr, cy + yr, eyeZ), (cx + xr, cy - yr, 1.4)),
        ('int_c', (cx, cy - yr * 1.2, eyeZ), (cx, cy + yr, 1.6)),
        ('plan', (cx + 0.01, cy, (hi.z - lo.z) + ext * 0.75), (cx, cy, 0)),
    ]:
        render_shot(f'{OUT}/{name}_{tag}.png', eye, tgt, w=1300, h=900, fov=55 if tag != 'plan' else 40)
    for o in hid:
        o.hide_set(False)
    print('CRITIC PACK OK', name)
except Exception:
    print(traceback.format_exc())
