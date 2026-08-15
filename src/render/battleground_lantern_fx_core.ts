// Where a lantern's flame belongs, and how it moves. Three- and DOM-free (a
// registered RENDER_PURE_CORE), so the placement math a misaligned flame would
// expose is unit-testable without a browser.
//
// The field's rune pads are each ringed by four `dungeon/post_lantern` posts.
// The flame has to sit inside the lamp's glass, which means resolving the lamp
// from the POST's placement: the model hangs its lamp out on an arm, so the
// lamp is nowhere near the placement's own x/z.

/**
 * The lamp glass's centre in the post_lantern model's own units. The post
 * stands on the origin and holds the lamp out along its local +Z.
 *
 * y is the middle of the GLASS, and it was measured off the mesh rather than
 * eyeballed, because eyeballing it put the flame in the roof. Banding the
 * lantern mesh's vertices by height gives its parts unambiguously:
 *
 *     1.70 - 1.90   base plinth      (widening down to the foot)
 *     1.90 - 2.15   THE GLASS        (no vertices between: the panels span it)
 *     2.15 - 2.35   cap / roof       (the widest band, the flare)
 *     2.50 - 3.10   hanging chain    (narrow, above the cap)
 *
 * So the glass centre is 2.02. The lamp MESH's own centre is 2.396, which is
 * up in the chain; its bounding-box centre is not the lamp.
 */
export const LANTERN_LAMP_LOCAL = { x: 0, y: 2.02, z: 1.0 } as const;

/**
 * The flame cup of a wall-mounted torch (`dungeon/torch_mounted`), in the same
 * seat-relative, normalized frame as the lantern's lamp above.
 *
 * Measured the same way rather than eyeballed: the model was loaded through the
 * renderer's own loader, normalized by `targetHeightFor / maxDimension` exactly
 * as the placement builder does, seated with its lowest point at 0, and its top
 * 10% of vertices averaged. That band is the iron cage's rim (42 verts) at
 * (0, 2.097, 0.648): the shaft hugs the wall at -z and the cage hangs out at
 * +z, so a flame placed on the placement origin would burn inside the masonry.
 * The seat drops just under the rim so the fire sits IN the cage, not on it.
 */
export const TORCH_HEAD_LOCAL = { x: 0, y: 2.0, z: 0.64 } as const;

/** Which way the arm points in model space, for callers aiming a post. */
export const LANTERN_ARM_LOCAL = { x: 0, z: 1 } as const;

/** The placement fields this module needs (a structural subset of the map's). */
export interface LanternPlacement {
  readonly x: number;
  readonly z: number;
  readonly rotY: number;
  readonly scale: number;
  readonly seatY: number;
}

export interface LanternLamp {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The world position of one post's lamp glass.
 *
 * `rotY` is applied exactly as the placement builder applies it (a THREE.Euler
 * y rotation), which maps local +Z to world (sin, cos) and local +X to
 * (cos, -sin). Getting this wrong is invisible in code review and glaring in
 * game: the flame floats off to one side of its lantern.
 */
export function lanternLampWorld(
  p: LanternPlacement,
  local: { readonly x: number; readonly y: number; readonly z: number } = LANTERN_LAMP_LOCAL,
): LanternLamp {
  const s = Math.sin(p.rotY);
  const c = Math.cos(p.rotY);
  const lx = local.x * p.scale;
  const lz = local.z * p.scale;
  return {
    x: p.x + (lx * c + lz * s),
    y: p.seatY + local.y * p.scale,
    z: p.z + (-lx * s + lz * c),
  };
}

/** Flame tuning. Small numbers on purpose: this is a lamp, not a bonfire. */
export const LANTERN_FLAME = {
  /** Motes per lantern. */
  perLantern: 9,
  /**
   * Yards a mote climbs over one cycle. Sized against the glass, not picked:
   * the glass is 0.25 model units tall and the posts stand at scale 1.5, so it
   * is 0.375yd from base to cap and a mote starting at the middle has 0.19yd
   * of headroom. Climb further and the flame burns up through its own roof.
   */
  rise: 0.18,
  /** Spawn radius (yd) inside the glass, which is ~0.24yd across at its waist. */
  radius: 0.08,
  /**
   * Point size in pixels at 1yd (props.ts's fixed-pixel convention). Sized UP
   * from a first pass at 30, which was correctly placed and simply too small
   * to see: the motes are additive over glass that is already bright yellow,
   * so a small mote adds nothing a player can read.
   */
  size: 62,
  /** Seconds for one cycle at the slowest seed. */
  cycleSec: 1.35,
  /** Flame core and edge colours. */
  colorCore: 0xfff3c4,
  colorEdge: 0xff9d2e,
} as const;

/**
 * Torch tuning. Open fire in an iron cage rather than a flame behind glass, so
 * it is bigger and lazier than the lamp: a wider spawn disc, more climb, and a
 * longer cycle. The colours stay the field's fire palette so both fixtures read
 * as the same flame at different sizes.
 */
export const TORCH_FLAME = {
  perLantern: 14,
  rise: 0.42,
  radius: 0.17,
  /**
   * Pixels at 1yd, and much larger than the lamp's 62. Sized from the shot, not
   * from taste: at the lamp's size a wall torch ten yards off came back as two
   * warm pixels in the cage, which is not a lit torch, it is a smudge. These
   * motes are additive over stone that daylight already renders bright, so the
   * flame has to be big enough to win against its own background.
   */
  size: 205,
  cycleSec: 1.6,
  colorCore: 0xfff3c4,
  colorEdge: 0xff7a12,
} as const;

/** Seeds per mote packed into the `aSeed` vec4. */
export const LANTERN_SEED_STRIDE = 4;

/**
 * Deterministic 0..1 hash. Same shape as the rune kits', every client builds
 * the identical flame, so two players never see one lantern burning
 * differently.
 */
export function lanternSeed(index: number, salt: number): number {
  let h = (index * 0x1b873593) ^ (salt * 0xcc9e2d51);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 8) & 0xffffff) / 0x1000000;
}

/** `[angle01, radius01, phase01, rate01]` per mote, baked once at build. */
export function lanternMoteSeeds(count: number): Float32Array {
  const out = new Float32Array(Math.max(0, count) * LANTERN_SEED_STRIDE);
  for (let i = 0; i < count; i++) {
    const o = i * LANTERN_SEED_STRIDE;
    out[o] = lanternSeed(i, 1);
    out[o + 1] = lanternSeed(i, 2);
    out[o + 2] = lanternSeed(i, 3);
    out[o + 3] = lanternSeed(i, 4);
  }
  return out;
}
