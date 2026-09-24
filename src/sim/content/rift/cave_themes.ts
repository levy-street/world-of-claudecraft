// The cave bosses of the common and rare Buried Hoards. A common or rare map
// opens a cave room sized for a small party, and the eight themed bosses of
// RIFT_THEMES were built for the wide valleys of the epic and legendary maps
// (their mechanics reach 16 to 75 yards), so a cave draws its theme, and with it
// its boss, from this list instead (src/sim/rift/rift_gen.ts themeForFloor).
// Ordinary rifts never read it. Data-as-code: no logic here.
//
// These themes stay OUT of RIFT_THEMES on purpose: that list is every ordinary
// rift's pool, its roster index and its upgrade manifest.

import type { RiftTheme } from './themes';

export const CAVE_THEMES: readonly RiftTheme[] = [
  {
    id: 'spore',
    name: 'Spore Hollow',
    nouns: ['Spore', 'Toadstool', 'Mould', 'Mycelium'],
    // Crypt stone, never the temple kit: the temple floods its floor with water
    // and caustics, which read as a garish teal floor in a cave (playtest).
    kit: 'crypt',
    torch: { flame: 0xd8f07a, emissive: 0x8aa82a, light: 0xc6e06a },
    fog: { color: 0x10120a, near: 14, far: 76 },
    wallTint: 0x9a8a6a,
    floorTint: 0x8a7a55,
    trash: ['rift_venom_weaver', 'rift_thornback'],
    boss: 'hoard_boss_mushroom',
  },
  {
    id: 'burrow',
    name: 'Deep Burrow',
    nouns: ['Burrow', 'Tunnel', 'Delve', 'Loam'],
    kit: 'sanctum',
    torch: { flame: 0xffc46a, emissive: 0xc97a2a, light: 0xe8a04a },
    fog: { color: 0x120d08, near: 15, far: 80 },
    wallTint: 0xa8865a,
    floorTint: 0x8a6a45,
    trash: ['rift_stone_ogre', 'rift_marrow_troll'],
    boss: 'hoard_boss_mole',
  },
  {
    id: 'roost',
    name: 'Bat Roost',
    nouns: ['Roost', 'Echo', 'Guano', 'Hollow'],
    kit: 'crypt',
    torch: { flame: 0xff9a7a, emissive: 0xa83a2a, light: 0xd86a5a },
    fog: { color: 0x0e0808, near: 14, far: 76 },
    wallTint: 0x8a6a6a,
    floorTint: 0x6a5555,
    trash: ['rift_void_acolyte', 'rift_dread_stalker'],
    boss: 'hoard_boss_bat',
  },
  {
    id: 'mimic',
    name: 'False Vault',
    nouns: ['Coffer', 'Strongbox', 'Tithe', 'Gilt'],
    kit: 'bastion',
    torch: { flame: 0xffd86a, emissive: 0xd9a82a, light: 0xf0c45a },
    fog: { color: 0x14100a, near: 15, far: 80 },
    wallTint: 0xc8a878,
    floorTint: 0xa8885a,
    trash: ['rift_boneclad', 'rift_marrow_golem'],
    boss: 'hoard_boss_mimic',
  },
];
