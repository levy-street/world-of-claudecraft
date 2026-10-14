# Re-pin DG_TREE_MAX_DIM / DG_SHRUB_MAX_DIM in src/render/asset_scale.ts from
# the kit records the finishers write (data/dg_tree_kit.json,
# data/dg_shrub_kit.json). Every rebuild changes the dims, and a stale table
# mis-scales every placed tree; the finishers print the table but never wrote
# it, so it was a manual paste that kept being forgotten.
#   python3 scripts/assets/deepglass/pin_foliage_scale.py
import json
import os
import re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..')
TS = os.path.join(ROOT, 'src/render/asset_scale.ts')
src = open(TS).read()
for table, kit in (('DG_TREE_MAX_DIM', 'data/dg_tree_kit.json'), ('DG_SHRUB_MAX_DIM', 'data/dg_shrub_kit.json')):
    meta = json.load(open(os.path.join(ROOT, kit)))
    body = ''.join(f'  {n}: {round(max(m["dims"]), 3)},\n' for n, m in meta.items())
    pat = re.compile(r'(const ' + table + r': Record<string, number> = \{\n)(.*?)(\};)', re.S)
    if not pat.search(src):
        raise SystemExit(f'{table} not found in {TS}')
    src = pat.sub(lambda m: m.group(1) + body + m.group(3), src, count=1)
    print(f'{table}: {len(meta)} entries')
open(TS, 'w').write(src)
