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
- `assets.ts`: module-import preloads every `manifestUrls()` GLB via
  `registerPreload`; `prepareVisual(key)` memoizes normalize transform, resolved
  clips, click-capsule radius, and a baked idle-pose geo (far-LOD/shadow proxy).
- `visual.ts`: `CharacterVisual`, the mixer + `BaseState` machine, LOD/shadow/ghost
  plumbing, one-shot triggers, death/revive edge logic.
- `preview.ts`: `CharacterPreview`, the character-creation turntable (own scene/
  camera/loop), driven from `src/main.ts`.
- `portrait.ts`: offscreen-WebGL headshot factory: renders a (class/visual-key, skin)
  head-and-shoulders PNG from the real model, caches the data URL. Consumed by
  `src/main.ts`, `src/ui/unit_portrait_painter.ts`, `src/ui/hud.ts`, `portrait_chip.ts`.
- `index.ts`: public exports + `createCharacterVisual(e, formKey?)` factory.

## Families & keys
~12 creature families plus 9 player classes, forms, skeletons, humanoid mobs,
and NPCs, all in `VISUALS`. Dispatch precedence in `visualKeyFor`: players to
`player_<class>` (or `player_mech` for the mech skin catalog); mobs to
`MOB_KEYS[templateId]` then `FAMILY_KEYS[MOBS[id].family]`
(beast/humanoid/murloc/spider/kobold/undead/troll/ogre/elemental/dragonkin/demon),
falling back to `mob_bandit`; NPCs to `NPC_KEYS` (default `npc_villager`). Forms
(`form_sheep`/`form_bear`/`form_cat`/`form_travel`) are passed explicitly by the renderer.

## Animation
- `AnimState` (the renderer-derived input) and `BaseState`
  (`idle|walk|walkBack|run|cast|swim|sit|jump`) live in `anim_state.ts`, which
  also owns `desiredBaseState()` (pose selection) and `locomotionTimeScale()`
  (foot-speed matching). Clip *names* are per source rig in `ClipMap` factories:
  `kaykit`, `skeletonClips`, `animal`, `BIPED14`, `ENEMY7`, `FLOATING`, `SPIDER`.
  Names differ per rig (e.g. KayKit `Walking_A`, Quaternius `Gallop`),
  `baseAction()` falls back gracefully.
- **`src/render/renderer.ts` is the sole driver.** It builds `AnimState` each
  frame (swimming/sitting derived there, sim is unaware), calls `update(dt, s,
  animate)`, fires `playAttack()`/`playHit()` from sim events, and toggles
  `setFar`/`setShadow`/`setProxyShadow`/`setGhost`. Don't drive visuals elsewhere.
- Death/revive are **edge-triggered locally** from `s.dead` (clamped one-shot);
  `flourish` plays on respawn. One-shots clamp on the last frame, see the
  T-pose-pop comment in `playOneShot`.

## Adding things
- **New family/key:** add a `VisualDef` to `VISUALS` (existing `ClipMap` or a new
  factory if the rig's clip names differ) and wire `FAMILY_KEYS`/`MOB_KEYS`/`NPC_KEYS`.
  `manifestUrls()` auto-preloads `url` + `attach[].url` (skipping `lazyPreload`
  defs), so drop the GLB under `public/models/...` and run the media-manifest build.
- **New animation state:** add the field to `AnimState`, extend `BaseState` +
  `desiredBaseState()` (`anim_state.ts`), `baseAction()`, and `ClipMap`/`clipNamesOf()`,
  then have the renderer set the new flag.

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
