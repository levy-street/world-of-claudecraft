import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the social painter. The pure row + signature decisions are
// unit-tested in social_view.test.ts; here we pin the no-magic-values
// contract (no raw hex, no bare cadence literal) and the load-bearing listener
// delegation: social repaints on the slow-HUD divider, so a content refresh must NOT
// re-attach per-row handlers (one delegated listener on the persistent body does it).
const painter = readFileSync(new URL('../src/ui/social_window.ts', import.meta.url), 'utf8');

describe('social_window: no magic values', () => {
  it('carries no literal hex color in TS (status dots are CSS-classed)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens/CSS: ${hex.join(', ')}`).toEqual([]);
  });

  it('contains no bare 500 cadence literal (the slow-HUD divider lives in hud.ts)', () => {
    expect(painter).not.toMatch(/\b500\b/);
  });

  it('names the typeahead timing constants instead of bare literals', () => {
    expect(painter).toContain('SUGGEST_DEBOUNCE_MS');
    expect(painter).toContain('SUGGEST_BLUR_CLEAR_MS');
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('social_window: frame tab rail (friends/guild/ignore/raid)', () => {
  it('adopts the shared window frame with the four modes on the tab rail', () => {
    // The role=tablist / role=tab / role=tabpanel markup now comes from the shared
    // window-frame builder (window_frame.ts, unit-tested in window_frame_view.test.ts);
    // this pins the descriptor + the close/tab-change wiring the painter supplies.
    expect(painter).toContain('renderWindowFrame(');
    expect(painter).toContain('SOCIAL_FRAME');
    expect(painter).toContain("id: 'friends'");
    expect(painter).toContain("id: 'guild'");
    expect(painter).toContain("id: 'ignore'");
    expect(painter).toContain("id: 'raid'");
    expect(painter).toContain('onClose: () => this.close()');
    expect(painter).toContain('onTabChange: (id) => this.onTabChange(id)');
  });

  it('wires roving Arrow/Home/End across the frame tab rail via the shared core', () => {
    expect(painter).toContain("from './roving_index'");
    expect(painter).toContain('rovingTarget(');
    expect(painter).toContain('private wireTabRoving(');
  });

  it('syncs the tab rail aria-selected + roving tabindex to the active tab', () => {
    expect(painter).toContain('private syncTabState(');
    expect(painter).toContain("b.setAttribute('aria-selected'");
    expect(painter).toContain('b.tabIndex = sel ? 0 : -1');
  });

  it('drops aria-pressed entirely (a tab is not a toggle button)', () => {
    expect(painter).not.toContain('aria-pressed');
  });

  it('keeps .soc-body as the delegated-click container (refreshList queries it by class)', () => {
    expect(painter).toContain('class="soc-body"');
  });
});

describe('social_window: delegated row listeners (no per-tick churn)', () => {
  it('wires ONE delegated click listener on the body in render(), dispatched by onBodyClick', () => {
    expect(painter).toMatch(/socBody\.addEventListener\('click'/);
    expect(painter).toContain('private onBodyClick(');
  });

  it('the content refresh only swaps innerHTML and re-attaches no row handlers', () => {
    // Isolate refreshList(): it must not addEventListener (the delegated body listener
    // from render() keeps working across the innerHTML swap, so a cadence tick that
    // only refreshes the list never churns per-row handlers).
    const start = painter.indexOf('private refreshList(): void {');
    expect(start).toBeGreaterThan(-1);
    const next = painter.indexOf('private onBodyClick(', start);
    expect(next).toBeGreaterThan(start);
    const body = painter.slice(start, next);
    expect(body).toContain('body.innerHTML');
    expect(body).not.toContain('addEventListener');
  });
});
