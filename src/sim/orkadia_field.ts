// Orkadia open-field interior. This pure module is the shared source of truth
// for terrain height, prop placement, and static collision in every instance.
// All coordinates are instance-local and stay inside the 500 yd slot contract.

export type OrkadiaPropKind =
  | 'orkadia_spiked_barricade'
  | 'orkadia_war_totem'
  | 'orkadia_war_banner'
  | 'orkadia_green_brazier'
  | 'orkadia_skull_pile'
  | 'orkadia_weapon_rack'
  | 'orkadia_volcanic_cliff'
  | 'orkadia_war_gate'
  | 'orkadia_war_hall'
  | 'orkadia_skull_dais'
  | 'orkadia_watchtower'
  | 'orkadia_palisade'
  | 'orkadia_war_drum'
  | 'orkadia_prisoner_cage'
  | 'orkadia_bone_throne'
  | 'orkadia_torch_post'
  | 'orkadia_trophy_pole'
  | 'orkadia_supply_crates'
  | 'orkadia_war_tent'
  | 'orkadia_catapult';

export interface OrkadiaPropPlacement {
  kind: OrkadiaPropKind;
  x: number;
  z: number;
  rot: number;
  scale?: number;
}

export const ORKADIA_FIELD_BOUNDS = { minX: -78, maxX: 78, minZ: -20, maxZ: 240 } as const;

export const ORKADIA_FIELD_WALLS: readonly { x: number; z: number; hw: number; hd: number }[] = [
  { x: -78, z: 110, hw: 1, hd: 130 },
  { x: 78, z: 110, hw: 1, hd: 130 },
  { x: 0, z: 240, hw: 79, hd: 1 },
  { x: 0, z: -20, hw: 79, hd: 1 },
];

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mound(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return 1 - smoothstep(0.35, 1, d);
}

/** The readable processional route used by terrain paint and encounter staging. */
export function orkadiaRouteCenter(lz: number): number {
  const arrive = smoothstep(18, 42, lz);
  const boss = 1 - smoothstep(184, 214, lz);
  return (Math.sin(lz * 0.042 - 1.1) * 9 + Math.sin(lz * 0.019 + 0.7) * 4) * arrive * boss;
}

/**
 * A terraced volcanic basin rather than a displaced plane. The center route
 * climbs gradually through three camp shelves, the sides rise into canyon
 * shoulders, and the boss plateau resolves to a broad flat fighting surface.
 */
export function orkadiaFieldHeight(lx: number, lz: number): number {
  const arrival = smoothstep(8, 32, lz);
  const routeX = orkadiaRouteCenter(lz);
  const routeDistance = Math.abs(lx - routeX);

  const smallRelief =
    0.45 * Math.sin(lx * 0.075 + lz * 0.021) + 0.3 * Math.sin(lx * 0.031 - lz * 0.061 + 1.4);
  const climb =
    1.05 * smoothstep(24, 52, lz) +
    1.55 * smoothstep(68, 96, lz) +
    2.05 * smoothstep(112, 142, lz) +
    2.4 * smoothstep(154, 184, lz);

  const canyonShoulder = (5.4 + 4.2 * smoothstep(70, 220, lz)) * smoothstep(34, 70, routeDistance);
  const westShelf = 2.35 * mound(lx, lz, -31, 66, 28, 38);
  const eastShelf = 2.7 * mound(lx, lz, 31, 132, 29, 42);
  const siegeShelf = 2.15 * mound(lx, lz, -34, 176, 26, 32);
  const ritualHollow = -1.25 * mound(lx, lz, 0, 112, 23, 17);

  let height =
    (smallRelief + climb + canyonShoulder + westShelf + eastShelf + siegeShelf + ritualHollow) *
    arrival;

  const bossBlend = smoothstep(190, 211, lz) * (1 - smoothstep(25, 38, Math.abs(lx)));
  height += (9.2 - height) * bossBlend;
  return height;
}

const PI = Math.PI;

export const ORKADIA_FIELD_PLACEMENTS: readonly OrkadiaPropPlacement[] = [
  // Arrival gatehouse and its defensive wings.
  { kind: 'orkadia_torch_post', x: -10, z: 7, rot: 0, scale: 1.15 },
  { kind: 'orkadia_torch_post', x: 10, z: 7, rot: 0, scale: 1.15 },
  { kind: 'orkadia_war_gate', x: 0, z: 20, rot: 0 },
  { kind: 'orkadia_palisade', x: -18, z: 20, rot: 0, scale: 1.15 },
  { kind: 'orkadia_palisade', x: 18, z: 20, rot: 0, scale: 1.15 },
  { kind: 'orkadia_palisade', x: -35, z: 21, rot: 0.08, scale: 1.1 },
  { kind: 'orkadia_palisade', x: 35, z: 21, rot: -0.08, scale: 1.1 },
  { kind: 'orkadia_watchtower', x: -50, z: 24, rot: PI / 2, scale: 1.05 },
  { kind: 'orkadia_watchtower', x: 50, z: 24, rot: -PI / 2, scale: 1.05 },
  { kind: 'orkadia_war_banner', x: -12, z: 31, rot: 0.2, scale: 1.1 },
  { kind: 'orkadia_war_banner', x: 12, z: 31, rot: -0.2, scale: 1.1 },

  // Bloodtusk bivouac on the west shelf.
  { kind: 'orkadia_war_tent', x: -34, z: 50, rot: 0.55 },
  { kind: 'orkadia_war_tent', x: -40, z: 68, rot: 0.15, scale: 0.88 },
  { kind: 'orkadia_green_brazier', x: -22, z: 57, rot: 0, scale: 1.25 },
  { kind: 'orkadia_weapon_rack', x: -19, z: 69, rot: 0.75, scale: 1.15 },
  { kind: 'orkadia_supply_crates', x: -28, z: 75, rot: 0.4, scale: 1.25 },
  { kind: 'orkadia_war_drum', x: -43, z: 80, rot: 0.3, scale: 1.2 },
  { kind: 'orkadia_war_totem', x: -55, z: 59, rot: 0.15, scale: 1.15 },
  { kind: 'orkadia_skull_pile', x: -19, z: 49, rot: 0.2, scale: 1.2 },
  { kind: 'orkadia_war_banner', x: -14, z: 54, rot: 0.4 },

  // Ironhide siege yard on the east shelf.
  { kind: 'orkadia_catapult', x: 36, z: 61, rot: -0.65 },
  { kind: 'orkadia_supply_crates', x: 27, z: 69, rot: -0.2, scale: 1.4 },
  { kind: 'orkadia_spiked_barricade', x: 46, z: 76, rot: -0.9, scale: 1.2 },
  { kind: 'orkadia_watchtower', x: 55, z: 86, rot: -PI / 2 },
  { kind: 'orkadia_war_tent', x: 37, z: 91, rot: -0.3, scale: 0.9 },
  { kind: 'orkadia_torch_post', x: 22, z: 84, rot: 0 },
  { kind: 'orkadia_trophy_pole', x: 48, z: 96, rot: PI, scale: 1.1 },
  { kind: 'orkadia_war_banner', x: 17, z: 98, rot: -0.35 },

  // Central ritual ground and prisoner stockade.
  { kind: 'orkadia_green_brazier', x: 9, z: 108, rot: 0, scale: 1.25 },
  { kind: 'orkadia_war_totem', x: 20, z: 115, rot: 0, scale: 1.35 },
  { kind: 'orkadia_war_drum', x: 31, z: 121, rot: -0.4, scale: 1.25 },
  { kind: 'orkadia_war_banner', x: -13, z: 114, rot: 0.2, scale: 1.1 },
  { kind: 'orkadia_palisade', x: -39, z: 124, rot: PI / 2, scale: 1.05 },
  { kind: 'orkadia_palisade', x: -39, z: 140, rot: PI / 2, scale: 1.05 },
  { kind: 'orkadia_prisoner_cage', x: -30, z: 127, rot: -0.4, scale: 1.1 },
  { kind: 'orkadia_prisoner_cage', x: -31, z: 136, rot: 0.35, scale: 1.1 },
  { kind: 'orkadia_torch_post', x: -22, z: 131, rot: 0 },
  { kind: 'orkadia_trophy_pole', x: -47, z: 132, rot: 0, scale: 1.2 },
  { kind: 'orkadia_skull_pile', x: -24, z: 143, rot: 0.7, scale: 1.25 },

  // Marauder command camp and eastern workshops.
  { kind: 'orkadia_war_tent', x: 35, z: 133, rot: -0.55 },
  { kind: 'orkadia_war_tent', x: 43, z: 149, rot: -0.15, scale: 0.82 },
  { kind: 'orkadia_green_brazier', x: 23, z: 141, rot: 0, scale: 1.2 },
  { kind: 'orkadia_war_drum', x: 34, z: 154, rot: -0.3, scale: 1.2 },
  { kind: 'orkadia_weapon_rack', x: 20, z: 155, rot: -0.65, scale: 1.15 },
  { kind: 'orkadia_supply_crates', x: 47, z: 160, rot: 0.5, scale: 1.35 },
  { kind: 'orkadia_war_banner', x: 13, z: 151, rot: -0.25, scale: 1.15 },

  // Final siege shelf before the inner gate.
  { kind: 'orkadia_catapult', x: -37, z: 165, rot: 0.55, scale: 1.05 },
  { kind: 'orkadia_supply_crates', x: -27, z: 171, rot: 0.3, scale: 1.4 },
  { kind: 'orkadia_spiked_barricade', x: -49, z: 177, rot: 0.85, scale: 1.2 },
  { kind: 'orkadia_watchtower', x: -57, z: 174, rot: PI / 2, scale: 1.05 },
  { kind: 'orkadia_war_tent', x: -39, z: 187, rot: 0.3, scale: 0.9 },
  { kind: 'orkadia_green_brazier', x: -23, z: 181, rot: 0, scale: 1.2 },
  { kind: 'orkadia_trophy_pole', x: -49, z: 194, rot: 0.2, scale: 1.2 },

  // Inner gate and processional climb to Grommok's plateau.
  { kind: 'orkadia_war_gate', x: 0, z: 191, rot: 0, scale: 1.08 },
  { kind: 'orkadia_palisade', x: -19, z: 192, rot: 0.05, scale: 1.2 },
  { kind: 'orkadia_palisade', x: 19, z: 192, rot: -0.05, scale: 1.2 },
  { kind: 'orkadia_palisade', x: -38, z: 194, rot: 0.12, scale: 1.1 },
  { kind: 'orkadia_palisade', x: 38, z: 194, rot: -0.12, scale: 1.1 },
  { kind: 'orkadia_torch_post', x: -10, z: 184, rot: 0, scale: 1.2 },
  { kind: 'orkadia_torch_post', x: 10, z: 184, rot: 0, scale: 1.2 },
  { kind: 'orkadia_war_banner', x: -12, z: 204, rot: 0.2, scale: 1.25 },
  { kind: 'orkadia_war_banner', x: 12, z: 204, rot: -0.2, scale: 1.25 },

  // Warlord's ring and fortress.
  { kind: 'orkadia_skull_dais', x: 0, z: 220, rot: 0, scale: 1.8 },
  { kind: 'orkadia_bone_throne', x: 0, z: 231, rot: PI, scale: 1.25 },
  { kind: 'orkadia_skull_pile', x: -9, z: 229, rot: 0.1, scale: 1.35 },
  { kind: 'orkadia_skull_pile', x: 10, z: 228, rot: 0.8, scale: 1.35 },
  { kind: 'orkadia_green_brazier', x: -16, z: 219, rot: 0, scale: 1.35 },
  { kind: 'orkadia_green_brazier', x: 16, z: 219, rot: 0, scale: 1.35 },
  { kind: 'orkadia_trophy_pole', x: -14, z: 208, rot: 0, scale: 1.3 },
  { kind: 'orkadia_trophy_pole', x: 14, z: 208, rot: PI, scale: 1.3 },
  { kind: 'orkadia_watchtower', x: -31, z: 229, rot: PI / 2, scale: 1.1 },
  { kind: 'orkadia_watchtower', x: 31, z: 229, rot: -PI / 2, scale: 1.1 },
  { kind: 'orkadia_war_hall', x: 0, z: 238, rot: 0 },

  // Side fortifications. These sit outside the combat pockets and make the
  // camp read as a defended settlement rather than scattered props.
  ...[48, 82, 116, 150, 184].flatMap((z, i) => [
    { kind: 'orkadia_palisade' as const, x: -61, z, rot: PI / 2 + (i % 2 ? 0.05 : -0.05) },
    { kind: 'orkadia_palisade' as const, x: 61, z, rot: PI / 2 + (i % 2 ? -0.05 : 0.05) },
  ]),

  // Basalt canyon shell. Cliff meshes are render-only; the four field walls
  // remain the authoritative movement enclosure.
  ...[-8, 20, 49, 78, 108, 138, 168, 198, 226].flatMap((z, i) => [
    {
      kind: 'orkadia_volcanic_cliff' as const,
      x: -72 + (i % 2) * 2,
      z,
      rot: PI / 2 + i * 0.37,
      scale: 0.88 + (i % 3) * 0.12,
    },
    {
      kind: 'orkadia_volcanic_cliff' as const,
      x: 72 - (i % 2) * 2,
      z,
      rot: -PI / 2 - i * 0.31,
      scale: 0.94 + ((i + 1) % 3) * 0.11,
    },
  ]),
  ...[-55, -28, 0, 28, 55].map((x, i) => ({
    kind: 'orkadia_volcanic_cliff' as const,
    x,
    z: 239,
    rot: PI + i * 0.42,
    scale: 1.02 + (i % 2) * 0.16,
  })),
];

interface OrkadiaFootprint {
  r: number;
  h: number;
  posts?: readonly { dx: number; dz: number; r: number }[];
}

const ORKADIA_PROP_FOOTPRINTS: Record<OrkadiaPropKind, OrkadiaFootprint> = {
  orkadia_spiked_barricade: { r: 2.8, h: 2.8 },
  orkadia_war_totem: { r: 1.1, h: 5.2 },
  orkadia_war_banner: { r: 0.8, h: 5.0 },
  orkadia_green_brazier: { r: 1.35, h: 2.2 },
  orkadia_skull_pile: { r: 1.5, h: 1.3 },
  orkadia_weapon_rack: { r: 1.5, h: 2.4 },
  orkadia_volcanic_cliff: { r: 0, h: 22 },
  orkadia_war_gate: {
    r: 0,
    h: 12,
    posts: [
      { dx: -12, dz: -8, r: 4.5 },
      { dx: -12, dz: 0, r: 4.5 },
      { dx: -12, dz: 8, r: 4.5 },
      { dx: 12, dz: -8, r: 4.5 },
      { dx: 12, dz: 0, r: 4.5 },
      { dx: 12, dz: 8, r: 4.5 },
    ],
  },
  orkadia_war_hall: { r: 10.5, h: 20 },
  orkadia_skull_dais: { r: 0, h: 1.8 },
  orkadia_watchtower: { r: 4, h: 12 },
  orkadia_palisade: {
    r: 0,
    h: 5,
    posts: [
      { dx: -3.6, dz: 0, r: 1.4 },
      { dx: 0, dz: 0, r: 1.4 },
      { dx: 3.6, dz: 0, r: 1.4 },
    ],
  },
  orkadia_war_drum: { r: 1.3, h: 1.8 },
  orkadia_prisoner_cage: { r: 1.35, h: 3 },
  orkadia_bone_throne: { r: 2, h: 3.6 },
  orkadia_torch_post: { r: 0.7, h: 3.4 },
  orkadia_trophy_pole: { r: 0.55, h: 4.2 },
  orkadia_supply_crates: { r: 1.25, h: 1.5 },
  orkadia_war_tent: { r: 4.6, h: 6.5 },
  orkadia_catapult: { r: 3.2, h: 4.5 },
};

export interface OrkadiaColliderSpec {
  kind: OrkadiaPropKind;
  x: number;
  z: number;
  r: number;
  h: number;
}

export const ORKADIA_FIELD_COLLIDER_SPECS: readonly OrkadiaColliderSpec[] =
  ORKADIA_FIELD_PLACEMENTS.flatMap((p) => {
    const fp = ORKADIA_PROP_FOOTPRINTS[p.kind];
    const scale = p.scale ?? 1;
    if (fp.posts) {
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      return fp.posts.map((post) => ({
        kind: p.kind,
        x: p.x + (post.dx * c + post.dz * s) * scale,
        z: p.z + (-post.dx * s + post.dz * c) * scale,
        r: post.r * scale,
        h: fp.h * scale,
      }));
    }
    return fp.r > 0 ? [{ kind: p.kind, x: p.x, z: p.z, r: fp.r * scale, h: fp.h * scale }] : [];
  });
