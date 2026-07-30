// The Infernal Citadel: a HAND-AUTHORED set-piece rift floor.
//
// Most rifts are a single procedural room per floor (see rift/rift_gen.ts). A
// fraction of seeds instead open this: a fixed two-floor citadel laid out from
// the design map (docs/design/rift-portals.md, "Set-piece floors"). It can
// headline a rift of any rank: the rank only sets level/marks/loot, never the
// content. Floor 0 is the citadel halls; floor 1 descends into the pit, whose
// rooms carry per-room `lift` so the arena drops away below the entry balcony.
//
// Data-as-code: this file is a declarative table (rooms, doors, decor, spawns,
// objects) plus one pure builder that assembles them into a RiftFloorPlan. All
// randomness comes from an Rng seeded from the descriptor, never the live sim rng,
// so both hosts regenerate an identical citadel.
//
//   z increases NORTH. The player enters from the south corridor (R0) and must:
//     R1 Sacrificial Hall  -> the Blood Orb on its altar sits dormant
//     R4 Pentagram Rotunda -> kill Magus Vel'Kor; the orb wakes
//     back to the orb      -> touch it; the portcullis grinds open
//     R6 Stairhead         -> take the Rift Descent down to the pit
//     P2 The Pit           -> kill Azgorath; the way home tears open
//   R2 (relic gallery) and R5 (bone chamber) are optional side rooms; the relic
//   gallery and the pit's forge wing each hold an off-path reward cache.

import type { AuthoredDecor, AuthoredDoor, AuthoredRoom } from '../../dungeon_layout';
import { layoutColliders } from '../../dungeon_layout';
import type { StyleSource } from '../../rift/style';
import { buildStyle, mixSeed } from '../../rift/style';
import type { RiftFloorPlan, RiftObjectPlan, RiftSpawn } from '../../rift/types';
import { Rng } from '../../rng';
import type { DelveHazardZone } from '../../types';

/** Rift proper nouns this set-piece names itself from. */
export const INFERNAL_NOUNS = ['Infernal', 'Brimstone', 'Hellfire', 'Pactbound'] as const;
export const INFERNAL_THEME_ID = 'infernal';
export const INFERNAL_THEME_NAME = 'Infernal Citadel';

/** The rift's proper name for this seed. ONE source, so the portal tooltip, the
 * rift tracker, and the "you step through" line never disagree. */
export function infernalCitadelName(seed: number): string {
  const noun = new Rng(mixSeed(seed, 0x9a3e)).pick(INFERNAL_NOUNS as unknown as string[]);
  return noun === 'Infernal' ? 'The Infernal Citadel' : `The ${noun} Citadel`;
}

/** The citadel's colour grade. Deliberately blood-red and dim, NOT the amber forge
 * glow of the procedural `ember` theme, so the two never read as the same place. */
export const INFERNAL_STYLE: StyleSource = {
  kit: 'crypt',
  torch: { flame: 0xff5a32, emissive: 0xd52a12, light: 0xff7048 },
  fog: { color: 0x26070b, near: 20, far: 110 },
  wallTint: 0xb86b55,
  floorTint: 0x8f493e,
  daisRaised: false,
};

// ---- The map ---------------------------------------------------------------
// Rooms are axis-aligned and never overlap. Two rooms are connected ONLY where a
// door pierces the wall line they share, so the room graph below is the real
// topology (see rift/authored.ts). Every coordinate stays inside the rift region
// bounds (|x| <= 40, |z| <= 160, data.ts RIFT_REGION_HALF_X/Z).

export const INFERNAL_ROOMS: readonly AuthoredRoom[] = [
  { id: 'entry', x0: -7, x1: 7, z0: -34, z1: -14 }, // R0: Gatehouse
  { id: 'sacrifice', x0: -18, x1: 18, z0: -14, z1: 28 }, // R1: Sacrificial Hall
  { id: 'relics', x0: 18, x1: 36, z0: -8, z1: 22 }, // R2: Relic Gallery
  { id: 'gallery', x0: -36, x1: -18, z0: -8, z1: 22 }, // R3: West Processional
  { id: 'rotunda', x0: -36, x1: -18, z0: 22, z1: 48 }, // R4: Pentagram Rotunda
  { id: 'bonepit', x0: -36, x1: -18, z0: 48, z1: 74 }, // R5: Bone Chamber
  { id: 'stairhead', x0: -7, x1: 7, z0: 28, z1: 44 }, // R6: the sealed stairhead down
];

/** Doorways. The extent ACROSS the wall (`hw` on a constant-x wall, `hd` on a
 * constant-z wall) only has to reach the wall; the other extent is the opening. */
export const INFERNAL_DOORS: readonly AuthoredDoor[] = [
  { x: 0, z: -14, hw: 3.5, hd: 1 }, // entry -> sacrifice
  { x: 0, z: 28, hw: 4, hd: 1 }, // sacrifice -> stairhead (PORTCULLIS)
  { x: -18, z: 6, hw: 1, hd: 3 }, // sacrifice -> gallery
  { x: 18, z: 6, hw: 1, hd: 3 }, // sacrifice -> relics
  { x: -27, z: 22, hw: 3, hd: 1 }, // gallery -> rotunda
  { x: -18, z: 25, hw: 1, hd: 2 }, // rotunda -> sacrifice (short return to orb)
  { x: -27, z: 48, hw: 3, hd: 1 }, // rotunda -> bonepit
];

const GATE_Z = 28; // the portcullis line (the sacrifice -> stairhead door)
const ALTAR = { x: 0, z: 24 }; // the Blood Orb's altar, just south of the gate
const ROTUNDA = { x: -27, z: 35 }; // pentagram centre (miniboss arena)
const DESCENT_AT = { x: 0, z: 38 }; // the way down, sealed behind the portcullis
const DAIS = { x: 0, z: 58, r: 11 }; // pit-floor dais (giga-boss, floor 1)

// Collision radii below are the footprints MEASURED from the built GLBs by the
// asset pipeline (`prop` lane report), so what you bump into is what you see.
const R_BRAZIER = 0.85;
const R_ALTAR = 1.2; // the altar is placed at scale 1.5 (0.8 x 1.5)
const R_IDOL = 1.5;
const R_FORGE = 1.3;
const R_CAGE = 1.0;
const R_BONES = 0.5;
const R_FANG = 0.85;
const R_STATUE = 0.75;
const R_CAULDRON = 0.7;
const R_THRONE = 0.83;

/** A standing brazier: the map's ring of firelights. */
const brazier = (x: number, z: number): AuthoredDecor => ({
  key: 'infernal_brazier',
  x,
  z,
  yaw: 0,
  r: R_BRAZIER,
});

export const INFERNAL_DECOR: readonly AuthoredDecor[] = [
  // R0 Gatehouse: a broad, readable arrival lane with a lit threshold.
  brazier(-5, -30),
  brazier(5, -30),
  brazier(-5, -17),
  brazier(5, -17),
  // R1 Sacrificial Hall: braziers down both flanks, the altar at the north end.
  brazier(-14, -8),
  brazier(14, -8),
  brazier(-14, 7),
  brazier(14, 7),
  brazier(-14, 21),
  brazier(14, 21),
  { key: 'infernal_altar', x: ALTAR.x, z: ALTAR.z, yaw: 0, scale: 1.5, r: R_ALTAR },
  { key: 'rug', x: 0, z: 5, yaw: 0, scale: 1 },
  { key: 'bone_pile', x: -15.5, z: 13, yaw: 0.6, r: R_BONES },
  { key: 'bone_pile', x: 15.5, z: 18, yaw: 2.1, r: R_BONES },
  // R2 Relic Gallery: gibbets over the aisle, braziers, an alcove behind a fake wall.
  brazier(22, -4),
  brazier(32, -4),
  brazier(22, 18),
  brazier(32, 18),
  { key: 'hanging_cage', x: 22.5, z: 1, yaw: 0, r: R_CAGE },
  { key: 'hanging_cage', x: 31.5, z: 7, yaw: 0.4, r: R_CAGE },
  { key: 'hanging_cage', x: 23, z: 13, yaw: 2.6, r: R_CAGE },
  // R3 West Gallery: a long processional lit by braziers, obsidian breaking the floor.
  brazier(-32, -4),
  brazier(-22, -4),
  brazier(-32, 18),
  brazier(-22, 18),
  { key: 'obsidian_fang', x: -33, z: 8, yaw: 0.8, r: R_FANG },
  { key: 'obsidian_fang', x: -21, z: 13, yaw: 2.2, r: R_FANG },
  // Hooded sentinels flank the processional, staring across the aisle.
  { key: 'infernal_statue', x: -31.5, z: 2, yaw: Math.PI / 2, r: R_STATUE },
  { key: 'infernal_statue', x: -22.5, z: 2, yaw: -Math.PI / 2, r: R_STATUE },
  // R4 Pentagram Rotunda: the sigil, ringed by five flames.
  { key: 'pentagram', x: ROTUNDA.x, z: ROTUNDA.z, yaw: 0, scale: 6.5 },
  { key: 'obsidian_fang', x: -33, z: 25, yaw: 1.1, r: R_FANG },
  { key: 'obsidian_fang', x: -21, z: 45, yaw: 2.7, r: R_FANG },
  // R5 Bone Chamber
  brazier(-32, 52),
  brazier(-22, 52),
  brazier(-32, 70),
  brazier(-22, 70),
  { key: 'bone_pile', x: -32, z: 60, yaw: 0.3, r: R_BONES },
  { key: 'bone_pile', x: -22, z: 64, yaw: 1.9, r: R_BONES },
  { key: 'bone_pile', x: -27, z: 68, yaw: 3.0, r: R_BONES },
  // A bone throne against the north wall faces the room: someone RULED this pit.
  { key: 'bone_throne', x: -27, z: 71.5, yaw: Math.PI, r: R_THRONE },
  // R6 Stairhead: a lit landing around the sealed way down.
  brazier(-5, 31),
  brazier(5, 31),
  brazier(-5, 41),
  brazier(5, 41),
];

// ---- Floor 1: The Pit --------------------------------------------------------
// The descent lands on a raised balcony and the citadel drops away UNDER the
// player: landing (lift 3.2) -> the temple nave tier (1.6) -> the pit arena (0)
// where Azgorath waits, with the forge wing off the nave. Doors between tiers
// become stair ramps (authoredLiftAt), so the relief is real geometry on every
// host, not a flat plane with props.

export const INFERNAL_PIT_ROOMS: readonly AuthoredRoom[] = [
  { id: 'landing', x0: -7, x1: 7, z0: -34, z1: -18, lift: 3.2 }, // P0: the balcony
  { id: 'nave', x0: -16, x1: 16, z0: -18, z1: 30, lift: 1.6 }, // P1: the Great Temple tier
  { id: 'pit', x0: -18, x1: 18, z0: 30, z1: 72 }, // P2: the pit arena (lift 0)
  { id: 'forge', x0: 16, x1: 34, z0: -2, z1: 30, lift: 1.6 }, // P3: Hell Forge wing
];

export const INFERNAL_PIT_DOORS: readonly AuthoredDoor[] = [
  { x: 0, z: -18, hw: 4, hd: 1 }, // landing -> nave (stairs down, 3.2 -> 1.6)
  { x: 0, z: 30, hw: 5, hd: 1 }, // nave -> pit (stairs down, 1.6 -> 0)
  { x: 16, z: 14, hw: 1, hd: 3 }, // nave -> forge (level crossing)
];

export const INFERNAL_PIT_DECOR: readonly AuthoredDecor[] = [
  // P0 Landing: the balcony reads as a lit threshold over the drop.
  brazier(-5, -31),
  brazier(5, -31),
  brazier(-5, -21),
  brazier(5, -21),
  // P1 Nave: processional tier, sentinels and fangs between the brazier lines.
  brazier(-14, -12),
  brazier(14, -12),
  brazier(-14, 10),
  brazier(14, 10),
  brazier(-14, 26),
  brazier(14, 26),
  { key: 'rug', x: 0, z: 6, yaw: 0, scale: 1 },
  { key: 'infernal_statue', x: -13, z: -6, yaw: Math.PI / 2, r: R_STATUE },
  { key: 'infernal_statue', x: 13, z: -6, yaw: -Math.PI / 2, r: R_STATUE },
  { key: 'infernal_statue', x: -13, z: 18, yaw: Math.PI / 2, r: R_STATUE },
  { key: 'infernal_statue', x: 13, z: 18, yaw: -Math.PI / 2, r: R_STATUE },
  { key: 'obsidian_fang', x: -13, z: 24, yaw: 0.5, r: R_FANG },
  { key: 'obsidian_fang', x: 13, z: -2, yaw: 2.4, r: R_FANG },
  // P2 The pit: the arena ringed by fire, the idol looming over the dais.
  brazier(-16, 36),
  brazier(16, 36),
  brazier(-16, 56),
  brazier(16, 56),
  brazier(-16, 68),
  brazier(16, 68),
  // The idol looks SOUTH across the pit: a party coming down the stairs walks
  // into its gaze, not its back.
  { key: 'demon_idol', x: 0, z: 68.5, yaw: Math.PI, r: R_IDOL },
  { key: 'bone_pile', x: -15, z: 46, yaw: 0.3, r: R_BONES },
  { key: 'bone_pile', x: 14, z: 50, yaw: 1.9, r: R_BONES },
  { key: 'obsidian_fang', x: -15, z: 62, yaw: 1.1, r: R_FANG },
  { key: 'obsidian_fang', x: 15, z: 44, yaw: 2.7, r: R_FANG },
  // P3 Hell Forge: the working wing, molten and cluttered.
  brazier(20, 2),
  brazier(32, 2),
  brazier(20, 26),
  brazier(32, 26),
  { key: 'hell_forge', x: 30, z: 14, yaw: -Math.PI / 2, r: R_FORGE },
  { key: 'slag_cauldron', x: 22, z: 5, yaw: 0.6, r: R_CAULDRON },
  { key: 'bone_pile', x: 20, z: 22, yaw: 1.2, r: R_BONES },
];

/** Trash placements: (templateId, x, z). Kept inside their rooms and off every
 * decor collider (pinned by tests/rift_infernal.test.ts). */
const TRASH_PLAN: ReadonlyArray<readonly [string, number, number]> = [
  // R1 Sacrificial Hall. The three bands sit at z 4 / 13 / 22 rather than hard against
  // the gatehouse door: the front band has to clear the arrival point by
  // RIFT_ENTRY_CLEAR_RADIUS (rift/entry_clearance.ts) or stepping out of the gatehouse
  // pulls it, and aggro is not line-of-sight gated so the door wall does not help. The
  // whole hall shifted back together to keep the author's three distinct packs.
  ['rift_hellguard', -10, 4],
  ['rift_hellguard', 8, 4],
  ['rift_pact_acolyte', -7, 13],
  ['rift_hellguard', 9, 13],
  ['rift_pact_acolyte', -10, 22],
  ['rift_hellguard', 10, 22],
  // R2 Relic Gallery
  ['rift_hellguard', 27, -2],
  ['rift_pact_acolyte', 27, 7],
  ['rift_hellguard', 28, 15],
  // R3 West Gallery
  ['rift_hellguard', -27, 0],
  ['rift_pact_acolyte', -29, 7],
  ['rift_hellguard', -25, 16],
  // R4 Pentagram Rotunda: the ritualist's two attendants
  ['rift_pact_acolyte', -32, 35],
  ['rift_pact_acolyte', -22, 35],
  // R5 Bone Chamber
  ['rift_pact_acolyte', -30, 57],
  ['rift_pact_acolyte', -24, 64],
];

/** Pit-floor trash: same placement contract as TRASH_PLAN, on the floor-1 map. */
const PIT_TRASH_PLAN: ReadonlyArray<readonly [string, number, number]> = [
  // P1 Nave. Same arrival clearance as the halls: the front band moved off the balcony
  // landing (z -10 was 18.9 yd from the entry, well inside the clamp) to z 2, and the
  // second band back to z 12 so the nave still reads as three separate pulls.
  ['rift_pact_acolyte', -10, 2],
  ['rift_pact_acolyte', 10, 2],
  ['rift_hellguard', -8, 12],
  ['rift_hellguard', 8, 12],
  ['rift_hellguard', 0, 24],
  // P2 The pit approach
  ['rift_hellguard', -10, 38],
  ['rift_hellguard', 10, 38],
  // P3 Hell Forge
  ['rift_hellguard', 22, 10],
  ['rift_pact_acolyte', 29, 22],
];

/** The lava band flooding the middle of the west gallery: jump it, skirt it, or
 * take the burn. Same damage model as the procedural floors' molten bands. */
const INFERNAL_HAZARDS: readonly DelveHazardZone[] = [
  { x: -27, z: 11, r: 6.2, rx: 6.2, rz: 3.5, tier: 'shallow' },
];

/** Molten runoff pooling across the forge wing's floor (floor 1). */
const PIT_HAZARDS: readonly DelveHazardZone[] = [
  { x: 25, z: 20, r: 4.5, rx: 4.5, rz: 2.2, tier: 'shallow' },
];

// ---- The builder -----------------------------------------------------------

/** The citadel descends: floor 0 is the halls, floor 1 the pit. */
export const INFERNAL_FLOOR_COUNT = 2;

/** Build one citadel floor. Pure: identical output for identical arguments, and the
 * only randomness is the colour jitter drawn from a descriptor-seeded local Rng. */
export function buildInfernalCitadelFloor(
  seed: number,
  baseLevel: number,
  floorLevel: number,
  floorIndex = 0,
): RiftFloorPlan {
  const rng = new Rng(mixSeed(seed, 0xc17a + floorIndex));
  const pit = floorIndex >= 1;

  const layout = {
    zMin: -34,
    zMax: pit ? 72 : 74,
    sideWallZ: 31,
    sideWallHd: 65,
    pillars: [],
    tombs: [],
    stubs: [],
    dais: pit ? { ...DAIS } : { x: ROTUNDA.x, z: ROTUNDA.z, r: 8 },
    wallX: 36,
    endWallHw: 37,
    floorHalfX: 36,
    doorZ: -32,
    rooms: (pit ? INFERNAL_PIT_ROOMS : INFERNAL_ROOMS).map((r) => ({ ...r })),
    doors: (pit ? INFERNAL_PIT_DOORS : INFERNAL_DOORS).map((d) => ({ ...d })),
    decor: (pit ? INFERNAL_PIT_DECOR : INFERNAL_DECOR).map((d) => ({ ...d })),
    // Every citadel wall is solid: the relic gallery's cache used to hide behind
    // a collider-less illusion panel, but phantom walls are gone rift-wide, so
    // the alcove and its cache now stand in the open.
    illusionWalls: [],
  };

  const spawns: RiftSpawn[] = (pit ? PIT_TRASH_PLAN : TRASH_PLAN).map(([templateId, x, z]) => ({
    templateId,
    x,
    z,
    level: floorLevel,
  }));
  if (pit) {
    // The giga-boss waits at the bottom of the pit: his death opens the way home.
    spawns.push({
      templateId: 'rift_boss_pitlord',
      x: DAIS.x,
      z: DAIS.z,
      level: floorLevel,
      boss: true,
    });
  } else {
    // Miniboss on the pentagram: his death arms the Blood Orb.
    spawns.push({
      templateId: 'rift_boss_ritualist',
      x: ROTUNDA.x,
      z: ROTUNDA.z,
      level: floorLevel,
      miniboss: true,
    });
  }

  const objects: RiftObjectPlan[] = pit
    ? [
        // The `chest` marker is where runs.ts tears the exit + sealed cache open
        // once the giga-boss falls (it is never spawned as an object itself).
        { kind: 'chest', x: 0, z: 64, name: 'Rift Cache' },
        // The forge wing's off-path reward, past the molten runoff.
        { kind: 'treasure', x: 32, z: 26, name: 'Forge Cache' },
      ]
    : [
        { kind: 'infernal_orb', x: ALTAR.x, z: ALTAR.z, name: 'Blood Orb' },
        { kind: 'gate', x: 0, z: GATE_Z, name: 'Temple Gate' },
        // The way down to the pit, sealed behind the portcullis. runs.ts records
        // the position and opens it once the halls are cleared.
        { kind: 'descent', x: DESCENT_AT.x, z: DESCENT_AT.z, name: 'Rift Descent' },
        // The off-path reward behind the relic gallery's illusion wall.
        { kind: 'treasure', x: 34, z: 16, name: 'Hidden Cache' },
      ];

  return {
    seed: seed >>> 0,
    baseLevel: Math.round(baseLevel),
    floorIndex: pit ? 1 : 0,
    floorCount: INFERNAL_FLOOR_COUNT,
    isBoss: pit,
    authored: true,
    name: infernalCitadelName(seed),
    themeName: INFERNAL_THEME_NAME,
    layout,
    style: buildStyle(rng, INFERNAL_STYLE),
    entry: pit ? { x: 0, z: -26 } : { x: 0, z: -24 },
    spawns,
    objects,
    puzzle: { kind: 'none', pylonCount: 0 },
    hazards: (pit ? PIT_HAZARDS : INFERNAL_HAZARDS).map((h) => ({ ...h })),
    iceZone: null,
    rollers: [],
    platform: null,
    // Floor 0: the portcullis barring the stairhead. It has no pressure plate:
    // the Blood Orb opens it, and only after the ritualist falls. `hw` spans the
    // shared wall. The pit floor has no gate (gateOpen derives true).
    gate: pit
      ? null
      : { x: 0, z: GATE_Z, hw: 18, hd: 1.6, switchX: 0, switchZ: 0, openOnOrb: true },
  };
}

/** Instance-local colliders for a citadel floor (walls minus doorways, plus the
 * decor footprints). Exposed for tests; the runtime goes through layoutColliders. */
export function infernalCitadelColliders(floorIndex = 0): ReturnType<typeof layoutColliders> {
  return layoutColliders(buildInfernalCitadelFloor(1, 20, 20, floorIndex).layout);
}
