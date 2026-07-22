# Hunter Packlord v0.28.0 PRD

Status: owner design direction, pre-approval and pre-implementation
Owner: Ryze
Target: `release/v0.28.0`, PBE Wave C
Parent design: [Hunter v0.28.0 Class Design](../design/hunter-v028-class-design.md)

## Specialization gate

Pack Command, Pack Ferocity, Unleash Beast, and Howling Rage belong only to Packlord. Selecting
Coldsight or Fieldcraft removes these actions and states before the new specialization kit is
resolved. Shared pet care remains available to every Hunter.

## Outcome

Packlord makes the active pet the Hunter's primary weapon. The Hunter builds the beast through
repeated commands, sees it become larger and redder, unleashes it in a heavy clap and cleaving
frenzy, then watches it calm before beginning the cycle again.

## Design goals

- Make the pet deliver the specialization's most visible single-target and area impact.
- Give the player one clear command cadence instead of a separate pet rotation.
- Show Ferocity as a Hunter buff while the pet mirrors each stage through its model and effects.
- Keep the payoff valuable against one boss and a group of enemies.
- Fit the entire required rotation on a mobile action layout.
- Preserve the shared Focus economy and every legal existing tamed pet.

## Non-goals

- Multiple simultaneous combat pets or a pet stable.
- Family-specific rotations or Unleash attacks in v0.28.0.
- Manual high-frequency pet abilities.
- Pet growth that changes collision, reach, targeting, pathing, or camera behavior.
- An autonomous pet that reaches maximum Ferocity without Hunter commands.

## Player experience

The Hunter orders the pet to attack with Pack Command. Each successful command makes the beast
more dangerous and visibly less controlled. At maximum Ferocity, the same action becomes Unleash
Beast. The pet immediately claps the area around itself, enters a short cleaving frenzy, then
shrinks and returns to its calm state.

The Hunter decides whether to unleash immediately or hold the armed beast for the next group or
damage window. The armed state must last long enough that touch input, movement, and target changes
do not force a rushed reaction.

## Required kit

| Action or state | Starting PBE behavior |
|---|---|
| Focus | Shared 100 maximum and 5 per second passive regeneration. |
| Pack Command | Instant pet command with a short cooldown. A successful pet strike generates 20 Focus and one Ferocity stage. |
| Fell Shot | Instant 25 Focus spender used while Pack Command recovers. During the frenzy it commands an additional pet cleave. |
| Pack Ferocity | Three stages stored as a visible buff on the Hunter. The active pet mirrors the Hunter's current stage through growth, tint, and effects. |
| Unleash Beast | Replaces Pack Command at maximum Ferocity. Commands an immediate primary-target hit and area clap, then begins the frenzy. |
| Howling Rage | Existing signature action and proposed 90-second offensive cooldown. It immediately reaches maximum Ferocity and empowers the next clap and frenzy. |

Exact cooldown, damage, duration, and radius values remain tuning knobs. The action relationships
and transformed Pack Command slot are the required design.

## Ferocity state machine

```text
Calm
  -> successful Pack Command: Ferocity 1
  -> successful Pack Command: Ferocity 2
  -> successful Pack Command: Ferocity 3, Unleash Beast armed
  -> Unleash Beast: immediate clap and short frenzy
  -> frenzy ends: Calm
```

- Pet basic attacks maintain the current Ferocity window but never add stages.
- Pack Command grants nothing if there is no living pet, no valid target, or no successful strike.
- At maximum Ferocity, further commands cannot add hidden overflow stages.
- Ferocity cannot rebuild during the frenzy.
- The Hunter owns the authoritative Ferocity stage. The active pet only reflects that stage and never
  owns or persists it independently.
- Pet death, dismissal, respec, or loadout change immediately clears the state.

## Unleash and cooldown rules

Unleash Beast must hit the primary target hard enough to remain worthwhile in a boss fight. The
area clap and frenzy cleave provide the group payoff, but cannot be the only meaningful damage.

Howling Rage uses the existing action slot and does not grant another temporary button:

1. It immediately arms Unleash Beast.
2. It increases the next clap and extends the following frenzy.
3. Fell Shot continues to command extra cleaves during that frenzy.
4. The pet must calm before another Ferocity cycle begins.

The starting PBE target is a 90-second cooldown and a roughly 12-second empowered window.

## Targeting and proc safety

- Pet cleave selects targets deterministically under the shared simulation rules.
- The primary target always receives the full commanded strike.
- Cleave and echo strikes cannot duplicate owner procs or recursively trigger themselves.
- Pet echoes cannot generate Focus or Ferocity unless the originating action explicitly says so.
- A target becoming invalid between command and impact must fail cleanly without awarding state.
- Online snapshots must preserve the same Hunter-owned Ferocity stage and transformed action state as
  offline simulation. Pet presentation derives from that replicated owner state.

## Presentation and accessibility

| Stage | Required presentation |
|---|---|
| Ferocity 1 | One Hunter buff stack; pet has a slightly larger posture and faint warm tint. |
| Ferocity 2 | Two Hunter buff stacks; pet is clearly larger with a stronger red tint and heavier effects. |
| Ferocity 3 | Three Hunter buff stacks; pet reaches its largest safe scale and saturated red state, while Unleash glows. |
| Frenzy | Distinct clap, faster attack presentation, persistent frenzy aura. |
| Calm | No Hunter Ferocity buff; pet returns to normal model scale and color. |

Color is never the only signal. The Hunter buff stack and transformed action remain readable even if
the pet is obscured. Reduced-motion mode retains the static pet size and outline. Growth must work with
every legal pet model without obscuring enemies or party members.

## Shared talent mappings

- Apex Instinct activates from Howling Rage and modifies the next three Focus spenders.
- Overdraw empowers Fell Shot and its normal pet command interaction.
- Chain Reaction uses the shared baseline Frostjaw Trap and Focus spenders.
- Fang Chorus pet echoes cannot generate Ferocity or recursively trigger Unleash effects.

The exact 18 class-wide choices remain defined in the parent Hunter design.

## Implementation dependencies

- Existing pet ownership, taming, dismissal, revival, movement, and attack systems.
- Shared Hunter Focus conversion and generator or spender classification.
- One authoritative Ferocity state on the Hunter in the simulation and online snapshot seam.
- Action transformation from Pack Command to Unleash Beast.
- A Hunter buff aura, action-bar cue, and derived pet presentation.
- Pet scale, tint, outline, clap, frenzy, and calming presentation with gameplay-neutral graphics
  settings.

PR #2165 is implementation reference material only. Work must reconcile against and target
`release/v0.28.0`, which remains canonical.

## Balance knobs

- Pack Command cooldown and Focus generation.
- Ferocity duration and maximum hold time.
- Growth-stage pet damage and cleave scaling.
- Unleash primary damage, area damage, radius, frenzy duration, and attack speed.
- Howling Rage cooldown, clap multiplier, and frenzy extension.
- Fell Shot cost and frenzy echo strength.

## PBE acceptance criteria

- A player can understand the complete build, unleash, and calm loop without reading combat logs.
- Pack Command cannot generate Focus or Ferocity from an invalid command.
- The specialization remains useful on one target and clearly stronger at pet cleave than the other
  Hunter specializations.
- Every currently legal pet completes every presentation and reset transition.
- Pet death, dismissal, respec, disconnect, and reconnect cannot strand Ferocity or visual state.
- The Hunter buff remains readable when the pet is obscured, off-screen, or surrounded by enemies.
- Reduced-motion and low-graphics modes show every actionable state.
- Mobile players can run the core rotation without opening a pet action bar.
- PBE validates Focus pacing, armed-state hold time, pet pathing, proc recursion, and PvP burst.
