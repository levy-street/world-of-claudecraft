# Warfare Season 2: a spec set for every spec

Status: IMPLEMENTED (2026-09-24). The items are built by `src/sim/content/pvp_honor_season2.ts`,
the set rows live in `src/sim/content/vanguard_item_sets.ts`, and the bonuses in
`src/sim/content/vanguard_set_bonuses*.ts` plus the class combat modules. Where a bonus text
below differs from the shipped tooltip, the tooltip (the set row) is the source of truth.

## What Season 2 is

A new, top tier of honor gear sold beside today's Warfare gear, which stays on sale as the
cheaper entry tier:

- **27 sets, one per spec:** 9 classes, 3 specs each, 5 armor pieces per set (helmet,
  shoulder, chest, legs, gloves), the same five slots and the same 2-piece and 4-piece
  thresholds as every raid set (owner decision). 135 armor items. Waist and feet stay
  entry tier.
- **Four season weapons:** a strength two-hander (the honor shop has none today), a
  strength one-hander, an agility one-hander and a caster staff.
- **Jewelry** stays entry tier: at item level 35 it would out-stat the badge jewelry.
- **Item level 35:** source level 29 plus the epic bump of 6. That is level with the Ignivar
  raid tier.
- **Bonuses:** each set has a 2-piece and a 4-piece bonus that work everywhere, PvE included
  (owner decision).

## WoW reference, and the shape we take

- **Dragonflight-era tier sets:** a 2-piece and a 4-piece bonus per spec. The 2-piece bends
  a core ability, and the 4-piece is a signature effect that builds on it.
- **Gladiator-era PvP sets:** the 4-piece was class utility, for example "Intercept
  cooldown reduced by 5 sec".

Season 2 combines the two. **Every 2-piece bonus is PvP utility, and every 4-piece builds on
its own 2-piece.** The 2-piece bends a mobility, control or defensive button. The 4-piece
adds a follow-up that fires off that button.

## The PvE promise: never better than the raid tier in raids

The owner's two rules are that honor gear is never the raid pick, and that bonuses work
everywhere. These rules hold them together:

- **Stats:**
  - Each piece's stat line is 0.9 of its item-level-35 line budget (the honor discount),
    with no hit, crit or haste rating.
  - Stamina is the full-budget stamina floor (`staminaBaseline` of the undiscounted budget),
    so every piece meets the same floor as any item-level-35 epic, and no more: Vitality,
    not stamina, is where honor gear's PvP health comes from.
  - Physical pieces spend the rest of the line on their primary stat. Caster pieces spend the
    whole line on intellect and spirit, with the stamina floor on top (the caster premium).
- **Armor:** 0.9 of the mean armor of same-slot, same-armor-type item-level-35 raid epics.
- **Tanks, measured:** each tank set, with entry-tier waist and feet (what an honor-geared
  tank actually wears), stood inside an instance, where Vitality is off, and compared on
  effective health against raid best-in-slot.
  - A prototype at a 45 percent stamina share measured prot warrior 0.74 times, prot paladin
    0.74 times, and feral in bear form 0.91 times. The shipped floor rule carries less
    stamina than that prototype, so every figure is lower.
  - At the entry tier's 58 percent share a full honor feral kit measured 1.01 times, which is
    why Season 2 does not copy the entry tier's stamina premium.
  - `tests/warfare_season2.test.ts` ("the PvE promise") pins all three below raid
    best-in-slot.
- **Mixed loadouts:** Season 2 and raid sets share the same five slots, so a raid 4-piece
  leaves one slot and cannot be paired with any Season 2 bonus. The only mix is a raid
  2-piece plus a Season 2 2-piece. Therefore:
  - every Season 2 **2-piece** is weaker in PvE than the same spec's raid 4-piece, so the
    mix never beats the full raid set (the 2-pieces below are PvP utility, near zero in PvE);
  - every **4-piece** is sized below the same spec's raid 4-piece;
  - where a Season 2 bonus touches a number a raid bonus also bends, the two combine as the
    larger value, never added.
- **No spell-pushback immunity on any honor set.** Every caster raid 2-piece carries it, and
  it would be the strongest PvP rider of all.
- **WARFARE ratings (rebalanced 2026-09-25, owner rule "make Season 2 better than Season
  1"):** a full Season 1 kit reaches every Warfare cap through its 4-piece and 7-piece
  bonuses (+200 rating), and Season 2's ability bonuses carry no rating, so at 1x the slot
  budget a Season 2 kit fell short of Season 1 in PvP (about 13 percent less health, 19 and
  23 percent Offense and Defense). The pieces now carry the rating instead:
  - Offense is 2.2x and Defense 3.4x the slot budget (`SEASON2_OFFENSE_RATING_MULT`,
    `SEASON2_DEFENSE_RATING_MULT`). A Season 2 kit (the five pieces plus entry-tier waist,
    feet, jewelry and weapon) reaches the 30 percent Offense and Defense caps.
  - The Vitality cap rose from +50 to +80 percent (`PVP_VITALITY_CAP`). A full Season 1 kit
    still lands at about +50 percent (302 rating); a Season 2 kit reaches +80.
  - Measured at level 20 on the Sim: Season 2 carries 9 to 10 percent more maximum health in
    PvP than a full Season 1 kit for physical specs and about 14 percent for casters (whose
    Season 1 pieces carry only half the stamina premium). None of it applies in dungeons or
    raids, where Vitality is off and Warfare never touches PvE, so the tank guard is
    unchanged. `tests/warfare_season2.test.ts` ("the PvP promise") pins the caps and a
    health floor over Season 1.

## Prices and stock

- **Armor, per slot, 1.5 times the entry tier:**

  | Slot | Honor |
  |---|---|
  | Helmet | 1,350 |
  | Shoulder | 1,050 |
  | Chest | 1,800 |
  | Legs | 1,575 |
  | Gloves | 825 |

  A full set costs 6,600 Honor.
- **Weapons:** 1,800 Honor each.
- **Where it is sold:** both honor quartermasters (FURY in Eastbrook Vale, Warmarshal Draven
  Kole in Highwatch). The shop lists a Season 2 group first: the viewer's own three spec
  sets (the sets are class-locked, so the shop shows only what the viewer can wear), then the
  season weapons the viewer can wield. The entry tier follows as its own group, unfiltered.
- **Art:** the four weapons ship painted icons (the `warfare-season2-weapons-2026-09-25`
  batch in `public/ui/items/mapping.json`) and held models on shipped GLBs. The 135 armor
  pieces sit on `ITEM_ART_PENDING` (pinned in `tests/item_icons.test.ts`) and draw their
  procedural icon until a follow-up art pass paints them.
- **Ids:** sets use a new prefix, `vanguard_<spec>`, so the existing `warfare_*` pins keep
  meaning the entry tier.

## Decisions for the owner

1. **Other specs of the same class get some bonuses.** Several bonuses bend abilities any spec
   of the class can learn: Unleash Weapon, Icebind, Flitstep, Harrow, Bruin Rush, Gripping
   Roots, Fleetmend, Bone Armor and a few others.
   - The item model has no spec lock, so an off-spec wearer still gets the row.
   - **Recommendation: accept it.** The bonuses are PvP utility, the sets are class-locked,
     and a spec lock would be new item-model plumbing.
2. **2-piece bonuses are PvP utility, not PvE throughput.** With the raid slots shared, the
   only mix is raid 2-piece plus Season 2 2-piece, so a 2-piece could carry some PvE value
   as long as it stays below the raid 4-piece. The drafts keep them PvP utility; say if you
   want some to carry PvE damage or healing instead.
3. **Names:** all 27 set names and 135 item names below are proposals. Rename freely.

## To verify during implementation

- Fury: can the Mayhem Enrage be granted as a plain aura response? Otherwise it needs a
  bespoke grant.
- Shadow: can a slow ride the Litany of Woe channel?
- Protection paladin: the guaranteed Solar Reprisal grant from Oath Chain needs a forced-grant
  arm with no rng roll.
- Arcane: does movement read a `buff_speed` aura that another player placed on you?
- Fire: does Cinderfall's charge recharge use the reduced cooldown?
- Destruction: the instant Ruinbolt must consume cleanly with Desolation.
- Every bonus gets a decisive test (the bonus works at its tier, and not below it) and tooltip
  copy per `docs/design/tooltip-writing.md`.

## Revision 2026-09-25: PvP feedback and the crowd-control audit

Playtest feedback (Oath Chain's pull plus kick, speed after a cast, two thin bonuses) and an
owner-requested audit of every cooldown cut on a crowd-control ability. Player stuns carry no
PvP diminishing returns in this game (`src/sim/stun_dr.ts`), so a stun cooldown cut is pure
extra stun time. The per-spec sections below keep the original drafts; these rows supersede
them, and the shipped tooltip text is the source of truth.

| Set | Tier | Was | Now | Why |
|---|---|---|---|---|
| Arms | 2pc | Maiming Strike refunds 2 sec of Onrush | refunds 1 sec | Onrush stuns; 25 percent effective cut became about 14 |
| Protection warrior | 4pc | Shieldcrack refunds 1 sec of Faultline | Faultline also reduces damage taken by 10 percent for 6 sec | AoE stun with no diminishing returns |
| Protection paladin | 2pc | Oath Chain -4 sec | -2 sec | Pull plus the new 4pc |
| Protection paladin | 4pc | Oath Chain interrupts and locks the school for 3 sec | Pulled enemies cast 30 percent slower for 4 sec (Solar Reprisal kept) | A pull plus a kick in one button |
| Assassination | 2pc | Low Blow -4 sec | Low Blow costs 10 less Energy | Stun uptime 30 to 37.5 percent with no diminishing returns |
| Discipline | 2pc | Terror Canticle -6 sec | -3 sec | AoE fear; stacked with Lingering Dread it reached 15 sec |
| Discipline | 4pc | Shield consumed refunds 4 sec of Terror Canticle | The shielded ally gains 20 percent speed for 3 sec (8 sec icd) | About a 10 sec AoE fear |
| Elemental | 4pc | Unleash Weapon +30 percent speed for 3 sec | Cast while moving and +20 percent speed for 4 sec (20 sec icd) | Speed after a 30 yd cast read oddly |
| Balance | 4pc | Gripping Roots +30 percent speed for 4 sec | Same shape as Elemental (20 sec icd) | Same reason |
| Restoration shaman | 2pc | Mending Waters -0.2 sec | -0.5 sec on an ally below 50 percent health | 0.2 of a 2.25 sec cast was unfelt |
| Affliction | 4pc | Sentence heals 4 percent of max health | Consume heals 30 percent more and channels while moving | Too thin for the setup Sentence takes |

`tests/warfare_season2.test.ts` ("the crowd-control promise") now caps every Season 2 cut to a
stun, fear, root, incapacitate, pull, interrupt or knockback cooldown at 20 percent, counting
cast-triggered refunds at their trigger's own cooldown. The highest left: Bruin Rush (20),
Faultline (17), Onrush (about 14). Oath Chain's cast slow reads only on player casts, so it
does nothing to mobs; it is a PvP bonus by design.

## The 27 sets

Each spec lists its set and item names, the 2-piece and 4-piece text, the implementation
route, and the PvE ceiling: the raid set bonus it sits under.

Implementation routes:
- **DATA:** a generic `AbilityModEffect` row or a `ProcDef` (see `src/sim/content/talents.ts`).
- **BESPOKE:** a `wearsSetBonus` hook in the class's combat module.
- **castNth refund:** a `ProcDef` that fires when the named ability is cast and refunds another
  ability's cooldown. It draws no rng.

## Warrior (mail)

### Arms (`arms`, signature Maiming Strike `mortal_strike`)
- **Set:** Bladewake Battlegear. Bladewake Greathelm, Bladewake Pauldrons, Bladewake Hauberk, Bladewake Legplates, Bladewake Crushers (gloves).
- **2pc:** "Maiming Strike reduces Onrush's remaining cooldown by 2 sec."
  Route: DATA, castNth refund `{ on: 'castNth', n: 1, abilities: ['mortal_strike'] }` to
  `{ kind: 'cooldownRefund', ability: 'charge', seconds: 2 }`. Onrush base 15 sec, MS
  6 sec, so roughly 11 sec effective Onrush in a sustained fight.
- **4pc:** "Onrush also empowers your next Maiming Strike by 20 percent (one stack of
  Redhand's empower)."
  Route: DATA, ability row `{ ability: 'charge', addEffects: [{ type: 'selfBuff', kind:
  'overpower_charge', value: 0.2, duration: 15 }] }`, the exact Redhand row
  (`overpower`), so it shares the 2-stack cap and the consume in effect_dispatch.ts.
- **PvE ceiling:** Slagbreaker 2pc (Redhand empower 20 to 30 percent per stack) and 4pc
  (every second Redhand refunds Breachmaker 3 sec). Onrush needs 8 to 25 yd range, so
  on a melee boss it is near-unusable after the opener: the 2pc is inert and the 4pc
  is one empowered Maiming Strike per pull. The cap stays 2 stacks, so it cannot exceed
  what Redhand already provides.

### Fury (`fury`, signature Bloodletting `bloodthirst`)
- **Set:** Bloodmarch Ragegear. Bloodmarch Visage, Bloodmarch Shoulderguards, Bloodmarch Chainmail, Bloodmarch Leggings, Bloodmarch Grips.
- **2pc:** "Vaulting Charge's cooldown is reduced by 8 sec."
  Route: DATA, ability row `{ ability: 'heroic_leap', cooldownFlat: -8 }` (30 to 22 sec).
- **4pc:** "Landing Vaulting Charge Enrages you."
  Route: preferred DATA, castNth on `heroic_leap` with an `aura` response if the Mayhem
  Enrage (`enrage_passive`) is a plain AuraKind; otherwise BESPOKE, a flag-gated call of
  the existing Enrage grant from the Vaulting Charge landing in the warrior combat path
  (the same grant Red Harvest uses, `src/sim/combat/warrior_harvest.ts`). Enrage is 4 sec
  (6 with Emberfury 2pc): +7 percent damage, +25 percent attack speed, +10 percent
  movement speed.
- **PvE ceiling:** Emberfury 2pc (Enrage 4 to 6 sec) and 4pc (Bloodletting always
  Enrages, heals 8 percent max health; exactly 100 percent Enrage uptime with the 2pc).
  Fury already sits near full Enrage uptime from Red Harvest (always Enrages) plus
  Bloodletting's 30 percent, so one extra Enrage every 22 sec adds single-digit uptime
  and nothing at all on top of Emberfury 4pc. Well under the raid 4pc.

### Protection (`prot`, signature Shieldcrack `shield_slam`)
- **Set:** Ironmarch Bulwark. Ironmarch Helm, Ironmarch Spaulders, Ironmarch Chestguard, Ironmarch Legguards, Ironmarch Handguards.
- **2pc:** "Faultline's cooldown is reduced by 5 sec."
  Route: DATA, ability row `{ ability: 'faultline', cooldownFlat: -5 }` (30 to 25 sec,
  3 sec frontal stun).
- **4pc:** "Shieldcrack reduces Faultline's remaining cooldown by 1 sec."
  Route: DATA, castNth refund on `shield_slam` (n 1) to `faultline`, 1 sec. With
  Shieldcrack every 6 sec, effective Faultline about 21 sec.
- **PvE ceiling:** Forgewall 2pc (Iron Resolve 5 absorb per rage, +25 percent) and 4pc
  (Shieldcrack refunds Iron Resolve 2 sec). Season 2 touches only a stun that bosses
  ignore; Faultline's damage is a minor share. Zero mitigation, so it cannot compete
  with Forgewall's absorb economy; it is trash-pack control only.

---

## Paladin (mail)

### Holy (`holy`, signature Mercy Lance `mercy_lance`)
- **Set:** Sunvigil Regalia. Sunvigil Circlet, Sunvigil Mantle, Sunvigil Hauberk, Sunvigil Legmail, Sunvigil Gloves.
- **2pc:** "Life Covenant's cooldown is reduced by 30 sec."
  Route: DATA, ability row `{ ability: 'life_covenant', cooldownFlat: -30 }` (90 to
  60 sec; 40 percent damage reduction for 6 sec on an ally).
- **4pc:** "Life Covenant also shields the ally for 8 percent of their maximum health
  for 6 sec."
  Route: DATA, ProcDef `{ on: 'castNth', n: 1, abilities: ['life_covenant'] }` with
  `{ kind: 'absorb', amountPctMaxHp: 0.08, duration: 6, name: <Life Covenant string> }`
  (no `target: 'self'`, so it lands on the triggering cast's target, the ally). Reuse
  the localized ability name so no new sim_i18n row is needed (the Emberscreed 4pc
  precedent).
- **PvE ceiling:** Dawnforged 2pc (Beacon of Light copies 55 percent, plus the pushback
  rider) and 4pc (Radiant Resonance's empowered Dawn's Embrace is instant). The raid
  set lifts every-GCD healing; Season 2 is one external every 60 sec plus a one-shot
  8 percent absorb, which is a small fraction of a raid healer's output. Deliberately
  NO pushback rider (it would be a large PvP-only-feeling freebie and it also stacks on
  the raid 2pc's rider for nothing).

### Protection (`protection`, signature Sunward Disc `sunward_disc`)
- **Set:** Shieldvow Bastion. Shieldvow Helm, Shieldvow Pauldrons, Shieldvow Breastplate, Shieldvow Legplates, Shieldvow Gauntlets.
- **2pc:** "Oath Chain's cooldown is reduced by 4 sec."
  Route: DATA, ability row `{ ability: 'oath_chain', cooldownFlat: -4 }` (18 to 14 sec).
- **4pc:** "Oath Chain also interrupts spellcasting, locking that school for 3 sec, and
  grants you Solar Reprisal."
  Route: interrupt is DATA, ability row `{ ability: 'oath_chain', addEffects: [{ type:
  'interrupt', lockout: 3 }] }` (the `hushbrand` effect shape). The Solar Reprisal grant
  is BESPOKE: a flag-gated guaranteed call into `tryGrantSolarReprisal`
  (`src/sim/combat/paladin_solar_reprisal.ts`) from the Oath Chain hit path, with a new
  forced-grant arm so no rng roll is added.
- **PvE ceiling:** Oathpyre 2pc (Solar Reprisal arm 30 percent from Vowkeeper Strike,
  40 percent from blocks) and 4pc (consuming Solar Reprisal shields 6 percent max health
  for 10 sec). Season 2 adds at most one Solar Reprisal per 14 sec and only when there
  is something to chain (bosses are not pulled); the raid 2pc arms it several times per
  14 sec off every Vowkeeper Strike and block. Interrupt is trash-only value. If worn
  with Oathpyre 4pc the extra Reprisal also feeds its shield, still well below the
  Oathpyre 2pc's rate.

### Retribution (`retribution`, signature Final Edict `final_edict`)
- **Set:** Lightbrand Warplate. Lightbrand Crown, Lightbrand Spaulders, Lightbrand Cuirass, Lightbrand Legguards, Lightbrand Gauntlets.
- **2pc:** "Valkyr's Calling's cooldown is reduced by 15 sec."
  Route: DATA, ability row `{ ability: 'valkyrs_calling', cooldownFlat: -15 }` (60 to
  45 sec; gap-closer with damage immunity in flight).
- **4pc:** "Valkyr's Calling resets Final Edict's cooldown, and your next Final Edict
  within 6 sec deals 15 percent more damage."
  Route: reset is DATA, castNth `['valkyrs_calling']` n 1 to `{ kind: 'cooldownRefund',
  ability: 'final_edict', seconds: 'reset' }` (the Vesperash 4pc shape). The +15 percent
  is BESPOKE: a flag-gated one-shot aura granted at the Valkyr's Calling landing and
  consumed in the Final Edict weaponStrike path (the Redhand consume pattern in
  effect_dispatch.ts).
- **PvE ceiling:** Zealfire 2pc (Final Edict and Dawnfall cut each other 3 sec instead
  of 2) and 4pc (Hammer of Wrath under Dawn's Wrath 40 percent, up from 20). Season 2
  gives one reset plus one +15 percent Final Edict per 45 sec, about 2 percent of Ret
  damage at most; Zealfire 2pc alone raises the whole Final Edict/Dawnfall cadence.

---

## Hunter (leather)

### Beast Mastery (`beast_mastery`, signature Howling Rage `bestial_wrath`)
- **Set:** Packwarden Harness. Packwarden Coif, Packwarden Spaulders, Packwarden Jerkin, Packwarden Legguards, Packwarden Gauntlets.
- **2pc:** "Rattling Shot's cooldown is reduced by 4 sec."
  Route: DATA, ability row `{ ability: 'concussive_shot', cooldownFlat: -4 }` (12 to 8 sec;
  50 percent slow for 4 sec, so near-permanent kite pressure on one target).
- **4pc:** "Rattling Shot reduces Howling Rage's remaining cooldown by 1 sec."
  Route: DATA, castNth refund on `concussive_shot` (n 1) to `bestial_wrath`, 1 sec. At
  one Rattling Shot per 8 sec, Howling Rage goes 90 to about 80 sec (+12.5 percent casts).
- **PvE ceiling:** Packlord 2pc (Pack Command 4 to 3 sec, about +13 percent Unleash
  cadence) and 4pc (Stampede reset chance 20 to 30 percent, about +21 percent resets).
  Season 2's burst gain is about +12.5 percent Howling Rage casts and it COSTS 20 Focus
  plus a GCD per Rattling Shot that would otherwise go to Pack Command or Fell Shot, so
  net it sits well below the Packlord 4pc. Keep the refund at 1 sec: at 2 sec the
  cadence gain (+25 percent) would approach the raid set.

### Marksmanship (`marksmanship`, signature Cold Focus `cold_focus`)
- **Set:** Farsight Harness. Farsight Coif, Farsight Spaulders, Farsight Jerkin, Farsight Legguards, Farsight Gauntlets.
- **2pc:** "Trailbreak's cooldown is reduced by 4 sec."
  Route: DATA, ability row `{ ability: 'trailbreak', cooldownFlat: -4 }` (15 to 11 sec,
  12 yd backward leap).
- **4pc:** "Trailbreak makes your next Long Draw within 6 sec instant. Cannot occur more
  than once every 15 sec."
  Route: DATA, ProcDef `{ on: 'castNth', n: 1, abilities: ['trailbreak'], icd: 15 }`
  with `{ kind: 'empowerNext', aura: 'next_cast_instant', abilities: ['aimed_shot'],
  duration: 6 }`. Turns the disengage into a shoot-while-repositioning window.
- **PvE ceiling:** Coldsight 2pc (Measured Shot +5 Focus) and 4pc (Long Draw crits
  extend Cold Focus 2 sec, up to 6 per window, about +33 percent window). One instant
  2 sec Long Draw per 15 sec saves at most 0.5 sec of cast time past the GCD, about
  3 percent casting time, and only if the hunter leaps backward on cooldown in a raid.
  Below the Coldsight 4pc. The 15 sec icd is load-bearing: without it the 11 sec 2pc
  cooldown would lift the PvE value toward 5 percent.

### Survival (`survival`, signature Bloodhook `bloodhook`)
- **Set:** Snaretooth Harness. Snaretooth Coif, Snaretooth Spaulders, Snaretooth Jerkin, Snaretooth Legguards, Snaretooth Gauntlets.
- **2pc:** "Bloodhook's cooldown is reduced by 3 sec."
  Route: DATA, ability row `{ ability: 'bloodhook', cooldownFlat: -3 }` (15 to 12 sec;
  Bloodhook is the spec's charge-in gap closer).
- **4pc:** "Bloodhook grants 1 Hunting Momentum."
  Route: BESPOKE, a flag-gated call of the existing Hunting Momentum grant (the one
  Gutting Strike `raptor_strike` uses, same 8 sec duration and 3 stack cap) from the
  Bloodhook landing in `src/sim/combat/hunter_fieldcraft.ts`. Draws no rng.
- **PvE ceiling:** Slagsnare 2pc (Gutting Strike 15 to 20 Focus) and 4pc (a Woundrend
  that consumes 3 Momentum preserves them, once per 8 sec). Bloodhook's wound is
  already kept up by Woundrend refreshes, so the shorter cooldown adds almost no DPS;
  the 4pc saves one Gutting Strike's worth of Momentum per 12 sec (the builder still
  has to be pressed for Focus), a low single-digit gain, below Slagsnare 4pc's stack
  preservation.

---

## Rogue (leather)

### Assassination (`assassination`, signature Killer's Calm `cold_blood`)
- **Set:** Nightcut Leathers. Nightcut Hood, Nightcut Shoulderpads, Nightcut Tunic, Nightcut Breeches, Nightcut Gloves.
- **2pc:** "Low Blow's cooldown is reduced by 4 sec."
  Route: DATA, ability row `{ ability: 'kidney_shot', cooldownFlat: -4 }` (20 to 16 sec;
  finisher stun 1 sec plus 1 per combo point).
- **4pc:** "Low Blow also makes your next attack within 6 sec a critical strike."
  Route: DATA, ability row `{ ability: 'kidney_shot', addEffects: [{ type: 'selfBuff',
  kind: 'next_attack_crit', value: 1, duration: 6 }] }`, the exact Killer's Calm row
  (`cold_blood`) with a 6 sec window, so the consume path is already live.
- **PvE ceiling:** Cinderfang 2pc (Venom Ritual refund 15 to 20 energy per builder) and
  4pc (Venom Dart 8 to 4 sec, about +20 percent finisher cadence). Bosses ignore the
  stun, so a PvE Low Blow is a 25 energy finisher that deals no damage; spending a
  1 point Low Blow every 16 sec to force one Craven Thrust crit nets roughly 1 percent
  after its energy and GCD cost. Far below Cinderfang 4pc.

### Combat (`combat`, signature Mirrored Blades `blade_flurry`)
- **Set:** Brawlmark Leathers. Brawlmark Hood, Brawlmark Shoulderpads, Brawlmark Tunic, Brawlmark Breeches, Brawlmark Gloves.
- **2pc:** "Swift Heels' cooldown is reduced by 60 sec."
  Route: DATA, ability row `{ ability: 'sprint', cooldownFlat: -60 }` (300 to 240 sec;
  70 percent speed for 15 sec). The Gladiator-era rogue sprint bonus.
- **4pc:** "While Swift Heels is active, Wicked Slash and Haymaker award 1 additional
  combo point."
  Route: BESPOKE, flag-gated combo award bend at the builder award site in
  `src/sim/combat/rogue_engines.ts`, read on `sinister_strike` and its Redline transform
  `body_blow`, gated on the wearer holding the `sprint` buff_speed aura. Draws no rng.
- **PvE ceiling:** Smolderstrike 2pc (Haymaker +20 percent, delivered +17.2) and 4pc
  (Lights Out refunds Mirrored Blades 6 sec, effective cooldown about 89 sec). A 15 sec
  window every 240 sec is about 6 percent uptime of faster finishers, under 1 percent
  DPS, and the 2pc is pure mobility. Far below both raid bonuses.

### Subtlety (`subtlety`, signature Red Ribbon `hemorrhage`)
- **Set:** Shadewalk Leathers. Shadewalk Hood, Shadewalk Shoulderpads, Shadewalk Tunic, Shadewalk Breeches, Shadewalk Gloves.
- **2pc:** "Smokefade's cooldown is reduced by 60 sec."
  Route: DATA, ability row `{ ability: 'vanish', cooldownFlat: -60 }` (300 to 240 sec).
- **4pc:** "Smokefade no longer slows your movement, and a Gut Punch from Smokefade
  awards 2 additional combo points."
  Route: BESPOKE, two flag-gated bends: bake value 1 into the Smokefade stealth aura at
  grant (its `selfBuff` `stealth` row carries 0.5, the slow) for wearers, and +2 on the
  `cheap_shot` combo award when it breaks a Smokefade-sourced stealth. Draws no rng.
- **PvE ceiling:** Ashveil 2pc (Lurker's Strike +25 percent, delivered about +20) and
  4pc (Veiled Edge strike triples, up from double). One extra Smokefade opener per
  20 minutes of combat and 2 combo points every 240 sec is noise on a boss; the bonuses
  deliberately do NOT touch Lurker's Strike or Veiled Edge, so they cannot compound
  with Ashveil when mixed.

---

## Priest (cloth)

### Discipline (`discipline`, signature Scouring Mercy `scouring_mercy`)
- **Set:** Veilpsalm Raiment. Veilpsalm Cowl, Veilpsalm Mantle, Veilpsalm Robe, Veilpsalm Leggings, Veilpsalm Handwraps.
- **2pc:** "Terror Canticle's cooldown is reduced by 6 sec."
  Route: DATA, ability row `{ ability: 'psychic_scream', cooldownFlat: -6 }` (30 to 24 sec).
- **4pc:** "When your Psalm of Warding is fully consumed, Terror Canticle's remaining
  cooldown is reduced by 4 sec. Cannot occur more than once every 8 sec."
  Route: DATA, ProcDef `{ on: 'shieldConsumed', ability: 'power_word_shield', icd: 8 }`
  with `{ kind: 'cooldownRefund', ability: 'psychic_scream', seconds: 4 }` (the
  Emberscreed 4pc trigger and its shipped icd extension). A wearer of both Emberscreed
  4pc and this 4pc hangs two procs off one consume; distinct proc ids, both fire.
- **PvE ceiling:** Emberscreed 2pc (Doctrine link converts 10 percent more) and 4pc
  (a fully consumed Psalm makes the next Scouring Hymn instant, once per 15 sec). Fear
  does nothing on bosses, so Season 2 contributes zero PvE healing or damage.

### Holy (`holy`, signature Seraphic Vigil `seraphic_vigil`)
- **Set:** Gracewing Raiment. Gracewing Cowl, Gracewing Mantle, Gracewing Robe, Gracewing Leggings, Gracewing Handwraps.
- **2pc:** "Veilstep's cooldown is reduced by 6 sec."
  Route: DATA, ability row `{ ability: 'veilstep', cooldownFlat: -6 }` (18 to 12 sec;
  10 yd forward step).
- **4pc:** "Veilstep also shields you for 8 percent of your maximum health for 6 sec."
  Route: DATA, ProcDef `{ on: 'castNth', n: 1, abilities: ['veilstep'] }` with
  `{ kind: 'absorb', amountPctMaxHp: 0.08, duration: 6, name: <Veilstep string>,
  target: 'self' }`.
- **PvE ceiling:** Benison 2pc (Seraphic Vigil rescue 180 to 270) and 4pc (a triggered
  Vigil also mends its ally for 15 percent max health over 10 sec). Season 2 heals
  nobody but the priest and adds no throughput. Deliberately not Seraphic Vigil's
  cooldown: that would stack on the Benison 4pc's per-trigger HoT in a mixed loadout.

### Shadow (`shadow`, signature Call Tithefiend `summon_tithefiend`)
- **Set:** Duskhymn Regalia. Duskhymn Cowl, Duskhymn Mantle, Duskhymn Robe, Duskhymn Leggings, Duskhymn Handwraps.
- **2pc:** "Litany of Woe also slows the target's movement by 30 percent while you
  channel it."
  Route: preferred DATA, ability row `{ ability: 'mind_flay', addEffects: [{ type: 'slow',
  mult: 0.7, duration: 1 }] }` (the `hamstring` slow shape) IF the channel dispatch
  applies non-tick rows on each tick; otherwise BESPOKE, a flag-gated slow refresh per
  `drainTick` in the channel path. Classic Mind Flay flavour. Shipped BESPOKE: the
  channel never applies non-tick rows, so `priest/vespers.ts` applies the slow for the
  channel's length at channel start and strips it when the channel ends (completion,
  cancel, pushback or the priest's death).
- **4pc:** "Call Tithefiend also shields you for 10 percent of your maximum health for
  8 sec."
  Route: DATA, ProcDef `{ on: 'castNth', n: 1, abilities: ['summon_tithefiend'] }` with
  `{ kind: 'absorb', amountPctMaxHp: 0.1, duration: 8, name: <Call Tithefiend string>,
  target: 'self' }`.
- **PvE ceiling:** Vesperash 2pc (Call Tithefiend 30 to 24 sec) and 4pc (Tithefiend
  resets Mindfracture, doubles its mana return). A slow is inert on bosses and a self
  shield every 24 to 30 sec is survivability only: zero damage, even mixed with the
  Vesperash 2pc's shorter cooldown.

---

---

## Shaman (mail)

### Elemental (`elemental`, Thundercall, dps)
**Set:** Tempestwrit Battlemail
**Items:** Tempestwrit Coif (helmet), Tempestwrit Pauldrons (shoulder), Tempestwrit Hauberk (chest), Tempestwrit Legmail (legs), Tempestwrit Gauntlets (gloves)

- **2pc:** "Unleash Weapon's cooldown is reduced by 3 sec." (`unleash_weapon`, 15 to 12 sec)
  - Route: DATA. `{ ability: 'unleash_weapon', cooldownFlat: -3 }`.
- **4pc:** "Unleash Weapon also increases your movement speed by 30 percent for 3 sec."
  - Route: DATA. `{ ability: 'unleash_weapon', addEffects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 3 }] }` (the Scald rider shape, `scorch`).
  - PvP read: a reposition burst every 12 sec that also feeds Thunder on Pyrebrand.
- **PvE ceiling:** Stormkindled Regalia. Its 2pc raises Pyrebrand Unleash to 3 Thunder
  per 15 sec (0.20 Thunder per sec) plus spell pushback immunity; ours keeps 2 Thunder
  but every 12 sec (0.167 per sec), strictly below it, with no pushback rider. Its 4pc
  lifts the full Earthen Jolt vent 2.25x to 2.5x; ours is a movement buff with zero
  damage. Note: `unleash_weapon` is class-shared, so a non-Pyrebrand wearer gets the
  cooldown too (see cross-cutting note 1).

### Enhancement (`enhancement`, Warspirit, melee dps)
**Set:** Galeborn Warmail
**Items:** Galeborn Helm, Galeborn Spaulders, Galeborn Chainmail, Galeborn Legguards, Galeborn Grips

- **2pc:** "Ancestral Strike slows the target's movement speed by 30 percent for 4 sec." (`stormstrike`, 12 sec cooldown)
  - Route: DATA. `{ ability: 'stormstrike', addEffects: [{ type: 'slow', mult: 0.7, duration: 4 }] }` (Radiant Shackles precedent).
- **4pc:** "Ancestral Strike reduces the remaining cooldown of Elemental Trance by 4 sec." (`elemental_trance`, 30 percent damage reduction for 15 sec, 120 sec cooldown)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['stormstrike'] }`, `responses: [{ kind: 'cooldownRefund', ability: 'elemental_trance', seconds: 4 }]`.
  - Resolved: about 1 Ancestral Strike per 12 sec, so Trance comes back about every
    90 sec instead of 120 (Stormsurge resets add a little more; disclose).
- **PvE ceiling:** Warspirit Emberscale (2pc: Ancestral Strike advances cadence 3
  steps; 4pc: Ancestral Strike hits 30 percent harder). Ours adds zero damage: a slow
  (bosses largely ignore it) and more uptime on a defensive. Stonehearth Bastion
  (the Stonebound tank set) is also stronger defensively (3 percent max health per
  cadence completion, roughly 1 percent per sec).

### Restoration (`restoration`, Spiritcall, healer)
**Set:** Brineward Chainmail
**Items:** Brineward Circlet, Brineward Mantle, Brineward Hauberk, Brineward Kilt, Brineward Handwraps

- **2pc:** "Mending Waters' cast time is reduced by 0.2 sec." (`healing_wave`, 1.5 to 1.3 sec)
  - Route: DATA. `{ ability: 'healing_wave', castPct: -0.1333 }` (resolves 1.3 sec; round in tooltip from the resolved def).
- **4pc:** "Tidecall also shields its target for 5 percent of your maximum health for 6 sec." (`tidecall`, 2 charges, 12 sec recharge)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['tidecall'] }`, `responses: [{ kind: 'absorb', amountPctMaxHp: 0.05, duration: 6, name: 'Brineward Shield' }]` (no `target`, so it lands on the healed ally, the trigger subject).
  - PvP read: a faster hard cast under pressure plus instant burst absorb on the
    emergency button.
- **PvE ceiling:** Springmender Scale (2pc: Tidecall cooldown 12 to 8 sec, +50 percent
  Tidecall throughput, plus pushback immunity; 4pc: Cascading Mend reaches a fourth
  ally and harvests at 150 percent). Ours: +15 percent Mending Waters cast rate, which
  is mana-bound in raid, and a small absorb (about 5 percent of the shaman's health
  per Tidecall, roughly 0.8 percent max health per sec at full charge use) against a
  +50 percent spell and a whole extra chain hop.

---

## Mage (cloth)

### Arcane (`arcane`, Chronomancy, HEALER)
**Set:** Hourbinder's Vestments
**Items:** Hourbinder's Hood, Hourbinder's Amice, Hourbinder's Robe, Hourbinder's Trousers, Hourbinder's Gloves

- **2pc:** "Temporal Barrier's cooldown is reduced by 2 sec." (`temporal_barrier`, absorb for 10 sec, 12 to 10 sec)
  - Route: DATA. `{ ability: 'temporal_barrier', cooldownFlat: -2 }`.
- **4pc:** "Temporal Barrier also increases the shielded target's movement speed by 20 percent for 3 sec."
  - Route: DATA if the buffTarget arm carries `buff_speed` to movement (buffTarget
    applies a generic aura by kind in combat/effect_dispatch.ts; `buff_speed` is live as a selfBuff and in augments.ts).
    `{ ability: 'temporal_barrier', addEffects: [{ type: 'buffTarget', kind: 'buff_speed', value: 1.2, duration: 3 }] }`.
    Verify movement reads a `buff_speed` aura regardless of source; if not, bespoke at the same site.
  - Does not overlap Shifting Ward (`mag_r8_temporal_rift`, root break on self-cast barrier).
- **PvE ceiling:** Aetherweave Vestments (set id `chronoweave`): 2pc Temporal Echo
  conversion 40 to 50 percent plus pushback immunity; 4pc Temporal Cascade cooldown
  17 to 12 sec and cost down 30 percent (about +42 percent Cascade casts at neutral
  mana). Ours: up to +20 percent barrier casts, still mana-gated, and a speed buff
  with no throughput. Tuning flag: if barrier absorb dominates the healer probe, cut to 1.5 sec.

### Fire (`fire`, Pyromancy, dps)
**Set:** Emberlash Regalia
**Items:** Emberlash Cowl, Emberlash Mantle, Emberlash Robes, Emberlash Leggings, Emberlash Gloves

- **2pc:** "Cinderfall recharges 3 sec faster." (`fire_blast`, 3 charges, 30 to 27 sec recharge)
  - Route: DATA. `{ ability: 'fire_blast', cooldownFlat: -3 }` (confirm the charge recharge reads the resolved cooldown, as Ruincaller's bonusCharges path does).
- **4pc:** "Casting Cinderfall reduces the remaining cooldown of Blazing Barrier by 2 sec." (`blazing_barrier`, 60 sec absorb, 30 sec cooldown)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['fire_blast'] }`, `responses: [{ kind: 'cooldownRefund', ability: 'blazing_barrier', seconds: 2 }]`.
  - PvP read: instant burst charges come back faster and each one buys shield uptime.
- **PvE ceiling:** Pyroclast Regalia (2pc: Scald always crits at or below 35 percent
  health, plus pushback immunity; 4pc: Fire crits outside Phoenix Trance cut its
  cooldown by 1.5 sec). Ours: about +11 percent Cinderfall casts (one Hot Streak feed
  among many; well under the Pyroclast execute and Trance acceleration) and a
  defensive refund worth zero damage.

### Frost (`frost`, Cryomancy, dps)
**Set:** Rimewarden Garb
**Items:** Rimewarden Hood, Rimewarden Shoulderpads, Rimewarden Vestment, Rimewarden Legwraps, Rimewarden Mitts

- **2pc:** "Icebind's cooldown is reduced by 2 sec." (`frost_nova`, 8 sec root, 22 to 20 sec)
  - Route: DATA. `{ ability: 'frost_nova', cooldownFlat: -2 }` (the Gladiator-era Frost Nova shape).
- **4pc:** "Casting Icebind reduces the remaining cooldown of Flitstep by 5 sec." (`blink`, 15 sec cooldown)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['frost_nova'] }`, `responses: [{ kind: 'cooldownRefund', ability: 'blink', seconds: 5 }]`.
  - PvP read: the root and blink kite loop, a classic frost identity.
- **PvE ceiling:** Frostquench Weave (2pc: Rimelance crits bank a second Icicle plus
  pushback immunity; 4pc: Winterlash plants 3 Winter's Chill charges). Ours touches
  no damaging ability at all: an AoE root and a blink refund. PvE value is add
  control only, zero single-target DPS.

---

## Warlock (cloth)

### Affliction (`affliction`, Hexcraft, dps)
**Set:** Dreadquill Vestments
**Items:** Dreadquill Hood, Dreadquill Mantle, Dreadquill Robe, Dreadquill Leggings, Dreadquill Handwraps

- **2pc:** "Harrow's cast time is reduced by 0.3 sec." (`fear`, 5 sec incapacitate, 1.5 to 1.2 sec cast)
  - Route: DATA. `{ ability: 'fear', castPct: -0.2 }`.
- **4pc:** "Passing Sentence heals you for 4 percent of your maximum health." (`sentence`)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['sentence'] }`, `responses: [{ kind: 'heal', amountPctMaxHp: 0.04, target: 'self' }]` (`target: 'self'` is REQUIRED, Sentence is hostile).
  - Links loosely to the 2pc (control buys time to build Condemnation); disclose that it
    is a spec-signature payoff rather than a Harrow follow up.
- **PvE ceiling:** Hexthread Shroud (2pc: Needle of Fate +2 Condemnation plus pushback
  immunity; 4pc: Sentence refunds 10 Condemnation). Both feed the damage engine. Ours:
  a CC cast time (bosses are immune) and a small self-heal with zero damage.

### Demonology (`demonology`, Necromancy, dps)
**Set:** Marrowbound Regalia
**Items:** Marrowbound Cowl, Marrowbound Spaulders, Marrowbound Robe, Marrowbound Leggings, Marrowbound Grips

- **2pc:** "Bone Armor's cooldown is reduced by 10 sec." (`bone_armor`, absorb 20 percent of max health for 12 sec, 45 to 35 sec)
  - Route: DATA. `{ ability: 'bone_armor', cooldownFlat: -10 }`.
- **4pc:** "Reaping Command reduces the remaining cooldown of Bone Armor by 2 sec." (`reaping_command`, 8 sec cooldown)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['reaping_command'] }`, `responses: [{ kind: 'cooldownRefund', ability: 'bone_armor', seconds: 2 }]`.
  - Resolved: with a Command every 8 sec, Bone Armor returns about every 28 sec.
- **PvE ceiling:** Gravebrand Regalia (2pc: Reaping Command cooldown 8 to 6 sec plus
  pushback immunity; 4pc: unison strikes +25 percent damage). Ours adds no damage and
  does not speed Reaping Command; it only raises personal absorb uptime.

### Destruction (`destruction`, Ruination, dps)
**Set:** Slagcrown Vestments
**Items:** Slagcrown Hood, Slagcrown Mantle, Slagcrown Robes, Slagcrown Leggings, Slagcrown Gloves

- **2pc:** "Cinderhide's cooldown is reduced by 30 sec." (`cinderhide`, 25 percent damage reduction for 10 sec, 120 to 90 sec)
  - Route: DATA. `{ ability: 'cinderhide', cooldownFlat: -30 }`.
- **4pc:** "Every second Conflagrate makes your next Ruinbolt within 8 sec instant." (`conflagrate` 2 charges 18 sec, `chaos_bolt` 2.3 sec cast)
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 2, abilities: ['conflagrate'] }`, `responses: [{ kind: 'empowerNext', aura: 'next_cast_instant', abilities: ['chaos_bolt'], duration: 8 }]`.
  - Verify the order against Desolation (the spec mastery already shortens the next
    Ruinbolt after Conflagrate); the instant must consume cleanly with it.
  - PvP read: a telegraph-free burst window.
- **PvE ceiling:** Ruincaller Vestments (2pc: Conflagrate holds 3 charges, up to +50
  percent Conflagrate throughput, plus pushback immunity; 4pc: Ruinbolt +20 percent
  damage). Ours adds no damage per cast; the instant saves only the Desolation
  shortened remainder of one Ruinbolt per two Conflagrates (a few percent DPS at most,
  under the Ruincaller 4pc's flat +20 percent on the same spell). Tuning flag: measure in the destruction probe.

---

## Druid (leather)

### Balance (`balance`, Moongrove, dps)
**Set:** Starwarden Raiment
**Items:** Starwarden Headdress, Starwarden Spaulders, Starwarden Vest, Starwarden Breeches, Starwarden Gloves

- **2pc:** "Gripping Roots' cast time is reduced by 0.5 sec." (`entangling_roots`, 12 sec root, 1.5 to 1.0 sec cast)
  - Route: DATA. `{ ability: 'entangling_roots', castPct: -0.3333 }`.
- **4pc:** "Casting Gripping Roots increases your movement speed by 30 percent for 4 sec."
  - Route: DATA. `{ ability: 'entangling_roots', addEffects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 4 }] }`.
  - PvP read: root, then open range for Moonwing casting.
- **PvE ceiling:** Moonscorch Raiment (2pc: Moonseed may extend Lunar Tempest twice, to
  12 sec, plus pushback immunity; 4pc: Moonsurge and Sunwake +25 percent). Ours
  touches no damaging ability: zero DPS.

### Feral (`feral`, Wildfang, TANK; also plays Cat)
**Set:** Bloodmane Hide
**Items:** Bloodmane Helm, Bloodmane Shoulderpads, Bloodmane Tunic, Bloodmane Legguards, Bloodmane Grips

- **2pc:** "Bruin Rush's cooldown is reduced by 3 sec." (`bear_charge`, charge plus 1 sec stun, 15 to 12 sec)
  - Route: DATA. `{ ability: 'bear_charge', cooldownFlat: -3 }`.
- **4pc:** "Bruin Rush shields you for 6 percent of your maximum health for 6 sec."
  - Route: DATA ProcDef. `trigger: { on: 'castNth', n: 1, abilities: ['bear_charge'] }`, `responses: [{ kind: 'absorb', amountPctMaxHp: 0.06, duration: 6, name: 'Bloodmane Guard', target: 'self' }]` (`target: 'self'` REQUIRED, the Rush is hostile).
  - PvP read: gap close into Cat Form (Rush makes Cat free for 3 sec) with a cushion.
- **PvE ceiling:** both Wildfang raid sets. Wildfang Emberhide (Cat: Redharvest 45
  energy; Redharvest replants Flense) and Cinderbark Ward (Bruin: Sweeping Claws 30
  percent extra Old Blood; Marrowbreak +30 percent and keeps its strike beside the 18
  percent guard). Ours: zero damage; the absorb is at most 0.5 percent max health per
  sec and only if Rush is spent on cooldown, which a raid tank rarely does.

### Restoration (`restoration`, Groveheart, healer)
**Set:** Thistlebloom Vestment
**Items:** Thistlebloom Crown, Thistlebloom Mantle, Thistlebloom Vest, Thistlebloom Leggings, Thistlebloom Gloves

- **2pc:** "Fleetmend's cooldown is reduced by 1 sec." (`swiftmend`, 8 to 7 sec)
  - Route: DATA. `{ ability: 'swiftmend', cooldownFlat: -1 }`.
- **4pc:** "Fleetmend also increases your movement speed by 30 percent for 3 sec."
  - Route: DATA. `{ ability: 'swiftmend', addEffects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.3, duration: 3 }] }` (selfBuff lands on the caster even when Fleetmend targets an ally).
- **PvE ceiling:** Grovespring Raiment (2pc: Fleetmend consumes your own bloom first and
  heals 25 percent more, plus pushback immunity; 4pc: Overbloom harvests 75 percent
  and banks 1 Verdance). Ours: about +14 percent Fleetmend casts (it still needs a HoT
  to consume, so real gain is lower) against +25 percent per cast, and a speed buff with no throughput.

---
