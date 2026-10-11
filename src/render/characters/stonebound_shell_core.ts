/**
 * Stonebound weapon-shell style, a pure core (RENDER_PURE_CORES).
 *
 * The Stonebound imbue sheathes every held weapon in a stone shell and plates
 * the body with shards. On an antialiased frame that shell is a one-pixel
 * wireframe clone of the weapon mesh, which reads as a carved cage. With no
 * antialiasing at all (the low tier, and the memory-constrained WebKit
 * profiles that drop the grade pass) the same wireframe crawls and aliases
 * over the dense weapon triangles and reads as a rendering glitch, so that
 * arm swaps it for a solid translucent sheath at a lower opacity.
 *
 * Cosmetic only (docs/design/graphics-settings-fairness.md): the buff icon,
 * aura track, and combat math are untouched; only the line style of the
 * weapon dressing varies.
 */

export interface StoneboundAaFacts {
  readonly smaa: boolean;
  readonly fxaa: boolean;
  readonly msaaSamples: number;
}

export interface StoneboundShellStyle {
  readonly wireframe: boolean;
  readonly shellOpacity: number;
  readonly shardOpacity: number;
}

export const STONEBOUND_SHELL_TINT = 0x9a9384;
export const STONEBOUND_SHARD_TINT = 0x777065;

const WIREFRAME_STYLE: StoneboundShellStyle = {
  wireframe: true,
  shellOpacity: 0.72,
  shardOpacity: 0.82,
};

const SOLID_STYLE: StoneboundShellStyle = {
  wireframe: false,
  shellOpacity: 0.34,
  shardOpacity: 0.62,
};

export function stoneboundShellStyle(aa: StoneboundAaFacts): StoneboundShellStyle {
  const antialiased = aa.smaa || aa.fxaa || aa.msaaSamples > 0;
  return antialiased ? WIREFRAME_STYLE : SOLID_STYLE;
}
