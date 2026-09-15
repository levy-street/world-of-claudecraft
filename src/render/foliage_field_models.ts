export const FOLIAGE_MODEL_DIR = 'models/foliage/';

export type FieldBarkSpecies = 'pine' | 'oak' | 'twisted';

// Variants the field draws from a `_field` copy with decimated bark
// (scripts/assets/decimate_foliage_bark.mjs); the great trees, the Thornhollow
// dressing and the oakTree prop keep the full-detail originals.
export const FIELD_BARK_DECIMATED: Readonly<Record<FieldBarkSpecies, readonly number[]>> = {
  pine: [1, 2, 4],
  oak: [1, 2, 4, 5],
  twisted: [1, 2, 3],
};

export const treeUrl = (species: FieldBarkSpecies, i: number): string =>
  `${FOLIAGE_MODEL_DIR}${species}_${i}${FIELD_BARK_DECIMATED[species].includes(i) ? '_field' : ''}.glb`;
