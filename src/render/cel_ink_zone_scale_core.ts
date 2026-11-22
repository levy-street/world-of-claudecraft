// Per-zone scale on the cel look's post ink. The output grade reads it every
// frame (post_output_grade.ts updateCelInk) and the palette runtime writes the
// look's `render.ink` into it, eased across zone borders like the rest of a
// look. 1 is the shipped ink; 0 draws none (the art bible's painterly world,
// docs/design/art-direction.md). Three-free so a plain Vitest pins it.

let scale = 1;

/** The current zone ink multiplier, clamped to 0..1. */
export function celInkZoneScale(): number {
  return scale;
}

/** Set the zone ink multiplier; out-of-range and non-finite values clamp. */
export function setCelInkZoneScale(value: number): void {
  scale = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}
