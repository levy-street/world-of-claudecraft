export interface WarriorFragmentShape {
  x: number;
  y: number;
  z: number;
  tint: number;
  lift: number;
}

/** Spawn-only mineral families: broad flake, dense core, thin sliver and
 * broken wedge. Every family reuses the prepared solid and its existing slot. */
export function warriorFragmentShape(out: WarriorFragmentShape, index: number, seed: number): void {
  const family = (index + seed) % 4;
  const variation = 0.5 + 0.5 * Math.sin(seed * 1.71 + index * 2.399963);
  out.x = family === 0 ? 1.65 : family === 1 ? 1.12 : family === 2 ? 0.4 : 1.25;
  out.y = family === 0 ? 0.32 : family === 1 ? 1.03 : family === 2 ? 1.95 : 0.62;
  out.z = family === 0 ? 1.2 : family === 1 ? 0.92 : family === 2 ? 0.38 : 0.78;
  out.x *= 0.88 + variation * 0.3;
  out.tint = 0.68 + variation * 0.48;
  out.lift = family === 1 ? 0.76 : family === 2 ? 1.18 : 0.92;
}
