<!-- src/render/ability_vfx/: the per-ability spell VFX subsystem. Root +
     src/render CLAUDE.md apply; this file is directory-local only. -->

# src/render/ability_vfx/: per-ability spell VFX

Gives every ability the Ability VFX Gallery's authored visual identity. Three
layers behind the `index.ts` barrel:

- **Spec data resolves through `../ability_vfx_registry.ts`**
  (`abilityVfxSpec`/`abilityVfxFullSpec`): it layers the class-owned bespoke
  spec modules (`../warlock_vfx_specs.ts`, `../warlock_pet_vfx_specs.ts`,
  `../destruction_vfx_specs.ts`, `../necromancy_vfx_specs.ts`) over the
  generated gallery tables, `../ability_vfx_specs.ts` (compact planning
  projection) and `../ability_vfx_full_specs.ts` (the COMPLETE per-ability
  spec: archetype, palette, windup style, motifs, impact/bolt/strike/nova/
  beam/dot/cc/shout/burst blocks, buff orbit DNA, barrier, linger). A NEW
  bespoke ability spec MUST register in the registry; the generated tables
  stay untouched. Types live in `../ability_vfx_core.ts` (the registered
  RENDER_PURE_CORES core; spam budget + quality/tier math stays THERE).
- `painter.ts` (`AbilityVfx`): the decision half. Claims events by ability id,
  plans color/tier via the core, drives the pooled `Vfx` particles, and starts
  archetype sequences. `handleSpellfx` returning false means the renderer's
  generic school-colored arm runs unchanged. `syncEntity` feeds per-frame state
  (windup ceremonies from live cast state, aura-driven orbit bands and barrier
  shells, matched by aura id == ability id, so buffs work online too).
- `fx.ts` (`AbilityVfxFx`): the Three-side engine. Pooled primitive families,
  each hard-capped, materials cloned at construction only: `ribbons.ts` (one
  dynamic mesh: jagged bolts, comet trails, styled slash arcs, generic paths),
  `rings.ts` (shockwave rings), `decals.ts` (dissolve ember/rime/rune marks),
  `overlay_sprites.ts` (one point cloud: windup orbs, orbit bands, sequencer
  transients), `pillars.ts` (light columns), `shells.ts` (fresnel buff/barrier
  shells), `ground_auras.ts` (persistent terrain-draped ground discs),
  `flipbooks.ts` (`ImpactFlipbooks`, the impact sheet quads), and `spirits.ts`
  (GLB ghost puppets, discipline below). `sequencer.ts` (`ArchetypeSequencer`)
  plays the gallery phase anatomy per cast: release flash, travel, the impact
  stack honoring every spec impact flag, staggered rings, lingers, and the
  signature motifs (the `AbilityVfxMotif` set); instants run it compressed
  (0.15s release to impact). `fx_textures.ts` builds the shared canvas
  textures once, deterministically.
- `prewarm.ts`: the warm-up work that is SAFE to run in a live frame, as
  explicit units (`abilityVfxTexturePrewarmSteps`, one per impact sheet plus the
  shared canvases; `collectAbilityVfxCompileTargets`, one program link per
  distinct pooled PROGRAM, keyed by `../draw_program_signature_core.ts`, so a
  pool's per-slot material clones are one unit, never one per clone). The cast
  gate keeps one ready bit per family (`../cast_vfx_family.ts`), one entry per
  program: the ENGINE (the pooled primitive families above except the spirits,
  plus the `../vfx.ts` particle cloud) and the KIT (the Warrior kit's pools
  `fx.ts` builds with the engine, because several of their pieces draw with no
  readiness check of their own). The painter admits each cast on its own mask
  (`cast_requirements.ts`) at its first entry point and latches a refusal for
  the rest of that cast (`cast_admission_core.ts`); spirits keep their own
  gate and sit in neither family. A new pool tags every drawable it builds with
  `tagCastVfxEngine` or `tagCastVfxKit`, carries the `spawnGate` `fx.ts` hands
  it and checks its family before every spawn, the units link engine, then
  kit, then every other pool, and `tests/cast_vfx_engine_family.test.ts` fails
  a pool `fx.ts` builds that sits in none of its tables.
  `AbilityVfxFx.prewarmSpawn` stays boot-window only,
  because it spawns VISIBLE primitives; these units are what the renderer's
  `vfx.ability-primitives` manifest entry retains when the entry deadline drops
  it, and what constrained (phone-class) devices run in the background instead
  of the entry. Anything new added to `prewarmSpawn` that a live frame would
  SEE must not be added here.

`spirits.ts` (`SpiritApparitions`) discipline: do NOT imitate the naive gallery
code it ports. One cached PUPPET per creature GLB, whose meshes all share ONE
additive ghost material, so a spawn only attaches the cached puppet to a pooled
holder slot and steady state allocates nothing; cap 2 concurrent spirits (a
model already on stage cannot double-book); GLB loads are async and a cast
whose model is still in flight SKIPS silently (models warm per class at first
sighting via `painter.syncEntity`); fresh-loaded puppets run a one-frame
invisible compile pass so the ghost program links at warm time, never
mid-combat.

`spectacle.ts` calibration contract: each constant multiplies an authored
spawn value at a SINGLE seam in `fx.ts`/`sequencer.ts`, so degrade-tier ratios
are preserved. It applies only to the crescendo archetypes
(`usesCrescendoScale`; fillers and the at-parity radial/held families stay at
1x) and was tuned against the gallery with an A/B pixel harness. Changing
spawn numbers anywhere else breaks the calibration, and nothing here may
change pool caps, slot counts, or per-frame allocation behavior.

Steady-state cost rules (what a live fight is allowed to spend per frame):
- **Anchors resolve into a caller-owned scratch**: the `../vfx_anchor.ts`
  contract, owned by `src/render/CLAUDE.md`. The enforcement pin lives here:
  `tests/ability_vfx_frame_cost.test.ts` drives the real engine and fails on
  any destination-less resolve inside `update()`.
- **Immediate-mode buffers upload their prefix, not their capacity.**
  `ribbons.ts` and `overlay_sprites.ts` `clearUpdateRanges()` +
  `addUpdateRange(0, used)` before `needsUpdate`, the pooled cloud's idiom
  (`../vfx.ts` `packRenderCloud`); `setDrawRange` is what makes everything past
  the prefix unreachable.
- **The small ground discs thin their terrain drape with distance**
  (`../drape_lod_core.ts`, consumed by `ground_auras.ts` and `decals.ts`). The
  wide shock rings deliberately do NOT: a 10 to 20 yard footprint moves by
  yards under an interpolated drape, which the core's header records with the
  measured numbers. Every sample taken is one the exact drape would take, so
  no mark's footprint moves.

Renderer contract: construct `AbilityVfxFx` with (scene, camera, anchor,
groundY), hand it to `AbilityVfx` via deps (which also wires the Vfx particle
burst, the pulseAt light delegate, and the probe stat sink), call
`handleSpellfx`/`onDamage` from `handleEvent`, `syncEntity(e)` per synced
entity, and `update(dt)` once per frame. Budget tiers: tier 0 plays the full
composition; tier 1 keeps ONE signature beat per motif (halved counts, lite
audio) and sheds decals and lingers; tier 2 keeps color-only minimal particles
and never reaches the sequencer.

## The Warrior kit (authored physical presentation)

The Warrior is the first class whose whole kit is authored rather than
gallery-derived. It lives beside the generic engine, never inside it, and is
selected by ability id only:

- **Selection.** `../warrior_vfx_specs.ts` builds `WARRIOR_VFX_FULL_SPECS` /
  `WARRIOR_VFX_SPECS` from `WARRIOR_CHOREOGRAPHY` (one `PhysicalChoreography`
  per ability: shape, reach, beats, material, weapon) layered over the
  GENERATED gallery row (`ABILITY_VFX_FULL_SPECS[id]`) plus the small
  `WARRIOR_FILLER` table in `../warrior_base_profiles.ts`. The registry
  (`../ability_vfx_registry.ts`) consults the warrior tables FIRST, so a new
  authored class kit registers there the same way and must never shadow
  another class's id (pinned by `tests/warrior_release_scope.test.ts` against
  the committed `tests/helpers/ability_vfx_snapshot.json`; regenerate that
  snapshot only for a deliberate, reviewed spec change:
  `npx tsx scripts/ability_vfx_snapshot.ts --write`).
- **Never touch the actionable reads.** The terrain-draped area ring keeps the
  generated `rg` for every warrior AoE and shout and draws whenever a point
  event carries a radius, on every tier, cold or refused (the `areaTelegraph`
  helper beside `spawnRing`; `tests/warrior_area_telegraph.test.ts`). Authored
  ground figures (`warrior_area*.ts`, `warrior_ground_*.ts`, `warrior_leap*.ts`)
  are additions to that read, never substitutes: they yield to pools, tiers and
  the cast gate, the ring does not.
- **Ownership / admission protocol.** `painter.ts` claims a warrior event by
  ability id and returns `true` only when an authored contact actually played
  (`onDamage` for the blade families in `warrior_blades.ts`, the crush and
  steel contacts, the hammer). The renderer skips the generic hit flinch and
  melee spark on `true`, so every authored contact MUST play a victim-side
  response of its own (`../characters/warrior_contact_recoil.ts`,
  `warrior_area_receiving_contact.ts`, `warrior_ground_receiving_contact.ts`).
  A cold kit (unprepared geometry, refused sequence, tier 2) returns
  `undefined` and the generic path runs unchanged;
  `tests/warrior_blade_contact_ownership.test.ts` pins both arms, local and
  remote.
- **Timing is presentation-side.** The sim resolves every warrior instant on the
  cast tick (`src/sim/combat/warrior_harvest.ts` emits the opening cue, then
  the strikes carry `attackAnimationStarted`). The contact beats come from
  `src/game/fury_audio_core.ts` (`FURY_AUDIO.<id>.times`, one table shared by
  audio, contacts and the HUD's beat-staged combat text): Red Harvest's three
  damage events are folded by `harvest_detonation.ts` and its detonation is
  staged to the final beat on the painter's frame clock (`advance(host, dt)`),
  flushed early only for a caster whose opening was never seen (remote
  catch-up) or on a recast. Never move a beat into the sim to "match" a clip.
- **Families.** Choreography per ability (`*_choreography.ts`, `steel_sweep.ts`,
  `breachmaker.ts`), shapes as pure geometry (`*_shape.ts`, `*_shapes.ts`,
  `physical_choreography_core.ts`, `signature_core.ts`, registered
  RENDER_PURE_CORES), materials (`*_material.ts`, `blood_film_material.ts`),
  atlases and contact assets (`*_atlas.ts`, `contact_assets.ts`,
  `production_assets.ts`, WebP/KTX2 only, never raw PNG in `public/`), state
  readouts (`warrior_fury_states.ts`, `warrior_readiness*.ts`,
  `warrior_attention*.ts`, `warrior_control*.ts`), and prewarm
  (`active_kit_prewarm.ts`, `crest_prewarm.ts`, `guard_prewarm.ts`,
  `baked_pool_prewarm.ts`) registered through the renderer's manifest entry.
  The kit's textures (`production_assets.ts`, `contact_assets.ts`: nine baked
  sheets, three contact sheets, the material maps, the fragment GLB) never ride
  the deferred preload lane: `ensureWarriorKitAssets` loads them once, on
  demand, when a local Warrior enters or the painter first sees a remote one
  (`requestClassKit`), keeps a mip chain on the WebP sheets, and DECLINES them
  on constrained-memory devices, where the kit stays cold and the generic
  presentation runs (`tests/warrior_kit_assets.test.ts`,
  `tests/active_kit_prewarm.test.ts`). Every sheet a live cast draws is
  uploaded by its own unit of the kit recipe (`KIT_SHEETS` in
  `active_kit_prewarm.ts`), the contact sheets and the generic smoke and dust
  layers included, since the kit is their only consumer (the loaded shockwave
  sheet has no live consumer, only the boot-window `prewarmSpawn`); the boot
  warm-up (`abilityVfxTexturePrewarmSteps`) reads none of them, so the recipe is
  their one upload home on every renderer, a recycled one included. A sheet is
  stored as soon as it decodes, so every drawer also waits for this renderer's
  upload (`textureReady`): the baked layers skip, a contact flipbook binds the
  procedural shard sheet meanwhile when this renderer uploaded it and skips
  otherwise (`tests/warrior_kit_sheet_readiness.test.ts`). A rebuilt renderer
  therefore draws none of them until its own recipe runs, which for another
  class waits for the next Warrior sighting.
  A pool built at boot never relies on those getters in its constructor, since
  the load lands after it: it binds them in
  a unit of its own preparation recipe, ahead of its compile (the crests'
  `crest-bind-kit`, the guards' `guard-bind-steel`; `tests/crest_prewarm.test.ts`).
  A pool whose GEOMETRY comes from the kit builds its meshes in that recipe
  too, and spawns nothing until their upload unit ran (the solid fragments'
  `fragment-build`; `tests/solid_impact_fragments_prewarm.test.ts`).
  Its preparation rides
  `ACTIVE_KIT_PRIORITY` (the boot-debt lane) under the per-frame budget, never
  the actionable floor, and it waits out a loading cover: the kit is cosmetic
  and gated by its own readiness, and the floor once admitted all ten sheets
  into one frame (about 0.6 s on an Intel HD 530). Generic sheets (smoke, dust,
  shockwave, the harvest splash) ship at 1024px; only signature sheets earn
  2048px, and a new sheet needs the same justification.
- **Cost rules still apply.** The shared families it extends (`ribbons.ts`
  vertex budget, `flipbooks.ts` blending, `fx_textures.ts` overlay atlas) are
  drawn by every class, so a change there is a change for every class: state
  it in the PR body and show a before/after.

Verification: `scripts/ability_vfx_probe.mjs` (dev server + headless browser)
asserts every spec'd ability clears its per-archetype primitive bar in the
real client via the dev-only `window.__game.abilityVfxStats` hook. All
materials are additive with depth-write off; no new post-processing: HDR
multipliers ride the existing composer bloom exactly like `../vfx.ts`.
