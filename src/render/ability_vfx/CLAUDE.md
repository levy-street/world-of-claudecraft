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
  distinct pooled material). `AbilityVfxFx.prewarmSpawn` stays boot-window only,
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

Verification: `scripts/ability_vfx_probe.mjs` (dev server + headless browser)
asserts every spec'd ability clears its per-archetype primitive bar in the
real client via the dev-only `window.__game.abilityVfxStats` hook. All
materials are additive with depth-write off; no new post-processing: HDR
multipliers ride the existing composer bloom exactly like `../vfx.ts`.
