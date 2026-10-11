# Arcane Calligraphy

An Eastbrook world quest inspired by movement-based shape tracing. The lesson
escalates through a triangle, a square and one of five advanced runes; it is a
walking challenge, not a mouse-drawing minigame.

## Try it locally

Use the offline game at `http://127.0.0.1:5173/` with dev commands enabled:

```text
/dev calligraphy
/dev tp 172 -39
```

This places you four yards south of Instructor Elian at `(172, -35)`, rather
than inside his model. Interact with him on foot. Look over each golden outline during its
six-second preview, then walk to the marked start. Golden sparkles guide the next
edge, with a larger marker at the next corner. Trace in either direction; once
you choose a direction, the guidance follows it. The blue trail records the
actual movement. Completing an outline immediately previews the next lesson:
triangle, square, then the rotation's advanced rune. The world-quest reward and
cosmetic `exp_arcane_calligraphy` deed are granted only after the advanced rune. Speak to Elian
again after a failed attempt to retry the current lesson. Ordinary availability
is level 10 and the realm's world-quest rotation; the dev command only prepares a
test offering.

## Ownership and bounds

- `content/world_quest_calligraphy.ts` owns the shapes and instructor placements.
  Existing NPC models are reused; these fixtures do not stamp terrain or consume
  the ordinary entity allocator.
- `world_quest_trace_geometry.ts` validates sequential edges, direction, tolerance,
  movement discontinuities and a bounded trail. `world_quest_tracing.ts` handles
  eligibility, interruptions and session cleanup behind `SimContext`.
- Existing NPC interaction starts the attempt. Clients submit neither outlines
  nor completion credit. The same simulation runs offline, online and headless.
- `world_quest_trace_wire.ts` validates the owner readout. Saves deliberately omit
  the partial trace; the stable advanced variant, completed-round scores, completed
  quest claims and earned deeds are retained.
- `WorldGuidance` composes the existing race/island/mount guidance with the new
  visual. Trace preparation is required by the entry barrier. An already-active
  online attempt still uses server time during a deliberate graphics reload.
- Mobile tracing instructions wrap inside the existing quest-strip band. Graphics
  tiers retain identical actionable geometry and phase information.
- Drawing guidance uses bounded, persistent geometry and the existing prewarmed
  gold material, without new lights or a separate timer. Only the current edge
  is highlighted, and guidance does not grant progress or alter the tolerance.
- Nearby players expose at most four cloned 32-point blue trail tails inside 35
  yards. They never expose the gold guide, chosen direction, active segment or
  private scoring metrics. A completed public trace briefly shows the full rune,
  player name and cosmetic medal through the existing bounded nameplate surface.
- The authoritative quest counter is also the lesson index. It persists completed
  lessons, retries only the current outline, and cannot be advanced by client wire
  state. The partial walked trail remains intentionally transient across loads.
- Rotation tests cover the full combined roster/puzzle-variant repeat, so adding
  calligraphy cannot silently remove a salvage, ley or match-three variant.

## Validation record

Working tree: `feature/world-quests`, based on `6efbda04ae`, targeting
`release/v0.42.0`. No commit or push is part of this implementation pass.

Commands run successfully:

```text
npm run i18n:gen
npm run wiki:content
npm run ci:changed
npx tsc --noEmit
npm run security:gate
npx vite build
node scripts/build_server.mjs
npx esbuild headless/env_server.ts --bundle --platform=node --format=esm --outfile=tmp/calligraphy-env.mjs --packages=external
```

The dedicated geometry, simulation, wire, UI, render, extraction and deed suites
exercise real walking in both directions, failed shortcuts, interruptions,
retries, single rewards, save/load and seeded replay. Additional architecture,
localization, parity, terrain, population, historical rendering-provenance and
ordinary NPC quest regressions were run. Scope and command output are retained in
the ignored `tmp/calligraphy-*.log` files during local development.

The final simulation integration command passed all 78 tests without retries:

```text
npx vitest run tests/world_quest_tracing.test.ts tests/world_quests.test.ts tests/quest_npc_interaction.test.ts tests/monolith_budget.test.ts --maxWorkers=1
```

The broader dedicated-feature pass had 321 passing tests, one skipped test and
only the guide freshness assertion below failing. The separate architecture,
localization, world API, monolith, HUD budget, guide and market pass had 831
passing tests and seven skips before the deed regenerated the guide artifact.
Historical rendering provenance and ordinary NPC regression suites passed all
80 tests. Earlier concurrent runs encountered timeouts; the final simulation
command above ran after browser capture stopped, without widening timeouts.

`npm run gate` was attempted and stopped at `i18n freshness`: regenerated files
are not staged. The guide's committed-file freshness assertion fails for the same
reason after the new deed regenerates its catalog. These are not waived and no
staging was performed to bypass them. The full gate, full browser suite and live
online playthrough therefore remain unverified; this is **not merge-ready** yet.

Visual evidence uses the actual offline game, not a substitute scene:

- [Golden preview](../screenshots/world-quest-calligraphy/desktop-preview.png)
- [Drawing start](../screenshots/world-quest-calligraphy/desktop-drawing-start.png)
- [Walked blue trail](../screenshots/world-quest-calligraphy/desktop-trail.png)
- [Responsive landscape](../screenshots/world-quest-calligraphy/responsive-landscape-trail.png)

The landscape capture is a resized desktop Chromium session using the mobile HUD,
not a physical touch-device test. Focused Chromium layout checks also cover the
instruction phases in English and the five non-Latin locales. Before/after
baseline captures and native-device validation remain PR follow-up work.

## Guided drawing follow-up

The guided mode replaces the memory-only drawing phase with golden breadcrumbs
on the remaining edge and a larger next-corner star. It preserves simulation,
wire state, rewards and movement tolerance. Instructions now explain the gold
guide and blue completed trail.

Follow-up checks:

- `npx vitest run tests/world_quest_trace_core.test.ts tests/world_quest_trace_visual.test.ts tests/world_guidance.test.ts tests/ability_material_prewarm_sweep.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts --maxWorkers=1`: 202 passed, three skipped.
- `npx vitest run tests/world_quest_trace_view.test.ts tests/quest_tracker_controller.test.ts tests/quest_strip_controller.test.ts --maxWorkers=2`: 57 passed.
- `npm run test:browser -- tests/browser/quest_strip.browser.test.ts`: 28 passed.
- `npm run i18n:gen`, `npm run ci:changed`, `npx tsc --noEmit`, `npx vite build`, and `git diff --check`: passed.
- `npm run gate`: still stopped at unstaged i18n freshness, not waived.

Read-only frontend review found no blocking issues. Real-game capture used actual
movement input and confirmed distinct gold guidance and blue history, readable
landscape instructions and no page errors. The first capture attempt was blocked
by the browser-support notice; the successful attempt dismissed that notice.
Corner handoff in both directions is covered by the pure/visual tests, not claimed
from the still images. No new shader material or light was introduced.

- [Before guidance](../screenshots/world-quest-calligraphy/desktop-trail.png)
- [Guided desktop](../screenshots/world-quest-calligraphy/desktop-guided-trail.png)
- [Guided landscape](../screenshots/world-quest-calligraphy/responsive-guided-trail.png)

## Three-round progression follow-up

The single triangle lesson now advances through a terrain-safe square and a
self-crossing five-point star. Each completed outline uses the ordinary
world-quest credit path, but terminal rewards remain gated behind progress 3 of
3. Round changes clear every visual cache before showing the next six-second
preview, including when two rounds happen to share endpoint data.

Focused checks cover all three shapes in both directions, star-centre crossings,
shortcut rejection, intermediate reward denial, current-round retry, persisted
round resumption, deterministic replay, hostile wire indices and visual cache
invalidation. The final combined simulation, wire and rendering command passed
148 tests across 12 files. The focused tracker/controller pass passed 59 tests,
and the Chromium quest-strip pass passed 28 tests. A final six-suite authority
and persistence pass added malformed progress/shape mismatches plus real
mid-triangle and mid-square save/load journeys; all 68 tests passed.

Real-game capture completed the triangle and square using normal movement input,
then recorded the star preview and first guided edge without page errors:

- [Star preview](../screenshots/world-quest-calligraphy/star-preview.png)
- [Star guided trail](../screenshots/world-quest-calligraphy/star-guided.png)
- [Responsive star guidance](../screenshots/world-quest-calligraphy/responsive-star-guided.png)

## Advanced lesson, reactions and style score

The first two rounds remain the authored triangle and square. The final round is
selected deterministically from the five-point star, hourglass, lightning rune,
angular spiral and connected double-triangle sigil. The selection is keyed by the
world-quest cycle, consumes no simulation RNG and is stored by stable string ID.
Legacy active saves without an ID retain the original star, while unknown future
IDs are preserved but fail closed rather than silently substituting another rune.

Apprentice Tessa reacts after the triangle, Apprentice Pip after the square, and
Instructor Elian warns about crossings before the advanced lesson and closes the
exercise. These reactions use the existing nearby NPC yell path and localized
matchers; they do not start, advance or complete the quest.

The optional style score is 60 percent precision, 25 percent route efficiency and
15 percent time, averaged over the three completed attempts. Scores below 65 are
Bronze, 65 through 84 are Silver and 85 or above are Gold. The normal world-quest
reward never depends on the style score. Gold grants the one-time cosmetic deed
`exp_arcane_calligraphy_gold`, title `the Runecaller` and 10 renown. The result is
held in the tracker for five seconds and also appears in the ordinary completion
log without changing its banner or sound.

Integrated focused checks passed 193 calligraphy simulation/render/wire tests, 59
owner-wire and monolith tests, 53 UI tests and the 28-case Chromium responsive
matrix. The matrix covers all seven resolved shape names, all presentation phases,
all three medals, English and the five M16 locales at both supported narrow
landscape sizes. The broader contribution gate remains recorded separately below.

The following real-game captures use ordinary movement input and the production
trace evaluator. The dev-only setup pins the hourglass stable ID so this evidence
does not depend on the current calendar rotation; it does not grant progress or a
score. The walked completion earned 96 Gold and produced no page errors.

- [Hourglass preview](../screenshots/world-quest-calligraphy/hourglass-preview.png)
- [Hourglass guided trail](../screenshots/world-quest-calligraphy/hourglass-guided.png)
- [Hourglass Gold result](../screenshots/world-quest-calligraphy/hourglass-score.png)
- [Lightning preview](../screenshots/world-quest-calligraphy/lightning-preview.png)
- [Angular spiral preview](../screenshots/world-quest-calligraphy/spiral-preview.png)
- [Double-triangle preview](../screenshots/world-quest-calligraphy/double-triangle-preview.png)

## Final non-cooperative follow-up QA

The public presence is observational only: nearby players can see a bounded blue
trail and the brief completed-rune medal, but cannot share progress, guide one
another's active segment or affect completion. Cooperative progression remains
deliberately out of scope.

The three caravan mobs now also ship deterministic 128px target portraits. A
renderer receipt covers only those new rows while the 242 historical portrait
bytes remain untouched; the manifest guard permits that scoped receipt only
when the renderer drift is exclusively the already-recognized browser-bundle
bookkeeping case. Any renderer source, output contract, existing portrait or
bundle metadata change still requires a full matching receipt.

Final verification added a 350-test World Quest pass, 454 passing deed, i18n,
snapshot and art checks (plus four policy skips), successful client/server/bot/environment builds,
TypeScript, changed-file lint and the malware gate. The canonical selected gate
still stops at i18n freshness because this authorized implementation pass does
not stage generated files. Three unrelated historical path tests and the SFX
atomic-rename test reproduce on the clean Windows baseline.

The closing reviews also fixed three integration defects rather than waiving
them: completed scores now survive claim recovery after relog; the desktop
tracker renders movement instructions without a misleading numeric suffix and
locks its collapse control while the lesson must stay visible; and online
snapshots reuse the server's shared interest candidates. Active tracers are
indexed once per broadcast, so a dense hub with no drawing players no longer
runs an extra spatial query for every viewer. The Gold result copy now states
that the base world-quest payout is unchanged while the Gold deed grants its
title and 10 Renown.
