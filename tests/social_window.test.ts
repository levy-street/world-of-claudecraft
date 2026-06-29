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

describe('social_window: WAI-ARIA tabs', () => {
  it('renders the tab strip as a role=tablist with role=tab + aria-selected + roving tabindex', () => {
    expect(painter).toContain('role="tablist"');
    // Exactly four real tabs (friends / guild / ignore / raid), each a role=tab. The
    // closing quote in /role="tab"/ does NOT match role="tablist" / role="tabpanel".
    expect(painter.match(/role="tab"/g)?.length).toBe(4);
    expect(painter).toContain('aria-selected="${tab ===');
    expect(painter).toContain('tabindex="${tab ===');
    expect(painter).toContain('aria-controls="soc-body-panel"');
  });

  it('makes .soc-body the labelled tabpanel (refreshList still queries it by class)', () => {
    expect(painter).toContain('id="soc-body-panel"');
    expect(painter).toContain('role="tabpanel"');
    expect(painter).toContain('class="soc-body"');
  });

  it('drops aria-pressed entirely (a tab is not a toggle button)', () => {
    expect(painter).not.toContain('aria-pressed');
  });

  it('wires the roving Arrow/Home/End handler via the shared roving_index core', () => {
    expect(painter).toContain("from './roving_index'");
    expect(painter).toContain('rovingTarget(');
  });
});

describe('social_window: delegated row listeners (no per-tick churn)', () => {
  it('wires ONE delegated click listener on the body in render(), dispatched by onBodyClick', () => {
    expect(painter).toMatch(/body\.addEventListener\('click'/);
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
