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
| `sfx.ts` / `voice.ts` | `sfx` / `voice` singletons — play pre-rendered clips from `public/audio/` (spatial 3D SFX + NPC voice lines) via their `*_manifest.generated.ts`. |
| `settings.ts` | `Settings` — persisted Esc-menu options. |
| `click_move.ts` / `pointer_pick.ts` / `camera_follow.ts` | pure, DOM-free input/camera math extracted from the render loop so they unit-test in isolation |
| `perf_doctor.ts` | pure perf-snapshot analyzer producing `PerfSuggestion[]` (no DOM); `perf_reporter.ts` is the telemetry reporter; `perf.ts` is the overlay/trace harness |
| `cursors.ts` | hover-cursor PNGs |

## Local invariants
- **Never mutate sim state directly.** `input.ts` only records intent and fires
  callbacks; only `interactions.ts` touches the world, and only through the
  `IWorld`-shaped interfaces passed to it. Do not import `Sim`/`ClientWorld` here.
- **`audio.ts`/`music.ts` synthesize everything** — every procedural SFX and music
  note is built in code via WebAudio, with nothing to load. **`sfx.ts`/`voice.ts`
  are the exception:** they play pre-rendered clips under `public/audio/` (spatial
  effects + NPC voice) keyed off their `*_manifest.generated.ts`; a missing clip is
  a silent no-op (the dialogue/combat text stays the source of truth).
- **`AudioContext` needs a user gesture** — `audio.init()`/`music.init()`/`sfx.init()`
  are called from `enterWorld` in `main.ts`, not at module load. `setVolume` is safe
  before init. (`voice.ts` uses a plain `Audio` element, so it has no gated init.)
- **Each module owns its `localStorage` key:** keybinds `woc_keybinds` (namespaced
  per character: `woc_keybinds:char:<id>` online, `woc_keybinds:offline:<class>:<name>`
  offline, with the bare key kept as a read-only legacy seed for fresh characters),
  settings `woc_settings`, music on/off `ev_music_on`. All reads are try/catch-guarded
  (private mode / corrupt JSON fall back to defaults).
- **Keybinds:** `Escape` is reserved (`isReservedCode`) and never bindable — it
  always toggles the game menu. A code lives on at most one action (rebinding
  steals it). Up to 2 codes/action (primary + secondary). The default layout is
  vanilla-fidelity-critical and is covered by `tests/keybinds.test.ts` — keep it
  green. `mobile_controls.ts`/`settings.ts` have tests too.
- **i18n: any player-visible label/toast/error goes through `t()`** (imported from
  `../ui/i18n`), never a raw literal. Interaction-failure toasts use it
  (`hud.showError(t('questUi.errors.tooFar'))` in `interactions.ts`); the only
  dynamic control text here — the mobile haptics toggle label — is keyed
  (`t('hudChrome.mobile.haptics'/'…hapticsOff')` in `mobile_controls.ts`). The
  **static** mobile button labels (move/camera/attack/autorun/jump…) live in
  `index.html` via `data-i18n`, not here. Classify by render sink: an
  `aria-label`/`title`/`textContent` set to readable text is in scope too. **One
  carve-out:** the perf overlay/doctor/reporter text
  (`perf.ts`/`perf_doctor.ts`/`perf_reporter.ts`) is a `?perf`/`woc_perf`-gated
  developer diagnostic, so it stays English like `console.*`. No money/number/date formatting lives in this directory, so
  there are no format helpers to call; voice/SFX clips are language-agnostic assets
  (the localized dialogue is resolved elsewhere). Add new English keys to
  `src/ui/i18n.catalog/` (never the locale overlays); the maintainer batch-fills
  locales at release.

## Adding things
When new input/camera/perf logic gets non-trivial, extract the pure math here (the
`click_move`/`pointer_pick`/`perf_doctor` pattern) and unit-test it, rather than
growing `input.ts`.

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
  try/catch fallback — these modules must import cleanly under Vitest (jsdom).
- Never hard-code mouse sensitivity; scale `BASE_LOOK_SENS` via `setCameraSpeed`
  so the settings slider stays authoritative.
