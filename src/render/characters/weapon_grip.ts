// Per-weapon grip fine-tuning: pure, three-free transform math shared by the
// engine attach path (assets.ts applyVariantGrip) and mirrored by the asset
// pipeline's live inspector (scripts/asset_pipeline/viewer_live.js). Kept
// host-agnostic so a Vitest exercises the compose math directly, without loading
// the GLTF/preload machinery in assets.ts.
//
// A variant weapon attaches at the family VariantGrip (a Y lift along the hand
// bone, a hand-side 180-degree flip, and a maxHeight clamp that only ever shrinks
// an oversized model). That is a per-FAMILY fit; a single generated model can
// still sit slightly wrong. WEAPON_GRIP_OVERRIDES layers a per-WEAPON nudge on
// top so one model fits the hand nicely without retuning the whole family.

/** Per-weapon grip fine-tune, applied ON TOP of the family VariantGrip. Every
 *  field is optional and defaults to identity, so an absent override reproduces
 *  the exact prior behavior. `pos` is a hand-local offset ADDED to the family
 *  lift ([x, y, z]); `rot` is an XYZ euler in DEGREES applied AFTER the hand-side
 *  flip; `scale` MULTIPLIES the family maxHeight clamp (so a weapon can be nudged
 *  larger or smaller than its clamped size). Keyed by weapon model basename (the
 *  `<key>.glb` file, the same key as KAYKIT_WEAPON_ACCESSORY in assets.ts).
 *  Overrides are authored (and inspector-previewed) against the RIGHT hand; on an
 *  off-hand attachment (rogue dual-wield) `rot` composes against the mirrored
 *  (identity) base, so keep offhand-visible rotations small or expect a mirror. */
export interface WeaponGripOverride {
  scale?: number;
  rot?: [number, number, number];
  pos?: [number, number, number];
}

/** Authored per-weapon grip overrides, keyed by weapon model basename. Empty by
 *  default (identity fit for every weapon). Tuned by hand, or saved from the
 *  asset-pipeline live inspector (`pipeline.mjs library --serve`). Read by
 *  applyVariantGrip (assets.ts); the inspector mirrors the same compose math.
 *  Each value carries any of pos (hand-local offset), rot (XYZ euler degrees),
 *  and scale (a multiplier on the family clamp); omitted fields stay identity. */
export const WEAPON_GRIP_OVERRIDES: Record<string, WeaponGripOverride> = {
  // Populated by hand or by the inspector Save button. An absent key is identity.
  notched_woodaxe: { pos: [0.1249, 0.0794, 0.0321], rot: [180, -8.7527, 180], scale: 0.85 },
  whittler_s_knife: { pos: [0, 0.0184, 0], rot: [0, 0, -19.9726], scale: 0.6 },
  peeled_birch_wand: { pos: [0.01, 0.02, 0.02] },
  knotted_oak_stave: { pos: [-0.1, 0.57, 0.02], rot: [-180, 0, 0], scale: 0.85 },
  redskull_sword: { scale: 1.3 },
  simple_farmhand_crossbow: { pos: [0.155, 0.0684, 0.2319], rot: [95.2624, 0, 0], scale: 0.65 },
  guildmark_arming_sword: { pos: [0, 0.01, 0], rot: [15, 5, 0], scale: 0.95 },
  brasscap_hatchet: {
    pos: [0.0585, 0.0588, 0.0529],
    rot: [-162.524, 1.1883, -177.4091],
    scale: 0.9,
  },
  solheim_last_light_of_the_dawn: {
    pos: [-0.1787, -0.0279, -0.273],
    rot: [-2.9988, 0, 0],
    scale: 1.4,
  },
  skyrender_the_firmament_s_wound: {
    pos: [0.0662, 0.0855, -0.0044],
    rot: [4.898, 0.5818, -34.2432],
    scale: 1.3,
  },
  cosmarch_spire_of_the_endless_void: {
    pos: [-0.0725, 0.7123, 0.0769],
    rot: [-149.1828, -80.6499, -141.918],
    scale: 1.5,
  },
  emberwish_mote_of_the_dying_sun: {
    pos: [-0.2681, 0.2224, 0.0872],
    rot: [135.4907, -79.3213, 111.7394],
    scale: 1.3,
  },
  meteorlatch_the_sky_s_last_judgment: {
    pos: [-0.2705, 0.0871, -0.0149],
    rot: [90.1927, -3.4743, 93.1768],
  },
  wrought_iron_longsword: { scale: 0.85 },
  iron_field_hammer: { scale: 0.75 },
  astravyr_fang_of_the_fallen_star: { scale: 1.2 },
  starfall_judgment_of_the_heavens: {
    pos: [-0.0598, 0.1954, -0.0137],
    rot: [53.2074, 68.0435, -51.3048],
    scale: 1.65,
  },
  ice_fang: { scale: 1.25 },
  glaciersplit: { pos: [0.0713, 0.0779, -0.0096], rot: [180, -7.6717, -165.7991], scale: 1.35 },
  rimecrusher: { rot: [-50.9571, -60.9258, -57.8216], scale: 1.8 },
  frostbite: { pos: [-0.0279, 0.0048, 0.0849], scale: 1.55 },
  // Full Set drop (July 2026). The two bows also ship an ATTACK grip in their
  // handoff position files (gripOverride + gripAttackOverride, blended during
  // the draw animation); only the idle grip is registered until the engine
  // grows a second-pose slot.
  winterbite: {
    pos: [-0.0439, -0.0034, 0.0066],
    rot: [-164.6994, -29.0522, -148.7048],
    scale: 1.05,
  },
  cinderlatch: {
    pos: [0.1565, 0.1562, -0.0917],
    rot: [94.6767, -12.6224, 138.9958],
    scale: 0.65,
  },
  // The encore star-cannon reads correctly at the family default grip (muzzle
  // forward off the right hand); the scale-up is the point, a legendary gun
  // longer than the hunter is tall.
  encore_the_second_falling_star: {
    pos: [-0.0268, 0.0704, -0.0141],
    rot: [-140.4492, 5.0614, 104.6019],
    scale: 1.2,
  },
  emberbite: { pos: [-0.0061, 0.1097, 0] },
  smoulderfall: { rot: [0, 0, -12.429], scale: 0.9 },
  ashspark_shiv: { pos: [0, -0.0745, 0.0717], rot: [14.7156, 0, 0] },
  forgeheart_stave: { pos: [0, 0.1168, 0], scale: 1.1 },
  emberwrought_wand: {
    pos: [-0.1158, 0.7129, 0],
    rot: [101.5834, 80.5884, 78.5684],
    scale: 1.2,
  },
  tempered_flanged_mace: { pos: [0, 0.12, 0], rot: [5, 0, 0] },
  guildmark_dirk: {
    pos: [-0.0006, -0.0285, 0.0472],
    rot: [-180, -89.2652, -180],
    scale: 1.1,
  },
  lacquered_rod: { pos: [0.0606, 0.1259, -0.0094], rot: [0, 0, -46.2693] },
  fletcher_s_guild_bow: { pos: [-0.2237, 0, 0.0851] },
  shard_of_everwinter: { pos: [0, 0.0687, 0.1538], rot: [35.7041, 0, 0] },
};

export interface GripTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
}

const DEG2RAD = Math.PI / 180;

// Quaternion from an XYZ-order euler (radians). Matches THREE.Quaternion
// .setFromEuler with the default 'XYZ' order, so the engine and the THREE-based
// inspector produce byte-identical orientations.
function quatFromEuler(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// a * b, matching THREE.Quaternion.multiplyQuaternions(a, b): the override euler
// is applied in the weapon's local frame AFTER the base hand-side orientation.
function quatMul(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Compose the final hand-local transform for a variant weapon. `height` is the
 *  model's native (pre-scale) world height, `left` the hand side (mirrors the
 *  180-degree flip), `lift`/`maxHeight` the family VariantGrip, `override` the
 *  optional per-weapon fine-tune. With no override this is exactly the prior
 *  behavior: position (0, lift, 0), the hand-side flip, and the shrink-only
 *  clamp scale. */
export function variantGripTransform(
  height: number,
  left: boolean,
  lift: number,
  maxHeight: number,
  override?: WeaponGripOverride,
): GripTransform {
  const clamp = height > 1e-3 ? Math.min(1, maxHeight / height) : 1;
  const [ox, oy, oz] = override?.pos ?? [0, 0, 0];
  const base: [number, number, number, number] = left ? [0, 0, 0, 1] : [0, 1, 0, 0];
  let quaternion = base;
  if (override?.rot) {
    const [rx, ry, rz] = override.rot;
    quaternion = quatMul(base, quatFromEuler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD));
  }
  return {
    position: [ox, lift + oy, oz],
    quaternion,
    scale: clamp * (override?.scale ?? 1),
  };
}
