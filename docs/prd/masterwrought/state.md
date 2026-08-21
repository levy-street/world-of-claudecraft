# Masterwrought: cross-phase state

Current phase: 11b BUILT (2026-08-20), THE FARMING ABSORB. This packet now
holds BOTH absorbed states, and a fresh session must load BOTH worlds: (1)
Masterwrought through Phase 11 incl. its QA (tip before the absorb
d5304a78c4; ledgers below), and (2) the COMPLETE farming packet (fourteen
phases, F01 to F14 with F06b and F09b, frozen QA tip 354cff6e77), merged
whole as the true merge commit 424ce89a20 of origin/feature/farming-plan
8cd964d599. The farming record lives at docs/prd/masterwrought/farming/
(state.md there is the merged packet's ONE open-item collection point; its
handoff table now also carries the migrated delegated-rulings block, and
masterwrought's open items append at its END). Next: Phase 11b QA (fresh
session), then 11c per the phase table. The Phase 11b pre-flight and BUILT
ledgers below are the phase record. Previous header, kept for the trail:
10 BUILT, its QA session's release sync COMPLETE (2026-08-14:
the final v0.38.0 sync, merge 33d641773f, landed with a seven-cluster audit,
two monolith extractions, the portrait and eastbrook re-mints, and the count
pins re-set from suite runs; the phase 10 QA audit fan-out itself runs next in
a fresh session per the cadence; the Phase 10 ledger below is the phase
record). Previous header, kept for the trail: 09 BUILT (2026-08-13: the
v0.38.0 map-marker sync merged with
a clean four-leg audit, the ten apex defs and recipes landed with art, i18n,
and wiki regen, party-shared mobile stations shipped on the mobile_station
seam behind the set-valued activeMobileStationCrafts readout, flagged-hand
demotion routes through fillHands in BOTH kit builders, and a six-reviewer
round plus a four-agent fix round landed; see the Phase 09 BUILT ledger);
next is Phase 09 QA (fresh session, own release sync first per the delivery
contract).
Packet authored 2026-08-07.
Branch: `feature/masterwrought` (worktree `~/Documents/wocc-masterwrought`), based on
`origin/release/v0.38.0`; carries every release sync through `origin/release/v0.40.0`
(65b91fa190) and, since 11b, all of `origin/feature/farming-plan` (8cd964d599).

## Delivery contract (non-negotiable)
- The ENTIRE system ships in ONE branch and ONE PR from `feature/masterwrought`. There are
  no follow-up PRs: an item is either in this packet or explicitly CUT, never "deferred to
  a future PR". Future-content ideas (orange unique effects, next-tier upgrade chains that
  consume this tier's pieces) are recorded in brainstorm.md as future-tier design intent,
  NOT deliverables of this packet.
- Every phase STARTS by syncing the latest release branch: `git fetch origin`, merge the
  newest `origin/release/**` into `feature/masterwrought`, then run the
  `release-merge-audit` skill on the merge before any phase work.
- All ten crafting professions receive equal-shape content: one intermediate (skill 75),
  three apex products (skill 100), one capstone role (skill 125). Parity is equal prestige
  and economic role through DISTINCT levers, never identical mechanics or identical power.
- THE ABSORB AMENDMENT (2026-08-20, ruling 11b-D-3, adopted as drafted, BOTH halves;
  written by Phase 11b). First half: the farming packet is ABSORBED into this one. Its
  branch origin/feature/farming-plan (tip 8cd964d599, fourteen phases complete) merged
  whole as the true merge commit 424ce89a20, and the ONE branch and ONE PR above now
  deliver BOTH systems together. Farming's D22 delivery model and its addendum arm (B)
  are superseded IN PLACE in farming/state.md, never deleted, and D22's absorb
  discipline is adopted upstream into this contract: the newest release branch is
  re-resolved by VERSION SORT (git branch -r --list 'origin/release/*' | sort -V, last
  row), an absorb whose pending jump is a minor version or whose changed-file
  intersection reaches triple digits runs as its OWN sync mid-phase before feature or QA
  work, phase merges are --no-ff so phase boundaries stay readable, and ONE teardown
  decision covers both packets' planning docs, taken with the maintainer at Phase 17.
  Second half: an "accepted-by-design" handoff row already CONSTITUTES the explicit
  record the CUT requirement above asks for; a dated row saying "accepted, here is why"
  is the most explicit form a record takes, and no phase re-closes such rows to mint a
  second copy of an existing record.

## Locked design rulings (settled with the maintainer 2026-08-07; do not re-litigate)
1. R1 The above-raid step is the PERFECTING STAGE (fork B): a deliberate upgrade performed
   on an existing apex piece, consuming 1 Maker's Ember + Sundered Essence + 1 Prismglass
   Setting per attempt (registry name amended by the Phase 03 audit; same material). It
   BINDS the piece, is fail-forward only (failure consumes materials, never harms or
   downgrades the piece), and the existing craft-time masterwork
   proc on an apex craft grants a head start on the stage instead of a quality bump.
   `src/sim/professions/masterwork.ts` and its locked constants are NOT modified.
2. R2 Base apex pieces are freely tradable. A piece binds at the moment Perfecting begins.
3. R3 Orange is prestige and process only in v1: unique name via Deed of Making, distinct
   visuals, crafter signature, deed credit. No unique combat effects. Sub-cap: at most ONE
   legendary-quality crafted piece equipped, inside the global cap.
4. R4 Keystone: "Maker's Ember", soulbound, 1 per week per character, BANKABLE (missed
   weeks accrue), earnable from any endgame pillar (raid, heroic five-mans, rifts).
5. R5 Power envelope: full kit (2 Perfected pieces + apex enchants + flask + food) at most
   5 percent total throughput over pre-packet raid BiS, measured via
   `docs/design/spell-balance-framework.md` before merge. Heroic raid and S-rift clear
   difficulty is the protected asset.
6. R6 A two-hander consumes ONE of the two Masterwrought cap slots.
7. R7 Boots enchant is stats only. No movement speed in v1 (rift racing).
8. R8 Recipe channels: raid and rift patterns are tradable drops (bind on learn); heroic
   five-man patterns are sold deterministically for Heroic Marks (the day-one catch-up
   valve).
9. R9 Rift core faucet: Wyrmfall Cores from A and S rank first clears, once per character
   per day (rifts have no lockout; this is the cap).
10. R10 Jewelcrafting and inscription get their BASE catalogs (0 to 50) inside this packet,
    before their apex content.
11. R11 Explicit ruling supersedes the "masterwork stays below the raid band" design intent
    for the Perfecting stage ONLY; the shipped masterwork proc math is untouched. Recorded
    here as the amendment `docs/design/professions.md` requires.
12. R12 Apex crafted epics disenchant to the standard 1 arcane_shard. Revisit only if shard
    prices misbehave post-launch.
13. R13 Skill placement: intermediates at 75, apex recipes at 100, Perfecting requires 125
    in the craft that made the piece. maxSkill stays 125. The profession XP tables are NOT
    changed; pacing lives in the new rungs' progress curve if needed.
14. R14 v1 apex items carry PURE STATS and bounded utility only. No new proc effects
    anywhere in this packet. Jewelry (stat-light slots) is pure primary stats + stamina
    with rating allocations pinned to the same-band heroic-vendor jewelry.
15. R15 IP naming: never reuse a coined term or full item name distinctive to another game.
    Every new proper noun is web-verified against the major game wikis at authoring time
    and recorded in the naming registry (below). Pre-existing shipped collisions (arcanite,
    silverleaf, and any others the audit finds) get display-name-only renames in the
    dedicated naming phase (ids are frozen and never change).
16. R16 Duplicate apex pieces: wearing two copies of the same apex item is allowed inside
    the cap (v1 pieces are pure stats, so copies are harmless). Revisit if v2 adds effects.
17. R17 THE PROVISIONER RULE (R17 to R20 were added 2026-08-20 with the professions
    completion program, phases 11b to 11k; same standing as R1 to R16, do not
    re-litigate). Farm produce feeds the CONSUMABLE professions (cooking and alchemy) at
    every rung, and NEVER the gear chain, the Perfecting materials, or
    recipe_quickening_catalyst (the packet's one pacing gate). Grain and vegetables are
    the third gathering input family, beside meat and fish and beside herbs. The reason
    is measured: the whole cooking tree uses 17 distinct reagents and NOT ONE is a
    vegetable or a grain, so a fifth gathering profession whose entire output is produce
    ships with no buyer at all. The rule fills that hole where it belongs (food and
    flasks) rather than routing produce into gear, where it would push against R5's power
    envelope and put a wall-clock-gated input in front of the one gate that paces the
    whole packet.
18. R18 NEED THE OUTPUT, NEVER THE SLOT (the demand engine; stated positively because it
    is one, and amended 2026-08-20 from its original defensive framing as "the
    anti-compulsion guardrail", which undersold it). Professions are needed through
    their OUTPUT and never through a character slot. Everyone needs what professions
    make: flasks, feasts, food, enchants, near-raid gear. Nobody needs to have TAKEN a
    given profession to equip, enter, or complete anything. Those two sound similar and
    behave in opposite directions. Needing the slot is a tax every player resents and
    every game eventually refunds (TBC's bind-on-pickup gear requiring the profession to
    equip; Wrath's equal mandatory perk per profession). Needing the output is the
    largest possible market, because the buyers are the entire playerbase rather than
    only the people who took the craft. The market is the bridge, and it is what makes
    every profession's output continuously valuable to the whole realm. Mechanically:
    every farm produce item stays market-listable
    `kind: 'junk'`, with tiers 1 and 2 vendor-stocked, so a raider buys grain the way a
    raider already buys sunpetal_herb. Farming rows are ADDED to bills alongside the herb
    and meat rows, never substituted for them, which is also how this packet honors
    farming's D24 displacement guardrail: herbalism loses nothing. No profession is ever
    required to equip, raid, or craft gear. This guardrail is load bearing rather than
    cautious: compulsion (the gathering profession that quietly becomes homework) is the
    recurring REAL failure the packet's own research identified across every game
    surveyed, and it is the single condition under which produce may be a first-class
    reagent at all.
19. R19 FARMING IS A LONG-HAUL SKILL. Its gain curve is deliberately slower than the
    other four gathering professions because harvests are wall-clock gated, not
    swing-gated. FARMING_GAIN_SCHEDULE (1 / 0.5 / 0.1 / 0.02 by band, carrying the source
    marker "TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER") is tuned against a MEASURED
    calendar-days-to-100 model built from real bed counts and real cycle times, never
    from feel. Slower pacing never becomes punishment: no daily reset, no decay, and a
    late harvest still costs only opportunity. Farming's anti-chore contract holds
    absolutely, and the day it would have to bend is the day the curve is wrong, not the
    day the contract is.
20. R20 EVERY GATHERING PROFESSION REACHES THE ENDGAME. No gathering profession may be
    absent from recipes at skillReq 100 or above, nor from any 25-point band below it,
    and this is enforced by a TEST, not by intention. The census that forced the ruling:
    endgame bills (skillReq >= 75) run mining 21, herbalism 15, skinning 11, logging 6,
    and FISHING 1, where that one row is recipe_tidewrought_fishing_rod, so fishing feeds
    only itself; farming's own ladder tops out at skillReq 50 with all 14 recipes
    acquisition ['trainer'] against masterwrought's 28 acquisition ['drop']; and the apex
    gathering-tool family (arcanite_mining_pick 150, elderwood_axe 150, sunpetal_sickle
    150, tidewrought_fishing_rod 125) has exactly one hole, farming, whose ladder ends at
    osmium_hoe at engineering 75. Intention is what produced that spread; a pinned test is
    what keeps the next profession from repeating it.
21. R21 DEMAND-SIDE DESIGN (added 2026-08-20 with the player-pain block, phases 11l to
    11n; same standing as R1 to R20). Every profession's output must be CONSUMED by the
    endgame at a rate that sustains a real market. Content is tuned so the prepared
    player is meaningfully stronger, consumables are spent per raid night rather than
    hoarded, and no profession produces something nobody repeatedly needs. R20 is the
    supply half of one invariant and R21 is the demand half: R20 proves every gathering
    profession feeds the crafts, R21 proves the world eats what the crafts make. A
    profession that feeds a recipe nobody buys is still dead content, and ONLY the demand
    half catches it. The worked example, which is exactly the fault R20 cannot see: the
    enchanting reagent ladder runs arcane_dust (9 recipes, 27 units), arcane_essence (19
    recipes, 40 units), arcane_shard (2 recipes, 10 units, and BOTH consumers are
    skill-25 tool charms), lucent_reagent (apex). arcane_shard is what disenchanting a
    rare yields, at roughly 6 to 7 per disenchant, so the third rung of a four-rung
    ladder is the one a mid-to-high player produces most and has almost nowhere to send.
    R20's census passes this happily, because enchanting appears in plenty of recipes at
    every band. THE LINE R21 DOES NOT CROSS: pushing demand is right and it inverts past
    a point. If content is tuned so hard around the full kit that arriving without it
    means you cannot clear, professions stop being desirable and become a checklist, and
    the players who love professions feel it first. R5's 5 percent envelope is that line:
    prepared is meaningfully stronger, unprepared is behind and never locked out.
22. R22 NO MATERIAL IS GEOGRAPHICALLY TRAPPED. Every mapped corpse-harvest component
    family must reach a floor of templates, zones, and at least two level bands, and no
    mob template may carry a component tag absent from HARVEST_COMPONENT_ITEMS. Enforced
    by a test. The census that forced it: tag membership decides a material's whole
    geography, and the spread ran tusk 2 templates, silk 3, venomSac 4, claw 6, cloth 7,
    meat 15, fang 16, hide 33, a 16x range. Silk at three templates is why a leveled
    player farms starter-zone spiders and competes with new players for them, and why
    tailoring reads as trivial and miserable at once: it consumes both ends of the
    spread. Two tags, `horn` and `gills`, sat on templates while mapping to nothing, so
    those corpses yielded nothing AND inflated the concentration bonus on every mixed
    template carrying them. THE FLOOR IS MEASURED IN REACHABILITY, NOT MEMBERSHIP: a
    floor met by tagging a raid boss and a dungeon rare is the same bug with a passing
    test, so the count only admits templates a player at the relevant level meets in
    ordinary play.
23. R23 A VENDOR IS A FLOOR, NEVER A COMPETITOR. No vendor-sold item may sit within the
    decided margin of a crafted equivalent on the axis that matters, and the margin
    WIDENS as the rungs climb. Enforced by a test. The measured fault: crafted potions
    beat vendor potions by 9.1 percent at the bottom rung and under 3.7 percent at the
    top, so the advantage shrinks exactly where professions are supposed to matter most,
    while the vendor sells an unlimited substitute at a fixed price. No player pays a
    crafter for 3.7 percent, which is why the reported experience is that leveling
    alchemy to sell potions is pointless. The floor is created by lowering the VENDOR
    line and never by raising the crafted line: that direction leaves R5's ceiling
    exactly where it was measured, so the power verification inherits no new work. A
    floor is also not a cliff: a player with no crafter, no gold, and no market access
    must still be able to buy something that works, so the nerf weights toward the top
    rungs where the crafted economy lives and the player has options.

THE RULING-NUMBER COLLISION, standing rule for R17 to R23 (recorded 2026-08-20; the
Phase 11e Decision F default, applied packet-wide). These numbers ALREADY MEAN something
else in shipped source and docs: the Professions 2.0 / professions-tuning R series, which
`src/sim/` cites at R1, R4, R8, R9, R14, R19, R22, R30, R35, R37, R39, R40, R42, R45 to
R50. Two are live landmines. Shipped R19 is the fishing teaching-ceiling ruling, cited from
`src/sim/professions/fishing.ts`, `src/sim/professions/CLAUDE.md`,
`docs/design/professions.md`, and a farming test titled "the R19 composition"; masterwrought
R19 is farming's gain curve, and Phase 11e writes it into a comment one screen from that
test. Shipped R22 is the wield-gate ruling, cited as "R22/R50" in
`src/sim/content/professions.ts`; masterwrought R22 is the harvest-geography floor, and
Phase 11m edits that very file.
THE RULE: packet doc numbers STAND and are never renumbered (they are cited from every
phase file and every ledger). But every R-number written into `src/`, `server/`, `tests/`,
any `CLAUDE.md`, or `docs/design/` by these phases is spelled "masterwrought R<n>" IN FULL,
never bare. A bare R-number in those files means the Professions 2.0 series, permanently.
`docs/design/professions.md` is the sharpest case and the reason `docs/design/` is in scope:
it is the OTHER series' own authority file, it already cites R19, R20 and R22 by bare number,
and Phase 11j writes masterwrought R17 to R20 into it. Reviewers: a bare packet R-number in a
source, test, or `docs/design/` comment is a finding, not a nit.

## Power placement (the numbers every content phase authors against)
- Budget formula: `src/sim/item_budget.ts` `primaryStatBudget`; crafted source level =
  `recipe.level` (`src/sim/item_level.ts` bumps at the ALL_RECIPES loop).
- Base apex: `recipe.level: 25`, quality `epic` -> ilvl 31 -> chest budget 22
  (heroic five-man parity, below raid 33/23).
- Perfected: instance-level bonus stats worth the delta to source 28 at epic quality
  (ilvl 34 -> chest 24), one to two points over the raid chest per slot, on at most 2 slots.
- Existing legendaries (ilvl 33 to 37, budgets 44 to 49) remain the untouched ceiling.
- Ratings (`hitRating`/`critRating`/`hasteRating`/`spellPower`) are OFF the primary budget:
  every apex piece's rating allocation is pinned against the same-band raid or
  heroic-vendor equivalent in tests. This is the throttle-proof surface; treat it as
  budgeted even though the formula does not.

## Naming registry (web-verified by the Phase 03 audit, 2026-08-07)
Cap tag: "Unique-Equipped: Masterwrought (2)". Stage: "Perfecting".
Shared items: Wyrmfall Core (tradable making-core), Sundered Essence (bound, from breaking
down any raid epic of the tier), Maker's Ember (keystone), Apex Patterns (recipe items).
Per profession: Duskforged Billet / Forgefold Plating / Wyrmhide Cording / Sunspun Bolt /
Prismglass Setting / Precision Chassis / Quickening Catalyst / Seasoned Stock / Lucent
Reagent (intermediates); Ridgebreaker (2H), Gyrelens Array (gadget), Master's Field Forge,
Voidbound Grimoire, Grand Cauldron, The Laden Hearth (party field-crafting station,
ratified by phase 10 QA ruling 4; minted under the spec's feast flavor), Deed of Making
(codex),
Lucent Infusion (Perfected-only enchant). Rejected for collisions: Vanquisher, Radiant,
Arcanite (new uses), Quintessent, Grand Banquet, Colossus Splitter, Aetherlens, Apex (tag).
Phase 10 additions (web-verified 2026-08-14, evidence in naming-audit.md): Ironhusk Flask /
Warboar Flask / Runewater Flask (apex flasks, the shipped '<Word> Flask' form over WoW's
'Flask of the <noun>' trade dress), Stonepot Stew / Warspice Skewers / Sageleaf Chowder
(role foods); the apex enchant names (four at phase 10, the D10-D1 weapon int twin at the
head of phase 11) ride the recorded 'Enchant <Slot> - <Stat>'
scheme with the registered Lucent tier word (no new coin). GW2's Lucent Mote / Pile of
Lucent Crystal (same enchanting-material role class) recorded against the Lucent row.
Phase 11 head, per ruling (9): the four aura DISPLAY names (Ironhusk Vigor, Warboar
Might, Runewater Clarity, Well Fed) registered GENERIC-with-caveat in naming-audit.md
(Well Fed's caveat: WoW's verbatim same-role food-buff name, kept as a plain-English
state description). AMENDED 2026-08-20 (state-OPEN-WELLFED, in "Decisions closed
2026-08-20" below): the Well Fed caveat's SECOND clause, the one that said the registry
row must say so or one of the two mechanics is renamed, is RETIRED by the 11c
unification. After 11c there is ONE Well Fed (one aura id `well_fed`, one mechanic, one
ladder), so neither mechanic is renamed and the condition that created the caveat is
gone. Phase 16 writes the amendment into naming-audit.md with this date and reason.
Phase 03 amendments: Prismstone Setting RENAMED to Prismglass Setting (FFXIV ships a real
'Prismstone' crafting material in the same component role, plus WoW's Prismstone Ring;
Prismglass verified zero-hit). Phase 03 QA amendment (v0.36.0 merge supersession): the
release's own IP-safe honor-title re-cut (PR #3133, maintainer-merged) supersedes the
phase's honor-ladder verdicts: the ladder ships as Linebreaker / Fieldreaver / Warcrowned
(ids unchanged); the phase's Banneret never ships, and the Sergeant / Field Marshal keeps
lost their subjects. Later phases author against the release names. Wyrmhide Cording and Sunspun Bolt KEPT with recorded
caveats (Wyrmhide is a D2 armor base and a WoW arena-set family, cross-franchise material
vocabulary; Sunspun's only use is FFXIV's cash-shop Sunspun Cumulus mount); all other
registry names verified CLEAR or GENERIC. Full verdicts: naming-audit.md.
Phase 05 amendments (2026-08-10, all web-verified at authoring time): the nine
jewelcrafting base-catalog names, all CLEAR: Hammered Copper Band, Polished Copper
Loop, Coiled Copper Torc, Riveted Iron Signet, Etched Iron Loop, Iron Link Choker,
Weighted Osmium Band, Gleaming Osmium Loop, Burnished Osmium Amulet (the rung-50
DISPLAYS use the shipped Osmium register; their frozen ids keep thorium, matching
thorium_ore whose display is Osmium Ore). The Osmium display forms were verified
SEPARATELY after review (2026-08-10): zero exact hits for all three; nearest
neighbors are different full names (BG3 Burnished Necklace and Burnished Ring, WoW
Refined Gleaming Ore, Cabal Osmium Armorset; the Neko Chan Discord game ships a
plain "Osmium Amulet", judged shared material vocabulary, not a coined term). All
three CLEAR. Deed: Polished to Brilliance (prog_jewelcrafting_rare), CLEAR, follows the
prog_*_rare family pattern. Rejected for collisions: Copper Torc (Dungeons of
Dredmor), Iron Signet (Pirate101, LOTRO variants), Polished to Perfection (Trove
achievement, plus our own Plated to Perfection), Heavy Thorium Band (WoW's
Heavy-material-ring jewelcrafting register, discarded at design time).
Phase 05 QA amendment (2026-08-10): Facet and Filigree (prog_jewelcrafting_50),
CLEAR (exact-phrase zero-hit; the words appear only in unrelated single-word uses:
Binding of Isaac's Filigree Feather, GW2's The Missing Facet, Lost Ark's Facet of
Another Level; shared jewelry vocabulary, not a coined term). Grandmaster
Jewelcrafting (prog_grandmaster_jewelcrafting title) follows the shipped mechanical
Grandmaster-craft family, generic by construction.
Phase 09 amendments (2026-08-13, all web-verified at authoring; full verdicts in
naming-audit.md): the six apex gear names, all CLEAR: Duskforged Warblade,
Duskforged Bulwark, Wyrmfall Pendant, Warhewn Signet, Prismglass Loop, Maker's
Charm (recorded caveat: WoW's Maker's Mark / Maker's Edge are different pairings,
the accepted Maker's Ember caveat class). New coins: none. Warhewn (recorded CLEAR
at phase 08) gets its first shipped use; Duskforged, Wyrmfall, and Prismglass
extend their registry families with generic slot nouns; the possessive charm
ladder now reads Gatherer's, Artisan's, Maker's. The two Duskforged pieces are a
deliberate same-craft, same-archetype sword-and-board pair (the phase 08
rejection class was pieces spanning two stat archetypes). Rejected at authoring:
Runeglass Band (New World's Runeglass crafted-gem system), Maker's Hand (EQ2's
The Hand of the Maker, an equippable tradeskill item in the same crafting-buff
role), Masterwright's Charm (in-repo deed-name collision), Forgefold Bulwark and
Duskforged Signet (cross-craft matched-set misreads), Wyrmfall Aegis, Wyrmfall
Edge, and Prismglass Pendant (one family per stat archetype), Duskforged Edge
(three in-repo Edge surfaces plus the WoW Maker's Edge adjacency), Ridgehewn Band
and Spellglass Band (needless second coins).
Phase 08 amendments (2026-08-12, all web-verified at authoring by a proposing
agent plus an adversarial second pass; full verdicts in naming-audit.md): the ten
apex armor names, all CLEAR: Spiritweld Girdle, Forgefold Legguards, Wardspeaker
Sabatons, Briarstep Jerkin, Fenbloom Breeches, Barksong Handguards, Sunspun
Vestments, Sunspun Leggings, Sunspun Handwraps, Sunspun Haversack. New coins:
Spiritweld, Wardspeaker, Briarstep, Fenbloom, Barksong; Forgefold and Sunspun
extend their registry families with generic slot nouns (the Sunspun FFXIV-mount
caveat does not worsen). Rejected at authoring: Galerune Treads (adversarial
BORDERLINE upheld: this game's own Galecall mail-caster set makes another Gale-
compound on mail caster gear read as false set membership), Hexlink Girdle (live
Hexlink coins outside the seven wikis), Anvilmarch Legguards (WoW Anvilmar
adjacency), Forgefold Waistguard/Treads (CLEAR but a cross-archetype matched-set
misread), Warhewn Legguards (CLEAR alternate, lost to the zero-coin extension).
Wardspeaker's considered adjacency: FFXIV's two-word possessive Ward Mage's /
Ward Knight's Sabatons, ilvl-1 starter gear sharing only generic vocabulary.

## Validation matrix (per change type)
- sim-only: `npx tsc --noEmit` + affected `npx vitest run tests/<file>.ts` +
  `npx vitest run tests/architecture.test.ts`; parity suite when rng draw sites change.
- content-only: `npx tsc --noEmit` + `npx vitest run tests/progression.test.ts
  tests/recipe_economy.test.ts tests/itemization_coverage.test.ts tests/item_level.test.ts`.
- player text: `npx vitest run tests/localization_fixes.test.ts` (S3 guard) in the SAME change.
- wire/snapshots: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts`.
- ui/render: `npx tsc --noEmit` + affected view-core tests + a mobile screenshot script.
- any code change: `npm run ci:changed` (Biome on changed files only; NEVER whole-tree --write).
- pre-merge / phase close: `node scripts/gate_select.mjs`; full `npm run gate` before the PR.

## Key existing seams (from the research; verified against v0.35.0, re-verify on v0.36.0 drift)
- v0.36.0 re-verify (phase 03 QA merge audit): the drift check ran; two NEW mandatory
  seams landed with the merge that later phases must obey: (a) `src/sim/inventory_sort.ts`
  KIND_RANK / QUALITY_RANK are TOTAL Records, so any new ItemKind or quality tier fails
  tsc until ranked there in the same change (the merge ranked 'recipe' at 10 with a test
  fixture); (b) SimContext gained `bumpCommissionOrderBoardRev`, which every
  commission-board mutation site must call. Also from the merge: every daily rollover now
  keys on `ctx.resetDay` (realm-local reset window); `utcDay` is a calendar stamp only.
  The two-hand/offhand displacement rule gained a worn arm: a worn offhand
  (`occupiesHand: false`, the hunter quivers) COEXISTS with a two-hander in both
  directions and budgets on WORN_OFFHAND_STAT_MULT (0.45), so the phase 01 ledger's
  "a two-hander equip empties the offhand" exemption is now conditional on
  `occupiesHand`, and the phase 06/09 offhand authoring must decide the worn arm
  explicitly.
- Recipes: `src/sim/content/recipes.ts` (`ALL_RECIPES`), shape `ProfessionRecipeRecord`
  (`src/sim/professions/types.ts`). SUPERSEDED BY PHASE 02 (the research-era premise said
  zero users and no kind): `acquireRecipe` now has its first real caller (source 'drop',
  `src/sim/professions/pattern_items.ts`) and the `'recipe'` ItemKind exists
  (`RecipeItemDef`, `src/sim/types.ts`); no shipped content carries the kind until phase 11.
- Unique-equipped: `src/sim/equipment_rules.ts` `isUniqueEquipped` is hardcoded
  `quality === 'legendary'`; the counted Masterwrought family is NEW machinery beside it.
- Masterwork: `src/sim/professions/masterwork.ts` (pure leaf, locked constants); proc site
  `crafting.ts` (one rng draw per successful craft). DO NOT MODIFY; Perfecting is a new
  sibling module.
- Keystone template: `heroic_mark` + `awardHeroicMarks` (`src/sim/instances/dungeons.ts`),
  soulbound currency with mail overflow.
- Rift hooks: `rift_essence`/gems (`src/sim/content/rift/items.ts`, `noMarketList`),
  `craftingMaterialBias` (`src/sim/rift/types.ts`).
- Binding: `ItemDef.soulbound` (def-level) + Maker's Bond `bindOnTrade`/`boundTo`
  (`src/sim/professions/commission.ts`); no BoP/BoE concept exists.
- Item instances: `ItemInstancePayload` (`src/sim/types.ts`), `rolled.stats` is how
  Perfected bonus stats persist; `boundTo`/`charges` never leave the server.
- Consumable exclusivity: the aura id scheme in `src/sim/items.ts` (the `def.kind ===
  'elixir'` arm): the aura id is `elixir_${elx.kind}`, keyed on the effect KIND, so every
  elixir of one stat shares one id and `applyAura` same-id replacement makes them
  exclusive, last drunk wins. A buff scroll joins an elixir family by emitting the SAME
  `elixir_${kind}` aura id (alternative source, replaces in both orders, never stacks);
  the items.ts comment documents the family-component extension (`elixir_battle_...`) if
  a family ever needs to split within one stat kind. `src/sim/combat/exclusive_aura.ts`
  + `exclusiveGroup` is the ABILITY self-buff machinery (shouts/aspects/stances), not
  the consumable path; a flat `src/sim/exclusive_aura.ts` never existed. (AMENDED at the
  Phase 06 release-merge audit; the row previously misstated both path and mechanism.)
- Stations: `STATION_TYPE_BY_CRAFT` (`src/sim/content/professions.ts`); enchanting,
  jewelcrafting, inscription have NO station today; their recipes need explicit
  `stationType` or new station content (decide in phases 05/06, record here).
  PHASE 05 DECISION (jewelcrafting): every jewelcrafting recipe carries an explicit
  `stationType: 'forge'`; the craft stays OUT of `STATION_TYPE_BY_CRAFT` and no new
  station type is minted. Full rationale in the Phase 05 ledger. Inscription still
  records its own decision in phase 06.

## Per-phase ledger (append as phases complete)
- New IWorld members: NONE (Phase 01 decision: the client pre-check reuses the existing
  IWorldInventory reads `equipment`, `equipmentInstances`, and `inventory`; the parity pin
  is untouched).
- New SimEvents / wire fields: none (both refusals ride the existing `error` event).
- New item ids: none (Phase 01 tests use runtime-injected synthetic ids only; ids are
  frozen once shipped, append-only goldens apply).
- New i18n keys / matcher rules: `error.masterwroughtCap` + `error.masterwroughtLegendary`
  (sim matcher rows, real translations in all 20 non-en DICT blocks; the sim scope is
  invisible to the release fill worklist so English-only rows would ship forever);
  `hudChrome.itemMasterwrought` = 'Unique-Equipped: Masterwrought ({count})' with {count}
  fed from MASTERWROUGHT_EQUIP_CAP through itemNumber (five non-Latin fills in-change
  per M16; 15 Latin overlays pending for the release fill, en_CA is NOT one of them, it
  auto-resolves from en); glossary category
  `masterwroughtSystem` pins the coined per-locale renderings.
- New tests: `tests/masterwrought_cap.test.ts` (pure matrix, enforcement, guard order,
  auto-equip skip, legacy-save tolerance incl. a two-legendary over-cap save, constants +
  DICT.en cross-pins, per-locale refusal coverage over all 20 non-en DICT blocks,
  content-shape pin with isEquipSlot); `tests/masterwrought_tooltip.test.ts` (the tag
  arm on the real itemTooltip: presence, absence, coexistence with the unique tag);
  extended `tests/equip_drop_core.test.ts` (mirror cases incl. the displaced-slot
  exemption, two Sim-authority checks that assert the refusal strings, char_window
  call-site source pins); `tests/equipment_instances_wire.test.ts` (the einst
  self-snapshot decode: wire-null clears to empty map, absent keeps prior, real map
  replaces).
- Client API surface (QA addendum): `PaperdollDropAction` gained
  `'blockedMasterwroughtCap' | 'blockedMasterwroughtLegendary'` (an exhaustive switch on
  the union must add both arms) and `paperdollDropAction` gained optional params 7/8
  (`instances`, `inventory`); all three char_window.ts call sites pass both, and a source
  pin holds that wiring (omitting them silently degrades the mirror to def quality).
  src/net/online.ts einst decode hardened to `s.einst ?? {}` (a wire null can never leave
  the mirror's equipmentInstances null; delta semantics unchanged, absent keeps prior).
- Phase 01 API decisions: `masterwroughtConflictSlot(item, equipment, lookup, ignoreSlots,
  instances?, incomingQuality?)` returns `{ slot, reason: 'cap' | 'legendary' } | null`
  (the reason picks the refusal line; instance rolled.quality overrides def quality, a
  DELIBERATE difference from isUniqueEquipped which stays def-only); the unit-selection
  rule lives in equipment_rules as `equipCandidateIndex`/`equipCandidateQuality` so the
  sim consume, the sim pre-check, and the client mirror share one selection. The two
  refusal emits in items.ts MUST each stay on ONE physical line. Mechanism (QA-verified
  against the real scanner regexes, twice): on the plain-literal form a biome wrap adds
  a TRAILING COMMA that the scanner's closing-paren anchor does not match (the regex
  classes themselves span newlines); the ternary/notice forms exclude newlines outright.
  A SINGLE-LINE ternary IS visible (the `ert` regex); the original "cannot see a
  ternary" wording was wrong.
- Open items: JC/inscription station decision (phase 05/06); slot coverage audit results
  (phase 08: RECORDED, see the Phase 08 pre-authoring ledger below; picks are
  mail waist/legs/feet, leather chest/legs/gloves, cloth chest/legs/gloves);
  web-verified name confirmations (each content phase); tooltip does not yet
  state the legendary sub-cap, add the line when promotion makes it reachable (phase
  13/14); `rolled.quality` is RETIRED for new writes (crafting.ts), so the Perfecting or
  promotion phase must pick the field that carries instance legendary before the craft
  phases assume one (ruling needed by phase 12; QA sharpening: the only live writers
  stamp 'epic' on rift shell ids, so the ENTIRE sub-cap instance-override machinery is
  INERT until that ruling lands, and the phase-12 field decision should come BEFORE the
  first legendary-flagged def; keep masterwrought item ids disjoint from the rift shell
  id set, whose writer stamps rolled.quality on worn instances); promotion of a WORN
  piece bypasses the sub-cap entirely, nothing re-validates after equip, so the
  Perfecting/promotion phase must re-run the family check at promotion time or a
  character wearing two flagged epics promotes both to legendary-effective with no
  refusal (phase 12/13); when flagged content lands, extend the
  `tests/crafted_item_tooltip_coverage.test.ts` list, give the double gold tooltip line a
  copy pass, and re-check dev_kit/pbe_boost preset slot counting (phases 03/08; QA
  sharpening: pbe_boost's bisKitForRole scores by budget with no family awareness and
  buildBoostedCharacterState HARD-THROWS `boost equip failed` when a kit slot does not
  take, per class, so a flagged-heavy BiS kit is a boot-time crash, not a quiet miscount);
  the /wiki guide gear page explains unique-equipped but has no Masterwrought section
  yet, add one when content makes the tier visible (phase 08+); the packet PR's
  before/after screenshot for the tooltip tag needs a synthetic flagged item (nothing
  shipped carries the flag), decide the capture approach at PR time; the S3
  scanner's blindness to WRAPPED emits is a repo-wide guard gap worth a durable
  hardening outside this packet (a single-line ternary is visible, see the API
  decisions entry); the sim_i18n BASE_NEW locale blocks re-declare themselves after the
  `...BASE_NEW` spread and each MUST begin with its own inner `...BASE_NEW.<lang>`
  spread or every BASE_NEW fill silently shadows to English with nothing red
  (QA-verified all 8 current blocks do; the per-locale coverage test in
  masterwrought_cap.test.ts guards only the two masterwrought keys; a durable
  whole-DICT passthrough guard is a hardening candidate beside the S3 one);
  `tests/anim_pipeline_hunter_ghost.test.ts` is red AT the
  v0.36.0 release tip (inherited, files byte-identical), fix belongs upstream.
- Design notes recorded by QA (behavior as shipped, not defects): auto-equip passes
  empty ignoreSlots to the family check (mirroring the unique-rule precedent), so at
  the cap a lootable in-slot UPGRADE is silently declined where the explicit equip
  path would swap it; a player report of "my Masterwrought upgrade stopped
  auto-equipping" is designed behavior. An OVER-CAP legacy character cannot swap
  WITHIN the family at all (ignoreSlots exempts one worn slot, two others still meet
  the cap), so a three-piece legacy loadout is frozen until the player unequips down
  to the cap; acceptable for v1, flag for a ruling if legacy telemetry says otherwise.
  MasterwroughtConflict.slot is production-write-only (consumers branch on reason);
  kept for symmetry with uniqueEquipConflictSlot and future swap affordances.

## Phase 02 ledger (pattern items; two reviewed fix rounds applied 2026-08-07)
- Representation decision: a REAL new ItemKind 'recipe' via a dedicated RecipeItemDef union
  member carrying a REQUIRED teachesRecipeId (types.ts; OtherItemDef excludes 'recipe' so a
  pattern def cannot omit it). Rationale over the cheaper use.type-variant route: kind drives
  the tooltip label, junk-sell exclusion, material-taxonomy exclusion, stacking (patterns are
  in UNSTACKED_KINDS, one per slot), and the market browse bucket; a use-variant on junk/tool
  would need per-site special cases at every one of those by phase 11. Patterns join the
  market 'other' bucket (dedicated chip is phase 11's call; one-per-slot means the chip case
  strengthens as pattern count grows).
- Gate decomposition RULING: no profession-membership concept exists anywhere in the sim
  (mastery_reset seeds every ring craft at 0; resolveTrain has no wrong-profession arm), so
  the spec's three gates land as already-known (isRecipeKnown) -> profession-not-practiced
  (craftSkills value 0) -> tier-unmet (the shared teachTierMet). Deliberate divergence, on
  record: a trainer can teach a never-practiced character a tier-0 recipe; a pattern requires
  the craft to have been practiced. Deny order mirrors resolveTrain replay discipline;
  invalid content (unresolvable teachesRecipeId, or a recipe without 'drop' acquisition) is a
  SILENT no-op, guarded by the content-shape sweep below. The learn path draws zero rng.
- Learn flow: src/sim/professions/pattern_items.ts (pure resolvePatternLearn + apply arm
  behind SimContext), dispatched from the useItem kind chain BELOW the dead gate (use while
  dead is a silent no-op; usable in combat and while swimming, the potions precedent, on
  record). acquireRecipe gained its first real caller (source 'drop'); consume is exactly one
  copy by the dispatch itemId, only after acquire ok. Success emits the existing text-free
  trainResult ok event (the HUD logs training.learned and the TrainLearnTracker confirmed
  overlay flips the train row Known); NO lastTrainResult write (that stays the train-command
  probe, pinned by identity) and NO event on refusals (they are ctx.error-only, or the deny
  would double-print). Known consequence, fails closed: a pattern learn transiently
  over-reserves that recipe's trainer fee in availableTrainCopper for one broadcast.
- New i18n keys + matcher rows: error.patternKnown 'You already know that recipe.' (fills
  copied VERBATIM per locale from resolved hudChrome.training.alreadyKnown so hover and click
  agree byte for byte), error.patternProfession 'You have not practiced that profession.',
  error.patternSkill 'Your skill is too low to learn that pattern.'; all three placeholder
  free (EXACT self-registration, no RULES rows), real fills in every non-en locale block
  across BOTH dict tables (BASE_DICT in sim_i18n.ts plus BASE_NEW in sim_i18n.newlocales.ts),
  en_CA on the English floor, each emit its own single-line
  ctx.error (S3 coverage PROVEN by a byte-mutation probe; the professions directory glob at
  the corpus assembly covers pattern_items.ts, no explicit entry needed). English vocabulary
  mix is deliberate: you KNOW a recipe, you HOLD a pattern. hudChrome.pattern.teaches 'Use:
  Teaches you how to craft {item}.' with its M16 non-Latin fills, the remaining Latin
  overlays pending for the release fill. itemUi.kind.recipe 'Pattern' English plus one-word
  fills in every full overlay IN-CHANGE (deliberate deviation from English-only: keeps each locale's
  pattern-word consistent with its sim DICT refusal rows; the release fill should still
  REVIEW those words). Register clash inherited verbatim in three locales (de_DE Sie vs du,
  pl_PL plural, tr_TR formal): reconcile at the trainer key during the release fill, not here.
- Tooltip: pure core src/ui/recipe_pattern_tooltip_view.ts (UI_PURE_CORES registered) + a
  thin kind-gated hud branch (craftingIdentity read gated on kind === 'recipe' for hover
  cost). Teaches line gates on the SAME drop-acquisition predicate the resolver uses (a
  non-drop pattern renders nothing, so the hover never advertises a click the sim refuses),
  suppresses requirement/known lines while !synced, and the requirement met-state mirrors
  BOTH sim gates (practiced && tier band via tierForSkill). Reuses skillReqLine and
  training.alreadyKnown; known-state reads craftingIdentity.knownRecipes. Residual preview
  gap, on record: a skillReq-0 pattern for a never-practiced viewer previews nothing while
  the click refuses; no such content exists or is planned. Icons: recipe kind renders the
  parchment/scroll family, arm placed ABOVE the substring fish-name arm (two-sided pin).
- New IWorld members: NONE (tooltip reads the existing IWorldProfessions.craftingIdentity
  incl. its synced flag; the use round-trip rides IWorldInventory.useItem and the cprof
  delta; parity pin untouched). No wire, server-handler, or SimContext changes.
- New item ids: none (synthetic test_pattern_ ids injected at runtime only; frozen-id golden
  untouched). NO shipped content carries kind 'recipe' yet: every arm this phase adds is
  reachable in play only when phase 11 authors patterns.
- New tests: tests/recipe_pattern_items.test.ts (learn/consume both hosts incl. the real
  'use' wire command, routeEvents fan-out of the trainResult event, cprof + ClientWorld
  mirror; three refusal literals with items intact; tier boundary both sides; deny-order pin;
  silent invalid guards; dead-gate placement; zero-rng observer; real marketList; unstacked
  one-per-slot; order-insensitive 'other'-bucket pin; lastTrainResult identity pin; DICT.en +
  20-locale coverage; the vacuous-today content-shape sweep requiring teachesRecipeId to
  resolve AND the recipe to carry 'drop', with a companion pin holding the synthetic skip
  honest); tests/recipe_pattern_tooltip_view.test.ts (model/lines, dual-shape Sim +
  bareClient projections, synced and acquisition arms, sub-tier profession-gate arm both
  ways, real Hud.itemTooltip reachability); extensions to item_icons, item_kind_line,
  item_name_color, bags_view (transfer-mode matrix against literals), bag_filter (ALL-only),
  crafted_item_tooltip_coverage (pure-builder EFFECT_SOURCES row + compose pin).
- Traps recorded for later phases: ALL_RECIPES exists twice, content/recipes.ts is the array
  recipeById scans and data.ts re-exports a COPY, so tests must push the content array; the
  sim DICT is a literal-key union, so a test reading DICT.en['error.x'] is a COMPILE error
  until the matcher row lands (cross-arm coupling); adding 'drop' to a previously
  acquisition-less recipe flips isRecipeKnown from known-to-all to must-be-learned, so never
  retrofit 'drop' without grandfather care.
- Phase 11 obligations from this ledger: every authored pattern's recipe must carry 'drop'
  acquisition (the content sweep enforces it and goes live then; add a count floor); rod
  recipes must NEVER gain 'drop' or the rodFeePaid metric needs a fee-bearing discriminator
  (comment at the metric); re-point the tooltip suite's real-recipe silence arm when
  sunpetal-class content gains drops; pattern items need committed icon art or
  ITEM_ART_PENDING entries; revisit a dedicated market/bag chip as pattern count grows;
  author pattern skillReqs ON the TIER_SKILL_STEP tier boundaries or first decide the
  requirement number question (the pattern hover prints the raw skillReq while the trainer
  surfaces print the tier-band floor tierForSkill(skillReq) * TIER_SKILL_STEP; identical for
  every on-step recipe, divergent copy for an off-step one).

## Phase 02 QA ledger (audited 2026-08-07; fix round 6175c95836)
- Audit shape: seven fresh auditors (correctness + a surfaces child, rng-and-golden,
  test-decisiveness, cleanup, architecture-reviewer, cross-platform-sync, qa-checklist) over
  git diff 80d4afd062..b873eac88e on the tree with release/v0.36.0 re-merged (0fc4e544d6).
  ZERO blocking findings; every should-fix and nit applied or recorded below, none deferred.
- Refutations THIS round, both settled with the file open plus a live probe (do not
  re-raise): (1) "pattern_items.ts is not in the S3 corpus" re-raised by a sync auditor who
  read only the hand-kept readFileSync list and missed the socialSourceUnder professions
  glob; settled BOTH directions by live byte probes (DICT row edit reds s3_registered, emit
  literal edit reds s3_registered). (2) "no online-arm test exists": the online describe
  drives the real {cmd:'use'} wire command through GameServer.handleMessage with the
  routeEvents fan-out and the cprof mirror. (3) "the rod-fee invariant is unguarded prose":
  tests/professions_rod_recipes.test.ts pins each rod recipe's acquisition to exactly
  ['trainer']; the pin's message now names the rodFeePaid metric and the server comment
  cites the pin.
- Type hardening: RecipeItemDef now bars `use` and `stackSize` outright (never-fields
  beside armorType/weapon): a use payload would resolve ABOVE the recipe kind arm and the
  click would never learn; an explicit stackSize wins over UNSTACKED_KINDS in stackSizeOf.
  The suite fixtures dropped their casts so tsc guards the def shape; the one union-spread
  casualty (stack_size_tooltip_view's explicit-stackSize probes) narrows to the potion arm
  before spreading.
- New decisive pins this round, each proven by a live mutation probe (restore by EDIT,
  never checkout): the grandfathered no-acquisition fixture on BOTH suites (sim silence +
  copy intact + invalid-before-already_known on the real path; tooltip model null; reds a
  dropped optional chain on either side), the hover-click cross-check matrix (model.skillMet
  vs resolvePatternLearn cell for cell; reds a raw-compare teachTierMet), positive controls
  on the zero-rng observer plus a draw-free sweep over EVERY refusal arm (red on a neutered
  Rng observer), and the def-level tradable-drop sweep (quality not 'poor' because
  junkSellableSlot gates on QUALITY not kind; no soulbound; no noMarketList; vacuous today
  like its siblings, live the moment phase 11 ships a def).
- Kind-sweep completeness: 'recipe' joined the two stale every-non-quest-ItemKind lists
  (tests/bag_quest_mark_view.test.ts, tests/quest_item_tooltip_view.test.ts); the phase had
  updated the other two sibling lists, these two were the missed pair.
- Rulings recorded (settled, do not re-raise): patterns are NOT hotbar-placeable (comment at
  isHotbarItemId beside the reins rationale: a one-shot unlock would leave a dead button
  after its first press; elixir precedent); discard of an unlearned pattern stays the
  generic confirm (patterns are ordinary tradable items, the escalated confirm keys on
  instance payloads, classic-correct); PatternLearnResult stays exported with zero external
  consumers (it names the public resolver's return type, the training.ts TrainResult idiom);
  removeItem-by-dispatch-itemId vs def.id is unpinnable without an unshippable
  table-key-vs-def-id mismatch fixture (recorded, no change); the frozen-id golden
  (tests/shipped_item_ids.test.ts over shipped_item_ids.golden.json, a .json golden a
  .snap-only search misses) is a DELETION guard only, so "no shipped pattern ids" is
  actually held by the zero kind:'recipe' content greps plus the content-shape sweep,
  not the golden; the stale_client_rollout snapshot is a separate golden scoped to
  HEROIC_BOSS_LOOT and does not cover the catalog either.
- Docs/comment corrections: the Key existing seams recipes row (the phase itself
  superseded its zero-users/no-kind premise); the professions CLAUDE.md module map gained
  its pattern_items.ts row; the hud.ts tooltip gate comment now says WHICH host pays the
  craftingIdentity rebuild (offline Sim; the ClientWorld read is a mirrored field); the
  defense-in-depth !learned.ok comment now says unreachable today; the
  isGatheredProvenanceKind docstring places kind 'recipe' outside the signed universe; the
  market_query 'other' comment cites where the recipe arm is actually pinned; train_view's
  not-trainer-taught comment notes the mechanism now exists while content does not.
- Phase 11 obligations ADDED by this QA round (beyond the build ledger's list): decide
  vendorCountForced for a vendor-sold pattern before one ships (the count row would show
  5x/10x; surplus patterns are tradable unlike reins, so it is a decision, not a copy of
  the mount arm); scripts/mediawiki/build_seed.mjs interpolates raw item.kind into wiki
  prose and categories, so the first shipped pattern needs kind-aware wording there; add
  the 'recipe' census row to tests/material_taxonomy.test.ts when content lands (adding it
  now would red on the empty catalog); extend tests/stack_size_tooltip_view.test.ts's
  UNSTACKED-kind probe with a shipped pattern id then; icon art remains a hard landing
  blocker (ITEM_IMAGE_IDS auto-enters every non-weapon id and ITEM_ART_PENDING is
  deliberately empty, so a shipped pattern with no art 404s and reds item_icons; the
  procedural parchment arm serves only ids parked in ITEM_ART_PENDING).

## Phase 03 ledger (IP naming sweep; audited and renamed 2026-08-07)
- Scope executed per phase-03-naming-sweep.md: 2846 name rows / 2605 unique shipped
  proper nouns enumerated programmatically (33 domains) and web-verified by a 20-agent
  ultracode workflow (19 shards + the registry) against the WoW/RuneScape/FFXIV/GW2/ESO/
  Diablo/PoE wikis, then an adversarial verify pass (two lenses per flagged name) and 4
  hunter re-sweeps of the CLEAR set. Final dispositions: 52 RENAMED display strings, 15
  maintainer borderlines (recorded, not renamed), 92 flagged-kept, 290 CLEAR, 2157
  GENERIC. Every verdict, with evidence and the applied bar, is in naming-audit.md (the
  acceptance deliverable); replacement names were themselves web-verified (8 first
  candidates were taken; verified alternates adopted).
- The rename protocol per rename: content def + English catalog moved together;
  sim_i18n matcher rows in the same change (the Vandric dialogue RULES regex + the
  Wintergnaw aura rows; single-line emits preserved); the 5 non-Latin overlays refreshed
  with REAL translations of the new name (several old rows were the other game's
  OFFICIAL localized coins: zh 十字军打击/迅捷治愈/神圣新星/乘胜追击, ko 성전사의
  일격/신성 충격/폭풍 망치/마법 훔치기, ru Ледяные жилы; the knight-lieutenant
  renderings among these, the phase's Banneret set, were themselves replaced wholesale
  at the v0.36.0 merge by the release's Fieldreaver renderings); stale Latin overlay rows
  stripped to pending (720 rows at phase close; 694 after the v0.36.0 merge refill, see
  obligation 1) for the release fill; semantically-still-valid
  non-Latin renderings deliberately KEPT (87 rows: zh 绞湖镇/古辉镇/霜鬃/雾铸/墓花 etc.,
  recorded as intentional); guide regenerated; new literals pinned in
  tests/originality_renames.test.ts ("phase 03" describe); old names armed in
  tests/ip_scrub.test.ts HARDCODED_VERBATIM + a NAME-MAP amendment section (40 id rows:
  the phase's 37, which encode 36 unique old-to-new pairs since Winterbite maps to
  Wintergnaw at two ids, plus the three QA-round rows: the Fieldreaver supersede, the
  Pitfire Citadel rename, and the dead Hellfire Brand strip).
- Parity: 5 goldens legitimately shifted (frost_proc_orb, warlock_pet, pet_commands,
  talents_progression, warrior_row_capstones); re-minted via UPDATE_PARITY=1 and proven
  display-only by the rename state proof with the NEW slice-scoping mode
  (RENAME_PROOF_SECTION="MASTERWROUGHT PHASE 03"; the proof harness previously reversed
  the WHOLE locked map + C2 pet ids, which only works for the original pivot wave; the
  scoping change is documented in tests/parity/rename_state_proof.test.ts). The golden
  token inspector passes with 0 violations under --allow-state-hashes (proof-gated).
- Residual-coin strip (pre-rename commit 6e93deadc1): the v0.29.0-era locale fills had
  reintroduced 91 collision-carrying overlay rows across 11 Latin locales after the
  c55bf057c2 rename (de_DE Arkanit/Silberblatt/Thoriumerz officials; fused
  Arkanit/Arcanite/Arcanita loanwords; it_IT Fogliaargento/Polvere Arcana; 17 collision
  prose rows); stripped to pending.
- RELEASE-FILL OBLIGATIONS recorded for the i18n-locale-fill pass: (1) the 720 Latin
  rows this phase stripped (they list under pending; 694 remain after the v0.36.0 merge:
  the release's honor-title re-cut refilled the 26 pvp_honor_knight_lieutenant name and
  title rows across the 13 Latin deed locales with real Fieldreaver translations);
  (2) the 219 stale-calque item rows
  + 23 calque prose rows from the OLD rename wave (translations of pre-rename names, no
  foreign coin; per-locale list in the residual audit, tr/vi/cs/da/nl/pl/sv/id/it/fr/es
  worst); (3) talent_i18n Latin values for the four renamed rows (Victor's Surge,
  Thunderhurl, Zealwing, Spiritcall) carried over as closest-translations, REVIEW at
  fill; (4) deed_i18n Latin rows stripped for the 5 touched deeds (64 rows at phase
  close; 38 remain, the v0.36.0 merge refilled knight-lieutenant's 26); (5) the
  ru_RU chr_nightbloom_first_cast DESC row is pre-existing romanized junk ("Poymay
  rybu..."), name row fixed here, desc left for the fill; (6) sv_SE split-vintage rows
  and the register-clash trio (de/pl/tr) remain from earlier ledgers.
- Maintainer borderlines recorded in naming-audit.md. CLOSED 2026-08-20 by the maintainer,
  NARROWLY: rename the profession-related name, leave the world alone ("if these are zones
  like map zones, let's not mess with that. Let's just stick to profession related stuff").
  RENAME IN THIS PACKET, Phase 16: the 'Enchant <Slot> - <Stat>' scheme, the only
  profession-related entry (verbatim WoW formula trade dress on ENCHANTING content).
  DO NOT RENAME, no phase may touch them: the zone families and the timing-parallel coins.
  Those are world identity, not professions; all were BORDERLINE not infringing, several
  plausibly predate the other property, and a shipped-zone rename cascades through zone
  identity, POIs, quest text, the map, the wiki, the guide and every locale. Highwatch and
  Moonrest were REFUTED and stay. No follow-up rename packet exists or should be scheduled.
  Full record: the "Recorded for the maintainer" section of naming-audit.md, and row 114.
  The original borderline list, for reference: the zones The Amberfall / The Frostveil Reach / The Nightbloom, the Galecrest
  zone family (verifiers confirmed Stonemaier's Libertalia: Winds of Galecrest coined
  the word), the Highwatch town family (refuted as TERA-distinctive), the Voidscar zone
  family (WoW Midnight's Voidscar Arena is contemporaneous; ours shipped 2026-07-07),
  Moonrest, the 'Enchant <Slot> - <Stat>' formula scheme (verbatim WoW formula names;
  scheme-wide convention call), and the timing-parallel coins Brutok / Brother Halven /
  Aetherwell / Gravelight / Emberkin.
- Known intentional keeps that will look like misses to a future auditor: Chain Heal,
  Blazing Barrier, Ice Lance, Fingers of Frost, Bladestorm, Barrow Wight (1869
  folklore), Hat Trick Hero, Anger Management and the other idiom/multi-property rows in
  naming-audit.md "Notable keeps"; do not re-raise without NEW evidence.
- Phase 03 QA: v0.36.0 merge audit (merge ed51716964; 9-agent sweep, 32 findings, all
  triaged). Fixed on the branch: the honor-title supersession (docs above), three
  release-side old-name reintroductions (shaman attackByAbility comment block,
  frozen_orb_fx describe title, shaman anim spec-name comment), the recipe kind ranked
  into the release's new inventory_sort ladder, the eastbrook seals re-minted on the
  merged tree. Recorded UPSTREAM follow-ups (release-owned, out of this branch's scope,
  do not fix here): server/pbe_boost.ts fillHands still hardcodes the pre-quiver
  displacement rule (and tests/server/pbe_boost.test.ts:196 pins the old behavior);
  tests/visual_manifest.test.ts wildheart re-cut reads donor GLBs twice with a stale
  comment; tests/delves.test.ts:1226 + tests/honor.test.ts:210,234 titles still say UTC
  day while bodies drive resetDay; the release's hudChrome.fct.absorbed reword left all
  18 translated overlays stale (the reword-staleness blind spot: rows are translated,
  not pending, so no gate or worklist lists them). PACKET follow-ups: the branch-added
  tests/recipe_pattern_items.test.ts db mock (like the release's wire-cadence siblings)
  carries fewer './db' keys than the canonical shape and stays green only while its
  paths avoid them; the masterwrought suites (masterwrought_cap, recipe_pattern_items,
  recipe_pattern_tooltip_view) predate the EMPTY_TEST_WORLD gate-perf trim and could
  adopt it with per-suite validation.
- Phase 03 QA round 2 (the QA fan-out over the phase + merge, 4 auditors + the
  cross-platform-sync and qa-checklist reviewers; 25 + 3 + 6 findings, all triaged,
  every fix applied). BLOCKERS found and fixed: the rift set-piece pool composed 'The
  Hellfire Citadel' (WoW verbatim, same role) for 1 in 4 seeds, renamed to Pitfire and
  pinned over pool AND composed surface; four Latin overlay rows still carried Wyrmcult
  verbatim (id_ID x3, nl_NL fused), fixed in place per the sibling-row precedent; the
  zh_TW/ja_JP sim matcher frostbite renderings were swapped (review-round regression),
  unswapped. Also applied: legacy aliases for the two wire-carried renamed strings
  (Winterbite, the Varric delve line; the Venomfire precedent, drop after v0.36.0),
  Spiritcall's five non-Latin talent renderings, the dead Punishing Blows talent rows
  (Crusader Strike coins) and the dead detonateHellfireBrand key stripped, the inert
  abilities.ts locale arms refreshed, wrapped-comment and living-doc stragglers swept.
  NEW GUARD: tests/overlay_ip_scrub.test.ts (coin denylist over every non-English
  overlay/deed/matcher value + per-locale script-family checks, locale sets derived
  from the live registries; both blockers proven red under it by mutation probe, and
  the originality pin proven decisive the same way). Cleanup-phase notes: the three
  dead detonate siblings (PactSeal/BloodRite/PitSentence, no coin); the pre-phase
  shaman-kit old-name residue in comments and test fixtures (~20 files, earlier rename
  wave, none player-visible); talent_i18n Latin semantic staleness for
  Thunderhurl/Zealwing stays under obligation 3; the abilities.ts inert per-locale
  arms (dead code, the overlay layer wins assembly) still carry roughly 143 stale
  renderings per non-Latin locale from the EARLIER rename tracks; QA refreshed only
  the six phase 03 coins, so the block is a strip-or-refresh cleanup candidate.
- Phase 03 QA round 3 (the fresh reviewer over the fix round, per the phase QA file):
  9 findings, all applied. The overlay guard gained RAID_EXTRA (was unscanned), the
  six missing phase 03 coins (Holy Shock, Swiftmend, Nightkin, Varric, Okku,
  Moonwell), derivation canaries + non-zero scan counters (the toEqual([]) no-op
  hole), a hard fail on a missing per-language matcher table, and reverse
  script-family rules for the Latin locales; the Hellfire Citadel arm joined the
  ip_scrub teeth fixture (36 entries); the two deploy-window aliases got pins beside
  the Venomfire precedent; the NAME-MAP QA rows moved their annotations to a footnote
  so the bare flags arm.
- Standing rule codified per the maintainer's mid-phase instruction: every NEW
  player-visible proper noun is IP-checked at authoring time in the same change (root
  CLAUDE.md content bullet + src/sim/content/CLAUDE.md "Naming originality" section).
- Traps hit this phase, on record: the locale transformer is NOT idempotent (a second
  pass re-strips Latin rows it already swapped; recovered by resetting locale files to
  HEAD and running ONE fresh pass); ability display names live at ids that do not match
  (vanish='Smokefade', counterspell='Spellsever', blink='Flitstep', avenging_wrath=
  'Zealwing', ice_barrier='Frostveil'); the mediawiki seed (mediawiki/seed/pages.xml)
  has NO freshness gate and now carries pre-rename names (staleness predates this phase
  for the c55bf057c2 wave; regen is `npm run wiki:seed`, deferred with the phase 11
  build_seed.mjs obligation); sim_i18n.ts:8240's 'Venomfire Vigor' legacy alias ("drop
  after v0.29.0") is overdue dead code, left for a cleanup phase.
- Phase 03 review round (cross-platform-sync + qa-checklist, both COVERAGE-prompted;
  the QA verdict was NOT READY on one blocker, all items resolved in the fix round):
  FIXED: four em dashes on renamed lines (zone3 quest text x2, a zone3 comment,
  build_seed.mjs) that the range-diff copy scan would have counted as added; two
  Victor's-Surge escape artifacts in sim comments; 12 stale aura.frostbite sim DICT
  locale rows (they still translated the ORIGINAL 'Frostbite'; now render Wintergnaw
  per locale, matching the skin's renderings); the hud.css Rimeneedle comment and the
  asset-pipeline weapon_vfx.js viewer copy (the rename driver only filtered
  .ts/.mjs/.md/.json, missing .css/.js: extension gap on record); two plural 'Frozen
  Orbs' comments the word-boundary replace missed; public/ui/*/mapping.json art
  provenance records (25 token swaps; public/ is deployed verbatim, so old coins there
  were live IP surface); README.md + the 20 docs/i18n mirrors' 'Deacon Varric'
  (proper-noun swap only, no translation touched); the mediawiki seed regen was ATTEMPTED and REVERTED: npm run wiki:seed produces a
  coin-free seed, but re-baking the zone prose re-adds 95 grandfathered em-dash lines
  as new lines and the pre-push/CI copy scan does not exclude mediawiki/, so the regen
  is blocked until a content-prose dash chore lands; the seed stays stale-on-record
  with the phase 11 build_seed.mjs obligation (and still has no freshness gate,
  hardening candidate); the naming-audit 2605-vs-2606 count reconciled (the +1 is
  shard 10's un-articled 'Wildheart Basin' duplicate row).
  RECORDED, pre-existing, not this phase's regressions (QA follow-ups for a cleanup or
  QA phase, do NOT re-raise as phase defects): last-write-wins reverse-map collisions
  in sim_i18n (Raised Bonewalker, Rime Elemental, Aether Surge, Patch Up); ability
  def-vs-catalog English divergence (shadowform def 'Gloamveil' vs catalog 'Gloamveil
  Form'; meteor def 'Meteor' vs catalog 'Skystone': fixing shifts parity goldens, needs
  its own proof round); the family-wide rift mechanic-name matcher gap (Pitsteel Sweep,
  Pitfire Ring, Hoof of Ruin, Wing Buffet and siblings render raw English in all
  locales; closing it means new aura.* keys + 20-locale fills per name); the positional
  item catalog (ITEM_ENTITY_IDS vs name array, length-checked only) wants a
  derived-or-pinned guard; the rename state proof is env-gated so CI never runs it
  (hardening candidate); release-tier pending=0 stays red by design until the fill.
- Phase 03 pin-audit round (test-coverage-auditor, applied in 6b90a3d908) + gate
  fallout (17e5934a8c): the auditor proved two ip_scrub arms DEAD (the scanner never
  walked deed names/reward titles or graveyard labels; Sanctum Sprint,
  Knight-Lieutenant, and Eldershine Rest were guarded only by literal pins) and two
  renames UNPINNED at their source (sim DICT aura.frostbite English row, the armory
  catalog skin literal): both scan surfaces added, all pins added, POI pins now
  resolve by frozen poi id, and a new teeth test replays every phase 03 old name so
  an inert hardcoded arm fails the gate. The rename state proof gained a scoping
  self-check plus the committed-slice invocation recipe (base = the mint commit's
  parent 233bd5bed0~1, NOT HEAD~1; re-run green 7/7 post-commit). The stale-tree gate
  run also surfaced the zh_CN mount-name pin (CJK literals need their own pass beside
  the English-token driver; sweep found exactly one) and the eastbrook polish
  fingerprint (folds renderer.ts; re-minted via its own script, stale-pin verdict
  applied). GATE INFRASTRUCTURE GOTCHA hit twice: the turbo i18n:gen task cache is
  SHARED ACROSS WORKTREES in the main checkout and its input list omits
  src/sim/content plus the sim/server DICTs, so a warm cache replays stale resolved
  bundles the local regen cannot reproduce; run the gate with TURBO_FORCE=1 on this
  branch until the input-list fix (on feature/bank-storage) merges. Memory updated
  ([[turbo-i18n-gen-stale-dict-cache]]).
- Phase 03 close: the full-suite gate went green at tip 1bcb55ae75 (gate_select with
  TURBO_FORCE=1: 2341 passed / 10 skipped, zero red). The last two fallout commits:
  the accepted-art provenance manifest took the same 36 token swaps its paired
  public mapping.json files did (missing_painted_icons_wave holds them byte-equal),
  and the eastbrook artifact-integrity suite's three remaining pin literals were
  applied from the re-mint script's printed values (its town source fingerprint
  untouched per the script's own warning).

## Phase 04 ledger (materials backbone; built 2026-08-08)
- Pre-flight release sync: merge b84d5f0b1b took the moved v0.36.0 tip (81804a179e,
  the two wiki-refresh PRs; only conflicts were four generated i18n bundles, resolved
  by regeneration). The release-merge audit found ONE drift no shipped guard could
  see: the release's new landing-grid zone teaser (guide.home.world.hauntBlurb) was
  authored pre-rename, so the merged tree said Gallowmere (en plus fresh ja/ko/ru
  transliterations; the zh rows already matched because phase 03 kept the descriptive
  绞湖镇 rendering). Fixed in 4c52eda7db and the three release-minted transliterations
  (ガロウミア / 갈로미어 / Гэллоумир) armed into tests/overlay_ip_scrub.test.ts so a
  future release fill cannot reintroduce them. The merge also brought two NEW guide
  gates that later guide-prose phases must satisfy: tests/guide_key_coverage.test.ts
  (every guide.* catalog key must render on a guide surface) and
  tests/guide_level_cap_drift.test.ts.
- New item ids (FROZEN from this commit on): wyrmfall_core (kind junk, quality rare,
  stackSize 20, sellValue 50, freely tradable and market-listable per R2's catalyst
  design; in ALLOWED_UNCLASSIFIED_JUNK until the first apex recipe classifies it,
  move it out in that change), sundered_essence and makers_ember (soulbound tool
  tokens on the heroic_mark shape: quality epic, stackSize 20, sellValue 0,
  noDiscard). All three ship the per-item obligations: original 128px SVG-rasterized
  WebP icons (woc_original_svg mapping rows + CREDITS.md line) and the five non-Latin
  name fills (坠龙核心/斷裂精華-family renderings matched to the shipped
  arcane_essence / rift_essence vocabulary).
- Faucet decisions (recorded numbers): boss faucet rolls ONE ctx.rng.int(1,3) per
  credited eligible final-boss kill and every participant of that kill shares the
  rolled count; eligible kills are the HEROIC instances (five-mans + heroic raid,
  the awardHeroicMarks set) plus the raid at normal difficulty; the income gate is
  the per-character per-source reset-day window (source key dungeonId:difficulty),
  NEVER the lockout (the raid's kill-time lockout also strikes door-campers, and
  the daily gate is what R9 mandates for rifts anyway). Delivery mirrors the marks
  split: present at corpse to bags, entered-but-absent by raven (new letter
  wyrmfall_core_reward, sender the Heroic Quartermaster, system parcel, never
  expires), roster-only unpaid. Rift arm: A/S rank FIRST clears only (claim.event
  present), deterministic and draw-free, A pays 1 and S pays 2, once per character
  per reset day across all rifts under the shared 'rift' source token. Quartermaster
  catch-up row: { itemId: 'wyrmfall_core', marks: 12 } (the ring price point,
  deliberately a bad-luck backstop rather than an alternative farm; revisit at
  phase 15 power verification).
- Maker's Ember decisions: the weekly boundary is DERIVED from ctx.resetDay by pure
  civil-date integer math (Howard Hinnant days_from_civil, no Date/Intl anywhere):
  emberWeekAnchorOf = the most recent TUESDAY (EMBER_WEEK_RESET_DOW = 2, the classic
  weekly reset day) on or before the reset day, so the realm keeps exactly ONE reset
  clock and the phase's stopping rule (no new clock) is satisfied without stopping.
  First eligible completion ever grants 1 (no realm-age windfall); after that every
  elapsed week since the last granted week banks one more, UNCAPPED per R4 (a
  vetoable ruling: a returning character gets weeks-elapsed embers in one grant).
  Eligible completions = exactly the core faucet arms plus rift A/S clears on BOTH
  race outcomes (losing the race forfeits cores, not the keystone: mercy, not a
  race prize). Ember grants to PRESENT participants only; absent participants lose
  nothing because the accrual banks their week for the next completion. A stored
  anchor AHEAD of the current week (rolled-back realm clock) grants nothing and
  self-heals.
- Extraction decisions: sundering (SUNDER_CAST_ID 'sundering', in isNonSpellCast)
  rides the enchant-family session seam (beginEnchantFamilyCast widened; exported
  with clearEnchantCastSession + the two consume helpers from enchanting.ts;
  SUPERSEDED at the phase 04 QA sync: consumeSelectedInventorySlot and the pin,
  now itemCopyPin, live in the release's src/sim/item_copy_ref.ts and sundering
  imports them from there, see the sync ledger), no
  profession gate (the TBC-tailoring access-stacking lesson), eligibility =
  quality epic AND itemFromRaid (the item_level source index; rift legendaries and
  five-man epics excluded by the index itself, currently 14 raid epic ids), yield =
  exactly 1 sundered_essence, deterministic, ZERO rng. The completion ships the
  phase 03 QA amendment's pinned-slot re-check verbatim (disenchantVictimPin
  compare; a mid-cast splice or sort consolidation denies with its own line).
  Victim preference on an unpinned sunder = consumePreferredDisenchantVictim
  (plain copies die first, enchanted last). The bags-full arm of the shared
  admission is defense-in-depth only: an unstacked epic frees its own slot, so the
  refusal is unreachable today and deliberately untested.
- New SimContext members (five-site rule applied, both test stub hosts extended):
  awardWyrmfallCores (death-hub call after awardHeroicMarks; late-bound arrow, the
  N1 idiom), mailWyrmfallCores (PostOffice binding), completeSunderCast (casting
  lifecycle route).
- New IWorld member: extractEssence (IWorldProfessions, method; parity pin re-cut
  to 303 with the five-edit protocol). New wire command: extract_essence
  (COMMAND_NAMES; command_schema counts re-pinned 193/206; dual-shape facade
  signature like disenchantItem; server validates item/slot untrusted). No new
  SimEvent kinds, no new snapshot deltas (grants ride the existing loot event, a
  HEAVY_SELF_EVENTS member; gate state is server-private).
- PlayerMeta/persistence: wyrmfallDaily { date, sources: Set } + emberWeekAnchor
  string; CharacterState optional twins (sources as array), zero-default omission
  on write (the honor idiom) so untouched saves stay byte-equal, defaults on load.
  The parity sampler sees both DIRECTLY (QA correction: canonical() in
  tests/parity/trace.ts EXPANDS Set contents into a sorted array, only an empty
  set drops; the nythraxis golden records the stamped source tokens verbatim, so
  the golden gate discriminates which sources are stamped, stronger than the
  original "divergence surfaces via sampled inventory" claim).
- New i18n: sim DICT rows error.sunderTarget/sunderHeld/sunderMoved (EXACT) +
  log.sunderResult (RULES, {item} via locItem) filled in ALL 20 non-en blocks
  across BOTH dict tables (the busy refusal deliberately has NO sim row: the
  hud's own localizeErrorText map wins for 'You are busy.' first, see the
  round-2 record); the sunder /casting readout joins the V07 English-backstop
  registry (scripts/i18n_blocked_seed.mjs); hudChrome.itemMenu.sunder +
  hudChrome.enchanting.sunderConfirm{Title,Body,BodySpecial} +
  abilityUi.cast.sundering with M16 five non-Latin fills;
  entities.items.*.name fills x3; entities.letters.wyrmfall_core_reward.* fills x5.
  Latin overlays for all of these ride the release fill as usual.
- UI: the bag context menu gained the Sunder row (bag_item_context_menu pure core
  isSunderable arm; destroyConsumesSpecialCopy widened to the sunder action sharing
  the disenchant skip-enchanted order; bag_item_action_menu confirm through the
  shared destroy-confirm family passing the pinned slotIndex); the cast bar and
  craft-cast audio cue arms cover SUNDER_CAST_ID.
- Parity: deliberate re-mint in its own commit (d1ec91228c) with the movement
  characterized: 59/60 goldens changed only in sampled state shape; exactly
  nythraxis_full_pull moved rng digests (the appended raid-kill count draw) and its
  golden records wyrmfall_core in the discovery ledger.
- New tests: tests/masterwrought_materials.test.ts (26 cases at phase close;
  the review rounds and the QA fix round grew it, the suite itself is the
  count of record: week math incl.
  month/year edges, boss faucet shared count + seed determinism + daily gate flip +
  mail arm + zero-draw refusal arms with a one-draw positive control, rift A/S/B on
  a REAL raced event via spawnNaturalRiftPortal with the event tier pinned,
  ember accrual/no-calendar/rolled-back-clock, extraction success/refusals/busy/
  dead/pin-splice/SORT-consolidation/preferred-victim/cancel, JSONB round-trip +
  legacy defaults + omission pin; the pin re-check and daily gate proven decisive
  by live mutation probes, restored by edit); the extract_essence over-the-wire
  case in tests/professions_enchant_salvage_arc.test.ts (selected-slot pin honored
  by the server, the sunder line on the wire; note the log filter matches the
  'You sunder ' prefix because the join broadcast contains the player name);
  runSunder + the sundering arm in tests/helpers/enchant_family_cast.ts;
  tests/heroic_vendor.test.ts stock pin re-cut (11 rows = 10 gear + the material
  row with its own pins incl. itemLevel undefined); tests/dungeons.test.ts marks
  test re-cut (+2 slots: marks + cores land together); ALLOWED_UNCLASSIFIED_JUNK
  gained wyrmfall_core.
- Phase 05+ obligations minted here: when the first apex recipe consumes
  wyrmfall_core, move it out of ALLOWED_UNCLASSIFIED_JUNK (it derives IN through
  the reagent table); phase 12 (Perfecting) consumes sundered_essence + makers_ember
  and should re-read the yield/accrual decisions above; the phase 14 UX pass may
  want a client-visible daily/weekly gate readout (none shipped: the gate state is
  server-private today), a tooltip line on the core naming its faucets, and a
  dedicated sunder completion cue (the grant is silent + callerLogs, so the sunder
  log line is the only completion feedback today; the cast start plays the
  workbench wind-up).
- Gate + review round 3 (2026-08-08; the fix round reviewed by a fresh
  qa-checklist agent per the standing rule: 0 blocking, 2 should-fix, 1
  obligation, 6 nits, ALL applied or recorded). Applied: the wyrmfallDaily load
  clamp now bounds the blob too (64-char token cap, 32-entry set cap; the field
  sits outside the professions byte ceiling so the load clamp is what bounds
  it, the knownRecipes doctrine; oversized-junk arm added); the death-hub
  placement invariant is PINNED (FINAL_BOSS_TEMPLATE_IDS exported, the suite
  asserts every worldBoss template is outside it with positive controls, so
  "no kill reaches both a wyrmfall draw and a world-boss roll" is enforced,
  not prose); EMBER_ACCRUAL_GRANT_CAP tied to the ember def's stackSize in the
  defs test; two pin-quality fixes (the doubled-A-count arm and the capped-
  accrual anchor now assert literals, not derived values); the ledger's i18n
  bullet corrected (three EXACT rows, not four). Recorded, accepted: the
  sundering completion is deliberately the one silent craft-family completion
  (the #2458 pairing; the dedicated cue stays a phase 14 obligation, already
  listed); the audio-wiring pin family is comment-gameable across all seven
  arms (inherited shape, hardening belongs upstream); the rift rig pins the
  rank through its own baseLevel input (the intended consequence of the
  re-sourcing; RIFT_TIER_INFO derives both faces from one table); the sibling
  heroicDaily.marked load keeps its identical unclamped hole (pre-existing,
  the shared-sanitizer cleanup candidate from round 1 covers it). Also for the
  record: the fix-round reviewer confirmed the ORIGINAL phase commits were red
  on professions_silent_loot (the suite reads the professions directory off
  disk, so vitest-related can never select it; the earlier per-slice "green"
  claims never ran it), which is exactly why the full gate is the phase-close
  floor. QA pointers for the phase 04 QA session: dispatch migration-safety
  over the F1 clamp and test-coverage-auditor over the fix-round pins.
- Gate + review round 2 (2026-08-08; architecture-reviewer 0 blocking / 9
  should-fix / 9 notes, cross-platform-sync 1 critical / 4 warnings, ALL applied
  or recorded; the fix round reviewed by a fresh qa-checklist agent). Applied:
  the death-hub call moved BELOW the world-boss loot block (the old comment
  claimed an invariant false for world bosses; parity green against UNCHANGED
  goldens proves the move draw-order neutral) plus a FINAL_BOSS_TEMPLATE_IDS
  precheck so trash deaths never scan the instance slots; castingReadout gained
  the sundering arm (the raw cast id leaked through the generic fallback tail,
  which also carries the banned em dash) with its V07 blocked-seed row and the
  casting_command case; the craft-cast-id and audio-wiring pins learned the
  sixth family member; error.sunderBusy and its 20 fills DELETED as unreachable
  (hud.localizeErrorText's own EXACT map wins for 'You are busy.' before
  localizeSimText runs; the emit stays, localized through hud.errors.busy; the
  incidental discovery that the same hud arm already covered seven other sim
  busy emits is recorded here); the winning rift arm re-sourced to
  riftRankForBaseLevel (the creditRiftClearDeeds precedent, so the two ember
  arms can never disagree); WYRMFALL_RIFT_COUNT typed against RiftTier with
  EMBER_ELIGIBLE_RIFT_TIERS stated separately (R4 and R9 are independent
  rulings); the ember anchor load normalizes through emberWeekAnchorOf (an
  off-anchor or garbage stored value can no longer stall the weekly grant);
  the letters.ts reorder restored the marks comment to its declaration; sim.ts
  moved to the named-Impl import convention; the professions/CLAUDE.md module
  map gained both rows. New tests: both raid arms named (normal pays cores with
  no marks; heroic pays through the tuning row), the door-camper exclusion
  (no cores, no letter, gate unstamped), the no-instance world-boss shape
  (zero draws), the off-anchor load normalize, and the losing-race ember end
  to end (two racing instances, loser gets the ember and no cores). Recorded,
  accepted as-is: the instance scan still runs once in awardWyrmfallCores and
  once in awardHeroicMarks on a final-boss death (deduping means changing the
  release-owned marks signature; the template precheck removed the cost that
  mattered, the per-trash-death scan); the Heroic Quartermaster signs the
  normal-raid core letters too (one materials postman, noted at the letter);
  isSunderable's first bag right-click pays the one-time itemFromRaid index
  build (the isDisenchantable precedent); dev-portal rift clears pay nothing
  and the RL env sees a one-shot faucet (both now stated in the module
  header). The xplat report also confirmed: no wire mirror needed for the two
  meta fields (the heroicDaily precedent), extract_essence correctly outside
  COMMAND_FACETS (the enchanting-family rule), and no phase 04 key in any
  release-tier failure.
- Phase 04 QA release sync (2026-08-10, merge f75f5611c9; the QA audit itself
  had not started when this landed). Re-merged origin/release/v0.36.0 (1151
  commits: the paladin, priest, warlock, druid, and rogue reworks, the CC band
  system, the selected-slot item_copy_ref wave, the item-art consistency
  repaint). ~100 conflicts hand-resolved: release structure adopted everywhere;
  the phase 03 registry names re-applied over every release reintroduction
  (Zealwing, Tolling Hammer, Smokefade, Flitstep, Duskmurk, Fleetmend,
  Frostglobe, Rimeneedle, Drakesting, Vaulting Charge, Oathstrike, Spiritcall
  prose), proven by the three naming guards green after regen. ONE supersession
  the other way, the Fieldreaver rule: holy_nova ships the release's own re-cut
  Sunburst Canticle over the phase's Hallowburst (originality pin re-pointed,
  NAME-MAP chain row added, Hallowburst armed). Sundering re-bound to
  item_copy_ref (consumeSelectedInventorySlot + itemCopyPin, the release's
  byte-identical extraction of the helpers phase 04 had exported from
  enchanting.ts; exports for beginEnchantFamilyCast and
  consumePreferredDisenchantVictim kept on enchanting). Equip adopted the
  release's slotIndex arm; bag menu carries both the release's salvage
  slotIndex and the sunder arm. Parity pin composed to 309 members (release
  +5, extractEssence rides on top), command schema to 196 send / 209 dispatch
  (the release's bg_respond and pet pair, plus extract_essence). Parity goldens re-minted (release reworks move
  them; wyrmfall keys and the nythraxis draw ride along), eastbrook provenance
  re-minted via its script, i18n + wiki regenerated (TURBO_FORCE=1).
  Release-merge audit findings: branch seams verified intact (extract_essence
  dispatch in game.ts, heroic_vendor wyrmfall row, sunder matcher rows + V07
  seed row + castingReadout arm, ctx bindings, masterwrought cap machinery);
  the release's new tests/appearance_broadcast.test.ts db mock is safe (the
  branch adds no server/db exports) and green; phase 05 premise files
  (professions/types, recipes, item_budget, item_level, inventory_sort,
  content/professions) untouched by the release, premises hold. Locale-row
  decisions on record: release-added vanish/crusader_strike name rows and the
  cs holy_shock row DROPPED (translations of superseded names, back to
  pending); release swiftmend.name rows KEPT as closest-translations for
  Fleetmend (REVIEW at release fill, obligation-3 style); release's fresh
  rework re-translations (rupture/swiftmend/chain_heal descriptions,
  nightPlaceNotes) kept over the stale copies; abyssalChainDesc demon name
  re-pointed per locale to the mob row's Duskmurk renderings (ja katakana, zh
  暮影, ru declension; ko was already consistent); dead duskborn and
  wraithborn rows dropped. Observed, no action: the release's devotion_ward
  paladin content names 'Devotion Aura' (WoW verbatim) but the coin predates
  this merge at the last sync base and the phase 03 audit did not flag it;
  recorded here so a future auditor sees it was seen, re-raise only with the
  audit's evidence bar.
- Phase 04 QA sync gate fallout (2026-08-10; gate_select GREEN all 8 steps at
  the closing tip after two fix rounds). The full suite surfaced seven
  release-side inventory gates the merge had left unreconciled, all applied:
  extract_essence joined the release's NEW tests/item_copy_addressing_guard.ts
  ADDRESSED_COMMANDS registry (every item command must name its copy or carry
  a written exemption; future item commands owe a row); the Spiritcall rename
  was re-applied to the canonical ability prose (the catalog-side sweep alone
  trips tests/owned_class_tooltip_clarity.ts, which diffs catalog against
  def copy); the paladin skills mapping dropped the release's pre-rename
  duplicate rows and re-synced generated entries from the accepted-art
  manifest (the manifest merged coherent: our names plus the release's new
  references; it is the authority both missing-painted arms compare against);
  the items mapping re-synced three manifest-owned direction texts the
  release's generatedBatches restructure had reverted to pre-rename copy.
  STANDING OBLIGATION MINTED BY THE RELEASE'S ITEM-ART WAVE: every live item
  id must appear in the item-art audit catalog with OPAQUE 128px art and an
  owner-reviewed verdict row; the three material placeholders were flattened
  onto the opaque house ground (they carried alpha corners), reviewed, and
  admitted (counts 822 to 825 / live 837 to 840, verdict + evidence digests +
  test pins re-cut per the class-overhaul-additions precedent) so EVERY
  FUTURE PHASE THAT SHIPS AN ITEM ID owes the same admission in-change. The
  mob portrait source manifest fingerprints the sim+render browser bundle,
  so ANY branch content change stales it: re-minted through its own receipt
  flow (all 230 portraits re-rendered byte-identical; only the fingerprint
  moved) and the placeholder-art ledger's digest pin moved with it; expect
  this re-mint at EVERY future release sync. Also: two release-side
  useOptionalChain lint errors and two merge-produced format drifts cleared
  the changed-files biome floor; the warrior_intervene fix is behavior-equal.
- Phase 04 QA (2026-08-10, the phase-04-qa.md session; verdict recorded in the
  progress.md row). SECOND RELEASE SYNC FIRST: v0.36.0 had moved 246 commits
  (the Reliquary packet, PR 2976, incl. its 10970-row locale fill); merge
  f14b6a4e0a resolved 87 conflicts hunk-level. Sync outcomes: IWorld pin
  composed to 320, command schema to 197/210 (a REAL silent off-by-one: both
  sides read 196/209 pre-merge and git auto-merged the identical constants;
  the release's own NOTE in tests/command_schema.test.ts warns of exactly
  this, suite runs confirmed both pins); 65 parity goldens re-minted (51
  state-shape only, 13 more moved per-frame events hashes each matching
  exactly one parent, only nythraxis_full_pull moved rng digests: the
  branch's appended wyrmfall draw); portrait manifest re-blessed via its
  receipt flow (230/230 byte-identical) with the accepted-art digest pin
  moved; the release fill reintroduced Gallowmere verbatim in ten Latin
  hauntBlurb rows, caught by tests/overlay_ip_scrub.test.ts and swapped to
  Gibbetmere in place. Release-merge audit (4 cluster agents): CLEAN, zero
  dropped behavior (sim cluster byte-identical to the clean three-way; the
  release's movement:true addItem flag is a no-op for every branch grant
  today since no masterwrought id is a catalogued relic; the release-authored
  db-mock factories are structurally partial but complete for their paths,
  the established pattern). QA FAN-OUT: six auditors (correctness,
  gate-abuse, migration-safety on the F1 clamp, test-coverage-auditor on the
  fix-round pins, architecture-reviewer, cross-platform-sync): ZERO blocking
  anywhere; ~12 should-fix + ~14 nits + ~15 records, ALL applied or recorded.
  Fix round (621ad83a36, b9c58930f7, b68b601af6, 9794ece007, reviewed by a
  fresh agent per the standing rule): the winning rift arm's ember now gates
  on EMBER_ELIGIBLE_RIFT_TIERS instead of riding the core table's early
  return (the two-rulings independence was prose before; the widen-and-
  restore probe pins it); both rift arms filter meta.leaving (the boss-
  faucet roster rule; a disconnect in the persistence window silently ate a
  clear); grantRiftClearEmbers takes the instance eventId and refuses null
  locally (the dev-portal no-pay guarantee no longer rests on another
  module's return shape, and the dev portal is pinned end to end on BOTH
  arms); the week-anchor renderer pads the year and bails out of range
  (renderWeekAnchor), making anchor normalization SINGLE-PASS: before, a
  year-below-1000 anchor normalized to an unparseable value that stalled
  the weekly grant for a session before the next load healed it (measured:
  the stall was one session, not permanent; the fix removes it entirely);
  wyrmfallDaily.date gained the 64-char load cap its tokens had (a corrupt
  date re-saved verbatim forever); completeSunderCast gained its sibling's
  empty-session guard and fires onInventoryChangedForQuests after the
  consume (latent: the grant's addItem fired it, but the destroy half must
  not lean on that coupling); items.ts dropped the unused
  equipCandidateIndex import. New decisive pins (each proven against the
  trap catalog): the recorded faucet numbers as literals (1-3 roll, 1:1
  yield, the core def row: the boss range and yield were pure constant-
  self-comparisons, a silent retune passed 268 tests); ember-rides-
  completion (anchor-rewind probe with the core gate closed); present-only
  ember (the raven absentee banks the week); rank re-roll no-top-up; the
  deliberate normal+heroic two-source day on one character; the sunder
  eligibility boundary (raid LEGENDARIES refuse via the quality clause,
  which was deletable with all tests green); the isConsuming busy arm; the
  client extract_essence FRAME SHAPE (slot rides targeted, absent
  untargeted: the ADDRESSED_COMMANDS registry row was proven VACUOUS, its
  220-char sender window bleeds into the next method's comment, so the
  behavior pin is what protects the online path; the guard's client-half
  window is a RELEASE-owned hardening follow-up); a malformed wire slot
  degrades to the unpinned victim order; sundering joined
  tests/professions_destroy_trade_races.test.ts as the fourth destroy
  command (three orders, conservation); the quartermaster material row buy
  path; the two meta fields joined the blob-growth armed fixture + survival
  floor; the nythraxis parity scenario gained a live calendar (resetDay
  set), so the golden now pins the ember anchor and material grants
  cross-host (the sampler saw them in principle but no scenario reached an
  eligible completion; the re-mint moved ZERO rng digests, 78 state digests
  plus one events digest, and minted col_first_epic for all ten raiders:
  the ember is the first epic-quality item to enter bags in that scenario).
  Fix-round review (fresh agent, 0 blocking, 2 should-fix + 3 nits, ALL
  applied): the glossary ru edit was a REGRESSION and was reverted (the
  masterwroughtSystem note cites the SHIPPED masterworkSeal renderings
  verbatim and ru ships the standalone Шедевр; the release's masterwork
  category note now says it cites the lemma), the golden characterization
  corrected as above, the frame pin tightened to toStrictEqual (toEqual
  cannot see slot: undefined), the sunder quest hook moved above the
  consume bail to the resolveDisenchant shape. The qa-checklist phase gate
  (READY, 0 blocking) caught that the phase plan's own trigger owed a
  privacy-security-review dispatch (server/game.ts changed): dispatched,
  verdict CLEAN (0 blocking, 0 should-fix; server authority, IDOR,
  event scoping, secrets, SQL, dev gating, logging all pass; the
  wyrmfallDaily/emberWeekAnchor server-private claim re-verified, zero
  occurrences under server/); its one nit applied (the malformed-slot
  wire test now also sends slot -1 and 4096, the integer shapes that
  pass Number.isInteger and rely on the sim's own bound). RECORDED,
  accepted (do not re-raise): the bagSlot -1 sentinel collision is
  unreachable (admission refuses negative slots before any cast starts)
  and precedent-identical to disenchantItem; the ordering
  half of the death-hub invariant is pinned by the parity golden, not the
  disjointness suite (moving the call above rollLoot reddens parity_g); the
  wyrmfall draw is taken BEFORE the per-recipient gate check, so divergent
  or empty resetDay can change grants but never desync the rng stream (the
  load-bearing determinism property); the rift participants fallback
  ([...inst.memberIds] when the floor region finds nobody) can pay members
  not present, the creditRiftClearDeeds convention; the FINAL_BOSS precheck
  is a perf guard with no behavioral signature (Check 6 exemption); the
  completion-side sunderAdmitted re-check is behaviorally equal in every
  reachable state (probed); sundering ignores instance.boundTo (the
  disenchant precedent); the ITEMS[itemId] lookup is unguarded like its
  siblings (not exploitable); normalRaidFinal's !== 'heroic' arm routes a
  future third difficulty to the normal arm (closed union today);
  itemSourceLevel('wyrmfall_core') = 20 from the vendor bump, inert twice
  over (junk is never equippable, tooltip gates on gear kinds), pinned
  inert in heroic_vendor; EMBER_ACCRUAL_GRANT_CAP can take two slots on a
  partial stack (comment corrected in round 3's spirit, accepted); mail is
  the SECOND never-expiring reward-parcel source (mailHeroicMarks shape,
  ~7 letters/day ceiling); dying mid-sunder is code-verified safe (damage
  teardown clears the session); the mid-cast pin protects cast-start to
  completion, not menu-click to confirm-OK (family-wide, release-owned);
  bags_window forwards a raw -1 stale index where the destroy sibling
  falls back to undefined (family-wide, wrong toast only); itemCopyPin
  does not cover count (unreachable: all 14 eligible ids are stack 1;
  becomes real if a stackable sunderable ships); the capped-backlog
  branch can blank the anchor and re-arm the first-grant only when
  resetDay itself is year 9999 with a 21-plus-week-behind anchor
  (effectively unreachable, the range bail's own edge, on record); a
  leaving-but-entered character's mail-arm gate stamp lands after the
  leave snapshot so that source can re-pay on relog (byte-identical to
  the release's mailHeroicMarks + lockToHeroicClaim exposure, inherited
  and accepted, not a phase regression).
- Phase 04 QA open items and obligations MINTED (append to the working set):
  (1) RULING TAKEN at Phase 05 QA (2026-08-10): heroic-raid epics ARE
  sunderable, aligning with the settled any-raid-epic-of-the-tier model
  (the normal-only boundary was an accident of the item_level.ts
  raid: false registration, not a decision). IMPLEMENTATION LANDS WITH
  PHASE 12, where Perfecting pricing and the widened faucet are tuned
  together: phase 12 flips the eligibility (the registration or the
  isSunderable predicate) AND moves the phase 04 boundary pin in
  tests/masterwrought_materials.test.ts in the same change. Until then
  the pinned normal-only behavior stands deliberately (essence has no
  consumer before Perfecting exists). (2) The Perfecting/apex
  re-mint arm (phase 12) MUST pass movement: true on its re-mint addItem
  (the release's obtain-tally doctrine; no branch precedent shows the
  flag, the doctrine lives in the Sim.addItem header and reliquary.ts).
  (3) The present/absent wyrmfall delivery straddles the movement
  boundary (mail rides grantCopies movement:true, present is a direct
  grant): inert until a masterwrought id becomes a catalogued relic;
  re-check if a Masterwrought reliquary shelf lands. (4) Maker's Ember
  must NEVER become tradable (soulbound is what keeps the uncapped R4
  accrual from becoming a supply vector; standing constraint, stated at
  the def). (5) The core faucet is per-account-unbounded through alts
  (up to eight sources per character per day, tradable output): phase 15
  power-verification input, on record. (6) Release-owned upstream
  follow-ups, do not fix here: the addressing guard's client-half sender
  window is comment-bleed-prone (bound it at the next method like the
  server half); the orphaned sortedJson JSDoc above beginEnchantFamilyCast
  (the item_copy_ref extraction left it); the release-authored reliquary
  db-mock factories are partial (8/12 keys of 26; a future phase making
  join/snapshot call a new db export surfaces there first); the zh locales
  have no armed transliteration patterns in overlay_ip_scrub (they
  translate semantically today, no live gap). (7) The masterwrought
  suites still predate the EMPTY_TEST_WORLD gate-perf trim (carried
  forward). (7b) Epic-and-up MATERIALS trip the first-quality collection
  deeds (makers_ember minted col_first_epic for all ten raiders in the
  parity golden; cosmetic, renown 0): phases 12/13 mint more epic and
  legendary materials and col_first_legendary has the identical shape, so
  decide per material whether a token counting as the character's first
  epic or legendary is intended, and characterize the deed in any golden
  it moves. (8) tests/professions_silent_loot.test.ts reads the
  professions DIRECTORY off disk: vitest-related can never select it, the
  full gate stays the only floor for disk-scan guards (carried forward,
  bit again this session as the M5 mutation-probe noise).
- Gate + review round 1 (2026-08-08). The full-suite gate caught the silent-loot
  registry (#2430/#2458) reaching the new professions modules (the heroic-marks
  precedent lives in instances/, OUTSIDE that sweep, so the phase plan never named
  it): fixed by documenting the four material grants as NO_RESULT_EVENT_GRANTS
  (one marker per delivery arm) and flipping the sundering grant to silent +
  callerLogs. migration-safety review (3 warnings, 3 infos, ALL applied or
  recorded): the two new persisted keys joined NON_PROFESSIONS_BLOB_FIELDS (the
  blob-growth scrape cannot see omission-spread keys, a pre-existing scrape
  weakness it shares with seven older fields); the load path hardened against
  corrupt rows (malformed anchor = permanent weekly stall since unparseable reads
  as same-week; non-array sources = a throw inside addPlayer); the ember accrual
  payout capped at EMBER_ACCRUAL_GRANT_CAP = 20 per completion with the anchor
  advancing only as far as the grant paid (R4's total stays uncapped, the backlog
  stays banked). Recorded, not fixed here (reviewer-verified pre-existing or
  accepted): the sibling heroicDaily/delveDaily loads carry the same non-iterable
  throw exposure (third copy now; a shared sanitizeDailySources helper is a
  cleanup-phase candidate); the 30s autosave saves characters, market, and mail
  as three independent writes, so a crash between them can duplicate or drop a
  mailed-cores letter relative to the gate (same shape as mailHeroicMarks,
  accepted; the leave/shutdown flush is transactional). Deploy note for the PR:
  a rollback to a pre-materials binary drops both keys on load and erases them at
  its next save; roll-forward then reopens the daily gate (bounded duplicate
  income: at most eight sources (six heroic keys incl. the heroic raid, the
  normal raid, the rift token; the original "nine" over-counted), 1-3 cores
  each) and restarts the ember anchor
  (exactly one extra ember, no retroactive accrual); granted items survive both
  legs (unknown-id stacks stay dormant recoverable data).

## Phase 05 ledger (jewelcrafting base catalog, 2026-08-10)
- STATION/TRAINING DECISION (the serial decision this phase owed): every jewelcrafting
  recipe carries an explicit `stationType: 'forge'`; jewelcrafting itself stays OUT of
  `STATION_TYPE_BY_CRAFT` (no new station type, no new trainer NPC). Rationale: (1) the
  only shipped recipes of a station-less craft (enchanting's recipe_artisans_eye and
  recipe_gatherers_cache) chose exactly this shape, foreign-bound to the toolworks, so
  the seam is proven; (2) training derives entirely from the recipe's station
  (trainingStationTypeFor in src/sim/professions/training.ts), so Forgemistress Darva's
  forge teaches the catalog with zero new NPCs, props, layout rows, station i18n, or
  StationType union widening in a content-only phase; (3) thematically the base catalog
  is wrought metal (ores plus smithing flux), and the Bladewright archetype pair already
  couples jewelcrafting to weaponcrafting at the forge; (4) reversible: a later world
  phase can seat a dedicated jeweler's bench (the GLB exists; its Eastbrook placement is
  disposition 'removed') and repoint the recipes' stationType without changing the
  record shape. Cost paid here: the foreign-bound literal pin in
  tests/professions_crafting_hub.test.ts grows the new jewelcrafting recipe ids; the
  craft-absent pin (stationTypeForCraft('jewelcrafting') undefined) deliberately stays
  green; the gossip Crafting-shortcut tie-break reads STATION_TYPE_BY_CRAFT key order,
  which this decision leaves untouched.
- VENDOR FLUX DECISION: the catalog reuses the existing `smithing_flux` (buyValue 20,
  already stocked by Forgemistress Darva at the forge the recipes bind to). The phase
  file authorized adding a vendor flux row if none existed; one does, sold at the right
  station, and weaponcrafting/armorcrafting already share it, so no new staple id, art,
  or vendor row is minted.
- PREMISE CORRECTION (recorded per the release-merge-audit doctrine, before
  implementing): the phase file's "gems-from-salvage" input class does not exist in the
  game. There are NO gem materials, no salvage-gem outputs, and no prospecting:
  SALVAGE_MATERIAL_BY_QUALITY yields bone_fragments/linen_scrap/spider_leg, and the only
  gem-flavored junk defs (deepfen_pearl, pale_pearl, inert_storm_shard, bogiron_nugget)
  are quality 'poor' (sellAllJunk sweeps them, unusable as reagents) and sit in no
  source table. The salvage-DERIVED material family that does exist is the disenchant
  ladder (arcane_dust / arcane_essence / arcane_shard). The catalog reads
  "gems-from-salvage" as that ladder: arcane_dust on the 0 rung, arcane_essence on the
  25 and 50 rungs, and arcane_shard deliberately NOT consumed (Phase 04 sized epic
  disenchant 1:1 against the heroic faucet; a leveling catalog must not add a consumer
  to that scarce faucet, and shards stay reserved for the apex band, phase 09). No new
  gathered material is invented, so the phase's stopping rule is not tripped. QA
  re-judges this reading.
- QUALITY-LADDER DEVIATION (ruling APPROVED at Phase 05 QA 2026-08-10, see the
  rulings bullet below): the phase file's
  "(common/uncommon/rare)" gloss is unshippable at rung 0 for jewelry: QUALITY_STAT_MULT
  is 0 for common and jewelry has no armor axis, so a common ring would carry literally
  nothing, and the recorded content doctrine (profession_items.ts ladder headers) says
  common-rung pieces are armor-only BECAUSE common quality carries no primary-stat
  budget. Classic-era jewelcrafting also starts its equip jewelry at uncommon. The
  catalog therefore ships uncommon(0) / uncommon(25) / rare(50), the two uncommon rungs
  separated by recipe level (10 vs 15, ring budgets 3 vs 4); rare stays exclusive to
  rung 50 so the deed rare-tier derivation and the training-fee ladder land exactly like
  the other crafts. Every budget remains exactly formula-derived; the quality-per-rung
  pin in recipe_economy covers LADDER_RECIPES only and does not move.
- EXECUTION RECORD (what shipped): nine items in profession_items.ts (new jewelcrafting
  section; kind armor, slot ring/neck, no armorType/ratings/buyValue/requiredLevel;
  budgets 3/4/8 at ilvl 11/16/23, splits 2+1, 3+1, 5+3 with sta the minor stat), nine
  recipes in the new JEWELCRAFTING_RECIPES array in recipes.ts (id = recipe_ +
  resultItemId; skillReq/budget/level = 0/10/10, 25/16/15, 50/20/20; all stationType
  'forge', acquisition ['trainer'], resultCount 1). Reagents: rung 0 copper_ore 4-5 +
  arcane_dust 2-3 + smithing_flux 1; rung 25 iron_ore 3-5 + arcane_essence 1-2 + flux 1;
  rung 50 thorium_ore 4 + essence 2-3 + flux 2 + iron_ore 2 (the 4th line was
  RE-AUTHORED at the coverage review: the original fine_thorium_ore choice violated the
  material-grades disjointness invariant, a recipe listing a base material AND its fine
  grade double-counts one bag pool because hasRecipeMaterials checks lines
  independently, so a player holding only fine ore would craft one reagent short;
  resonant_steel stays rejected as bind-on-trade, iron ore is the solder line, margins
  52/70/22). Economy margins 16 to 70 copper, strict, both
  exception lists still empty, no recipe fully vendor-fed. Item ids: hammered_copper_band,
  polished_copper_loop, coiled_copper_torc, riveted_iron_signet, etched_iron_loop,
  iron_link_choker, weighted_thorium_band, gleaming_thorium_loop, burnished_thorium_amulet.
  Deed prog_jewelcrafting_rare appended at the DEEDS tail (renown 10, visit mark
  craft_rare:jewelcrafting), crest art committed (DEED_ORDER 271 to 272). i18n:
  entities.items.<id>.name rows via APPENDED_ITEM_NAMES (never the positional array),
  all nine names filled in the five non-Latin overlays (M16), guide keys
  craftIntro.jewelcrafting + craftProse.jewelcrafting x8 added with non-Latin fills,
  SEVEN falsified guide.professions/craftProse lines reworded (whatBody, ringBody,
  ringWaveNote, stationsBody, deedsBody, weaponcrafting.identityBody,
  enchanting.identityBody) with their non-Latin fills refreshed; 13 Latin overlays now
  carry stale rows for those seven keys (release-fill obligation; ringWaveNote and both
  identityBody rows are outright FALSE in Latin locales until refilled). Art: nine
  opaque 128px WebPs (1016 to 1794 bytes) + mapping.json woc_original_svg rows +
  CREDITS.md lines + audit admission (counts 825 to 834 art / 840 to 849 live, verdict
  re-cut, script census literals moved in scripts/item_art_audit.mjs). Tests: NEW
  tests/jewelcrafting_catalog.test.ts (rungs, forge, trainer, flux, quality ladder,
  formula-exact budgets, no-rating sweep, no-shard, slot split); pins moved in
  professions_crafting_hub (foreign-bound 2 to 11), recipe_economy (identity sum),
  deeds_content (272/3155/58, tail order, positive deed shape pin, catalog sha
  re-baselined), crafting_view (jewelcrafting hints at Darva's forge), deed_i18n
  (manifest 272*2+42), deed_icons + missing_painted_icons_wave + release_art_audit_v036
  + deeds_view (271 to 272 family), professions_blob_growth (ceiling re-mint, measured
  9734, new band 10240), guide.test literals (earnable + content-empty + overview link),
  material_profession_affinity(+bootstrap) + hint_view (dust/essence two-craft rows),
  professions_crafting (recipeList surface). Wiki regenerated (jewelcrafting page +
  sitemap row). Portrait manifest re-minted via the receipt flow at phase close.
- REVIEW ROUND (2026-08-10, applied in full): frontend-seam-reviewer (0 blocking, 2
  should-fix, 4 notes), a three-agent stale-claims/art/i18n audit fan-out (30 + 6 + 9
  findings), and a 16-item comment/docs reword batch. Everything applied: (a) the wiki
  generator now derives a craft card's station from the unanimous recipe stationType
  when the craft is absent from STATION_TYPE_BY_CRAFT (enchanting deliberately keeps
  the null card: its enchant channel is station-free), so the jewelcrafting page names
  the forge and Forgemistress Darva instead of the false "No station needed"; pinned in
  tests/guide.test.ts (positive jewelcrafting card + enchanting negative control + the
  grounding test re-derives the same rule). (b) The seven falsified guide.professions /
  craftProse keys plus faq.a2 ("eight earnable crafts") were reworded in English where
  still stale and STRIPPED from the 13 Latin overlays (91 + 13 rows to pending; the
  five non-Latin overlays' condensed values carried no falsified claim except the five
  already refreshed). (c) hudChrome.materialHint.arcaneDust/arcaneEssence leads
  reworded to the craft-neutral "Crafting reagent." with the five non-Latin fills
  refreshed in-change and the 13 Latin rows stripped (2 x 13); the hint-view pin
  updated with a not-toContain arm. (d) prog_jewelcrafting_rare deed locale fills
  authored for the five non-Latin chunks (family-idiom names: 打磨至璀璨 / 磨かれた輝き /
  광채를 향한 연마 / Отполирован до блеска); the 13 Latin chunks ride the release fill
  (the deed channel is outside the pending registry, worklist reminder below). (e) Art
  provenance record docs/achievements/masterwrought-phase05-art/ (crest source SVG
  committed + accepted sha256/bytes for all ten assets) closing the deed-crest
  provenance gap; dated amendment appended to the release-art-audit README's 271-line.
  (f) The derived Trapper-pair hobby flip (cooking+leatherworking now defaults to
  jewelcrafting over weaponcrafting, CRAFTS_WITH_CONTENT reads ALL_RECIPES) pinned in
  tests/professions_archetype.test.ts with a skill-preference control. (g) The catalog
  suite gained an i18n parity arm (nine catalog rows byte-match the defs, Osmium
  register pinned). (h) Fifteen stale comments/docs reworded (archetype, professions
  station header, training, heroic_vendor "only jewelry source", deeds block,
  hint-view rationale, guide pages, three test rationales, professions.md, deeds.md,
  maintainer-notes, generator comments).
- COVERAGE REVIEW ROUND 2 (2026-08-10, the fresh-subagent diff review; applied in
  full): the review recomputed every budget and every economy margin by hand (all
  exact), verified the deed trigger mechanism end to end (craft_rare derives from
  professionId at the emit site, cannot drift), and found what the phase missed
  OUTSIDE its own spec's suite list: (1) REAL DEFECT, fixed: the rung-50 recipes
  listed thorium_ore AND fine_thorium_ore, whose shared grade pool let a
  fine-ore-only bag pass the check and craft one reagent short (material_grades
  disjointness guards were red); re-authored to iron_ore x2 solder, guide materials
  prose + five non-Latin fills refreshed, wiki regenerated. (2) Stale pins in
  tests/train_view.test.ts (Darva teaches three crafts; locked rows 14 to 20) and
  tests/dev_kit.test.ts: buildDevKit derives best-in-slot from the item tables, so
  the three jewelry slots FILLED THEMSELVES when the catalog landed (neck
  burnished_thorium_amulet; physical rings weighted_thorium_band +
  riveted_iron_signet; caster rings gleaming_thorium_loop + etched_iron_loop),
  consistent with the crafted armor and weapons the kits already wear; judged
  correct-by-derivation (the Trapper-flip doctrine), zero source change, the pin
  re-pointed at the picks. An earlier keep-empty call was reversed when its premise
  (that the slots were still empty) proved false.
  (3) Jewelcrafting was the only gear-capable craft whose masterwork earned no
  Reliquary trophy (masterworkByCraft listed five crafts and the guard iterates the
  list itself, structurally blind to this drift): the jewelcrafting row + markFind
  i18n + a derivation-based guard added (craftIsGearCapable sweeps CRAFT_RING
  through masterworkBonusStats over ALL_RECIPES, so a craft turning gear-capable
  without a slot reds it). DISCOVERY recorded for future mark work: a reliquary
  mark's display name lives in THREE hand-maintained tables, the client catalog
  (hudChrome.reliquary.markFind), the server RELIQUARY_MARK_ENGLISH in
  server/character_sheet.ts (cross-pinned bidirectionally by
  tests/character_sheet.test.ts), and RELIQUARY_MARK_GUIDE_NAMES in
  scripts/wiki/build_content.mjs; all three carry Jewelcrafting Masterwork, the
  masterwork glossary row extended, reliquary pins moved 375 to 376 slots / 29 to
  30 marks (incl. tests/profile_page.test.ts, a pin the brief never named), and
  tests/parity stayed green (draw-order neutral). The server/character_sheet.ts
  touch is one row in an English-by-design table; flagged for the QA reader since
  the phase was otherwise server-free. (4) A new end-to-end behavior suite
  tests/jewelcrafting_flow.test.ts (train at Darva's forge with fee assertions,
  craft at the station, reagent consumption exact, deed grant via the tick,
  station_required refusal). (5) Pin-quality nits: exact per-rung flux counts,
  multi-key R14 positive controls, no-buyValue arm, per-rung trainingFeeFor arm.
  (6) Recorded INTENDED, no change: the rung-0 dust round trip is material-positive
  (2 to 3 dust in, 3 to 4 back on disenchant) and gold-negative, the classic-era
  shuttle-craft dust economy exactly (crafting cheap uncommons to disenchant IS the
  canonical enchanting supply loop; gold is the sink); flagged to phase 15 beside
  the essence note. (7) The Osmium display forms web-verified post-hoc (registry
  above). Adversarial leftovers recorded for QA: hubCraftsPerformed now counts a
  ninth craft's station work (correct, unremarked widening); catalog reachability
  (rung 50 at 125-cap pacing) is stated in guide prose but unpinned. Two dev-kit
  scorer facts pinned-with-notes rather than changed: druid/feral (the one TANK_AGI
  role, sta-led) picks the rung-50 INT ring for its stamina over the rung-25 str
  ring, the scorer working as designed; and the PHYS_AGI ring2 pick rests on an
  IEEE754 hair (riveted_iron_signet vs gleaming_thorium_loop tie at exactly 1.8 in
  real arithmetic, split only by float summation order in roleItemScore), so any
  reordering of the weight-sum terms silently flips twelve specs' ring2; the pin
  makes that visible, and an epsilon-aware tiebreak is a cleanup-phase candidate.
- RULINGS WANTED AT PHASE 05 QA, ALL TAKEN 2026-08-10 (Fernando, via the QA session):
  (1) the Trapper pair's default hobby flip to jewelcrafting: KEEP (correct-by-derivation
  stands; the pin already holds it). (2) prog_jewelcrafting_50 and
  prog_grandmaster_jewelcrafting: AUTHOR BOTH NOW; authored in the QA fix round (Facet
  and Filigree renown 5 / Grandmaster Jewelcrafting renown 25 + title, DEED_ORDER 273
  and 274, in-family crests with committed SVG sources, five non-Latin deed-chunk
  fills, live-gain-path flow arm; deed pins re-cut 274/3185/60 progression/43 titles,
  catalog sha re-baselined). The quality-ladder deviation above was likewise APPROVED:
  uncommon(0)/uncommon(25)/rare(50) ships as authored. The phase 04 sunderability
  carry-over was also taken; see the Phase 04 QA open items bullet (heroic-raid epics
  sunderable, implementation with phase 12).
- RELEASE-FILL OBLIGATIONS MINTED THIS PHASE (the pending registry sees the first
  group; the deed group it structurally cannot see). CORRECTED AT QA: the original
  bullet said 18 keys and 130 total stripped rows were misadded as 104. (a) 19 new
  keys x 15 Latin locales pending normally: 9 item names + craftIntro.jewelcrafting +
  8 craftProse.jewelcrafting keys + hudChrome.reliquary.markFind.masterwork_jewelcrafting
  (the last was added by coverage round 2 and never reconciled into the old count).
  (b) 130 stripped stale Latin rows (7 guide.professions/craftProse keys + faq.a2 + 2
  materialHint keys = 10 keys x 13 locales) pending after the strip. (c) The deed
  chunks, INVISIBLE to pending=0, add to the release worklist by hand:
  prog_jewelcrafting_rare name+desc in the 13 Latin chunks, PLUS (minted at QA)
  prog_jewelcrafting_50 name+desc and prog_grandmaster_jewelcrafting name+desc+title
  in the same 13 chunks (26 + 65 = 91 deed-channel rows total). (d) Minted at QA: the
  reworded guide.professions.deedsBody rides the existing stripped-pending rows (the
  13 Latin strips already happened in the phase; the fill translates the NEW English).
  (e) Minted at QA: the five non-Latin guide.profPages.faq q1-a8 block is an OLD
  GENERATION answering an earlier English question set (the QA corrected only the
  falsified craft count inside a1); regenerate the whole block against the current
  English at the release fill.
- QA FOLLOW-UPS (Phase 05, non-blocking): (1) the rung-50 recipes consume
  arcane_essence while rare-band disenchants are their only faucet; watch the essence
  economy when phase 15 verifies power/economy. (2) tests/item_art_audit_builder
  "fresh-checkout rebuild" test measured 16s isolated against a 20s ceiling under
  another session's load; contention-borderline, judge by CI per the standing memory.
  (3) The ru craftProse.jewelcrafting.materialsBody mixes translated and English ore
  registers inside one paragraph (matches the existing ru weaponcrafting precedent);
  settle the register in the release locale-fill pass. (4) SESSION INCIDENT, recorded
  for the QA reader: a mid-phase usage-limit restart silently reset the shell cwd from
  the worktree to the main checkout; one script ran in the wrong repo (13 locale files
  contaminated there, restored to HEAD the same hour) and several wrong-repo READS
  briefly produced false "work missing" conclusions, all voided after re-entering the
  worktree. No worktree work was lost; re-run EnterWorktree after any session restart.

## Phase 05 QA ledger (2026-08-10)
- PRE-FLIGHT: release moved to v0.37.0 (20 commits: AI-architecture CLAUDE.md refresh,
  the v0.36.0 locale staleness fill, CI shard bounds, tests/monolith_budget.test.ts,
  server/parse actor roster, docker fixes). Merge b70c9f7aeb: 40 conflict files, all
  resolved deliberately (root CLAUDE.md hand-merged, keeping the branch's
  naming-originality block inside the release's rewritten content-obligations bullet;
  18 overlays took the release side per hunk after verifying every conflicted key was a
  same-key staleness rewrite and all 12 branch-added keys survive; resolved bundles
  regenerated via i18n:gen, never hand-merged). release-merge-audit CLEAN: four
  auto-merged doc overlaps read against both parents (README kept the release refresh
  plus the branch's Vandric rename; both sim CLAUDE.md files kept the branch sections),
  no migrated arms, no injected-helper rebinds, no new db-mock sites, no lockfile
  change; merged-tree tsc + the release's new monolith_budget test green; the v0.36.0
  fill ate ZERO phase 05 pending rows (verified per-key); portrait source manifest
  --check FRESH both at the merge and after the QA's own deed additions (deeds are
  outside its bundle graph). Monolith headroom noted for phase 12: sim.ts 85 lines
  under its ceiling, server/game.ts 185 under.
- RULINGS: all four taken (see the amended bullets above): quality ladder APPROVED,
  Trapper flip KEEP, deed pair AUTHOR NOW (done in this QA), heroic-raid epics
  SUNDERABLE with implementation at phase 12.
- AUDIT FAN-OUT (eight auditors, ZERO blocking anywhere): five-agent workflow (budget,
  coverage, progression, test-decisiveness in an ISOLATED worktree for mutation probes,
  blast-radius) plus content-obligations-reviewer, frontend-seam-reviewer, and
  qa-checklist (verdict READY). Dispatch rationale recorded: privacy-security-review
  and architecture-reviewer deliberately skipped (server surface = one English
  ReadonlyMap row; sim surface = data plus comment-only edits, parity suite green),
  per the phase spec's dispatch matrix and the qa-checklist's own judgment.
- FINDINGS APPLIED (6 commits after the merge): (1) three stale authoring comments
  (the recipes.ts fine_thorium_ore header, found independently by four auditors; the
  reliquary.ts phantom trinket slot; the icons.ts pendant/sparkle comment). (2) The
  material_profession_hint_view supersede arm rebuilt as an explicit
  CRAFT_NAMING_HINT_KEYS allowlist with exported predicate and direct pins (the
  craft-neutral dust/essence leads made the old exclusion-shaped check latently wrong
  for single-craft consumer sets). (3) The five non-Latin faq.a1 rows count-swapped
  eight to nine (the phase falsified a number inside a pre-existing old-generation
  block; whole-block regen recorded as a release-fill obligation). (4) The catalog
  suite hardened: full nine-recipe reagent-literal table (mutation probe f proved a
  silent ore/dust re-author passed every sim-side suite), WARFARE pvp-rating liveness
  controls, and the derived equip-gate pin (rare rung-50 requires level 20 via the
  recipe source registration, uncommon ungated). (5) dev_kit bestBy gained a relative
  epsilon tie band with the id tiebreak owning real ties (probe h proved a
  rounding-equivalent refactor flipped seven agility-camp ring2 picks on one ulp);
  gleaming_thorium_loop is now the stable documented agility-camp ring2, the strength
  camp keeps riveted_iron_signet on a real score gap; dev-only surface. (6) The ruled
  deed pair authored (see the rulings bullet for the full record).
- TEST-DECISIVENESS RECORD: 8 mutation probes in the isolated worktree, 7 reddened the
  exact guarding test with quoted failure names (rating key, budget formula, forge
  binding, deed mark drift, reliquary derivation guard, golden both directions,
  IEEE754 tie), probe f exposed the reagent-count gap fixed above. Pins judged
  decisive across both new suites; no constant-self-comparisons. The crafting-hub
  foreignBound pin is membership-only BY DESIGN (the catalog suite solely guards the
  binding TYPE; recorded so nobody deletes its forge literal believing the hub pin
  covers it).
- RECORD-ONLY FACTS the auditors verified (no code change): budget derivation runs off
  recipe.level + QUALITY_ILVL_BONUS through primaryStatBudget (itemLevelBudget feeds
  ONLY the craft gold-sink fee; the rung-25 16 = derived-ilvl-16 equality is
  coincidence). Rung-50 recipes are sell-positive on a self-gathered basis under the
  locked buyValue-else-sellValue economy rule, same shape as the pre-existing forge
  ladder (recorded for the phase 15 essence watch). tests/itemization_coverage.test.ts
  is structurally blind to the nine by its own prior-change charter; jewelry coverage
  lives in tests/jewelcrafting_catalog.test.ts (plus item_level.test.ts's sweeps
  exclude crafted outputs by sourceLevel filter). The nine ids are NOT yet in
  tests/shipped_item_ids.golden.json: the re-mint (UPDATE_SHIPPED_ITEMS=1, review as
  additions-only) is a RELEASE CLOSE-OUT step for this packet, add it to the PR
  checklist. XP curve verified: 25 full-gain crafts per rung, 50 minimum to rung 50,
  cap 125 reachable on the nine recipes alone (225 crafts best path), byte-identical
  scaffolding to the LADDER_RECIPES crafts, R13 untouched; the 50-deed flow arm now
  drives ONE live gain step (49 + craft = 50). Dust round trip verified gold-negative
  in every branch with live numbers (40c hard cash out per loop vs at most 24c dust
  back, expected all-in -47c; vendor branch -36c; material-positive +1 to +2 dust as
  designed). tests/professions_hobby_craft.test.ts change was comment-only (citation
  retarget); tests/item_art_consistency.test.ts was a REAL pin move the build ledger
  never named (the nine-WebP art-audit admission, self-checking digests), recorded
  here as its justification. The nine jewelry pieces now enter the PBE boost BiS
  ring/neck pools (outcome unchanged today: 2-to-8-point pieces cannot outscore the
  epic picks; a future big-stat rung would silently change boost kits through
  server/pbe_boost.ts bisKitForRole). npm run asset:budget overages (env, textures,
  models/*) are pre-existing repo-wide debt untouched by this phase (the ten phase
  WebPs live under ui/, outside those groups). Pre-existing, not ours, left alone:
  the icons.ts:5278 console.warn em dash (repo no-dash debt) and the
  cs_CZ.dgn_sanctum_speed.name release-tier deed_i18n red.
- GATE CLOSE (2026-08-11): node scripts/gate_select.mjs PASS, all 8 steps green at
  93a2dd16b3 (the content-heavy diff made the planner fall back to the FULL suite,
  36k tests). The first gate run FAILED on tests/overlay_ip_scrub.test.ts: the
  v0.36.0 staleness fill the sync merged carried two pre-rename coins inside its
  rewritten rows, Gloomshade (24 rows: summon_voidwalker name+desc across 12 Latin
  overlays) and Moonwell (one vi_VN night-notes row), both phase 03 renames
  (Duskmurk, Moonspring); token-swapped in place keeping the fill's newer mechanics
  text (93a2dd16b3). THIRD release-fill reintroduction the scrub guard has caught
  (Gallowmere twice before). SYNC LESSON for every future release-fill merge: after
  taking a fill's overlay rows, run the three naming guards BEFORE the gate; the
  per-hunk resolution verified branch keys survived but never re-screened the
  release text against the rename registry.
- DEED-AUTHORING OBLIGATION DISCOVERED (durable, for every future TITLE deed): the
  locked titles-page rule means a new non-hidden title deed ALSO owes a
  horizons_titles slot in src/sim/content/reliquary.ts in the same change (the
  Grandmaster Jewelcrafting title reddened the derivation pin in
  tests/reliquary_content.test.ts exactly as designed; slot appended, totals
  re-pinned 377 slots / 342 full / 313 character, wiki regenerated). The deed
  authoring recipe in docs/design/deeds.md does not name this coupling; phase 06+
  should treat title-deed = deeds.ts + reliquary titles slot as one unit.
- FIX-ROUND REVIEW (both reviewers reported; every finding applied or judged with the
  file open): the fresh reviewer found 2 blocking + 6 should-fix + 7 nits; the deed
  obligations pass found 0 blocking + 1 should-fix + 3 nits. Dispositions: (1) biome
  red on the hint view, fixed. (2) THE QA'S OWN faq.a1 count swap was WRONG and is
  REVERTED: that "eight" counts RAISEABLE crafts (nine content crafts minus the
  Engineering holdout whose ladder waits for the Bombardier oath), so jewelcrafting
  did not falsify it and the swap contradicted whatBody in the same locales; the
  original frontend-seam finding's falsified-premise was itself mistaken. The
  non-Latin profPages.faq q1-a8 block desync stands recorded for the release fill
  (obligation (e) above, corrected wording). (3) The dev-kit epsilon band initially
  flipped seven agility-camp ring2 picks to a dead-stat int ring on the id
  alphabet; re-cut with an IDENTITY-FIRST tiebreak (a tied pick prefers the item
  carrying the role's weighted stats), which restores every shipped pick while
  keeping the one-ulp robustness. Net dev-kit behavior change across the whole QA:
  ZERO. (4) The hint-view allowlist gained its two-way contract pin against the
  resolved English leads. (5) Deed earnability is now DERIVED in deeds_content:
  for every craftSkill deed, some shipped rung must grant one point short of the
  threshold under the craft-as-major ceiling (enchanting via the soft disenchant
  arm); the cap-only check would have greenlit a gain-path-less deed. (6) The three
  Masterwrought crest hashes are pinned beside the provenance record and CREDITS
  (the PR #3295 authored-art lesson). (7) deedsBody's jewelcrafting parenthetical
  dropped in English + five overlays (eight of nine crafts have a rare-tier deed,
  so the singling-out misled). (8) Reachability prose gained the attunement caveat
  in deeds.ts + deeds.md. (9) Comment re-cuts: deed_i18n lead line, dev_kit tie
  notes (anchor bound, order caveat, NaN seed), "nothing about the picker changed".
  Recorded, no change: server/pbe_boost.ts bestBySlot keeps a first-wins tie policy
  distinct from dev_kit's identity-then-id (untouched, out of scope, noted for the
  next reader); the state.md build-ledger EXECUTION RECORD keeps its historical
  272/3155/58 and manifest numbers as written (the QA re-cut lives in this ledger).

## Phase 06 ledger (inscription base catalog, 2026-08-11)
- STATION/TRAINING DECISION (the serial decision this phase owed): every inscription
  recipe carries an explicit `stationType: 'apothecary'`; inscription stays OUT of
  `STATION_TYPE_BY_CRAFT` (no new station type, no new trainer NPC, no StationType
  union widening). Rationale, the four phase 05 legs re-argued for this craft: (1) the
  foreign-binding seam is proven twice over (enchanting's tool-effect charms at the
  toolworks, jewelcrafting's nine at the forge); (2) training derives entirely from the
  recipe's station (trainingStationTypeFor), so Alchemist Verane's Highwatch apothecary
  teaches the catalog with zero new NPCs, props, layout rows, or station i18n; (3)
  thematically the catalog is ink and pigment work: the reagent ladder is the SAME
  herb ladder the apothecary's alchemy draughts consume (silverleaf/goldleaf/sunpetal
  plus the glass_vial staple already stocked there), and the scroll half of the catalog
  is literally an alternative source of the elixir aura family alchemy brews at that
  bench, so the two exclusive sources train at one master; (4) reversible: the
  decorative inscription_lectern prop already stands in Eastbrook's artisan row
  (eastbrook_layout.ts), so a later world phase can seat a real scriptorium station and
  repoint each recipe's stationType without changing any record shape. Cost paid here:
  the foreign-bound allowlist pin in tests/professions_crafting_hub.test.ts grows the
  six inscription recipe ids; the craft-absent pin (stationTypeForCraft('inscription')
  undefined) deliberately stays green; faq.a8's six-station-type list stays TRUE; the
  gossip Crafting-shortcut tie-break (STATION_TYPE_BY_CRAFT key order) is untouched.
- TOME QUALITY LADDER: uncommon(0)/uncommon(25)/rare(50), applying the Phase 05 QA
  APPROVED ruling by its own recorded mechanism: QUALITY_STAT_MULT.common = 0 and
  HeldOffhandItemDef pins armorType?: never AND weapon?: never, so a common tome
  carries literally nothing at every ilvl (the jewelry no-armor-axis case exactly).
  The two uncommon rungs separate by recipe level (10 vs 15); rare stays exclusive to
  rung 50 so the deed rare-tier derivation and the training-fee ladder land like the
  other crafts. QA re-judges this extension of the ruling.
- SCROLL KIND DECISION: scrolls ship as a NEW ItemKind 'scroll' (ScrollItemDef reusing
  the SAME `elixir` effect field), and the items.ts consumable arm widens from
  `kind === 'elixir'` to accept both kinds with a per-kind log line ("You read" vs
  "You quaff"). Rationale: the kind line and use line are player-facing text, and a
  scroll labelled and logged as an elixir is wrong text under the i18n invariant; the
  'recipe' kind (phase 02) is the direct precedent with the obligation list already
  mapped (KIND_RANK compile-forced rank, itemUi.kind row + overlays, kind-sweep
  suites). The aura application is byte-identical to the elixir arm: same
  `elixir_${kind}` aura id, same applyAura call, no new stacking path, zero changes to
  aura_stacking.ts or combat/exclusive_aura.ts.
- SCROLL FAMILY MEMBERSHIP: all three scrolls join the ONE existing family
  (elixir_buff_sta) at the family's same-band magnitudes AND the same aura display
  names, so either source grants the indistinguishable buff and the exclusivity is
  visible to players: rung 0 common 'Might of the Boar' +6 sta 600s, rung 25 uncommon
  'Vipersear Vigor' +9 sta 900s, rung 50 rare 'Might of the Serpent' +12 sta 900s.
  The authored family ceiling (buff_sta <= 12 for <= 900s) is respected at every rung;
  no new family is minted, so the phase's stopping rule is not tripped and no new
  sim_i18n aura rows are owed (all three names already have matcher rows).
- PROG_RINGWRIGHT RE-DECISION: the recorded deferral rationale ("inscription alone has
  zero recipes") dies with this phase, but the deed itself has NO recorded design
  anywhere: no trigger shape, no threshold, no name text, no renown value, and its two
  reserved companions (prog_three_paths, prog_ninefold) are equally unspecced. Decision:
  RE-RECORD the deferral with the new rationale (the hold is now an unwritten design,
  not a missing engine surface) in deeds.md, maintainer-notes.md, and both deeds.ts
  doctrine comments, keep the tests/deeds_content.test.ts absence pin, and QUEUE a
  design ruling for Fernando at Phase 06 QA: trigger shape (craftSkill count-arm?),
  threshold, renown, and whether the three reserved ids ship as a family.
- PHASE 06 NAMING REGISTRY (R15, web-verified 2026-08-11; AMENDED at the content review
  to certify the SHIPPED displays): items 'Sheenleaf Primer' / 'Goldleaf Folio' /
  'Sunpetal Grimoire' (tomes, ids silverleaf_primer / goldleaf_folio / sunpetal_grimoire)
  and 'Sheenleaf Scroll' / 'Goldleaf Scroll' / 'Sunpetal Scroll' (scrolls, ids
  silverleaf_scroll / goldleaf_scroll / sunpetal_scroll). Verification record: the
  Goldleaf/Sunpetal compounds returned no full-name hit in any indexed game; the
  'Silverleaf ...' compounds were verified clean too but do NOT ship (the id/display
  split renders silverleaf ids as 'Sheenleaf', our own Phase 03 coin, and a compound of
  our own coin plus a generic noun cannot collide with an external full name, the Osmium
  register's reasoning). The frozen ids keep the verified silverleaf spellings.
  REJECTED for collision: 'Scroll of the Boar' (EverQuest item 35022, allakhazam).
  Deeds: 'Written in Fine Ink' (prog_inscription_rare) CLEAR; 'Quill and Pigment'
  (prog_inscription_50) CLEAR with a recorded neighbor caveat (WoW Dragonflight ships
  the 'Ink and Quill I-IV' achievement family, a different full name);
  'Grandmaster Inscription' is the formulaic title the earnability arm derives.
- EXECUTION LEDGER (built 2026-08-11): new item ids silverleaf_primer / goldleaf_folio /
  sunpetal_grimoire (held_offhand tomes, CASTER_ALL, budgets 3/5/10 at ilvl 11/16/23) and
  silverleaf_scroll / goldleaf_scroll / sunpetal_scroll (NEW ItemKind 'scroll'); recipe ids
  recipe_<itemId> x6 in INSCRIPTION_RECIPES. Family membership: all three scrolls join
  elixir_buff_sta at the band payloads (boar 6/600, vipersear 9/900, serpent 12/900), same
  aura display names as the band elixirs, so no new sim_i18n aura rows. New sim surface:
  ItemKind 'scroll' + ScrollItemDef (required elixir payload, use barred), the widened
  items.ts consumable arm with the 'You read {name}.' log line (log.read matcher: flat
  base + RULES regex + all 20 non-en DICT blocks incl. the eight sparse ones; the quaff
  row's own sparse-block gap predates the phase and is recorded below). KIND_RANK scroll=6
  (consumables run), market consumable browse arm + bag consumable chip gained the kind.
  No new IWorld members, wire fields, SimEvents, or server handlers; the parity pin is
  untouched at 321.
- NEW i18n KEYS: entities.items.<sixIds>.name (Sheenleaf display register on the two
  silverleaf ids), itemUi.kind.scroll, hudChrome.reliquary.markFind.masterwork_inscription,
  guide.profPages.craftIntro.inscription, guide.profPages.craftProse.inscription.{identity,
  materials,ladder,route}{Heading,Body}, log.read (sim DICT scope). REWORDED English:
  whatBody, ringBody, ringWaveNote, stationsBody, deedsBody, faq.a2,
  craftProse.tailoring.identityBody, craftProse.enchanting.identityBody (the 13-Latin
  stale rows for tailoring.identityBody stripped to pending; the other seven had no Latin
  rows; en_CA divergence-only, nothing to update).
- NEW TESTS: inscription_catalog (14, the JC catalog template incl. the full reagent
  literal table and both quality ladders), inscription_flow (8, live train/craft/deed at
  the apothecary incl. the resultCount 2 scroll batch and the 49-to-50 live-gain arm),
  inscription_scroll_exclusivity (7: the band-payload premise pin, the headline
  both-orders pair, cross-band weaker-included, the read and quaff log lines, and the
  derived-stats liveness),
  elixir_tooltip_view scroll arm (byte-identical Use line vs the band elixir),
  market_filters scroll rows; plus the absorbed neighbor pins (see the
  test(professions) commit body for the full list).
- RELEASE-FILL OBLIGATIONS (phase 06 rows, the pending registry sees the Latin ones):
  (a) 17 new keys x 15 Latin locales pending normally: 6 item names + itemUi.kind.scroll
  + craftIntro.inscription + 8 craftProse.inscription keys + markFind.masterwork_inscription;
  (b) the 8 reworded keys' Latin rows (13 stripped tailoring.identityBody rows + the seven
  keys whose Latin rows were already pending);
  (c) INVISIBLE to pending=0, add by hand at the fill: prog_inscription_rare name+desc +
  prog_inscription_50 name+desc + prog_grandmaster_inscription name+desc+title in the 13
  Latin deed chunks (91 rows: all seven manifest rows per chunk, matching the phase 05
  jewelcrafting trio's arithmetic; the re-audit corrected an earlier 35-row copy-slip,
  which was the non-Latin count), and the log.read sim DICT row is already filled in every
  locale block (22 measured at the re-audit) but the PRE-EXISTING log.quaff gap in the eight sparse blocks
  (cs/nl/pl/id/tr/sv/vi/da render English quaff lines) is recorded here as an OLD gap the
  release fill should close alongside log.read consistency;
  (d) the five non-Latin guide.profPages.faq q1-a8 block stays the recorded old-generation
  whole-block regen from the phase 05 QA ledger.
- RELEASE CLOSE-OUT: the shipped_item_ids golden re-mint (UPDATE_SHIPPED_ITEMS=1,
  additions-only review) now covers the nine jewelry ids PLUS the six inscription ids.
- RELEASE-OWNED FOLLOW-UPS surfaced by this phase's merge audit (do NOT fix on this
  branch): (1) turbo.json build:bundle inputs omit scripts/build_bundle_pregen.mjs (and the
  gate_task_cache mirror), a warm-cache staleness hazard for pregen-step edits; (2)
  qa-gate.md/gate_steps/gate_task_cache prose says cacheable steps run through npx while
  the code spawns node_modules/.bin/turbo directly; (3) gate.mjs/gate_select.mjs lost
  cwd-independence (fails loud, likely intentional); (4) the mob-portrait render
  environment ping-pong: the release's CI rerender re-encoded all 230 portraits with byte
  drift this Mac's renderer does not reproduce, so every sync re-mints; the two
  environments should converge or the acceptance should carry an env fingerprint.
- DURABLE LESSONS: a ternary inside an emit's text field would blind the S3 scanner
  (split into two literal emits); market_filters' All-only reachability sweep is the guard
  that catches a new ItemKind with no browse category (it caught 'scroll'); the
  hobby-default flip and the apothecary two-craft train view are correct-by-derivation
  consequences QA re-judges (the Trapper precedent); usage-credit exhaustion kills
  workflow agents mid-run and the resume-from-runId flow recovers them with cached
  results (three rounds this phase).
- ART DIGESTS + LOCALE NOTES (post-fan-out): item icons + deed crests committed with SVG
  sources, rasterizer, and accepted hashes under docs/achievements/masterwrought-phase06-art/
  (item audit 834 to 840, deed art 274 to 277, crest sha pins in tests/deed_icons.test.ts).
  Locale register note for the release fill: the ru_RU overlay renders craft names
  INCONSISTENTLY across guide prose (native in ringBody/stationsBody, English inside the
  identity bodies including the phase 05 jewelcrafting row this phase's fills mirrored);
  a whole-file craft-name register pass belongs to the release fill, recorded here so the
  inconsistency is a known debt, not a phase 06 regression. The zh_CN faq q1-a8 staleness
  beyond a2 re-confirms the recorded old-generation whole-block regen obligation.
- RULINGS QUEUED FOR PHASE 06 QA (from the content-obligations review; recorded, not
  changed unilaterally): (1) SCROLL COST PARITY vs the alchemy line it alternates with:
  recipe_sunpetal_scroll (190 input, resultCount 2) undercuts
  recipe_elixir_of_the_serpent (214 input, resultCount 2) for the byte-identical buff,
  and the elixir is pristine_venom_gland's ONLY crafting sink, so the cheaper scroll
  route competes with that rare specimen's sole consumer; rung 0 is ~19 percent cheaper
  (26 vs 32) and rung 25 identical (90 vs 90). Options at QA: accept (two doors, the
  specimen sink keeps its resultCount value), re-price the rung-50 scroll inputs, or
  give the scroll a pristine-adjacent 4th line. (2) TOME MODELS: the three tomes joined
  the model-less held_offhand pin (the lantern/orb/quiver precedent renders nothing in
  hand); decide whether the packet PR owes tome GLBs (the image-to-glb pipeline) or the
  debt rides until the visible-offhand pass. (3) PROG_RINGWRIGHT design ruling (trigger
  shape, threshold, renown, the three reserved ids as a family), carried from the
  re-recorded deferral.
- PHASE-ORDERING LESSON (recorded): npm run wiki:content derives each deed row's crest
  url from DEED_IMAGE_IDS, so the wiki regen must run AFTER the deed-art commit; this
  phase regenerated before the crests landed and needed a follow-up regen commit.
- REVIEW FIX-ROUND RECORDS (all four reviewer reports applied 2026-08-11): (1) RELEASE
  NOTE for deploy: a legacy Bombardier save with NO persisted hobbyCraft and equal
  retained skill in both opposites re-derives its hobby at load and silently moves from
  enchanting to inscription (normalizeArchetypeState; persisted hobbies and real skill
  preferences are unaffected). (2) No-test-possible records: the dev_kit dual-wield
  held-offhand fallback's tie argument is unreachable for shipped content (every
  dualWield spec resolves a real second weapon first; bestBy is module-private), and
  the elixir_${kind} id-derivation's per-kind half has no live case (every shipped
  elixir and scroll is buff_sta, and useItem resolves through the real ITEMS so a
  synthetic-kind arm has no seam); both recorded rather than force-tested. (3) The bag
  hover hint (bags_view) has no arm for elixir OR scroll: a pre-existing family gap the
  scroll inherits, deferred to QA with the mobile-tray fix now making the two consumable
  surfaces otherwise agree. (4) The tooltip replacement clause landed family-wide on
  itemUi.tooltip.useElixir/useElixirAura (tooltip-writing.md item 7); the five non-Latin
  refreshes and Latin strips of those two keys plus the faq q1/a1 subject change ride
  the wave 3 locale round, adding those four keys to the release-fill worklist.
- FRESH-REVIEWER ADDENDA (round two, applied): the dev_kit caster-offhand liveness floor
  re-pinned at the REAL count (13; paladin contributes zero, shields/none); the crafting
  signing comment restored to the four single-copy precedents with the platter, serpent
  elixir, and sunpetal_scroll as the three accepted-cost cases; the exclusivity suite
  anchors its non-family-aura baseline so the total-count arm cannot degrade. WIDENED
  RELEASE-FILL NOTE: beyond the four keys wave 3 touched, the WHOLE non-Latin
  guide.profPages.faq q3-a8 block (12 rows x 5 locales) still translates the pre-rewrite
  English subjects (zh a3 even claims bare-handed tier 1 gathering, contradicted by the
  live q7 answer): the recorded old-generation whole-block regen covers q1-a8 and the
  release fill must treat it as such, not as the four wave 3 keys only. RECORDED, no
  change: defaultHobbyForPair's contentSet stays a prose-guarded test-only parameter (a
  type-system-enforced seam would be an API redesign out of fix-round scope).
- PHASE 06 GATE CLOSE (2026-08-11): gate_select TURBO_FORCE=1 PASS, all 8 steps green at
  tip 3c732e20d6 via the full-suite fallback (2659 files / 36697 passed, browser suite,
  tsc, all builds), tree clean. Two tip-level catches on the way: the portrait source
  manifest went stale AGAIN at the phase tip (content commits move the stills bundle
  graph; a content phase re-mints at its FINAL tip, not only at the sync; rerender was
  byte-identical, fingerprint rows only), and guide.professions.comingSoon joined
  LIVE_OFF_SWEEP_KEYS (no live surface renders it with every seat content-bearing; the
  synthetic-seat arm keeps it exercised). HANDOFF for Phase 06 QA
  (phase-06-qa.md, fresh session): sync the release first per the delivery contract;
  the queued rulings are (1) scroll cost parity vs the pristine_venom_gland sink,
  (2) tome GLBs vs the model-less debt, (3) prog_ringwright design, plus the recorded
  correct-by-derivation flips to re-judge (Bombardier hobby, apothecary two-craft train
  view, dev-kit caster offhand pick) and the deferred bags_view hover-hint family gap;
  the validation surface is the suite list in this ledger plus the four reviewer
  reports' verified-clean sections.

## Phase 06 re-audit addendum (2026-08-11, second pass, same day as the close)
- WHY: operator-requested belt-and-suspenders re-pass of the whole phase spec (the build
  session ran long on context). Own release sync first, then a seven-finder ultracode
  verification sweep over every ledger claim with adversarial verification per finding.
- RELEASE SYNC: merge 76a3b43359 (v0.37.0 moved 20 commits: native OTA visible updates
  PR 3317 + kobold/Grix authored bodies PR 3302). pending.ts regenerated (union verified
  lossless both ways); naming guards clean on the incoming ota overlay rows; parity fully
  green (the Grix sim sizing touches no golden; goldens did NOT move this sync); the 11
  delta suites green on the merged tree.
- PORTRAIT TRIO LESSON (new, sharper than the pair lesson): accepted-art.json pins BOTH
  the source manifest AND portrait-rerender-evidence.json, so a merge resolution that
  takes accepted-art.json from one side while git auto-keeps the other side's evidence
  file splits the trio and reds tests/placeholder_art_completion.test.ts with a CLEAN
  git status. This sync: took the release's accepted-art + the two new-body portraits,
  kept the branch's evidence file (its digests match every committed webp), re-minted the
  manifest via the receipt flow (14a20329d5), then advanced BOTH accepted-art pins the way
  the release's own re-bless commits do (cfc6200971). The local rerender reproduced all
  230 portraits byte-identical INCLUDING the new grix/tunnel_rat bodies, so the env
  ping-pong did NOT recur at this sync (the release-owned follow-up item stays recorded;
  the two new-body rows moving at the NEXT ledger re-mint would be expected content
  movement, not drift).
- RELEASE-OWNED FOLLOW-UPS added by this sync's merge audit (do NOT fix on this branch):
  (5) .github/workflows/ota-publish.yml's verify step can never pass: its probe body
  omits plugin_version, pluginSupportsDeltaManifest is fail-safe false for a missing
  version, so the offer never embeds the delta manifest the step requires and every
  publish run exits 1 even on success (also masks real entry-list failures); (6) deploy
  note: server/ota_updates.ts defaultFetchManifest now uses redirect:'error' plus a
  credentialed-URL ban, so a redirecting OTA_MANIFEST_URL origin (S3 website endpoint,
  CDN apex) silently converts to OTA-off; check the production origin before relying on
  an OTA push.
- RE-AUDIT VERDICT: three finders fully clean (catalog/budgets recomputed formula-exact,
  exclusivity seam + sim purity + parity pin 321, per-id art/M16/mapping obligations);
  the isolated-worktree decisiveness skeptic proved the headline pins with live mutation
  probes (reagent table, both exclusivity orders, resultCount batch). FOUR should-fix
  confirmed and applied in this addendum's commits, none blocking:
  (1) deeds.ts second doctrine comment (rare-tier family block) had dropped the
  prog_ringwright deferral mention the ledger decision required in BOTH comments;
  restored with a pointer at the Professions 2.0 block. (2) The (c) release-fill count
  above was a 35-row copy-slip; corrected to 91 (the release-tier deed_i18n arm made the
  slip harmless at fill time). (3) tests/reliquary_content.test.ts: the two summed
  catalog narratives ended 3 short of their pins and the character narrative's delta
  enumeration missed the same three additions (the phase 05 QA grandmaster title slot
  and this phase's +2 were never narrated), and the mark narrative missed
  masterwork:inscription under the 31 pin; narratives extended to land exactly on
  379/344/315/31 (literals were independently recounted correct, comment-only fix).
  (4) craftProse.jewelcrafting
  .routeBody still claimed the craft's milestone and Grandmaster pages "wait with its
  archetype pairs", falsified by the phase 05 QA deed pair on this same branch and missed
  by the phase 06 sweep (which hunted inscription-falsified claims): English re-cut to
  the inscription routeBody's register (rare deed, 50-skill deed, 125-cap title), five
  non-Latin rows refreshed in-change mirroring EACH locale's own inscription-row register
  (ru/zh_CN native deed names from the deed chunks, ja/ko/zh_TW English names, see the
  register obligation below), Latin rows already pending so the registry serves
  the new English at fill time. Plus three audit nits applied: ledger exclusivity-suite
  count 6 -> 7 (the quaff else-arm test), consumer-set pins for silverleaf_herb and
  glass_vial gaining inscription (material_profession_affinity), and an ITEMS.arcane_shard
  token-liveness control beside the inscription_catalog negative pin.
- REFUTED at verification (do not re-raise): itemUi.kind.scroll Latin overlays are a
  RECORDED release-fill obligation (row (a) above), and the claimed phase 02 all-overlay
  precedent was factually wrong (hudChrome.pattern.teaches shipped 5 non-Latin only; the
  kind.recipe all-overlay fill was a recorded deliberate deviation).
- FRESH-REVIEW ROUND over this addendum's own fixes (the fix round is unreviewed code):
  verdict 0 blocking, 4 should-fix, 6 nits, ALL applied or recorded. Applied: the 344
  narrative's own head carried two compensating errors (baseline 242 with the 19
  rare-slain marks dropped from the sum; corrected to 223 + 16 + 19 + 29 + 47 + 3 = 337,
  measured), the zh routeBody rewrites carried a non-canonical Book of Deeds term
  (corrected to the hudChrome.deeds.title form used by their inscription siblings), the
  herb pins widened to all three herbs plus an arcane_essence head-position pin with an
  accurate two-direction ordering comment (ink lines put inscription FIRST, herbs LAST,
  vial is membership-only), and the 379 pin's excess sentence now names the real
  composition (7 excludeFromCompletion slots + 28 duplicate item slots = the 35 gap).
- RELEASE-FILL REGISTER OBLIGATION (widened here; supersedes the narrower ru craft-name
  note in the art-digests paragraph above): the guide-prose register pass at the fill
  covers CRAFT names and DEED names across all nine content crafts and all five
  non-Latin overlays. Current split: ja/ko/zh_TW print English deed names in the
  jewelcrafting and inscription routeBody prose while their deed chunks ship native
  names; ru/zh_CN render those two crafts' deed names natively but the seven older
  crafts' routeBody rows still print English deed names. Fill-time context: the guide's
  own deed catalog page prints English deed names in every locale (content.generated is
  English-only), so native prose names lack a guide-search anchor until the wiki i18n
  story moves; the register pass should unify prose anyway and accept that split.
- QA-QUEUED addition (joins the phase 06 QA ruling list): the five older crafts'
  routeBody closing register diverges from the packet's two (they name two deeds, omit
  their rare-tier deed although every prog_<craft>_rare ships, and say "at skill 50"
  where jewelcrafting and inscription now name three deeds and say "at 50 skill");
  unifying costs five English rewords x five non-Latin refreshes, a fill-wave-scale
  prose pass, so it is queued rather than done here.
- STATUS: header line updated to 06 COMPLETE + RE-AUDITED; progress.md gained the
  Phase 06 prose bullet the close had omitted (every prior phase carries one, a fifth
  miss this re-audit caught) plus a re-audit bullet; the Phase 06 QA handoff and its
  queued rulings are unchanged by this pass apart from the added prose-register item
  above. Gate: gate_select PASS all 8 steps at tip 93fc866030 (selective step list,
  malware scan 0 high, conservation coverage, all builds), tree clean; the docs close
  commit rides after the gate tip per the phase 06 precedent.

## Phase 06 QA ledger (2026-08-11, verdict PASS)
- SYNC: pre-flight found origin/release/v0.37.0 (1bb9a24821) already an ancestor of
  the tip (the re-audit's merge 76a3b43359 covered it; nothing new landed), so no
  merge, no merge audit, and no naming-guard or portrait-trio work owed at sync time.
- AUDIT SHAPE: five-agent ultracode workflow (exclusivity, budget, coverage, cleanup
  finders plus the isolated-worktree decisiveness skeptic) with adversarial verify,
  plus FRESH architecture-reviewer and frontend-seam-reviewer over the phase range;
  then qa-checklist and a fresh fix-round reviewer over the QA session's own commits.
  ZERO blocking in the shipped phase. All 8 mutation probes RED-as-expected,
  headline P7: making the scroll arm emit a different aura id than elixir_kind reds
  BOTH order tests plus the cross-band arm, so the exclusivity pin decisively
  catches the exact bypass the QA emphasis named. Probe citation corrections for
  future readers: the tome quality ladder binds in inscription_catalog ONLY
  (deeds_content stays green under a quality flip), and the rung-50 scroll aura
  name binds in inscription_scroll_exclusivity ONLY (elixir_tooltip_view stays
  green under a rename).
- BUDGETS: recomputed formula-exact with a counterfactual: the shipped 3/5/10 at
  ilvl 11/16/23 uniquely identify the 0.75 held line (the 0.45 worn line would give
  2/3/6). WORN-ARM DECISION RECORDED (the audit's one confirmed should-fix: made
  and pinned in code, unrecorded here until now): the tomes are HELD offhands
  (occupiesHand deliberately absent), they budget on the 0.75 offhand line, and a
  two-hander displaces them, which is why they price at 0.75 rather than the 0.45
  coexisting worn line; pinned by the inscription_catalog held pin.
- RULINGS, all four taken by Fernando in-session:
  (1) Scroll cost parity: RE-PRICE. recipe_sunpetal_scroll re-authored to
  sunpetal_herb 1 / arcane_essence 2 / glass_vial 1 / arcane_dust 1 = EXACT 214
  input parity with recipe_elixir_of_the_serpent (both resultCount 2), the rung-25
  precedent; both fix-round reviewers recomputed the parity against the live
  recipe_economy rule. The materialsBody prose was re-cut (dust returns in the
  sunpetal scroll; both rung-50 recipes refined; priced even with the serpent
  elixir) with the five non-Latin rows refreshed in-change, each using its locale's
  own serpent-elixir name; wiki and resolved bundles regenerated. No new fill rows
  (all 15 Latin rows were already pending). The rung-0 divergence (26 vs 32) is
  deliberately outside the ruling's scope.
  (2) Tome models: AUTHOR IN THIS PR. Three procedural held models
  (tome_silverleaf / tome_goldleaf / tome_sunpetal: 404/512/584 triangles, 11 to
  14 KB, vertex-color, texture-free) via the mailbox archetype under
  scripts/assets/inscription_tomes with a family source fingerprint and the
  contract test tests/inscription_tome_assets.test.ts; ITEM_OFFHAND_MODELS rows
  plus VAR_BOOK grips (first members of the family the pipeline reserved);
  priest/mage/druid gained a real offhandSlot whose base entries are swapOnly and
  never render (empty hands unchanged, proven by the committed A/B evidence);
  the WARLOCK deliberately keeps its fixed class spellbook (no offhandSlot; an
  equipped tome keeps the book visual); paladin/shaman render tomes through their
  existing slots. Evidence: docs/screenshots/masterwrought-phase06-tomes.
  (3) prog_ringwright: KEEP RESERVED (cut from this packet); the re-recorded
  deferral stands as written.
  (4) Older crafts' routeBody register: QUEUE to the release fill's register pass
  (a recorded fill obligation, not a future PR).
- RE-JUDGED correct-by-derivation flips, all APPROVED: the Bombardier hobby
  re-derivation (release note stands), the apothecary two-craft train view, the
  dev-kit caster-offhand pick and its 13-count liveness floor, and the uncommon(0)
  tome quality ladder (the budget finder confirmed the mechanism sound). NEW
  accepted derivation: a WEAPONLESS priest/mage/druid in the Combat Mech now shows
  the class staff base where it used to show the mech's sword default (the same
  layout adoption the shield classes already had; an armed character is
  unaffected); pinned in held_weapon_models.
- BAGS_VIEW hover gap JUDGED FIX-NOT-CUT: elixirs and scrolls hint clickUseInstant
  (an existing key, zero new i18n rows), pinned in bags_view. TRAY CAP DECISION
  RECORDED: the combat-priority order deliberately sheds food and drink first at
  the six-slot mobile tray cap (a buff-heavy bag shows no regen consumables in the
  tray; the bags keep them reachable); pinned by the cap-eviction arm in
  consumable_bar_view.
- FIX-ROUND REVIEW (qa-checklist plus a fresh reviewer over the seven QA commits):
  1 blocking, CONFIRMED and fixed: the wiki generator mirrors VisualDef.attach
  verbatim and the guide viewer renders every entry unconditionally, so the caster
  offhand bases would have put the warlock's open spellbook in three class figures
  while the stills (keyed on model+tint only, blind to attach) kept the old
  posters. Fix: AttachDef.swapOnly, filtered by the generator; the regenerated
  artifact is byte-identical, so no stills churn and no viewer change. The
  shield classes' showcase offhands (the paladin's axe-and-shield still) are
  deliberately unflagged. Should-fixes applied: VAR_BOOK grip pins
  (mutation-proven red on a deleted row), the mech staff pin, the tome family in
  scripts/assets/remint_lockfile_fingerprints.mjs plus the audit-doc scope line,
  and usedExtensions/scene/camera diagnostic pins on the asset test. The remint
  registry still has no completeness guard (nothing pins that every fingerprinted
  family is enumerated); recorded as a tooling note, deliberately not built here.
- PORTRAIT LEDGER: the tome wiring moved vision_malric_mage's source digest and
  its webp by 24 encoder-level bytes (visually identical; reproduced byte-identical
  across two full 230-portrait rerenders, so expected content movement, not env
  drift); manifest re-minted via the receipt flow and the accepted-art
  sourceManifests pin advanced the re-bless way.
- DURABLE LESSONS: a render-manifest commit is a wiki-regen trigger too, not just
  a content commit (build_content.mjs mirrors VisualDef.attach); the guide stills
  key (model, tint, tintStrength) is blind to attach changes, so an attach edit
  can silently split poster from viewer; a swap-slot base entry needs swapOnly or
  the guide showcases it.
- GATE: gate_select PASS all 8 steps at the final tip dab8d9d579 via the
  full-suite fallback (36772 passed / 2665 files, browser suite 117, tsc, all
  builds), tree clean; ci:changed clean (warnings only). Operational note: two
  prior runs of the same gate on the same tip went red PURELY on timeout flakes
  (12 heavy balance/world harness files, zero assertion failures, every file
  solo-green afterward) while the host sat at load average 98 to 110 under a
  concurrent session and an xrOS simulator; the pass came on the quiet machine
  with GATE_MAX_WORKERS=5, the worker bound the harness budgets are calibrated
  against. A loaded-machine gate red made only of harness timeouts is judged by
  solo re-runs, then re-gated bounded, not chased as a regression. Validation surface: the three
  inscription suites, tome assets, held_weapon_models, elixir_tooltip_view,
  market_filters, bags_view, bag_filter, consumable_bar_view, recipe_economy,
  itemization_coverage, item_level(+requirements), shipped_item_ids, architecture,
  localization_fixes, train_view, dev_kit, crafting_view, material_* (grades,
  affinity+bootstrap, hint views), professions_* (hobby_craft, crafting_hub,
  crafting, archetype), deeds_* (content, view, i18n, icons), reliquary_content,
  guide(+key_coverage), i18n_completeness, jewelcrafting_* (catalog, flow),
  item_kind_line, inventory_sort, release_art_audit_v036_reliquary_deeds,
  item_art_consistency, item_icons, placeholder_art_completion,
  mob_portrait_source_manifest, target_portrait_view, native_assets_pack,
  render_glb_replacement_assets, glb_texture_compression: all green.
- HANDOFF for Phase 07 (intermediates): the inscription base catalog is audited
  twice over and QA-closed; the exclusivity seam, budgets, and station wiring are
  all pinned decisive. Phase 07's Lucent Reagent authoring starts from a clean
  base; nothing from this QA carries forward except the recorded release-fill
  obligations and the routeBody register pass queued to the fill.

## Phase 07 pre-fan-out ledger (2026-08-11, recorded BEFORE any recipe row lands)
- RELEASE SYNC: origin/release/v0.37.0 (5d038ffb7d, 46 commits) merged as 7bfb608edc.
  Conflicts confined to provenance artifacts and the generated i18n bundle (regenerated
  via i18n:gen at the merged tree). Post-merge re-mints: portrait manifest + accepted-art
  pin + eastbrook literals (ac46d790c3), then the release's lockfile bump (new
  three@0.165.0 patch hash) invalidated the branch-only inscription-tome source
  fingerprint, re-minted via scripts/assets/remint_lockfile_fingerprints.mjs with the
  four test pins advanced and the media manifest regenerated (geometry unchanged; only
  extras stamps moved). Release-merge-audit (six-agent fan-out): five clusters clean,
  the tome fingerprint was the single blocking find (fixed), all Phase 07 premises
  CONFIRMED-INTACT (release touched no profession/recipe/content sim files, no resetDay
  plumbing, no mail, no market/bank; zero new routes or WS commands; the rift forge gate
  refuses three pre-existing rift_* wire tokens behind RIFT_FORGE_ENABLED and cannot
  collide with extract_essence or any craft command; db-mock trap cannot fire, the
  branch added no server/db exports).
- THE TEN-ROW MAPPING (R13 rung, one intermediate per craft at skill 75):
  weaponcrafting -> Duskforged Billet (duskforged_billet), armorcrafting -> Forgefold
  Plating (forgefold_plating), leatherworking -> Wyrmhide Cording (wyrmhide_cording),
  tailoring -> Sunspun Bolt (sunspun_bolt), jewelcrafting -> Prismglass Setting
  (prismglass_setting), engineering -> Precision Chassis (precision_chassis),
  alchemy -> Quickening Catalyst (quickening_catalyst, the rung itself and the time
  gate), cooking -> Seasoned Stock (seasoned_stock), enchanting -> Lucent Reagent
  (lucent_reagent), inscription -> Sablewax Vellum (sablewax_vellum, NEW name below).
  Recipe ids: recipe_<item id>. All ten are junk-kind common-quality materials per the
  profession_items.ts doctrine (never vendored by the junk sweep).
- R15 NAMING VERDICTS (web-verified 2026-08-11): Sablewax Vellum CLEAR (zero exact
  hits for the compound and for the coin Sablewax; searches decompose to sable the
  heraldic ink-black tincture plus wax/vellum, generic scribal vocabulary; no reuse of
  a registry coin). Rejected at authoring: Nightquill Vellum (Nightquill is a shipped
  item in Oaken Tower affecting start-of-combat effects, plus DQWiki's magic item
  "Nightquill's Award": same component-noun role, the Copper Torc rejection class) and
  Scrivener's Vellum (Scrivener and Vellum are both real writing-software products,
  Literature and Latte's Scrivener exports to the Vellum book formatter, so the phrase
  names their integration). In-repo neighbors checked: no "vellum" anywhere; quill
  appears only in deed names (Founder's Quill, Quill and Pigment), different surface.
- ENCHANTING STATION DECISION (the serial decision this phase owed): Lucent Reagent
  carries explicit stationType 'toolworks' and enchanting stays OUT of
  STATION_TYPE_BY_CRAFT, the same per-record pattern as jewelcrafting 'forge' (Phase
  05) and inscription 'apothecary' (Phase 06). Rationale: the only shipped enchanting
  recipes (the two tool-effect charms) already bind 'toolworks'; a per-record literal
  keeps the craft-absent pin green and defers the "home station" identity question to
  the apex phase where enchanting's three products land; no new station type is minted
  for one row; the professions_crafting_hub foreign-bound literal pin grows the new
  recipe ids in the same change.
- DEMAND MATH (phases 08/09 author against these numbers, not around them): each apex
  recipe (skill 100, three per profession, thirty total) consumes exactly 3 of its own
  profession's intermediate plus its gathered mats; each intermediate consumes 1
  Quickening Catalyst; the Catalyst is 1 craft per day per character, tradable. So one
  apex piece = 3 catalyst-days self-funded (or market-bought; tradability is the
  pressure valve), a full personal kit at the Masterwrought (2) equip cap = 6
  catalyst-days, and a ten-person raid mints at most 10 catalysts per day. Prismglass
  Setting carries ADDITIONAL demand beyond its apex pieces: 1 per Perfecting attempt
  (R1), so jewelcrafting's intermediate is deliberately the deepest market. Learning
  cost: all ten recipes are tier-3 trainer teaches at 4g each (TRAINING_FEE_BY_TIER[3]
  = 40000c), 40g for a completionist, the other real gate beside the daily catalyst.
  Sizing rationale: 3 days per piece sits in the classic daily-cooldown band, and the
  R5 five-percent envelope makes faster acquisition harmless but pointless to chase.
- PREMISE CORRECTIONS (live code contradicts three phase-doc premises; corrected here
  per the release-merge-audit discipline, none is a stop):
  1. The catalyst daily gate rides the wyrmfallDaily ctx.resetDay idiom
     (masterwrought_materials.ts refreshWyrmfallDaily + the sim.ts F1 load clamps with
     the 64-char date cap and zero-default serialize omission), NOT node_persist:
     node_persist stores remaining-time deltas against sim.time and cannot answer "has
     the calendar day turned". No new DDL either way, so the stopping rule is
     satisfied without stopping. utcDay stays a calendar stamp only.
  2. Craft refusal is NOT a sim_i18n emit. crafting.ts's own header forbids a
     ctx.error toast beside the CraftResult (single-surface doctrine); the refusal is
     a new typed reason code ('daily_limit') widened at FOUR sites (CraftResult.reason,
     the craftResult SimEvent union, CraftResultView in src/world_api/professions.ts,
     and the hud.ts reason-to-key ternary) plus its English hudChrome.crafting.* row.
     The S3 guard is structurally blind to this path, so coverage comes from a
     deliberate test, and the localization obligation is the client-side t() key, with
     the five non-Latin fills if M16 applies. The gate check lands in
     evaluateCraftAdmission (shared by cast-start, resolve, and batch auto-continue,
     so a batch stops itself), and the day STAMP lands in resolveCraftForRecipe on
     successful consumption (the admission fn is contractually side-effect-free).
  3. The nine non-catalyst intermediates have zero consumers until Phase 08, so they
     land in ALLOWED_UNCLASSIFIED_JUNK (material_taxonomy) and the bag_filter ALL_ONLY
     list, the wyrmfall_core precedent, each with a removal obligation minted for the
     phase that adds its consumer (08/09/10). The Catalyst derives IN automatically
     (nine in-phase consumers) and instead moves HONEST_MATERIALS plus the
     craftIdsForMaterialItem consumer-set pins in material_profession_affinity.
- GATE STATE IS SERVER-PRIVATE (Phase 04 precedent): no new IWorld member or wire
  field for the catalyst cooldown readout; the player learns of the refusal on
  attempt, matching the wyrmfall gate; the readout remains the Phase 14 UX obligation.
- SCAFFOLDING CONVENTION for the ten rows: skillReq 75, itemLevelBudget 20, level 20
  (the shipped 75-band convention: CASTER_HUB_RECIPES, the 75-skill TOOL_RECIPES, and
  recipe_stormreel_fishing_rod). New rows go in a NEW exported array spread into
  ALL_RECIPES; LADDER_RECIPES' 54-row shape is pinned and never grows. Every row
  carries at least one no-buyValue reagent (keeps the counterfactually-vendor-fed
  six-id pin frozen), never a base material and its fine_ grade together, and no
  arcane_shard (reserved for the apex band per Phase 04).

## Phase 07 ledger (2026-08-12, BUILT, gate PASS)
- GATE: gate_select PASS all 8 steps at the phase tip 9df9d1970c via the full-suite
  fallback (2669 test files / 36990 tests, browser suite 117, tsc, all builds) at
  GATE_MAX_WORKERS=5; ci:changed exit 0; portrait manifest fresh at the tip (three
  full 230-portrait receipt rerenders this phase, every one byte-identical to the
  committed webps).
- SHIPPED: the ten R13 intermediates per the pre-fan-out mapping (item ids as
  registered; recipe ids recipe_<item id>; INTERMEDIATE_RECIPES spread into
  ALL_RECIPES), all 75/20/20 trainer-taught station-bound; the Quickening Catalyst
  daily gate (oncePerDay on the recipe record; PlayerMeta.craftDaily on the
  wyrmfallDaily ctx.resetDay idiom with the F1 load clamps, a live-gated-id
  anti-tamper filter, zero-default serialize omission; refusal reason daily_limit
  widened at the four sites; the stamp in resolveCraftForRecipe after consumption);
  ten SVG-placeholder icons with provenance under
  docs/achievements/masterwrought-phase07-art/ and titles in the authoring bytes;
  English names + hint lines + the five non-Latin fills for twelve wordy values;
  wiki rows carrying oncePerDay with the Once per day badge (styled) on
  /wiki/professions; the crafting window states the gate before the attempt (chip,
  tooltip line, aria clause) and caps every batch affordance at one via
  maxCraftBatchFit; the craft-denial key map extracted to the
  craft_denial_line_view pure core (hud ceiling LOWERED to 19500); parity goldens
  re-minted for the sampled craftDaily field (rng and event digests byte-identical,
  verified independently three times).
- COMMITS: 3da891050c sim gate, 584fb07801 content+art, fb1b2b3f6b ui+i18n,
  9231f83d0e tests+goldens, ffaf0561b5 item-art audit, d2aeb03e2f parity goldens,
  42a551600f svg titles, c72f7e8a90 + 312177d47f review fix round, 034433a8cb QA
  fixes + wiki gate field, 4b17d34efa portrait re-bless, 9df9d1970c scoped-review
  fixes. Sync side: 7bfb608edc v0.37.0 merge, ac46d790c3 + c8e5ab96f4 re-mints,
  e46e5416aa pre-fan-out ledger.
- REVIEW ROUNDS (all findings applied unless noted): six domain reviewers, then a
  fresh fix-round review, then the qa-checklist gate (its own full gate_select run
  caught three guard suites no reviewer carried: professions_blob_growth
  classification, the gathered-provenance partition, the taxonomy bootstrap count),
  then two scoped re-reviews of the QA fixes. The scoped round's two real catches:
  the provenance pin guarded commission eligibility while signing rides the #1149
  def-QUALITY rule (the replaced loops were tautologies; the live pin now holds
  every crafted junk-kind output below signable rarity), and the blob byte bound
  had rotted to 16 real bytes of headroom behind a one-sided band (re-minted at 12
  KiB per the file's own step precedent, band now two-sided at 10064..10384 around
  the measured 10224, craftDaily itself is 76 bytes).
- REFUTED WITH REASON (do not re-raise): reclassifying the nine intermediates as
  honest materials now (frontend round) violates the every-material-has-a-consumer
  doctrine the taxonomy derivation enforces; the wyrmfall_core allowlist road is
  the shipped precedent, the kind line reads Junk only until Phase 08's consumers
  flip them mechanically inside this same PR. Extracting the craftDaily load clamp
  out of sim.ts (QA nit) would split it from its wyrmfallDaily sibling arm;
  declined for symmetry. The daily-before-not_learned ladder corner needs a
  DB-tampered row to reach post-clamp; accepted and documented at the ladder.
- ACCEPTED ASYMMETRIES (documented in code, pinned in tests): gate state is
  server-private (Phase 04 ruling; the affordance caps on the STATIC half only, so
  after today's craft the row still offers one and the player learns on attempt;
  readout remains the Phase 14 UX obligation); the calendar-less crossing (a
  ''-dated stamp meeting a live calendar opens; a live-dated stamp on a
  calendar-less host gates permanently); offline stamps are session-scoped
  (serializeCharacter has server callers only).
- DEMAND MATH (binding for 08/09): confirmed live-and-exact by the content
  reviewer: one catalyst per intermediate (nine consumer rows), catalyst tradable
  and oncePerDay; 3 intermediates per apex piece stays the forward commitment.
- PHASE 08 OBLIGATIONS MINTED HERE: remove each intermediate from
  ALLOWED_UNCLASSIFIED_JUNK + the bag_filter ALL_ONLY list as its consumer lands
  (per-id comments in the tests); author BASE_MATERIAL_TIERS rows for the ten (they
  read tier 0 today, inert while no output can masterwork, live the moment apex
  gear consumes them); the crafts_to_mastery pool EXCLUDES daily-gated chains, so
  apex-phase authors must not expect gated rows to enter the pacing model.
- RELEASE-FILL FLAGS: 235 pending rows from this phase (225 Latin plus the ten
  non-Latin rows for the two short oncePerDay badge keys; ten item names, the
  hint keys, dailyLimit, oncePerDay badge, guide key; the QA session re-counted
  the phase ledger's "about 195" against the registry, and the wordy values
  number thirteen, not twelve); the five
  non-Latin dailyLimit fills were authored against the pre-reword English and
  re-verified faithful after the second-person reword (the reword-staleness
  registry recorded them translated against the NEW hash without human re-review;
  maintainer should not assume register match); ko sablewax_vellum chose the
  common 양피지 over the precise 독피지, ru sunspun_bolt uses the long bolt-of-cloth
  form; alternatives recorded in the Task D report if the register should change.
- QA FOLLOW-UPS FOR PHASE 07 QA (deferred with owner, not filed): a mobile look at
  the catalyst tooltip's nine-craft Used-by line (longest wrapped tooltip sentence;
  the capture rig lives with the QA session); the ten icons were visually reviewed
  by the build session (all ten webps opened and judged against the
  woc-item-icon-v1 register before the audit verdict was extended), which the QA
  session should confirm stands for the owner review the verdict prose asserts.
  BOTH CLOSED at the Phase 07 QA with evidence (the mobile capture at
  docs/screenshots/masterwrought-phase07/catalyst-usedby-mobile.png and the
  re-viewed icon set); the closure record is the QA ledger below.
- ROLLBACK NOTE (operator): rolling the server back past this phase erases every
  character's craftDaily at their first autosave under old code (the pre-phase
  serializer rebuilds the blob), re-opening the catalyst day; same known property
  as wyrmfallDaily, recorded, not engineered around.
- DURABLE LESSONS: a phase that adds a recipe consuming a CRAFTED reagent must
  check the crafts_to_mastery pool (its gathered-units metric prices crafted
  reagents at zero and will reroute the model through them); the craft-denial
  reason-to-key mapping is enforced by the exhaustive Record in
  craft_denial_line_view.ts (a tsc-only gate: the profession_identity_card
  source pins hold only the reason-agnostic hud delegation call shape, so
  widening the reason union reds tsc and the table test's membership
  assertion, never those pins; corrected at the phase 07 QA, which also added
  the membership assertion); biome error-gates committed SVG sources on a11y
  noSvgWithoutTitle, so authored SVGs carry their display-name title from birth.

## Phase 07 QA release sync (2026-08-12, merge c2ad3b0176, the QA session's Step 0)
- RELEASE SYNC: origin/release/v0.37.0 moved to 94333011cc (9 commits: account
  general chat quotas incl. the admin rate-limit UI and HUD denial routing, and
  parse threat/health/resource-pool sampling); merged as c2ad3b0176 on top of
  396d4d7971. One conflict, the generated pending.ts, resolved by regeneration
  (i18n:gen + i18n:hash --write). Post-merge guards all green: the three naming
  scrubs 26/26 (the merge brought ja/ko/ru/zh_CN/zh_TW overlay rows), the
  portrait trio fresh with no re-mint owed (placeholder_art_completion +
  mob_portrait_source_manifest 20/20), pnpm-lock.yaml untouched so the
  inscription-tome fingerprint family stands.
- MERGE AUDIT (six-agent fan-out, full reports in the session task output):
  CLEAN apart from the ratchet collision below. server/game.ts reconstructs
  byte-for-byte from a clean three-way (every branch seam verbatim incl. the
  extract_essence dispatch; the quota admission sits entirely inside case
  'chat', a sibling case, and cannot swallow or reorder branch dispatch).
  src/sim/types.ts carries both sides exactly (branch 202-line patch verbatim;
  release added only the optional error-event fields). All five overlays
  verified key-by-key: every branch-added/changed row survived with branch
  values, release chatQuota fills intact, parent key sets disjoint, the
  detonateHellfireBrand deletion stayed deleted. The catalog delta is purely
  additive (three new hudChrome.chatQuota.* keys with their five non-Latin
  fills), so no reword staleness. The release added exactly one endpoint
  (admin general-chat-rate-limit) as a proper dual-arm RouteDef WITH its
  surface-inventory row; no new WS commands; no export changed signature; the
  new db mocks are release-owned full factories and the branch adds no
  server/db exports, so the stale-mock trap is empty. Every phase 07/08
  premise re-confirmed intact: nothing incoming touches crafting.ts, the
  craftDaily arms, ctx.resetDay, the denial chain, or the wiki oncePerDay
  generator.
- RATCHET COLLISION (the one blocking find; MERGE FALLOUT, not a phase 07
  defect): the union of both parents put hud.ts at 19503 vs the branch's
  19500 ceiling (base 19428; branch +18 net after the phase 07 extraction;
  release +57 of chat-quota HUD wiring under its own still-19600 ceiling), so
  monolith_budget was red at the merge commit while both parents were green.
  Fix per the ratchet: the sixteen display-name/narrative resolvers
  (itemDisplayNameFromSource through delveDisplayName) moved VERBATIM out of
  hud.ts into the new pure core src/ui/entity_display_core.ts
  (UI_PURE_CORES-registered; paired tests/entity_display_core.test.ts pins the
  routing arms: known-vs-unknown FromSource reversal, stack suffix, and the
  entityDisplayName ownership/necromancy/kind ladder). hud.ts 19503 to 19431,
  ceiling LOWERED 19500 to 19490. Both hud source pins survive by
  construction: localization_coverage's dungeonDisplayNameFromSource token now
  matches the import + call sites, and gather_event_i18n pins the CALL text at
  the localizeLootText arm, which stays in hud.ts. questlog_window's private
  questTitle/questNarrative/questObjectiveLabel/npcDisplayName copies are
  PRE-EXISTING duplication, recorded as a later unification candidate,
  deliberately not touched at a sync.
- ERROR EVENT SHAPE NOTE: the release widened the error SimEvent with optional
  server-authored code/channel/retryAfterSeconds fields (stable codes
  general_chat_quota*), and hud.ts now routes error events through
  generalChatQuotaView BEFORE localizeErrorText. Masterwrought refusal paths
  verified unaffected (the text-free daily_limit reason rides its own typed
  channel, not error-event text). A shipped structured-error idiom now exists;
  consider it for the Phase 14 catalyst-cooldown readout instead of a new
  matcher row.
- The QA prompt's premise "branch tip is 396d4d7971" is superseded by this
  sync; the implementation diff under audit stays e46e5416aa..396d4d7971, and
  this sync's commits (the merge + the extraction) are the Step 0 record.

## Phase 07 QA ledger (2026-08-12, verdict PASS)
- SCOPE: the implementation diff e46e5416aa..396d4d7971, audited at tip 4d1483e20b
  (the Step 0 sync above; release unmoved at 94333011cc at audit start). Floor
  first: the 30-file validation list (791 tests) and the full parity gate green
  at the tip before any auditor ran.
- FAN-OUT: a five-dimension ultracode workflow (correctness, gate-abuse,
  decisiveness in an ISOLATED worktree with ten mutation probes all
  red-as-expected, consistency, cleanup; twelve agents including the
  adversarial verify pass) plus architecture-reviewer, migration-safety, and
  test-coverage-auditor via the Agent tool, then a fresh fix-round reviewer
  over the QA's own commits (twice) and the qa-checklist completion gate
  (verdict READY). ZERO blocking findings in the shipped phase; the two
  blocking finds landed in the QA sync's own extraction test (below).
- FIX ROUND (commits d87d75f059, 404fdf960f, b115ce5315, e522b94a35,
  d7af094f7f, 8d66166ecb; every finding applied, none deferred):
  - The reverse calendar crossing (a live-dated stamp on a calendar-less host
    gates permanently) had NO pin anywhere while this ledger claimed
    pinned-in-tests; the decisiveness prober's mutation dropping the resetDay
    guard clause survived 154 tests. Pinned now (stamp unmutated, second
    attempt refuses), which is what makes the accepted-asymmetries row above
    true.
  - The entity_display_core *FromSource reversal pins were vacuous under en
    (the known arm and the passthrough are byte-identical; deleting the whole
    lookup stayed green): now under es with positive controls, plus the
    localized stack-count channel (x1,234), the sim-authored owned-mob name
    arm (Bladed Echo), and routing pins for the eight untested exports. The
    owned-mob arm depends on the es aura fill staying non-English (fails
    loudly, never silently, if that regresses).
  - craftDaily load clamp source fix: a date whose stamps all filtered away
    re-serialized {date, crafted: []} forever; the date now resets with the
    stamps (pinned both halves), restoring the omission's byte-identity claim.
    Non-object tamper shapes pinned. The wyrmfallDaily sibling deliberately
    keeps its date (no live-id filter there; divergence documented at the
    clamp).
  - The parity blind spot: every golden sampled craftDaily inert, so the
    refusal path never touched the draw-order detector. professions_craft
    gained a daily-gate arm (catalyst at an apothecary under a live calendar:
    one proc draw on the success, zero on the daily_limit denial, the stamped
    row in the state digest; coverage pins the four-draw total), golden
    re-minted scenario-scoped, twice (the second after switching the move to
    the file's own teleport helper: the hand-rolled copy left pos.y at spawn
    height and the spatial bucket stale, a latent divergence for any future
    tick).
  - Decisiveness hardening: consume pricing snapshotted BEFORE the craft (the
    planner runs pre-consumption in production); the ten intermediate reagent
    bills pinned as a literal table (a gathered-count retune previously
    redded only the wiki freshness mirror); the crafted-junk provenance sweep
    pins the masterwork signing arm (the slot-less premise was unasserted);
    the denial table gained a membership assertion over the now-exported
    Record while its keys stay hand-written literals; the identity-card suite
    reads every source comment-stripped through one anchored helper (the raw
    sibling describe and the CSS reads were strippable) with a quote-tolerant
    stationRequired negative; the blob band note dropped its stale phase 06
    measurement; the census caps documented as forward-armed; the daily chip
    gained its stylesheet-reach pin (co-application + a live
    .crafting-duration-chip rule; the class itself is a semantic/test hook
    with no rule by design, stated at the mint site).
- LEDGER CORRECTIONS (commit d7af094f7f + this section): the durable-lesson
  identity-card sentence was wrong (the pins hold the reason-agnostic hud
  delegation call shape only; corrected in place); the release-fill count is
  235 pending rows (225 Latin, 10 non-Latin: the two short oncePerDay badge
  keys across the five non-Latin locales) and thirteen wordy values.
- DEFERRED FOLLOW-UPS CLOSED (owner confirmed):
  - (a) The catalyst tooltip's nine-craft Used-by line verified on MOBILE
    through the REAL touch path: a long-press peek at a vendor, the one bag
    context where the peek is reachable (TOUCH_DRAG_HOLD_MS 320 beats
    TOOLTIP_PEEK_MS 950 and cancels the peek whenever the row is draggable;
    with a vendor open the drag payload is null). The sentence wraps to three
    clean lines at 844x390 landscape, lowest preset, nothing clipped;
    evidence committed at
    docs/screenshots/masterwrought-phase07/catalyst-usedby-mobile.png.
  - (b) The ten intermediate icons re-viewed by the QA session as the owner
    review the audit verdict asserts: the woc-item-icon-v1 register holds
    (opaque dark grounds, single centered subjects, distinct silhouettes; the
    two vessels separate by shape, color, and the catalyst's motion strokes;
    forgefold_plating is the lowest-contrast of the ten but its silhouette
    reads), all ten mapping.json provenance rows verified. The build
    session's review STANDS.
- RECORDED, NO CODE CHANGE (ops/deploy/design notes from the fan-out):
  - Ops: sim.resetDay is recomputed per tick from the realm clock with no
    monotonic guard, so a backwards realm calendar (TZ or config regression)
    silently re-opens the day; recorded like the wyrmfall equivalent, not
    engineered around.
  - Replay: a daily_limit refusal skips the resolve's one to two output draws
    and the gate keys on the HOST calendar, so any future harness replaying a
    command stream against a seed must capture resetDay beside the seed.
  - Crash window: a crash after the day's craft but before the autosave can
    net an extra catalyst if the crafted copy moved off-character first;
    inherent to crash-rollback semantics, shared with every daily gate.
  - Persistence wording: the byte-identity claim is per-character until FIRST
    participation; the first successful craft moves a character permanently
    onto a bounded 45-to-108-byte craftDaily residue (the date never resets
    to ''; wyrmfallDaily-identical).
  - Rollback tightening (verified): the rollback erase is inert under old
    code (no key sweep, content revision unchanged, no migration re-fires)
    and exposure is realm-scoped (characters are realm-keyed and writes are
    lease-fenced, so no mixed-fleet writer pair exists).
  - Deploy: an OLD client bundle against a new server renders the generic
    materials line for daily_limit until the bundle updates (the pre-phase
    ternary's fall-through); wrong-but-not-blank, self-heals on update.
  - Affordance host note: after today's craft the OFFLINE window previews 0
    (it reads the live meta) while the ONLINE row still offers one (the
    server-private stamp, the recorded Phase 04 ruling); a host difference by
    design, not a defect.
  - hud.ts toolEffectRecharge reason ternary (shipped 2026-07-29): the
    pre-existing un-extracted sibling of the extracted denial family,
    recorded as an extraction candidate (the questlog_window precedent),
    deliberately not extracted at a QA.
  - The shipped_item_ids golden's +70 diff lines include sixty pre-existing
    neighbors' churn; verified additions-only for the ten ids.
  - Judged not defects: the hand-written denial table (deriving its VALUES
    from the Record would be the self-comparison trap; membership is now
    derived, keys stay literal); the census cap asserts (forward-armed for
    the first second gated recipe, stated in the comment); the pre-phase
    fixture's delete (kept, after a premise assert).
- GATE: node scripts/gate_select.mjs PASS (exit 0, unmasked, all 8 steps,
  vitest workers 5) at the code tip 8d66166ecb; portrait manifest fresh at
  that tip and re-checked at the docs close.
- NEXT: Phase 08 (apex armor catalogs) in a fresh session per the cadence,
  its own release sync first. Phase 08 authors against the demand math above
  and pays the per-id allowlist removal obligations as each consumer lands.

## Phase 08 pre-authoring ledger (slot coverage audit, 2026-08-12, recorded BEFORE any item row)
- METHOD: deterministic sweep, not greps: an esbuild-bundled script imported the merged
  `ITEMS` table plus `itemLevel` (src/sim/item_level.ts) and grouped every epic and
  legendary `kind: 'armor'` def by (armorType, slot), classifying source by membership:
  HEROIC_ITEMS, RETIRED_HEROIC_ITEMS, the nythraxis raid mob loot list, RIFT_EPIC_ITEM_IDS,
  HEROIC_VENDOR_ITEMS, WARFARE_ITEMS, heroicOf variants. Coverage band: acquirable PvE
  epics at item level 29 or higher (raid 29, heroic five-man 31, rift clear 31). Counting
  rules: a heroic variant counts as its base identity (same drop, upgraded); the four
  RETIRED_HEROIC_ITEMS count as uncovered (not acquirable); PvP honor gear is excluded
  (honor currency, pvp-rating stat shape, not the PvE progression the apex band competes
  in); defs with no derivable item level (sunken_reliquary_hood, siltstep_leggings,
  blackwater_vanguard_chest) are excluded as unobtainable legacy. The heroic vendor sells
  jewelry only, so it contributes zero armor coverage (swept, confirmed).
- COVERAGE COUNTS (acquirable PvE epics, ilvl 29+, per armorType x slot):
  - mail: helmet 4 (crownforged_dreadhelm, stormcallers_crown, cryptplate_helm,
    choirmothers_casque), shoulder 4 (crownforged_warspaulders, stormcallers_spaulders,
    mistforged_pauldrons, choir_blessed_spaulders), chest 3 (emberforged_bulwark,
    morthens_cryptforged_hauberk, sunbone_ritual_hauberk), gloves 2 (gravewyrm_claws,
    wyrmchoir_handwraps), WAIST 1 (gravescale_girdle), LEGS 1 (bloodmane_war_legguards),
    FEET 1 (tideworn_warboots).
  - leather: helmet 3 (nighttalon_crown, stormsunder_hood, tideguard_faceguard),
    shoulder 3 (nighttalon_shoulderguards, stormbark_mantle, tidebound_spaulders),
    CHEST 2 (basin_stalkers_tunic, verdant_heart_vestment; the slot also lost
    scourgehide_carapace to retirement), waist 2 (bonechill_cord, lunarward_cinch),
    feet 2 (bonechill_striders, dreamroot_boots), LEGS 1 (tidewoven_trousers),
    GLOVES 1 (sanctum_prowlers_grips).
  - cloth: shoulder 3 (soulflame_mantle, sunken_court_mantle, voidweave_mantle),
    helmet 2 (soulflame_cowl, sunbone_oracles_crown), CHEST 1 (shroud_of_the_gravewyrm),
    waist 1 (sash_of_the_sunken_court), LEGS 1 (lunar_choir_leggings),
    GLOVES 1 (shadowpulse_handwraps), feet 1 (shadowpulse_slippers).
- SLOT PICKS (weakest-covered first; ties broken by exact-31 depth, then retirement
  holes, then budget impact, then the plan default; exact-31 depth TIES across every
  tied cell below, so the recorded reasoning starts at retirement holes: verified at
  the 2026-08-13 QA, every member of the tied leather and cloth cells is an
  acquirable ilvl-31 heroic drop):
  - armorcrafting (mail): WAIST, LEGS, FEET (all at 1). OVERRIDES the plan default
    chest/legs/waist: mail chest is the best-covered mail body slot (3; body here
    means the non-head/shoulder slots, since helmet and shoulder sit at 4; the
    three count-1 slots are the unique argmin either way).
  - leatherworking (leather): LEGS, GLOVES (both at 1), CHEST (third pick: the 2-count
    tie among chest/waist/feet breaks to chest on the retirement hole and the largest
    budget, 22 vs 15 vs 14). OVERRIDES the plan default chest/shoulders/feet.
  - tailoring (cloth): CHEST, LEGS, GLOVES (five slots tie at 1; the three largest
    budgets are chest 22 and legs 20, then gloves ties waist at 15 and feet at 14 sits
    below; the plan default settles the gloves-vs-waist tie). CONFIRMS the plan default
    (robe is `slot: 'chest'`; there is no robe slot).
- ARCHETYPE GAPS inside the picked slots (the stat-shape steer; band = ilvl 29+):
  int-mail has ZERO coverage at waist, legs, and feet (shaman casters cannot fill those
  slots at the band at all); str-mail has exactly 1 in each. Caster-leather (int/spi)
  has ZERO at legs and gloves; agi-leather has exactly 1 in each. Cloth is single
  archetype (int). STAT-SHAPE RULE for the authoring slices: each craft covers BOTH
  wearer archetypes of its armor class; zero-coverage archetype cells are filled first;
  the largest-budget slot goes to the armor class's majority archetype (deterministic
  crafted access beside the lone RNG drop). Applied: mail legs str/sta (majority,
  2 of 3 mail classes), mail waist int, mail feet int; leather chest agi/sta (majority),
  leather legs int/spi, leather gloves int; cloth all int-based with the spi/sta
  split and ratings decided per the heroic policy (healer-facing pieces never take
  Hit). (OUTCOME, recorded at the build; the never-Hit clause restored at the
  2026-08-13 QA after the ledger close 063842c7ab dropped it without an amendment:
  all three cloth pieces shipped int/spi, since the three PICKED cloth cells'
  references all ship int/spi (the band's int/sta cloth sits in unpicked cells:
  sash_of_the_sunken_court and the soulflame pair, plus the pair's
  auto-generated heroic variants); the original "spi/sta split"
  phrasing named the decision, not a mixed result. The never-Hit clause was JUDGED
  at the build, not violated: the catalog classes healer-facing by an authored Hit
  seed (heroic_variants.ts), not by int/spi wholesale, so Hit landed on
  sunspun_vestments per the RULINGS TAKEN IN-PHASE bullet below.)
- BUDGETS (law, primaryStatBudget at ilvl 31 epic): chest 22, legs 20, waist 15,
  gloves 15, feet 14. Ratings: the whole 31 band carries exactly ONE rating at 40
  (heroic_loot.ts ARMOR_RATING, rift RIFT_ARMOR_RATING); every apex piece takes exactly
  one of hit/crit/haste at 40, pinned literally in the new sweep test. Armor values are
  copied from the same-band same-slot same-armorType reference piece (every picked cell
  has an ilvl-31 reference), never invented.
- SHIELD OBSERVATION (recorded, out of scope): mail offhand has a single raid shield
  (bonewrought_bulwark); a crafted shield is a real gap but blockValue has no
  formula-derived budget, so it fails this phase's every-budget-formula-derived bar;
  left for a future ruling.
- REAGENT BILLS (quantities recorded per the acceptance criteria; uniform per craft,
  the binding cost is the 3 catalyst-days per piece from the phase 07 demand math):
  every apex armor recipe consumes exactly 3 of its own profession's intermediate
  (demand-math law) plus 2 wyrmfall_core plus the craft's gathered family:
  armorcrafting = forgefold_plating x3, wyrmfall_core x2, thorium_ore x4, iron_ore x2;
  leatherworking = wyrmhide_cording x3, wyrmfall_core x2, rough_hide x4,
  pristine_hide x1; tailoring (3 pieces AND the bag) = sunspun_bolt x3, wyrmfall_core x2,
  spider_silk x4, pristine_silk x1. Wyrmfall sizing rationale: 2 per piece keeps the
  core a raid/heroic tie without displacing the catalyst as the pacing gate (a raid
  mints 1 to 3 per member per clear day plus the 12-mark vendor valve). Recipe fields:
  level 25, skillReq 100 (R13), itemLevelBudget 25 (gold fee only), acquisition
  ['drop'] (R8; patterns land phase 11), stationType per craft (forge, tannery, loom,
  keeping the per-craft wiki station field unanimous), resultCount 1, no oncePerDay.
  sellValue: strictly below input value per the recipe economy invariant (the
  jewelcrafting precedent; vendor value is not power).
- BAG: the tailoring apex bag ships bagSlots 16, one step past the shipped ceiling
  (mistcallers_duffel, epic, 14) on the established 2-slot quality ladder
  (6/8/10/12/14), epic quality, tradable, NO masterwrought flag, no item level
  (kind bag is not item-level eligible).

## Phase 08 ledger (apex armor catalogs; built + five review reports applied, 2026-08-12)
- SHIPPED: nine apex epic armor pieces at the audit's slots (mail spiritweld_girdle
  waist / forgefold_legguards legs / wardspeaker_sabatons feet; leather
  briarstep_jerkin chest / fenbloom_breeches legs / barksong_handguards gloves;
  cloth sunspun_vestments chest / sunspun_leggings legs / sunspun_handwraps gloves)
  plus the tailoring apex bag sunspun_haversack (16 slots, one 2-slot step past the
  duffel, NO masterwrought flag). Every primary sum EQUALS primaryStatBudget(31,
  'epic', slot); exactly one rating at the band's 40, each COMPLEMENTING its
  same-slot reference drop (spread: crit x5, haste x3, hit x1); armor values copied
  byte-equal from the named ilvl-31 references; equip level DERIVED (source 25
  clamps to MAX_LEVEL = 20, no hand-authored override; the sweep pins
  requiredLevelFor AND the override's absence, so a lost recipe source reds at the
  18 quality fallback instead of hiding); tradable per R2; R14 held by a whole-def
  key whitelist. APEX_ARMOR_RECIPES (ten rows, spread into ALL_RECIPES): skillReq
  100, level 25, itemLevelBudget 25 (fee only), acquisition ['drop'] per R8,
  stationType per craft (forge/tannery/loom, wiki unanimity kept), bills exactly
  the pre-authoring ledger's (3 own intermediates per the demand-math law +
  2 wyrmfall_core + the gathered family). Art: ten hand-authored SVG sources +
  a source-READING rasterizer variant under docs/achievements/masterwrought-
  phase08-art/ (sha-pinned README), 128px WebPs, woc_original_svg mapping rows,
  CREDITS row, the item-art audit admission (reviewed 850 to 860, live 865 to
  875, armor/bag census bumps, shipping digest re-acknowledged, evidence
  re-minted via --refresh-verdict, CLI/builder/consistency pins advanced; all ten
  owner-reviewed on the opaque house ground in-session). i18n: ten ITEM_ENTITY_IDS
  + APPENDED_ITEM_NAMES appends, M16 fills in all five non-Latin overlays for the
  ten names plus guide.gear.masterwroughtTitle/Body plus
  guide.profPages.sourceDrop. The /wiki gear page gained its Masterwrought section
  (closing the phase 08+ open item; rule-level, spoiler-safe, tag coins reused).
  tests/masterwrought_budget.test.ts born (see the sweep paragraph below).
  Shipped-ids golden re-minted, verified additions-only (exactly the ten).
  Portrait source manifest re-minted TWICE (230/230 byte-identical rerenders):
  the first re-mint predated two later source commits and went stale again,
  which the qa-checklist's full-suite run caught; the second ran at the true
  final tip. The phase 06 lesson, sharpened: re-mint LAST, after every
  source-affecting commit, and let the full gate confirm it.
- THE SLOT AUDIT drove the picks (see the pre-authoring ledger above): mail
  waist/legs/feet and leather legs/gloves sat at band coverage 1, leather chest won
  its 2-tie on the retirement hole + budget; the audit OVERRODE the plan defaults
  for armorcrafting (chest out, feet in) and leatherworking (shoulders/feet out,
  legs/gloves in) and CONFIRMED tailoring. The audit committed BEFORE the first
  item row (ab683da04d precedes 1b8bdd80a3), per the acceptance criterion.
- R1 MASTERWORK SUPPRESSION (the phase's one sim-logic change, arch-reviewed):
  the nine pieces are the first epic SLOTTED crafted outputs, which made the
  epic-to-legendary masterwork bump reachable for the first time (measured: a proc
  minted instances at 85 to 93 percent of a legendary sheet, +11 to +15 primary
  points, on a tradable piece; exactly the 1.9-mult cliff fork B exists to avoid).
  R1 already rules the apex proc grants a Perfecting head start INSTEAD OF a
  quality bump, so the suppression ships now: ONE module-local helper
  craftBonusStatsFor (crafting.ts) feeds both the admission capacity model and the
  resolve effect gate (hoisted so the twins cannot drift) and returns null for a
  masterwrought def. masterwork.ts is untouched (R1 locks the whole file, the
  reviewer confirmed the alternative seam is forbidden). The proc DRAW stays
  unconditional: draw order provably unmoved (parity 207 green twice, once after
  content, once after the guard). Pinned by a forced-roll arm (rng.next forced to
  0, archetype set so the Infinity ceiling cannot explain the pass, draw count
  asserted exactly 1) plus a proccing non-apex control, both mutation-proven.
- PHASE 12 OBLIGATIONS MINTED HERE: (a) the head start replaces this suppression
  at the EFFECT GATE (the masterwork boolean in resolveCraftForRecipe), where
  procRoll < procChance is actually known; the helper runs before the draw and
  cannot see the outcome. (b) The proc outcome on an apex craft is currently
  DISCARDED, not deferred: ctx.bumpDeedStat('masterworksCrafted'), the
  masterwork:first mark, and the per-craft masterwork:<craftId> reliquary mark all
  key off result.masterwork, which the guard forces false. Phase 12 decides what a
  head-start proc credits. (c) The tier feed stays meaningful THROUGH the
  suppression: masterworkProcChance still computes (the apex bills all feed 0.02,
  pinned), so the head-start chance math is already in place.
- RULINGS TAKEN IN-PHASE (flag for QA / the maintainer):
  - Five of nine pieces are numerically IDENTICAL to their reference drop except
    the rating (fresh-review S3): the deliberate outcome of the audit's stat-shape
    rule (band shapes are canonical; cloth is single-archetype so all three cloth
    pieces sit on the drop profile; mail legs went to the majority archetype
    beside an existing str legs drop). Differentiation is deterministic access
    plus the rating complement, the Wrath crafted-complementarity lever the
    research memo endorses. The complement is now MECHANICAL (the sweep asserts
    the reference drop does not carry the apex piece's rating field). Re-split if
    the maintainer wants distinct silhouettes.
  - Hit landed on sunspun_vestments, the most spirit-heavy piece: kept, because
    chest is the ONLY cloth slot whose reference drop does not already carry Hit
    (lunar_choir and shadowpulse both do), and the shipped catalog demonstrably
    does not class int/spi cloth as healer-facing for the never-Hit clause. The
    healer route keeps the crit drop chest.
  - Deeds: NO deed owed (content-review PASS, recorded as a considered ruling):
    crafted tradable items are not conquerable content under docs/design/deeds.md;
    the craft_rare:<craft> milestones already fire on any rare-or-better output
    and all three exist. The packet's own Masterwrought deeds are phase 13's.
  - Reliquary: NO page owed (same review): the catalog curates conquerable unique
    loot and holds zero crafted gear by precedent; a repeatably crafted tradable
    epic is not that. The phase 11 apex PATTERNS (raid/rift drops) are the rows
    that will owe pages. [SUPERSEDED at the Phase 11 build, decision 2: patterns
    take NO pages either (consumed-on-learn knowledge, not catalogued collectible
    gear; the kind-keyed carve-out in tests/reliquary_content.test.ts executes
    it). See the Phase 11 BUILT ledger.]
  - Vendor asymmetry ACCEPTED: apex epics vendor at 1.5 to 3 percent of their
    same-slot drops (the economy invariant binds sellValue strictly below the
    265c to 491c bills; vendor value is not power). Raising the intermediates'
    sellValues would ripple the phase 07 pins for no gameplay gain.
  - Tier 2 for all ten intermediates (the arcanite_bar refined-reagent precedent;
    tier 2 is the deliberate ceiling, masterwork.ts constants locked). The
    catalyst row's side effect on the nine intermediate recipes is recorded AT the
    table, pinned as chance inputs, and pinned EFFECT-DEAD (slotless junk never
    bakes a bonus; the arm reds the day an intermediate output gains a slot).
    wyrmfall_core stays deliberately untiered (availability premium, not
    refinement; every apex bill already maxes through its intermediate).
  - The wiki ships a real 'drop' acquisition arm NOW ("From a found pattern",
    with five non-Latin fills and a render-level row pin) rather than the old
    two-arm mapping's false "Known from the start"; the copy stays true when
    phase 11 lands the patterns, and the packet ships as ONE PR so 08 never
    reaches players without 11.
  - /dev tooling: pbe_boost gained enforceMasterwroughtCap (four role kits really
    hit 3 flagged pre-fix, a boot-time hard-throw; exported with injectable reads
    so the ring-refill and empty-fallback arms phase 09 lands on are executed
    synthetically today; kept picks = cap-highest by roleItemScore, demotion test
    derives its winners). /dev bis gained the same cap arm (it writes equipment
    directly, bypassing masterwroughtConflictSlot; measured zero flagged picks at
    rest since its score ignores ratings, so the live sweep is labeled a forward
    net and a synthetic over-cap arm carries the coverage). dev_kit is
    structurally safe for GEAR (FRESH_TWENTY_QUALITIES excludes epics) and its
    bag pick now hands the apex bag, KEPT: the prior pick was already the epic
    duffel, so no fresh-20 quality fiction existed for bags and a dev cheat is
    deliberately generous. bestBoostBag moves every PBE roster to 4 x 16 slots
    (covered by the derived pin, recorded here as the side effect).
  - crafts_to_mastery: the daily-gate exclusion is now TRANSITIVE (the apex rows
    never touch the catalyst directly but sit on its chain at 3 catalyst-days per
    piece; without the closure they hijacked the pacing model through reagents
    the gathered-units metric prices at zero and the climb pin redded, exactly
    the phase 07 durable lesson). New liveness arm pins the second hop
    positively before the negatives.
  - Tailoring carries FOUR apex rows (three pieces plus the bag): the demand
    math's "three per profession, thirty total" counts the gear-slot apex rows;
    the bag is the phase file's explicit extra, so the packet recipe total runs
    31 with it.
- THE SWEEP TEST (tests/masterwrought_budget.test.ts, grows with 09/10): two
  completeness arms force every masterwrought-flagged def AND every
  APEX_ARMOR_RECIPES output into the literal EXPECTED table. Per piece: primary
  sum vs BOTH the literal and the formula, the single rating (literal 40 as the
  band-law pin PLUS the ARMOR_RATING tie as the drift pin, deliberately both),
  the complement rule, armor vs the identity-pinned reference (slot, armorType,
  ilvl 31), derived equip gate, R2 texture, R14 whole-def whitelist (bag gets its
  own), the full recipe row with the literal bill, the per-def R12 surface
  (isDisenchantable + typedSecondaryFor vs the literally-pinned weave mapping),
  the rating-spread table, the bag capacity ceiling (strictly largest), and an
  apex-scoped economy arm. Decisiveness: five mutation probes red-as-expected
  (stat retune, rating swap, flag drop, R1 guard revert, plus the pin-audit's
  hand-traced synthetic arms). PHASE 09 NOTE: jewelry pins against the
  heroic-vendor JEWELRY_RATING band (25), not the armor 40; the EXPECTED table
  shape already carries the rating field per row.
- DURABLE TRAPS HIT THIS PHASE: (a) the mutation-test-uncommitted-revert trap
  fired LIVE (a git checkout after a probe wiped the uncommitted R1 guards;
  caught by grep, re-applied; the trap memory exists and was still stepped on:
  commit BEFORE probing). (b) A locale overlay insert anchored on a KEY line
  whose VALUE wraps to the next line breaks the file (five locales at once);
  anchor only on single-line rows (key and value on one line). (c) biome ci's
  error-vs-warning attribution is unreadable from the pretty reporter when 1284
  warnings flood one error; --reporter=github isolates ::error lines. (d) The
  turbo i18n cache served a stale dict after a catalog append (known memory;
  TURBO_FORCE=1). (e) The idle-no-report agent nudge was needed THREE times.
- REVIEW RECORD (five reports, everything applied or ruled-with-reason above):
  content-obligations (1 critical: the wiki mislabel, fixed same-day; 5 warnings;
  its verification round independently re-ran 15 suites and confirmed closure);
  pin-quality audit (1 blocking: the catalyst tier side effect; 8 should-fix; its
  verification round hand-traced the synthetic arms and confirmed, plus an
  addendum on the /dev bis arm); fresh whole-diff review (2 blocking, BOTH
  already addressed by the time of report: the masterwork instance overshoot and
  the tier comment; 6 should-fix incl. the requiredLevel doctrine catch and the
  /dev bis gap; 4 nits; plus i18n-quality items: three wording fixes applied
  (wardspeaker zh agent marker both scripts, ja guide register to the site term,
  ru full-tag quote), eight register nits recorded for the release-fill review);
  architecture (0 blocking; 2 should-fix applied: the craftBonusStatsFor hoist
  and the draw-count pins; seam judgment recorded: bonusStats-null in crafting.ts
  is correct and editing masterwork.ts is forbidden by R1's own text); the
  fix-round fresh review ran per the standing rule (its report and any late
  findings fold in before the QA phase).
- RELEASE-FILL OBLIGATIONS: thirteen new keys (ten item names, the
  guide.gear.masterwrought pair, guide.profPages.sourceDrop) pending across the
  sixteen Latin locales; the five non-Latin fills are machine-anchored for
  maintainer review with the fresh-review's eight register nits listed in its
  report (ja slot-noun drift and transliterate-vs-translate split, ru bridzhi
  register and the missing yo, zh manufacture-vs-craft verb, the calqued
  family-rule phrase, row placement, line style). QA ADDITION (2026-08-13,
  qa-checklist): the fill of guide.gear.masterwroughtBody in the fifteen
  pending locales must extend CAP_PROSE_BY_LOCALE in
  tests/masterwrought_cap.test.ts in the SAME change, or the cap-retune
  sweep goes blind to exactly the filled copies it exists to catch.
- VALIDATION: tsc clean; ci:changed exit 0; the phase suite matrix green
  (progression, recipe_economy, itemization_coverage, item_level,
  masterwrought_budget, shipped_item_ids, guide) plus the blast-radius set
  (material_taxonomy, bag_filter, item_icons, art gates x4, i18n gates x5,
  naming guards x3, professions suites, pbe_boost, dev_kit, dev_bis,
  crafts_to_mastery, blob growth, masterwork, cap/tooltip); parity 207 green
  TWICE (post-content and post-guard); portrait trio fresh. Gate at the docs
  tip recorded below.
- FIX-ROUND REVIEW ADDENDUM (the standing rule's fresh pass over the fix
  commits, delivered after the docs close; 5 should-fix + 3 nits + 2
  informational, ALL applied or recorded): the reliquary gear-capable model
  rebound to the exported craftBonusStatsFor (raw masterworkBonusStats left
  the drift detector blind to the R1 arm, the exact case phase 09/10 jewelry
  can create); the mastery-model closure gained its premise pins (unique
  producers across the catalog, and a tripwire that no pool recipe consumes
  wyrmfall_core or makers_ember, the two cadence gates oncePerDay cannot
  see), the EXACT excluded armorcrafting id set, a DELIBERATE SIMPLIFICATIONS
  bullet, and an honest mechanism comment (the closure fixes the EXPECTATION
  side of the climb pin; drop-taught rows fail the known-recipe gate and
  never enter the walk); the sweep's reference pins gained the quality
  dimension. Recorded for later phases: PHASE 09 makes the admission-side
  capacity twin load-bearing the moment an apex recipe ships resultCount > 1
  (today it is defense in depth, indistinguishable from the resolve twin);
  PHASE 11 owes the vendor-channel source label (R8's second channel would be
  mislabeled by the drop copy), must drop the PATTERN never the piece
  (makeHeroicVariant spreads ...base, so a flagged def in a heroic-eligible
  loot table would mint a flagged heroic variant), and owes the guide
  masterwork prose its apex clause (with phase 12); PHASE 12's head start
  must not write an instance quality field without re-visiting the R3
  legendary sub-cap (effectiveQuality reads rolled.quality ?? def.quality;
  crafts never write it today). The reviewer verified clean: the closure's
  termination and non-over-exclusion (all 20 members single-producer with no
  alternate acquisition), the enforcer call-site equivalence, the complement
  pin's premise across all nine references, the wiki mapping covering the
  whole live acquisition space (86 trainer / 10 drop / 18 grandfathered
  known), and no contradiction with R1/R2/R8/R12/R14.

- QA-CHECKLIST CLOSE (verdict applied): the hand-picked suite matrix missed
  FOUR catalog-derived pins the full run caught (the market bag-size filter's
  human-acknowledgement anchor gained '16'; the community test-account
  template moved to four apex bags at capacity 80, RULED accepted per the
  bestBoostBag/dev_kit precedent since the one-PR contract makes the bag
  obtainable at ship; the taxonomy bootstrap count 56 to 60; the portrait
  manifest re-mint, see the SHIPPED paragraph). The lesson is uniform and
  mechanical: at a phase close, run the GATE on the committed tip, never a
  hand-picked matrix; the gate's vitest-related arm traces the import graph
  and finds these without guessing. S2 recorded: from phase 08 until phase 12
  an apex epic is the one slotted craft that can never proc masterwork or
  credit masterworksCrafted / the masterwork marks; structurally safe because
  the delivery contract ships all sixteen phases in ONE PR (players never see
  08 without 12), flagged for the maintainer regardless. The apex bag row's
  recipe pins leveled up to the armor rows' depth. privacy-security-review
  dispatched over the narrow server/pbe_boost.ts diff (the one owed reviewer
  row); result recorded below or at the QA phase.
- PRIVACY-SECURITY-REVIEW: CLEAN, zero findings (the narrow formality the
  matrix predicted). Two INFO notes recorded for phase 09: the cap enforcer
  has no legendary sub-cap arm and the failure mode when a legendary-flagged
  def ships is a LOUD throw at boost time (buildBoostedCharacterState's
  verification loop), never a silent over-equip; and the injectable isFlagged
  seam is a second definition of "flagged" beside masterwroughtConflictSlot,
  so a phase that changes what counts as flagged moves both together.
- GATE: node scripts/gate_select.mjs PASS (exit 0, unmasked, all 8 steps,
  vitest workers 5, full-suite fallback: 2680 test files, 37204 tests) at the
  phase tip 0a556194a4 (the portrait re-mint commit); portrait trio fresh at
  the same tip. Branch still LOCAL, never pushed, per the standing rule.
- NEXT: Phase 08 QA (docs/prd/masterwrought/phase-08-qa.md) in a fresh session
  per the cadence, its own release sync first. The QA prompt's suite list
  should ADD the blast-radius suites this phase moved beyond its matrix:
  market_filters, community_test_accounts, material_taxonomy_bootstrap,
  mob_portrait_source_manifest, dev_bis_gear, professions_crafts_to_mastery,
  reliquary_content, and tests/server/pbe_boost. Deferred to QA with owner:
  the maintainer visual pass on the ten icons (the audit verdict is a
  self-review), the in-browser eyeball of the first live Masterwrought
  tooltip tag + the /wiki gear section + the "From a found pattern" source
  cell, and the S2 shipping-window note (structurally void under the one-PR
  contract, recorded for the maintainer regardless).

## Phase 08 QA release sync (2026-08-13, merge fa51741408; the QA audit itself runs in a follow-up session)
- RELEASE SYNC: the release fanned into TWO branches since the phase 08 close.
  origin/release/v0.37.1 is a hotfix line (0.37.1 version-surface bump, the
  PR #3363 queue-pop arming fix, a portrait re-bless) NOT contained in
  v0.38.0; merging it would poison the branch with 0.37.1 version surfaces,
  so the sync target is origin/release/v0.38.0 (tip 51b342bdae, 155 commits:
  the issue #3042 player item lock, the combat-rogue re-band 8c972a3cd3, the
  rift forge rollback migration, dockerignore fix, locale fills), merged as
  fa51741408 on top of d14adba5b9. Fifteen conflicts resolved hunk-level:
  crafting.ts keeps the release's onInventoryChangedForQuests hook (first,
  consumption-tied) AND the phase 07 oncePerDay stamp (second; neither draws
  rng, the hook never reads craftDaily, audit-verified); the bag context menu
  composes sunder with the release's lock/unlock rows; craft_denial_line_view
  gained the release's 'locked' reason exactly as its exhaustive-Record
  design intended (tsc red until the row landed, plus the literal table row
  in its test); pet_commands keeps the Duskmurk title over the release's
  EMPTY_TEST_WORLD ctor trim; eastbrook provenance re-minted (three literals
  advanced); portrait manifest re-minted via the full receipt flow (renderer
  fingerprint moved, so the guard demanded all 230 rows: 230/230 rerender
  BYTE-IDENTICAL, manifest written, accepted-art manifest pin advanced
  sha/bytes, evidence pin unchanged); pending.ts regenerated.
- THE COUNT-PIN TRAP FIRED A THIRD TIME: both sides read IWorld 321 and
  commands 198/211 pre-merge (branch extractEssence vs release setItemLocked
  / lock_item), git auto-merged the identical numbers, and the merged tree
  carries both. Set from suite runs: IWorld 322 (85 data / 237 methods,
  including the union-size pins at the facet-union test), commands 199/212.
  NOTE the wire token is lock_item; setItemLocked is only the IWorld member
  (the pin comment first said set_item_locked; corrected, and the merge
  commit message carries the slip immutably).
- POST-MERGE GREEN before the audit: tsc, parity 207 (goldens COMPOSE across
  the merge, no re-mint owed), the three naming scrubs 26/26 (the merge took
  363 overlay rows across 20 locales), portrait trio, eastbrook pair,
  monolith_budget (no ratchet collision this time), architecture, S3 +
  snapshots, masterwrought core suites 152, and the overlap suites
  (heroic_vendor, market_filters, item_copy_addressing_guard,
  professions_blob_growth, training_dummy, warrior_intervene,
  guide_key_coverage).
- MERGE AUDIT (seven-auditor workflow + six adversarial verifiers, all 13
  agents completed; full reports in the session task output): sim cluster
  proven an exact union mechanically (release-side change lines byte-equal to
  merged-vs-branch change lines across all six files); server/net/world_api
  seams verbatim (extract_essence dispatch beside lock_item, which also
  joined HEAVY_SELF_CMDS; extract_essence stays correctly outside it, the
  salvage_item cast-start rationale); no injected helper changed shape
  (item_copy_ref/sim_context untouched by the release); db-mock trap EMPTY
  (zero new vi.mock db sites); ci.yml delta is a shard timeout bump only;
  i18n delta purely additive with all six lock keys filled in all 20
  overlays (M16 satisfied by the release), branch keys all survive, admin
  overlays keep the Broodsworn rename over the release's Wyrmcult rows.
- FIXED AT THE SYNC (verified findings, mutation-proven where a pin landed):
  (1) pattern-learn wrong-victim: the recipe arm of useItem dropped the
  validated slotIndex, so with two copies of one pattern the lock-blind
  newest-first walk could destroy the copy the player did NOT click, the
  release's locked copy included. useRecipePatternItem now takes the
  selection and spends the exact clicked copy via consumeSelectedInventorySlot
  (id-only fallback byte-identical per the item_copy_ref frozen-fallback
  doctrine); pinned both ways in tests/recipe_pattern_items.test.ts (slot arm
  mutation-proven red on a dropped forward; id-only newest-first walk pinned
  as doctrine, locked copies included). (2) sunder-x-lock pinned end to end:
  the merge classified sunder lock-EXEMPT (the disenchant precedent; the
  release scope is salvage/craft-consumption/vendor-sell only), and NO test
  on either side pinned it; now pinned in tests/bag_item_context_menu.test.ts
  (locked raid epic keeps Sunder, loses Salvage) and
  tests/masterwrought_materials.test.ts (a pinned-slot sunder of a locked
  copy completes), each naming the other so they flip together.
- RULING WANTED (maintainer ratification): sunder lock-exemption was taken by
  merge fiat, not a recorded ruling. Current shape: a player-locked raid epic
  CAN be deliberately sundered (menu offers it, sim admits it), consistent
  with disenchant. If the lock should instead protect against sunder (it is
  irreversible destruction, the exact thing a lock guards), flip the two pins
  above and add the lock deny to sunderAdmitted; note the id-only fallback
  ladder (consumePreferredDisenchantVictim) has no lock arm either, so a
  ratified deny must cover victim selection too.
- RELEASE-OWNED FINDINGS (recorded, NOT fixed on branch; surface to the
  maintainer): (a) RESOLVED UPSTREAM (2026-08-15 v0.39.0 sync, merge
  9de151aacb: the release line's own 32fdb764c8 "sync main (the v0.37.1
  hotfix) into release/v0.38.0" carries PR #3363 / commit 3d1546b34a, now
  an ancestor of the branch tip); the earlier record: v0.38.0 did NOT carry
  the v0.37.1 queue-pop arming fix, so the merged tree had the
  zero-battleground-seats defect that hotfix fixed (no branch overlap: the
  branch never touches those popups); do not re-surface as open.
  (b) RESOLVED UPSTREAM (2026-08-14 sync, release commit 94ac061152
  "fix(db): harden Rift rollback migration"): the script now requires a
  drained character_leases table, takes an advisory lock, compare-and-swaps
  every state blob, and makes --realm dry-run-only; do not re-surface as
  open. (c) the vendor partial-sell
  toast says 'Kept {n} bound copies' even when the spared units were
  player-LOCKED, not bound (items.ts partial-sale summary; release-parent
  code). (d) the release extracted isUpdateDue out of server/game.ts without
  lowering the game.ts monolith ceiling (still 10900 with slack; ratchet
  hygiene). (e) phase 15 note: the combat-rogue re-band (apPct 0.55 to 0.2)
  moves the pre-packet raid BiS throughput baseline R5 measures against;
  build the phase 15 baseline AFTER this sync, on merged numbers.
- PREMISES AMENDED at this sync (audit step 6): phase-12-perfecting.md gains
  the per-copy lock refusal premise (lock-aware sufficiency, dedicated locked
  deny, selection-based consumes); phase-11-pattern-drops.md market-seam
  sentence corrected (src/sim/market_query.ts exists and is the filter/sort
  home; the release extended it with a sort passthrough). Verified INTACT:
  the rolled.quality successor premise (rift forge rollback only rewrites
  rift payload objects and preserves unknown JSONB keys; masterwrought ids
  stay disjoint) BUT re-verify at phase 12 against the HARDENED script (the
  2026-08-14 sync's release rewrite still spreads ...source preserving
  unknown instance fields on the ACTIVE record, yet its new legacy-shadow
  arm deletes the whole inert plural equipmentInstances record outright
  when the singular key is active, so "preserves unknown JSONB keys" is no
  longer unconditionally true for the legacy key; phase 12 carry 5's
  migration-safety pass re-verifies rather than inheriting this verdict),
  all phase 08 QA prompt claims, R4 (no battleground reward
  behavior landed; the proposal test change is a test(perf) world trim).
- Equip-peek note for phase 12 (audit nit, inert today): equipItem's sub-cap
  quality peek reads the HIGHEST-index copy (equipCandidateQuality) while the
  consume honors a named slotIndex, so a slot-addressed equip of two
  same-id copies with different rolled quality can peek one and lift the
  other. Unreachable for masterwrought defs until the phase 12
  rolled.quality-successor ruling lands; fold into that phase's re-validation
  work (the items.ts comment claiming the peek reads 'the exact copy the
  consume will lift' is only true for id-only equips).
- The 60 masterwrought-family Latin pending rows ride unchanged through this
  merge (release-fill obligation already recorded in the phase ledgers;
  release-tier gate reds until the fill).
- The QA prompt's premise "sync expects a no-op or a small merge" is
  superseded by this record; the phase 08 implementation diff under audit
  stays a3a3f6a009..d14adba5b9, and this sync's commits (the merge + the
  audit fixes) are the Step 0 record.
- SYNC FIX-ROUND REVIEW (the fixes are unreviewed code rule): a fresh
  architecture reviewer over fa51741408..436ab252b1 returned 0 blocking, 2
  should-fix, 5 notes; ALL applied at 32c32dd8f2. The two should-fix: the
  consume's tri-state was collapsed (null fell into the newest-first walk;
  now a pre-effect pin gate refuses a bad selection before the learn and the
  null arm is explicit per the item_copy_ref contract), and the slot arm's
  quest-hook call was a mutation survivor (deleting it left both new tests
  green while silently desyncing the online bag mirror via the missed
  meta.wireRev bump; now pinned, probe-proven red). Notes applied: both lock
  fixtures stamp through the real setItemLocked command; an online-host pin
  drives the wire slot field through the real dispatch; the professions
  CLAUDE.md pattern_items row records the copy-choice discipline. Reviewer
  all-clear on: rng draw-order (both consume paths draw zero), sim purity,
  SimContext contract, slot-vs-id arm bookkeeping parity, the discarded
  InventoryUnit return (correct to discard; noted as the future
  learned-from-a-signed-pattern plug point), and the sunder pins' accuracy.
  Reviewer note for the frontend gate (recorded, not actioned at the sync):
  bags_window's copyRefFor returns undefined on a stale repaint index, so a
  stale bag click still reaches the sim id-only; pre-existing, shared with
  equip/discard/sell, bounded by patterns being excluded from the action bar.
- Sync checkpoint tip: 32c32dd8f2 (merge fa51741408 + 4 fix/docs commits).
  gate_select at the committed tip is deliberately NOT run at this
  checkpoint: the QA session re-running the phase-08-qa prompt owns the gate
  (its Step 4), and every targeted surface this sync touched is green (tsc,
  parity 207, naming guards, portrait trio, eastbrook, monolith,
  architecture, S3, snapshots, masterwrought suites, and the touched suites
  156 post-review).

## Phase 08 QA (2026-08-13, verdict PASS; the six-dimension re-audit the phase-08-qa prompt ordered)
- RE-SYNC (Step 0, second v0.38.0 merge, 561e0d7767): the release moved 16
  commits past the fa51741408 sync (chronomancer rank 4 heal tuning PR #2786,
  a portrait re-bless, the Temporal Echo tooltip area-rate fix, hud.css
  reduced-motion cleanup, a c4b golden re-mint). Three generated artifacts
  conflicted and were re-minted from the MERGED tree, never side-picked: the
  c4b_effect_dispatch parity golden (UPDATE_PARITY re-record; branch side
  samples craftDaily, release side had the new chronomancy behavior; full
  parity suite green at 207), and the portrait manifest + accepted-art pin
  (230/230 receipt-flow rerender, byte-identical portraits; only the stills
  bundle digest moved). release-merge-audit: the six code overlaps
  (damage/effect_dispatch/types/classes/action_bar_view/mage_choice_rows) are
  disjoint-additive with both sides' tokens verified surviving; no new
  endpoints, no injected-helper reshapes, no new db-mock sites, no locale
  rows (naming guards green anyway). PHASE 15 NOTE: the chronomancer heal
  tuning joins the combat-rogue re-band as a mover of the pre-packet R5
  baseline; the existing build-the-baseline-after-sync guidance covers it.
- AUDIT (Step 2): ultracode Workflow fan-out, six dimensions (ordering,
  correctness, R1 suppression, stat shape, cleanup, test-decisiveness in an
  ISOLATED worktree) plus per-finding adversarial verifiers (nothing
  refuted), a parallel context briefing, and qa-checklist. Every dimension
  PASS; qa-checklist verdict READY with zero blocking. qa-checklist also ran
  the mechanical vitest-related sweep over all 13 changed source modules:
  1594 test files / 24251 tests green, plus 36 blast-radius suites by hand.
  Its four deep leads all closed CLEAN with evidence: (1) the R1 null
  bonusStats starves the QUALITY bump too, not just the stat bake
  (masterworkBumpedQuality is only consumed where bonusStats !== null), so an
  apex craft can never mint a legendary-quality instance; (2) the ten
  drop-only recipes are genuinely unlearnable today (only an EMPTY
  acquisition list is grandfathered; trainer and pattern paths both refuse);
  (3) the saved-loadout gear swap routes per-slot through equipItemImpl, so
  the equip cap holds on the bulk path; (4) a cap retune sweeps the guide
  copy via CAP_PROSE_BY_LOCALE (tests/masterwrought_cap.test.ts).
- DECISIVENESS (isolated worktree at 561e0d7767): static checks S1-S4 clean
  (EXPECTED table exactly matches the flagged set with zero dynamic flag
  writes; the literal arm is a true literal and the formula arm reads the
  independent item_budget leaf, proven separately live via the P1b
  both-sides-retune probe; frozen-id golden delta +10/-0; name gates green).
  All EIGHT mutation probes reddened their claiming suites with named
  assertions and pasted counts against a proven 198-test green baseline:
  stat retune (literal arm), rating swap (per-def field pin), flag drop
  (completeness arm 1 AND the per-piece arm), R1 guard revert (the
  forced-roll arm, re-proving the ledger's mutation-proven claim live), tier
  row flip (the professions_masterwork literal table + chance-inputs arms,
  owning-suite-mapped per the wrong-suite trap), cap-call delete (9 pbe
  tests), /dev bis cap stub (the synthetic over-cap arm), R14 forbidden key
  (the whole-def whitelist), and both sweep-growth arms (new flagged def and
  new recipe row each red the completeness arms, so phase 09/10 appends
  cannot silently skip the sweep). Reverts verified byte-clean between every
  probe; the shared stash untouched.
- FOUND AND FIXED (the QA fix round, seven commits, each with body):
  52dadfcb52 the three deferred evidence captures; 4dfa0d2057 portable
  createRequire in BOTH provenance rasterizers (phase 08 copied phase 07's
  machine-absolute path; failed on any other clone and after worktree
  deletion); 02dece2626 sweep pins for oncePerDay absence (both arms) and
  the bag disenchant kind gate; e50a276e01 the pre-existing unused
  PlayerMeta type import out of bags.ts (stills bundle proven byte-identical
  after, manifest fresh); 0b63f2ea8f the never-Hit clause restored with a
  dated OUTCOME amendment (the ledger close 063842c7ab had silently deleted
  it while the BUILT ruling still cited it) plus the int/sta scoping and two
  tie-break clarifications; 47b3892513 the pbe_boost at-cap positive control
  pinned to the exact 10 (a bare > 0 floor tolerated demotion over-firing on
  nine of ten capped kits); 975ea06f1f the professions CLAUDE.md R1 row
  (phases 09/10 author against that file) and the corrected
  enforceMasterwroughtCap hand-arm comment (mainhand empties with no
  fallback; offhand DOES refill but bypasses fillHands' two-hand exclusion
  and shield legality, so phase 09 routes hand demotion through fillHands
  rather than adding a mainhand fallback).
- RECORDED, NO CODE OWED (fresh-eyes observations, all verified):
  - The warrior_intervene one-line hunk in the build diff was biome hygiene
    on a changed-set file; the build commit's "biome error" framing
    overstates it (measured: warn-severity useOptionalChain, biome ci exit
    0). Harmless either way.
  - The apex BAG's masterwork-incapability rests on masterwork.ts's own
    slotless guard, not on R1 (no flag, no suppression needed); stated here
    so phase 10's consumables (also slotless) inherit the same understanding.
  - The ledger's discarded-outcome trio is complete for DURABLE outcomes;
    the same result.masterwork boolean also suppresses the masterwork
    SimEvent emit, the zone announcement, meta.lastMasterwork, and the
    craftResult masterwork field. Phase 12 decides what a head-start proc
    emits and announces, not only what it credits.
  - The rating-spread arm in the sweep is an in-file table-shape pin (both
    sides from APEX_ARMOR); source coverage comes from the per-piece
    def-field pins beside it. Deliberate, not vacuous.
  - None of the nine apex defs carries requiredClass while all nine band
    references do: equip eligibility is armor-proficiency-wide, slightly
    wider than the class-locked drops. Judged deliberate under R2
    tradability and the classic crafted-gear norm; no rating dominance
    (off-archetype wearers get off-stat primaries). Recorded as the standing
    shape for phases 09/10.
  - src/sim/content/rift/items.ts's rating-rule comment classes int/spi
    wholesale as healer-facing, which surface-contradicts the operative
    catalog rule (authored Hit seed distinguishes caster-DPS from healer
    cloth, heroic_variants.ts); the rift comment is the stale one. Cosmetic;
    left for a rift-content pass.
  - APEX_ARMOR_RECIPES' per-row "Input N vs output M" comments bake today's
    prices; the invariant itself recomputes live in two suites, so staleness
    is cosmetic only.
  - The commission-order board lists the nine apex epics by name (full
    recipeList through isCommissionEligible), so pre-phase-11 a player can
    open an order nobody can fill, and the names surface beside the
    deliberately rule-level wiki section. Structurally void under the one-PR
    contract (patterns ship before players see this); recorded for the
    maintainer beside S2, and phase 11 should re-check the board once
    patterns land.
- DEFERRED-WITH-OWNER ITEMS CLOSED (evidence per the QA prompt):
  (a) Ten-icon visual pass: the QA session re-reviewed all ten committed
  WebPs fresh at shipping size (independent of the build's admission
  self-review): three coherent families (riveted steel mail, warm leather
  with the fenbloom motif, navy-and-gold Sunspun across the cloth trio plus
  haversack), slot silhouettes unambiguous, opaque house ground, no
  legibility defects; verdict PASS, all ten. Note for the record:
  final-item-art-audit-verdict.json's "reviewed at admission" prose is the
  build's SELF-review; this QA re-review is the second pair of eyes, and the
  maintainer can spot-check via the committed icons and captures at leisure.
  (b) In-browser eyeballs: three captures committed under
  docs/screenshots/masterwrought-phase08-qa/ at the lowest graphics preset:
  the first live "Unique-Equipped: Masterwrought (2)" tag on Sunspun
  Vestments through the real bag-hover path (the tooltip also visually
  confirms the chest budget 12+10, Hit 40, Requires Level 20, and the 2s
  sell line), the /wiki gear Masterwrought section, and the tailoring craft
  page's "From a found pattern" cell showing the exact recorded bill.
  (c) S2 shipping window: surfaced to the maintainer in the QA report (with
  the commission-board corollary above): from phase 08 until phase 12 an
  apex epic is the one slotted craft that can never proc masterwork or
  credit the masterwork marks, and until phase 11 the ten recipes have no
  live acquisition path; both are structurally void under the one-PR
  delivery contract and exist only inside this branch.
- RELEASE-FILL OBLIGATION ADDED (qa-checklist): filling
  guide.gear.masterwroughtBody in the fifteen pending Latin locales must
  extend CAP_PROSE_BY_LOCALE in tests/masterwrought_cap.test.ts in the SAME
  change, or the cap-retune sweep goes blind to exactly the filled copies it
  exists to catch. Recorded on the BUILT ledger's release-fill line too.
- PHASE 12 ADDITIONS (beyond the build's list): the loadout gear swap
  reports a cap refusal as copyGone ("that copy is gone") because
  applyGearSet folds every equip refusal into one counter; reachable once
  two flagged pieces are worn and a saved set names two others. Pre-existing
  refusal-classification debt (level and unique-equipped misreport the same
  way); fold into phase 12's equip-time re-validation work. Plus the
  emit/announce enumeration above.
- FIX-ROUND REVIEW (the fixes are unreviewed code rule): a fresh reviewer
  re-derived the re-sync merge mechanically (git merge-tree reproduces the
  auto-merge byte-identically outside the three re-minted artifacts, each
  merged blob differing from BOTH parents, so the resolutions are true
  re-mints, never side-picks), re-verified every fix commit's claims against
  code and content (the restored clause byte-matches ab683da04d; the
  Hit-seed mechanism confirmed at heroic_variants.ts; the 10-of-16 count and
  the oncePerDay/disenchant pins proven live; zero dashes or emojis across
  every added line), and returned ZERO blocking and zero should-fix. Its
  four nits are applied at 4dd0cd2995: the tooltip capture renamed off the
  -desktop viewport claim, the hand-arm comment re-cut on the true
  weapon-vs-non-weapon asymmetry (a dual-wield offhand WEAPON also empties;
  only shields and held offhands refill), the of-16 denominator restored,
  the int/sta enumeration extended with the heroic soulflame variants. Two
  info notes recorded: the rasterizers' depth-3 repo-root walk is unpinned
  (a future art dir at another depth fails LOUDLY, accepted); the
  pre-authoring census counts base ids only (auto heroic variants excluded;
  with them mail helmet reads 3 not 4 at the helmet cell, no pick moves),
  worth a scope word if the census is ever re-derived.
- DURABLE TRAP (memory written, workflow-isolation-worktree-wrong-ref): a
  Workflow agent spawned with isolation 'worktree' from this secondary
  worktree got its checkout at the WRONG ref (a v0.37.1 merge with zero
  masterwrought files); the baked-in setup check caught it and the agent
  recovered via detached checkout of the branch tip. Every future isolated
  agent prompt bakes the expected sha and verifies before working.
- GATE (Step 4): node scripts/gate_select.mjs PASS (exit 0, all 8 steps, the
  planner fell back to the full suite on the broad generated-artifact churn:
  2692 test files / 37381 tests passed, 2 expected fail, 112 skipped, at
  GATE_MAX_WORKERS=5; browser regressions 18 files / 118 tests; i18n gen +
  freshness, malware scan, changed-files biome, SFX conformance, typecheck,
  and all builds green) at the QA code tip 975ea06f1f. The two commits after
  the gate (4dd0cd2995 reviewer nits, plus this docs close) are comment,
  docs, and rename-only: the one touched suite re-ran green (pbe_boost 34)
  and biome is clean on both touched files at the final tip. Portrait
  manifest verified fresh at the final code state (the bags.ts type-import
  removal left the stills bundle byte-identical).
- NEXT: Phase 09 (apex weapons, jewelry, gadgets) in a fresh session, own
  release sync first. Handoff knobs, all verified live this QA: the sweep's
  two completeness arms force 09/10 appends into the EXPECTED table in the
  same change; jewelry pins against JEWELRY_RATING 25 (heroic_vendor.ts),
  never the armor 40; hand demotion routes through fillHands per the
  corrected comment (the largest cap-coverage hole: no flagged-hand
  demotion arm exists yet); the injectable isFlagged seam and
  masterwroughtConflictSlot are TWO definitions of flagged that move
  together; the admission-side capacity twin goes load-bearing the moment a
  recipe ships resultCount > 1; the at-cap kit count pin (10) will move on
  appends and is re-acknowledged deliberately.

## Phase 09 BUILT ledger (2026-08-13)

- SYNC: merge 2f81e2b8c8 brought the v0.38.0 map-marker overhaul (22 commits,
  PR 3369). The IWorld count pin composed a THIRD consecutive time (ours
  extractEssence, theirs civicServicePlacements, both sides read 322
  pre-merge; merged truth 323/86/237 set from suite runs) and the facet-union
  322 pin auto-merged silently and was caught by the run, exactly the
  compose-trap class. Naming guards clean. Four-leg merge audit CLEAN;
  release-owned notes passed upstream: civicServicePlacements is a
  construction-time readonly Sim field, not a SimContext module (defensible
  as derived static data), and delve_map_painter carries a dead _northLabel
  argument with a stale relocalize comment.
- CATALOG (ids frozen, all epic, recipe level 25, skillReq 100, ilvl 31 on
  gear): duskforged_warblade (1H sword, 30/50/2.5 = 16.00 dps, str13+sta9,
  hitRating 50), ridgebreaker (2H maul, 49/76/3.4 = 18.38 vs 18.4 budget,
  str17+sta12 = 29, hitRating 50), duskforged_bulwark (shield, sta11+str5,
  blockValue 32 from the buckler 6 / Wallshield 14 / bonewrought 30@29
  ladder, armor 732 = 680 + 2 ilvl x 26 slope, hitRating 20),
  wyrmfall_pendant (int8+sta6, hasteRating 25), warhewn_signet (str8+sta5,
  hitRating 25), prismglass_loop (int8+sta5, hasteRating 25), gyrelens_array
  (held offhand, int10+sta6, critRating 20, NO use: no cosmetic use family
  exists in the codebase and R14 forbids inventing one, the recorded gap),
  voidbound_grimoire (held offhand, int8+spi5+sta3 the wraithfire shape,
  hasteRating 20, never Hit), masters_field_forge and makers_charm (tool
  kind, epic, UNflagged, no stats). masterwrought: true on exactly the eight
  gear pieces. Rating BANDS by slot family: weapons 50
  (FIVE_MAN_WEAPON_RATING), jewelry 25 (JEWELRY_RATING, module-private so
  the sweep pins the literal with a live zense_meridian tie), held/shield 20
  (wraithfire_orb / bonewrought_bulwark, the only shipped family, hand
  authored not a constant). Class gating mirrors each family reference
  (HEAVY on the weapons/shield, the caster six on the held pair, jewelry
  class-free per the vendor family); the phase 08 no-requiredClass shape
  deliberately does NOT transfer to hands (no armor-proficiency gate exists
  there; the requiredClass list IS the proficiency encoding).
- REAGENT BILLS (uniform per craft, 3 own intermediate + 2 wyrmfall_core +
  gathered family): weaponcrafting duskforged_billet x3 + thorium_ore x4 +
  iron_ore x2 (input 491, outputs 320/340/300); jewelcrafting
  prismglass_setting x3 + thorium_ore x4 + arcane_essence x2 (511;
  320/300/300); engineering precision_chassis x3 + ashwood_log x4 +
  thorium_ore x2 (595; 340/380/150); inscription sablewax_vellum x3 +
  sunpetal_herb x2 + arcane_essence x2 + glass_vial x1 (603; 340). sellValue
  strictly below input on the recipe_economy basis (buyValue when positive,
  else sellValue; the basis is now named at the section header). Stations:
  forge/forge/toolworks/apothecary; the four jewel/inscription rows entered
  the foreign-bound pin. The four intermediates moved to HONEST_MATERIALS
  per their remove-then comments.
- MAKER'S CHARM, the resolved price family (recorded per the plan):
  engineering's FIRST tool effect (craftId engineering; resolveRecharge
  reads craftId per effect so the discount works with zero tools.ts
  changes), kind quantity bonus 2 (quality-kind at bonus 2 is BARRED: it
  would mint fine grades over bare hands, the one-point margin pinned in
  professions_tools), epic rung. Listed mint 595, specialist mint 380,
  worst generic recharge 275; 380 > 275 holds (even the self-gathered 320
  variant), pinned both ways in the recharge suite. startingDurability 20
  keeps the recharge machinery untouched. The R9 policy admits quantity-kind
  automatically; the craftable set pin is now three.
- FIELD FORGE mechanics: ItemUse placeMobileStation (stationCraftId typed
  CraftDef['id'], documentation-only narrowing: no craft-id union exists in
  the tree), placement from the item is partyShared, NO specialization gate
  (the item is the credential), never consumed, overwrites the one
  PlayerMeta.mobileStation slot in BOTH directions (mutual clobber pinned),
  10 minutes, zero rng, dead-gated in the module. The crafting gate's third
  arm honors a party member's shared station within STATION_RADIUS
  (squared-distance, type-matched; the type dimension and both radius
  boundaries are pinned after the coverage audit found them naked).
  Placement emits the single-line "You set up the {name}." through the
  scroll-pattern log channel with log.placeStation matcher + 22 DICT rows.
- THE SEAM DECISION of the phase: the mst readout became SET-VALUED after
  two reviewers independently showed the single scalar let the viewer's own
  station shadow a party shared station of a different craft, disabling
  crafting rows the gate accepts (reproduced live: gate null, window
  blocked). activeMobileStationCraft renamed activeMobileStationCrafts:
  readonly string[] (facet doc rewritten; rename moved no counts); mst
  carries the sorted joined scalar (movement-driven now: it re-emits as
  players cross STATION_RADIUS; comment recut says so; per-viewer by
  construction so it cannot ride realm_readout_memo); ClientWorld splits
  behind a raw-string cache (no steady-state allocation); EMPTY_CRAFTS
  frozen constant keeps the common path allocation-free. Nearest logic and
  tie-break DELETED: the set carries every qualifying craft, so the
  crafting-window row set mirrors the deny exactly (the hud comment now
  says so truthfully). Online party-derived mst has a real GameServer test.
- CAP PLUMBING: enforceMasterwroughtCap routes hand demotion through a
  fillHands re-run with all non-kept flagged ids excluded (HandLegalityReads
  injectable seam; eight synthetic arms; wiring pinned at the bisKitForRole
  call site by a mutation-proven test). The bis_gear twin (BOTH hosts) got
  the same semantics: exclusion plus cross-hand re-pair via
  displacedSlotForEquip. The at-cap kit count pin held at 10 UNCHANGED,
  verified explainable (roleItemScore ignores hitRating so no phase 09 def
  is an argmax pick); the dev-BiS sweep now pins EXACTLY 2 flagged for all
  nine classes (warrior with both hands flagged: warblade 214.0 vs cleaver
  213.5, bulwark 748 vs heroic bonewrought 697, raw-budget wins).
- OCCUPIESHAND RULING (owed since phase 03 QA), decided and pinned:
  coexistence STANDS. A worn offhand (occupiesHand false) is not displaced
  by a 2H equip and therefore STILL COUNTS against the cap (no displacement,
  no ignoreSlots exemption): flagged worn offhand + flagged 2H = at cap,
  third refuses. The displaced HELD offhand exemption is separately pinned
  (benched by the 2H, does not count). No phase 01 behavior changed; the
  arm was pinned, not rewritten.
- REVIEW RECORD: six fresh reviewers (architecture, content-obligations,
  cross-platform, server-hot-path, frontend-seam, test-coverage): zero
  determinism/parity/hot-path defects; 4 blocking (all stale content pins
  outside every curated battery: material_taxonomy x10, recipe union,
  foreign-bound, the type-dimension coverage hole), ~14 should-fix, ~12
  notes, ALL applied in a four-agent fix round (4 commits) plus three
  integration seams (dev_commands rename, hud_update_drive gate text,
  profession_identity_card regexes). recipeById/recipeForResultItem moved
  behind lazily rebuilt Maps (the pattern suites push synthetic recipes at
  runtime, so load-frozen maps were rejected deliberately). Latin
  toolEffectsBody rows (15 locales) went STALE from the reword, left for
  the release fill per the reword-staleness rule.
- FRESH-REVIEWER ROUND (after the fix round, itself unreviewed code): one
  consolidated reviewer plus two child auditors (a pin-repair mutation audit
  with 8 probes in an ISOLATED copy, and a tooltip/i18n review); verdict: no
  pin weakened anywhere, one blocking (the bare-named tooltip core absent
  from all THREE architecture registries, the triple-registration trap),
  plus the multi-element mst wire gap, the bis_gear pair check hiding inside
  the cap branch, the argmax-literal warrior winner (0.46-point margin,
  flipped by a one-point unrelated edit in a probe), the prose-only
  reliquary repair with two stale duplicates, the 13 silently-stale Latin
  toolEffectsBody rows (deleted so they go pending: present-but-stale rows
  are INVISIBLE to every gate, the staleness scan in i18n_scan is recorded
  but not live), and the pbe_boost comment wrong a second time in the other
  direction (measured: the cap arm FIRES on 9 of 16 real kits, ring refill
  live via prismglass_loop; only the hand arms stay synthetic-only). All
  applied in one commit; suite battery green, tsc clean.
- OPEN MAINTAINER DECISIONS, recorded not decided: (1) Reliquary curation
  for masters_field_forge and makers_charm. The phase 08 no-page precedent
  for crafted tradables was never written down (recorded here now); the
  on-point COUNTER-precedent is professions_specimens listing the two
  crafted-primary epic fishing rods as item relics with
  fromProfession('engineering') hints, the same shape as both tools. If
  listed: append to professions_specimens, and catalog growth reverts page
  completion, owing a release-note line. (2) Forge world-visibility: a
  placed station has NO world prop, no map or minimap marker, and no expiry
  readout; party members aim for an invisible 20-yard point (the placement
  emit, the tooltip card, and rows lighting up are the only feedback). A
  marker would ride stationPlacements-style surfaces and the marker modules
  must stay preset-free per the new fairness sweep. (3) The reliquary
  masterwork:engineering revisit trigger FIRED: gyrelens_array is the first
  stats-bearing engineering craftable; the slot stays unfillable ONLY
  because of R1 suppression (comments recut to say so); when phase 12 moves
  suppression to the effect gate, craftIsGearCapable('engineering') flips
  and three reliquary pins move together, and reliquary.md's feat
  justification must be re-judged.
- PHASE 10/11 NOTES: the sweep's arm 2 unions APEX_ARMOR_RECIPES +
  APEX_GEAR_RECIPES (append or widen again in the same change); phase 11
  must never put a flagged def in a heroic-eligible loot table
  (makeHeroicVariant spreads ...base) and re-checks the commission-order
  board's pre-pattern apex listings (phase 08 corollary); the wiki lists
  ten unlearnable drop-acquisition recipes until phase 11 lands patterns
  (the phase 08 precedent, deliberate).

Phase 09 close-out addendum (2026-08-13, after the qa-checklist gate):
- The qa gate ran the ONE thing every curated battery had skipped, the full
  suite, and found twelve reds with eight root causes, all same-change
  census obligations: the professions blob band re-banded 10596..10916
  around the measured 10756 (the +257 knownRecipes arithmetic verified
  exact by migration-safety); the field forge card entered EFFECT_SOURCES
  plus the composition pin; weapon census 125; the ten apex items moved
  from per-item mapping entries to the masterwrought-phase09-art
  generatedBatches row (the phase 06 pattern; each item exactly one owner,
  the weapon-batch ownership model extended with the batch excluded from
  the frozen campaign chunks); duskforged_bulwark maps to shield_square
  while gyrelens_array and voidbound_grimoire joined the conscious
  no-model pin (a voidbound tome GLB on the phase 06 procedural-tome
  pattern is recorded as a PHASE 14 beauty-pass follow-up); the four
  consumed intermediates left the bag All-only set; taxonomy bootstrap 64;
  admin tool-effect vocabulary. A follow-up content re-review then moved
  the CREDITS row and batch provenance wording to the batch truth, made
  the rng-neutrality sweep iterate TOOL_EFFECT_IDS live, and pinned the
  first weapon-owning woc_original_svg batch's provenance fields.
- Migration-safety forward notes: the tracking band has ~160 bytes of
  slack, so PHASE 10 WILL red it by design (a re-measure, not a
  regression: put it in the phase 10 plan); the structural 12288 ceiling
  holds through phases 10-11 (~1150 bytes spare after phase 10, phase 11
  adds zero knownRecipes bytes); the makers_charm ToolEffectId widens a
  PERSISTED enum whose rollback silently deletes a slotted charm at load,
  player-reachable once phase 11 lands patterns: PHASE 11 owes the
  rollback-runbook line; a stale bundled desktop or native client reads
  the comma-joined mst as one craft id and cosmetically omits the
  mobile-station row (server gating unaffected); phase 10's Grand
  Cauldron / Laden Hearth reuse of the mobile_station family inherits
  TRANSIENCE, so a capstone meant to survive a realm restart would be the
  packet's first persisted station state, a schema-shape decision, not a
  reuse.
- The portrait manifest was re-blessed a SECOND time as the phase's final
  code step (the first re-bless sat mid-phase and went stale as later
  commits moved the stills bundle graph, exactly the phase 06 lesson;
  230/230 byte-identical both times, acceptance sha 3a5e4816).

Phase 09 QA (2026-08-13, fresh session): verdict PASS-WITH-FOLLOWUPS, all
followups fixed in-session, nothing carried as future work.
- Release sync: merged origin/release/v0.38.0 at b08d79ef91 (38 commits:
  night-lighting overhaul, GPU hitch instrumentation, the CI second-tier and
  merged-leg splits, the suite-duration ratchet, OTA overlay changes) as
  d4e313e74b. Nine conflicts, three clusters, all provenance-shaped: the
  portrait manifest pair (both sides re-blessed; resolved by a fresh full
  rerender at the merged tree, 230/230 byte-identical, manifest sha
  e8725c80, accepted-art row advanced), the eastbrook polish seals (both
  sides moved renderer.ts; re-minted at the merged tree with the remint
  tool, three literals repinned), and the fire tuning comment (this
  branch's originality renames kept over the release's renamed
  chronomancy_balance_targets reference, both halves unioned). i18n:gen
  reconciled clean. The full suite ran green at the merge tip (2735 files,
  38109 tests) BEFORE any fix landed, so the merge introduced zero reds.
- Release-merge audit (7-agent overlap workflow): CLEAN. All 14
  branch-authored auto-merged overlaps verified against both parents; zero
  server files in the release delta, no new endpoints, injected helpers all
  re-bound, zero db-mock sites, i18n comment-only. Worth knowing:
  src/render/renderer.ts sits at EXACTLY its 13708 monolith ceiling (the
  release's own pin; any renderer line added on this branch reds the
  ratchet until an extraction lowers it), and the release's lane-gated
  balance splits (chronomancy_balance_targets, owned_class_*, warlock
  anchors) first meet this branch's sim delta in CI's lane jobs after
  push; residual risk low, the branch's changes in those areas are
  display-name strings only. docs/local-gate-perf/baselines.md:596 cites
  the deleted chronomancy_balance.test.ts: pre-existing release-side debt,
  not touched here.
- Audit fan-out: four QA auditors (correctness, seam, flag, cleanup), the
  architecture and cross-platform reviewers on the phase diff, an 11-probe
  mutation audit in an isolated worktree (all probes decisive, cap
  boundary redding 26 tests, party credential 10; final tree byte-clean),
  the qa-checklist gate, and two fresh reviewers over the fix round
  itself. Zero blocking findings anywhere. The correctness/flag/seam
  catalogs verified exact: all ten items at the recorded budgets, the flag
  set exactly eight, art batch ownership single-owner, jewelry purity and
  all three rating-band ties live.
- Fix round (seven commits on the merge): 9cae1bd4cf unified the party
  walk (eachPartyStationInRange, both consumers, type filter deliberately
  outside the walk) and aligned the array contract (offline non-empty
  return frozen; online shared frozen EMPTY_MST_CRAFTS incl the initial
  value; malformed '' mst decodes as empty); 583a155261 + 348cae43d7 the
  S3 corpus row added then correctly REVERTED (the professions
  whole-directory sweep at localization_fixes.test.ts:1202 already feeds
  the file; the perturb-proof redded through the sweep) and the
  professions CLAUDE.md mobile_station row landed; 9e31de9b6b the
  decisiveness repairs (the kept-2H disjunct test was a PROVEN mutation
  survivor, rebuilt with offhand fodder and re-proven by kill; shaman
  kept pair pinned literal with a premise loop; recharge self-gathered
  320 arm with the exact-275 tie and forward guards; recipe_index_memo
  suite pinning the lazily-rebuilt-maps ruling's contract; weapon census
  title 125; dps tolerance); 217379026e + 71a7798e55 + a4c641a6ec the two
  fresh-review rounds' residuals (corpse-harvest signing arm in the
  forward guard, per-row derived dps bound, bare_client frozen-default
  identity mirror, the online empty-identity and ''-decode pins in
  snapshots, the one-hand refill-lands premise sibling, recipe memo
  try/finally, honesty rewords).
- Adjudicated, no change, do not re-raise: the recipes.ts length-keyed
  memo stands per the phase 09 ruling (the fix-round reviewer's
  WeakMap+freeze prescription would break the pattern-suite pushers; the
  new guard suite pins the actual contract instead); the fourth
  private line() tooltip helper copy stays (a shared helper is a
  triple-registered architectural entity for a one-line body whose real
  content is each module's tt-class union; revisit only if a tooltip
  module family barrel forms); the pbe_boost measured counts (cap fires
  on 9 of 16 kits, ring arm live in 8) stay dated sourced prose in the
  enforcer header and the test comment, verified by three independent
  probes this session, not pinned (a live assertion needs a
  pre-enforcement builder export nothing else wants); the mst
  layout-version non-bump stands as recorded in the migration notes.
- Conscious residues recorded by reviewers, accepted: the resolver pays
  one bounded closure per partied-viewer call on the 20 Hz snapshot path
  (banner reworded to say so); the '' decode arm is defensively
  unreachable from the shipped encoder; the shield armor 26-slope literal
  stays hand-authored prose-documented extrapolation; flaggedCandidates
  in the shaman case remains a maintained input (a sixth flagged
  raw pick reds the worn-equality, the correct failure for that case).
- Phase 10 carries, in ADDITION to the addendum above: the professions
  blob band WILL red by design (re-measure around the new settled bytes);
  renderer.ts headroom SUPERSEDED at the 2026-08-14 v0.38.0 sync: the
  release extracted entity_view_policy_core and lowered renderer's ceiling
  to 13700 with renderer.ts at 13691 (nine lines of headroom; the old
  zero-headroom-at-13708 claim is stale), SUPERSEDED AGAIN at the
  2026-08-15 v0.39.0 sync (merge 9de151aacb): the release's r185 render
  work re-pinned renderer.ts at its exact merged count 13754/13754, and
  the merge re-pinned hud.ts at its exact merged count 19388/19388 (both
  extractions landed together and the merged file shrank below both prior
  pins), so BOTH sit at ZERO headroom: any renderer.ts or hud.ts line this
  branch adds reds the ratchet until an extraction lowers it (sim.ts is at
  12606 under 12650, server/game.ts at 10867 under 10890, three lines of
  growth in each from the release delta), while the merged union broke the
  sim.ts and server/game.ts ceilings instead, fixed at the sync by two
  extractions (professions/daily_gate_load.ts, sim.ts 12603 under a
  lowered 12650; server/interest_policy.ts, game.ts 10865 under a lowered
  10890); cap TRANSIENCE inherits to the Grand Cauldron /
  Laden Hearth family reuse; sweep appends ride the family tables (arm 2
  unions APEX_ARMOR_RECIPES + APEX_GEAR_RECIPES).
- Phase 11 carries: the makers_charm rollback-runbook line; never a
  flagged def in heroic-eligible loot (makeHeroicVariant spreads base);
  the commission-board re-check.
- The three OPEN maintainer decisions above stand unchanged (reliquary
  curation for the two tools, forge world-visibility, the fired
  masterwork:engineering revisit trigger), plus the sunder lock-exemption
  ratification and the five release-owned findings recorded at the phase
  09 sync; none were affected by this QA.

## Phase 10 ledger (apex consumables and enchants, 2026-08-14)

Built in one session off the v0.38.0 sync (merge of 6ee7f3fd27; release-merge
audit clean; the release's new sparse-checkout coupling pin was the one real
fallout, fixed toward more checkout at 904f436527 and gate-reviewed PASS).
Commits: 904f436527 (sparse cone), 5096551bd1 (flasks + foods + machinery),
7a4617631a (capstones), b3244d2f3a (enchant line), d1e1321bd4 (item art),
67c66e362c (pin suites), plus the review fix round and this docs close.
Five reviewers (architecture, cross-platform, content-obligations,
frontend-seam, gate-integrity): ZERO blocking; every should-fix and note
applied in the fix round or recorded below.

### The aura-family design (the recorded deliverable)
- Flasks JOIN the shipped elixir_${kind} families: ironhusk_flask emits
  elixir_buff_sta, warboar_flask elixir_buff_ap, runewater_flask
  elixir_buff_int. Elixir pairing therefore rides the shipped same-id
  applyAura replacement with zero edits to shipped aura ids; the phase 06
  scrolls and the elixir line keep elixir_buff_sta as before.
- THREE rules key on the new Aura.flask === true marker, never on the item
  kind or the aura id: (1) the one-flask singleton (the flask arm strips
  every flask-marked aura before applying, then re-derives stats itself);
  (2) the DOWNWARD refusal (an elixir or scroll whose family currently
  holds a flask-marked aura refuses BEFORE consuming the unit, emitting
  error.strongerEffectActive; flask-over-elixir still replaces upward;
  flask-over-flask newest wins; shipped elixir-vs-elixir behavior is
  byte-identical since no shipped consumable can create the marker);
  (3) death persistence (aurasSurvivingDeath keeps a.flask === true).
- Death accounting, decided: flasks survive the real death/resurrect paths
  and battleground deaths (classic-era fidelity: flasks persisted through
  battleground deaths; Protect Yumi likewise does not wipe); the arena and
  fiesta wipes clear flasks deliberately, as instanced minigame resets.
  AMENDED at the phase 10 QA (2026-08-16), a correction the whole fan-out
  missed and the fix-round review surfaced: "Protect Yumi likewise does not
  wipe" is FALSE, and Thornhollow Fields wipes more than the sentence says.
  The clean slate is reached by THREE routes (the fix-round reviews found
  the third route, then a misattributed down, then, twice, call spellings
  the scans let through): the DIRECT aurasSurvivingCleanSlate call, in
  exactly two places (the clearPrep arm of readyArenaFighter in arena.ts,
  which IS the clean slate, and a Fiesta down, fiestaDownEntity in
  fiesta.ts, which a Protect Yumi down runs too); readyArenaFighter called
  with clearPrep: true; and resetForArena, the one-line wrapper around that
  call, run by arena.ts at its own seat, end, and send-home and handed out
  through the SimContext seam (ctx.resetForArena) to call sites that never
  spell readyArenaFighter (the Vale Cup's two, the Yumi match seat; the
  seam delegate in sim.ts is the plumbing). Through the second route every
  Yumi and Fiesta revive wipes, and Thornhollow Fields wipes at the seat, at
  the countdown end, on a leaver, and at the match end; ONLY its wave
  respawn (clearPrep: false) keeps a flask. Through the third route the
  arena seat, end, and send-home wipe (Yumi and Fiesta matches end through
  the same two arena.ts sites), the Yumi match SEAT wipes, and the Vale Cup
  wipes at its kit-swap seat (valeCupStandardize) and at the match
  teardown. So the true accounting is: overworld and PvE deaths keep a
  flask, a battleground or arena DEATH keeps it on the corpse (quaffed
  inside a battleground match it rides through every death in it, the
  classic-era rule), and every instanced match (arena, Fiesta, Protect
  Yumi, Thornhollow Fields, Vale Cup) is a parenthesis (nothing carried in
  rides through the gates, nothing quaffed inside comes back out; Yumi and
  Fiesta downs clear it too). Corrected in the resurrection.ts note,
  pinned behaviorally per mode (tests/arena.test.ts: seat, match end for
  the winner with the defeated loser skipped, send-home for the loser's
  corpse, each its own case; tests/battleground.test.ts: a flask quaffed
  inside rides through death + wave respawn, one carried in is wiped at
  the seat, one quaffed in the form-up at the countdown end;
  tests/yumi_match.test.ts: seat, down, the revive on its own (a flask
  re-planted on the benched body is gone at the revive), and the match END
  on a benched body (the endArenaMatch branch Yumi and Fiesta take, since
  their downs never enter match.defeated); tests/fiesta.test.ts: seat,
  down; tests/vale_cup_match.test.ts: kit-swap seat, teardown, each its
  own case) and structurally (tests/resurrection.test.ts pins the direct
  caller set AND the literal per-module tables of both indirect routes,
  readyArenaFighter clearPrep: true and resetForArena call sites, through
  a balanced-parenthesis call walk rather than a regex over arguments (two
  regex cuts each let a spelling through: `e as Entity`, then a depth-two
  nested argument and an optional call, and the readyArenaFighter sibling
  could not cross a `)`), with every readyArenaFighter site classified by
  its own clearPrep literal or reported as a passthrough (the sim.ts seam
  delegate is the one pinned), the keeps pinned as their own table, and
  the call, declaration, and classification controls in their own case),
  and the tooltip clause reads "instanced matches begin and end on a clean
  slate". Whether a 20-minute flask should survive the Yumi/Fiesta downs
  or the battleground parenthesis is a maintainer call (RULING below,
  recommend keep: the arena-family clean-slate doctrine).
  AMENDED at the 2026-08-14 v0.38.0 sync (merge 33d641773f): the release
  replaced the bare full wipes (e.auras = []) with a second predicate,
  resurrection.ts aurasSurvivingCleanSlate, which keeps ONLY the release's
  new operator-applied Cheater mark, and added that mark as a FIFTH clause
  of aurasSurvivingDeath beside the flask clause. Flask behavior is
  unchanged in every arm (the clean slate still drops flasks; pinned by a
  flask decoy in the clean-slate fixture, tests/resurrection.test.ts), but
  "full wipe" is no longer the mechanism: both wipe sites route through
  the predicate now. WIDENING recorded by the QA gate: the rule actually
  keys on every aurasSurvivingDeath call site, which includes the delve
  EJECT (ejectToDelveDoor, not a death); a flask deliberately rides
  through it, correct and consistent, and both call-site comments now
  say so. Flasks are SESSION state: they do NOT survive logout,
  reconnect, or realm restart (auras are not in CharacterState). Persisting
  flask auras would be the packet's first persisted aura state, a schema
  decision deliberately deferred; the tooltip states the honest scope.
  MAINTAINER CALL recorded: schema-persist flasks later, or keep
  session-bound pricing.
- Well Fed: ONE shared aura id well_fed for all three role foods (singleton
  via same-id replacement), granted ONLY when the 18s Consuming drain
  completes (clear-then-grant order), mortal on death, no marker. First
  read shows 599.95s (updateRegen precedes updateAuras in the tick), fine.

### Increment table (every value one rung over the shipped line)
- Flasks: value 15 / duration 1200s / epic / sell 25 = the rare elixir rung
  (serpent 12/900, sell 20) plus the elixir ladder's own +3/+300/+5 steps.
  Deliberately breaks the documented elixir band ceiling (<=12, <=900);
  the ceiling pins stay scoped to elixirs/scrolls with never-raise notes.
- Role foods: foodHp 1392 (the real classic-era next food band above the
  980 ceiling; the 552 and 874 bands already ship) / epic / wellFed value
  6, duration 600s (the consumable family's entry rung at the classic
  10-minute well-fed duration). Food + flask stack (different aura ids).
- Enchants, each continuing its own slot ladder's step: weapon str 7
  (2/3/5 -> +2), chest sta 10 (4/7 -> +3), boots agi 3 (2 -> +1, the
  base-to-runed step; feet has no Greater rung by design and R7 keeps
  boots stats-only), Lucent Infusion sta 13 (chest +3 continuation,
  PROVISIONAL, see phase 12 carries).

### Recipes and economy
- APEX_CONSUMABLE_RECIPES (recipes.ts), all acquisition ['drop'] (phase 11
  wires), level/budget 25: flasks alchemy skillReq 100 resultCount 2
  (quickening_catalyst 1 + pristine_venom_gland 1 + venom_gland 2 +
  sunpetal_herb 2 + glass_vial 1, input 424 vs output 50); foods cooking
  100 resultCount 4 (seasoned_stock 1 + prime_cut 2 + game_meat 4 +
  sunpetal_herb 2 + cooking_salt 2, 422 vs 360); grand_cauldron alchemy
  125 (catalyst 3 + wyrmfall_core 2 + herbs, 1010 vs 380); laden_hearth
  cooking 125 (stock 3 + core 2 + meats, 606 vs 380). Consumable bills
  take NO wyrmfall_core (the daily gear currency stays gear-priced); the
  flask chain is daily-gated TRANSITIVELY through the catalyst (excluded
  from the mastery pool); the food chain joined the pool (expectations
  re-cut). LADDER_RECIPES did not grow. Enchant bills: apex =
  lucent_reagent 1 + shard/essence-or-dust one step over Greater;
  infusion = lucent_reagent 3 + arcane_shard 2.
- Removal obligations PAID: seasoned_stock and lucent_reagent left
  ALLOWED_UNCLASSIFIED_JUNK and the bag ALL_ONLY list (MATERIAL_ITEM_IDS
  64 -> 66); quickening_catalyst was already classified at phase 07 and
  now names TEN crafts in the affinity table (alchemy consumes its own
  intermediate).

### The capstones and the enchanting-station deferral
- Grand Cauldron and The Laden Hearth are PURE mobile_station family
  reuse: kind tool, epic, placeMobileStation with stationCraftId alchemy /
  cooking resolving through STATION_TYPE_BY_CRAFT to apothecary /
  kitchens; partyShared; the shared 10-minute TRANSIENT duration (the
  capstones inherit the family's tick-domain expiry, never persisted);
  the same-slot clobber against the field forge KEPT deliberately (the
  replace tooltip line states it; the generic clobber pin covers it).
- The spec's "dispenser"/"feast" flavor resolved as party field-crafting
  stations (the party brews flasks / cooks the role dishes AT the placed
  capstone); a richer click-to-receive interaction would need a new world
  interaction seam the station family does not have (stations have no
  world prop at all, open decision 2). Recorded divergence; phase 14 owns
  any richer presentation.
- The phase 07 ENCHANTING HOME-STATION deferral is CLOSED: apex enchants
  are cast-applied and stationless like every enchant apply; enchanting
  stays OUT of STATION_TYPE_BY_CRAFT; its token recipes remain
  toolworks-foreign per-record. No new station type minted.

### The Lucent Infusion guard (the shape phase 12 must flip)
- EnchantDef gained skillReq? (applier floor; apex 100, infusion 125; the
  42 shipped defs keep the historical free floor) and requiresPerfected?.
- Exported pure predicate holdsPerfectedTarget(meta, itemId, slot?) in
  professions/enchanting.ts reads ItemInstancePayload.perfected === true
  on the worn copy in the named slot, or on ANY bagged copy without a
  slot. NOTHING mints the marker, so it refuses every item today (pinned
  by a whole-catalog sweep with an 800 floor and a stamped positive
  control). not_perfected answers BEFORE wrong_slot at BOTH twins
  (resolve + cast-start admission), so the refusal is slot-stable;
  insufficient_skill sits after wrong_slot, before holding/materials.
  Both are text-free enchantResult reasons (the phase 07 channel), toasts
  hudChrome.enchanting.notPerfected / enchantSkillTooLow.
- perfected is EXCLUDED from the eqi wire allowlist by construction and
  PINNED excluded (snapshots.test.ts); a minting-without-wire tripwire in
  lucent_infusion_guard.test.ts fails if any production path stamps the
  marker before phase 12 takes the wire decision.

### Phase 12 carries (also written into phase-12-perfecting.md)
1. Stamp perfected in the Perfecting re-mint; remove the tripwire in the
   SAME change and take the eqi wire-visibility decision (else an online
   player's WORN Perfected copy is invisible to the picker while the sim
   accepts it; the bagged arm rides the wholesale inv mirror and is fine).
2. Narrow holdsPerfectedTarget's bagged arm from the HOLDING to the exact
   copy the apply consumes (item_copy_ref discipline), or one Perfected
   copy licenses spending an ordinary one.
3. Re-decide the Infusion's slot and stat (chest sta 13 is provisional;
   it currently shares chest with enchant_chest_lucent_stamina; the
   guard's universal refusal makes moving it free until minting begins).
4. The not_perfected-before-wrong_slot visibility tradeoff becomes
   player-visible when the Infusion goes live; revisit the deny copy then.
5. Dispatch migration-safety when perfected minting lands: the marker
   starts being WRITTEN to characters.state JSONB then (today the clone
   is field-agnostic and the load bound drop-only, verified, so the
   round-trip is safe by construction; the reviewer pass belongs beside
   the wire decision).

### Phase 14 residuals (copy and presentation carries)
- The station log line now reads "You set up Master's Field Forge."
  (article dropped to stop "the The Laden Hearth"); a name-aware article
  or per-item article field is phase 14 copy polish.
- A flask and the elixir it outranks share the aura_buff_<kind> buff-bar
  glyph (deliberate family join); Well Fed got its own recipe, the flask
  could too at phase 14.
- The consumable tray 6-item truncation with 6 kinds competing; the
  picker's Perfected-arm empty-list message (phase 12 when live).

### Review round record
- architecture: 0 blocking / 3 should-fix / 5 notes; parity: 0 critical /
  2 warning / 4 info; content-obligations: wiki-prose FAIL + 5 PASS;
  frontend-seam: 0 blocking / 6 should-fix / 8 notes; gate-integrity:
  PASS / 2 info. ALL applied in the fix round or recorded here.
- Fix round headlines: the four-craft "past 75 nothing higher ships"
  prose sweep (the phase 06 whole-surface lesson; phases 08/09 falsified
  two arms silently); "You set up {name}." drops the article (the double
  "the The Laden Hearth" catch); skill-gated enchants render as
  aria-disabled rows with the skill line (the unaffordable-row family)
  instead of a false empty-list message, Perfected arm deferred (its
  empty list is true until phase 12); flask tooltip gained the
  downward-refusal line and the honest logout clause; well_fed got its
  own aura icon recipe; FlaskItemDef.elixir.kind narrowed to
  buff_sta|buff_ap|buff_int; the sparse-cone suite gained the
  every-block-equals-the-literal arm.
- Recorded, no change: Aura.flask crosses on the party-frame wholesale
  aura payload and NOT the entity-channel wireAura allowlist (nothing
  reads it; exclude it if that payload is ever trimmed; a client rule
  keyed on flask would work on party frames and fail on self/target);
  the consumable tray truncates at 6 items with 6 kinds now competing
  (phase 14 eyeball); hud.ts sits ~62 lines under its ceiling; the
  cprof pre-sync window reads skill 0 and HIDES gated enchants (the
  safe direction).

### Validation record
- Full suite at the pin-suite tip: 2738 files passed, 38172 tests passed,
  ONLY tests/mob_portrait_source_manifest.test.ts red (3 arms, the
  expected seal staleness; re-blessed at the final code tip via the
  receipt flow with the placeholder-art second seal layer in the same
  change). Blob band re-cut two-sided 10789 < bytes < 11109 around the
  measured 10949 (recipes 124 -> 132, ~193 bytes; structural ceiling
  12288 untouched, ~1339 headroom). 13 mutation probes killed every
  guard THEY TRIED; the test-coverage-auditor later proved two shapes
  the set missed (a mint sharing a line with a legal perfected read
  defeated the first tripwire build; an id-prefix strip keying passed
  the flask suite because every cross-family case put the flask first),
  both closed with re-proven probes in the final test round. Do not
  inherit the stronger "every guard" claim. shipped_item_ids golden:
  +8, no removals. CLOSING GATE: node scripts/gate_select.mjs PASS all
  8 steps at the final tip f577bad787 (GATE_MAX_WORKERS=5), after the
  portrait re-bless (230/230 byte-identical rerender, both seal layers
  advanced in one change). Parity goldens unmoved (the phase draws zero rng; a flask
  parity golden was considered and DECLINED: golden moves cost every
  future sync for an ordering shared code already guarantees).
- Catalog facts for future test authors: every shipped crafted elixir is
  buff_sta, so a "different family" case must put a flask on one side;
  the perl \Q quotemeta trap fired again on a probe pattern containing
  a template literal (dollar interpolation before quoting).

### Release-fill obligations minted this phase
- The reworded guide prose keys (cooking identity/route, alchemy
  ladder/summaries, the falsified-claims sweep arms) go stale in the
  Latin locales; five non-Latin refreshes shipped in-change.
- The 15 Latin locales of the enchanting tier prose (tier.lucent,
  enchantsNoteOffhand) ride the release fill, as recorded by the
  enchanting arm.

### Maintainer decisions (the standing three, one WIDENED); ALL CLOSED 2026-08-20
- Reliquary curation now covers FOUR crafted-primary epic tools:
  masters_field_forge, makers_charm, grand_cauldron, laden_hearth (the
  professions_specimens fishing-rod counter-precedent applies to all four
  identically). Forge world-visibility (open decision 2) now covers four
  invisible placeable stations. The masterwork:engineering revisit
  trigger stands. Plus, new this phase: the flask logout-persistence
  schema call above.
- CLOSED 2026-08-20 (the full delegation). All of these are now answered;
  the record is "Decisions closed 2026-08-20 (the full delegation)", MOVED at
  the 11b doc move into docs/prd/masterwrought/farming/state.md (the
  handoff-table section; the pointer at the end of this file). Reliquary curation for the crafted epic tools and forge
  world-visibility stay as ruled at Phase 10 QA (out, and party-visible).
  The fired masterwork:engineering revisit trigger is
  state-OPEN-MASTERWORK: Phase 12 re-judges and amends
  docs/design/reliquary.md in the SAME change that moves R1 suppression to
  the effect gate, because craftIsGearCapable('engineering') flips and
  falsifies the cited reason. The flask logout-persistence call stays
  session-bound at 1200s as ruled in-session; the flask owner-cancel
  deviation is state-OPEN-FLASK, CLOSED-keep.

## Phase 10 QA release sync (2026-08-14, merge 33d641773f; the QA audit itself runs in a follow-up session)

Step 0 of the phase-10-qa prompt, run to completion and then STOPPED at the
operator's request so the QA fan-out re-runs with fresh context. The branch
tip after this sync is the sync fix commits on top of merge 33d641773f
(release/v0.38.0 at 70e5416fee, 204 commits: the cheater-mark seam, CI
context renames + release minting, the v0.38 locale fill, the market
collapseLowest + Sell-tab price reference, repo-wide dead-code cleanup).

- CONFLICTS (17): resurrection.ts hand-unioned (see the amended flask
  death-accounting bullet in the Phase 10 ledger: aurasSurvivingDeath now
  five clauses with the release's Cheater mark, aurasSurvivingCleanSlate
  keeps only the mark, flask behavior byte-identical in every arm and the
  merge-born flask-x-clean-slate composition pinned with a flask decoy in
  tests/resurrection.test.ts); icons.ts union (well_fed + cheater_mark
  recipes); ci.yml cones + tests/ci_workflow.test.ts (kept the three
  masterwrought subtrees, dropped the release-deleted
  mobile-mount-quick-summon whose last reference died in the cleanup); the
  two dead shot scripts took the release deletion; eastbrook seals
  re-minted on the merged tree (remint_polish_provenance.mjs, three pins
  re-set); portrait trio re-blessed via the FULL 230-row receipt flow.
- COUNT PINS from suite runs, the composition trap's FOURTH firing (both
  sides read identical numbers pre-merge again; command_schema constants
  auto-merged silently, parity narrative at least conflicted): IWorld 324
  = 86 data + 238 methods (extractEssence AND marketSellPriceCheck),
  commands 200 send / 213 dispatch; facet-union pins 324.
- PORTRAIT ENV PING-PONG again (the phase 06 class): the release's CI
  re-encode moved 242 webps; the local receipt rerender restored branch
  bytes for 241 and reproduced the release's bytes for tunnel_rat (a real
  def-change re-bless). Downstream evidence advanced to the local bytes:
  accepted-art.json kept the branch side + manifest pin 61a89cf1;
  tests/target_portrait_view.test.ts 18 sha pins; the vale-cup evidence
  JSON 4 references + its own sha pin in
  tests/vale_cup_ball_portrait_art.test.ts.
- NAMING GUARDS (ip_scrub, originality_renames, overlay_ip_scrub) ran
  GREEN over the v0.38 locale fill: first fill sync with zero reintroduced
  coins. NEW residue class found by the audit instead: translated
  DERIVATIVES of the scrubbed Wyrmcult coin survive as values in five
  Latin game overlays (q_cult_orders/q_necromancers/q_voice_below
  objective labels: de_DE "Wyrmkult-Eiferer", fr_FR "Zelote du Culte du
  Wyrm", es/it_IT/pt_BR similar) and five admin overlays
  (poi.thornpeak_heights.7 "Wyrmkult-Zelte" etc.), pre-existing on BOTH
  parents (not merge damage; the literal-coin guards are blind to
  localized derivatives); non-Latin locales likely carry equivalents.
  QUEUED for the release locale fill / a scrub-guard derivative pass.
- MONOLITH RATCHET: the merged union broke sim.ts (12676 over 12660) and
  server/game.ts (10922 over 10900), both parents individually green.
  Fixed by extraction per the ratchet: professions/daily_gate_load.ts (the
  wyrmfallDaily/craftDaily/emberWeekAnchor load clamps, verbatim, with a
  direct suite tests/daily_gate_load.test.ts; sim.ts 12603, ceiling
  lowered to 12650) and server/interest_policy.ts (the interest radii +
  the four pure predicates, verbatim apart from one em dash; the three
  exported radii re-exported from game.ts so importer contracts hold;
  direct suite tests/interest_policy.test.ts; game.ts 10865, ceiling
  lowered to 10890; four comment pointers re-aimed).
- SEVEN-CLUSTER MERGE AUDIT (sim, server+net, ui, render+guide, guard
  tests, premises, i18n): both-parents byte-identity proven everywhere
  outside the hand-resolved files; db-mock trap empty; new release
  RouteDefs (ad_spend, cheater-mark admin) registered with surface rows;
  injection seams unmoved; guide gate green. Premise amendments applied in
  this sync (flask bullet, renderer-headroom supersession, release-owned
  (b) resolved upstream, rolled.quality re-verify note, phase 11 market
  seam growth, phase 12 newestMatchingSlot pointer, this header).
- RULING WANTED, the sync's one unresolved blocking find (LEFT RED on
  purpose in tests/bags.test.ts, "no craftable bag-kind item def is
  authored at a signable material rarity"): the release's payload-free
  bags contract (#2837) collides with the branch's epic crafted
  sunspun_haversack. Release model: crafted rare+ output mints a signer
  payload (#1149) and the new equipBag guard refuses any bag carrying a
  payload, so craftable bags must stay below rare (their only bag recipe
  is uncommon). The branch's apex bag is epic by design (phase 08). No
  live player can craft it yet (drop-acquisition; patterns land phase 11),
  but the pin is red now. Options: (a) exempt kind 'bag' from the
  crafting signer mint and re-scope the pin to "no crafted bag copy
  carries a payload" (keeps the epic bag, gives up bag signing); (b)
  demote the bag below rare (breaks the apex line); (c) re-scope the pin
  only (leaves the runtime equip refusal live: crafted copies would be
  unequippable, not an option by itself). Maintainer call before the QA
  fan-out proceeds past validation.
- SECOND MERGE-CREATED FINDING, also LEFT RED deliberately
  (tests/rogue_dps_balance.test.ts, one test): the release's new
  deterministic rogue DPS band suite (commit 7541d301e8) derives its
  loadout live from bestEpicGearFor, and on the merged tree the picker
  swaps exactly two slots in all three spec loadouts: neck
  medallion_of_endless_profit to the branch's wyrmfall_pendant and ring2
  architects_cornerstone to prismglass_loop. Measured on the merged tree
  (fight-6498, three seeds): combat 199.37 (in its 195-205 band),
  assassination 170.38 (SIXTEEN under its 180 floor AND below subtlety,
  inverting the pinned assassination-over-subtlety ordering), subtlety
  171.02 (in band). The suite is green at the pure release tip (verified
  in a throwaway worktree at 70e5416fee), so this is the apex jewelry's
  rating-heavy stat shape out-SCORING the raid pieces in the picker while
  measuring WORSE in the real fight for assassination: the exact
  score-vs-fight stat-shape hazard the research record flags (Lionheart /
  Lariat class) and the first fight-DPS measurement ever taken through
  the apex catalog. For the QA fan-out plus a maintainer call: re-shape
  the two jewelry defs' rating allocation (a phase 05/09 catalog
  decision), fix the picker's rating scoring, or re-cut the release band;
  do NOT silently re-band. Feeds the R5 five-percent-envelope method for
  phase 15: measure fights, never scores.
- ALSO RELEASE-OWNED, new this sync: none beyond the (b) resolution note;
  (a) queue-pop forward-port still absent from v0.38.0 (verified at
  70e5416fee), (c) vendor toast and (d) ratchet hygiene stand.
- FULL-SUITE VERDICT at the sync tip (after pnpm install --frozen-lockfile
  resynced node_modules to the release's lockfile bump, which alone cleared
  the two three_compile_async_patch reds): 38733 passed, 8 failed, all
  accounted: the bags ruling red (1), the rogue band red (1), the two
  Three.js patch checks (stale node_modules, green after reinstall), and
  the four inscription-tome fingerprint arms (the lockfile-hash staleness
  class from phase 07, re-minted at this sync). After the reinstall and the
  tome re-mint the ONLY reds on this tree are the two deliberate ruling
  reds above.

## Phase 10 QA release sync, second pass (2026-08-15, merge 9de151aacb; the QA audit itself STILL runs in a follow-up session)

The phase-10-qa prompt was re-run in a fresh session and found the release
had moved AGAIN: the newest origin/release/** line CONTAINING v0.38.0 is now
release/v0.39.0 (v0.38.0's tip fb88c3f094 is an ancestor of it; the v0.39.0
tip d2d1a8ad5c adds the 0.38.1 version surfaces, the r185 camera fix and the
docker sequencer fix on top). Merged as 9de151aacb (322 commits: the
Three.js r165 to r185 bump with its render fixes and GLB re-exports, the
v0.38.0 zero-pending locale fill, the druid Wolf Form 1.0s cadence and Bruin
Form tank kit, ranked arena loss honor, the desktop-client-update packet,
the Grix respawn window, CI measured-weight sharding). Stopped at the
operator's request after the merge, its audit, and the gate; the QA fan-out
re-runs the phase-10-qa prompt in a fresh session and its sync step will
find the branch current.

- CONFLICTS (17), all hunk-level: the five ci.yml sparse-checkout cones
  union the release's market-house-redesign subtree with the branch's three
  (test literal matched, tests/ci_workflow.test.ts green); hud.ts keeps
  BOTH sides' extractions (the branch's entity_display_core, the release's
  ability_description with its newer Gut Punch descriptionNoStealth
  variant; both inline twins deleted, the shared closing brace with them,
  the now-consumerless AbilitySpecNoteField import dropped; a function-by-
  function diff of each side's inline copy against the other side's
  module showed only formatting drift plus the release's newer variant);
  the hud monolith row re-pinned at the exact merged count 19388 (both
  extractions landed together, so the merged file shrank below both prior
  pins 19490/19433; renderer.ts likewise sits at the release's exact
  13754/13754, ZERO headroom on both, see the amended Phase 10 carry
  above); the seven parity goldens plus the two NEW release goldens
  (cat_form_auto_swing, grix_respawn_window) re-minted from the merged
  tree via UPDATE_PARITY (212 passed; movement frames-only state/event
  hashes, ZERO rng digests: the sim auditor confirmed druid_engines
  draws/drawDigest byte-identical to parent 1 and that the one new draw,
  the Grix respawnWindow, is pinned by its own new golden); the four
  Eastbrook polish evidence JSONs proven identical outside their provenance
  blocks then swept by remint_polish_provenance.mjs with the three pin
  literals re-set; the inscription tome fingerprints re-minted for the
  lockfile bump (the phase 07 class, third occurrence: remint tool, four
  suite hashes, media manifest via build_media_manifest.mjs generate,
  provenance comment re-cut to describe every re-mint).
- COUNT PINS: verified from suite runs, NO composition this time (IWorld
  324, commands 200/213 unchanged; world_api_parity, command_schema,
  command_facets, schema_wiring 405 tests green). i18n:gen and wiki:content
  both re-run on the merged tree with ZERO drift vs the auto-merge, so the
  generated artifacts were taken as merged; naming guards (ip_scrub,
  originality_renames, overlay_ip_scrub) GREEN over the fill; S3 guard,
  i18n_status_registry, i18n_completeness, guide freshness green.
- PORTRAIT TRIO: fresh at the tip WITHOUT a re-mint, in the DESIGNED
  bookkeeping-only lane: the r185 bump moved the live browser-bundle
  digest (esbuild inlines three) but no def/still input, and
  tests/mob_portrait_source_manifest.test.ts admits and pins that lane;
  target_portrait_view + vale-cup evidence pins hold. RECORDED for the
  next portrait touch: the committed acceptance's renderer provenance is
  r165-era; the next content phase that re-blesses via the receipt flow
  catches it up (a receipt-backed rerender on r185).
- SEVEN-CLUSTER MERGE AUDIT (sim, render, ui, i18n, guards, premises,
  server; three clusters re-run after a harness auth outage, resumed with
  cached results): the mechanical tree proof first (the committed merge
  tree differs from git merge-tree's auto-merge in exactly the 24 files
  hand-resolved or re-minted; everything else byte-identical). ONE
  BLOCKING FIND, fixed at this sync: the release's NEW
  tests/nythraxis_hitch_bench.test.mjs pinned the literal
  `const INTEREST_RADIUS = 90` by reading server/game.ts, but the previous
  sync's ratchet extraction moved that declaration to
  server/interest_policy.ts, so the auto-merge composed a red pin (a
  disk-scan suite: it rides the always-run floor of every gate); re-pointed
  at interest_policy.ts (the const's home) with a comment. Sim cluster
  CLEAN (flask marker/arm/downward refusal/death persistence/arena wipe all
  intact; the release's grantDelveRewards wrapper removal has no branch
  caller; /dev bis cap arm + dev-portal eventId guard intact; new druid
  aura ids do not collide with the elixir_ family). Render CLEAN (tome
  chain live end to end, swapOnly filter intact, no stale r165 pins
  anywhere). Guards CLEAN apart from the fixed pin (registry unions
  complete both ways; gate_select changes fail toward more tests; sparse
  cones exact; db-mock trap empty across the new release suites).
- BRANCH-OWNED DEFECT SURFACED BY THE AUDIT, NOT MERGE FALLOUT, LEFT FOR
  THE QA FAN-OUT (recorded here so it is not lost): the phase 04 Wyrmfall
  Core letter is registered in src/ui/world_entity_i18n.ts (LETTER_IDS +
  lettersById) but never added to LETTERS_BY_ID in src/ui/entity_i18n.ts,
  so knownLetterId('wyrmfall_core_reward') is false and the mailbox
  (mailbox_window.ts, hud.ts mailArrived) falls back to the wire-shipped
  English sender/subject/body in EVERY locale, and the entity enumeration
  skips the letter; pre-exists byte-identically on parent 1. Fix shape:
  the HEROIC_MARK_LETTER row precedent plus a knownLetterId pin, and a
  guard that every world_entity_i18n LETTER_ID is known to entity_i18n
  (the class: two registries for one letter family with no cross-pin).
- RELEASE-OWNED, recorded (do NOT fix on branch): (e) reword staleness in
  the release's own fill: commit 4ca52c8eb0 dropped "(Druid talent)" from
  Savage Mending's English (frenzied_regeneration is a Wildfang spec
  ability now) but all 18 base overlays still carry the clause (de
  "(Druidentalent)", ja, zh_CN, ko, ru, es, fr verified), invisible to
  every gate because the rows are filled, not pending; the reword-refill
  commit dddbf8da19 predates it. Queue for the branch's release fill pass
  (it edits every overlay anyway) or raise upstream. (f)
  docs/design/graphics-plan.md still opens with "Target: three@0.165",
  invalidated by the bump. (g) the shard measured-weight coverage ratchet
  (tests/ci_shard_partition.test.ts, 95 percent floor) reads 96.39 percent
  on the merged tree with headroom for about 41 more unmeasured test
  files; every branch-only suite takes the median fallback; when the floor
  reds, RE-HARVEST scripts/ci_shard_weights.generated.json from a green
  full-mode CI run of the branch PR, never lower the floor. Items (c) and
  (d) stand; (a) and (b) resolved upstream (amended in the register).
- PREMISES amended at this sync: phase 11 market seam (phase-11 file):
  the release's market-house Browse-row redesign (icon-cell corner family,
  armor pips bottom-right via the new pure resolver market_armor_badge.ts,
  Heroic star top-left, marketNameColor, marketPriceHtml) is now part of
  the seam any pattern/material findability work composes with; the
  renderer/hud zero-headroom carry above; the release-owned register.
  Also for the branch's capture work: the pr-screenshots rig gained the
  change-aware target table scripts/pr_shot_targets.mjs (masterwrought
  captures land as entries there, not one-off scripts) and
  scripts/lib/world_auth.mjs gained chatCommandMessage(text) for raw-ws
  chat commands.
- RULING REDS re-verified at this tip: BOTH deliberate reds hold their
  exact recorded shape (bags: the sunspun_haversack signable-rarity pin;
  rogue band: assassination 170.383 under the 180 floor, byte-identical to
  the recorded 170.38, combat/subtlety unchanged) and NO third red; the
  druid/threat/arena changes did not move the rogue fight numbers.
- GATE at the sync tip 876024395f (gate_select on the committed tree,
  GATE_MAX_WORKERS=5, mode=full because the merge is a broad change): the
  artifact steps (i18n + wiki + sfx regen and freshness, sfx and media
  manifest regen, trackedness, freshness), the malware scan, and biome on
  changed files all PASSED; the full vitest step ran to completion, 2838
  files, 39546 passed, 2 failed, and BOTH failures are the two deliberate
  ruling reds above (bags sunspun_haversack, rogue assassination 170.383),
  no third red and no contention timeouts even beside a concurrent
  session's 8-worker gate; gate_select stops at its first red step, so the
  remaining three steps were run by hand on the same tip: browser
  regressions 19 files / 129 passed, typecheck + env/server/bot builds 5/5
  tasks green, client bundle build green; the tree stayed clean after
  every step. Verdict: PASS apart from the two RULING-WANTED reds, the
  same shape as the first sync.

## Phase 10 QA release sync, third pass (2026-08-15, merge be0da18c94; the QA fan-out follows in THIS session)

The phase-10-qa prompt was re-run in a fresh session; the release had moved
a third time. The newest origin/release/** line CONTAINING v0.38.0 is now
release/v0.38.2, whose tip 1fd1f2e247 is a SUPERSET of the v0.39.0 tip
d2d1a8ad5c merged at the second pass (both v0.38.0 and v0.39.0 tips are its
ancestors; the odd numbering is a hotfix line minted on top of v0.39.0, not
a fork beside it). Nine commits: the composer NaN-sanitize hotfix (PR 3426:
sanitizeFinite in post_output_grade.ts on the beauty AND the bloom read, a
degenerate-normal guard in patches/three@0.185.1.patch, so pnpm-lock.yaml
moved), the Nythraxis arena wardstone quest-gate fix (PR 3433:
DungeonObjectSpawn.interactOnly + quest_gated_entity.ts reads it off the
instance), and the 0.38.2 version surfaces. Merged as be0da18c94.

- CONFLICTS (6), all provenance-shaped: the four Eastbrook polish evidence
  JSONs (both sides re-minted since the common base again) took the release
  sweep, were proven identical outside their sha fields, then re-swept by
  remint_polish_provenance.mjs on the merged tree (values match neither
  parent, no capture retaken; the mint printed identical values on two
  consecutive runs); the two pin tests keep the branch's provenance
  comment plus a new one and carry the tool's three literals. The
  lockfile bump re-stamped every fingerprinted GLB upstream (27 GLBs,
  byte-stable) but the branch-only inscription-tome family is unknown to
  the release, so remint_lockfile_fingerprints.mjs ran on the merged tree:
  release families hits=0 (already stamped), the three tomes hits=2 each
  (FOURTH tome re-mint of the packet), the four suite hashes re-pinned, the
  media manifest regenerated (exactly the three tome rows moved). pnpm
  install --frozen-lockfile FIRST (the stale-node_modules trap):
  three_compile_async_patch green.
- COUNT PINS: IWorld 324 and commands 200/213 unchanged (world_api_parity,
  command_schema green; the delta touches no IWorld/command surface). i18n
  gen and wiki:content ZERO drift vs the auto-merge; naming guards
  (ip_scrub, originality_renames, overlay_ip_scrub) green (the delta moved
  no overlay row); S3 guard green; parity 212 green WITHOUT a re-mint (the
  wardstone interactOnly flag is a render-side display gate; no sim draw
  moved); portrait trio fresh in the bookkeeping-only lane again (the
  three patch moved the bundle digest, no def/still input); tsc green.
- MERGE AUDIT (release-merge-audit steps 1-7, run by hand: the delta is
  99 files of which 68 are provenance/GLB/README badges): overlaps read =
  README.md + the twenty docs/i18n README badges (0.38.1 to 0.38.2, no
  branch text touched), src/sim/types.ts (additive interactOnly field
  beside the branch's own additions, auto-merged), the six conflicts
  above; NO legacy-arm divergence (no route or handler in the delta), NO
  new endpoint or WS command, NO injected-helper signature change
  (isQuestGatedGroundObjectHidden keeps its shape; the branch has no
  quest-gate caller), NO new db mocks; the two release tests that read
  disk (three_compile_async_patch reads node_modules/three,
  nythraxis_wardstone_quest_gate imports the sim) pin nothing the branch
  extracted from; planning-doc premises intact (no packet doc mentions
  wardstones, the output grade, or the version surfaces). Verdict CLEAN,
  zero fixes owed beyond the re-mints inside the merge commit.
- The receipt-backed portrait re-bless is OWED at the genuinely final code
  tip of this QA session (the maintainer directive for a sync touching
  src/sim/content + src/render bytes), together with the accepted-art
  second seal layer, after every fix round has landed.

## Phase 10 QA ledger (2026-08-16, verdict PASS-WITH-FOLLOWUPS)

Fresh session on top of the third sync (be0da18c94, above). The audit ran as
an eight-dimension ultracode workflow (correctness, exclusivity/stacking,
guard, i18n/prose truth, content obligations, cleanup, design ratification,
and a decisiveness/mutation audit in an ISOLATED worktree provisioned at the
exact tip with the phase-close sha checked as an ancestor before probing:
44 mutations tried, 39 killed by a named test, 5 survived) with two-lens
adversarial verification of every non-nit finding (18 verified, 17 upheld,
1 refuted: the S3-corpus claim about mobile_station.ts, refuted correctly by
the professions directory glob, the third time this class has come up), plus
the six repo reviewers dispatched through the Agent tool (architecture 0
blocking / 3 should-fix / 7 notes; cross-platform no drift, 3 info;
test-coverage 2 blocking pin gaps + 3 should-fix + 6 nits; content
obligations PASS + 1 warning + 3 info; frontend seam 0 blocking / 6
should-fix / 5 notes; qa-checklist NOT READY at the tree level solely for
the two standing ruling reds, the phase 10 diff itself with no blocking
defect). No auditor found a blocking correctness defect in the shipped
mechanics: the flask arm, the death predicates, the Well Fed grant, the
capstones, the deny ladder, and every increment recomputed exactly as the
ledger records them.

### Findings, and what the fix rounds did with them (the round-by-round
commit list is in the review record below; every finding applied,
recorded, or refuted with the file open)
- PIN GAPS (blocking, closed): the apex arm of enchantGainTier had no
  assertion anywhere (deleting it regraded the dust-only boots enchant to
  tier 0 in silence; APEX_TIER_REAGENT exported, the tier pinned with its
  quality premise, isApex reads the export); the minting tripwire's shape
  veto missed every shared-line mint whose value was not the literal true
  (||=, &&=, a non-literal colon value, the shorthand property, a trailing
  comment carrying a legal token): rebuilt STRUCTURALLY (comment-stripped
  classification, any colon value except the ?: declaration, every
  compound assignment, the shorthand forms, a residue rule that fails any
  line where an exact perfected token survives after removing the legal
  reads, per-arm write pins, the escaping spellings as positive controls,
  and a legal class for perfected-PREFIXED identifiers the picker now
  mints, perfectedMet and friends). Also closed: the deny ladder's other
  two pairwise orderings at both twins, the flask strip's fade event, the
  delve-DEATH respawn site (releaseSpiritInDelve; the eject was pinned, the
  death was not), the clear-then-grant order (patching sim.ctx.applyAura,
  restored in a finally), the flask sort rung, the same-KIND decoy for the
  strip keying, the localized "You set up X." round trip through ja_JP,
  the clean-slate caller scan (arena + fiesta only, shared walker), the
  Laden Hearth driven end to end through useItem, the well_fed icon recipe,
  the tray shed order plus the ACCEPTED flask starvation (four potions +
  two elixirs + a flask shows no flask, the phase 14 residual now pinned
  as such), the capstone rungs, the Well Fed aura name in the matcher walk,
  and the flask marker pinned OFF both aura wires.
- LEDGER CORRECTIONS the auditors forced: (1) Aura.flask crosses NO wire at
  all: the party-frame payload projects each aura through
  preparePartyFrameAuras into PartyFrameAuraSummary (id/kind/neg/remaining/
  poolPct), so the phase's "crosses on the party frames but not the entity
  channel" note was factually wrong; both projections are now pinned. (2)
  "Five non-Latin refreshes shipped in-change" overstated: of the 19 guide
  keys the phase reworded, 9 were refreshed in the five non-Latin overlays,
  10 were byte-unchanged (three still carrying the retired claims). Measured
  against THIS QA's range: of the 17 keys refreshed here, 13 were reworded
  in English by the QA and 3 were phase-reworded keys whose non-Latin rows
  had never been refreshed (weaponcrafting.routeBody, cooking.routeBody,
  enchanting.identityBody), plus the new perfectedOnly key; the other seven
  phase-reworded keys the QA did not reword were pre-existing abridgements
  that never carried the changed clause (recorded for the release fill).
  (3) A flask does survive an ordinary
  reconnect: the server holds a dropped session in-world for the linkdead
  grace (server/linkdead.ts, five minutes), so the loss surface is a
  deliberate logout, an expired grace, or a realm restart; and the timer
  PAUSES while dead (updateAuras early-returns for a dead entity), so a
  death extends a flask by the time spent dead (classic flasks kept
  ticking; a fidelity nuance recorded, not changed: the shared dead guard
  is what the sicknesses rely on). Both now in the resurrection.ts comment.
  (4) The enchant bills: weapon and chest apex = the slot's Greater bill
  plus lucent_reagent 1 (only boots step their dust 3 -> 4); the hearth
  bill carries sunpetal_herb 2 beside its meats. (5) The phase 07 demand
  math ("3 of the intermediate per apex recipe") does not hold for the
  consumable arms, which take ONE per batch (2 flasks / 4 plates), so a
  flask costs one catalyst-day per two flasks. (6) The flask duration
  1200 rests on the ladder's ONE non-zero duration step (600/900/900), not
  a uniform ladder; the classic 2x-elixir reading would give 1800, the flat
  reading 900; 1200 is the conservative rung (comment corrected). (7) foodHp
  1392 follows the classic band ladder (61/243/552/874/1392/2148); the
  shipped 980 is an off-band value, not a band (comment corrected). (8) The
  role-food sellValue 90 is set by the BATCH (4 x 90 = 360 under the ~422
  bill; Marlow's per-plate 150 would make a 600 faucet), and the "multi-
  output curve" anchor the comment cited did not exist (both anchors are
  single-output): comment rewritten to the real constraint; the visible
  epic-under-rare vendor price is a RULING below. (9) The enchants.ts header
  said "sta +6 on the chest" where the apex chest step is +3 (+3 again to
  the Infusion). (10) The tray-order comment justified the flask's rank
  with a wipe re-apply that the flask's own death persistence contradicts.
- PROSE TRUTH (the reword-staleness class, twice over): three false claims
  the phase minted or missed, all verified against archetype.ts gain math
  and the live recipe rows before rewording: the enchanting levelingBody
  said crafting the Lucent Reagent moves Enchanting skill (it teaches zero
  to everyone: skillReq 75 = tier 3, above the rare ceiling every
  enchanter works under since Enchanting has no oath pair and is never a
  major); the alchemy/jewelcrafting/inscription identityBody rows said
  every rung the trainer teaches sits inside the rare tier and the found-
  pattern rung is the only exception (each trainer also teaches a 75-rung
  intermediate, Quickening Catalyst / Prismglass Setting / Sablewax Vellum,
  above that ceiling); the jewelcrafting/inscription ladderBody rows said
  every rung is trainer work (the phase 09 found-pattern rung is not).
  Also: the alchemy routeBody never named the Grand Cauldron while the
  cooking twin names the Hearth; trainingBody and the professions FAQ read
  as if only Enchanting had a 75 rung (every craft adds one); the enchant
  note counted two shard sinks (the Lucent tier is a third) and named no
  skill floors; the wiki enchant table could not show the 100/125 floors or
  the Perfected gate (build_content now emits skillReq + perfectedOnly, the
  page renders a Skill column and a "Perfected only" badge, new key
  guide.profPages.ench.perfectedOnly with its five non-Latin fills). Every
  reworded key stripped its remaining stale Latin rows (13 rows of
  alchemy.routeBody; every other reworded key was already Latin-pending)
  and refreshed all five non-Latin rows: 17 keys x 5 locales = 85 rows,
  translated by one agent per locale and then verified by a fresh reviewer
  per locale (ja 17/0, zh_CN 17/0, ko 14/3, ru 9/8, zh_TW 12/5; every FIX
  applied verbatim, then a mechanical sweep: placeholder sets, paragraph
  counts, dashes, script family, all 85 clean). On the way the translators
  repaired pre-existing non-Latin defects the English never carried (the
  double-batch Serpent "stays unsigned" inversion in ja/ko/zh_CN/zh_TW/ru,
  an invented "ten crafts per minute" throttle and "+1%/+2%" figures in the
  weaponcrafting route). Register splits the verifiers flagged for the
  release fill are listed under release-fill obligations.
- TOOLTIPS: Well Fed now states its one-shared-effect rule (a newer meal
  replaces it); the flask line states the ranked clean slate.
- THE ENCHANT PICKER (three false statements found by the frontend seam
  review, fixed): during the online unsynced window the picker read
  craftSkills with no synced gate and painted "skill too low" on a master
  enchanter (and the online.ts comment claimed the opposite); the Lucent
  Infusion was selectable at 125 and answered "No eligible item to enchant."
  although nothing can be Perfected yet; the skill line named no floor. The
  pure core takes one EnchantViewerInput (synced, enchantingSkill, the worn
  set): unsynced skips the skill dimension entirely (the
  recipe_pattern_tooltip_view contract, the sim stays the authority), a
  requiresPerfected row carries perfectedMet and paints inert with the
  notPerfected line until a candidate copy carries the marker (hover and
  click agree; step two's noTargets is unreachable for the Infusion), and
  the skill line states the floor through the crafting-window family key
  ("Requires Enchanting 100"), which gives EnchantPickRow.skillReq its
  consumer. The gate lines join the 13px touch bump beside the danger meta
  (the danger selector stays LAST: the sizing pin's block regex depends on
  it). The picker's worn-arm READ was deliberately not switched: the LIG-2
  finding is right that a THIRD option exists (IWorld.equipmentInstances,
  the self mirror, ships meta.equipmentInstance whole in both hosts, so the
  eqi decision only concerns inspecting viewers), but the peer read feeds
  wornEnchantTargets' wireTrimmed pin cluster; recorded in
  copyMeetsPerfectedGate, openTargetPicker, the tripwire header, and the
  phase-12 carry as the recommended phase 12 path.
- THE WYRMFALL LETTER (the branch-owned phase 04 defect the sync audit
  left for this fan-out; confirmed the ONLY letter gap): both client letter
  registries now derive from ONE authoredLettersById builder in
  content/letters.ts; entity_i18n_guards pins the two key sets equal in
  both directions plus the Wyrmfall row by name; the localization_coverage
  hand count grew 3 -> 4 singleton letters with the reason recorded.
- TYPES: one named TimedStatBuffPayload for the three copies of the aura
  payload shape (rule of three); FoodItemDef bars elixir, ScrollItemDef and
  FlaskItemDef bar foodHp/drinkMana (symmetric never-fields).
- SCREENSHOTS (the phase shipped none, a repo requirement): a
  masterwrought-phase10-consumables target in scripts/pr_shot_targets.mjs
  (seven states through the real bound events, lowest preset), captures
  committed under docs/screenshots/masterwrought-phase10-qa/ (flask and
  role-food tooltips, the picker at 99 and at 125 on desktop and mobile,
  the six-kind mobile tray showing the recorded trade live), the five
  ci.yml sparse cones and the test literal extended (the standing
  sparse-cone obligation). Rig rot fixed on the way: the reagent's action
  menu now ends with the #3042 Lock Item row, so the p13-bag-actions
  target's last-row click shot the lock instead of the picker; both sites
  now select the Apply Enchant row by its act token.
- RATIFIED with fresh eyes (design_ratify dimension): (a) refuse-downward /
  replace-upward is the right reading of the pairing wording (the later-
  classic retail flask rule; refuses before consuming; the band pin makes
  "weaker" true); (c) session-bound flasks: keep, with the linkdead
  correction above; (d) every increment recomputes as exactly one rung.
- REFUTED / no-change (do not re-raise): the S3 corpus claim (professions
  directory glob); the retired guide.profPages.ench.enchantsNote key
  ("three tiers", unrendered) is a deliberately RETIRED key under the
  guide_key_coverage doctrine that keeps retired keys for their 21 locale
  rows, not an orphan to delete; the flask-vs-different-stat-elixir stack
  (family-keyed, deliberate); the belt-and-braces recalc after the strip
  (unobservable, documented redundancy); Well Fed born one tick short
  (599.95, the shared per-tick order); not_perfected swallowing not_held
  for a mismatched slot (the documented ladder); the wellFed reference into
  the content table (house style, like def.elixir; now stated in the
  Consuming comment).

### The fix-round review record (every round reviewed fresh, then probed)
- Round 1 (commits f877abad7c, a6d2caf313, 94cb93f0fc, c948dccd83, e50d88c13e)
  was reviewed by a fresh adversarial reviewer (0 blocking, 6 should-fix, 6
  nits, plus a delegated pin audit it spawned: 3 should-fix, 8 nits), a
  gate-integrity reviewer over the cone edit (PASS, 1 warning, 2 info), and
  a 38-probe mutation audit in the isolated worktree at e50d88c13e (every
  guard it tried red except the menu's worn-set wiring, which SURVIVED,
  and the letter guard, which was caught only as a module-load throw). The
  first attempt at this round died on the harness usage limit mid-run
  (three agents at once) and was relaunched fresh; nothing was inferred
  from the dead runs.
- Round 2 (commits 33657ca94d, 72660c4070) applied every round-1 finding:
  the PvP accounting correction (the reviewer's S4 asked for a behavioral
  battleground arm; writing it exposed the indirect readyArenaFighter route
  every earlier auditor and the caller scan itself had missed),
  perfectedCandidateExists asking the builders (S5), the computed-key
  tripwire shapes and the honest header (S1), the literal class-token pins,
  the worn-wiring paint case, the two-gate-lines case (S2/S3), the target's
  `when` list widened to the painter but NOT to the mobile stylesheet (the
  pr_shot_targets pin caught that a whole-sheet path in a specific target
  narrows the generic mobile HUD frames), the lowest-preset seed on every
  variant, the p13 drill guard (the gate reviewer's warning), and the nits
  (test comment, scan title, tooltip clause widened to "instanced matches
  begin and end on a clean slate" with its five non-Latin rows refreshed,
  the ledger's refresh count, the lazy import in the letter guard so its own
  pin prints first, the derived role-food kinds, the end-to-end set-up round
  trip, the capstone length floor, the seam-naming sentinel). Recorded
  rather than changed: ru keeps craft names in Latin throughout its guide
  prose (so "Enchanting 100" in the enchant note matches its neighborhood; a
  locale-wide register call for the release fill), and the ru "Perfected
  only" badge is 35 characters (an eyeball at the wiki table's mobile width
  for the release fill). Reviewed fresh plus a 19-probe mutation audit at
  72660c4070 (16 caught, 3 survived, 1 false positive): ONE BLOCKING (a
  THIRD clean-slate route, resetForArena, the wrapper the SimContext seam
  hands to the Yumi match seat and the Vale Cup kit-swap seat and teardown;
  the scan was blind to a planted ctx.resetForArena in an unrecorded
  module), 3 should-fix (the battleground SEAT wipe unpinned behaviorally,
  a seat-only softening survived; two CLAUDE.md records with the retired
  framing; Yumi/Fiesta wipes source-text only), 4 nits (the tripwire's
  over-veto of a legitimate `cache[perfectedMetKey]` unexplained; two
  overclaiming titles; the catalog comment's missing third clause; per-arm
  pins hidden inside the positive-controls loop). Also surfaced: running
  tests/guide.test.ts regenerates src/guide/content.generated.ts in place
  (a probe-session trap, recorded in memory).
- Round 3 (commit 77e076b8fa) applied all of round 2: the wrapper route as
  a third literal per-module table, per-mode behavioral arms (bg seat before
  the pop; Yumi seat/down/revive; Fiesta seat/down; Vale Cup kit-swap
  seat/teardown), the records and the catalog comment, the tripwire's
  deliberate-veto text and its per-arm case, the titles. Reviewed fresh plus
  a 15-probe audit at 77e076b8fa (13 caught, 2 survived, 0 false
  positives): ONE BLOCKING (the wrapper pattern's bare-identifier argument
  tail let `ctx.resetForArena(e as Entity)` through), 3 should-fix (a
  Protect Yumi down attributed to the readyArenaFighter route when it is
  the DIRECT call in fiesta.ts; the ledger's "revive pinned behaviorally"
  overclaim, since the down had already wiped the flask; the wrapper
  controls hidden behind the table assertion), 7 nits (Vale Cup halves in
  one case; "arena entry" naming readyArenaFighter's own arm; a "carried
  IN" title for a form-up quaff; Yumi/Fiesta seat arms observing after
  kickoff; a 132-char CLAUDE.md line; the sim.ts gloss naming the bind line;
  Yumi/Fiesta ENDS with no behavioral arm). Also fixed in this round, from
  the full-suite run at 77e076b8fa (the third red beside the two ruling
  reds): tests/professions_mastery_reset.test.ts pinned the letter's
  entity_i18n registration by scanning for the hand-seeded LETTERS_BY_ID
  literal this QA replaced with the shared builder; it now pins the runtime
  registry (knownLetterId plus the shared map's row, with a negative
  control), commit 9c97a0e934.
- Round 4 (commit f460599731) applied all of round 3: the wrapper pattern
  takes any argument spelling (members, indexes, casts, ternaries, one
  nested call, wrapped calls) and rejects the declarations by their `: void`
  return annotation, with fourteen call and five declaration controls in
  their own case; the note, both CLAUDE.md records, and the ledger
  paragraph attribute the Yumi down to fiesta.ts's direct call and name
  readyArenaFighter's own arm as the direct site in arena.ts; the Yumi
  revive arm re-plants the flask on the benched body so the revive's own
  wipe is decisive; the Yumi and Fiesta seat arms observe at the countdown;
  the bg seat arm pins the positive state and the form-up title is exact;
  the Vale Cup halves are two cases; the arena family's own seat, end (the
  winner), and send-home (the loser's corpse, which the death kept) are
  pinned in tests/arena.test.ts, the path Yumi and Fiesta ends share.
  Self-probed at f460599731 (six mutations, all caught: the `e as Entity`
  plant, the revive flip, the three arena.ts sites, the Vale Cup teardown
  alone), then reviewed fresh plus a 12-probe audit (8 caught, 1 survived
  by design, 3 survived as defects): TWO BLOCKING (the widened wrapper regex
  still let a depth-two nested argument and an optional call through; the
  readyArenaFighter sibling could not cross a `)`, so a site written the way
  arena.ts writes its neighbors, `ctx.entities.get(pid)!`, hid), 2
  should-fix ("modules that never name readyArenaFighter" false for yumi.ts;
  the Yumi/Fiesta match END branch of endArenaMatch, benched bodies never in
  match.defeated, had no behavioral arm), 6 nits (`bgSeat` for placeInBg;
  the sibling note's "arena entry"; "everyone" for returnFromArena; the
  arena end arm packing two sites; the loser-skip claim carried by the dead
  flag; the mastery-reset title).
- Round 5 (commits 96b7f4d4c2, 9331084310) applied all of round 4: both
  regexes replaced by ONE balanced-parenthesis call walk (whole identifier,
  optional `?.`, string literals skipped, declarations rejected by their
  `: void` return annotation), every readyArenaFighter site classified by
  its own clearPrep literal with the keeps as their own pinned table and
  any unclassifiable site reported (the sim.ts seam passthrough the one
  pinned), a controls case of seventeen call spellings, six non-calls, and
  the classification; the records reworded (call sites, everyone still
  present, the sibling note); the arena end and send-home as two cases with
  match.defeated asserted; the Yumi benched-at-the-whistle END arm; the
  mastery-reset title. Self-probed at 96b7f4d4c2 (six mutations: five
  caught, and the string-skip probe SURVIVED because the string control
  carried balanced parens; fixed in 9331084310 with an unbalanced paren and
  the argument text asserted whole, re-probed red), then reviewed fresh plus
  a 12-probe audit (8 caught, 4 survived: two benign, two defects): NO
  blocking, 3 should-fix (the walk's whole-identifier guard had no control;
  `isDeclaration` swallowed a call in a ternary's true arm whose else is
  `void 0`, a real fail-open spelling biome leaves alone; the DIRECT route
  pinned as a file set while the record says "in exactly two places"), 8
  nits (the string model's unmodeled regex literals and nested templates,
  which fail loudly; whitespace or paren spellings before `(` that biome's
  formatter rewrites; the classification reading the whole argument blob;
  raw controls not run through the comment stripper; a 90-column ledger
  line; the return-record condition on the send-home; the sibling note's
  file-attribution parse; the per-file swap blind spot, closed elsewhere).
- Round 6 (commit ee6433e506) applied all of round 5: `isDeclaration`
  wants the `: void` to end a signature (`;` or `{`); the direct route is a
  per-file count table through the same walk (with the predicate's own
  module excluded, since its definition returns `Aura[]`); the controls
  carry the identifier neighbors on both sides and the `void 0` ternary and
  run through the same comment stripper as the tree; the walker comment
  states its string model's edge and the format-gate-netted spellings; the
  two wording nits and the rewrap. Self-probed at ee6433e506 (four
  mutations, all caught: the guard deleted, the `void 0` plant, a second
  direct call in fiesta.ts, `isDeclaration` reverted), then reviewed fresh:
  NO blocking, 2 should-fix (the walker comment's "fails loudly, never
  silently" was false in both halves: an unmatched `(` in a regex literal
  inside a call's own arguments throws, an unmatched `)` truncates the
  argument text quietly, and balanced backticks parse; the route-1 pin's
  rationale named a rename, which already reds the table, when what the pin
  adds is the predicate MOVING modules), 8 nits (comment-stripper on only
  some controls; the identifier guard described as two-sided; "Neither"
  closing a three-item list; a duplicated name literal; counted declaration
  FORMS unnamed; a semicolon-to-comma ambiguity in the sibling note; the
  module exclusion also hiding a direct call inside resurrection.ts itself;
  ragged rewraps).
- Round 7 (commit a799dcf6d6, comments and test controls only) applied all
  of round 6: the walker comment states the regex-literal edge exactly and
  names the classification tables as the net for its quiet half, with that
  spelling pinned as a control (a truncated wipe REPORTED as a
  passthrough); every control runs through the same comment stripper; one
  name literal; the counted declaration forms named; the route-1 comments
  say what the exclusion hides and what the pin adds; the sibling note's
  semicolon; the reflows. Reviewed fresh: NO blocking, 3 should-fix (the
  route-1 pin's "move" rationale, since a move under src/sim is COUNTED and
  reds the table on its own, so the pin's unique net is the predicate
  leaving the sim tree; arrow-property forms are not seen, not counted; the
  regex-literal taxonomy stated as absolute where a nested template with an
  unbalanced inner paren shares the edge and a later surplus paren can close
  a runaway walk quietly), 6 nits (two orphan lines the reflow left; the
  bracketed call is visible to a quoted-name scan; the pet_commands.ts
  citation's path and role; the passthrough gloss; the suffix mechanism;
  the quote arm of a regex literal). Judged in-session: the "unsafe
  direction" of the quiet edge is not fail-open, since a planted site is a
  new count and a rewritten site changes bucket, so a table reds either way;
  the one blind combination (a swallowed span hiding a second call) is
  stated in the comment rather than guarded by a heuristic cap.
- Round 8 (commit 0498428e4f, comments and reflows only) applied all of
  round 7. Reviewed fresh for FALSE claims only: one (a regex-literal
  misread that leaves the clearPrep literal inside its span keeps the site
  in its bucket, so "reds either way" was too strong), plus two reflow
  orphans.
- Round 9 (commit 296c6b4e32, comments, one control, reflows) applied all
  of round 8: the misread clause states exactly which misreads change
  bucket and which do not, names the per-mode behavioral arms as the net
  for the residue, and pins that residue beside the reported case as a
  documented blind spot; both reflows are whole-block rewraps. Reviewed
  fresh for false claims: two, both introduced by that rewrite (a swallowed
  later call DOES red the table for a rewritten site, since its count
  vanishes, and is quiet only for a same-bucket planted site; a wipe taking
  in a foreign `false` keeps its bucket because `true` is tested first),
  plus the note that the new control pinned the consequence, not the
  truncation.
- Round 10 (commit bc0a2bfa4d, comments and one control) applied all of
  round 9: the misreads that move a table and the two that stay quiet are
  enumerated exactly, and the blind-spot control asserts the truncated
  argument text beside the bucket. Reviewed fresh for false claims,
  measured case by case (twelve fixtures): one (the quiet clause omitted
  "and swallows no later call of the same name", a case the preceding
  clause already stated correctly); the args pin byte-identical to the walk;
  no orphan.
- Round 11 (commit f88803bb64, one sentence): the quiet clause carries
  its third conjunct and the planted-swallow exception says "as classified
  after the swallow". Reviewed fresh for false claims over twenty-one
  fixtures: two safe-direction overstatements of the exception (the
  passthrough list is asserted by content, so a planted passthrough that
  swallows one always reds; two hidden calls leave a -1), one ruling item
  (a run-on that never closes throws, which the preceding sentence names
  and the quiet clause, scoped to table outcomes, does not contradict:
  no change).
- Round 12 (commit 5f56ade89e, two sentences): the exception is bounded
  to "the counted bucket of the one call it hides", with both boundaries
  stated. Reviewed fresh for false claims over the previous rounds'
  twenty-one fixtures plus eighteen new ones (every quiet and every red
  case the wording names, measured before and after on the test's exact
  table shapes): CLEAN, no false clause, no orphan. The chain closes here:
  5f56ade89e is the code tip the closing validation below was run at.
- The chain in one line: rounds 1 to 6 changed behavior or pins (each
  found by the previous round's fresh review and probe), rounds 7 to 12
  changed comment truth only, and the closing rule was "the first fresh
  review that reports no false claim". Every commit carries a body; every
  finding of every round was applied, none deferred.

### Rulings taken or wanted (see the report; standing ones re-stated)
- WANTED (new this QA): D10-B1 the capstone dispenser/feast divergence:
  the shipped party field-crafting stations hand a non-crafting party
  member nothing, and the phase-15 kit premise still lists "feast" as a
  buff source; option A is a bounded serve-at-station amplifier on the
  family's eachPartyStationInRange walker (a flask quaffed or a role food
  finished within STATION_RADIUS of an active capstone also lands on the
  party in range), option B is to ratify the stations and correct the
  phase-15 premise. D10-D1 the Lucent weapon tier has no int twin although
  every lower weapon rung pairs str with int (the #1712 review): add
  enchant_weapon_lucent_spellpower (int 7, same bill, skillReq 100, name +
  fills + wiki + the int magnitude pin 24 -> 26) or record the omission.
  STK-2 flask auras are offensively dispellable (school nature, no
  undispellable flag) and Spellplunder copies the FLASK MARKER onto the
  thief: stamp undispellable on flask auras (classic consumable buffs
  carried no dispel type) or keep purgeable and strip the marker in the
  steal copy; either way a pin. Q2 the role-food sellValue inversion (epic
  90 under Marlow's rare 150) stands on the batch math: accept, or treat
  Marlow's 150 as the outlier. FE6 the low-tier aura cap (8 visible) can
  shed a flask or Well Fed icon while a re-quaff spends a unit
  unconditionally: record flask timers as cosmetic (the settled buffs
  doctrine) or add the elixir family ids to NEVER_SHED_IDS (the marker is
  not client-side). I18N-06/CO-7 the four aura display names (Ironhusk
  Vigor, Warboar Might, Runewater Clarity, Well Fed) are not in the naming
  registry and "Well Fed" is WoW's verbatim same-role buff name: register
  as GENERIC-with-caveat (the shipped elixir aura names are unregistered
  too) or rename. FLASK-PARENTHESIS (new, from the fix-round review): a
  20-minute flask does not survive an instanced match's seat or end (arena,
  Fiesta, Protect Yumi, Thornhollow Fields, Vale Cup) nor a Yumi or Fiesta
  down, only a Thornhollow Fields DEATH; ratify the arena-family clean-slate
  doctrine as it stands (recommended: the classic-era rule kept flasks
  through battleground deaths, never through a normalized bout's gates), or
  add a flask carve-out to aurasSurvivingCleanSlate for the battleground
  seat only (a one-line change plus the tooltip clause and its five
  non-Latin rows).
- STANDING (re-surfaced): the two ruling reds (bags sunspun_haversack, the
  rogue band assassination 170.383), reliquary curation for the four
  crafted epic tools, forge world-visibility, the flask logout-persistence
  schema call (recommendation: keep session-bound at 1200s; the sickness
  fields are the cheap persistence shape if taken), the provisional
  Infusion slot/stat (defer to 12 is fine).
- RULINGS TAKEN by Fernando in-session (2026-08-16), all twelve, each the
  recommended option:
  (1) The two standing reds: ACCEPT the phase design and re-pin. For the
      bags red this is option (a) of the sync record above: exempt kind
      'bag' from the crafting signer mint (resolveCraftForRecipe's
      isSignableMaterialRarity arm) so a crafted sunspun_haversack carries
      no payload and equipBag admits it, and re-scope the pin to "no
      crafted bag copy carries a payload" with a dated OUTCOME note; for
      the rogue band it is a re-pin of tests/rogue_dps_balance.test.ts to
      the merged-tree loadout (assassination 170.38 with the wyrmfall
      pendant and prismglass loop, its band and the sibling-ordering claim
      restated to what the apex jewelry stat shape yields), again with a
      dated OUTCOME note. Both are sim-or-balance work with their own
      review and gate cycle: OWED at the head of phase 11 (below), not
      slipped into this QA's close.
  (2) FLASK-PARENTHESIS: keep the arena-family clean-slate doctrine as
      shipped and pinned (no carve-out).
  (3) Flask logout persistence: keep session-bound at 1200s (no schema).
  (4) D10-B1: ratify the party field-crafting stations; correct the
      phase-15 kit premise to drop the feast (docs, phase 15's file).
  (5) D10-D1: ADD the Lucent weapon int twin (enchant_weapon_lucent_
      spellpower, int 7, same bill, skillReq 100, name + M16 fills + wiki
      regen + the int magnitude pin 24 -> 26): OWED, phase 11.
  (6) STK-2: stamp flask auras undispellable (classic consumable buffs
      carried no dispel type); Spellplunder cannot take them; pin both:
      OWED, phase 11 (sim change, its own review).
  (7) Q2: accept the role-food sellValue batch math (epic 90 under
      Marlow's rare 150); recorded as deliberate.
  (8) FE6: flask timers are cosmetic under the settled buffs doctrine;
      the low-tier aura cap may shed the icon; recorded.
  (9) I18N-06 / CO-7: register the four aura display names (Ironhusk
      Vigor, Warboar Might, Runewater Clarity, Well Fed) as
      GENERIC-with-caveat in the naming registry: OWED, phase 11 (docs).
  (10) Reliquary: the four crafted epic tools stay OUT of the Reliquary
       (crafted tools are not conquerable unique loot).
  (11) Forge world-visibility: party-visible, as shipped.
  (12) Infusion slot/stat: DEFERRED to phase 12, which mints the marker.

### Release-fill obligations minted or widened at this QA
- 13 more Latin rows pending (alchemy.routeBody), plus the new
  guide.profPages.ench.perfectedOnly key in 15 Latin locales.
- Register splits the verifiers flagged, all pre-existing and outside the
  17 refreshed keys: ja alchemy.ladderBody still writes Elixir of the Bear /
  Serpent in Latin beside the now-localized route row; ja "ルーンの革"
  (prose) vs "ルーンの獣皮" (enchant name key); ko cooking.materialsBody
  "사냥 고기" vs the item's "야생 고기"; ko faq.a6's own register
  (제작법/스승/작업장) vs the craftProse rows; ru enchantsNoteOffhand
  paragraph 2 keeps the Runed/Resonant names in Latin while the table
  renders the Cyrillic enchant names, and "Стойкость" for Stamina in the
  guide prose vs "Выносливость" in itemUi.stats; zh_CN faq.a10 and
  professions.toolEffectsBody store a literal backslash-n; the retired
  enchantsNote row (all locales) still says three tiers and carries the
  older Runed/Resonant coins (unrendered, cleanup only). The Latin
  craftProse rows generally keep NPC/place/deed names in Latin where the
  entity rows localize them (the untouched neighborhood, one future sweep).

### Phase 11 / 12 / 14 carries added
- Phase 11, at its HEAD (from the rulings taken above): the two-reds
  execution (bag signer exemption + re-scoped pin; rogue band re-pin), the
  Lucent weapon int twin, undispellable flask auras with the Spellplunder
  pin, the four aura names in the naming registry, and the phase-15 kit
  premise correction. Each with its own review and gate cycle.
- Phase 12: the third worn-arm option (above) is written into the
  phase-12 carry; the picker's perfectedMet row means minting simply makes
  the Infusion row actionable, no picker copy change owed; the tripwire's
  perfected-prefixed identifier class must not be widened to the bare field.
- Phase 14: the tray flask starvation is now pinned as accepted; the
  flask/elixir shared glyph note stands (a flask_<kind> icon needs the
  marker on the wire, a cross-platform change).
- Phase 15 (R5): the design_ratify rough math puts the consumables alone at
  about 3 percent of physical white DPS and the full physical kit at 4.2 to
  4.7 percent (tank EHP about 5 percent before Perfected pieces); measure
  the DPS kits with the serpent elixir already in the baseline, and treat
  flask 15 / well-fed 6 as the first tune-down knobs, never the formulas.

### Validation record
- Named suites at every round (the touched files' suites: resurrection,
  battleground, yumi_match, fiesta, vale_cup_match, arena,
  lucent_infusion_guard, bag_item_action_menu_paint, enchant_apply_view,
  entity_i18n_guards, aura_icons, mobile_station_party, masterwrought_budget,
  professions_mastery_reset, and the rest of the phase's touched suites) all
  green at each commit; `npx tsc --noEmit` clean and biome clean (warnings
  only, the repo's accepted debt) on every changed file at every commit.
- Full suite (`npx vitest run --maxWorkers=5`) on the committed tree at
  77e076b8fa (three reds: the two ruling reds plus the mastery-reset
  source-text pin this QA had staled, fixed in 9c97a0e934), then at
  f460599731, 9331084310, and ee6433e506: 2825 files / 39609 tests green,
  ONLY the two standing ruling reds (tests/bags.test.ts sunspun_haversack
  signable rarity; tests/rogue_dps_balance.test.ts assassination 170.383
  under the 180 floor), 12 files / 115 tests skipped, 2 expected fails.
- `node scripts/gate_select.mjs` (GATE_MAX_WORKERS=5, committed tree, no
  pipe) at ee6433e506, a799dcf6d6, 0498428e4f, 296c6b4e32, bc0a2bfa4d,
  f88803bb64, and the closing code tip 5f56ade89e: PASS through
  every step to the full vitest run (i18n:gen + wiki:content + sfx:check via
  turbo, i18n freshness, sfx and media manifest regen + trackedness +
  freshness, malware scan 6207 files 0 high after priors, biome on changed
  files), where the planner fell back to the full suite (broad diff against
  the integration base) and stopped on exactly the two ruling reds. The
  steps behind that first-red stop, run by hand in the gate's own order at
  every one of those tips from a799dcf6d6 on: browser regressions 19 files
  / 129 tests green; typecheck + env/server/bot builds 5/5 successful;
  client bundle built. Tree clean before and after every run. (The docs
  close commit after 5f56ade89e touches docs/ only.)
- Portrait seal: `build_mob_portrait_source_manifest.mjs --check` reports
  fresh (bookkeeping-only renderer bundle drift, the tolerance
  b8026c84ff/ddd449f506/406a6b01a4 shipped in v0.38), and both seal suites
  (mob_portrait_source_manifest, placeholder_art_completion) green at the
  tip; the receipt re-bless ritual is therefore not owed for a code-only tip
  and was NOT run (recorded here as the deliberate deviation from the QA
  prompt's STEP 0 wording; the ritual stays owed if --check ever reports
  real drift).
- Mutation probing across the rounds (all in the isolated worktree at the
  exact tip under review, one mutation at a time, tree re-checked clean
  after each): 44 (audit) + 38 + 19 + 15 + 6 + 12 + 6 + 12 + 4, then the
  rounds 6 to 12 node-replica fixture sets (up to thirty-nine per round)
  over the walker; every guard this QA added is decisive against a named
  mutation, and every survivor found was fixed and re-probed red.

## Phase 11 pre-flight (2026-08-16, Step 0 record)
- Worktree guard passed (session switched into ~/Documents/wocc-masterwrought);
  tree clean at the phase 10 QA tips (code 5f56ade89e, docs d149382bc4, HEAD =
  the docs tip).
- Release sync: VERIFIED ALREADY COMPLETE, no new merge this session. After
  `git fetch origin --prune`, the newest release branch is origin/release/v0.39.0
  (tip d2d1a8ad5c) and `git rev-list --count HEAD..origin/release/v0.39.0` is 0;
  origin/release/v0.38.2 (tip 1fd1f2e247) likewise 0 incoming. Both were merged
  during the phase 10 QA (merges 9de151aacb and be0da18c94, both below the QA
  tips), so no release-merge-audit is owed this session; the third-pass sync
  record above stands as the audit of record.
- Portrait seal: `build_mob_portrait_source_manifest.mjs --check` run FIRST at
  the pre-flight tip: FRESH (bookkeeping-only renderer bundle drift, the v0.38
  tolerance); no re-bless owed.
- Memory scan done (test-pin trap index + caller-set/wrapper trap,
  guide.test.ts regen-in-place, shot-target `when` rule, gotcha catalog's
  local-tooling and PR/CI clusters).
- Order of work this phase: the five ruling items owed at the head (each its
  own commit + fresh review) land BEFORE the pattern/vendor/market work: (a)
  the two standing reds per ruling 1, (b) the Lucent weapon int twin, (c)
  undispellable flask auras + Spellplunder pin, (d) the four aura names into
  the naming registry, (e) the phase-15 feast premise correction.

## Phase 11 pre-fan-out ledger (2026-08-16, Step 1 seam record + the channel decision, recorded BEFORE any pattern row lands)
- Seam verification (four Explore agents over the live tree, all anchors
  re-verified at HEAD): the append contract in src/sim/loot/loot_roll.ts is
  draw-position arithmetic: draws are consumed in array order, a rollGroup
  spends exactly ONE rng.next() at its FIRST member's index, an ungrouped
  entry spends one rng.chance (plus rng.int only if it carries copper), so
  appending at the tail leaves every existing draw's stream position
  byte-identical and inserting or reordering forks the parity digest. The
  heroic-only block and awardWyrmfallCores draw AFTER the base loop, so a
  base-table append still shifts those later draws forward: the parity
  goldens that reach a final-boss kill (nythraxis_full_pull) move BY DESIGN
  and are re-minted via UPDATE_PARITY in their own reviewed commit; every
  other golden staying byte-identical is the real append-only proof.
- The pattern universe is EXACTLY the 28 acquisition:['drop'] apex recipes
  (10 APEX_ARMOR + 10 APEX_GEAR + 8 APEX_CONSUMABLE); enchants are EnchantDef
  rows, not recipes, and take no pattern. There is exactly ONE raid
  (nythraxis_boss_arena) and five heroic five-mans; rifts are the third
  pillar. makeHeroicVariant spreads ...base BUT its generator filter
  (quality + slot + kind armor/weapon/held_offhand) means a kind:'recipe'
  def in a heroic-eligible table mints NO variant and heroicItem() no-ops
  for it; the invariant (never a flagged DEF in a heroic-eligible table)
  is honored by dropping only patterns.
- CHANNEL ASSIGNMENT (the phase decision; R8 bounds it to the three pillars
  and no document assigns recipes, so it is recorded here before authoring):
  RAID (nythraxis, tradable drops) takes the ten APEX_GEAR patterns
  (weapons, shield, jewelry, gadgets, grimoire: the chase prestige set);
  RIFT (B/A/S winning clears, tradable drops riding addRiftClearGearLoot as
  the appended draw after the mount roll) takes the ten APEX_ARMOR patterns
  (the bulk armor demand on the repeatable pillar; the C arm's early return
  means C rifts never reach the pattern draw, recorded as designed);
  HEROIC QUARTERMASTER (deterministic, day-one) sells the eight
  APEX_CONSUMABLE patterns for Heroic Marks (consumable crafters get
  deterministic day-one access so the raid economy functions; gear patterns
  stay chase items per R8's split). Planned initial rates and prices (the
  build records finals): raid = ONE new rollGroup appended at the table
  tail (one new draw total, at most one pattern per kill), total 0.40
  partitioned 0.04 per pattern; rift = one appended rng.chance(0.08) per
  winning B/A/S clear then one rng.int pick over the sorted rift pattern
  list; quartermaster = skill-100 patterns at 12 marks (the ring point),
  the two capstone patterns at 16 (the neck point), in the shipped mark
  family. Phase 15 measures and tunes; rates recorded, never re-derived.
- acquisition STAYS ['drop'] on all 28 (the learn flow's acquireRecipe
  source is 'drop', the tooltip gate and the phase 02 sweep key on it, and
  the union has no 'vendor' token); the wiki mislabel is fixed at the
  GENERATOR level: build_content.mjs emits a vendor-channel acquisition for
  recipes whose teaching pattern id is in HEROIC_VENDOR_STOCK, and
  professions_craft.ts renders a new guide.profPages.sourceVendor row for
  it, keeping guide.test.ts honest for both channels with sourceDrop
  untouched for the drop channels.
- Known pin movements (from the seam reports, so the build does not
  rediscover them): tests/nythraxis_raid_unit.test.ts requires every
  non-mount raid entry to carry rollGroup nythraxis_drop_[1-5] and pins
  groups.size 5 (the pattern group re-cuts it); tests/dungeons.test.ts pins
  the heroic-raid ungrouped set as the four reins (untouched: no pattern
  rides HEROIC_BOSS_LOOT); tests/heroic_vendor.test.ts pins stock 11 /
  gear 10 and its gear-shape loop must exclude pattern rows like
  wyrmfall_core; the market category work moves tests/market_filters.test.ts
  (list pin + All-only sweep non-vacuity) and re-cuts the phase 02
  ['all','other'] pin in tests/recipe_pattern_items.test.ts to
  ['all','pattern']; a pattern browse category is a VALUE on the existing
  itemType axis, so NO IWorld member changes and the parity member pin
  (324 = 86/238) does not move.
- Commission board re-check CLOSED by inspection: the board lists from the
  VIEWER'S known recipes (commission_order_view filters knownRecipes) and
  the sim gate keys on the OUTPUT def's kind, so pre-pattern apex listings
  were per-player impossible all along outside the picker's own known set;
  patterns make rows appear per player exactly at learn time; no board
  change owed. vendorCountForced decision (phase 02 QA carry): quartermaster
  patterns sell singly (quantity hardcoded 1 per purchase), duplicates
  purchasable BY DESIGN (tradable surplus makes the vendor price the market
  ceiling, the valve working as intended).
- Pattern def shape decisions: ids pattern_<output id>; kind 'recipe' defs
  in a new src/sim/content/apex_patterns.ts merged by data.ts; quality
  'epic' for all 28 (they teach the epic tier; recipe rarity stays monotone
  to power); classic per-craft display prefixes (Plans: armor/weaponcraft,
  Pattern: leather/tailoring, Design: jewelcrafting, Schematic: engineering,
  Technique: inscription, Recipe: alchemy/cooking); modest uniform
  sellValue; every id owes committed opaque 128px WebP art + audit
  admission + M16 non-Latin name fills + wiki regen (the phase 02 QA art
  blocker: ITEM_ART_PENDING is deliberately empty and an artless pattern
  404s and reds item_icons).
- makers_charm rollback line lands in THIS ledger (the packet keeps
  deploy/rollback notes as state.md prose, the phase 04 precedent): the
  makers_charm ToolEffectId widens a PERSISTED enum; a rollback to a
  pre-phase-09 binary silently deletes a slotted charm at load (not a loud
  failure), and that hazard becomes player-reachable the moment
  pattern_makers_charm lands in the raid channel this phase; the paired
  cosmetic note: a stale bundled desktop or native client reads the
  comma-joined mst as one craft id and omits the mobile-station row, server
  gating unaffected.

## Phase 11 BUILT ledger (2026-08-16, pattern drops and vendors)
- Commits: 72f4fa16b1 (patterns + append-only loot + art + i18n names),
  4a87b16ff0 (quartermaster stock + the wiki vendor channel), 3181dbf7bd
  (market pattern category), 835591eddc (the nythraxis parity golden
  re-mint). Build was the phase file's three-agent fan-out plus the
  coordinator's fan-in; the referential suite (Agent 4) follows.
- RATES AND PRICES AS WIRED (the recorded initial numbers; phase 15
  measures, never re-derives): RAID: rollGroup 'nythraxis_patterns'
  appended at the tail of the nythraxis base table, ten APEX_GEAR patterns
  at chance 0.04 each (one partitioned draw, at most one pattern per kill,
  0.40 total). RIFT: draw 6 appended after the mount roll in
  addRiftClearGearLoot, rng.chance(0.08) per winning B/A/S clear then one
  rng.int uniform pick over the sorted ten-armor-pattern list
  (RIFT_PATTERN_ITEM_IDS; C rifts exempt by the existing early return, by
  design). QUARTERMASTER: the eight APEX_CONSUMABLE patterns, six
  skill-100 at 12 marks (the ring point), two capstones at 16 (the neck
  point); the valve note lives in heroic_vendor.ts (the marks vendor IS
  the valve, live from day one; tradable duplicates purchasable BY DESIGN,
  the vendor price acting as the market ceiling; quantity is the vendor's
  hardcoded 1 per buy).
- Pattern def facts: 28 ids pattern_<output id> in the new
  content/apex_patterns.ts; kind 'recipe', epic, sellValue 100, tradable,
  bind by consumption at learn; classic per-craft display prefixes (Plans:
  armor/weaponcraft, Pattern: leather/tailoring, Design: jewelcrafting,
  Schematic: engineering, Technique: inscription, Recipe: alchemy/cooking);
  28 committed SVG-sourced opaque 128px WebPs with per-item
  woc_original_svg provenance (docs/achievements/masterwrought-phase11-art,
  batch-XOR-entries honored), audit admission advanced; 28 entity names
  with five non-Latin fills each composing each locale's scheme words.
- DECISIONS made at the build (each with its reviewer trail):
  (1) Sundering gained the recipe-kind guard: the raid patterns are the
  first epic AND raid-sourced non-gear ids, so without it a chase pattern
  ground into one essence; classic disenchanting never took recipes; the
  one-negative-per-clause pin rides the eligibility-boundary test with the
  raid-sourced premise pinned. (2) NO Reliquary pages and NO deeds for
  patterns: consumed-on-learn knowledge, not catalogued collectible gear
  (the ruling-10 crafted-tools precedent); content-obligations-reviewer
  audits the call at the review wave. (3) NO market corner mark: both
  .mkt-ico corners are taken and a pattern mark is phase 14 restyle
  territory; the category chip plus the parchment art carry findability.
  (4) The guide masterwork prose apex clause is DEFERRED TO PHASE 12
  (sanctioned by the phase 08 carry's "with phase 12"): the Perfecting
  head start recuts that prose once, capturing the suppression exception
  and the head start in one reword instead of staling the filled non-Latin
  rows twice. (5) sourceVendor is a GENERATOR-level classification
  (teaching pattern stocked = vendor row); sim acquisition stays ['drop']
  for the learn flow. (6) vendorCountForced needs no pattern entry (it is
  the copper-vendor force-1 rule; the marks vendor grants exactly one with
  no quantity UI). (7) rods verified trainer-only (pinned upstream).
  (8) tests/rift_rank_tuning.test.ts re-cut (bonus-draw filter widened to
  the pattern list): the one out-of-assignment file Agent 1 touched,
  flagged for the review wave.
- Parity: exactly ONE golden moved (nythraxis_full_pull, the appended
  draw), re-minted via UPDATE_PARITY on its shard alone; the other 66
  golden FILES stayed byte-identical across the full run (211 was the
  green-TEST count, mislabeled "goldens" here and in 835591eddc's commit
  body, corrected at the round-2 review), the append-only proof.
  Portrait seal at the content tip: --check FRESH (bookkeeping-only
  bundle drift, the v0.38 tolerance; no re-bless owed).
- Release-fill obligations minted: the 28 pattern names x 15 Latin
  locales, itemUi.market.filterTypePattern, guide.profPages.sourceVendor,
  and itemUi.tooltip.flaskUnremovable Latin rows (all pending-tracked);
  the 28 new item ids enter the shipped_item_ids golden at the release
  re-mint (append-only; the suite demanded no re-mint now).
- S2 closure: the commission-board pre-pattern window is CLOSED by this
  phase (patterns are live acquisition; the board lists from the viewer's
  own known recipes, so rows appear per player exactly at learn time).
- BUILD REVIEW WAVE (2026-08-16; four charter reviewers as general-purpose
  agents after the typed-agent empty-report failures, plus Agent 4's
  referential suite ff2249b47a with its four decisive probes; the wave
  survived a mid-flight session-limit outage, every agent resumed from its
  transcript): ONE BLOCKING (content-obligations): the reliquary equality
  pin went red because the ten epic raid patterns entered the derived
  conquerors_nythraxis rare+ set (26 vs 16): the no-pages DECISION was
  right under the reliquary doc's own curation latitude but UNEXECUTED at
  the seam; fixed with the kind-keyed isReliquaryCarvedOut carve-out
  written at the read plus an exactly-ten vacuity guard (over-carve and
  dead-carve both impossible), suite 115/115. The phase 08 run-the-FULL-
  suite lesson re-proven: hand-picked matrices missed a catalog-derived
  pin again. ONE SHOULD-FIX (sim-seams): the rift pattern draw had no
  parity-scenario coverage (an insertion above draw 6 would escape every
  golden); closed with the NEW rift_clear_rewards scenario (seed 4332, a
  real three-floor A-rank clear through the live descent flow reaching
  completeRiftClear; the 8 percent draw SUCCEEDS in-window so the golden
  pins the pick position; the winning-clear facts: dev-style entries win
  with event null, candidates need partyKey + bossDiedAtTick + the boss
  floor), insertion-above probe decisive, full parity 215 green, zero
  existing goldens moved. NITS APPLIED: the live-catalog exclusivity pin
  sorted per the sibling doctrine plus a search-by-name pin
  (market_filters); a real-quaff wire arm pinning und=1 and NO flask field
  on the wire (wire_aura, composing the two previously separate halves).
  RECORDED, no change: sourceVendor generated rows land one commit before
  their English source (bisectability nit); the deploy-skew pattern-chip
  degradation is graceful by design; the stale-bundle market count note is
  pre-existing; the eventual packet PR owes before/after screenshots for
  the market chip (a visual change; phase 17 close). Cross-platform and
  frontend reviews otherwise fully clean (parity pin 324 untouched, zero
  wire changes, S3 green, ko Recipe-family split 제조법/요리법 verified
  deliberate and correct).
- PHASE 11 VALIDATION RECORD (close): code tip b0d77be779 (the docs close
  commit after it touches docs only). gate_select PASS all 12 steps at the
  tip (GATE_MAX_WORKERS=5, committed tree, no pipe, exit 0). Full suite at
  1da7a4b775: 2828 files pass / 39653 tests green with the ONE bag census
  red admitted in b3c8e64d56; full suite at the pre-fix-round ruling tip
  36e539ebb7: 2827 files / 39619 green, ZERO failures (the two-reds
  closure proof). Parity 215 green at the tip; exactly one pre-existing
  golden moved all phase (nythraxis_full_pull) plus the new
  rift_clear_rewards golden. Portrait seal --check FRESH at pre-flight,
  after the content commits, and at the close (bookkeeping-only drift
  every time; no re-bless owed). tsc clean and biome clean on changed
  files at every commit; asset:budget run once (the failures are the
  long-standing repo-wide overages, recorded above). Commit chain:
  e2e6c5fdd8, 46da023d4d, 5276a985e2, f67ed4a5e4, 6998a77c30, 36e539ebb7
  (the five ruling items), 91870a67ac + ad4f0f1bfb (their reviewed fix
  rounds), 72f4fa16b1, 4a87b16ff0, 3181dbf7bd, 835591eddc (the build
  cadence), ff2249b47a (the referential suite), 1da7a4b775 + b3c8e64d56 +
  cb0132d732 + b0d77be779 (the findings rounds and chain close).
- ROUND-3 VERIFICATION (fresh verifier at cb0132d732): both prescribed
  probes red exactly as specified (the quest-widening mutation that
  survived round 1 now reds the at-most-one sweep naming the double-chip
  ids; a nine-of-ten table removal reds the exactly-ten guard; a stray
  draw above draw 6 reds ONLY the rift_clear_rewards golden while its
  determinism half stays green); the self-diff guard judged structurally
  unkillable by any single edit (every collapse mode is loud against the
  non-empty external literal; the two recorded invisible-but-inert
  residuals are behavior-free at the seam and owned by the equality and
  reached-arm pins); every round-2 corrected claim verified true against
  code and git history (the 211 mislabel reconciled empirically: 212
  runnable parity tests at the build tip, 211 green beside the one
  pre-mint red). ONE nit, fixed in the closing commit with the verifier's
  own wording: the sweep comment's "each cover one id" undercounted the
  bag exemplar loop. The chain closes here for the build session; the
  phase 11 QA's fresh fan-out is the next independent set of eyes.
- QA-CHECKLIST VERDICT (2026-08-16, at cb0132d732 after a delivery nudge):
  READY, zero blocking; 49 test files / 1707 tests green in its own runs;
  monolith ratchet verified untouched across the whole range; the
  reword-staleness and heroic-phantom-variant candidates it raised were
  self-refuted with evidence (do not re-raise: the five overlay refreshes
  ARE the -2 deletions; generatedHeroicDefinitions stayed exactly 64).
  Its two obligations: the market-chip screenshots (already the recorded
  phase 17 deferral) and asset:budget, run at the tip: the failures are
  the LONG-STANDING repo-wide overages (total 423.6 MiB vs 95, textures,
  env, models/*; asset:budget is not a gate step and has no ui/items
  category), and the phase's 28 WebPs total about 36 KB, three orders of
  magnitude under every failing line: recorded, nothing owed here. Its
  reviewer-dispatch list maps onto passes already on record (the
  loot/vendor sim review = the architecture charter; rounds 1-3 probing =
  the coverage charter; the round-3 verifier at the tip = the carve-out
  re-audit). One authored-shape note it surfaced, recorded for the phase
  15 measurement notes: patterns carry no stackSize BY DESIGN
  (RecipeItemDef bars the field at the type level, the phase 02 unstacked
  decision), so duplicate hoarding costs bag slots; phase 15 may weigh
  whether that friction matters at the observed drop rates.
- FINDINGS-ROUND REVIEW (round 2, fresh review + three source probes at
  1da7a4b775; the full suite at that tip: 39653 green with ONE red, the
  bag All-only census, admitted with rationale in b3c8e64d56, the
  run-the-full-suite lesson's third strike this packet): V1 proved the
  reliquary vacuity guard tracks the LIVE table; V2 proved the wire arm
  decisive; V3 SURVIVED: a recipe-or-quest widening of the pattern arm
  passed every market suite (the exactly-one doctrine was pinned
  per-exemplar only), fixed by hardening the live-catalog sweep to
  at-most-one chip per item (the sweep that reds under V3). Also applied:
  the vacuity guard re-cut to diff the ONE derivation walk against itself
  via an includeCarvedOut arm (the second-model-of-a-walk trap); the
  scenario coverage line re-scoped honestly to the A-rank path (draws 2,
  5, 6; the C/B/S-only arms stay outside every golden, a RECORDED
  RESIDUAL for the phase 11 QA to weigh); the channels suite's false
  behavioral-half pointer re-cut to name the parity golden; the search
  pin gained its prefix-word half so its comment is true; the enterRift
  seed-arg comment; the two numeric corrections above (26 vs 16; 66
  golden files). The coverage-text edit re-mints the rift_clear_rewards
  golden text-only (draw stream unchanged, verified by diff).

## Phase 11 ruling executions (2026-08-16, the five items owed at the head)
- (a1) Bag signer exemption, OUTCOME 2026-08-16: kind 'bag' is exempt from
  the #1149 crafting signer mint per ruling (1). The gate is the new exported
  mintsSignerPayload in crafting.ts (isSignableMaterialRarity AND kind not
  'bag'), feeding BOTH the #2350 admission capacity model and the resolve
  grant arm (the craftBonusStatsFor one-exported-gate precedent, so the twins
  cannot drift); the craft_rare deed mark deliberately keeps reading
  isSignableMaterialRarity (the exemption is the MINT, not the rarity
  milestone). The bag's other payload arms were verified structurally closed
  (no stats so craftBonusStatsFor is null; bags are not commission
  eligible). tests/bags.test.ts re-scoped per the ruling with the dated
  OUTCOME note: a unit pin on the gate both ways, a behavioral sweep
  crafting EVERY bag recipe end to end through resolveCraftForRecipe (the
  real records: trainer-taught silkspun_satchel and drop-taught
  sunspun_haversack, learned through their own channels, at their real loom)
  asserting the granted copy carries no instance and no craftedRecipeId AND
  equips, plus a positive control (an epic non-bag output through the same
  resolver still signs, so the plain bag is the exemption firing, not a dead
  signer arm). equipBag's comment premise re-cut to by-construction. Suites:
  bags 48/48, professions_crafting + professions_masterwork +
  gather_rare_events + architecture green, tsc clean, biome clean. With
  (a2) below, the standing reds are CLOSED: the full suite is expected fully
  green for the first time since the third phase 10 QA sync.
- (c) Undispellable flask auras, OUTCOME 2026-08-16: the flask mint
  (items.ts useItem) stamps undispellable BESIDE the flask marker per ruling
  (6) (STK-2): classic consumable buffs carried no dispel type, so offensive
  dispel skips a flask and Spellplunder cannot take one (the steal copies the
  whole aura, marker included, so an unshielded stolen flask would have
  ridden the thief's own singleton/refusal/death rules). Both types.ts doc
  comments recut (undispellable now names its THREE stamp sites; the flask
  marker doc says dispel protection rides the flag, never the marker, so the
  marker's three-rule consumer list stays complete). TWO side effects decided
  deliberately and recorded: (i) per the flag's standing rule a flask is no
  longer right-click cancelable (sim + HUD consistently via the existing und
  wire flag; a cancel carve-out would need the phase 14 flask-marker-on-the-
  wire change, and classic did allow owner-cancel, so this is a small
  recorded fidelity deviation, maintainer may revisit with phase 14); (ii)
  the mob Spellgnaw devour affix reads neither flag and STILL eats a flask
  (the ruling names player counters; affix balance untouched; pinned as the
  recorded exception in tests/mob_purge.test.ts, the pin that flips if the
  ruling is ever widened to mobs). Pins: flask_consumables gained the STK-2
  describe (all three mints carry the flag; dispel/cancel classification
  refuses; elixir AND scroll sources of the same family stay plain, the
  negative control), talent_effect_primitives_v026 gained the real-spellsteal
  arm (flask FIRST in the aura array so the skip decides; the blessing is
  taken instead; a flask-only target yields the thief nothing), mob_purge
  gained the exception pin. Suites: flask_consumables,
  talent_effect_primitives_v026, mob_purge, sickness_undispellable,
  aura_classify, resurrection, architecture all green (138/138); parity gate
  green at the commit; tsc + biome clean.
- (b) Lucent weapon int twin, OUTCOME 2026-08-16: enchant_weapon_lucent_
  spellpower shipped per ruling (5) (D10-D1): int 7, mainhand, skillReq 100,
  bill byte-identical to Lucent Might (lucent_reagent 1 + arcane_shard 1 +
  arcane_essence 2), name 'Enchant Weapon - Lucent Spellpower' continuing the
  Greater Spellpower naming line. i18n: hudChrome.enchantName row + five
  non-Latin fills composed from each locale's established Lucent + Spellpower
  vocabulary; guide enchantsNoteOffhand recut 'the three' to 'the four' with
  the weapon slot naming both options, and the five FILLED non-Latin overlay
  rows hand-refreshed in the same change (the reword-staleness rule).
  i18n:gen + wiki:content regenerated. Pins moved: enchants_magnitude_
  invariants int 24 -> 26 with the axis comment recut (spi and armor are now
  the untouched pair), apex list + skillReq literals + frozen-magnitudes
  table gained the id; guide.test.ts Lucent list 4 -> 5 ids;
  masterwrought_budget gained the mirrored int-ladder arm (2/3/5 -> 7 on the
  same +2 step, bill equality pinned). No aura/marker/naming-registry
  obligations: the composed name mints no new proper noun (the phase 10
  scheme-wide record covers it; GW2 Lucent evidence already recorded).
  Suites: enchants_magnitude_invariants, enchant_apply_view,
  masterwrought_budget, professions_enchanting, guide, i18n_completeness,
  localization_fixes all green; tsc + biome clean.
- (a2) Rogue band re-pin, OUTCOME 2026-08-16: tests/rogue_dps_balance.test.ts
  re-pinned to the merged-tree loadout per ruling (1). Assassination re-bands
  180..195 to 165..180 around the measured 170.383; the sibling-ordering
  claim restates to Combat strictly first with Subtlety marginally over
  Assassination (171.022 vs 170.383). MECHANISM AMENDMENT (2026-08-16, from
  the fresh review's measured A/B, superseding the sync record's
  "rating-heavy shape out-scores" phrasing ON MECHANISM only): the picker's
  score() sums only item.stats and cannot see hit/crit/haste ratings at all;
  the apex jewelry wins on an int-led raw stat bag (neck int 8 + sta 6 = 14
  over the displaced medallion's 12) that a class-blind sum credits while
  int buys a rogue no throughput (rogue AP is str + agi), which is also why
  the fight measures lower: the fixture wears two pieces no played rogue
  would equip (still the score-vs-fight Lionheart/Lariat class the sync
  record flagged; the outcome stands, the mechanism is corrected). The
  pre-apex baseline for phase 15: with the masterwrought defs removed the
  picker restores the release loadout and measures about 186.3 / 202.8 /
  179.2, matching the release bands, so the suite's bounds protect the
  DEV-BIS FIXTURE's throughput, not a played rogue's. Combat and Subtlety
  bands unchanged (199.367 and 171.022 sit inside them; Subtlety's floor
  now sits a deliberate, disclosed 1.0 under the measurement, the tightest
  tripwire in the suite). The fix round added identity pins (neck =
  wyrmfall_pendant, ring2 = prismglass_loop, 12 filled slots per spec: the
  bands are conditioned on that loadout, and ring2 is a three-way score-13
  tie broken by the picker's id sort, now a tested fact) and a near-tie
  band (|subtlety - assassination| <= 5) beside the strict tie-sentinel
  pair. Suite green 2/2; the dated OUTCOME note lives in the test comment.
- (d) Naming registry rows, OUTCOME 2026-08-16: the four aura display names
  (Ironhusk Vigor, Warboar Might, Runewater Clarity, Well Fed) registered
  GENERIC-with-caveat per ruling (9), appended to naming-audit.md's MINTED
  AT PHASE 10 block as a display-name group; Well Fed's caveat records that
  it is WoW's verbatim same-role food-buff name, kept deliberately as a
  plain-English state description; the other three compound packet-registered
  coins with generic stat words (Might carried by three appendix GENERIC
  rows; Vigor and Clarity generic stat vocabulary with no appendix row, as
  the registry rows themselves say).
  The live Naming registry block above gained the mirror line, and the
  shipped elixir aura names remain unregistered (the recorded pre-existing
  half of the gap, closed only for the packet's own rows).
- (e) Phase-15 kit premise, OUTCOME 2026-08-16: the feast is dropped from the
  R5 full-kit premise per ruling (4) of the phase 10 QA (the party
  field-crafting stations are ratified as crafting stations; there is no feast
  buff source to measure). Corrected in BOTH live copies:
  phase-15-power-verification.md (the Goal line and Arm 1) and
  implementation-plan.md's Phase 15 deliverable. The phase-10-era mentions
  (phase-10-apex-consumables.md, phase-10-qa.md, implementation-plan.md's
  phase 10 section) are historical records of the spec's original flavor,
  whose resolution into stations is already recorded in the Phase 10 ledger,
  and deliberately stand. R5's own wording in this file never listed a feast.
- RULING REVIEW RECORD (2026-08-16): each of the six ruling commits got its
  own FRESH review (five reviewers: sim-seams over a1 and c, pin-quality
  over a2, content-obligations over b, a docs reviewer over d+e; the three
  typed reviewer agents returned empty reports twice, a known harness
  failure class, and were re-run as general-purpose agents with the charter
  inlined), plus a six-probe mutation pass in the isolated worktree
  wocc-mw11-probe at the exact tip 36e539ebb7: 6/6 mutations caught, every
  new pin decisive (the resolve-arm bypass probe proved the bags behavioral
  sweep covers the grant arm independently of the unit pin). ZERO blocking
  findings anywhere. All findings applied in one reviewed fix round:
  the rogue mechanism amendment + identity pins + tie band + disclosures
  (above); the two fixture-self-supply pins re-sourced from GENUINE mints
  (the spellsteal arm quaffs the real flask and seeds the enemy with the
  captured aura; the mob-purge exception pin quaffs instead of hand-building
  the literal); the flask tooltip gained its counter-immunity line
  (itemUi.tooltip.flaskUnremovable, five non-Latin fills, the four-rule
  tooltip pins re-cut) and the alchemy guide prose its matching clause with
  its five non-Latin rows refreshed in-change; the types.ts undispellable
  doc scopes "purge" to player-driven counters and names the Spellgnaw
  exception; a real-command-path cancel arm (Sim.cancelAura no-ops on a
  flask, removes the elixir control); the (d) OUTCOME above and the registry
  mirror line; the Laden Hearth registry annotation re-cut to the ratified
  station role; the naming-audit apex-enchant record extended to the fourth
  composed name and the Well Fed caveat's unanchored class citation
  reworded; stale four-Lucent count comments re-cut and the twin's
  gain-tier literal added; the bags copper-grant comment made honest and
  the bag+legendary gate arm pinned. FULL SUITE at the pre-fix-round tip
  36e539ebb7: 2827 files / 39619 passed, ZERO failures (2 expected fails,
  115 skips): the first fully green full run since the third phase 10 QA
  sync, closing the two-reds acceptance item. The fix round was itself
  reviewed FRESH and probed (4/4 mutations caught, the carve-out-lane probe
  proving the new command-path cancel arm covers exactly the classifier
  pin's blind spot): zero blocking; three comment-truth residuals applied
  in the follow-up commit: the spellsteal arm-1 comment had repeated a
  pre-existing FALSE walk-order clause (the dispel executor walks the aura
  array from the END, so the unshifted flask was examined last and arm 1
  never consulted the stamp; the flask is now seated LAST so the end-first
  walk examines it first and the skip genuinely decides, making BOTH arms
  stamp-guarding), the Spellpower shipped-name count corrected to three,
  and the (d) entry's appendix-GENERIC claim narrowed to Might (Vigor and
  Clarity are generic vocabulary without appendix rows); the pre-apex
  baseline triple gained its explicit spec order.

## Phase 11 QA release sync (2026-08-19, merge 210ec2f7d1 + fix 33008fa7ac; the QA fan-out re-runs the phase-11-qa prompt in a FRESH session)

- THE SYNC. Discovery found a NEW release line: origin/release/v0.40.0 (tip
  e56707a675, 369 commits, containing the whole v0.39.0 close: its full locale
  fill, the warlock Fate Threads rework with ONLINE_WORLD_LAYOUT_VERSION 7 and
  the incapacitate breakThreshold budget, the druid cast-commit auto unshift,
  the ogre body replacement with a full portrait receipt re-mint, the castle
  walk-in dungeons the_last_keep + dawnhold_castle with the dawnhold_posy
  keepsake and two ART-PENDING deeds, sky KTX2, the 58-icon spell-art revert
  with a byte freeze suite, CI browser-deps hardening). Merged as 210ec2f7d1
  with 371 conflicts: 241 portrait webps, 67 parity goldens, 23 resolved-i18n
  slices, and 40 hand files. No stop-rule file was rewritten (loot_roll.ts,
  rift/progression.ts, heroic_vendor.ts, market_query.ts all untouched by the
  delta; the one rift change is authored.ts parkour ledges, zero rng).
- UNION DECISIONS (the deliberate ones). Both-sides-appended tables keep the
  RELEASE's entries AHEAD of the branch's so the eventual release merge stays a
  pure tail append: deeds.ts (castle pair before the six craft milestones;
  DEED_ORDER 279, renown 3235, FROZEN sha re-minted ea007571ae35 from suite
  output; tail stays prog_grandmaster_inscription) and the items catalog
  (dawnhold_posy before the masterwrought block in ITEM_ENTITY_IDS and
  APPENDED_ITEM_NAMES; mapping.json 108 entries / 18 batches). hud.ts keeps
  SUNDER_CAST_ID and DROPS SUNDER_ARMOR_PCT_PER_STACK (the release's
  ability_description.ts extraction took its only consumer); the ratchet
  re-pins at the exact merged 19337 (below BOTH parents: the two deletions
  compose). effect_dispatch.ts takes the release's fear logic
  (breakChanceScale gated on warlockBreakThreshold === undefined, plus
  breakThreshold) under a union comment keeping the branch's Drakesting
  rename; ancestor_return takes the release's reworded mechanic text with the
  branch's (Spiritcall) tag, in classes.ts AND the abilities catalog
  identically (S3 parity). The seven conflicted overlays keep the branch's
  Dreadspark renders over the fill's Terrorspark transliterations and TAKE the
  release's new the_last_keep.enterText rows plus its supersessions (it_IT
  ossuary_mark 15 sec; tr_TR ossuary 15 sn, scale-free ferocious_bite,
  funeral_harvest), each verified against the live English first. All three
  naming guards GREEN over the fill (second clean fill sync; no reintroduced
  coins).
- COUNT PINS: verified from suite output, NO composition this sync (the
  release touched neither surface): IWorld 324 = 86/238, commands 200/213.
- RE-MINTS from the merged tree: 67 conflicted goldens plus the branch's own
  rift_clear_rewards via UPDATE_PARITY (its movement is entity-id numbering
  only, draws 0 unchanged, zero rng movement; the release added four world
  entities); i18n:gen + wiki:content (270 guide deeds = 279 minus 9 hidden);
  eastbrook seals via remint_polish_provenance.mjs (composite 5f52543636,
  metadata 09b79915db27, second-order 0ed10cc2b249); the item-art verdict via
  item_art_audit.mjs --refresh-verdict at the merged 907 art / 922 defs
  (expected counts advanced in the script; the refresh REFUSES on a moved
  shipping catalog until the posy's owner-reviewed admission is hand-advanced
  into evidence.shippingCatalogSha256, the conscious-admission gate working as
  designed; verdict sha c7fa0e80c134 at 122036 bytes propagated to
  accepted-art.json and both test pins; summary sentence unions the release's
  posy clause into the branch's admission chain at "All 907"); the FULL
  233-portrait receipt rerender (bytes CONVERGED with the release's CI
  encodes this time, no ping-pong: target_portrait_view + vale-cup evidence
  resolved to THEIRS; grix + tunnel_rat + the three target-dummy portraits
  minted fresh; determinism proven by a byte-identical 3-portrait sample
  rerender; manifest re-minted via the receipt flow, sha d0614b9c96e1 at
  268566 bytes, a merged-tree mint matching NEITHER parent since the branch
  content moves the bundle fingerprint, hand-advanced into the placeholder
  accepted-art trio).
- FIRED TRIPWIRE, R12 held-offhand disenchant (the conscious re-decision):
  the release WIDENED isDisenchantable (and isSalvageable) to kind
  'held_offhand' ("a copy the player's class cannot wield is never stuck with
  no way to recover value"), which redded the phase 09 pin built to force
  exactly this re-decision. ADOPTED the upstream family rule: the pin flips to
  true with the rationale re-cut. Faucet consequence for phases 12/15: every
  epic held offhand (gyrelens_array, voidbound_grimoire, wraithfire_orb and
  its heroic variants) now disenchants to the standard arcane_shard with NO
  typed secondary (the jewelry shape), a marginal widening of the shard
  faucet the phase 04 ledger sized 1:1 against the heroic faucet.
  Sunderability is UNTOUCHED (isSunderable + itemFromRaid have zero delta;
  the phase 12 heroic-raid sunderable flip premise stands as written).
- FULL SUITE at the merge tip: 2877 files / 40099 passed, TWO reds, both
  known merge-induced infra classes, closed in fix 33008fa7ac: (1) the
  shard-weight union coverage fell to 94.57 percent (the phase-13
  marketplace class exactly); 155 newly uncovered non-browser files measured
  locally (42s run, default reporter) and merged into
  ci_shard_weights.generated.json via parseWeightLines, every CI-harvested
  weight untouched, provenance noting the local merge, table 2876 rows,
  partition suite green; (2) the release's NEW sealed icon-art census
  (release_v039_icon_art) pinned 72 hotbar items while the branch's three
  role foods join the live isHotbarItemId inventory with painted art: the
  sealed record and its sha pin advance to 75/75 (the nythraxis_hitch
  literal-pin class: a release live-derivation pin no branch content can
  survive).
- MERGE AUDIT (release-merge-audit skill as a 7-agent workflow: six lanes +
  completeness critic; all reports in the session transcript). Lanes 1-5
  CLEAN with mechanical proof (25 of 28 sim-cluster files byte-identical to
  a fresh three-way re-merge; presentation cluster verified against the
  merge-tree recompute; injected seams all live: extract_essence dispatch,
  item_copy_ref bindings, craftBonusStatsFor twins, resetForArena seats,
  masterwrought cap arms, mintsSignerPayload, the carve-out; no
  corpus-invisible route; db-mock trap EMPTY; duplicate_test_blocks green;
  ci_workflow sparse cones still cover the masterwrought screenshot trees).
  Lane 6 found 2 SHOULD-FIX + 1 NOTE, all applied: (a) the ruling (c)
  amendment below (fourth undispellable stamp site), (b) THIS ledger records
  the fired R12 tripwire, (c) phase-11-qa.md's draw-order premise scoped to
  the sync merge (the release itself edited four finale copper rows:
  heroicCopper on Morthen/Vael/Korzul/Nythraxis, Korzul base 50000 to 15000,
  draw-count-neutral value swaps; release-owned, outside the append proof).
  The critic closed four coverage gaps GREEN itself (parity replay 155/155
  over the hybrid goldens; 17 between-lane suites 252 passed; the binary art
  theirs-resolution consistency; the docs cluster incl. master-spec agreeing
  with the copper retune) leaving ONE residual, the i18n resolved-bundle
  freshness, which the gate's i18n freshness step then proved.
- RULING (c) AMENDMENT (dated 2026-08-19): v0.40.0 added a FOURTH
  undispellable stamp site, the warlock Fate Threads self-aura
  (src/sim/combat/affliction.ts), so the phase 11 entry (c) claim "types.ts
  doc comments recut (undispellable now names its THREE stamp sites)" is
  superseded: the types.ts comment now names four (recut in 33008fa7ac).
  Flag semantics unchanged; flask/Spellgnaw/spellsteal pins all green.
- RELEASE-OWNED, recorded not fixed: the castle deed pair ships art-pending
  by upstream design (DEED_ART_PENDING, category-crest fallback,
  docs/design/deeds.md sanctions it; icon-brief flags the commission); the 13
  Latin-overlay reins_terrorspark rows the branch stripped at phase 03 now
  fall back to the English Dreadspark name (M16-consistent, release fill
  channel); the ossuary_mark/possess-family reword staleness in the 13
  non-conflicted Latin overlays is inherited fill debt, not merge damage
  (lane 2's note).
- VALIDATION RECORD: tsc clean at every step; naming guards 26/26; S3 +
  channel + count-pin suites 458 green; deed/ratchet cluster 181 green;
  item-art pair 13 green; eastbrook 29 green; portrait quartet 33 green;
  full suite 2877 files at the merge tip (the two closed reds above);
  gate_select PASS all 12 steps at the committed fix tip 33008fa7ac via the
  full-suite fallback (2879 files / 40101 passed, ZERO failures, browser
  131 green, typecheck and all builds green). Portrait manifest --check
  fresh at the tip. Branch stays LOCAL, never pushed.

## Phase 11 QA release sync, second pass (2026-08-20, merge fba8f47ee9; the same QA session continues into the fan-out)

- THE SYNC: origin/release/v0.40.0 moved again after the 2026-08-19 pass
  (182 commits: the GPU adaptive scheduler PR 3519 and the controller
  cross-hotbar redesign PR 3501; render/game/ui perf work only). Merged as
  fba8f47ee9 with 12 conflicts, all in the recorded provenance classes.
  The only sim file in the delta is data.ts (an additive
  isBuiltinWorldActive read for the release's zone-build workers; zero
  callers in sim/server/headless, determinism-neutral). No stop-rule file
  touched: loot_roll.ts, rift/progression.ts, heroic_vendor.ts, and
  market_query.ts are all absent from the delta, so the draw-order
  baseline moves to fba8f47ee9 as a pure relabel.
- RESOLUTIONS: eastbrook polish seals re-minted from the merged tree via
  remint_polish_provenance.mjs (three literals re-pinned, no capture
  retaken); shard weights unioned (the release's fresher 2026-08-18 CI
  harvest, 2830 rows, plus 49 branch-only rows carried from the 2026-08-19
  local measurement, recorded in the provenance localMerge note);
  pending.ts taken-and-regenerated via i18n:gen; hud.ts import hand-union
  (the release's tSim in; localizeSimAuraName dropped because its only
  hud.ts usage was extracted to entity_display_core on the branch);
  pr_shot_targets.mjs keeps BOTH shot targets with the release's
  cross-hotbar entry AHEAD of the branch's phase 10 target (the union
  doctrine); the branch's stealth comment rename re-applied into the
  release's new effect_materials.ts home (Smokefade); the hud.ts ratchet
  re-pinned at the exact merged 19445, a MERGE-TIME hand re-pin sitting
  between the parents (branch 19337; release 19490 for its cross-hotbar
  thin-consumer wiring), while the renderer and main.ts ceilings in the
  merged row set are the release's own.
- VALIDATION AT THE MERGE TIP: tsc clean; the three naming guards 26/26
  (the release touched five non-Latin overlays); portrait manifest --check
  fresh (bookkeeping-only renderer-bundle drift, the tolerated class); the
  portrait suite set green (8 files / 65 tests, covering the release's
  rewritten capture lane); pnpm reinstall done for the release's three
  patch-hash bumps. gate_select at the QA tip remains the freshness proof
  for the merged generated artifacts and is owed by the fan-out's own
  validation close.
- SIX-AGENT MERGE AUDIT (five lanes plus completeness critic): ZERO
  blocking. Every overlap file carries both sides' intent (the branch's
  tome grips and Wintergnaw/Vandric/Frostglobe/Flitstep/Smokefade renames,
  the masterwrought CSS blocks and hud_chrome keys, mintsSignerPayload and
  the carve-out seams all verified at HEAD); the release's worker rename
  (terrain_chunk_worker to zone_build_worker, terrain_chunk_pool deleted)
  left zero dangling references; legacy arms, inventory rows, and stale
  db-mock export lists are vacuously clean (zero server/net/headless files
  in the delta). Guard-suite lane green across nine invocations
  (architecture 44, hud_update_drive 16, monolith 13, eastbrook 29,
  GLB/preload 30 plus 2 design-gated skips, shot targets 33, icon suites
  41 plus release_v039_icon_art 5 with the 75/75 hotbar census,
  hud_perf_budget 119 plus 4 env-gated skips). NO Phase 11 premise is
  invalidated: the audit proved surface by surface that the delta contains
  none of the phase's loot, rift, vendor, market, pattern, sundering, or
  reliquary files.
- CARRY (fix-round item for this QA): the two sim_i18n.ts deploy-window
  alias rows (the Winterbite aura alias and the Deacon Varric delve-line
  regex) carry a stale "drop after v0.36.0 ships" horizon comment. The
  rows themselves stay LIVE: the window they protect is the deploy of the
  masterwrought branch's own renames, which has not happened, so the fix
  is recutting the comment to name the branch's release, never dropping
  the rows (the critic's drop suggestion is REFUTED on this analysis).

## Phase 11 QA pre-flight (2026-08-20, the fan-out session)
- Release sync verified a NO-OP: after a fresh fetch the newest release
  line is still origin/release/v0.40.0 at 65b91fa190, exactly the commit
  merge fba8f47ee9 already brought in; zero incoming from v0.40.0 and
  v0.39.0 both, so no merge and no release-merge-audit are owed. Branch
  tip e78c7dda90, tree clean; the Phase 11 code tip b0d77be779 and docs
  tip bbeff457a5 are both ancestors.
- Portrait manifest --check fresh (the tolerated bookkeeping-only
  renderer bundle drift class; everything else byte-identical to the
  committed acceptance). gate_select at this tip stays owed to this
  session's fan-out, per the second-pass sync record.

## Phase 11 QA ledger (2026-08-20, verdict PASS-WITH-FOLLOWUPS; tip 2544d3e16a)
- FAN-OUT: one eleven-agent ultracode workflow (draw-order adversarial,
  reachability, market, cleanup, plus architecture / cross-platform /
  frontend-seam / content-obligations / test-coverage reviewers dispatched
  as general-purpose agents with inlined charters per the recorded
  harness lesson; a mutation-probe lane in the isolated wocc-mw11-probe
  worktree re-detached to the QA tip; a completeness critic over every
  report). ZERO blocking findings anywhere. Six should-fix, nine nits,
  and a body of notes; ALL applied or recorded, nothing filtered.
  privacy-security-review SKIPPED with rationale: zero server/ files in
  d149382bc4..b0d77be779 (verified empty diff), no new commands, no SQL,
  no auth surface; the critic judged the skip SOUND with substitute
  evidence (the shared-sim wire-input surface, sanitizeMarketQuery over
  untrusted itemType, and the vendor-buy authority ordering were examined
  by the cross-platform and cleanup lanes).
- FINDINGS ROUND (each commit reviewed fresh, new pins probed isolated):
  2aef4a97f4 scopes the Preferred Customer deed desc to the gear stock
  with ALL 18 deed_i18n locale descs refreshed in-change (no pending debt
  minted); 027fba8446 adds the phase-11 art README accepted sha256 record
  the CREDITS row claimed; 8eb65fa33f trues the deploy-window horizons
  (the recorded carry: both sim_i18n alias rows now name the branch
  release, rows LIVE), the dungeons append-contract heroic-claim
  qualifier, and the heroic_vendor item-level phrasing; 3e5ffda3e1 puts
  the pattern no-pages supersession pointer at the stale ledger sentence
  and records the recipe-pattern exclusion in docs/design/reliquary.md
  beside its rift-gear precedent; 15ee96018f hardens the pins (five new
  no-fourth-channel sweeps: fishing, letters, ground objects, delve cache
  draws, rift personal loot; exact deterministic rift-rate counts
  401/400/405 closing the call-site-literal window the band left; the
  drop-recipe skill-cap guard; the end-to-end extractEssence pattern
  refusal; market wire-sanitize, list-drive, corner-resolver, and
  label-distinctness pins; the VACUOUS header and spellsteal seat trued);
  3b52e51cd1 closes the fresh review round (craft-result and starter-kit
  sweeps, da/sv/id locale prepositions, comment reflow).
- REVIEW CHAIN: fix-round reviewer FRESH (zero blocking; one should-fix
  and five nits, all applied in 3b52e51cd1; all 28 art hashes verified
  byte for byte; all 18 locale renderings judged competent); round-2
  verifier reported NOTHING FALSE and probed both new sweeps red (R1
  craft-result, R2 starter kit). Probe record this QA: fan-out 12/12
  caught (tail pin, raid chance, vendor price, vendor grant count,
  channel exactness, prose+behavior draw-6 pair, sundering clause, market
  arm deletion, tradability by absence, wiki generator freshness,
  statistical band, plus fixture-self-supply audit), fix round 9/9 caught
  (exact-count window, skill cap, fishing plant, delve-cache plant, label
  fall-through, sundering predicate AND drive proven independently, rift
  list unsort, flask stamp removal with seven failing titles across four
  suites). Zero survivors across the whole phase.
- SYNC-DEBT CLOSED AT THE TIP (2544d3e16a), surfaced by the owed gate
  exactly as designed: the inscription tome source fingerprint includes
  pnpm-lock.yaml and the second sync's three patch-hash bumps moved it
  without a re-stamp (size-preserving remint moved EXACTLY the three tome
  GLBs, every other fingerprinted family current, so
  remint_polish_provenance was not owed; test literals and media manifest
  follow); the shard-weight union carried 49 branch rows without
  advancing __provenance.files (now the merged 2879 with the arithmetic
  in the localMerge note; the ci_shard_partition pin is the guard and is
  green, the change records truth and fails toward accuracy).
- DECISIONS taken this QA: (1) the C/B/S rift-arm golden residual is
  RECORD-AND-ACCEPT, with the feasibility record preserved so the
  maintainer can overturn cheaply: closing it is a PLAIN ADDITION (a rank
  parameter on the riftClearRewards factory, three SCENARIOS appends at
  baseLevel 20/22/28, one coverage arm and an UPDATE_PARITY mint each,
  roughly half a day; seed hunting only for the B/S in-window picks,
  about 1 in 12 seeds), NOT a restructuring, so the stopping rule did not
  fire; what goldens would add over the 5000-seed behavior arms is
  stream-position coverage of rank-local insertions. The NEWLY
  characterized sibling residual joins the same entry: heroic-claim
  Nythraxis kills roll their HEROIC_BOSS_LOOT draws one position later
  behind the appended base group (benign, distribution-identical,
  inherent to any base-table append, the maul precedent had it too, and
  no golden covers the heroic Nythraxis path); the dungeons.ts comment
  now says so. (2) The flask tooltip wording stays: dispelled, stolen,
  and canceled by hand are player-counter verbs, classic-idiom consumable
  tooltips do not enumerate mob-affix interactions, so the pinned
  Spellgnaw devour exception stays out of the tooltip copy. (3) The
  privacy-security skip rationale is restated with substitute evidence
  (above).
- AUDIT VERDICTS recorded, no action: the early skillReq obligation
  DISSOLVED (patterns carry no skillReq field; the learn flow gates on
  the recipes, all 28 on tier boundaries 100/125, both reachable; the
  new skill-cap guard pins the zero-margin capstone boundary);
  reachability semantics are archetype-major by settled design; the
  ALL_RECIPES content-vs-data.ts duality is inert for the learn path;
  market search matches English names and ids only (pre-existing,
  catalog-wide); the committed mediawiki seed carries zero pattern pages
  (the recorded stale-on-record deferral; kind wording landed at the
  generator); marketItemTypeLabel had no exhaustiveness guard, closed by
  the new distinctness sweep; sv_SE kvartersmastarens spelling is
  pre-existing fill debt for the locale owner; the guide vendor-mirror
  shared-expression note is filed at low weight (the four literal
  per-arm exemplars and the probe-proven freshness arm carry it).
- VALIDATION RECORD (close): suite list at 3b52e51cd1: 47 files passed,
  1 design-skip, 1400 tests green. Full suite at 2544d3e16a: 2972 files,
  41270 passed, 2 expected fail, 115 skipped, ZERO failures.
  gate_select PASS all 12 steps at 2544d3e16a (GATE_MAX_WORKERS=5,
  committed tree, no pipe, exit 0; the vitest step ran the full-suite
  fallback, so the tip carries TWO full-suite proofs, plus browser 131,
  tsc, and all builds inside the gate). Portrait seal fresh at
  pre-flight (tolerated bundle-only drift). Tree clean at every commit.
- RULINGS WANTED (maintainer, non-blocking): (a) OPTIONAL overturn of
  the residual acceptance: three rank scenarios plus optionally a
  heroic-claim golden, roughly half a day, feasibility recorded above;
  (b) the standing flask owner-cancel classic deviation remains posted
  for review with phase 14's wire marker (unchanged from the build).
  BOTH ANSWERED 2026-08-20 under the full delegation; the record is
  "Decisions closed 2026-08-20 (the full delegation)", MOVED at the 11b doc
  move into docs/prd/masterwrought/farming/state.md (the handoff-table
  section). (a) is OVERTURNED (state-OPEN-RIFT): take the overturn and close
  the residual BEFORE 11f, or as 11f's own first commit, because 11f
  appends a draw after draw 6 in the rift reward stream and a rollGroup at
  the nythraxis_boss_arena tail, which is exactly the rank-local insertion
  the missing C/B/S goldens would cover; the sibling heroic-claim
  Nythraxis residual closes with it. (b) is KEEP AS SHIPPED
  (state-OPEN-FLASK), recorded CLOSED-keep so it stops sitting in the open
  list; phase 14's flask_<kind> shared-glyph note proceeds on its own
  merits and does not reopen the cancel semantics.
- PHASE 12 CARRIES: unchanged from the Phase 11 BUILT ledger (the
  rolled.quality successor ruling, promotion re-validation, the
  heroic-raid sunderable flip premise, the reliquary pin trio, the
  masterwork head-start wiring with the suppressed-proc credit decision,
  movement:true on the re-mint arm, the Infusion slot/stat, the
  masterwork guide prose apex clause). This QA adds NOTHING new owed to
  phase 12.

## The professions completion program (phases 11b to 11k, recorded 2026-08-20)
- WHY THE PROGRAM EXISTS: the maintainer pulled the COMPLETED farming
  packet (origin/feature/farming-plan, 14 phases, decisions D1 to D24,
  docs now at docs/prd/masterwrought/farming/) into this one, and then
  widened the goal past the absorb itself: professions must be
  INCREDIBLE, every gathering skill must feed the craft economy, and
  every skill must have real content at ALL levels. The four absorb
  phases as first planned (11b to 11e) only merged the two trees and gave
  farming an endgame arm. The census below finds the same gap in
  fishing, in logging, and across the 75-plus band of the whole catalog,
  so 11e is re-cut and the program runs to 11k. 11b, 11c and 11d stand as authored;
  phases 12 to 17 keep their numbers, their titles, and every forward
  carry; the delivery contract is unchanged, ONE branch and ONE PR, and
  an item is in the packet or explicitly CUT.
- THE MEASURED GAPS (the maintainer's own investigation, 2026-08-20;
  these numbers are the authoring basis for every phase below, and are
  not to be re-derived or contradicted):
  - The whole cooking tree uses 17 distinct reagents and NOT ONE is a
    vegetable or a grain. Farming's entire output is produce, so the
    fifth gathering profession ships with no buyer at all.
  - All 14 farming recipes are acquisition ['trainer'] and zero are
    drop; masterwrought alone adds 28 acquisition ['drop'] recipes.
    Farming's ladder tops out at skillReq 50 (4 rows at 0, 3 at 25, 7 at
    50) with nothing at 75, 100 or 125.
  - Recipes by skillReq across the whole game: 32 at 0, 28 at 25, 23 at
    50, 17 at 75, 26 at 100, 3 at 125, 3 at 150. The top of the catalog
    is thin everywhere, not only in farming.
  - Endgame bills (skillReq >= 75) per gathering profession: mining 21,
    herbalism 15, skinning 11, logging 6, FISHING 1, and that single
    fishing row is recipe_tidewrought_fishing_rod, so fishing feeds only
    itself. (AMENDED 2026-08-20, quality-review adoption row 130: the
    fishing count measures 2 on this tree, recipe_stormreel_fishing_rod
    at engineering 75 also consumes glimmerfin_koi; BOTH rows are fishing
    rods, so the conclusion stands unchanged. Mining measures 20 under
    the node-family derivation; the census family definitions are pinned
    by 11j Agent 1's derivation, which is the authority at test time.)
  - recipe_sageleaf_chowder is a CHOWDER whose reagents are
    seasoned_stock, prime_cut, game_meat, sunpetal_herb and cooking_salt.
    There is no fish in it.
  - The apex gathering-tool family is engineering-crafted:
    arcanite_mining_pick 150, elderwood_axe 150, sunpetal_sickle 150,
    tidewrought_fishing_rod 125. Farming's ladder ends at osmium_hoe at
    engineering skillReq 75, the family's only hole.
  - Fishing: maxSkill 200 with FISHING_GAIN_SCHEDULE bands at
    50/100/150/200; six raw fish exist (raw_mirror_trout,
    raw_river_perch, raw_marsh_pike, raw_bog_eel, raw_frostgill_trout,
    raw_stonescale_carp) across THREE catch bands, and rod tier 3 already
    reaches the last band. Fishing 200 grants prog_master_angler (the
    Master Angler title and 25 renown), and that is the entire reward for
    150 points of grind.
  - FARMING_GAIN_SCHEDULE is 1 / 0.5 / 0.1 / 0.02 by band and is marked
    in source as "TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER".
  - Farm crop skill gates are DERIVED from tier through the shared
    25-point band math, under an explicit invariant that a crop can never
    disagree with the profession's ladder. A crop gated at an arbitrary
    skill such as 90 is NOT available; re-tiering is a ladder decision,
    never a per-crop one.
  - Farming's 8 crops: T1 vale_wheat, brook_carrot; T2 marsh_rice,
    bog_beet; T3 highland_barley, frost_gourd; T4 gilded_sunmelon,
    evergarden_greens, each with a fine_ twin. The two tier-4 fine twins
    currently have NO consumer.
  - The three role plates (stonepot_stew buff_sta, warspice_skewers
    buff_ap, sageleaf_chowder buff_int) carry byte-identical bills today
    and NO test pins them identical, so they may be differentiated.
- THE PHASES (titles as minted at authoring; if a later re-cut moves a
  title the phase file is the authority and the goal here is what the row
  promises):
  - 11b THE FARMING ABSORB: merge feature/farming-plan in whole (160
    conflicted files, the docs move, farming's item rows ported onto
    masterwrought's ItemDef discriminated union).
  - 11c FOOD AND FEAST RECONCILIATION: settle the one genuine design
    collision, Well Fed and the two feast objects, so the merged tree
    carries one ladder and two non-substitutable feasts.
  - 11d DERIVED ARTIFACTS, PINS, AND THE MERGE AUDIT: re-derive every
    self-minting artifact (goldens, generated files, count pins, monolith
    ceilings) predicted-then-observed, plus the export and symbol census
    that can actually detect a bad resolution.
  - 11e A TRUE SKILL, FARMING'S MASTERY CURVE AND CROP ROSTER: settle
    FARMING_GAIN_SCHEDULE against the measured calendar-days-to-100 model
    that R19 requires; grow the roster from two crops per tier to
    2 / 2 / 4 / 4; reconcile the tool effects; and discharge GATE 1 (the
    D11/(bo) tier 3 and 4 seed faucet). GATE 1's answer is SETTLED
    (11b-D-1, state-GATE-7): vendor-stock the seeds at farmer_hollis in
    Highwatch and farmer_verbena in Evergarden, at buyValue 32 for tier 3
    and 64 for tier 4 (11e-D-D), which un-dorms highwatch_barley_porridge,
    evergarden_braised_greens and recipe_harvest_feast plus both parked
    deeds at once. It is EIGHT rows once 11e-D-B grows the roster, not
    four. GATE 1 is discharged HERE and nowhere else: exactly one
    bootstrap, and every downstream phase proves it by reading the merged
    vendorItems arrays in code.
  - 11f FARMING JOINS THE DROP ECONOMY: pattern items on the shipped
    Phase 02 machinery, the channel flip that moves the top rungs from
    acquisition ['trainer'] to ['drop'] while the low rungs stay
    trainer-taught, append-only loot placement across raid, dungeon and
    rift, the Heroic Quartermaster valve so nothing fossilizes, and the
    rung climb that adds the missing 75 / 100 / 125 rows.
  - 11g THE PROVISIONING SUPPLY LINE, LEVELING TIER: put grain and
    vegetables into cooking and alchemy bills at rungs 0 to 50, closing
    the bottom of the 17-reagent hole, with R17's scope as the fence and
    R18's add-never-substitute rule pinned.
  - 11h THE PROVISIONING SUPPLY LINE, APEX TIER: the same supply line at
    rungs 75 to 150, the first consumers for the two tier-4 fine twins,
    and the differentiation of the three byte-identical role plates.
    recipe_quickening_catalyst stays untouched on purpose and the ledger
    says why. AMENDED 2026-08-20 (11h-GATE-E): the apex feasts are NOT
    minted here. 11h mints ZERO new item ids; it authors the apex feast
    bills' reagent lines and 11k mints the feasts themselves at cooking
    125, because 11k owns every keyed site a placeable feast touches.
  - 11i THE ANGLER'S ENDGAME: make fishing feed something other than its
    own rod (the catch bands, the six raw fish, the rod ladder, and a
    reward at 200 that is more than a title).
  - 11j THE GATHERING COMPLETION PASS: land the R20 guard test, run the
    band audit and fill what it finds, raise the two thin gathering arms
    (logging and skinning) into the endgame band, and close the apex tool
    family's one hole with farming's apex hoe.
  - 11k THE PROVISIONING CAPSTONE AND PRESTIGE: the three apex Harvest
    Feasts serving the shipped role plates through feast.dishItemId, the
    craft-signing prestige that needs no new machinery, the one
    cross-packet deed, the wiki page, and the program's closing
    whole-catalog obligation sweep.
- THE FOUR NEW RULINGS, and what each one FORBIDS (full text in the
  locked-rulings section above; cite them by number):
  - R17 THE PROVISIONER RULE forbids farm produce in the gear chain, in
    the Perfecting materials, and in recipe_quickening_catalyst, the
    packet's one pacing gate. Produce feeds cooking and alchemy, at every
    rung, and nothing else.
  - R18 THE ANTI-COMPULSION GUARDRAIL forbids unlistable or soulbound
    produce, forbids substituting a farming row for the herb or meat row
    it sits beside (farming's D24 displacement guardrail, so herbalism
    loses nothing), and forbids any profession being required to equip,
    raid, or craft gear.
  - R19 FARMING IS A LONG-HAUL SKILL forbids tuning the gain curve from
    feel instead of from the measured calendar-days-to-100 model, and
    forbids every punishment lever: no daily reset, no decay, and a late
    harvest costs only opportunity.
  - R20 EVERY GATHERING PROFESSION REACHES THE ENDGAME forbids any
    gathering profession being absent from skillReq 100 and above or from
    any 25-point band below it, and forbids leaving that to intention:
    the guarantee is a test or it does not exist.
- MAINTAINER GATES this program INTRODUCED, ALL CLOSED 2026-08-20 under
  the full delegation. None is a STEP 0 question any more: every phase
  file now carries its answer as an instruction the session executes. The
  one collection point is the section "Decisions closed 2026-08-20 (the
  full delegation)", MOVED at the 11b doc move into
  docs/prd/masterwrought/farming/state.md (the handoff-table section), and
  the ids below point into it. A phase file and that record disagreeing is doc drift to fix, never
  a licence to pick.
  - CLOSED, see 11e-D-A and state-GATE-1. The farming gain-curve target
    span (R19) is about 10 weeks, 70 to 75 days, for the reference farmer,
    with a floor of about 5 weeks at maximum dedication. The four gain
    VALUES are DERIVED by 11e from the measured model and recorded; the
    four belowProficiency BOUNDARIES (25/50/75/100) are FROZEN, because
    farmingTeachingCeilingFor derives each crop tier's teaching ceiling
    from them.
  - CLOSED, see 11e-D-B and state-GATE-2. The crop roster grows by +4
    crops, 12 new item ids, ITEM_ART_PENDING 44 to 56. Composition is
    ruled with it: exactly one of the two new tier-3 crops is a LEAF, and
    no tier repeats a plant class.
  - CLOSED, see 11f-GATE-A and state-GATE-3. The farming ladder re-tiers
    band-complete to 0/25/50/75/100 and STOPS there: recipe_harvest_feast
    climbs to cooking 100 rather than 125, and
    recipe_highwatch_barley_bannock holds at 50 as the band-50 anchor.
    Moving rows the ladder advertises is authoring rather than a retune,
    because farming lives on an unmerged branch and reaches players only
    through this packet's single PR.
  - CLOSED, see 11i-GATE-A and state-GATE-4. The fishing ladder grows
    THREE new catch bands (3, 4, 5) plus a tier-6 apex rod, not one band;
    the nine shipped cells stay byte identical. REJECTED: the existing
    three bands taking new fish behind the shipped tier-3 rod.
  - CLOSED, see state-GATE-5 and ip-16-ICON. PARK. Every new id from 11e
    to 11k parks on the merged ITEM_ART_PENDING with exactly ONE
    mapping.json owner; committed WebP art is not attempted in-change, and
    the art wave runs on the maintainer's own schedule after the packet.
    The growth is ACCEPTED, and each phase re-derives the pending size
    from the previous phase's observed value.
  - CLOSED, see 11j-D-F and state-GATE-6. THE R17 GATHERING-TOOL CARVE-OUT
    STANDS, scoped by TEXT to the hoe ladder alone and recorded as a
    CLARIFICATION beside R17, never as a change to R17. R17's text above is
    untouched, and every other exclusion (the gear intermediates, the apex
    gear bills, the Perfecting materials, and recipe_quickening_catalyst)
    stays asserted by sweep. The merits: a gathering tool has no equip
    slot, contests no item-level budget, and has no R5 interaction, so it
    is not gear in R17's sense, and the shipped recipe_osmium_hoe already
    consumes fine_highland_barley under farming's deviation (ad).
  - CLOSED, see 11b-D-1 and state-GATE-7, and still tracked as the
    packet's hardest blocker until a phase VERIFIES it in code: GATE 1,
    the D11/(bo) tier 3 and 4 seed bootstrap. FIX the faucet by
    vendor-stocking every tier 3 and tier 4 seed at farmer_hollis and
    farmer_verbena on the D11 tier 1/2 pattern, executed ONCE in 11e,
    priced per 11e-D-D, at EIGHT rows after 11e-D-B. No downstream phase
    may treat reagent dormancy as settled: 11f STEP 0, 11g DECISION B, 11h
    and 11k all prove the faucet by reading the merged vendorItems arrays
    in code, never a ledger row.
- SAME-CHANGE OBLIGATIONS, restated because this program mints more
  content ids than any phase before it: every new id carries committed
  WebP art (which needs the maintainer's master SHA, so new ids park in
  ITEM_ART_PENDING with exactly one mapping.json owner), non-Latin name
  fills for wordy English names (M16), wiki regen through
  npm run wiki:content, Book of Deeds records where the content is
  conquerable, src/ui/world_entity_i18n.ts rows for named entities, and
  an economy-invariant recheck. tests/recipe_economy.test.ts is edited by
  BOTH packets and its sorted literal pins are RECOMPUTED from the tree,
  never hand-merged. Every new proper noun is web-verified against the
  major game wikis at authoring time and recorded in the naming registry
  (R15, and farming's D17).
- WHERE THE OPEN ITEMS LIVE (amended 2026-08-20 by state-COLLECT).
  farming's own state.md (docs/prd/masterwrought/farming/state.md) remains
  the packet's ONE open-item collection point once it exists, GATE 1
  included. Until 11b's doc move creates it, delegated answers live in
  THIS file, in the dated append-only block "Decisions closed 2026-08-20
  (the full delegation)" at the end, never interleaved. 11b STEP 6
  MIGRATES that block into farming/state.md's handoff table in the SAME
  commit as the doc move, converting each row to that file's status
  vocabulary (open ruling-owed, closed-by-X) and leaving a one-line
  $1
  (EXECUTED 2026-08-20 at the 11b doc move: the block now lives in
  docs/prd/masterwrought/farming/state.md, the handoff-table section, and
  the pointer stands at the end of THIS file.) The
  rulings themselves stay in the R namespace in this file, and
  decisions-index.md is the key to the five namespaces and the
  never-renumber rule.
- THE PLAYER-PAIN BLOCK (11l, 11m, 11n), admitted 2026-08-20 and recorded
  at the gate section in implementation-plan.md, extends this program by
  three more inserted phases on the same axis, carrying R21, R22 and R23.
  All three are data work over shipped content: 11l gives the 21 orphaned
  junk drops profession consumers with zero new item ids, 11m spreads
  harvest geography and maps the two orphan tags, and 11n makes the vendor
  line a floor rather than a competitor. Their decisions (11, 12 and 13)
  are settled in "Decisions closed 2026-08-20 (the full delegation)"
  (migrated at the 11b doc move into
  docs/prd/masterwrought/farming/state.md, the handoff-table section). The inserted block is therefore THIRTEEN phases, 11b through 11n,
  not ten. (AMENDED 2026-08-20, quality-review adoption row 117: the block
  is FOURTEEN phases, 11b through 11o. Phase 11o, the leveling crafter,
  was admitted from the standing quality review's first run and runs after
  11n and before Phase 12.)

## Phase 11b pre-flight ledger (2026-08-20, recorded BEFORE the farming merge runs)

### STEP 0 record
- Worktree guard passed (session switched into ~/Documents/wocc-masterwrought,
  branch feature/masterwrought). STEP -1 committed the 11b to 11o planning
  insert as 2c1191fbbc (44 files, docs/prd/masterwrought/ only); tree clean.
- Release sync (0b): VERIFIED ALREADY COMPLETE, no new merge. After
  `git fetch origin --prune`, the newest release branch by version sort is
  origin/release/v0.40.0 (tip 65b91fa190) and
  `git rev-list --count HEAD..origin/release/v0.40.0` is 0 (the tip is an
  ancestor of HEAD via the Phase 11 QA second-pass sync fba8f47ee9). No merge
  commit exists for this session, so no release-merge-audit is owed. The merge
  base for the farming merge is therefore UNMOVED and the phase file's conflict
  prediction applies as written.
- Farming merge base re-derived: e56707a675013fc1a86bb19d31a0a8d79a02a197,
  exactly the trial-merge base the prediction was made at. Farming tip
  re-resolved: origin/feature/farming-plan = 8cd964d599, matching the
  planning-time hash.
- Memory scan (0d) done: test-pin trap index (read whole), release-merge gate
  surprises (all six classes; reinstall on lockfile/patches movement,
  shard-weight union floor, ci:changed scope widening, sparse-cone union,
  lockfile-fingerprint remints, provenance file count), gate-needs-committed-tree
  and shared-stash notes, shared-worktree commit care (explicit paths, diff
  --cached sweep, never git add -A), the workflow/subagent cluster (agents edit
  the real worktree; slices must be file-disjoint), pin-source-must-carry-identity,
  vitest-transform-cache-stale-after-merge.
- Harness note: the operator's session prompt set ULTRACODE: no for 11b (a
  careful merge, not a batch), overriding the phase file's ULTRACODE: yes
  header. Resolution is done serially in the main loop under the three
  mechanical rules; subagents are used read-only (context loading, reviewers).

### The four decisions, ANSWERED (copied verbatim in substance from "Decisions
closed 2026-08-20 (the full delegation)" rows 1 to 4; that block is the
authority, this ledger records them as answered so no gate reads
confirm-at-STEP-0)
- Decision 1 = 11b-D-1, the tier 3 and 4 seed bootstrap: FIXED. Vendor-stock
  every tier 3 and tier 4 seed at farmer_hollis and farmer_verbena on the D11
  tier 1/2 pattern, executed ONCE, in Phase 11e, at the prices 11e derives
  (EIGHT rows after 11e-D-B). 11b's obligation is the negative half: no
  resolver here treats reagent dormancy as settled, and every downstream phase
  proves the faucet by READING the merged vendorItems arrays in code, never a
  ledger row. WHY: R18 needs a profession through its OUTPUT, and a reagent
  with no faucet is not an output. REJECTED: leaving the faucet to a later pass.
- Decision 2 = 11b-D-2, the well-fed unification and the power ladder: SETTLED,
  all six axes as drafted (one aura id 'well_fed'; masterwrought's
  FoodItemDef.wellFed carrying TimedStatBuffPayload, kind-scoped;
  masterwrought's clear-then-grant mint order; farming's src/sim/wellfed.ts
  module and its tooltip view; the ladder re-tuned to farming 2/3/4/5 at 600s
  with the three apex role foods at 6/900). Phase 11c executes; 11b parks
  toward that target and changes NO number. WHY: as merged the ladder INVERTS
  (cooking-50 evergarden_braised_greens sta 12/900s beats cooking-100
  stonepot_stew sta 6/600s), breaking R5 before Phase 15 can measure. REJECTED:
  cutting farming's four wellFed payloads; lifting the apex to 8 or above.
- Decision 3 = 11b-D-3, the delivery-contract amendment: ADOPTED as drafted,
  BOTH halves. Farming is absorbed; D22 and its addendum (B) are superseded IN
  PLACE with a dated banner and never deleted; D22's absorb discipline is
  adopted upstream. AND an accepted-by-design handoff row already constitutes
  an explicit record satisfying the delivery contract's CUT requirement. 11b
  writes the amendment text. WHY: never-renumber requires supersession in
  place, and a dated "accepted, here is why" row is the most explicit record
  form. REJECTED: re-closing the 44 accepted-by-design rows at Phase 17.
- Decision 4 = 11b-D-4, monolith ceiling policy: FOUR RECORDED RAISES at the
  exact merged line counts, taken in Phase 11d, each with a ledger row naming
  this merge, both parent pins, and the reason; src/ui/hud.ts paid back by
  extraction in Phase 14. 11b touches no ceiling. There is NO resolution of
  hud.ts at or under farming's pin of 19186. WHY: funding 431 lines of
  behavior-bearing extraction inside a 160-file merge makes the merge
  unreviewable; the ratchet's credibility comes from the raise being recorded
  and paid back. REJECTED: funding that extraction inside the merge phase.
  (AMENDED 2026-08-20 by 11b's observed counts: the merged tree needs TWO
  raises, renderer.ts 13576 over 13546 and online.ts 5967 over 5950, not
  four. hud.ts composed UNDER its 19445 pin at 19251 because both packets'
  extractions stacked, and sim.ts and main.ts FALL as predicted. 11d raises
  exactly the observed red set, on the ruling's unchanged terms: each raise
  a ledger row naming this merge, both parent pins, and the reason; hud.ts
  needs no raise and therefore no Phase 14 payback beyond what 11d-U6-PAYBACK
  already records against ours' own pin.)
- Also in force for this phase, from the same block: 11b-R3c-1 (placed station
  wins, farm bed immediately below; pin both directions), 11b-R3c-2 (guide
  sentence owed to 11c; 11b takes ours), 11b-PARK-1 (icon-art test parks on
  farming's refactored art-subject split form, verdict REFACTORED NOT DELETED),
  11b-CNT-1 (derive both counts on the merged tree, report any disagreement
  with a plan literal explicitly), 11b-qa-GATE-9, 11b-qa-B8, 11b-qa-SURF-1.

### Baseline capture (STEP 0c, the three literals per file; base = e56707a675,
ours = 2c1191fbbc, theirs = 8cd964d599)
Monolith line counts (newline count, as countLines() measures), base/ours/theirs:
- src/ui/hud.ts 19382 / 19445 / 19183
- src/render/renderer.ts 13744 / 13546 / 13774
- src/sim/sim.ts 12518 / 12629 / 12229
- src/main.ts 11490 / 11516 / 11454
- server/game.ts 10894 / 10862 / 10793
- src/net/online.ts 5855 / 5902 / 5920
- src/game/music.ts 5270 / 5270 / 5270
- src/sim/world.ts 5301 / 5301 / 5301
- server/db.ts 4835 / 4835 / 4865
- src/render/foliage.ts 3961 / 4131 / 3961
- src/sim/colliders.ts 2590 / 2590 / 2590
Monolith ceilings in tests/monolith_budget.test.ts, base/ours/theirs:
- src/ui/hud.ts 19387 / 19445 / 19186
- src/render/renderer.ts 13744 / 13546 / 13774
- src/sim/sim.ts 12660 / 12650 / 12232
- src/main.ts 11490 / 11516 / 11460
- server/game.ts 10900 / 10890 / 10900
- src/net/online.ts 5950 / 5950 / 5950
- src/game/music.ts 5470 / 5470 / 5470
- src/sim/world.ts 5450 / 5450 / 5450
- server/db.ts 4980 / 4980 / 4980
- src/render/foliage.ts 4147 / 4147 / 4147
- src/sim/colliders.ts 2660 / 2660 / 2660
COUNT_PIN headline literals, base/ours/theirs (fuller grep capture in the 11b
session scratch; each 11d resolution re-derives on the merged tree and checks
observed == base + oursDelta + theirsDelta):
- tests/world_api_parity.test.ts IWORLD_MEMBERS 323 / 324 / 331 (DATA 86/86/88,
  METHOD 237/238/243, FACET_MEMBER_ARRAYS keys 33 at base and ours; theirs
  gains src/world_api/farming.ts)
- (world_api predicted merged: members 324 + (331 - 323) = 332, data 88,
  method 244, facets 34; 11d verifies)

## Delegated rulings pointer (2026-08-20)

The dated block "Decisions closed 2026-08-20 (the full delegation)" MOVED WHOLE
into docs/prd/masterwrought/farming/state.md (the handoff-table section) in the
11b doc-move commit, per its own migration clause: that handoff table is the
MERGED packet's one open-item collection point. Append convention, stated here
once: masterwrought's open items append at the END of that handoff table, never
interleaved with farming's rows.

## Phase 11b BUILT ledger (2026-08-20, the farming absorb executed)

### The merge
- A TRUE MERGE COMMIT: 424ce89a20, parents d5304a78c4 (masterwrought) and
  8cd964d599 (origin/feature/farming-plan, re-resolved, equal to the
  planning-time hash; 397 commits stay reachable; git merge-base
  --is-ancestor origin/feature/farming-plan HEAD exits 0). No squash, no
  rebase, no cherry-pick. Follow-up commits on the phase tip: 648da390b3
  (fix(sim): the ItemDef union port read sites), 6b763a1fc1 (refactor(ui):
  the RULE 2 extraction ports), then the doc-move and docs commits. The
  merge commit alone was tsc-red BY DESIGN (recorded here, not hidden); the
  exit criterion binds the phase TIP, which is tsc-clean.
- Class counts, PREDICTED == OBSERVED, exactly: 160 conflicted paths (the
  merge-tree list diffed IDENTICAL to the halt list), REGEN 27, GOLDEN 67,
  ART_CENSUS 17, COUNT_PIN 13, TAIL_APPEND 14, SEMANTIC 22 (the 14/22 split
  counts the five locale overlays and the two i18n catalog tables with the
  seven RULE 1 tables in TAIL_APPEND; the same 36 files either way). 442 of
  farming's 602 changed files landed clean. The release sync was a VERIFIED
  NO-OP (v0.40.0 tip 65b91fa190 already an ancestor), so the merge base
  never moved and no count deviation needed explaining.
- Parks, all held: 67 goldens on ours (no UPDATE_PARITY run); 13 count pins
  on ours (no literal moved; two parked suites took TYPE-completion fixture
  edits only, in 648da390b3, so the tip compiles: material_taxonomy's
  injection BASE gained farmMaterialItemIds, blob_roundtrip's fixture gained
  farming: 0); 16 ART_CENSUS files on ours plus
  tests/release_v039_icon_art.test.ts parked on FARMING's refactored
  art-subject split form, verdict REFACTORED, NOT DELETED (ruling 11b-PARK-1;
  nothing added to any deletion list); scripts/ci_shard_weights.generated.json
  on ours (the fix is a fresh CI harvest, 11d-U1-SHARD). The REGEN class was
  parked on ours then the two DETERMINISTIC pretest generators re-ran on the
  merged tree (npm run i18n:gen, npm run wiki:content) inside the merge
  commit, per the repo's own generated-artifact merge rule in src/ui/CLAUDE.md
  ("take either side, run i18n:gen, git add the result") and because the
  tsc-clean exit criterion is unreachable with a stale TranslationKeyFlat
  union; both generators run on every npm test anyway. No golden re-record,
  no shard harvest, no pin bump, no ceiling touch.

### The three rules as applied (the notable resolutions)
- RULE 1 on all seven tables: deeds.ts (DEED_ORDER[len-1] IS
  'prog_farming_100'; no committed masterwrought row moved), recipes.ts
  (rebuilt deterministically from ours' stage plus farming's HOE_RECIPES and
  FARM_RECIPES blocks placed contiguous LAST before ALL_RECIPES, spreads
  appended at the ALL_RECIPES tail after APEX_CONSUMABLE_RECIPES; HOE sits
  away from ROD by the never-re-sorted rule), profession_items.ts (farming's
  13 rows byte-exact: wellfed 3/600, 6/900, 9/900, 12/900; harvest_feast
  feast {10, 3600, evergarden_braised_greens}), reliquary.ts,
  i18n.catalog/items.ts (ITEM_ENTITY_IDS ours-then-farming;
  APPENDED_ITEM_NAMES both blocks; the positional legacy arrays untouched),
  hud_chrome.ts, and the architecture allowlist (union at the insertion
  point; the file's own grouping kept).
- RULE 2 discharged: the diff-filter=A enumeration returned 212 added files;
  the at-risk set was swept by extracting every same-named symbol's body at
  BASE and at OURS and diffing (script in the session scratch; the decisive
  argument for the rest: every non-conflicted coordinator's ours-edits and
  theirs-deletes could not overlap or git would have conflicted). Findings:
  castDisplayName (ours added EXACTLY the one SUNDER_CAST_ID arm; ported into
  src/ui/cast_display_name.ts between SALVAGE and TOOL_RECHARGE) and
  entityDisplayName, which was a NEW member of the class: BOTH packets had
  extracted it from hud.ts into DIFFERENT modules (ours'
  entity_display_core.ts at the v0.37.0 sync, base-identical body; farming's
  entity_display_name.ts, base plus the live feast-title arm plus its own
  Vitest). One authority survives: farming's module; the core's
  byte-equivalent copy was REMOVED with a pointer comment (not a third
  variant: neither body deviated from base except farming's feast arm, so no
  design question arose and no stop fired). All six ability_tooltip_lines
  functions, the turnstile trio, HEAVY_SELF_*, and every other swept symbol:
  UNCHANGED by ours, extraction wins clean. Zero duplicate definitions at the
  tip (tsc clean).
- RULE 3: imports unioned (hud.ts kept tSim: a live consumer remains at its
  error.noItem toast; main.ts unioned the turnstile block and correctly kept
  worldEntryGpuSettleCoverMs dropped, zero consumers); independent additions
  composed ours-first (items.ts placeMobileStation then feast arms, mutually
  exclusive by keying field; hud.ts tooltip block composes
  recipePatternTooltipLines THEN wellfedTooltipLines THEN feastTooltipLines,
  and BOTH well-fed key families are live in hud.ts by design; bags_view's
  clickSetOut feast hint sits ABOVE the generic use hint; nameplate_view was
  the one compose a naive union would have gotten wrong: ours RESTRUCTURED
  the hidden condition behind the standIn override, so farming's !feastNear
  term was folded INTO the object arm inside the !standIn group rather than
  kept as a second ungated copy); the two tooltip-coverage suites COMPOSED
  (ours' quality-axis pin keeps all ten masterwrought junk intermediates,
  farming's CRAFTED_JUNK_EXCEPTIONS joins it, the craftedJunk pin now lists
  all 12, and harvest_feast's above-the-floor rarity is asserted honestly
  with its masterwork-arm proof).

### RULE 3c takes (ours verbatim) and the 11c carry list, WHOLE
Each item records the theirs-side text this phase did NOT take, so 11c has
the evidence in one place:
1. src/sim/combat/auras.ts consume-complete site: took OURS (the inline
   clear-then-grant well_fed mint). Theirs' text, whole:
   "// Meal completed: mint the Well Fed buff (src/sim/wellfed.ts) before the
   // slot is nulled; an interrupted meal never reaches this line. Zero draws.
   if (c.remaining <= 0) { applyWellfedOnConsumeComplete(ctx, p, c);
   p[slot] = null; }". CONSEQUENCE, stated and accepted: src/sim/wellfed.ts
   is a clean add and DELIBERATELY UNREFERENCED at this tip (its export stays
   for 11d's symbol census); the auto-merged applyWellfedOnConsumeComplete
   import in auras.ts was pruned; farming's four buff dishes mint NOTHING
   until 11c wires the unified path (their payloads are inert data, no
   number moved). 11c wires wellfed.ts per 11b-D-2/11c-D-2.
2. src/ui/sim_i18n.ts 'aura.wellFed' DICT values: took OURS everywhere. The
   three actually-conflicting values, theirs' text whole: zh_CN '饱足',
   zh_TW '飽足', ko_KR '포만감' (ours: 精神饱满 / 精神飽滿 / 잘 먹음; ja 満腹
   and ru Сытость coincided on both sides). Kept from theirs:
   'error.castingPlanting' plus its comment; the AURA_NAME_KEY 'Well Fed'
   row was identical on both sides.
3. itemUi.tooltip.useElixir / useElixirAura, EN catalog and the five
   overlays: took OURS (the replacement-clause forms). Theirs' values were
   the pre-clause base forms ("Use: Increases your {stat} by {value} for
   {minutes} min. Usable in combat." / "Use: Grants {aura} for {minutes}
   min. Usable in combat." and their zh_CN/zh_TW/ja/ko/ru equivalents,
   retrievable at 8cd964d599); dropped as stale same-key values, not as
   content.
4. The professions overview prose (guide.ts catalog whatBody + the five
   overlays): took OURS ("four gathering trades ... a ring of ten crafts ...
   nine of the ten crafts and all four gathering professions"). Theirs'
   English, whole: "Professions are the working life of the world: the
   gathering trades that pull raw material straight out of the land, and a
   ring of ten crafts that turn it into gear, meals, potions, and tools.
   Everything feeds something else here. The ore you mine becomes a blade,
   the blade takes an enchant, and the enchant needs dust broken out of old
   gear, so a gatherer, a crafter, and a tinkerer are all links in one
   chain.\n\nThere is no profession limit to agonize over. Every character
   can raise seven of the eight crafts that have content today and every
   gathering profession side by side (Engineering is the one holdout: its
   recipes all start above the free ceiling, so its ladder waits for the
   Bombardier's oath); the only exclusive choice is your archetype, the
   identity you eventually swear to, though once you attune the crafts that
   fall dormant behind it climb only on their common recipes, and past skill
   75 not at all. Skill never goes down, and nothing you learn is ever taken
   away." (overlay equivalents at 8cd964d599). OWED TO 11C, settled
   (11b-R3c-2): 11c WRITES the merged sentence "five gathering trades ...
   and a ring of ten crafts", moves "all four gathering professions" to
   five, around guide.profPages, plus the five non-Latin overlays; Phase
   16's arm is VERIFY, never author. "Four gathering" ships here BY DESIGN,
   not by omission.
5. BOTH well-fed tooltip key families are intact on purpose (ours'
   itemUi.tooltip.wellFed/wellFedAura AND theirs' useWellfed/useWellfedAura,
   in the EN catalog and all five overlays): 11c retires one pair only
   AFTER comparing locale-fill coverage (settled: masterwrought's pair
   survives per ruling 14, 11c-A4-KEYPAIR); destroying a family here would
   have destroyed the comparison evidence.
6. scripts/wiki/build_content.mjs consumableEffect reads farming's wellfed
   spelling ONLY, as authored; when 11c unifies onto FoodItemDef.wellFed the
   read moves in the same change (a wellFed fallback was deliberately NOT
   added here: neither parent had it, and inventing it would have changed
   the generated wiki for masterwrought's three plates).
7. THE INTERACTION-PRIORITY RECORD (ruling 11b-R3c-1, settled): the placed
   station wins and the farm bed sits immediately below. FINDING against the
   live code, recorded rather than papered over: the two sides' test cases
   do NOT textually contradict, because masterwrought's mobile stations take
   NO interact press anywhere; they are proximity-activated
   (inRangeStationTypes feeds the crafting window). The merged
   tryNearbyInteraction arm order is farming's shipped one: nodes, then farm
   bed, then feast, then escort-away; farming's own test pins bed-over-feast.
   The ruling's target order (the placed transient, station or feast, above
   the bed) therefore requires a BEHAVIOR CHANGE this phase is forbidden to
   make, so the "both directions pinned" acceptance arm is DEFERRED WITH
   REASON to the phase that reorders the arms (11c per the ruling's carry
   clause; an apex-feast press also concerns 11k). "Bed alone presses the
   bed" is already pinned by farming's suite. This is a RECORDED DECISION on
   this carry list, never a take-ours.
8. FoodItemDef carries BOTH spellings (wellFed ours, wellfed farming's,
   identical TimedStatBuffPayload shape, verified structurally identical);
   feast? sits on OtherItemDef (kind-scoped; the union port). 11c retires
   the wellfed spelling and its runtime kind guard.

### Derived counts (ruling 11b-CNT-1; found numbers, disagreements named)
- Farming item rows in src/sim/content/items.ts, DERIVED ON THE MERGED TREE:
  31 rows, split 27 kind 'junk' (8 crop trios: seed/produce/fine, plus
  withered_husks, compost, growth_tonic; trio count corrected from 7 by the
  QA audit 2026-08-21: seven trios would sum to 21 + 3 = 24, contradicting
  the row's own 27, while 8x3 + 3 = 27) and 4 kind 'tool' (garden_hoe,
  bronze_hoe, skysilver_hoe, osmium_hoe), zero missing, all landing on
  OtherItemDef. This AGREES with the plan's direct count (31) and DISAGREES
  with the plan's earlier literal of 30, which is hereby reported wrong, not
  adopted. The 13 profession_items.ts rows (8 plain dishes + 4 buff dishes +
  harvest_feast) landed byte-exact.
- docs/farming tracked-file count, DERIVED with git ls-tree at HEAD before
  the move: 36. This agrees with the plan's "one reading says 36" and
  DISAGREES with the earlier literal of 34, reported wrong, not adopted.
- Goldens/scenarios bijection on the merged tree: 69 golden files, 67 static
  scenario name literals plus the hit_rating_heroic geared/ungeared ternary
  pair = 69; both new goldens present and registered
  (rift_clear_rewards.json ours, farming_session.json theirs), each in a
  parity shard via the coverage suites.
- world_api predicted-for-11d (from the 0c baseline): members
  324 + (331 - 323) = 332, data 88, method 244, facets 34; command schema
  predicted send 200 + (204 - 199) = 205, dispatch 213 + (217 - 212) = 218.
  11d verifies observed == predicted; nothing bumped here.

### The doc move (its own commit, after the resolution lanes rejoined)
- git mv docs/farming to docs/prd/masterwrought/farming (36 files, rename
  detection intact); 303 in-packet path-string occurrences across 275
  carrier lines, 274 of those lines rewritten and one (now farming/
  state.md's handoff row) kept verbatim by design (progress.md's 303 and
  this ledger's earlier bare 275 were the same measure in different
  units); the
  out-of-packet citations re-pointed (zone1.ts:918 comment, deeds.md,
  mob_portrait_source_manifest comment). The RENAMED-NOT-REVISED banner
  heads the moved README and is the ONE deliberate carrier of the old path
  outside verbatim records; the remaining greppable mentions are all
  verbatim history (the 11b/11b-qa phase-file instructions, the progress.md
  absorb decision record, and migrated delegated-rulings rows 8 and 9),
  listed here so the acceptance sweep has the exception inventory.
- THE NEEDLE: tests/farming_asset_manifest.test.ts re-pointed at
  docs/prd/masterwrought/ and WATCHED TO FAIL (the new path injected into
  the manifest fixture, the assertion went red on exactly that line, the
  injection reverted, manifest byte-identical); journeyEvidence untouched;
  docs/design/farming-asset-manifest.json NOT moved.
- Forward-looking rewrites (past-tense records verbatim): README working
  agreements; implementation-plan Delivery bullet and Packet teardown
  section; farming/state.md's three stale Current-phase headers (top header
  replaced by the absorbed-state record, the two interior ones demoted to
  "Prior:"); the journey-script handoff row. D22 + addendum (B) SUPERSEDED
  IN PLACE with the dated banner (bodies verbatim); the absorb discipline
  adopted upstream in the Delivery contract amendment above.
- THE MIGRATION: the 133-row delegated-rulings block moved WHOLE into
  farming/state.md's handoff-table section in the doc-move commit;
  vocabulary translated at the batch level (every row
  closed-by-the-2026-08-20-delegation; ip-17-PUSH gets its own open
  ruling-owed table row as the one hand-back); the one-line pointer and the
  append convention stand at the end of THIS file; the five stale in-file
  citations of the block were amended in place; the block's own
  self-description carries the dated MIGRATED note.

### Deviations and drift found by this phase (recorded, not silent)
- ULTRACODE: the operator's session prompt set ULTRACODE: no for 11b,
  overriding the phase file's yes; resolution ran serially in the main loop
  under the three rules (read-only agents only), over the same file
  partitions the four slices named.
- The phase file's premise that the station-vs-bed priority is pinnable this
  phase was drift against the live code (carry item 7 above).
- The planning-time hud.ts extraction map missed that ours had ALSO
  extracted the display-name family (entity_display_core.ts): the RULE 2
  sweep caught it as a new member of the extraction-versus-in-place class
  (memory note written).
- tests/entity_display_core.test.ts follows the entityDisplayName authority
  move (import swapped to entity_display_name; cases unchanged).
- The two research subagents dispatched at STEP 1 completed but their
  reports were never delivered to the session (a harness delivery failure);
  the context was re-derived by direct reads, which is why the ledger cites
  live-tree evidence throughout.

### The named red list (full suite run ONCE at the phase tip; 3016 files, 42472 tests, 141 red in 35 files; every red named and owned, ZERO defects of this phase)
Gate facts first: npx tsc --noEmit CLEAN at the tip;
tests/architecture.test.ts green (44); tests/ci_workflow.test.ts green (25,
the 13 merged cone rows verified in the literal and all five workflow
blocks); tests/farming_asset_manifest.test.ts green (needle proven);
npm run ci:changed exit 0 after the style pass e686d7246f.

11C-OWNED, 30 tests in 8 files (the parked well-fed unification and the
guide sentence; rulings 11b-D-2, 11c-D-2, 11c-A4-KEYPAIR, 11b-R3c-2; the
count was 29/7 as built, and the QA audit 2026-08-21 RE-OWNED
tests/parity/coverage_c.test.ts from the 11D golden group, see its row):
- tests/wellfed.test.ts (10): farming's mint path is DELIBERATELY
  unreferenced at this tip (carry item 1); every mint/boundary/draw-stream
  arm reds until 11c wires the unified path.
- tests/professions_feast.test.ts (4) and tests/feast_online.test.ts (1):
  the feast bite's Well Fed completion arms, same cause.
- tests/wellfed_tooltip_view.test.ts (6) and
  tests/feast_tooltip_view.test.ts (6): the zh_CN/zh_TW/ko sentences
  interpolate the aura name through the matcher, which now serves
  masterwrought's aura.wellFed values (carry item 2); 11c's key-pair
  retirement re-aims these suites.
- tests/localization_fixes.test.ts (1): pins farming's CJK aura values
  byte-for-byte; same cause, same owner.
- tests/parity/coverage_c.test.ts (1): RE-OWNED 11C by the QA audit
  (2026-08-21). Its single red is the LIVE well-fed aura assertion (the
  farming_session scenario expects aura value 12 after the feast bite), not
  a stale golden compare: it goes green when 11c wires the mint, and an 11d
  UPDATE_PARITY re-record cannot fix it. Both QA reviewers (architecture,
  cross-platform) independently confirmed the failing assertion is the
  aura-value line, with every draw-ledger assertion in the file passing.
- tests/guide.test.ts (1): farming's "count-free" gathering-trades guard vs
  the kept ours-side "four gathering trades" sentence. RECORDED FOR 11C
  (carry list addendum): ruling 11b-R3c-2's merged sentence SPELLS "five
  gathering trades" while this farming guard forbids ANY spelled count
  (/\b(four|five|[45])\b/); the two cannot both stand, so 11c must either
  amend the guard alongside the reword or write the sentence count-free and
  amend the ruling's wording in place, a decision 11c records, never a
  silent pick.

11D-OWNED, 111 tests in 27 files (the parked derived artifacts; rulings
11b-D-4, 11b-PARK-1, 11d-U1-SHARD, 11d-U4-MATTAX, 11d-U6-FIFTH; 112/28 as
built, minus the coverage_c re-own above):
- Parity goldens, 69: tests/parity/parity_a (7), _b (4), _c (2), _d (4),
  _e (19), _f (1), _g (32). Goldens parked on ours. RECHARACTERIZED by the
  QA audit (2026-08-21, replacing "the merged sim's streams differ from
  both parents by design", which misread as rng movement): the shared RNG
  STREAM did NOT move. The QA's 69-scenario re-record audit proved every
  frame's rng.digest and rng.draws BYTE-IDENTICAL to the committed goldens;
  the reds are a uniform +4 shift in nextId/id/entityId/sourceId/
  aggroTargetId (farming's four farm-patch world objects) and the derived
  state digest. 11d re-records via UPDATE_PARITY in isolated reviewed
  commits under the adopted instruction in the review round below: only the
  id family and state may move, and a draw digest that moves during the
  re-record is a DEFECT the re-record would bless, never an expected delta.
- Count pins, 31: deeds_content (7), deed_i18n (1), deeds_view (1),
  command_schema (2), profile_page (1), recipe_economy (2),
  reliquary_content (3), professions_blob_growth (2),
  professions_blob_roundtrip (2), material_taxonomy (9),
  material_taxonomy_bootstrap (1). All parked on ours' literals; 11d
  re-derives predicted-then-observed from the 0c baseline. AMENDED by the
  QA audit (2026-08-21) for the two blob suites, per the migration
  reviewer's CRITICAL: their re-derivation is NOT a literals-only re-mint.
  The merge took ours whole, discarding farming's already-written coverage
  at 8cd964d599: 'farmPlots' in PROFESSIONS_BLOB_FIELDS (and the roundtrip
  sweep's twin), the ceilingSim() arm planting EVERY authored bed with the
  widest crop (evergarden_greens), and the ceiling 15360 re-minted from a
  measured 14218 with floor 13952. 11d RESTORES that fixture and those
  field rows FIRST, then re-derives on the merged shape; a bound re-minted
  around the current plotless fixture would sit near 11.5 KiB and be
  permanently blind to the largest new persisted field this absorb adds
  (~2.7 KB of farmPlots at full beds). The 11d phase file's own paragraph
  (predict from the parents' bounds plus the measured ~251 B/plot) is
  compatible but under-specified on this point; this row governs.
- Monolith ceilings, 2: src/render/renderer.ts over 13546 and
  src/net/online.ts over 5950. NOTE FOR 11D: hud.ts is NOT red; the two
  packets' independent extractions compose, so the merged hud.ts sits UNDER
  ours' 19445 pin, and the recorded-raise set is renderer.ts and online.ts
  (online.ts is the fifth-monolith case, 11d-U6-FIFTH), with sim.ts and
  main.ts falling as 11b-qa-B8 predicted.
  THE 11b-qa-B8 SECOND-ARM ROW, written by the QA audit (2026-08-21) as the
  settlement requires: F14's lowered sim.ts pin is 12232 (farming ratcheted
  12249 -> 12235 at B7 -> 12232 at B8, each with a written rationale, all
  at 8cd964d599); masterwrought's pin is 12650; the merged file measured
  12340 at the audited tip 8f3efa2fc8 (12341 after this QA's own one-line
  comment truing; 11d measures at its own tip). The merge kept ours' 12650,
  so the raise measured against F14's
  number ONLY is +108, which is merge arithmetic, never a regression: the
  B8 extraction survives whole (Sim.mobMeleeRange has ZERO references at
  the tip; the delegate pair was retired at 570fd2c026 and stayed retired).
  11d OWNS the sim.ts re-derivation beside its other pin work: re-pin at
  the merged count plus the ratchet's usual small margin and write the
  two-extraction history into the row's comment (the pin currently sits 310
  lines above the file with no comment, the un-banked slack the
  architecture reviewer flagged; main.ts shows the correct re-pinned
  shape).
- Art census, 8: deed_icons (1), item_art_audit_builder (1),
  item_art_consistency (1), missing_painted_icons_wave (1),
  release_art_audit_v036_reliquary_deeds (1), release_v039_icon_art (2,
  parked on farming's refactored split form; 11d re-derives 75/pending),
  eastbrook_polish_capture_contract (1).
- Asset fingerprint, 1: farm_props_asset (the SOURCE_FINGERPRINT spans
  package.json and pnpm-lock.yaml, and the merged tree's composition
  differs from farming's pinned value; 11d re-mints via the
  remint_lockfile_fingerprints tool and checks the hits column, per the
  release-merge gate-surprises catalog).
Arithmetic check: 30 + 111 = 141; 8 + 27 = 35 files. Nothing unclassified.
(As built the split read 29 + 112 over 7 + 28; the totals never moved, only
the coverage_c ownership.)

### Review round (five domain reviewers, COVERAGE prompts, 30-call budgets; every finding dispositioned, none dropped)
Dispatched per the matrix: architecture-reviewer, cross-platform-sync,
frontend-seam-reviewer, privacy-security-review, migration-safety;
qa-checklist LAST (verdict below). The fix round landed as its own reviewed
commit (parked-mint comments trued, the parked-state pin, the bags_view
guard alignment).

- SECURITY: CLEAN, zero blocking or should-fix. Four INFO observations,
  all explicitly no-change-requested, LEDGERED: (a) a refused farming
  command still sets selfHeavyDirty (game.ts ~6537; bounded by the command
  lane bucket and once-per-tick collapse; the rift-forge refusal-above-flag
  idiom is the shape to copy if beds ever grow); (b) consume_feast is a weak
  feast-existence oracle (dedicated map, no mutation, leaks only "a feast
  exists"); (c) feastOwnerKey mixes characterId/entityId domains (cannot
  fire online, fails safe); (d) characterUpdateStatement now logs via the
  blob-size reporter (id + byte count only, scalar closure state). PASSED:
  full server authority on all five farming commands, dev gating, SQL
  parameterization, HEAVY_SELF membership set-compared across both parents
  and the merge (58/55, nothing lost, nothing invented), secrets sweep, the
  11,635-line i18n injection sweep, CI workflow diff. Carried loudly: the
  DEPLOY.md farming rollback note (rolling past the growth engine after
  players plant destroys plot state on the next autosave) is a deploy-order
  constraint for the eventual ship.
- FRONTEND: 2 blocking, 3 should-fix, 2 notes. Both blockings are the
  SETTLED parks, not new information, dispositioned SETTLED-BY-RULING: the
  aura.wellFed term collision IS the RULE 3c take-ours (ruling 11b-D-2;
  survivor settled by 11c-A4-KEYPAIR; its reds are the 11c-owned rows of the
  red list), and the renderer.ts/online.ts ceilings are 11d's recorded
  raises (the reviewer confirmed the renderer growth is thin wiring at the
  correct seam and measured hud.ts at 19251, UNDER its 19445 pin).
  Should-fix 1 (the two families compose at different tooltip positions;
  the survivor must keep restore-line adjacency) ADDED to the 11c carry
  list. Should-fix 2 (bags_view hover narrowed vs click ladder bare)
  APPLIED: both arms now read the same bare item.feast predicate (the
  module's own item shape carries feast?). Should-fix 3 (harvest_journal's
  hand-rolled write cache + innerHTML rebuilds, inherited from farming's
  QA'd branch) LEDGERED as polish carry (11c or Phase 14's UI pass). Note 1
  (the standIn fold shows a compile-pending feast plate beyond the
  hysteresis band, the safe fairness-positive direction) RECORDED here as
  the deliberate resolution semantics so 11c does not read it as accident.
  Note 2 (identical 'Well Fed' display name across both families) is moot
  at this tip (farming's mint is inert) and resolves at 11c's unification.
- ARCHITECTURE: 2 blocking, 4 should-fix, 4 notes; determinism CLEAN with
  proof (the 34 lap markers match farming's parent name-for-name with
  lap('farming') exactly where farming authored it; sim.ts and
  sim_context.ts auto-merged with ZERO combined hunks; SimContext strictly
  append-only with the feasts live-view primitive; the parity failures'
  rng.digest and rng.draws are BYTE-IDENTICAL in every failing golden, the
  diffs being a constant +4 entity-id shift). Blocking 1 (parity gate red =
  no guard signal at the tip) is the recorded GOLDEN park; its 11d
  instruction is ADOPTED VERBATIM into the ledger: at re-record time, diff
  old vs new and assert ONLY id/entityId/sourceId/nextId/state move and
  every rng.digest + rng.draws pair is byte-preserved; a digest that moves
  during the re-record is a real regression the re-record would bless.
  Blocking 2 (the four farming dishes' EFFECTIVE magnitude is zero at this
  tip) is the settled 11b-D-2 park, stated in the ledger's carry item 1;
  the reviewer is right that the BEHAVIOR moved even though no literal did,
  and that honesty is now also written at both former comment sites.
  Should-fixes APPLIED: the two stale comments trued (feast.ts bite,
  items.ts food arm); the lowercase-carrier content pin added
  (tests/wellfed.test.ts, exact four-id set + three-id wellFed set + no
  def carries both spellings + no def carries use AND feast, which also
  discharges the arm-order note). Should-fix (prog_gather_three desc
  merge-minted) REFUTED WITH EVIDENCE: the reworded desc and its
  refill-protocol comment are byte-identical on farming's parent
  8cd964d599, an auto-merged farming reword, not resolution drift; its
  locale refill rides the release fill per the in-file protocol comment.
  Notes ledgered: ALL_RECIPES tail order is behaviorally free for the sim
  (verified fold-by-fold by the reviewer) with ONE observable effect,
  farming rows list LAST in the crafting window / trainer list surfaces
  (11d should expect reordered list goldens; QA twin should eyeball the
  window); the sim_context comment records onCropFarmedForQuests as a
  deliberate non-seam module import.
- PARITY: 4 critical, 4 warning; all four criticals are facets of the ONE
  settled park (the dead mint, the dual spelling, the advertising tooltips,
  the aura term literals), dispositioned SETTLED-BY-RULING and owned on the
  red list; the tooltip-advertises-inert-buff consequence is now stated in
  the items.ts comment as well. Warning ADOPTED into the ledger: the
  world_api_parity pin is a FALSE GREEN at this tip (it self-checks only
  its own pinned list, so the new farming facet is invisible and 11d gets
  no red reminder; the ledger's predicted-counts row IS the reminder, and
  11d must not wait for a suite to prompt it). Warning (localization_fixes
  straddles both spellings across two arms) joins the 11c carry list.
  Warning (guide four-vs-five) already carry item 4. Also adopted: the
  zh_CN farming guide prose still says the buff term farming chose while
  the aura renders masterwrought's, one more locale surface for 11c's
  key-pair retirement; and the reviewer's full MATCH tables (all 8 farming
  facet members implemented on both worlds; fplot/mst encode-decode
  delta-safe; all five commands round-trip; all 7 farm events + the two
  widened unions handled) stand as the parity PASS record.
- MIGRATION: 2 warning, 3 info, zero blocking; the JSONB composition is
  VERIFIED four ways (release-tip, either parent, merged saves all load on
  merged code; the merged CharacterState is the exact 98-field union; no
  DDL anywhere in the merge). Warning 1 ADOPTED as a carry: farming's
  gatheringProficiency serializes farming:0 non-omitted, so EVERY character
  blob rewrites (~14 bytes) on its first post-deploy autosave, inherited
  from farming but meeting masterwrought's blob growth here; 11c makes the
  zero-omit-or-accept call consciously, beside the blob-size reporter it
  lands next to. Warning 2 ADOPTED as an 11d instruction: when the
  roundtrip pins re-derive, give farming a distinct FRACTIONAL fixture
  value (zero is exactly what the normalizer restores on a dropped key, so
  farming: 0 is blind to the drop it should catch); also record that the
  merge commit itself is type-red on that file, the fix arriving in
  648da390b3 (matters to a bisect). Infos ledgered for 11d: REQUIRED_FIELDS
  should gain wyrmfallDaily/emberWeekAnchor/farmPlots and one fixture
  should hold a plot AND a craftDaily stamp in the same blob; downgrade is
  lossy in both directions (serializeCharacter rebuilds from meta), so the
  two packets must never point at a shared database independently.

### 11c carry list ADDENDUM (from the review round; continues items 1 to 8 above)
9. The surviving well-fed tooltip family must keep the restore-line
   adjacency ours' composition has (the line renders directly under the
   restore it qualifies), and the retired keys must leave the catalog
   cleanly (tests/i18n_completeness.test.ts is the check).
10. tests/localization_fixes.test.ts straddles the two spellings across two
   arms (one pins the wellFed plates, one the wellfed dishes); 11c's
   unification re-aims BOTH onto the surviving field and the union of
   carriers.
11. The zh_CN farming guide prose (src/ui/i18n.locales/zh_CN.ts, the
   farming section) still uses farming's buff term while the live aura
   renders masterwrought's; sweep every farming-authored locale surface for
   the retired term during the key-pair retirement.
12. farming's gatheringProficiency serializer writes farming: 0 non-omitted,
   rewriting every character blob (~14 bytes) on first post-deploy autosave;
   11c makes the omit-or-accept call consciously (migration reviewer,
   WARNING 1).
13. The harvest_journal_window 1 Hz countdown hand-rolls a write cache and
   rebuilds via innerHTML (inherited from farming's branch); route through
   the host writers during 11c's food/feast UI pass or Phase 14's UI beauty
   pass, whichever opens the file first.
14. The guide count-free guard vs ruling 11b-R3c-2's "five gathering
   trades" wording (see the red list's guide.test.ts row): 11c reconciles
   and RECORDS the choice.
15. (QA audit, 2026-08-21) The stale "the four gathering" code comment at
   src/guide/pages/professions.ts:7 sits OUTSIDE ruling 11b-R3c-2's literal
   scope (guide.ts plus five overlays) and a comment cannot trip Phase 16's
   "no shipped string says four gathering" verify arm; 11c sweeps it in the
   same reword pass so the guide page's own source does not contradict the
   sentence it renders.
16. (QA audit, 2026-08-21) The farm-patch feast-flourish arming has a
   recorded design tension, NOT fixed here because the current semantics
   are deliberately pinned (tests/farm_patches_adapter.test.ts, the
   "unarmed baseline" arm: a first pass over an EMPTY entity map arms the
   flourish, so a feast on the next pass puffs). Consequence: if the
   renderer's prewarm pass (prewarmWorldFrame calls farmPatchVisuals.sync)
   ever runs before the online mirror holds its first snapshot, the empty
   prewarm pass consumes the silent first pass and every standing in-scope
   feast fires its placement puff on the first live read, the exact burst
   the silent pass exists to prevent. Guarding the arm on a non-empty map
   would flip the pinned baseline behavior, so closing it is a design call
   (wire age, snapshot-ready gating at the renderer call site, or accepting
   the burst); owner: 11c's food/feast UI pass or Phase 14's UI beauty
   pass, whichever opens the file first, with the module's own
   scope-reentry paragraph as the precedent for accept-and-record.

### QA gate verdict (qa-checklist, run LAST after the fix round)
READY, ZERO BLOCKING. Independent re-verification of the ledger's claims on
the live tree: tsc clean re-run; architecture + ci_workflow +
farming_asset_manifest green together; world_api_parity + snapshots +
sim_context green together (563 tests); eleven farming/feast/bags suites
green in one run (398 tests); the monolith budget file BYTE-IDENTICAL to
ours' parent (parks, not raises, proven by empty diff); DEED_ORDER's tail
position confirmed at the source; the delegated-rulings migration live with
the pointer at state.md's head section; the docs/farming sweep confirmed at
14 mentions across exactly the 5 ledgered exception files, zero in
executable code; the red count RE-VERIFIED at 141 after the fix round's new
pin (the pin passes, so the count did not go stale under its own commit);
farmPlots load-path defaulting and the wholesale-UPDATE no-resurrection
property confirmed. Three should-fix items, ALL APPLIED: (1) the two carry
obligations with no home in 11c's own file now have open ruling-owed rows in
the merged handoff table AND an 11b HANDOFF ADDENDUM appended to
phase-11c-food-and-feast.md (the guide-guard contradiction and the
interaction-priority reorder, with an explicit re-route-to-11k option to
record if 11c judges the press competition moot); (2) Decision 4's "four
recorded raises" trued with dated AMENDED lines in all three homes (the
pre-flight ledger copy above, migrated rows 4 and 16): the observed set is
TWO, renderer.ts and online.ts, hud.ts under-pin at 19251; (3) recorded
here as a standing guard note: src/sim/wellfed.ts is DELIBERATELY
unreferenced until 11c wires it (carry item 1), so no unused-export sweep
may delete it as dead code before then. VERIFY items for later phases,
adopted: the parity goldens guard NOTHING for the whole 11b-to-11d window
(the strongest argument that 11d follows 11c promptly); 11d gives the
blob-roundtrip farming fixture a fractional value and confirms the
farmPlots round-trip arms; hud perf budget + perf:tour and a full
gate_select pass ride the 11b QA session per the phase cadence.

## Phase 11b QA audit record (2026-08-21, the absorb verified; validation block at close)

Session facts: worktree guard passed (EnterWorktree into wocc-masterwrought);
release sync a VERIFIED NO-OP again (origin/release/v0.40.0 tip 65b91fa190
already an ancestor; newest by version sort; no merge, no release-merge-audit
owed). Reference trees verified: BASE e56707a675, OURS d5304a78c4, THEIRS
8cd964d599, MERGE 424ce89a20, audited TIP 8f3efa2fc8. Seven audit lanes ran
as one ultracode workflow (read-only, 30-call budgets) plus five FRESH domain
reviewers on the immutable range d5304a78c4..8f3efa2fc8; every mechanical set
was re-derived in the main loop first and matched the ledger exactly (160
conflicted via merge-tree replay, 251 both-touched, 91 auto-merged, 212
THEIRS-adds).

### The three uncovered surfaces: VERDICTS (11b-qa-SURF-1 discharged)
The word UNAUDITED never actually appeared in this file (verified by grep);
the obligation's substance was always the POSITIVE half, written here.
1. electron/main.cjs: CLEAN. The farming-added biome-ignore
   noUndeclaredEnvVars suppression sits at line 785, still attached
   immediately above the WOC_OPEN_DEVTOOLS read at 786, and is provably
   LIVE: biome flags the unsuppressed sibling env read at line 107 and not
   line 786. Scoped biome check exits 0 (two pre-existing BASE-debt
   warnings, no errors). Farming's whole electron/ diff is the one line;
   masterwrought's is empty; no post-merge commit touched the directory.
2. server/http RouteDef additions: CLEAN, the settled verdict CONFIRMED on
   the merged tree, WITH ONE CITATION CORRECTED. Citation (1) as recorded
   ("farming's export-const-routes set is 20 files, a strict subset of
   masterwrought's 27") does NOT reproduce: the set is BYTE-IDENTICAL
   across BASE, OURS, and THEIRS at 27 grep hits = 25 .ts RouteDef modules
   + 2 CLAUDE.md docs quoting the convention (farming had absorbed the
   release sync before 8cd964d599). That identity proves the conclusion
   STRONGER: farming added NO routes module. Citations (2) (3) (4)
   confirmed exactly as recorded: farming_commands.ts carries no RouteDef
   (WebSocket handler); farming's server/main.ts diff is exactly the
   lockoutNowMs injection with no URL literal; no farming path in any
   /api/ string. server/http/ untouched on BOTH sides, registry.ts
   untouched, both reference file lists match the actual name lists.
3. tests/ci_workflow.test.ts sparse-cone union: CLEAN. All 13 rows (nine
   farming + four masterwrought) present in the SPARSE_CONE literal and in
   all five workflow blocks byte-identically (each row appears exactly 5
   times in ci.yml); the extractor finds exactly five blocks; the suite
   passes 25/25 at the tip.

### Extraction census: CLEAN of the hunted class (per-member verdicts)
All 14 members plus the other 24 farming-added modules swept; every symbol
has exactly ONE live definition at the tip; no DIVERGENT third variant
exists anywhere. Verdicts: boss_mechanics.ts IDENTICAL (BASE==OURS for the
whole extracted region, thin delegates remain); heavy_self.ts IDENTICAL
plus farming's four cmds/two events, no masterwrought entry lost;
character_blob_size.ts, glb_instanced_props.ts,
gather_rare_event_feedback.ts, and wellfed.ts NEW-MODULE (nothing to
port); window_open_state.ts IDENTICAL (hud.ts thin delegate);
report_window.ts IDENTICAL with two in-module-documented deltas (live
hooks re-read at submit; #ffd100 to var(--gold)); entity_display_name.ts
one authority with the feast arm, entity_display_core.ts TRIMMED of the
one duplicated member and retained with its other 15 helpers (hud.ts
imports both); cast_display_name.ts OURS-EDIT-PORTED (the SUNDER arm at
the required position between SALVAGE and TOOL_RECHARGE, import present,
no castDisplayName left in hud.ts; the port landed in fix commit
6b763a1fc1, not the merge itself); ability_tooltip_lines.ts IDENTICAL
bodies (the ruinCost block predates the fork; the documented ?? 0 NaN
guard is the one deliberate delta; the unported "Icy Veins" comment nit
was fixed this session); turnstile_gate.ts IDENTICAL byte-faithful move;
item_lock.ts IDENTICAL plus the clean countRawInSlots addition;
mech_chroma_ownership.ts IDENTICAL extension (no OURS edit existed; the
bespoke host-interface seam now has its src/sim/CLAUDE.md row).

### Silent auto-merge sweep: NO SILENT SWALLOW
All 17 high-risk members plus 8 sampled lower-risk members show exactly
additive numstats at the tip, and semantic reads confirm both sides'
intent alive in each: server/game.ts carries ours' extract_essence arm
beside farming's five dispatch arms (bodies in farming_commands.ts, labels
kept for the schema scan) with the self-resend sets extracted whole;
src/world_api.ts stays count-free and extends 34 facets ending in
IWorldFarming with all six new COMMAND_NAMES facet-tagged; renderer.ts
kept farming's 30 lines alive inside ours' 788-line refactor; sim.ts holds
both sides after farming's 490-line extraction refactor. The main-loop
numstat sweep over the hand-merged SEMANTIC files is additive within known
resolutions (auras.ts = exactly the carry-1 drop and nothing else). The
QA's one residual: the 21 hand-merged SEMANTIC files were verified at
every carried site, every pin, and by the reviewers' bidirectional diffs
over src/sim, but not walked hunk-exhaustively file-by-file; bounded risk,
recorded honestly.

### The named red list: VERIFIED COMPLETE AND HONEST
Full suite at the tip (bounded 5 workers, no special env, matching the
build): 3016 files, 42473 tests (the build's 42472 + the fix round's one
new pin), 141 failed in 35 files, and the per-file red set is EXACTLY the
ledger list, every count equal (spot-verified live twice more by lanes).
Zero unlisted reds; zero stale-listed greens. Parked-class FULL census
(all 160 conflicted paths blob-compared against both parents): 96 OURS /
1 THEIRS / 63 NEITHER, tiling the recorded 160 exactly; all 67 goldens
byte-OURS, art census 16 byte-OURS + release_v039_icon_art byte-THEIRS
per 11b-PARK-1, shard weights byte-OURS, 11/13 count pins byte-OURS and
the two exceptions carry only the recorded type-completion fixture edits
(no pin literal moved); REGEN class regenerated on the merged tree as
recorded. Determinism proof: the QA re-recorded ALL 69 parity scenarios
and every rng.digest and rng.draws matched the committed goldens
byte-for-byte (the red-list recharacterization above).

### RULE 1, measured against the literal claim (record trued, no tree change)
deeds.ts, recipes.ts, reliquary.ts, i18n.catalog/items.ts and the
architecture allowlist hold the three-tier shape as recorded, and
DEED_ORDER[len-1] IS 'prog_farming_100' (confirmed expected, now recorded
here since the ledger never restated the plan's expectation). Two files do
NOT literally match "farming block LAST": profession_items.ts carries the
13 farming rows CONTIGUOUS but mid-table (a single pure-insertion hunk
preserving THEIRS' own placement; every ours row frozen), and
hud_chrome.ts scatters farming keys across its shared nested namespace
maps (key-based lookup, no order contract). Neither loses data or moves an
ours row; both are recorded so a later reader measuring the tables does
not read the deviation as a resolution defect. deeds.ts also carries the
one mid-table content change: prog_master_gatherer's desc reworded
count-free, byte-per-THEIRS (farming's own reword when it became the
fifth trade).

### Doc move: PASS (guards verified, hygiene items trued)
Follow-log walks through the rename on progress.md/state.md/README.md (a
true git mv); the 36-count re-measures at tip and THEIRS; the residual
old-packet-path citation set re-derives to exactly the ledgered 14 mentions
across the 5 exception files, zero in executable code (this record
deliberately does NOT spell the old path, so the sweep's own inventory
stays at 14/5; a re-sweep at any later tip should expect exactly the
ledgered exception files and this file contributing zero); the needle asserts
against the new root, its watched-to-fail probe is recorded above and it
runs green; farming-asset-manifest.json unmoved, journeyEvidence
untouched; a COMPLETE D22 set-diff (not a sample) shows every past-tense
record byte-identical, the census moving 147 (THEIRS) to 154 (tip) purely
by the new banner/migration/README lines, fully attributed.

### The S3 corpus probe (the fourth strike of the recorded re-raise class)
A QA reviewer claimed src/sim/professions/feast.ts and farming.ts are
absent from the S3 scan corpus. REFUTED with the file open (the
socialSourceUnder('src/sim/professions') directory glob at
localization_fixes.test.ts:1211, convention comments at :1205/:1217) and
SETTLED by the two-direction byte probe on the committed tree: flipping
one byte of feast.ts's 'You sit down to eat.' emit reds s3_registered
(baseline 1 red to 2); flipping one byte of the log.sitEat DICT English
reds the localize-every-emission arm as well (to 3); both restored,
baseline back to exactly the 1 known 11C-owned red.

### QA review round (five FRESH reviewers + seven lanes; every finding dispositioned)
- SECURITY: CLEAN, zero critical/warning; its four INFO notes are the SAME
  four the build round already ledgered above (heavy-dirty on refusal, the
  feast-existence oracle including its range-check-last ordering, the
  feastOwnerKey domains, the blob-size reporter's logging), dispositioned
  ALREADY-LEDGERED; its load-side normalizeFarmPlots read stands as the
  tamper-handling PASS record.
- MIGRATION: 1 CRITICAL (the blob-fixture discard; now the AMENDED
  count-pin row above), 2 WARNING, both APPLIED in the fix round
  (character_blob_size.ts derivation comment trued; DEPLOY.md mixed-fleet
  bullet trued: the two-release staging advice was FALSE on this tree
  since zone1.ts vendors seeds from first boot, and rollback also erases
  the Farming skill number from both gathering keys). Its premise
  correction is recorded: there was NO server/db.ts conflict; ours never
  touched db.ts, the merged copy is byte-identical to farming's, and
  NEITHER side added DDL.
- ARCHITECTURE: 0 blocking. Draw-order proven clean (the 69-scenario
  audit above). Should-fixes: the parity-park sentence (recut above), the
  S3 corpus claim (REFUTED above), three stale parked-mint comments
  (trued in the fix round), the sim.ts pin slack (the B8 row above).
  Notes: the mech-chroma host seam (CLAUDE.md row added), the farming
  sweep tail comment (trued), ItemUseResult's home in
  mech_chroma_ownership.ts recorded as a relocation candidate for whoever
  touches that area next.
- PARITY: no new drift; the world_api_parity FALSE GREEN confirmed still
  live with the measured numbers matching the ledgered prediction
  (332/88/244/34). NEW 11D INSTRUCTION adopted from its second warning:
  alongside the W0c re-pin, add a directory sweep asserting every
  src/world_api/*.ts facet is a FACET_MEMBER_ARRAYS key (appearance.ts
  carve-out), so a facet existing on disk but absent from the partition
  can never be silently green again; NOT added this phase because it would
  red immediately and mint a red outside the named list.
- FRONTEND: 1 "blocking" (the renderer ceiling) dispositioned as the
  ledgered 11d park; 3 should-fix APPLIED in the fix round (the farming
  windows opened display:block against their flex-authored stylesheets,
  which hard-clipped the mobile harvest journal behind overflow:hidden
  with no scroller, fixed to flex with the three display pins updated; the
  picked-seed/armed-knob forced-colors hue-only state, fixed with the
  base.css redundant-underline arm; the two dead imports in
  wellfed_tooltip_view.ts). Notes recorded: the map-vs-minimap farm-pin
  palette split (oak vs station tokens; family-consistency backlog),
  farm_event_feedback.ts's five raw hex log colors beside the tokenized
  report_window call (tokenization backlog), .hj-row's rgba inset-card
  literal (backlog), the report_window focus-trap carve-out (already
  pinned in tests/managed_window_close_registry.test.ts; cheap to close at
  a maintainer's option), targetCastDisplayLabel returning raw ids for
  non-farming system casts (in-module documented scoped gap; the one-line
  fix is a maintainer call), the entity_display two-module family
  (consolidation candidate), and the feast-flourish prewarm tension
  (carry item 16).

### Release-fill obligation added by this audit
prog_master_gatherer's deed desc overlay row was deleted by farming in ALL
18 deed_i18n locales (the old text named the four trades; the English desc
is now count-free), so the desc renders the English fallback everywhere
until the release fill re-fills it; this row makes that orphan owned.

### Validation at close (the owed gate_select pass + the perf arm, discharged)
Fix commits: 9455d31254 (flex windows + forced-colors + dead imports),
bc9399c7a4 (comment truings + sim CLAUDE.md row), 4d804b8057 (this record +
record corrections + DEPLOY.md), 44bb54541d (fix-round review findings),
6bb2de9b0f (qa-checklist findings + the flex source-contract pins, the
journal pin proven by a full-flip mutation), 19beba1f4a (coverage-audit
hardening: CSS-half pins, ps-knob markup binding, comment-stripped scans,
symmetric needles). Review chain: fresh reviewer over the first four (PASS,
3 low, applied), qa-checklist LAST (READY, 0 blocking, 5 should-fix + 3
nits, ALL applied), test-coverage-auditor over the new pins (3 should-fix +
5 nits, ALL applied or recorded; its F6 brace-walk comment-skip remark is a
shared-idiom note on the quest_marker precedent too, recorded not fixed).
GATE_MAX_WORKERS=5 node scripts/gate_select.mjs at 44bb54541d: mode=full
fallback; artifacts regen + freshness, media manifest, malware scan, and
ci:changed all GREEN; the vitest step FAILED EXACTLY as the parks predict
(141 failed / 35 files, the red-file set diffed IDENTICAL to the audited
tip's verified set; a green gate is impossible at this tip BY CONSTRUCTION
until 11c/11d clear the parks). The steps behind the gate's first-fail stop
were run individually: browser regression suite 20 files / 134 tests GREEN,
npx tsc --noEmit exit 0, npm run build exit 0 with the tree CLEAN after
full artifact regen (the freshness proof). ci:changed exit 0 re-verified at
the close tip. The owed perf arm: tests/hud_perf_budget.test.ts 119 green;
npm run perf:tour ran TWICE, both exit 0 with no threshold set
(informational), artifacts tmp/perf-tour-2026-08-21T01-58-20-508Z.json and
the 02:2x run; structural outputs healthy both times (prewarm 0 fail / 0
timeout, views complete, FCT pool cap-bounded 24/24/24, hudSkip 97 to 99
percent); ABSOLUTE frame numbers are load-depressed (concurrent sessions on
this host) and are NOT comparable to a quiet-CI baseline; the
HUD_PERF_BUDGET_TOUR=1 anchor comparison was not run (same-machine-baseline
contract; the committed anchors are another machine's).

### F14 actionables (GATE 9): ALL THIRTEEN SURVIVED, cited not twinned
Per the settled gate, the record is farming/progress.md's Phase 14
"QA-CHECKLIST ROUND (2026-08-20, dispatched LAST per the packet)" block
(gate on frozen tip 354cff6e77: 12 steps green, 2897 files / 40606 tests);
no phase-14-qa.md twin exists and none was authored. The QA verified each
actionable at the tip: A1 window_open_state + both windows' body-class
wiring live (the pin suite green); A2 both token moves survived the merge
and the biome pass; A3 the bags feast arm sits above the generic use hint
with its five fills; A4 the a11y batch live (radiogroup, aria-busy,
aria-live, husk-trade label); A5 the pending generator excludes
RETIRED_KEYS with the render sweep's inverse assertion; B6 slot-thread
proofs green (its suite's 4 reds are the 11c mint arms); B7 countRawInSlots
ONE shared export + distToBed exported; B8 the second arm exactly as
settled (the row above); B9 gatherDowngrade 'crop' live end to end
(downgradeMarkCrop reader + dispatch); C10 pipeline whole (def-accurate;
live-inaccurate for the four buff dishes until 11c wires the mint, the
known carry, noted as the player-visible wiki gap in the 11b-to-11c
window); C11 both nameplate comments + the cast display names (the SUNDER
interlock verified); C12 mob_boss_mechanics 8/8 green; C13 exactly 10
closed-by-Phase-14 handoff rows, matching the acceptance matrix (A5, B8,
C12, C13 had no pre-existing rows to discharge).

## Phase 11c BUILT ledger (2026-08-21, food and feast reconciled; the well-fed unification executed)

Session facts: worktree guard passed (EnterWorktree into wocc-masterwrought);
release sync a VERIFIED NO-OP again (origin/release/v0.40.0 tip 65b91fa190
already an ancestor, newest by version sort; no merge, no release-merge-audit
owed). Base: the 11b QA close tip 4f9097858c, tsc clean and architecture
green at start. ULTRACODE: no per the phase file (a careful serial build with
fresh reviewers).

### Decision 2, SETTLED 2026-08-20 and EXECUTED as written
Rulings 11b-D-2 / 11c-D-2 executed on all six axes, no gate left reading
confirm-at-STEP-0: one aura id 'well_fed' (exported as WELL_FED_AURA_ID from
src/sim/wellfed.ts, THE seam constant every runtime site references; the
literal survives only in the identity pin in tests/wellfed.test.ts, the
sanctioned literal-keyed AURA_RECIPES row in src/ui/icons.ts, and the
view/painter test fixtures that pin it on purpose, TRUED at the QA audit);
FoodItemDef.wellFed as the one field (farming's lowercase twin deleted, its
runtime kind guard unrepresentable, pinned by a self-verifying
ts-expect-error); masterwrought's clear-then-grant order at the updateRegen
completion site, now delegating to the module; farming's src/sim/wellfed.ts
module (rewritten header: the single-id rule and why it is stronger, elixir
coexistence by construction) and farming's tooltip view surviving.

### The ladder and its derivation (no number invented)
Farming dishes 2/3/4/5 at 600s (one stamina point per crop tier, at the
entry duration); apex plates 6/900. The apex VALUE stays 6,
elixir_of_the_boar's entry rung, the number R5's kit was measured against
(flask 15 plus food 6 equals 21, untouched). The apex DURATION is DERIVED:
entry duration (600) plus the elixir ladder's own duration step read live
(venomfire_elixir 900 minus boar 600 = 300), so 900. The R23 challenge is
answered in the apex block comment and here: raising the crafted duration is
ladder ORDERING inside the crafted line, not floor creation (no vendor item
grants Well Fed; R5's always-on premise is duration-indifferent). Farming's
flagged 24-stamina stacking read resolves to 17 (dish 5 plus elixir 12); the
tier-1 inversion resolves at 2. Pins: masterwrought_budget re-derives the
apex band live and gains the live-catalog strict-dominance sweep (a fifth
dish authored at or above the apex reds the day it ships); farm_recipes
derives the dish rungs off the boar anchor rather than pasting.

### The carried payload (ruling 11c-A2-BUILDER)
src/sim/consuming.ts is the one Consuming build site; BOTH real writers
route through it (items.ts useItem food/drink arm; the feast bite, which
previously hand-built the record with no wellFed carry and silently minted
nothing). tests/consuming.test.ts drives the builder directly and holds the
acceptance at source level (no hand-built eating/drinking literal outside
sim.ts's two dev freezes). THE TWO DELIBERATE NON-WRITERS, named so nobody
"fixes" them: sim.ts's 'dev_cascade_freeze' and 'dev_sandbox_freeze'
zero-rate meals (no item def, sentinel remaining, must never mint) stay
hand-built by design. Monolith position considered: consuming.ts is a
short pure leaf outside MONOLITHS (its exported ConsumableDefFacts is the
builder's structural parameter type, satisfied by FoodItemDef and every drink
def without an ItemDef union import); no ceiling entry owed. (QA audit
2026-08-21: the Consuming record itself is now kind-scoped too, FoodConsuming
| DrinkConsuming in src/sim/types.ts, so the mint's "types beat guards" claim
holds at both layers; see the QA record below.) The
feast-versus-bag identity pin (professions_feast) compares the minted aura
as a WHOLE record through the real tick path in both runs. The wire was
re-verified untouched: server game.ts ships eat: { remaining } only.

### One view, one key pair, one vocabulary
wellfed_tooltip_view.ts survives (export renamed wellFedTooltipLines),
re-pointed to the surviving keys' placeholder sets READ OFF the catalog
({stat}/{value}/{minutes}; {aura} only in the fallback), wired at
masterwrought's restore-adjacent hud position; the elixir-module twin and
hud.ts's second import and call are deleted (hud.ts net-zero in LINES, trued
at the QA audit: one call line and one import name removed, one comment line
added, 19251 before and after; the ratchet did not move and nothing grew). Ruling 11c-A4-KEYPAIR executed: farming's useWellfed pair and
its ten overlay rows died in the same change; the exactly-one-line rule is
pinned per buff food AND as a method-scoped exact-count source pin on
Hud.itemTooltip. DELIBERATE NON-ACTION recorded in elixir_tooltip_view.ts:
ELIXIR_STAT_KEYS stays a private byte-identical twin of WELLFED_STAT_KEYS
(rule of three; the leaf is named for well-fed because of the guide's
spoiler-containment constraint). The retired farming aura terms were swept
from the zh_CN/zh_TW/ko_KR guide surfaces onto the kept aura.wellFed terms
(carry 11). 11c-VOCAB executed verbatim: 'a mobile field kitchen so dinner
gets cooked at the dungeon door'. The Laden Hearth pairing pin landed in
tests/mobile_station_party.test.ts (a cook with a live Hearth cooks
recipe_harvest_feast away from any static kitchen, every input read off the
live recipe). Both feasts kept, as ruled; nothing merged.

### The guide sentence and the count-free RESOLUTION (obligation 1, RECORDED CHOICE)
Ruling 11b-R3c-2's wording spelled "five gathering trades" while farming's
guard in tests/guide.test.ts forbids ANY spelled gathering count; the two
could not both stand. RESOLVED: the sentence is COUNT-FREE ("the gathering
trades that pull raw material straight out of the land"; "every gathering
profession") and the ruling's wording is amended in place in the delegated
block (farming/state.md row 6, dated line). WHY count-free wins: the guard
exists because a spelled count made the wiki lie the moment a fifth trade
registered, which is EXACTLY what the shipped "four" was doing; the guard's
names-every-trade arm is self-maintaining (a sixth trade fails until named),
while spelling "five" would re-arm the same staleness bug and weaken a guard
that had just caught it. Phase 16's verify arm ("no shipped string says four
gathering") is satisfied verbatim. The five non-Latin overlays all read
count-free after this change (trued at the QA audit: ja_JP, ko_KR and ru_RU
were re-filled here; zh_CN and zh_TW already read count-free, 各类采集行业 /
各類採集行業, and were left as they stood); the stale "the four gathering"
code comment in src/guide/pages/professions.ts was swept (carry 15), and its
byte-parallel twin in scripts/wiki/build_content.mjs at the QA audit.

### The interaction reorder (obligation 2, ruling 11b-R3c-1 EXECUTED, not re-routed)
The press competition is NOT moot for the feast: a placed harvest_feast and
a farm bed stand in reach together today, and farming's shipped order gave
the press to the bed. The arms are reordered in
src/game/nearby_interaction.ts (nodes, then FEAST, then bed, then
escort-away) and BOTH directions are pinned in one
tests/nearby_interaction.test.ts rig (feast plus bed presses the feast; the
identical press opens the bed once the feast despawns). The STATION half
stays moot BY CONSTRUCTION and is recorded at the arm and here: mobile
crafting stations take no interact press at all (proximity-activated via
inRangeStationTypes), so there is no station arm to order until one gains a
press; 11k's apex feasts ride the ordered feast arm as placed farm_feast
entities. The handoff row is closed EXECUTED, not re-routed.

### The flourish design call (obligation 4 / carry 16, CLOSED accept-and-record)
Chosen: accept-and-record, written into applyFeasts' own doc comment in
src/render/farm_patches.ts as a second accepted residual beside the module's
scope-reentry precedent. Grounds: no renderer prewarm pass precedes the
online mirror's first snapshot today, so the burst window is empty; the
puffs are cosmetic and ride vfx.ts's scaled budget; and both code options
would couple farm visuals to another mirror's sync semantics for a race that
does not exist. The comment names the correct future fix (hold
farmPatchVisuals.sync at the RENDERER call site until the mirror syncs) and
forbids the non-empty-map guard that would flip the pinned rebuild/login
silence. The pinned unarmed-baseline arm is untouched.

### Carry 12 CLOSED: the farming:0 serialization call (accept, with grounds)
serializeCharacter writes the WHOLE folded gatheringProficiency record and
always has: mining/logging/herbalism/fishing zeroes ship non-omitted, so
farming: 0 is the family convention, not a farming quirk. Omitting only
farming's zero would make one key's presence value-dependent against four
unconditional siblings for a one-time ~14-byte rewrite per character.
ACCEPTED as-is, no code change; 11d's blob-roundtrip fixture still takes a
FRACTIONAL farming value per its own instruction (unrelated to this call).

### Deviations and drift (recorded, not silent)
- THE i18n NAMED RED WAS RESOLVED HERE, NOT HANDED TO 11d: retiring the
  useWellfed catalog keys makes the committed resolved slices
  excess-property RED under tsc (22 files), so the phase file's premise that
  the stale bundles stay compilable was drift, and the tsc-clean exit
  criterion is unreachable without i18n:gen. Regenerated and committed under
  the 11b precedent (the merge ran the same generators in-commit for the
  same reason). Consequence: 11d's named-red list loses the i18n row; the
  guide/wiki row and the parity goldens remain 11d's.
- The generated wiki effect shape KEEPS its lowercase wellfed key
  (build_content.mjs emit, content.generated.ts type, professions_craft.ts
  read): a serialized shape name, consumer-pinned, deliberately NOT the def
  field spelling; renaming it now would tsc-red the committed generated type
  until 11d's regen. Recorded as the one surviving lowercase spelling beside
  the surviving module filenames (wellfed.ts, wellfed_tooltip_view.ts,
  wellfed_stat_keys.ts), none of which are the retired identifier.
- tests/recipe_economy.test.ts is on this phase's STEP 3 validation list but
  its 2 reds are the 11b-parked 11d-owned count pins (the 11b red list's
  "recipe_economy (2)"); nothing this phase touched feeds them (no sellValue,
  no count moved). Not defects of this phase.
- CORRECTED AT THE QA GATE: this ledger first read `npm run ci:changed`'s
  exit 1 as the branch-wide scope noise of the memory catalog, on the
  evidence that every error named a file outside this phase's diff. That
  reading was WRONG by one file: an import-order ASSIST error in
  tests/wellfed.test.ts was inside the changed set and was the gate's only
  error, fixed at deb22b262d, after which ci:changed exits 0. The scope
  noise is real for other files, which is exactly what made the miss easy;
  the durable rule is in the QA verdict block below (a `--write` FORMAT
  pass does not organize imports, and the gate is re-run after the LAST
  commit rather than the last source edit).
- The 11b red list's guide.test.ts row (the count-free guard) went GREEN
  here; the FILE now carries exactly the 2 freshness reds named to 11d (the
  regen-diff arm and the C10 effect-row mirror, which this phase re-aimed
  to the post-regen truth of SEVEN effect rows: the plates gain cells).
- The parity scenario beat labels (wellfed-eating, wellfed-dish-minted,
  feast-wellfed-minted, ...) keep their historical hyphenated names: they are
  recorded snapshot labels whose rename would move goldens for no behavior.

### RELEASE-FILL OBLIGATIONS (reword-staleness, flagged BY KEY for the Phase 17 fill)
(TRUED at the QA audit 2026-08-21: every key below is filled ONLY in the five
non-Latin overlays, ja_JP / ko_KR / ru_RU / zh_CN / zh_TW; the 15 Latin
locales are registry-PENDING for them, rendering the new English correctly
through the passthrough, so no Latin overlay row exists to be stale. The
earlier "filled in every locale" reading was the build spec's premise and was
drift.)
- guide.profPages.craftProse.cooking.routeBody: the Hearth clause reword
  ("the feast" to "dinner"). The five non-Latin rows are now reword-stale
  against the new English (the reword-staleness class; the flag is the
  deliverable per 11c-VOCAB); the Latin locales stay pending.
- guide.professions.whatBody: the count-free reword. The five non-Latin rows
  all read count-free (three re-filled here, two already were); the Latin
  locales stay pending. No stale overlay row exists for this key.
- guide.profPages.craftProse.cooking.identityBody (QA round): the "only food
  that leaves a Well Fed buff" clause became FALSE under the unification
  (seven direct carriers) and was reworded to the ladder-top clause; the five
  non-Latin rows were re-filled in the same change (clause swap only); the
  Latin locales stay pending.
- itemUi.tooltip.useFeastBuff and useFeastBuffAura (QA round): the
  one-at-a-time clause appended, in the wellFed pair's own words per locale
  (byte-identical clause to the surviving itemUi.tooltip.wellFed rows); the
  five non-Latin rows were re-filled in the same change; Latin pending.
- guide.profPages.effectWellFed (QA round): English capitalization only
  ("Well fed" to the proper noun "Well Fed"); the five non-Latin rows already
  carry the aura TERM and need no re-fill; Latin pending. Recorded so the
  fill does not read the English delta as a pending reword.
- (Standing from the 11b QA: prog_master_gatherer's desc overlay rows,
  deleted in all 18 locales, remain owned by the release fill; not re-filled
  here.)

### The named red list movement (this phase's whole delta)
11C-OWNED reds, 30 in 8 files at handoff, ALL GREEN at this tip: wellfed 10,
professions_feast 4, feast_online 1, wellfed_tooltip_view 6,
feast_tooltip_view 6, localization_fixes 1, guide (count-free arm) 1,
parity/coverage_c 1. The verification surface GREW: consuming.test.ts (6),
the feast-versus-bag identity pin, the two exclusivity cases, the
retired-namespace sweep (no quoted wellfed_ prefix in src/, scripts/, tests/,
shared-walker + stripped comments, self-audited), the exactly-one-tooltip-
line pins, the ladder derivation and strict-dominance sweeps, the both-
direction interaction pins, and the Laden Hearth pairing pin.
REMAINING reds at this tip, all 11d-owned: the 69 parity golden compares,
tests/guide.test.ts (2, the wiki regen), and 11b's parked count pins,
monolith ceilings (renderer.ts, online.ts), art census, and the
farm_props fingerprint, per the 11b ledger.

### The predicted farming_session composition handed to 11d (checked, not pasted)
PROVEN on this tip by a full UPDATE_PARITY re-record diffed against the
committed goldens and then RESTORED (nothing re-recorded in the tree):
- ALL 69 scenarios: every frame's rng.draws AND rng.digest BYTE-IDENTICAL to
  the committed goldens (zero mismatches; the audit script walked every
  frame). A digest that moves during 11d's re-record is a real regression the
  re-record would bless, never an expected delta.
- farming_session: the six readable aura rows move exactly as predicted, id
  wellfed_buff_sta to well_fed, value 12 to 5, duration 900 to 600,
  remaining down by EXACTLY 300 in every row (THE CARRY PROOF, trued at the
  QA audit: presence at frame 140 is vacuous, because the bagged dish's aura
  minted at tick 1959 is still alive there under either outcome; what
  discriminates is the delta. Carry working: 897.05 to 597.05 at frames
  117/118/119/140 and 896 to 596 at 142/143, a delta of 300 everywhere.
  Carry BROKEN: frame 140 reads 577.05 and 142/143 read 576, a delta of 320,
  because the feast bite re-minted nothing and the bagged aura just kept
  decaying. The refresh signature 11d can eyeball: the committed golden's
  frame-140 remaining equals frame 117's byte for byte, 897.05 both, and the
  re-record must keep that equality at 597.05), name "Well Fed" and school
  "nature" unchanged, sourceId 967 to 971 (the known 11b +4 entity-id shift,
  named here so a legitimate +4 is not read as an unexpected delta); the rows
  are PRESENT in the same six frames (117, 118, 119, 140, 142, 143), total
  draws 110 both sides, final drawDigest equal. The golden carries SEVEN
  retired-id hits today: the six aura rows plus the covers prose line that
  743f1540a0 reworded at the source, so the re-record drops all seven.
- Everything else moving in the re-record, ENUMERATED at the QA audit from
  a scratch re-record of shard g (the earlier "+4 shift and derived digests"
  line was incomplete for THIS file, whose nextId does not move in any of
  its 144 frames): (a) entities[0].eating gains the carried payload
  `wellFed: { aura: 'Well Fed', duration: 600, kind: 'buff_sta', value: 5 }`
  in the two frames that sample a live meal, 96 (wellfed-eating, tick 1618)
  and 119 (feast-bitten, tick 2018): the eating slot IS sampled on
  checkpoint frames (trace.ts sampleEntity copies every gameplay field and
  the committed golden already holds eating rows), so the carry becomes
  VISIBLE there; it is not a wire widening (server ships eat:{remaining});
  (b) entities[0].hp and maxHp 220 to 150 and stats.sta 35 to 28 in the six
  aura frames (the 12-to-5 stamina delta); (c) players[0].craftDaily and
  wyrmfallDaily `{}` appear in all 23 checkpoint frames: farming_session is
  the ONLY one of the 69 committed goldens lacking them (a farming-origin
  golden-shape gap, recorded on the parents' tree), not the +4 shift; (d) the
  events digest moves in frames 114 (tick 1960) and 137 (tick 2360); (e) the
  coverage[19] prose line moves to the unified wording (743f1540a0); and the
  derived state digests. Across all 32 shard-g goldens the re-record moved
  ZERO rng.draws / rng.digest values and no frame count.

### Review round (four fresh domain reviewers, COVERAGE prompts; every finding dispositioned, none dropped)
Dispatched per the matrix over the immutable range 4f9097858c..HEAD:
architecture-reviewer, cross-platform-sync, frontend-seam-reviewer,
content-obligations-reviewer; qa-checklist LAST (verdict below). Three fix
commits landed: 7984e751c3 (frontend + content), 743f1540a0 (parity),
828a9a5b64 (architecture). Skipped by the phase file and confirmed
correct: privacy-security-review, migration-safety,
database-performance-reviewer (no server, no persisted shape, no SQL; Well
Fed is transient across save by design).

- ARCHITECTURE: 2 blocking, 3 should-fix, 4 notes. Determinism CLEAN WITH
  PROOF: the reviewer diffed the pre-phase auras.ts against the tip and
  confirmed the mint moved field for field (same eight properties in the
  same order, the guard preserved as an early return, clear-then-grant
  intact), read Sim.applyAura end to end for rng access (none), and
  verified both new modules import no Rng, clock or DOM; it also scanned
  the whole 60k-line parity failure log and found NOT ONE rng.digest or
  draws value differing in any scenario, independently reproducing this
  ledger's byte-identity claim. Both BLOCKINGs are the recorded parks
  dispositioned SETTLED-BY-SPEC, not new information: the wiki regen is
  the named red the phase file forbids running early ("running a generator
  before this phase is final means running it twice"), and the 69 golden
  compares are 11d's re-record whose own instruction this ledger already
  carries. Should-fixes APPLIED: the src/sim/CLAUDE.md module-table row
  for wellfed.ts (its own every-SimContext-importer rule; the omission was
  inherited from the absorb, but 11c is what made the module live), the
  writer sweep's COMPUTED-SLOT blindness (see below), and the world_api
  facet doc (already fixed at 24f532604b). Note ADOPTED as a pin: the
  builder names the meal by def.id where the old inline code used the
  caller's lookup key, equivalent only while no ITEMS entry is keyed under
  an alias, so the premise is now pinned over the whole catalog. Note
  RECORDED, not changed: eating a tier-1 dish after an apex plate
  downgrades the buff, the deliberate classic last-eaten-wins rule.
- PARITY: 0 critical, 3 should-fix, 1 nit. THE CATCH WORTH THE ROUND: the
  farming_session scenario's `covers` prose still named wellfed_buff_sta,
  and that array is RECORDED INTO the golden, so 11d's re-record would
  have baked the retired id into the fresh artifact and cost a second
  re-record; the retired-namespace sweep structurally cannot see it (prose
  inside a string, not a quoted id prefix). Fixed before 11d records. The
  other two should-fixes were the same facet doc and the same two locale
  effect rows the other reviewers found. PASSED with tables: no IWorld
  member added or changed (so no parity-pin update was owed), the
  Consuming payload never crosses the wire (server ships eat:{remaining},
  the client decodes exactly that), the aura itself rides the untouched
  wireAura so id/name/kind/value/school reach the online buff bar exactly
  as offline, no SimEvent or command added, the RL obs surface unchanged
  (obs.ts reads aura KIND only), and tryNearbyInteraction has exactly ONE
  call site so the reorder applies identically on every input path.
- FRONTEND: 0 blocking, 2 should-fix, 4 notes. Every seam gate green
  (architecture + painter_host 65, hud_perf_budget 119, the i18n trio 64,
  the tooltip suites 103, auras/party/mobile-station 160, hud_update_drive
  + language_fanout + focus_restore). Both should-fixes APPLIED: the
  zh_CN and ko_KR guide effect rows were a ONE-SIDED sweep (zh_TW's
  byte-parallel row was swept in the same commit, which is what made them
  misses rather than decisions), and the routeBody reword staleness, which
  is DISPOSITIONED settled-by-ruling (11c-VOCAB makes the by-key
  release-fill flag the deliverable, and this ledger carries it).
  Notes: the feast view's stat-map import moved to the pure leaf and the
  now-importerless re-export was dropped (leaf header trued); the aura
  resolver differs from the deleted twin only in chain order with no live
  difference, and the surviving choice is the one the buff bar itself
  uses. Confirmed zero DOM writes, zero new drivers, no CSS, no tier knob.
- CONTENT: 0 blocking. Verified the balance derivation is computed LIVE and
  not pasted on both sides (the apex band off venomfire minus boar, the
  dish rungs off the boar anchor), referential integrity clean with tsc as
  the load-bearing check (the lowercase field was REMOVED, so any surviving
  typed read is a compile error) and the two other .mjs item-def generators
  never spelled the field, and that no deed / reliquary / art / M16
  obligation arises (no item id added, removed or renamed). Its deeds (7)
  and reliquary (3) reds matched the 11b parked rows exactly.
  Two INFOs recorded rather than acted on: harvest_feast is an eighth,
  INDIRECT well-fed carrier whose wiki craft row ships no effect cell
  (pre-existing Phase 12 shape, and the in-game feast tooltip does state
  it live); and the re-tune drops the shared feast's party payout from
  12/900 to 5/600 because it serves evergarden_braised_greens, a
  CONSEQUENCE of 11c-D-2 as written (farming tops out one below the apex)
  that the ruling did not name, recorded here so a later phase re-tunes it
  deliberately rather than discovering it.
  Its NIT (the "exactly one below the apex" adjacency was unpinned, since
  the value and the apex are pinned independently) was APPLIED as a new
  arm on the dominance sweep.

### QA gate verdict (qa-checklist, run LAST after the four reviewers and their fix rounds)
READY after one blocking fix, applied. The gate ran the FULL matrix over 75
changed files in 10 domains and re-verified the load-bearing reviewer
findings itself rather than taking them on trust.

- BLOCKING, FIXED (deb22b262d): `npm run ci:changed` was RED on exactly one
  error, an import-order assist violation in tests/wellfed.test.ts. It
  slipped because biome's organize-imports is an ERROR-severity ASSIST and
  the phase's earlier `--write` pass was a FORMAT pass, which does not
  organize imports; nobody re-ran the changed-files gate after the last
  three commits. Re-run through the assist; `npm run ci:changed` now exits
  0 over the changed set. DURABLE LESSON for the packet: a format pass is
  not a check pass, and ci:changed must be re-run after the LAST commit,
  not after the last source edit.
- NIT, FIXED (same commit): the retired-namespace sweep had no non-vacuity
  floor, so a walk that silently stopped scanning would have passed over
  nothing. It now counts the files it walked and floors that near the real
  corpus size (tests/CLAUDE.md's rule).
- SHOULD-FIX, DISPOSITIONED WITH AUTHORITY (no change owed): the gate asked
  for a recorded ruling behind the locale-overlay term edits, since root
  CLAUDE.md says contributors never edit the overlays. One already exists
  and predates this phase: 11c carry item 11 (the 11b review round's
  adopted parity warning, in the 11b carry-list addendum above) orders
  exactly this work, "sweep every farming-authored locale surface for the
  retired term during the key-pair retirement", and the phase file
  separately orders the whatBody five-overlay fills by name. The class is
  also the maintainer's own sanctioned overlay-edit reason (a term the
  PACKET retired leaves its translated rows stale with no gate to catch
  it). The gate independently verified the edits are correct and complete
  against the authoritative aura.wellFed rows in sim_i18n.ts, and that
  ja_JP and ru_RU already agreed so the three edited locales are exactly
  the drifted ones. Recorded here as the citation the gate wanted; no
  revert, no new blessing sought.
- The gate's own adversarial pass chased four things nobody else had; three
  came back CLEAN and are worth keeping (ONE of them CORRECTED at the QA
  audit: the new Consuming.wellFed field DOES reach the parity goldens,
  because the eating slot IS sampled on checkpoint frames, so the carried
  payload widens farming_session in exactly the two frames that hold a live
  meal; it never crosses the wire, and the composition block above now
  names it), the glossary
  alignment is not one-sided across locales, and src/sim/consuming.ts owes
  no module-table row of its own (that table scopes to SimContext
  importers; the pure leaf imports none and is named inside the wellfed.ts
  row). The fourth was the ci:changed red above.
- Parked-red discipline VERIFIED INDEPENDENTLY, not asserted: the gate ran
  `vitest related` over all fourteen changed source modules, got 24 failing
  files, and matched every one against the 11b parked list plus this
  phase's named 11d reds, confirming none is new and that hud.ts's monolith
  pin passes while the two recorded raises (renderer.ts, online.ts) are
  untouched by this range. It also confirmed tests/guide.test.ts fails with
  EXACTLY the two claimed freshness arms, no third.
- ACCEPTANCE (STEP 5): ten of eleven boxes met as written; three carry
  recorded qualifications, each already in this ledger rather than silent:
  the no-`wellfed`-identifier box is met in its true narrower form (the
  pin asserts `wellfed_<kind>` exists nowhere; the generated wiki SHAPE key
  survives by design), the five-gathering box was resolved COUNT-FREE under
  the addendum's explicit permission with the choice recorded three times
  over, and the only-three-named-reds box carries the in-phase i18n regen
  deviation. The gate judged the count-free resolution the better one.
- WORKTREE HYGIENE, noted by three separate agents: running
  tests/guide.test.ts REGENERATES src/guide/content.generated.ts in place
  and dirties the tree. Every agent restored it; the phase tip is clean and
  the committed artifact stays deliberately stale for 11d.

## Phase 11c QA audit record (2026-08-21, the unification verified; verdict PASS-WITH-FOLLOWUPS)

Session facts: worktree guard passed (EnterWorktree into wocc-masterwrought);
release sync a VERIFIED NO-OP (origin/release/v0.40.0 tip 65b91fa190 already
an ancestor, newest by version sort; no merge, no release-merge-audit owed).
Base: the 11c close tip a9ad2a3dd1 (18 commits over 4f9097858c), tree clean,
tsc clean, ci:changed exit 0 at start; decision 2 read as SETTLED and
EXECUTED before any lane ran. ULTRACODE: yes. Shape: a seven-lane COVERAGE
Workflow (unification, carried payload, ladder, copy and i18n, test
decisiveness, named reds, cleanup), the five mutating or regenerating lanes
each in their OWN throwaway detached worktree at the tip with node_modules
symlinked and the read-only lanes on the real tree (zero cross-lane leaks,
the real tree clean throughout); the five matrix reviewers (architecture,
cross-platform-sync, frontend-seam, content-obligations, qa-checklist)
dispatched fresh over the immutable range; a verify stage of four
adversarial verifiers over the should-fix findings; then the fix round with
its own two fresh reviewers. Delivery: 7/7 lanes, 5/5 reviewers unprompted,
4/4 verifiers (11 workflow agents, 0 errors, 0 empty results).

### What the audit PROVED (the phase goal, each with the evidence that carried it)
- ONE system: one def field FoodItemDef.wellFed; one mint (src/sim/wellfed.ts
  is the only applyAura on the id); one exported WELL_FED_AURA_ID; the
  clear-then-grant order at the updateRegen completion site with its reason
  comment; the retired inline block in combat/auras.ts and the elixir-view
  twin GONE; hud.ts one import and one call; one AURA_NAME_KEY row; every
  lowercase `wellfed` hit classified (the wiki SHAPE key by design, the module
  and test filenames, the parity beat labels, comments, test-local names)
  with no lowercase def read in live code; the `wellfed_` id prefix nowhere
  outside the sweep's own prose and the un-re-recorded farming_session golden.
- THE CARRY, mutated in an isolated worktree: deleting the builder carry
  reddens 20 tests in 5 files; the OLD hand-built feast bite without the carry
  reddens the feast-versus-bag identity pin AND the writer sweep (8); the bite
  served as 'drink' reddens 7; a hand-built items.ts arm that KEEPS the carry
  still reddens the source sweep while behavior stays green (2); dropping the
  kind half of the builder guard reddens 1. Exactly two real writers, both
  through buildConsuming; the two dev freezes hand-built by design (named in
  the ledger and the builder header); the wire untouched (eat:{remaining}
  only, nothing in src/net or server/ reads wellFed).
- THE LADDER, recomputed from the LIVE catalog: farm dishes 2/3/4/5 at 600
  (all buff_sta), apex plates 6/900 (buff_sta / buff_ap / buff_int), the apex
  strictly dominant on both axes with the farming top exactly one below,
  harvest_feast serving the 5/600 dish, ironhusk_flask 15/1200: FLASK 15 PLUS
  FOOD 6 EQUALS 21 STAMINA, untouched. The apex 900 is derived live, 600 plus
  (venomfire 900 minus boar 600). Seven mutations (a fifth dish at 6/600,
  5/900 and 7/600; the apex duration back to 600; a 1500-hp farm dish; carrots
  2 to 3; greens 5 to 4) each reddened the arm named for it, so the sweeps are
  live, not pasted. The CUT arm of the QA spec is moot (decision 2 was TAKEN).
- THE PINS, mutated: the identity pin against the literal (5 red under
  'well_fed2'); the clear-then-grant swap (1 red, the order pin at the new
  site); the per-kind id regression (16 red incl. both exclusivity cases);
  the Laden Hearth pairing on BOTH inputs (stationType and
  STATION_TYPE_BY_CRAFT); the namespace sweep (a quoted literal reds, the
  same literal in a comment stays green); the writer sweep on both hand-built
  shapes; the ITEMS alias key; the bed moved above the feast; the
  @ts-expect-error narrowing pin load-bearing (TS2353 when removed); the hud
  double-wire reddening the exact-count source pin; every deleted it() in the
  ten rewritten files has a named replacement.
- THE NAMED REDS: tsc clean; the STEP 3 list (23 files, 604 tests) green
  except recipe_economy's two 11b-parked count pins; the parity suite EXACTLY
  the 69 golden compares (a7 b4 c2 d4 e19 f1 g32) with coverage_a/b/c and the
  harness green; tests/guide.test.ts EXACTLY the two freshness arms; vitest
  related over the 27 changed modules ran 1825 files / 27989 tests with 107
  failures in 24 files, EVERY one classified (69 goldens + 2 guide + 28 count
  pins + 7 art census + 1 fingerprint), NO fourth red; no golden and no
  content.generated.ts in the diff; TURBO_FORCE=1 i18n:gen byte-fresh at the
  tip; ci:changed 0; 18 commits with bodies, no trailers, zero em/en dashes
  or emoji in added lines. The farming_session composition was RE-PROVED by
  a scratch UPDATE_PARITY re-record of shard g: the six rows moved exactly as
  predicted, draws 110/110, drawDigest fcb50df1 both sides, zero rng movement
  across all 32 shard-g goldens; the composition block above was then
  COMPLETED with the movements the re-record also carries.

### Findings and what the fix round did with them (every one applied or dispositioned, none dropped)
BLOCKING: none.
SHOULD-FIX, APPLIED:
- The Consuming record was not kind-scoped while the mint's header claimed
  "types beat guards" (architecture): Consuming is now FoodConsuming |
  DrinkConsuming, the builder branches on the kind, the completion site
  narrows on c.kind, the claim is true at the def AND the record, a
  DrinkConsuming @ts-expect-error pin twins the def pin (67943f544c,
  407968806d).
- No literal pin on the minted record's school 'nature' and self-source
  (carried-payload lane, CONFIRMED by its verifier; the identity equality
  compares two mints and is blind to both-sides drift): the literal record
  pin in tests/wellfed.test.ts and the bite-side anchors beside the identity
  pin; both mutations now red (407968806d).
- The writer sweep was blind to an intermediate-variable build (CONFIRMED):
  the Consuming-SHAPE arm counts `ticksElapsed:` literals across src/sim
  outside the builder and pins exactly the two dev freezes, with negative
  self-proofs; the opener accepts a quoted slot (407968806d).
- The farming_session composition handed to 11d was INCOMPLETE and the gate's
  "sample no eating slot" claim was false (named-reds lane, CONFIRMED):
  both trued in the ledger above (the eating.wellFed rows in frames 96 and
  119, hp/maxHp and sta in the six aura frames, the craftDaily/wyrmfallDaily
  keys in 23 frames, the two events digests, sourceId +4, nextId unmoved in
  this file, the delta-of-300 as the carry proof with the 320 broken-case
  signature).
- The cooking identityBody still called the apex plates "the only food that
  leaves a Well Fed buff" (cross-platform WARNING, the ladder lane's
  should-fix; its verifier REFUTED it as 11c's on scope grounds, judged HALF
  RIGHT here: the cooking-versus-farming page contradiction predates 11c and
  Phase 16 owns the one-explanation coherence pass, but the clause became
  false in LIVE behavior the day 11c made the farm dishes mint, so the one
  clause was fixed now, English plus the five non-Latin overlays, and 16's
  pass stands unchanged) (2de3231104).
- useFeastBuff / useFeastBuffAura omitted the one-at-a-time rule the
  unification made universal (content WARNING): appended, per locale
  byte-identical to the surviving wellFed rows' clause; frozen renders
  re-pointed (2de3231104).
- The wiki effect cell spelled "Well fed" against the proper noun everywhere
  else (frontend should-fix, content INFO): capitalization trued; the
  non-Latin rows already carry the term (2de3231104).
NITS, APPLIED: the last spelled gathering count in scripts/wiki/
build_content.mjs; the exactly-one-line source pin widened to any argument
list plus a composed-output arm (tests/wellfed_tooltip_composition.test.ts,
happy-dom, the rendered tooltip for a farm dish and an apex plate); the
non-food probe list regains the flask/scroll/potion/drink siblings; the
namespace sweep's vacuity floor per root; the exclusivity cases count the
family by name; fullAtMint asserted outright; the builder carry pin's
precondition; the ledger truings above (hud.ts net-zero, the line count
dropped per the anchor rule, "the one re-typing" narrowed, three overlays
not five, the RELEASE-FILL block trued to the rows that exist,
ConsumableDefFacts named); the stale comments in feast_tooltip_view.ts,
wellfed.ts ("copied off"), sim_i18n.ts, icons.ts, farm_recipes.test.ts, the
builder header's src/sim scope, profession_items.ts's 17-stamina phrase, the
flask-band test naming the bear's duplicate rung.
DECLINED WITH REASON: a feast-dish-strictly-below arm on the dominance sweep
(architecture note): the shared feast is a delivery VEHICLE whose dish is
already in the sweep, and 11k's apex feasts will serve the apex plates by
design (equal to the apex, never above), so the arm would red the day 11k
ships; recorded in the sweep's own comment so nobody adds it.
RECORDED, NO CHANGE: TimedStatBuffPayload.kind is the full AuraKind
(pre-existing, shared with the elixir family, carrier set pinned to seven);
the wellFedAura fallback reads "Grants Well Fed" now that every record's aura
is 'Well Fed' (the never-silent degradation path, no live kind off-map); no
interact affordance says whether a press hits the feast or the bed
(gameplay ruling 11b-R3c-1, both directions pinned); the consumable ladder
has no docs/design home, its derivation lives in this PRD, the def comments
and the pins (maintainer call); the one unscoped commit subject
(f7ae712c01, immutable); the harness noise of a related-set suite trying to
git-checkout the gitignored i18n.status.summary.json (left nothing dirty).
PHASE 16 CARRY (in-packet, not a future-PR item): the wiki's one-at-a-time
statement and the ONE well-fed explanation across the cooking and farming
pages (the coherence pass phase-16-polish.md already owes).

### The fix round (commits, validation, review)
- 67943f544c fix(sim), 407968806d test(sim), 2de3231104 fix(ui) (the i18n
  regen rides the third; no key added or removed, translation_keys unchanged).
- Pre-verified in a throwaway worktree before touching the real tree, then
  on the real tree: tsc clean; 35 suites / 1089 tests green (plus the three
  release-tier skips) over the affected set including the new composition
  test and every Consuming-literal suite; tests/i18n_resolved_equivalence
  green after the regen commit; biome error-free over the 19 changed source
  and test files; ci:changed exit 0 after the LAST code commit (740 files).
- Fix-round review (fresh eyes over a9ad2a3dd1..2de3231104): two fresh agents over a9ad2a3dd1..2de3231104, a general correctness/coverage reviewer and the test-coverage auditor. General: 0 blocking, 0 should-fix, 3 nits (the shape arm blind to the shorthand property spelling with an over-claiming comment; two comments still spelling Consuming.wellFed; commit subjects of 87 to 104 characters, optional), plus two pre-existing observations (the 11b-parked renderer.ts/online.ts ceilings; the happy-dom Hud.prototype idiom's ECONNREFUSED noise, inherited and not added). Test-coverage: 3 should-fix (the tests/ vacuity floor at 2500 could not catch a single-level collapse, which leaves about 2780 files; the negative namespace sweep had no positive needle control; the retitled non-food tooltip claim was unpinned, every probe returning through the payload gate), 6 nits (the single-overwrite case lacked the by-name arm; the composition count could miss a second line without the label; no sim-level drink-completion arm; the spread-built evasion of both sweep arms; toMatchObject is partial and the id key tautological inside it; the html += prefix residual, backstopped by the composition test; the farm comment's global-21 sum unpinned), and six mutation recipes. ALL applied in e4ccbe659c (the tests/ floor at 3000 plus NESTED per-root counts pinning the recursion directly; a positive needle control built from parts; the kind gate pinned with a drink record smuggling a payload past the type; a real gulp to completion mints nothing; the by-name arm on the overwrite case; the bare term bounded at exactly two; the shape arm counting the shorthand spelling with the spread evasion named as stated reach; the two spellings trued) except: the commit-subject length (recorded, no history rewrite on SHAs already cited; later subjects short), the toMatchObject keys tightening (the comment made honest about the partial match instead), and the global-21 sum (recorded as unpinned: both operands are pinned in masterwrought_budget, the sum and its globality are a comment claim). The recipes were then RUN in a throwaway worktree at e4ccbe659c: collapsing the union (DrinkConsuming regaining wellFed) reds tsc with TS2578 at the new directive; doubling the hud call reds exactly 3 (the source pin and both composition counts); a foreign tt-desc div inserted between the restore line and the call reds ONLY the adjacency arm (2 cases); an intermediate-variable build in items.ts reds ONLY the shape arm while the opener arm stays green (the arm's whole justification); a second applyAura under well_fed_extra reds ONLY the three by-name arms, each as 'expected length 1 but got 2', the claim those cases are named for; baseline green after every restore.

### Handoff to 11d: the named reds restated verbatim (two classes, not three)
1. tests/parity: the 69 golden compares (parity_a 7, parity_b 4, parity_c 2,
   parity_d 4, parity_e 19, parity_f 1, parity_g 32); re-record via
   UPDATE_PARITY under the 11d instruction, checking farming_session against
   the completed composition above (the delta-of-300 carry proof, the
   eating.wellFed rows in frames 96 and 119, hp/maxHp and sta in the six aura
   frames, the craftDaily/wyrmfallDaily keys, the two events digests, sourceId
   +4; drawDigest fcb50df1 unchanged; zero rng movement anywhere is the bar).
2. tests/guide.test.ts: the two freshness arms (the regen-diff arm and the
   C10 effect-row mirror); after npm run wiki:content the shape carries SEVEN
   wellfed cells reading 2/10, 3/10, 4/10, 5/10 and 6/15 three times.
The i18n regen is NOT a named red: discharged in 11c and again in this QA
round; 11d's npm run i18n:gen must produce a ZERO diff (the 11d phase file
carries the dated note). The 11b parked list (count pins, art census, the
renderer.ts and online.ts ceilings, the farm_props fingerprint) is unchanged
and 11d-owned. Close tip e4ccbe659c.

## Phase 11d ledger (2026-08-21, derived artifacts; predictions written BEFORE observation, appended as units land)

### Blob-suite predictions (written before any run of the two suites)
Restore executed FIRST per the amended 11b count-pin row: farming's coverage
from 8cd964d599 is back in both files before any number moved ('farmPlots' in
both PROFESSIONS_BLOB_FIELDS lists and the roundtrip sweep, the ceilingSim()
every-bed evergarden_greens fixture with its two derivation throws, the
single-plot roundtrip fixture with the anchor-of-1 doctrine), UNIONED with
ours' craftDaily/wyrmfallDaily/emberWeekAnchor coverage; the roundtrip
farming fixture takes the FRACTIONAL 12.5 (not farming: 0, which the
normalizer restores on a dropped key, the 11b QA migration instruction), and
the clamp arm gains farming 999 -> 100 (farming's maxSkill, read from
src/sim/content/professions.ts).
- tests/professions_blob_roundtrip.test.ts: predicted GREEN as restored (no
  count literal; the field sweep now covers craftDaily AND farmPlots; the
  same blob holds a plot and a craftDaily stamp).
- tests/professions_blob_growth.test.ts settled-bytes prediction, derived
  from the parents' own recorded chains (both anchored at the shared 9,451
  phase 20 density measure): ours 10,949 (delta +1,498: jewelcrafting 9,734,
  inscription 9,889, intermediates+craftDaily 10,224, ph08 10,499, ph09
  10,756, ph10 10,949); theirs 14,218 (delta +4,767: fifth-profession key
  9,497, farm plots 13,948, Phase 3 QA 13,994, Phase 5 ladder 14,218).
  PREDICTED merged settled = 9,451 + 1,498 + 4,767 = 15,716, small
  cross-terms allowed (a farming oncePerDay recipe joining the craftDaily
  stamp, JSON separators). Ceiling re-mint at the next round step above the
  measurement (predicted 16384); the two-sided tracking band re-centers at
  measured +/- 160 per the file's own doctrine. Parent bounds for the ledger:
  ours ceiling 12288 band 10789..11109; theirs ceiling 15360 floor 13952
  (measured 14218, ~203 B per bed at full width, 23 beds).
- OBSERVED (after the predictions above were written): roundtrip GREEN as
  predicted (2 tests). Growth measured 16,206 settled bytes against the
  15,716 prediction; the +490 is EXPLAINED AND NAMED, not pasted over: 433
  bytes are the FOURTEEN farming recipe ids (the 13 FARM_RECIPES rows plus
  recipe_growth_tonic, 391 id chars plus JSON overhead) that joined
  knownRecipes AFTER farming's Phase 5 re-measure and rotted inside
  farming's one-sided band (farming's note chain counted only the three
  HOE_RECIPES ids; verified by diffing recipe ids base..theirs: 17 added,
  3 counted), and ~57 bytes are intra-band drift on both parents' last
  measurements (each note lags its tree inside its own band by design).
  Exactly ONE oncePerDay recipe exists on the merged tree (ours'
  recipe_quickening_catalyst), so craftDaily contributes no cross-term.
  Ceiling re-minted 17408 (17 KiB), NOT 16384: both parents' own re-mints
  left over 1 KiB of headroom (ours 10,224 -> 12 KiB; farming 14,218 -> 15
  KiB) and 16,384 would leave 178 bytes, thinner than the band; the
  two-sided band re-centers 16046..16366. Both suites green (11 tests).

### Unit 4 prediction table (written BEFORE any count-pin suite ran; every
### literal read off the three refs with git show in the main loop this
### session; base e56707a675 / ours d5304a78c4 / theirs 8cd964d599)
| pin | base | ours | theirs | PREDICTED merged |
|---|---|---|---|---|
| world_api_parity IWORLD_MEMBERS.length | 323 | 324 | 331 | 332 |
| world_api_parity DATA_MEMBERS.length | 86 | 86 | 88 | 88 |
| world_api_parity METHOD_MEMBERS.length | 237 | 238 | 243 | 244 |
| world_api_parity FACET_MEMBER_ARRAYS keys | 33 | 33 | 34 | 34 |
| world_api_parity union before/after dedup | 323 | 324 | 331 | 332 both |
| command_schema EXPECTED_SEND_COUNT | 199 | 200 | 204 | 205 |
| command_schema EXPECTED_DISPATCH_COUNT | 212 | 213 | 217 | 218 |
| command_schema EXPECTED_DISPATCH_ONLY_COUNT | 13 | 13 | 13 | 13 |
| deeds_content DEED_ORDER.length | 273 | 279 | 280 | 286 |
| deeds_content total renown | 3155 | 3235 | 3190 | 3270 |
| deeds_content byCategory.progression | 57 | 63 | 59 | 65 |
| deeds_content byCategory.chronicle | 49 | 49 | 53 | 53 |
| deeds_content byCategory.collection | 37 | 37 | 38 | 38 |
| deeds_content byCategory others | 10/31/13/35/18/11/3/9 | same | same | same (sum 286) |
| deeds_content titles (x2 lines) | 42 | 44 | 43 | 45 |
| deeds_content borders | 4 | 4 | 4 | 4 |
| deeds_content DEED_ORDER[len-1] | exp_dawnhold_castle | prog_grandmaster_inscription | prog_farming_100 | prog_farming_100 (11b RULE 1: farming block LAST; not a numeric compose) |
| deed_i18n manifest.length | 273*2+42 | 279*2+44 | 280*2+43 | 286*2+45 = 617 |
| deed_i18n title rows | 42 | 44 | 43 | 45 |
| deeds_view visibleTotal | 260 | 266 | 267 | 273 (= 286 - 9 hidden - 4 visible-shelf feats; merged deeds.ts read: hidden 9, feat-flagged 5 with col_reliquary_complete the off-prefix Collection feat and one feat also hidden) |
| deeds_view categories visible sum | 264 | 270 | 271 | 277 (= visibleTotal + 4 feat-flagged shelf rows) |
| deed_icons DEED_ORDER length | 273 | 279 | 280 | 286 |
| deed_icons DEED_IMAGE_IDS.size (painted) | 271 | 277 | 272 | 278 |
| deed_icons DEED_ART_PENDING | 2 | 2 | 8 | 8 (cross-check: 286 - 278 = 8) |
| reliquary_content overview full | 340 | 344 | 341 | 345 |
| reliquary_content character completion | 311 | 315 | 312 | 316 |
| reliquary_content slot total | 375 | 379 | 376 | 380 |
| reliquary_content distinct mark ids | 29 | 31 | 29 | 31 |
| reliquary_content horizons_titles page rows | 40 | 42 | 41 | 43 |
| profile_page catalogTotal | 311 | 315 | 312 | 316 |
| material_taxonomy_bootstrap MATERIAL_ITEM_IDS.size | 55 | 66 | 82 | 93 |
| material_taxonomy HONEST_MATERIALS | 55 rows | 66 rows (+11 masterwrought intermediates) | 82 rows (+27 farming junk: 8 crop trios seed/produce/fine + withered_husks + compost + growth_tonic) | 93 rows, sorted union (no deletion on either side) |
| material_taxonomy ALLOWED_UNCLASSIFIED_JUNK | 6 | 6 | 7 (+harvest_feast) | 7 |
| material_taxonomy VENDOR_STAPLES | 6 | 6 | 6 | 6 (untouched) |
| recipe_economy vendor-fed sorted membership | 6 rows | 6 rows | 7 rows (+recipe_bronze_hoe) | 7 rows, floor 7 |
| recipe_economy trainer-acquisition sum arm | base form | +JEWELCRAFTING/INSCRIPTION/INTERMEDIATE arms | +HOE_RECIPES.length +FARM_RECIPES.length in the sum, +HOE_RECIPES toHaveLength(3), +FARM_RECIPES toHaveLength(14) | both sides' arms composed |
| sfx_manifest keys.size | 265 | 265 | 270 | 270 (VERIFIED green at unit 1; zero-diff regen) |
| FROZEN_CATALOG_SHA256 | 36e9f307.. | ea007571.. | 3bc5bc55.. | re-minted LAST from the suite output after every count above is green (not arithmetic; matches neither parent) |
NOTE on the phase file's worked reliquary derivation: its "slot count 380
(375 + 4 + 1)" read 375 as ours; the direct read shows base 375, ours 379,
theirs 376, so the SAME prediction (380) comes out of the honest arithmetic
375 + 4 + 1 with base read directly. No prediction changed by the re-read.
The deeds_view "ours 279 - 4 - 9 = 266" arithmetic is confirmed with the
feat term meaning the 4 VISIBLE-shelf feat-flagged rows (feat: true count
is 5 at every ref, constant; one is hidden).
Farming assertion BLOCKS composed alongside the literals (not count pins,
listed so the diff is accounted): deeds_content gains theirs' count-form
gathering describe, the farming teaching-ceiling arm, the (bo) tier-3/4
seed dormancy honesty arm, golden_harvest in the gather_event mark list,
the farm: mark namespace arm and both FARM_CHRONICLE_ZONES sweeps;
recipe_economy gains theirs' comment recuts beside the sum arm.

### Unit 4 observed (every suite run AFTER the table above was written)
PREDICTED == OBSERVED for EVERY pin in the table: world_api_parity
332/88/244/34 and both union arms 332 (346 tests green, including the NEW
facet-directory sweep adopted from the 11b QA parity reviewer: every
src/world_api/*.ts file except appearance.ts, whose header records the
no-facet design, must be a FACET_MEMBER_ARRAYS key via the mechanical
camelCase-to-snake_case conversion, with a 34-file floor); command_schema
205/218/13; deeds_content 286 / 3270 / progression 65 / chronicle 53 /
collection 38 / titles 45 / borders 4 / tail prog_farming_100 (the tail
slice literal composed ours' six craft milestones then farming's seven
rows, matching the merged table order); deed_i18n 617 (286 * 2 + 45) / 45;
deeds_view 273 / 277; deed_icons 286 / 278 (pending 8 by the 286 - 278
cross-check); reliquary_content 345 / 316 / 380 / 31 / horizons_titles 43;
profile_page 316; material_taxonomy_bootstrap 93; material_taxonomy
HONEST_MATERIALS the 93-row sorted union (ours' 11 + farming's 27 adds,
zero deletions on either side) with ALLOWED_UNCLASSIFIED_JUNK 7
(+harvest_feast); recipe_economy vendor-fed 7 rows (+recipe_bronze_hoe,
floor 7) with the trainer-sum arm carrying BOTH parents' recipe-set terms
and farming's HOE 3 / FARM 14 pins; sfx keys.size 270 (unit 1). Blob suites
per their own block above. FROZEN_CATALOG_SHA256 re-minted LAST, after
every count went green, via the suite's own one-liner:
560f0e188136f8e636419f97d55c5c8d641ff9a57707083c6c88392c837bd525 ("no
shipped trigger or renown changed; both parents reproduce their own priors
exactly; the merged hash is re-minted from the suite output"). Farming's
assertion BLOCKS composed alongside (the count-form gathering describe, the
farming teaching-ceiling arm, the (bo) seed-dormancy honesty arm, the farm:
mark namespace arm, both FARM_CHRONICLE_ZONES sweeps, golden_harvest in the
gather_event list). Full set: 687 tests across the 13 suites, green; tsc
clean; biome zero errors (9 pre-existing-class warnings).
COUNT_PIN class count CORRECTED per ruling 11d-U4-MATTAX: the 13-file class
is 12 count-pin files (material_taxonomy.test.ts is exact-set equality plus
membership and class-exclusion arms with zero count literals, resolved by
re-deriving its sorted literal; material_taxonomy_bootstrap.test.ts IS the
count pin at MATERIAL_ITEM_IDS.size); the 13th file of the conflict class
is tests/monolith_budget.test.ts, which unit 6 owns.

### Unit 6 predictions (decision 4 as SETTLED 2026-08-20 and AMENDED by 11b's
### observed counts; written before the monolith suite ran at this tip)
Parent pins (ceilings) base/ours/theirs, from the 11b baseline block,
re-confirmed against the refs: hud 19387/19445/19186, renderer
13744/13546/13774, sim 12660/12650/12232, main 11490/11516/11460, game
10900/10890/10900, online 5950/5950/5950, music 5470, world 5450, db 4980,
foliage 4147, colliders 2660. The release sync adds a THIRD parent pin for
hud.ts: 19487 at f50b30de29 (the release lowered its own 19490 by the
makeReliquaryTrackerInput extraction; the sync kept ours' 19445 row and
unit 6 re-pins at the exact merged count).
Merged wc -l at this tip, with the composition arithmetic: hud 19248 (the
hand-merged file measured 19251 at 11b, 11c net-zero, the release sync -3);
renderer 13576 = 13546 + (13774 - 13744), exact; sim 12341 = 12518 + 111 -
289 + 1 (the one 11c QA comment line); main 11480 = 11490 + 26 - 36,
exact; game 10761 = 10894 - 32 - 101, exact; online 5967 = 5855 + 47 + 65,
exact; music 5270, world 5301, db 4865 (= theirs, ours untouched), foliage
4131, colliders 2590, all sides composing.
THE ROWS: TWO RECORDED RAISES, renderer.ts 13546 -> 13576 (+30 against
ours' pin, a FALL of 198 against farming's own 13774; farming's deviation
(an) raised the same +30 for its farm-visual wiring at the correct seam,
confirmed thin wiring by the 11b frontend reviewer) and online.ts 5950 ->
5967 (the fifth-monolith case, ruling 11d-U6-FIFTH: +17 against BOTH
parents' identical 5950 pins, merge-attributable, base 5855 + ours' 47 +
farming's 65 composing exactly). Payback for both raises NAMED: Phase 16
(the packet's polish phase), scoped to merge-attributable growth only.
TWO FALLS re-pinned at the exact count with the direction recorded: sim.ts
12650 -> 12341 (the 11b-qa-B8 second-arm row executed: the pin sat 309
over the file with no comment; the two-extraction history, F14's B7/B8
ratchet 12249 -> 12235 -> 12232 on farming's side and ours' own 12650, is
written into the row) and main.ts 11516 -> 11480. hud.ts FALLS 19445 ->
19248 (both packets' extractions stack; there is no raise and the
11d-U6-PAYBACK Phase 14 target of "19445 or lower" is ALREADY MET at this
tip; Phase 14 still may not grow the file back, and the
professions-module migration counts for nothing, a file move relocating
zero lines). Every other row keeps its pin with slack under the honesty
arm's 400: game 129, music 200, world 149, db 115, foliage 16, colliders
70. Predicted suite outcome after the re-pins: monolith_budget green
including the honesty arm.
- Unit 6 OBSERVED: after the re-pins the suite runs 13/13 green including
  the 400-slack honesty arm; every changed row's observed wc -l equals the
  predicted count above (hud 19248, renderer 13576, sim 12341, main 11480,
  online 5967); the raises are exactly the amended decision's set (TWO:
  renderer.ts, online.ts), the falls re-pinned zero-slack (hud.ts, sim.ts,
  main.ts), and every other row keeps its pin with sub-400 slack. Committed
  as the unit 6 commit after the census lands in position 5.
- Unit 2 bijection (both directions, by count): 67 static scenario name
  literals + the hit_rating_heroic geared/ungeared ternary pair = 69
  runtime scenarios == 69 golden files; zero scenarios without a golden,
  zero goldens without a scenario; farming_session (record index 62) and
  rift_clear_rewards (record index 67) both land in shard parity_g under
  SHARD_BOUNDS [0,7,11,13,17,36,37,len]. Composition re-run PASS on the
  COMMITTED goldens after the unit 2 commit.

### Unit 5: the export and symbol census (the phase's most important deliverable)
Landed as scripts/merge_audit/symbol_census.mjs (+ .d.mts) with
docs/prd/masterwrought/merge-deletion-list.md and the fixture suite
tests/merge_audit_symbol_census.test.ts. THREE-PARENT MODEL: parents = ours
UNION theirs UNION the release tip f50b30de29 (the Phase 11d STEP 0 sync;
prior synced tip 65b91fa190), with every later first-parent merge after the
absorb commit 424ce89a20 contributing its second parent automatically so
Phase 17 re-runs it flag-free; parent blobs read via git ls-tree plus one
cat-file --batch per ref, nothing checked out. FINAL RUN at tip 1900e38210,
exit 0, RESULT PASS:
- exports: ours 17329 / theirs 16921 / release 17221 / union 17582 / merged
  17583; MISSING 0; EXTRA 6, ALL explained (WELL_FED_AURA_ID,
  applyWellFedOnMealComplete, FoodConsuming, DrinkConsuming,
  ConsumableDefFacts, buildConsuming: exactly the 11c-authored set,
  predicted six for six); deletion-list hits 5 (the two 11c renames
  wellfedTooltipLines -> wellFedTooltipLines and
  applyWellfedOnConsumeComplete -> applyWellFedOnMealComplete, plus the
  release's TerrainChunk trio renamed by 23b31303ec, theirs-only because
  theirs predates the whole v0.40.0 line).
- content ids: 2958 / 2913 / 2810 / union 3061 / merged 3061; MISSING 0;
  EXTRA 0.
- i18n keys: 18008 / 17984 / 17866 / union 18161 / merged 18158; MISSING 0;
  deletion-list hits 3 (the 11c-A4-KEYPAIR pair useWellfed/useWellfedAura;
  sim.rift.detonateHellfireBrand, a phase 03 QA deletion at 8eef8bf81b that
  theirs and the release tip still carry, three-way took ours' deletion).
- SimEvent union 152 / 159 / 152 / 159 merged 159, emits 142 / 148 / 142 /
  148 merged 148; MISSING 0; EXTRA 0. The union discriminates on `type`,
  not `kind` (src/sim/types.ts): the phase file's premise corrected in the
  script's pinned SIM_EVENT_DISCRIMINANT.
- Floors (guard 2) pinned per parent per class (~10 percent under observed),
  all printed and holding; blind spots COUNTED every run (export-star 99,
  non-literal content ids 68, i18n spreads 174, non-literal emits 11).
- MUTATION GUARD (guard 1), EIGHT scratch-copy runs across the two engineer
  sessions, each exit 1 reporting exactly its planted deletion and nothing
  else: castDisplayName (export), WELLFED_STAT_KEYS (export), compost and
  worn_sword (content ids), itemUi.tooltip.wellFed and wellFedAura (i18n
  leaves), deedUnlocked and farmPlanted (SimEvent emits). A control run on
  the unmutated scratch copy passes, so --merged-root itself is proven
  sound.
- Deletion-list corrections found by evidence (recorded in rows, not
  silently): castDisplayName was NOT an export on ours' hud.ts (const
  arrow), a literal-only relocation row; ours' elixir_tooltip_view.ts DID
  export wellFedTooltipLines, so the surviving renamed export is by-name
  ours' and is not EXTRA; the wellfed_<kind> aura ids were a substitution
  template, never a census literal; the release window 65b91fa190..
  f50b30de29 deleted NOTHING in any class (affirmatively verified, 9
  exports and 5 keys added); prog_master_gatherer's 18-locale desc rows
  recorded literal-only for the release fill; worldEntryGpuSettleCoverMs
  verified NOT deleted (a dropped import only, the export survives).
- The fixture suite: 12/12 green, no git, no repo walk; parseDeletionList
  FAILS the census on a row lacking phase/ruling/reason or saying only
  "deleted". Biome zero errors; tsc clean.
INDEPENDENT CROSS-CHECK: the prediction desk re-derived every unit 4 pin
from the refs without sight of my table and confirmed all of them,
including the blob estimate (15,716 derived twice independently) and the
deeds_view hidden-set premise (col_golden_harvest NOT hidden, renown 0
luck rule only: the phase tasking's "hidden and luck classification"
clause was half wrong and the prediction was built from the source read).
Its flags folded here: the scenario counts 67/68/69 in the 11b ledger are
golden FILE counts (SCENARIOS lengths are 65/66/66/67, the two
hit_rating_heroic files riding a ternary); farming's sim.ts ratchet
comment verbatim is the three-extraction narrative ending at 12229 under
ceiling 12232 (the state.md 11b-qa-B8 row's "12249 -> 12235 -> 12232"
figures do not appear in farming's file; the unit 6 row comment is worded
from the verbatim file narrative).
RELEASE-MERGE AUDIT of e0cf44b111 (two independent runs): CLEAN, both. The
merged hud.ts carries all 7 release hunks and every branch hunk (cited by
line in the audit reports); every both-sides file is an exact union; the
i18n merge was REGENERATED not hand-merged (pending.ts +75 rows, all
tracker keys, no reorders; no useWellfed key anywhere at the merge);
injection seams re-bound everywhere (ReliquaryWindowDeps.trackerShown,
makeReliquaryTrackerInput, BOOL_SETTINGS.showReliquaryTracker); zero new
endpoints, zero db-mock sites; the 12 reliquary/tracker/architecture
suites 626 green + 1 skip. Two doc amendments ordered by the audits are
applied in the unit 7 commit (the phase file's unit 6 figures were
pre-sync and hud.ts now has a third parent pin 19487; the i18n
zero-diff note now covers the sync's 5 tracker keys).

### Unit 7 and the phase close (2026-08-21)
- decisions-index.md VERIFIED against the merged tree: the R-namespace row
  (11e-D-F) survived the merge with the docs/design/ widening intact; the
  one missing piece, the reviewer instruction, is now authored in place ("a
  bare packet R-number in source is a FINDING, not a nit"). The admission
  row reads 11b through 11o, FOURTEEN inserted phases, all ADMITTED, citing
  ip-GATE-PAIN, 11m-ADMIT and qr-11o-ADMIT (state.md row 117): verified, no
  restore needed (N1 and N2 stand discharged as verifications).
- The two release-merge-audit doc amendments applied to
  phase-11d-derived-artifacts.md as dated notes (the sync's pending.ts
  motion; the third hud.ts parent pin 19487 with the pre-sync provenance
  figures marked as the 11b record). phase-16-polish.md gains the payback
  carry for the two raises; progress.md carries the 11d row and prose.
- farming/state.md open items: NONE MINTED, stated explicitly rather than
  skipped: the census closed with zero unexplained members, every pin
  matched its prediction or carried a named explanation, and the two
  record truings this phase found (the B8 row's file-vs-progress figures;
  the 11b scenario counts being golden-file counts) are corrected in this
  ledger, nothing left unsettled for the packet.
- DATABASE_URL: `env | grep -c DATABASE_URL` printed 0 at STEP 0, before
  the goldens commit, and before the pins ran; no .env was sourced at any
  point.
- FORWARD CARRY unchanged from the phase file: 11e moves DEED_ORDER to 287
  and total renown to 3275 (deed_i18n 287 * 2 + 45 = 619, DEED_IMAGE_IDS
  and the wave suites following, DEED_ORDER's tail off prog_farming_100),
  and 11g moves both recipe_economy literals by two rows when marsh_rice 2
  plus bog_beet 2 join recipe_seasoned_stock; every named phase re-derives
  by the same predicted-then-observed method. The blob band (16046..16366)
  and ceiling 17408 re-measure at the next authored growth per the file's
  own doctrine; the bed-count and widest-crop throws force the re-read.
- LEDGER CORRECTIONS from the second prediction desk's independent pass
  (2026-08-21, after the pins landed; its whole table matches the committed
  values pin for pin): (1) the unit 4 table's deeds_view parenthetical
  ("feat-flagged 5 ... one feat also hidden") was a comment-counting error,
  the source-text trap striking the reader itself: `feat: true` greps 5 in
  merged deeds.ts but one hit is a COMMENT (the col_reliquary_complete
  off-prefix rationale); the real flag set is 4 at every ref
  (feat_era_cap, feat_book_complete, feat_brightwood_relic,
  col_reliquary_complete), none hidden, and the committed 273/277
  arithmetic (286 - 9 - 4) was already built on 4. (2) The 11b-qa-B8 row's
  "12249 -> 12235 -> 12232" chain is farming's PIN history by commit
  (8caa0c669c, 570fd2c026, 8a7fd2a349), while the file's tip comment
  carries the three-extraction narrative ending at 12229: both records are
  true; the unit 6 row cites the narrative and this line reconciles the
  two. (3) The desk's "still-open monolith reds" flag was read at
  1900e38210, before the unit 6 commit 55714f2350 re-pinned them; green at
  the tip.

### Review-round fix predictions (written before the re-measure)
The DB reviewer's bound-fidelity findings move the ceiling fixture toward
the production shape: F1 adds the FOURTH tool-effect slot (farming became
slottable when the hoe phase lifted its refusal arm; measured 130 B), F2
anchors the every-bed fixture at a fixed EPOCH clock threaded through the
measure arm's three sims (13-digit anchors, measured +16 B x 23 rows =
+368 B; the offline-anchored shape understated production by more than the
band's own width). PREDICTED re-measure: 16,206 + 130 + 368 = 16,704;
band re-centers 16544..16864; the 17408 ceiling HOLDS (704 headroom), no
ceiling movement predicted. The slot-cap pin derives from
GATHERING_PROFESSION_IDS filtered through slotToolEffectRefused with the
literal 4 pinned beside it (predicted-then-observed, and the derived form
cannot self-vacuate).

### Review round (five domain reviewers, COVERAGE prompts; every finding applied or recorded, none dropped)
- MIGRATION: PASS on every mechanism (the merged blob a load fixed point
  with both writers in one blob; farming 12.5 byte-faithful and drop-
  catching; the clamp arm at farming's real cap 100; census provably
  non-mutating; the downgrade record intact verbatim). Two WARNINGs
  APPLIED: the roundtrip suite gains the either-parent-shaped-save arms (a
  farmPlots-less OURS shape and a craftDaily-less THEIRS shape each load,
  settle without resurrecting the absent key, hold every other professions
  field byte-faithful, and re-settle as a fixed point) and the
  wyrmfallDaily/emberWeekAnchor writers now ride the whole-blob fixed
  point with spot pins. INFO applied: the sim.ts farm-plot load comment no
  longer over-claims whole-blob byte equality (relined to hold the
  zero-slack pin); the 11b "REQUIRED_FIELDS" row's real seams are named in
  the corrections above (PROFESSIONS_BLOB_FIELDS x2 and the growth
  survival loop); the plot-at-rest scope note and the mixed-fleet
  documented-rule note recorded as stated.
- GATE-INTEGRITY: PASS (union semantics byte-verified: 0 rows untraceable
  to a parent, 0 invented weights; the table-only-edit adversarial case
  selects full tier on CI and the pins locally). WARNING APPLIED: the
  union tool no longer collapses carried rows to "run <older run>", which
  was FALSE for 27 of the 28 (they were the 2026-08-19 LOCAL measurements)
  and erased the older table's own disclosure; the provenance now carries
  the older table's localMerge forward verbatim, and the committed table
  was re-minted with the honest pedigree chain (partition suite 13/13
  after). INFO applied: the tool's walk now matches the enforcing pin's
  predicate exactly (withFileTypes, node_modules/dist/dot-dirs skipped, no
  symlink follow); the stale-key analysis (4 harmless fallback rows,
  selection-inert via the sequencer's files-driven partition) and the
  coverage recompute (2875/3003 = 95.74 percent, ~23 more unweighted files
  to the floor) recorded; golden_composition.mjs gains its own fixture
  suite (tests/merge_audit_golden_composition.test.ts, 8 arms: composes,
  three-way, presence, RNG MOVED on shared and add paths, the id-family
  classifier including the threat amount-column negative).
- PARITY: PASS (all nine added members traced facet -> both worlds ->
  wire; 205/218/13 re-derived with the test's own regexes; the singular
  activeMobileStationCraft correctly gone; fplot's empty-list delta
  semantics verified deliberate). Two WARNINGs APPLIED: the facet-
  directory sweep now walks through the SHARED walker (ts_files_under, a
  subdirectory move reds loudly) with the scan-guard self-audit
  registered, and a new pin proves every facet interface sits on the
  IWorld barrel extends list (and nothing else does), closing the one
  unpinned hop (348 tests green).
- ARCHITECTURE: PASS, the strongest form: zero rng movement proven against
  BOTH baselines (the ours parent AND the goldens the re-record replaced);
  the whole-table leaf footprint is 4,661 numeric moves, every one exactly
  +4, plus the two named files; the two ours-side draw movers proven
  ours-parent deltas (nythraxis base==theirs 6116/73b08c60, ours 6113;
  professions_craft ours' two added frames). Two SHOULD-FIXes APPLIED as
  ledger truings here: (1) the 11c prediction block's "sourceId 967 to
  971" clause was WRONG twice over: the aura's source is the player, whose
  id does not shift in that file, and the re-record keeps sourceId 967 in
  all six rows (my unit 2 commit recorded this; this line trues the 11c
  block's row so no future reader accepts a +4 there as expected); (2)
  idle_mob_distance_culling's 8 non-id numeric moves are NAMED movement,
  root-caused: the scenario sets idleMobTickRadius, routing passive rolls
  through the private id-seeded idle lane (src/sim/mob/idle_rng.ts seeds
  by mob.id, shifted +4), and the scenario draws ZERO shared rng, so the
  draw digest is structurally blind there: exactly the shape a real drift
  would take in a draw-free scenario, benign HERE because ours kept base
  and merged equals theirs. NOTEs recorded: the composition script's
  theirs-only-add arm asserts rng only (the ledger prediction is the
  authority for farming_session's non-rng rows, all verified item by
  item); the script's default refs are the 11B absorb parents by design
  (the 11d sync was separately proven golden-inert: no tests/parity file
  in the sync, the release's whole sim delta one additive function); the
  "tick-0 nextId 972" phrasing is inexact (34 shared goldens sit at
  967/971, 33 at 968/972; the true invariant, ours == base and merged ==
  theirs == base + 4, held in all 67); the additive-compose and
  min-length-array residual holes recorded for the next re-record's
  reader.
- DB-PERFORMANCE: verdict "6 P2 bound-fidelity findings, none a production
  regression". ALL SIX APPLIED OR RECORDED: F1 the fourth tool-effect slot
  (farming slottable since the hoe phase; fixture + derived cap with the
  literal 4 beside it); F2 the epoch-anchor measure (CEILING_EPOCH_MS
  threaded through the measure arm's three sims); the re-measure landed at
  16,704, EXACTLY the predicted 16,206 + 130 + 368, band re-centered
  16544..16864, ceiling 17408 HOLDS (704 headroom); F3 the rift-payload
  term recorded in the bound note and carried to Phase 12 as bound-policy
  work (phase-12-perfecting.md, both numbers named); F4 the exponential
  survivalRoll width noted at the fixture; F5 logging joins the non-zero
  columns (0.25) with the zero-blindness argument stated once; F6
  craftDaily's structural-vs-content bound gap recorded in the note. Its
  TOAST/WAL assessment recorded: the 17 KiB pin is structurally sane, the
  zero-default omission shape is what keeps write volume sane, and the
  ceiling's job is regression detection.

### Unit 3 record (appended at the QA gate's should-fix: the block was in the
### commit body and progress.md but the ledger is the collection point)
Art census, predicted then observed, EVERY value matching (commit
1900e38210): catalogCount base 823 / ours 907 / theirs 823 -> predicted
907 observed 907 (the 84 = the webps masterwrought added base..ours);
liveItemCount 838/922/838 -> 922/922; pendingArtCount absent/absent/44 ->
44/44 (farming's structural split KEPT: the merge had dropped farming's
pendingArtIds wiring from the builder test, the consistency test AND
scripts/item_art_audit.mjs, restored before minting because the CLI could
not mint without it); catalogBytes 498026; rendererFingerprint = theirs'
84410592.. (the lib was byte-theirs); shippingCatalogSha256 = ours'
71d66ce2.. (the art set unchanged from ours); catalogSha256 minted new
10008819..; groupCount 25, sheetPageCount 29, sheetCount 232, heroic
64/48/16; the verdict JSON re-minted by the tool (d20216e7.., bytes
122036 held) with the accepted-art pointer following by hand as both
parents did. release_v039_icon_art executed 11d-U3-ICON: farming's
art-subject split kept, art-subject 72 -> 75 (the three painted phase-10
role foods) and pending 16, both predicted then observed; nothing
deleted, the assertion generalized.
Eastbrook seals: REAL drift, and it is renderer.ts ONLY (sealed
dfc91472.. -> 6c897bb3..); prewarm_policy.ts and every other swept input
HELD their sealed bytes, so the phase file's "renderer.ts and
prewarm_policy.ts moved" was true against theirs only and the house note
in both suites records the truth. remint_polish_provenance re-swept
24+24+1+1 blocks; composite 9fdb68de.., authority ed4ff972..,
second-order d4aa71b9..; NO capture retaken.
farm_props: remint_lockfile_fingerprints reports hits=0 for ALL 31
other-family GLBs; the farm family alone moved (the merged pnpm-lock.yaml
is 20 lines off farming's), SOURCE_FINGERPRINT re-minted fa800761.., the
16 farm GLBs restamped IN PLACE byte-preserving (set bytes 190488 held;
geometry untouched), the 16 sha256 literals re-pinned, and the media
manifest regenerated by its owning tool, farm entries only. Proof: the 8
suites green TWICE with no edits between runs; deed_icons re-checked in
unit 4 after the deed counts landed.
QA gate verdict (qa-checklist, run LAST after the five reviewers and the
fix round): READY, ZERO BLOCKING; its one should-fix is THIS block; its
independent floor re-ran qa-stop, tsc, ci:changed and 19 decisive suites
(866 tests) at the fix-round tip, all green; its adversarial pass found
no stale artifact, no untouched conflict-class pin file, no TODO in the
new scripts, and no doc contradicting the tree.
