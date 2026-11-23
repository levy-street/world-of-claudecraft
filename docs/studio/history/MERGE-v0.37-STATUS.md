# Editor fork -> upstream v0.37 merge

**Worktree:** `~/Documents/woc/dryrun`  **Branch:** `merge/v0.37.0`
**Base:** `c0f8831367` (editor fork @ upstream cut `16ded6825d`)
**Restore tag:** `pre-v037-merge/editor-c0f8831367`

## What "up to date with 0.37" means right now

`origin/release/v0.37.0` and the `v0.36.0` tag are the **same commit**
(`0f7d09d59a`). The v0.37 branch has just been cut and carries no commits of
its own yet, so this is one merge step rather than the stepwise chain the
v0.35 merge needed. Re-run the merge against `origin/release/v0.37.0` once it
starts moving.

| | |
|---|---|
| Gap base -> v0.36.0 | 1,758 commits / 4,568 files |
| Direct-merge conflicts | **24 files, ~35 hunks** |
| Previous merge for comparison | 106 files (v0.35.0), 338 (v0.33.1) |

The conflict count collapsed because the upstream-wins policy adopted in the
v0.35 merge removed the divergence it was meant to. Keep that policy.

## How the 24 were resolved

**Upstream outright (13).** Generated artifacts (`manifest.generated.ts`,
`translation_keys.generated.ts`), the four Eastbrook polish provenance JSONs,
and every conflicted test. Taking upstream's tests also cleared the
duplicated-import wreckage the v0.33.1 union merge left in `arena.test.ts` and
`spatial.test.ts`, which had been failing to parse ever since.

**Upstream's base with fork declarations re-applied (11).** All additive on
both sides:

| File | Fork keeps | Upstream brings |
|---|---|---|
| `vite.config.ts` | six editor dev endpoints | diagnostics capture plugin |
| `renderer.ts` | dungeon layout override, zone isolate | `ensureDungeons`, zone-feature shadow cull, KTX2 mip release |
| `assets/loader.ts` | `acquireTexture` refcounting | `loadKtx2Texture` |
| `terrain_chunk_build.ts` | the boolean-cut set + rim | `clamp01` extracted to `num_clamp` |
| `dungeon.ts` | `track()`, `disposeInterior`, capture | gated scene attach |
| `persist.ts` | RLE paint helpers, `mapStoreDb` | `toMapDoc` |
| `main.ts` | `?map=<slug>` published-map boot | diagnostics auto-offline |
| `music_tracks.ts` | Goldcrest | content-hash cache busting |
| `i18n.catalog/merge.ts` | the German Infernal Abyss strings | |

`vite.config.ts` was rebuilt from upstream's file rather than hand-merged: the
two versions share everything up to `musicEditorSavePlugin` and then each adds
its own plugins, so the fork's block is spliced in ahead of `defineConfig` and
registered before upstream's diagnostics entry.

## The two resolutions that were not merges

**`sfx.loop` gained an optional parameter on BOTH sides.** The fork's
`refDistance` (the editor Sound tool's radius, driving both ends of the
falloff) and upstream's `immediate` (the mount-engine windup-to-loop splice).
Whichever goes first wins the positional slot. Putting the fork's first
silently moved upstream's `true` into `refDistance` in `mountEngine` and in two
of upstream's own tests. **Upstream's slot goes first**; the fork's two call
sites skip it explicitly. Do the same for any future double-add: the fork has
two call sites to fix, upstream has an unbounded number.

**`mage_ground_fx.ts` was rewritten upstream around a pooled-material cache**,
which dropped the meteor palette the Emberwake boss uses for its arcane
Cinderfall. The palette is re-applied on top of the pool, with the palette key
part of every material key (`meteor-rock:${palette.key}`) so an arcane meteor
can never be handed a recycled fire material, and released under the key it was
acquired with. Nothing outside that file referenced the palette, but
`tests/emberwake_presence.test.ts` imports all four exports.

## The client build was already broken, and now is not

`npm run build` had been failing since the v0.35 merge, masked by an unrelated
error. The reported failure was the i18n modulepreload hook's `closeBundle`
dying on a missing `dist/.vite/manifest.json`; the manifest was missing because
the bundle never rendered. The real error, visible only with that plugin
removed, was the **retired Ravenrift battleground editor mode**: a bundler
resolves a dynamic import at build time, so its missing exports
(`refreshBattlegroundColliders`, `BG_WALL_T`) were hard errors.

The mode already threw at runtime and toasted "not available yet", so the rail
toggle now toasts directly and nothing references the module. Its source stays
on disk for the rework onto the authored-map record.

**If a future merge sees an ENOENT on `dist/.vite/manifest.json`, that is not
the bug.** Drop `i18nModulepreloadPlugin()` from the plugins array for one run
and read the error underneath it.

## Measured

| | pre-merge `c0f8831367` | post-merge |
|---|---|---|
| `src/` + `server/` typecheck | 25 | **25** |
| `tests/` typecheck | 183 errors / 36 files | **162 errors / 34 files** |
| Test files newly broken by the merge | | **none** |
| Client build | broken | **passes** |
| Server build / headless env build | | passes |
| Full suite | 328 failed / 32526 passed (2453 files) | 598 failed / 36490 passed (**2751** files) |

The suite's raw failure count rose because the merge brought 298 new test
files and 4,246 more tests. Of the 14 files that existed before and newly
failed, **11 pass when re-run on a quiet machine** - that run was competing
with three builds and a dev server, and the harness is known to be sensitive
to concurrent load. Of the remaining three: `terrain_streaming` fails
identically at `00931c1c0a`, before both this merge and the cave-cut work;
`corpse_lifecycle` is a boundary-tick timing flake; and the Eastbrook polish
pin was a real, expected move, re-minted below. **No merge regression
survived isolation.**

Parity goldens improved sharply: 120 failures pre-merge to 28, because
upstream's regenerated goldens sit closer to this fork's sim than the v0.35
ones did.

The 25 src errors are unchanged and all still inside the retired battleground
mode. Three test files were fixed by the merge (`arena`, `spatial`,
`visual_manifest`); none regressed.

## The provenance pin moved, and that was legitimate

Re-applying the fork's hooks to `src/render/renderer.ts` moves the Eastbrook
polish `rendererIntegration` leaf, which is the documented trigger. The test's
own diagnostics confirmed the precondition (every fingerprinted input matches
HEAD, only that leaf differs), so
`scripts/assets/eastbrook_grand_armoury/remint_polish_provenance.mjs` was run
and its three literals pasted. `ACCEPTED_POLISH_V2_TOWN_SOURCE_FINGERPRINT` is
untouched: it is the frozen identity of the tree the captures were taken
against. Expect this on every merge that touches `renderer.ts`.

Separately, taking upstream's `manifest.generated.ts` (correct for a generated
artifact) dropped the 667 media entries for GLBs this fork ships and upstream
does not. Re-minted with `scripts/build_media_manifest.mjs`; without it those
models 404 in a production build.

## Setup after pulling this branch

Upstream pinned `three` to an exact version and added
`patches/three@0.165.0.patch` (a compileAsync disposal-race guard), so
**`pnpm install --frozen-lockfile` is not optional** - test and build results
against an unpatched `three` are meaningless. Verify with:

```
grep -c "program === undefined || program.isReady()" node_modules/three/build/three.module.js
```

`ci:changed` also moved from a bare `biome ci --changed` to
`node scripts/ci_changed.mjs`.

## Still outstanding (carried from v0.35, not caused by this merge)

1. **Editor terrain paint on the splat shader.** The 64-slot custom
   ground-texture atlas and the paint field still are not plumbed in.
   `refreshCustomGroundTextures` and `rebakePaintFieldSwatches` remain inert.
   Note that `refreshTerrainHoles` is no longer part of this: boolean cuts are
   a mesh-time operation now (`terrain_chunk_build.ts` + `terrain_cut_rim_core.ts`).
2. **Cave-shell pass-under colliders.** `passesUnder` needs `baseY` on the
   world prop colliders, which upstream's `staticWorldColliders` does not emit.
   One failure in `tests/caves.test.ts`, four in
   `tests/cave_under_terrain_movement.test.ts`.
3. **The retired battleground editor mode.** 25 typecheck errors, no longer
   reachable from the editor. Rework onto the authored-map record or delete.
4. **Sandworm brood placement**, **placed-asset stream priority**, **Infernal
   Abyss minimap surfaces** - all as recorded in `MERGE-v0.35-STATUS.md`.
