# One Button and level 20 spec bars

Status: manual-first level 20 bars implemented; One Button remains unapproved and deferred

Target: v0.29.0 PBE after Levy or Fernando approves this gameplay-assistance slice

## Player promise

`One Button` is a spellbook action for the six damage specializations owned in this program:

- Hunter: Packlord, Coldsight, Fieldcraft
- Shaman: Thundercall, Warspirit
- Priest: Vespers

Each press chooses one recommended core damage action and sends it through the normal cast path.
It is not an automatic combat mode. It does not grant extra damage, free resources, faster casts,
or hidden retries.

Doctrine, Benison, and Spiritmend do not receive One Button in the first version. Healing and
hybrid play depend on target and triage choices that should stay with the player.

## What stays manual

One Button never chooses or uses:

- A target or a new target.
- Movement, charges, leaps, or ground placement.
- Interrupts, crowd control, taunts, dispels, resurrection, or encounter utility.
- Healing, shields, defensive cooldowns, consumables, or pet care.
- Weapon postures, guises, forms, or pet stances.
- Major offensive cooldowns such as Howling Rage, Stampede, Cold Focus, Bloodtrail Assault,
  Primal Mastery, Storm Chorus, or Call Tithefiend.
- An area spell because it counted enemies the player did not deliberately target.

It never cancels or clips a cast or channel. One press submits at most one normal cast attempt.

## Authoritative implementation shape

One Button is a synthetic spellbook and hotbar action. It is not a fake `AbilityDef` and is not a
client macro.

The server resolves the next real ability from the selected spec's fixed priority. The Sim then
calls the existing normal cast path exactly once. All normal checks still apply: known ability,
target, range, line of sight, facing, movement, pet, weapon, resource, cooldown, charges, cast
time, channel, global cooldown, spell queue, and proc consumption.

The first slice does not show a client-predicted next icon. That preview can disagree with the
server under latency. Add it later only if it is clearly marked as a preview and the server still
recomputes the action on press.

Suggested seams:

- Pure priority records: `src/sim/content/one_button_rotations.ts`
- Pure deterministic resolver: `src/sim/combat/one_button_rotation.ts`
- World action: `IWorldCombat.castOneButton()`
- Online command: `{ cmd: 'castOneButton' }`, with no client-supplied chosen ability
- Synthetic spellbook row beside the existing synthetic Attack row
- New hotbar action discriminant that persists and activates `castOneButton()`

## Ideal core priorities

These priorities use live resolved costs, cooldowns, action replacements, and state. The numbers
that justified the order belong in tests and balance records, not as hardcoded selection values.

### Packlord

1. Use Unleash Beast when Pack Command has transformed at three Pack Ferocity.
2. Use Fell Shot when Overdraw is ready or Focus is near its cap.
3. Use Pack Command when a living pet can reach the selected target.
4. Use Fell Shot when it is ready and affordable.
5. Otherwise, submit no cast and let normal attacks continue.

Pack Command is the non-retail name for the Kill Command generator role. A successful pet hit
generates Focus and Pack Ferocity. Stampede remains manual even if Pack Command resets it.

The same core priority is used in the 3-target assisted test. Full manual play can add Stampede and
other area decisions, so expert manual damage should stay higher.

### Coldsight

1. Use Fevered Draw when ready.
2. Use Long Draw when Overdraw is ready.
3. Use Fell Shot while moving or near the Focus cap.
4. Use Long Draw while stationary and able to pay its cost.
5. Use Measured Shot while stationary.
6. Use Fell Shot while moving when affordable.
7. Otherwise, submit no cast.

Cold Focus and Volley remain manual. The 3-target assisted priority stays the same because Volley
requires a player placement decision.

### Fieldcraft

Bloodhook is manual because it moves the player and establishes the wound needed by the core loop.

1. Use Shrapnel Charge when the selected target has the Hunter's Bloodhook Wound.
2. Use Woundrend at three Hunting Momentum when the wound exists and Focus is available.
3. Use Gutting Strike in melee to generate Focus and Hunting Momentum.
4. Use Woundrend before the wound expires when it needs a refresh.
5. Otherwise, submit no cast.

Trailbreak and Bloodtrail Assault remain manual. The 3-target assisted priority uses the same
selected wounded target. Shrapnel Charge supplies its normal nearby damage without automatic
target switching.

### Thundercall

1. At five Thunder, use Earthen Jolt when its shared Jolt cooldown is ready.
2. Use Cinder Jolt when its damage-over-time effect is missing, the Jolt cooldown is ready, and
   Thunder is below four.
3. Use Arc Bolt.
4. Otherwise, submit no cast.

Faultwake, Primal Mastery, and Storm Chorus remain manual. In the 3-target expert test, the player
can spend full Thunder on a deliberately placed Faultwake. The assisted core test does not place
the ground effect automatically.

### Warspirit

In Galeheart posture:

1. Spend Stormcast on Arc Bolt.
2. Use Ancestral Strike when ready.
3. Use Cinder Jolt when its damage-over-time effect is missing.
4. Use Earthen Jolt when its shared cooldown is ready.
5. Otherwise, submit no cast and let normal weapon attacks continue.

In Stonebound posture:

1. Spend Stormcast on Arc Bolt.
2. Use Ancestral Strike when ready.
3. Otherwise, submit no cast and let normal weapon attacks continue.

Earthen Jolt stays manual in Stonebound because it forces the target to attack the Shaman.
One Button never changes Galeheart or Stonebound. The 3-target assisted priority stays the same
until Warspirit has an approved baseline area action.

### Vespers

1. Use Dirge of Decay when the selected enemy lacks the Priest's effect or it is close to expiring.
2. Use Mindfracture when ready.
3. Use Litany of Woe as the filler.
4. Otherwise, submit no cast.

Gloamveil and Call Tithefiend remain manual. The player chooses when to enter the form and whether
to spend Gloomtithe early or wait for five stacks.

On three targets, One Button never switches targets. The player applies Dirge to secondary enemies
and chooses the Effigy target. The normal Vespers echo rules then provide area damage.

## Balance proof

Run every supported spec through all four fixed scenarios:

| Targets | Window | Comparisons |
| --- | --- | --- |
| 1 | 15 sec burst | One Button, same-priority manual, full-kit manual |
| 1 | 60 sec sustained | One Button, same-priority manual, full-kit manual |
| 3 | 15 sec burst | One Button, same-priority manual, full-kit manual |
| 3 | 60 sec sustained | One Button, same-priority manual, full-kit manual |

The One Button trace must match the same-priority manual trace at the same input ticks. Compare the
concrete cast sequence, total and per-target damage, damage by source, ending resource, wasted
resource, and proc generation and consumption.

One Button must never beat the complete manual kit. Major cooldown timing, movement, target swaps,
ground placement, area decisions, and utility remain the manual skill ceiling.

Also test no target, dead target, range, line of sight, insufficient resource, global cooldown,
busy cast, queue window, silence, stun, movement, dead pet, missing pet, spec change, and stale
client state.

## Default action-bar rules

The action bar has 33 configurable ability slots. Mobile shows five slots per page. Slot 0 remains
the separate Attack control.

For damage specs, mobile page 1 contains One Button plus the complete manual core loop. Page 2
contains major cooldowns, movement, emergency recovery, and interrupts. Later pages contain control,
buffs, and setup actions.

Each class and spec gets its own saved profile. Apply a full default only when that spec profile has
never existed and the current bar can be proven untouched. Existing customization always wins.

For a legacy player with a stored class bar and no provenance marker, copy the existing bar into
the first selected spec profile and mark it preserved. Remove wrong-spec actions, but do not reorder
valid actions or items. Later spec grants and One Button fill only genuine empty slots.

Store a versioned seed marker and the exact generated layout. Once the layout differs from that
record, it is customized and is never seeded again. Saved loadout bars always win. A future explicit
`Use spec defaults` control may replace a customized bar only after a player click and confirmation.

## Hunter level 20 bars

### Packlord

| Slot | Action |
| ---: | --- |
| 1 | One Button |
| 2 | Pack Command, transforms to Unleash Beast |
| 3 | Fell Shot |
| 4 | Venom Barb |
| 5 | Volley |
| 6 | Howling Rage |
| 7 | Stampede |
| 8 | Hushing Shot |
| 9 | Trailbreak |
| 10 | Wildheart |
| 11 | Shellskin |
| 12 | Frostjaw Trap |
| 13 | Rattling Shot |
| 14 | Fettering Slash |
| 15 | Harrier's Guise |
| 16 | Marten's Guise |
| 17 | Courser's Guise |
| 18 | Patch Up |

### Coldsight

| Slot | Action |
| ---: | --- |
| 1 | One Button |
| 2 | Measured Shot |
| 3 | Long Draw |
| 4 | Fevered Draw |
| 5 | Fell Shot |
| 6 | Cold Focus |
| 7 | Hushing Shot |
| 8 | Trailbreak |
| 9 | Wildheart |
| 10 | Shellskin |
| 11 | Venom Barb |
| 12 | Volley |
| 13 | Frostjaw Trap |
| 14 | Rattling Shot |
| 15 | Fettering Slash |
| 16 | Harrier's Guise |
| 17 | Marten's Guise |
| 18 | Courser's Guise |
| 19 | Patch Up |

### Fieldcraft

| Slot | Action |
| ---: | --- |
| 1 | One Button |
| 2 | Bloodhook |
| 3 | Gutting Strike |
| 4 | Woundrend |
| 5 | Shrapnel Charge |
| 6 | Bloodtrail Assault |
| 7 | Hushing Shot |
| 8 | Trailbreak |
| 9 | Wildheart |
| 10 | Shellskin |
| 11 | Frostjaw Trap |
| 12 | Fettering Slash |
| 13 | Rattling Shot |
| 14 | Venom Barb |
| 15 | Volley |
| 16 | Harrier's Guise |
| 17 | Marten's Guise |
| 18 | Courser's Guise |
| 19 | Patch Up |

Wildbond and Release Companion stay in the spellbook. Pet combat commands stay on the dedicated pet
bar.

## Shaman level 20 bars

### Thundercall

| Slot | Action |
| ---: | --- |
| 1 | One Button |
| 2 | Arc Bolt |
| 3 | Skybranch |
| 4 | Earthen Jolt |
| 5 | Cinder Jolt |
| 6 | Faultwake |
| 7 | Rime Jolt |
| 8 | Primal Mastery |
| 9 | Unleash Weapon |
| 10 | Thunder Ward |
| 11 | Mending Waters |
| 12 | Shadewolf |
| 13 | Storm Chorus |
| 14 | Pyrebrand Weapon |

### Warspirit

| Slot | Action |
| ---: | --- |
| 1 | One Button |
| 2 | Ancestral Strike |
| 3 | Arc Bolt |
| 4 | Cinder Jolt |
| 5 | Earthen Jolt |
| 6 | Galeheart Weapon |
| 7 | Stonebound Weapon |
| 8 | Unleash Weapon |
| 9 | Rime Jolt |
| 10 | Mending Waters |
| 11 | Thunder Ward |
| 12 | Shadewolf |
| 13 | Storm Chorus |

Galeheart and Stonebound stay next to each other. The player always chooses the posture.

### Spiritmend

| Slot | Action |
| ---: | --- |
| 1 | Mending Waters |
| 2 | Tidecall |
| 3 | Unleash Weapon |
| 4 | Cascading Mend |
| 5 | Ancestors' Return |
| 6 | Thunder Ward |
| 7 | Shadewolf |
| 8 | Earthen Jolt |
| 9 | Rime Jolt |
| 10 | Cinder Jolt |
| 11 | Arc Bolt |
| 12 | Lifespring Weapon |
| 13 | Storm Chorus |

## Priest level 20 bars

### Doctrine

| Slot | Action |
| ---: | --- |
| 1 | Scouring Mercy |
| 2 | Scouring Hymn |
| 3 | Psalm of Warding |
| 4 | Urgent Prayer |
| 5 | Mindfracture |
| 6 | Solemn Prayer |
| 7 | Lingering Grace |
| 8 | Dirge of Decay |
| 9 | Veilstep |
| 10 | Terror Canticle |
| 11 | Whispered Prayer |
| 12 | Litany of Woe |
| 13 | Litany of Resolve |

### Benison

| Slot | Action |
| ---: | --- |
| 1 | Seraphic Vigil |
| 2 | Urgent Prayer |
| 3 | Solemn Prayer |
| 4 | Choirmend |
| 5 | Sunburst Canticle |
| 6 | Psalm of Warding |
| 7 | Lingering Grace |
| 8 | Whispered Prayer |
| 9 | Scouring Hymn |
| 10 | Mindfracture |
| 11 | Veilstep |
| 12 | Terror Canticle |
| 13 | Dirge of Decay |
| 14 | Litany of Woe |
| 15 | Litany of Resolve |

### Vespers

| Slot | Action |
| ---: | --- |
| 1 | One Button |
| 2 | Dirge of Decay |
| 3 | Mindfracture |
| 4 | Litany of Woe |
| 5 | Call Tithefiend |
| 6 | Urgent Prayer |
| 7 | Gloamveil |
| 8 | Psalm of Warding |
| 9 | Veilstep |
| 10 | Terror Canticle |
| 11 | Solemn Prayer |
| 12 | Lingering Grace |
| 13 | Scouring Hymn |
| 14 | Whispered Prayer |
| 15 | Litany of Resolve |

## Test plan

- Pure resolver tests for every priority branch and every supported spec.
- One Button versus direct-cast parity for costs, cooldowns, global cooldown, casts, channels,
  events, damage, resources, and proc use.
- Server command tests proving the client cannot submit the chosen concrete ability.
- World interface parity and command-facet pins.
- Synthetic spellbook row, English tooltip, drag, persistence, deduplication, activation, and
  mobile-page tests.
- Table-driven exact default templates for all nine specs.
- First selection, respec, repeat selection, relog, reconnect, legacy import, saved loadout,
  customized bar, item slot, empty slot, and no-reseed tests.
- Desktop, controller, and mobile reachability checks.
- The 1-target and 3-target balance matrix above on the final fixed head.
