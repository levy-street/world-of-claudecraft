<!-- Area-scoped: src/sim/content/tutorial/ only. The data-as-code conventions,
     the determinism rules and the i18n flow live in the parent CLAUDE.md files;
     this covers only what is unusual about the starter tutorial's map. -->

# src/sim/content/tutorial/ - Dawnhaven Isle

The starter tutorial's map: the small island a player is offered, once per class
they have never played, right after character creation. It runs as an **OFFLINE
Sim in the client** and is never part of the authoritative world.

The feature's other halves live elsewhere, on purpose:
- **The step script + the director:** `src/ui/starter_tutorial_script.ts` (the
  per-class steps), `src/ui/starter_tutorial_core.ts` (the pure state machine),
  `src/ui/starter_tutorial.ts` (the coachmark the HUD composes). They name i18n
  keys, so they are presentation, not sim data.
- **The staged reveals:** `src/game/tutorial_cinematic.ts` (pure camera math) and
  `src/game/tutorial_scenes.ts` (the host that drives the free camera, stages the
  entities and fires the VFX). `main.ts` binds them into a hook bag for the HUD.
- **The offer:** `src/game/tutorial_offer.ts`.

## The one thing you must not break: the isle is invisible to the live world

The isle's mobs, quest and NPC ARE merged into the global lookup tables in
`data.ts`, because that is how the engine resolves anything by id (`MOBS[camp.mobId]`,
`QUESTS[qid]` inside `talkToNpc`, the client's entity-name resolver). What is NOT
merged is anything SPATIAL:

- **`CAMPS` is untouched.** The isle's camps live only in `DAWNHAVEN_WORLD.camps`.
  The built-in `CAMPS` array is a determinism contract (every camp draws world-gen
  rng in array order), so adding one entry there would shift every later camp's
  spawn and fork the world.
- **`ZONES` / `PROPS` / `BUILTIN_WORLD` are untouched.** The isle ships as its own
  `WorldContent`, which the Sim reads through `SimConfig.world` and the terrain and
  renderer read through `setActiveWorldContent`.
- **The Warden is `dynamic: true`.** That flag means "registered, never
  surface-placed": the ctor's NPC spawn loop skips her, so she cannot appear in
  Eastbrook. It does double duty as the reveal mechanism (the `wardenReveal` scene
  stages her in on cue). Same device as the Spirit Healer.
- **The quest is deliberately absent from `QUEST_ORDER`** (the live world's
  progression spine); `tests/progression.test.ts` carves it out explicitly.

`tests/starter_tutorial_isle.test.ts` pins all of this, including a guard that two
built-in Sims on the same seed still spawn the same entities and leave the rng
stream at the same point.

## Authoring the map

- **Heights, not scales.** The placed-asset instancer normalizes every catalogue
  GLB by its LONGEST axis to a fixed 2.2yd and only then applies the record's
  `scale`, so `scale: 1` does not mean "actual size". `place()` takes the height
  the prop should really stand in yards and inverts that math through `ASSET_SIZE`,
  a table of measured source dimensions. **Adding a new asset means adding its
  measured row**, or `place()` throws. The GLBs are meshopt-compressed and cannot be
  measured in Node; measure them in the browser through the app's own `loadGltf`.
- **The sea is a lake plus one flat terrain edit.** The zone's "lake" is what draws
  the water (the water shader clips to the DECLARED radius, not the 1.65x blend
  footprint), and a wide `flat` `level` stamp is what deletes the built-in world's
  rim mountains and far shore, which otherwise ring the isle at about 100yd. Both
  reach well past the fog's far plane; fog fades geometry toward the fog COLOR, it
  does not remove it, so anything inside that range is still a wall across the sky.
  Terrain edits are applied LAST inside `terrainHeight`, which is what lets one
  stamp override the rim at all.
- **Nothing here draws rng.** The practice dummies are `dummy: true` (the ctor
  spawns those with zero draws) and the staged spawns
  (`src/sim/tutorial_stage.ts`) are exact-position and fixed-facing.

## Screenshots / driving it

`node scripts/starter_tutorial_shots.mjs --class mage` (needs `npm run dev`) boots
straight onto the isle via the DEV-only `?tutorial=<class>` param, walks the
player through the reveals, and captures desktop + mobile. It fails on any console
error, so it doubles as the isle's smoke test.
