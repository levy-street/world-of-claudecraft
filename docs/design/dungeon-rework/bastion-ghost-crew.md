# Sunken Bastion: the lost crew

Size follow-up: the captain's presentation height is now 7.5 (previously 5),
with a matching 2.25 selection radius. The latest in-game capture is
`docs/screenshots/bastion-ghost-crew/captain-larger.png`; the earlier captures
below retain the original size for comparison. Biome and all 18 tests in
`vitest run tests/sunken_bastion_creatures.test.ts --maxWorkers=1` pass.
The initial local gate stopped at the unstaged i18n freshness requirement
described below. Publishing now includes those generated artifacts.

The Barnacle Crawler and Turretback Hermit become Wreckbound Sailors and a
Shipwreck Captain. These are original naval spirits: ragged uniforms, chains,
cutlasses, spectral lower bodies and a phantom brig. Knight Commander Olen is
outside this change.

Task branch: `feature/bastion-ghost-crew`, based on dungeon commit `ab3230e6`
(which includes `origin/release/v0.45.0` at `55de7ffe`). This update targets
PR #4352 and preserves its subsequent Morthen music commit.

Known visual follow-up: close inspection shows an imperfect sword grip and
wrist pose. The user explicitly accepted leaving that grip unchanged for
this upload; it is not claimed fixed.

The existing `barnacle_crawler` and `turretback_hermit` identifiers remain stable
for instance packs, summons, progression and saves. Their families become undead.
The captain remains part of the required bailey gate pack. Health, weapon damage,
attack speed, difficulty multipliers, loot and the existing 60%/30% crew summons
remain unchanged. His collision radius becomes 1.5 yards to fit the humanoid body.

## Encounter

| Move | Player response | Timing and footprint | Unmitigated damage NM / HC |
|---|---|---|---|
| Spectral Broadside | Step between the five cannon lanes | 2.4s warning, five parallel 28 x 2.4 yd lanes with safe gaps; simultaneous impact | 90 to 110 / 720 to 880 |
| Cursed Anchor | Leave the locked chain lane before the anchor sweeps back | 2s warning, 24 x 3 yd lane, 2s return; at most one hit per victim | 50 to 60 / 400 to 480 |
| Phantom Boarding | Leave the warned saber lane | 2s warning, 18 x 3 yd lane; impact and collision-resolved captain reposition | 50 to 60 / 400 to 480 |

These new avoidable attacks replace the claw, shell slam and withdrawal. They
use the dungeon's existing mechanic damage scaling. This is an encounter rework,
not a claim of identical damage taken: successful dodging changes that outcome.
The captain cycles through all three moves, with 3.5s recovery between moves.
Sailors retain the existing feeding and death-burst mechanics, presented as
**Soul Hunger** and **Soul Release**.

`dgn_turretback` retains its identity and earned credit. Its new criterion is
defeating the captain without anybody being hit by Spectral Broadside. Temporary
loss of a nearby target cannot clear a failure; a genuine reset can.

## Art and rendering

The source and reproduction commands are in
[`scripts/assets/bastion_ghost_crew/README.md`](../../../scripts/assets/bastion_ghost_crew/README.md).
Both characters use the existing Bastion Blender sculpt/bake pipeline, a 52-joint
rig, eleven authored clips, 2048px PBR atlases, KTX2 and meshopt. Each optimized
character is about 2.2 MB; the ship is about 79 KB. No imported franchise meshes,
textures or animations were used. CREDITS records the project asset terms.

The ship aligns its five starboard cannon muzzles with the five authoritative
lane origins. Replicated encounter objects supply locked positions, facing,
length and cast clocks to both offline and online renderers. The optional ship
load has its own preparation gate and cannot delay actionable dungeon warnings.
All graphics tiers retain the danger footprints; higher tiers add soul ribbons.
High effects quality adds two pooled instanced draws for muzzle flashes,
expanding pressure rings, embers, curling soul smoke and a boarding swipe wake.
The renderer pools lanes, chains and souls and respects reduced-motion settings.

Death recoils and unravels, then the whole authored body collapses below 0.001
yards on every axis. Static feeding glows end when dissolution starts; moving
souls finish at 2.8s. The old crab dome and brine-sac anchors are removed.

## Visual evidence and reproduction

Run a fresh Vite server from this worktree. Its inherited watcher excludes
`.worktrees`, so restart it after source changes to avoid stale cached modules.

```powershell
node_modules/.bin/vite.cmd --host 127.0.0.1 --port 5367 --strictPort
node scripts/bastion_ghost_shot.mjs tmp/bastion-ghost-evidence/high
$env:SHOT_PRESET='1'
node scripts/bastion_ghost_shot.mjs tmp/bastion-ghost-evidence/low
$env:SHOT_URL='http://127.0.0.1:5367'
$env:SHOT_ONLY='idle_close,face,walk,attack,struck,death'
node scripts/sunken_bastion_mob_shot.mjs boss:turretback_hermit tmp/bastion-ghost-evidence/captain
node scripts/sunken_bastion_mob_shot.mjs crawler tmp/bastion-ghost-evidence/sailor
```

The encounter harness runs the real offline simulation and holds it at warning
and impact stages so screenshots cannot miss a short impact. Its JSON records
the actual replicated cue templates and clocks and fails on page errors.
Creature captures exercise idle, movement, attacks, hit reactions and death in
the actual dungeon. The capture courtyard is a controlled presentation location;
pack placement and the required bailey gate remain unchanged.

Final selected captures are under
[`docs/screenshots/bastion-ghost-crew/`](../../screenshots/bastion-ghost-crew/).
There are sixteen captures plus JSON evidence with asserted `low` and `ultra`
tiers and zero page errors. `legacy-crab-model.jpg` records the old model before
the development server was refreshed; it is model evidence, not an old-encounter
playthrough.

## Naming check

Exact-phrase web searches on 2026-10-07 found existing FFXIV/Diablo usage of the
initial candidate “Drowned Deckhand”, so it was discarded. Exact searches for
“Wreckbound Sailor” and “Shipwreck Captain” did not identify the same distinctive
game enemy name. This is a naming sanity check, not a trademark clearance.

## Validation

The relevant encounter, FX, creature, architecture, cast-name and Guide suites
passed 330 tests; supplementary trash mechanics, visual core and asset checks
passed another 60. The encounter suite includes Normal/Heroic damage, safe gaps,
locked directions, vertical separation, actual wipe/evade/death cleanup, deed
failure persistence and repeated automatic rotations with identical RNG traces.
The snapshot regression uses the real server encoder and ClientWorld receiver.

`npm run i18n:gen`, `npm run ci:changed`, `tsc --noEmit`, `npm run check:types`,
`npm run build:bundle`, `npm run build:env`, `npm run build:server`,
`npm run build:bot` and `npm run security:gate` passed. The final full typecheck
and client build include the discharge refinement. Existing changed-branch lint
warnings remain. `npm run test:browser -- --maxWorkers=1` passed 521 tests in
64 files. The discharge/ghost FX check passed 11 tests.
Guide generation found no Guide model cards for these dungeon-only creatures;
its filtered still-generation run had no applicable images to rewrite.

`npm run gate` stopped at **i18n freshness** because the regenerated localization
files were local, unstaged changes during the initial review. Later
checks were run independently; this is **not a green full pre-merge gate**.

The separate `vitest run --maxWorkers=2` full-suite attempt was interrupted after
failures in unrelated profession/harvest tests and timeout-like failures in
`varkhul_forge_encounter`. It did not complete and is not counted as a pass.
An isolated rerun reproduced these failures:

- `corpse_harvest_sim`: census expects 285 untagged templates, receives 289.
- `professions_blob_growth`: expected byte delta 80334, receives 80474.
- The full harvested-family sweep exceeds its 20s timeout on this machine.

The first two reproduce identically against an untouched source archive of
`HEAD` (`ab3230e6`), confirming they predate this change. The farming case that
failed under the full-suite load passes in isolation. Harvest component tags,
item mappings and persistence were not changed. The Varkhul cases were not
rerun or declared resolved. Overall merge verdict: **NOT READY** until the
existing gate failures are addressed; the
ghost encounter's focused and browser verification is green.

Coordinator commands for focused verification (Windows `.cmd` wrappers omitted):

```text
vitest run tests/sunken_bastion_ghost_captain.test.ts tests/bastion_ghost_fx.test.ts tests/bastion_ghost_ship_gate.test.ts tests/sunken_bastion_trash.test.ts tests/sunken_bastion_creatures.test.ts tests/bastion_trash_fx.test.ts tests/architecture.test.ts tests/cast_display_name.test.ts tests/guide.test.ts --maxWorkers=1
vitest run tests/sunken_bastion_trash_fx_core.test.ts tests/sunken_bastion_boss_fx_core.test.ts tests/sunken_bastion_trash_mechanics.test.ts tests/bastion_ghost_assets.test.ts --maxWorkers=1
vitest run tests/snapshots.test.ts --maxWorkers=1 -t "Shipwreck Captain actionable object snapshots"
vitest run tests/professions_blob_growth.test.ts tests/corpse_harvest_sim.test.ts tests/professions_farming.test.ts --maxWorkers=1 -t "settles to a fixed point with every container|covers every template that mixes|every family a harvest extracts|plants, spends the seed"
```

The first command matched eight existing files (330 passes); its extra
`bastion_trash_fx.test.ts` argument names no file. The correctly named trash FX
core suite is included in the second command (60 passes). The wire check passed
its single selected regression. The final command is the isolated global-failure
diagnostic, with three failures and one pass, not an encounter acceptance check.

Publication check: generated artifacts are now committed. A fresh
`node scripts/gate_select.mjs` passed artifact freshness, security and changed-file
lint, then entered the full suite. That run was interrupted when discovery
included the temporary baseline source archive; the archive has been moved
outside the repository. This attempt is not counted as a full gate pass.
The remote Morthen music commit is preserved in the publication merge.
