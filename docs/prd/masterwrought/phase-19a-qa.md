# Phase 19A QA: verify the content wave

The verify twin of `phase-19a-content.md`. It re-derives what the build claimed,
records what the reviews found, and takes the verdict before 19B opens.

## Verdict

**PASS-WITH-ONE-ESCALATION**, and the qualifier is the finding, not a caveat on it.

Seventeen of eighteen units executed. One, D009+D170, is NOT executed and is
recorded as an escalation with its own ledger entry, because two of its premises
are falsified against the tree. Ten review findings, all applied. Zero blocking,
zero critical.

## What was verified, and how

### The wave's central claim, proven rather than asserted
The wave claims to be comment-and-ledger only. That is checked two independent
ways, and both agree:
- Stripping comment and blank lines from the whole diff over `src/` and
  `scripts/` leaves **zero** changed lines.
- A reviewer independently transpiled every touched file at the base and at the
  tip with `removeComments` and got **byte-identical** output for all twelve.

So no rng draw moved, no tick phase moved, no constant changed, no signature
changed, and the same-change obligation analysis (no wiki regen, no i18n key, no
M16 fill, no deed row, no Reliquary page, no art park, no census row, no parity
golden, no monolith ceiling) rests on a proven premise rather than an assumed one.

### Gates
| Check | Result |
|---|---|
| `npx tsc --noEmit` | EXIT 0 |
| architecture / monolith / world_api parity / S3 i18n / guide / deeds / reliquary / shipped ids | 850 passed, 3 skipped |
| `tests/parity` (run by a reviewer) | 262 passed, 1 skipped, draw-order digests unchanged |
| `symbol_census.mjs` (no pipe, so the exit code is real) | **RESULT PASS**, EXIT 0, zero unexplained |
| `npm run ci:changed` after the last commit | EXIT 0, zero errors, zero format diffs |
| `gate_select.mjs`, committed tree, pg-armed | **EXIT 0**, porcelain clean both sides |

The pg arm was PROVEN rather than assumed: the same suite skips 2 with the
database vars unset and passes 2 with `TEST_DATABASE_URL` set, so the recorded
wrong-URL trap (a bad URL reads exactly like an unset one) cannot have shown a
false green here.

### Drift against the Phase 18 stamp
The gate's full-suite reading is **3667 passed / 1 skipped (3668 files), 54435
passed / 11 expected fail / 28 skipped (54474)**, which is byte-identical to the
Phase 18 QA gate reading on every figure. Zero drift is the CORRECT answer for a
wave that adds no test file and no test case, not a lucky one. The nine R5
escalation pins stay at 11 expected fail, untouched.

The fix round then adds six cases across five files, so a later stamp will differ
by exactly that, by construction and attributably.

## The escalation

D009+D170's direction is confirmed: the three Brightwood Glade ids exist, ship
art, carry golden rows, are named in every locale, and sourcing them beats
minting a fourth id. Two premises are false:

1. **"No parity golden" is false.** The loot roller draws one `ctx.rng.chance`
   per plain entry and `tests/parity` pins draw order AND per-frame draw count,
   so a new row on a mob a recorded scenario kills forks the stream. Measured
   and independently re-measured by a reviewer: 25 of the 81 goldens name
   `forest_wolf`, 2 name `wild_boar`, 0 name `shore_scuttler`.
2. **The stated 13-to-16 reach is not deliverable on existing templates.**
   Neither starter zone has an antlered or feathered creature, so the antler and
   the down have no flavour-true carrier and the honest reach is 13-to-14, which
   still closes the affordance gap because the deed arm is a
   `toBeLessThanOrEqual`.

The record carries three priced shapes. **The maintainer owes the carrier
assignment and whether sixteen is wanted at all.** The drop chances are NOT
owed: the shipped ladder is 0.35 ordinary, 0.5 elite, 1 on the named quest
capstone, corrected at review from a first wording that did not discriminate.

## What the reviews found

Four domain reviewers, dispatched fresh, never the implementer. Zero blocking.
Ten findings, all applied in `133f19560f`, then re-read by a fresh reader because
fixes are unreviewed code.

**Five were claims a ruling relied on that nothing measured** (the
guard-comment-is-an-unmeasured-claim trap): the harvest-spread refusals and their
substitutes, the jewelcrafting domination argument (the load-bearing half of that
amendment, and prose-only in the one file whose stated purpose is that prose is
not quietly false), the quest fallback capacity bypass, the REF_ARMOR
percentages, and the ratified three-member hoe-only set. Each gained a pin, each
mutation-proved, each mutant reverted with the tree grepped clean.

**Five were comment or precision defects**, including one the wave itself
created: `practice_dummies.ts` asserts the dummy is not a competing definition of
the reference tank, which is exactly what D143 ratified it into being.

## Two lessons worth carrying to 19B

1. **A green suite did not catch an incomplete commit.** The D143 script crashed
   partway; eight of fifteen sites landed while the message claimed all fifteen.
   Every suite passed on the incomplete diff, because the change is comment-only.
   What caught it was reading `git status` against intent. On a comment-only
   wave, tests are not the safety net; the diff review is.
2. **The wave's own instructions were wrong in sixteen places**, including all
   six handoff-row anchors, which were transcribed without their table pipes and
   matched nothing. A verbatim executor would have silently no-opped every status
   flip and reported success. Verifying anchors BEFORE editing, rather than
   trusting the phase doc, is what turned that into an amendment instead of a
   fourteen-unit silent failure.

## Exit criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Every unit executed, or escalated with a dated reason | MET (17 executed, 1 escalated with its record) |
| 2 | Domain reviewers dispatched FRESH, all findings applied | MET (4 reviewers, 10 findings, all applied) |
| 3 | The fix round re-read by a fresh reader | MET |
| 4 | Every new pin mutated and watched go red | MET (6 pins, each proved, each mutant reverted) |
| 5 | tsc clean, guards green, census PASS, `ci:changed` after the last commit | MET |
| 6 | `gate_select.mjs` on the committed tree, judged by exit code | MET, EXIT 0 |
| 7 | This document written and its verdict recorded before 19B opens | MET |

## Carried to the maintainer

1. **D009+D170**: the carrier assignment, and whether reaching sixteen is wanted.
2. **D065 and D110** were flagged for care in the 19A brief but are units in NO
   wave doc; they remain unruled rows in the gate table. D065's derivation is
   fabricated (it cites a `componentTags` field on a template that has none) and
   D110's mount sources are maintainer values, so neither may be executed off its
   current text.
3. **The 27 `FLAGGED FOR THE MAINTAINER` banners** tree-wide. This wave retired
   only the ones its own rulings falsify; sweeping the rest is D039's class.

NEXT = Phase 19B (`phase-19b-ui.md`, FRESH session).
