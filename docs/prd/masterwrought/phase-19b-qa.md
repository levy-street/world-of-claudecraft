# Phase 19B QA (UI, styles and mobile: the second execution wave of the rulings gate)

VERDICT: **PASS-WITH-FINDINGS.** All seven exit criteria are met and the gate
is green, and the qualifier IS the finding: this wave shipped seven of its own
defects past green guards, including a fix that was itself a regression and a
false claim written into the permanent record, and the fresh read that criterion
3 requires then found four more false claims and two soft pins in the repair
round. The units and rulings are sound; what failed repeatedly was the prose and
the pins around them. Read the two sections below before opening 19C.

Scope: the eleven units of `phase-19b-ui.md` (D013 D028 D033 D035 D076 D077 D081
D111 D124 D166 D167), their review round, and the two fix rounds that followed.
Commit span `e056a4e0b2..HEAD`, seventeen commits.

## What the wave delivered

Eleven units, ONE commit each, ZERO escalations. Every ruling was written where
its open record actually stands (the farming handoff table, the deviation
blocks, the source comment that carries the policy) rather than into the
decision table, following the qr-19 pattern.

Only two units land executable code. D035 gives the twelve farm fine produce ids
the `Fine Material` kind line through a new `FARM_FINE_PRODUCE_ITEM_IDS` set,
deliberately separate from `FARM_MATERIAL_ITEM_IDS` and deliberately not a
`MATERIAL_GRADES` widening. D111 gives the report window a real focus trap, a
managed close, and dialog semantics. The other nine are record and comment work.

Both new exported symbols carry their census rows in `merge-deletion-list.md`.

## The wave's own instructions were wrong in fifty-one places

The phase document was verified against the tree before any byte moved, and every
unit's obligations bullet needed correction. Each is amended IN PLACE and dated,
never rewritten: **51 enumerated corrections across the eleven units** (5, 4, 5,
4, 6, 3, 4, 6, 5, 5, 4), plus three added obligations. Measured, not recalled:
count the `(N)` markers in the `AMENDED IN PLACE 2026-09-01` blocks.

The classes, with what a verbatim executor would have done:

- **All six handoff-row anchors were transcribed with their markdown table pipes
  flattened to spaces**, so `grep -cF` returned 0 rather than 1. This is the
  same defect 19A found in its own six anchors, arriving again in the next
  wave's document. A verbatim executor would have silently no-opped every
  status-cell flip.
- **Line addresses rot faster than the wave that writes them.** Eight units cite
  a line address; six were measured stale at execution (a seventh, D167, found
  both addresses in its upstream `phase-19-new-rows.md` row stale). One of
  those, D076's `(ba)` anchor, then rotted AGAIN inside this same wave, from
  :3491 at execution to :3515 at the close, which is the anchor rule arguing for
  itself as clearly as it can.
- **Three insertion anchors were unexecutable as written**, and D013's was the
  dangerous one: it prescribed a standalone dated line immediately after a
  handoff table ROW at farming/state.md:586, inside a table that runs unbroken
  from :528 to :650. A markdown table ends at its first non-pipe line, so that
  edit would have TERMINATED the table and orphaned the 64 rows below it. The
  in-cell replacement the same bullet already prescribed is the executable form,
  and farming/state.md already rules under qr-18-REOPEN that a table row cannot
  carry an inserted annotation line.
- **Five premises were falsified.** None reopened a ruling, because each failed
  for a reason unrelated to the decision: D013's "five FARM_BIOME_PALETTES rows"
  are four plus a fallback (and the same bullet contradicts itself nine lines
  later); D028's priced fix named `src/net/online.ts` for a `pendingSend` that
  does not exist anywhere under `src/net` and is live as HUD window state in two
  windows; D076's "hud.ts sits at a zero-headroom monolith ceiling" is false and
  sits inside the description of the arm the ruling REFUSES; D167's
  "hard-counting arms in auras_painter" hard-count no cap value at all; D124's
  header claim about counts was true but unpinnable.

## The real pins, and their proofs

Every new pin was mutated and watched fail ALONE, with the mutant reverted from
a disk copy (never `git checkout --`, which would take the uncommitted feature
edit with it) and the tree grepped clean of probe markers afterward.

- **D035's kind-line arm** over the twelve farm fine twins: label, tooltip text,
  and the plain `\bJunk\b` refusal. The lookbehind the older sibling arm carried
  was dropped here as a weakening (`itemKindLabel` cannot produce "Fine Junk"),
  and in the fresh-read round the sibling arm was brought into step rather than
  left as the identical hole one screen away.
- **D111's focus-trap arms**: the open-over-open transition every other arm
  skipped, a source pin on the bridge selector, a capture-ordering arm, the
  positive half of the failed-submit case, the dialog-semantics arm, and the
  own-subtree-opener arm.
- **D167's fairness arms** over the real `selectShedSlots`: a well-fed slot
  sheds, a debuff does not, an exempt id does not, exempt slots do not spend the
  budget, and a cap-zero sibling. The apex duration is DERIVED from the shipped
  catalog rather than hand-typed, and the slot's `shortDuration` is derived from
  it too, so the arm reds if the plates are ever retuned short.
- **The registry floors.** `CASE_COUNT` and `MARKUP_COUNT` were each SEVEN under
  the live count (40 against 47 cases, 38 against 45 markup ids). Both were
  re-measured by running the suite's own producers rather than trusting the
  constants.

## Reviews

Six distinct domain reviewers were dispatched FRESH, never the implementer:
`frontend-seam-reviewer`, `test-coverage-auditor`, `render-performance-reviewer`,
`architecture-reviewer`, `cross-platform-sync`, and `qa-checklist`. Every
finding was applied: blocking, should-fix and nits alike.

Two of them independently found the same D111 defect, and they were right.

## The self-inflicted defects, recorded because the guards were green through every one

This is the wave's actual story, and it is not a flattering one. The units
passed their guards, the reviewers passed the units, and the following still
shipped and had to be repaired downstream.

1. **Two real bugs in D111.** The focus bridge was minted PER OPEN. Stated
   precisely, because the shape matters more than the syntax: of the 34
   `this.windowFocus(...)` call sites in `hud.ts`, the other 33 run ONCE per Hud
   (seven as named fields, the rest as inline spreads inside field
   initializers), and this one sat inside the per-open method. A fresh closure's
   handle is always null, so `makeWindowFocus`'s own defensive
   `handle?.release(false)` was dead. And the round's own
   `markDialogRoot` created a second hazard: `role=dialog` is
   `POINTER_FOCUS_PARK_SELECTOR`, so a click inside could park focus on the
   window root, be recorded as its own opener, and send the close down
   `restoreFocus`'s in-window branch, which returns WITHOUT releasing and
   strands the trap armed over a hidden window.
2. **A FIX THAT WAS ITSELF A REGRESSION.** The repair for (1) added a
   close-before-reopen. That was wrong, not merely redundant:
   `FocusManager.restore` defers the focus by a tick, so on a re-open the return
   landed AFTER the new window was up and parked focus on the PREVIOUS opener,
   outside the window on screen, leaving the fresh trap armed but inert (its Tab
   cycle only engages once focus is already inside). The field-bridge half had
   already solved the orphaned trap on its own.
3. **A FALSE claim written into the permanent record.** The reduced-motion
   exemption was stated as an absolute: plant motion "is never gated on
   `prefers-reduced-motion` and never has been". The foliage subsystem DOES
   thread the flag, into `tree_hide_fade`'s camera-occluder ghost ramp. The
   correction sharpens the rule in both directions rather than weakening it.
4. **A vacuous assertion introduced while fixing a vacuous assertion.** The
   fairness arm compared `auraVisibleCap('ultra')` to `AURA_VISIBLE_CAP_FULL`,
   which is the very constant the function returns, and `toBeLessThan(Infinity)`
   swallows any finite value.
5. **A count repaired two lines from an identical one left open.** `CASE_COUNT`
   was re-measured while `MARKUP_COUNT`, seven under in the same way, sat
   untouched two lines below it. It was caught only because a coverage audit
   re-ran `readPanelIds` itself instead of trusting the constant.
6. **Two arm titles claiming more than their assertions proved**, including a
   cap-zero arm titled as the budget claim when at a cap of zero there is no
   budget to spend.

**The blind spot that let (2) ship.** Every arm in `tests/report_window.test.ts`
drove a FAKE bridge. A `vi.fn()` restore cannot observe a deferred focus move,
so by construction not one of them could see where focus actually lands, and the
close-before-reopen regression was green through all of them. The fix is a block
that drives the REAL `makeWindowFocus` over a REAL `FocusManager` and asserts on
`document.activeElement`, following the crafting-window precedent.

## The fresh read, and what it found

Exit criterion 3 was completed in a later session with a FRESH reader over
`git diff 914986dfe5..HEAD`, plus an independent three-slice verification sweep
with a refuter per slice. The round is commit `6733a698d7`.

It found the fix round had shipped **four more false or overstated claims and
two soft pins**, which is the same defect the round existed to repair:

- `hud.ts`'s rewritten comment said the crafting window's trap "joined at
  #2525". It landed at **#2876**; #2525 is the town-focus window's own issue,
  named three lines above in the same comment.
- The registry comment's "41 cases at the tip before this wave" is neither
  figure: the stale constant was **40** and the live switch carried **47**.
- The gate row's "fifteen CLOSED-flips, seventeen dated rows in total" measured
  neither. The bullet now writes NO count and prescribes the grep instead,
  which is also what its own sibling correction had just done to the
  `tooltip_line` header.
- The fairness doc's new binding-time sentence held for ONE of the three wind
  paths. The grass cards splice `windSway` into shader SOURCE; canopies and
  impostors bind it as the value of a uniform nothing retains, so it is not a
  live flip on any path, in either direction from what the sentence said.
- **The anti-vacuity arm was itself vacuous.** "a real CLOSE does return focus
  to the opener, so the arm above is not vacuous" never moved focus off the
  opener, because opening does not move focus (`FocusManager.open` only pushes
  trap state, `focusFirst` is an opt-in this window never takes, and
  `report_window.ts` calls `.focus()` nowhere), so the assertion read the same
  value whether the close restored anything or nothing. PROVEN both ways: with
  the focus return deleted, the old form left 6 failures and the repaired form
  makes 7.
- **The buff-bar tier pin was a fixed-width regex window** that reached past its
  own declaration into the sibling `debuffBarPainter`'s arguments, and PASSED
  the mutant that moved the call there. It slices the declaration now. This one
  was caught only because the pin was mutated after being written, which is the
  argument for the rule.

Two figures this wave's own later commits made stale were re-measured in place
rather than rewritten: `hud.ts` is 18717 against the 18728 pin (ELEVEN lines,
not the twenty D033 and D076 recorded before D111 spent some), and the `(ba)`
anchor moved from :3491 to :3515.

Two findings from the sweep were REFUTED and not applied, judged here rather
than taken on trust: `tests/tooltip_line_core.test.ts` DOES hold an importer set
(`CONSUMERS`, four modules each with the import specifier it must carry), and
the fairness fixture DOES connect its derived apex duration to the shed decision
(the slot sets `shortDuration` from it).

## Validation

- `npx tsc --noEmit`: **EXIT 0**.
- The affected suites green at the tip: report window, the close registry, the
  professions fairness suite, item kind line, tooltip line core, chrome focus
  wiring and focus manager, alongside the architecture, monolith budget and
  world_api parity guards (**633 passed across 10 files**).
- `node scripts/merge_audit/symbol_census.mjs`: **RESULT PASS, EXIT 0**, zero
  unexplained in every class. Run WITHOUT a pipe, so the exit code is real.
- `npm run ci:changed` after the LAST commit: **EXIT 0**, zero errors and zero
  format diffs (4115 warnings, which the repo does not gate on).
- The pg arm was PROVEN before the gate rather than assumed:
  `tests/account_wealth_pg_integration.test.ts` **skips 3 with the database
  vars unset and passes 3 armed**, so a wrong URL could not have shown a false
  green.
- `node scripts/gate_select.mjs` on the committed tree, pg-armed: **EXIT 0,
  PASS, all 12 steps green**. Its planner fell back to the full suite,
  correctly (mode=full over 2083 changed paths against
  `origin/release/v0.42.0`), workers 8, vitest 714.81s. Full-suite reading:
  **3667 passed / 1 skipped (3668 files), 54464 passed / 11 expected fail / 28
  skipped (54503)**. The browser regression suite ran 332 passed across 38
  files.
- The gate was run TWICE, and the second run is the one criterion 6 names. The
  first ran while this document and the ledger were still uncommitted; the
  second ran at `01fe652735` with the tree porcelain-clean before and after.
  Both read identically, so nothing here rests on a dirty tree.

### Drift, attributed in full

Against the Phase 19A stamp at ac606bcbc9 (3667 / 1 (3668) and 54435 / 11 / 28
(54474)) the file count is IDENTICAL and the case count is **+29**, every case
of which is attributable:

- **+7** from 19A's own fix round (commit 133f19560f), already recorded on that
  wave's ledger.
- **+22** from this wave, MEASURED rather than predicted: running the five test
  files 19B touches at the wave base `e056a4e0b2` registers **61** cases and at
  HEAD registers **83**. The advance estimate carried into this session was +19,
  which was three low; +22 is the measured figure and it closes the arithmetic
  exactly (54474 + 7 + 22 = 54503).
- **+0** from the fresh-read round. It rewrote assertions and titles inside
  existing arms and added no `it()`, which is confirmed by the same measurement:
  83 cases at `65bb8a2a21` and 83 at HEAD.

No new test FILE was added anywhere in the wave, which is why 3668 does not
move. The eleven R5 escalation pins stay at 11 expected fail, untouched and
never re-tuned, and the 28 skips are unchanged.

## CARRIED for the maintainer, not taken unilaterally

- **`#report-window` is not in `CHROME_GUARDED_PANELS`.** Space on a focused
  button there reaches the game layer. Every other trap-owning non-modal window
  in that family is enrolled, and D111's trap is what makes keyboard focus land
  on those buttons, so this is worth a decision rather than an omission. The
  list is pinned with `toEqual` in `tests/chrome_focus_wiring.test.ts`, so
  adding a row is a deliberate pin flip.
- **The stale-reject path has no voice on any channel.** Recorded as a shape,
  not a defect.
- **The `hud.ts` monolith row's comment still reads "Exact merged count, zero
  slack"** while eleven lines remain under the 18728 pin. `qr-19-monolith-
  ceiling-repin` falsified that phrasing in the ledger and never swept it in the
  test. Sweeping it is a maintainer call under the ratchet's own rule that a
  raise is a decision.
- **Root `src/CLAUDE.md`'s dependency-direction section** does not describe the
  `ui -> sim/content` imports the tree actually carries.

## Traps this wave hit, recorded so the next one does not

1. **Reverting a mutant with `git checkout --` wipes the uncommitted feature
   edit too**, and silently invalidates the proof. Copy the file to
   `/private/tmp` first and restore from there.
2. **A mutation that targets the wrong branch reads as a surviving pin.** Two
   did. The discriminating mutant is the one that keeps the string alive at a
   DIFFERENT site; the naive one deletes it and reds even a bad pin.
3. **`import.meta.url` is not a file URL under happy-dom.** Use `process.cwd()`.
4. **A source pin must strip comments**, or a comment quoting the line satisfies
   it.
5. **A fixed-width regex window is not a scope.** Slice to the construct's own
   terminator, or the pin reads the next declaration's body.

## Verdict, restated at the close

**PASS-WITH-FINDINGS.** Criterion by criterion:

1. Every unit executed, none escalated. **MET.**
2. Domain reviewers dispatched FRESH per unit, every finding applied. **MET**
   (six distinct reviewers).
3. The fix round re-read by a FRESH reader. **MET**, in a later session, and it
   was not a formality: it found four false or overstated claims and two soft
   pins, all applied in `6733a698d7`.
4. Every new pin mutated and watched go red. **MET**, and the discipline paid
   twice over: the buff-bar pin PASSED its first discriminating mutant and had
   to be rewritten, and the anti-vacuity arm was proven vacuous by the same
   method.
5. `tsc` clean, guards green, census RESULT PASS, `ci:changed` after the last
   commit. **MET.**
6. `gate_select.mjs` on the committed tree, pg-armed, judged by exit code.
   **MET, EXIT 0, all 12 steps.**
7. This document written and its verdict recorded before the next wave opens.
   **MET.**

The finding behind the qualifier: every defect listed above passed a green
guard, a fresh reviewer, or both. What the wave demonstrates is that a
comment-and-ledger wave is not a low-risk wave, because prose is unpinned by
construction, and that a fix round is unreviewed code with the same defect rate
as the code it repairs. The one mechanical lesson worth carrying into 19C is the
mutation rule stated sharply: a mutant that deletes the thing a pin names reds
even a bad pin. The mutant that has to be written is the one that keeps the
string alive at a DIFFERENT site.

## JUDGED, and not re-raised

- The eleven units, their rulings, and every earlier reviewer finding are
  SETTLED. This document records them; it does not reopen them.
- D013's DROP arm stays refused. Its scope was widened at execution (the asset
  manifest's channel tuples and the hand-maintained JSON), which makes the
  refused arm more expensive, not the recommendation weaker.
- D076's prescribed status-cell form is kept as prescribed even though it
  differs from the form its table's other 2026-09-01 flips use. The difference
  is deliberate and now says so.
- The `#map-window` trapless carve-out STANDS. It is the one surviving
  `NO_MANAGED_TEARDOWN` row, and its own registry row states the reasoning.
