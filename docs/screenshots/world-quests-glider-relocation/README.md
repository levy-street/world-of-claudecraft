# Existing mountain glider launch, 2026-09-23

Published continuation of PR 4161. The PR tracks the latest head and CI result.

## Publication checks

The first continuation CI run found stale content/source assertions for the new
course, board routing, minimap position, board catalog, grass exclusions and
build-time icon classes. These are updated with behavioral routing coverage.
Map plates were regenerated and missing non-Latin replay labels filled. The
training/crafting UI imported name formatters through the character window,
causing portrait model requests to outlive DOM tests; those formatters now use
the existing pure name module. Focused reruns pass. Final CI remains on the PR.

## Reward-free minigame replays

Forge, cannon, glider, Wisp Maze, calligraphy, shadow and both puzzle games can
be played after completing their daily quest. First completion still pays;
further rounds award no coins, XP, reputation, items, weekly credit or Clue
Scroll entitlement. Ley bonus boards are now reward-free and reopen after both
harder levels. Gold calligraphy practice may still earn its cosmetic deed.

Replay saves retain earned completion and the previous calligraphy result while
a new lesson is unfinished. Online reroll eligibility matches the server;
practice cannot reroll a completed quest and still counts toward the daily slate.
The local server was rebuilt and restarted for this change.

Verification: focused Vitest batches passed (74, 103 and 51 tests); review follow-up
passed 49 state/wire/reroll tests and all 30 calligraphy tests after correcting
the restore fixture to pass `{ state: saved }`. Commands used `npx vitest run`
with the changed world-quest suites, `tests/clue_scrolls.test.ts`,
`tests/vehicles.test.ts`, mount/activity and monolith guards. `npm run check:types`,
`npm run ci:changed`, `npm run build:server`, `npm run build:bundle` and
`git diff --check` passed. Persistence and focused behavior reviews have no
remaining findings. The earlier `node scripts/gate_select.mjs` stopped at i18n
freshness before publication was authorized. Scoped staging cleared that blocker;
the local full-suite fallback was stopped under severe memory/disk pressure,
so it is not a local gate pass. GitHub CI verifies the published head. No merge
or deployment.

Upstream was fetched through release head `fc86d90234`. Clue Scroll PR 4110 still
points to `542b782cd9e911b142a0f2b53e87b89c28eb5892`, already in this branch.
Our round-2 changes add the NPC talk/hand-over row; authored clue hunts and clue
direction prose match that PR. Champete's newer rework could not be identified
from the published PRs; requested its PR/branch/username before declaring it
compatible. Nothing was merged.

## Minigame action icons

The glider/cannon report exposed an incomplete shared-style migration: all six
icon URLs decoded successfully in Chromium, but their spans measured 0 by 0.
Vehicle, forge and shadow controllers now compose the existing ui-socket art,
keycap, count and cooldown primitives. Redundant vehicle button chrome was
removed so the shared skin owns it. Chromium measured all six glider/cannon
icons at 58 by 58 after the fix. [Cannon controls](cannon-icons.png).

Regression: two controller tests failed before the fix; the controller,
CSS-validity, CSS-corpus and UI-library suites then passed all 65 tests.
`npx tsc --noEmit` and `npm run ci:changed` passed. This is a client-only fix;
the local Vite rig picks it up on refresh. The earlier pre-merge gate limitation
still applies.

## More varied opening sections

The next playtest revision adds an opening S-bend, dip and boosted climb to
Coastal Circuit (24 hoops), a diving curve to Valley Circuit (11), and alternating
banks to Ridge Switchbacks (11). Medal times account for the revised routes.
Score version 2 separates these flights from earlier trial times; old personal
times are not carried onto the changed courses. Existing server v1 rows remain
stored, outside the current boards.

Flight integration, terrain clearance, opening spacing, renderer, tracker,
course selection, saved records and leaderboard checks pass. The follow-up
32-test run covers the added opening and version guards; the preceding run
passed all flight tests, with its sole failure an old 9/9 tracker expectation
now corrected to 11/11. Typecheck, changed-file checks and both builds pass. No terrain or general
simulation behavior changed in this revision, so the prior parity evidence
still applies. Earlier screenshots show the launch, not these revised flights.

## Follow-up from the local playtest

The existing summit and wharf are now 20 yards higher (deck at 64.79), with the
approach regraded and opening hoops adjusted. The next required hoop is blue,
later hoops red, and passed hoops green. Only the next hoop grants progress.
Zephyr offers Fly again after completion. Practice cannot award coins, XP or
reputation; a save made during practice preserves the completed reward claim.

The offline Sim previously returned an empty leaderboard unconditionally.
Offline flights now save six bounded personal best slots (daily/lifetime for
three courses), labelled as offline records. Online rankings retain their server
authority. Earlier unrecorded flights are not invented or backfilled.

Follow-up verification: focused flight, replay/reconnect, record rollover,
rendering, dialog, leaderboard, path, architecture and localization tests passed
after rerunning the two interrupted/fixture-setup suites. Typecheck, changed-file
checks and client/server builds passed. Terrain corpus regenerated. The selective
gate still stops on unstaged i18n artifacts. Disk exhaustion interrupted an
initial build and test run; only this worktree's generated output/cache was
removed before successful reruns. The final browser run reached the raised
wharf, displayed the offline records label and started countdown from the sign.
Some model loads timed out under local load, so this is functional UI evidence,
not final asset-quality approval. Fresh captures: [raised wharf](raised-wharf.png)
and [offline records](offline-records.png). Earlier images below predate the raise.

`UPDATE_PARITY=1 npx vitest run tests/parity -t 'mints the golden'` passed
83 golden recordings. Their changes are the added empty `gliderRecords` field
and state hashes; events, RNG and other sampled state remain unchanged.
The preceding full parity run passed determinism and coverage checks; its only
failures were comparisons with the old goldens (57 mismatches, 211 passed,
1 skipped). Golden minting overlapped the end of that run, so the clean final
comparison is checked separately with `-t 'matches the committed golden'`.
That final comparison passed: 83 tests, with 269 unrelated tests skipped by
the name filter. No remaining parity mismatch.

The artificial mountain at (449, 512) has been removed. The trail follows
(228, 418), (241, 537), (222, 611), (183, 610), (191, 557). The wharf starts
at the final waypoint and launches east. Terrain is graded along the trail.

Three fixed courses share this launch: Coastal Circuit (24 rings), Valley Circuit
(11 rings), and Ridge Switchbacks (11 rings). Fixed routes replace daily generated
variants so lifetime times remain comparable. Each has Today and All time boards,
ranked by fastest complete flight. Every ring is required. The daily reward still
pays once, and repeat flights remain eligible for records. The sign beside the
instructor opens the records and starts the selected course.

## Visual evidence

Captured with the repository screenshot target and offline game entry helper.
The local server also returned the new daily board over HTTP. The browser sign
interaction displayed all six boards and its launch button started countdown.

- [Previous artificial mountain](../world-quests-round-2/after-shear-from-the-flats.png)
- [Previous wharf](../world-quests-round-2/after-shear-on-the-planks.png)
- [New approach](approach.png)
- [New wharf](wharf.png)
- [Course records](rankings.png)

## Verification

Passed:

- `npx tsc --noEmit` and `npm run ci:changed` (warnings remain).
- `npm run build:server` and `npm run build:bundle`.
- `npm run security:gate`: zero high findings after repository priors.
- Focused course, renderer, tracker, board, wire/API, path and placement suites.
  Final focused run: 16 files, 124 tests; flight integration and physics passed.
- Gathering nodes, ground objects, mount races and riding lessons: 4 files, 98 tests.
- `UPDATE_TERRAIN_HEIGHT_PARITY=1 npx vitest run tests/terrain_height_parity.test.ts`.
  Corpus reviewed by coordinate: 1,191 changed shared points, all in Galecrest;
  100 net added samples from changed road stencils.
- `UPDATE_PARITY=1 npx vitest run tests/parity`: 268 passed, 1 skipped;
  no golden files changed.
- PostgreSQL 16 tests with `TEST_DATABASE_URL=postgresql:///postgres?host=/tmp`:
  best-time persistence, daily rollover, delayed writes, moderation, deletion,
  and the production two-second lock timeout with successful connection reuse.
- 100,000 synthetic pilots / 200,000 records: indexed ranking reads, no sort,
  135ms daily and 188ms lifetime with 20,000 excluded leading records.
- New suite weights recorded from three local measured runs.

`node scripts/gate_select.mjs` stopped at i18n freshness because generated files
are unstaged. It requires staging before its complete pre-merge run. Nothing was
staged, committed, pushed, merged or deployed. Remote CI still describes the old
head. The existing road correction and untracked round-2 plan were preserved.

The local rig is at http://localhost:5173 with the rebuilt server on :8787.
Both client and server bundles are available after the feedback rebuild.
Publication of the original plan document is still an open decision.
