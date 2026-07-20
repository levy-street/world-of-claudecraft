# Class Design Rules

Status: living design standard for class balance and combat-kit work.

World of ClaudeCraft uses the same deterministic simulation on desktop, mobile, the
authoritative server, and the headless environment. A specialization must remain readable on a
small screen, understandable from its tooltips, and measurable in the shared simulation.

## Complexity budget

A specialization needs a clear core loop. Builder, spender, reactive proc, offensive cooldown,
and defensive cooldown are useful roles for auditing that loop, but they are not a mandatory
five-ability template. Existing abilities stay when they create distinct timing, target, resource,
positioning, or utility decisions.

The audit starts with these questions:

- Which actions make up the normal rotation?
- Which effects change the next decision?
- Which abilities repeat another ability's job?
- Which passives add output without changing play?
- Which controls are difficult to use on a small screen?

Reduce complexity incrementally. Remove or fold one redundant action, proc, or passive at a time,
then validate the resulting play before selecting the next candidate. Do not transition a class to
a fixed action count in one change.

Shared class utility can remain outside the core rotation when it does not add spec throughput.
Examples include movement, an interrupt, and class-defining control. Shared utility must not
become a second rotation, a maintenance buff, or a hidden damage source.

Area, execute, mobility, and support actions may stay separate when they solve a distinct combat
problem. When two actions create the same decision, prefer one action with a clear rider or a
talent that changes its shape.

## Passive budget

Passives are judged by decisions, not by a fixed count. A resource rule, reactive proc, or mastery
may stay when it changes what the player presses, holds, targets, or times. An always-on rule does
not need a separate player-facing passive when the relevant ability tooltip can explain it.

Remove or fold background percentages that merely increase damage, critical damage, haste,
resource income, or cooldown recovery. In particular, avoid:

- A proc that creates or amplifies another proc.
- An on-kill effect that stacks damage or critical chance.
- A hidden every-N-actions counter with a throughput multiplier.
- One effect granting both damage and resource generation.
- One effect granting both damage and haste.
- Resource spending reducing several offensive cooldowns at once.
- Several personal damage-done auras active on the same character.

Core combat state and a selected offensive cooldown may coexist only when their combined budget
is measured. The selected cooldown remains the sole major personal burst effect.

## Talent rules

Talents 2.0 keeps six choice rows at levels 5, 8, 11, 14, 17, and 20. Prefer talents that change
an existing action, resource decision, or utility behavior. A new active is justified only when it
adds a distinct, high-value decision and remains usable on mobile.

The row jobs are guidelines for preventing throughput stacks:

| Level | Row job | Throughput rule |
|---|---|---|
| 5 | Mobility | No direct damage increase |
| 8 | Survival | No direct damage increase |
| 11 | Control | Damage is incidental, not a rotation gain |
| 14 | Resource behavior | Changes cadence or reliability, never resource plus damage |
| 17 | Major offensive choice | Selects one major personal throughput effect |
| 20 | Specialization or utility | Changes that choice or offers a lateral alternative |

A level 20 option must not add a second cooldown that stacks freely with the level 17 choice.
Build variety comes from lateral choices such as reliability versus burst, single target versus
area damage, personal output versus group support, and mobility versus protection. It does not
come from collecting every available multiplier.

## Mobile controls

Heavy mobile users are part of the design process before a broad action-bar reduction. Interview
and observe them to identify missed inputs, hard-to-reach controls, target-selection friction, and
the actions they already avoid.

A contextual single-button rotation is a candidate mobile control, not a reason to collapse the
underlying class design. Any prototype must:

- Use the existing deterministic ability and resource rules.
- Expose which action it will perform.
- Preserve manual access to timing, target, defensive, and utility decisions.
- Avoid hidden throughput bonuses or faster-than-manual input.
- Be optional and tested against the normal action bar.

## Interestingness test

Every action, proc, and talent must answer at least one of these questions:

- Does it change what I press next?
- Does it change when I spend my resource?
- Does it change which target I choose?
- Does it create a clear risk or timing tradeoff?
- Does it offer utility that the core rotation does not?
- Does it replace one playstyle with another?

If the answer to all six is no, remove the mechanic or fold its output into an existing action.

## Power ceiling

At the level cap, the highest comparable damage specialization must remain no more than 10 to 15
percent above the lowest in sustained single-target DPS with equivalent gear. Raid observations
are evidence, but the enforced gate must normalize encounter, duration, target count, gear, and
active buffs.

Burst and area profiles are reported separately. An area specialist may lead an area profile,
but that strength must be paid for by a lateral talent choice instead of stacking on top of the
best single-target build.

The measurement contract lives in `docs/design/spell-balance-framework.md`.

## Change process

1. Pin the current behavior with a deterministic fixture.
2. Change one redundant action, passive, or power source at a time.
3. Re-run single-target, burst, and area profiles.
4. Preserve saved talent selections by keeping stable option ids when an option is replaced.
5. Gather mobile play feedback before changing the action-bar model.
6. Use PBE validation for large content changes or any broader class transition.

Gameplay numbers require an existing classic-era formula, a checked-in reference, or a measured
simulation result. When no target exists, add the measurement first rather than inventing a
coefficient.
