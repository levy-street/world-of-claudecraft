# Farming: cross-phase state (the cheat sheet)

Read this file first in every phase session. It is the single authority for locked
decisions. If a phase file contradicts this file, this file wins and the phase file
gets swept in the same pass (amend the QA twin too, always).

Current state (2026-08-20): the farming packet is COMPLETE at fourteen phases
(F01 to F14 with F06b and F09b; frozen QA tip 354cff6e77, F14 merge
673036bb95, gate PASS recorded in progress.md) and ABSORBED into the
Masterwrought packet at its Phase 11b merge (424ce89a20 on
feature/masterwrought; ruling 11b-D-3). This directory moved whole at the
absorb (the README banner records the rename and the old path). Delivery is now the
Masterwrought packet's: one branch, one PR; D22 and its addendum (B) are
superseded IN PLACE below. The handoff table in this file is the MERGED
packet's one open-item collection point: the delegated rulings of 2026-08-20
are migrated into it, and masterwrought's open items append at the END of the
table, never interleaved. The history stack below is preserved verbatim,
headers demoted to "Prior:".

Prior (this header block was written mid-phase; Phase 13 completed and Phase
14 followed, see progress.md): Phase 13 (integration polish) IN FLIGHT on
fix/farming-phase-13-integration-polish, opened with the M5 sim.ts
extraction (monolith ceiling 12660 lowered to 12249, which DISCHARGES the
Phase 12 comment-compression ratchet read). Prior: Phase 12 QA (verify the
shared feast) DONE 2026-08-19, PASS-WITH-FOLLOWUPS, merged caf0fdee9f
(one real lifecycle defect found and fixed: the instance/delve feast
teardown registration; the finite re-arm dodge amended to the Infinity
sentinel; residual ledger in the Phase 12 QA block below). Prior: Phase 12
(the shared feast) DONE 2026-08-19, merged 71010cf82a (placeFeast and
consumeFeast on IWorldFarming, 331 = 88 + 243, commands 204/217; beat P
discharged the wellfed parity beat; farming_session golden md5
9dfd1c6ea073f853655e38675460e81f; deviation (ca): the feast recipe ships
reagent-dormant-honest, so the D11/(bo) ruling must cover THREE advertised
dormant rows before any release merge). The "Phase 13 handoff" section
below collects EVERY open gate, maintainer read, and deferral in one
table. Prior:
Prior: Phase 11 (well-fed food) DONE 2026-08-19, local-only per D22
(branch fix/farming-phase-11-well-fed-food, nine commits, merge hash in
progress.md). ItemDef.wellfed ships beside elixir as the D15 mirror, minted
by src/sim/wellfed.ts at COMPLETION of the 18s sit-restore (deviation (bx):
the timing decision; an interrupted meal forfeits; food-only kind guard),
via ctx.applyAura with the one aura id wellfed_buff_sta: all four dishes
share the aura name 'Well Fed' and the buff_sta kind (deviation (by)), so
food never clobbers elixir_<kind> and last eaten always wins namespace-wide.
Four buff dishes, one per crop tier, joined FARM_RECIPES (9 to 13; produce
x4 plus salt; the tier-1 row carries the pottage-precedent vale_wheat
binder, deviation (bz), keeping every farm row uncraftable from counter
stock); proposed magnitudes 3/600s, 6/900s, 9/900s, 12/900s at or below the
documented elixir ceiling, maintainer-flagged (the capstone sits AT the
ceiling and stacks with a same-stat elixir to 24, the OPEN tuning read).
Tier 3/4 dishes reagent-dormant under (bo). UI: aura.wellFed + the
AURA_NAME_KEY row, src/ui/wellfed_tooltip_view.ts beside the elixir view
(both branches interpolate the buff name through the one matcher), buff bar
and icon ride the existing aura chain; hud.ts 19219/19220. (bw) DISCHARGED:
the farming_session scenario gained a position-searched golden-WIN beat
(five-fold signed grants at both grades, the crop announce, the mark, all
in the digest) and a paying-band tier-3 seed-back beat; ONE isolated
classified re-record, md5 83c34781 to 25bd6b8774f913279c96dddb25f93403,
draws 16 to 110, zero other goldens moved. Reviews: architecture,
cross-platform, content-obligations, frontend all 0 BLOCKING (every
SHOULD-FIX taken or ledgered); baselines: deeds 280/3190/43 unchanged,
IWorld 329 = 88 + 241, commands 202/215, delta keys 87, no new
SimEvent/IWorld/command/wire surface, ITEM_ART_PENDING 39 to 43. Prior:
Twenty-first absorb DONE 2026-08-19 (release/v0.40.0 tip e56707a675; the
D22 minor-version rule fired the 06b shape as its own sync mid-phase
before Phase 11; 7 commits / 86 files: the v0.39 spell-icon revert plus
the CI browser-deps fix; three-file farming intersection auto-merged
lossless; zero baseline, golden, or evidence-seal movement; audit lane
CLEAN; full record in progress.md). Prior:
Prior: Phase 10 (celebrations) DONE 2026-08-19, local-only per D22
(branch fix/farming-phase-10-celebrations, five commits, merge hash in
progress.md). golden_harvest is the FOURTH flavor on the gatherRareEvent
union, rolled unconditionally in the harvest draw block AFTER the seed-back
roll via the shared GATHER_RARE_EVENT_CHANCE (harvest draws now: tier 1/2
EXACTLY 1, tier 3/4 EXACTLY 2, denies zero); a win five-folds both grades,
grants signed-up-to-fit with plain overflow, and zone-announces through the
one announceGatherRareEvent path (source type 'crop'; one belief gates win,
announce, and mark). Seven D13 deeds landed (first planting on farm:planted,
four zone chronicles on farm:<zone>, col_golden_harvest at renown 0,
prog_farming_100 with the Harvestmaster title); deeds totals 280/3190/43
titles; Harvestmaster joined RELIQUARY_HORIZON_TITLES (341/376/41). The
ui_farm_golden sting shipped end to end; hud.ts SHRANK via the
ability-tooltip extraction (ceiling 19352 to 19230, now 19227/19230,
headroom 3). farming_session re-recorded ONCE, isolated: 11 to 16 draws,
md5 83c3478142deabbffbf23912575873e9; zero other goldens moved. NEW
deviations (br)-(bv) below; the headline correction: the (bo) "beds cannot
be sown" premise was PROBED FALSE (no bed-tier gate), so all four
chronicles are earnable today, while prog_farming_100 ships DORMANT under a
recorded docs/design/deeds.md waiver until D11 (feat_book_complete
transitively parked). Reviews: architecture/cross-platform/frontend 0
BLOCKING, content-obligations' one BLOCKING resolved via the waiver,
qa-checklist READY; mutations 13/13 killed named. Maintainer reads owed:
the (bs) waiver itself, the D12 cadence (1/90 per harvest is far rarer in
wall-clock terms than per node swing, and withered harvests burn rolls so
the realized rate is 1/90 times survival), the second v0.39.0 deed-locale
fill pass (15 new manifest rows), and the Steam mapping deferral. NEXT:
Phase 10 QA (docs/prd/masterwrought/farming/phase-10-qa.md, its head carries the
executed-rulings block). Prior: Phase 9b QA DONE 2026-08-19,
PASS-WITH-FOLLOWUPS (branch
fix/farming-phase-09b-qa; merge hash in progress.md). The fresh pass
re-proved the go-live independently: the committed journey 17/17 on
desktop AND the real mobile-interact button, 18 manual probes (focus trap,
keydown guard with a jump positive control, the locked-seed deny leaving
the sheet open under the sim's own toast, the ja_JP locale switch and the
relocalize arm live, knob sizing 44px and the 8.95:1 shortfall contrast
eyeball), the negative space proven by running every pin (zero golden
movement, no sim/server/wire/IWorld change, the phase LOWERED hud.ts's
ceiling), and 11/11 mutants killed named. One real behavior fix landed as
deviation (bq): the sim's dead/busy plantCrop denies ride ctx.error, not
farmDenied, and stranded the Plant control; the Hud now forwards every
error toast to the sheet's notifyErrorToast re-arm. Also: report_window.ts
(renamed under the cold-painter sweep, first direct suite), safe-area caps
on the mobile sheet, eleven hardened pins (reachability via the shared
stripComments, containment-sliced Hud glue, the journey layer-honesty
pin), and the twentieth absorb (ea9377db8e, one release i18n commit,
pending.ts regen-resolved, baselines held; hud.ts now 19352/19352 EXACT
after the (bq) forward spent the last line). Prior: Phase 9b (the bed
verbs) DONE 2026-08-18/19: the go-live is
PLAYER-COMPLETE. An ordinary player plants through the interact-key plant
sheet and harvests through the same press on desktop, touch, and gamepad;
q_farm_intro completes through the client (the committed journey
scripts/farming_journey_e2e.mjs, 17 checkpoints, no window.__game for any
verb); deviation (bn) is CLOSED and (bp) records the offer-gate refinement;
the (bg) intro-grant faucet finally has its terminator (the quest can turn
ready, so the per-talk re-grant window closes normally). Baselines held
(IWorld 329 = 88 + 241, facets 34, commands 202/215, delta keys 87,
farming_session 9a8fefa5, zero golden moves, no src/sim or server change);
hud.ts 19351/19352 after the report-window extraction funded the sheet.
Merge hash in progress.md. NEXT: Phase 10
(docs/prd/masterwrought/farming/phase-10-celebrations.md; (bo) still bounds it: nothing may
assume Highwatch or Evergarden beds are sowable until D11's bootstrap
ruling lands). Prior: the NINETEENTH ABSORB done 2026-08-18 as its own sync mid-phase
per the D22 triple-digit rule (release/v0.39.0 moved f42a67f341 to 7b45fdb9a9:
285 commits, 833 files, 168-file farming intersection; branch
fix/farming-sync-v0.39.0-r2, merge b9a025b2ee, opening Phase 9b which the
maintainer-authored starter prompt ADOPTS). Absorb facts, superseding the older
numbers below: count baselines HELD (commands 202/215, IWorld 329 = 88 + 241,
facets 34, delta keys 87); farming_session golden md5 19c49aac to
9a8fefa5e48c7e456db7ef2695bfb284 (the (am) shape again: the release's three
Highwatch practice dummies shift ids +3; rng lanes and draw counts
byte-identical); the 67 release-recorded goldens re-recorded for the branch's
+4 farmer statics, machine-classified with zero unexplained leaves; the terrain
height fixture re-recorded (the release grew the corpus +76 points; 29 moved
points, all inside the four farmer pad footprints, max 4.31 yd under Hollis);
the Eastbrook seals and the portrait manifest re-minted per (al); the release's
DelveInteriorTracker SUPERSEDES the branch's delve_interior_scheduler.ts
(reconciled toward the release mechanism, the branch module and its suite
deleted); the release's whole-slot item-lock rework rebuilt the four (ao) test
rigs (grant-around-a-lock; production spend sites unmoved); monolith headroom
after the sync heals: hud.ts 5 (19382/19387), renderer.ts 0 (13774/13774, the
merge-rule exact-count re-pin), main.ts 6 (11454/11460, lowered after the
turnstile extraction to src/game/turnstile_gate.ts), sim.ts 3 (12657/12660,
after the mech-chroma extraction to src/sim/mech_chroma_ownership.ts),
server/game.ts 109 (10791/10900). Release-hygiene flags recorded in
progress.md's sync notes (the server's hand-rolled unequip-chroma duplicate,
the unpinned release `sm` self field); the ONLINE_WORLD_LAYOUT_VERSION
go-live question joined the OPEN list. Prior: Phase 9 QA done 2026-08-17
(verdict FAIL ON THE GO-LIVE
ACCEPTANCE, SCOPE STOP: branch fix/farming-phase-09-qa off feature/farming-plan
at 2f0f2547de, merged --no-ff back as 59584a800a). Everything Phase 9
built verifies (the live-client journey walked 39 checkpoints green at all four
hubs, every vendor row purchase-tested, 16 of 16 new mutants killed, nine
lanes 0 BLOCKING on the phase's own diff), but the QA established that NO
CLIENT-SIDE PLAYER VERB PLANTS OR HARVESTS A BED (deviation (bn): plantCrop and
harvestCrop have no caller under src/ui, src/game, src/render, or src/main.ts,
and no /dev plant exists), so an ordinary player accepts q_farm_intro and can
never complete it, and the Live-surface note's "reachable by ordinary players"
is UNMET while the quest and its teaching copy are live: the half-reachable
state the packet forbids. Owner: a new Phase 9b (the bed verbs; PROPOSED in
docs/prd/masterwrought/farming/phase-09b-bed-verbs.md, maintainer adopts or strikes) BEFORE
Phase 10; the maintainer may instead re-dormant the intro quest and copy.
Second packet-level hole the QA found: (bo) tier 3 and 4 seeds have NO first
faucet (seed-back returns the SAME crop's seed and only from tier 3+ crops;
golden_harvest is a yield multiplier), so the Highwatch and Evergarden beds can
never be sown: D11 needs a bootstrap ruling. The eighteenth absorb (release
tip f42a67f341, the druid feral enablement, 5 commits, no conflicts, no
lockfile or golden move) opened the QA. Prior: Phase 9 (world presence,
GO-LIVE) done 2026-08-17 on fix/farming-phase-09-world-presence off
feature/farming-plan at 26f330cea2 (merged --no-ff back into
feature/farming-plan; hash in progress.md). FARMING IS LIVE ON THE SIM AND
THE WIRE on the merged branch: four static farmer NPCs (Farmer Jessica 'Allotment Keeper' at
Eastbrook (24.5, 32.5; re-seated to (-15.5, -81.5) at the release/v0.41.0
merge, when the rebuilt vale's second wolf run overran the north-lane site),
Farmer Teasel 'Fen Paddy Farmer' at Fenbridge (-21,
333.5) with a fenbridge_layout row, Farmer Hollis 'Highwatch Terrace Farmer'
at Highwatch (-18, 695.5), Farmer Verbena 'Parterre Gardener' at the Evergarden
parterre (348.5, 867); D17-audited real plant words, none a farmer NPC in
WoW, OSRS, Stardew, Palia, or Harvest Moon; all four `farmer: true`), vendor
stock (Jessica: vale_wheat_seed 4, brook_carrot_seed 4, brook_carrot 16,
compost 8, garden_hoe 20; Teasel: marsh_rice_seed 8, bog_beet_seed 8,
compost; Hollis and Verbena: compost only; tier 3/4 seeds, growth_tonic,
dishes, and hoe rungs 2-4 on NO counter), the intro quest q_farm_intro
'First Furrow' at Jessica (requiredItems garden_hoe + vale_wheat_seed;
objectives on the new QuestObjective 'farm' member, plant then harvest one
Vale Wheat, marker-hinted at patch_eastbrook; xp 150 / copper 50; the magic
sentence and the Harvest Journal pointer verbatim in BOTH her greeting and
the completion text), the credit arm onCropFarmedForQuests
(src/sim/quests/quest_credit.ts, called from plantCrop and all three
harvestCrop terminal branches, withered included), the 'farm' marker arm in
src/sim/quest_targets.ts (pushEnclosing over the patch beds), the husk-trade
range gate (src/sim/professions/farmer_npcs.ts nearFarmerNpc over ctx.grid,
FARMER_TRADE_RANGE = INTERACT_RANGE + 2 = 7, farmDenied 'no_farmer' appended
to the reason union) with its gossip row [data-husk-trade] in the NPC
dialog, two kitchens work orders at cook_marlow (vale_wheat x8 for 16
copper, marsh_rice x5 for 20 copper, both floor(0.5 x sell) with the
arithmetic comment), the R37 flips (deviation (bl)), the live guide page
prose, and the deliberate re-mints (68 goldens for the +4 entity-id shift,
machine-classified; the terrain atlas, the Eastbrook chunk digest, and the
four farming-zone map plates plus the world strip because every NPC is a
calm-anchor terrain pad, deviation (bh)). Golden md5 farming_session 8fe57fe3
to 19c49aac (this phase's one deliberate move after the absorb's). Reviews:
architecture 0 BLOCKING, cross-platform 0 BLOCKING (approve),
frontend-seam 0 BLOCKING (pass with follow-ups), content-obligations PASS
(no should-fix; deeds and Reliquary correctly Phase 10 / N-A),
test-coverage PASS (14/14 mutants killed after its pins), privacy-security
0 BLOCKING (ship-able; the trade-pipe note is (bg)), qa-checklist per the
progress.md record. Baselines HELD: commands 202/215, IWorld 329 = 88 +
241, facets 34, delta keys 87 (no wire member, no command, no facet member
this phase). Monolith: hud.ts, renderer.ts, main.ts untouched; sim.ts a
same-line-count comment reword (12659/12660). Deviations (bg) to (bm)
below; maintainer reads owed on (bg) and (bh). The SEVENTEENTH absorb opened
the phase (2026-08-17): merge 89030e4e0f of
origin/release/v0.39.0 tip f48c7a3a9b (80 commits, 952 files, 74-file
farming intersection; same minor version and a two-digit intersection, so
a regular absorb, not the 06b shape). Headline systems: the castles feature
(Dawnhold Castle rebuilt in Evergarden with real walkable grounds, the Last
Keep and the Ashen Bulwark in Drakelands, castle plans on the zone map,
castle-visit deeds), the icon-art deep pass (painted runtime identities,
the release_v039_icon_art seal suite), the 0.38.2 and 0.38.3 hotfixes
(resurrection range and line of sight, the Sanctum gold farm, the composer
NaN scrub), and the interior_light_rig extraction from renderer.ts. NO
server/ file moved in the delta. Conflicts (40) resolved by doctrine:
renderer.ts import block (release interior_light_rig import kept, the
delve-kit import stays dropped to the branch's delve_interior_scheduler
extraction), the renderer monolith ceiling at the exact merged count 13660
(below both parent pins, the two extractions compose), the items catalog
(dawnhold_posy ahead of the farming block, release wire tokens keep shipped
positions), the resolved i18n bundles regenerated, the char_window test
name unioned, the item art audit at the release's 823/838 with the branch's
ART-SUBJECT rule and pendingArtCount 39, the (al) evidence family and the
Eastbrook polish provenance re-minted through their CLIs on the merged
tree. Heals: d07b578e5d (the farm-props lockfile seal fired a THIRD time:
same byte-level restamp of both stamp sites in all fifteen GLBs, sizes
held, sha pins re-recorded, assets manifest regen), 58d4332993 (the
farming_session golden re-minted for the castles' one static entity: the
release re-recorded all ITS goldens for the same +1 id shift, a4124b9152;
machine-classified before minting: 111 leaves, every one an entity id +1
or a digest folding those ids, draws/drawDigest/ticks/coverage
byte-identical; md5 50a2e54c to 8fe57fe3, the (am) shape), 11e0940da0 (a
NEW (al)-class collision: the release's icon-art second pass SEALS the live
hotbar-item inventory at 72 painted, and farming's twelve hotbar-eligible
pending-art items, the eight dishes and the four hoes, failed it on the
merged tree only; the guard now applies the ART-SUBJECT rule, live minus
ITEM_ART_PENDING, with the pending hotbar count a hard literal 12 and every
pending id checked to ship no webp; the release literal 72 and the sealed
record stand byte-identical; the hotbar paints pending ids through
iconDataUrl, so no player-facing gap). Count baselines HELD: commands
202/215, IWorld 329 = 88 + 241, facets 34, delta keys 87; wiki:content and
i18n:gen byte-identical; ci:changed rc 0. Monolith headroom after the
absorb: hud.ts 5 (19483/19488), renderer.ts 0 (13660/13660), sim.ts 1,
main.ts 1, server/game.ts 104. Release-merge audit (4-lane Workflow, 4/4
delivered): overlaps CLEAN (line-level both directions), sim arms CLEAN
(updateFarming and notifyFarmReady in place, no reorder; the release's
casting_lifecycle resurrection gates inert for the FARMING_CAST_ID cast),
world content 0 BLOCKING (the Dawnhold pad x 232..300 z 854..944 is 41 yd
from the nearest Evergarden bed; the flood from Hedgewick passes with the
castle colliders in the set; the zone-map castle plans paint under the
farm badges; the release MOVED the hedge_knight camp to (306,872) r 8, 27
yd west of bed_evergarden_1: seat the tier-4 farmer EAST of the beds; the
deeds totals Phase 10 re-pins moved to 273 deeds / 3155 renown / 11
exploration titles), i18n and evidence CLEAN. Phase 9's shared shapes
landed first on the phase branch: 2953d6ccb2 the QuestObjective 'farm'
member (action plant|harvest, cropId narrowing, marker-only patchId,
harvest credits on every outcome) and 2f22f9a5e9 the NpcDef `farmer` flag.
Prior: Phase 8 QA done 2026-08-17 (PASS-WITH-FOLLOWUPS; branch
fix/farming-phase-08-qa off feature/farming-plan, merged --no-ff as
327fa964bd; next is Phase 9, world presence and
go-live, docs/prd/masterwrought/farming/phase-09-*.md starter). Phase 8 itself was done
2026-08-14 (merged --no-ff as 0f4bd59145 from
fix/farming-phase-08-harvest-journal). The Phase 8 QA round: 0 BLOCKING
across eight audit lanes; the one behavior fix is deviation (be)
(simplified-mode gathering rows so a pre-attunement farmer reaches the
journal from the professions window); the (bd) ledger line was corrected
(the zone-map sprout is oak green, the minimap's is station orange); the
four unledgered residuals are recorded at (bf); the guide controls page
gained the Shift+K row plus a BIND_ACTIONS completeness pin; and the pin
gaps the coverage lanes named are closed (settled timer arms past the
deadline, the audio route and gate, the keybind default and collision
guard, the focus no-steal arm, the two-farmer sweep order, the online
farmReady heavy-self proof over the real broadcast). Baselines held with
zero movement (202/215, IWorld 329 = 88 + 241, delta keys 87, golden
50a2e54c). The SIXTEENTH absorb ran 2026-08-15 as its
own mid-phase sync BEFORE Phase 8 QA (the D22 minor-version rule; branch
fix/farming-sync-v0.39.0, merge eaaf07f658 of release/v0.39.0 tip
d2d1a8ad5c: 320 commits, 555 files, 74-file farming intersection;
headline systems the Three.js 0.165.0 to 0.185.1 bump with the renamed
compileAsync patch, the desktop-client-update program PR 3406, the
market-house redesign PR 3376, the gate_select merged-leg rework PR 3394
with FAIL/PASS markers unchanged, the CI shard rebalance to
measured-weight LPT, arena loss honor, and the Grix respawn window plus
cat-form swing normalization with release-side golden re-records and two
new parity scenarios appended AFTER farming_session). Two heal commits:
1f97379ae6 (the lockfile-seal rule fired again: byte-level restamp of
both sourceFingerprint stamp sites in all fifteen farm GLBs, sizes held,
sha pins re-recorded, render assets manifest regen; plus the Eastbrook
polish re-mint, both parents having moved renderer.ts) and ebf3104859
(fingerprint-only portrait manifest re-mint per the (al) checklist,
registry row re-pointed). Count baselines all HELD with zero movement
(commands 202/215, IWorld 329 = 88 data + 241 method, delta keys 87,
farming golden 50a2e54c unchanged, ZERO golden moves this sync).
MONOLITH headroom after the absorb: hud.ts 0 lines (19433/19433),
renderer.ts 0 (13725/13725, the exact merged count between the parent
pins 13700 and 13754), sim.ts 1 (12659/12660), src/main.ts 2
(11488/11490), server/game.ts 104 (10796/10900): hud and renderer sit AT
their ceilings, so ANY line growth reds the ratchet and extraction-first
is mandatory from Phase 8 QA onward. Release-arm structure note: the
release split Hud.update at a paint cut ("if (!paint) return;"); code
below it runs only on painted frames, so farming timers, audio, and
state machines belong ABOVE the cut (handleFarmEvent rides handleEvents,
verified unaffected). Reviews: 4-lane release-merge-audit zero BLOCKING,
cross-platform-sync SIGNED-OFF (patch-id-verbatim on every
parity-critical file), qa-checklist READY. Two known contention flakes
recorded, both proven green standalone whole-file and filtered:
professions_farming ("plants, spends the seed") and
language_fanout_registry (the relocalize caller arm). Prior: Phase 7 QA
done 2026-08-14 (PASS-WITH-FOLLOWUPS, merged --no-ff from
fix/farming-phase-07-qa); the
FOURTEENTH absorb opened the QA round (merge
20e9b6a987 of tip 51aa4eab13: 98 commits, 225 files, roughly 60-file
farming intersection, no lockfile move; the only conflicts were the
generated pending.ts, regen-resolved, and the accepted-art registry row,
re-pointed at the CLI-re-minted portrait manifest per the (al)
checklist, which the auto-merge had reproduced byte-identically;
4-lane release-merge-audit delivered: arms/endpoints CLEAN, bindings
CLEAN, overlaps and premises FINDINGS, all healed in-branch. The
release's cheater-mark growth put hud.ts and server/game.ts OVER their
monolith ceilings on the merged tree; healed by extraction a3b5ea431b
per the (an) policy: both HEAVY_SELF policy sets moved whole to
server/heavy_self.ts and the castDisplayName mapper with its rift key
table to src/ui/cast_display_name.ts, membership pins in
tests/server/heavy_self.test.ts, ceilings untouched. gate_select gained
the manifest-freshness family this absorb; see the validation matrix
note. Count pins re-run live and unchanged: command_schema 201/214,
delta keys 87, IWorld 328 = 88 data + 240 method, facets 34; golden
f017045f unchanged; tsc clean). Phase 7 (render and juice) done
2026-08-14; Phase 7 QA runbook is docs/prd/masterwrought/farming/phase-07-qa.md.
Phase 6 QA done 2026-08-13 (merge
ae695397d1, twelfth absorb 1a5d6fd5b4 of tip b08d79ef91 inside it); the
THIRTEENTH absorb opened Phase 7 (merge a0d8ddc127 of tip 6ee7f3fd27: 4
commits, 8 files, one-file intersection at sim.ts, audit clean, no
lockfile move). Packet authored 2026-08-07 off
release/v0.36.0; the eleventh absorb was the Phase 6b big-jump sync
(absorb merge 2c26b6db7b of tip 952c183fc3: 1453 commits,
2376 files, 117-file farming intersection; headline systems the Reliquary
facet and catalog, the owned-classes overhaul with warlock pets, the
Thornhollow Fields battleground, the map marker overhaul, the player item
lock, civic service anchors, the three.js audit batch, and the monolith
line-count ratchet tests/monolith_budget.test.ts). Count-pin baselines as of
the eleventh absorb, all re-recorded from suite runs on the merged tree:
command_schema 202/215 send/dispatch after the fifteenth absorb (the
release's market_sell_price_check pair on top of the branch's three), delta
keys 87 (fplot stays the branch's own), facet count 34; IWorld members 329
(88 data, 241 method): Phase 7's farmNowMs (deviation (ap)) plus the
release's marketSellPriceCheck. The farming-only baselines held with zero
movement: FARM_MATERIAL_ITEM_IDS 27 exact, ITEM_ART_PENDING 39 exact,
farming.ts silent-loot grant sites 6, blob floor/ceiling pins unchanged.
The farming_session golden has moved deliberately TWICE: once for the
release's sampled reliquary field (deviation (am), md5 f017045f), and once
in Phase 8 for the appended ready-notice beat (isolated commit; md5 is now
50a2e54c3e809a1a4aa0ecf99ea43c5f). The tenth absorb 7ce12bad9e opened Phase 6
(v036 artwork overhaul, rift boss parity scenario, Evergarden east-edge
terrain); the ninth 6e1ead1fea opened Phase 5 QA; the eighth 5819c005a7
opened Phase 5 with the lockfile-driven seal re-mint. NOTE for any farming
GLB work (Phase 13 art): fingerprints must be minted against the
pnpm-lock.yaml the SIXTEENTH absorb brought (the v0.39.0 lockfile carrying
the three-0.185.1 bump; re-pointed at the sixteenth absorb from the
eleventh's v0.38.0 lockfile, which that absorb had left operative), or the
asset suites red. History: the eleventh absorb needed NO seal re-mint (the
merge took the release's lockfile byte-identical and the release delta
carried its own coherent seals); the fifteenth and sixteenth both moved the
lockfile and both fired the branch-only farm-props re-mint (the release can
never re-mint a branch-only seal).
Working tree: ALL farming work happens in the persistent worktree
`~/Documents/woc-farming-plan`. Other sessions share the main checkout; never work there.

## Phase 13 handoff: MAINTAINER GATES and the full deferral ledger (2026-08-19)

Compiled by the Phase 13 integration sweep (Lane C) from every progress.md
Notes block, the deviation ledger (a) through (ca), the Phase 12 QA residual
block, and the OPEN list. This table is the ONE collection point; the source
entries stay authoritative for detail. Statuses: open ruling-owed,
deferred-to-release-fill, accepted-no-action, handed-to-maintainer,
closed-by-X.

### MAINTAINER GATES (read these first)

1. THE (ca)/D11 RULING GATE, blocking any release merge: THREE advertised
   reagent-dormant recipes (the tier-3 buff dish highwatch_barley_porridge,
   the tier-4 buff dish evergarden_braised_greens, and the harvest feast
   recipe_harvest_feast) are trainer-visible rows no player can complete,
   because tier 3/4 produce has no first faucet (deviation (bo): the
   seed-back roll returns the SAME crop's seed and only from tier 3+ crops;
   golden_harvest is a yield multiplier, not a seed). The D11/(bo)
   seed-bootstrap ruling (four options in the OPEN list below) MUST
   explicitly cover all three rows BEFORE this branch ever merges to a
   release, or they ship after D11. prog_farming_100 and (transitively)
   feat_book_complete stay parked on the same ruling under the (bs) waiver.

2. THE MAINTAINER READS OWED (detail at each ledger letter): (a) the
   PENDING_ART allowlist sign-off; (w) the structural affinity exemption
   (standing since Phase 4, now 27 materials); (al) the art-suite guard
   extensions plus the sharpened bundle-hash renderer/content split; (ap)
   the farmNowMs facet member; (bb) the linkdead notice loss; (be) the
   simplified-mode gathering rows; (bg) the intro grant fence, its
   trade-pipe leak, and the garden_hoe reagent knock-on; (bh) the
   NPCs-are-terrain calm-pad rule; (bs) the dormant-deed waiver plus the
   D12 golden-harvest cadence read (1/90 per harvest times survival). The
   tuning reads: feast charges 10 / durationTicks 3600 (180 s) / trainer
   fee 10000 / sellValue 250; the Phase 11 well-fed magnitudes 3/600s,
   6/900s, 9/900s, 12/900s with the capstone-at-elixir-ceiling and the
   24-stamina food-plus-elixir stacking read (cheap lever: capstone to 9 or
   10) plus the tier 2 to 4 stat-identity and tier-1 inversion addendum;
   seed-back rates 0.08/0.40 tier 3 and 0.06/0.35 tier 4; compost 2 sell /
   8 buy with FARM_HUSKS_PER_COMPOST 2; growth tonic 6 sell-only; watch
   fees 2/3/4/6; the tier-3 rung-50 domination and tier 4 shipping quality
   rare; (ai) the tonic as the cheapest rung-0 alchemy skill-up; (aj) the
   2500/10000 trainer fees on reagent-dormant rungs; the crop and hoe
   display-name lore passes; the fine-twin buyValue doctrine intersection;
   the fine_marsh_rice / fine_highland_barley dish-consumer question; the
   farming-counts-toward-any-profession-deeds default; the
   ONLINE_WORLD_LAYOUT_VERSION epoch call at go-live; the renderer.ts
   exact-count ceiling re-pin prepared at the nineteenth absorb; the
   q_prof_intro overflow-grant template (17/16 bags); the second v0.39.0
   deed-locale fill pass (15 manifest rows); the Steam/Epic achievement
   mapping. The sim.ts comment-compression ratchet read from Phase 12 is
   DISCHARGED by the Phase 13 M5 extraction (ceiling 12660 lowered to
   12249); recorded here as such, no read owed anymore.

3. THE ART BATCH HANDOFF. The deliverable here is THIS LEDGER, never
   generated art: committed item art demands the maintainer's master SHA
   (the profession_icons E2 rule). The batch: ITEM_ART_PENDING at 44 ids
   including harvest_feast; the gather_farming profession icon behind (a);
   a bespoke wellfed aura icon (the aura_buff_sta fallback serves today);
   the icon cross-family reads (highwatch_barley_porridge paints a potion
   primary and reads as alchemy, fenbridge_rice_pudding a coin primary and
   reads as currency); the four hoe icons alike-at-32px eyeball; the
   glazed-carrots-vs-pottage 32px eyeball (shared palette and glyph set);
   the painted map-pin MapMarkerArtId with the (bd) per-surface pin-color
   unification (oak on the zone map, station orange on the minimap); the
   growth_tonic sparkle-overlay glyph-semantics note; the farmer NPC voice
   lines (VOICE_ALIAS rows only; scripts/gen_npc_lines.mjs is the
   follow-up; the LOOK rows were CLOSED by the nineteenth-absorb npc_looks
   heal); the src/ui/icons.ts ITEM_ART_PENDING rationale comment sweep (it
   still says "no faucet until go-live" for compost; DISCHARGED at the
   Phase 11e QA, which rewrote the block as the honest scheduled-ART-PARK
   rationale, icons.ts:5763, verified again by Phase 16 on 2026-08-29);
   DEED_ART_PENDING at
   8 untitled deeds plus the commissioned prog_farming_100 crest
   replacement (docs/achievements/icon-brief.md); the Phase 11 buff-bar
   and tooltip capture offer; the A4 pairwise-distinctness pin extension
   across every procedurally-resolving id when the first debt id leaves
   the pending set; the 10 to 11 px mobile chip legibility revisit
   ((bf)(4)).
   RULED (qr-19-art-batch-ledger, 2026-09-01, under qr-19-best-for-project):
   SCHEDULED. The art wave runs as the maintainer's own pass on his master
   SHA after the merge, and THIS LEDGER stays the deliverable. Nothing in
   this branch mints art: the profession_icons E2 rule puts committed WebP
   behind that SHA, so both parks stay exactly as they are, because the
   parks themselves are what is being handed over. No code, no pin, no
   generated artifact and no test moves under this ruling, and R5 is
   untouched.
   WHAT THIS ONE ID SETTLES, said plainly so the wave does not end up with
   four ruling ids on it: the routed-out rows D015 (the prog_farming_100
   Harvestmaster crest), D025 (the painted farm map pin) and D095 (the 81
   parked item ids) are the SAME wave seen from three ends, and they fold
   into this scheduling rather than taking rulings of their own.
   AMENDED IN PLACE, 2026-09-01, re-derived from the live tree rather than
   rewritten. The "44 ids" figure above reads 81 today: the
   ITEM_ART_PENDING export in src/ui/icons.ts enumerates 81 ids and the
   IGNIVAR_ART_PENDING_ITEM_IDS list it spreads in first is empty, so the
   81 are the whole set. The "8 untitled deeds" figure reads 20, the row
   count of the DEED_ART_PENDING export in the same file; the commissioned
   prog_farming_100 crest replacement beside it stands as written.
   AMENDED IN PLACE, same date: "the four hoe icons" reads five. Phase
   11j's evergarden_hoe joined garden_hoe, bronze_hoe, skysilver_hoe and
   osmium_hoe, each of the five carries its own authored icon recipe, and
   all five park here.
   AMENDED IN PLACE, same date: the rationale-sweep address moved. The
   rewritten scheduled-ART-PARK paragraph now sits at src/ui/icons.ts:5808
   to 5815 rather than at the line cited above, and "no faucet until
   go-live" no longer appears anywhere under src/, so that sub-item stays
   DISCHARGED.
   THE WAVE IS NOW WIDER THAN THIS PACKET, which is what matters to whoever
   sizes it. Ten of the twenty deed rows are not farming's:
   exp_the_last_keep and exp_dawnhold_castle (the walk-in castle pair),
   soc_strongbox_outfitter and soc_four_bags_deep (bank storage),
   prog_ready_for_an_adventure, and the five Crucible rows dgn_ignivar,
   dgn_ignivar_heroic, dgn_varkhul, dgn_varkhul_heroic and
   dgn_varkhul_flawless. All ten are release-owned debt, parked correctly
   by the same rule and NOT packet obligations, but they are ten more
   paintings in the same sitting. The packet's own ten are
   prog_first_planting, the four first-harvest chronicles (chr_vale,
   chr_marsh, chr_peaks, chr_evergarden), col_golden_harvest,
   col_deepest_cast, col_farm_roster, prog_field_to_feast, and the Phase 13
   promotion capstone prog_legendmaker, which is the packet's row and not
   the release's.
   THE JUDGMENT SUB-ITEMS RIDE THIS LINE so the scheduling does not lose
   them: the cross-family icon reads (highwatch_barley_porridge takes a
   potion primary and fenbridge_rice_pudding a coin primary, both confirmed
   live in the icon recipes), the alike-at-32px hoe eyeball across all five
   rungs, the glazed-carrots-vs-pottage eyeball (both sit on the food
   radial in the ember palette and the pottage's second glyph is the
   carrots' first, so the worry is real), and the map pin, which per D025
   is now the painted MapMarkerArtId ALONE: the Phase 18 sweep already put
   both surfaces on the station family token (colors.stall in
   map_window_painter.ts, colors.station in minimap_painter.ts), so the
   color half is closed and only the art remains.

### The handoff table

| Item | Phase | Owner | Status |
|---|---|---|---|
| D11/(bo) tier 3/4 seed bootstrap; must cover the three (ca) dormant recipes (porridge, braised greens, harvest feast) | P9 QA / P11 / P12 | maintainer | CLOSED 2026-08-21 by masterwrought Phase 11e (GATE 1 discharged). All eight tier 3 and 4 seeds are vendor-stocked at farmer_hollis and farmer_verbena with positive buyValues (32 / 64, DECISION D). All three (ca) dormant recipes are reagent-reachable and proven so end to end in tests/farming_gate1_faucet.test.ts, which buys, plants and harvests through the real commands rather than reading this row. prog_farming_100 and feat_book_complete are earnable; the docs/design/deeds.md dormancy waiver is closed; the (bo) honesty arm self-cleared and was INVERTED, so it now fails if the faucet is ever removed. |
| (bs) dormant-deed waiver (prog_farming_100, feat_book_complete) plus the D12 cadence read | P10 | maintainer | CLOSED 2026-09-01 by ruling qr-19-farming-100-dormancy-waiver (Phase 19, under qr-19-best-for-project), both halves. The waiver record is RATIFIED: docs/design/deeds.md already carries the CLOSED 2026-08-21 stamp, both counters stock their tier's seeds, prog_farming_100 and feat_book_complete are earnable, and the honesty arm was INVERTED rather than deleted. The D12 cadence read is TAKEN, not deferred: 1/90 per harvest times a survival of 0.85 at the tier gate rising to 1.00 a band above it is one golden per 90 to 106 harvests, about 14 to 17 across the reference climb of 1500 harvests over 74.00 days, one roughly every 4.4 to 5.2 days. Confirms the D12 premise: rare on the wall clock by design under R19. Full derivation on the (bs) block. |
| (a) PENDING_ART allowlist sign-off (gather_farming, self-clearing) | P1 | maintainer | open ruling-owed |
| (w) structural affinity exemption, 27 materials (standing since Phase 4) | P4 / P5 | maintainer | open ruling-owed |
| (al) art-suite guard extensions plus the bundle-hash renderer/content split | P6 / P6 QA | maintainer | PARTLY CLOSED 2026-09-01 by Phase 19 ruling qr-19-art-suite-guard-extensions: the guard-extensions half is RATIFIED as shipped. The ART-SUBJECT rule and the bookkeepingOnly receipt-free refresh stand exactly as written, each policed in both directions and each self-clearing when the art wave lands; refusing them is blocked behind that same parked art wave and by the seventeenth-absorb rule (never a raised release literal, never a gutted arm), and the release has since adopted the same mechanism on its own content side (IGNIVAR_ART_PENDING_ITEM_IDS). Ratification BINDS the standing obligations: both CLIs re-run after every absorb and every sim-content phase, manifest and verdict conflicts resolved by re-running on the merged tree, the same ART-SUBJECT split for any future release seal, and the three literals (catalogCount 1125, liveItemCount 1140, pendingArtCount 81) re-minted at every content move. The row's other half, the bundle-hash renderer/content split, is answered under qr-19-portrait-bundle-hash-split (D029) and folds into this cell in the same edit. |
| (ap) farmNowMs facet member (re-argued KEEP at P7 QA) | P7 | maintainer | CLOSED 2026-09-01 by Phase 19 ruling qr-19-farmnowms-facet-member: KEEP ratified as shipped, together with the two acceptances the Phase 7 QA recorded under it (online, a fast client wall clock can paint the stage4 looks-ready mesh before the authority flips status, and the harvest then refuses not_ready; withered surfaces online only when the heavy-gated fplot re-diffs). Nothing moves: no code, no pin, no golden, and the member stays an untagged read with no wire field. Unwinding it would force either a Date.now read the CLOCK-BASE CONTRACT forbids on the offline and headless hosts or an unscoped nowMs seam, and capping the fraction path at stage3 stays rejected because it would put a host-dependent branch into a pure render core and lag the ready mesh for every online player. |
| (bb) linkdead transient-notice loss acceptance | P8 | maintainer | open ruling-owed |
| (be) simplified-mode gathering rows (a Professions 2.0 surface change) | P8 QA | maintainer | CLOSED 2026-09-01 by qr-19-simplified-gathering-rows: the shipped worked-rows shape is RATIFIED as written, no code change. Skill-0 rows stay hidden so a fresh character's window is unchanged and both modes paint through the one gatheringSectionHtml builder; narrowing to the Farming row or reverting to CTA-only would take back the only journal entry a pre-attunement touch farmer has, the (az) reachability defect this deviation closed. |
| (bg) intro grant fence, trade-pipe leak, garden_hoe reagent knock-on | P9 | maintainer | CLOSED 2026-09-01 by ruling qr-19-intro-grant-fence-trade-pipe (Phase 19, under qr-19-best-for-project): the leak is ACCEPTED AND RECORDED and the face-to-face trade guard is NOT extended. Barred rather than deferred: CLAUDE.md's default task workflow says 'Preserve existing behavior unless the goal explicitly requires changing it' and 'Avoid unrelated refactors. Keep the diff scoped to the task', and src/sim/social/trade.ts fences every requiredItems item in the game, so the change would land general trade behavior this packet's goal never required. On the merits too: the ledger sizes the leak at 4 copper per cycle and calls it a balance leak, not a security hole, while extending the guard would cut the last cooperative route for the garden_hoe crafting reagent and make the bronze-hoe path worse. Full ruling line on the (bg) block. |
| (bh) NPCs-are-terrain pad rule (Highwatch eyeballed, no re-seat) | P9 | maintainer | open ruling-owed |
| Well-fed ladder magnitudes: capstone at the elixir ceiling, 24-stam stacking, twins stat-identity, tier-1 inversion, unanchored raid-floor phrase | P11 / P11 QA | maintainer | CLOSED 2026-08-21 by decision 2 (11c-D-2), executed in MW 11c: farming rungs 2/3/4/5 at 600s, apex plates 6/900 (derived: entry value; entry duration plus the elixir ladder's own 300s step); one 'well_fed' id retires the stacking read (dish plus elixir tops at 17) and resolves the tier-1 inversion at 2; the raid-floor phrase is anchored by the untouched R5 kit arithmetic (flask 15 plus food 6 equals 21) |
| Feast tuning: charges 10, 180 s, trainer fee 10000, sellValue 250, reagents x4/x4/x2 | P12 | maintainer | open ruling-owed |
| Seed-back rates 0.08/0.40 tier 3, 0.06/0.35 tier 4 (economy-sensitive) | P5 | maintainer | open ruling-owed |
| Watch fees 2/3/4/6, compost 2/8, FARM_HUSKS_PER_COMPOST 2, tonic bonus 0.5/2 | P4 | maintainer | CLOSED 2026-09-01 by qr-19-watch-fees-compost-husks-tonic: all four RATIFIED as shipped, no retune. Re-read live at the close (fees 2/3/4/6 in farm_watch_fee.ts, compost 2 sell and 8 buy in items.ts, FARM_HUSKS_PER_COMPOST 2 and the tonic 0.5/2 in farming.ts), and no QA or economy sweep in the packet has filed a finding against any of them; a retune would move the dish-assignment curve-point reuses for no recorded gain. |
| Growth tonic 6 sell-only plus (ai) cheapest rung-0 alchemy skill-up ruling | P4 / P6 QA | maintainer | open ruling-owed |
| (aj) 2500/10000 trainer fees on reagent-dormant rungs | P6 QA | maintainer | CLOSED 2026-08-22 by masterwrought Phase 11f, from BOTH ends and neither of them a ruling. The addendum asked why the rung-25 and rung-50 rows charged for dishes nobody could cook. Phase 11e retired the dormancy by stocking all eight upper seeds, and Phase 11f moved every one of the formerly dormant priced rows off the trainer entirely (rung 75 and above is a drop and charges nothing, in advance or otherwise). What still pays the tier-2 fee is the held bannock at rung 50, which is no longer dormant, so the premise is gone rather than accepted. Pinned both ways in tests/farm_recipes.test.ts: the on-ramp still trains at its fees, and every flipped row is REFUSED at a counter even at cooking 100, so the refusal is provably about the channel and not a skill gate. |
| Tier-3 rung-50 domination (three rungs for four tiers); tier 4 quality rare | P6 / P11 | maintainer | PARTLY CLOSED 2026-08-22 by masterwrought Phase 11f (11f-GATE-A): the domination half is gone. The ladder is band-complete at 0:4, 25:3, 50:1, 75:2, 100:4, so four crop tiers now have five cooking rungs rather than three, pinned in two arms (the exact derived map, plus a non-emptiness arm over every band from 0 through 100 that keeps biting if a later phase adds a row at 125). The tier-4 QUALITY half stays open and deliberately untouched: 11c owns the power ladder and R5 is measured against it, so the rung-100 farm dishes read a lower quality than the apex consumables on the same rung, which is recorded rather than fixed. NOW FULLY CLOSED 2026-09-01 by qr-19-tier4-dish-quality-rare: the quality half is ACCEPTED on the record, no def edit. Measured at the close, the rung-100 farm dish is rare at 5/600s and foodHp 980 while the apex plates are epic at 6/900s and foodHp 1392, so quality tracks power and the split is the classic-era convention working; raising the farm label departs from that pillar and lowering the apex label moves the frozen 11c surface R5 measures. |
| Dish foodHp/sellValue assignments and reagent counts (all curve-point reuses) | P6 | maintainer | open ruling-owed |
| Crop durations (5-minute sibling gap advisory), gain schedule, survival endpoints, pick floor/cap | P3 / P5 | maintainer | CLOSED 2026-09-01 by ruling qr-19-crop-durations-gain-survival (Phase 19): every constant on this row is RATIFIED AS SHIPPED and none moves, under the maintainer's standing qr-19-best-for-project direction. A re-tune is BARRED rather than merely costed, and this says so plainly instead of dodging the price: the direction names no number, CLAUDE.md rules that gameplay math follows real classic-era formulas and that we do not invent balance numbers, and the Phase 19 charter rules that no decision is guessed, so a session-authored value would be an invented one. What was checked in the live tree and found already coherent: the 5-minute sibling-gap advisory holds at its tightest point (tier 2 at 130 and 135 minutes is exactly 5; tier 1 is 10, tier 3 is 10, tier 4 is 15), FARMING_GAIN_SCHEDULE is dyadic-exact at 0.25, 0.125, 0.0625 and 0.03125 against the frozen 25/50/75/100 boundary column, FARM_SURVIVAL_AT_GATE is 0.85 ramping to 1 across the 25-point band so one full band above the gate retires a crop's risk, and the yield bounds are FARM_HARVEST_LIFE_FLOOR 3 with FARM_HARVEST_PICK_CAP 12 bounding the loop rather than the payout. The gain-schedule half of this row is ratified again on its own basis under qr-19-farming-gain-schedule-ratification and the two answers agree. Any future re-tune must arrive as the maintainer's own numbers. |
| Crop display names lore pass (D11 ids locked) | packet | maintainer | CLOSED 2026-09-01 by ruling qr-19-crop-display-name-lore-pass (Phase 19): the shipped English crop names are RATIFIED and no name moves, under the maintainer's standing qr-19-best-for-project direction. THE SEEDED FIGURE WAS STALE and is corrected here rather than rewritten: the item read eight crop display names, but Phase 11e widened tiers 3 and 4 to four crops each, so the roster is TWELVE and the lore pass covers 36 item names (seed, produce and fine twin per crop). A rename is BARRED in-session rather than merely costed: CLAUDE.md rules that contributors add ENGLISH only and never edit the src/ui/i18n.locales/ overlays, so a reworded English name cannot carry its non-Latin fills in the same change, and a reword leaves an already-translated row translated with M16 staying green. That is the same invisible staleness class the toolsNoteThreeRods row on this table records. All 36 names are filled today in ja_JP, ko_KR, ru_RU, zh_CN and zh_TW, so a rename would silently strand those fills for a cosmetic gain, which is the opposite of what the directive asks. Checked and left as shipped: the twelve names hold one two-word qualifier-plus-plant idiom (Vale Wheat, Brook Carrot, Marsh Rice, Bog Beet, Highland Barley, Frost Gourd, Thornpeak Cabbage, Frost Lentils, Gilded Sunmelon, Evergarden Greens, Gilded Yam, Evergarden Pumpkin), and no id moves under D11. |
| Hoe display names (Skysilver/Osmium compressed coinages) and prices | P5 | maintainer | CLOSED 2026-09-01 by ruling qr-19-hoe-display-names-prices (Phase 19, under qr-19-best-for-project): names and prices RATIFIED as shipped, no lore pass and no re-price (verified live in src/sim/content/items.ts: Garden Hoe 4 sell / 20 buy, Bronze Hoe 10, Skysilver Hoe 25, Osmium Hoe 60). The P5 flag's own reason is amended in place in farming/progress.md: since Phase 11j added evergarden_hoe the ladder is five rungs against the picks' five, not four, so the compressed coinages are a register the tool family shares rather than an artifact. A rename would churn every pinned literal, owe non-Latin fills and a wiki regen for pure flavor; a re-price would ripple into the P5 and P7 economy pins. |
| Fine-twin buyValue doctrine intersection (priced tier-4 twin above unpriced tier-4 seed) | P5 QA | maintainer | CLOSED 2026-08-21 by masterwrought Phase 11e: the intersection was the tier-4 SEED being unpriced while its fine twin carried a buyValue. GATE 1 priced every tier 3 and 4 seed (DECISION D, buyValue 32 and 64), so the inversion is gone and the doctrine is uniform: seed, produce and fine twin all price on the shipped four-times-sell staple, with the seeds carrying the bootstrap premium on top. Nothing is left to rule. |
| fine_marsh_rice / fine_highland_barley dish consumers (hoe-reagent-only today) | P6 | maintainer | open ruling-owed. STILL OPEN and unchanged after masterwrought Phase 11j, recorded so the apex rung is not mistaken for having closed it: 11j added a THIRD hoe-reagent twin, `fine_evergarden_greens`, and that one is NOT hoe-reagent-only (it already carried two dish consumers, so it is deliberately double-booked). These two remain the only twins whose sole consumer is a hoe rung. What 11j DID change is the partition that used to be asserted around them: `tests/farm_recipes.test.ts` no longer claims a hoe twin has no dish slot, because the apex rung consumes a tier-4 twin and Phase 11h had already given every tier-4 twin a dish, so exclusivity became impossible rather than merely untrue. The load-bearing half is kept and widened: every twin must have a consumer by SOME route, asserted over the whole twin column |
| Farming counting toward any-profession deeds (default yes, automatic) | P1 | maintainer | CLOSED 2026-09-01 by ruling qr-19-farming-any-profession-deeds (Phase 19, under qr-19-best-for-project): the default is ACCEPTED and farming keeps counting, including the Master Gatherer trigger. Verified live rather than taken from the record: 'farming' is a member of GATHERING_PROFESSION_IDS and the count-based gathering trigger in src/sim/deeds.ts filters that roster, so the credit is data-driven with no farming special case, and prog_master_gatherer's desc is already count-free and roster-free. Nothing was built; a carve-out would need a trigger exclusion plus pin and wiki rework and would retroactively strip earned credit. Full ruling line in the OPEN items section. |
| Gathering wiki tools note: five stale non-Latin fills after an English reword (`guide.profPages.toolsNoteThreeRods`) | P11j QA | maintainer | open ruling-owed. The masterwrought Phase 11j QA corrected the English of the note that renders above the tool table on EVERY gathering page, because on the FARMING page it said each land trade has two crafted tools, that every character knows the land recipes (all four hoe rungs are `acquisition: ['trainer']`), and that the land trades' top tools buy no access (planting a tier-N bed needs a tier-N hoe). Corrected in the English catalog only, per the contributor rule that a contributor never edits `src/ui/i18n.locales/`. THE EXPOSURE IS THAT NO GATE CAN SEE IT: a reword leaves a translated row translated, so `ja_JP`, `ko_KR`, `ru_RU`, `zh_CN` and `zh_TW` still carry the retired claims and M16 stays green. Either re-fill those five at release or rule that the key is re-keyed so the pending machinery catches it. The fifteen Latin locales were pending and were re-English-filled by the regen |
| ONLINE_WORLD_LAYOUT_VERSION epoch bump at farming go-live (dated note 2026-08-30: the epoch has since moved repeatedly and reads 26 after the eighth v0.41.0 sync, which renumbered the branch's 12 past the release's raid ladder 13 to 25; the go-live question this row records stands unchanged) | 19th absorb | maintainer | open ruling-owed |
| renderer.ts exact-count ceiling re-pin (13774) prepared for feature review | 19th absorb | maintainer | CLOSED 2026-09-01 by qr-19-monolith-ceiling-repin, widened to cover hud.ts: the exact-count posture is KEPT and no margin is minted (root CLAUDE.md's ratchet: never grow a coordinator, extract then lower, and a raise is a maintainer decision). Figure amended in the same ruling rather than rewritten: 13774 is stale; at the Phase 19 close renderer.ts pins 13023 against a file of 13020 and hud.ts pins 18728 against 18708, so the slack is three and twenty lines, not zero. |
| q_prof_intro requiredItems overflow grant on a full bag (17/16 visible) | P9 QA | maintainer | open ruling-owed |
| Journey script joins the gate when the merged Masterwrought PR ships (reworded at the 11b absorb: D22 is superseded, delivery is the one Masterwrought PR, and the script stays off CI until that ships) | P9b QA | maintainer | open ruling-owed |
| Tier-4-to-tier-1 wellfed downgrade legibility (buff hover is the one surface) | P11 QA | maintainer | open ruling-owed (optional) |
| (bq) residual: online pendingSend stranding on a silently dropped command (spectate/reconnect), family-consistent | P9b QA | maintainer | open ruling-owed (optional) |
| CRITICAL preload lane for the 12 crop-stage GLBs (background-lane split invited) | P7 QA | maintainer | CLOSED 2026-09-01 by Phase 19 ruling qr-19-crop-glb-preload-lane: the single CRITICAL lane STANDS and the background-lane split is refused. Measured here, the 12 stage GLBs are 155,356 of the farm set's 208,200 bytes, local bundle files fetched after Play behind the loading screen, nowhere near the launcher-decode class the two lanes exist for; against that, a split would stage buildFarmProgramAnchors off the primitive-box fallback and move the first crop draw's compile on-frame, the exact hitch the anchors exist to prevent, and re-anchoring when the lane settled is a new GPU producer that src/render/CLAUDE.md requires to be a client of the preparation scheduler, never a free draw. The lane mechanism itself is gone (the v0.41.0 sync deleted DeferredPreloadPriority and beginBackgroundPreloads, carried as two written census deletion rows), so re-introducing it would also owe a census edit. No code, pin or doc moves. |
| Idle sway ignores reducedMotion (foliage precedent) | P7 QA | maintainer | open ruling-owed (glance) |
| Phase 9 farmer titles and greetings as authored | P9 | maintainer | CLOSED 2026-09-01 by ruling qr-19-farmer-titles-greetings (Phase 19, under qr-19-best-for-project): signed off as authored, no reword. All four titles ship in content (zone1.ts, zone2.ts, zone3.ts, evergarden.ts) and each names its own zone's real geography; the four ids are in the localized set in src/ui/world_entity_i18n.ts and every non-Latin locale already carries a real translated name, title and greeting. A reword would only restale reviewed overlay prose and the wiki for flavor. The full ruling line sits on the Phase 9 reads bullet in the OPEN items section. |
| p99 blob-size gauge in the perf heartbeat | P3 | maintainer | handed-to-maintainer |
| AURA_VISIBLE_CAP_LOW = 8 self-buff cap fairness (pre-existing, not farming's) | P11 QA | maintainer | handed-to-maintainer |
| The art batch ledger (gates block item 3: ITEM_ART_PENDING 44 (AMENDED 2026-09-01: reads 81 live in src/ui/icons.ts), wellfed aura icon, cross-family icon reads, hoe 32px, carrots-vs-pottage, pin art plus (bd), tonic sparkle, voice lines, icons.ts comment, DEED_ART_PENDING 8 plus crest replacement (AMENDED 2026-09-01: reads 20 live, ten of the twenty release-owned), chip legibility) | P4 to P12 | maintainer art pass | SCHEDULED 2026-09-01 by qr-19-art-batch-ledger: the wave runs on the maintainer's master SHA after the merge; stays handed-to-maintainer as his queue item |
| CI shard-weights harvest re-run at go-public (scripts/ci_shard_weights_harvest.mjs) | 16th absorb | go-public session | handed-to-maintainer |
| gatherDowngrade surface union gains 'crop' (silent signature truncation on full-bag golden wins) | P10 | later phase | closed-by-Phase-14 (item B9: union member, farming.ts emit at the golden grant site, once per harvest command across both grades, always lost 'mark' under nothing-rots; the client resolves the toast off lost plus surface through the one gathering_view dispatch, and the crop surface carries its OWN mark line downgradeMarkCrop with five M16 fills (the qa-checklist's copy finding: 'the find' is prospecting vocabulary and read wrong for a grown harvest); zero golden movement, whole parity directory re-run green) |
| Mobile-window-open body-class gap (harvest journal and plant sheet, family-wide) | P9b QA | Phase 13 polish | closed-by-Phase-14 (item A1: both windows gained the family onVisibilityChange dep fired on both display flips, Hud wires it to syncAnyWindowOpenState at both composition sites; funded by extracting the whole body-class scan to src/ui/window_open_state.ts with the hud ceiling LOWERED 19214 to 19186 and the three source-pin suites re-pointed; behavioral class-flip proof plus the wiring pin in tests/farming_windows_body_class.test.ts; mobile landscape shots in the phase evidence commit) |
| A11y polish batch: seed rows aria-pressed vs radiogroup, in-flight aria-busy, journal ready aria-live, WCAG label-in-name husk aria | P8 to P9b QA | a11y batch | closed-by-Phase-14 (item A4: seed rows are a radiogroup named by the dialog title with role=radio aria-checked rows and presentational li wrappers, locked rows in their own plain list; pendingSend mirrors onto the root's aria-busy through the one setter; the journal gained a persistent in-dialog role=status line announcing ready flips with the readyAnnounce key and five fills; the husk aria pair reworded so the accessible name contains the visible label verbatim in English AND all five non-Latin fills, containment pinned per locale through the real sink; axe green over the live radiogroup, busy, and announcing trees) |
| countRawInSlots fifth src/ui copy plus the distToBed comment-contract mirror (need src/sim edits) | P9b QA | later farming phase | closed-by-Phase-14 (item B7: countRawInSlots exported from src/sim/item_lock.ts beside its unlocked twin, Sim.countItem delegates to it, the five src/ui copies collapsed onto it, the two domain-named wrappers tradeOfferCeiling and totalHeldCount are thin aliases; distToBed exported from farming.ts and consumed by the farm_bed_interact mirror, import pinned) |
| Style batch: .ps-seed raw rgba, the report window #ffd100 literal | P9b QA | Phase 13 style batch | closed-by-Phase-14 (item A2: .ps-seed rides var(--color-bg-input), the token its sibling .ps-knob already used; the report submitted line logs in 'var(--gold)' with the suite pin re-pointed; no new scrim token minted, deliberately, per the #1788 no-piecemeal-re-land rule) |
| useItem feast arm ignores the validated slotIndex (thread like consumeOneUnit if provenance lands) | P12 QA | Phase 13 polish | closed-by-Phase-14 (item B6: placeFeastAction takes the validated slotIndex and consumes the CLICKED slot via consumeSelectedInventorySlot, the consumeOneUnit thread; a named locked copy denies as locked instead of spending a spare, the per-copy addressing rule; the dedicated place_feast command stays the byte-identical id-only lock-aware walk; two-stack and locked-named proofs plus the direct stale-selection defensive arm in tests/professions_feast.test.ts; REACHABILITY SCOPE recorded by the Phase 14 reviews: no shipped UI gesture passes a slot for the feast today, so the named-copy semantics are protocol hardening on the use-frame path, identical in both hosts; the bags-click divergence is the open row below) |
| Bags feast click carries no copy ref: bags_view classifies a feast as the payload-free placeFeast verb in BOTH worlds, so clicking a specific (e.g. locked) feast stack still spends the id-only walk's pick; honoring the clicked copy there means widening IWorld.placeFeast and the place_feast wire command with a slot, a protocol change beyond Phase 14 polish (arch + parity reviews, 2026-08-20) | P14 reviews | later phase / maintainer | open |
| Plant sheet radiogroup roving tabindex: the APG pattern wants arrow keys moving selection within one tab stop; today every radio is its own tab stop (natively tabbable buttons, Enter/Space picks). AMENDED 2026-08-21 (Phase 11d QA release-merge audit): the deferral's stated reason, "so the keydown-guard pins stay untouched", is SUPERSEDED. Those pins moved at the v0.40.0 sync of release tip 35a6481825: the guard is now `bindChromeButtonKeyGuard` in `src/ui/pointer_blur.ts`, its root list is `CHROME_GUARDED_PANELS` in `src/ui/chrome_focus_wiring.ts`, and this branch's own pin was re-pointed at that seam. The part that actually matters for whoever picks this up: both farming roots now ALSO carry `bindPointerBlur`, so a MOUSE click parks focus on the window root and `captureFocusKey` returns null on that path. A roving-tabindex implementation that assumes a mouse click leaves the clicked radio focused will be wrong. Verify against `tests/farming_plant_sheet_window.test.ts`'s pointer-drop arm before designing the pattern | P14 reviews | a11y refinement, later phase | open |
| Bags feast hint says "Click to use" for a placement; a "set out" key needs M16 fills | P12 QA | Phase 13 polish | closed-by-Phase-14 (item A3: itemUi.tooltip.clickSetOut with the five M16 non-Latin fills in the same change, the feast branch in bags_view.ts returns it, pinned by literal on both the fixture and the real harvest_feast def, i18n artifacts regenerated) |
| Nameplate feast row INTERACT_RANGE + 1 hysteresis pad; comment overstates "close enough to eat" | P12 QA | Phase 13 polish | closed-by-Phase-14 (item C11: the comment now states the real pad, one yard past the bite gate as deliberate hysteresis, and the exact boundary is pinned both sides in tests/nameplate_view.test.ts) |
| Nameplate raw-id cast label for non-player farming casts (cross-profession class gap) | P3 / P7 | Phase 13 polish | closed-by-Phase-14 FOR FARMING ONLY (item C11: the target cast bar resolves through the new targetCastDisplayLabel in cast_display_name.ts, farming localized, every other trade's raw id deliberately kept and pinned as the scope boundary; the class-wide fix stays a maintainer call) |
| Wiki shows no consumable-effect prose for ANY dish (GuideProfCraft lacks an effect field) | P12 QA | guide-generator follow-up | closed-by-Phase-14 (item C10: GuideProfRecipe gains an effect field generated from the live def, foodHp restore plus the well-fed boon as VALUES; the craft page composes them through the new guide.profPages.effect* templates with fifteen M16 fills, stat labels through WELLFED_STAT_KEYS extracted to its own pure leaf so the guide bundle stays deeds-free; accuracy-mirrored both ways in tests/guide.test.ts, the later-patch dormancy pins untouched) |
| map_doc NPC sanitizer drops the farmer flag (one whitelist line plus a round-trip pin when the editor authors farmers) | P9 | editor curation | CLOSED 2026-09-01 by qr-19-map-doc-farmer-flag: the drop is RATIFIED as editor-curation scope, no code change. sanitizeNpc drops cardMaster and warfareVendor by the same whitelist rule, the farmers ship as authored content, and nothing under src/editor authors one, so no capability is lost; reopen with the sibling flags together if editor curation is ever meant to author role NPCs. |
| Steam/Epic achievement mapping (no ACH_ rows; hard cap 100 names) | P10 | maintainer | handed-to-maintainer |
| STALE PLAYER PROSE FOUND BY THIS SWEEP: guide.profPages.gatherDeeds.farming said farming "keeps no deeds of its own yet", FALSE since Phase 10 shipped seven deeds | P7 / P10 | Phase 13 lane A | closed-by-Phase-13 (new key gatherDeeds.farmingSown with its five M16 fills, deedsSection farming arm re-pointed, retired leaf kept with a RETIRED comment; its stale Latin fills join the release-fill row above) |
| Disposable-PG TOAST/WAL measurement (P3 QA made it a Phase 9 HARD gate) | P3 QA | Phase 13 QA | closed-by-Phase-13-QA, EXECUTED 2026-08-19 first-hand on the user-space PG16 (:5433) against the real server (:8787): a real online session planted ALL 23 beds with all three knobs through the real plant_crop wire (persistedPlots 23, denials 0). Numbers: characters.state pg_column_size 1,499 B compressed / 2,059 B raw EMPTY vs 3,261 B / 7,831 B FULLY PLANTED (+1,762 B compressed, +5,772 B raw, about 251 B raw per plot; per-plot row = cropId + plantedAtMs + readyAtMs + survivalRoll + yieldSeed + 3 knob booleans); post-VACUUM-FULL the 6-row probe table held 32,768 B TOAST + 8,192 B heap (rows past the 2 KB threshold TOAST as expected); WAL per 30 s autosave cycle about 12.5 KB ambient-idle vs 13 to 15.5 KB with the planted blob (delta about +1.5 to 3 KB per cycle per fully-planted character), aperiodic 36 to 82 KB checkpoint spikes rode both phases. Extrapolation: 10k fully planted characters is about +17.6 MB compressed at rest and about +60 KB/s WAL at 1,000 concurrently online, matching the Phase 2 db-review estimate class. Probe traps recorded in the memory topic (chat token bucket, silent /dev give/gather, the hoe ladder garden 1 / bronze 2 / skysilver 3 / osmium 4, level-1-dies-in-tier-4-zones) |
| Online resumed mid-growth live render check (P7 QA moved it to Phase 9 QA) | P7 QA | Phase 13 QA | closed-by-Phase-13-QA, EXECUTED 2026-08-19 first-hand as a PLAYER on the real dev client (LOW preset, puppeteer): planted vale_wheat through the real plant sheet (KeyF, seed row, Plant; the Sow It Begins toast fired), read the Harvest Journal (readyAtMs stamped 1787199621334, "Ready in 44m 56s", stage SPROUT), closed the LIVE game socket in place and let the client's own reconnect resume the session, then re-read: readyAtMs BYTE-IDENTICAL, countdown "Ready in 44m 47s" at 9 s elapsed (drift 0 s), row still hj-growing with the correct SPROUT stage; post-resume liveness proven by a /dev farmgrow round-trip flipping the row to "Ready to harvest" with the ready banner on screen (the event-forced-read race class the P7 QA adapter fix hardened: held). Screenshot evidence in the session scratchpad (probe evidence only, not committed, per the Phase 11 QA precedent). One rig note: the offer gate correctly listed the seed LOCKED as "Requires a tier 1 farming hoe" until the garden_hoe was granted, re-proving (bp) live |
| guide.profPages.rareBody (shared across the four gathering pages, filled translated key) names only the three node-trade windfall flavors; farming's golden-harvest flavor is absent (the farming page's new tableBody covers it, so no falsehood renders); the reword needs the new-key treatment plus fills | P13 lane A | release fill / maintainer | open, deferred (reword landmine) |
| FarmBiomePalette.trim has no draw-time consumer (soil tints the bed, wood tints the bin; the core comment claimed trim covered the bin and is now corrected); wire trim in the higher-tier pass or drop the channel | P13 integration | maintainer / art batch | open, handed-to-maintainer |
| "Well Fed" (aura.wellFed) is verbatim the classic-era MMO food-buff term; plain descriptive English, shipped Phase 11 with fills, past ip_scrub; awareness note only | P13 lane A | maintainer | accepted-no-action (awareness) |
| TEARDOWN PRECONDITION (gate-integrity finding): seven screenshot cone subtrees (farming-phase-01/05/07/08/09/09b/12) are referenced ONLY from docs/prd/masterwrought/farming/ files, so deleting the packet reds tests/ci_workflow.test.ts's set-equality (in-cone-but-unreferenced), and the in-test comment then points at deleting the cone rows, which silently drops the evidence from five CI checkouts; the teardown change must re-home those references (or deliberately retire the subtrees WITH their cone rows and PNGs) in the SAME change; the plain farming/ subtree and farming-phase-13 survive via the asset manifest and the exporter | P13 integration | the eventual teardown change (deferred per the D22 addendum; Phase 13 QA verified the row against the tree and it holds exactly as written) | open, verified-by-Phase-13-QA (blocks teardown, not the merge) |
| TEARDOWN PRECONDITION addendum (Phase 13 QA dead-code lane): four out-of-packet COMMENT references to docs/prd/masterwrought/farming/state.md exist beyond the screenshot subtrees: tests/monolith_budget.test.ts (cites deviation (an)), tests/item_art_consistency.test.ts (two citations of deviation (al)), tests/mob_portrait_source_manifest.test.ts (one (al) citation). Comment prose only, no build or CI impact; after the packet deletion they would cite a path that no longer exists. The teardown change should reword them to cite the surviving record (the git history of the merge, or progress-notes equivalents) in the same commit, or accept them as historical citations deliberately | P13 QA | the eventual teardown change | open (blocks nothing; teardown-hygiene note) |
| Second v0.39.0 deed-locale fill pass (15 manifest rows unfilled in 20 locales) | P10 | release fill | deferred-to-release-fill |
| All pending Latin locale rows (about 660 as of the nineteenth absorb) | P1 to P12 | release fill | deferred-to-release-fill |
| Stale Latin count prose (whatBody, gatherHubBody, gatherDeeds bodies) plus the 18 dropped Master Gatherer desc fills | P1 | release fill | deferred-to-release-fill |
| Anti-roster guide pin extended across locales at the fill | P1 QA | release fill | deferred-to-release-fill |
| BASE_DICT locale fill for error.castingPlanting | P3 | release fill | deferred-to-release-fill |
| ja_JP guide fill names the hoe in English (check zh/ko/ru for the pattern) | P5 QA | release fill | deferred-to-release-fill |
| Five-locale "frost gourd" qualifier plus the ru Eastbrook stem split | P6 | release fill | deferred-to-release-fill |
| Guide "(Shift+K ...)" prose lacks the "by default" qualifier (translated-key reword) | P9 QA | release fill | deferred-to-release-fill |
| useWellfed/useWellfedAura pending Latin rows; aura.wellFed Latin fills | P11 | release fill | deferred-to-release-fill |
| farmDenied raw-string echo bound and heavy-self mark-on-receipt refusal amplification (rate limiter bounds it; an ownerKey index is the future O(1)) | P3 QA / P12 QA | none | accepted-no-action |
| Offline forged knob flags (offline-only, the survivalRoll-analysis class) | P4 | none | accepted-no-action |
| Rule-of-three watch points: hud.ts seed-back block, sprout ratio constants, feast title composition, grantGolden signed-grant shape, wellfed/elixir stat maps | P5 to P12 | the third copy extracts | accepted-no-action |
| Two raw grant-green hex literals ride the eventual log-color tokenization sweep | P5 QA | none | accepted-no-action |
| Closure arm derives recipe consumers from merged ALL_RECIPES (bounded by the twin-to-dish literal) | P6 | none | accepted-no-action |
| FarmPatchVisuals.dispose never called; fallback template material never disposed (family precedent, bounded) | P7 QA | none | accepted-no-action |
| Two-tier built fairness arm structurally impossible (no preset input; revisit only if gfx grows preset-keyed geometry) | P7 QA | none | accepted-no-action |
| releaseGltf residency no-leak verdict (policy at the preload block) | P7 QA | none | accepted-no-action |
| (aq) asset-budget honest bar (repo-wide budget pre-existing RED; farm props moved models/props by exactly +174,844 bytes) | P7 | any future asset phase | accepted-no-action |
| Cosmetic clock-skew acceptances: fast client renders stage4 early; withered surfaces on the staggered backstop | P7 / P8 | none | accepted-no-action |
| (bc) unsharded 1 Hz sweep on the crowded residue (sub-millisecond measured; revisit with tick-cost evidence) | P8 | none | accepted-no-action |
| (bf) residuals: mis-stated offline-notice concern, twin production-dead marker exports, sprout ratios, 10px chip type | P8 QA | none | accepted-no-action (chip revisit at the art pass) |
| Withered-then-ready monotone re-projection with no correcting notice (the bed shows the truth) | P8 | none | accepted-no-action |
| Login-notice replay on an unsaved flip; ev.ready numeric trust; focusKey splice without CSS.escape (family idiom, journal and sheet) | P8 QA / P9b QA | none | accepted-no-action |
| Spectators receive the watched farmer's farmReady and its heavy-self mark (generic spectator semantics) | P8 QA | none | accepted-no-action |
| Four em dashes in keybinds.ts (pre-existing, release commit e9c54bc7d2) | P8 QA | none | accepted-no-action |
| (bi) offered-but-refused 1 yd band (vendor-family-consistent) | P9 | none | accepted-no-action |
| (bj) module-import credit arm (fold into the SimContext seam when an extraction frees sim.ts headroom; the M5 extraction is a candidate opening) | P9 | none | accepted-no-action (watch) |
| (bk) patchId is marker-only (any patch credits) | P9 | none | accepted-no-action |
| (bm) two work orders per master (cadence is per quest id) | P9 | none | accepted-no-action |
| requiredItems sweep floor stays >= 5 (derived, q_farm_intro covered) | P9 | none | accepted-no-action |
| nearFarmerNpc walks the whole radius after the answer (cosmetic) | P9 | none | accepted-no-action |
| questObjectiveAreas if/else fall-through and patchless farm objectives circling every patch (latent, none shipped) | P9 QA | none | accepted-no-action |
| Farmer-shadow NPC-over-bed precedence (press ON bed_eastbrook_2/4 in Jessica's arm range opens her dialog; the far side plants) | P9b QA | none | accepted-no-action (UX note) |
| A bedId-free deny racing an in-flight plant send can re-arm early (at worst one extra deny toast) | P9b QA | none | accepted-no-action |
| Online e.eating is a lossy shadow (itemId '', hardcoded kind 'food') | P11 QA | future eating-preview author | accepted-no-action |
| useWellfed keys keep no Use: prefix (rename declined, 21-locale churn) | P11 QA | none | accepted-no-action |
| Phase 12 QA accepted set: consume deny-order asymmetry, entity-id existence oracle, O(live feasts) scan and heavy-on-receipt, dish-from-constant coupling, feastOwnerKey export surface, malformed-id host asymmetry, flourish scope-re-entry ambiguity | P12 QA | none (perf trigger recorded) | accepted-no-action |
| place_feast HEAVY_SELF belt-and-braces deliberate mutation survivor | P12 | none | accepted-no-action |
| Release-hygiene flags: unequipAccountMechChroma hand-roll, the unpinned sm self field, three db-mock lease-export omissions | 19th absorb | release-owned | accepted-no-action (recorded) |
| Admin farm section must field-pick like the wire projection (standing rule; no farm section exists) | P2 QA | future admin author | accepted-no-action (rule recorded) |
| Renderer's three-case farm event route has no direct pin (the adapter guard is pinned) | P7 QA | none | accepted-no-action |
| Offline-taster semantics: session-local clock, a reload re-anchors remaining growth | P3 | none | accepted-no-action (documented) |
| PROFESSIONS_BLOB_FIELDS both-suites same-change rule; the blob band upper margin note (about 1142 bytes) | P2 / P5 | any future blob phase | accepted-no-action (rule recorded) |
| Snapshots delta-key scrape source list is a hand-maintained two-file constant (game.ts plus farming_commands.ts); any moved maybe() emitter joins it in the same change | P6b | any future extraction | accepted-no-action (rule recorded) |
| Any future farming file under public/ui/skills/ joins the freeze lists plus the sha fixture in the same change | 21st absorb | any future phase | accepted-no-action (rule recorded) |
| hud.ts sits at an exact-zero-headroom ceiling (19214/19214 after the P12 extraction); extraction-first is mandatory for any Hud line | P12 | every future phase | accepted-no-action (standing constraint) |
| Stale dev-facing comments (types.ts roster, online.ts gprof pair, guide professions.ts header, load_professions.mjs GATHER_PROFS, build_content.mjs beds prose) | P1 / P3 | inherited debt | accepted-no-action |
| Harvest confirm channel for prompt-mode tool effects ((af)/(ah)/(ba): mints refused, toggle suppressed, journal informational) | P5 to P8 | whoever lands a confirm channel | accepted-no-action (re-deferred with the paired-edit rule) |
| Deploy-order and rollback bullet | P2 / P3 | ops | closed-by-Phase-3 (DEPLOY.md carries it) |
| (bn) no client-side player verb planted or harvested | P9 QA | Phase 9b | closed-by-Phase-9b (verbs ship; journey 17/17; reachability pin guards the class) |
| (z) parity-scenario knob coverage | P4 QA | Phase 5 | closed-by-Phase-5 (isolated golden re-record with the knob beats) |
| (bw) golden-WIN and paying-band parity coverage | P10 QA | Phase 11 | closed-by-Phase-11 (position-searched beats, one isolated classified re-record) |
| Wellfed parity beat (tick-phase mint through real ticks) | P11 | Phase 12 | closed-by-Phase-12 (beat P) |
| sim.ts comment-compression ratchet read | P12 | Phase 13 | closed-by-Phase-13-M5 (extraction; ceiling 12660 lowered to 12249) |
| Instanced-prop helper extraction (rule of three met) | P7 | Phase 7 QA | closed-by-Phase-7-QA (src/render/glb_instanced_props.ts) |
| Farmer NPC look rows (villager fallback) | P9 | 19th absorb | closed-by-nineteenth-absorb (four authored rows in the release npc_looks mechanism; voice LINES stay open, see the art batch) |
| Amount-aware arm for the deeds gainability guard | P3 | Phase 10 | closed-by-Phase-10 (the farming guard arm) |
| /dev GUI farmgrow row | P3 / P7 | Phase 8 | closed-by-Phase-8 (DEV_COMMAND_ACTIONS row behind the gate) |
| Feast loot sparkle residual | P12 | Phase 12 | closed-by-Phase-12 (the lootable re-arm fix removed it) |
| Wiki farming page rendered the node-arm layout with empty tables | P1 | Phase 5 / Phase 9 | closed-by-Phase-9 (live beds prose; the length guards flipped to demand the sections) |
| No real-browser E2E for the professions window rows | P1 QA | Phase 8 QA | closed-by-Phase-8-QA (the browser a11y professions arm runs the real window) |

RE-OPENED (qr-18-REOPEN, 2026-08-31): twelve rows of the table above are actioned
by Phase 18 (a markdown table row cannot carry an inserted annotation line, so
this block stands in for the in-place lines; the rows themselves stay as
written, never renumbered or deleted). The rows, by their Phase 18 item ids:
bags-feast-clicked-copy (the bags feast clicked-copy slot row),
p99-blob-size-gauge (the p99 blob-size gauge row; handed-to-maintainer but
code-shaped with no value call, so built rather than tabled),
grant-green-hex-tokenization, focuskey-css-escape-login-replay,
bf-residuals-batch (the twin dead map-marker exports half only),
keybinds-em-dashes, questobjectiveareas-fallthrough, release-hygiene-flags,
renderer-farm-event-route-pin, stale-dev-comments. The accepted-no-action rows
re-opened here were tolerated-debt acceptances; rows whose acceptance rests on
design grounds (for example the farmDenied echo-bound row) stay closed under
qr-18-REOPEN's accepted-by-design carve-out.
Also actioned from the rows above (relocated here from a misplaced first insert):
bedid-free-deny-race (the bedId-free deny racing row) and
withered-then-ready-reprojection (the withered-then-ready monotone re-projection row).

### Appended at the 2026-08-20 absorb: masterwrought's items (the END of the handoff table; never interleaved with the rows above)

Per the absorb (masterwrought ruling 11b-D-3 and the migration clause below),
this handoff table is now the MERGED packet's one open-item collection point.
Masterwrought's open items append here, at the end, never interleaved. In this
file's status vocabulary: every ruling in the migrated block below is
closed-by-the-2026-08-20-delegation (each row carries its answer and its why),
except the one hand-back, which gets its own table row:

| Item | Phase | Owner | Status |
|---|---|---|---|
| ip-17-PUSH: consent to push the merged branch (the one delegated hand-back; needs an input that does not exist yet) | MW P17 | maintainer | open ruling-owed. SEQUENCED 2026-09-01 by qr-19-ip-17-push-consent: the consent itself is not delegable and stays with the maintainer, so this row does NOT close here; what is ruled is the timing, the push and the single delivery PR wait for the Phase 20 close (qr-18-REOPEN). The standing rule that new branches stay local until okayed, with no merge without approval, is what keeps it open. Deliberately the one row still open at the Phase 19 close. |
| The masterwrought delegated-rulings block (133 rows, the full delegation plus the same-day reconcile pass), migrated here whole at the 11b doc move | MW 11b | record | closed-by-the-2026-08-20-delegation (block below) |
| The guide professions-overview reword (ruling 11b-R3c-2): write the merged five-gathering sentence around guide.profPages plus the five non-Latin overlays, AND reconcile it with farming's count-free guard in tests/guide.test.ts, which forbids ANY spelled count while the ruling's wording spells "five"; 11c records whichever way it resolves (11b carry items 4 and 14) | MW 11c | 11c session | CLOSED 2026-08-21, executed COUNT-FREE: guide.professions.whatBody rewritten ("the gathering trades ... a ring of ten crafts"; "every gathering profession") with real count-free fills in the five non-Latin overlays; the guard stands unamended (its names-every-trade arm is self-maintaining) and ruling row 6 below carries the dated wording amendment; the stale professions.ts code comment swept (carry 15); reasoning in the 11c BUILT ledger |
| The interaction-priority pin (ruling 11b-R3c-1): the placed transient (station or feast) wins over the farm bed. The merged tree keeps farming's shipped bed-over-feast order and masterwrought stations take NO press today (proximity-activated), so the both-directions pin needs the arm reorder first; owned by 11c per the ruling's carry clause, with the apex-feast press also concerning 11k (11b carry item 7) | MW 11c | 11c session | CLOSED 2026-08-21, EXECUTED (not re-routed): tryNearbyInteraction reordered (nodes, feast, bed, escort-away) and BOTH directions pinned in one tests/nearby_interaction.test.ts rig; the station half stays moot by construction (stations take no press; recorded at the arm), and 11k's apex feasts ride the ordered feast arm as placed farm_feast entities |
| `col_junk_drawer` (src/sim/content/deeds.ts, "Discover 10 different poor-quality items", renown 5) has THREE of margin since the 11l QA (one at the 11l build): its meter recounts itemsDiscovered against LIVE quality, and promoting five junk trophies to common (seven at the build; the QA excluded the bogiron nugget and the cracked fetish, poor again) cut the reachable poor pool from 18 to 13 against an amount of 10 (it sat at exactly 10 until the sixth fix round returned chipped_tusk to poor, and at 11 until the QA; amber_hide, soft_down and stag_antler, the Brightwood Glade wildlife pack, have no acquisition route anywhere), so ten of thirteen obtainable poor items are required (deepfen_pearl from a dungeon final boss and soggy_boot from fishing included) and a character holding promoted trophies sees an in-progress counter regress (earned deeds are never revoked). A phase may not retro-edit a shipped trigger (docs/design/deeds.md), which names retroFallbackGrants as the sanctioned heal; the candidates are lowering the amount through that heal or sourcing the wildlife pack. tests/deeds_content.test.ts pins the reachable set (13), the unreachable set (3) and amount <= reachable, so the fourth promotion from here reds instead of stranding the deed. Found by the 11l content reviewer; the 11l BUILT and QA ledgers carry the derivation | MW 11l | maintainer | open ruling-owed (opened 2026-08-24) |
| Zone 1 (Eastbrook Vale, levels 1 to 7) carries NO poor mob drop since 11l: its only three gray drops were bandit_bandana, tallow_candle and mudfin_scale, all promoted, so a starter-zone character has nothing for the Sell Junk button the guide teaches (guide.ts junkBody) until zone 2, and only the band-0 fishing pair (tangled_weed, soggy_boot) as gray. The candidates are authoring one poor drop back onto a zone-1 mob table (content design, the maintainer's) or accepting the affordance gap on the record. Distinct from the col_junk_drawer margin (a completability count); found by the 11l QA's content reviewer and recorded in the TROPHY_RECIPES exclusion record as a consequence, not healed | MW 11l QA | maintainer | open ruling-owed (opened 2026-08-24) |
| The commission minimum-fee floor is PARKED (the Phase 14 stop rule fired: no record gives the floor's value or basis, and fee transfer mechanics collide with the sim's recorded no-escrow position in commission_order.ts). Owed: (a) the fee's mechanics (escrow at open, transfer at delivery, or a display-only stated offer) and (b) the floor's basis (the UNBIND_FEE_BY_QUALITY_TIER ladder, a fraction of the output's buyValue basis, or a flat number). The quality-signal half SHIPPED and the corder row's shape leaves room for the fee fields. Authority record: masterwrought state.md, Phase 14 ledger, "THE STOP RULE FIRED". Appended here 2026-08-30 by Phase 17 per state-COLLECT (this table is the merged packet's one open-item collection point; the park predates the append but had no row) | MW P14 | maintainer | open ruling-owed, PARKED (stays parked per the Phase 17 corrected premises) |

### Decisions closed 2026-08-20 (the full delegation)

THE DELEGATION, in the maintainer's own words: "For anything open, just do what is best for
the feature and the game. I want it fantastic and truly remarkable of a feature." Every gate
in this packet that read "confirm at STEP 0" or "maintainer gate" is ANSWERED below, and the
phase files now carry each answer as an instruction rather than a question. ONE item is
handed back, and only one, because it needs an input that does not exist yet: ip-17-PUSH
needs the maintainer's consent to push. (AMENDED 2026-08-20 by the quality-review adoption
pass, row 132: this header formerly said TWO items and "CLOSED to RENAME ALL", both stale
against its own row 114. ip-NAME-BORDERLINE was the second hand-back and was CLOSED
2026-08-20 NARROWLY: one rename, the 'Enchant <Slot> - <Stat>' scheme, owned by Phase 16;
the zones and coins never rename. Row 114 is the authority.) It formerly needed a brand and
IP-risk judgment on names that are already live in players' hands; that judgment is made.

WHAT THIS BLOCK IS. It is the dated DELEGATED RULINGS block state-COLLECT names: APPEND-ONLY,
never interleaved. (MIGRATED 2026-08-20 by the 11b doc move, per its own clause: it now
lives HERE, at the end of this file's handoff-table section, with a one-line pointer left
behind in masterwrought/state.md. Its rows keep their numbering forever; in this file's
status vocabulary every row is closed-by-the-2026-08-20-delegation except ip-17-PUSH,
which has its own open ruling-owed table row above.)

HOW TO READ IT. Every ruling is consistent with R1 to R23 and with the delivery contract: an
item is in the packet or explicitly CUT, never deferred. Packet R-numbers are never
renumbered, and any R-number a phase writes into src/, server/, tests/, a CLAUDE.md or
docs/design/ reads "masterwrought R<n>" IN FULL. Where a ruling says a phase DERIVES a value, the value is not
in this record: the acceptance criterion is, and a phase that pastes a number from here
instead of deriving it has failed the ruling. Rejected options are recorded so they are not
re-proposed, not so they can be reconsidered.

#### THE SPINE (eight acts; every row below is consistent with them)
- S1 The apex feasts are minted ONCE, by 11k, at cooking 125. 11h GATE E is CUT, and 11h
  becomes a pure bill-editing phase that mints zero new item ids.
- S2 recipe_seasoned_stock belongs to 11g, with grain and root. 11h drops GATE F.
- S3 The farm ladder re-tiers to 0/25/50/75/100 and stops there. recipe_harvest_feast climbs
  to cooking 100, not 125, so no second-capstone exception is needed.
- S4 Well Fed unifies on masterwrought's single `well_fed` aura id with farming's module and
  view, and the ladder re-tunes so the apex plates strictly dominate.
- S5 The R17 hoe carve-out stands, scoped by text to the hoe ladder alone.
- S6 The apex hoe is `evergarden_hoe`, engineering 125, trainer, and both hoe rungs join the
  Heroic Marks counter.
- S7 Fishing grows three bands and a tier-6 apex rod, which retroactively gives the shipped
  tier-4 and tier-5 rods a reason to exist.
- S8 Vendor consumables nerf on a 10/15/20 percent margin ladder, with exactly three
  both-sourced ids exempt.

#### THE RULINGS, in inventory order (ID, ruling, one-line why)

Rows 1 to 111 are the delegation pass. Rows 112 onward were appended the SAME DAY by the
reconcile pass that swept every phase file against these rows; they answer gates the
delegation pass missed and record what it fixed. Append-only, never renumbered, and an
existing row that was wrong is AMENDED IN PLACE with a dated line rather than rewritten.

1. 11b-D-1. FIX the tier 3 and 4 seed faucet as a real deliverable: vendor-stock every tier 3
   and tier 4 seed at farmer_hollis and farmer_verbena on the D11 tier 1/2 pattern, executed
   ONCE in 11e, priced per 11e-D-D, EIGHT rows after 11e-D-B; every downstream phase proves
   the faucet by reading merged vendorItems in code, never a ledger row. WHY: a reagent with
   no faucet is not an output (R18), and four later phases write bills against it.
2. 11b-D-2. Take all six Well Fed axes: one aura id `well_fed`; masterwrought's
   FoodItemDef.wellFed carrying TimedStatBuffPayload, kind-scoped; masterwrought's
   clear-then-grant order; farming's src/sim/wellfed.ts module and tooltip view; the ladder
   re-tuned to farming 2/3/4/5 at 600s with the three apex role foods at 6/900. 11b moves no
   number; 11c executes. WHY: as merged, a cooking-50 trainer dish (evergarden_braised_greens,
   sta 12 for 900s) beats the cooking-100 drop-taught stonepot_stew (sta 6 for 600s), which
   breaks R5 before Phase 15 can measure anything.
3. 11b-D-3. Adopt the absorb amendment, both halves: farming is absorbed, D22 and its
   addendum (B) are superseded IN PLACE with a dated banner and never deleted, D22's absorb
   discipline is adopted upstream; AND an "accepted-by-design" handoff row already constitutes
   an explicit record satisfying the delivery contract's CUT requirement. WHY: never-renumber
   requires supersession in place, and refusing the second half nearly doubles Phase 17's
   closing matrix (51 rows to 95) to re-record decisions already recorded.
4. 11b-D-4. Four recorded monolith ceiling raises at the exact merged line counts, each with a
   ledger row naming this merge, both parent pins and the reason; no extraction funded inside
   the merge phase; hud.ts is paid back by extraction in Phase 14. WHY: no resolution of
   hud.ts lands at or under farming's 19186 pin, and mixing conflict resolution with
   behavior-bearing refactor in one commit is what makes a merge unreviewable.
   (AMENDED 2026-08-20 by 11b's observed counts: TWO raises, not four:
   renderer.ts 13576 over 13546 and online.ts 5967 over 5950. hud.ts composed
   UNDER ours' 19445 pin at 19251, both packets' extractions stacking, so the
   19186-floor premise was true of farming's pin but no raise is needed
   against ours'; sim.ts and main.ts fall. 11d raises exactly the observed
   red set on this ruling's unchanged terms.)
5. 11b-R3c-1. With a farm bed and a mobile crafting station both in range, the PLACED STATION
   wins and the farm bed sits immediately below it; pin both directions in
   tests/nearby_interaction.test.ts. If the two sides' RULE 3c cases contradict, this ruling
   supersedes RULE 3c for that one function and goes on the 11c carry list. WHY: a placed
   station despawns on a timer and is what the player just walked to, while a farm bed is
   permanent world furniture, so the transient entity wins on the shipped corpses-over-nodes
   logic.
6. 11b-R3c-2. 11c writes the merged guide sentence ("five gathering trades ... and a ring of
   ten crafts", plus "all four gathering professions" to five) in src/ui/i18n.catalog/guide.ts
   with its five non-Latin overlays; 11b takes ours and records it owed-to-11c;
   implementation-plan.md's Phase 16 arm changes from "author" to "verify: no shipped string
   says four gathering". WHY: 11c already owns a guide.ts reword plus five-overlay obligation
   in the same fill batch, so folding one more reword in costs nothing.
   (AMENDED 2026-08-21 by 11c's recorded reconciliation: the sentence is COUNT-FREE, not
   spelled ("the gathering trades that pull raw material straight out of the land ... a ring
   of ten crafts"; "every gathering profession"), because farming's count-free guard in
   tests/guide.test.ts forbids any spelled gathering count and exists precisely because a
   spelled count lies the moment another trade registers, which the shipped "four" was doing;
   the guard's names-every-trade arm is the self-maintaining form of this ruling's intent.
   The five non-Latin overlays carry the count-free fills. Phase 16's verify arm is
   unchanged and already satisfied.)
7. 11b-PARK-1. Neither deleted nor moved: farming REFACTORED the icon-art assertion and the
   merged tree takes farming's refactored form (artSubjectHotbarItemIds plus
   pendingHotbarItemIds plus a both-directions debt check), with both literals re-derived on
   the merged tree (art-subject rises to 75; pending is 16 plus every id 11e to 11k parks).
   WHY: read from the branch, farming's form polices the debt in both directions and matches
   scripts/item_art_audit.mjs, so the single-literal form would discard a real guard.
8. 11b-CNT-1. Derive both counts on the merged tree (farming item rows split by kind, and the
   docs/farming tracked file count from git ls-tree) and record the found numbers; a
   disagreement with the plan literal is reported explicitly, never adopted silently. WHY: a
   row vanishing between two counts is the merge's characteristic failure, and an
   un-re-derived number is the predicted-then-observed pin trap.
9. 11b-qa-GATE-9. The F14 QA twin was FOLDED INTO THE PHASE RECORD, not waived:
   docs/farming/progress.md carries a dated QA-CHECKLIST ROUND block with reviewer verdicts,
   LOW dispositions, N/A verdicts and a full gate record on frozen tip 354cff6e77. The 11b
   audit covers F14's thirteen actionable items inside Auditor 7's lane and authors NO
   retrospective twin. WHY: verified by reading the branch, only the FILE is missing, not the
   round.
10. 11b-qa-B8. Record sim.ts as a known 11d ceiling INPUT, never a regression: masterwrought
    measures 12650, the merged file 12340, so sim.ts FALLS. If 12340 is at or under F14's
    lowered pin, that pin HOLDS and only a confirmation line is owed. WHY: F14's extraction
    survives in the merged tree, so the pin moved by merge arithmetic.
11. 11b-qa-SURF-1. Write the REST-surface verdict CLEAN with its four citations (farming's 20
    route modules are a strict subset of masterwrought's 27; server/farming_commands.ts is a
    WebSocket handler with no RouteDef; farming's server/main.ts diff is the lockoutNowMs
    injection and no URL literal; no farming path in any /api/ string), and delete the word
    UNAUDITED from the drift record. WHY: a record that says UNAUDITED is indistinguishable at
    Phase 17 from a record that says nothing.
12. 11c-D-2. Take the unification with the re-tuned ladder (farming 2/3/4/5 at 600s, the three
    apex role plates at 6/900). REJECTED: cutting farming's four wellFed payloads. REJECTED
    and closed: lifting the apex to 8 or above. WHY: the fallback pays four real costs to
    avoid re-tuning four numbers already marked provisional in source, and an apex of 8 breaks
    the R5 kit arithmetic (flask 15 plus food 6 equals 21 stamina) Phase 15 measures.
13. 11c-A2-BUILDER. Extract a host-agnostic src/sim/consuming.ts builder and route BOTH real
    writers through it (src/sim/items.ts useItem's food and drink arm, and
    src/sim/professions/feast.ts's bite); the two dev-scenario zero-rate meals stay out and are
    named in the ledger with that reason. WHY: consumeFeastAction builds p.eating as a literal
    with no wellFed field, so the carried payload silently dies; two hand-built copies of one
    shape is a defect class, and the pure function is a sibling module by the deciding question.
14. 11c-A4-KEYPAIR. Masterwrought's itemUi.tooltip.wellFed plus itemUi.tooltip.wellFedAura
    survive; farming's useWellfed and useWellfedAura plus their ten overlay rows are deleted in
    the same change; the surviving value states BOTH the completion trigger and the
    one-at-a-time rule, and the surviving view supplies exactly that key's placeholder set.
    WHY: locale coverage is a tie so copy decides, one aura id makes the one-at-a-time rule
    true of the whole food family, and a half-swap would ship an {aura} hole.
15. 11c-VOCAB. Take the file's own sentence verbatim, "a mobile field kitchen so dinner gets
    cooked at the dungeon door", and flag it on the Phase 17 release-tier fill worklist as a
    reword-staleness obligation by key. WHY: a one-word substitution frees the word "feast" for
    the real placed-entity mechanic, and a reworded English value leaves every locale silently
    stale.
16. 11d-D-4. Confirmed: four recorded raises at the exact merged counts, and unit 6 proceeds.
    Record the direction honestly: hud.ts and renderer.ts rise, sim.ts and main.ts fall. WHY:
    same ruling as 11b-D-4 restated at the executing phase, and a ratchet that only ever shows
    raises has stopped being read.
    (AMENDED 2026-08-20, same amendment as row 4: the observed raise set is
    TWO, renderer.ts and online.ts; hud.ts sits UNDER ours' pin at 19251 and
    rises nowhere, sim.ts and main.ts fall. 11d executes against the observed
    set; the honesty rule stands.)
17. 11d-U3-ICON. Execute 11b-PARK-1 here: take farming's art-subject split form, re-derive
    art-subject to 75 and pending to the merged count, and add the file to
    merge-deletion-list.md ONLY for the two farming literals it replaces, noting that nothing
    was deleted from it. WHY: writing "deleted" for a refactor would corrupt the one artifact
    Phase 17 re-runs as a delivery gate.
18. 11d-U6-FIFTH. A fifth monolith over its pin is a recorded raise on the same terms as the
    four, taken inside 11d, scoped to growth attributable to the MERGE and never to growth a
    phase authored; every extra row lists both parent pins and a NAMED payback phase; no
    extraction runs inside 11d. WHY: the merge is one event, and splitting its ceiling record
    across two decisions makes the ledger lie about the cause.
19. 11d-U6-PAYBACK. Phase 14's extraction target is masterwrought's 19445 at minimum, recorded
    as a Phase 14 carry, and Phase 14's acceptance does not pass until the hud.ts ceiling reads
    19445 or lower and is LOWERED in the same change; the ip-14-UI migration does NOT count
    toward it. WHY: a raise with no payback number is a permanent raise, and a file move
    relocates zero lines out of hud.ts.
20. 11d-U4-MATTAX. tests/material_taxonomy_bootstrap.test.ts IS a count pin
    (MATERIAL_ITEM_IDS.size 66) and takes predicted-then-observed; tests/material_taxonomy.test.ts
    is NOT (exact-set equality plus membership and class-exclusion arms) and resolves by
    re-deriving its literal; correct the 13-file COUNT_PIN class to the corrected count. WHY:
    MATERIAL_ITEM_IDS is DERIVED from every recipe and enchant reagent filtered to kind 'junk',
    so 11l and 11m both move it.
21. 11d-U1-SHARD. Fresh CI harvest run for the shard-weight table; hand-written weights are
    refused; take the NEWER __provenance block and re-derive `files` from the merged key count;
    a union under 95 percent of test files means the harvest runs before the phase closes. WHY:
    a union under 95 percent is a named way a non-trivial merge reds the gate, and invented
    weights make the LPT balancer distribute against fiction.
22. 11e-D-A. The calendar target is about 10 weeks (70 to 75 days) for the reference farmer,
    with a floor of about 5 weeks at maximum dedication; the four gain VALUES are DERIVED and
    recorded, and the four belowProficiency BOUNDARIES (25/50/75/100) are FROZEN; acceptance is
    a derivation test plus a recorded model printing harvests-per-band and days-to-100, and a
    span materially under a month re-opens the gate rather than shipping. WHY: R19 forbids
    tuning from feel, and the boundaries drive farmingTeachingCeilingFor, so moving one
    silently moves which crop tier grays out at which skill.
23. 11e-D-B. +4 crops, 12 new item ids, ITEM_ART_PENDING 44 to 56: two new tier-3 and two new
    tier-4, with exactly one new tier-3 crop a LEAF and no tier repeating a plant class. WHY:
    +2 leaves the upper tiers at two crops each, which is what forced 11h GATE B into its
    awkward branch; a tier-3 leaf makes the cost-equal branch available for free.
24. 11e-D-C. Step farming's Maker's Charm contribution to +1 in farming's OWN
    quantity-to-bonusPicks mapping in src/sim/professions/farming.ts, never in
    TOOL_EFFECTS.makers_charm.bonus; move the "+2 yield per harvest while charged" tooltip line
    in the same change; add a test arm proving the cap bites. WHY: it is a SUPPLY control under
    R21 (charm +2 plus FARM_TONIC_BONUS_PICKS +2 on a base of 3 more than doubles yield), and
    capping in farming's mapping leaves mining, logging and herbalism untouched.
25. 11e-D-D. Tier 3 seeds buyValue 32 and tier 4 seeds buyValue 64 (the shipped four-times-sell
    convention plus a two-times bootstrap premium), applied to all EIGHT tier 3 and 4 seed rows
    across zone3.ts and evergarden.ts, with NEVER_STOCKED and the per-farmer walk pins updated
    in the same change. WHY: a tier-3 harvest expects 0.48 seeds back and tier 4 expects 0.41,
    so an at-convention price would make the counter the cheaper permanent source and kill the
    seed loop.
26. 11e-D-E. ONE cosmetic deed for growing the whole roster, category 'collection', renown 5,
    NO title, on the shipped visit-mark family with a per-crop mark namespace REGISTERED in
    VISITED_MARK_NAMESPACES and a pinned save/load round trip; migration-safety becomes a
    required reviewer; move DEED_ORDER's tail pin off prog_farming_100. WHY: a roster is a
    collection and 5 is the shipped first-rung gathering point, and an unregistered namespace
    serializes fine and is dropped on load, a trap that has already bitten this program twice.
27. 11e-D-F. Packet numbers stand and are never renumbered; every R-number a phase writes into
    src/, server/, tests/, a CLAUDE.md or docs/design/ reads "masterwrought R<n>" IN FULL, and
    a bare packet R-number in source is a finding rather than a nit (docs/design/ is in scope
    because docs/design/professions.md is the Professions 2.0 series' OWN authority file and
    11j writes masterwrought R17 to R20 into it; AMENDED 2026-08-20 by the reconcile pass); 11d writes the owed decisions-index.md
    namespace row for the professions-tuning R series. WHY: shipped source cites a different R
    series at R1, R4, R8, R9, R14, R19, R22, R30, R35, R37 and R39 to R50, and shipped R19 and
    R22 are live landmines in the very files these phases edit.
28. 11e-DUR. Worked duration defaults, re-derived at authoring: tier 3 at 250 and 260 minutes,
    tier 4 at 615 and 645, each banner-flagged provisional; verify three constraints against
    the shipped table first (no duplicate durationMs inside a tier, inside the D5 band, and
    never under the tier's current minimum of 240 and 600). WHY: the floor is the load-bearing
    constraint, because a shorter upper-tier crop raises harvests per day and undoes 11e-D-A
    through the back door.
29. 11e-BILL. The four new crops land ALONGSIDE existing reagents in
    recipe_highwatch_barley_bannock, recipe_highwatch_gourd_soup, recipe_evergarden_sunmelon_tart
    and recipe_evergarden_harvest_platter, each as a base-plus-fine pair on farming's idiom;
    FORBIDDEN and unchanged: barley porridge, braised greens, harvest feast, seasoned stock and
    every masterwrought apex bill. WHY: D11 requires a consumer in the minting phase and R18
    forbids substitution; the four forbidden dishes belong to 11f, 11g, 11h and 11k.
30. 11e-NAME. The phase derives the four crop names and none is typed before its verdict exists
    in naming-audit.md; each id pairs a REGISTERED zone-flavored word with a common plant noun,
    so the whole R15 risk sits on the plant noun; check the rejected-for-collisions row FIRST
    and web-verify at authoring. WHY: the verdicts need web verification that does not exist
    yet, and FARM_CROP_IDS members are persisted save keys, authored once, correctly, forever.
31. 11e-VERDICTS. Four verdicts recorded and each sweep RUNS: no Reliquary page, no further
    deed beyond 11e-D-E, no new work-order rows, no new market filter chip, nothing owed in
    src/ui/world_entity_i18n.ts. WHY: the content-obligations reviewer treats an unwritten
    verdict as a gap, and the work-order verdict has real teeth, since a flat 0.5-of-sellValue
    payout pointed at top-of-curve produce mints copper.
32. 11e-qa-PRE. All six 11e decisions are written into the packet's open-item record BEFORE the
    QA session starts; a code-versus-ruling mismatch is blocking on its own, and the audit
    judges code against the RECORDED answers, never the file defaults. Binds 11f-QA, 11h-QA,
    11i-QA, 11j-QA and 11k-QA too. WHY: every gate shipped with a recommended default, and an
    auditor reading defaults would silently bless a session that took an alternative.
33. 11f-GATE-A. Band-complete re-tier: gourd soup and barley porridge to 75 [20,20]; the three
    tier-4 rows to 100 [25,25]; recipe_harvest_feast to 100, NOT 125; barley bannock HELD at 50
    as the band-50 anchor. Band table 0:4, 25:3, 50:1, 75:2, 100:4, 125:0, still 14 rows and no
    new id, and no second cooking-125 capstone exception is taken. WHY: all 14 rows are cooking
    rungs and R17 says produce feeds cooking at every rung; at 125 the feast would collide with
    11k's apex feasts and falsify 11k deliverable 2's "the party-tier rung below".
34. 11f-GATE-B. One rule derived from the rung: every row at 75 or above flips to ['drop'],
    tradable, bind on learn; every row at 50 and below stays ['trainer']. Six flip, eight stay,
    and the acquisition assertions become rule-derived rather than row-listed; the alchemy
    sub-arm is N/A on the merged tree. WHY: a rule derived from the rung cannot drift row by
    row, and the growth tonic staying trainer at rung 0 keeps the tonic reachable before any
    drop channel exists.
35. 11f-GATE-C. ONE unconditional contiguous ctx.rng draw at harvest, immediately after the
    golden-harvest roll, spent on every resolving arm and READ only when the golden roll won;
    the draw contract becomes tier 1/2 harvest 2 draws, tier 3/4 3, deny arms 0, plant 2, tick
    sweep 0; restate the DRAW CONTRACT header WHOLE; re-record the farming session golden in its
    own isolated last commit; determinism review is required. WHY: stacking growth, yield,
    tonic, golden and a golden bonus on one 32-bit plant-time seed asks it to carry more
    independent structure than it was sized for, and the unconditional draw keeps stream
    position stable whichever arm resolves.
36. 11f-GATE-D. A golden harvest's bonus draw pays exactly ONE extra item: a SEED (the next
    tier's at tiers 1 to 3, the same tier's at 4, so golden is an upward-drift faucet) or, at a
    lower weight, ONE farming pattern. Zero new item ids. WEIGHTS are DERIVED from the shipped
    rare-event rate, with expected seeds-per-day and patterns-per-day recorded. BINDING: the
    pattern arm's expected rate must be strictly slower than the quartermaster marks route.
    WHY: D13 forbids a luck gate being the only faucet for a pattern, and the upward-drift seed
    makes a lucky farmer's first tier-3 seed a moment rather than a purchase.
37. 11f-GATE-E. Channels mirror Phase 11's recorded shape with the rungs corrected: RAID one
    new rollGroup at the nythraxis_boss_arena tail (pattern_harvest_feast plus the two tier-4
    seeds); RIFT one appended draw AFTER draw 6 over a sorted exported id list on winning B/A/S
    clears; DUNGEON the two rung-75 patterns as a tail group; QUARTERMASTER all six farming
    patterns and all four tier-3/4 seeds at 12 marks. No 16-mark farming row exists. THE COPPER
    FLOOR IS NOT IN THIS PHASE. WHY: the shipped mark family has exactly two points, 12 for
    skill-100 patterns and 16 for 125 capstones, and every farming pattern now teaches a 75 or
    100 row.
    SEED COUNTS RECONCILED AT THE 11f QA, and the code is right rather than the
    ruling: this row was written 2026-08-20 against a roster with two tier-4 and four upper-tier
    seeds, and 11e-D-B grew it to four and eight the next day. What shipped is four tier-4 seeds
    on the raid group and eight on the quartermaster, because the phase derived both from
    FARM_CROPS instead of copying the literals here, which is what the rule asks for. The pins
    enforce the derivation (tests/farm_seed_channels.test.ts holds the raid group equal to the
    tier-4 set and the marks rows equal to the upper-seed set, both derived), so a ninth seed
    joins by existing. Read the RULE, not these two numbers.
38. 11f-PAT. Pattern QUALITY derives from the taught row's OUTPUT quality, computed per
    pattern; pattern sellValue stays UNIFORM across the whole farming set at the shipped point
    of 100. WHY: sellValue on a kind 'recipe' item is a vendor floor and the shipped catalog
    has exactly one point for that class, while recipe rarity is pinned monotone to the power
    of what it teaches, so quality must diverge and price must not.
39. 11f-DUNG. Read tests/dungeons.test.ts's ungrouped-set pin FIRST and append the rung-75
    patterns as a TAIL ROLLGROUP if that pin would move; on the evidence available it will, so
    plan for the tail group. WHY: the ungrouped set is pinned exactly so a new ungrouped entry
    is a visible decision, and a tail group keeps loot draw order stable for the parity goldens.
40. 11f-VERDICTS. Four recorded: NAMING no new coinage (every pattern is "Recipe: " plus an
    already-shipped display name); DEEDS none; RELIQUARY no page, with the sweep run anyway;
    ART parks all six pattern ids with exactly one mapping.json owner and M16 fills in-change.
    WHY: the naming verdict is the cheap one worth writing down because it explains why six new
    ids need no audit, and the item-art ownership trap is batch form or entries form, never
    both.
41. 11g-D-A. Reading 1, THE SEEDS: this phase adds ZERO vendor rows and ZERO buyValues; R18's
    obtainability half is already satisfied; the membership literal in
    tests/recipe_economy.test.ts is PREDICTED UNCHANGED at six ids, and any movement is a STOP.
    WHY: sunpetal_herb carries buyValue 160 with no NpcDef stocking it, so a buyValue is an
    economy basis and not a stock row, and Reading 2's three costs all land in the same change.
42. 11g-D-B. Rung-50 rows may consume tier-3 crops CONDITIONAL on reading farmer_hollis's
    vendorItems in code; on a failed read, fall back to tier-2 produce and record the
    substitution at the row (grand roast takes vale_wheat 2 plus bog_beet 2; serpent elixir
    takes marsh_rice 2). WHY: a crop with no seed source is not a reagent, and reading the array
    is the only proof that survives a phase running out of order.
43. 11g-D-C. recipe_seasoned_stock lands in 11g with marsh_rice 2 plus bog_beet 2; 11h DROPS
    its GATE F and takes the merged bill as given; the ruling goes in the packet record AND the
    11g report; pre-check, if the row already carries produce when 11g opens it, 11h landed
    first, so STOP and reconcile. WHY: 11g runs first and the row is a choke point feeding the
    whole cooking apex, so coupling it to TWO tier-2 crops spreads the choke across two supply
    lines instead of one paddy.
44. 11g-BAND. Leave LOW_BAND, MID_BAND and RARE_BAND alone; produce joins none of them; record
    that the LADDER SHAPE arm now passes more easily on the two rung-50 rows this phase touches
    and confirm it still has teeth on the rows it was written for. WHY: adding produce would
    change a pin's meaning without changing what it catches.
45. 11g-VERDICTS. Record the NIL list as PROVEN, not skipped: zero new ids, so no art, no M16,
    no mapping arbitration, no deed, no Reliquary page, nothing in world_entity_i18n.ts, and no
    proper noun to verify. The ONE obligation is the REWORD set, on the release-tier fill
    worklist by key. WHY: a phase that mints nothing still owes the sweep, and an edited English
    value with filled locales is stale in every locale unless a worklist entry catches it.
46. 11h-GATE-A. Differentiate the FOOD family only, holding the added crop row at equal or
    near-equal summed value across the three plates, and amend the APEX_CONSUMABLE_RECIPES
    header in the SAME change with this exact scope: the food family's bills differ by exactly
    one crop row and are identical in every other reagent, and the flask family stays
    byte-identical. Pin the resulting cost spread. Deliverable 2 is NOT cut. WHY: the header
    states the rule and amending a written rule is deliberate;
    (CORRECTED at the Phase 11h QA: this WHY also read "no test pins the plates identical
    so the change is available", which was false when it was written. tests/masterwrought_
    budget.test.ts pinned all three role plates to ONE shared ROLE_FOOD_BILL constant, and
    11h had to rewrite that pin into roleFoodBill(cropId, count) to land the deliverable.
    The phase file's "must come back UNCHANGED" list names the same suite and is the
    downstream symptom of the same wrong belief.) the precise scope keeps 11i's identical fish row legal and
    stops a future contributor reading the amendment as open season.
47. 11h-GATE-B. Gourd to recipe_stonepot_stew, grain to recipe_warspice_skewers, the new tier-3
    leaf to recipe_sageleaf_chowder, all three at count 2; the tier-4 fallback branch is
    recorded as superseded; every crop's obtainability at the tier its recipe unlocks is
    ASSERTED by test. WHY: 11e-D-B was composed for exactly this, so all three plates ask
    the SAME of a farmer, and a role choice is never also an economy or skill-gate choice.
    (SCOPED at the Phase 11h QA. The comparative claim is what this ruling rests on and it
    holds. The absolute one does not: farmCropSkillThreshold(3) is 50, but the plant path
    also wants a tier-3 hoe, which wields at farming 70, so the effective floor is 70 for
    all three. The player-facing copy that stated 50 as a floor is corrected there.)
48. 11h-GATE-C. ONE tier-3 grain at count 2, added IDENTICALLY to all three apex flask bills,
    standing beside sunpetal_herb at that reagent's own count and replacing none of it; the
    flask family stays byte-identical; assert the sunpetal_herb counts before and after. WHY:
    the flask chain is the daily-gated one through recipe_quickening_catalyst, so a bill
    difference there is a real gate rather than flavor, and standing beside the herb honors R18
    and farming's D24 displacement guardrail.
49. 11h-GATE-D. recipe_laden_hearth takes evergarden_greens 3 plus fine_evergarden_greens 1;
    recipe_grand_cauldron takes gilded_sunmelon 3 plus fine_gilded_sunmelon 1; re-read both
    shipped bills off the merged tree and carry the IDIOM, not these literals; correct the stale
    items.ts tier-4-fine-twin comment in the same change if 11h runs first. WHY: 3 base plus 1
    fine is farming's own shipped showcase idiom used twice, and the split gives each 125
    capstone one showcase crop rather than making both read off one line.
50. 11h-GATE-E. CUT from 11h: 11h mints no apex feasts, no feast patterns and no new item ids at
    all; the three apex feasts are 11k's at cooking 125; delete GATE E from the phase file and
    11h Agent 5's feast slice, and change implementation-plan.md's 11h summary. WHY: 11k owns
    every piece of machinery the feasts need, so minting them in 11h would ship three placeable
    entities no code can place; and at 125 the bill can take both tier-4 fine twins plus 11i's
    new high-band catch, the strongest R20 statement in the packet.
    AMENDED 2026-08-24 (Phase 11k, as built). The GATE-E ruling itself HELD and was
    vindicated twice over: 11i minted a feast anyway, against a different gate, and it
    shipped unplaceable for exactly the reason recorded here. The CLOSING CLAUSE is
    false and is corrected rather than left: the bill canNOT take both tier-4 fine
    twins, and could not on the tree 11k inherited. A fine twin carries buyValue 320,
    two of them are two crop families on a fish row, and produce 4 against one catch
    breaks fish-forward, so the prescribed bill is refused three separate ways by rules
    11h and 11i shipped after this line was written. The shipped bill takes ONE base
    crop plus the whole high-band catch ladder, which is a stronger masterwrought R20
    statement than the sentence promised: the band-5 salmon gates at proficiency 200
    AND the tier-6 rod, so all three feasts pass through the master angler.
51. 11h-GATE-F. DROPPED from 11h: 11g DECISION C owns recipe_seasoned_stock, and 11h takes the
    merged bill as given, re-derives the gold-negative arithmetic from it, and edits the row for
    nothing. WHY: exactly one phase may edit a choke point, 11g runs first, and 11g's bill is
    the better one.
52. 11h-PRICE. MOOT for 11h under GATE E; the question survives once as 11k-D-K2 and is answered
    there. WHY: pricing an item this phase no longer creates would be pricing nothing, and
    recording it as moot keeps the 11h-to-11k trail visible.
53. 11h-NAME. MOOT for 11h under GATE E; the three apex feast names are 11k's, and 11h's naming
    verdict is "no coinage, nothing to verify", written down. WHY: 11h and 11k both claimed the
    same three naming slots, which would have produced two verdict sets for one set of items.
54. 11h-150. The 150 rung is NOT touched in 11h and is not assumable; the R17 gathering-tool
    carve-out is settled at 11j-D-F, and the shipped recipe_osmium_hoe precedent is evidence for
    11j, not a licence for 11h. WHY: 11h's bills are consumables under R17's plain reading, and
    letting a phase that does not own a carve-out assume it is how a carve-out becomes an
    accident.
55. 11h-VERDICTS. With zero new ids the obligation stack collapses to a written NIL (Reliquary
    sweep run and recorded, no deed, no art, no M16, nothing in world_entity_i18n.ts); the ONE
    live obligation is the reword set from the header amendment, on the release-tier worklist.
    WHY: 11h becomes the cheapest remarkable phase in the block, changing what the game's four
    best consumable families are MADE of while adding not one id.
56. 11i-GATE-A. Grow the catch ladder by THREE new bands (3, 4, 5) on the shipped gate, so band
    3 takes stormreel_fishing_rod, band 4 takes tidewrought_fishing_rod and band 5 a NEW tier-6
    apex rod; the nine shipped cells stay byte identical; FISHING_TABLES_BY_BAND grows 3 to 6;
    widen the fishing SimEvent band union and server/fishing_telemetry.ts's label set with their
    cardinality comments. REJECTED outright: new fish behind the shipped tier-3 rod. WHY: rod
    tier 3 already reaches the last band, so two shipped crafted rods buy an angler nothing, and
    this retroactively gives both a reason to exist.
57. 11i-GATE-B. New FISHING_CATCH_BAND_THRESHOLDS = [0, 100, 150, 200, 200, 200] in a new leaf
    src/sim/professions/fishing_bands.ts; the shared PROFICIENCY_BAND_THRESHOLDS stays literally
    [0, 100, 200] and is NOT touched; prove no regression with an exhaustive walk over
    proficiency 0 to 200 crossed with rod tier 1 to 6, predicting the moved-pair set first; move
    the [0, 100, 200] literal and toHaveLength(3) onto the new leaf and re-record the fishing
    session golden. WHY: the shared array also drives proficiency_display_heal and the land
    gather-cast duration, so gating catches on it would silently retune land gathering.
58. 11i-GATE-C. The apex rod's recipe sits at engineering skillReq 125, acquisition ['drop'],
    pattern-taught, quality EPIC, use tier 6, stationType 'toolworks'; re-verify at STEP 1 and
    hand it to 11j; rewrite the ROD_RECIPES header to cover three rungs. WHY: the header already
    states that skillReq 150 resolves to tier 6 while engineering caps at 125, so a taught
    recipe at 150 is permanently unlearnable; epic and not legendary because rod rarity feeds
    FISH_REEL_WINDOW_RARITY_BONUS_SEC and the session-cap budget arm.
59. 11i-GATE-D. The SAME fish row goes into all three apex role plates AND recipe_laden_hearth;
    this gate governs the FISH row only, and 11h's per-plate crop rows stay exactly as
    11h-GATE-B leaves them; re-derive the gold-negative arithmetic from the merged rows. WHY:
    fixing only the chowder would leave an int-role player needing fish while an ap-role player
    does not, and that compulsion asymmetry is exactly what R18 exists to prevent.
60. 11i-GATE-E. All four new patterns (three cooking rows plus the apex rod schematic) ride the
    Heroic Quartermaster as deterministic marks stock, priced in the shipped two-point family by
    taught rung. REJECTED: the master angler fishing up their own rod. WHY: R18 forbids a
    gathering TOOL behind a luck gate and the rod gates band 5; the flavor option also costs the
    attached deed its Renown, since luck-gated deeds are zero.
61. 11i-CATCH. DERIVE the three sellValues from the shipped raw-catch curve and record the
    derivation; carry NO buyValue, so no row joins the counterfactually-vendor-fed set; all
    three JOIN ZONE_FISH; the Reliquary verdict is no page, written down; add all three to
    RAW_COOKING_CATCH_IDS and confirm isRawCookingCatch covers them. WHY: excluding them from
    ZONE_FISH would make the first-cast deed marks silently incomplete for the only zones the
    new bands are authored against, which is the harder bug to find later.
62. 11i-DEED. Do NOT add fishing deed rungs at 50 and 150; mint exactly ONE new deed, the apex
    rod CRAFT, on the shipped craft trigger, renown 10, no title (prog_master_angler already
    owns fishing's title). A band-5 first-catch deed, if wanted, is luck-gated and therefore
    zero Renown and cosmetic. WHY: the shipped gathering ladder spacing is 5 / 10 / 25 with no
    50 or 150 rung anywhere, so adding them to fishing alone would make it the only five-rung
    gathering ladder in the game.
63. 11i-NAME. The phase derives the names and none is typed before its verdict exists; under
    11i-DEED the count drops to about nine ids and five real coinages; consult the
    rejected-for-collisions row FIRST, never carry a working label into an id, and give fish,
    rod and dish names the adversarial second pass phases 08 and 09 used. WHY: the verdicts need
    web verification that does not exist yet, real-world fish names are shared vocabulary, and
    "Master Angler" is already taken by our own shipped deed.
64. 11j-D-A. The fifth apex gathering tool sits at engineering skillReq 125, acquisition
    ['trainer'], stationType 'toolworks', on the recipe_tidewrought_fishing_rod precedent;
    PRE_TRAINING_RECIPE_IDS stays frozen at 21; record the family reading in the packet record
    and in docs/design/professions.md (three grandfathered rows at 150 that are HISTORY, two
    authored rows at 125 that are REACHABLE, and 150 is not a target). WHY: engineering's cap of
    125 resolves to tier 5, so a trainer-taught row at 150 would ship a recipe no player can
    ever learn. (FORWARD CARRY 2026-08-20, row 120: Phase 11o re-tiers the three 150 rows to
    125 after 11j; this row's reading is correct at 11j's own runtime.)
65. 11j-D-B. BOTH hoe rungs join DELVE_SHOPS.drowned_litany, osmium_hoe at 24 marks / clears:3
    and the apex hoe at 56 marks / heroicClear, matching the shipped land and rod tools exactly;
    the craft-only pin NARROWS to hoe rungs 1 to 3 with its reason written out loud; the
    deliberate self-clearing tripwire in tests/delve_shop.test.ts is discharged, not widened.
    WHY: R18 says nobody must have TAKEN a profession to get a thing and this counter is the
    gathering family's one non-crafter route, so leaving farming half-in makes it the only
    gathering profession without one; five and five is also a more drift-resistant pin than four
    and five, and a hoe carries no combat power.
66. 11j-D-C. SIX families bind the R20 guard: the five profession ids plus corpse harvesting,
    with the subject list DERIVED from GATHERING_PROFESSION_IDS so a sixth gathering profession
    joins automatically and is never hand-listed. WHY: R20 says the guarantee is a test or it
    does not exist, and a hand-listed subject set is the "leave it to intention" shape R20's
    second clause forbids.
67. 11j-D-D. The skillReq >= 100 arm refuses to count a recipe whose result is a gathering tool
    of that same profession, derived through the item's own `use` record and never a hand-written
    exclusion list; on this tree it should bite NOTHING, and confirming that is part of the
    audit. WHY: on the pre-11i tree it bit exactly one family, fishing, whose entire endgame
    contribution was a fishing rod, and that single measured hit is what proves the arm is
    calibrated rather than decorative.
68. 11j-D-E. Presence only: NO numeric floor in tests/gathering_supply_coverage.test.ts.
    Per-family per-band bill counts are RECORDED as a judgment surface, and thin-ladder top-ups
    are listed with their reasons; for logging, add timber rows ALONGSIDE existing reagents,
    never substituted. This and 11m-FLOOR are one ruling. WHY: a numeric floor is a balance
    number nobody measured and turns an invariant guard into a content quota that passes on
    padding, while presence is a structural fact that cannot be gamed.
69. 11j-D-F. The R17 gathering-tool carve-out STANDS, scoped by TEXT to the hoe ladder alone,
    recorded as an R17 CLARIFICATION and never as a change to R17; every other exclusion stays
    asserted by sweep, and the sweep's carve-out text names the hoe ladder and nothing else.
    WHY: a gathering tool has no equip slot, contests no item-level budget and has no R5
    interaction, so it is not gear in R17's sense, and recipe_osmium_hoe already consumes
    fine_highland_barley under farming's deviation (ad).
70. 11j-TWIN. The apex hoe consumes fine_evergarden_greens count 2 plus osmium_hoe count 1, with
    the reason in the row comment; retire the stale items.ts tier-4-twin comment in the same
    change unless 11h already did. WHY: every tier-4 land tool takes its fine grade at 4 and
    every tier-5 land tool halves it to 2, so a tier-5 hoe at 4 would be the only apex tool that
    did not halve.
71. 11j-NAME. Candidate evergarden_hoe, "Evergarden Hoe", web-verified at authoring and checked
    against the rejected-for-collisions row first; the next candidate in order is the crop-word
    form from gilded_sunmelon, which would flip 11j-TWIN's twin. WHY: "Evergarden" is already a
    registered proper noun so the phase mints no new coin, and it follows the land tier-5
    convention exactly (Elderwood Axe from fine_elderwood_log, Sunpetal Sickle from
    fine_sunpetal_herb).
72. 11j-COUNT. Correct the acceptance and stopping-rule counts to SIX decisions; Decision F stays
    in the phase's gate set, because it is both a phase gate and a state.md gate and the phase
    that EXECUTES it counts it. WHY: the QA twin's "were all decisions recorded" check reads the
    acceptance list, so a stale five would let the one gate that amends a locked ruling pass
    unrecorded.
73. 11j-VERDICTS. The four sibling apex tools carry no deed, so the apex hoe carries none, and
    that symmetry IS the recorded answer; the Reliquary sweep runs and records no page; run the
    M16 guard rather than judging by eye; nothing owed in world_entity_i18n.ts; re-mint
    shipped_item_ids.golden.json (additions only) and run tests/item_icons.test.ts arm H. WHY: a
    precedent-derived verdict is stronger than a judged one, and the M16 guard's measure of
    wordy is not a human's.
74. 11k-D-K1. THREE new templateIds, one per role, all drawn with the SHIPPED farm_feast prop,
    all reached through ONE exported membership helper in src/sim/professions/feast.ts;
    re-point all four keyed sites (src/ui/entity_display_name.ts, src/render/farm_patches.ts's
    applyFeasts filter AND its shadow-cap sweep, src/game/feast_interact.ts, and the contract
    comment in src/render/quest_objects.ts); three new title keys in hud_chrome.ts with M16
    fills; nothing keys on a bare string literal after this change. WHY: the placed title is
    composed client-side off templateId, so one shared id would label an apex feast as the rung
    below it, and one helper makes a fifth feast impossible to half-wire.
75. 11k-D-K2. Quality 'epic'; sellValue DERIVED with a binding acceptance criterion rather than a
    chosen number: strictly above 250 (harvest_feast) and strictly below 380 (laden_hearth), a
    multiple of 10, gold-negative against the MERGED bill with the arithmetic printed at the
    row; quality stays rare-or-better whatever else moves, because deliverable 3's craft-signing
    prestige rides that threshold. WHY: the two bounds are shipped points and the reasoning
    between them is structural, while the bill is not authored yet, so the gold-negative half
    genuinely cannot be computed now.
76. 11k-D-K3. NO storefront entry, recorded ONCE at packet level and covering every deed this
    packet adds (the 13 absorbed farming deeds plus 11e-D-E's, 11i-DEED's and
    prog_field_to_feast): no ACHIEVEMENT_MAP row, the pins stay at 84 against
    MAX_EPIC_ACHIEVEMENTS 100, privacy-security-review is not triggered, and Phase 16 writes the
    record. WHY: the launch set is curated rather than a catalog mirror, and the exhaustive
    coverage arm is scoped to col_reliquary_*, so an unmapped deed goes green silently and only
    a written record catches it.
77. 11k-D-K4. Keep the feast placement refusal exactly as shipped and TIER-AGNOSTIC, and PIN the
    reading in BOTH directions (a cook holding an apex feast and a harvest_feast can place only
    one, in either order). REJECTED: one-per-tier. WHY: feast.ts sweeps ctx.feasts by ownerKey,
    so tier-agnostic is what the code does today and pinning it turns an accident into a
    decision; one-per-tier doubles the live entity bound and drags FEAST_SHADOW_CAP and the 1 Hz
    despawn sweep into a content phase.
78. 11k-D-K5. The shipped harvest_feast values: charges 10, durationTicks 3600. Raid-scale
    charges are refused, not deferred. WHY: the per-player ledger, the 1 Hz despawn sweep and
    FEAST_SHADOW_CAP were built for these numbers, and feast uptime is an R5 input Phase 15 owns.
79. 11k-NAME. The phase derives the names, web-verifies at authoring, records verdicts and checks
    the rejected-for-collisions row first ("Grand Banquet" is already there); RULED DIRECTION:
    compound the SHIPPED apex plate name it serves (Stonepot, Warspice, Sageleaf) with one table
    or gathering word, so the role is legible from the placed title and no new proper noun is
    coined at all; only the shared table word needs verification, once. WHY: under K1 the name
    appears in the placed entity's title, so role legibility is functional rather than flavor,
    and this reduces three R15 verifications to one.
80. 11k-CUT. CUT: the crafter's signature is NOT carried onto a feast placed by someone else, and
RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as feast-crafter-signature-carry.
    deliverable 3's prestige claim narrows in the same change to what is true (the signature is
    on the item instance, the placer's name is on the entity, and they coincide when a cook
    places their own feast). WHY: it needs a new FeastState field and a new wire field, a
    cross-platform change, for a case that arises only when a cook sells a feast and a stranger
    places it; shipping the broad claim while cutting the mechanism would leave a false sentence
    in the record.
81. 11k-VERDICT. No Reliquary page for the apex feasts; the sweep RUNS and the verdict is written
    into the phase record and checked against tests/reliquary_content.test.ts. WHY: a consumable
    feast is not conquerable unique loot, and the packet already ruled at Phase 10 QA that
    crafted epic tools stay out on the same ground.
82. 11l-D-11. ADOPT the flavor mapping and promote every adopted reagent out of quality 'poor':
    the rule is "no adopted reagent stays poor", and the COUNT is DERIVED at the phase, never
    pasted. AMENDED 2026-08-20 by the reconcile pass, which measured it: nineteen ids are
    adopted (21 minus the two 11l-HOLDOUT keeps) and FOUR already sit outside 'poor', so
    FIFTEEN rows move, not eighteen. The four are gleamstag_charm ('rare'),
    emberwing_cinderscale and old_cragmaws_pelt ('common'), and guardian_core, which carries NO
    `quality` field at all and which the original row missed. WHY: the promotion is mechanically
    FORCED, because MATERIAL_ITEM_IDS is derived from every recipe and enchant reagent of kind
    'junk' and the taxonomy test forbids a poor member; and junkSellableSlot gates purely on
    'poor', so an unpromoted reagent is one-click destroyed at the first vendor. The same
    measurement named three tests/material_taxonomy.test.ts arms no blast list carried, all
    three now written into phase-11l: ALLOWED_UNCLASSIFIED_JUNK holds exactly those four ids and
    must lose every one this phase adopts; the quality-poor sweep's non-vacuity floor reads
    toBeGreaterThan(15) against a catalog of exactly 21 poor items, so promoting fifteen leaves
    six and the floor must be re-derived DOWNWARD; and isMaterialItem's negative control is
    guardian_core itself, which flips to true. (AMENDED AGAIN 2026-08-20 by the quality-review
    adoption pass, row 123, which supersedes this row's counts and taxonomy predictions
    wholesale: FOURTEEN adopted, all poor, FOURTEEN move; the four non-poor ids plus
    deepfen_pearl are arithmetic EXCLUSIONS, so the allowlist loses nothing and stays at its
    measured SIX members, the poor-survivor set is SEVEN, and the guardian_core negative
    control stays valid. Row 123 is the live reading; this row stands as the record of the
    reconcile-pass measurement it corrected.)
83. 11l-HOLDOUT. BOTH tangled_weed AND soggy_moccasin stay trash: never reagents, never promoted,
    both named in the junk-sweep pin's TRUE arm. REJECTED: adopting the moccasin as a scrap.
    WHY: the shipped fishing comment makes weeds and boots a PAIR, so keeping only the weed
    leaves half a gag and one stray boot, and two members keep the TRUE arm non-vacuous.
84. 11l-SELL. Every sellValue is FROZEN, gleamstag_charm (2500) and deepfen_pearl (600) included.
    WHY: tests/recipe_economy.test.ts uses sellValue as the value basis for every new bill, so
    moving one while adding a bill makes the gold-negative arithmetic unverifiable, and freezing
    the vendor side keeps the vendor-versus-craft choice a real one.
85. 11l-RUNG. Each new row's rung matches its input's DROP LEVEL, the two high-value bills must
    out-value their vendored input with the arithmetic in the row comment, and the arithmetic
    decides MEMBERSHIP: an input no rung in the mapped profession can out-value is NOT adopted
    and is recorded as an explicit exclusion with that arithmetic. WHY: a bill worth less than
    its input is a trap that punishes engagement, which is the exact pain the phase removes, and
    letting arithmetic decide membership costs nothing because sixteen adoptions carry the phase.
    (AMENDED 2026-08-20 by the quality-review adoption pass, rows 122 and 123: the rule
    GENERALIZES to every adopted trophy, not only the two high-value bills; the predicted
    exclusion set is FIVE and fourteen adoptions carry the phase; and every row's output obeys
    the new 11l-OUT doctrine. Rows 122 and 123 are the live reading.)
86. 11m-D-12. SPREAD never add; TARGET (6 templates, 4 zones, 2 level bands) counted over the
    REACHABLE subset only, defined as an open-world spawn a solo player of that template's own
    level range can reach; MAP the orphans per 11m-ORPHAN; do NOT thin cloth; the arcane_shard
    dead-end premise is FALSIFIED and re-derived before any row is written (enchants.ts carries
    10 more consumer rows, so live demand is 12 consumers and 21 units, not 2 and 10); NO affix
    rerolls. WHY: R22's floor is reachability in its own words, so a membership count would pass
    on exactly the shape R22 names as still broken, and the shard census scanned one file.
87. 11m-ORPHAN. horn maps to curved_tusk, gills maps to mudfin_scale, MONSTER_MATERIAL_TIERS rows
    at 1 for both, NO specimen for either decided explicitly, and the phase's authorized
    one-new-id exception is NOT used and that non-use is recorded. WHY: horn is the same keratin
    structure as tusk and curved_tusk is the thinnest mapped family, so one line fixes two
    faults; gills to mudfin_scale ties 11l and 11m into one act; and a pristine jackpot on a
    bare-hands-floor component would invert the premium ladder.
88. 11m-FLOOR. R21's enforceable floor is PRESENCE (consumer count at or above 1), the only
    numeric assertion anywhere; consumers and unit demand are RECORDED as a ratio table with
    outliers reported against each family's own median; phase-11m gains the floor definition and
    phase-11j deliverable 1b's wording is corrected to match. WHY: zero is a structural fact and
    everything above it is an unmeasured balance number, and this is the same ruling as 11j-D-E
    stated once so the two files stop disagreeing.
89. 11m-ADMIT. The closed admission gate STANDS and the two stale lines are drift to fix: correct
    phase-11m's "NOT YET ADMITTED" text and decisions-index.md line 18 (its NNb/NNc namespace
    row, plus "ten inserted phases" to thirteen). WHY: three records disagree and two are stale,
    so a session loading either one first would conclude the phases are optional under a contract
    that has no deferral state.
90. 11n-D-13. The margin ladder is FIXED at 10 / 15 / 20 percent by rung, bottom to top; nerf the
    VENDOR line only; magnitudes are arithmetic the phase computes (crafted divided by 1 plus the
    margin, floored) and records; scope is every vendor-sold consumable and the FOOD line takes
    the same ladder; two recorded exclusions (no crafted counterpart, and the three both-sourced
    ids); re-derive the combat-potion header fractions and tests/consumables.test.ts in the same
    change. WHY: the measured shape is inverted, 9.1 percent at the bottom shrinking to 3.7 at
    the top, and the food line is worse still, with roasted_boar equal to crafted and
    brightwood_venison ahead of it.
91. 11n-BOTH. The both-sourced set is exactly THREE (minor_healing_potion, elixir_of_the_bear,
    tough_jerky), none split and none changed on magnitude, with the allowlist pinned in
    tests/vendor_floor.test.ts; AND remove elixir_of_the_bear from alchemist_verane's vendorItems
    row in src/sim/content/zone3.ts, keeping the item, its 7 percent Mirefen drop, its recipe and
    its buyValue. WHY: elixir_of_the_bear is buff_sta 12 for 900s sold by the alchemy master for
    100 copper and exactly equals elixir_of_the_serpent, the alchemy-50 crafted top elixir; that
    zero-percent margin is R23's competitor in its purest form, and it is the one vendor-sold
    BUFF in the catalog, which the floor never had to protect. (AMENDED 2026-08-20 by the
    quality-review adoption pass, row 127: the stock-row carve-out WIDENS to FIVE rows, this
    one plus smith_haldren's four byte-identical crafted gear ids, the same purest-competitor
    shape at the gear axis. Row 127 is the live reading.) (AMENDED 2026-08-25 by the relayed
    maintainer ruling, row 134: the set re-derives to NINE and the magnitude-exempt
    allowlist is FIVE; row 134 is the live reading of the set.)
92. state-GATE-1. Answered at 11e-D-A: about 10 weeks (70 to 75 days) for the reference farmer,
    floor about 5 weeks at maximum dedication, values DERIVED and recorded, band boundaries
    25/50/75/100 FROZEN. Closed-by-11e. WHY: one question, one answer, recorded where sessions
    read it; the boundary freeze is the half the old row never mentioned and the half that would
    break farmingTeachingCeilingFor.
93. state-GATE-2. Answered at 11e-D-B: +4 crops, 12 new ids, ITEM_ART_PENDING 44 to 56, with the
    composition constraint (one new tier-3 crop is a LEAF, no tier repeats a plant class).
    Closed-by-11e, and it prices state-GATE-5 below it. WHY: same ruling, one home, and the
    composition constraint makes the gate pay for itself twice by unlocking 11h-GATE-B's
    cost-equal branch.
94. state-GATE-3. Answered at 11f-GATE-A: the band-complete re-tier to 0:4, 25:3, 50:1, 75:2,
    100:4, 125:0, bannock held at 50 and harvest feast at cooking 100. YES it is acceptable to
    move rows a shipped ladder advertises. WHY: farming lives on the unmerged
    feature/farming-plan and reaches players only through this packet's single PR, so no live
    player holds expectations about these rungs and the re-tier is authoring rather than a
    retune.
95. state-GATE-4. Answered at 11i-GATE-A: THREE new bands (3, 4, 5) plus a tier-6 apex rod, not
    one; the row is rewritten because as written it understated its own default by two bands and
    named only the rejected alternative as the other half. WHY: a gate row that misstates the
    option being taken is worse than no row, because a session reading state.md first would build
    a four-band ladder and then find 11i specifying six.
96. state-GATE-5. PARK: every new id from 11e to 11k parks on the merged ITEM_ART_PENDING with
    exactly ONE mapping.json owner, committed WebP art is not attempted in-change, the growth is
    ACCEPTED and recorded phase by phase, and the art wave runs on the maintainer's own schedule
    after the packet. WHY: the master SHA is a maintainer artifact a phase session cannot produce,
    so "ship art" would block every content phase on something outside the branch and break the
    one-branch-one-PR contract.
97. state-GATE-6. Answered at 11j-D-F: the carve-out STANDS, scoped by text to the hoe ladder
    alone, recorded here as an R17 CLARIFICATION and never as a change to R17, with every other
    exclusion still asserted by sweep. WHY: recorded at packet level here and executed at 11j, so
    the only work is writing it in one place and pointing the other two homes at it.
98. state-GATE-7. Answered at 11b-D-1: FIX the faucet, vendor-stocked at the two farmers,
    executed once in 11e, priced per 11e-D-D, EIGHT rows after 11e-D-B. Closed-by-11e, and kept
    flagged as the single-PR blocker until 11f's STEP 0 discovery verifies the rows in code. WHY:
    four later phases write bills against reagents it makes reachable, and the whole verification
    chain reads code rather than a ledger, which is what makes closing it safe.
99. state-OPEN-RIFT. OVERTURN the record-and-accept and CLOSE the residual, scheduled BEFORE 11f
    or as 11f's own first commit: the rank parameter on the riftClearRewards factory, three
    SCENARIOS appends at baseLevel 20/22/28, one coverage arm and an UPDATE_PARITY mint each,
    with seed hunting only for the B/S in-window picks; the sibling heroic-claim Nythraxis
    residual closes with it. WHY: 11f appends a draw after draw 6 in the rift reward stream and a
    rollGroup at the nythraxis_boss_arena tail, which is precisely the rank-local insertion the
    missing goldens would cover, so half a day of plain addition buys coverage for the exact
    change the packet is about to make.
100. state-OPEN-FLASK. KEEP as shipped; record the standing flask owner-cancel deviation
     CLOSED-keep so it stops sitting in the open list; Phase 14's flask_<kind> shared-glyph note
     proceeds on its own merits and does not reopen the cancel semantics. WHY: nothing in this
     packet depends on it, it carries no power under R14, and it has been posted for review
     through a full phase without an objection.
101. state-OPEN-MASTERWORK. Re-judge and amend docs/design/reliquary.md in Phase 12, in the SAME
     change that moves R1 suppression to the effect gate; Phase 12 either records the reason that
     survives the flip or fills the feat under tests/reliquary_content.test.ts's own admission
     rules, and the three reliquary pins move with it. The other two of the standing three stay as
     ruled at Phase 10 QA. WHY: the feat justification cites engineering's gear-capability, and
     craftIsGearCapable('engineering') flips, so holding the slot unfillable on an unstated ground
     is the drift the anchor rule exists to stop. EXECUTED 2026-08-26 (Phase 12): the un-pend
     itself had landed at 11o; Phase 12 moved the R1 suppression's effect to the crafting.ts
     effect gate and amended docs/design/reliquary.md dated in the same change, and the three
     pins did NOT move (the craftBonusStatsFor bake is byte-identical, so the derivation
     cannot).
102. state-OPEN-WELLFED. DISSOLVED by 11c: after the unification there is ONE Well Fed (one aura
     id, one mechanic, one ladder), so neither mechanic is renamed and Phase 16 amends the naming
     registry row to say the GENERIC-with-caveat caveat is RETIRED by the 11c unification, with
     the date and the reason. WHY: the item was written when the merge held two Well Fed systems
     side by side, and the condition that created the caveat is gone.
103. state-COLLECT. Until 11b's doc move runs, delegated answers live in THIS file as a dated
     append-only block at the END, never interleaved; 11b STEP 6 MIGRATES the block into
     farming/state.md's handoff table in the SAME commit as the doc move, converts each row to
     that file's status vocabulary, leaves a one-line pointer behind, and states the append
     convention. WHY: every phase from 11e onward reads farming's OPEN list, and that file does
     not exist yet, so answers recorded now would otherwise be homeless for the interval.
104. ip-GATE-17. YES: farming's "accepted-by-design" handoff rows already constitute an explicit
     record and satisfy the delivery contract's CUT requirement, so Phase 17 closes the 51
     maintainer-gated rows and NOT the 44 accepted ones; record it in decisions-index.md and in
     the packet record before the closing matrix runs. Same ruling as 11b-D-3's second half. WHY:
     the contract requires that nothing be implicit, and a dated row saying "accepted by design,
     here is why" is the most explicit form a record takes.
105. ip-GATE-PAIN. ADMITTED, gate closed 2026-08-20, as implementation-plan.md already records;
     11l, 11m and 11n are in the packet and the residual work is doc drift only, fixed at
     11m-ADMIT; no CUT is taken, so neither dependent amendment is needed. WHY: three phases that
     fix measured player pain are the cheapest remarkable content in the program, and 11l adds
     zero new ids.
106. ip-14-UI. MINT and MIGRATE: Phase 14 creates src/ui/hud/professions/ with an index.ts barrel
     and a local CLAUDE.md and moves the whole family behind it, as its OWN commit (pure moves plus
     import re-points, zero logic change); it does NOT count toward the hud.ts payback target of
     19445; write the DESIGN.md compliance statement for the farming windows in the same phase.
     WHY: the repo rule says HUD-domain components live in src/ui/hud/<domain>/ behind a barrel,
     and about 25 root-level professions modules is the shape that rule exists to prevent.
107. ip-16-ICON. PARK: masterwrought's items park against the merged table and the merged pending
     allowlist exactly like farming's 44, said explicitly in the Phase 16 record; this packet ships
     no committed WebP art, every new id carries a pending row with one mapping.json owner, and the
     merged icon test keeps farming's art-subject split shape with re-derived literals. WHY: it is
     state-GATE-5's question at a second altitude and the answers must match, and masterwrought's
     asserted-empty pending set was true only in an era with maintainer art turnaround inside the
     phase.
108. ip-16-SURFACES. Four verdicts, all recorded in the Phase 16 record. (a) STOREFRONT
     ACHIEVEMENTS: CUT, one packet-level record covering every deed the packet adds; pins do not
     move; privacy-security-review is not triggered (same ruling as 11k-D-K3). (b) DISCORD ACTIVITY
     FEED: ADD, capped at two cards, the farming member on bot/logic.ts's closed kind union with
     cards for the Harvestmaster title and golden_harvest, no third card and no per-placement noise.
     (c) THE RL HOST: CUT, explicitly, with the reason recorded in headless/CLAUDE.md, because
     farming growth resolves against ctx.lockoutNowMs() so any episode that plants is non-replayable;
     the five wire commands and the eight-member facet stay out with it, and re-admission needs a
     virtual clock. (d) ADMIN MARKET METRICS: WIDEN to cover produce, seeds and compost, with
     every string through t(). AMENDED 2026-08-20 by the reconcile pass at row ip-16-METRICS,
     which closed the half this row left open: the state-the-scope-in-the-copy alternative is
     REJECTED, because the market metrics are the only instrument that shows whether the world
     eats what the crafts make, so scoping the copy would leave masterwrought R21's claim
     unmeasurable on the surface built to measure it. WHY: the contract is in-or-CUT, so silence
     is unavailable on all four, and (c) is the one genuine structural incompatibility and
     deserves a written reason rather than an omission.
109. ip-15-KIT. UN-DROP the feast from the R5 full-kit premise BEFORE Phase 15 runs: re-author the
     premise to "the best available food, always on, delivered by feast", re-record deviation (e)
     with its new outcome, revert both live edits the drop justified, and add the aura-exclusivity
     pin spanning well_fed and elixir_<kind> that also asserts wellfed_<kind> exists NOWHERE after
     11c. Conditional unchanged: anything other than the 11c-D-2 ladder trips Phase 15's own
     stopping rule. WHY: harvest_feast and 11k's three apex feasts make the feast a real buff
     source, so the premise is falsified by the merge and Phase 15 would otherwise measure less
     than the game ships, on the packet's defining gate.
110. ip-17-TEARDOWN. Teardown is CUT from this PR and recorded as a post-merge chore with its shape
     fixed now: when taken, both doc trees go as ONE decision, the eleven screenshot cone rows are
     re-homed in the same change, and docs/design/farming-asset-manifest.json is deliberately
     preserved. What DOES land in the packet, because live tests cite them by path: promote
     naming-audit.md and power-verification.md to docs/design/ and re-point every citation
     (tests/originality_renames.test.ts, tests/ip_scrub.test.ts), and re-home the cone rows
     tests/ci_workflow.test.ts guards. WHY: the packet docs are the review evidence for a
     seventeen-phase PR, and deleting them in the same PR removes the reviewer's map at the exact
     moment it is needed.
111. ip-17-PUSH. The branch stays LOCAL. The packet is complete when Phase 17 closes and
     `node scripts/gate_select.mjs` passes on the committed tree; the push and the single PR happen
     only on the maintainer's own word, at the time. This is the ONE item in the inventory a session
     cannot answer. WHY: not because the design is unresolved, but because it needs an input that
     does not exist yet: the standing rule is that new branches stay local until okayed and no merge
     happens without approval, and no delegation of design decisions can supply a consent that has
     not been given.

### CROSS-CHECKS (pairs that would otherwise contradict; reconciled, not weakened)
- C1. 11h-GATE-A (differentiate the food family) versus 11i-GATE-D (the fish row is identical on
  all three plates): reconciled by making the header amendment PRECISE, "the food family's bills
  differ by exactly one crop row and are identical in every other reagent; the flask family stays
  byte-identical", so both hold literally and no contributor reads it as open season.
- C2. 11f-GATE-A versus 11k's apex feasts at 125 and 11k deliverable 2's "the rung below":
  reconciled by moving the harvest feast to cooking 100. At 100 and 125 the feast ladder is a real
  climb and cooking 125 holds four rows rather than five.
- C3. 11j-D-E (no numeric demand floor) versus 11m's two agents referencing a floor DECISION 12
  never set: reconciled at 11m-FLOOR by ruling ONE floor for both, presence, with a recorded ratio
  table. Both files change to that wording.
- C4. R22's reachability floor versus 11m DECISION 12's membership counts: reconciled at 11m-D-12
  by keeping the numbers as the shape and running every count over a defined REACHABLE subset.
- C5. R17 versus the hoe ladder's shipped fine-twin invariant: reconciled at 11j-D-F as a narrow
  written carve-out beside R17, scoped by text, judged on the merits. The apex hoe's bill does NOT
  change.
- C6. R23's "the vendor stays useful" versus pulling elixir_of_the_bear from Verane's counter:
  reconciled by distinguishing the ITEM from the STOCK ROW. The item keeps its drop, its recipe and
  its buyValue, every heal, mana and food row stays, and only the one vendor-sold BUFF goes.
- C7. R23's nerf direction versus 11n-BOTH's exemption at the bottom hp rung: reconciled by ruling
  the exemption superior. minor_healing_potion does not move and the bottom hp rung is recorded as
  EXEMPT rather than as a miss; the ladder binds at the lesser and standard rungs and on the food
  line.
- C8. 11e-D-C's charm cap versus R19's calendar model: no conflict, and worth writing down. Capping
  bonus picks changes UNITS per harvest, not harvests per day, so the calendar model is unaffected
  and does not need re-running.
- C9. 11e-D-B's roster composition versus 11h-GATE-B's crop assignment: one decision taken twice.
  The tier-3 leaf is what makes 11h's cost-equal branch available; two grains would have forced the
  tier-4 halving branch and a lopsided value spread.
- C10. 11f-GATE-D's golden pattern arm versus 11f-GATE-E's marks channel: reconciled by the binding
  rate constraint, since D13 says a luck-gated source is never the only faucet and without the
  constraint the two channels could invert.
- C11. 11b-PARK-1 versus state-GATE-5 and ip-16-ICON: all three settle to farming's art-subject
  split with a positive pinned pending count and both literals re-derived per phase.
  Masterwrought's asserted-empty pending set is retired, and its retirement is recorded.
- C12. state-OPEN-RIFT's overturn versus 11f-GATE-E's rift append: not independent. The overturn is
  scheduled BEFORE 11f precisely because 11f's append is a rank-local insertion into the stream the
  missing goldens cover. Reconciled by sequencing, not by weakening either.
- C13. 11c-VOCAB's reword versus 11h-NAME, 11k-NAME and the word "feast": reconciled by order. 11c
  frees the word first; if 11c's reword slips, 11k's names wait, and that dependency is recorded at
  11c-VOCAB.
- C14. 11h mints zero ids versus 11h-VERDICTS' obligation list: consistent, and the strongest
  evidence the set is coherent. Cutting GATE E turns 11h into a phase that changes what the game's
  four best consumable families are made of and adds not one item id.
- C15 (added by the 2026-08-20 reconcile pass). 11c-D-2's apex plate duration, 600 to 900,
  versus R23's "never by raising the crafted line" and versus R5: no collision, and the
  reasoning is now written into phase-11c so it reads as decided rather than missed. The
  MAGNITUDE stays 6, and ip-15-KIT fixes Phase 15's premise at "the best available food, ALWAYS
  ON, delivered by feast", so an always-on measurement is indifferent to 600 versus 900 and R5's
  ceiling does not move. R23 governs the vendor-versus-crafted MARGIN, and after 11n-BOTH pulls
  elixir_of_the_bear from Alchemist Verane's counter no vendor item grants Well Fed at all (the
  vendor food line carries foodHp only), so no margin is being created here. 11c is ladder
  ORDERING inside the crafted line, and it is explicitly not a licence for a later phase to
  raise a crafted magnitude.
- C16 (added by the 2026-08-20 reconcile pass). 11i-GATE-C's apex rod versus R18: the rod GATES
  band 5, so it is R18's hardest case in the packet, harder than any catch. Reconciled by
  asserting the rod ITEM stays market-listable, never soulbound and never noMarketList, on the
  shipped tidewrought_fishing_rod def's precedent, so a fisher who never took engineering
  reaches band 5 by buying the rod. 11i's R18 arm covered only the CATCHES and now covers the
  rod too, with its own acceptance row.

### NEW WORK these rulings imply, with its owner
- N1. The decisions-index.md professions-tuning namespace row (11e-D-F). ASSIGNED TO 11d, in the
  derived-artifacts commit, since 11d is the doc-truing phase and runs before any phase that would
  cite an R-number in source. DISCHARGED 2026-08-20 by the reconcile pass: the row is authored in
  decisions-index.md, and the same pass WIDENED its scope to include docs/design/ (see 11e-D-F as
  amended). 11d unit 7 becomes a VERIFICATION of both rows against the merged tree, with authoring
  as the fallback if the merge loses one.
- N2. The decisions-index.md admission-row correction (11m-ADMIT): line 18's NNb/NNc row said
  11l, 11m and 11n were NOT ADMITTED and said "ten inserted phases". ASSIGNED TO 11d, same commit
  as N1, so the file is opened once. DISCHARGED 2026-08-20 by the reconcile pass, which fixed it
  where it stood rather than leaving a session to load a stale "NOT ADMITTED" first; the
  open-once reason was already spent, because N1 had opened the file. 11d verifies it.
- N3. This block and its migration (state-COLLECT). The block is appended here now; 11b STEP 6 must
  migrate it into farming/state.md's handoff table in the doc-move commit and leave a pointer. The
  migration step is not in 11b's current STEP 6 and must be added there.
- N4. The src/sim/consuming.ts module's ceiling story (11c-A2-BUILDER): a new sim module needs its
  tests/monolith_budget.test.ts position considered and a Vitest that imports it directly. 11c owns
  the extraction; the budget entry is new work inside 11c.
- N5. src/sim/professions/fishing_bands.ts, a new leaf (11i-GATE-B), plus moving
  tests/professions_fishing.test.ts's [0, 100, 200] literal and toHaveLength(3) off the shared
  proficiency_bands module onto it. 11i owns the content; the module and the test relocation are new
  work inside 11i.
- N6. Correcting the three "NEVER arcane_shard" reservations in src/sim/content/recipes.ts (the
  jewelcrafting hub header, the inscription header, the INTERMEDIATE_RECIPES header), or proving
  they need no correction (11m-D-12). Owned by 11m, and both branches must be stated.
- N7. Re-deriving the combat-potion header's target fractions in src/sim/content/items.ts and the
  matching assertions in tests/consumables.test.ts (11n-D-13). Owned by 11n, not on its original
  blast list.
- N8. tests/vendor_floor.test.ts's no-crafted-counterpart exclusion arm (11n-D-13), a second arm with
  its own literal set beside the both-sourced allowlist. Owned by 11n.
- N9. Delve-shop symmetry work (11j-D-B): the shop file's "these eight" comment becomes ten, both
  exact per-tier arms move four to five, the literal stock pin grows by two rows, the
  craftedTools.length floor moves, and the farming craft-only pin narrows to rungs 1 to 3 with its
  reason written. Owned by 11j.
- N10. bot/logic.ts's farming kind-union member and its two cards (ip-16-SURFACES b): the union
  member, two card renderers, the bot's own tests, and an entry in bot/CLAUDE.md. Owned by Phase 16;
  no phase touches bot/ today.
- N11. The headless/CLAUDE.md CUT record (ip-16-SURFACES c), naming ctx.lockoutNowMs() as the
  structural reason and the virtual clock as the re-admission condition. Owned by Phase 16; no phase
  touches headless/ or python/ today.
- N12. Admin market-metrics widening plus its i18n (ip-16-SURFACES d), every string through t()
  because operators are users. Owned by Phase 16, which names the question but budgets no work.
- N13. Promoting naming-audit.md and power-verification.md to docs/design/ and re-pointing their
  citations in tests/originality_renames.test.ts and tests/ip_scrub.test.ts (ip-17-TEARDOWN). Owed
  in-packet regardless of the teardown decision; owned by Phase 17.
- N14. The aura-exclusivity pin spanning well_fed and elixir_<kind> that also asserts wellfed_<kind>
  exists nowhere after the unification (ip-15-KIT). Phase 15 names it; 11c is the natural home,
  since 11c is what makes the assertion true.
- N15. The stale items.ts tier-4-fine-twin comment (11h GATE D, 11j Agent 3 and 11k Agent 2 all
  instruct their session to correct it). 11h OWNS it, because it runs first under this ruling set;
  11j and 11k must find it already corrected and not re-correct it, and their files need that
  sentence.

### THE RECONCILE PASS, 2026-08-20 (rows 112 to 116, appended the same day)

The delegation pass wrote 111 rulings and rewrote the 11-block phase files against them. The
reconcile pass then swept EVERY packet file, including phases 12 to 17, the README, the
implementation plan and the decisions index, against those rows. It found six gates the
delegation pass had not reached, seven cross-file contradictions, and one arithmetic error in
a landed ruling. Everything it found is either fixed in place or recorded below.

112. ip-15-ACCESS. R5 measures the GEARED INDIVIDUAL at full food uptime, never the raid
     aggregate, and Phase 15 states the model explicitly in power-verification.md and in its
     ledger. A feast moves DELIVERY, not the ceiling: it takes a raid from partial uptime to
     the uptime the individual measurement already assumed. That is access, and under
     masterwrought R18 and masterwrought R21 it is the intended reward for preparation, so it
     does not enter the R5 arithmetic. WHY: every knob R5 names is a per-character stat (flask
     15, food 6, apex enchants, 2 Perfected pieces), and ip-15-KIT already re-authored the
     premise to "the best available food, ALWAYS ON, delivered by feast", which bakes 100
     percent uptime into the measurement; phase-15 was still carrying this as a take-it-to-the-
     maintainer question after that ruling landed.
113. ip-16-METRICS. Resolves the open half of ip-16-SURFACES (d): WIDEN the admin market
     metrics to cover produce, seeds and compost. Scoping the dashboard copy instead is
     REJECTED. Every string goes through t() either way, because operators are users, and the
     record names which surfaces moved. WHY: masterwrought R21 is demand-side design, and the
     market metrics are the only instrument that shows whether the world eats what the crafts
     make; a dashboard that measures the crafting half and not the gathering half leaves the
     packet's central claim unmeasurable on the surface built to measure it.
114. ip-NAME-BORDERLINE. CLOSED 2026-08-20 BY THE MAINTAINER, narrowly. Supersedes the
     earlier hand-back AND the wider reading taken minutes before it.
     THE RULING: rename the PROFESSION-RELATED name; leave the world alone. The maintainer
     first said to change them all to avoid the risk, then scoped it on seeing what the list
     contained: "if these are zones like map zones, let's not mess with that. Let's just stick
     to profession related stuff please."
     RENAME, IN THIS PACKET, owned by Phase 16 inside its merged naming-registry pass: the
     'Enchant <Slot> - <Stat>' scheme, the ONLY profession-related entry on the list. Verbatim
     WoW formula trade dress on ENCHANTING content this packet already rewrites, so it is in
     scope by subject as well as by risk; the distinctive suffixes were already originalized
     (Runed Sigil, Runed Weave), leaving only the scheme to re-cut.
     DO NOT RENAME, and no phase in this packet may touch them: the zone families The
     Amberfall, The Frostveil Reach, The Nightbloom, Galecrest and Voidscar, and the
     timing-parallel coins (Brutok, Brother Halven, Aetherwell, Gravelight, Summon Emberkin),
     which are mobs, NPCs and abilities. These are WORLD IDENTITY, not professions. Every one
     was judged BORDERLINE rather than infringing under R15's bar for NEW coinage, several
     plausibly PREDATE the other property, and a shipped-zone rename cascades through zone
     identity, POIs, quest text, derived deed and item names, the map, the wiki, the guide and
     every locale. Measured once so nobody re-derives it: Amberfall 61 files / 124 source hits,
     Frostveil 102 / 156, Nightbloom 72 / 149, Galecrest 71 / 174, Voidscar 18 / 21.
     REFUTED AND KEPT: Highwatch (item 2) and Moonrest (item 4).
     There is no follow-up rename packet and none should be scheduled from this row.
     Only ip-17-PUSH remains handed back.
115. ip-16-STOREFRONT-DRIFT. phase-16-polish.md carried a STEP 0 gate and a STEP 2 instruction
     telling its session to MAP the three title-bearing deeds into ACHIEVEMENT_MAP, in direct
     contradiction of 11k-D-K3 and ip-16-SURFACES (a), which CUT every storefront row this
     packet would add. The rulings stand unchanged and phase-16 is corrected: map NOTHING, the
     84 pin does not move, server/steam/ and server/epic/ stay untouched, and the deliverable
     is ONE packet-level non-mapping record. WHY it is recorded rather than silently fixed: a
     phase file that instructs the opposite of its own ruling is the exact failure 11e-qa-PRE
     names, and this one would have shipped an ACHIEVEMENT_MAP row nobody ruled for.
116. reconcile-DRIFT. The doc drift this pass fixed, listed so Phase 17 can verify it rather
     than rediscover it. (a) decisions-index.md's NNb/NNc row said 11l, 11m and 11n were NOT
     ADMITTED pending a maintainer gate; corrected to thirteen inserted phases, all admitted
     (11m-ADMIT, N2 discharged). (b) README.md said "the ten inserted phases 11b to 11k" twice
     and named only R17 to R20; corrected to thirteen, 11b to 11n, and R17 to R23. (c)
     implementation-plan.md's 11f summary said the phase gives farming rows at 125, against
     11f-GATE-A's band table 0:4, 25:3, 50:1, 75:2, 100:4, 125:0. (d) Its 11h summary claimed
     the 150 rung (against 11h-150) and claimed recipe_seasoned_stock (against 11h-GATE-F and
     11g-D-C); the phase-summary table row said "bills 75 to 150". (e) Its Phase 15 arm credited
     apex feasts to 11h, which 11h-GATE-E cut. (f) progress.md still told 11b STEP 0 to confirm
     the F14 twin was "deliberately waived", against 11b-qa-GATE-9's finding that the round was
     folded into the phase record and only the FILE is missing. (g) Phases 12, 13, 14, 15, 16
     and 17 each still opened with "Confirm maintainer decision N ... Default per the
     integration plan", the recommended-default shape 11e-qa-PRE forbids; all six now read as
     instructions. (h) phase-13 said FOUR tier 3 and 4 seed rows where 11b-D-1 says EIGHT. (i)
     phase-14's module placement call still said "choose ONE", already settled at ip-14-UI. (j)
     phase-16's icon park, its Well Fed registry row, its Discord card and its admin metrics all
     still read as either/or. (k) The R-number rule's scope named src/, server/, tests/ and
     CLAUDE.md but not docs/design/, even though docs/design/professions.md is the OTHER
     series' own authority file and 11j writes masterwrought R17 to R20 into it; the scope is
     widened everywhere the rule is stated (11e-D-F amended). (l) Ruling 82's promotion count
     was wrong and is amended in place: FIFTEEN rows move, not eighteen, because guardian_core
     carries no quality field and the original row missed it. The same measurement found three
     tests/material_taxonomy.test.ts arms on no blast list, now written into phase-11l.

### THE QUALITY-REVIEW ADOPTION PASS, 2026-08-20 (rows 117 to 133, appended the same day)

The packet's standing quality review (professions-quality-review.md) ran its FIRST pass
against the plan, as that file instructs, with the built tree measured by script and the
plan phases audited against the maintainer's four complaints. The maintainer adopted EVERY
finding, in their own words: "I love this! I want to do EVERYTHING you mentioned." The rows
below record the adoptions. The review's full report is recorded in
professions-quality-review.md's first-run record; the measured facts cited here (the req-20
cliff, the fishing tail, the engineering on-ramp, the 11l arithmetic) are that report's,
each verified against code before it became a row. One standing guardrail rides the pass
without a row of its own, recorded here so it binds every remaining phase: the Quickening
Catalyst remains the packet's ONLY daily-visit mechanic. The review judged it acceptable
precisely because it is alone and costs only opportunity; a phase that would add a second
daily gate anywhere in professions is out of ruling and STOPS.

117. qr-11o-ADMIT. Phase 11o (the leveling crafter) and its QA twin are ADMITTED, growing
     the inserted block to FOURTEEN phases, 11b through 11o. It runs after 11n and before
     Phase 12, and it MUST land before Phase 15, which measures a settled world. It owns
     three deliverables no other phase owned: the mid-band wearability re-level (row 118),
     the engineering on-ramp (row 119), and the 150-rung re-tier (row 120). WHY: the review
     measured that the crafted rare tier is administratively locked out of levels 14 to 19,
     the longest leveling band, and that no phase 11b to 17 touches recipe.level; a defect
     with a one-line-per-recipe fix and no owner is exactly what an inserted phase is for.
118. qr-11o-WEAR. THE REQUIRED-LEVEL CLIFF. Every rung-50 trainer gear recipe across the six
     gear crafts moves recipe.level 20 to 15, and the three rung-75 grandfathered rares
     (wardweave_cowl, duskhide_wraps, sootscale_mantle) move 20 to 17, so the crafted rare
     tier is wearable in the band where its stats are actually competitive. The measured
     basis: rare-and-above quality derives requiredLevel from item source level, crafted
     source level IS recipe.level (src/sim/item_level.ts), every rung-50/75 recipe ships
     level 20, so thoriumscale_cuirass (score 23.2, best-in-band against a measured 18.3)
     is unwearable until 20 where the epic shelf (26 and up) obsoletes it on arrival.
     ACCEPTANCE, derived not pasted: each re-leveled output's requiredLevel lands at or
     below the character level its craft band naturally pairs with (rung 50 wearable by 16,
     rung 75 by 18); the level-20 shelf is untouched (no apex or heroic number moves, so R5
     inherits no re-measurement); masterwork instances keep gating on the def. WHY nerf
     nothing: the fix moves WHEN crafted rares can be worn, never how strong anything is.
119. qr-11o-ENG. THE ENGINEERING ON-RAMP. Three edits: (a) recipe_bronze_hoe re-tiers
     skillReq 25 to 0 (trainer acquisition kept), so engineering has a learnable row at
     skill 0; (b) ONE new trainer-taught PART at skillReq 0, a junk-kind engineering
     component that joins the shipped recipe_precision_chassis bill as an ADDED reagent row
     (R18's add-never-substitute shape), so the part has a real consumer inside
     engineering's own chain; (c) ONE new trainer-taught GADGET at skillReq 25 with a
     cosmetic-only use or formula-exact band stats (R14 forbids procs; R23 forbids a vendor
     twin), the session's derivation under the naming and obligation rules. Two new item
     ids, art PARKS per ip-16-ICON. ACCEPTANCE: an UNATTUNED character can gain engineering
     0 to 25 through a learnable row, and an attuned major reaches 75 without ever crafting
     the grandfathered tier-3 tool ladder; pinned by test. WHY: measured, engineering has
     nothing craftable below skillReq 75, its cheapest recipe sits above the unattuned
     ceiling, so an unattuned character can never gain a single point; the review named it
     the worst first-hour experience in professions and the one permanently empty cell.
120. qr-11o-150. THE 150 RUNG RETIRES. The three grandfathered land-tool recipes
     (recipe_arcanite_mining_pick, recipe_elderwood_axe, recipe_sunpetal_sickle) re-tier
     skillReq 150 to 125, the reachable cap tier. No admission behavior changes (all three
     are acquisition-less, known to everyone); what changes is the fiction: a tier no
     player can attain stops being printed on three live recipes. The unlearnable-at-150
     LESSON in the ROD_RECIPES and TOOL_RECIPES headers is KEPT as the standing rule for
     new rows, amended in place to record that the three historical rows were re-tiered by
     11o. 11j's Decision A family reading ("three grandfathered rows at 150 that are
     HISTORY") stays correct at 11j's own runtime and gains a forward-carry line naming
     11o. WHY: the review's cut list; a dangling tier above the cap is pure confusion and
     teaches zero to non-majors.
121. qr-11i-PACE. FISHING GETS A PACING ARM (11i DECISION F, new). FISHING_GAIN_SCHEDULE's
     VALUES are re-derived from a measured casts-to-200 model, exactly the R19 discipline
     11e applies to farming's curve: casts per active hour from the shipped cast-cycle
     timing (bite delay, reel window, recast), teaching-catch share per band from the D9
     cell tables, recorded in state.md so the tune is reproducible from the doc. TARGET
     SPAN, settled: the reference angler reaches 200 in about 10 to 12 ACTIVE hours total,
     and no single band costs more than about a third of the total. The four band
     BOUNDARIES (50/100/150/200) are FROZEN, because fishingTeachingCeilingFor derives the
     water teaching ceilings from them. The parity golden professions_fishing_session may
     move and is predicted before observed. 11i's rejection-list entry "Editing
     FISHING_GAIN_SCHEDULE" is OVERTURNED in place with a dated line: it was right to
     protect the ceilings and wrong to leave the rate, because the measured shipped tail
     (0.02 per catch, roughly 2500 teaching catches, on the order of 5000 casts and 11
     hours for the last 50 points, zero character XP) is the program's one outright chore
     and 11i was fixing fishing's reward while shipping its pacing debt untouched.
122. qr-11l-OUT. THE 11l OUTPUT DOCTRINE (the review's highest-risk underspecification
     closed). Every 11l consumer row is a NEW recipe whose resultItemId is an EXISTING,
     currently-uncrafted shipped item, the COMMON_RECIPES and COMBO_RECIPES precedent
     (outputs reuse existing item ids rather than minting). Selection checklist, executed
     per row: the output has no existing recipe (recipeForResultItem documents that no two
     recipes share a resultItemId, and battlefield-XP attribution rides that uniqueness);
     the output's quality is at or below the rung's ladder quality; the output's flavor
     matches the profession; the row's value arithmetic (output strictly between the
     trophy's sellValue and the bill's total input value) is printed in the row comment. A
     mapping for which no defensible existing output exists is EXCLUDED and recorded,
     exactly like a value exclusion. NO bill edit to a shipped recipe is permitted in 11l:
     new rows only, so no shipped craft gets more expensive.
123. qr-11l-VALUE. 11l-RUNG GENERALIZES to every adopted trophy, and the counts are
     corrected. The worth-more-than-the-vendored-input test applies to ALL adopted ids, not
     only the two high-value ones, because tests/recipe_economy.test.ts bounds every output
     below its bill's input value, so a trophy can only be adopted if some rung's output
     value clears its sellValue. Measured ceiling on this tree: the highest crafted output
     sellValue is 460, jewelcrafting's is 320. PREDICTED exclusions, re-derived at
     execution: gleamstag_charm 2500, deepfen_pearl 600, emberwing_cinderscale 320,
     old_cragmaws_pelt 300, guardian_core 180. PREDICTED adoption: FOURTEEN ids (21 minus
     the two 11l-HOLDOUT keeps minus the five exclusions), ALL fourteen ship quality
     'poor', so FOURTEEN rows move to 'common'; ALLOWED_UNCLASSIFIED_JUNK is UNCHANGED
     (its four adopted-and-non-poor leavers are now all excluded, and the review measured
     the live set at SIX members, dawnhold_posy and last_keep_signet included, correcting
     11l's "currently carries four"); the poor-survivor set is SEVEN (the six plus
     deepfen_pearl); the isMaterialItem guardian_core negative control STAYS VALID.
     11l-D-11's "NINETEEN adopted, FIFTEEN move" line and 11l-RUNG's "the other sixteen
     adoptions" line are SUPERSEDED by this row; the delegation-pass literal "18 of the 21
     are poor" reads 17. Engineering's trophy lane goes empty under these exclusions, and
     that is accepted: its on-ramp is row 119, not a token trophy row. WHY: the review
     proved the two headline adoptions arithmetically impossible under 11l's own rules and
     the sub-300 trio vendor-losing through any realistic bill; fewer, real consumers beat
     nineteen paper ones.
124. qr-11m-SPREAD. 11m's spread covers ALL SIX thin families and names the mid-band silk
     source. mire_widow (zone2, levels 8 to 10, open world) GAINS the silk tag by name:
     it is the one open-world mid-band spider in the game, and without it the silk floor is
     satisfiable while the reported 5-to-19 hole stays open, because silk's shipped spread
     (bands 2 to 4 plus 20) already meets the two-band clause. horn and gills, once mapped
     by 11m-ORPHAN, are MAPPED tags and must meet the same reachable floor as everything
     else: the phase spreads them too, with the review's measured open-world candidates as
     the starting set (horn: moor_ram, veiled_stag, gilded_stag, frostmane_yeti; gills:
     tide_scuttler, shoal_scuttler beside the four shipped carriers), each tag placed only
     where the flavor reads true. The floor still counts templates; the phase RECORDS spawn
     density per family in the ledger (count-1 named mobs are legal floor members and the
     QA twin's reachability agent judges density), so the metric's blind spot is at least
     written down. WHY: the review proved 11m as written breaks its own test the moment it
     maps the orphans, and cannot force a single mid-band silk source; both defects are
     cheap to fix in the plan and expensive to discover in a session.
125. qr-11m-SUPPLY. FAULT C's SUPPLY premise is corrected in place: rare disenchants yield
     arcane_essence, NOT arcane_shard; shards come only from epic and legendary disenchants
     (DISENCHANT_MATERIAL_BY_QUALITY in src/sim/professions/disenchant_reagents.ts,
     unchanged since the original enchanting commit). A level-20 rare yields roughly 6 to 7
     ESSENCE per disenchant; essence is the best-fed rung of the family (40 consumers, 84
     units over both files). 11m's line claiming "6 to 7 shards per rare disenchant" and
     its stale one-file comparators ("arcane_essence's 19 and arcane_dust's 9"; the
     two-file truth is essence 40 and dust 41) are amended in the phase file by this pass.
     WHY: an executing session aiming shard consumers "at the rung that produces the
     material" would have targeted the wrong rung on a premise its own FAULT C paragraph
     lectures against.
126. qr-11m-QA. Two 11m-qa corrections: the shard mutation in its invariant-decisiveness
     agent becomes "drop the LAST consumer of a material" (dropping one of twelve cannot
     red a presence-only arm, so the written mutation yields a false not-decisive verdict);
     and its scope agent treats ANY new item id as BLOCKING, because decision 12 as settled
     REJECTED minting (the "authorized orphan material" tolerance was stale).
127. qr-11n-WIDE. 11n WIDENS in four recorded ways. (a) The stock-row carve-out grows from
     one row to FIVE: smith_haldren's four byte-identical crafted gear rows
     (eastbrook_arming_sword, eastbrook_chain_vest, eastbrook_wool_trousers,
     tanned_leather_jerkin) are PULLED from his vendorItems alongside the Verane
     bear-elixir pull. The four recipes, items, and prices stay; only the vendor stock
     goes. They are R23's purest competitor shape (identical id, zero margin, unlimited
     restock) and the review found no recorded reasoning for leaving them; the smith keeps
     selling his non-crafted staples. (b) The measured-fault table gains the four food
     rungs the review found broken beyond the two named: fenbridge_rye 243 equals two
     crafted foods, smoked_eel 432 equals frostgill_chowder, trail_hardtack 552 equals two
     crafted foods (all zero margin), and roast_mountain_goat 874 versus
     marlows_grand_roast 980 is 12.1 percent against a 20 percent top-rung target. (c) The
     margin ladder maps onto the six-tier food line EXPLICITLY: the phase assigns each
     vendor food a rung on the 10/15/20 ladder by its magnitude tercile and records the
     mapping, so "by rung" is never a judgment call at a definition. (d) The
     no-crafted-counterpart exclusion set is the FIVE vendor drinks (spring_water,
     marsh_mint_tea, silvermist_cordial, meltwater_flask, glacier_melt), not spring_water
     alone; zero crafted drinkMana items exist, so the whole mana-drink economy has no
     crafted arm, RECORDED as an R21-shaped gap for the record (a crafted drink line is
     future content, not an 11n nerf). Conjured mage food equalling the top crafted food
     at zero cost is recorded as out of R23's vendor-sold scope, with that wording, so
     nobody rediscovers it as a miss.
128. qr-GRAY. THE GRAY-GRIND OBSERVATION, measured and DECIDED: no gain-curve change in
     this packet. The review measured that below-band crafts still gain at half and
     quarter rate, so the cheapest path to any craft skill number is always bulk-spamming
     low recipes rather than crafting the band's real content. Changing
     tierProgressMultiplier mid-packet would invalidate the 11e, 11f and 11i pacing models
     and re-open settled curves, so the packet records the measurement (Phase 15 prints
     crafts-to-cap for the cheap path beside the intended path per craft) and the revisit
     lands in brainstorm.md's future-tier block. WHY recorded rather than fixed: the fix
     is a pacing redesign, not a tune, and every pacing model in this packet was derived
     against the shipped multiplier.
129. qr-12-CADENCE. THE PERFECTING CADENCE GETS AN ACCEPTANCE CRITERION, closing the one
     unbounded design number the review found. Phase 12's rank and attempt counts are
     DERIVED (never pasted) against this target: the reference endgame character (one
     Maker's Ember per week, no banked backlog, R4's accrual untouched) reaches Perfected
     on a FIRST piece in 4 to 6 weeks, and fills both cap slots in 10 to 12 weeks; a
     masterwork head start (R1) is worth about one week. The derivation, its inputs (the
     ember faucet, banked-ember behavior, the head-start size), and the resulting counts
     are recorded in state.md by the phase 12 session. WHY: attempts-per-rank against a
     weekly keystone IS the endgame's whole cadence; seed prices got a delegation row and
     the packet's largest pacing lever had none. RECORDED 2026-08-26: the Phase 12 ledger
     (state.md) holds the derivation; the adopted counts are 4 ranks at 0.8 success
     chance, one of each material per attempt, head start rank 1.
130. qr-CENSUS. CENSUS ERRATA, amended in place where each number lives: fishing's endgame
     bill count measures 2, not 1 (recipe_stormreel_fishing_rod at 75 also consumes
     glimmerfin_koi; both rows are rods, so "fishing feeds only itself" stands); mining
     measures 20 under the node-family derivation; the corpse-harvest family list was
     never pinned (11 claimed, up to 21 under the widest reading). The family definitions
     behind the BEFORE column are pinned by 11j Agent 1's derivation, and 11j's BEFORE
     column carries this row's note so a prediction mismatch at 11j is read as this
     erratum, not as a lost row.
131. qr-R17-SWEEP. ONE R17 SWEEP, not two. 11f Agent 6 CREATES the R17 firewall test file;
     11h Agent 5's FARM_CROPS-derived sweep EXTENDS that same file rather than authoring a
     sibling, and both phase files name it. WHY: the review found the two phases authoring
     independent guards for one invariant with different carve-out shapes and no
     cross-reference, the exact two-guards-disagree failure the packet's own rules name.
132. qr-DOC-DRIFT. THE DRIFT SET THE REVIEW FOUND, all fixed by this pass in the files
     where each lives: implementation-plan.md's settled-gates paragraph (two open items
     and "no phase may act on ip-NAME-BORDERLINE", contradicting row 114 and phase-16's
     instructed rename; a Phase 16 session obeying it would have silently dropped the
     maintainer's ruling); decisions-index.md's matching two-open-items claim; THIS FILE's
     own block header (see the amendment in the delegation preamble above); phase-11e's
     rejection list still re-arming the fifth-hoe-rung rejection 11j records as overturned
     (amended with a dated pointer); phase-11g-qa's handoff still describing 11h's deleted
     GATE F; phase-11m's stale census lines (rows 124 and 125). Two farming decisions
     silently narrowed without amendment lines now get them: 11j STEP 6 adds the dated
     AMENDED line to D10 (the hoe ladder is five rungs, overturn recorded), and 11e STEP 6
     adds the dated AMENDED line to D21 (the work-order rotation stays at the original
     eight crops, with 11e's no-new-rows verdict as the reason), both in farming/state.md
     once 11b's move creates it.
133. qr-GATE-DOC. THE GATE MODEL GETS DOCUMENTED. Phase 16's content-surface sweep adds a
     short "how crafting gates" paragraph to docs/design/professions.md citing
     crafting.ts: there is deliberately NO skillReq admission gate at craft time; bands
     gate TEACHING (teachTierMet over both channels) and SKILL GAIN (the archetype
     ceilings and tier-distance multipliers) and the masterwork ceiling, so a low-skill
     crafter with materials can always craft a known recipe for a friend. Any packet
     R-number in that paragraph reads "masterwrought R<n>" in full per the namespace rule.
     WHY: the review judged the design good and undocumented, reading like a bug until
     traced; writing it down is what stops a future contributor from "fixing" it.
134. qr-11n-NINE (2026-08-25, maintainer ruling relayed in-session; RECORDED, never
     re-decided). The 11n STOP on the both-sourced re-derivation is RESOLVED: the set
     re-derives to NINE ids (the phase file's 2026-08-25 correction section lists them)
     and 11n-BOTH WIDENS to that re-derived set. Classification over the nine: the four
     smith_haldren gear ids (eastbrook_arming_sword, eastbrook_chain_vest,
     eastbrook_wool_trousers, tanned_leather_jerkin) are handled by the settled
     stock-row pulls (five rows total per qr-11n-WIDE, still exhaustive); the
     magnitude-exempt allowlist is FIVE ids: minor_healing_potion,
     lesser_healing_potion, elixir_of_the_bear, tough_jerky, linen_pouch.
     lesser_healing_potion is EXEMPT exactly like minor_healing_potion: the 11l QA
     re-pick made it both-sourced, so decision 13's illustrative "190 to 173" nerf no
     longer applies (one id, two sources; a nerf would hit the crafted arm, which the
     phase's own premise forbids), and the lesser hp rung is recorded as EXEMPT, never
     as a miss. linen_pouch is a BAG, not a consumable: allowlist-only, no action. The
     ladder therefore binds on lesser_mana_potion (250 to 226), healing_potion (320 to
     279), mana_potion (410 to 354) and the food line; the executing session re-derives
     every number from the tree rather than pasting these. The STOP rule RE-ARMS at
     NINE: if the set re-derives to anything else, or a sixth stock row seems needed,
     or closing any gap would require raising a crafted magnitude, STOP.
135. p13-OPEN-RELIQUARY (2026-08-27, Phase 13; RECORDED as an open item, deliberately
     NOT decided). Whether a player-named legendary INSTANCE triggers the Reliquary
     same-change obligation is unaddressed in both packets: masterwrought's open
     decision covers four crafted-primary epic tools, and farming concluded no farming
     item qualifies today. Phase 13 shipped the orange promotion (a Perfected copy
     consumes a deed_of_making and takes rolled.quality 'legendary' plus a
     player-chosen payload.name) WITHOUT authoring a Reliquary page for the promoted
     instance class: the reliquary model is keyed on ITEM DEFS and the promotion mints
     no def (no shipped id changes, R3), so the pinned gear-capable set
     (['copperlens_ocular'], 7) stood unmoved and the content-obligations sweep ran
     against the merged Reliquary pins with no demand. The open question for the
     maintainer: should a FUTURE reliquary rung exist for promoted instances (an
     instance-class page, not a def page), or is the Book of Deeds credit
     (prog_legendmaker) the complete cosmetic record? Owner: maintainer; until ruled,
     no phase may author an instance-keyed reliquary page.
     RULED (qr-19-named-legendary-instance-reliquary-page, 2026-09-01, under
     qr-19-best-for-project): NO Reliquary rung for the promoted copy, now or later,
     and ruling 135 CLOSES here. The Book of Deeds credit is the complete cosmetic
     record, and it is TWO credits rather than the one this row names:
     col_first_legendary (renown 0, on the quality:legendary visit mark) and
     prog_legendmaker (renown 50, on the legendariesForged stat), both in
     src/sim/content/deeds.ts, both stamped by promotePerfectedCopy and both proven to
     land on the SAME TICK as the promotion by tests/orange_promotion.test.ts. THE
     GROUND IS THE DEF-KEYED MODEL, NEVER A CONQUERABILITY CLAIM:
     docs/design/reliquary.md rule 3 bounds membership by construction to authored
     catalog ids, rule 5 fills item-globally by item id, and serializeReliquaryState
     persists def keys and allowlisted mark ids only, so a rung keyed on one named
     copy sits outside the shipped model rather than merely unbuilt, and would amend
     both rules to exist. The conquerability wording is refused on purpose: the 11j QA
     already found a Reliquary decline right for the wrong reason on exactly that
     ground (the shelf catalogues three crafted rods, so the claim was false on its
     face), and this packet does not repeat the error. The bounded instance-CLASS MARK
     shape is DECLINED too, not deferred: it would seat a mark whose entire content is
     that a promotion happened, which both deed credits already say, and it would
     carry the whole mark chain (the RELIQUARY_PROFESSION_MARKS seat, a
     noteReliquaryMark call, RELIQUARY_MARK_ENGLISH, RELIQUARY_MARK_GUIDE_NAMES plus a
     wiki regen, an i18n leaf and both cell resolvers) for no information a player
     does not already hold. The refusal is written into the Locked decisions block of
     docs/design/reliquary.md in the same commit, so a future page author reads it
     where they look. Zero code, zero pins.

## Locked design decisions

The fun thesis, stated once: farming is the check-in skill. It converts logins into
progress, holds the player's state in the world, and NEVER punishes absence. Anti-chore
is load-bearing: no daily resets, no wither or decay, nothing rots, a late harvest costs
only opportunity. Two visits per crop cycle, ever. Any phase that adds a third required
visit or a punishment for lateness is violating the design, not tuning it.

- D1: Farming is the FIFTH gathering profession. `'farming'` appends LAST to the
  `GatheringProfessionId` union, `GATHERING_PROFESSIONS` (with `maxSkill: 100`), and
  `GATHERING_PROFESSION_IDS` (append-last preserves iteration order for every consumer,
  the fishing precedent). Skill tiers gate at 0/25/50/75 (the shared 25-point band math
  in `src/sim/professions/proficiency_bands.ts`). It is NOT an eleventh craft: never
  touch `CRAFT_RING`.
- D2: Fishing-shaped integration, NOT node-shaped. There is NO new `GatherNodeType` and
  nothing joins `GATHER_NODES`. Patches are their own content table `FARM_PATCHES`
  (planned: `src/sim/content/farm_patches.ts`) with their own pure-leaf zone side table
  (planned: `src/sim/professions/farming_zones.ts`, the `fishing_zones.ts` template:
  `Object.hasOwn` reader, explicit row per zone, derived not independent knobs).
  Rationale, verified: a new `GatherNodeType` is conscripted by
  `tests/professions_zone_rollout.test.ts` (R37) and `tests/gather_node_placement.test.ts`
  into every zone at exact pinned counts. Farming instead adds its OWN rollout arms
  keyed to an explicit set: `FARMING_ZONE_TIERS = eastbrook_vale (tier 1), mirefen_marsh
  (tier 2), thornpeak_heights (tier 3), evergarden (tier 4)`, plus its OWN placement
  guard suite cloning the physical-safety arms (dry land, no collider overlap, reachable
  stand spot, zone containment, spacing) for `FARM_PATCHES`. Hub anchors for patch
  sites and farmer NPCs: eastbrook_vale at Eastbrook, mirefen_marsh at Fenbridge,
  thornpeak_heights at Highwatch, and evergarden at the formal parterre grounds.
  CORRECTED IN PHASE 2 against shipped content: the Evergarden DOES have a named hub,
  Hedgewick at (320, 810) (EVERGARDEN_ZONE.hub, src/sim/content/evergarden.ts); the
  parterre is the POI 'the_statuary_walk' ("The Parterre Walk") at (360, 875). The
  parterre grounds remain the PATCH-SITE anchor (the beds sit on the parterre lawn),
  but every hub-reachability arm floods from the ZONE hub, Hedgewick, because that is
  what the cloned hubFloodStart reads. Phase files may use these hub names; this
  mapping is the anchor.
- D3: Growth is wall-clock and offline-friendly. Stage deadlines are epoch-ms values
  evaluated against `ctx.lockoutNowMs()` (the `raidLockouts` idiom, the ONE sanctioned
  wall-clock seam; server injects the realm clock, the offline browser host degrades to
  session-local growth, consistent with the documented offline-taster ruling). Plot
  state is per player: `PlayerMeta.farmPlots` (a `Map`, so an empty one canonicalizes
  cleanly in the parity sampler) persisted as an OPTIONAL `CharacterState` field with
  defaults, normalized on load. Patches are shared world fixtures; each player grows
  their own crops in them (the per-viewer node-readiness precedent). No world
  persistence, no housing, no land scarcity. The public plot projection (the facet
  read and the fplot wire key) exposes ONLY: bed id, crop id, planted-at, ready-at,
  the applied knob flags, the Phase 8 notified flag, and a server-derived status
  (growing, ready, withered; withered surfaces only at or after ready time). The
  pre-rolled outcomes and the yield seed never leave the server.
- D4: Determinism contract. ALL randomness draws at player-action moments through
  `ctx.rng`. At plant time the full growth script is pre-rolled (per-stage survival
  outcomes and the yield seed), the fishing hidden-bite-delay template scaled up. ZERO
  draws at timer expiry, in the tick sweep, or at login. Farming states its draw-count
  contract (N draws per plant, M per harvest, 0 on denial) and pins it, and ships a
  parity scenario that drives a real plant-grow-harvest session in the same phase as the
  growth engine (fishing's documented scenario gap is not inherited).
- D5: Pacing (tuning constants live in content, maintainer-adjustable): tier 1 crops
  30 to 60 min, tier 2 about 2 h, tier 3 about 4 h, tier 4 overnight. Growth continues
  while logged out.
  - AMENDED 2026-08-21 (masterwrought Phase 11e): the bands are unchanged, but they
    now hold FOUR crops each at tiers 3 and 4 rather than two, so "no two crops of a
    tier share a duration" binds across four. The new values are 250 and 260 minutes at
    tier 3 and 615 and 645 at tier 4, each inside its band and each above the tier's
    pre-11e minimum. That FLOOR is a new constraint this amendment adds and D5 did not
    state: a shorter upper-tier crop turns a bed over faster and accelerates the gain
    ladder, so no future crop may undercut its tier's minimum either.
- D6: Survival. Planting requires farming skill at or above the crop tier threshold.
  One full band above the threshold survival is 100 percent, always (out-leveling a crop
  permanently retires its risk). Inside the band, base survival ramps from roughly 85
  percent at the gate to 100 percent at the band top, scaling with skill. Compost adds
  10 points, farmer's watch adds 10 points, capped at 100. A failed crop yields withered
  husks (a real item with a real consumer, the wolf_fang rule): failure composts into
  the next attempt's insurance.
- D7: Yield, the harvest-lives model (OSRS reference, our own constants): a plot starts
  with a guaranteed floor of picks (base 3); each pick rolls a skill-scaled chance to
  not consume a life. Growth tonic (crafted by alchemy FROM HERBS, the cross-profession
  trade) adds a chance of bonus picks at harvest. One knob one job: compost is survival,
  farmer's watch is survival, tonic is yield, skill improves both.
- D8: Front-loaded only. Every choice (seed, compost, watch, tonic) happens at plant
  time. There is no mid-growth interaction of any kind, required or optional.
- D9: Farmer's watch is paid in kind: any farming produce of the patch's tier or
  below, consumed from bags as a plant-time knob (no NPC range gate: paying is
  front-loaded at the bed per D8; the farmer NPCs are the FLAVOR of the service and
  the vendors of its supplies). Bootstrap: brook_carrot doubles as the starter fee
  vegetable, vendor-stocked by farmer_jessica at Eastbrook with a buyValue at the
  four-times-sell convention (priced in Phase 5, stocked in Phase 9), so a day-one
  player can pay their first fee. Compost is likewise vendor-stocked (its buyValue is
  assigned when the item lands in Phase 4, stocked in Phase 9). The growth tonic is
  never vendor-stocked (alchemy-crafted, sellValue only). Watch fees are a produce
  sink supporting crop prices.
- D10: One tool, the hoe: a four-rung ladder of ordinary items with
  `use: { type: 'gatherTool', professionId: 'farming', tier }` riding
  `canGatherTier` and the frozen wield-gate thresholds for free. Recipes follow the
  `TOOL_RECIPES` pattern; the top rung is unpriced and craftable (the R23 arm). Hoes
  accept the three existing tool effects (unlike fishing rods; the policy gate in
  `slotToolEffectRefused` admits farming).
  - **AMENDED 2026-08-23 (masterwrought Phase 11j, qr-DOC-DRIFT): THE LADDER IS
    FIVE RUNGS.** The four-rung reading above is superseded, and the maintainer's
    OVERTURN is the reason rather than a drift: an earlier draft rejected a
    rung-5 hoe on the ground that the Maker's Charm already covered the gap, and
    that was overturned because the charm is an EFFECT SLOT and not a tool. The
    two are complements, and the code says so: `startingDurabilityFor` reads the
    BASE TOOL's rarity and pays `RARITY_DURABILITY_BONUS` extra charges per
    rarity rung, and `ratchetCeilingForUse` prices the refill ceiling off the
    same rarity, so a farmer capped at the rare `osmium_hoe` ran the same charm
    at a strictly lower charge ceiling than a miner running it on an epic pick.
    Every other gathering profession had BOTH a tier-5 base tool and the slot;
    farming had only the slot. The fifth rung is `evergarden_hoe` (epic,
    use.tier 5, sellValue 150), minted by `recipe_evergarden_hoe` at engineering
    125 on `['trainer']`, and it satisfies this decision's own ladder shape and
    the one-tier-below invariant with neither amended. The frozen wield-gate
    thresholds still ride for free: the tier-5 row reads 100 and farming's cap
    is 100, so the rung wields AT the cap and nowhere below it.
- D11: Crops, two per tier, eight total (ids locked, display names get a maintainer
  lore pass): tier 1 `vale_wheat`, `brook_carrot`; tier 2 `marsh_rice`, `bog_beet`;
  tier 3 `highland_barley`, `frost_gourd`; tier 4 `gilded_sunmelon`,
  `evergarden_greens`. Every crop ships seed + produce + `fine_` twin (the
  `MATERIAL_GRADES` requirement) + at least one consumer recipe in the same phase.
  Produce is `kind: 'junk'` (browses under the market's material filter), sellValue per
  the materials convention, market-listable by default. Seeds: tiers 1 and 2 are
  vendor-stocked WITH a positive `buyValue` (the dead-row trap: a vendor row without
  one renders then refuses); tiers 3 and 4 come from harvest seed-back rolls and the
  rare event, so high-tier seeds are market goods. Planting consumes the seed.
  Sanctioned same-phase-consumer exception: Phase 3 lands a minimal testable slice
  (vale_wheat seed and produce plus the fine_vale_wheat twin, and withered_husks)
  with consumers explicitly deferred (husks to the Phase 4 convertHusks command,
  produce to the Phase 6 dishes); the rule is then enforced for the full crop set by
  the Phase 5 rollout arms and closed by Phase 6. [CLOSED by Phase 6: FARM_RECIPES
  landed the dishes and the tonic craft, the rollout closure arm derives recipe
  consumers from merged ALL_RECIPES, and the five-twin deferred literal is gone;
  see the Phase 6 items/recipes ledger entry.] [The original "and its grades row"
  clause here is AMENDED by deviation (o): fine twins ship as ordinary items with NO
  MATERIAL_GRADES row; that table is pinned as exactly the nine node yields, and the
  fine roll lives in farming's own harvest resolver.]
  - AMENDED 2026-08-21 (masterwrought Phase 11e, DECISION B): the roster is TWELVE,
    shaped 2 / 2 / 4 / 4. Tier 3 gains `thornpeak_cabbage` (leaf) and `frost_lentils`
    (legume); tier 4 gains `gilded_yam` (tuber) and `evergarden_pumpkin` (gourd). The
    original eight ids are unchanged and none was renamed, which matters because they
    are persisted save keys. Every new crop ships seed, produce, fine twin and a
    same-phase consumer, so the rule this decision states is kept rather than
    stretched. The COMPOSITION is now itself a rule and not flavor: no tier repeats a
    plant class, and tier 3 carries a leaf, because a later phase reads that shape.
  - AMENDED 2026-08-21 (masterwrought Phase 11e, GATE 1 / DECISION D): the seed clause
    above is superseded in its second half. Tiers 3 and 4 are NO LONGER seed-back-only
    market goods: all eight upper-tier seeds are vendor-stocked at the tier's own
    farmer with a positive `buyValue` (32 at tier 3, 64 at tier 4), the same dead-row
    rule tiers 1 and 2 already followed. Seed-back rolls and the rare event survive
    unchanged as the thrift path; the vendor is the BOOTSTRAP, priced at twice the
    four-times-sell convention precisely so it does not become the cheaper permanent
    source (a tier-3 harvest expects 0.48 seeds back, a tier-4 one 0.41).
- D12: The rare event is `golden_harvest`: a fourth flavor on the existing
  `gatherRareEvent` SimEvent shape, rolled at harvest (1/90, the shared constant),
  five-fold yield, always signed, zone-announced through `announceGatherRareEvent`'s
  path so the HUD case stays single.
- D13: Deeds (append-only, cosmetic, zero rng): first planting, a first-harvest
  chronicle per farming zone (`farm:<zone>` visit marks with an earnability table, the
  `ZONE_FISH` template), a golden-harvest deed, and a farming-100 title. The
  `tests/deeds_content.test.ts` totals (deed order length, total renown, title count)
  re-pin deliberately in the same change.
- D14: Ready notices. On login: a check inside `Sim.addPlayer` immediately after saved
  state restore (beside the `mailWelcomed` one-shot and the deeds retro block), obeying
  the same three rules: no rng, flag-or-state-derived only, personal-only text-free
  SimEvent. While online: a 1 Hz sweep (`ctx.tickCount % 20`, the guild_letter idiom).
  Both surface as an ambient-class banner via the banner queue plus a chat line. Never
  mail (an inbox is an obligation surface).
- D15: Well-fed buff food follows the elixir arm precedent exactly: minted inline from
  a new `ItemDef.wellfed` field, applied via `ctx.applyAura` from the food path in
  `src/sim/items.ts` (never through `effect_dispatch`), with aura ids in a DISTINCT
  namespace `wellfed_<kind>` so food never clobbers `elixir_<kind>` (the documented
  exclusivity-slot trap). Every new aura name gets an `AURA_NAME_KEY` row. Magnitudes
  are modest, classic-era, at or below the existing elixir budget ceilings; crafted
  power stays below the raid floor.
  (SUPERSEDED IN PART 2026-08-21 by decision 2, executed in Masterwrought 11c.
  STANDS: the completion-timing half (with (bx)) and the food-path half (the mint
  fires from the eating slot's completion, via ctx.applyAura, never through
  effect_dispatch; deviation (bx) unaffected). SUPERSEDED: the `wellfed_<kind>`
  namespace half and the BaseItemDef `wellfed` field half: the one aura id is
  'well_fed' (WELL_FED_AURA_ID, src/sim/wellfed.ts), kind-agnostic, so the whole
  food family is one-at-a-time and elixir coexistence holds because the ids can
  never collide; the one field is FoodItemDef.wellFed, kind-scoped. The "at or
  below the elixir budget ceiling" calibration was retired with the namespace:
  it produced the trainer-over-apex inversion the 11c-D-2 ladder removed.)
- D16: The shared feast (the tier-4 showcase): placed by a player, spawns a REAL entity
  so the normal entity snapshot carries it to everyone (the battleground flag precedent;
  the mobile-station `mst` scalar cannot carry a shared world object and has no render
  seam). Server-side state: charges remaining, a per-player consumed ledger (the
  `creditedObjects` stable-key idiom), tick-domain expiry. Transient, never serialized
  (the mobile-station rationale: tick-domain expiry is not restart-safe).
- D17: IP-safe naming is a standing rule: no coined terms from other games (no
  supercompost, no borrowed plant names), real plant words and original zone-flavored
  coinages only. The window is the Harvest Journal (Farmer's Almanac collides with real
  trademarked publications). Audit every new name at authoring time.
- D18: UI. The Harvest Journal is a proper HUD window: DOM-free pure view core in
  `UI_PURE_CORES` plus a thin painter on the `PainterHost` seam, composed by the HUD.
  It lists every plot, contents, growth stage, time remaining, and applied knobs; map
  and minimap pins mark the four patch sites. Countdown rendering copies the
  daily-rewards pattern (dedicated interval, data-attribute rebind, absolute times via
  `formatDateTime`, mm:ss via a t() token template, buff durations via
  `compactAuraDuration`). Ship the timer UI in-game: the OSRS lesson, non-negotiable.
- D19: Art. Wave 1 is procedural, swap-ready GLBs through the image-to-glb pipeline
  (fixed footprints and pivots so sourced models drop in later without code changes).
  The replacement handoff manifest lives at `docs/design/farming-asset-manifest.json`
  (in docs/design so it SURVIVES packet teardown). Growth stages render per crop
  family (grain, root/leaf, gourd) with shared early stages; the field is the progress
  UI (visible stage changes, wet-soil plant state, withered silhouettes).
- D20: The intro quest: farmer_jessica at Eastbrook (the user-required name) gives a
  two-step quest on the `q_prof_intro` template (accept, plant one vale wheat, return
  whenever to harvest), with a farming objective arm crediting the ACTION (the gather
  objective precedent: inventory cannot prove the deed). Her dialog states the magic
  sentence: it keeps growing while you are away, and it never spoils. No tutorial
  system beyond this.
- D21: Work orders: farming produce rows join the repeatable work-order rotation with
  the machine-enforced payout arithmetic (`copperReward` equals
  `floor(WORK_ORDER_PAYOUT_FRACTION * summed vendor sellValue)`, guarded by
  `tests/professions_work_orders.test.ts`; leave the arithmetic comment on every row).
  - AMENDED 2026-08-21 (masterwrought Phase 11e, qr-DOC-DRIFT): the rotation stays at
    the ORIGINAL EIGHT crops. Phase 11e added four and deliberately gave them NO
    work-order rows, so D21's "farming produce rows" no longer reads as universal and
    must not be read that way. The reason is the arithmetic this decision itself
    names: the payout is a flat 0.5 of summed vendor sellValue, so pointing it at
    top-of-curve produce mints copper, and it would be found later as an economy bug
    rather than as a decision. Verified structurally rather than by omission: no
    work-order path derives its rotation from FARM_CROPS or FARM_CROP_IDS, so the four
    new crops are outside it by construction. A future phase that wants them in owes a
    payout model first.
- SUPERSEDED IN PLACE (2026-08-20, the Masterwrought 11b absorb, ruling
  11b-D-3 / masterwrought decision 3): D22 below and its addendum's arm (B)
  are superseded, never deleted (the never-renumber rule requires supersession
  in place; the bodies stay verbatim apart from the doc move's path-string
  rewrites, the same carve-out the moved README's banner states, as the record
  of how the packet was actually delivered). What replaces them: farming is ABSORBED into the
  Masterwrought packet (`feature/masterwrought`, merge 424ce89a20 of tip
  8cd964d599), both packets ship as ONE branch and ONE PR under the
  Masterwrought delivery contract, and the (B) "no PR ever" arm is void.
  What the absorb ADOPTS upstream, unchanged: D22's absorb discipline (the
  newest-release re-resolution by version sort, the sync-mid-phase rule, the
  --no-ff phase merges) and one teardown decision over both packets' docs.
  Arms (A) and (C) of the addendum are completed history and stand as
  records.
- D22: Delivery model, LOCAL-ONLY (standing user rule, 2026-08-07; this supersedes
  every push-and-open-a-PR line in the phase files, and state.md wins on
  contradiction): ALL farming work stays local until the user declares the feature
  done. No pushes, no PRs, for anything farming. The integration branch is the LOCAL
  `feature/farming-plan` in this worktree (it carries docs/prd/masterwrought/farming/; originally based
  on release/v0.36.0, it has absorbed every newer release tip since, release/v0.40.0
  e56707a675 as of the twenty-first absorb, 2026-08-19). Every phase: fetch, then branch `fix/farming-phase-NN-<slug>` off
  LOCAL `feature/farming-plan` (never off a bare release tip, which lacks the packet);
  if a newer `release/**` tip exists than the branch has absorbed, merge it INTO the
  phase branch first (release-merge-audit for a nontrivial merge, PLUS the
  deviation (al) absorb checklist for every absorb). SYNC MID-PHASE RULE
  (2026-08-13, the phase-06b precedent): when the pending jump is a minor
  version or more, or the release-delta intersection with the farming footprint
  reaches triple digits, the absorb runs as its OWN mid-phase
  (docs/prd/masterwrought/farming/phase-06b-release-sync.md is the template) BEFORE the next
  feature or QA phase, so an absorb of that size never shares a diff with
  feature work. A finished phase
  merges back into `feature/farming-plan` with --no-ff (the phase boundary stays
  readable) and deletes its branch. The would-be PR body becomes the phase report in
  the progress.md Notes block (including required flags and screenshot references);
  screenshots are still captured and committed under docs/screenshots. Every phase
  file carries a Live-surface note stating exactly what players can reach once the
  feature eventually ships (early sim phases stay dormant: no vendor seeds, no
  render, no UI entry until their enabling phases land). When the user green-lights
  going public, `feature/farming-plan` is pushed and delivered whole.
- D22 ADDENDUM (2026-08-19, three real user amendments given with the Phase 13 QA
  starter prompt; ledgered verbatim, and swept into phase-13-qa.md where its STEP 5
  and final-response wording disagreed):
  - (A) THE PACKET TEARDOWN IS DEFERRED: Phase 13 QA does NOT offer or execute the
    docs/prd/masterwrought/farming/ deletion. Its STEP 5 runs as a PRECONDITION VERIFICATION ONLY:
    confirm the teardown-precondition rows are ledgered and correct (the
    seven-subtree screenshot reference hazard in particular), then leave the packet
    in place. The teardown happens later, on an explicit user instruction.
  - (B) NO PR EVER: when the user later declares the feature truly done, delivery is
    pushing `feature/farming-plan` to origin, nothing more. No pull request is ever
    opened for the farming program. (This sharpens D22's "pushed and delivered
    whole": the push IS the whole delivery.) Phase 13 QA itself still pushes NOTHING.
  - (C) THE PERFECTION SWEEP: Phase 13 QA builds the complete corpus of every finding
    of any severity ever recorded in the program and classifies each into exactly one
    bucket (RESOLVED / ACTIONABLE-IN-REPO / MAINTAINER-GATED / ACCEPTED-BY-DESIGN).
    If ACTIONABLE-IN-REPO is non-empty, it authors docs/prd/masterwrought/farming/
    phase-14-final-polish.md scoped exactly to that list (D22 shape: no push, no PR);
    if empty, it declares the program CODE-COMPLETE pending the maintainer-only gates.
  - PERFECTION SWEEP EXECUTED (Phase 13 QA, 2026-08-19). Universe: the handoff
    table's 117 rows AS THE ROUND OPENED (this round then added the
    teardown-hygiene addendum as a 118th, classified inside the row-56 clause
    below) plus this QA round's own 13 findings (the corpus's per-phase
    findings, 241 restated from every progress.md Notes block, are RESOLVED by
    construction where their disposition says fixed, and every still-live one maps
    to a handoff row; the loaders verified none was lost). Row numbers below use
    the round-open ordering; the table is append-mostly, so re-derive positions
    from the row TEXT if it is ever resequenced. Buckets: RESOLVED 22
    (the 13 closed rows, row 50, the two executed-check rows 51/52, this round's
    five fixed findings, one verified-exact citation), ACTIONABLE-IN-REPO 13
    (handoff rows 38 to 47 plus three of this round's NICE-TO-HAVEs),
    MAINTAINER-GATED 51 (rows 1 to 37, 48, 49, 53, 54, 56 with its hygiene
    addendum, and the nine release-fill rows; row 56 is user-gated on the
    teardown decision), ACCEPTED-BY-DESIGN 44 (rows 55 and 66 to 104 plus four
    of this round's depth/awareness notes). Nothing landed in no bucket. The
    ACTIONABLE bucket is non-empty, so docs/prd/masterwrought/farming/phase-14-final-polish.md is
    authored (PROPOSED; the plan-table row and README line are marked); the
    thirteen items discharge their handoff rows when Phase 14 lands them.
- D23: Parity goldens. Professions fields are sampled into every golden digest, so
  adding `farming: 0` to the default proficiency map regenerates ALL goldens in Phase 1
  (deliberate, `UPDATE_PARITY=1`, its own reviewed commit, the Phase 8 professions
  precedent). `PlayerMeta.farmPlots` is gameplay state: sampled, not excluded. Static
  farmer NPCs shift the world-ctor entity-id counter: same deliberate-regen recipe in
  the NPC phase. Never hand-edit a golden; a red trace means behavior changed.
- D24: Wave 2 parking lot (explicitly OUT of this packet): crop-adjacency buffs
  (approved, held), cultivated herbs for alchemy (approved WITH the displacement
  guardrail: complement wild herbalism, never a second faucet of the identical item),
  premium compost tiers.

## Non-negotiable constraints

- Determinism: all randomness via `ctx.rng`; no `Math.random`, `Date.now`, or
  `performance.now` in `src/sim/` (guarded by `tests/architecture.test.ts`). Wall clock
  only through `ctx.lockoutNowMs` / `ctx.raidResetMs`.
- The seam: extend the `IWorld` facet first (`src/world_api/professions.ts` or a new
  `src/world_api/farming.ts` facet file, never the barrel), implement in BOTH `Sim` and
  `ClientWorld` in the same change, update the pinned member lists in
  `tests/world_api_parity.test.ts`.
- Server authority: clients never decide outcomes; no wire command ever ingests a
  client-supplied `ItemInstancePayload`.
- i18n: every player-visible string is a `t()` key added in ENGLISH ONLY to the matching
  `src/ui/i18n.catalog/` module (never edit locale overlays; M16 wordy strings also need
  their five non-Latin fills in the same change). Sim/server player text is id-carrying
  SimEvents or matcher rules in the SAME change; the S3 guard
  (`tests/localization_fixes.test.ts`) enforces it. New aura names need `AURA_NAME_KEY`
  rows in `src/ui/sim_i18n.ts`.
- Module-first: every new behavior is its own module behind an existing seam
  (`SimContext` for sim systems, view core + painter for HUD, `src/render/<thing>.ts`
  for visuals). Never grow `sim.ts`, `hud.ts`, `renderer.ts`, or `main.ts`.
- No em dashes, en dashes, or emojis anywhere. IP-safe names only (D17).
- Shared-checkout care: commit with EXPLICIT paths, never `git add -A`. All farming
  work in `~/Documents/woc-farming-plan`.
- Never set `ALLOW_DEV_COMMANDS=1` outside dev. Never commit secrets.

## Tick and hook points (verified against release/v0.36.0; re-verified on the merged tree at every absorb, last the seventeenth)

Verified at packet authoring; the branch has absorbed newer v0.36.0 tips since
(6ed4d7e12c as of 2026-08-08), so each phase start re-verifies the hook points
it is about to use.

- The per-tick driver `updateFarming(ctx)` APPENDS after `updateProfNudges(this.ctx)`
  and before `deedsMod.updateDeeds(this.ctx)` in `Sim.tick` (append, never reorder: the
  shared rng stream makes reordering fork every golden). It draws no rng (D4) and does
  no per-tick allocation in the hot path.
- Skill gains go through the shared `queueGatheringGrant` / `drainGatheringGrants`
  queue with a farming-owned gain schedule (the fishing pattern). The drain runs earlier
  in the tick than the profession block, so an end-of-tick grant lands next tick:
  expected, documented.
- The on-login check lives in `Sim.addPlayer` immediately after saved state restore,
  beside the `mailWelcomed` one-shot and the deeds retro block. Flag or state derived,
  no rng, personal events only.
- SimContext extensions (if any callback is needed) touch exactly FIVE sites plus the
  pinned `CALLBACK_KEYS` list in `tests/sim_context.test.ts` and every suite that
  hand-builds a fake host (`tests/world_boss.test.ts`, `tests/dungeons.test.ts`,
  `tests/entity_roster.test.ts`, `tests/heroic_vendor.test.ts`,
  `tests/nythraxis_raid_unit.test.ts`). A pure per-tick driver needs NO new callback
  (the `updateCommissionOrders` precedent).

## Blast-radius reference (verified; phase files cite this, do not re-derive)

Compile-forced by the fifth id: the `GATHERING_PROFESSIONS` record row; any object
literal typed `GatheringProficiency` (mostly test fixtures).

Silent-miss sites that MUST be swept by hand in Phase 1 (no compile error, wrong or
missing copy at runtime): `src/ui/gathering_profession_name.ts`
(`GATHERING_PROFESSION_NAME_KEYS`: an unlisted id renders NO row);
`src/ui/gathering_view.ts` `gatherDeniedLineKey` (falls through to the corpse line) and
`gatherToolNoNodeKey` (falls through to the mining line); the four per-profession key
families in `src/ui/i18n.catalog/hud_chrome.ts` (`toolTierUnmet`, `toolRequired`,
`wieldUnmet`, `noNodeNearby`) plus the profession display name; and the TWO hand-written
guide prose keys in `src/ui/i18n.catalog/guide.ts` that hardcode the trade count,
`guide.professions.whatBody` ("four gathering trades") and
`guide.professions.gatherHubBody` ("Four gathering trades feed the ring ...", also
naming each trade), discovered in Phase 1: neither updates automatically, no test pins
them, and every locale overlay carries translations that go stale on reword (reword the
English count-free, ship the five non-Latin fills per M16, pin against a hardcoded
count, and ledger the stale Latin overlays for the release-time fill). Also discovered
in Phase 1: `src/ui/gather_tool_tooltip.ts` carries an EXHAUSTIVE
`Record<GatheringProfessionId, TranslationKey>` (`KIND_KEYS`, compile-forced, needs a
`hudChrome.gathering.toolTooltip.kind.farming` key) beside two Partial-typed neighbours
(`UNLOCKS_KEYS`, `USE_KEYS`) that miss silently; Phase 1 fills `KIND_KEYS` and
deliberately leaves the Partial pair empty for farming (no hoe item exists yet; the
crops/tools phase revisits them when the hoe lands). And
`src/ui/gather_node_tooltip_controller.ts` (lines 56-66) carries three-key
node-tooltip maps that never listed fishing: farming is fishing-shaped (own
FARM_PATCHES table, never a GatherNodeType), so the deliberate decision is that
farming, like fishing, NEVER gains a row there; if a later phase ever adds a farming
node type this entry is the reminder that the decision was made, not missed.

Latent sites the Phase 1 reviews mapped for LATER phases (each unreachable today,
each bites the phase that ships the named feature):
- The hoe phase: `tierRequired`/`requiresTool` hud_chrome families and the
  `UNLOCKS_KEYS`/`USE_KEYS` Partial maps in `src/ui/gather_tool_tooltip.ts` (call
  sites guard undefined, lines just drop); `useGatherToolItem` returns a SILENT false
  for farming (`NODE_TYPE_BY_PROFESSION` has no farming row, guard at
  `src/sim/professions/gathering.ts` tool-use path), so the noNodeNearby.farming
  denial line stays unreachable until the beds phase decides farming's tool-use path;
  and `slotToolEffectRefused` (`src/sim/professions/tools.ts`) statically REFUSES
  every farming pair (Phase 1 QA finding: without it the admin restore path accepted
  farming pairs it could never grant); the hoe phase LIFTS that refusal arm and its
  pins (tool_effect_tooltip and professions_admin_restore suites, plus the
  Phase-1-QA additions: the self-clearing no-farming-gatherTool tripwire in
  tests/tool_effect_tooltip.test.ts and the restoreSlotBodyError farming case in
  tests/admin/professions_restore.test.ts, both of which red the moment the first
  farming gatherTool lands) when the first farming gatherTool lands. The growth phase also deletes or inverts the structural
  ungainability pin in tests/professions_gathering.test.ts. The wiki page's tools and
  nodes sections length-guard (Phase 1 QA finding: an empty nodes array rendered
  "respawns for you 0 seconds"); the phase that ships farming tools or beds gets those
  sections back automatically, with the render test in tests/guide.test.ts flipping
  to demand them.
- The beds phase: `TIER_REQUIRED_KEYS`, `REQUIRES_TOOL_KEYS`, `NODE_NAME_KEYS` in
  `src/ui/gather_node_tooltip_controller.ts` (hover surface must match the click
  toast); the `gatherDeniedLineKey` comment promise that the beds phase decides which
  surface patches emit.
- The tools phase: `toolEffectSlotsFor` sorts wire rows by professionId codepoint and
  'farming' sorts BEFORE 'fishing', so the first farming tool-effect row lands at the
  FRONT of the wire array (declared contract, but expect the shift).
- The growth phase (first phase where farming proficiency can exceed 0): the parity
  omit-defaults shield ends there (a nonzero farming key enters the state sample), so
  THAT phase re-runs the full golden regen Phase 1 proved unnecessary; it also raises
  GAINABLE_GATHERING_PROFESSIONS in tests/deeds_content.test.ts (the any-N cap guard
  is one-directional and nothing else reds when farming becomes gainable); SimEvent
  payloads must never carry a whole proficiency record (event digests hash with
  omitDefaults false, so a zero key WOULD move them); and the legacy `professions`
  dual-write rollback caveat becomes real (an older binary normalizes over four ids
  and persists the loss; documented in docs/design/professions-tuning-packet.md).
- Release-time i18n reconcile: the five non-Latin whatBody fills say "all eight
  crafts" where English says "seven of the eight" (pre-existing condensation,
  inherited); the Latin-script overlays keep stale "four trades" prose for
  whatBody/gatherHubBody and the count-bearing gatherDeeds rows.
- Pre-existing stale comments inherited, not fixed (outside the Phase 1 diff):
  `src/sim/types.ts` "over the three professions", `src/net/online.ts` gprof comments
  "(Mining/Logging/Herbalism, #1119)" twice, the `src/guide/pages/professions.ts`
  header ("the four gathering professions"), and `scripts/load_professions.mjs`
  GATHER_PROFS (a three-id literal that never gained fishing or farming; bench
  tooling only).

Data-driven sites that just work once the content row exists: `emptyGatheringProficiency`,
`normalizeGatheringProficiency`, `gatheringSkillsView`, the tools and wield-gate
walkers, `characterProfessionsSheet`, `buildGatheringProficiencyRows`, the professions
window gathering section (Phase 1 QA correction: an icon SITE only just-works if it
resolves through `professionIconUrl`, the art-or-procedural resolver;
`professionImageUrl` alone paints nothing for a pending-art id, which is how the char
sheet farming row shipped iconless until the QA round), the wiki generator (auto-adds the farming page; but see the
silent-miss list above: the guide summary prose does NOT update itself, and the
generated farming page takes the node-profession arm of
`src/guide/pages/professions_gathering.ts`, rendering node-harvest prose with empty
tool/node tables until a later phase gives farming its own arm), and the deeds
any-profession arm.
CONSEQUENCE to flag, not fix: farming automatically becomes a way to satisfy existing
any-profession-at-N deeds (accepted default). Phase 1 follow-on for the DEEDS PHASE
(must-do, discovered in Phase 1): the Master Gatherer trigger
(`src/sim/deeds.ts`, computed from `GATHERING_PROFESSION_IDS`) now counts farming, but
its desc in `src/sim/content/deeds.ts` (`prog_master_gatherer`) still reads "any three
of Mining, Logging, Herbalism, and Fishing" (its own comment records the same reword
when fishing joined), and three guide keys
(`guide.profPages.gatherDeeds.{mining,logging,herbalism}`) repeat the stale list. The
deeds phase rewords all four count-free in one deliberate pass WITH their non-Latin
fills (rewording them piecemeal in Phase 1 would stale reviewed overlay prose twice).

Wire: `gprof` carries the fifth key for free (wholesale-replace mirror). The
`tests/snapshots.test.ts` round-trip literal gains `farming: 0`. No new per-entity key;
plot state rides a NEW self delta key (working name `fplot`) registered in
`ALL_DELTA_KEYS` + `TERSE_TO_IWORLD` with round-trip pins.

Test pins that move (re-pin deliberately, never loosen):
`tests/professions_contracts.test.ts` (the exact-order skills array gains a fifth row),
`tests/profession_icons.test.ts` (demands a `gather_farming` procedural icon; Phase 1
found its E2/F checks also pin every recipe id as art-backed in production, committed
128px WebP plus a maintainer-held master SHA in `public/ui/professions/mapping.json`,
which procedural-only cannot satisfy: resolved by a deliberate PENDING_ART allowlist
amendment scoped to `gather_farming`, cleared by the phase-13 asset batch),
`tests/snapshots.test.ts` (literal above), `tests/deeds_content.test.ts` (totals),
`tests/professions_skill_caps.test.ts` and other suites with literal proficiency maps,
`tests/professions_blob_growth.test.ts` (worst-case save blob grows), the wiki
freshness gate (`tests/guide.test.ts`, regen via `npm run wiki:content`), and the full
parity golden set (D23).

R37 (`tests/professions_zone_rollout.test.ts`): farming adds its OWN arms against
`FARMING_ZONE_TIERS` (patch coverage per farming zone, seed/produce/fine-twin integrity,
hoe rungs at each tier with the hub stocking rule, top rung unpriced and craftable,
chronicle deeds earnable). The existing node arms are untouched. The farming station
question does not arise (farming has no station).

## Seam reference (verified; the pattern to copy for each surface)

- Consumables: food/drink sit-restore is `p.eating` / `p.drinking` slots filled in the
  `useItem` food arm; the ONLY timed-buff consumable is the elixir arm (inline aura from
  `ItemDef.elixir`, `ctx.applyAura`, id `elixir_<kind>`). Well-fed copies that arm with
  the `wellfed_` namespace (D15). Buff display: `src/ui/auras_view.ts` +
  `auras_painter.ts`; tooltips beside `elixir_tooltip_view.ts`.
- Placeable feast: real entity + entity snapshot (D16); interaction arm in
  `src/sim/interaction.ts`; charge ledger via the stable-content-key idiom in
  `src/sim/quests/interact_object_credit.ts`.
- Quest: `q_prof_intro` in `src/sim/content/zone1.ts` is the intro template (including
  `requiredItems` re-granting the starter tool). A farming action objective needs a new
  objective arm crediting the action, not a `collect`. Bump `rev` if an existing
  quest's objective indices ever change meaning.
- Vendors: stock is `NpcDef.vendorItems` ids; a row without positive `buyValue` (or
  `priceHonor`) renders then refuses (the dead-row trap). Crafted outputs never get
  `buyValue`. Changing a `sellValue` after a work order references it breaks the
  payout guard: edit both together.
- Notifications: `Hud.showBanner(text, ..., bannerClass)` on the banner queue
  (celebrations FIFO, ambient replaces); the `gatherRareEvent` HUD case is the
  canonical text-free-event-to-localized-line-plus-personal-cue shape; one-shot flags
  flip BEFORE the emit (`mailWelcomed` idiom).
- SFX: new cue = `UI_CUES` key + facade method in `src/game/audio.ts` (widen the
  `UiCue` union for nested families) + the `hud.ts` case + a prompt row in
  `scripts/sfx/sfx_prompts.mjs` + `npm run sfx:ui` (deterministic placeholder) +
  `sfx:manifest` + `sfx:check`; the completeness guard in `tests/game_audio.test.ts`
  fails a key with no file. Placeholder rows are marked for the sound engineer.
  Since the fourteenth absorb the gate also freshness-diffs the SFX manifest,
  the runtime pack, and the gain-ceiling cache (the manifest-freshness family
  in the validation matrix): commit all of them fresh in the same change.
- Countdowns: the daily-rewards window owns the live-countdown pattern (dedicated
  interval, `[data-...]` rebind, `formatDateTime` absolutes, t() token mm:ss). Copy it;
  never hand-build a clock string with a literal colon.

## Validation matrix (run what the change type demands)

- Any code change: `npx tsc --noEmit` (fast native TS7) and
  `npm run ci:changed` (biome on changed files only; fix with a SCOPED
  `npx @biomejs/biome check --write <file>`, never whole-tree).
- sim change: the affected `npx vitest run tests/professions_farming*.test.ts` plus
  `tests/architecture.test.ts` (purity) and `tests/sim_context.test.ts` (if the seam
  moved); same-seed determinism pins.
- Player text or emit changed: `npx vitest run tests/localization_fixes.test.ts` (S3).
- Wire/snapshot change: `npx vitest run tests/snapshots.test.ts
  tests/env_protocol.test.ts tests/bandwidth.test.ts`.
- Parity-adjacent change: `npx vitest run tests/parity` BEFORE touching goldens; regen
  only deliberately (`UPDATE_PARITY=1`) in an isolated commit.
- Content change: `tests/professions_zone_rollout.test.ts`,
  `tests/recipe_economy.test.ts`, `tests/professions_work_orders.test.ts`,
  `tests/deeds_content.test.ts`, `npm run wiki:content` freshness.
- UI change: the window's own suite + `tests/hud_perf_budget.test.ts` bucket +
  a mobile screenshot script against a phone viewport (LANDSCAPE 844x390: the
  game gates portrait). When a window's IWorld READS widen (a new `world.X`
  in its input builder), the "window's own suite" also means every rig that
  stubs its world, including the real-browser one:
  `npx vitest run --config vitest.browser.config.ts tests/browser/a11y.browser.test.ts -t "<window>"`
  (the Phase 8 QA lesson: the node rigs were green and the a11y stub threw
  on open; only the gate's browser step would have caught it).
- Phase end: `node scripts/gate_select.mjs` (the fast pre-merge gate);
  `npm run gate` for the deep check. Known environmental red: the armory browser
  pixel test; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL at", the full gate "[gate] FAIL"; the pass line is "[gate:select] PASS: all N steps green"), never trust a piped exit code, and PR CI
  is the arbiter. Since the fourteenth absorb (PR 3386) the gate carries a
  MANIFEST-FRESHNESS family: it regenerates and diffs
  src/game/sfx_manifest.generated.ts, src/guide/content.generated.ts, and
  src/render/assets/manifest.generated.ts plus
  public/audio/sfx/runtime-pack.json and
  scripts/sfx/sfx_gain_ceiling.generated.json, and reds at the "manifest
  freshness" step if any regen differs from the committed bytes; a
  committed-manifest edit now classifies into its own family and feeds
  vitest related instead of forcing the full-suite fallback, so the old
  "the fallback caught it" catch-path no longer exists for those five
  files: commit them fresh in the same change, always.

## Key planned files (working names; a phase may refine with a note here)

- `src/sim/content/farm_patches.ts` (FARM_PATCHES, FarmPatchDef)
- REFINED (Phases 3 and 4): `src/sim/content/farming_items.ts` never existed;
  item defs live in `src/sim/content/items.ts` BASE_ITEMS and the id blocks
  (FARM_MATERIAL_ITEM_IDS, FARM_SUPPLY_ITEM_IDS) in
  `src/sim/content/farm_crops.ts` beside the crop catalog
- `src/sim/professions/farming.ts` (the driver: plant, harvest, growth script,
  survival/yield resolution, updateFarming, ready-check helpers)
- `src/sim/professions/farm_watch_fee.ts` (Phase 4: the D9 fee predicate,
  eligibility order, and payment planner; pure leaf with an injectable
  catalog since Phase 4 QA)
- `src/ui/farming_view.ts` (Phase 4: farming's own UI pure core in
  UI_PURE_CORES; the deny-line key and the grant-line selectors moved in)
- `src/sim/professions/farming_zones.ts` (FARMING_ZONE_TIERS, the zone tier side table:
  the one home of the zone set; farm_patches.ts never redefines it)
- `src/world_api/farming.ts` (IWorldFarming facet: patch defs, my plots, commands)
- `src/ui/harvest_journal_view.ts` + `src/ui/harvest_journal_window.ts` (or the
  hud-domain directory form per `src/ui/hud/CLAUDE.md`)
- `src/render/farm_patches.ts` (beds + crop stage props adapter; Phase 7
  landed it with its pure core `src/render/farm_patches_core.ts` in
  RENDER_PURE_CORES)
- REFINED (Phase 7): the exporter is `scripts/assets/farm_props/` (driver
  `export_farm_props.mjs` + spec `scripts/assets/specs/farm_props.json`),
  the live per-asset subdirectory convention; `build_farm_props.mjs` never
  existed (deviation (as))
- `docs/design/farming-asset-manifest.json` (the handoff list; survives teardown)
- `tests/professions_farming*.test.ts`, `tests/farm_patch_placement.test.ts`, a
  `farming_session` parity scenario

## Per-phase ledgers (append as phases complete)

- New IWorld members: Phase 2: farmPatches (data) and myFarmPlots (data) on the new
  IWorldFarming facet (src/world_api/farming.ts); parity pins moved 302 to 304
  members, 77 to 79 data, 32 to 33 facets. RE-RUN tests/world_api_parity.test.ts and
  tests/snapshots.test.ts after EVERY release absorb into this branch: identical
  count-pin bumps on both sides auto-merge to a wrong total with no textual conflict
  (the char-sheet playtime precedent).
  Phase 3: plantCrop(bedId, cropId) and harvestCrop(bedId) as method members on
  IWorldFarming (both worlds; wire tokens plant_crop / harvest_crop); parity pins
  moved 304 to 306 members, 225 to 227 methods (data 79 and facet count 33
  unchanged; the two extra 304 literals near the union pins moved with them).
  Phase 4: convertHusks() as a method member on IWorldFarming (both worlds; wire
  token convert_husks, no payload); parity pins moved 306 to 307 members, 227 to
  228 methods (data 79 and facet count 33 unchanged; the union-size pair moved
  with them). plantCrop's SIGNATURE widened to (bedId, cropId, knobs?:
  FarmPlantKnobs) with no member-count movement; FarmPlantKnobs lives in
  farm_projection.ts and re-exports through the facet and the barrel.
  command_schema counts moved 194/207 to 195/208 (send/dispatch).
  Phase 7: farmNowMs() as a method member on IWorldFarming (both worlds,
  client-local derivation, NO wire token; deviation (ap)); parity pins
  moved 327 to 328 members, 239 to 240 methods (data 88 and facet count 34
  unchanged; both union-size literals moved with the member count; the
  parity exhaustion is TYPE-LEVEL, so run tsc as well as the suite when
  re-syncing these pins).
- New SimEvents: Phase 4: farmHusksConverted { pid, husks, compost } (text-free,
  pid-scoped; owns both halves of the trade feedback, the compost grant riding
  its hub loot event silent + callerLogs). farmDenied's reason union grew four
  appended members: no_husks (convert_husks below one batch), then no_compost,
  no_fee_produce, no_tonic (the plant-time knob payments; each denies the whole
  plant with nothing consumed and zero draws). Phase 3: farmPlanted { pid, bedId, cropId }, farmHarvested
  { pid, bedId, cropId, itemId, count, fineItemId?, fineCount? } (an all-fine
  harvest collapses the fine grant INTO the base fields so count is always
  positive and the fine pair present means a genuinely mixed harvest),
  farmWithered { pid, bedId, cropId, count }, farmDenied { pid, reason, bedId?,
  cropId? } with reason 'bad_bed' | 'bad_crop' | 'range' | 'bed_taken' | 'skill'
  | 'no_seed' | 'not_ready' | 'no_plot'. All text-free and pid-scoped; NO plot
  state rides any payload (ids and counts only; the parity omit-defaults shield
  does not cover event digests, and the farming_session golden digests these).
- New wire keys: Phase 2: fplot (the self delta mirroring myFarmPlots; tslot-shaped
  emit with the pre-serialized empty arm; registered in ALL_DELTA_KEYS and
  TERSE_TO_IWORLD, count pin 67 to 68). The projection NEVER carries
  PlotState.survivalRoll or yieldSeed; the negative leak pin in tests/snapshots.test.ts
  drives the real selfWireJson broadcast with an exhaustive nine-key set assertion.
  Phase 3: no new wire keys; the fplot EMIT moved behind the heavy-self gate now
  that its non-empty arm is live (the "revisit if rows grow" trigger below,
  tripped and resolved in-phase): plant_crop and harvest_crop joined
  HEAVY_SELF_CMDS and farmPlanted joined HEAVY_SELF_EVENTS (kept deliberately
  redundant with honest comments: wireRev already covers the successful paths
  because both commands touch bags, but Phase 4's knob commands will mutate
  plots WITHOUT an inventory change and need the command-side marking).
  Phase 4: the plant_crop frame gained three OPTIONAL literal-true knob fields
  (compost, watch, tonic), sent only when true so a plain plant's frame stays
  byte-identical to the pre-knob wire; the dispatch guards each per field
  (present-but-not-boolean refuses the frame) and hands the sim a complete
  boolean record (absent and false are the same protocol statement). The
  exhaustive frame key-set pins in tests/farming_command_chain_online.test.ts
  moved WITH the guard, both directions. convert_husks joined HEAVY_SELF_CMDS
  (belt and braces per the ledgered comment: the trade touches bags both ways,
  so wireRev covers success); the Phase 3 warning about knob COMMANDS needing
  command-side marking was RETIRED BY DESIGN instead: the knobs are not
  commands, they ride plant_crop's payload, and every paid knob spends items.
  Phase 8: NO new wire key and NO command; the farmReady SimEvent ({ pid,
  ready, withered? }, counts only, withered omitted at zero, ready always
  present and 0 on a withered-only notice) rides the generic event channel
  and joined HEAVY_SELF_EVENTS (the exact-set pin re-pinned in the same
  change), so the notified flip's fplot row rides the next snapshot instead
  of the staggered backstop. Emitters: the addPlayer login check and the
  1 Hz updateFarming sweep, one shared predicate in
  src/sim/professions/farm_ready.ts over the persisted notified flag
  (flip-before-emit; plantCrop is the only re-arm).
- New i18n keys and matcher rows: Phase 8: the hudChrome.harvestJournal
  namespace (23 keys: title/close/listLabel, the four timer arms
  growing/finishing/ready/withered, four clock-token templates
  remainingDaysHours through remainingSeconds, bedLine/bedLineUnknown, the
  four stage labels, careWatch/careNone, and both empty states), four
  hudChrome.farming ready lines (readyLine/Qty, readyWitheredLine/Qty), the
  map rows hud.core.mapMarkerLabels.farmPatch and worldContent.farmPatchName,
  and the devCommand farmgrow label/description/bed-field rows; every wordy
  value carries its five non-Latin M16 fills (the dev rows are English-only,
  outside the completeness suite's player-surface scope). No matcher rows
  (farmReady is a text-free counts-only SimEvent, the standing pattern).
  Phase 8 QA: guide.controls.harvestJournal (the public guide's controls
  page row for Shift+K, English plus the same five non-Latin fills the
  window title carries; M16 counts "Harvest Journal" as wordy).
  Phase 6: eight item-name rows in the items
  catalog (the dishes; English plus the five non-Latin fills per M16) and ONE
  hudChrome key, materialHint.growthTonic (the crafted tonic's tooltip purpose
  line, wordy value with its five non-Latin fills). NO recipe-name keys exist
  anywhere: a recipe displays its result item's name (crafting_window renders
  itemDisplayName(row.result)), so the phase file's "recipe name rows" wording
  is satisfied by the item rows alone. No matcher rows (recipes emit no
  sim-side player text).
  Phase 4: six hudChrome.farming keys, each with
  five non-Latin fills (M16): denied.{no_husks, no_compost, no_fee_produce,
  no_tonic} plus husksConvertedLine/husksConvertedLineQty (the trade line names
  both sides: the husks spent and the compost gained). Two item-name rows in the
  items catalog (Compost, Growth Tonic), the English-appended treatment. No
  matcher rows (every new denial and result is a text-free SimEvent).
  Phase 1 added, all English-only catalog rows with
  five non-Latin overlay fills each (M16): hudChrome.gathering.farming,
  hudChrome.gathering.toolTierUnmet.farming, hudChrome.gathering.toolRequired.farming,
  hudChrome.gathering.wieldUnmet.farming, hudChrome.gathering.noNodeNearby.farming,
  hudChrome.gathering.toolTooltip.kind.farming, guide.profPages.gatherIntro.farming,
  guide.profPages.gatherDeeds.farming. Reworded with fresh non-Latin fills:
  guide.professions.whatBody, guide.professions.gatherHubBody,
  guide.profPages.gatherDeeds.{mining,logging,herbalism}. Reworded English with
  locale desc fills DROPPED per the deed_i18n release-refill protocol:
  prog_master_gatherer desc (18 locales). No matcher rows (nothing sim-side emits
  farming English).
  Phase 3 i18n: hudChrome.farming.* (15 keys: plantLine, harvestLine/Qty,
  harvestFineLine/Qty, witheredLine/Qty, denied.{eight reason leaves keyed
  VERBATIM off the farmDenied reason union by template literal, so a new reason
  is a tsc error until its leaf exists}), abilityUi.cast.farming, four item-name
  rows in the items catalog with full locale coverage, and the matcher row
  error.castingPlanting for the one sim-side English sentence 'You are
  planting.' (BASE_DICT locale fill deferred to release-time per the
  contributor contract). All wordy values carry the five non-Latin fills (M16).
- New items/recipes/deeds: Phase 6: FARM_RECIPES (src/sim/content/recipes.ts), the
  farm-economy hook list beside HOE_RECIPES/ROD_RECIPES, 9 trainer-taught rows
  joined into the content-side ALL_RECIPES spread: 8 cooking dishes (two per crop
  tier at rungs 0/25/50 with the 10/10, 16/15, 20/20 scaffolding; every
  foodHp/sellValue pair REUSES a shipped food-curve point, ceiling 980 reached
  never exceeded: vale_hearth_loaf 90/6, eastbrook_root_pottage 117/12,
  fenbridge_rice_bowl 243/25, fenbridge_beet_braise 432/40,
  highwatch_barley_bannock 552/60, highwatch_gourd_soup 552/75,
  evergarden_sunmelon_tart 980/150, evergarden_harvest_platter 980/150; kind food,
  foodHp only, NO buff machinery, no buyValue, quality matches the rung) plus
  recipe_growth_tonic (alchemy, silverleaf_herb x2 + glass_vial x1 at skillReq 0,
  output 6 under input 20). All values maintainer-flagged at their rows. Every
  row keeps one no-buyValue reagent, so none joins the counterfactual vendor-fed
  literal; the trainer-sum pin and professions_crafting recipeList pin gained the
  list; FARM_RECIPES length pinned twice (9 whole-list, 8 cooking-filtered).
  CONSUMER NOTES CLOSED: the five deferred fine twins each gained a dedicated
  dish slot (fine_brook_carrot in the pottage, fine_bog_beet in the braise,
  fine_frost_gourd in the gourd soup, fine_gilded_sunmelon in the tart,
  fine_evergarden_greens in the platter), all 8 base produce appear across the
  dish set, the rollout closure arm now derives recipe consumers from merged
  ALL_RECIPES (the old derivation could not see recipes and would have stayed
  green while lying), and the items.ts consumer-note comments name the live
  consumers. fine_marsh_rice and fine_highland_barley remain hoe-reagent-only
  by design of the 5-slot closure (see OPEN items). ITEM_ART_PENDING re-pinned
  31 to 39 (the 8 dishes ride as art debt with pairwise-distinct procedural
  recipes on the food radial, no pair separated by palette alone). DEBT
  OWNER (named in Phase 6 QA): the pending set's scheduled closer is the
  Phase 13 asset handoff (docs/design/farming-asset-manifest.json lists
  every debt id for the maintainer art pass); the self-clearing pins force
  each id off the set as its art lands, and the A4 distinctness pin must be
  EXTENDED across every procedurally-resolving id when the first debt id
  leaves the set (today it discriminates only within the pending family).
  growth_tonic
  joined MATERIAL_HINT_KEYS (the exact-set pin re-minted deliberately): a
  recipe output must render purpose text and its junk kind has no def-level
  use line. No new deeds (dishes are not conquerable content).
  Phase 4 also minted two more maintainer-flagged
  constant families the first write of this entry omitted (Phase 4 QA
  correction; both live at their definitions and in the progress.md notes):
  FARM_WATCH_FEE_BY_TIER = 2/3/4/6 produce for tiers 1 to 4
  (src/sim/professions/farm_watch_fee.ts, the produce-sink rate), and
  FARM_TONIC_BONUS_CHANCE = 0.5 with FARM_TONIC_BONUS_PICKS = 2
  (src/sim/professions/farming.ts, expected value one extra base-grade pick
  per tonic). Phase 4 items: compost (sellValue 2, buyValue 8 at
  the 4x convention, maintainer-flagged; vendor-stocked in Phase 9 per D9) and
  growth_tonic (sellValue 6, NO buyValue: never vendor-stocked, alchemy-crafted
  in Phase 6). Both are plain consumed-by-command items with no ItemDef.use
  (the def comment states the choice), kind junk quality common (sellAllJunk
  never vendors common), classified as MATERIALS via the new
  FARM_SUPPLY_ITEM_IDS block folded into FARM_MATERIAL_ITEM_IDS
  (content/farm_crops.ts): they are the tradeable input side of the farming
  loop exactly like seeds. MATERIAL_ITEM_IDS moved 59 to 61
  (material_taxonomy_bootstrap size pin re-minted); ITEM_ART_PENDING re-pinned
  as an exact SIX-id set with A4-pairwise-distinct procedural recipes (a damp
  sack and a green draught). Conversion: FARM_HUSKS_PER_COMPOST = 2
  (maintainer-flagged), so one failed crop's husks make exactly one compost.
  Phase 3 items: vale_wheat_seed (sellValue 1, no
  buyValue: seeds stay vendor-unobtainable until go-live), vale_wheat
  (sellValue 4), fine_vale_wheat (sellValue 8, buyValue 32, fine-material
  convention; deliberately NO MATERIAL_GRADES row, see deviation (o)),
  withered_husks (sellValue 1). All kind junk quality common, classified as
  materials via the derived FARM_MATERIAL_ITEM_IDS taxonomy source, sitting in
  the affinity census's self-clearing CONSUMER_DEFERRED_MATERIALS list until
  their consumers land (husks: Phase 4 convertHusks; produce: Phase 6 dishes).
  Icons ride ITEM_ART_PENDING re-pinned as an exact four-id set. No recipes, no
  deeds (deeds deferral verified sound against docs/design/deeds.md by the QA
  gate: a growth engine is none of the conquerable-content kinds).
- Locked deviations from phase files: Phase 1: (a) PENDING_ART_IDS allowlist in
  tests/profession_icons.test.ts (E2 demands art-backed production ids the packet
  did not anticipate; inverted assertions self-clear when the phase 13 art batch
  lands; maintainer sign-off owed at feature review); (b) NO parity golden commit
  (the predicted mechanical red never materializes: the sample drops inert zero
  keys before digesting; regen proven byte-identical; the growth phase inherits the
  first real regen); (c) six commits, not five (review round commit; no parity
  commit); (d) Master Gatherer roster prose pulled INTO Phase 1 from the deeds
  phase (fishing-precedent reword, all three reviewers concurring); (e) the
  GATHERING_PROFESSION_IDS comment was amended, not preserved verbatim (it names
  the appended professions); (f) delivery followed D22: no push, no PR, the
  phase branch merged --no-ff into feature/farming-plan and the would-be PR
  body lives in progress.md (the phase file letters this (d)); (g) the
  blast-radius list gained the sites discovered in flight: gather_tool_tooltip
  KIND_KEYS and its Partial neighbours, the gather_node_tooltip maps, the
  two-key guide count prose (the phase file letters this (e)). THIS ledger's
  lettering is canonical; the phase file's five-letter block differs and
  points here (harmonized in Phase 1 QA, 2026-08-08).
  Phase 2: (h) FARM_CROP_IDS pre-declares ONE crop id, 'wheat' (packet-locked via
  the intro quest): the load-side allowlist and the end-to-end round trip need a
  real id to prove a surviving row; the growth phase owns the catalog and nothing
  can plant this phase, so no live save can carry it. (i) The D2 Evergarden hub
  prose was FALSE against shipped content and is corrected in D2 above: Hedgewick
  is the zone hub and the reachability flood origin; the parterre stays the
  patch-site anchor. (j) FARMING_ZONE_TIERS is farming's OWN tier column, deliberately
  diverging from the shipped zone-progression ladder at evergarden (tier 4 showcase
  vs the named inversion's tier 1), so the fishing test's GATHER_NODES derivation
  CANNOT be copied: literal pins plus the one-ladder arm (FARM_PATCHES[].tier
  toBe the reader) guard it instead, and a fifth farming hub must update both in
  the same change. (k) The placement suite grew three arms beyond the phase file's
  list, each with a counter-example: camp-footprint clearance (the west-Eastbrook
  site passed every physical arm yet sat 8.1 yd inside the Sableweb camp), road
  clearance (5 yd, the world.ts screen), and bed-vs-gather-node clearance; the
  Phase 1 deferral of the node hover tooltip maps to "the beds phase" is RE-DEFERRED
  by the fishing precedent: farming has no GatherNodeType, so those maps stay
  farming-free permanently, and the gatherDeniedLineKey surface decision moves to
  the phase that ships plant/harvest commands. (l) The FarmPlotView clock-base
  question (host-clock absolutes: epoch ms online, sim-clock ms offline) is
  DOCUMENTED as a seam contract this phase (no render/ui consumer may subtract
  Date.now; rely on status), and the RaidLockout-style derived duration field is
  deferred to the growth phase, which owns the first timer surface. (m) No parity goldens
  commit: the regen was proven a byte-identical no-op again (the (b) precedent).
  The gate's full-suite fallback then caught a mirror pin the targeted runs
  cannot see: tests/professions_blob_growth.test.ts keeps its OWN copy of
  PROFESSIONS_BLOB_FIELDS and scrapes the roundtrip sweep's source, so adding a
  field to one list reds the other; the fix commit teaches the growth bound
  farmPlots (every bed planted at full width, about 193 bytes per bed) and
  re-mints the byte ceiling 10240 to 14336 and the floor 9280 to 13696 per that
  file's doctrine. ANY future phase touching PROFESSIONS_BLOB_FIELDS must edit
  BOTH suites in the same change.
  Phase 3: (n) the crop id shipped as vale_wheat, closing (h): D11 wins over the
  Phase 2 'wheat' placeholder, data-safe because nothing could plant; the three
  fixture literals and FARM_CROP_IDS (now derived from the FARM_CROPS catalog in
  the new src/sim/content/farm_crops.ts leaf) swept in the same change. (o) the
  fine twin ships as an ordinary item with NO MATERIAL_GRADES row: that table is
  pinned as exactly the nine NODE_MATERIAL_TABLE yields and its suite derives
  from live node content, so D11's "(the MATERIAL_GRADES requirement)" clause is
  unsatisfiable for a fishing-shaped profession; the fine roll lives in
  farming's own harvest resolver. (p) the hoe-tier and wield gates are DEFERRED
  to Phase 5, verified not assumed: farming registers no gatherTool,
  bestOwnedGatherToolTierOrNone returns NO_TOOL_OWNED, canGatherTier(0, 1)
  would refuse EVERY plant, and the R22 banner forbids the bare-hands-floored
  scan for access decisions; the phase file's gate list and acceptance text
  claiming the hoe gate are amended, and all three seam comments say deferred.
  (q) the plant cast resolves AT COMMAND TIME and the cast is pure flavor (the
  D4 command-body draw rule forces it; the completion-routing arm is
  return-only; damage cancelling the cast leaves the plant standing); no
  SimContext callback was added. (r) survival is evaluated against CURRENT
  farming skill at read time (out-leveling retroactively retires risk, monotone
  player-favorable; the locked PlotState shape has no room for plant-time
  skill); projectFarmPlots takes farmingSkill and a cropTierOf function
  reference to stay a pure leaf. (s) the farming_session golden was re-minted
  TWICE in-phase, both for cause: the addItem silent/callerLogs fix moved the
  event digest (the #2430 double-loot-line finding), and the write-side anchor
  floor changed the tick-0 plant's plantedAtMs from the sampler-dropped 0 (a
  recording of the destroy-on-load defect) to 1; zero pre-existing goldens
  moved at any point. (t) the phase ran EIGHT reviewer verdicts (six domain
  reviews, the QA gate, plus the full-suite gate fallback) and the census
  suites the fallback caught (material_taxonomy, bag_filter, item_icons,
  professions_silent_loot, localization_coverage, tick_perf_capture,
  material_profession_affinity, material_taxonomy_bootstrap) were absorbed
  in-phase: the taxonomy gained the derived FARM_MATERIAL_ITEM_IDS source, the
  affinity census gained the self-clearing CONSUMER_DEFERRED_MATERIALS list,
  and ITEM_ART_PENDING's size-0 pin became an exact-set pin.
  Phase 3 QA: (u) normalizeFarmPlots ADMITS a duration of exactly ZERO as a
  permanently-ready row (only a NEGATIVE duration drops): /dev farmgrow writes
  readyAtMs to the grow instant, so a plot grown in the same tick (offline) or
  millisecond (server) as its plant minted a duration-0 row the old
  duration <= 0 arm silently destroyed on the next load; "instantly ready AND
  loadable" is impossible under the strict arm, admitting zero concedes nothing
  to a blob editor (duration 1 was always equally instantly ready), and
  farmGrowthStage/the projection already read zero-length windows as ready.
  Migration-safety reviewed the rollback residual (an OLD loader still drops
  duration-0 rows) and ACCEPTED it dev-only with no DEPLOY.md note: no
  production minter exists until Phase 9. The farmgrow clock also floors at 1
  now (the write-side anchor rule's third statement), and the crop catalog
  pins every durationMs as a positive integer under FARM_MAX_GROW_MS, the
  guard the admission removed for mis-authored crops. (v) harvestCrop
  deliberately performs NO deliberate-action trio (no breakStealth, no
  standUp, no forceDismount), unlike plantCrop and every gather/fish cast:
  the harvest is the instant second visit of the two a cycle ever gets, a
  per-bed dismount or reveal would tax exactly the walk-the-row pattern the
  anti-chore thesis protects, and personal plots are uncontested so neither
  state buys anything against another player. Pinned ("keeps stealth, the
  seat and the mount" in tests/professions_farming.test.ts); flipping it is a
  one-trio change plus that pin.
  Phase 4: (w) the affinity census's CONSUMER_DEFERRED_MATERIALS list
  (tests/material_profession_affinity.test.ts) is REPLACED by a structural
  farming exemption derived from FARM_MATERIAL_ITEM_IDS, not shrunk by one id
  as the packet expected: the list's self-clearing arm keyed on RECIPE
  consumers (craftIdsForMaterialItem scans recipes and enchants only), so the
  command consumers that actually closed the loop (plant_crop for seeds and
  the watch fee, convert_husks for husks, the knobs for compost and the
  tonic) could never clear it mechanically, and compost/growth_tonic will
  NEVER gain a recipe consumer at all, which would have made their "deferred"
  entries a permanent lie. Every farming material is command-consumed by
  construction (holds for every crop the ladder phase adds), the consumption
  carries executed coverage in tests/professions_farming.test.ts, and the
  anti-abuse growth gate moved to the exact-set pin on FARM_MATERIAL_ITEM_IDS
  in tests/material_taxonomy.test.ts (smuggling an orphan into the exemption
  requires editing content, which that pin reds). A future recipe consumer
  (the Phase 6 dishes) needs no census edit: the id starts passing the census
  on its own terms. (x) the phase file's "compost adds 10 survival points ...
  caps at 100" is the shipped [0,1] probability scale times 100: the payload
  wires to the EXISTING FARM_SURVIVAL_COMPOST_BONUS / FARM_SURVIVAL_WATCH_BONUS
  constants (0.10 each, Math.min(1, ...)), never a second 0-100 scale; with
  the shipped constants no knob sum lands on exactly 1.0 except through the
  clamp or at the band top, and the boundary arms pin both. (y) the
  refusal-preserves-stealth/seat/mount arm re-armed at the TONIC gate (the new
  last gate in the stated order) so it keeps proving the trio sits below EVERY
  gate; the knob deny arms extended the precedence family (no_seed before
  no_compost before no_fee_produce before no_tonic) and added the
  check-then-pay atomicity proof (a passed compost gate spends nothing when
  the later tonic gate refuses).
  Phase 4 QA: (z) the parity-scenario knob coverage is DEFERRED to Phase 5:
  the farming_session golden stays untouched through this QA (the phase's
  own locked outcome, and the QA session's stopping rule forbids moving a
  pre-existing golden), so the knobbed plant, the toniced harvest, and
  convert_husks do not enter the cross-host draw-order digest yet; their
  draw contract is held by the single-host pins (the 8-combination count
  pin with identical (survivalRoll, yieldSeed) pairs, the live QA probes,
  and the same-seed determinism arm). Phase 5 (crop ladder) extends
  farming_session (or adds a farming_knobs scenario) with one knobbed
  plant, one toniced harvest on a winner seed, and one husk conversion,
  and re-records the golden deliberately in an isolated commit per D23;
  the handoff line in the Phase 5 gate list below is the tripwire.
  Phase 5: (z) CLOSED: farming_session gained the knobbed plant, the toniced
  harvest on a probed winner yieldSeed (the M8 lesson applied: winner probed,
  non-vacuity asserted in-arm), the husk conversion, and a tier-3 seed-back
  beat; golden re-recorded in its own isolated commit (md5
  29a11d98bda17f9c38bd8e9016df7fc7 to bf00c277b89e142446550f00c1035696), the
  coverage_c ledger re-pinned 4 to 9 draws. (aa) the R37 hub-stocking arm's
  landTools scan EXCLUDES farming exactly as it excludes fishing: the hub rule
  is about the rungs a zone's own NODES use and farming has no nodes (D2);
  garden_hoe stays vendor-PRICED (20) but dormant, and the farming ladder's
  own dormant-state arm pins the no-vendor truth positively until Phase 9
  flips stocking, the hub exclusion, and the dormant arm together (the go-live
  checklist line). The guide's priced-but-unstocked arm carries the same
  narrowing. (ab) the plant hoe gate (gate 12) rides
  canGatherTier(bestWieldableGatherToolTierOrNone(...), crop.tier) per the R22
  banner: the EFFECTIVE plant ladder is the frozen wield gates (tier 1/2/3/4
  hoes at farming 0/40/70/85) LAYERED OVER the crop skill thresholds
  (0/25/50/75, gate 7, which still fires first), exactly the land-profession
  shape; traversable because teaching ceilings run 50/75/100/100. The phase
  file's bare "riding canGatherTier" wording is superseded; deny reason
  'tool', ordered after the tonic gate, precedence pinned. (ac) the phase
  file's "a pin proves all three existing tool effects slot onto a hoe" was
  FALSE as written: the respawnSpeed kind arm refuses quickening_charm
  (display name Springback Charm) on EVERY profession and stays. The two live
  effects (gatherers_cache, artisans_eye) slot AND act at harvest rather than
  shipping mintable-but-inert (the fishing refusal's own doctrine): wired
  through applyToolEffectUse draw-free (quantity maps to flat bonus picks,
  quality to a maintainer-flagged fine-chance bump, auto-mode spends one
  charge per bonus-bearing harvest, prompt-mode skips whole since harvest_crop
  carries no confirm channel), pinned non-vacuously both directions. (ad) hoe
  recipes are their OWN HOE_RECIPES list per the rod precedent, never
  TOOL_RECIPES rows (that list's invariant consumes MATERIAL_GRADES fine
  grades and its length is pinned at 6): invariant, each rung consumes the
  fine twin of a crop one tier below plus the hoe one rung down
  (fine_vale_wheat/fine_marsh_rice/fine_highland_barley), rungs 2-4 are
  CRAFT-ONLY (the rod ladder's vendor arm is locked off by the
  rung-1-only-priced rule), engineering at the toolworks, pinned in
  tests/professions_hoe_recipes.test.ts. (ae) the tier 3/4 seed-back roll
  fires on BOTH outcomes (the withered consolation roll): one uniform
  contract clause per tier beats an outcome-forked draw count, and a died
  overnight crop returning a seed is anti-frustration, not economy (rates
  maintainer-flagged). In-phase: the blob byte model re-minted floor 13952 /
  ceiling 15360 (the doctrine's headroom rule; fixture now derives the widest
  crop id with a literal guard), and vale_wheat_seed gained buyValue 4 (the
  tier-1 seed row; the packet's Phase 3 pricing predated the seed-pricing
  table). (af) prompt-mode tool-effect slot mints are REFUSED for farming at
  resolveSlotToolEffect: harvest_crop carries no confirm channel (confirmed is
  hard false at the harvest apply site), so a prompt-mode farming slot could
  never fire, never spend, and never ratchet, a charm consumed into a dead
  slot; refusing at the mint closes the trap with no load-side arm needed (no
  farming slot predates the hoe phase). The harvest confirm channel, if ever
  wanted, is the Phase 7/8 farming-UI decision; pinned three ways (prompt
  farming refused, always farming mints, prompt mining mints). Review-round
  extras worth knowing at QA: the 'tool' deny toast names the required tier
  via hudChrome.gathering.tierRequired.farming through the farmDeniedToast
  pure core (the sinkless requiresTool.farming key was deleted with its
  fills); the reworded howToSlot line carries corrected fills in ALL 18
  overlays (a stale Latin fill is invisible to both gate tiers, the class to
  sweep on every reword); and the gather_tool_tooltip tripwire (the SECOND
  self-clearing farming tripwire, missed by the phase's own suite lists) is
  flipped with the no-Use-prefix exception pinned.
  Phase 5 QA: (ag) farmHarvested carries the last-charge signal
  effectDepleted (the gatherResult shape reused whole: only-when-true
  optional, spent-guarded durability read, the shared
  hudChrome.professions.toolEffectDepleted self-note in the hud arm). ONLY
  farmHarvested can carry it, because the withered return sits above the
  effect block, so a failed crop never applies, spends, or depletes (pinned
  by the withered crossed arm: charge and ceiling both untouched). Farming
  was otherwise the one profession whose live tool effects broke silently.
  The farming_session golden was untouched (no scenario beat arms an
  effect; md5 re-verified byte-identical). (ah) the professions window
  suppresses the R40 "Ask each use" toggle on the farming row through
  promptSlotRefused (src/sim/professions/tools.ts), the SAME predicate the
  mint's refusal arm reads, so the two surfaces cannot drift: before this,
  ticking the farming toggle emptied the row's slottable set (every prompt
  mint is refused) and erased the whole actions row, toggle included, until
  the window reopened. The Phase 7/8 change that lands a harvest confirm
  channel edits the predicate and the resolver arm together; the layout pin
  (farming buttons without toggle, mining control arm) moves with it.
  Phase 6: (ai) the growth tonic recipe is CRAFTABLE from wild herbs before
  go-live, against the phase file's blanket "every new recipe has at least one
  reagent unobtainable until go-live" note: D7 locks the tonic to herbs (the
  cross-profession trade), herbs are wild-gathered today, and the D-decision
  wins. The enforced dormancy pins are the vendor-goods-alone pair in
  tests/professions_zone_rollout.test.ts (every FARM_RECIPES row keeps one
  reagent no NPC stocks AND one with no buyValue; for the tonic both are
  silverleaf_herb), and the tonic's real pre-go-live dormancy is economic: its
  only sink is the plant-time knob and seeds have no faucet until Phase 9.
  Crafting it early is a strict gold loss (output 6 under input 20), so no
  exploit window opens. The dishes keep the stronger property (farm produce
  nobody can grow); the arm asserts unstocked-ness, never uncraftability.
  QA ADDENDUM (Phase 6 QA, 2026-08-13, RULING OWED): the gold-loss argument
  above weighs only copper; the tonic is ALSO the cheapest rung-0 alchemy
  SKILL-UP craft in the game (silverleaf x2 + vial, under the shipped
  rung-0 rows at herbs x3-x4 + extras), so alchemy leveling gains a
  strictly cheaper mat path live today, which is a real pre-go-live
  behavior change the dormancy ruling never considered. Maintainer call:
  raise the herb count to the shipped floor, or accept the cheap skill-up
  faucet and record the intent here; the reagent literals are pinned either
  way, so either ruling is a visible edit. The tonic craft path itself is
  now executed end to end through real ticks (tests/farm_recipes.test.ts),
  including the deterministic alchemy skill grant.
  (aj) all nine FARM_RECIPES rows are TRAINABLE in the live game before
  go-live, deliberately: the binding Live-surface note wants the recipes
  visible in the crafting window while the farm is dormant, trainer
  acquisition is the only mechanism that puts a recipe there, and train_view
  walks ALL_RECIPES with no availability gate. The architecture review
  surfaced it as a rollout-policy call; ruled the garden_hoe
  priced-but-dormant precedent (deviation (aa)) extended to recipes, pinned
  through resolveTrain in tests/farm_recipes.test.ts (rung-0 rows resolve ok
  and FREE per the settled R8 fee curve's tier-0 point, the rung-50 platter
  resolves ok charging 10000) so a future availability gate cannot land
  silently. Maintainer flag rides the FARM_RECIPES header.
  QA ADDENDUM (Phase 6 QA, 2026-08-13, RULING OWED): the (aj) ruling covers
  trainability, not the FEE dimension: the rung-25 and rung-50 rows charge
  2500 and 10000 copper (both now pinned) for recipes that cannot be
  crafted until Phase 9, a non-refundable spend on a dormant capability
  with no trainer-list signal, and the garden_hoe precedent it extends was
  a usable item. Maintainer call: gate the priced rungs to go-live, or
  record the early fee as accepted cost here.
  (ak) the crafted-tooltip provenance partition (tests/item_instance_tooltip
  .test.ts, "every crafted recipe output resolves to a crafted-kind def")
  gained its ONE sanctioned exception: growth_tonic is a crafted output that
  stays kind junk by doctrine (the knob-consumed, Sell-Junk-vendorable
  choice). The exception cannot mis-word a tooltip because no signed instance
  of the tonic can exist: common quality sits below the rare signing floor
  and masterwork needs slot+stats the def lacks; BOTH facts are pinned
  beside the exception so it self-invalidates if either moves.
  (al) TWO release art-program suites (new in the tenth absorb) collide
  structurally with any feature branch that adds items or sim content, and
  were healed in-branch with the guards extended, never gutted; maintainer
  read owed on both: (1) scripts/item_art_audit.mjs demanded committed art
  for every live ItemDef; it now honors ITEM_ART_PENDING as declared
  procedural debt (policed both directions: a pending id must be a live def
  with NO shipping webp), expected liveItemCount is 831 + the pending size,
  and the fresh-checkout literals (catalog sha, renderer fingerprint,
  liveItemCount 870) are re-minted in tests/item_art_audit_builder.test.ts
  with a fixture arm pinning all three exemption directions. (2) the mob
  portrait manifest's rendererFingerprint hashes the stills esbuild bundle
  whose import graph reaches sim content (probed: items, profession_items,
  professions, recipes, types are all inputs), so ANY sim content commit
  stales it with zero pixel impact; the guard gained a fingerprint-only
  refresh path (every row byte-identical AND the row set unchanged writes
  receipt-free; any row drift still demands the rendered receipt, pinned in
  a new test arm), and the committed manifest was re-minted through the real
  CLI (3 lines: fingerprint + bundle digest). ABSORB CHECKLIST ADDITION:
  after every future release absorb (and any farming phase touching sim
  content), run node scripts/build_mob_portrait_source_manifest.mjs --write
  (fingerprint-only re-mint) and node scripts/item_art_audit.mjs
  --verify-only, and expect a one-field conflict in the portrait manifest
  whenever the release also re-minted it: resolve by re-running the CLI on
  the merged tree, never by hand-picking a side.
  SECOND-ORDER EVIDENCE RE-MINTS the first (al) pass missed (the full gate
  caught them; only the full suite can see this class): liveItemCount is now
  the ART-SUBJECT universe (live defs minus the pending set), so every 831
  release literal stands and the catalog sha moves only through the audit
  lib's self-hash; the committed final-item-art-audit-verdict.json was
  refreshed through the sanctioned --refresh-verdict CLI (which re-renders
  the 208 contact sheets locally, so the per-sheet digests and
  sheetSetSha256 are THIS environment's, internally consistency-checked by
  the suite; the maintainer's canonical environment should re-mint them at
  feature review); and the two accepted-art.json registries had their
  verdict-file and portrait-manifest rows re-pointed. The absorb-checklist
  rule extends to these: on conflict re-run node scripts/item_art_audit.mjs
  --refresh-verdict on the merged tree.
  Two review-round residuals ledgered, not fixed: the closure arm derives
  recipe consumers from the whole merged ALL_RECIPES, so an unrelated future
  recipe could keep a farming material green after its farm-side demand
  disappeared (the literal twin-to-dish map bounds the five that matter); and
  the phase is content-only at the file level but not the behavior level:
  craftIdsForMaterialItem and the taxonomy now map farm produce to cooking,
  whose consumers are all UI (hint lines, bag/bank filters), none tick-side
  or wire-side, so determinism is untouched.
  V0.38.0 RECONCILE (the eleventh absorb, 2026-08-13; this paragraph is the
  current (al) mechanism): the release evolved the art program its own way
  and the branch mechanism SURVIVED beside it. scripts/item_art_audit.mjs now
  carries the release's expected literals (catalogCount 822, liveItemCount
  837, generatedHeroicDefinitions 64, heroicWeaponArtAliases 16) with the
  branch's ART-SUBJECT rule intact (live defs minus ITEM_ART_PENDING; the
  release literal stands because every farming id is pending). The release
  added scripts/lib/mob_portrait_manifest_diff.mjs (a drift DIAGNOSTIC that
  says which manifest part moved) and normalized the stills bundle bytes
  (absWorkingDir pin plus node_modules path normalization in
  mob_portrait_jobs.mjs), which re-minted the portrait fingerprint
  release-side; the branch's fingerprint-only refresh path in
  mob_portrait_manifest_guard.mjs composes with both and the absorb
  checklist below held EXACTLY as written: the committed manifest conflicted
  (both sides re-minted), resolved by re-running the CLI on the merged tree
  (a 3-field fingerprint-only write, receipt-free), the verdict conflicted
  and was re-minted through --refresh-verdict (bytes preserved at 107997,
  sheet digests this environment's), and both accepted-art registries were
  re-pointed at the fresh digests. The fresh-checkout literals in
  tests/item_art_audit_builder.test.ts were re-recorded from the merged-tree
  run (catalog sha 731bc17b, the merged lib self-hash; renderer fingerprint
  f748b74e, the branch value, because the release never touched the item
  renderer).
  PHASE 6 QA ROUND (2026-08-13; the TWELFTH absorb plus two guard
  extensions, commits on fix/farming-phase-06-qa): the QA pre-flight
  absorbed release/v0.38.0 tip b08d79ef91 as merge 1a5d6fd5b4 (38 commits,
  120 files, 5-file farming intersection, below the D22 mid-phase bar; NO
  lockfile move, so the seal runbook did not fire). The only conflicts were
  the two art evidence files, resolved exactly per this checklist
  (fingerprint-only portrait re-mint, registry re-pointed); the release
  delta also lowered the renderer.ts monolith ceiling 13764 to 13708 via
  its own fire_light_registry extraction, leaving renderer.ts at EXACTLY
  its ceiling (see the phase-07 sync note), and reworked CI selection
  plumbing without changing scripts/gate_select.mjs semantics or its FAIL
  markers (true of THAT absorb only: the FOURTEENTH absorb DID change
  selection semantics with the manifest-freshness family; see the
  validation matrix note). Release-merge-audit lane: CLEAN on all five
  hazard axes.
  GUARD EXTENSIONS (commit 719d701d66): (1) the item art audit's expected
  block now pins pendingArtCount (39) beside the ART-SUBJECT liveItemCount,
  so a standalone audit run reds when the debt grows even though the
  subtraction leaves liveItemCount unmoved (the structural blindness the QA
  fan-out converged on); the builder test proves the mismatch arm both
  directions. (2) the portrait manifest's receipt-free refresh now requires
  describeManifestDrift's own bookkeepingOnly verdict (bundle-only drift:
  rows, tracked renderer files, bootstrap review, and row set all intact),
  so an edit to the stills renderer scripts demands a rendered receipt
  again. SHARPENED RESIDUAL for the owed (al) maintainer read: a
  pixel-affecting src/render edit inside the stills bundle is still
  indistinguishable from content churn in the single bundle digest;
  splitting the bundle hash into renderer-code and content-graph halves is
  the open call. QA-round evidence re-mints, superseding the
  eleventh-absorb literals above: the audit lib self-hash moved with
  extension (1) (renderer fingerprint 84410592, catalog sha a6918c8d,
  verdict re-minted through --refresh-verdict, bytes preserved 107997, new
  digest acc3cd10), and the portrait manifest was re-minted fingerprint-only
  for a recipes.ts comment reword (c6fd6b24, adopted receipt-free by the
  tightened guard itself, the live proof of its bookkeeping path); both
  registries re-pointed. ABSORB CHECKLIST ADDITION: the release added
  tests/suite_duration_budget.test.ts (a declared per-suite duration
  ratchet); any future farming phase adding a slow suite declares its
  budget there in the same change.
  SEVENTEENTH ABSORB (2026-08-17, release/v0.39.0 tip f48c7a3a9b, opening
  Phase 9): the checklist held again (portrait manifest fingerprint-only
  re-mint, receipt-free; the audit verdict re-minted through
  --refresh-verdict, bytes 108135; both registries re-pointed; the builder
  and consistency literals re-recorded from the merged-tree run: catalog
  sha 103c2196, renderer fingerprint 84410592 unchanged, sheet set
  75e58630, verdict 6709601d) and the farm-props lockfile seal fired a
  third time (same runbook). NEW (al)-CLASS MEMBER: the release's icon-art
  second pass (tests/release_v039_icon_art.test.ts) seals the live
  hotbar-item inventory (kind food/drink/potion/mount, use fishing or
  gatherTool) at 72 painted against
  docs/achievements/release-v039-icon-art-second-pass-2026-08-16; the branch's
  eight dishes and four hoes are hotbar-eligible pending-art ids and failed
  it on the merged tree only. Healed by the ART-SUBJECT rule (11e0940da0):
  the sealed closure is live minus ITEM_ART_PENDING, the pending hotbar
  count is a hard literal (12), every pending id must ship NO webp, and the
  release literal 72 plus the sealed record stand byte-identical. ABSORB
  CHECKLIST ADDITION: any future release seal over a LIVE inventory that
  farming's pending-art items can join (hotbar items, bag filters, action
  affordances) gets the same ART-SUBJECT split, never a raise of the
  release literal and never a gutted arm; the Phase 13 art batch clears
  the debt and re-pins the pending literal to zero.
  SIXTEENTH ABSORB (2026-08-15, the v0.39.0 sync): the checklist held
  exactly as written AGAIN: the portrait manifest re-minted
  fingerprint-only (rendererFingerprint plus bundle digest moved with the
  r185 renderer, adopted receipt-free by the bookkeeping path), the
  accepted-art registry row re-pointed, and item_art_audit --verify-only
  reported machineChecksPassed true with no verdict refresh needed. The
  farm-props lockfile-seal rule fired a second time and the 8420f0bd8d
  recipe held with one SHARPENING worth keeping: the shipping GLBs carry
  the sourceFingerprint stamp TWICE (asset.extras and the document-root
  extras), and a NodeIO read-write cycle re-encodes the meshopt payloads
  (the write throws without a registered encoder and would move bytes
  with one), so the size-preserving restamp is a raw byte-level
  replacement of BOTH 64-hex occurrences per file, asserted at count two
  and unchanged length. A NOTE from the sync's premise lane, not
  release-caused: several phase-file Close lines cite a "GATE EXIT"
  marker that has never existed in the scripts; judge gates by the
  FAIL/PASS lines alone (the validation matrix row above was corrected at
  this sync; phase-file sweeps are left to their own sessions).
  NINETEENTH ABSORB (2026-08-18, release/v0.39.0 tip 7b45fdb9a9, the sync
  mid-phase): the checklist held again. The portrait manifest re-minted
  fingerprint-only through the CLI on the merged tree (both parents moved sim
  content; new manifest sha 272e3562...), the accepted-art registry row
  re-pointed, item_art_audit --verify-only machineChecksPassed with no verdict
  refresh needed. The Eastbrook polish seals fired their both-parents-moved-
  renderer shape (the release's DelveInteriorTracker vs the branch scheduler):
  resolved ONLY by remint_polish_provenance.mjs on the merged tree, three pin
  literals from its printed values, no capture retaken. No lockfile move, so
  the farm-props seal family did not fire.
  (am) The farming_session parity golden was deliberately re-minted at the
  v0.38.0 sync (commit ddb718b95e), the ONE golden move of the phase and the
  mirror of D23's own recipe: the release samples the new Reliquary block
  (reliquary.counts / reliquary.firstFind) into every player sample and
  re-recorded all ITS goldens in the delta, but farming_session is
  branch-only so the release could not re-record it. Verified before
  minting, machine-classified: the rng digests and draw counts are
  byte-identical across the whole trace, and the old-to-new diff is exactly
  11 added reliquary blocks plus the 18 paired state-digest moves they
  cause, nothing else (no draws, tick, time, event, or entity lines). Golden
  md5 bf00c277b89e142446550f00c1035696 to f017045f5fa0e85f6d740c99ea4eb225.
  SECOND (am) FIRING at the nineteenth absorb (2026-08-18, commit
  9a16a50e16): the release added three Highwatch practice dummies as static
  world entities and re-recorded its OWN goldens, but farming_session is
  branch-only; re-minted after machine classification proved the diff exactly
  a uniform +3 on every id-carrying leaf plus 45 paired digest moves, with the
  rng lanes and draw counts byte-identical across all 27 blocks. Golden md5
  19c49aac3bf333f59f7608af1f04d50b to 9a8fefa5e48c7e456db7ef2695bfb284. The
  same commit re-recorded the 67 release-side goldens for the branch's +4
  farmer statics (uniform id shift, paired digests, the culling wolf's known
  idle-lane re-seed; zero unexplained leaves) and the terrain height fixture
  followed under its own suite (29 pad-local points, all inside rOut 14 of a
  farmer seat).
  (an) The release's monolith line-count ratchet
  (tests/monolith_budget.test.ts, ceilings minted against release-side
  sizes) was red on the merged tree because farming's pre-ratchet additions
  pushed src/ui/hud.ts to 19617 (ceiling 19490) and server/game.ts to 10979
  (ceiling 10900). Healed by extraction per the ratchet's own policy, never
  a ceiling edit (commit 7dbb21b605): the five HUD farming feedback arms
  moved whole to src/ui/farm_event_feedback.ts (the Hud satisfies the host
  seam structurally; new behavioral suite
  tests/farm_event_feedback.test.ts), and the three farming command bodies
  plus the fplot row builder moved whole to server/farming_commands.ts (the
  case labels stay in dispatchMessage for the command-schema scan; the
  snapshots delta-key scrape gained the extracted emitter as a second
  source). STANDING WARNING for phases 7 to 13: coordinator headroom is
  absorb-eroded, and release growth alone can break a ceiling (the
  FOURTEENTH absorb put hud.ts and server/game.ts OVER ceiling with no
  farming change at all; healed by extraction a3b5ea431b: both
  HEAVY_SELF policy sets moved whole to server/heavy_self.ts and the
  castDisplayName mapper with its rift key table to
  src/ui/cast_display_name.ts). Post-heal headroom 2026-08-14 was hud.ts
  31 lines, server/game.ts 118, sim.ts 15, renderer.ts 21; SUPERSEDED at
  the SIXTEENTH absorb (2026-08-15, the v0.39.0 sync): hud.ts 0
  (19433/19433), renderer.ts 0 (13725/13725), sim.ts 1 (12659/12660),
  src/main.ts 2 (11488/11490), server/game.ts 104 (10796/10900). hud.ts
  and renderer.ts now sit AT exact-count ceilings (the release re-pinned
  hud at its own merged count; the absorb pinned renderer at the merged
  count per the ratchet merge rule), so there is NO margin: a single
  added line in either file reds tests/monolith_budget.test.ts. Every
  future phase touching a ratcheted coordinator works extraction-first,
  and plans the extraction BEFORE the phase starts, not during it.
  Ceiling raises stay a maintainer decision. The ceilings were deliberately
  NOT lowered after these extractions (the root CLAUDE.md lower-after-
  extraction rule): the "current size plus margin" authoring-style
  rationale now applies only to sim.ts, main.ts, and the server files;
  hud.ts and renderer.ts are exact-count pins with zero margin, and any
  re-pin is the maintainer's call at feature review; the QA reviewer
  concurred. WATCH ITEM: the snapshots delta-key scrape's source list is
  now a hand-maintained two-file constant (game.ts +
  server/farming_commands.ts); any future extraction that moves a maybe()
  emitter out of either file must join the scrape's source list in the same
  change or the pin silently narrows.
  NINETEENTH-ABSORB ADDENDUM (2026-08-18): the merge composed both parents
  past three ceilings and the heals follow the ratchet's own rules.
  renderer.ts: the release's DelveInteriorTracker supersedes the branch's
  delve_interior_scheduler.ts (module and suite deleted, reconcile toward the
  release mechanism), and the merged file re-pins at the exact merged count
  13774 per the established merge rule (parents 13660 branch / 13744 release;
  the +30 over the release pin is the branch's Phase 7 farm-patches wiring,
  accepted under its own ceiling then). sim.ts healed by moving the mech
  chroma unlock/unequip pair whole to src/sim/mech_chroma_ownership.ts (the
  release's own module; Sim satisfies the structural host; direct unit suite
  tests/mech_chroma_ownership.test.ts; ceiling 12660 stands as size 12657
  plus the small margin). main.ts healed by moving the Cloudflare Turnstile
  cluster whole to src/game/turnstile_gate.ts, ceiling lowered 11490 to
  11460 (size 11454 plus margin). hud.ts SHRANK release-side (the ability
  description extraction) to 19382 under the release's own re-pin 19387.
  the release's player item lock (issue 3042) names profession consumption a
  refusing boundary, and farming's seed, compost, watch-fee, tonic, and husk
  spends all ran through the lock-blind ctx.countItem/ctx.removeItem (a
  locked split slot sat exactly where the hub removal walk consumes FIRST).
  Every sufficiency gate now counts unlocked units only
  (countUnlockedInSlots) and every payment runs removeUnlockedFromSlots,
  mirroring the crafting.ts reagent idiom (one quest-hook call per payment;
  plant_crop's HEAVY_SELF_CMDS membership keeps the self snapshot fresh, so
  dropping ctx.removeItem's own wireRev bump is covered). Seven arms in
  tests/professions_farming.test.ts pin each touched site; two scripted
  mutations (lock-blind seed gate, lock-blind payment walk) both killed by
  name. Draws unchanged; golden unchanged by this heal.
  COMPLETION (the review round): the first pass copied the release's
  consumption idiom but not its refusal idiom (the architecture reviewer's
  one SHOULD-FIX): issue 3042's acceptance line, quoted in crafting.ts,
  demands a clear locked-item message, and crafting/salvage ship a distinct
  'locked' reason. farmDenied gained 'locked' (appended to the wire union,
  never reordered), each of the five deny sites splits lock-only refusals
  from genuine shortfalls by re-reading the RAW count on the deny path only
  (the insufficientMaterialsIsLockOnly twin; the fee gate re-plans with the
  raw reader), and hudChrome.farming.denied.locked ships with its five M16
  non-Latin fills (zh_CN, zh_TW, ja_JP, ko_KR, ru_RU). The five lock arms
  now assert 'locked', a sixth arm pins the genuine-shortfall polarity (one
  locked produce, fee two: stays no_fee_produce), and the reason-to-line
  distinctness pin covers the new leaf.
  (ap) IWorldFarming gained farmNowMs(): number in Phase 7, the
  RaidLockout-template timer read BOTH the facet's clock-base contract and
  the farm_projection header explicitly deferred to "the first timer
  surface", which the render phase's stage fractions are. Each world
  returns its OWN authority clock base fresh per call: Sim delegates to
  lockoutNowMs() (sim-clock offline and headless, injected Date.now on the
  server), ClientWorld returns Date.now() (the riftEventMsRemaining
  precedent: the live server's lockoutNowMs IS Date.now). No wire field, no
  golden movement; parity pins moved 327 to 328 members, 239 to 240
  methods. Behaviorally pinned in tests/professions_farming.test.ts (same
  base as a fresh plant's plantedAtMs; advances with the tick on an
  uninjected sim), mutation-proven. Consumers derive stage and wet
  fractions only; withered stays authority-status-only. The packet's
  stopping rule said surface-before-widening: MAINTAINER READ OWED on this
  member, argued as the design's own anticipated seam.
  (aq) The Phase 7 acceptance line "npm run asset:budget green" is AMENDED:
  the repo-wide budget is pre-existing RED (the image-to-glb skill states
  it; models/props alone is 12x over its group budget). The honest bar,
  held and recorded: the 15 farm props moved models/props by exactly
  +174,844 bytes, no other group moved a byte, and no group that was under
  its budget crossed. Any future farming asset phase inherits this bar,
  never the literal green.
  (ar) farmGrowthStage + FarmGrowthStage MOVED verbatim from
  professions/farming.ts to professions/farm_projection.ts (its stated
  design home: wall-clock enters only as the nowMs argument), with
  re-exports kept in farming.ts. The facet re-exports the TYPE only:
  tests/architecture.test.ts pins src/world_api as TYPES-ONLY imports from
  src/sim, so the render core imports the FUNCTION directly from the
  projection leaf, which the RENDER_PURE_CORES import contract expressly
  allows. The phase invariant "all farming data enters through the facet"
  holds for every STATE read (farmPatches, myFarmPlots, farmNowMs); the one
  stateless pure-function import is the sanctioned exception, commented in
  both files.
  (as) The asset exporter lives at scripts/assets/farm_props/ (model.js +
  export_entry.js + export_farm_props.mjs + source_fingerprint.mjs + spec
  scripts/assets/specs/farm_props.json), the live per-asset subdirectory
  convention, NOT the packet's flat scripts/assets/build_farm_props.mjs.
  model.d.ts rides along (tsconfig has no allowJs; proven load-bearing) and
  is deliberately OUTSIDE the fingerprint input list, which stays the eight
  pinned paths. Swap-ready contract: FARM_PROP_CONTRACTS in model.js
  (deep-frozen, JSON-shaped for docs/design/farming-asset-manifest.json at
  Phase 13), stamped into each GLB's root extras.
  (at) Farm beds and compost bins have NO collider and NO ground pad: the
  gather_nodes/stations precedent, and tests/farm_patch_placement.test.ts
  already guarantees legal flat ground. Decorative, walkable, non-blocking,
  per the phase Live-surface note; recorded in the farm_patches.ts banner
  so it cannot be re-litigated silently. Nothing landed under src/sim/ for
  this.
  (au) Crop FAMILIES (grain / rootleaf / gourd), per-crop accent tints, and
  the four per-hub biome palettes are RENDER-SIDE data in
  src/render/farm_patches_core.ts: no family column was added to
  FarmCropDef (a sim-content change would drag the content-obligations
  train into a render phase). The exhaustiveness pins in
  tests/farm_patches_core.test.ts run over the LIVE FARM_CROP_IDS and
  FARM_PATCHES, so a ninth crop or fifth hub reds the suite instead of
  silently falling back. Crop identity on the shared family meshes comes
  from the CropAccent/crop_accent tint channel (exporter ships light
  neutral vertex colors; the renderer multiplies the per-crop accent).
  (av) src/render/farm_patches.ts is imported EAGERLY by the renderer (the
  stations precedent), not via the rift lazy-import idiom: the static beds
  must build in the same lifecycle setup as stationProps, so a dynamic
  import would resolve from cache and buy nothing. The per-viewer visuals
  construct after the Vfx exists. Steady state is allocation-free: the
  adapter reads myFarmPlots at most once per uniform 0.5s (plus an
  immediate event-driven resync), and the rebuild key is a piecewise field
  compare (FarmPlotVisualKey), never a minted string. The cadence is
  wall-clock-uniform and must NEVER become preset- or governor-keyed.
  (aw) The Phase 7 renderer headroom extraction is the delve interior
  scheduler (62 lines to src/render/delve_interior_scheduler.ts, commit
  74d29effe1), ceiling lowered 13708 to 13700: the packet's named candidate
  diagnosticsBaselineForPrewarm measured 21 real lines (the Explore gap
  heuristic had lumped in prewarmInitialScene), and updateAmbience reads
  too much private state to move verbatim. Gap-based span estimates need a
  body read before an extraction is planned around one.
  (ax) SFX wiring choices: farm_event_feedback.ts imports the audio facade
  DIRECTLY (the 19-module src/ui precedent) because routing cues through
  FarmFeedbackHost would add hud.ts members at 4 lines of ceiling headroom;
  farmWithered plays the farmHarvest ACTION cue (the same harvest resolving
  unluckily; the distinct disappointment sting and the farm_ready chime are
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as withered-sting-ready-chime.
  Phase 8/10 scope); farmDenied and farmHusksConverted stay silent. The
  placeholder rows ride sfx_prompts.mjs through its UI_SFX_CATALOG import
  (no hand row there), PLACEHOLDER-marked in ui_sfx.mjs, both at 0 dB so a
  real recording drops in without a mix re-balance.
  Phase 7 QA (2026-08-14, branch fix/farming-phase-07-qa), the round's
  addenda; the audit found 0 BLOCKING anywhere (7-lane fan-out, all
  delivered first try) and the fixes below landed in-branch:
  - (ap) ADDENDUM, the owed re-argument, verdict KEEP as the design's own
    anticipated seam: the clock-base contract on myFarmPlots explicitly
    deferred the derived-duration surface to the first timer surface, which
    the render phase's stage fractions ARE; every alternative is worse (a
    per-plot msRemaining wire field costs 20 Hz bytes for a cosmetic read
    and pre-empts the Phase 8 timer decision; letting render subtract
    Date.now violates the contract on the offline host; a status-only poll
    cannot drive smooth fractions); the member is minimal (no wire, no
    persistence, both worlds return their OWN base fresh per call) and
    cosmetically scoped by its comment. MAINTAINER READ STILL OWED at
    feature review per D22. RECORDED ACCEPTANCES riding it: (1) online, a
    client wall clock running fast can render the stage4 "looks ready" mesh
    before the authority flips status (the riftEventMsRemaining skew class;
    magnitude NTP-scale; the harvest then refuses not_ready; authority
    facts stay status plus events, so this is cosmetic annoyance, not
    information leak; capping the fraction path at stage3 was rejected
    because it would lag the ready mesh for EVERYONE online by the refresh
    cadence to fix a rare skew case). (2) withered surfaces online only
    when the heavy-gated fplot re-diffs (no command and no event marks it),
    so a doomed crop can render stage4 for up to the staggered-refresh
    backstop; correct direction (authority owns withered), bounded,
    recorded.
  - (av) ADDENDUM: the renderer drives sync/update from BOTH the main frame
    and prewarmWorldFrame (boot settle, zone warm, and the render-budget
    shader warm), the exact riftDeathZoneVisuals idiom; a warm burst can
    add transient extra reads and sway ticks. Ruled acceptable and NOT a
    governor coupling: the direction is refresh-sooner only, the steady
    state stays the uniform 0.5s, and no continuous preset/governor input
    exists (the fairness suite now also scans the GFX surface with the
    surfaceMat allowance pinned as an exact single-name import). Editing
    renderer.ts to single-site the drive was rejected: it would re-stale
    RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as renderer-farm-sync-single-site.
    all three renderer-edit evidence-seal families for zero player-visible
    gain.
  - ONLINE EVENT-ORDER RACE healed (commit 4d6ff0e21e): the farm event and
    the fplot rows ride two ws messages in a fixed order (events first), so
    the adapter's event-forced read could spend its dirty flag on
    pre-change rows and the change then waited out the full 0.5s throttle.
    The forced read now stays armed until a read OBSERVES a change
    (create, rebuild, or dispose), bounded at one interval; offline
    behavior unchanged (the change is same-tick there). Both arms pinned,
    mutation-proven (M1/M6). GENERAL RULE for any future event-forced
    cache invalidation over the wire: the event frame and the state frame
    are separate messages, so a one-shot dirty flag consumed by the next
    read is a race by construction.
  - (aq) SCOPE NOTE: the +174,844-byte delta bar counts public/models/props
    only; the phase also added ui_farm_plant.mp3, ui_farm_harvest.mp3, and
    the regenerated runtime-pack.json under public/audio/sfx, owned-build
    artifacts in the audio group (now also freshness-welded by the gate's
    manifest-freshness family).
  - (as) ADDENDUM: pnpm-lock.yaml is a member of FARM_PROPS_SOURCE_FILES,
    so tests/farm_props_asset.test.ts JOINS the lockfile-seal family (the
    8-suite class is 9 with it): any lockfile bump reds it and takes the
    size-preserving re-mint runbook, never pin edits. Exporter determinism
    was re-proven this QA end to end: the driver's built-in
    candidate/repeat byte-compare passed and the in-place shipping rewrite
    left git byte-identical (the clean tree IS the proof).
  - RELOAD-REGROW PREMISE RE-POINTED: the offline client persists NO
    character state across a page reload (proven live twice: every offline
    entry is a fresh character), so the "offline-reload regrow asymmetry"
    the parity review named cannot exist offline; the re-anchor semantics
    it described live in the ONLINE path (farm_persist.ts). The live
    render check of a resumed mid-growth plot moves to Phase 9 QA, which
    owns the online rig (the disposable-PG hard gate).
  - DEFERRAL VERDICTS (the six owed): instanced-prop extraction FIXED
    (src/render/glb_instanced_props.ts, stations and farm adopt whole,
    gather_nodes documented out on its per-instance matrix composition);
    cloneMaterialWithHooks FIXED (tintOne, with the decisive
    cache-key-survival arm); GLB-loaded branch synthetic coverage FIXED
    (test-only setLoaded seam, four arms: socket mount, accent tint plus
    wet darken, shared-geometry survival, hook survival); two-tier BUILT
    fairness arm RE-DEFERRED with reason (no quality input exists
    structurally: the build and the visuals take no preset, pinned by
    arity and the GFX allowance scan; implement the two-preset build diff
    only if gfx.ts ever grows preset-keyed geometry); releaseGltf
    residency RE-DEFERRED as a no-leak verdict, policy stated at the
    preload block; the offline-reload live check re-pointed per the
    premise correction above.
  - SMALLER LEDGERED NOTES: FarmPatchVisuals.dispose() is never called by
    the renderer (the riftDeathZoneVisuals family-wide precedent; the
    fallback template material is likewise never disposed, bounded at 15
    kinds per session); the 12 crop-stage GLBs ride the CRITICAL preload
    lane though only bed/bin are needed at scene build (maintainer ruling
    invited on a background-lane split); idle sway ignores reducedMotion
    (ambient world motion, the foliage precedent; maintainer glance); the
    renderer's three-case farm event route has no direct pin (the adapter
    guard is pinned; a dropped case label is only caught live); the
    correctness lane measured rendered plot heights above STAGE_HEIGHT
    targets through a bbox tilt-projection artifact of its own probe, not
    a normalization bug (heights ascend strictly, stages distinct).
  Phase 8 deviations and rulings (2026-08-14, branch
  fix/farming-phase-08-harvest-journal):
  (ay) The derived msRemaining wire field is DECLINED, closing the question
  (ap) and the farm_projection banner deferred here: the journal derives
  remaining time as readyAtMs minus farmNowMs() clamped at zero, renders
  Ready from status ALONE (a zero countdown under a growing status is a
  "finishing" state), and inherits the (ap) NTP-scale cosmetic skew
  acceptance. A per-tick-varying wire field on the fplot key would defeat
  the heavy-self diff gating (the key's bytes are identical between real
  transitions by design) and re-serialize every planted farmer at 20 Hz for
  a cosmetic read. The banner in farm_projection.ts now records the ruling.
  RULED (qr-19-fplot-msremaining-wire-field, under qr-19-best-for-project, 2026-09-01):
  ruling (ay) is RATIFIED as the permanent design; the client-derived countdown stands and the
  wire field stays declined. The maintainer's direction for this packet is to make the feature
  as stable, fast and performant as it can be, and this field costs exactly that property: a
  per-tick-varying value on the fplot key defeats the heavy-self diff gating (the key's bytes
  are identical between real transitions by design) and re-serializes every planted farmer at
  20 Hz for a read the journal already derives correctly from readyAtMs minus farmNowMs()
  clamped at zero. The root CLAUDE.md hot-path rule bars it in those words: new server
  hot-path work, a broadcast payload included, uses the performance seams, "build-once realm
  readouts and serialize-once events", and this field is the opposite of both. Refused because
  it costs the performance the directive asks for, not because it is expensive to build. The
  farm_projection banner already records the contract and needs no edit.
  (az) Open surface: the journal opens from the professions window's
  Farming row plus the Shift+K keybind (harvestJournal, Interface category;
  Shift+H and Shift+J were taken). NO side-rail button: the rail guard has
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as harvest-journal-rail-button.
  room (col-a measured 414 of 660 px), but hud.ts ceiling headroom is the
  binding budget and the packet's "rail at capacity" premise was WRONG in
  direction (guard fine, monolith tight). hud.ts closed the phase at 19485
  of 19490.
  (ba) The harvest confirm channel ((ah)/(af)) stays RE-DEFERRED: the
  journal is informational by design (no plant or harvest button, no
  command sent), so promptSlotRefused and the resolver arm are untouched.
  (bb) LINKDEAD ACCEPTANCE, maintainer read owed at feature review: a plot
  ripening during the linkdead grace window loses its transient notice
  permanently (probed: sendRaw drops frames for a non-open socket, and the
  login check stays silent because notified persisted true). Accepted
  because every durable surface this phase ships (journal, map pins, fplot
  status) shows the truth on resume, and every honest fix needs a
  connectivity concept the sim deliberately lacks. Same class, smaller: a
  disconnect inside the one tick between addPlayer and its event drain
  loses the login notice the same way.
  (bc) The 1 Hz sweep is deliberately UNSHARDED on the crowded % 20 === 0
  residue (the hot-path review's convoy finding): sharding by entity id
  would move which tick each notice emits on and fork every parity golden;
  measured cost is sub-millisecond at realm scale and visible under the
  'farming' perf lap. Revisit only with tick-cost evidence. Related note:
  cross-player farmReady order within a tick follows player-map insertion
  order (draws nothing, forks nothing).
  (bd) Pin art: procedural-only two-leaf sprout, STATION family color on
  BOTH surfaces (gatherReady green refused: it means harvestable-right-now
  and the pin carries no plot state; a patch is a static service site, the
  crafting-station doctrine). The painted MapMarkerArtId with its full
  provenance chain (WebP, mapping.json, CREDITS.md reword) is recorded
  asset debt for the Phase 13 batch. A ledgered UX wrinkle from the
  architecture review rides the status seam: a plot announced withered can
  later project ready after a proficiency gain (monotonic, one-direction),
  with no correcting notice; the bed itself shows the truth.
  (bd) AMENDMENT (Phase 8 QA, 2026-08-17): "STATION family color on BOTH
  surfaces" is true of the minimap only. The minimap sprout fills with
  --color-minimap-station (the station family's orange, the static-service
  doctrine); the ZONE MAP sprout fills with --color-map-oak (the map
  palette's oak green, chosen in map_window_painter.ts so a growing site
  never reads as the herb-node readiness green while still reading as a
  plant), NOT the map station badge's --color-map-stall. Both painters argue
  their own choice and both painter tests pin the literal token, so the
  code and tests are honest; only this ledger line was wrong. Left as a
  per-surface choice for the Phase 13 painted-art batch to unify (one
  MapMarkerArtId would replace both procedural fills); maintainer glance
  invited then, no code change in QA.
  Phase 8 QA deviations and rulings (2026-08-17, branch
  fix/farming-phase-08-qa):
  (be) SIMPLIFIED-MODE GATHERING ROWS, maintainer read owed at feature
  review: the (az) entry surface ("the journal opens from the professions
  window's Farming row") did not exist for a pre-attunement farmer, because
  the professions window's simplified body (syncing, or unattuned with every
  craft under tier 1; professions_view.ts mode rule) painted the identity
  paragraph and ONE call to action and no gathering section at all, so a
  farmer who had never crafted to tier 1 reached the journal only through
  Shift+K (found by the QA live-client drive: professions_window.ts composed
  gatheringHtml inside fullHtml only). Fix, in the pure core: the model now
  derives simplifiedGathering, the rows the simplified body ALSO paints
  beneath its call to action, which is every gathering row the player has
  actually WORKED (skill above 0) plus the Farming row while any bed is
  planted (a new REQUIRED ProfessionsViewInput.farmPlotCount, read from
  IWorld myFarmPlots.length and folded into professionsRefreshSig as
  presence, so a farmer's first growth cycle reaches the journal before the
  first skill point does and a second plant rebuilds nothing). Skill-0 rows
  stay hidden, so a fresh character's simplified window is unchanged, and
  full mode is untouched; both modes paint rows through the ONE
  gatheringSectionHtml builder, the simplified body with `effects: false`
  (bar plus the journal opener ONLY: the slot, recharge, and ask-each-use
  controls all spend, and the simplified body's one call to action stays
  its only spender; pinned). Two honest notes for the read: the syncing
  trigger paints worked rows under the "syncing" paragraph for the sync
  window (monotone, harmless, pinned as the same rule); and the strongest
  justification is touch: mobile has NO other journal launcher (no rail
  button per (az), no More-tray entry, and Shift+K is keyboard-only), so a
  pre-attunement touch farmer had ZERO entry before this. Live evidence:
  docs/screenshots/farming-phase-08/{before,after}-professions-simplified-
  {desktop,mobile}.png. This is a general professions-window change
  (a pure gatherer, mining 60 and no craft, also sees their worked rows in
  simplified mode now, which the tutorial line "craft or gather with any
  profession to begin" already invited), so it is ledgered here as a
  Professions 2.0 surface deviation with the read owed; reverting to the
  strict CTA-only doctrine, or narrowing to the farming row alone, is a
  one-predicate change in buildProfessionsView. Pinned in
  tests/professions_view.test.ts (the rule, both simplified triggers, the
  signature presence arm) and tests/professions_window_layout.test.ts (the
  opener under the Farming row in both modes, click routing, absence without
  the dep, under other rows, and for a fresh character).
  (bf) The four review residuals the phase session left unledgered are
  recorded here as accepted, with the corrections the QA lanes made: (1) the
  "offline login notice under the loading overlay with the cue swallowed by
  the autoplay gate" residual was MIS-STATED: the login check is reachable
  only where a saved state is restored (the server host and the tests; the
  offline Sim constructs its player with no state, so notifyFarmReady
  early-returns on every offline boot), so the loading-overlay/autoplay
  concern applies to a SWEEP notice arriving during the offline boot, not to
  a login notice; cosmetic, accepted. (2) farmPatchMarkerAt/stationMarkerAt
  are twin production-dead exports (real hit-testing goes through
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as map-marker-dead-exports.
  mapPointMarkerHitsInto's arms); family consistency, test-covered, delete
  both together if the family is ever cleaned up. (3) the sprout ratio
  constants are declared in both painters with reciprocal cross-references;
  rule of three not met (two copies), hoist on a third surface. (4) the
  10-11px mobile chip and secondary type (.hj-care-chip/.hj-care-none 10px,
  .hj-bed/.hj-stage 11px) measured live at 10px on 390x844 with no overflow;
  legibility judgement, accepted, revisit with the Phase 13 art pass. (5) is
  the (bd) tail above.
- Dev command surface: Phase 3 registers /dev farmgrow [bedId] (alias
  /devfarmgrow [bedId]) in src/sim/dev_commands.ts behind ALLOW_DEV_COMMANDS:
  with a bed id it advances that plot, without one it advances ALL of the
  caller's plots; it sets readyAtMs to ctx.lockoutNowMs() only (plantedAtMs and
  the hidden slots untouched, so it is not a reroll primitive), leaves
  already-settled plots alone, counts only work actually done in its [dev]
  summary, and draws nothing (pinned). /dev gather farming N already works
  (Phase 1). The /dev GUI row (src/ui/dev_command_view.ts) was RE-DEFERRED
  by Phase 7 and LANDED in Phase 8: a farmgrow row in DEV_COMMAND_ACTIONS
  (category progress, token(values, 'bed') for the optional bed id, a blank
  field emitting the all-plots form) plus the dev window's text-field case,
  behind the existing ALLOW_DEV_COMMANDS gate. Phases 7 and 8 depend on
  these for dev-created crops.
- Growth-phase (Phase 3) handoff from the Phase 2 review round, decide these ON
  PURPOSE rather than inherit them. PHASE 3 RESOLUTION (2026-08-08), each item
  below marked here rather than rewritten in place: anchor semantics DONE in
  a8560344a2 (one-rule max(nowMs, 1) re-anchor pinned on BOTH load paths;
  non-finite clocks SKIP the re-anchor entirely per the migration review; the
  WRITE side floors its anchor at 1, the pair discovered in review); hidden-slot
  clamps DONE in a8560344a2 (survivalRoll [0,1), yieldSeed uint32, absent slots
  derive via FNV-1a over bedId:plantedAtMs, clamp-CHANGED slots feed the
  operator warn, the derivation comment states the accidental-loss guarantee
  honestly); plant-time bed-id validation DONE in a8560344a2 with the refusal
  pinned; the runtime size signal DONE in 5e0e9ab766 (CHARACTER_BLOB_WARN_BYTES
  131072 measured not guessed, warn-only, rate-limited, attempt-worded, at the
  characterUpdateStatement chokepoint all three save paths share; the
  disposable-PG TOAST/WAL measurement recipe was NOT run this phase, deferred
  to Phase 3 QA if the db reviewer demands it); the per-tick fplot emit
  RESOLVED in 5e0e9ab766 (moved behind the heavy-self gate, see the wire-keys
  ledger); the deploy-order constraint CARRIED into DEPLOY.md in the docs
  commit; the derived-duration msRemaining field STAYS DEFERRED to the first
  timer UI (Phase 8; this phase ships no UI, the clock-base contract comment
  remains the guard); admin visibility UNCHANGED (no farm section was added to
  the inspector; the field-pick rule stands for whoever adds one); the
  crop-table client-shipping check HOLDS (FARM_CROPS ships durationMs and tier,
  both derivable from public wire state; the pre-rolls stay the only secret);
  iteration order, read-identity asymmetry, and spectator notes all HELD
  (nothing regressed them; the parity scenario and suites pin the first two).
  - The anchor semantics family: the farm_persist nowMs > 0 guard means an offline
    load at sim.time 0 keeps saved anchors while a post-tick load re-anchors (two
    offline load paths disagree), and offline growth restarts inflated rather than
    continuing through logout; the reviewers' concrete direction is re-anchor to
    max(nowMs, 1) or an epoch-based offline clock, pinned by BOTH a fresh-Sim load
    and a post-tick load. The mirror hazard (an absurdly PAST anchor loading on a
    wall-clock host reads instantly ready) needs no code now: since Phase 2 QA the
    scan pin in tests/professions_farming_state.test.ts holds the CLOCK-BASE
    premise directly (every serializeCharacter caller lives in server/ AND injects
    lockoutNowMs; the three scratch-sim builders, creation / PBE boost / community
    templates, were fixed to pass () => Date.now() after passing the old
    directory-only scan on the sim-clock default), and a save editor can craft
    instant-ready with legit-looking values anyway, so an epoch floor buys no
    anti-tamper value.
  - The derived-duration wire field (RaidLockout msRemaining template) lands with
    the first timer UI; until then the clock-base contract comment in
    src/world_api/farming.ts is the only guard.
  - Absent/corrupt hidden slots: prefer DERIVING a replacement deterministically
    (bed id plus plantedAtMs) over re-rolling at harvest, so a dropped slot is not
    a reroll primitive. Since Phase 2 QA a dropped slot is visible to operators
    (countDroppedHiddenSlots feeds the load warn; the row count alone could not
    see a surviving row lose a slot).
  - HARD GATE from the privacy review: clamp survivalRoll into its real interval
    and yieldSeed to a bounded integer IN THE SAME CHANGE that gives the slots
    meaning; today they pass the load on a bare finite() check while every
    neighbouring field has an allowlist, a positivity check, a ceiling, or a
    coercion, which is fine only while their value domain does not exist.
  - Iteration order is now guaranteed: normalizeFarmPlots inserts in sorted bed
    order (Phase 2 QA), so per-tick iteration over meta.farmPlots can draw rng
    without the stream position depending on JSONB key order. Do not regress this
    with an unsorted bulk insert.
  - Read-identity asymmetry at the seam: Sim.farmPlotsFor allocates a fresh array
    per NON-EMPTY read (the empty arms return the shared frozen
    EMPTY_FARM_PLOT_VIEWS since Phase 2 QA) while ClientWorld.myFarmPlots keeps
    one array until the next fplot delta; the first UI consumer must not memoize
    by reference or === -diff rows across reads.
  - Admin visibility: serializeCharacter snapshots (server/admin.ts character
    inspection) will expose filled survivalRoll/yieldSeed to operators; decide
    whether that is acceptable when the slots go live. The R35 professions
    inspector shapes output through characterProfessionsSheet's explicit field
    picks and never touches state.farmPlots today; a farm section added there
    must field-pick the way the wire projection does, never dump the record.
  - The crop content table ships to the browser (src/net/online.ts imports
    farm_patches.ts): patch/bed geography and ids are safe, and published
    per-crop base rates would be too, but the moment a rate column lands in
    that table re-check what a client can compute (the per-plot pre-roll stays
    the only real secret).
  - Deploy-order constraint (mixed fleet): an old server process autosaves the
    whole blob WITHOUT farmPlots, so this build must be fully rolled out before
    any build that can PLANT ships; a rollback past this phase after plants exist
    destroys plot state on the next autosave. Carry this into DEPLOY.md in the
    phase that makes plots plantable; it lives only here until then.
  - The per-tick fplot emit stringifies every planted player's rows at 20 Hz
    (tslot-consistent, bounded at 23 beds); revisit if rows grow.
  - Stored-data growth at fleet scale (the database-performance row, recorded
    at Phase 2 QA; the reviewer corrected the first estimate's conflation):
    a fully planted character adds 4,451 bytes of JSONB to characters.state
    (23 beds at about 193.5 bytes; blob ceiling re-minted 14336). STORAGE is
    one-time: about 44.5 MB per 10k fully planted characters. WRITE volume
    scales with CONCURRENT ONLINE, not the table: the 30 s autosave sweep
    (AUTOSAVE_SECONDS, server/game.ts) writes only online sessions, so the
    worst case is about 4.45 MB per sweep at the R36 1,000-concurrent target
    (about 148 KB/s logical). Today's real number is ZERO: no writer exists.
    Postgres rewrites the whole TOAST value on any change, so once plants
    exist the delta rides every autosave of a planted character; pglz should
    compress the 23 near-identical rows well below the uncompressed figure
    (inferred, not measured).
  - TWO MORE HARD GATES from the database review, landing WITH the plant
    writer (Phase 3): (1) validate the bed id against FARM_BED_IDS at plant
    time and pin the refusal; the load-side allowlist is the ONLY 23-row
    bound and it cannot catch a live writer bug before the blob grows.
    (2) a runtime size signal on the serialized character state
    (JSON.stringify(cleanState).length already exists at
    server/db.ts saveCharacterState; guild-bank books have a measured skip
    bound and warn, the character blob has none). Sizing measurement recipe,
    DISPOSABLE local PG16 only: pg_column_size(state) with and without the
    13,948-byte worst-case blob for the compressed delta, then
    pg_current_wal_lsn() movement across about 100 repeated UPDATEs of each
    shape for per-save WAL amplification.
  - Spectator sessions mirror the spectated player's plots into myFarmPlots (the
    whole self block does this); do not hang plant/harvest UI off it while
    spectating.
  - Stale beds-arrive-later comments to sweep when farming's guide content lands:
    scripts/wiki/build_content.mjs:773 and src/guide/pages/professions_gathering.ts
    header prose (release-side files, deliberately untouched this phase), PLUS the
    two PLAYER-VISIBLE guide prose keys (Phase 3 QA addition, the qa-checklist
    catch): guide.profPages.gatherIntro.farming ("Its beds, seeds, and tools arrive
    in a later patch...") and guide.profPages.gatherDeeds.farming ("its beds are
    still to come") in src/ui/i18n.catalog/guide.ts, which otherwise keep telling
    players in every locale that farming has not shipped while they are planting.

- Phase 3 QA addenda (2026-08-08), carried for later phases:
  - The disposable-PG TOAST/WAL measurement is DEFERRED to Phase 9 (go-live) as a
    HARD gate there, by the database-performance reviewer's explicit ruling this
    QA: the phase's whole functional DB delta is the warn-only blob-size call at
    the characterUpdateStatement chokepoint, farming is dormant online (no seed
    faucet), and the blob ceiling suite already bounds the serialized size.
  - Blob byte model re-measured this QA: settled 13,994 bytes (about 196 per bed),
    342 under the 14336 ceiling; pins stand; the Phase 5 crop ladder re-measures.
  - Phase 9 hardening notes from the second review round, deliberate deferrals:
    (1) farmDenied echoes the raw length-unbounded bed/crop strings back to the
    actor (pid-scoped, ws maxPayload 16 KiB + rate limits bound it, the HUD
    renders only the reason enum; bound the string length at dispatch or drop the
    ids from the bad_bed arm if go-live load review wants the allocation closed).
    (2) plant_crop/harvest_crop mark HEAVY_SELF on receipt, so a spammed refusal
    buys a heavy self re-serialize whose fplot arm is O(authored beds); confirm
    the command rate limiter bounds refusal spam at go-live, or mark on success
    only (farmPlanted membership plus the wireRev bump already cover success).
  - Admin exposure VERIFIED clean this QA: both R35 inspector route arms shape
    the raw adminCharacterState snapshot through characterProfessionsSheetFromRow
    (explicit field picks, no farmPlots today), so the hidden slots never leave
    the server over HTTP; the field-pick rule stands for whoever adds a farm
    section. Work orders verified N/A: the commission modules carry zero
    gathering-profession references, so no farming order can mint before the
    phase that wires crops in deliberately.
  - EXECUTED in Phase 4 (commit 122dd3de56; this line predates it): the
    farming_view.ts extraction fired, moving farmDeniedLineKey plus FOUR farm
    grant-line selectors (farmHarvestLineKey, farmFineLineKey,
    farmWitheredLineKey, farmPlantedTokenId; the original count of three was
    an undercount), moves not re-exports, with the test blocks relocated to
    tests/farming_view.test.ts. See the Phase 4 entry in progress.md.
  - The command-level 'skill' deny emit is unreachable until a tier-2 crop ships;
    the Phase 5 crop ladder inherits driving it (one plant below a real
    threshold) deliberately.
  - farmGrowthStage now takes the structural minimum (plantedAtMs/readyAtMs pick)
    and documents the clock-base contract in its banner; the msRemaining wire
    field stays owed to Phase 8 (the first timer surface).

- Phase 4 QA addenda (2026-08-08), carried for later phases:
  - THE TONIC CONTRACT, ledgered here because the next session reads this
    file first (it previously lived only in the farming.ts banner and the
    progress.md notes): the tonic bonus roll is SEED-ANCHORED, one value
    from mulberry32((yieldSeed ^ 0x9e3779b9) >>> 0), never a read past the
    lives loop, so the tonic outcome is a plant-time constant and a
    skill-up can only add picks (the 200-seed monotonicity sweep pins it,
    and the review round measured about 5.8k win-to-loss flips per million
    adjacent skill steps under the loop-relative form). ANY future pre-roll
    expansion (Phase 5 crops, Phase 8 UI previews, new knobs) that anchors
    an auxiliary roll to a skill-varying loop position is a regression,
    not a cleanup.
  - The QA killed three surviving mutants by making their pins real: the
    two end-to-end tonic arms ran on a losing seed (41) and now run on the
    probed winner TONIC_WIN_SEED with non-vacuity guards; the fee-module
    ordering/exclusion/dedupe promises were unfalsifiable against the
    one-crop catalog and now drive an injectable synthetic ladder; the fee
    legs gained their own check-then-pay atomicity arm (the compost arm
    alone could not see a fee spent at its gate).
  - The seed/produce disjointness pin in tests/farm_watch_fee.test.ts
    walks the LIVE catalog: a Phase 5 crop whose seedItemId aliases any
    produce id reds there (the fee plan is made before payments run, so an
    aliased row would double-count one stack and under-collect silently).
  - Accepted as-is, deliberately: FARM_SUPPLY_ITEM_IDS stays exported with
    no external consumer yet (the Phase 9 farmer-NPC vendor stock is its
    intended reader); the growth_tonic icon shares the 'sparkle' overlay
    with the fine-grade family (glyph-semantics note for the Phase 13 art
    batch); the knob deny lines stay full English prose rather than
    spliced name tokens, with the rename-drift pin in
    tests/farming_view.test.ts as the tie; the roughly 120 pending Latin
    locale rows ride to the release-time fill as usual; no HUD affordance
    teaches the knobs or the husk trade until Phases 7 and 8 (the deny
    toasts are the fallback surface, per the phase's own deferral).
  - The four deliberate no-action calls from the phase notes were
    re-judged and ALL UPHELD (refusal-spam re-serialize, offline forged
    knob flags, the deviation (w) auto-exemption with the exact-set pin as
    its gate, the Materials chip classifying two dormant faucet-free
    items).

- Phase 5 QA addenda (2026-08-09), carried for later phases:
  - TWO REAL COVERAGE HOLES closed test-only: the R47 ratchet line in
    harvestCrop and the R42 spend predicate's FALSE branch were both
    deletable or invertible with every suite green. The false-branch pin
    uses the INVERTED probe (sweep for a seed where the armed expansion
    changes NOTHING, then demand the charge survives while the ratchet
    still latches); keep that idiom for any spend-only-when-it-mattered
    settle a later phase adds.
  - The ratchet's rarity read is the UNFILTERED ownership scan ON PURPOSE,
    confirmed against the node settle (gathering.ts) and the R30 recharge
    read: the latch only prices a slot UP, so an unwieldable carried hoe is
    the anti-gaming case, not a scan bug. Stated at the call site now; do
    not "fix" it to the wield-filtered scan.
  - EXCLUSION SETS NEED PINS, the M3 lesson: the R37 hub arm's farming skip
    survived being widened to mining (nothing red). The arm now collects
    hubSkipped/hubAsserted sets and pins both directions, and the
    delve-shop farming skip gained the inverted no-Marks-row-today
    tripwire. Any future census exclusion ships WITH its set pin.
  - The mint-side farming+prompt gate deliberately has NO load-side twin,
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as prompt-slot-load-side-twin.
    the decision RECORDED here after three lanes converged: every
    confirmMode writer routes through resolveSlotToolEffect (the slot
    actions both call it; the admin restore body carries no confirmMode
    field), so no legal path mints a farming prompt row; a hand-edited
    offline blob row loads as a dead prompt slot (skip-whole, charge kept,
    mode chip visible), which is the fail-safe direction. Revisit ONLY if a
    new re-mint or import path lands.
  - Fine-twin buyValue doctrine, flagged for the maintainer with the other
    economy constants: ALL EIGHT fine twins price buyValue at 4x their own
    sell (the node fine-material convention fine_vale_wheat set in Phase
    3), while tier 3/4 seeds and non-carrot produce carry none under the
    no-vendor-faucet rationale. Both rules are individually stated; their
    intersection (a priced tier-4 fine twin above an unpriced tier-4 seed)
    is a doctrine question nothing enforces either way today because
    nothing stocks any of the 31 ids until Phase 9.
  - Screenshot drift, program-wide: Phases 2 through 4 shipped no captures
    (sim-only surfaces); Phase 5 QA added the bag-grid capture of the 31
    stand-in icons on the LOW preset under docs/screenshots/farming-phase-05
    (desktop; the mobile offline boot flow resisted the harness and the
    icons are viewport-identical assets, deferred). The obligation
    re-anchors hard at Phase 7 (the first world-visible surface) and every
    later visual phase.
  - Mutation battery: 4 of 5 mutants killed as shipped with named reds
    (gate-12 bare-hands swap, dropped charge spend, outcome-forked
    seed-back, dropped silent flag on the seed-back grant); the exclusion
    widen survived and its pin now kills it (re-proven). The commit-first
    rule was struck a FOURTH time this program: a re-probe's checkout
    revert wiped the uncommitted pin it was proving; the battery's fix
    landed in its own commit before any further probe.

- Phase 9 ledger (go-live, 2026-08-17). NPCs: farmer_jessica (zone1.ts
  ZONE1_NPCS, appended last, inline pos (24.5, 32.5) facing -PI/2, color
  0xa8843a, questIds ['q_farm_intro'], vendorItems ['vale_wheat_seed',
  'brook_carrot_seed', 'brook_carrot', 'compost', 'garden_hoe']),
  farmer_teasel (zone2.ts + fenbridge_layout.ts services.npcs row anchored
  to patch_mirefen, (-21, 333.5), vendorItems ['marsh_rice_seed',
  'bog_beet_seed', 'compost']), farmer_hollis (zone3.ts, (-18, 695.5),
  ['compost']), farmer_verbena (evergarden.ts, (348.5, 867), ['compost']);
  every def `farmer: true` (NpcDef flag, src/sim/types.ts); NPC_IDS rows in
  src/ui/world_entity_i18n.ts; entities.npcs.<id>.{name,title,greeting}
  with the five non-Latin fills; VOICE_ALIAS rows in
  scripts/voices/npc_voice_prompts.mjs (jessica -> provisioner_fenna, teasel
  -> trapper_brosk, hollis -> groundskeeper_bram, verbena ->
  orchardist_pomeline) plus docs/design/npc_voices.md entries; every farmer
  renders through the NPC_KEYS 'npc_villager' fallback (no explicit look
  row; the Phase 13 art batch may assign one). Quest: q_farm_intro 'First
  Furrow' (zone1.ts right after q_prof_intro; ZONE1_QUEST_ORDER after
  q_prof_intro; QUEST_IDS after q_prof_intro; requiredItems ['garden_hoe',
  'vale_wheat_seed']; objectives [{ type: 'farm', action: 'plant', cropId:
  'vale_wheat', patchId: 'patch_eastbrook', count: 1, label: 'Vale Wheat
  planted' }, { ...action: 'harvest'..., label: 'Vale Wheat harvested' }];
  xp 150 / copper 50 / no item reward / no minLevel / no requiresQuest / no
  rev). Work orders: q_prof_workorder_kitchens_wheat 'Kitchens Wheat Order'
  (vale_wheat x8, copperReward 16) and q_prof_workorder_kitchens_rice
  'Kitchens Rice Order' (marsh_rice x5, copperReward 20), both at
  cook_marlow (questIds appended), xp 100, repeatable on
  WORK_ORDER_CADENCE_TICKS, in ZONE1_QUEST_ORDER and QUEST_IDS after
  q_prof_workorder_kitchens, in the tests/professions_work_orders.test.ts
  WORK_ORDERS table. Items: NO new item; garden_hoe and vale_wheat_seed
  gained noVendorSell + noMarketList (deviation (bg)). Types: QuestObjective
  'farm' member (2953d6ccb2), NpcDef `farmer?: true` (2f22f9a5e9),
  farmDenied reason 'no_farmer' appended (fifteenth reason). New modules:
  src/sim/professions/farmer_npcs.ts (FARMER_TRADE_RANGE, isFarmerNpcEntity,
  nearFarmerNpc). i18n keys: hudChrome.farming.denied.no_farmer ('You must
  be near a farmer to trade husks for compost.'), hudChrome.farming.huskTrade
  ('Trade husks for compost'), hudChrome.farming.huskTradeAria ('Trade
  withered husks for compost with {name}'), guide.profPages.farm.bedsHeading
  ('Working the beds') and .bedsBody (the live loop, two paragraphs), the
  reworded guide.profPages.gatherIntro.farming and
  guide.profPages.econ.workOrdersNote (its thirteen Latin fills corrected
  in-phase because the old text stated a now-false one-order-per-master
  rule; the other stale Latin farming fills stay owed to the release fill);
  all wordy values with the five non-Latin fills; NO matcher rows (no new
  ctx.error text; the deny is a text-free SimEvent). Tests (new):
  tests/farmer_npc_placement.test.ts, tests/farm_intro_quest_content.test.ts,
  tests/farm_intro_quest_journey.test.ts, tests/farmer_vendor_purchase.test.ts,
  tests/farm_quest_objective.test.ts; (flipped) the R37 arms in
  tests/professions_zone_rollout.test.ts, the convertHusks describe in
  tests/professions_farming.test.ts, the guide farming-tool branch;
  (re-pinned) eastbrook_gameplay_integration (ZONE1_NPCS key list +
  farmer_jessica, town payload digest, cook_marlow.questIds), fenbridge
  layout payload digest, quest_marker_kind repeatables 11 to 13,
  farming_view/farm_event_feedback reason lists, gossip_menu content
  literals, professions_starter_tools TIER_1/HIGHER tool sets, terrain
  chunk digest, the terrain atlas fixture, four map plates + world strip.
  Shot targets: farmer-jessica, farm-intro-quest-dialog, farmer-gossip-menu,
  farmer-vendor-grid in scripts/pr_shot_targets.mjs (stageFarmerJessica
  helper); screenshots under docs/screenshots/farming-phase-09 with the CI
  cone row in all five ci.yml blocks and the SPARSE_CONE literal.
  LIVE-SURFACE FLIP: seeds (tiers 1 and 2), compost, brook_carrot and the
  garden hoe are purchasable, the intro quest exists, husk conversion is
  reachable at every farmer, the ready notices fire for real crops, the
  plant-grow-harvest-cook loop is open; still unreachable: farming deeds and
  golden_harvest (Phase 10), well-fed dishes (Phase 11), the feast (Phase
  12).
  (bg) THE INTRO GRANT FENCE, maintainer read owed: the requiredItems
  re-grant makes garden_hoe and vale_wheat_seed quest-granted items, and
  the starter-tools doctrine (tests/professions_starter_tools.test.ts,
  "every requiredItems quest anywhere keeps its item out of the stores the
  predicate cannot see", plus the items.ts garden_hoe banner) demands
  noVendorSell + noMarketList on both, so a PURCHASED garden hoe (20
  copper) or seed can never be sold back, mailed, guild-banked, or listed,
  only sown, used, or discarded (the copper_mining_pick precedent: also
  vendor-stocked and fenced). The seed re-grant is a small free-seed faucet:
  one 4-copper seed per giver talk while the quest is ACTIVE, bounded by
  the beds a player can hold planted before the first harvest turns the
  quest ready (the re-grant runs for active quests only, verified in
  tests/farm_intro_quest_journey.test.ts). Face-to-face trade
  (src/sim/social/trade.ts, kind quest / soulbound / rift gear only) is the
  ONE exchange pipe that does not read the two flags, so a cooperative pair
  can pass free seeds or hoes (the produce is unfenced and vendorable):
  a 4-copper-per-cycle balance leak shared with every requiredItems item,
  not a security hole. Options for the maintainer: extend the trade guard
  to honor noVendorSell/noMarketList (a general trade rule change), or
  accept and record. Left as-is this phase. KNOCK-ON the QA gate named:
  garden_hoe is also the rung-2 hoe's crafting reagent (HOE_RECIPES,
  src/sim/content/recipes.ts), so noMarketList means an engineer can no
  longer buy that reagent off the World Market or receive it by mail; every
  bronze hoe needs a trip to Farmer Jessica (unlimited at 20 copper) or a
  face-to-face trade. Crafting consumption itself is unaffected; a market
  liquidity change, not a dead end. Same read.
  (bh) NPCs ARE TERRAIN: every NPCS row is a calm-anchor pad
  (src/sim/terrain_calm_anchors.ts, rIn 6 / rOut 14), so seating four
  farmers reshaped the ground inside their skirts (the dense atlas moved 60
  of 282406 points, 0.02 percent, all inside the four footprints; the
  largest under Farmer Hollis at Highwatch, up to 4.3 yd where the natural
  relief diverges most from the legacy field, and about 0.6 yd under
  bed_thornpeak_5; centimeters at the other three). tests/farm_patch_placement
  stays green (dry, slope, reachable, roads, camps), the beds and props seat
  on the same terrainHeight, and the full spawn roster (templateId + pos,
  three seeds) is otherwise identical: no pre-existing NPC, camp, or mob was
  nudged. Re-minted deliberately with the goldens: the atlas fixture, the
  Eastbrook chunk vertex digest, and the four farming-zone map plates plus
  the world strip (the other eleven plates came out byte-identical). QA
  READ (Phase 9 QA, 2026-08-17): the Highwatch shelf was eyeballed on the
  live client from three angles at the LOW preset (docs/screenshots/
  farming-phase-09/qa-highwatch-shelf-low.png and -overview.png): the pad
  reads as a natural terrace, Hollis stands a step uphill of the beds with
  no visible mound, crater, or seam, so NO re-seat; the maintainer read on
  the pad rule itself still stands. Future NPC placements should probe the
  pad delta, not just slope.
  (bi) THE OFFERED-BUT-REFUSED BAND: the husk-trade row is offered on the
  NpcDef flag, the sim demands FARMER_TRADE_RANGE 7, and the NPC dialog
  closes at NPC_WINDOW_CLOSE_RANGE 8, so a 1-yd band exists where the row
  is clickable and answers 'no_farmer'; identical to the vendor family
  (buyItem refuses past 7, the window closes at 8), accepted as
  family-consistent.
  (bj) THE CREDIT ARM IS A MODULE IMPORT: professions/farming.ts imports
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as quest-credit-seam-fold.
  onCropFarmedForQuests from quests/quest_credit.ts directly (the sibling
  crediters are SimContext callbacks wired in sim.ts, which sits one line
  under its ceiling); the registry comment in src/sim/sim_context.ts names
  it; the architecture review ruled it acceptable (a pure sibling taking
  ctx first, the ./gathering precedent). Fold it into the seam if a later
  extraction frees sim.ts headroom.
  (bk) patchId IS MARKER-ONLY: the intro quest names patch_eastbrook so the
  map circles those beds, but a Vale Wheat sown or harvested at any patch
  credits (pinned in tests/farm_quest_objective.test.ts); the quest text
  says "the beds beside me"; accepted, a walk elsewhere is its own effort.
  (bl) THE R37 FLIP SHAPE: the (aa) exclusion of farming from the generic
  node-rung hub walk is KEPT (farming has no nodes; the hub rule would
  demand garden_hoe at EVERY zone hub, and the phase stocks the buy-ahead
  hoe at the tier-1 counter only, the R20 shape); the dormant "no NPC
  vendors any farming item" arm is REPLACED by the positive farmer-stock pin
  (exact vendorItems per farmer, per-row positive buyValue, the four seed
  prices as literals, no other NPC / heroic / delve counter naming a
  farming item, tier 3/4 seeds + tonic + dishes + hoe rungs 2-4 nowhere);
  the vendor-craftable-recipe arm is retitled and kept (brook_carrot on the
  counter leaves every FARM_RECIPES row with an unstocked, unpriced
  reagent); the guide's farming-tool "no counter yet" branch is deleted so
  garden_hoe follows the generic stocked branch.
  (bm) TWO WORK ORDERS PER MASTER: no pin forbids it (the cadence is per
  quest id), so cook_marlow posts wheat and rice orders beside the game-meat
  one; the guide's workOrdersNote was reworded to per-order clocks and its
  thirteen Latin fills corrected in-phase (the old text stated one order per
  master).
  Residuals recorded, not fixed: src/sim/map_doc.ts's NPC sanitizer drops
  the farmer flag (as it drops cardMaster and warfareVendor: an
  editor-authored farmer would lack the trade; add the line if the editor is
  meant to author farmers); no NPC_KEYS look rows for the four farmers
  (villager fallback, the cook_marlow shape); no committed voice lines yet
  (aliases only; scripts/gen_npc_lines.mjs is a conscious follow-up); the
  requiredItems sweep floor in tests/professions_starter_tools.test.ts stays
  at >= 5 with six such quests (derived, so q_farm_intro IS covered);
  "Shift+K" appears in three shipped strings while the bind is rebindable
  (the guide controls row is the one tie).
  Phase 9 QA (2026-08-17, PASS-on-the-diff, FAIL on the go-live acceptance;
  scope stop per the QA file): (bn) NO PLAYER VERB PLANTS OR HARVESTS.
  plantCrop and harvestCrop exist on IWorldFarming, in Sim, in ClientWorld,
  and in server/farming_commands.ts, and every suite drives them, but no
  file under src/ui, src/game, src/render, or src/main.ts calls either (the
  husk trade is the ONE farming verb with a client control, the
  [data-husk-trade] gossip row), no bed is an interact target
  (src/game/nearby_interaction.ts walks GATHER_NODES only, the renderer
  picks gather nodes and entities, never bed seats), no window offers a
  seed picker, and no /dev plant command exists (farmgrow only advances a
  planted plot). Proven live: on the dev client a fresh character standing
  on bed_eastbrook_1 with the granted hoe and seed pressed the interact key
  and clicked the ground and planted nothing (no farmPlanted, no farmDenied,
  no toast: a SILENT dead end); the whole journey then walked green only by
  calling window.__game.sim.plantCrop / harvestCrop from the debug surface.
  Consequences: q_farm_intro is offered (quest glyph, greeting, teaching
  copy "sow it in one of those beds") and accepted, and can never be
  completed by an ordinary player; the Live-surface note ("the full
  plant-grow-harvest-cook loop is reachable by ordinary players") is UNMET
  and the packet's own dormancy rule (dormant is fine, half-reachable never)
  is broken; the husk trade, the watch fee, and the produce work orders are
  stranded behind it; the (bg) per-talk seed re-grant never closes because
  the quest never turns ready (a permanent free-hoe and free-seed dispenser
  through the face-to-face trade pipe, the security lane's note); and the
  phase's recorded qa-checklist READY line is superseded by this QA's NOT
  READY. Not Phase 9's fault: no phase file in the packet ever planned the
  client verb (Phase 8's journal is "informational by design, both verbs
  stay at the garden beds", and nothing at the beds sends a command); it is
  a packet planning hole surfaced by the first QA that played the loop as a
  player. Fix owner: PROPOSED Phase 9b, docs/prd/masterwrought/farming/phase-09b-bed-verbs.md
  (a bed interaction through the gather-node family in
  src/game/nearby_interaction.ts: harvest is choice-free so it is an
  InteractionOutcome; plant needs a seed and knob choice so it is a window,
  pure core src/ui/farming_plant_sheet_view.ts + thin painter on the
  PainterHost seam, opened through a NearbyInteractionHud dep; a bed pick
  or ripe marker as a src/render/<thing>.ts sibling; hud.ts (5 lines of
  headroom), main.ts (1) and renderer.ts (0) must extract BEFORE the wiring;
  mobile interact button; a jsdom test that presses the interact key beside
  a planted bed and asserts world.plantCrop / harvestCrop, plus a browser
  journey with NO window.__game). Maintainer decision owed: adopt 9b before
  Phase 10, or re-dormant the intro quest, Jessica's teaching sentence, and
  the guide's "Sow with a hoe" prose in one change until the verb ships.
  Until one of those lands the go-live is NOT player-complete.
  ADOPTED as Phase 9b, 2026-08-18 (the maintainer-authored starter prompt,
  authored 2026-08-17, whose use adopts the phase per its own terms).
  CLOSED by Phase 9b (2026-08-18/19, branch fix/farming-phase-09b-bed-verbs,
  merge hash in progress.md): the interact funnel gained the garden-bed arm
  (proximity resolver src/game/farm_bed_interact.ts; a bed with MY plot sends
  world.harvestCrop and the sim's own farmDenied answers a growing plot; a
  free bed opens the plant sheet), the plant sheet shipped as the pure core
  src/ui/farming_plant_sheet_view.ts plus the cold painter
  farming_plant_sheet_window.ts composed by Hud, and the committed journey
  scripts/farming_journey_e2e.mjs drives q_farm_intro to completion through
  client gestures only on desktop AND 844x390 landscape touch (17 checkpoints,
  no window.__game for any verb). The reachability pin
  tests/farm_verb_reachability.test.ts guards all four IWorldFarming verbs
  plus the Hud glue, so the (bn) class cannot silently reopen. The go-live is
  player-complete; Phase 9's Live-surface note is met.
  (bp) OFFER GATES ARE NOT OUTCOME PREDICTIONS (Phase 9b design refinement,
  reconciling the phase file's "never pre-empted client side" acceptance line
  with the shipped sheet): non-sowable seeds and unaffordable knobs render as
  DISABLED controls carrying the family's own denied.* line (bag-derived, the
  same order as the sim's gates), and a knob that stops being affordable
  un-picks itself so a send can never carry a payment the sheet shows as
  short. The sim remains the refusing authority for everything actually sent
  (range, bed, skill, seed, and every payment re-checked server-side); the
  sheet never predicts an OUTCOME (no survival, no yield, no fee-plan
  preemption on the send path). Pinned in the view suite's per-dimension
  arms and the window's un-pick arm.
  (bo) TIER 3 AND 4 SEEDS HAVE NO FIRST FAUCET: D11 says they "come from
  harvest seed-back rolls and the rare event", but the seed-back roll
  (professions/farming.ts, FARM_SEED_BACK_MIN_TIER 3) returns crop.seedItemId,
  the SAME crop's seed, and only from a tier 3+ crop, so the first tier-3
  seed can never exist; golden_harvest (D12) is a five-fold yield, not a
  seed; no loot table, quest reward, or counter carries
  highland_barley_seed, frost_gourd_seed, gilded_sunmelon_seed, or
  evergarden_greens_seed (grep of src/sim and server). So the Highwatch and
  Evergarden beds can never be sown by anyone, and Hollis and Verbena sell
  compost beside beds nothing reaches. Phase 9 followed the plan exactly
  (tiers 3/4 stocked NOWHERE is pinned as NEVER_STOCKED); the hole is D11's.
  Maintainer ruling owed, options in the OPEN list; the QA changed nothing.
  QA fixes landed (branch fix/farming-phase-09-qa): the husk-trade row now
  closes WITH focus restore (it was the first bindRoute consumer with no
  successor window, so the click dropped keyboard focus to <body>; pinned
  release(true)); the stale pre-go-live comments in the IWorldFarming facet
  and the farm recipes suite swept; and the pins the coverage lanes named:
  compost and husk item ids by literal, the four farmer seats and the
  spawned stock by literal (the placement suite compared the ctor's copy
  against its own source), the vendor walk's width per farmer, the two
  produce orders' count and payout (8 for 16, 5 for 20), the intro seed's
  fence through sellItem and marketList with the bought seeds as the
  negative, the online no_farmer refusal over the wire with a same-session
  positive control, the busy-farmer no-farmPlanted arm, and the journey
  suite's layer-honesty header. Mutation checks after committing: 16 of 16
  new mutants killed with named reds (boundary polarity, flag-not-
  discriminator, unnamed-crop arm, wrong action tag at plant, marker
  ignores the named patch, husk route dead, aria key swap, wheat payout off
  by one, Teasel's rice row dropped, Verbena's compost dropped, hoe dropped
  from requiredItems, harvest credited on plant, patch filter inverted,
  tier-1 fee three produce, Jessica's stock reordered, journal pointer
  dropped from the completion text). Residuals recorded, not fixed: the
  requiredItems grant on accept and re-talk bypasses bag capacity (a full
  16/16 bag still receives the hoe and seed as overflow slots, 18/16; the
  q_prof_intro template's pre-existing behavior, not farming's; the bag
  header paints "17/16" so it is visible, maintainer read owed on the
  template); the map_doc farmer-flag drop stays a ledgered residual, not
  fixed (the sanitizer drops cardMaster and warfareVendor the same way, and
  map docs carry no farm rows of their own; the static beds do stand under
  a custom map, so an editor-authored farmer is one whitelist line plus a
  round-trip pin the day the editor is meant to author farmers); the docs' day-one shopping list arithmetic
  said 28 copper and the truth is 44 (seed 4 + compost 8 + two brook_carrot
  at 16; the intro quest's 50 still covers it, with 6 to spare), corrected;
  the guide's "(Shift+K, or the Farming row...)" prose lacks the sibling
  pages' "by default" qualifier (a reword of a translated key, the
  i18n-semantic-regressions trap: left for the release fill); the WCAG
  label-in-name mismatch on the husk row aria (family-wide, ledgered); the
  src/ui/icons.ts ITEM_ART_PENDING rationale comment still says "no faucet
  until go-live" for compost (a comment inside the art-audit fingerprint
  family, swept at the Phase 13 art batch when the set moves anyway);
  nearFarmerNpc walks the whole radius after the answer (cosmetic).
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as near-farmer-scan-early-exit.
  Phase 9b QA (2026-08-19, PASS-WITH-FOLLOWUPS; branch
  fix/farming-phase-09b-qa, merge hash in progress.md):
  (bq) THE ERROR-TOAST RE-ARM (a refinement of the husk-trade feedback
  contract): the sim's plantCrop gates 1 and 2 (dead, busy) answer through
  ctx.error with the family's shared sentences, DELIBERATELY never a
  farmDenied (no new wire enum arm for a state every command family refuses
  the same way), so the plant sheet's send-once arm, which cleared only on
  farmPlanted / farmDenied, stayed armed forever after a busy deny (eat or
  cast, click Plant, control dead until a close; the any-farmPlanted clear
  already healed the back-to-back-planting case). The heal keeps both
  designs: the Hud's one error case forwards every error toast to
  PlantSheetWindow.notifyErrorToast, which spends the in-flight belief
  WITHOUT repainting (an error changes no bag state); re-arming on an
  unrelated error is safe because the sim's own gates answer any re-click
  (at worst one more deny toast). Pinned behaviorally (the window suite's
  re-arm-without-repaint arm) and structurally (the glue pin's error-case
  containment slice); both mutants killed named. RESIDUAL, ledgered: a
  command the online pipe silently drops (spectate, a reconnect window)
  still strands the arm until close/reopen, family-consistent with every
  window under spectate; and a bedId-free deny racing an in-flight plant
  send can re-arm early, harmless to state under the sim's gates.
  Other QA residuals with owners: the mobile-window-open body-class gap is
  family-wide (the harvest journal shares it), Phase 13 polish; the seed
  rows stay on the aria-pressed toggle family rather than a bespoke
  radiogroup, the a11y polish batch; countRawInSlots (fifth src/ui copy)
  and the distToBed comment-contract mirror both want src/sim-adjacent
  extractions, a later farming phase; the journey script stays outside the
  gate under D22 (the layer-honesty pin stands in), maintainer call at
  go-public; the farmer-shadow nuance (a press ON bed_eastbrook_2/4 within
  Jessica's NPC-arm range opens her dialog, the pinned precedence; the far
  side plants, probed live) is recorded as UX, not a defect.
  Phase 10 (2026-08-19, celebrations; merge hash in progress.md):
  (br) THE (bo) SOWABILITY PREMISE WAS FALSE: plantCrop carries NO bed-tier
  gate (probed live in a real Sim: vale_wheat plants at bed_evergarden_1 at
  skill 0, and the plant sheet offers any bagged seed at any bed), so the
  Highwatch and Evergarden first-harvest chronicles are EARNABLE today with
  vendor tier 1/2 seeds. All four chronicles ship earnable;
  FARM_CHRONICLE_ZONES (src/sim/deeds.ts, the ZONE_FISH template) is the
  earnability declaration, pinned against FARM_PATCHES zones both
  directions. (bo) itself still binds the tier 3/4 CROPS: nothing shipped
  assumes those seeds exist.
  (bs) prog_farming_100 SHIPS DORMANT UNDER A RECORDED WAIVER: D13 mandates
  the farming-100 title this phase while (bo) leaves farming teaching
  grayed at 75, so the deed is visible-but-unearnable until D11, the exact
  state docs/design/deeds.md rule 3 forbids. Resolution: the waiver is
  RECORDED in docs/design/deeds.md (the dormancy-window note: bounded by
  the self-clearing honesty arm in tests/deeds_content.test.ts over the
  three purchase surfaces, closed by the D11 faucet phase;
  feat_book_complete transitively parked, named there). The content
  reviewer's REQUEST CHANGES resolved via this waiver; MAINTAINER READ
  OWED on the waiver, plus the D12 cadence (per-harvest 1/90 is much rarer
  in wall clock than per node swing, and withered harvests burn rolls so
  the realized celebration rate is 1/90 times survival).
  (bt) THE TITLE SHELF FORCES COMMITTED ART: tests/reliquary_cell_art.test.ts
  forbids category-fallback crests for every RELIQUARY_HORIZON_TITLES
  member, so prog_farming_100 could not ride DEED_ART_PENDING; an interim
  tied-wheat-sheaf medallion crest shipped COMMITTED through the sanctioned
  converter (public/ui/deeds/prog_farming_100.webp, 5.6 KiB;
  DEED_IMAGE_IDS 272), and docs/achievements/icon-brief.md flags the
  commissioned replacement. The six untitled deeds ride DEED_ART_PENDING
  (now 8 with the castle pair). GENERAL RULE for future phases: a
  title-reward deed can never trail its art.
  (bu) ONE BELIEF GATES THE WIN: golden = flavor-won AND zone-resolved, so
  the five-fold payout, the zone announce, and the gather_event mark travel
  together (a bed outside an authored patch, impossible today, could never
  pay a silent windfall). ACCEPTED: the signature truncation on full bags
  is silent (gatherDowngrade's surface union is 'node' | 'corpse'; widening
  the wire was out of scope; the named follow-up is adding 'crop' in a
  later phase). The zone announce names the all-fine collapsed item id, the
  farmHarvested rule.
  (bv) NO RELIQUARY FIELD-NOTE CELL for gather_event:golden_harvest (its
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as golden-harvest-reliquary-cell.
  three node siblings have one): noteReliquaryMark no-ops by allowlist,
  pinned as a negative arm so the deferral retires consciously; and
  correctly NO server/character_sheet.ts RELIQUARY_MARK_ENGLISH row (that
  map's reverse guard admits only live reliquary marks). Also recorded:
  the ability-tooltip extraction fixed a latent NaN (an absent spellHaste
  on a mirrored entity now reads 0, tests/ability_tooltip_lines.test.ts
  pins it), and the extraction module registered in UI_PURE_CORES via the
  BARE_NAMED escape hatch. QA ADDENDUM (2026-08-19): whenever the deferred
  golden field-note cell lands, server/character_sheet.ts's
  RELIQUARY_MARK_ENGLISH must gain its row in the SAME change
  (sheetRelicRecentText returns null for an unknown id and the /c/ SSR
  page silently drops the entry), and the reliquary field-note literal in
  tests/reliquary_content.test.ts now documents the deliberate absence at
  the allowlist itself.
  Phase 10 QA (2026-08-19, verify celebrations; merge hash in
  progress.md): PASS-WITH-FOLLOWUPS, no live defect. The audit re-proved
  the five emphases by running (totals arithmetic from content, zero
  golden movement, a live multi-observer fanout probe, a live-client HUD
  replay of the probed winner stream, the waiver/art coherence) and
  closed two BLOCKING coverage gaps test-first: the golden signed-grant
  bag paths (full-bags and last-free-slot winner arms: totals conserved,
  only the signature truncates, the fine grade reads the bags the base
  grade mutated) and the finder-only sting pins, rebuilt as the
  src/ui/gather_rare_event_feedback.ts pure core (behavioral quadrant
  suite; the satisfies-Record fifth-flavor tsc tripwire moved into the
  shipping module; comment-stripped count-anchored glue pins over
  hud.ts; ceiling LOWERED 19230 to 19220). Hardenings: the golden belief
  reads != null (the exhaustive switch returns undefined off-union and
  the strict check would have paid a windfall on it); the draw-contract
  comments name all three resolving arms (the retired-crop arm spends
  the golden draw too); the announce-after-grants order, the
  armed-expansion five-fold crossing, the thornpeak announce zone, the
  farm:planted deny sweep, the harvest-range halo, and the
  farmBedZoneId authorship sweep are pinned; the (bo) honesty-arm seed
  list derives from the crop catalog. Fresh mutations 14/14 killed
  named. perf:tour exit 0 and test:browser 133 green closed the phase's
  two VERIFY items. DECLINED: the types.ts gatherRareEvent comment
  RE-OPENED (qr-18-REOPEN, 2026-08-31): actioned by Phase 18 as gather-rare-event-comment-reflow.
  reflow (cosmetic; a sim-content comment edit stales the
  portrait-manifest evidence family for zero behavioral value).
  (bw) GOLDEN-WIN PARITY COVERAGE DEFERRED TO PHASE 11, AND DISCHARGED
  THERE 2026-08-19: the scenario gained the position-searched golden-WIN
  beat and the paying-band tier-3 seed-back beat (probe facts, padding
  shape, and the isolated classified re-record recorded in the progress.md
  Phase 11 notes; md5 83c34781 to 25bd6b87, draws 16 to 110, prior frames
  byte-identical). The original deferral record follows. (the deviation (z)
  precedent: a QA moves no golden): the farming_session re-record left
  every golden roll a recorded LOSS, so the WIN path (five-fold signed
  grants, the crop-source fanout, the mark) reaches no golden digest,
  and the tier-3 seed-back beat landed in the zero band (the
  scenario-level grant proof degraded to 0 === 0). Phase 11 extends the
  scenario deliberately: a seed-searched golden-WIN beat plus a
  paying-band seed-back beat, re-recorded isolated with the (am)
  classification discipline. Unit-level coverage carries both paths
  meanwhile (the winner arms and band arms in
  tests/professions_farming.test.ts).

  Phase 11: (bx) THE D15 TIMING REFINEMENT, LOCKED: the wellfed aura is
  minted at COMPLETION of the 18s sit-restore, never on first bite. D15's
  "applied via ctx.applyAura from the food path in src/sim/items.ts" is
  refined, not contradicted: the food path STARTS in items.ts (consume,
  slot, sit) and COMPLETES in src/sim/combat/auras.ts updateRegen where
  remaining <= 0 nulls the slot; src/sim/wellfed.ts owns the mint at that
  one natural completion site (a minimal call before the null, the PRIME
  DIRECTIVE respected), still via ctx.applyAura, never effect_dispatch.
  An interrupted meal (damage, death, match reset, anything that nulls the
  slot early) forfeits the buff: the sit-through-the-meal ritual is the
  point, and immediate-on-consume was rejected as a full buff for one
  bite. A food-only kind guard keeps a future wellfed-carrying drink from
  minting at gulp completion undecided (pinned behaviorally with a
  synthetic drink slot plus a catalog sweep in tests/wellfed.test.ts).
  Zero rng draws; the aura is transient across save/load (executed
  round-trip pin).
  (by) ONE AURA NAME, ONE KIND, ONE ID: all four buff dishes share the
  aura name 'Well Fed' and the kind buff_sta, so they mint the single id
  wellfed_buff_sta and last-eaten-wins holds across the WHOLE food
  namespace (the classic one-food-buff idiom), not merely per kind. One
  AURA_NAME_KEY row covers the family; re-eating is the silent same-name
  refresh; a tier-1 dish deliberately overwrites a live tier-4 buff
  (classic last-eaten-wins, noted by the architecture review). The
  tooltip interpolates the SAME matcher row in both branches
  (src/ui/wellfed_tooltip_view.ts), so the term cannot fork per locale.
  (bz) THE TIER-1 BINDER RULING: brook_carrot is the D9 vegetable (the
  one vendor-stocked AND priced produce row), so the tier-1 buff dish
  carries a vale_wheat binder exactly like the Phase 6 pottage, keeping
  the whole-list invariant (every FARM_RECIPES row holds a reagent no
  counter stocks and no vendor prices) and opening NO rung-0 cooking
  skill-up faucet from vendor goods (the unresolved (ai)-addendum hazard;
  a build-round exemption variant was considered and reverted at
  integration). Pinned uniformly in tests/farm_recipes.test.ts,
  tests/professions_zone_rollout.test.ts, and tests/recipe_economy.test.ts
  (counterfactual vendor-fed set stays seven, live set stays empty).

  Phase 11 QA (2026-08-19, verify well-fed food; merge hash in
  progress.md): PASS-WITH-FOLLOWUPS, no live defect. All four emphases
  proven first-hand (records in the progress.md Phase 11 QA block: the
  played-as-a-player live-client eat, and the online downgrade over a
  real stable-timer wire with the elision path exercised). Fixes taken
  test-first: the 18s boundary bracket, the death forfeit, the
  concurrent-meal refusal, the zero-rng rig guards, the shared
  stripComments glue pin, the wellfed/elixir stat-map parity pin, ten
  frozen non-Latin fill literals; the scenarios.ts padding comment now
  states the husk payout. Mutations 7/7 killed named (M3 and M5b
  re-proven; five fresh, each dying to exactly its new pin).
  RESIDUALS LEDGERED WITH OWNERS:
  - (bo) addendum: the wiki (src/guide regen) now ADVERTISES the two
    reagent-dormant buff-dish recipes (porridge, braised greens) as
    trainer-taught rows no player can complete and shows no seed source;
    the D11 bootstrap ruling must explicitly cover these two rows before
    the branch merges to a release, or they ship after D11. Owner: the
    (bo) decision.
  - Tuning addenda folded into the OPEN well-fed row below (the
    unanchored raid-floor phrase; the tier 2 to 4 stat-identity of the
    buff twins and the tier-1 inversion). Owner: the maintainer tuning
    read. The QA left the profession_items.ts comment untouched
    deliberately: a sim-content comment edit stales the portrait
    evidence family for zero behavioral value (the Phase 10 QA
    precedent), so the ledger carries the correction.
  - The wellfed parity beat stays deferred to the Phase 12 feast
    scenario, ENRICHED by the architecture review: the wellfed mint is
    the one genuinely new TICK-PHASE path (updateRegen completion),
    unlike the command-phase elixir beat, so the Phase 12 beat must ride
    a consume completion through real ticks (addItem + useItem + tick
    past 18s + snapshot), which is draw-free and appends without moving
    prior frames. Owner: Phase 12.
  - Icon reads for the Phase 13 art batch (extends the recorded
    carrot-vs-pottage eyeball): highwatch_barley_porridge paints a
    potion primary (reads as alchemy) and fenbridge_rice_pudding a coin
    primary (reads as currency); glazed carrots and root pottage share
    palette AND glyph set differing only in primary. The A4c pairwise
    pin holds in-family distinctness; the cross-family read is the art
    batch's call. The generic aura_buff_sta buff icon stays the recorded
    bespoke-icon deferral. Owner: Phase 13 art batch.
  - Online e.eating is a lossy shadow (itemId '' and a hardcoded kind
    'food' in the ClientWorld rebuild): no reader today, but any future
    "Well Fed incoming" preview keyed on eating.itemId would be blank
    online while working offline. Owner: whoever adds an eating-preview
    surface.
  - The tier-4-to-tier-1 downgrade is invisible in the combat log by
    design (same-name displacement emits a refresh, never a fade or the
    magnitude); the buff hover is the only surface that reveals it,
    identically in both hosts. Owner: maintainer UX read, only if the
    drop should be legible.
  - AURA_VISIBLE_CAP_LOW = 8 (src/game/ui_tier_knobs.ts) recycles auras
    past the cap on the LOW tier; pre-existing and outside this diff,
    but the well-fed buff is information a player re-eats on, and no
    test pins that a self-buff survives the cap. Owner: maintainer
    fairness read, not farming's.
  - The useWellfed/useWellfedAura keys sit in the use* family without a
    Use: prefix for a reason only a source comment states; renaming
    would churn 21 locales for a naming nit, declined. The pending Latin
    rows for both keys ride the release-tier fill as usual.
  - The wellfed/elixir tooltip stat maps stay two deliberate copies
    (below the extraction rule of three), held in step by the new parity
    pin; the third consumable-buff view owns the extraction.

  Phase 12 (2026-08-19, the shared feast; merge hash in progress.md):
  (ca) THE (bo)/LIVE-SURFACE RECONCILIATION, decided at phase start per
  the phase file's STEP 0 mandate (option 3 of its recorded three): the
  feast recipe ships REAGENT-DORMANT-HONEST like the tier 3/4 buff
  dishes, keeping its true produce-heavy tier-4 identity
  (evergarden_greens x4 + gilded_sunmelon x4 + cooking_salt x2). The
  phase file's binding Live-surface note is AMENDED in-file (state.md
  wins by that file's own header): the whole loop (cook, place, eat,
  buff) is live code-side and proven through tests and granted-item
  probes, but no player can cook the feast until the D11/(bo)
  seed-bootstrap ruling opens a tier-4 produce faucet. Rationale:
  option 1 (obtain the D11 ruling first) needs the maintainer and could
  not be decided in scope; option 2 (a reagent mix reachable today)
  would build the tier-4 showcase from tier 1/2 produce, making the
  feast the cheapest source of the 12-stamina buff and permanently
  undercutting the tier-4 dishes the moment D11 opens the faucet, a
  balance wart baked into content. The (bo) addendum above therefore
  owns THREE advertised dormant rows (porridge, braised greens, harvest
  feast); the D11 ruling must cover all three before the branch merges
  to a release. Swept into phase-12-shared-feast.md and phase-12-qa.md
  in the same pass.
  PHASE 12 LEDGERS (the shipped surface; progress.md carries the notes):
  - IWorld: placeFeast() and consumeFeast(feastId) on IWorldFarming
    (331 = 88 + 243); commands place_feast (payload-free, HEAVY_SELF)
    and consume_feast ({id} only), 204/217. The consume verb is a
    dedicated member (the delveInteract precedent), never bare interact.
  - Sim: src/sim/professions/feast.ts owns FeastState (ownerKey =
    characterId ?? entityId, charges, expiresAtTick, eatenBy ledger) in
    SimContext.feasts, transient, never serialized; the despawn sweep
    rides INSIDE updateFarming's 1 Hz guard; every feast path draws
    zero rng. The bite sets the standard Consuming slot pointed at
    ItemDef.feast.dishItemId (evergarden_braised_greens), so the mint
    stays the Phase 11 updateRegen completion site and the (by)
    namespace rules hold (pinned both directions).
  - SimEvents: farmDenied reasons appended no_feast, feast_active,
    feast_expired, feast_finished, feast_range, feast_eaten ('locked'
    and the (bq) dead/busy error family reused); new event
    farmFeastPlaced {pid, feastId} (the placer's confirmation).
  - Content: harvest_feast (kind junk, quality rare, sellValue 250, no
    buyValue, ItemDef.feast {charges 10, durationTicks 3600,
    dishItemId}); recipe_harvest_feast (FARM_RECIPES 14, greens x4 +
    sunmelon x4 + salt x2, rung 50, kitchens, trainer fee 10000,
    reagent-dormant under (ca)); ITEM_ART_PENDING 44; entity
    templateId 'farm_feast' (kind object, lootable false, name = the
    placer's raw name as a value).
  - i18n: hudChrome.farming.denied.{six reasons},
    hudChrome.farming.feastTitle ("{name}'s Harvest Feast"),
    hudChrome.farming.feastPlacedLine, entities.items.harvest_feast
    .name, and the items.ts useFeast/useFeastBuff/useFeastBuffAura
    tooltip keys, each with the five non-Latin fills (M16).
  - Render/audio: farm_feast prop in the farm-props set (16 GLBs, new
    source fingerprint); the feast arm in farm_patches.ts (0.5 s
    cadence, VFX on post-first-pass appearances, QA amendment below);
    labels via entity_display_name
    .ts (the hud.ts extraction, ceiling 19220 to 19214) and the
    nameplate near-interact row; cue ui_farm_feast end to end.
  - Parity: beat P appended to farming_session (the wellfed tick-phase
    mint ridden for real, the feast place-bite-mint-expire loop),
    frames 0-93 byte-identical, draws 110 unchanged with an identical
    drawDigest, md5 25bd6b87 to 9dfd1c6e, zero other goldens moved.

  Phase 12 QA (2026-08-19, verify the shared feast; merge hash in
  progress.md): PASS-WITH-FOLLOWUPS, one real lifecycle defect found and
  fixed. All four emphases proven first-hand over the REAL wire (records
  in the progress.md Phase 12 QA block). FIXES, each test-first:
  - INSTANCE TEARDOWN (the real defect, reproduced with a failing arm):
    a feast placed inside a dungeon instance was never registered in
    inst.objectIds, so freeInstance left the entity standing at the slot
    origin for the NEXT claiming party, still edible, holding the
    placer's one-active slot for the rest of its 180s. Fixed: placement
    inside a CLAIMED instance registers the entity in the instance's
    teardown roster; freeInstance drops it and the sweep's entities.has
    inverse-cleanup leg reclaims the state and the slot (its designed
    job). RULING RECORDED: placement inside instances stays LEGAL (the
    raid-table flavor) and is instance-scoped. THE SAME RULE FOR DELVES
    (the qa-checklist adversarial find: delve runs are their own spatial
    system with their own roster): the feast joins the placer's
    run.objectIds, so freeDelveRun AND the module advance tear it down
    (the abandoned-module drop is deliberate, that room despawns
    wholesale); reproduced failing-first and mutation-proven like the
    dungeon leg.
  - THE RE-ARM DODGE AMENDED to the Infinity sentinel: the shipped
    finite spawn timer (durationTicks + 20 ticks) was silently coupled
    to the 1 Hz sweep period across two files; the QA probe measured the
    worst-case margin at exactly ONE tick (expiry phased one tick past a
    boundary: despawn at expiry + 19, re-arm one tick later). Four
    independent lanes converged on the coupling. respawnTimer = Infinity
    is the precedented never-re-arm sentinel (run-scoped mobs, dismissed
    pets), never rides the wire, moved no golden; the 181s expiry arm
    now rides the whole life at the worst-case phase asserting lootable
    false per tick. Swept into phase-12-qa.md ruling (4).
  - RENDER AMENDMENTS: the placement flourish no longer replays on a
    graphics-settings rebuild or login (the first applyFeasts pass
    registers standing tables silently; later appearances keep it; the
    scope-re-entry ambiguity is ACCEPTED, indistinguishable client-side
    without wire age; also accepted: the viewer's OWN placement is
    silenced when it lands inside the first pass after a rebuild, up to
    one 0.5 s sync interval, a different and narrower case). Shadow casting budgeted at FEAST_SHADOW_CAP = 8
    tables (insertion order, refills on despawn; a universal budget,
    never a preset knob); PRESENCE is actionable and never culled (the
    natural bound is one feast per online placer crossed with interest
    scope).
  - COVERAGE: four decisive sim arms (swim-bite refusal, exact
    INTERACT_RANGE allow, keyed-placer feast_active, orphan-window
    press) plus the behavioral bags click arm (a real DOM click reaches
    placeFeast once, never useItem; the old pin was source-text only).
    Mutations 12/12 killed named through the dirty-refusing runner; the
    build round's deliberate HEAVY_SELF survivor stays recorded.
  RULINGS RECORDED (the content reviewer's, so the docs now state them):
  the feast owes NO Book of Deeds record (deeds.md scopes the obligation
  to dungeon/delve/raid/world boss/zone/rare; no per-recipe deed exists
  anywhere; a feast deed would also be unearnable while (ca) stands,
  the prog_ringwright reasoning) and NO Reliquary page (crafted
  consumable, not conquerable unique loot; cooking is outside the
  masterwork gallery by the isCataloguedRelicMark('masterwork:cooking')
  false pin).
  RESIDUALS LEDGERED WITH OWNERS:
  - The consume deny-order asymmetry (feast-specific reasons answer
    before the eating-family gates, so an in-combat already-fed player
    hears feast_eaten where a bagged dish says combat): deliberate,
    zero state effect, documented. Owner: none (accepted).
  - The entity-id existence oracle in the consume denies (feast_expired
    vs feast_finished distinguishes live feasts outside interest scope):
    existence-only leak, bounded by the command lane, matches the
    sibling idiom. Owner: none (accepted).
  - The one-active scan is O(live feasts) per placement and place_feast
    marks heavy on receipt even when refused: exactly the pre-existing
    sibling behavior, lane-bucket bounded. Owner: a server perf round if
    packed-hub numbers ever flag it (an ownerKey index makes it O(1)).
  - useItem's feast arm ignores the validated slotIndex (the spend walks
    its own lock-aware path): unobservable today (no per-instance feast
    provenance). Owner: Phase 13 polish (thread the slot like
    consumeOneUnit if a provenance ever lands).
  - The bite derives the dish from FARM_FEAST_ITEM_ID, not FeastState
    (a second placeable would serve the first one's dish): scope
    -consistent (the header rules a second placeable out). Owner: whoever
    adds a second placeable carries dishItemId on FeastState.
  - The bags hint says "Click to use" for a placement; a "set out" key
    needs M16 fills. Owner: Phase 13 polish.
  - The feast title composition exists at two sites (entity_display_name
    and entity_labels, one shared key): at the rule-of-three watch
    point. Owner: the third composer extracts.
  - The nameplate feast row shows within INTERACT_RANGE + 1 (a 1 yd
    hysteresis pad where a bite still denies feast_range) and its
    comment overstates "close enough to eat". Owner: Phase 13 polish.
  - feastOwnerKey's export keyword has no external importer;
    FeastState.entityId duplicates the map key: harmless self-describing
    surface. Owner: none (accepted).
  - The wiki shows no consumable-effect prose for ANY dish (GuideProfCraft
    has no effect field): a catalog-wide generator gap, not a Phase 12
    omission. Owner: a guide-generator follow-up.
  - The malformed consume_feast id is a silent no-op online but a
    feast_expired toast offline: matches the plant/harvest sibling
    idiom. Owner: none (accepted).

## OPEN items (maintainer decisions or later-phase calls, never guess)

- Crop display names: ids are locked (D11), English display names get a maintainer
  lore pass in the content phase PR.
- Phase 9 reads owed: (bg) the intro grant fence (accept the trade-pipe leak or
  extend the trade guard to honor noVendorSell/noMarketList), (bh) the Highwatch
  farmer's terrain pad (the QA eyeballed it: no re-seat; the pad rule itself is
  the read), and the four farmer titles/greetings as authored (Allotment Keeper,
  Fen Paddy Farmer, Highwatch Terrace Farmer, Parterre Gardener).
- Phase 9 QA DECISIONS OWED (blocking the player-complete go-live): (bn) adopt the
  PROPOSED Phase 9b (docs/prd/masterwrought/farming/phase-09b-bed-verbs.md: the bed interaction
  that plants and harvests through IWorldFarming, before Phase 10) or re-dormant
  q_farm_intro, Jessica's teaching sentence, and the guide's "Sow with a hoe"
  prose until the verb ships (ADOPTED as Phase 9b, 2026-08-18, and CLOSED by
  its merge: the verbs ship, the go-live is player-complete, the journey and
  reachability pins guard the class; (bo) below is ALSO closed, see the note on
  it);
  (bo) CLOSED 2026-08-21 by Phase 11e (GATE 1), which took option (2): both
  upper-tier farmers stock their own seeds. The handoff table above carries the
  full closure record. Left in place with this stamp rather than deleted so the
  four options stay legible, and stamped at the 11f QA, which found this entry
  still reading OPEN one screen from the table that closed it.
  The options as they were put: (1) a seed-back
  roll on a tier-N harvest that can return the NEXT tier's seed at low odds
  (upward drift, keeps "no counter sells them"), (2) the tier-3 and tier-4
  farmers stock their own seeds at a premium (amends D11's counter rule), (3) a
  once-per-character grant (a Hollis or Verbena intro quest, or the golden
  harvest paying a next-tier seed), or (4) accept that tiers 3/4 open only when
  Phase 10 or a later phase adds a faucet, stated in the Live-surface notes.
  Also owed from the QA lanes: the q_prof_intro-template overflow grant on a
  full bag (pre-existing, visible as 17/16), and the (bg) faucet's lack of a
  terminator while (bn) stands.
- ONLINE_WORLD_LAYOUT_VERSION at farming go-live (raised by the nineteenth-absorb
  cross-platform review): the epoch discriminator in src/world_api.ts scopes itself
  to "the authoritative town layout" and went 6 to 7 release-side for an unrelated
  reason; farm beds are world content with positions, so whether a farming
  client/server pairing across the go-live deploy needs its own epoch bump is a
  maintainer call, decided once at go-live.
- Exact tuning constants: growth durations per tier inside the D5 bands, the gain
  schedule, harvest-lives save-chance endpoints, well-fed magnitudes and durations,
  feast charge count and expiry. Phases propose concrete values in the PR body and
  flag them for the maintainer; the packet deliberately does not freeze them.
  Phase 11 proposed the well-fed ladder 3/600s, 6/900s, 9/900s, 12/900s (buff_sta,
  each pair dominated by or equal to a shipped elixir point). TWO reads owed: the
  capstone dish EQUALS the strongest crafted elixir (12/900, elixir_of_the_serpent)
  rather than sitting below it, and the distinct wellfed_ namespace makes food
  STACK with a same-stat elixir for a combined 24 stamina no design doc budgets;
  the cheap lever is dropping the capstone to 9 or 10 (flagged at the
  profession_items.ts rows). Also flagged there: reagent counts (produce x4), the
  tier 3 and tier 4 buff dishes both at rung 50 (restating the Phase 6 three-rungs
  -for-four-tiers domination flag), and tier 4 shipping quality 'rare' like tier 3.
  Phase 11 QA addenda to this same read: (1) the comment's "still below the raid
  floor" justification cites no code constant or design doc the QA could find;
  treat the 24-stamina combined ceiling as an OPEN question on its own terms, not
  a verified bound. (2) The buff twins are STAT-IDENTICAL supersets of their plain
  siblings at tiers 2 to 4 (same foodHp/sellValue/quality for one extra produce),
  so the plain dish is only ever the right craft when produce-constrained; tier 1
  INVERTS (carrots 90/6 vs pottage 117/12), so the starter buff dish heals and
  vendors for less than its plain sibling. The code comment's uniform
  "costs strictly more produce" framing is true on cost and silent on the
  stat-identity; fold both into the tuning decision.
- Whether farming counting toward existing any-profession deeds is accepted (default
  yes; it is automatic via the data-driven arm; flag in the Phase 1 PR body).
- Seed-back roll rates for tier 3/4 seeds (economy-sensitive; propose in the content
  phase with the market in mind).
- Phase 6 proposed values awaiting sign-off: the eight dish foodHp/sellValue
  assignments (each reuses a shipped curve point; flagged at their rows in
  profession_items.ts), the dish reagent counts, the tonic recipe (silverleaf x2 +
  glass_vial x1 at skillReq 0; rationale at the row: the tonic is a plant-time knob
  for every tier and is never vendor-stocked, so the accessible trainer rung is its
  only faucet), and whether fine_marsh_rice / fine_highland_barley should ALSO gain
  dish consumers: the Phase 5 deferred literal named exactly five twins, so the
  closure left those two hoe-reagent-only (documented honestly at their items.ts
  rows; adding dishes for them is a content decision, not a gap in the closure pin).

## Phase 11g note (2026-08-22): D24's displacement guardrail is now PINNED

D24's Wave 2 entry approves cultivated herbs for alchemy only WITH a displacement
guardrail ("complement wild herbalism, never a second faucet of the identical
item"). That guardrail was honored by intention up to now, since nothing had put
produce beside an herb on a shipped bill. Phase 11g is the first phase to do it,
across nine rows, so the guardrail is now asserted rather than promised:

- tests/provisioning_supply_line.test.ts pins the TOTAL demand across the merged
  ALL_RECIPES for all three base herbs as three integers (silverleaf_herb 28,
  goldleaf_herb 27, sunpetal_herb 39), predicted before the edits and observed
  unchanged after them.
- The same suite pins the EXACT non-produce reagent bill of every one of the nine
  touched rows as a literal. Totals alone can be gamed by moving a reagent
  between rows; the per-row literals close that, and they cover the fish, meat
  and salt lines too rather than only the herbs.
- tests/farm_seed_channels.test.ts's alchemy arm went from a zero pin to a live
  check with a floor of three, and its loop now really asserts that every alchemy
  row consuming farm output ALSO still consumes an herb.
- A mutation reducing silverleaf_herb from 2 to 1 on recipe_frostgill_chowder
  (the exact "make room" move D24 bans) reds both suites.

NOTE ON SCOPE, so this is not read as more than it is: 11g adds no cultivated
herb and no second faucet of any herb. It adds produce BESIDE the herb line. D24
itself stays in the Wave 2 parking lot, explicitly out of the packet; what
changed is that its guardrail now has teeth for the day Wave 2 arrives.

The three fine_*_herb twins still have no recipe consumer anywhere on the merged
tree, so the displacement arms stay scoped to the BASE herb line, unchanged from
the scope 11f recorded and for the same reason: widening would red on inherited
state and teach the next reader to loosen the arm.

NO OPEN ITEM IS CLOSED BY 11g. The list was read row by row: the crop display
name lore pass, the Phase 9 reads, the (bn)/(bo) block, ONLINE_WORLD_LAYOUT_VERSION,
the tuning constants, the any-profession deed question, the seed-back rates, and
the Phase 6 sign-off block including the fine_marsh_rice / fine_highland_barley
dish-consumer question all stand exactly as they were. 11g touched no vendor row,
no price, no growth timer, no daily and no decay, so it creates demand without
touching a single one of those decisions.

## Phase 11g QA note (2026-08-22): D24's guardrail is now pinned PER LINE, not per total

The 11g note above stands and is correct. One thing it recorded is now stronger,
and one thing it said is now measurably true rather than argued.

STRONGER: the RULE 3 displacement pins were three herb totals plus three more
(game_meat 28, prime_cut 12, cooking_salt 33) plus the summed fishing line at 30.
The five single-id totals are per-id by construction. THE FISHING ONE WAS NOT: it
was seven catch ids under one number, so cutting the marsh pike and paying for it
with a river perch kept 30 and passed every arm in the tree. The fishing line is
now pinned PER CATCH (glimmerfin_koi 6, raw_bog_eel 4, raw_frostgill_trout 4,
raw_marsh_pike 2, raw_mirror_trout 1, raw_river_perch 2, raw_stonescale_carp 11),
with the map and the total checking each other so neither drifts alone, and a
compensating swap now reds. Phase 11i owns fishing and will edit that map when it
adds a catch, which is the wanted behavior.

MEASURED: every one of the six displacement totals was re-derived against the
MERGED tree after the release sync, not re-read from the 11g record, and every one
holds at the value 11g predicted. The release moved nothing in this surface.

ALSO PINNED, and it is the arm D24 will care about most when Wave 2 arrives: the
crops that did NOT gain alchemy are now a SWEEP over the live FARM_CROPS roster
rather than a list of five ids. Exactly three base crops may name alchemy
(vale_wheat, bog_beet, frost_gourd) and the sweep says so over whatever roster
ships, so a later phase quietly handing alchemy a fourth crop reds rather than
passing. The old arm named five of the nine that must stay cooking-only, so four
were unguarded.

NO OPEN ITEM IS CLOSED BY THE 11g QA EITHER. The list was read row by row a second
time against the merged tree, and the 11g note's own row-by-row verdict stands
unchanged: 11g touched no vendor row, no price, no growth timer, no daily and no
decay, and its QA touched none of those either. The three fine_*_herb twins still
have no recipe consumer anywhere on the merged tree, so the displacement arms stay
scoped to the BASE herb line for the same reason recorded before: widening would
red on inherited state and teach the next reader to loosen the arm.

## Phase 11h note (2026-08-22): farming's output reaches the top of the catalog

Phase 11g put produce on the leveling rungs; 11h carries the same supply line to
100 and 125, where the raid actually eats and drinks. What matters to FARMING,
rather than to the masterwrought packet, is three things.

FARMING'S ENDGAME CENSUS DOUBLES, 8 rows to 16, and the half that is not farming
buying from itself goes from ONE member to NINE. Before 11g every endgame bill
naming a farm reagent was one of farming's own dishes plus recipe_osmium_hoe;
11g added recipe_seasoned_stock; 11h adds the entire apex consumable tier (the
three role plates and the three flasks at rung 100, both capstones at 125). That
is masterwrought R20's own measure, pinned in tests/farm_recipes.test.ts with the
125 rung stated as its own clause, because a census that stops at 100 leaves the
exact hole the rule names.

THE TWO TIER-4 FINE TWINS FINALLY HAVE A CONSUMER OUTSIDE FARMING.
fine_gilded_sunmelon and fine_evergarden_greens were each consumed by exactly one
recipe, farming's own tier-4 dish at cooking 100. recipe_grand_cauldron and
recipe_laden_hearth now take one each at skillReq 125, the top of the whole
catalog. The stale items.ts comments beside both twins are corrected here, once,
as the packet record assigns (row N15): the sentence they carried is TRUE and is
kept, but it scopes to the HOE ladder alone and was being read as a claim that a
tier-4 twin can never be a reagent at all.

D24'S GUARDRAIL HOLDS AND IS ASSERTED PER BILL, not only per total. Every apex
alchemy row that took a crop still consumes an herb, sunpetal_herb is still 2 on
each of the three flasks and 4 on the cauldron, and alchemy's whole herb demand
is now pinned PER RECIPE rather than as one number over sixteen rows, which is
the fishing-line lesson applied one craft over: a compensating move keeps a total
green. Three global herb totals (28 / 27 / 39) are unchanged and green.

TWO CROPS GAINED AN ALCHEMY TOOLTIP: highland_barley (all three flasks) and
gilded_sunmelon (the cauldron) now read "Used by Alchemy and Cooking." The 11g
QA's roster sweep was extended from three ids to five, and a gap in it was closed
while extending: it mapped produceItemId only, so nothing could see a FINE TWIN
gaining a craft, and 11h is the first phase to put one in an alchemy bill.

NO OPEN ITEM IS CLOSED BY 11h. The list was read row by row: the crop display
name lore pass, the Phase 9 reads, the (bn)/(bo) block, ONLINE_WORLD_LAYOUT_VERSION,
the tuning constants, the any-profession deed question, the seed-back rates, and
the Phase 6 sign-off block including the fine_marsh_rice / fine_highland_barley
dish-consumer question all stand exactly as they were. 11h touched no vendor row,
no price, no growth timer, no daily, no decay and no crop def; it creates demand
without touching a single one of those decisions. The three fine_*_herb twins
still have no recipe consumer anywhere, so the displacement arms stay scoped to
the BASE herb line for the reason recorded twice before.

ONE THING FARMING SHOULD KNOW ABOUT ITS OWN TIMERS. 11h holds the three role
plates at an equal COPPER cost (every tier-3 base crop is sellValue 15, so each
plate's crop row is worth 30 and all three bills land on 452), which is what the
ruling rules on. It does NOT hold them at an equal wall-clock cost, because the
crop ladder deliberately gives every crop in a tier its own duration:
highland_barley 4h, thornpeak_cabbage 4h10m, frost_gourd 4h30m. A cook who grows
their own pays a 12.5 percent spread from cheapest to dearest; a cook who buys
pays the same either way. Recorded here rather than only in the packet, because
the numbers are farming's and a later re-tune of them changes an apex bill's real
cost without touching an apex bill.

## Phase 11h QA note (2026-08-22): the tool gate is the third plant gate, and no ruling names it

The 11h audit closed nothing on the OPEN list and opened nothing on it either.
What it found that belongs to FARMING rather than to the masterwrought packet is
one thing, and it is worth reading before the next phase writes copy about a crop.

THE PLANT PATH RUNS THREE GATES, NOT TWO. `src/sim/professions/farming.ts` step
12 calls `bestWieldableGatherToolTierOrNone(inventory, 'farming', skill, ITEMS)`
and then `canGatherTier(hoeTier, crop.tier)`, and that scan DROPS any hoe whose
wield requirement exceeds the player's own farming counter
(`wield_gate.ts`: `if (professionId !== 'fishing' && held < wieldRequirementForTier(tier)) continue`).
So the floor for planting a crop is `max(farmCropSkillThreshold(tier),
wieldRequirementForTier(tier))`, which is the composition
`tests/farming_plant_sheet_view.test.ts` already writes out for tier 2. The
numbers that matters here: tier 3 is max(50, 70) = 70, tier 4 is max(75, 85) = 85.
The hoe is the binding half on BOTH tiers this packet reaches.

WHY IT SURFACED IN A CRAFTING PHASE. Phase 11h shipped a wiki paragraph telling a
player the three apex role crops "ask Farming 50 and nothing more". A farmer at 50
who read that, bought Highland Barley Seed from Hollis and walked to a bed was
denied with reason 'tool'. The sentence is corrected and the arm that would have
caught it now sits beside the obtainability sweep in
`tests/provisioning_supply_line_apex.test.ts`, pinned to LITERALS after the first
version of it turned out to be the constant compared against itself.

WHAT IS NOT BROKEN, checked rather than assumed: nothing about the crop ladder or
the hoe ladder. The chain closes and it is self-bootstrapping, which is farming's
own design: a tier-3 hoe wields at 70, its crops yield the fine twin that the
tier-4 hoe recipe consumes, and the tier-4 hoe wields at 85 against a tier-4 plant
threshold of 75. Both floors sit under farming's cap of 100. Every plate crop and
both capstone crops are reachable; they are dearer than the threshold alone says.

FOR THE MAINTAINER, surfaced not decided (packet open item 6): 11h-GATE-B's
acceptance reads "every crop obtainable at the tier its recipe unlocks, derived
through farmCropSkillThreshold", and that is one of the three gates. Phases 11i,
11j and 11k inherit the same wording. Whether an obtainability ruling should name
the wield rung as well is farming's call, not a QA session's; the arm measures
both either way.

ONE THING THE AUDIT CONFIRMED FOR FARMING. The fine twins really did have exactly
one consumer each before 11h, counted off the parent commit rather than off the
ledger: `fine_gilded_sunmelon` in `recipe_evergarden_sunmelon_tart` and
`fine_evergarden_greens` in `recipe_evergarden_harvest_platter`, both at cooking
100. The BASE crops did not: `gilded_sunmelon` had two consumers and
`evergarden_greens` three, so 11h's items.ts comments claiming it "added the
second consumer" were wrong on the ordinal and right on the half that matters,
which is that it added the first consumer outside farming. Corrected in place.


## Phase 11k QA note (2026-08-24): nothing moved on the OPEN list, and one row was deliberately left expensive

THE 11k AUDIT CLOSED NOTHING ON THE OPEN LIST AND OPENED NOTHING ON IT EITHER.
The list was read row by row a fourth time; no farming row's answer changed.

WHAT BELONGS TO FARMING RATHER THAN TO THE PACKET is the one decision this audit
declined to make. The apex feast bill takes ONE base crop (`evergarden_greens`)
where the accent cap allows two, and the reason is a maintainer item rather than
a taste: at 2 the crop contributes 80 against a count-reading reference of 56, so
all three rows would join the census of what RULE 2's ALTERNATIVE reading
refuses, taking that open item from six entries across four rows to nine across
seven. At 1 it contributes 40 and clears BOTH readings. A QA re-tuning that count
would be spending the maintainer's open decision to make a content choice, so it
was left exactly as expensive to settle as it was found.

THE GATE-E AMENDMENT THE PHASE WROTE HOLDS. Its closing clause (that the bill can
take both tier-4 fine twins) really is false on the merged tree, re-derived here
rather than taken: a fine twin carries `buyValue: 320`, two of them are two crop
families on a fish row, and produce 4 against one catch breaks fish-forward, so
the prescribed bill is refused three separate ways by rules 11h and 11i shipped
after that line was written.

## Phase 11l note (2026-08-24): one row ADDED to the OPEN list, and the settled counts moved twice

THE 11l BUILD ADDED ONE ROW to the handoff table (the `col_junk_drawer` zero-margin
item above, the maintainer's) and closed nothing; the eleven carried in are unchanged.
(The row's "exactly 10" reads 11 against 10 since the sixth fix round returned
chipped_tusk to poor: one of margin, the regression and the next-promotion tripwire
unchanged.)

ROWS 82 TO 85 AND 122 TO 123 WERE EXECUTED AS WRITTEN, and the pointer in
`phase-11l-trophy-economy.md` that sends a reader to state.md for them is the drift:
they live here. What moved is the COUNT the rows predicted, not the rules. Row 123
predicted FOURTEEN adoptions and FIVE value exclusions against the CRAFTED ceiling
(460). Row 122's output doctrine makes every output an UNCRAFTED shipped item, and
run against that pool it does two things the same-day prediction could not see: it
excludes SEVEN mapped poor trophies for want of any in-register uncrafted output
(both jewelcrafting ids, three of the four inscription ids, the enchanting id, and
the weaponcrafting chipped_tusk, whose every candidate is dominated by the trainer's
own rung-25 dirk, found by the fifth review round and applied in the sixth fix
round, after two re-picks), and
it ADMITS two of the five predicted value exclusions (old_cragmaws_pelt 300 and
emberwing_cinderscale 320: the uncrafted leather pool reaches 450, so both clear
the arithmetic; each now feeds a 2 percent trash-drop belt from a DIFFERENT kill at
rung 50, the cinderscale the ogres' cragprowl_belt and the pelt the stalkers'
wildgrove_cinch, the pelt deliberately NOT Old Cragmaw's own chase huntcord, which
its guaranteed drop would have made deterministic, and not a stat-less white either,
which would have been a sink rather than a prize). NINE adopted,
TEN excluded, two held out. Jewelcrafting's lane is EMPTY, like engineering's, and
inscription keeps one row: the phase file's "jewelcrafting and inscription are the
point" was intent the doctrine could not honour on this catalog. Recorded under row
122's own clause (excluded and recorded, exactly like a value exclusion); nothing
was re-decided. The full derivation per id is in the 11l BUILT ledger in state.md.

## Phase 11l QA note (2026-08-24): the count moved once more, and one row ADDED

THE 11l QA RAN THE SAME STANDARD OVER THE ROWS THE BUILD DID NOT RE-PICK (R21
applied to the OUTPUT against the trainer's own rows, the clause that excluded the
chipped tusk) and two more fall to it strictly: valefire_lantern (int 1 spi 1, item
level 7) beside the same-rung goldleaf_folio (int 3 spi 2, a 150 bill) and the rung-0
silverleaf_primer, and hobnail_boots (armor 18, a 100 bill) beside the rung-0
coppermail_sabatons (armor 38, a 46 bill). Both rows were trophy sinks whose only use
was the vendor loop, and no other uncrafted output sits in either band, so
cracked_fetish and bogiron_nugget are EXCLUDED under row 122's own clause (the eighth
and ninth output exclusions, their defs back to the pre-phase bytes): SEVEN adopted,
TWELVE excluded, two held out. Inscription's lane is now EMPTY like jewelcrafting's
and engineering's, and armorcrafting keeps no trophy row. The healing potion row
inverted alchemy's ladder (320 HP for an 82 bill at rung 25 against the trainer's 200
HP draught at 140) and is re-picked to lesser_healing_potion (190 HP), under the
rung-25 draught and above the rung-0 pair; the vendor's own 320 HP potion at 170
already undercut the draught's bill, a pre-existing tension that is the maintainer's.
The maul (dominated on every axis but agility 2 by the rung-25 ironshod_maul) and
the oiled boots (near-dominated by the rung-0 fenbridge boots) are recorded at their
rows as tuning reads, not excluded; the quiver joins the maul on the maintainer's
surplus list under gathered-cost accounting (+164 and +278 after the sink, pinned).
Rows 82 to 85 and 122 to 123 stand; nothing was re-decided. ONE ROW ADDED to the
handoff table (zone 1's loss of every poor mob drop, above); the col_junk_drawer row
above re-reads at three of margin.

## Phase 11o note (2026-08-25): rows 117 to 120 EXECUTED; three stale
premises re-derived under the rows' own rules, none re-decided

ROWS 117 TO 120 WERE EXECUTED AS SETTLED. The live tree had moved under
three of the settlement's premises; each resolved by the rules the rows
themselves state (full ledger: state.md, Phase 11o):
- Row 118 names duskhide_wraps a rung-75 rare; the live tree carries it
  at skillReq 50 (#3520, documented in-row). The row's acceptance is
  "derived not pasted", so the wraps moved 20 to 15 with the rung-50
  band, wearable by 16.
- The known-two skip list (boundstone_helm, gravewyrm_gauntlets) is
  EMPTY: both are skillReq-25 level-15 COMBO rows outside the derived
  scope. The sweep's real shared-source candidate is
  gravewyrm_bone_quiver (rung 50, level 20, the Korzul drop), SKIPPED
  under 11l's trophy convention with the drop premise pinned in
  tests/crafted_wearability.test.ts.
- Row 120 locates the above-cap lesson in both tool headers; it lives
  in the ROD_RECIPES header plus the file-scope note, and was amended
  where it lives.
Row 119's gadget: the phase file's "a cosmetic use on the gyrelens
precedent is legal" inverts the precedent (the gyrelens comment records
NO cosmetic-use family exists, under masterwrought R14), so the row's
statted-offhand arm was taken (Copperlens Ocular, engineering's own
int/sta line). One ripple the settlement could not see: the ocular is
the stats-bearing engineering craftable the 2026-08-07 reliquary ruling
named as masterwork:engineering's un-pend condition; the slot is hinted
and SOURCE_PENDING_RULING is mounts-only now.
