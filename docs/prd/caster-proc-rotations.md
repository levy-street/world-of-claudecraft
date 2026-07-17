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

Rimelance hits store an Icicle, up to five, and have a 15% chance to grant one charge of
Frostbite for 15 seconds. Icefall is instant, off the global cooldown, costs no mana,
consumes the full bank, and never draws random numbers.

The release is a single-target setup-and-execute:

- A normal target takes 8 Frost damage per Icicle.
- A target frozen by a root or stun takes 20 Frost damage per Icicle.
- While Frostbite is active, Icefall treats any target as frozen and consumes the buff. This
  proc path works on bosses and other targets that reject crowd control.
- A slow or chill is not frozen. Rimelance therefore builds the bank without opening its own
  execute window unless Frostbite actually procs.
- Icebind remains the manual path: build with Rimelance, freeze one priority target, then
  release Icefall before the root ends. Frostbite is the second path for any target.

The frozen check belongs to Icefall and is separate from the global Shatter-style
`critVsRooted` and `vsRootedMult` path. Frostbite is a visible single-charge aura with a
normalized remaining-window observation, so players and agents can time the same execute.

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

## Shadow: Litany of Woe

Litany of Woe is a three-second, three-tick Shadow channel with a 30-yard range. The first
tick establishes the channel's damage, then the second and third ticks deal 30% and 60% more
than that first tick. The ramp is calculated from the tick ordinal after the normal per-tick
damage roll, so it consumes no additional random draws. The rising damage already travels
through the ordinary damage-event path, which keeps floating combat text and agent reward
feedback aligned with the authoritative result.

The supporting choice rows keep that identity on existing buttons. Ninefold Litany extends
the commitment to nine seconds and nine ticks. Woe's Crescendo instead rewards reaching the
baseline final tick with a fixed, draw-free area burst. Deathless Dirge makes Mindfracture
refresh the priest's own Dirge of Decay without resnapshotting it or resetting its tick
cadence. Plague Chorus competes with that upkeep choice and instead copies the current Dirge
snapshot to enemies within 8 yards. Refreshing and spreading are both draw-free.

## Determinism and rollout

Icefall is draw-free. Frostbite draws exactly once after a Cryomancy owner's landed Rimelance
and nowhere else, so other spells and builds preserve their random stream. Fulmination draws
only for a talented owner's landed Arc Bolt while the ward has charges. Overload damage,
chain selection, and the Earthen Jolt vent draw nothing. PBE validates damage, proc rate,
window length, and mobile readability before release. Litany's ordinal ramp is draw-free;
each tick retains exactly the one damage roll the baseline channel already consumed.
