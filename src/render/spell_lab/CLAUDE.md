# `src/render/spell_lab/`: Spell & VFX Review Lab (`?spells=on`)

Interactive in-game developer lab for reviewing every class and specialization, base kits, talent-row ability grants, body fits (Male/Female), and weapon loadouts (`1H+Shield`, `Single 1H`, `2H`, `Dual`, `Staff`, `Wand`) with their live WOC animation clips and `AbilityVfxSpec` presentations.

## How to open

- Append `?spells=on` (or `?spelllab=on`) to the dev URL (`http://localhost:5173/?spells=on`) so the panel opens automatically upon entering the world.
- Or press `Alt+Shift+S` at any time inside a running dev session, or run `window.__spellLab.open()` in the browser console.

## Module layout

| File | Role |
| --- | --- |
| `spell_lab_flag.ts` | Leaf URL/dev flag reader (`?spells=on` / `?spelllab=on`). Zero runtime/DOM imports. |
| `spell_lab_catalog_core.ts` | PURE (`RENDER_PURE_CORES`): builds the complete per-class and per-spec spell catalog from `CLASSES`, `ABILITIES`, `TALENTS`, and `ROW_TREES`, resolving each spell's WOC animation clip (including weapon-loadout swaps) and `AbilityVfxSpec` archetype/school/motifs. Tested by `tests/spell_lab_catalog_core.test.ts`. |
| `spell_lab_panel.ts` | Floating DOM review panel: class selector, spec/category filter tabs, Male/Female body fit toggle, weapon loadout selector, slow-motion speed controls (`1x` / `0.5x` / `0.25x`), automated spec sequence player, live rig telemetry inspector, and searchable spell cards. |
| `spell_lab_runtime.ts` | Connects the panel to `window.__game` (`sim` and `renderer`): swaps the live player's class, body fit, and equipped weapons, stages a practice target dummy at the optimal standoff distance for each spell, and executes spells end-to-end (with automatic precondition staging and direct `spellfx` + `triggerAttack` fallback). |
| `spell_lab_boot.ts` | Side-effect boot hook imported by `src/render/post.ts`; dynamically imports `spell_lab_runtime.ts` only when `?spells=on` is set or `Alt+Shift+S` is pressed in dev builds. Its condition names `import.meta.env.DEV` literally, so a production build drops the import and never emits the runtime chunk (pinned by `tests/spell_lab_boot.test.ts`). |

## Dev channel only

Panel text, loadout preset labels and the catalog's description prose are dev-channel English (the palette lab and `?perf` overlay precedent): none of it is reachable outside `import.meta.env.DEV`, so it carries no `t()` keys. Never import `SPELL_LAB_LOADOUT_PRESETS` labels or `formatSpellLabDescription` into player chrome; a player surface would owe localized keys and the tooltip-writing rules.
