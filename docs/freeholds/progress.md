# Freeholds and Guildhalls: progress

Foundation, furnishing item-kind, and content 03 implementation and paired QA are
complete locally. Crafted content 04 and its reconciled paired QA are complete
locally: **PASS**, with four findings found and resolved, zero deferred: three
source/test findings and the DOC-1 documentation nit.
The fresh entire-fix review and its supplement passed for the five-file repair
range `0932963250..69ffdab561`, across commits `d5ea0825d1` and `69ffdab561`.
It also inspected all six historical repair commits. The final shared gate exited 0 with all twelve steps green.

The current explicit protected-validator scope closes F01 prospectively. The
earlier paired QA **FAIL**, with 29 findings and 28 accepted repairs, remains
historical evidence. See [current validation](crafted-qa-reconciled-2026-09-07/validation.md)
and [findings](crafted-qa-reconciled-2026-09-07/findings.md). Production remains
disabled. Implementation 05 (the instance claim) is complete including its paired QA
(PASS, local, 2026-09-08): six implementation commits `c578fd77d0..497bc1d73f`, the
release sync `a461924855`, and fourteen QA commits `5f3fff5339..9b21dd61fc`.
Phase 06 and its paired QA are also complete locally: **PASS**, 37 findings found
and 37 fixed, zero open or deferred. Implementation 07 (bounded persistence and
stable plot identity) is **BUILT** locally with its implementation-round review
closed: sixteen commits `627a59a73c..c0b2891173`, nine COVERAGE reviewers plus a
fresh five-lane round over the fix round itself, every finding applied or ruled.
Its paired QA has NOT run. The next task is
[phase-07-qa.md](phase-07-qa.md).

Production calibration, activation, final GLBs and room/hardware LOW gates remain
unsigned; NPC voice remains required before feature shipment.

## Status

There are 56 bounded work items and 56 paired QA rows; their actual status is recorded
below. The 44 original numeric items retain their IDs and twelve suffixed pairs are
inserted into the chain. The next handoff is
[phase-07-persistence.md](phase-07-persistence.md).

| Phase | Status | Started | Completed | Verdict / notes |
|---|---|---|---|---|
| 01 Foundation | Complete (QA PASS), local | 2026-09-06 | 2026-09-06 | Six reviewers (cross-platform-sync, architecture, privacy-security, server-hot-path, test-coverage, qa-checklist): 0 blocking, 11 should-fix, ~25 nits, ALL applied; fresh review of the fix round PASS; gates unsigned (see notes) |
| 01 QA | PASS | 2026-09-06 | 2026-09-06 | Twelve auditors and reviewers (six bespoke audits plus the six required reviewers: cross-platform-sync, architecture, privacy-security, server-hot-path, test-coverage, qa-checklist). About 156 raw findings, deduplicated to 51 distinct: 1 blocking (self-inflicted, a glossary keyPattern registered ahead of its keys, caught by two reviewers and fixed), 0 blocking in the original 01 implementation. ALL resolved: 37 by a code, test or doc change; 14 recorded as reviewed-with-no-change-warranted, each with its reason. Fresh fix-round review VERDICT PASS at 4361ed5989 (zero blocking; it confirmed zero pre-existing assertions were weakened or removed, all four removed expect lines being equal-or-stronger replacements), and its three remaining findings were applied after it: the twelve-of-thirteen delegate correction, the vacuous descriptor arm replaced by a mutation-proven source pin, and the blank_entity scrape taught to follow Entity's heritage clause. Tip 2e247df270. Gates unsigned, see notes |
| 02 Furnishing item kind | Complete, local | 2026-09-06 | 2026-09-06 | Original implementation validation PASS; paired QA repairs and current evidence are recorded in row 02 QA and the notes below |
| 02 QA | PASS, local | 2026-09-07 | 2026-09-07 | 40 findings found and 40 resolved, zero deferred. Fresh entire-fix review PASS at d386635394 across 110 changed files and all four repair commits; final documentation and checklist PASS with both wording nits resolved. Final shared gate exit 0, all 12 steps green; 58,083 Vitest and 373 browser tests passed; standalone i18n/status PASS. Post-commit ci:changed actual exit 0 at c881543258 with clean status; the same check follows the evidence-only amendment. See furnishing-item-kind-qa-validation.md |
| 03 Content: tiers, Charter SKU, ledger schedule, vendor basics | Complete (QA PASS), local | 2026-09-07 | 2026-09-07 | Accepted twelve-bill development cycle, eight common 250/60 furnishings, measured geometry, gated freehold_furnisher, manual Homesteader rewards and hearth_basics (eight ordinary item relics). Production remains disabled. See content-trial-2026-09-07/acceptance.md and content-final-validation-2026-09-07.md. No push. |
| 03 QA | PASS, local | 2026-09-07 | 2026-09-07 | 39 distinct findings found and resolved, zero open. Paired correctness/coverage/hygiene, finishing and conditional reviews PASS, including fresh repairs. Final shared gate exit 0, all 12 steps; 57,726 unit and 376 browser tests passed. Runtime and canonical visual evidence accepted. Four reviewed completion commits; post-source-commit ci:changed exit 0, repeated after the final evidence commit with its result in the task handoff. See content-final-validation-2026-09-07.md. |
| 04 Content: crafted furnishings and quartermaster patterns | Complete (QA PASS), local | 2026-09-07 | 2026-09-07 | Reconciled paired QA PASS, four findings resolved (three source/test findings and DOC-1); fresh entire-source-fix review PASS at `69ffdab561` and documentation correction recorded in [docs-final.md](crafted-qa-reconciled-2026-09-07/reviews/docs-final.md); current evidence in crafted-qa-reconciled-2026-09-07/validation.md. Final shared gate exit 0, all 12 steps: 4028 unit files passed, one CI-sentinel file skipped; 60610 tests passed, 2 expected failures and 28 explained skips. Chromium passed 47 files and 389 tests; the separate PostgreSQL 16 run passed 57 tests. Earlier implementation revalidation: shared gate all 12 steps PASS, fresh content/coverage/doc-fix reviews PASS; see crafted-content-revalidation-2026-09-07.md for exact current outcomes and final commit-check receipt. Original accepted development v1: ten recipes/outputs, three 16-Mark patterns, Hearth page, thirteen final icons/provenance and 42 runtime captures. Shared gate exit 0, all 12 steps; implementation QA/fresh review closeout recorded in crafted-content-trial-2026-09-07/implementation-validation.md. Four authorized commits `86eb86bbe2`, `8bd097d898`, `b3c2452b49` and `3666d89647`; post-fourth-commit ci:changed exit 0 (1967 files, existing warnings only), clean status observed. The original completion receipt called for the same check after its documentation-only amendment; no push. Production gates remain unsigned. |
| 04 QA | PASS, local | 2026-09-07 | 2026-09-07 | Four findings found and resolved: three source/test findings (HN1, COV-1, PER-1) and one documentation nit (DOC-1), zero deferred. Fresh entire-fix review and supplement PASS for `0932963250..69ffdab561` (five files, commits `d5ea0825d1` and `69ffdab561`), including all six historical repair commits; required content, coverage and qa-checklist reviews completed. Final shared gate exit 0, all 12 steps: 4028 unit files passed, one CI-sentinel file skipped; 60610 tests passed, 2 expected failures and 28 explained skips. Chromium passed 47 files and 389 tests; the separate PostgreSQL 16 run passed 57 tests. Historical F01 is closed prospectively by the current explicit protected-validator scope; the earlier 29-found/28-repaired FAIL remains unchanged. See [findings](crafted-qa-reconciled-2026-09-07/findings.md), [validation](crafted-qa-reconciled-2026-09-07/validation.md), [fresh source review](crafted-qa-reconciled-2026-09-07/reviews/fresh-fix.md) and [documentation review](crafted-qa-reconciled-2026-09-07/reviews/docs-final.md). Branch local, production disabled; 05 is next and remains Not started. |
| 05 Instance claim | Complete (QA PASS), local | 2026-09-08 | 2026-09-08 | Six commits `c578fd77d0..497bc1d73f` off the `7f4fe99619` release merge (the paired QA then synced `553a5672ed` as `a461924855` and re-validated everything below at `9b21dd61fc`; the implementation-round gate figures in this row were taken at `7f9ca00cbd`, before that sync): the two owner-claim DungeonDefs (`freehold_inn_room` index 15, `freehold_cottage` index 16, `claimKey: 'owner'`, placeholder `crypt` interior, doorPos north of the Eastbrook mailbox surround, moved there by the 05 QA so the drop lands on open ground), the host-stamped owner key (`account:<id>` online, `entity:<pid>` offline, META_EXCLUDE), owner-keyed enter/leave through the dungeon slot pool with text-free `freeholdDenied` refusals (dead, combat, no_freehold, busy), the default tier-0 Inn Room record seeded at addPlayer on a lit host and evicted at the last session out, `setFreeholdTier` as the one tier writer with the `/dev freehold <tier>` grant behind devCommands AND the new nonpersisted `freeholdDevGrantEnabled` (realm: `ALLOW_DEV_COMMANDS=1`; offline: the dev-only Vite loopback bridge `GET /__freehold/dev-authorization`), lit `freehold_enter`/`freehold_leave` dispatch behind the unchanged dark gate, a malformed-account refusal through `planJoin`, Unstuck and Reset All owner-key aware. Three monolith extractions lowered sim.ts to 11857, main.ts to 11269 and game.ts to 10202 (online.ts untouched at 5629). Seven domain reviews plus a fresh whole-fix review and the qa-checklist gate ran; every finding including nits applied or recorded as a named gate (see state.md). Validation: the 54-file battery 1986 tests green, tests/parity 265 green with the 81 existing goldens byte-identical and `freehold_claim` minted, both real-browser dev-grant probes PASS (flag-off refuses, flag-on loopback grants), the terrain fixture re-minted as a byte-prefix extension and verified on Linux aarch64 in Docker (132 tests), `npm run ci:changed` exit 0, and the shared gate on the committed tip PASS (all 12 steps: 4039 unit files, 60940 tests, 2 expected failures, 28 skips; browser 47 files, 389 tests). Production stays disabled: FREEHOLDS_ENABLED must not be lit before 06's gate proximity confirm and Hearth Key context refusals (the lighting ruling in `src/sim/freehold/instance.ts`). |
| 05 QA | PASS, local | 2026-09-08 | 2026-09-08 | 119 finding rows (about 90 distinct) across thirteen coverage reports (the release-merge audit, the correctness, test-coverage and hygiene auditors, the architecture, cross-platform-sync, server-hot-path, content-obligations, privacy-security and qa-checklist reviewers, and three fresh fix-round reviews), every one applied in code, tests or docs or recorded as a named gate with an owner (the pool bound and the reaper cost re-tagged BLOCKING before lighting), zero deferred. Fourteen QA commits `5f3fff5339..9b21dd61fc` after the `a461924855` release sync: the quay drop onto clear ground (pinned on every seed, glibc-verified), the owner's corpse run and the corpse-aware tier-change sweep, the unusable-tier refusal, the uniform dev-bridge refusal, the wiki seed's guideVisible gate, the re-pinned deny-toast layer, the re-minted golden and terrain fixture in their own commits, 183 carried shard weights, and the ledger rulings. Fresh fix-round reviews: the first FAILED on four should-fix (all applied), the second FAILED on two (applied), the third PASS with three wording nits (applied and confirmed). Final shared gate at `9b21dd61fc`, armed, full-suite mode: PASS all 12 steps, 4160 unit files passed and 1 skipped, 62624 tests passed with 2 expected failures and 28 skips, browser 48 files and 392 tests, typecheck and builds green; `npm run ci:changed` exit 0 after the last commit. Not pushed, no PR. |
| 06 Interiors, the Eastbrook gate, the Hearth Key | Complete (QA PASS), local | 2026-09-08 | 2026-09-08 | Authored Inn/Cottage shells and safe deterministic owner arrival, explicit Eastbrook gate, permanent Hearth Key with character-wide carried/bank possession, isolated account cooldown and fail-closed realm admission; guarded prompt/refusals and usable action assignment; bounded renderer preparation/disposal, indexed owner reaper, O(1) record heartbeat and shared presence. Five delivery commits through `67281f8ed4`, followed by independently reviewed QA repairs through `957a93b05b`. Current captures, complete gate and scoped limits are recorded below. |
| 06 QA | PASS, local | 2026-09-08 | 2026-09-08 | 37 findings found and 37 fixed, zero open or deferred: 36 source/capture findings and DOC01, the final execution-ledger wording correction. Required audits, finished persistence/database review and fresh independent entire-fix review PASS through `957a93b05b418ac5baf7c164679b7bd72017b3c6`. Final PostgreSQL-armed shared gate exit 0, all 12 steps: 4,210 unit files and 63,227 tests passed, two existing expected failures and 27 explained skips; 51 browser files and 429 tests passed. Typecheck, builds, security and artifact freshness passed. All 18 canonical, 20 presentation and eight actual-key PNGs independently inspected; source/raw seals match and final hardware LOW deltas are zero within measured room windows. Failed attempts and nonfatal diagnostics are retained. See [QA receipt](qa/interiors-2026-09-08/README.md), [execution](qa/interiors-2026-09-08/execution.md) and [fresh review](qa/interiors-2026-09-08/reviews/fresh-fix-review.md). The actual-last-commit `ci:changed` check follows the separate verdict commit and is not claimed here. Production remains disabled; 07/07a durable authority and later named gates remain unsigned. |
| 07 Persistence | Built, local (TEN fix rounds applied; nine of the ten introduced a defect worse than one they closed, the verification session's own included, which two fresh reviewers caught and which was reverted; paired QA owed; eleven named gates carried UNCLOSED) | 2026-09-08 | 2026-09-09 | Forty-seven commits `627a59a73c..f55a103fd7`. Two account-scoped tables, `account_freeholds` (PRIMARY KEY `(account_id, plot_index)`, UNIQUE `plot_id`, deliberately NO third index because `account_id` leads the key and the FK cascade probes that prefix) and `account_freehold_hearth`, both KEEP-FOREVER, both off the retention sweep with an absence pin, both on `POST /api/account/export`. A five-arm versioned load (`absent`, `loaded`, `unsupported`, `malformed`, `oversize`) where only genuine ABSENCE resolves to the free tier-0 Inn Room; every other class is preserved byte-identical and the account is write-blocked for the session. A bounded store: one running plus one pending write per owner key, a local admission cap of four (eight for the shutdown drain, plus a two-slot reserve a leaving session may borrow), compare-and-swap on `durable_rev` carried as exact bigint TEXT, a 5,000 ms login-path permit wait separate from the 15,000 ms background one, and a leave flush bounded at 2,000 ms that gives up the WAIT but never the write. TWO measured byte ceilings because they bound two different texts: `FREEHOLD_MAX_OWNED_BYTES` 101376 on canonical JSON (measured 101139) and `FREEHOLD_MAX_STORED_BYTES` 106496 on what jsonb renders back (measured 106032, the delta being exactly jsonb's re-rendered separators), with a `FREEHOLD_STORED_DETOAST_GATE_BYTES` pre-gate of 131072 ahead of the `octet_length` bound, re-derived from STORED measurements after a first attempt calibrated it against an unstored expression and was wrong by a factor of forty-four. `freeholdWriteRefusal` applies every predicate the loader applies, so writable implies readable, proved by a real-PostgreSQL round trip of the maximal record. Three behaviour-preserving extractions paid the monolith ratchet with ceilings LOWERED to exact measured counts (game.ts 9920, db.ts 4605), none raised. NEW `docs/freeholds/persistence-rollout-contract.md` states capability, the four fixture classes, the bounds and the rollout/rollback quiescence; it is published and UNSIGNED. **NINE fix rounds ran, and eight of the nine introduced a defect worse than one they closed, every one caught by a fresh reviewer and never by the round's own green tests** (see [the ledger](qa/persistence-2026-09-08/findings.md)). ROUND NINE was a verification session run on the assumption the work was wrong: six independent reviewers plus a forty-mutant pass over the store's own guards, of which twelve survived. It found the SEVENTH path to an empty default landing on a real house (a reseeded record stops being pristine the moment the returning player touches it, so the seal admitted it; reproduced against the real store, an empty layout at wire revision 1 written over a furnished cottage at revision 7 with `plot_id` untouched and no counter moving) and its MIRROR (a healthy fresh account whose entry re-read the row it wrote was write-blocked for its whole session, which is the Y1 failure moved onto the row-read path by round seven's stamp removal; reproduced independently). Both are FIXED and pinned in both directions: a record carrying the stand-in identity is now judged by CONTINUITY, a live revision below the entry's last committed one, rather than by name, and the entry consequently caches one identity instead of two. The round also introduced a defect of its own, a null dereference behind a short-circuit, caught by its own no-op control and fixed in the same commit. ROUND TEN then reverted two of round nine's own changes, because both fresh reviewers found it had done what eight rounds before it did: the stand-in exemption admitted a seeded default as soon as the returning player's edits carried its revision PAST the entry's (executed both ways, refused at the baseline and written with the exemption), and deleting the entry's second cached identity silently taught the sim a different plot name on every replay. Both reverted and pinned in both directions. The trade is stated rather than hidden: the fresh-account quiesce the revert re-exposes costs one session's edits, admitting a seed costs the house, and the row survives either way, so the defect is PINNED AS IT BEHAVES in a case named for it and carried as a named gate whose fix (teach the record its minted identity at INSTALL) is a maintainer decision rather than a fourth clause in one boolean. Validation at round nine: `npx tsc --noEmit` exit 0; the named 14-file battery 691 passed, 3 skipped; a 26-file battery 1,282 passed; every one of the 41 suites that import a changed module, 1,259 passed with 3 pg suites skipped; both `.pg` suites ARMED and confirmed EXECUTED (32 passed armed, the same 32 skipped with the variable unset, which is how the arming is proved); `npm run ci:changed` exit 0 over 636 files, warnings only. `node scripts/gate_select.mjs` PASSED, exit 0, ALL 12 STEPS GREEN, at tip `f55a103fd7` with the pg suites ARMED: 4,217 test files passed and 1 skipped of 4,218; 63,654 tests passed, 2 expected-fail, 28 skipped; plus the real-browser suite 51 files and 429 tests. The selective planner FELL BACK to the full suite on a 1,728-path diff, so this was the deeper check rather than the selective one. The first attempt FAILED (exit 1) on two suites and both were diagnosed rather than re-run: `tests/server/freehold_hearth_db.pg.test.ts` carried a real defect (its isolation pin demanded that NO schema but the private test one hold `account_freehold_hearth`, which is false on its own documented recipe, where the target database already carries the game schema in `public`; the sibling plot suite already filters on `current_schema()` and the hearth copy never was), FIXED in `f55a103fd7`; and `tests/item_art_audit_builder.test.ts` timed out spawning a subprocess under full-suite load, passes 7/7 in isolation, and is touched by nothing on this branch. Still owed and NOT claimed: the paired QA, the ten carried gates in [the rollout contract](persistence-rollout-contract.md) section 8a (a terminal hold for a capacity refusal, the two admission caps summing past the shared gate, unbounded retention under a stalled gate, the two-slot leave reserve, the unstated 15,000 ms statement bound on the login read, the unbounded export read, four load-failure causes sharing one label, the double serialization on the write path, the second full record per online owner, and the plot identity a live record never learns), a player-facing surface for a write-blocked hold, and the 07a realm participant that would call `advanceFreeholdHearthOnClient`, which today has no production caller at all. Production stays disabled and every release gate stays unsigned. |
| 07 QA | **FAIL**, local, 2026-09-10 | 2026-09-10 | 2026-09-10 | NINETEEN commits `dd4c869a2b..e1dc483dc5` on top of `861fc3bf63`. VERDICT FAIL, on ONE blocking finding that is NOT fixed because its fix is a ruling this packet reserved for the maintainer: **the EIGHTH path to an empty tier-0 Inn Room landing on a real house**. For an account whose entry MINTED its own row, `applyWriteResult` caches the identity the LIVE RECORD carried, nothing teaches a live record its minted name, so that entry's cached name IS the stand-in and a freshly seeded default carries the same literal: the write seal's name comparison is INERT BY VALUE EQUALITY for that whole entry class, and the two continuity arms left standing are both revision-shaped, so a reseeded default whose revision has CAUGHT UP satisfies neither. Reproduced three times independently (the correctness reader, its adversarial verifier, and this session's own probe written from scratch against `createFreeholdPersistStore`): a row holding tier cottage, one furnishing, one trophy, condition 91 and policy friends at wire revision 7 was compare-and-swapped to an empty Inn Room at wire revision 8 and again at 9, with `quiesced` 0, `write_failures` 0, no error line and `plot_id` untouched, while controls at revision 0 and 5 both refused. U1's revert reasoned entirely about entries that loaded a ROW and never considered the entry the same session's U3 ruling deliberately created. Realized loss on a PRODUCTION realm today is zero (`setFreeholdTier` is the only live-record mutator this release ships and its only caller is the development grant), a granted tier on a dev realm, and the whole house the moment the furnishing writer or the Charter grant lands. PINNED AS IT BEHAVES in two cases named KNOWN DEFECT plus a contrast arm proving a row-loaded entry still refuses the identical reseed, so the fix flips a red test. The interim guard the reader proposed was REFUTED here: judging the stand-in case by content instead of by revision write-blocks the one live-record mutator this release ships, which is the Y1 failure class again. Eleven reviewers reported (three independent readers plus migration-safety, database-performance, privacy-security, server-hot-path, architecture, cross-platform-sync, frontend-seam and test-coverage; the qa-checklist lane never returned and is recorded as unrun). THREE mutation passes: 40 mutants over the store against a proved no-op control (`Tests 163 passed (163)`), 29 killed and 11 alive, of which eight matched standing rulings and three were coverage gaps; then 13 mutants over the fixed store, 12 killed; then the last one, killed. A ruling BROKE: "the pristine arm is dead while the name comparison is TOTAL" rests on a premise false for a minted-row entry. FIXED and pinned: `drainCheck` was a third "owes work" predicate that answered DRAINED over unwritten edits; `pumpLoop` admitted a deferred leaver at the non-leaving cap so the reserve bought nothing past two leavers; `server/game.ts`'s join guarded `addPlayer` alone while a dozen throwable calls sat before `clients.set`, and its leave ran three release lines outside any guard while all three callers fire it with no catch; the revision-coupling scan the seal rests on missed every mutator shape the next writer will use, including `moveFurnishing`'s, and its bump matcher accepted `state.rev = 0`; the log bound covered two of nine producers while the ledger recorded it closed; three server predicates keyed the Hearth Key by a re-typed literal; the account read shipped the unadmitted second row in full and the export read had neither a LIMIT nor a byte gate; the load-failure kinds, the login statement bound, four inert or gameable pins, and one en dash. Paid for by extraction, both ceilings LOWERED and neither raised: `server/leave_character_save.ts`, `server/freehold_session_binding.ts` and `server/freehold_persist_wiring.ts` are new; `server/game.ts` lands at 9914, six under what the packet inherited; `server/freehold_persist.ts` is newly tracked and lowered to 2319, twenty-four under its own opening count despite seventy lines of new logic. A reviewer caught the ratchet ledger claiming 9920 was unchanged when this packet had itself lowered the row to 9916 and then put it back; that was a raise, it is recorded as one, and it is paid rather than re-recorded. THIRTEEN fix rounds ran and ELEVEN introduced a defect worse than one they closed, never caught by the round's own green tests. THE FIX ROUNDS WERE THEMSELVES REVIEWED, three times, and each had done it again. Round twelve: deleting the private leave-save method left four live call sites reaching it through a private accessor, which `tsc` cannot see, and the gate went red on ten tests including the whole money-conservation property sweep; repaired, and the extraction now carries the behaviour test it never had. ROUND THIRTEEN closed the late reviewer's tail plus three this session found while verifying it: the login reads had been bounded by wrapping EACH in a transaction helper, which bought the right bound at four times the network cost (eight round trips on two clients held across four statements apiece, now five on one, through an optional combined `readDurables` port); the constant's docblock and contract section 8a both still argued the pre-fix arithmetic and still ASKED FOR the change that had just landed, and `SET LOCAL` was measured to bound each statement SEPARATELY (two 300 ms sleeps under a 400 ms bound both completed, 612 ms elapsed), so the corrected worst case is 5,000 + 2 x 2,000 = 9,000 ms against a 10,000 ms handshake, down from 19,000, which is a MARGIN not a bound and leaves section 8a's gate open on its budget half; the two login port shapes DISAGREED about a malformed clock payload, one failing open and the other holding the whole login, now one path for both and pinned by driving one payload through both arms; and a MUTANT SURVIVED over the composition root, because nothing in the suite imports it, so removing the swallow that makes a shared transaction safe left all 180 cases green with `tsc` silent. Closed with four behaviour cases over the combined port and three source pins over the binding, and FOUR mutants over the wiring all KILLED against a proved control of `Tests 183 passed (183)`. Transaction semantics measured against real PostgreSQL rather than assumed: a second statement failing under a caught handler leaves the first statement's returned rows intact and the trailing COMMIT answers a ROLLBACK tag without throwing, for SQLSTATE 42P01 and 57014 alike. `node scripts/gate_select.mjs` PASSED, exit 0, ALL 12 STEPS GREEN, at tip `29b1f85307` with the PostgreSQL suites ARMED: 4,218 files passed and 1 skipped of 4,219; 63,685 tests passed, 2 expected-fail, 28 skipped, in 750.58 s; plus the browser suite 51 files and 429 tests. The planner FELL BACK to the full suite on a 1,733-path diff, so this was the deeper check rather than the selective one. `npx tsc --noEmit` exit 0; `npm run ci:changed` exit 0 over 640 files, warnings only; both `.pg` suites 33 passed ARMED and the same 33 skipped with the variable unset, which is how the arming is proved. The browser step rewrote four PNGs under `docs/screenshots/`, restored with `git checkout --`. ROUND FOURTEEN: the four fresh lanes dispatched over round thirteen all went idle without reporting, that round was written up as unreviewed, and THE REPORTS THEN ARRIVED LATE with seven findings, TWO OF THEM DEFECTS ROUND THIRTEEN HAD INTRODUCED. The sharpest: round thirteen's clock swallow covered only the hearth promise, not the COMMIT the timeout helper issues afterwards, and the two SQLSTATEs it cited as evidence (42P01, 57014) both LEAVE THE CONNECTION USABLE, so the probe could not see the case it was cited for; a fault that kills the connection made COMMIT reject and the account was held and write-blocked for a fault in the clock, which is the opposite of what the commit and the contract said. Also: extracting the composition root silently dropped the statement bound off both fallback ports while the new header claimed nothing changed; the merged reader branched on the hearth VALUE rather than on which port was bound, reintroducing the exact coupling the merge removed; the 9,000 ms figure omitted five statements (BEGIN and SET LOCAL run before the lowered bound is in force) so the floor is about 41,000 against a 10,000 handshake and section 8a's gate is restored undiminished; three of round thirteen's own new pins were defective, one running 740 characters past its subject; and the export truncation marker shipped with no executed coverage at all. All closed, with four fresh mutants KILLED against a proved control of 184 passed. Fourteen rounds, twelve of which introduced a defect worse than one they closed. **ALL FOUR RULINGS AND SIX SCOPE CALLS WERE SETTLED 2026-09-10** and are recorded in the ledger under THE WORD IS GIVEN: take the identity fix in its SAFE form as one change (closing C1, C22, V6 and the eighth path); make the three admission-class holds re-readable while the four data-class holds stay terminal; record the entries map's derived ceiling rather than adopt a cache; state the admission overcommit as accepted with its arithmetic; close section 8a's login budget gate; scope C23's player-facing surface but build it separately; accept and document the offline plot-id divergence; read the whole packet fresh before writing new code; land the rulings plus the login gate and stop; stay local. STILL OWED, now as WORK rather than decisions: a fresh read of `dd4c869a2b..HEAD` by someone who did not write it, guild-book routing and the combined login port first; executing the four rulings (C1 with C22 and the eighth path, C2, C3's seam, the policy half of C5), a player-facing surface for a write-blocked hold, the browser flag-off and flag-on runtime proof, and the runtime proofs the database reviewer named that depend on those rulings. Next rerun: [phase-07-persistence.md](phase-07-persistence.md), with [the ledger](qa/persistence-2026-09-08/findings.md) attached. |
| 07 rulings executed | **FAIL** (record, not an open defect), local, 2026-09-10 | 2026-09-10 | 2026-09-10 | TEN commits `07521507d6..0be2f181e2`. The four settled rulings and the six scope calls were EXECUTED. Ruling 1: `installLoadedFreehold` installs a default carrying the load's minted identity on the ABSENT arm only, through the existing load-once path, closing C1, C22, V6 and the EIGHTH path; the mint was also found to be per ENTRY rather than per owner, so the absent arm adopts a live record's identity when there is one; `revisionRegressed` is un-gated from `standInSeed` with its own executed proof. FOUR pins flipped, not the two the ruling anticipated, and two of them encoded a deliberate-backwards-write rule that is RETIRED with its reason. Ruling 2: the three admission kinds no longer set `entry.loaded`, so a later join re-reads them while the entry stays write-blocked; the four data kinds stay terminal. Ruling 3: the entries map's derived ceiling (about 10,300 concurrently dirty owners per sweep) is RECORDED in the contract, no cache and no eviction policy. Ruling 4: the admission overcommit is STATED AS ACCEPTED with its arithmetic, and the peak-concurrency pin is written against that answer through the real shared gate. The section 8a LOGIN BUDGET GATE is CLOSED by capping the WHOLE preload, and the premise it was written on was refuted by measurement: AUTH_TIMEOUT_MS is cleared before the handshake's database work, and COMMIT answers to neither server-side bound (three PostgreSQL 16 probes), so the floor is 104,000 ms and the four figures published before it were all wrong in the same direction. C23 is SCOPED in `held-plot-surface-scope.md`. The offline and headless identity divergence is ACCEPTED and documented in four places. TWO FRESH REVIEW ROUNDS, 66 findings between them, ALL APPLIED: the whole-packet read before any code (36 findings, one BLOCKING, 35 surviving three-lens verification) and the read of the fix round itself (30 findings, THREE BLOCKING, 27 surviving), and TWO of that second round's blockers were defects the first had introduced: a settlement throw dropped a session from both guild-book indexes without reverting its unflushed money deltas, and the identity fix was not total because a record seeded while its own load was refused can never be named, which the absent arm now refuses to create a row for. EIGHTEEN mutants across five passes, each against a proved control; sixteen died first time, TWO SURVIVED over the composition root and the login policy and were closed and re-killed. Paid for by SIX extractions with no ceiling raised: `freehold_write_seal.ts`, `freehold_install.ts`, `freehold_persist_registry.ts`, `freehold_load_outcome.ts`, plus `revertOwnGuildBookOps` and `markGuildBookDirty` to `guild_book_holders.ts`; `server/game.ts` LOWERED 9914 to 9907 and `server/freehold_persist.ts` 2319 to 2243. `node scripts/gate_select.mjs` PASS, exit 0, all 12 steps, planner fell back to the full suite on a 1,742-path diff: 4,219 files passed and 1 skipped of 4,220; 63,729 tests passed, 2 expected-fail, 28 skipped; browser 51 files and 429 tests. Both `.pg` suites 34 passed ARMED and the same 34 skipped unset. VERDICT FAIL for one reason only: this round's own fix round has not been read by anyone who did not write it, and sixteen rounds have run of which fourteen introduced a defect worse than one they closed. THE DIFF BASE HAS MOVED to `origin/release/v0.43.0` and no sync was performed, because the tip was pinned; the next session owes the merge-forward. NOT PUSHED, no PR, nothing merged. |
| 07 release sync v0.44.0 | **Closed**, local, 2026-09-23 | 2026-09-22 | 2026-09-23 | Merges `ffa7ac5ffb` (`release/v0.44.0` at `56525e0343`, 80 conflicts by hand, five fresh audit lanes) and `190329610f` (the release again at `fc86d90234`, the craft-roll audit, two union conflicts). Everything the sync left owed is DONE in `190329610f..HEAD`: the Freehold Gate moved to `(-38.65,-103.75)` (the ruled `(-28,-82)` took two garden beds' press; two nearer cells failed a chosen margin or the town circle), with the golden, the terrain tail (Linux aarch64 and x86_64) and the polish provenance re-minted; four render rules that kept the arch from drawing, picking and streaming on a lit host fixed; the prompt's tabs on the library look with a forced-colors cue; the leave lines say town; the capture harness rebuilt and all 18 frames re-shot twice, the final set sealed at 67 sources and 17 harness files; four coverage reviewers plus three fresh reads of the fix rounds, every finding applied or recorded with its reason; 474 unmeasured test files carried at the median of three local runs armed against Postgres (`7cf74b411d`; table coverage 1.0, 4,538 of 4,538, against the 0.918 floor); the armed gate green on every step but `sfx:check` and 22 audio tests, all of which fail on this macOS 27 host's missing Rosetta for the bundled x86_64 ffprobe (full suite 4,548 files and 68,154 tests passed; one real red found and fixed, a corpus floor mis-pinned at the sync merge). 07's verdict stays FAIL on the harness-fidelity rewrite. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), THE OWED LIST WORKED THROUGH. |
| 07 release re-sync v0.44.0 | **Closed**, local, 2026-09-25 | 2026-09-25 | 2026-09-25 | Merge `484cb61a46` takes `release/v0.44.0` at `ed69f62ef7` (120 commits: World PvP, King of the Hill, Warfare Season 2, frame presets; 64 conflicts by hand, i18n and guide regenerated, the polish provenance re-minted, the wire-cache double extraction collapsed onto the release's module, three same-delta auto-merge pins caught). Terrain corpus and every golden byte-identical, no re-mint. Four audit lanes and three fresh reads, every finding applied or recorded: homes are World PvP sanctuaries and keep honor gear health (`isOwnerClaimRoomAt`), furnishings bar class gating, the jail header moved beside its table (`server/game.ts` lowered to 9758), the plan premises corrected. The capture set was RE-SHOT (a probe refuted the re-hash: the release removed the unit frame's move toggle through an unsealed input), sealed at 67 inputs at `1910fd578c`. 483 shard rows carried. Rulings recorded: the gate margins stand (item 6 closed); Rosetta installed, the armed gate green on all 12 steps with `sfx:check` and the audio tests (item 7 closed). 07's verdict stays FAIL on the harness-fidelity rewrite. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), THE RE-SYNC OF RELEASE/V0.44.0 AT ED69F62EF7. |
| 07 harness-fidelity rewrite | **Done**, local, 2026-09-25; 07 QA stays **FAIL** on the twelfth path (a ruling) | 2026-09-25 | 2026-09-25 | `37e6ae6624..3686434478` plus its records; the base did not move. The store's four liveness reads come from ONE live map through `server/freehold_liveness.ts`, bound by the composition root and the harness alike; the harness has the two moments of a login, a record leaves only at the last `removePlayer` after its leave flush, a per-read audit fails any case that sees the four disagree, and a row lives in a database that keeps what `upsertFreehold` keeps. 75 of 211 cases went red; 125 changed or were added onto producible orders, none weakened (round seventeen's Q3 CLOSED). The first fresh read found an ELEVENTH path (a join after the old record's eviction installed an empty default under the real minted name, measured in two orders), fixed fail-closed at the install (`besideLiveRecord`, required). Later reads found a TWELFTH (a stale answer read with nothing live, when another session edits and is evicted inside the handshake): while that session's capture is unwritten the stale record is written with no edit and no window, unless the store knows a commit above it, when the leaver's later edits are lost loudly (or silently, if the joiner reaches that commit first); after the capture commits it needs only that the joiner reach the committed revision before a write samples the record. Its arms are pinned as KNOWN DEFECT or KNOWN COST, the few left unpinned listed in the ledger, and it is ESCALATED for a ruling. Seven fresh reads (the last three found nothing blocking), every finding applied or recorded; 218 mutants plus one type-level, every changed pin killed; the armed gate green on all 12 steps at `3686434478`. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), THE HARNESS-FIDELITY REWRITE, AND THE TWO PATHS IT FOUND. |
| 07 ruling (b), the twelfth path | **Done**, local, 2026-09-26; the twelfth path CLOSED; 07 re-judged **FAIL** on three pre-existing capture-loss orders (a ruling owed), not on the twelfth path | 2026-09-26 | 2026-09-26 | First a sync: merge `b627c4ad32` takes `release/v0.44.0` at `9dbc47938a` (the floor VFX ladder; six provenance conflicts, re-minted), a probe-backed re-hash of two sealed capture inputs (`75bc308552`), the release-merge audit (one premise corrected, `5eb2aa01d1`). Then the design written into the ledger before code (`22d883d3c2`) and the fix (`b77421251a`): the handshake re-asks after the character read, and the join installs the store's answer at install time through a new synchronous call (`answerForInstall`, pure core `server/freehold_join_answer.ts`), from the loaded entry with its capture, or withheld when no entry vouches for it; `besideLiveRecord` renamed `recordWithheld`; the store's ceiling lowered 2193 to 2150 by extraction. Every KNOWN DEFECT and KNOWN COST pin flipped and every unpinned arm pinned in one 89-case block; the retired orders' cases rebased, none deleted to get green. 19 mutants plus a control (419 tests), every one killed; the whole fix reverted kills 86 of the 89. Then a second sync, merge `8a330b3489` (`release/v0.44.0` at `09639d4ae9`: 548 commits, 43 conflicts by hand), audited by four lanes (one blocking premise recorded as ruling G1, the rest applied), twelve sealed capture inputs re-hashed on a probe. The owed list worked through: three targeted mutants killed; the four docs; five reviewers (one blocking, each ask arming the whole budget, fixed as ONE housing budget per handshake, with re-ask and verdict measures and a per-kind capacity line limiter, the store's ceiling 2150 to 2058 by three extractions); 84 shard rows carried; six fresh reads to nothing blocking; a DOM-env harness retention leak fixed with a before and after measurement (1,862 to 359 MB retained on the worst file); 44 mutants in all, 43 killed, one recorded survivor; the armed gate green on all 12 steps at `ec2d4be98d` and again at `a1fb50db45`. 07 re-judged: only genuine absence resolves to the tier-0 Inn Room and no committed edit is lost, but a captured edit is still lost, loudly and keeping the row, in three pre-existing orders (a run of thrown writes, another realm's commit fencing a leave write, the shutdown drain's deadline), the first two pinned as KNOWN COST; a ruling is owed. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), RULING (B) FOR THE TWELFTH PATH and RULING (B) FINISHED, AND 07 RE-JUDGED. |
| 07 rulings of 2026-09-26 and the aaff789813 sync | **Recorded and synced**, local, 2026-09-26; 07 stays **FAIL** until R1 is built | 2026-09-26 | 2026-09-26 | Fernando ruled "Let's go with all your recommendations." and "Let's keep it all on this branch.": R1 keep a leaver's capture past a thrown-run quiesce and retry it once per error window; R2 the cross-realm fence to 07a; R3 the drain deadline accepted; R4 (G3) `dev:` titles excluded from trophy sources; R5 every test-audit recommendation incl. the `@vitest/spy` patch, the listed deletions approved after coverage proofs; G1 and G2 still owed; test cost is now a standing guarded rule. Then merge `dd7f954501` takes `release/v0.44.0` at `aaff789813` (267 commits, 63 conflicts by hand; the world-object bootstrap double extraction collapsed onto the release's module with a `beforeDungeonDoors` hook), every count pin, digest, seal and corpus re-measured; integration fixes `51d9e2b124` (blob warning 229,376 to 262,144 by its own rule, Fernando to confirm), `e2a4845e4a`, `f899ccb24f`; a four-lane audit, its fixes `554b9631cb` and `76b85c2b3a` (busy entry refusals under the release's four action locks), premises G8 to G14 recorded (G8, the caravan route beside the gate, a ruling owed before housing lights). NEXT: Part 1 from STEP 2 (the R1 design, then the build) in a FRESH session. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), FERNANDO'S RULINGS OF 2026-09-26, AND THE SYNC OF RELEASE/V0.44.0 AT AAFF789813. |
| 07 ruling of 2026-09-27 and the 3bdb537657 sync | **Recorded and synced**, local, 2026-09-27; 07 stays **FAIL** until R1 is built | 2026-09-27 | 2026-09-27 | Fernando ruled "let's do what's best for the project and feature for all of those." on the aaff789813 sync's open decisions: the 262,144 blob warning stands (`51d9e2b124`); G8 is resolved by the option best for the feature, on evidence; the emissary cache pool is restricted to wearable kinds; the manned-cannon leave-order test is written. Then merge `60cd9f859a` takes `release/v0.44.0` at `3bdb537657` (one commit, the release tier's locale fill; one generated conflict, regenerated; both sides' overlay lines preserved; no sealed input, monolith row, patch or test file moved). NEXT: G8, the emissary pool and the cannon test, test-first; then Part 1 from STEP 2. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), FERNANDO'S RULING OF 2026-09-27, AND THE SYNC OF RELEASE/V0.44.0 AT 3BDB537657. |
| 07 R1 built and 07 re-judged | **PASS**, local, 2026-09-27, with the two named gates (R2 fence, R3 drain deadline) | 2026-09-27 | 2026-09-27 | The 2026-09-27 ruling's items first: G8 (`07f7250fb4`), the emissary pool (`52ef856a28`), the cannon pin (`7157aae3a2`). Then R1: the design written first (`d2fbd3bfc0`), the retry clock built test-first (`d0e96f8514` and its pins), the persistence suite trimmed with a coverage proof per deletion (`700f2eb685`), seven reviewers and three fresh reads (0 blocking, 6 should-fix, 32 nits, all applied: the drain-bounded exception, the retry sub-cap and its own deferred measure, the measured offline memory bound, the branded refusal, the single-realm self-fence reading), 36 mutants all killed, the store's ceiling lowered 2,058 to 1,988 through three extractions, and the armed gate green on all 12 steps at `3167e0cbbc` (72,957 tests, browser 541). NEXT: Part 2, the repo-wide test cost work. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), R1 through STEP 6. |
| Part 2, the repo-wide test cost | **Done**, local, 2026-09-27; nothing pushed, so the CI half is owed | 2026-09-27 | 2026-09-27 | The brief's twelve items in order: Leak A (the `@vitest/spy` pnpm patch plus `releasedSpyOn`; `freehold_wire` retained 1,757 to 561 MB and it passes under a 1 GiB heap), the Svelte setup scoped to `tests/admin` (403.91 s of aggregate setup to 18.15 s), every worker capped at 2 GiB and every run sized by one host module, the lane gaining the warlock anchors and the five-minute windows with a seed diet, the druid matrix kept at one seed on PR and eight nightly, lane files opt-in in a bare local run (every gate leg opts in; nothing dropped under CI), parity recording twice with its bounds re-derived (largest shard 75.41 to 19.34 s), the SFX Studio suite on a fixture root (39.78 to 6.11 s), `anim_pipeline` 26 files to one, `snapshots`/Varkhul/Ignivar split and `equip_drop_core`'s `Hud` case moved out (696 to 168 MB), the approved deletions each with a coverage proof, and the durable guard (the measured lane threshold, `npm run test:memory` nightly, the rules in the three docs and two agents). Three reviewers and nine fresh reads, 0 blocking, every should-fix and nit applied; the first final gate caught one regression (item 6's lane spread failed the dev-watch guard at load), fixed and hardened over four reads; 128 mutants, all killed; the armed gate is green on all 12 steps at `c2e49691be` (72,917 tests, browser 541; the full run 946.50 to 856.75 s). NEXT: the HUD-import cost refactor, if Fernando wants it; the CI half when this is pushed. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), PART 2, THE REPO-WIDE TEST COST. |
| Part 3, unused assets and test necessity | **Done**, local, 2026-09-27; nothing pushed | 2026-09-27 | 2026-09-27 | Fernando's rulings: every screenshot and GLB test must catch a real regression, and anything with no use at all is deleted. Browser capture opt-in behind `VITE_EVIDENCE_CAPTURE=1` with its guard; the evidence byte-seals removed; 411 unreferenced screenshot directories and 67 files pruned (tracked corpus 2.5 GB to about 1.27 GB); the Eastbrook polish seal retired; the lockfile out of every GLB fingerprint (48 re-stamped once); the retired Rallycart's assets and vehicle code and six replaced wreckage GLBs deleted (1,416 GLBs to 1,409). The HUD import in nine batches: `src/ui/hud.ts` 18,045 to 14,883 lines, runtime importers under `tests/` 49 to 3; two player-facing fixes (emote wheel hit zones under a UI scale, the craft plate queued as a celebration). A frontend seam review per batch plus fresh reads of each fix round, 0 blocking, all applied or recorded; 39 mutants killed; the armed gate green on all 12 steps at `206720229b` (72,939 tests, browser 541). OWED: 490 palette-only GLBs wait on a production read of the editor maps. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), PART 3, UNUSED ASSETS AND TEST NECESSITY. |
| Part 4, the release/v0.45.0 sync and the first CI runs | **Done**, pushed, 2026-09-28 | 2026-09-28 | 2026-09-28 | Fernando ruled the four Step 0 questions as recommended and "Push the branch as is". Merge `555d16f445` takes `release/v0.45.0` at `ac9ed4db24` (179 commits, 96 conflicts, four audit lanes). Step 3: the five flat HUD modules behind `hud/` barrels, the Crucible confirm in `hud/vendor/`, the capture receipt's success path, the feed mode ending with its pet. Step 2 blocked on the production key (nothing deleted). The first CI runs fixed a one-ulp arm64/x64 spawn height, re-derived the lane bound (28 to 36) and pr-gate's (37 to 49), harvested every shard weight (two files split under the 90-second rule), and the first nightly's eight-seed druid arm now runs one case per seed. Fresh reads round by round until a round came back without a should-fix. After the Part 4 commit: a latent happy-dom fetch flake stubbed and pinned in three suites, two holes in the declared-timeout ratchet's scanner fixed (one had hidden a 120-second case), and the release's #2514 harvest sweep and a Groveheart case, each at the edge of its 20 s default, given 60 s. 226 mutants, 224 killed, 2 equivalent; the armed gate green on all 12 steps at `e57856af25` (73,987 tests, browser 554); CI run 36493201427 fully green in full mode there; the final nightly ran the eight-seed druid arm green, its only red the release-owned druid band. Found for the CI owner: the changed-files lint job checks nothing on PRs and queue runs. OWED: the production palette read, pr-gate (one slow-checkout wall to rule on) and release-gate re-derivations, the release-owned list. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), PART 4. |
| Part 5, test cost and test value | **Done**, pushed, 2026-09-29 | 2026-09-29 | 2026-09-29 | Six rulings, all as recommended (targets; pr-gate 49; unreferenced screenshots may go; the probe idle cull; the Scouring Mercy bounds; the devotion pins; the druid nightly cells; a three-worker trial then slimming; the lane stall floor). Every target met on green full-mode CI 36654475632: summed shard test step 115.73 to 73.05 min (36.9 percent), slowest shard job 24.0 to 13.40 min (44.2 percent); nightly 36654497639 3 h 28 min to 50.5 minutes. Import cut 22.9 percent (lazy locale slices, lazy daily catalogs); 465 screenshots and 85 capture scripts pruned; the balance probes culled (lane pool 88.6 percent down); the nightly sharded two ways; three slimming rounds over about 1,000 suites, each change with a mutant; the shard weight pool 49 percent down over three harvests; about 50 tests that claimed a guard they did not hold, fixed. A total-CI-time ratchet and a new-test admission rule. Three workers per shard reverted. Fresh reads round by round until a round came back without a should-fix; the armed gate green on all 12 steps at `f401981a04` (74,020 tests, browser 550). OWED: confirm the lane ratchet band, the collider grid lever, the product questions the tests surfaced, the release-gate re-derivation. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), PART 5, and `qa/test-cost-2026-09-29/`. |
| Part 5 follow-up, the owed decisions | **Done**, pushed, 2026-09-30 | 2026-09-30 | 2026-09-30 | Delegated ("do whats best for the project and feature"). Runner-calibrated harvests adopted after five calibrated CI runs (pool spreads: shard 1.249 raw to 1.069, lane 1.384 to 1.064); reference 178 ms; the lane back on the shared band; ceilings re-based. Per-file packing overhead added (no gain today; runner speed drives the spread). Collider grid lever: measured no-go. RL env per-seed caches released (heap flat over 50 new seeds, was about 3 MB each). Fleetmend refuses at no cost with nothing to consume; dead stealth module deleted; two comments corrected. Groveheart capstones pinned by mechanic; demonology end-pool kept as a design constant. The browser jobs' font fallback race fixed. Detail: `qa/test-cost-2026-09-29/decisions-2026-09-30.md`. |
| 07a Transactional mutations and global claim fencing | **Built**, pushed, 2026-10-01 | 2026-09-30 | 2026-10-01 | Fernando ruled both Step 0 questions as recommended ("Light it (Recommended)", "Push after the gate (Recommended)"). Sync `0008427d14` (release/v0.45.0 at `55de7ffe92`). The manifest first (revision 5); built test-first: the global plot claim with its fencing generation, the fenced write, the claimed login read, the renewer, the mutation hook and its verify, the lit Hearth trip, operations with D88 guards; the parity golden byte-identical. Seven domain reviewers and the qa-checklist, then forty-three fix rounds each read fresh until clean (rounds 17 to 43 tightened one guard above all, the renewer's call-site and alias pin, to a stated boundary with whole pins, and fixed what the armed full suite and gate then found); 212 mutants over the new guards, 211 killed and one equivalent; the armed gate green on all 12 steps at `4fddff13f0` (74,463 tests, browser 550). Detail: the ledger's 07a section and `qa/mutation-2026-09-30/`. NEXT: `phase-07a-qa.md` in a fresh session. |
| 07a QA | **PASS**, local, awaiting push go | 2026-10-01 | 2026-10-02 | Sixty review rounds over the 07a implementation `0008427d14..11316ac3cd` and every fix since, each read by fresh readers (twelve in round one, eight after), until round sixty came back with no blocking and no should-fix finding: 2,191 findings in all, 27 of them blocking (the last in round twenty-nine), every finding of rounds one to fifty-nine disposed in [the record](qa/mutation-2026-09-30/qa-findings.md) (fixed with its commit, or ruled, flagged or owed with its reason) and round sixty's eleven optional suggestions owed. Where a guard kept drawing one more form, the loop switched to a whole pin or a stated boundary: section L read whole by digest, the bot's bundle read by esbuild's own module list with its packages held to ws by path, and every dependency spec that is not a plain range pinned as written. Mutants on each round's new guards, each killed and restored. Final runs at `a0a96b047c`: `npx tsc --noEmit` exit 0; the STEP 3 named list armed, 986 tests, 983 passed, 3 release-tier skips, `freehold_mutation.pg` 53 and `freehold_claim.pg` 25 executed; every `*.pg*` file armed against userspace PostgreSQL 16.14 (no Docker on this host), 643 on 55433 plus the growth monitor's 6 on 55432, never a skip; `npm run ci:changed` exit 0; `node scripts/gate_select.mjs` armed, exit 0, all 12 steps green in full mode: 74,634 tests passed, 2 expected fail and 29 skipped in 5,086 files, the browser suite 550 in 67, the malware scan 0 high. Owed and unclaimed (the ledger's OWED lists each): R-1 to R-9, the first-kind tripwires, the quiet-window rollout, the `.npmrc` pin (a maintainer decision), the bot's SIGTERM (L37R4), an override keyed to an alias's name (S60R1), the stale owner comments. Nothing pushed: `origin/feature/freeholds` stays at `dca9711ab6`. Production stays disabled behind `FREEHOLDS_ENABLED`; every release gate stays unsigned. Detail: [the ledger](qa/persistence-2026-09-08/findings.md), 07a QA. NEXT, after the push go: `phase-07b-account-lifecycle.md`. |
| 07b Account lifecycle and protection history | Not started | | | |
| 07b QA | Not started | | | |
| 07c Account first-tier arrival eligibility | Not started | | | |
| 07c QA | Not started | | | |
| 08 Layout core and placement commands | Not started | | | |
| 08 QA | Not started | | | |
| 08a Public descriptors and consumer-correct wire state | Not started | | | |
| 08a QA | Not started | | | |
| 09 Render: furnishing view, light rig, ghost | Not started | | | |
| 09 QA | Not started | | | |
| 10 Furnishing colliders | Not started | | | |
| 10 QA | Not started | | | |
| 11 Build mode UI | Not started | | | |
| 11 QA | Not started | | | |
| 12 Strongbox and station amenities | Not started | | | |
| 12 QA | Not started | | | |
| 13 Condition and the Steward's Ledger core | Not started | | | |
| 13 QA | Not started | | | |
| 13a Authoritative upkeep calendar | Not started | | | |
| 13a QA | Not started | | | |
| 14 Distribution surface map | Not started | | | |
| 14 QA | Not started | | | |
| 15 Claudium: the Freehold Charter and the Master Builder's Call | Not started | | | |
| 15 QA | Not started | | | |
| 16 Steward panel and store surfaces | Not started | | | |
| 16 QA | Not started | | | |
| 17 Trophies | Not started | | | |
| 17 QA | Not started | | | |
| 18 Visiting | Not started | | | |
| 18 QA | Not started | | | |
| 19 Art batch | Not started | | | |
| 19 QA | Not started | | | |
| 20 Wave A close | Not started | | | |
| 20 QA | Not started | | | |
| 21 Lodge tier and the upgrade build project | Not started | | | |
| 21 QA | Not started | | | |
| 22 Furnishings across all ten crafts and the R8 pattern channels | Not started | | | |
| 22 QA | Not started | | | |
| 23 Legend Stand and the remaining trophy families | Not started | | | |
| 23 QA | Not started | | | |
| 24 Kitchen Garden tableau | Not started | | | |
| 24 QA | Not started | | | |
| 25 Advanced placement and build mode | Not started | | | |
| 25 QA | Not started | | | |
| 25a Twelve-week prepay and the Fenbridge gate | Not started | | | |
| 25a QA | Not started | | | |
| 26 Open-house visiting | Not started | | | |
| 26 QA | Not started | | | |
| 27 Wave B close | Not started | | | |
| 27 QA | Not started | | | |
| 28 The guild owner kind, the Meeting Hall, the Hall Fund | Not started | | | |
| 28 QA | Not started | | | |
| 28a Guild lifecycle and membership evidence | Not started | | | |
| 28a QA | Not started | | | |
| 29 Guildhall purchase and upkeep | Not started | | | |
| 29 QA | Not started | | | |
| 30 Guild chest, feast table and shared stations | Not started | | | |
| 30 QA | Not started | | | |
| 30a Hall boards | Not started | | | |
| 30a QA | Not started | | | |
| 31 Guild-level deeds and first-kill trophies | Not started | | | |
| 31 QA | Not started | | | |
| 32 Great Hall, Manor, Bastion tiers and build projects | Not started | | | |
| 32 QA | Not started | | | |
| 32a Project rewards and direct vault access | Not started | | | |
| 32a QA | Not started | | | |
| 33 Wave C close | Not started | | | |
| 33 QA | Not started | | | |
| 34 Wards: shared neighborhoods and exteriors | Not started | | | |
| 34 QA | Not started | | | |
| 35 Ward favor and Endeavors | Not started | | | |
| 35 QA | Not started | | | |
| 36 Showcases and guest books | Not started | | | |
| 36 QA | Not started | | | |
| 37 On-chain Freehold Charter: service contract, ledger table, geo-exclusion | Not started | | | |
| 37 QA | Not started | | | |
| 38 Charter mint surface and marketplace trading (web only) | Not started | | | |
| 38 QA | Not started | | | |
| 39 Wave D close | Not started | | | |
| 39 QA | Not started | | | |
| 40 Keep and Citadel tiers, prestige deeds | Not started | | | |
| 40 QA | Not started | | | |
| 41 Dye station | Not started | | | |
| 41 QA | Not started | | | |
| 41a Layout saves and public sharing | Not started | | | |
| 41a QA | Not started | | | |
| 42 Second freehold admission and shared Hearth cooldown | Not started | | | |
| 42 QA | Not started | | | |
| 43 Existing-craft coverage and future expansion handoff | Not started | | | |
| 43 QA | Not started | | | |
| 44 Wave E integration close before final artwork and legal handoff | Not started | | | |
| 44 QA | Not started | | | |
| 44a Final Codex artwork | Not started | | | |
| 44a QA | Not started | | | |
| 44b Final Terms and legal-team handoff against completed implementation | Not started | | | |
| 44b QA | Not started | | | |

## Per-phase deliverables and acceptance (the spec each phase file expands)

These summaries preserve each implementation file's five-or-fewer coherent outputs: the
numbered lines are the phase file's own deliverable titles (or its one-line deliverable
sentences) in order (07, 07a, 07b, 07c, 08 and 08a keep one-line summaries of their
paragraph-length items, one per output in the same position), and a note under a list
names outputs a decision or review folded into an existing deliverable. The linked
implementation and QA carry the exact modules, tests, input/UX states and runtime
acceptance; state.md owns decisions and numbers, and ux-spec owns presentation. This index
does not add a sixth deliverable or silently substitute a summary for the full file. Every
implementation must complete its entire scoped acceptance and shared gate; every QA
applies all findings and has a fresh reviewer verify the fix round.

For each row, record actual commit range, commands/exit codes, executed and skipped
checks, evidence paths and reviewer verdicts. Unsigned external artifacts retain their
named release gate; a row carries named unsigned release gates, never a deferral record.
A future measured/calibrated value requires the workbook's source, owner and approval
evidence before activation, never an inferred TUNING literal.

### Wave A: Cottage MVP

#### 01 Foundation

Implementation: [phase-01-foundation.md](phase-01-foundation.md). Paired audit: [phase-01-qa.md](phase-01-qa.md).

Deliverables (at most five):

1. The complete housing facet, command registry and null mirrors on both hosts.
2. The SimContext-backed subsystem and its live-view/extraction pins.
3. The authenticated status scaffold, both error catalogs, the freeholdsEnabled boot
   config and dark command dispatch.
4. The unchanged RL action-space exclusion and decisive parity/negative tests.

Facet member list (the parity reference): data myFreehold and freeholdLayout (null until
05 and 08a); method housingNowMs(); dark no-op methods freeholdEnter, freeholdLeave,
placeFurnishing, moveFurnishing, removeFurnishing, undoPlacement, redoPlacement,
payLedger, setVisitPolicy, setFreeholdBuildPresence. Later appends: 12 appends
buildStation and myAmenities, 17 appends placeTrophy and clearPlinth, 18 appends
freeholdVisitors, 21 appends contributeUpgrade and finishUpgrade, 30a appends
guildHallBoards, 34 appends myWard and moveWard, 42 appends myFreeholds; every other later
member is named in its own phase file with the parity pin updated in that same change.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-01-qa.md: [phase-02-furnishing-item-kind.md](phase-02-furnishing-item-kind.md).

Status notes (2026-09-06, implemented locally, branch not pushed): all four deliverables
landed with zero player-visible behavior. Evidence: `npx tsc --noEmit` clean; the STEP 3
suites plus the extraction and fix-round suites (47 files, 1959 tests) green; biome clean
on the 51 changed files; the four monolith ceilings LOWERED to the exact new counts
(sim.ts 11983, game.ts 10301, online.ts 5708, main.ts 11384) after four verbatim
extractions (moveToward, liveLocationFor, blankEntity, updateSeoMetadata). Review round:
six reviewers, 0 blocking, every should-fix and nit applied (jailed row for
freehold_enter, a dedicated tier-1-only read limiter on the status route, boot-snapshot wording, opaque-id
bounds, the sender-to-server drift guard, the decode-walk seam, the same-seed lit/dark arm,
the events-drained arm, the direct ctx.moveToward binding), then a fresh two-reviewer read of
the fix round (5 should-fix, 8 nits, all applied: the dedicated HOUSING_READ_POLICY, the
opaque-id chain arms, the anomaly-observer pin, the narrowed firewall allowlist). The locked engineering decisions are in state.md "Gotchas" (a) to (j). Named
unsigned gates: the "Runtime safety and distribution" row in state.md "Tracked release
and handoff gates" stays unsigned (01 supplied the strict live FREEHOLDS_ENABLED gate and
its dark route/command/catalog proof; the forbidden-submodel absence and the management
flow approval remain open); the four other gate rows are untouched by 01. Deferred to the
release fill: the housing term family (Freehold, Steward's Ledger, Hearth Key) joins
`scripts/i18n_glossary.json` when the UI keys land. The `housingSystem` category landed in the
01 QA instead, locking the five coined non-Latin renderings before a later surface could
re-coin one, with a drift guard in `tests/i18n_completeness.test.ts`; only the
`hudChrome.housing.` keyPattern waits for the first HUD key, because the completeness guard
requires every shipped pattern to match a live key.

QA round (2026-09-06, verdict PASS, still local). Twelve auditors and reviewers. The one
blocking find was introduced BY the QA fix round, not by 01: a glossary keyPattern registered
ahead of its keys reddened `tests/i18n_completeness.test.ts`, caught independently by
cross-platform-sync and qa-checklist and fixed in `14fcb59abe`. Worth carrying forward: a
scoped 43-file run reported green while that suite was red, because it reads the glossary
through `fs`, outside the module graph, so `vitest related` can never select it; the
always-run floor is what catches that class. Substantive QA changes beyond comment and doc
repairs: `FreeholdPlotId` is branded so `plotId: state.ownerKey` is a compile error rather
than prose; `serializeFreehold` neutralizes the ephemeral `isDecorating` at the persistence
boundary; the two descriptors became real module delegates; the two extracted modules
`server/live_location.ts` and `src/net/blank_entity.ts` gained the suites they shipped
without; and several pins that could not fail were replaced (only `friends` reached the
visit-policy guard, the RL exclusion derived its forbidden list from the module it guarded,
and deleting the decode call site, the delegates or the seo call was invisible). Evidence:
`npx tsc --noEmit` clean; 92 files / 2319 tests green including `tests/parity` and every i18n
suite; `npm run ci:changed` exit 0; `npm run build` exit 0 with no generated-artifact drift;
the four monolith ceilings still equal their files exactly. Not run locally: `test:browser`,
the malware scan and SFX conformance, which ride CI once the branch is pushed.

#### 02 Furnishing item kind

Implementation: [phase-02-furnishing-item-kind.md](phase-02-furnishing-item-kind.md). Paired audit: [phase-02-qa.md](phase-02-qa.md).

Deliverables (at most five):

1. Narrow furnishing type plus complete refusal/storability/economy consumer census.
2. Kind presentation, the market filter, All-only ordinary bags and the icon fallback.
3. The registered tooltip core, English housing keys and decisive consumer fixtures.

Regenerated `ux-key-manifest.json` from the approved UX tables. The result is byte-identical:
all four owner-02 rows were already present in the 557-key approved inventory, so no cited
count changes (D92).

Status notes (2026-09-06, implemented locally, branch not pushed): `FurnishingItemDef`
adds the narrow `furnishing` kind, required collision radius and floor-only placement
metadata, with inherited power and use fields prohibited. The synthetic fixture drives
explicit refusal, crafting, storage, transfer, presentation and browse behavior. No
furnishing content ID or asset is shipped. `KIND_RANK` places furnishing at 11, after tool
at 10 and before mount at 12, preserving every existing kind's relative order. Ordinary
bag categories are unchanged and furnishing remains reachable through All only.

The housing tooltip core returns approved keys and resolved values; the maker line reads
only `ItemInstancePayload.signer`. Extracting the mount tooltip lowered the `hud.ts`
ceiling from 18716 to 18703. The complete new English leaf inventory is:

| Key | English |
|---|---|
| `itemUi.kind.furnishing` | Furnishing |
| `itemUi.market.filterTypeFurnishing` | Furnishings |
| `hudChrome.housing.furnishing.footprint` | Footprint: {width} by {depth} cells. |
| `hudChrome.housing.furnishing.decorCost` | Decor cost: {cost}. |
| `hudChrome.housing.furnishing.surfaceFloor` | Placed on the floor. |
| `hudChrome.housing.furnishing.maker` | Made by {maker}. |

Original implementation completion evidence:
- Scoped validation: PASS; typecheck exit 0, 447 scoped tests, 253 neighboring tests,
  and 76 localization tests passed (3 existing release-tier skips). Exact commands and
  evidence are in [furnishing-item-kind-validation.md](furnishing-item-kind-validation.md).
- Required COVERAGE reviews: cross-platform-sync, architecture-reviewer,
  frontend-seam-reviewer, test-coverage-auditor and qa-checklist completed. Every code,
  test and documentation finding/nit is addressed; the final browser probes passed.
  Reports and closure evidence are linked from furnishing-item-kind-validation.md.
- Fresh review of the entire fix round: [PASS](reviews/furnishing-item-kind/fresh-fix.md);
  all original findings and nits resolved, including the complete browser evidence.
- `node scripts/gate_select.mjs`: PASS, exit 0, all 12 steps green; full-suite fallback
  passed 54864 tests plus 343 browser regressions, typechecks, builds and security checks.
- Three scoped commits: item gates `83f847e6cb`, UI `b98007b01e`, and the final synthetic
  consumer test/evidence commit. `npm run ci:changed` after the last commit: PASS, exit 0.
  The final evidence amendment is followed by the same post-commit check.
- The paired audit has since run; its current record follows.

QA verdict PASS (2026-09-07, source sealed locally, branch not pushed): 40 distinct
findings were found and all 40 have independently reviewed repairs and evidence. The
fresh reviewer read all 110 changed files across `ce0e25ec85`, `ff738f61a1`,
`a82e71f4cd` and `d386635394`, with source PASS and zero open source/test findings.
The required cross-platform, architecture, frontend and coverage reports are
archived with the [QA validation record](furnishing-item-kind-qa-validation.md).
The complete consumer census has 353 classified sites, 92 touched, 261 untouched
by design and zero MISSED. The coverage report maps 47 acceptance claims to
decisive checks that ran.

The fixes also cover loaded and forged power metadata, real host routes, custody
restart, complete tooltips, Exchange and WorldMarket identity, discovery, Rift,
feast, worn presentation and regalia caching. The final route matrix passed 24
tests, the resumed required matrix passed 764 tests, and the serial PostgreSQL
differential matrix passed all 11 tests without skips. Both late browser commands
passed with native mouse/touch evidence for all eight surfaces in two viewports.
The owning provenance remint and its 30-test integrity matrix passed without
generating an asset or changing frozen screenshot pixels.

The four approved housing keys and two labels above are unchanged. The sole
additional English leaf is generic custody text,
`hudChrome.itemTooltip.partyTradeWindowCustody`; its exception requires both the
exact key and generated pending status. No locale overlay changed in the
furnishing implementation or QA repair ranges. The final shared gate completed
with exit 0 and all 12 steps green: 3,868 Vitest files and 58,083 tests passed,
plus all 42 browser files and 373 tests. The two expected failures, 28 skipped
tests and one skipped file are disclosed in the validation record, with separate
serial proof for all 11 differential cases. Standalone i18n generation, its
immediate status, explicit output-root freshness and repeated source seal passed.
Fresh review of the final verdict substitutions and the finishing checklist both
returned PASS, with zero open findings. The actual post-commit check at verdict
commit `c881543258` passed with exit 0 and clean status. The earlier one-error
JSON formatting result remains archived as a failure; its whitespace-only repair
was reviewed within Q37. Fresh and checklist review of this evidence-only amendment passed; the
coordinator repeats the same check after the true last commit, reporting
the actual exit without another repository edit.

Named unsigned release gates remain economy catalog/authorization/settlement; counsel,
Terms and storefront model; optional deed territories and irreversible authority;
approved numerical rows; source calendar/lifecycle/rollout capability; final asset and
image replacement evidence; and runtime safety/distribution. Their owners and acceptance
artifacts remain in `state.md` under Tracked release and handoff gates. This implementation
does not sign or activate them.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-02-qa.md: [phase-03-content-tiers-and-basics.md](phase-03-content-tiers-and-basics.md).

#### 03 Content: tiers, Charter SKU, ledger schedule, vendor basics

Implementation: [phase-03-content-tiers-and-basics.md](phase-03-content-tiers-and-basics.md). Paired audit: [phase-03-qa.md](phase-03-qa.md).

Deliverables (at most five):

1. Deep-frozen Inn Room/Cottage tiers and the price-free Charter allowlist.
2. The versioned realm-week eligible-ID schedule and exact calibration worksheet rows.
3. Exactly eight vendor furnishings and the furnisher, with all same-change content art,
   naming, wiki, provenance and originality obligations per shipped ID.
4. The Homesteader opener and the NEW Hearth shelf across its complete consumer census.
5. Literal content/firewall/economy/source-freeze tests and the approved manifest
   evidence.

03 accepted development implementation, 2026-09-07:

The [accepted trial](content-trial-2026-09-07/acceptance.md) supplies the complete
measured development basis; [revalidation](content-trial-2026-09-07/revalidation.md)
repeats the actual producers with identical accepted values. The twelve-bill
`freehold-ledger-tuning-v1` cycle uses produce plus two rotating eligible families.
All eight common furnishings cost 250/60 copper and retain their measured
stand-in footprints, radii and decor costs. `freehold_furnisher` has exactly that
stock and spawns only on enabled hosts; its addition preserves existing terrain,
NPC ordering and RNG. Real purchases, custody, discovery and current dark-host
reload are covered. `hearth_basics` contains all eight ordinary item relics;
catalog pins at 03 completion were 42 pages, 474 raw slots, 438 full-completion slots and
409 character-completion slots. Homesteader deeds remain manual and cosmetic.

Implementation and paired QA PASS. The [current validation record](content-final-validation-2026-09-07.md)
contains exact commands, all reviews, inspected capture manifests and the four
completion commit groups. Source commits are `a6bf26fad9`, `9121f0d94f` and
`e1be875782`, followed by the final evidence closeout. Original
accepted artifacts remain immutable. CAL-LEDGER-A, CAL-VENDOR-A, CAL-DECOR-A/B
and MEASURE-SPACE still require their named final production/room/asset/LOW
acceptance; the development decision does not replace those gates. The exact
Freehold Furnisher greeting voice is required before shipping, per Fernando's
explicit deferral. Compatible fleet-wide catalogs and a pre-enable backup remain
required before furnishing acquisition is activated in production.

<details>
<summary>Historical partial checkpoint before development trial acceptance</summary>

03 implementation checkpoint, 2026-09-07, PARTIAL/BLOCKED:

- `src/sim/content/freehold/{tiers.ts,charters.ts,ledger_schedule.ts,index.ts}` and
  local `CLAUDE.md` publish the frozen approved Inn Room/Cottage targets, price-free
  `freehold_charter_cottage`, and eighteen eligible material alternatives. The
  `FREEHOLD_LEDGER_SCHEDULE` record is explicitly
  `{ status: 'pending_approval', calibrationId: 'CAL-LEDGER-A', schedule: null }`.
  Eligibility is not a complete realm-week schedule; no operational units, cycle,
  selected bill rows or invented trial numbers were added. Literal and protected-input
  coverage lives in `tests/freehold_content.test.ts` and the extended
  `tests/provisioner_firewall.test.ts`.
- `homesteader_first_furnishing` and `homesteader_first_cottage` append at the actual
  tail of `DEEDS`/`DEED_ORDER`. Both are manual progression deeds with 5 renown under
  the existing routine-milestone rule. Homesteader grants the Homesteader title;
  Householder grants the `householder` border with a shared rendered home motif.
  English copy and five non-Latin name/description/title fills are authored. No
  raise site is added: first placement and confirmed Cottage grant still own them
  in 08 and 15. Both painted deed crests were produced locally with Codex and the
  canonical converter; [accepted-art evidence](content-art-2026-09-07/deeds.accepted-art.json)
  records their provenance. These are deed assets, not new furnishing item IDs.
- Hearth is declared across the shelf type, navigation/order/labels, guide generator
  and consumer census, with `hudChrome.reliquary.navHearth` and
  `guide.reliquaryPage.shelf.hearth`, five non-Latin fills and glossary coverage.
  Empty shelves remain hidden; opening empty Hearth returns to Overview.
  No Hearth page is published: `hearth_basics` remains deferred until its eight
  real item definitions and vendor source resolve. There is no new global page cap.
  Homesteader instead joins the existing `horizons_titles` page through the normal
  title/deed-source path. Current measured Reliquary pins are 466 raw slots,
  430 full-completion slots and 401 character-completion slots across 41 unchanged
  pages; `tests/reliquary_content.test.ts` owns these pins.
- Eight furnishing icon candidates are prepared in ignored staging, with
  [staged-art provenance](content-art-2026-09-07/staged-art.json) and a
  [size-review sheet](content-art-2026-09-07/size-review.webp). They are not registered
  shipping item art. No furnishing was added to `ITEMS`, no furnisher to `NPCS` or
  world spawns, and no stock, world-entity name or item-name locale row was added.
  The exact eight planned IDs and every missing numeric field are recorded in the
  [source freeze](content-source-freeze-2026-09-07.md); planned IDs are not shipped IDs.
- Wiki and i18n outputs are regenerated by the coordinator. Typecheck and all
  requested scoped suites pass, including 666 tests in the exact twelve-file command.
  Six required COVERAGE reviews, instruction/art safety and pre/final database
  growth reviews returned; repairable findings are addressed. Visual evidence is retained and accepted, and the shared gate passed all 12 steps.
  Fresh whole-fix review passed with no open findings or nits; all evidence is in the
  [validation record](content-validation-2026-09-07.md). The user subsequently
  authorized incremental commits of completed work: `1d583786f6` holds gate
  import-order repairs, `add3b7b2d9` the approved tables and `93710767dd` the deeds,
  Hearth consumers and their same-change obligations. This documentation
  checkpoint retains the reviewed evidence and
  [completion checklist](content-completion-checklist-2026-09-07.md). The final
  post-commit `npm run ci:changed` result is reported in task completion. No push.

Named production blockers remain explicit:

| Gate | Producer and owner | Missing evidence before activation |
|---|---|---|
| CAL-LEDGER-A | 03 CONTENT with 13 UPKEEP and 20 ECONOMY QA; Fernando/economy service approve | Exact selected week/tier lines and units, cycle/version, allocation/valuation/tolerance, rounding, all-cycle fixtures, immutable prepay and measured four-week report; the later twelve-week extension also requires the signed version and calendar-authority acceptance |
| CAL-VENDOR-A | 03 CONTENT; Fernando approves | All eight buy/sell copper values and qualities, comparator/acquisition-burden derivation and economy fixtures |
| CAL-DECOR-A/B | CONTENT with ART; Fernando approves | Positive integer decor costs, measured shipping model/render costs and maximum legal layout LOW evidence |
| MEASURE-SPACE | ART/CORE room and model producers | Approved model/room transforms, grid, footprints, solid radii, clearance and legal-placement fixtures; the rug's explicit `r: 0` alone cannot complete its item definition |

The source-freeze artifact links the actual approval proof for existing tier targets,
source hashes, numeric readiness rows and concrete producers. Image generation does
not authorize any missing number. Continue now by producing the admissible measured
trial packet and mapped stand-in evidence in
[the completion checklist](content-completion-checklist-2026-09-07.md), then finish
the missing content and its acceptance proofs. The table above lists production
activation gates; final signatures and later calibration reports alone do not
prevent 03 QA PASS. Keep 03 QA uncompleted until its actual content criteria pass.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
</details>

After phase-03-qa.md: [phase-04-content-crafted-and-patterns.md](phase-04-content-crafted-and-patterns.md).

#### 04 Content: crafted furnishings and quartermaster patterns

Implementation: [phase-04-content-crafted-and-patterns.md](phase-04-content-crafted-and-patterns.md). Paired audit: [phase-04-qa.md](phase-04-qa.md).

Reconciled paired QA closeout, 2026-09-07: **PASS, local**. Four findings
were found and resolved: three source/test findings and one documentation nit.
The three source/test findings were resolved across `0932963250..69ffdab561`, in commits
`d5ea0825d1` and `69ffdab561` (five files): HN1 restores content-barrel
exports and all consumer imports, including the recipe catalog; COV-1 proves
complete knowledge and possession preservation on dark refusals; PER-1 proves the actual ten furnishings and three unused
patterns survive lit, dark, and relit JSON save round trips. No finding or nit
remains deferred. The [fresh entire-fix review](crafted-qa-reconciled-2026-09-07/reviews/fresh-fix.md)
independently inspected all current changes and the six historical repair commits
and returned PASS with zero additional findings. Its supplement supersedes the
earlier incomplete HN1 closure after simulation-architecture review found the
remaining recipe-catalog import. The repaired import and full consumer census
received fresh review and simulation-architecture PASS. This was another
occurrence of HN1, not a distinct finding.

DOC-1 corrects the current validation and copied context summaries to match the
retained calibration receipt: ten rows with five Boolean checks each means 50
checks, not 60. This is an evidence wording repair, not a change to calibration,
source behavior, or the two source repair commits. The
[final documentation review](crafted-qa-reconciled-2026-09-07/reviews/docs-final.md)
records the finding and its correction. The earlier source-review reports retain
their accurate three-source-finding chronology.

The active user request protects `evaluateCraftAdmission`, `resolveTrain` and
existing station, training, and economy semantics. The full declarations remain
byte-identical from `86eb86bbe2^` through `69ffdab561`; the explicit scope closes
historical F01 prospectively. It does not rewrite the earlier 29-found/28-repaired
FAIL, approve new numbers, or authorize production activation. The unchanged
historical receipt below remains evidence of that earlier audit.

The final shared gate at `69ffdab561` exited 0 with all twelve steps green.
Unit results: 4028 files passed and one CI-presence sentinel file skipped (4029
files total); 60610 tests passed, two expected failures and 28 explained skips
(60640 cases total), in 1496.46 seconds. Chromium passed all 47 files and 389 tests.
The separate PostgreSQL 16 invocation passed 57 tests, including the five SQL
differential cases deliberately not armed in the full invocation. The other 23
skips are disclosed existing optional or historical cases; no furnishing
acceptance case was skipped. The [skip disclosure](crafted-qa-reconciled-2026-09-07/reviews/skip-disclosure.md)
and [validation](crafted-qa-reconciled-2026-09-07/validation.md) retain the exact
commands and limits. Typechecks, builds, security, SFX and generated freshness
passed. The audit database was stopped; the unrelated screenshot emitted by a
shared browser test was preserved in scratch and restored to its pre-gate bytes.
No product source changed after this passing source gate.
Current exact commands, scoped checks, mutation controls, PostgreSQL evidence,
generated freshness and limits are in [validation](crafted-qa-reconciled-2026-09-07/validation.md).
[Findings](crafted-qa-reconciled-2026-09-07/findings.md) records all four closures
and the required reviewers. The post-last-commit `npm run ci:changed` remains the
coordinator's final execution step; its actual commit and outcome belong to the
final task handoff and execution receipt, not a pre-certified PASS here.

Original content commits, accepted calibration, and final item icons are reused.
No asset was generated in this QA. Production numeric signatures, final GLBs,
room/arrival/navigation and hardware LOW evidence retain their existing owners.
The next implementation task is
`/Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds/docs/freeholds/phase-05-instance-claim.md`;
it has not started. The branch remains local.

Development implementation completion notes, 2026-09-07 (original snapshot at `3666d89647`, before the separate 04 QA audit):

- Fernando accepted development v1 in
  [acceptance.md](crafted-content-trial-2026-09-07/acceptance.md), exact SHA-256
  `c211e11ae3289fc5ae8745f27c13c3253164dcf9188641fbcbf3c150fa479e2b`.
  [The workbook](content-numbers-workbook.md) records signed development
  CAL-RECIPES-A, CAL-PATTERNS-A and CAL-FURN-A; production remains unsigned/disabled.
- Ten recipes, one per existing craft, use skill 50, budget 20, level 15, one rare
  furnishing output and 40 copper craft fee. Seven are trainer recipes with the
  unchanged 1-gold unlock; three are taught by the 16-Mark quartermaster patterns.
  The complete material, resale and geometry inventory is in the accepted artifact.
  Seven crafts use `STATION_TYPE_BY_CRAFT`; the existing explicit legacy bindings
  are inscription/apothecary, jewelcrafting/forge and enchanting/toolworks. No
  new station or change to the existing admission/training predicates is implied.
- `hearth_first_crafts` appends ten ordinary item relics after `hearth_basics`.
  Hearth inventory is exactly those two pages; none of the three patterns is a
  relic. Verified catalog pins: 43 pages, 484 raw
  slots, 337 unique item IDs, 448 full-completion and 419 character-completion slots.
  Preserve the merged Crucible family: 55 teaching items comprise 54 recipe
  manuals teaching 76 drop recipes plus one enchant teaching item. The
  non-Crucible subset has 43 teaching items; furnishing is the seventh recipe family.
- English names cover thirteen item IDs. The five required non-Latin fills are
  authored in `zh_CN`, `zh_TW`, `ja_JP`, `ko_KR` and `ru_RU`; the page has matching
  Reliquary full descriptions. The page name is now present in all eighteen base
  Reliquary locale tables, including the thirteen repaired Latin-script rows.
  The exact changed guide keys are
  `guide.reliquaryPage.catalogBody` and
  `guide.profPages.craftProse.armorcrafting.ladderBody`, both with English sources
  and the five M16 fills.
  Thirteen final icons/provenance and the 42-capture runtime set are accepted in
  `crafted-content-art-2026-09-07/items.accepted-art.json::review.runtime`.
  The runtime manifest at
  `docs/screenshots/freehold-crafted-content-2026-09-07/runtime/manifest.json`
  has SHA-256 `09ab384da4112f60b75cf8ebff986451dad6fda709fef158dda160713c653832`
  and 143845 bytes: sixteen desktop, twenty-two mobile, two guide catalog and two
  catalog-prose captures. Six locales and actual 48-Mark-to-zero purchases on
  desktop/mobile are verified, with zero page errors/unloaded images. Evidence
  uses software browser emulation; hardware LOW, placement and final GLBs remain
  outside this acceptance.
- Shared gate command:
  `GATE_SELECT_BASE=49ed3f09333f4f1293edda9a98fe590c5651c20e node scripts/gate_select.mjs`.
  Exit 0, all twelve steps green: unit suites 3860 files passed / 34 skipped,
  57858 tests passed / 2 expected failures / 541 existing conditional skips;
  browser suites 43 files / 376 tests passed. Typechecks, environment/server/bot/
  client builds, generated freshness, security and SFX checks passed.
  The exact command/results and final reviewer closure belong to
  [implementation-validation.md](crafted-content-trial-2026-09-07/implementation-validation.md);
  execution log: `/tmp/freeholds-crafted-gate-final.log`. Finished database
  performance and persistence reviews PASS. Required QA/fresh-review reports
  under `crafted-content-trial-2026-09-07/reviews/implementation-*.md` are refreshed
  for this final evidence; earlier interim statuses are historical snapshots.
- The four original completion commits are `86eb86bbe2`, `8bd097d898`,
  `b3c2452b49` and `3666d89647`. After the fourth,
  `npm run ci:changed` passed with exit 0, 1967 files checked and existing warnings
  only; working-tree status was clean. This receipt is incorporated by amending
  only the fourth documentation commit, preserving four commits. The parent
  repeats `npm run ci:changed` after the actual final amended commit and records
  that result in the final handoff. No push. At that implementation handoff,
  paired 04 QA had not started. Its later FAIL verdict and unresolved F01 are
  recorded in the closeout below; implementation 05 has not started.
- Final crafted GLBs and remeasurement (`scripts/assets/freehold_crafted/`,
  `export_freehold_crafted.mjs`, `freehold_crafted.json`,
  `tests/freehold_crafted_asset.test.ts`), legal maximum room layouts,
  arrival/navigation and actual LOW performance remain named production gates.


Historical paired 04 QA closeout, 2026-09-07: **FAIL, local**.
The following receipt describes that completed historical audit. The reconciled
paired closeout above owns the current status and next step.

- The audit covers original implementation `49ed3f0933..3666d89647`, dependency
  head `54ce808436` integrated by `2e24ba8818`, and dedicated repair commits
  `ea3b62fad1`, `47655ffb54`, `1be1aef461`, `85f99f6a32`, `5f4821bec7` and
  `b379ee462d`. The final verified source is `b379ee462d`.
- There are 29 distinct findings: 28 repairs applied and independently accepted,
  with F01 open. The original implementation changed four paths under
  `src/sim/professions/` to enforce D85 availability and extract the trainer
  boundary. The explicit QA requirement permits no changes there. Preserved
  station/tier/training-fee behavior does not satisfy that raw path freeze.
  Fernando has not supplied the requested reconciliation; no silence-based waiver
  or PASS is recorded.
- The final repaired source and merge evidence received the distinct full
  qa-checklist/whole-fix review in
  [qa-checklist-final.md](crafted-qa-2026-09-07/reviews/qa-checklist-final.md).
  That review covers all 80 files in `2e24ba8818..b379ee462d` plus merge evidence,
  including touch feedback, locale seeds and all five later gate-repair findings.
  This is a new whole-fix review, distinct from the earlier database-only assessment.
  All F02 through F29 repairs are accepted; the technical review does not override F01.
- Shared gate attempt 3 at `b379ee462d` exited 0 with all 12 steps green. It ran
  all 4,028 unit files: 60,594 tests passed, two expected failures, 27 existing
  case skips and no skipped suite (935.59 seconds). Shared Chromium passed
  46 files / 385 tests (11.87 seconds). Typechecks, environment/server/bot/client
  builds, security, SFX, changed-file checks and artifact generation/freshness
  passed. Earlier failed gate attempts remain failed evidence.
- Explicit `npm run wiki:content` and `npm run i18n:gen` both exited 0 after the
  final gate, and the generated-source diff was clean. The final combined
  guide/manual presentation sequence captured all 11 frames and exited 0;
  independent frontend review accepted it within its stated browser-emulation
  scope. This is distinct from the original 42-capture implementation record.
  Exact shared/scoped/PostgreSQL/browser/visual results belong to
  [validation.md](crafted-qa-2026-09-07/validation.md).
- The ten-recipe, three-pattern and thirteen-item obligation tables are in
  [content-evidence.md](crafted-qa-2026-09-07/content-evidence.md).
  [findings.md](crafted-qa-2026-09-07/findings.md) retains every repair and
  adjudication, including actual mutation controls and preserved timing-measurement
  provenance. This QA generated no asset.
- `GATE_SELECT_BASE=54ce808436 npm run ci:changed` exited 0 after the last source
  commit `b379ee462d`. The coordinator must replay that exact command after the
  separate verdict/evidence commit as the actual final execution step. That replay
  has not yet run and is not claimed by the source check or this ledger update.
- No push, PR merge or production activation occurred. Production numeric,
  final-model, room/arrival/navigation and hardware LOW gates retain their later
  owners. These gates are not relabeled as deferred QA defects.
- Next task: return to the 04 implementation packet to resolve F01 with the owner
  and apply the authorized outcome, then rerun its paired QA. Implementation 05
  remains Not started. Full path:
  `/Users/fernando/orca/workspaces/world-of-claudecraft/wocc-freeholds/docs/freeholds/phase-04-content-crafted-and-patterns.md`.

Deliverables (at most five):

1. Exactly ten crafted furnishing outputs, one per existing craft, with approved recipe
   and station/acquisition rows from content-manifest.md.
2. Exactly three pattern items within those ten outputs and deterministic Marks stock.
3. All same-change icon/provenance/name/originality/Hearth-page/wiki obligations.
4. Literal recipe/channel/economy/firewall and acquisition behavior evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
Current handoff after reconciled paired QA PASS:
[phase-05-instance-claim.md](phase-05-instance-claim.md).
Implementation 05 is complete locally; its paired QA is the next task.

#### 05 Instance claim

Implementation: [phase-05-instance-claim.md](phase-05-instance-claim.md). Paired audit: [phase-05-qa.md](phase-05-qa.md).

Status 2026-09-08: implementation COMPLETE locally (`c578fd77d0..497bc1d73f`) and the
paired QA PASS (the release sync `a461924855` plus `5f3fff5339..9b21dd61fc`, not pushed).
Current supersession note (06 source implemented, verification pending): the historical
05 crypt placeholders are now authored `inn_room`/`cottage` layouts. The gate uses the
canonical Eastbrook service at the retained `(-14,-92)` position, with quay drop
`(-14,-96)` (SUPERSEDED by the gate move after the v0.44.0 sync, 2026-09-22
to 23: now `(-38.65,-103.75)`, drop `(-38.65,-107.75)`; see the 07 release
sync v0.44.0 row), explicit sim proximity/context confirmation and keyed
feedback. The
Hearth Key adds shared context refusals and the isolated account cooldown. Owner
occupancy now indexes claims and walks the roster once; scan counters, a distinct
`updateInstances` profiler lap, the O(1) record-count gauge and bounded Freehold
presence/relay/admin labels are implemented. This replaces the corresponding source
TODOs; it does not replace verification or rewrite the 05 QA measurements above.

Named unsigned gates still carried forward: owner-pool capacity/empty hold (still
24/300) and physical-entry broadcast cost [before production lighting]; durable
record and account Hearth authority/private account mirror, never plot-owned and
never keyed durably on `entity:<pid>` [07/07a]; `fhold` descriptors [08a]; lighting and
fresh-directive arrival presentation [09]; service props [12]; visiting authority
[18]; final GLBs [19]. The realm Hearth participant currently refuses. The earlier
release displacement's seed-before-evict ordering must not become persistence
semantics. The Homesteader raise sites remain owned by 08/15.

Deliverables (at most five):

1. The two owner-claim DungeonDefs and all content/finder/reset/parity exclusions.
2. Host-stamped owner resolution, every account's default tier-0 Inn Room record, the D24
   dev grant fixture and deterministic claim/leave/reap behavior.
3. Thin flag-gated server dispatch, jailed refusal and same-account session sharing.
4. The authoritative arrival identity/pose and decisive offline/online parity tests.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-05-qa.md: [phase-06-interiors-gate-and-hearth-key.md](phase-06-interiors-gate-and-hearth-key.md).

#### 06 Interiors, the Eastbrook gate, the Hearth Key

Implementation: [phase-06-interiors-gate-and-hearth-key.md](phase-06-interiors-gate-and-hearth-key.md). Paired audit: [phase-06-qa.md](phase-06-qa.md).

Status 2026-09-08: **COMPLETE INCLUDING PAIRED QA: PASS, local**.
The [QA receipt](qa/interiors-2026-09-08/README.md) records 37 findings found and
37 fixed, zero open or deferred: 36 source/capture findings plus DOC01, which
corrects stale pending-evidence wording in the final execution ledger. The original delivery ends at `67281f8ed4`;
the fresh independent review accepts the full repair range through
`957a93b05b418ac5baf7c164679b7bd72017b3c6`, including all source, tests,
46 final PNGs, producer provenance and completed shared-gate evidence.

The final PostgreSQL-armed `node scripts/gate_select.mjs` exited 0 with all twelve
steps green: 4,210 unit files and 63,227 tests passed, two existing expected
failures and 27 explained skips; all 51 browser files and 429 tests passed.
Typecheck, environment/server/bot/client builds, generated-artifact freshness,
security and `ci:changed` passed. The final source-commit changed-file check
reports 604 files, 775 warnings and 16 infos, no errors. The raw log retains
nonfatal diagnostics, including the older archived Vite config discovery error;
actual Svelte checking completed with zero errors and zero warnings.
The [execution ledger](qa/interiors-2026-09-08/execution.md) preserves exact
commands, earlier failed gate attempts and source-based skip attribution.
The actual-last-commit `npm run ci:changed` check follows the separate verdict
commit; its future result is not claimed here.

The current hardware GPU receipt was generated at `2026-09-08T21:37:37.430Z`:
all four Inn/Cottage desktop/mobile windows advance 146 drawn frames, draw calls
are 33/28, preset is 1 and effective tier is low. The three required raw
arrival-through-sample counter deltas are zero; earlier cumulative events and
two ignored HTTP 502 diagnostics per viewport remain intact. Both error and
budget-failure arrays are empty. See the byte-preserved
[raw performance record](../screenshots/freehold-interiors-2026-09-08/performance.raw.json).

The canonical capture receipt retains 43 artifacts: eighteen PNGs, eighteen
sidecars, three raw and three formatted records, and
[acceptance.json](../screenshots/freehold-interiors-2026-09-08/acceptance.json).
All 42 source seals and seven harness seals match; Git identity is explicitly a
receipt-time observation. The real baseline remains `6540713541`, with no copied
feature application runtime. Baseline diagnostics are 102 inherited character
preload messages plus 29 HTTP 502 responses; all 28 after diagnostics are HTTP 502.
No page exception or unclassified diagnostic is present.
(Superseded 2026-09-23: the set was re-shot after the v0.44.0 sync and the gate move; the current receipt seals 67 source inputs, 17 of them harness files, and its diagnostics are 102 preload plus 28 HTTP 502 before and 28 HTTP 502 after. See [the evidence record](interiors-implementation-evidence.md), last section.)

The fresh reviewer personally inspected all eighteen canonical images,
[twenty narrow presentation fixtures](../screenshots/freeholds-06-presentation/README.md)
and [eight actual-key images](../screenshots/freeholds-06-key/README.md).
Presentation PNGs are observed 333 by 720, due to the browser-test iframe;
canonical compact captures prove the requested 874 by 402 viewport. Both real
key routes complete grant, bag art/tooltip, action placement, personal-bank round
trip and use, retaining one permanent key and one positive travel deadline.
Compact tooltips use explicit automated DOM focus on the shipping handler;
keyboard-only/touch-only tooltip navigation and physical-phone behavior are not
claimed. Actual touch opening, held drag, bank operations and activation remain
real inputs. No art was generated during this audit.

Source facts: `content/freehold/layouts.ts` defines the Inn 16×20 and Cottage 24×24
measured development shells, protected central paths, entry `(0,-4)`, exit `(0,-6)`
and facing 0; model/space evidence remains development sizing pending final acceptance.
`world_object_bootstrap.ts` creates the alive nonlootable `freehold_gate` only on an
opted-in stock world service; map semantics use `freehold-gate`. `gate.ts` rechecks
nearby authority and grants an absent permanent `hearth_key` after accepted entry
when bags permit, counting positive carried and personal-bank possession.
`owner_arrival.ts` resolves a deterministic body-safe position before claim or
travel side effects; saturation refuses without changing claims, inventory, RNG
or clocks. Empty rooms retain the authored entry. The tool's `ItemUse { type: 'freeholdEnter' }` routes through
`hearth_key.ts`; append-only refusals add `instanced` and `match`, and cooldown uses
one hour in the isolated Sim account map. Physical entry does not spend that clock;
full bags do not reverse accepted entry. Realm `freeholdKeyAdmission` fails closed
until 07/07a; local cached readiness is not durable authority or transferable plot data.

`owner_claim_occupancy.ts` indexes active owner claims and visits the roster once;
`instanceScanCounters` and `server/instance_scan_tick_stats.ts` retain current-tick
counts, capture totals and claimed-slot peak. The heartbeat's `freeholdRecords` is
a direct O(1) `ctx.freeholds.size` read; `updateInstances` has its own profiler lap.
`server/instance_presence.ts` shares catalog-based classification for `/who`, friend/
guild rosters and relay; relay publishes only `Freehold`. Shared status unions and
admin kind/room labels are distinct, without owner IDs. The online entry-facing
resolution now copies the existing self-wire `dungeonEntrySeq` into the player entity;
this fixes observed transition identity, not authorization to replay optional arrival
presentation. Public `myFreehold`/`freeholdLayout` remain null until 08a.

The live functional capture helper is `scripts/lib/pr_shot_freeholds.mjs`, separate
from 09's planned day/night helper. Its nine target/view variants produce the
eighteen exact before/after paths below. Both producers exited 0, and every
retained image and sidecar hash matches the personally inspected producer bytes.
The release baseline is the real quay without the new surface. No previous visual
acceptance transfers to new bytes.

This PASS accepts the functional shells, interaction and safe arrival. Production
remote-key admission remains fail-closed until 07/07a supplies durable account
participation, the database epoch after its lock and the committed private mirror.
Injected participant tests prove protocol behavior only. Fresh arrival directive
consumption belongs to 07c/08a/09; final lighting/camera/welcome to 09; reserved
Cottage anchors to 12; visiting to 18; final GLBs to 19; Wave A close to 20.
Production activation, slot-capacity and repeated-entry deployment gates remain
unsigned. The next task is 07 Persistence.

Required retained files under `docs/screenshots/freehold-interiors-2026-09-08/`:

| Required filename | Status |
|---|---|
| [before-freehold-gate-desktop.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-gate-desktop.png) | Visual QA PASS |
| [before-freehold-gate-compact.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-gate-compact.png) | Visual QA PASS |
| [before-freehold-gate-tablet.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-gate-tablet.png) | Visual QA PASS |
| [before-freehold-inn-desktop.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-inn-desktop.png) | Visual QA PASS |
| [before-freehold-inn-compact.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-inn-compact.png) | Visual QA PASS |
| [before-freehold-inn-tablet.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-inn-tablet.png) | Visual QA PASS |
| [before-freehold-cottage-desktop.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-cottage-desktop.png) | Visual QA PASS |
| [before-freehold-cottage-compact.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-cottage-compact.png) | Visual QA PASS |
| [before-freehold-cottage-tablet.png](../screenshots/freehold-interiors-2026-09-08/before-freehold-cottage-tablet.png) | Visual QA PASS |
| [after-freehold-gate-desktop.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-gate-desktop.png) | Visual QA PASS |
| [after-freehold-gate-compact.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-gate-compact.png) | Visual QA PASS |
| [after-freehold-gate-tablet.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-gate-tablet.png) | Visual QA PASS |
| [after-freehold-inn-desktop.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-inn-desktop.png) | Visual QA PASS |
| [after-freehold-inn-compact.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-inn-compact.png) | Visual QA PASS |
| [after-freehold-inn-tablet.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-inn-tablet.png) | Visual QA PASS |
| [after-freehold-cottage-desktop.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-cottage-desktop.png) | Visual QA PASS |
| [after-freehold-cottage-compact.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-cottage-compact.png) | Visual QA PASS |
| [after-freehold-cottage-tablet.png](../screenshots/freehold-interiors-2026-09-08/after-freehold-cottage-tablet.png) | Visual QA PASS |

Deliverables (at most five):

1. The measured Inn/Cottage layouts, collision/lift derivations and safe entry/exit poses.
2. Explicit Eastbrook gate interaction and the owned Hearth Key, with all authority gates.
3. Shared-grammar interior shells and scheduler-prepared dressing on both room families.
4. The gate prompt, its semantic map marker, keyed refusal feedback and all
   item/entity/i18n/content obligations.
5. Decisive offline/online tests and the desktop/compact/tablet visual evidence.

Regenerates ux-key-manifest.json (38 planned keys owned; 557 housing keys total) and
ux-shot-manifest.json (742 planned variants; 339 Wave A including nine functional 06 variants)
with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-06-qa.md: [phase-07-persistence.md](phase-07-persistence.md).

#### 07 Persistence

Implementation: [phase-07-persistence.md](phase-07-persistence.md). Paired audit: [phase-07-qa.md](phase-07-qa.md).

Deliverables (at most five):

1. Stable plot/account Hearth identity and bounded schema/query inventory.
2. Versioned preservation-oriented load and serialization.
3. Single-flight load and coalesced admitted save.
4. Lifecycle, recovery, export/delete and observability.
5. Housing-only developer bridge, ordinary Inn and dev-command proof.

Deliverable 5 delivers the housing-only developer authorization bridge behind both
permissions for the PRIOR 05 setter, default Inn Room record and dev grant fixture (D81):
no second default or tier writer, ordinary Inn preserved, nothing persists when
authorization fails.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-07-qa.md: [phase-07a-transactional-mutation-boundary.md](phase-07a-transactional-mutation-boundary.md).

#### 07a Transactional mutations and global claim fencing

Implementation: [phase-07a-transactional-mutation-boundary.md](phase-07a-transactional-mutation-boundary.md). Paired audit: [phase-07a-qa.md](phase-07a-qa.md).

Deliverables (at most five):

1. Global active-claim fencing.
2. Legacy-touch-set-preserving atomic mutation and account Hearth entry.
3. Durable operation intent and retained receipt authority.
4. Bounded original-identity recovery and post-commit acknowledgment.
5. Real-PG lock/lease/crash/replay evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-07a-qa.md: [phase-07b-account-lifecycle.md](phase-07b-account-lifecycle.md).

#### 07b Account lifecycle and protection history

Implementation: [phase-07b-account-lifecycle.md](phase-07b-account-lifecycle.md). Paired audit: [phase-07b-qa.md](phase-07b-qa.md).

Deliverables (at most five):

1. Account lifecycle head, immutable history and bounded loaders.
2. Captured-observation pure planner and sole durable writer.
3. Authenticated admission and periodic/leave/shutdown coordinator.
4. Accepted source binding and monotonic generation-safe projection.
5. Lifecycle/rollout/PG proof and exact DB contract.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-07b-qa.md: [phase-07c-arrival-eligibility.md](phase-07c-arrival-eligibility.md).

#### 07c Account first-tier arrival eligibility

Implementation: [phase-07c-arrival-eligibility.md](phase-07c-arrival-eligibility.md). Paired audit: [phase-07c-qa.md](phase-07c-qa.md).

Deliverables (at most five):

1. Normalized account+tier schema and safe bounded loader.
2. Conflict-safe mark inside accepted owner-entry transaction.
3. Historical facts and fresh arrival presentation contract.
4. Private isolated offline/headless mirror integration.
5. Race/replay/privacy/lifecycle/PG evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-07c-qa.md: [phase-08-layout-and-placement-sim.md](phase-08-layout-and-placement-sim.md).

#### 08 Layout core and placement commands

Implementation: [phase-08-layout-and-placement-sim.md](phase-08-layout-and-placement-sim.md). Paired audit: [phase-08-qa.md](phase-08-qa.md).

Deliverables (at most five):

1. Measured pure bounded geometry.
2. Exact-copy place/move/remove plans.
3. Bounded confirmed-session undo/redo.
4. Atomic placement commands and authoritative ephemeral build presence.
5. Geometry/custody/parity evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-08-qa.md: [phase-08a-descriptor-and-wire.md](phase-08a-descriptor-and-wire.md).

#### 08a Public descriptors and consumer-correct wire state

Implementation: [phase-08a-descriptor-and-wire.md](phase-08a-descriptor-and-wire.md). Paired audit: [phase-08a-qa.md](phase-08a-qa.md).

Deliverables (at most five):

1. Public/private housing models.
2. Per-consumer initial/resume/revision publication.
3. Strict bounded decode and stale-generation refusal.
4. Real command/heavy-self/snapshot integration.
5. Wire-chain/privacy/byte and serialization evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-08a-qa.md: [phase-09-render-furnishings.md](phase-09-render-furnishings.md).

#### 09 Render: furnishing view, light rig, ghost

Implementation: [phase-09-render-furnishings.md](phase-09-render-furnishings.md). Paired audit: [phase-09-qa.md](phase-09-qa.md).

Deliverables (at most five):

1. Identity-aware pure layout/diff core and scheduler-client furnishing view.
2. One model registry with prepared family stand-ins and safe future trophy forms.
3. The hearth/room condition and realm-daylight grade within the global light budget.
4. The shape-readable, tier-invariant placement ghost and its pure core/setter.
5. The safe first-arrival camera/sampled feedback composition and its tests/screenshots.

Regenerates ux-key-manifest.json (10 keys owned) and ux-shot-manifest.json (the registry
reaches 12 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-09-qa.md: [phase-10-furnishing-colliders.md](phase-10-furnishing-colliders.md).

#### 10 Furnishing colliders

Implementation: [phase-10-furnishing-colliders.md](phase-10-furnishing-colliders.md). Paired audit: [phase-10-qa.md](phase-10-qa.md).

Deliverables (at most five):

1. The settled runtime_collider_regions.ts sibling and unchanged-behavior rift aliases.
2. Server per-claim collision identity and pure descriptor-to-collider publication.
3. Client descriptor generation/identity lifecycle and matching local collision region.
4. O(1) host-token reader (per-claim ownership stamps) for movement, sight and pathing, no
   per-tick republish.
5. Rift equivalence, adjacent-claim, two-host and stale-generation lifecycle evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-10-qa.md: [phase-11-build-mode-ui.md](phase-11-build-mode-ui.md).

#### 11 Build mode UI

Implementation: [phase-11-build-mode-ui.md](phase-11-build-mode-ui.md). Paired audit: [phase-11-qa.md](phase-11-qa.md).

Deliverables (at most five):

1. Build-session controller and camera.
2. World-companion palette and meters.
3. Shared input and action strip.
4. Shared presentation and accessibility.
5. Build-session proof and capture helper.

Deliverable 2 also produces src/ui/hud/housing/capacity_meter_view.ts and its test;
deliverable 3 registers the five keybinds toggleBuildMode, rotateFurnishingLeft,
rotateFurnishingRight, undoPlacement and redoPlacement; the Replace trophy and Clear
plinth affordances ship disabled for 17's record-only chooser.

Regenerates ux-key-manifest.json (81 keys owned) and ux-shot-manifest.json (the registry
reaches 98 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-11-qa.md: [phase-12-strongbox-and-station.md](phase-12-strongbox-and-station.md).

#### 12 Strongbox and station amenities

Implementation: [phase-12-strongbox-and-station.md](phase-12-strongbox-and-station.md). Paired audit: [phase-12-qa.md](phase-12-qa.md).

Deliverables (at most five):

1. Built-in Strongbox access.
2. Station slot and crafting projection.
3. Explicit personal vault crafting arm.
4. Thin interaction and wire integration.
5. Boundary proof.

Regenerates ux-key-manifest.json (7 keys owned) in this phase with every cited count
updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-12-qa.md: [phase-13-condition-and-ledger-core.md](phase-13-condition-and-ledger-core.md).

#### 13 Condition and the Steward's Ledger core

Implementation: [phase-13-condition-and-ledger-core.md](phase-13-condition-and-ledger-core.md). Paired audit: [phase-13-qa.md](phase-13-qa.md).

Deliverables (at most five):

1. Pure condition and protection state.
2. Published Ledger schedule and source planner.
3. Atomic material payment and immutable prepay.
4. Command and owner wire projection.
5. Decisive pure and atomic proof.

Named outputs: NEW freehold_ledgers (the keep-forever paid-bill relation in
server/freehold_db.ts), src/sim/realm_week.ts (the calendar leaf extracted from
masterwrought_materials.ts), ledgerWeekOf, LEDGER_PREPAY_MAX_WEEKS = 4,
src/sim/freehold/ledger.ts (the pay_ledger body); 5 commits. Deliverable 5 runs
tests/server/freehold_ledger.pg.test.ts PG-armed with the composed daily-plus-Tuesday
restart fixture.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-13-qa.md: [phase-13a-authoritative-upkeep-calendar.md](phase-13a-authoritative-upkeep-calendar.md).

#### 13a Authoritative upkeep calendar

Implementation: [phase-13a-authoritative-upkeep-calendar.md](phase-13a-authoritative-upkeep-calendar.md). Paired audit: [phase-13a-qa.md](phase-13a-qa.md).

Deliverables (at most five):

1. Durable shared authority and bounded historical projection.
2. Private bounded authority ingress.
3. Monotonic host publication and exact acknowledgments.
4. Migration, account lifecycle and rollout preservation.
5. Integrated evidence and release artifact.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-13a-qa.md: [phase-14-distribution-surface-map.md](phase-14-distribution-surface-map.md).

#### 14 Distribution surface map

Implementation: [phase-14-distribution-surface-map.md](phase-14-distribution-surface-map.md). Paired audit: [phase-14-qa.md](phase-14-qa.md).

Deliverables (at most five):

1. Independent surface capabilities.
2. Composition and source boundaries.
3. Seven-distribution matrix and absence proof.
4. Exact language and approval artifacts.
5. Regression and accessibility proof.

Exactly two HudFeatures rows, freeholdPurchaseEnabled and freeholdManageOnWebsite (D91);
the map's housing fields are freeholdPurchase, freeholdManageOnWebsite and deedSurfaces
(deedSurfaces consumed by 38); management default off on every row.

Regenerates ux-key-manifest.json (2 keys owned) in this phase with every cited count
updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-14-qa.md: [phase-15-claudium-charter-and-call.md](phase-15-claudium-charter-and-call.md).

#### 15 Claudium: the Freehold Charter and the Master Builder's Call

Implementation: [phase-15-claudium-charter-and-call.md](phase-15-claudium-charter-and-call.md). Paired audit: [phase-15-qa.md](phase-15-qa.md).

Deliverables (at most five):

1. Extend the existing durable housing operation boundary.
2. Confirmed grant core.
3. Spend/reconcile integration.
4. Service contract handoff and growth rails.
5. Crash/race proof.

Named outputs: two RouteDef rows on server/freehold_routes.ts (POST /api/freehold/quote
with a typed body, GET /api/freehold/operation/:operationId) handled by NEW
server/freehold_purchases.ts, the checkoutAuthorization reference on the 07a operation
rows (D88 deletion policy inherited), SKU id freehold_master_builders_call, keys
charter.feeDetails, charter.quoteExpiry and charter.terms (D92),
src/sim/freehold/grant.ts.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-15-qa.md: [phase-16-steward-panel-and-store-surfaces.md](phase-16-steward-panel-and-store-surfaces.md).

#### 16 Steward panel and store surfaces

Implementation: [phase-16-steward-panel-and-store-surfaces.md](phase-16-steward-panel-and-store-surfaces.md). Paired audit: [phase-16-qa.md](phase-16-qa.md).

Deliverables (at most five):

1. Authoritative Steward view.
2. Focused decision window.
3. Approved Charter and Call submodels.
4. Shared design and mobile behavior.
5. Steward/store proof and screenshots.

Deliverable 3 renders 15's charter.feeDetails, charter.quoteExpiry and charter.terms rows
(the fee, tax and Purchase Terms lines, D92); window id steward-window.

Regenerates ux-key-manifest.json (74 keys owned) and ux-shot-manifest.json (the registry
reaches 187 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-16-qa.md: [phase-17-trophies.md](phase-17-trophies.md).

#### 17 Trophies

Implementation: [phase-17-trophies.md](phase-17-trophies.md). Paired audit: [phase-17-qa.md](phase-17-qa.md).

Deliverables (at most five):

1. Source-complete trophy catalog.
2. Shared account sources, eligibility and truthful provenance.
3. Record-only plinth placement and public projection.
4. Trophy case and tooltip.
5. Trophy proof and captures.

Deliverable 3 places through the NEW IWorldHousing members placeTrophy(plinthKey,
trophyId) and clearPlinth(plinthKey) (commands place_trophy and clear_plinth); deliverable
4 ships the trophy case window (id trophy-case-window), the tooltip and the Trophies tab
selection/focus UX, and wires the Replace trophy/Clear plinth affordances 11 shipped
disabled.

Regenerates ux-key-manifest.json (50 keys owned) and ux-shot-manifest.json (the registry
reaches 235 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-17-qa.md: [phase-18-visiting.md](phase-18-visiting.md).

#### 18 Visiting

Implementation: [phase-18-visiting.md](phase-18-visiting.md). Paired audit: [phase-18-qa.md](phase-18-qa.md).

Deliverables (at most five):

1. Admission and live policy.
2. Offline-owner authority and bounded lookup.
3. Policy/event/wire lifecycle.
4. Gate/guest experience.
5. Authority/UI proof.

Deliverable 1 admits on the named owner character's outgoing friend list, refuses when a
block row exists on either side, and busts the projection through the
friendAdd/friendRemove/blockAdd mutation-site hook that triggers the D51 ejection recheck
(D76).

Regenerates ux-key-manifest.json (33 keys owned) and ux-shot-manifest.json (the registry
reaches 339 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-18-qa.md: [phase-19-art-batch.md](phase-19-art-batch.md).

#### 19 Art batch

Implementation: [phase-19-art-batch.md](phase-19-art-batch.md). Paired audit: [phase-19-qa.md](phase-19-qa.md).

Deliverables (at most five):

1. Codex vendor asset family.
2. Codex crafted asset family.
3. Codex source-complete trophy family.
4. Codex Inn Room/Cottage dressing.
5. Registry/prewarm and evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-19-qa.md: [phase-20-wave-a-close.md](phase-20-wave-a-close.md).

#### 20 Wave A close

Implementation: [phase-20-wave-a-close.md](phase-20-wave-a-close.md). Paired audit: [phase-20-qa.md](phase-20-qa.md).

Deliverables (at most five):

1. Complete Wave A readiness matrix.
2. Exact visual and input matrix.
3. Production handoffs and four-week measurement artifact.
4. Durable budget review and release preparation.
5. Fresh review and recorded next handoff.

Deliverable 3 creates docs/freeholds/ledger-calibration-report.md and deliverable 4
docs/freeholds/housing-budget-review.md (both NEW FUTURE; later closes extend them).
Deliverable 5 STOPS and asks for the push go and ends at "pushed, green, ready for review"
or "matrix green, awaiting push go" (D87).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-20-qa.md: [phase-21-lodge-tier-and-upgrade.md](phase-21-lodge-tier-and-upgrade.md).

### Wave B: Lodge, furnishings and visiting

#### 21 Lodge tier and the upgrade build project

Implementation: [phase-21-lodge-tier-and-upgrade.md](phase-21-lodge-tier-and-upgrade.md). Paired audit: [phase-21-qa.md](phase-21-qa.md).

Deliverables (at most five):

1. Lodge tier, measured layout and final content/art obligations.
2. Approved upgrade bill and versioned service fee contract.
3. Atomic upgrade/contribution/completion and exact-copy carry-over.
4. Durable receipt/persistence and public progress projection.
5. Steward preview/progress UX and custody/parity evidence.

Deliverable 5 covers the Steward Upgrade tab with its keyed states and the six
steward-upgrade-* captures; the contribute command takes an explicit source mode and a
finish re-attempt arm per D89.

Regenerates ux-key-manifest.json (14 keys owned) and ux-shot-manifest.json (the registry
reaches 357 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-21-qa.md: [phase-22-furnishings-all-crafts.md](phase-22-furnishings-all-crafts.md).

#### 22 Furnishings across all ten crafts and the R8 pattern channels

Implementation: [phase-22-furnishings-all-crafts.md](phase-22-furnishings-all-crafts.md). Paired audit: [phase-22-qa.md](phase-22-qa.md).

Deliverables (at most five):

1. Exact twenty-output furnishing/craft roster and recipes, with produce decoration inside
   it.
2. Every rare pattern has one named raid or rift source plus Marks.
3. Final art, source/name checks and all same-change content obligations.
4. Full thirty-eight-output market/content/performance evidence.

Content plus exactly two appended luck-channel draws in sim logic (the nythraxis_housing
tail group and the rift Draw 8), reviewed by architecture-reviewer and
cross-platform-sync.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-22-qa.md: [phase-23-legend-stand-and-trophy-families.md](phase-23-legend-stand-and-trophy-families.md).

#### 23 Legend Stand and the remaining trophy families

Implementation: [phase-23-legend-stand-and-trophy-families.md](phase-23-legend-stand-and-trophy-families.md). Paired audit: [phase-23-qa.md](phase-23-qa.md).

Deliverables (at most five):

1. Bespoke models replacing every wave A generic trophy display.
2. Legend Stand and actual-item weapon/armor displays.
3. Cosmetic mounts, title banners and farming/profession displays.
4. Truthful source/difficulty/date projection and final finish art.
5. Account-wide live/retro sync and custody/visual evidence.

Deliverable 5 carries the plaque, finish and inactive picks on the descriptor with the
old-client default, owned by a WIRE slice.

Regenerates ux-key-manifest.json (19 keys owned) and ux-shot-manifest.json (the registry
reaches 366 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-23-qa.md: [phase-24-kitchen-garden-tableau.md](phase-24-kitchen-garden-tableau.md).

#### 24 Kitchen Garden tableau

Implementation: [phase-24-kitchen-garden-tableau.md](phase-24-kitchen-garden-tableau.md). Paired audit: [phase-24-qa.md](phase-24-qa.md).

Deliverables (at most five):

1. Bounded shared account-owner farm source with explicit freshness.
2. Single safe public owner-garden projection with private fields excluded.
3. Current-character owner-only Harvest Journal board and flavor NPC.
4. Final measured garden tableau and prop art.
5. Zero-bed, source-authority, privacy, fairness and interaction evidence, with the
   registered garden screenshot target and regenerated key/shot manifests (D92).

Regenerates ux-key-manifest.json (17 keys owned) and ux-shot-manifest.json (the registry
reaches 408 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-24-qa.md: [phase-25-build-mode-v2.md](phase-25-build-mode-v2.md).

#### 25 Advanced placement and build mode

Implementation: [phase-25-build-mode-v2.md](phase-25-build-mode-v2.md). Paired audit: [phase-25-qa.md](phase-25-qa.md).

Deliverables (at most five):

1. Typed floor, wall, table and fixed ceiling placement from measured authored anchors.
2. Atomic parent/child transforms and strict persisted/public descriptor compatibility.
3. Free planar translation/free yaw plus the retained fifteen-degree snapped mode.
4. Extend the existing session undo/redo, ghost and surface-capacity UX for every input.
5. Shared validator, persistence, collision and screenshot evidence for every new arm.

Deliverable 4 includes the build.snap mode toggle and the touch free-yaw handle.

Regenerates ux-key-manifest.json (5 keys owned) and ux-shot-manifest.json (the registry
reaches 446 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-25-qa.md: [phase-25a-prepay-and-fenbridge-gate.md](phase-25a-prepay-and-fenbridge-gate.md).

#### 25a Twelve-week prepay and the Fenbridge gate

Implementation: [phase-25a-prepay-and-fenbridge-gate.md](phase-25a-prepay-and-fenbridge-gate.md). Paired audit: [phase-25a-qa.md](phase-25a-qa.md).

Deliverables (at most five):

1. Twelve-week material prepay on the existing immutable published weekly schedule.
2. Steward batch preview/source choice and atomic receipt/persistence evidence.
3. Measured Fenbridge gate using the existing own-home/friend prompt and return routing.
4. Final gate art, content obligations and desktop/touch/gamepad round-trip evidence.

Twelve-week activation gates: the signed CAL-LEDGER-A and the 13a calendar-authority
acceptance (named unsigned release gates until on file). 25a proves twelve weeks through
ledger_core's injected cap; the shipped LEDGER_PREPAY_MAX_WEEKS default is raised to 12
only with the signed CAL-LEDGER-A version and the 13a acceptance recorded in state.md.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-25a-qa.md: [phase-26-open-house-visiting.md](phase-26-open-house-visiting.md).

#### 26 Open-house visiting

Implementation: [phase-26-open-house-visiting.md](phase-26-open-house-visiting.md). Paired audit: [phase-26-qa.md](phase-26-qa.md).

Deliverables (at most five):

1. Guild/public policy and visitor-cap matrix.
2. Bounded permission-filtered on-open list.
3. Current-authority admission and offline-owner visit lifecycle.
4. Rate-limited knock and End visit/revocation behavior.
5. Shared visit/Steward UX and multi-client evidence.

Deliverable 4 uses account+plot knock and public-entry buckets and refuses at admission
when a block row exists on either side (D76).

Regenerates ux-key-manifest.json (15 keys owned) and ux-shot-manifest.json (the registry
reaches 464 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-26-qa.md: [phase-27-wave-b-close.md](phase-27-wave-b-close.md).

#### 27 Wave B close

Implementation: [phase-27-wave-b-close.md](phase-27-wave-b-close.md). Paired audit: [phase-27-qa.md](phase-27-qa.md).

Deliverables (at most five):

1. Whole-wave B integration matrix including 25a and its QA.
2. Before/after desktop, compact and tablet screenshots.
3. Fresh wiki and signed-artifact release readiness record.
4. Scoped reviewed matrix fixes and fresh verification of their complete fix round.
5. Reviewable PR package with separately authorized push and green current-head CI.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-27-qa.md: [phase-28-guild-owner-kind-and-hall-fund.md](phase-28-guild-owner-kind-and-hall-fund.md).

### Wave C: Guildhalls

#### 28 The guild owner kind, the Meeting Hall, the Hall Fund

Implementation: [phase-28-guild-owner-kind-and-hall-fund.md](phase-28-guild-owner-kind-and-hall-fund.md). Paired audit: [phase-28-qa.md](phase-28-qa.md).

Deliverables (at most five):

1. Stable guild plot/claim ownership identity.
2. Rank, amenity and member-owned assigned trophy-plinth permissions.
3. Meeting Hall content/layout and final art.
4. Service-currency mirror and material/gold Hall Fund state.
5. Atomic bounded persistence/lazy hydration and cross-host evidence.

Deliverable 2 carries the D77 guild visit policy: current members always admitted; guild,
public or private only; public admission capped by the tier column.

Regenerates ux-key-manifest.json (9 keys owned) in this phase with every cited count
updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-28-qa.md: [phase-28a-guild-lifecycle-and-membership.md](phase-28a-guild-lifecycle-and-membership.md).

#### 28a Guild lifecycle and membership evidence

Implementation: [phase-28a-guild-lifecycle-and-membership.md](phase-28a-guild-lifecycle-and-membership.md). Paired audit: [phase-28a-qa.md](phase-28a-qa.md).

Deliverables (at most five):

1. Guild-keyed lifecycle head and immutable protection history under 07b's owner.
2. Committed membership-incarnation evidence and revocation-boundary capture.
3. Bounded admitted guild observation, coalescing and nonregressing installation.
4. Original guild binding, shared-calendar projection and the D79 tombstone disposition.
5. Real-Postgres authority, history, lock, retention and load proof.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-28a-qa.md: [phase-29-guildhall-purchase-and-upkeep.md](phase-29-guildhall-purchase-and-upkeep.md).

#### 29 Guildhall purchase and upkeep

Implementation: [phase-29-guildhall-purchase-and-upkeep.md](phase-29-guildhall-purchase-and-upkeep.md). Paired audit: [phase-29-qa.md](phase-29-qa.md).

Deliverables (at most five):

1. Service-owned pooled purchase and durable recovery.
2. Atomic capped material/gold/currency contributions.
3. Guild condition and immutable Hall Ledger settlement.
4. Indexed retained donor audit, export/delete and recovery proof.
5. Member/officer Steward/store UX and authority evidence.

Deliverable 2 keys the weekly cap on ledgerWeekOf (D84) and adds the officer-plus
withdraw-to-guild-bank verb on the 07a rail (D78).

PREMISE MOVED at the 2026-09-26 release sync (G1 in state.md, "Premises the
2026-09-26 sync moved"): "officer" is no longer a rank but a stamped bank tier, so
the member/officer UX and the officer-plus withdraw above key on the guild rank
permission the ruling owed before phase 28 names, never the Officer title.

Regenerates ux-key-manifest.json (29 keys owned) in this phase with every cited count
updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-29-qa.md: [phase-30-hall-amenities.md](phase-30-hall-amenities.md).

#### 30 Guild chest, feast table and shared stations

Implementation: [phase-30-hall-amenities.md](phase-30-hall-amenities.md). Paired audit: [phase-30-qa.md](phase-30-qa.md).

Deliverables (at most five):

1. Guild-bank-only chest with service-specific authorization and condition/proximity
   gates.
2. Existing feast object at the authored long table with unchanged Well Fed behavior.
3. Hall-member station predicate and crafting from each member's own Materials Vault.
4. Final amenity art/anchors and shared HUD interaction/permission evidence.

Deliverable 2 is the existing feast object at the authored long table (party feast through
place_feast, apex feasts through use) with unchanged Well Fed behavior.

Regenerates ux-key-manifest.json (3 keys owned) and ux-shot-manifest.json (the registry
reaches 502 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-30-qa.md: [phase-30a-hall-boards.md](phase-30a-hall-boards.md).

#### 30a Hall boards

Implementation: [phase-30a-hall-boards.md](phase-30a-hall-boards.md). Paired audit: [phase-30a-qa.md](phase-30a-qa.md).

Deliverables (at most five):

1. Muster board opening the current authorized guild roster.
2. Calendar board opening the existing guild event calendar.
3. Pledge board opening the existing member-readable pledge projection.
4. War table showing authorized raid lockouts and the recorded-first-kill section.
5. Final board art, measured anchors, shared UI states and privacy/interaction evidence.

Regenerates ux-key-manifest.json (8 keys owned) and ux-shot-manifest.json (the registry
reaches 520 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-30a-qa.md: [phase-31-guild-deeds-and-first-kill-trophies.md](phase-31-guild-deeds-and-first-kill-trophies.md).

#### 31 Guild-level deeds and first-kill trophies

Implementation: [phase-31-guild-deeds-and-first-kill-trophies.md](phase-31-guild-deeds-and-first-kill-trophies.md). Paired audit: [phase-31-qa.md](phase-31-qa.md).

Deliverables (at most five):

1. Bounded source-life and authenticated-character admission with complete activation
   coverage.
2. Immutable guild-at-clear capture and original-carrier save-snapshot bridge.
3. Durable first-source proof and bounded committed-outcome persistence/projection.
4. Append-only guild deed content and final shared trophy forms with truthful provenance.
5. War table first-kill UI and complete source, custody, privacy and concurrency evidence.

Deliverable 5's War table first-kill UI rides 30a's bounded sibling read with no facet
member (D82); capacity exhaustion never refuses join, dungeon entry or respawn (D83).

Regenerates ux-key-manifest.json (1 key owned) and ux-shot-manifest.json (the registry
reaches 526 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-31-qa.md: [phase-32-hall-and-manor-tiers.md](phase-32-hall-and-manor-tiers.md).

#### 32 Great Hall, Manor, Bastion tiers and build projects

Implementation: [phase-32-hall-and-manor-tiers.md](phase-32-hall-and-manor-tiers.md). Paired audit: [phase-32-qa.md](phase-32-qa.md).

Deliverables (at most five):

1. Three tier records and measured layouts as one ladder batch.
2. Exact approved project bills plus versioned service fee rows.
3. Atomic shared project/contribution/completion and exact-copy carry-over.
4. Final three-interior dressing with the shared project progress UI.
5. Durable server/persistence, cross-host, money-gate and custody evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-32-qa.md: [phase-32a-project-rewards-and-vault.md](phase-32a-project-rewards-and-vault.md).

#### 32a Project rewards and direct vault access

Implementation: [phase-32a-project-rewards-and-vault.md](phase-32a-project-rewards-and-vault.md). Paired audit: [phase-32a-qa.md](phase-32a-qa.md).

Deliverables (at most five):

1. Project-completion trophies from durable completed-project proof.
2. Completion-unlocked guild cosmetic furnishing vendor stock with an exact manifest.
3. Manor direct Materials Vault chest with service-specific authorization (D47: Manor
   only).
4. Final art, shared interaction UX and complete unlock/custody/content evidence.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-32a-qa.md: [phase-33-wave-c-close.md](phase-33-wave-c-close.md).

#### 33 Wave C close

Implementation: [phase-33-wave-c-close.md](phase-33-wave-c-close.md). Paired audit: [phase-33-qa.md](phase-33-qa.md).

Deliverables (at most five):

1. Whole-wave C integration matrix including 28a/30a/32a and their QA.
2. Before/after desktop, compact and tablet screenshots.
3. Fresh wiki and handoff-ready content/service/legal release artifact inventory
   (acceptance status recorded per artifact).
4. Scoped reviewed matrix fixes and a fresh review of their complete fix round.
5. Reviewable PR package with separately authorized push and green current-head CI.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-33-qa.md: [phase-34-wards.md](phase-34-wards.md).

### Wave D: Wards and optional Charters

#### 34 Wards: shared neighborhoods and exteriors

Implementation: [phase-34-wards.md](phase-34-wards.md). Paired audit: [phase-34-qa.md](phase-34-qa.md).

Deliverables (at most five):

1. Ward geometry and descriptor.
2. Race-safe membership.
3. Admission, doors and wire.
4. Exterior art and UX.
5. Proof.

Regenerates ux-key-manifest.json (17 keys owned) and ux-shot-manifest.json (the registry
reaches 544 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-34-qa.md: [phase-35-ward-favor-and-endeavors.md](phase-35-ward-favor-and-endeavors.md).

#### 35 Ward favor and Endeavors

Implementation: [phase-35-ward-favor-and-endeavors.md](phase-35-ward-favor-and-endeavors.md). Paired audit: [phase-35-qa.md](phase-35-qa.md).

Deliverables (at most five):

1. Permanent capacity and calendar.
2. Authored Endeavor content.
3. Durable progress and awards.
4. Ward panel and wire.
5. Proof.

Regenerates ux-key-manifest.json (14 keys owned) and ux-shot-manifest.json (the registry
reaches 562 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-35-qa.md: [phase-36-showcases-and-guest-books.md](phase-36-showcases-and-guest-books.md).

#### 36 Showcases and guest books

Implementation: [phase-36-showcases-and-guest-books.md](phase-36-showcases-and-guest-books.md). Paired audit: [phase-36-qa.md](phase-36-qa.md).

Deliverables (at most five):

1. Showcase persistence and close.
2. Guest book persistence.
3. Routes, privacy and growth.
4. Social windows and reward presentation.
5. Proof.

Regenerates ux-key-manifest.json (19 keys owned) and ux-shot-manifest.json (the registry
reaches 604 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-36-qa.md: [phase-37-charter-service-contract.md](phase-37-charter-service-contract.md).

#### 37 On-chain Freehold Charter: service contract, ledger table, geo-exclusion

Implementation: [phase-37-charter-service-contract.md](phase-37-charter-service-contract.md). Paired audit: [phase-37-qa.md](phase-37-qa.md).

Deliverables (at most five):

1. Service and authority artifact.
2. Typed proxy and fail-closed policy.
3. Durable claim/custody storage.
4. Registry routes and tests.
5. Runtime and handoff proof.

Regenerates ux-key-manifest.json (3 keys owned) in this phase with every cited count
updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-37-qa.md: [phase-38-charter-mint-and-trading.md](phase-38-charter-mint-and-trading.md).

#### 38 Charter mint surface and marketplace trading (web only)

Implementation: [phase-38-charter-mint-and-trading.md](phase-38-charter-mint-and-trading.md). Paired audit: [phase-38-qa.md](phase-38-qa.md).

Deliverables (at most five):

1. Distribution and mint card.
2. Prepare, custody and listing.
3. Atomic settlement and recovery.
4. Cosmetic flair and public presentation.
5. Proof.

Regenerates ux-key-manifest.json (28 keys owned) and ux-shot-manifest.json (the registry
reaches 648 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-38-qa.md: [phase-39-wave-d-close.md](phase-39-wave-d-close.md).

#### 39 Wave D close

Implementation: [phase-39-wave-d-close.md](phase-39-wave-d-close.md). Paired audit: [phase-39-qa.md](phase-39-qa.md).

Deliverables (at most five):

1. Scoped/whole-feature validation evidence required by the wave.
2. Final UX screenshots and interaction evidence.
3. Wiki and content freshness.
4. Fresh coverage/fix review and signed-artifact gate inventory.
5. Local reviewable release documentation and any separately authorized publication.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-39-qa.md: [phase-40-keep-and-citadel-tiers.md](phase-40-keep-and-citadel-tiers.md).

### Wave E: Housing depth and program close

#### 40 Keep and Citadel tiers, prestige deeds

Implementation: [phase-40-keep-and-citadel-tiers.md](phase-40-keep-and-citadel-tiers.md). Paired audit: [phase-40-qa.md](phase-40-qa.md).

Deliverables (at most five):

1. Content/layout family.
2. Prestige predicate.
3. Final art family.
4. Atomic upgrade/project settlement.
5. Steward requirements and proof.

Regenerates ux-key-manifest.json (12 keys owned) and ux-shot-manifest.json (the registry
reaches 663 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-40-qa.md: [phase-41-dye-station-and-layout-sharing.md](phase-41-dye-station-and-layout-sharing.md).

#### 41 Dye station

Implementation: [phase-41-dye-station-and-layout-sharing.md](phase-41-dye-station-and-layout-sharing.md). Paired audit: [phase-41-qa.md](phase-41-qa.md).

Deliverables (at most five):

1. Station and tint descriptor.
2. Eight-dye content family.
3. Material and picker presentation.
4. Wire, persistence and proof.

Regenerates ux-key-manifest.json (16 keys owned) and ux-shot-manifest.json (the registry
reaches 681 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-41-qa.md: [phase-41a-layout-save-and-sharing.md](phase-41a-layout-save-and-sharing.md).

#### 41a Layout saves and public sharing

Implementation: [phase-41a-layout-save-and-sharing.md](phase-41a-layout-save-and-sharing.md). Paired audit: [phase-41a-qa.md](phase-41a-qa.md).

Deliverables (at most five):

1. Public codec.
2. Bounded saved layouts.
3. Atomic plan application.
4. Layout tab and proof.

Regenerates ux-key-manifest.json (19 keys owned) and ux-shot-manifest.json (the registry
reaches 705 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-41a-qa.md: [phase-42-second-freehold-sku.md](phase-42-second-freehold-sku.md).

#### 42 Second freehold admission and shared Hearth cooldown

Implementation: [phase-42-second-freehold-sku.md](phase-42-second-freehold-sku.md). Paired audit: [phase-42-qa.md](phase-42-qa.md).

Deliverables (at most five):

1. Second-plot admission.
2. Independent plot upkeep and shared account lifecycle.
3. Durable grant and bounded mirror.
4. Steward/store UX and proof.

Regenerates ux-key-manifest.json (10 keys owned) and ux-shot-manifest.json (the registry
reaches 742 variants) in this phase with every cited count updated (D92).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-42-qa.md: [phase-43-carpenter-and-mason.md](phase-43-carpenter-and-mason.md).

#### 43 Existing-craft coverage and future expansion handoff

Implementation: [phase-43-carpenter-and-mason.md](phase-43-carpenter-and-mason.md). Paired audit: [phase-43-qa.md](phase-43-qa.md).

Deliverables (at most five):

1. Coverage and evidence artifact.
2. Future decision contract.
3. Consistency and proof.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-43-qa.md: [phase-44-wave-e-close.md](phase-44-wave-e-close.md).

#### 44 Wave E integration close before final artwork and legal handoff

Implementation: [phase-44-wave-e-close.md](phase-44-wave-e-close.md). Paired audit: [phase-44-qa.md](phase-44-qa.md).

Deliverables (at most five):

1. Integration matrix.
2. Visual and content proof.
3. Fresh whole-feature review.
4. Reviewable release evidence.
5. Mandatory continuation handoff.

Deliverable 5 records the proposed (not executed) durable preservation destination table
in the row 44 record, then STOPS and asks for the push go and ends at "pushed, green,
ready for review" or "matrix green, awaiting push go" (D87).

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-44-qa.md: [phase-44a-final-codex-artwork.md](phase-44a-final-codex-artwork.md).

#### 44a Final Codex artwork

Implementation: [phase-44a-final-codex-artwork.md](phase-44a-final-codex-artwork.md). Paired audit: [phase-44a-qa.md](phase-44a-qa.md).

Deliverables (at most five):

1. Exhaustive visual inventory.
2. Final Codex replacement of placeholder images.
3. Sanctioned pipeline integration.
4. In-context proof.
5. Residual zero and fresh review.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-44a-qa.md: [phase-44b-final-legal-handoff.md](phase-44b-final-legal-handoff.md).

#### 44b Final Terms and legal-team handoff against completed implementation

Implementation: [phase-44b-final-legal-handoff.md](phase-44b-final-legal-handoff.md). Paired audit: [phase-44b-qa.md](phase-44b-qa.md).

Deliverables (at most five):

1. Completed-feature evidence matrix.
2. Terms and player-copy revisit.
3. Service/platform/territory reconciliation.
4. Concrete legal-team handoff.
5. Final completeness and preservation audit.

Acceptance: every linked implementation checkbox and its paired QA must pass;
the reviewer matrix and whole-feature checklist supply the shared evidence floor.
After phase-44b-qa.md: the program ends; no automatic deletion, push or merge.

## Load-bearing handoffs and verified seams

07 owns stable plot and separate account Hearth storage, bounded recovery and the
housing-only developer bridge. 07a owns global claim fencing and atomic
mutations/receipts; every later resource or paid effect reuses it. 07b owns account
lifecycle/history and 07c owns account+tier arrival eligibility. 13a owns durable
finalized calendar ingress/delivery and the NEW FUTURE upkeep-calendar-db-contract.md; 13
consumes its safe projection and produces the keep-forever freehold_ledgers relation. 08
owns placement/history and ephemeral build-presence authority; 08a owns the public/private
wire and isDecorating boolean. 25a owns twelve-week prepay/Fenbridge, 28a the guild
lifecycle/membership extension, 30a boards, 32a completion rewards/direct vault, and 41a
bounded layout saves/sharing. No later file may silently move those duties back into its
unsuffixed predecessor.

The first-tier arrival marker is bounded private account-scoped auxiliary state owned
by 07c, marked inside 07a accepted-owner-entry commit and consumed by 08a/09. Database,
persistence and security review must verify the concrete account store, known-tier bounds,
absent-legacy default, FK/unique waits and mark-before-ACK atomicity. Sale or transfer
neither inherits nor clears the account marker; guest, reconnect and replay do not mint
eligibility. The optional presentation may be skipped after commit-before-ACK failure;
recovery must not replay it. A plot row or Sim mirror cannot redefine account scope.

The verified first-domain scaffold remains:
`npm run new:endpoint -- --domain freehold --method GET --path /api/freehold`.
Keep generated freehold.invalid_input and its catalog/mapping/parity rows. Move generated
server/freehold.ts and tests/server/freehold.test.ts to server/freehold_routes.ts and
tests/server/freehold_routes.test.ts, repairing registry and test imports. Add
freehold.disabled separately to ERROR_CODES, API_ERROR_KEYS, the English apiError.freehold
block, EXPECTED_CODES (file-local in tests/server/http/error_codes.test.ts) and KNOWN_CODES
(tests/api_error_code_parity.test.ts); the map editor's own KNOWN_CODES list in
src/editor/server_errors_core.ts is a different code family and out of scope. Later
freehold routes extend the existing domain by hand; the generator does not append into
its existing catalog block.

The fresh-join load reuses the injected bankBonusForAccount pattern in server/ws_auth.ts;
on the packet base 7d140843d2 server/main.ts binds it as a one-liner around
computeBankBonus(await bankBonusFactsForAccount(id)), with the facts export in server/db.ts
and computation in server/bank_entitlements.ts; the 05 QA's release-merge audit found that
origin/release/v0.42.0 at 553a5672ed still binds the same one-liner (no characterCount
closure exists on that tip), so the twin copies the one-liner and the current binding is
re-verified at phase start after the merge-forward. The freehold load
has its own injected callback and bounded single-flight admission. Offline permission
uses the separate explicit local bridge, not a presumed browser copy of the server env.

## Close evidence and durable artifacts

20 covers all Wave A pairs including 07a/08a and the exact desktop/compact/tablet,
input/focus/motion/LOW/denied-surface screenshot variants in ux-spec. 27 includes 25a; 33
includes 28a/30a/32a; 39 covers the optional-deed release gates; 44 includes 41a and runs
the complete-program matrix. Every close (20, 27, 33, 39, 44) STOPS and asks for the push
go and ends at "pushed, green, ready for review" or "matrix green, awaiting push go"
(D87); 20 creates docs/freeholds/ledger-calibration-report.md and
docs/freeholds/housing-budget-review.md, which later closes extend; 44 records the
proposed (not executed) durable preservation destination table. Screenshot fixtures are
not evidence that audio, multiplayer, service recovery, PG interleaves or a real device
were exercised.

Every close records the six handoff documents indexed in README, content/art/numeric
sources, signed external gate status, measured budgets and fresh fix review. The 44
preservation contract keeps the UX, locked decisions, content/numeric/art, audit and
all external handoffs intact before any separately approved scaffolding removal.
