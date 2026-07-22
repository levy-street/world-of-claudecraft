# Hunter v0.28.0 Class Design

Status: owner design direction, pre-implementation
Owner: Ryze
Target: v0.28.0, PBE Wave C

## Purpose

Hunter should support three clearly different combat relationships with range, the pet, and the
target. Selecting a specialization must change the rotation and its decisions, not only alter
damage percentages.

- Packlord makes the beast the primary weapon.
- Coldsight is a deliberate ranged marksman.
- Fieldcraft is a mobile melee hunter and trapper.

This document defines specialization identity. The six talent rows remain class-wide and must be
useful to all three specializations.

## Specialization PRDs

This class document owns Focus, shared actions, class-wide talent rows, and the rules that apply to
all Hunters. The specialization PRDs own each rotation, payoff, presentation, balance knobs, and
PBE acceptance criteria:

- [Packlord](../prd/hunter-packlord-beast-mastery-v028.md)
- [Coldsight](../prd/hunter-coldsight-marksmanship-v028.md)
- [Fieldcraft](../prd/hunter-fieldcraft-survival-v028.md)

When a shared rule and a specialization PRD disagree, this class document wins. Existing ability
behavior on `release/v0.28.0` remains canonical unless a PRD explicitly identifies an approved
change.

## Design principles

### Mobile responsiveness is a hard requirement

- Prefer modifying existing Hunter and pet actions over adding buttons.
- No specialization adds another resource bar beyond Focus.
- A specialization may add at most one required rotational button beyond its signature and
  selected talent grants.
- Proc, stack, and payoff windows must remain readable and usable on touch input. No sub-second
  reactions or rapid weaving requirements.
- Every actionable state needs a persistent aura or action-bar cue that survives reduced motion
  and low graphics settings.
- Ground placement and narrow facing requirements should be optional depth, not required for the
  baseline rotation.
- Pet play must not require a separate high-frequency pet action bar.

### Class-wide talent rows

- Levels 5, 8, 11, 14, 17, and 20 follow movement, defense, control, kit amplification, major
  cooldown, and capstone themes.
- Every option must help Packlord, Coldsight, and Fieldcraft at its unlock level.
- A spec-specific primary effect requires a useful fallback for the other two specs.
- Specialization rotations belong in automatic passives, signatures, and masteries, not in dead
  class-wide choices.

## Shared resource: Focus

Hunter keeps Focus as its only class resource. Focus regenerates slowly on its own so movement or
target loss never completely locks the player out, while each specialization has a deliberate
active generator:

- Packlord uses Pack Command to build Focus through the pet.
- Coldsight uses Measured Shot to build Focus for precision attacks.
- Fieldcraft builds Focus through its primary melee attack.

Focus governs the short rotation. Pack Ferocity, Coldsight timing, and Hunting Momentum are
specialization states shown through auras and character presentation, not additional resource
bars.

Starting PBE economy, subject to tuning:

- Maximum Focus: 100.
- Passive regeneration: 5 Focus per second.
- Pack Command and Measured Shot: generate 20 Focus.
- Fell Shot: costs 25 Focus.
- Gutting Strike: generates 15 Focus.
- Woundrend: costs 30 Focus.

## Spec-specific action ownership

The shared Hunter kit keeps pet care, Fell Shot, Rattling Shot, Fettering Slash, Hushing Shot,
guises, Trailbreak, Shellskin, Wildheart, and Frostjaw Trap. The redesigned rotation actions are
exclusive to their owning specialization:

| Specialization | Exclusive actions and states |
|---|---|
| Packlord | Pack Command, Pack Ferocity, Unleash Beast, and Howling Rage |
| Coldsight | Measured Shot, Long Draw, Fevered Draw, and Cold Focus |
| Fieldcraft | Bloodhook, Gutting Strike after the level 5 handoff, Woundrend, Shrapnel Charge, and Bloodtrail Assault |

The implementation keeps shipped internal ability ids where practical, but the player-facing
names above are canonical for this redesign. A wrong-spec character must not know, place, cast,
or retain an exclusive action after a specialization change.

## Packlord

### Fantasy

The Hunter directs the fight, but the beast delivers the most visible impact. The pet should feel
materially stronger, especially against groups, rather than behave like a passive damage-over-time
effect following the player.

### Core loop

1. Pack Command orders the pet to strike, generates Focus, and builds one Pack Ferocity stage.
2. At each Ferocity stage, the pet becomes larger, more aggressive, and increasingly red.
3. The pet's primary attacks gain stronger cleave as it grows.
4. At maximum Ferocity, the Pack Command action changes into Unleash Beast.
5. Unleash Beast releases a large stomp, clap, or cleaving frenzy based on the pet's stored power.
6. When the unleashed window ends, the pet calms down, returns to normal size and color, and the
   Hunter's Ferocity buff resets.

The loop should run through the Hunter action bar and autonomous pet behavior. Pack Command is the
one required pet instruction; the player must not manage a separate high-frequency pet action bar.

### Builder

Pack Command is Packlord's Focus and Pack Ferocity builder:

- It is an instant command that makes the active pet strike the Hunter's target.
- A successful commanded strike generates 20 Focus and grants one Ferocity stage.
- It has a short cooldown that establishes the rotation's steady cadence.
- It requires a living active pet and a valid target.
- Pet basic attacks maintain the current Ferocity window but do not build stages by themselves.
- Missing, losing the target, or having no living pet grants no Focus or Ferocity.
- At maximum Ferocity, Pack Command uses its existing action slot to become Unleash Beast.

Fell Shot remains an instant Focus spender and ranged filler:

- It spends 25 Focus.
- It deals Hunter damage while Pack Command is recovering.
- During the Unleash frenzy, Fell Shot also commands an additional pet cleave.

The resulting cadence is:

```text
Pack Command makes the pet strike, builds Focus, and grows the pet
  -> Fell Shot spends Focus while Pack Command recovers
  -> repeat until maximum Ferocity
  -> Unleash Beast
  -> pet calms and the growth cycle begins again
```

This adds no rotational button and prevents an idle pet from building the entire payoff without
Hunter input.

### Growth and unleash presentation

The Hunter owns the authoritative Pack Ferocity buff and displays its three stacks in the normal buff
UI. The active pet mirrors that state as the primary world presentation:

- Early Ferocity: slightly larger posture and a faint warm tint.
- Building Ferocity: visibly larger body, stronger red tint, and more forceful attack effects.
- Maximum Ferocity: three Hunter buff stacks, the pet's largest allowed scale and saturated red state,
  a persistent outline, and a glowing Unleash action.
- Unleashed: a short, loud attack window followed by an obvious calming transition.
- Calm: no Hunter Ferocity buff, normal pet model scale, and normal pet color.

Size changes are presentation only. They never alter collision, hitbox, reach, targeting, pathing,
or camera obstruction. The maximum visual scale must remain readable beside large enemies and in a
full party.

Color cannot be the only signal. The Hunter buff stack and action replacement are the reliable UI
cues. Pet silhouette and outline changes reinforce them so color-blind players and reduced-motion
users receive the same information.

### Existing pet foundation

The current tame system allows one persistent active pet. A Hunter may tame a non-rare,
non-elite, non-boss overworld creature from the beast or spider families at or below the Hunter's
level. Current overworld examples include:

- Forest Wolf
- Wild Boar
- Sableweb Lurker
- Mire Prowler
- Mirefen Widow
- Bog Bloat
- Ridge Stalker

Rare, elite, boss, dungeon, and higher-level creatures remain untameable. Pack Ferocity and
Unleash Beast must work with every legal tamed pet, regardless of its original model or scale.

v0.28.0 keeps one active pet. A stable, multiple simultaneous combat pets, and family-specific
Unleash attacks are later design space because they expand persistence, AI, balance, trigger, and
mobile-clarity scope.

### Player decision

The player chooses between spending Focus on immediate Hunter pressure and continuing to empower
the beast for a stronger cleave or stomp payoff. At maximum Ferocity, the player chooses whether
to unleash immediately or hold the fully grown beast for the next group or damage window.

### Rotational payoff

Unleash Beast is Packlord's Ferocity payoff. It is not a separate fourth rotation button and does
not use a conventional long cooldown:

1. At maximum Ferocity, the Pack Command action changes into Unleash Beast.
2. Activating it makes the pet immediately clap, dealing heavy area damage around itself.
3. The pet then enters a short frenzy with faster attacks and stronger cleave.
4. When the frenzy ends, the Hunter loses all Ferocity and the pet returns to normal presentation.

The clap must also deal useful damage to the primary target so Packlord's payoff remains valuable
in boss encounters.

### Offensive cooldown

Howling Rage remains Packlord's separate offensive cooldown and signature action:

- It immediately brings the Hunter's Ferocity buff to three stacks.
- It empowers the next Unleash Beast clap and extends the following frenzy.
- Fell Shot continues to command extra pet cleaves during the empowered frenzy.
- Ferocity cannot rebuild until the empowered frenzy ends and the pet calms.
- It uses the existing Howling Rage action slot and adds no new button.

The starting PBE target is a 90-second cooldown with a roughly 12-second empowered window. Exact
damage and duration remain tuning values.

### Guardrails

- The pet must remain relevant against one target. Cleave cannot be its only value.
- Pet cleave needs deterministic target selection and must not duplicate owner proc triggers.
- A dead or dismissed pet must remove Packlord-only state cleanly.
- Pet death, dismissal, respec, and loadout changes must restore normal scale and color.
- Maximum Ferocity needs a generous hold window. It cannot force a rapid mobile reaction.
- Every currently tameable pet must support the same growth and calming states.
- Future pet-family variations are outside the v0.28.0 class PR unless separately approved.

## Coldsight

### Fantasy

Coldsight is the deliberate ranged specialist. It creates space, builds Focus safely, and spends
that preparation on high-value shots.

### Core loop

1. Measured Shot builds Focus and maintains ranged cadence.
2. Long Draw is the deliberate, high-value spender.
3. Fevered Draw provides pressure while movement or timing makes another long cast undesirable.
4. Cold Focus creates the major burst window.
5. Hunter control and movement tools create the room needed to complete the next shot.

### Player decision

The player chooses when to continue building Focus and when the encounter provides enough safety
to commit to a stronger shot.

### Offensive cooldown

Cold Focus is Coldsight's offensive cooldown. During its window, Measured Shot builds Focus faster and
the precision-shot cadence accelerates. It should improve the existing rotation rather than add a
temporary action.

### Guardrails

- Long Draw, Fevered Draw, and other Coldsight-only effects cannot be primary effects on shared
  Hunter talent rows without cross-spec fallbacks.
- Cast-time pressure must be offset by mobile tools and generous empowered-shot windows.
- The action bar should contain a small core rotation, not every historical ranged shot at once.

## Fieldcraft

### Fantasy

Fieldcraft is a melee-first hunter fighting beside the beast. It uses close-range weapon attacks,
traps, short disengages, and deliberate re-entry instead of playing as Coldsight with a melee
button.

### Core loop

1. Bloodhook carries the Hunter to the selected enemy and applies the primary bleed.
2. Gutting Strike builds Focus and Hunting Momentum in melee range.
3. Woundrend spends Focus, triggers an immediate bleed tick, and refreshes the wound.
4. Shrapnel Charge provides target-centered area pressure, triggers the primary bleed, and
   spreads a weaker wound to nearby enemies.
5. Trailbreak preserves Momentum and arms the next re-entry instead of ending the rotation.
6. Bloodhook or a melee re-entry resumes the hunt and can consume maximum Momentum for its payoff.

### Hunting Momentum

Hunting Momentum is a timed specialization buff, not a resource bar.

- Successful Gutting Strike grants one stack, up to three.
- Woundrend refreshes the duration but does not add a stack.
- The buff lasts 8 seconds so ordinary movement does not erase it.
- At three stacks, the next Woundrend or armed re-entry attack consumes all stacks for a
  stronger hit. The starting PBE target is 15% additional damage per stack.
- Trailbreak preserves the current stacks and arms the re-entry payoff.

Focus still pays for Fieldcraft attacks. Momentum communicates when the next positional payoff is
strong. The player therefore tracks one resource bar and one small three-stack aura.

### Player decision

The player chooses whether to remain in melee and build more Momentum or disengage early for
safety and a smaller re-entry payoff.

### Offensive cooldown

Fieldcraft's offensive cooldown creates a short bloodtrail assault with the pet. During the
window, Bloodhook gains another charge, wound interactions become stronger, the next grenade gains
area impact, and the pet follows up automatically against wounded targets. It modifies the
existing rotation rather than adding another attack button.

### Role boundary

Fieldcraft gains close-range resilience and dodge, but it is not a tank specialization. Its
survivability exists to support melee uptime, not permanent boss tanking.

### Signature and bleed identity

Bloodhook replaces Drowsing Sting as Fieldcraft's signature. It behaves like a charge: the Hunter
moves to a selected enemy in the valid range, arrives in melee, and applies the primary bleed.
Woundrend remains the defining Focus spender.

Fieldcraft is not a multi-DoT specialization. It maintains one important wound that Woundrend
tears for immediate pressure and Shrapnel Charge converts into cleave. Traps remain tactical
control and setup rather than a required action in every damage cycle.

## Required shared actions

The talent grid assumes five shared Hunter actions. These are baseline class tools, not talent
taxes:

- Trailbreak creates distance without cancelling the Hunter's current specialization state.
- Shellskin provides strong damage reduction while moving, but prevents attacks.
- Wildheart is an immediate self-heal with a clear, separate job from Shellskin.
- Frostjaw Trap provides target-centered control for every specialization.
- Hushing Shot is already a baseline level 10 Hunter action on
  `release/v0.28.0`. Its existing cost, range, minimum range, cooldown, and 4-second school lockout
  are canonical. Talents may modify that action, but must never grant it again.

Frostjaw Trap defaults to the selected enemy's location, or the Hunter's location when there is no
valid enemy target. Optional manual placement may use the same range and radius, but cannot provide
more power than the default mobile cast. The trap arms after a short readable delay, roots the
first enemy for 3 seconds, and slows nearby enemies by 50% for 4 seconds. Its starting PBE cooldown
is 30 seconds.

This baseline trap is required because a trap talent or capstone cannot be a real cross-spec choice
if the player must first buy another talent to make it function.

## Hunter Talents 2.0 grid

These are functional working names and starting PBE values. Final names and tuning can change after
the class-owner review, but the combat purpose of each choice should remain intact.

### Level 5: movement

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Tactical Retreat | Trailbreak gains a second charge. Using it removes roots and movement slows. | Reliable escape and melee re-entry control. |
| Enduring Courser | Activating Courser's Guise grants 60% movement speed for 3 seconds, then returns to its normal speed. Taking damage ends only the burst, not the aspect. The burst can occur once every 20 seconds. | Long movement and predictable repositioning. |
| Predator's Pace | A successful Focus generator grants 20% movement speed for 3 seconds. This can occur once every 8 seconds. | Movement that follows the normal rotation without another button. |

This row contains no damage increase. It asks whether the Hunter wants an escape, planned travel,
or frequent rotational movement.

### Level 8: defense and survivability

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Receding Shell | Shellskin can be activated again to end early. Ending it refunds part of the base cooldown equal to 50% of the unused effect duration, up to 45 seconds. | Precise protection against short mechanics. |
| Shared Recovery | Wildheart also heals the active pet for the same percentage and grants the Hunter and pet 20% damage reduction for 4 seconds. | Recovery from damage already taken and pet sustain. |
| Beastguard | While the pet is alive, 15% of damage taken by the Hunter is redirected to it. Redirected damage cannot reduce the pet below 20% health. Without a living pet, the Hunter instead gains 8% damage reduction while below 50% health. | Passive damage smoothing with a safe no-pet fallback. |

Shellskin remains the strongest answer to one incoming burst. Shared Recovery handles attrition.
Beastguard smooths ordinary pressure without turning any Hunter specialization into a tank.

### Level 11: crowd control

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Double Hush | Hushing Shot gains a second charge. Each charge has a 24-second recharge and otherwise retains the baseline action's existing cost, range rules, and 4-second school lockout. | Holds one interrupt for consecutive dangerous casts. |
| Binding Payload | Frostjaw Trap roots every enemy within 4 yards of its trigger for 3 seconds. When the root ends, affected enemies remain 40% slowed for 4 seconds. | Controls a group at a planned location. |
| Crippling Pursuit | Hitting an already slowed enemy with Rattling Shot or Fettering Slash roots it for 2 seconds. This can affect each target once every 12 seconds. | Converts existing ranged or melee slows into a pursuit stop. |

This row grants no new actions. Each choice strengthens control already on the Hunter's bar and
solves a different problem: consecutive casts, grouped enemies, or pursuit.

### Level 14: kit management and amplification

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Efficient Rhythm | After spending 75 Focus, the next Focus generator grants 20 additional Focus. The ready state has no short expiry and is shown on the generator action. | Predictable resource cycles and fewer empty globals. |
| Trapcraft | Frostjaw Trap's cooldown is reduced by 20%. When it triggers, it restores 20 Focus and reduces Trailbreak's remaining cooldown by 5 seconds. | Links control, movement, and the Focus rotation. |
| Guise Mastery | Activating a guise empowers it for 6 seconds: Harrier's Guise increases Focus generation by 50%, Marten's Guise reduces direct damage taken by 25%, and Courser's Guise grants 50% movement speed that damage cannot reduce. With Enduring Courser, the Courser value becomes 60%. The empowerment has a shared 20-second cooldown. | Deliberate guise timing without rapid weaving. |

Efficient Rhythm is the simple rotation choice. Trapcraft rewards setup. Guise Mastery creates
short tactical states using existing aspect buttons.

### Level 17: major cooldown or power spike

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Apex Instinct | Activating Howling Rage, Cold Focus, or Bloodtrail Assault grants 40 Focus. The next three Focus spenders cost 50% less and deal 20% more damage. Charges persist for the cooldown window plus 4 seconds. | Concentrated personal pressure through the specialization's existing cooldown. |
| Shell and Fang | Shellskin becomes an attack-compatible defensive. Its damage reduction is reduced to 40%, but the Hunter can continue attacking and commanding the pet. | Maintains pressure through a dangerous mechanic at the cost of full protection. |
| Pack Rally | When ready in combat, Courser's Guise's action transforms into Pack Rally. Activating it also applies the normal aspect, then grants the Hunter, pet, and nearby party members 30% movement speed and 10% attack and cast speed for 10 seconds. The action returns to the normal aspect during Pack Rally's 90-second cooldown. | A visible party movement and pressure window. |

The row offers personal burst, attack-compatible defense, or group support. PBE tuning must keep
Pack Rally useful without making it mandatory for every organized party.

### Level 20: build-defining capstone

| Choice | Starting effect | Player reason to choose it |
|---|---|---|
| Overdraw | Every third Focus spender is empowered, dealing 35% more damage to its primary target and 50% of its final damage to up to two nearby enemies. The empowered spender is shown on its action. | Builds around the specialization's weapon spender and a visible three-beat cadence. |
| Chain Reaction | When Frostjaw Trap triggers, enemies within 4 yards are marked for 8 seconds. The next three Focus spenders against a marked enemy echo 40% of their damage to the other marked enemies. The mark adds no further control. | Turns one planned trap into an area damage window without another ground action. |
| Fang Chorus | Each Focus spender commands the active pet to perform an echo strike at 50% of its normal basic-attack damage. Every third echo becomes a 4-yard clap. Echoes cannot generate Focus, Ferocity, or additional pet procs. | Lets any Hunter commit to a pet-coordination build while making the pet visibly active. |

Overdraw maps to Fell Shot, the Coldsight spender, and Woundrend. Chain Reaction works because
Frostjaw Trap is baseline rather than purchased from another row. Fang Chorus is available to all
three specializations through the shared pet system, but intentionally requires the player to keep
the pet alive.

No capstone grants another rotational action. All three create a persistent action glow, target
mark, or three-step aura that is readable on mobile without a second resource bar.

## Research patterns applied

- The Packlord loop uses the visible companion growth and transformed-command pattern found in
  Guild Wars 2's Untamed and Diablo's large companion builds, without adding manual pet skills.
- The shared talents follow Path of Exile 2's skill-modification pattern: change the behavior of an
  action the player already understands before adding a new action.
- Guise Mastery, Apex Instinct, and the capstones bank or transform a visible state, similar to
  Guild Wars 2 profession mechanics, but keep that state as an aura or action change instead of an
  extra resource bar.
- Target-centered trap defaults preserve tactical setup while avoiding precision ground placement
  as a requirement on touch controls.

## What to retain from PR #2165

- Focus as the Hunter resource.
- The shared Hunter identity tools, subject to action-bar pruning.
- Hushing Shot exactly as shipped on `release/v0.28.0`. The new grid may modify it, but does not
  grant or replace it.
- The Measured Shot, Long Draw, Fevered Draw, and Cold Focus Coldsight foundation.
- The strongest movement, trap, and presentation work that can be split cleanly.

The existing talent rows are source material, not the approved owner design. They must be rebuilt
against the shared-row and mobile-responsiveness rules above.

## Acceptance criteria

- All three specializations have a different core decision visible during ordinary combat.
- Fieldcraft deals most of its rotational damage from melee range.
- Fieldcraft uses Bloodhook to reach the enemy and apply its one primary bleed.
- Fieldcraft's target-centered grenade converts the prepared wound into cleave without creating a
  ranged filler rotation or requiring precision ground input.
- Packlord's beast visibly grows larger and redder through multiple stages, unleashes its stored
  power, then clearly calms and returns to normal.
- Packlord's beast has meaningful single-target impact and visible cleave or stomp impact.
- Coldsight retains a readable builder and spender cadence.
- No shared option is dead for any specialization.
- The required rotation fits a mobile action layout and has no short reaction checks.
- PBE Wave C validates pet trigger safety, melee uptime, Focus pacing, and PvP control edges.
