# Corpse harvest choice from the interact press

The real bound Interact key (F on desktop, the Interact button on mobile) pressed on a
harvest-only Forest Wolf corpse (ordinary loot already taken) with a Field Kit in the bags.

- `before-*.png`: release/v0.43.0. The press answers "Nothing to interact with." and the
  harvest is unreachable without a mouse click on the body or the Professions window entry.
- `after-*.png`: this branch. The press opens the centered corpse popup, whose own Harvest
  control starts the 1.5 second harvest cast. Nothing is harvested by the press itself.

Captured by the `corpse-intentional-interaction` target's `harvest-choice-press` variants in
`scripts/pr_shot_targets.mjs` (`scripts/pr_screenshots.mjs`, lowest graphics preset).
