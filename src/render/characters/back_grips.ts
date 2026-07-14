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
  VAR_BOW: { position: [0.0, 0.1, -0.32], euler: [0, Math.PI / 2, Math.PI] },
  // Off-hand gear from the two-slot loadout (release/v0.24.0-ptr): a left-hand
  // prop of any family above mirrors automatically via backGripFor's side
  // argument. Families that branch introduces (shields, held off-hands like
  // lanterns) get their own entries here when it merges; until then an unknown
  // family falls back to DEFAULT_BACK instead of vanishing.
};

/** The grip families that have a tuned on-back carry. Every family the character
 *  assets can hand `backGripFor` must appear here, or that weapon sheathes with
 *  the default sword pose; `tests/back_grips.test.ts` scans the asset tables and
 *  fails when a new family lands without a carry. */
export const BACK_GRIP_FAMILIES: ReadonlySet<string> = new Set(Object.keys(BACK_GRIPS));

/** The on-back transform for a sheathed prop: family-specific, mirrored across X
 *  (position and lean) for a left-hand prop, defaulting for unknown families. */
export function backGripFor(accessory: string | null, side: 'r' | 'l'): BackGripTransform {
  const spec = (accessory && BACK_GRIPS[accessory]) || DEFAULT_BACK;
  const mirror = side === 'l' ? -1 : 1;
  return {
    position: [spec.position[0] * mirror, spec.position[1], spec.position[2]],
    quaternion: quatFromEulerXYZ(spec.euler[0], spec.euler[1] * mirror, spec.euler[2] * mirror),
  };
}
