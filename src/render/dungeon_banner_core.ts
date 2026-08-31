// Pure kit-banner picking for the dungeon interior builder: whether a
// variant hangs the kit's cloth at all, and which banner a wall slot gets.
// Extracted from dungeon.ts (monolith ratchet); dungeon.ts is the thin
// consumer. Deterministic and Three-free so it unit-tests headless.
import type { DungeonInteriorVariant } from './dungeon';

export type WeightedKinds = [name: string, weight: number][];

export function pickKind(kinds: WeightedKinds, t: number): string {
  let total = 0;
  for (const [, w] of kinds) total += w;
  let acc = 0;
  for (const [name, w] of kinds) {
    acc += w;
    if (t * total < acc) return name;
  }
  return kinds[kinds.length - 1][0];
}

/** Ignivar hangs no kit cloth: the forge dressing pass owns its wall decor
 *  (gear walls, chains), and the pale hangings read as bedsheets under the
 *  forge grade (same suppression as the walk-in keeps' authored passes). */
export function hangsKitBanners(variant: DungeonInteriorVariant): boolean {
  return variant !== 'ignivar';
}

/** Kit banner kind for a wall slot. `isDelve` is passed in by the caller
 *  (the delve classification lives with the variant union in dungeon.ts). */
export function dungeonBannerKind(
  variant: DungeonInteriorVariant,
  t: number,
  isDelve: boolean,
): string {
  if (variant === 'arena_drowned') return dungeonBannerKind('temple', t, false);
  if (variant === 'bastion') {
    return pickKind(
      [
        ['banner_shield_blue', 4],
        ['banner_blue', 3],
        ['banner_triple_blue', 3],
      ],
      t,
    );
  }
  if (variant === 'sanctum') {
    return pickKind(
      [
        ['banner_green', 4],
        ['banner_patternC_green', 3],
        ['banner_triple_green', 3],
      ],
      t,
    );
  }
  if (variant === 'temple') {
    // pale temple hangings, the odd faded-blue choir banner
    return pickKind(
      [
        ['banner_white', 5],
        ['banner_thin_white', 4],
        ['banner_blue', 2],
      ],
      t,
    );
  }
  if (isDelve) {
    // tattered funereal hangings, mostly thin and faded
    return pickKind(
      [
        ['banner_thin_white', 7],
        ['banner_white', 3],
      ],
      t,
    );
  }
  return pickKind(
    [
      ['banner_thin_white', 6],
      ['banner_white', 4],
    ],
    t,
  );
}
