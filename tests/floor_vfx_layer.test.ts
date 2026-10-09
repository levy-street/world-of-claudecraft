import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GroundDecals } from '../src/render/ability_vfx/decals';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { GroundAuras } from '../src/render/ability_vfx/ground_auras';
import { ShockRings } from '../src/render/ability_vfx/rings';
import { applyFloorVfxLayer } from '../src/render/floor_vfx_layer';
import {
  FLOOR_VFX_LAYER_BASE,
  FLOOR_VFX_LAYER_SPAN,
  FLOOR_VFX_LAYERS,
  type FloorVfxLayer,
  floorVfxLayerOf,
  floorVfxLayerTopOrder,
  floorVfxRenderOrder,
} from '../src/render/floor_vfx_layer_core';
import { GroundAimReticleVisual } from '../src/render/ground_aim_reticle_visual';
import { buildIgnivarBrandTelegraph } from '../src/render/ignivar_brand_telegraph';
import {
  buildIgnivarEncounterPrewarmVisual,
  buildIgnivarSkyfireTelegraph,
} from '../src/render/ignivar_encounter';
import { buildGroundFireAoeStandIn } from '../src/render/ignivar_fire_vfx';
import { IGNIVAR_FORGE_CHAIN_VISUAL_NAME } from '../src/render/ignivar_forge_chains';
import {
  buildIgnivarForgeJudgmentPrewarmVisual,
  buildIgnivarForgeJudgmentVisual,
} from '../src/render/ignivar_forge_judgment';
import { buildIgnivarForgeWaveVisual } from '../src/render/ignivar_forge_wave';
import { buildIgnivarFrontalTelegraph } from '../src/render/ignivar_frontal_telegraph';
import {
  buildIgnivarRotatingRaysPrewarmVisual,
  buildIgnivarRotatingRaysTelegraph,
} from '../src/render/ignivar_rotating_rays';
import { buildIgnivarSoakTelegraph } from '../src/render/ignivar_soak_telegraph';
import { MageGroundFx, type RuneCircleSpawn, runeCircleLayer } from '../src/render/mage_ground_fx';
import { buildNythraxisBoundCagePrewarmVisual } from '../src/render/nythraxis_bound_cage_visual';
import { buildNythraxisGravePrewarmVisual } from '../src/render/nythraxis_grave_flame_visual';
import { buildNythraxisGravefirePrewarmVisual } from '../src/render/nythraxis_gravefire_visual';
import { buildNythraxisBindingSigilPrewarmVisual } from '../src/render/nythraxis_sigil_visual';
import {
  buildNythraxisSoulRendMarker,
  buildNythraxisSoulRendMarkerPrewarmVisual,
} from '../src/render/nythraxis_soul_rend_marker';
import { PaladinConsecrationVisuals } from '../src/render/paladin_consecration_visual';
import { buildVarkhulAssemblyPrewarmVisual } from '../src/render/varkhul_assembly_visual';
import {
  buildVarkhulCinderOrbsTelegraph,
  buildVarkhulEncounterPrewarmVisual,
  buildVarkhulMakersBrandTelegraph,
} from '../src/render/varkhul_encounter';
import { buildVarkhulForgeBeamPrewarmVisual } from '../src/render/varkhul_forge_beam_visual';
import { buildVarkhulFrontalVisual } from '../src/render/varkhul_frontal_visual';
import { buildVarkhulInterceptBeamPrewarmVisual } from '../src/render/varkhul_intercept_beam_visual';
import { buildVarkhulWorldfirePrewarmVisual } from '../src/render/varkhul_worldfire_visual';
import { ABILITIES } from '../src/sim/data';
import { NYTHRAXIS_SIGIL_CAST_ID } from '../src/sim/nythraxis_binding_sigil';
import { NYTHRAXIS_GRAVE_ERUPTION_CAST_ID } from '../src/sim/nythraxis_grave_eruption';

// The floor VFX ladder (src/render/floor_vfx_layer_core.ts) is what keeps a
// boss telegraph painting over a player's ground effects: every floor mesh is
// transparent with depth-write off, so renderOrder is the only arbiter, and
// before the ladder each module picked its own integer. These pins hold the
// ladder's shape, the Group trap, the module registry and its completeness
// sweep, and the end-to-end outcome on the real builders.

const repoRoot = join(__dirname, '..');
const renderRoot = join(repoRoot, 'src', 'render');

interface FloorVfxModule {
  file: string;
  /** The band the module's floor pieces ride. */
  layer: FloorVfxLayer;
  /** Further bands the module may name (a builder that serves two callers). */
  alsoNames?: readonly FloorVfxLayer[];
  /**
   * Strict modules take EVERY renderOrder from the seam (no bare integer
   * literal survives). The non-strict ones layer their floor pieces while
   * their unrelated, standing or airborne meshes keep their own orders (each
   * entry's comment names them: renderer.ts's god-ray sprites,
   * ignivar_fire_vfx.ts's projectile and impact pieces, the Bastion rain's
   * streaks, the Hydra's ice wall, the Moonbridge's beam).
   */
  strict: boolean;
}

/** Every module that draws floor-anchored VFX, and the band it belongs to. */
const FLOOR_VFX_LAYERED_MODULES: readonly FloorVfxModule[] = [
  // the world's own marks
  { file: 'src/render/blob_shadows.ts', layer: 'ground', strict: true },
  { file: 'src/render/mob_night_glow.ts', layer: 'ground', strict: true },
  { file: 'src/render/torch_glow_decal.ts', layer: 'ground', strict: true },
  { file: 'src/render/ember_pools.ts', layer: 'ground', strict: true },
  { file: 'src/render/camp_braziers.ts', layer: 'ground', strict: true },
  { file: 'src/render/streetlamps.ts', layer: 'ground', strict: true },
  { file: 'src/render/decor_torch_fx.ts', layer: 'ground', strict: true },
  { file: 'src/render/impact_site.ts', layer: 'ground', strict: true },
  { file: 'src/render/hill_ring.ts', layer: 'ground', strict: true },
  // Balgath's circle telegraphs (the Barrow Smash's safe gap, his solid stomp, hammer and
  // Barrowfall): mechanics a raid must read, on the encounter band.
  { file: 'src/render/balgath_ring_fx.ts', layer: 'encounter', strict: true },
  // The Sanctum Seal Gate's rime fan and the cold mist it breathes out over
  // the plaza: the world's own marks, under every telegraph.
  { file: 'src/render/sanctum_seal_gate.ts', layer: 'ground', strict: true },
  // A Buried Hoard boss room's additive floor light under its kit props, kept on
  // the order it shipped with (2, the ground band's second rung).
  { file: 'src/render/hoard_room_kit.ts', layer: 'ground', strict: true },
  // The Hollow Crypt's torch pools and the soul column's floor pool: the world's
  // own light on the ring floor, under every telegraph Morthen will paint.
  { file: 'src/render/hollow_crypt/crypt_lights.ts', layer: 'ground', strict: true },
  // The engraved rite circle and cloister rosette: dim world marks on the floor.
  { file: 'src/render/hollow_crypt/crypt_floor_marks.ts', layer: 'ground', strict: true },
  // The Sunken Bastion's lantern and brazier pools on its floors.
  { file: 'src/render/sunken_bastion/bastion_lights.ts', layer: 'ground', strict: true },
  // The Bastion's storm rain: its splash rings lie on the floor under every
  // telegraph (ground band); the falling streaks and far sheets keep their own
  // orders (weather standing up from the ground, off the ladder).
  { file: 'src/render/sunken_bastion/bastion_rain.ts', layer: 'ground', strict: false },
  // The Mere Hydra's Tsunami: its lingering foam lies on the swept half's floor
  // and water, and the wave wall and its spray ride the same band, so the
  // encounter-band telegraph of the swept half always paints over all of it.
  { file: 'src/render/drowned_temple/temple_tsunami_fx.ts', layer: 'ground', strict: true },
  // Ysolei's cosmetic layer: the Undertow's spiral and the Rising Tide's sheets
  // lie on the island floor, and her tide and crash bursts rise from it, all in
  // the ground band so temple_fx.ts's encounter-band rings and flood half-disc
  // always paint over them.
  { file: 'src/render/drowned_temple/temple_ysolei_fx.ts', layer: 'ground', strict: true },
  // Laverock's finale: the pool of light at his feet, the lagoon's glow and the
  // fallen's glowing outlines lie on the floor and the water (ground band); it
  // plays once the last boss is dead, so no telegraph is ever under it.
  { file: 'src/render/drowned_temple/temple_cantor_finale_fx.ts', layer: 'ground', strict: true },
  // The Temple trash mechanics pass: the whirlpool's vortex, the gaze's reach
  // rim and the floor waves under the kit's rings, and the bubbles, threads,
  // eyes and arcs in the air above every floor mark, all on the encounter band.
  { file: 'src/render/drowned_temple/temple_trash_fx.ts', layer: 'encounter', strict: true },
  // The trash pass's second wave: the Siren's tether, ring and halo, and the
  // Sergeant's crosshair, aiming lines and bolts, all on the encounter band.
  { file: 'src/render/drowned_temple/temple_lure_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/sunken_bastion/bastion_order_fx.ts', layer: 'encounter', strict: true },
  // The Mere Hydra's Combined Breath: the frozen lane, the wall's frosted foot
  // and lee shimmer, the venom arrows and the rime crystals' rings lie on the
  // floor in the encounter band (they are actionable: where not to stand,
  // where to hide). The ice wall and the crystals themselves are solid,
  // depth-writing bodies standing up from the floor and keep their own order.
  {
    file: 'src/render/drowned_temple/temple_hydra_combo_fx.ts',
    layer: 'encounter',
    strict: false,
  },
  // The Moonbridge forming: the beam's landing ring lies on the Altar Landing
  // in the encounter band; the beam itself (core, sheath, racing front star
  // and the prism flare) runs through the air and keeps its own orders.
  {
    file: 'src/render/drowned_temple/temple_moonbridge_fx.ts',
    layer: 'encounter',
    strict: false,
  },
  // The Wildheart Basin's brazier pools on its floors (the world's own light).
  { file: 'src/render/wildheart_basin/basin_lights.ts', layer: 'ground', strict: true },
  // The spirit light pooled on the jaguar maw's jaw once the way out opens.
  { file: 'src/render/wildheart_basin/maw_glow.ts', layer: 'ground', strict: true },
  // The Basin's telegraphs (the shared kit) and its creature effects: the
  // Stomp's shock rings, the spore fog, the pulses and the bursts.
  { file: 'src/render/wildheart_basin/basin_fx.ts', layer: 'encounter', strict: true },
  // The Basin's three bosses (composed by basin_fx.ts): their cast telegraphs
  // on the shared kit, the charge sigils and the sun glyph overlays.
  { file: 'src/render/wildheart_basin/basin_boss_fx.ts', layer: 'encounter', strict: true },
  // The trash hunt (composed by basin_fx.ts): its telegraphs on the shared kit,
  // the quarry's claw rakes and the frenzies' red pools.
  { file: 'src/render/wildheart_basin/basin_trash_fx.ts', layer: 'encounter', strict: true },
  // The basin's shared splashes (the Saurian's water, the pit's sand, the pods'
  // goo, Gorge's acid: crowns and ripples) on the ground band: cosmetic, so
  // every telegraph paints over them.
  { file: 'src/render/wildheart_basin/basin_splash.ts', layer: 'ground', strict: true },
  // The Pack Bond's ground glows under master and jaguar (the lowest encounter rung).
  { file: 'src/render/wildheart_basin/bond_cord.ts', layer: 'encounter', strict: true },
  // The Gravewyrm Sanctum's telegraphs (the shared kit), the soulfire patches'
  // glow and flames, the shock rings and the particle pools.
  { file: 'src/render/gravewyrm_sanctum_fx/sanctum_fx.ts', layer: 'encounter', strict: true },
  // The Sanctum trash's aura glows pooled under the goaded and stoked mobs.
  {
    file: 'src/render/gravewyrm_sanctum_fx/sanctum_trash_fx.ts',
    layer: 'encounter',
    strict: true,
  },
  // The Sledge Tusker's enrage glow pooled on the ice round its feet.
  { file: 'src/render/gravewyrm_sanctum_fx/tusker_fx.ts', layer: 'encounter', strict: true },
  // The Sanctum trash mechanics pass: the Thaw the Held cracks under the
  // corpse, the lash's swoosh, the eruption column, the fallen brazier's coals.
  {
    file: 'src/render/gravewyrm_sanctum_fx/sanctum_kit_fx.ts',
    layer: 'encounter',
    strict: true,
  },
  // The trash engine (render/trash_engine_fx): hazard pools and their danger
  // ring, the combat walls' stain and shell, the walker orbs' floor glow and
  // lane chevrons, the line-of-sight nova's sight field and wave, the usable
  // bodies' reach ring and effort arc, the freeze and brand marks, the shock
  // rings and particle pools; all on the encounter band.
  { file: 'src/render/trash_engine_fx/engine_particles.ts', layer: 'encounter', strict: true },
  { file: 'src/render/trash_engine_fx/engine_hazards.ts', layer: 'encounter', strict: true },
  { file: 'src/render/trash_engine_fx/engine_walls.ts', layer: 'encounter', strict: true },
  { file: 'src/render/trash_engine_fx/engine_walkers.ts', layer: 'encounter', strict: true },
  { file: 'src/render/trash_engine_fx/engine_nova.ts', layer: 'encounter', strict: true },
  { file: 'src/render/trash_engine_fx/engine_use.ts', layer: 'encounter', strict: true },
  { file: 'src/render/trash_engine_fx/engine_body_fx.ts', layer: 'encounter', strict: true },
  // The dungeon's quench pools: permanent level dressing on the ground band's
  // top rung, so every encounter telegraph paints over them.
  { file: 'src/render/trash_engine_fx/engine_quench.ts', layer: 'ground', strict: true },
  // The Gravewyrm Sanctum's three bosses: their cast telegraphs on the shared
  // kit, the plate overlays, the meltwater, the rings, the landing shadow.
  {
    file: 'src/render/gravewyrm_sanctum_bosses/sanctum_boss_fx.ts',
    layer: 'encounter',
    strict: true,
  },
  // A worn trinket's ground glow (the Last Flame Lantern): a player-band floor
  // effect that every encounter telegraph must still paint over.
  { file: 'src/render/trinket_relics.ts', layer: 'player', strict: true },
  // player class ability ground VFX
  { file: 'src/render/ability_vfx/decals.ts', layer: 'player', strict: true },
  { file: 'src/render/ability_vfx/ground_auras.ts', layer: 'player', strict: true },
  { file: 'src/render/ability_vfx/rings.ts', layer: 'player', strict: true },
  { file: 'src/render/player_aura_rings.ts', layer: 'player', strict: true },
  // The meteor telegraph serves the mage's own Meteor AND the sim's world
  // warnings (Ignivar meteors, Varkhul anvils and forgestorm, Nythraxis grave
  // eruptions), so it picks its band per spawn.
  { file: 'src/render/mage_ground_fx.ts', layer: 'player', alsoNames: ['encounter'], strict: true },
  { file: 'src/render/necromancy_ground_fx.ts', layer: 'player', strict: true },
  { file: 'src/render/paladin_consecration_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/paladin_aegis_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/paladin_ascension_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/ring_of_frost_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/frost_nova_root_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/glacial_front_visual.ts', layer: 'player', strict: true },
  { file: 'src/render/abyssal_rift_fx.ts', layer: 'player', strict: true },
  { file: 'src/render/umbral_anchor_marker.ts', layer: 'player', strict: true },
  { file: 'src/render/warlock_meteor_fx.ts', layer: 'player', strict: true },
  { file: 'src/render/sentence_vfx.ts', layer: 'player', strict: true },
  // The player's own click-to-move marker and AoE landing flash: normal-blended
  // feedback, so it rides the TOP of the player band rather than the reticle
  // band, and never covers a telegraph.
  { file: 'src/render/renderer.ts', layer: 'player', strict: false },
  // boss and encounter mechanics
  { file: 'src/render/ignivar_encounter.ts', layer: 'encounter', strict: true },
  // The Sunken Bastion's boss visuals (its trash and boss telegraphs lay their
  // cones, rings, lanes and glyphs through the shared kit below).
  { file: 'src/render/sunken_bastion/bastion_boss_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/sunken_bastion/bastion_creature_fx.ts', layer: 'encounter', strict: true },
  // The Bastion trash mechanics: the shock rings and standing volumes (the
  // ward, the shroud, the column, the soul light) on the shared kit, the
  // boathook's glint, the Fog Bank's floor patch, the Brine Column's foam
  // ring and poured stream.
  { file: 'src/render/sunken_bastion/bastion_trash_fx_kit.ts', layer: 'encounter', strict: true },
  { file: 'src/render/sunken_bastion/bastion_boathook_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/sunken_bastion/bastion_fog_bank_fx.ts', layer: 'encounter', strict: true },
  {
    file: 'src/render/sunken_bastion/bastion_brine_column_fx.ts',
    layer: 'encounter',
    strict: true,
  },
  // Olen's brine, Sentence column and bubble; Vael's staging pillar; the
  // Mooring Post lamps' safe rings (their lamplight pool sits on the ground rung).
  { file: 'src/render/sunken_bastion/bastion_olen_fx.ts', layer: 'encounter', strict: true },
  // The Hollow Crypt wing bosses' host and painters (crypt_boss_fx.ts).
  { file: 'src/render/hollow_crypt/crypt_boss_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hollow_crypt/marrow_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hollow_crypt/lady_fx.ts', layer: 'encounter', strict: true },
  // Cantor Ilvane: her painter (ilvane_fx.ts) lays only the shared kit's
  // glyph and lanes now; her Dirge's sight field and its shadow wedges, the
  // rings under the players, the shock of sound and its curtain, her aura, the
  // organ's pipes, the beams, notes and silence marks ride the encounter band.
  { file: 'src/render/hollow_crypt/ilvane_dirge_fx.ts', layer: 'encounter', strict: true },
  // Morthen's fight on the Rite Ring and the Knellwyrm's Burning Knell
  // (morthen_rite_fx.ts, the host): Grave Chill's mist under every telegraph
  // rung, the scorch and rune circle on the floor rungs, the telegraphs on the
  // kit's rungs, the ward, columns, beams and flashes above them.
  { file: 'src/render/hollow_crypt/morthen_rite_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hollow_crypt/morthen_attack_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hollow_crypt/morthen_ward_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hollow_crypt/morthen_candle_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hollow_crypt/knell_fx.ts', layer: 'encounter', strict: true },
  {
    file: 'src/render/sunken_bastion/bastion_vael_stage_fx.ts',
    layer: 'encounter',
    strict: true,
  },
  {
    file: 'src/render/sunken_bastion/bastion_mooring_fx.ts',
    layer: 'encounter',
    strict: true,
    alsoNames: ['ground'],
  },
  // The shared dungeon floor telegraph (the crypt's and the Bastion's cones,
  // rings, lanes and kick glyphs, and their edge curtains).
  { file: 'src/render/floor_telegraph/telegraph_kit.ts', layer: 'encounter', strict: true },
  // The Hollow Crypt trash mechanics pass's hero effects: the bone pile's glow,
  // the rupture crater and pool, the crush crack, the web net and the burning
  // embers (floor bodies under the telegraph rungs), their shockwaves, and the
  // particles, glyphs and tethers over them. The host owns every rung
  // (KIT_STEPS); its parts, crypt_bone_fx.ts and crypt_mark_fx.ts, build their
  // pieces through it and set no order of their own.
  { file: 'src/render/hollow_crypt/crypt_trash_kit_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_forge_wave.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_frontal_telegraph.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_soak_telegraph.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_brand_telegraph.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_rotating_rays.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_conduit.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_fire_beams.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_forge_judgment.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_lava_moat.ts', layer: 'encounter', strict: true },
  { file: 'src/render/ignivar_fire_vfx.ts', layer: 'encounter', strict: false },
  { file: 'src/render/nythraxis_sigil_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/nythraxis_soul_rend_marker.ts', layer: 'encounter', strict: true },
  { file: 'src/render/nythraxis_gravefire_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/nythraxis_grave_flame_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_forgestorm_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_cinder_orb_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_assembly_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_intercept_beam_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_forge_beam_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_worldfire_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_encounter.ts', layer: 'encounter', strict: true },
  { file: 'src/render/varkhul_frontal_visual.ts', layer: 'encounter', strict: true },
  { file: 'src/render/rift_death_zone.ts', layer: 'encounter', strict: true },
  // Buried Hoard boss mechanics (the 2026-09-28 release/v0.44.0 merge into
  // feature/buried-hoards): the floor telegraphs, their standing pieces and the
  // cosmetic dressing and spell effects drawn over them, all on the encounter
  // rule (step = the order they shipped with, minus one), so the stack they were
  // authored with against the reused Ignivar frontal telegraph, the rift death
  // zone and the rift mobs' rune circles is kept exactly.
  { file: 'src/render/hoard_boss_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_boss_dressing.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_encounter_accents.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_spell_fx.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_bone_reaper.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_boulder.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_cocoon.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_forge_hammer.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_forge_gate.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_ice_age.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_orbital_lightning.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_pulsars.ts', layer: 'encounter', strict: true },
  { file: 'src/render/hoard_tentacles.ts', layer: 'encounter', strict: true },
  // The Gravewyrm Sanctum's fire pools, the vault's meltwater pools and the
  // Thaw Works' stains and melt channel: the floor's own marks.
  { file: 'src/render/gravewyrm_sanctum/sanctum_lights.ts', layer: 'ground', strict: true },
  { file: 'src/render/gravewyrm_sanctum/sanctum_vault.ts', layer: 'ground', strict: true },
  { file: 'src/render/gravewyrm_sanctum/sanctum_works.ts', layer: 'ground', strict: true },
  // the player's own ground aim guide (additive: it brightens what lies under it)
  { file: 'src/render/ground_aim_reticle_visual.ts', layer: 'reticle', strict: true },
];

/**
 * Render modules that set a bare renderOrder and are deliberately OFF the
 * ladder (docs/design/vfx-floor-layering.md, "out of scope"): vertical VFX
 * that stands up from the ground, static dungeon and zone dressing, water and
 * sky, camera-attached overlays, character parts, and world markers far from
 * any raid floor. A NEW render module that sets a bare renderOrder must either
 * register above or be added here with a reason; the sweep below fails
 * otherwise, so a floor mechanic cannot ship outside the ladder unnoticed.
 */
const FLOOR_VFX_OUT_OF_SCOPE: readonly string[] = [
  // pooled ability VFX families that stand up from the ground
  'src/render/ability_vfx/flipbooks.ts',
  'src/render/ability_vfx/overlay_sprites.ts',
  'src/render/ability_vfx/pillars.ts',
  'src/render/ability_vfx/ribbons.ts',
  'src/render/ability_vfx/shells.ts',
  'src/render/ability_vfx/spirits.ts',
  'src/render/vfx.ts',
  // Warrior kit volumes (crest fans, rupture masses, impact volumes): depth-tested
  // 3D shapes on fixed orders 4 and 5. The one flat kind (the baked shockwave)
  // rides the same pooled slots on order 5, under every player and encounter
  // rung, so a boss telegraph still paints over it.
  'src/render/ability_vfx/baked_impact_layers.ts',
  'src/render/ability_vfx/signature_crests.ts',
  // The Mirefen world boss Balgath (open world, alone on his crater, never on a raid
  // floor beside another encounter's telegraphs): his slams, boulders, debris, star and
  // ranged kit, the eye glow and its reticle, the effigy rig, and
  // his loot's standard, beam and rope (balgath_loot_relics.ts, all vertical or
  // body-anchored). Moving his floor telegraphs onto the ladder is a follow-up.
  'src/render/balgath_debris.ts',
  'src/render/balgath_fx.ts',
  'src/render/balgath_loot_relics.ts',
  'src/render/balgath_ranged_fx.ts',
  'src/render/balgath_starwake_fx.ts',
  'src/render/characters/charge_glow.ts',
  'src/render/characters/effigy_rig.ts',
  'src/render/characters/eye_glow.ts',
  'src/render/characters/eye_ward_marker.ts',
  'src/render/eye_ward_badge.ts',
  // vertical or body-anchored class VFX
  'src/render/burning_pact_markers.ts',
  'src/render/characters/gloamveil_veil.ts',
  'src/render/characters/moonwing_adornment.ts',
  'src/render/characters/paladin_templars_verdict_fx.ts',
  'src/render/characters/visual.ts',
  'src/render/drain_life_vfx.ts',
  'src/render/evil_eye_markers.ts',
  'src/render/fireball_travel_visual.ts',
  'src/render/goblin_rocket_sled_fx.ts',
  'src/render/ice_block_visual.ts',
  'src/render/mage_barrier_visual.ts',
  'src/render/necromancy_army_portal_fx.ts',
  'src/render/paladin_oath_chain_visual.ts',
  'src/render/weapon_vfx.ts',
  // Ignivar dressing that is not a floor mechanic
  'src/render/ignivar_arena_atmosphere.ts',
  'src/render/ignivar_mist_gate.ts',
  'src/render/ignivar_model_vfx.ts',
  // static dungeon, zone and town dressing, water and sky
  'src/render/delve_marsh_dressing.ts',
  'src/render/dungeon.ts',
  'src/render/fenbridge_town.ts',
  'src/render/frost_sky.ts',
  'src/render/haunt_features.ts',
  // the Buried Hoard valley floor's shadow catcher: the static ground itself
  'src/render/hoard_cavern_ground.ts',
  // Buried Hoard loot shows: the Coinsack Scurrier's additive coin glints over
  // opaque coins, and the reward chest's additive light cards and motes, which
  // appear only once the room's boss is dead, so no floor mechanic is under them
  'src/render/hoard_goblin_coins.ts',
  'src/render/hoard_reward_chest.ts',
  'src/render/placed_assets.ts',
  'src/render/props.ts',
  'src/render/realm_builder_monument_fx.ts',
  'src/render/rift_decor.ts',
  // the ferry's foam wake: open-sea points trailing a ship, never over a raid floor
  'src/render/ship_wake.ts',
  'src/render/underwater.ts',
  'src/render/weather.ts',
  // The Hollow Crypt's sky and air: the mist sea far below every terrace, the
  // vertical soul column, wisps, dust and moonbeams (no floor mark; its floor
  // pool lives in crypt_lights.ts on the ground rung).
  'src/render/hollow_crypt/crypt_atmosphere.ts',
  // The Sunken Bastion's sky, sea, fog banks, rain and gulls; the Fogbeacon's
  // beam and fog streams; the surf off the cliff feet; the standing water (on
  // the water surface order 0, under the whole ladder); and the gates' fog
  // walls, which stand up across a passage. None is a floor mark.
  'src/render/sunken_bastion/bastion_sky_sea.ts',
  'src/render/sunken_bastion/bastion_beacon.ts',
  'src/render/sunken_bastion/bastion_shore.ts',
  'src/render/sunken_bastion/bastion_water.ts',
  // The Drowning Hymn's flood over the Beacon Crown: standing water too, on
  // the same water surface order 0 under the whole ladder.
  'src/render/sunken_bastion/bastion_flood.ts',
  'src/render/sunken_bastion/bastion_gates.ts',
  // The Drowned Temple's sky, lagoon, mist and light-fish; the crater and its
  // falls; the gates (a water veil, wards, a rising stair, the Moonbridge);
  // the Moon Altar's column, the pool water and the prism beam; the Mere
  // Hydra's body and breath; and the Reflections' tethers in the air. Its
  // floor marks are the shared telegraph kit's (the ladder's own rungs).
  'src/render/drowned_temple/temple_sky_lagoon.ts',
  'src/render/drowned_temple/temple_crater.ts',
  'src/render/drowned_temple/temple_gates.ts',
  'src/render/drowned_temple/temple_landmarks.ts',
  'src/render/drowned_temple/temple_hydra.ts',
  'src/render/drowned_temple/temple_fx.ts',
  // The Wildheart Basin's water (the ford, the river, the plunge pool: water
  // surfaces under the whole ladder), its waterfalls (curtains, foam, spray,
  // mist, rainbows standing up from the water) and its air (the gorge haze
  // over the void, god rays, motes, birds). None is a floor mark; its floor
  // marks are the shared telegraph kit's and its brazier pools sit on the
  // ground rung (basin_lights.ts).
  'src/render/wildheart_basin/basin_water.ts',
  'src/render/wildheart_basin/basin_falls.ts',
  'src/render/wildheart_basin/basin_air.ts',
  // The Gravewyrm Sanctum's sky dome (behind the world) and the Calving Face
  // (a wall of ice past the lake's shelf: its clear shell, the shard's halo,
  // the wyrm's eye and the ice bursts of its stages stand in the air beyond
  // every arena). None is a floor mark; the Sanctum's floor marks (the fire
  // pools, the vault's meltwater, the Thaw Works' stains) sit on the ground
  // rung below.
  'src/render/gravewyrm_sanctum/sanctum_sky.ts',
  'src/render/gravewyrm_sanctum/sanctum_face.ts',
  // battleground objective marks and world markers far from any raid floor
  'src/render/battleground.ts',
  'src/render/battleground_fx.ts',
  'src/render/battleground_lantern_fx.ts',
  'src/render/battleground_rune_vfx.ts',
  'src/render/coach_trail.ts',
  'src/render/corpse_beacon.ts',
  'src/render/mount_beacon.ts',
  'src/render/mount_glow.ts',
  'src/render/race_line.ts',
  // World-quest minigame and stealth visuals (integration/world-quests-v0440):
  // the Arcane Calligraphy tracing ribbons (ui3d, drawn on a quest floor far
  // from any raid) and the infiltration guards' vision cones (flat quest-zone
  // markers, like the battleground objective marks above).
  'src/render/world_quest_trace_visual.ts',
  'src/render/world_quest_public_trace_visual.ts',
  'src/render/shadow_infiltration_visual.ts',
];

/**
 * Pre-existing Group renderOrders, all far from any raid floor. A Group's
 * renderOrder is three's groupOrder sort key and outranks the whole ladder, so
 * this list must only ever shrink; a new entry means a floor mechanic can be
 * painted over by a marker.
 */
const KNOWN_GROUP_ORDER_FILES: readonly string[] = [
  'src/render/mount_beacon.ts',
  'src/render/race_line.ts',
  'src/render/underwater.ts',
];

const SEAM_IMPORT_RE = /from '(?:\.\.\/|\.\/)floor_vfx_layer(?:_core)?'/;
const BARE_LITERAL_RE = /renderOrder\s*=\s*-?\d/;
const LAYER_CALL_RE =
  /(?:floorVfxRenderOrder|floorVfxLayerTopOrder)\(\s*'(\w+)'|applyFloorVfxLayer\([^)]*?,\s*'(\w+)'/g;

type Renderable = THREE.Object3D & {
  isMesh?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isLine?: boolean;
};

function isRenderable(object: THREE.Object3D): boolean {
  const r = object as Renderable;
  return Boolean(r.isMesh || r.isPoints || r.isSprite || r.isLine);
}

function renderOrders(root: THREE.Object3D): number[] {
  const orders: number[] = [];
  root.traverse((object) => {
    if (isRenderable(object)) orders.push(object.renderOrder);
  });
  return orders;
}

function groupOrders(root: THREE.Object3D): number[] {
  const orders: number[] = [];
  root.traverse((object) => {
    if ((object as THREE.Group).isGroup) orders.push(object.renderOrder);
  });
  return orders;
}

function renderSourceFiles(): string[] {
  return (
    readdirSync(renderRoot, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => join(renderRoot, f))
      .filter((f) => statSync(f).isFile())
      // forward slashes on every platform, so the registry paths match on Windows too
      .map((f) => relative(repoRoot, f).split(sep).join('/'))
      .sort()
  );
}

/** Identifiers a file binds to `new THREE.Group()`, locals and `this.` fields. */
function groupIdentifiers(source: string): Set<string> {
  const names = new Set<string>();
  const local = /(?:const|let)\s+(\w+)(?::\s*THREE\.Group)?\s*=\s*new THREE\.Group\(\)/g;
  for (const m of source.matchAll(local)) names.add(m[1]);
  for (const m of source.matchAll(/this\.(\w+)\s*=\s*new THREE\.Group\(\)/g)) {
    names.add(`this.${m[1]}`);
  }
  for (const m of source.matchAll(/(?:readonly\s+)?(\w+)\s*=\s*new THREE\.Group\(\);/g)) {
    names.add(`this.${m[1]}`);
  }
  return names;
}

function groupOrderAssignments(file: string): string[] {
  const source = readFileSync(join(repoRoot, file), 'utf8');
  const hits: string[] = [];
  const names = groupIdentifiers(source);
  if (names.size === 0) return hits;
  source.split('\n').forEach((line, index) => {
    for (const name of names) {
      // A negative order (the opaque-capture sentinel's -Infinity) sorts the
      // Group under every rung, so it cannot hide a floor mechanic.
      const re = new RegExp(`(^|[^\\w.])${name.replace('.', '\\.')}\\.renderOrder\\s*=(?!\\s*-)`);
      if (re.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

function textures(): AbilityVfxTextures {
  const texture = () => new THREE.Texture();
  return {
    noise: texture(),
    ember: texture(),
    rime: texture(),
    rune: texture(),
    crack: texture(),
    char: texture(),
  } as unknown as AbilityVfxTextures;
}

describe('floor VFX ladder (core)', () => {
  it('pins the four bands, bottom to top, with the orders they own', () => {
    expect(FLOOR_VFX_LAYERS).toEqual(['ground', 'player', 'encounter', 'reticle']);
    expect(FLOOR_VFX_LAYER_BASE).toEqual({ ground: 1, player: 10, encounter: 20, reticle: 50 });
    expect(FLOOR_VFX_LAYER_SPAN).toEqual({ ground: 8, player: 10, encounter: 30, reticle: 4 });
  });

  it('keeps the bands disjoint and ordered: every rung of a band paints under the next band', () => {
    for (let i = 1; i < FLOOR_VFX_LAYERS.length; i++) {
      const below = FLOOR_VFX_LAYERS[i - 1];
      const above = FLOOR_VFX_LAYERS[i];
      expect(floorVfxLayerTopOrder(below)).toBeLessThan(floorVfxRenderOrder(above, 0));
    }
    // The objective in one line: no player rung reaches any encounter rung.
    expect(floorVfxLayerTopOrder('player')).toBeLessThan(floorVfxRenderOrder('encounter', 0));
    // The ladder sits above the water surface (0) and the world's default band.
    expect(floorVfxRenderOrder('ground', 0)).toBeGreaterThan(0);
  });

  it('gives the encounter band room for the legacy-minus-one rule up to the judgment cue beams', () => {
    // The highest order any boss module shipped with before the ladder was the
    // forge judgment cue beams at 30; legacy minus one is step 29, the top rung.
    expect(floorVfxRenderOrder('encounter', 29)).toBe(floorVfxLayerTopOrder('encounter'));
  });

  it('steps inside a band and clamps at its top instead of crossing into the next band', () => {
    expect(floorVfxRenderOrder('encounter')).toBe(20);
    expect(floorVfxRenderOrder('encounter', 3)).toBe(23);
    expect(floorVfxRenderOrder('encounter', 29)).toBe(49);
    expect(floorVfxRenderOrder('encounter', 30)).toBe(49);
    expect(floorVfxRenderOrder('encounter', 1000)).toBe(floorVfxLayerTopOrder('encounter'));
    expect(floorVfxRenderOrder('player', 9)).toBe(19);
    expect(floorVfxRenderOrder('player', 10)).toBe(19);
    expect(floorVfxRenderOrder('reticle', 3)).toBe(53);
    expect(floorVfxRenderOrder('reticle', 4)).toBe(53);
  });

  it('treats a negative, fractional, or non-finite step as the bottom rung or its floor', () => {
    expect(floorVfxRenderOrder('player', -3)).toBe(10);
    expect(floorVfxRenderOrder('player', 2.9)).toBe(12);
    expect(floorVfxRenderOrder('player', Number.NaN)).toBe(10);
    expect(floorVfxRenderOrder('player', Number.POSITIVE_INFINITY)).toBe(10);
  });

  it('classifies an order back to its band, and nothing outside the ladder', () => {
    for (const layer of FLOOR_VFX_LAYERS) {
      expect(floorVfxLayerOf(floorVfxRenderOrder(layer, 0))).toBe(layer);
      expect(floorVfxLayerOf(floorVfxLayerTopOrder(layer))).toBe(layer);
    }
    expect(floorVfxLayerOf(0)).toBeNull();
    expect(floorVfxLayerOf(-1)).toBeNull();
    expect(floorVfxLayerOf(9)).toBeNull();
    expect(floorVfxLayerOf(9990)).toBeNull();
  });
});

describe('applyFloorVfxLayer (painter)', () => {
  it('sets the rung on every renderable leaf and resets every Group so groupOrder cannot hijack', () => {
    const root = new THREE.Group();
    root.renderOrder = 3;
    const inner = new THREE.Group();
    inner.renderOrder = 7;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    const line = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    inner.add(mesh, points);
    root.add(inner, line, sprite);

    const applied = applyFloorVfxLayer(root, 'encounter', 4);

    expect(applied).toBe(24);
    expect(root.renderOrder).toBe(0);
    expect(inner.renderOrder).toBe(0);
    expect(mesh.renderOrder).toBe(24);
    expect(points.renderOrder).toBe(24);
    expect(line.renderOrder).toBe(24);
    expect(sprite.renderOrder).toBe(24);
  });

  it('applies to a bare renderable root as well', () => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    expect(applyFloorVfxLayer(mesh, 'reticle')).toBe(50);
    expect(mesh.renderOrder).toBe(50);
  });

  it('three.js promotes a Group renderOrder to groupOrder, which is why the ladder lives on leaves', () => {
    // Pin the engine fact the painter is built around, from three's own source,
    // so a three bump that changes it fails here instead of in a raid.
    const source = readFileSync(
      join(repoRoot, 'node_modules', 'three', 'build', 'three.module.js'),
      'utf8',
    );
    expect(source).toMatch(/if \( object\.isGroup \) \{\s*groupOrder = object\.renderOrder;/);
  });
});

describe('floor VFX module registry', () => {
  it('lists only files that exist, each once, with the out-of-scope list disjoint from it', () => {
    const registered = FLOOR_VFX_LAYERED_MODULES.map((m) => m.file);
    const missing = [...registered, ...FLOOR_VFX_OUT_OF_SCOPE].filter(
      (f) => !existsSync(join(repoRoot, f)),
    );
    expect(missing).toEqual([]);
    expect(new Set(registered).size).toBe(registered.length);
    expect(new Set(FLOOR_VFX_OUT_OF_SCOPE).size).toBe(FLOOR_VFX_OUT_OF_SCOPE.length);
    expect(FLOOR_VFX_OUT_OF_SCOPE.filter((f) => registered.includes(f))).toEqual([]);
  });

  it('every registered module imports the seam and names only the bands it is registered for', () => {
    const violations: string[] = [];
    for (const { file, layer, alsoNames = [] } of FLOOR_VFX_LAYERED_MODULES) {
      const source = readFileSync(join(repoRoot, file), 'utf8');
      if (!SEAM_IMPORT_RE.test(source)) violations.push(`${file}: does not import floor_vfx_layer`);
      const named = new Set<string>();
      for (const match of source.matchAll(LAYER_CALL_RE)) named.add(match[1] ?? match[2]);
      if (named.size === 0) violations.push(`${file}: never calls the seam`);
      const allowed = new Set<string>([layer, ...alsoNames]);
      for (const other of named) {
        if (!allowed.has(other)) {
          violations.push(`${file}: names band '${other}', registered as '${layer}'`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('strict modules leave no bare integer renderOrder literal', () => {
    const violations: string[] = [];
    for (const { file, strict } of FLOOR_VFX_LAYERED_MODULES) {
      if (!strict) continue;
      const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (BARE_LITERAL_RE.test(line)) violations.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });

  // COMPLETENESS: a render module that sets a bare renderOrder is either on the
  // ladder or named out of scope with a reason. Nothing else may set one.
  it('every src/render module with a bare renderOrder is registered or named out of scope', () => {
    const registered = new Set(FLOOR_VFX_LAYERED_MODULES.map((m) => m.file));
    const outOfScope = new Set(FLOOR_VFX_OUT_OF_SCOPE);
    const unaccounted: string[] = [];
    const stale: string[] = [];
    for (const file of renderSourceFiles()) {
      const hasLiteral = BARE_LITERAL_RE.test(readFileSync(join(repoRoot, file), 'utf8'));
      if (hasLiteral && !registered.has(file) && !outOfScope.has(file)) unaccounted.push(file);
      if (!hasLiteral && outOfScope.has(file)) stale.push(file);
    }
    expect(
      unaccounted,
      'a render module sets a bare renderOrder: put it on the ladder (FLOOR_VFX_LAYERED_MODULES) or name it in FLOOR_VFX_OUT_OF_SCOPE with a reason',
    ).toEqual([]);
    expect(stale, 'out-of-scope entries with no bare renderOrder left: remove them').toEqual([]);
  });

  // The Group trap, repo-wide: a Group renderOrder becomes three's groupOrder and
  // outranks every rung, so the known pre-existing carriers are pinned and the
  // list may only shrink.
  it('no src/render module puts a renderOrder on a Group beyond the pinned pre-existing carriers', () => {
    const known = new Set(KNOWN_GROUP_ORDER_FILES);
    const offenders: string[] = [];
    const carriers = new Set<string>();
    for (const file of renderSourceFiles()) {
      const hits = groupOrderAssignments(file);
      if (hits.length === 0) continue;
      carriers.add(file);
      if (!known.has(file)) offenders.push(...hits);
    }
    expect(
      offenders,
      'a Group renderOrder outranks the whole floor ladder: put the order on the leaves (applyFloorVfxLayer)',
    ).toEqual([]);
    const gone = [...known].filter((f) => !carriers.has(f));
    expect(gone, 'pinned carriers that no longer carry a Group order: drop them').toEqual([]);
  });
});

describe('floor VFX ladder (end to end on the real builders)', () => {
  /** A live player scene: the three pooled ground families, a consecration, a meteor. */
  function playerScene(): THREE.Scene {
    const scene = new THREE.Scene();
    new GroundDecals(scene, textures(), () => 0);
    new GroundAuras(scene, textures());
    new ShockRings(scene, textures(), () => 0);
    const consecration = new PaladinConsecrationVisuals(scene, () => 2);
    consecration.sync([
      { id: 'consecration:1:20', x: 4, z: 7, radius: 6, duration: 9, remaining: 4 },
    ]);
    const mage = new MageGroundFx(scene, () => 0, vi.fn());
    mage.spawnMeteor({ x: 4, z: 7, radius: 2.4, duration: 3, showTelegraph: true });
    return scene;
  }

  /**
   * The FLOOR pieces of that scene: the pooled family meshes (direct scene
   * children), the consecration subtree, and the meteor's ground telegraph. The
   * falling meteor body is airborne and deliberately outside the ladder.
   */
  function playerFloorRoots(scene: THREE.Scene): THREE.Object3D[] {
    const pooled = scene.children.filter((child) => (child as THREE.Mesh).isMesh);
    const consecration = scene.getObjectByName('paladin-consecration');
    const telegraph = scene.getObjectByName('mage-meteor-telegraph');
    expect(pooled.length).toBeGreaterThan(0);
    expect(consecration).toBeDefined();
    expect(telegraph).toBeDefined();
    return [...pooled, consecration as THREE.Object3D, telegraph as THREE.Object3D];
  }

  function encounterRoots(): THREE.Object3D[] {
    return [
      buildIgnivarSoakTelegraph(),
      buildIgnivarFrontalTelegraph(),
      buildNythraxisBindingSigilPrewarmVisual(),
      buildVarkhulFrontalVisual(),
    ];
  }

  it('every boss telegraph renderable paints over every player ground renderable', () => {
    const player = playerFloorRoots(playerScene()).flatMap(renderOrders);
    const encounter = encounterRoots().flatMap(renderOrders);
    expect(player.length).toBeGreaterThan(10);
    expect(encounter.length).toBeGreaterThan(10);
    expect(Math.min(...encounter)).toBeGreaterThan(Math.max(...player));
  });

  it('classifies every floor renderable of each side into its own band', () => {
    for (const order of playerFloorRoots(playerScene()).flatMap(renderOrders)) {
      expect(floorVfxLayerOf(order), `player order ${order}`).toBe('player');
    }
    for (const order of encounterRoots().flatMap(renderOrders)) {
      expect(floorVfxLayerOf(order), `encounter order ${order}`).toBe('encounter');
    }
  });

  it('leaves every Group at renderOrder 0 so groupOrder never outranks the ladder', () => {
    for (const root of [playerScene(), ...encounterRoots()]) {
      const offenders = groupOrders(root).filter((order) => order !== 0);
      expect(offenders, `${root.name} has Groups carrying an order`).toEqual([]);
    }
  });

  it("puts a boss or world meteor warning on the encounter band and the mage's own Meteor on the player band", () => {
    const telegraphOrders = (spawn: Parameters<MageGroundFx['spawnMeteor']>[0]): number[] => {
      const scene = new THREE.Scene();
      const fx = new MageGroundFx(scene, () => 0, vi.fn());
      fx.spawnMeteor(spawn);
      const telegraph = scene.getObjectByName('mage-meteor-telegraph');
      expect(telegraph).toBeDefined();
      const orders = renderOrders(telegraph as THREE.Object3D);
      expect(orders.length).toBeGreaterThan(3);
      return orders;
    };
    const own = telegraphOrders({ x: 0, z: 0, radius: 3, duration: 3, showTelegraph: true });
    const world = telegraphOrders({
      x: 0,
      z: 0,
      radius: 3,
      duration: 3,
      showTelegraph: true,
      persistentId: 'ignivar-meteor:1',
    });
    const grave = telegraphOrders({
      x: 0,
      z: 0,
      radius: 3,
      duration: 3,
      showTelegraph: true,
      ability: NYTHRAXIS_GRAVE_ERUPTION_CAST_ID,
    });
    for (const order of own) expect(floorVfxLayerOf(order), `own ${order}`).toBe('player');
    for (const order of world) expect(floorVfxLayerOf(order), `world ${order}`).toBe('encounter');
    for (const order of grave) expect(floorVfxLayerOf(order), `grave ${order}`).toBe('encounter');
    // The same rungs in either band: the stack does not change shape with the caller.
    const shape = (orders: number[]) => orders.map((o) => o - Math.min(...orders)).sort();
    expect(shape(world)).toEqual(shape(own));
  });

  it("puts a boss sigil flare or a mob windup rune on the encounter band and the mage's own Rune of Power on the player band", () => {
    const runeOrders = (spawn: RuneCircleSpawn): number[] => {
      const scene = new THREE.Scene();
      const fx = new MageGroundFx(scene, () => 0, vi.fn());
      fx.spawnRune(spawn);
      const rune = scene.getObjectByName('mage-rune-power');
      expect(rune).toBeDefined();
      const orders: number[] = [];
      (rune as THREE.Object3D).traverse((object) => {
        // the terrain-draped inscription (rings, spokes, glow); the orbiting
        // motes are airborne spheres and deliberately outside the ladder
        if (isRenderable(object) && object.name.startsWith('mage-rune-power-')) {
          orders.push(object.renderOrder);
        }
      });
      expect(orders.length).toBeGreaterThan(3);
      return orders;
    };
    // The player arm keys off the ability catalog: pin the anchor it relies on.
    expect(ABILITIES.rune_of_power).toBeDefined();
    expect(ABILITIES[NYTHRAXIS_SIGIL_CAST_ID]).toBeUndefined();
    const own = runeOrders({
      x: 0,
      z: 0,
      radius: 8,
      duration: 15,
      school: 'arcane',
      ability: 'rune_of_power',
    });
    const sigil = runeOrders({
      x: 0,
      z: 0,
      radius: 6,
      duration: 4,
      school: 'arcane',
      ability: NYTHRAXIS_SIGIL_CAST_ID,
    });
    // a rift mob's stomp or pulse windup arrives with a school and no ability
    const windup = runeOrders({ x: 0, z: 0, radius: 5, duration: 3, school: 'fire' });
    for (const order of own) expect(floorVfxLayerOf(order), `own ${order}`).toBe('player');
    for (const order of sigil) expect(floorVfxLayerOf(order), `sigil ${order}`).toBe('encounter');
    for (const order of windup) expect(floorVfxLayerOf(order), `windup ${order}`).toBe('encounter');
    // The same rungs in either band: the stack does not change shape with the caller.
    const shape = (orders: number[]) => orders.map((o) => o - Math.min(...orders)).sort();
    expect(shape(sigil)).toEqual(shape(own));
    expect(shape(windup)).toEqual(shape(own));
    // The rule itself, so a new emitter can be checked without a scene.
    expect(runeCircleLayer('rune_of_power')).toBe('player');
    expect(runeCircleLayer(NYTHRAXIS_SIGIL_CAST_ID)).toBe('encounter');
    expect(runeCircleLayer(undefined)).toBe('encounter');
  });

  it('keeps the ground aim reticle above the encounter band, additive so it hides nothing', () => {
    const scene = new THREE.Scene();
    const reticle = new GroundAimReticleVisual(scene, () => 0, 1);
    const orders = renderOrders(reticle.group);
    expect(orders.length).toBeGreaterThan(0);
    for (const order of orders) expect(floorVfxLayerOf(order)).toBe('reticle');
    expect(Math.min(...orders)).toBeGreaterThan(floorVfxLayerTopOrder('encounter'));
    reticle.group.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) expect(material.blending).toBe(THREE.AdditiveBlending);
    });
  });
});

describe('floor VFX ladder (every encounter builder, built cold)', () => {
  /**
   * Every no-argument encounter builder and prewarm visual: the whole boss
   * floor, the way the prewarm pass and the live syncs build it. A telegraph
   * piece that sets no order at all is invisible to the bare-literal sweep
   * above (the Forgefather sweep shipped that way), so this is the guard that
   * catches it: every flat, ground-hugging renderable must classify as
   * encounter. A new boss floor builder joins this list.
   */
  const ENCOUNTER_BUILDERS: ReadonlyArray<readonly [string, () => THREE.Object3D]> = [
    ['ignivar brand telegraph', buildIgnivarBrandTelegraph],
    ['ignivar skyfire telegraph', buildIgnivarSkyfireTelegraph],
    ['ignivar encounter prewarm', buildIgnivarEncounterPrewarmVisual],
    ['ignivar forge judgment', buildIgnivarForgeJudgmentVisual],
    ['ignivar forge judgment prewarm', buildIgnivarForgeJudgmentPrewarmVisual],
    ['ignivar forge wave', buildIgnivarForgeWaveVisual],
    ['ignivar frontal telegraph', buildIgnivarFrontalTelegraph],
    ['ignivar rotating rays telegraph', buildIgnivarRotatingRaysTelegraph],
    ['ignivar rotating rays prewarm', buildIgnivarRotatingRaysPrewarmVisual],
    ['ignivar soak telegraph', () => buildIgnivarSoakTelegraph()],
    ['ignivar ground fire AoE stand-in', buildGroundFireAoeStandIn],
    ['varkhul assembly prewarm', buildVarkhulAssemblyPrewarmVisual],
    ['varkhul cinder orbs telegraph', buildVarkhulCinderOrbsTelegraph],
    ['varkhul makers brand telegraph', buildVarkhulMakersBrandTelegraph],
    ['varkhul encounter prewarm', buildVarkhulEncounterPrewarmVisual],
    ['varkhul forgefather sweep', buildVarkhulFrontalVisual],
    ['varkhul forge beam prewarm', buildVarkhulForgeBeamPrewarmVisual],
    ['varkhul tempering ray prewarm', buildVarkhulInterceptBeamPrewarmVisual],
    ['varkhul worldfire prewarm', buildVarkhulWorldfirePrewarmVisual],
    ['nythraxis bound cage prewarm', buildNythraxisBoundCagePrewarmVisual],
    ['nythraxis grave prewarm', buildNythraxisGravePrewarmVisual],
    ['nythraxis gravefire prewarm', buildNythraxisGravefirePrewarmVisual],
    ['nythraxis binding sigil prewarm', buildNythraxisBindingSigilPrewarmVisual],
    ['nythraxis soul rend marker', buildNythraxisSoulRendMarker],
    ['nythraxis soul rend marker prewarm', buildNythraxisSoulRendMarkerPrewarmVisual],
  ];

  /**
   * A floor piece: the renderable's OWN geometry, in world space, is no taller
   * than a draped disc, ring, line or thin slab, and hugs the builder's ground
   * (every builder here stages at y 0). Vertical pieces (cones, beams, spires,
   * the airborne crown of a marker) are outside the ladder's concern.
   */
  const FLOOR_PIECE_MAX_HEIGHT = 0.25;
  const FLOOR_PIECE_MAX_LIFT = 0.3;
  const box = new THREE.Box3();

  /**
   * The forge chain is a body-height tether between two chained players; its
   * cold build lays the beam at the origin until the live sync lifts it to
   * chest height, so it is the one subtree the floor rule must skip.
   */
  const NOT_A_FLOOR_SUBTREE = new Set<string>([IGNIVAR_FORGE_CHAIN_VISUAL_NAME]);

  function isFloorPiece(object: THREE.Object3D): boolean {
    const instanced = object as THREE.InstancedMesh;
    if (instanced.isInstancedMesh) {
      // the instance transforms place the pieces (rings up a column, embers
      // around a rune), so the box must include them
      instanced.computeBoundingBox();
      box.copy(instanced.boundingBox as THREE.Box3).applyMatrix4(object.matrixWorld);
    } else {
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (!geometry?.getAttribute('position')) return false;
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      box.copy(geometry.boundingBox as THREE.Box3).applyMatrix4(object.matrixWorld);
    }
    if (box.isEmpty()) return false;
    return box.max.y - box.min.y <= FLOOR_PIECE_MAX_HEIGHT && box.min.y <= FLOOR_PIECE_MAX_LIFT;
  }

  function floorPieces(root: THREE.Object3D): Array<{ name: string; order: number }> {
    root.updateMatrixWorld(true);
    const pieces: Array<{ name: string; order: number }> = [];
    const walk = (object: THREE.Object3D): void => {
      if (NOT_A_FLOOR_SUBTREE.has(object.name)) return;
      if (isRenderable(object) && isFloorPiece(object)) {
        pieces.push({ name: object.name || object.type, order: object.renderOrder });
      }
      for (const child of object.children) walk(child);
    };
    walk(root);
    return pieces;
  }

  it('every flat, ground-hugging renderable of every builder rides the encounter band', () => {
    const offenders: string[] = [];
    const counted = new Map<string, number>();
    for (const [label, build] of ENCOUNTER_BUILDERS) {
      const pieces = floorPieces(build());
      counted.set(label, pieces.length);
      for (const piece of pieces) {
        if (floorVfxLayerOf(piece.order) !== 'encounter') {
          offenders.push(`${label}: ${piece.name} at renderOrder ${piece.order}`);
        }
      }
    }
    // The classes the review found, so the guard is known to see them.
    for (const label of [
      'varkhul forgefather sweep',
      'varkhul tempering ray prewarm',
      'ignivar skyfire telegraph',
      'ignivar forge wave',
      'varkhul assembly prewarm',
      'ignivar forge judgment',
      'nythraxis grave prewarm',
      'ignivar soak telegraph',
    ]) {
      expect(counted.get(label), `${label} has floor pieces`).toBeGreaterThan(0);
    }
    expect(
      offenders,
      "a boss floor piece sits outside the encounter band: give it floorVfxRenderOrder('encounter', step)",
    ).toEqual([]);
  });

  it('leaves every Group of every builder at renderOrder 0 so groupOrder never outranks the ladder', () => {
    for (const [label, build] of ENCOUNTER_BUILDERS) {
      const offenders = groupOrders(build()).filter((order) => order !== 0);
      expect(offenders, `${label} has Groups carrying an order`).toEqual([]);
    }
  });
});
