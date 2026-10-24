# Pass 3, decimate the heavy *templates* (the ones multiplied by many
# instances). Guarded: anything already carrying '_opt' is skipped, so this is
# safe to re-run. Multi-user data is copied to the holder first, then every
# other user is repointed, because Blender refuses to apply a modifier to
# multi-user meshes.
import bpy, traceback
from collections import Counter
try:
    def tris(me):
        me.calc_loop_triangles(); return len(me.loop_triangles)

    bldg = bpy.data.objects.get('BLDG')
    users = Counter(); holder = {}
    for g in bldg.children:
        for o in g.children:
            if o.type != 'MESH': continue
            users[o.data.name] += 1
            holder.setdefault(o.data.name, o)

    # rank by total cost = per-mesh triangles x instance count
    plan = []
    for name, n in users.items():
        me = bpy.data.meshes[name]
        if me.get('_opt'): continue
        t = tris(me)
        cost = t * n
        if cost < 8000 or t < 300: continue
        target = max(200, int(t * 0.45))
        plan.append((cost, name, t, n, target / t))
    plan.sort(reverse=True)

    saved = 0
    for cost, name, t, n, ratio in plan:
        me = bpy.data.meshes[name]
        obj = holder[name]
        # isolate: give the holder its own copy, repoint everyone else after
        others = [o for o in bpy.data.objects if o.type == 'MESH' and o.data is me and o is not obj]
        obj.data = me.copy()
        new = obj.data
        for x in bpy.data.objects: x.select_set(False)
        obj.select_set(True); bpy.context.view_layer.objects.active = obj
        m = obj.modifiers.new('DEC', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'; m.ratio = ratio; m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
        after = tris(obj.data)
        obj.data['_opt'] = 1
        for o in others: o.data = obj.data
        saved += (t - after) * n
        print(f'  {name:44s} {t:>6,} -> {after:>5,} tris  x{n:<4} saves {(t-after)*n:>8,}')

    total = 0
    for g in bldg.children:
        for o in g.children:
            if o.type == 'MESH': total += tris(o.data)
    print(f'decimated {len(plan)} templates, saved ~{saved:,} tris')
    print(f'castle scene now ~{total:,} tris (pre-join)')
except Exception:
    print(traceback.format_exc())
