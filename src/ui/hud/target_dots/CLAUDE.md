<!-- src/ui/hud/target_dots/ - the Target dots frame. Local detail only; the DOM,
     accessibility, localization, painter and performance rules live in
     src/ui/CLAUDE.md, and the module-first / no-dash rules in root CLAUDE.md. -->

# Target dots (`#target-dots`)

The multi-target debuff tracker: one bar row per debuff the LOCAL player currently
has out, across every enemy in interest range, with a live countdown. Governed by
the `showTargetDots` setting (Interface > Combat) and movable like any other HUD
frame (`HUD_FRAME_SPECS` row `targetDots`).

## Shape

- `target_dots_view.ts` is the pure selection core (`UI_PURE_CORES`): no DOM, no
  Three, no `t()`. It reuses one state object and one row pool across ticks.
- `target_dots_painter.ts` builds its skeleton ONCE and writes only through the
  shared `PainterHostWriters` facet.
- The Hud owns the container id, the ownership predicate, the localization
  callbacks, and the per-frame `tick` + `update` pair.

## Two rules this frame must keep

**Class-agnostic selection.** A row is chosen by ownership plus harm
(`deps.isOwn` and `isDebuffAura` from `src/sim/aura_classify.ts`), never by an
ability or class list. Every class's debuffs land here on the same path, and a
debuff added to any class later needs no change in this directory. Do not add a
per-class branch; if a debuff is missing, fix its classification at the source.

**Order is stable, never sorted by urgency.** Rows group by enemy (current target
first, then entity id) and sort by aura id inside the group. Sorting by remaining
time would move a row under the player's cursor every tick, which defeats the
purpose of a refresh tracker. Urgency is carried by the fill, the countdown, and
the `expiring` blink.

## Never tier-gated

These countdowns are the actionable read the frame exists for, so no graphics
preset or FPS governor may shed, delay, or coarsen them (root CLAUDE.md,
gameplay-neutral graphics). The only switch is the player's own setting.
