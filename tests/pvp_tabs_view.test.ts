// Pins for the merged PvP window's tab-strip model (src/ui/pvp_tabs_view.ts):
// display order with Thornhollow Fields primary, busy-state derivation from BOTH world
// shapes (offline Sim and ClientWorld mirror), pinning and locking, and the
// dev-only edge where a retired bracket is live.
import { describe, expect, it } from 'vitest';
import { buildPvpTabs, PVP_TABS, type PvpTabsInput } from '../src/ui/pvp_tabs_view';

const idle = (selected: PvpTabsInput['selected'] = 'ravenrift'): PvpTabsInput => ({
  selected,
  bg: { queued: false, match: null },
  arena: { queued: false, format: null, match: null },
});

describe('pvp tabs: order, pinning, locking', () => {
  it('offers exactly Thornhollow Fields, 1v1, 2v2, in that order, Thornhollow Fields primary', () => {
    expect(PVP_TABS).toEqual(['ravenrift', '1v1', '2v2']);
    const m = buildPvpTabs(idle());
    expect(m.tabs.map((tab) => tab.id)).toEqual(['ravenrift', '1v1', '2v2']);
  });

  it('idle: the selection is active, nothing is locked, nothing commits', () => {
    const m = buildPvpTabs(idle('2v2'));
    expect(m.active).toBe('2v2');
    expect(m.commit).toBe(false);
    expect(m.tabs.find((tab) => tab.id === '2v2')?.active).toBe(true);
    expect(m.tabs.every((tab) => !tab.locked)).toBe(true);
  });

  it('offline (both snapshots null) never pins or locks anything', () => {
    const m = buildPvpTabs({ selected: '1v1', bg: null, arena: null });
    expect(m.active).toBe('1v1');
    expect(m.commit).toBe(false);
    expect(m.tabs.every((tab) => !tab.locked)).toBe(true);
  });

  it('a queued battleground pins Thornhollow Fields and locks both arena tabs', () => {
    const m = buildPvpTabs({ ...idle('1v1'), bg: { queued: true, match: null } });
    expect(m.active).toBe('ravenrift');
    expect(m.commit).toBe(true);
    expect(m.tabs.filter((tab) => tab.locked).map((tab) => tab.id)).toEqual(['1v1', '2v2']);
  });

  it('a live battleground match pins Thornhollow Fields too (the match field alone)', () => {
    const m = buildPvpTabs({
      ...idle('2v2'),
      bg: { queued: false, match: {} as never },
    });
    expect(m.active).toBe('ravenrift');
    expect(m.commit).toBe(true);
  });

  it('a queued arena bracket pins its tab and locks the others, Thornhollow Fields included', () => {
    const m = buildPvpTabs({
      ...idle('ravenrift'),
      arena: { queued: true, format: '2v2', match: null },
    });
    expect(m.active).toBe('2v2');
    expect(m.commit).toBe(true);
    expect(m.tabs.filter((tab) => tab.locked).map((tab) => tab.id)).toEqual(['ravenrift', '1v1']);
  });

  it('a live arena match pins by the MATCH format, not the stale queued format', () => {
    const m = buildPvpTabs({
      ...idle('ravenrift'),
      arena: { queued: false, format: '2v2', match: { format: '1v1' } as never },
    });
    expect(m.active).toBe('1v1');
    expect(m.commit).toBe(true);
  });

  it('the battleground wins the (sim-impossible) double-busy tie', () => {
    const m = buildPvpTabs({
      selected: '1v1',
      bg: { queued: true, match: null },
      arena: { queued: true, format: '2v2', match: null },
    });
    expect(m.active).toBe('ravenrift');
  });

  it('a live retired bracket (dev Fiesta/Yumi) pins nothing but still locks the rest', () => {
    const m = buildPvpTabs({
      ...idle('1v1'),
      arena: { queued: false, format: null, match: { format: 'fiesta' } as never },
    });
    expect(m.active).toBe('1v1');
    expect(m.commit).toBe(false);
    expect(m.tabs.filter((tab) => tab.locked).map((tab) => tab.id)).toEqual(['ravenrift', '2v2']);
  });

  it('produces identical strips from a Sim-shaped and a mirror-shaped snapshot', () => {
    // The offline Sim exposes rich objects; the ClientWorld mirror rebuilds
    // them from wire fields. The core reads only queued/format/match, so both
    // shapes must resolve identically.
    const simShaped: PvpTabsInput = {
      selected: 'ravenrift',
      bg: { queued: false, match: null },
      arena: {
        queued: true,
        format: '1v1',
        match: null,
      },
    };
    const mirrorShaped: PvpTabsInput = {
      selected: 'ravenrift',
      bg: { queued: false, match: null },
      arena: JSON.parse(JSON.stringify(simShaped.arena)),
    };
    expect(buildPvpTabs(simShaped)).toEqual(buildPvpTabs(mirrorShaped));
    expect(buildPvpTabs(simShaped).active).toBe('1v1');
  });
});
