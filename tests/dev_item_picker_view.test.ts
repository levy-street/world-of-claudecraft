import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  DEV_ITEM_PICKER_LIMIT,
  type DevItemCandidate,
  rankDevItems,
  resolveDevItem,
} from '../src/ui/dev_item_picker_view';

// The picker this core backs replaced a native <select> holding every ITEMS entry,
// which rendered taller than the viewport and covered its own window. The two
// properties that make the replacement usable are: it shows NOTHING until you type,
// and it never returns more than a screenful.

const SAMPLE: readonly DevItemCandidate[] = [
  { id: 'ashstalker_cowl', name: 'Ashstalker Cowl', slot: 'helmet', quality: 'rare' },
  { id: 'ashstalker_grips', name: 'Ashstalker Grips', slot: 'gloves', quality: 'rare' },
  { id: 'boundstone_helm', name: 'Boundstone Helm', slot: 'helmet', quality: 'epic' },
  {
    id: 'heroic_boundstone_helm',
    name: 'Boundstone Helm',
    slot: 'helmet',
    quality: 'epic',
    heroic: true,
  },
  { id: 'ashwood_axe', name: 'Ashwood Axe', slot: 'mainhand', quality: 'common' },
  { id: 'gnarled_staff', name: 'Bogoak Staff', slot: 'mainhand', quality: 'uncommon' },
];

describe('dev item picker ranking', () => {
  it('shows nothing at all until the tester types', () => {
    // The whole bug: an unfiltered list of every item. Empty query must mean empty
    // list, not "everything".
    const result = rankDevItems(SAMPLE, '');
    expect(result.idle).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('treats a whitespace-only query as idle', () => {
    expect(rankDevItems(SAMPLE, '   ').idle).toBe(true);
  });

  it('matches on the localized name', () => {
    const ids = rankDevItems(SAMPLE, 'ashstalker').matches.map((m) => m.item.id);
    expect(ids).toEqual(['ashstalker_cowl', 'ashstalker_grips']);
  });

  it('matches on the raw id even when the name shares no text with it', () => {
    // gnarled_staff displays as "Bogoak Staff". A tester who knows the content id
    // must still find it, which a name-only filter would make impossible.
    const ids = rankDevItems(SAMPLE, 'gnarled').matches.map((m) => m.item.id);
    expect(ids).toEqual(['gnarled_staff']);
  });

  it('is case insensitive on both name and id', () => {
    expect(rankDevItems(SAMPLE, 'ASHSTALKER').matches).toHaveLength(2);
    expect(rankDevItems(SAMPLE, 'GNARLED').matches).toHaveLength(1);
  });

  it('ranks an exact id hit first, above closer-looking name matches', () => {
    // Pasting a known id must land it at the top rather than buried under fuzzy hits.
    const result = rankDevItems(SAMPLE, 'heroic_boundstone_helm');
    expect(result.matches[0].item.id).toBe('heroic_boundstone_helm');
    expect(result.matches[0].reason).toBe('exactId');
  });

  it('ranks name prefixes above mere substring hits', () => {
    const result = rankDevItems(SAMPLE, 'stalker');
    // Neither name starts with "stalker", so both are substring hits, not prefixes.
    expect(result.matches.every((m) => m.reason !== 'namePrefix')).toBe(true);

    const prefixed = rankDevItems(SAMPLE, 'ash');
    expect(prefixed.matches[0].reason).toBe('namePrefix');
  });

  it('returns BOTH members of a duplicate-name pair, distinguished by the heroic flag', () => {
    // 57 display names in the real table are shared by a base item and its generated
    // heroic variant. Collapsing them, or returning only one, would make the heroic
    // piece unreachable through search.
    const result = rankDevItems(SAMPLE, 'Boundstone Helm');
    expect(result.matches).toHaveLength(2);
    const heroicFlags = result.matches.map((m) => m.item.heroic === true);
    expect(heroicFlags).toContain(true);
    expect(heroicFlags).toContain(false);
  });

  it('orders a duplicate-name pair deterministically by id', () => {
    // Same name means the name comparator ties; without the id tie-break the two rows
    // could swap between renders while the tester is aiming at one of them.
    const first = rankDevItems(SAMPLE, 'Boundstone Helm').matches.map((m) => m.item.id);
    const second = rankDevItems(SAMPLE, 'Boundstone Helm').matches.map((m) => m.item.id);
    expect(first).toEqual(second);
    expect(first).toEqual(['boundstone_helm', 'heroic_boundstone_helm']);
  });

  it('caps the visible rows but reports the true total', () => {
    const many: DevItemCandidate[] = Array.from({ length: 40 }, (_, i) => ({
      id: `thing_${String(i).padStart(2, '0')}`,
      name: `Thing ${i}`,
    }));
    const result = rankDevItems(many, 'thing', 5);
    expect(result.matches).toHaveLength(5);
    // The count must be the pre-cap total, otherwise "showing 5 of 5" would lie and a
    // tester would stop typing believing they had seen everything.
    expect(result.total).toBe(40);
  });

  it('defaults to a cap small enough that the list cannot swallow the window', () => {
    expect(DEV_ITEM_PICKER_LIMIT).toBeLessThanOrEqual(20);
    const many: DevItemCandidate[] = Array.from({ length: 200 }, (_, i) => ({
      id: `thing_${i}`,
      name: `Thing ${i}`,
    }));
    expect(rankDevItems(many, 'thing').matches.length).toBe(DEV_ITEM_PICKER_LIMIT);
  });

  it('returns an empty list, not everything, when nothing matches', () => {
    const result = rankDevItems(SAMPLE, 'zzzznotathing');
    expect(result.matches).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.idle).toBe(false);
  });
});

describe('dev item resolution', () => {
  it('resolves an exact id', () => {
    expect(resolveDevItem(SAMPLE, 'ashwood_axe')?.name).toBe('Ashwood Axe');
  });

  it('tolerates surrounding whitespace and case', () => {
    expect(resolveDevItem(SAMPLE, '  ASHWOOD_AXE ')?.id).toBe('ashwood_axe');
  });

  it('refuses a display name: the command field takes ids, not names', () => {
    // A half-typed name must resolve to null so the status line can say so, instead
    // of the tester firing a command the server will silently drop.
    expect(resolveDevItem(SAMPLE, 'Ashwood Axe')).toBeNull();
  });

  it('returns null for empty or unknown values', () => {
    expect(resolveDevItem(SAMPLE, '')).toBeNull();
    expect(resolveDevItem(SAMPLE, 'not_a_real_item')).toBeNull();
  });
});

// Guard against the real content table drifting away from what the picker assumes.
describe('dev item picker against the real ITEMS table', () => {
  const candidates: DevItemCandidate[] = Object.values(ITEMS).map((item) => ({
    id: item.id,
    name: item.name,
    slot: item.slot,
    quality: item.quality,
    heroic: item.heroicOf !== undefined,
  }));

  it('every duplicate display name is distinguishable by the heroic flag', () => {
    // This is what the row's Heroic tag relies on. If a future content change
    // introduced two items sharing a name that are NOT a base/heroic pair, the tag
    // would stop disambiguating and the rows would be genuinely identical.
    const byName = new Map<string, DevItemCandidate[]>();
    for (const c of candidates) {
      const list = byName.get(c.name) ?? [];
      list.push(c);
      byName.set(c.name, list);
    }
    const ambiguous = [...byName.entries()]
      .filter(([, list]) => list.length > 1)
      .filter(([, list]) => new Set(list.map((c) => c.heroic === true)).size !== list.length);
    expect(ambiguous.map(([name]) => name)).toEqual([]);
  });

  it('finds a known item by name and by id', () => {
    const byId = rankDevItems(candidates, 'mistcallers_duffel');
    expect(byId.matches[0]?.item.id).toBe('mistcallers_duffel');
    expect(byId.matches[0]?.reason).toBe('exactId');
  });

  it('never floods the caller no matter how broad the query', () => {
    // "e" appears in most item names; the old <select> showed all 672 regardless.
    const broad = rankDevItems(candidates, 'e');
    expect(broad.matches.length).toBeLessThanOrEqual(DEV_ITEM_PICKER_LIMIT);
    expect(broad.total).toBeGreaterThan(DEV_ITEM_PICKER_LIMIT);
  });
});
