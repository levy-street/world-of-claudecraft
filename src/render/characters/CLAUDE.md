<!-- src/render/characters/: rigged player/creature visuals + char-creation preview.
     Presentation only (parent dirs cover IWorld seam, determinism, asset build).
     Don't repeat root / src / render CLAUDE.md, reference them. -->

# src/render/characters/: rigged character & creature visuals

Per-entity glTF (GLB) visuals: a `SkeletonUtils` clone of a manifest asset with
its own `AnimationMixer` and a clip-driven state machine. **Everything is
GLB-loaded** (`models/chars`, `models/creatures`, `models/weapons`), there is
no procedural-rig path here anymore. Reads the world; never mutates the sim.

## Files
- `manifest.ts`: pure data + dispatch. `VISUALS: Record<key, VisualDef>`, the
  `ClipMap`s, and `visualKeyFor(e)` (entity to key). No three.js, no loading.
- `anim_state.ts`: pure, three-free pose math: the `AnimState` (renderer-derived
  input) + `BaseState` types and `desiredBaseState()`/`locomotionTimeScale()` that
  `visual.ts` delegates to.
- `assets.ts`: module-import preloads `characterPreloadUrls()` via
  `registerPreload`: the tier-INDEPENDENT union of every graphics tier's URL
  set (placement resolves URLs against the LIVE tier after import froze the
  guess; see the P0 comment in `manifest.ts` and
  `tests/render_asset_preload.test.ts`). `prepareVisual(key)` memoizes
  normalize transform, resolved clips, click-capsule radius, and a baked
  idle-pose geo (far-LOD/shadow proxy).
- `asset_miss_log.ts`: once-per-key dev logging for character-asset failures in
  per-frame render paths; `createCharacterVisual` returns null on such a
  failure so callers skip the view for the frame instead of stalling the
  renderer (`tests/character_visual_fail_soft.test.ts`).
- `rig_merge.ts`: merges a KayKit rig's quantized body-part SkinnedMeshes into
  one draw per material (`assets.ts` `assembleModel` calls it). Read its
  header bind-pose proof before touching bone inverses.
- `visual.ts`: `CharacterVisual`, the mixer + `BaseState` machine, LOD/shadow/ghost
  plumbing, one-shot triggers, death/revive edge logic.
- `preview.ts`: `CharacterPreview`, the character-creation turntable (own scene/
  camera/loop), driven from `src/main.ts`; `preview_appearance.ts` resolves a
  `PreviewAppearance` (class, skin, mech, mainhand, offhand) to its visual key and
  independent held-item layout.
- `portrait.ts`: offscreen-WebGL headshot factory: renders a (class/visual-key, skin)
  PNG at the requested `PortraitFraming` from the real model, caches the data URL.
- `weapon_grip.ts`: pure, three-free per-weapon grip nudges
  (`WEAPON_GRIP_OVERRIDES`) layered on the family `VariantGrip`; shared with
  the asset pipeline's live inspector.
- `weapon_skin_materials.ts`: tracks and disposes the materials a displayed
  weapon skin owns (`tests/weapon_skin_materials.test.ts`).
- `skin_attack.ts`: skin-driven attack-clip substitution (a bow skin swaps
  the hunter's crossbow shot); pure over the skin catalog
  (`tests/weapon_skins.test.ts`).
- `back_grips.ts`: back-carry transforms for sheathed weapons on the chest
  bone; pure data + math (`tests/back_grips.test.ts`).
- `stow_transition.ts`: the sheathe-transition state machine (defers the
  hands-to-back prop swap to the gesture midpoint); pure
  (`tests/stow_transition.test.ts`).
- `portrait_framing.ts`: pure camera-framing math per `PortraitFraming`
  (headshot chip vs 3/4 body, e.g. the Inspect window) for `portrait.ts`
  (`tests/portrait_framing.test.ts`).
- `index.ts`: public exports + `createCharacterVisual(e, formKey?)` factory.

## Keys & dispatch
Every drawable is a `VisualDef` in `VISUALS` (player classes, creature families,
humanoid mobs, NPCs, forms). Dispatch precedence in `visualKeyFor`: players to
`player_<class>` (or `player_mech` for the mech skin catalog); mobs to
`MOB_KEYS[templateId]`, then `FAMILY_KEYS[MOBS[id].family]` (the family ids
live in `manifest.ts`), falling back to `mob_bandit`; NPCs to `NPC_KEYS`. Forms
(`form_sheep`/`form_bear`/`form_cat`/`form_travel`) are passed explicitly by the renderer.

## Animation
- `AnimState` (the renderer-derived input) and `BaseState`
  (`idle|walk|walkBack|run|cast|spin|swim|sit|jump`) live in `anim_state.ts`, which
  also owns `desiredBaseState()` (pose selection) and `locomotionTimeScale()`
  (foot-speed matching). Clip *names* are per source rig in the `ClipMap`
  factories (`manifest.ts`); names differ per rig (e.g. KayKit `Walking_A`,
  Quaternius `Gallop`), `baseAction()` falls back gracefully.
- **`src/render/renderer.ts` is the sole driver.** It builds `AnimState` each
  frame (swimming/sitting derived there, sim is unaware), calls `update(dt, s,
  animate)`, fires `playAttack()`/`playHit()` from sim events, and toggles live
  held items and effects. Don't drive visuals elsewhere.
- **Crowd scaling:** the renderer consults `src/render/crowd_lod.ts` (pure,
  unit-tested) for shadow/anim-cadence ranges as rig counts climb; the policy
  is cosmetic-only and exempts anything a player reacts to.
- Death/revive are **edge-triggered locally** from `s.dead` (clamped one-shot);
  `flourish` plays on respawn. One-shots clamp on the last frame, see the
  T-pose-pop comment in `playOneShot`.

## Adding things (module-first: where NEW work lands, and its test)
- **New family/key:** a declarative `VisualDef` in `VISUALS` (existing `ClipMap`
  or a new factory if the rig's clip names differ), wired via
  `FAMILY_KEYS`/`MOB_KEYS`/`NPC_KEYS`. `manifestUrls()` auto-preloads `url` +
  `attach[].url` + `animUrls` (skipping `lazyPreload` defs), so drop the GLB
  under `public/models/...` and run the media-manifest build.
- **New animation state:** add the field to `AnimState`, extend `BaseState` +
  `desiredBaseState()` (`anim_state.ts`), `baseAction()`, and `ClipMap`/`clipNamesOf()`,
  then have the renderer set the new flag. New pose LOGIC goes in the pure
  `anim_state.ts` half a Vitest imports directly, never inline in `visual.ts`.
- **Tests:** `tests/visual_manifest.test.ts` pins the `VISUALS`/clip contract,
  `tests/visual_anim_state.test.ts` the pose selection. Fix bugs test-first:
  reproduce there (or in `tests/rig_merge.test.ts` for merge math), then the
  smallest change that turns it green.

## Gotchas / never
- KayKit GLBs ship **every** accessory visible: `VisualDef.show` is an allowlist
  of non-skinned node names to KEEP; omit it for creatures (keeps everything).
- Bone names are sanitized by GLTFLoader (`handslot.r` to `handslotr`); `attach`
  resolution tries both. A missing bone ships the model without the prop.
- Geometries/materials are **shared per-asset caches and never disposed**;
  `dispose()` only releases this clone's mixer + Skeletons. YOU MUST call it on
  despawn (online interest churn strands GPU bone textures otherwise).
- Never `Math.random` in *sim*, but here it's fine, this is presentation
  (bob phase, hit-clip pick). Never reach past `IWorld` into a concrete world.
