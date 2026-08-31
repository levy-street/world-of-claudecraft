// Raid-only duplicates of the dungeon-kit structural modules for the Ignivar
// raid interiors. The three forge rooms re-skin their floors, walls, and
// pillars with the dark-iron ember atlas (ignivar_<kind>.glb copies of the
// shared KayKit modules); every other dungeon keeps the shared kit untouched.
// dungeon.ts owns the module registry and per-pack materials; this module owns
// the raid-side policy (which kinds swap, the load orchestration through the
// injected loader, the pack emissive treatment, and the raid floor/wall kind
// mixes). The duplicates land in their own 'ignivarKit' pack so the recolored
// source material never bleeds into the shared kit, and the resolver below is
// consulted only at the two asset-lookup funnels (emit / emitArenaHideable).
import * as THREE from 'three';
import { addRoofDarkness } from './gfx';

/** Structural kinds the Ignivar rooms place, in shipped-file order. Torches,
 *  banners, and props stay on the shared kit on purpose: only the stone
 *  changes identity. */
export const IGNIVAR_TILE_KINDS = [
  'floor_tile_large',
  'floor_tile_small',
  'wall',
  'wall_cracked',
  'wall_pillar',
  'wall_arched',
  'wall_archedwindow_gated',
  'wall_gated',
  'pillar',
  'pillar_decorated',
] as const;

/** Which raid module carries each surface's ONE shared texture; every other
 *  module is geometry-only and rides the carrier pack's material. Loaded
 *  first, so the pack material always comes from the carrier. */
export const IGNIVAR_TILE_CARRIERS = {
  ignivarFloor: 'floor_tile_large',
  ignivarWall: 'wall',
} as const;

/** The three raid-only material packs the duplicates land in. */
export type IgnivarTilePack = 'ignivarFloor' | 'ignivarWall' | 'ignivarKit';

/** The raid pack a structural kind belongs to (floor vs wall vs the swatch
 *  pillars), so each surface family shares one material and one texture. */
export function ignivarTilePack(kind: string): IgnivarTilePack {
  if (kind.startsWith('floor_')) return 'ignivarFloor';
  if (kind.startsWith('wall')) return 'ignivarWall';
  return 'ignivarKit';
}

const KIND_SET: ReadonlySet<string> = new Set(IGNIVAR_TILE_KINDS);

export const IGNIVAR_TILE_PREFIX = 'ignivar_';

/** The raid-only module name for a placement kind, or the kind unchanged for
 *  every other variant and for non-structural kinds. */
export function ignivarTileKind(variant: string, kind: string): string {
  return variant === 'ignivar' && KIND_SET.has(kind) ? IGNIVAR_TILE_PREFIX + kind : kind;
}

/** Whether an interior id is one of the three Ignivar raid rooms. */
export function isIgnivarInterior(interior: string): boolean {
  return (
    interior === 'ignivar' ||
    interior === 'ignivar_approach' ||
    interior === 'ignivar_depths' ||
    interior === 'ignivar_lift'
  );
}

// The Ignivar raid's dark-iron structural duplicates. Loaded only when one of
// the three forge rooms builds, into their own pack so the recolored source
// material never reaches the shared kit. dungeon.ts injects its module loader,
// so the duplicates land in the same moduleAssets/material registry as the kit.
let ignivarTileAssetsPromise: Promise<void> | null = null;
export function ensureIgnivarTileAssets(
  interior: string,
  loadModuleAsset: (name: string, pack: IgnivarTilePack) => Promise<void>,
): Promise<void> {
  if (!isIgnivarInterior(interior)) return Promise.resolve();
  ignivarTileAssetsPromise ??= (async () => {
    // The two texture CARRIERS load first so each raid pack's shared material
    // is always sourced from the module that actually embeds the texture; the
    // remaining modules are geometry-only and ride those materials.
    await Promise.all(
      Object.entries(IGNIVAR_TILE_CARRIERS).map(([pack, name]) =>
        loadModuleAsset(`${IGNIVAR_TILE_PREFIX}${name}`, pack as IgnivarTilePack),
      ),
    );
    const carrierNames = new Set<string>(Object.values(IGNIVAR_TILE_CARRIERS));
    await Promise.all(
      IGNIVAR_TILE_KINDS.filter((name) => !carrierNames.has(name)).map((name) =>
        loadModuleAsset(`${IGNIVAR_TILE_PREFIX}${name}`, ignivarTilePack(name)),
      ),
    );
  })();
  return ignivarTileAssetsPromise;
}

/** The raid packs' self-glow, applied by dungeon.ts when it mints a pack
 *  material (before the shared-material registration); a no-op for every
 *  non-raid pack. */
export function applyIgnivarTilePackEmissive(pack: string, mat: THREE.Material): void {
  if (pack === 'ignivarKit' || pack === 'ignivarFloor' || pack === 'ignivarWall') {
    // The forge rooms' authored iron carries its detail in the ALBEDO, and
    // their grades run dim: a faint albedo-driven self-glow keeps the tile
    // read alive in shadow and sets the ember grout luminous. Raid-only by
    // construction: this pack never serves any other interior.
    const lit = mat as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
    if (lit.map) {
      lit.emissiveMap = lit.map;
      lit.emissive = new THREE.Color(0xffffff);
      lit.emissiveIntensity = 0.34;
    }
    // The raid rooms' roof darkness rides the same pack materials: the
    // upper wall courses grade into the roof black (inert outside the
    // ignivar scene states).
    addRoofDarkness(mat);
  }
}

/** The forge rooms tile clean: the raid's authored iron flags carry the
 *  identity, so no dirt or rubble kinds break the grid. Small tiles keep
 *  a little placement variety without changing the surface. */
export const IGNIVAR_FLOOR_KIND_WEIGHTS: [name: string, weight: number][] = [
  ['floor_tile_large', 82],
  ['quad', 18],
];

/** one clean small tile: the raid kit ships no broken/weed/votive smalls */
export const IGNIVAR_FLOOR_QUAD_KIND = 'floor_tile_small';

/** The forge rooms stack a second full course on top (no stretching): plain
 *  iron wall with the occasional cracked module, doors and gates stay ground
 *  level. The hash is the caller's stable per-position draw. */
export function ignivarUpperWallKind(hash: number): string {
  return hash < 0.25 ? 'wall_cracked' : 'wall';
}
