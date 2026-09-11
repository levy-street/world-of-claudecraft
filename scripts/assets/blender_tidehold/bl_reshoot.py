import json
import traceback

try:
    SCRATCH = '/private/tmp/claude-501/-Users-troy-Documents-Codex/cbf8046f-7d43-48f1-b70b-3b602edd9a6d/scratchpad'
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
