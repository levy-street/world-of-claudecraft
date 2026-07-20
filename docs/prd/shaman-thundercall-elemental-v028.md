# Shaman Thundercall v0.28.0 PRD

Status: Levy-approved owner design direction, pre-implementation
Owner: Ryze
Target: `release/v0.28.0`, PBE Wave A
Approval: Levy, confirmed 2026-07-20
Parent design: [Shaman v0.28.0 Class Design](../design/shaman-v028-class-design.md)

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
| Primal Mastery | Existing signature action, expanded into a short build-and-vent window without another temporary button. |

Existing spell ranks, costs, ranges, and baseline effects on `release/v0.28.0` remain canonical
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

Chain Lightning does not replace Arc Bolt or become a required baseline action in this direction.
It may remain optional talent space after the charge-to-shock loop is complete, but it cannot build
or vent Thunder charges in a way that makes Arc Bolt and shock choice rotationally irrelevant.

## Primal Mastery

Primal Mastery should transform its existing one-instant-spell identity into a proposed 12-second
storm window:

- Activation makes the next Arc Bolt instant.
- Arc Bolt grants two Thunder charges during the window.
- The first valid vent receives an additional visual and damage payoff.
- The normal builder and vent actions remain on the bar.
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
implementation slice targets and reconciles against `release/v0.28.0`.

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
