# Phase 03 naming audit (R15): every shipped player-visible proper noun

Audited 2026-08-07 on `feature/masterwrought` (base a2f0082a32). Ruling R15
(`state.md`): never reuse a coined term or full item name distinctive to another
game; pre-existing shipped collisions get display-name-only renames (ids are
frozen and never change). This document is the per-name verdict record the
acceptance checklist requires; the standing authoring-time rule it feeds lives in
`src/sim/content/CLAUDE.md` "Naming originality" and the root `CLAUDE.md` content
bullet.

## Method

- Inventory: 2846 name rows enumerated programmatically from the merged content
  tables plus the resolved English catalog (33 domains: items, mobs, mob
  mechanics, NPCs and titles, quests, zones, POIs, dungeons, delves, abilities,
  classes, item sets, deeds and titles, enchants, mounts, augments, rift themes
  and nouns, delve affixes and companions, professions, tool effects, weapon
  skins and collections, talent specs and masteries, choice rows, sport
  abilities, graveyards); 2605 unique display names.
- Sweep: a 20-agent workflow (19 shards plus the packet naming registry),
  each name web-verified against the WoW, RuneScape, FFXIV, GW2, ESO, Diablo,
  and PoE wikis (exact-phrase plus coined-token searches). Verdicts: GENERIC,
  CLEAR, COLLISION, BORDERLINE.
- Adversarial verify: every COLLISION/BORDERLINE re-judged by two independent
  lenses (distinctiveness, evidence re-verification); four hunter agents
  re-swept all CLEARs plus sampled GENERICs for missed collisions (28 hits).
- Hand judgment: every refuted, contested, and confirmed verdict was re-judged
  by the lead with the evidence open (a refutation is itself a claim), then
  every replacement name was web-verified before adoption (8 of 36 first
  candidates were themselves taken and fell back to verified alternates).
- Behavioral safety: the parity gate's rename state proof
  (`RENAME_PROOF=1 RENAME_PROOF_SECTION="MASTERWROUGHT PHASE 03"`) machine-checks
  that reversing only this slice's tokens reproduces the pre-rename golden
  hashes frame by frame; the golden token inspector reports zero violations
  under the proof-gated flag.

## The bar as applied

1. A coined token distinctive to one game or franchise collides (Eldergleam,
   Nightkin, Wyrmcult, Swiftmend). A full multi-word name whose exact pairing is
   identified with one game, used here in the same role, also collides
   (Crusader Strike as a paladin builder, Cryptbloom as armor, Sanctum Sprint as
   a timed run).
2. Generic words never collide (Iron Sword, Intimidating Shout), nor do idioms
   (Brain Freeze, Die by the Sword, Anger Management), nor terms used across
   many unrelated properties (Chain Heal per Lineage II/Enshrouded, Blazing
   Barrier per EverQuest, Ice Lance per Final Fantasy since 1988, Bonewrought
   per Pathfinder, barrow-wight per the 1869 Morris/Magnusson Grettis saga
   translation), nor real names and places (Morthen, Malric, Varkas, Solheim).
3. Names distinctive only across one COMPANY's franchises still collide
   (Frozen Orb, Glacial Spike, Holy Shock: Diablo II plus WoW, both Blizzard).
4. Zone-level identities hit the phase stopping rule: recorded for the
   maintainer below, never renamed unilaterally.

## Renames applied (52 display strings, ids frozen)

| Old | New | Colliding with |
|-----|-----|----------------|
| Crusader Strike | Oathstrike | WoW paladin builder |
| Heroic Leap | Vaulting Charge | WoW warrior leap (GW2 also owns 'Valiant Leap') |
| Holy Nova | Hallowburst | WoW priest burst |
| Icy Veins | Coldsurge | WoW mage cooldown (and the fansite) |
| Victory Rush | Victor's Surge | WoW warrior heal-on-kill |
| Wyvern Sting | Drakesting | WoW hunter sting |
| Glacial Spike | Rimeneedle | Diablo II + WoW (Blizzard portfolio) |
| Frozen Orb | Frostglobe | Diablo II + WoW (Blizzard portfolio) |
| Holy Shock | Lightjolt | Diablo II + WoW (Blizzard portfolio) |
| Storm Bolt | Thunderhurl | Warcraft hammer-stun, same mechanic pairing |
| Smokestep | Smokefade | RuneScape Smokestep aura (single-game fused coin) |
| Spellbreak | Spellsever | Proletariat's game title Spellbreak |
| Spellsteal | Spellplunder | WoW mage coined fusion |
| Swiftmend | Fleetmend | WoW druid coined fusion |
| Summon Gloomshade / Gloomshade (pet) | Summon Duskmurk / Duskmurk | WoW Gloomshade Grove coinage (SEO-pass adoption the lock screening missed) |
| Wrathwing | Zealwing | Terraria Calamity Mod tier-15 javelin (single-property coin) |
| Flickerstep | Flitstep | Diablo IV unique boots Flickerstep |
| Spiritmend (shaman spec) | Spiritcall | WoW Spiritmend crafted set coinage |
| Hellsteel Sweep | Pitsteel Sweep | WoW Aberrus Hellsteel mechanic identity, same role |
| Hellfire Ring | Pitfire Ring | Diablo III legendary, exact full name |
| Winterbite (skin + mechanic) | Wintergnaw | Destiny 2 exotic glaive (SEO-pass adoption; Wintergnaw's sole prior use is an obscure Warriors of Waterdeep wolf pack, recorded carve-out; Frostgnaw rejected: Genshin) |
| Frostmane Yeti / Mantle of the Frostmane / The Frostmane Tyrant | Rimemane ... | WoW Frostmane troll tribe |
| Nightkin Stargazer (+ 'nightkin' species prose) | Gloamkin Stargazer / gloamkin | Fallout Nightkin |
| Harvest Sprite | Gleaning Sprite | Harvest Moon franchise signature creature |
| Deacon Varric / Varric's Shadow Cowl | Deacon Vandric / Vandric's ... | Dragon Age's Varric |
| Okku | Okrim | NWN2: Mask of the Betrayer bear god Okku |
| Wyrmcult (2 mobs, 4 items + heroics, POI, prose) | Broodsworn | WoW Blade's Edge Wyrmcult faction (Scalesworn rejected: WoW; Broodsworn's one prior WoW shield noted as carve-out) |
| Cryptbloom Shoulderguards | Tombpetal Shoulderguards | RS3 Cryptbloom armor, same role |
| Mistforged Pauldrons | Fogforged Pauldrons | GW2 Mistforged prestige gear prefix |
| Terrorspark Groundshaker (mount + key item) | Dreadspark Groundshaker | WoW rare Terrorspark |
| Gallowmere (hub town, 2 titles, quest + prose) | Gibbetmere | MediEvil's kingdom Gallowmere |
| Eldergleam (hub town, title, graveyard + prose) | Eldershine | Skyrim's Eldergleam sanctuary tree |
| The Moonwell (POI) / A Ripple on the Moonwell (deed) | The Moonspring / ... Moonspring | Warcraft's night-elf moonwell (caveat: Forgotten Realms moonwells predate WC3 by 15 years, Darkwalker on Moonshae 1987; renamed anyway under maintainer strictness) |
| Sanctum Sprint (deed) | Sanctum Footrace | GW2's Sanctum Sprint activity (Sanctum Scramble rejected: also GW2) |
| Knight-Lieutenant (deed + title) | Banneret, superseded at the v0.36.0 merge by Fieldreaver (see the merge supersession section below) | WoW Alliance honor rank 7, same honor-ladder role (Feist/Dragon Age uses noted; the Sergeant -> Knight-Lieutenant -> Field Marshal ladder subset was WoW's) |

Every rename landed as: content def + English catalog together, sim_i18n matcher
rows in the same change (single-line emits preserved), the five non-Latin
overlays refreshed with real translations of the new name (several old non-Latin
rows carried the other game's OFFICIAL localized coins: zh 十字军打击 / 迅捷治愈 /
神圣新星 / 乘胜追击, ko 성전사의 일격 / 신성 충격 / 폭풍망치 / 마법 훔치기, ru
Ледяные жилы), stale Latin overlay rows stripped to pending for the release
fill, guide content regenerated, parity goldens re-minted under the inspector +
state-proof protocol, new literals pinned in `tests/originality_renames.test.ts`,
and the old names armed in `tests/ip_scrub.test.ts` plus the NAME-MAP amendment.

## v0.36.0 merge supersession (recorded at phase 03 QA)

Release/v0.36.0 landed its own IP-safe honor-title re-cut (PR #3133,
maintainer-merged) while this phase was in flight: the whole classic PvP
ladder was re-cut upstream as Sergeant -> Linebreaker, Knight-Lieutenant ->
Fieldreaver, Field Marshal -> Warcrowned, ids unchanged. The release ruling
supersedes this audit's three ladder verdicts: the phase's Banneret never
ships (replaced at the merge by Fieldreaver), and the Sergeant / Field
Marshal GENERIC keeps lost their subjects (both now ship under release-minted
CLEAR names). The three release names carry the maintainer's own ruling and
enter the appendix as CLEAR rows; the release also shipped real translations
for all three in every locale, which refills the 26 knight-lieutenant Latin
deed rows this phase had stripped (ledger obligation counts amended in
state.md). Recorded id-rule keeps from the same merge: the release-baked
shaman clip id Storm_Strike, the murloc/kobold GLB filename families, and
lowercase generic vocabulary in dev comments ("imp") are id or dev surfaces,
not display names, and stay frozen by the same rule that keeps
Nightkin_Attack.

## QA addendum: the domains the enumerator missed (phase 03 QA, 2026-08-08)

The inventory swept content-table and resolved-catalog NAME ROWS, so proper
nouns living in code constants, UI catalogs, and system-message text were never
enumerated: composed rift set-piece names (a noun POOL, not a name row), venue
and event names, service and system brands, and bot opponent name pools. The QA
coverage agent found the class and one live collision in it; every name below
was web-verified at QA (quoted exact-phrase searches, 2026-08-08). These rows
extend the appendix counts.

| Name | Verdict | Detail | Refs |
|---|---|---|---|
| Hellfire Citadel (composed set-piece rift name) | RENAMED | -> Pitfire Citadel (WoW's Hellfire Citadel: the TBC instanced dungeon complex and the 6.2 raid, verbatim, same instanced-PvE role; the Pitfire Ring / Pitsteel Sweep family mapping; pool value display-only, seed math unchanged; pinned in originality_renames) | riftName:infernal (INFERNAL_NOUNS) |
| Infernal Citadel (theme name + composed name) | BORDERLINE (maintainer) | multi-property shared composition, kept under bar rule 2, RECORDED because one hit is same-role: Neverwinter's Infernal Citadel dungeon (Infernal Descent), plus TWW3's Infernal Citadel building and a Roblox map | riftTheme:infernal |
| Brimstone Citadel (composed) | CLEAR | near-hit noted: WoW quest 'Hellfire Citadel: Hellfire and Brimstone'; no game claims the composed name | riftName:infernal |
| Pactbound Citadel (composed) | CLEAR | Warhammer 40k ships a 'Pactbound Zealots' detachment; single-word overlap only | riftName:infernal |
| Ashen Coliseum | CLEAR | the 2018 game 'Ashen' claims no coliseum | venue:arena |
| Thornhollow Fields | CLEAR | Forgotten Realms' two-word 'Thorn Hollow' noted; composed name unclaimed | venue:battleground |
| The Vale Cup | CLEAR |  | event:vale_cup |
| Protect Yumi | GENERIC | escort-mode phrasing over the audited NPC Yumi | mode:yumi |
| Ravenpost | CLEAR | nearest: the unrelated indie 'Ravenhaul'; unclaimed | brand:mail |
| Book of Deeds | GENERIC | plain-English deed-book vocabulary | system:deeds |
| Claudium | CLEAR | own-brand coin | brand:currency |
| Claudemoon | CLEAR | own-brand coin | brand:world |
| Vale Cup bot names (Old Hobb, Reeve Marlow, Tally Cooper, Bess Furrow, Wick Thatcher, Sorrel Dray, Hen Barrow, Pip Osier, Mott Granger) | GENERIC | rustic English trade-name vocabulary; one group row for nine names | bots:vale_cup |
| Fiesta bot names (Sir Botsworth, Botzo the Arcane, Sneakbot) | GENERIC | joke coinages; one group row for three names | bots:fiesta |

Also recorded at QA: the dead `detonateHellfireBrand` catalog key (no emit
anywhere in sim or server) was stripped with its matcher rule and locale rows
under the residual-coin precedent; its three dead siblings (detonatePactSeal,
detonateBloodRite, detonatePitSentence) carry no coin and are left for a
cleanup phase. The non-English overlay surfaces gained their own guard,
tests/overlay_ip_scrub.test.ts (coin denylist over every overlay, deed chunk,
and sim matcher value, plus per-locale script-family checks), because both QA
blockers lived where ip_scrub and originality_renames cannot see.

## Registry verdicts (the packet's new names)

Confirmed as authored (21 of 24): Masterwrought, Perfecting, Wyrmfall Core,
Sundered Essence, Maker's Ember, Apex Patterns, Duskforged Billet, Forgefold
Plating, Quickening Catalyst, Seasoned Stock, Lucent Reagent, Ridgebreaker,
Gyrelens Array, Master's Field Forge, Voidbound Grimoire, Grand Cauldron, The
Laden Hearth, Deed of Making, Lucent Infusion, Precision Chassis, Sablewax
Vellum.

- AMENDED: Prismstone Setting becomes **Prismglass Setting** (FFXIV ships a real
  'Prismstone' gatherable crafting material in the same component role, plus
  WoW's Prismstone Ring; Prismglass verified zero-hit).
- KEPT with recorded caveats: **Wyrmhide Cording** (Wyrmhide is a Diablo II
  armor base AND a WoW arena-set family: cross-franchise material vocabulary,
  full name unused anywhere); **Sunspun Bolt** (Sunspun's only usage is FFXIV's
  cash-shop Sunspun Cumulus mount; transparent compound, full name unused).
- MINTED AT PHASE 07: **Sablewax Vellum** (inscription's skill-75 intermediate;
  the registry carried no inscription name). CLEAR, web-verified 2026-08-11:
  zero exact hits for the compound and for the coin Sablewax (searches
  decompose to sable the heraldic ink-black tincture plus wax/vellum, generic
  scribal vocabulary); no registry-coin reuse. Rejected at authoring:
  Nightquill Vellum (Nightquill is a shipped Oaken Tower item plus DQWiki's
  "Nightquill's Award", the Copper Torc rejection class) and Scrivener's
  Vellum (Scrivener and Vellum are both real writing-software products and
  the phrase names their integration). In-repo neighbors checked: no
  "vellum" anywhere prior; quill appears only in the deed names Founder's
  Quill and Quill and Pigment, a different surface.
- MINTED AT PHASE 08 (the ten apex armor names, all web-verified 2026-08-12,
  each by the proposing agent AND an adversarial second pass, plus in-repo
  neighbor greps; new coins are Spiritweld, Wardspeaker, Briarstep, Fenbloom,
  and Barksong):
  - **Spiritweld Girdle** (int-mail waist) CLEAR: coin Spiritweld zero-hit
    everywhere (nearest WoW's Reinforced Spiritplate Girdle, a different
    coin); no weld compound in-repo.
  - **Forgefold Legguards** (str-mail legs) CLEAR: zero new coins, the
    sanctioned family extension of the registry-verified Forgefold with a
    generic slot noun; full pairing zero-hit (nearest WoW Forgehand's /
    Battleforge Legguards, different names).
  - **Wardspeaker Sabatons** (int-mail feet) CLEAR: fused coin Wardspeaker
    zero-hit as any game item (nearest: Pathfinder's two-word Ward Speaker
    samurai ARCHETYPE, outside the seven wikis and a class not an item);
    full pairing zero-hit; recorded adjacency considered and passed: FFXIV
    ships ilvl-1 "Ward Mage's Sabatons" / "Ward Knight's Sabatons",
    two-word possessive forms sharing only the generic ward and sabaton
    vocabulary. ADOPTED OVER the proposing agent's Galerune Treads, whose
    adversarial verdict BORDERLINE was upheld: the web side was clean but
    this game's own Galecall mail-caster epic set (stormcallers display
    family) makes another Gale- compound on mail caster gear read as false
    set membership, the composed-surface confusion class the phase 03 QA
    minted guards for.
  - **Briarstep Jerkin** (agi-leather chest) CLEAR both passes: coin
    Briarstep zero-hit; nearest are WoW's Briarsteel weapons, a different
    compound.
  - **Fenbloom Breeches** (int-leather legs) CLEAR both passes: coin
    Fenbloom zero-hit (fen and bloom are generic marsh vocabulary; GW2's
    Fen Bloom exists only as two separate words in unrelated contexts).
  - **Barksong Handguards** (int-leather gloves) CLEAR both passes: coin
    Barksong zero-hit as a game item token; druidic bark plus song generics.
  - **Sunspun Vestments / Sunspun Leggings / Sunspun Handwraps / Sunspun
    Haversack** (cloth pieces plus the apex bag) CLEAR both passes: zero
    new coins, the family extension of the registry-kept Sunspun (its
    recorded caveat, FFXIV's cash-shop Sunspun Cumulus MOUNT, is a
    different role and does not worsen with generic armor/bag nouns); all
    four full pairings zero-hit.
  - Rejected at authoring: Hexlink Girdle (BORDERLINE: live Hexlink coins
    outside the seven wikis, a Web3 company, a Minecraft Hex Casting addon,
    and the Hex Link mobile game), Anvilmarch Legguards (BORDERLINE:
    phonetic adjacency to WoW's Anvilmar settlement), Galerune Treads (the
    in-repo Galecall adjacency above), Forgefold Waistguard and Forgefold
    Treads (CLEAR but passed over: three Forgefold pieces spanning two stat
    archetypes would read as one matched set with mismatched stats),
    Warhewn Legguards (CLEAR standalone alternate, lost to the zero-coin
    family extension).

## Recorded for the maintainer (stopping rule: no unilateral rename)

1. **Zones and their families.** 'The Amberfall' (RS3 2026 music track, itself a
   typo of 'Amberfell'), 'The Frostveil Reach' (GW2 minor NPC surname), 'The
   Nightbloom' (FFXIV boss theme; WoW also uses Nightbloom), and **Galecrest**
   (zone + stables + graveyard): verifiers confirmed Galecrest as the coined
   sky-world of Stonemaier's board game Libertalia: Winds of Galecrest (2022,
   in the product title). A zone rename cascades through the whole zone
   identity, so it is the maintainer's call; the graveyard 'Galecrest Rest' and
   derived names are kept aligned with the zone either way.
2. **Highwatch** (zone3's hub town + derived item/title names): refuted as a
   TERA coinage (generic high+watch keep-name; Forgotten Realms' fortress-city
   Highwatch 2009 predates TERA's city; Elder Scrolls Arena 1994 surname list).
   Kept; recorded because TERA's hub city shares the name.
3. **Voidscar** (zone + Voidscar Acolyte + Voidscar Handwraps): WoW Midnight
   ships a Voidscar Arena (patch 12.0.1 era, early 2026); our zone shipped
   2026-07-07, months later, but void+scar is cross-property (AoS Voidscarred)
   and the zone is high-visibility. Maintainer's call.
4. **Moonrest** (nightbloom hub): WoW has minor Moonrest subzones; moon+rest is
   a simple compound; kept.
5. **The enchant formula scheme** ('Enchant Gloves - Agility', 'Enchant Ring -
   Strength' are verbatim WoW formula names): the 'Enchant <Slot> - <Stat>'
   scheme is descriptive-functional and the distinctive suffixes were already
   originalized (Runed Sigil, Runed Weave), but the scheme itself is WoW trade
   dress; renaming it is a system-wide convention change, so it is recorded
   rather than done.
6. **Timing-parallel coins** (ours may predate or closely trail the other
   game's): Brutok (our rare elite 2026-06-16 vs WoW Midnight's gronnling),
   Brother Halven (WoW's Speaker Halven, TWW 2024, ultra-minor), Aetherwell
   (FFXIV 7.31 key item 'Aetherwell Array'), Gravelight (Diablo Immortal
   off-hand; operator-adopted at the SEO lock), Summon Emberkin (Pathfinder's
   emberkin aasimar heritage; -kin formation is genre-wide).

## Notable keeps (flagged, then kept under the bar; do not re-raise without new evidence)

Multi-property or pre-existing vocabulary: Chain Heal (Lineage II, Enshrouded,
Roblox DQ), Blazing Barrier (EverQuest fire shields), Ice Lance (FF II 1988
onward), Fingers of Frost (a century of poetic use, de la Mare 1910), Bladestorm
(Koei title, Marvel, GI Joe), Frozen-adjacent D&D SRD names kept where multi-game
(Flamestrike, Ring of Frost, Rune of Power, Mass Barrier, Piercing Howl per ESO),
Bonewrought (Pathfinder), Wildheart/Amberfall/Duskfall/Nightgate/Mournstone/
Wisplight/Coldlight/Stormfeather/Mudfin/Soulrot/Moonrage/Quickblood/Skyrend/
Groveheart/Moongrove/Wildfang/Battlecraft/Bloodrush (minor or cross-property
compounds), Hat Trick Hero (stock sports idiom), Abyssal Maw (D&D monster),
Old Cragmaw (WoW ships its own Cragmaw), Harvest... (renamed), Barrow Wight
(public-domain folklore since 1869), Mana Shield / Arcane Volley / Wicked Slash /
Sweeping Claws / Pristine Hide (descriptive), Skullthump (WoW's is Skullthumper,
no exact token), Phoenix Trance (FF 'Trance' construction, full name unused),
Azgorath's 'Lord of the Pit' epithet (MTG card, compositional phrase), Shadecloak
(Hollow Knight's is two-word 'Shade Cloak'), Nightfang, Summon Warfiend,
Moonkindle, Stormcrag, Cinderbolt, Sethrael's Heartscale, Verlan's Oathblade,
Solheim (real Norwegian place), Morthen (real English hamlet), Malric (real
French surname; Chivalry's king noted), Varkas (real Greek surname; Suikoden's
Varkas noted), Kaldra (real Estonian surname; MTG noted), Korgath (WoW realm
label only), Vael (fan shorthand only, not an in-game name), Brakka, Grix,
Redmaw (HZD machine, different referent), Veilsteel, Soulrend, Stormsunder,
Deepward, Reliquant, Emberwing, Dreamroot Boots, Korgath's Chainwraps, Niela's
Coldlight Band, Reins of the Sky-Reach Stormfeather, Slimy Mudfin Scale,
Morthen's items, Bloodmane items, Voidscar Handwraps (see maintainer list),
Breachmaker (GW2's one-off story drill, different referent), Evergarden /
Nightbloom / Galecrest / Highwatch rest-and-town families per the maintainer
list, Ravenous Frenzy / Intimidating Shout / Seasoned Soldier / Anger Management
/ Brain Freeze / Hot Streak / Ice Floes / Die by the Sword (idioms/descriptions),
Grimfire, Cinderfall, Galeheart, Gladesong, Gorebite, Frostveil (ability),
Smokestep... (renamed), Mindfracture, Mudfin Hex, The Wildheart Basin, The
Amberfall Harvest, Wrathwing... (renamed), Hellfire... (renamed).

## Locale-layer findings (same audit, second surface)

- The v0.29.0-era locale fills had partially regressed the c55bf057c2
  originality rename: 91 overlay rows across 11 Latin-script locales still
  carried other games' coins (de_DE Arkanit/Silberblatt/Thoriumerz officials,
  fused Arkanit/Arcanite/Arcanita loanwords in 9 more locales, it_IT
  Fogliaargento/Polvere Arcana) plus stale guide prose. Stripped to pending in
  commit `fix(i18n): strip residual other-game coins from locale overlays`.
- 219 stale-calque item rows and 23 calque-only prose rows (translations of
  pre-rename names carrying no other-game coin) remain for the release-time
  locale fill, listed in the Phase 03 ledger.
- This phase's renames refreshed the five non-Latin locales in-change (M16) and
  stripped the stale Latin rows to pending (720 rows), the exact c55bf057c2
  protocol; several replaced non-Latin values were the other game's official
  localized coins (see the rename table note).

## Appendix: per-name dispositions (2623 rows)

2623 rows = the 2605 unique inventory names plus one sweep-emitted variant
('Wildheart Basin', shard 10's un-articled duplicate of 'The Wildheart Basin';
kept as its own row so the sweep output reconciles exactly), plus the three
release-minted honor titles adopted at the v0.36.0 merge (Linebreaker,
Fieldreaver, Warcrowned; see the merge supersession section), plus the 14 QA
addendum rows (two of them group rows covering the twelve bot names; see the
QA addendum section).
Counts: RENAMED 53 | BORDERLINE (maintainer) 16 | KEEP (flagged, kept) 95 |
CLEAR 300 | GENERIC 2159. Three pre-QA rows were relabeled at QA with no
rename: Splitshot CLEAR to KEEP and the two Mistveil items GENERIC to KEEP
(known multi-property hits recorded on the rows). The body's Recorded for the
maintainer items now carry the note on their appendix rows too (Aetherwell,
Brother Halven, Brutok Skullsmasher, Gravelight, Summon Emberkin, Voidscar);
the 42 'Enchant <Slot> - <Stat>' GENERIC rows are all covered by the scheme-wide
maintainer record in the body and are not annotated row by row. GENERIC = shared/plain vocabulary (no search hit
claimed); CLEAR = distinctive or coined, web-verified unclaimed by any other
game; KEEP = flagged by a sweep or hunter agent and kept after adversarial
verification plus hand judgment; refs are `domain:id` (display-only, ids
frozen).

| Name | Disposition | Detail | Refs |
|------|-------------|--------|------|
| A Ripple on the Moonwell | RENAMED | -> A Ripple on the Moonspring (World of Warcraft / Warcraft franchise) | deed:chr_nightbloom_first_cast |
| Candlewright of Gallowmere | RENAMED | -> Candlewright of Gibbetmere (MediEvil (PlayStation)) | npcTitle:widow_tansy |
| Crusader Strike | RENAMED | -> Oathstrike (World of Warcraft) | ability:crusader_strike |
| Cryptbloom Shoulderguards | RENAMED | -> Tombpetal Shoulderguards (RuneScape 3) | item:cryptbloom_shoulderguards |
| Deacon Varric | RENAMED | -> Deacon Vandric (Dragon Age) | mob:deacon_varric |
| Eldergleam | RENAMED | -> Eldershine (The Elder Scrolls V: Skyrim) | poi:3.0 |
| Eldergleam Provisioner | RENAMED | -> Eldershine Provisioner (The Elder Scrolls V: Skyrim) | npcTitle:provisioner_fenna |
| Eldergleam Rest | RENAMED | -> Eldershine Rest (The Elder Scrolls V: Skyrim) | graveyard:gy_veiled_hollow |
| Flickerstep | RENAMED | -> Flitstep (see audit body) | ability:blink |
| Frostmane Yeti | RENAMED | -> Rimemane Yeti (World of Warcraft) | mob:frostmane_yeti |
| Frozen Orb | RENAMED | -> Frostglobe (Diablo II) | ability:frozen_orb |
| Gallowmere | RENAMED | -> Gibbetmere (MediEvil) | poi:9.0 |
| Glacial Spike | RENAMED | -> Rimeneedle (Diablo II) | ability:glacial_spike |
| Gloomshade | RENAMED | -> Duskmurk (see audit body) | mob:gloomshade |
| Harvest Sprite | RENAMED | -> Gleaning Sprite (Harvest Moon / Story of Seasons) | mob:harvest_sprite |
| Hellfire Ring | RENAMED | -> Pitfire Ring (Diablo III) | mobMechanic:rift_boss_pitlord.aoePulse |
| Hellsteel Sweep | RENAMED | -> Pitsteel Sweep (World of Warcraft) | mobMechanic:rift_hellguard.cleave |
| Heroic Leap | RENAMED | -> Vaulting Charge (World of Warcraft) | ability:heroic_leap |
| Holy Nova | RENAMED | -> Hallowburst (World of Warcraft) | ability:holy_nova |
| Holy Shock | RENAMED | -> Lightjolt (World of Warcraft) | ability:holy_shock |
| Icy Veins | RENAMED | -> Coldsurge (World of Warcraft) | ability:icy_veins |
| Ignition Key: Terrorspark Groundshaker | RENAMED | -> Ignition Key: Dreadspark Groundshaker (World of Warcraft) | item:reins_terrorspark_groundshaker |
| Knight-Lieutenant | RENAMED | -> Banneret (World of Warcraft); superseded at the v0.36.0 merge by the release's Fieldreaver (PR #3133) | deed:pvp_honor_knight_lieutenant deedTitle:pvp_honor_knight_lieutenant |
| Mantle of the Frostmane | RENAMED | -> Mantle of the Rimemane (World of Warcraft) | item:frostmane_mantle |
| Mistforged Pauldrons | RENAMED | -> Fogforged Pauldrons (Guild Wars 2) | item:mistforged_pauldrons |
| Nightkin Stargazer | RENAMED | -> Gloamkin Stargazer (Fallout) | mob:nightkin_stargazer |
| Okku | RENAMED | -> Okrim (Neverwinter Nights 2: Mask of the Betrayer (Forgotten Realms)) | npc:hermit_okku |
| Sanctum Sprint | RENAMED | -> Sanctum Footrace (Guild Wars 2) | deed:dgn_sanctum_speed |
| Sexton of Gallowmere | RENAMED | -> Sexton of Gibbetmere (MediEvil) | npcTitle:sexton_marrow |
| Smokestep | RENAMED | -> Smokefade (RuneScape) | ability:vanish |
| Spellbreak | RENAMED | -> Spellsever (Spellbreak (Proletariat)) | ability:counterspell |
| Spellsteal | RENAMED | -> Spellplunder (World of Warcraft) | ability:spellsteal |
| Spiritmend | RENAMED | -> Spiritcall (World of Warcraft) | talentSpec:restoration |
| Storm Bolt | RENAMED | -> Thunderhurl (Warcraft / World of Warcraft) | ability:storm_bolt choiceRow:war_row_storm_bolt |
| Summon Gloomshade | RENAMED | -> Summon Duskmurk (World of Warcraft) | ability:summon_voidwalker |
| Swiftmend | RENAMED | -> Fleetmend (World of Warcraft) | ability:swiftmend |
| Terrorspark Groundshaker | RENAMED | -> Dreadspark Groundshaker (see audit body) | mount:terrorspark_groundshaker |
| The Bells of Gallowmere | RENAMED | -> The Bells of Gibbetmere (MediEvil (Sony PlayStation franchise)) | quest:q_ww_bells_of_gallowmere |
| The Frostmane Tyrant | RENAMED | -> The Rimemane Tyrant (World of Warcraft) | quest:q_fv_frostmane_tyrant |
| The Moonwell | RENAMED | -> The Moonspring (World of Warcraft (Warcraft franchise)) | poi:8.2 |
| Varric's Shadow Cowl | RENAMED | -> Vandric's Shadow Cowl (Dragon Age (BioWare)) | item:varric_shadow_cowl |
| Victory Rush | RENAMED | -> Victor's Surge (World of Warcraft) | ability:victory_rush choiceRow:war_row_victory_rush |
| Winterbite | RENAMED | -> Wintergnaw (Destiny 2) | mobMechanic:shardlord_kazzix.frostbite weaponSkin:winterbite |
| Wrathwing | RENAMED | -> Zealwing (Terraria (Calamity Mod)) | ability:avenging_wrath choiceRow:pal_r20_avenging_wrath |
| Wyrmcult Grand Robe | RENAMED | -> Broodsworn Grand Robe (World of Warcraft) | item:wyrmcult_grand_robe item:heroic_wyrmcult_grand_robe |
| Wyrmcult Necromancer | RENAMED | -> Broodsworn Necromancer (see audit body) | mob:wyrmcult_necromancer |
| Wyrmcult Orders | RENAMED | -> Broodsworn Orders (World of Warcraft) | item:wyrmcult_orders |
| Wyrmcult Soulsteps | RENAMED | -> Broodsworn Soulsteps (World of Warcraft) | item:wyrmcult_soulsteps item:heroic_wyrmcult_soulsteps |
| Wyrmcult Spellgrips | RENAMED | -> Broodsworn Spellgrips (World of Warcraft) | item:wyrmcult_spellgrips |
| Wyrmcult Tents | RENAMED | -> Broodsworn Tents (World of Warcraft) | poi:2.7 |
| Wyrmcult Zealot | RENAMED | -> Broodsworn Zealot (see audit body) | mob:wyrmcult_zealot |
| Wyvern Sting | RENAMED | -> Drakesting (World of Warcraft) | ability:wyvern_sting |
| Galecrest Rest | BORDERLINE (maintainer) | Libertalia: Winds of Galecrest | graveyard:gy_galecrest |
| Highwatch | BORDERLINE (maintainer) | TERA | poi:2.0 |
| Highwatch Breastplate | BORDERLINE (maintainer) | TERA | item:highwatch_breastplate |
| Highwatch Captain | BORDERLINE (maintainer) | TERA | npcTitle:captain_thessaly |
| Highwatch Greatsword | BORDERLINE (maintainer) | TERA | item:highwatch_greatsword |
| Highwatch Quartermaster | BORDERLINE (maintainer) | TERA | npcTitle:quartermaster_bree |
| Highwatch Summons | BORDERLINE (maintainer) | TERA | item:highwatch_summons |
| Highwatch Trail Hardtack | BORDERLINE (maintainer) | TERA | item:trail_hardtack |
| Highwatch Wallshield | BORDERLINE (maintainer) | TERA | item:highwatch_wallshield |
| Highwatch Warblade | BORDERLINE (maintainer) | TERA | item:highwatch_warblade |
| Moonrest | BORDERLINE (maintainer) | World of Warcraft | poi:8.0 |
| Night-Gardener of Moonrest | BORDERLINE (maintainer) | World of Warcraft | npcTitle:lira_dewsong |
| The Amberfall | BORDERLINE (maintainer) | RuneScape | zone:6 |
| The Frostveil Reach | BORDERLINE (maintainer) | Guild Wars 2 | zone:5 |
| The Nightbloom | BORDERLINE (maintainer) | Final Fantasy XIV | zone:8 |
| Abyssal Maw | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mob:rift_boss_tide mobMechanic:rift_boss_tide.deathZoneCast |
| Anger Management | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | choiceRow:war_row_anger_management |
| Battlecraft | KEEP | flagged vs Final Fantasy XIV; kept under the R15 bar (see audit body) | talentSpec:arms |
| Bladestorm | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:bladestorm choiceRow:war_row_bladestorm |
| Blazing Barrier | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:blazing_barrier |
| Bloodmane War-Legguards | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:bloodmane_war_legguards |
| Bloodmane Warleggings | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:bloodmane_warleggings |
| Bloodrush | KEEP | flagged vs Magic: The Gathering; kept under the R15 bar (see audit body) | talentSpec:fury |
| Bonewrought Bulwark | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:bonewrought_bulwark item:heroic_bonewrought_bulwark |
| Bonewrought Dreadhelm | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:crownforged_dreadhelm item:heroic_crownforged_dreadhelm |
| Bonewrought Gauntlets | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:crownforged_gauntlets |
| Bonewrought Girdle | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:crownforged_girdle |
| Bonewrought Greatsword | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:bonewrought_greatsword item:heroic_bonewrought_greatsword |
| Bonewrought Warspaulders | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:crownforged_warspaulders item:heroic_crownforged_warspaulders |
| Brain Freeze | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:brain_freeze |
| Brakka the Wallbreaker | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mob:brakka_wallbreaker |
| Breachmaker | KEEP | flagged vs Guild Wars 2; kept under the R15 bar (see audit body) | ability:breachmaker |
| Brutok's Maul | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:brutoks_maul |
| Chain Heal | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:chain_heal |
| Cinderfall | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:fire_blast |
| Corrupted Priest Malric | KEEP | flagged vs Chivalry: Medieval Warfare; kept under the R15 bar (see audit body) | mob:corrupted_priest_malric |
| Deepward | KEEP | flagged vs DEEPWARD (Echofall Games); kept under the R15 bar (see audit body) | deed:dgn_deepward |
| Die by the Sword | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:die_by_sword choiceRow:war_row_die_by_the_sword |
| Dreamroot Boots | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:dreamroot_boots |
| Duskfall Cave | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | poi:3.1 |
| Duskfall Overlook | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | poi:3.2 |
| Emberwing Cinderscale | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:emberwing_cinderscale |
| Emberwing Legguards | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:emberwing_legguards |
| Emberwing Scale | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:emberwing_scale |
| Evergarden Rest | KEEP | flagged vs Evergarden (Flippfly); kept under the R15 bar (see audit body) | graveyard:gy_evergarden |
| Fingers of Frost | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:fingers_of_frost |
| Flamestrike | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:flamestrike |
| Frostveil | KEEP | flagged vs Guild Wars 2; kept under the R15 bar (see audit body) | ability:ice_barrier |
| Galeheart | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:hurricane |
| Gladesong | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:tranquility choiceRow:dru_r20_tranquility |
| Gorebite | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:ferocious_bite |
| Grimfire | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | augment:1 |
| Grix the Tunnelking | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mob:grix_the_tunnelking |
| Groveheart | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | talentSpec:restoration |
| Hat Trick Hero | KEEP | flagged vs Hat Trick Hero (Taito); kept under the R15 bar (see audit body) | deed:pvp_vcup_hat_trick |
| Hot Streak | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:hot_streak |
| Ice Floes | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:ice_floes choiceRow:mag_r5_ice_floes |
| Ice Lance | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:ice_lance |
| Intimidating Shout | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:intimidating_shout |
| Keeper of the Nightgate | KEEP | flagged vs The Elder Scrolls V: Skyrim; kept under the R15 bar (see audit body) | npcTitle:lamplighter_sorrel |
| Korgath the Bound | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mob:korgath_the_bound |
| Korgath's Chainwraps | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:korgaths_chainwraps item:heroic_korgaths_chainwraps |
| Last Vicar of the Mournstone | KEEP | flagged vs Guild Wars 2; kept under the R15 bar (see audit body) | npcTitle:vicar_creel |
| Marrowlord Varkas | KEEP | flagged vs Suikoden; kept under the R15 bar (see audit body) | mob:marrowlord_varkas |
| Mass Barrier | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:mass_barrier choiceRow:mag_r17_mass_barrier |
| Mindfracture | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mobMechanic:corrupted_priest_malric.petSpell ability:mind_blast |
| Moongrove | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | talentSpec:balance |
| Moonrage | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | talentMastery:balance |
| Morthen's Cryptforged Hauberk | KEEP | flagged vs Margonem; kept under the R15 bar (see audit body) | item:morthens_cryptforged_hauberk |
| Morthen's Grimoire | KEEP | flagged vs Margonem; kept under the R15 bar (see audit body) | item:morthen_grimoire |
| Mudfin Hex | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mobMechanic:mudfin_murloc.polymorphHex |
| Niela's Coldlight Band | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:nielas_coldlight_band |
| Nightbloom Rest | KEEP | flagged vs Final Fantasy XIV; kept under the R15 bar (see audit body) | graveyard:gy_nightbloom |
| Old Cragmaw | KEEP | flagged vs Dungeons & Dragons (Lost Mine of Phandelver); kept under the R15 bar (see audit body) | mob:old_cragmaw quest:q_old_cragmaw |
| Piercing Howl | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:piercing_howl choiceRow:war_row_piercing_howl |
| Quickblood | KEEP | flagged vs Guild Wars 2; kept under the R15 bar (see audit body) | talentMastery:survival |
| Ravenous Frenzy | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mobMechanic:mirejaw_the_ravenous.aoePulse |
| Redmaw | KEEP | flagged vs Horizon Zero Dawn; kept under the R15 bar (see audit body) | choiceRow:dru_r5_ferocity |
| Reins of the Sky-Reach Stormfeather | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:reins_stormfeather_griffin |
| Reliquant's Drowned Cowl | KEEP | flagged vs Warhammer 40,000; kept under the R15 bar (see audit body) | item:litany_helm |
| Ring of Frost | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:rings_of_frost choiceRow:mag_r11_rings_of_frost |
| Rune of Power | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:rune_of_power choiceRow:mag_r20_rune_of_power |
| Seasoned Soldier | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | ability:seasoned_soldier |
| Sky-Reach Stormfeather | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mount:stormfeather_griffin |
| Skyrend | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | talentMastery:enhancement |
| Skyrender, the Firmament's Wound | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | weaponSkin:skyrender_axe |
| Slimy Mudfin Scale | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:mudfin_scale |
| Solheim, Last Light of the Dawn | KEEP | flagged vs Final Fantasy XV; kept under the R15 bar (see audit body) | weaponSkin:solheim_sword |
| Soulrend Diadem | KEEP | flagged vs Grim Dawn (also Path of Exile); kept under the R15 bar (see audit body) | item:soulrend_diadem |
| Soulrot | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | mobMechanic:restless_bones.soulrot mobMechanic:rift_boss_necro.soulrot |
| Spirit of Malric | KEEP | flagged vs Chivalry: Medieval Warfare; kept under the R15 bar (see audit body) | mob:nythraxis_heroic_priest_add |
| Stormsunder Hood | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:stormsunder_hood |
| The Amberfall Harvest | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | deed:chr_amberfall_gatherer |
| The Mournstone Chapel | KEEP | flagged vs Guild Wars 2; kept under the R15 bar (see audit body) | poi:9.4 |
| The Nightgate | KEEP | flagged vs The Elder Scrolls V: Skyrim; kept under the R15 bar (see audit body) | poi:8.1 |
| The Wildheart Basin | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | dungeon:wildheart_basin |
| Vael the Fogbinder | KEEP | flagged vs Dragon Age; kept under the R15 bar (see audit body) | mob:vael_the_mistcaller |
| Vael's Mist-Staff | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:vaels_mist_staff |
| Varkas Boneguard | KEEP | flagged vs Suikoden; kept under the R15 bar (see audit body) | mob:varkas_boneguard |
| Veilsteel Blade | KEEP | flagged vs Another Eden; kept under the R15 bar (see audit body) | item:veilsteel_blade |
| Vision of High Priest Malric | KEEP | flagged vs Chivalry: Medieval Warfare; kept under the R15 bar (see audit body) | mob:vision_malric_mage |
| Voidscar Handwraps | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:voidscar_handwraps |
| Warden Kaldra | KEEP | flagged vs Magic: The Gathering; kept under the R15 bar (see audit body) | npc:warden_kaldra |
| Waywatcher Sorrel | KEEP | flagged vs Warhammer Fantasy (Wood Elves); kept under the R15 bar (see audit body) | npc:waywatcher_sorrel |
| Wildfang | KEEP | flagged vs Guild Wars 2; kept under the R15 bar (see audit body) | talentSpec:feral |
| Wildheart Tuskblade | KEEP | flagged vs World of Warcraft; kept under the R15 bar (see audit body) | item:wildheart_tuskblade item:heroic_wildheart_tuskblade |
| Wisplight Charms | KEEP | flagged vs The Elder Scrolls Online; kept under the R15 bar (see audit body) | quest:q_wf_wisplight_charms |
| Abysswrought Band | CLEAR |  | item:abysswrought_band |
| Aether-Jouster Hover-Cycle | CLEAR |  | mount:aether_hover_cycle |
| Aetherburst | CLEAR |  | ability:arcane_explosion |
| Aetherwell | CLEAR | maintainer-recorded: see the Recorded for the maintainer section (timing-parallel / contemporaneous coin) | ability:evocation choiceRow:mag_r20_evocation |
| Alchemist Verane | CLEAR |  | npc:alchemist_verane |
| Archon Nyxaris | CLEAR |  | mob:rift_boss_arcane |
| Ashspark Shiv | CLEAR |  | weaponSkin:ashspark_dagger |
| Astravyr, Fang of the Fallen Star | CLEAR |  | weaponSkin:astravyr_dagger |
| Aurelhorn, First of the Herd | CLEAR |  | mob:aurelhorn |
| Aurorist Veyla | CLEAR |  | npc:aurorist_veyla |
| Azgorath, Lord of the Pit | CLEAR |  | mob:rift_boss_pitlord |
| Bellstiller | CLEAR |  | deed:dlv_nhalia_bells deedTitle:dlv_nhalia_bells |
| Blackrot | CLEAR |  | ability:corruption |
| Bloodglass Fields | CLEAR |  | poi:4.5 |
| Boarball | CLEAR |  | mob:vale_cup_ball |
| Boarball Legend | CLEAR |  | deed:pvp_vcup_wins_25 deedTitle:pvp_vcup_wins_25 |
| Bogshine Pools | CLEAR |  | poi:7.3 |
| Bonelord Xarreth | CLEAR |  | mob:rift_boss_necro |
| Breadbind | CLEAR |  | ability:conjure_food |
| Briarguard | CLEAR |  | ability:thorns |
| Bristleguard | CLEAR |  | ability:deterrence choiceRow:hun_r17_deterrence |
| Brittlebreak | CLEAR |  | talentMastery:frost |
| Broodmother Vysska | CLEAR |  | mob:rift_boss_venom |
| Brother Halven | CLEAR | maintainer-recorded: see the Recorded for the maintainer section (timing-parallel / contemporaneous coin) | npc:brother_halven npc:brother_halven_marsh |
| Brutok Skullsmasher | CLEAR | maintainer-recorded: see the Recorded for the maintainer section (timing-parallel / contemporaneous coin) | mob:brutok_skullsmasher |
| Candleblind | CLEAR |  | delveAffix:candleblind |
| Choirmend | CLEAR |  | ability:prayer_of_healing choiceRow:pri_r20_prayer_of_healing |
| Choirmother Selthe | CLEAR |  | mob:choirmother_selthe |
| Choirmother's Casque | CLEAR |  | item:choirmothers_casque |
| Chronicle of the Mirefen | CLEAR |  | deed:chr_marsh_chapter_iii |
| Chronicle of Thornpeak | CLEAR |  | deed:chr_peaks_chapter_iii |
| Chronicler Zenzie | CLEAR |  | npc:chronicler_edda_hartwell |
| Chronoweave | CLEAR |  | talentMastery:arcane |
| Cinderbolt | CLEAR |  | ability:fireball |
| Cinderbrand | CLEAR |  | weaponSkin:cinderbrand_sword |
| Cinderburn | CLEAR |  | mobMechanic:ironvein_sapper.cinder |
| Cinderlatch | CLEAR |  | weaponSkin:cinderlatch_crossbow |
| Cindermaple Rise | CLEAR |  | poi:6.5 |
| Cindraleth the Maw Matriarch | CLEAR |  | mob:cindraleth_maw_matriarch |
| Coldsight | CLEAR |  | talentSpec:marksmanship |
| Commander of Wyrmwatch | CLEAR |  | npcTitle:gatecaptain_brannoc |
| Cosmarch, Spire of the Endless Void | CLEAR |  | weaponSkin:cosmarch_staff |
| Counterfang | CLEAR |  | ability:mongoose_bite |
| Craftsworn | CLEAR |  | deed:prog_guildsworn deedTitle:prog_guildsworn |
| Dawnhold Castle | CLEAR |  | poi:11.3 |
| Deadfrost | CLEAR |  | ability:deep_freeze |
| Deepvenom | CLEAR |  | choiceRow:hun_r5_improved_serpent_sting |
| Diabolical Twinstrike | CLEAR |  | ability:diabolical_twinstrike |
| Direhowl | CLEAR |  | ability:demoralizing_shout |
| Dirge of Nhalia | CLEAR |  | mobMechanic:sister_nhalia.aoePulse |
| Dirgebound Thought | CLEAR |  | choiceRow:pri_r5_twisted_faith |
| Down to Drifthaven | CLEAR |  | quest:q_pr_down_to_drifthaven |
| Drakemaw Caldera | CLEAR |  | poi:4.6 |
| Drakemaw Raptor | CLEAR |  | mount:drakemaw_raptor |
| Drifthaven | CLEAR |  | poi:10.0 |
| Drogmar's Skullcleaver | CLEAR |  | item:drogmars_skullcleaver |
| Drogmar's War-Camp | CLEAR |  | poi:2.4 |
| Drogmar's Warboots | CLEAR |  | item:drogmar_warboots |
| Duskchill | CLEAR |  | mobMechanic:duskwisp.venom |
| Duskfire | CLEAR |  | ability:shadowburn |
| Duskveil | CLEAR |  | ability:stealth |
| Duskwisp Essence | CLEAR |  | item:duskwisp_essence |
| Emberbite | CLEAR |  | weaponSkin:emberbite_axe |
| Emberforge | CLEAR |  | riftTheme:1 |
| Emberwish, Mote of the Dying Sun | CLEAR |  | weaponSkin:emberwish_wand |
| Emberwrought | CLEAR |  | skinCollection:emberwrought |
| Encore, the Second Falling Star | CLEAR |  | weaponSkin:encore_bow |
| Fang of Korzul | CLEAR |  | item:fang_of_korzul item:heroic_fang_of_korzul |
| Fangknife of Zulgar | CLEAR |  | item:wildheart_fangknife item:heroic_wildheart_fangknife |
| Fen-Witch of Willowweep | CLEAR |  | npcTitle:mother_sedge |
| Fieldhardy | CLEAR |  | choiceRow:hun_r17_thick_hide |
| Fieldreaver | CLEAR | release-minted (PR #3133 ip-safe re-cut, maintainer ruling); adopted at the v0.36.0 merge over the phase's Banneret | deed:pvp_honor_knight_lieutenant deedTitle:pvp_honor_knight_lieutenant |
| Fiendhide | CLEAR |  | ability:demon_skin |
| Fiendlore | CLEAR |  | talentMastery:demonology |
| Fiendward | CLEAR |  | choiceRow:wlk_r11_demon_armor |
| Fine Sheenleaf Herb | CLEAR |  | item:fine_silverleaf_herb |
| First Frost at Highwatch | CLEAR |  | quest:q_stalker_pelts |
| Fogbinder Unbound | CLEAR |  | deed:dgn_sunken_bastion |
| Fogbinder's Duffel | CLEAR |  | item:mistcallers_duffel |
| Fogbinder's Edge | CLEAR |  | item:mistcallers_edge |
| Forgeheart Stave | CLEAR |  | weaponSkin:forgeheart_staff |
| Formrush | CLEAR |  | choiceRow:dru_r11_furor |
| Frostsweep | CLEAR |  | ability:cone_of_cold |
| Galecrash | CLEAR |  | mobMechanic:rift_boss_storm.stomp |
| Ghostfoot | CLEAR |  | ability:evasion |
| Ghostfoot Gambit | CLEAR |  | choiceRow:rog_r17_improved_evasion |
| Gildenweave Leggings | CLEAR |  | item:goldweave_leggings |
| Gildenweave Robe | CLEAR |  | item:goldweave_robe |
| Glaciersplit | CLEAR |  | weaponSkin:glaciersplit_axe |
| Gloamfield | CLEAR |  | poi:8.3 |
| Gloamveil | CLEAR |  | talentMastery:shadow |
| Gloamveil Form | CLEAR |  | ability:shadowform |
| Glyphsteel Bar | CLEAR |  | item:arcanite_bar |
| Glyphsteel Mining Pick | CLEAR |  | item:arcanite_mining_pick |
| Glyphsteel War Axe | CLEAR |  | item:arcanite_war_axe |
| Goliath Grag-Bear | CLEAR |  | mount:grag_bear |
| Gorrak the Ruthless | CLEAR |  | mob:gorrak |
| Gorrak's Cleaver | CLEAR |  | item:gorraks_cleaver |
| Gorrak's Cruel Chopper | CLEAR |  | item:gorraks_cruel_chopper |
| Grand Necromancer Velkhar | CLEAR |  | mob:grand_necromancer_velkhar |
| Graskbreaker Girdle | CLEAR |  | item:graskbreaker_girdle |
| Grave of Captain Aldren | CLEAR |  | item:grave_sir_aldren |
| Grave of High Priest Malric | CLEAR |  | item:grave_high_priest_malric |
| Gravelight | CLEAR | maintainer-recorded: see the Recorded for the maintainer section (timing-parallel / contemporaneous coin) | augment:12 |
| Gravewyrm Sanctum | CLEAR |  | poi:2.9 dungeon:gravewyrm_sanctum |
| Grubjaw the Glutton | CLEAR |  | mob:grubjaw |
| Guisecraft | CLEAR |  | choiceRow:hun_r5_aspect_mastery |
| Gullhaven | CLEAR |  | poi:13.0 |
| Gullhaven Fisher | CLEAR |  | npcTitle:fisher_nell |
| Harvest on the Palmstrand | CLEAR |  | deed:chr_palmreach_gatherer |
| Heartwood of the Deathless Crown | CLEAR |  | item:deathless_heartwood item:heroic_deathless_heartwood |
| Hedgewick | CLEAR |  | poi:11.0 |
| Hellglass Ward | CLEAR |  | choiceRow:wlk_r20_grimoire_of_haste |
| Heroic: Gravewyrm Sanctum | CLEAR |  | deed:dgn_gravewyrm_sanctum_heroic |
| Hexstorm | CLEAR |  | choiceRow:wlk_r20_curse_mastery |
| Hourglass of Suspension | CLEAR |  | ability:temporal_hourglass |
| Hushword | CLEAR |  | ability:silence choiceRow:pri_r8_silence |
| Icebind | CLEAR |  | ability:frost_nova |
| Icemantle | CLEAR |  | poi:5.0 |
| Ignition Key: Aether-Jouster Hover-Cycle | CLEAR |  | item:reins_aether_hover_cycle |
| Jawcrack | CLEAR |  | ability:pummel |
| Kama-Kage the Shadow-Jump Toad | CLEAR |  | mount:shadowjump_toad |
| Kazzix's Heartshard | CLEAR |  | item:kazzix_heartshard |
| Keeper of the Amberfen Steps | CLEAR |  | npcTitle:waykeeper_pell |
| Keeper of the Crowgate Lanterns | CLEAR |  | npcTitle:lampman_cobb |
| Keeper of the Hedgewick Inn | CLEAR |  | npcTitle:wickmother_sorrel |
| Keeper Saelwyn | CLEAR |  | npc:keeper_saelwyn |
| Korzul the Gravewyrm | CLEAR |  | mob:korzul_the_gravewyrm quest:q_gravewyrm |
| Lanternmere | CLEAR |  | poi:6.0 |
| Lifesap | CLEAR |  | ability:innervate choiceRow:dru_r11_innervate |
| Lightmend | CLEAR |  | ability:flash_of_light |
| Linebreaker | CLEAR | release-minted (PR #3133 ip-safe re-cut, maintainer ruling); replaced the Sergeant GENERIC keep at the v0.36.0 merge | deed:pvp_honor_sergeant deedTitle:pvp_honor_sergeant |
| Lira Dewsong | CLEAR |  | npc:lira_dewsong |
| Magus Vel'Kor the Pactbound | CLEAR |  | mob:rift_boss_ritualist |
| Maldrec's Soulbinder | CLEAR |  | item:maldrecs_soulbinder |
| Malric's Mending | CLEAR |  | mobMechanic:nythraxis_heroic_priest_add.channelHeal |
| Masterwright | CLEAR |  | deed:prog_masterwright deedTitle:prog_masterwright |
| Meteorlatch, the Sky's Last Judgment | CLEAR |  | weaponSkin:meteorlatch_crossbow |
| Mogger | CLEAR |  | mob:mogger |
| Mogger Lackey | CLEAR |  | mob:mogger_lackey |
| Mogger Must Fall | CLEAR |  | quest:q_mogger |
| Mogger's Copper Cudgel | CLEAR |  | item:moggers_copper_cudgel |
| Mogger's Hide Quiver | CLEAR |  | item:moggers_hide_quiver |
| Mogger's Shiv | CLEAR |  | item:moggers_shiv |
| Mogger's Stomper Boots | CLEAR |  | item:moggers_stomper_boots |
| Moonfleece Weaver | CLEAR |  | npcTitle:weaver_amelle |
| Moonkindle | CLEAR |  | choiceRow:dru_r5_improved_wrath |
| Moonspite | CLEAR |  | choiceRow:dru_r14_moonfury |
| Morrowlash | CLEAR |  | ability:death_coil choiceRow:wlk_r17_death_coil |
| Morthen the Gravecaller | CLEAR |  | mob:morthen |
| Mounds of the Mirefen | CLEAR |  | quest:q_trolls |
| Mountainhide | CLEAR |  | mobMechanic:thunzharr_waking_peak.stoneskin |
| Muster at Fenbridge | CLEAR |  | quest:q_fenbridge_muster |
| Nhalia Mourner | CLEAR |  | mob:nhalia_mourner |
| Nhalia's Bell-Maul | CLEAR |  | item:nhalias_bell_maul |
| Nhalia's Dirgeblade | CLEAR |  | item:nhalias_dirgeblade |
| Nhalia's Funeral Wraps | CLEAR |  | item:nhalias_funeral_wraps |
| Nhalia's Litany Rod | CLEAR |  | item:nhalias_litany_rod |
| Nythraxis Raid Arena | CLEAR |  | dungeon:nythraxis_boss_arena |
| Nythraxis, Scourge of Thornpeak | CLEAR |  | mob:nythraxis_scourge_of_thornpeak |
| Oathbrand | CLEAR |  | ability:seal_of_righteousness |
| Oathward | CLEAR |  | talentMastery:protection |
| Oathwheel | CLEAR |  | choiceRow:pal_r14_righteous_cause |
| of Thornpeak | CLEAR |  | deedTitle:chr_peaks_chapter_iii |
| Ondrel Vane | CLEAR |  | npc:tidewatcher_ondrel |
| Packbond | CLEAR |  | talentMastery:beast_mastery |
| Peakbreaker | CLEAR |  | deed:cmb_thunzharr_unbroken deedTitle:cmb_thunzharr_unbroken |
| Phoenix Trance | CLEAR |  | ability:combustion |
| Pyrebrand Weapon | CLEAR |  | ability:flametongue_weapon |
| Pyrelance | CLEAR |  | ability:pyroblast |
| Raw Frostgill Trout | CLEAR |  | item:raw_frostgill_trout |
| Reeve of Lanternmere | CLEAR |  | npcTitle:reeve_ottoline |
| Reins of Kama-Kage the Shadow-Jump Toad | CLEAR |  | item:reins_shadowjump_toad |
| Reins of the Goliath Grag-Bear | CLEAR |  | item:reins_grag_bear |
| Reins of the Valorsteed | CLEAR |  | item:reins_valorsteed |
| Reins of Thunderstrut the Grand Gobbler | CLEAR |  | item:reins_thunderstrut_gobbler |
| Riftwatch Ollun | CLEAR |  | npc:riftwatch_ollun |
| Rimebite | CLEAR |  | mobMechanic:rift_frost_revenant.chillOnHit |
| Rimecrusher | CLEAR |  | weaponSkin:rimecrusher_mace |
| Rimelance | CLEAR |  | ability:frostbolt |
| Ripples in the Lilymoors | CLEAR |  | deed:chr_willowfen_first_cast |
| Ruinbolt | CLEAR |  | ability:chaos_bolt choiceRow:wlk_r20_chaos_bolt |
| Sableweb | CLEAR |  | poi:0.4 |
| Sableweb Menace | CLEAR |  | quest:q_spiders |
| Scepter of the Deathless Court | CLEAR |  | item:scepter_of_the_deathless_court |
| Scout Yerrin | CLEAR |  | npc:scout_yerrin |
| Seal of the Nine Oaths | CLEAR |  | item:seal_of_the_nine_oaths |
| Sealbreak Shockwave | CLEAR |  | mobMechanic:bound_guardian.aoePulse |
| Seasoned Boarballer | CLEAR |  | deed:pvp_vcup_wins_10 |
| Selthe's Sea-Striders | CLEAR |  | item:selthes_seastriders item:heroic_selthes_seastriders |
| Sethrael the Palecoil | CLEAR |  | mob:sethrael_palecoil quest:q_palecoil |
| Sethrael's Heartscale | CLEAR |  | item:palecoil_heartscale |
| Shadecloak | CLEAR |  | ability:cloak_of_shadows choiceRow:rog_r17_cloak_of_shadows |
| Shadeslip | CLEAR |  | ability:shadowstep choiceRow:rog_r20_shadowstep |
| Shadewolf | CLEAR |  | ability:ghost_wolf |
| Shardlord Kazzix | CLEAR |  | mob:shardlord_kazzix |
| Sheenleaf Healing Draught | CLEAR |  | item:silverleaf_healing_draught |
| Sheenleaf Herb | CLEAR |  | item:silverleaf_herb |
| Sheenleaf Mana Draught | CLEAR |  | item:silverleaf_mana_draught |
| Sheenleaf Sickle | CLEAR |  | item:silverleaf_sickle |
| Shieldcrack | CLEAR |  | ability:shield_slam |
| Shiverfen Trapper | CLEAR |  | npcTitle:trapper_brosk |
| Sister Nhalia | CLEAR |  | mob:sister_nhalia |
| Sister Nhalia, the Drowned Canticle | CLEAR |  | mob:sister_nhalia_drowned_canticle |
| Sister Nhalia's Choir-Forged Plate | CLEAR |  | item:sister_nhalia_choir_plate |
| Skullthump | CLEAR |  | mobMechanic:mogger_lackey.stunOnHit |
| Skybranch | CLEAR |  | ability:chain_lightning choiceRow:sha_r14_chain_lightning |
| Skysilver Mining Pick | CLEAR |  | item:mithril_mining_pick |
| Slinkstrike | CLEAR |  | ability:pounce |
| Sloomtooth the Drowned | CLEAR |  | mob:sloomtooth_the_drowned |
| Sloomtooth's Tidefang | CLEAR |  | item:sloomtooth_tidefang |
| Smith Haldren | CLEAR |  | npc:smith_haldren |
| Smoulderfall | CLEAR |  | weaponSkin:smoulderfall_mace |
| Snapdread | CLEAR |  | choiceRow:wlk_r17_improved_fear |
| Spellgnaw | CLEAR |  | mobMechanic:grubjaw.purgeOnHit |
| Spirit of Aldren | CLEAR |  | mob:nythraxis_heroic_warrior_add |
| Splitshot | KEEP | relabeled at QA: 'Split Shot' is a genre-wide ranged skill (FFXIV Machinist, Heroes of Hammerwatch); the fused token keeps it under bar rule 2 | ability:multi_shot choiceRow:hun_r14_multi_shot |
| Springwell | CLEAR |  | ability:healing_stream choiceRow:sha_r11_healing_stream |
| Staff of Velkhar | CLEAR |  | item:staff_of_velkhar item:heroic_staff_of_velkhar |
| Stormcrag | CLEAR |  | poi:2.5 |
| Summon Emberkin | CLEAR | maintainer-recorded: see the Recorded for the maintainer section (timing-parallel / contemporaneous coin) | ability:summon_imp |
| Summon Spellhound | CLEAR |  | ability:summon_felhunter |
| Summon Warfiend | CLEAR |  | ability:summon_felguard |
| Summon Wraithborn | CLEAR |  | ability:summon_doomguard |
| Sunvenom Hex | CLEAR |  | mobMechanic:wildheart_hexcaller.petSpell |
| Sureflight Aura | CLEAR |  | ability:trueshot_aura |
| Sutil's Gambit | CLEAR |  | item:sutils_gambit |
| Tanner Hesk | CLEAR |  | npc:tanner_hesk |
| Tempest Vharok | CLEAR |  | mob:rift_boss_storm |
| The Amberfen Steps | CLEAR |  | poi:7.1 |
| The Codfather | CLEAR |  | item:the_codfather quest:q_the_codfather |
| The Crowgate | CLEAR |  | poi:9.1 |
| The Deepfen Stirs | CLEAR |  | quest:q_deepfen |
| The Fogbinder | CLEAR |  | quest:q_mistcaller |
| The Galecrest Stables | CLEAR |  | poi:12.7 |
| The Glimmermere | CLEAR |  | poi:2.6 |
| The Goldmelt | CLEAR |  | poi:6.1 |
| The Lilymoors | CLEAR |  | poi:7.2 |
| The Man Who Went In | CLEAR |  | npcTitle:hermit_okku quest:q_pr_the_man_who_went_in |
| The Meredark | CLEAR |  | mob:the_meredark quest:q_af_the_meredark |
| The Palmstrand | CLEAR |  | poi:10.2 |
| The Shardlord | CLEAR |  | quest:q_kazzix |
| The Shiverfen | CLEAR |  | poi:5.4 |
| The Tanglemouth | CLEAR |  | poi:10.1 |
| The Vinefall | CLEAR |  | poi:10.4 |
| The Waking Voice | CLEAR |  | mobMechanic:threnos_first_voice.enfeeble |
| The Witch of Willowweep | CLEAR |  | quest:q_wf_witch_of_willowweep |
| Thornpeak Cairns | CLEAR |  | graveyard:gy_thornpeak |
| Thoughtburn | CLEAR |  | ability:mind_sear choiceRow:pri_r20_mind_sear |
| Thronebane, Last Oath of Thornpeak | CLEAR |  | item:kingsbane_last_oath item:heroic_kingsbane_last_oath |
| Thunderstrut the Grand Gobbler | CLEAR |  | mount:thunderstrut_gobbler |
| Thunzharr, the Waking Peak | CLEAR |  | mob:thunzharr_waking_peak |
| Tinker Gizzel | CLEAR |  | npc:tinker_gizzel |
| Trapper Brosk | CLEAR |  | npc:trapper_brosk |
| Trollmoot | CLEAR |  | poi:4.3 |
| Twin Icebind | CLEAR |  | choiceRow:mag_r11_twin_nova |
| Twinstrike | CLEAR |  | ability:raging_gale |
| Valorsteed | CLEAR |  | mount:valorsteed |
| Veinleech | CLEAR |  | ability:siphon_life |
| Venomweald | CLEAR |  | riftTheme:2 |
| Verlan's Oathblade | CLEAR |  | item:verlans_oathblade |
| Viperfletch | CLEAR |  | choiceRow:hun_r14_serpents_venom |
| Vision of Captain Aldren | CLEAR |  | mob:vision_aldren_warrior |
| Voidfeast | CLEAR |  | ability:voidfeast choiceRow:wlk_r8_voidfeast |
| Voidscar | CLEAR | maintainer-recorded: WoW Midnight Voidscar Arena is contemporaneous, ours shipped 2026-07-07; see the maintainer section | riftTheme:5 |
| Voskar the Emberwing | CLEAR |  | mob:voskar_emberwing |
| Warcrowned | CLEAR | release-minted (PR #3133 ip-safe re-cut, maintainer ruling); replaced the Field Marshal GENERIC keep at the v0.36.0 merge | deed:pvp_honor_field_marshal deedTitle:pvp_honor_field_marshal |
| Warden Coalfast | CLEAR |  | npc:warden_coalfast |
| Warden of Icemantle | CLEAR |  | npcTitle:warden_kaldra |
| Warlord Drogmar | CLEAR |  | mob:warlord_drogmar quest:q_drogmar |
| Warlord Grask | CLEAR |  | mob:rift_boss_brute |
| Watcher of the Goldmelt | CLEAR |  | npcTitle:waywatcher_sorrel |
| Watcher of the Tanglemouth | CLEAR |  | npcTitle:strandwatcher_pell |
| Waterbind | CLEAR |  | ability:conjure_water |
| Wickharbor | CLEAR |  | poi:12.0 |
| Wildbloom | CLEAR |  | ability:rejuvenation |
| Wildbolt | CLEAR |  | ability:wrath |
| Wildbond | CLEAR |  | ability:tame_beast |
| Wildfang Rally | CLEAR |  | ability:aspect_of_the_wild choiceRow:hun_r20_aspect_of_the_wild |
| Wildmend | CLEAR |  | ability:healing_touch |
| Wildward | CLEAR |  | ability:mark_of_the_wild |
| Willowweep | CLEAR |  | poi:7.4 |
| Winterlash | CLEAR |  | ability:flurry |
| Wolfstep | CLEAR |  | choiceRow:sha_r17_improved_ghost_wolf |
| Wraithbinder Maldrec | CLEAR |  | mob:wraithbinder_maldrec |
| Wreckfield Salvager | CLEAR |  | npcTitle:salvager_edda |
| Wyrmfeller | CLEAR |  | deed:dgn_korzul_flawless deedTitle:dgn_korzul_flawless |
| Wyrmwatch | CLEAR |  | poi:4.0 |
| Ysolei, Avatar of the Drowned Moon | CLEAR |  | mob:ysolei |
| Ysolei's Pearl Greaves | CLEAR |  | item:ysols_pearl_greaves item:heroic_ysols_pearl_greaves |
| Zense Meridian | CLEAR |  | item:zense_meridian |
| Zulgar, Voice of the Basin | CLEAR |  | mob:wildheart_high_priest |
| Zyzz's Deathless Signet | CLEAR |  | item:zyzzs_deathless_signet |
| A Cart for the Orchard | GENERIC |  | quest:q_af_orchard_call |
| A Cast in the Looking-Glass | GENERIC |  | deed:chr_wraithwood_first_cast |
| A Cast on the Petal Pond | GENERIC |  | deed:chr_evergarden_first_cast |
| A Catch from the Great Mere | GENERIC |  | deed:chr_amberfall_first_cast |
| A Different Pastime | GENERIC |  | quest:q_prof_hobby_switch |
| A Dish to Remember | GENERIC |  | deed:prog_cooking_rare |
| A Fair Exchange | GENERIC |  | deed:soc_first_trade |
| A Fine Seam | GENERIC |  | deed:prog_tailoring_50 |
| A Footnote in History | GENERIC |  | deed:hid_saul_footnote |
| A Friend in the Deep | GENERIC |  | deed:dlv_companion_max |
| A Glimmer of Arcana | GENERIC |  | deed:prog_enchanting_50 |
| A Habit of Mountains | GENERIC |  | deed:cmb_thunzharr_ten |
| A Hundred Banners | GENERIC |  | deed:pvp_bg_captures_100 |
| A Lesson in Humility | GENERIC |  | deed:pvp_duel_grace |
| A Line in the Mirror Tarn | GENERIC |  | deed:chr_galecrest_first_cast |
| A Master's Stitch | GENERIC |  | deed:prog_tailoring_rare |
| A Perfect Specimen | GENERIC |  | deed:col_perfect_specimen |
| A Point Well Spent | GENERIC |  | deed:prog_talented |
| A Rare Vintage | GENERIC |  | deed:prog_alchemy_rare |
| A Recipe Worth Keeping | GENERIC |  | quest:q_prof_attune_apothecary |
| A Trade for Every Hand | GENERIC |  | quest:q_prof_intro |
| A Volatile Arrangement | GENERIC |  | quest:q_prof_attune_bombardier |
| A Wyrm's Hoard | GENERIC |  | deed:soc_wyrms_hoard |
| Abandoned Crypt | GENERIC |  | dungeon:nythraxis_crypt |
| Absolute Zero | GENERIC |  | mobMechanic:rift_boss_frost.deathZoneStrike |
| Abyssal | GENERIC |  | riftThemeNoun:7.1 |
| Abyssal Loop | GENERIC |  | item:abyssal_loop |
| Acid Spit | GENERIC |  | mobMechanic:deepfen_murloc.corrode |
| Acolyte Chain Grips | GENERIC |  | item:acolyte_chain_grips |
| Acolyte Tessa | GENERIC |  | mob:acolyte_tessa delveCompanion:companion_tessa |
| Acolyte's Circlet | GENERIC |  | item:acolytes_circlet |
| Across the Fenway | GENERIC |  | quest:q_wf_across_the_fenway |
| Adder's Bite | GENERIC |  | ability:instant_poison |
| Aether Darts | GENERIC |  | ability:arcane_missiles |
| Aether Insight | GENERIC |  | ability:arcane_intellect |
| Aether Surge | GENERIC |  | ability:arcane_surge ability:arcane_power |
| Afterglow Aegis | GENERIC |  | choiceRow:pal_r11_greater_blessing |
| Against the Spore Tide | GENERIC |  | quest:q_spore_tide |
| Alchemy | GENERIC |  | craft:alchemy |
| Aldric's Fallen Star | GENERIC |  | quest:q_aldrics_fallen_star |
| Alien Armor Plate | GENERIC |  | item:alien_armor_plate |
| Amber Crimson | GENERIC |  | item:amber_crimson_armor_plate |
| Amber Hide | GENERIC |  | item:amber_hide |
| Amber off the Herd | GENERIC |  | quest:q_af_amber_from_the_herd |
| Amberfall Rest | GENERIC |  | graveyard:gy_amberfall |
| Amethyst Silver | GENERIC |  | item:amethyst_silver_armor_plate |
| Ancestral Mending | GENERIC |  | choiceRow:sha_r17_elemental_warding |
| Ancestral Sap | GENERIC |  | mobMechanic:wildheart_hexcaller.mendAlly |
| Ancestral Strike | GENERIC |  | ability:stormstrike |
| Ancient Carapace | GENERIC |  | mobMechanic:old_marrowshell.stoneskin |
| Ancient Crypt Door | GENERIC |  | item:ancient_crypt_door |
| Ancient Diary | GENERIC |  | item:royal_seal |
| Ancient Guardian | GENERIC |  | mob:ancient_guardian |
| Ancient Heartwood | GENERIC |  | deed:col_ancient_heartwood |
| Angler's Feast Platter | GENERIC |  | item:anglers_feast_platter |
| Anointing | GENERIC |  | ability:power_infusion |
| Apex Predator | GENERIC |  | augment:14 |
| Apothecary Lin | GENERIC |  | npc:apothecary_lin |
| Apothecary Work Order | GENERIC |  | quest:q_prof_workorder_apothecary |
| Apprentice Wren | GENERIC |  | mob:apprentice_wren |
| Arc Bolt | GENERIC |  | ability:lightning_bolt |
| Arcane Annihilation | GENERIC |  | mobMechanic:rift_boss_arcane.deathZoneStrike |
| Arcane Detonation | GENERIC |  | mobMechanic:rift_boss_arcane.bigCast |
| Arcane Frailty | GENERIC |  | mobMechanic:rift_boss_arcane.spellVuln |
| Arcane Surge | GENERIC |  | augment:8 |
| Arcane Volley | GENERIC |  | mobMechanic:rift_boss_arcane.aoePulse |
| Archivist Tullo | GENERIC |  | npc:archivist_tullo |
| Archmage | GENERIC |  | augment:15 |
| Armor Breach | GENERIC |  | ability:expose_armor |
| Armor Shear | GENERIC |  | ability:sunder_armor |
| Armorcrafting | GENERIC |  | craft:armorcrafting |
| Armorer & Weaponsmith | GENERIC |  | npcTitle:smith_haldren |
| Armorer Hode | GENERIC |  | npc:armorer_hode |
| Around the Ring | GENERIC |  | deed:prog_around_the_ring |
| Artisan's Eye | GENERIC |  | item:artisans_eye toolEffect:artisans_eye |
| Ascendant | GENERIC |  | augment:19 |
| Ash | GENERIC |  | riftThemeNoun:1.3 |
| Ash on the Wind | GENERIC |  | quest:q_dk_ash_on_the_wind |
| Ashbolt | GENERIC |  | mobMechanic:warlock_imp.petSpell |
| Ashbone Raider | GENERIC |  | mob:ashbone_raider |
| Ashbone War-Brand | GENERIC |  | item:ashbone_war_brand |
| Ashbone Warcaller | GENERIC |  | mob:ashbone_warcaller |
| Ashen Focus | GENERIC |  | choiceRow:wlk_r14_ruin |
| Ashen Focus Ring | GENERIC |  | item:ashen_focus_ring |
| Ashen Sentence | GENERIC |  | choiceRow:pal_r5_vengeful_exorcism |
| Ashstalker Cowl | GENERIC |  | item:ashstalker_cowl |
| Ashstalker Grips | GENERIC |  | item:ashstalker_grips |
| Ashstalker Harness | GENERIC |  | item:ashstalker_harness |
| Ashstalker Kit | GENERIC |  | itemSet:warfare_ashstalker |
| Ashstalker Legguards | GENERIC |  | item:ashstalker_legguards |
| Ashstalker Shoulderguards | GENERIC |  | item:ashstalker_shoulderguards |
| Ashstalker Treads | GENERIC |  | item:ashstalker_treads |
| Ashstalker Waistband | GENERIC |  | item:ashstalker_waistband |
| Ashwood Axe | GENERIC |  | item:ashwood_axe |
| Ashwood Log | GENERIC |  | item:ashwood_log |
| Ashwood Smoked Eel | GENERIC |  | item:ashwood_smoked_eel |
| Astronomer Cassian | GENERIC |  | npc:astronomer_cassian |
| Auctioneer Voss | GENERIC |  | npc:auctioneer_voss |
| Aurora Mote | GENERIC |  | item:aurora_mote |
| Avatar | GENERIC |  | ability:avatar choiceRow:war_row_avatar |
| Avatar of War | GENERIC |  | augment:18 |
| Azure Rift Gem | GENERIC |  | item:rift_gem_azure |
| Back on the Stove | GENERIC |  | quest:q_prof_amends_apothecary |
| Back to the Forge | GENERIC |  | quest:q_prof_amends_smith |
| Back to the Shallows | GENERIC |  | quest:q_deepfen_purge |
| Bad Air | GENERIC |  | delveAffix:bad_air |
| Bandit Camp | GENERIC |  | poi:0.6 |
| Bandits of the Vale | GENERIC |  | quest:q_bandits |
| Banner in Hand | GENERIC |  | deed:pvp_bg_first_capture |
| Banners over the Dunes | GENERIC |  | quest:q_dk_banners_over_the_dunes |
| Bark Ward | GENERIC |  | mobMechanic:treant_elder.wardAllies |
| Barrow Wight | GENERIC |  | mob:barrow_wight |
| Barrowlord Battlegear | GENERIC |  | itemSet:deathlord deed:col_set_deathlord |
| Barrowlord Dread Visage | GENERIC |  | item:deathlords_dread_visage item:heroic_deathlords_dread_visage |
| Barrowlord Legguards | GENERIC |  | item:deathlord_legguards item:heroic_deathlord_legguards |
| Barrowlord Sabatons | GENERIC |  | item:deathlord_sabatons |
| Barrowlord Warplate | GENERIC |  | item:deathlord_warplate item:heroic_deathlord_warplate |
| Barrowshade Mantle | GENERIC |  | item:barrowshade_mantle |
| Basin Stalker's Tunic | GENERIC |  | item:basin_stalkers_tunic |
| Bastion Revenant | GENERIC |  | mob:bastion_revenant |
| Bastion Ward Stone | GENERIC |  | item:bastion_ward_stone |
| Battle Rhythm | GENERIC |  | choiceRow:war_row_battle_rhythm |
| Battle Stance | GENERIC |  | ability:battle_stance |
| Beast Pit Quake | GENERIC |  | mobMechanic:wildheart_beastmaster.stomp |
| Begin Again | GENERIC |  | deed:prog_prestige |
| Bell Toll | GENERIC |  | mobMechanic:deacon_varric.stomp |
| Belligerent Dead | GENERIC |  | delveAffix:belligerent_dead |
| Bellkeeper Tam | GENERIC |  | npc:bellkeeper_tam |
| Benison | GENERIC |  | talentSpec:holy |
| Berserker | GENERIC |  | powerup:3 |
| Berserker Stance | GENERIC |  | ability:berserker_stance |
| Better Together | GENERIC |  | deed:soc_first_party |
| Bewitch | GENERIC |  | ability:polymorph |
| Big Boot | GENERIC |  | ability:sport_boot sportAbility:sport_boot |
| Blacktide | GENERIC |  | choiceRow:wlk_r5_improved_corruption |
| Blackwater Drift Mantle | GENERIC |  | item:litany_shoulder |
| Blackwater Vanguard Chestguard | GENERIC |  | item:blackwater_vanguard_chest |
| Bladed Gyre | GENERIC |  | ability:whirlwind |
| Bleed Out | GENERIC |  | ability:rupture |
| Blessed Embers | GENERIC |  | item:blessed_embers |
| Blessed Tallow | GENERIC |  | item:blessed_wax |
| Blinding Powder | GENERIC |  | mobMechanic:vale_bandit.blind |
| Blindside Opening | GENERIC |  | choiceRow:rog_r8_improved_gouge |
| Blink While Casting | GENERIC |  | choiceRow:mag_r5_blink_cast |
| Blizzard | GENERIC |  | ability:blizzard |
| Blood | GENERIC |  | riftThemeNoun:4.3 |
| Blood Credit | GENERIC |  | choiceRow:wlk_r11_improved_life_tap |
| Blood Debt | GENERIC |  | talentMastery:retribution |
| Blood Frenzy | GENERIC |  | mobMechanic:old_greyjaw.frenzyOnHit |
| Blood Sigil | GENERIC |  | mobMechanic:rift_boss_ritualist.aoePulse |
| Blood Toll | GENERIC |  | ability:bloodrage |
| Bloodbath | GENERIC |  | choiceRow:war_row_bloodbath |
| Bloodbond | GENERIC |  | choiceRow:hun_r17_master_tamer |
| Bloodhunter | GENERIC |  | augment:11 |
| Bloodletter | GENERIC |  | talentMastery:fury |
| Bloodletting | GENERIC |  | ability:bloodthirst |
| Bloodmane Ravager | GENERIC |  | mob:wildheart_ravager |
| Bloodmane Rend | GENERIC |  | mobMechanic:wildheart_ravager.bleed |
| Bloom's End | GENERIC |  | choiceRow:dru_r5_natures_bounty |
| Boar Meadow | GENERIC |  | poi:0.2 |
| Boars in the Gardens | GENERIC |  | quest:q_pr_boars_in_the_gardens |
| Bog Bloat | GENERIC |  | mob:bog_bloat |
| Bog Rot | GENERIC |  | mobMechanic:drowned_dead.plague mobMechanic:drowned_warlord.plague |
| Bog Thrall | GENERIC |  | mob:choir_thrall |
| Bogiron Hauberk | GENERIC |  | item:bogiron_hauberk |
| Bogiron Mace | GENERIC |  | item:bogiron_mace |
| Bogiron Nugget | GENERIC |  | item:bogiron_nugget |
| Bogoak Staff | GENERIC |  | item:gnarled_staff |
| Bogtoad | GENERIC |  | mob:bogtoad |
| Bone | GENERIC |  | riftThemeNoun:3.0 |
| Bone Carapace | GENERIC |  | mobMechanic:marrowlord_varkas.stoneskin |
| Bone Fragments | GENERIC |  | item:bone_fragments |
| Bone Storm | GENERIC |  | mobMechanic:rift_boss_necro.aoePulse |
| Bonechill Cord | GENERIC |  | item:bonechill_cord |
| Bonechill Striders | GENERIC |  | item:bonechill_striders |
| Bonechill Widow | GENERIC |  | mob:bonechill_widow |
| Boneclad Revenant | GENERIC |  | mob:boneclad_revenant |
| Boneclad Warrior | GENERIC |  | mob:rift_boneclad |
| Bonecrush | GENERIC |  | ability:maul |
| Boneguard Breastplate | GENERIC |  | item:boneguard_breastplate item:heroic_boneguard_breastplate |
| Bonelord Mantle | GENERIC |  | item:bonelord_mantle |
| Boneplate Vest | GENERIC |  | item:boneplate_vest |
| Bones of the Vanguard | GENERIC |  | quest:q_revenant_vanguard |
| Bonewarden Grips | GENERIC |  | item:reliquary_gloves_rog |
| Bonewrought Regalia | GENERIC |  | itemSet:crownforged deed:col_set_crownforged |
| Boneyard | GENERIC |  | riftTheme:3 |
| Boot | GENERIC |  | ability:kick |
| Boots on the Pitch | GENERIC |  | deed:pvp_vcup_first_match |
| Born to the Purple | GENERIC |  | deed:col_first_epic |
| Borrowed Breath | GENERIC |  | choiceRow:rog_r17_cheat_death |
| Borrowed Tempo | GENERIC |  | choiceRow:rog_r11_improved_slice_and_dice |
| Both Lanterns Lit | GENERIC |  | deed:dlv_companions_both |
| Boundstone Girdle | GENERIC |  | item:boundstone_girdle item:heroic_boundstone_girdle |
| Boundstone Helm | GENERIC |  | item:boundstone_helm item:heroic_boundstone_helm |
| Boundstone Vanguard | GENERIC |  | itemSet:boundstone_vanguard deed:col_set_boundstone_vanguard |
| Bounty Hunter | GENERIC |  | augment:13 |
| Bracing Order | GENERIC |  | mobMechanic:mogger.wardAllies |
| Bram Come Home | GENERIC |  | quest:q_fs_bram_come_home |
| Bramble | GENERIC |  | riftThemeNoun:2.2 |
| Bramblehide Jerkin | GENERIC |  | item:bramblehide_jerkin |
| Branching Antler | GENERIC |  | item:stag_antler |
| Brasscap Hatchet | GENERIC |  | weaponSkin:brasscap_axe |
| Brasscrown Walking Staff | GENERIC |  | weaponSkin:brasscrown_staff |
| Breach Scholar | GENERIC |  | npcTitle:riftwatch_ollun |
| Breach Wretch | GENERIC |  | mob:breach_wretch |
| Break the War-Camp | GENERIC |  | quest:q_crushers |
| Break-Scarred Steel | GENERIC |  | item:breakscarred_steel |
| Breaking the Seal | GENERIC |  | quest:q_breaking_the_seal |
| Briar Ambush | GENERIC |  | choiceRow:dru_r8_improved_roots |
| Briarroot Staff | GENERIC |  | item:briarroot_staff |
| Bridgemere | GENERIC |  | poi:7.0 |
| Bridgewright Alden | GENERIC |  | npc:bridgewright_alden |
| Brightwood Glade | GENERIC |  | poi:0.9 |
| Brightwood Remembered | GENERIC |  | deed:feat_brightwood_relic |
| Brightwood Venison | GENERIC |  | item:brightwood_venison |
| Briny Idol | GENERIC |  | item:briny_idol |
| Bristled Hide | GENERIC |  | mobMechanic:wild_boar.thorns |
| Bristlehide Spaulders | GENERIC |  | item:bristlehide_spaulders |
| Bristly Boar Hide | GENERIC |  | item:boar_hide |
| Bristly Boar Hides | GENERIC |  | quest:q_boars |
| Brittle Ruin | GENERIC |  | ability:shatter |
| Bronze Sickle | GENERIC |  | item:bronze_sickle |
| Bronzework Mace | GENERIC |  | item:bronzework_mace |
| Brood Cleave | GENERIC |  | mobMechanic:drakemaw_broodlord.arcCleave |
| Brood Venom | GENERIC |  | mobMechanic:mirefen_broodmother.stackPoison |
| Broodmother Carapace | GENERIC |  | item:broodmother_carapace |
| Broodmother Egg | GENERIC |  | mob:spider_egg |
| Broodmother's Mark | GENERIC |  | mobMechanic:rift_boss_venom.deathZoneStrike |
| Broodmother's Silk Robe | GENERIC |  | item:broodmother_silk_robe |
| Brother Aldric | GENERIC |  | npc:brother_aldric npc:brother_aldric_fen npc:brother_aldric_highwatch npc:brother_aldric_raid |
| Bruin Form | GENERIC |  | ability:bear_form |
| Bruin Rebound | GENERIC |  | choiceRow:dru_r8_brutal_bash |
| Bruin Rush | GENERIC |  | ability:bear_charge |
| Brutality | GENERIC |  | augment:0 |
| Brute Swing | GENERIC |  | ability:slam |
| Bulwark-Rusted Pauldrons | GENERIC |  | item:bulwark_rusted_pauldrons |
| Burning Oath | GENERIC |  | ability:righteous_fury |
| Burning Pact | GENERIC |  | ability:immolate |
| Bursar Aldous Crane | GENERIC |  | npc:bursar_aldous_crane |
| Bursar Fernando | GENERIC |  | npc:bursar_fernando |
| Bursar Petra Vell | GENERIC |  | npc:bursar_petra_vell |
| By Raven's Wing | GENERIC |  | deed:soc_by_ravens_wing |
| Cabinet of Curiosities | GENERIC |  | deed:col_discovery_150 |
| Call of the Hunt | GENERIC |  | mobMechanic:wildheart_beastmaster.warcry |
| Callused Hands | GENERIC |  | deed:prog_callused_hands |
| Calming the Deep | GENERIC |  | quest:q_calming_the_deep |
| Candles at the Bounds | GENERIC |  | quest:q_ww_candles_at_the_bounds |
| Canopy Silk Hank | GENERIC |  | item:canopy_silk_hank |
| Canopy Weaver | GENERIC |  | mob:canopy_weaver |
| Cantor's Drowned Sash | GENERIC |  | item:cantors_drowned_sash |
| Captain Thessaly | GENERIC |  | npc:captain_thessaly |
| Captain Verlan | GENERIC |  | mob:captain_verlan |
| Caravan Quilted Vest | GENERIC |  | item:caravan_quilted_vest |
| Caravan Warden Dirk | GENERIC |  | item:caravan_warden_dirk |
| Card Master | GENERIC |  | npc:card_master |
| Carrying the Party | GENERIC |  | deed:pvp_fiesta_five_kills |
| Casting the Sapphire Lagoon | GENERIC |  | deed:chr_palmreach_first_cast |
| Caustic Spores | GENERIC |  | mobMechanic:bog_bloat.deathThroes |
| Cave-In | GENERIC |  | mobMechanic:grix_the_tunnelking.aoePulse |
| Ceaseless Cuts | GENERIC |  | choiceRow:rog_r5_relentless_strikes |
| Censers from the Deep | GENERIC |  | quest:q_drowned_censers |
| Chain Lightning | GENERIC |  | mobMechanic:rift_boss_storm.aoePulse |
| Champion | GENERIC |  | deed:prog_champion deedTitle:prog_champion |
| Chants on the Wind | GENERIC |  | quest:q_zealots |
| Chapel Candle | GENERIC |  | delveAffix:chapel_candle |
| Child of the First Era | GENERIC |  | deed:feat_era_cap |
| Chime Dust | GENERIC |  | item:arcane_dust |
| Chime Essence | GENERIC |  | item:arcane_essence |
| Chime Shard | GENERIC |  | item:arcane_shard |
| Chipped Tusk | GENERIC |  | item:chipped_tusk |
| Choir-Blessed Spaulders | GENERIC |  | item:choir_blessed_spaulders |
| Choir-Drowned Raiment | GENERIC |  | item:litany_cloth_chest |
| Chronicle of the Vale | GENERIC |  | deed:chr_vale_chapter_iii |
| Chronicler Osric Fenn | GENERIC |  | npc:chronicler_osric_fenn |
| Chronomancy | GENERIC |  | talentSpec:arcane |
| Chunk of Ore | GENERIC |  | item:chunk_of_ore |
| Cinder | GENERIC |  | riftThemeNoun:1.1 |
| Cinder Dunes | GENERIC |  | poi:4.2 |
| Cinder Jolt | GENERIC |  | ability:flame_shock |
| Cinder Rupture | GENERIC |  | choiceRow:sha_r14_improved_flame_shock |
| Cinder Wave | GENERIC |  | mobMechanic:rift_boss_ember.aoePulse |
| Cinder-Sigil Pendant | GENERIC |  | item:cinder_sigil_pendant |
| Cinders | GENERIC |  | mobMechanic:rift_ember_fiend.cinder mobMechanic:rift_boss_ember.cinder |
| Cinderwalk Treads | GENERIC |  | item:cinderwalk_treads |
| Cinderweave Cord | GENERIC |  | item:cinderweave_cord |
| Cinderweave Cowl | GENERIC |  | item:cinderweave_cowl |
| Cinderweave Handwraps | GENERIC |  | item:cinderweave_handwraps |
| Cinderweave Legwraps | GENERIC |  | item:cinderweave_legwraps |
| Cinderweave Mantle | GENERIC |  | item:cinderweave_mantle |
| Cinderweave Raiment | GENERIC |  | item:cinderweave_raiment |
| Cinderweave Regalia | GENERIC |  | itemSet:warfare_cinderweave |
| Cinderweave Slippers | GENERIC |  | item:cinderweave_slippers |
| Civic Duty | GENERIC |  | deed:soc_civic_duty |
| Claw | GENERIC |  | ability:claw |
| Cleansing Tides | GENERIC |  | talentMastery:restoration |
| Cleansing Verdict | GENERIC |  | ability:cleansing_verdict choiceRow:pal_r8_cleansing_verdict |
| Cleaving Blows | GENERIC |  | ability:cleaving_blows |
| Clinging Silk | GENERIC |  | mobMechanic:rift_boss_venom.aoeSlow |
| Clippings from the Living Green | GENERIC |  | quest:q_eg_bloom_clippings |
| Cloaks for the Watch | GENERIC |  | quest:q_stalker_cloaks |
| Clutch Breaker | GENERIC |  | deed:chr_drakemaw_broodlord |
| Coastal Watchbell | GENERIC |  | item:gullhaven_watchbell |
| Cogs and Sprockets | GENERIC |  | deed:prog_engineering_50 |
| Cold Coffin | GENERIC |  | ability:ice_block |
| Cold Water, Colder Light | GENERIC |  | deed:chr_peaks_glimmer_cast |
| Cold Well Water | GENERIC |  | item:spring_water |
| Coldwater Rot | GENERIC |  | mobMechanic:old_marrowshell.venom |
| Coliseum Contender | GENERIC |  | deed:pvp_arena_1v1_1600 |
| Coliseum Rival | GENERIC |  | deed:pvp_arena_1v1_1750 |
| Collective Reversal | GENERIC |  | ability:collective_reversal |
| Colossal Might | GENERIC |  | choiceRow:war_row_colossal_might |
| Colossus | GENERIC |  | powerup:1 |
| Combat Mastery | GENERIC |  | choiceRow:war_row_blood_offering |
| Concuss | GENERIC |  | ability:bash |
| Concussive Blow | GENERIC |  | mobMechanic:thornpeak_ogre.concuss |
| Conflagrate | GENERIC |  | ability:conflagrate |
| Conjured Black Loaf | GENERIC |  | item:conjured_bread2 |
| Conjured Clearwater | GENERIC |  | item:conjured_water3 |
| Conjured Feastloaf | GENERIC |  | item:conjured_bread4 |
| Conjured Honeycake | GENERIC |  | item:conjured_bread3 |
| Conjured Oatcake | GENERIC |  | item:conjured_bread |
| Conjured Rainwater | GENERIC |  | item:conjured_water |
| Conjured Springwater | GENERIC |  | item:conjured_water4 |
| Conjured Wellwater | GENERIC |  | item:conjured_water2 |
| Consume | GENERIC |  | ability:drain_life |
| Contingency | GENERIC |  | ability:preparation choiceRow:rog_r11_preparation |
| Cook Marlow | GENERIC |  | npc:cook_marlow |
| Cooking | GENERIC |  | craft:cooking |
| Cooking Salt | GENERIC |  | item:cooking_salt |
| Copper Bearded Axe | GENERIC |  | item:copper_bearded_axe |
| Copper Dig | GENERIC |  | poi:0.5 |
| Copper Flanged Mace | GENERIC |  | item:copper_flanged_mace |
| Copper Mining Pick | GENERIC |  | item:copper_mining_pick |
| Copper Ore | GENERIC |  | item:copper_ore |
| Copper Pail Contender | GENERIC |  | deed:chr_vale_cup_debut |
| Coppermail Gauntlets | GENERIC |  | item:coppermail_gauntlets |
| Coppermail Sabatons | GENERIC |  | item:coppermail_sabatons |
| Core Meltdown | GENERIC |  | mobMechanic:rift_boss_ember.deathZoneStrike |
| Cores of the Storm | GENERIC |  | quest:q_shard_cores |
| Corpse-Candle Focus | GENERIC |  | item:corpse_candle_focus |
| Corrode | GENERIC |  | mobMechanic:rift_deep_lurker.corrode |
| Corrupted Sporeling | GENERIC |  | mob:corrupted_sporeling |
| Cottage Loaf | GENERIC |  | item:baked_bread |
| Courser's Guise | GENERIC |  | ability:aspect_of_the_cheetah |
| Cracked Fetish | GENERIC |  | item:cracked_fetish |
| Cracked Guard | GENERIC |  | mobMechanic:varkas_boneguard.expose |
| Cracked Ogre Tusk | GENERIC |  | item:cracked_ogre_tusk |
| Cracked Wolf Fang | GENERIC |  | item:wolf_fang |
| Cracked Wyrm Scale | GENERIC |  | item:cracked_wyrm_scale |
| Crag Warden Cudgel | GENERIC |  | item:crag_warden_cudgel |
| Craghorn Staff | GENERIC |  | item:craghorn_staff |
| Cragmaw Huntquiver | GENERIC |  | item:cragmaw_huntquiver |
| Cragmaw Prowlboots | GENERIC |  | item:cragmaw_prowlboots |
| Cragmaw's Huntcord | GENERIC |  | item:cragmaw_huntcord |
| Cragprowl Belt | GENERIC |  | item:cragprowl_belt |
| Cragthorn Greatstaff | GENERIC |  | item:cragthorn_greatstaff |
| Cragwalker Boots | GENERIC |  | item:cragwalker_boots |
| Cragward Pauldrons | GENERIC |  | item:cragward_pauldrons |
| Craven Roar | GENERIC |  | ability:demoralizing_roar |
| Craven Thrust | GENERIC |  | ability:backstab |
| Creeping Rot | GENERIC |  | talentMastery:affliction |
| Crimson Amber | GENERIC |  | item:crimson_amber_armor_plate |
| Crimson Rift Gem | GENERIC |  | item:rift_gem_crimson |
| Critical Eye | GENERIC |  | deed:cmb_critical_eye |
| Crossroads Saber | GENERIC |  | item:crossroads_saber |
| Crumbled Spaulders | GENERIC |  | item:reliquary_shoulder |
| Crush | GENERIC |  | mobMechanic:rift_stone_ogre.stunOnHit |
| Crushing Charge | GENERIC |  | choiceRow:war_row_crushing_charge |
| Crushing Depth | GENERIC |  | mobMechanic:rift_boss_tide.deathZoneStrike |
| Crushing Sweep | GENERIC |  | mobMechanic:marrowlord_varkas.knockback |
| Cryomancy | GENERIC |  | talentSpec:frost |
| Crypt Keystone | GENERIC |  | item:crypt_keystone |
| Crypt Keystone Lower | GENERIC |  | item:priests_sigil |
| Crypt Keystone Upper | GENERIC |  | item:captains_crest |
| Crypt Shambler | GENERIC |  | mob:crypt_shambler |
| Cryptbone Greaves | GENERIC |  | item:cryptbone_greaves |
| Cryptbone Helm | GENERIC |  | item:cryptbone_helm |
| Cryptbone Pauldrons | GENERIC |  | item:cryptbone_pauldrons |
| Cryptbreaker | GENERIC |  | deed:dgn_hollow_crypt |
| Cryptplate Helm | GENERIC |  | item:cryptplate_helm |
| Crystalline Shallows | GENERIC |  | poi:3.6 |
| Cult Remnants | GENERIC |  | delveAffix:cult_remnants |
| Cultist Flayer | GENERIC |  | item:cultist_flayer |
| Curse of Frailty | GENERIC |  | mobMechanic:gravecaller_cultist.vulnerability |
| Curved Tusk | GENERIC |  | item:curved_tusk |
| Cut Mooring Line | GENERIC |  | item:fenway_mooring_line |
| Cutpurse Jerkin | GENERIC |  | item:footpad_jerkin |
| Cutthroat Tempo | GENERIC |  | ability:slice_and_dice |
| Cyan Magenta | GENERIC |  | item:cyan_magenta_armor_plate |
| Dash | GENERIC |  | ability:dash |
| Dawnhold Knight | GENERIC |  | mob:hedge_knight |
| Dawnward Ricochet | GENERIC |  | ability:aura_surge choiceRow:pal_r20_aura_mastery |
| Deacon Voss | GENERIC |  | mob:deacon_voss |
| Deacon's Cleaver | GENERIC |  | item:deacons_cleaver |
| Deacon's Reliquary Helm | GENERIC |  | item:deacon_reliquary_helm |
| Dead Men's Cargo | GENERIC |  | quest:q_gc_dead_mens_cargo |
| Deadly Venom | GENERIC |  | mobMechanic:rift_boss_venom.stackPoison |
| Dealer of Chance | GENERIC |  | npcTitle:card_master |
| Death Sentence | GENERIC |  | mobMechanic:rift_boss_necro.deathZoneStrike |
| Deathless Ardor | GENERIC |  | choiceRow:pal_r17_ardent_defender |
| Deathless Greatblade | GENERIC |  | item:deathless_greatblade |
| Deathless Warguard Legmail | GENERIC |  | item:deathless_warguard_legmail |
| Deathless Will | GENERIC |  | choiceRow:hun_r11_survival_instincts |
| Deathstalker Cleave | GENERIC |  | mobMechanic:deathstalker_voss.cleave |
| Deathstalker Voss | GENERIC |  | mob:deathstalker_voss |
| Declaration of Intent | GENERIC |  | deed:prog_specialized |
| Deep Hunger | GENERIC |  | choiceRow:wlk_r17_demonic_resilience |
| Deep Lurker | GENERIC |  | mob:rift_deep_lurker |
| Deep Roots | GENERIC |  | deed:prog_deep_roots |
| Deepened Hex | GENERIC |  | choiceRow:wlk_r14_amplify_curse |
| Deepfen Pearl | GENERIC |  | item:deepfen_pearl |
| Deepfen Shallows | GENERIC |  | poi:1.2 |
| Deepfen Snapper | GENERIC |  | mob:deepfen_murloc |
| Deepfen Spearjaw | GENERIC |  | mob:deepfen_spearjaw |
| Deeprock Burrows | GENERIC |  | poi:2.2 |
| Deeprock Digger | GENERIC |  | mob:tunnel_rat |
| Deeprock Trouble | GENERIC |  | quest:q_kobold_tunnels |
| Deeprock Tunneler | GENERIC |  | mob:deeprock_kobold |
| Defiant Bellow | GENERIC |  | ability:defiant_bellow |
| Desolation | GENERIC |  | talentMastery:destruction |
| Devour | GENERIC |  | mobMechanic:rift_boss_tide.lifeleech |
| Direfang Crown | GENERIC |  | item:nighttalon_crown item:heroic_nighttalon_crown |
| Direfang Greatblade | GENERIC |  | item:direfang_greatblade item:heroic_direfang_greatblade |
| Direfang Grips | GENERIC |  | item:nighttalon_grips |
| Direfang Pelt | GENERIC |  | itemSet:nighttalon deed:col_set_nighttalon |
| Direfang Quiver | GENERIC |  | item:direfang_quiver item:heroic_direfang_quiver |
| Direfang Shoulderguards | GENERIC |  | item:nighttalon_shoulderguards item:heroic_nighttalon_shoulderguards |
| Direfang Waistband | GENERIC |  | item:nighttalon_waistband |
| Dirge of Decay | GENERIC |  | ability:shadow_word_pain |
| Dirge of Tongues | GENERIC |  | mobMechanic:nhalia_mourner.tongues |
| Dirt Nap | GENERIC |  | ability:eviscerate |
| Dirt Toss | GENERIC |  | ability:blind |
| Disarming Smash | GENERIC |  | mobMechanic:ogre_crusher.disarm |
| Dive | GENERIC |  | ability:sport_dive sportAbility:sport_dive |
| Do Not Stand in the Spores | GENERIC |  | deed:chr_marsh_unburst |
| Doctrine | GENERIC |  | talentSpec:discipline |
| Double Blink | GENERIC |  | choiceRow:mag_r5_double_blink |
| Double Charge | GENERIC |  | choiceRow:war_row_double_charge |
| Double Digits | GENERIC |  | deed:prog_double_digits |
| Double Trouble | GENERIC |  | deed:pvp_fiesta_double |
| Doused Storm-Lantern | GENERIC |  | item:shear_storm_lantern |
| Down the Windway | GENERIC |  | quest:q_gc_down_the_windway |
| Downs Bandit | GENERIC |  | mob:downs_bandit |
| Dragon's Breath | GENERIC |  | ability:dragons_breath |
| Dragonkin Broodguard | GENERIC |  | mob:dragonkin_broodguard |
| Dragonkin Egg | GENERIC |  | mob:dragonkin_egg |
| Dragonkin Whelp | GENERIC |  | mob:dragonkin_whelp |
| Draining Litany | GENERIC |  | mobMechanic:gravecaller_mender.costTax |
| Drakelands Cairns | GENERIC |  | graveyard:gy_drakelands |
| Drakemaw Broodlord | GENERIC |  | mob:drakemaw_broodlord |
| Dread | GENERIC |  | mobMechanic:rift_dread_stalker.dread |
| Dread Aspect | GENERIC |  | ability:metamorphosis |
| Dread Chorus | GENERIC |  | ability:howl_of_terror choiceRow:wlk_r8_howl_of_terror |
| Dread Stalker | GENERIC |  | mob:rift_dread_stalker |
| Dressed for the Occasion | GENERIC |  | deed:pvp_fiesta_full_build |
| Dressed to the Elevens | GENERIC |  | deed:col_all_slots |
| Drover's Staff | GENERIC |  | item:drovers_staff |
| Drown | GENERIC |  | mobMechanic:rift_tide_thrall.lifeleech |
| Drowned | GENERIC |  | riftThemeNoun:7.2 |
| Drowned Cantor | GENERIC |  | mob:drowned_cantor |
| Drowned Chapel | GENERIC |  | poi:1.4 |
| Drowned Choir-Fang | GENERIC |  | item:drowned_choir_fang |
| Drowned Dead | GENERIC |  | mob:drowned_dead |
| Drowned Deckhand | GENERIC |  | mob:drowned_deckhand |
| Drowned Dirge | GENERIC |  | mobMechanic:drowned_cantor.petSpell |
| Drowned Moon Kris | GENERIC |  | item:drownedmoon_kris |
| Drowned Moon Maul | GENERIC |  | item:drownedmoon_maul |
| Drowned Moon Scepter | GENERIC |  | item:drownedmoon_scepter |
| Drowned Offering | GENERIC |  | item:drowned_offering |
| Drowned Prayer Leggings | GENERIC |  | item:drowned_prayer_leggings item:heroic_drowned_prayer_leggings |
| Drowned Prayer Sandals | GENERIC |  | item:drowned_prayer_sandals item:heroic_drowned_prayer_sandals |
| Drowned Templeguard | GENERIC |  | mob:drowned_templeguard |
| Drowned Thrall | GENERIC |  | mob:drowned_thrall |
| Drowned Tide Scepter | GENERIC |  | item:drowned_tide_scepter |
| Drowned Votary | GENERIC |  | mob:drowned_votary |
| Drownedguard Breastplate | GENERIC |  | item:drownedguard_breastplate |
| Drowning Grasp | GENERIC |  | mobMechanic:drowned_dead.lifeleech mobMechanic:drowned_warlord.lifeleech |
| Drowning Hymn | GENERIC |  | mobMechanic:deacon_voss.aoePulse |
| Drowning the Moon | GENERIC |  | deed:dgn_drowned_temple |
| Drownstep Sabatons | GENERIC |  | item:drownstep_sabatons |
| Drownstep Slippers | GENERIC |  | item:drownstep_slippers |
| Drownstep Treads | GENERIC |  | item:drownstep_treads |
| Druid | GENERIC |  | class:druid |
| Dry Eyes | GENERIC |  | deed:dgn_ysolei_flawless |
| Dune Troll | GENERIC |  | mob:dune_troll |
| Dusk | GENERIC |  | riftThemeNoun:5.3 |
| Dusk Dividend | GENERIC |  | choiceRow:rog_r5_opportunist |
| Duskborn | GENERIC |  | mob:duskborn |
| Duskfang Dirk | GENERIC |  | item:duskfang_dirk |
| Duskhide Wraps | GENERIC |  | item:duskhide_wraps |
| Duskthorn Mantle | GENERIC |  | item:duskthorn_mantle |
| Duskwisp | GENERIC |  | mob:duskwisp |
| Dust Yourself Off | GENERIC |  | deed:cmb_first_fall |
| Dustwarden Jerkin | GENERIC |  | item:reliquary_leather_chest |
| Early Grave | GENERIC |  | ability:execute |
| Earthbreaker | GENERIC |  | mobMechanic:rift_boss_brute.bigCast |
| Earthen Fury | GENERIC |  | talentMastery:elemental |
| Earthen Jolt | GENERIC |  | ability:earth_shock |
| Earthquake | GENERIC |  | ability:earthquake |
| Earthshatter | GENERIC |  | mobMechanic:rift_boss_brute.deathZoneCast |
| East Ridge Graves | GENERIC |  | graveyard:gy_thornpeak_east |
| Eastbrook | GENERIC |  | poi:0.0 |
| Eastbrook Arming Sword | GENERIC |  | item:eastbrook_arming_sword |
| Eastbrook Buckler | GENERIC |  | item:eastbrook_buckler |
| Eastbrook Chainmail Vest | GENERIC |  | item:eastbrook_chain_vest |
| Eastbrook Druid's Hide | GENERIC |  | item:eastbrook_druids_hide |
| Eastbrook Greatsword | GENERIC |  | item:eastbrook_greatsword |
| Eastbrook Rest | GENERIC |  | graveyard:gy_eastbrook |
| Eastbrook Ritual Vestments | GENERIC |  | item:eastbrook_ritual_vestments |
| Eastbrook Vale | GENERIC |  | zone:0 |
| Eastbrook Warded Leggings | GENERIC |  | item:eastbrook_warded_leggings |
| Eastbrook Wool Trousers | GENERIC |  | item:eastbrook_wool_trousers |
| Echoes of the Warden | GENERIC |  | quest:q_wardens_echoes |
| Edda Reedhand | GENERIC |  | mob:edda_reedhand delveCompanion:companion_edda |
| Edge and Temper | GENERIC |  | deed:prog_weaponcrafting_50 |
| Eel-Netter of Bridgemere | GENERIC |  | npcTitle:netter_maris |
| Eels for the Smokehouse | GENERIC |  | quest:q_wf_eels_for_the_smokehouse |
| Eels in the Reeds | GENERIC |  | deed:chr_marsh_first_cast |
| Eelscale Leggings | GENERIC |  | item:eelscale_leggings item:heroic_eelscale_leggings |
| Eelscale Treads | GENERIC |  | item:eelscale_treads item:heroic_eelscale_treads |
| Eelskin Mudwaders | GENERIC |  | item:eelskin_mudwaders |
| Eelskin Tunic | GENERIC |  | item:eelskin_tunic |
| Elder Bark | GENERIC |  | item:elder_bark |
| Elder Grove | GENERIC |  | poi:3.3 |
| Elder of the Divers | GENERIC |  | npcTitle:pearlmother_isha |
| Elemental Convergence | GENERIC |  | choiceRow:mag_r17_convergence |
| Elixir of the Bear | GENERIC |  | item:elixir_of_the_bear |
| Elixir of the Boar | GENERIC |  | item:elixir_of_the_boar |
| Elixir of the Serpent | GENERIC |  | item:elixir_of_the_serpent |
| Ember | GENERIC |  | riftThemeNoun:1.0 |
| Ember Breath | GENERIC |  | mobMechanic:voskar_emberwing.aoePulse |
| Ember Cache | GENERIC |  | item:hearth_ember_cache |
| Ember Fiend | GENERIC |  | mob:rift_ember_fiend |
| Ember Form | GENERIC |  | ability:fireball_form |
| Emberfang Warblade | GENERIC |  | item:emberfang_warblade |
| Emberforge Gauntlets | GENERIC |  | item:emberforge_gauntlets |
| Emberforge Tyrant | GENERIC |  | mob:rift_boss_ember |
| Emberforged Bulwark | GENERIC |  | item:emberforged_bulwark |
| Emberglass Warstaff | GENERIC |  | item:emberglass_warstaff |
| Emberkin | GENERIC |  | mob:emberkin |
| Embers on the Tarn Road | GENERIC |  | quest:q_fv_ember_caches |
| Emberwing Drake | GENERIC |  | mob:emberwing_drake |
| Emberwood Staff | GENERIC |  | item:emberwood_staff |
| Emberwrought Wand | GENERIC |  | weaponSkin:emberwrought_wand |
| Emboldening Roar | GENERIC |  | ability:emboldening_roar |
| Embroidered Mantle | GENERIC |  | item:embroidered_mantle |
| Enchant Belt - Agility | GENERIC |  | enchant:enchant_waist_agility |
| Enchant Belt - Stamina | GENERIC |  | enchant:enchant_waist_stamina |
| Enchant Belt - Strength | GENERIC |  | enchant:enchant_waist_strength |
| Enchant Boots - Agility | GENERIC |  | enchant:enchant_feet_agility |
| Enchant Boots - Stamina | GENERIC |  | enchant:enchant_feet_stamina |
| Enchant Boots - Strength | GENERIC |  | enchant:enchant_feet_strength |
| Enchant Chest - Greater Stamina | GENERIC |  | enchant:enchant_chest_greater_stamina |
| Enchant Chest - Reinforcement | GENERIC |  | enchant:enchant_chest_armor |
| Enchant Chest - Runed Weave | GENERIC |  | enchant:enchant_chest_runeweave |
| Enchant Chest - Spirit | GENERIC |  | enchant:enchant_chest_spirit |
| Enchant Chest - Stamina | GENERIC |  | enchant:enchant_chest_stamina |
| Enchant Gloves - Agility | GENERIC |  | enchant:enchant_gloves_agility |
| Enchant Gloves - Greater Agility | GENERIC |  | enchant:enchant_gloves_greater_agility |
| Enchant Gloves - Spellpower | GENERIC |  | enchant:enchant_gloves_intellect |
| Enchant Gloves - Strength | GENERIC |  | enchant:enchant_gloves_strength |
| Enchant Helmet - Fortitude | GENERIC |  | enchant:enchant_helmet_fortitude |
| Enchant Helmet - Greater Fortitude | GENERIC |  | enchant:enchant_helmet_greater_fortitude |
| Enchant Helmet - Intellect | GENERIC |  | enchant:enchant_helmet_intellect |
| Enchant Helmet - Reinforcement | GENERIC |  | enchant:enchant_helmet_armor |
| Enchant Helmet - Runed Links | GENERIC |  | enchant:enchant_helmet_runed_links |
| Enchant Legs - Greater Stamina | GENERIC |  | enchant:enchant_legs_greater_stamina |
| Enchant Legs - Intellect | GENERIC |  | enchant:enchant_legs_intellect |
| Enchant Legs - Runed Hide | GENERIC |  | enchant:enchant_legs_runed_hide |
| Enchant Legs - Stamina | GENERIC |  | enchant:enchant_legs_stamina |
| Enchant Necklace - Agility | GENERIC |  | enchant:enchant_neck_agility |
| Enchant Necklace - Intellect | GENERIC |  | enchant:enchant_neck_intellect |
| Enchant Necklace - Spirit | GENERIC |  | enchant:enchant_neck_spirit |
| Enchant Offhand - Stamina | GENERIC |  | enchant:enchant_offhand_stamina |
| Enchant Ring - Agility | GENERIC |  | enchant:enchant_ring_agility |
| Enchant Ring - Intellect | GENERIC |  | enchant:enchant_ring_intellect |
| Enchant Ring - Spirit | GENERIC |  | enchant:enchant_ring_spirit |
| Enchant Ring - Strength | GENERIC |  | enchant:enchant_ring_strength |
| Enchant Shoulders - Agility | GENERIC |  | enchant:enchant_shoulder_agility |
| Enchant Shoulders - Intellect | GENERIC |  | enchant:enchant_shoulder_intellect |
| Enchant Shoulders - Strength | GENERIC |  | enchant:enchant_shoulder_strength |
| Enchant Weapon - Agility | GENERIC |  | enchant:enchant_weapon_agility |
| Enchant Weapon - Greater Might | GENERIC |  | enchant:enchant_weapon_greater_might |
| Enchant Weapon - Greater Spellpower | GENERIC |  | enchant:enchant_weapon_greater_spellpower |
| Enchant Weapon - Might | GENERIC |  | enchant:enchant_weapon_might |
| Enchant Weapon - Runed Edge | GENERIC |  | enchant:enchant_weapon_runed_edge |
| Enchant Weapon - Runed Sigil | GENERIC |  | enchant:enchant_weapon_runed_focus |
| Enchant Weapon - Spellpower | GENERIC |  | enchant:enchant_weapon_intellect |
| Enchanting | GENERIC |  | craft:enchanting |
| Endless Dirge | GENERIC |  | choiceRow:pri_r14_pain_and_suffering |
| Engineering | GENERIC |  | craft:engineering |
| Eternal | GENERIC |  | deed:prog_eternal deedTitle:prog_eternal |
| Every Last Moonspawn | GENERIC |  | deed:dgn_ysolei_moonspawn |
| Exposed Wound | GENERIC |  | mobMechanic:mire_widow.critVuln |
| Eye Jab | GENERIC |  | ability:gouge |
| Eyes on the Vigil | GENERIC |  | quest:q_nb_eyes_on_the_vigil |
| Fallen Captain Aldren | GENERIC |  | mob:fallen_captain_aldren |
| Fallen Chapel | GENERIC |  | poi:0.7 |
| Fallen Star | GENERIC |  | skinCollection:fallen_star |
| False Face | GENERIC |  | talentMastery:subtlety |
| Fanglord Beastmaster | GENERIC |  | mob:wildheart_beastmaster |
| Fanglord's Beastspear | GENERIC |  | item:fanglords_beastspear item:heroic_fanglords_beastspear |
| Far-Dune Watcher | GENERIC |  | npcTitle:scout_yerrin |
| Farshore Salt Moss | GENERIC |  | item:farshore_salt_moss |
| Fault Line | GENERIC |  | choiceRow:sha_r5_concussion |
| Fault Rebuke | GENERIC |  | choiceRow:sha_r8_improved_earth_shock |
| Faultline | GENERIC |  | ability:faultline |
| Fearsome Twosome | GENERIC |  | deed:pvp_arena_2v2_1750 |
| Feeding Frenzy | GENERIC |  | mobMechanic:deepfen_spearjaw.frenzyOnHit |
| Feint | GENERIC |  | ability:sport_feint sportAbility:sport_feint |
| Fell Shot | GENERIC |  | ability:arcane_shot |
| Felling Axe | GENERIC |  | item:felling_axe |
| Fen Reaver Glaive | GENERIC |  | item:fen_reaver_glaive |
| Fen Sprite | GENERIC |  | mob:fen_sprite |
| Fenbark Leggings | GENERIC |  | item:fenbark_leggings |
| Fenbridge | GENERIC |  | poi:1.0 |
| Fenbridge Barrow | GENERIC |  | graveyard:gy_fenbridge |
| Fenbridge Foraging | GENERIC |  | deed:chr_marsh_gatherer |
| Fenbridge Hide Belt | GENERIC |  | item:fenbridge_hide_belt |
| Fenbridge Hide Boots | GENERIC |  | item:fenbridge_hide_boots |
| Fenbridge Hide Leggings | GENERIC |  | item:fenbridge_hide_leggings |
| Fenbridge Muster Order | GENERIC |  | item:fen_muster_order |
| Fenbridge Rye Loaf | GENERIC |  | item:fenbridge_rye |
| Fenland Bounty | GENERIC |  | deed:chr_willowfen_gatherer |
| Fenmist Robe | GENERIC |  | item:fenmist_robe |
| Fenreed Staff | GENERIC |  | item:fenreed_staff |
| Fenshadow Maul | GENERIC |  | item:fenshadow_maul |
| Fenwalker Boots | GENERIC |  | item:fenwalker_boots |
| Fenwarden Sabatons | GENERIC |  | item:fenwarden_sabatons |
| Ferry Lantern | GENERIC |  | item:mere_ferry_lantern |
| Ferrymaster Caddow | GENERIC |  | npc:ferrymaster_caddow |
| Festering Venom | GENERIC |  | ability:deadly_poison |
| Fetish and Bone | GENERIC |  | quest:q_troll_fetishes |
| Fettering Slash | GENERIC |  | ability:wing_clip |
| Fevered Draw | GENERIC |  | ability:rapid_fire |
| Field Marshal | GENERIC | superseded: ships as Warcrowned since the v0.36.0 merge (release PR #3133) | deed:pvp_honor_field_marshal deedTitle:pvp_honor_field_marshal |
| Field Surgeon | GENERIC |  | npcTitle:mender_saul |
| Fieldcraft | GENERIC |  | talentSpec:survival |
| Fifty Doors Down | GENERIC |  | deed:dgn_boss_clears_50 |
| Fifty Fathoms | GENERIC |  | deed:dlv_clears_50 |
| Final Argument Greatblade | GENERIC |  | item:final_argument_greatblade |
| Final Judgment | GENERIC |  | mobMechanic:rift_boss_brute.deathZoneStrike |
| Final Notice | GENERIC |  | choiceRow:rog_r14_seal_fate |
| Finding Your Feet | GENERIC |  | deed:prog_finding_your_feet |
| Fine Ashwood Log | GENERIC |  | item:fine_ashwood_log |
| Fine Copper Ore | GENERIC |  | item:fine_copper_ore |
| Fine Goldleaf Herb | GENERIC |  | item:fine_goldleaf_herb |
| Fine Highpine Log | GENERIC |  | item:fine_elderwood_log |
| Fine Iron Ore | GENERIC |  | item:fine_iron_ore |
| Fine Ironbark Log | GENERIC |  | item:fine_ironbark_log |
| Fine Osmium Ore | GENERIC |  | item:fine_thorium_ore |
| Fine Sunpetal Herb | GENERIC |  | item:fine_sunpetal_herb |
| Fine Tanning | GENERIC |  | deed:prog_leatherworking_rare |
| Fire Breath | GENERIC |  | mobMechanic:drakemaw_broodlord.breathCone mobMechanic:cindraleth_maw_matriarch.breathCone |
| Fire Demon | GENERIC |  | mob:warlock_imp |
| Firebottle | GENERIC |  | item:firebottle |
| First Blood | GENERIC |  | deed:cmb_first_blood |
| First Cut, Last Word | GENERIC |  | choiceRow:rog_r20_master_assassin |
| First Ice on the Tarn | GENERIC |  | deed:chr_frostveil_first_cast |
| First of the Herd | GENERIC |  | quest:q_hollow_first_of_the_herd |
| First Silverware | GENERIC |  | deed:pvp_vcup_first_win |
| First Steps | GENERIC |  | deed:prog_first_steps |
| First-Blood Razor | GENERIC |  | item:first_blood_razor |
| Fisher Bram | GENERIC |  | mob:fisher_bram |
| Fisherman Brandt | GENERIC |  | npc:fisherman_brandt |
| Fishing | GENERIC |  | gatheringProf:fishing |
| Fixed Purpose | GENERIC |  | talentMastery:discipline |
| Flagbearer | GENERIC |  | deedTitle:pvp_bg_wins_25 |
| Fleet Form | GENERIC |  | ability:travel_form |
| Fleetblood Band | GENERIC |  | item:fleetblood_band |
| Fleetfoot | GENERIC |  | augment:4 |
| Flense | GENERIC |  | ability:rake |
| Fletcher's Guild Bow | GENERIC |  | weaponSkin:fletcher_s_guild_bow |
| Flooded Paths | GENERIC |  | delveAffix:flooded_paths |
| Flotsam Crate | GENERIC |  | item:wreckfield_flotsam_crate |
| For the Banner | GENERIC |  | deed:pvp_vcup_guild_win |
| Foreman Odell | GENERIC |  | npc:foreman_odell |
| Forest Pink | GENERIC |  | item:forest_pink_armor_plate |
| Forest Wolf | GENERIC |  | mob:forest_wolf |
| Forge Work Order | GENERIC |  | quest:q_prof_workorder_forge |
| Forgemistress Darva | GENERIC |  | npc:forgemistress_darva |
| Forgotten Monument | GENERIC |  | item:monument_north |
| Forgotten Wound | GENERIC |  | mobMechanic:deathstalker_voss.mortalStrike |
| Founder's Quill | GENERIC |  | deed:soc_guild_founded |
| Foxes in the Lamplight | GENERIC |  | quest:q_af_foxes_in_the_lamplight |
| Frayed Prayer Beads | GENERIC |  | item:frayed_prayer_beads |
| Fresh Legs | GENERIC |  | ability:sport_second_wind sportAbility:sport_second_wind |
| Frightened Nell | GENERIC |  | npc:fisher_nell |
| Frost | GENERIC |  | riftThemeNoun:0.3 |
| Frostbound | GENERIC |  | riftTheme:0 |
| Frostbound Revenant | GENERIC |  | mob:rift_frost_revenant |
| Frostgill Chowder | GENERIC |  | item:frostgill_chowder |
| Frostveil Barrow | GENERIC |  | graveyard:gy_frostveil |
| Fruits of the Field | GENERIC |  | deed:prog_first_harvest |
| Full Creel | GENERIC |  | deed:col_full_creel |
| Full House | GENERIC |  | deed:soc_full_house |
| Funeral Chime | GENERIC |  | mobMechanic:reliquary_funeral_ringer.aoePulse |
| Funeral Ringer | GENERIC |  | mob:reliquary_funeral_ringer |
| Furious Mending | GENERIC |  | ability:furious_mending |
| FURY | GENERIC |  | npc:fury |
| Furyforged Battlegear | GENERIC |  | itemSet:warfare_furyforged |
| Furyforged Gauntlets | GENERIC |  | item:furyforged_gauntlets |
| Furyforged Girdle | GENERIC |  | item:furyforged_girdle |
| Furyforged Legguards | GENERIC |  | item:furyforged_legguards |
| Furyforged Sabatons | GENERIC |  | item:furyforged_sabatons |
| Furyforged Warhelm | GENERIC |  | item:furyforged_warhelm |
| Furyforged Warplate | GENERIC |  | item:furyforged_warplate |
| Furyforged Warspaulders | GENERIC |  | item:furyforged_warspaulders |
| Gag Order | GENERIC |  | ability:spell_lock |
| Gale | GENERIC |  | riftThemeNoun:6.3 |
| Gale Wisp | GENERIC |  | mob:gale_wisp |
| Galecall Crown | GENERIC |  | item:stormcallers_crown item:heroic_stormcallers_crown |
| Galecall Handguards | GENERIC |  | item:stormcallers_handguards |
| Galecall Spaulders | GENERIC |  | item:stormcallers_spaulders item:heroic_stormcallers_spaulders |
| Galecall Vestments | GENERIC |  | itemSet:stormcallers deed:col_set_stormcallers |
| Galecall Waistguard | GENERIC |  | item:stormcallers_waistguard |
| Gallowglass Hammer | GENERIC |  | item:bristleback_maul |
| Game Meat | GENERIC |  | item:game_meat |
| Gaping Wounds | GENERIC |  | ability:deep_wounds |
| Gardener Yew | GENERIC |  | npc:gardener_yew |
| Gatecaptain Brannoc | GENERIC |  | npc:gatecaptain_brannoc |
| Gatewarden Pell | GENERIC |  | npc:gatewarden_pell |
| Gatherer's Cache | GENERIC |  | item:gatherers_cache toolEffect:gatherers_cache |
| Gathering Sickle | GENERIC |  | item:gathering_sickle |
| Ghostly Essence | GENERIC |  | item:ghostly_essence |
| Giantslayer | GENERIC |  | deed:cmb_giantslayer |
| Gilded Sap Clot | GENERIC |  | item:gilded_sap_clot |
| Gilded Stag | GENERIC |  | mob:gilded_stag |
| Glacial Burst | GENERIC |  | mobMechanic:rift_boss_frost.aoePulse |
| Glacial Carapace | GENERIC |  | mobMechanic:rift_boss_frost.stoneskin |
| Glacial Front | GENERIC |  | ability:glacial_front |
| Glacial Grave | GENERIC |  | mobMechanic:rift_boss_frost.deathZoneCast |
| Glacier | GENERIC |  | riftThemeNoun:0.2 |
| Glacier Melt | GENERIC |  | item:glacier_melt |
| Glacier Tarn | GENERIC |  | poi:5.2 |
| Gladiator | GENERIC |  | deed:pvp_arena_1v1_1900 deedTitle:pvp_arena_1v1_1900 |
| Glass Vial | GENERIC |  | item:glass_vial |
| Gleamfolk Pixie | GENERIC |  | mob:mushroom_pixie |
| Gleaming Antler | GENERIC |  | item:gleaming_antler |
| Gleaming Antlers | GENERIC |  | quest:q_gleaming_antlers |
| Gleamstag Charm | GENERIC |  | item:gleamstag_charm |
| Gleamwood Stave | GENERIC |  | item:gleamwood_stave |
| Glimmer of Hope | GENERIC |  | deed:col_glimmerfin |
| Glimmermere Wader | GENERIC |  | mob:glimmermere_wader |
| Glimmerscale Lurker | GENERIC |  | mob:glimmerscale_lurker |
| Glimmerwisp | GENERIC |  | mob:glimmerwisp |
| Gloam Fox | GENERIC |  | mob:gloam_fox |
| Gloam Siphon | GENERIC |  | choiceRow:pri_r11_vampiric_embrace |
| Gloam Strider | GENERIC |  | mob:gloam_strider |
| Gloom Bolt | GENERIC |  | ability:shadow_bolt |
| Glowing Wax | GENERIC |  | item:glowing_wax |
| Goad | GENERIC |  | ability:taunt |
| Golden Moment | GENERIC |  | deed:pvp_vcup_golden_goal |
| Goldleaf Game Stew | GENERIC |  | item:goldleaf_game_stew |
| Goldleaf Healing Draught | GENERIC |  | item:goldleaf_healing_draught |
| Goldleaf Herb | GENERIC |  | item:goldleaf_herb |
| Goldleaf Mana Draught | GENERIC |  | item:goldleaf_mana_draught |
| Goldleaf Sickle | GENERIC |  | item:goldleaf_sickle |
| Grandmaster Alchemy | GENERIC |  | deed:prog_grandmaster_alchemy deedTitle:prog_grandmaster_alchemy |
| Grandmaster Armorcrafting | GENERIC |  | deed:prog_grandmaster_armorcrafting deedTitle:prog_grandmaster_armorcrafting |
| Grandmaster Cooking | GENERIC |  | deed:prog_grandmaster_cooking deedTitle:prog_grandmaster_cooking |
| Grandmaster Enchanting | GENERIC |  | deed:prog_grandmaster_enchanting deedTitle:prog_grandmaster_enchanting |
| Grandmaster Engineering | GENERIC |  | deed:prog_grandmaster_engineering deedTitle:prog_grandmaster_engineering |
| Grandmaster Leatherworking | GENERIC |  | deed:prog_grandmaster_leatherworking deedTitle:prog_grandmaster_leatherworking |
| Grandmaster Tailoring | GENERIC |  | deed:prog_grandmaster_tailoring deedTitle:prog_grandmaster_tailoring |
| Grandmaster Weaponcrafting | GENERIC |  | deed:prog_grandmaster_weaponcrafting deedTitle:prog_grandmaster_weaponcrafting |
| Grave | GENERIC |  | riftThemeNoun:3.3 |
| Grave Blight | GENERIC |  | mobMechanic:gravecaller_summoner.healAbsorb |
| Grave Chill | GENERIC |  | mobMechanic:wraithbinder_maldrec.aoePulse |
| Grave Hex | GENERIC |  | mobMechanic:reliquary_gravecall_acolyte.mortalStrike |
| Grave Inferno | GENERIC |  | mobMechanic:korzul_the_gravewyrm.infernoChannel |
| Grave Mending | GENERIC |  | mobMechanic:gravecaller_mender.mendAlly |
| Grave Mercy | GENERIC |  | talentMastery:holy |
| Grave of Royal Assassin Voss | GENERIC |  | item:grave_captain_voss |
| Grave Rhythm | GENERIC |  | choiceRow:wlk_r5_bane |
| Grave Tax | GENERIC |  | delveAffix:grave_tax |
| Grave-Candle | GENERIC |  | item:gallowmere_grave_candle |
| Grave-Cleaver | GENERIC |  | mobMechanic:fallen_captain_aldren.cleave |
| Grave-Silt Bulwark | GENERIC |  | mob:grave_silt_bulwark |
| Gravebound Silk Wraps | GENERIC |  | item:gravebound_silk_wraps |
| Gravecall Acolyte | GENERIC |  | mob:reliquary_gravecall_acolyte |
| Gravecaller Cipher | GENERIC |  | item:cult_cipher |
| Gravecaller Cultist | GENERIC |  | mob:gravecaller_cultist |
| Gravecaller Encampment | GENERIC |  | poi:1.6 |
| Gravecaller Mender | GENERIC |  | mob:gravecaller_mender |
| Gravecaller Summoner | GENERIC |  | mob:gravecaller_summoner |
| Gravecaller's Broadblade | GENERIC |  | item:gravecaller_blade |
| Gravecaller's Sigil | GENERIC |  | item:gravecaller_sigil |
| Gravedigger Mosley | GENERIC |  | mob:gravedigger_mosley |
| Gravenbark Shambler | GENERIC |  | mob:gravenbark_shambler |
| Gravepath Treads | GENERIC |  | item:gravepath_treads |
| Graves of the Forgotten | GENERIC |  | quest:q_nythraxis_graves |
| Gravescale Girdle | GENERIC |  | item:gravescale_girdle |
| Gravestalker Jerkin | GENERIC |  | item:cryptstalker_jerkin |
| Gravewalker Softboots | GENERIC |  | item:gravewalker_softboots |
| Gravewarden's Shiv | GENERIC |  | item:gravewardens_shiv |
| Gravewoven Bag | GENERIC |  | item:gravewoven_bag |
| Gravewoven Raiment | GENERIC |  | item:gravewoven_raiment |
| Gravewyrm Bone Quiver | GENERIC |  | item:gravewyrm_bone_quiver item:heroic_gravewyrm_bone_quiver |
| Gravewyrm Claws | GENERIC |  | item:gravewyrm_claws |
| Gravewyrm Cleaver | GENERIC |  | item:gravewyrm_cleaver |
| Gravewyrm Gauntlets | GENERIC |  | item:gravewyrm_gauntlets item:heroic_gravewyrm_gauntlets |
| Gravewyrm Mantle | GENERIC |  | item:gravewyrm_mantle item:heroic_gravewyrm_mantle |
| Gravewyrm Sabatons | GENERIC |  | item:gravewyrm_sabatons item:heroic_gravewyrm_sabatons |
| Gravewyrm Scale Hauberk | GENERIC |  | item:gravewyrm_scale_hauberk |
| Gravewyrm Sigil | GENERIC |  | item:gravewyrm_sigil |
| Gravewyrm Stalker's Treads | GENERIC |  | item:gravewyrm_stalkers_treads item:heroic_gravewyrm_stalkers_treads |
| Gravewyrm Thornmaul | GENERIC |  | item:gravewyrm_thornmaul item:heroic_gravewyrm_thornmaul |
| Gravity Always Wins | GENERIC |  | deed:hid_fall_death |
| Greasy Ram Wool | GENERIC |  | item:galecrest_ram_wool |
| Greasy Tallow Lump | GENERIC |  | item:tallow_candle |
| Greater Invisibility | GENERIC |  | ability:greater_invisibility choiceRow:mag_r8_greater_invis |
| Greatfang of the Basin | GENERIC |  | item:greatfang_of_the_basin |
| Green Thumb | GENERIC |  | deed:exp_first_herb |
| Greyjaw Hide Boots | GENERIC |  | item:greyjaw_hide_boots |
| Greyjaw Stalker's Kit | GENERIC |  | itemSet:greyjaw_stalker deed:col_set_greyjaw_stalker |
| Greyjaw's Pelt Leggings | GENERIC |  | item:greyjaw_pelt_cloak |
| Gripping Earth | GENERIC |  | ability:earthbind choiceRow:sha_r17_earthbind |
| Gripping Roots | GENERIC |  | ability:entangling_roots |
| Ground Pound | GENERIC |  | mobMechanic:mogger.aoePulse |
| Ground Slam | GENERIC |  | mobMechanic:warlord_drogmar.aoePulse |
| Groundskeeper Bram | GENERIC |  | npc:groundskeeper_bram |
| Grove Covenant | GENERIC |  | choiceRow:dru_r11_improved_mark |
| Grove's Gift | GENERIC |  | talentMastery:restoration |
| Grovewarden's Grips | GENERIC |  | item:grovewardens_grips item:heroic_grovewardens_grips |
| Grubjaw's Tusk | GENERIC |  | item:grubjaw_tusk |
| Guarded Stance | GENERIC |  | ability:defensive_stance |
| Guardian Core | GENERIC |  | item:guardian_core |
| Guiding Spirits | GENERIC |  | choiceRow:sha_r11_ancestral_guidance |
| Guildmark | GENERIC |  | skinCollection:guildmark |
| Guildmark Arming Sword | GENERIC |  | weaponSkin:guildmark_arming_sword |
| Guildmark Dirk | GENERIC |  | weaponSkin:guildmark_dirk |
| Gullhaven Rest | GENERIC |  | graveyard:gy_farshore |
| Gut Punch | GENERIC |  | ability:cheap_shot |
| Gutripper Shiv | GENERIC |  | item:gutripper_shiv |
| Gutting Strike | GENERIC |  | ability:raptor_strike |
| Hallowed Snare | GENERIC |  | choiceRow:pal_r8_consecrated_ground |
| Hallowed Wall | GENERIC |  | ability:holy_shield |
| Halo Aftershock | GENERIC |  | choiceRow:pri_r20_blessed_recovery |
| Hammer and Plate | GENERIC |  | deed:prog_armorcrafting_50 |
| Handaxe | GENERIC |  | item:handaxe |
| Harbormaster Odile | GENERIC |  | npc:harbormaster_odile |
| Harbormaster of Wickharbor | GENERIC |  | npcTitle:harbormaster_odile |
| Hard Bargain | GENERIC |  | ability:life_tap |
| Harrier's Guise | GENERIC |  | ability:aspect_of_the_hawk |
| Harrow | GENERIC |  | ability:fear |
| Harvest Hollow | GENERIC |  | poi:6.3 |
| Harvest of the Heights | GENERIC |  | deed:chr_peaks_gatherer |
| Harvest on the Headland | GENERIC |  | deed:chr_galecrest_gatherer |
| Harvest Under the Canopy | GENERIC |  | deed:chr_wraithwood_gatherer |
| Head Gardener Amaranth | GENERIC |  | npc:head_gardener_amaranth |
| Head Gardener of the Evergarden | GENERIC |  | npcTitle:head_gardener_amaranth |
| Headbutt | GENERIC |  | ability:skull_bash |
| Healing Potion | GENERIC |  | item:healing_potion |
| Heart of the Rift | GENERIC |  | item:heart_of_the_rift |
| Hearth-Lined Treads | GENERIC |  | item:hearthlined_treads |
| Hearthkeeper Maeve | GENERIC |  | npc:hearthkeeper_maeve |
| Hearts of the Ring | GENERIC |  | quest:q_spore_hearts |
| Heartwood Hewer | GENERIC |  | deed:prog_logging_100 |
| Heavy Hitter | GENERIC |  | deed:cmb_heavy_hitter |
| Heavy Purse | GENERIC |  | deed:soc_heavy_purse |
| Hedge Gnome | GENERIC |  | mob:hedge_gnome |
| Hellguard | GENERIC |  | mob:rift_hellguard |
| Herbalism | GENERIC |  | gatheringProf:herbalism |
| Herbalist | GENERIC |  | npcTitle:apothecary_lin npcTitle:herbalist_yara |
| Herbalist Yara | GENERIC |  | npc:herbalist_yara |
| Herbed Marsh Pike | GENERIC |  | item:herbed_marsh_pike |
| Heroic Mark | GENERIC |  | item:heroic_mark |
| Heroic Quartermaster | GENERIC |  | npcTitle:heroic_quartermaster |
| Heroic: Scourge No More | GENERIC |  | deed:dgn_nythraxis_heroic |
| Heroic: The Collapsed Reliquary | GENERIC |  | deed:dlv_reliquary_heroic |
| Heroic: The Drowned Litany | GENERIC |  | deed:dlv_litany_heroic |
| Heroic: The Drowned Temple | GENERIC |  | deed:dgn_drowned_temple_heroic |
| Heroic: The Hollow Crypt | GENERIC |  | deed:dgn_hollow_crypt_heroic |
| Heroic: The Sunken Bastion | GENERIC |  | deed:dgn_sunken_bastion_heroic |
| Heroic: The Wildheart Basin | GENERIC |  | deed:dgn_wildheart_basin_heroic |
| Hex of Anguish | GENERIC |  | ability:curse_of_agony |
| Hexcraft | GENERIC |  | talentSpec:affliction |
| Hexwood Staff of the Basin | GENERIC |  | item:wildheart_hexwood_staff item:heroic_wildheart_hexwood_staff |
| Hickory Shortstaff | GENERIC |  | item:hickory_shortstaff |
| High Water | GENERIC |  | delveAffix:high_water |
| Highpine Axe | GENERIC |  | item:elderwood_axe |
| Highpine Battle Staff | GENERIC |  | item:elderwood_battle_staff |
| Highpine Log | GENERIC |  | item:elderwood_log |
| Hoarfrost | GENERIC |  | riftThemeNoun:0.1 skinCollection:hoarfrost |
| Hoarfrost Edge | GENERIC |  | item:hoarfrost_edge |
| Hoarfrost Mantle | GENERIC |  | ability:frost_armor |
| Hoarfrost Vigil | GENERIC |  | weaponSkin:hoarfrost_vigil_staff |
| Hoarfrost Warden | GENERIC |  | mob:rift_boss_frost |
| Hobbling Cut | GENERIC |  | ability:hamstring |
| Hobnailed Boots | GENERIC |  | item:hobnail_boots |
| Hold the Riftfields | GENERIC |  | quest:q_fs_hold_the_riftfields |
| Hollow Acolyte | GENERIC |  | mob:hollow_acolyte |
| Hollow Nova | GENERIC |  | mobMechanic:captain_verlan.aoePulse |
| Hollowbone Hauberk | GENERIC |  | item:hollowbone_hauberk |
| Hollowbound Legguards | GENERIC |  | item:hollowbound_legguards |
| Holy Ground | GENERIC |  | ability:consecration |
| Homespun Cloth | GENERIC |  | item:homespun_cloth |
| Homespun Hood | GENERIC |  | item:homespun_hood |
| Homespun Mitts | GENERIC |  | item:homespun_mitts |
| Honor Quartermaster | GENERIC |  | npcTitle:fury |
| Hoof It | GENERIC |  | ability:sport_hoof sportAbility:sport_hoof |
| Hoof of Ruin | GENERIC |  | mobMechanic:rift_boss_pitlord.stomp |
| House Rules | GENERIC |  | deed:pvp_card_duel_first_win |
| Howling Gale | GENERIC |  | mobMechanic:thunzharr_waking_peak.aoeSlow mobMechanic:rift_boss_frost.aoeSlow |
| Howling Rage | GENERIC |  | ability:bestial_wrath |
| Hunter | GENERIC |  | class:hunter |
| Hunter's Game Skewer | GENERIC |  | item:hunters_game_skewer |
| Huntsman Deral | GENERIC |  | npc:huntsman_deral |
| Hush the Litany | GENERIC |  | deed:dlv_litany |
| Hushing Shot | GENERIC |  | ability:counter_shot |
| Ice Fang | GENERIC |  | weaponSkin:ice_fang_sword |
| Ice Wisp | GENERIC |  | mob:ice_wisp |
| Icevein Dirk | GENERIC |  | item:icevein_dirk |
| Idols of the Deep | GENERIC |  | quest:q_idols |
| Ignition | GENERIC |  | ability:ignition talentMastery:fire |
| Imbued Lifeblood | GENERIC |  | choiceRow:sha_r5_imbue_mastery |
| Imbued Tempo | GENERIC |  | choiceRow:sha_r14_weapon_fury |
| Imperial Crimson | GENERIC |  | item:imperial_crimson_armor_plate |
| Imperial Gold | GENERIC |  | item:imperial_gold_armor_plate |
| In Fernando We Trust | GENERIC |  | deed:soc_meet_bursar |
| Inert Storm Shard | GENERIC |  | item:inert_storm_shard |
| Inscription | GENERIC |  | craft:inscription |
| Into the Hollow | GENERIC |  | quest:q_hollow |
| Iron | GENERIC |  | riftThemeNoun:4.2 |
| Iron Aim | GENERIC |  | talentMastery:marksmanship |
| Iron Bellow | GENERIC |  | ability:battle_shout |
| Iron Mining Pick | GENERIC |  | item:iron_mining_pick |
| Iron Ore | GENERIC |  | item:iron_ore |
| Iron Resolve | GENERIC |  | ability:iron_resolve |
| Iron Vow Band | GENERIC |  | item:iron_vow_band |
| Ironbark Axe | GENERIC |  | item:ironbark_axe |
| Ironbark Boar Spear | GENERIC |  | item:ironbark_boar_spear |
| Ironbark Log | GENERIC |  | item:ironbark_log |
| Ironedge Longsword | GENERIC |  | item:ironedge_longsword |
| Ironguard | GENERIC |  | talentSpec:prot |
| Ironhide | GENERIC |  | augment:5 |
| Ironhide Reflex | GENERIC |  | choiceRow:dru_r17_survival_of_the_fittest |
| Ironlink Hauberk | GENERIC |  | item:ironlink_hauberk |
| Ironlink Legguards | GENERIC |  | item:ironlink_legguards |
| Ironlink Spaulders | GENERIC |  | item:ironlink_spaulders |
| Ironreel Fishing Rod | GENERIC |  | item:ironreel_fishing_rod |
| Ironshod Maul | GENERIC |  | item:ironshod_maul |
| Ironvein Foreman | GENERIC |  | mob:ironvein_foreman |
| Ironvein Lantern Staff | GENERIC |  | item:ironvein_lantern_staff |
| Ironvein Pickblade | GENERIC |  | item:ironvein_pickblade |
| Ironvein Sapper | GENERIC |  | mob:ironvein_sapper |
| Island Provisions | GENERIC |  | deed:chr_farshore_gatherer |
| Ivory Copper | GENERIC |  | item:ivory_copper_armor_plate |
| Jaguar Roar | GENERIC |  | mobMechanic:wildheart_high_priest.knockback |
| Jewelcrafting | GENERIC |  | craft:jewelcrafting |
| Joined the Family | GENERIC |  | deed:hid_codfather |
| Juggernaut | GENERIC |  | augment:10 |
| Keen Dirk | GENERIC |  | item:keen_dirk |
| Keen Eye | GENERIC |  | augment:3 |
| Keening Wail | GENERIC |  | mobMechanic:sister_nhalia.terrify |
| Keeper Bram | GENERIC |  | npc:keeper_bram |
| Keeper of the Garden Gate | GENERIC |  | npcTitle:gatewarden_pell |
| Keeper of the Garrison Stores | GENERIC |  | npcTitle:quartermaster_sela |
| Keeper of the Gilded Rows | GENERIC |  | npcTitle:orchardist_pomeline |
| Keeper of the Hearth-Lodge | GENERIC |  | npcTitle:hearthkeeper_maeve |
| Keeper of the Hollow | GENERIC |  | npcTitle:keeper_saelwyn |
| Keeper of the Lantern Ferries | GENERIC |  | npcTitle:ferrymaster_caddow |
| Keeper of the Old Beacon | GENERIC |  | npcTitle:keeper_bram |
| Keeper of the Old Forges | GENERIC |  | npcTitle:wardsmith_orun |
| Keeper of the Sowfield | GENERIC |  | npcTitle:groundskeeper_bram |
| Keeper of the World Market | GENERIC |  | npcTitle:the_merchant npcTitle:auctioneer_voss |
| Keepers of the Wardstones | GENERIC |  | deed:dgn_nythraxis_wardens |
| Kick | GENERIC |  | ability:sport_kick sportAbility:sport_kick |
| Killer's Calm | GENERIC |  | ability:cold_blood |
| Kilnscale Mantle | GENERIC |  | item:sootscale_mantle |
| Kindled Faith | GENERIC |  | talentMastery:holy |
| King's Signet | GENERIC |  | item:kings_signet |
| Kitchens Work Order | GENERIC |  | quest:q_prof_workorder_kitchens |
| Kneel to No King | GENERIC |  | deed:dgn_nythraxis_gravebreaker |
| Knife's Dividend | GENERIC |  | choiceRow:rog_r5_improved_backstab |
| Knifework | GENERIC |  | talentSpec:assassination |
| Knight-Commander Olen | GENERIC |  | mob:knight_commander_olen |
| Knight-Commander's Greaves | GENERIC |  | item:knight_commanders_greaves |
| Lacquered Rod | GENERIC |  | weaponSkin:lacquered_wand |
| Lamplighter Sorrel | GENERIC |  | npc:lamplighter_sorrel |
| Lampman Cobb | GENERIC |  | npc:lampman_cobb |
| Lanterns on the Shear | GENERIC |  | quest:q_gc_lanterns_on_the_shear |
| Lanterns on the Water | GENERIC |  | quest:q_af_lanterns_on_the_water |
| Last Prayer | GENERIC |  | ability:desperate_prayer choiceRow:pri_r17_desperate_prayer |
| Last Rite | GENERIC |  | ability:lay_on_hands |
| Last-Step Signet | GENERIC |  | item:last_step_signet |
| Leaden Hex | GENERIC |  | ability:curse_of_exhaustion choiceRow:wlk_r8_curse_of_exhaustion |
| Leaden Venom | GENERIC |  | ability:crippling_poison |
| Lean Quiver | GENERIC |  | choiceRow:hun_r11_efficiency |
| Leatherworking | GENERIC |  | craft:leatherworking |
| Ledger Rot | GENERIC |  | mobMechanic:reliquary_ledger_wraith.corrode |
| Ledger Wraith | GENERIC |  | mob:reliquary_ledger_wraith |
| Legion of One | GENERIC |  | deed:cmb_legion_of_one |
| Lesser Healing Potion | GENERIC |  | item:lesser_healing_potion |
| Lesser Mana Potion | GENERIC |  | item:lesser_mana_potion |
| Levyman's Tunic | GENERIC |  | item:recruit_tunic |
| Life of the Fiesta | GENERIC |  | deed:pvp_fiesta_first_win |
| Light on the Water | GENERIC |  | quest:q_glimmermere_light |
| Lightning Rod | GENERIC |  | mobMechanic:rift_boss_storm.deathZoneCast |
| Lights of the Shallows | GENERIC |  | quest:q_wisp_lights |
| Lights over the Steps | GENERIC |  | quest:q_fv_lights_over_steps |
| Lightward | GENERIC |  | ability:divine_shield choiceRow:pal_r17_divine_shield |
| Lily Wisp | GENERIC |  | mob:lily_wisp |
| Linen Pouch | GENERIC |  | item:linen_pouch |
| Linen Scrap | GENERIC |  | item:linen_scrap |
| Lingering Dread | GENERIC |  | choiceRow:war_row_lingering_dread |
| Lingering Grace | GENERIC |  | ability:renew |
| Litany of Resolve | GENERIC |  | ability:power_word_fortitude |
| Litany of Woe | GENERIC |  | ability:mind_flay |
| Litany Pulse | GENERIC |  | mobMechanic:drowned_cantor.mendAlly |
| Lively Choir | GENERIC |  | delveAffix:lively_choir |
| Living off the Land | GENERIC |  | deed:chr_vale_gatherer |
| Logging | GENERIC |  | gatheringProf:logging |
| Long Draw | GENERIC |  | ability:aimed_shot |
| Long Punt | GENERIC |  | ability:sport_punt sportAbility:sport_punt |
| Loom Work Order | GENERIC |  | quest:q_prof_workorder_loom |
| Loremaster | GENERIC |  | npcTitle:loremaster_caddis |
| Loremaster Caddis | GENERIC |  | npc:loremaster_caddis |
| Loremother Bryn | GENERIC |  | npc:loremother_bryn |
| Lost Caravan Goods | GENERIC |  | item:lost_caravan_goods |
| Low Blow | GENERIC |  | ability:kidney_shot |
| Lunar Choir Leggings | GENERIC |  | item:lunar_choir_leggings |
| Lunar Tempest | GENERIC |  | ability:moonfire |
| Lunar Tide | GENERIC |  | mobMechanic:ysolei.aoePulse |
| Lunar Tide Greatstaff | GENERIC |  | item:lunar_tide_greatstaff |
| Lunarward Cinch | GENERIC |  | item:lunarward_cinch |
| Lurker's Strike | GENERIC |  | ability:ambush |
| Maddening Whisper | GENERIC |  | mobMechanic:wyrmcult_zealot.enfeeble |
| Made By Hand | GENERIC |  | deed:prog_first_craft |
| Mage | GENERIC |  | class:mage |
| Magenta Cyan | GENERIC |  | item:magenta_cyan_armor_plate |
| Magma | GENERIC |  | riftThemeNoun:1.2 |
| Magma Brute | GENERIC |  | mob:rift_magma_brute |
| Magma Crash | GENERIC |  | mobMechanic:rift_boss_ember.stomp |
| Magma Well | GENERIC |  | mobMechanic:rift_boss_ember.deathZoneCast |
| Magnate | GENERIC |  | deedTitle:soc_market_magnate |
| Magpie | GENERIC |  | deed:col_discovery_75 |
| Maiming Strike | GENERIC |  | mobMechanic:bastion_revenant.mortalStrike ability:mortal_strike |
| Making the Rounds | GENERIC |  | deed:dgn_thornpeak_rounds |
| Mana Burn | GENERIC |  | mobMechanic:rift_void_acolyte.manaBurn |
| Mana Potion | GENERIC |  | item:mana_potion |
| Mana Sear | GENERIC |  | mobMechanic:wyrmcult_necromancer.manaBurn |
| Mana Shield | GENERIC |  | mobMechanic:rift_boss_arcane.stoneskin |
| Mantle of the Fountain Court | GENERIC |  | item:fountain_court_mantle |
| Mantle of the Lily-Bed | GENERIC |  | item:lilybed_mantle |
| Mantle of the Meredark | GENERIC |  | item:mantle_of_the_meredark |
| Mantle of the Sunken Idol | GENERIC |  | item:sunken_idol_mantle |
| Mantle of the Unbroken Shore | GENERIC |  | item:mantle_of_the_unbroken_shore |
| Mantle of the Unhorsed | GENERIC |  | item:mantle_of_the_unhorsed |
| Mantle of the Wreck Warden | GENERIC |  | item:wreck_wardens_mantle |
| Marginalia | GENERIC |  | deed:dlv_lore_journal |
| Market Magnate | GENERIC |  | deed:soc_market_magnate |
| Marla Hitchen | GENERIC |  | npc:stablemaster_marla |
| Marlow's Grand Roast | GENERIC |  | item:marlows_grand_roast |
| Marrow | GENERIC |  | riftThemeNoun:3.1 |
| Marrow and Ash | GENERIC |  | quest:q_dk_marrow_and_ash |
| Marrow Harvest | GENERIC |  | mobMechanic:rift_boss_necro.bigCast |
| Marrow Rot | GENERIC |  | mobMechanic:marrowlord_varkas.aoePulse |
| Marrow Troll | GENERIC |  | mob:rift_marrow_troll |
| Marrowlord Boneboots | GENERIC |  | item:marrowlord_boneboots |
| Marrowtread Boots | GENERIC |  | item:marrowtread_boots |
| Marsh Chronicle, Chapter I | GENERIC |  | deed:chr_marsh_chapter_i |
| Marsh Chronicle, Chapter II | GENERIC |  | deed:chr_marsh_chapter_ii |
| Marsh Mint Tea | GENERIC |  | item:marsh_mint_tea |
| Marshal Redbrook | GENERIC |  | npc:marshal_redbrook |
| Marshal's Scout | GENERIC |  | npcTitle:scout_maren npcTitle:scout_maren_highwatch |
| Marshcloth Robe | GENERIC |  | item:marshcloth_robe |
| Marshlight Hauberk | GENERIC |  | item:marshlight_hauberk |
| Marshstalker Hood | GENERIC |  | item:marshstalker_hood |
| Marshstalker Jerkin | GENERIC |  | item:marshstalker_jerkin |
| Marshstalker Spaulders | GENERIC |  | item:marshstalker_spaulders |
| Marshstrider Boots | GENERIC |  | item:marshstrider_boots |
| Marten's Guise | GENERIC |  | ability:aspect_of_the_monkey |
| Master Angler | GENERIC |  | deed:prog_master_angler deedTitle:prog_master_angler |
| Master Armorer | GENERIC |  | npcTitle:armorer_hode talentMastery:arms |
| Master Gatherer | GENERIC |  | deed:prog_master_gatherer |
| Master of the Apothecary | GENERIC |  | npcTitle:alchemist_verane |
| Master of the Fenway | GENERIC |  | npcTitle:bridgewright_alden |
| Master of the Forge | GENERIC |  | npcTitle:forgemistress_darva |
| Master of the Kitchens | GENERIC |  | npcTitle:cook_marlow |
| Master of the Loom | GENERIC |  | npcTitle:weaver_ottilie |
| Master of the Meadow | GENERIC |  | deed:prog_herbalism_100 |
| Master of the Tannery | GENERIC |  | npcTitle:tanner_hesk |
| Master of the Toolworks | GENERIC |  | npcTitle:tinker_gizzel |
| Master of the Warfare Stores | GENERIC |  | npcTitle:warmarshal_draven_kole |
| Matriarch of the Maw | GENERIC |  | quest:q_dk_matriarch_of_the_maw |
| Maul of the Scourged Wilds | GENERIC |  | item:maul_of_the_scourged_wilds item:heroic_maul_of_the_scourged_wilds |
| Maw Cleave | GENERIC |  | mobMechanic:cindraleth_maw_matriarch.arcCleave |
| Mawscale Pauldrons | GENERIC |  | item:mawscale_pauldrons |
| Mayhem | GENERIC |  | ability:enrage_passive |
| Measured Fury | GENERIC |  | ability:measured_fury |
| Measured Mercy | GENERIC |  | choiceRow:pri_r11_meditation |
| Medallion of Endless Profit | GENERIC |  | item:medallion_of_endless_profit |
| Medallion of the Final Oath | GENERIC |  | item:final_oath_medallion |
| Meltwater Flask | GENERIC |  | item:meltwater_flask |
| Menace | GENERIC |  | ability:growl |
| Menace in the Glade | GENERIC |  | quest:q_grove_menace |
| Mender Saul | GENERIC |  | npc:mender_saul |
| Mending | GENERIC |  | augment:6 |
| Mending Light | GENERIC |  | ability:holy_light |
| Mending Waters | GENERIC |  | ability:healing_wave |
| Mercy Deferred | GENERIC |  | choiceRow:pri_r14_greater_heal |
| Mercy from Ruin | GENERIC |  | choiceRow:pal_r11_guardians_favor |
| Mercy Seed | GENERIC |  | choiceRow:dru_r14_empowered_touch |
| Mere Lurker | GENERIC |  | mob:mere_lurker |
| Milepost Boots | GENERIC |  | item:milepost_boots |
| Militia Chainvest | GENERIC |  | item:militia_vest |
| Mind the Moorings | GENERIC |  | quest:q_wf_mind_the_moorings |
| Mine Foreman | GENERIC |  | npcTitle:foreman_odell |
| Mining | GENERIC |  | gatheringProf:mining |
| Minor Healing Potion | GENERIC |  | item:minor_healing_potion |
| Minor Mana Potion | GENERIC |  | item:minor_mana_potion |
| Mire Prowler | GENERIC |  | mob:mire_prowler |
| Mire Prowler Pelt | GENERIC |  | item:mire_prowler_pelt |
| Mirebloom Treads | GENERIC |  | item:mirebloom_treads |
| Mirefen Marsh | GENERIC |  | zone:1 |
| Mirefen Skinner | GENERIC |  | item:mirefen_skinner |
| Mirefen Troll | GENERIC |  | mob:fen_troll |
| Mirefen Troll Fetish | GENERIC |  | item:troll_fetish |
| Mirefen Widow | GENERIC |  | mob:mire_widow |
| Mirefen Widowling | GENERIC |  | mob:mirefen_widowling |
| Mirejaw Biteblade | GENERIC |  | item:mirejaw_biteblade |
| Mirejaw Fang-Knife | GENERIC |  | item:mirejaw_fang_knife |
| Mirejaw Frenzy | GENERIC |  | mob:mirejaw_frenzy |
| Mirejaw Oracle Staff | GENERIC |  | item:mirejaw_oracle_staff |
| Mirejaw Scale Vest | GENERIC |  | item:mirejaw_scale_vest |
| Mirejaw the Ravenous | GENERIC |  | mob:mirejaw_the_ravenous |
| Mirewarden Jerkin | GENERIC |  | item:mirewarden_jerkin |
| Mirewarden Leggings | GENERIC |  | item:mirewarden_leggings |
| Mirewarden Treads | GENERIC |  | item:mirewarden_treads |
| Miring Pounce | GENERIC |  | mobMechanic:mire_prowler.slowStrike |
| Mirror Lake | GENERIC |  | poi:0.3 |
| Mirrored Blades | GENERIC |  | ability:blade_flurry |
| Mist Surge | GENERIC |  | mobMechanic:vael_the_mistcaller.aoePulse |
| Mistbinder Kris | GENERIC |  | item:mistbinder_kris |
| Mistcaller's Fang | GENERIC |  | item:mistcallers_fang |
| Mistress of the Wreck Line | GENERIC |  | npcTitle:salvage_boss_ryna |
| Mistveil Cord | KEEP | relabeled at QA: Mistveil is a known coin in Skyrim (Mistveil Keep) and MTG (Mistveil Plains); multi-property, kept under bar rule 2 | item:mistveil_cord |
| Mistveil Grips | KEEP | relabeled at QA: same Mistveil multi-property record as Mistveil Cord | item:mistveil_grips |
| Monarch's Crown | GENERIC |  | item:monarch_crown_helm |
| Moon Boots | GENERIC |  | powerup:2 |
| Moonbark Vestments | GENERIC |  | item:moonbark_vestments |
| Moonfleece Grazer | GENERIC |  | mob:moonfleece_grazer |
| Moonfleece Mitts | GENERIC |  | item:moonfleece_mitts |
| Moonfleece Tuft | GENERIC |  | item:moonfleece_tuft |
| Moonlit Bloom | GENERIC |  | deed:col_moonlit_bloom |
| Moonpale Scale | GENERIC |  | item:moonpale_scale |
| Moonscale Saber | GENERIC |  | item:moonscale_saber |
| Moonspawn | GENERIC |  | mob:moonspawn |
| Moonwing Form | GENERIC |  | ability:moonkin_form |
| Moonwrack Breastplate | GENERIC |  | item:moonshroud_breastplate item:heroic_moonshroud_breastplate |
| Moonwrack Robe | GENERIC |  | item:moonshroud_robe item:heroic_moonshroud_robe |
| Moonwrack Tunic | GENERIC |  | item:moonshroud_tunic item:heroic_moonshroud_tunic |
| Moor Ram | GENERIC |  | mob:moor_ram |
| More Names Cut into the Crag | GENERIC |  | deed:chr_peaks_rares_ii |
| Moss and Mending | GENERIC |  | quest:q_fs_moss_and_mending |
| Moss-Shell Stalk-Glider | GENERIC |  | mount:stalkglider_snail |
| Mossgrown Handwraps | GENERIC |  | item:mossy_handwraps |
| Mosshide Vest | GENERIC |  | item:mosshide_vest |
| Motes of the Aurora | GENERIC |  | quest:q_fv_aurora_motes |
| Mother Sedge | GENERIC |  | npc:mother_sedge |
| Mounting Rage | GENERIC |  | mobMechanic:warlord_drogmar.rampage |
| Mournweave Legwraps | GENERIC |  | item:necromancers_legwraps |
| Mournweave Raiment | GENERIC |  | itemSet:necromancers deed:col_set_necromancers |
| Mournweave Soulspire Mantle | GENERIC |  | item:necromancers_soulspire_mantle item:heroic_necromancers_soulspire_mantle |
| Mournweave Soulsteps | GENERIC |  | item:necromancers_soulsteps item:heroic_necromancers_soulsteps |
| Mournweave Starshroud | GENERIC |  | item:necromancers_starshroud item:heroic_necromancers_starshroud |
| Mudfin Hut | GENERIC |  | item:murloc_hut |
| Mudfin Skulker | GENERIC |  | mob:mudfin_murloc |
| Mysterious Cosmetic Cache | GENERIC |  | item:event_skin_token |
| Mythic | GENERIC |  | deed:prog_mythic deedTitle:prog_mythic |
| Named in the Mist | GENERIC |  | deed:chr_marsh_rares |
| Names Cut into the Crag | GENERIC |  | deed:chr_peaks_rares |
| Natural Hundred | GENERIC |  | deed:hid_roll_hundred |
| Nature's Fury | GENERIC |  | choiceRow:dru_r20_improved_hurricane |
| Navigator Suli | GENERIC |  | mob:castaway_navigator |
| Necrotic Blight | GENERIC |  | mobMechanic:rift_boss_necro.healAbsorb |
| Netter Maris | GENERIC |  | npc:netter_maris |
| Nightbloom Blossom | GENERIC |  | item:gloamfield_nightbloom |
| Nightfang Harness | GENERIC |  | item:wyrmshadow_harness item:heroic_wyrmshadow_harness |
| Nightfang Legguards | GENERIC |  | item:wyrmshadow_legguards item:heroic_wyrmshadow_legguards |
| Nightfang Talongrips | GENERIC |  | item:wyrmshadow_talongrips item:heroic_wyrmshadow_talongrips |
| Nightfang Treads | GENERIC |  | item:wyrmshadow_treads item:heroic_wyrmshadow_treads |
| Nightfang Vestments | GENERIC |  | itemSet:wyrmshadow deed:col_set_wyrmshadow |
| Nightfang's Greatstaff | GENERIC |  | item:nightfangs_greatstaff item:heroic_nightfangs_greatstaff |
| Nightveil Tunic | GENERIC |  | item:shadowmeld_tunic item:heroic_shadowmeld_tunic |
| Nightwalk Jerkin | GENERIC |  | item:nightwalk_jerkin |
| Nightweave Tunic | GENERIC |  | item:nightweave_tunic |
| No Bones About It | GENERIC |  | deed:dgn_morthen_flawless |
| No Rest in the Reeds | GENERIC |  | quest:q_no_rest |
| No Thrall of Mine | GENERIC |  | deed:dgn_vael_thralls |
| None More Deathless | GENERIC |  | deed:dgn_nythraxis_deathless |
| Not on Her Watch | GENERIC |  | deed:hid_companion_save |
| Nothing Gets Past Me | GENERIC |  | deed:pvp_vcup_clean_sheet |
| Numbing Chill | GENERIC |  | mobMechanic:stormcrag_elemental.chillOnHit |
| Oaken Reflex | GENERIC |  | choiceRow:dru_r17_improved_barkskin |
| Oakhide | GENERIC |  | ability:barkskin |
| Oath of Iron | GENERIC |  | ability:blessing_of_might |
| Oath of the Round Table | GENERIC |  | item:oath_of_the_round_table |
| Oath Returned | GENERIC |  | choiceRow:pal_r5_crusaders_zeal |
| Oathbound Greaves | GENERIC |  | item:oathbound_greaves |
| of the Mirefen | GENERIC |  | deedTitle:chr_marsh_chapter_iii |
| of the Vale | GENERIC |  | deedTitle:chr_vale_chapter_iii |
| Off the Mark | GENERIC |  | deed:pvp_vcup_first_goal |
| Off-Balance | GENERIC |  | mobMechanic:deeprock_kobold.staggerHit |
| Ogre Bonecharm Staff | GENERIC |  | item:ogre_bonecharm_staff |
| Ogre Foothills | GENERIC |  | poi:2.3 |
| Ogre Toe Ring | GENERIC |  | item:ogre_toe_ring |
| Ogre War Totem | GENERIC |  | item:ogre_war_totem |
| Ogres at the Foothills | GENERIC |  | quest:q_ogre_edges |
| Oiled Leather Boots | GENERIC |  | item:oiled_boots |
| Old Cragmaw's Pelt | GENERIC |  | item:old_cragmaws_pelt |
| Old Greyjaw | GENERIC |  | mob:old_greyjaw |
| Old Greyjaw's Fang | GENERIC |  | item:greyjaw_fang |
| Old Habits | GENERIC |  | deed:prog_prestige_5 |
| Old Marrowshell | GENERIC |  | mob:old_marrowshell |
| Old Mechanisms | GENERIC |  | delveAffix:old_mechanisms |
| Old Salt | GENERIC |  | npcTitle:fisherman_brandt deed:prog_fishing_100 |
| One of Everything | GENERIC |  | deed:pvp_fiesta_powerups |
| Onrush | GENERIC |  | mobMechanic:crypt_shambler.charge mobMechanic:sexton_marrow.charge mobMechanic:bastion_revenant.charge mobMechanic:drowned_thrall.charge mobMechanic:knight_commander_olen.charge mobMechanic:sanctum_boneguard.charge mobMechanic:raised_bonewalker.charge mobMechanic:drowned_templeguard.charge mobMechanic:pearlguard_sentinel.charge ability:charge |
| Onyx Gold | GENERIC |  | item:onyx_gold_armor_plate |
| Open for Business | GENERIC |  | deed:soc_first_sale |
| Orange Steel | GENERIC |  | item:orange_steel_armor_plate |
| Orange You Lucky | GENERIC |  | deed:col_first_legendary |
| Orchard Treant | GENERIC |  | mob:orchard_treant |
| Orchardist Pomeline | GENERIC |  | npc:orchardist_pomeline |
| Orders from Below | GENERIC |  | quest:q_cult_orders |
| Ore in the Blood | GENERIC |  | deed:prog_mining_100 |
| Osmium Mining Pick | GENERIC |  | item:thorium_mining_pick |
| Osmium Ore | GENERIC |  | item:thorium_ore |
| Osmium Warblade | GENERIC |  | item:thorium_warblade |
| Osmiumscale Cuirass | GENERIC |  | item:thoriumscale_cuirass |
| Osmiumscale Greathelm | GENERIC |  | item:thoriumscale_greathelm |
| Osmiumscale Leggings | GENERIC |  | item:thoriumscale_leggings |
| Ossuary | GENERIC |  | riftThemeNoun:3.2 |
| Ossuary Watch Helm | GENERIC |  | item:reliquary_helm |
| Outrider Brigandine | GENERIC |  | item:outrider_brigandine |
| Outrider Legguards | GENERIC |  | item:outrider_legguards |
| Outrider Sabatons | GENERIC |  | item:outrider_sabatons |
| Overdrive | GENERIC |  | augment:17 |
| Overflowing Power | GENERIC |  | choiceRow:mag_r20_overflowing_power |
| Overload | GENERIC |  | ability:overload choiceRow:mag_r14_overload |
| Packbreaker | GENERIC |  | deed:chr_vale_packbreaker |
| Packlord | GENERIC |  | talentSpec:beast_mastery |
| Packrat | GENERIC |  | deed:col_discovery_25 |
| Pact Acolyte | GENERIC |  | mob:rift_pact_acolyte |
| Pact Deepened | GENERIC |  | choiceRow:wlk_r5_improved_immolate |
| Pact Flame | GENERIC |  | mobMechanic:rift_boss_ritualist.bigCast |
| Pact Rot | GENERIC |  | mobMechanic:rift_pact_acolyte.soulrot mobMechanic:rift_boss_ritualist.soulrot |
| Pactbound | GENERIC |  | talentSpec:demonology |
| Pactbound Vestments | GENERIC |  | item:pactbound_vestments |
| Paid in Pain | GENERIC |  | choiceRow:rog_r8_improved_kidney_shot |
| Paladin | GENERIC |  | class:paladin |
| Pale Choir Acolyte | GENERIC |  | mob:pale_choir_acolyte |
| Pale Pearl | GENERIC |  | item:pale_pearl |
| Palecoil Rod | GENERIC |  | item:palecoil_rod |
| Palethread Slippers | GENERIC |  | item:silverthread_slippers |
| Palmreach Rest | GENERIC |  | graveyard:gy_palmreach |
| Pan-Seared River Perch | GENERIC |  | item:pan_seared_perch |
| Paragon | GENERIC |  | deed:prog_paragon deedTitle:prog_paragon |
| Party Crasher | GENERIC |  | deed:pvp_fiesta_first_bout |
| Party Pooper | GENERIC |  | deed:pvp_fiesta_shutdown |
| Pass | GENERIC |  | ability:sport_pass sportAbility:sport_pass |
| Patch Up | GENERIC |  | ability:revive_pet ability:mend_pet choiceRow:hun_r11_mend_pet |
| Peaks Chronicle, Chapter I | GENERIC |  | deed:chr_peaks_chapter_i |
| Peaks Chronicle, Chapter II | GENERIC |  | deed:chr_peaks_chapter_ii |
| Peaksong Helm | GENERIC |  | item:peaksong_helm |
| Peakwool Robe | GENERIC |  | item:peakwool_robe |
| Pearl-Mother Isha | GENERIC |  | npc:pearlmother_isha |
| Pearlguard Sentinel | GENERIC |  | mob:pearlguard_sentinel |
| Pearlwake Cargo Crate | GENERIC |  | item:pearlwake_cargo_crate |
| Pearlward Aegis | GENERIC |  | item:pearlward_aegis |
| Pelts for the Causeway | GENERIC |  | quest:q_prowler_pelts |
| Pelts for the Lodge | GENERIC |  | quest:q_fv_winter_pelts |
| Perfect Moment | GENERIC |  | ability:perfect_moment |
| Perfect Partnership | GENERIC |  | deed:pvp_arena_2v2_1900 |
| Perpetual Motion | GENERIC |  | deed:prog_prestige_10 |
| Pick Meets Stone | GENERIC |  | deed:exp_first_ore |
| Pilgrim's Leggings | GENERIC |  | item:pilgrims_leggings |
| Pilgrim's Light | GENERIC |  | choiceRow:pal_r5_blessed_momentum |
| Pink Forest | GENERIC |  | item:pink_forest_armor_plate |
| Pinning Barb | GENERIC |  | choiceRow:hun_r8_improved_concussive |
| Pit Lord's Cleaver | GENERIC |  | item:pitlords_cleaver |
| Pitted Shortsword | GENERIC |  | item:worn_sword |
| Plated to Perfection | GENERIC |  | deed:prog_armorcrafting_rare |
| Plump Fen Eel | GENERIC |  | item:plump_fen_eel |
| Pocket Money | GENERIC |  | deed:soc_pocket_money |
| Powder Keg | GENERIC |  | mobMechanic:ironvein_foreman.aoePulse |
| Power Echo | GENERIC |  | ability:power_echo choiceRow:mag_r14_power_echo |
| Precision Engineering | GENERIC |  | deed:prog_engineering_rare |
| Preferred Customer | GENERIC |  | deed:col_quartermaster_buyout |
| Priest | GENERIC |  | class:priest |
| Priest of the Vale | GENERIC |  | npcTitle:brother_aldric npcTitle:brother_aldric_fen npcTitle:brother_aldric_highwatch npcTitle:brother_aldric_raid |
| Primal Heart | GENERIC |  | talentMastery:feral |
| Primal Mastery | GENERIC |  | ability:elemental_mastery |
| Primal Reflexes | GENERIC |  | ability:primal_reflexes |
| Primal Surge | GENERIC |  | ability:feral_charge |
| Prime Cut | GENERIC |  | item:prime_cut |
| Pristine Claw | GENERIC |  | item:pristine_claw |
| Pristine Hide | GENERIC |  | item:pristine_hide |
| Pristine Silk | GENERIC |  | item:pristine_silk |
| Pristine Vein | GENERIC |  | deed:col_pristine_vein |
| Pristine Venom Gland | GENERIC |  | item:pristine_venom_gland |
| Profane Mending | GENERIC |  | mobMechanic:corrupted_priest_malric.mendAlly |
| Profane Rune | GENERIC |  | mobMechanic:deacon_voss.arcaneRot |
| Provisioner | GENERIC |  | npcTitle:trader_wilkes npcTitle:provisioner_hale |
| Provisioner Fenna | GENERIC |  | npc:provisioner_fenna |
| Provisioner Hale | GENERIC |  | npc:provisioner_hale |
| Prowler Reeds | GENERIC |  | poi:1.1 |
| Prowlhide Jerkin | GENERIC |  | item:stalkerhide_jerkin |
| Pruned Bloom Clipping | GENERIC |  | item:evergarden_bloom_clipping |
| Pruned into Hunger | GENERIC |  | quest:q_eg_hungry_shapes |
| Psalm of Warding | GENERIC |  | ability:power_word_shield |
| Pursuit | GENERIC |  | choiceRow:war_row_pursuit |
| Pyre Colossus | GENERIC |  | mob:pyre_colossus |
| Pyroclasm | GENERIC |  | mobMechanic:rift_boss_ember.bigCast |
| Pyromancy | GENERIC |  | talentSpec:fire |
| Quaking Blow | GENERIC |  | ability:thunder_clap |
| Quartermaster Bree | GENERIC |  | npc:quartermaster_bree |
| Quartermaster Edda | GENERIC |  | npc:quartermaster_edda |
| Quartermaster Sela | GENERIC |  | npc:quartermaster_sela |
| Quartermaster Vex | GENERIC |  | npc:heroic_quartermaster |
| Quickened Blood | GENERIC |  | ability:adrenaline_rush |
| Quilted Trousers | GENERIC |  | item:quilted_trousers |
| Racing Mind | GENERIC |  | ability:presence_of_mind choiceRow:mag_r14_presence_of_mind |
| Rain of Brimstone | GENERIC |  | mobMechanic:rift_boss_pitlord.bigCast |
| Rain of Fire | GENERIC |  | ability:rain_of_fire |
| Raised Bonewalker | GENERIC |  | mob:raised_bonewalker mob:reliquary_bonewalker |
| Raised Guard | GENERIC |  | ability:raised_guard |
| Rallying Banner | GENERIC |  | mobMechanic:ironvein_foreman.rally |
| Rats in the Mine | GENERIC |  | quest:q_mine |
| Rattling Shot | GENERIC |  | ability:concussive_shot |
| Raw Bog Eel | GENERIC |  | item:raw_bog_eel |
| Raw Marsh Pike | GENERIC |  | item:raw_marsh_pike |
| Raw Mirror Trout | GENERIC |  | item:raw_mirror_trout |
| Raw River Perch | GENERIC |  | item:raw_river_perch |
| Raw Slatefin Carp | GENERIC |  | item:raw_stonescale_carp |
| Razorvine Spear | GENERIC |  | mobMechanic:wildheart_stalker.petSpell |
| Razorwind Torque | GENERIC |  | item:razorwind_torque |
| Reader of Stones | GENERIC |  | npcTitle:archivist_tullo |
| Reader of the Lights | GENERIC |  | npcTitle:aurorist_veyla |
| Reaping Arc | GENERIC |  | mobMechanic:knight_commander_olen.cleave ability:cleave |
| Reaver Strike | GENERIC |  | ability:heroic_strike |
| Rebounding Current | GENERIC |  | choiceRow:sha_r5_improved_lightning_shield |
| Recklessness | GENERIC |  | ability:recklessness choiceRow:war_row_recklessness |
| Recompense | GENERIC |  | talentMastery:prot |
| Red Bandana | GENERIC |  | item:bandit_bandana |
| Red Harvest | GENERIC |  | ability:red_harvest |
| Red Haze | GENERIC |  | ability:berserk choiceRow:dru_r20_berserk |
| Red Ribbon | GENERIC |  | ability:hemorrhage |
| Redbrook Militia Blade | GENERIC |  | item:redbrook_blade |
| Redhand | GENERIC |  | ability:overpower |
| Redhanded | GENERIC |  | talentMastery:assassination |
| Redline Draw | GENERIC |  | choiceRow:hun_r20_rapid_killing |
| Redline Habit | GENERIC |  | choiceRow:rog_r20_adrenaline_junkie |
| Redoubt Armorer | GENERIC |  | npcTitle:quartermaster_edda |
| Redoubt Commander | GENERIC |  | npcTitle:warden_coalfast |
| Redtooth Rhythm | GENERIC |  | choiceRow:dru_r14_savage_fury |
| Reed-Bound Handwraps | GENERIC |  | item:litany_gloves_rog |
| Reedbound Acolyte | GENERIC |  | mob:reedbound_acolyte |
| Reedstalker Jerkin | GENERIC |  | item:reedstalker_jerkin |
| Reedwoven Jerkin | GENERIC |  | item:reedwoven_jerkin |
| Reedwoven Trousers | GENERIC |  | item:reedwoven_trousers |
| Reeve Ottoline | GENERIC |  | npc:reeve_ottoline |
| Refilled Offering Bowl | GENERIC |  | item:sunken_offering_bowl |
| Reinforced Pauldrons | GENERIC |  | item:reinforced_pauldrons |
| Reins of the Drakemaw Raptor | GENERIC |  | item:reins_drakemaw_raptor |
| Reins of the Moss-Shell Stalk-Glider | GENERIC |  | item:reins_stalkglider_snail |
| Release Companion | GENERIC |  | ability:dismiss_pet |
| Reliquary Guard Hauberk | GENERIC |  | item:reliquary_plate_chest |
| Reliquary Hill | GENERIC |  | poi:0.8 |
| Reliquary Keeper | GENERIC |  | npcTitle:brother_halven npcTitle:brother_halven_marsh |
| Reliquary Runner | GENERIC |  | deed:dlv_reliquary |
| Rending Claws | GENERIC |  | mobMechanic:ridge_stalker.bleed |
| Reproach | GENERIC |  | ability:rebuke |
| Requital | GENERIC |  | talentSpec:retribution |
| Requital Aura | GENERIC |  | ability:retribution_aura |
| Resolve Unbroken | GENERIC |  | choiceRow:pri_r17_improved_fortitude |
| Resonant Hide | GENERIC |  | item:resonant_hide |
| Resonant Links | GENERIC |  | item:resonant_links |
| Resonant Steel | GENERIC |  | item:resonant_steel |
| Resonant Thread | GENERIC |  | item:resonant_thread |
| Resonant Timber | GENERIC |  | item:resonant_timber |
| Restless Bones | GENERIC |  | mob:restless_bones |
| Restless Graves | GENERIC |  | delveAffix:restless_graves |
| Restless Skull | GENERIC |  | item:restless_skull |
| Returning Current | GENERIC |  | choiceRow:sha_r8_shock_efficiency |
| Revenant Fields | GENERIC |  | poi:2.8 |
| Revenant Silk Robe | GENERIC |  | item:revenant_silk_robe |
| Revenantstep Treads | GENERIC |  | item:revenantstep_treads |
| Revenge | GENERIC |  | ability:revenge |
| Rewind | GENERIC |  | ability:temporal_rewind |
| Ridge Stalker | GENERIC |  | mob:ridge_stalker |
| Ridge Stalker Pelt | GENERIC |  | item:ridge_stalker_pelt |
| Ridgestalker Treads | GENERIC |  | item:ridgestalker_treads |
| Riding Lessons | GENERIC |  | quest:q_riding_lessons |
| Riding Training | GENERIC |  | item:riding_training |
| Rift Essence | GENERIC |  | item:rift_essence |
| Rift Sovereign | GENERIC |  | deed:dgn_rift_s_rank |
| Rift Spawnling | GENERIC |  | mob:rift_spawnling |
| Riftbound Band of Guile | GENERIC |  | item:riftbound_band_of_guile |
| Riftbound Band of Insight | GENERIC |  | item:riftbound_band_of_insight |
| Riftbound Band of Might | GENERIC |  | item:riftbound_band_of_might |
| Riftspawn | GENERIC |  | mob:riftspawn |
| Riftwalker | GENERIC |  | deed:dgn_rift |
| Rime | GENERIC |  | mobMechanic:rift_rime_elemental.frostbite riftThemeNoun:0.0 |
| Rime Elemental | GENERIC |  | mob:rift_rime_elemental mob:rime_elemental |
| Rime Jolt | GENERIC |  | ability:frost_shock |
| Rime Lock | GENERIC |  | choiceRow:sha_r8_frost_bind |
| Rime Needle | GENERIC |  | weaponSkin:frostbite_dagger |
| Rime Snare | GENERIC |  | ability:frost_trap choiceRow:hun_r8_frost_trap |
| Rime Unbound | GENERIC |  | quest:q_fv_rime_unbound |
| Rimebound Weapon | GENERIC |  | ability:frostbrand_weapon |
| Rip | GENERIC |  | ability:rip |
| Riptide | GENERIC |  | mobMechanic:rift_boss_tide.aoePulse |
| Riptide Dirk | GENERIC |  | item:riptide_dirk |
| Risen Bonewalker | GENERIC |  | mob:rift_bonewalker |
| Risen Royal Guard | GENERIC |  | mob:nythraxis_skeleton_warrior |
| Rising Frenzy | GENERIC |  | mobMechanic:rift_boss_brute.rampage |
| Rite of Expulsion | GENERIC |  | ability:exorcism |
| Rite's Afterglow | GENERIC |  | choiceRow:pal_r17_sacred_ward |
| Ritual Circle | GENERIC |  | item:crypt_ritual_circle |
| Ritual Phylactery | GENERIC |  | item:ritual_phylactery |
| Riveted Copper Girdle | GENERIC |  | item:riveted_copper_girdle |
| Roadwarden's Helm | GENERIC |  | item:roadwardens_helm |
| Roast Mountain Goat | GENERIC |  | item:roast_mountain_goat |
| Robes in the Reeds | GENERIC |  | quest:q_cult_camp |
| Rogue | GENERIC |  | class:rogue |
| Room for More | GENERIC |  | deed:soc_room_for_more |
| Rotwater Vial | GENERIC |  | mobMechanic:reedbound_acolyte.petSpell |
| Rough Hide | GENERIC |  | item:rough_hide |
| Roughspun Gloves | GENERIC |  | item:roughspun_gloves |
| Roused Stormling | GENERIC |  | mob:thunzharr_stormling |
| Royal Cleave | GENERIC |  | mobMechanic:nythraxis_heroic_warrior_add.cleave |
| Ruination | GENERIC |  | talentSpec:destruction |
| Runed Bone Shard | GENERIC |  | item:runed_bone_shard |
| Rusted Censer | GENERIC |  | item:rusted_censer |
| Rusty Dagger | GENERIC |  | item:rusty_dagger |
| Rusty Hatchet | GENERIC |  | item:rusty_hatchet |
| Sableweb Cord | GENERIC |  | item:sableweb_cord |
| Sableweb Lurker | GENERIC |  | mob:webwood_spider |
| Sableweb Silk Gland | GENERIC |  | item:webwood_silk |
| Sableweb Slippers | GENERIC |  | item:sableweb_slippers |
| Sacrament | GENERIC |  | talentSpec:holy |
| Sacred Bulwark | GENERIC |  | ability:sacred_bulwark |
| Sacred Goad | GENERIC |  | ability:holy_taunt |
| Safe Hands | GENERIC |  | deed:pvp_vcup_first_save |
| Saint's Ire | GENERIC |  | ability:holy_wrath choiceRow:pal_r14_holy_wrath |
| Saintless Effigy | GENERIC |  | mob:reliquary_saintless_effigy |
| Salted Jerky | GENERIC |  | item:tough_jerky |
| Saltforged Grips | GENERIC |  | item:saltforged_grips |
| Saltwalker Sandals | GENERIC |  | item:saltwalker_sandals |
| Salvage-Boss Ryna | GENERIC |  | npc:salvage_boss_ryna |
| Salvager Edda | GENERIC |  | npc:salvager_edda |
| Sanctum Approach Graves | GENERIC |  | graveyard:gy_thornpeak_south |
| Sanctum Boneguard | GENERIC |  | mob:sanctum_boneguard |
| Sanctum Key Shard | GENERIC |  | item:sanctum_key_shard |
| Sanctum Prowler's Grips | GENERIC |  | item:sanctum_prowlers_grips |
| Sanctum Scaleguard | GENERIC |  | mob:sanctum_drakonid |
| Sand in Your Boots | GENERIC |  | deed:pvp_arena_first_match |
| Sanguine Aura | GENERIC |  | ability:sanguine_aura choiceRow:war_row_sanguine_aura |
| Sap | GENERIC |  | ability:sap |
| Sap-Tap Bucket | GENERIC |  | item:amberfall_sap_bucket |
| Sapbinder Grips | GENERIC |  | item:orchard_sapbinder_grips |
| Sapping Bite | GENERIC |  | mobMechanic:mirejaw_the_ravenous.sapVigor |
| Sash of the Sunken Court | GENERIC |  | item:sash_of_the_sunken_court |
| Saul the Chronicler | GENERIC |  | npc:chronicler_saul |
| Savage Mending | GENERIC |  | ability:frenzied_regeneration choiceRow:dru_r17_frenzied_regeneration |
| Savage Pounce | GENERIC |  | mobMechanic:old_cragmaw.aoePulse |
| Scald | GENERIC |  | ability:scorch |
| Scales of the Maw | GENERIC |  | quest:q_dk_scales_of_the_maw |
| Scattered Grave Offering | GENERIC |  | item:barrow_grave_offering |
| Scorched Stores | GENERIC |  | quest:q_dk_scorched_stores |
| Scorched Supply Crate | GENERIC |  | item:scorched_supply_crate |
| Scourge No More | GENERIC |  | deed:dgn_nythraxis |
| Scourge's End | GENERIC |  | quest:q_nythraxis_scourges_end |
| Scourgehide Carapace | GENERIC |  | item:scourgehide_carapace |
| Scout Einna | GENERIC |  | npc:scout_einna |
| Scout Maren | GENERIC |  | npc:scout_maren npc:scout_maren_highwatch |
| Scrapper's Edge | GENERIC |  | talentMastery:combat |
| Scuttlers in the Pots | GENERIC |  | quest:q_gc_scuttlers_in_the_pots |
| Sear | GENERIC |  | ability:searing_pain |
| Searing Brand | GENERIC |  | mobMechanic:rift_hellguard.smolder |
| Searing Maw | GENERIC |  | mobMechanic:voskar_emberwing.mortalStrike |
| Seasoned Chef | GENERIC |  | deed:prog_cooking_50 |
| Second Bloom | GENERIC |  | ability:regrowth |
| Second Exit | GENERIC |  | choiceRow:rog_r11_endurance |
| Second Wind | GENERIC |  | choiceRow:war_row_second_wind |
| Seeing Wren Home | GENERIC |  | quest:q_fv_seeing_wren_home |
| Seething Fury | GENERIC |  | ability:berserker_rage |
| Seismic Stomp | GENERIC |  | mobMechanic:thunzharr_waking_peak.stomp mobMechanic:rift_boss_brute.stomp |
| Sergeant | GENERIC | superseded: ships as Linebreaker since the v0.36.0 merge (release PR #3133) | deed:pvp_honor_sergeant deedTitle:pvp_honor_sergeant |
| Serration | GENERIC |  | mobMechanic:rift_thornback.bleed |
| Settle It Outside | GENERIC |  | deed:pvp_duel_first_win |
| Sexton Marrow | GENERIC |  | mob:sexton_marrow npc:sexton_marrow |
| Sexton's Slippers | GENERIC |  | item:sextons_slippers |
| Shadow | GENERIC |  | riftThemeNoun:5.1 |
| Shadow Credit | GENERIC |  | choiceRow:wlk_r14_shadow_mastery |
| Shadow Nova | GENERIC |  | mobMechanic:corrupted_priest_malric.aoePulse |
| Shadow Pulse | GENERIC |  | mobMechanic:morthen.aoePulse |
| Shadowpulse Handwraps | GENERIC |  | item:shadowpulse_handwraps |
| Shadowpulse Slippers | GENERIC |  | item:shadowpulse_slippers |
| Shadowstitch Jerkin | GENERIC |  | item:shadow_jerkin |
| Shaman | GENERIC |  | class:shaman |
| Shard of Everwinter | GENERIC |  | weaponSkin:everwinter_wand |
| Shardfang Grips | GENERIC |  | item:shardfang_grips |
| Shards of Starfall | GENERIC |  | quest:q_shards_of_starfall |
| Shardsong Mantle | GENERIC |  | item:shardsong_mantle |
| Sharp Claw | GENERIC |  | item:sharp_claw |
| Shattered Psalm | GENERIC |  | choiceRow:pri_r8_improved_shield |
| Shearkeeper Gloves | GENERIC |  | item:shearkeeper_gloves |
| Shellbacked Thieves | GENERIC |  | quest:q_pr_scuttler_cull |
| Shifting Ward | GENERIC |  | choiceRow:mag_r8_temporal_rift |
| Shoal Scuttler | GENERIC |  | mob:shoal_scuttler |
| Shoot | GENERIC |  | ability:sport_shoot sportAbility:sport_shoot |
| Shoulder | GENERIC |  | ability:sport_shoulder sportAbility:sport_shoulder |
| Shroud of the Gravewyrm | GENERIC |  | item:shroud_of_the_gravewyrm |
| Shroud of the Reliquary | GENERIC |  | item:reliquary_cloth_chest |
| Shuddering Stomp | GENERIC |  | mobMechanic:korgath_the_bound.stomp |
| Sidestep the Reaper | GENERIC |  | deed:dgn_olen_arc |
| Sigils of the Wyrm | GENERIC |  | quest:q_wyrm_sigils |
| Signet of the Last Keep | GENERIC |  | item:last_keep_signet |
| Silence the Call | GENERIC |  | quest:q_silence_the_call |
| Silence the Choir | GENERIC |  | quest:q_silence_the_choir |
| Silence the Mending | GENERIC |  | deed:chr_marsh_hush_the_mending |
| Silencing Shriek | GENERIC |  | mobMechanic:gravecaller_summoner.silence |
| Silk and Venom | GENERIC |  | quest:q_widows |
| Silk from the Canopy | GENERIC |  | quest:q_pr_canopy_silk |
| Silk in the Eaves | GENERIC |  | quest:q_ww_silk_in_the_eaves |
| Silkbinder's Raiment | GENERIC |  | item:silkbinders_raiment |
| Silkbound Remains | GENERIC |  | item:silkbound_remains |
| Silkspun Satchel | GENERIC |  | item:silkspun_satchel |
| Silt Cleave | GENERIC |  | mobMechanic:grave_silt_bulwark.cleave |
| Silt Hide | GENERIC |  | mobMechanic:sump_troll_devourer.stoneskin |
| Silt Ward | GENERIC |  | mobMechanic:grave_silt_bulwark.wardAllies |
| Silt-Deep Vestment | GENERIC |  | item:litany_leather_chest |
| Silt-Walker Greaves | GENERIC |  | item:litany_legs |
| Siltguard Helm | GENERIC |  | item:siltguard_helm |
| Siltstep Leggings | GENERIC |  | item:siltstep_leggings |
| Silvered Carp Supper | GENERIC |  | item:silvered_carp_supper |
| Silvermist Cordial | GENERIC |  | item:silvermist_cordial |
| Silverstream Fishing Rod | GENERIC |  | item:silverstream_fishing_rod |
| Simple Fishing Pole | GENERIC |  | item:simple_fishing_pole |
| Siphon | GENERIC |  | mobMechanic:rift_dread_stalker.lifeleech |
| Skulduggery | GENERIC |  | talentSpec:subtlety |
| Skull | GENERIC |  | riftThemeNoun:4.1 |
| Skull Smash | GENERIC |  | mobMechanic:brutok_skullsmasher.aoePulse |
| Skullsmasher's Warbelt | GENERIC |  | item:skullsmasher_warbelt |
| Skullsplitter Dirk | GENERIC |  | item:skullsplitter_dirk |
| Sky Echo | GENERIC |  | choiceRow:sha_r11_elemental_attunement |
| Skyfall | GENERIC |  | ability:starfire |
| Skystone | GENERIC |  | ability:meteor |
| Slayer | GENERIC |  | deed:cmb_slayer |
| Slumber | GENERIC |  | ability:hibernate |
| Smite | GENERIC |  | ability:smite |
| Smithing Flux | GENERIC |  | item:smithing_flux |
| Smoke Screen | GENERIC |  | ability:smoke_screen choiceRow:rog_r8_smoke_screen |
| Smoked Mirefen Eel | GENERIC |  | item:smoked_eel |
| Smoldering Fuse | GENERIC |  | mobMechanic:ironvein_sapper.smolder |
| Smoulder | GENERIC |  | mobMechanic:rift_magma_brute.smolder |
| Snap Bewitch | GENERIC |  | choiceRow:mag_r11_snap_polymorph |
| Snowdrift Wolf | GENERIC |  | mob:snowdrift_wolf |
| Snowline Scout | GENERIC |  | npcTitle:scout_einna |
| Soft Down Tuft | GENERIC |  | item:soft_down |
| Soggy Boot | GENERIC |  | item:soggy_boot |
| Soggy Moccasin | GENERIC |  | item:soggy_moccasin |
| Solemn Prayer | GENERIC |  | ability:heal |
| Something Blue | GENERIC |  | deed:col_first_rare |
| Something in Mirror Lake | GENERIC |  | deed:chr_vale_first_cast |
| Something Shiny | GENERIC |  | deed:exp_something_shiny |
| Soul Grave | GENERIC |  | mobMechanic:rift_boss_necro.deathZoneCast |
| Soul Siphon | GENERIC |  | mobMechanic:boneclad_revenant.enervate |
| Soulforged Warplate | GENERIC |  | item:soulforged_warplate |
| Spectral Ward | GENERIC |  | mobMechanic:wyrmcult_necromancer.spellReflect |
| Speed Demon | GENERIC |  | powerup:0 |
| Spellbreaker's Seal | GENERIC |  | item:spellbreakers_seal |
| Spellhound | GENERIC |  | mob:spellhound |
| Spider | GENERIC |  | riftThemeNoun:2.3 |
| Spider Egg-Sac | GENERIC |  | mob:spider_egg_sac |
| Spider Silk | GENERIC |  | item:spider_silk |
| Spider Venom | GENERIC |  | mobMechanic:webwood_spider.venom |
| Spilled Tool Cart | GENERIC |  | item:hedgewick_tool_cart |
| Spirit of Voss | GENERIC |  | mob:nythraxis_heroic_rogue_add |
| Spirit Siphon | GENERIC |  | mobMechanic:sister_nhalia.siphonSpirit |
| Spitted Boar Haunch | GENERIC |  | item:roasted_boar |
| Spool of Thread | GENERIC |  | item:spool_of_thread |
| Spore Heart | GENERIC |  | item:spore_heart |
| Sporeling Gatherer | GENERIC |  | mob:sporeling_gatherer |
| Springback Charm | GENERIC |  | toolEffect:quickening_charm |
| Sprites and Spigots | GENERIC |  | quest:q_af_sprites_and_spigots |
| Sprites in the Traps | GENERIC |  | quest:q_fv_sprung_traps |
| Sprung Fen Trap | GENERIC |  | item:sprung_trap |
| Stable Horse | GENERIC |  | mob:stable_horse |
| Stablemaster | GENERIC |  | npcTitle:stablemaster_marla |
| Staff of Drowned Prayers | GENERIC |  | item:staff_of_drowned_prayers |
| Staff of the Gravewyrm | GENERIC |  | item:staff_of_the_gravewyrm item:heroic_staff_of_the_gravewyrm |
| Staff of the Hollow | GENERIC |  | item:gravecaller_staff |
| Staff of the Hollow Vigil | GENERIC |  | item:hollow_vigil_staff |
| Stalk | GENERIC |  | ability:prowl |
| Stalker Ridge | GENERIC |  | poi:2.1 |
| Stalkers off the Light | GENERIC |  | quest:q_fs_stalkers_off_the_light |
| Stalkers on the Ridge | GENERIC |  | quest:q_stalkers |
| Starfall Basin | GENERIC |  | poi:3.4 |
| Starfall Shard | GENERIC |  | item:starfall_shard |
| Starfall, Judgment of the Heavens | GENERIC | QA note: Starfall token shared with two Blizzard abilities, different role (skin/place vs star-rain spell); GENERIC stands under bar rule 2 | weaponSkin:starfall_mace |
| Startle Shot | GENERIC |  | ability:startle_shot choiceRow:hun_r8_startle_shot |
| Static Charge | GENERIC |  | mobMechanic:stormcrag_elemental.spellVuln |
| Static Field | GENERIC |  | mobMechanic:rift_boss_storm.aoeSlow |
| Statue Rubbing | GENERIC |  | item:evergarden_statue_rubbing |
| Stay Buried | GENERIC |  | deed:dgn_velkhar_bonewalkers |
| Steadfast Aura | GENERIC |  | ability:devotion_aura |
| Steady Custom | GENERIC |  | deed:soc_steady_custom |
| Steady Draw | GENERIC |  | choiceRow:hun_r14_sniper_training |
| Steady Rain | GENERIC |  | choiceRow:hun_r20_improved_volley |
| Steel for the Redoubt | GENERIC |  | quest:q_fs_steel_for_the_redoubt |
| Steel Orange | GENERIC |  | item:steel_orange_armor_plate |
| Sticky Web | GENERIC |  | mobMechanic:webwood_spider.ensnare |
| Stilled Mind | GENERIC |  | ability:inner_focus choiceRow:pri_r11_inner_focus |
| Stinging Swarm | GENERIC |  | ability:insect_swarm |
| Stoke | GENERIC |  | ability:enrage |
| Stolen Hedgewick Shears | GENERIC |  | item:hedgewick_shears |
| Stolen Supplies | GENERIC |  | quest:q_supplies |
| Stolen Supply Crate | GENERIC |  | item:supply_crate |
| Stone Bulwark | GENERIC |  | mobMechanic:ancient_guardian.stoneskin |
| Stone Ogre | GENERIC |  | mob:rift_stone_ogre |
| Stone Sweep | GENERIC |  | mobMechanic:reliquary_saintless_effigy.cleave |
| Stonebound Weapon | GENERIC |  | ability:rockbiter_weapon |
| Stopping the Summoning | GENERIC |  | quest:q_summoners |
| Storm | GENERIC |  | riftThemeNoun:6.0 |
| Storm Caller | GENERIC |  | mob:rift_storm_caller |
| Storm Chorus | GENERIC |  | ability:bloodlust choiceRow:sha_r20_bloodlust |
| Storm Core | GENERIC |  | item:storm_core |
| Storm Recall | GENERIC |  | choiceRow:sha_r20_elemental_fury |
| Stormbark Mantle | GENERIC |  | item:stormbark_mantle |
| Stormbound Crown | GENERIC |  | item:stormbound_crown |
| Stormbound Greaves | GENERIC |  | item:stormbound_greaves |
| Stormbound Handguards | GENERIC |  | item:stormbound_handguards |
| Stormbound Hauberk | GENERIC |  | item:stormbound_hauberk |
| Stormbound Legmail | GENERIC |  | item:stormbound_legmail |
| Stormbound Spaulders | GENERIC |  | item:stormbound_spaulders |
| Stormbound Vestments | GENERIC |  | itemSet:warfare_stormbound |
| Stormbound Waistguard | GENERIC |  | item:stormbound_waistguard |
| Stormcall | GENERIC |  | mobMechanic:thunzharr_waking_peak.bigCast |
| Stormcaller's Focus | GENERIC |  | item:stormcallers_focus |
| Stormcaller's Wrath | GENERIC |  | mobMechanic:rift_boss_storm.deathZoneStrike |
| Stormchant Gauntlets | GENERIC |  | item:stormchant_gauntlets |
| Stormcrag Elemental | GENERIC |  | mob:stormcrag_elemental |
| Stormreel Fishing Rod | GENERIC |  | item:stormreel_fishing_rod |
| Stormroot Cowl | GENERIC |  | item:stormroot_cowl |
| Stormscale Drake | GENERIC |  | mob:rift_stormscale |
| Stormscale Treads | GENERIC |  | item:stormscale_treads |
| Stormshard Leggings | GENERIC |  | item:stormshard_leggings |
| Stormspire | GENERIC |  | riftTheme:6 |
| Stormvotive Hauberk | GENERIC |  | item:stormvotive_hauberk |
| Strandwatcher Pell | GENERIC |  | npc:strandwatcher_pell |
| Strange Brews | GENERIC |  | deed:prog_alchemy_50 |
| Strange Wax | GENERIC |  | quest:q_glowing_wax |
| Striders in the Dark | GENERIC |  | quest:q_nb_striders_in_the_dark |
| Sturdy Traveler's Belt | GENERIC |  | item:sturdy_belt |
| Sudden Death | GENERIC |  | ability:sudden_death |
| Summon Duskborn | GENERIC |  | ability:summon_succubus |
| Summon Pyre Colossus | GENERIC |  | ability:summon_infernal |
| Summon Water Elemental | GENERIC |  | ability:summon_water_elemental |
| Sump Stomp | GENERIC |  | mobMechanic:sump_troll_devourer.stomp |
| Sump Troll Devourer | GENERIC |  | mob:sump_troll_devourer |
| Sump-Warden Cuirass | GENERIC |  | item:litany_plate_chest |
| Sunbone Hexcaller | GENERIC |  | mob:wildheart_hexcaller |
| Sunbone Oracle's Crown | GENERIC |  | item:sunbone_oracles_crown |
| Sunbone Ritual Hauberk | GENERIC |  | item:sunbone_ritual_hauberk |
| Sunbone Ritual Sarong | GENERIC |  | item:sunbone_ritual_sarong |
| Sundering Gavel | GENERIC |  | ability:hammer_of_justice |
| Sundering Toll | GENERIC |  | mobMechanic:waking_warden.aoePulse |
| Sunglint Koi | GENERIC |  | item:glimmerfin_koi |
| Sunken | GENERIC |  | riftTheme:7 riftThemeNoun:7.0 |
| Sunken Court Mantle | GENERIC |  | item:sunken_court_mantle |
| Sunken Monument | GENERIC |  | item:monument_court |
| Sunken Reliquary Hood | GENERIC |  | item:sunken_reliquary_hood |
| Sunken Toll-Chest | GENERIC |  | item:bridgemere_toll_chest |
| Sunpetal Healing Draught | GENERIC |  | item:sunpetal_healing_draught |
| Sunpetal Herb | GENERIC |  | item:sunpetal_herb |
| Sunpetal Mana Draught | GENERIC |  | item:sunpetal_mana_draught |
| Sunpetal Sickle | GENERIC |  | item:sunpetal_sickle |
| Sunweave Mantle | GENERIC |  | item:sunweave_mantle |
| Sunweave Treads | GENERIC |  | item:sunweave_treads |
| Sweeping Arc | GENERIC |  | mobMechanic:rift_boneclad.cleave mobMechanic:rift_boss_brute.cleave |
| Sweeping Claws | GENERIC |  | ability:swipe |
| Swift Heels | GENERIC |  | ability:sprint |
| Swift Verdicts | GENERIC |  | choiceRow:pal_r14_swift_verdicts |
| Swiftfang Talisman | GENERIC |  | item:swiftfang_talisman |
| Tail Hammer | GENERIC |  | mobMechanic:drakemaw_broodlord.counterStun mobMechanic:cindraleth_maw_matriarch.counterStun |
| Tail Sweep | GENERIC |  | mobMechanic:rift_stormscale.knockback |
| Tailoring | GENERIC |  | craft:tailoring |
| Tangled Weed | GENERIC |  | item:tangled_weed |
| Tanned Leather Jerkin | GENERIC |  | item:tanned_leather_jerkin |
| Tanner's Trade | GENERIC |  | deed:prog_leatherworking_50 |
| Tannery Work Order | GENERIC |  | quest:q_prof_workorder_tannery |
| Tanning Agent | GENERIC |  | item:tanning_agent |
| Tectonic Heave | GENERIC |  | mobMechanic:thunzharr_waking_peak.knockback |
| Teeth of the Fen | GENERIC |  | quest:q_prowlers |
| Tempered Flanged Mace | GENERIC |  | weaponSkin:tempered_flanged_mace |
| Tempered to a Shine | GENERIC |  | deed:prog_weaponcrafting_rare |
| Tempest | GENERIC |  | riftThemeNoun:6.1 |
| Temporal Acceleration | GENERIC |  | ability:temporal_acceleration |
| Temporal Barrier | GENERIC |  | ability:temporal_barrier |
| Temporal Cascade | GENERIC |  | ability:temporal_cascade |
| Temporal Drag | GENERIC |  | mobMechanic:rift_boss_arcane.aoeSlow |
| Temporal Echo | GENERIC |  | ability:temporal_echo |
| Temporal Mend | GENERIC |  | ability:temporal_mend |
| Temporal Reversal | GENERIC |  | ability:temporal_reversal |
| Terrace Howler | GENERIC |  | mob:terrace_howler |
| Terraced Harvest | GENERIC |  | deed:chr_frostveil_gatherer |
| Terrifying Screech | GENERIC |  | mobMechanic:rift_boss_tide.terrify |
| Terror Canticle | GENERIC |  | ability:psychic_scream choiceRow:pri_r8_psychic_scream |
| Terrors of the Vale | GENERIC |  | deed:chr_vale_rares |
| The Abandoned Crypt | GENERIC |  | quest:q_nythraxis_sealed_crypt |
| The Architect's Cornerstone | GENERIC |  | item:architects_cornerstone |
| The Aurora Steps | GENERIC |  | poi:5.3 |
| The Barrow King | GENERIC |  | mob:barrow_king |
| The Barrow King Wakes | GENERIC |  | quest:q_nb_the_barrow_king |
| The Basin Bites Back | GENERIC |  | deed:dgn_wildheart_basin |
| The Bell at the Landing | GENERIC |  | quest:q_fs_bell_at_the_landing |
| The Bells Fall Silent | GENERIC |  | deed:dlv_varric_ringers |
| The Binding Rite | GENERIC |  | quest:q_rite |
| The Bound Guardian | GENERIC |  | mob:bound_guardian quest:q_korgath quest:q_nythraxis_bound_guardian |
| The Breaker's Yard | GENERIC |  | deed:soc_salvage_50 |
| The Broodmother | GENERIC |  | mob:mirefen_broodmother quest:q_broodmother |
| The Bull of the Fountain Court | GENERIC |  | quest:q_eg_bull_of_the_court |
| The Captain's Bounty | GENERIC |  | quest:q_ogre_bounty |
| The Charts in the Stones | GENERIC |  | quest:q_nb_charts_of_the_stones |
| The Collapsed Reliquary | GENERIC |  | delve:collapsed_reliquary |
| The Croaker's Hush | GENERIC |  | quest:q_wf_croakers_hush |
| The Crowd Roars | GENERIC |  | deed:pvp_arena_first_win |
| The Crown Below | GENERIC |  | deed:prog_crown_below |
| the Curator | GENERIC |  | deedTitle:col_discovery_150 |
| The Deacon of the Mire | GENERIC |  | quest:q_deacon |
| the Deathless | GENERIC |  | deedTitle:dgn_nythraxis_deathless |
| The Drakelands | GENERIC |  | zone:4 |
| The Dreaming Harvest | GENERIC |  | deed:chr_nightbloom_gatherer |
| The Drowned Choir | GENERIC |  | quest:q_drowned_choir |
| The Drowned Dead | GENERIC |  | quest:q_drowned |
| The Drowned Litany | GENERIC |  | delve:drowned_litany |
| The Drowned Moon | GENERIC |  | quest:q_drowned_moon |
| The Drowned Temple | GENERIC |  | dungeon:drowned_temple |
| The Drowned Warlord | GENERIC |  | mob:drowned_warlord |
| The Drowsy Croaker | GENERIC |  | mob:drowsy_croaker |
| The Drowsy Flats | GENERIC |  | poi:7.5 |
| The Emerald Tangle | GENERIC |  | poi:10.3 |
| The Evergarden | GENERIC |  | zone:11 |
| The Far Shore | GENERIC |  | quest:q_gc_the_far_shore |
| The Farshore | GENERIC |  | zone:13 |
| The Farshore Causeway | GENERIC |  | poi:0.11 |
| the Footnote | GENERIC |  | deedTitle:hid_saul_footnote |
| The Fountain Court | GENERIC |  | poi:11.6 |
| The Four Quiet Sisters | GENERIC |  | quest:q_eg_four_statues |
| The Full Circuit | GENERIC |  | deed:dgn_mark_circuit |
| The Full Six | GENERIC |  | deed:prog_full_build |
| The Galecrest | GENERIC |  | zone:12 |
| The Garden Gate | GENERIC |  | poi:11.1 |
| The Gatewood | GENERIC |  | poi:4.1 |
| The Gilded Orchard | GENERIC |  | poi:6.2 |
| The Gilded Strongbox | GENERIC |  | npcTitle:bursar_fernando npcTitle:bursar_petra_vell npcTitle:bursar_aldous_crane deed:soc_gilded_strongbox |
| The Gilded Tour | GENERIC |  | deed:hid_gilded_tour |
| The Gleaming Deep | GENERIC |  | poi:3.7 |
| The Gleamstag | GENERIC |  | mob:gleamstag |
| The Glutton | GENERIC |  | quest:q_grubjaw |
| The Glutton, Reckoned | GENERIC |  | deed:chr_marsh_rares_ii |
| The Gold Road Down | GENERIC |  | quest:q_af_goldmelt_road |
| The Grand Catalogue | GENERIC |  | deed:col_discovery_250 |
| The Grand Necromancer | GENERIC |  | quest:q_velkhar |
| The Gravecaller's Trail | GENERIC |  | quest:q_gravecallers_trail |
| The Great Break | GENERIC |  | quest:q_fs_the_great_break |
| The Great Maze | GENERIC |  | poi:11.5 |
| The Great Mere | GENERIC |  | poi:6.4 |
| The Groundskeepers Grudge | GENERIC |  | quest:q_eg_gnomes_in_the_green |
| The Hanging Glade | GENERIC |  | poi:9.3 |
| The Herd Remembers | GENERIC |  | deed:chr_hollow_rares |
| The Hollow Crypt | GENERIC |  | dungeon:hollow_crypt |
| The Hollow Holds | GENERIC |  | deed:pvp_bg_first_win |
| The Hollow Sealstone | GENERIC |  | item:hollow_sealstone |
| The Horn of the Huntsman | GENERIC |  | quest:q_ww_horn_of_the_huntsman |
| The Howl on the Terraces | GENERIC |  | quest:q_fv_howl_above |
| The Howling Downs | GENERIC |  | poi:12.2 |
| The Howling Terraces | GENERIC |  | poi:5.5 |
| The Huntsman's Clearing | GENERIC |  | poi:9.5 |
| The Idol Guardian | GENERIC |  | mob:idol_guardian quest:q_pr_idol_guardian |
| The Junk Drawer | GENERIC |  | deed:col_junk_drawer |
| The Keeper Collects Twice | GENERIC |  | deed:hid_keepers_toll_twice |
| The Keeper of the Flame | GENERIC |  | quest:q_gc_keeper_of_the_flame |
| The Knight-Commander's Shame | GENERIC |  | quest:q_olen |
| The Landing | GENERIC |  | poi:13.1 |
| The Last Gardener | GENERIC |  | npcTitle:gardener_yew |
| The Last Keep | GENERIC |  | poi:4.4 dungeon:the_last_keep |
| The Last Vicar | GENERIC |  | quest:q_ww_the_last_vicar |
| The Leaning Monolith | GENERIC |  | poi:6.6 |
| The Ledger Grows | GENERIC |  | quest:q_prof_amends_bombardier |
| The Legend That Would Not Strike First | GENERIC |  | deed:chr_gleamstag |
| The Lily Basin | GENERIC |  | poi:11.9 |
| The Long Middle | GENERIC |  | deed:prog_the_long_middle |
| The Long Road North | GENERIC |  | deed:exp_long_road_north |
| The Lost Caravan | GENERIC |  | quest:q_fen_supplies |
| The Lost Navigator | GENERIC |  | quest:q_pr_the_lost_navigator |
| The Marsh Chronicle | GENERIC |  | npcTitle:chronicler_osric_fenn |
| The Merchant | GENERIC |  | npc:the_merchant |
| The Mere at Rest | GENERIC |  | deed:prog_mere_at_rest |
| The Mirror Tarn | GENERIC |  | poi:12.6 |
| The Mountain Fell | GENERIC |  | deed:cmb_thunzharr |
| The Mountain That Walks | GENERIC |  | deed:chr_peaks_waking_witness |
| The Mountain Wakes | GENERIC |  | quest:q_elementals |
| The Names of the Dead | GENERIC |  | quest:q_names_of_the_dead |
| The Night Gardens | GENERIC |  | quest:q_nb_night_gardens |
| The North Watch | GENERIC |  | poi:11.8 |
| The Old Beacon | GENERIC |  | poi:12.3 |
| The Old Mill | GENERIC |  | poi:11.7 |
| The Old Shell of the Shallows | GENERIC |  | quest:q_hollow_old_marrowshell |
| The Old Wolf | GENERIC |  | quest:q_greyjaw |
| The Outfitter's Measure | GENERIC |  | quest:q_prof_attune_outfitter |
| The Pale Huntsman | GENERIC |  | mob:pale_huntsman |
| The Pale Keeper | GENERIC |  | npc:spirit_healer |
| The Palmreach | GENERIC |  | zone:10 |
| The Parterre Walk | GENERIC |  | poi:11.2 |
| The Parterre's Bounty | GENERIC |  | deed:chr_evergarden_gatherer |
| The Peaks Chronicle | GENERIC |  | npcTitle:chronicler_edda_hartwell |
| The Petal Pond | GENERIC |  | poi:11.4 |
| The Phylactery Ring | GENERIC |  | quest:q_necromancers |
| The Purple Coffer | GENERIC |  | deed:hid_bountiful_coffer |
| the Resplendent | GENERIC |  | deedTitle:col_seven_regalia |
| The Restless Dead | GENERIC |  | quest:q_bones |
| The Restless Mounds | GENERIC |  | quest:q_nb_restless_mounds |
| The Revenant Fields | GENERIC |  | quest:q_revenants |
| The Riftfields | GENERIC |  | poi:13.4 |
| The Ringleader | GENERIC |  | quest:q_ringleader |
| The Road of Lanterns | GENERIC |  | quest:q_nb_road_of_lanterns |
| The Rope-Chewers | GENERIC |  | quest:q_wf_rope_chewers |
| The Sanctum Gate | GENERIC |  | quest:q_sanctum_gate |
| The Sapphire Lagoon | GENERIC |  | poi:10.5 |
| The Seal Restored | GENERIC |  | quest:q_seal_restored |
| The Sevenfold Wardrobe | GENERIC |  | deed:col_seven_regalia |
| The Sexton's Bell | GENERIC |  | quest:q_sexton |
| The Shear | GENERIC |  | poi:12.4 |
| The Silent Trapline | GENERIC |  | quest:q_fv_silent_trapline |
| The Sky Goes Quiet | GENERIC |  | deed:chr_maw_matriarch |
| The Sleepless Barrow | GENERIC |  | poi:8.5 |
| The Smith's Promise | GENERIC |  | quest:q_prof_attune_smith |
| The Snowline | GENERIC |  | poi:5.1 |
| The Song Before the Break | GENERIC |  | quest:q_fs_song_before_the_break |
| The Sowfield | GENERIC |  | poi:0.10 |
| The Stalkers Return | GENERIC |  | quest:q_stalkers_return |
| The Standing Vigil | GENERIC |  | poi:8.4 |
| The Stolen Shears | GENERIC |  | quest:q_eg_stolen_shears |
| The Sundered Cliffs | GENERIC |  | poi:13.3 |
| The Sundered Horror | GENERIC |  | mob:sundered_horror |
| The Sunken Bastion | GENERIC |  | quest:q_bastion_door poi:1.7 dungeon:sunken_bastion |
| The Sunken Court | GENERIC |  | quest:q_sunken_court poi:3.5 |
| The Sunken Idol | GENERIC |  | poi:10.6 |
| The Thinned Veil | GENERIC |  | quest:q_veil_thinned |
| The Three Bells | GENERIC |  | quest:q_fs_the_three_bells |
| The Topiary Bull | GENERIC |  | mob:the_topiary_bull |
| The Treant Accord | GENERIC |  | quest:q_treant_accord |
| The Tumbler's Path, Mastered | GENERIC |  | deed:dlv_tumbler_premium |
| The Unbroken Circle | GENERIC |  | item:unbroken_circle |
| The Vale Chronicle | GENERIC |  | npcTitle:chronicler_saul |
| The Veiled Hollow | GENERIC |  | zone:3 |
| The View From the Top | GENERIC |  | deed:prog_level_cap |
| The Voice Below | GENERIC |  | quest:q_voice_below |
| The Waking Warden | GENERIC |  | mob:waking_warden quest:q_waking_warden |
| The Warden of the Herds | GENERIC |  | quest:q_hollow_the_huntsman |
| The Warden's Seal | GENERIC |  | item:wardens_seal |
| The Watch Meadow | GENERIC |  | poi:13.2 |
| The Watch on the Peaks | GENERIC |  | quest:q_highwatch_summons |
| The Watcher at the Wargate | GENERIC |  | quest:q_dk_watcher_at_the_wargate |
| the Wayfarer | GENERIC |  | deedTitle:exp_world_traveler |
| The Whole Book | GENERIC |  | deed:feat_book_complete |
| The Widow's Skeins | GENERIC |  | quest:q_ww_widows_skeins |
| The Willowfen | GENERIC |  | zone:7 |
| The Windway | GENERIC |  | poi:12.1 |
| The Windway Watch | GENERIC |  | npcTitle:watcher_maren |
| The Wraithwood | GENERIC |  | zone:9 |
| The Wreck Line | GENERIC |  | quest:q_pr_wreck_line_cargo |
| The Wreck Warden | GENERIC |  | mob:the_wreck_warden quest:q_gc_the_wreck_warden |
| The Wreckfields | GENERIC |  | poi:12.5 |
| The Wyrm Below | GENERIC |  | deed:dgn_gravewyrm_sanctum |
| Thick Winter Pelt | GENERIC |  | item:thick_winter_pelt |
| Thicket Boar | GENERIC |  | mob:thicket_boar |
| Thickhide Ward | GENERIC |  | mobMechanic:wildheart_beastmaster.wardAllies |
| Third Benediction | GENERIC |  | choiceRow:pal_r11_divine_wisdom |
| Third Verse | GENERIC |  | choiceRow:pri_r5_searing_light |
| Thorn | GENERIC |  | riftThemeNoun:2.1 |
| Thornback Stalker | GENERIC |  | mob:rift_thornback |
| Thornhide Boots | GENERIC |  | item:thornhide_boots |
| Thornhide Cinch | GENERIC |  | item:thornhide_cinch |
| Thornhide Garb | GENERIC |  | itemSet:warfare_thornhide |
| Thornhide Gloves | GENERIC |  | item:thornhide_gloves |
| Thornhide Headdress | GENERIC |  | item:thornhide_headdress |
| Thornhide Leggings | GENERIC |  | item:thornhide_leggings |
| Thornhide Mantle | GENERIC |  | item:thornhide_mantle |
| Thornhide Vestment | GENERIC |  | item:thornhide_vestment |
| Thornling Grips | GENERIC |  | item:thornling_grips |
| Thornpeak Crusher | GENERIC |  | mob:ogre_crusher |
| Thornpeak Heights | GENERIC |  | zone:2 |
| Thornpeak Ogre | GENERIC |  | mob:thornpeak_ogre |
| Thornpeak Wildwraps | GENERIC |  | item:thornpeak_wildwraps |
| Threadbare Robe | GENERIC |  | item:apprentice_robe |
| Threads Rejoined | GENERIC |  | quest:q_prof_amends_outfitter |
| Three Against the Grave | GENERIC |  | deed:dgn_morthen_trio |
| Threnos the First Voice | GENERIC |  | mob:threnos_first_voice |
| Throat Wire | GENERIC |  | ability:garrote |
| Through the Cold Gate | GENERIC |  | deed:chr_peaks_moongate |
| Thuggery | GENERIC |  | talentSpec:combat |
| Thunder | GENERIC |  | riftThemeNoun:6.2 |
| Thunder Slam | GENERIC |  | mobMechanic:rift_boss_storm.knockback |
| Thunder Ward | GENERIC |  | ability:lightning_shield |
| Thundercall | GENERIC |  | talentSpec:elemental |
| Thunderclap | GENERIC |  | mobMechanic:thunzharr_waking_peak.aoePulse mobMechanic:rift_storm_caller.concuss mobMechanic:rift_boss_storm.concuss |
| Thunderhead | GENERIC |  | mobMechanic:rift_boss_storm.bigCast |
| Thunderward Legguards | GENERIC |  | item:thunderward_legguards |
| Tidal Sweep | GENERIC |  | mobMechanic:sloomtooth_the_drowned.cleave |
| Tide | GENERIC |  | riftThemeNoun:7.3 |
| Tide Cadence | GENERIC |  | mobMechanic:deepfen_murloc.warcry |
| Tide Scuttler | GENERIC |  | mob:tide_scuttler |
| Tide Thrall | GENERIC |  | mob:rift_tide_thrall |
| Tidebound Acolyte | GENERIC |  | mob:tidebound_acolyte |
| Tidebound Spaulders | GENERIC |  | item:tidebound_spaulders |
| Tideglass Dirk | GENERIC |  | item:tideglass_dirk |
| Tideguard Faceguard | GENERIC |  | item:tideguard_faceguard |
| Tideguard Greaves | GENERIC |  | item:tideguard_greaves item:heroic_tideguard_greaves |
| Tideguard Sabatons | GENERIC |  | item:tideguard_sabatons item:heroic_tideguard_sabatons |
| Tidehymn Slippers | GENERIC |  | item:tidehymn_slippers |
| Tidereaver Gaff | GENERIC |  | item:tidereaver_gaff |
| Tidescale Vest | GENERIC |  | item:tidescale_vest item:heroic_tidescale_vest |
| Tidewatcher | GENERIC |  | npcTitle:tidewatcher_ondrel |
| Tidewatcher's Wraps | GENERIC |  | item:tidewatchers_wraps |
| Tideworn Warboots | GENERIC |  | item:tideworn_warboots |
| Tidewoven Trousers | GENERIC |  | item:tidewoven_trousers |
| Tidewrought Fishing Rod | GENERIC |  | item:tidewrought_fishing_rod |
| Timber! | GENERIC |  | deed:exp_first_timber |
| Toll and Tangle | GENERIC |  | quest:q_wf_toll_and_tangle |
| Tolling Bell | GENERIC |  | mob:tolling_bell |
| Tolling Hammer | GENERIC |  | ability:hammer_of_wrath choiceRow:pal_r20_hammer_of_wrath |
| Tools of the Trade | GENERIC |  | deed:prog_tools_of_the_trade |
| Toolworks Work Order | GENERIC |  | quest:q_prof_workorder_toolworks |
| Topiary Stag | GENERIC |  | mob:topiary_stag |
| Topiary Wolf | GENERIC |  | mob:topiary_wolf |
| Totems of War | GENERIC |  | quest:q_ogre_totems |
| Toughness | GENERIC |  | augment:2 |
| Town Marshal | GENERIC |  | npcTitle:marshal_redbrook |
| Trade Secrets | GENERIC |  | deed:prog_craft_specialist |
| Trader Wilkes | GENERIC |  | npc:trader_wilkes |
| Tradesman's Hatchet | GENERIC |  | item:tradesman_hatchet |
| Trailworn Leggings | GENERIC |  | item:trail_leggings |
| Training Dummy | GENERIC |  | mob:training_dummy |
| Training Mace | GENERIC |  | item:training_mace |
| Trampling Charge | GENERIC |  | mobMechanic:aurelhorn.aoePulse |
| Traveler's Knapsack | GENERIC |  | item:travelers_knapsack |
| Treant Elder | GENERIC |  | mob:treant_elder |
| Troll Mounds | GENERIC |  | poi:1.5 |
| Trollhide Leggings | GENERIC |  | item:trollhide_leggings |
| Trolls on the Road | GENERIC |  | quest:q_dk_trolls_on_the_road |
| Trouble at the Lake | GENERIC |  | quest:q_murlocs |
| True Colors | GENERIC |  | deed:col_true_colors |
| Tunnelking's Spade | GENERIC |  | item:tunnelkings_spade |
| Tusk Sweep | GENERIC |  | mobMechanic:wildheart_ravager.cleave |
| Twin Fletching | GENERIC |  | choiceRow:hun_r5_quick_shots |
| Twin Fracture | GENERIC |  | choiceRow:pri_r14_mind_melt |
| Twin Gavels | GENERIC |  | choiceRow:pal_r8_fist_of_justice |
| Twitching Spider Leg | GENERIC |  | item:spider_leg |
| Two Strong | GENERIC |  | deed:pvp_arena_2v2_1600 |
| Two's a Crowd | GENERIC |  | deed:dlv_solo_heroic |
| Typhoon | GENERIC |  | ability:typhoon choiceRow:dru_r8_typhoon |
| Umbral | GENERIC |  | riftThemeNoun:5.2 |
| Under One Banner | GENERIC |  | deed:soc_guild_joined |
| Undertow | GENERIC |  | mobMechanic:rift_boss_tide.aoeSlow |
| Undertow Promise | GENERIC |  | choiceRow:sha_r20_tidal_waves |
| Unkillable | GENERIC |  | augment:16 |
| Unknown Alien Weaponry | GENERIC |  | item:unknown_alien_weaponry |
| Unrest in the Bonefields | GENERIC |  | quest:q_nythraxis_restless_dead |
| Unstable Roof | GENERIC |  | delveAffix:unstable_roof |
| Urgent Prayer | GENERIC |  | ability:flash_heal |
| Vale Apprentice Staff | GENERIC |  | item:apprentice_staff |
| Vale Arcanist's Regalia | GENERIC |  | itemSet:vale_arcanist deed:col_set_vale_arcanist |
| Vale Bandit | GENERIC |  | mob:vale_bandit |
| Vale Carving Knife | GENERIC |  | item:vale_carving_knife |
| Vale Chapel Yard | GENERIC |  | graveyard:gy_vale_chapel |
| Vale Chronicle, Chapter I | GENERIC |  | deed:chr_vale_chapter_i |
| Vale Chronicle, Chapter II | GENERIC |  | deed:chr_vale_chapter_ii |
| Valeborn Spellblade | GENERIC |  | item:valeborn_spellblade |
| Valefire Lantern | GENERIC |  | item:valefire_lantern |
| Valespun Robe | GENERIC |  | item:valespun_robe |
| Valewoven Robe | GENERIC |  | item:woven_robe |
| Valor Roar | GENERIC |  | ability:rallying_cry |
| Vampirism | GENERIC |  | augment:9 |
| Vanguard Azure | GENERIC |  | item:vanguard_azure_armor_plate |
| Vanguard Bone | GENERIC |  | item:vanguard_bone |
| Vanguard Chrome | GENERIC |  | item:vanguard_chrome_armor_plate |
| Vaultbound Legwraps | GENERIC |  | item:reliquary_legs |
| Veilcloth Robe | GENERIC |  | item:veilcloth_robe |
| Veiled Doe | GENERIC |  | mob:veiled_doe |
| Veiled Stag | GENERIC |  | mob:veiled_stag |
| Venom | GENERIC |  | mobMechanic:rift_venom_weaver.venom riftThemeNoun:2.0 |
| Venom Barb | GENERIC |  | ability:serpent_sting |
| Venom Deluge | GENERIC |  | mobMechanic:rift_boss_venom.bigCast |
| Venom Dividend | GENERIC |  | choiceRow:rog_r14_deadly_brew |
| Venom Gland | GENERIC |  | item:venom_gland |
| Venom Pool | GENERIC |  | mobMechanic:rift_boss_venom.deathZoneCast |
| Venom Spray | GENERIC |  | mobMechanic:rift_boss_venom.aoePulse |
| Venom Weaver | GENERIC |  | mob:rift_venom_weaver |
| Verdant Rift Gem | GENERIC |  | item:rift_gem_verdant |
| Verdant Walkers | GENERIC |  | item:verdant_walkers item:heroic_verdant_walkers |
| Verdant-Heart Vestment | GENERIC |  | item:verdant_heart_vestment |
| Verdict | GENERIC |  | ability:judgement |
| Vespers | GENERIC |  | talentSpec:shadow |
| Vestments of the Waking Grove | GENERIC |  | item:vestments_of_the_waking_grove |
| Veteran | GENERIC |  | deed:prog_veteran deedTitle:prog_veteran |
| Vicar Creel | GENERIC |  | npc:vicar_creel |
| Vigil | GENERIC |  | talentSpec:protection |
| Vigil Star Chart | GENERIC |  | item:vigil_star_chart |
| Vineclaw Stalker | GENERIC |  | mob:wildheart_stalker |
| Vineclaw Stalking Breeches | GENERIC |  | item:vineclaw_stalking_breeches |
| Vipersear Elixir | GENERIC |  | item:venomfire_elixir |
| Vision of Royal Assassin Voss | GENERIC |  | mob:vision_deathstalker_voss |
| Voice of the Shrine | GENERIC |  | npcTitle:loremother_bryn |
| Void | GENERIC |  | riftThemeNoun:5.0 |
| Void Demon | GENERIC |  | mob:warlock_voidwalker |
| Void Rift | GENERIC |  | mobMechanic:rift_boss_arcane.deathZoneCast |
| Void Rot | GENERIC |  | mobMechanic:rift_void_acolyte.arcaneRot |
| Void Stalker | GENERIC |  | mob:void_stalker |
| Voidscar Acolyte | GENERIC |  | mob:rift_void_acolyte |
| Voidsong, Dirk of the Sundered Veil | GENERIC |  | item:voidsong_dirk |
| Voidweave Mantle | GENERIC |  | item:voidweave_mantle |
| Volley | GENERIC |  | ability:volley |
| Voss's Sanctified Mace | GENERIC |  | item:voss_sanctified_mace |
| Votive Chain Belt | GENERIC |  | item:votive_chain_belt |
| Walking Hunger | GENERIC |  | choiceRow:wlk_r11_fel_concentration |
| Walking Mosley Home | GENERIC |  | quest:q_ww_walking_mosley_home |
| Wall Drills | GENERIC |  | deed:chr_peaks_sparring |
| Wallbreaker Smash | GENERIC |  | mobMechanic:brakka_wallbreaker.concuss |
| Wanderer's Chestguard | GENERIC |  | item:wanderers_chestguard |
| War | GENERIC |  | riftThemeNoun:4.0 |
| Warcamp | GENERIC |  | riftTheme:4 |
| Ward of Faith | GENERIC |  | ability:divine_protection |
| Warded | GENERIC |  | choiceRow:mag_r8_warded |
| Warden Fenwick | GENERIC |  | npc:warden_fenwick |
| Warden of Fenbridge | GENERIC |  | npcTitle:warden_fenwick |
| Warden of the Dead | GENERIC |  | npcTitle:spirit_healer |
| Warden of the Herds | GENERIC |  | npcTitle:huntsman_deral |
| Warden of the Hollow | GENERIC |  | deed:pvp_bg_wins_25 |
| Warden's Oathband | GENERIC |  | item:wardens_oathband |
| Warding Refrain | GENERIC |  | choiceRow:pri_r5_improved_renew |
| Warding Rubbing | GENERIC |  | item:moongate_rubbing |
| Wardplate Cuirass | GENERIC |  | item:wardplate_cuirass |
| Wardsmith Orun | GENERIC |  | npc:wardsmith_orun |
| Wardweave Cowl | GENERIC |  | item:wardweave_cowl |
| Warfiend | GENERIC |  | mob:warfiend |
| Warlock | GENERIC |  | class:warlock |
| Warlord's Bellow | GENERIC |  | mobMechanic:rift_boss_brute.terrify |
| Warlord's Might | GENERIC |  | augment:7 |
| Warmarshal Draven Kole | GENERIC |  | npc:warmarshal_draven_kole |
| Warrior | GENERIC |  | class:warrior |
| Warspirit | GENERIC |  | talentSpec:enhancement |
| Waste Not | GENERIC |  | deed:soc_first_salvage |
| Watchbell Keeper | GENERIC |  | npcTitle:bellkeeper_tam |
| Watcher at the Vigil | GENERIC |  | npcTitle:astronomer_cassian |
| Watcher Maren | GENERIC |  | npc:watcher_maren |
| Water Elemental | GENERIC |  | mob:water_elemental |
| Waterlogged Idol | GENERIC |  | item:waterlogged_idol |
| Wayfarer of the Heights | GENERIC |  | deed:exp_peaks_wayfarer |
| Wayfarer of the Marsh | GENERIC |  | deed:exp_marsh_wayfarer |
| Wayfarer of the Vale | GENERIC |  | deed:exp_vale_wayfarer |
| Wayfarer's Hood | GENERIC |  | item:wayfarers_hood |
| Waykeeper Pell | GENERIC |  | npc:waykeeper_pell |
| Weakening Hex | GENERIC |  | mobMechanic:gravecaller_cultist.hex |
| Weaponcrafting | GENERIC |  | craft:weaponcrafting |
| Weathered Ledger Page | GENERIC |  | item:weathered_ledger_page |
| Weathered Monument | GENERIC |  | item:monument_overlook |
| Weaver Amelle | GENERIC |  | npc:weaver_amelle |
| Weaver Ottilie | GENERIC |  | npc:weaver_ottilie |
| Web | GENERIC |  | mobMechanic:rift_venom_weaver.ensnare mobMechanic:rift_boss_venom.ensnare |
| Web Snare | GENERIC |  | mobMechanic:mirefen_widowling.chillOnHit |
| Well Rested | GENERIC |  | deed:prog_well_rested |
| West Spire Graves | GENERIC |  | graveyard:gy_thornpeak_west |
| What the Bark Holds | GENERIC |  | quest:q_ww_what_the_bark_holds |
| What the Crypt Kept | GENERIC |  | deed:dgn_nythraxis_crypt |
| What the Drums Guard | GENERIC |  | quest:q_pr_what_the_drums_guard |
| What the Gulls Know | GENERIC |  | deed:chr_farshore_first_cast |
| What the Stones Remember | GENERIC |  | quest:q_monument_tour |
| What the Tarn Gives Up | GENERIC |  | quest:q_tarn_waders |
| What Took the Moorings | GENERIC |  | quest:q_af_what_took_the_moorings |
| Whetted Iron Dirk | GENERIC |  | item:whetted_iron_dirk |
| Whispered Prayer | GENERIC |  | ability:lesser_heal |
| Whispers Below | GENERIC |  | quest:q_whispers |
| Whiteout | GENERIC |  | mobMechanic:rift_boss_frost.bigCast |
| Who Trims the Hedges | GENERIC |  | quest:q_eg_who_trims_the_hedges |
| Wicked Slash | GENERIC |  | ability:sinister_strike |
| Wickmother Sorrel | GENERIC |  | npc:wickmother_sorrel |
| Wickspun Treads | GENERIC |  | item:wickspun_treads |
| Widening Arc | GENERIC |  | ability:sweeping_strikes |
| Widow Hatchling | GENERIC |  | mob:widow_hatchling |
| Widow Tansy | GENERIC |  | npc:widow_tansy |
| Widow Thicket | GENERIC |  | poi:1.3 |
| Widow Venom Sac | GENERIC |  | item:widow_venom_sac |
| Widow-Silk Hood | GENERIC |  | item:widow_silk_hood |
| Widow's Thicket | GENERIC |  | poi:9.2 |
| Widowfang Dirk | GENERIC |  | item:widowfang_dirk |
| Widowsilk Skein | GENERIC |  | item:widowsilk_skein |
| Widowsilk Spinner | GENERIC |  | mob:widowsilk_spinner |
| Wild Boar | GENERIC |  | mob:wild_boar |
| Wildgrove Cinch | GENERIC |  | item:wildgrove_cinch |
| Wildgrowth Leggings | GENERIC |  | item:wildgrowth_leggings item:heroic_wildgrowth_leggings |
| Wildheart Basin | GENERIC |  |  |
| Wildheart Pulse | GENERIC |  | mobMechanic:wildheart_high_priest.aoePulse |
| Wildsoul Maul | GENERIC |  | item:wildsoul_maul |
| Willow Sprite | GENERIC |  | mob:willow_sprite |
| Willowfen Barrow | GENERIC |  | graveyard:gy_willowfen |
| Wind Against the Wick | GENERIC |  | quest:q_gc_wind_against_the_wick |
| Windguard Leggings | GENERIC |  | item:windguard_leggings |
| Wing Buffet | GENERIC |  | mobMechanic:rift_boss_pitlord.knockback |
| Winter's Recall | GENERIC |  | ability:cold_snap choiceRow:mag_r17_cold_snap |
| Wisp Mote | GENERIC |  | item:wisp_mote |
| Wisplight Globe | GENERIC |  | item:wisplight_globe |
| Witchlight | GENERIC |  | ability:faerie_fire |
| Withered Benediction | GENERIC |  | mobMechanic:corrupted_priest_malric.manaBurn |
| Withering Rot | GENERIC |  | mobMechanic:fen_troll.wither |
| Withering Wail | GENERIC |  | mobMechanic:restless_bones.demoralize |
| Wolf Form | GENERIC |  | ability:cat_form |
| Wolf Run | GENERIC |  | poi:0.1 |
| Wolfhide Satchel | GENERIC |  | item:wolfhide_satchel |
| Wolfsblood | GENERIC |  | ability:tigers_fury |
| Wolves at the Door | GENERIC |  | quest:q_wolves quest:q_fv_wolves_at_the_door |
| Wood Wraith | GENERIC |  | mob:wood_wraith |
| Wool by Moonlight | GENERIC |  | quest:q_nb_wool_by_moonlight |
| Wool off the Downs | GENERIC |  | quest:q_gc_wool_off_the_downs |
| Word from the Snowline | GENERIC |  | quest:q_fv_snowline_report |
| Word Through the Gate | GENERIC |  | quest:q_eg_gate_report |
| Word-Perfect | GENERIC |  | deed:dlv_rite_flawless |
| World Traveler | GENERIC |  | deed:exp_world_traveler |
| Wounded Halo | GENERIC |  | choiceRow:pri_r17_inner_fire |
| Woven Silk Sash | GENERIC |  | item:silk_sash |
| Wraith Strike | GENERIC |  | ability:ghostly_strike choiceRow:rog_r14_ghostly_strike |
| Wraithborn | GENERIC |  | mob:wraithborn |
| Wraithfire Cord | GENERIC |  | item:soulflame_cord |
| Wraithfire Cowl | GENERIC |  | item:soulflame_cowl item:heroic_soulflame_cowl |
| Wraithfire Gloves | GENERIC |  | item:soulflame_gloves |
| Wraithfire Mantle | GENERIC |  | item:soulflame_mantle item:heroic_soulflame_mantle |
| Wraithfire Orb | GENERIC |  | item:wraithfire_orb item:heroic_wraithfire_orb |
| Wraithfire Regalia | GENERIC |  | itemSet:soulflame deed:col_set_soulflame |
| Wraiths of the Tarn | GENERIC |  | quest:q_ww_wraiths_of_the_tarn |
| Wraithwood Graves | GENERIC |  | graveyard:gy_wraithwood |
| Wreckfield Thief | GENERIC |  | mob:wreck_thief |
| Wyrmchoir Handwraps | GENERIC |  | item:wyrmchoir_handwraps |
| Wyrmfang Greatblade | GENERIC |  | item:wyrmfang_greatblade item:heroic_wyrmfang_greatblade |
| Wyrmscale Jerkin | GENERIC |  | item:wyrmscale_jerkin |
| Wyrmward Sigil | GENERIC |  | mobMechanic:wyrmcult_zealot.lockout mobMechanic:threnos_first_voice.lockout |
| Wyrmwatch Warning Banner | GENERIC |  | item:wyrmwatch_warning_banner |
| Yumi | GENERIC |  | mob:yumi_cat |
| Yumi's Biggest Fan | GENERIC |  | deed:hid_yumi_cheer |
| Yumi's Keepsake Locket | GENERIC |  | item:yumis_keepsake_locket |
| Zealotsbane Blade | GENERIC |  | item:zealotsbane_blade |
## Evidence links (confirmed collisions)

Source URLs captured by the sweep and verify agents at audit time (they may rot;
the named source in the rename table is the durable citation):

- Crusader Strike: https://warcraft.wiki.gg/wiki/Crusader_Strike
- Cryptbloom Shoulderguards: https://runescape.wiki/w/Cryptbloom_armour
- Deacon Varric: https://dragonage.fandom.com/wiki/Varric_Tethras
- Eldergleam: https://en.uesp.net/wiki/Skyrim:Eldergleam_Sanctuary
- Flickerstep: https://diablo.fandom.com/wiki/Flickerstep
- Frostmane Yeti: https://warcraft.wiki.gg/wiki/Frostmane_tribe
- Frozen Orb: https://warcraft.wiki.gg/wiki/Frozen_Orb
- Gallowmere: https://en.wikipedia.org/wiki/MediEvil
- Glacial Spike: https://warcraft.wiki.gg/wiki/Glacial_Spike
- Harvest Sprite: https://harvestmoon.fandom.com/wiki/Harvest_Sprites_(FoMT)
- Hellfire Ring: https://diablo.fandom.com/wiki/Hellfire_Ring
- Hellsteel Sweep: https://warcraft.wiki.gg/wiki/Kazzara,_the_Hellforged
- Heroic Leap: https://warcraft.wiki.gg/wiki/Heroic_Leap
- Holy Nova: https://warcraft.wiki.gg/wiki/Holy_Nova
- Holy Shock: https://warcraft.wiki.gg/wiki/Holy_Shock
- Icy Veins: https://warcraft.wiki.gg/wiki/Icy_Veins
- Ignition Key: Terrorspark Groundshaker: https://www.wowhead.com/npc=10078/terrorspark
- Knight-Lieutenant: https://warcraft.wiki.gg/wiki/Knight-Lieutenant
- Mistforged Pauldrons: https://wiki.guildwars2.com/index.php?search=Mistforged
- Nightkin Stargazer: https://fallout.fandom.com/wiki/Nightkin
- Okku: https://forgottenrealms.fandom.com/wiki/Okku
- Sanctum Sprint: https://wiki.guildwars2.com/wiki/Sanctum_Sprint
- Smokestep: https://runescape.wiki/w/Smokestep_aura
- Spellbreak: https://en.wikipedia.org/wiki/Spellbreak
- Spellsteal: https://warcraft.wiki.gg/wiki/Spellsteal
- Spiritmend: https://warcraft.wiki.gg/wiki/Spiritmend_Robe
- Storm Bolt: https://warcraft.wiki.gg/wiki/Storm_Bolt
- Stormcrag: https://en.uesp.net/wiki/Online:Stormcrag_Crypt
- Summon Emberkin: https://www.d20pfsrd.com/races/other-races/featured-races/arg-aasimar/
- Summon Gloomshade: https://warcraft.wiki.gg/wiki/Gloomshade_Grove
- Summon Warfiend: https://warcraft.wiki.gg/wiki/Soulripper_Warfiend
- Swiftmend: https://warcraft.wiki.gg/wiki/Swiftmend
- The Moonwell: https://warcraft.wiki.gg/wiki/Moonwell
- Varric's Shadow Cowl: https://dragonage.fandom.com/wiki/Varric_Tethras
- Victory Rush: https://warcraft.wiki.gg/wiki/Victory_Rush
- Winterbite: https://www.destinypedia.com/Winterbite
- Wrathwing: https://calamitymod.fandom.com/wiki/Wrathwing
- Wyrmcult Grand Robe: https://warcraft.wiki.gg/wiki/Wyrmcult
- Wyvern Sting: https://warcraft.wiki.gg/wiki/Wyvern_Sting
