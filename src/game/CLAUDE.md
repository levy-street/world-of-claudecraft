<!-- src/game/: the local, browser-only input/audio layer. Dependency rules,
     the IWorld seam, and build/test commands live in root + src/ CLAUDE.md;
     this file only covers what's specific to this directory. -->

# src/game/ : local input, camera, audio, settings

Turns the player's keyboard/mouse/touch into **movement intent** + **`IWorld`
command calls**. DOM/WebAudio-only; runs in `main.ts`.

## Key files
| File | Role |
|---|---|
| `input.ts` | `Input`: keyboard/mouse to `readMoveInput()` (polled each frame) + edge actions via `InputCallbacks` (`onAbility`, `onUiKey`, `onTab`, `onClickPick`). Owns `camYaw/camPitch/camDist`, autorun, pointer-lock, rebind capture. |
| `keybinds.ts` | `Keybinds` + `BIND_ACTIONS`: the classic remappable layout (pure, no DOM). |
| `interactions.ts` | `handlePickedEntity`: the **only** file here that calls `IWorld`; routes a click-pick to target/loot/quest/enter-dungeon via injected `PickInteractionWorld`/`PickInteractionHud`. |
| `mobile_controls.ts` | `MobileControls`: touch joysticks to `input.setTouchMove`/`setTouchLook`. |
| `audio.ts` | `GameAudio` (`audio` singleton): procedural SFX. |
| `music.ts` | `MusicDirector` (`music` singleton): procedural zone/combat soundtrack. |
| `sfx.ts` / `voice.ts` | `sfx` / `voice` singletons: play pre-rendered clips from `public/audio/` (spatial 3D SFX + NPC voice lines) via their `*_manifest.generated.ts`. |
| `settings.ts` | `Settings`: persisted Esc-menu options. |
| `click_move.ts` / `pointer_pick.ts` / `camera_follow.ts` | pure, DOM-free input/camera math extracted from the render loop so they unit-test in isolation |
| `perf_doctor.ts` | pure perf-snapshot analyzer producing `PerfSuggestion[]` (no DOM); `perf_reporter.ts` is the telemetry reporter; `perf.ts` is the overlay/trace harness |
| `cursors.ts` | hover-cursor PNGs |

## Local invariants
- **Never mutate sim state directly.** `input.ts` only records intent and fires
  callbacks; only `interactions.ts` and `autoloot.ts` touch the world, and only
  through the `IWorld`-shaped interfaces passed to them. Do not import
  `Sim`/`ClientWorld` here.
- **`audio.ts`/`music.ts` synthesize everything**, every procedural SFX and music
  note is built in code via WebAudio, with nothing to load. **`sfx.ts`/`voice.ts`
  are the exception:** they play pre-rendered clips under `public/audio/` (spatial
  effects + NPC voice) keyed off their `*_manifest.generated.ts`; a missing clip is
  a silent no-op (the dialogue/combat text stays the source of truth).
- **`AudioContext` needs a user gesture**: `audio.init()`/`music.init()`/`sfx.init()`
  are called from `enterWorld` in `main.ts`, not at module load. `setVolume` is safe
  before init. (`voice.ts` uses a plain `Audio` element, so it has no gated init.)
- **Each module owns its `localStorage` key:** keybinds `woc_keybinds` (namespaced
  per character: `woc_keybinds:char:<id>` online, `woc_keybinds:offline:<class>:<name>`
  offline, with the bare key kept as a read-only legacy seed for fresh characters),
  settings `woc_settings`, music on/off `ev_music_on`. All reads are try/catch-guarded
  (private mode / corrupt JSON fall back to defaults).
- **Keybinds:** `Escape` is reserved (`isReservedCode`) and never bindable, it
  always toggles the game menu. A code lives on at most one action (rebinding
  steals it). Up to 2 codes/action (primary + secondary). The default layout is
  classic-fidelity-critical and is covered by `tests/keybinds.test.ts`; keep it
  green. `mobile_controls.ts`/`settings.ts` have tests too.
- **i18n (root `t()` rules apply), 3 local facts:** the one dynamic control label here,
  the mobile haptics toggle, is keyed (`t('hudChrome.mobile.haptics'/'…hapticsOff')` in
  `mobile_controls.ts`); the **static** mobile button labels (move/camera/attack/autorun/
  jump…) live in `index.html` via `data-i18n`, not here; the perf overlay/doctor/reporter
  (`perf.ts`/`perf_doctor.ts`/`perf_reporter.ts`) stays English, a `?perf`/`woc_perf`-gated
  dev diagnostic like `console.*`.

## Adding things
Extract non-trivial input/camera/perf math into a pure, unit-tested module (the
`click_move`/`pointer_pick`/`perf_doctor` pattern), not into `input.ts`.

- **A new keybind/action:** add one entry to `BIND_ACTIONS` in `keybinds.ts`
  (`kind: 'held'` for movement polled in `readMoveInput`, else `'edge'`). For an
  edge action, extend `InputCallbacks.onUiKey`'s union and add a `case` in
  `Input.dispatchEdge`, then wire it where `new Input(...)` is constructed in
  `main.ts`. Action-bar slots (`slot0..11`) already route to `onAbility`.
- **A new SFX:** add a method to `GameAudio` composed from the private `tone()`
  /`noise()` primitives; call it from `main.ts`/HUD via the `audio` singleton.
- **A new music cue/zone:** add a `MusicZone`, a `composeX()` theme, register it
  in the `buildMusicThemes()` map (music.ts), and drive it from
  `music.update(zone, inCombat)`.

## Never
- Never read `localStorage`/`window`/`AudioContext` from a constructor without a
  try/catch fallback: these modules must import cleanly under Vitest's plain-Node env
  (no DOM globals; jsdom is not a dependency), which is exactly where the fallback fires.
- Never hard-code mouse sensitivity; scale `BASE_LOOK_SENS` via `setCameraSpeed`
  so the settings slider stays authoritative.
