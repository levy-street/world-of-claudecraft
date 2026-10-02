# 07a mutation pass (2026-09-30 to 2026-10-01)

The standing rule: every change to a test's guard gets a mutation check. This record covers the
guards 07a added (the global plot claim, the renewer, the claimed login read, the fenced write,
the mutation hook and its verify, the Hearth trip, the operations and their delete guards, the
D88 chain, the sim's Hearth Key seam, the monolith rows, and the guard that keeps every call of
the renewer, and every alias that could reach it, reviewed). The list itself is
[mutants.json](mutants.json): one entry per mutant, with the file, the exact source text, its
replacement, the suite (and case filter) that must kill it, whether it needs PostgreSQL, and the
guard it targets.

## How each mutant ran

A small harness (its rules below) applied one mutant at a time in a SEPARATE git worktree on
disk at the commit under test, so the main tree was never mutated while a fresh reader or a
worker was reading or testing it; PostgreSQL mutants ran against a second scratch server on
another port for the same reason. The harness itself is NOT committed: it was a session
scratch script, so this record states its rules instead, and [mutants.json](mutants.json)
carries every input it took. Re-running the pass means rebuilding a harness to these rules.
- A must-pass CONTROL first, for every distinct (suite, filter, PostgreSQL) target: the target
  must pass unmutated, or every mutant behind it is reported `CONTROL_NOT_GREEN`.
- The mutated file is verified equal to HEAD (`git diff --quiet HEAD -- <file>`) before each
  mutant; the `find` text must occur exactly once (`FIND_COUNT_n` otherwise).
- A per-run timeout of 300 s with a `HUNG` verdict.
- A run where nothing passed or failed (all skipped, a filter that matched nothing, an unarmed
  PostgreSQL suite) is `NO_TESTS_RAN`, never a kill; a suite that failed to load is
  `INVALID_LOAD`, never a kill.
- The file is restored with `git checkout` and verified equal to HEAD again, with a retry, and
  the run stops if a restore fails.
- After the pass the tree's `git status` must equal its status at the start (`TREE CLEAN`).

Fix workers also proved each NEW test decisive with the mutant a reader named, before the formal
run, restoring from a saved copy verified with `cmp` when the file under mutation was their own
uncommitted edit.

## Results

The first formal run (on `5e470b7973`, 77 mutants, 57 without PostgreSQL and 20 with) killed 70.
Seven survived: six where the guard's only test was too weak (each was predicted by the list's
builder) and one equivalent. Each weak one gained the case that kills it:
- the renewer's resume cursor after an abandon at a later chunk;
- a first insert whose claim row carries ANOTHER token than its pending one (never adopted);
- a lost first-insert race rolling the generation-1 claim back;
- the undeclared Hearth participant and the undeclared plot participant, each alone;
- an account delete through the account guard alone (an intent that names no character).

Every later fix round added the mutants for its own new guards and re-ran the WHOLE list on its
commit:

| Commit | Mutants | Killed | Survived |
|---|---|---|---|
| `5c76efb37a` | 86 | 85 | 1 (equivalent) |
| `0d5cdf8a8b` | 90 | 89 | 1 (equivalent) |
| `c35cb4b628` | 94 | 93 | 1 (equivalent) |
| `1f568eba9d` | 98 | 97 | 1 (equivalent) |
| `0544f4c38c` | 102 | 101 | 1 (equivalent) |
| `39f1b90f6d` | 104 | 103 | 1 (equivalent) |
| `ff2dde504c` | 106 | 105 | 1 (equivalent) |
| `5ae0b7177b` | 110 | 109 | 1 (equivalent) |
| `ded6b5c1ff` | 110 | 109 | 1 (equivalent) |
| `df8a30a984` | 113 | 112 | 1 (equivalent) |
| `4bc534355d` | 113 | 112 | 1 (equivalent) |
| `ecab6d2273` | 113 | 112 | 1 (equivalent) |
| `6e867c25e2` | 113 | 112 | 1 (equivalent) |
| `8bc079b051` | 131 | 130 | 1 (equivalent) |
| `c2d4963557` | 149 | 148 | 1 (equivalent) |
| `dbb59c09b1` | 156 | 155 | 1 (equivalent) |
| `efab792851` | 166 | 165 | 1 (equivalent) |
| `6fe9aa8bb0` | 177 | 176 | 1 (equivalent) |
| `ee107022e9` | 184 | 183 | 1 (equivalent) |
| `1627f1fd48` | 195 | 194 | 1 (equivalent) |
| `c7b92825dd` | 198 | 197 | 1 (equivalent) |
| `3e1c301903` | 198 | 197 | 1 (equivalent) |
| `573db94f1b` | 210 | 209 | 1 (equivalent) |
| `3c35dbada0` | 213 | 212 | 1 (equivalent) |

Every run in the table ended `TREE CLEAN`, the first part of the last one aside (below). On `4bc534355d` one control's case filter matched a renamed title,
so it ran nothing (`NO_TESTS_RAN`, never a kill); the mutant re-ran under the corrected filter and
was killed.

The pass on `3c35dbada0` ran in two parts. The host's disk filled during the first (another
process on the machine), so git could not write its index lock while the harness verified a
restore; the harness stopped there, as designed, and the file it had mutated was confirmed equal
to HEAD byte for byte. The mutation worktree was removed to free the disk, and the remaining
mutants ran on the same commit in the main checkout, behind a harness check added then that stops
before any mutation while less than 3 GiB is free.

`d38be09a9a` dropped the guard's read of `.npmrc`'s settings, which the armed
gate's malware scan blocked, and retired `r20-npmrc-node-options`, the one mutant that read
guarded (212 entries remain); two later commits reworded only that read's comments. Every
toolchain mutant (99) re-ran on the final commit, `4fddff13f0`, all killed; the rest of
the list targets code it did not touch, so the `3c35dbada0` row stands for them.

## The toolchain guard's mutants (the `r20` to `r38` entries), and `r40`

From round 20 the fix rounds were about one guard: the case that pins every mention of the renewer
by name, and its toolchain half, which keeps an alias from reaching the registry. Those rounds'
mutants change the files the guard reads (the server bundle's build script, the vite, vitest and
svelte configs and the modules vite.config.ts imports, package.json, .npmrc, the Dockerfile, the
compose file, a file outside server/) or the test's own readers and controls, and each one is a
route its round closed. Each round ran every toolchain mutant again on its own commit; the whole
list ran on the commits in the table above (a round whose successor followed before its own full
run is covered by the next row):
- Two mutants were invalid as first written and were rewritten before they counted: one imported a
  file that did not exist, so vite.config.ts failed to load and nothing ran (`NO_TESTS_RAN`); one
  wrote `server/package.json` when vite.config.ts loaded, so the worktree gained an untracked file
  (`TREE CHANGED`). The file was removed, the write now sits behind a never-set variable, and the
  whole round ran again on a clean tree.
- When a round rewrote the text a mutant targets, the mutant was re-anchored on the new text
  (`FIND_COUNT_0` is reported, never counted); when a round deleted or replaced a reader (the
  pattern readers of the Dockerfile, replaced by an exact pin; a name filter; a mode constant),
  the mutants of that reader's own code retired with it, since the code they changed no longer
  exists, and the round's own mutants took their place.
- Six routes the harness cannot express were probed by hand in the worktree and restored, each
  refused: an intent-to-add vitest config, workspace file, Containerfile, `Dockerfile-realm` and
  force-added private implementation, and an untracked `.mjs` call site under server/.

The three `r40` entries guard the two fixes the armed full suite forced: the dark-arm record in
`tests/freehold_npc_spawn.test.ts` (the Hearth Key scenario booting dark, a third scenario booting
lit) and the split vite import string (joined again, it fails `tests/vitest_setup_scope.test.ts`).

## The one survivor, and why it is equivalent

`trip-pending-unconditional-delete` deletes the Hearth trip's pending entry without comparing
the trip identity first. Single flight (one pending trip per account per process) means no
second trip of the same account can be pending when the first one's `finally` runs, so the
compare can never be observed by a test; the delete itself is pinned by
`trip-pending-never-cleared`, which every run killed. Two other equivalent shapes were left out
of the list on purpose: a double release on the late-checkout race (a resolve after a reject
does nothing; the list carries the leak form instead) and the `typeof` guard in the deadline's
clock half (`Number.isFinite` coerces nothing, so only TypeScript's narrowing needs it).
