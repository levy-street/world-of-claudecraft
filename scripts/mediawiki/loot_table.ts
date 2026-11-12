// Lays drops out as tables. A creature page lists what has its own roll first, then one
// table for each shared roll, where at most one of the listed items can drop. A dungeon
// creature gets a Normal view and a Heroic view, which the reader shows as two tabs.

export interface LootRow {
  /** Icon and link (or a coin amount) for the first column. */
  drop: string;
  /** What the same roll gives on Heroic, when that differs. */
  heroicDrop?: string;
  quality: string;
  /** Base chance, 0 to 1. */
  chance: number;
  notes: string[];
  /** Shared-roll pool id, when the row competes with others for one roll. */
  pool?: string;
  difficulty: 'Any' | 'Normal' | 'Heroic';
}

/** One creature that drops an item, for the table on the item's own page. */
export interface DropSource {
  creature: string;
  /** "Open world", "Normal and Heroic", "Normal only" or "Heroic only". */
  where: string;
  chance: number;
  notes: string[];
}

export const NORMAL_TAB = 'Normal loot';
export const HEROIC_TAB = 'Heroic loot';

const percent = (chance: number) => `${Number((100 * chance).toFixed(2))}%`;
const sentence = (notes: string[]) => (notes.length ? notes.join('. ') + '.' : '');
const wikitable = (header: string, rows: string[][]) =>
  '{| class="wikitable loot-table"\n|-\n' +
  header +
  '\n' +
  rows.map((cells) => '|-\n| ' + cells.join(' || ')).join('\n') +
  '\n|}';

function table(rows: LootRow[], heroic: boolean): string {
  return wikitable(
    '! Drop !! Quality !! Chance !! Notes',
    [...rows]
      .sort((a, b) => b.chance - a.chance)
      .map((r) => [
        heroic ? (r.heroicDrop ?? r.drop) : r.drop,
        r.quality,
        percent(r.chance),
        sentence(r.notes),
      ]),
  );
}

// One difficulty's drops: separate rolls, then each shared roll with its combined chance.
function view(rows: LootRow[], heroic: boolean): string {
  const blocks: string[] = [];
  const own = rows.filter((r) => !r.pool);
  if (own.length)
    blocks.push(
      "'''Separate rolls'''\n\nEach row has its own roll, so you can get several of these from one kill.\n\n" +
        table(own, heroic),
    );
  const pools = new Map<string, LootRow[]>();
  for (const r of rows.filter((x) => x.pool))
    pools.set(r.pool!, [...(pools.get(r.pool!) ?? []), r]);
  let n = 0;
  for (const pool of pools.values()) {
    const total = pool.reduce((sum, r) => sum + r.chance, 0);
    blocks.push(
      "'''Shared roll " +
        ++n +
        "'''\n\nThe game rolls once for this group. At most '''one''' of these " +
        pool.length +
        " items drops. Added together, their chances come to '''" +
        percent(total) +
        "'''.\n\n" +
        table(pool, heroic),
    );
  }
  return blocks.join('\n\n');
}

/** The whole Loot section body: opening notes, then the tables, then closing lines. */
export function lootTables(rows: LootRow[], notes: string[] = [], extra: string[] = []): string {
  const split = rows.some((r) => r.difficulty !== 'Any' || r.heroicDrop);
  const blocks = [...notes];
  if (split) {
    const normal = rows.filter((r) => r.difficulty !== 'Heroic');
    const heroic = rows.filter((r) => r.difficulty !== 'Normal');
    if (normal.length) blocks.push('=== ' + NORMAL_TAB + ' ===\n' + view(normal, false));
    if (heroic.length) blocks.push('=== ' + HEROIC_TAB + ' ===\n' + view(heroic, true));
  } else if (rows.length) blocks.push(view(rows, false));
  if (extra.length) blocks.push(extra.map((line) => '* ' + line).join('\n'));
  return blocks.join('\n\n');
}

/** The "Dropped by" table on an item page, most likely source first. */
export function dropSourceTable(sources: DropSource[]): string {
  return wikitable(
    '! Dropped by !! Where !! Chance !! Notes',
    [...sources]
      .sort((a, b) => b.chance - a.chance)
      .map((s) => [s.creature, s.where, percent(s.chance), sentence(s.notes)]),
  );
}
