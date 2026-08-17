// Tiny, dependency-free numeric helper shared across src/render. Deliberately
// NOT named *_view.ts / *_core.ts, so it stays outside the RENDER_PURE_CORES
// sweep in tests/architecture.test.ts (same pattern as gfx.ts / vfx_anchor.ts):
// every consumer, including the pure cores, can import it without tripping
// that allowlist.
//
// Extracted because the identical clamp01 one-liner had been hand-rolled in
// close to a dozen separate render files; this is the single source of truth
// they all import instead.

/** Clamps v into the inclusive [0, 1] range. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
