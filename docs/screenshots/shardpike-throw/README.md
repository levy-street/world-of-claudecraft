# Shardpike throw evidence

Task branch: `feature/shardpike-throw`, based on PR #4162 head
`03f991b3c1ded8cb7e57f20c27264a53e41f7d05` (`feature/cyclops-world-boss`).
The parallel `woc-pr4162` worktree is untouched. These changes are not committed
or pushed and must be reconciled with any subsequent boss-branch edits before integration.

## Presentation

- Native player-rig animation: coil, overarm release at 0.4 seconds, recovery at 1.1 seconds.
- The physical equipped spear is shown in flight; its point homes onto the animated eye.
- Teal wake, bright contact flash, shock ring, sparks, stone fragments and spatial audio.
- Geometry/materials are borrowed, never duplicated or disposed by the effect. A material
  replacement, detached holder, death, despawn or scene teardown retires the display copy.
- Existing capped particle/light pools and reduced-motion shake suppression are reused.
- All nearby observers receive the same authoritative windup, release and impact phases.
- Fixed damage (150), range (strictly under 14 yards) and rest (5 seconds) are unchanged.
  Damage, blind tally and quest credit now occur on actual projectile contact.

The animation is authored in native Three.js keyframe tracks, not an exported Blender clip.
No new model, texture, dependency, persistence field or network-message schema is introduced.

## Captures

`desktop/` is a 1600x900 desktop viewport at high graphics. `mobile-low/` is
a 960x540 touch/mobile viewport at low graphics, emulated on desktop Chromium.
These are animation-phase captures of this implementation, **not** screenshots
of the unmodified base branch. `ready.png` means before this cast, not before this change.

- `windup.png`: body and spear preparation.
- `flight.png`, `flight-mid.png`: released spear and wake.
- `impact.png`, `impact-late.png`: contact and aftermath.

The capture fixture uses the real game, player rig, equipped item, boss and event handlers.
It holds the boss AI still and steps simulation/render frames to reproduce each phase.
It sets the balance session ready to isolate presentation; it does not replace the minigame in production.
Do not treat capture FPS as a benchmark: other repository checks were running concurrently.

## Reproduce locally

```powershell
pnpm exec vite --host 127.0.0.1 --port 5189 --strictPort
```

In another shell:

```powershell
node scripts/shardpike_throw_shot.mjs
$env:GAME_URL = 'http://127.0.0.1:5189/?gfx=low'
$env:OUT_DIR = 'tmp/shardpike-mobile'
node scripts/shardpike_throw_shot.mjs --mobile
```

Restart Vite after source changes if the checkout's file watcher serves a stale module.

For a normal gameplay check, acquire and equip Skerrit's Shardpike from the
Socketwright quest, approach Balgath within 14 yards, brace, balance the pike
until ready, and use Barrowglass Thrust. Repeat with another class and with a nearby
non-party observer. The item must remain equipped after every throw.

## Validation scope

Current focused results:

```text
npx vitest run tests/lance_throw.test.ts tests/lance_throw_routing.test.ts tests/lance_thrust_integration.test.ts tests/shardpike_prop.test.ts tests/shardpike_throw_clip.test.ts tests/shardpike_throw_core.test.ts tests/shardpike_throw_fx.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts --maxWorkers=2
189 passed, 9 files

npx vitest run --config vitest.browser.config.ts tests/browser/shardpike_throw.browser.test.ts
4 passed (real Chromium)

npm run ci:changed
PASS (existing warnings)

pnpm exec turbo run check:types build:env build:server build:bot
PASS, 5 tasks including dependencies

pnpm exec turbo run build:bundle
PASS, 3 tasks including dependencies

git diff --check
PASS
```

Read-only reviews: simulation architecture, rendering/lifecycle and test coverage.
Findings addressed: wake continuity at high refresh rates, readiness telemetry,
pure flight math, borrowed material disposal, quest-objective assertions, literal
timing pins and real animation dispatch outside the warrior class.

Focused suites cover release cancellation, homing, exactly-once payoff, literal
timings/balance, quest progress, real server routing, all shipped player skeletons,
real browser mixer selection on four classes, tip alignment, material lifetime,
30/60/120 Hz wake continuity, cold shader gating and reduced-motion trail behavior.

`npm run gate` passed its artifact freshness, SFX, security and changed-file lint
stages. The full Vitest stage reported failures in unrelated suites, including
Windows-incompatible tooling and timeouts. That broad run was stopped after the
failures were established (exit 1), so it is **not** a completed full-suite pass.
Logs: `tmp/shardpike-gate.log`. The remaining build steps were run independently
as listed above; the entire browser regression suite was not run.

An isolated rerun of `tests/portrait_snapshot.test.ts` and
`tests/mob_portrait_source_manifest.test.ts` reproduced two tooling failures with
45 other assertions passing: missing `grep` and a Windows `C:` path used as an ESM
import URL. Neither failure is in a file changed by this task. Other broad-suite
failures have not all been independently classified.

The integration verdict is **NOT READY** while that repository gate remains red.
Its result and any outstanding broad-suite
or performance checks must be reported separately; focused tests do not replace it.
In particular, an isolated first-cast GPU-program-link trace and a live two-client
visual capture have not been established by these phase screenshots.
