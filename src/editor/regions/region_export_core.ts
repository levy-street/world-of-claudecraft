// Region map -> generated module. Pure: no DOM, no filesystem, no three.
//
// Shared by the dev-server endpoint (/__region_map/save) and the CLI
// (scripts/gen_region_map.mjs) so both write byte-identical modules, the same
// arrangement scripts/lib/collision_overrides_emit.mjs uses for Collision
// Master.
//
// The split is the whole idea. A region map holds two kinds of object and they
// leave through different doors:
//
//   tagged     the game-mode anchors (regionRole) go back into the region's
//              RECORD, because the mode logic, the minimap and the graveyard
//              code read positions, not models.
//   untagged   everything else - kit modules and collider volumes - is the
//              region's art and collision, and ships as placements.
//
// Cover, walls, crates and rubble are deliberately NOT in the record any more:
// on an authored region they are ordinary placements that draw themselves and
// block with their own collision, so there is exactly one thing to move when
// the maker wants a wall somewhere else.

import type { BgBaseDef, BgGraveyardPlot, BgTeam } from '../../sim/battleground_layout';
import { isColliderAssetId } from '../../sim/collider_volumes';
import type { MapPlacement, RegionId } from '../../sim/map_doc';
import { type AuthoredRegionLayout, REGION_KIT_PREFIX } from '../../sim/regions/authored_region';

export interface RegionMapSource {
  regionSource?: RegionId;
  placements?: readonly MapPlacement[];
}

export interface RegionExport {
  regionId: RegionId;
  layout: AuthoredRegionLayout;
  placements: MapPlacement[];
}

/** Field the export accepts, generously past the perimeter so the tree line
 *  and other outside dressing still fit. */
const MAX_ABS_X = 120;
const MAX_ABS_Z = 220;
const MAX_PLACEMENTS = 6000;

const round = (v: number, places = 4): number => {
  const p = 10 ** places;
  return Math.round(v * p) / p;
};

const pt = (p: { x: number; z: number }): { x: number; z: number } => ({
  x: round(p.x),
  z: round(p.z),
});

function byRole(placements: readonly MapPlacement[], role: string): MapPlacement[] {
  return placements.filter((p) => p.regionRole === role);
}

/**
 * Split a region map into the record + placements a generated module carries.
 * Throws on anything the region could not actually run; the caller surfaces
 * the message, because a half-valid region is worse than a refused export.
 */
export function regionExportFromMap(map: RegionMapSource): RegionExport {
  const regionId = map.regionSource;
  if (!regionId) throw new Error('not a region map (no regionSource)');
  const all = map.placements ?? [];
  if (all.length > MAX_PLACEMENTS) {
    throw new Error(`too many placements: ${all.length} (max ${MAX_PLACEMENTS})`);
  }

  const bases: BgBaseDef[] = [];
  for (const team of [0, 1] as const) {
    const flag = byRole(all, `flag${team}`);
    const banner = byRole(all, `banner${team}`);
    const spawns = byRole(all, `spawn${team}`);
    if (flag.length !== 1) {
      throw new Error(`team ${team} needs exactly one flag, found ${flag.length}`);
    }
    if (banner.length !== 1) {
      throw new Error(`team ${team} needs exactly one spawn banner, found ${banner.length}`);
    }
    if (spawns.length === 0) throw new Error(`team ${team} has no spawn points`);
    bases.push({
      team: team as BgTeam,
      flag: pt(flag[0]),
      spawns: spawns.map(pt),
      banner: pt(banner[0]),
    });
  }

  const graveyards: BgGraveyardPlot[] = [];
  for (const team of [0, 1] as const) {
    const plot = byRole(all, `graveyard${team}`);
    if (plot.length !== 1) {
      throw new Error(`team ${team} needs exactly one graveyard, found ${plot.length}`);
    }
    const p = plot[0];
    const s = p.scale > 0 ? p.scale : 1;
    // The plot is authored as a collider volume, so its extents come from the
    // volume's size the same way sim/collider_volumes.ts reads them.
    graveyards.push({
      x: round(p.x),
      z: round(p.z),
      hw: round(Math.max(1, ((p.sizeX ?? 18) * s) / 2)),
      hd: round(Math.max(1, ((p.sizeZ ?? 12) * s) / 2)),
    });
  }

  const art: MapPlacement[] = [];
  const unbuildable = new Set<string>();
  for (const p of all) {
    if (p.regionRole !== undefined) continue;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    if (Math.abs(p.x) > MAX_ABS_X || Math.abs(p.z) > MAX_ABS_Z) {
      throw new Error(`placement outside the region: ${p.assetId} at ${round(p.x)}, ${round(p.z)}`);
    }
    // A region builds kit modules and collider volumes. Anything else would
    // export happily and then be invisible in game, so refuse it here where
    // the maker can still see which object is the problem.
    if (!isColliderAssetId(p.assetId) && !p.assetId.startsWith(REGION_KIT_PREFIX)) {
      unbuildable.add(p.assetId);
      continue;
    }
    art.push(p);
  }
  if (unbuildable.size > 0) {
    const names = [...unbuildable].sort().slice(0, 6).join(', ');
    throw new Error(
      `${unbuildable.size} asset type(s) a region cannot build yet: ${names}. ` +
        `Ravenrift builds ${REGION_KIT_PREFIX}* modules and collider volumes.`,
    );
  }

  return {
    regionId,
    layout: {
      // Cover, walls and rubble are placements now: their collision and their
      // look come from the same object, so the record carries neither.
      speedRunes: byRole(all, 'speedRune').map(pt),
      powerRunes: byRole(all, 'powerRune').map(pt),
      graveyards,
      bases,
    },
    placements: art,
  };
}

/** OPTIONAL numeric placement fields, with the value that means "absent".
 *  assetId/x/z/rotY/scale/collide are required and always emitted. */
const PLACEMENT_NUMBERS: readonly (readonly [keyof MapPlacement, number])[] = [
  ['scaleX', 1],
  ['scaleY', 1],
  ['scaleZ', 1],
  ['rotX', 0],
  ['rotZ', 0],
  ['y', 0],
  ['sizeX', Number.NaN],
  ['sizeY', Number.NaN],
  ['sizeZ', Number.NaN],
  ['collideRadius', Number.NaN],
  ['tint', Number.NaN],
  ['opacity', Number.NaN],
  ['glow', Number.NaN],
  ['glowStrength', Number.NaN],
];

function placementLiteral(p: MapPlacement): string {
  const parts = [
    `assetId: '${p.assetId}'`,
    `x: ${round(p.x)}`,
    `z: ${round(p.z)}`,
    `rotY: ${round(p.rotY)}`,
    `scale: ${round(p.scale)}`,
    `collide: ${p.collide === true}`,
  ];
  for (const [key, skip] of PLACEMENT_NUMBERS) {
    const v = p[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (v === skip) continue;
    parts.push(`${key}: ${round(v)}`);
  }
  if (p.collideShape === 'square') parts.push("collideShape: 'square'");
  if (p.collisionMode !== undefined) parts.push(`collisionMode: '${p.collisionMode}'`);
  return `  { ${parts.join(', ')} },`;
}

function layoutLiteral(layout: AuthoredRegionLayout): string {
  const lines: string[] = ['  layout: {'];
  const points = (list: readonly { x: number; z: number }[]): string =>
    list.map((p) => `{ x: ${round(p.x)}, z: ${round(p.z)} }`).join(', ');
  lines.push(`    speedRunes: [${points(layout.speedRunes)}],`);
  lines.push(`    powerRunes: [${points(layout.powerRunes)}],`);
  lines.push(
    `    graveyards: [${layout.graveyards
      .map((g) => `{ x: ${round(g.x)}, z: ${round(g.z)}, hw: ${round(g.hw)}, hd: ${round(g.hd)} }`)
      .join(', ')}],`,
  );
  lines.push('    bases: [');
  for (const base of layout.bases) {
    lines.push(
      `      { team: ${base.team}, flag: { x: ${round(base.flag.x)}, z: ${round(base.flag.z)} }, ` +
        `banner: { x: ${round(base.banner.x)}, z: ${round(base.banner.z)} }, spawns: [${points(
          base.spawns,
        )}] },`,
    );
  }
  lines.push('    ],');
  lines.push('  },');
  return lines.join('\n');
}

/** Placement literals per emitted array (see the note at the call site). */
const PLACEMENTS_PER_BLOCK = 800;

function placementBlocks(placements: readonly MapPlacement[]): string[] {
  const lines: string[] = [];
  const blocks: string[] = [];
  for (let start = 0; start < placements.length; start += PLACEMENTS_PER_BLOCK) {
    const name = `PLACEMENTS_${blocks.length}`;
    blocks.push(name);
    lines.push(`const ${name}: MapPlacement[] = [`);
    for (const p of placements.slice(start, start + PLACEMENTS_PER_BLOCK)) {
      lines.push(placementLiteral(p));
    }
    lines.push('];', '');
  }
  if (blocks.length === 0) lines.push('const PLACEMENTS: MapPlacement[] = [];');
  else if (blocks.length === 1) lines.push(`const PLACEMENTS: MapPlacement[] = ${blocks[0]};`);
  else {
    lines.push(`const PLACEMENTS: MapPlacement[] = [${blocks.map((b) => `...${b}`).join(', ')}];`);
  }
  return lines;
}

/** Emit the generated module for one exported region. */
export function emitRegionModule(result: RegionExport): string {
  const lines = [
    '// GENERATED from the map editor - do not edit by hand.',
    '//',
    '// Legacy region export. Reopen the saved map document to edit it.',
    '// The current battleground uses the authored Thornhollow pipeline; the CLI',
    '// scripts/gen_region_map.mjs regenerates it from a saved map.',
    '//',
    '// layout      the anchors the game mode reads: flags, respawns, spawn',
    '//             banners, graveyard plots, rune pads. Cover and walls are NOT',
    '//             here - on an authored region they are placements that draw',
    '//             themselves and block with their own collision.',
    '// placements  the field itself, in the region’s own local coordinates.',
    '',
    "import type { MapPlacement } from '../map_doc';",
    "import type { AuthoredRegion } from './authored_region';",
    '',
    // Annotated AND chunked. A whole field of object literals in one array
    // expression exhausts the checker ("union type that is too complex to
    // represent") somewhere past ~1200 entries even with the annotation, so the
    // emit splits them into blocks it can swallow and concatenates.
    ...placementBlocks(result.placements),
    '',
    'const REGION: AuthoredRegion = {',
    layoutLiteral(result.layout),
    '  placements: PLACEMENTS,',
    '};',
    '',
    'export const RAVENRIFT_AUTHORED: AuthoredRegion | null = REGION;',
    '',
  ];
  return lines.join('\n');
}

/** The repo path a region's generated module lives at. */
export function regionModulePath(regionId: RegionId): string {
  return `src/sim/regions/${regionId}.authored.generated.ts`;
}
