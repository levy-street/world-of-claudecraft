// Back-carry transforms for sheathed weapons (the Z-key stow toggle): where a held
// prop sits when re-parented from a handslot bone onto the `chest` bone. Pure data +
// math (no three.js) so the family fallback and side mirroring are Node-testable;
// assets.ts applies the result to the cloned prop and keeps the SCALE the normal
// hand-grip pass computed (variant-pack clamps included).
//
// Coordinates are chest-bone local space on the shared KayKit Rig_Medium skeleton
// (all 9 player classes + the Combat Mech use it). Values are hand-tuned against
// in-game screenshots; treat them as data, not derivations.

export interface BackGripTransform {
  position: [number, number, number];
  /** Unit quaternion [x, y, z, w] in chest-bone local space. */
  quaternion: [number, number, number, number];
}

interface BackGripSpec {
  position: [number, number, number];
  /** Intrinsic XYZ Euler, radians (converted once at module load). */
  euler: [number, number, number];
}

/** Intrinsic XYZ Euler to quaternion [x, y, z, w] (three.js 'XYZ' order). */
export function quatFromEulerXYZ(
  x: number,
  y: number,
  z: number,
): [number, number, number, number] {
  const c1 = Math.cos(x / 2);
  const s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2);
  const s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2);
  const s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

// Long hafts (staves, polearms, 2H) ride the diagonal across the back; short
// blades tuck vertically behind the shoulder. The rig's chest +Z faces forward,
// +Y runs up the spine, so "on the back" is negative Z. Mainhand (right) props
// lean one way; a left-hand prop (rogue offhand dagger, the warlock spellbook)
// mirrors across X so dual-wield reads as crossed blades.
const DEFAULT_BACK: BackGripSpec = {
  position: [0.16, 0.14, -0.27],
  euler: [0.1, 0, Math.PI * 0.72],
};

const BACK_GRIPS: Record<string, BackGripSpec> = {
  '1H_Sword': { position: [0.16, 0.14, -0.27], euler: [0.1, 0, Math.PI * 0.72] },
  '2H_Sword': { position: [0.14, 0.1, -0.3], euler: [0.1, 0, Math.PI * 0.75] },
  '1H_Axe': { position: [0.16, 0.14, -0.27], euler: [0.1, 0, Math.PI * 0.72] },
  '2H_Axe': { position: [0.14, 0.1, -0.3], euler: [0.1, 0, Math.PI * 0.75] },
  '2H_Staff': { position: [0.12, 0.0, -0.3], euler: [0.1, 0, Math.PI * 0.78] },
  // Short one-handers carry at the hip, hilt up and leaning outward. The chibi
  // torso is a wide egg (about 0.3 half-width at the belt in chest-bone units)
  // and the long-hair styles drape over the whole back, so anything narrower
  // than about x 0.45 disappears inside the silhouette; these values keep the
  // pommel and grip visible from front, side, and behind on the shared rig.
  Knife: { position: [0.5, -0.38, -0.08], euler: [0.05, 0.15, Math.PI * 0.72] },
  '1H_Wand': { position: [0.5, -0.38, -0.08], euler: [0.05, 0.15, Math.PI * 0.72] },
  '1H_Crossbow': { position: [0.0, 0.1, -0.3], euler: [0, Math.PI / 2, Math.PI] },
  '2H_Crossbow': { position: [0.0, 0.1, -0.32], euler: [0, Math.PI / 2, Math.PI] },
  VAR_SWORD: { position: [0.16, 0.14, -0.27], euler: [0.1, 0, Math.PI * 0.72] },
  VAR_DAGGER: { position: [0.5, -0.38, -0.08], euler: [0.05, 0.15, Math.PI * 0.72] },
  VAR_STAFF: { position: [0.12, 0.0, -0.3], euler: [0.1, 0, Math.PI * 0.78] },
  VAR_AXE: { position: [0.16, 0.14, -0.27], euler: [0.1, 0, Math.PI * 0.72] },
  VAR_POLEARM: { position: [0.12, 0.0, -0.3], euler: [0.1, 0, Math.PI * 0.78] },
  // The variant-pack families the Season 1 Armory added (weapon skins) plus the
  // item models that share them. Each reuses the carry already tuned for the
  // shape it matches, so a skin sheathes exactly like its mundane twin: hafted
  // one-handers ride the shoulder like a sword, short casting sticks and held
  // books carry at the hip, and the ranged families lie flat across the
  // shoulders like the crossbows.
  VAR_MACE: { position: [0.16, 0.14, -0.27], euler: [0.1, 0, Math.PI * 0.72] },
  VAR_HAMMER: { position: [0.16, 0.14, -0.27], euler: [0.1, 0, Math.PI * 0.72] },
  VAR_WAND: { position: [0.5, -0.38, -0.08], euler: [0.05, 0.15, Math.PI * 0.72] },
  VAR_BOOK: { position: [0.5, -0.38, -0.08], euler: [0.05, 0.15, Math.PI * 0.72] },
  VAR_CROSSBOW: { position: [0.0, 0.1, -0.3], euler: [0, Math.PI / 2, Math.PI] },
  // A BOW is not a crossbow. The crossbow carry above lays a wide, T-shaped
  // body flat across the shoulders, and its Math.PI / 2 yaw is what makes that
  // read; applied to a tall bow arc the same yaw leaves the limbs pointing
  // straight up and down, so a sheathed bow stood vertically up the spine
  // instead of lying strapped across the back (reported from live play).
  // A bow is long and thin like a greatsword, so it takes the greatsword's
  // diagonal: 45 degrees across the back, face flat to the spine.
  VAR_BOW: { position: [0.14, 0.1, -0.3], euler: [0.1, 0, Math.PI * 0.75] },
  // Off-hand gear from the two-slot loadout (release/v0.24.0-ptr): a left-hand
  // prop of any family above mirrors automatically via backGripFor's side
  // argument.
  // Shields (KAYKIT_SHIELD_ACCESSORIES families, held_item_grips.ts) sit flat
  // against the spine rather than diagonal like a bladed weapon: near-zero lean
  // (x/z close to 0) so the face reads flat-on from behind, centred on the spine
  // (x closer to 0 than a sword's shoulder-carry) and slightly lower (negative y)
  // so the rim clears the collar. The three shield meshes share one rig-relative
  // proportion, so one shared spec covers all three families; only the hand-grip
  // scale (already computed by the normal grip pass) differs per shield size.
  Round_Shield: { position: [0, 0.24, -0.32], euler: [0, Math.PI, 0] },
  Rectangle_Shield: { position: [0, 0.2, -0.32], euler: [0, Math.PI, 0] },
  Badge_Shield: { position: [0, 0.24, -0.32], euler: [0, Math.PI, 0] },
  // The Ignivar legendary shield: same flat-to-spine carry as the KayKit
  // shields. Its origin is the back grip bar (mid-plate), and the plate is a
  // full unit tall at the legendary 1.1 grip scale, so it sits LOWER than the
  // KayKit carries (y 0.05 vs 0.2) to keep the top edge at the shoulder line
  // instead of poking past the chibi head.
  Varkhul_Bulwark: { position: [0, 0.05, -0.36], euler: [0, Math.PI, 0] },
  // The starter buckler: the round KayKit carry. Its origin is the rear handle,
  // which sits off the disc's centre (0.08 across, 0.24 below it, 0.03 behind), so
  // the row is the round shield's with that offset taken back out through the
  // half turn: the DISC lands where the KayKit disc does, centred on the spine.
  Starter_Shield: { position: [0.08, 0, -0.29], euler: [0, Math.PI, 0] },
  // The field heater shield: the same flat carry, point down. Its origin is the middle
  // of the board, a full unit and a fifth tall, so it rides LOWER than the kit carries
  // (y -0.12 against 0.2): its flat top sits at the shoulder line, not across the back
  // of the head. It also rides FARTHER off the spine (z -0.42): a sheathed one-hander
  // lies under it, and at the kit distance a stowed staff, axe or mace came through
  // the board's face (measured on the live rig against ten one-hand models: -0.41 was
  // the first distance none of them crossed the board).
  Heater_Shield: { position: [0, -0.12, -0.42], euler: [0, Math.PI, 0] },
  // The epic tower shield: the heater carry, lower by the 0.15 its board is taller above
  // the middle, so its top sits at the same shoulder line.
  Tower_Shield: { position: [0, -0.27, -0.42], euler: [0, Math.PI, 0] },
};

/** The grip families that have a tuned on-back carry. Every family the character
 *  assets can hand `backGripFor` must appear here, or that weapon sheathes with
 *  the default sword pose; `tests/back_grips.test.ts` scans the asset tables and
 *  fails when a new family lands without a carry. */
export const BACK_GRIP_FAMILIES: ReadonlySet<string> = new Set(Object.keys(BACK_GRIPS));

/** Families whose on-back carry is NOT handed. The crossbow carry lies flat and
 *  SYMMETRIC across the shoulders, so mirroring it only flips the weapon
 *  end-for-end for no visual gain. The mirror exists so dual-wielded BLADES
 *  cross, which needs a carry that leans to one side in the first place.
 *
 *  This matters for ranged specifically because bows and crossbows ARE
 *  left-hand props: weaponSkinAttachBone moves a drawn bow to handslot.l so it
 *  sits in the draw animation's front arm, and handSide() then reports 'l' here
 *  when the weapon is sheathed. VAR_BOW is deliberately NOT in this set: its
 *  carry is a diagonal, so it should lean like any other diagonal. */
const SIDE_AGNOSTIC_BACK_GRIPS: ReadonlySet<string> = new Set([
  '1H_Crossbow',
  '2H_Crossbow',
  'VAR_CROSSBOW',
]);

/** Carries on the UPPER back, drawn over a shoulder: the one-hand shoulder carry and
 *  the long-haft diagonals (hip carries, crossbows and shields stay where they are).
 *  The table puts a right-hand prop's grip behind the LEFT shoulder; a rig whose
 *  sheathe gesture reaches over the RIGHT one (the WOC Sheathe clip) mirrors these
 *  so the hand meets the grip at the swap. */
const SHOULDER_CARRY_FAMILIES: ReadonlySet<string> = new Set([
  '1H_Sword',
  '2H_Sword',
  '1H_Axe',
  '2H_Axe',
  '2H_Staff',
  'VAR_SWORD',
  'VAR_STAFF',
  'VAR_AXE',
  'VAR_POLEARM',
  'VAR_MACE',
  'VAR_HAMMER',
  'VAR_BOW',
]);

/** The on-back transform for a sheathed prop: family-specific, mirrored across X
 *  (position and lean) for a left-hand prop, defaulting for unknown families.
 *  The ranged families opt out of the mirror (see above). `rightShoulderSheathe`
 *  swaps the side of an upper-back carry (SHOULDER_CARRY_FAMILIES; the default
 *  carry is one), so a right-hand prop sits behind the right shoulder. */
export function backGripFor(
  accessory: string | null,
  side: 'r' | 'l',
  rightShoulderSheathe = false,
): BackGripTransform {
  const spec = (accessory && BACK_GRIPS[accessory]) || DEFAULT_BACK;
  const handed = !(accessory && SIDE_AGNOSTIC_BACK_GRIPS.has(accessory));
  const shoulderCarry = spec === DEFAULT_BACK || SHOULDER_CARRY_FAMILIES.has(accessory ?? '');
  const carrySide = rightShoulderSheathe && shoulderCarry ? (side === 'r' ? 'l' : 'r') : side;
  const mirror = carrySide === 'l' && handed ? -1 : 1;
  return {
    position: [spec.position[0] * mirror, spec.position[1], spec.position[2]],
    quaternion: quatFromEulerXYZ(spec.euler[0], spec.euler[1] * mirror, spec.euler[2] * mirror),
  };
}

/** The minimal node shape the sheathe ratio walks (three's Object3D fits). */
export interface ScaledNode {
  scale: { x: number };
  parent: ScaledNode | null;
}

/**
 * The uniform scale a hand-slot bone carries RELATIVE to the chest bone. The
 * back-grip table is chest-bone space on the KayKit skeleton, whose slot bones
 * are unscaled, so there it is 1 and nothing changes. The WOC warrior bakes
 * its weapon-size compensation (0.457) onto its slot bones instead: a prop
 * that keeps the hand-grip scale and moves onto the chest for the sheathe
 * would grow by the inverse, and the table's offsets would land a body-width
 * off its back. Both the offset and the prop scale multiply by this. 1 when
 * the chest is not an ancestor of the slot (a rig this rule cannot read).
 */
export function slotToChestScale(slot: ScaledNode, chest: ScaledNode): number {
  let k = 1;
  for (let node: ScaledNode | null = slot; node; node = node.parent) {
    if (node === chest) return k;
    k *= node.scale.x;
  }
  return 1;
}
