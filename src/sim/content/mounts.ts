import type { ItemDef } from '../types';

// Mounts: rideable speed buffs bought as items. Using the bridle toggles a
// `mount_<id>` buff_speed aura (moveSpeedMult already honors buff_speed), and
// the renderer swaps the body to the mount rig while the aura is up — the same
// lazy form-swap pattern as polymorph and the druid forms. Taking damage
// dismounts (breaksOnDamage), classic-mount style. The bridle is permanent:
// never consumed on use, and tradeable like any other item.
export interface MountDef {
  id: string;
  name: string;
  /** 1 + fraction, the buff_speed multiplier (1.6 = +60%). */
  speedMult: number;
  /** Flying mounts hover (render-side); same collision rules as ground mounts. */
  flying: boolean;
  /** Renderer visual key in src/render/characters/manifest.ts. */
  visualKey: string;
  itemId: string;
}

export const MOUNTS: Record<string, MountDef> = {
  forest_stag: {
    id: 'forest_stag',
    name: 'Forest Stag',
    speedMult: 1.6,
    flying: false,
    visualKey: 'mount_stag',
    itemId: 'mount_forest_stag',
  },
  swamp_raptor: {
    id: 'swamp_raptor',
    name: 'Swamp Raptor',
    speedMult: 1.7,
    flying: false,
    visualKey: 'mount_raptor',
    itemId: 'mount_swamp_raptor',
  },
  emerald_wyrm: {
    id: 'emerald_wyrm',
    name: 'Emerald Wyrm',
    speedMult: 2.0,
    flying: true,
    visualKey: 'mount_wyrm',
    itemId: 'mount_emerald_wyrm',
  },
};

export const MOUNT_AURA_PREFIX = 'mount_';

export function mountForAuraId(auraId: string): MountDef | null {
  if (!auraId.startsWith(MOUNT_AURA_PREFIX)) return null;
  return MOUNTS[auraId.slice(MOUNT_AURA_PREFIX.length)] ?? null;
}

export const STABLE_MASTER_NPC_ID = 'stable_master_wren';

// Bridle items. buyValue is copper (100 copper = 1 silver, 10000 = 1 gold).
export const MOUNT_ITEMS: Record<string, ItemDef> = {
  mount_forest_stag: {
    id: 'mount_forest_stag',
    name: 'Forest Stag Bridle',
    kind: 'quest',
    quality: 'rare',
    requiredLevel: 10,
    use: { type: 'mount', mountId: 'forest_stag' },
    sellValue: 87500,
    buyValue: 350000, // 35g
    stackSize: 1,
  },
  mount_swamp_raptor: {
    id: 'mount_swamp_raptor',
    name: 'Spearjaw Saddle',
    kind: 'quest',
    quality: 'epic',
    requiredLevel: 20,
    use: { type: 'mount', mountId: 'swamp_raptor' },
    sellValue: 375000,
    buyValue: 1500000, // 150g
    stackSize: 1,
  },
  mount_emerald_wyrm: {
    id: 'mount_emerald_wyrm',
    name: 'Emerald Wyrm Reins',
    kind: 'quest',
    quality: 'legendary',
    requiredLevel: 30,
    use: { type: 'mount', mountId: 'emerald_wyrm' },
    sellValue: 2500000,
    buyValue: 10000000, // 1000g
    stackSize: 1,
  },
};
