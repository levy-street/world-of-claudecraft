# World of Claudecraft — Ability Rank Progressions, Levels 1–20 (all nine classes)

**Tuning anchors used throughout** (from `src/sim/data.ts` / `types.ts`): typical mob hp = 40 + 18·L → L10 ≈ 220, **L14 ≈ 292**, **L20 ≈ 400** (elites ×2.3). A rank‑3 nuke at L14 should average ~40–50 dmg (6–8 casts); R4 at L20 ~70–80 (5–6 casts, fresh-rank spike). Mana costs follow the Lightning Bolt curve given in the brief (15/25/40/60). Rage/energy costs stay flat per rank (classic-era behavior). All DoT/HoT totals divide evenly by tick count. Rank rows reuse the existing `ranks: AbilityRank[]` schema — **ids unchanged**; new ability ids are snake_case and must be appended to each `CLASSES[*].abilities` array in learn order.

**Engine flags needed (minimized — exactly ONE new `AbilityEffect` type across the whole design):**
1. **NEW EFFECT TYPE:** `{ type: 'finisherStun'; base: number; perCombo: number }` — Kidney Shot only.
2. `requiresTargetHpBelow` already exists in `AbilityDef` — Execute uses it (wire enforcement if currently unused).
3. `AbilityRank` cannot override `channel` — Arcane Missiles / Drain Life / Mind Flay ranks scale per‑tick damage only (no schema change).
4. Conjure Water ranks need two new drink items (`conjured_mineral_water` drinkMana 151, `conjured_sparkling_water` drinkMana 270) — data only.
5. Mind Flay reuses `drainTick` with `healFrac: 0`; Fear reuses `incapacitate`; Cleave/Consecration/Arcane Explosion are caster‑centered `aoeDamage` like Thunder Clap. No engine changes.

---

## WARRIOR (rage — costs flat)

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| heroic_strike | 1 | 1 | 15 | swing | weaponDamage +11 |
| | 2 | 8 | 15 | swing | weaponDamage +21 *(exists)* |
| | **3** | **14** | 15 | swing | weaponDamage **+32** |
| | **4** | **20** | 15 | swing | weaponDamage **+44** |
| battle_shout | 1 | 1 | 10 | inst | buff_ap +20, 120s |
| | **2** | **12** | 10 | inst | buff_ap **+35**, 120s |
| | **3** | **20** | 10 | inst | buff_ap **+50**, 120s |
| demoralizing_shout | 1 | 14 | 10 | inst | aoeAttackPower −30, 30s, r10 |
| | **2** | **20** | 10 | inst | aoeAttackPower **−45**, 30s, r10 |
| rend | 1 | 4 | 10 | inst | dot 15 / 9s (3×5) |
| | 2 | 10 | 10 | inst | dot 21 / 9s *(exists)* |
| | **3** | **16** | 10 | inst | dot **36 / 12s** (4×9) |
| thunder_clap | 1 | 6 | 20 | inst | aoe 12–14 r8 + atkspeed 1.1/10s |
| | **2** | **14** | 20 | inst | aoe **23–27** r8 + same rider |
| | **3** | **20** | 20 | inst | aoe **37–43** r8 + same rider |
| hamstring | 1 | 8 | 10 | inst | dmg 5 + slow 0.5/15s |
| | **2** | **16** | 10 | inst | dmg **12** + slow 0.5/15s |
| overpower | 1 | 10 | 5 | inst | weaponStrike +5 |
| | **2** | **16** | 5 | inst | weaponStrike **+15** |
| charge / bloodrage | 1 | 4 / 10 | — | — | no further ranks (utility/cooldown) |

**NEW:** 

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `execute` | 14 | 15 | inst | `requiresTargetHpBelow: 0.2`, directDamage 60–75 |
| `slam` | 16 | 15 | 1.5s cast | weaponStrike +25 |
| `cleave` | 18 | 20 | inst | aoeDamage 20–26, radius 5 (caster-centered) |

**Sanity** — L14: white ~28 + HS R3 (+32) ≈ 60/swing → 292 hp in ~5 offensive swings + Rend (~12s) ✓. L20: white ~38 + HS R4 (+44) ≈ 82 → 400 hp in ~5 swings, Execute finishes the last 20% ✓.

---

## MAGE

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| fireball | 1 | 1 | 30 | 1.5 | 16–25 + dot 2/4s |
| | 2 | 6 | 45 | 2.0 | 22–31 + dot 3/6s *(exists)* |
| | **3** | **12** | 65 | **2.5** | **36–48** + dot 6/6s (3×2) |
| | **4** | **18** | 95 | **3.0** | **58–78** + dot 12/8s (4×3) |
| frostbolt | 1 | 4 | 25 | 1.5 | 18–20 + slow 0.6/5s |
| | 2 | 8 | 35 | 2.0 | 31–35 + slow 0.6/6s *(exists)* |
| | **3** | **14** | 50 | **2.5** | **44–50** + slow 0.6/7s |
| | **4** | **20** | 70 | 2.5 | **66–74** + slow 0.6/9s |
| fire_blast | 1 | 6 | 40 | inst, 8cd | 27–35 |
| | **2** | **12** | 60 | inst, 8cd | **44–54** |
| | **3** | **18** | 85 | inst, 8cd | **68–82** |
| arcane_missiles | 1 | 8 | 50 | 3s chan | 8/missile ×3 |
| | **2** | **14** | 75 | 3s chan | **14**/missile ×3 |
| | **3** | **20** | 105 | 3s chan | **22**/missile ×3 |
| frost_armor | 1 | 1 | 20 | inst | buff_armor 30, 30min |
| | **2** | **10** | 30 | inst | buff_armor **50** |
| | **3** | **18** | 45 | inst | buff_armor **70** |
| arcane_intellect | 1 | 1 | 25 | inst | buff_int +2, 30min |
| | **2** | **14** | 60 | inst | buff_int **+7** |
| conjure_water | 1 | 4 | 40 | 3.0 | conjured_water (76 mana) |
| | **2** | **10** | 70 | 3.0 | new item: 151 mana |
| | **3** | **18** | 110 | 3.0 | new item: 270 mana |
| polymorph | 1 | 8 | 50 | 1.5 | 15s |
| | **2** | **18** | 70 | 1.5 | **20s** |
| frost_nova | 1 | 10 | 35 | inst, 22cd | aoeRoot 8s r10, 6–7 |
| | **2** | **16** | 50 | inst, 22cd | aoeRoot 8s r10, **12–14** |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `arcane_explosion` | 14 | 60 | inst | aoeDamage 26–31, radius 10 (caster-centered) |
| `scorch` | 16 | 35 | 1.5s | directDamage 32–40 (fast fire filler) |
| `ice_barrier` / `blazing_barrier` | 5 (R2 12, R3 18) | 45 / 65 / 90 | inst, 30cd | absorb 50 / 90 / 130 + 50% Spell Power, 60s (self) |
| `temporal_barrier` | 5 (R2 12, R3 18) | 50 / 75 / 105 | inst, 12cd | absorb 55 / 100 / 160 + 25% Spell Power, 10s (friendly) |
| `pyroblast` | 20 | 125 | 6.0s cast | directDamage 75–100 + dot 24/12s (6×4) — big nuke + burn |

**Sanity** — L14: Fireball R3 avg 42 (+6 dot) ≈ 48/cast → 292 hp ≈ 6.1 casts ✓. L20: FB R4 avg 68 (+12) = 80 → 400 hp = 5 casts (+Fire Blast R3 trims one) ✓.

---

## ROGUE (energy — costs flat)

| Ability | Rank | Learn | Cost | Effect values |
|---|---|---|---|---|
| sinister_strike | 1 | 1 | 45 | weaponStrike +3 |
| | 2 | 8 | 45 | weaponStrike +6 *(exists)* |
| | **3** | **14** | 45 | weaponStrike **+12** |
| | **4** | **20** | 45 | weaponStrike **+18** |
| eviscerate | 1 | 1 | 35 | base 4, perCombo 7, var 4 |
| | **2** | **12** | 35 | base **8**, perCombo **12**, var 6 (5cp ≈ 62–74) |
| | **3** | **18** | 35 | base **14**, perCombo **18**, var 9 (5cp ≈ 95–113) |
| backstab | 1 | 4 | 60 | weaponMult 1.5, +11 (behind, dagger) |
| | **2** | **12** | 60 | weaponMult 1.5, **+20** |
| | **3** | **18** | 60 | weaponMult 1.5, **+32** |
| gouge | 1 | 6 | 45 | 8–9 dmg + incapacitate 4s |
| | **2** | **14** | 45 | **15–17** dmg + incapacitate 4s |
| evasion / slice_and_dice / sprint | 1 | 8/10/10 | — | no further ranks (durations/multipliers stay) |

**NEW:**

| Ability | Learn | Cost | CD | Effects |
|---|---|---|---|---|
| `kidney_shot` | 14 | 25 | 20s | spendsCombo, **finisherStun { base 1, perCombo 1 }** (2–6s) — *the one new effect type* |
| `ambush` | 16 | 60 | — | weaponStrike weaponMult 2.5, +28, requiresBehind, dagger, awardsCombo 1 |
| `adrenaline_rush` | 20 | 0 | 180s, offGcd | gainResource 60 (energy) |

**Sanity** — L14: SS R3 special ≈ 40–45; 5 builders (~210) + Eviscerate R2 (~68) + white ≈ 292 hp in ~8 actions ✓. L20: SS R4 ≈ 55–60; 5 SS (~285) + Evisc R3 (~105) = 390 + white ≥ 400 ✓.

---

## PALADIN

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| seal_of_righteousness | 1 | 1 | 25 | inst | imbue +4/swing, judge 10–18 |
| | **2** | **10** | 35 | inst | imbue **+7**, judge **18–28** |
| | **3** | **16** | 50 | inst | imbue **+11**, judge **30–44** |
| holy_light | 1 | 1 | 35 | 2.5 | heal 42–51 |
| | **2** | **8** | 60 | 2.5 | heal **76–90** |
| | **3** | **14** | 95 | 2.5 | heal **122–144** |
| | **4** | **20** | 140 | 2.5 | heal **190–222** |
| devotion_aura | 1 | 1 | 0 | inst | buff_armor 40 |
| | **2** | **12** | 0 | inst | buff_armor **75** |
| | **3** | **18** | 0 | inst | buff_armor **110** |
| blessing_of_might | 1 | 4 | 25 | inst | buff_ap +15, 5min |
| | **2** | **12** | 40 | inst | buff_ap **+30** |
| | **3** | **20** | 60 | inst | buff_ap **+45** |
| divine_protection | 1 | 6 | 15 | inst, 180cd | absorb 50/10s |
| | **2** | **14** | 25 | inst, 180cd | absorb **110**/10s |
| hammer_of_justice | 1 | 8 | 30 | inst, 60cd | stun 3s |
| | **2** | **16** | 45 | inst, 60cd | stun **4s** |
| lay_on_hands | 1 | 10 | 0 | inst, 600cd | heal 250 |
| | **2** | **18** | 0 | inst, 600cd | heal **600** (~75% of L20 pala hp) |
| judgement | 1 | 4 | 30 | — | no ranks (scales via Seal ranks) |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `flash_of_light` | 12 | 35 | 1.5s | heal 62–76 (efficient fast heal) |
| `exorcism` | 14 | 55 | inst, 15cd, 30yd | directDamage 46–56 (holy nuke; undead-only restriction omitted — no such flag) |
| `consecration` | 18 | 60 | inst, 8cd | aoeDamage 28–34, radius 8 (caster-centered) |

**Sanity** — L14: swing ~26 + Seal R2 (+7) ≈ 33, + Judgement R2 (~23/10s) + Exorcism (~51/15s) → 292 hp ≈ 9–10 swings, ~20s ✓ (hybrid pace). L20: swing ~42 w/ Seal R3, judge ~37 → 400 hp ≈ 8 swings ✓.

---

## HUNTER

| Ability | Rank | Learn | Cost | Effect values |
|---|---|---|---|---|
| raptor_strike | 1 | 1 | 15 | weaponDamage +5 (next swing, 6cd) |
| | **2** | **8** | 25 | **+11** |
| | **3** | **14** | 35 | **+18** |
| | **4** | **20** | 45 | **+27** |
| serpent_sting | 1 | 4 | 15 | dot 20/15s (5×4) |
| | **2** | **10** | 25 | dot **35/15s** (5×7) |
| | **3** | **16** | 35 | dot **55/15s** (5×11) |
| arcane_shot | 1 | 6 | 25 | 13–17 (6cd) |
| | **2** | **12** | 40 | **24–30** |
| | **3** | **18** | 55 | **38–47** |
| aspect_of_the_hawk | 1 | 4 | 20 | buff_ap +20, 30min |
| | **2** | **12** | 30 | buff_ap **+35** |
| | **3** | **18** | 40 | buff_ap **+50** |
| mongoose_bite | 1 | 10 | 10 | weaponStrike +12 (dodge proc) |
| | **2** | **16** | 10 | weaponStrike **+24** |
| concussive_shot / wing_clip | 1 | 8/10 | — | no further ranks (utility; slows don't scale) |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `aspect_of_the_monkey` | 10 | 20 | inst | selfBuff buff_dodge +0.08, 30min |
| `aspect_of_the_cheetah` | 14 | 20 | inst | selfBuff buff_speed 1.3, 30min (replaces Hawk while active; daze rider omitted) |
| `aimed_shot` | 16 | 50 | 3.0s cast, 6cd, 8–35yd | directDamage 50–62 |
| `rapid_fire` | 20 | 0 | inst, 300cd, offGcd | selfBuff buff_haste 1.4, 15s |

**Sanity** — L14: auto ~17/2.3s + Arcane R2 (~27/6s) + Sting R2 (35) → 292 hp ≈ 8 autos + 3 arcanes + sting, ~18s ✓. L20: Aimed (~56) + Arcane R3 (~43) + Sting R3 (55) + ~7 autos (~170) ≈ 400 ✓.

---

## PRIEST

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| smite | 1 | 1 | 20 | 2.0 | 15–20 |
| | **2** | **8** | 32 | 2.0 | **26–33** |
| | **3** | **14** | 48 | **2.5** | **42–52** |
| | **4** | **20** | 70 | 2.5 | **64–78** |
| lesser_heal | 1 | 1 | 30 | 2.0 | heal 47–58 |
| | **2** | **6** | 45 | 2.0 | heal **72–86** |
| | **3** | **12** | 65 | 2.0 | heal **110–132** |
| power_word_fortitude | 1 | 1 | 30 | inst | buff_sta +3, 30min |
| | **2** | **12** | 55 | inst | buff_sta **+7** |
| | **3** | **20** | 80 | inst | buff_sta **+12** |
| shadow_word_pain | 1 | 4 | 25 | inst | dot 30/18s (6×5) |
| | **2** | **10** | 38 | inst | dot **54/18s** (6×9) |
| | **3** | **16** | 55 | inst | dot **84/18s** (6×14) |
| power_word_shield | 1 | 6 | 45 | inst, 6cd | absorb 48/30s |
| | **2** | **12** | 70 | inst, 6cd | absorb **90** |
| | **3** | **18** | 100 | inst, 6cd | absorb **145** |
| renew | 1 | 8 | 30 | inst | hot 45/15s (5×9) |
| | **2** | **14** | 50 | inst | hot **90/15s** (5×18) |
| | **3** | **20** | 75 | inst | hot **140/15s** (5×28) |
| mind_blast | 1 | 10 | 50 | 1.5, 8cd | 42–46 |
| | **2** | **14** | 70 | 1.5, 8cd | **60–66** |
| | **3** | **20** | 95 | 1.5, 8cd | **86–94** |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `heal` | 14 | 95 | 2.5s | heal 165–195; **R2 @ L20**: cost 130, heal 230–270 |
| `mind_flay` | 16 | 45 | 3s channel ×3 ticks | drainTick 12–12 `healFrac: 0` + slow 0.5/3s (reuses drainTick — no new type) |
| `flash_heal` | 20 | 75 | 1.5s | heal 120–142 |

**Sanity** — L14: SWP R2 (54) + Smite R3 avg 47 ×5 ≈ 289 → ~6 casts ✓. L20: SWP R3 (84) + MB R3 (~90) + 3× Smite R4 (~213) ≈ 387 + wand-less white → ~5–6 GCDs ✓.

---

## SHAMAN

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| lightning_bolt | 1 | 1 | 15 | 1.5 | 15–17 |
| | **2** | **8** | 25 | **2.0** | **26–30** |
| | **3** | **14** | 40 | **2.5** | **45–51** |
| | **4** | **20** | 60 | **3.0** | **75–85** |
| rockbiter_weapon | 1 | 1 | 20 | inst | imbue +5/swing, 5min |
| | **2** | **8** | 30 | inst | imbue **+9** |
| | **3** | **16** | 45 | inst | imbue **+14** |
| healing_wave | 1 | 1 | 25 | 1.5 | heal 36–44 |
| | **2** | **6** | 40 | **2.0** | heal **56–68** |
| | **3** | **12** | 65 | **2.5** | heal **92–110** |
| | **4** | **18** | 90 | 2.5 | heal **138–164** |
| earth_shock | 1 | 4 | 30 | inst, 6cd | 19–22 |
| | **2** | **10** | 45 | inst, 6cd | **33–38** |
| | **3** | **16** | 65 | inst, 6cd | **54–61** |
| lightning_shield | 1 | 8 | 25 | inst | thorns 13, 10min |
| | **2** | **12** | 40 | inst | thorns **20** |
| | **3** | **18** | 55 | inst | thorns **29** |
| flame_shock | 1 | 10 | 35 | inst, 6cd | 25 + dot 28/12s |
| | **2** | **16** | 55 | inst, 6cd | **42** + dot **48/12s** (4×12) |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `flametongue_weapon` | 10 | 25 | inst | imbue +8/swing (Fire), 5min; R2 L18 +13 |
| `frost_shock` | 14 | 50 | inst, 6cd, 20yd | directDamage 36–42 + slow 0.5/8s |
| `ghost_wolf` | 16 | 35 | 2.0s cast | selfBuff buff_speed 1.4, 10min |
| `stormstrike` | 20 | 40 | inst, 12cd | weaponStrike +26 |

**Sanity** — L14: LB R3 avg 48 → 292/48 ≈ 6.1 casts ✓ (the brief's own anchor). L20: LB R4 avg 80 → 5 casts, or shock-weave melee w/ Rockbiter R3 ✓.

---

## WARLOCK

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| shadow_bolt | 1 | 1 | 25 | 1.7 | 13–18 |
| | **2** | **8** | 38 | **2.2** | **24–31** |
| | **3** | **14** | 55 | **2.7** | **42–53** |
| | **4** | **20** | 80 | **3.0** | **68–84** |
| immolate | 1 | 1 | 25 | 2.0 | 11 + dot 20/15s |
| | **2** | **10** | 40 | 2.0 | **22** + dot **35/15s** (5×7) |
| | **3** | **16** | 60 | 2.0 | **38** + dot **60/15s** (5×12) |
| corruption | 1 | 4 | 35 | 2.0 | dot 40/18s |
| | **2** | **12** | 55 | 2.0 | dot **72/18s** (6×12) |
| | **3** | **18** | 75 | 2.0 | dot **108/18s** (6×18) |
| curse_of_agony | 1 | 8 | 25 | inst | dot 36/24s |
| | **2** | **14** | 40 | inst | dot **72/24s** (8×9) |
| | **3** | **20** | 60 | inst | dot **112/24s** (8×14) |
| life_tap | 1 | 6 | 0 | inst | hp 30 → mana 30 |
| | **2** | **14** | 0 | inst | **55 → 55** |
| | **3** | **20** | 0 | inst | **85 → 85** |
| drain_life | 1 | 10 | 35 | 5s chan ×5 | 7/tick, healFrac 1 |
| | **2** | **14** | 50 | 5s chan ×5 | **12**/tick |
| | **3** | **20** | 70 | 5s chan ×5 | **17**/tick |
| demon_skin | 1 | 1 | 20 | inst | buff_armor 30, 30min |
| | **2** | **12** | 35 | inst | buff_armor **55** |
| | **3** | **20** | 50 | inst | buff_armor **80** |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `fear` | 14 | 40 | 1.5s, 20yd | incapacitate 8s (breaks on damage; reuses incapacitate — target cowers in place, no flee AI needed) |
| `searing_pain` | 16 | 35 | 1.5s | directDamage 30–38 |
| `shadowburn` | 20 | 70 | inst, 15cd | directDamage 56–66 |

**Sanity** — L14: Corruption R2 (72) + CoA R2 (72) + 3× SB R3 (~143) ≈ 287 + Drain ✓ (~6 GCDs, dot-and-drain pace). L20: Corruption R3 + CoA R3 (220 over time) + 2–3 SB R4 (~152–228) ≥ 400 ✓.

---

## DRUID

| Ability | Rank | Learn | Cost | Cast | Effect values |
|---|---|---|---|---|---|
| wrath | 1 | 1 | 20 | 1.5 | 13–16 |
| | **2** | **8** | 32 | **2.0** | **24–29** |
| | **3** | **14** | 48 | 2.0 | **38–45** |
| | **4** | **20** | 70 | 2.0 | **60–71** |
| healing_touch | 1 | 1 | 25 | 2.5 | heal 37–51 |
| | **2** | **8** | 45 | **3.0** | heal **68–86** |
| | **3** | **14** | 75 | 3.0 | heal **115–140** |
| | **4** | **20** | 110 | 3.0 | heal **175–208** |
| moonfire | 1 | 4 | 25 | inst | 9–12 + dot 12/9s |
| | **2** | **10** | 40 | inst | **17–21** + dot **24/12s** (4×6) |
| | **3** | **16** | 60 | inst | **28–34** + dot **40/12s** (4×10) |
| rejuvenation | 1 | 4 | 25 | inst | hot 32/12s |
| | **2** | **10** | 40 | inst | hot **56/12s** (4×14) |
| | **3** | **16** | 60 | inst | hot **88/12s** (4×22) |
| | **4** | **20** | 80 | inst | hot **116/12s** (4×29) |
| mark_of_the_wild | 1 | 1 | 20 | inst | buff_armor +25, 30min |
| | **2** | **10** | 35 | inst | buff_armor **+50** |
| | **3** | **16** | 50 | inst | buff_armor **+75** |
| thorns | 1 | 6 | 20 | inst | thorns 3, 10min |
| | **2** | **14** | 35 | inst | thorns **6** |
| | **3** | **20** | 50 | inst | thorns **9** |
| entangling_roots | 1 | 8 | 35 | 1.5 | root 12s |
| | **2** | **16** | 50 | 1.5 | root 12s **+ dot 32/12s** (4×8; classic-style damaging roots — two effects, no new types) |
| bear_form | 1 | 10 | 30 | inst | no further ranks (Dire Bear is post-20; Cat Form deliberately out of scope — new resource/combo sim work) |

**NEW:**

| Ability | Learn | Cost | Cast/CD | Effects |
|---|---|---|---|---|
| `regrowth` | 14 | 55 | 2.0s | heal 52–62 + hot 49/21s (7×7) — combo heal+HoT, both existing types |
| `barkskin` | 16 | 30 | inst, 60cd, offGcd | selfBuff buff_armor +150, 15s |
| `starfire` | 18 | 80 | 3.0s | directDamage 60–74 |

**NEW — kit completion (all reuse existing effect types; zero new sim work):**

| Ability | Learn | Cost | Cast/CD | Form | Effects |
|---|---|---|---|---|---|
| `travel_form` | 16 | 30 | inst | — (OOC) | selfBuff buff_speed +40%, 60min |
| `enrage` | 16 | 0 | inst, 60cd, offGcd | Bear | gainResource +20 rage |
| `bash` | 16 | 10 | inst, 60cd | Bear | stun 2s |
| `faerie_fire` | 18 | 30 | inst | — | sunder armor −35 (1 stack), 40s |
| `hibernate` | 18 | 50 | 1.5s | — | incapacitate 8s (breaks on damage) |
| `dash` | 18 | 0 | inst, 60cd, offGcd | Cat | selfBuff buff_speed +50%, 15s |
| `pounce` | 18 | 50 | inst | Cat (stealth) | stun 2s + 1 combo |
| `insect_swarm` | 20 | 45 | inst | — | dot 48/12s (4×12) Nature |
| `tigers_fury` | 20 | 30 | inst | Cat | selfBuff buff_ap +40, 6s |
| `rip` | 20 | 30 | inst | Cat | dot 60/12s finisher (spendsCombo) |

**Sanity** — L14: Moonfire R2 open (19+24) + 6× Wrath R3 (avg 41.5 → 249) ≈ 292 in ~7 casts ✓. L20: Wrath R4 avg 65.5 → 400/65.5 ≈ 6.1 casts (Starfire/Moonfire R3 trims to ~5) ✓.

---

## Cross-class summary of new abilities (10–20 band)

| Class | New abilities (id @ level) | New sim work |
|---|---|---|
| Warrior | execute@14, slam@16, cleave@18 | wire existing `requiresTargetHpBelow` |
| Mage | personal barrier@5 (R2@12, R3@18), arcane_explosion@14, scorch@16, pyroblast@20 | none |
| Rogue | kidney_shot@14, ambush@16, adrenaline_rush@20 | **finisherStun effect (the only new effect type)** |
| Paladin | flash_of_light@12, exorcism@14, consecration@18 | none |
| Hunter | aspect_of_the_cheetah@14, aimed_shot@16, rapid_fire@20 | none |
| Priest | heal@14 (R2@20), mind_flay@16, flash_heal@20 | none (drainTick healFrac 0) |
| Shaman | frost_shock@14, ghost_wolf@16, stormstrike@20, frostbrand_weapon@12 (R2@20) | none (imbue reuse) |
| Warlock | fear@14, searing_pain@16, shadowburn@20 | none (incapacitate reuse) |
| Druid | regrowth@14, barkskin@16, starfire@18 | none |

Files to touch when implementing: `/Users/reubenhorne/Documents/code/levy-street/world-of-claudecraft/src/sim/data.ts` (ABILITIES ranks + new entries, CLASSES.abilities arrays, 2 conjured-water items), `/Users/reubenhorne/Documents/code/levy-street/world-of-claudecraft/src/sim/types.ts` (one new AbilityEffect variant `finisherStun`, XP_TABLE/MAX_LEVEL extension per the brief).
