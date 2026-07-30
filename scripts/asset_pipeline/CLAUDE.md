<!-- scripts/asset_pipeline/: agent-drivable AI asset GENERATION (Tripo API +
     optional gpt-image-2). Distinct from scripts/assets/ (optimizes downloaded
     packs) and from the media manifest (scripts/build_media_manifest.mjs).
     See ../CLAUDE.md for the rest of scripts/. -->

# scripts/asset_pipeline/

Agent-drivable asset creation: generate game-ready weapons, props, rigged creatures, and
player-class skins via the Tripo API (v3, https://openapi.tripo3d.ai/v3), with an optional
gpt-image-2 concept-image stage. Output matches the shipped asset conventions exactly (grip
origins, y=0 bases, in-place clips, WebP 512 textures, meshopt), so a generated asset sits next
to the existing KayKit/Quaternius-style set without looking imported.

Run: `node scripts/asset_pipeline/pipeline.mjs <command> [options]` (`--help` prints usage).
Commands: `weapon`, `prop`, `creature`, `skin`, `skinset`, `skinmodel`, `rig-manual`, `library`,
`qa`, `validate`, `preview`, `preview-held`, `status`, `balance`, `inspect`, `inplace-check`.

**`qa --job <id>` is the mandatory last step for every generated asset.** It re-verifies
the finished job structurally (lane-aware: rig + required clips, grip convention + HUD icon
+ held-on-all-7-characters renders for weapons, handslots + KayKit clip vocabulary for
skinmodels, preview coverage) and prices it for REAL: every recorded Tripo task id is
queried for its actual `credits_consumed` (1 credit = $0.01) and stored gpt-image-2 usage
blocks are priced at the published token rates (`lib/cost.mjs`). Prints a PASS/WARN/FAIL
scorecard with itemized dollars, writes `qa.json` into the job dir, and exits 1 on FAIL.
The structural gate complements (never replaces) eyeballing the previews for look.

Style coherence is grounded in the game's REAL art, not adjectives: when
`OPENAI_API_KEY` is set, every concept ships with a style board (renders of
shipped KayKit/Quaternius assets, `lib/style_ref.mjs`) as a gpt-image-2
reference image, creature/skin prompts force chibi proportions, and generated
player-grade bodies carry the EXACT KayKit clip vocabulary (`KAYKIT_CLIP_PLAN`)
so animation style matches the shipped set by construction.

## Keys
- `TRIPO_API_KEY` (required): repo-root `.env`, gitignored, same pattern as
  `ELEVENLABS_API_KEY`. Offline tooling only; the game server and client never read it.
- `OPENAI_API_KEY` (optional): enables the gpt-image-2 concept stage and the skin `--prompt`
  repaint. Without it, concepts fall back to Tripo text-to-image.
- Never commit keys or `.env` (root invariant). Keys are never logged.

## The four lanes

### 1. weapon
```
node scripts/asset_pipeline/pipeline.mjs weapon --name emberfang_sword \
  [--prompt "..."] [--image path|url|task_id] [--family sword] [--items id1,id2] \
  [--flip] [--model hifi] [--face-limit n] [--apply] [--job id]
```
Produces a normalized GLB (origin AT the grip, blade/head along +Y, family height and
gripFrac from `lib/families.mjs`, WebP 512 textures, meshopt) plus a 128px HUD icon jpg.
The key MUST contain a family token: sword, dagger, staff, hammer, axe, halberd, spear,
scythe, or wand (`tests/held_weapon_models.test.ts` contract), or pass `--family`.
`--apply` copies the GLB to `public/models/weapons/` and the icon to `public/ui/weapons/`,
registers the key in `KAYKIT_WEAPON_ACCESSORY` (`src/render/characters/assets.ts`), maps any
`--items` ids in `ITEM_WEAPON_VARIANTS` (`src/ui/weapon_variants.ts`), and appends the
CREDITS.md row. The ItemDef snippet is printed for the agent to place by hand (real
vanilla-style stats are a gameplay judgment). After `--apply` run:
`npx vitest run tests/held_weapon_models.test.ts`.

Importing an EXISTING model instead of generating: `weapon --name <key> --model-file
path/to/model.glb [--family x] [--flip] [--roll deg] [--apply]` skips the concept and
Tripo stages entirely (zero credits) and runs the same normalize/icon/preview/register
chain, so downloaded packs integrate identically to generated assets. Names without a
family token need `--family`; the resolved family is recorded on the job for qa.

### 2. prop
```
node scripts/asset_pipeline/pipeline.mjs prop --name market_fountain --height 2.4 \
  [--prompt "..."] [--image ...] [--rotate-y 90] [--apply] [--job id]
```
Produces a normalized GLB (base at y=0, centered on origin, scaled to the world-unit
`--height`, WebP 512, meshopt), and the report + snippet carry a collision footprint
MEASURED from the built model (circumscribed radius + w x d extents), emitted as a
coordinated zone-record + collider snippet that keeps the sim's WYSIWYG-collision
invariant; `--building` switches the snippet to the OBB building form. `--apply` copies it to `public/models/props/` and appends the
CREDITS.md row. The `PROP_ASSET_DEFS` entry (`src/render/props.ts`) and the placement are
printed as a snippet the agent places by hand: zone placement (`ZonePropsDef` in
`src/sim/content/zone*.ts`) must keep the collider footprint matched to the visuals
(`src/sim/colliders.ts` contract), or use the `GROUND_OBJECTS` interactable lane (no collision).

### 3. creature
```
node scripts/asset_pipeline/pipeline.mjs creature --name bog_lurker \
  [--prompt "..."] [--image ...] [--rig-type biped] [--height 2.0] [--apply] [--job id]
```
Generates the model, runs the free rig-check, auto-rigs, retargets preset animations
in-place, and merges them into one GLB with clips renamed to the game vocabulary (Idle,
Walk, Run, Attack, Hit, Death, Cast, Jump). Biped rigs use rig model v1.0-20240301 (90+
`preset:biped:*` clips); every other rig type (quadruped, hexapod, octopod, serpentine,
aquatic) uses rig model v2.5-20260210, which only has a small preset set, so non-biped
output is best-effort: the walk preset is reused for the required Idle/Run/Attack/Death
slots and flagged in the report. Review the clip previews before shipping one.
`--apply` copies the GLB to `public/models/creatures/` and appends the CREDITS.md row. The
VisualDef snippet for `VISUALS` plus the `MOB_KEYS` wiring (`src/render/characters/manifest.ts`)
is printed for the agent to place by hand: set the real world-unit `height` (tune against
similar mobs) and the tint.

### 4. skin (real AI-generated texture-swap skins)
```
node scripts/asset_pipeline/pipeline.mjs skin --class warrior --suffix lava \
  --tripo --prompt "molten obsidian armor, glowing orange lava cracks" [--apply]
```
Three modes, in order of quality:
- `--tripo --prompt "..."` (RECOMMENDED, real generation): Tripo's texture task re-paints the
  class model from the prompt while PRESERVING its UV layout, splitting the palette material
  into one baseColor per skinned mesh; the pipeline composites those parts back into one
  drop-in atlas (`lib/tripo_skin.mjs`, per-mesh UV-triangle masking so multi-tone themes keep
  their contrast). Genuinely new spatially-painted art, ~30-40 credits, and a true drop-in for
  the game's `mat.map` swap (zero sim/wire changes). The empirical proof that Tripo keeps the
  UVs is the whole reason this works: verify each new skin with the review render.
- `--recolor hue=..[,sat=..][,light=..]`: deterministic sharp modulate. Cheap/offline, but only
  shifts colors (a filter, not generation) - use only as a fallback.
- `--prompt "..."` (no `--tripo`): gpt-image-2 atlas repaint, needs `OPENAI_API_KEY`.

All modes write a same-UV atlas at the base atlas's exact dimensions.
`--apply` copies it to `public/textures/skins/<model>/alt_<suffix>.png`, appends to
`SKINS['player_<cls>']` (`src/render/characters/manifest.ts`), and bumps `SKIN_COUNTS[cls]`
(`src/sim/content/skins.ts`): a test-enforced lockstep. After `--apply` run
`npx vitest run tests/skin_event.test.ts`. Skins are texture swaps on the SAME class rig, so
they change the LOOK, not the silhouette; a radically new SHAPE needs a new cosmetic BODY (the
Combat Mech pattern, which requires extending the closed `SkinCatalog` union, see
docs/design and the mech precedent, not automated by this lane).

### 5. skinset (radical skin-suit sets for ALL classes at once)
```
node scripts/asset_pipeline/pipeline.mjs skinset --set prismatic|chrome [--apply]
```
Generates a cohesive "skin suit" set across all 7 class models (9 classes) in one shot, via
a procedural GRADIENT MAP (`lib/skinsuit.mjs`): the base atlas luminance is remapped onto a
per-model themed color ramp, which discards the original hues and imposes one glossy uniform
material (latex/chrome/bio), the most radical change possible within the swap-atlas system
(UV-safe by construction). Each model is rendered on its class model for review. `--apply`
registers the set across all 9 classes (the caster trio priest/mage/warlock share the mage
atlas) with the `SKINS`/`SKIN_COUNTS` lockstep, and appends one CREDITS row. Shipped sets:
`prismatic` (Prismatic Vanguard, bold saturated) and `chrome` (Liquid Chrome, metallic with
class-tinted rims). Add a set by extending `SUIT_SETS` in `lib/skinsuit.mjs`. Note the
hardcoded max of 7 class skins (`sim.ts` setPlayerSkin clamp): two sets bring most classes to
6, still under it. gpt-image-2 (`OPENAI_API_KEY`) would enable true painted repaints; without
it the gradient-map suits are the procedural path.

### 6. skinmodel (League-style character skins from the base model)
```
node scripts/asset_pipeline/pipeline.mjs skinmodel --class hunter \
  --theme "pool party, swim trunks, floatie ring" --name pool_party_hunter \
  [--face-limit 8000] [--grip-rot deg] [--apply] [--job id]
```
A BRAND-NEW character body derived from the base class model, the way League of
Legends does themed skins ("pool party hunter"). Requires `OPENAI_API_KEY`. The
chain: (1) render the REAL base model from three angles; (2) gpt-image-2
redesigns that exact character around the theme (same identity, same chibi
proportions, same flat-shaded style) as a T-pose sheet; (3) Tripo builds it with
the best model (`v3.1` + `smart_low_poly`, clean game topology); (4) auto-rig
biped; (5) retarget the FULL KayKit clip vocabulary IN-PLACE (`KAYKIT_CLIP_PLAN`:
Idle, Walking_A, Running_A, 1H/2H_Melee_Attack_Chop, 2H_Ranged_Shoot,
Spellcasting, Spellcast_Shoot, Hit_A, Death_A, Jump_Idle, Sit_Floor_*, Lie_Idle,
Cheer), so the shipped `kaykit()` ClipMap factory drives it unchanged;
(6) inject `handslot.r`/`handslot.l` bones at the palms and POSE-MATCH their
rotation to the knight's slots at the same Idle frame (bind-pose transplants
alone leave the runtime grip ~90-110 degrees off, because each rig's idle
rotates the hand differently from its own bind; the handslot_align step
measures and corrects this, and the held-sword preview renders prove it);
(7) validate + preview every clip. `--apply` copies to `public/models/chars/skins/` and prints
the VisualDef snippet (instant NPC/MOB wiring; a PLAYER cosmetic body still
requires the SkinCatalog union work, see the snippet). ~200 credits + a few
cents of gpt-image-2.

### 7. rig-manual (zero-cost local rigging onto the KayKit skeleton)
```
node scripts/asset_pipeline/pipeline.mjs rig-manual --raw <raw.glb> --name <snake_case> \
  [--reference public/models/chars/players/knight.glb] [--pre-rotated] [--job id]
```
Skips Tripo's rig + retarget entirely: the raw generated mesh (every skinmodel
job keeps its `raw.glb`) is transformed into the reference rig's BIND space
(yaw to face +Z, uniform scale fitting the T-pose arm line to the reference
wrist line, feet on the bind ground) and skin weights are computed locally
(`lib/manual_rig.mjs`: distance-to-bone-segment, K=4, 1/d^4 falloff, laterality
guard). The output carries the reference model's ENTIRE clip library natively
(all 22 KayKit clips for the knight, including Block/strafes/Walking_Backwards
that the Tripo preset library cannot provide) plus the REAL handslot.r/.l
bones, for $0.00 vs ~$1.65 of rig + retargets. Two constraints, both verified:
vertices must be authored in the space of inverse(IBM) (the rig's REST pose is
NOT its bind pose; using rest-world coordinates shreds every animated frame),
and the raw mesh must be a T-pose. Best on humanoids whose proportions are
close to the reference (the skinmodel lane's redesigns are, by construction);
review the clip previews for weight bleed on outlier silhouettes. Run `qa
--job` after, like every lane.

## Asset library (viewer + inspector, static OR live 3D)
```
node scripts/asset_pipeline/pipeline.mjs library [--full] [--category weapons,skins] [--open]
```
Builds a self-contained static viewer at `tmp/asset_pipeline/library/index.html` (open it in
any browser; `--open` does it for you). It inventories every GLB under `public/models/`, every
class-skin atlas (`public/textures/skins/`, rendered ON its class model with the game's
texture-swap semantics), every Combat Mech chroma, and every pipeline job under
`tmp/asset_pipeline/`. Each entry carries the full structural inspection (tris, verts,
materials, texture table, animation clips + durations, rig joints, bounds) plus its
REGISTRATION status cross-referenced from the real registries: weapons show their grip family,
mapped item ids, and HUD icon; models show their `VISUALS` keys; skins show their
`SKINS`/`SKIN_COUNTS` slot; chromas their `MECH_CHROMAS` rank; generated jobs their lane,
step ledger, validation result, and Tripo task ids. Unreferenced files are flagged (amber dot)
so orphans are visible at a glance. Weapons include the in-hand composite; every rigged model
gets a per-clip pose frame for ALL its animations (so the static viewer shows all animations).
Thumbnails are content-hash cached under `library/thumbs/`, so the first run renders everything
(a few minutes) and later runs only render new or changed files. The registry parsers are
read-only regex over the pure data registries and are guarded by `tests/asset_pipeline.test.ts`.

### Live 3D viewer (`--serve`)
```
node scripts/asset_pipeline/pipeline.mjs library --serve [--port 5180]
```
Builds the library, then starts a local http server and opens the browser to a LIVE viewer:
clicking any asset renders the REAL GLB in 3D on a ground plane with orbit controls (drag to
rotate, scroll to zoom), a per-animation clip dropdown that plays each clip, and a "vs player"
toggle that drops the knight in beside the asset at true in-game heights for scale. Skin assets
load their class model with the atlas applied live (all 22 KayKit clips). Static open of the
file (`open tmp/asset_pipeline/library/index.html`) still works via the rendered clip-frame
strip; `--serve` upgrades it to live rendering.

When a weapon is held by a character, a "grip fit" bar exposes per-weapon move (x/y/z), rotate
(x/y/z degrees), and scale sliders that update the in-hand transform live. These layer ON TOP
of the family variant grip (lift + shrink clamp + hand flip) via `WEAPON_GRIP_OVERRIDES` in
`src/render/characters/weapon_grip.ts` (the pure `variantGripTransform` the engine's
`applyVariantGrip` uses; the viewer mirrors the same math). "Save" POSTs to `/api/grip/save`
(`integrate.saveGripOverride`, an anchored numeric upsert keyed by weapon model basename, so no
free text reaches the source); "Reset" restores the family default (an identity override removes
the key). Save is enabled only for APPLIED weapons (`public/models/weapons`, which have a stable
registry key); generate + `--apply` a weapon first, then tune. After saving, restart/HMR the
game client to pick up the new grip.

For a weapon in an Armory Codex VFX tier, the "fx tuning" bar's sliders seed from what the GAME
currently shows for that weapon: its saved row in `WEAPON_VFX_TUNING`
(`src/render/weapon_vfx_tuning.ts`) when one exists, else the tier's `WORLD_TUNING` baseline
(`src/render/weapon_vfx.ts`; twinned in `weapon_vfx.js`, keep the values in sync). "Save VFX"
POSTs the current sliders to `/api/vfx/save` (`integrate.saveVfxTuning`, the same anchored
numeric upsert), writing the row the world renderer and the armory inspect preview then use; a
saved row REPLACES the tier baseline for that weapon. All-1.0 sliders remove the row (back to
the tier default). The game dev client hot-reloads the file on save. Mechanics: `three_bundle_entry.js` is
esbuild-bundled to `/three.bundle.js`, `viewer_live.js` is the browser module, and a guarded
`/repo/*` route serves GLBs/atlases from `public/` and `tmp/asset_pipeline/` only (never `.env`
or `src/`). The server runs until Ctrl-C.

### Web creation wizard (`--serve`, human-in-the-loop)
The live viewer also hosts a step-by-step asset CREATOR so an operator can generate an asset
from the browser without the CLI: a "+ Create asset" button (and a "Regenerate this asset"
button on each generatable asset's detail) opens a modal that walks
prompt -> model (review, keep or regenerate) -> texture (optional repaint loop) ->
animations/finish (review) -> save. Each step
is human-gated: the operator sees the rendered result and only spends more credits on approve.
Mechanics:
- `wizard_ui.js` is the browser module (self-contained: injects its button + modal, exposes
  `window.WizardUI.onDetail(asset)` for the grid's per-asset Regenerate button).
- `lib/wizard.mjs` is the server action layer: the `/api/wizard/{model,finish,apply}` POST
  routes each spawn ONE `pipeline.mjs` child (never a second per job), and
  `/api/wizard/status?job=<id>` reports the step ledger + captured log + preview images the
  browser polls. It shells out to the SAME CLI, never Tripo directly.
- The model-review stop is the CLI flag `--until generate`: it runs concept + generate, renders
  a review shot into the job's `preview_model/` dir, and returns before rigging/normalizing.
  The wizard drives a DETERMINISTIC job id via `--job <id> --new-job` (`--new-job` lets
  `Job.open` create that exact id; bare `--job` still requires an existing job so a mistyped
  CLI id errors instead of forking). Regenerate re-runs a stage with `--redo`: the model
  regenerate is `--redo concept` (NOT just generate: image-to-model from the same frozen
  concept image barely varies and ignores a changed prompt, so it must re-roll the concept),
  animations is `--redo retarget`. Save is the lane's normal `--apply`.
- Review renders IN-BROWSER: the wizard shows the real GLB in the live viewer (`window.LiveViewer`,
  raw model then finished/animated build, exposed by `wizardStatus` as `modelGlb`/`finalGlb`), so
  a headless browser is NOT required. Server-side PNG previews degrade to a no-op when no local
  browser is installed (`renderPreviewsIfPossible`, `browser_path_resolve.mjs`), instead of failing
  the run. Weapon HUD icons and held renders still need a local browser (they rasterize an image).
- The form exposes each lane's API generation options: model quality (`--model` low-poly/hifi),
  `--face-limit`, and an optional reference image (`--image`, URL or `task_`/`file_` id) for all
  lanes; creatures add rig type (`--rig-type` auto/biped/quadruped/hexapod/octopod/serpentine/
  aquatic) and `--height`; weapons add `--family`; props add `--height` and `--rotate-y`.
  `genArgs` (in `lib/wizard.mjs`) ALLOWLISTS every value before it becomes a spawn arg (an
  unchecked field could inject a flag such as `--apply`, and an `--image` local path could read an
  arbitrary server file), free-text prompts are rejected if they start with `--` (flag() scans the
  whole argv), and the options are re-applied to the model, texture, AND finish calls because rig
  type lands at the rig step (during finish).
- The TEXTURE step is Tripo's `/models/texture` (UV-preserving repaint): the model-review screen
  offers a texture prompt + quality (detailed/standard) and "Repaint texture", driven by the CLI
  flags `--retexture "<prompt>" [--texture-quality standard] --until texture --redo texture`
  (repeatable; each repaint clears downstream finish work so the final asset always builds from
  the approved texture). The `texture` ledger step + `textured.glb` make finish/apply resume from
  the textured model with no extra flags: weapons/props normalize `textured.glb`, creatures rig
  the texture task id. `--redo generate` cascades over texture, so a regenerated model starts
  clean; wizardStatus only surfaces `textured.glb` when the LEDGER says the texture step is done
  (a leftover file from a cleared round must not mask a fresh model).

## Utility commands
- `validate --file x.glb --kind weapon|prop|creature [--family sword] [--height n] [--clips ...]`
- `preview --file x.glb [--out dir]`: turntable + per-clip PNGs, no API key needed. Preview
  and icon rendering drive headless system Chrome (`../browser_path.mjs`, swiftshader path).
- `preview-held --file x.glb [--family sword] [--character glb] [--out dir]`: the weapon
  attached to the knight rig with the exact in-game grip math (handslot.r, family lift,
  right-hand flip, maxHeight clamp). The weapon lane renders `held_hero/right/attack.png`
  AND a full cross-character set (`held_<model>_{hero,right,attack}.png` for all 7 class
  bodies) into the job preview dir automatically: a weapon must hold correctly on EVERY
  character, and the mid-attack frames prove it rides the hand through the swing.
- `status [--job id]`: list jobs, or dump one job's ledger.
- `balance`: Tripo credit balance (and frozen amount). Run this before generating.
- `inspect --file x.glb`: structural report (tris, clips, textures, bounds, joints).
- `inplace-check --file x.glb`: flag clips carrying root XZ motion (exit 1 on offenders).

## Job model (resumable; finished paid stages never re-run)
Every generation run gets a directory `tmp/asset_pipeline/<job>/` holding `job.json` (the
step ledger with every Tripo task id, recorded BEFORE polling starts), downloaded artifacts,
previews, and a log. Rerun the same command with `--job <id>` after a crash or after
reviewing previews: steps marked done are skipped, and the generate/rig stages reconnect
to their recorded task id if a run died mid-poll, so a finished or in-flight paid stage
is not paid again (an individual retarget interrupted mid-poll is the one 10-credit
residual; its task id is still recorded in the ledger for manual recovery).
The free local steps encode their parameters in their names (`normalize_flip`,
`normalize_r90`, `icon_flip`, `preview_r90`), so passing `--flip` or a new `--rotate-y`
re-runs the whole derived chain (normalize, icon, previews) against the already-downloaded
raw GLB and never shows stale frames. `--redo <step1,step2>` force-clears named steps AND
everything downstream of them in the lane (each stage feeds the next, so re-generating
without re-normalizing would silently ship the previous asset); cleared paid steps re-pay.
`status` lists all jobs.

## Review loop (mandatory for agents)
ALWAYS Read the preview PNGs before integrating: `<job>/preview/front|right|back|left|hero.png`
plus one `clip_<Name>.png` per animation for rigged models (a T-pose clip frame means a broken
retarget). Fixes:
- Weapon pointing down or wrong end up: rerun with `--flip --job <id>`. IMPORTANT: a
  later `--redo normalize` rerun must REPEAT the original `--flip`/`--roll` flags or the
  fix silently reverts (the flags parameterize the step, they are not remembered).
- Blade/head plane rolled sideways (axe held flat): normalize auto-aligns the head
  region's wide axis to local X (the measured shipped convention; staves/wands skip,
  their roll is irrelevant). If the heuristic picks wrong, `--roll 90 --job <id>` adds a
  manual yaw about the shaft on top.
- Prop facing the wrong way: rerun with `--rotate-y <deg> --job <id>` (front faces +Z).
- Not riggable / bad silhouette: regenerate with a clearer prompt or a T-pose concept image.
Validation gates run automatically per lane (`lib/validate.mjs`): budget caps, grip fraction,
y=0 base, required clips, in-place clips. Hard errors block; warnings ship but are reported.

## After integrating
- Regenerate the media manifest: `node scripts/build_media_manifest.mjs generate` (automatic
  in `npm run build`; dev serves raw `public/` paths, so previewing in `npm run dev` needs no
  regen). Never hand-edit `src/render/assets/manifest.generated.ts` (root invariant).
- CREDITS.md attribution is auto-appended by `--apply` (idempotent).
- `npm run asset:budget` is the advisory whole-tree size check; keep it in mind.

## Costs and limits (Tripo, July 2026)
| Operation | Credits |
|---|---|
| image-to-model (P1 low-poly, the default) | ~40 to 50 |
| text-to-model (P1) | ~30 to 40 |
| H-series (`--model hifi`) | 20 to 30 |
| rig | 25 |
| retarget | 10 per animation |
| rig-check | free |
| Tripo text-to-image (concept fallback) | 5 to 15 |

Concurrency pools: image generation 1, P-series models 5, animation tasks 10. Output URLs
expire in about 5 minutes (the pipeline downloads immediately; never persist a URL). Credits
freeze on task create and refund on failure. Check spend with the `balance` command.

Per-category budgets (`lib/families.mjs` `CATEGORY_SPECS`): weapon face limit 800, cap 1500
tris / 120 KB; prop 2000, cap 6000 tris / 350 KB; creature 4000, cap 8000 tris / 1536 KB.
Textures: 512 px category norm, 1024 px hard cap, WebP re-encode on statics.

## What this pipeline does NOT automate (do these by hand)
- Placing props into zones: `ZonePropsDef` records and colliders are gameplay edits; keep
  collision matched to visuals.
- Creating ItemDefs and loot tables: the snippet is a starting point, the stats are yours.
- i18n entity names: new mobs/items/props need their `src/ui/world_entity_i18n.ts` list
  entries (English only at PR tier, per the root i18n rules).
- Wiki regen for player-facing content: `npm run wiki:content` (+ `npm run wiki:stills` for
  new bestiary models).
- New player cosmetic BODIES: `SkinCatalog` (`src/sim/types.ts`) is a closed sim/wire union;
  do not extend it. Use the skin lane for class variants, or the creature lane for mobs/NPCs.
- In-game verification: screenshot the asset in a running `npm run dev` client.
