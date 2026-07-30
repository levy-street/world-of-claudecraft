// The rift's visual re-grade: turning a RiftTheme's colour data into the
// InteriorStyle the renderer consumes, plus the deterministic seed mixing every
// rift generator uses.
//
// A leaf module (Rng + types only) so BOTH the procedural generator (rift_gen.ts)
// and the authored set-piece floors (content/rift/infernal_citadel.ts) share one
// grade implementation without importing each other.

import type { InteriorStyle } from '../dungeon_layout';
import type { Rng } from '../rng';

/** Deterministic 32-bit mix so each floor/aspect gets an independent, reproducible
 * seed from (seed, salt) without consuming any external rng. */
export function mixSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b + 0x85ebca6b), 0xc2b2ae35) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small deterministic per-channel jitter of a 0xRRGGBB colour, so two floors that
 * happen to share a theme still read a little differently. `amt` is a fraction. */
export function jitterColor(rng: Rng, hex: number, amt: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const f = () => 1 + rng.range(-amt, amt);
  return (clamp(r * f()) << 16) | (clamp(g * f()) << 8) | clamp(b * f());
}

/** The colour/fog fields a theme contributes to a floor's InteriorStyle. Structural
 * subset of RiftTheme, so an authored set-piece can carry its own grade without
 * joining the procedural theme pool. */
export interface StyleSource {
  kit: InteriorStyle['kit'];
  torch: { flame: number; emissive: number; light: number };
  fog: { color: number; near: number; far: number };
  wallTint?: number;
  floorTint?: number;
  daisRaised?: boolean;
}

/** Per-run re-grade of a theme: identical on every host for a given rng stream. */
export function buildStyle(rng: Rng, theme: StyleSource): InteriorStyle {
  return {
    kit: theme.kit,
    torch: {
      flame: jitterColor(rng, theme.torch.flame, 0.08),
      emissive: jitterColor(rng, theme.torch.emissive, 0.08),
      light: jitterColor(rng, theme.torch.light, 0.08),
    },
    fog: {
      color: jitterColor(rng, theme.fog.color, 0.12),
      near: Math.round(theme.fog.near + rng.range(-2, 2)),
      far: Math.round(theme.fog.far + rng.range(-6, 6)),
    },
    wallTint: theme.wallTint !== undefined ? jitterColor(rng, theme.wallTint, 0.06) : undefined,
    floorTint: theme.floorTint !== undefined ? jitterColor(rng, theme.floorTint, 0.06) : undefined,
    daisRaised: theme.daisRaised ?? false,
  };
}
