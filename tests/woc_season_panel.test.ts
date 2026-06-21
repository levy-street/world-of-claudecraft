// Tests the $WOC season panel painter (src/ui/woc_season_panel.ts). It's a pure
// HTML-string builder, so we assert the rendered markup directly — the data
// wiring (pool/sink/emission, the emitted-% bar width), the per-state structure
// (none/active/ended), and that the server-supplied season label is escaped.
import { describe, it, expect } from 'vitest';
import { wocSeasonPanelHtml } from '../src/ui/woc_season_panel';
import type { SeasonView } from '../src/ui/woc_season';

const base: SeasonView = {
  state: 'active', seasonId: 1, label: 'Season 1', poolWoc: '2700', sinkWoc: '4200',
  emissionWoc: '1500', emittedPct: 35.71, countdown: { days: 3, hours: 6, minutes: 30, totalMs: 1 },
  standings: [],
};

describe('wocSeasonPanelHtml', () => {
  it('renders an empty state with no pool figures', () => {
    const html = wocSeasonPanelHtml({ ...base, state: 'none', seasonId: null, label: '', poolWoc: '0', sinkWoc: '0', emissionWoc: '0', emittedPct: 0, countdown: null });
    expect(html).toContain('ws-body-empty');
    expect(html).toContain('No reward season is active'); // hudChrome.wocSeason.none (English)
    expect(html).not.toContain('ws-bar-fill');
  });

  it('renders the pool, totals, status, and the countdown for an active season', () => {
    const html = wocSeasonPanelHtml(base);
    expect(html).toContain('ws-status-active');
    expect(html).toContain('>Season 1<');
    expect(html).toContain('2700 <span class="ws-unit">'); // pool amount + unit
    expect(html).toContain('<b>4200</b>'); // funded (sinks)
    expect(html).toContain('<b>1500</b>'); // paid out (emissions)
    expect(html).toContain('3d 6h 30m'); // countdown value
  });

  it('sets the emitted-% bar width from the view (rounded to 0.1)', () => {
    expect(wocSeasonPanelHtml(base)).toContain('style="width:35.7%"');
    expect(wocSeasonPanelHtml({ ...base, emittedPct: 0 })).toContain('style="width:0%"');
    expect(wocSeasonPanelHtml({ ...base, emittedPct: 100 })).toContain('style="width:100%"');
  });

  it('shows an ended state with no countdown', () => {
    const html = wocSeasonPanelHtml({ ...base, state: 'ended', countdown: null });
    expect(html).toContain('ws-status-ended');
    expect(html).toContain('ws-timing-ended');
    expect(html).not.toContain('ws-timing-value');
  });

  it('shows an open-ended (no end time) active season', () => {
    const html = wocSeasonPanelHtml({ ...base, countdown: null });
    expect(html).toContain('ws-timing-open');
  });

  it('escapes a malicious season label (never raw server text in innerHTML)', () => {
    const html = wocSeasonPanelHtml({ ...base, label: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('omits the standings table when there are no standings', () => {
    expect(wocSeasonPanelHtml(base)).not.toContain('ws-standings');
  });

  it('renders the projected top-earners table with rank/name/rating/reward', () => {
    const html = wocSeasonPanelHtml({ ...base, standings: [
      { rank: 1, name: 'Ada', rating: 1999, rewardWoc: '810' },
      { rank: 2, name: 'Bo', rating: 1888, rewardWoc: '540' },
    ] });
    expect(html).toContain('ws-standings');
    expect(html).toContain('Projected top earners');
    expect(html).toContain('>Ada<');
    expect(html).toContain('>810<');   // rank 1 reward
    expect(html).toContain('>Bo<');
    expect(html).toContain('>540<');
  });

  it('escapes standing player names', () => {
    const html = wocSeasonPanelHtml({ ...base, standings: [{ rank: 1, name: '<b>x</b>', rating: 1500, rewardWoc: '10' }] });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
