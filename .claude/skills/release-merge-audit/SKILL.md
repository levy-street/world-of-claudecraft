---
name: release-merge-audit
description: Audit a release/** merge into a long-lived feature branch for the known drift hazards. Use immediately after merging a release branch into a feature branch (or when reviewing such a merge commit): finds branch-owned files the merge touched, release changes landed on a legacy arm that a migrated handler must mirror, new routes missing surface-corpus rows, release-refactored helpers that need re-binding at their injection sites, and planning-doc premises the merge silently invalidated.
user-invocable: true
---

# Release-merge audit

A release merge into a long-lived feature branch routinely lands surprises that neither CI nor
the merge conflict markers surface. This audit has paid for itself four times on
`feature/api-re-architecture` alone:

1. A release hotfix changed a LEGACY route arm the branch had already migrated, so the
   migrated handler silently diverged (parity break with no conflict).
2. A release refactor added a parameter to a helper the branch receives BY INJECTION
   (`passesTurnstile` gained a secret argument); the un-re-bound injection site silently
   disabled the gate.
3. A release added 12 routes the branch's surface inventory did not know about, 6 of them
   invisible to the parity corpus.
4. A release hotfix pre-landed half of some planned work (the market realm-scoping) with a
   different mechanism than the branch's plan assumed, invalidating the plan's premise.

Run every step; each targets one of those failure classes. No em dashes or emojis in anything
you write.

## Step 1: identify the merge and its delta

The merge commit is the argument if given, else the most recent RELEASE merge. Both subject
forms occur in this history: the plain form (`Merge branch 'release/v0.23.0' ...`) and the far
more common remote-tracking form (`Merge remote-tracking branch 'origin/release/v0.25.0' ...`,
also with `upstream/` or `up/`). Match both:

```sh
git log --merges -1 --format='%H %s' \
  --grep="branch '\(origin/\|upstream/\|up/\)\?release/" HEAD
```

Print `%s` and read it: hand-written subjects (e.g. `merge: resync with release/v0.23.0`) do
not match this grep, and a bare `git log --merges -1` can grab an unrelated merge, e.g. a
main-merge, so when in doubt pass the commit explicitly. The audit
assumes a true two-parent merge commit; a squash-merged release has no `^2`, so pass the
commit explicitly and treat its own diff as the incoming delta. The incoming delta (what the
release brought, relative to the branch):

```sh
git diff --name-only <merge>^1..<merge>
```

`^1` is the branch-side parent. Also record the merged release ref (`git log -1 <merge>^2`).

## Step 2: intersect with branch-owned surfaces

Compute the files the BRANCH owns (changed on the branch before the merge):

```sh
git diff --name-only "$(git merge-base <merge>^1 main)"..<merge>^1
```

Intersect with Step 1's list. Every overlapping file is a manual-read item: the release and the
branch both changed it, and the merge resolution may have quietly dropped either side's intent.
For each overlap, read the merged result against BOTH parents (`git show <merge>^1:<file>`,
`git show <merge>^2:<file>`) and confirm no side's behavior was lost. A base-merge can silently
revert a feature in one hunk.

## Step 3: legacy-arm divergence (migrated surfaces)

For each route or handler the branch has MIGRATED that the release touched: did the release
change land only on the legacy arm? If so, mirror it into the migrated handler and add a parity
case in the same change. On the API pipeline, remember a knownDeviation masks its WHOLE path,
so re-pin corpus fixtures via captureBothModes rather than widening a deviation.

## Step 4: new endpoints and inventory rows

List any route, WS command, or endpoint the release ADDED (grep the delta for route tables,
dispatch cases, `app.`/registry additions). Each needs: an owner on the branch's architecture
(for the pipeline: a RouteDef, router-owned AND legacy-served during rollback retention), and a
row in the surface inventory / parity corpus. A corpus-invisible route is unaudited by
definition.

## Step 5: injected and re-bound helpers

For each function in the delta whose signature or closure changed: find every place the branch
passes it BY INJECTION (boot wiring, configure*Runtime calls, DI seams) and confirm the
injection site was re-bound with the new shape. A stale binding compiles fine and silently
skips the new behavior.

## Step 6: planning-doc premise re-check

Locate the branch's planning docs first: they usually live under `docs/<epic>/` (for the API
pipeline, `docs/api-pipeline/`), and files like `state.md`/`progress.md` name the work in
flight. Re-read whichever doc describes the ACTIVE work plus those two files. Did the merge
land code they assume absent, or implement a planned mechanism a different way? If yes,
correct the premise in the docs BEFORE implementing against it, and note the correction in
memory.

## Step 7: report and fix

Produce a short report: overlaps read (Step 2), divergences mirrored (Step 3), inventory rows
added (Step 4), bindings re-checked (Step 5), premises corrected (Step 6), each with file:line.
Apply the fixes in the same change with a parity/regression test per divergence, then run the
targeted suites plus `npx tsc --noEmit` (or `npm run gate` if the merge was large).

One i18n merge-mechanics note: the aggregate baseline (`src/ui/i18n.resolved.sha256`) and the
status summary (`src/ui/i18n.status.summary.json`) are no longer committed (removed by the
2026-07-14 degit change), so a merge where both sides changed catalog keys only needs
`npm run i18n:gen` to reconcile the committed line-item slices. The historical stale-baseline
trap (taking either side of the aggregate left a hash neither parent had, needing a manual
re-baseline) applies only when auditing merges on branches that predate that change.

A second recurring trap (reddened the gate on a later v0.23.0 merge into the bank-system
branch): a release-authored test that drives GameServer mocks `../server/db` with the export
list as of the RELEASE tree, so a db function the BRANCH added to game.join/leave or the
autosave loop throws "No X export is defined on the mock" only on the merged tree. Neither parent can carry
the fix, targeted suites miss it, and only the full gate catches it. After any merge that
brings new `vi.mock('../server/db')` sites, diff each new mock's keys against what
`server/game.ts` imports from db on the branch, and mirror the branch's canonical mock shape
(for the character-lease surface: `tests/character_lease_game.test.ts`).
