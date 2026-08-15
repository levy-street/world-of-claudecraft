# Hunter Coldsight v0.29.0 PRD

Status: owner-approved implementation, PBE validation pending
Owner: Ryze
Target: `release/v0.29.0`, PBE Wave C
Parent design: [Hunter v0.29.0 Class Design](../design/hunter-v028-class-design.md)

## Specialization gate

Measured Shot, Long Draw, Fevered Draw, and Cold Focus belong only to Coldsight. Selecting
Packlord or Fieldcraft removes these actions before the new specialization kit is resolved.

## Outcome

Coldsight is the deliberate ranged Hunter. It builds Focus with controlled shots, creates enough
space to commit to a high-value precision attack, and uses instant or channeled pressure when
movement prevents another long cast.

## Design goals

- Deliver the clearest ranged weapon identity among the Hunter specializations.
- Make positioning and cast commitment the primary decisions, not proc reaction speed.
- Preserve a simple builder and spender cadence through the Focus conversion.
- Provide useful pressure while moving without making the deliberate shot irrelevant.
- Modify existing ranged actions before adding buttons.
- Keep the pet available as shared Hunter utility without making it the specialization's main
  damage source.

## Non-goals

- A stationary turret that loses its rotation whenever an encounter requires movement.
- A second precision, aim, or ammunition resource bar.
- Every historical Hunter shot on the action bar at the same time.
- A pet-command rotation that competes with Packlord.
- Sub-second procs or narrow facing checks.

## Player experience

The player uses Measured Shot to build Focus while watching enemy movement and encounter timing.
When there is enough space, the player commits to Long Draw or its approved Coldsight name as the
high-value spender. Fevered Draw keeps pressure moving when another deliberate cast would be unsafe.
Cold Focus compresses that familiar rotation into a readable burst window instead of adding a
temporary attack.

The core decision is whether the current position is safe enough to spend Focus on the deliberate
shot or whether the Hunter should move, control the enemy, and continue building.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Focus | Shared 100 maximum and 5 per second passive regeneration. |
| Measured Shot | Deliberate active generator that grants 20 Focus on a successful hit. |
| Long Draw | High-value Focus spender with a meaningful cast commitment and strong primary-target damage. |
| Fevered Draw | Existing movement-compatible pressure for times when another long cast is unsafe. |
| Fell Shot | Existing instant ranged action for short movement, finishing pressure, or Focus overflow tuning if retained in the final rotation. |
| Cold Focus | Existing specialization offensive cooldown. It accelerates the builder and spender cadence without granting another action. |

The release implementation remains canonical for existing ability behavior until an approved
implementation slice changes it. Focus costs, cast times, and cooldowns are starting PBE tuning
values, not permission to replace the release ability set wholesale.

## Core loop

```text
Measured Shot builds Focus
  -> control or movement creates a safe window
  -> Long Draw spends Focus for primary-target pressure
  -> Fevered Draw or Fell Shot covers required movement
  -> resume the builder and spender cadence
```

- Passive Focus regeneration prevents complete lockout during target loss.
- Measured Shot must have a clear successful-hit rule before it awards Focus.
- The precision spender receives a generous action glow when enough Focus is available.
- Movement tools create time for the next cast but do not directly add hidden damage.

## Cold Focus rules

Cold Focus should improve the existing rotation rather than replace it:

- Measured Shot builds Focus faster during the window.
- The precision-shot cadence accelerates through cost, cast-time, or cooldown tuning.
- The player still uses the normal generator, spender, and movement actions.
- The active window and remaining duration have a persistent aura and action-bar cue.
- Apex Instinct from the shared talent grid uses this same activation.

The final combination of cost, cast-time, and cooldown changes must be selected through PBE. The
cooldown cannot remove all positional decision-making for its entire duration.

## Movement and range rules

- The rotation must remain playable when the Hunter must move for several seconds.
- Long Draw keeps a generous completion window and cannot rely on sub-second stop-and-cast input.
- Fevered Draw and the shared movement row cover forced movement without becoming the optimal
  stationary rotation.
- Minimum-range behavior follows `release/v0.29.0` until an approved class decision changes it.
- Ground placement and narrow facing are never required for baseline single-target output.

## Presentation and accessibility

- Measured Shot clearly communicates a successful Focus-generating hit.
- Long Draw shows cast progress, target, and armed spender state on every graphics tier.
- Fevered Draw distinguishes channel continuation from an interrupted or invalid action.
- Cold Focus has a persistent static aura in reduced-motion mode.
- Touch input never requires selecting a ground point for the core rotation.

## Shared talent mappings

- Apex Instinct activates from Cold Focus and modifies the next three Focus spenders.
- Overdraw maps to the approved Coldsight Focus spender.
- Chain Reaction turns the shared baseline Frostjaw Trap into an area setup window.
- Fang Chorus remains a valid optional pet build without changing the core Coldsight identity.

The exact 18 class-wide choices remain defined in the parent Hunter design.

## Implementation dependencies

- Shared Hunter Focus conversion and generator or spender classification.
- Reusable successful-hit resource award behavior.
- Existing Long Draw, Fevered Draw, Hushing Shot, pet, trap, and aspect implementations from
  `release/v0.29.0` where applicable.
- Tier-independent Focus-ready, spender-ready, and Cold Focus cues.
- Offline, online, and headless parity for cast completion and Focus awards.

PR #2165 contains useful Measured Shot, Long Draw, Fevered Draw, Cold Focus, and presentation work. It is
source material only and must be reconciled against `release/v0.29.0` rather than merged wholesale.

## Balance knobs

- Measured Shot cast time, damage, and Focus generation.
- Precision-spender Focus cost, cast time, primary damage, and cooldown.
- Fevered Draw damage, movement behavior, duration, and cooldown.
- Fell Shot's place in the final rotation and its Focus relationship.
- Cold Focus duration, cooldown, and cadence acceleration.
- Minimum-range pressure and PvP control uptime.

## PBE acceptance criteria

- The ordinary rotation has one obvious generator and one obvious high-value spender.
- Coldsight deals most of its damage at range and does not depend on pet commands.
- Forced movement lowers ideal output without stopping all meaningful actions.
- Cold Focus improves the familiar rotation instead of replacing it with temporary buttons.
- No Focus is awarded on misses, invalid targets, cancelled casts, or failed impacts unless an
  approved shared rule explicitly says otherwise.
- Reduced-motion and low-graphics modes retain every cast, payoff, and cooldown cue.
- Mobile players can build, spend, move, and interrupt without precision ground input.
- PBE validates cast uptime, Focus pacing, minimum-range behavior, burst, and PvP counterplay.
