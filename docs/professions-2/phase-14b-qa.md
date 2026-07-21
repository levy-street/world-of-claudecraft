# Phase 14b QA: Verify Commissions and the Maker's Bond

Audit the Phase 14b diff (commission opt-in, bind on first trade, the master unbind service)
for correctness, missing tests, dead code, determinism, three-host parity, and i18n
completeness, with special weight on trade-gate abuse paths and the flagged maintainer
decisions having been implemented exactly as resolved.

## QA Starter Prompt

```
This is Phase 14b QA of the Professions 2.0 feature: verify Commissions and the Maker's Bond.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 14b diff for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness, then fix what the audit finds.

STEP 0 - PRE-FLIGHT:
- Run git status; the checkout must be clean; stop if dirty with work you did not create.
- Memory scan (MEMORY.md index): node25-breaks-jsdom-gate, combo-recipes-broken-online (the
  2033 stub trap), the professions packet entries.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize: docs/professions-2/state.md (the 2026-07-20
amendments block, the three resolved decisions, the Phase 13 and 14b surfaces entries),
docs/professions-2/progress.md, docs/professions-2/phase-14b-commissions-binding.md, and
the git diff against the phase-start commit in progress.md Notes. The summary must return:
every deliverable and acceptance criterion, the marker field and deny ids as landed, the
unbind command and fee constant, the three resolved maintainer decisions verbatim, and the
validation command set.

STEP 2 - QA AUDIT (three parallel agents on the Explore summary; COVERAGE, not filtering;
resume truncated agents):

Correctness agent:
- Verify every deliverable and acceptance criterion against the real code.
- Run the phase's validation commands and record results.
- Exercise the REAL behavior offline and over a live GameServer: opt-in craft, first trade
  stamps, second trade refused with the localized line, unbind at the master for the exact
  fee, tradeable again, signer and masterwork intact throughout.
- Abuse probes (drive them, do not read them): replay/duplicate the unbind command (one fee,
  one clear); race the first trade against a concurrent trade of the same instance; a
  crafted-then-banked-then-traded piece; the bound holder equipping and using the piece
  (binding restricts onward trade only); vendor sell and buyback of a bound piece (buyback
  re-grants a plain copy today, pre-existing: confirm no NEW hole); trade the piece back to
  the crafter (per the resolved semantics); after an unbind, the NEXT trade re-binding to
  its new recipient per the resolved semantics; a mixed offer of bound and unbound copies of
  the same itemId (the Phase 3 same-itemId cross-contamination class: prove slot-accurate
  refusal).
- Verify the three maintainer decisions were implemented exactly as state.md resolved them,
  not defaulted.

Test coverage agent:
- Find untested arms: every deny path, unbind of a never-bound piece, the mail/market
  refusal pinned against the new marker, ClientWorld liveness for whatever read the UI
  consumes, save/load with and without the marker, the rollback caveat pin if state.md
  recorded one.
- Verify pins are decisive (mutation-check the gate arm: flipping the enforcement off must
  red a test).

Dead code and cleanup agent:
- Unused imports/types, sim purity, no wall-clock, no leftover debug.
- Verify the standing wire invariant: no wire command ingests a client-supplied
  ItemInstancePayload (the stamp is server-minted); the armory/identity wire still strips
  boundTo.

PHASE-SPECIFIC QA EMPHASIS:
- The trade gate is the security surface: every refusal must be server-side; a hand-crafted
  client command must not skip the stamp or the refusal.
- The legacy silent soulbound drop must be behaviorally unchanged unless state.md records a
  deliberate decision otherwise.
- Prime directive: non-commission trades are byte-identical to pre-phase behavior, pinned.
- The three RESOLVED decisions (the 2026-07-20 mastery amendments) landed exactly as
  recorded: the bond binds to the CHARACTER (not the account), only weapon / armor /
  held_offhand kinds can opt in (probe a consumable and a material: the opt-in must be
  impossible, not merely hidden), and the unbind fee ladder is 2500 / 10000 / 40000
  copper by quality tier with clamp-to-last, charged exactly once.

Multi-agent review dispatch: apply the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md over the phase diff (privacy-security-review
matches: trade/server surface), plus qa-checklist. COVERAGE, not filtering.

STEP 3 - FIX: apply every BLOCKING and SHOULD-FIX finding; rerun touched rows; commit with
explicit paths, Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY: progress.md QA row and verdict; state.md drift corrections;
memory for surprises.

STEP 5 - FINAL RESPONSE FORMAT: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts by
severity, fixed vs deferred; deferrals with reasons; a one-line handoff for the Phase 15
session (Phase 15's burn-down and SFX sweep close the packet).

STOPPING RULES:
- Stop if any abuse probe lands a bound item in another player's hands without the unbind
  service; that is a BLOCKING security finding to fix, not to document.
- Stop if a fix would require changing one of the three resolved maintainer decisions.
- Stop if the tree is dirty with work you did not create.
```
