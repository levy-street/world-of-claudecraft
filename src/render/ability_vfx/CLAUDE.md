<!-- src/render/ability_vfx/: the per-ability spell VFX subsystem. Root +
     src/render CLAUDE.md apply; this file is directory-local only. -->

# src/render/ability_vfx/: per-ability spell VFX

Gives every ability the Ability VFX Gallery's authored visual identity. Three
layers behind the `index.ts` barrel:

- Spec data: `../ability_vfx_specs.ts` (compact planning projection) and
  `../ability_vfx_full_specs.ts` (the COMPLETE per-ability spec mirrored from
  the gallery source of truth: archetype, palette, windup style, motifs,
  impact/bolt/strike/nova/beam/dot/cc/shout/burst blocks, buff orbit DNA,
  barrier, linger). Types live in `../ability_vfx_core.ts` (the registered
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
  shells). `sequencer.ts` (`ArchetypeSequencer`) plays the gallery phase
  anatomy per cast: release flash, travel, the impact stack honoring every
  spec impact flag, staggered rings, lingers, and the 14 signature motifs;
  instants run it compressed (0.15s release to impact). `fx_textures.ts`
  builds the shared canvas textures once, deterministically.
- `prewarm.ts`: the warm-up work that is SAFE to run in a live frame, as
  explicit units (`abilityVfxTexturePrewarmSteps`, one per impact sheet plus the
  shared canvases; `collectAbilityVfxCompileTargets`, one program link per
  distinct pooled material). `AbilityVfxFx.prewarmSpawn` stays boot-window only,
  because it spawns VISIBLE primitives; these units are what the renderer's
  `vfx.ability-primitives` manifest entry retains when the entry deadline drops
  it, and what constrained (phone-class) devices run in the background instead
  of the entry. Anything new added to `prewarmSpawn` that a live frame would
  SEE must not be added here.

Steady-state cost rules (what a live fight is allowed to spend per frame):
- **Anchors resolve into a scratch.** The shared resolver
  (`../vfx_anchor.ts`) takes an optional caller-owned destination; every
  PER-FRAME path here passes one and allocates nothing, while the one-shot
  spawn paths omit it and keep the retainable fresh vector. `tests/
  ability_vfx_frame_cost.test.ts` drives the real engine and fails on any
  destination-less resolve inside `update()`.
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
entity, and `update(dt)` once per frame. Budget tiers degrade in order:
tier 1 sheds motifs, decals, and lingers; tier 2 keeps color-only minimal
particles (the sequencer never runs).

Verification: `scripts/ability_vfx_probe.mjs` (dev server + headless browser)
asserts every spec'd ability clears its per-archetype primitive bar in the
real client via the dev-only `window.__game.abilityVfxStats` hook. All
materials are additive with depth-write off; no new post-processing: HDR
multipliers ride the existing composer bloom exactly like `../vfx.ts`.
