import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type BucketWindowInput,
  bucketVisible,
  fogBlendAt,
  foliageDistanceScale,
  foliageFogLimit,
  IMPOSTOR_MIN_FOG_BLEND,
  LOD_HIGH,
  LOD_LOW,
  lodDistsFor,
  treeDetailDistance,
} from '../src/render/foliage_lod';

// The adaptive budget's foliage lever spans [0, 1]; the distance scale and the
// fog cull both derive from it, so tests must move them as the one dial they
// are. 0 is the starved floor (high-tier scale 0.72), 1 the rested ceiling.
const QUALITY_LEVELS = [0, 0.35, 0.5, 0.72, 1];
const WORST_SCALE = foliageDistanceScale(0, false);
const BEST_SCALE = foliageDistanceScale(1, false);

/** The live update() pairing of (distanceScale, fogLimit, detailFar) at one governor level. */
function detailAt(
  fog: { near: number; far: number },
  modelQuality: number,
  leanFoliage = false,
): { detailFar: number; fogLimit: number } {
  const fogLimit = foliageFogLimit(fog.far, modelQuality);
  const base = lodDistsFor(leanFoliage).treeDetailFar;
  const scale = foliageDistanceScale(modelQuality, leanFoliage);
  return { detailFar: treeDetailDistance(base, fog.near, fog.far, scale, fogLimit), fogLimit };
}

// The shipped per-biome fog, parsed from the renderer rather than restated here,
// so a new zone (or a widened view distance) is covered by these tests the day it
// lands instead of the day someone remembers to update a fixture. `far` may be a
// numeric literal OR the MAX_OUTDOOR_FOG_FAR constant (the open-sky realms), and
// the row-count pin below makes a silently unparseable row a failure, not a
// silently shrunken sweep.
const rendererSrc = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

function maxOutdoorFogFar(): number {
  const src = readFileSync(new URL('../src/render/zone_streaming.ts', import.meta.url), 'utf8');
  const value = Number(/MAX_OUTDOOR_FOG_FAR = ([\d.]+)/.exec(src)?.[1]);
  expect(value, 'MAX_OUTDOOR_FOG_FAR not found in zone_streaming.ts').toBeGreaterThan(0);
  return value;
}

function shippedBiomeFog(): { biome: string; near: number; far: number }[] {
  const maxFar = maxOutdoorFogFar();
  const block = /BIOME_FOG[^{]*\{([\s\S]*?)\n {2}\};/.exec(rendererSrc);
  expect(block, 'BIOME_FOG table not found in renderer.ts').not.toBe(null);
  const body = (block as RegExpExecArray)[1];
  const rows = [...body.matchAll(/(\w+):\s*\{[^}]*near:\s*([\d.]+),\s*far:\s*([\w.]+)/g)].map(
    (m) => ({
      biome: m[1],
      near: Number(m[2]),
      far: m[3] === 'MAX_OUTDOOR_FOG_FAR' ? maxFar : Number(m[3]),
    }),
  );
  const declaredRows = body.match(/\w+:\s*\{\s*color:/g) ?? [];
  expect(rows.length, 'a BIOME_FOG row failed to parse').toBe(declaredRows.length);
  expect(rows.length, 'parsed no fog rows out of BIOME_FOG').toBeGreaterThan(3);
  for (const r of rows) {
    expect(Number.isFinite(r.near) && Number.isFinite(r.far), `row ${r.biome}`).toBe(true);
  }
  return rows;
}

// The one preset the lean tier ever sees: outdoorFogPreset() returns LOW_FOG on
// the low tier, so the lean sweep runs against it rather than the biome table.
function shippedLowFog(): { biome: string; near: number; far: number } {
  const m = /LOW_FOG = \{ color: \w+, near: ([\d.]+), far: ([\d.]+) \}/.exec(rendererSrc);
  expect(m, 'LOW_FOG preset not found in renderer.ts').not.toBe(null);
  const [, near, far] = m as RegExpExecArray;
  return { biome: 'low-tier', near: Number(near), far: Number(far) };
}

const FOG_ROWS = shippedBiomeFog();
const fogOf = (biome: string): { near: number; far: number } => {
  const row = FOG_ROWS.find((r) => r.biome === biome);
  expect(row, `no shipped fog row for ${biome}`).toBeDefined();
  return row as { near: number; far: number };
};

function windowFor(over: Partial<BucketWindowInput> & { centerDist: number }): BucketWindowInput {
  return {
    radius: 0,
    distanceScale: BEST_SCALE,
    detailFar: 300,
    revealScale: 1,
    fogLimit: Number.POSITIVE_INFINITY,
    ...over,
  };
}
// The two buckets a species places over the SAME trees: the real GLB model
// inside the detail radius, the baked sprite impostor outside it.
const realTrees = (centerDist: number, over: Partial<BucketWindowInput> = {}) =>
  windowFor({ centerDist, maxAtDetail: true, ...over });
const impostors = (centerDist: number, over: Partial<BucketWindowInput> = {}) =>
  windowFor({ centerDist, minAtDetail: true, ...over });

// treeDetailDistance is the LEAN arm's law now (the sprite arm follows the
// budget: spriteSwapDistance, pinned in tests/foliage_impostor_core.test.ts).
// On lean there is nothing past the boundary at all, so the blend law is what
// keeps the forest from visibly ENDING in clear air; the sweep runs the whole
// shipped preset table through it because the function must hold for any fog
// pair it could ever be fed.
describe('foliage LOD: the lean-arm treeline never ends in clear air', () => {
  const qualityCases = [
    ...FOG_ROWS.flatMap((fog) => QUALITY_LEVELS.map((q) => ({ ...fog, q, lean: false }))),
    ...QUALITY_LEVELS.map((q) => ({ ...shippedLowFog(), q, lean: true })),
  ];

  it.each(qualityCases)(
    'biome $biome at quality $q (lean $lean): swap under heavy fog, never past the cull',
    ({ near, far, q, lean }) => {
      const { detailFar, fogLimit } = detailAt({ near, far }, q, lean);
      // Real trees must never be drawn past the line the fog cull drops them at.
      expect(detailFar).toBeLessThanOrEqual(fogLimit);
      // A starved budget can never drag the swap into clear air: the floor (or,
      // when even the floor is culled, the cull line itself) always holds.
      const fogFloor = near + IMPOSTOR_MIN_FOG_BLEND * (far - near);
      expect(detailFar).toBeGreaterThanOrEqual(Math.min(fogFloor, fogLimit));
      // Where an impostor band exists at all, it starts inside the murk.
      if (detailFar < fogLimit) {
        expect(fogBlendAt(detailFar, near, far)).toBeGreaterThanOrEqual(
          IMPOSTOR_MIN_FOG_BLEND - 1e-9,
        );
      }
    },
  );

  it('regression: a build-time 300u boundary ended the treeline half-clear in long-fog zones', () => {
    // This is the reported bug, not the fix's own arithmetic. The open-sky Vale
    // runs to MAX_OUTDOOR_FOG_FAR; a flat 300u boundary sits far short of its
    // fog floor, i.e. the forest visibly stops. Revert treeDetailDistance to a
    // constant and this fails.
    const vale = fogOf('vale');
    expect(fogBlendAt(300, vale.near, vale.far)).toBeLessThan(IMPOSTOR_MIN_FOG_BLEND);

    const { detailFar: fixed } = detailAt(vale, 1);
    expect(fixed).toBeGreaterThan(LOD_HIGH.treeDetailFar);
    expect(fogBlendAt(fixed, vale.near, vale.far)).toBeGreaterThanOrEqual(IMPOSTOR_MIN_FOG_BLEND);
  });

  it('a starved frame budget cannot drag the treeline toward the camera', () => {
    // The budget dips while assets decode and shaders compile; the detail
    // radius must not march in with it (300 * 0.72 = 216u) on the arm where
    // nothing stands past the boundary. In the shipped Vale the floor sits
    // inside the cull at every quality, so starved and rested must land on
    // the same fog-floor boundary.
    const vale = fogOf('vale');
    const starved = detailAt(vale, 0);
    const rested = detailAt(vale, 1);

    expect(starved.detailFar).toBeGreaterThan(LOD_HIGH.treeDetailFar * WORST_SCALE);
    expect(rested.detailFar).toBe(vale.near + IMPOSTOR_MIN_FOG_BLEND * (vale.far - vale.near));
    expect(starved.detailFar).toBe(rested.detailFar); // fog floor dominates: no pop either way
  });

  it('short-fog realms retreat the boundary to the fog floor', () => {
    // The marsh closes at 165u while the budgeted radius is 216-300u, so the
    // boundary used to land past the fog cull at EVERY governor level and real
    // trees were drawn right up to the line that culled them (measured live:
    // core 1.36M triangles past any use).
    const marsh = fogOf('marsh');
    const floor = marsh.near + IMPOSTOR_MIN_FOG_BLEND * (marsh.far - marsh.near); // 138

    for (const q of [0.5, 0.72, 1]) {
      const { detailFar, fogLimit } = detailAt(marsh, q);
      expect(detailFar, `quality ${q} must leave an impostor band`).toBeLessThan(fogLimit);
      expect(detailFar).toBe(floor);
    }
    // At the starved floor the cull line sits under the fog floor: no band, and
    // real trees run to the cull rather than past it.
    const starved = detailAt(marsh, 0);
    expect(starved.detailFar).toBe(starved.fogLimit);
  });

  it('the cave keeps its boundary cheap AND inside the cull', () => {
    // Pre-fix pin: best-scale cave detail was the flat 300u constant, far past
    // its own fog wall. The retreat rule pulls it to the fog floor, which is
    // BOTH cheaper than the old constant and inside the cull.
    const cave = fogOf('cave');
    const floor = cave.near + IMPOSTOR_MIN_FOG_BLEND * (cave.far - cave.near);
    for (const q of QUALITY_LEVELS) {
      const { detailFar, fogLimit } = detailAt(cave, q);
      expect(detailFar).toBe(Math.min(floor, fogLimit));
      expect(detailFar).toBeLessThanOrEqual(300);
    }
  });

  it('a residency fog wall never pulls the boundary toward the camera', () => {
    // The streaming clamp can pin the LIVE fog at a 45u wall while the zone
    // builds. The boundary reads the ATMOSPHERIC fog (the update() contract),
    // so during the wall it parks ON the live cull: real trees to the wall,
    // nothing missing a few strides from the camera. Feeding it the clamped
    // pair instead would retreat it to ~39u; this pins the split.
    const garden = fogOf('garden');
    for (const q of QUALITY_LEVELS) {
      const liveCull = foliageFogLimit(45, q);
      const detailFar = treeDetailDistance(
        LOD_HIGH.treeDetailFar,
        garden.near,
        garden.far,
        foliageDistanceScale(q, false),
        liveCull,
      );
      expect(detailFar).toBe(liveCull);
      expect(liveCull).toBeLessThanOrEqual(45);
    }
  });

  it('a malformed near-past-far pair still cannot push trees past the cull', () => {
    // Defense in depth for the degenerate arm: with fogFar <= fogNear the fog
    // arithmetic is meaningless, and the budgeted radius must still respect
    // the cull. Pre-fix this returned the raw 300u budget.
    expect(treeDetailDistance(300, 175, 45, 1, foliageFogLimit(45, 1))).toBe(45);
  });
});

describe('foliage LOD: the governor formulas are pinned', () => {
  it('distance scale endpoints', () => {
    expect([
      foliageDistanceScale(0, false),
      foliageDistanceScale(1, false),
      foliageDistanceScale(0, true),
      foliageDistanceScale(1, true),
    ]).toEqual([0.72, 1, 0.56, 1]);
  });

  it('fog limit endpoints', () => {
    expect(foliageFogLimit(100, 0)).toBe(78);
    expect(foliageFogLimit(100, 1)).toBe(100);
  });

  it('the blend law constant', () => {
    // Every impostor guarantee above is relative to this; a silent relaxation
    // (0.7 -> 0.75 passed every relative test) must not slip through.
    expect(IMPOSTOR_MIN_FOG_BLEND).toBe(0.7);
  });
});

describe('foliage LOD: the real-model and impostor windows cover the world', () => {
  const detailFar = 368; // the Vale's fog-derived swap

  it('every distance is covered; the two overlap exactly while a bucket straddles the swap', () => {
    for (const radius of [0, 60, 120]) {
      for (let d = radius; d <= 900; d += 7) {
        const drawn = [
          realTrees(d, { detailFar, radius }),
          impostors(d, { detailFar, radius }),
        ].filter(bucketVisible).length;
        // A bucket overlapping the swap draws both meshes and the
        // per-instance shader windows (foliage_collapse.ts) split its trees
        // exactly; everywhere else exactly one mesh draws. 0 is a hole in
        // the forest; 2 outside the straddle is a double-drawn tree.
        const straddles = d - radius < detailFar && d + radius >= detailFar;
        expect(drawn, `radius ${radius}, distance ${d}`).toBe(straddles ? 2 : 1);
      }
    }
  });

  it('a zero-depth bucket keeps the exact one-LOD partition', () => {
    for (let d = 0; d <= 900; d += 7) {
      const drawn = [realTrees(d, { detailFar }), impostors(d, { detailFar })].filter(
        bucketVisible,
      ).length;
      expect(drawn, `distance ${d}`).toBe(1);
    }
  });

  it('a bucket you are standing at the edge of still draws real trees', () => {
    // Buckets are 240u deep. Keyed on the bucket CENTER, a bucket whose near edge
    // is right under the player could already have flipped to cones. Keyed on the
    // near edge, it cannot.
    const radius = 120;
    const straddling = detailFar + 60; // center past the swap, near edge well inside
    expect(bucketVisible(realTrees(straddling, { detailFar, radius }))).toBe(true);
    // its far half already belongs to the impostor mesh (instances inside the
    // swap collapse in the shader), so the same bucket draws impostors too
    expect(bucketVisible(impostors(straddling, { detailFar, radius }))).toBe(true);

    const wellPast = detailFar + radius + 1; // the whole bucket is past the swap
    expect(bucketVisible(realTrees(wellPast, { detailFar, radius }))).toBe(false);
    expect(bucketVisible(impostors(wellPast, { detailFar, radius }))).toBe(true);

    const wellInside = detailFar - radius - 1; // the whole bucket is inside it
    expect(bucketVisible(realTrees(wellInside, { detailFar, radius }))).toBe(true);
    expect(bucketVisible(impostors(wellInside, { detailFar, radius }))).toBe(false);
  });

  it('a bucket whose far edge sits exactly on the swap still draws impostors', () => {
    // The impostor arm is a strict <: an instance AT detailFar belongs to the
    // impostor window ([treeMax, fogCull) includes its lower bound), so the
    // bucket that could hold it must not be culled. <= here would drop that
    // tree from both meshes.
    const radius = 120;
    const detailFar = 368;
    const onBoundary = detailFar - radius; // far edge == detailFar exactly
    expect(bucketVisible(impostors(onBoundary, { detailFar, radius }))).toBe(true);
    expect(bucketVisible(impostors(onBoundary - 1, { detailFar, radius }))).toBe(false);
  });

  it('the near-fill half still culls its real geometry at its own cap', () => {
    // Half of each species keeps a tighter real-geometry cap to keep the far
    // field cheap. (On the sprite arm those trees carry on as sprites in the
    // bucket's shared impostor mesh, whose row has no such cap.)
    const fill = LOD_HIGH.treeFillFar; // 310, inside this detailFar of 368
    const nearFillTrees = (d: number) => realTrees(d, { detailFar, maxDist: fill });
    expect(bucketVisible(nearFillTrees(fill - 1))).toBe(true);
    expect(bucketVisible(nearFillTrees(fill + 1))).toBe(false);
  });

  it('buckets behind the fog wall are dropped whichever LOD they are', () => {
    const fogLimit = 400;
    expect(bucketVisible(impostors(500, { detailFar, fogLimit }))).toBe(false);
    expect(bucketVisible(realTrees(500, { detailFar, fogLimit }))).toBe(false);
    expect(bucketVisible(impostors(380, { detailFar, fogLimit }))).toBe(true);
  });

  it('a cost cap cuts on the bucket CENTER, not its near edge', () => {
    // Buckets are ~240u deep. The density/rock/dressing caps exist to cut
    // triangles, so measuring them from the near edge would keep every bucket
    // alive for another half-bucket past its cap: measured live in the Vale, that
    // one slip took foliage from ~1.0M to ~4.6M triangles a frame. Only the
    // detail swap gets the near-edge treatment.
    const radius = 120;
    const cap = LOD_HIGH.treeFillFar; // 310
    const pastCap = windowFor({
      centerDist: cap + 20, // center is past the cap...
      radius, // ...but the near edge (410 - 120 = 190) is well inside it
      maxDist: cap,
      detailFar: 368,
    });
    expect(bucketVisible(pastCap)).toBe(false);
    expect(bucketVisible({ ...pastCap, centerDist: cap - 20 })).toBe(true);
  });

  it('the budget still scales build-time bounds, just not the fog-derived one', () => {
    // A plain numeric bound (rocks, dressing, the near-fill cull) keeps shrinking
    // under load, which is the budget's whole point. rockFar 360 at half budget
    // is 180, so a rock bucket at 200u is culled.
    const rock = windowFor({ centerDist: 200, maxDist: LOD_HIGH.rockFar, distanceScale: 0.5 });
    expect(bucketVisible(rock)).toBe(false);
    expect(bucketVisible({ ...rock, distanceScale: 1 })).toBe(true);
  });
});

describe('foliage LOD: sprite rows (the merged per-bucket impostor meshes)', () => {
  const spriteRow = (centerDist: number, over: Partial<BucketWindowInput> = {}) =>
    windowFor({
      centerDist,
      minAtDetail: true,
      spriteRow: true,
      detailFar: 300,
      swapFade: 24,
      fogLimit: 546,
      spriteFar: 700,
      ...over,
    });

  it('comes alive at the earliest jittered handoff, radius aware', () => {
    const radius = 120;
    // nearest instance a bucket could hold sits at centerDist + radius; the
    // earliest handoff any instance can take is detailFar - swapFade
    expect(bucketVisible(spriteRow(300 - 24 - radius, { radius }))).toBe(true);
    expect(bucketVisible(spriteRow(300 - 24 - radius - 1, { radius }))).toBe(false);
  });

  it('dies at the LIVE fog wall, not the model-quality-trimmed foliage cull', () => {
    // fogLimit here is 546 (the mq trim of a 700 wall); a sprite is 2
    // triangles, so trimming it before the fog swallows it saves nothing and
    // pops the picture. The row must survive to the wall itself.
    expect(bucketVisible(spriteRow(600))).toBe(true);
    expect(bucketVisible(spriteRow(701))).toBe(false);
  });

  it('rock and dress rows key on their own swap via detailFar', () => {
    // The caller passes the row's category swap in detailFar; a rock bucket
    // whose center is inside the rock swap but whose far half is beyond it
    // must stay alive for its sprites.
    const radius = 120;
    expect(bucketVisible(spriteRow(345.6 - 24 - radius, { detailFar: 345.6, radius }))).toBe(true);
    expect(bucketVisible(spriteRow(345.6 - 24 - radius - 1, { detailFar: 345.6, radius }))).toBe(
      false,
    );
  });

  it('legacy rows are unaffected by the sprite fields', () => {
    // A lean-arm row (spriteRow unset) keeps the plain minAtDetail and the
    // trimmed fog cull, even when the shared input object carries sprite
    // values from a previous iteration.
    const legacy = windowFor({
      centerDist: 600,
      minAtDetail: true,
      detailFar: 300,
      fogLimit: 546,
      swapFade: 24,
      spriteFar: 700,
    });
    expect(bucketVisible(legacy)).toBe(false); // near edge 600 >= fogLimit 546
    expect(bucketVisible({ ...legacy, centerDist: 500 })).toBe(true);
  });
});

describe('foliage LOD: tiers and purity', () => {
  it('hands the low tier its own, tighter table', () => {
    expect(lodDistsFor(true)).toBe(LOD_LOW);
    expect(lodDistsFor(false)).toBe(LOD_HIGH);
    expect(LOD_LOW.treeDetailFar).toBeLessThan(LOD_HIGH.treeDetailFar);
  });

  it('stays a pure decision module: no Three, no sim', () => {
    const src = readFileSync(new URL('../src/render/foliage_lod.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import/m);
  });
});
