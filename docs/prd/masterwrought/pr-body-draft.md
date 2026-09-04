# PR title

feat(professions): Masterwrought endgame crafting and the farming profession

Target branch: release/v0.42.0

## Summary

One system, two halves, one branch. Masterwrought gives all ten crafting
professions an equal-shape endgame: one intermediate at skill 75, three apex
products at skill 100, and one capstone role at skill 125, capped by the
"Unique-Equipped: Masterwrought (2)" tag. Above the raid band sits the
Perfecting stage (R1: Maker's Ember, Sundered Essence and a Prismglass Setting
per attempt, fail-forward, binds on begin), and above that the orange
promotion: a Perfected apex copy plus a Deed of Making and a server-screened
player-chosen name promotes deterministically to a legendary-quality copy that
is prestige and process only (R3: no unique combat effects, at most one
equipped inside the global cap).

The farming packet is absorbed whole (ruling 11b-D-3): farming ships as the
fifth gathering profession, fishing-shaped, wall-clock grown, and deliberately
anti-chore (at most two visits per growth cycle, nothing rots, absence is never
punished, risk is opt-in, the Harvest Journal is honest). Five gathering
professions and ten crafts ship as one economy: the provisioner rule (R17), the
demand engine (R18 and R21), no geographically trapped material (R22), and the
vendor floor (R23) are all enforced by tests, not prose.

Design authority: docs/prd/masterwrought/ (state.md carries rulings R1 to R23
and every ledger) and docs/prd/masterwrought/farming/ (decisions D1 to D24,
deviations (a) through (ca), and the 128-row handoff table). The decisions index
at docs/prd/masterwrought/decisions-index.md maps the namespaces. Packet
teardown is deliberately CUT from this pull request (ip-17-TEARDOWN): the
planning docs are the review evidence for work this size, and teardown is a
recorded post-merge chore over both trees as one decision. Two records were
promoted out of the packet so live tests survive that teardown:
docs/design/naming-audit.md (the R15 web-verified IP verdicts) and
docs/design/power-verification.md (the R5 record).

The wire ships behind a new world-layout auth epoch (auth-world-12): equipped
instances carry required Perfecting fields and the self wire carries the farm
plot delta, so mixed-release binaries fail closed in both directions before a
character loads.

## The R5 power story, stated honestly

R5 (full kit at most 5 percent total throughput over pre-packet raid BiS) is
CLOSED BY RULING, settled by ratification rather than by a demonstrated bound.
The four ratified rulings (2026-08-29) are recorded verbatim in state.md and the
ratified quantity table is re-cut from the committed harness
(scripts/r5_envelope_probe.ts) at the closure tip, every cell byte-reproducible.
Two ratified caveats frame the numbers: the percentages are FLOORS that exclude
apex rating deltas, and they are measured against the ratified raw-stat-sum
baseline pool, which the record states runs roughly 3 percent under a
hand-optimised kit on the physical lanes. The binding fury lane's tightest
committed estimate (300 seeds, 600 seconds) reads +5.06 and +5.24 percent, at
the line; the equipped-kit measurement the modelled term omits, roughly twice
the envelope on that lane, is kept on the record as part of the acceptance. Four
downward content tunes landed before closure; the pre-tune fixtures read outside
the envelope. Full record: docs/design/power-verification.md (Verdict).

## The public wiki, read whole against the game

The guide's hand-written prose (1,832 rendered keys, about 53,000 words over 39
page modules) had been corrected key by key whenever a change moved a fact, and
was never read whole against the game as it stands. It has been now: two
independent readers per surface classified 7,059 claims against the live tables,
and every non-true claim went to an adversarial refuter that could not refute
763 of them. The audit's own record is
docs/prd/masterwrought/phase-20-wiki-audit-findings.md, one row per verified
finding with the file and symbol that settles it.

The prose held in the large (6,450 of 7,059 claims true, and 123 findings were
overturned by the refuters). The failures cluster structurally rather than
scattering: a section shared with pages it is not true of, prose that predates a
tier that shipped, enumerations the game outgrew, and interface prose describing
controls that are no longer there.

What this branch corrects, on the maintainer's ruling, is the worst class, where
a player would act wrongly on what the page says. Sixteen such keys are
corrected here (the farming page's own rhythm, gain and yield prose, plus the
arena, social and interface pages); the remaining keys of that class and every
lower-severity finding carry to a follow-up lane with the findings file as its
worklist. One consequence to know about: the interface page's rail prose is one
of the keys left for that lane, so it still lists a seasonal event the corrected
mobile prose on the same page no longer names.

Each correction retires its key and re-keys the successor, so the predecessor
keeps the reviewed translations it already had, and each is pinned per clause in
tests/guide.test.ts against the live table rather than against a restated
number, with the old false clause asserted absent from the rendered page.

One defect the audit could not see was found while re-deriving its numbers and
repaired first: the guide's paragraph splitter breaks on real newlines, and two
English values plus eighteen locale rows spelled the two characters backslash
and n in their source, so the live page rendered that text inside a paragraph.

## Related issues

Part of the Masterwrought endgame-crafting program (no tracking issue; the
program's design docs are in-tree).

## Type of change

- [x] Feature: new functionality
- [x] Breaking change (the world-layout auth epoch moves to 12: older clients
      and servers refuse each other cleanly before a character loads)

## What is left for others, deliberately

- **The release-tier locale fill.** Contributors add English; the maintainer
  fills every locale at release, and that pass is NOT in this branch. The
  registry carries 14,545 pending rows over 957 keys (main, sim and admin), and
  beside it sits the part the pending count cannot see: the reword-staleness
  set (113 semantic keys whose English moved while their translations did not,
  judged key by key), the deed and reliquary chunk families the registry never
  reads (652 missing deed rows over 21 ids), the older rename wave's 58 stale
  calques, and the per-locale register passes. All of it is derived, not
  remembered, and recorded by class in
  docs/prd/masterwrought/phase-20-fill-package.md, which is that pass's
  worklist. The branch pays only what the pull-request tier enforces: every new
  wordy English key ships with its five non-Latin fills (M16), and those fills
  are machine-authored, flagged as such, and anchored whole in
  tests/guide_wiki_audit_fills.ts so re-cutting one moves its anchor.
- **The rest of the wiki corrections.** 71 further keys of the worst class were
  drafted in full (corrected English, page edits, pins, census rows) and left
  out because they had not passed the adversarial verification this branch
  requires before a correction lands; 332 lower-severity keys were never opened.
  The findings file carries the evidence for all of them.
- **Three map layers the prose does not name** (the castle plans, the route
  badges, the ally markers), recorded in the pin that walks the draw model
  rather than passed over, because naming them moves the English and its fills.
- **Two Korean rows outside these corrections** that carry English item names
  the same way the corrected one did, folded into the fill lane.

## How was this tested?

- Commands:
  - `node scripts/gate_select.mjs` on the committed tree, with the Postgres
    suites armed against the dev database: PASS, judged by the gate's own exit
    line rather than the wrapper's.
  - Per correction: the i18n and wiki regenerations, the changed-files
    formatter, a whole-tree typecheck, the guide and i18n guard suites
    (tests/guide.test.ts, guide_key_coverage, i18n_completeness with its M16
    arm, localization_fixes, i18n_status_registry, i18n_resolved_equivalence)
    and the export-and-symbol census, with every regenerated artifact committed
    in the same commit as its source.
  - The export-and-symbol census as a delivery gate: RESULT PASS, every extra
    explained by a committed row.
  - A fresh reader over the correction commits, treating them as unreviewed
    code: six findings, all applied, none blocking. Two were assertions that
    could not fail, which is why the finder rule the prose publishes now has a
    test that drives a real party and was proved to fail without the behavior.
  - Earlier closes carry their own recorded stamps: the full gate pg-armed
    (3,670 test files, 54,550 cases), the frozen bounded suite stamp with its
    drift attributed exactly, and the union QA matrix.
- Manual steps: the crafting and polish screenshot tours (desktop and mobile),
  the farming journey end-to-end script, the real-GPU performance tour, and the
  market chip before and after capture at the live merchant.

## Screenshots / recordings

Committed under docs/screenshots and referenced here (the two subtrees):

- Masterwrought: masterwrought-phase06-tomes/, masterwrought-phase07/,
  masterwrought-phase08-qa/, masterwrought-phase10-qa/, masterwrought-phase-14/
  (the crafting UX pass, 20 shots including mobile), masterwrought-phase-16/
  (the polish pass, 15 shots including the performance-tour evidence),
  masterwrought-phase-17/ (the market browse category before and after, desktop
  and mobile), masterwrought-phase-19e/ (the celebration fan-out evidence).
- Farming: farming/ plus farming-phase-01/05/07/08/09/09b/12/13 (world
  presence, render and juice, Harvest Journal, celebrations, integration
  polish).

---

## Checklist

### Quality

- [x] **The gate passes.** node scripts/gate_select.mjs green on the committed
      tree with the Postgres suites armed; the deeper full-gate and frozen-stamp
      readings from the closing waves are recorded in state.md.

### Cross-platform

- [x] **Tested on desktop and mobile.** The capture sets cover both form
      factors; the 44px touch-target floors are pinned in the browser suite.
- [x] **Accessible.** Keyboard paths, focus, aria and reduced motion are pinned
      by the window suites (the reduced-motion regalia gate included).

### Localization (i18n)

- [x] **New player-visible strings follow the contributor policy.** English
      catalogs plus the required non-Latin fills (M16); the release-tier fill of
      every locale is deliberately left to the maintainer and its worklist is
      committed.
- [x] Numbers, money, dates through the i18n formatters.
- [x] Sim and server player text is re-localized at the client boundary
      (tests/localization_fixes.test.ts, the S3 guard).

### Hygiene

- [x] No secrets, credentials or .env committed; ALLOW_DEV_COMMANDS untouched.
- [x] No hand-edited generated files; all artifacts regenerated by their owning
      build steps and committed with their sources.
