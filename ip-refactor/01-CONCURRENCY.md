# 01 - Concurrency & scheduling

How to run the IP-pivot sessions in parallel safely. Read this with `README.md` (the goal,
the IP surface map, the session index, the scope decisions, the prime directive
"RENAME DISPLAY, FREEZE IDS") and `00-SHARED-CONVENTIONS.md` (the two English source layers,
the regen sequence, the gates, the standard session loop). This file adds only the
track/merge model; it does not repeat the gates, the prime directive, or the byte-identical
rule.

## The governing fact
Unlike the sim refactor (where every slice clawed at the SAME two files), this workstream was
split so the four tracks edit almost-DISJOINT source files:

- **Vocab track edits `content/classes.ts` (V1) then `content/talents_classic.ts` +
  `talent_i18n.ts` (V2)** - ability display names, then talent/spec/tree display names. Two
  files, in order, no overlap.
- **Creatures track edits `types.ts` + `sim.ts` + `render/characters/manifest.ts` + `zone*.ts`
  / `temple.ts` family fields + quest prose (C1), then `content/warlock_pets.ts` +
  `summonDemon` + `classes.ts` summon descriptions (C2)** - the coined `MobFamily` ids and
  demon-pet ids, atomically swept.
- **World track edits `content/items.ts` + `item_sets.ts` + `augments.ts` +
  `i18n.catalog/items.ts` (W1), then `content/dungeons.ts` + `zone2.ts` / `zone3.ts` mechanic
  names + `sim_i18n.ts` (W2)** - item/set/augment display, then the four mob-mechanic auras.
- **Text track edits `README.md` + code comments + `realm.ts` + `main.ts` realm copy (T1)** -
  de-brand prose only, touches no content record.

That near-disjoint file split is what makes concurrency cheap here. The four tracks barely
share a SOURCE file. The residual shared surface is small, explicit, and NOT a source file at
all: the three deterministic generated artifacts (below), plus two append-only registries in
`02-WORKING-MEMORY.md`.

- **Shared checkout (same worktree) => sequential.** `feature/ip-pivot` is ONE shared
  checkout. Two agents editing it at once clobber each other. **One integrator, one branch
  merged at a time.**
- **Concurrent (same wall-clock time) => isolation.** Each track runs on its own git worktree
  + `track/ip-*` branch off `feature/ip-pivot`, then merges back. This repo already lives in
  many worktrees; use the same pattern.

## The one shared conflict surface (the crux of this concurrency model)
Every rename slice regenerates three DETERMINISTIC artifacts:
- `src/ui/i18n.resolved.generated/*` (the 21-locale resolved tables)
- `src/ui/i18n.resolved.sha256` (the SHA gate baseline)
- `src/guide/content.generated.ts` (the /wiki content)

These are a pure function of the source records. Two parallel tracks WILL both touch them, so
they WILL conflict on merge. **Never hand-merge a generated artifact.** A conflict on any of
these three is resolved by RE-RUNNING the generators on the integrated tree:

```
npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content
```

then committing the regenerated result. The source records from both tracks are disjoint, so
after both source sides land, a single regen produces the one correct artifact for the union.
This is the entire integration story: **conflicts live only in generated files, and generated
files are reconciled by regeneration, not by editing.** Log which slice last regenerated in
the `02-WORKING-MEMORY.md` artifact-touch table so the integrator knows to re-run.

## The serial spine (one worktree, in order, no concurrency)
Nothing forks until these are done and merged to `feature/ip-pivot`:

1. **G0** - the de-IP gate. Land `tests/ip_scrub.test.ts` (the verbatim-name scanner) RED,
   documenting today's violations as the baseline worklist, and confirm the behavior-unchanged
   gates (`tests/parity` goldens byte-identical, `i18n_resolved_equivalence`,
   `architecture.test.ts`, `tsc --noEmit`) are green. This pins "these names are gone" so a
   later edit cannot silently reintroduce one.
2. **G1** - generate the full NAME-MAP and STOP for operator sign-off. Tracks do NOT fork until
   the operator flips `NAME-MAP.md` STATUS to **LOCKED** (G1's output). The LOCKED map is the
   contract every rename slice applies verbatim; it is append-only once locked.

The tracks fork ONLY after G1's NAME-MAP is LOCKED. Until then every V/C/W/T slice is blocked
(see the NAME-MAP lock state in `02-WORKING-MEMORY.md`).

...and at the very end, after all tracks merge back:

3. **Z1** (finale: integrate, regenerate artifacts, scanner-zero, release-locale-fill handoff,
   doc pass) - sequential, last, on the integrated `feature/ip-pivot` tree.

## Parallel tracks (concurrent; each in its own worktree; internally sequential)
Chosen so their primary edit files are disjoint. Run all four at once if you have capacity.

| Track | Sessions (run in this order within the track) | Primary edit surface | Branch |
|-------|-----------------------------------------------|----------------------|--------|
| **Vocab** | V1 -> V2 | `classes.ts` (abilities), then `talents_classic.ts` + `talent_i18n.ts` | `track/ip-vocab` |
| **Creatures** | C1 -> C2 | `types.ts` + `sim.ts` + `manifest.ts` + `zone*`/`temple` family fields + prose, then `warlock_pets.ts` + `summonDemon` + `classes.ts` summon descriptions | `track/ip-creatures` |
| **World** | W1 -> W2 | `items.ts` + `item_sets.ts` + `augments.ts` + `i18n.catalog/items.ts`, then `dungeons.ts` + `zone2/3` mechanic names + `sim_i18n.ts` | `track/ip-world` |
| **Text** | T1 | `README.md` + comments + `realm.ts` + `main.ts` | `track/ip-text` |

All four branch off `feature/ip-pivot`. Their only crossing points are the three generated
artifacts (regenerated, never hand-merged) and the two append-only registries (see Integration
rules).

## Authoritative track assignment (every session)
- **Spine (sequential):** G0, G1 (front), Z1 (end)
- **Vocab:** V1, V2
- **Creatures:** C1, C2
- **World:** W1, W2
- **Text:** T1

Each session brief states its track and merge target when you hand it off.

## What CAN share one worktree concurrently
Only non-renaming work:
- **QA sessions** (read-mostly; `00-QA-TEMPLATE.md`). A QA pass on slice N can run alongside
  later impl work, but the moment QA needs a fix, that fix serializes. Cleanest: QA gates each
  slice WITHIN its track before the next slice in that track starts.
- The gate config artifacts (the scanner denylist, the ULTRACODE adversarial-verify scaffolding
  for G1/C1/C2) and any doc/brief edits in this packet.

Real rename slices never share a worktree concurrently - they isolate.

## Integration rules (the cost of parallelism)
- **Coordinate through `02-WORKING-MEMORY.md`** - the live integration log every concurrent
  agent reads before starting and updates as it goes. It holds the Status Board, the NAME-MAP
  lock state, the scanner worklist registry (which verbatim names are still present, ticked by
  the clearing slice), the generated-artifact touch log, and cross-track decisions. This is the
  only thing that lets isolated worktrees see each other.
- **Fork tracks only after G1's NAME-MAP is LOCKED to `feature/ip-pivot`.**
- **Merge each slice back frequently** - after every session, not at the end. The longer a
  track runs unmerged, the more the generated artifacts drift and the larger the regen
  reconciliation.
- **The three generated artifacts are the conflict points. Resolve by REGENERATION, never a
  hand-merge:** after each merge to `feature/ip-pivot`, run
  `npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content` on the integrated
  tree and commit the result. A hand-edited resolved table or SHA baseline is a bug; the
  generators are the source of those files.
- **Two append-only registries. UNION on merge, drop nothing:**
  - The **scanner worklist** in `02-WORKING-MEMORY.md` - each track ticks the denylist entries
    it cleared; merge as the union of ticks.
  - The **NAME-MAP** (after LOCK) - append-only; a slice needing a missing string appends a
    request row for the operator, never invents a name. Merge as the union of appended rows.
- After every merge to `feature/ip-pivot`, **re-run the gates on the integrated tree**
  (`npx tsc --noEmit`, `npx vitest run tests/parity`, then the regen +
  `tests/i18n_resolved_equivalence.test.ts`, `tests/ip_scrub.test.ts`, `tests/guide.test.ts`).
  A slice is only "done" when it is green AFTER merge and regen, not just green in isolation.

## Cross-track ordering constraints (honor even across worktrees)
Most cross-slice dependencies are absorbed by the LOCKED NAME-MAP (both sides read the same
frozen old -> new strings), so they do NOT force ordering. The ones that DO:
- **Everything after G1's LOCK** (and G0, which G1 depends on).
- **V2 depends on V1's applied ability names (talent-ability pairing).** A talent that mirrors
  an ability must use that ability's NEW name. Both V1 and V2 read the LOCKED NAME-MAP, which
  already encodes the paired names, so they STILL parallelize. But if V1 slips or the two run
  sequentially, V2 confirms V1's applied names match the map before committing.
- **C1 owns Slimy Murloc Scale + Bristleback Maul.** Those two item rows are renamed on the
  Creatures track (they carry coined creature tokens), so **W1 must NOT touch those two rows**.
  The rest of `items.ts` is W1. Honor the split so the two tracks do not both edit the same
  item lines.
- **The coined-id sweep is Creatures-only, and the only golden-touching work.** C1 (family
  `murloc`/`kobold`) and C2 (warlock pet ids) are the ONLY slices that may legitimately change a
  `tests/parity` golden, and only by the exact renamed token (the inspector verifies the delta
  is nothing else). Keep every id sweep on the Creatures track alone; no other track edits an id
  or expects a golden to move. If a golden shifts on V/W/T, you changed behavior: STOP.
- **Z1 absolutely last** - it integrates all tracks, runs the final regen, requires the scanner
  fully green (zero residual), writes the release-locale-fill handoff, and does the doc pass. It
  must run on the fully integrated tree.
- Within a track, order is fixed (see the table). Across tracks there is no ordering beyond the
  rules above: union the two registries, regenerate the three artifacts, keep the id sweep on
  Creatures, honor the two C1-owned item rows.

## Worktree setup (copy-paste)
Run each concurrent track in its own git worktree on its own branch off `feature/ip-pivot`.
Confirm the `feature/ip-pivot` checkout path first with `git worktree list` (paths shift in
this environment).

```bash
# 0. SPINE FIRST - on feature/ip-pivot itself, in ONE worktree, committed + merged before
#    forking: G0 -> G1. Do NOT fork tracks until the operator flips NAME-MAP.md to LOCKED.

# 1. Fork one worktree + branch per concurrent track (from the feature/ip-pivot checkout):
cd /Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft   # confirm via `git worktree list`
git worktree add -b track/ip-vocab     ../wt-ip-vocab     feature/ip-pivot
git worktree add -b track/ip-creatures ../wt-ip-creatures feature/ip-pivot
git worktree add -b track/ip-world     ../wt-ip-world     feature/ip-pivot
git worktree add -b track/ip-text      ../wt-ip-text      feature/ip-pivot

# 2. Install deps in EACH worktree (fresh working dir = its own gitignored node_modules):
for d in wt-ip-vocab wt-ip-creatures wt-ip-world wt-ip-text; do ( cd "../$d" && npm ci ); done

# 3. Run a track: open its worktree, hand that track's session brief to a fresh agent.
#    All worktrees share ONE packet + working-memory log (outside every repo):
#    /Users/reubenhorne/Documents/code/woc-refactor/ip-refactor/02-WORKING-MEMORY.md

# 4. After EACH session in a track, merge it back to feature/ip-pivot and keep base green.
#    ONE integrator merges ONE branch at a time (feature/ip-pivot is a single checkout):
cd /Users/reubenhorne/Documents/code/world-of-claudecraft/world-of-claudecraft
git merge --no-ff track/ip-vocab
#   generated-artifact conflicts (i18n.resolved.generated/* , i18n.resolved.sha256,
#   guide/content.generated.ts) = DO NOT hand-merge; regenerate:
npm run i18n:gen && npm run i18n:hash -- --write && npm run wiki:content
npx tsc --noEmit \
  && npx vitest run tests/parity tests/i18n_resolved_equivalence.test.ts tests/ip_scrub.test.ts tests/guide.test.ts

# 5. When a track is finished, remove its worktree:
git worktree remove ../wt-ip-vocab
git worktree prune
```

Practical notes:
- **One branch per worktree** - git refuses to check out `feature/ip-pivot` in two worktrees;
  each track gets its own `track/ip-*` branch.
- **One integrator** - only one agent merges into `feature/ip-pivot` at a time; the shared
  checkout has no locking beyond that discipline.
- **`npm ci` per worktree** - worktrees share the git object store but each has its own working
  directory and `node_modules`.
- **Regen after every merge** - the generated artifacts are deterministic, so the integrator's
  single post-merge regen produces the one correct file for the union of both sides' source
  edits. Commit the regenerated artifacts with explicit paths (never `git add -A`).

## Recommended schedule
Run **Vocab + Creatures + World + Text as four concurrent tracks** (the cleanest possible
source split) and **merge after every session, regenerating the artifacts each time**.
Illustrative cadence:

```
Spine:    G0 -> G1 (LOCK NAME-MAP)     (one worktree, sequential, merge to feature/ip-pivot)
Then fork 4 worktrees off feature/ip-pivot:
  wt-ip-vocab:     V1 V2      (classes.ts abilities, then talents; V2 pairs to V1's new names)
  wt-ip-creatures: C1 C2      (coined-id sweep; the ONLY golden-touching track)
  wt-ip-world:     W1 W2      (items minus the 2 C1-owned rows, then mob-mechanic auras + S3)
  wt-ip-text:      T1         (de-brand prose; touches no content record)
Converge:          merge all -> regen -> Z1   (one worktree, sequential, last)
```

Each QA session pairs with its impl session inside the same track (gate before advancing).
Serialize the milestone playtests: only one live `npm run server` (`:8787`) and one Postgres
(`:5433`, `npm run db:up`) bind at a time, so run the after-V1/V2 sanity playtest and the Z1
pre-handoff playtest one worktree at a time.

## The trade-off, plainly
Parallelism buys wall-clock speed and costs the regen-reconciliation at every integration
point. Because the four tracks touch near-disjoint SOURCE files (`classes.ts` vs
`talents_classic.ts` vs `types/sim/manifest/zone` vs `items.ts` vs docs), the SOURCE merge
surface is tiny - the only real contention is the three generated artifacts, and those are
never hand-merged: the integrator re-runs `i18n:gen` + `i18n:hash --write` + `wiki:content`
after each merge and the union falls out deterministically. The bounded costs are that one
regen per merge, the two append-only registries (union, drop nothing), and the Creatures-only
id sweep (the sole golden-touching work). If you would rather minimize integration overhead
over speed, run the spine, then ONE track at a time - the briefs work identically either way,
and you regenerate once per merge regardless.
