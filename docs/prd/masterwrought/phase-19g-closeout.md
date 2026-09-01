# Phase 19G: Closeout

Opened 2026-09-01 under ruling qr-19-best-for-project. The two rows that cannot run inside their own wave because they consume 19F output.

**2 units, about 13.00 hours estimated.** Every row here was answered in the Phase 19 rulings gate; this phase executes, it does not re-decide. A row whose ruling turns out to rest on a wrong premise is an ESCALATION back to the ledger, never a quiet re-ruling.

## Units

### D168

> MOVED to 19G: depends on D161 and D169, which are 19F, so it cannot run inside its original wave.

Run the wholesale CI shard-weight re-harvest at go-public riding the delivery PR, re-valuing all 3651 rows off the branch's own green full-mode run and dropping the 712 carried rows, with the non-vacuity pin that the harvest would red repaired honestly in the same change.

- **Files:** `scripts/ci_shard_weights.generated.json`, `tests/ci_shard_partition.test.ts`, `docs/qa-gate.md`, `docs/prd/masterwrought/farming/state.md`, `docs/prd/masterwrought/farming/progress.md`, `scripts/ci_shard_weights_harvest.mjs`
- **Same-change obligations:** HARD PRECONDITION: a completed, all-green, FULL-MODE CI run of a PUSHED branch. This worktree is deliberately local, so the row cannot be executed before the push ruling, and the harvest must be the LAST thing that lands, after every code-carrying row in the wave plan, or the table is taken off a tree that no longer exists. SAME-CHANGE OWED: regenerate scripts/ci_shard_weights.generated.json through scripts/ci_shard_weights_harvest.mjs (never hand-edited); relax or reword the carried-set non-vacuity arm in tests/ci_shard_partition.test.ts, because a wholesale harvest writes an empty carried map and zero is not greater than zero, while KEEPING the fabrication check meaningful (the harvestedFiles plus carried identity and the carried-defects modal check must still bite), since that arm is the machine half of the gate reviewer's finding; re-read the live bars off the NEW weights (worst over median at or under 1.15, coverage), where the heal for a breach is a re-partition and NEVER a bar raise; retire the CARRIED to Phase 20 block in docs/qa-gate.md and fix the coverage-literal wording drift there (the live literal is 0.94 while the doc says 95 percent); biome check --write on the JSON only. NOT OWED: no content, i18n, wiki regen, deed, Reliquary, art, parity golden or monolith ceiling. HONEST COST: it re-baselines a repo-wide shared artifact inside a game-content PR, and the harvest commit necessarily lands after the run it was taken from. ANCHOR (grep -c = 1) in /Users/fernando/Documents/wocc-masterwrought/docs/prd/masterwrought/farming/progress.md: 'ride the neutral fallback until scripts/ci_shard_weights_harvest.mjs re-runs;'; the dated RULED line goes AFTER that sixteenth-absorb entry's last line. HANDOFF ROW in farming/state.md, match exactly: '  CI shard-weights harvest re-run at go-public (scripts/ci_shard_weights_harvest.mjs)   16th absorb   go-public session   handed-to-maintainer  '. STATUS CELL REPLACEMENT: 'handed-to-maintainer' becomes 'CLOSED 2026-09-01 by ruling qr-19-ci-shard-weights-go-public-harvest (Phase 19, under qr-19-best-for-project): the wholesale harvest rides the delivery PR after its first green full-mode run, with the carried-set non-vacuity arm repaired in the same change.'
- **Reviewers:** gate-integrity-reviewer, qa-checklist
- **Depends on:** D161, D169, D009+D170, D171
- **Estimate:** 6h

### D171

> MOVED to 19G: depends on D161 and D169, which are 19F, so it cannot run inside its original wave.

Restore the Phase 06 rung-50 scroll and elixir input parity by adding frost_gourd count 1 to recipe_sunpetal_scroll (the only reagent whose unit value lands the repair exactly), and pay the row's second half whichever way it is ruled: the pin the ledger asked for and never got, plus the two false comment clauses and the false player-facing wiki claim.

- **Files:** `src/sim/content/recipes.ts`, `tests/inscription_catalog.test.ts`, `tests/recipe_economy.test.ts`, `tests/provisioning_supply_line.test.ts`, `src/ui/i18n.catalog/guide.ts`, `src/ui/i18n.locales/ja_JP.ts`, `src/ui/i18n.locales/ko_KR.ts`, `src/ui/i18n.locales/ru_RU.ts`, `src/ui/i18n.locales/zh_CN.ts`, `src/ui/i18n.locales/zh_TW.ts`, `src/guide/content.generated.ts`, `src/ui/i18n.status.json`, `docs/prd/masterwrought/state.md`, `docs/prd/masterwrought/progress.md`
- **Same-change obligations:** MAINTAINER VALUES NEEDED: (a) the REAGENT that carries the repair, since frost_gourd at unit value 15 is the only exact-parity item in the catalog and admitting it puts the first crop on an inscription row and a farming-50 gate on a scribe's own rung, while the ink register cannot reach 15 and lands 3 copper off either way; (b) the BAND SCOPE (rung 50 alone, rung 50 plus the unrecorded 16 copper rung-25 break, or all three bands); and (c) whether the pin records the NUMBERS so a future produce insertion reds, or only the doctrine so bills may float. SAME-CHANGE OWED WHICHEVER ARM IS PICKED, because the shipped record and the shipped player copy both assert the parity as present fact: author the parity pin the ledger asked for and never got, computing both bills through the shipped reagent unit-value rule (it cannot simply live in the inscription-only suite, so either that file's scope widens by one stated exception or the arm lands beside the output-under-input sweep in tests/recipe_economy.test.ts); rewrite the 22-line standing note in tests/inscription_catalog.test.ts from an open question into the ruling and re-cut the bill literal; correct the two now-false clauses in the recipes.ts comment (the rung-25 parity claim, live 90 against 106, and the only-crafting-sink claim, now three apex flask sinks); reword the false wiki prose that tells players the batch is priced even with the elixir, which makes the five non-Latin overlay rows stale, so a wordy replacement pulls its M16 fills in-change (the 15 Latin rows are already pending, so no new pending row is minted); npm run i18n:gen. WIKI REGEN IS OWED on the repair arms only (the bill is carried verbatim in src/guide/content.generated.ts), freshness-gated by tests/guide.test.ts. ACCENT-RULE INTERACTION: the repair puts a crop on a non-cooking, non-alchemy row, which the RULE 2 accent sweep's filter does not govern; the row clears both readings on the numbers, but leaving the filter unwidened silently exempts a shipped crop placement from the rule D004 settles, and the touched-rows profession assertion moves if the row joins. NOT OWED: no new item id, so no art, no ITEM_ART_PENDING or art-audit re-mint, no deed, no Reliquary page, no shipped-id golden, no census row, no world_api parity or golden, no monolith ceiling. R5: r5Surface is true but the recommended arm does NOT move the frozen record; only the all-bands arm edits an input to power-verification section 12.2 and that is the R5 escalation, which stays refused while R5 is frozen. REGEN ORDERING: batch the i18n regen with D161 and D169 or land after them. ANCHOR (grep -c = 1) in /Users/fernando/Documents/wocc-masterwrought/docs/prd/masterwrought/state.md: 'THE SUNPETAL SCROLL / SERPENT ELIXIR PARITY IS NOW BROKEN'; the dated RULED line goes AFTER that finding block's last line. NO handoff table row: this is a seeded row 3 member and its open text lives in state.md prose plus a progress.md open line, both of which take the ruling id.
- **Reviewers:** content-obligations-reviewer, frontend-seam-reviewer, test-coverage-auditor, qa-checklist
- **Depends on:** D161, D169
- **Estimate:** 7h

## Exit criteria

1. Every unit above executed, or escalated with a dated reason.
2. Each unit's domain reviewers dispatched FRESH (never the implementer), all findings applied: blocking, should-fix and nits alike.
3. The fix round re-read by a fresh reader, because fixes are unreviewed code.
4. Every new pin mutated and watched go red. A pin that survives its own mutation is not a pin.
5. `npx tsc --noEmit` clean, the architecture, monolith and parity guards green, the census RESULT PASS, `npm run ci:changed` after the LAST commit.
6. `node scripts/gate_select.mjs` on the COMMITTED tree, pg-armed, judged by exit code.
7. `docs/prd/masterwrought/phase-19g-qa.md` written and its verdict recorded before the next wave opens.

## Standing rules

NO push, NO PR, NO teardown. Local only. A green gate is not consent.
