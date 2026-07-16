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
observation.

This section still describes the pre-recut single-target release. The Elemental follow-up
must turn the bank into an escalating storm with a talent-gated Overload draw and an area
cash-out without adding a second action-bar button.

## Determinism and rollout

Icefall is draw-free. Any Elemental draw must be gated to a Fulmination owner's landed Arc
Bolt so unrelated builds preserve their random stream. PBE validates damage, proc rate,
window length, and mobile readability before release.
