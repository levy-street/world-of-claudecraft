# Farming: cross-phase state (the cheat sheet)

Read this file first in every phase session. It is the single authority for locked
decisions. If a phase file contradicts this file, this file wins and the phase file
gets swept in the same pass (amend the QA twin too, always).

Current phase: Phase 13 (integration polish) IN FLIGHT on
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
Current phase: Phase 11 (well-fed food) DONE 2026-08-19, local-only per D22
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
Current phase: Phase 10 (celebrations) DONE 2026-08-19, local-only per D22
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
Phase 10 QA (docs/farming/phase-10-qa.md, its head carries the
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
(docs/farming/phase-10-celebrations.md; (bo) still bounds it: nothing may
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
docs/farming/phase-09b-bed-verbs.md, maintainer adopts or strikes) BEFORE
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
Eastbrook (24.5, 32.5), Farmer Teasel 'Fen Paddy Farmer' at Fenbridge (-21,
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
go-live, docs/farming/phase-09-*.md starter). Phase 8 itself was done
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
2026-08-14; Phase 7 QA runbook is docs/farming/phase-07-qa.md.
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
   still says "no faucet until go-live" for compost); DEED_ART_PENDING at
   8 untitled deeds plus the commissioned prog_farming_100 crest
   replacement (docs/achievements/icon-brief.md); the Phase 11 buff-bar
   and tooltip capture offer; the A4 pairwise-distinctness pin extension
   across every procedurally-resolving id when the first debt id leaves
   the pending set; the 10 to 11 px mobile chip legibility revisit
   ((bf)(4)).

### The handoff table

| Item | Phase | Owner | Status |
|---|---|---|---|
| D11/(bo) tier 3/4 seed bootstrap; must cover the three (ca) dormant recipes (porridge, braised greens, harvest feast) | P9 QA / P11 / P12 | maintainer | open ruling-owed (GATE 1) |
| (bs) dormant-deed waiver (prog_farming_100, feat_book_complete) plus the D12 cadence read | P10 | maintainer | open ruling-owed |
| (a) PENDING_ART allowlist sign-off (gather_farming, self-clearing) | P1 | maintainer | open ruling-owed |
| (w) structural affinity exemption, 27 materials (standing since Phase 4) | P4 / P5 | maintainer | open ruling-owed |
| (al) art-suite guard extensions plus the bundle-hash renderer/content split | P6 / P6 QA | maintainer | open ruling-owed |
| (ap) farmNowMs facet member (re-argued KEEP at P7 QA) | P7 | maintainer | open ruling-owed |
| (bb) linkdead transient-notice loss acceptance | P8 | maintainer | open ruling-owed |
| (be) simplified-mode gathering rows (a Professions 2.0 surface change) | P8 QA | maintainer | open ruling-owed |
| (bg) intro grant fence, trade-pipe leak, garden_hoe reagent knock-on | P9 | maintainer | open ruling-owed |
| (bh) NPCs-are-terrain pad rule (Highwatch eyeballed, no re-seat) | P9 | maintainer | open ruling-owed |
| Well-fed ladder magnitudes: capstone at the elixir ceiling, 24-stam stacking, twins stat-identity, tier-1 inversion, unanchored raid-floor phrase | P11 / P11 QA | maintainer | open ruling-owed |
| Feast tuning: charges 10, 180 s, trainer fee 10000, sellValue 250, reagents x4/x4/x2 | P12 | maintainer | open ruling-owed |
| Seed-back rates 0.08/0.40 tier 3, 0.06/0.35 tier 4 (economy-sensitive) | P5 | maintainer | open ruling-owed |
| Watch fees 2/3/4/6, compost 2/8, FARM_HUSKS_PER_COMPOST 2, tonic bonus 0.5/2 | P4 | maintainer | open ruling-owed |
| Growth tonic 6 sell-only plus (ai) cheapest rung-0 alchemy skill-up ruling | P4 / P6 QA | maintainer | open ruling-owed |
| (aj) 2500/10000 trainer fees on reagent-dormant rungs | P6 QA | maintainer | open ruling-owed |
| Tier-3 rung-50 domination (three rungs for four tiers); tier 4 quality rare | P6 / P11 | maintainer | open ruling-owed |
| Dish foodHp/sellValue assignments and reagent counts (all curve-point reuses) | P6 | maintainer | open ruling-owed |
| Crop durations (5-minute sibling gap advisory), gain schedule, survival endpoints, pick floor/cap | P3 / P5 | maintainer | open ruling-owed |
| Crop display names lore pass (D11 ids locked) | packet | maintainer | open ruling-owed |
| Hoe display names (Skysilver/Osmium compressed coinages) and prices | P5 | maintainer | open ruling-owed |
| Fine-twin buyValue doctrine intersection (priced tier-4 twin above unpriced tier-4 seed) | P5 QA | maintainer | open ruling-owed |
| fine_marsh_rice / fine_highland_barley dish consumers (hoe-reagent-only today) | P6 | maintainer | open ruling-owed |
| Farming counting toward any-profession deeds (default yes, automatic) | P1 | maintainer | open ruling-owed |
| ONLINE_WORLD_LAYOUT_VERSION epoch bump at farming go-live | 19th absorb | maintainer | open ruling-owed |
| renderer.ts exact-count ceiling re-pin (13774) prepared for feature review | 19th absorb | maintainer | open ruling-owed |
| q_prof_intro requiredItems overflow grant on a full bag (17/16 visible) | P9 QA | maintainer | open ruling-owed |
| Journey script joins the gate at go-public (D22 keeps farming off CI today) | P9b QA | maintainer | open ruling-owed |
| Tier-4-to-tier-1 wellfed downgrade legibility (buff hover is the one surface) | P11 QA | maintainer | open ruling-owed (optional) |
| (bq) residual: online pendingSend stranding on a silently dropped command (spectate/reconnect), family-consistent | P9b QA | maintainer | open ruling-owed (optional) |
| CRITICAL preload lane for the 12 crop-stage GLBs (background-lane split invited) | P7 QA | maintainer | open ruling-owed (glance) |
| Idle sway ignores reducedMotion (foliage precedent) | P7 QA | maintainer | open ruling-owed (glance) |
| Phase 9 farmer titles and greetings as authored | P9 | maintainer | open ruling-owed |
| p99 blob-size gauge in the perf heartbeat | P3 | maintainer | handed-to-maintainer |
| AURA_VISIBLE_CAP_LOW = 8 self-buff cap fairness (pre-existing, not farming's) | P11 QA | maintainer | handed-to-maintainer |
| The art batch ledger (gates block item 3: ITEM_ART_PENDING 44, wellfed aura icon, cross-family icon reads, hoe 32px, carrots-vs-pottage, pin art plus (bd), tonic sparkle, voice lines, icons.ts comment, DEED_ART_PENDING 8 plus crest replacement, chip legibility) | P4 to P12 | maintainer art pass | handed-to-maintainer |
| CI shard-weights harvest re-run at go-public (scripts/ci_shard_weights_harvest.mjs) | 16th absorb | go-public session | handed-to-maintainer |
| gatherDowngrade surface union gains 'crop' (silent signature truncation on full-bag golden wins) | P10 | later phase | handed-to-maintainer |
| Mobile-window-open body-class gap (harvest journal and plant sheet, family-wide) | P9b QA | Phase 13 polish | handed-to-maintainer |
| A11y polish batch: seed rows aria-pressed vs radiogroup, in-flight aria-busy, journal ready aria-live, WCAG label-in-name husk aria | P8 to P9b QA | a11y batch | handed-to-maintainer |
| countRawInSlots fifth src/ui copy plus the distToBed comment-contract mirror (need src/sim edits) | P9b QA | later farming phase | closed-by-Phase-14 (item B7: countRawInSlots exported from src/sim/item_lock.ts beside its unlocked twin, Sim.countItem delegates to it, the five src/ui copies collapsed onto it, the two domain-named wrappers tradeOfferCeiling and totalHeldCount are thin aliases; distToBed exported from farming.ts and consumed by the farm_bed_interact mirror, import pinned) |
| Style batch: .ps-seed raw rgba, the report window #ffd100 literal | P9b QA | Phase 13 style batch | handed-to-maintainer |
| useItem feast arm ignores the validated slotIndex (thread like consumeOneUnit if provenance lands) | P12 QA | Phase 13 polish | handed-to-maintainer |
| Bags feast hint says "Click to use" for a placement; a "set out" key needs M16 fills | P12 QA | Phase 13 polish | handed-to-maintainer |
| Nameplate feast row INTERACT_RANGE + 1 hysteresis pad; comment overstates "close enough to eat" | P12 QA | Phase 13 polish | handed-to-maintainer |
| Nameplate raw-id cast label for non-player farming casts (cross-profession class gap) | P3 / P7 | Phase 13 polish | handed-to-maintainer |
| Wiki shows no consumable-effect prose for ANY dish (GuideProfCraft lacks an effect field) | P12 QA | guide-generator follow-up | handed-to-maintainer |
| map_doc NPC sanitizer drops the farmer flag (one whitelist line plus a round-trip pin when the editor authors farmers) | P9 | editor curation | handed-to-maintainer |
| Steam/Epic achievement mapping (no ACH_ rows; hard cap 100 names) | P10 | maintainer | handed-to-maintainer |
| STALE PLAYER PROSE FOUND BY THIS SWEEP: guide.profPages.gatherDeeds.farming said farming "keeps no deeds of its own yet", FALSE since Phase 10 shipped seven deeds | P7 / P10 | Phase 13 lane A | closed-by-Phase-13 (new key gatherDeeds.farmingSown with its five M16 fills, deedsSection farming arm re-pointed, retired leaf kept with a RETIRED comment; its stale Latin fills join the release-fill row above) |
| Disposable-PG TOAST/WAL measurement (P3 QA made it a Phase 9 HARD gate) | P3 QA | Phase 13 QA | closed-by-Phase-13-QA, EXECUTED 2026-08-19 first-hand on the user-space PG16 (:5433) against the real server (:8787): a real online session planted ALL 23 beds with all three knobs through the real plant_crop wire (persistedPlots 23, denials 0). Numbers: characters.state pg_column_size 1,499 B compressed / 2,059 B raw EMPTY vs 3,261 B / 7,831 B FULLY PLANTED (+1,762 B compressed, +5,772 B raw, about 251 B raw per plot; per-plot row = cropId + plantedAtMs + readyAtMs + survivalRoll + yieldSeed + 3 knob booleans); post-VACUUM-FULL the 6-row probe table held 32,768 B TOAST + 8,192 B heap (rows past the 2 KB threshold TOAST as expected); WAL per 30 s autosave cycle about 12.5 KB ambient-idle vs 13 to 15.5 KB with the planted blob (delta about +1.5 to 3 KB per cycle per fully-planted character), aperiodic 36 to 82 KB checkpoint spikes rode both phases. Extrapolation: 10k fully planted characters is about +17.6 MB compressed at rest and about +60 KB/s WAL at 1,000 concurrently online, matching the Phase 2 db-review estimate class. Probe traps recorded in the memory topic (chat token bucket, silent /dev give/gather, the hoe ladder garden 1 / bronze 2 / skysilver 3 / osmium 4, level-1-dies-in-tier-4-zones) |
| Online resumed mid-growth live render check (P7 QA moved it to Phase 9 QA) | P7 QA | Phase 13 QA | closed-by-Phase-13-QA, EXECUTED 2026-08-19 first-hand as a PLAYER on the real dev client (LOW preset, puppeteer): planted vale_wheat through the real plant sheet (KeyF, seed row, Plant; the Sow It Begins toast fired), read the Harvest Journal (readyAtMs stamped 1787199621334, "Ready in 44m 56s", stage SPROUT), closed the LIVE game socket in place and let the client's own reconnect resume the session, then re-read: readyAtMs BYTE-IDENTICAL, countdown "Ready in 44m 47s" at 9 s elapsed (drift 0 s), row still hj-growing with the correct SPROUT stage; post-resume liveness proven by a /dev farmgrow round-trip flipping the row to "Ready to harvest" with the ready banner on screen (the event-forced-read race class the P7 QA adapter fix hardened: held). Screenshot evidence in the session scratchpad (probe evidence only, not committed, per the Phase 11 QA precedent). One rig note: the offer gate correctly listed the seed LOCKED as "Requires a tier 1 farming hoe" until the garden_hoe was granted, re-proving (bp) live |
| guide.profPages.rareBody (shared across the four gathering pages, filled translated key) names only the three node-trade windfall flavors; farming's golden-harvest flavor is absent (the farming page's new tableBody covers it, so no falsehood renders); the reword needs the new-key treatment plus fills | P13 lane A | release fill / maintainer | open, deferred (reword landmine) |
| FarmBiomePalette.trim has no draw-time consumer (soil tints the bed, wood tints the bin; the core comment claimed trim covered the bin and is now corrected); wire trim in the higher-tier pass or drop the channel | P13 integration | maintainer / art batch | open, handed-to-maintainer |
| "Well Fed" (aura.wellFed) is verbatim the classic-era MMO food-buff term; plain descriptive English, shipped Phase 11 with fills, past ip_scrub; awareness note only | P13 lane A | maintainer | accepted-no-action (awareness) |
| TEARDOWN PRECONDITION (gate-integrity finding): seven screenshot cone subtrees (farming-phase-01/05/07/08/09/09b/12) are referenced ONLY from docs/farming/ files, so deleting the packet reds tests/ci_workflow.test.ts's set-equality (in-cone-but-unreferenced), and the in-test comment then points at deleting the cone rows, which silently drops the evidence from five CI checkouts; the teardown change must re-home those references (or deliberately retire the subtrees WITH their cone rows and PNGs) in the SAME change; the plain farming/ subtree and farming-phase-13 survive via the asset manifest and the exporter | P13 integration | the eventual teardown change (deferred per the D22 addendum; Phase 13 QA verified the row against the tree and it holds exactly as written) | open, verified-by-Phase-13-QA (blocks teardown, not the merge) |
| TEARDOWN PRECONDITION addendum (Phase 13 QA dead-code lane): four out-of-packet COMMENT references to docs/farming/state.md exist beyond the screenshot subtrees: tests/monolith_budget.test.ts (cites deviation (an)), tests/item_art_consistency.test.ts (two citations of deviation (al)), tests/mob_portrait_source_manifest.test.ts (one (al) citation). Comment prose only, no build or CI impact; after the packet deletion they would cite a path that no longer exists. The teardown change should reword them to cite the surviving record (the git history of the merge, or progress-notes equivalents) in the same commit, or accept them as historical citations deliberately | P13 QA | the eventual teardown change | open (blocks nothing; teardown-hygiene note) |
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
- D22: Delivery model, LOCAL-ONLY (standing user rule, 2026-08-07; this supersedes
  every push-and-open-a-PR line in the phase files, and state.md wins on
  contradiction): ALL farming work stays local until the user declares the feature
  done. No pushes, no PRs, for anything farming. The integration branch is the LOCAL
  `feature/farming-plan` in this worktree (it carries docs/farming/; originally based
  on release/v0.36.0, it has absorbed every newer release tip since, release/v0.40.0
  e56707a675 as of the twenty-first absorb, 2026-08-19). Every phase: fetch, then branch `fix/farming-phase-NN-<slug>` off
  LOCAL `feature/farming-plan` (never off a bare release tip, which lacks the packet);
  if a newer `release/**` tip exists than the branch has absorbed, merge it INTO the
  phase branch first (release-merge-audit for a nontrivial merge, PLUS the
  deviation (al) absorb checklist for every absorb). SYNC MID-PHASE RULE
  (2026-08-13, the phase-06b precedent): when the pending jump is a minor
  version or more, or the release-delta intersection with the farming footprint
  reaches triple digits, the absorb runs as its OWN mid-phase
  (docs/farming/phase-06b-release-sync.md is the template) BEFORE the next
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
    docs/farming/ deletion. Its STEP 5 runs as a PRECONDITION VERIFICATION ONLY:
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
    If ACTIONABLE-IN-REPO is non-empty, it authors docs/farming/
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
    ACTIONABLE bucket is non-empty, so docs/farming/phase-14-final-polish.md is
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
  (az) Open surface: the journal opens from the professions window's
  Farming row plus the Shift+K keybind (harvestJournal, Interface category;
  Shift+H and Shift+J were taken). NO side-rail button: the rail guard has
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
  player. Fix owner: PROPOSED Phase 9b, docs/farming/phase-09b-bed-verbs.md
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
  PROPOSED Phase 9b (docs/farming/phase-09b-bed-verbs.md: the bed interaction
  that plants and harvests through IWorldFarming, before Phase 10) or re-dormant
  q_farm_intro, Jessica's teaching sentence, and the guide's "Sow with a hoe"
  prose until the verb ships (ADOPTED as Phase 9b, 2026-08-18, and CLOSED by
  its merge: the verbs ship, the go-live is player-complete, the journey and
  reachability pins guard the class; only (bo) below remains OPEN);
  (bo) the tier 3/4 seed bootstrap: (1) a seed-back
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
