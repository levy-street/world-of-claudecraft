// The meadow's coverage gate and blade size, shared by the near blade carpet
// (blade_grass.ts) and the mid band (blade_grass_band.ts), which must stay one
// look. Pure: a Vitest drives it directly.
//
// The palette lab (src/render/palette_lab/) can make a zone's meadow fuller
// (`setMeadowFullness`): more cells grow a blade, so the bare soil between
// lush patches closes into one carpet, and blades stand taller. Unset, every
// value is the shipped formula exactly, so a normal session places the same
// blades at the same sizes it always did.

/** A meadow fullness setting. Stock is `{ coverage: 0, height: 1, width: 1 }`. */
export interface MeadowFullness {
  /** 0 is the shipped patchy carpet; 1 grows a blade in nearly every cell. */
  readonly coverage: number;
  /** Blade height multiplier (1 is shipped). */
  readonly height: number;
  /** Cluster width multiplier (1 is shipped): wider, more spread blades, so
   *  the carpet closes over the soil between clusters. */
  readonly width: number;
}

export const STOCK_MEADOW: MeadowFullness = { coverage: 0, height: 1, width: 1 };

/** The largest stretch (height or width) a lab setting may ask for. The carpet
 *  widens its culling bound by this in a lab session, so a bigger cluster never
 *  pops out at a sector edge; a normal session keeps the shipped bound. */
export const MEADOW_MAX_STRETCH = 1.6;

// The shipped coverage curve: floor 0.44 plus the squared soil lushness.
const COVERAGE_FLOOR = 0.44;
const COVERAGE_LUSH_GAIN = 1.7;
const COVERAGE_BOOST = 1.05;
const BIOME_DENSITY_CAP = 1.2;

let current: MeadowFullness = STOCK_MEADOW;
let version = 0;

/** Set the meadow fullness (null restores stock). Returns true on a change. */
export function setMeadowFullness(next: MeadowFullness | null): boolean {
  const raw = next ?? STOCK_MEADOW;
  const value: MeadowFullness = {
    coverage: Math.min(1, Math.max(0, raw.coverage)),
    height: Math.min(MEADOW_MAX_STRETCH, Math.max(0.5, raw.height)),
    width: Math.min(MEADOW_MAX_STRETCH, Math.max(0.5, raw.width)),
  };
  if (
    value.coverage === current.coverage &&
    value.height === current.height &&
    value.width === current.width
  ) {
    return false;
  }
  current = value;
  version++;
  return true;
}

export function meadowFullness(): MeadowFullness {
  return current;
}

/** Bumped on every change, so a carpet knows to re-place its blades. */
export function meadowFullnessVersion(): number {
  return version;
}

/**
 * Does a cell grow a blade? `roll` is the cell's own hash in [0, 1), `lush`
 * the soil lushness at the cell, `biomeDensity` the biome's grass density.
 * Fullness lifts the floor toward 1, so bare patches fill in from the edges
 * of the lush ones rather than all at once.
 */
export function meadowCellGrows(
  roll: number,
  lush: number,
  biomeDensity: number,
  fullness: MeadowFullness = current,
): boolean {
  const floor = COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * fullness.coverage;
  return (
    roll <
    (floor + COVERAGE_LUSH_GAIN * lush * lush) *
      COVERAGE_BOOST *
      Math.min(biomeDensity, BIOME_DENSITY_CAP)
  );
}

/**
 * A blade cluster's scale: `sizeRoll` and `tuftRoll` are the cell's hashes,
 * `lush` the soil lushness. Returns the uniform scale; the caller stretches
 * height by `meadowHeightStretch`. Fullness also lifts the size floor that
 * thin soil applies, so a full meadow is not a carpet of stubs.
 */
export function meadowBladeScale(
  sizeRoll: number,
  tuftRoll: number,
  lush: number,
  fullness: MeadowFullness = current,
): number {
  const lushHere = 0.5 + lush * 0.6 + (1.1 - (0.5 + lush * 0.6)) * fullness.coverage * 0.5;
  let s = (0.22 + sizeRoll * 0.34) * lushHere;
  if (tuftRoll < 0.1) s *= 1.5 + tuftRoll * 3.0;
  return s;
}

/** The height stretch on top of the uniform scale. */
export function meadowHeightStretch(
  lush: number,
  heightJitter: number,
  fullness: MeadowFullness = current,
): number {
  return (0.85 + lush * 0.5) * heightJitter * fullness.height;
}
