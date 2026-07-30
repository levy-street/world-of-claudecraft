---
name: asset-pipeline
description: Generate game-ready 3D assets for World of ClaudeCraft with the AI asset pipeline (Tripo API + optional gpt-image-2). Use when asked to create or generate game assets, a new weapon model, a prop, a creature or mob model, a player-class skin, or any 3D model or texture for the game. Drives scripts/asset_pipeline/pipeline.mjs through the full loop: generate, review the rendered previews, fix orientation, apply the registry wiring, run the guard tests, and finish the manual follow-ups the pipeline cannot judge.
user-invocable: true
---

# Asset pipeline: generate, review, integrate

Full reference: `scripts/asset_pipeline/CLAUDE.md`. This is the operational loop.

## 0. Prerequisites
- `TRIPO_API_KEY` in the repo-root `.env` (gitignored). `OPENAI_API_KEY` optional (better
  concept images, skin `--prompt` repaints). Never commit `.env` or keys.
- Confirm credits before spending: `node scripts/asset_pipeline/pipeline.mjs balance`.
  A P1 image-to-model run is ~40 to 50 credits; rig 25; retarget 10 per animation.

## 1. Pick the lane
| Ask | Lane | Command core |
|---|---|---|
| Held weapon (sword, axe, staff, ...) | weapon | `weapon --name <key_with_family> --prompt "..."` |
| World object / building / scenery | prop | `prop --name <key> --height <units> --prompt "..." [--building]` |
| Mob / NPC / animated character | creature | `creature --name <key> --prompt "..."` |
| Player-class skin (texture swap) | skin | `skin --class <cls> --suffix <x> --tripo --prompt "..."` |
| League-style themed CHARACTER skin | skinmodel | `skinmodel --class <cls> --theme "pool party" --name <key>` |
| Free rig of a raw mesh (KayKit skeleton) | rig-manual | `rig-manual --raw <job>/raw.glb --name <key>` |

skinmodel is the flagship: it renders the REAL base class model, has gpt-image-2 redesign
that exact character around the theme (same identity, chibi proportions), builds it with
Tripo's best model (v3.1 + smart_low_poly), retargets the FULL KayKit clip vocabulary
in-place (so `clips: kaykit([...])` drives it unchanged), and injects calibrated
`handslot.r/.l` bones (pose transplanted from the knight reference) so it holds weapons
through the game's own attach path. Review `preview/held_attack.png` to see it swing a sword.

Weapon keys MUST contain a family token (sword, dagger, staff, hammer, axe, halberd, spear,
scythe, wand) or the `tests/held_weapon_models.test.ts` contract fails. Prefer the
deterministic `--recolor` for skins; `--prompt` repaints need `OPENAI_API_KEY`.

## 2. Generate, then ALWAYS review the previews
Run the lane command WITHOUT `--apply` first. Then Read (the Read tool, they are images) the
preview PNGs under `tmp/asset_pipeline/<job>/preview/`: `front.png`, `right.png`, `back.png`,
`left.png`, `hero.png`, plus `clip_<Name>.png` per animation for creatures. Check:
- Weapon: blade/tip up (head up for axe/hammer/staff), looks like the request; the preview
  dir carries `held_hero/right/attack.png` (knight) AND `held_<model>_{hero,right,attack}.png`
  for ALL 7 class bodies with mid-attack frames: a weapon must hold correctly on every
  character. In the live viewer (`library --serve`) use the "held by" dropdown to watch any
  character (including generated skinmodel bodies) swing it.
- Prop: upright, front facing the camera in `front.png`.
- Creature: every clip frame posed (a T-pose clip frame means a broken retarget); for
  non-biped rigs the walk clip is reused for Idle/Run/Attack/Death, judge if that reads OK.

## 3. Fix by resuming the job (paid stages never re-run)
- Weapon upside down: rerun the same command with `--flip --job <id>`.
- Prop facing the wrong way: rerun with `--rotate-y <deg> --job <id>`.
- Crash or timeout: rerun with `--job <id>` (the `job.json` ledger skips finished steps).
- Force specific steps to re-run after a parameter change: `--redo <step1,step2> --job <id>`
  (e.g. `--redo retarget,assemble`); cleared paid steps re-pay, so prefer the targeted flags.
- Wrong shape entirely: new run with a sharper `--prompt` or a `--image` concept
  (T-pose reference for creatures). This is a new paid generation; check `balance`.
- `status [--job id]` lists jobs; `validate` / `inspect` / `inplace-check` re-check a GLB.
- `library [--open]` builds the browsable asset viewer/inspector
  (`tmp/asset_pipeline/library/index.html`): every shipped + generated asset with thumbnails,
  structural inspection, all animation frames, and registration status (orphans flagged).
  Rebuild after integrating an asset; only new/changed files re-render (content-hash cache).
- `library --serve [--port 5180]` starts a LIVE 3D viewer: click an asset to render the real
  GLB with orbit (drag/zoom), an animation-clip dropdown, and a "vs player" scale toggle;
  skins render on their class model with the atlas applied live. Runs until Ctrl-C.
- `skin --class <cls> --suffix <name> --tripo --prompt "..."` is REAL skin generation: Tripo
  re-textures the class model from the prompt (keeping its UVs) and the pipeline composites the
  parts into a drop-in atlas (`lib/tripo_skin.mjs`). Genuinely AI-painted, ~30-40 credits, a true
  texture-swap (no sim/wire changes). Prefer this over `--recolor` (a color filter, not generation).
- `skinset --set prismatic|chrome [--tripo] [--apply]` generates a cohesive set for all 9 classes
  at once; with `--tripo` each class model is re-textured from a per-model prompt (`SUIT_PROMPTS`)
  for real AI art, else the procedural gradient-map fallback. `--apply` registers/overwrites the
  set with the SKINS/SKIN_COUNTS lockstep. Then `npx vitest run tests/skin_event.test.ts` and
  `node scripts/build_media_manifest.mjs generate`. NOTE: skins are texture swaps on the SAME rig
  (they change the look, not the silhouette); a radically new BODY shape is the Combat Mech
  cosmetic-body path, which needs a `SkinCatalog` union change and is NOT automated by this lane.

## 3b. QA gate (mandatory before apply)
```
node scripts/asset_pipeline/pipeline.mjs qa --job <id>
```
Lane-aware structural re-verification (rig + required clips, grip convention + HUD icon +
held-on-all-7-characters renders for weapons, handslots + KayKit vocabulary for skinmodels,
preview coverage) plus the REAL itemized cost: each recorded Tripo task is priced from the
API's own `credits_consumed` (1 credit = $0.01) and gpt-image-2 usage at token rates.
PASS/WARN/FAIL scorecard; `qa.json` in the job dir; exits 1 on FAIL (fix with `--redo` or a
regenerate before integrating). ALWAYS report the printed TOTAL cost per asset to the user.

## 4. Apply, guard tests, manifest
Rerun with `--apply` (still `--job <id>` so nothing regenerates). Then:
- weapon: `npx vitest run tests/held_weapon_models.test.ts`
- skin: `npx vitest run tests/skin_event.test.ts`
- creature/prop: place the printed snippet (step 5), then `npx tsc --noEmit`
- All lanes: `node scripts/build_media_manifest.mjs generate` (auto in `npm run build`; dev
  needs no regen). Never hand-edit `src/render/assets/manifest.generated.ts`.
- CREDITS.md was auto-appended by `--apply`; `npm run asset:budget` is advisory.

## 5. Manual follow-ups per lane (the pipeline will not do these)
- weapon: place the printed ItemDef snippet in `src/sim/content/items.ts` (or map existing
  item ids via `--items`); real vanilla-style stats are your judgment.
- prop: add the printed `PROP_ASSET_DEFS` entry (`src/render/props.ts`) and place it, either
  `ZonePropsDef` in `src/sim/content/zone*.ts` with a collider matched to the visuals
  (`src/sim/colliders.ts`), or the `GROUND_OBJECTS` interactable lane (no collision).
- creature: add the printed VisualDef to `VISUALS` and wire the mob template in `MOB_KEYS`
  (`src/render/characters/manifest.ts`); set the real world-unit height and tint.
- New player-facing entities also need: `src/ui/world_entity_i18n.ts` name entries (English
  only at PR tier) and wiki regen (`npm run wiki:content`, `npm run wiki:stills` for models).
- Never extend `SkinCatalog` (`src/sim/types.ts`): it is a closed sim/wire union. Class
  variants go through the skin lane; new bodies are mobs/NPCs.
- Verify in game: `npm run dev`, screenshot the asset in place.

## 6. Commit
Conventional Commits with a scope, e.g. `feat(assets): add emberfang sword weapon variant`.
Commit the GLB/texture/icon under `public/`, the registry edits, CREDITS.md, and your
snippet placements. Never commit `tmp/asset_pipeline/` artifacts, `.env`, or keys.
