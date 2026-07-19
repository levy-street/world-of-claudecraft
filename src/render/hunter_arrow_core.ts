export interface HunterArrowSample {
  back: number;
  size: number;
  head: boolean;
}

// Static samples form a bright arrowhead and a long, tightly packed shaft.
// The VFX painter reuses this immutable profile for every frame and projectile.
export const HUNTER_ARROW_PROFILE: readonly HunterArrowSample[] = [
  { back: 0, size: 0.78, head: true },
  { back: 0.24, size: 0.48, head: false },
  { back: 0.48, size: 0.45, head: false },
  { back: 0.72, size: 0.42, head: false },
  { back: 0.96, size: 0.39, head: false },
  { back: 1.2, size: 0.36, head: false },
  { back: 1.44, size: 0.33, head: false },
  { back: 1.68, size: 0.3, head: false },
];
