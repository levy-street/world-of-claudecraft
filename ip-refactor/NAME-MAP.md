# NAME-MAP - the locked rename contract

> STATUS: **LOCKED** (operator sign-off 2026-07-02). Append-only from here: a slice needing a
> string not on this map STOPS and appends a request row to 02-WORKING-MEMORY.md - never invents.
>
> Operator decisions folded in at lock: every former `generic-keep?` ability/item row was
> DECIDED (renamed except the five keeps: Sap, Smite, Claw, Dash, Rip - plus Wolf Form and
> Blessed Tallow which keep their current text); Mogger cluster KEPT as deliberate parody
> (rows flipped to generic-keep?; 'Mogger' removed from the scanner hardcoded list under the
> operator-authorized exception); tier sets renamed (7 rows); realm word = "World" (T1 uses it);
> ~35 names adopted from the SEO name-mining pass (Semrush-checked + adversarially screened,
> notable: Dirt Nap, Silent Treatment, Grave Mistake, Pound of Flesh, Gravelight, Direhowl,
> Cinderfall, Winterbite, Gallowglass Maul, Emberkin, Gloomshade, Duskborn, Wraithborn).
>
> POST-LOCK OPERATOR AMENDMENT (2026-07-02, from the operator's margin-note review of the
> locked workbook; screened before applying): Quaking Slam, Bewitch, Icebind, Dirt Toss,
> Holy Ground, Rattling Shot, Harrier's/Marten's/Courser's Guise (unified aspects), Long Draw
> (+ Steady Draw), Litany of Resolve, Dirge of Decay, Mending Waters (operator caught the WoW
> Healing-Tide adjacency), Thunder Ward, Blackrot, Consume, Wildbolt, Lunar Tempest, Menace
> (operator caught the WoW 'Snarl' shield), Stalk, and specs Fieldcraft / Thundercall /
> Warspirit. Operator counter-proposals declined for IP reasons: Guardian (WoW druid spec),
> Ironeye (Elden Ring Nightreign), Thunderlord (WoW clan). All pairing rows cascaded.
>
> POST-LOCK AMENDMENT #2 (2026-07-02, operator-approved during Phase 4): four new names
> collided with armed scanner words and were fixed (Quaking Slam -> Quaking Blow, Armor Rend
> -> Armor Shear, Oath of Vigor -> Oath of Iron, Seething Wrath -> Seething Fury, pairings
> cascaded) and the polymorph critter word row was added (sheep -> toad). SAME DATE, OPERATOR
> RULING ON PARITY GOLDENS: the goldens' event digests fold event TEXT, which embeds display
> names, so display renames legitimately shift `events` digest fields. The C1/C2 golden
> exception is EXTENDED to every rename slice under a mandatory verification: after
> UPDATE_PARITY=1 re-mint, `node ip-refactor/golden_token_inspector.mjs <worktree>` must pass
> (only events-digests + exact locked token swaps changed; all state hashes / RNG fingerprints
> / counts byte-identical), and the hardcoded old names in tests/parity/coverage.test.ts are
> updated to the new names as an operator-authorized gate-text edit. The integrator re-mints
> once more on the merged tree at Phase 5; Z1 runs the inspector across the whole map.
>
> POST-LOCK AMENDMENT #3 (2026-07-02): scanner self-collision #5 found by C1 - 'Gallowglass
> Maul' contains the armed word 'Maul'; fixed to 'Gallowglass Hammer' (same defect class and
> treatment as amendment #2; 'Warhammer' rejected - Games Workshop).
>
> POST-LOCK AMENDMENT #4 (2026-07-02, operator-approved from the quest/text/dialogue IP audit -
> categories the G0 scanner was blind to: POI/map labels, boss & delve dialogue, ground-pickup
> flavor, ability/talent tooltip descriptions, plus every quest name/text/objective). Four
> clusters (rows in the "## Amendment #4" section below): (A) Webwood -> Sableweb - the item
> `webwood_silk` was already mapped to "Sableweb Silk Gland", but the co-named POI label, mob
> "Webwood Lurker", and quest "Webwood Menace" kept the WoW token; aligned to Sableweb (render
> code already reads "Sableweb Matriarch"). (B) Mistcaller -> Fogbinder - verbatim WoW (Mists of
> Tirna Scithe boss + Kvaldir family), an epithet across the Vael boss name, the quest, the item
> "Mistcaller's Edge", and 4 quest-text lines; operator picked "Fogbinder". (C) Scourge - operator
> KEPT ("Nythraxis, Scourge of Thornpeak" / "Scourge's End"): "Scourge of <place>" is the common-
> noun (affliction) usage, not WoW's standalone proper-noun faction; considered and declined, like
> Mogger/Riptide. (D) Shadow Flame -> searing shadow - Blizzard-coined effect left in the
> `shadowburn` tooltip description (the ability name already renamed to Duskfire). The G0 scanner
> is EXTENDED in the same change to walk POI labels + encounter/delve dialogue + tooltip
> descriptions, so these categories are enforced from now on. Two findings were verified
> already-fixed on their branches and dropped (War Stomp -> W2 "Shuddering Stomp"; Ghost Wolf ->
> V1 "Shadewolf"). Applied + re-verified at Phase 5 integration; scanner RED until then.

This file is the single source of truth for every old -> new string, the analog of the
world-api `CommandName` table. Every rename slice applies it VERBATIM and never invents a name.
The `tests/ip_scrub.test.ts` scanner (G0) is keyed to the `old` column: a slice is done when its
`old` names no longer appear in any player-visible field.

Scanner-parse discipline (do not break): the flag cell of every table row is EXACTLY one of
`rename` / `generic-keep?` / `coined-id` / `pairing` / `rename?` with no annotations; the `old`
cell is the exact live display string and nothing else (backticked cells are code ids the
scanner deliberately does not arm). Notes live in the bullet lists outside the tables.

## House style (what a good new name looks like)
Anchor to the game's OWN established original vocabulary, which is grim, grounded dark-fantasy:
- Zones: Eastbrook Vale, Mirefen Marsh, Thornpeak Heights. Factions: Gravecallers, Wyrmcult,
  Pale Choir, Drowned Moon. Bosses: Korzul the Gravewyrm, Voskar the Emberwing.
- Talents already de-WoW'd in `talents_warrior.ts`: Savagery, Weapon Mastery, Blademaster,
  Bulwark, Sharpened Blades, Kindred Spirits, Stormcaller.

Rules for a new name:
1. **Original + evocative + functional.** It should read as a real ability and hint at what it
   does. Keep the mechanic legible (a fire nuke still sounds like fire; a taunt still reads as a
   taunt).
2. **Concise.** 1-3 words, fits an action-bar tooltip (aim <= 22 chars; hard cap the longest
   existing UI budget). Sanctioned exception: `Improved <ability new name>` pairing rows may
   exceed 22 chars because the pairing construction wins over the cap.
3. **Preserve the mechanic-word where it is pure-generic AND safe.** Truly generic combat verbs
   are FLAGGED `generic-keep?` in the map so the operator decides per-row whether to keep or
   rename; every such row still carries a proposed candidate so the call is one glance.
   Distinctive WoW names are ALWAYS renamed.
4. **Talent-ability pairing.** A talent that improves/grants an ability must use that ability's
   NEW name (e.g. "Improved Cinderbolt"); a grant-node whose display IS the granted ability uses
   the ability's new name exactly (that identity is how talent_i18n resolves it). Both are
   flagged `pairing`.

## Hard IP constraints (G1 adversarially verified every proposed name)
- **Not verbatim from WoW** (the whole point).
- **Not verbatim from ANY other known franchise** - screened against RuneScape, Final Fantasy,
  Guild Wars, Diablo, League of Legends, Dota, EverQuest, ESO. Prefer common-language fantasy
  compounds with no single-franchise ownership.
- **No collision with the game's EXISTING original names** and **no internal duplicates**
  (mirror rows that share one OLD string across nodes intentionally share one new name; that is
  the source design, not a duplicate).
- **Not a Blizzard-coined creature/proper-noun** (Murloc, Voidwalker, Felguard, Drakonid,
  Bristleback, Quilboar, Naga, Furbolg, ...).

## Format
One table per domain. Columns: `id` (frozen - never changes) | `old` (current display, the
scanner key) | `new` (PROPOSED) | `kind` | `flag`. `flag` in {`rename`, `generic-keep?`,
`coined-id` (C1/C2 also rename the id), `pairing`, `rename?` (operator call pending)}.

**Realm word (T1, operator): "World"** replaces player-visible "realm" copy; `RealmType` id frozen.

**v0.19.0 additions: NONE.** The v0.18.0..v0.19.0 content diff is empty (CI tooling only);
zero extra rows were needed (verified by G0, recorded in 02-WORKING-MEMORY.md).

---

## Abilities (V1) - `content/classes.ts` + `i18n.catalog/abilities.ts`

### Warrior
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `heroic_strike` | Heroic Strike | Reaver Strike | ability | rename |
| `battle_shout` | Battle Shout | Iron Bellow | ability | rename |
| `commanding_shout` | Commanding Shout | Bolstering Cry | ability | rename |
| `demoralizing_shout` | Demoralizing Shout | Direhowl | ability | rename |
| `charge` | Charge | Onrush | ability | rename |
| `rend` | Rend | Deep Gash | ability | rename |
| `thunder_clap` | Thunder Clap | Quaking Blow | ability | rename |
| `hamstring` | Hamstring | Hobbling Cut | ability | rename |
| `bloodrage` | Bloodrage | Blood Toll | ability | rename |
| `overpower` | Overpower | Redhand | ability | rename |
| `execute` | Execute | Early Grave | ability | rename |
| `slam` | Slam | Brute Swing | ability | rename |
| `cleave` | Cleave | Reaping Arc | ability | rename |
| `defensive_stance` | Defensive Stance | Guarded Stance | ability | rename |
| `sunder_armor` | Sunder Armor | Armor Shear | ability | rename |
| `taunt` | Taunt | Goad | ability | rename |
| `mortal_strike` | Mortal Strike | Maiming Strike | ability | rename |
| `bloodthirst` | Bloodthirst | Bloodletting | ability | rename |
| `shield_slam` | Shield Slam | Shieldcrack | ability | rename |
| `whirlwind` | Whirlwind | Bladed Gyre | ability | rename |
| `berserker_rage` | Berserker Rage | Seething Fury | ability | rename |

### Mage
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `fireball` | Fireball | Cinderbolt | ability | rename |
| `frost_armor` | Frost Armor | Hoarfrost Mantle | ability | rename |
| `arcane_intellect` | Arcane Intellect | Aether Insight | ability | rename |
| `frostbolt` | Frostbolt | Rimelance | ability | rename |
| `conjure_water` | Conjure Water | Waterbind | ability | rename |
| `conjure_food` | Conjure Food | Breadbind | ability | rename |
| `fire_blast` | Fire Blast | Cinderfall | ability | rename |
| `arcane_missiles` | Arcane Missiles | Aether Darts | ability | rename |
| `polymorph` | Polymorph | Bewitch | ability | rename |
| polymorph critter word (description prose) | sheep | toad | prose | rename |
| `frost_nova` | Frost Nova | Icebind | ability | rename |
| `arcane_explosion` | Arcane Explosion | Aetherburst | ability | rename |
| `scorch` | Scorch | Scald | ability | rename |
| `pyroblast` | Pyroblast | Pyrelance | ability | rename |
| `ice_barrier` | Ice Barrier | Frostveil | ability | rename |

### Rogue
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `sinister_strike` | Sinister Strike | Wicked Slash | ability | rename |
| `eviscerate` | Eviscerate | Dirt Nap | ability | rename |
| `backstab` | Backstab | Craven Thrust | ability | rename |
| `gouge` | Gouge | Eye Jab | ability | rename |
| `evasion` | Evasion | Ghostfoot | ability | rename |
| `slice_and_dice` | Slice and Dice | Cutthroat Tempo | ability | rename |
| `sprint` | Sprint | Swift Heels | ability | rename |
| `kidney_shot` | Kidney Shot | Low Blow | ability | rename |
| `ambush` | Ambush | Lurker's Strike | ability | rename |
| `stealth` | Stealth | Duskveil | ability | rename |
| `adrenaline_rush` | Adrenaline Rush | Quickened Blood | ability | rename |
| `garrote` | Garrote | Throat Wire | ability | rename |
| `cheap_shot` | Cheap Shot | Gut Punch | ability | rename |
| `sap` | Sap | Cosh | ability | generic-keep? |
| `crippling_poison` | Crippling Poison | Leaden Venom | ability | rename |
| `expose_armor` | Expose Armor | Armor Breach | ability | rename |
| `rupture` | Rupture | Bleed Out | ability | rename |
| `vanish` | Vanish | Smokestep | ability | rename |
| `instant_poison` | Instant Poison | Adder's Bite | ability | rename |
| `deadly_poison` | Deadly Poison | Festering Venom | ability | rename |
| `blind` | Blind | Dirt Toss | ability | rename |

### Paladin
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `seal_of_righteousness` | Seal of Righteousness | Oathbrand | ability | rename |
| `holy_light` | Holy Light | Mending Light | ability | rename |
| `devotion_aura` | Devotion Aura | Steadfast Aura | ability | rename |
| `judgement` | Judgement | Verdict | ability | rename |
| `blessing_of_might` | Blessing of Might | Oath of Iron | ability | rename |
| `divine_protection` | Divine Protection | Ward of Faith | ability | rename |
| `hammer_of_justice` | Hammer of Justice | Sundering Gavel | ability | rename |
| `lay_on_hands` | Lay on Hands | Last Rite | ability | rename |
| `flash_of_light` | Flash of Light | Lightmend | ability | rename |
| `exorcism` | Exorcism | Rite of Expulsion | ability | rename |
| `consecration` | Consecration | Holy Ground | ability | rename |
| `righteous_fury` | Righteous Fury | Burning Oath | ability | rename |
| `retribution_aura` | Retribution Aura | Requital Aura | ability | rename |

### Hunter
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `tame_beast` | Tame Beast | Wildbond | ability | rename |
| `dismiss_pet` | Dismiss Pet | Release Companion | ability | rename |
| `revive_pet` | Revive Pet | Revive Pet (operator KEEP 2026-07-02: generic verb+noun, cf. Static Charge/Blood Frenzy) | ability | generic-keep? |
| `raptor_strike` | Raptor Strike | Gutting Strike | ability | rename |
| `aspect_of_the_hawk` | Aspect of the Hawk | Harrier's Guise | ability | rename |
| `serpent_sting` | Serpent Sting | Venom Barb | ability | rename |
| `arcane_shot` | Arcane Shot | Fell Shot | ability | rename |
| `concussive_shot` | Concussive Shot | Rattling Shot | ability | rename |
| `mongoose_bite` | Mongoose Bite | Counterfang | ability | rename |
| `wing_clip` | Wing Clip | Fettering Slash | ability | rename |
| `aspect_of_the_monkey` | Aspect of the Monkey | Marten's Guise | ability | rename |
| `aspect_of_the_cheetah` | Aspect of the Cheetah | Courser's Guise | ability | rename |
| `aimed_shot` | Aimed Shot | Long Draw | ability | rename |
| `rapid_fire` | Rapid Fire | Fevered Draw | ability | rename |

### Priest
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `smite` | Smite | Chasten | ability | generic-keep? |
| `lesser_heal` | Lesser Heal | Whispered Prayer | ability | rename |
| `power_word_fortitude` | Power Word: Fortitude | Litany of Resolve | ability | rename |
| `shadow_word_pain` | Shadow Word: Pain | Dirge of Decay | ability | rename |
| `power_word_shield` | Power Word: Shield | Psalm of Warding | ability | rename |
| `renew` | Renew | Lingering Grace | ability | rename |
| `mind_blast` | Mind Blast | Mindfracture | ability | rename |
| `heal` | Heal | Solemn Prayer | ability | rename |
| `mind_flay` | Mind Flay | Litany of Woe | ability | rename |
| `flash_heal` | Flash Heal | Urgent Prayer | ability | rename |

### Shaman
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `lightning_bolt` | Lightning Bolt | Arc Bolt | ability | rename |
| `rockbiter_weapon` | Rockbiter Weapon | Stonebound Weapon | ability | rename |
| `healing_wave` | Healing Wave | Mending Waters | ability | rename |
| `earth_shock` | Earth Shock | Earthen Jolt | ability | rename |
| `lightning_shield` | Lightning Shield | Thunder Ward | ability | rename |
| `flame_shock` | Flame Shock | Cinder Jolt | ability | rename |
| `flametongue_weapon` | Flametongue Weapon | Pyrebrand Weapon | ability | rename |
| `frost_shock` | Frost Shock | Rime Jolt | ability | rename |
| `frostbrand_weapon` | Frostbrand Weapon | Rimebound Weapon | ability | rename |
| `ghost_wolf` | Ghost Wolf | Shadewolf | ability | rename |
| `stormstrike` | Stormstrike | Ancestral Strike | ability | rename |

### Warlock
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `shadow_bolt` | Shadow Bolt | Gloom Bolt | ability | rename |
| `demon_skin` | Demon Skin | Fiendhide | ability | rename |
| `immolate` | Immolate | Burning Pact | ability | rename |
| `corruption` | Corruption | Blackrot | ability | rename |
| `life_tap` | Life Tap | Hard Bargain | ability | rename |
| `curse_of_agony` | Curse of Agony | Hex of Anguish | ability | rename |
| `drain_life` | Drain Life | Consume | ability | rename |
| `fear` | Fear | Harrow | ability | rename |
| `searing_pain` | Searing Pain | Sear | ability | rename |
| `shadowburn` | Shadowburn | Duskfire | ability | rename |
| `summon_imp` | Summon Imp | Summon Emberkin | ability | rename |
| `summon_voidwalker` | Summon Voidwalker | Summon Gloomshade | ability | rename |
| `summon_succubus` | Summon Succubus | Summon Duskborn | ability | rename |
| `summon_felhunter` | Summon Felhunter | Summon Spellhound | ability | rename |
| `summon_felguard` | Summon Felguard | Summon Warfiend | ability | rename |
| `summon_infernal` | Summon Infernal | Summon Pyre Colossus | ability | rename |
| `summon_doomguard` | Summon Doomguard | Summon Wraithborn | ability | rename |

- Summon descriptions in `classes.ts` (duplicated byte-identical in the catalog) name each demon
  and two pet-spell words; C2 owns the demon nouns, V1 applies these two tokens with the summons:
  the imp description word "Firebolts" -> "Ashbolts" and the felhunter description "Shadow Bite"
  -> "Gloombite" (see C2 section for the matching NPC petSpell row).

### Druid
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `wrath` | Wrath | Wildbolt | ability | rename |
| `healing_touch` | Healing Touch | Wildmend | ability | rename |
| `mark_of_the_wild` | Mark of the Wild | Wildward | ability | rename |
| `moonfire` | Moonfire | Lunar Tempest | ability | rename |
| `rejuvenation` | Rejuvenation | Wildbloom | ability | rename |
| `thorns` | Thorns | Briarguard | ability | rename |
| `entangling_roots` | Entangling Roots | Gripping Roots | ability | rename |
| `bear_form` | Bear Form | Bruin Form | ability | rename |
| `bear_charge` | Bear Charge | Bruin Rush | ability | rename |
| `maul` | Maul | Bonecrush | ability | rename |
| `growl` | Growl | Menace | ability | rename |
| `demoralizing_roar` | Demoralizing Roar | Craven Roar | ability | rename |
| `cat_form` | Wolf Form | Wolf Form | ability | generic-keep? |
| `prowl` | Prowl | Stalk | ability | rename |
| `rake` | Rake | Flense | ability | rename |
| `claw` | Claw | Rive | ability | generic-keep? |
| `ferocious_bite` | Ferocious Bite | Gorebite | ability | rename |
| `swipe` | Swipe | Sweeping Claws | ability | rename |
| `regrowth` | Regrowth | Second Bloom | ability | rename |
| `barkskin` | Barkskin | Oakhide | ability | rename |
| `starfire` | Starfire | Skyfall | ability | rename |
| `travel_form` | Travel Form | Fleet Form | ability | rename |
| `enrage` | Enrage | Stoke | ability | rename |
| `bash` | Bash | Concuss | ability | rename |
| `faerie_fire` | Faerie Fire | Witchlight | ability | rename |
| `hibernate` | Hibernate | Slumber | ability | rename |
| `dash` | Dash | Lope | ability | generic-keep? |
| `pounce` | Pounce | Slinkstrike | ability | rename |
| `insect_swarm` | Insect Swarm | Stinging Swarm | ability | rename |
| `tigers_fury` | Tiger's Fury | Wolfsblood | ability | rename |
| `rip` | Rip | Unseam | ability | generic-keep? |

- `cat_form` already displays as the original "Wolf Form" (the id is frozen anyway): keep.

---

## Talent trees + talents (V2) - `content/talents_warrior.ts`, `content/talents_classic.ts` + `talent_i18n.ts`

All 27 spec/tree names rename. Renamed talent titles need their `talent_i18n.ts` title-override
rows updated in the same V2 slice; `pairing` rows resolve by name identity with the (new)
ability name. Mirror rows (same OLD string reused across nodes by design) intentionally share
one new name.

### Warrior specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `arms` | Arms | Battlecraft | tree | rename |
| spec `fury` | Fury | Bloodrush | tree | rename |
| spec `prot` | Protection | Ironguard | tree | rename |
| mastery `fury` | Bloodthirsty | Bloodletter | mastery | rename |
| mastery `prot` | Vengeance | Recompense | mastery | rename |

Kept original: mastery `arms` Sharpened Blades.

### Warrior nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `war_toughness` | Toughness | Grit | talent | rename |
| `war_cruelty` | Cruelty | Barbarity | talent | rename |
| `war_imp_heroic_strike` | Improved Heroic Strike | Improved Reaver Strike | talent | pairing |
| `war_imp_thunder_clap` | Improved Thunder Clap | Improved Quaking Blow | talent | pairing |
| `war_deflection` | Deflection | Blade Turn | talent | rename |
| `war_tactical_choice` | Tactical Mastery | Battle Doctrine | choice | rename |
| `tc_anticipation` | Anticipation | Fair Warning | choice | rename |
| `tc_bladed_armor` | Bladed Armor | Spiked Harness | choice | rename |
| `war_berserker_rage` | Berserker Rage | Seething Fury | talent | pairing |
| `war_second_wind` | Second Wind | Deep Reserves | talent | rename |
| `arms_imp_overpower` | Improved Overpower | Improved Redhand | talent | pairing |
| `arms_deep_wounds` | Deep Wounds | Lingering Wounds | talent | rename |
| `arms_imp_slam` | Improved Slam | Improved Brute Swing | talent | pairing |
| `ac_sweeping` | Sweeping Strikes | Scything Blows | choice | rename |
| `ac_impale` | Impale | Bonepiercer | choice | rename |
| `ac_mace_spec` | Poleaxe Specialization | Poleaxe Discipline | choice | rename |
| `arms_imp_mortal_strike` | Improved Mortal Strike | Improved Maiming Strike | talent | pairing |
| `fury_cruelty` | Cruelty | Barbarity | talent | rename |
| `fury_unbridled_wrath` | Unbridled Wrath | Boundless Ire | talent | rename |
| `fury_whirlwind` | Whirlwind | Bladed Gyre | talent | pairing |
| `fury_imp_cleave` | Improved Cleave | Improved Reaping Arc | talent | pairing |
| `fury_choice` | Berserker | War Madness | choice | rename |
| `fc_enrage` | Enrage | Red Mist | choice | rename |
| `fc_flurry` | Flurry | Rapid Blows | choice | rename |
| `fc_bloodcraze` | Blood Craze | Crimson Hunger | choice | rename |
| `fury_imp_bloodthirst` | Improved Bloodthirst | Improved Bloodletting | talent | pairing |
| `prot_toughness` | Shield Mastery | Shieldwright | talent | rename |
| `prot_anticipation` | Anticipation | Fair Warning | talent | rename |
| `prot_imp_thunder_clap` | Improved Thunder Clap | Improved Quaking Blow | talent | pairing |
| `prot_imp_sunder` | Improved Sunder Armor | Improved Armor Shear | talent | pairing |
| `pc_shield_spec` | Shield Specialization | Shieldbearer | choice | rename |
| `pc_imp_taunt` | Improved Taunt | Improved Goad | choice | pairing |
| `pc_last_stand` | Last Stand | Eleventh Hour | choice | rename |
| `prot_imp_shield_slam` | Improved Shield Slam | Improved Shieldcrack | talent | pairing |

Kept original: Savagery (`tc_cruelty`), Weapon Mastery (`arms_tactical_mastery`), Blademaster
(`arms_choice`), Bulwark (`prot_choice`).

### Mage specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `arcane` | Arcane | Aethermancy | tree | rename |
| spec `fire` | Fire | Pyromancy | tree | rename |
| spec `frost` | Frost | Cryomancy | tree | rename |
| mastery `arcane` | Arcane Instability | Aetheric Flux | mastery | rename |
| mastery `fire` | Ignite | Afterflame | mastery | rename |
| mastery `frost` | Shatter | Brittlebreak | mastery | rename |

### Mage nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `mag_arcane_focus` | Arcane Focus | Aetheric Aim | talent | rename |
| `mag_elemental_precision` | Elemental Precision | Elemental Rigor | talent | rename |
| `mag_wand_specialization` | Wand Specialization | Wandcraft | talent | rename |
| `mag_flame_throwing` | Flame Throwing | Farflame | talent | rename |
| `mag_ice_shards` | Ice Shards | Splinterfrost | talent | rename |
| `mag_school_arcane` | Arcane Mind | Aetheric Mind | choice | rename |
| `mag_school_fire` | Ignite | Afterflame | choice | rename |
| `mag_school_frost` | Permafrost | Deep Rime | choice | rename |
| `mag_cold_snap` | Cold Snap | Second Winter | talent | rename |
| `mag_clearcasting` | Clearcasting | Effortless Art | talent | rename |
| `arc_imp_missiles` | Improved Arcane Missiles | Improved Aether Darts | talent | pairing |
| `arc_arcane_concentration` | Arcane Concentration | Aetheric Poise | talent | rename |
| `arc_imp_polymorph` | Improved Polymorph | Improved Bewitch | talent | pairing |
| `arc_arcane_power` | Arcane Power | Aether Surge | talent | rename |
| `arc_choice` | Arcane Thesis | Aetheric Thesis | choice | rename |
| `arc_choice_presence` | Presence of Mind | Racing Mind | choice | rename |
| `arc_choice_mind` | Arcane Mind | Aetheric Mind | choice | rename |
| `arc_choice_resilience` | Arcane Resilience | Aetheric Shell | choice | rename |
| `arc_netherwind` | Netherwind Focus | Sablewind Focus | talent | rename |
| `fire_imp_fireball` | Improved Fireball | Improved Cinderbolt | talent | pairing |
| `fire_impact` | Impact | Short Fuse | talent | rename |
| `fire_imp_blast` | Improved Fire Blast | Improved Cinderfall | talent | pairing |
| `fire_incinerate` | Incinerate | Cremation | talent | rename |
| `fire_choice` | Combustion | Flashfire | choice | rename |
| `fire_choice_combustion` | Combustion | Flashfire | choice | rename |
| `fire_choice_blastwave` | Blast Wave | Rolling Flame | choice | rename |
| `fire_choice_flame` | Critical Mass | Tipping Point | choice | rename |
| `fire_pyromancer` | Pyromancer | Pyre Tender | talent | rename |
| `frost_imp_frostbolt` | Improved Frostbolt | Improved Rimelance | talent | pairing |
| `frost_permafrost` | Permafrost | Deep Rime | talent | rename |
| `frost_imp_nova` | Improved Frost Nova | Improved Icebind | talent | pairing |
| `frost_shatter` | Shatter | Brittlebreak | talent | rename |
| `frost_choice_barrier` | Ice Barrier | Frostveil | choice | pairing |
| `frost_choice_snap` | Cold Snap | Second Winter | choice | rename |
| `frost_choice_warding` | Frost Warding | Winterguard | choice | rename |
| `frost_winter_chill` | Winter Chill | Cold Shoulder | talent | rename |

Kept original: School Focus (`mag_school_focus`), Icecraft (`frost_choice`).

### Rogue specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `assassination` | Assassination | Knifework | tree | rename |
| spec `combat` | Combat | Thuggery | tree | rename |
| spec `subtlety` | Subtlety | Skulduggery | tree | rename |
| mastery `assassination` | Murderous Intent | Redhanded | mastery | rename |
| mastery `combat` | Combat Potency | Scrapper's Edge | mastery | rename |
| mastery `subtlety` | Master of Deception | False Face | mastery | rename |

### Rogue nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `rog_malice` | Malice | Ill Will | talent | rename |
| `rog_lightning_reflexes` | Lightning Reflexes | Viper Reflexes | talent | rename |
| `rog_imp_sinister` | Improved Sinister Strike | Improved Wicked Slash | talent | pairing |
| `rog_camouflage` | Camouflage | Sootcloak | talent | rename |
| `rog_deflection` | Deflection | Blade Turn | talent | rename |
| `rog_dirty_tricks` | Dirty Tricks | Foul Play | choice | rename |
| `rog_trick_poison` | Vile Poisons | Cruel Venoms | choice | rename |
| `rog_trick_blade` | Blade Flurry | Mirrored Blades | choice | rename |
| `rog_trick_shadow` | Heightened Senses | Hush Money | choice | rename |
| `rog_preparation` | Preparation | Contingency | talent | rename |
| `rog_vigor` | Vigor | Stolen Breath | talent | rename |
| `ass_imp_eviscerate` | Improved Eviscerate | Improved Dirt Nap | talent | pairing |
| `ass_remorseless` | Remorseless Attacks | Pitiless Blows | talent | rename |
| `ass_murder` | Murder | Dirty Work | talent | rename |
| `ass_laceration` | Relentless Strikes | Ceaseless Cuts | talent | rename |
| `ass_choice` | Cold Blood | Killer's Calm | choice | rename |
| `ass_choice_cold` | Cold Blood | Killer's Calm | choice | rename |
| `ass_choice_seal` | Seal Fate | Final Notice | choice | rename |
| `ass_vigor` | Assassin Vigor | Grim Vigor | talent | rename |
| `combat_imp_gouge` | Improved Gouge | Improved Eye Jab | talent | pairing |
| `combat_precision` | Precision | Dead Aim | talent | rename |
| `combat_imp_sprint` | Improved Sprint | Improved Swift Heels | talent | pairing |
| `combat_dual_wield` | Weapon Expertise | Practiced Steel | talent | rename |
| `combat_choice` | Combat Style | Brawler's Way | choice | rename |
| `combat_choice_flurry` | Blade Flurry | Mirrored Blades | choice | rename |
| `combat_choice_riposte` | Riposte | Turnabout | choice | rename |
| `combat_choice_adrenaline` | Adrenaline Rush | Quickened Blood | choice | pairing |
| `sub_master_deception` | Master of Deception | False Face | talent | rename |
| `sub_opportunity` | Opportunity | Low Cunning | talent | rename |
| `sub_elusiveness` | Elusiveness | Eel's Grace | talent | rename |
| `sub_imp_ambush` | Improved Ambush | Improved Lurker's Strike | talent | pairing |
| `sub_choice` | Shadow Arts | Night Trade | choice | rename |
| `sub_choice_hemo` | Hemorrhage | Red Ribbon | choice | rename |
| `sub_choice_prep` | Preparation | Contingency | choice | rename |
| `sub_choice_senses` | Heightened Senses | Hush Money | choice | rename |
| `sub_shadowstep` | Shadowstep | Shadeslip | talent | rename |

Kept original: Vile Precision (`ass_choice_vile`), Weapon Mastery (`combat_weapon_mastery`).

### Paladin specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `holy` | Holy | Sacrament | tree | rename |
| spec `protection` | Protection | Vigil | tree | rename |
| spec `retribution` | Retribution | Requital | tree | rename |
| mastery `holy` | Illumination | Kindled Faith | mastery | rename |
| mastery `protection` | Holy Shielding | Oathward | mastery | rename |
| mastery `retribution` | Vengeance | Blood Debt | mastery | rename |

### Paladin nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `pal_divine_strength` | Divine Strength | Sworn Strength | talent | rename |
| `pal_spiritual_focus` | Spiritual Focus | Quiet Fervor | talent | rename |
| `pal_imp_devotion_aura` | Improved Devotion Aura | Improved Steadfast Aura | talent | pairing |
| `pal_benediction` | Benediction | Fervent Oath | talent | rename |
| `pal_precision` | Conviction | Grim Certainty | talent | rename |
| `pal_holy_calling` | Holy Calling | Votive Calling | choice | rename |
| `pal_calling_light` | Healing Light | Mender's Vow | choice | rename |
| `pal_calling_guardian` | Guardian Favor | Warder's Vow | choice | rename |
| `pal_calling_crusader` | Crusader Zeal | Reaper's Vow | choice | rename |
| `pal_divine_favor` | Divine Favor | Martyr's Boon | talent | rename |
| `pal_sanctified_light` | Sanctified Light | Hallowlight | talent | rename |
| `holy_imp_holy_light` | Improved Holy Light | Improved Mending Light | talent | pairing |
| `holy_divine_intellect` | Divine Intellect | Lettered Faith | talent | rename |
| `holy_flash_focus` | Flash Focus | Lightmend Focus | talent | pairing |
| `holy_lay_blessing` | Improved Lay on Hands | Improved Last Rite | talent | pairing |
| `holy_choice` | Beacon Discipline | Lodestar | choice | rename |
| `holy_choice_grace` | Holy Grace | Unearned Mercy | choice | rename |
| `holy_choice_judgement` | Judgement of Light | Verdict of Light | choice | pairing |
| `holy_choice_devotion` | Devoted Soul | Steadfast Soul | choice | rename |
| `holy_light_mastery` | Light Mastery | Lightwright | talent | rename |
| `prot_redoubt` | Redoubt | Palisade | talent | rename |
| `prot_anticipation` | Anticipation | Forewarning | talent | rename |
| `prot_imp_righteous_fury` | Improved Righteous Fury | Improved Burning Oath | talent | pairing |
| `prot_guardians_favor` | Guardian Favor | Warder's Vow | talent | rename |
| `prot_choice` | Sanctuary | Refuge | choice | rename |
| `prot_choice_sanctuary` | Blessing of Sanctuary | Oath of Refuge | choice | rename |
| `prot_choice_reckoning` | Reckoning | Grave Mistake | choice | rename |
| `prot_choice_ardent` | Ardent Defender | Deathless Ardor | choice | rename |
| `prot_holy_shield` | Holy Shield | Hallowed Wall | talent | rename |
| `ret_benediction` | Benediction | Fervent Oath | talent | rename |
| `ret_conviction` | Conviction | Grim Certainty | talent | rename |
| `ret_imp_judgement` | Improved Judgement | Improved Verdict | talent | pairing |
| `ret_seal_command` | Seal Command | Oathbrand Command | talent | pairing |
| `ret_choice` | Crusader Path | Warpath | choice | rename |
| `ret_choice_sanctity` | Sanctity Aura | Fervid Aura | choice | rename |
| `ret_choice_pursuit` | Pursuit of Justice | Swift Verdict | choice | rename |
| `ret_choice_vengeance` | Vengeance | Blood Debt | choice | rename |
| `ret_crusader_strikes` | Crusader Strikes | Punishing Blows | talent | rename |

Kept original: none (the paladin tree is wall-to-wall WoW-derived).

### Hunter specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `beast_mastery` | Beast Mastery | Packlord | tree | rename |
| spec `marksmanship` | Marksmanship | Coldsight | tree | rename |
| spec `survival` | Survival | Fieldcraft | tree | rename |
| mastery `beast_mastery` | Kindred Spirits | Packbond | mastery | rename |
| mastery `marksmanship` | Trueshot Training | Iron Aim | mastery | rename |
| mastery `survival` | Lightning Reflexes | Quickblood | mastery | rename |

### Hunter nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `hun_endurance_training` | Endurance Training | Ironsinew | talent | rename |
| `hun_lethal_shots` | Lethal Shots | Butcher's Aim | talent | rename |
| `hun_imp_hawk` | Improved Aspect of the Hawk | Improved Harrier's Guise | talent | pairing |
| `hun_efficiency` | Efficiency | Lean Quiver | talent | rename |
| `hun_deflection` | Deflection | Turnaside | talent | rename |
| `hun_pathfinder` | Pathfinder | Waywise | choice | rename |
| `hun_path_beast` | Pack Leader | First Fang | choice | rename |
| `hun_path_marksman` | Hawk Eye | Carrion Eye | choice | rename |
| `hun_path_survivor` | Trailblazer | Brackenstride | choice | rename |
| `hun_rapid_instincts` | Rapid Instincts | Fevered Instinct | talent | rename |
| `hun_survivalist` | Survivalist | Old Scars | talent | rename |
| `bm_thick_hide` | Thick Hide | Calloused Hide | talent | rename |
| `bm_unleashed_fury` | Unleashed Fury | Slipped Leash | talent | rename |
| `bm_imp_mend` | Improved Mend Pet | Beast Tending | talent | rename |
| `bm_ferocity` | Ferocity | Redmaw | talent | rename |
| `bm_choice` | Bestial Bond | Beastpact | choice | rename |
| `bm_choice_wrath` | Bestial Wrath | Howling Rage | choice | rename |
| `bm_choice_intimidation` | Intimidation | Cowing Roar | choice | rename |
| `bm_choice_frenzy` | Frenzy | Bloodlather | choice | rename |
| `bm_focused_fire` | Focused Fire | Shared Quarry | talent | rename |
| `mm_imp_arcane_shot` | Improved Arcane Shot | Improved Fell Shot | talent | pairing |
| `mm_lethal_shots` | Lethal Shots | Butcher's Aim | talent | rename |
| `mm_aimed_focus` | Aimed Focus | Steady Draw | talent | pairing |
| `mm_barrage` | Barrage | Arrow Squall | talent | rename |
| `mm_choice` | Trueshot | Sureflight | choice | rename |
| `mm_choice_aura` | Trueshot Aura | Sureflight Aura | choice | rename |
| `mm_choice_mortal` | Mortal Shots | Cruel Wounds | choice | rename |
| `mm_choice_hawk` | Hawk Eye | Carrion Eye | choice | rename |
| `mm_marksman_mastery` | Marksman Mastery | Coldsight Mastery | talent | rename |
| `surv_humanoid_slaying` | Monster Slaying | Monsterbane | talent | rename |
| `surv_savage_strikes` | Savage Strikes | Merciless Strikes | talent | rename |
| `surv_imp_wing_clip` | Improved Wing Clip | Improved Fettering Slash | talent | pairing |
| `surv_deterrence` | Deterrence | Bristleguard | talent | rename |
| `surv_choice` | Survival Tactics | Bitter Lessons | choice | rename |
| `surv_choice_counter` | Counterattack | Answering Fang | choice | rename |
| `surv_choice_killer` | Killer Instinct | Killing Calm | choice | rename |
| `surv_choice_surefooted` | Surefooted | Steadfoot | choice | rename |
| `surv_lightning_reflexes` | Lightning Reflexes | Quickblood | talent | rename |

Kept original: none.

### Priest specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `discipline` | Discipline | Doctrine | tree | rename |
| spec `holy` | Holy | Benison | tree | rename |
| spec `shadow` | Shadow | Vespers | tree | rename |
| mastery `discipline` | Focused Will | Fixed Purpose | mastery | rename |
| mastery `holy` | Spiritual Healing | Grave Mercy | mastery | rename |
| mastery `shadow` | Shadowform | Gloamveil | mastery | rename |

### Priest nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `pri_wand_specialization` | Wand Specialization | Baleful Rod | talent | rename |
| `pri_spirit_tap` | Spirit Tap | Soulglean | talent | rename |
| `pri_imp_fortitude` | Improved Fortitude | Improved Litany of Resolve | talent | pairing |
| `pri_meditation` | Meditation | Nocturns | talent | rename |
| `pri_shadow_affinity` | Shadow Affinity | Duskbound | talent | rename |
| `pri_inner_calling` | Inner Calling | Veiled Calling | choice | rename |
| `pri_calling_disc` | Inner Focus | Stilled Mind | choice | rename |
| `pri_calling_holy` | Divine Fury | Wrathful Psalm | choice | rename |
| `pri_calling_shadow` | Darkness | Creeping Dark | choice | rename |
| `pri_desperate_prayer` | Desperate Prayer | Last Prayer | talent | rename |
| `pri_enlightenment` | Enlightenment | Bleak Insight | talent | rename |
| `disc_unbreakable_will` | Unbreakable Will | Unbowed Mind | talent | rename |
| `disc_twin_disciplines` | Twin Disciplines | Twofold Creed | talent | rename |
| `disc_imp_shield` | Improved Power Word: Shield | Improved Psalm of Warding | talent | pairing |
| `disc_mental_agility` | Mental Agility | Nimble Mind | talent | rename |
| `disc_choice` | Discipline Focus | Doctrine Focus | choice | rename |
| `disc_choice_barrier` | Borrowed Time | Cold Comfort | choice | rename |
| `disc_choice_focus` | Inner Focus | Stilled Mind | choice | rename |
| `disc_choice_power` | Power Infusion | Anointing | choice | rename |
| `disc_penance` | Penance | Chastisement | talent | rename |
| `holy_healing_focus` | Healing Focus | Steadied Prayer | talent | rename |
| `holy_renewal` | Improved Renew | Improved Lingering Grace | talent | pairing |
| `holy_divine_fury` | Divine Fury | Wrathful Psalm | talent | rename |
| `holy_inspiration` | Inspiration | Small Mercies | talent | rename |
| `holy_priest_choice` | Holy Word | Deepword | choice | rename |
| `holy_priest_choice_spirit` | Spiritual Guidance | Ghostlight | choice | rename |
| `holy_priest_choice_nova` | Holy Reach | Reaching Word | choice | rename |
| `holy_priest_choice_prayer` | Healing Prayers | Gathered Prayers | choice | rename |
| `holy_spiritual_healing` | Spiritual Healing | Grave Mercy | talent | rename |
| `shadow_blackout` | Blackout | Snuffed Light | talent | rename |
| `shadow_word_pain` | Improved Shadow Word: Pain | Improved Dirge of Decay | talent | pairing |
| `shadow_mind_flay` | Improved Mind Flay | Improved Litany of Woe | talent | pairing |
| `shadow_focus` | Shadow Focus | Umbral Intent | talent | rename |
| `shadow_choice` | Dark Arts | Black Office | choice | rename |
| `shadow_choice_vampiric` | Vampiric Embrace | Leeching Dirge | choice | rename |
| `shadow_choice_silence` | Silence | Silent Treatment | choice | rename |
| `shadow_choice_darkness` | Darkness | Creeping Dark | choice | rename |
| `shadow_shadowform` | Shadowform | Gloamveil | talent | rename |

Kept original: none.

### Shaman specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `elemental` | Elemental | Thundercall | tree | rename |
| spec `enhancement` | Enhancement | Warspirit | tree | rename |
| spec `restoration` | Restoration | Spiritmend | tree | rename |
| mastery `elemental` | Elemental Fury | Earthen Fury | mastery | rename |
| mastery `enhancement` | Stormcaller | Skyrend | mastery | rename |
| mastery `restoration` | Purification | Cleansing Tides | mastery | rename |

### Shaman nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `sha_convection` | Convection | Latent Charge | talent | rename |
| `sha_ancestral_knowledge` | Ancestral Knowledge | Ancient Lore | talent | rename |
| `sha_shielding` | Improved Lightning Shield | Improved Thunder Ward | talent | pairing |
| `sha_thundering_strikes` | Thundering Strikes | Thunderous Blows | talent | rename |
| `sha_tidal_focus` | Tidal Focus | Serene Waters | talent | rename |
| `sha_elemental_calling` | Elemental Calling | Path of Spirits | choice | rename |
| `sha_calling_elemental` | Elemental Fury | Earthen Fury | choice | rename |
| `sha_calling_enhance` | Flurry | Frenzied Tempo | choice | rename |
| `sha_calling_restoration` | Healing Grace | Soothing Grace | choice | rename |
| `sha_ghost_wolf` | Improved Ghost Wolf | Improved Shadewolf | talent | pairing |
| `sha_natures_guidance` | Nature Guidance | Sure Footing | talent | rename |
| `ele_concussion` | Concussion | Fault Line | talent | rename |
| `ele_call_flame` | Call of Flame | Ashen Call | talent | rename |
| `ele_reverberation` | Reverberation | Lingering Echo | talent | rename |
| `ele_elemental_focus` | Elemental Focus | Primal Clarity | talent | rename |
| `ele_choice` | Elemental Mastery | Primal Mastery | choice | rename |
| `ele_choice_mastery` | Elemental Mastery | Primal Mastery | choice | rename |
| `ele_choice_devastation` | Elemental Devastation | Shattered Earth | choice | rename |
| `ele_choice_storm` | Storm Reach | Arcing Reach | choice | rename |
| `ele_lightning_mastery` | Lightning Mastery | Arc Mastery | talent | pairing |
| `enh_ancestral_weapons` | Ancestral Weapons | Elder Arms | talent | rename |
| `enh_shield_spec` | Shield Specialization | Stalwart Shield | talent | rename |
| `enh_imp_rockbiter` | Improved Rockbiter | Improved Stonebound | talent | pairing |
| `enh_flurry` | Flurry | Frenzied Tempo | talent | rename |
| `enh_choice` | Storm Path | Thunder Path | choice | rename |
| `enh_choice_stormstrike` | Stormstrike | Ancestral Strike | choice | pairing |
| `enh_choice_toughness` | Toughness | Earthen Grit | choice | rename |
| `enh_choice_weapon` | Weapon Mastery | Honed Edge | choice | rename |
| `enh_spirit_weapons` | Spirit Weapons | Spiritforged Arms | talent | rename |
| `rest_tidal_focus` | Tidal Focus | Serene Waters | talent | rename |
| `rest_imp_healing_wave` | Improved Healing Wave | Improved Mending Waters | talent | pairing |
| `rest_ancestral_healing` | Ancestral Healing | Ancestor's Mercy | talent | rename |
| `rest_healing_grace` | Healing Grace | Soothing Grace | talent | rename |
| `rest_choice` | Nature Blessing | Tidesworn Path | choice | rename |
| `rest_choice_swiftness` | Nature Swiftness | Rushing Waters | choice | rename |
| `rest_choice_mana` | Mana Tide | Springflood | choice | rename |
| `rest_choice_purification` | Purification | Cleansing Tides | choice | rename |
| `rest_chain_focus` | Ancestral Guidance | Guiding Spirits | talent | rename |

Kept original: none.

### Warlock specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `affliction` | Affliction | Hexcraft | tree | rename |
| spec `demonology` | Demonology | Pactbound | tree | rename |
| spec `destruction` | Destruction | Ruination | tree | rename |
| mastery `affliction` | Potent Afflictions | Creeping Rot | mastery | rename |
| mastery `demonology` | Demonic Knowledge | Fiendlore | mastery | rename |
| mastery `destruction` | Ruin | Desolation | mastery | rename |

### Warlock nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `wlk_suppression` | Suppression | Stifling Grasp | talent | rename |
| `wlk_demonic_embrace` | Demonic Embrace | Fiendish Fortitude | talent | rename |
| `wlk_imp_corruption` | Improved Corruption | Improved Blackrot | talent | pairing |
| `wlk_demonic_skin` | Improved Demon Skin | Improved Fiendhide | talent | pairing |
| `wlk_cataclysm` | Cataclysm | Calamity | talent | rename |
| `wlk_dark_pact` | Dark Pact | Grim Bargain | choice | rename |
| `wlk_pact_affliction` | Nightfall | Grim Tidings | choice | rename |
| `wlk_pact_demonology` | Fel Stamina | Blackblood Vigor | choice | rename |
| `wlk_pact_destruction` | Devastation | Wrack | choice | rename |
| `wlk_shadowburn` | Shadowburn | Duskfire | talent | pairing |
| `wlk_fel_intellect` | Fel Intellect | Vile Cunning | talent | rename |
| `aff_imp_agony` | Improved Curse of Agony | Improved Hex of Anguish | talent | pairing |
| `aff_imp_corruption` | Improved Corruption | Improved Blackrot | talent | pairing |
| `aff_fel_concentration` | Fel Concentration | Unbroken Focus | talent | rename |
| `aff_amplify_curse` | Amplify Curse | Deepened Hex | talent | rename |
| `aff_choice` | Soul Harvest | Reaping Path | choice | rename |
| `aff_choice_siphon` | Siphon Life | Veinleech | choice | rename |
| `aff_choice_shadow` | Shadow Mastery | Umbral Mastery | choice | rename |
| `aff_choice_nightfall` | Nightfall | Grim Tidings | choice | rename |
| `aff_unstable_affliction` | Unstable Affliction | Parting Gift | talent | rename |
| `demo_demonic_embrace` | Demonic Embrace | Fiendish Fortitude | talent | rename |
| `demo_fel_armor` | Fel Armor | Vile Carapace | talent | rename |
| `demo_health_funnel` | Improved Life Tap | Improved Hard Bargain | talent | pairing |
| `demo_master_summoner` | Master Summoner | Grand Binder | talent | rename |
| `demo_choice` | Demonic Tactics | Court of Fiends | choice | rename |
| `demo_choice_link` | Soul Link | Pain Communion | choice | rename |
| `demo_choice_master` | Master Demonologist | Fiendmaster | choice | rename |
| `demo_choice_resilience` | Demonic Resilience | Unyielding Pact | choice | rename |
| `demo_metamorphosis` | Metamorphosis | Dread Aspect | talent | rename |
| `dest_cataclysm` | Cataclysm | Calamity | talent | rename |
| `dest_bane` | Bane | Hastened Doom | talent | rename |
| `dest_devastation` | Devastation | Wrack | talent | rename |
| `dest_imp_searing` | Improved Searing Pain | Improved Sear | talent | pairing |
| `dest_choice` | Ruin | Desolation | choice | rename |
| `dest_choice_ruin` | Ruin | Desolation | choice | rename |
| `dest_choice_shadowburn` | Shadowburn | Duskfire | choice | pairing |
| `dest_choice_emberstorm` | Emberstorm | Blackfire | choice | rename |
| `dest_backdraft` | Backdraft | Flashburn | talent | rename |

Kept original: none.

### Druid specs + masteries
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `balance` | Balance | Moongrove | tree | rename |
| spec `feral` | Feral | Wildfang | tree | rename |
| spec `restoration` | Restoration | Groveheart | tree | rename |
| mastery `balance` | Moonfury | Moonrage | mastery | rename |
| mastery `feral` | Heart of the Wild | Primal Heart | mastery | rename |
| mastery `restoration` | Gift of Nature | Grove's Gift | mastery | rename |

### Druid nodes/choices
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `dru_natures_grasp` | Nature Grasp | Thicket Snare | talent | rename |
| `dru_feral_aggression` | Feral Aggression | Red Hunger | talent | rename |
| `dru_imp_mark` | Improved Mark of the Wild | Improved Wildward | talent | pairing |
| `dru_naturalist` | Naturalist | Woodwise | talent | rename |
| `dru_thick_hide` | Thick Hide | Ironpelt | talent | rename |
| `dru_natures_path` | Nature Path | Path of Seasons | choice | rename |
| `dru_path_balance` | Moonglow | Gentle Gloam | choice | rename |
| `dru_path_feral` | Heart of the Wild | Primal Heart | choice | rename |
| `dru_path_resto` | Gift of Nature | Grove's Gift | choice | rename |
| `dru_barkskin` | Barkskin | Oakhide | talent | pairing |
| `dru_furor` | Furor | Wildsurge | talent | rename |
| `bal_imp_wrath` | Improved Wrath | Improved Wildbolt | talent | pairing |
| `bal_imp_moonfire` | Improved Moonfire | Improved Lunar Tempest | talent | pairing |
| `bal_natures_reach` | Nature Reach | Reaching Boughs | talent | rename |
| `bal_vengeance` | Vengeance | Cold Reckoning | talent | rename |
| `bal_choice` | Moonkin Path | Moonwing Path | choice | rename |
| `bal_choice_moonkin` | Moonkin Form | Moonwing Form | choice | rename |
| `bal_choice_grace` | Nature Grace | Starlit Grace | choice | rename |
| `bal_choice_moonglow` | Moonglow | Gentle Gloam | choice | rename |
| `bal_starfire_mastery` | Starfire Mastery | Skyfall Mastery | talent | pairing |
| `feral_thick_hide` | Thick Hide | Ironpelt | talent | rename |
| `feral_ferocity` | Ferocity | Whetted Fangs | talent | rename |
| `feral_brutal_impact` | Brutal Impact | Heavy Blows | talent | rename |
| `feral_feline_swiftness` | Feline Swiftness | Swiftpaw | talent | rename |
| `feral_choice` | Feral Instinct | Path of Fangs | choice | rename |
| `feral_choice_bear` | Dire Bear | Dire Bruin | choice | pairing |
| `feral_choice_cat` | Predatory Strikes | Predator's Cunning | choice | rename |
| `feral_choice_survival` | Survival Instincts | Deathless Will | choice | rename |
| `feral_heart_wild` | Heart of the Wild | Primal Heart | talent | rename |
| `rest_imp_rejuv` | Improved Rejuvenation | Improved Wildbloom | talent | pairing |
| `rest_druid_naturalist` | Naturalist | Woodwise | talent | rename |
| `rest_reflection` | Reflection | Quietude | talent | rename |
| `rest_imp_regrowth` | Improved Regrowth | Improved Second Bloom | talent | pairing |
| `rest_druid_choice` | Restoration Gift | Path of Renewal | choice | rename |
| `rest_druid_choice_swift` | Nature Swiftness | Swiftbloom | choice | rename |
| `rest_druid_choice_innervate` | Innervate | Lifesap | choice | rename |
| `rest_druid_choice_living` | Living Spirit | Evergreen Soul | choice | rename |
| `rest_tree_life` | Tree of Life | Heartwood | talent | rename |

Kept original: none.

- Assembly fix vs the agent draft: `feral_ferocity` was proposed "Bloodletting" but that equals
  the `bloodthirst` ability's new name (non-pairing row): replaced with "Whetted Fangs".
- One string, one armed-state: `fury_whirlwind` (grant node of `whirlwind`) and `fc_enrage`
  share their strings with `generic-keep?` ability rows (Whirlwind, druid Enrage), so they carry
  `generic-keep?` too - the operator's per-string call covers the cluster; if the string flips
  to rename, the node takes the listed new name (the whirlwind node tracks the ability by the
  grant-node pairing rule).
- Generic-keep cascade: six pairing rows encode the candidate of a `generic-keep?` ability -
  `pc_imp_taunt` (Improved Goad), `combat_imp_gouge` (Improved Eye Jab), `combat_imp_sprint`
  (Improved Swift Heels), `sub_imp_ambush` (Improved Lurker's Strike), `bal_imp_wrath`
  (Improved Verdant Bolt), `holy_renewal` (Improved Lingering Grace). If the operator KEEPS the
  generic ability name, the paired row keeps "Improved <old name>" instead (nothing renames).
- Truncated-pairing note (needs title override in V2): `enh_imp_rockbiter` follows the source's
  own truncation ("Improved Stonebound" for "Stonebound Weapon", as "Improved Rockbiter" was
  for "Rockbiter Weapon").
- Cross-class note: shaman + druid old "Nature Swiftness" deliberately diverge (Rushing Waters
  vs Swiftbloom); warrior + rogue old "Deflection" deliberately share "Blade Turn" while
  hunter's diverges (Turnaside).
- `demo_master_summoner` carries `refs:fear` in the talent data - looks like a data bug worth a
  dev glance; does not affect this map.

---

## Creatures (C1) - coined `MobFamily` ids + prose + flagged terms

| id (frozen unless coined-id) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| family `murloc` | `murloc` | `mudfin` | family-id | coined-id |
| family `kobold` | `kobold` | `burrower` | family-id | coined-id |
| guide family name (murloc) | Murlocs | Mudfins | family-display | rename |
| guide family name (kobold) | Kobolds | Burrowers | family-display | rename |
| `mudfin_scale` | Slimy Murloc Scale | Slimy Mudfin Scale | item | rename |
| `tallow_candle` | Tallow Candle | Greasy Tallow Lump | item | rename |
| `blessed_wax` | Blessed Tallow | Blessed Tallow | item | generic-keep? |
| `q_boars` quest name | Bristleback Hides | Bristly Boar Hides | quest | rename |
| `bristleback_maul` | Bristleback Maul | Gallowglass Hammer | item | rename |
| `sanctum_drakonid` | Sanctum Drakonid | Sanctum Scaleguard | mob | rename |
| `mogger` | Mogger | Mogger | mob | generic-keep? |
| `tunnel_rat` | Tunnel Rat Digger | Deeprock Digger | mob | rename |
| `mogger_lackey` | Mogger Lackey | Mogger Lackey | mob | generic-keep? |
| `q_mogger` quest name | Mogger Must Fall | Mogger Must Fall | quest | generic-keep? |
| `moggers_stomper_boots` | Mogger's Stomper Boots | Mogger's Stomper Boots | item | generic-keep? |
| `moggers_copper_cudgel` | Mogger's Copper Cudgel | Mogger's Copper Cudgel | item | generic-keep? |
| `moggers_shiv` | Mogger's Shiv | Mogger's Shiv | item | generic-keep? |

C1 prose rewords (quest text / greetings; word-boundary scanner entries murloc / bristleback /
candle-headed / tallow candle clear when these land):
- `q_murlocs` text: "where there is one murloc, there are five" -> "where there is one mudfin, there are five".
- `q_mine` text: "those kobold vermin came boiling out" -> "those burrowing vermin came boiling out".
- `q_rite` text: "the kobold diggers hoard candles by the crate" -> "the mine's burrowers hoard tallow by the crate" ("Blessed Tallow" item/objective stays).
- `q_deepfen` text: "The Deepfen murlocs kept to their shallows" -> "The Deepfen mudfins kept to their shallows".
- `q_deepfen_purge` text: "the murlocs are hauling" -> "the mudfins are hauling".
- `q_kobold_tunnels` text: "The kobolds at Deeprock Burrows ... any candle-rat" -> "The tunnelers at Deeprock Burrows ... any pit-rat".
- `q_kobold_tunnels` completion: "kobolds do not dig like that" -> "burrowers do not dig like that".
- `q_glowing_wax` text: "a candle taken off one of those tunnelers - the wax glows" -> "a lump of wax taken off one of those tunnelers - it glows".
- `foreman_odell` greeting: "candle-headed vermin" -> "dirt-caked vermin".
- guide catalog prose (Z1-swept, outside the S3 net): murloc/kobold mentions at `i18n.catalog/guide.ts` 147, 545, 559-566, 607, 626, 628 follow the same substitutions.

C1 structural record (do not re-derive; G1-verified on the live tree):
- **Blast radius `murloc` -> `mudfin`:** `src/sim/types.ts:443` (MobFamily union); `src/sim/sim.ts:331`
  (FLEEING_FAMILIES), `sim.ts:418-421` (SOCIAL_PULL_RADIUS - note: NOT "MOB_PULL_LIMITS"),
  `sim.ts:2477` (mobCanSpawnInWater); content `family:` fields zone1.ts:260, zone2.ts:111/152/185/203,
  temple.ts:44/234; `render/characters/manifest.ts:884` (FAMILY_KEYS key only - freeze the
  `mob_murloc` model-manifest VALUE); `src/ui/hud.ts:549` (SFX_MOB_FAMILIES) and the
  `mob_${fam}_*` SFX chain (sfx_manifest.generated.ts:266-276 + public/audio/sfx/mob_murloc_*.mp3 +
  scripts/sfx/sfx_prompts.mjs:87,113 - regenerate or alias, else creatures go MUTE silently);
  i18n keys `guide.family.murloc.*` (i18n.catalog/guide.ts:559-562 + all 17 locales + regen);
  `src/guide/content.generated.ts:1456` + `scripts/wiki/build_content.mjs:218` (regen);
  tests/fixes.test.ts:165 + tests/sloomtooth_drowned.test.ts:12 (swap in same commit).
  FROZEN: templateIds `mudfin_murloc`/`deepfen_murloc`, quest id `q_murlocs`, aura ids, item id
  `mudfin_scale`, i18n entity keys, voice keys.
- **Blast radius `kobold` -> `burrower`:** `types.ts:445`; `sim.ts:331` (the ONLY sim.ts site);
  content `family:` zone1.ts:287/311, zone3.ts:143/169/203; `manifest.ts:886` (key only);
  `hud.ts:550` + SFX chain (sfx_manifest.generated.ts:254-263 + mob_kobold_*.mp3 + prompts);
  `guide.family.kobold.*` keys + locales + regen; content.generated.ts:1491 + build_content.mjs:219.
  No test asserts the family string. FROZEN: `deeprock_kobold`, `q_kobold_tunnels` + voice keys.
- Family ids never cross the wire (zero hits in server/, headless/, src/net/): parity goldens
  expected byte-identical for C1 family work (C1 still runs the golden inspector).
- "Elder Bristleback" is RETIRED content (`removed_zone1_content.ts:25`); only a comment and a
  frozen-id voice branch remain - no display rename needed for the mob itself.
- `tunnelrat` was REFUTED as the kobold family id (WoW's Loch Modan "Tunnel Rat" kobold tribe).

---

## Warlock demon-pet roster (C2) - `content/warlock_pets.ts` + `summonDemon` + `entity_i18n`

**Persistence verdict (G1-verified, evidence in the blast-radius record below): all 7 pet ids
are RUNTIME-ONLY -> `coined-id` (rename ids atomically).** `serializeCharacter` explicitly nulls
demon pet snapshots (`sim.ts:1378-1381`: "Warlock demons are not persisted across logout");
`server/db.ts` has zero pet-id references; the wire sends `tid` one-way (runtime entity state,
never round-tripped); `src/sim/obs.ts` has zero templateId references; no offline character save
exists; talent/loadout strings persist ABILITY ids (`summon_*` - frozen), never pet ids.

NOTE: the pet ids are `imp`..`doomguard` (NOT `warlock_imp`..: those are zone1 NPC-demon
templates already displaying original names "Fire Demon"/"Void Demon" - C2 must not touch them,
except the `warlock_imp` petSpell row below).

| current id | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `imp` | Imp | Emberkin | pet | coined-id |
| `voidwalker` | Voidwalker | Gloomshade | pet | coined-id |
| `succubus` | Succubus | Duskborn | pet | coined-id |
| `felhunter` | Felhunter | Spellhound | pet | coined-id |
| `felguard` | Felguard | Warfiend | pet | coined-id |
| `infernal` | Infernal | Pyre Colossus | pet | coined-id |
| `doomguard` | Doomguard | Wraithborn | pet | coined-id |

Proposed new code ids (the coined-id sweep): `emberkin`, `gloomshade`, `duskborn`,
`spellhound`, `warfiend`, `pyre_colossus`, `wraithborn` (kept out of the table so every map
table stays 5-column for the scanner parse).

| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `warlock_imp` petSpell | Firebolt | Ashbolt | aura | rename |

- Draft rejections (adversarially screened): Temptress (Diablo II succubus lineage), Dreadguard
  (WoW nathrezim guard type), Cinder Colossus (Cinder- crowding + LoL Cinderhulk adjacency).
- Summon ability display rows live in the V1 Warlock table (Summon Cinderling, ...); the summon
  DESCRIPTIONS (classes.ts 2705-2796, duplicated in the catalog) swap the demon nouns + Firebolts
  -> Ashbolts + Shadow Bite -> Gloombite in the same C2/V1 coordination.
- Blast radius (id swap, one commit): `warlock_pets.ts` keys/id/name lines; `classes.ts` summon
  `mobId:` literals 2704/2719/2734/2749/2764/2779/2794 (tsc will NOT catch a mismatch - summon
  silently no-ops); `render/characters/manifest.ts` MOB_KEYS 835-837 (imp/voidwalker/succubus
  only; the other four fall through FAMILY_KEYS.demon - nothing to rename); catalog
  `merge.ts` MERGE_MOB_IDS 103-105/113-116; `i18n.catalog/guide.ts` petHook keys 513-519; all 20
  locale files (entities.mobs.<id>.name + guide.petHook.<id> keys); regen i18n + guide artifacts.
- Tests: warlock_pets/threat/pet_commands_module/pet_command/pet_owner_death_despawn/
  pet_combat_regen/delves/nythraxis_raid/guide_viewer_embed test files reference pet ids; parity
  goldens `pet_ai.json`, `warlock_pet.json`, AND `pet_commands.json` (the brief listed two; the
  third also serializes a pet id) shift by exactly the renamed tokens - the inspector verifies
  nothing else moved.
- Locale-value warning: several locales keep the verbatim English WoW word as their translation
  (da_DK/id_ID 'Imp', 'Voidwalker', ...) - the Z1 reconciliation note must cover pet rows even
  though the KEY also changes.

---

## Items / sets / augments (W1) - `content/items.ts`, `item_sets.ts`, `augments.ts` + catalog

| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `worn_sword` | Worn Shortsword | Pitted Shortsword | item | rename |
| `baked_bread` | Freshly Baked Bread | Cottage Loaf | item | rename |
| `spring_water` | Refreshing Spring Water | Cold Well Water | item | rename |
| `roasted_boar` | Roasted Boar Meat | Spitted Boar Haunch | item | rename |
| `tough_jerky` | Tough Jerky | Salted Jerky | item | rename |
| `conjured_water` | Conjured Spring Water | Conjured Rainwater | item | rename |
| `conjured_water2` | Conjured Mineral Water | Conjured Wellwater | item | rename |
| `conjured_water3` | Conjured Sparkling Water | Conjured Clearwater | item | rename |
| `conjured_bread` | Conjured Bread | Conjured Oatcake | item | rename |
| `conjured_bread2` | Conjured Pumpernickel | Conjured Black Loaf | item | rename |
| `conjured_bread3` | Conjured Sweet Roll | Conjured Honeycake | item | rename |
| `raw_stonescale_carp` | Raw Stonescale Carp | Raw Slatefin Carp | item | rename |
| `webwood_silk` | Webwood Silk Gland | Sableweb Silk Gland | item | rename |
| `shadowmeld_tunic` | Shadowmeld Tunic | Nightveil Tunic | item | rename |
| `cryptstalker_jerkin` | Cryptstalker Jerkin | Gravestalker Jerkin | item | rename |
| `moonshroud_breastplate` | Moonshroud Breastplate | Moonwrack Breastplate | item | rename |
| `moonshroud_robe` | Moonshroud Robe | Moonwrack Robe | item | rename |
| `moonshroud_tunic` | Moonshroud Tunic | Moonwrack Tunic | item | rename |
| `kingsbane_last_oath` | Kingsbane, Last Oath of Thornpeak | Thronebane, Last Oath of Thornpeak | item | rename |
| `aug_lightwell` | Lightwell | Gravelight | augment | rename |
| `aug_spellfire` | Spellfire | Grimfire | augment | rename |
| `gnarled_staff` | Gnarled Staff | Bogoak Staff | item | rename |
| `recruit_tunic` | Recruit's Tunic | Levyman's Tunic | item | rename |
| `apprentice_robe` | Apprentice's Robe | Threadbare Robe | item | rename |
| `footpad_jerkin` | Footpad's Jerkin | Cutpurse Jerkin | item | rename |

- Assembly fix vs the agent draft: shadowmeld_tunic was proposed "Duskveil Tunic" but Duskveil
  is the rogue `stealth` candidate: replaced with "Nightveil Tunic".
- Draft rejections: "Nightmeld Tunic" (keeps the WoW -meld coinage), "Radiant Font" (Radiant is
  the Dota 2 faction).
- The four starter `generic-keep?` rows are individually dictionary-generic but reproduce the
  WoW level-1 starter kit as an ENSEMBLE with Worn Shortsword; proposals supplied so the
  operator can apply them wholesale or keep.
- Tier sets: OPERATOR DECIDED (2026-07-02) - all 7 rename (rows below). Member item display
  names follow their set word; ids frozen; suffixes (Battlegear/Vestments/Raiment/Regalia/Pelt)
  kept as generic armor words.

| id (frozen) | old | new (LOCKED) | kind | flag |
|---|---|---|---|---|
| `deathlord` | Deathlord Battlegear | Barrowlord Battlegear | set | rename |
| `wyrmshadow` | Wyrmshadow Vestments | Nightfang Vestments | set | rename |
| `necromancers` | Necromancer's Raiment | Mournweave Raiment | set | rename |
| `crownforged` | Crownforged Regalia | Bonewrought Regalia | set | rename |
| `nighttalon` | Nighttalon Pelt | Direfang Pelt | set | rename |
| `soulflame` | Soulflame Regalia | Wraithfire Regalia | set | rename |
| `stormcallers` | Stormcaller's Vestments | Galecall Vestments | set | rename |
- C1 owns: Slimy Murloc Scale, Bristleback Maul, Tallow Candle, Blessed Tallow, the three
  Mogger's items.
- Coverage: 338 items + 7 sets + 20 augments screened; 308 items + 18 augments passed clean.
  Borderline passes recorded for the operator: Minor/Lesser Healing/Mana Potion tiers (genre-
  generic), Elixir of the Bear, Knight-Commander's Greaves, Riptide Dirk, Skullsplitter Dirk,
  Gutripper Shiv, Shadowstitch Jerkin, Crossroads Saber, Korgath's Chainwraps, Brightwood
  Venison, Moonscale Saber, Broodmother's Silk Robe, The Codfather, Cragmaw family; augments
  Juggernaut (Dota hero name; plain English - operator glance), Arcane Surge (modern WoW spell
  name; generic compound - operator glance), Overdrive, Avatar of War, Mending, Ironhide,
  Bounty Hunter, Toughness, Keen Eye. Outside the 8-franchise screen but flagged for awareness:
  "Varric's Shadow Cowl" (Dragon Age companion), "Kazzix's Heartshard" (phonology near WoW
  Kazzak / LoL Kha'Zix; derives from this game's own NPC Shardlord Kazzix).
- Catalog mirrors verified for every flagged row; note the catalog is split across
  `i18n.catalog/items.ts`, `merge.ts`, and `index.ts` - a rename keyed only to items.ts misses
  cryptstalker/stonescale/moonshroud (merge.ts) and kingsbane/augments (index.ts).

---

## Mob mechanic / aura names (W2) - inline `name` + `sim_i18n.ts` matcher

| location (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `bastion_revenant` mortalStrike | Mortal Strike | Maiming Strike | aura | pairing |
| `corrupted_priest_malric` petSpell | Mind Blast | Mindfracture | aura | pairing |
| `korgath_the_bound` stomp | War Stomp | Shuddering Stomp | aura | rename |
| `grubjaw` purgeOnHit | Devour Magic | Spellgnaw | aura | rename |
| `knight_commander_olen` cleave | Cleave | Reaping Arc | aura | pairing |
| `shardlord_kazzix` frostbite | Frostbite | Winterbite | aura | rename |
| `warlord_drogmar` rampage | Battle Fury | Mounting Rage | aura | rename |
| `sister_nhalia` terrify | Banshee's Wail | Keening Wail | aura | rename |

- The four verbatim rows (Mortal Strike, Mind Blast, War Stomp, Devour Magic) are the audit's
  W2 set; the pairing rows take the SAME new name as their V1 ability row by rule. The draft's
  "War Stomp -> Ground Slam" was dropped: `warlord_drogmar` already has an aoePulse named
  "Ground Slam".
- The four `generic-keep?` rows are G1 additions for the operator: Cleave (generic verb),
  Frostbite (WoW mage talent name; also generic English), Battle Fury (verbatim Dota 2 item),
  Banshee's Wail (adjacent to D&D/Diablo "Wail of the Banshee"; banshee is folklore-generic).
- W2 S3 co-location: each renamed inline literal updates its `sim_i18n.ts` matcher entry in the
  same slice, then `tests/localization_fixes.test.ts` runs.

---

## Adversarial IP screen record (ULTRACODE, 2026-07-02)
Every proposed name was screened by its authoring pass, then independently attacked by two
skeptic passes on the four grounds (WoW verbatim; other-franchise collision; own-vocabulary
collision; internal duplicate). 603 names checked. REFUTED and fixed: Reprisal -> Recompense
(FFXIV tank action), Rampart -> Palisade (FFXIV tank action), plus the authoring passes'
earlier rejections (Bulwark Bash, Hallowed Ground, Emberfall, Temptress, Dreadguard, Cinder
Colossus, tunnelrat, Nightmeld, Radiant Font, Radiance, Bloodletting-as-talent, Duskveil
Tunic, Scald/Hobbling Cut duplicates). Internal-duplicate audit: zero violations (all shared
new names are sanctioned same-old mirrors or pairings). Structural verdicts (pet-id
persistence; FLEEING_FAMILIES blast radius) independently re-confirmed with file:line evidence.

**Skeptic WATCH list (borderline, operator eyes at Phase 3; none confidently refutable):**
Grit (FFXIV DRK stance - the strongest watch item), Bloodrush (RS "Blood Rush" spell),
Benison (FFXIV "Divine Benison"), Verdict (WoW "Templar's/Final Verdict" adjacency), Earthen
Fury (WoW "The Earthfury" set), Ruination (LoL event), Red Mist (Dota Axe lore), Fell Shot
("fel" homophone), Cosh (RS minor item), Litany of Woe (GW2 "Litany of Wrath"), Hallowed Wall
(FFXIV "Hallowed Ground"), Cinderling + Voidbound + Spellhound (plausible WoW mob-name
patterns - web-verify before LOCK if possible), Snarl (obscure WoW shield), Bonecrush (RS
"Bonecrusher"), Dread Aspect (D4 "Aspect of X" pattern), Desolation (Dota "Desolator"), Calamity
(FF lore epithet), Vigil (GW2 order), Reaver Strike (Fel Reaver root), Foresight (removed
FFXIV skill), Mudfin ("-fin" WoW murloc tribe pattern; one vowel from WoW Mirefin AND this
game's Mirefen Marsh), Nightveil Tunic (HS "Nightveil Predator"), Gravestalker Jerkin
(one-token swap of WoW Cryptstalker; Grave- crowding - alt "Barrowstalker"), Threadbare Robe,
Keening Wail (ESO artifact "Keening"), Rammok (phonology only). Word-family crowding notes:
Deep-, Sable-, Hallow-, Cinder-, Dusk-, Gloam- clusters (see decision 5 below).

## Operator decisions needed (Phase 3 - resolve each before LOCK)
1. **Every `generic-keep?` row above** (keep the generic word, or apply the supplied candidate):
   abilities - Charge, Rend, Hamstring, Overpower, Execute, Slam, Cleave, Taunt, Whirlwind,
   Scorch, Backstab, Gouge, Evasion, Sprint, Ambush, Stealth, Garrote, Sap, Rupture, Vanish,
   Blind, Smite, Renew, Heal, Fear, Wrath, Thorns, Maul, Growl, Wolf Form, Prowl, Rake, Claw,
   Swipe, Enrage, Bash, Hibernate, Dash, Pounce, Rip (a KEEP on Taunt/Gouge/Sprint/Ambush/
   Wrath/Renew/Whirlwind/Enrage also keeps its paired "Improved <old>" talent row - see the V2
   generic-keep cascade note); items - Gnarled Staff, Recruit's Tunic,
   Apprentice's Robe, Footpad's Jerkin (the starter-kit ensemble); item `blessed_wax` Blessed
   Tallow; auras - Cleave, Frostbite, Battle Fury, Banshee's Wail; the tier-set naming group.
2. **Mogger** (`rename?` rows): keep as deliberate Hogger parody, or rename to Rammok (G1
   recommends rename). If KEEP: flip the rows to generic-keep AND remove 'Mogger' from
   HARDCODED_VERBATIM in tests/ip_scrub.test.ts (a deliberate, operator-authorized scanner edit).
3. **Tunnel Rat Digger escalation:** the live kobold mob display "Tunnel Rat Digger" is
   verbatim-adjacent to WoW's Loch Modan "Tunnel Rat" kobold tribe (the audit had marked it
   original). Options: keep (generic English words) or rename (e.g. "Deeprock Digger").
4. **Fisherman Brandt's greeting** "Grlmurlgrl-" is a WoW murloc-gurgle pastiche the scanner
   cannot catch (suggested reword: "Blrb-glub-"). Keep or reword.
5. **Style-cluster awareness (no action required):** Cinder- (Cinderbolt/Cinder Burst/Cinderling/
   existing Cinderburn aura), Dusk- (Duskveil/Duskfire/Duskmaiden/Duskbound), Gloam-
   (Gloamfire/Gloamveil/Gentle Gloam), Bloodletter mastery vs Bloodletting ability, Quickblood
   mastery vs Quickened Blood ability, Bristleguard talent vs Bristlehide item.
6. **The nine-class roster + product name** stay as-is (locked scope decisions; recorded here
   for completeness).

## Coverage checklist (G1 filled, 2026-07-02)
- [x] All 152 ability names (9 classes), each `rename` or `generic-keep?` (warrior 21, mage 14,
      rogue 21, paladin 13, hunter 14, priest 10, shaman 11, warlock 17, druid 31)
- [x] All 27 spec/tree names + all node/choice/mastery names (234 nodes + 108 choice options +
      27 masteries enumerated; pairing resolved; kept-original names listed per class)
- [x] Creature families + prose + Bristleback/Drakonid/Mogger + Slimy Murloc Scale (+ blast-
      radius manifests for both family ids)
- [x] All 7 warlock pets (display + id), pet-id persistence checked (verdict: coined-id, with
      recorded evidence; NAME-MAP pet-id column corrected from `warlock_*` to the real ids)
- [x] Items/sets/augments: full 365-name screen (21 rename + 4 starter generic-keep? + tier-set
      group + C1-owned rows)
- [x] The 4 verbatim mob-mechanic names (+ 4 G1-added generic-keep? aura rows)
- [x] Operator decisions resolved on every `generic-keep?`, the Mogger parody, Tunnel Rat
      Digger, and the Brandt greeting (locked 2026-07-02)

## Amendment #4 - quest/text/dialogue IP audit (2026-07-02, operator-approved)
Rows the map-driven G0 scanner was blind to (POI labels, dialogue, tooltip prose, quest fields).
Applied on the merged tree at Phase 5 integration; the G0 scanner is extended in the same change
to walk POI labels + encounter/delve dialogue + ability/talent descriptions. Code ids stay FROZEN
(display strings only). Bare-token rows (`Webwood`, `Mistcaller`) arm the epithet so every site -
name, objective label, and prose - is caught by the extended scanner.

### (A) Webwood -> Sableweb (co-named siblings of the already-mapped `webwood_silk` -> Sableweb Silk Gland)
| id | old | new | kind | flag |
|---|---|---|---|---|
| `webwood_spider` | Webwood Lurker | Sableweb Lurker | mob | rename |
| `q_spiders` quest name | Webwood Menace | Sableweb Menace | quest | rename |
| zone1 poi label | Webwood | Sableweb | poi | rename |

- `q_spiders` text: "Cull 6 Webwood Lurkers" -> "Cull 6 Sableweb Lurkers".
- `q_spiders` objective labels: "Webwood Lurker slain" -> "Sableweb Lurker slain"; "Webwood Silk Gland" -> "Sableweb Silk Gland" (matches the already-renamed item display).
- zone1 render comment already reads "Sableweb Matriarch" (theme pre-established; no change).

### (B) Mistcaller -> Fogbinder (verbatim WoW epithet: Mists of Tirna Scithe boss + Kvaldir family)
| id | old | new | kind | flag |
|---|---|---|---|---|
| `vael_the_mistcaller` | Vael the Mistcaller | Vael the Fogbinder | mob | rename |
| `q_mistcaller` quest name | The Mistcaller | The Fogbinder | quest | rename |
| `mistcallers_edge` | Mistcaller's Edge | Fogbinder's Edge | item | rename |
| Mistcaller epithet | Mistcaller | Fogbinder | epithet | rename |

- `q_mistcaller` objective label: "Vael the Mistcaller slain" -> "Vael the Fogbinder slain".
- `q_mistcaller` text + zone2 quest prose (zone2.ts:690,1043,1060,1087): "Mistcaller" -> "Fogbinder" (4 lines).

### (C) Scourge - operator KEEP (no rows armed)
"Nythraxis, Scourge of Thornpeak" (`dungeons.ts`) and "Scourge's End" (`q_nythraxis_scourges_end`)
KEPT: "Scourge of <place>" is the common-noun (affliction) usage, not WoW's standalone proper-noun
faction. Considered and declined, like Mogger/Riptide. Ids unchanged; no scanner entry.

### (D) Shadow Flame -> searing shadow (Blizzard-coined effect in tooltip prose)
| id | old | new | kind | flag |
|---|---|---|---|---|
| `shadowburn` description | Shadow Flame | searing shadow | ability-desc | rename |

- classes.ts:2691 + i18n.catalog/abilities.ts (byte-identical English copies): "blasts the target with Shadow Flame" -> "blasts the target with searing shadow". Ability NAME already renamed (`shadowburn` -> Duskfire, V1). Locale values re-fill at Z1.

### Scanner ruling (Z1 single-word policy, operator-approved 2026-07-02)
The G0 scanner (`tests/ip_scrub.test.ts`) is updated in the same change so it reflects real
coverage with zero residual:
- **Whole-value single-word matching.** Map-derived SINGLE-WORD armed entries (generic combat
  verbs: Charge / Vigor / Frenzy / Maul / Silence / Slam / Pounce / Benediction / Reckoning /
  Precision / Cleave) match only when the WHOLE field value equals them, never as a substring
  token. So locked NEW names (Grim Vigor, Latent Charge, Blackblood Vigor, Cold Reckoning) and
  original mob/item/quest names (Blood Frenzy, Ground Slam, Static Charge, Withered Benediction,
  Brutok's Maul, Drowned Moon Maul, Silence the Call/Choir, Deathstalker Cleave, Miring/Savage
  Pounce, Ravenous/Mirejaw Frenzy, Vile Precision) no longer false-trip. Distinctive HARDCODED
  coinages (Imp / Murloc / Drakonid / Felguard / ...) keep substring matching.
- **Five per-id KEEP exemptions** (Mogger-style: the same string is renamed elsewhere but kept
  here by decision): Weapon Mastery (warrior `arms_tactical_mastery`, rogue
  `combat_weapon_mastery`), Toughness (`aug_toughness`), Stormcaller (wallet
  `holderTiers.stormcaller`), Berserker (fiesta `pow_berserker`).
- **New scan surfaces:** POI/map-point labels (`zones.*.pois.*.label`, name-scan); ability/talent
  tooltip descriptions + encounter/delve dialogue (prose-scan against the PROSE_SCAN set, now
  incl. Shadow Flame). Non-vacuity teeth-tested.
- **Three WoW-adjacent mob names KEPT** by operator (generic/original, whole-value clears them):
  Static Charge, Blood Frenzy, Deathstalker Cleave (mob `deathstalker_voss`).
The scanner is GREEN after this change - the whole IP scrub is verified complete.
