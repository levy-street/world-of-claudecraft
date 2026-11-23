import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import { DELVE_LIST } from '../src/sim/data';
import { adventureCategory, filterAdventureRows } from '../src/ui/dungeon_catalogue_view';
import { buildDungeonFinderView, type DungeonFinderViewInput } from '../src/ui/dungeon_finder_view';

const input: DungeonFinderViewInput = {
  info: {
    roles: ['tank'],
    eligibleRoles: ['tank'],
    queue: null,
    cooldown: 0,
    proposal: null,
    myListing: null,
    myApplication: null,
  },
  board: [],
  playerLevel: 20,
  playerClass: 'warrior',
  playerId: 1,
  specRole: 'tank',
  party: null,
  partyLeaderName: null,
  lockouts: [],
  tab: 'catalogue',
  selectedActivityId: null,
  stagedActivityIds: [],
  includeDelves: true,
};
function view(overrides: Partial<DungeonFinderViewInput> = {}) {
  const result = buildDungeonFinderView({ ...input, ...overrides });
  if (result.kind !== 'live') throw new Error('expected live guide');
  return result;
}

describe('adventure catalogue', () => {
  it('lists every real finder activity and every genuine delve exactly once', () => {
    const rows = view().rows;
    expect(rows.map((r) => r.id)).toEqual([
      ...FINDER_ACTIVITIES.map((a) => a.id),
      ...DELVE_LIST.map((d) => `delve:${d.id}`),
    ]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const row of rows.filter((r) => r.kind === 'solo'))
      expect(adventureCategory(row.kind)).toBe('dungeons');
  });
  it('provides authored delve bosses and map entrances without synthetic queue or listing options', () => {
    for (const delve of DELVE_LIST) {
      const guide = view({ selectedActivityId: `delve:${delve.id}` });
      expect(guide.detail).toMatchObject({
        kind: 'delve',
        dungeonId: delve.id,
        autoQueue: false,
        minLevel: delve.minLevel,
        size: delve.maxPlayers,
        entrance: delve.doorPos,
      });
      expect(guide.detail?.encounters.map((e) => e.mobId)).toEqual(delve.bosses);
      expect(guide.queue.options.some((o) => o.id.startsWith('delve:'))).toBe(false);
      expect(guide.board.createOptions.some((o) => o.id.startsWith('delve:'))).toBe(false);
    }
  });
  it('filters categories, localized multiword names and eligibility independently of wire IDs', () => {
    const rows = view({ playerLevel: 1, specRole: null }).rows;
    const labels = new Map(
      rows.map((r) => [r.id, r.kind === 'delve' ? 'Reliquaire des Brumes' : 'Citadelle ancienne']),
    );
    expect(filterAdventureRows(rows, 'delves', ' BRUMES reliquaire ', false, labels).length).toBe(
      DELVE_LIST.length,
    );
    expect(filterAdventureRows(rows, 'delves', 'delve:', false, labels)).toEqual([]);
    expect(filterAdventureRows(rows, 'delves', '', true, labels)).toEqual([]);
    expect(
      filterAdventureRows(rows, 'raids', '', false, labels).every((r) => r.kind === 'raid'),
    ).toBe(true);
    expect(filterAdventureRows(rows, 'dungeons', '', false, labels).map((r) => r.id)).toEqual(
      FINDER_ACTIVITIES.filter((a) => a.kind !== 'raid').map((a) => a.id),
    );
  });
  it('allows in-level adventures and class roles without a committed specialization', () => {
    const guide = view({ specRole: null });
    expect(guide.rows.filter((r) => r.kind === 'delve').every((r) => r.eligible)).toBe(true);
    expect(guide.rows.find((row) => row.id === 'hollow_crypt_heroic')?.eligible).toBe(true);
    expect(guide.queue.roles.filter((role) => role.eligible).map((role) => role.role)).toEqual([
      'tank',
      'dps',
    ]);
  });
});
