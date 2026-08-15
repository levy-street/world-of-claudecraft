# Professions tuning packet: the record (phases 8 to 24)

Status: PACKET COMPLETE. All phases (0 to 24) are BUILT and QA PASSED, the
worklist is empty, and the maintainer ruled GO on the merge on 2026-08-03
(the merge decision record at the bottom of this file). The locale fill is
deliberately deferred to the maintainer's release-branch fill; its inputs
are consolidated in "The deferred locale fill" below and MUST NOT be lost.

Provenance: this file was the packet's living worklist and per-phase
record through 24 phases and two whole-branch review passes. At the merge
decision the maintainer directed it condensed to what documentation
needs; the full working records (per-phase worklists, entry syncs, build
records, QA records, review-round ledgers, mutation ledgers) live in this
file's git history at merge commit e590303989 and earlier. The pass-1
record for phases 0 to 7 is `professions-tuning-packet.md` beside this
file. Old-to-new phase numbering (the 2026-07-28 rewrite): old 10
(acquisition) became 12, old 11 (content) became 13, old 12 (UX) became
14, old 13 (perf) became 16.

## Vision

A unique feature that sits between WoW and RuneScape, beautifully
designed, with an incredible experience on desktop and mobile. V1
everything lands on this branch. V2 skill identity is content-unique,
not mechanics-unique. V3 the proficiency cap rises with zones. V4
performance is engineered against 1,000 concurrent players.

## What shipped, per phase

Phases 0 to 7 (pass 1, full record in `professions-tuning-packet.md`):
readout and banner; delist and quest tools; placement validator and node
fixes; node expansion; the tool gate; fine materials; fishing; tool
effects and rare tools.

- **Phase 8, base repair and review closeout.** CI green off-mac (the
  sharp/libvips icon `--check` platform drift retired by shipping final
  original paintings with ID/hash/shape pins), the R37 no-professions-
  beyond-zone-3 guard, both resolver refusal arms (slot AND load), the
  starter-tool mint bounded by the bank/mail/escrow predicate plus
  cadence, the capacity pre-gate agreement fix, and the superseded-prose
  sweep with its grep acceptance criterion.
- **Phase 9, node persistence and blob integrity.** D6 closed:
  `src/sim/professions/node_persist.ts` persists node cooldowns as
  remaining-time deltas with the addPlayer re-anchor filtered to live ids
  and clamped to one respawn; zero wire changes. Blob round-trip suite,
  rollback-erases-newer-fields notes, pending-grant folding into every
  save, tier-mail pruning on every transition entry point and on load.
- **Rulings checkpoint.** R24 to R38 verified encoded with zero
  mismatches; R39 to R44 settled (ledger below).
- **Phase 10, sim correctness and session lifecycle, plus fishing
  telemetry.** All 32 position-write exit paths wired or excluded;
  name-reclaim rekey uses stored casing and runs the instance-signer
  sweep; mail purge unread-count fix; duel-terminal cancel tail order;
  R43 deleteCharacter world-state purge; R44 linkdead playtime fix;
  fishing telemetry and the real startFishing parity scenario.
- **Phase 11, stale-client and rollout compatibility.** R34 guards, not
  a floor: unknown-id trade rows render raw with the shared fallback
  icon instead of throwing, bags/bank unknown-cell guards, the deploy
  order note in DEPLOY.md, wire-delta re-measures pinned.
- **Merge-settlement checkpoint.** The v0.32.0 re-sync (77 commits)
  audited; the six Scope A calls settled; Scope B drove the five seams
  live and found and fixed the missing mount x profession interlock
  (both directions, pinned in `tests/professions_mount_interlock.test.ts`).
- **Phase 12, the acquisition craft.** The two live tool effects exist
  as trainer-taught enchanting charm recipes (R45), recharge (R46) with
  the price-rung ratchet (R47) and the directional provenance arm (R48);
  28 mutations killed.
- **Phase 13, content, zone progression, and onboarding.** Wield-
  filtered value reads (R49, R50), the frozen wield ladder 40/70/85/100
  (R51), the mastery prose band re-measure (R52), work-order calls
  (R53), fishing identity (R54), Gull Mere real fishable water on
  Farshore (R55), zone-rollout earnable arms pinned against real
  producers, direction fixes (quest text and wiki).
- **Phase 14, UX polish (desktop, mobile, gamepad, accessibility).** The
  R40 prompt confirm flow whole (resolver widening, facet, wire, HUD
  dialog with mobile/gamepad/a11y treatment); trade capacity two-pass
  model fix scoped to charms; touch drop arms; R56 no unslot/suspend
  affordance; roughly ninety findings applied.
- **Phase 15, ops: GM tooling and the activity feed.** R35 minimal pair
  (inspect professions state, restore item/slot) behind moderation.act
  with audit-before-mint (R59); the deed/masterwork Discord feed behind
  the R58 consent flag with the R60 dedupe backoff; R57 realm identity
  at scrape time; the admin professions modal (the admin i18n keys the
  deferred fill now carries).
- **Phase 16, performance at 1,000 concurrent.** The load rig built from
  scratch; 1,000 of 1,000 across scenarios on the R36 Mac baseline;
  12.9x ncd steady-state cut, 2.5x median gather snapshot, 1.9x fleet
  receive rate; the DB_POOL_MAX_CLIENTS runbook entry with the measured
  487-concurrent wall; committed baseline JSONs.
- **Phase 17, the wiki truth pass.** Every guide claim re-derived from
  source (the prose refuter re-derived all 51 reworded keys); R61 to R66
  settled; THE REWORD LEDGER written (below); the release locale fill
  itself DEFERRED by the maintainer past the packet.
- **Phase 18, the final gate.** A no-authorship whole-branch review in
  the pass-2 shape (seven finder rounds, 43 verified findings, all
  applied or sorted; eight repo reviewers; a live track over the real
  WebSocket protocol; 15 of 15 mutants killed), the release-malware-audit
  PASS, screenshots refreshed, the deploy runbook check, and the first
  informational release-tier i18n measure.
- **v0.34.0 re-target (merge 706bec2d21).** 290 commits re-based the
  packet onto release/v0.34.0; 20 conflicts hand-resolved; the 11-auditor
  merge audit confirmed 26 findings, all applied (WireAura.bt decode
  symmetry, escrow marker bounds, scree node exclusion, corrected
  terrain/wire/chronomancy figures).
- **Phase 19, bank "Deposit materials", the honest taxonomy.** The
  derived `MATERIAL_ITEM_IDS` union (exactly the honest-45) in the pure
  sim leaf `src/sim/material_taxonomy.ts`; the shared Materials chip
  narrowed in lockstep (Q3 to Q8); the new Tools chip with M16 fills;
  the exact-set, per-source, and no-sim-importer test armature.
- **Phase 20, gathering coverage at the expanded scale.** The settled
  +36 bottom-three node set (156 nodes at 138/12/6), both blob pins
  raised to 8192 (Q11) with the corrected full-D5 sizing, the road-band
  and sea-plane guard arms with recorded exemptions (Q13, Q15), the
  fishing geometry arms (Q14), measured coverage floors in the placement
  suite, and the six chronicle deeds (Q26).
- **Phase 21, vendor buy multiples.** The visible 1x/5x/10x/custom
  control row (Q21) on the one options-bag `buyItem` shape across facet,
  Sim, ClientWorld, and server dispatch; refuse-whole and toast-deny
  hostile counts on EVERY row including riding rows; the shared
  prompt-dialog extraction; the sender byte pin and exclusion pins;
  29 of 29 mutants killed.
- **Phase 22, crafting identity card legibility.** The card rebuilt on
  the prof-craft-row family with pills and the uniform-collapse caption
  (Q28), shipped as a legibility bug fix (Q29); the 264px capped list
  with scroll-and-focus restore across rebuilds; the major-first sort as
  a copy-returning pure helper; the language-switch relocalize arm.
- **Phase 23, the repeatable work-order blue marker.** The pure
  classifier leaf `src/sim/quests/quest_marker_kind.ts` consumed by all
  four surfaces (nameplate, minimap, world map, gossip list); blue only
  after first completion (Q30); the cadence-cooldown dimmed marker
  (Q31); the QUALITY_COLOR.rare-derived tokens; forced-colors underline
  cues; the AA-lifted tooltip tag token; 14 of 14 mutants killed.
- **Phase 24, the guide prose truth pass.** Seven guide values reworded
  in place per Q32 against rendered vendor and guide-page probes; the
  worklist premise measured FALSE and the 125-row hand-carried re-fill
  list written (below); prose count words pinned to DEEDS content.

## Rulings ledger

### R1 to R23 (pass 1, unchanged)

R1 branch, R2 content-unique identity, R3 telemetry re-key, R4 koi odds,
R5 cap rises with zones, R6 perf target, R7 purchase-versus-use as
amended by R22, R8 rod fees stand, R9 refuse inert slots, R10 starter
tool cadence plus truthful comment, R11 move wood_mirefen_t2, R12
biteBody number, R13 derived mastery test, R14 Copper Dig pathing arm,
R15 map-doc D2 note, R16 header restate, R17 Marks-to-copper conversion
blessed, R18 reel-window trim blessed, R19 fishing teaching ceiling, R20
rod ladder stays buyable at Wilkes, R21 Thornpeak gatherer deed, R22 land
tool USE requirements (rods exempt), R23 future-zone tools through
content. Full text in this file's git history (pass-1 revision).

### R24 to R38 (settled 2026-07-28, do not re-litigate)

- **R24. Signed specimens are spent LAST.** Quest turn-in consumption
  prefers plain stacks and takes instanced (signed) copies only when no
  plain copy remains, mirroring `removeVendorSellUnits` and
  `removePreferFungible`.
- **R25. Land harvesting gains the in-combat and swimming denials** that
  `startFishing` already enforces.
- **R26. The reel press is exempt from the in-combat gate.** Casting
  stays combat-gated; the cast itself still breaks on damage.
- **R27. Harvesting and fishing break stealth, and action-locked
  shapeshift forms refuse both.**
- **R28. A live gather or fishing session cancels on every teleport**
  and when /follow tows the player across a zone line. The rod-tier gate
  reads the WATER'S zone, not the caster's.
- **R29. The queued-spell buffer clears when a gather or fishing session
  starts.**
- **R30. Recharge re-derives the charge maximum** from the best tool the
  owner holds AT RECHARGE TIME.
- **R31. The Thornpeak tier-1 faucet is ACCEPTED and recorded**,
  telemetry-watched; no skilling while dead (pinned).
- **R32. The Copper Dig camp stays exactly as shipped**; leveling first
  is the intended path; direction fixes still landed.
- **R33. Tier-3 danger placements are deliberate**, allowlisted with
  intent comments; the Grix-adjacent tutorial veins got spacing fixes.
- **R34. Stale clients get GUARDS, not a version floor.**
- **R35. GM tooling v1 is the minimal pair:** inspect professions state,
  restore a lost item or slot row.
- **R36. The 1,000-concurrent baseline is recorded on the maintainer's
  Mac**, hardware named in the baseline file.
- **R37. Editor and custom-map professions are DEFERRED** behind a
  derived assert-absent guard until the zone-4 design pass.
- **R38. Banners QUEUE instead of last-write-wins.**

### R39 to R44 (the rulings checkpoint)

- **R39. Recharge prices in the arcane material of the tool's rarity
  rung** (disenchant ladder identity), count scaled to charges restored.
- **R40. The prompt confirm flow ships with phase 14, WHOLE.** No inert
  half ships.
- **R41. An absorbed hit still cancels a session AND displaces.**
- **R42. Charge depletion is conditional on the bonus mattering**, from
  the same rng draw.
- **R43. deleteCharacter purges the deleted character's world-state
  footprint** (market listings, escrow collection, mail).
- **R44. Linkdead sessions stop accruing playtime points.**

### R45 to R48 (phase 12, build-decided, veto-able)

- **R45. The mint's item route.** The two live effects are charm ITEMS
  minted by trainer-taught tier-1 enchanting recipes resolving through
  `trainingStationTypeFor`; slotting consumes one charm through
  `resolveSlotToolEffect` (copy preference self-signed, unsigned, first
  foreign), the consumed signer becomes the slot's craftedBy; rare
  quality makes every crafted copy signed; no Springback item exists,
  pinned both ways.
- **R46. The recharge surface.** Owner-performed, instant behind the
  shared crafting-action window, no skill gain or XP; refusals for no
  real tool, at re-derived max, throttle; count ceil((charges
  restored / 10) x composed discount) floored at one; mint-exceeds-
  recharge pinned per effect per rung at the DISCOUNTED mint price; a
  byte-equal re-slot refuses as no_gain.
- **R47. The recharge PRICE rung is floored at the slot's own ceiling,
  and the ceiling is a high-water mark that also RATCHETS at harvest
  time** (best tool owned while the effect fires). Accepted residuals:
  the transient-courier latch at recharge AND harvest time. The use-time
  arm reads BOTH ends of the cast (start capture plus completion bags).
  The ratchet fires on every APPLIED use, mattered or not. SURFACED:
  this makes the earned maximum a permanent price floor, a stronger
  reading than R30 wrote.
- **R48. The no_gain provenance arm is DIRECTIONAL, and the viewer's own
  provenance crosses the wire as a `selfCrafted` boolean** (the name
  never crosses). The window's focus fallback re-parks on the same
  control, then Close, with a sent-guard per painted button.

### R49 to R55 (phase 13, build-decided, veto-able)

- **R49. The fine-grade tier reads the WIELD-FILTERED scan**, in
  lockstep with the access gate; the PRICE family deliberately stays
  ownership-based. SURFACED: the slot mint's starting charge count also
  reads ownership, an unearned epic pick fattens a charm's mint 20 to
  50; wield-filtering it would re-rule R30/R45, left as the maintainer's
  call.
- **R50. The corpse premium arm reads the wield-aware any-profession
  scan**; rods contribute unfiltered (the R22 exemption). SURFACED: the
  rod exemption pre-dodges any future tier-2+ monster-material family;
  decide with that family.
- **R51. The wield ladder is 40 / 70 / 85 / 100 for tiers 2 to 5**, one
  frozen table (`WIELD_REQUIREMENT_BY_TIER`); gatherDenied gained the
  additive optional wieldProficiency field.
- **R52. The craft-mastery prose target MOVES to the measured band
  (roughly 1.5 to 5 focused hours); the curve stays.**
- **R53. Later-zone work-order thinness is deliberate, and the
  out-tooled flat payout stands** as bounded friction.
- **R54. Fishing's identity has NO fine-grade axis**; rare-moment flavor
  stays zone-agnostic until the zone-4 pass.
- **R55. Farshore Isle gains Gull Mere, real fishable water** at
  (350, 118) radius 10; the zone stays R37-starter otherwise.

### R56 to R60 (phases 14 and 15, build-decided, veto-able)

- **R56. NO unslot or suspend affordance ships this packet.** The
  capacity wall's live escapes are clearing one bag slot and the R40
  prompt mode (unconfirmed use resolves the BASE grade at both capacity
  gates); revisit on telemetry.
- **R57. Realm identity is a SCRAPE-TIME label, never a series label.**
- **R58. accounts.deed_broadcasts is the professions-feed consent
  flag**, also gating the Discord feed's deed and masterwork cards.
- **R59. The restores gate on moderation.act, surfaced for the
  maintainer**: the first moderation.act routes that MINT economic value;
  the audit trail is the control; accounts.password is the named tighter
  alternative. Sharpened: the whole ITEMS catalog is mintable, 20 per
  audited action.
- **R60. A rejected consent read re-opens its dedupe key after a short
  backoff via compare-and-set re-stamp**, never immediately, only for
  its own claim.

### R61 to R66 (phase 17, build- and QA-decided, veto-able)

- **R61. The rendered map is the compass authority** (east = -X,
  north = +Z), never the layout file's raw-coordinate legacy names.
- **R62. harvestBodyChoice stays as the release refilled it.**
- **R63. A release-refilled key is re-reworded ONLY for a factually
  false sentence, minimally.** (Its ruling text named a wieldable-tool
  proviso the refuter round later removed; shipped provenanceBody
  carries only the specimen arm.)
- **R64. Literal-with-pin over token-set change** (toolsNote's 85/100,
  toolCraftedOrMarks's "three" pinned in tests/guide.test.ts).
- **R65. The widened consent label stays one label**; the label+note
  restructure is DEFERRED to the post-packet fill.
- **R66. The two Marks-route tool cells name the Drowned Litany**, with
  the five non-Latin fills re-minted per M16 and the gate-wording pins
  deriving the name from the shipped delve record.

## Scoping settlements

### Q1 to Q27 (phases 19 to 21, settled 2026-08-01)

Q1: phases 19 to 21 stay in THIS doc on the same branch. Q3/Q4/Q5: grey
trash, the five oddments, and raw fish are OUT of the deposit sweep;
Q6: the six vendor staples are IN, so the ruled material set is exactly
the honest-45. Q7: the deposit sweep and the shared Materials chips
narrow together; the market arm defers. Q8: the derived
source-or-reagent set is the vehicle, with the exact-id tripwire guard.
Q9/Q10/Q11: the +36 bottom-three candidate set ships, with BOTH blob
pins raised to 8192. Q13: relocate ore_evergarden_1 and pin the
remaining eight in-band nodes as recorded exemptions. Q14: the fishing
geometry arms are IN. Q15: the sea-plane guard arm is IN and the six
near-waterline candidates are nudged upslope. Q20: shortfalls refuse
whole and hostile counts deny with the existing toast. Q21: the visible
1x/5x/10x/custom control row is the one trigger surface. Q22: no
confirm dialog at any count. Q26: the bottom-zone deeds land with phase
20. Session defaults, veto-able: Q2 build order; Q12 rollout ledger rows
stay 'starter' with per-zone count pins; Q16 the galecrest 248s circuit
accepted; Q17/Q18 Marks shops and buyback excluded with pins; Q19 the
custom cap is countFit-derived with the computed max shown; Q23
honor-priced, soulbound, mount, and teachesRiding rows force qty 1; Q24
the custom prompt inherits the pointer/keyboard-only precedent; Q25
multi-buy stays silent. Q27 informational.

### Q28 to Q32 (phases 22 to 24, settled 2026-08-02)

Q28: phase 22 takes the full row-family rework plus the uniform-column
collapse. Q29: it ships now as a legibility bug fix. Q30: the marker
turns blue only AFTER the first completion. Q31: the cadence-cooldown
dimmed marker is IN phase 23. Q32: phase 24 lands ON THIS BRANCH with
in-place rewording. Q32's premise that stale fills re-enter the release
worklist was MEASURED FALSE at the phase 24 build (the scan's staleness
detection is dormant, the worklist emits pending rows only, the release
gate asserts pending == 0), which is why the hand-carried list below
exists. The masterwork worn-offhand item stays operator-side with no
tracking issue by the maintainer's choice (PR 2701 is an ancestor of
this branch and the release; the remaining exposure is whether
production has been redeployed since).

## The deferred locale fill (read this before the release fill)

The fill is maintainer-deferred and its canonical workflow is the
`i18n-locale-fill` skill (`.claude/skills/i18n-locale-fill/SKILL.md`).
Measured at the merge tip (registry `src/ui/i18n.status.json` regenerated
at e590303989): 10,573 keys x 21 locales, 3,913 pending rows across 231
keys, 245 blocked human-required rows (never machine-fill those). The
split: 2,873 rows on 162 packet-new keys (1,213 main; 1,660 admin, all
83 admin keys the phase 15 GM tooling); 780 rows on 52 release-known
guide keys, the phase 17 delete-to-re-pend remediation (Latin-only by
design, non-Latin refilled in-phase); 260 rows on 17 release-owned keys
(the on-bar key-binding strings, two quest texts, deeds broadcastsLabel,
and the four Vale Cup gate-note keys of PR 2824). Re-measure at the
fill's own tip; every stamped count supersedes on re-measure.

Two lists below are INVISIBLE to every tool (present overlay rows read
"translated"; the worklist emits pending rows only). The fill MUST take
them from here.

### The phase 24 hand-carried re-fill list (125 stale rows, 7 keys)

- Stale in EVERY non-English locale (the 18 base overlays own the
  fills; es_ES and fr_CA inherit by dialect fall-through):
  guide.economy.buyingBody, guide.economy.junkBody,
  guide.profPages.econ.workOrdersNote,
  guide.profPages.gatherDeeds.mining, .logging, .herbalism.
- Stale in the five non-Latin overlays only (zh_CN, zh_TW, ja_JP,
  ko_KR, ru_RU): guide.profPages.gatherDeeds.fishing. Its 15 Latin
  rows were English passthrough, are already pending, and are the ONLY
  rows of this set the worklist will list.

Until the fill, buyingBody and junkBody are factually wrong in every
non-English locale (they still describe the reverted three-tab shop and
the deleted rolled-quality sell confirm): correctness, not polish.

### The phase 17 reword ledger (255 stale non-Latin rows, 51 keys)

51 reworded keys carry now-stale translations in ALL FIVE non-Latin
overlays (hudChrome.deeds.broadcastsLabel is OFF this stale list because
the review round freshly filled its five rows). The 51 plus that one:
guide.professions.{whatBody, archetypesBody, archetypeSwitchBody,
startBody}; hudChrome.deeds.broadcastsLabel (FILLED);
guide.profPages.{rhythmBody, gainBody, toolsNote, toolCraftedOrMarks,
priceNone, bandsBody, specimenBody, trainingBody, howBody,
masterworkBody}; gatherIntro.{mining, logging, herbalism, fishing};
gatherDeeds.fishing; fish.{startBody, biteBody, scheduleNote,
tablesNote, koiBody}; craftIntro.{engineering, enchanting};
craftProse.weaponcrafting.{materialsBody, routeBody};
craftProse.armorcrafting.{identityBody, materialsBody, ladderBody};
craftProse.leatherworking.{materialsBody, ladderBody, routeBody};
craftProse.cooking.{identityBody, materialsBody};
craftProse.alchemy.{identityBody, ladderBody, routeBody};
craftProse.engineering.{identityBody, materialsBody, ladderBody};
craftProse.enchanting.{identityBody, levelingBody, marketBody};
ench.enchantsNote; econ.{trainingNote, provenanceBody}; faq.{a6, a7,
a8}. The Latin side of the same keys is ordinary pending (worklist-
visible). The R63 re-rewords (enchanting marketBody, provenanceBody,
masterworkBody) re-staled their fresh release fills; they are in the
list above.

### Fill riders (carried from the phase records)

- The {clears}/{tier4Prof}/{tier5Prof} token adds; the per-locale 85/100
  literal pin (deferred by R64; at fill time tokenize or extend the
  per-locale loop); the locale-side clears-wording guard for
  toolCraftedOrMarks.
- The ja/zh currency unification and the ru/zh_TW polish items.
- The four retired identity-card header keys
  (hudChrome.crafting.identity.colCraft/colSkill/colRole/colCap): drop
  the keys and their overlay rows together in a maintainer pass.
- The release's Vale Cup deed rewording (#2802) left all 18
  deed_i18n.locales overlays on the pre-reword text (gate-invisible,
  same class as the ledgers above).
- The branch's Deeprock warning sentence in guide.professions.startBody
  is missing from the five non-Latin fills that translate the rest of
  the value.
- The professions window's pill namespace (hudChrome.professions.*)
  diverges from the card's correct crafting.identity.* wording in 18 of
  22 locales, including cap-as-headwear mistranslations (pt_BR, vi_VN,
  pl_PL, tr_TR): align at the fill.
- The R65 label+note restructure, deferred to the fill.
- deed_i18n scope: the chr_peaks_gatherer deed locale rows (still zero
  rows), plus the six phase 20 chronicle deeds' locale coverage.

## Open items at the merge

### Maintainer decision list (presented at the merge, not re-litigated)

- The stale-ledger framing: the two ledgers above publish ACTIVELY FALSE
  statements in shipped languages; prioritize the fill on that basis.
- The R58 rollout flag: existing accounts default TRUE begin publishing
  masterwork and deed cards to the public Discord channel on deploy
  without a fresh prompt (a release-notes item).
- The IMMOBILE_AURA_KINDS stasis omission in src/main.ts (import the
  shared MOVEMENT_LOCK_AURA_KINDS).
- The mediawiki first-boot seed's fishing page (materially behind the
  system; the seed also still says three zones).
- The /api/deeds/broadcasts rate-limit note.
- R63's ledger nit (the removed wieldable proviso) stands corrected in
  its entry above.
- The dead/CC gate family: craft, train, enchant, salvage, unbind,
  station placement take no dead or CC gate on the release base; the two
  packet-new commands gate dead; one coherent post-merge sweep candidate
  wanting its own ruling.
- The four malware-audit advisories, re-verified still holding at the
  merge: the @solana/web3.js phantom dependency (transitive-only, and
  the scanner's manifest-scoped risky-name check cannot see it); the
  signAndSendTransaction verb matching none of the scanner's rules
  (verified empirically against all 41 regexes); the bigint-buffer 1.1.5
  upstream advisory (now also authorized to run its install script under
  pnpm); the mobile-deeplink wallet session secret in localStorage (the
  ephemeral dapp nacl secret, not the user's key; the wallet still
  prompts).
- NEW at the merge decision: the pnpm migration removed install-script
  visibility from the malware scanner (pnpm-lock.yaml carries no
  hasInstallScript field and the scanner does not read
  package.json pnpm.onlyBuiltDependencies; all ten allowlisted packages
  were hand-audited clean this round, including @reown/appkit's
  postinstall version-check script read in full). A scanner-coverage
  follow-up beside the two advisory blind spots above.
- Standing: scripts/test_turbo_experimental.mjs runs a version-pinned
  third-party package via npx --yes, deliberately outside the lockfile;
  opt-in only, never on the gate path.
- The Yumi-maze minimap z-mirror (pre-existing on both parents,
  evidence captures committed): file the follow-up issue after the
  merge.
- The R49 mint-size ownership question and the R50 rod-exemption
  question, surfaced in their rulings above.

### Elevated follow-ups (recorded here per the packet convention, NOT
filed as issues)

Sim and IWorld:
- The offline Sim pays a fresh craftingIdentityFor allocation per
  nameplate full pass and per 10Hz minimap build; a narrow IWorld read
  of the cadence-blocked set would make it free on all four surfaces
  (the facet change phase 23 deliberately avoided), beside its parity
  pin update.
- Sim.talkToNpc restates the ready-over-available giver/turn-in shape
  the quest-marker leaf now owns; fold onto the leaf's predicates or pin
  the two consistent.
- The enchant re-mint wash: the bagged apply-enchant consumes a plain
  crafted stack without capturing its marker while the worn arm
  preserves it through the equip bridge (pre-existing, now
  arm-asymmetric after the release closed the other four legs, which
  arguably raises its priority).
- The crafted-marker family beyond the closed legs, and the wire-field
  parity pin candidate: no test pins the server WireAura key set against
  the client decoder's (what let an emit-only field ship).
- R58's surface enumeration gains a third out-of-flag deed surface: the
  release's Epic achievements mirror exports earned deeds like the Steam
  mirror does.

Vendor and bank:
- All 45 kind-tool items lost the bulk-deposit sweep (the rift family is
  unsellable AND unlistable, so the old sweep was its only bulk path);
  restated for the maintainer on the full blast radius.
- The bank window has no per-rebuild focus restore at all (the release's
  vendor focus-capture family may be adoptable); the Tools chip label is
  a grab bag; 26 items are reachable only under All (pinned as ruled);
  the market Materials chip stays on the Q7 deferral; the tooltip kind
  line still reads Junk for honest materials.
- Q21 redundancy (a 5x control beside the release's Buy Stack tile), the
  Q23 one-model re-rule and double-x5 wording, the Q19 bulk-cap
  convergence (the bulk verb is bag-fit blind), the non-stackable
  force-1 question (a 10x mis-click on a no-confirm counter spends
  tenfold), the all-force-1 counter still rendering the control row, the
  positional slot-ladder one-button skew when a bulk tile appears
  mid-session, the prompt family's missing runtime-language relocalize
  (family-wide, pre-existing), and the dev-realm copper-total display.

Map and world:
- The +132 full-D5 follow-on list: the wire arm takes its third ceiling
  move near 8,850 bytes; minimap_markers, gathering_view,
  cliff_scree_core, and the unmemoized gatherNodeClusters pass want an
  index or memo before the count doubles again; nothing pins
  render-batch spatial extent (max half-diagonal grew 101 to 122.5yd);
  server/db.ts topArenaRatings is where the next state-blob ceiling move
  surfaces first.
- Eight further zones carry full node sets but no gatherer chronicle
  (zone-4 pass), and the Farshore world-page card renders the Vale's
  blurb verbatim (biome 'vale', no farshore keys).

HUD and guide:
- At uiScale 1.4 on 1366x768 the crafting window clips 123px past its
  clamp with no scroll affordance (a pre-existing cliff the taller card
  moved from about uiScale 1.24 to 1.08; window-level height-yield is
  the fix shape).
- The happy-dom suites make real outbound localhost requests through the
  character portrait module's module-scope asset warmup (release-owned;
  a shared DOM-setup fetch stub is the wholesale fix).
- The '?' family stays color-only under forced-colors (the '!' family
  carries underline cues; the pair deserves the same treatment).
- Tooltip text is theme-blind beyond the phase 23 tag (tt-title about
  1.1:1 on Parchment; the tag token's ensureReadable shape is the
  template), and the user-settable HUD opacity knob fades the whole
  tooltip below any measured floor.
- The three-zones prose set (guide.home sub, worldPage.intro,
  worldPage.mapSub, progression.journeyBody say three zones; ZONES
  carries 14, the pages render 8 cards); deedsPage.chroniclesBody "Each
  zone" overclaims; fish.tablesNote's three-authored-tables claims
  (eleven zones serve the Vale fallback); a deliberate marker legend on
  the quests page is a register change to make on purpose; the phase 24
  count pin covers count words, not the fishing zone enumeration.

Server and ops:
- Consolidate the two near-duplicate batched discord_links readers
  (discordForAccounts, discordLinksForAccounts) once the legacy
  per-stream GETs retire with the pre-outbox bot.
- .env.example documents only 4 of the 16 DISCORD_* knobs
  docker-compose forwards (DEPLOY.md covers all sixteen).
- The event-frame growth the release added (ability ids on spellfxAt,
  zone pulse ticks) has no measurement; a load-baseline recapture
  candidate beside the mailbox entity-count note.
- Mail's attachment cap validates pre-split, so the provenance bucket
  split can book more than MAIL_MAX_ATTACHMENTS parcel rows per letter
  (downstream arms safe).
- tests/CLAUDE.md still documents jsdom as the DOM default (stale on
  both sides since the happy-dom migration; a release-side doc fix).

### Deferred and accepted, with reasons

- Thornpeak t1 faucet: accepted, telemetry-watched (R31).
- Copper Dig camp danger: intended; level first (R32).
- Tier-3 danger placements: deliberate, allowlisted (R33).
- Offline console slotToolEffect: /dev-equivalent, recorded (8e.5).
- Stale-client cosmetic arms without a graceful fallback: accepted
  (phase 11 doctrine).
- Editor/custom-map professions, including the editor 2D canvas's node
  blindness and the 3D viewport's terrain re-seat: deferred behind R37
  until the zone-4 design pass.
- A hard client version floor: separate later decision (R34).
- Pass-1 deferrals stand: shared node depletion (telemetry-gated), the
  strike minigame (rejected), the quest XP curve (out of scope).
- GM item restore mints PLAIN copies only (no client-supplied instance
  payloads by design; a signed or masterwork original is not exactly
  reproducible).
- Escrow copies in strangers' parcels and listings keep a renamed
  crafter's old signature (the accepted craftedBy limitation).
- Most starter commons cannot masterwork (primary-stat effect gate); a
  content observation, not changed.

## Merge decision record (2026-08-03)

Entry: tip 20452f9a1a (the phase 24 build record), gate all 10 green at
547eb5ef7e content. The session ran the sync rule first: zero drift
(origin/release/v0.34.0 unmoved at 5f22a51a00, an ancestor), no merge
owed, and the gate re-run fresh at the tip in a quiet window: PASS, all
10 steps, 2053 test files / 27,316 tests (89 skipped) plus the 11-file
browser suite at 96 tests, exit 0 read from the run's own line.

The decision package: branch 483 commits ahead / 0 behind at
def382e111 (970 files, +114,667 / -7,188); the release-tier i18n
picture measured (the numbers now live in "The deferred locale fill"
above); the release-malware-audit re-run over the whole tree as a
scanner pass (5,011 files, 262 flags, 0 high, --gate exit 0) plus four
judge agents triaging every flag with the files open: 262 of 262
dismissed, zero confirmed, zero uncertain, verdict PASS, with the four
standing advisories re-verified and the new pnpm install-script
coverage gap recorded (both in the decision list above). Stated limits:
static plus contextual reading, no sandbox execution, transitive
dependencies unaudited; pair with npm audit and a lockfile diff at
release.

THE RULING (the maintainer, in-session): GO. Push to origin, open the
PR against release/v0.34.0, babysit CI to green; merging the PR itself
still needs separate approval. The locale fill lands as the
RELEASE-BRANCH fill, taking the two invisible lists and the riders
above with it. The maintainer also directed this file condensed to
documentation essentials before the push (this revision).

Executed after the ruling:
- The base had moved during the session: origin/release/v0.34.0
  advanced to 37ac6ca423 (8 commits: the Vale Cup deed-gate visibility
  PR 2824, and 33729a9716, the release-side mirror of the finder
  own-listing reconciliation this branch made at 309296ab0f). Merged as
  e590303989 with four conflicts: the finder test resolved as a union
  (branch positive-control and unlocked arms kept, the release's full
  myListing object assertion adopted), the shot-targets test kept both
  sides' appended routing pins, the finder view took the release's
  fuller comment, and the pending i18n bundle was regenerated.
- The release-merge-audit ran over e590303989: no dropped hunks in any
  co-modified file, no legacy-arm divergence (the delta touches no
  migrated surface; the game.ts change is comment-only), no new routes,
  WS commands, or db-mock sites, no injection re-binds owed, and the
  new VcMatchInfo rated/practice fields ride the wire with the
  release's own round-trip pin. One shared const arrived
  (VC_ALLROUNDER_ONLY_MAX_BRACKET). Premise updates: the "mirror the
  finder reconciliation on the release branch" item is CLOSED by the
  release; the four new Vale Cup gate-note keys add 60 Latin pending
  rows to the release-owned backlog (counts above already include
  them).
- The full gate ran green at the condensation tip 8f9591c3fc (all 10
  steps, 2,054 test files), and the base moved AGAIN before the push:
  origin/release/v0.34.0 advanced to 48fbcf80b8 (7 commits, the
  zone-map open-sea edge PR 2817). Merged as 0821cc0d3c with one
  conflict (the map_terrain test's import block, resolved as the union
  with the branch's derived WORLD_SEED kept over the release's 20061
  literal). The audit over that merge: all four both-sides files are
  verified unions (the open-sea pure-core registration beside the
  branch's rows, the ocean token beside the marker tokens, the
  fairness-doc append), and the delta carries no route, wire, db, or
  sim surface, so no premise moved.
- Then the full gate at the push tip, the push to origin, and the PR;
  results recorded in the session memory
  (professions-tuning-packet-merge-decision).
