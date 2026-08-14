// The host-agnostic visual decisions behind the farm patch renderer: which
// mesh a plot shows, how wet its soil reads, what colour its crop takes, and
// where a patch's compost bin stands. No three.js, no DOM, no clock of its
// own: every function is pure over (plot, nowMs) or over a FarmPatchDef, so a
// Node Vitest drives every arm directly (tests/farm_patches_core.test.ts).
//
// FAIRNESS: a growth stage is ACTIONABLE information (a player walks to a bed
// because it looks ready), so nothing here takes a graphics tier, a preset or
// a governor reading as an input. There is deliberately no quality parameter
// in any signature; the shed lives entirely in the cosmetic VFX, which emit
// through vfx.ts and its scaledCount path.
//
// CLOCK BASE: `nowMs` must come from IWorld.farmNowMs(), the authority's own
// lockoutNowMs base. This module never reads a clock, so it cannot mix bases;
// it is the caller's job not to hand it Date.now against an offline plot.
// The stage function comes from the sim leaf that defines it (a pure core may
// import src/sim; the IWorld seam itself may not re-export a sim VALUE, which
// is why this is not a single import from the facet). The view types come
// through the facet, which is the seam render code reads plots on.
import { farmGrowthStage } from '../sim/professions/farm_projection';
import type { FarmPatchDef, FarmPlotStatus, FarmPlotView } from '../world_api/farming';

/**
 * The three crop silhouettes the art carries. Eight crops share three model
 * families rather than shipping eight sets of stage meshes: a stalk crop, a
 * leafy or root crop, and a fruiting vine. Per-crop identity comes from the
 * accent tint below, not from geometry.
 */
export type FarmCropFamily = 'grain' | 'rootleaf' | 'gourd';

/** The stage mesh mounted in a bed's soil socket. */
export type FarmStageMesh = 'sprout' | 'stage2' | 'stage3' | 'stage4' | 'withered';

/**
 * How freshly watered the soil reads: 2 just after planting, 1 for the first
 * hour, 0 afterwards. BANDED rather than continuous on purpose, so the plot
 * signature (and with it the rebuild check) changes twice per crop cycle
 * instead of every frame.
 */
export type FarmWetBand = 0 | 1 | 2;

/** Every crop's model family. Exhaustive over FARM_CROPS by test: a ninth
 *  crop must red tests/farm_patches_core.test.ts rather than quietly take the
 *  resolver's fallback. */
export const FARM_CROP_FAMILY: Readonly<Record<string, FarmCropFamily>> = Object.freeze({
  vale_wheat: 'grain',
  marsh_rice: 'grain',
  highland_barley: 'grain',
  brook_carrot: 'rootleaf',
  bog_beet: 'rootleaf',
  evergarden_greens: 'rootleaf',
  frost_gourd: 'gourd',
  gilded_sunmelon: 'gourd',
});

/** The tint multiplied into the stage mesh's `crop_accent` material, which is
 *  what tells two crops of one family apart at gameplay camera range. Also
 *  exhaustive over FARM_CROPS by test. */
export const FARM_CROP_ACCENT: Readonly<Record<string, number>> = Object.freeze({
  vale_wheat: 0xe8c66a, // warm gold
  brook_carrot: 0xe07a2a, // orange
  marsh_rice: 0xbcd6a8, // pale jade
  bog_beet: 0xa42440, // crimson
  highland_barley: 0xd9a441, // amber
  frost_gourd: 0x9ec8e4, // ice blue
  gilded_sunmelon: 0xf0a83c, // gold-orange
  evergarden_greens: 0x2f6b34, // deep green
});

/** The fallback family a crop id with no row takes. Reachable only from a
 *  save or a wire frame naming a crop this build does not know. */
export const FARM_FALLBACK_FAMILY: FarmCropFamily = 'grain';
/** The fallback accent, paired with FARM_FALLBACK_FAMILY. */
export const FARM_FALLBACK_ACCENT = 0xcfcfcf;

export function farmCropFamily(cropId: string): FarmCropFamily {
  return FARM_CROP_FAMILY[cropId] ?? FARM_FALLBACK_FAMILY;
}

export function farmCropAccent(cropId: string): number {
  return FARM_CROP_ACCENT[cropId] ?? FARM_FALLBACK_ACCENT;
}

/** A patch's local colour grade: the bed soil, the frame timber, and the trim
 *  the higher tiers show. Multiplied into the shared bed material, so one
 *  model reads as four different gardens. */
export interface FarmBiomePalette {
  /** Multiplied into the bed's soil surface. */
  readonly soil: number;
  /** Multiplied into the bed's timber frame. */
  readonly wood: number;
  /** Multiplied into the bed's trim and the patch's compost bin. */
  readonly trim: number;
}

/** Keyed by FarmPatchDef.zoneId, exhaustive over FARM_PATCHES by test. */
export const FARM_BIOME_PALETTES: Readonly<Record<string, FarmBiomePalette>> = Object.freeze({
  // the Eastbrook allotments: warm loam under fresh, new-cut timber
  eastbrook_vale: Object.freeze({ soil: 0xa87a52, wood: 0xc4a274, trim: 0xd8c69a }),
  // the Mirefen beds: dark wet peat, moss creeping up the frames
  mirefen_marsh: Object.freeze({ soil: 0x5c5140, wood: 0x7c8460, trim: 0x93a074 }),
  // the Thornpeak terraces: cold grey alpine grit and weathered timber
  thornpeak_heights: Object.freeze({ soil: 0x8a8578, wood: 0x9aa0a4, trim: 0xb4bcc0 }),
  // the Evergarden parterre: manicured beds with warm white trim
  evergarden: Object.freeze({ soil: 0x8c7a5e, wood: 0xd6c9ae, trim: 0xf2ece0 }),
});

/** The palette a patch with no row takes (the neutral vale grade). */
export const FARM_FALLBACK_PALETTE: FarmBiomePalette = Object.freeze({
  soil: 0x8a7a62,
  wood: 0xb0a084,
  trim: 0xc8bca4,
});

export function farmBiomePalette(zoneId: string): FarmBiomePalette {
  return FARM_BIOME_PALETTES[zoneId] ?? FARM_FALLBACK_PALETTE;
}

// The wet-band edges, in ms since planting.
export const FARM_WET_BAND_2_MS = 10 * 60 * 1000;
export const FARM_WET_BAND_1_MS = 60 * 60 * 1000;

/** Everything the adapter needs to build or update one plot's meshes. */
export interface FarmPlotVisual {
  readonly family: FarmCropFamily;
  readonly stageMesh: FarmStageMesh;
  readonly wetBand: FarmWetBand;
  readonly accent: number;
}

/**
 * How freshly watered a plot's soil reads. A plot planted in the future (a
 * clock the caller should not have handed us) reads as freshly watered rather
 * than dry, which is the harmless direction.
 *
 * DELIBERATELY keyed off plantedAtMs alone, never off status or readyAtMs: the
 * soil dries on its own schedule, so a bed left ready for a week reads DRY
 * rather than freshly turned. That is the intended reading (the plot is old,
 * and looks it) and it also keeps the band monotonic, so the rebuild key can
 * only move forward through 2, 1, 0 across a crop's life.
 */
export function farmWetBand(plot: Pick<FarmPlotView, 'plantedAtMs'>, nowMs: number): FarmWetBand {
  const age = nowMs - plot.plantedAtMs;
  if (age < FARM_WET_BAND_2_MS) return 2;
  if (age < FARM_WET_BAND_1_MS) return 1;
  return 0;
}

/**
 * The mesh a plot shows. `withered` and `ready` come from the AUTHORITY's own
 * status field, never from the elapsed fraction: the hidden survival pre-roll
 * means a doomed crop looks healthy until its ready time, and a plot that has
 * passed its deadline stays ready forever (the anti-chore invariant). The
 * fraction only picks between the three growing meshes.
 */
export function farmStageMesh(plot: FarmPlotView, nowMs: number): FarmStageMesh {
  if (plot.status === 'withered') return 'withered';
  if (plot.status === 'ready') return 'stage4';
  switch (farmGrowthStage(plot, nowMs)) {
    case 'ready':
      return 'stage4';
    case 'maturing':
      return 'stage3';
    case 'seedling':
      return 'stage2';
    default:
      return 'sprout';
  }
}

export function resolveFarmPlotVisual(plot: FarmPlotView, nowMs: number): FarmPlotVisual {
  return {
    family: farmCropFamily(plot.cropId),
    stageMesh: farmStageMesh(plot, nowMs),
    wetBand: farmWetBand(plot, nowMs),
    accent: farmCropAccent(plot.cropId),
  };
}

/**
 * The rebuild key, as FIELDS rather than a minted string. Everything that
 * changes what is drawn is here, and nothing that does not: the raw timestamps
 * are absent by design, since the banded stage and the banded wetness are the
 * only things the render reads them for. The bed id is absent too, because the
 * adapter keys its live plots by bed already.
 *
 * Fields, not a string, because the comparison runs on the sync path: a live
 * plot record satisfies this structurally, so a steady-state check allocates
 * NOTHING (a signature string would mint one per plot per sync).
 */
export interface FarmPlotVisualKey {
  readonly cropId: string;
  readonly stageMesh: FarmStageMesh;
  readonly wetBand: FarmWetBand;
  readonly status: FarmPlotStatus;
}

/**
 * Whether an already-built plot is still correct for this row at this instant.
 * True means the adapter rebuilds nothing.
 */
export function farmPlotKeyMatches(
  key: FarmPlotVisualKey,
  plot: FarmPlotView,
  nowMs: number,
): boolean {
  return (
    key.cropId === plot.cropId &&
    key.status === plot.status &&
    key.stageMesh === farmStageMesh(plot, nowMs) &&
    key.wetBand === farmWetBand(plot, nowMs)
  );
}

// The 15 authored GLBs, all under public/models/props/.
export const FARM_BED_MODEL_URL = '/models/props/farm_bed.glb';
export const FARM_SPROUT_MODEL_URL = '/models/props/farm_sprout.glb';
export const FARM_COMPOST_BIN_MODEL_URL = '/models/props/farm_compost_bin.glb';

/** The node in farm_bed.glb the stage meshes mount at. */
export const FARM_SOIL_SOCKET_NAME = 'Socket_Soil';
/** The mesh in a stage3/stage4 GLB whose material takes the per-crop accent. */
export const FARM_ACCENT_MESH_NAME = 'CropAccent';
/** That mesh's material name, so a clone can be found without relying on the
 *  mesh name surviving the exporter's merge. */
export const FARM_ACCENT_MATERIAL_NAME = 'crop_accent';

/** The stage GLB for one family, or null for the family-independent sprout
 *  (every crop shares one seedling model at that size). */
export function farmStageModelUrl(family: FarmCropFamily, stage: FarmStageMesh): string {
  if (stage === 'sprout') return FARM_SPROUT_MODEL_URL;
  return `/models/props/farm_${family}_${stage}.glb`;
}

/** Every GLB this renderer preloads, in a stable order. */
export function farmModelUrls(): string[] {
  const families: FarmCropFamily[] = ['grain', 'rootleaf', 'gourd'];
  const stages: FarmStageMesh[] = ['stage2', 'stage3', 'stage4', 'withered'];
  const urls = [FARM_BED_MODEL_URL, FARM_SPROUT_MODEL_URL, FARM_COMPOST_BIN_MODEL_URL];
  for (const family of families) {
    for (const stage of stages) urls.push(farmStageModelUrl(family, stage));
  }
  return urls;
}

/** How far west of the grid's west edge the compost bin stands (yd). Short of
 *  the 5 yd bed pitch, so the bin never lands where a future bed row would. */
export const FARM_COMPOST_BIN_OFFSET = 3;

/**
 * Where a patch's one compost bin stands: just outside the west edge of the
 * bed grid, on the first row's line. Pure and deterministic (no rng, no
 * clock), so the bin is in the same place on every host and every session.
 */
export function farmCompostBinPosition(patch: FarmPatchDef): { x: number; z: number } {
  if (patch.beds.length === 0) return { x: patch.x, z: patch.z };
  let minX = patch.beds[0].x;
  for (const bed of patch.beds) {
    if (bed.x < minX) minX = bed.x;
  }
  // Beds fill row by row from the north-west, so beds[0] IS the first row.
  return { x: minX - FARM_COMPOST_BIN_OFFSET, z: patch.beds[0].z };
}
