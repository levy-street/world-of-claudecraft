# PRD: Proc-based caster rotations

Status: PBE tuning. Numbers are targets, not release locks.

## Problem

Cryomancy Mage and Elemental Shaman both need a mobile-friendly layer beyond repeating one
cast. Their rotations may share a build-and-release skeleton, but the payoff and the skill
test must feel different.

## Shared mobile contract

- Builders are ordinary rotational casts, with no fast weave.
- Windows last long enough for touch input and agent play.
- State is visible through an existing aura meter and the reinforcement-learning observation.
- Random draws occur only after the owning spec or talent gate.

## Frost: Icicles and Icefall

Rimelance hits store an Icicle, up to five. Icefall is instant, off the global cooldown,
costs no mana, consumes the full bank, and never draws random numbers.

The release is a single-target setup-and-execute:

- A normal target takes 8 Frost damage per Icicle.
- A target frozen by a root or stun takes 20 Frost damage per Icicle.
- A slow or chill is not frozen. Rimelance therefore builds the bank without opening its own
  execute window.
- Icebind creates the intended window: build with Rimelance, freeze one priority target, then
  release Icefall before the root ends.

The frozen check belongs to Icefall and is separate from the global Shatter-style
`critVsRooted` and `vsRootedMult` path. Bosses that reject roots remain baseline targets.
A Frostbite-style boss enabler is deferred until it can justify its extra proc state, random
draw, localization, and observation contract.

## Elemental: Fulmination

Arc Bolt adds charges to an active Thunder Ward, up to nine. Earthen Jolt consumes the ward
for fixed Nature damage per charge. The charge counter is the visible bank and the normalized
observation. Fulmination turns that bank into an escalating area storm:

- Each charge present when Arc Bolt lands gives it 5% Overload chance. Arc Bolt adds its new
  charge at cast completion before the projectile lands, so the first bolt fired from a fresh
  three-charge ward rolls at 20%; the chance reaches 45% at the nine-charge cap.
- A successful Overload instantly repeats half of the Arc Bolt's damage for no mana or global
  cooldown and arcs the same damage to the nearest enemy within 8 yards.
- The proc uses one draw after the Fulmination, Arc Bolt hit, current-hostility, and
  active-ward gates. Choosing the chain target is deterministic by distance and then entity
  id, with no second draw.
- Earthen Jolt consumes every charge and splashes 8 Nature damage per charge across the target
  and all nearby enemies. Consuming the ward resets the Overload ramp to zero.

The decision is how long to ride the rising Overload chance before venting the accumulated
storm across a pack. It adds no action-bar button and no short reaction window.

## Determinism and rollout

Icefall is draw-free. Fulmination draws only for a talented owner's landed Arc Bolt while the
ward has charges, so unrelated builds preserve their random stream. Overload damage, chain
selection, and the Earthen Jolt vent draw nothing. PBE validates damage, proc rate, window
length, and mobile readability before release.
