# Procedural Legendary v1

Date: 2026-07-26

Release target: v0.30

Power revision: 1

This document separates three questions:

1. How often does a Legendary item occur?
2. How does a boss target a named Legendary power?
3. How strong is the power after it is equipped?

The first two are implemented drop constants. The third is covered by a
deterministic contribution harness, a 33,000,000-event release campaign, and
the exact-SHA acceptance commands documented below.

## Drop rate

Every eligible dungeon or delve boss appends one procedural equipment entry.
That entry uses a 2% Legendary weight, so the configured mean is one Legendary
per 50 boss kills.

The drop is a shared corpse entry under the existing party-loot rules. It is
not a personal 2% roll for every group member.

Outdoor rares use a 0.2% Legendary weight on a guaranteed procedural entry.
Delve elites use that same conditional table behind a 20% entry gate, for an
effective 0.04% Legendary chance. Ordinary outdoor mobs use a 0.02%
conditional Legendary weight behind a 5% entry gate, for an effective 0.001%
chance.

See `docs/balance/procedural-loot-generator-v1.md` for the full effective
probability table and cumulative 2% boss-kill tails.

## Boss targeting

`PROCEDURAL_BOSS_LEGENDARY_SIGNATURES` in
`src/sim/content/procedural_legendary_sources.ts` maps every launch power to
exactly one real repeatable boss.

| Boss | Signature powers |
| --- | --- |
| Deacon Varric | Bell of the Ninth Peal |
| Morthen the Gravecaller | Greyjaw's Edge |
| Vael the Fogbinder | Hushwood Longbow; Boots of the Unbroken Road |
| Sister Nhalia, the Drowned Canticle | Nightglass Fang; Mantle of Stolen Hours |
| Ysolei, Avatar of the Drowned Moon | Ysolei's Vigil; Stormwake Idol |
| Korzul the Gravewyrm | Crown of the Last Pyre; Ashbinder's Seal |
| Nythraxis, Scourge of Thornpeak | Dawnward Signet; Feral Moonclasp |

Targeting is strong but never exclusive. It uses two independent preferential
stages when a Legendary is already being generated:

1. Base stage: 80% of the base-selection branch is restricted to bases that
   can carry at least one signature power compatible with the drop context.
   The other 20% uses the full compatible Legendary base pool.
2. Power stage: if the selected base supports a boss signature, 80% of the
   power-selection branch chooses among those compatible signatures. The other
   20% chooses from all powers compatible with the selected base.

The global branch includes signature powers as part of the compatible catalog,
so "80%" is a branch weight, not a hard final share. Class, base, and source
level can also narrow what is compatible. The deterministic test samples 8,000
forced Legendaries for each boss and requires the final signature share to be
at least 65% and below 98%.

An unknown or unmapped source uses the global compatible selection path. A
signature boss can still drop a different compatible power, and its signature
can still appear elsewhere. This preserves broad excitement and trading while
giving players a clear boss to farm.

## Complete power catalog and roll ranges

Every generated Legendary persists its power ID, power revision, and quantized
roll. The roll does not change when the item is looted, traded, banked,
reconnected, or loaded after tuning.

| Power | Required class | Compatible bases | Trigger and effect | Persisted roll |
| --- | --- | --- | --- | --- |
| Crown of the Last Pyre | Mage | Gravecaller Cloth Hood | Every third Cinderbolt deals area fire damage around the target, radius 4, up to 4 targets | 29% to 34%, step 1% |
| Greyjaw's Edge | Warrior | Iron Broadsword, Thornpeak War Axe, Iron Flanged Mace, Thornpeak Polearm | Every third weapon hit applies a 6-second bleed with 2-second ticks and restores 4 primary resource | 38% to 40%, step 1% |
| Hushwood Longbow | Hunter | Mirefen Hunting Bow | Long Draw or Fell Shot has 25% chance to silence, with an 8-second internal cooldown | 800 to 1200 ms, step 100 ms |
| Nightglass Fang | Rogue | Mirefen Dirk | A kill grants 4 seconds of haste, with an 8-second internal cooldown | 10% to 14%, step 1% |
| Ysolei's Vigil | Priest | Ashwood Staff, Gravecaller Focus | A critical heal creates a 4-second restorative ground area, 1-second ticks, radius 4, up to 5 allies | 14% to 20%, step 1% |
| Stormwake Idol | Shaman | Gravecaller Focus | Every fourth Arc Bolt chains nature damage to up to 3 nearby enemies | 22% to 30%, step 1% |
| Ashbinder's Seal | Warlock | Gravecaller Ring | Every fourth Gloom Bolt marks the target for 6 seconds of added Shadow damage | 15% to 20%, step 1% |
| Dawnward Signet | Paladin | Gravecaller Ring | Mending Light shields its target for 6 seconds, with a 6-second internal cooldown | 16% to 22%, step 1% |
| Feral Moonclasp | Druid | Gravecaller Pendant | Every third Lunar Tempest restores primary resource | 4 to 7 resource, step 1 |
| Bell of the Ninth Peal | Any class that can equip the base | Ashwood Staff, Gravecaller Focus | Every second damaging spell deals area arcane damage around the target, radius 5, up to 5 targets | Stored roll 25% to 29%, step 1%; Paladin coefficient 2.2x |
| Mantle of Stolen Hours | Any compatible class | Cloth Mantle, Leather Shoulderguards, Mail Pauldrons | Crossing below 35% health grants 5 seconds of damage reduction, with a 45-second internal cooldown | 14% to 20%, step 1% |
| Boots of the Unbroken Road | Any compatible class | Cloth Slippers, Leather Boots, Mail Sabatons | Moving 15 yards grants 2.5 seconds of movement speed, with a 6-second internal cooldown | 8% to 12%, step 1% |

Bell of the Ninth Peal is compatible with `ashwood_staff` and
`gravecaller_focus`. It is not compatible with a cloth hood, ring, melee
weapon, or ranged weapon. The generator and persisted-item validator call the
same compatibility function. Paladins retain the canonical caster-weapon and
caster-offhand proficiency. Because a Paladin's representative damage mix has
a much smaller spell channel than a full caster, Bell applies an explicitly
authored 2.2x Paladin magnitude coefficient. The persisted and tooltip roll
remains 25% to 29%; the Paladin runtime magnitude is therefore 55% to 63.8% of
the triggering spell. This is class normalization for the neutral power, not a
hidden reroll, and all other classes continue to use a 1x coefficient.

## Can the same Legendary be good or bad?

Yes. Named Legendaries have bounded variance rather than one fixed stat line.

Two copies with the same Legendary name can differ in:

- source-derived item level
- three or four affix families
- affix tiers and quantized values
- the Legendary power roll shown in the table above

For example, two Ashbinder's Seals can roll 15% and 20% power magnitude, while
also carrying different legal affix combinations and values. Legendary affix
rolls use a 50% floor within each available tier, so a low Legendary roll is
bounded away from the weakest half of that tier but can still be materially
worse than a high roll.

The normal tooltip shows the current persisted power roll. The alternate
detail view shows the possible range. This supports both immediate readability
and an endgame chase for a better copy of a familiar power.

## One active Legendary power

`MAX_ACTIVE_LEGENDARY_POWERS` is 1.

The equip path rejects a second retained Legendary power before mutating bags
or equipment. Replacing the Legendary in the same slot is allowed because the
old slot is excluded from the retained count. A two-hand or offhand
displacement is also included in the replacement set before the guard runs.

The combat runtime independently selects an active equipment power. A malformed
or ambiguous equipped state does not activate extra powers. This cap keeps
build identity legible and prevents uncontrolled proc stacking while still
letting players collect and compare many Legendaries.

## Deterministic contribution harness

Reproduction:

```powershell
npm run loot:balance:report
npm run loot:balance
```

`scripts/procedural_legendary_balance_core.ts` constructs the shipped
`EquipmentEffectRuntime` with the shipped
`PROCEDURAL_LEGENDARY_POWERS` catalog. It exercises cadence, chance,
critical-only triggers, internal cooldowns, health crossings, accumulated
movement, roll edges, class compatibility, and event eligibility.

The release configuration uses:

- 100,000 chronological events at the minimum persisted roll
- 100,000 chronological events at the maximum persisted roll
- 165 applicable power, class, and build-profile rows
- 33,000,000 total event samples
- all 12 powers
- all nine classes where compatible
- five representative build profiles

The five profiles are:

| Profile | Level | Item level | Throughput scale | Cadence scale | Critical chance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fresh level 10 | 10 | 10 | 0.32 | 1.14 | 5% |
| Dungeon level 15 | 15 | 15 | 0.61 | 1.07 | 8% |
| Pre-raid level 20 | 20 | 20 | 1.00 | 1.00 | 10% |
| Best-in-slot level 20 | 20 | 25 | 1.18 | 0.94 | 14% |
| Legendary level 20 | 20 | 26 | 1.34 | 0.88 | 18% |

Measured channels remain separate:

- sustained and 10-second burst single-target damage
- five-target cleave damage
- single-target and five-target healing opportunity
- potential absorbed or prevented damage
- primary resource restored per minute
- silence seconds per minute
- average and peak movement speed
- peak conditional haste
- trigger rate and RNG draw count

Direct sustained single-target damage powers must remain between 8% and 15%
contribution, with no more than 25% in the intended 10-second burst window.
Kill-conditioned, cleave, healing, mitigation, resource, control, and mobility
powers are reported in their own units instead of being mislabeled as failed
boss DPS.

## Most recently recorded release-sized result

The last recorded 33,000,000-event campaign used seed `32106458`. A complete
run produced fingerprint `30e920f9` with no gate failures. These
are recorded measurements, not authored constants.

The primary `npm run loot:balance` command now always enforces the release
gate and exits nonzero for insufficient samples, incomplete coverage, or a
contribution failure. `npm run loot:balance:report` is the explicitly named
non-enforcing report mode. The CLI rejects unknown or positional arguments
instead of silently falling back to release defaults. The final PR must rerun
`npm run loot:balance` at the exact candidate SHA before claiming final
balance signoff.

Recorded direct-damage results:

| Power | Sustained minimum | Sustained maximum | Highest 10-second burst |
| --- | ---: | ---: | ---: |
| Crown of the Last Pyre | 8.118% | 11.127% | 19.027% |
| Greyjaw's Edge | 9.121% | 11.025% | 23.784% |
| Ashbinder's Seal | 8.550% | 11.400% | 14.288% |
| Bell of the Ninth Peal | 8.752% | 14.751% | 18.162% |

Nightglass Fang is kill-conditioned. Its recorded highest add-cycle burst was
4.592%, below the 25% ceiling, and it contributes zero in a pure boss phase
with no kills.

Recorded Bell class coverage:

| Class | Sustained minimum | Sustained maximum | Highest 10-second burst |
| --- | ---: | ---: | ---: |
| Priest | 9.707% | 13.013% | 16.490% |
| Paladin | 9.314% | 11.681% | 14.802% |
| Shaman | 9.864% | 12.607% | 15.522% |
| Mage | 11.531% | 14.751% | 18.162% |
| Warlock | 11.374% | 14.218% | 17.950% |
| Druid | 8.752% | 10.940% | 13.863% |

Recorded non-DPS opportunity ranges:

| Power | Channel | Minimum to maximum |
| --- | --- | ---: |
| Crown of the Last Pyre | Four-extra-target cleave | 24.354% to 33.380% |
| Greyjaw's Edge | Primary resource | 35.087 to 45.454 per minute |
| Hushwood Longbow | Silence uptime | 2.740 to 4.677 seconds per minute |
| Nightglass Fang | Sustained add-cycle damage | 2.398% to 4.348% |
| Nightglass Fang | Peak haste | 10% to 14% |
| Ysolei's Vigil | Single-target healing opportunity | 4.685% to 14.883% |
| Ysolei's Vigil | Five-target healing opportunity | 23.426% to 74.413% |
| Stormwake Idol | Five-target cleave damage | 16.887% to 29.954% |
| Bell of the Ninth Peal | Four-extra-target cleave | 35.007% to 59.006% |
| Dawnward Signet | Potential sustained mitigation | 4.253% to 6.536% |
| Dawnward Signet | Potential 10-second mitigation | 6.275% to 10.000% |
| Feral Moonclasp | Primary resource | 46.783 to 106.060 per minute |
| Mantle of Stolen Hours | Sustained mitigation | 1.556% to 2.222% |
| Mantle of Stolen Hours | 10-second mitigation | 7% to 10% |
| Boots of the Unbroken Road | Average movement speed | 2.500% to 3.750% |
| Boots of the Unbroken Road | Peak movement speed | 8% to 12% |

Packed-target healing and cleave figures are opportunity bounds. They assume
eligible targets remain in range. Mitigation figures assume enough incoming
damage exists to consume the full effect.

## Automated evidence

Focused commands:

```powershell
npx vitest run `
  tests/procedural_legendary_content.test.ts `
  tests/procedural_legendary_sources.test.ts `
  tests/procedural_legendary_balance.test.ts `
  tests/equipment_effect_runtime.test.ts `
  tests/equipment_effect_property.test.ts `
  tests/equipment_effect_integration.test.ts `
  tests/procedural_loot_generator.test.ts `
  tests/procedural_item_validation.test.ts
```

The source tests pin:

- exactly 12 launch powers, 9 class-specific and 3 class-neutral
- all 12 powers mapped exactly once across seven real repeatable bosses
- 56,000 forced Legendary boss-signature samples
- 288 class-specific forced Legendary generation cases
- 6,000 forced Legendary cases across world, rare, and dungeon source families
- exact power revision, key set, quantization, range, base compatibility, and
  generated-name validation
- one active power, second-equip rejection, and same-slot replacement
- full balance row coverage and fail-closed release enforcement

Final exact-SHA acceptance:

```powershell
npm run loot:balance
npx tsc --noEmit
npm run ci:changed
npm run gate
```

## Longevity rationale

The system has several independent chase axes:

- bosses are the best Legendary source at 2% per shared kill
- every power has one target boss
- target bosses remain non-exclusive, so all kills can still surprise
- item level varies with source and rarity
- Legendary affix families and values vary
- every power has a bounded persisted magnitude range
- one active power creates build choice instead of automatic proc stacking

The same named Legendary can therefore be recognizable without being solved
after the first copy. A player can chase the power, then chase a better item
level, more useful affix mix, and higher power roll.

## Honest limitations

- There is no pity counter or deterministic guarantee.
- A 2% shared-corpse drop is not a 2% personal roll for each party member.
- Signature targeting is probabilistic and compatibility-dependent.
- The contribution harness is not a full encounter simulator.
- Baseline channel shares are representative workload inputs, not a claim that
  every specialization uses one rotation.
- The burst tracker books a complete damage-over-time or ground effect at proc
  time, which can overstate but cannot hide a burst-ceiling failure.
- Healing excludes overheal and positioning loss.
- Resource results do not subtract waste at resource cap.
- Armor, resistance, target movement, PvP duration rules, pet attribution,
  raid debuffs, proc overlap, and encounter downtime remain encounter-level
  concerns.
- The PR records the exact candidate SHA and its enforced 33,000,000-event
  fingerprint; a run from another revision is not release evidence.
