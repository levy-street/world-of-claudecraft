import json
import traceback

try:
    import os
    # Repo root: a prepended REPO_ROOT, else WOC_REPO, else from __file__ (absent under a text-block or bridge exec).
    REPO_ROOT = globals().get('REPO_ROOT') or os.environ.get('WOC_REPO') or os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(globals()['__file__'])), '..', '..', '..'))
    SCRATCH = os.path.join(REPO_ROOT, 'scripts/assets/blender_tidehold')
    exec(open(SCRATCH + '/bl_helpers.py').read())
    for shot in json.load(open(SCRATCH + '/reshoot.json')):
        render_shot(
            shot['out'],
            tuple(shot['eye']),
            tuple(shot['target']),
            w=shot.get('w', 1600),
            h=shot.get('h', 1000),
            fov=shot.get('fov', 45),
            shading=shot.get('shading', 'RENDERED'),
        )
        print('OK', shot['out'])
except Exception:
    print(traceback.format_exc())
