// Pure geometry for height-following harbor railings (J5): buildRail used to
// draw a whole run (posts, cap, mid rail) at ONE height sampled at the run's
// center, so the outer-pier rails that flank a rising seam ramp dove under
// the climbing walk surface and read as a missing railing on the last
// stretch of boardwalk. This core plans a rail run against the walkable
// surface it protects: each post seats on the surface a walker actually
// stands on beside it (the highest walkable footing within a shoulder's
// reach of the rail line, because seam ramps are authored slightly narrower
// than their pier so the rail line itself sits on the lower deck strip), and
// the cap and mid rail follow the post tops, sloping over a climb. A run
// whose posts all agree stays byte-identical to the old single-height look.
// No Three.js, no world reads: a Vitest drives it directly.

import { HARBOR_RAIL_HEIGHT, type HarborRail } from '../sim/harbor_layout';

/** Walkable surface height at (x, z), -Infinity off the boardwalk
 * (harborSurfaceHeight partially applied to one harbor). */
export type RailSurfaceSampler = (x: number, z: number) => number;

/** Lateral shoulder probes (yards, both sides of the rail line) used to find
 * the surface a rail must protect. Seam ramps are authored up to 0.3 yards
 * inside their pier's edge, so the farthest probe must comfortably reach
 * past that gap onto the ramp surface. */
export const RAIL_PROTECTION_PROBE_OFFSETS_YARDS = [0, 0.35, 0.7] as const;

/** Post cadence along a run (yards); kept identical to the original
 * buildRail so unchanged rails keep their exact post positions. */
export const RAIL_POST_SPACING_YARDS = 2.0;

/** A bay whose post tops differ by no more than this slopes its cap (the
 * seam-ramp climb, ~0.43 per bay); a bigger jump is an authored deck STEP,
 * and the bay holds level at the higher top instead, stair-rail style, so
 * the cap never dips under the higher deck's footing mid-bay. */
export const RAIL_BAY_SLOPE_MAX_RISE_YARDS = 0.6;

export interface RailProfilePost {
  x: number;
  z: number;
  /** Signed offset from the rail center along the run axis. */
  along: number;
  /** Where the post's own foot lands (the rail line's surface). */
  footingY: number;
  /** Top of the protection at this post: shoulder surface + rail height. */
  topY: number;
}

/** One cap/mid segment between consecutive posts; level when top0 === top1. */
export interface RailProfileSpan {
  along0: number;
  along1: number;
  top0: number;
  top1: number;
}

export interface RailHeightProfile {
  posts: readonly RailProfilePost[];
  spans: readonly RailProfileSpan[];
  /** True when every post top agrees: the run draws as one level cap. */
  level: boolean;
}

function postPoint(rail: HarborRail, along: number): { x: number; z: number } {
  return rail.rot === 0 ? { x: rail.x + along, z: rail.z } : { x: rail.x, z: rail.z + along };
}

/**
 * The walkable surface the rail must clear at `along`: the highest footing
 * within the shoulder probes on either side of the rail line. -Infinity when
 * nothing walkable is in reach (a rail end hanging past the boardwalk).
 */
export function railProtectionBaseAt(
  rail: HarborRail,
  surfaceAt: RailSurfaceSampler,
  along: number,
): number {
  const p = postPoint(rail, along);
  let base = -Infinity;
  for (const offset of RAIL_PROTECTION_PROBE_OFFSETS_YARDS) {
    for (const side of offset === 0 ? [1] : [-1, 1]) {
      const x = rail.rot === 0 ? p.x : p.x + side * offset;
      const z = rail.rot === 0 ? p.z + side * offset : p.z;
      base = Math.max(base, surfaceAt(x, z));
    }
  }
  return base;
}

/**
 * Plan a rail run against the surface it protects. Post count and positions
 * match the original fixed-height builder exactly; only the heights vary.
 */
export function railHeightProfile(
  rail: HarborRail,
  surfaceAt: RailSurfaceSampler,
): RailHeightProfile {
  const len = rail.hw * 2;
  const nPosts = Math.max(2, Math.ceil(len / RAIL_POST_SPACING_YARDS) + 1);
  const posts: RailProfilePost[] = [];
  for (let i = 0; i < nPosts; i++) {
    const along = -rail.hw + (len * i) / (nPosts - 1);
    const p = postPoint(rail, along);
    let base = railProtectionBaseAt(rail, surfaceAt, along);
    const lineY = surfaceAt(p.x, p.z);
    if (base === -Infinity) base = lineY;
    const footingY = lineY === -Infinity ? base : lineY;
    posts.push({ ...p, along, footingY, topY: base + HARBOR_RAIL_HEIGHT });
  }
  // A run over open water on both shoulders (never authored today) still
  // needs finite geometry: fall back to the highest known post top.
  const knownTop = posts.reduce((top, post) => Math.max(top, post.topY), -Infinity);
  for (const post of posts) {
    if (post.topY === -Infinity) post.topY = knownTop;
    if (post.footingY === -Infinity) post.footingY = knownTop - HARBOR_RAIL_HEIGHT;
  }
  const level = posts.every((post) => Math.abs(post.topY - posts[0].topY) < 1e-6);
  const spans: RailProfileSpan[] = [];
  if (level) {
    spans.push({
      along0: -rail.hw,
      along1: rail.hw,
      top0: posts[0].topY,
      top1: posts[0].topY,
    });
  } else {
    for (let i = 0; i + 1 < posts.length; i++) {
      const a = posts[i];
      const b = posts[i + 1];
      const step = Math.abs(b.topY - a.topY) > RAIL_BAY_SLOPE_MAX_RISE_YARDS;
      const top0 = step ? Math.max(a.topY, b.topY) : a.topY;
      const top1 = step ? top0 : b.topY;
      const last = spans[spans.length - 1];
      // Merge consecutive level bays so a long flat stretch stays one box.
      if (last && Math.abs(last.top1 - top0) < 1e-6 && Math.abs(top0 - top1) < 1e-6) {
        last.along1 = b.along;
        last.top1 = top1;
      } else {
        spans.push({ along0: a.along, along1: b.along, top0, top1 });
      }
    }
  }
  return { posts, spans, level };
}

/** The DRAWN protection top at `along`: the cap line over the spans (a
 * stepped bay holds the higher top across its whole width), which is what
 * the audit compares against the walk surface and what buildRail seats each
 * post's drawn top against. */
export function railProfileTopAt(profile: RailHeightProfile, along: number): number {
  const spans = profile.spans;
  if (along <= spans[0].along0) return spans[0].top0;
  for (const span of spans) {
    if (along <= span.along1 + 1e-9) {
      if (along < span.along0) return span.top0;
      const width = span.along1 - span.along0;
      if (width <= 1e-9) return Math.max(span.top0, span.top1);
      const t = (along - span.along0) / width;
      return span.top0 + (span.top1 - span.top0) * t;
    }
  }
  return spans[spans.length - 1].top1;
}
