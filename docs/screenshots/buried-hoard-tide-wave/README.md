# Buried Hoard tide wave review

Historical implementation and visual QA record, 2026-09-20.

The tide boss now summons seeded wave sets with changing directions and safe gaps.
Common has one slow wave, rare has two, and epic/legendary have two or three when
enraged. Waves do not overlap in combat. Each next wave gets a full warning and
reaction allowance. Damage is capped and each wave hits a player at most once.

The visible crest shares its footprint, lead time and position with simulation
math. Shared curled meshes, foam, spray, mist, ground shimmer and a fading crash
replace the flat strip. Low graphics retain the path, gap and crest. Resources
are prepared beneath the existing actionable VFX gate. Original synthesized
build, rush, crash and impact audio use the SFX catalog and conformance pipeline.

Tempest's inherited melee shove is suppressed for the hoard encounter. Its new
static warning follows players and punishes nearby pairs after three seconds;
solo players are unaffected. Existing large storm strikes remain.

## Try it

Use the offline development server at `http://localhost:5182` and reload the page.
These commands enter a real legendary hoard without consuming a treasure map:

```text
/dev hoard list
/dev hoard frost
/dev hoard ember
/dev hoard spider
/dev hoard skeleton
/dev hoard grask
/dev hoard nyxaris
/dev hoard vharok
/dev hoard maw
```

Numbers 1 through 8 work too. Direct presets match boss and biome for testing.
Normal treasure maps still select the combat theme independently of the dig-site
biome, which explains an Emberforge boss in a snowy map. This content policy has
not changed.

## Captures and reproduction

The capture recipes are registered through `hoardTideReviewTargets` in
`scripts/lib/pr_shot_hoard_tide.mjs` and the existing PR screenshot runner.
`captureHoardTide` enters the real scene and holds the production cue at the
telegraph, surge and early crash phases. No screenshot mock renderer is used.

- `desktop-ultra-*.png`: 1440x900, Ultra.
- `phone-low-*.png`: 844x390, touch/mobile viewport, Low, device scale 1.
- `*-before.png`: the original effect from commit `fccb1a1a45`, instantiated in
  the same current scene for an effect comparison. These are not whole-game
  screenshots of the old checkout.

The `measureHoardTide(page)` export provides a repeatable stress fixture after
`captureHoardTide`: three simultaneous animated wave views, 25 living idle mobs,
the real ticking simulation, three seconds of warmup and 600 animation frames.
This deliberately exceeds actual wave concurrency but does not simulate a full
25-enemy combat rotation. Raw timings and GPU identity are in the adjacent JSON.
The phone viewport runs on the desktop RTX 3060; physical phone performance has
not been measured. Audio conformance was checked, but this headless capture did
not provide a listening review.

Final isolated sampling after builds and browser checks finished:

| Profile | Mean frame time | Approximate FPS | p95 frame time |
|---|---:|---:|---:|
| Desktop Ultra | 13.88 ms | 72 | 20.90 ms |
| Landscape phone viewport Low | 9.03 ms | 111 | 13.90 ms |

Earlier runs overlapped test/build activity and were slower. These figures are
render-fixture measurements on the named desktop GPU, not a mobile-device or
full-combat performance guarantee.

## Implementation and checks

- Simulation: `hoard_tide_pattern.ts`, `hoard_tide_encounter.ts`,
  `hoard_storm_static.ts`, and the existing hoard scheduler/geometry seams.
- Presentation: `hoard_tide_wave_fx.ts`, `hoard_tide_wave_fx_core.ts`,
  `hoard_boss_presentation.ts`, and `hoard_tide_audio.ts`.
- Online cues: optional wave geometry and static target fields pass through
  `hoard_boss_cue_mirror.ts` and the existing world/event DTOs.
- Audio authoring: `scripts/gen_hoard_tide_sfx.mjs` and
  `scripts/sfx/hoard_tide_samples.mjs`.

Passed: `npx tsc --noEmit`; scoped Biome; SFX conformance; the combined hoard,
tide, storm, rift, treasure-vault, dev travel, architecture and monolith suites
(64 files, 844 tests); the final two FX suites (7 tests).
Arena reachability tests exercise 128 generated layouts with actual colliders.

Passed: `npx turbo run check:types build:env build:server build:bot build:bundle
--concurrency=1 --env-mode=loose` with `GOMAXPROCS=4`. The first parallel attempt
ran out of host memory; the serialized retry completed all seven tasks.

`GATE_SELECT_BASE=fccb1a1a45 GATE_MAX_WORKERS=3 GOMAXPROCS=4 node
scripts/gate_select.mjs` passed generation/freshness, security and changed-file
checks, then failed its first test floor: 58 failed, 3079 passed, 77 skipped.
Failures are in `ability_icons`, `apex_pattern_channels`,
`bags_guild_deposit_routing`, `bags_window`, `bags_window_instance_marker`,
`bags_window_sort_button` and `bare_client_defaults`. These failures are outside
the touched regression suites; this is not a green merge gate.

`npm run test:browser` completed 46 suites and 374 assertions successfully.
Three other suites failed to import their browser modules:
`harvest_preference`, `intentional_gathering` and `storage_purchase_surfaces`.
The browser gate is therefore also not fully green.
