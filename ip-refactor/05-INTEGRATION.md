# 05 — Integration (merging tracks back into feature/ip-pivot)

How completed track work lands on `feature/ip-pivot`. Read with `03-COMMIT-AND-VERIFY.md`
(commit cadence, the reword-staleness handoff) and `README.md` + `00-SHARED-CONVENTIONS.md`
(the track model, the prime directive RENAME DISPLAY FREEZE IDS, the two English source layers,
the regen sequence). This file does not re-derive those; it only says how to fold a finished
`track/ip-*` branch into the integrated base without breaking the gates.

## The one rule: a SINGLE integrator, one branch at a time
`feature/ip-pivot` is checked out in exactly one worktree (the base checkout,
`world-of-claudecraft/world-of-claudecraft`; worktrees shift between sessions, so confirm with
`git worktree list`). Merging a track into it touches that one checkout, so **two merges at
once race and corrupt the index/refs, AND both regenerate the same i18n / guide artifacts.**
Therefore:

- **Track agents never merge.** They stop at "report" on their `track/ip-<x>` branch.
- **One integrator** (you, or a single dedicated session) does all merges, **sequentially**.
- Fork tracks only AFTER G1 locks the NAME-MAP (the four tracks Vocab / Creatures / World / Text
  all apply that one frozen contract). Integrate **frequently**, per slice as it lands green, or
  sweep a small batch. Never let tracks run to the end and big-bang: the artifact conflicts pile
  up and the reword-staleness diff (`03-COMMIT-AND-VERIFY.md`) gets unreadable.

## Procedure (run in the feature/ip-pivot checkout)
For EACH ready branch, one at a time:
```bash
REPO=/Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft
cd "$REPO"
git worktree list                # confirm THIS path holds feature/ip-pivot (worktrees shift)
git branch --show-current        # must be feature/ip-pivot
git status --short               # must be clean

git merge --no-ff track/ip-vocab   # the ready track (one at a time)
#   Resolve conflicts ONLY per "Conflict resolution" below; anything else/ambiguous -> STOP.

# Reconcile the generated artifacts (NEVER hand-merged) once the SOURCE files are merged:
npm run i18n:gen                 # rebuild src/ui/i18n.resolved.generated/* + the status registry
npm run i18n:hash -- --write     # rewrite src/ui/i18n.resolved.sha256
npm run wiki:content             # regenerate src/guide/content.generated.ts
git add src/ui/i18n.resolved.generated src/ui/i18n.resolved.sha256 src/guide/content.generated.ts
git commit --no-edit             # fold the reconciled artifacts into the merge commit

# Gate the integrated tree (must be GREEN) — see "Gate after each merge" below.
git push                         # publish feature/ip-pivot
```
Then in `02-WORKING-MEMORY.md`: flip the just-integrated session(s) to `merged`, tick the
scanner-worklist entries that slice cleared, and update the generated-artifact touch log to
"integrator (reconciled)". Append-only.

## Conflict resolution (the only allowed merge edits)
The **generated artifacts are NEVER hand-merged.** They are deterministic from the merged
source, so a merge conflict inside one is meaningless noise:

- **`src/ui/i18n.resolved.generated/*`, `src/ui/i18n.resolved.sha256`,
  `src/guide/content.generated.ts`:** do NOT resolve line by line. Take EITHER side to clear the
  conflict (or `git checkout --theirs`/`--ours` on those paths), let the SOURCE files (`.name`
  records + the ability/item catalogs + `sim_i18n.ts`) merge, then **RE-RUN
  `npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content`** and commit the
  reconciled output. That regen IS the resolution: it is idempotent, so a second `i18n:gen` must
  leave the tree clean.

Three coordination files are **UNION, append-only, drop nothing** — the cross-track contracts:

- **`NAME-MAP.md`:** keep every row from BOTH sides. It is append-only once LOCKED; a merge never
  drops or edits a locked row, it only unions in rows a later slice appended (a request row the
  operator answered). Never renumber, never change an already-locked `new` value in a merge.
- **The `02-WORKING-MEMORY.md` scanner-worklist registry + the Slice status board:** union of
  both sides' rows and ticks. Keep every `cleared?` tick from both sides; keep every status line.
- **The generated-artifact touch log** in the same file: union, then set the row to the
  integrator as last-regenerator.

**Everything else / ambiguous -> STOP.** `git merge --abort`, then resolve deliberately or ask.
Never guess. In particular a conflict INSIDE a sim content `.name`, an ability/item catalog
English value, a `sim_i18n.ts` `AURA_NAME_KEY` matcher entry, or a C1/C2 coined-id token is NOT
a union: both sides are trying to set the SAME player string or id, which means the tracks
overlapped where they should not have. Do not pick one and move on; abort and reconcile against
the LOCKED NAME-MAP (the map is the single source for what the string must be).

## Gate the integrated tree after each merge (must be GREEN)
Run the subset the merged slice touched, plus the always-on behavior gate:
```bash
npx vitest run tests/parity                            # goldens BYTE-IDENTICAL (behavior unchanged)
npx vitest run tests/i18n_resolved_equivalence.test.ts # SHA gate (needs i18n:hash --write above)
npx vitest run tests/ip_scrub.test.ts                  # the merged slice's denylist entries now GREEN
npx vitest run tests/guide.test.ts                     # guide content fresh (needs wiki:content above)
npx tsc --noEmit
#   For a CREATURES merge (C1/C2 coined-id sweep) ALSO:
npx vitest run tests/architecture.test.ts              # src/sim purity (edits types.ts + sim.ts)
#   and confirm any tests/parity golden delta is ONLY the C1/C2 token swap (see below).
#   For a W2 or C1 merge that moved an emit literal ALSO:
npx vitest run tests/localization_fixes.test.ts        # S3 matcher co-location
```
Expectations, and what a red gate means:

- **`tests/parity` goldens stay byte-identical** for every slice EXCEPT the Creatures merge. A
  display rename changes no sim state; a shifted golden on a V/W/T merge means an id leaked into
  the rename or you dropped a body in conflict resolution: STOP.
- **The Creatures merge (C1/C2) is the ONE allowed golden change**, and only by the exact
  coined-id token swap (`murloc->mudfin`, `kobold->tunnelrat`, the warlock pet ids). Diff the
  changed goldens and confirm the delta is NOTHING but the renamed token; any other movement =
  STOP.
- **`tests/ip_scrub`:** the merged slice's worklist entries flip from RED to GREEN and stay
  green; no previously-green entry regresses. Z1 requires the whole scanner green with zero
  residual, so a merge that leaves a slice's entries red is not done.
- **`tests/i18n_resolved_equivalence`:** green only because you re-ran `i18n:hash -- --write`
  above. If it reds, the two English copies (sim record vs catalog) drifted in the merge, or the
  regen was skipped: fix the source, re-regen, do not touch the test.

If ANY gate is red: **STOP** and investigate. Do NOT `--force`, do NOT regenerate a parity
golden by hand, do NOT loosen or `.skip` the `ip_scrub` scanner or edit its denylist to pass. A
red gate means it was not a clean fold: the merge dropped a `.name` edit, desynced the two
English copies, moved an id, or reintroduced a denied name.

## Keep active tracks current (the other direction)
So a track does not drift far from the integrated base (another track just landed a batch of
renames and regenerated the shared artifacts), periodically merge `feature/ip-pivot` **into** the
track — from that track's OWN worktree (NOT the feature/ip-pivot checkout; confirm with
`git worktree list`):
```bash
cd <the track's worktree>         # e.g. wt-ip-creatures, wt-ip-world
git merge feature/ip-pivot        # same conflict rules as above:
#   generated artifacts -> take either side, then RE-RUN the three generators and commit.
#   NAME-MAP / working-memory registries -> union, append-only.
#   a real .name / catalog / id conflict -> STOP and reconcile against the LOCKED NAME-MAP.
npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content
#   then re-run the gate subset your track touches (tests/parity + ip_scrub + equivalence + tsc).
```
Do this before a track's next slice if another track just merged something that regenerated the
i18n / guide artifacts, so the track builds on the reconciled base and its next regen is a clean
no-op diff rather than a conflict.

## Integrator prompt (paste to a single session, or run the commands yourself)
```
You are the INTEGRATOR for the IP-pivot refactor. Merge ready track branches into
feature/ip-pivot, ONE AT A TIME (never concurrently — feature/ip-pivot is a single shared
checkout and every merge regenerates the same i18n/guide artifacts). Read
/Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/README.md and
00-SHARED-CONVENTIONS.md and the LOCKED NAME-MAP.md first.
Working directory: /Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft
Confirm `git worktree list` shows this path on feature/ip-pivot, `git branch --show-current`
= feature/ip-pivot, and `git status` is clean.

BRANCHES TO MERGE THIS RUN (process in this order, one at a time):
  track/ip-vocab

For each branch:
1. git merge --no-ff <branch>. Resolve conflicts ONLY as:
   - src/ui/i18n.resolved.generated/*, i18n.resolved.sha256, src/guide/content.generated.ts =
     NEVER hand-merge. Take either side to clear the conflict, let the SOURCE files merge, then
     RE-RUN: npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content, and
     commit the reconciled artifacts.
   - NAME-MAP.md + the 02-WORKING-MEMORY scanner worklist + status board + touch log = UNION,
     append-only, drop nothing.
   - ANY other conflict (a sim .name, an ability/item catalog English value, a sim_i18n.ts
     matcher entry, a C1/C2 coined-id token) or anything ambiguous -> git merge --abort and
     STOP. Do not guess; reconcile against the LOCKED NAME-MAP.
2. Gate the integrated tree (must be GREEN):
   npx vitest run tests/parity tests/i18n_resolved_equivalence.test.ts tests/ip_scrub.test.ts tests/guide.test.ts
   npx tsc --noEmit
   (Creatures merge C1/C2 ALSO: npx vitest run tests/architecture.test.ts, and confirm any
    tests/parity golden delta is ONLY the coined-id token swap; W2/C1 emit-literal moves ALSO:
    npx vitest run tests/localization_fixes.test.ts)
   If red -> STOP and report. Never --force; never regenerate a golden by hand; never loosen,
   .skip, or edit the ip_scrub denylist to pass.
3. git push.
4. In /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/02-WORKING-MEMORY.md, flip the
   newly-integrated session(s) to `merged`, tick the scanner-worklist entries it cleared, and
   set the generated-artifact touch log rows to "integrator (reconciled)". Append-only.
Report one line per branch: merged+pushed, or aborted/stopped + why.
```

## Alternative: PR-based (CI per merge instead of a local integrator)
Have each track `git push origin track/ip-<x>` and open a PR against `feature/ip-pivot`
(`gh pr create --base feature/ip-pivot`). GitHub serializes the merges and the repo pr-gate runs
the suite per PR (`tests/parity` + `tests/ip_scrub` + `tests/i18n_resolved_equivalence` +
`tests/guide` + `tsc` + build). Safe (no local race) and gives an audit trail, at the cost of
~one PR per slice and waiting on CI. Two caveats specific to this job: (1) GitHub will NOT
auto-reconcile the generated artifacts — resolve those conflicts by taking either side, then push
a commit that RE-RAN the three generators, exactly as the local path does; never hand-merge a
resolved table or a sha256. (2) The union files (`NAME-MAP.md` + the working-memory registries)
still need a human union in the PR. Use this if you prefer gated, reviewable merges over fast
local ones.
