// The Quartered Isle's roads and lakes: a leaf with no imports, so the
// terrain modules (quartered_shatter.ts reads both to keep its fissures off
// them) can read the isle's ways without importing the zone file, which
// itself imports those terrain modules. Re-exported by quartered_isle.ts.

// The isle's roads. The Hoarbridge road runs north across the Sundered
// Crater's floor (in by the south ramp, out by the north) and climbs to
// Rivalmoot at the foot of the Gyre; the side roads leave the town through
// each quarter to its crossing, a track drops from the crater's west ramp
// into the mouth of the Hammer's Cut, and the north road leaves by the
// town's north side onto the Gyre's path.
export const QUARTERED_ISLE_ROADS: { x: number; z: number }[][] = [
  [
    { x: -2, z: 1866 },
    { x: -4, z: 1880 },
    { x: -4, z: 1905 },
    { x: 4, z: 1930 },
    { x: 12, z: 1946 },
    { x: 22, z: 1962 },
  ], // the Frostveil crown's north valley -> the Hoarbridge. It starts at the
  // valley head, past the rime elementals' and ice wisps' grounds, so the
  // relief a road calms never reaches their ground
  [
    { x: 22, z: 1962 },
    { x: 20, z: 2000 },
    { x: 8, z: 2028 },
    { x: 0, z: 2046 },
    { x: 0, z: 2122 },
    { x: 0, z: 2198 },
    { x: 0, z: 2222 },
    { x: 0, z: 2248 },
  ], // the Hoarbridge -> through the great crater -> up to Rivalmoot
  [
    { x: -72, z: 2122 },
    { x: -96, z: 2122 },
    { x: -100, z: 2148 },
    { x: -96, z: 2176 },
  ], // the crater's west ramp, out through its notch -> the mouth of the Hammer's Cut
  [
    { x: 0, z: 2248 },
    { x: 36, z: 2240 },
    { x: 84, z: 2200 },
    { x: 124, z: 2140 },
    { x: 152, z: 2098 },
    { x: 180, z: 2080 },
    { x: 214, z: 2078 },
    { x: 250, z: 2062 },
    { x: 276, z: 2044 },
  ], // Rivalmoot -> the Cinderscar -> over the crossing onto the Drakelands' Snowline road
  [
    { x: 0, z: 2248 },
    { x: -36, z: 2254 },
    { x: -86, z: 2262 },
    { x: -136, z: 2272 },
    { x: -180, z: 2274 },
    { x: -225, z: 2262 },
    { x: -272, z: 2226 },
  ], // Rivalmoot -> the Heavestone Wilds -> over the crossing to the Leaning Monolith road
  [
    { x: 0, z: 2248 },
    { x: 0, z: 2312 },
  ], // Rivalmoot's north road -> the foot of the Gyre's path (quartered_landmarks.ts)
];

// The Meltwater: a small fishing lake of Gyre runoff below Rivalmoot's west
// gate, kept whole while the ground round it shattered.
export const QUARTERED_ISLE_LAKES: readonly { x: number; z: number; radius: number }[] = [
  { x: -62, z: 2226, radius: 11 },
];
