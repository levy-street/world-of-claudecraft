# Hunter Fieldcraft v0.28.0 PRD

Status: owner design direction, pre-approval and pre-implementation
Owner: Ryze
Target: `release/v0.28.0`, PBE Wave C
Parent design: [Hunter v0.28.0 Class Design](../design/hunter-v028-class-design.md)

## Specialization gate

Bloodhook, the post-level-5 Gutting Strike handoff, Woundrend, Shrapnel Charge, Hunting Momentum,
and Bloodtrail Assault belong only to Fieldcraft. Selecting Packlord or Coldsight removes these
actions and states before the new specialization kit is resolved.

## Outcome

Fieldcraft is a wound-and-detonation melee Hunter. It uses Bloodhook to enter combat and open a
bleeding wound, builds Focus and Hunting Momentum with close-range weapon attacks, tears the wound
with Woundrend, and converts it into area pressure with Shrapnel Charge.

Its combat rhythm is: close, wound, detonate, disengage, and hunt again.

## Design goals

- Make most rotational damage come from melee range.
- Make Bloodhook the signature entry action: the Hunter travels to the enemy like a charge and applies
  a bleed.
- Use one important bleed as a combat primer, not several damage-over-time timers to maintain.
- Keep Gutting Strike as the Focus and Momentum builder and Woundrend as the defining spender.
- Give Fieldcraft one target-centered Shrapnel Charge for cleave and bleed interaction.
- Keep traps tactical and useful without requiring trap placement every few seconds.
- Make Trailbreak and Bloodhook form a readable exit and re-entry relationship.
- Retain the pet as a coordinated ally without copying Packlord's command rotation.

## Non-goals

- A ranged Hunter rotation with a melee button.
- A tank specialization or permanent boss-tanking posture.
- Multiple grenade actions, ammunition types, or an explosive action bar.
- Several independent bleeds or short maintenance timers.
- Mandatory precision ground targeting.
- A trap-weaving rotation where control abilities are required for ordinary single-target damage.
- A separate Momentum resource bar.

## Player experience

The Hunter selects prey at range and uses Bloodhook to reach it. The impact opens a visible wound.
Gutting Strike builds Focus and Momentum while Woundrend spends Focus to tear the wound and
trigger immediate bleed pressure. Shrapnel Charge turns that prepared target into Fieldcraft's
main area-damage opportunity. When danger arrives, Trailbreak preserves the current Momentum and
arms the next re-entry rather than erasing the rotation.

The player decides whether to remain in melee for a stronger Momentum payoff or leave early for
safety and return with Bloodhook.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Focus | Shared 100 maximum and 5 per second passive regeneration. |
| Bloodhook | Instant 8 to 25-yard gap closer. Pulls the Hunter to the selected enemy like a charge, then applies the primary 12-second bleed. Proposed 20-second cooldown. |
| Gutting Strike | Primary melee builder. A successful hit generates 15 Focus and one Hunting Momentum stack. |
| Woundrend | Defining melee spender. Costs 30 Focus. Against the Hunter's primary bleed, it triggers an immediate bleed tick and refreshes the duration. |
| Hunting Momentum | Eight-second specialization buff with up to three aura stacks. It is not another resource bar. |
| Shrapnel Charge | One instant, target-centered explosive with a proposed 12-second cooldown. It provides area pressure and reacts with the primary bleed. |
| Trailbreak | Shared exit action. It preserves Momentum and arms the next re-entry payoff. |
| Frostjaw Trap | Shared control and setup action. It is not required in the ordinary single-target rotation. |
| Bloodtrail Assault | Fieldcraft offensive cooldown that empowers Bloodhook, bleed interactions, Shrapnel Charge, and automatic pet support without adding a temporary action. |

All names and numbers marked proposed are working PBE values. The action relationships are the
required design.

## Core loop

```text
Bloodhook reaches the target and opens the wound
  -> Gutting Strike builds Focus and Hunting Momentum
  -> Woundrend spends Focus and tears the wound
  -> Shrapnel Charge converts the wound into area pressure
  -> Trailbreak preserves Momentum when the Hunter must leave
  -> Bloodhook or melee re-entry resumes the hunt
```

There is no ranged filler shot in the required Fieldcraft rotation. The grenade provides a useful
ranged action on cooldown without turning Fieldcraft into Coldsight.

## Bloodhook contract

- Bloodhook moves the Hunter to the selected enemy rather than pulling the enemy.
- It requires a valid hostile target between the minimum and maximum ranges.
- The destination uses the existing safe movement and collision rules for gap-closing actions.
- Failure to find a valid destination causes no damage, bleed, Focus, or cooldown consumption.
- Successful arrival applies the primary bleed and a clear impact cue.
- Bloodhook never crosses blocked geometry or grants immunity during travel unless an approved shared
  movement primitive explicitly provides it.
- Boss control immunity does not prevent the Hunter's movement or bleed when the destination is
  otherwise valid.

## Bleed contract

Fieldcraft has one primary bleed per Hunter on each target:

- Bloodhook applies the full-strength 12-second version.
- Woundrend triggers one immediate tick and refreshes it without adding another stack.
- Shrapnel Charge triggers one immediate tick on a bleeding primary target and spreads a
  weaker wound to a limited number of nearby enemies.
- Grenade interaction does not consume the primary bleed.
- Spread bleeds cannot recursively spread themselves or trigger additional grenade effects.
- The target frame shows the primary bleed and duration clearly.

This makes bleeding a primer for weapon and explosive interactions. The player tracks one wound,
not a collection of independent damage-over-time effects.

## Hunting Momentum contract

- A successful Gutting Strike grants one stack, up to three.
- Woundrend refreshes the eight-second duration but does not add a stack.
- At three stacks, the next Woundrend or armed re-entry attack consumes all stacks.
- The starting payoff is 15% additional damage per consumed stack.
- Trailbreak preserves current stacks and arms the re-entry payoff.
- The aura shows stack count, duration, and armed re-entry state on every graphics tier.

Focus pays for the rotation. Momentum communicates when the next melee or re-entry payoff is
strong; it never appears as a second resource bar.

## Shrapnel Charge contract

- Fieldcraft has one required explosive action.
- A normal tap throws it at the selected target, with no ground cursor required.
- It deals useful primary damage and area damage around that target.
- Against the primary bleed, it triggers an immediate tick and spreads a weaker wound nearby.
- Talents may transform the grenade's payoff, but do not add a family of grenade buttons.
- Deterministic target ordering and hard target caps apply to the explosion and spread.

The visual should read as physical shrapnel, metal fragments, and a prepared wound interaction,
not as an unrelated caster fire spell.

## Traps and utility

- Frostjaw Trap remains shared baseline control.
- Fieldcraft can use a trap to prepare a group before Bloodhook or Shrapnel Charge.
- The shared Chain Reaction capstone creates the dedicated trap-damage build.
- Ordinary single-target balance never assumes a trap is available on every damage cycle.
- Mobile default placement remains target-centered, with no power advantage for manual placement.

## Bloodtrail Assault

The offensive cooldown modifies the existing kit for a proposed 12-second window:

- Bloodhook temporarily gains a second charge.
- Bloodhook applies its wound to a limited number of nearby enemies on arrival.
- Woundrend commands an automatic pet follow-up against the wounded target.
- The next Shrapnel Charge receives a larger radius and stronger wound interaction.
- Pet follow-ups cannot generate Focus, Momentum, or recursive procs.

The proposed starting cooldown is 90 seconds. PBE determines whether all four effects are needed or
whether the window should be simplified.

## Role and defensive boundary

Fieldcraft receives enough close-range resilience and dodge to maintain reasonable melee uptime.
Shellskin and Wildheart remain its major shared defensive tools. The specialization
does not gain a taunt, sustained mitigation loop, permanent damage sharing, or other tank-role
contract.

## Presentation and accessibility

- Bloodhook shows the selected target and valid-range state before activation.
- The bleed has a target-frame debuff and wound presentation that does not rely on red alone.
- Momentum uses three persistent aura stacks plus an action glow at maximum.
- The grenade shows its target-centered blast radius without requiring precise ground input.
- Trailbreak clearly shows when re-entry is armed.
- Reduced-motion mode retains static Bloodhook, wound, Momentum, grenade-ready, and re-entry cues.

## Shared talent mappings

- Apex Instinct activates from bloodtrail assault and modifies the next three Focus spenders.
- Overdraw empowers Woundrend as the defining Focus spender.
- Chain Reaction combines the shared Frostjaw Trap with Fieldcraft's area-pressure window.
- Fang Chorus adds optional pet coordination without replacing the melee and wound identity.

The exact 18 class-wide choices remain defined in the parent Hunter design.

## Implementation dependencies

- Shared Hunter Focus conversion and generator or spender classification.
- A safe, deterministic gap-closing movement primitive for Bloodhook.
- One authoritative bleed owner, duration, tick, refresh, spread, and immediate-tick implementation.
- Target-centered area selection for the grenade.
- Momentum and armed re-entry state in offline, online, and headless simulation.
- Tier-independent target debuff, aura, action-bar, Bloodhook, grenade, and wound cues.

Existing behavior on `release/v0.28.0` remains canonical unless this approved PRD names the change.
PR #2165 is source material only and must not replace release behavior by accident.

## Balance knobs

- Bloodhook range, cooldown, bleed duration, tick damage, and arrival damage.
- Gutting Strike Focus generation and Momentum duration.
- Woundrend cost, direct damage, immediate-tick strength, and refresh rules.
- Maximum Momentum stacks and per-stack payoff.
- Grenade cooldown, radius, target cap, direct damage, tick trigger, and spread strength.
- Trailbreak re-entry duration and damage payoff.
- Bloodtrail Assault cooldown, duration, Bloodhook charges, spread cap, and pet follow-up strength.

## PBE acceptance criteria

- Most ordinary rotational damage comes from melee range.
- Bloodhook reliably reaches valid targets and never crosses blocked geometry.
- The player tracks one primary bleed, Focus, and a three-stack aura rather than another resource
  bar or several maintenance timers.
- Woundrend is the defining spender and has a clear interaction with the wound.
- The grenade provides useful cleave without becoming a ranged filler rotation.
- Traps remain valuable without being mandatory in every single-target cycle.
- Trailbreak preserves the rotation and creates an understandable re-entry decision.
- Fieldcraft cannot satisfy the sustained responsibilities of a tank specialization.
- Reduced-motion and low-graphics modes retain every actionable state.
- Mobile players can Bloodhook, build, spend, throw the grenade, disengage, and return without
  precision ground placement.
- PBE validates melee uptime, Focus pacing, bleed clarity, grenade target caps, Bloodhook pathing,
  pet proc safety, burst, and PvP counterplay.
