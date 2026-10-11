# Orbital Lightning integration

## Scope and ownership

Implemented for Tempest Vharok (`rift_boss_storm`), the storm Buried Hoard boss
reached through clue scrolls. The existing Tempest Judgment, Charged Ground,
Static and Storm Surge behavior is retained. The cast rotation now opens with
Orbital Lightning, then continues with Judgment and Static before repeating. Its
first summon begins about 2 seconds after Vharok engages.

Work is isolated on `feature/orbital-lightning-ingame`, based on the existing boss
dependency `feature/treasure-vaults` at `3c236a7ae5`. The boss is absent from the
release branch, so this is not an independently mergeable release change. No
changes were made to Claude's `C:/tmp/woc-vaults` worktree or the primary worktree.
Nothing has been staged, committed, pushed or deployed.

## Runtime design

- `src/sim/rift/hoard_orbital_lightning_core.ts` owns the shared configurable
  choreography. Six orbs, radius 6.2, height 5.2, size 0.72, angular speed 0.52,
  summon 0.65 seconds, charge 1.8 seconds, shot spacing 0.25 seconds, three
  six-shot waves 4.5 seconds apart, residual 0.55 seconds, complete duration
  15.15 seconds. The orbit was enlarged after
  actual gameplay review because the scale-3 dragonkin hid the Blender proxy's
  smaller formation.
- One harmless carrier cue captures the boss center and facing. Each wave adds
  only its six fixed ground warnings 1.8 seconds before firing, so all eighteen
  circles never clutter the floor together. Impact points are 11 units from the
  center. Damage occurs at ticks 49 through 74, 139 through 164, and 229 through
  254, always in five-tick intervals. Each hit is nature damage at
  25% maximum health through the existing nonlethal mechanic cap. Impact radius
  is 1.65. These balance values remain playtest candidates, not final tuning.
- The shared mob combat profile holds Vharok's position during the carrier after
  normal target and leash validation. His normal melee timer and swings continue
  against players in range, but he does not pursue targets until the orbs end.
  Already-visible rift windups continue on schedule, while movement mechanics
  remain suppressed during the stationary barrage.
  Death and encounter reset clear the existing cue state and therefore all visuals.
- Existing cue events and reconnect snapshots carry both new variants. There
  are no new commands or wire fields and no client-authoritative damage.
- `src/render/hoard_orbital_lightning.ts` paints instanced Blender components,
  pooled lightning segments, discharge emphasis and shrinking aftermath.
  Authoritative countdowns control all shot/impact onset. Position smoothing
  removes offline 20 Hz stepping without advancing the attack clock.
- Deferred loading also works when the encounter renderer is lazily imported
  after world entry. Loaded node matrices are baked into owned geometry clones
  before gated attachment. Failed loads retain small procedural fallback parts.
- Existing terrain-draped ground warnings remain independent of asset loading
  and graphics tier. Low quality retains cores, shells, local arcs, bolts and
  ground impact arcs, shedding sparks and secondary impact layers. Reduced
  motion removes bobbing and slows decorative crackle without changing targets.
- Two bounded cast slots, component instancing and preallocated segment storage;
  no new lights, simulations, per-frame mesh construction or terrain sampling.
  See [shipping assets](shipping-assets.md) for the 38,940-byte GLB delivery.

## Local evaluation

Start the isolated worktree with `npm run dev -- --host 127.0.0.1 --port 5187`.
In offline developer mode, `/dev hoard storm` enters Vharok's real hoard. Engage
him; Orbital Lightning opens the special rotation after about 2 seconds, without
replacing Judgment or Static.

`node scripts/assets/orbital_lightning/capture_ingame.mjs` drives the production
encounter and painter. The capture harness selects Orbital directly and holds the
simulation at review ticks. Evidence is under
`tmp/orbital-lightning-game`: summon, charge, all three waves, aftermath and clean
end at Ultra and Low, plus `evidence.json`. Captures confirm the real boss,
stationarity through the cast, zero remaining cues at the end, and 240 authored
core vertices instead of fallback geometry. Both runs reported zero page errors.
Reviewed images led to the wider orbit and less cluttered ground warnings.
The capture uses software Chromium and is not a hardware GPU performance claim.
Restart Vite after changes if its watcher ignores the hidden worktree directory.

## Validation and remaining release work

Passed:

- Six runtime and architecture suites: 179 tests, covering the mechanic, cue
  mirror, painter and existing boss/spell effects. The separate asset suite has
  2 passing fingerprint/rebuild tests. The Orbital suites now contain 23 tests,
  including all three exact damage waves, bounded warning count, the 15.15-second
  stationary hold, offline smoothing, delayed asset arrival, nonzero online
  frame deltas, low tier, disposal, early rotation entry and melee continuation.
- `pnpm exec tsc --noEmit`.
- `pnpm exec turbo run check:types build:env build:server build:bot --ui=stream`.
- `npm run build:bundle`.
- Explicit `biome check` over all changed and untracked source/test/script files.
  `npm run ci:changed` ran too, but checked zero files because work is uncommitted;
  it is not credited as the lint proof.
- `npm run security:gate`: 9,705 files scanned, zero high findings after priors.
- `git diff --check`; deterministic asset rebuild and media-manifest pins.

Not green:

- `npm run gate` stops at manifest freshness because the two intentionally new
  asset rows are not staged. Staging requires the owner's authorization, so the
  gate was not bypassed. Generation, i18n freshness and SFX checks before that
  step succeeded. The full unit suite was not reached.
- `tests/localization_fixes.test.ts`: one pre-existing unregistered shop emit,
  `You need ${factionCurrencyCost} ${curName} to purchase that.` in unchanged
  `src/sim/items.ts`. The new Orbital Lightning name has its own matcher.
- `npm run test:browser`: 43 suites passed, 6 failed; 409 tests passed, 5 failed.
  Failures include general focus/material UI timeouts, gathering focus behavior
  and suites failing to load. These were not fixed or declared unrelated by a
  baseline rerun. The dedicated live encounter capture passed separately.

Read-only simulation, rendering and cross-platform reviews were completed.
Their findings were addressed with regressions: first-entry asset loading,
double-advanced online timing, natural rotation/determinism coverage and offline
motion cadence. A dedicated server-hot-path role was unavailable; the simulation
review checked the bounded instance/cue scans instead.

Verdict: local feature implemented and visually reviewed; **NOT READY for merge**
until the global gate blockers are resolved. Remaining manual work includes a
real multiplayer session, reduced-motion gameplay capture, hardware GPU first-cast
profiling, balance tuning and final localized release fills. Coordinate the
dependency branch with Claude before integrating the patch.
