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
  /** Off-hand rotation override. `rot` is authored against the RIGHT hand and
   *  composes against the mirrored (identity) base on the left, so a large yaw
   *  can read wrong there; when this field is present the LEFT hand uses it
   *  instead of `rot` ([0, 0, 0] pins the bare mirrored family fit). Absent
   *  means the prior behavior: `rot` applies to both hands. */
  rotOffhand?: [number, number, number];
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
  // Boneglass Shiv: origin is at the blade CENTER, so raise the model along the
  // grip axis (+Y) to bring the handle into the hand. oy = 0.40*scale - lift(0.04).
  whittler_s_knife: { pos: [0, 0.26, 0], rot: [0, 0, -19.9726], scale: 0.6 },
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
  // The three non-KayKit rogue daggers below all have their mesh ORIGIN at the
  // blade center (native height ~1.28, 0.64 node scale), so the family grip
  // seats the hand mid-blade. Raise each along the grip axis (+Y) so the handle
  // lands in the hand: oy = 0.40*scale - lift(0.04). Duskwhisper + its heroic
  // twin share purple_dagger, so this one entry fixes both.
  purple_dagger: { scale: 0.55, pos: [0, 0.23, 0] },
  redskull_dagger: { pos: [0, 0.44, 0] }, // Marrowpoint (scale 1)
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
    scale: 1.39,
  },
  cinderlatch: {
    pos: [0.1565, 0.1562, -0.0917],
    rot: [94.6767, -12.6224, 138.9958],
    scale: 0.65,
  },
  // Both bows are 1.80 tall natively, the LONGEST ranged models in the pack,
  // but shipped at about native scale while the sword skins take a 1.3 to 1.4
  // hero bump. Rendered, that put a bow at 1.89 against a sword's 2.80 on a
  // 2.6-unit body: the sword read as a hero weapon and the bow as an accessory
  // at the hip. 1.39 brings a bow to 2.50, exactly level with that sword rather
  // than past it (1.55 would make the bow the largest weapon in the game).
  // The VAR_BOW family clamp (maxHeight 2.0) never binds at 1.80, so nothing
  // was shrinking them; this is the only knob that moves a bow's presence.
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
  fletcher_s_guild_bow: { pos: [-0.2237, 0, 0.0851], scale: 1.39 },
  shard_of_everwinter: { pos: [0, 0.0687, 0.1538], rot: [35.7041, 0, 0] },
  // Ignivar raid legendary (unit-normalized Tripo build, re-origined at the
  // grip in tmp/varkhul_drops_build.mjs). Owner-tuned against live play:
  // 1.66 sits well under the starfall legendary benchmark (the engine head
  // carries the bulk); the 180 yaw about the haft is the owner's final pick
  // for how the head reads at rest.
  hammer_varkhul: { rot: [0, 180, 0], rotOffhand: [0, 0, 0], scale: 1.66 },
  // The starter staff. Its file is turned head-up about the grip so the crook rides
  // over the shoulder in the carry (the carry reads the file, not this table). In the
  // HAND the owner wants the crook at the front end, so the hand alone turns it back.
  // Its leather wrap sits just crook-side of the file's origin, and the staff family lifts
  // every staff 0.18 the other way, which left the fist on bare wood behind the wrap (owner
  // review). The offset slides the staff back through the hand until the fist closes on
  // the wrap.
  staff_starter: { rot: [180, 0, 0], pos: [0, -0.34, 0] },
  // A weapon sits IN the fist when its handle passes through the slot's own axis, and a
  // one-sided head faces the cut when it lies toward the right hand's +X (the side that
  // points at the ground in the idle hold, and at the enemy in the battle stance and through
  // the swing). tests/pack_weapon_hand_seat.test.ts measures both off the files.
  // The pack's one-hand axes are centred on their BOX, blade and all, so the haft runs 0.14
  // to 0.2 beside the origin and the axe floated beside the fist (owner review). `pos` brings
  // the haft back through the hand. The starter axe is also authored blade to the other side
  // (edge up in the hand), so it takes a half turn about the haft as well.
  axe_starter: { rot: [0, 180, 0], pos: [0.202, 0, 0] },
  axe_field_iron: { pos: [0.148, 0, 0] },
  axe_field_steel: { pos: [0.148, 0, 0] },
  axe_field_bronze: { pos: [0.148, 0, 0] },
  axe_rare_a_teal: { pos: [0.138, 0, 0] },
  axe_rare_a_ember: { pos: [0.138, 0, 0] },
  axe_rare_a_violet: { pos: [0.138, 0, 0] },
  // The owner's sizing pass ("weapons that look a bit too big for their hands"). The pack
  // weapons were made to the family lengths, which were set for the kit bodies before the
  // character pack body existed. That body measures 2.14 hand-slot units from foot to
  // crown (male; the female 2.12), so a 2.4 greatsword is longer than the character is
  // tall and a 1.28 dagger is 60 percent of it. Most shapes carry their length. Four did
  // not, and are scaled here: the daggers draw at 0.7, a blade under half a one-hand
  // sword's length whose hilt is a fist and a half; the greatswords draw at 2.15 where they
  // were 2.4; the two-hand axe at 1.88 where it was 2.1; the two-hand mauls near 1.6. An
  // offset on the same row is in hand units, so it shrinks with the scale.
  dagger_starter: { scale: 0.7 },
  dagger_field_iron: { scale: 0.7 },
  dagger_field_steel: { scale: 0.7 },
  dagger_field_bronze: { scale: 0.7 },
  dagger_rare_a_teal: { scale: 0.7 },
  dagger_rare_a_ember: { scale: 0.7 },
  dagger_rare_a_violet: { scale: 0.7 },
  dagger_rare_a_frost: { scale: 0.7 },
  dagger_rare_a_bone: { scale: 0.7 },
  // The curved rare dagger: its hilt bows away from the origin and its bevelled edge is
  // authored to the up side (owner review: upside down). A half turn about the hilt puts
  // the edge down, and the offset centres the bowed hilt in the palm.
  dagger_rare_b_teal: { rot: [0, 180, 0], pos: [0.0245, 0, 0], scale: 0.7 },
  dagger_rare_b_ember: { rot: [0, 180, 0], pos: [0.0245, 0, 0], scale: 0.7 },
  dagger_rare_b_violet: { rot: [0, 180, 0], pos: [0.0245, 0, 0], scale: 0.7 },
  // The field staves and the field spear, by the same recipe: their files are head-up
  // for the carry, and the hand alone turns the head to the front end.
  staff_field_iron: { rot: [180, 0, 0] },
  staff_field_steel: { rot: [180, 0, 0] },
  staff_field_bronze: { rot: [180, 0, 0] },
  spear_field_iron: { rot: [180, 0, 0] },
  // The field two-handers ride one-hand sized families (VAR_SWORD, VAR_HAMMER), whose
  // clamps would shrink them to one-hand length. Each carries a scale that sets its length
  // against the clamp: the greatsword 2.15 on the sword clamp of 2.0 (1.075; its file is
  // 2.4, the size the sizing pass above took it down from), the maul 1.575 on the hammer
  // clamp of 1.5 (1.05).
  // The maul was made 2.2 long; the owner found the handle too long, so the bare haft
  // between wrap and head was shortened by 0.45 in the files (the head and grip are as
  // made), and the sizing pass then took the whole of it down a tenth.
  // Plain number literals on purpose: the asset pipeline reads this table as text.
  sword_field_2h_iron: { scale: 1.075 },
  sword_field_2h_steel: { scale: 1.075 },
  hammer_field_2h_iron: { scale: 1.05 },
  hammer_field_2h_steel: { scale: 1.05 },
  // The rare staves and polearms, by the same recipe as the field ones: head-up files,
  // turned back in the hand.
  staff_rare_a_teal: { rot: [180, 0, 0] },
  staff_rare_a_ember: { rot: [180, 0, 0] },
  staff_rare_a_violet: { rot: [180, 0, 0] },
  staff_rare_a_obsidian: { rot: [180, 0, 0] },
  staff_rare_b_teal: { rot: [180, 0, 0] },
  staff_rare_b_ember: { rot: [180, 0, 0] },
  staff_rare_b_violet: { rot: [180, 0, 0] },
  spear_rare_a_teal: { rot: [180, 0, 0] },
  spear_rare_b_ember: { rot: [180, 0, 0] },
  // The rare set has no two-hand sword or axe of its own, and its war maul is 2.15 long on
  // a family clamped at 1.5. A finish serves one hand only, because a model has one size:
  // the two-hand finishes carry a scale, the rest draw at one-hand length. The straight
  // sword's ember and violet finishes are greatswords at the field greatsword's 2.15 (teal
  // stays one-hand: guards hold it); the double-bit axe's ember is a two-hander at 1.875;
  // the maul's teal and violet draw at two-hand size, 1.6 (ember stays one-hand: smiths
  // hold it). Those two maul files had 0.45 of bare haft taken out, like the field maul
  // (owner: shorter handle), so they are 1.7 long where the ember file keeps the made 2.15.
  // The straight sword's repainted finishes follow the same split: jade, spectral, molten,
  // royal and ivory are greatswords, anvil is one-hand.
  // (The greatswords were 2.4, the axe 2.1 and the mauls 1.7 before the sizing pass.)
  sword_rare_a_ember: { scale: 1.075 },
  sword_rare_a_violet: { scale: 1.075 },
  sword_rare_a_jade: { scale: 1.075 },
  sword_rare_a_spectral: { scale: 1.075 },
  sword_rare_a_molten: { scale: 1.075 },
  sword_rare_a_royal: { scale: 1.075 },
  sword_rare_a_ivory: { scale: 1.075 },
  axe_rare_b_ember: { scale: 1.25 },
  hammer_rare_b_teal: { scale: 1.0667 },
  hammer_rare_b_violet: { scale: 1.0667 },
  // The epic staves, by the same recipe: head-up files, turned back in the hand.
  // (the gnarled bone staff bends away from its origin at the grip: the offset centres it)
  staff_epic_gravewyrm_bone_emerald: { rot: [180, 0, 0], pos: [0.013, 0, -0.055] },
  staff_epic_hexwood_basin_turquoise: { rot: [180, 0, 0] },
  staff_epic_hexwood_last_spring: { rot: [180, 0, 0] },
  staff_epic_moonfang_bone_moon: { rot: [180, 0, 0] },
  staff_epic_moonfang_lunar_tide: { rot: [180, 0, 0] },
  // The epic two-handers on one-hand sized families carry a scale that sets their length
  // against the clamp. The greatswords were made 2.5, 2.55 and 2.45 long; like every
  // greatsword they draw a tenth under that after the sizing pass (2.24, 2.285, 2.195 on
  // the sword clamp of 2.0). The wildwood maul draws at its made 2.2 on the hammer clamp of
  // 1.5: no item draws it, and its haft has not been shortened like the other mauls'.
  // The gravecleaver is a one-hand axe authored a tenth over the axe clamp (1.65 against
  // 1.5), and keeps that.
  // The deathless greatsword's crucible finish carries no scale: a one-hand legendary
  // draws it, at the sword clamp.
  sword_epic_deathless_spectral_teal: { scale: 1.1425 },
  sword_epic_ossuary_ivory_amethyst: { scale: 1.12 },
  sword_epic_ossuary_wyrm_teal: { scale: 1.12 },
  sword_epic_tusk_ivory_jade: { scale: 1.0975 },
  sword_epic_tusk_predator_steel: { scale: 1.0975 },
  hammer_epic_wildwood_living_forest: { scale: 1.4667 },
  hammer_epic_wildwood_scorched_resin: { scale: 1.4667 },
  // ...and, like the other one-hand axes, it is centred on its box: the offset brings the
  // haft into the fist.
  axe_epic_gravecleaver_fossil_gravegreen: { scale: 1.1, pos: [0.127, 0, 0] },
  axe_epic_gravecleaver_slag_ember: { scale: 1.1, pos: [0.127, 0, 0] },
  // The epic daggers put their origin where the hilt meets the guard, not mid-hilt, so the
  // fist closed on the guard with the whole hilt trailing behind it. Each is raised along
  // the hand until the fist holds the hilt and the guard sits on top of it (the cinder kris
  // is also a touch off its own axis).
  // The dragonfang is also authored with its point curling to the side a hand holds DOWN,
  // so the fang hung like a hook (owner: upside down). A half turn about the hilt puts the
  // outer curve down and the point up.
  // Their hilts are barely a fist long, so the sizing pass takes these down less than the
  // other daggers (0.85, not 0.7): any smaller and the fist would not fit between pommel
  // and guard.
  dagger_epic_dragonfang_basin_jade: { rot: [0, 180, 0], pos: [0, 0.085, 0], scale: 0.85 },
  dagger_epic_dragonfang_ivory_violet: { rot: [0, 180, 0], pos: [0, 0.085, 0], scale: 0.85 },
  dagger_epic_dragonfang_moonlit_pearl: { rot: [0, 180, 0], pos: [0, 0.085, 0], scale: 0.85 },
  dagger_epic_cinder_coal_ember: { pos: [-0.013, 0.083, 0], scale: 0.85 },
  dagger_epic_marrow_ivory_amber: { pos: [0, 0.07, 0], scale: 0.85 },
  // The crozier's shaft runs beside its origin too.
  hammer_epic_spring_verdant_ivory: { pos: [0.051, 0, 0.009] },
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
  const [px, oy, pz] = override?.pos ?? [0, 0, 0];
  // The per-weapon offset is authored against the RIGHT hand, whose base
  // orientation is a 180-degree turn about Y from the off-hand's. Express the same
  // hand-local nudge in the off-hand frame by turning it the same way: negate X
  // and Z (Y is the shared along-bone lift). Without this, a large override (a
  // legendary sword skin, pos ~ [-0.18, _, -0.27]) shoves the off-hand model right
  // off the grip. An absent or X/Z-free override is unchanged, so scale-only skins
  // and every right-hand weapon stay byte-identical.
  const ox = left ? -px : px;
  const oz = left ? -pz : pz;
  const base: [number, number, number, number] = left ? [0, 0, 0, 1] : [0, 1, 0, 0];
  let quaternion = base;
  const rot = left ? (override?.rotOffhand ?? override?.rot) : override?.rot;
  if (rot) {
    const [rx, ry, rz] = rot;
    quaternion = quatMul(base, quatFromEuler(rx * DEG2RAD, ry * DEG2RAD, rz * DEG2RAD));
  }
  return {
    position: [ox, lift + oy, oz],
    quaternion,
    scale: clamp * (override?.scale ?? 1),
  };
}
