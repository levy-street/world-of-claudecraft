# Procedural Legendary Contribution v1

Date: 2026-07-24

Branch: `feature/procedural-loot`

Independent balance verdict: **READY**

Deterministic report fingerprint: `bde27c6a`

## Reproduce

```powershell
npm run loot:balance

npm run loot:balance -- --enforce
```

The first command emits the complete versioned JSON report. The second applies
the release gates and exits zero only when the minimum sample count, complete
coverage, sustained contribution, and burst ceilings all pass.

The recorded release campaign used seed `32106458`, 100,000 chronological
events for the minimum roll and another 100,000 for the maximum roll in every
applicable compatibility row. It evaluated 160 rows and 32,000,000 events in
total. Two complete consecutive campaigns produced the same `bde27c6a`
fingerprint and no gate failures.

## What is measured

`scripts/procedural_legendary_balance_core.ts` constructs the shipped
`EquipmentEffectRuntime` with the shipped
`PROCEDURAL_LEGENDARY_POWERS` catalogue. It does not replace cadence, chance,
critical-only, internal cooldown, health crossing, accumulated movement, roll,
class, base-item, or event eligibility rules with analytical shortcuts.

Each row measures both persisted roll edges and reports these channels
separately:

- sustained and 10-second burst single-target damage
- five-target cleave damage
- single-target and five-target healing
- potential absorbed or prevented damage
- primary resource restored per minute
- silence seconds per minute
- average and peak movement speed
- peak conditional haste
- trigger rate and random draw count

The single-target damage gate is applied only to powers that directly deal or
amplify damage on the primary target. Kill-conditioned haste gets the burst
ceiling but not the sustained boss gate. Cleave-only, healing, mitigation,
resource, control, and mobility powers remain visible in their own units and
are not misclassified as failed DPS powers.

## Coverage

Every class-specific power runs with its required class. The Bell runs only
with classes that can equip one of its explicit caster bases. The other two
neutral powers run with all nine classes. Every applicable combination uses all
five build profiles.

| Power | Category | Class coverage |
| --- | --- | --- |
| Crown of the Last Pyre | Single-target and area damage | Mage |
| Greyjaw's Edge | Single-target damage and resource | Warrior |
| Hushwood Longbow | Control | Hunter |
| Nightglass Fang | Kill-conditioned damage | Rogue |
| Ysolei's Vigil | Healing | Priest |
| Stormwake Idol | Cleave | Shaman |
| Ashbinder's Seal | Single-target amplification | Warlock |
| Dawnward Signet | Absorb mitigation | Paladin |
| Feral Moonclasp | Resource | Druid |
| Bell of the Ninth Peal | Single-target and area damage | Mage, Priest, Warlock, Druid, Shaman |
| Mantle of Stolen Hours | Mitigation | All nine classes |
| Boots of the Unbroken Road | Mobility | All nine classes |

Bell is compatible only with `ashwood_staff` and
`gravecaller_cloth_hood`. This prevents a universal ring, melee base, or ranged
base from rolling a power that its wielder cannot reliably trigger. The
generator and persisted-item validator share the same compatibility function.

The five deterministic profiles are:

| Profile | Level | Item level | Throughput scale | Cadence scale | Critical chance |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fresh level 10 | 10 | 10 | 0.32 | 1.14 | 5% |
| Dungeon level 15 | 15 | 15 | 0.61 | 1.07 | 8% |
| Pre-raid level 20 | 20 | 20 | 1.00 | 1.00 | 10% |
| Best-in-slot level 20 | 20 | 25 | 1.18 | 0.94 | 14% |
| Legendary level 20 | 20 | 26 | 1.34 | 0.88 | 18% |

Level-20 DPS anchors come from the class medians in
`docs/balance/row-sweep.json`. Lower and stronger gear bands scale those
anchors explicitly. Attack Power, Spell Power, health, and event-channel
shares are checked-in inputs so a reviewer can audit or change an assumption
and reproduce the result.

## Release gates

The PRD requires 8% to 15% sustained single-target contribution and no more
than 25% in the intended 10-second burst window where those damage gates apply.

All applicable rows pass.

| Power | Sustained minimum | Sustained maximum | Highest 10-second burst |
| --- | ---: | ---: | ---: |
| Crown of the Last Pyre | 8.118% | 11.127% | 19.027% |
| Greyjaw's Edge | 9.121% | 11.025% | 23.784% |
| Ashbinder's Seal | 8.550% | 11.400% | 14.288% |
| Bell of the Ninth Peal | 8.752% | 14.751% | 18.162% |

Nightglass Fang is kill-conditioned rather than sustained boss damage. Its
highest measured burst is 4.592%, below the same 25% ceiling.

### Bell caster coverage

One global Bell coefficient could not make low spell-share classes reach 8%
without pushing high spell-share classes over 15%. Restricting it to
caster-compatible bases makes the intended audience explicit and keeps every
applicable class inside the gate.

| Class | Sustained minimum | Sustained maximum | Highest 10-second burst |
| --- | ---: | ---: | ---: |
| Priest | 9.707% | 13.013% | 16.490% |
| Shaman | 9.864% | 12.607% | 15.522% |
| Mage | 11.531% | 14.751% | 18.162% |
| Warlock | 11.374% | 14.218% | 17.950% |
| Druid | 8.752% | 10.940% | 13.863% |

## Tuned catalogue inputs

| Power | Final trigger | Final roll |
| --- | --- | ---: |
| Crown of the Last Pyre | Every third Cinderbolt | 29% to 34% |
| Greyjaw's Edge | Every third weapon hit | 38% to 40% |
| Ashbinder's Seal | Every fourth Gloom Bolt | 15% to 20% |
| Bell of the Ninth Peal | Every second damaging spell on an approved caster base | 25% to 29% |

Greyjaw originally combined a critical-only trigger with a three-second
internal cooldown. That produced large build-dependent gaps and could not meet
the sustained floor through magnitude changes alone. Its deterministic
every-third-hit cadence now produces 35.087 to 45.454 primary resource per
minute while keeping both damage gates intact.

## Separate non-DPS results

These are opportunity ranges across all covered profiles and classes. They
are not folded into damage to manufacture a passing score.

| Power | Measured channel | Minimum to maximum |
| --- | --- | ---: |
| Crown of the Last Pyre | Four-extra-target cleave | 24.354% to 33.380% |
| Greyjaw's Edge | Primary resource | 35.087 to 45.454 per min |
| Hushwood Longbow | Silence uptime | 2.740 to 4.677 sec/min |
| Nightglass Fang | Sustained add-cycle damage | 2.398% to 4.348% |
| Nightglass Fang | Peak haste | 10% to 14% |
| Ysolei's Vigil | Single-target healing | 4.685% to 14.883% |
| Ysolei's Vigil | Five-target healing opportunity | 23.426% to 74.413% |
| Stormwake Idol | Five-target cleave damage | 16.887% to 29.954% |
| Bell of the Ninth Peal | Four-extra-target cleave | 35.007% to 59.006% |
| Dawnward Signet | Potential sustained mitigation | 4.253% to 6.536% |
| Dawnward Signet | Potential 10-second mitigation | 6.275% to 10.000% |
| Feral Moonclasp | Primary resource | 46.783 to 106.060 per min |
| Mantle of Stolen Hours | Sustained mitigation | 1.556% to 2.222% |
| Mantle of Stolen Hours | 10-second mitigation | 7% to 10% |
| Boots of the Unbroken Road | Average movement speed | 2.500% to 3.750% |
| Boots of the Unbroken Road | Peak movement speed | 8% to 12% |

The five-target Ysolei result assumes every permitted ally is injured for
every pulse. It is an upper opportunity bound, not expected effective healing.
Stormwake, Crown, and Bell cleave results likewise assume packed eligible
targets.

## Independent balance signoff

The shipped catalogue and runtime pass the stated contribution contract across
all applicable powers, classes, build profiles, and persisted roll edges. The
release-sized deterministic harness is suitable as a fail-closed CI gate, and
the tuned catalogue is ready for activation from a combat-balance perspective.

The signoff is intentionally limited to the stated equipment-runtime contract.
It does not certify encounter pacing, drop economy, visual readability, or UX,
which have separate feature gates and reviewers.

## Honest limitations

- This is a high-volume equipment-runtime contribution screen, not a full
  encounter simulator. It does not make the existing row-sweep workload more
  authoritative than it is.
- The command accounting mirrors the shipped executor's event-base formula,
  rounding, target caps, DoT ticks, mark, haste, shield, and aura semantics.
  The runtime and catalogue are imported directly, but the executor is private
  to the combat controller. A future executor semantic change must update this
  harness and its focused tests together.
- The baseline channel shares are representative workload inputs. They are not
  assertions that every specialization uses the same rotation.
- The burst tracker conservatively books a complete DoT or ground effect at
  proc time. This can overstate, but cannot hide, a burst-ceiling failure.
- Shield and damage-reduction totals assume enough incoming damage to consume
  their full potential. Effective mitigation will be lower when damage does
  not arrive during the window.
- Healing excludes overheal and positioning losses. Group healing assumes the
  maximum eligible injured targets.
- The add-cycle workload supplies one kill every 12 seconds. Nightglass has
  zero contribution in a pure single-target boss phase with no kills.
- The movement workload assumes uninterrupted five-yard-per-second travel.
- Armor, resistance, target movement, resource starvation, resource waste at
  cap, PvP duration rules, pet attribution, proc overlap with class cooldowns,
  and raid debuffs remain encounter-level concerns outside this release gate.
