# FINAL MASTER DESIGN SPEC — World of Claudecraft Expansion (Levels 6–20)

Synthesized directly from the WORLD_BRIEF and the three judge verdicts (no designer text survived; this document IS the design). All XP math recomputed against `src/sim/types.ts` (`XP_TABLE`, `mobXpValue`, `zeroDiff`, `GROUP_XP_BONUS`): XP 6→13 = 46,500; 13→20 = 113,100; kill XP = 45+5×mobLevel at level; elite ×2; dungeon per-member XP = mobXp × 2 × 1.43 / 5 = 0.572× solo (dungeons are loot/story events, NOT XP soaks); 1.6× overshoot applied to quest-required kills only. All ids snake_case, collision-checked against `src/sim/data.ts` @ 2d05cc2. Companion specs (ability ranks 1–20, procedural icons, graphics tiers) already exist in `wf_0c329a02-def/journal.jsonl` — referenced in §7, not regenerated.

---

# 1. Story Arc (incl. Hollow Crypt build-up quests)

## Three-act spine: The Gravecaller Conspiracy

The hook is already planted in `q_whispers` (data.ts:1177): *"the mark of the Gravecallers, a sect I had prayed was extinct."* The expansion makes Morthen the opening act of a three-act cult conspiracy. **Brother Aldric** recurs physically in all three zones (new NpcDef entries with new ids but the same display name "Brother Aldric"), and **Scout Maren**, a zone-2 native, recurs into zone 3 — so every reveal lands on a known face.

- **Act I — Eastbrook Vale (1–10, exists + enhancements).** The dead won't rest. Players uncover the Gravecaller sigil, perform the Binding Rite, and kill Morthen the Gravecaller in the Hollow Crypt. NEW build-up quests (below) establish that Morthen was raising the chapel's own buried congregation — and his correspondence reveals he answered to a master in the marsh.
- **Act II — Mirefen Marsh (6–13).** Morthen was only an acolyte. The cult's **Vael the Mistcaller** is drowning travelers in the fen and raising them as an army — the Drowned Dead. The marsh trolls dug too deep into old burial mounds and woke things; the murlocs are dredging up cult idols from the lakebed. The chain runs: muster at Fenbridge → trace the idols → the Drowned Chapel → break the cult camp → kill Deacon Voss → storm **The Sunken Bastion** (5-player, L13) and kill Vael. His final words name the true master: *"The Wyrm stirs beneath the peaks."*
- **Act III — Thornpeak Heights (13–20).** The Gravecallers serve **Korzul the Gravewyrm**, an ancient dragon the sect has spent generations trying to wake — every raised corpse in the Vale and the fen was a tithe of souls. The ogre clans have been bought as muscle (Warlord Drogmar), elementals shake loose from the mountain as the Wyrm turns in its sleep, and the Wyrmcult openly chants at the **Gravewyrm Sanctum** gates. The finale: a solo-able lead-up chain (18–19) breaks the seal, then a 5-player dungeon kills Grand Necromancer Velkhar, Korgath the Bound, and finally Korzul at level 20.

## Hollow Crypt build-up quests (zone 1 additions, L7–9)

Four new quests make the crypt "riveting" using only existing engine patterns (ground sparkles per the `gravecaller_sigil` precedent, staged kill chains, in-instance kill quest). These also patch the 7–9 solo soft gap.

| id | name | giver → turn-in | objectives | xp | copper | chain |
|---|---|---|---|---|---|---|
| q_names_of_the_dead | The Names of the Dead | brother_aldric | collect 3 weathered_ledger_page (sparkles in the Fallen Chapel yard, ~(78,84)–(86,92)) | 600 | 250 | requires q_whispers |
| q_silence_the_call | Silence the Call | brother_aldric | kill 12 restless_bones | 750 | 300 | requires q_names_of_the_dead |
| q_sexton | The Sexton's Bell | brother_aldric | kill 1 sexton_marrow (in Hollow Crypt) | 1000 | 600 | requires q_rite, suggestedPlayers 5 |
| q_gravecallers_trail | The Gravecaller's Trail | brother_aldric | collect 1 morthen_grimoire (sparkle in the chapel vestry ruin at (78,86) — overworld, NOT in-instance) | 900 | 400 | requires q_hollow |

Lore beats: the ledger reveals Sexton Marrow was the chapel's living caretaker — the first man Morthen raised. `q_gravecallers_trail` turn-in text from Aldric: *"Morthen wrote to a 'Mistcaller' in the southern fen. The sect is not dead, $N — it has merely been patient."* This is the narrative bridge to zone 2 (the actual travel breadcrumb `q_fenbridge_muster` is gated only on minLevel 6, NOT on the 5-man crypt, so solo players are never locked out).

---

# 2. Zone 2 spec — Mirefen Marsh (levels 6–13)

**Biome:** `marsh` (already in `BiomeId`). **z-band:** 180..540 (zone 1 untouched; `ZONES` append is the engine-intended path — `zoneAt`/`WORLD_MIN_Z`/`MAX_Z` derive). World becomes 360 wide × 1080 long once zone 3 lands.

**ZoneDef:** `{ id: 'mirefen_marsh', name: 'Mirefen Marsh', zMin: 180, zMax: 540, levelRange: [6,13], biome: 'marsh', hub: { x: 0, z: 300, radius: 20, name: 'Fenbridge' }, graveyard: { x: -18, z: 286 }, lakes: [{x:-110,z:310,radius:35},{x:60,z:380,radius:25},{x:-40,z:450,radius:20}], welcome: 'Report to Warden Fenwick at the Fenbridge gate.' }`

**POIs:** Fenbridge (0,300); Prowler Reeds (-40,230); Deepfen Shallows (-105,300); Widow Thicket (80,315); Drowned Chapel (100,435); Troll Mounds (-95,440); Gravecaller Encampment (0,485); The Sunken Bastion (45,515).

**Roads:** Eastbrook→Fenbridge: (0,80)→(0,180)→(-8,240)→(0,300). Fenbridge spokes: →(50,380)→(90,420) [Drowned Chapel]; →(-40,370)→(-80,420) [Troll Mounds]; →(10,400)→(20,470)→(45,515) [cult camp → Bastion]. Camps sit 40–90 yd off-road.

## Hub NPCs (Fenbridge)

| id | name / title | pos | quests | vendor |
|---|---|---|---|---|
| warden_fenwick | Warden Fenwick, Warden of Fenbridge | (3,304) | q_fenbridge_muster (turn-in), q_prowlers, q_deepfen, q_deepfen_purge, q_trolls, q_deacon | — |
| brother_aldric_fen | Brother Aldric, Priest of the Vale | (-8,296) | q_idols, q_drowned, q_drowned_censers, q_no_rest, q_summoners, q_bastion_door, q_mistcaller, q_highwatch_summons (giver) | — |
| provisioner_hale | Provisioner Hale | (-4,308) | q_prowler_pelts, q_fen_supplies, q_grubjaw | fenbridge_rye, marsh_mint_tea, smoked_eel, silvermist_cordial, bogiron_mace, fenreed_staff, mirefen_skinner, bogiron_hauberk, marshcloth_robe, reedwoven_jerkin, fenwalker_boots, reedwoven_trousers |
| herbalist_yara | Herbalist Yara | (10,295) | q_widows, q_broodmother | — |
| scout_maren | Scout Maren, Marshal's Scout | (6,312) | q_troll_fetishes, q_cult_camp, q_olen | — |

## Mobs table

Elite multipliers (2.3× hp, 1.5× dmg, 2× XP) applied by the sim — values below are pre-elite bases.

| id | name | family | lvl | flags | hpBase/perLvl | dmgBase/perLvl | atkSpd | notes / loot highlights |
|---|---|---|---|---|---|---|---|---|
| mire_prowler | Mire Prowler | beast | 7–8 | — | 46/19 | 7/2.1 | 2.0 | copper 30; mire_prowler_pelt 0.6 (q_prowler_pelts); soggy_moccasin 0.3 |
| deepfen_murloc | Deepfen Snapper | murloc | 8–9 | — | 48/19 | 7/2.2 | 1.9 | aggro 14, social; copper 35; waterlogged_idol 0.5 (q_idols); mudfin_scale 0.4 |
| mire_widow | Mirefen Widow | spider | 8–10 | — | 48/19 | 8/2.2 | 1.8 | copper 38; widow_venom_sac 0.65 (q_widows); spider_leg 0.4 |
| mirefen_broodmother | The Broodmother | spider | 10 | boss | 150/26 | 9/2.4 | 1.8 | scale 1.4; copper 300; marshstrider_boots 0.4 |
| drowned_dead | Drowned Dead | undead | 9–11 | — | 52/20 | 8/2.3 | 2.3 | copper 42; bone_fragments 0.5; cracked_fetish 0.3 |
| fen_troll | Mirefen Troll | **troll** (new) | 10–12 | — | 56/21 | 9/2.4 | 2.2 | copper 50; troll_fetish 0.6 (q_troll_fetishes); chipped_tusk 0.4 |
| grubjaw | Grubjaw the Glutton | troll | 12 | rare | 130/26 | 10/2.5 | 2.2 | Old Greyjaw pattern; grubjaw_tusk 1.0 (q_grubjaw); copper 200 |
| gravecaller_cultist | Gravecaller Cultist | humanoid | 10–12 | — | 50/20 | 9/2.4 | 2.0 | copper 55; linen_scrap 0.3; tallow_candle 0.3 |
| gravecaller_summoner | Gravecaller Summoner | humanoid | 11–12 | — | 46/19 | 10/2.5 | 2.0 | copper 60; cult_cipher 0.6 (q_summoners) |
| deacon_voss | Deacon Voss | humanoid | 12 | boss | 200/30 | 11/2.5 | 2.4 | aoePulse {10,14,r10,every12,'Drowning Hymn'} (existing mechanic); copper 600 |
| bastion_revenant | Bastion Revenant | undead | 12–13 | elite | 54/21 | 9/2.4 | 2.3 | copper 150; bone_fragments 0.7 |
| tidebound_acolyte | Tidebound Acolyte | humanoid | 12–13 | elite | 50/20 | 10/2.5 | 2.0 | copper 170; linen_scrap 0.5 |
| drowned_thrall | Drowned Thrall | undead | 11 | (summoned add) | 40/14 | 7/2.0 | 2.0 | no loot; Vael's summonAdds target |
| knight_commander_olen | Knight-Commander Olen | undead | 13 | elite, miniboss | 120/26 | 11/2.6 | 2.2 | copper 800; knight_commanders_greaves 0.0 (quest reward, not drop) |
| vael_the_mistcaller | Vael the Mistcaller | humanoid | 13 | elite, boss | 240/34 | 12/2.6 | 2.4 | aoePulse {16,24,r12,every10,'Mist Surge'} + **summonAdds** {drowned_thrall, 2, [0.6,0.3]}; copper 5000; tidescale_vest 0.5; deepfen_pearl 1.0 |

## Camps sketch

```
{ mobId:'mire_prowler', (-40,230), r22, c7 }   { mobId:'mire_prowler', (35,225), r20, c6 }
{ mobId:'deepfen_murloc', (-95,290), r16, c8 } { mobId:'deepfen_murloc', (-115,330), r14, c6 }
{ mobId:'mire_widow', (70,300), r20, c7 }      { mobId:'mire_widow', (95,340), r16, c6 }
{ mobId:'mirefen_broodmother', (98,348), r3, c1 }
{ mobId:'drowned_dead', (90,420), r20, c8 }    { mobId:'drowned_dead', (115,450), r16, c6 }
{ mobId:'fen_troll', (-80,420), r22, c7 }      { mobId:'fen_troll', (-105,455), r18, c6 }
{ mobId:'grubjaw', (-120,480), r8, c1 }
{ mobId:'gravecaller_cultist', (15,470), r20, c7 } { mobId:'gravecaller_cultist', (-25,490), r16, c6 }
{ mobId:'gravecaller_summoner', (-5,500), r12, c4 }
{ mobId:'deacon_voss', (0,510), r2, c1 }
```

Ground sparkles: fen_muster_order ×2 at (1,294),(-2,297); lost_caravan_goods ×7 along the (0,180)→(0,300) causeway; rusted_censer ×6 in the Drowned Chapel yard (~(95,428)–(108,442)); bastion_ward_stone ×2 at (43,512),(48,517).

## Quests table

First five quests are all on the two camps nearest the hub — zero dead travel in the first 30 minutes; they single-handedly carry solo 7→9 (with the zone-1 crypt build-up quests as the second leg).

| id | name | giver | objectives | xp | copper | rewards | chain / gates |
|---|---|---|---|---|---|---|---|
| q_fenbridge_muster | Muster at Fenbridge | brother_aldric → warden_fenwick | collect 1 fen_muster_order (sparkle, Fenbridge gate) | 300 | 200 | — | minLevel 6 (breadcrumb) |
| q_prowlers | Teeth of the Fen | warden_fenwick | kill 12 mire_prowler | 800 | 300 | — | — |
| q_prowler_pelts | Pelts for the Causeway | provisioner_hale | collect 8 mire_prowler_pelt | 850 | 350 | — | — |
| q_fen_supplies | The Lost Caravan | provisioner_hale | collect 5 lost_caravan_goods (sparkles) | 900 | 350 | — | minLevel 7 |
| q_deepfen | The Deepfen Stirs | warden_fenwick | kill 12 deepfen_murloc | 1000 | 400 | — | minLevel 7 |
| q_idols | Idols of the Deep | brother_aldric_fen | collect 5 waterlogged_idol | 1050 | 400 | — | requires q_deepfen |
| q_deepfen_purge | Back to the Shallows | warden_fenwick | kill 14 deepfen_murloc | 1100 | 450 | — | requires q_idols |
| q_widows | Silk and Venom | herbalist_yara | kill 10 mire_widow; collect 6 widow_venom_sac | 1200 | 450 | — | minLevel 8 |
| q_broodmother | The Broodmother | herbalist_yara | kill 8 mire_widow; kill 1 mirefen_broodmother | 1250 | 500 | — | requires q_widows |
| q_drowned | The Drowned Dead | brother_aldric_fen | kill 12 drowned_dead | 1400 | 500 | — | minLevel 9 |
| q_drowned_censers | Censers from the Deep | brother_aldric_fen | collect 4 rusted_censer (sparkles, Drowned Chapel) | 1300 | 500 | — | requires q_drowned |
| q_no_rest | No Rest in the Reeds | brother_aldric_fen | kill 14 drowned_dead | 1500 | 550 | drownedguard_breastplate / fenmist_robe / eelskin_tunic | requires q_drowned_censers |
| q_trolls | Mounds of the Mirefen | warden_fenwick | kill 12 fen_troll | 1600 | 600 | — | minLevel 10 |
| q_troll_fetishes | Fetish and Bone | scout_maren | collect 8 troll_fetish | 1650 | 600 | trollhide_leggings (all archetypes) | requires q_trolls |
| q_grubjaw | The Glutton | provisioner_hale | collect 1 grubjaw_tusk (rare spawn) | 1700 | 700 | marshstrider_boots (all) | minLevel 11 |
| q_cult_camp | Robes in the Reeds | scout_maren | kill 12 gravecaller_cultist | 1800 | 700 | — | minLevel 11 |
| q_summoners | Stopping the Summoning | brother_aldric_fen | kill 8 gravecaller_summoner; collect 4 cult_cipher | 1900 | 750 | — | requires q_cult_camp |
| q_deacon | The Deacon of the Mire | warden_fenwick | kill 1 deacon_voss | 2200 | 1000 | deacons_cleaver / staff_of_drowned_prayers / mistbinder_kris | requires q_summoners |
| q_bastion_door | The Sunken Bastion | brother_aldric_fen | collect 1 bastion_ward_stone (sparkle at the door) | 1200 | 500 | — | requires q_deacon, minLevel 12 |
| q_olen | The Knight-Commander's Shame | scout_maren | kill 1 knight_commander_olen | 1800 | 800 | knight_commanders_greaves (all) | requires q_bastion_door, minLevel 12, suggestedPlayers 5 |
| q_mistcaller | The Mistcaller | brother_aldric_fen | kill 1 vael_the_mistcaller | 2800 | 2500 | mistcallers_edge / vaels_mist_staff / riptide_dirk | requires q_bastion_door, minLevel 12, suggestedPlayers 5 |

Quest XP ceiling check: max single reward 2,800 at intended L13 = 24.6% of 11,400 (under the 25% ceiling; existing precedent q_hollow = 23%).

## The Sunken Bastion (zone-2 dungeon, 5-player, ~L13)

`DungeonDef`: `{ id: 'sunken_bastion', name: 'The Sunken Bastion', index: 1, doorPos: {x:45, z:515}, entry: {x:0,z:0}, exitOffset: {x:0,z:-6}, interior: 'crypt' (REUSE — cheap path; re-skin via marsh palette if free), suggestedPlayers: 5, enterText: 'You wade down into the Sunken Bastion...', leaveText: 'You climb out of the drowning dark.' }`

Spawn list (mirrors the 13-spawn crypt pacing — packs of 2 beyond social-aggro range):

```
bastion_revenant (-3,18) (3,19)
bastion_revenant (-9,38)  tidebound_acolyte (-5,39)
tidebound_acolyte (9,54)  bastion_revenant (5,55)
bastion_revenant (-5,68)  tidebound_acolyte (-1,70)
knight_commander_olen (-4,82)  bastion_revenant (1,83)
vael_the_mistcaller (0,98)  tidebound_acolyte (-4,96)  bastion_revenant (4,96)
```

---

# 3. Zone 3 spec — Thornpeak Heights (levels 13–20)

**Biome:** `peaks` (already in `BiomeId`). **z-band:** 540..900. Expanded world: x ∈ [-180,180], z ∈ [-180,900] (1080×360).

**ZoneDef:** `{ id: 'thornpeak_heights', name: 'Thornpeak Heights', zMin: 540, zMax: 900, levelRange: [13,20], biome: 'peaks', hub: { x: 0, z: 660, radius: 20, name: 'Highwatch' }, graveyard: { x: 15, z: 645 }, lakes: [{x:-70,z:760,radius:18}], welcome: 'Captain Thessaly holds the wall at Highwatch — barely.' }`

**POIs:** Highwatch (0,660); Stalker Ridge (-50,590); Deeprock Burrows (85,615); Ogre Foothills (-90,700); Drogmar's War-Camp (-130,740); Stormcrag (110,760); Wyrmcult Tents (55,820); Revenant Fields (-40,830); Sanctum Approach (0,860); Gravewyrm Sanctum (0,880).

**Roads:** Fenbridge→Highwatch: (0,320)→(10,450)→(0,540)→(0,660). Highwatch spokes: →(-60,700)→(-110,735) [ogres]; →(70,720)→(110,760) [crags]; →(0,780)→(0,860) [Sanctum Approach].

## Hub NPCs (Highwatch)

| id | name / title | pos | quests | vendor |
|---|---|---|---|---|
| captain_thessaly | Captain Thessaly, Highwatch Captain | (4,664) | q_highwatch_summons (turn-in), q_stalkers, q_ogre_bounty, q_crushers, q_drogmar, q_revenants, q_revenant_vanguard | — |
| brother_aldric_highwatch | Brother Aldric, Priest of the Vale | (-10,656) | q_zealots, q_cult_orders, q_necromancers, q_wyrm_sigils, q_breaking_the_seal, q_voice_below, q_sanctum_gate, q_velkhar, q_gravewyrm | — |
| scout_maren_highwatch | Scout Maren, Marshal's Scout | (7,670) | q_ogre_edges, q_ogre_totems, q_korgath | — |
| quartermaster_bree | Quartermaster Bree | (-5,668) | q_stalker_pelts, q_glowing_wax | trail_hardtack, meltwater_flask, roast_mountain_goat, glacier_melt, highwatch_breastplate, peakwool_robe, stalkerhide_jerkin, cragwalker_boots, windguard_leggings |
| armorer_hode | Armorer Hode | (-2,672) | — | highwatch_warblade, craghorn_staff, icevein_dirk |
| loremaster_caddis | Loremaster Caddis | (12,655) | q_kobold_tunnels, q_elementals, q_shard_cores, q_kazzix | — |

## Mobs table

| id | name | family | lvl | flags | hpBase/perLvl | dmgBase/perLvl | atkSpd | notes / loot highlights |
|---|---|---|---|---|---|---|---|---|
| ridge_stalker | Ridge Stalker | beast | 13–14 | — | 58/21 | 10/2.5 | 1.9 | copper 60; ridge_stalker_pelt 0.6 (q_stalker_pelts) |
| deeprock_kobold | Deeprock Tunneler | kobold | 14–15 | — | 60/22 | 10/2.5 | 2.1 | copper 65; glowing_wax 0.5 (q_glowing_wax); tallow_candle 0.4 |
| thornpeak_ogre | Thornpeak Ogre | **ogre** (new) | 15–16 | — | 66/23 | 11/2.6 | 2.6 | scale 1.3; copper 75; ogre_toe_ring 0.35 |
| ogre_crusher | Thornpeak Crusher | ogre | 16–17 | elite | 64/23 | 11/2.6 | 2.6 | copper 200; ogre_toe_ring 0.5 |
| warlord_drogmar | Warlord Drogmar | ogre | 17 | elite, boss | 200/30 | 12/2.7 | 2.6 | aoePulse {22,30,r10,every12,'Ground Slam'}; copper 2000 |
| stormcrag_elemental | Stormcrag Elemental | **elemental** (new) | 17–18 | — | 62/22 | 12/2.7 | 2.2 | copper 80; storm_core 0.55 (q_shard_cores); blessed_embers 0.55 (q_breaking_the_seal); inert_storm_shard 0.4 |
| shardlord_kazzix | Shardlord Kazzix | elemental | 18 | rare | 160/28 | 13/2.8 | 2.2 | kazzix_heartshard 1.0 (q_kazzix); copper 500 |
| wyrmcult_zealot | Wyrmcult Zealot | humanoid | 17–19 | — | 62/22 | 12/2.7 | 2.0 | copper 90; wyrmcult_orders 0.5 (q_cult_orders); frayed_prayer_beads 0.35 |
| wyrmcult_necromancer | Wyrmcult Necromancer | humanoid | 18–19 | — | 58/21 | 13/2.8 | 2.0 | copper 100; ritual_phylactery 0.55 (q_necromancers) |
| boneclad_revenant | Boneclad Revenant | undead | 18–19 | — | 66/23 | 12/2.7 | 2.3 | copper 100; bone_fragments 0.6 |
| sanctum_boneguard | Sanctum Boneguard | undead | 19 | elite | 64/23 | 12/2.7 | 2.3 | copper 300 |
| sanctum_drakonid | Sanctum Drakonid | **dragonkin** (new, reuses boss rig scaled 0.8) | 19–20 | elite | 68/24 | 13/2.8 | 2.2 | copper 350; cracked_wyrm_scale 0.5 |
| raised_bonewalker | Raised Bonewalker | undead | 18 | (summoned add) | 42/15 | 9/2.2 | 2.2 | no loot; Velkhar's summonAdds target |
| korgath_the_bound | Korgath the Bound | ogre | 20 | elite, miniboss | 260/36 | 14/2.9 | 2.8 | **enrage** {belowHpPct 0.30, dmgMult 1.5}; copper 5000; korgaths_chainwraps 0.5 |
| grand_necromancer_velkhar | Grand Necromancer Velkhar | humanoid | 20 | elite, miniboss | 230/33 | 13/2.8 | 2.0 | **summonAdds** {raised_bonewalker, 3, [0.66,0.33]}; copper 5000; boneguard_breastplate 0.33; shadowmeld_tunic 0.33; staff_of_velkhar 0.34 |
| korzul_the_gravewyrm | Korzul the Gravewyrm | dragonkin | 20 | elite, boss | 420/48 | 15/3.0 | 2.6 | aoePulse {30,42,r14,every8,'Necrotic Shockwave'} + **enrage** {0.30, 1.5}; copper 50000; wyrmfang_greatblade 0.34; staff_of_the_gravewyrm 0.33; fang_of_korzul 0.33 |

## Camps sketch

```
{ ridge_stalker, (-50,590), r22, c7 }    { ridge_stalker, (45,600), r20, c6 }
{ deeprock_kobold, (75,625), r18, c8 }   { deeprock_kobold, (105,600), r14, c6 }
{ thornpeak_ogre, (-90,700), r22, c7 }   { thornpeak_ogre, (-60,730), r18, c6 }
{ ogre_crusher, (-125,740), r18, c8 }    { warlord_drogmar, (-132,748), r2, c1 }
{ stormcrag_elemental, (110,760), r20, c8 } { stormcrag_elemental, (135,795), r16, c6 }
{ shardlord_kazzix, (145,815), r8, c1 }
{ wyrmcult_zealot, (55,820), r20, c8 }   { wyrmcult_zealot, (25,845), r16, c6 }
{ wyrmcult_necromancer, (40,855), r14, c5 }
{ boneclad_revenant, (-40,830), r20, c8 } { boneclad_revenant, (-15,860), r16, c6 }
```

Ground sparkles: highwatch_summons ×2 at (1,654),(-2,657); ogre_war_totem ×7 around the war-camp perimeter (~(-115,725)–(-140,755)); gravewyrm_sigil ×4 on the Sanctum Approach (~(-8,852)–(8,866)); sanctum_key_shard ×4 in the gate plaza (~(-6,872)–(6,878), patrolled by boneclad_revenant).

## Quests table

| id | name | giver | objectives | xp | copper | rewards | chain / gates |
|---|---|---|---|---|---|---|---|
| q_highwatch_summons | The Watch on the Peaks | brother_aldric_fen → captain_thessaly | collect 1 highwatch_summons (sparkle, Highwatch gate) | 500 | 500 | — | minLevel 12 (breadcrumb; NOT gated on the 5-man Bastion) |
| q_stalkers | Stalkers on the Ridge | captain_thessaly | kill 12 ridge_stalker | 2200 | 1000 | — | — |
| q_stalker_pelts | Winter Is Coming to Highwatch | quartermaster_bree | collect 8 ridge_stalker_pelt | 2300 | 1000 | ridgestalker_treads (all) | — |
| q_kobold_tunnels | Deeprock Trouble | loremaster_caddis | kill 12 deeprock_kobold | 2500 | 1200 | — | minLevel 14 |
| q_glowing_wax | Strange Wax | quartermaster_bree | collect 6 glowing_wax | 2500 | 1200 | — | requires q_kobold_tunnels |
| q_ogre_edges | Ogres at the Foothills | scout_maren_highwatch | kill 12 thornpeak_ogre | 2900 | 1400 | — | minLevel 15 |
| q_ogre_totems | Totems of War | scout_maren_highwatch | collect 6 ogre_war_totem (sparkles) | 2800 | 1400 | — | requires q_ogre_edges |
| q_ogre_bounty | The Captain's Bounty | captain_thessaly | kill 14 thornpeak_ogre | 3000 | 1500 | — | requires q_ogre_totems |
| q_crushers | Break the War-Camp | captain_thessaly | kill 10 ogre_crusher (elite) | 3600 | 2000 | — | minLevel 16, suggestedPlayers 3 |
| q_drogmar | Warlord Drogmar | captain_thessaly | kill 1 warlord_drogmar | 4000 | 2500 | drogmars_skullcleaver / ogre_bonecharm_staff / gutripper_shiv | requires q_crushers, suggestedPlayers 3 |
| q_elementals | The Mountain Wakes | loremaster_caddis | kill 12 stormcrag_elemental | 3600 | 1800 | — | minLevel 16 |
| q_shard_cores | Cores of the Storm | loremaster_caddis | collect 6 storm_core | 3700 | 1800 | — | requires q_elementals |
| q_kazzix | The Shardlord | loremaster_caddis | collect 1 kazzix_heartshard (rare spawn) | 3800 | 2000 | stormshard_leggings (all) | minLevel 17 |
| q_zealots | Chants on the Wind | brother_aldric_highwatch | kill 12 wyrmcult_zealot | 4000 | 2000 | — | minLevel 17 |
| q_cult_orders | Orders from Below | brother_aldric_highwatch | kill 8 wyrmcult_zealot; collect 4 wyrmcult_orders | 3800 | 1800 | — | requires q_zealots |
| q_necromancers | The Phylactery Ring | brother_aldric_highwatch | kill 8 wyrmcult_necromancer; collect 3 ritual_phylactery | 4200 | 2200 | — | requires q_cult_orders, minLevel 18 |
| q_revenants | The Revenant Fields | captain_thessaly | kill 12 boneclad_revenant | 4300 | 2200 | — | minLevel 18 |
| q_revenant_vanguard | Bones of the Vanguard | captain_thessaly | kill 14 boneclad_revenant | 4500 | 2400 | boneplate_vest / revenant_silk_robe / nightwalk_jerkin | requires q_revenants |
| q_wyrm_sigils | Sigils of the Wyrm | brother_aldric_highwatch | collect 3 gravewyrm_sigil (sparkles, Sanctum Approach) | 3600 | 2000 | — | requires q_necromancers, minLevel 18 |
| q_breaking_the_seal | Breaking the Seal | brother_aldric_highwatch | collect 5 blessed_embers | 4200 | 2200 | — | requires q_wyrm_sigils |
| q_voice_below | The Voice Below | brother_aldric_highwatch | kill 10 wyrmcult_zealot; kill 6 wyrmcult_necromancer | 4400 | 2400 | zealotsbane_blade / emberwood_staff / cultist_flayer | requires q_breaking_the_seal |
| q_sanctum_gate | The Sanctum Gate | brother_aldric_highwatch | collect 3 sanctum_key_shard (sparkles, gate plaza) | 4000 | 2000 | — | requires q_voice_below |
| q_korgath | The Bound Guardian | scout_maren_highwatch | kill 1 korgath_the_bound | 4200 | 2500 | korgaths_chainwraps (all) | requires q_sanctum_gate, minLevel 18, suggestedPlayers 5 |
| q_velkhar | The Grand Necromancer | brother_aldric_highwatch | kill 1 grand_necromancer_velkhar | 4500 | 3000 | boneguard_breastplate / staff_of_velkhar / shadowmeld_tunic | requires q_sanctum_gate, minLevel 18, suggestedPlayers 5 |
| q_gravewyrm | Korzul the Gravewyrm | brother_aldric_highwatch | kill 1 korzul_the_gravewyrm | 5300 | 25000 | gravewyrm_scale_hauberk / wyrmcult_grand_robe / wyrmscale_jerkin | requires q_sanctum_gate, minLevel 18, suggestedPlayers 5 |

Ceiling check: q_gravewyrm 5,300 at L19 = 24.9% of 21,300 (under ceiling). The 18→20 stretch (40,700 XP) is carried by the SOLO-able lead-up chain (q_wyrm_sigils + q_breaking_the_seal + q_voice_below + q_sanctum_gate = 16,200) plus revenant/necromancer arcs (13,000) plus dungeon quests (14,000) — per the corrected dungeon math, NOT by dungeon trash kills.

**QUEST_ORDER additions** (append in this order): zone-1 build-ups after q_whispers/q_rite/q_hollow slots; then q_fenbridge_muster … q_mistcaller; then q_highwatch_summons … q_gravewyrm.

---

# 4. Hollow Crypt enhancements + FINAL DUNGEON spec

## Hollow Crypt enhancements (no spawn-list changes — completed work stays)

1. **Four build-up/payoff quests** (§1 table): q_names_of_the_dead, q_silence_the_call (solo, outside), q_sexton (in-instance kill of the existing miniboss — raises a full crypt run's quest payout, since trash only nets ~650 XP/member), q_gravecallers_trail (post-Morthen story bridge, overworld sparkle).
2. **q_sexton rewards** (new blues, feet slot): marrowtread_boots / sextons_slippers / gravewalker_softboots — gives the crypt a second loot reason beyond Morthen.
3. **Narrative re-frame only:** Morthen's dialogue/flavor positions him as an acolyte of the Mistcaller. No mechanical changes to Morthen.

## FINAL DUNGEON — Gravewyrm Sanctum (5-player, level 20, index 2)

`DungeonDef`: `{ id: 'gravewyrm_sanctum', name: 'Gravewyrm Sanctum', index: 2, doorPos: {x:0, z:880}, entry: {x:0,z:0}, exitOffset: {x:0,z:-6}, interior: 'sanctum' (stretched 3-chamber variant of the crypt builder — see §7; fallback: 'crypt'), suggestedPlayers: 5, enterText: 'The air goes cold. Something vast breathes below...', leaveText: 'You stagger back into the mountain wind.' }`

Entry gating: q_korgath, q_velkhar, and q_gravewyrm all require q_sanctum_gate, minLevel 18, suggestedPlayers 5. They are available together once the Sanctum gate is opened, so one party run can clear all three boss quests.

**Layout (linear, 3 chambers, z 0→150):** Chamber 1 "The Boneworks" (z 10–60, boneguard/drakonid packs) → Korgath's Hall (z 60–75) → Chamber 2 "The Ritual Vault" (z 75–115, Velkhar) → Chamber 3 "The Wyrm's Hollow" (z 115–150, Korzul on a raised dais ringed by drakonid guards).

**Spawn list** (packs of 2 spaced beyond social-aggro; 18 trash + 2 minibosses + boss):

```
sanctum_boneguard (-3,16) (3,17)
sanctum_boneguard (-8,30)  sanctum_drakonid (-4,31)
sanctum_drakonid (7,44)    sanctum_boneguard (3,45)
sanctum_boneguard (-6,58)  sanctum_drakonid (-2,59)
korgath_the_bound (0,72)                                  [miniboss 1: enrage <30% hp, 1.5x dmg]
sanctum_drakonid (-7,86)   sanctum_boneguard (-3,87)
sanctum_boneguard (6,100)  sanctum_drakonid (2,101)
grand_necromancer_velkhar (0,114)  sanctum_boneguard (-4,112) (4,112)
                                   [miniboss 2: summons 3 raised_bonewalker at 66% and 33% hp]
sanctum_drakonid (-5,130) (-1,132)
korzul_the_gravewyrm (0,146)  sanctum_drakonid (-5,144) (5,144)
                                   [final boss: Necrotic Shockwave aoePulse 30-42 r14 every 8s,
                                    + enrage <30% hp 1.5x dmg — burn phase, healer cooldown check]
```

**Boss mechanics summary** (only 2 NEW sim mechanics across the whole expansion, both deterministic, both also used in the Bastion — see §7): summonAdds (Vael, Velkhar), enrage (Korgath, Korzul). aoePulse reused everywhere (Voss, Vael, Drogmar, Korzul). Frontal breath DEFERRED (facing-cone math not worth it).

**Loot:** Korgath → korgaths_chainwraps (50%) + 50s coin. Velkhar → one of three blues (boneguard_breastplate / staff_of_velkhar / shadowmeld_tunic) + 50s. Korzul → one of three EPIC weapons (wyrmfang_greatblade / staff_of_the_gravewyrm / fang_of_korzul, ~1/3 each) + 5g coin. Quest blues (q_gravewyrm chest pieces) guarantee every archetype a best-in-slot chest on completion. Trash: 3–3.5s coin/elite + junk.

**XP reality (corrected per judge verdict):** full clear = 18 trash × (140×2×1.43÷5 ≈ 80) + 3 bosses ≈ **1,700 XP/member**. A loot/story event — the level-20 push comes from the lead-up chain, by design.

---

# 5. XP budget tables per zone

Method: needed = Σ XP_TABLE; kill XP at-level = 45+5×mobLevel (mid of range); elites ×2; required kills include collect-objective expected kills (count ÷ drop rate); overshoot = required kills × 1.6 (travel/respawn/leftover-drop kills); dungeon/group XP per member uses GROUP_XP_BONUS÷party.

## Zone 1 carry-over (with crypt build-up additions)

| source | XP |
|---|---|
| Existing 13 quests (verified sum) | 7,810 |
| NEW build-up quests (600+750+1000+900) | 3,250 |
| Required kills ~102 × ~71 avg, ×1.6 | ~11,600 |
| **Total vs 1→7 need (11,200)** | **~22,700 → carries solidly to L7; crypt run (q_hollow 1,500 + q_sexton 1,000 + trail 900 + ~650 trash/member) bridges 8→9** |

## Zone 2 — Mirefen Marsh (need 6→13 = 46,500)

| source | detail | XP |
|---|---|---|
| Quest rewards (21 quests) | 300→2,800 rising by chain depth | **29,300** |
| Required kills (solo) | 25 prowler@83 + 36 murloc@87.5 + 19 widow@90 + broodmother + 26 drowned@95 + 25 troll@100 + grubjaw + 12 cultist@100 + 8 summoner@105 + voss ≈ 14,255 | 14,255 |
| × 1.6 overshoot | | **22,808** |
| **Core total** | | **52,108** |
| **Headroom vs 46,500** | | **+12.1%** |
| Extras (not counted in core) | Bastion clear ≈ 850/member; group-elite kills ≈ 300; grind | pushes ~+14–15% |

Solo-only check (excluding q_olen + q_mistcaller, 4,600 XP): 47,500 ≈ 1.02× — solo players reach 13 with light grind; the Bastion is the spike, not a gate (q_highwatch_summons gates on minLevel 12 only).

## Zone 3 — Thornpeak Heights (need 13→20 = 113,100)

| source | detail | XP |
|---|---|---|
| Quest rewards (25 quests) | 500→5,300 rising by chain depth | **88,400** |
| Required kills (solo) | 25 stalker@112 + 24 kobold@117 + 26 ogre@122 + 32 elemental@132 + kazzix + 30 zealot@135 + 14 necro@140 + 26 revenant@138 ≈ 22,747 | 22,747 |
| × 1.6 overshoot | | **36,395** |
| Group-elite kills/member | 10 crushers + Drogmar (3-player: ×1.3÷3) | ~1,226 |
| Sanctum clear/member | 18 trash + 3 bosses (×1.43÷5) | ~1,700 |
| **Total** | | **~127,700** |
| **Headroom vs 113,100** | | **+12.9%** |

19→20 (21,300) funding: lead-up chain 16,200 (solo, 17–25% of level each) + dungeon quests 14,000 + revenant arc spillover — comfortably covered without treating dungeon trash as a soak.

## Band coverage guardrail (every level has at-level mobs; gray cutoff zeroDiff 7 @ L10–15, 8 @ L16+)

| player level | at-level mobs |
|---|---|
| 6–8 | mire_prowler (7–8), deepfen_murloc (8–9) |
| 8–10 | mire_widow (8–10), drowned_dead (9–11) |
| 10–12 | fen_troll (10–12), gravecaller_cultist/summoner (10–12) |
| 12–13 | deacon_voss (12), Bastion elites (12–13), grubjaw (12) |
| 13–15 | ridge_stalker (13–14), deeprock_kobold (14–15) |
| 15–17 | thornpeak_ogre (15–16), ogre_crusher (16–17 elite) |
| 17–19 | stormcrag_elemental (17–18), wyrmcult_zealot (17–19), necromancer/revenant (18–19) |
| 19–20 | Sanctum elites (19–20), kazzix (18 rare) |

---

# 6. Item tables

All ids verified non-colliding with existing ITEMS. `requiredClass` shown where class-locked; archetype fallback (`REWARD_ARCHETYPE`) means 3 reward entries cover all 9 classes.

## Quest items (kind 'quest', sellValue 0, drop-gated by questId)

| id | name | source |
|---|---|---|
| fen_muster_order | Fenbridge Muster Order | sparkle (Fenbridge gate) |
| mire_prowler_pelt | Mire Prowler Pelt | mire_prowler 0.6 |
| lost_caravan_goods | Lost Caravan Goods | sparkles (causeway) |
| waterlogged_idol | Waterlogged Idol | deepfen_murloc 0.5 |
| widow_venom_sac | Widow Venom Sac | mire_widow 0.65 |
| rusted_censer | Rusted Censer | sparkles (Drowned Chapel) |
| troll_fetish | Mirefen Troll Fetish | fen_troll 0.6 |
| grubjaw_tusk | Grubjaw's Tusk | grubjaw 1.0 |
| cult_cipher | Gravecaller Cipher | gravecaller_summoner 0.6 |
| bastion_ward_stone | Bastion Ward Stone | sparkle (Bastion door) |
| weathered_ledger_page | Weathered Ledger Page | sparkles (chapel yard, zone 1) |
| morthen_grimoire | Morthen's Grimoire | sparkle (chapel vestry, zone 1) |
| highwatch_summons | Highwatch Summons | sparkle (Highwatch gate) |
| ridge_stalker_pelt | Ridge Stalker Pelt | ridge_stalker 0.6 |
| glowing_wax | Glowing Wax | deeprock_kobold 0.5 |
| ogre_war_totem | Ogre War Totem | sparkles (war-camp) |
| storm_core | Storm Core | stormcrag_elemental 0.55 |
| kazzix_heartshard | Kazzix's Heartshard | shardlord_kazzix 1.0 |
| wyrmcult_orders | Wyrmcult Orders | wyrmcult_zealot 0.5 |
| ritual_phylactery | Ritual Phylactery | wyrmcult_necromancer 0.55 |
| gravewyrm_sigil | Gravewyrm Sigil | sparkles (Sanctum Approach) |
| blessed_embers | Blessed Embers | stormcrag_elemental 0.55 |
| sanctum_key_shard | Sanctum Key Shard | sparkles (gate plaza) |

## Zone 2 gear — quest greens (uncommon) and blues (rare)

| id | name | kind/slot | quality | stats / weapon | sell | class |
|---|---|---|---|---|---|---|
| deacons_cleaver | Deacon's Cleaver | weapon/mainhand | uncommon | 11–18 spd 2.4, str 4 | 300 | warrior |
| staff_of_drowned_prayers | Staff of Drowned Prayers | weapon/mainhand | uncommon | 12–20 spd 3.0, int 5 spi 2 | 300 | mage |
| mistbinder_kris | Mistbinder Kris | weapon/mainhand | uncommon | 7–12 spd 1.7 dagger, agi 4 | 300 | rogue |
| drownedguard_breastplate | Drownedguard Breastplate | armor/chest | uncommon | armor 130, sta 4 | 350 | warrior |
| fenmist_robe | Fenmist Robe | armor/chest | uncommon | armor 45, int 5 spi 3 | 350 | mage |
| eelskin_tunic | Eelskin Tunic | armor/chest | uncommon | armor 80, agi 5 | 350 | rogue |
| trollhide_leggings | Trollhide Leggings | armor/legs | uncommon | armor 55, sta 3 str 2 | 280 | (all) |
| marshstrider_boots | Marshstrider Boots | armor/feet | uncommon | armor 40, agi 2 sta 2 | 250 | (all) |
| mistcallers_edge | Mistcaller's Edge | weapon/mainhand | rare | 14–23 spd 2.3, str 4 sta 3 | 1200 | warrior |
| vaels_mist_staff | Vael's Mist-Staff | weapon/mainhand | rare | 15–26 spd 3.0, int 6 spi 3 | 1200 | mage |
| riptide_dirk | Riptide Dirk | weapon/mainhand | rare | 9–15 spd 1.7 dagger, agi 5 sta 2 | 1200 | rogue |
| knight_commanders_greaves | Knight-Commander's Greaves | armor/legs | rare | armor 95, sta 4 | 1000 | (all) |
| tidescale_vest | Tidescale Vest | armor/chest | rare | armor 90, sta 3 agi 2 | 1100 | (all, Vael drop) |

## Hollow Crypt addition (q_sexton rewards, rare, feet)

| id | name | stats | sell | class |
|---|---|---|---|---|
| marrowtread_boots | Marrowtread Boots | armor 45, sta 2 str 1 | 500 | warrior |
| sextons_slippers | Sexton's Slippers | armor 20, int 2 spi 2 | 500 | mage |
| gravewalker_softboots | Gravewalker Softboots | armor 32, agi 3 | 500 | rogue |

## Zone 3 gear — greens, blues, epics

| id | name | kind/slot | quality | stats / weapon | sell | class |
|---|---|---|---|---|---|---|
| ridgestalker_treads | Ridgestalker Treads | armor/feet | uncommon | armor 50, agi 3 sta 2 | 600 | (all) |
| boneplate_vest | Boneplate Vest | armor/chest | uncommon | armor 170, sta 6 str 3 | 800 | warrior |
| revenant_silk_robe | Revenant Silk Robe | armor/chest | uncommon | armor 60, int 7 spi 4 | 800 | mage |
| nightwalk_jerkin | Nightwalk Jerkin | armor/chest | uncommon | armor 105, agi 7 sta 2 | 800 | rogue |
| zealotsbane_blade | Zealotsbane Blade | weapon/mainhand | uncommon | 18–29 spd 2.3, str 6 sta 2 | 900 | warrior |
| emberwood_staff | Emberwood Staff | weapon/mainhand | uncommon | 20–33 spd 3.0, int 8 spi 3 | 900 | mage |
| cultist_flayer | Cultist Flayer | weapon/mainhand | uncommon | 12–19 spd 1.7 dagger, agi 7 | 900 | rogue |
| drogmars_skullcleaver | Drogmar's Skullcleaver | weapon/mainhand | rare | 22–35 spd 2.6, str 7 sta 4 | 2000 | warrior |
| ogre_bonecharm_staff | Ogre Bonecharm Staff | weapon/mainhand | rare | 24–38 spd 3.0, int 9 spi 4 | 2000 | mage |
| gutripper_shiv | Gutripper Shiv | weapon/mainhand | rare | 14–22 spd 1.7 dagger, agi 8 sta 3 | 2000 | rogue |
| stormshard_leggings | Stormshard Leggings | armor/legs | rare | armor 110, sta 5 | 1800 | (all) |
| korgaths_chainwraps | Korgath's Chainwraps | armor/legs | rare | armor 125, sta 6 | 2200 | (all) |
| boneguard_breastplate | Boneguard Breastplate | armor/chest | rare | armor 210, sta 7 str 4 | 2500 | warrior |
| staff_of_velkhar | Staff of Velkhar | weapon/mainhand | rare | 27–43 spd 3.0, int 10 spi 5 | 2500 | mage |
| shadowmeld_tunic | Shadowmeld Tunic | armor/chest | rare | armor 130, agi 9 sta 4 | 2500 | rogue |
| gravewyrm_scale_hauberk | Gravewyrm Scale Hauberk | armor/chest | rare | armor 230, sta 8 str 5 | 3000 | warrior |
| wyrmcult_grand_robe | Wyrmcult Grand Robe | armor/chest | rare | armor 75, int 11 spi 5 | 3000 | mage |
| wyrmscale_jerkin | Wyrmscale Jerkin | armor/chest | rare | armor 145, agi 10 sta 5 | 3000 | rogue |
| wyrmfang_greatblade | Wyrmfang Greatblade | weapon/mainhand | **epic** | 30–48 spd 2.6, str 10 sta 6 | 8000 | warrior |
| staff_of_the_gravewyrm | Staff of the Gravewyrm | weapon/mainhand | **epic** | 32–52 spd 3.0, int 12 spi 6 | 8000 | mage |
| fang_of_korzul | Fang of Korzul | weapon/mainhand | **epic** | 19–30 spd 1.7 dagger, agi 11 sta 5 | 8000 | rogue |

## Vendor whites + food/drink tiers

Economy continuity: zone-2 quests pay 2–25s (total ≈ 1g31s + ~1g+ mob copper); zone-3 quests pay 5s–2g50s (total ≈ 6g91s + mob copper). Vendor sets priced at roughly the band's quest income. Consume window fixed at 18s; tiers sized to pools at L13 (~550 hp / ~1,000 mana) and L20 (~810 hp / ~1,490 mana).

**Zone 2 — provisioner_hale (Fenbridge):**

| id | name | kind | effect / stats | buy | sell |
|---|---|---|---|---|---|
| fenbridge_rye | Fenbridge Rye Loaf | food | foodHp 243 | 400 | 25 |
| marsh_mint_tea | Marsh Mint Tea | drink | drinkMana 288 | 400 | 25 |
| smoked_eel | Smoked Mirefen Eel | food | foodHp 432 | 1000 | 60 |
| silvermist_cordial | Silvermist Cordial | drink | drinkMana 436 | 1000 | 60 |
| bogiron_mace | Bogiron Mace | weapon (8–14 spd 2.6) | common | 2500 | 250 |
| fenreed_staff | Fenreed Staff | weapon (9–16 spd 3.0, int 1) | common | 2500 | 250 |
| mirefen_skinner | Mirefen Skinner | weapon (6–10 spd 1.8, dagger) | common | 2500 | 250 |
| bogiron_hauberk | Bogiron Hauberk | armor/chest, armor 100 | common | 3000 | 300 |
| marshcloth_robe | Marshcloth Robe | armor/chest, armor 32 | common | 2000 | 200 |
| reedwoven_jerkin | Reedwoven Jerkin | armor/chest, armor 62 | common | 2500 | 250 |
| fenwalker_boots | Fenwalker Boots | armor/feet, armor 30 | common | 1500 | 150 |
| reedwoven_trousers | Reedwoven Trousers | armor/legs, armor 40 | common | 1800 | 180 |

**Zone 3 — quartermaster_bree + armorer_hode (Highwatch):**

| id | name | kind | effect / stats | buy | sell |
|---|---|---|---|---|---|
| trail_hardtack | Highwatch Trail Hardtack | food | foodHp 552 | 1200 | 75 |
| meltwater_flask | Meltwater Flask | drink | drinkMana 672 | 1200 | 75 |
| roast_mountain_goat | Roast Mountain Goat | food | foodHp 874 | 2500 | 150 |
| glacier_melt | Glacier Melt | drink | drinkMana 900 | 2500 | 150 |
| highwatch_warblade | Highwatch Warblade | weapon (15–24 spd 2.3) | common | 6000 | 600 |
| craghorn_staff | Craghorn Staff | weapon (16–27 spd 3.0, int 2) | common | 6000 | 600 |
| icevein_dirk | Icevein Dirk | weapon (10–16 spd 1.8, dagger) | common | 6000 | 600 |
| highwatch_breastplate | Highwatch Breastplate | armor/chest, armor 160 | common | 7000 | 700 |
| peakwool_robe | Peakwool Robe | armor/chest, armor 50 | common | 5000 | 500 |
| stalkerhide_jerkin | Stalkerhide Jerkin | armor/chest, armor 95 | common | 6000 | 600 |
| cragwalker_boots | Cragwalker Boots | armor/feet, armor 55 | common | 4000 | 400 |
| windguard_leggings | Windguard Leggings | armor/legs, armor 70 | common | 4500 | 450 |

**Junk (kind 'junk', quality 'poor'):** bogiron_nugget (12), soggy_moccasin (9), cracked_fetish (14), chipped_tusk (15), ogre_toe_ring (25), inert_storm_shard (28), frayed_prayer_beads (30), cracked_wyrm_scale (35), deepfen_pearl (600, Vael trophy).

Mage conjured-water upgrades: covered by the existing **ability-ranks companion spec** (two new conjure_water ranks) — do not duplicate here.

---

# 7. New mob families + boss mechanics needed from the engine (minimal list)

**Type/sim changes (each item is the complete list — nothing else is needed):**

1. **MobFamily union** (`src/sim/types.ts:99`): add `'troll' | 'ogre' | 'elemental' | 'dragonkin'`. Renderer rigs, all primitive-buildable: troll = hunched humanoid variant (long arms, stooped spine); ogre = scaled-up humanoid (bulk + head-scale tweak); elemental = 3–5 floating rock chunks around a core, no limbs (cheapest rig). dragonkin = one boss model (Korzul); sanctum_drakonid reuses it at scale 0.8. Net: 3 new rigs + 1 boss model.
2. **Boss mechanics — exactly 2 new, both deterministic pulse/threshold checks in sim.ts** (flagged sim work): 
   - `summonAdds?: { mobId: string; count: number; atHpPct: number[] }` — spawns adds at hp thresholds, one spawn call each. Used by vael_the_mistcaller, grand_necromancer_velkhar.
   - `enrage?: { belowHpPct: number; dmgMult: number }` — two-field multiplier check. Used by korgath_the_bound, korzul_the_gravewyrm.
   - `aoePulse` reused (Voss, Vael, Drogmar, Korzul). **Frontal breath deferred** (facing-cone math, not worth it this pass).
3. **DungeonDef.interior** (`src/sim/data.ts:1316`): widen literal `'crypt'` to `'crypt' | 'sanctum'`. Sunken Bastion ships on `'crypt'` (zero renderer work, optional marsh tint). `'sanctum'` = stretched 3-chamber crypt variant (z to ~155); if renderer budget is tight, the Sanctum also ships on `'crypt'` with the spawn list compressed to z≤98.
4. **Dungeons** take `index: 1` (sunken_bastion) and `index: 2` (gravewyrm_sanctum) — `instanceOrigin` x-bands already generalize; no formula changes.
5. **ZONES array**: append the two ZoneDef bands from §2/§3. `zoneAt`/`WORLD_MIN_Z`/`WORLD_MAX_Z` derive automatically; zone 1 geography untouched. Renderer needs `marsh` and `peaks` biome palettes (BiomeId already typed) — covered by the existing **graphics companion spec**.
6. **XP/levels**: NO table work — `XP_TABLE` already holds vanilla values through 20 and `MAX_LEVEL = 20`. Only audit for stray hardcoded level-10 caps in level-up/ability-learn plumbing.
7. **NPC recurrence**: new NpcDef entries `brother_aldric_fen`, `brother_aldric_highwatch`, `scout_maren_highwatch` share display names with their originals (engine treats them as distinct static NPCs; no engine change).
8. **No new quest objective types** — every quest above is kill/collect with requiresQuest/minLevel/suggestedPlayers, collect via questId-gated loot entries or GROUND_OBJECTS sparkles (breadcrumbs implemented as a destination-gate sparkle). Rare spawns (grubjaw, shardlord_kazzix) reuse the old_greyjaw timer pattern.
9. **Companion specs incorporated by reference** (already complete in `wf_0c329a02-def/journal.jsonl` — do not regenerate): ability ranks 1–20 for all nine classes (incl. the single new `finisherStun` AbilityEffect and mob-hp tuning anchor hp≈40+18L this spec's templates follow), the iconId-recipe icon system, and the tiered graphics plan.
