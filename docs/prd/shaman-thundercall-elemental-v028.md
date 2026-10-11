# Shaman Thundercall v0.29.0 PRD

Status: owner-approved implementation, PBE validation pending
Owner: Ryze
Target: `release/v0.29.0`, PBE Wave A
Approval: Levy, confirmed 2026-07-20
Parent design: [Shaman v0.29.0 Class Design](../design/shaman-v028-class-design.md)

## Specialization gate

Pyrebrand Weapon, Thunder charges, Faultwake's vent behavior, and Primal Mastery belong only to
Thundercall. Selecting Warspirit or Spiritmend removes the enhancement and offensive bank before
the new specialization kit is resolved.

## Outcome

Thundercall builds electrical pressure through Arc Bolt, stores it as visible Thunder charges, and
chooses when and how to vent it. Earthen Jolt is the immediate single-target discharge, while
Faultwake is the prepared area discharge.

## Design goals

- Give Thundercall one readable build-and-vent decision during ordinary combat.
- Use Mana as the only resource bar and aura stacks for stored electricity.
- Keep Arc Bolt, Thunder Ward, Earthen Jolt, Faultwake, and Primal Mastery central.
- Allow partial discharge for urgency and full discharge for efficiency.
- Make the single-target and area payoffs use different existing actions.
- Keep movement and target loss from erasing the entire bank.

## Non-goals

- A second elemental-energy resource bar.
- Four attunement bars or a rotation that constantly swaps elemental stances.
- Random charge generation that consumes simulation draws in unrelated builds.
- Mandatory precision ground placement for ordinary single-target output.
- Several new lightning attacks that duplicate Arc Bolt or Earthen Jolt.

## Player experience

Arc Bolt makes Thunder Ward visibly more charged. The Shaman may discharge early through Earthen
Jolt when a target must die now, or continue building until the storm is full. At maximum, the
player chooses a concentrated Earthen Jolt against one enemy or an empowered Faultwake against a
group. Primal Mastery accelerates the same actions instead of replacing the rotation.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Mana | Canonical Shaman resource and spell-cost system. |
| Arc Bolt | Primary cast-time builder. A successful impact grants one Thunder charge. |
| Thunder charges | Five-stack specialization aura presented through Thunder Ward, not a resource bar. Charges have no short expiry. |
| Earthen Jolt | Instant single-target vent. Consumes all Thunder charges for additional damage. |
| Faultwake | Target-centered area vent. Consumes all Thunder charges for stronger area pressure. |
| Pyrebrand Weapon | Thundercall-only weapon enhancement supporting spell pressure. |
| Unleash Weapon | Shared Shaman action. With Pyrebrand active, deals Fire damage with a 30% Spell Power coefficient and grants two Thunder. |
| Primal Mastery | Existing signature action, expanded into a short build-and-vent window without another temporary button. |

Existing spell ranks, costs, ranges, and baseline effects on `release/v0.29.0` remain canonical
unless this PRD explicitly names a specialization change.

## Thunder-charge contract

- A successful Arc Bolt impact grants one charge, up to five.
- A miss, cancelled cast, invalid target, or failed impact grants no charge.
- Charges belong to the Shaman and persist through target changes.
- Charges do not expire during ordinary movement or brief target loss.
- Earthen Jolt and Faultwake consume the full current bank after their cast succeeds.
- Failed or invalid vents consume nothing.
- Thunder charges are actionable specialization stacks. Thunder Ward's existing defensive
  retaliation remains canonical and cannot spend the offensive bank by accident.
- The full-bank state persists until a valid vent and has both an aura and action-bar cue.

The starting Earthen Jolt tuning target is 25% additional direct damage per consumed charge. The
Faultwake coefficient, pulse behavior, and target cap remain PBE knobs.

## Core loop

```text
Arc Bolt builds Thunder charges
  -> vent early through Earthen Jolt when immediate damage matters
  -> or continue to five charges
  -> choose Earthen Jolt for one target or Faultwake for a group
  -> begin building again
```

Cinder and Rime Jolts retain their damage-over-time and control jobs. They do not consume Thunder
charges in the starting design, so utility does not accidentally erase the main payoff.

Skybranch is the Thundercall-only Chain Lightning action at level 14. It hits the selected enemy and
up to two nearby enemies, then grants exactly one Thunder for the whole landed cast. It never grants
one charge per bounce. Its six-second cooldown keeps Arc Bolt as the repeatable builder, and it does
not vent Thunder or replace the Earthen Jolt and Faultwake choice.

## Primal Mastery

Primal Mastery should transform its existing one-instant-spell identity into a proposed 12-second
storm window:

- Activation makes the next Arc Bolt or Skybranch instant.
- Arc Bolt grants two Thunder charges during the window.
- The first valid vent receives an additional visual and damage payoff.
- The normal builder and vent actions remain on the bar.
- Primal Exaltation halves the cast time of both Arc Bolt and Skybranch during its window.
- The proposed starting cooldown is 90 seconds.

PBE may reduce the duration or charge acceleration. It must not remove the need to choose the vent
or introduce another temporary action.

## Area targeting and mobile behavior

- Faultwake defaults to the selected enemy's location.
- When there is no valid enemy target, a mobile-safe self-centered cast may be used if the final
  shared ground-action contract supports it.
- Optional manual placement uses the same range, radius, and effect as the default cast.
- Manual input cannot confer a larger or stronger Faultwake.
- Full-charge and vent-ready cues remain static and readable with reduced motion.

## Presentation and accessibility

- Thunder Ward becomes progressively brighter and more electrically active across five stages.
- The aura shows an exact numeric stack count and does not rely on brightness or color alone.
- At five charges, Earthen Jolt and Faultwake receive persistent action glows.
- Vents show the number of charges consumed through scale and sound without hiding the result on
  low graphics settings.
- Reduced-motion mode retains the static ward intensity, aura count, and armed actions.

## Shared talent integration

- Movement talents must preserve Thunder charges.
- Shield and shock talents must distinguish defensive Thunder Ward charges from the offensive bank.
- The major-cooldown row may amplify Primal Mastery but should reuse its action.
- The capstone row should support concentrated venting, area venting, or elemental utility without
  adding another resource bar.

The exact 18 class-wide choices are defined in the parent Shaman design.

## Implementation dependencies

- Existing Arc Bolt, Thunder Ward, Earthen Jolt, Faultwake, Pyrebrand, and Primal Mastery actions.
- One authoritative Thunder-charge aura in offline, online, and headless simulation.
- Deterministic successful-impact charge grants and successful-cast consumption.
- Target-centered Faultwake defaults with input parity.
- Tier-independent aura and action-bar cues.

PR #1980 is source material for Stormbank and shared bank or consume primitives only. Every
implementation slice targets and reconciles against `release/v0.29.0`.

## Balance knobs

- Maximum Thunder charges and Arc Bolt charges per hit.
- Earthen Jolt damage per consumed charge.
- Faultwake damage, pulse count, radius, target cap, and charge scaling.
- Charge persistence through encounter transitions.
- Pyrebrand spell contribution.
- Primal Mastery cooldown, duration, instant cast, and charge acceleration.

## PBE acceptance criteria

- The player can identify the current bank and both valid payoff actions without combat logs.
- Every valid Arc Bolt grants exactly the intended charges and every invalid one grants none.
- Failed vents consume no charges; successful vents consume the bank exactly once.
- Earthen Jolt is the preferred single-target vent and Faultwake the preferred grouped vent.
- Movement and target changes do not erase the bank.
- Defensive Thunder Ward behavior cannot consume or duplicate offensive charges.
- Mobile players can build and vent without precision ground placement.
- Reduced-motion and low-graphics modes retain every actionable cue.
- PBE validates Mana pacing, vent timing, Faultwake targeting, burst, host parity, and PvP damage.

## v0.44.0 rework

Status: implementation PR against `release/v0.44.0`. Owner request: Thundercall does not feel good
to play next to the other damage specs.

### Evidence (live parses, 2026-09-17 to 2026-09-23)

- Adoption: 4 elemental heroic raid kills from 2 characters all week, against 33 enhancement,
  55 balance and 66 fire kills on the same bosses. The census holds 167 elemental characters, at
  the lowest average level of any damage caster.
- Output: since 2026-09-01, heroic Nythraxis medians are elemental 93, balance 154, fire 148
  DPS. Normal Ignivar arena: elemental 94, balance 206, fire 197.
- Shape: Arc Bolt plus Earthen Jolt are 85 to 90 percent of elemental damage. Cinder Jolt deals
  nothing (it shares the shock cooldown with the vent and has no payoff), and players cancel 15
  to 20 percent of their Arc Bolts, against 0 to 4 cancels per fight for fire and balance in the
  same raids.
- The pre-rework bench already had Thundercall level with Vespers (160.5 against 160.6 DPS on the
  120 sec level-20 boss), so the gap is bench-to-live transfer, not raw coefficients.

### Changes

| Change | Classic source | Behavior |
|---|---|---|
| Partial vents | this PRD ("vent early") | Earthen Jolt and Faultwake spend any Thunder, scaling per charge (Jolt 25 percent, Faultwake 20 percent per Thunder). Primal Mastery's vent bonus, Echoing Elements, Deep Reservoir and Living Weapon still need a full bank of 5. |
| Arc Overload (`lightning_overload`, passive, level 10) | TBC Lightning Overload 5/5 | Arc Bolt and Skybranch hits that deal damage have a 20 percent chance to strike their first target again for 50 percent of that hit's damage and grant 1 Thunder. |
| Lightning Mastery (spec baseline) | Classic Lightning Mastery 5/5 | Arc Bolt and Skybranch cast one third faster (rank-4 Arc Bolt 3.0 to 2.0 sec before haste). |
| Magma Burst (`lava_burst`, level 12, rank 2 at 20) | Wrath Lava Burst | 2.0 sec cast, 8 sec cooldown, Fire. Always crits a target carrying the caster's own Cinder Jolt. Grants no Thunder. |
| Magma Surge | Cataclysm Lava Surge | Each Cinder Jolt tick that deals damage has a 20 percent chance to reset Magma Burst and make the next one instant (10 sec window, action-bar glow). No roll while Magma Burst is being hard-cast. |
| Stormbreak (`thunderstorm`, level 16) | Wrath Thunderstorm | Instant, 45 sec cooldown: Nature damage and a 50 percent slow for 5 sec within 10 yards, and 8 percent of maximum Mana back. The knockback is not modelled (no mob displacement primitive). |
| Offensive spec bonus | tuning | `spec_output_tuning.ts` elemental spell bonus 0.13 to 0.05, paying for the above. |

Every new rng draw is gated on a Thundercall caster who knows the relevant ability; the parity
gate shows only the `shaman_engines` golden moving.

### Bench (owned-class probe, 3 seeds, DPS)

| Scenario | Before | After | Vespers |
|---|---|---|---|
| 1 target, 15 sec | 148.7 | 151.4 | 151.8 |
| 1 target, 60 sec | 153.9 | 174.0 | 162.7 |
| 3 targets, 60 sec | 207.6 | 216.7 | 227.2 |
| Level-20 boss, 120 sec | 160.5 | 175.6 | 160.6 |
| Level-22 boss, 120 sec | 144.9 | 163.9 | 156.1 |

The single-target bench lands inside the existing role band (at most 1.1 times Vespers). The bench
plays perfectly, so it cannot show the transfer gain the rework targets; the live check is the
next week of heroic parses (elemental cancel rate, damage share outside Arc Bolt, median DPS).

### Stormkindled set rework

Measured in Ignivar best in slot on the 120 sec level-20 boss, the old Stormkindled Regalia was worth
+6.4 DPS (2.7 percent), against Moonscorch's +17.7 (8.3 percent) for balance. Its 2pc only worked
through Unleash Weapon, which the bench never pressed and live wearers pressed at a fraction of its
availability, and Arc Overload now makes Thunder plentiful anyway.

| Bonus | Before | After |
|---|---|---|
| 2 pieces | Unleash Weapon on Pyrebrand grants 3 Thunder | Arc Overload triggers 30 percent of the time (was 20) |
| 4 pieces | Earthen Jolt's bonus per Thunder rises to 30 percent | unchanged, and Magma Burst deals 20 percent more damage (delivered) |

Both 2pcs keep the caster pushback rider. The reworked set measures 259.0 against 235.9 DPS without
it: +23.1 DPS (9.8 percent). The owned-class bands wear the Nythraxis PBE kit, so no existing band
moves.

### Follow-ups

- A Fire Elemental cooldown (the Wrath Fire Elemental Totem) through the existing guardian summon
  path, as its own PR.
- A class-wide totem system is a separate design pass.
