<!-- src/game/: the local, browser-only input/audio layer. Dependency rules,
     the IWorld seam, and build/test commands live in root + src/ CLAUDE.md;
     this file only covers what's specific to this directory. -->

# src/game/ : local input, camera, audio, settings

Turns the player's keyboard/mouse/touch/gamepad into **movement intent** +
**`IWorld` command calls**. DOM/WebAudio-only; runs in `main.ts`.

## Key files
| File | Role |
|---|---|
| `input.ts` | `Input`: keyboard/mouse to `readMoveInput()` (polled each frame) + edge actions via `InputCallbacks` (`onAbility`, `onUiKey`, `onTab`, `onClickPick`). Owns `camYaw/camPitch/camDist`, autorun, pointer-lock, rebind capture. |
| `keybinds.ts` | `Keybinds` + `BIND_ACTIONS`: the classic remappable layout (pure, no DOM). |
| `interactions.ts` | `handlePickedEntity`: routes a click-pick to target/loot/quest/enter-dungeon via injected `PickInteractionWorld`/`PickInteractionHud`; one of the two files here that call `IWorld` (the other is `autoloot.ts`). |
| `autoloot.ts` | `AutoLoot`: the walk-by loot pass; fires `IWorld.autoLoot(id)` for corpses the local player looks eligible for (best-effort only, the sim's `autoLootForParty` gate stays authoritative). Caller passes the clock in, so it unit-tests deterministically. |
| `gamepad.ts` / `gamepad_map.ts` / `gamepad_bindings.ts` | pad support: thin polling consumer + pure deterministic mapping core + a separate remappable pad layout (deliberately NOT folded into `Keybinds`; different input space). Stick movement feeds `Input.setGamepadMove` (merged into `readMoveInput()`), camera via `applyGamepadLook`, edge buttons dispatch through the host's `onAction(id)` keybind path. Tests: `tests/gamepad.test.ts`, `tests/gamepad_map.test.ts`. |
| `mobile_controls.ts` | `MobileControls`: touch joysticks to `input.setTouchMove`/`setTouchLook`. |
| `touch_router.ts` | Pure, DOM-free touch ownership router: `getTouchOwner`/`isInteractiveHudElement`/`isCameraDragAllowedAt` + a per-pointer `TouchOwnerLedger`, consumed by `mobile_controls.ts` to keep move/combat/camera/menu touches from fighting over the same finger. |
| `audio.ts` | `GameAudio` (`audio` singleton): compatibility facade mapping non-positional UI/event methods to typed sampled `sfx.playUi()` cues. |
| `music.ts` | `MusicDirector` (`music` singleton): procedural zone/combat soundtrack. |
| `sfx.ts` / `voice.ts` | `sfx` / `voice` singletons: play pre-rendered clips from `public/audio/` (spatial 3D SFX + NPC voice lines) via their `*_manifest.generated.ts`. |
| `settings.ts` | `Settings`: persisted Esc-menu options. |
| `click_move.ts` / `pointer_pick.ts` / `camera_follow.ts` | pure, DOM-free input/camera math extracted from the render loop so they unit-test in isolation |
| `camera_driven_facing.ts` / `mouselook_release.ts` / `movement_visual.ts` / `keyboard_turn_facing.ts` / `self_alpha_lead.ts` | pure facing-and-feel math, an interlocking cluster (edit one knowing the others, or the facing-snap bug class returns): `camera_driven_facing` is the single source of truth for "is a camera driving facing this frame"; `mouselook_release` commits the final camera-yaw slice exactly once on the falling edge (the settle-back-snap fix); `movement_visual` is render-only diagonal facing, never gameplay facing; `keyboard_turn_facing` integrates local `TURN_SPEED` turns streamed as the authoritative wire facing (`main.ts` zeroes the turn flags while it owns the channel); `self_alpha_lead` is the echo-driven adaptive self render lead. |
| `spawn_cinematic.ts` | pure first-spawn camera approach math; start/landing/continuity pinned by `tests/spawn_cinematic.test.ts`. |
| `ui_effects_profile.ts` / `ui_tier_knobs.ts` | pure graphics-tier resolvers: the STATIC preset only, never the FPS governor (the root fairness invariant). Registered as game-leaf pure cores in `UI_PURE_CORES` (`tests/architecture.test.ts`); keep the registration in sync when moving or renaming them. |
| `desktop_*.ts` | Electron shell integration: `desktop_shell_integration.ts` is the one-call composition `main.ts` invokes (DESKTOP_APP-gated; every piece no-ops without the bridge), `desktop_shell_strings.ts` owns the `t()`-localized main-process dialog strings, `desktop_error_relay.ts` relays main-world errors to the shell log (the preload cannot see them across JS worlds), `desktop_download.ts` is the landing-page installer wiring. |
| `perf_doctor.ts` | pure perf-snapshot analyzer producing `PerfSuggestion[]` (no DOM); `perf_reporter.ts` is the telemetry reporter; `perf.ts` is the overlay/trace harness |

## Local invariants
- **Never mutate sim state directly.** `input.ts` only records intent and fires
  callbacks; only `interactions.ts` and `autoloot.ts` touch the world, and only
  through the `IWorld`-shaped interfaces passed to them. Do not import
  `Sim`/`ClientWorld` here.
- **`music.ts` synthesizes its soundtrack** in code via WebAudio. **`audio.ts` is
  primarily a compatibility facade over `sfx.ts`:** personal UI/event methods
  resolve to typed sampled `ui_*` cues. The release-specific `readyCheck()` chime
  remains a small procedural WebAudio fallback until it has a dedicated sampled
  catalog key. `sfx.ts` and `voice.ts` play pre-rendered clips under `public/audio/`
  keyed off their `*_manifest.generated.ts`; a missing clip is a silent no-op (the
  dialogue/combat text stays the source of truth).
- **`AudioContext` needs a user gesture**: `audio.init()`/`music.init()`/`sfx.init()`
  are called from `enterWorld` in `main.ts`, not at module load. `setVolume` is safe
  before init. (`voice.ts` uses a plain `Audio` element, so it has no gated init.)
- **SFX mix and speed are runtime data.** The generated SFX manifest resolves the
  category baseline plus per-key fine tune from `scripts/sfx/sfx_gain_map.json`
  and per-key rate from `scripts/sfx/sfx_speed_map.json`. `sfx.ts` applies gain
  through each `GainNode` and rate through `AudioBufferSourceNode.playbackRate`.
  One-shot caller rates and jitter multiply the authored rate; loops use the
  authored rate directly. `playbackRate` intentionally couples pitch and speed.
  These values never rewrite, conform, or resample the audio asset.
- **Production SFX packs are strict whole-catalog overrides.** On startup,
  `sfx.ts` may load `/audio/sfx/runtime-pack.json` before preloading audio. The
  pack can override only ordered track URLs, gain, and playback rate for the
  exact compiled key set and catalog hash. Invalid or unavailable packs fall
  back as a whole to the generated manifest. One-shots cycle tracks only when a
  source is accepted; loops pin a track until stopped.
- **Each module owns its `localStorage` key:** keybinds `woc_keybinds` (namespaced
  per character: `woc_keybinds:char:<id>` online, `woc_keybinds:offline:<class>:<name>`
  offline, with the bare key kept as a read-only legacy seed for fresh characters),
  settings `woc_settings`, music on/off `ev_music_on`; `gamepad_bindings.ts` has its
  own key too. All reads are try/catch-guarded (private mode / corrupt JSON fall
  back to defaults).
- **Keybinds:** `Escape` is reserved (`isReservedCode`) and never bindable, it
  always toggles the game menu. A code lives on at most one action (rebinding
  steals it). Up to 2 codes/action (primary + secondary). The default layout is
  classic-fidelity-critical and is covered by `tests/keybinds.test.ts`; keep it
  green. `mobile_controls.ts`/`settings.ts` have tests too.
- **i18n (root `t()` rules apply), the local facts:** the `t()` surfaces here are
  the mobile haptics toggle (`t('hudChrome.mobile.haptics'/'...hapticsOff')` in
  `mobile_controls.ts`), the `interactions.ts` error toasts (`questUi.errors.tooFar`,
  `hudChrome.death.spiritHealerAlive`), and `desktop_shell_strings.ts` (whole module
  of `t()`-rendered strings pushed to the Electron main process). The **static**
  mobile button labels (move/camera/attack/jump...) live in `index.html` via
  `data-i18n`, not here; the perf overlay/doctor/reporter
  (`perf.ts`/`perf_doctor.ts`/`perf_reporter.ts`) stays English, a `?perf`/`woc_perf`-gated
  dev diagnostic like `console.*`.

## Adding things (module-first)
A NEW behavior lands as its own pure, unit-tested sibling module with a
`tests/<name>.test.ts` (the `gamepad_map`/`click_move`/`pointer_pick`/`perf_doctor`
pattern), plus a thin DOM/side-effect consumer if it needs one (`gamepad.ts` over
`gamepad_map.ts` is the current reference split); never grow `input.ts` or
`main.ts`. Bug fix: reproduce with a failing test first (extract the buried logic
into a pure module if needed), then the smallest change that turns it green.

- **A new keybind/action:** add one entry to `BIND_ACTIONS` in `keybinds.ts`
  (`kind: 'held'` for movement polled in `readMoveInput`, else `'edge'`). For an
  edge action, extend `InputCallbacks.onUiKey`'s union and add a `case` in
  `Input.dispatchEdge`, then wire it where `new Input(...)` is constructed in
  `main.ts`. Action-bar slots (`slot0..11`) already route to `onAbility`.
- **A new SFX:** add the catalog entry and sampled asset, regenerate
  `sfx_manifest.generated.ts`, and route the typed key through `sfx.ts`. Personal
  UI/event call surfaces stay on `GameAudio`; author and publish them through the
  SFX Studio or the deterministic UI generator. Tune cross-clip gain and speed
  through the Studio-backed checked-in maps, never by editing the generated
  manifest or baking those values into the asset.
- **A new music cue/zone:** add a `MusicZone`, a `composeX()` theme, register it
  in the `buildMusicThemes()` map (music.ts), and drive it from
  `music.update(zone, inCombat)`.

## Never
- Never read `localStorage`/`window`/`AudioContext` from a constructor without a
  try/catch fallback: these modules must import cleanly under Vitest's plain-Node env
  (no DOM globals; jsdom is not a dependency), which is exactly where the fallback fires.
- Never hard-code mouse sensitivity; scale `BASE_LOOK_SENS` via `setCameraSpeed`
  so the settings slider stays authoritative.
