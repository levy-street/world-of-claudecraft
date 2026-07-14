// Shared deterministic sample grid for the terrainHeight bit-identity pin
// (tests/terrain_rim_earlyout.test.ts). Not a *.test.ts, so vitest imports it
// as a helper rather than running it. The grid deliberately spans every branch
// of terrainHeight(x, z, seed): the open world (rim === 0, no ridge), the outer
// rim bands on all three edges (rim > 0), the inter-zone ridge walls and their
// road pass (pass === 0), the outside-fade overshoot (mountainDetail < 1),
// camps, the Sowfield, and the Mirefen impact crater. World geometry: x spans
// [-180, 180], z spans [-180, 900], ridges sit at z = 180 and z = 540 (passX 0).

export type GridPoint = [x: number, z: number, seed: number];

// The IEEE-754 bit pattern of a double as a 16-char hex string. Comparing these
// is a true bit-for-bit check: it distinguishes -0 from +0 and every NaN
// payload, which a numeric === would silently treat as equal.
export function f64hex(n: number): string {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, n, false);
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < 8; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

const SEEDS = [1, 12345, 305419896];

// Terrain geometry is seed-independent (zones, ridges, camps); only the fbm2
// noise layered on top varies with the seed. Sampling several seeds exercises
// the noise-bearing branches (rimCrest, the ridge crest) with distinct values.
export function buildTerrainGrid(): GridPoint[] {
  const points: GridPoint[] = [];
  const push = (x: number, z: number) => {
    for (const seed of SEEDS) points.push([x, z, seed]);
  };

  // Open-world interior sweep across all three zones (rim === 0, off every
  // ridge for most of it): the hot path the early-out targets.
  for (let x = -170; x <= 170; x += 17) {
    for (let z = -160; z <= 840; z += 23) push(x, z);
  }

  // The two inter-zone ridge walls (z = 180, z = 540) and their approaches,
  // including the road pass where pass === 0 (|x| <= PASS_HALF_WIDTH = 10) and
  // the off-pass wall where the crest noise is live.
  const ridgeZ = [
    160, 170, 175, 178, 180, 182, 185, 190, 200, 520, 530, 535, 538, 540, 542, 545, 550, 560,
  ];
  const ridgeX = [-170, -120, -60, -34, -20, -11, -10, -5, 0, 5, 10, 11, 20, 34, 60, 120, 170];
  for (const z of ridgeZ) for (const x of ridgeX) push(x, z);

  // Outer rim on the x edges (rim > 0 from rimX): the smoothstep ramps up over
  // |x| in [WORLD_MAX_X - 30, WORLD_MAX_X - 6] = [150, 174].
  const rimX = [148, 150, 155, 160, 165, 170, 174, 176, 178, 180];
  for (const ax of rimX) {
    for (const z of [-100, -20, 60, 140, 300, 500, 700, 860]) {
      push(ax, z);
      push(-ax, z);
    }
  }

  // Outer rim on the south edge (rimS: z in [minZ + 6, minZ + 30] = [-174, -150])
  // and the north edge (rimN: z in [maxZ - 30, maxZ - 6] = [870, 894]).
  for (const z of [-180, -176, -174, -170, -160, -155, -150, -145, -130]) {
    for (const x of [-120, -40, 0, 40, 120]) push(x, z);
  }
  for (const z of [860, 866, 870, 875, 880, 890, 894, 898, 900]) {
    for (const x of [-120, -40, 0, 40, 120]) push(x, z);
  }

  // Outside-fade overshoot (beyond > 0, so mountainDetail < 1): the never-walked
  // staging ground past the rectangle on all sides and the far corners.
  const overshoot: Array<[number, number]> = [
    [185, 100],
    [200, 100],
    [220, -50],
    [-185, 300],
    [-220, 500],
    [260, 260],
    [0, -181],
    [0, -190],
    [0, -220],
    [100, -1000],
    [-100, 950],
    [0, 1000],
    [180, -180],
    [-180, -180],
    [180, 900],
    [-180, 900],
    [185, -185],
    [-185, 905],
    [200, 905],
    [-200, -185],
  ];
  for (const [x, z] of overshoot) push(x, z);

  // Camp flatten blends (a subset of the content camps) and points at their
  // rims, plus the Sowfield plateau and the Mirefen impact crater.
  const features: Array<[number, number]> = [
    [-40, 230],
    [35, 225],
    [-82, 273],
    [-132, 333],
    [70, 300],
    [98, 348],
    [90, 420],
    [-11, -112],
    [-11, -100],
    [-11, -130],
    [0, -112],
    [-40, -112],
    [149.5, 295],
    [149.5, 280],
    [149.5, 310],
    [130, 295],
    [170, 295],
  ];
  for (const [x, z] of features) push(x, z);

  return points;
}
