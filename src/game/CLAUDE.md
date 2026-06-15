<!-- src/game/ — the local, browser-only input/audio layer. Dependency rules,
     the IWorld seam, and build/test commands live in root + src/ CLAUDE.md;
     this file only covers what's specific to this directory. -->

# src/game/ — local input, camera, audio, settings

The browser-side glue between the player's keyboard/mouse/touch and the world.
It reads raw DOM events and turns them into **movement intent** + **`IWorld`
command calls**. Everything here is DOM/WebAudio-only and runs in `main.ts`.

## Key files
| File | Role |
|---|---|
| `input.ts` | `Input` — keyboard/mouse → `readMoveInput()` (polled each frame) + edge actions via `InputCallbacks` (`onAbility`, `onUiKey`, `onTab`, `onClickPick`). Owns `camYaw/camPitch/camDist`, autorun, pointer-lock, rebind capture. |
| `keybinds.ts` | `Keybinds` + `BIND_ACTIONS` — the classic remappable layout (pure, no DOM). |
| `interactions.ts` | `handlePickedEntity` — the **only** file here that calls `IWorld`; routes a click-pick to target/loot/quest/enter-dungeon via injected `PickInteractionWorld`/`PickInteractionHud`. |
| `mobile_controls.ts` | `MobileControls` — touch joysticks → `input.setTouchMove`/`setTouchLook`. |
| `audio.ts` | `GameAudio` (`audio` singleton) — procedural SFX. |
| `music.ts` | `MusicDirector` (`music` singleton) — procedural zone/combat soundtrack. |
| `settings.ts` | `Settings` — persisted Esc-menu options. |

## Local invariants
- **Never mutate sim state directly.** `input.ts` only records intent and fires
  callbacks; only `interactions.ts` touches the world, and only through the
  `IWorld`-shaped interfaces passed to it. Do not import `Sim`/`ClientWorld` here.
- **No audio files exist.** Every SFX and every music note is synthesized in code
  via WebAudio. There is nothing to load and nothing in `public/` for sound.
- **`AudioContext` needs a user gesture** — `audio.init()`/`music.init()` are
  called from `enterWorld` in `main.ts`, not at module load. `setVolume` is safe
  before init.
- **Each module owns its `localStorage` key:** keybinds `woc_keybinds`, settings
  `woc_settings`, music on/off `ev_music_on`. All reads are try/catch-guarded
  (private mode / corrupt JSON fall back to defaults).
- **Keybinds:** `Escape` is reserved (`isReservedCode`) and never bindable — it
  always toggles the game menu. A code lives on at most one action (rebinding
  steals it). Up to 2 codes/action (primary + secondary). The default layout is
  vanilla-fidelity-critical and is covered by `tests/keybinds.test.ts` — keep it
  green. `mobile_controls.ts`/`settings.ts` have tests too.

## Adding things
- **A new keybind/action:** add one entry to `BIND_ACTIONS` in `keybinds.ts`
  (`kind: 'held'` for movement polled in `readMoveInput`, else `'edge'`). For an
  edge action, extend `InputCallbacks.onUiKey`'s union and add a `case` in
  `Input.dispatchEdge`, then wire it where `new Input(...)` is constructed in
  `main.ts`. Action-bar slots (`slot0..11`) already route to `onAbility`.
- **A new SFX:** add a method to `GameAudio` composed from the private `tone()`
  /`noise()` primitives; call it from `main.ts`/HUD via the `audio` singleton.
- **A new music cue/zone:** add a `MusicZone`, a `composeX()` theme, register it
  in `init()`'s `themes` map, and drive it from `music.update(zone, inCombat)`.

## Never
- Never read `localStorage`/`window`/`AudioContext` from a constructor without a
  try/catch fallback — these modules must import cleanly under Vitest (jsdom).
- Never hard-code mouse sensitivity; scale `BASE_LOOK_SENS` via `setCameraSpeed`
  so the settings slider stays authoritative.
