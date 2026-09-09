// What a composed part's NODE NAME decides, in one place.
//
// Most of a composed body is decided by material (`mod_skin`, `mod_hair`, an
// armour atlas). Four things are not: they are read off the node name, because
// the material cannot tell them apart.
//   - the HEAD, whose geometry is the identity the stubble and makeup decal
//     cuts are cached on (and the canonical bind space of the shared skeleton);
//   - the MOUTH, whose lip body rides `mod_skin` like the face but takes
//     lipstick rather than the skin tone;
//   - the JEWELLERY (`E2_`), which rides the knight atlas and so is only an
//     earring by its node name;
//   - the hair BAND, the `E2_` subset that answers to the band material rather
//     than to the earring slot.
//
// That makes the name a MERGE boundary: `mergeSkinnedParts` gives the merged
// mesh one name of its own, so folding two parts that these facts read
// differently would silently change what the recolour sweep does to them (a
// merged ear-and-lips mesh gets lipstick, or the lips get the skin tone). The
// partition below is what keeps the merge out of that, and it is derived from
// the same predicates the recolour sweep reads, so the two cannot drift.
//
// Three-free: naming is data, and the merge's guard should be decidable in a
// plain Vitest.

/** The composed head's node name, per gender. Pinned against `headNodeName`
 *  (stubble.ts) by `tests/modular_name_facts.test.ts`: that module owns the
 *  live lookup, this one has to stay three-free. */
export const MODULAR_HEAD_NODES: readonly string[] = ['M_Head', 'F_Head'];

export interface ModularNameFacts {
  head: boolean;
  mouth: boolean;
  jewel: boolean;
  band: boolean;
}

/** The node-name facts of one composed mesh. GLTFLoader suffixes the meshes of
 *  a multi-primitive part (`M_Mouth_neutral_0`), so every test here matches a
 *  stem rather than the whole name. */
export function modularNameFacts(name: string): ModularNameFacts {
  const jewel = name.startsWith('E2_');
  return {
    head: MODULAR_HEAD_NODES.includes(name),
    mouth: name.includes('_Mouth_'),
    jewel,
    band: name.startsWith('E2_band_'),
  };
}

/**
 * The merge partition of a composed mesh: two meshes may only merge when this
 * agrees, whatever else they share.
 *
 * `head` is its own partition and so never merges at all, which is the point:
 * the head is the one buffer a rebake and a merge must both leave alone.
 */
export function modularMergePartition(name: string): string {
  const facts = modularNameFacts(name);
  if (facts.head) return 'head';
  if (facts.mouth) return 'mouth';
  if (facts.band) return 'band';
  if (facts.jewel) return 'jewel';
  return 'part';
}
