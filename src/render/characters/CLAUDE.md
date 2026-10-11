<!-- src/render/characters/: rigged player/creature visuals + char-creation preview.
     Presentation only (parent dirs cover IWorld seam, determinism, asset build).
     Don't repeat root / src / render CLAUDE.md, reference them. -->

# src/render/characters/: rigged character & creature visuals

Per-entity glTF (GLB) visuals: a `SkeletonUtils` clone of a manifest asset with
its own `AnimationMixer` and a clip-driven state machine. **Everything is
GLB-loaded** (`models/chars`, `models/creatures`, `models/weapons`), there is
no procedural-rig path here anymore. Reads the world; never mutates the sim.

## Load-bearing files (everything else: read its header)
- `manifest.ts`: pure data + dispatch. `VISUALS: Record<key, VisualDef>`, the
  `ClipMap`s, and `visualKeyFor(e)` (entity to key). No three.js, no loading.
- `anim_state.ts`: pure, three-free pose math: the `AnimState` (renderer-derived
  input) + `BaseState` types and `desiredBaseState()`/`locomotionTimeScale()` that
  `visual.ts` delegates to.
- `assets.ts`: eager `registerPreload` of `characterPreloadUrls()`, the
  tier-INDEPENDENT union of every graphics tier's URL set (the why lives in
  the Asset loading section of `src/render/CLAUDE.md` and the P0 comment in
  `manifest.ts`), plus the one DEFERRED registration, the WOC player bodies'
  world-entry files (the WOC split files entry below). `prepareVisual(key)`
  memoizes normalize transform, resolved
  clips, click-capsule radius, and a baked idle-pose geo (far-LOD/shadow
  proxy; a WOC key bakes its shadow stand-in instead, see "WOC far LOD off
  the frame"). `charactersReady()` is deliberately NARROWER than the site-wide
  `assetsReady()`: only this file's boot GLBs (the skin atlases defer on every
  host and rejoin this gate only if the eagerSkinAtlases kill-switch in
  `assets.ts` is ever flipped back), with its own
  delayed, backed-off retry loop, so a transient failure anywhere else on the
  site can never permanently blank the landing character-creation preview
  (`src/main.ts` awaits it there instead of `assetsReady()`;
  `tests/character_preview_boot.test.ts`).
- `armor_dye.ts`: the outfit-colorway dye shader layer (`attachArmorDye`, plus
  `reapplyArmorDyeToClone` for the clone path). Its own leaf module because
  `../material_clone_hooks.ts` must re-attach it on every program-preserving
  clone and cannot depend on the whole of `assets.ts` to do it; the spec rides
  `Material.userData.armorDye`, which `clone()` copies while it drops the hook.
  A sibling key on the same material, `userData.armorDyeFallbackHex`
  (`assets.ts` `recolored()`), carries a flat, multiply-safe approximation of
  the same colorway for the low tier, which has no shader stage to run the
  spec in at all; `buildTintedClone`'s Lambert branch reads it instead.
- `visual.ts`: `CharacterVisual`, the mixer + `BaseState` machine, LOD/shadow/
  ghost plumbing, one-shot triggers, death/revive edge logic. A transparent
  effect (ghost run, stealth, Shadowform, Moonkin) is a new program per rig
  material, so its clones link hidden behind the same compile gate before the
  swap commits (`stageEffectSwap`, twinning each source mesh's KIND because
  three keys `skinning` on `isSkinnedMesh`); a swap still in flight when the
  gate is replaced (`setFarBakeGate`, a pooled body handed out again) is
  planned again behind the new gate, never dropped and forgotten; the Soul
  Rend mark is exempt and commits at once, being actionable raid information
  (`tests/character_effect_compile_gate.test.ts`).
- `halo.ts`: the class halo (`buildHalo`, driven by `VisualDef.halo` +
  `haloUpOffset`/`haloRadius` overrides). Texture, per-color materials, and
  per-radius geometries are shared never-disposed caches, so radii MUST come
  from static `VisualDef` values to keep the cache keys bounded; `visual.ts`
  parents the mesh to the head bone and keeps it out of the shadow-caster
  sweeps (`tests/character_halo.test.ts`).
- `rig_merge.ts`: merges a KayKit rig's quantized body-part SkinnedMeshes into
  one draw per material (`assets.ts` `assembleModel` calls it). Read its
  header bind-pose proof before touching bone inverses.
- `morph_union_core.ts`: the union target list a merge pads its parts to, and
  the one place the merged buffer's morph-texture cost is written down (three
  builds that DataArrayTexture lazily at the first live draw, outside the
  compile gate's upload lane; measured, see its header).
- `rig_shared_skeleton.ts`: the same bind-pose proof applied WITHOUT merging, so
  a rig ends with ONE Skeleton, one palette flatten and one GPU bone texture
  however many parts it draws (`SkeletonUtils.clone` mints one per SkinnedMesh,
  and the modular GLB ships 246 skins over one 23-joint list). Runs after
  `mergeSkinnedParts` on the cached variant and again on every clone, where it
  is a pure rebind. The composed HEAD is its canonical part on purpose: the
  canonical part is the one whose geometry is not rebaked, and the head's buffer
  is the identity the stubble/makeup decal cuts are cached on.
- `index.ts`: public exports + `createCharacterVisual(e, formKey?)` factory,
  plus `setModularLookProvider` (the entity-to-composed-look seam).
  `createCharacterVisual` returns null fail-soft on an asset miss, with
  once-per-key dev logging (`asset_miss_log.ts`), so per-frame callers skip
  the view for the frame instead of stalling the renderer
  (`tests/character_visual_fail_soft.test.ts`).

Sibling families (one line each; extraction targets, never re-grow `visual.ts`):
- Preview: `preview.ts` (`CharacterPreview`, the character-creation turntable;
  constructed from `src/main.ts` AND from `src/ui/hud.ts`, which moves one
  shared instance between hosts on /play; `src/ui/appearance_customizer.ts`
  drives it live via `setModular`) with `preview_appearance.ts`,
  `preview_policy.ts`, `preview_framing.ts`, `preview_armor_detail_core.ts`
  and `preview_material_gate.ts`. A stage says what it shows, and that decides
  the armor detail its WOC body draws (the paragraph on the split files below):
  a new stage that shows someone else's character, or many characters in turn,
  declares itself there rather than taking the full-detail default. The
  material gate is the compile gate its body's late materials link behind
  (link, sliced upload, touch, all in the preview's own context). A warm the
  context rejects is reported once per target as a settle that is not ready: a
  node with nothing standing in for it (a late head file, a first armor file)
  is then shown rather than left hidden for good, while the body atlas swap
  keeps its stand-in, asks once more, and is never committed cold there
  (`tests/preview_material_gate.test.ts`).
- Portraits: `portrait.ts` (offscreen-WebGL headshot factory, caches data
  URLs) + `portrait_framing.ts` (pure framing math per `PortraitFraming`) +
  `portrait_prewarm_core.ts` (the async capture's step order) +
  `portrait_capture_lane_core.ts` (one live capture per cache key). A WOC
  headshot frames off the DRAWN modular head, never a body-height fraction:
  `woc_portrait_bounds.ts` `measureWocPortraitHead` reads the hung pieces and
  `headshotAimForHead` sizes the frame on the neck-to-eye height (a hairstyle
  moves the crown, never that), so every class, head type and body scale frames
  its face alike (`tests/portrait_framing.test.ts`, and the pixel pins in
  `tests/browser/woc_portrait.browser.test.ts`). The kit is worn bare-headed
  there: a helm would hide the hair the player picked. A head-keyed chip waits
  on its key through the request `portrait_chip.ts` files for it. The CAPTURE
  itself is `portrait_snapshot.ts`, a thin GL adapter over the pure
  `portrait_bitmap_transfer_core.ts` and `portrait_readback_core.ts`, the
  worker client `portrait_bitmap_encode.ts` (with
  `portrait_encode_worker.ts`) and the DOM-only `portrait_png_encode.ts`. It
  has THREE arms, each falling through to the next. First it draws into the
  rig's own drawing buffer, snapshots that frame with `createImageBitmap` and
  TRANSFERS the bitmap to the encode worker, so no portrait byte ever reaches
  the gameplay thread: measured on a Mesa iGPU under a loaded ride, p50 0 ms of
  main-thread blocking per capture against 116 ms for the readback arm, and not
  one capture in 24 blocking for over 16 ms. Failing that (no `Worker`, no
  `OffscreenCanvas`, no `createImageBitmap`, or a latched worker failure) it
  renders into a `WebGLRenderTarget` and reads it back through three's
  fence-backed `readRenderTargetPixelsAsync`, which still beats the last arm
  because `canvas.toBlob` off the default framebuffer defers the PNG ENCODE but
  does the GPU READBACK synchronously (67 to 118 ms per portrait unit, 1477 ms
  of self time across a post-entry ride); on an integrated GPU the fence only
  says the bytes are READY, and `getBufferSubData` still blocks 28 to 76 ms
  pulling them across, which is what the transfer arm exists to avoid. The
  transfer arm claims the rig's ONE default framebuffer from its draw until its
  snapshot is in hand, so a second capture in that window takes the readback arm
  rather than drawing over a frame still being copied; its own failure is
  latched separately (a dead worker must not cost the rig its fence-backed
  readback too), and a worker that cannot even be CONSTRUCTED costs only the
  arm, not the capture, which falls to the readback with the draw closure still
  valid. Which arm each capture took, and every latch, is counted in
  `gpu_prep_events.ts` (`perfStats().gpuPrep.events.portraits`): a host that
  silently loses the top arm just gets slower, and nothing else in a capture
  would say so. The core owns the TWO software conversions that keep
  the output the same colour toBlob's was: readPixels is bottom-up where
  ImageData is top-down, and both buffers hold premultiplied colour where a PNG
  holds straight alpha. The sRGB transfer is NOT one of them, it is done by the
  GPU: the adapter gives the target texture `renderer.outputColorSpace`, so for
  an UnsignedByte RGBA texture three allocates SRGB8_ALPHA8
  (`getInternalFormat`, three 0.185.1) and WebGL2 converts linear to sRGB in
  hardware as the framebuffer is written, which is why readPixels already hands
  back encoded bytes. Both halves are load bearing and both are pinned by tests:
  encoding a second time in software washes every portrait out, and dropping the
  `texture.colorSpace` assignment makes every portrait dark. The target's buffers are shared
  by every capture on the rig while the lane dedupes per cache KEY only, so a
  second concurrent capture takes the synchronous path. That old synchronous
  path is also the fallback for a context that cannot fence, latched after any
  async failure (including a readback that fulfils WITHOUT handing back the
  buffer it was given, which three does when the target has no framebuffer:
  encoding then would cache the previous portrait's face under this key). The
  draw MUST happen before the capture promise exists: `runPortraitPrewarm`
  releases the subject as soon as it holds one. The LIVE
  getters never capture on the calling frame, the composed
  `modularPortraitDataUrl` included: a miss answers null, kicks the async
  capture through the lane, and fires `onPortraitUpdate` when it lands (a
  composed capture is named by its cache key, the listener's third argument,
  since no (class, skin) pair describes one).
- Weapons/props: `weapon_grip.ts`, `held_item_grips.ts`, `back_grips.ts`,
  `stow_transition.ts`, `skin_attack.ts`, `weapon_skin_materials.ts`, and
  `weapon_attack_style_core.ts`, a CROSS-SUBSYSTEM seam
  (`ability_vfx/painter.ts` imports `attackAbilityId` from it). Authored
  surfaces: `manifest.ts` `AUTHORED_HELD_MODELS` (a held GLB that keeps its
  shipped response instead of `assets.ts` `applyWeaponMaterialPolish`) and
  `VisualDef.authoredAtlas` (a creature atlas that takes the low-tier
  readability floor through its map); both opt-in per model. **Every new
  Tripo or Blender creature, mount, or held item declares one of them** (the
  asset pipeline's `visualDefSnippet` emits the flag for a creature, and its
  `registerWeapon` returns the held-model decision as a follow-up action);
  `tests/authored_surfaces.test.ts` scans the shipped GLBs and fails any
  authored atlas that is neither flagged nor on its explicit legacy list.
- `stonebound_shell_core.ts`: the Stonebound weapon-shell style. Wireframe on any
  antialiased frame; a solid translucent sheath when NO AA pass runs (Low, and the
  memory-constrained WebKit profiles), because a one-pixel GPU wireframe crawls
  over the dense weapon mesh without AA. Keyed on the `GfxSettings` AA facts
  (`smaa`/`fxaa`/`msaaSamples`), never on a tier name; cosmetic only.
- Perf cores: `skeleton_update_cache.ts`/`skeleton_update_core.ts` (skeleton
  palette update elision), `skin_gpu_layout.ts` (bone-texture compaction
  without changing weights, matrices, draws, or shader math),
  `skinned_sort_spheres.ts` (static sort spheres so three never brute-forces
  a missing SkinnedMesh bounding sphere), `tinted_material_cache_core.ts`,
  `material_program_shape_core.ts` (the per-object facts three re-derives a
  material's program parameters from; its key is a fragment of the tinted
  cache key, so a mounted material is shared only among meshes three would
  not re-derive between) with `shadow_depth_materials.ts` (the same split for
  the shadow pass: one shared MeshDepthMaterial per program shape, mounted as
  `customDepthMaterial` on alpha-free skinned casters so three's one global
  depth material stops flipping per caster),
  `visual_pool.ts`/`visual_pool_policy.ts` (own section below).
- On-model cues: `charge_glow.ts` + `_core` (a fist lighting up before a
  telegraphed slam, parented to the hand bone and animated in bone-local space)
  and `eye_glow.ts` + `_core` (a permanently lit eye, for a creature whose eye
  IS its identity). Both are declared as DATA, `ClipMap.chargeGlowByAbility` and
  `VisualDef.eyeGlow`, so a second creature earns them by adding a row. One trap
  is shared and has bitten twice: a radius in a spec is BONE-LOCAL, and the rig's
  normalize-and-scale chain (16x on a 4.2x-scaled boss) sits between it and world
  units. A mesh radius rides that chain for free; `PointsMaterial.size` under
  `sizeAttenuation` does NOT, because three's point shader never consults the
  object's world matrix, so it must be multiplied through by hand
  (`moteWorldSize`). Both directions of the mistake render a plausible frame:
  a beach ball, or a sub-pixel nothing.
- Appearance decals/motion: `stubble.ts` (own section below), `makeup.ts`
  (blush/eyeshadow on the same decal machinery; lipstick is deliberately a
  material tint on the mouth PART instead), `look_pieces.ts` (a composed
  look's decal maps and cuts as deduped PIECES of the GPU work queue, painted
  a row band per unit, the map's buffer allocated inside the first band's
  unit and never in the deciding frame; a live candidate whose pieces are not resident builds
  its body at once WITHOUT the face decals, the stand-in, and
  `CharacterVisual.attachDeferredDecals` adds them through the compile gate
  once they land; never deferred under a cover or for the target: the producer
  contract in `src/render/CLAUDE.md`), `hair_sway.ts` (long-hair motion
  via morph targets, not shaders, so the low-tier Lambert rebuild cannot drop
  it), `underhair.generated.ts` (regenerated by the Fit Studio server,
  `scripts/asset_pipeline/lib/fit_studio.mjs`; never hand-edit).
- Bespoke ability clips: `paladin_bastion_sweep_clip.ts` /
  `paladin_templars_verdict_clip.ts` (with their `paladin_bastion_sweep_fx.ts` /
  `paladin_templars_verdict_fx.ts` twins): procedural `AnimationClip`s built in
  code and registered per ability; the template future ability-animation work
  follows.
- Form adornments: `form_adornments.ts`, the per-rig owner `CharacterVisual`
  holds and drives from the `setMoonkin`/`setShadowform` edges the renderer
  already sends, over the pure `form_adornment_core.ts` (what a rig wears, the
  pose math) and two painters, `moonwing_adornment.ts` (antlers, crescent,
  wings) and `gloamveil_veil.ts` (the face veil), with their canvas art in
  `form_adornment_textures.ts` and the shared marker and glow recipe in
  `rig_fx.ts`. Pieces ride the rig's `head`/`chest` bones, carry the
  `weaponVfxMesh` marker so no overlay swap, prewarm twin or caster sweep
  touches them, hide under a ghost or stealth body, and their shared kits are
  prewarmed through `ABILITY_MATERIAL_SOURCES`; a rig's first mount of a set
  still waits hidden behind the injected compile gate
  (`tests/form_adornments.test.ts`, `tests/character_form_adornments.test.ts`).
- WOC split character files (the player bodies, 2026-09-28): one base and one
  animation library per body fit, plus the hand-keyed library over it
  (`woc_keyed_animations.ts`: `players/woc_keyed/woc_<fit>.glb`, keyed on the same bind
  pose by `scripts/assets/woc_keyed_anims/`, for the idle, gaits, swim, jump take-off,
  death, four emotes and the white swings), and per armor set and fit a low file, a medium
  file and a TOP file (`woc_armor_core.ts`: file names, the tier a character
  draws, the stand-in tier, the idle rule and its ledger; pure). Since 2026-10-03 the
  medium file carries every map of the set's one full layout at half its size and
  the top file only the top mip level of each (three quarters of a texture's
  bytes, which only a close-up samples): the HIGH tier is the medium file with
  the top levels laid over it, assembled in the store (`woc_armor_top_levels.ts`,
  textures paired by image name; the top file's url names the pack). Who draws
  what is a per-character DETAIL: the low preset and every phone draw low for
  everyone, and otherwise the local player's own character and a body built
  directly (by default: a preview goes by what its stage shows, below) draw
  high while every other character in the
  world draws medium (`createCharacterVisual`'s `localPlayer`; cosmetic
  sharpness only). A high pack holds its medium pack resident and frees only
  what it made; the medium file stands in while the top streams, and a file that
  replaces another keeps the old one drawing until its reveal settles
  (`woc_armor_dressing.ts`), so the upgrade never blinks
  (`tests/woc_armor_high_pack.test.ts`, `tests/woc_armor_dressing.test.ts`).
  A PREVIEW is the one body built directly that does not simply take the
  default (`preview_armor_detail_core.ts`, 2026-10-05): the viewer's own
  character (the sheet, the roster's pick, a redesign draft) draws high as
  before, someone else's (the Inspect stage) draws the crowd's detail and never
  fetches a top file, and a class in the creator draws the crowd's detail until
  the player CHOOSES it, then high for that one class and body. Chosen is an act
  on the appearance editor for the body on the stage (opening a face category or
  changing the look; `src/ui/appearance_editor_mount.ts` sends it as
  `CharacterPreview.markChosen`), never a class or body pick, which only puts
  another body up; it lasts one visit to the creator. The step up or down
  happens on the LIVE body (`CharacterVisual.setWocArmorDetail`,
  `WocArmorDressing.setDetail`: the same stand-in rule, so no rebuild and no
  blink) and takes effect with the body's next dressing, else its next frame: a
  stage that changes hands dresses its body right after, so the new detail is
  asked for the sets it shows now, never for the ones the body wore. Flipping
  away lets the top file go with its body (one still on its way is not stopped:
  it lands with nobody holding it, the store's to free). The creator in
  `src/main.ts` stages through `CharacterPreview.setCreationClass`; a host that
  shows someone else's character says so through `setArmorSurface` (the HUD:
  `src/ui/preview_subject.ts`, by the stage's framing). Tests:
  `tests/preview_armor_detail_core.test.ts`, `tests/preview_armor_detail.test.ts`
  (the real preview over every class and body),
  `tests/woc_armor_detail_change.test.ts`,
  `tests/woc_preview_detail_visual.test.ts`,
  `tests/preview_armor_detail_wiring.test.ts` (the two hosts' call sites).
  A WOC def is `lazyPreload`: its base and animation library are out of the
  BOOT gate (the weapons it holds stay in it, `manifestUrls`), so the launcher
  fetches a fit only when a preview shows it (`visualAssetsResident` plus
  `onCharacterAssetReady`; a fetch that failed is asked for again after its
  cooldown by the store itself, so a host that asked once is not left waiting,
  `tests/character_asset_retry.test.ts`). The WORLD never waits on one:
  `woc_entry_preload.ts` loads both fits' base and animation library and both
  head cores in the deferred preload lane, awaited before the Renderer exists
  (the set is the pure `woc_entry_core.ts`), and nothing else: the rest of the
  crowd set (every hairstyle and facial hair file, the armor sets at the
  crowd's tier, the under-armor atlases) is prefetched as background work
  right after the first painted frame, on an unconstrained profile only
  (`woc_crowd_prefetch_core.ts` the plan, `woc_crowd_prefetch.ts` the runner;
  `tests/woc_crowd_prefetch.test.ts`). A world view whose base is missing anyway
  is a miss like any other body's (the logged fail-soft path and the
  view-create retry cooldown), never a silent wait. `woc_entry_prepare.ts`
  then runs under the curtain, ahead of the prewarm's budget: the local
  player's own hair and beard get a bounded chance to settle, and both fits'
  class keys are prepared, so the first player of the other body type is never
  measured and baked inside a live frame. A speculative build (the zone
  prewarm) passes `fetchStreamed: false` so it never pulls a set nobody wears.
  The model as a whole: `src/render/CLAUDE.md` "Asset loading"
  (`tests/woc_entry_preload.test.ts`, `tests/woc_entry_prepare.test.ts`).
  `woc_armor_bind.ts` rebakes a set's parts into the base rig's bind space by
  bone NAME (skinned parts onto the shared Skeleton, rigid parts re-hung on the
  same-named bone; loader-free, the Guide viewer uses it too);
  `woc_armor_packs.ts` is the store (fetch, residency refs, and the prepare as
  ONE unit of the renderer's work queue per pack, label kind
  `woc-armor-prepare`, asked for when the file lands: `setWocArmorWorkQueue`,
  with `prefetchWocArmorPack` as the entry for a set fetched ahead of need,
  whose prepare rides the background lane). How long a pack nobody draws stays
  is `wocArmorIdleEvictMs`, off the static profile: the tier a crowd draws
  stays for the session on a desktop, a high pack's top levels go after
  seconds, the phone-class profile frees everything soon.
  `woc_armor_dressing.ts` is one character's attached files (the visual owns
  the per-mesh setup through its host seam, like a late face decal): a body
  with the work queue behind it attaches a file as one unit of it (label kind
  `woc-armor-attach`, only once the pack is prepared), never inside its frame,
  the suit standing in meanwhile; a body built directly attaches on the spot.
  A build is born wearing what is resident, with one exception: a crowd
  character built in a live frame is born in its suit while its file still
  waits on its prepare unit (only a view under an arrival cover, a speculative
  build and a full-detail body pay a prepare where they stand). A replacement
  the gate cannot prepare is refused (its stand-in is the same armor), never
  taken over unproven (`tests/woc_armor_packs.test.ts`,
  `tests/woc_armor_attach_visual.test.ts`).
  `woc_armor_catalog.ts` + `woc_item_display.ts` are the display
  table (an item shows its row's set piece, else the wearer's class piece).
  Built by `scripts/assets/woc_character/build_woc_split.mjs` (with
  `armor_atlas.mjs`: one texture atlas per map kind per set, and `ktx2_levels.mjs`:
  each full-layout map cut along its top level, `tests/woc_ktx2_levels.test.ts`);
  what ships is ratcheted against literals: bytes by `tests/woc_character_size_budget.test.ts`
  (the under-armor atlases included), every texture's size, mip chain and codec by
  `tests/woc_texture_budget.test.ts` (an under-armor atlas has no build knob: it is
  the artist's 1024 master scaled to 512 and encoded by
  `scripts/assets/compress_standalone_textures.mjs`, so that pin is what holds its
  size), triangles per level of detail by
  `tests/woc_triangle_budget.test.ts`, and the glTF extensions in use by
  `tests/woc_material_extensions.test.ts` (a material extension can switch the material
  class every wearer compiles: the armor files' `KHR_materials_specular` makes those
  materials physical on Medium and above). Every base, low and medium
  armor file and head file carries level-of-detail index lists per primitive, a mid and a far
  one over the primitive's own vertices, in the optional `WOC_lod` extension (the file
  contract is the header of `scripts/assets/woc_character/woc_lod_extension.mjs`; made by
  `lod_indices.mjs` against measured deviation bounds; `tests/woc_lod_indices.test.ts`,
  `tests/woc_lod_extension.test.ts`, which also holds the shipped files to the contract).
  A base file is the rig and the
  BODY only: it ends at the neck, and the handoff's original face never ships
  (the build measures it, records its crown and strips it). The height
  normalization takes that crown as the body's top (`WOC_ANATOMY_TOP` in
  `woc_armor_core.ts`, pinned to the build's record by
  `tests/woc_export.test.ts`), so no hairstyle or helm can change a character's
  size. Blade-contact timing for the
  hit presentation: `attack_swing_core.ts` (`ClipMap.contacts`, measured off
  the shipped library by `tests/woc_character.test.ts`). A WOC body's white swings
  instead play the hand-keyed set (`woc_autoattack_core.ts`, pure): `playAttack` asks it
  after the held-shot tail and skin checks and before the hand clip, and it times each
  swing by `woc_autoattack_contacts.json` (written by the keyed build's validator,
  pinned by `tests/woc_autoattacks.test.ts`). The renderer holds the
  target-side effects until that contact (`../contact_queue.ts`), a kill's
  collapse included, and the mount under a seated rider and a paladin's wings
  read the same hold, so they go on the frame the blade lands (`collapsed`,
  `heldUntilCollapse`: the sim clears both on the death tick, so a held body
  shows what it showed the frame before; `tests/contact_queue.test.ts`,
  `tests/melee_contact_wiring.test.ts`). Nothing else waits: a form, a cast
  pose and the other aura-driven looks still end on the event, and nothing a
  player acts on is held.
- WOC modular heads (the face builder's library, `woc_head_catalog.ts`): it
  ships SPLIT, one core file per head type (the base head and every small face
  piece), one file per hairstyle, the beard files (`wocHeadCoreUrl`,
  `wocHeadPieceUrl`, `wocHeadLookUrls`). `woc_head_packs.ts` is the per-file
  store (fetch once, prepare once, never freed; world entry awaits both cores,
  the crowd prefetch fetches every other file after first paint on a profile
  with the memory for it, and elsewhere a file rides its first look or
  `prefetchWocHeadSlot`, the face builder's category) and the hang. A body
  carries only the PIECES its look draws
  (`woc_head_stream_core.ts` `wocHeadLookPieces`), one wrapper per hang
  on the `head` bone, never the rest of the library: `assembleModel` hangs the
  pieces of the look a body is born with (`AssembleOptions.wocHead`, which the
  world view names; a throwaway gets none, and a far bake hangs its own part
  set through `applyWocHeadBakeVisibility`), and what is not drawn is out of
  the scene graph, so it costs no matrix update, no material pass and no tint
  clone (`tests/woc_head_hang_budget.test.ts` counts it on the shipped files
  and holds the ceiling). `woc_head_dressing.ts` is one visual's head: it hangs
  a piece the look starts to draw (behind the host's gate on a body already
  drawn) and takes off one it no longer draws, its tint clone with it; a
  hairstyle a worn helm hides stays hung. The streaming rules live in the pure
  `woc_head_stream_core.ts`, in two modes. WHOLE LOOK, the default (a preview,
  a portrait, the face builder): a head goes live only once EVERY piece of its
  look is hung and revealed, and until then the body draws nothing (`visual.ts`
  through `far_lod_reveal_core.ts` `bodyDrawn`); only a FAILED head file ends
  that wait, so a dead request never hides a character. BARE STAND-IN, the
  world view's opt-in (`createCharacterVisual` calls `setWocBareHeadStandIn`,
  the way it calls `setWocDrawMerge`): a body in the world NEVER waits on a
  hairstyle or a beard file, or on any head file at all. World entry awaits
  both head cores (`woc_entry_preload.ts`), so a core is resident when a body
  is built; a body that meets a missing core all the same (its fetch failed)
  is built and drawn without a head, which goes live bare when a retry lands
  (`tests/woc_head_world.test.ts`). Its head goes live on the core alone
  (`wocHeadLiveLook`), drawing whichever of its hairstyle and beard are
  resident too; one still on the wire, or one whose fetch failed, joins later
  through the same
  hidden-until-linked reveal a later pick uses (the bare head is its stand-in,
  named in `ENTITY_GATE_STAND_INS`), and a failed file is asked for again
  after the store's cooldown without ever hiding, beheading or delaying the
  body. A late hang is one unit of the host's work queue (`woc-head-hang`,
  the seam the merged mount rides), so a crowd that waited for one file never
  hangs it in a single frame. While a piece is on its way, or the head is not
  live yet, nothing that freezes the drawn head is built: no merged stand-in,
  and no far bake (`WocHeadDressing.joining`, read by `visual.ts`
  `attemptComposedFar`), so a hairstyle landing late costs neither twice. In both modes a later pick of
  ANY piece keeps the previous one drawn until the new one reveals
  (`wocHeadDrawnLook`); a DIFFERENT character handed to a reused body (a roster
  pick, an inspected player: `WocHeadHold` 'look', passed by the preview) keeps
  the previous head whole instead. Never live in the dressing's constructor:
  its host hands it the look right after building. Tests:
  `tests/woc_head_stream_core.test.ts`, `tests/woc_head_packs.test.ts`,
  `tests/woc_head_dressing.test.ts`, and through the real factory and visual
  `tests/woc_head_world.test.ts`.
- WOC look colours (skin, eye, hair, brow): one shader layer per role over each
  head material and the body's own (`woc_head_tint.ts`; a colour is a uniform
  write, never a link), wrapped per visual by `woc_head_dressing.ts` and per far
  set by `woc_far_tint.ts`. Which mesh takes which tint, and how strongly, is
  the pure `woc_skin_tint_core.ts`: skin colour changes ONLY skin. The body mesh
  is cloth: its own suit atlas tints only its skin paint (the hands, the neck
  base) through the suit key, and under a class under-armor atlas (no skin on
  it) the body's layer is switched off by its strength uniform on the SAME
  program, so an atlas swap links nothing. The swap itself (`woc_atlas_swap.ts`)
  stages hidden twins of the body's meshes on the new atlas, wearing that same
  layer (`WocHeadDressing.wrapTwins`: the very materials the body mounts after
  it), behind the visual's compile gate; a settle only records the gate's
  answer and the visual's per-frame path takes the swap (`update`, or
  `advanceOffscreen` for a body out of view), and one the gate could not vouch
  for keeps the current atlas and asks again, a bounded number of times,
  before it is taken all the same (the atlas standing in is the wrong cloth). The near rig,
  the far LOD and the wiki viewer all resolve through that one rule
  (`tests/woc_skin_tint_core.test.ts`, `tests/woc_far_equipment.test.ts`).
  What the skin and eye transfers read of a UNIFORM colour through HSV (a
  material's reference: its hue for the skin band, its saturation for the iris
  test; the look's eye colour: hue, saturation and value) is worked out on the
  CPU when the uniform is written, never per fragment: the shader converts the
  texel alone, and reads those colours linearly as it always did
  (`woc_tint_hsv_core.ts`, a mirror of the layer's own GLSL helpers;
  `tests/woc_tint_hsv_core.test.ts` runs the shipped shader text against it, so
  neither side changes alone).
  Hair and brow read a texel's LINEAR luminance alone (times its colour's), never
  its hue, on the albedo and, where the emissive map is the colour map (the low
  tier), on the glow too; that is why the hair, scalp and beard textures ship
  grey, ETC1S (`scripts/assets/woc_character/hair_grey.mjs`, run by
  `woc_head_pack_compress.mjs`; pinned by `tests/woc_head_tint.test.ts`,
  `tests/woc_hair_grey.test.ts`, `tests/woc_head_split_files.test.ts`). A new
  hair-role texture that must keep its colour cannot ride a `hair_` material.
- WOC crowd draws (2026-10-02; a full-kit body drew 21 meshes a pass piece by
  piece. What the fold saves, measured against itself on one GPU, and how a folded
  body compares with the composed body a release player draws, are on the crowd
  page of the character pack's screenshots, `characters-20260923/crowd/README.md`):
  the WORLD view folds a body's many pieces into few draws, while a preview, a
  portrait and the face builder keep drawing piece by piece
  (`createCharacterVisual` opts in through `setWocDrawMerge`; `?wocmerge=off`
  is the A/B arm). The pieces stay the source of truth everywhere: they are
  shown, posed and tinted exactly as before, a stand-in is built for what is
  drawn right now, and the pieces leave the render lists (`layers.mask = 0`)
  only once the stand-in can draw without linking. The gate's settle hands that
  proof; on a host without parallel shader compile it hands none
  (`../compile_target_readiness.ts` `compileProof`) and the settle alone
  reveals: every program there links at its first draw, so a proof would read
  false for good and the stand-in would refuse itself forever. Whatever changes
  what is drawn drops the stand-in inside the same pass, the pieces draw again
  that frame, and the new stand-in is built later on the renderer's work queue
  (the queue rides in with the compile gate, `setFarBakeGate`), the armor as
  ONE unit, a head as a chain of them (below), only for a rig that is actually
  drawn behind that gate (`rigDrawn`: never a far or hidden body, nor one the
  renderer never gated, a prewarm or speculative build whose stand-in nothing
  would prove), so a crowd arriving at once mounts a few a frame. Never mount
  inside `apply` or a part pass: both run within the host's own material
  sweeps. A translucent effect (the ghost run, stealth, Shadowform, the Soul
  Rend mark) keeps the pieces for as long as it lasts: one merged mesh cannot
  blend what three sorts piece by piece.
  - The head (`woc_head_merge.ts`, pure `woc_head_merge_core.ts`: the fold rule,
    the slot table, the cache identity): one mesh on the head bone with the
    face morphs baked, each vertex carrying the SLOT of its material; one
    material, the base head's, wrapped with the merged tint layer
    (`woc_head_tint.ts`) whose per-slot uniform rows carry what differed per
    piece (tint role and reference, colour, emissive, roughness, metalness,
    one sidedness, and which of four textures it samples: the core atlas, the
    hairstyle, its scalp cap, the beard). What makes it possible is the build:
    `scripts/assets/woc_character/head_atlas.mjs` packs every texture of a
    head core into one atlas. Left out on purpose, each still its own draw: a
    piece whose material takes a surface layer by name (the gold of a
    piercing: `riggedWornFamilyFor`) and anything not a plain opaque standard
    material. The merged layer does the work of the map, emissive map,
    roughness and metalness chunks itself but leaves every one of their
    includes in place (switched off, or fed the slot's value), because a layer
    attached after it anchors on them: the hit response
    (`surface_response.ts`) must still reach a merged head. Every merged head
    of one tier material and sidedness variant draws with ONE program, so only
    the first takes the compile gate; a later one stands at once, but only on
    that gate's own readiness proof, asked again each time
    (`woc_head_merge_proof_core.ts`: a witness, never a remembered "linked"
    bit, which would outlive a released program or a restored context; a body
    lets go of its witness when it is disposed). The fold of a head
    nobody built yet walks every vertex through its morphs, far too much for
    one frame slot, so it is a chain of queue units, a band each: a fixed count
    of vertices, then of index entries, the last one closing the geometry
    (`woc_head_merge_fold.ts` `WocHeadGeometryFold`, the bands and the unit
    count in the core: `WOC_HEAD_MERGE_BAND_VERTICES`, `wocHeadMergeFoldUnits`),
    the way a composed look's maps are (`look_pieces.ts`). The fold is a
    function of its cache key alone (its inputs are snapshotted when it
    starts), so every body in one face drives the SAME fold
    (`WocHeadMergeRig.foldPending`) and any body's unit can fold a band of any
    head: it folds the one that has waited longest, so a crowd's heads finish,
    and stand in, one after another instead of all at the end (a head half
    folded saves nobody a draw). A unit is one kind of work under its own
    label, so the budget learns a band and a mount apart: `woc-head-merge`
    folds a band and nothing else, and a head that is whole (a new one's own,
    or one somebody built) is mounted by a `woc-head-mount` unit
    (`WocHeadDressing.requestMount`; a body with no queue behind it mounts
    whole on the spot instead). A head whole but not yet mounted by the bodies
    that folded it is waited for, never idle: the geometry cache's idle cap
    leaves it alone, or a crowd of new faces would drop heads faster than their
    mount units come round and fold them for ever. A fold its last driver lets
    go of (the face changed, the body went far, was hidden, lost its gate or
    was disposed) is dropped where it stood, never mounted and never cached,
    and the next ask starts over. The merged layer's slot tables are a large
    spend of fragment uniform vectors, which a driver may cap at the WebGL2
    minimum: the program's count is pinned under it, with headroom, by
    `tests/woc_head_uniform_budget.test.ts` (the declarations, by name, at the
    engine's light budget) and, on a real context, by
    `tests/browser/woc_merged_head_uniforms.browser.test.ts` (the linked
    program's active uniforms). A wider table, a new per-slot row or an effect
    layer that adds uniforms to a head that stays merged is held to those two
    pins.
  - The far LOD (`woc_far_head.ts`, `woc_far_tint.ts`): the same fold rule
    (`wocHeadMergeFold`) bakes every folded head piece into ONE group of the
    far mesh, drawn by the same merged layer; a far body is its body, its
    head, its armor groups.
  - The armor (`woc_armor_merge.ts`, pure `woc_armor_merge_core.ts`): the worn
    parts of one file material become one skinned mesh on the body's own
    skeleton (a rigid part rides as vertices weighted to its bone).
  Tests: `tests/woc_head_merge_core.test.ts`, `tests/woc_head_merge.test.ts`,
  `tests/woc_head_merge_proof_core.test.ts`,
  `tests/woc_head_merged_tint.test.ts`, `tests/woc_head_dressing.test.ts`,
  `tests/woc_head_merge_library.test.ts` (the shipped head library against the
  fold rule, and through the banded fold against the whole one),
  `tests/woc_head_atlas.test.ts`, `tests/woc_far_head.test.ts`,
  `tests/woc_far_tint.test.ts`, `tests/woc_armor_merge_core.test.ts`,
  `tests/woc_armor_merge.test.ts`, and through a real `CharacterVisual`
  (`tests/helpers/woc_visual_harness.ts`): `tests/woc_merge_visual.test.ts`
  (the queue wiring, effects, the reveal rules, a host without parallel
  compile, an ungated body, a seeded lifecycle fuzz),
  `tests/woc_head_fold_visual.test.ts` (the fold's chain on the queue: its
  bands, bodies sharing one, every way out mid-chain, a seeded fuzz),
  `tests/woc_head_merge_visual.test.ts`, `tests/woc_armor_merge_visual.test.ts`.
- WOC geometry levels (2026-10-03): the WOC files (bases, armor low and medium,
  head cores, hairstyles, beards) carry coarser index lists per primitive, MID
  and FAR (`WOC_lod`, read by `../assets/woc_lod_plugin.ts`), over the
  primitive's own vertices. Which one a character draws is the pure
  `woc_lod_core.ts` (`wocLodLevelFor`: crowd detail mid, full detail level 0,
  the low preset and phones mid for everyone; the far bake always far), fixed
  when the visual is built (`assets.ts` `wocBuildLod`, handed to both
  dressings). A level is drawn by a VARIANT geometry (`../assets/geometry_lod.ts`
  `geometryLodVariant`): the source's own attribute objects and another index,
  one per (source, level), shared by every wearer. Its `dispose()` does nothing:
  it goes with its source's (three deletes every attribute buffer a disposed
  geometry holds), pinned by `tests/geometry_lod.test.ts`. Levels live in a
  WeakMap, never `userData`, and reach a derived geometry only where the
  transform says the vertex order held (`carryGeometryLod`: the rebake, the
  palette narrowing) or offsets them as it offsets its own index
  (`mergeGeometryLod`: the part merge, the merged armor, the merged head). A
  merge folds each piece's SOURCE geometry and keys its cache on it, so every
  detail shares one merged buffer and draws its own level of it. Tests:
  `tests/geometry_lod_core.test.ts`, `tests/woc_lod_core.test.ts`,
  `tests/woc_lod_plugin.test.ts`, `tests/woc_lod_flows.test.ts`,
  `tests/woc_lod_visual.test.ts` (the harness's `lods` fixture).
  A preview keeps the full-detail level whatever ARMOR detail its stage draws
  (`preview_armor_detail_core.ts` `previewArmorBuildOptions`: the levels ride
  the same files, so the coarser one would save no download;
  `tests/woc_preview_detail_visual.test.ts`).
- WOC far LOD off the frame (2026-10-05): a WOC body's far mesh is ONE BAKE PER
  LOOK (the worn parts, the armor files they are drawn from, the face), and
  nothing bakes it but the body's own far crossing: never the constructor (a
  WOC key bakes no far mesh in `prepareVisual`, and a body is born with none),
  never the shadow plan (`setProxyShadow` is a flag and a visibility write).
  - Units, never a frame's work. For a body with a compile gate and the work
    queue that rode in with it (`setFarBakeGate`), `woc_far_bake.ts`
    `queueWocFarBake` cuts the bake into queue units: the throwaway model, its
    idle pose and its cut down to the far level's vertices
    (`far_bake_compact.ts` `compactDrawnVertices`), then the head's morphs and
    the skinning a band of `WOC_FAR_BAKE_BAND` vertices at a time
    (`woc_far_head.ts` `WocHeadBakePose`, `static_pose_bake.ts`
    `StaticPoseBaker`; a spent band does nothing), then the merge with the
    head's slots. Each body then mounts the bake as a unit of its own
    (`CharacterVisual.mountWocFar`: far materials, far mesh, compile gate). The
    label kinds are `woc-far-assemble`, `woc-far-skin`, `woc-far-fold` and
    `woc-far-mount`, with spans in the CPU build ledger (`view:woc-far-bake`,
    `view:woc-far-mount`). The queue paces them, so `takeFarBakeBudget` applies
    only to composed bodies and to a WOC body with no gate (a direct build, a
    preview, a test), which runs the SAME steps back to back under one span.
  - One bake at a time per queue, one bake per look however many bodies ask.
    A second look waits in line as a record (no throwaway model until its
    turn), so a crowd crossing the band is never a crowd of throwaways, and each
    body mounts as its own look ends. A bake nobody waits for any more never
    starts, or stops before its next unit.
  - The ask holds the bake. A finished bake is held live in the cache for the
    bodies that asked until each has mounted it or let go
    (`WocFarBakeRequest.release`): an idle bake is the first thing the next
    finished one trims. Every way out of an ask releases it (the mount, a
    re-dress, a new gate, a dispose, a body the pool parks
    (`CharacterVisual.parked`, called by `PooledVisualLifecycle.store`), a
    refused or failed unit), and the mount unit only ever retains: it never
    bakes. An ask that comes to nothing latches until the body is dressed again
    or handed another gate. A pooled body handed its gate alone finds the queue
    by that gate when it first needs one (`rendererWorkQueue`).
  - What draws meanwhile. The rig draws until the mounted mesh has linked
    (`farMeshShown`). It is a stopgap for those frames, so no merged stand-in is
    built for it (`farLodArriving`, read by the head and armor dressings through
    `rigDrawn`): a crowd arriving far would pay a fold a body for a rig the far
    mesh replaces a moment later. A body that draws nothing yet (it still waits
    for its head) asks for no bake at all. A set still streaming does NOT hold
    the ask: the body draws its bare suit meanwhile and its far mesh is that
    look's, baked again when the file lands (the first bake stops between two
    units if the file lands first).
  - The far key is built once per dressing (`dressWoc`, the one place that
    assigns the far inputs) and handed to every later ask.
  - Shadows. In the proxy band a WOC body casts its key's STAND-IN until its own
    far bake can (`far_lod_reveal_core.ts` `shadowStandInShown`): the bare body
    mid-idle with an ellipsoid for the head its base file does not carry
    (`woc_shadow_stand_in.ts`, sized by the pure `woc_shadow_stand_in_core.ts`
    and held to the shipped heads by
    `tests/woc_shadow_stand_in_assets.test.ts`), baked once per key where the
    key's unused far mesh used to be, only on a tier that casts dynamic shadows,
    and mounted hidden at construction on the shared shadow-only material.
  - Materials. A far body's materials are per character only where its colours
    draw: the body's skin layer switched off (a body under its class under-armor
    atlas, `wocTintStrength` 0) is ONE wrapped clone per far source for every
    wearer (`woc_far_tint.ts` `sharedOffLayer`, freed with the source), so a
    crowd sorted by material binds it once; never write a character's colour or
    strength into it. Dev A/B arms price a far crowd's layers
    (`render_dev_flags.ts`): `?wocfarheadtint=off`, `?wocfarbodytint=off` and
    `?wocfarshare=off`.
  - Idle caps. A far bake, a merged head and a merged kit nobody draws any more
    are kept for a look that comes back, up to a cap per cache
    (`woc_idle_cache_core.ts` `wocIdleCacheCaps`, read at trim time from the
    STATIC memory class): generous on a roomy profile, a handful on a
    constrained one (every phone, every iOS host), where what a crowd leaves
    behind is the last thing worth holding. What draws is never trimmed. With
    the armor store's shorter idle window there (`wocArmorIdleEvictMs`), that
    is the bound on idle WOC state on a phone; the hairstyle and beard files
    stay resident once fetched (a fixed catalog, never a growing set, and
    never prefetched there). `tests/woc_idle_cache_core.test.ts`.
  - Tests: `tests/woc_far_queue.test.ts`, `tests/static_pose_bake.test.ts`,
    `tests/far_bake_compact.test.ts`, `tests/woc_far_head.test.ts`,
    `tests/woc_shadow_stand_in.test.ts`,
    `tests/woc_shadow_stand_in_assets.test.ts` (the shipped files),
    `tests/woc_far_tint_shared.test.ts`, `tests/woc_far_tint_flags.test.ts`,
    `tests/woc_far_equipment.test.ts`, `tests/woc_merge_visual.test.ts`.
- Pure selection cores: `modular.ts` (composed bodies, below),
  `player_look_core.ts`, `form_visual_selection_core.ts`,
  `far_lod_reveal_core.ts` (the rig/far-mesh/shadow-proxy handoff rule: the
  baked far mesh stands in only once it exists AND its materials linked
  behind the renderer's far-bake compile gate, and a WOC body's shadow stand-in
  casts for exactly as long as its baked proxy cannot; `visual.ts` is a thin
  consumer via `setFarBakeGate`, `tests/character_far_compile_gate.test.ts`). The far
  mesh mounts its OWN tinted clones (`tintedMaterial(..., mount: 'far')`):
  three's `compileAsync` polls a material's `currentProgram`, so a clone shared
  with the skinned rig would let the far bake's gate settle on the rig's
  variant (`tests/tinted_material.test.ts`).

## Keys & dispatch
Every drawable is a `VisualDef` in `VISUALS` (player classes, creature families,
humanoid mobs, NPCs, forms). Dispatch precedence in `visualKeyFor`: players to
`player_<class>` (or `player_mech` for the mech skin catalog); mobs to
`MOB_KEYS[templateId]`, then `FAMILY_KEYS[MOBS[id].family]` (the family ids
live in `manifest.ts`; a humanoid falls to the rogue's WOC body), except the
mobs that take their authored look first: the quest escortees, the Mirefen
muster's soldiers and every humanoid enemy (`MOB_LOOK_IDS`, the next
paragraph). No mob draws on a retired KayKit player rig (pinned in
`tests/npc_looks.test.ts`); NPCs to the WOC def of
their authored class and body type (`npcLookFor`, the next paragraph), and only
an NPC with no authored look to its stock rig in `NPC_KEYS`. Forms
(`form_sheep`/`form_bear`/`form_cat`/`form_travel`) are passed explicitly by the renderer;
`characterFormAssetKey` (`form_visual_selection_core.ts`) then splits the shared cat slot at
construction, so a shaman's `ghost_wolf` aura resolves to `form_ghost_wolf` (the tinted
`wolf_basic.glb`) while the druid's `form_cat` loads its own `druid_cat_form.glb`. It
splits the polymorph slot the same way: a polymorph whose aura id is in
`TOAD_POLYMORPH_AURAS` (the Wildheart Toad Hex) resolves to `form_toad`, and
`form_rig_sync.ts` disposes and rebuilds a polymorph rig left holding the other animal.

**Every world NPC is a WOC body** (`npc_looks.ts`, pure data): the body, kit and
clips of one player class, wearing a look the creator's face builder could have
made (a body type, one piece per head slot, a piercing preset, four colours, the
five face controls, a body size). Nothing about it is NPC-only art, so an NPC
draws through the path a player of that class does (the same prepared key,
programs, armor files, merged head and far bake). Unlike a player it is POOLED
(`visual_pool.ts`), and a parked body keeps its merged stand-ins and far bake
until the pool evicts it, so the pool cap bounds that memory rather than the
idle caps. Measured so far: draw calls and triangles in four hubs, on the high
tier and on the lowest preset (the table is on the change's screenshots page,
the `npcs` page beside the character pack's captures); frame times and a
physical phone are not. The three NPC-specific facts all live in
`createCharacterVisual`: the look is handed in at birth (`setWocHeadLook`,
`setBodyScale`: nothing diffs an NPC per frame, `live_look_diff.ts` dresses
players only); the kit is the class's default with the HEAD BARE
(`setWocDefaultEquipment(true)`: no helm or hood ever covers an NPC's face); and
its fixed props (`manifest.ts` `NPC_PROP_ATTACH`, picked by the look's `props`)
REPLACE the class def's own hands through the weapon-layout override
(`npcHeldProps`: an attach list with no swap slot, or the body would hold the
class's default weapons). A prop rides no def of its own, so `manifestUrls`
names every prop url for the boot gate; the one prop that is also an Armory
weapon-skin model (the brasscrown walking staff) streams on demand like every
skin, and the first NPC that holds it builds fail-soft once it lands. Nothing
else about an NPC is a new lane: the zone prewarm seeds the first NPC of each
class body into the pool (real residents, so they ask for their own files),
and a pooled body finds the renderer's work queue by its gate. Authoring rules
(the class is the kit the NPC wore before, colours are solved against the old
face, the eye controls carry character) are the header of `npc_looks.ts`;
`tests/npc_looks.test.ts` pins the roster and `tests/npc_woc_body.test.ts` the
body through the real factory.
The quest escortees wear a roster row too, although the sim makes them mobs so
the escort driver can walk them, and so do the Mirefen muster's soldiers and
the humanoid enemies (the outlaws, the cults, the knights, the drowned):
`MOB_LOOK_IDS` names them one by one, because one templateId can be an NPC and
a mob at once (Sexton Marrow), and that mob keeps its mob body. A body that is
no entity at all (a caravan's seated driver) asks for its row by id through
`createRosterLookVisual` (`index.ts`). A unit frame draws the same face the world does:
`npcPortraitSourceFor` (`manifest.ts`) hands `src/ui/nonplayer_portrait_core.ts`
the body key and the look's head, and the painter asks the live headshot lane
for it (`portrait.ts` `visualPortraitDataUrl`, the capture a player's frame
asks for, the crest while it runs), so no portrait file is committed for a
character with a look and a row edit changes its portrait with it. The
escortees keep their rows in the committed mob portrait ledger (every mob has
one), drawn by that pipeline from the class body; no frame shows those files.

## Animation
- `AnimState` (the renderer-derived input) and `BaseState`
  (`idle|walk|walkBack|run|strafeLeft|strafeRight|cast|spin|swim|sit|jump|prowlIdle|prowlWalk|...`) live in `anim_state.ts`, which
  also owns `desiredBaseState()` (pose selection) and `locomotionTimeScale()`
  (foot-speed matching). Clip *names* are per source rig in the `ClipMap`
  factories (`manifest.ts`); names differ per rig (e.g. KayKit `Walking_A`,
  Quaternius `Gallop`), `baseAction()` falls back gracefully.
- **Strafe:** a Q/E strafe keeps facing and slides the body at run speed. `locomotion.ts` reads
  the displayed travel against the displayed facing (|lateral| >= `STRAFE_LATERAL_MIN`, never a
  backpedal frame) and latches the side over `STRAFE_CONFIRM_SEC`, each frame counted at most the
  self-facing turn limiter's clamp (`facing_smooth.ts`), so a mouse-steer turn at any frame rate
  never flashes it. `desiredBaseState` plays `strafeLeft`/`strafeRight` only while running and only
  for a rig that loads BOTH clips; time-scaled by `strafeRef` (default `runRef`); the side runs
  blend in and out on a short 0.1 s crossfade (`isStrafeState`, `STRAFE_FADE`: owner call, the
  one-frame cut read as a snap and the 0.22 s base fade as sluggish). Pinned in
  `tests/locomotion.test.ts`, `tests/character_anim_state.test.ts`, `tests/character_strafe.test.ts`.
- **`src/render/renderer.ts` is the sole driver.** It builds `AnimState` each
  frame (swimming/sitting derived there, sim is unaware), calls `update(dt, s,
  animate)`, fires `playAttack()`/`playHit()` from sim events, and toggles live
  held items and effects. Don't drive visuals elsewhere.
- **Crowd scaling / LOD bands:** the policy (bands, cadences, exemptions) is
  `src/render/crowd_lod.ts`, documented in `src/render/CLAUDE.md`. The
  mixer-specific part lives here: in the animated far band the mixer
  integrates the skipped time via `pendingDt`, so the clip plays at its real
  speed, just at fewer pose updates, and `setFar` is where the rig swaps for
  the baked idle-pose mesh.
- **Clips are shared data, never per-rig copies.** A rig binds its own actions
  (a mixer binds per root) over clips every rig of that library shares: the
  GLB's own, the two halves a clip is cut into for a dual-wield or a
  hold-and-release cast (`clip_split.ts` `sharedClipSplit`, one pair per source
  clip and cut) and the twin a one-shot re-triggered mid-play crossfades
  through (`clip_twin.ts`, one per source clip: a mixer keeps one action per
  clip, and an action cannot crossfade into itself). Never mutate a clip
  (`tests/clip_split.test.ts`, `tests/clip_twin.test.ts`,
  `tests/woc_clip_sharing.test.ts`).
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

## The visual reuse pool (`visual_pool.ts` + `visual_pool_policy.ts` + `pooled_visual_lifecycle.ts`)
`renderer.ts` routes non-player character visuals through a bounded,
release-ordered (LRU) `CharacterVisualPool`: on despawn a poolable visual is
detached and STORED instead of disposed, and `store` evicts + disposes
least-recently-released entries past the `GFX.maxPooledCharacterVisuals` cap,
so visiting new populations cannot grow GPU memory monotonically
(`tests/character_visual_pool.test.ts`). The renderer's take/store halves
(transform reset, near LOD, un-ghost, per-instance re-tint, the far-bake
compile gate re-installed on re-acquire, and on the way in a parked visual
told so, which drops a far bake still queued for it) are
`PooledVisualLifecycle`, bound once to the pool and the live cap. Contract points:
- Players deliberately never pool (their visual key varies with cosmetics/mech
  state): `characterVisualPoolKey` returns null and those visuals are disposed
  directly as before.
- The key is TEMPLATE identity only. Per-instance `color`/`scale` stay OUT of
  the key (rift spawns re-grade both per instance, so a key carrying them can
  never match again and every despawn minted a dead retained entry: the C1
  memory ratchet); scale is applied at the view group and color at acquire
  time. NPC `skin` STAYS in the key: it picks a texture atlas at construction,
  and the skin set is small and static so keys stay bounded. An NPC's authored
  look needs no term: it is a pure function of the templateId, so a pooled body
  only ever returns to the NPC it was built for.

## Adding things (module-first: where NEW work lands, and its test)
- **New family/key:** a declarative `VisualDef` in `VISUALS` (existing `ClipMap`
  or a new factory if the rig's clip names differ), wired via
  `FAMILY_KEYS`/`MOB_KEYS` (a new NPC is NOT a new key: it is a row in
  `npc_looks.ts`, on the WOC body of its class). `manifestUrls()` auto-preloads `url` +
  `attach[].url` + `animUrls` (skipping `lazyPreload` defs), so drop the GLB
  under `public/models/...` and run the media-manifest build.
- **New animation state:** add the field to `AnimState`, extend `BaseState` +
  `desiredBaseState()` (`anim_state.ts`), `baseAction()`, and `ClipMap`/`clipNamesOf()`
  (`clip_names.ts`, the one list a visual binds actions from),
  then have the renderer set the new flag. New pose LOGIC goes in the pure
  `anim_state.ts` half a Vitest imports directly, never inline in `visual.ts`.
- **Tests:** `tests/visual_manifest.test.ts` pins the `VISUALS`/clip contract,
  `tests/character_clipmaps.test.ts` gates every ClipMap name against the clips
  actually in the shipped GLB (both graphics tiers), `tests/character_anim_state.test.ts`
  the pure pose/watchdog math, `tests/character_tpose_repair.test.ts` the live
  mixer weights across death, respawn and repeated swings,
  `tests/rig_merge.test.ts` the merge math. Reproduce a bug in the matching
  test first (workflow: root CLAUDE.md + the `extract-and-test` skill).

## Modular bodies (`player_warrior_modular`)
Dormant in the shipped world: every class is a WOC body (`woc_parts_core.ts`
`classBodyComposes`) and so is every NPC (`npc_looks.ts`), so nothing a player
can reach composes from this library, and every `_modular` def (the warrior's
included) is `lazyPreload`: the library is fetched if a build ever asks (the dev
outfit audit rig). The section below is how it works when something does.

A `VisualDef` with `modular: true` points at a PART LIBRARY, not a finished
character: `models/chars/modular/warrior_modular.glb` carries both base bodies,
their underclothing, every hair/brow, and every class kit (`ARMOR_SETS`) cut
into equip slots, all on the one shared `Rig_Medium`, which is why no
cross-file skeleton matching is ever needed.
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
  `modularGeometryKey`, only the signature. `mergeSkinnedParts` MERGES
  morph-carrying parts (the nine skin parts are one draw), padding every part to
  the union of their target NAMES (`morph_union_core.ts`), so `applyMorphs`
  keeps driving by name and a slider that reaches only the torso moves only the
  torso's vertices inside the merged buffer.
- What a merge is NOT allowed to cross is a node-NAME fact, because the merged
  mesh has one name of its own: the head, the mouth's lips, the jewellery and
  the hair band. `modular_name_facts_core.ts` owns those four predicates for
  BOTH readers (the recolour sweep and the merge's partition key), so they
  cannot drift; the head is its own partition and never merges at all.
- The MOUTH is a part (`M_Mouth_<style>` / `F_Mouth_<style>`), not a morph:
  lips stand PROUD of the skin, and open styles are a different MESH (aperture,
  dark cavity, own teeth), not a deformation of a closed one. The head keeps
  its dead `mouth_*` morph targets on purpose: nothing drives them, but
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
- Eyes, ears, lashes and teeth are their own parts, not islands inside the head:
  that is what lets eyes and ears be swapped and scaled at all. They are body
  parts no armour slot hides. Brows/eyes/lashes/stubble are PROJECTED onto the
  head surface at authoring time, so they cannot float off it.
- Every projected face part is per-gender (`M_Eye_almond`, `F_Brow_soft`, ...):
  the two heads are separate sculpts, not one scaled copy, and a patch built
  against the male head lands INSIDE the female one. Shipping a single set left
  every female character with no eyes at all.
- ...and every one of them carries the HEAD's own shape-key names (`cheeks_up`,
  `jaw_dn`, ...) alongside its own. Projection glues a part to the face at BUILD
  time only; the cheeks slider then moves the head surface under it.
  `applyMorphs` drives targets by name, so a part that ships `cheeks_up`
  follows the head for free. No-op keys are dropped at authoring time, so what
  a part carries says which sliders actually reach it.
- The eyelash is rebuilt per eye shape so it always leaves the corner that eye
  actually has. It rides `mod_hair` and so has no colour of its own (a lash is
  hair). `lashes` is a plain on/off in the appearance, defaulting ON so a look
  saved before it existed does not read as "shaved".
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
- **Every player composes.** The look rides the `app` identity wire field (the
  `characters.appearance` DB column, stamped at join; untrusted, so consumers
  always run it through `normalizeAppearance` before composing), so
  `setModularLookProvider` claims every player entity and composes peers from
  server truth; a character with no authored look still keeps the fixed
  `player_<class>` rig. Three consequences the code used to assume away:
  - The parts a merge cannot fold (head, eyes, lashes, the mouth's own
    materials, the jewellery) are a per-CROWD draw cost, not a one-character
    one. The far LOD is what bounds it, and the band pulls in as the crowd grows
    (`crowd_lod.ts`).
  - `prepareVisual`'s far bake measures `DEFAULT_LOOK`, so it is wrong for a
    composed body. Composed bodies bake their own (`modularFarBake`), keyed by
    part set and minted on the first crossing into the far band; the colours are
    resolved per character from their own materials. Face/body sliders are not
    in that silhouette, deliberately. The bake merges atlas-mapped kit pieces
    with colour-only face parts that ship NO uv: `far_bake_uv_pad.ts` gives those
    an inert zero uv so the merge keeps the kit's real uv (dropping uv from every
    part instead made the frozen mesh sample one atlas texel, a flat untextured
    body at distance; `tests/far_bake_uv_pad.test.ts`).
    The bake hands back geometry GROUPS and each character resolves group N
    against its own captured `userData.farMaterials[N]`, so the two walks have to
    be one list: both go through `composedFarMeshes`, which drops held props for
    the reason the key gives (a part set says nothing about what anyone is
    holding, and a prop lands mid-traversal, between the unmerged parts and the
    merged body). The fixed-rig bake keeps its props: it reads its materials back
    out of the same walk, so it is self-consistent whatever it collects.
  - `modularVariantCache` is keyed by LOOK, so what mints entries is now the
    population of a zone. It is refcounted (retained in `assembleModular`,
    released in `CharacterVisual.dispose`) and evicts idle entries over a cap;
    an entry a live character is drawn from is never dropped, because clones
    share its geometry.
- Part names are the contract; `tests/modular_character.test.ts` gates the tables
  against the shipped GLB, because a renamed node fails SILENTLY (the body just
  loses a limb). The body's radius tables are SOLVED against the armour at
  authoring time, and each set is fitted to the frozen body: never hand-tune
  them.

## Stubble as a decal (`stubble.ts`)
Growth too short to have a silhouette is a mask, not a mesh. The decal is the
head's own surface, trimmed, subdivided, lifted 0.4% of head height, and
painted with a generated RGBA map: nothing is added to the GLB and nothing is
authored (frame, unwrap, mask, and stipple all derive from the head geometry at
runtime, cached per (head, styles)), so switching the styles off adds NO object
at all. Invariants:
- The head frame is the head's own BOUNDING BOX mapped to the unit sphere:
  every primitive in the GLB is meshopt-quantized into its own integer range
  (see `rig_merge.ts`), so the two heads do not even share a coordinate
  system; normalizing by the box makes one set of angles describe both.
- The unwrap is AZIMUTHAL EQUIDISTANT about the head centre, continuous and
  injective everywhere but straight down (which `TRIM_THETA` removes). The
  obvious lat-long unwrap has a seam down the back of the head and a
  degenerate crown, and BOTH are inside a buzz cut's footprint.
- The footprint landmarks are measured off the head's own morph targets
  (`mouth_*` moves exactly the lip ring, `nose_up` exactly the nose); the
  tests assert against those targets rather than against the constants.
- Nose-underside removal uses the specific `isNoseUnderside` test, applied
  after subdividing so its edge is fine. The general form ("is anything closer
  to the head centre along this ray") is the WRONG shape of test: it carved a
  rectangle out of the skin under the lower lip.
- RGB is written in EVERY texel, alpha only where there is growth: three
  multiplies the whole texel into the fragment, so a transparent texel left at
  black bleeds through bilinear filtering and rings every dot with a dark halo.
- A plain `map` and not a shader ON PURPOSE: `tintedMaterial` rebuilds every
  character material as Lambert on the low graphics tier, so an injected shader
  (the `addRimGlow` hook) silently vanishes there. That path also carries
  `depthWrite` / `polygonOffset` across: they are blend state, not shading.

## Gotchas / never
- KayKit GLBs ship **every** accessory visible: `VisualDef.show` is an allowlist
  of non-skinned node names to KEEP; omit it for creatures (keeps everything).
- Bone names are sanitized by GLTFLoader (`handslot.r` to `handslotr`); `attach`
  resolution tries both. A missing bone ships the model without the prop.
- Geometries are **shared per-asset caches and never disposed**. Shared tinted
  materials are claim-counted (`tinted_material_cache_core.ts`): `dispose()`
  releases this clone's mixer + Skeletons + its tinted-material claims, and the
  bounded cache disposes a clone only once no visual mounts it. On despawn a
  visual MUST be released into the reuse pool (which disposes on eviction) or
  disposed directly: online interest churn strands GPU bone textures and pins
  tinted materials otherwise.
- Never `Math.random` in *sim*, but here it's fine, this is presentation
  (bob phase, hit-clip pick). Never reach past `IWorld` into a concrete world.
