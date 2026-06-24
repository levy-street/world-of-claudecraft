// Pure logic for the pack-rip reveal sequence and the collection grid. Zero DOM
// so it is unit-testable; the HUD reveal animation and collection window are thin
// consumers. Rarity order is a presentation concern owned here (the client cannot
// import the server pack module), kept in sync with ItemDef['quality'].

export type Rarity = 'poor' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

const RANK: Readonly<Record<Rarity, number>> = {
  poor: 0,
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
};

export interface RevealItem {
  rarity: Rarity;
}

/**
 * Order a rip's rewards lowest rarity first so the reveal builds to the best
 * pull. Stable for equal rarities (preserves the rolled order), and never mutates
 * the input.
 */
export function revealOrder<T extends RevealItem>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => RANK[a.item.rarity] - RANK[b.item.rarity] || a.i - b.i)
    .map((x) => x.item);
}

/** The rarity of the best item in a rip (for the rip's headline flourish). */
export function topRarity(items: readonly RevealItem[]): Rarity | null {
  let best: Rarity | null = null;
  for (const it of items) if (best === null || RANK[it.rarity] > RANK[best]) best = it.rarity;
  return best;
}

export interface CollectionItem {
  ref: string;
  rarity: Rarity;
}

export interface CollectionEntry {
  ref: string;
  rarity: Rarity;
  count: number;
}

/**
 * Aggregate owned pulls into a collection grid: one entry per ref with its count,
 * sorted best-rarity first then by ref for a stable layout. Duplicates increment
 * the count (the surplus is what a dust/craft economy would consume).
 */
export function aggregateCollection(items: readonly CollectionItem[]): CollectionEntry[] {
  const byRef = new Map<string, CollectionEntry>();
  for (const it of items) {
    const existing = byRef.get(it.ref);
    if (existing) existing.count += 1;
    else byRef.set(it.ref, { ref: it.ref, rarity: it.rarity, count: 1 });
  }
  return [...byRef.values()].sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || a.ref.localeCompare(b.ref));
}
