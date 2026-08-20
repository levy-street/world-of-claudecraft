# Phase 11d QA: verify the derived artifacts, the pins, and the merge audit

### QA Starter Prompt
```
This is Phase 11d QA of the Masterwrought feature. Phase 11d is the phase that has to
prove the farming absorb was resolved correctly, so this audit is not about whether the
suites are green. Every suite in play was re-minted from the merged tree and therefore
agrees with whatever the resolution produced. The question here is whether the EVIDENCE
is real: whether each pin was predicted before it was observed, whether the census would
actually catch a dropped hunk, and whether the goldens compose.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the re-mint for prediction discipline, census completeness, golden
composition, regen freshness, and ceiling honesty, before 11e appends content that moves
half of these numbers again.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT: git status clean (all six 11d commits landed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit), with the
same warning 11d carried: a release absorb invalidates every prediction at once, so if one
lands here the pins are RE-DERIVED, never patched. Confirm `env | grep -c DATABASE_URL`
prints 0 before any vitest run. Memory scan: the test-pin trap index (READ it before
judging any pin), constant-self-comparison, "mutation harness must prove tests ran",
"gate env: DATABASE_URL poisons goldens", "release-merge gate surprises", "pin source must
carry identity".

STEP 1 - LOAD CONTEXT (Explore agent): state.md's 11d ledger (the predicted-versus-observed
table, the four ceiling rows, the decision 4 answer as recorded), progress.md's 11d row,
phase-11d-derived-artifacts.md (what was promised), the six commits read individually with
git show, docs/prd/masterwrought/merge-deletion-list.md, and scripts/merge_audit/*.
Return the ledger's prediction table verbatim; do not summarize it.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Prediction-discipline agent (adversarial, and this is the highest-value lane): for every
pin, recompute base + oursDelta + theirsDelta INDEPENDENTLY from git show on the three
refs (base e56707a675013fc1a86bb19d31a0a8d79a02a197, the pre-merge masterwrought tip
named in the 11b ledger, origin/feature/farming-plan). Do not trust the ledger's
arithmetic and do not accept a green suite as the answer: the test is whether the value
is DERIVED. A ledger row that records only an observed value is a finding on its own.
Cover the ones easily missed: tests/sfx_manifest.test.ts keys.size (predicted 270, and it
never conflicted), the tests/deed_icons.test.ts counts (DEED_IMAGE_IDS 278,
DEED_ART_PENDING 8), the reliquary base literals that were originally derived by
subtraction rather than read, and tests/recipe_economy.test.ts's two sorted literals.
Confirm FROZEN_CATALOG_SHA256 was re-minted LAST and that DEED_ORDER[len-1] is
'prog_farming_100' by the 11b ordering rule rather than by choice.
Census-completeness agent: this is the merge's only real regression detector, so audit it
like one. Confirm all four symbol classes are actually extracted (exported symbols,
content-table row ids, i18n keys, SimEvent names). Mutate a real symbol out of the merged
tree in a scratch copy and confirm the census reports it. Confirm the parent-set floors
exist, so an extractor that silently matches nothing cannot pass by comparing two empty
sets. Then hunt the extractors' blind spots deliberately: `export *` re-exports,
re-exported barrels, key paths built by concatenation or spread, computed content ids,
and SimEvent names emitted through a helper rather than a literal. Read the deletion list
and require every entry to name a phase, a ruling, and a reason, with renames carrying
both the old and the new name. An entry that says only "deleted" is a finding.
Golden-composition agent: re-run the composition script independently rather than reading
its output. Confirm the merged tick-0 nextId in solo_warrior.json reads 972. Confirm
draws and drawDigest are unchanged from ours in every scenario neither packet touched,
and NAME the scenarios checked. Confirm the goldens commit contains nothing but
tests/parity/golden/*.json. Confirm rift_clear_rewards.json and farming_session.json are
registered in tests/parity/scenarios.ts and land in a parity shard, verified by count in
both directions. A moved draws count in an untouched scenario is a determinism
regression, not a re-record, and it is a FAIL.
Regen-freshness agent: re-run npm run i18n:gen, npm run wiki:content, and
npm run sfx:manifest and require a zero diff. Confirm no generated artifact was hand
edited. Confirm the shard-weight union covers at or above 95 percent of test files, that
the __provenance block is the newer one, that `files` matches the merged key count, and
that no weight was hand-invented. Confirm the merged sfx manifest and runtime pack match
what the generator produces from the merged cue set.
Ceiling-honesty agent: each of the four coordinator pins equals the exact wc -l of its
file with zero slack, and each carries a ledger comment naming this merge and BOTH parent
pins. Confirm EVERY row in MONOLITHS was re-derived against the merged tree, not just the
four (server/game.ts, src/net/online.ts, and server/db.ts all moved on at least one
parent). Confirm no ceiling was set above its file to buy room for 11e, which adds content
rather than coordinator lines, so slack here is a finding. Confirm the hud.ts payback is
recorded as a Phase 14 carry with a target, not as a vague intent.
Test-decisiveness agent: no pin is a constant self-comparison; the composition script
fails on a hand-edited golden; each re-minted seal would move if its source bytes moved
(the four eastbrook JSONs are SOURCE-byte sweeps, so check the sweep still walks the real
bytes and not a stripped projection); the art census values match the recorded prediction
or the deviation is explained.
Dispatch per the Review Dispatch Matrix: cross-platform-sync, architecture-reviewer,
database-performance-reviewer, migration-safety, gate-integrity-reviewer (the shard-weight
and gate-selection surface), plus qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits). If a fix moves a pin, the
pin is RE-PREDICTED and then observed, never re-pasted; a fix round that pastes an
observed value reintroduces exactly the defect this phase exists to prevent. Rerun the
11d validation set including the full parity suite, the census, and the composition
script. Separate fix commits with explicit paths. The fix round is itself unreviewed
code: have a fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 11d QA row); state.md drift (any pin whose value moved
during the fix round, carrying its NEW prediction beside the new observation, plus any
ceiling row that changed); merge-deletion-list.md if the audit added a member;
farming/state.md open-item rows for anything found and not settled here; memory notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, and a handoff
to 11e that names the pins 11e will move again and states that 11e re-derives them by the
same predicted-then-observed method: DEED_ORDER to 287 and total renown to 3275 with
deed_i18n and DEED_IMAGE_IDS following, and both tests/recipe_economy.test.ts literals
once marsh_rice joins recipe_seasoned_stock. Follow-ups are CUT-or-fix decisions, never
future-PR items.
```
