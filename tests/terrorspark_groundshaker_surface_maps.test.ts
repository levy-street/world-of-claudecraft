import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildFabricAlbedo,
  buildFabricRelief,
  buildMetalAlbedo,
  buildMetalRelief,
  buildTankSurfaceMaps,
  NORMAL_SCALE,
  TANK_MAP_SPECS,
  type TankSurfaceMaps,
} from '../scripts/assets/terrorspark_groundshaker/surface_maps.mjs';
import { ORM_CENTER } from '../scripts/assets/terrorspark_groundshaker/surface_shading.mjs';

/** Spread of a large typed array. Math.min/max with a spread argument list
 *  blows the call stack at these resolutions. */
function extent(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index++) {
    if (values[index] < min) min = values[index];
    if (values[index] > max) max = values[index];
  }
  return { min, max };
}

/** Mean absolute step between two rows or columns of an authored field. */
function fieldSeamRatios(field: Float32Array, size: number): { across: number; down: number } {
  const column = (a: number, b: number) => {
    let total = 0;
    for (let y = 0; y < size; y++) total += Math.abs(field[y * size + a] - field[y * size + b]);
    return total / size;
  };
  const row = (a: number, b: number) => {
    let total = 0;
    for (let x = 0; x < size; x++) total += Math.abs(field[a * size + x] - field[b * size + x]);
    return total / size;
  };
  let adjacentAcross = 0;
  let adjacentDown = 0;
  for (let step = 1; step < size; step++) {
    adjacentAcross += column(step - 1, step);
    adjacentDown += row(step - 1, step);
  }
  adjacentAcross /= size - 1;
  adjacentDown /= size - 1;
  return {
    across: column(size - 1, 0) / adjacentAcross,
    down: row(size - 1, 0) / adjacentDown,
  };
}

let maps: TankSurfaceMaps;

async function decode(webp: Buffer): Promise<{
  width: number;
  height: number;
  channels: number;
  data: Buffer;
}> {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, channels: info.channels, data };
}

function channelMean(
  image: { width: number; height: number; channels: number; data: Buffer },
  channel: number,
): number {
  let total = 0;
  for (let index = channel; index < image.data.length; index += image.channels) {
    total += image.data[index];
  }
  return total / (image.data.length / image.channels);
}

describe('tank mount procedural surface maps', () => {
  beforeAll(async () => {
    maps = await buildTankSurfaceMaps();
  }, 60_000);

  it('builds both families at the pinned per-channel resolutions', async () => {
    expect(TANK_MAP_SPECS.metal.albedoSize).toBe(1024);
    expect(TANK_MAP_SPECS.metal.reliefSize).toBe(512);
    expect(TANK_MAP_SPECS.fabric.albedoSize).toBe(512);
    expect(TANK_MAP_SPECS.fabric.reliefSize).toBe(256);
    for (const [family, spec] of [
      ['metal', TANK_MAP_SPECS.metal],
      ['fabric', TANK_MAP_SPECS.fabric],
    ] as const) {
      const albedo = await decode(maps[family].albedo);
      expect([albedo.width, albedo.height], `${family} albedo size`).toEqual([
        spec.albedoSize,
        spec.albedoSize,
      ]);
      // Lossy webp always decodes to three channels; what matters is that the
      // albedo detail carries no colour of its own, so it only scales the
      // material's base colour instead of tinting it.
      let chroma = 0;
      for (let pixel = 0; pixel * albedo.channels < albedo.data.length; pixel++) {
        const base = pixel * albedo.channels;
        chroma += Math.abs(albedo.data[base] - albedo.data[base + albedo.channels - 1]);
      }
      expect(
        chroma / (albedo.data.length / albedo.channels),
        `${family} albedo is achromatic`,
      ).toBeLessThan(1);
      for (const channel of ['normal', 'orm'] as const) {
        const relief = await decode(maps[family][channel]);
        expect([relief.width, relief.height], `${family} ${channel} size`).toEqual([
          spec.reliefSize,
          spec.reliefSize,
        ]);
        expect(relief.channels, `${family} ${channel} is RGB`).toBe(3);
      }
    }
  });

  it('tiles seamlessly on both axes, including the stretched bands', () => {
    // Asserted on the authored fields, not the encoded maps: webp puts a
    // macroblock edge on the wrap seam, which swamps the signal (every channel,
    // even a constant one, reads a raised seam after encoding).
    //
    // Sensitivity: a band that wraps on a single shared period leaves the other
    // axis' lattice never reaching its wrap point. That shipped once and put the
    // seam an order of magnitude above the local step; here every seam has to
    // stay within a small multiple of it.
    const metal = TANK_MAP_SPECS.metal;
    const fabric = TANK_MAP_SPECS.fabric;
    const relief = buildMetalRelief(metal.reliefSize, metal);
    const fields: [string, Float32Array, number][] = [
      ['metal albedo', buildMetalAlbedo(metal.albedoSize, metal), metal.albedoSize],
      ['metal height', relief.height, metal.reliefSize],
      ['metal wear', relief.wear, metal.reliefSize],
      ['fabric albedo', buildFabricAlbedo(fabric.albedoSize, fabric), fabric.albedoSize],
      ['fabric height', buildFabricRelief(fabric.reliefSize, fabric), fabric.reliefSize],
    ];
    for (const [name, field, size] of fields) {
      const ratios = fieldSeamRatios(field, size);
      expect(ratios.across, `${name} wrap seam across`).toBeLessThan(2.5);
      expect(ratios.down, `${name} wrap seam down`).toBeLessThan(2.5);
    }
  });

  it('gives every authored field real interior variation to tile', () => {
    const metal = TANK_MAP_SPECS.metal;
    const albedo = extent(buildMetalAlbedo(metal.albedoSize, metal));
    expect(albedo.max - albedo.min).toBeGreaterThan(0.15);
    const relief = buildMetalRelief(metal.reliefSize, metal);
    const height = extent(relief.height);
    expect(height.max - height.min).toBeGreaterThan(0.4);
    expect(extent(relief.wear).max).toBeGreaterThan(0.8);
  });

  it('centres the ORM roughness and metalness channels on the factor midtone', async () => {
    const expected = ORM_CENTER * 255;
    for (const family of ['metal', 'fabric'] as const) {
      const orm = await decode(maps[family].orm);
      for (const channel of [1, 2]) {
        expect(channelMean(orm, channel), `${family} ORM channel ${channel}`).toBeGreaterThan(
          expected - 12,
        );
        expect(channelMean(orm, channel), `${family} ORM channel ${channel}`).toBeLessThan(
          expected + 12,
        );
      }
      // Occlusion rides high with cavity darkening cut into it.
      expect(channelMean(orm, 0), `${family} ORM occlusion`).toBeGreaterThan(expected);
    }
  });

  it('authors every channel from its own field rather than aliasing one', async () => {
    for (const family of ['metal', 'fabric'] as const) {
      const orm = await decode(maps[family].orm);
      let occlusionVsRoughness = 0;
      let roughnessVsMetalness = 0;
      const pixels = orm.data.length / orm.channels;
      for (let pixel = 0; pixel < pixels; pixel++) {
        const base = pixel * orm.channels;
        occlusionVsRoughness += Math.abs(orm.data[base] - orm.data[base + 1]);
        roughnessVsMetalness += Math.abs(orm.data[base + 1] - orm.data[base + 2]);
      }
      expect(occlusionVsRoughness / pixels, `${family} occlusion vs roughness`).toBeGreaterThan(2);
      expect(roughnessVsMetalness / pixels, `${family} roughness vs metalness`).toBeGreaterThan(1);
    }
  });

  it('keeps the albedo a high-key multiplier that never brightens the base colour', async () => {
    for (const family of ['metal', 'fabric'] as const) {
      const albedo = await decode(maps[family].albedo);
      const spread = extent(albedo.data);
      expect(spread.max, `${family} albedo peak`).toBeLessThanOrEqual(255);
      expect(channelMean(albedo, 0), `${family} albedo mean`).toBeGreaterThan(235);
      expect(channelMean(albedo, 0), `${family} albedo mean`).toBeLessThan(254);
      expect(spread.min, `${family} albedo has real range`).toBeLessThan(242);
    }
  });

  it('produces normal maps that lean off flat without inverting', async () => {
    for (const family of ['metal', 'fabric'] as const) {
      const normal = await decode(maps[family].normal);
      // Blue stays dominant (a tangent-space normal pointing out of the surface)
      // while red and green centre on 128 and carry the relief.
      expect(channelMean(normal, 2), `${family} normal blue`).toBeGreaterThan(200);
      for (const channel of [0, 1]) {
        expect(channelMean(normal, channel), `${family} normal channel ${channel}`).toBeGreaterThan(
          118,
        );
        expect(channelMean(normal, channel), `${family} normal channel ${channel}`).toBeLessThan(
          138,
        );
      }
      let leaning = 0;
      const pixels = normal.data.length / normal.channels;
      for (let pixel = 0; pixel < pixels; pixel++) {
        const base = pixel * normal.channels;
        if (Math.abs(normal.data[base] - 128) > 6 || Math.abs(normal.data[base + 1] - 128) > 6) {
          leaning++;
        }
      }
      expect(leaning / pixels, `${family} normal relief coverage`).toBeGreaterThan(0.1);
    }
  });

  it('emits a contact sheet of all six maps for the authoring evidence', async () => {
    const preview = await sharp(maps.preview).metadata();
    expect(preview.format).toBe('png');
    expect(preview.width).toBeGreaterThan(700);
    expect(preview.height).toBeGreaterThan(500);
  });

  it('pins the normal scale the exporter stamps on every material', () => {
    expect(NORMAL_SCALE).toBe(0.85);
  });

  it('is byte-reproducible across runs', async () => {
    const again = await buildTankSurfaceMaps();
    for (const family of ['metal', 'fabric'] as const) {
      for (const channel of ['albedo', 'normal', 'orm'] as const) {
        expect(
          again[family][channel].equals(maps[family][channel]),
          `${family} ${channel} reproducible`,
        ).toBe(true);
      }
    }
  }, 60_000);
});
