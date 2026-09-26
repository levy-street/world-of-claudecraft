# src/ui/hud/cooldown_manager/

Options > Cooldown Manager: floating GROUPS of non-clickable buttons for the spells
the player picks. Three kinds: a single button, a button group (a grid with a
settable run length and run count), and a line of spells. Each group has its own
orientation, icon direction, icon size, padding, opacity, visibility (always, in
combat, hidden) and timer switch, and is dragged into place while the Options
sub-view is open. Each button shows the spell's cooldown sweep, dims while it cannot
be cast, lights up when it is ready, follows the spell when its button transforms
(Gorebite into Redharvest), and can play one of the Auras panel's alert cues and
light the spell's action-bar button when it becomes ready. The Auras panel
(`src/ui/aura_overlay_*`) is the sibling this mirrors: per-character store, pure
core, thin painter, one controller, one settings panel.

| File | What it is |
|---|---|
| `cooldown_manager_config.ts` | Stored shape (groups, per-spell config, shared layout), sanitizers, the group layout rules (`cooldownCell`, `cooldownGroupShown`), spell assignment, and the search matcher. Pure rules; imports the cue catalog, so it is not a registered pure core. |
| `cooldown_manager_catalog.ts` | Every ability a class can hold across all specs, talents and levels (derived), and its trackable-spell subset the picker offers. Pinned by a sweep over every class, spec and talent option. |
| `cooldown_manager_auras.ts` | The trackable AURAS (engines, procs, buffs): `ENGINE_AURAS` (the one hand table, each row pinned against the sim source), the Auras panel's procs, every talent-row proc, and class self-buffs; plus the `aura:<id>` / `kind:<kind>` token rules. |
| `cooldown_manager_store.ts` | The per-character localStorage record (`woc_cooldown_manager:<class>:<name>`), carried by the full settings export. |
| `cooldown_manager_view.ts` | The per-frame pure core: readiness, transform, glow flags, cue edges. Registered in `UI_PURE_CORES`. |
| `cooldown_manager_painter.ts` | Thin painter over `PainterHostWriters` (a `HOT_PAINTERS` member). |
| `cooldown_manager_controller.ts` | The DOM adapter: mints the groups, drives view + painter, plays cues, feeds the hotbar glow, projects the settings hooks. |
| `cooldown_manager_settings.ts` | The Options sub-panel (cold DOM): general switches, group cards, and the Tracked Spells sorter. |
| `cooldown_manager_wiring.ts` | The one-line Hud seam (`mountCooldowns`): attaches the sfx engine and the desktop-bar test. |
| `index.ts` | The barrel the Hud and `src/ui/options_overlay_panels.ts` import. |

## Load-bearing rules

- **A tracked entry is a spell id or an aura token.** `aura:<id>` matches a live
  player aura by id, `kind:<kind>` by kind (an engine bank). An aura button is up
  once the aura has `alertStacks` stacks (0: on appearance); a goal above 1 also
  pulses it. It shows stacks and time left, never a hotbar glow. Auras the static
  catalog misses are still offered: the controller remembers every helpful aura
  seen on the player (`recordSeen`, one Set lookup per aura per frame, capped).

- **Readiness is the action bar's, never a second rule.** The view composes
  `createActionBarView` over a descriptor whose slots are the tracked spells, and
  resolves each through `IWorld.resolvedAbility`, so cost, charges, stacks, kill
  windows, form pools, free-cast procs and aura-driven replacement are exactly
  what the hotbar paints and the sim's cast gate checks. Ready = known, usable,
  and off cooldown; the GCD is deliberately ignored (a ready button never flickers
  through each global cooldown), and the sweep shows the spell's own cooldown only.
- **A spell sits in one group at most** (`assignCooldownSpell` moves it), so the
  cue edges and per-spell settings key on the base ability id.
- **Cue edges** (`cooldownCueFires`): the first frame a spell is observed only
  records, so logging in with everything ready is silent. After that a cue fires
  when a spell BECOMES ready, or TRANSFORMS into a different spell while ready; a
  transform reverting to the base spell is silent. Edges are recorded even while
  sound is gated (manager off, out of combat with the combat-only switch), so
  lifting the gate never replays a stale edge. A HIDDEN group still sounds and
  lights the hotbar: that is how a player routes a spell to sound alone.
- **Cells are explicit.** `cooldownCell` places every button (`grid-column` /
  `grid-row`), so direction and wrap are one tested rule, and a button hidden by
  "only when ready" keeps its cell (`visibility`, not `display`): a grid never
  reflows mid-fight.
- **Hotbar glow is additive only.** `readyGlowAbilityIds()` unions this manager's
  set with the Auras panel's through the action bar's existing
  `watchedGlowAbilityIds` channel; it can never suppress an authored class proc.
  It is offered only where the desktop action bar is live.
- **The buttons are decoration, not controls:** the layer is `aria-hidden` and
  `pointer-events: none` except in placement (the Options sub-view is open), where
  every group shows and can be dragged. The keyboard path to the same placement is
  the position sliders on each group card.
