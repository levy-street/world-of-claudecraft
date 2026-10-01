// The tracked-item history model (src/ui/item_history_view.ts): origin
// wording keyed by the record's source, one line per later hand, the
// never-changed-hands note, the rolled-off count, and never the item ID.
import { describe, expect, it } from 'vitest';
import type { ItemProvenance } from '../src/sim/types';
import { itemHistoryModel, provenanceOriginKey } from '../src/ui/item_history_view';

const AT = Date.UTC(2026, 8, 30, 12, 0, 0);
const LATER = Date.UTC(2026, 9, 1, 12, 0, 0);

function origin(extra: Partial<ItemProvenance> = {}): ItemProvenance {
  return { at: AT, by: 'Alice', byId: 101, source: 'mob:forest_wolf', ...extra };
}

describe('provenanceOriginKey', () => {
  it('keys a kill, a quest reward, and everything else', () => {
    expect(provenanceOriginKey('mob:forest_wolf')).toBe('hudChrome.itemTooltip.lootedBy');
    expect(provenanceOriginKey('quest:q_wolves')).toBe('hudChrome.itemTooltip.questRewardTo');
    expect(provenanceOriginKey('vendor')).toBe('hudChrome.itemTooltip.obtainedBy');
    expect(provenanceOriginKey('craft:recipe_x')).toBe('hudChrome.itemTooltip.obtainedBy');
    expect(provenanceOriginKey('legacy')).toBe('hudChrome.itemTooltip.obtainedBy');
  });
});

describe('itemHistoryModel', () => {
  it('renders the origin and the never-changed-hands note for a fresh copy', () => {
    const model = itemHistoryModel(origin());
    expect(model.origin.startsWith('Looted by Alice on ')).toBe(true);
    expect(model.origin).toContain('2026');
    expect(model.hands).toEqual([]);
    expect(model.noTransfers).toBe('This item has never changed hands.');
    expect(model.earlierHidden).toBeNull();
  });

  it('lists every later hand in order and drops the note', () => {
    const model = itemHistoryModel(
      origin({
        owners: [
          { at: LATER, by: 'Bob', byId: 202 },
          { at: LATER, by: 'Cara' },
        ],
        transfers: 2,
      }),
    );
    expect(model.hands).toHaveLength(2);
    expect(model.hands[0].startsWith('Passed to Bob on ')).toBe(true);
    expect(model.hands[1].startsWith('Passed to Cara on ')).toBe(true);
    expect(model.noTransfers).toBeNull();
    expect(model.earlierHidden).toBeNull();
  });

  it('names the earlier hands that rolled off the bounded chain', () => {
    const model = itemHistoryModel(origin({ owners: [{ at: LATER, by: 'Zed' }], transfers: 13 }));
    expect(model.earlierHidden).toBe('12 earlier transfers are not shown.');
  });

  it('wording for a quest reward', () => {
    const model = itemHistoryModel(origin({ source: 'quest:q_wolves' }));
    expect(model.origin.startsWith('Quest reward to Alice on ')).toBe(true);
  });

  it('never leaks a guid: the model carries no field for one', () => {
    const model = itemHistoryModel(origin()) as unknown as Record<string, unknown>;
    expect(JSON.stringify(model)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(Object.keys(model).sort()).toEqual(['earlierHidden', 'hands', 'noTransfers', 'origin']);
  });
});
