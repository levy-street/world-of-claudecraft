// Direct unit coverage for the sim-side party row aura summary
// (src/sim/party_frame_info.ts): relevance filter, the chronomancy priority
// sort ahead of the cap (debuffs, then the echo mark, then other relevant
// auras), stable within-tier order, and the summary shape (neg flag, ceiled
// remaining). Both hosts (offline sim and server wire) consume this module.

import { describe, expect, it } from 'vitest';
import {
  partyFrameAuras,
  partyFrameAurasForViewer,
  preparePartyFrameAuras,
} from '../src/sim/party_frame_info';
import type { Aura } from '../src/sim/types';
import { PARTY_MEMBER_AURA_CAP } from '../src/sim/types';

function aura(partial: Partial<Aura> & Pick<Aura, 'id' | 'kind'>): Aura {
  return {
    name: partial.id,
    remaining: 10,
    duration: 10,
    value: 1,
    sourceId: 1,
    school: 'holy',
    ...partial,
  } as Aura;
}

describe('partyFrameAuras', () => {
  it('drops maintenance buffs entirely instead of demoting them', () => {
    const rows = partyFrameAuras([
      aura({ id: 'arcane_intellect', kind: 'buff_int_pct', value: 5 }),
      aura({ id: 'renew', kind: 'hot', value: 20 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['renew']);
  });

  it('keeps debuffs and the echo mark ahead of other relevant auras at the cap', () => {
    const hots = Array.from({ length: PARTY_MEMBER_AURA_CAP }, (_, i) =>
      aura({ id: `hot_${i}`, kind: 'hot', value: 20 }),
    );
    const rows = partyFrameAuras([
      ...hots,
      aura({ id: 'rend', kind: 'dot', value: 5, school: 'physical' }),
      aura({ id: 'temporal_echo', kind: 'temporal_echo', value: 0, school: 'arcane' }),
    ]);
    expect(rows).toHaveLength(PARTY_MEMBER_AURA_CAP);
    // Tier 0 debuff, tier 1 echo, then the tier 2 HoTs in their original
    // (stable) order; the last two HoTs are evicted by the cap.
    expect(rows.map((r) => r.id)).toEqual([
      'rend',
      'temporal_echo',
      'hot_0',
      'hot_1',
      'hot_2',
      'hot_3',
      'hot_4',
      'hot_5',
    ]);
  });

  it('marks negative-value auras and ceils the remaining seconds', () => {
    const rows = partyFrameAuras([
      aura({ id: 'wither', kind: 'buff_ap', value: -12, remaining: 11.2 }),
    ]);
    expect(rows).toEqual([{ id: 'wither', kind: 'buff_ap', neg: 1, remaining: 12 }]);
  });

  it('does not mutate the input array', () => {
    const input = [
      aura({ id: 'renew', kind: 'hot', value: 20 }),
      aura({ id: 'rend', kind: 'dot', value: 5 }),
    ];
    const before = input.map((a) => a.id);
    partyFrameAuras(input);
    expect(input.map((a) => a.id)).toEqual(before);
  });

  it('returns no summaries when the caller sets a zero cap', () => {
    const prepared = preparePartyFrameAuras([aura({ id: 'renew', kind: 'hot', value: 20 })]);
    expect(partyFrameAurasForViewer(prepared, 1, 0)).toEqual([]);
  });
});
