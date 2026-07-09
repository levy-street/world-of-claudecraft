# Protect Yumi: Meshy asset generation list

The Protect Yumi mode (arena brackets `yumi3`/`yumi5`, `src/sim/social/yumi.ts`)
shipped fully playable on procedural geometry and existing rigs. This document
is the punch list of real assets to generate with Meshy later, with prompts and
the pipeline steps that are known to work in this repo. Nothing here blocks the
mode; each swap is a drop-in behind an existing seam.

## Pipeline reminders (hard-won, do not skip)

- Meshy GLBs come out cm-scale behind a 0.01-scale armature. After download,
  run `node scripts/_bake_meshy_scale.mjs <in.glb> <out.glb>` (bake + inverse
  bind matrix rebind) or the model renders about 100x too small in game.
- Rigged characters: generate (text-to-3d, 5-20 credits), refine (10), then
  `meshy_rig` (5, includes walking + running clips). The animal `ClipMap` in
  `src/render/characters/manifest.ts` expects Quaternius-style clip names;
  remap clip names in the manifest `clips` entry rather than re-exporting.
- Drop the GLB under `public/models/creatures/`, then `npm run build` (media
  manifest regenerates; never hand-edit `manifest.generated.ts`).
- New or retinted models that the wiki shows also need
  `npm run wiki:stills` and the committed `public/guide-stills/*.webp`.
- Verify in game with clear sightlines (teleport to open ground) before
  concluding a model is broken or invisible.

## 1. Yumi, the cat familiar (DELIVERED)

- DONE: `public/models/creatures/yumi_cat.glb` (Meshy export, scale baked via
  `scripts/_bake_meshy_scale.mjs`, emissive cleared, meshopt + 1024 webp:
  28.3 MB source to 479 KB shipped). The one authored clip (the block,
  `Armature|Block5|baselayer`) is mapped as the HIT reaction, so Yumi blocks
  whenever she is struck; no idle clip on purpose (rest pose, she only
  teleports). Wired as `mob_yumi_cat` in the manifest. Sized at 1.2x player
  height (manifest `HUMANOID_H * 1.2`, template scale 1) so the objective
  reads over the scrum; this supersedes the smaller chibi sizing drafted
  below.
- Want: a chibi magical cat familiar, sitting upright, faintly glowing collar
  or rune charm, readable at 0.6-1.0yd tall, low-poly stylized to match the
  KayKit/Quaternius look of the game.
- Meshy prompt draft: "low poly stylized cute magical cat familiar, sitting
  pose, big ears, glowing rune collar, hand painted texture, game ready,
  chibi proportions, single mesh"
- Negative/style notes: no realistic fur cards, no base plate, no accessories
  that read as loot.
- Clips needed: Idle (weight-shift/tail flick) is the only hard requirement
  (the cat never walks; it teleports). A "Spin/Jump" one-shot would be a nice
  teleport-departure flourish (renderer hook exists: the `yumiTeleport` event
  arm in `src/render/renderer.ts`).
- Integration: add a `mob_yumi_cat` `VisualDef` (url, height ~0.9, `animal()`
  clips or a custom ClipMap), flip `MOB_KEYS.yumi_cat` to it, delete the
  placeholder comment. Both teams share one model; team identity comes from
  the beacons + entity tint, so ONE asset serves both.
- Est. credits: 5-20 (t2v) + 10 (refine) + 5 (rig) = 20-35.

## 2. Maze wall/gate dressing (OPTIONAL, procedural today)

- Today: instanced boxes with a procedural stone canvas texture
  (`src/render/yumi_maze.ts`); reads fine but plain up close.
- Want (pick any, all optional):
  - A hedge/stone wall tile section (straight segment, ~4.5yd) to instance
    along wall runs instead of plain boxes.
  - A team gate arch for the two spawn plazas (blue/red bannered arch).
  - A small centerpiece for the gold center ring (fountain or waystone).
- Meshy prompt draft (wall): "low poly stylized old stone garden wall segment
  with moss, straight tileable section, hand painted texture, game ready"
- Integration: instanced meshes in `src/render/yumi_maze.ts` replacing or
  decorating the box walls. Collision NEVER changes (sim owns it via
  `yumiMazeColliders`); dressing must stay within the 1yd wall footprint.
- Est. credits: 5-20 per prop, no rig.

## 3. Yumi portrait/crest art (OPTIONAL, procedural today)

- Today: the HUD strip uses text labels; no portrait. Procedural `icons.ts`
  recipes could supply a crest without any asset.
- Want: a small painted cat-head emblem for the queue tab and the match strip
  (WebP, goes through `npm run assets:skills` if shipped as an image).
- Meshy `text_to_image` (3-9 credits) or hand art; prefer the procedural
  recipe first per repo convention (no raw emoji icons).

## 4. Teleport flourish VFX (NOT an asset)

- The arcane burst rides the existing pooled particle atlas (`vfx.ts`); no
  Meshy asset needed. Listed here only so nobody generates one.

## Suggested order

1. Yumi cat (the visible placeholder; everything else already reads as
   intentional).
2. Spawn gate arches (team identity at first glance).
3. Wall tile dressing.
4. Crest art.
