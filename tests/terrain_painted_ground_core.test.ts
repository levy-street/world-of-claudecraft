// The painted ground (src/render/terrain_painted_ground_core.ts): the layer
// table the converter, the loader and the shader share, the shipped files it
// names, the GroundAO pack the converter fits to the shader's constants, and
// the JS twins of the cover masks and the height blend.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  emulateMacroNoise,
  GROUND_AO_PACK,
} from '../scripts/assets/painted_ground/lib/painted_ground_core.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  coverMasksAt,
  FALLBACK_MACRO_STATS,
  grassFallbackTint,
  heightWindowAt,
  layerUvPerTuv,
  macroStatsOf,
  NEUTRAL_HEIGHT_BYTE,
  PAINTED_COBBLE_LANE_SLOTS,
  PAINTED_COBBLE_LANES,
  PAINTED_COBBLE_TOWNS,
  PAINTED_GROUND_LAYERS,
  PAINTED_GROUND_TUNING,
  PAINTED_HEIGHT_SIZE,
  PAINTED_TAP_ROT,
  PHOTO_GRASS_MEAN,
  paintedBumpGlsl,
  paintedBumpHeight,
  paintedCoverGlsl,
  paintedGroundDeclarationsGlsl,
  paintedGroundFiles,
  paintedHeightBlend,
  resolveCobbleLaneBox,
  resolveCobbleLanes,
  resolveCobbleTowns,
  rotateBack,
  rotateUv,
  TERRAIN_BASE_UV_PER_YARD,
  townCobbleAt,
} from '../src/render/terrain_painted_ground_core';
import { ZONE1_ZONE } from '../src/sim/content/zone1';
import { EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';

const ROOT = path.resolve(__dirname, '..');
const terrainSource = fs.readFileSync(path.join(ROOT, 'src/render/terrain.ts'), 'utf8');
const onDisk = (logical: string): string => path.join(ROOT, 'public', logical);

/** terrain.ts prepareTerrainTex literal calls: key -> { file, srgb }. */
function loaderCalls(): Map<string, { file: string; srgb: boolean }> {
  const out = new Map<string, { file: string; srgb: boolean }>();
  for (const m of terrainSource.matchAll(
    /prepareTerrainTex\(\s*'([^']+)',\s*'([A-Za-z0-9_.]+)',\s*(true|false),?\s*\)/g,
  )) {
    out.set(m[1], { file: m[2], srgb: m[3] === 'true' });
  }
  return out;
}

describe('painted layer table (the one source the converter, loader and shader read)', () => {
  it('terrain.ts loads exactly the files the table names, on the right route', () => {
    const calls = loaderCalls();
    expect(PAINTED_GROUND_LAYERS.map((l) => l.source)).toEqual([
      'grass',
      'dirt',
      'rock',
      'cobble',
      'leaves',
    ]);
    for (const layer of PAINTED_GROUND_LAYERS) {
      const files = paintedGroundFiles(layer);
      // colour: srgb=true, the raw drawImage pack source
      expect(calls.get(layer.albedoKey), layer.albedoKey).toEqual({
        file: path.basename(files.color),
        srgb: true,
      });
      // height: linear data, a webp so it can never take the KTX2 route
      expect(calls.get(layer.heightKey), layer.heightKey).toEqual({
        file: path.basename(files.height),
        srgb: false,
      });
      if (layer.normalKey) {
        expect(calls.get(layer.normalKey), layer.normalKey).toEqual({
          file: path.basename(files.normal ?? ''),
          srgb: false,
        });
      } else {
        expect(files.normal).toBeNull();
      }
    }
  });

  it('every painted albedo and normal slot exists in the packed arrays', () => {
    const albedo = /SPLAT_ALBEDO_LAYERS = \[([^\]]*)\] as const;/.exec(terrainSource)?.[1] ?? '';
    const normal = /SPLAT_NORMAL_LAYERS = \[([^\]]*)\] as const;/.exec(terrainSource)?.[1] ?? '';
    for (const layer of PAINTED_GROUND_LAYERS) {
      expect(albedo).toContain(`'${layer.albedoKey}'`);
      if (layer.normalKey) expect(normal).toContain(`'${layer.normalKey}'`);
    }
  });

  it('grass, dirt and rock keep the tilings the GroundAO relief channels sample at', () => {
    // The relief pack is sampled at tuv (grass), tuv x 0.55 (dirt) and tuv x
    // 0.6 (rock); a painted layer moved off its scale would shade cavities
    // that are not under its painted stones.
    const scale = Object.fromEntries(PAINTED_GROUND_LAYERS.map((l) => [l.source, l]));
    expect(layerUvPerTuv(scale.grass)).toBeCloseTo(1, 10);
    expect(layerUvPerTuv(scale.dirt)).toBeCloseTo(0.55, 10);
    expect(layerUvPerTuv(scale.rock)).toBeCloseTo(0.6, 10);
    expect(terrainSource).toContain('vec2 tuv = wocTPlane * 0.22;');
    expect(TERRAIN_BASE_UV_PER_YARD).toBe(0.22);
    expect(terrainSource).toContain('aoDirt = texture2D(uGroundAO, uv * 0.55).g;');
    expect(terrainSource).toContain('aoRock = texture2D(uGroundAO, uv * 0.6).b;');
    expect(terrainSource).toContain('vec3(tuv * 0.6, WOC_L_ROCK)');
    // the painted dirt tap sits on the same 0.55 (paintedDirtFlatGlsl)
    expect(terrainSource).toContain('paintedDirtFlatGlsl()');
  });

  it('ships every painted file at its size, in the media manifest', async () => {
    for (const layer of PAINTED_GROUND_LAYERS) {
      const files = paintedGroundFiles(layer);
      for (const logical of [files.color, files.height, files.normal].filter(Boolean)) {
        expect(fs.existsSync(onDisk(logical as string)), `${logical} on disk`).toBe(true);
        expect(MEDIA_ASSETS[logical as string], `${logical} in manifest`).toBeTruthy();
      }
      const colour = await sharp(onDisk(files.color)).metadata();
      expect([colour.width, colour.height, colour.format]).toEqual([1024, 1024, 'jpeg']);
      const height = await sharp(onDisk(files.height)).metadata();
      expect([height.width, height.height, height.format]).toEqual([
        PAINTED_HEIGHT_SIZE,
        PAINTED_HEIGHT_SIZE,
        'webp',
      ]);
      if (files.normal) {
        const normal = await sharp(onDisk(files.normal)).metadata();
        expect([normal.width, normal.height]).toEqual([1024, 1024]);
        expect(MEDIA_ASSETS[files.normal.replace(/\.jpg$/, '.ktx2')]).toBeTruthy();
      }
    }
  });

  it('the painted heights are centred on the shader height zero the photo layers pack', async () => {
    // buildSplatAlbedoArray fills a layer with no height map with
    // NEUTRAL_HEIGHT_BYTE, which the shader reads as 0.5 - 0.5 = 0. A painted
    // height centred elsewhere would hand that layer every tie.
    expect(NEUTRAL_HEIGHT_BYTE).toBe(128);
    for (const layer of PAINTED_GROUND_LAYERS) {
      const { data } = await sharp(onDisk(paintedGroundFiles(layer).height))
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let sum = 0;
      let sq = 0;
      for (const v of data) {
        sum += v / 255;
        sq += (v / 255) ** 2;
      }
      const mean = sum / data.length;
      const sd = Math.sqrt(sq / data.length - mean * mean);
      expect(mean, `${layer.source} height mean`).toBeGreaterThan(0.47);
      expect(mean, `${layer.source} height mean`).toBeLessThan(0.53);
      // real relief to blend on, never a near-flat map
      expect(sd, `${layer.source} height sd`).toBeGreaterThan(0.1);
    }
  });
});

describe('GroundAO_Packed.png (rebuilt from the painted layers)', () => {
  it('each channel sits on the mean and spread the shader centres it on', async () => {
    const { data, info } = await sharp(onDisk('textures/terrain/GroundAO_Packed.png'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([512, 512, 4]);
    const stats = [0, 1, 2, 3].map((c) => {
      let sum = 0;
      let sq = 0;
      const n = info.width * info.height;
      for (let i = c; i < data.length; i += 4) {
        sum += data[i] / 255;
        sq += (data[i] / 255) ** 2;
      }
      const mean = sum / n;
      return { mean, sd: Math.sqrt(sq / n - mean * mean) };
    });
    const specs = [GROUND_AO_PACK.r, GROUND_AO_PACK.g, GROUND_AO_PACK.b];
    specs.forEach((spec, c) => {
      expect(stats[c].mean, `channel ${c} mean`).toBeCloseTo(spec.mean, 2);
      expect(Math.abs(stats[c].mean - spec.mean), `channel ${c} mean`).toBeLessThan(0.0015);
      expect(Math.abs(stats[c].sd - spec.sd), `channel ${c} sd`).toBeLessThan(0.0015);
    });
    // the sand AO channel is the unchanged Ground080 AO (mean 0.883, sd 0.0559)
    expect(Math.abs(stats[3].mean - 0.883)).toBeLessThan(0.0015);
    expect(Math.abs(stats[3].sd - 0.0559)).toBeLessThan(0.0015);
    // and those are the very literals GROUND_RELIEF_GLSL centres on
    expect(terrainSource).toContain('vec4 aoBase = vec4(0.812, 0.0, 0.0, 0.883);');
    expect(terrainSource).toContain('float aoDirt = 0.897;');
    expect(terrainSource).toContain('float aoRock = 0.623;');
    expect(terrainSource).toContain('const float WOC_GRASS_H_INV_SD = 12.9;');
    expect(1 / GROUND_AO_PACK.r.sd).toBeCloseTo(12.9, 1);
  });
});

describe('cover masks (coverMasksAt, the twin of paintedCoverGlsl)', () => {
  const constant = (v: number) => () => v;
  const stats = { mean: 0.5, sd: 0.05 };

  it('a fade of zero carves nothing', () => {
    const m = coverMasksAt(10, 20, 0, constant(0.9), stats);
    expect(m.leaf).toBe(0);
    expect(m.earth).toBe(0);
  });

  it('a patch never takes the whole grass weight, and earth never lands in leaf litter', () => {
    const high = coverMasksAt(0, 0, 1, constant(0.9), stats); // z = +8 everywhere
    expect(high.leaf).toBeCloseTo(PAINTED_GROUND_TUNING.leafShareMax, 10);
    expect(high.earth).toBe(0);
    expect(high.drift).toBe(1);
    const low = coverMasksAt(0, 0, 1, constant(0.1), stats); // z = -8 everywhere
    expect(low.leaf).toBe(0);
    expect(low.earth).toBeCloseTo(PAINTED_GROUND_TUNING.earthShareMax, 10);
    expect(low.drift).toBe(0);
  });

  it('coverage holds across macro textures whatever their raw values (z-scored)', () => {
    // The game's macro texture depends on how far textures.ts's shared LCG
    // ran; three different draws of it must give similar patch coverage.
    const coverages = [12345, 777, 4242].map((seed) => {
      const noise = emulateMacroNoise(seed);
      const s = macroStatsOf(noise.bytes);
      let leaf = 0;
      let earth = 0;
      let n = 0;
      for (let x = 0; x < 300; x += 1.5) {
        for (let z = 0; z < 300; z += 1.5) {
          const m = coverMasksAt(x, z, 1, noise.sample, s);
          if (m.leaf > 0.4) leaf++;
          if (m.earth > 0.4) earth++;
          n++;
        }
      }
      return { leaf: leaf / n, earth: earth / n };
    });
    for (const c of coverages) {
      // leaf litter is a feature, not the floor: a few to a fifth of the turf
      expect(c.leaf).toBeGreaterThan(0.03);
      expect(c.leaf).toBeLessThan(0.2);
      // bare earth is rarer still
      expect(c.earth).toBeGreaterThan(0.003);
      expect(c.earth).toBeLessThan(0.1);
    }
  });

  it('the ragged-edge noise is zero-mean and bounded', () => {
    const noise = emulateMacroNoise(12345);
    const s = macroStatsOf(noise.bytes);
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let x = 0; x < 200; x += 0.7) {
      for (let z = 0; z < 200; z += 0.7) {
        const { rag } = coverMasksAt(x, z, 1, noise.sample, s);
        sum += rag;
        max = Math.max(max, Math.abs(rag));
        n++;
      }
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(max).toBeLessThan(PAINTED_GROUND_TUNING.ragAmp * 6);
    expect(max).toBeGreaterThan(PAINTED_GROUND_TUNING.ragAmp * 0.5);
  });

  it('macroStatsOf reads the red channel of RGBA bytes and refuses a flat texture', () => {
    const rgba = new Uint8Array([0, 9, 9, 255, 255, 9, 9, 255]);
    const st = macroStatsOf(rgba, 4);
    expect(st.mean).toBeCloseTo(0.5, 10);
    expect(st.sd).toBeCloseTo(0.5, 10);
    expect(macroStatsOf(new Uint8Array([128, 128, 128]))).toEqual(FALLBACK_MACRO_STATS);
  });
});

describe('town cobbles', () => {
  it('Eastbrook is the cobble town, at its hub, inside a fixed uniform array', () => {
    // the zone record itself (sim/content/zone1.ts), the one data.ts merges
    const towns = resolveCobbleTowns([ZONE1_ZONE]);
    const eastbrook = ZONE1_ZONE;
    expect(eastbrook.id).toBe('eastbrook_vale');
    expect(resolveCobbleTowns([{ ...ZONE1_ZONE, id: 'elsewhere' }])[0][3]).toBeLessThan(0);
    expect(PAINTED_COBBLE_TOWNS.map((t) => t.zoneId)).toEqual(['eastbrook_vale']);
    expect(towns[0]).toEqual([
      eastbrook?.hub.x,
      eastbrook?.hub.z,
      (eastbrook?.hub.radius ?? 0) * PAINTED_COBBLE_TOWNS[0].inner,
      (eastbrook?.hub.radius ?? 0) * PAINTED_COBBLE_TOWNS[0].outer,
    ]);
    expect(towns).toHaveLength(2);
    // the spare slot never matches: smoothstep(-2, -1, d >= 0) is 1
    expect(townCobbleAt(0, 0, [towns[1]], 5)).toBe(0);
  });

  it('cobbles fill the whole town, wear back to earth only at its edge and stop at the outer radius', () => {
    const towns = resolveCobbleTowns([{ id: 'eastbrook_vale', hub: { x: 0, z: 0, radius: 26 } }]);
    expect(townCobbleAt(0, 0, towns, 3)).toBeCloseTo(1, 6);
    // every road inside the town is stone: even a low earth field (z -2) stays laid, out to
    // the full-cobble radius past the outermost buildings (twice the hub radius)
    expect(townCobbleAt(0, 0, towns, -2)).toBeCloseTo(1, 6);
    expect(townCobbleAt(50, 0, towns, -2)).toBeCloseTo(1, 6);
    // only a far outlier of the earth field bares the centre
    expect(townCobbleAt(0, 0, towns, -5)).toBe(0);
    expect(townCobbleAt(70, 0, towns, 3)).toBe(0);
    // between the radii (the town's edge) the coverage thins and wears to earth in patches
    const edge = townCobbleAt(60, 0, towns, 0);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(townCobbleAt(10, 0, towns, 0));
    expect(townCobbleAt(60, 0, towns, -2)).toBe(0);
  });
});

describe('cobble lanes (the town streets that run on past the footprint)', () => {
  const street = EASTBROOK_LAYOUT.roads.find((r) => r.id === 'east');
  if (!street) throw new Error('expected the Eastbrook main street');
  const towns = resolveCobbleTowns([ZONE1_ZONE]);
  const lanes = resolveCobbleLanes([ZONE1_ZONE]);
  const hub = ZONE1_ZONE.hub;
  const fullRadius = towns[0][2];

  it('lays Eastbrook main street from the layout, every segment the footprint leaves, in the slots', () => {
    expect(PAINTED_COBBLE_LANES.map((l) => l.zoneId)).toEqual(['eastbrook_vale']);
    expect(PAINTED_COBBLE_LANES[0].points).toBe(street.points);
    expect(lanes).toHaveLength(PAINTED_COBBLE_LANE_SLOTS);
    const used = lanes.filter((l) => l[0] < 1e4);
    // every street segment with an end outside the full-cobble radius (less the lane's reach)
    // has its slot, none dropped for want of one
    const needed = street.points.slice(1).filter((b, i) => {
      const a = street.points[i];
      const reach = fullRadius - PAINTED_GROUND_TUNING.cobbleLaneOuter;
      return (
        Math.hypot(a.x - hub.x, a.z - hub.z) > reach || Math.hypot(b.x - hub.x, b.z - hub.z) > reach
      );
    });
    expect(used).toHaveLength(needed.length);
    expect(used.length).toBeGreaterThan(0);
    // the last segment ends on the street's own end, the quay walk at the boardwalk
    const end = street.points[street.points.length - 1];
    expect(used[used.length - 1].slice(2)).toEqual([end.x, end.z]);
    // no zone, no lane: a world without Eastbrook binds only spare slots
    expect(resolveCobbleLanes([{ ...ZONE1_ZONE, id: 'elsewhere' }]).every((l) => l[0] >= 1e4)).toBe(
      true,
    );
  });

  it('cobbles the whole street to the docks, and nothing beside it or along the quay walk', () => {
    // a low earth field (z -2): the street stays laid stone all the way
    const end = street.points[street.points.length - 1];
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1];
      const b = street.points[i];
      for (const t of [0, 0.5, 1]) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        expect(townCobbleAt(x, z, towns, -2, lanes), `street at ${x}, ${z}`).toBeCloseTo(1, 6);
      }
    }
    // past the town's own footprint the street is cobbled only by its lane
    const lamp = { x: -75, z: -67 };
    expect(Math.hypot(lamp.x - hub.x, lamp.z - hub.z)).toBeGreaterThan(towns[0][3]);
    expect(townCobbleAt(lamp.x, lamp.z, towns, -2)).toBe(0);
    expect(townCobbleAt(lamp.x, lamp.z, towns, -2, lanes)).toBeCloseTo(1, 6);
    // the cobble fades out over the lane's outer reach past the street's end, at the boardwalk
    const inner = PAINTED_GROUND_TUNING.cobbleLaneInner;
    const outer = PAINTED_GROUND_TUNING.cobbleLaneOuter;
    expect(townCobbleAt(end.x - inner + 0.5, end.z, towns, 3, lanes)).toBeCloseTo(1, 6);
    expect(townCobbleAt(end.x - outer - 0.5, end.z, towns, 3, lanes)).toBe(0);
    // the quay walk on either side of the junction stays dirt, and so does ground off the street
    expect(townCobbleAt(-92, -45, towns, 3, lanes)).toBe(0);
    expect(townCobbleAt(-92, -70, towns, 3, lanes)).toBe(0);
    expect(townCobbleAt(-80, -76, towns, 3, lanes)).toBe(0);
  });

  it('bounds every lane in one box: outside it the lanes lay nothing, so the shader may skip them', () => {
    const box = resolveCobbleLaneBox(lanes);
    const reach = PAINTED_GROUND_TUNING.cobbleLaneOuter;
    const used = lanes.filter((l) => l[0] < 1e4);
    for (const [ax, az, bx, bz] of used) {
      for (const [x, z] of [
        [ax, az],
        [bx, bz],
      ]) {
        expect(x - reach).toBeGreaterThanOrEqual(box[0]);
        expect(z - reach).toBeGreaterThanOrEqual(box[1]);
        expect(x + reach).toBeLessThanOrEqual(box[2]);
        expect(z + reach).toBeLessThanOrEqual(box[3]);
      }
    }
    // just outside every edge the lanes contribute nothing (the skip is exact)
    for (const [x, z] of [
      [box[0] - 0.01, (box[1] + box[3]) / 2],
      [box[2] + 0.01, (box[1] + box[3]) / 2],
      [(box[0] + box[2]) / 2, box[1] - 0.01],
      [(box[0] + box[2]) / 2, box[3] + 0.01],
    ]) {
      expect(townCobbleAt(x, z, [], 3, lanes)).toBe(0);
    }
    // no lane laid: an inverted box that matches nothing
    const none = resolveCobbleLaneBox(resolveCobbleLanes([{ ...ZONE1_ZONE, id: 'elsewhere' }]));
    expect(none[0]).toBeGreaterThan(none[2]);
    expect(none[1]).toBeGreaterThan(none[3]);
  });

  it('spare slots never match, anywhere in the world', () => {
    const spare = lanes.filter((l) => l[0] >= 1e4);
    expect(spare.length).toBeGreaterThan(0);
    for (const [x, z] of [
      [0, 0],
      [-92, -56],
      [500, -500],
    ]) {
      expect(townCobbleAt(x, z, [], 3, spare)).toBe(0);
    }
  });
});

describe('painted height blend (paintedHeightBlend, the twin of paintedHeightBlendGlsl)', () => {
  // lanes: grass, dirt, rock, sand, leaf, earth, cobble
  const lanes = (over: Partial<Record<number, number>>, fill = 0) =>
    Array.from({ length: 7 }, (_, i) => over[i] ?? fill);

  it('returns weights that sum to one and never resurrects an absent layer', () => {
    const w = lanes({ 0: 0.6, 1: 0.4 });
    const h = lanes({ 0: -0.4, 1: -0.4, 6: 0.5 });
    const b = paintedHeightBlend(w, h, 0);
    expect(b.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 10);
    // the cobble lane is tallest but has no weight here: it stays at zero
    expect(b[6]).toBe(0);
  });

  it('at a 50/50 edge a raised cobble wins and grass fills the low gap', () => {
    const w = lanes({ 0: 0.5, 6: 0.5 });
    const stoneTop = paintedHeightBlend(w, lanes({ 0: -0.05, 6: 0.3 }), 0);
    expect(stoneTop[6]).toBeGreaterThan(0.95);
    const gap = paintedHeightBlend(w, lanes({ 0: 0.15, 6: -0.3 }), 0);
    expect(gap[0]).toBeGreaterThan(0.95);
  });

  it('a tall stone still pokes through where its weight is a third: the edge dissolves', () => {
    const b = paintedHeightBlend(lanes({ 0: 0.67, 6: 0.33 }), lanes({ 0: 0, 6: 0.3 }), 0);
    expect(b[6]).toBeGreaterThan(0.5);
  });

  it('the ragged field moves the boundary: grass gains where it runs high', () => {
    const w = lanes({ 0: 0.5, 1: 0.5 });
    const h = lanes({});
    expect(paintedHeightBlend(w, h, 0.2)[0]).toBeGreaterThan(0.95);
    expect(paintedHeightBlend(w, h, -0.2)[1]).toBeGreaterThan(0.95);
  });

  it('the tie window widens with distance, back toward the plain weighted blend', () => {
    expect(heightWindowAt(0)).toBeCloseTo(PAINTED_GROUND_TUNING.heightWindow, 10);
    expect(heightWindowAt(500)).toBeCloseTo(PAINTED_GROUND_TUNING.heightWindowFar, 10);
    expect(heightWindowAt(60)).toBeGreaterThan(heightWindowAt(30));
    // far away the mipped heights are flat: a 70/30 weight keeps both lanes
    const far = paintedHeightBlend(lanes({ 0: 0.7, 1: 0.3 }), lanes({}), 0, heightWindowAt(500));
    expect(far[0]).toBeGreaterThan(0.6);
    expect(far[1]).toBeGreaterThan(0.2);
    const near = paintedHeightBlend(lanes({ 0: 0.7, 1: 0.3 }), lanes({}), 0, heightWindowAt(0));
    expect(near[0]).toBe(1);
  });
});

describe('the GLSL twins carry the same numbers', () => {
  it('the cover block inlines the tuning the JS twin reads', () => {
    const glsl = paintedCoverGlsl();
    const T = PAINTED_GROUND_TUNING;
    for (const v of [T.leafFreqA, T.leafFreqB, T.earthFreq, T.ragFreq, T.leafZ0, T.earthZ1]) {
      expect(glsl).toContain(v.toFixed(4));
    }
    expect(glsl).toContain(`smoothstep(${T.coverFadeNear.toFixed(4)}`);
  });

  it('the declarations add uniforms and a tap function, never a sampler', () => {
    const glsl = paintedGroundDeclarationsGlsl();
    expect(glsl).toContain('uniform vec4 uCobbleTowns[2];');
    expect(glsl).not.toMatch(/uniform\s+sampler/);
  });
});

describe('grassFallbackTint (the no-bake arm recolours the tint-neutral grass)', () => {
  it('is identity until the layer mean is known and maps grey onto the photo green', () => {
    expect(grassFallbackTint(null)).toEqual([1, 1, 1]);
    const tint = grassFallbackTint([0.42, 0.42, 0.42]);
    for (const [c, t] of tint.entries()) expect(t * 0.42).toBeCloseTo(PHOTO_GRASS_MEAN[c], 6);
    // green dominates, as the photo layer did
    expect(tint[1]).toBeGreaterThan(tint[0]);
    expect(tint[0]).toBeGreaterThan(tint[2]);
  });
});

describe('painted relief (paintedBumpHeight, the twin of the wocBumpH arithmetic)', () => {
  const lanes = (over: Partial<Record<number, number>>, fill = 0) =>
    Array.from({ length: 7 }, (_, i) => over[i] ?? fill);
  const T = PAINTED_GROUND_TUNING;

  it('a cobble top stands proud of the turf filling the gap beside it', () => {
    // 50/50 cobble and grass: on a stone crown the cobble wins and the relief
    // height is its crown on its base level; in a gap the grass wins and the
    // relief drops to the turf plane, so the derivative between them is the
    // stone's rim standing proud of the grass
    const w = lanes({ 0: 0.5, 6: 0.5 });
    const crown = paintedBumpHeight(w, lanes({ 0: 0, 6: 0.3 }), 0);
    const gap = paintedBumpHeight(w, lanes({ 0: 0.1, 6: -0.3 }), 0);
    expect(crown).toBeCloseTo(0.3 * T.bumpYardsSub[2] + T.bumpLiftSub[2], 3);
    expect(gap).toBeLessThan(0.02);
    expect(crown - gap).toBeGreaterThan(0.08);
  });

  it('follows whichever layer wins: pure turf is flat, pure cobble carries its own form', () => {
    // grass carries its relief in its normal map, so its own height adds none
    const turf = paintedBumpHeight(lanes({ 0: 1 }), lanes({ 0: 0.3 }), 0);
    expect(turf).toBeCloseTo(T.bumpLift[0], 10);
    const hi = paintedBumpHeight(lanes({ 6: 1 }), lanes({ 6: 0.3 }), 0);
    const lo = paintedBumpHeight(lanes({ 6: 1 }), lanes({ 6: -0.3 }), 0);
    expect(hi - lo).toBeCloseTo(0.6 * T.bumpYardsSub[2], 6);
    // leaf litter sits a little above the turf, worn earth a little below it
    expect(paintedBumpHeight(lanes({ 4: 1 }), lanes({}), 0)).toBeGreaterThan(turf);
    expect(paintedBumpHeight(lanes({ 5: 1 }), lanes({}), 0)).toBeLessThan(turf);
  });

  it('every relief strength is a named knob, and the GLSL inlines them', () => {
    for (const key of [
      'normalGainGrass',
      'normalGainDirt',
      'normalGainRock',
      'bumpWindow',
      'bumpMaxSlope',
      'bumpStrength',
      'bumpFadeNear',
      'bumpFadeFar',
      'bumpGrazing0',
      'bumpGrazing1',
    ] as const) {
      expect(typeof T[key], key).toBe('number');
    }
    expect(T.bumpYards).toHaveLength(4);
    expect(T.bumpYardsSub).toHaveLength(3);
    expect(T.bumpLift).toHaveLength(4);
    expect(T.bumpLiftSub).toHaveLength(3);
    const glsl = paintedBumpGlsl();
    for (const v of [
      T.bumpFadeNear,
      T.bumpFadeFar,
      T.bumpGrazing0,
      T.bumpGrazing1,
      T.bumpMaxSlope,
    ]) {
      expect(glsl).toContain(v.toFixed(4));
    }
    // zero texture taps: the relief is derivatives of a value already shaded
    expect(glsl).not.toMatch(/texture|WOC_ALB|WOC_NRM/);
    expect(glsl).toContain('dFdx(wocBumpH)');
  });
});

describe('anti-repeat copy frame (rotateUv / rotateBack, the twins of wocRotUv / wocRotBack)', () => {
  it('turns a gradient sampled in the copy back into the base frame', () => {
    // a height that is linear in the COPY's uv: h(uv) = g . R uv + c. Its
    // gradient in the base uv frame is R^T g, which is what the detail normal
    // of the rotated tap must be turned back into before it is mixed
    for (const rot of Object.values(PAINTED_TAP_ROT)) {
      const g: [number, number] = [0.7, -0.3];
      const h = (u: number, v: number) => {
        const [cu, cv] = rotateUv(u, v, rot);
        return g[0] * cu + g[1] * cv;
      };
      const e = 1e-4;
      const du = (h(0.3 + e, 0.2) - h(0.3 - e, 0.2)) / (2 * e);
      const dv = (h(0.3, 0.2 + e) - h(0.3, 0.2 - e)) / (2 * e);
      const [bx, by] = rotateBack(g[0], g[1], rot);
      expect(bx).toBeCloseTo(du, 6);
      expect(by).toBeCloseTo(dv, 6);
      // and each rotation is a true rotation (unit determinant)
      expect(rot[0] * rot[0] + rot[1] * rot[1]).toBeCloseTo(1, 3);
    }
  });
});
