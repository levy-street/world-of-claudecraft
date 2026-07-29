// The zone-map gather tooltip memo (map_gather_tip_memo.ts): the hover
// resolve elision behind hud.gatherNodeMapTooltipHtml. Decisive on the three
// behaviors the HUD leans on: hit reuses the entry without re-resolving,
// a node change re-resolves (never a stale neighbour's html), and an empty
// resolve is cached so the quest-area fall-through stays cheap.

import { describe, expect, it } from 'vitest';
import { resolveGatherTipMemo } from '../src/ui/map_gather_tip_memo';

describe('map gather tip memo (the map hover resolve elision)', () => {
  it('resolves once per node id and returns the SAME entry on a hit', () => {
    let calls = 0;
    const resolve = (id: string) => {
      calls += 1;
      return `<b>${id}</b>`;
    };
    const first = resolveGatherTipMemo(null, 'ore_1', resolve);
    expect(first).toEqual({ nodeId: 'ore_1', html: '<b>ore_1</b>' });
    expect(calls).toBe(1);
    const hit = resolveGatherTipMemo(first, 'ore_1', resolve);
    expect(hit).toBe(first);
    expect(calls).toBe(1);
  });

  it('re-resolves on a node change and never hands back a stale neighbour', () => {
    let calls = 0;
    const resolve = (id: string) => {
      calls += 1;
      return `tip:${id}`;
    };
    const ore = resolveGatherTipMemo(null, 'ore_1', resolve);
    const herb = resolveGatherTipMemo(ore, 'herb_1', resolve);
    expect(herb).toEqual({ nodeId: 'herb_1', html: 'tip:herb_1' });
    expect(calls).toBe(2);
    // Back again: the memo is one entry deep by design, so this re-resolves.
    const oreAgain = resolveGatherTipMemo(herb, 'ore_1', resolve);
    expect(oreAgain).toEqual({ nodeId: 'ore_1', html: 'tip:ore_1' });
    expect(calls).toBe(3);
  });

  it('caches an empty resolve (a content-less id stays cheap)', () => {
    let calls = 0;
    const resolve = () => {
      calls += 1;
      return '';
    };
    const miss = resolveGatherTipMemo(null, 'gone', resolve);
    expect(miss).toEqual({ nodeId: 'gone', html: '' });
    const again = resolveGatherTipMemo(miss, 'gone', resolve);
    expect(again).toBe(miss);
    expect(calls).toBe(1);
  });
});
