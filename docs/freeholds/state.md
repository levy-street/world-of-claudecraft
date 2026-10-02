# Freeholds and Guildhalls: cross-phase state

Only what the next session needs. Update at the end of every phase and QA.

## Worktree, base, and merge-forward
- Worktree: `/Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds`
- Branch: `feature/freeholds` (LOCAL; see "Push policy").
- Base at packet creation (2026-09-05): the head of open PR #3872
  (`origin/feature/masterwrought` at `0f53c92ff7`, Masterwrought crafting and Farming,
  itself based on `release/v0.42.0`). The packet tip carries three cherry-picked docs
  commits (the proposal, the deck and index, the feature-plan skill refresh) on top.
- Current sync (2026-09-08, the 06 implementation): PR #3872 is MERGED at
  `6111e6d206`. Fetched with prune and integrated the newest release,
  `origin/release/v0.42.0` at `57a2ced3bd`, in local merge `6540713541`.
  Seventeen conflicts were reconciled, followed by a release-merge audit and a
  fresh review of its fixes. The reserved quartermaster explains the lit roster
  fingerprint change; excluding only that addition reproduces the previous roster.
  No patch, package or lockfile changed in this sync. Existing shard timing carries
  were preserved; the final new-test harvest belongs to this contribution's gate.
  Earlier syncs `a461924855` and `7f4fe99619` remain historical receipts. Future
  starts fetch with prune and merge the newest `origin/release/**`, then audit any
  non-empty merge. Nothing has been pushed.
- Current sync (2026-09-10, round seventeen): `origin/release/v0.43.0` at
  `b276778485`, in local merge `d5e7f423c7`. That merge was made by an earlier
  session, recorded in no packet document, and NEVER GATED: it left
  `tests/freehold_capture_contract.test.ts` red on three stale source digests.
  Audited at round seventeen and otherwise clean. The newest release branch is
  the version-newest one, which is what `resolveSelectBase` sorts by, so
  `v0.42.1` and `v0.42.2` are later in TIME and are not the integration base.
- Current sync (2026-09-22 to 23, closed): `origin/release/v0.44.0` at `56525e0343` in
  merge `ffa7ac5ffb`, then again at `fc86d90234` (the craft-roll audit) in merge
  `190329610f`, both audited. Everything they left owed is done and recorded in
  [the ledger](qa/persistence-2026-09-08/findings.md), THE OWED LIST WORKED THROUGH.
  Nothing has been pushed.
- Current sync (2026-09-30, the 07a start, closed): `origin/release/v0.45.0` at `55de7ffe92`
  (still the version-newest release branch; three commits past the Part 4 sync at
  `ac9ed4db24`) in merge `0008427d14`: the host-diag manifest's `-text` attribute in
  `.gitattributes` and its pin in `tests/host_diag_bundle.test.ts` (47 of 47 green). No
  conflict, no branch-owned file, patch or lockfile touched; the release-merge audit found no
  overlap, divergence, route, re-bound helper or moved premise. The Linux checkout
  `/home/fernando/Documents/world-of-claudecraft` carries the branch directly; read the Mac
  worktree path above as that path on this host.
- Current sync (2026-09-26, third, closed): `origin/release/v0.44.0` at `aaff789813`
  (267 commits: world quests round 2, the faction ladder, the trinket slot, the Weekly
  Vault, Clue Scrolls, vehicles and the glider) in merge `dd7f954501`: 63 conflicts by hand,
  the world-object bootstrap double extraction collapsed onto the release's
  `ground_object_spawns.ts`, audited by four lanes, the premises it moved recorded below as
  G8 to G14. Recorded in [the ledger](qa/persistence-2026-09-08/findings.md), FERNANDO'S RULINGS OF 2026-09-26, AND THE SYNC OF
  RELEASE/V0.44.0 AT AAFF789813. Nothing has been pushed.
- Earlier sync (2026-09-26, second, closed): `origin/release/v0.44.0` at `09639d4ae9`
  (548 commits: the Eastbrook ferry, the Wanted board, custom guild ranks, partial buys,
  the market History tab) in merge `8a330b3489`: 43 conflicts by hand against both
  parents, audited by four lanes, twelve sealed capture inputs re-hashed on a probe
  (`284adcb7be`), the premises it moved recorded below as G1 to G7. Recorded in [the
  ledger](qa/persistence-2026-09-08/findings.md), RULING (B) FINISHED, AND 07
  RE-JUDGED. Nothing has been pushed.
- Earlier sync (2026-09-26, closed): `origin/release/v0.44.0` at `9dbc47938a` (the floor
  VFX ladder) in merge `b627c4ad32`: six provenance conflicts re-minted, audited, two
  sealed capture inputs re-hashed on a probe (`75bc308552`). Recorded in [the
  ledger](qa/persistence-2026-09-08/findings.md), RULING (B) FOR THE TWELFTH PATH, THE
  SYNC FIRST. Nothing has been pushed.
- Earlier sync (2026-09-25, closed): `origin/release/v0.44.0` at `ed69f62ef7` (still the
  version-newest release branch) in merge `484cb61a46`: 120 commits, 64 conflicts by hand,
  audited by four lanes and read fresh three times. Recorded in
  [the ledger](qa/persistence-2026-09-08/findings.md), THE RE-SYNC OF RELEASE/V0.44.0 AT
  ED69F62EF7. Nothing has been pushed.
- Push policy: the branch stays local until Fernando says to push. Pushes go to `origin`,
  never a fork. A PR is opened only by a wave close phase (20, 27, 33, 39 and 44: one PR
  per wave under D12, owned for every wave), after the whole-feature matrix, and only
  after the push is sanctioned; each close STOPS and asks for the push go and otherwise
  ends local at "matrix green, awaiting push go" (D87). Every close and its QA end in one
  of two states, "pushed, green, ready for review" or "matrix green, awaiting push go";
  the QA records PASS, awaiting publication, when no go is recorded. Never merge a PR
  from a session.

## Current phase

**07a, TRANSACTIONAL MUTATIONS AND GLOBAL CLAIM FENCING, BUILT 2026-09-30 TO 10-01, PUSHED.** Fernando
ruled both Step 0 questions as recommended ("Light it (Recommended)": the remote Hearth Key is lit on
a lit realm through the new boundary; "Push after the gate (Recommended)"). Sync `0008427d14`
(release/v0.45.0 at `55de7ffe92`). The manifest first (`mutation-touch-set-manifest.md`, revision 5),
then built test-first: the global plot claim (a lease plus a monotonic fencing generation), the fenced
write, the claimed login read, the renewer on the autosave cadence, the mutation hook with its
ambiguous-COMMIT verify, the lit Hearth trip, operations with their D88 delete guards. Seven domain
reviewers and the qa-checklist, then forty-three fix rounds, each read fresh, until reads came back
without a should-fix; 212 mutants over the new guards, 211 killed and one equivalent; the armed gate green on all 12 steps at `4fddff13f0` (74,463 tests, browser 550). Production
stays disabled behind `FREEHOLDS_ENABLED`. OWED: the paired QA (`phase-07a-qa.md`, a fresh session),
residuals R-1 to R-9, the first-kind tripwires, the quiet-window rollout. Detail:
[the ledger](qa/persistence-2026-09-08/findings.md), 07a.

(Superseded 2026-10-01 by the paragraph above: 07a is built.)
**PART 5 FOLLOW-UP, THE OWED DECISIONS, SETTLED 2026-09-30, PUSHED.** Fernando delegated them
("do whats best for the project and feature"). The ratchet now harvests in runner-calibrated time
(five calibrated runs: the shard pool's run-to-run spread 1.249 raw to 1.069, the lane's 1.384 to
1.064), so the lane shares the shard band again and its raise is gone; the collider grid lever is
a measured no-go; the RL env's unbounded per-seed caches (about 3 MB per episode seed) are released
by the env; Fleetmend refuses at no cost with nothing to consume; Groveheart's capstones are pinned
by mechanic (a test gap, not a bug); the browser jobs' font fallback no longer races a leftover
package install. Detail: `qa/test-cost-2026-09-29/decisions-2026-09-30.md` and the ledger's
PART 5, "THE OWED DECISIONS".

(Superseded 2026-09-30 by the paragraph above: the owed decisions are settled.)
**PART 5, TEST COST AND TEST VALUE, DONE 2026-09-29, PUSHED.** Every ruled target is met on green
full-mode CI: the summed PR shard test step 115.73 min to 73.05 min (36.9 percent down; the bar
was 25), the slowest shard job 24.0 min to 13.40 min (44.2 percent down; the bar was 30), and the
nightly 3 h 28 min to 50.5 minutes (the bar was 2.5 h). The cuts: lazy locale slices and daily world
quest catalogs (import 22.9 percent down), 465 unreferenced evidence screenshots and 85 capture
scripts gone, the balance probes on the shipped idle cull (the lane pool 88.6 percent down, lane
jobs about 12 minutes to 4), the nightly sharded two ways, and three slimming rounds over about
1,000 suites (scoped worlds, one seed per file, forced rolls, sweeps whole only at nightly depth),
each change carrying a mutant; the shard weight pool fell 49 percent over three harvests. The
rounds' mutants found about 50 tests that claimed a guard they did not hold, now fixed. A
total-CI-time ratchet and a new-test admission rule (a `Guards:` statement and a measured `Cost:`
field) hold the gains. Three workers per shard did not pay (reverted). Six rulings, recorded
verbatim. The armed gate green on all 12 steps at `f401981a04` (74,020 tests, browser 550).
OWED: confirm the lane ratchet band (a calibration raise from measured runner noise), the
collider grid build as the next test-time lever (a product change), the product questions the
tests surfaced, the release-gate re-derivation. Detail: [the ledger](qa/persistence-2026-09-08/findings.md),
PART 5, and `qa/test-cost-2026-09-29/`.

(Superseded 2026-09-29 by the paragraph above: Part 5 is done.)
**PART 5, TEST COST AND TEST VALUE, PAUSED 2026-09-29 AT FERNANDO'S REQUEST, PUSHED.** Fernando
ruled the three Step 0 questions as recommended (targets: the slowest PR shard job wall at least
30 percent down, the summed shard test steps at least 25 percent, the nightly under 2.5 h;
pr-gate stays 49; unreferenced evidence screenshots may be deleted). Phase 1 measured and
committed the per-file series; phase 2 judged every heavy or suspect suite through nine cluster
agents, seven fresh reviewers and six fresh reads of the fix rounds (local test bodies 26.7
percent down, 4,985.75 s to 3,653.82 s); phase 3's import cuts landed (the locale re-export out
of `src/ui/i18n.ts`, lazy daily world quest catalogs) with their QA still owed. Phases 4 to 6
and the close are not started. Detail and the owed list in order:
[the ledger](qa/persistence-2026-09-08/findings.md), PART 5, "STATUS AT THE PAUSE"; the
measured record in `qa/test-cost-2026-09-29/`.

(Superseded 2026-09-29 by the paragraph above: Part 5 is in progress.)
**PART 4, THE RELEASE/V0.45.0 SYNC AND THE FIRST CI RUNS, DONE 2026-09-28, PUSHED.** Fernando
ruled all four Step 0 questions as recommended (push; drop the exact GLB sha pins; re-scope the
CI cone with a guard; end the pet feed mode) and "Push the branch as is" when told the branch
carries counsel-bound drafts. Merge `555d16f445` takes `release/v0.45.0` at `ac9ed4db24` (179
commits, 96 conflicts by hand, four audit lanes). Step 3 landed: the five flat HUD modules behind
`hud/` barrels, the Crucible confirm in `hud/vendor/`, the capture receipt's success path
reached, the feed mode ending with its pet. Step 2 is blocked: the production host refuses this
machine's key, so nothing was deleted. The branch's first CI runs found and fixed a one-ulp
arm64 against x64 spawn height, re-derived the lane bound (28 to 36) and pr-gate's (37 to 49),
harvested every shard weight (splitting two files the harvest put over the 90-second rule), and
the first nightly exposed the eight-seed druid arm overrunning one case, now one case per seed.
Every change had fresh reads round by round until a round came back without a should-fix.
After the Part 4 commit, CI caught a latent happy-dom flake (the portrait chip's GLB fetches
outliving teardown in three suites), now stubbed and pinned; fifteen read rounds on that pin
turned up two holes in the declared-timeout ratchet's scanner, one of which had hidden a real
120-second case (its exact row corrected from 330,000 to 450,000), and the release's #2514
harvest sweep and a Groveheart case, each at the edge of its 20 s default on the release's
own runs, got 60 s. 226 mutants ran: 224 killed, 2 equivalent (an equivalent read, unified; and the
selective gate's own blind spot for a side-effect-only helper import, recorded for its
owner). The armed gate is green on all 12 steps at `e57856af25` (73,987 tests, browser 554),
and CI run 36493201427 was fully green in full mode there. The final nightly ran the
eight-seed druid arm green (all eight seeds, 347 to 407 s each); its only red left is the
release-owned druid band. OWED:
the production palette read, the vacuous CI lint job (found here, repo-wide), pr-gate (a
ruling on one slow-checkout wall) and release-gate re-derivations, and the release-owned list.
Detail: [the ledger](qa/persistence-2026-09-08/findings.md), PART 4.

(Superseded 2026-09-28 by the paragraph above: Part 4 is done.)
**PART 3, UNUSED ASSETS AND TEST NECESSITY, DONE 2026-09-27, LOCAL.** Fernando ruled that every
screenshot and GLB test must earn its place and that anything with no use at all be deleted.
Screenshots: browser suites capture only under `VITE_EVIDENCE_CAPTURE=1`, the evidence
byte-seals are gone, and 411 unreferenced directories plus 67 files were pruned (tracked corpus
2.5 GB to about 1.27 GB). GLBs and assets: the Eastbrook polish seal and its re-mint scripts
retired, the lockfile out of every GLB fingerprint (48 GLBs re-stamped once), the retired
Rallycart's model, audio and vehicle code and six replaced wreckage GLBs deleted (1,416 GLBs to
1,409). The HUD import: nine extraction batches took `src/ui/hud.ts` from 18,045 to 14,883
lines and its runtime importers under `tests/` from 49 to 3, with two player-facing fixes found
on the way (the emote wheel's hit zones under a UI scale, the craft plate queued as a
celebration). Every batch had a frontend seam review and every round of fixes a fresh read;
nothing blocking; all findings applied or recorded; 39 mutants killed; the armed gate is green
on all 12 steps at the code tip `206720229b` (72,939 tests, browser 541). OWED: 490 GLBs listed
only by the editor palette wait on a production read of the editor maps (the SQL and the list
are in the ledger); the Part 2 CI items still stand. Detail: [the
ledger](qa/persistence-2026-09-08/findings.md), PART 3, UNUSED ASSETS AND TEST NECESSITY.

(Superseded 2026-09-27 by the paragraph above: Part 3 is done.)
**PART 2, THE REPO-WIDE TEST COST, DONE 2026-09-27, LOCAL.** Every item of the brief landed on
this branch in order, each measured before and after (the table is in the ledger): the
`@vitest/spy` retention patch and `releasedSpyOn`, the Svelte setup scoped out of the global
setup, the 2 GiB worker cap and one host sizing module, the lane and its seed diets, the local
lane opt-in (every gate leg opts in), parity recording twice, the SFX fixture root, the merged
`anim_pipeline`, the splits, the approved deletions with coverage proofs, and the durable guard
(`tests/suite_lane_threshold.test.ts` on every PR, `npm run test:memory` nightly, the rules in
root and tests `CLAUDE.md`, `docs/qa-gate.md` and two agents). Three reviewers and nine fresh
reads found nothing blocking; the first final gate caught one regression (the lane spread
failed `tests/vite_dev_watch.test.ts` at load), fixed and hardened; 128 mutants are killed; the
armed gate is green on all 12 steps at `c2e49691be` (72,917 tests, browser 541; the full run
946.50 to 856.75 s). OWED, not closable locally: one green CI run under the heap cap and one
nightly with the eight-seed druid arm before this is pushed, the lane bound re-derived from the
first full-mode lane walls, the next harvest replacing the carried weight rows, and the
upstream `@vitest/spy` issue (drafted; Fernando's call). The 07 PASS below stands. NEXT: the
HUD-import cost (44 test files import `src/ui/hud`), if Fernando wants it. Detail: [the
ledger](qa/persistence-2026-09-08/findings.md), PART 2, THE REPO-WIDE TEST COST.

(Superseded 2026-09-27 by the paragraph above: Part 2 is done.)
**07 RE-JUDGED PASS, 2026-09-27, LOCAL: R1 IS BUILT, REVIEWED AND GATED.** A thrown run of
writes no longer quiesces an owner and drops its edits: a fault puts the owner on a per-owner
retry clock (`server/freehold_write_retry.ts`) that keeps its capture, offers it to a
rejoin, retries at most once per window inside a two-slot sub-cap, and clears on a commit;
a throw about the document (the branded `FreeholdUpsertRefused`, a payload SQLSTATE) still
quiesces. The memory it holds is measured (180 MiB per thousand offline owners at the
ceiling) and published (`retrying`, `retrying_offline`, `deferred_retries`,
`write_retries`). Seven reviewers and three fresh reads found nothing blocking, 36 mutants
are killed, the STEP 3 trim of the persistence suite is proven pair by pair, and the armed
gate is green on all 12 steps at `3167e0cbbc`. The two named gates stay: the cross-realm
fence (R2, 07a's activation gate, which now also names the self-fence after an ambiguous
commit) and the shutdown drain's deadline (R3). The 2026-09-27 ruling's three items landed
first: G8 resolved (the caravan's third wave moved to waypoint 6), the emissary pool held to
wearable kinds (odds recorded for the release owner), the cannon leave-order pin. NEXT: Part
2, the repo-wide test cost work, on this branch. Detail: [the ledger](qa/persistence-2026-09-08/findings.md),
R1, THE THROWN-RUN RETRY POSTURE, through STEP 6.

(Superseded 2026-09-27 by the paragraph above: R1 is built and 07 re-judged PASS.)
**FERNANDO RULED ON THE SYNC'S OPEN DECISIONS, 2026-09-27 ("let's do what's best for the
project and feature for all of those."), AND RELEASE/V0.44.0 AT `3bdb537657` IS SYNCED
(`60cd9f859a`, the release's locale fill).** The ruling, recorded verbatim in the ledger:
the character blob warning stays at 262,144 (`51d9e2b124`); G8 is resolved by the option
best for the feature, on evidence (recommended: keep the gate and the friendly caravan,
keep every hostile ambush spawn out of the gate's 12 yd ring and away from the leave drop);
the emissary cache pool is restricted to weapon, armor and held_offhand; the manned-cannon
leave-order test is written. NEXT: those three, test-first; then Part 1 from STEP 2 (the R1
design, the build, the trims, reviewers, the armed gate, the 07 re-judgement); then Part 2.
The ordered list is the ledger's STILL OPEN.

(Superseded 2026-09-27 by the paragraph above: the confirmation and G8 are ruled.)
**FERNANDO RULED ON 07 AND THE TEST AUDIT, 2026-09-26 ("Let's go with all your
recommendations." and "Let's keep it all on this branch."), AND RELEASE/V0.44.0 AT
`aaff789813` IS SYNCED; 07 STAYS FAIL UNTIL R1 IS BUILT.** The rulings, recorded verbatim in
the ledger: R1 keep a leaver's capture past a THROWN-run quiesce (kept, write-blocked,
retried once per error window, released only on a commit or an answer no repeat can change,
installed by a rejoin, counted under `leave_captures`); R2 the cross-realm fence carried to
07a as a named activation gate; R3 the shutdown drain's 10 s deadline accepted; R4 (G3)
`dev:` titles excluded from trophy sources; R5 every recommendation of the test-suite audit,
the `@vitest/spy` patch included, the listed deletions approved each after a coverage proof;
G1 and G2 still owed; and a standing rule that test wall time and memory are guarded. The
sync: merge `dd7f954501` plus its integration fixes (the character blob warning re-minted to
262,144 by its own rule, the branch suites re-pinned on release-measured values, the
`freehold_claim` golden, the audit's fixes including `busy` entry refusals under the
release's four action locks). NEXT, in a FRESH session: Part 1 from STEP 2 (write the R1
design into the ledger, then build it test-first), then the audit trims, reviewers, the
armed gate and the 07 re-judgement; then Part 2, the repo-wide test cost work. The capture
set was re-shot at `e89b62487c` (`a9060dbf0e`), the armed full suite is green (0 failed) and
131 shard rows are carried (`dbae472b24`). Owed there: the manned-cannon leave-order test,
Fernando's confirmation of the 262,144 blob warning, and ruling G8 (the caravan route)
before housing lights. The ordered list is the ledger's STILL OPEN.

**RULING (B) IS FINISHED AND 07 IS RE-JUDGED, 2026-09-26, LOCAL: THE TWELFTH PATH IS
CLOSED, AND 07 STAYS FAIL ON THREE PRE-EXISTING CAPTURE-LOSS ORDERS, A RULING OWED.** A
second sync came first (merge `8a330b3489`, `release/v0.44.0` at `09639d4ae9`, audited,
premises G1 to G7 recorded below). Then the owed list: the three targeted mutants, the four
docs (`fb1de750cb`), five reviewers (one blocking, fixed as ONE housing budget per
handshake in `59a9bfd1b5`), the shard carry, six fresh reads to nothing blocking, 44
mutants (43 killed, one recorded survivor), and the armed gate green on all 12 steps at
`ec2d4be98d` and again at `a1fb50db45`. The re-judgement: only genuine absence resolves to the
tier-0 Inn Room and no committed edit is lost, but a captured edit is still lost, loudly
and keeping the row, in three orders ruling (b) did not touch: a run of thrown writes
quiesces a leaver's entry, another realm's commit fences a leave write stale, and the
shutdown drain's deadline ends owed captures with the process. The first two are pinned as
KNOWN COST (`e43478015c`). THE RULING OWED (Fernando): keep a capture past a thrown-run
quiesce and retry it once per error window (recommended), or accept the run as the
bounded-retry cost; carry the cross-realm fence to 07a as the contract plans; accept the
drain's deadline as the orderly exit's bound. Open, in order: (1) that ruling; (2) the
test-suite audit's ranked findings, with Fernando; (3) `Sim.addPlayer` atomicity, now
also over the restore path's `loadGatheringSettings`; (4) D85 (a ruling); (5) the phase 17
re-plan with the trophy-source ruling (G3); (6) G1 before 28 and G2 when housing lights
online; (7) a new release sync if `release/**` moves. Owed before 25a builds: the
Fenbridge ruling. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), RULING (B)
FINISHED, AND 07 RE-JUDGED.

(Superseded 2026-09-26 by the paragraph above: the owed list below is done.)
**RULING (B) FOR THE TWELFTH PATH IS BUILT, 2026-09-26, LOCAL; ITS REVIEW, GATE AND THE 07
RE-JUDGEMENT ARE OWED, SO 07 STAYS FAIL FOR NOW.** A sync came first: merge `b627c4ad32`
takes `origin/release/v0.44.0` at `9dbc47938a` (the floor VFX ladder), audited, two sealed
capture inputs re-hashed on a probe. The fix is `b77421251a`: the handshake re-asks after
the character read, and the join installs the store's answer at install time
(`answerForInstall` over `server/freehold_join_answer.ts`: the loaded entry, capture
included, or no record when no entry vouches for the answer). Every KNOWN DEFECT and KNOWN
COST pin now asserts the fixed behaviour; 19 mutants all killed. Open, in order: (1)
finish ruling (b): three targeted mutants, four docs still stating the path open, the
reviewers, the shard carry, the armed gate, fresh reads, the 07 re-judgement (the list is
the ledger's last subsection, STATUS AT THIS HANDOFF); (2) `Sim.addPlayer` atomicity; (3)
D85 (a ruling); (4) the phase 17 re-plan with the trophy-source ruling; (5) a new release
sync if `release/**` moves. Owed before 25a builds: the Fenbridge ruling. Detail: [the
ledger](qa/persistence-2026-09-08/findings.md), RULING (B) FOR THE TWELFTH PATH.

**THE 07 HARNESS-FIDELITY REWRITE IS DONE, 2026-09-25, LOCAL, AND 07 STAYS FAIL ON A
TWELFTH PATH IT FOUND.** The work is `37e6ae6624..3686434478` plus its records; the base
did not move. The store's four liveness reads now come from ONE live map through
`server/freehold_liveness.ts` in production and in the harness alike, a per-read audit
fails any case that sees them disagree, and 125 cases changed or were added onto orders
a realm can produce, none weakened (ROUND SEVENTEEN's Q3 is CLOSED). The first fresh
read found an ELEVENTH path the old harness could not produce (a join after the old
record's eviction installed an empty default under the real minted name), fixed
fail-closed at the install. Later reads found a TWELFTH: an answer read with nothing
live goes stale when another session of the account edits and is evicted inside the
handshake. While that session's capture is still unwritten (its leave write waiting,
refused a permit, thrown once, or deferred), the store's next write carries the stale
record (an empty row for a fresh account, the older house for a row account) with no
edit and no window, unless the store knows a commit above the stale revision, when the
leaver's later edits are lost loudly or, if the joiner reaches that commit first,
silently; once the capture has committed, a joiner who reaches the committed revision
before a write samples the record overwrites the newer house. The arms are pinned as
KNOWN DEFECT or KNOWN COST, and the ledger lists the few left unpinned (each on a
mechanism a pinned case drives). FERNANDO RULED (b) on 2026-09-25 ("we want this to be
perfect"): the join re-asks the store after the lease and character read and validates
the answer against the entry, capture included, through a new synchronous store call at
the install, which keeps the leaver's edits. Seven fresh reads (the last three found
nothing blocking), every finding applied or recorded; 218 mutants plus one type-level,
every changed pin killed; the armed gate green on all 12 steps at `3686434478`. Open, in
order: (1) BUILD ruling (b) for the twelfth path; (2) `Sim.addPlayer` atomicity; (3)
D85, the cross-realm account ledger against dark realms (a ruling); (4) the phase 17
re-plan onto the account ledger, with the trophy-source ruling; (5) a new release sync
if `release/**` moves. Owed before 25a builds: the Fenbridge ruling. Detail: [the
ledger](qa/persistence-2026-09-08/findings.md), THE HARNESS-FIDELITY REWRITE, AND THE
TWO PATHS IT FOUND.

**THE V0.44.0 RE-SYNC IS CLOSED, 2026-09-25, LOCAL.** Merge `484cb61a46` takes
`origin/release/v0.44.0` at `ed69f62ef7` (World PvP, King of the Hill, Warfare Season 2,
frame presets). Homes are World PvP sanctuaries and keep honor gear health; the capture
set was re-shot and re-sealed at `1910fd578c`; 483 shard rows carried; the armed gate is
green on all 12 steps, `sfx:check` and the audio tests included. FERNANDO RULED on
2026-09-25: the chosen gate-site margins stand, so the gate stays at `(-38.65,-103.75)`
(item 6 below is CLOSED), and Rosetta is installed (`/usr/bin/arch -x86_64
/usr/bin/true` passes; item 7 below is CLOSED by that green gate). Open, in order: (1)
the 07 harness rewrite (DONE 2026-09-25, see above); (2) `Sim.addPlayer` atomicity,
widened again (the restore path now also runs `loadHonorState` and `loadWorldPvpState`);
(3) D85, the cross-realm account ledger against dark realms (a ruling); (4) the phase 17
re-plan onto the account ledger, now also owing a ruling on whether the class-locked
Warfare Season 2 sets and the personal pages are trophy sources; (5) a new release sync
if `release/**` moves. Owed before 25a builds: a ruling on the Fenbridge gate's
contested ground. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), THE
RE-SYNC OF RELEASE/V0.44.0 AT ED69F62EF7.

**THE V0.44.0 SYNC IS CLOSED, 2026-09-23, LOCAL.** The gate stands at `(-38.65,-103.75)`
clear of every press, draws and picks on a lit host, and the capture evidence was
re-shot and re-sealed over it; 474 unmeasured test files carried at the median of three
local runs armed against Postgres (`7cf74b411d`; table coverage 1.0, 4,538 of 4,538,
against the 0.918 floor); the armed gate green on every step but `sfx:check` and 22
audio tests, which fail only because this macOS 27 host has no Rosetta for the bundled
x86_64 ffprobe. Four coverage reviewers and three fresh reads of the fix rounds found no
blocking defect; every finding is applied or recorded with its reason in [the
ledger](qa/persistence-2026-09-08/findings.md), THE OWED LIST WORKED THROUGH. 07's
verdict was then still FAIL, on the harness-fidelity rewrite the round-seventeen
paragraph below describes (since DONE, 2026-09-25: 07 now stays FAIL on the twelfth
path, per the first paragraph of this section). Open, in order: (1) the 07 harness
rewrite (DONE 2026-09-25, see above); (2) `Sim.addPlayer` atomicity, widened by
`seedAccountLedgerSelf`; (3) a ruling on the cross-realm account ledger against dark
realms (D85); (4) the phase 17 re-plan onto the account ledger; (5) a new release sync
if `release/**` moves; (6) FERNANDO: confirm the chosen margins that placed the gate at
`(-38.65,-103.75)` rather than the nearer `(-37,-103.5)` (CLOSED 2026-09-25: the margins
stand); (7) install Rosetta (or gate elsewhere) to run the gate as written (CLOSED
2026-09-25: installed, gate green).

07 (bounded persistence and stable plot identity) is **BUILT, local, and its paired
QA FAILED**, 2026-09-10, AND THE FOUR RULINGS HAVE SINCE BEEN EXECUTED, which is
recorded below rather than by editing this paragraph away. The QA ran to
completion, applied every finding it could, and returned FAIL on ONE blocking
item whose fix was a ruling this packet reserved: the EIGHTH path to an empty
tier-0 Inn Room landing on a real house, reproduced three times and pinned as it
behaves. The gate was GREEN at `57ca95cb29`, which was the point: a green suite
was never the question here.

**THE RULINGS ARE EXECUTED, 2026-09-10, and the unreviewed tail has since been
READ.** All four rulings plus the section 8a login budget gate, plus C23 scoped
and the offline identity divergence accepted. C1, C22 and V6 closed with the
EIGHTH path.

**ROUND SEVENTEEN, 2026-09-10, LOCAL.** The sync this paragraph used to say was
owed had already been made, in merge `d5e7f423c7` off
`origin/release/v0.43.0`, and it was NEVER GATED: it left
`tests/freehold_capture_contract.test.ts` RED on three stale source digests,
which are re-minted. A release-merge audit over it found nothing else (i18n
bundles fresh by regeneration, all 21 monolith rows exact, no legacy-arm
divergence, no stale db mock, and the merge touched no freehold code at all).
Six fresh lanes then read `c8bb3d3f31..HEAD`. They found a NINTH path to the one
invariant, reproduced against the real store: the ordering refusal that closed
the eighth reads the LIVE RECORD, so a login refused on the whole-preload budget
could have its in-flight read land BEFORE the record is seeded, mint anyway, and
leave the seal inert by value equality for that entry's life. Closed by giving
the store the fact it lacked, which of its loads a caller has abandoned. The read
of THAT fix found it write-blocked an account whose sibling character was still
waiting on the same single-flight read, which is seventeen for seventeen.

Then a seventh lane read THAT fix round and found a TENTH path, which the fix for
the ninth had opened: two characters of one account ride one single-flight read,
`no_budget` is the only kind that leaves a sibling with a clean answer, and the
refused login seeds the stand-in before the sibling's install can name the
record, which `loadFreehold` then discards as load-once. The invariant is closed
ORDER-INDEPENDENTLY now, at the instant the row would be created, and the
ordering machinery is retired rather than repaired a third time.

(Superseded 2026-09-25: the harness-fidelity rewrite's first fresh read found an
eleventh path the old harness could not produce, and the read of its fix a twelfth; see
Current phase above.) A read of THAT fix found no eleventh path and no healthy account
write-blocked by it, which is the first clean answer this store's identity logic has returned, and
four claims to weaken: three of the repaired seal cases refuse through a different
arm than their comments named, and the new refusal costs one LOGOUT rather than
one session, because a sibling character still online keeps the poisoned record
alive.

Twenty-two further findings applied, from a guild-book revert that could throw out
of leave()'s `finally` and skip every re-enterability registration, to three
unreached conjuncts of the write seal, to an operator gauge caveat stated
backwards, to two guards of this round's own that narrowed what they replaced.
`server/game.ts` is at 9907 unchanged and `server/freehold_persist.ts` at 2193,
LOWERED four times, no ceiling raised.

THE GATE RAN FOUR TIMES and the first two each caught a defect the ungated sync
had left, not one this round wrote: three stale capture digests, then a format
diff in the release's own new capture target that made `ci:changed` refuse the
whole changed set. Run three cleared every step and the FULL SUITE PASSED, 4,225
files and 63,821 tests, then failed at `browser regressions` on ONE test of 443,
a real-driver FXAA case that timed out at 15,000 ms. Diagnosed rather than
waved through: it ran 19,231 ms under a load average of 117, this round touches
no render code at all, and re-run alone on the same tree it passes in 449 ms of
test time. RUN FOUR, on a quiet machine, settles it: `GATE_EXIT=0`, ALL 12 STEPS
GREEN, with the browser step passing 52 files and 443 tests. The gate is green at
this tip and nothing about it is outstanding.

(The harness defect below is CLOSED 2026-09-25; see Current phase above.) THE VERDICT IS
STILL FAIL, and now on an OPEN DEFECT rather than on the record:
the store's test harness lets `serialize` and `liveRev` contradict `hasLive`, so
cases can still model a liveness state the server cannot produce. Part of it was
closed here (the five seal cases that did so, and the global mint identity), but
the general fix is a deliberate harness rewrite, measured at forty-plus cases,
and it is the next session's first piece of work. The honest prior for that
reader is the one this ledger has earned: this round found two new paths to the
one invariant and its own repairs opened one of them. Full detail, every finding and every
measurement: [the findings ledger](qa/persistence-2026-09-08/findings.md), round
SEVENTEEN.

Its implementation-round review is closed. Planning for 07 was settled long before this; BUILT is the new
fact, and the two words are not interchangeable in this ledger.

Every owned plot now survives a restart under one stable public identity, with
bounded load and save work and a stated mixed-release recovery contract.
Cross-record transfers stay dark until 07a. Sixteen commits
`627a59a73c..c0b2891173` (four delivery, one format rider, then eleven applying
review findings). Nine COVERAGE reviewers reported and a fresh five-lane round
then read the fix round itself, because a fix round is unreviewed code; every
finding, including every nit, is applied or ruled with a reason in
[the ledger](qa/persistence-2026-09-08/findings.md), beside the nine reports.

The two facts an operator needs before enabling anything are in
[the rollout contract](persistence-rollout-contract.md): what a release must be
able to do before housing is lit on any process sharing one DATABASE_URL, and
what an INCAPABLE release does against a populated database. Production stays
disabled and every release gate below stays unsigned.

06 (interiors, Eastbrook gate and Hearth Key) is **COMPLETE INCLUDING ITS PAIRED
QA: PASS, local**, 2026-09-08. The audit found and fixed 37 distinct findings: 36 source/capture findings and
DOC01, the final execution-ledger wording correction. Including that nit, zero remain open or deferred. The original delivery ends at
`67281f8ed40f0e20c9c9a438e38177e49b0c50ab`; the fresh independent review accepts
the full fix round through `957a93b05b418ac5baf7c164679b7bd72017b3c6`.
Current receipts are [QA overview](qa/interiors-2026-09-08/README.md),
[findings](qa/interiors-2026-09-08/findings.md),
[execution](qa/interiors-2026-09-08/execution.md) and
[fresh final review](qa/interiors-2026-09-08/reviews/fresh-fix-review.md).
The prior implementation-only receipts at `67281f8ed4` remain historical; this
paired QA supersedes their current gate, capture and source-seal counts.

### 07 built receipt (implementation round, 2026-09-08)

What it actually does, in the order the code runs it. The handshake reads the
account's durable plot and its Hearth clock on the FRESH-JOIN arm only, before the
character lease so the lease-held window stays tight, bounded by its own 5,000 ms
permit wait rather than the background write's 15,000 ms. A read that throws logs
and joins the player with NOTHING installed, because the entry that never loaded is
write-blocked, which is exactly the state in which the real row on disk cannot be
overwritten by a realm that failed to read it. `game.join` installs the durable
record BEFORE `addPlayer` seeds a default. The periodic flush sweeps every loaded
owner once per AUTOSAVE_SECONDS, reading ONE integer per owner (the live record's
revision) and cloning nothing unless a write actually goes out. Writes coalesce to
one running plus one pending per owner key, take a local admission cap of four so a
mass-login sweep cannot put a thousand waiters on the shared background gate, and
fence on `durable_rev` so a writer this realm does not know about can never be
clobbered. Logout flushes with its own short deadline: it gives up the WAIT, never
the write.

PRESERVATION IS THE INVARIANT, and it is one-directional. Only genuine ABSENCE
resolves to the free tier-0 Inn Room. An unsupported, malformed, oversized or
unadmitted row is preserved byte-identical and the account is write-blocked for the
session, playing normally on whatever the sim holds. Every failure mode reachable in
review pointed at "the owner loses an edit" or "the owner is held read-only", never
at "the owner's furnishings are overwritten".

Two byte ceilings, both MEASURED, because they bound two different texts. jsonb is
not a byte copy of what was sent: it re-renders every object with a space after each
colon and comma, and stores every number as `numeric` in full positional form. The
maximal legal record is 101,139 bytes of canonical JSON, and its two content columns
measure 100,866 canonical against 106,032 as `octet_length(col::text)`. Handing the
canonical ceiling to the SQL bound would have classified the largest record this
realm may WRITE as oversize forever. The codec refuses any number whose JSON text
carries an exponent, which is what keeps the gap a fixed 5.1 percent rather than an
unbounded multiple (`5e-324` is fourteen bytes of JSON and three hundred and
thirty-five bytes stored). `freeholdWriteRefusal` applies all three load ceilings
before every write, so writable implies readable. The executed proof is a
real-PostgreSQL round trip of the maximal record in
`tests/server/freehold_db.pg.test.ts`.

Command outcomes, all executed in this worktree:

- `npx tsc --noEmit`: exit 0.
- The named 14-file battery: **14 files passed, 642 tests passed, 3 skipped**.
- The dev-bridge battery (7 files, PRIOR 05 re-verified): **249 passed**.
- Both PostgreSQL-armed suites against the disposable `npm run db:up` instance, in a
  private schema dropped afterwards: **2 files, 29 tests passed**, confirmed EXECUTED
  rather than skipped (the same command with `TEST_DATABASE_URL` unset skips all of
  them, which is how the arming was proved).
- Monolith ratchet: `server/game.ts` 9,920 and `server/db.ts` 4,605, both sitting EXACTLY AT
  their ceilings with zero slack, paid for by three behaviour-preserving extractions and
  then lowered to the measured counts rather than banked as headroom.
  `server/wire_cadence.ts` was verified a MOVE by diffing it against
  `git show b2aeb46da2:server/game.ts`.

Review: nine COVERAGE reviewers (migration-safety, database-performance,
privacy-security, server-hot-path, architecture, cross-platform-sync, test-coverage,
frontend-seam, qa-checklist), then a FRESH five-lane round over the fix round itself.
Findings were applied, not filtered: the ledger records each with the commit that
applied it or the reason it was ruled. Two blocking defects were found and closed, the
larger of which (the two-measurement byte ceiling) was independently re-measured
against PostgreSQL 16 rather than taken on the reviewer's number, and turned out to
matter for a different reason than the reviewer gave.

WHAT IS STILL OWED, so it is not mistaken for done. The paired QA
(`phase-07-qa.md`) has not run. `advanceFreeholdHearthOnClient` is written, proved
against real PostgreSQL and reachable by NOTHING: the realm admission participant
that would call it is 07a, so no shipped realm writes `account_freehold_hearth` and
the isolated per-Sim clock is the only cooldown a player meets today. `markDirty` and
`save` are the store's explicit dirty seam and have no production caller either; the
revision sweep is the only detector that runs, and the coupling that makes that safe
is now pinned by a source scan. A write-blocked hold has no player-facing surface.
Every release gate below stays UNSIGNED and production stays disabled.

### 06 accepted runtime and shared-gate receipt

Owner arrivals resolve a deterministic body-safe landing before any claim,
teleport, membership or clock change. Saturation refuses without side effects.
The gate counts carried and personal-bank key possession before granting; a real
JSON restore cannot turn a banked key into a duplicate. The key remains a
permanent action-slot-eligible tool and does not grant ownership. Physical gate
entry, refusals and already-home no-op do not consume its exact `3_600_000` ms
isolated account clock, which remains outside character/plot serialization.
Renderer dependency waits obey cancellation/deadlines without cancelling shared
cache fetches; generation ownership and temporary instance disposal are tested.
Gate controls retain native keyboard behavior, IME, shared close/focus ownership,
keyed personal refusals and one persistent authorized result/status node.

The final PostgreSQL-armed canonical shared gate exited 0 with all twelve steps
green: 4,210 unit files and 63,227 tests passed, two existing expected failures
and 27 explained skips (63,256 total); all 51 browser files and 429 tests passed.
Typecheck, environment/server/bot/client builds, generated-artifact freshness and
security passed. The post-source-fix `ci:changed` checked 604 files with no errors,
775 warnings and 16 infos. Ordinary PostgreSQL and CI-presence checks executed;
optional differential and release-tier bars are not claimed. The raw log retains
nonfatal diagnostics, including config discovery in the unchanged older
`docs/screenshots/freehold-crafted-content-2026-09-07/runtime/vite.config.mjs`
archive; actual Svelte checking reports zero errors and zero warnings and exits 0.
The two failed gate attempts and source-based 27-skip reconstruction remain in
the execution ledger. No required Phase 06 acceptance case was omitted.

The canonical capture set retains eighteen PNGs, eighteen sidecars, three raw and
three formatted producer records, and its [acceptance receipt](../screenshots/freehold-interiors-2026-09-08/acceptance.json).
All 42 source and seven harness seals match. (Re-shot 2026-09-23: the current receipt seals 67 source inputs, 17 of them harness files; see [the evidence record](interiors-implementation-evidence.md), last section.) Receipt-time Git identity is labeled
as such; the real baseline remains `6540713541` without copied application runtime.
Baseline diagnostics are 102 inherited preload messages plus 29 HTTP 502 responses;
after diagnostics are 28 HTTP 502 responses, with no unclassified error or page
exception. The fresh reviewer personally inspected all eighteen canonical images,
[twenty presentation fixtures](../screenshots/freeholds-06-presentation/README.md)
and [eight actual-key images](../screenshots/freeholds-06-key/README.md).
Presentation images are observed 333 by 720, not the requested fixture dimensions;
canonical compact captures prove the 874 by 402 viewport. Key captures complete
both actual routes with one permanent key after use and one positive deadline.
Compact tooltip presentation uses explicit automated DOM focus; no physical-phone
or keyboard-only/touch-only tooltip-navigation claim is made.

The final hardware GPU record is `2026-09-08T21:37:37.430Z`: all four measured
room/viewport windows draw 146 frames, Inn/Cottage calls are 33/28, and effective
preset 1/tier low is retained. Required raw arrival-through-sample live-program,
attach-watchdog and gate-timeout deltas are zero. Earlier cumulative events and
two ignored HTTP 502 diagnostics per viewport remain; error and budget-failure
arrays are empty. This is bounded functional LOW evidence, not final lighting.

Production remains disabled. Remote key admission stays fail-closed until 07/07a
supplies the durable account participant, locked database epoch and committed
private display mirror. Injected server participants prove protocol only. Arrival
directive consumption remains with 07c/08a/09; final lighting/camera/welcome with
09; reserved Cottage anchors with 12; visiting with 18; final GLBs with 19; Wave A
close with 20. Slot-capacity and repeated-entry deployment gates remain unsigned.
No new art, push, PR merge or production activation is claimed. The coordinator
will run `npm run ci:changed` after the separate verdict/documentation commit;
that actual-last-commit packaging check has not yet run and is not claimed here.

### Previous completed pair: 05
05 (the instance claim) is **COMPLETE INCLUDING ITS PAIRED QA: PASS, local**, 2026-09-08.
The implementation landed in six commits `c578fd77d0..497bc1d73f`; the QA session then
synced `origin/release/v0.42.0` at `553a5672ed` (merge `a461924855`, sixty conflicted
paths, every count pin re-measured with its composition beside the literal, the terrain
corpus re-minted as the release body plus the packet's tail, a patched-dependency reinstall)
and landed fourteen further commits `5f3fff5339..9b21dd61fc` over it. Thirteen reports ran
for coverage: the merge audit, three auditors (correctness, test coverage, hygiene), the six
domain reviewers (architecture, cross-platform-sync, server-hot-path, content-obligations,
privacy-security, qa-checklist), and three fresh fix-round reviews; 119 finding rows
(about 90 distinct) were every one applied in code, tests or docs, or recorded as a named
gate with an owner and a blocking tag where the reviewer asked for one, zero deferred. The
fix round: the quay drop moved onto clear ground (pinned unblocked with zero depenetration
on every seed, verified on glibc), the owner's corpse run (a released ghost bound to its
own room re-enters and resurrects; the tier-change sweep counts a bound corpse and never
runs for a ghost's arrival), an unusable record tier refuses instead of throwing, the dev
bridge answers every refusal alike, the community wiki seed honours `guideVisible`, and
the shard-weight table carries measured medians for the 183 suites the release harvest
never covered. The fix commits were read by three successive fresh reviewers (the third
PASS, its wording nits applied and confirmed). Validation on the committed tip
`9b21dd61fc`: `node scripts/gate_select.mjs` armed with TEST_DATABASE_URL from the main
checkout, full-suite mode, PASS all 12 steps: 4160 unit files passed and 1 skipped, 62624
tests passed with 2 expected failures and 28 skips, browser 48 files and 392 tests,
typecheck and every build green; `npm run ci:changed` exit 0 after the last commit;
`tests/parity` 12 files green with the `freehold_claim` golden re-minted in its own
commit for the moved drop and the 81 others byte-identical; the terrain corpus and the
drop pins green in `node:26-bookworm` (aarch64, glibc 2.36). The browser step's own
regression, `tests/browser/intentional_gathering.browser.test.ts`, rewrites two PNGs
under `docs/screenshots/intentional-gathering-pr1/` on every run (a pre-existing
release-side quirk); restore them with `git checkout` before committing. NOT pushed, no
PR (the wave close owns both).

Previous: 04 is complete including its reconciled paired QA: **PASS, local**, 2026-09-07.
Four findings were found and resolved: three source/test findings and DOC-1,
a documentation nit. The source/test repairs span `0932963250..69ffdab561`,
in commits `d5ea0825d1` and `69ffdab561` (five files): HN1 restores every
content barrel route, including the recipe catalog; COV-1 strengthens full-state
dark-refusal assertions; and PER-1 verifies the authored furnishing/pattern cohort through lit, dark, and
relit JSON saves. No finding or nit remains deferred. The independent
[fresh entire-fix review](crafted-qa-reconciled-2026-09-07/reviews/fresh-fix.md)
and its supplement returned PASS after inspecting all current changes and the
six historical repair commits. Simulation-architecture review also passed after
its additional HN1 recipe-catalog occurrence was repaired. That occurrence is
included in HN1, not counted as a distinct finding. The final shared gate exited 0 with all twelve steps green. Unit coverage passed 4028 files and 60610 tests; Chromium passed
47 files and 389 tests. The single skipped CI-sentinel file, two expected failures
and 28 explained skipped cases are disclosed in the current validation record.
The separate PostgreSQL 16 run passed 57 tests, including the opt-in SQL cases.
No furnishing acceptance case was skipped.

The active user request preserves `evaluateCraftAdmission`, `resolveTrain`, and
existing station, training, and economy semantics while permitting the existing
availability seam. Both complete declarations remain byte-identical from
`86eb86bbe2^` through `69ffdab561`. This explicit scope closes F01 prospectively;
it is not a numeric signature or a rewritten historical QA verdict. The earlier
29-found/28-repaired FAIL remains preserved in the historical receipt below.

See [current validation](crafted-qa-reconciled-2026-09-07/validation.md) for exact
commands, outcomes, source comparisons, PostgreSQL and mutation evidence, and
[findings](crafted-qa-reconciled-2026-09-07/findings.md) for all four closures.
DOC-1 corrects the validation and copied context wording
to match the retained receipt: ten rows times five Boolean fields equals 50
calibration checks, not 60. The [documentation review](crafted-qa-reconciled-2026-09-07/reviews/docs-final.md)
records that correction; the three-source-finding review chronology and the
two source repair commits remain unchanged.
The actual post-last-commit `npm run ci:changed` remains the coordinator's final
execution step, with commit and outcome recorded in the final handoff and local
receipt. No prior source check pre-certifies that execution.

The four original content commits, accepted development calibration, and final
icons are reused. No asset was generated in this QA. `productionApproved` remains
false; final-model, room/arrival/navigation, hardware LOW, and production numeric
gates retain their existing owners. The branch remains local; 05 is next and has
not started.

### Historical paired 04 QA receipt

The paired 04 QA verdict was **FAIL, local**, on 2026-09-07. Its audit found 29
distinct findings: 28 repairs applied and independently accepted, with F01 open
under the then-current whole-directory prohibition. That historical requirement
conflict and verdict remain recorded in the original findings and review receipts.
The prospective reconciliation above does not claim that historical QA passed.

The original accepted development implementation remains snapshot `3666d89647`,
with commits `86eb86bbe2`, `8bd097d898`, `b3c2452b49` and `3666d89647`. Its exact
accepted calibration SHA-256 is
`c211e11ae3289fc5ae8745f27c13c3253164dcf9188641fbcbf3c150fa479e2b`.
The signed calibration, original twelve-step gate and 42 runtime captures remain
in `crafted-content-trial-2026-09-07/acceptance.md` and
`crafted-content-trial-2026-09-07/implementation-validation.md`; they are
historical implementation evidence, not substitutes for this paired audit.

Paired QA integrated dependency `54ce808436` through `2e24ba8818` and applied
`ea3b62fad1`, `47655ffb54`, `1be1aef461`, `85f99f6a32`, `5f4821bec7` and
`b379ee462d`. Final source verification at `b379ee462d` passed all 12 shared-gate
steps, exit 0: 4,028 unit files and 60,594 tests passed, with two expected failures,
27 existing case skips and no skipped suite; shared Chromium passed 46 files and
385 tests. Typechecks, builds, security, SFX and generated freshness passed.
The explicit wiki/i18n owner commands also exited 0 after the gate, with a clean
generated-source diff. The final combined presentation run captured all 11 frames
and exited 0; independent frontend review accepted the final guide/manual evidence.

The distinct fresh full qa-checklist/whole-fix reviewer inspected all 80 files in
`2e24ba8818..b379ee462d` plus merge evidence, including touch feedback, locale
seeds and the five later gate-repair findings. Its final receipt is
[qa-checklist-final.md](crafted-qa-2026-09-07/reviews/qa-checklist-final.md), distinct
from its earlier database-only review. Exact commands, failed attempts and final
outcomes are in [validation.md](crafted-qa-2026-09-07/validation.md); all 29 findings
are in [findings.md](crafted-qa-2026-09-07/findings.md). F02 through F29 are accepted;
technical approval does not resolve F01 or turn the paired QA verdict into PASS.

`GATE_SELECT_BASE=54ce808436 npm run ci:changed` exited 0 after source commit
`b379ee462d`. Its required replay after the separate verdict/evidence commit is
still the coordinator's final execution step; it has not yet run and is not
claimed here. The branch remains local; no push, PR merge or production activation
occurred. `productionApproved` remains false. Production numeric, final GLB, room,
arrival/navigation and hardware LOW gates retain their existing owners. No asset
was generated in this QA.

### Current next step

07a is BUILT and pushed (2026-10-01) with its implementation-round review closed. Its paired QA has
NOT run. Next run, in a fresh session:
`/home/fernando/Documents/world-of-claudecraft/docs/freeholds/phase-07a-qa.md`.

(Superseded 2026-10-01 by the paragraph above.)
07 is BUILT locally (2026-09-08) with its implementation-round review closed. Its
paired QA has NOT run. Next run:
`/Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds/docs/freeholds/phase-07-qa.md`.

06 is complete including its paired QA (PASS, local, 2026-09-08, reviewed source
tip `957a93b05b`).

Previous phase 03 (`phase-03-content-tiers-and-basics.md`): COMPLETE INCLUDING QA,
verdict PASS locally on 2026-09-07. All 39 distinct completion-round findings
are resolved; fresh repair and final record reviews pass. The shared gate passed
all twelve steps, with 57726 unit tests and 376 browser tests passing.
Fernando accepted the exact trial in `content-trial-2026-09-07/acceptance.md`.
The twelve-bill version, eight furnishing records, gated `freehold_furnisher`,
actual `hearth_basics`, manual Homesteader rewards, art and localization exist.
Production remains disabled. Final production calibration, shipping models,
room/LOW evidence and the explicitly deferred NPC voice remain named gates.
See `content-final-validation-2026-09-07.md` and the current 03 ledger notes.
Its completion source commits are
`a6bf26fad9`, `9121f0d94f` and `e1be875782`, followed by this final evidence
closeout. The post-source-commit check passed; the task handoff records the
repeated `ci:changed` result after the actual final commit and clean status.
No push or merge has occurred.

Previous phase 02 (`phase-02-furnishing-item-kind.md`): COMPLETE INCLUDING QA, verdict PASS
locally on 2026-09-07. All 40 distinct findings have independently
reviewed repairs and evidence at `d386635394`. The fresh reviewer read all 110
changed files and all four repair commits, with source PASS and zero open
source/test findings. The final shared gate completed with actual exit 0 and all
12 steps green; standalone i18n generation/status and source freshness passed.
Final verdict documentation and the completion checklist were independently
reviewed with PASS. The actual post-commit check at verdict commit `c881543258`
passed with exit 0 and clean status. It will run again after the evidence-only
amendment; see `progress.md` row "02 QA" and
`furnishing-item-kind-qa-validation.md`.
The QA dependency sync merged PR #3872 head `d3dcdaa4af` through merge commit
`041fd790ce`; the PR was still OPEN at that historical checkpoint. The current
merged-release sync above supersedes that dependency status.
Phase 01 remains COMPLETE INCLUDING QA, verdict PASS (`c946091c07..2e247df270`). Its QA
round's own detail is in `progress.md` row "01 QA"; do NOT re-run that audit or re-raise
its judged findings. R01-R46 and D73-D75 are approved;
D76-D93 (settlement round 2, R47-R64) were approved by Fernando on 2026-09-06 with the words
"approve all recommendations R47-R64"; the review-fix round is applied across the packet,
freshly reviewed and committed locally. Implementation 05 and subsequent
work remain unbuilt; the branch stays local.

## Settle audit facts (verified 2026-09-05 and 2026-09-06)
These facts were recorded before dependent implementation instructions changed. They
describe the audited tree and primary evidence, not additional balance rulings.

- Preflight: the worktree was clean at `7d140843d2e6804d3245b1c5c09990ca1da6a407`.
  PR #3872 remains OPEN, with no merge timestamp, targeting `release/v0.42.0` from
  `feature/masterwrought`. `git fetch origin --prune` passed and
  `git merge origin/feature/masterwrought` reported `Already up to date.` The dependency
  block above still applies. No non-empty merge or `patches/` change occurred, so neither
  the release-merge audit nor a dependency reinstall was triggered. Nothing is built.
- Propagation disclosure: the proposal (`docs/prd/woc/freeholds-and-guildhalls-research.md`),
  the deck and the six housing-research appendices at HEAD are the settled propagation of
  the text adopted on 2026-09-05 at revision `383fd7da83` (the `FernandoX7/add-real-estate`
  head), edited in place on 2026-09-06 to carry D27-D93; the adopted text lives in git
  history at that revision and `audit-record.md` carries the section-level disclosure.
- Paid-operation authority: `server/storage_purchase_db.ts` documents and implements
  durable exactly-once authority in `storage_purchase_applied_receipts`, outside the
  character-blob and character-deletion lifecycle. `appliedStorageKeys` only protects
  the live sim apply; an older binary can strip it on save. A housing transaction must
  use the durable-receipt contract as its exemplar, including a fingerprint, refusal of
  consumed-key replay, and atomic durable effect/receipt handling. The bounded blob
  list is not an exactly-once authority or an adequate retention policy.
- Database admission: `createBackgroundDbGate` in `server/background_db_gate.ts`
  exposes `configuredHeadroom`, not reserved interactive capacity. Ungated work shares
  the pool, and `acquire()` has an uncapped FIFO waiter map. A housing producer must
  specify its own bounded pending work and coalescing/admission behavior; citing the
  existing gate alone does not establish bounded memory or a reserved pool partition.
  `createKeyedSerialWriter` in `server/serial_writer.ts` likewise supplies FIFO order
  and pre-start cancellation, without a queue-depth cap or autosave coalescing.
  `runPeriodicSaveFlush` in `server/periodic_save_flush.ts` explicitly does not make
  its separate writes atomic; grouping calls there cannot protect a housing/inventory
  transfer from a crash between commits.
  `beginCharacterSaveTx` in `server/character_save_transaction.ts` owns transaction
  setup and statement, lock, idle and transaction deadlines. It does not own the
  composition of durable effects or establish a safe lock order by itself.
- Save composition facts: the direct save siblings in `server/db.ts` take account
  locks, call `runFencedCharacterSave` for the explicit character pre-lock and
  nonce-fenced update, classify/write bank-ledger receipts, then write the applicable
  market/mail effects, sorted guild-bank receipt replay, storage effects and custody
  tail before commit and the deferred growth guard. Preserve each sibling's actual
  touch set and order; do not replace this with a generic "operation receipts last"
  instruction. `server/character_save_statement.ts` documents the separate carried
  InitPlan fence race in `saveCharacterStateOnClient`: that helper still issues a
  plain fenced update without the pre-lock, so it is not a safe shortcut for a new
  housing transaction. Housing's named composition seam must explicitly pre-lock and
  nonce-fence the character update while preserving legacy touch sets. Its acceptance
  artifact must map the precise lock/effect order and prove the refusal/interleaving
  behavior in PostgreSQL; the existing deadline helper does not supply that proof or
  repair the recorded race.
- Existing-anchor corrections verified by the tree sweep: the barrel/local-guidance
  exemplar is `src/sim/pvp/index.ts` with `src/sim/pvp/CLAUDE.md`; the cited rift
  equivalents do not exist. Fenbridge layout and station exports are
  `FENBRIDGE_LAYOUT` and `FENBRIDGE_STATIONS_BY_ID` in `src/sim/fenbridge_layout.ts`,
  not a `src/sim/content/fenbridge/` directory. `WocMarketService` is exported by
  `server/woc_market.ts`, not `server/woc_market_service.ts`. Number/date/money
  formatters come from `src/ui/i18n.ts`, not a `src/ui/i18n/` directory.
  `FINDER_ACTIVITIES` is exported from `src/sim/content/dungeon_finder.ts`;
  `DUNGEON_FLOOR_Y` is exported from `src/sim/data.ts`.
  `authoredLiftAt` is exported from `src/sim/rift/authored.ts`;
  `src/sim/dungeon_layout.ts` imports and calls it, rather than owning its export.
  `GroundAimReticleView` belongs to `src/ui/hud/action_bar/ground_aim_controller.ts`;
  the render visual owns `GroundAimVisualState` and the render core owns
  `GroundAimGeometryState`. The `server/ws_auth.ts` injection is
  `bankBonusForAccount`; `server/main.ts` binds it to `bankBonusFactsForAccount` from
  `server/db.ts`. Preserve that injection distinction when describing housing joins.
- Endpoint scaffold contract: `scripts/new_endpoint.mjs` generates
  `server/<domain>.ts`, `tests/server/<domain>.test.ts` and the authenticated GET
  error `<domain>.invalid_input`. The planned housing command is
  `npm run new:endpoint -- --domain freehold --method GET --path /api/freehold`.
  The chosen `server/freehold_routes.ts` and `tests/server/freehold_routes.test.ts`
  names require explicit moves plus registry/test import updates after generation.
  `freehold.disabled` is a separate append-only error/catalog/API-key/parity addition;
  keep the generated `freehold.invalid_input` entry. The scaffold does not create
  those chosen filenames or a disabled error automatically.
- Monolith audit: no coordinator ceiling changed during base sync. The live
  `tests/monolith_budget.test.ts` pins remain the authority. The packet's named large
  files have no slack (`src/sim/colliders.ts` too, since the 2026-09-26 sync pinned it at
  its exact merged count); none may grow beyond its pin, and the module-first extraction
  rule still applies.
- Mount-catalog drift: the old "six mounts" instruction does not cover the current
  catalog. `src/sim/content/mounts.ts` exports `MOUNTS`, its derived `MOUNT_KEYS`,
  `MountKey` and `DEVELOPER_MOUNTS`; the developer list explicitly identifies mounts
  without a player-facing acquisition path. A trophy-family source sweep must use
  the live exported roster, current acquisition/discoverability and owned-state
  contracts, and an explicit developer-mount exclusion/availability rationale. A
  historical literal count neither defines the eligible roster nor establishes that
  every catalog entry is normally obtainable.
- Material-tier facts: `MATERIAL_GRADES` in
  `src/sim/professions/material_grades.ts` contains node-material grade pairs only at
  `gatherTier` 1, 2 and 3; its upper live fine IDs are `fine_thorium_ore`,
  `fine_elderwood_log` and `fine_sunpetal_herb`. There is no tier-4 node fine-grade row.
  `FARM_CROPS` in `src/sim/content/farm_crops.ts` does contain tier-4 produce. Its crop
  tiers, the node-gather tier ladder and `MATERIAL_TIER_BY_ITEM` price bands are
  distinct sources. Future upgrade bills must cite actual exported item/grade records
  and must not invent a tier-4 node material from the proposal's shorthand.
- Offline dev-authorization facts: `src/main.ts` constructs the offline `Sim` with
  `devCommands: import.meta.env.DEV`. The server boot mapping lives in
  `server/sim_boot_config.ts` and reads `process.env.ALLOW_DEV_COMMANDS === '1'`.
  `vite.config.ts` supplies no bridge carrying that server environment flag into the
  offline browser constructor. The online `devCommandsAdvert()` only reveals a HUD
  surface whose commands remain server-gated; it does not authorize the offline Sim.
  D3/D24 therefore cannot cite an already-existing browser flag bridge. A housing-only
  dev-build and loopback authorization bridge would be NEW implementation, or the
  fixture must exercise the actual dev-authorized server. These are implementation
  remedies to specify, not a claim that either is already built or a new product ruling.
- Arrival and camera facts: `arrivalRevealSettleMaxMs` in
  `src/game/arrival_warmup.ts` returns zero for ordinary online cosmetic settling;
  the distinct first-spawn establishing-shot exception is not a housing-entry
  permission to hold a live character behind a cosmetic curtain. In
  `src/render/camera_director_core.ts`, `cancelCameraDirective` starts release state;
  `stepCameraDirector` blends out through `DIRECTOR_RELEASE_TIME`. An immediate
  cancellation request is therefore not an instantaneous snap to zero directive
  weight. Preserve the actual shared envelope when describing interruption.
- Gamepad focus facts: `Hud.isWindowOpen()` in `src/ui/hud.ts` sees the topmost visible
  `.window.panel`; `src/main.ts` passes that result into
  `shouldUseGamepadPointerMode` from `src/game/gamepad_pointer_mode.ts`. The pointer
  arm in `src/game/gamepad.ts` clears pad movement and skips camera/ability dispatch.
  `src/game/dpad_focus_nav.ts` uses `data-pad-nav-root` only for standalone navigation
  fallback after open windows. Adding that attribute to a visible `.window.panel`
  does not exempt it from pointer-mode suspension. A housing build-input contract
  must name its actual window/mode integration instead of claiming the attribute alone
  preserves movement.
- Distribution authority boundary: D9 describes the game's client presentation map.
  Current `server/claudium.ts` and `server/claudium_proxy.ts` authenticate the account
  and send service-owned spend requests; no housing distribution-eligibility contract
  exists in those sources. A local client capability verdict is not authenticated
  service-side purchase eligibility. The new service contract must state where
  trusted distribution eligibility is established without treating a client-supplied
  distribution label as authority or importing distribution policy into the sim.
  This identifies the missing boundary and does not rewrite D9's product surface map.
- Design rollout: `DESIGN.md` is the adopted target; its foundation is not shipped in
  this tree. `src/styles/tokens.css` still declares Cinzel as `--font-display`, and
  `src/ui/theme.ts` still carries classic accent `#ffd100`, border `#6f5a2a`, panel
  `#15151f`, text `#f0ebd8` and muted `#998d6a`. Gold-ramp ornament tokens exist, but
  many adopted ink, theme, motion and radius tokens do not. The adopted Alegreya
  heading target supersedes the proposal's Cinzel heading suggestion; the housing
  packet must distinguish target design requirements from currently resolving tokens
  and must not represent the coordinated global foundation as completed work.
- Interior light facts: the proposal's three authored room emitters cannot promise
  three contributing point lights on every LOW phone. `src/render/gfx.ts` derives
  `GFX.maxPointLights` from the platform/memory profile, including two on iOS, and
  `src/render/renderer.ts` can reduce effective contributors further through the live
  lighting budget while preserving the fixed count with zero-intensity pads. Its
  existing `applyStateLightRig` interior path skips LOW. Housing's LOW grade/fallback
  therefore needs explicit acceptance evidence; visibility of the room and actionable
  ghost/blocked boundaries cannot depend on an ornamental light retaining a slot.
  `src/render/point_light_budget.ts` and the `FireLightSink` registry/adopter remain
  the live light-budget and lifecycle authorities.
- Distribution facts: Apple's current [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  include an IAP requirement for multiplatform game items under 3.1.3(b) and separate
  NFT/external-purchase rules. A use-only account entitlement and neutral website label
  are therefore not proof of native approval. Google's [blockchain policy](https://support.google.com/googleplay/android-developer/answer/13607354)
  requires relevant declarations/disclosures and restricts promotion of potential
  returns; this packet's ban on the word "earn" is its stricter editorial choice.
  [Steam onboarding](https://partner.steamgames.com/doc/gettingstarted/onboarding)
  prohibits blockchain applications issuing or permitting exchanges of cryptocurrency
  or NFTs. These facts require signed surface/flow review, not a guessed approval.
- External verification limits: the current exact Epic blockchain-policy page was not
  retrievable. The available
  [Epic content guidelines](https://cdn2.unrealengine.com/epic-games-store-content-guidelines-f8accc43356e.pdf)
  require the Blockchain Addendum. The Solana Mobile Publisher Policy is at
  https://legal.solanamobile.com/publisher-policy-web (retrieved 2026-09-06; "Last
  Updated: Jul 21, 2026"; the old solanamobile.com URL redirects there). It is part of and
  subject to the Solana Mobile dApp Store Developer Agreement and carries no purchase, NFT
  or territory rule of its own; the Developer Agreement (current signed text) is a named
  acceptance artifact in the counsel memo and territory schedule. The
  [Solana dApp Store introduction](https://docs.solanamobile.com/dapp-store/intro)
  establishes platform capability, not a housing checkout. A KR-only territory rule,
  blanket Epic link prohibition and Seeker housing-purchase approval were not verified.
- Historical number attribution: [EQ2 GU49](https://www.everquest2.com/news/imported-eq2-enus-1916)
  verifies twelve-week housing/guildhall prepayment as a precedent. Primary sources
  did not verify a Conan protective pause after absence, an ArcheAge weekly gathering
  output share of ten/twenty percent, a second-plot 1.5x multiplier, or a GW2 weekly
  member-donation multiple. Existing proposal values require explicit product adoption
  and the named economy acceptance artifact; none becomes a classic-era fact by citation.
- Optional deed capability: [Metaplex Core](https://www.metaplex.com/docs/core)
  publishes the base-asset cost on its Core page (cited by reference as dated context; the
  figure changes and is never copied into the packet or the code), not the full service
  quote.
  Asset-level [Permanent Freeze Delegate](https://www.metaplex.com/docs/smart-contracts/core/plugins/permanent-freeze-delegate)
  and [Permanent Burn Delegate](https://www.metaplex.com/docs/smart-contracts/core/plugins/permanent-burn-delegate)
  are separate authorities configured at creation. Burn is irreversible and can affect
  a frozen asset; collection-wide freeze cannot selectively freeze one plot. Capability
  does not authorize upkeep loss or establish a legal/territory policy.

- Account lifecycle source facts: `server/db.ts::touchLogin` records account
  authentication in `accounts.last_login`; the private `loginHandler` in
  `server/auth_routes.ts`, wired by that module's exported `routes`, and
  admin/federated authentication call it without requiring gameplay entry. Authenticated
  world admission flows through `server/ws_auth.ts::createWsAuth` into
  the `join` member of the exported `GameServer` class in `server/game.ts`;
  `touchCharacterLogin` separately stamps a fresh
  world entry, while resume skips that stamp. `openPlaySession`/`closePlaySession` are
  asynchronous observations. None defines authoritative account gameplay-presence or
  return-protection policy. Linkdead retains the session until expiry/leave.
- Lifecycle host seams: `server/periodic_save_flush.ts::PeriodicSaveWrites`,
  `PERIODIC_SAVE_WRITE_NAMES` and `runPeriodicSaveFlush` issue each existing periodic
  writer once without awaiting it; they are not a transaction or shutdown drain.
  The `leave` member of exported `GameServer` awaits final character saving before lease release; `saveAll`
  settles attempted saves and catches individual failures. The `server/main.ts`
  shutdown closure drains existing writers before leases and pool closure. No housing
  presence writer exists in those seams; a new subsystem needs explicit wiring and
  captured-observation semantics, not a claim that current analytics supply them.
  The `join` member of exported `GameServer` uses `server/linkdead.ts::planJoin` synchronously; the surrounding
  `server/ws_auth.ts` authentication flow is asynchronous. The current join body is
  not an existing awaited database admission transaction.
- Account removal and export facts: `server/account.ts::handleAccountDeactivate` calls
  `server/db.ts::setAccountDeactivated`, which updates `deactivated_at` without deleting
  the account. Its realm-scoped character list/process-local online check does not
  establish an all-realm offline barrier. The separate
  `server/federated_auth_db.ts::deleteUnusedFederatedProvision` hard-deletes only a
  guarded unused provisioning-race loser. `exportAccountData` explicitly selects
  account-linked rows; `server/account_export_state.ts::projectAccountExportState`
  redacts farm-plot fields and spreads other character state. New account-level housing
  tables will not appear in export automatically; deactivation, restoration, character
  deletion, true account deletion and export are distinct lifecycle paths.
- Rollout capability facts: `origin/release/v0.42.0` contains no Freeholds runtime
  implementation. It was verified at `9e4d12ebd5` (the release head when this fact was
  first recorded on 2026-09-06, the merge of PR #3880); at the review-fix round the head
  was `4e168d1ad7`, 87 commits past the merge-base `1fdf0f55a3`, and it keeps advancing,
  so no revision here is the current tip. Its historical
  `server/bank_ledger_save_effects_db.ts` exports `characterUpdateStatement` at both
  release revisions (line 159 in each); it replaces the whole `characters.state` value. This is a historical export anchor, not a current module
  export claim. In this worktree the extracted
  `server/character_save_statement.ts::characterUpdateStatement` still replaces that
  value, rather than merging omitted JSON keys. An older snapshot writer can remove
  fields it does not emit; merely leaving new normalized tables untouched proves
  neither housing lifecycle behavior nor housing export/recovery compatibility.

- Post-answer base check (2026-09-06): PR #3872 remains OPEN with no merge timestamp;
  `git fetch origin --prune` passed and `git merge origin/feature/masterwrought`
  reported already up to date. No source or patches moved, so no non-empty-merge audit
  or frozen-lockfile install was triggered. The existing dependency protocol remains.
- Guild lifecycle source facts: the exported `PgSocialDb` class in
  `server/social_db.ts` has the point-lookup member `guildMembership`; its `guildMembers`
  path uses the exported `GuildRosterCache` class in `server/guild_roster_cache.ts`.
  The prior cached-roster citation is superseded by this verified owner.
  The `SocialTransport` contract in `server/social.ts` declares
  `onGuildMembershipChanged`; committed handling drives the `GameServer` callback's
  local `guildStampSeq` and the Sim `setPlayerGuildMembership` path. The actual
  exported `stampGuildMembership` helper in `src/sim/guild_bank.ts` remains a source anchor.
  Roster cache is a projection,
  not authoritative current membership or guild gameplay presence.

- Kitchen Garden source fact: `myFarmPlots`, a member of the farming world interface
  in `src/world_api/farming.ts`, projects the current character's `PlayerMeta.farmPlots`
  through `src/sim/professions/farm_projection.ts`; `farm_persist.ts` keeps those rows
  in character save state keyed by bed ID. It is not an automatic account-owner view.
  D52's account-owner tableau therefore needs an explicit bounded source aggregation
  keyed internally by sourceCharacterId plus bedId, without new beds or farming writes.
  The existing Harvest Journal action remains current-character; guests receive only
  the approved safe owner projection. The 24 producer's DB/source/cache/freshness proof
  must establish that new read contract before it is treated as implemented.

- Shared account-source facts: `server/db.ts::listCharactersAllRealms` selects the
  full character `state` and all matching rows ordered by realm and ID. It is not a
  bounded, projected loader for repeatedly opened housing surfaces. The existing
  `src/sim/professions/farm_projection.ts::farmPlotStatus` calls `farmPlotSurvived`
  with source-character farming proficiency, crop tier and normalized plot state;
  survival also depends on the private survival roll, compost and watch fields.
  Bed/crop/timestamps alone cannot reproduce the existing ready/withered distinction.
  17 therefore owns the NEW bounded shared account-source loader; 24 extends its
  static farm projection and removes those private inputs from guest wire. No current
  loader export or cross-realm live freshness guarantee is claimed by this fact.

- First fresh review source facts (2026-09-06):
  `src/sim/deeds.ts::onDungeonFinalBossKilledForDeeds` synchronously mutates each
  credited recipient's clear counters and dirty keys. It returns void; it is not a
  database commit callback. The private `detectActivity` member of `GameServer` in
  `server/game.ts` observes deedUnlocked, appends to the session's actual
  `pendingDeedRecords` field and requests ordinary `saveCharacter`. That save captures
  `recordUpTo` alongside its serialized source snapshot and publishes only the captured
  records after success. There is no existing pendingDeedUnlocks field or dedicated
  all-party dungeon-clear save transaction. 31 must produce its explicit clear-candidate
  capture-to-save bridge without changing recipient credit or claiming party atomicity.
- Screenshot source fact: `scripts/pr_screenshots.mjs` uses puppeteer-core with a
  Chrome/Edge/Chromium executable. Mobile variants default to an iPhone user agent and
  iOS graphics profile; `variant.userAgent` can explicitly override that profile.
  Compact/tablet dimensions alone do not make an Android capture, Safari execution or
  physical-device proof. The baseline is Chromium with iOS-profile emulation.
- Sampled audio source fact: `src/game/audio.ts` exports `GameAudio`; its
  `playFeedback` member is private and honors interfaceSfx. 09 owns the NEW public
  `GameAudio.playHousingArrival` method and sampled housing_arrival cue through the
  existing sound manifest/provenance pipeline; 19 integrates and verifies that output.
- Material source fact: `src/sim/professions/material_grades.ts::MATERIAL_GRADES` has
  nine node-material pairs across gather tiers 1, 2 and 3. Its upper node grades are
  fine_thorium_ore, fine_elderwood_log and fine_sunpetal_herb at gather tier 3; no
  node-material gather-tier-4 fine row exists. `src/sim/content/farm_crops.ts::FARM_CROPS`
  separately defines upper produce and fineProduceItemId rows, including tier-4 crops.
  Blueprint node fine inputs and upper produce therefore need their distinct sourced
  IDs; tool tier, crop tier and node material gather tier cannot be interchanged.
  The earlier verified myFarmPlots fact remains: it is current-character only; the
  NEW 17/24 account source boundary produces the approved owner-account projection.

- API catalog source fact: `src/ui/i18n.catalog/api_error.ts::apiErrorStrings` owns
  English apiError.* leaves and `src/ui/api_error_i18n.ts::API_ERROR_KEYS` maps server
  codes to them. `src/ui/i18n.catalog/hud_chrome.ts::hudChromeStrings` owns ordinary
  hudChrome.housing.* copy. 37's required error-catalog updates are not a runtime
  purchase surface and must use the API catalog owner, matching 01 and parity tests.
  The UX spec and its authored key manifest retain only hudChrome.housing.* player
  copy. Required runtime apiError.freehold.* leaves are protocol catalog mirrors
  mapped through API_ERROR_KEYS, with matching approved English, not a parallel
  housing HUD namespace or extra UX-manifest entries.
- Build-presence disconnect source fact: the public `socketClosed` member of
  `GameServer` in `server/game.ts` rejects a stale socket identity before marking
  its session linkdead. `server/ws_auth.ts` wires close/error into that path; a later
  leave happens only when grace expires. 08 must clear ephemeral editing presence
  inside the accepted socketClosed path immediately, preserving that stale-socket
  guard; waiting for leave would falsely display a disconnected editor.

- Capture fixture source fact: `src/game/daynight_dev_command.ts::tryDayNightDevCommand`
  accepts existing DEV day/night and moon-half presets through chat;
  `src/render/day_night_clock.ts::dayNightPhaseOverride` and `currentDayNightPhase`
  expose their renderer clock state. 09 owns twelve functional room day/night variants
  and the shared helper/import; later UI files extend the same target. No new clock
  storage key, balance time or early nonfunctional UI registration is introduced.

- Fresh anchor verification (2026-09-06): `src/sim/types.ts::SimConfig` is the
  exported constructor configuration consumed by `Sim` in `src/sim/sim.ts`;
  `SimOptions` is not that module's export. `src/sim/sim_context.ts::SimContext` owns
  the existing devCommands context field. 07 adds its housing-only permission through
  SimConfig, Sim and SimContext, preserving ordinary developer-command behavior.
  `server/heavy_self.ts` exports `HEAVY_SELF_CMDS`, `HEAVY_SELF_ARM_MARKED_CMDS` and
  `HEAVY_SELF_EVENTS`; the abbreviated ARM_MARKED_CMDS/EVENTS citation was inaccurate.
  08a must use the full exact exported names and update only the actual dirty-field arms.

- Citation typing verification: `server/game.ts` exports the GameServer class; join,
  leave and saveAll are its members, not standalone module exports. `server/social.ts`
  exports SocialTransport with onGuildMembershipChanged; `server/social_db.ts` exports
  PgSocialDb with guildMembership; `src/world_api/farming.ts` exports IWorldFarming
  with myFarmPlots. `tests/snapshots.test.ts` keeps ALL_DELTA_KEYS and TERSE_TO_IWORLD
  as file-local pins, and `tests/vite_dev_watch.test.ts` keeps defineConfigObject as a
  file-local helper. Their verified ownership is distinct from an export claim.

- Guild-clear admission source facts (2026-09-06):
  `src/sim/deeds.ts::FINAL_BOSS_DUNGEONS` is the current qualifying template census.
  The ordinary clear path uses the existing party/raid recipient snapshot bounded
  by `src/sim/social/party.ts::RAID_MAX`. The exported
  `src/sim/encounters/nythraxis.ts::nythraxisRoomMetas` instead collects every
  non-leaving player physically in the boss room, including former raid members;
  `grantNythraxisLockout` forwards that roster through
  `src/sim/deeds.ts::onNythraxisKillForDeeds`. RAID_MAX and suggestedPlayers do not
  bound this room roster. `server/ws_auth.ts` exempts administrators from its realm
  cap and disables the cap for nonpositive MAX_PLAYERS_PER_REALM, so that setting
  is not a hard source-capacity bound.
  `src/sim/instances/dungeons.ts` owns exported enterDungeon/resetDungeonInstances
  and private claimInstance/freeInstance: ordinary claims, Reset All and the
  developer Ignivar-family replacement mutate different claim/aura paths.
  `src/sim/dev_commands.ts::spawnMobsForDev` can publish qualifying bosses outside
  claims; `src/sim/mob/lifecycle.ts::respawnMob` reuses an entity ID for another
  creditable life, while the private updatePendingMobRespawns member of Sim can
  create replacement entities. Entity ID alone is therefore not a clear-life key.
  `server/sim_boot_config.ts::buildRealmSimConfig` already requires injected
  Materials Vault admission, the existing online composition precedent. The
  ordinary GameServer saveCharacter member, with its captured pending prefix,
  remains the actual save seam; no all-party clear transaction exists. Its existing
  no-state/no-entity arm can return true when the captured storage effects and bank
  ledger snapshot are empty, after capturing recordUpTo, without a source-state
  commit. That legacy boolean alone cannot prove NEW GuildClearSaveOutcome.committed,
  release a captured candidate or authorize an unlock. 31 requires its exact typed
  committed source-snapshot/effect outcome, not the old boolean result.

## Locked decisions
Rulings (proposal section 12, adopted 2026-09-05, never reopened): personal first and
one system; account-level ownership; convert fiat and SOL to $WOC and burn a published
share (counsel and the economy service gate the mechanism); daily wear with a weekly
ledger; land money-only with everything inside earnable plus the free Inn Room; on-chain
deed on demand in wave D, web only; mobile use-only with purchases on the web; the
illustrative price ladder and 25 percent burn share as working numbers; the names.
Additions: the app-store constraint (section 8); produce joins the Ledger; the Kitchen
Garden plants nothing (zero beds); the Master Builder's Call is Claudium-priced.

Original survey decisions D1 to D26 are preserved below as their historical adoption
record. Later explicit decisions refine their scope or timing where noted.

Label legend: C01 and C03 are packet-review finding labels (the C1-C34 series R44 cites)
whose source-reviewed corrections are recorded as the two refinements under
"Source-reviewed Hearth and build-presence refinements" below. Each binds an approved
decision to the reviewed tree (C01 refines D67's shared Hearth cooldown; C03 refines the
visitor experience without renaming a D20 member) and adds no balance constant or new
ruling; the refinement under "Source-reviewed arrival delivery refinement" binds D41 the
same way.

- D1 **Charter purchase shape.** The Freehold Charter is a once-per-account grant the
  economy service records (`owned: true`, the weapon-skin model), mirrored into a new
  `account_freeholds` row by a `configureClaudiumRuntime` hook and healed by the
  `/api/claudium/store` reconcile. It rides the existing `POST /api/claudium/spend` route
  with a game-side SKU allowlist (`src/sim/content/freehold/charters.ts`, the
  `STORAGE_SKUS` twin) and a new spend kind `freehold`. The storage flow's pending-row and
  recovery machinery is NOT reused: a plot is account state, not a live bag mutation.
- D2 **The Inn Room is tier 0 of one ladder.** One freehold record per account. Every
  account holds the free Inn Room (no upkeep, three plinths, a bed); the Cottage is an
  in-place tier upgrade of the same record, and the three plinths' trophies carry over.
- D3 **Offline hosts hold the Inn Room only.** The browser offline world and the headless
  env own the full sim module, but the Cottage tier arrives only as a server-applied grant.
  Offline, the Cottage exists through `/dev freehold cottage` under `ALLOW_DEV_COMMANDS=1`
  and in tests. Land stays money-only.
- D4 **Furnishings are a descriptor, never entities.** The layout crosses the wire as a
  small descriptor (rows of furnishing id, cell, yaw) on a pid-scoped `freeholdState`
  event, re-sent on resume like the rift floor; both hosts regenerate geometry and runtime
  colliders deterministically (the `setRiftRegion` region API). Only the handful of
  interactables (for example the gate door, the Strongbox, the station, a placed feast,
  and in later waves the boards, chests, and vendors) are `kind: 'object'` entities
  riding the normal interest-scoped snapshot.
- D5 **Freehold state is account state.** Persisted in its own `account_freeholds` row
  (`server/freehold_db.ts`), loaded once at fresh join beside the bank bonus facts, never
  inside the character blob (an alt's stale blob must never resurrect a layout). Live
  state is keyed by owner key (`account:<id>` online, `entity:<pid>` offline per D15),
  never by pid, so two
  characters of one account online at once share one house.
- D6 **The Strongbox is bank access at home.** An interactable in the plot that satisfies
  the banker proximity gate for the owner. No new container, no dupe surface; the bank
  window and its item-cell mark family come for free. Locked below condition 30.
- D7 **The station amenity composes into the existing gate.** A `StationDef`-shaped anchor
  inside the plot joins the station list handed to `isAtStation` and `inRangeStationTypes`
  for the owner; recipes and their `stationType` gates are unchanged; training still
  requires the town station (`resolveTrain` is untouched). Locked below condition 30.
- D8 **Nothing ticks.** Condition derives at read time from a stamp and elapsed realm days
  (`ctx.resetDay`, the farm absolute-deadline idiom); the ledger week reuses the realm
  weekly reset; the paid week is an indexed column evaluated at join, claim, and pay, never
  by a per-tick sweep. Visitors are the live claim roster (`InstanceSlot.enteredBy`), not a
  persisted log. Refined by the source-reviewed lifecycle extension boundary below: the
  indexed-column wording does not require a speculative standalone Ledger index (query
  predicates, ordering, cardinality and reverse-FK/retention needs determine the reviewed
  indexes), and the no-tick rule concerns housing economic work, not the renderer/input's
  ordinary frame consumption.
- D9 **The distribution surface map is one pure client module** with a seven-distribution
  matrix test (web, website desktop, Steam, Epic, App Store, Google Play, Seeker dApp
  Store) and a `HudFeatures.freeholdPurchaseEnabled` row. The server never learns the
  distribution; the housing purchase surface is a client gate STRICTER than the Claudium
  store's `!NATIVE_APP` rule (section 8: no purchase surface on Steam or Epic either).
- D10 **Text-free events.** Every housing deny and grant is an id-carrying, pid-scoped
  `SimEvent` (the `farmDenied` model) resolved to `hudChrome.housing.*` keys client-side;
  no `sim_i18n` or `server_i18n` matcher rows unless a phase proves it needs an English
  emit.
- D11 **The RL env excludes housing**, recorded in `headless/CLAUDE.md` beside the farming
  cut and pinned by an `ACTIONS` exclusion test.
- D12 **One PR per wave**, each off the base with `FREEHOLDS_ENABLED` defaulting off; the
  packet teardown offer comes at the very end (wave E close).
- D13 **Art is the long pole and gets stand-ins.** Furnishing and trophy GLBs land in a
  dedicated wave A phase through the `image-to-glb` skill; earlier phases render a
  stand-in kit so every code path is testable before the art exists. Item icons (WebP)
  ride the content phases as same-change obligations, as the repo requires.
- D14 **A furnishing recipe belongs to an existing craft.** Ten crafted pieces, one per
  craft, on the proposal's mapping (section 6.5); Carpenter and Mason stay a wave E option.

Additional decisions locked at packet creation from the sim survey:
- D15 **The freehold rides the dungeon slot pool, owner-keyed.** Two `DungeonDef`
  records in `src/sim/content/freehold/dungeons.ts` (`freehold_inn_room` at index 15,
  `freehold_cottage` at index 16, both `spawns: []`, `guideVisible: false`, absent from
  `FINDER_ACTIVITIES`), a new `DungeonDef.claimKey?: 'party' | 'owner'` (append-only), and
  `meta.freeholdOwnerKey` stamped by the host at `addPlayer` (`account:<id>` online, the
  `feastOwnerKey`-style `entity:<pid>` fallback offline), session-only and listed in the
  parity `META_EXCLUDE`. Guests enter under the owner's key exactly as a party member
  joins a claim. Occupancy and reaping ride `updateInstances` unchanged. No new band, no
  new pool primitive.
- D16 **Live state is a Sim-owned map keyed by owner key**: `ctx.freeholds: Map<ownerKey,
  FreeholdState>` with the guild-bank load/serialize/evict idiom (`loadFreehold`,
  `serializeFreehold`, `evictFreehold`), so two characters of one account share one live
  record. The server persists it in `account_freeholds` with a `rev` compare-and-swap
  upsert (a stale write is refused, never merged). Offline hosts persist NOTHING: the
  offline world is a fresh `Sim` on every entry (every `serializeCharacter` caller lives in
  `server/`, pinned by `tests/professions_farming_state.test.ts`), so a fresh offline Sim
  starts with the default Inn Room record, pinned. Nothing lives only on the instance slot.
- D17 **Furnishings are walk-through in wave A until Phase 10**, which generalises the
  runtime collider region registry (`allocRiftCollisionToken`, `setRiftRegion`,
  `clearRiftRegion`) beyond the rift band and publishes the owner's placed-furnishing
  colliders per claim under ONE collision token per claim (allocated at claim on the
  `InstanceSlot`, released on free; the server holds many claims at once). Every
  furnishing def carries a REQUIRED collision radius `r` from Phase 03 on (`r: 0` means
  walk-through, as for a rug), so Phase 10 adds no content churn.
- D18 **The plot's crafting station may draw from the vault.** `vault_craft_gate.ts`
  gains an explicit arm for "standing in a claim you own with a built station", because
  the proposal's bags-then-vault rule for crafts at home outranks the open-world-only
  default (pinned by a negative case for a visitor's plot).
- D19 **Trophies are furnishing-shaped records, never items.** `trophy_eligibility.ts`
  maps deed ids, illuminated Reliquary pages, `slain:*` marks, owned mounts, and the
  `perfected` stamp to trophy prop ids; `syncTrophyUnlocks(ctx, meta)` runs after the
  join retro block and on first entry, reads only, and records unlocks in the freehold
  record with `retro: true` events. Trophies occupy plinth slots, cost no decor points,
  and are never tradable.
- D20 **Facet member names.** The packet renames the proposal's section 11 facet sketch
  (`freeholdInfo`, `freeholdPlace`, `freeholdMove`, `freeholdRemove`, `freeholdRepair`) to
  `myFreehold`, `placeFurnishing`, `moveFurnishing`, `removeFurnishing`, `payLedger` (the
  farming facet's verb-first style). Do not rename them back.
- D21 **Ruling 6 outranks the section 8 Seeker row for deed surfaces.** Every on-chain
  Freehold Charter surface (mint, trade, holder flair) is web and website-desktop only;
  the Seeker dApp Store row is OFF for deeds. The Seeker PURCHASE row (Claudium) is O4.
- D22 **Only amenities lock below condition 30.** Placement, moving, removing, undo, and
  entry never lock on condition (the proposal locks stations, the Strongbox, and trophy
  finishes; the door always opens). The in-world cosmetic wear (cold hearth light, dull
  trophy finishes) lands with the finishes in Phase 23.
- D23 **Layouts are content.** `INN_ROOM_LAYOUT`, `COTTAGE_LAYOUT`, and every later tier
  layout live in `src/sim/content/freehold/layouts.ts` (data-as-code);
  `src/sim/dungeon_layout.ts` keeps the helpers and the Dawnhold exemplar. The Hearth Key
  item def lives in `src/sim/content/freehold/items.ts`; its use arm and cooldown logic in
  `src/sim/freehold/hearth_key.ts`.
- D24 **The dev grant.** `/dev freehold <tier>` under `ALLOW_DEV_COMMANDS=1` (offline and
  the server dev path) sets the record's tier through a setter in
  `src/sim/freehold/state.ts`, lands in Phase 07, is refused without the flag (pinned),
  and is what the perf tour and the offline Cottage use. Phase 15's Charter grant reuses
  the same setter; Phase 21 extends the command for `lodge`. Refined by D81: the setter
  and the command land in Phase 05 with the default tier-0 Inn Room record; Phase 07
  persists the record and adds the save behind the same setter.
- D25 **Furnishings are Exchange-eligible** at every rarity (the mount rule, proposal
  section 6.5), decided and pinned once in Phase 02; the Exchange itself stays behind its
  existing web-only gate, so no native or Steam or Epic build reaches a furnishing trade.
- D26 **One deny-line selector.** `freeholdDeniedLineKey(reason)` lives once in
  `src/ui/hud/housing/housing_view.ts` over one `hudChrome.housing.denied.*` namespace;
  every later phase appends rows to it, never a second selector or namespace.


### Settlement decisions approved 2026-09-06
Fernando answered the complete batch: "approve all recommendations." The answered
[ruling sheet](ruling-sheet.md) preserves each original question, rationale and exact
response. R01-R46 map in order to D27-D72. External acceptance remains a release gate,
not an unresolved product question.
- D27 **Service catalog and operation authority (R01).** Produce the service-contract draft now: catalog and versioned quotes; account/plot/guild-bound idempotency; durable discoverable intent, receipts and recovery; guild pooled balance; refunds; outage intervals; published conversion/burn schedule. Preserve D9 through a NEW service-owned eligible-checkout issuer/verifier and opaque authorization bound to account, purpose/SKU, policy, quote and operation; the game server receives no distribution label. 15 validates initial SKUs, later priced files append their rows. Signed service acceptance and published catalog are release gates.
- D28 **Counsel, Terms and platform handoffs (R02).** Produce a counsel memo draft, Terms amendment draft, seven-distribution listing/review-notes draft and territory/authority schedule now. Require written acceptance before production enable or a housing-bearing storefront submission. Include Apple multiplatform/IAP and NFT-unlock analysis; make no approval claim.
- D29 **Purchase and independent management capabilities (R03).** Charter and Call purchase only on browser web and website-distributed desktop. Seeker use-only, deeds off. Model website-management as an independent capability, default off on denied storefronts unless the complete destination/flow receives written approval. In-world material payments remain available.
- D30 **Cumulative gates on every priced surface (R04).** Preserve counsel, published Terms and accepted economy-service gates in every priced implementation and QA, including suffixed files and 32/40. All complete purchase submodels, handlers, fetched catalogs, hidden DOM, errors and accessibility text obey the distribution capability.
- D31 **Attributed working values (R05).** Retain the existing values in the explicit inventory below as owner-adopted working targets. Remove unsupported Conan/ArcheAge/GW2 attributions. Every service price stays a quoted service result; no working USD or multiplier computes a payment.
- D32 **Published produce-inclusive weekly schedule (R06).** One published schedule per realm week, independent of owner. Every bill includes produce plus allowed rotating nonproduce families, within the existing three-to-five-line target. Create the exact eligible-ID and calibration worksheet now; 03 authors reference-derived trial bills, 13 validates versioned schedules and immutable prepaid bills, 20 owns the four-week measured report. Fernando/service approve literal bills before enable.
- D33 **Numeric provenance and calibration (R07).** Create one content manifest and numeric provenance worksheet. Each row names source item/recipe or measured model, derivation and rounding, owner and producing file; unreferenced gameplay rates require Fernando's signed tuning appendix before activation. No inferred inventory max-stack quantity, keystone, gear intermediate or quickening catalyst enters a bill.
- D34 **Call effect and current Ledger (R08).** A confirmed Call satisfies the current unpaid weekly bill and restores condition to 100, without adding future prepaid weeks or consuming existing future credits. If current bill is already paid, its quoted repair-only result is explicit before purchase. Correlate receipt to operation, account and plot.
- D35 **Suspension history and credit preservation (R09).** Add authority-fed persistent suspension intervals to 13/13a and service contract. No wear or debt catches up for suspended time; simulated arithmetic uses injected calendar data, never network or wall-clock calls. Preserve paid rate versions and prepay credits. Partial weeks retain the fixed flat repair bill, with no prorating or added outage charge; missed weeks never accumulate back bills. A wholly suspended billing period consumes no prepaid credit; carry it forward without repricing.
- D36 **Account/guild return protection and threshold (R10).** Retain the protective 7/3 policy; derive and persist the prior-absence/grace transition before updating presence. Alts cannot refresh grace repeatedly; guild absence uses eligible member presence. At condition 30 amenities work; only below 30 they pause. Entry/build/undo always work, including 0. Refined by 07b's source review (cite as D36 as refined): admitted gameplay presence, never authentication login (touchLogin / accounts.last_login), is the absence source; 07b carries that contract.
- D37 **Explicit payment source mode (R11).** Make source choice explicit: bags-only, vault-only, or automatic bags-then-vault. Affordability, confirmation and actual atomic deduction use the same mode. Prepay chooses the same source mode and shows the entire fixed batch before committing.
- D38 **Exact roster and final art (R12).** Lock an 18-piece Wave A roster (eight vendor, ten crafted, three pattern recipes within the ten), twenty additional crafted outputs in Wave B with produce decoration counted inside that roster. Produce exact room/furniture/trophy art briefs and reference manifests now. Every wave requires final art for its shipped IDs; art sessions generate approved reference sheets through image-to-glb intake.
- D39 **Measured geometry and finite storage bounds (R13).** Bind them to the authored room/model measurement manifest: aligned floor grid and clearance, transformed model bounds, explicit walk-through rugs, protected door/arrival paths, tabletop/ceiling anchors. Derive finite row/byte ceilings from the largest legal approved layout, including nested/saved copies; enforce before mutation/load. No freehand numeric guess.
- D40 **Shared design foundation (R14).** ux-spec records both the adopted target and verified current token mapping. Housing reuses the actual shared window/theme family; 11 owns an explicit foundation readiness check against DESIGN rollout. Switch only when the coordinated foundation lands. No local theme fork, nonexistent window_frame reuse or global redesign hidden inside housing.
- D41 **First moment in Wave A (R15).** Deliver them in Wave A through 06/09/11/19: interact at gate, choose destination, authoritative arrival pose, short skippable safe hearth view, immediate reduced-motion/control handback, keyed welcome, sanctioned sampled cue once per confirmed arrival, realm-daylight continuity and condition-readable hearth. Refined under "Source-reviewed arrival delivery refinement" below (the section after the C01 and C03 refinements): the cue and welcome are delivered at-most-once per accepted transition, best-effort, through 07c/08a's nullable freshArrivalPresentation directive; a committed arrival followed by a lost ACK or process failure may omit them, and no exactly-once presentation is guaranteed.
- D42 **Complete build-mode interaction (R16).** Wave A gets a detached bounded build camera; bags-family furnishing palette and Trophies tab; footprint/ghost with shape+hatch+reason for rejection; rotate/nudge; session undo/redo; decor/plinth/amenity meters; explicit touch Confirm/Rotate/Cancel 40x40 with safe areas; keyboard/gamepad equivalents. Palette is a nontrapping world companion; Steward/trophy decision windows use ordinary focus/return contracts.
- D43 **Bounded advanced placement scope (R17).** Wave B supports bounded free planar translation/free yaw plus typed floor/wall/table and fixed ceiling anchors for chandeliers, with parent movement atomic. Exclude arbitrary scale, full-axis gimbal and collision-leniency mode from this packet; correct proposal/deck accordingly. Boundaries, doors and clearance never become optional.
- D44 **Bounded placement-only undo and redo (R18).** Placement-only session journal, undo and redo available from 11, bounded by maximum legal placement-row capacity. Store exact-copy identity and revision preconditions; stale inverse refuses atomically. Clear on plot/session change or incompatible external revision with keyed explanation. Money, ledgers and completed sales are outside undo.
- D45 **Global light-budget fairness (R19).** Three authored room emitters is a ceiling, allocated through the existing light sink and live global budget; iOS may have two and pressure may leave one. Ambient/key grade, texture and silhouettes keep the room beautiful and legible. Ghost, blocked reason, floor bounds and capacity information are identical at every tier.
- D46 **Exact screenshot acceptance (R20).** Define shared housing capture helper and exact registry entries in 11/16/17/18, reconciled to planned file names. 20 requires desktop 1600x900, compact 874x402 and tablet 1180x820, plus focus, touch, gamepad, reduced motion, theme, denied-store and LOW-iOS cases.
- D47 **Strongbox and station access (R21).** Strongbox is built-in personal-bank access, no amenity-slot cost. A station uses the slot. Direct Materials Vault chest remains Manor unlock; home station draws permitted personal vault materials through D18. Guild chest exposes guild bank; authorized guild members may craft from their own vault at hall stations. Service-specific authorization stays separate from geometry.
- D48 **Account-wide truthful trophy eligibility (R22).** 17 owns authoritative account-wide eligibility and event-driven refresh for all promised deed/relic/item/mount/title/Perfected sources. Every qualifying source gets a truthful generic display if bespoke form arrives in 23. Preserve known source character/day; unknown history explicitly says unknown. Preserve hidden-content spoiler rules. PREMISE NOTE (release/v0.44.0 sync): the release's account ledger already carries the deed, relic, mark and mount sources with earner character and day; phase-17-trophies.md item 2 records the owed re-plan.
- D49 **Full Hearth shelf contract (R23).** Add the new Hearth shelf through the actual catalog/nav/order/localization/source/completion contract, append curated furnishing pages without reordering existing IDs. Furnishing items qualify; patterns and trophy records do not. Track exact inventory and remeasure fingerprint pins, never treat current totals as maximums.
- D50 **Explicit gate and offline-owner visiting (R24).** Interact opens own-home/friend-by-name prompt; proximity never auto-teleports. Support authorized visits while owner offline using bounded lookup/lazy load and global ownership fence. Runtime pool/foreign-realm claim saturation gives honest retry, never loss or an ownership waitlist. Refined by D76 (the friend admission fact is the named owner character's outgoing friend list; the visitor's own list is never an input; a block row on either side refuses; friendAdd/friendRemove/blockAdd bust through a NEW mutation-site hook).
- D51 **Current visitor authority and safe ejection (R25).** Entry always checks current authority. Private stops new visitors; existing admitted guests may finish until exit unless owner uses End visit. Blocking, revoked relationship/membership or explicit End visit safely ejects immediately. Owner can end a visit without changing property ownership. Refined by D77 (guild-owned plots admit members always; guild/public/private only for the guild owner kind; non-members enter as guests under these ejection rules) and by D76 (the hook triggers this recheck).
- D52 **Kitchen Garden public tableau (R26).** Project existing owner farm bed/crop/stage/status publicly without private inventory/timers. Owner board opens their own Harvest Journal; guest gets read-only owner tableau only. Produce props use existing cooking recipes or gold vendor decoration within R12 roster.
- D53 **Pattern channels and excluded seasonal sets (R27).** Preserve adopted raid/rift/Marks doctrine, no delve channel. Every later rare pattern has one named luck channel plus Marks in its manifest; Wave A remains Marks-only. Seasonal furniture sets are explicitly outside this packet; ownership of existing decoration never expires.
- D54 **Service-owned Hall Fund and donor target (R28).** Service owns guild pooled Claudium balance and debit/credit ledger; game mirrors absolute versioned results. Materials/gold and donor cap/audit update atomically. Proposed anti-dominance target: one current weekly Hall Ledger-equivalent per account per realm week across alts; the signed calibration artifact defines resource/currency allowance and rounding without game-side token conversion.
- D55 **Guild layout and member trophy custody (R29).** PREMISE MOVED 2026-09-26: "officer" is no longer a rank but a stamped bank tier; see "Premises the 2026-09-26 sync moved", G1 (a ruling owed before 28). Officers manage hall layout, members manage only their own assigned trophy plinths. Departing members retain unlock/provenance and their displays detach safely. Guild-first-kill credit uses existing eligible participant clear credit and records each qualifying participant's guild at that clear; multiple represented guilds can qualify. No invented percentage threshold or speculative retro credit from current membership.
- D56 **Guild boards and cosmetic project completion (R30).** War table explicitly shows authorized guild raid lockouts and recorded first kills, with unavailable first-kill section until 31. Projects finish when approved material/fee conditions are met, no artificial multi-week wait. Completion unlocks cosmetic furnishing vendor stock only, never training/combat bypass.
- D57 **Transactional Ward capacity and anchor (R31).** Retain 50 plots and 24 admitted occupants as TUNING, not culling. DB transaction authorizes unique slots/capacity with bounded indexed candidates and stable lock order. Largest represented guild anchors, deterministic ID tie-break; no guild means no anchor. Footprint measured against allocator before art.
- D58 **Permanent Favor and monthly Endeavors (R32).** Favor-unlocked decor capacity is permanent. Monthly Endeavor progress resets on the authority's UTC calendar month, independently of capacity. Keep four ranks/+10 targets; content manifest fixes event weights, thresholds and rewards through approved calibration before enable.
- D59 **Realm Showcase identity and result (R33).** Realm-wide opt-in Showcase, one authenticated account vote per realm season, no self-vote, no eligibility reset by ward move. 13-week seasons align to published realm weekly anchor. Tie-break earliest valid entry then stable ID. Persist close/reward identity before bounded delivery.
- D60 **Closed guest-book reactions and rate (R34).** Closed reactions wave/cheer/admire, no free text; proposed one reaction per account per plot per realm day. Per-plot insert/prune serializes with deterministic oldest order; 50 cap tested concurrently. Give entries, votes and books separate indexed retention/fold policies with durable season result.
- D61 **Stable plot identity and atomic custody (R35).** Stable opaque public plot identity from 07 with account+plot-index lookup, primary-only admission initially. Internal account/guild keys never cross viewer wire. Globally fenced plot ownership permits one authoritative active claim per plot across realms; conflicting realm entry gives busy/retry. Character FIFO then owner/shared-resource serialization; bounded atomic transaction pairs inventory, housing, funds and receipt effects.
- D62 **Durable recovery and bounded save work (R36).** Housing-specific durable receipts are permanent replay authority, with recoverable intent before spend and no DB locks across service IO. Retain compact applied identities unless an accepted service replay horizon permits proven compaction. Coalesce saves to one running+one pending dirty generation; all background producers share admission and workload deadlines.
- D63 **Upgrade overflow and prestige eligibility (R37).** Preserve fitting exact copies. Preview overflow; if bags cannot safely accept it, refuse completion before new fee/material mutation. Top two personal tiers share an existing account prestige OR: prog_legendmaker, col_reliquary_rank_5, dgn_nythraxis, dgn_ignivar or dgn_varkhul. Guild top tiers use their own qualifying recorded raid-clear deed.
- D64 **Furnished-plot transfer custody (R38).** Honor furnished-plot sale: explicit immutable manifest contains shell/tier and eligible transferable placed furnishings only. Seller trophy unlock/provenance, bound/personal copies and omitted goods remain theirs in verified safe custody. Verify entitlement transfer and recovery atomically after service confirmation; native consumes server entitlement, never on-chain access. Refined by D80: buyer capacity (index 0 at tier 0 before 42, a free index under 42's two-plot cap after), the literal refusal freehold.deed.buyer_capacity, the seller's fresh tier-0 record at index 0 with account trophy unlocks retained, and Ward Favor capacity awards travelling with the stable plot ID.
- D65 **Per-asset authority and signed territories (R39).** Per-asset permanent delegate at mint, not collection-wide freeze. Low condition never destroys house, contents or access; no automatic lapse burn. Transfer/moderation restriction and irreversible burn triggers require explicit signed authority. Signed supported-country list, unknown-country refusal; no KR-only legal conclusion.
- D66 **Dyes and bounded layout sharing (R40).** Retain counts. Art/content manifest supplies eight exact palette/name/source rows using approved material colors; no guessed RGB/rates. Dye station requires its amenity/proximity and condition 30+, while ordinary placement remains unlocked. Saved layouts use bounded per-plot storage; share codes carry version/tier/public layout only.
- D67 **Independent second plot and shared Hearth (R41).** Primary-first myFreeholds, myFreehold remains primary alias; stable plot IDs from 07. Independent condition/prepay/visits/ward slot. Each second-home integer material line is ceil(primary approved line times 1.5). Hearth defaults primary, owner selects destination in Steward; shared account cooldown prevents bypass. Refined by D80 (Ward Favor capacity awards are properties of the stable plot ID and travel with the plot; after 42 a purchased plot may occupy the account's free index under the two-plot cap; the second SKU's price is the service's CAL-SERVICE row). Refined per D93: the second plot is granted at the Cottage tier and upgrades through the same build projects as the primary with every integer material line at ceil(1.5x); its weekly Ledger and prepay lines follow the same ceil(1.5x) rule (CAL-LEDGER-A); there is no second-home upgrade refusal; a third plot refuses with freehold.second_plot_cap; a sold primary is replaced by the seller's fresh tier-0 record at index 0 while a sold second plot frees index 1 with no replacement record. Per C01, the Hearth Key's authority is the account's, never the item's: owning the item grants no admission authority, and the combat, dead and jailed refusals apply.
- D68 **New professions excluded (R42).** Explicitly exclude new professions from this packet. 43 produces a measured future-expansion handoff and records no implementation of new crafts. Existing ten professions deliver the complete furnishing program.
- D69 **Base protocol and recurring budget review (R43).** Record actual clean sync at 7d140843d2; PR #3872 OPEN and base already current. Follow existing merge-forward until it merges, then newest release and remove dependency block. Correct no-offline-persistence summary. 20 creates durable every-second-release budget review with measured LOW evidence, never automatic increases.
- D70 **Bounded suffixes and complete reviewer coverage (R44).** Split into suffixed implementation/QA pairs without renumbering, including further splits needed by new acceptance. Update every index/progress/next-file chain. Every file names all actual triggered reviewers; DB review before design and on final diff. Fix fifth-versus-ninth prepay boundary, stale auth tests and all reported nits.
- D71 **Durable preservation and actual next file (R45).** ux-spec is durable. Any future authorized scaffolding teardown first preserves it and linked decisions/contracts under docs/prd/woc and proves links, never deletes the only source. Actual next file is /Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds/docs/freeholds/phase-01-foundation.md.
- D72 **Narrow requested memory update (R46).** Permit only the specifically requested freeholds memory entry to be updated with the resulting local tip, packet SETTLED and actual next-file path; no other memory or runtime-setup changes.
- D73 **Final legal-team revisit and handoff.** After implementation and final artwork,
  44b revisits all Terms, counsel, store/platform, service, territory and per-asset
  authority material against the completed feature and prepares its concrete legal-team
  handoff and sign-off tracking. This final review supplements every earlier written
  release/submission gate; it never postpones permission needed for an earlier release.
- D74 **Codex executes every asset-producing implementation.** Every step generating
  shipping GLBs, models, textures, icons, reference images, other images or audio assets
  explicitly requires Codex, not Claude, and the existing repository asset/image/SFX
  pipeline, provenance, quality and performance gates. This packet session creates
  documentation only and does not manufacture assets or claim their approval.
- D75 **Final Codex placeholder-art replacement.** 44a inventories every feature-created
  placeholder icon/image, replaces it through the existing Codex image workflows,
  verifies final art in context and hands its evidence to 44b. It follows 44 QA and
  precedes final legal handoff. No scaffolding deletion or terminal completion precedes
  44a/44b and their paired QAs; durable UX/decisions/contracts remain preserved.

Refinement map for the preserved original record: D29 resolves D21's former O4 as
Seeker use-only; D41 brings D22's hearth/cosmetic readability into Wave A; D47 narrows
D6/D7 to service-specific personal-bank/station gates; D61/D62 specify the atomic
housing-operation foundation without reusing storage-purchase ownership; D68 closes
D14's optional professions as excluded. D71/D73/D75 supersede D12's earlier teardown
and terminal timing, while D38/D74 preserve D13's temporary implementation stand-ins
only until the required final-asset acceptance. D87 keeps D12's one PR per wave and
assigns it an owner for every wave: 20 (A), 27 (B), 33 (C), 39 (D) and 44 (E) each carry
the STOP-and-ask push-go arm, and 27 reads <wave-a-head> as the local tip recorded at the
20 QA PASS or the wave A PR head when one exists. D1-D26 themselves are retained
unchanged.

### Settlement round 2 (independent review, 2026-09-06)

The independent packet review of 2026-09-06 found decision gaps that no D1-D75 or R01-R46
row covered. Each is recorded here with its recommended disposition applied throughout the
packet; the ruling sheet's second round (R47-R64) carries the exact question and the word
column; Fernando approved R47-R64 on 2026-09-06 ("approve all recommendations R47-R64"),
so every round-2 row is settled.

- D76 **Visitor friend admission (R47).** The friend admission fact is: the named owner
  character's outgoing friend list contains the visitor's character
  (friendships.character_id = owner, friend_id = visitor), read through
  whoFriended(visitor) or listFriends(owner) in the bounded on-open lookup and rechecked
  at entry. The visitor's own friend list is never an admission input. A block row on
  either side refuses. friendAdd, friendRemove and blockAdd bust the visitor projection
  through a NEW mutation-site hook and trigger the D51 ejection recheck;
  sendSocialSnapshot is not the feed. A name that resolves to an alt resolves to that
  account's plot, and only the named character's friend list is consulted.
- D77 **Guild-plot visiting policy (R48).** PREMISE MOVED 2026-09-26: "officer" is no longer a rank but a stamped bank tier; see "Premises the 2026-09-26 sync moved", G1 (a ruling owed before 28). Guild-owned plots admit current members
  always. visit_policy for the guild owner kind is set by the leader or an officer and
  accepts only guild, public or private; friends is refused for that owner kind. Public
  admission is capped by the tier column; the Meeting Hall cap is the Cottage row until 32
  sets its own. Non-members enter as guests under the D51 ejection rules.
- D78 **Hall Fund end-of-life (R49).** PREMISE MOVED 2026-09-26: "officer" is no longer a rank but a stamped bank tier; see "Premises the 2026-09-26 sync moved", G1 (a ruling owed before 28). The service contract gains a Hall Fund end-of-life
  row: on disband the pooled service balance is refunded pro rata to donor accounts by
  original receipt as separately identified immutable refund operations; the game only
  requests the operation. 29 adds an officer-plus withdraw-to-guild-bank verb for fund
  materials and gold on the 07a rail. The explicit safe disposition in 28a means fund
  materials and gold at zero and the service balance settled or refund-requested.
- D79 **Keep-forever guild history and disband (R50).** A guild that holds any
  keep-forever housing row (guild_deeds, first clears) is never hard-deleted. Disband
  becomes the 28a tombstone disposition: the guild row is retained with a tombstone status, member
  rows are removed, the realm name is released by a tombstone-aware uniqueness rule, and
  guild_deeds rows stay attached. The disband guard extends the existing
  beginGuildBankDelete guard at BOTH deleting call sites (disband and last-member leave)
  before any member row is deleted. GM character or account deletion routes through the
  same guard: leadership passes to the highest-ranked remaining member or, with none, the
  tombstone disposition applies with fund disposition per D78. earned_by stays a nullable
  FK beside an immutable captured public name and realm snapshot written at commit;
  projections read the snapshot.
- D80 **Furnished-plot transfer admission (R51).** Buyer capacity: the purchased plot
  occupies the buyer's plot_index 0 only when that record is at tier 0 (Inn Room); the
  buyer's retained copies and displays are previewed to a safe destination by the same
  manifest rule as the seller's; otherwise the operation refuses with the literal code
  freehold.deed.buyer_capacity. After 42, the purchased plot may occupy the buyer's free
  index under 42's two-plot cap. The seller receives a fresh tier-0 record at index 0 with
  account trophy unlocks retained. Ward Favor capacity awards are properties of the stable
  plot ID and travel with the plot; the seller's fresh record starts at the base budget.
  D64 and D67 are refined accordingly.
- D81 **Default Inn Room record before persistence (R52).** 05 creates every account's
  in-memory tier-0 Inn Room record as part of the claim model (the record D2 says every
  account holds), together with the D24 development grant fixture the perf tour and the
  Cottage captures use; 07 persists that record without changing its identity. 06's
  offline entry and captures depend on 05, not on 07.
- D82 **War table first-kill client seam (R53).** 31's first-kill projection reaches the
  client through the same NEW bounded sibling read 30a names for missing lockout
  projections (behind the current guild domain RouteDef registry with current-authority
  checks), with keyed ready and empty states in the hall boards view and its test; no
  facet member is added, so the parity pin is unchanged. 31 gains an Agent CLIENT slice,
  its suites, its commit and its acceptance box.
- D83 **Housing capacity never gates gameplay (R54).** Guild-clear recording capacity
  never refuses GameServer.join, enterDungeon or a respawn. Exhaustion records a bounded,
  auditable clear-not-captured gap with an operator alert; character rewards, loot and
  existing deeds are unchanged and guild credit for that clear is simply not captured.
  Every busy arm binds only to source activation or credit capture. The 07b join-time
  reservation hook publishes the session regardless of capacity.
- D84 **Calendar clocks (R55).** Every has-the-day-rolled-over fact (ledger, upkeep,
  prepay, condition, guest-book daily admission, Showcase realm week, the per-account
  weekly cap through ledgerWeekOf) uses the realm day resetDay (03:00 in the realm reset
  zone) and the Tuesday week anchor emberWeekAnchorOf. The sim consumes day-keyed facts in
  the resetDay vocabulary; the server produces them with resetDayKey(ms,
  REALM_RESET_TIME_ZONE); epoch-ms fields are display-only. utcDay stamps when something
  happened (deed days, provenance). The Endeavor month is the UTC calendar month
  utcDay.slice(0, 7) per D58, never resetDay.
- D85 **Dark realm behavior (R56).** The sim takes a freeholdsEnabled boot config beside
  devCommands on the SimConfig seam. On a dark realm the Eastbrook gate prompt, the
  furnisher and its stock and the Hearth Key are neither spawned nor sold; the offline
  host stays live under D3. 03 and 06 inherit the rule and a flag-unset server test pins
  it.
- D86 **Purchase submodel absence contract (R57).** Absence on a denied storefront is a
  runtime contract: no DOM node, handler, request, fetched catalog, error copy or
  accessible text. Purchase code and English keys ship dormant in every bundle under the
  runtime capability; the review notes and the 44b handoff say so explicitly.
- D87 **Wave A and E publication arms (R58).** 20 and 44 carry the same STOP-and-ask
  push-go arm as 27, 33 and 39: on the go, the sanctioned push opens that wave's PR; otherwise
  the close ends local, awaiting the push go. 27 defines <wave-a-head> as the local tip
  state.md recorded at the 20 QA PASS, or the wave A PR head when one exists. D12's one PR
  per wave is owned for every wave.
- D88 **Deletion policy for housing operation rows (R59).** 07a states the ON DELETE
  policy per row class: intent rows cascade only when no open operation exists; applied
  tombstones retain a nonidentifying operation identity with the account reference nulled
  or scalar and cascade only under the accepted retention schedule. An open housing
  operation blocks character or account deletion with the mapped refusal class in
  character_delete_db.ts (the storage guard shape); the deletion race joins the real-PG
  list.
- D89 **Upgrade contribution source mode (R60).** Upgrade contributions take an explicit
  source-mode argument per D37 (bags, or the vault inside the owner's own claim under
  D18/D47); the bill counts item units per D33; a confirmed fee whose last leg cannot
  finish because bags are full re-attempts without a second fee.
- D90 **Dye station identity (R61).** The dye picker is enabled by the home station
  amenity of type apothecary: no new amenity kind, no extra slot and no station GLB. The
  art-brief row narrows to swatches and channel masks; a test pins the gate on that exact
  amenity.
- D91 **Distribution capabilities (R62).** Exactly two HudFeatures rows exist:
  freeholdPurchaseEnabled and freeholdManageOnWebsite. Housing use is the server
  entitlement gate (flag plus entitlement) read through the housing facet, never a
  HudFeatures row; deedSurfaces is 14's source pin consumed by 38.
- D92 **One key family and manifest governance (R63).** hudChrome.housing.* as pinned by
  ux-spec and ux-key-manifest.json is the only key family (charter.*,
  steward.manageWebsite); the drafts adopt those ids, and fee, tax and Purchase Terms rows
  are added under charter.*. Window-title, tab and button keys use title case per
  DESIGN.md 5.4; status, description, radio and aria keys stay sentence case. Every UI
  phase names its new keys with exact English in its own file, ux-spec carries the rows,
  and the manifests regenerate in that same phase with every cited count updated.
- D93 **Second freehold tier and upgrades (R64).** The second plot is granted at Cottage
  tier and upgrades through the same build projects as the primary with every integer
  material line at ceil(1.5x) per D67; ledger and prepay lines follow D67; there is no
  second-home upgrade refusal.

## Source-reviewed Hearth and build-presence refinements

C01 implements the approved shared-account Hearth behavior in D67. NEW
server/freehold_hearth_db.ts owns FREEHOLD_HEARTH_SCHEMA, loadFreeholdHearth and
advanceFreeholdHearthOnClient. 07 produces account_freehold_hearth with account_id
primary/FK identity, ready_at_ms and monotonic revision; no transferable plot owns this
cooldown. Private fhold/myFreehold.hearthKeyReadyAtMs and hearthKeyRevision are
committed UI mirrors only, excluded from plot persistence and transfer. Online ready timestamps use the authoritative transaction's epoch clock
observed once after acquiring the account participant. A regressed clock cannot make
an unready key eligible; accepted advances never reduce ready_at_ms or revision. Offline/headless use isolated injected host-clock state and the
same approved duration. 07a checks and advances the account row atomically with accepted
remote Hearth entry under the reviewed actual touch-set order; cached UI values never
authorize. Refusal, already-home no-op and physical-gate entry do not advance it. 42
consumes the same row across both destinations. Transfer copies or clears neither
account's cooldown; character deletion preserves it. Export, soft deactivation, restore,
true account deletion, bounds, FK waits and rollout are explicit 07/07a proof surfaces.

C03 adds the narrow presence verb needed for the approved visitor experience without
renaming any D20 member. NEW housing facet setFreeholdBuildPresence(active: boolean)
and command set_freehold_build_presence carry ephemeral editor presence. 01 owns the
facet/registry/null scaffold, 08 the authority in NEW
src/sim/freehold/build_presence.ts::setFreeholdBuildPresence, and 08a the allowlisted
freeholdState.isDecorating boolean. 11 sends start/stop through that verb; 18 reads only
the public boolean. The host binds each observation to the authenticated session and
current plot/claim generation. The command carries the acknowledged opaque plotId,
acceptedTransitionId and monotonically increasing buildPresenceSeq plus active; these
are stale-message checks, never credentials or caller-selected authority.

The receiving socket binding is captured before queueing and checked against the
current socket again at dispatch; it is host metadata, not a client credential.
buildPresenceSeq is monotonic only within that binding. A newly bound reconnect
starts inactive with a fresh sequence window, even though acceptedTransitionId history
is retained. An old socket or queued prior-generation frame cannot alter that window.

Each active entry requires current edit authority. Multiple authorized owner sessions
are tracked privately; the public boolean is true while any current eligible session
is actively editing. Closing build mode, leaving, disconnecting or permission/claim
revocation clears that session, with no grace period or durable row. A late close from
a superseded entry cannot clear a newer session, and a stale start cannot restore it.
No ghost, inventory, layout history, camera or actor/account identity accompanies the
boolean. Three-host/two-world parity and two-client lifecycle/privacy tests prove this
contract; host projections never infer it from renderer focus or camera state.

## Source-reviewed arrival delivery refinement

D41 remains verbatim above. Its once-per-confirmed-arrival intent is implemented
through 07c/08a's nullable freshArrivalPresentation directive, with at-most-once,
best-effort delivery and consumption for the accepted transition. A committed
arrival followed by lost ACK or process failure may omit visible/audio output;
this contract does not guarantee exactly-once presentation. Snapshot, replay and
resume never remint a fresh directive or recover presentation from historical
firstTierAtAdmission, acceptedTransitionId or dungeonEntrySeq alone. Only 07c's
committed account/tier insert winner may set firstTierViewEligible and permit the
optional first-tier camera. Ordinary return/visitor arrivals remain static, while
a delivered fresh directive may welcome once. 06/09/19 and ux-spec consume this
same delivery contract without adding a routine-entry receipt or another marker.

## Source-reviewed lifecycle extension boundary

07b introduces the account lifecycle module/core/coordinator and immutable protection
history. 28a extends that same owner family through explicit typed account/guild scope:
NEW guild_freehold_lifecycle and guild_freehold_lifecycle_history use real guild keys
and FKs, never account-row polymorphism or summed/copied member-account grace. Every
ordinary current guild member's admitted gameplay qualifies under D36; donation caps
are separate. Guild observation carries server-controlled membership incarnation and
captured time before queues; offline membership addition is not gameplay presence.
Noncoalescible admission/return/membership transitions retain their boundaries while
periodic timestamps alone coalesce. 28a proves the historical membership/transition
fence, mutation boundary, actual lock/index/deletion paths and bounded batches; 29/13a
consume committed guild history and exact union with outage protection. Observer
account/character deletion never erases guild history; disband preserves dependent
hall/credit/operation/protection state until its reviewed disposition completes.

D8's original indexed-column wording does not require a speculative standalone Ledger
index: query predicates, ordering, cardinality and reverse-FK/retention needs determine
the actual reviewed indexes. Its no-tick rule concerns housing economic work, not the
renderer/input's ordinary frame consumption. These source-reviewed implementation
bindings preserve the approved product rules and do not add a balance constant.

## Source-reviewed guild-clear admission refinement

31 owns NEW server/freehold_guild_clear_admission.ts::createGuildClearAdmission
and server/freehold_guild_clear_bridge.ts::createGuildClearBridge. The admission
owner reserves finite source-life slots and encoded bytes before publication; the
bridge preserves the original synchronous recipients, carrier order, source IDs,
day/difficulty, membership incarnation and exact ordinary-save snapshot prefix.
The existing planned guild_deeds_observer remains a committed projection consumer;
07a alone owns the source claim and operation transaction. No second receipt store,
pool, save queue or poller is introduced. 31's NEW exact operations are
reserveGuildClearSourceBatch; prepareGuildClearCharacterAdmission,
commitGuildClearCharacterAdmission and cancelGuildClearCharacterAdmission;
consumeGuildClearSourceReservation; retireGuildClearSourceLife;
releaseCommittedGuildClearCandidate; and retireGuildClearCharacterGeneration.
NEW src/sim/freehold/guild_clear_contract.ts owns pure GuildClearSourceAdmission
and GuildClearAdmission types. The narrow ctx.guildClearAdmission source contract
reserves, consumes and retires source lives; only the full host interface manages
character admission/generation and committed-candidate release.

Each source binds process and source-life generations, template and optional claim
generation, with positive metadata reservation even when no recipient is present.
Wipe/evade retains its unused reservation; a credited death consumes it, and a
later life needs another. Generic sources reserve the proven party/raid envelope.
Each live unconsumed Nythraxis source reserves an envelope for every admitted
authenticated character on that host, independent of location, party or guild;
multiple sources multiply this capacity. Fresh admission extends every affected
reservation all-or-none through 07b's prepareFreeholdLifecycleAdmission,
commitFreeholdLifecycleAdmission and cancelFreeholdLifecycleAdmission before
GameServer.join publishes the character, including administrators. The
reservation owns a prepared GuildClearCharacterAdmissionToken and commits it
through commitGuildClearCharacterAdmission before authenticated Sim/session
publication; a cancelled lifecycle admission cancels the unpublished extension.
The join-time hook publishes the session regardless of capacity (D83): when the
extension cannot fit, the character publishes as an unreserved generation, one
bounded clear-not-captured gap is recorded with an operator alert, and no busy
reaches the player. A captured source whose actual recipient batch exceeds its
reserved envelope (possible only when an unreserved generation participated) is a
not-captured clear: character rewards are unchanged and no guild candidate is
captured. Prepared unpublished character generations count
when another Nythraxis source life reserves; neither interleaving can omit capacity. Resume reuses
its surviving generation; takeover transfers or replaces it under a generation
fence. Authoritative leave releases only unused participant capacity; captured
candidate capacity remains retained. Offline/headless and developer bots retain
ordinary rewards without gaining online account authority.

Every qualifying source producer preflights the whole legal activation/replacement
batch before changing auras, claims, difficulty, IDs, RNG, entities, death/loot or
pending replacement state. This includes normal claims, Reset All, developer
family replacement and spawn batches, in-place respawn, pending respawn and
boot/authored/custom producers. A refused reservation never blocks the producer (D83): the life activates,
the claim proceeds and the corpse revives exactly as before, flagged not-captured
on its session-only token seat (ctx.guildClearSourceLives on SimContext); its
clear credits characters unchanged and captures no guild candidate, and the bridge
records one bounded gap row (source identity, boss, difficulty, utcDay) in the
redacted metrics with the operator alert. Retiring
an entity/claim releases only unused life allocation. Publication assertions are
invariants, not overload handlers after partial mutation; no movement barrier or
new participant cap is permitted.

Synchronous capture consumes already reserved envelopes and preserves every
distinct candidate, including clears without a new character deed. Original
recipient order elects each guild's carrier. Candidates arriving during save IO
remain pending; failure or ambiguous commit retains original identity for
reconciliation. Consumed capacity is released only after a known committed outcome
has entered bounded projection/recovery ownership. Uncommitted memory is not
crash-durable, and no stronger precommit character-reward guarantee is claimed.
Preserve each actual ordinary/carried save arm and reviewed legacy participants;
any new pre-lock statement must be explicitly budgeted and proved, never assumed.

The required online composition cannot silently select an inert admission owner.
Enabling recording inventories all current source lives and authenticated
generations, prepares all reservations and atomically installs readiness at a
synchronous host boundary; inability to fit fails activation without advertising
readiness. Incapable old processes cannot advertise the capability. Once enabled,
recording cannot be disabled to discard candidates or admit excess work. Admitted
sessions and already-live sources continue. Recording capacity never refuses
GameServer.join, enterDungeon or a respawn (D83): every busy outcome binds only to
source activation or credit capture, where it marks the life or clear not-captured
and records the bounded auditable gap; join, entry, revival, character rewards,
loot and existing deeds are unchanged and guild credit for that clear is simply
not captured. There is no waiter queue, global tick pause or dropped candidate.
While freeholdsEnabled is false on the SimConfig seam (D85) or recording is
disabled, no producer consults ctx.guildClearAdmission. Restart installs committed
recovery before ready and shutdown obeys existing deadlines and generation fences.

31 extends MEASURE-BOUNDS with the actual producer census, source/candidate schemas,
slot and byte totals, Nythraxis-life by admitted-character multiplication, pending
and unpublished admission reservations, save concurrency, legal replacement batch
headroom, cancellation/retirement and redacted pressure/failure metrics. Numbers
come from schemas, current rules, deployment workload and measured shared save
budgets; this refinement introduces no balance or capacity literal. Its paired
proof includes every activation/refusal arm, more room occupants than RAID_MAX,
multiple lives and late admissions, independent saves, repeated clears during IO,
ambiguous commits, real PostgreSQL participants and exact no-leak capacity totals.

## Non-negotiables (every phase)
- Determinism: all randomness via `Rng`; housing draws NONE (placement, upkeep, and the
  seeded weekly ledger order are pure functions of content and the realm calendar); no
  wall clock in `src/sim/` (`ctx.lockoutNowMs()` and `ctx.resetDay` are the clocks).
- One sim, three hosts: the module runs unchanged offline, online, and headless; the RL
  env excludes housing by a pin.
- Server authority: every outcome is decided in the sim on the server; the client
  predicts nothing and mirrors deltas.
- Token firewall: no on-chain vocabulary in `src/sim/` (wallet, token, $WOC, mint, holder,
  marketplace, on-chain, Solana, and the on-chain Freehold Charter deed). The Book of Deeds
  (deed ids, `deedsEarned`, guild deeds) is game content and is NOT firewall vocabulary. A
  purchased effect arrives as a server-applied grant after the economy service confirms.
- Store policy: `FREEHOLDS_ENABLED === '1'` read live, default off; no purchase surface
  and no wallet, $WOC, on-chain deed, or marketplace string in any App Store, Google Play, Steam,
  or Epic path; no "earn" language; nothing repossessed, nothing destroyed, no timed loss.
  Dark also means the Sim boots with `freeholdsEnabled` false on that realm (D85): no
  Eastbrook gate object, no furnisher entity or stock, and no Hearth Key grant reach a
  player; the offline browser and headless hosts pass `freeholdsEnabled` true (D3), and
  item, dungeon and layout data merge on every host regardless.
- Housing capacity never gates gameplay (D83): guild-clear recording capacity never refuses
  `GameServer.join`, `enterDungeon` or a respawn; exhaustion records a bounded, auditable
  clear-not-captured gap with an operator alert, character rewards, loot and existing deeds
  are unchanged, and every busy arm binds only to source activation or credit capture.
- Never sell power: no amenity or furnishing changes a combat, progression, gathering, or
  drop number; the only buff in a house is a feast's Well Fed.
- A home is never World PvP ground: `worldPvpZonePolicyAt`
  (src/sim/pvp/world_pvp_zones.ts) answers sanctuary for any owner-claimed room
  (`claimKey: 'owner'`), so the sim hostility arm and the client verdict
  (src/ui/pvp_hostile_core.ts) agree (tests/freehold_world_pvp_sanctuary.test.ts). Every
  new room def keeps `claimKey: 'owner'` or it loses the sanctuary. Honor gear's health
  bonus stays on in a home (src/sim/pvp/vitality.ts, tests/freehold_pvp_vitality.test.ts).
  Both rules read one helper, `isOwnerClaimRoomAt` (src/sim/data.ts,
  tests/owner_claim_room_at.test.ts). Those three suites pin the owner-room id list
  LITERALLY on purpose, so a new room def red-lights all three until the same change
  extends each list.
- Never a Perfecting keystone (`wyrmfall_core`, `sundered_essence`, `makers_ember`), a
  gear intermediate, or the quickening catalyst in any ledger, furnishing, or upgrade
  bill. Zero new farm beds. Recipes and their `stationType` gates unchanged.
- Vocabulary fixed; "phase" never leaves this directory; no em dashes, en dashes, or
  emojis anywhere.

## Validation matrix (by change type; pick every row the phase touched)
| Change type | Run |
|---|---|
| Any code | `npx tsc --noEmit`; the phase's own vitest files one at a time; `npm run ci:changed` after the LAST commit (read the exit code) |
| `src/sim/` | `npx vitest run tests/architecture.test.ts tests/sim_context.test.ts tests/monolith_budget.test.ts` plus the module's suite and a determinism (same seed, same state) case; parity goldens (`tests/parity/`) regenerated with `UPDATE_PARITY=1` in their own commit when a sampled field or emit changes |
| `src/sim/content/` | `npx vitest run tests/item_icons.test.ts tests/item_art_consistency.test.ts tests/deeds_content.test.ts tests/reliquary_content.test.ts tests/recipe_economy.test.ts tests/provisioner_firewall.test.ts tests/market_filters.test.ts`; `npm run wiki:content` then `npx vitest run tests/guide.test.ts` |
| `src/world_api/` | `npx vitest run tests/world_api_parity.test.ts tests/command_schema.test.ts tests/command_facets.test.ts` |
| Wire or snapshot | `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts` plus the housing chain test |
| `server/` | the domain suite under `tests/server/`; `npx vitest run tests/server/http/surface_inventory.test.ts tests/server/http/error_codes.test.ts tests/server/main_retention_wiring.test.ts tests/api_error_code_parity.test.ts`; pg-armed twins with `TEST_DATABASE_URL=postgres://eastbrook:change-me@localhost:5433/eastbrook` after `npm run db:up` |
| `src/ui/`, `src/styles/`, `src/render/` | `npx vitest run tests/architecture.test.ts tests/hud_update_drive.test.ts tests/mobile_window_coverage.test.ts tests/renderer_compile_gate.test.ts`; `npm run i18n:gen` then `npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts`; `node scripts/pr_screenshots.mjs` for visual change; `npm run perf:tour` for GPU producers |
| `headless/` | `npx vitest run tests/env_protocol.test.ts tests/client_env.test.ts` |
| Merge bar | Run `node scripts/gate_select.mjs` before readiness, or the deeper `npm run gate`, plus every scoped requirement; CI green is required on a separately authorized wave PR. Stop, CI and reviewers never replace shared tests/typecheck/build/i18n/security. |

## Seams and names (verified 2026-09-05; anchors to re-verify, not promises)
- Sim module: `src/sim/freehold/` behind `SimContext` with an `index.ts` barrel and a
  local `CLAUDE.md`; modules planned: `types.ts`, `state.ts` (load/serialize/evict),
  `instance.ts` (claim, rehydrate, descriptor), `layout_core.ts` (pure placement leaf),
  `placement.ts` (commands), `condition_core.ts`, `ledger_core.ts`, `ledger.ts` (pay),
  `amenities.ts`, `trophy_eligibility.ts`, `trophies.ts`, `visiting.ts`, `grant.ts`
  (server-only grant functions, never on `COMMAND_NAMES`); that is the wave A list, and
  later phases append their own modules (`hearth_key.ts`, `colliders.ts`, `upgrade.ts`,
  `hall_fund.ts`, `guild_deeds.ts`, `garden_view.ts`, `wards.ts`, and so on). New
  `SimContext` primitives
  and callbacks are appended and mirrored in `tests/sim_context.test.ts` (`CALLBACK_KEYS`
  and the fake host); a `freehold/` row joins the `src/sim/CLAUDE.md` system table.
  - Boot config (01, D85): the `SimConfig` seam (`src/sim/types.ts`) gains the optional
    boot field `freeholdsEnabled` beside `devCommands`, mapped by `server/sim_boot_config.ts`
    from `server/freehold_config.ts` `freeholdsEnabled(env)`, set offline by
    `src/game/offline_world_config.ts` `offlineWorldConfig` (`freeholdsEnabled: world ===
    undefined`, the config `src/main.ts` hands its offline `Sim`) and passed as true by
    `headless/env_server.ts`; 01 owns the field and its pins, 03 and 06 consume it.
  - Tier writer (05, D81): `src/sim/freehold/state.ts::setFreeholdTier` and the
    `/dev freehold <tier>` command land in 05 with the default tier-0 Inn Room record; 07
    adds the persisted save behind the same setter; 15's Charter grant reuses it.
  - Calendar (13, 13a, 35; D84): NEW `src/sim/realm_week.ts` (13) holds the pure realm-week
    leaf extracted from `src/sim/professions/masterwrought_materials.ts`
    (`emberWeekAnchorOf`, `emberWeeksBetween` and `emberWeekAnchorPlusWeeks`, re-exported
    from that module unchanged; `resetDayToDayNumber` is module-private today, so the
    extraction exports it from `realm_week.ts` while `masterwrought_materials.ts` keeps
    its local use);
    `ledger_core.ts::ledgerWeekOf(resetDay)` is that helper under the housing name and
    `ledger_core.ts::LEDGER_PREPAY_MAX_WEEKS` is the shipped default of 13's injected prepay
    cap (4 in 13; 25a proves 12 through the injected cap and raises the default only with
    the signed CAL-LEDGER-A version and the 13a acceptance recorded in Content numbers). Housing day keys are produced only by
    `server/raid_reset.ts::resetDayKey(ms, REALM_RESET_TIME_ZONE)` (13a); the sim compares
    day keys and every epoch-ms field is display-only. `realm_month_core.ts` (35) is the
    pure sim leaf for the UTC Endeavor month, fed by `server/sim_calendar_feed.ts`.
  - Colliders (10, D17): the registry keys freehold regions under the per-Sim host token
    (`ctx.riftCollisionToken`, which isolates Sims) by origin (ox, oz); each region carries
    its claim's `collisionToken` as the ownership stamp on set/clear; `runtimeRegionAt`
    derives one candidate origin from `dungeonAt(x)` and the UNCLAMPED slot inverse; the
    `InstanceSlot` interface moves to `src/sim/instances/instance_slot.ts` (re-exported
    from `sim.ts` as a type).
  - Upgrade (21, D89): `src/sim/freehold/upgrade.ts`; `contribute_upgrade` carries an
    explicit source mode (`'bags' | 'vault'`, D37/D89) and a `complete` arm (the
    re-attempt: no materials, no second fee); facet members
    `contributeUpgrade(slot, count, source)` and `finishUpgrade()`.
  - Pattern channels (22, D53): `src/sim/content/dungeons.ts` gains the `nythraxis_housing`
    tail rollGroup below `nythraxis_farm`, and `src/sim/rift/progression.ts` the sorted
    exported `HOUSING_RIFT_PATTERN_ITEM_IDS` plus an appended Draw 8 (the only sim logic 22
    touches).
  - Legend Stand (23): the copy reference is owning character id + itemId + instance.name +
    instance.signer + perfected + rolled.quality legendary, never `itemCopyPin`.
  - Later-wave modules (24/34/35/41): `ward_core.ts`, `ward_assignment_core.ts` (pure,
    called by the server inside the allocation transaction), `wards.ts`,
    `ward_favor_core.ts`, `realm_month_core.ts`, `garden_view.ts` and `dye.ts` (the dye
    picker rides the existing apothecary station amenity, D90: no new amenity kind, slot or
    station GLB).
- Content: `src/sim/content/freehold/` (`tiers.ts`, `charters.ts`, `furnishings.ts`,
  `furnishing_recipes.ts`, `furnishing_patterns.ts`, `ledger_schedule.ts`,
  `trophies.ts`, `dungeons.ts`, `layouts.ts`, `items.ts`, later `npcs.ts` (the 24 farmer
  `NpcDef` `freehold_farmer`, merged into `NPCS`) and `endeavors.ts` (35)), merged by
  `src/sim/data.ts` where the table is item, NPC or dungeon data (tiers and layouts are
  served by reference). Item kind `furnishing`
  (`FurnishingItemDef`), the one new kind. Patterns are `RecipeItemDef` rows
  (`pattern_<output>`), never a new kind.
- Facet: `src/world_api/housing.ts` (`IWorldHousing`), pinned in
  `tests/world_api_parity.test.ts` (five edits per member batch), commands appended to
  `COMMAND_NAMES` and tagged in `COMMAND_FACETS` in `src/world_api.ts`. Phase 01's member
  list is: data `myFreehold` and `freeholdLayout` (null until 05 and 08a light them), the
  clock-base method `housingNowMs()` (the `farmNowMs` shape), and the dark no-op methods
  `freeholdEnter`, `freeholdLeave`, `placeFurnishing`, `moveFurnishing`,
  `removeFurnishing`, `undoPlacement`, `redoPlacement`, `payLedger`, `setVisitPolicy` and
  `setFreeholdBuildPresence` (C03). Later appends, none renaming a D20 member (the list
  phase-01 carries): 12 appends `buildStation` and `myAmenities`, 17 appends
  `placeTrophy(plinthKey, trophyId)` and `clearPlinth(plinthKey)` (commands `place_trophy`
  and `clear_plinth`, `COMMAND_FACETS` 'IWorldHousing') beside the `SimContext` primitive
  `ctx.freeholdAccountSources` (get(ownerKey) and invalidate(ownerKey, sourceKind) keyed
  on the D16 host-stamped owner key the sync holds through meta, never an account id; the
  server binding createFreeholdAccountSourceLoader resolves ownerKey to the account; the
  offline and headless local-only binding returns an empty cross-character projection with
  explicit status while the sync reads the local character's own surfaces from meta per
  D19; premise changed at the v0.44.0 sync: the release's account ledger,
  src/sim/account_ledger.ts, now carries most of these sources; re-planned in
  phase-17-trophies.md item 2) appended to `CALLBACK_KEYS`, 18 appends `freeholdVisitors`,
  21 appends `contributeUpgrade(slot, count, source)` and `finishUpgrade()`, 30a appends
  NEW `guildHallBoards()` (next bullet), 34 appends `myWard` and `moveWard(wardId)`, 42
  appends `myFreeholds`; every other later member is named in its own phase file with the
  parity pin updated in that same change.
- Hall boards read (30a): NEW `server/guild_hall_boards.ts::routes` (RouteDef
  GET /api/guilds/hall-boards, registered in `server/http/registry.ts` beside
  `guildRosterRoutes`, current-membership check on every call) mirrored by the NEW
  `IWorldHousing` member `guildHallBoards(): Promise<GuildHallBoardsInfo | null>`
  (ClientWorld fetches; the offline Sim answers null; headless no-op). Lockout arm:
  one row per lockout key the live model stamps (eleven: heroicLockoutId of the five
  dungeon final bosses, plus the plain and :heroic keys of nythraxis_boss_arena,
  ignivar_raid_arena and ignivar_inner_crucible), each counting currently online
  members whose lockout is live by the isRaidLocked expiry rule (live session metas
  only, no SQL, no character-blob read, no other member named, no week anchor:
  emberWeekAnchorOf serves the D84 ledger week only) plus the viewer's own rows.
  firstKills arm: 31 fills it from the committed guild_deeds projection; 31 adds
  no facet member (D82).
- Instances: `DungeonDef.claimKey`, `freehold_inn_room` (index 15), `freehold_cottage`
  (index 16); interiors `'inn_room'` and `'cottage'` on the `interior` union with
  `DungeonLayout` records (`INN_ROOM_LAYOUT`, `COTTAGE_LAYOUT`) plus lift functions,
  `STATIC_INTERIOR_COLLIDERS` entries, `groundHeight` arms, render variants; the
  `InstanceSlot` interface lives in `src/sim/instances/instance_slot.ts` from 10.
- Wire: self key `fhold` (owner account state, strict decode in
  `src/net/freehold_snapshot_wire.ts`, created in Phase 01 with an empty allowlist and
  filled in Phase 08a), pid-scoped `freeholdState` descriptor event
  (re-sent on resume like `riftStateEventFor`), text-free `freeholdDenied` and
  `freeholdGranted` events (`freeholdDenied` reasons in append-only order: `no_freehold`,
  `locked`, `cooldown`, `visitors_full`, `not_friend`, `dead`, `combat`, `busy` from 05;
  `instanced` and `match` from 06; `not_owner`, `bags_full`, `item_locked` from 08;
  `short` from 13); server sibling `server/freehold_wire.ts` (the pre-switch
  `refusedFreeholdCommand` predicate and the in-switch `dispatchFreeholdCommand` delegate
  from 01; `emitFreeholdSelfKeys` from 08a); `HEAVY_SELF_CMDS` / `HEAVY_SELF_EVENTS` rows;
  `JAILED_BLOCKED_COMMANDS` for the gate and Hearth Key; `src/net/ward_wire.ts` (34).
- Server: `server/freehold_db.ts` (`FREEHOLD_SCHEMA`, `account_freeholds`, 13's keep-forever
  `freehold_ledgers` for immutable paid bills, wave D `freehold_deeds`),
  `server/freehold_routes.ts` (registered in `server/http/registry.ts`, never inline in
  `main.ts`), `server/freehold_config.ts` (`freeholdsEnabled`), error family `freehold.*`,
  Claudium spend kind `freehold` beside `storage`, telemetry source `freehold`, 15's two
  RouteDef rows appended to `server/freehold_routes.ts` (POST `/api/freehold/quote`, a
  mutating method with a typed body so origin_check, content_type and the body schema gate the
  intent-minting Prepare step, and GET `/api/freehold/operation/:operationId`, the side-effect-free
  status read, handled by NEW `server/freehold_purchases.ts`;
  the checkoutAuthorization reference is stored on the 07a operation rows and never
  leaves the server), SKU ids `freehold_charter_cottage` (03) and
  `freehold_master_builders_call` (15), a `freeholdForAccount` read at fresh join beside
  `bankBonusFactsForAccount`.
- Server, 07a rows (BUILT 2026-10-01, QA'd 2026-10-01; named so 07a, 13, 15, 28, 37 and
  42 cite one vocabulary; the manifest `mutation-touch-set-manifest.md` is the design of
  record): `server/freehold_claim_db.ts` (`FREEHOLD_CLAIM_SCHEMA`, table
  `freehold_plot_claims`, KEEP-FOREVER, one active claim per `plot_id`, a release suffixes
  the holder with `#released`; `acquireFreeholdClaim`, the fence and renew/release statements),
  `server/freehold_claim_registry.ts` (`createFreeholdClaimRegistry`,
  `renewFreeholdClaims` in chunks of `FREEHOLD_CLAIM_RENEW_CHUNK` 256 under a
  `FREEHOLD_CLAIM_RENEW_PASS_DEADLINE_MS` 20,000 pass, `stopFreeholdClaimRenewer`,
  `releaseAllFreeholdClaims` bounded by `FREEHOLD_CLAIM_RELEASE_ALL_DEADLINE_MS` 2,000),
  `server/freehold_claim_login.ts` (`readClaimedLoginDurables`, one budget,
  `FREEHOLD_CLAIM_LOGIN_BOUNDS` statement 2 s, lock 1 s), `server/freehold_fenced_write.ts`
  (`createFreeholdFencedWriter`; the ordinary write is one statement,
  `FREEHOLD_FENCED_WRITE_BOUNDS` bound the first insert and the ambiguous retry),
  `server/freehold_operation_db.ts` (`FREEHOLD_OPERATION_SCHEMA`, tables
  `freehold_operations` for intent, at most `FREEHOLD_OPERATION_OPEN_PER_ACCOUNT` 8 open
  per account, and `freehold_operation_receipts` for applied tombstones, KEEP-FOREVER;
  `prepareFreeholdOperation`, `cancelFreeholdOperation`,
  `eraseFreeholdOperationReceiptsForAccount`), `server/freehold_mutation.ts`
  (`commitFreeholdMutation`, `createFreeholdSaveHook`, `FREEHOLD_VERIFY_BOUNDS`),
  `server/freehold_hearth_trip.ts` with its host binding `server/freehold_hearth_trip_host.ts`
  (the lit remote Hearth trip), `server/freehold_operation_recovery.ts`,
  `server/freehold_tx.ts` (`runFreeholdTransaction`), and the growth pair
  `server/freehold_receipt_growth_db.ts` and `server/freehold_receipt_growth_monitor.ts`.
  `server/freehold_persist_types.ts` is an EXTRACTION from the store (its ports and entry
  record), not a new seam. `ensureSchema` applies plots, Hearth, claims, operations in
  the late block immediately before `STORAGE_PURCHASE_SCHEMA`. The claim renewer is a
  `PeriodicSaveWrites` member registered in `PERIODIC_SAVE_WRITE_NAMES` beside
  `heartbeatLeases` (expiry plus heartbeat, the `LEASE_TTL_SECONDS` 90 s policy), its
  synchronous launch billed to the `saves` phase. The open-operation deletion guard raises
  the NEW `CharacterFreeholdOperationOpen` class in `server/character_delete_db.ts` beside
  `CharacterStoragePurchaseOpen` (D88; 409 `character.freehold_operation_open`). Metrics:
  `woc_freehold_claims_held` (gauge), `woc_freehold_authority_total{measure}` (the claim_*,
  trip_* and recovery_* counts), `woc_freehold_authority_ms_total{measure}`,
  `fenced_writes` on `woc_freehold_persist_total`, and
  `woc_freehold_receipt_growth{table, measure}` over the receipts and the claims tables
  (that watched list, `FREEHOLD_RECEIPT_GROWTH_TABLES`, is pinned whole in
  `tests/server/main_retention_wiring.test.ts` beside the retention absences).
- Guild roster (origin/release/v0.42.0, verified 2026-09-06, re-verify at every guild
  phase start): GUILD_MEMBER_LIMIT is removed; the cap is per guild, base 100 plus
  20-seat pages up to `GUILD_ROSTER_MAX_MEMBERS` (1,000) in `src/sim/guild_roster.ts`;
  `PgSocialDb.guildMembership` carries `rosterPages`; `addGuildMemberAtomic` reads the cap
  from the locked guild row; NEW `server/guild_roster_page_db.ts` (account KEY SHARE,
  guilds UPDATE, `guild_roster_receipts` insert, character save: accounts, then guilds,
  then characters); `guild_roster_receipts` cascades with guilds and characters;
  `SocialTransport.buyRosterPage`, `SocialEvent.guildRosterResult/guildRosterExpanded`;
  `src/world_api/social_graph.ts` `guildBuyRosterPage` and `GuildInfo.memberCap/nextRosterPrice`
  (every housing facet batch conflicts on `tests/world_api_parity.test.ts` at merge).
- Guild hall rail (28/28a/29; D77, D78, D79): `visit_policy` for the guild owner kind is
  set by the leader or an officer and accepts only `guild`, `public` or `private`; 29's
  officer-plus `hall_fund_withdraw` command moves the fund's material slots and gold into
  the guild bank through the existing guild-bank deposit path on the 07a rail; disband is
  28a's tombstone disposition behind the `beginGuildBankDelete` guard extended at BOTH
  deleting call sites (disband and last-member leave).
- Optional deeds (37/38): `FREEHOLD_DEEDS_ENABLED` (37, default off, live '1' also
  requires `freeholdsEnabled`); NEW `allowSerializedCollectibles` policy switch (38,
  default off, beside `allowMounts`/`allowMechChromas` in `server/woc_market_routes.ts`);
  NEW `server/freehold_deed_market.ts` with the plot-shaped `freehold_deed_listings`
  relation and browse feed (never a `WocListingRow`); the NEW `WocStepUpOperation` kind
  `'list_freehold_plot'` (38); refusal `freehold.deed.buyer_capacity` (D80); 38's client
  deed modules are `src/ui/deed_card_view.ts` and `deed_card_window.ts` (never
  `src/ui/hud/housing/deed_*`).
- Client: `src/render/freehold/` (`furnishings.ts` painter modelled on
  `FarmPatchVisuals`, `furnishing_layout_core.ts` in `RENDER_PURE_CORES`, the interior
  dressing, `furnishing_ghost_visual.ts` and its sibling `freehold_light_grade.ts` (never a
  second `interior_light_rig.ts` basename; test `tests/freehold_light_grade.test.ts`), the
  NEW `'hearthView'` `CameraDirectiveKind` in `src/render/camera_director_core.ts` (09),
  later `ward_exteriors.ts` (34) and `garden_tableau.ts` (24)), `src/ui/hud/housing/`
  (barrel + `CLAUDE.md`: `build_mode_*`, `build_input_core.ts`, `capacity_meter_view.ts`,
  `furnishing_palette_*`, `steward_panel_*`, `trophy_case_*` with
  `trophy_case_view.ts::eligibleTrophyChooser` and
  `TrophyCaseWindow.openForPlinth(plinthKey)` as 17's record-only chooser that 11's
  Replace trophy / Clear plinth affordances call), wave A housing window ids
  `steward-window` (16) and `trophy-case-window` (17), the freehold-gate
  `MapMarkerSemantic` arm (`src/ui/map_marker_semantics_core.ts`) with its art, layer and
  accessibility tokens and the `entity_display_core.ts` object arm for the gate (both from
  06), `src/game/distribution_surfaces.ts` (housing fields `freeholdPurchase`,
  `freeholdManageOnWebsite`, `deedSurfaces`; 14 owns `deedSurfaces`, 38 consumes it),
  exactly two housing `HudFeatures` rows `freeholdPurchaseEnabled` and
  `freeholdManageOnWebsite` (D91), keybinds `toggleBuildMode` ('Shift+KeyB'),
  `rotateFurnishingLeft` ('Comma'), `rotateFurnishingRight` ('Period'), `undoPlacement`
  ('Ctrl+KeyZ'), `redoPlacement` ('Ctrl+Shift+KeyZ').
- i18n: `hudChrome.housing.*` in `src/ui/i18n.catalog/hud_chrome.ts`; item names in the
  item-names domain; `apiError.freehold.*` via `npm run new:endpoint`; world-entity names
  in `src/ui/world_entity_i18n.ts`. `hudChrome.housing.charter.feeDetails`,
  `charter.quoteExpiry` and `charter.terms` are named in 15 and 16 with the same exact
  English and rendered by 16 (D92); every UI phase names its new keys with exact English
  in its own file and regenerates both manifests in that same change (D92).
- Deeds family "Homesteader"; Reliquary "Hearth shelf" (furnishing items only; patterns
  never); provisioner firewall arm for the ledger schedule table.

## Content numbers (approved working targets and measured activation rows)
D31/D33 approve the existing values as attributed TUNING targets; they do not invent
missing prices, stack counts, recipe skills, rates or physical dimensions. Fernando
owns gameplay calibration and the economy service owns every price/token calculation.
The exact source/derivation/rounding/measurement/approval inventory is
content-numbers-workbook.md; its producing artifacts gate activation.

The tier ladder (proposal section 6.3; the Inn Room is the packet's tier 0):

| Tier | Freehold | Guildhall | Rooms | Decor budget | Plinths | Amenity slots | Illustrative fee |
|---|---|---|---|---|---|---|---|
| 0 | Inn Room | (none) | 1 | 20 | 3 | 0 | free, every account, no upkeep |
| Common | Cottage | Meeting Hall | 1 | 60 | 4 | 1 | $20 land (Claudium, service-priced) |
| Uncommon | Lodge | Great Hall | 2 | 120 | 8 | 2 | $25 plus materials |
| Rare | Manor | Bastion | 3 | 200 | 14 | 3 | $50 plus materials |
| Epic | Keep | Fortress | 4 plus a courtyard | 300 | 22 | 4 | $100 plus materials plus a prestige deed |
| Legendary | Citadel | Citadel | 5 plus a courtyard and tower | 420 | 32 | 6 | $200 plus materials plus a prestige deed |

Guildhall illustrative fees are roughly 3x the personal examples; only service quotes
set actual prices. Condition spans 0 to 100, with personal/guild wear 1/2 per eligible
realm day. The adopted protective policy pauses after 7 absent days and grants 3 return
days; 07b account or the later guild lifecycle authority captures qualifying gameplay
presence and preserves immutable protection before advancing it. Authentication login
is not that source. Amenities work at 30 and pause below; entry/build/undo still work at 0.

Ledger bills have 3 to 5 lines, always produce plus allowed rotating nonproduce families,
one published schedule per realm week. Source is explicitly bags-only, vault-only or
automatic bags-then-vault. Prepay capacity is 4 weeks initially and 12 from 25a
(`LEDGER_PREPAY_MAX_WEEKS` in `src/sim/freehold/ledger_core.ts`: 13 ships 4; the twelfth
week activates only behind the signed CAL-LEDGER-A and the 13a calendar-authority
acceptance; ledger_core.ts takes the cap as an injected input with LEDGER_PREPAY_MAX_WEEKS
as the shipped default; 25a proves 12 through the injected cap and raises the default only
in the change that records the signed twelve-week CAL-LEDGER-A version and the 13a
acceptance here); bills and prepaid weeks are `ledgerWeekOf` realm weeks and
wear is per realm day `resetDay` (D84); bills and credits retain source/rate identity. The repair amount is flat within its bill; current
condition 93 versus 60 does not prorate it. Working Cottage/Citadel upkeep targets are
about 10%/20% of measured weekly gatherer output, WOC calibration goals without unsupported
classic-era attribution. The Call reference is about 1.5x a bill's market value, never a
game-computed quote. D34 locks current unpaid bill plus condition 100, no new future
credits or consumption of existing future credits. Suspension and return protection use
exact union; no catch-up debt, double-counted overlap or wholly suspended credit burn.

All of the following remain attributed TUNING targets with the listed owner/producer;
measured or signed rows in the workbook precede runtime activation:

| Quantity | Adopted target and source | Owner and producing work |
|---|---|---|
| Wave A/B furnishing outputs | 18 (8 vendor, 10 craft, 3 pattern recipes within the 10); 20 further crafts including produce decoration | Fernando/content manifest; 03/04/19 and 22/24, Codex asset producers |
| Wave B pattern roster | 6 exact pattern rows named in content-manifest.md, approved D38/D53 roster rather than a classic-era count | Fernando/content; 22 one named raid or rift channel plus Marks per row, signed costs/drop weights |
| Hearth Key | 60 minutes, original proposal/state reference; one account cooldown across destinations | Fernando; 06 interaction, 07/07a account authority, 42 shared consumer |
| Concurrent claimed instances per freehold def | 24 per `DungeonDef` (`INSTANCE_SLOT_COUNT`, `src/sim/data.ts`), pre-allocated per def per realm process and reaped `INSTANCE_EMPTY_TIMEOUT` (300, `src/sim/types.ts`) after emptying; the 25th owner receives `freeholdDenied` busy, never a queue; saturation is the honest busy refusal (D50) | Fernando; 05 (the busy arm), 18 (visitor admission rides the same slot), 34 |
| Snapped yaw and physical limits | 15 degrees from the adopted placement/reference; grid pitch, dimensions, clearance and row/byte limits derive from measured legal room/model manifests | Content/interior/placement owners; 03/06/08/19/25, no unreferenced dimensions |
| Visitors | Inn 8 (D50 reuses Cottage target), then Cottage/Lodge/Manor/Keep/Citadel 8/12/16/20/24; exclude all owner-account sessions | Fernando; 18/26 (rows existing at 26: Inn 8, Cottage 8, Lodge 12), 28 (Meeting Hall = the Cottage row until 32, D77), 32 (Manor 16 and the hall tiers), 40 (Keep 20, Citadel 24); admission caps never render culling |
| Public knock | One per account+plot per 10 seconds | Fernando; 26 |
| Ward | 50 plots and 24 admitted occupants | Fernando; 34 DB/geometry/art proof |
| Favor/Endeavor | 4 ranks, permanent +10 decor per rank; monthly progress uses authority UTC month | Fernando; 35 source/reward calibration |
| Showcase | 13 weeks aligned to published realm week; one account vote per realm season, no self-vote | Fernando; 36 |
| Guest book | 50 entries; wave/cheer/admire; one reaction per account+plot+realm day | Fernando; 36 concurrency/retention proof |
| Hall Fund contribution | One current weekly Hall Ledger-equivalent per account per realm week across alts, D54 | Fernando/service; 29 signed resource/currency allowance and rounding, no game token conversion |
| Contribution log | 90-day retention working window | Fernando/DB owner; 29 export/prune/index proof |
| Pattern resale | sellValue 100 subject to verifying the shipped pattern contract | Content owner; 04/22 literal source fixture |
| Dyes and saved layouts | 8 exact palette rows; 0 to 2 declared tint channels; 5 saved layouts per plot | Fernando/art/content; 41/41a, approved palette sources and derived byte bounds |
| Second-home bill | ceil(primary approved integer line times 1.5) on every integer material line: ledger, prepay and the same build-project upgrade bills as the primary; the second plot is granted at the Cottage tier and has no upgrade refusal (D93) | Fernando/content; 42; service separately owns SKU price |
| Settlement examples | Initial 25% burn/75% treasury; illustrative resale 3% burn/7% treasury/90% seller, royalty independently quoted | Economy service and counsel; signed published service artifact, never local token arithmetic |

### Inherited UX constants (source status verified 2026-09-05)
These are existing shared implementation values or the already adopted `DESIGN.md`
target, not new housing balance decisions. A target row does not claim the shared
rollout has shipped. Housing consumes the shared implementation; missing target tokens
belong to that rollout. Every housing-specific value still needs its content/proposal
reference or an explicit ruling with a TUNING owner.

| Content numbers row label | Source, status and value | Owner |
|---|---|---|
| UX shared spacing and scale | Current `src/styles/tokens.css`: spacing xs 4px, sm 8px, md 16px, lg 24px. `DESIGN.md` shell window padding 12px; existing `--ui-scale` uses authored scale 1. The release widened UI scale to 0.75 to 2 (`UI_SCALE_MIN`/`UI_SCALE_MAX`, `src/ui/ui_scale.ts`), so compact-viewport fit checks cover that whole range. | Shared design foundation; housing consumes. |
| UX typography | Adopted `DESIGN.md` target: title 17/22px, panel title 15/20px, button 14/17px, body 14/19px, metadata 12/15px; body floor 12px and visible `input`/`select`/`textarea` floor 16px under coarse input, not every label (`src/styles/base.css`). Target display Alegreya 700, UI Alegreya Sans 400/500/700, label Alegreya Sans SC 700, reading Alegreya 400. Current `--font-display` remains Cinzel until shared rollout. | Shared design foundation. |
| UX window and item geometry | Adopted `DESIGN.md` target: header 44px; header icon 24 to 28px; desktop close 34px with 40px touch hit target; padding 12 to 16px; tabs 32px with 40px touch hit target; bags-family cells 48px with 4px gap. Target slot/button/window radii 5/7/10px; current `src/styles/tokens.css` small/medium radii 4/8px. | Shared design foundation. |
| UX touch targets | `DESIGN.md` and `src/ui/CLAUDE.md`: minimum 40x40 CSS px and all safe-area insets. Derive world-space pointer projection from the real visible hitbox and apply UI scale once; no invented finger-offset literal. | Shared design foundation; build-input tests. |
| UX motion | Adopted `DESIGN.md` target fast/press/panel/frame durations 90/60/160/120ms; closing panel about 120ms. Current `src/styles/tokens.css`: `--transition-speed` 0.25s and `--transition-ease` cubic-bezier(0.4, 0, 0.2, 1). Reduced motion suppresses spatial UI motion and ambient shimmer. | Shared design foundation; no local replacement tokens. |
| UX tooltip | Adopted `DESIGN.md` target: padding 10px, maximum width 320px, hover delay about 250ms and no keyboard-focus delay. Use the shared `#tooltip` and its current behavior until rollout. | Shared design foundation. |
| UX contrast | `DESIGN.md`: normal text 4.5:1; large text/accent 3:1. Theme contrast repair applies in every theme; error text remains `--color-text-error` reference `#ff8f85`. | Shared design foundation. |
| UX current and adopted colors | Current `src/ui/theme.ts` classic accent/border/panel/text/muted: `#ffd100` / `#6f5a2a` / `#15151f` / `#f0ebd8` / `#998d6a`. Adopted `DESIGN.md` target: `#d8a645` / `#926321` / `#12232c` / `#fff4d9` / `#c4b590`. Target ink 1000/950/900/850/800: `#04090d` / `#071117` / `#0b171e` / `#10212a` / `#172b35`. Existing gold-ramp references 900/800/700/600/500/400/300: `#4a2f10` / `#6b4517` / `#926321` / `#bc8732` / `#d8a645` / `#f0c86d` / `#ffe5a3`. Target hover/focus `#f0c86d`, glint `#ffe5a3`, secondary text `#e8dcbe`, faint text `#9ea6a6`, strong panel near `#060f14` at alpha 0.95; info/warning/danger/success references `#45c9ff` / `#ff9d32` / `#ee4d3c` / `#7fdc4f`. These are source references, never housing-local color literals. | Shared design foundation. |
| UX arrival camera | Existing `src/render/camera_director_core.ts` envelope: `VISTA_DURATION` 5.2s, `VISTA_RAMP_IN` 1.4s, `VISTA_RAMP_OUT` 1.3s and `DIRECTOR_RELEASE_TIME` 0.8s. An input cancellation request starts the existing blend-out immediately; it does not instantly zero directive weight. Ordinary online cosmetic settle is 0 through `src/game/arrival_warmup.ts` `arrivalRevealSettleMaxMs`. A housing consumer needs a measured safe room path and static reduced-motion/invalid-path fallback; this source row invents no distance or timing. | Interior and render owners consuming the shared camera. |
| Housing authored and effective lights | Proposal ceiling: 3 authored room point emitters. Existing `src/render/gfx.ts`: iOS profile 2, constrained profile 3, ordinary profile 6; the contributing budget can fall to 1. Shared allocation remains authoritative. LOW grade and actionable visuals must not depend on all 3 contributing. | Interior/render and asset owners. |
| UX screenshot viewports | Existing `scripts/pr_screenshots.mjs`: desktop default 1600x900; required existing touch tiers compact 874x402 and tablet 1180x820. Mobile default 844x390 is harness behavior, not the compact target. | Housing screenshot helper and wave-close matrix. |
| UX screenshot low seed | Existing screenshot harness settings: `graphicsPreset` 1 and `graphicsDefaultApplied` true. Seed each theme explicitly; set desktop viewport in `beforeLoad` when departing from the harness default. | Build-mode capture helper. |
| UX verification inventories | 557 exact housing keys (each with its owning phase) in ux-key-manifest.json and 742 screenshot variants (339 in wave A, each with its producing phase) in ux-shot-manifest.json, derived from the approved UX inventory rather than gameplay tuning | UX owner; every UI phase that adds keys or shot variants (06/09/11/12/14/16/17/18 in wave A; 21/23/24/25/26/28/29/30/30a/31/34/35/36/37/38/40/41/41a/42 later) regenerates both manifests in its own change with every cited count updated (D92), and wave-close verification compares the exact manifests |
| UX numeric measurement ownership | Grid pitch, room dimensions, camera path, transformed furnishing bounds, clearance and touch projection derive from the approved measured art/room manifest. Placement-history bounds derive from the maximum legal placement-row bound. No unreferenced numeric literal is supplied by the UX document. | Content, interior, placement, asset and build-mode owners; Fernando for any new tuning. |

## Per-phase ledger

06 and its paired QA are complete locally, PASS with 37 findings found and fixed. The
canonical eighteen before/after PNGs are individually linked under 06 in
progress.md; all image/sidecar bytes, 42 source seals and seven harness seals
match. (Re-shot 2026-09-23: the current receipt seals 67 source inputs, 17 of them harness files; see [the evidence record](interiors-implementation-evidence.md), last section.) Three raw runner records and their formatted counterparts are retained.
Twenty supplemental presentation and eight actual-key images also have fresh
independent visual acceptance, with their scope limits in the linked receipts.
The complete twelve-step shared gate passed. The actual-last-commit changed-file
check follows the separate verdict commit and is not claimed executed here.
Rows marked planned carry the names the packet fixed in advance; the completing phase
replaces the marker with its actual outputs. A partial row records authored scope
only and never declares its remaining deliverables or paired QA complete.

| Phase | New files | IWorld members | SimEvents | Wire keys and commands | Endpoints | Tables | i18n keys |
|---|---|---|---|---|---|---|---|
| 01 | `src/world_api/housing.ts`, `src/sim/freehold/{types,state,commands,index}.ts` + `CLAUDE.md`, `src/net/freehold_snapshot_wire.ts`, `server/freehold_config.ts`, `server/freehold_wire.ts`, `server/freehold_routes.ts`; extractions `src/sim/mob/move_toward.ts`, `server/live_location.ts`, `src/net/blank_entity.ts`, `src/game/seo_metadata.ts`; tests `freehold_module`, `freehold_snapshot_wire`, `freehold_command_chain_online`, `move_toward`, `seo_metadata`, `server/freehold_wire`, `server/freehold_routes` | `myFreehold`, `freeholdLayout` (data, null); `housingNowMs`, `freeholdEnter`, `freeholdLeave`, `placeFurnishing`, `moveFurnishing`, `removeFurnishing`, `undoPlacement`, `redoPlacement`, `payLedger`, `setVisitPolicy`, `setFreeholdBuildPresence` (dark no-ops); SimContext `ctx.freeholds` (live map) and `ctx.freeholdsEnabled` (read-only); `SimConfig.freeholdsEnabled` | none | `freehold_enter`, `freehold_leave`, `place_furnishing`, `move_furnishing`, `remove_furnishing`, `undo_placement`, `redo_placement`, `pay_ledger`, `set_visit_policy`, `set_freehold_build_presence` (refused pre-switch while `FREEHOLDS_ENABLED !== '1'`; `freehold_enter` jail-blocked); self keys: none (empty allowlist) | GET `/api/freehold` (bearer read guard behind the dedicated tier-1-only `HOUSING_READ_POLICY` IP limiter, 60/min, no tier-2 write; `freehold.disabled` 503 while dark, `{ enabled: true, freehold: null }` lit) | none | `apiError.freehold.invalid_input` (generated, reserved), `apiError.freehold.disabled` (English plus the five M16 non-Latin fills); metrics `woc_freehold_refused_total`; env `FREEHOLDS_ENABLED` (strict `'1'`, default off, `.env.example` + `DEPLOY.md` + `turbo.json`) |
| 02 | `src/sim/item_storage_rules.ts`; `src/ui/hud/housing/{index.ts,CLAUDE.md,furnishing_tooltip_view.ts,furnishing_tooltip.ts}`; extraction `src/ui/mount_tooltip_view.ts`; QA shared projection `src/ui/item_instance_view.ts`; fixture `tests/fixtures/furnishing_item.ts`; original furnishing and mount tooltip tests plus 22 QA suites, including actual consumer/tool/commerce/feast host parity, loaded power, custody/journal restart, identity and presentation | none | none | ItemKind `furnishing` and `FurnishingItemDef`; no new command or snapshot key | none | none | English only: `itemUi.kind.furnishing`, `itemUi.market.filterTypeFurnishing`, `hudChrome.housing.furnishing.footprint`, `hudChrome.housing.furnishing.decorCost`, `hudChrome.housing.furnishing.surfaceFloor`, `hudChrome.housing.furnishing.maker`; generic custody leaf `hudChrome.itemTooltip.partyTradeWindowCustody` |
| 03 (complete, paired QA PASS) | `src/sim/content/freehold/{tiers,charters,ledger_schedule,ledger_trial,furnishings,index}.ts` plus local guidance; `src/sim/{surface_npc_bootstrap.ts,freehold/should_spawn_npc.ts}`; `scripts/freeholds/` measured economy/geometry producers; focused content, ledger, producer, furnishing, rollback, NPC, terrain, empty-Hearth and browser keyboard suites; accepted trial/art evidence and eight item WebPs | none | none | exactly eight furnishing ItemDefs; NPC freehold_furnisher and gated stock; existing wire shape unchanged | none | none | eight `entities.items.freehold_*.name` leaves; world entity name/title/greeting for freehold_furnisher; Hearth shelf and hearth_basics name/description; Homesteader/Householder labels and rewards; English plus five required non-Latin fills |
| 04 (complete, paired QA PASS) | `src/sim/content/freehold/{furnishing_recipes,furnishing_patterns}.ts`; `src/sim/freehold/crafted_availability.ts`; `src/sim/professions/{recipe_visibility,train_recipe}.ts`; `src/net/anchor_fields.ts` (the release's identical extraction; this packet's twin `item_copy_anchor_wire.ts` was retired at the v0.44.0 sync); `server/world_hello.ts`; crafted economy/geometry producers under `scripts/freeholds/`; `tests/{furnishing_recipes,furnishing_pattern_items,furnishing_crafting,freehold_crafted_availability,freehold_crafted_presentation,freehold_crafted_art,recipe_visibility}.test.ts`; accepted calibration evidence and `crafted-content-art-2026-09-07/catalog-verification.json`; current census in `scripts/item_art_audit.mjs`; accepted final runtime evidence; `crafted-qa-reconciled-2026-09-07/` paired QA evidence | existing `cfg` gains optional `freeholdsEnabled`; existing `recipeList` reflects host availability through `ctx.freeholdsEnabled` on Sim | none | `hello.freeholdsEnabled` mirrors host availability; existing commands retained; ten output and three pattern ItemDefs | none | none | thirteen `entities.items.<id>.name` leaves listed below; `hearth_first_crafts` name in all eighteen base Reliquary locale tables and full desc in five non-Latin tables; changed `guide.reliquaryPage.catalogBody` and `guide.profPages.craftProse.armorcrafting.ladderBody`; English plus five M16 item/guide fills |
| 05 (complete, paired QA PASS) | `src/sim/content/freehold/dungeons.ts`; `src/sim/freehold/{owner_key,instance,dev_grant}.ts`; extractions `src/sim/combat/effective_stats.ts` (sim.ts 11876 to 11857; collapsed at the 2026-09-26 sync onto the release's identical `src/sim/effective_stats.ts`), `server/entity_wire_variant.ts` (game.ts 10234 to 10202; retired at the v0.44.0 re-sync, which collapsed it onto the release's `server/entity_wire_cache.ts`), `src/game/browser_fullscreen.ts` (main.ts 11308 to 11269); `src/game/freehold_dev_bootstrap.ts`; `scripts/lib/freehold_dev_authorization.{mjs,d.mts}` (the dev-only Vite loopback bridge, admitted in `vite.config.ts` through `freeholdDevAuthorizationEnabled(process.env)` only); tests `freehold_instance`, `freehold_instance_online`, `freehold_offline_default`, `freehold_dev_grant`, `freehold_dev_authorization`, `freehold_dev_bootstrap`, `freehold_dungeon_defs`, `effective_stats`, `browser_fullscreen`, `server/entity_wire_variant` (retired at the v0.44.0 re-sync onto `tests/server/entity_wire_cache.test.ts`), `server/freehold_dev_grant_boot`; golden `tests/parity/golden/freehold_claim.json`; `tests/fixtures/terrain_height_parity.v1.f64le.gz` re-minted as a byte-prefix extension (owner rooms append last) | none new: `freeholdEnter`/`freeholdLeave` lit on both hosts, `myFreehold`/`freeholdLayout` still null until 08a; `DungeonDef.claimKey?: 'party' \| 'owner'`; `PlayerMeta.freeholdOwnerKey` (host stamp: `account:<id>` online, absent offline and resolved `entity:<pid>` by `freeholdKeyFor`; META_EXCLUDE); `SimConfig`/`SimContext.freeholdDevGrantEnabled` (read-only, nonpersisted, default false); `setFreeholdTier` the ONE tier writer, `ensureFreeholdRecord`/`loadFreehold` insert only on a lit host, `releaseFreeholdOnLeave` evicts at the last same-key session out | `freeholdDenied { pid, reason }`, reasons APPEND-ONLY in this order: `no_freehold`, `locked`, `cooldown`, `visitors_full`, `not_friend`, `dead`, `combat`, `busy` (05 fires no_freehold, dead, combat, busy; locked is 12's amenity lockout; cooldown 06; visitors_full and not_friend 18); `dead` has ONE exception, the corpse run (a released ghost whose corpse is bound to one of its own live owner claims is admitted to that room and resurrects at the entrance; every other dead body refuses); a record whose tier is outside the union answers `no_freehold` to a living enter, never a throw (a bound ghost still runs to its body's room); a leave from outside any owner room is a silent no-op, not a denial, and any player inside a live owner claim may leave; 05 had no client handler (06 now adds the keyed feedback; old clients drop it safely; historical 05 behavior: a dark REALM refused above the switch with `commandOutcome` false and NO event, while a dark OFFLINE world emitted `freeholdDenied no_freehold`; 06 supersedes the realm arm with requester-only keyed `freeholdDenied`, and its controller ignores generic command errors) | dungeon ids `freehold_inn_room` (index 15, origin x 119200) and `freehold_cottage` (index 16, origin x 119800), `spawns: []`, no objects, `overworldDoor: false`, `guideVisible: false`, `suggestedPlayers: 1`, historical 05 `interior: 'crypt'` (replaced by the authored 06 layouts in the row below), historical doorPos `{ x: -14, z: -92 }` north of the Eastbrook mailbox surround (leaving and the saved-inside rejoin both drop 4 yd south, at -14, -96, on open quay ground: the 05 QA moved the door from z -96, whose drop at z -100 sat inside the mailbox's blocked footprint, and pinned the drop unblocked with zero depenetration on every test seed; 06 now derives the gate from the canonical Eastbrook service at the same coordinates; current verification is pending (SUPERSEDED by the gate move after the v0.44.0 sync, 2026-09-22 to 23: the gate now stands at `(-38.65,-103.75)` with its drop at `(-38.65,-107.75)`; see the 07 release sync row)); `freehold_enter`/`freehold_leave` LIT behind the unchanged dark gate; `freehold_enter` jail-blocked; HEAVY_SELF_CMDS unchanged (decision in `server/heavy_self.ts`: no heavy self field moves until 08a's `fhold` key); a malformed account id is refused by `planJoin` with `not authenticated` | none | none: the record and the grant are in-memory facts (D81); 07 persists the record under the same owner-key identity and the placeholder `plot:unassigned` plotId is replaced by 07's public id | `entities.dungeons.freehold_inn_room.{name,enterText,leaveText}` and `entities.dungeons.freehold_cottage.{...}`: English plus the five non-Latin fills (ja rows use the plain past like the newest rooms), the 16 Latin locales pending; the glossary housing note names both ids as common nouns; `[dev]` grant lines are dev-channel English |
| 06 (complete, paired QA PASS; 37 found and fixed) | `src/sim/content/freehold/{layouts,items}.ts`; `src/sim/freehold/{gate_rules,entry_context,gate,hearth_key}.ts`; `src/sim/world_object_bootstrap.ts`; `src/render/freehold/` interior shell/dressing and shared pure resolver leaves; `src/ui/hud/housing/` gate view/painter/feedback/key tooltip; `src/sim/instances/{owner_claim_occupancy,owner_arrival}.ts`; `server/{instance_presence,instance_scan_tick_stats}.ts`; `scripts/freehold_interior_route.mjs`, `scripts/lib/pr_shot_freeholds.mjs`, `scripts/freehold_capture_receipt.mjs`, `scripts/freehold_key_capture.mjs`; focused arrival, renderer-lifecycle, real browser input and character/bank persistence regressions; `docs/freeholds/qa/interiors-2026-09-08/`; `docs/freeholds/generate-ux-manifests.mjs` | Existing `freeholdEnter` confirms an actual nearby gate, granting only a character-wide missing key (carried and personal bank); `freeholdLeave` remains the live owner-room exit. `ItemUse { type: 'freeholdEnter' }` routes a permanent Hearth Key through `useHearthKey`; no new housing command. Sim/SimContext private `freeholdKeyReadyAtMs` map and injected `freeholdKeyAdmission`; `myFreehold`/`freeholdLayout` remain null until 08a. `instanceScanCounters` exposes current-tick claimed-slot/owner-roster/owner-claim-test counts | Append-only `freeholdDenied` suffix `instanced`, `match`; key emits `cooldown` and shared context refusals. Jailed gate/key dispatch emits one personal `busy` denial before Sim entry. Dark realm admission now emits requester-only keyed `freeholdDenied`; the housing controller ignores generic command errors, so the historical 05 command-outcome-only toast plan no longer applies. Existing `dungeonEntrySeq` self-wire value now also updates the online player entity after entry-facing resolution; it is arrival identity only, never permission to replay welcome/audio/camera | Owner ids/indexes unchanged; interiors now `inn_room`/`cottage`, empty-room entry `(0,-4)`, exit `(0,-6)`, facing 0; deterministic body-safe owner arrival resolves before claim/travel effects and refuses saturated approaches without side effects; `freehold_gate` is an alive nonlootable `object`, `objectItemId: null`, at canonical Eastbrook service `(-14,-92)`, semantic marker `freehold-gate`; default exit/rejoin drop `(-14,-96)` (SUPERSEDED by the gate move after the v0.44.0 sync, 2026-09-22 to 23: the gate now stands at `(-38.65,-103.75)` with its drop at `(-38.65,-107.75)`; see the 07 release sync row). New item `hearth_key`, tool, permanent/soulbound/noMarketList/noDiscard, sellValue 0. Presence status `freehold` on both shared unions, shared leaf for roster/who and relay (`Freehold` only), admin kind/labels and bounded client perf class | none new | none: real character JSON/bank restore regressions preserve a single key and safe exterior reload. The isolated `3_600_000` ms key clock uses `ctx.lockoutNowMs()` and is not serialized, transferable plot state or durable online authority. Realm `freeholdKeyAdmission` refuses until 07/07a. O(1) `ctx.freeholds.size` read feeds `freeholdRecords` heartbeat; no record-map scan or database call added. Heavy inventory self refresh occurs only after an actual grant changes the actor wire revision | Existing 38 planned owner-06 housing keys implemented; exact M16 fills retained and fifteen nonqualifying additions removed; semantic gate and Hearth item labels; separate social `/who` and admin type/room labels. Shot targets `freehold-gate`, `freehold-inn`, `freehold-cottage`, each desktop/compact/tablet: 9 variants, 18 retained before/after PNG paths; all 18 current PNGs independent visual QA PASS with exact bytes, 42 source and seven harness seals matching acceptance.json (re-shot 2026-09-23: 67 source inputs, 17 of them harness files, see the 07 release sync row); twenty presentation fixtures and eight actual-key images separately accepted with explicit evidence limits. Planned manifests: 557 housing keys, 742 variants, 339 Wave A |
| 07 (BUILT; TEN fix rounds, nine of which introduced a defect worse than one they closed, INCLUDING the verification session's own, which two fresh reviewers caught and which was reverted; paired QA owed; eleven named gates carried UNCLOSED in the rollout contract section 8a) | `server/{freehold_db,freehold_hearth_db,freehold_persist,wire_cadence,client_perf_reports_db,bot_detection_snapshot}.ts`; `src/sim/freehold/{persisted,load_report}.ts`; `tests/helpers/maximal_freehold.ts`; `docs/freeholds/persistence-rollout-contract.md`; `docs/freeholds/qa/persistence-2026-09-08/` (nine reports plus the ledger); tests `server/freehold_db`, `server/freehold_db.pg`, `server/freehold_hearth_db`, `server/freehold_hearth_db.pg`, `server/freehold_persist`, `freehold_state`, and the new arms in `server/ws_auth`, `server/http/game_metrics`, `server/periodic_save_flush`, `server/tunables`, `freehold_module`. Extractions paid the ratchet: `server/wire_cadence.ts` (game.ts 9983 to 9920), `server/client_perf_reports_db.ts` (the release made the same move; since the v0.44.0 sync the file is the release's copy) and `server/bot_detection_snapshot.ts` (db.ts), `isInJailRoom` into `src/sim/jail.ts`. ROUND NINE (a verification session, `9468d374d9..`) closed the SEVENTH path to an empty default landing on a real house: a reseeded record stops being pristine the moment the returning player touches it, so the seal admitted it, and a live revision BELOW the entry's last committed one now refuses it. It also exempted the stand-in identity from the seal's name comparison and deleted the entry's second cached identity, and ROUND TEN reverted both after two fresh reviewers proved each one wrong with an executed A/B against the baseline: the exemption admits a seeded default as soon as its revision climbs past the entry's, and the identity removal silently teaches the sim a different plot name on every replay. The name comparison is total again, the revert is pinned in both directions, and the fresh-account quiesce it re-exposes is pinned as it behaves and carried as a named gate whose fix (teach the record its minted identity at INSTALL) is a maintainer decision. The shutdown drain now probes the live revision like the sweep and the leave flush; before, it could not see an edit at all and was correct only by the shutdown ordering in `server/main.ts` | none new: `myFreehold`/`freeholdLayout` stay null until 08a. `SimContext.freeholds` is loaded from the durable row BEFORE `addPlayer` seeds a default, because `loadFreehold` and `ensureFreeholdRecord` are both load-once and a load after the seed is a silent no-op that would discard the owner's real plot. `mergeFreeholdKeyReadyAt` is the second and last sanctioned writer of `ctx.freeholdKeyReadyAtMs`, forward only | none new | no new command, no new self key. `PlayerMeta` carries `freehold?: LoadedFreehold` from the handshake into `game.join`; a thrown durable read joins the player with nothing installed rather than refusing the login, which is exactly the state in which no write goes out | none new | **`account_freeholds`** (PRIMARY KEY `(account_id, plot_index)`, UNIQUE `plot_id`, no third index because `account_id` leads the key and the FK cascade probes that prefix) and **`account_freehold_hearth`** (`account_id` PK, FK CASCADE). Both KEEP-FOREVER, both absent from the retention sweep with an absence pin, both on `POST /api/account/export`. Shape-only CHECKs; the `plot_id` charset CHECK is the one deliberate policy CHECK and the DDL names the explicit ALTER a widening release owes. Compare-and-swap on `durable_rev`, carried as exact bigint TEXT. `schema_version` is written by the writer on both statements, never left to the column DEFAULT. Measured ceilings: `FREEHOLD_MAX_LAYOUT_ROWS` 420, `FREEHOLD_MAX_TROPHY_ROWS` 32, `FREEHOLD_MAX_ID_LENGTH` 64, `FREEHOLD_MAX_OWNED_BYTES` 101376 (canonical JSON, measured 101139), `FREEHOLD_MAX_STORED_BYTES` 106496 (jsonb text, measured 106032), `FREEHOLD_STORED_DETOAST_GATE_BYTES` 131072 (re-derived from STORED measurements; the first calibration used an unstored expression and was wrong by forty-four times), `FREEHOLD_ACCOUNT_PLOT_READ_LIMIT` 2 | none: every diagnostic on this path is DEV-CHANNEL English and bounded by `freeholdLoadDiagnostic`, which admits a closed list of fault SHAPES and replaces anything else with `unclassified`. A held row has NO player-facing surface in this release, recorded in the rollout contract as a gap the release that lights housing up inherits. New operator series `woc_freehold_persist` (gauge), `woc_freehold_persist_total` (counter) and `woc_freehold_load_failures_total` (by hold kind), all identity-free and documented in DEPLOY.md |
| 07a (BUILT; forty-three fix rounds, each read fresh; paired QA 2026-10-01, see the QA row below and `docs/freeholds/qa/mutation-2026-09-30/qa-findings.md`) | `server/{freehold_claim_db,freehold_claim_registry,freehold_claim_login,freehold_tx,freehold_fenced_write,freehold_mutation,freehold_mutation_db,freehold_operation_db,freehold_operation_recovery,freehold_authority_registry,freehold_hearth_trip,freehold_hearth_trip_host,freehold_account_export,freehold_receipt_growth_db,freehold_receipt_growth_monitor,character_save_housing,freehold_persist_types}.ts`; extractions `server/{tick_phase_names,concurrent_index_runner}.ts` (paying the ratchet before the feature) and, in the QA, `server/{db_boot_connection,escrow_save_failure,unref_timer_ports}.ts`; tests `server/freehold_mutation`, `server/freehold_mutation.pg`, `server/freehold_claim.pg`, `server/freehold_receipt_growth_monitor` and the parity golden `freehold_hearth_key`; `docs/freeholds/mutation-touch-set-manifest.md` (revision 6); `docs/freeholds/qa/mutation-2026-09-30/` | none new | none new | no new command or self key. The sim's `freeholdKeyAdmission` seam is three-valued (`FreeholdKeyAdmission`: `admit`, `deny`, `pending`); a pending use is re-dispatched under a one-shot server ticket once the durable account cooldown has advanced through the mutation hook | none new | **`freehold_plot_claims`** (a lease plus a monotonic generation fence per plot id; a release renames the holder `<holder>#released`; rows are kept, so generations survive), **`freehold_operations`** (open intents, capped at 8 per account; an open one refuses a character delete and an account delete, D88), **`freehold_operation_receipts`** (terminal, keep-forever, watched by a growth gauge; erased by the soft delete) | `apiError.character.freehold_operation_open`, with its non-Latin fills; operator series `woc_freehold_authority_total` and `woc_freehold_authority_ms_total` (`claim_renew_pass`, `claim_login_read`, `trip`) |
| 16 (planned) | `steward_panel_*`, charter card | none | | | reads 15's POST `/api/freehold/quote` and GET `/api/freehold/operation/:operationId` | | `charter.feeDetails`, `charter.quoteExpiry`, `charter.terms`, `charter.section`, `charter.reference`, `charter.supportReview`; window id `steward-window` |
| 17 (planned) | `trophy_case_view.ts`, `trophy_case_window.ts` | `placeTrophy`, `clearPlinth`; SimContext `ctx.freeholdAccountSources` | | `place_trophy`, `clear_plinth` | | | `denied.trophyUnavailable`; window id `trophy-case-window` |
| 25 (planned) | | none | | | | | `build.surface`, `build.freeRotate`, `build.movesChildren`, `denied.supportFull`, `denied.invalidTransform`; shot target `housing-build-advanced` (38 variants) |
| 30 (planned) | NEW `tests/guild_chest_opener.test.ts` | none | | | | | `guild.chestMembersOnly`, `guild.stationMembersOnly`, `guild.amenitiesPaused`; shot target `housing-hall-amenities` (38 variants) |
| 30a (planned) | `server/guild_hall_boards.ts` | `guildHallBoards()` | | | GET `/api/guilds/hall-boards` | | `guild.lockouts`, `guild.firstKills`, `guild.lockoutRow`, `guild.ownLockoutRow`, `guild.noLockouts`, `guild.firstKillsUnavailable`, `guild.membersOnly`, `guild.boardLoading` |
| 31 (planned) | `server/freehold_guild_clear_admission.ts`, `server/freehold_guild_clear_bridge.ts`, `src/sim/freehold/guild_clear_contract.ts` | none (D82) | | | fills 30a's firstKills arm | `guild_deeds` | `guild.firstKillRow` |


04 reconciled paired QA inventory, 2026-09-07: **PASS**, four findings resolved
(three source/test findings and DOC-1). The source repairs span
`0932963250..69ffdab561`, in two commits, `d5ea0825d1` and
`69ffdab561`, with independent entire-fix review and supplement PASS. HN1 adds
`FURNISHING_PATTERN_ITEMS` to `src/sim/content/freehold/index.ts` and routes
`src/sim/data.ts`, `src/sim/content/recipes.ts`, and
`src/sim/freehold/crafted_availability.ts` through that barrel. COV-1 and PER-1 extend `tests/freehold_crafted_availability.test.ts` with
unrelated-state preservation and the actual thirteen-item JSON save cohort.
There are no new files, item IDs, balance values, schema, wire keys, or i18n keys
from these source fixes. DOC-1 corrects only the evidence summaries' calibration
check count to 50, matching the retained receipt; its correction is recorded in
`crafted-qa-reconciled-2026-09-07/reviews/docs-final.md`. Current evidence is in
`crafted-qa-reconciled-2026-09-07/`; the accepted original inventory below is
retained as its historical snapshot. The final shared gate exited 0 with all twelve steps green.

04 accepted development implementation inventory, 2026-09-07
(original implementation snapshot at `3666d89647`):

- Signed development CAL-RECIPES-A, CAL-PATTERNS-A and CAL-FURN-A are in
  `content-numbers-workbook.md`, tied to `crafted-content-trial-2026-09-07/acceptance.md`
  and exact SHA-256 `c211e11ae3289fc5ae8745f27c13c3253164dcf9188641fbcbf3c150fa479e2b`.
  The immutable proposal's pending fields are historical; its acceptance supersedes
  them for development only. Production approval remains false.
- `FURNISHING_RECIPES` is merged through `src/sim/content/recipes.ts::ALL_RECIPES`;
  `FURNISHING_PATTERN_ITEMS` merges through `src/sim/data.ts`. Outputs extend
  `src/sim/content/freehold/furnishings.ts`; the vendor's eight-item stock remains
  a distinct inventory. Every output below has recipe ID `recipe_<outputId>` and
  name key `entities.items.<outputId>.name` in `src/ui/i18n.catalog/items.ts`.
  Seven craft station bindings use `STATION_TYPE_BY_CRAFT`. The three explicit
  legacy bindings are inscription/apothecary, jewelcrafting/forge and
  enchanting/toolworks. `trainingStationTypeFor` already reads the explicit
  recipe station before the craft-map fallback; no new station is introduced.

| Output ID | English name | Craft / learning |
|---|---|---|
| `freehold_weapon_rack` | Weapon Rack | weaponcrafting / trainer |
| `freehold_iron_brazier` | Iron Brazier | armorcrafting / trainer |
| `freehold_patchwork_rug` | Patchwork Rug | tailoring / trainer |
| `freehold_hide_armchair` | Hide Armchair | leatherworking / trainer |
| `freehold_clockwork_lamp` | Clockwork Lamp | engineering / pattern |
| `freehold_glass_floor_lamp` | Glass Floor Lamp | alchemy / trainer |
| `freehold_chart_easel` | Chart Easel | inscription / pattern |
| `freehold_jewel_floor_lamp` | Jewel Floor Lamp | jewelcrafting / pattern |
| `freehold_set_supper_table` | Set Supper Table | cooking / trainer |
| `freehold_glow_lantern` | Glow Lantern | enchanting / trainer |

- Pattern IDs/names: `pattern_freehold_clockwork_lamp` (Schematic: Clockwork Lamp),
  `pattern_freehold_chart_easel` (Technique: Chart Easel), and
  `pattern_freehold_jewel_floor_lamp` (Design: Jewel Floor Lamp). Each has its own
  `entities.items.<patternId>.name` key, rare quality, sellValue 100, corresponding
  `recipe_<outputId>` teaching ID and one 16-Mark `HEROIC_VENDOR_STOCK` offer in
  `src/sim/content/heroic_vendor.ts`. No luck route or pattern relic is added.
- Exactly `hearth_basics`, then `hearth_first_crafts`, form the current Hearth
  page inventory. The new page contains the ten outputs above in this order, each
  with its own profession source; its name is First Hearth Crafts. English name
  and desc are owned by `src/sim/content/reliquary.ts`, with `hearth_first_crafts`
  name rows in all eighteen base `src/ui/reliquary_i18n.locales/` tables. The five
  full non-Latin desc rows are in `{zh_CN,zh_TW,ja_JP,ko_KR,ru_RU}.ts`; the thirteen
  remaining base locale page-name obligations were repaired during the full gate.
  Changed guide keys are `guide.reliquaryPage.catalogBody` and
  `guide.profPages.craftProse.armorcrafting.ladderBody`. Item names and both guide
  keys have English sources plus the five M16 fills; compiled locale generation
  and wiki freshness passed in the shared gate.
- Original implementation snapshot totals were 43 pages / 484 raw slots / 337
  unique item IDs / 448 full-completion slots / 419 character-completion slots.
  After release merge `7f4fe99619`, `tests/reliquary_content.test.ts` pinned full
  completion at 462 and character completion at 433; after `a461924855` (the OSSBrain
  candidate's two developer mount slots) it pins 464 and 435; preserve incoming
  catalog additions rather than restoring historical totals. Channel
  pins preserve Crucible: 55 teaching items comprise 54 recipe manuals teaching
  76 drop recipes plus one enchant teaching item. There are 43 non-Crucible
  teaching items; furnishings are the seventh disjoint recipe family. Historical
  03 totals below describe its completion snapshot, not the current catalog.
- Thirteen item-specific `public/ui/items/<id>.webp` assets and
  `public/ui/items/mapping.json` provenance are authored under
  `crafted-content-art-2026-09-07/`; the final rug/provenance v2 has visual
  acceptance. `catalog-verification.json` records 1277 art catalog entries and
  1292 live item definitions, matching the current `scripts/item_art_audit.mjs`
  census. Its machine checks passed but its verdict remains null. The accepted
  runtime manifest is
  `docs/screenshots/freehold-crafted-content-2026-09-07/runtime/manifest.json`,
  SHA-256 `09ab384da4112f60b75cf8ebff986451dad6fda709fef158dda160713c653832`,
  143845 bytes. Its 42 captures are sixteen desktop, twenty-two mobile including
  scroll/portrait, two guide catalog and two catalog-prose views. Six actual
  locales, all thirteen icons, real bags/bank/vendor/tooltips/mail/trainer
  surfaces and three real purchases spending 48 Marks to zero on both desktop
  and mobile are verified, with zero page errors or unloaded images. Frontend
  reviewer and coordinator accepted the set without remaining art/capture nits;
  `items.accepted-art.json::review.runtime` records acceptance. This is software
  browser emulation; it proves neither physical-device/hardware LOW performance
  nor final GLBs/placement. This acceptance does not close the distinct paired 04 QA audit.
- Serialization measurement in `tests/professions_blob_growth.test.ts` now has
  215 known recipes including retired entries (previously 205), 19161 profession
  bytes and a 211458-byte maximal character fixture. The exact 1255-byte growth
  is 324 known-recipe bytes + 355 discovery bytes + 576 Hearth metadata bytes.
  The counterfactual 210203-byte baseline remains tested. The structural
  profession ceiling remains 20480 bytes; the server's 229376-byte threshold is
  still a warning, not a save cap. Finished database performance and persistence
  reviews PASS in `crafted-content-trial-2026-09-07/reviews/implementation-*.md`.
  Disabling the flag on this build preserves state. An older binary preserves
  unknown item copies and recipe strings but may discard unknown discoveries and
  Reliquary progress during load/save; lossless old-binary rollback is not claimed.
  The permanent item-ID golden appends only these thirteen IDs; it does not
  rewrite historical membership.
- Full-gate repairs cover Hearth/profile/guide/bag/Exchange/art/recipe/source
  pins and item IDs, with focused checks green. Sim's recipe list reads the
  capability through `ctx`, preserving the sole config-reader contract. The
  final shared command was
  `GATE_SELECT_BASE=49ed3f09333f4f1293edda9a98fe590c5651c20e node scripts/gate_select.mjs`:
  exit 0, all twelve steps green. Unit results: 3860 files passed / 34 skipped;
  57858 tests passed / 2 expected failures / 541 existing conditional skips.
  Browser results: 43 files / 376 tests passed. Typechecks, environment/server/
  bot/client builds, freshness, security and SFX all passed. Exact command/results
  and reviewer closure are recorded in
  `crafted-content-trial-2026-09-07/implementation-validation.md`, with execution
  log `/tmp/freeholds-crafted-gate-final.log` and reports in its `reviews/`
  directory. Final QA/fresh-review records replace their interim evidence status.
  The four original completion commits are `86eb86bbe2`, `8bd097d898`,
  `b3c2452b49` and `3666d89647`. The post-fourth-commit
  `npm run ci:changed` passed with exit 0, 1967 files checked and existing warnings
  only; working-tree status was clean. This receipt is incorporated by amending
  only the fourth documentation commit, keeping exactly four commits. The parent
  reruns `npm run ci:changed` after the actual final amended commit and records
  that result in the handoff. The commit IDs above identify the final original
  implementation, not an intermediate pre-amendment state. Subsequent dependency
  integration is `2e24ba8818`. The separate 04 QA audit later returned FAIL,
  with 29 findings, 28 accepted repairs and unresolved F01; see the current-phase
  summary and `crafted-qa-2026-09-07/validation.md`.
- Remaining production art/space gates: final crafted reference
  `docs/freeholds/art/references/freehold-crafted-a-board.png`, model family
  `scripts/assets/freehold_crafted/`, exporter `export_freehold_crafted.mjs`, spec
  `freehold_crafted.json`, parsed `tests/freehold_crafted_asset.test.ts`, remeasured
  final geometry/decor costs, legal maximum room packing/one-over refusal,
  protected arrival/navigation and actual LOW performance. Existing numeric,
  service and activation gates remain closed.

02 implementation notes: furnishing has `KIND_RANK` 11, immediately after tool 10 and
before mount 12; all existing relative ordering is preserved. Ordinary bag categories
are unchanged, with furnishings reachable through All only. The floor tooltip is a
registered pure core and the maker value comes from the copy signer, never the def.
The mount tooltip extraction lowers the `hud.ts` ceiling from 18716 to 18703. The UX
key manifest was regenerated byte-identically at 557 approved rows, including the four
existing owner-02 rows; no inventory count changed. No shipped furnishing ID or asset
was added. Scoped validation and `node scripts/gate_select.mjs` passed. The required COVERAGE
reviews, fresh fix-round review and final browser evidence all passed;
post-commit `npm run ci:changed` passed with exit 0. Three scoped commits are local,
with original evidence in `progress.md`.

02 QA notes: four repair commits end at `d386635394`; all 40 findings have
independently reviewed repairs and evidence. The shared item-instance projection
retains authored furnishing identity and real custody while excluding equipment
power. Existing enchant, Rift, feast, discovery, Exchange, WorldMarket and regalia
seams gained positive kind admission; no stored field, wire command, table or
endpoint was added. Existing regalia cache logic moved into its pure core;
`hud.ts` and `renderer.ts` ceilings are now 18663 and 12988. The final census has
zero MISSED sites. D25 remains the mount policy rule, ordinary bags remain
All-only and no source-absent footprint or cost is invented. The generic custody
key was regenerated through the owning pipeline; its exemption requires exact
key AND pending status. No furnishing locale overlay or asset was authored.
The renderer provenance remint changed only current hashes, preserving frozen
captures and asset bytes. Required scoped, host, PostgreSQL and visual reruns
passed. The complete shared gate also passed all 12 steps with actual exit 0;
standalone i18n generation/status and the repeated 110-file source seal passed.
The final verdict documentation, checklist and post-verdict-commit check are
recorded through the QA validation handoff. The named release and handoff gates
below remain unsigned.

03 accepted development implementation notes, 2026-09-07:

- The immutable original acceptance and integrated producer replay are in
  `content-trial-2026-09-07/{acceptance,revalidation}.md`. Fernando accepted the
  fourteen-visit laboratory basis, not measured player hours. Runtime production
  approval remains false and its production schedule null; the separate trial
  lookup returns one of twelve frozen bills for an injected week ordinal.
- Exact item IDs: `freehold_timber_bed`, `freehold_round_table`,
  `freehold_spindle_chair`, `freehold_low_stool`, `freehold_woven_rug`,
  `freehold_brass_lantern`, `freehold_storage_chest`, `freehold_open_bookshelf`.
  Each is common, 250/60 copper, cosmetic, individually stored and backed by the
  accepted measured stand-in geometry and registered painted art.
- `freehold_furnisher` is appended and admitted before entity construction only
  for lit hosts. It uses existing terrain, without a new smoothing pad. Existing
  terrain goldens and dark NPC/RNG fingerprints are preserved. Hearth publishes
  `hearth_basics` with those eight items and the actual vendor source. The
  catalog totals at 03 completion were: 42 pages / 474 raw / 438 full / 409 character slots.
- Homesteader deeds remain the manual `homesteader_first_furnishing` and
  `homesteader_first_cottage`, with the Homesteader title and `householder` border.
  Future placement and Cottage purchase grant sites remain later work.
- The maximal persisted fixture is 210203 bytes; the eight discoveries and Hearth
  metadata add 188 + 444 = 632 bytes. Earlier Homesteader 85 and Field Kit 12 byte
  attribution, narrow tracking band and 229376-byte warning threshold remain.
- Final shared gate, inspected visual evidence, paired QA and fresh review PASS;
  see `content-final-validation-2026-09-07.md` for the exact commands, four commit
  groups and all 39 resolved findings. NPC voice is an explicit pre-shipping
  requirement. Production enable still needs final numerical/geometry acceptance,
  compatible fleet-wide catalogs and the documented pre-enable backup boundary.

<details>
<summary>Historical partial checkpoint before development trial acceptance</summary>

03 implementation notes, 2026-09-07, PARTIAL/BLOCKED:

- `FREEHOLD_TIERS`, `FREEHOLD_TIER_IDS` and `freeholdTierById` publish the existing
  approved `inn_room`/`cottage` targets through frozen records and shared lookups.
  `FREEHOLD_CHARTERS` and `isKnownFreeholdCharterId` publish only
  `freehold_charter_cottage` -> `cottage`, without price or display copy.
  The source freeze records the 2026-09-06 Fernando R05/D31 approval proof and exact
  source hashes; it does not turn illustrative fees into sim values.
- The ledger catalog contains eighteen approved eligibility alternatives, preserving
  separate fish/produce choices and explicit base-first grade order. These are
  obtainable material identities only. `FREEHOLD_LEDGER_SCHEDULE` is exactly
  `{ status: 'pending_approval', calibrationId: 'CAL-LEDGER-A', schedule: null }`.
  No operational quantity, cycle, published bill version or selected weekly row
  exists. The source freeze records every missing CAL-LEDGER-A output and signature;
  literal eligibility/firewall tests cannot substitute for approved-cycle fixtures.
- New deed IDs are `homesteader_first_furnishing` and `homesteader_first_cottage`,
  appended at the actual `DEEDS`/`DEED_ORDER` tail. Both use the existing routine
  milestone value of 5 renown and manual triggers. Their rewards are the Homesteader
  title and `householder` border, respectively. The border uses the shared rendered
  home motif and palette, with no gameplay effect. Existing title/description/name
  localization carries the five required non-Latin fills. No automatic evaluator,
  placement grant or Cottage grant site is added; 08 and 15 still own the raises.
  Both painted deed crests have Codex/canonical-converter provenance in
  `content-art-2026-09-07/deeds.accepted-art.json` and local runtime WebPs. This is
  authored reward content, not a claim that its future housing actions are earnable.
- Hearth's literal shelf type, navigation/order, empty-safe window behavior, guide
  rendering/generator and localized labels are prepared. Published Hearth page
  inventory is empty. Planned page `hearth_basics` remains deferred until all eight
  actual item definitions and the vendor source resolve; it adds no completion
  denominator or arbitrary page limit. Homesteader joins the existing
  `horizons_titles` page through `RELIQUARY_HORIZON_TITLES`. The measured current
  `tests/reliquary_content.test.ts` pins are 466 raw slots, 430 full-completion slots
  and 401 character-completion slots across 41 unchanged pages. A title slot is not
  a furnishing item or Hearth page.
- The furnishing item IDs remain planned only: `freehold_timber_bed`,
  `freehold_round_table`, `freehold_spindle_chair`, `freehold_low_stool`,
  `freehold_woven_rug`, `freehold_brass_lantern`, `freehold_storage_chest` and
  `freehold_open_bookshelf`. No corresponding `ITEMS` entries, shipped-item golden
  additions, item-name locale rows or production item-art registrations exist.
  Planned NPC `freehold_furnisher` is absent from `NPCS`, spawns, stock and
  world-entity name rows. The eight icons remain staged candidates, documented by
  `content-art-2026-09-07/staged-art.json` and `size-review.webp`, rather than shipped
  furnishing assets. Their art does not provide numeric approval or model geometry.
- `content-source-freeze-2026-09-07.md` is the concrete numeric readiness artifact.
  CAL-LEDGER-A is produced by CONTENT/UPKEEP with ECONOMY QA and Fernando/service
  approval of exact bills. CAL-VENDOR-A is CONTENT's complete per-item copper/quality
  table for Fernando approval. CAL-DECOR-A/B is CONTENT/ART's measured model costs
  and legal maximum-layout/LOW evidence for Fernando approval. MEASURE-SPACE is
  ART/CORE's approved room/model/grid/footprint/collision/clearance evidence. All
  remain unsigned; the rug's explicit underlay `r: 0` does not complete its other
  required fields. Production bills and furnishing acquisition remain disabled.
- Coordinator-owned typecheck and all requested scoped suites pass, including 666
  tests in the exact twelve-file command. Wiki/i18n regeneration passed. Six required
  COVERAGE reviewers returned; instruction/art safety and pre/final database growth
  reviews also finished. Repairable findings are addressed and visual evidence is
  accepted. The shared gate passed all 12 steps (57665 unit and 373 browser tests).
  Fresh whole-fix review passed with no open findings or nits; evidence is in
  `content-validation-2026-09-07.md`. No overall PASS is inferred from scoped checks.
  The user subsequently authorized incremental local commits: `1d583786f6` records
  gate import-order repairs, `add3b7b2d9` the approved tables and `93710767dd` the
  deeds, Hearth consumers and their same-change obligations. This documentation
  checkpoint retains the reviews and `content-completion-checklist-2026-09-07.md`.
  Missing activation approvals do not prevent completed independent chunks from
  being committed. The final post-commit `npm run ci:changed` result is reported
  in task completion. No push occurred.

</details>

## Tracked release and handoff gates

There are no unanswered settlement questions. Signatures, measured calibration and
implementation evidence remain concrete acceptance work, with the following owners
and producing artifacts. Their absence blocks the named activation/submission, not
packet decision closure. The live PR dependency above is source state, not a product
question. Never present unsigned drafts as legal/platform/service acceptance.

| Gate | Artifact and producing work | Owner and activation condition |
|---|---|---|
| Economy catalog, authorization and settlement | ../prd/woc/freehold-service-contract.md; 07a/15 then every priced consumer | Economy service and Fernando accept catalog/version, opaque eligible-checkout proof, quotes, pooled ledger, durable recovery and published conversion/burn policy before new spend/enable. |
| Counsel, Terms and storefront model | ../prd/woc/freehold-counsel-memo.md, freehold-terms-amendment.md and freehold-store-listing-drafts.md; 14/15/16, checked 20 and revisited 44b | Legal team and Fernando approve/publish the applicable model before production enable or a housing-bearing storefront submission. Final 44b revisits the completed implementation and prepares the legal-team handoff. |
| Optional deed territories and irreversible authority | ../prd/woc/freehold-deed-service-contract.md and freehold-territory-authority-schedule.md; 37/38, checked 39 and 44b | Service/legal/Fernando sign supported territories, per-asset powers and transfer/irreversible-operation policy before optional deed activation. Unknown eligibility refuses new operations; accepted operation recovery remains required. |
| Approved numerical rows | content-numbers-workbook.md and content-manifest.md; each named producer; the four-week measured report at NEW FUTURE docs/freeholds/ledger-calibration-report.md and the every-second-release budget review at NEW FUTURE docs/freeholds/housing-budget-review.md, both created by 20 and extended by later closes | Fernando owns gameplay target acceptance and the service owns prices. Exact trial derivations, rounding, source and measured calibration/signature precede runtime activation; no missing quantity is guessed. |
| Accepted development content; production calibration unsigned | content-trial-2026-09-07/acceptance.md and revalidation.md supersede the historical content-source-freeze-2026-09-07.md for development; CAL-LEDGER-A, CAL-VENDOR-A, CAL-DECOR-A/B and MEASURE-SPACE retain named final acceptance | Fernando accepted the measured trial on 2026-09-07. CONTENT/UPKEEP/ECONOMY QA still produce final Ledger calibration for Fernando/service approval; CONTENT/ART and ART/CORE retain final vendor, decor, room/model/LOW approval. Production remains disabled. |
| Source calendar, lifecycle and rollout capability | persistence-rollout-contract.md EXISTS as of 07 and is **UNSIGNED**; lifecycle-policy-binding.md, lifecycle-db-contract.md and upkeep-calendar-db-contract.md are still owed by 07b/13a | Named service/operations/DB owners accept account source/reset-policy assignment, immutable history/finality, bounds, capable-release rollout/rollback and actual PG proof before upkeep activation. 07 supplies the capability and quiescence half with executed PostgreSQL proof and the measured bounds; publishing it is not signing it, and no owner has accepted it. `reset_policy_id` does not exist in code, so every 07 row is written `unbound_no_history` and a serving realm cannot infer a calendar from a row that never claimed one. |
| Final assets and image replacement | art-brief.md/content-manifest.md and per-wave final-asset proof; final 44a icon/image replacement | Codex asset sessions use existing intake/provenance/export/compile/LOW/screenshot gates. No placeholder is counted as a final shipping asset; final 44a rechecks all feature-created icons/images before 44b. |
| World PvP player copy names homes | `hudChrome.worldPvp.groundSanctuary` (src/ui/i18n.catalog/hud_chrome.ts) and the World PvP guide prose (src/ui/i18n.catalog/guide.ts) name only the Proving Shore and Eastbrook Vale as sanctuaries; a freehold room has been one since the v0.44.0 re-sync. Held back while housing is dark, because the live copy must not advertise an unlit feature | The phase that lights housing adds homes to both strings (English source, plus the five non-Latin fills if the value is wordy, M16) in the same change that lights it. |
| Runtime safety and distribution | 01 strict live FREEHOLDS_ENABLED gate; 37 FREEHOLD_DEEDS_ENABLED (default off, requires freeholdsEnabled); 38 NEW allowSerializedCollectibles policy switch (default off, beside allowMounts/allowMechChromas in server/woc_market_routes.ts); 14 seven-distribution capability matrix; every priced implementation and QA | Packet owners prove dark route/command/catalog behavior, complete forbidden submodel absence and independently approved management flow before activation. |


### Premises the 2026-09-26 sync moved (release/v0.44.0 at `09639d4ae9`, merge `8a330b3489`)

Found by the release-merge audit's premise lane, read from commits. Each item names the
corrected premise; the affected plan docs carry a pointer here. G1 is a RULING OWED before
28 builds; G2 and G3 also want Fernando's word; the rest are corrections.

- G1, RULING OWED BEFORE 28: GUILDHALL AUTHORITY IS A RANK PERMISSION, NEVER THE OFFICER
  TITLE. The release's custom guild ranks (`c01a1b8141`, docs/prd/guild-custom-ranks.md)
  made the rank a ladder of ids ('leader', 'member', 'officer' on the default ladder, custom
  'r1'..'r99') with per-rank permissions (`GUILD_RANK_PERMISSIONS` in
  src/sim/guild_ranks.ts: invite, remove, promote, bank, officerChat, motd, events). The sim
  sees only a stamped tier: `guildBankStampRank` collapses any rank holding 'bank' to
  'officer' and every other non-leader rank to 'member', so `GUILD_BANK_EDIT_RANKS`
  ({leader, officer}, src/sim/guild_bank.ts) now means "holds the bank permission", and it
  is module-private (a plain const), so the plan's "exported" set is a false premise too. Built
  as planned (28's `canEditGuildhall` over that set, "the hall edit set equals the exported
  GUILD_BANK_EDIT_RANKS set"), a custom Banker rank would manage the hall, pay for it and
  withdraw the fund, and an Officer whose bank was revoked would lose all of it. The ruling:
  either (i) append a new permission (for example 'hall') to `GUILD_RANK_PERMISSIONS` and
  `DEFAULT_OFFICER_PERMISSIONS`, with its server gate, its column in
  src/ui/guild_ranks_view.ts and its carry into the sim stamp (GuildMembership and
  normalizeGuildMembership, guildStampRankOf and guildBankStampRank), or (ii) rule that the
  ladder's 'bank' permission IS the hall permission. Either way REST gates (29's spend route)
  resolve `guildRankCan(membership.ranks, membership.rank, perm)`, client rows read
  GuildInfo.ranks through resolveGuildRankLadder, the planned refusal token becomes
  permission-neutral (for example `rank_not_permitted`; unshipped, so free to choose), the
  copy becomes "Your guild rank does not allow this.", and revocation includes a ladder
  save: `guildSetRanks` re-stamps every member (server/social.ts), so C03 build-presence
  clearing and 28's "revocation immediately ends access" hook that fan-out, not only a
  per-member change. Leadership succession follows ladder seniority (guildRankIndex,
  guildStepDownRankId). 30 and 32's rank scenes add a custom rank that holds the permission
  and an Officer rank that does not. Affected text: D55, D77, D78 below; the guild hall rail
  in Seams and names; implementation-plan.md (28 row); progress.md (28 row); phases 28, 29,
  30, 32 and 40; ux-spec.md `guild.officerRequired` and `charter.guildhallOfficerOnly`; the
  service contract ("officer-plus", "highest-ranked remaining member"), the terms amendment
  ("Authorized officers") and the guilds research appendix.
- G2, THE FERRY AND THE HEARTH KEY (`546e5289d9`). A ferry passenger under way is ADMITTED
  by the Hearth Key like any teleport (src/sim/freehold/entry_context.ts has no ferry arm):
  the ride ends on the next ferry tick (src/sim/transport_ferry.ts, the body "moved away by
  something else"), a parked pet returns beside the owner, inside the room, the cooldown
  advances once, and leaving lands at the Eastbrook gate drop, never the sea. The phase that
  lights housing online pins that order, or Fernando rules a `busy` refusal instead. On
  the Eastbrook route every berth, pier and lane waypoint stands at x <= -100, about 77 yd
  from the gate at its nearest; the Wickharbor to Drakelands route runs far to the east
  (berths at x 473 to 515).
- G3, TITLES HAVE A SECOND SOURCE (`55ce56306a`, `76109070b1`). Developer-badge rung titles
  ('dev:' ids, src/sim/dev_badge_titles.ts) resolve live from a GitHub link and the server
  clears them; they are not deed rewards. RULED 2026-09-26 (Fernando, "Let's go with all
  your recommendations."): 'dev:' titles are EXCLUDED from trophy sources (the
  DEVELOPER_MOUNTS precedent: revocable, not in-game); 17's re-plan builds on it.
- G4, THE EXCHANGE HAS A SECOND SURFACE (`b34952644d`). The character-select read-only
  $WOC Exchange browse (src/game/charselect_woc_market_wiring.ts over
  `wocMarketAttachAllowed(defaultWocMarketShell())`) is a second consumer of the Exchange
  gate. 14's distribution map folds both consumers; 38 rules whether plot listings appear in
  the character-select browse and gates that on deedSurfaces too.
- G5, EXITS SET FACING (`64a20afed2`). `leaveDungeon` sets `p.facing = door.facing` from the
  def's doorPos and leaveOffset (src/sim/instances/dungeons.ts), so a freehold exit faces
  south, away from the gate (pinned in tests/freehold_instance.test.ts at this sync). 25a's
  Fenbridge return override sets position AND facing, and its round-trip test checks facing.
- G6, TWO NEW COMMERCE CONSUMERS (`46f671ea61`, `678153fb72`). The Wanted board's buy orders
  (market_order_place, market_order_fill; src/sim/market_orders.ts) and the partial buy are
  commerce consumers the 02 census predates. They keep the listing rules (orders refuse
  soulbound and noMarketList furnishings, a fill takes only plain copies, deliveries and
  partial buys land one copy per slot), pinned in tests/furnishing_item_kind.test.ts at this
  sync; 22's market evidence includes both.
- G7, NITS FOR THE NAMED PHASES. 09/ux-spec: camera-wall occlusion has a dithered ghost arm
  (src/render/occluder_dither_fade.ts, instanced twin instanced_dither_fade.ts) beside the
  occluder_fade convention; interiors and instanced furnishings name both. 09: Action Cam
  (`db506e06ec`, default off) shifts the pivot and FOV over director poses, so 'hearthView'
  states how it composes, and capture rigs keep it off. 12: the placed mobile-station world
  object (src/sim/professions/mobile_station_object.ts, `801eded1a0`) is the reuse precedent
  for the station amenity, and a player can already place one inside an owner room. The
  content-numbers market-price snapshot: server/market_sold_volume.ts now counts partial buys
  and order fills in the sold series; the calibration report states whether they belong.
  Vocabulary: "transport" is now a sim domain (IWorldTransport, src/sim/transport_*.ts), so
  the housing plans say "wire transport" or "snapshot transport".

### Premises the aaff789813 sync moved (release/v0.44.0 at `aaff789813`, merge `dd7f954501`)

Found by the release-merge audit's premise, sim and render lanes, read from commits. G8 was
a ruling owed before housing lights (ruled 2026-09-27); the rest are corrections the named
phases apply.

- G8, RULED 2026-09-27 ("let's do what's best for the project and feature for all of
  those."; the resolution and its evidence are in the ledger's 2026-09-27 section): THE
  CARAVAN ROUTE PASSES THE GATE. The Eastbrook
  freight caravan escort (`esc_wq_eastbrook_caravan`, src/sim/content/world_quests.ts) walks
  the main street 4.8 yd from the gate at its nearest, and its third ambush (five level-5
  vale bandits in an 8 yd ring) can land about a yard from the arch and a few yards from the
  leave drop (measured: two bandits 6.4 yd from the arch, one 5.6 yd from the drop, the
  wave firing at waypoint 8). RESOLVED (`07f7250fb4`): the gate and the friendly caravan
  stay, and the third wave fires at waypoint 6, its worst case 12.93 yd from the arch;
  tests/freehold_gate_clearance.test.ts holds every escort ambush ring clear of the arch and
  the drop, and every route but the caravan (friendly traffic) keeps 12 yd.
- G9, THE ACTION LOCKS. A manned cannon, a live wisp maze trial, a shadow cloak and a glider
  run own a player's actions: `useItem` refuses every item use in them silently, before the
  Hearth Key's arm, and since `76b85c2b3a` the entry context answers `busy` too, so the gate
  refuses them loudly. The phase that lights housing decides whether the key's silent
  refusal gets a toast.
- G10, FENBRIDGE (25a): the infiltrator investigation (src/sim/content/world_quest_investigation.ts)
  puts five NPCs, two clue objects and a summoned hostile inside the hub around (-6,284), none
  of them in FENBRIDGE_LAYOUT; 25a measures its gate against them too.
- G11, A SECOND WEEK RULE (13): `weeklyQuestWeekForResetDay` (src/sim/weekly_quests.ts)
  derives a week from `resetDay` through `civilDayNumber`, and the Weekly Vault keys on
  `ctx.weeklyRaidResetMs`; 13's `realm_week.ts` folds or pins equality with them.
- G12, HEADLESS IS CALENDAR-FREE ON PURPOSE (13a): headless/env_server.ts keeps `resetDay`
  empty so rotating world quests stay dormant in RL episodes; a housing calendar fixture stays
  test-side or housing-scoped.
- G13, THE GUILD-CLEAR HOOK IS NO LONGER LAST (31): both callers of
  `onDungeonFinalBossKilledForDeeds` now run `onDungeonClearedForWeeklyQuests` after it, and
  the boss death hub gained `recordWeeklyBossKill`; 31's hook placement accounts for both.
- G14, THE 07a CENSUS (07a): server/weekly_reward_open.ts is a new durability-barrier
  `saveCharacter` caller, and `world_quest_scores` and `glider_course_bests` cascade from
  characters and accounts; both join the touch-set and the reverse-FK inventory.
- Nits for the named phases: offline builds inject `lockoutNowMs: Date.now`, so offline
  housing clocks are wall-clock; the reset calendar moved to src/reset_calendar.ts and its
  feeds carry five fields (`worldQuestExpiresAtMs` added); 08's build-presence clear belongs
  in server/disconnected_player_input.ts; 28's `ghall` self key copies
  `emitGuildAndWeeklySelfKeys` and `applyGuildBankSelfWire`; 17's mount sweep:
  DEVELOPER_MOUNTS is now only `terrorspark_groundshaker`; ux-spec's "Pay From Vault" labels
  say "Materials Vault" now that Eastbrook has a Weekly Vault; 11's build-mode gamepad
  arbitration takes its place beside the vehicle and temporary-bar modal arms.

Final ordering is 44 implementation, 44 QA, 44a Codex artwork, 44a QA, 44b legal
revisit/handoff, 44b QA. Only then can the completed program be reported; durable source
preservation still precedes any separately authorized cleanup. No push/PR or legal
message is performed in this documentation session.

## Gotchas (read before the matching phase)

- Character blob headroom (as measured on 2026-09-26, at the sync of `aaff789813`; the live
  measurement is pinned in tests/professions_blob_growth.test.ts and the threshold is
  `CHARACTER_BLOB_WARN_BYTES` in server/character_blob_size.ts): the merged maximal
  character blob measures 230,068 bytes, which crossed the old 229,376, so the threshold was
  re-minted by its own rule to 262,144 (`51d9e2b124`, confirmed by Fernando 2026-09-27): 32,076 bytes
  remain. The release's world-quest, faction and trinket rows took 2,815. The fixture does not model the release's sparse
  `CharacterState.pendingTownFocus`, so the real headroom is slightly less. The next
  housing content wave that grows the blob (trophies, more furnishings or Reliquary pages)
  forces a threshold decision; attribute and measure it, never widen the band.
- Reliquary page order: pages the release appends go BEFORE the unreleased Hearth
  pages; at the v0.44.0 re-sync the tail is `professions_forgebreaker`,
  `conquerors_vanguard_gallery`, `hearth_basics`, `hearth_first_crafts`
  (tests/crucible_reliquary.test.ts); phase 22 appends after `hearth_first_crafts`.
- Crafted availability (2026-09-07): a new `hello.freeholdsEnabled` value must
  invalidate the open crafting view signature even when inventory and profession
  data are unchanged. Keep the capability in the existing refresh signature;
  `tests/crafting_reagent_refresh.test.ts` drives this reconnect case.
- Recipe catalog cache (2026-09-07): the dark filtered list must follow supported
  `ALL_RECIPES` length changes while preserving stable identity when unchanged.
  Rebuild on the same length invalidation contract as the live recipe index;
  `tests/recipe_visibility.test.ts` covers insertion and removal.
- Crafted channel census (2026-09-07): after the Crucible merge,
  `tests/apex_pattern_channels.test.ts` pins 55 teaching items: 54 recipe manuals
  teach 76 drop recipes and one teaching item teaches an enchant. Furnishings
  form the seventh disjoint recipe family; 43 is the non-Crucible teaching-item
  count. Do not apply the old 40-to-43 total or sixth-family instructions to the
  merged catalog.
- Runtime capture (2026-09-07): change locale through the actual Options
  `changeLanguage` fanout. Importing a fresh Vite i18n module can mutate a second
  module instance while the live HUD stays English; inspect the rendered locale
  before accepting a localized capture.
- Item action slots (2026-09-07): neither furnishing nor recipe items have an
  action-slot surface. Capture their real bag, tooltip, crafting, vendor and
  Reliquary contexts as applicable; do not invent an action-slot proof for either
  kind or add a furnishing use action to satisfy the capture harness.
- Accepted content trial (2026-09-07): preserve the exact original artifacts and
  accepted twelve-bill version; production approval remains false/null. The
  actual eight-item Hearth page is published. Empty-catalog fallback still uses
  Overview and is exercised by the real window with an injected older catalog.
  Do not restore historical absence assertions or invent a page cap. NPC voice
  remains required before shipping. Older catalog readers discard new discovery
  and Reliquary metadata; acquisition enable requires compatible fleet-wide
  catalogs and a pre-enable backup, not merely flipping the feature flag off.
- Terrain (2026-09-07): a new NPC definition normally creates an automatic calm
  pad even when that NPC does not spawn. The furnisher deliberately uses existing
  ground. Both terrain goldens must remain unchanged; a feature flag must not
  split shared terrain between hosts.
- Catalog expansion (2026-09-07): the maximal character fixture earns every deed,
  so even currently manual-only records grow its serialized deed map. Isolate each
  new entry before historical content equations; the Homesteader pair contributes
  exactly 44 + 41 bytes. Shift both narrow tracking edges equally, preserve the
  warning threshold and obtain database performance review before and after the
  adjustment. Live art, profile and forced-color geometry counts also have their
  own literal tests beyond the main content suites.
- Screenshot evidence (2026-09-07): CI's sparse checkout couples every referenced
  screenshot subtree from all tracked reference-bearing files, including docs and
  acceptance manifests. A new retained subtree needs the same include in all five
  sparse test-job blocks and the exact cone literal in `tests/ci_workflow.test.ts`.
  Preserve computed set equality; do not narrow its corpus to avoid admitting
  required evidence. A focused parity run after staging catches the omission.
- Codex instruction audit (2026-09-07): follow `AGENTS.md` for runtime authority and
  `docs/codex.md` for effective loading. Read this worktree's skills explicitly if the
  desktop task still advertises another checkout. Use these Gotchas instead of Claude
  personal memory, and reuse only concern criteria from Claude fallback reviewers.
  Preserve staged `.mts`/`.cts` checks and effective Git hook ownership when changing
  adapters. Instruction/skill/hook-only diffs must reach CI security and tests. The
  selective gate is the completion bar; explicitly format new metadata and run
  `npm run ci:changed` after the actual last authorized commit. This audit does not
  start content implementation or change the completed furnishing QA verdict.
- `src/sim/sim.ts`, `server/game.ts`, and `src/net/online.ts` sit at ZERO monolith slack on
  the packet base (their `tests/monolith_budget.test.ts` pins equal their line counts
  there: 12006, 10336 and 5861), and `origin/release/v0.42.0` re-pinned them at 12465,
  10587 and 5873 in its drift commits (11923, 10291 and 5765 at `553a5672ed`); the
  `a461924855` merge re-pinned all six budgeted coordinators at their exact merged
  counts, zero slack (sim.ts 11796, game.ts 10188, online.ts 5606, hud.ts 18452, main.ts
  11247, renderer.ts 12878). The phase re-reads the pins from
  `tests/monolith_budget.test.ts` at phase start after the merge-forward and never budgets
  against either literal. Every delegate or case label added must be paid for by
  extracting an existing block first, then lower the ceiling. `IWORLD_MEMBERS` probes
  the prototypes, so facet methods stay one-line delegates on `Sim` and `ClientWorld`.
- Measured at the 01 head (2026-09-06, base still `origin/feature/masterwrought` 0f53c92ff7,
  PR 3872 open): `src/main.ts` ALSO sat at zero slack (11459) and needed a fourth
  extraction for its one `freeholdsEnabled` line. The four ceilings after 01 equal the
  files exactly: `src/sim/sim.ts` 11983, `server/game.ts` 10301, `src/net/online.ts` 5708,
  `src/main.ts` 11384. Every later phase re-reads the pins; 02's furnishing kind touches
  `src/sim/types.ts`, not a monolith, but any `sim.ts` merge line still owes an extraction.
- Locked during 01 (engineering, no product change): (a) the offline flag is gated like
  its two sibling live-world flags, `freeholdsEnabled: world === undefined` in
  `src/main.ts` (since moved to `src/game/offline_world_config.ts` `offlineWorldConfig`,
  which `src/main.ts` calls), so the stock offline world is lit (D3) while custom editor
  play-test maps and the editor viewport (`src/editor/3d/viewport.ts`) boot dark; the
  headless env passes `true`. (b) `SimConfig.freeholdsEnabled` on a realm is a BOOT
  SNAPSHOT of `FREEHOLDS_ENABLED` (a running realm needs a restart); only the wire
  predicate and the status route read the env live. (c) `freehold_enter` joined
  `JAILED_BLOCKED_COMMANDS` (a door step into instanced space); `freehold_leave` is
  deliberately not jail-blocked. (d) GET `/api/freehold` mounts a DEDICATED housing read
  limiter (`HOUSING_READ_POLICY`: IP-keyed, 60/min, tier-2 `none` so an allowed request
  pays no pg UPSERT; `HOUSING_READ_MAX_PER_MINUTE` in `server/ratelimit.ts`, pinned in
  `tests/server/tunables.test.ts`) AHEAD of the bearer guard and keeps auth AHEAD of the
  flag check (the flag never leaks to an anonymous probe); every later housing endpoint
  (15, 30a) follows that onion order. (e) `ctx.freeholdsEnabled` has zero production
  consumers until 03 (furnisher stock) and 06 (gate prompt, Hearth Key); the waiver is
  recorded beside the zero-consumer rule in `src/sim/CLAUDE.md`. (f) `ctx.freeholds` is
  owner-keyed: the first `loadFreehold` caller (05/07) pairs it with `evictFreehold` at
  account or character unload in the same change and registers the table prune in
  `server/retention_sweep.ts` with the DDL (07). (g) `freeholdTransitionId` is a
  ClientWorld-only mirror; its first consumer (08a) lands it on `IWorldHousing` and both
  hosts with the parity pin. (h) the first behavioral read of `ctx.freeholdsEnabled` adds
  a parity scenario booting the flag true (03). (i) the housing UI (11) gates its senders
  on a server-advertised capability so a dark realm never burns a command-lane token per
  click. (j) the real housing command bodies (08) re-validate the payload shape inside
  `src/sim/freehold/` so the offline host enforces what `server/freehold_wire.ts`
  enforces. (k) `FreeholdPlotId` is BRANDED (`src/sim/freehold/types.ts`), so a raw
  string, and in particular a `FreeholdState.ownerKey`, cannot be assigned to a public
  `plotId`; the only constructor is `asFreeholdPlotId`. 07's row mapper casts once at the
  database boundary. (l) `ctx.freeholds` is a `Map`, so it walks in INSERTION order, which
  is host-dependent once 07 feeds it. Sim code that iterates it MUST sort by owner key
  first or the three hosts fork on one seed. (m) `serializeFreehold` neutralizes
  `isDecorating` to false at the persistence boundary (C03: ephemeral presence never
  saves), so 07 cannot forget to strip it. (n) `ctx.freeholdsEnabled` is NOT re-checked in
  the sim command bodies, so `refusedFreeholdCommand` in `server/game.ts` is the sole
  enforcement on the COMMAND WIRE today (the REST status read gates itself in
  `server/freehold_routes.ts`). Whoever lands the first real body (08) either opens it
  with a `ctx.freeholdsEnabled` early return or records the ruling that the dispatch gate
  is the one gate. (o) `ClientWorld.buildPresenceSeq` is advisory and monotonic-WITH-GAPS:
  it advances even when the frame is dropped (spectating, closed socket), and no
  server-side ordering or drop logic exists yet. C03 must never treat it as a dense
  counter. (p) The five coined non-Latin renderings of "Freehold" are now locked in
  `scripts/i18n_glossary.json` under the `housingSystem` category (ja and ru
  transliterate, ko and both zh render the meaning; that split is the recorded ruling).
  Later housing surfaces reuse those forms and never re-coin a per-surface variant. (q)
  Three server-side throwaway Sims (`server/main.ts` initialCharacterState,
  `server/pbe_boost.ts`, `server/community_test_accounts.ts`) construct without
  `freeholdsEnabled`, so they are dark even on a lit realm. Harmless while no housing
  behavior exists; it becomes a hazard at 05/07 if a fresh character's default freehold
  record is stamped at serialize-character time, because a boosted or provisioned
  character would come out without one. (r) The 01 commits are ONE ATOMIC UNIT: the facet
  commit imports the sim types and appends the wire tokens before the module and the
  game.ts labels exist, so only the tip typechecks. Do not bisect inside
  `4c982784ff..c946091c07`, which holds FIVE commits: the four code commits plus the
  ledger commit that closes them. (s) The `blank_entity.ts` extraction is a
  neutral-default entity FACTORY, not the "decode block into a `src/net/*_wire.ts`
  sibling" the phase file named; the relief is equivalent and the move is verbatim, but
  the substitution is deliberate. The fourth extraction (`updateSeoMetadata` out of
  `src/main.ts`) is likewise unnamed in the phase file and justified by the remeasure
  clause. (t) `moveToward`'s doc comment lost an em dash during the otherwise verbatim
  move (the repo forbids em dashes and a Stop hook blocks them), so a future auditor
  diffing the two bodies will find one comment line that is not byte-identical. Everything
  executable is.

Parity findings the reviewers raised that are LATENT today and owed by a named later phase:
- THE DARK REFUSAL IS INVISIBLE ONLINE. All ten ClientWorld senders use `this.cmd({...})`,
  which attaches no `rid`, and `sendCommandOutcome` returns immediately without one, so the
  server's refusal sends the client nothing and it cannot tell refused from accepted. There
  is also no WS counterpart to the REST `freehold.disabled`. Symmetric with offline today
  (both are silent no-ops), so nothing is broken while dark; the moment the UI ships (11) a
  realm that forgot `FREEHOLDS_ENABLED=1` gives a dead button with zero feedback. 11 either
  sends these through `cmdWithOutcome` or gates its senders on a server-advertised
  capability, which gotcha (i) already requires for a different reason.
- WHEN THE DESCRIPTORS LIGHT UP (05/08a) THEY MUST RETURN VALUE COPIES, never a live
  reference into `ctx.freeholds.get(k).layout`. The online mirror hands out freshly decoded
  objects, so a consumer that mutated the offline live array would fork the two hosts while
  every test stayed green. `cloneFreeholdState` in `state.ts` is the tool.
- THE OFFLINE PATH VALIDATES NOTHING. The server re-guards every payload field before the
  sim; the sim bodies only resolve the caller. Both are no-ops today, so there is no live
  divergence, but 08 must not implement the bodies trusting the server guards or the offline
  world will accept a NaN coordinate the server rejects. Stated in the `commands.ts` header.

Hot-path findings REVIEWED AND DELIBERATELY NOT CODED in 01, recorded so the next phase
inherits the reasoning rather than re-deriving it:
- `moveToward` now reads the seed through `ctx.cfg.seed` twelve times, several inside the
  seven-entry slide fan, where it previously read `this.cfg.seed` directly. Hoisting a
  `const seed` would be one safe line, and it was NOT taken: the byte-clean move is the
  load-bearing property here (two reviewers verified the body diffs empty, and the whole
  extraction's safety argument rests on that), while the perf claim is explicitly unmeasured
  and V8 very likely inlines the trivial getter. The first phase that touches the mover for
  its own reasons should hoist it then, and re-measure rather than assume.
- `recordSlidingWindowAttempt` (`server/ratelimit.ts`) appends EVERY attempt including
  refused ones with no per-key cap, so one flooding IP grows its array unbounded and each
  call is O(N) to filter and spread. Pre-existing shared machinery every tier-1 policy
  already rides; 01 only mounts a new anonymous-reachable entry point on it. Out of scope
  as this branch's regression (the repo's rule on pre-existing whole-tree debt), but the
  cheap fix is to stop appending once the in-window count is already past the limit, since
  the verdict cannot change after that.
- The per-command-frame gate chain now runs two independent dark-feature predicates
  (`refusedRiftForgeCommand`, `refusedFreeholdCommand`) plus about seven other set lookups.
  All O(1) and dwarfed by the frame's `JSON.parse`, so nothing to do now; at a THIRD dark
  feature the seam is one `Map<string, () => boolean>` lookup rather than N sequential calls.
- When 05 lights `myFreehold`, the status route's body stops being a constant and becomes a
  per-account read. It must NOT become an inline `pool.query` in the handler: the seam is the
  keyed bounded per-account shape of `server/discord_status_cache.ts`, and if any moderation
  action can change what the descriptor shows, the bust wire lands in the same change.
- `OtherItemDef.kind` is an `Exclude` list: add `'furnishing'` to it or the new kind
  silently becomes a generic usable (Phase 02).
- `tests/market_filters.test.ts` fails on any `ItemKind` without a browse bucket.
- Parity goldens sample every `PlayerMeta` field by default; a session-only stamp goes in
  `META_EXCLUDE` with a justification; a new emit on a driven path reddens goldens until
  regenerated in its own commit.
- The vault craft gate refuses vault draws inside every instance band; the freehold arm
  (D18) must be explicit and negative-tested.
- `respawnTimer = Infinity` is required on any lootable-false ground object or the
  respawn sweep re-arms it one second later.
- Instances never persist; the row is the truth and the live slot is a cache rebuilt on
  every claim.
- `ALL_DELTA_KEYS` in `tests/snapshots.test.ts` is an exact count; every release sync
  conflicts on it. Bare `emit('key'` in an extracted emitter module is what the scrape
  counts.
- The character blob is CHARACTER state; the freehold is ACCOUNT state (D5). A pre-feature
  binary's first save drops unknown blob fields (forward-only rollout), one more reason
  the row lives outside the blob.
- Bed and crop ids are frozen save keys; furnishing ids, trophy ids, and plinth ids are
  frozen the same way once persisted.
- The offline `farmNowMs` returns the sim clock and the online one `Date.now()`: a house
  timer follows the facet's clock-base contract (`housingNowMs()`), never subtracting any
  other clock.
- Eastbrook polish seal: retired in Part 3 (commit 52f7a72714) with its re-mint scripts,
  so a `src/render/renderer.ts` edit no longer owes a re-mint or any pinned literal.
- Screenshots: seed the lowest graphics preset AND `graphicsDefaultApplied` before
  `page.goto`, or the device probe overwrites it; never locate elements by English text.
- Mobile shots: the iPhone UA locks the material tier; shots needing graded light emulate
  Android with an explicit `userAgent` variant.
- Authored-art normalization pin: pin the normalization contract beside the blob, never
  the blob alone; a fingerprint-only re-export that changes size is investigated first.
- Measurement records commit the per-step series, never a summary alone.
- Test-pin traps: a constant self-comparison, an unstripped source-text pin and a harness
  that cannot prove its tests ran are vacuous; every pin needs a can-fail negative control.
- Review discipline: apply ALL findings including nits; a fresh reviewer reads the whole
  fix round; CI is the gate; never push to a fork; PR merge needs approval; sweep every
  push for sensitive material. (These rows exist so Codex sessions, which read no Claude
  memory, meet the same rules.)

### 06 verification gotchas (learned 2026-09-08)

- Shared focus is a namespace and an ownership contract: use `FOCUS_KEY_ATTR` for
  emitted attributes and `focusedWithin` before repaint/retry focus restoration.
  A nested parked dialog can make a plain root-identity/contains check look owned
  when it is not. Pin that real negative case, while retaining the narrowly
  justified accepted-close blur read; never grant a broad focus exception.
- Before the full gate, reconcile exact window/frame, root creation, managed-close,
  language-fanout and command registries, plus extracted dispatch-source pins.
  Catalog census and byte-budget pins must come from their live canonical producer;
  keep historical approvals and counterfactual totals explicitly historical instead
  of modifying them to match today's inventory or widening the warning threshold.

- GPU cleanliness and visible first-view composition are different proofs. A room
  can draw cleanly while the player camera is behind an opaque wall. Inspect the
  actual gate/arrival screenshots after cutaway changes; counters cannot approve
  occlusion, controls or room readability. Measure event deltas over drawn-frame
  windows instead of reporting cumulative counters as new room work.
- Mobile capture navigation must use the visible QuickActions Chat control and
  close the menu before operating or judging the gate. Hidden chat shortcuts or an
  open menu covering the room do not demonstrate the real mobile interaction.
- A performance notice can arrive 30 seconds after entry. Capture must await the
  real notice resolution and retain its `noticeResolution` evidence, not infer
  completion from a clean early frame or spoof GPU/warning state to prevent it.
- `#gpu-notice` and `#perf-nudge` are different overlays. Dismiss the visible real
  buttons for each, wait for the ambient banner to clear, and verify the resulting
  scene. CSS hiding removes evidence of the actual UI and is not an accepted
  capture-preparation method. Keep before/after raw console reports intact; known
  baseline preload failures must not be silently relabeled as feature regressions
  or dropped from the producer record.
- Freeze the whole runtime for capture, including shared renderer, model/preload,
  UI and route dependencies. A running server with partial hot updates can combine
  incompatible old/new state; begin the final capture set from the frozen source
  and preserve its raw runner manifests before mapping PNG bytes to retained names.
- Gate recovery needs a user path even when a shed lane produces no response:
  close/reopen/retry must restore actionability. Optional friend adapters must keep
  composition/focus contracts testable while their unavailable production state
  remains honest. Preload mandatory attachments, and guard every new asynchronous
  renderer barrier with the owning Renderer generation; completing an old promise
  cannot authorize attachment into a replacement generation.

- A new capture producer must join the exhaustive `URL_GUARDED_SCRIPTS` importer
  inventory in `tests/loopback_guard.test.ts`, and output overrides such as
  `KEY_SHOTS_DIR` must join Turbo's pass-through environment declarations. Add
  new retained evidence directories to all five CI sparse cones and their exact
  test inventory. Keep the source-derived, index-aware reference guard intact;
  missing inventory entries are corrections, not reasons for exemptions.
- Live art coverage follows production eligibility. The Hearth Key action-slot
  repair raises the current painted hotbar set to 98, with explicit key membership.
  The historical 81/81 approval, its artifacts and seals remain immutable; update
  current producer-derived pins without rewriting past acceptance.
- Key possession is character-wide across carried inventory and personal bank.
  Test deposit, real JSON restore and physical entry before withdrawal to catch
  duplicate grants. Resolve occupied owner arrival before every claim/travel
  side effect, and pin saturated refusal plus ordinary-dungeon controls.
- A bounded renderer waiter owns its deadline and abort, while a shared cache
  fetch can outlive it. Dispose temporary instance handles only after compile and
  resume users settle; generation checks alone do not release those handles.
- Read-only game observation and real input must remain separate in captures.
  On compact bank layouts, wait for a stable unobscured hit target before a true
  touch tap. Label automated DOM-focus tooltip presentation explicitly, preserve
  failed-attempt logs, and report measured PNG dimensions (333 by 720 for these
  scaled-iframe fixtures). Do not convert requested dimensions into observed proof.
- Full browser checks can refresh unrelated screenshot outputs. Establish clean
  pre-run bytes first, preserve generated output, then restore only those known
  unrelated paths. Never use a broad cleanup that could discard existing work.

### 05 instance claim gotchas (learned 2026-09-08, read before 06, 07, 08a)

The first three bullets below preserve the **05 QA baseline and its measurements**;
they are historical findings, not a claim that the new 06 source still has those
missing guards. Current 06 source replaces the crypt rooms, adds authoritative gate
proximity/context confirmation, isolated-host Hearth cooldown, keyed feedback, shared
presence/relay classification and the measured-work counters. Its owner reaper indexes
claims once and walks the roster once, then checks at most one candidate claim per
position; ordinary dungeon/wide-room/Ignivar behavior remains on its existing path.
`updateInstances` has its own registered profiler lap after the preceding unstuck lap.
`server/instance_scan_tick_stats.ts` records current-tick values (including zero on
non-sweep ticks), capture totals and claimed-slot peak; the heartbeat reads
`ctx.freeholds.size` directly as an O(1) gauge. These are implemented source facts;
the latest room GPU result, accepted refreshed before/after captures, completed
shared full-gate PASS and completed timing harvest are recorded above. Actual
commit delivery and post-commit check results belong in the final delivery response.

The shared 24-slot/300-second owner pool remains unchanged and **BLOCKING before
production lighting**. The gate does not consume the account Hearth clock; source has
no separate physical-entry cooldown, so the earlier broadcast-cost bound remains an
explicit verification/rollout decision. No implemented-source row signs these gates.
07/07a still own durable account Hearth admission/serialization and its private account
mirror, which must never be placed on transferable `FreeholdState`; online key use
currently fails closed. 08a owns public descriptors, 09 owns day/night lighting and
fresh-directive arrival presentation, 12 owns service props, 18 owns visiting authority,
and 19 owns final GLBs. All remain unsigned and separate from the shell/gate evidence.

- The lighting ruling: `enterFreehold` has no proximity, cast, cooldown or position-context
  gate, so on a lit realm an out-of-combat player anywhere, INCLUDING inside another dungeon
  claim, a delve, a rift, a battleground, an arena, a duel or a moderator jail visit, could
  enter and leave to the Eastbrook quay (a free hearth and instance escape; an enter from
  inside another instance runs none of that instance's detach bookkeeping, no threat scrub,
  no BG/arena leave). FREEHOLDS_ENABLED stays dark until 06 lands the gate proximity confirm
  (which is ALSO the position-context guard, in the sim on both hosts: the gate stands on
  open overworld ground; the 05 QA's security and parity reviews both named this case),
  the Hearth Key context refusals (`instanced`, `match`, covering rift, delve, BG, arena,
  duel AND jail visit), and an enter cooldown. The cooldown is a BROADCAST-COST gate as well
  as a gameplay one: each accepted enter teleports across the band and rotates the viewer's
  whole interest set (the next snapshot re-sends every quay entity as a full record), and
  the only bound today is the shared 30/s command lane, so 06 cannot trade it away on
  gameplay grounds alone. Offline the host is lit (single-player), and `freeholdEnter` is
  on IWorld, so the console can reach it; no HUD control calls it yet.
- Pool bounds shared with dungeons for now, BLOCKING before lighting (the 05 QA's hot-path
  and security reviews both judged it so): 24 slots per room record and the 300 s
  INSTANCE_EMPTY_TIMEOUT hold, so at most 24 concurrent owners per tier per REALM (a 5000
  player default cap: about half a percent able to enter their own house at once), the
  25th answers `busy` with nothing moved (never a waitlist or a loss; the refusal is not
  sticky, pinned: the pool recovers once a slot reaps), and 24 accounts can hold a tier
  for five minutes at a time at zero cost. Not tuning: a total capacity failure at realm
  scale and a cheap griefing lever. The seam for the fix is an append-only
  `DungeonDef.slotCount` beside `claimKey` plus a per-claimKey empty hold.
- Hot-path facts measured at 16 x 24 = 384 slots (the 05 QA's hot-path review re-measured
  the reaper end to end and corrected the implementation-round figure): a dark realm pays
  about 0.04 us per second for the 48 new slots (`updateInstances` skips unclaimed slots,
  0.29 us for the whole 384-slot pass). Once claims exist, every claimed-and-vacated slot
  walks the full roster with no early exit and `instanceOriginOf` allocates one `{x, z}`
  per check: 48 vacated rooms x 5000 players = 240,000 checks measured at 5.08 ms, all
  landing in the ONE tick per second where `tickCount % 20 === 0` (about a tenth of the
  50 ms budget; the earlier 1.76 ms figure priced the 7.3 ns allocation alone, the real
  check is about 21 ns in that cache-hostile walk). Saturation is the expected steady
  state for per-account housing claims, not a worst case. Live claims also tax every
  `instanceClaimIdAt` call realm-wide (+311 ns per call at 48 live claims; per-player
  per-tick callers in the Ignivar and Varkhul encounters and the miniboss stomp), and the
  release's widened `inheritDungeonResetLocks` now walks the 48 owner slots per party join
  (cost only, nothing can match). `releaseFreeholdOnLeave` walks the roster on EVERY leave
  on a lit realm (every joining player holds a record, so its two guards short-circuit a
  dark host only): 16 us per leave at 5000, spread across the server leave's own awaits.
  BOTH halves are now [before lighting], not "the slice that opens the doors": cache the
  origin on the slot at claim time (a pure function of dungeonId and slot, immutable for
  the slot's life) or invert the walk, which also removes the `instanceClaimIdAt` tax; and
  a `ctx.freeholds.size` gauge plus a claimed-slot visit counter on the tick heartbeat
  (the `server/mob_scan_tick_stats.ts` shape) with `updateInstances` as its own profiler
  phase, because the 5 ms spike lands on exactly one tick in twenty (5% of samples), so a
  p95 watcher can miss it entirely and only p99 shows it. The client perf beacon classifies
  both rooms as `dungeon` (`src/game/world_telemetry.ts`, `server/http/client_perf_metrics.ts`),
  and three MORE name surfaces report the room by its dungeon name today: `/who` and the
  friend and guild rosters (`server/game.ts` instanceZoneName, status dungeon), the `!word`
  Discord relay (same lookup) and the admin live-location readout (`server/live_location.ts`);
  the admin dungeon label (`src/admin/i18n.ts` dungeonIdLabel) has no `dungeon.<id>` key for
  either room and falls back to the raw English name like the Ignivar rooms. A `freehold`
  scene class is owed for the beacon AND those three surfaces (or a `claimKey === 'owner'`
  key on each), plus the two admin label keys, before sustained idling in rooms exists (06).
- Tier change rule: after an owner-keyed arrival, `enterDungeon` frees the owner's VACANT
  claims on other owner rooms (`freeVacantOwnerClaims`); a claim a sibling character still
  stands in, or that still holds a released ghost's corpse bound to it, rides the reaper.
  A tier change while inside is therefore safe. The key clause is what keeps another
  owner's vacant room out of reach (pinned by a two-owner negative).
- The corpse run (05 QA ruling): a player CAN die inside a room (a hostile periodic aura
  keeps ticking after combat drops and passes the combat check), and the room has no
  door, so `dead` has one exception on the dungeon idiom: a released ghost whose corpse is
  bound to one of its OWN live owner claims is admitted to THAT room (the corpse's room, not
  the current tier's: a tier change in between leaves the corpse in the old room, which the
  vacant-claim sweep keeps while the corpse lies there, pinned) and resurrects at the
  entrance. A fresh corpse, a ghost bound to another claim, a ghost whose room the shared
  reaper already freed (it counts live bodies only, exactly as for a dungeon) and a ghost
  with no record refuse `dead`; the Spirit Healer remains the other way back. 06's
  proximity gate must keep admitting that ghost (it is a corpse run, not an escape).
- The record lifecycle on the realm rides the server's leave ordering: a linkdead
  displacement seeds the replacement BEFORE the displaced session's evict runs (`void
  this.leave(...)` reaches removePlayer after two awaits), and the evict is a no-op only
  because the sibling scan finds the new session. 07's persistence must not inherit that
  ordering (a load at join could race a serialize plus evict on the same key). The
  `entity:<pid>` offline key is stable within one Sim only (a content change that spawns
  an entity before the player shifts it): 07 never keys a durable row on it. Bots and RL
  agents (the headless env is lit) each hold an `entity:<pid>` record while they live,
  evicted with them; the `ctx.freeholds.size` gauge counts them.
- The dev bridge answers EVERY refusal alike (404, one fixed body): a 403 or a 405 would
  be an existence oracle for ALLOW_DEV_COMMANDS=1 on a `--host` dev port. The bridge module
  is NOT excluded from the production image (vite.config.ts imports it at load time and the
  .dockerignore allowlist admits scripts/lib, pinned by tests/dockerignore_context.test.ts);
  what is excluded is its ADMISSION (spread only under the exact flag, `apply: 'serve'` plus
  configureServer: the dev server only, never a build or preview). The client bootstrap
  ships in the production bundle and is inert there (returns false before any fetch).
- The community wiki seed (`scripts/mediawiki/build_seed.mjs`, `mediawiki/seed/pages.xml`)
  now honours `guideVisible` like the guide generator (the 05 QA: it published both rooms,
  and the Ignivar development rooms before them); `tests/mediawiki_seed_visibility.test.ts`
  pins the dungeon set. The two Homesteader deeds still have no raise site: 08 (first
  placement) and 15 (the confirmed Cottage grant) own them, never the dev grant.
- `/dungeons` readout is deliberately NOT memoized: `zoneAt` reads the ACTIVE world content
  that the editor play-test path swaps at runtime.
- The terrain-height corpus (`tests/terrain_height_parity.test.ts`) seeds each point by its
  index, so any mid-list insertion re-seeds every later point and the fixture cannot prove
  them; owner-keyed rooms are appended LAST for that reason. A re-mint that is not a byte
  prefix of the old body is a re-seed, never an extension: say so, and validate on Linux
  (recipe: rsync the tree minus node_modules into an ignored `tmp/` copy, `pnpm install`
  inside `node:26-bookworm`, run the suite; 132 tests green on aarch64 glibc this round).
- The dev bridge needs `ALLOW_DEV_COMMANDS=1` on the `npm run dev` process itself AND a
  loopback page host; captures of the Cottage run against such a server. `/dev dungeon
  freehold_inn_room` reaches the rooms directly on any devCommands host, bypassing the
  record and the refusals (dev-only; online it is blocked because no door entity exists).
- Monoliths after 05 (all at zero slack again): sim.ts 11857, main.ts 11269, game.ts 10202,
  online.ts 5629 at `497bc1d73f`; after the `a461924855` release merge and the 05 QA, sim.ts
  11796, main.ts 11247, game.ts 10188, online.ts 5606 (hud.ts 18452 and renderer.ts 12878
  at zero slack too). A SimConfig field costs a line in sim.ts (default) and in every host
  literal that sets it; the realm's is `server/sim_boot_config.ts` (no ceiling).
- Every refusal inside `enterDungeon` was traced for an owner room: the raid arm and the
  undersized-party notice are key-gated, heroic/lockout/mismatch arms are unreachable
  (`claimDifficultyForDungeon` returns normal), reset locks cannot exist (Reset All skips
  owner rooms), and `busy` is decided before the module runs. A new arm added to
  `enterDungeon` later must be re-traced for `claimKey === 'owner'`: the 05 QA re-traced the
  release's issue #3784 rework (the widened `conflictingResetLock` and
  `mismatchedClaimDifficulty` arms and the new normal-difficulty raid lockout arm keyed on
  the DAILY/WEEKLY room sets) and found none reachable for an owner room.

### 07 persistence pre-flight facts (measured 2026-09-08, before any 07 edit)

Recorded before dependent code was written, because several premises the 07 planning
text carries had already gone stale on this tree.

- **Base.** PR 3872 is MERGED at `6111e6d206`. `origin/release/v0.42.0` at `57a2ced3bd`
  is already an ancestor of the branch tip `c18facd4cc` through merge `6540713541`, and a
  fresh `git fetch origin --prune` moved no release ref. The 07 file's "while PR 3872 is
  open merge origin/feature/masterwrought" arm is DEAD; the release arm applies and the
  dependency block is retired (D69). No new merge was needed, so no release-merge audit
  and no `pnpm install` were owed.
- **Monolith ceilings, re-measured at `c18facd4cc` (`wc -l` against
  `tests/monolith_budget.test.ts`). EVERY tracked row is at ZERO slack**, so do not budget
  against any remembered literal: `src/ui/hud.ts` 18436, `src/render/renderer.ts` 12844,
  `src/sim/sim.ts` 11737, `src/main.ts` 11216, `server/game.ts` 9983, `src/net/online.ts`
  5604, `src/sim/world.ts` 5188, `src/game/music.ts` 4850, `server/db.ts` 4744,
  `src/render/foliage.ts` 3969, `server/woc_market.ts` 3945, `src/sim/colliders.ts` 2518.
  The two files 07 must wire (`server/db.ts` and `server/game.ts`) are both at zero, so
  each owes a behavior-preserving extraction plus a lowered, remeasured ceiling in the
  same change. The suite also fails any tracked file sitting more than 400 lines under its
  ceiling, so an extraction must re-pin close to the new size.
- **`bankBonusForAccount` does NOT return `characterCount`.** The 07 file and its QA both
  say "the release branch widens the return to include characterCount". It does not, on
  either arm: `server/ws_auth.ts` declares
  `(accountId: number) => Promise<{ bonusSlots: number; sources: BankBonusSource[] }>` and
  `server/main.ts` binds the one-liner
  `bankBonusForAccount: async (id) => computeBankBonus(await bankBonusFactsForAccount(id)),`,
  byte-identical on `origin/release/v0.42.0`. The only `characterCount` beside this
  callback is a stale fixture literal in `tests/action_bar_layout_persistence_game.test.ts`
  that type-checks only through a trailing `as unknown as` cast. Copy the one-liner shape;
  do not plan against the widened return.
- **The dev bridge's affirmative body is `{"authorized":true}`,** not
  `{"freeholdDevGrantEnabled":true}` as the 07 text says. `freeholdDevGrantEnabled` is the
  `SimConfig` and `SimContext` field name, never the wire key. Changing the shipped payload
  would red `tests/freehold_dev_authorization.test.ts` and
  `tests/freehold_dev_bootstrap.test.ts`; the divergence is recorded, not repaired.
- **The Vite composition is a conditional spread, not an `enabled:` expression.**
  `vite.config.ts` carries
  `...(freeholdDevAuthorizationEnabled(process.env) ? [freeholdDevAuthorizationPlugin({ enabled: true })] : [])`,
  pinned by both a text pin and an AST pin, and the config may never spell
  `ALLOW_DEV_COMMANDS` or the endpoint path. Behaviorally identical to the 07 text,
  literally different.
- **The reset-policy half of D84 does not exist in code.** `resetDayKey`
  (`server/raid_reset.ts`), `emberWeekAnchorOf`
  (`src/sim/professions/masterwrought_materials.ts`) and `REALM_RESET_TIME_ZONE`
  (`server/realm.ts`, exactly four code read sites) all exist. `reset_policy_id`,
  `resetPolicyId`, `calendarId`, `ledgerWeekOf` and `src/sim/realm_week.ts` return ZERO
  hits across `src/ server/ tests/ headless/ scripts/`. 07 is therefore the first code
  that would carry a reset-policy identity and has no resolver to call, which is why its
  initial rows are `unbound_no_history` with no upkeep-derived day or week stamp; 13/13a
  own the bound upkeep migration and the resolver.
- **The live record's day fields are the wrong type for D84 and must not be persisted as
  calendar facts.** `FreeholdState.conditionStampDay` and `ledgerPaidThroughDay` are
  `number`, documented as `utcDay`, and seeded `0` by `defaultFreeholdState`. D84 requires
  the realm-day `resetDay` string vocabulary. 07 persists neither as a day fact: the
  durable row carries an explicit unbound upkeep binding instead.
- **`account_freeholds` is keep-forever, which supersedes the 01-era prune expectation.**
  Gotcha (f) said the first `loadFreehold` caller "registers the table prune in
  `server/retention_sweep.ts` with the DDL". The 07 file states the table is bounded plots
  per account and keep-forever, so there is nothing to prune: the reverse-FK account
  cascade is the only removal path. The obligation becomes an explicit keep-forever
  comment at the DDL plus an absence assertion in
  `tests/server/main_retention_wiring.test.ts`, the shape that file already uses for
  `bank_ledger` and the storage receipts.

### 07a gotchas (learned 2026-09-30 to 10-01, read before the 07a QA and 08)

- Two pg suites (`tests/server/freehold_mutation.pg.test.ts` and the bank-ledger growth monitor)
  use a fixed verify-database name, so two runs against ONE server collide; the claim pg suite
  uses a per-process schema. Run concurrent pg work against separate servers.
- A plan pin on a small table flips its index choice under load: plan against a
  production-shaped, analyzed table inside a rolled-back transaction, then VACUUM ANALYZE, as the
  claim pg suite's plan pins do.
- The renewer guard (the case "pins every mention of the renewer by name" in
  `tests/server/freehold_mutation.test.ts`) pins toolchain files on purpose: the server bundle's
  build script and both Dockerfiles line for line, the vite, vitest and svelte configs by their
  declarations, package.json's keys, specs and flags, the compose runtime lines. An edit
  to any of them fails that case until reviewed: read the edit for an alias, loader or
  NODE_OPTIONS route, then update the literal. The case sits in the selective gate's always-run
  floor.
- A vite.config.ts mutant runs at config load: a write there is a real write (one mutant wrote
  `server/package.json` into the mutation worktree). Put a load-time side effect behind a
  never-set variable, and run mutants in a separate worktree.
- vitest prefers a root `vitest.config.*` over vite.config.ts, so a new one silently replaces the
  suite's config.
- Applying a clean fresh read's suggestions reopened the review loop twice, each application
  drawing a should-fix of its own; a strict pin with a stated boundary converged where a better
  parser, or a safety argument in prose, did not.
- An affected-suite run cannot see a guard in a file no changed module imports: the dark-arm
  record in `tests/freehold_npc_spawn.test.ts` and the setup-scope scan in
  `tests/vitest_setup_scope.test.ts` both failed only in the armed full suite. Run it before
  calling a round of new tests or goldens done.
- The malware scan (`npm run security:gate`, a gate step) blocks a test line that reads `.npmrc`
  by name (its credential-file rule); name such a file's contents in a guard's LIMITS instead of
  reading it. The scan walks `.npmrc` only with generic line rules: nothing checks its settings.
