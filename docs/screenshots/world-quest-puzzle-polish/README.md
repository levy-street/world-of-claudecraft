# World quest puzzle design handoff

Confection Cascade and Ley Beam Alignment receive illustrated fantasy framing,
material detail, readable board states, tiered finite VFX and framed outcomes.

- [Confection, final desktop](../confection-cascade-v7/confection-cascade.png)
- [Confection, phone](../confection-cascade-v7/phone.png)
- [Confection, original](../confection-cascade/before.png)
- [Ley, final desktop](../ley-beam-v1/after-desktop.png)
- [Ley, phone](../ley-beam-v1/after-phone.png)
- [Ley, original](../ley-beam-v1/before-desktop.png)
- [Confection team video](confection-cascade-discord.mp4)
- [Ley team video](ley-beam-alignment-discord.mp4)
- [Standalone quest briefing](world-quests-team-briefing.html)

The videos are silent H.264 MP4 files below 2 MB each. The HTML briefing is a
self-contained snapshot of the design checkout reviewed on 7 September 2026.
The team has since added more quests to the PR; the briefing is historical,
not a live catalogue of the latest branch.

## Playable design preview

Run `npm run dev`, then visit these paths on the local Vite server:

- `/scripts/world_quest_preview/index.html?board=candy`
- `/scripts/world_quest_preview/index.html?board=ley`

The preview uses the production puzzle UI and styles with a local fixture world.
Its toolbar demonstrates the outcome and VFX states without changing game rules.
Confection supports actual swaps. Ley supports actual rotations. Ley has unlimited
rotations and no gameplay losing condition; its labelled defeat design is a
presentation-only hook for the team to connect to a future authoritative rule.

Add `&mobile=1` for touch layout, `&scale=1.4` for enlarged UI, or `&variant=1`
(or `2`) to inspect the other authored layout. The preview is development tooling
and is not part of the production entry list.

## Art and earlier verification

The Confection iteration folders and `ley-beam-v1` retain before/after evidence,
art prompts, asset manifests and the verification results from design work.
Those historical records describe the original local checkout. The integration
verification below uses the PR head at `16028d3aaa11c62b3366bcd9f7003734216486ff`
plus the recovered design changes, preserving newer team activity work.


## Integration verification, 10 September 2026

- [Browser checks](integration-browser-checks.json): 19 passed, covering both
  boards at desktop, phone, landscape and enlarged UI sizes; tiered match clears;
  victory and defeat; retained completion after close/reopen; reduced motion;
  and zero browser JavaScript errors.
- [Landscape scrolling](landscape-scroll-checks.json): 2 passed. On a short
  landscape screen the dialog scrolls vertically and the board remains playable.
- Fresh captures: [Confection](candy-desktop.png), [Ley](ley-desktop.png),
  [Confection victory](candy-won.png), [Confection defeat](candy-lost.png),
  [Ley victory](ley-won.png), [Ley defeat](ley-lost.png).
- `node_modules/.bin/tsc --noEmit`: passed.
- `turbo run check:types build:env build:server build:bot --ui=stream`: passed;
  this includes the game, admin and bot type checks. The server uses the standard
  open-source detector stub because the private detector checkout is absent.
- `npm run i18n:gen`: passed. Generated tables and translation-key union staged.
- The full gate's artifact freshness, SFX verification, malware scan and changed
  file lint passed. The gate did not pass overall; remaining findings are recorded
  below.

`npm run build:bundle`: passed after free disk space recovered. The production
client compiled, backdrop-filter preservation passed, and 1,696 hashed media
assets were emitted.

Read-only frontend, simulation, test coverage and CI integrity reviews found no
consequential issues in the integrated puzzle changes. The CI checkout cones now
include the referenced design evidence, with the exact-set assertions retained.

### Browser regression limitation

`npm run test:browser`: 36 suites passed, 1 failed; 326 tests passed, 1 failed.
The existing quest-strip test at 844x390 reports the English Calligraphy
`lightning/traceDrawing` instruction at 63px against a 60px compact cap.
A focused replay with all three changed stylesheets served from PR head
`16028d3aaa` reproduced the identical failure. Its controller, typography,
test harness, wrapping rules and six tested Calligraphy locale strings are
unchanged by the puzzle work. This is separate from the 21 passing puzzle
preview checks above.

### Integration fixes verified

`vitest run tests/ci_workflow.test.ts tests/localization_coverage.test.ts
--maxWorkers=2`: 82 passed, 3 intentionally skipped, 2 suites passed.
The full run had observed these two failures before their fixes. The CI change
adds only the referenced screenshot subtrees to all five sparse checkout jobs.
The localization test fixture adds samples for the new `title`, `detail` and
`reach` placeholders; the placeholder assertions and translations are unchanged.

### Existing PR findings

The following findings predate this design integration. Relevant source/test
inputs were compared with PR head `16028d3aaa` and remain unchanged.

- Reliquary titles: `exp_arcane_calligraphy_gold` grants the Runecaller title but
  is absent from `RELIQUARY_HORIZON_TITLES`.
- Mob portraits: the existing `fenbridge_infiltrator` has no committed portrait
  and is missing from the 245-entry manifest. Seven tests fail in this suite.
- Non-Latin completeness: the same 960 quest/entity entries fail on the original
  head and this integration; none of the puzzle-polish keys add a failure.
- Storage price scan: unchanged input-sanity caps of 1,000,000 in
  `src/net/vehicle_session_wire.ts` and
  `src/ui/hud/vehicle/cannon_tactics_view.ts` collide with the price-literal guard.
  No new VFX code triggers that scan.

- CI timing-data coverage: the unchanged 94% requirement already fails on the
  original head (3,287 measured suites of 3,572, or 92.02%). Adding eight puzzle
  suites makes this 3,287 of 3,580, or 91.82%. All new suites are included using
  the existing fallback weight; no tests or thresholds were removed.


### Full run outcome

`GATE_SELECT_BASE=upstream/release/v0.42.0 npm run gate` exited 1 at the full
Vitest step after 2,738.60 seconds. It recorded 3,548 passing suites, 19 failing
suites and 30 skipped suites: 51,156 passing tests, 27 failures, 2 expected failures
and 449 skips. The CI cone and interpolation fixture failures were fixed and
rerun successfully as described above; 25 observed failures in 17 other suites
remain unresolved. Full merge QA is not green.

[Machine-readable QA summary](integration-qa-summary.json) lists every failing
suite and distinguishes the two fixed integration failures. The completed full
run reported no failures in the Confection or Ley presentation, effect, window,
match-3 trace, or existing puzzle behavior suites.

Additional failures occur in unchanged test/implementation surfaces: the
Eastbrook renderer fingerprint is stale against its committed input; the gathering
census expects 194 untagged mobs but observes 198; the banker-chest source-order
check no longer finds its expected renderer marker; the Scorched Supply Crate at
372,1968 intersects a collider; the mob-aura census observes 109 carriers against
108; terrain geometry and height fixtures differ; and existing input/guidance
fixtures do not provide glider callbacks or a world quest log. Existing NPC look
and voice inventories omit newer quest actors. The two target-portrait failures
are also consequences of the missing infiltrator portrait documented above.
These checks and their production surfaces were not rewritten in this design pass.
