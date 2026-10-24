# Contact sheet: imports GLBs listed in sheet_config.json, arranges in a grid,
# offscreen-renders to PNG. Prints row-major index -> name mapping.
import json
import traceback

try:
    import os
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    SCRATCH = os.path.join(REPO_ROOT, 'scripts/assets/blender_tidehold')
    exec(open(SCRATCH + '/bl_helpers.py').read())
    cfg = json.load(open(SCRATCH + '/sheet_config.json'))
    items = cfg['items']
    cols = cfg.get('cols', 6)
    sx = cfg.get('sx', 8.0)
    sy = cfg.get('sy', 9.0)
    clear_scene()
    ensure_sun()
    rows = (len(items) + cols - 1) // cols
    for i, rel in enumerate(items):
        col = i % cols
        row = i // cols
        px = col * sx
        py = -row * sy
        anchor = bpy.data.objects.new(f'anchor_{i}', None)
        anchor.location = (px, py, 0)
        bpy.context.scene.collection.objects.link(anchor)
        try:
            new = import_glb(PACK + '/' + rel + '.glb')
            for o in new:
                if o.parent is None:
                    o.parent = anchor
        except Exception as e:
            print(f'[{i}] IMPORT FAIL {rel}: {e}')
        print(f'[{i}] r{row}c{col} {rel}')
    cx = (cols - 1) * sx / 2
    cy = -(rows - 1) * sy / 2
    span = max(cols * sx, rows * sy)
    render_shot(
        cfg['out'],
        (cx, cy - span * 0.85, span * 0.62),
        (cx, cy, 1.2),
        w=cfg.get('w', 1800),
        h=cfg.get('h', 1200),
        fov=50,
    )
    print('SHEET OK ->', cfg['out'])
except Exception:
    print(traceback.format_exc())
