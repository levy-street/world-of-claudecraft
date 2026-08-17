# Player tooltip writing standard

This is the rule for every player-facing spell, talent, aura, item, and mechanic tooltip.
Write the English source first. A tooltip is done only when a player can tell what happens,
when it happens, how much it does, and what changes that amount.

Use the `write-game-tooltips` Claude skill or the `woc-write-game-tooltips` Codex skill when
writing or reviewing tooltips.

## Write from the mechanic, not from the old tooltip

Read the live definition and every runtime handler before changing the words. A description is
not a source of truth. It is a promise about what the code does.

For each tooltip, verify:

1. Who or what it can target.
2. What happens immediately.
3. What happens later, including tick rate and total duration.
4. The damage, healing, absorb, resource, stack, target, and charge values.
5. The cooldown, cost, range, cast time, and global cooldown behavior.
6. The stat used for scaling: Spell Power, Attack Power, Ranged Attack Power, maximum health,
   weapon damage, pet stats, or no scaling.
7. Every trigger, limit, reset, consumption rule, and failure condition.
8. Whether talents, specialization state, or another aura change the result.

If the code and the design disagree, stop and record the mismatch. Do not make the tooltip
describe intended behavior that has not landed.

## Plain English structure

Write short sentences in the order the player experiences the effect:

1. Start with the action: `Strike`, `Heal`, `Charge`, `Place`, `Summon`, or `Reduce`.
2. State the main result with an exact resolved value.
3. Explain the follow-up state, trigger, or resource change.
4. End with an important limit or specialization label when needed.

Use one sentence per distinct result when that improves clarity. Keep the action-bar metadata
separate. Do not repeat the range, cost, cast time, or cooldown in the description when the
tooltip already shows it above the text.

Use familiar player words. Explain a named state the first time it appears. Avoid vague phrases
such as `empowers`, `becomes unsafe`, `primary wound`, `spec relationship`, `valid impact`,
`calculated healing`, and `additional burst` unless the same sentence says exactly what they
mean.

Do not use flavor as a substitute for rules. A small amount of flavor is fine after the mechanic
is clear.

## Numbers and scaling

Show the number the current character will actually produce. Use the existing resolved tooltip
placeholders and the shared scaling helpers where they support the effect. Do not hardcode a
number that changes with rank, equipment, talents, or specialization.

Use these labels precisely:

- Hunter shots and ranged Hunter attacks use `Ranged Attack Power` when the combat code does.
- Physical melee specials use `Attack Power` when the combat code does.
- Magic damage and healing use `Spell Power` when the combat code does.
- Weapon attacks may already include Attack Power through weapon damage. Do not add the same
  contribution twice.
- Pet damage must say whether it uses the Hunter's current state, snapshots the state at summon,
  or uses the pet's own stats.
- A flat effect must not claim that it scales.

Prefer a live resolved total over exposing an internal coefficient. Add a short line such as
`Damage increases with Ranged Attack Power` only when the scaling source would otherwise be
surprising or important to a build choice. Never print internal field names or raw constants such
as `apCoeff: 0.08` in player copy.

For periodic effects, state whether the displayed number is the total or the amount per tick.
The tooltip and combat code must agree about rounding and the number of ticks.

## Required proof

Every damage, healing, absorb, or resource tooltip change needs a focused test that proves the
English text matches combat. For a scaling effect, test at two different power values and confirm
the displayed value changes by the same amount as the resolved combat result.

Use the existing accuracy tests and helpers where possible:

- `src/ui/ability_damage.ts` for resolved tooltip numbers.
- `src/sim/spell_scaling.ts` for shared power coefficients.
- `tests/ability_tooltip_consistency.test.ts` for placeholder and hardcoded-number drift.
- A focused mechanic test when a custom effect bypasses the shared resolver.

Test ranks, talents, transformed actions, and periodic totals when they can change the result.

## English first

Change only the authoritative English source during the first pass:

- Ability text in the live content definition.
- The matching English entry under `src/ui/i18n.catalog/`.
- Talent English text in its authored talent source.

Do not hand-edit locale overlays or generated resolved catalogs. Run the normal i18n generation
step after the English source changes. Locale filling remains a release task.

## Bloodhook example

Bloodhook applies a named bleed, so its tooltip must explain the name and the full scaling rule.
The authored wound is 34 base Physical damage plus 26% of the Hunter's Ranged Attack Power. The
current Survival baseline then increases the whole wound by 6% before it is dealt over 12 sec in
four ticks. Trailbreak can also arm a separate re-entry hit. That hit has its own base range and
Ranged Attack Power contribution.

Accurate copy for the current wound is:

> Charge to the enemy and apply Bloodhook Wound. The wound deals 34 base Physical damage plus 26%
> of your Ranged Attack Power over 12 sec in 4 ticks. (Fieldcraft signature)

Keep the wound and re-entry formulas separate in both combat and player copy. A balance change to
one must not silently change the other.

## Final check

Before marking a tooltip done, ask:

- Can a new player explain the action after reading it once?
- Are all numbers live and correct for this character?
- Does the wording name the real scaling stat?
- Are stacks, caps, targets, duration, and consumption rules stated?
- Does the English match the spellbook, action bar, aura, talent panel, and guide?
- Would the tooltip still be true after changing gear or specialization?

If any answer is no, the tooltip is not done.
