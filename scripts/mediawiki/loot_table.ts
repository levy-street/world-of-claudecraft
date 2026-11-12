// Lays a creature's drops out as tables: what always has its own roll first, then one
// table for each shared roll, where at most one of the listed items can drop.

export interface LootRow {
  /** Icon and link (or a coin amount) for the first column. */
  drop: string;
  quality: string;
  /** Base chance, 0 to 1. */
  chance: number;
  notes: string[];
  /** Shared-roll pool id, when the row competes with others for one roll. */
  pool?: string;
  difficulty: 'Any' | 'Normal' | 'Heroic';
}

const percent = (chance: number) => `${Number((100 * chance).toFixed(2))}%`;
const HEADER = '! Drop !! Quality !! Chance !! Notes';

function table(rows: LootRow[], showDifficulty: boolean): string {
  const sorted = [...rows].sort((a, b) => b.chance - a.chance);
  return (
    '{| class="wikitable loot-table"\n|-\n' +
    HEADER +
    '\n' +
    sorted
      .map((r) => {
        const notes = [
          ...(showDifficulty && r.difficulty !== 'Any' ? [r.difficulty + ' only'] : []),
          ...r.notes,
        ];
        return (
          '|-\n| ' +
          [r.drop, r.quality, percent(r.chance), notes.join('. ') + (notes.length ? '.' : '')].join(
            ' || ',
          )
        );
      })
      .join('\n') +
    '\n|}'
  );
}

/** The whole Loot section body: opening notes, then the tables, then closing lines. */
export function lootTables(rows: LootRow[], notes: string[] = [], extra: string[] = []): string {
  const blocks: string[] = [...notes];
  const own = rows.filter((r) => !r.pool);
  if (own.length)
    blocks.push(
      '=== Separate rolls ===\nEach row has its own roll, so you can get several of these from one kill.\n\n' +
        table(own, true),
    );
  const pools = new Map<string, LootRow[]>();
  for (const r of rows.filter((x) => x.pool)) {
    const key = r.difficulty + '|' + r.pool;
    pools.set(key, [...(pools.get(key) ?? []), r]);
  }
  const order = ['Any', 'Normal', 'Heroic'];
  const sortedPools = [...pools.values()].sort(
    (a, b) => order.indexOf(a[0].difficulty) - order.indexOf(b[0].difficulty),
  );
  const count: Record<string, number> = {};
  for (const pool of sortedPools) {
    const difficulty = pool[0].difficulty;
    count[difficulty] = (count[difficulty] ?? 0) + 1;
    const total = pool.reduce((sum, r) => sum + r.chance, 0);
    const name =
      'Shared roll ' + count[difficulty] + (difficulty === 'Any' ? '' : ' (' + difficulty + ')');
    blocks.push(
      '=== ' +
        name +
        ' ===\n' +
        "The game rolls once for this group. At most '''one''' of these " +
        pool.length +
        " items drops. Added together, their chances come to '''" +
        percent(total) +
        "'''.\n\n" +
        table(pool, false),
    );
  }
  if (extra.length) blocks.push(extra.map((line) => '* ' + line).join('\n'));
  return blocks.join('\n\n');
}
