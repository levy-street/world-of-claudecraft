// Object materials for built models (the Build tool's solids: stairs, walls,
// props modelled in place). The library IS the terrain texture registry
// (render/terrain_texture_sets.ts): every set is offered, grouped for the
// picker, and a set's `material` entry says how the surface shades (metals
// need a metalness the terrain never has). The Warden set from ambientCG
// (CC0) exists purely for this picker; the Yoge sets double as paint swatches.
//
// Keep this DOM-free: the picker (editor/inspector.ts) and the shader
// (render/model_gen.ts) both read it.

import {
  type MaterialGroup,
  TERRAIN_TEXTURE_SETS,
  terrainTextureSet,
} from './terrain_texture_sets';

export interface ModelMaterialOption {
  /** Registry key (the placement's `modelTexId`). */
  key: string;
  name: string;
  group: MaterialGroup;
  /** Colour map file under textures/terrain/ (thumbnail). */
  file: string;
}

/** Picker order: the groups a maker reaches for most, first. */
export const MATERIAL_GROUP_ORDER: readonly MaterialGroup[] = [
  'stone',
  'brick',
  'paving',
  'metal',
  'wood',
  'plaster',
  'dirt',
  'sand',
  'grass',
  'snow',
  'cloth',
  'lava',
];

/** English group captions (the editor UI is English-only by decision; see the
 *  i18n deferral note). */
export const MATERIAL_GROUP_LABEL: Record<MaterialGroup, string> = {
  stone: 'Stone',
  brick: 'Brick',
  paving: 'Paving',
  metal: 'Metal',
  wood: 'Wood',
  plaster: 'Plaster',
  dirt: 'Dirt',
  sand: 'Sand',
  grass: 'Grass',
  snow: 'Snow',
  cloth: 'Cloth',
  lava: 'Lava',
};

/** A set with no explicit `material` entry is grouped by its key family. */
const GROUP_BY_PREFIX: readonly [RegExp, MaterialGroup][] = [
  [/^(Rock|Cliff|Concrete|Marble)/, 'stone'],
  [/^Bricks/, 'brick'],
  [/^(Cobblestone|PavingStones|Tiles|Gravel)/, 'paving'],
  [/^Ground/, 'dirt'],
  [/^Sand/, 'sand'],
  [/^Grass/, 'grass'],
  [/^Snow/, 'snow'],
  [/^(Wood|Roots|Planks)/, 'wood'],
  [/^Metal|^Rust/, 'metal'],
  [/^Plaster/, 'plaster'],
  [/^(Fabric|Leather)/, 'cloth'],
  [/^Lava/, 'lava'],
];

export function materialGroupFor(key: string): MaterialGroup {
  const set = terrainTextureSet(key);
  if (set?.material) return set.material.group;
  for (const [re, group] of GROUP_BY_PREFIX) if (re.test(key)) return group;
  return 'stone';
}

/** Every material the picker offers, in group order (stable within a group). */
export function modelMaterialOptions(): ModelMaterialOption[] {
  const out: ModelMaterialOption[] = [];
  for (const group of MATERIAL_GROUP_ORDER) {
    for (const set of TERRAIN_TEXTURE_SETS) {
      if (materialGroupFor(set.key) !== group) continue;
      out.push({ key: set.key, name: set.name, group, file: `${set.key}_Color.jpg` });
    }
  }
  return out;
}

/** How a material's surface shades: constant metalness, and the roughness a
 *  set without a roughness map falls back to. */
export function modelMaterialShading(key: string | undefined): {
  metalness: number;
  roughness: number;
} {
  const set = key ? terrainTextureSet(key) : null;
  return {
    metalness: set?.material?.metalness ?? 0,
    roughness: set?.material?.roughness ?? 0.95,
  };
}

/** Material adjustment ranges, shared by the sanitizer, the sliders and the
 *  shader (degrees, multiplier, signed light). */
export const MODEL_HUE_RANGE = 180;
export const MODEL_SAT_MAX = 2;
export const MODEL_LIGHT_RANGE = 1;
