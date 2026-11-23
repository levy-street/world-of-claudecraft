# Place the fitted WOC head pack pieces into a COPY of the character blend, for art review:
# runs the same build as woc_head_pack.py (append, fit, decimate, rename, bone-parent) for
# each type, keeps the pieces in new collections `HEADS | Type A` / `HEADS | Type B` (an
# earlier placement's collections are removed), shows the catalog default look at the
# catalog's default face controls (Chin softness 0.65, the default hairstyle's scalp tuck),
# hides the other library variants and the retired old heads, then saves to the path given.
# It never saves over the opened file.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b \
#     "<WOC Armor Studio>/claude-animation-20260924/WOC_Characters_Anim_v01.blend" \
#     --python scripts/assets/woc_character/woc_head_place_in_blend.py -- \
#     --out <copy.blend> [--types a,b]
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import woc_head_pack as hp  # noqa: E402

# the catalog's default face controls (src/render/characters/woc_head_catalog.ts)
DEFAULT_CHIN = 0.65


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'out': None, 'types': ['a', 'b']}
    i = 0
    while i < len(argv):
        if argv[i] == '--out':
            opts['out'] = argv[i + 1]; i += 1
        elif argv[i] == '--types':
            opts['types'] = [t for t in argv[i + 1].split(',') if t]; i += 1
        i += 1
    if not opts['out']:
        raise SystemExit('usage: -- --out <copy.blend> [--types a,b]')
    return opts


def snapshot_visibility():
    cols = {c.name: (c.hide_viewport, c.hide_render) for c in bpy.data.collections}
    lcs = {}

    def walk(lc):
        lcs[lc.name] = (lc.exclude, lc.hide_viewport)
        for ch in lc.children:
            walk(ch)
    walk(bpy.context.view_layer.layer_collection)
    poses = {o.name: o.data.pose_position for o in bpy.data.objects if o.type == 'ARMATURE'}
    # the build reveals the old heads, every class body, chest and cover to evaluate them
    objs = {}
    for o in bpy.data.objects:
        try:
            hidden = o.hide_get()
        except RuntimeError:
            hidden = None
        objs[o.as_pointer()] = (o, hidden, o.hide_viewport, o.hide_render)
    return cols, lcs, poses, objs


def restore_visibility(snap):
    cols, lcs, poses, objs = snap
    for c in bpy.data.collections:
        if c.name in cols:
            c.hide_viewport, c.hide_render = cols[c.name]

    def walk(lc):
        if lc.name in lcs:
            lc.exclude, lc.hide_viewport = lcs[lc.name]
        for ch in lc.children:
            walk(ch)
    walk(bpy.context.view_layer.layer_collection)
    for name, pp in poses.items():
        o = bpy.data.objects.get(name)
        if o is not None:
            o.data.pose_position = pp
    for o, hidden, hv, hr in objs.values():
        try:
            o.hide_viewport = hv
            o.hide_render = hr
            if hidden is not None:
                o.hide_set(hidden)
        except (ReferenceError, RuntimeError):
            pass  # removed during the build (the appended sources, the v1 pieces)


def remove_v1():
    """Drop the earlier placement's pieces (retired to `HEADS | Type <T>__v1` by the first build)."""
    gone = 0
    for c in list(bpy.data.collections):
        if c.name.startswith('HEADS | Type ') and c.name.endswith('__v1'):
            for o in list(c.objects):
                bpy.data.objects.remove(o, do_unlink=True)
                gone += 1
            bpy.data.collections.remove(c)
    return gone


def main():
    opts = parse_args()
    out = os.path.abspath(opts['out'])
    if bpy.data.filepath and os.path.abspath(bpy.data.filepath) == out:
        raise SystemExit('refusing to save over the opened character file')
    snap = snapshot_visibility()
    placed = []
    ctxs = []
    for n, t in enumerate(opts['types']):
        # the first build retires every earlier placement; a later one must not retire the
        # pieces this session just placed, and may take .001 role names (review blend only)
        ctx = hp.build({'type': t, 'out': None, 'report': None, 'review': None, 'render': False,
                        'retire': ['A', 'B'] if n == 0 else [], 'strict_names': n == 0})
        ctxs.append(ctx)
        T, L = ctx['T'], ctx['L']
        coll = ctx['out_coll']
        coll.name = 'HEADS | Type %s' % L
        # drop the appended Face Studio sources, keep only the fitted pieces
        work = ctx['work']
        for o in list(work.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(work)
        show = set(hp.default_nodes(T, L))
        values = {'FS_Chin_Softness': DEFAULT_CHIN}
        hair = T['defaults'].get('hair')
        if hair and hair != 'bald':
            values['FS_Tuck_' + hair] = 1.0
        else:
            values['FS_Bald_Crown'] = 1.0
        for nm, o in ctx['piece_objs'].items():
            visible = nm in show
            if o.data.shape_keys:
                for kb in o.data.shape_keys.key_blocks[1:]:
                    kb.value = values.get(kb.name, 0.0) if visible else 0.0
            placed.append((coll.name, nm, visible))
        ctx['show'] = show
    removed = remove_v1()
    restore_visibility(snap)
    for ctx in ctxs:
        T = ctx['T']
        for nm, o in ctx['piece_objs'].items():
            visible = nm in ctx['show']
            o.hide_set(not visible)
            o.hide_viewport = False
            o.hide_render = not visible
        for nm in T['old_pieces']:
            o = bpy.data.objects.get(nm)
            if o is not None:
                o.hide_set(True)
                o.hide_render = True
        c = ctx['out_coll']
        c.hide_viewport = False
        c.hide_render = False
    # the removed sources and v1 pieces leave meshes (and their shape-key blocks) with no users;
    # nothing with no users is ever saved, but an orphaned key block fails the save's checks
    purged = bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=False, do_recursive=True)
    hp.log('purged %s orphan datablocks' % purged)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out, copy=True)
    for ctx in ctxs:
        names = sorted(ctx['show'])
        hp.log('placed %s: %d pieces, default look shown: %s' % (ctx['out_coll'].name, len(ctx['piece_objs']),
                                                                 ', '.join(names)))
    hp.log('removed %d v1 pieces' % removed)
    hp.log('saved copy', out)


if __name__ == '__main__':
    main()
