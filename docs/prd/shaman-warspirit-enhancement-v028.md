# Shaman Warspirit v0.28.0 PRD

Status: Levy-approved owner design direction, pre-implementation
Owner: Ryze
Target: `release/v0.28.0`, PBE Wave A
Approval: Levy, confirmed 2026-07-20
Parent design: [Shaman v0.28.0 Class Design](../design/shaman-v028-class-design.md)

## Specialization gate

Galeheart Weapon, Stonebound Weapon after the level 5 handoff, Ancestral Strike, Stormcast, and
every off-tank rider belong only to Warspirit. Selecting Thundercall or Spiritmend removes both
postures and all posture state before the new specialization kit is resolved.

## Outcome

Warspirit is a dual-wield melee spellcaster with two deliberate weapon postures. Galeheart creates
a reliable three-hit offensive rhythm and earns instant spells. Stonebound keeps the melee-to-cast
rhythm but trades Galeheart damage for the mitigation and threat needed to off-tank.

## Design goals

- Make melee attacks visibly earn the next spell.
- Use the existing one-handed dual-wield system so both hands feed one cadence.
- Add Galeheart without introducing high-variance burst or another action.
- Consolidate weapon enhancements into Galeheart offense and Stonebound defense.
- Let each earned instant become damage, control, or emergency healing.
- Support small-group tanking, raid-add control, and emergency tank coverage.
- Keep dedicated tank specializations stronger at sustained boss mitigation.

## Non-goals

- A full raid main-tank role equal to Protection specializations.
- Simultaneous Galeheart and Stonebound benefits.
- A separate Maelstrom resource bar.
- Random Galeheart streaks that dominate balance or PvP outcomes.
- A second melee rotation layered on top of the melee-to-cast rhythm.
- Dual wielding two-handed weapons.
- Additional reactive off-tank buttons for every incoming attack.

## Player experience

With Galeheart active, landed main-hand and off-hand base attacks build one shared three-hit
cadence. The third landed attack triggers two echo strikes and arms the next Arc Bolt, Jolt, or
Mending Waters as an instant and cheaper cast. Ancestral Strike advances the cadence faster.

Applying Stonebound is a visible role decision. The same cadence still earns instant spells, but
the echo burst disappears. Armor, mitigation, threat, Earthen Jolt snap threat, and Thunder Ward
damage smoothing take its place.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Mana | Canonical Shaman resource. Earned casts are cheaper, not a second resource. |
| One-handed dual wield | Warspirit equipment permission. Each landed base swing from either hand adds one cadence step. |
| Galeheart Weapon | Warspirit offensive enhancement. Every third landed melee attack triggers two echo strikes. |
| Stonebound Weapon | Warspirit off-tank enhancement. Replaces Galeheart and enables the defensive package. |
| Ancestral Strike | Existing signature melee strike. Counts as two steps toward the next cadence trigger. |
| Stormcast | Twelve-second aura armed at the third cadence step. Makes the next Arc Bolt, Jolt, or Mending Waters instant and 50% cheaper. |
| Earthen Jolt | Damage or control cast in Galeheart, snap threat and short forced-target effect in Stonebound. |
| Thunder Ward | Canonical retaliation in Galeheart, additional damage smoothing in Stonebound. |

Names and numbers marked proposed remain PBE tuning values. The posture choice, three-step cadence,
and earned-spell decision are required.

## Weapon-enhancement contract

- Warspirit may dual wield one-handed weapons through the existing equipment and auto-attack
  rules. It never gains two-handed dual wielding.
- A landed main-hand or off-hand base swing adds one cadence step. Existing off-hand damage and
  miss rules remain canonical.
- A shield remains legal in the off-hand. Stonebound can trade the second weapon's cadence for the
  shield's canonical block value; the posture does not invent a shield attack.
- Leaving Warspirit makes an equipped off-hand weapon illegal and routes it through the existing
  safe off-hand sanitation path without deleting the item.
- Warspirit has Galeheart Weapon and Stonebound Weapon available.
- Applying one removes the other immediately.
- The selected enhancement is visible on the weapon, character, aura list, and action state.
- Changing specialization removes Warspirit-only weapon state cleanly.
- Pyrebrand and Lifespring are not available while Warspirit is selected.
- Rimebound is no longer a separate enhancement; Rime Jolt retains frost control.
- Existing action bars migrate removed or unavailable enhancement actions without broken slots.

## Galeheart contract

- Every third landed base melee attack from either equipped weapon triggers two immediate echo
  strikes.
- A successful Ancestral Strike adds two cadence steps.
- The cadence wraps after three. Ancestral Strike may trigger at most one Galeheart event and carries
  any one-step overflow into the next cycle.
- Echo strikes deal a tunable percentage of normal weapon damage.
- Echo strikes cannot trigger Galeheart, add cadence steps, arm Stormcast, grant Mana, or recursively
  trigger other melee echoes.
- Misses, invalid targets, and out-of-range attacks add no steps.
- The third-step trigger and Stormcast readiness use one compact presentation.

The starting echo target is 50% normal weapon damage per echo, subject to PBE.

## Stormcast contract

- The third cadence step arms Stormcast in either weapon posture.
- Stormcast lasts 12 seconds and has no sub-second reaction requirement.
- The next Arc Bolt, Earthen Jolt, Cinder Jolt, Rime Jolt, or Mending Waters becomes instant and
  costs 50% less Mana.
- The first valid eligible cast consumes Stormcast after the action succeeds.
- Cancelled, invalid, or failed casts do not consume it.
- A new third-step trigger refreshes Stormcast but cannot bank multiple instant spells.

The player chooses damage, damage over time, control, or emergency healing each cycle.

## Stonebound off-tank contract

Stonebound is an explicit damage tradeoff with proposed starting values:

- Increases armor by 30%.
- Reduces incoming damage by 10%.
- Increases threat generated by weapon attacks and damaging actions by 100%.
- Earthen Jolt forces its target to attack the Shaman for 3 seconds and provides snap threat.
- Thunder Ward retaliation grants a brief additional damage-smoothing effect.
- Stormcast remains available for instant Mending Waters self-sustain.
- Galeheart echo strikes are completely unavailable.

Leaving Stonebound immediately removes armor, mitigation, threat, forced-target riders, and shield
smoothing. Existing threat already generated remains on enemies under the canonical threat system.

## Role boundary

Warspirit may:

- Tank ordinary leveling and suitable small-group encounters.
- Hold raid adds when assigned.
- Cover a dead or displaced tank briefly.

Warspirit must not:

- Match a dedicated tank's sustained boss mitigation.
- Gain permanent tank benefits without Stonebound active.
- Ignore equipment, encounter, or healing requirements through self-sustain.
- Retain Galeheart-level damage while using the defensive package.

Dedicated benchmark tests compare threat, effective health, spike survival, sustained damage
taken, self-healing, and damage output against approved tank and melee-DPS targets.

## Mobile and presentation contract

- The cadence uses a three-stage weapon and aura cue, not another bar.
- Galeheart echoes are automatic after a normal melee input.
- Stormcast shows the eligible spell actions and persists for 12 seconds.
- Stonebound uses stone armor and weapon presentation that does not rely on color alone.
- The forced-target and threat state are visible without requiring combat-log inspection.
- Reduced-motion mode retains static cadence, Stormcast, Galeheart, and Stonebound cues.

## Shared talent integration

- Movement talents support melee pursuit through Shadewolf or Jolt control.
- Defensive talents may strengthen Stonebound but cannot make its tank package available in
  Galeheart.
- Kit talents may modify the cadence, shocks, shields, or enhancements without adding another bar.
- Capstones should distinguish offensive echoes, earned spellcasting, and defensive posture.

The exact 18 class-wide choices are defined in the parent Shaman design.

## Implementation dependencies

- Spec-specific action availability and action-bar migration.
- Deterministic melee cadence with overflow and successful-hit rules.
- Non-recursive echo strikes and one authoritative Stormcast aura.
- Stonebound armor, mitigation, threat, forced-target, and cleanup behavior.
- Offline, online, and headless parity for every posture and cadence transition.
- Tier-independent aura, weapon, action-bar, and threat cues.

PR #1980 is source material for Skyrend and shared proc primitives only. Every implementation slice
targets and reconciles against `release/v0.28.0`.

## Balance knobs

- Cadence length and Ancestral Strike step contribution.
- Galeheart echo damage and proc restrictions.
- Stormcast duration, Mana discount, and eligible spells.
- Stonebound armor, reduction, threat multiplier, and shield smoothing.
- Earthen Jolt forced-target duration and snap-threat amount.
- Galeheart and Stonebound damage-output separation.

## PBE acceptance criteria

- Every valid third melee step triggers exactly one Galeheart event in Galeheart posture.
- Echoes cannot recursively trigger themselves, cadence, Stormcast, or Mana effects.
- The same cadence arms Stormcast without a second resource bar.
- Stonebound removes Galeheart and provides a visible, measurable defensive tradeoff.
- Warspirit can tank approved small-group content and raid adds within benchmark limits.
- A dedicated tank remains safer for sustained boss tanking.
- Leaving Stonebound removes every posture-only benefit immediately.
- Mobile players can attack, choose an earned spell, and change posture without extra reactive
  buttons.
- PBE validates melee uptime, burst, Mana pacing, threat, spike survival, host parity, and PvP.
