---
name: write-game-tooltips
description: Write or review World of ClaudeCraft spell, talent, aura, item, and mechanic tooltips in plain English. Use whenever player-facing tooltip text is added, changed, audited, or found to be vague, especially when damage, healing, duration, stacks, targets, resources, or Attack Power and Spell Power scaling must match live code.
user-invocable: true
---

# Write game tooltips

Make every tooltip clear enough to understand in one read and exact enough to test.

## Required workflow

1. Read `docs/design/tooltip-writing.md` in full.
2. Read the live content definition and every runtime handler for the effect.
3. List the action, target, values, timing, scaling stat, triggers, caps, and consumption rules.
4. Write the English source in the order the player experiences it.
5. Use resolved values for anything changed by rank, gear, talents, or specialization.
6. Add or update a focused test that compares the tooltip with the combat result.
7. Run the relevant tooltip, mechanic, i18n, and type checks.

## Hard rules

- Never infer mechanics from the old description.
- Never claim an effect scales until the live combat path proves it.
- Never hide a trigger, cap, target limit, stack rule, cooldown reset, or resource change.
- Never repeat metadata already shown above the description unless the repetition prevents a
  real misunderstanding.
- Never hand-edit non-English locale overlays or generated i18n files.
- Never use flavor text in place of an exact rule.

Write the English pass first. Locale work follows the repository release workflow.
