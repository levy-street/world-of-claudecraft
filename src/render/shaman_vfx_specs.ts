import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';

export type ShamanElement = 'storm' | 'earth' | 'fire' | 'ice' | 'water' | 'wind' | 'spirit';
export type ShamanAction =
  | 'bolt'
  | 'jolt'
  | 'strike'
  | 'heal'
  | 'ward'
  | 'imbue'
  | 'field'
  | 'exalt'
  | 'morph'
  | 'revive';
export interface ShamanComposition {
  element: ShamanElement;
  action: ShamanAction;
  radius: number;
  height: number;
  weight: number;
}

// Scale is the decorative silhouette, never a substitute for the real area.
// Primary contact, material breakup and fine glints have separate value ranges.
const compositions: Record<string, ShamanComposition> = {
  lightning_bolt: { element: 'storm', action: 'bolt', radius: 3.0, height: 3.2, weight: 1.15 },
  chain_lightning: { element: 'storm', action: 'bolt', radius: 3.65, height: 5.4, weight: 1.55 },
  earth_shock: { element: 'earth', action: 'jolt', radius: 3.2, height: 3.0, weight: 1.5 },
  flame_shock: { element: 'fire', action: 'jolt', radius: 2.85, height: 3.4, weight: 1.15 },
  frost_shock: { element: 'ice', action: 'jolt', radius: 2.7, height: 2.9, weight: 1.2 },
  stormstrike: { element: 'storm', action: 'strike', radius: 3.1, height: 2.4, weight: 1.6 },
  healing_wave: { element: 'water', action: 'heal', radius: 1.9, height: 2.2, weight: 1.15 },
  chain_heal: { element: 'water', action: 'heal', radius: 2.3, height: 2.8, weight: 1.45 },
  tidecall: { element: 'water', action: 'heal', radius: 1.7, height: 1.6, weight: 0.95 },
  stoneward: { element: 'earth', action: 'ward', radius: 1.8, height: 2.6, weight: 1.35 },
  lightning_shield: { element: 'storm', action: 'ward', radius: 1.8, height: 2.8, weight: 1.1 },
  rockbiter_weapon: { element: 'earth', action: 'imbue', radius: 1.15, height: 1.6, weight: 1 },
  flametongue_weapon: { element: 'fire', action: 'imbue', radius: 1.15, height: 1.8, weight: 1 },
  galeheart_weapon: { element: 'wind', action: 'imbue', radius: 1.35, height: 1.8, weight: 1 },
  lifespring_weapon: { element: 'water', action: 'imbue', radius: 1.15, height: 1.6, weight: 1 },
  earthbind: { element: 'earth', action: 'field', radius: 4, height: 1.1, weight: 1.1 },
  earthquake: { element: 'earth', action: 'field', radius: 8, height: 2, weight: 1.8 },
  elemental_mastery: { element: 'storm', action: 'exalt', radius: 2.2, height: 3.5, weight: 1.55 },
  primal_exaltation: { element: 'storm', action: 'exalt', radius: 3.2, height: 4.8, weight: 2 },
  bloodlust: { element: 'storm', action: 'exalt', radius: 3.8, height: 4.2, weight: 2.1 },
  elemental_trance: { element: 'spirit', action: 'ward', radius: 2.1, height: 3.2, weight: 1.6 },
  ghost_wolf: { element: 'spirit', action: 'morph', radius: 1.8, height: 2.2, weight: 1.15 },
  ancestor_return: { element: 'spirit', action: 'revive', radius: 2.4, height: 4.4, weight: 1.9 },
  unleash_weapon: { element: 'wind', action: 'strike', radius: 3.35, height: 3.0, weight: 1.7 },
};

export const SHAMAN_PALETTES: Record<ShamanElement, readonly [string, string, string]> = {
  storm: ['#428bcf', '#e5faff', 'storm'],
  earth: ['#72796b', '#e0d7a4', 'physical'],
  fire: ['#df5a26', '#ffedb2', 'fire'],
  ice: ['#559cba', '#e0fcff', 'frost'],
  water: ['#288d9d', '#bdece0', 'frost'],
  wind: ['#81b6bb', '#e7f6df', 'storm'],
  spirit: ['#7299b9', '#d5e9ed', 'moon'],
};

export const SHAMAN_VFX_FULL_SPECS: Record<string, AbilityVfxFullSpec> = {};
export const SHAMAN_VFX_SPECS: Record<string, AbilityVfxSpec> = {};
for (const [id, shaman] of Object.entries(compositions)) {
  const [tint, accent, palette] = SHAMAN_PALETTES[shaman.element];
  const base = ABILITY_VFX_FULL_SPECS[id];
  const archetype =
    shaman.action === 'heal' || shaman.action === 'revive'
      ? 'heal'
      : ['ward', 'imbue', 'exalt', 'morph'].includes(shaman.action)
        ? 'buff'
        : shaman.action === 'strike'
          ? 'strike'
          : shaman.action === 'field'
            ? 'nova'
            : shaman.action === 'bolt'
              ? 'bolt'
              : 'burst';
  SHAMAN_VFX_FULL_SPECS[id] = {
    ...base,
    shaman,
    archetype,
    tint,
    accent,
    palette,
    power: shaman.weight,
    windup: 0,
    windupStyle: shaman.element === 'water' ? 'ascend' : 'compression',
    filler: true,
    finisher: false,
    motifs: [],
    motifEvery: 0,
    linger: 0,
    spirit: null,
    shaft: false,
    barrier: false,
    screenFx: false,
    decal: undefined,
    strike: shaman.action === 'strike' ? { swings: 1, arc: 'horizontal' } : undefined,
    nova: shaman.action === 'field' ? { radius: shaman.radius } : undefined,
    buff: archetype === 'buff' ? { style: 'raise', orbit: 'none' } : undefined,
    impact: { ring: false, vRing: false, flipbook: false, sparks: 0, light: 0 },
  };
  SHAMAN_VFX_SPECS[id] = {
    ...ABILITY_VFX_SPECS[id],
    c: tint,
    p: palette,
    pw: shaman.weight,
    a: archetype,
    sp: 0,
    li: 0,
    rg: 0,
    vr: undefined,
    fin: undefined,
    bo: undefined,
  };
}
SHAMAN_VFX_FULL_SPECS.lightning_shield.buff = {
  style: 'raise',
  persist: true,
  orbit: 'wardCharges',
  o: { n: 3, radius: 0.7, size: 0.3 },
};
SHAMAN_VFX_FULL_SPECS.elemental_mastery.buff = {
  style: 'raise',
  persist: true,
  orbit: 'none',
};
SHAMAN_VFX_FULL_SPECS.ghost_wolf.buff = {
  style: 'morph',
  orbit: 'none',
};
for (const id of [
  'rockbiter_weapon',
  'flametongue_weapon',
  'galeheart_weapon',
  'lifespring_weapon',
]) {
  SHAMAN_VFX_FULL_SPECS[id].buff = { style: 'raise', persist: true, orbit: 'weaponGlow' };
}
for (const element of ['fire', 'wind', 'earth', 'water'] as const) {
  const id = `unleash_weapon_${element}`;
  const [tint, accent, palette] = SHAMAN_PALETTES[element];
  const action = element === 'water' ? 'heal' : element === 'fire' ? 'jolt' : 'strike';
  SHAMAN_VFX_FULL_SPECS[id] = {
    ...SHAMAN_VFX_FULL_SPECS.unleash_weapon,
    tint,
    accent,
    palette,
    archetype: action === 'heal' ? 'heal' : action === 'jolt' ? 'burst' : 'strike',
    shaman: { element, action, radius: 3.4, height: 3.6, weight: 1.8 },
  };
  SHAMAN_VFX_SPECS[id] = {
    ...SHAMAN_VFX_SPECS.unleash_weapon,
    c: tint,
    p: palette,
    a: SHAMAN_VFX_FULL_SPECS[id].archetype,
  };
}

for (const [baseId, elements] of [
  ['stormstrike', ['earth', 'wind']],
  ['primal_exaltation', ['storm', 'earth', 'fire', 'wind', 'water']],
] as const) {
  for (const element of elements) {
    const id = `${baseId}_${element}`;
    const [tint, accent, palette] = SHAMAN_PALETTES[element];
    const base = SHAMAN_VFX_FULL_SPECS[baseId];
    SHAMAN_VFX_FULL_SPECS[id] = {
      ...base,
      tint,
      accent,
      palette,
      shaman: { ...compositions[baseId], element },
    };
    SHAMAN_VFX_SPECS[id] = { ...SHAMAN_VFX_SPECS[baseId], c: tint, p: palette };
  }
}

/** Local specialization is explicit. Remote material follows an actual enchant;
 * absent enchant data never pretends to identify a remote specialization. */
export function shamanVisualVariant(
  abilityId: string,
  auras: readonly { id: string; remaining?: number }[],
  localSpec?: string | null,
): string {
  const active = (id: string) => auras.some((aura) => aura.id === id && (aura.remaining ?? 0) > 0);
  if (abilityId === 'stormstrike') return 'stormstrike';
  if (abilityId === 'primal_exaltation') {
    if (localSpec === 'restoration') return 'primal_exaltation_water';
    if (localSpec === 'elemental') return 'primal_exaltation_storm';
    if (localSpec === 'enhancement')
      return active('rockbiter_weapon') ? 'primal_exaltation_earth' : 'primal_exaltation_wind';
    for (const [enchant, element] of [
      ['rockbiter_weapon', 'earth'],
      ['galeheart_weapon', 'wind'],
      ['lifespring_weapon', 'water'],
      ['flametongue_weapon', 'fire'],
    ] as const)
      if (active(enchant)) return `primal_exaltation_${element}`;
    return abilityId;
  }
  if (abilityId !== 'unleash_weapon') return abilityId;
  for (const [enchant, element] of [
    ['flametongue_weapon', 'fire'],
    ['galeheart_weapon', 'wind'],
    ['rockbiter_weapon', 'earth'],
    ['lifespring_weapon', 'water'],
  ] as const)
    if (active(enchant)) return `unleash_weapon_${element}`;
  return abilityId;
}
