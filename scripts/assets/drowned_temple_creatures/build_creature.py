"""Build one Drowned Temple creature: model, rigid-skinned rig and clip set.

  blender -b --factory-startup --python build_creature.py -- <name> <out.glb> [--preview out.png] [--blend out.blend]

The creatures (src/render/characters/manifest.ts VISUALS rows, the temple block):
  eel          The Lagoon Eel (eel.py): a great eel reared out of its own coils.
  snapper      The Lagoon Snapper (snapper.py): a moss-shelled temple turtle.
  siren        The Moonlit Siren (siren.py): a finned sea-priestess on a serpent tail.
  sentinel     The Pearlguard Sentinel (sentinel.py): a pearl and coral golem.
  lurker       The Glimmerscale Lurker (lurker.py): a pale six-legged scaled leaper.
  templeguard  The Drowned Templeguard (choir_folk.py): pearl mail, trident, shell shield.
  pilgrim      The Drowned Pilgrim (choir_folk.py): hooded rags and a dead lantern.
  acolyte      The Pale Choir Acolyte (choir_folk.py): a hooded chorister with a moon bell.
  selthe       Choirmother Selthe (choir_folk.py): the tall choir mother and her Great Conch.
  colossus     The Tideglass Colossus (colossus.py): a stone giant with a prism for a heart.

Ysolei is no longer built here: her body is the colossal serpent Codex built
in Blender (sources on the codex/ysolei branch), shipped as
public/models/creatures/temple_ysolei.glb.

Built on the Sunken Bastion's smooth sea kit (../sunken_bastion_creatures/sea_kit.py)
and the Hollow Crypt creature kit behind it: yards, +Z up, facing -Y, every
part rigid-skinned to one bone, 24 fps clips. Ship each to
public/models/creatures/temple_<name>.glb, then `node scripts/build_media_manifest.mjs generate`.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'sunken_bastion_creatures')))
from sea_kit import build_rig, export_all, finish_body, new_scene, sheet  # noqa: E402

MODULES = {
    'eel': 'eel',
    'snapper': 'snapper',
    'siren': 'siren',
    'sentinel': 'sentinel',
    'lurker': 'lurker',
    'templeguard': 'choir_folk:templeguard',
    'pilgrim': 'choir_folk:pilgrim',
    'acolyte': 'choir_folk:acolyte',
    'selthe': 'choir_folk:selthe',
    'colossus': 'colossus',
}


def creature(which):
    import importlib
    module, _, variant = MODULES[which].partition(':')
    mod = importlib.import_module(module)
    return mod.VARIANTS[variant] if variant else mod.CREATURE


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    which, out = argv[0], argv[1]
    bones, body_fn, clips_fn, focus, dist = creature(which)
    mats = new_scene()
    body = body_fn()
    obj, names = finish_body(body, mats)
    arm = build_rig(body.name, bones, obj, names)
    clips = clips_fn(arm)
    export_all(out, arm)
    if '--preview' in argv:
        sheet(arm, clips, argv[argv.index('--preview') + 1], focus, dist, human=1.9)
    if '--blend' in argv:
        import bpy
        bpy.ops.wm.save_as_mainfile(filepath=argv[argv.index('--blend') + 1])
        print('SAVED')
