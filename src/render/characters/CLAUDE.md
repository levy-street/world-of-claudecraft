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
  idle-pose geo (far-LOD/shadow proxy). `charactersReady()` is a narrower gate
  than the site-wide `assetsReady()`: only this file's boot GLBs + skin atlases,
  with its own retry loop (delayed, backed off between outer attempts) so a
  transient failure anywhere else on the site can never permanently blank the
  landing character-creation preview (`src/main.ts` awaits it there instead of
  `assetsReady()`; see `tests/character_preview_boot.test.ts`).
- `asset_miss_log.ts`: once-per-key dev logging for character-asset failures in
  per-frame render paths; `createCharacterVisual` returns null on such a
  failure so callers skip the view for the frame instead of stalling the
  renderer (`tests/character_visual_fail_soft.test.ts`).
- `halo.ts`: the class halo (the priest's Light): `buildHalo(color, upOffset,
  radius)`, driven by `VisualDef.halo` plus the optional
  `haloUpOffset`/`haloRadius` placement overrides (defaults live here; the
  priest overrides only the lift, for hat clearance). Texture, per-color
  materials, and
  per-radius geometries are shared never-disposed caches; radii must come from
  static `VisualDef` values so the cache keys stay bounded. `visual.ts` parents
  the mesh to the head bone and keeps it out of the shadow-caster sweeps
  (`tests/character_halo.test.ts`).
- `rig_merge.ts`: merges a KayKit rig's quantized body-part SkinnedMeshes into
  one draw per material (`assets.ts` `assembleModel` calls it). Read its
  header bind-pose proof before touching bone inverses.
- `skin_gpu_layout.ts`: compacts merged palettes to every matrix the shader
  fetches, narrows exact joint indices, and crops unused RGBA32F bone-texture
  rows without changing skin weights, matrix values, draws, or shader math.
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
- `modular.ts`: pure part-selection + colour math for COMPOSED bodies (the
  warrior test bed). See "Modular bodies" below.
- `index.ts`: public exports + `createCharacterVisual(e, formKey?)` factory, plus
  `setModularLookProvider` (the entity-to-composed-look seam).

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
- **Crowd scaling / LOD bands:** the renderer consults `src/render/crowd_lod.ts`
  (pure, unit-tested) for the shadow/anim-cadence ranges as rig counts climb,
  and for where `setFar` swaps the rig for the baked idle-pose mesh. Between the
  articulated band and that swap sits the animated far band: the rig keeps its
  clips at a low cadence (the mixer integrates the skipped time via `pendingDt`,
  so the clip plays at its real speed, just at fewer pose updates) instead of
  freezing. The policy is cosmetic-only and exempts anything a player reacts to
  from BOTH the cadence and the frozen mesh.
- Death/revive are **edge-triggered locally** from `s.dead` (clamped one-shot);
  `flourish` plays on respawn. One-shots clamp on the last frame, see the
  T-pose-pop comment in `playOneShot`.
- **Never leave the rig at zero weight.** A SkinnedMesh renders BIND pose (the
  T-pose) whenever the mixer's scheduled actions sum below 1, and the base-state
  fade only runs on an EDGE, so a partner-less `fadeIn` sticks for as long as a
  held state (strafe/cast/walk) lasts. Start every clip through `beginAction`
  (crossfade only when the outgoing action still drives the rig, else snap to
  full weight); the per-frame `scanAnimRepair` watchdog (`anim_state.ts`) is the
  backstop that re-drives the base pose after 3 starved frames.

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
  `tests/character_clipmaps.test.ts` gates every ClipMap name against the clips
  actually in the shipped GLB (both graphics tiers), `tests/character_anim_state.test.ts`
  the pure pose/watchdog math, `tests/character_tpose_repair.test.ts` the live
  mixer weights across death, respawn and repeated swings. Fix bugs test-first:
  reproduce there (or in `tests/rig_merge.test.ts` for merge math), then the
  smallest change that turns it green.

## Modular bodies (`player_warrior_modular`)
A `VisualDef` with `modular: true` points at a PART LIBRARY, not a finished
character: `models/chars/modular/warrior_modular.glb` carries both base bodies,
their underclothing, every hair/brow, and ALL SEVEN class kits cut into equip
slots, all on the one shared `Rig_Medium`, which is why no cross-file skeleton
matching is ever needed.
`assembleModel` routes those defs to `assembleModular`, which prunes the parsed
scene to the picked node names (`modularPartNames`), runs the SAME
`mergeSkinnedParts` pass, and caches the result per part set, so a kitted body
is ~1 draw per material (skin/hair/eye/cloth + one atlas per set worn), not one
per part.
- Slots may be MIXED across sets, and a set does not have to fill every slot: the
  helmless sets leave `head` empty so the character's own hair shows, and the
  mage has no `hands` piece because KayKit models its hands as bare flesh.
  `helmed` therefore tests for an actual head PIECE, not for the slot being set.
- The underclothing (`M_Loin`, `F_Loin`, `F_Top`) is body geometry but is
  REPLACED, not layered: each piece draws only while its slot is bare (loincloth
  answers to `legs`, chest wrap to `chest`), because worn under a set of tassets
  it just pokes through them. It carries `mod_cloth` so the skin-tone wheel does
  not repaint it. `slotCovered()` is the test, and a set that has no piece for
  the slot does not count as covering it.
- The FACE is morph targets, not geometry variants: eight paired sliders
  (`nose_up`/`nose_dn` ...) resolved by `morphInfluences()` and applied per
  instance in `applyMorphs`. Geometry stays shared, so the face must never enter
  `modularGeometryKey`, only the signature. `mergeSkinnedParts` leaves
  morph-carrying parts unmerged by design, which is what makes this work at all.
- The MOUTH is a part (`M_Mouth_<style>` / `F_Mouth_<style>`), not a morph. It
  used to be a crease in the head driven by exclusive presets, and measured,
  neither head had a mouth worth the name: a 15mm dent on the male that faded to
  nothing by x=0.06, and none at all on the female, what she was showing was
  the shading of her triangulation, which is why hers looked the cleaner of the
  two. A 13-vertex band cannot hold a mouth, so it became a projected part like
  the eyes. That buys lips that stand PROUD of the skin (a dent only goes
  inward), symmetry by construction (every sample is taken at |x| and
  reflected), and open styles that are a different MESH, aperture, dark cavity
  and their own teeth, rather than a deformation of a closed one. Unlike the
  ears it survives a helm, for the reason the eyes do: every helm is open at the
  face. The head keeps its `mouth_*` targets even though nothing drives them,
  `stubble.ts` reads them to locate the lips.
- A part with more than one MATERIAL (only the mouth: lips, mouth line, teeth)
  exports as a multi-primitive glTF mesh, and GLTFLoader expands that into a
  GROUP named after the node whose children are named after the mesh DATABLOCK.
  `modularVariant`'s prune therefore matches a mesh's own name OR its parent's.
- `buzz` / `crew` (hair) and `stubble` / `scruff` (beard) are NOT volumes and no
  longer parts at all: they are a TEXTURE DECAL built at compose time from the
  head's own surface (`stubble.ts`, material `mod_stubble`, alpha-blended,
  recoloured with the HAIR colour). See the section below. The GLB's old
  `M_Fuzz_buzz` / `M_Stub_stubble` layers are dead and nothing picks them.
- Eyes, ears, lashes and teeth are their own parts, not islands inside the head
 that is what lets eyes and ears be swapped and scaled at all. They are body
  parts no armour slot hides. Brows/eyes/lashes/stubble are PROJECTED onto the
  head surface at authoring time (`tmp/modular/features.py`), so they cannot
  float off it.
- Every projected face part is per-gender (`M_Eye_almond`, `F_Brow_soft`, …) for
  the same reason the fuzz caps are: the two heads are separate sculpts, not one
  scaled copy, and a patch built against the male head lands INSIDE the female
  one. Shipping a single set left every female character with no eyes at all.
- ...and every one of them carries the HEAD's own shape-key names (`cheeks_up`,
  `jaw_dn`, …) alongside its own. Projection glues a part to the face at BUILD
  time only; the cheeks slider then moves the head surface by up to 27mm at the
  outer corner of the eye. `applyMorphs` drives targets by name, so a part that
  ships `cheeks_up` follows the head for free. No-op keys are dropped at
  authoring time, so what a part carries says which sliders actually reach it.
- The eyelash is the flick KayKit models into the rogue head, rebuilt per eye
  shape so it always leaves the corner that eye actually has. It rides
  `mod_hair` and so has no colour of its own, a lash is hair. `lashes` is a
  plain on/off in the appearance, defaulting ON so a look saved before it
  existed does not read as "shaved".
- The eye material is recoloured per character like skin and hair; teeth
  (`mod_tooth`) and the mouth interior (`mod_mouth`) never are. The mouth line
  is near-black and so is the eye, but it must NOT share `mod_eye`: that goes
  through the player's eye wheel, so blue eyes gave you a blue mouth. Its colour
  also has to differ from `mod_eye`'s, because the glTF exporter merges
  materials whose settings are identical and the bug would come back silently.
- The class sets' OWN bare-skin faces are deleted at authoring time (UV swatch
  cell (0,3)) so the player's body and skin tone show through a barbarian's
  chest or a druid's midriff instead of flesh painted from the class atlas.
- Colours are material-level: `mod_skin`/`mod_hair` are swapped for a recoloured
  clone BEFORE `applyMaterials` snapshots the source, so the tint survives the
  low-graphics Lambert path. Only PLATE gets `userData.bodyMesh`, keeping the
  per-class skin-atlas swap (`SKINS`) off the colour-picked body, `bodyMesh` is
  keyed off `isArmorMaterial`, so a new set MUST be added to `ARMOR_MATERIALS`
  or its plate silently stops responding to skins.
- A look change is a GEOMETRY change: callers rebuild the visual (as
  `CharacterPreview.setVisualKey` does) rather than mutating one in place.
- **Only the local player composes.** The appearance is presentation state with
  no wire format, so `setModularLookProvider` claims that one entity and every
  other warrior keeps the fixed `player_warrior` rig. The far-LOD bake in
  `prepareVisual` likewise measures `DEFAULT_LOOK`, not the entity's.
- Part names are the contract; `tests/modular_character.test.ts` gates the tables
  against the shipped GLB, because a renamed node fails SILENTLY (the body just
  loses a limb). Authoring scripts live in `tmp/modular/`; the body's radius
  tables are SOLVED against the armour there (`solve_body.py` + `expose.py`),
  not hand-tuned, and each set is fitted to the frozen body by `classfit.py`.

## Stubble as a decal (`stubble.ts`)
Growth too short to have a silhouette is skin you can see THROUGH hair, so it is
a mask, not a mesh. Modelled as a shell it reads as a helmet; modelled as a
flat-alpha copy of the head's faces (what shipped before) it reads as a smudge
with an outline that lands wherever the head's coarse triangles fall. The decal
is the head's own surface, trimmed, subdivided, lifted 0.4% of head height, and
painted with a generated RGBA map.
- Nothing is added to the GLB and nothing is authored: the frame, the unwrap,
  the mask and the stipple are all derived from the head geometry at runtime and
  cached per (head, styles). Switching the styles off adds NO object at all, so
  a bare face is exactly the head.
- The head frame is the head's own BOUNDING BOX mapped to the unit sphere. Every
  primitive in the GLB is meshopt-quantized into its own integer range (see
  `rig_merge.ts`), so the two heads do not even share a coordinate system,
  normalizing by the box makes one set of angles describe both.
- The unwrap is AZIMUTHAL EQUIDISTANT about the head centre, which is continuous
  and injective everywhere but one direction (straight down, which `TRIM_THETA`
  removes). The obvious lat-long unwrap has a seam down the back of the head and
  a degenerate crown, and BOTH are inside a buzz cut's footprint.
- The footprints were measured off the layers that shipped before, and the
  landmarks they respect were measured off the head's own morph targets:
  `mouth_*` moves exactly the lip ring, `nose_up` exactly the nose. The tests
  assert against those targets rather than against the constants.
- The NOSE OVERHANGS the philtrum, so a directional unwrap sends the nostril
  underside and the skin below it to the same texel. The overhang is removed
  from the decal surface (`isNoseUnderside`, applied after subdividing so its
  edge is fine), that is what lets the beard line be the measured one and still
  keep the nose clean. The general form of that test ("is anything closer to the
  head centre along this ray") is WRONG: it carved a rectangle out of the skin
  under the lower lip, off the mouth crease's inner wall at 0.58 of the chin's
  radius. (`mouth_seat` has since smoothed that crease away, the mouth is its
  own part, but the general test is still the wrong shape of test.)
- The stipple is a jittered lattice over the SPHERE OF DIRECTIONS, with a whole
  number of columns per ring so it closes on itself (no grain seam at the nape).
  Dots must be a texel or two across, at 1024 texels over 360 degrees a
  "realistic" 0.2-degree dot is sub-texel and reads as noise, and the ring
  above and below has to be tested too, or every dot sits near its ring centre
  and the field reads as horizontal rows.
- RGB is written in EVERY texel, alpha only where there is growth: three
  multiplies the whole texel into the fragment, so a transparent texel left at
  black bleeds through bilinear filtering and rings every dot with a dark halo.
- Subdivision is what makes the line clean, and its effect is invisible unless
  you subtract the lift first: measured against the lifted vertex, going from 2
  levels to 3 looks like it buys 0.07 degrees; measured against the skin under
  it, it buys 1.10 -> 0.30. Two levels (~10k triangles, ~50ms, ~1.1MB of morph
  data) is the shipped trade.
- A plain `map` and not a shader ON PURPOSE: `tintedMaterial` rebuilds every
  character material as Lambert on the low graphics tier, so an injected shader
  (the `addRimGlow` hook) silently vanishes there. That path now also carries
  `depthWrite` / `polygonOffset` across, which it did not before, they are
  blend state, not shading.

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
