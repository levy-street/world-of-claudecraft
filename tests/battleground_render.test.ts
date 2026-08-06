// Headless pins for the Thornhollow Fields battleground RENDER manifest
// (src/render/battleground_core.ts): the pure projection of the authored
// Thornhollow map that the Three builder (src/render/battleground.ts, via
// battleground_terrain.ts and battleground_placements.ts) instantiates
// verbatim.
//
// The field is authored art, not generated geometry, so the manifest's job is
// no longer "derive walls from a layout record": it is to hand the Three layer
// a complete, loadable, gap-free plan. These tests pin exactly that:
//   - the terrain chunk plan tiles the whole rect once, sharing seams;
//   - every asset group resolves to a GLB that exists on disk;
//   - every paint swatch resolves to a texture that exists on disk, and the
//     decoded index grid is the right size with only valid layer indices;
//   - grass is procedural and never leaks into the GLB groups;
//   - the authored lights and decals are present and their textures exist.
// A missing file here is a field that renders as holes in the live game.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { battlegroundPreloadAssetPaths } from '../src/render/battleground';
import {
  BG_DRESSING_HALF_X,
  BG_DRESSING_HALF_Z,
  BG_FIELD_HALF_X,
  BG_FIELD_HALF_Z,
  BG_GRASS_ASSET,
  BG_HEIGHT_COLS,
  BG_HEIGHT_ROWS,
  BG_TERRAIN_CELL,
  BG_TERRAIN_CHUNK,
  BG_TEXTURE_DIR,
  bgAssetGroups,
  bgFieldDecals,
  bgFieldLights,
  bgGrassPatches,
  bgPaintLookup,
  bgPaintTextureFiles,
  bgTerrainChunks,
} from '../src/render/battleground_core';
import {
  isBattlegroundOccluderAsset,
  isPrimaryBattlegroundMeshName,
} from '../src/render/battleground_placements';
import { BG_BASES, BG_HALF_X, BG_HALF_Z } from '../src/sim/battleground_layout';
import {
  TH_HEIGHT_CELL,
  TH_PAINT_CELL,
  TH_PAINT_COLS,
  TH_PAINT_ORIGIN_X,
  TH_PAINT_ORIGIN_Z,
  TH_PAINT_RLE,
  TH_PAINT_ROWS,
  TH_PAINT_SWATCHES,
  TH_PLACEMENTS,
} from '../src/sim/thornhollow_field.generated';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const publicFile = (rel: string) => `${ROOT}public/${rel}`;

describe('Thornhollow terrain plan: one gap-free tiling of the whole rect', () => {
  const chunks = bgTerrainChunks();

  it('the chunk plan covers the rect exactly once, with no gaps or overlaps', () => {
    expect(chunks.length).toBeGreaterThan(0);
    // Area accounting catches BOTH failure modes at once: a gap loses area, an
    // overlap gains it, and the rect area is fixed by the map extents.
    let area = 0;
    for (const c of chunks) {
      expect(c.maxX).toBeGreaterThan(c.minX);
      expect(c.maxZ).toBeGreaterThan(c.minZ);
      area += (c.maxX - c.minX) * (c.maxZ - c.minZ);
    }
    expect(area).toBe(2 * BG_FIELD_HALF_X * (2 * BG_FIELD_HALF_Z));
    // Column/row count follows the chunk size, and the outer edges are the rect.
    expect(Math.min(...chunks.map((c) => c.minX))).toBe(-BG_FIELD_HALF_X);
    expect(Math.min(...chunks.map((c) => c.minZ))).toBe(-BG_FIELD_HALF_Z);
    expect(Math.max(...chunks.map((c) => c.maxX))).toBe(BG_FIELD_HALF_X);
    expect(Math.max(...chunks.map((c) => c.maxZ))).toBe(BG_FIELD_HALF_Z);
    // The manifest's extents ARE the sim's, so the drawn ground and the walked
    // ground can never be different rects.
    expect(BG_FIELD_HALF_X).toBe(BG_HALF_X);
    expect(BG_FIELD_HALF_Z).toBe(BG_HALF_Z);
  });

  it('neighbouring chunks SHARE their seam, so the ground has no cracks', () => {
    // Every interior edge is some other chunk's opposite edge, exactly. The
    // vertex loops build [min..max] inclusive, so a shared seam means shared
    // vertices; a chunk plan with a half-cell offset would tear visibly.
    const minXs = new Set(chunks.map((c) => c.minX));
    const minZs = new Set(chunks.map((c) => c.minZ));
    for (const c of chunks) {
      if (c.maxX < BG_FIELD_HALF_X) {
        expect(minXs.has(c.maxX), `x seam at ${c.maxX} is unshared`).toBe(true);
      }
      if (c.maxZ < BG_FIELD_HALF_Z) {
        expect(minZs.has(c.maxZ), `z seam at ${c.maxZ} is unshared`).toBe(true);
      }
      // No chunk overhangs the rect.
      expect(c.minX).toBeGreaterThanOrEqual(-BG_FIELD_HALF_X);
      expect(c.maxX).toBeLessThanOrEqual(BG_FIELD_HALF_X);
      expect(c.minZ).toBeGreaterThanOrEqual(-BG_FIELD_HALF_Z);
      expect(c.maxZ).toBeLessThanOrEqual(BG_FIELD_HALF_Z);
      // Every chunk lands on the heightfield lattice, so its vertices sample
      // grid NODES rather than interpolating between them.
      expect(((c.minX + BG_FIELD_HALF_X) / BG_TERRAIN_CELL) % 1).toBe(0);
      expect(((c.minZ + BG_FIELD_HALF_Z) / BG_TERRAIN_CELL) % 1).toBe(0);
      expect((c.maxX - c.minX) % BG_TERRAIN_CELL).toBe(0);
      expect((c.maxZ - c.minZ) % BG_TERRAIN_CELL).toBe(0);
      expect(c.maxX - c.minX).toBeLessThanOrEqual(BG_TERRAIN_CHUNK);
      expect(c.maxZ - c.minZ).toBeLessThanOrEqual(BG_TERRAIN_CHUNK);
    }
  });

  it('the drawn mesh resolution is the baked heightfield resolution', () => {
    // The terrain builder samples the sim's heightfield per vertex; if the
    // mesh cell and the bake cell disagree the drawn surface interpolates a
    // different curve from the one the body walks on.
    expect(BG_TERRAIN_CELL).toBe(TH_HEIGHT_CELL);
    expect(BG_HEIGHT_COLS).toBe((2 * BG_FIELD_HALF_X) / TH_HEIGHT_CELL + 1);
    expect(BG_HEIGHT_ROWS).toBe((2 * BG_FIELD_HALF_Z) / TH_HEIGHT_CELL + 1);
  });
});

describe('Thornhollow art manifest: every group loads a model that exists', () => {
  const groups = bgAssetGroups();

  it('groups every GLB placement, sorted, non-empty, with no duplicate asset', () => {
    expect(groups.length).toBeGreaterThan(20);
    const ids = groups.map((g) => g.assetId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids); // stable draw order
    for (const g of groups) {
      expect(g.placements.length, `group ${g.assetId} is empty`).toBeGreaterThan(0);
      expect(g.path).toBe(`/models/${g.assetId}.glb`);
    }
    // Grouping is a partition of the non-grass placements: nothing dropped,
    // nothing counted twice.
    const grouped = groups.reduce((n, g) => n + g.placements.length, 0);
    const grass = bgGrassPatches().length;
    expect(grouped + grass).toBe(TH_PLACEMENTS.length);
  });

  it('every assetId resolves to a real GLB under public/models', () => {
    const missing = groups
      .map((g) => g.assetId)
      .filter((id) => !existsSync(publicFile(`models/${id}.glb`)));
    expect(missing, 'asset ids with no GLB on disk').toEqual([]);
  });

  it('boot-preloads every field model and texture before collision can become active', () => {
    const preload = battlegroundPreloadAssetPaths();
    expect(preload.models).toEqual(groups.map((g) => g.path));
    expect(preload.textures).toEqual([
      ...bgPaintTextureFiles().map((path) => ({ path, srgb: false })),
      ...[...new Set(bgFieldDecals().map((d) => `${BG_TEXTURE_DIR}/decals/${d.tex}.webp`))].map(
        (path) => ({ path, srgb: true }),
      ),
    ]);
    expect(new Set(preload.models).size).toBe(preload.models.length);
    expect(new Set(preload.textures.map((t) => t.path)).size).toBe(preload.textures.length);
  });

  it('ships new Thornhollow GLBs meshopt-compressed with fresh media hashes', () => {
    const assets = {
      'models/city/wall_tower.glb':
        'f492b537c35f217e38f409f7e53fa76dee62db29b651f7f5c6a94b078a83517f',
      'models/medieval_village_v2/buildings/CastleBase_03.glb':
        '39d2d944a0a18010b488a2df22fded156a567b81299a4e7f0f1496a9cda32b2b',
      'models/medieval_village_v2/buildings/CastleStairs_03.glb':
        '1dd5b842c0df60f12a04c4723fcf614355a983ff47e6214d20702f46f2ddc405',
      'models/medieval_village_v2/buildings/Stairs_01.glb':
        'df7c179971609353af4508e62b01be56af63234358eecba25296e54be17f4b3d',
    } as const;
    for (const [asset, expectedHash] of Object.entries(assets)) {
      const bytes = readFileSync(publicFile(asset));
      expect(bytes.toString('utf8')).toContain('EXT_meshopt_compression');
      const fullHash = createHash('sha256').update(bytes).digest('hex');
      expect(fullHash).toBe(expectedHash);
      const hash = fullHash.slice(0, 12);
      expect(MEDIA_ASSETS[asset]).toBe(`/media/${asset.replace(/\.glb$/, `.${hash}.glb`)}`);
    }
  });

  it('selects only the primary mesh when a source GLB contains authored LODs', () => {
    expect(isPrimaryBattlegroundMeshName('CastleBase_03_LOD0')).toBe(true);
    expect(isPrimaryBattlegroundMeshName('wall_tower')).toBe(true);
    expect(isPrimaryBattlegroundMeshName('CastleBase_03_LOD1')).toBe(false);
    expect(isPrimaryBattlegroundMeshName('CastleBase_03_LOD2')).toBe(false);
    expect(isPrimaryBattlegroundMeshName('CastleBase_03_LOD12.001')).toBe(false);
  });

  it('grass is procedural: never a group, always its own bucket', () => {
    const patches = bgGrassPatches();
    expect(patches.length).toBeGreaterThan(0);
    for (const p of patches) expect(p.assetId).toBe(BG_GRASS_ASSET);
    expect(groups.some((g) => g.assetId === BG_GRASS_ASSET)).toBe(false);
    // Grass carries the procedural knobs the tuft builder reads.
    expect(patches.some((p) => p.hue !== undefined || p.lum !== undefined)).toBe(true);
    // ...and there is deliberately no grass GLB to load.
    expect(existsSync(publicFile(`models/${BG_GRASS_ASSET}.glb`))).toBe(false);
  });

  it('every placement carries a finite transform the instancer can use', () => {
    for (const g of groups) {
      for (const p of g.placements) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z), `${g.assetId} position`).toBe(true);
        expect(Number.isFinite(p.seatY), `${g.assetId} seat`).toBe(true);
        expect(Number.isFinite(p.rotY), `${g.assetId} rotation`).toBe(true);
        expect(p.scale, `${g.assetId} scale`).toBeGreaterThan(0);
        // Art may reach past the ramparts (the wooded slope that frames the
        // hollow is authored out there), but only as far as the declared
        // dressing bound. Nothing that BLOCKS may leave the field rect at all,
        // which the collider pin in tests/battleground_band.test.ts holds.
        expect(Math.abs(p.x), `${g.assetId} inside the dressing bound`).toBeLessThanOrEqual(
          BG_DRESSING_HALF_X,
        );
        expect(Math.abs(p.z), `${g.assetId} inside the dressing bound`).toBeLessThanOrEqual(
          BG_DRESSING_HALF_Z,
        );
      }
    }
  });
});

describe('Thornhollow ground paint: a complete, decodable index grid', () => {
  it('every swatch texture exists under public/textures/battleground', () => {
    const files = bgPaintTextureFiles();
    expect(files).toHaveLength(TH_PAINT_SWATCHES.length);
    expect(files.length).toBeGreaterThan(1);
    const missing = files.filter((f) => !existsSync(publicFile(f)));
    expect(missing, 'paint textures with no file on disk').toEqual([]);
    for (const [i, f] of files.entries()) {
      expect(f).toBe(`${BG_TEXTURE_DIR}/${TH_PAINT_SWATCHES[i].texture}.jpg`);
      expect(TH_PAINT_SWATCHES[i].tileSize).toBeGreaterThan(0);
      expect(Math.abs(TH_PAINT_SWATCHES[i].light)).toBeLessThanOrEqual(1);
    }
    // Swatch ids are distinct: the id -> layer remap below depends on it.
    expect(new Set(TH_PAINT_SWATCHES.map((s) => s.id)).size).toBe(TH_PAINT_SWATCHES.length);
  });

  it('the decoded index grid is cols x rows and holds only valid layers or 255', () => {
    const lookup = bgPaintLookup();
    expect(lookup.cols).toBe(TH_PAINT_COLS);
    expect(lookup.rows).toBe(TH_PAINT_ROWS);
    expect(lookup.ids).toHaveLength(TH_PAINT_COLS * TH_PAINT_ROWS);
    expect(lookup.cell).toBe(TH_PAINT_CELL);
    expect(lookup.originX).toBe(TH_PAINT_ORIGIN_X);
    expect(lookup.originZ).toBe(TH_PAINT_ORIGIN_Z);
    expect(lookup.swatches).toBe(TH_PAINT_SWATCHES);
    // The paint rect covers the field rect exactly.
    expect(lookup.originX).toBe(-BG_FIELD_HALF_X);
    expect(lookup.originZ).toBe(-BG_FIELD_HALF_Z);
    expect((lookup.cols - 1) * lookup.cell).toBe(2 * BG_FIELD_HALF_X);
    expect((lookup.rows - 1) * lookup.cell).toBe(2 * BG_FIELD_HALF_Z);
    // Every value is a texture-array layer or the unpainted sentinel. An
    // out-of-range index samples garbage in the shader.
    const seen = new Set<number>();
    for (const v of lookup.ids) seen.add(v);
    for (const v of seen) {
      expect(v === 255 || (v >= 0 && v < TH_PAINT_SWATCHES.length), `layer ${v}`).toBe(true);
    }
    // The paint is real: more than one layer in play, and most cells painted.
    expect([...seen].filter((v) => v !== 255).length).toBeGreaterThan(3);
    let painted = 0;
    for (const v of lookup.ids) if (v !== 255) painted++;
    expect(painted / lookup.ids.length).toBeGreaterThan(0.5);
    // The lookup is cached, so the terrain builder decodes once.
    expect(bgPaintLookup()).toBe(lookup);
  });

  it('the run-length source covers every cell exactly once', () => {
    expect(TH_PAINT_RLE.length % 2).toBe(0);
    let total = 0;
    for (let i = 1; i < TH_PAINT_RLE.length; i += 2) {
      expect(TH_PAINT_RLE[i], 'a zero-length run is a compiler bug').toBeGreaterThan(0);
      total += TH_PAINT_RLE[i];
    }
    expect(total).toBe(TH_PAINT_COLS * TH_PAINT_ROWS);
  });
});

describe('Thornhollow dressing: authored lights and decals', () => {
  it('the map authored point lights, all inside the rect and usable', () => {
    const lights = bgFieldLights();
    expect(lights.length).toBeGreaterThan(0);
    for (const l of lights) {
      expect(Math.abs(l.x)).toBeLessThanOrEqual(BG_FIELD_HALF_X);
      expect(Math.abs(l.z)).toBeLessThanOrEqual(BG_FIELD_HALF_Z);
      expect(l.intensity).toBeGreaterThan(0);
      expect(l.range).toBeGreaterThan(0);
      expect(l.color).toBeGreaterThanOrEqual(0);
      expect(l.color).toBeLessThanOrEqual(0xffffff);
    }
    // Both keeps are lit: a light budget that only served one side would be a
    // visible advantage, so the two halves each carry lights.
    expect(lights.some((l) => l.z < 0)).toBe(true);
    expect(lights.some((l) => l.z > 0)).toBe(true);
  });

  it('authors no more lights than the top tier will actually draw', () => {
    // The field builder trims to this number ON PURPOSE. The Three layer sorts
    // by intensity*range and slices to the tier budget, so an authored light
    // past it is cost that never reaches a frame AND, worse, a light whose twin
    // on the other half might survive the slice while it does not.
    const src = readFileSync(`${ROOT}src/render/battleground.ts`, 'utf8');
    const budgets = [...src.matchAll(/^\s+(low|medium|high|ultra):\s*(\d+),/gm)].map((m) =>
      Number(m[2]),
    );
    expect(budgets.length, 'the tier budget table moved').toBe(4);
    expect(bgFieldLights().length).toBeLessThanOrEqual(Math.max(...budgets));
  });

  it('mirrors every light through the field centre, colour included where it is neutral', () => {
    // Cosmetic, but the fairness story is the same as the plan's: one half lit
    // and the other dim is an advantage a player can see. The title claims the
    // COLOUR mirrors too wherever it is neutral, so the set is partitioned and
    // the neutral half carries that claim: the shrine lights over the two flag
    // stands are team-coloured by design and exempt, everything else has to
    // mirror colour as well as intensity and range. Position/intensity/range
    // alone would let a recoloured half through.
    const lights = bgFieldLights();
    const twinOf = (l: { x: number; z: number }) =>
      lights.find((q) => Math.hypot(q.x + l.x, q.z + l.z) < 1e-6);
    const isTeamColoured = (l: { x: number; z: number }) =>
      BG_BASES.some((b) => Math.hypot(l.x - b.flag.x, l.z - b.flag.z) < 6);
    const neutral = lights.filter((l) => !isTeamColoured(l));
    // The partition is non-empty on BOTH sides: an exemption that swallowed
    // every light would make the colour assertion below vacuous, and one that
    // exempted nothing would mean the team shrines stopped being team-coloured.
    expect(neutral.length, 'no neutral lights left to carry the colour claim').toBeGreaterThan(0);
    expect(
      lights.length - neutral.length,
      'no team-coloured lights: the shrine exemption is stale',
    ).toBeGreaterThan(0);
    for (const l of lights) {
      const twin = twinOf(l);
      expect(twin, `light (${l.x}, ${l.z}) has no mirrored twin`).toBeTruthy();
      expect(twin?.intensity).toBe(l.intensity);
      expect(twin?.range).toBe(l.range);
    }
    for (const l of neutral) {
      expect(twinOf(l)?.color, `neutral light (${l.x}, ${l.z}) is not mirrored in colour`).toBe(
        l.color,
      );
    }
  });

  it('every decal texture exists under the decals folder the builder loads', () => {
    const decals = bgFieldDecals();
    expect(decals.length).toBeGreaterThan(0);
    for (const d of decals) {
      expect(d.size).toBeGreaterThan(0);
      expect(Math.abs(d.x)).toBeLessThanOrEqual(BG_FIELD_HALF_X);
      expect(Math.abs(d.z)).toBeLessThanOrEqual(BG_FIELD_HALF_Z);
      expect(
        existsSync(publicFile(`${BG_TEXTURE_DIR}/decals/${d.tex}.webp`)),
        `decal texture ${d.tex}`,
      ).toBe(true);
    }
    // The folder and extension the files sit under must be the ones the
    // builder asks for; that pairing is the whole point of the check above,
    // and a silent .png/.jpg swap in the builder would otherwise leave these
    // decals loading nothing at all (the builder swallows the failure).
    const src = readFileSync(`${ROOT}src/render/battleground.ts`, 'utf8');
    const loadLine = src.split('\n').find((l) => l.includes('/decals/'));
    expect(loadLine, 'the field builder no longer loads from the decals folder').toBeTruthy();
    expect(loadLine).toContain('.webp');
  });
});

describe('Thornhollow structures join the occluder-fade family', () => {
  // Every other interior-capable render family (props, foliage, dungeon,
  // eastbrook_town, yumi_maze) fades geometry that comes between the player and
  // the chase camera. The field has keeps, gatehouses and towers a camera can
  // sit behind, so its placements consume the same seam. Cosmetic only: the
  // faded geometry still blocks movement and casts, and nothing is tier-gated.
  it('classifies the tall wall, tower and gate pieces as occluders, clutter as not', () => {
    for (const assetId of [
      'dungeon/wall',
      'dungeon/wall_broken',
      'dungeon/barrier',
      'city/wall_tower',
      'biome/dungeon_arch_stone',
    ]) {
      expect(isBattlegroundOccluderAsset(assetId), assetId).toBe(true);
    }
    for (const assetId of [
      'dungeon/crate_small',
      'dungeon/rubble_large',
      'dungeon/skull',
      'foliage/oak_1',
      'grass/patch',
      'dungeon/torch_mounted',
    ]) {
      expect(isBattlegroundOccluderAsset(assetId), assetId).toBe(false);
    }
  });

  it('splits the AUTHORED asset set both ways, so neither half is empty', () => {
    // Run against the real manifest rather than a hand list: an asset rename in
    // the map would otherwise leave the classifier matching nothing at all
    // while the ids above still read as a passing test.
    const ids = bgAssetGroups().map((g) => g.assetId);
    const fading = ids.filter(isBattlegroundOccluderAsset);
    expect(fading.length, 'no authored asset is classified as an occluder').toBeGreaterThan(0);
    expect(
      ids.length - fading.length,
      'every authored asset fades: ground clutter is not exempt',
    ).toBeGreaterThan(0);
    // The structures really are the bulk of the field's geometry, so the fade
    // is doing the job the family exists for.
    const structuralPlacements = bgAssetGroups()
      .filter((g) => isBattlegroundOccluderAsset(g.assetId))
      .reduce((n, g) => n + g.placements.length, 0);
    expect(structuralPlacements).toBeGreaterThan(400);
  });

  it('consumes the shared fade core and routes reduced motion, and the renderer drives it', () => {
    const placements = readFileSync(`${ROOT}src/render/battleground_placements.ts`, 'utf8');
    // The same three-part consumption every sibling family uses: the pure step
    // policy, the settle test, and the segment/box hit test.
    expect(placements).toContain("from './occluder_fade_core'");
    expect(placements).toContain('occluderSegmentHitsBox(');
    expect(placements).toContain('occluderFadeSettled(');
    // An InstancedMesh cannot fade one instance, so the ghost pool is the only
    // correct way to do this over the field's instanced batches.
    expect(placements).toContain('InstancedOccluderGhosts');
    // Reduced motion has to reach the step, exactly as
    // graphics_overhaul_integration pins for the other consumers.
    expect(placements).toMatch(/stepOccluderFade\([^)]+,\s*reducedMotion\)/s);
    const renderer = readFileSync(`${ROOT}src/render/renderer.ts`, 'utf8');
    const start = renderer.indexOf('updateBattlegroundOccluderFades(\n');
    expect(start, 'the renderer never drives the battleground fade').toBeGreaterThan(-1);
    const call = renderer.slice(start, renderer.indexOf(');', start));
    expect(call).toContain('this.camera.position.x');
    expect(call).toContain('this.cameraLookAt.x');
    expect(call).toContain('this.reducedMotion()');
  });
});

describe('the band fog is view distance, tier-identical (source pin)', () => {
  it('the battleground fog branch sets fixed values and reads no tier knob', () => {
    // A tier-conditional fog here would be a live see-farther exploit: pin
    // that the branch is unconditional and its values are the view-distance
    // pair the design names.
    const src = readFileSync(`${ROOT}src/render/renderer.ts`, 'utf8');
    const start = src.indexOf("desired === 'battleground'");
    expect(start).toBeGreaterThan(-1);
    const branch = src.slice(start, src.indexOf('} else if', start + 1));
    expect(branch).toContain('fog.near = 70');
    expect(branch).toContain('fog.far = 210');
    expect(branch).not.toContain('lowGfx');
    expect(branch).not.toContain('Governor');
  });
});
