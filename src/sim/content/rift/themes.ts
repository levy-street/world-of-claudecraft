// Rift environment archetypes. Each theme pairs one hand-authored KayKit interior
// kit with a generated colour grade (torch/fog/tints) and a mob roster. The
// generator (src/sim/rift/rift_gen.ts) picks a theme per FLOOR, so a single rift
// can descend through wildly different environments, and picks differently across
// rifts. Data-as-code: no logic here.
//
// Colour fields are 0xRRGGBB. Torch triples mirror TORCH_COLORS in
// render/dungeon.ts ({flame, emissive, light}).

import type { InteriorKit } from '../../dungeon_layout';

export interface RiftTheme {
  id: string;
  /** Short environment label for the HUD, e.g. "Emberforge". */
  name: string;
  /** Proper-noun fragments the rift name is assembled from. */
  nouns: readonly string[];
  kit: InteriorKit;
  torch: { flame: number; emissive: number; light: number };
  fog: { color: number; near: number; far: number };
  wallTint?: number;
  floorTint?: number;
  daisRaised?: boolean;
  /** Trash template ids (from content/rift/mobs.ts) this theme draws packs from. */
  trash: readonly string[];
  /** Boss template id for a boss floor rolled with this theme. */
  boss: string;
}

export const RIFT_THEMES: readonly RiftTheme[] = [
  {
    id: 'frost',
    name: 'Frostbound',
    nouns: ['Rime', 'Hoarfrost', 'Glacier', 'Frost'],
    kit: 'crypt',
    torch: { flame: 0x9fd8ff, emissive: 0x4aa8ff, light: 0x8fd0ff },
    fog: { color: 0x0a1420, near: 16, far: 88 },
    wallTint: 0x9fc4e6,
    floorTint: 0xb0cfe6,
    trash: ['rift_frost_revenant', 'rift_rime_elemental'],
    boss: 'rift_boss_frost',
  },
  {
    id: 'ember',
    name: 'Emberforge',
    nouns: ['Ember', 'Cinder', 'Magma', 'Ash'],
    kit: 'bastion',
    torch: { flame: 0xffb24a, emissive: 0xff5a1a, light: 0xff8a3a },
    fog: { color: 0x1a0a06, near: 14, far: 80 },
    wallTint: 0xd98a6a,
    floorTint: 0xc26a4a,
    daisRaised: true,
    trash: ['rift_ember_fiend', 'rift_magma_brute'],
    boss: 'rift_boss_ember',
  },
  {
    id: 'venom',
    name: 'Venomweald',
    nouns: ['Venom', 'Thorn', 'Bramble', 'Spider'],
    kit: 'temple',
    torch: { flame: 0xc9ff8a, emissive: 0x6fbf2a, light: 0xa6e85a },
    fog: { color: 0x0a1608, near: 14, far: 78 },
    wallTint: 0x8fae6a,
    floorTint: 0x7a9a55,
    trash: ['rift_venom_weaver', 'rift_thornback'],
    boss: 'rift_boss_venom',
  },
  {
    id: 'bone',
    name: 'Boneyard',
    nouns: ['Bone', 'Marrow', 'Ossuary', 'Grave'],
    kit: 'crypt',
    torch: { flame: 0xe8e0c8, emissive: 0xbfa870, light: 0xd8c8a0 },
    fog: { color: 0x0d0c0a, near: 18, far: 84 },
    wallTint: 0xd8cfb0,
    trash: ['rift_boneclad', 'rift_marrow_troll'],
    boss: 'rift_boss_necro',
  },
  {
    id: 'brute',
    name: 'Warcamp',
    nouns: ['War', 'Skull', 'Iron', 'Blood'],
    kit: 'sanctum',
    torch: { flame: 0xffc46a, emissive: 0xd97a2a, light: 0xe89a4a },
    fog: { color: 0x120d08, near: 16, far: 82 },
    wallTint: 0xc0a878,
    daisRaised: true,
    trash: ['rift_stone_ogre', 'rift_marrow_troll'],
    boss: 'rift_boss_brute',
  },
  {
    id: 'void',
    name: 'Voidscar',
    nouns: ['Void', 'Shadow', 'Umbral', 'Dusk'],
    kit: 'sanctum',
    torch: { flame: 0xc98aff, emissive: 0x7a2aff, light: 0xa65aff },
    fog: { color: 0x0a0612, near: 15, far: 80 },
    wallTint: 0x9a7ac0,
    floorTint: 0x8a6ab0,
    trash: ['rift_void_acolyte', 'rift_dread_stalker'],
    boss: 'rift_boss_arcane',
  },
  {
    id: 'storm',
    name: 'Stormspire',
    nouns: ['Storm', 'Tempest', 'Thunder', 'Gale'],
    kit: 'bastion',
    torch: { flame: 0x8af0ff, emissive: 0x2a9aff, light: 0x5abfff },
    fog: { color: 0x081018, near: 16, far: 86 },
    wallTint: 0x7aa8d8,
    floorTint: 0x6a98c8,
    trash: ['rift_storm_caller', 'rift_stormscale'],
    boss: 'rift_boss_storm',
  },
  {
    id: 'tide',
    name: 'Sunken',
    nouns: ['Sunken', 'Abyssal', 'Drowned', 'Tide'],
    kit: 'temple',
    torch: { flame: 0x8afff0, emissive: 0x2ad9c0, light: 0x5ae8d0 },
    fog: { color: 0x06141a, near: 12, far: 76 },
    wallTint: 0x6aae9e,
    floorTint: 0x5a9e8e,
    trash: ['rift_tide_thrall', 'rift_deep_lurker'],
    boss: 'rift_boss_tide',
  },
];
