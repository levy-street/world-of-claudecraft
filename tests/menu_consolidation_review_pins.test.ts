// Source pins for the menu consolidation review round: wiring that lives in the
// Hud coordinator and the stylesheet, where no behavior test can reach without
// constructing a Hud. The behavior each one guards is pinned beside its module
// (tests/window_hub_prepare.test.ts, tests/char_window.test.ts,
// tests/root_state_classes_behavior.test.ts, tests/leaderboard_window_stale.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync('src/ui/hud.ts', 'utf8');
const css = readFileSync('src/styles/components.css', 'utf8');

describe('menu consolidation review pins', () => {
  it('routes every Professions hub member open through the hub, like the other hubs', () => {
    for (const tab of ['overview', 'harvest', 'perfecting'])
      expect(hud).toContain(`closeOthers: () => this.professionsHub.prepare('${tab}'),`);
    expect(hud).toContain("this.professionsHub.prepare('crafting');");
    for (const id of ['professions', 'harvest-journal', 'perfecting', 'crafting'])
      expect(hud).not.toContain(`this.closeOtherWindows('#${id}-window')`);
  });

  it('syncs the bags pairing from the character sheet close hook', () => {
    expect(hud).toContain('onClosed: () => this.syncCharBagsPairing(),');
  });

  it('repaints the Rankings tab on a language switch', () => {
    const start = hud.indexOf('private refreshLocalizedDynamicUi(): void {');
    const body = hud.slice(start, hud.indexOf('\n  }\n', start));
    expect(start).toBeGreaterThan(0);
    expect(body).toContain('this.leaderboardWindow.relocalize();');
  });

  it('pins the docked sheet and bags over any inline position a drag or the cascade left', () => {
    const rule = (selector: string): string => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(0);
      return css.slice(start, css.indexOf('}', start));
    };
    const sheet = rule('body.char-bags-docked:not(.mobile-touch) #char-window');
    const bags = rule('body.char-bags-docked:not(.mobile-touch) #bags');
    // Inline styles lose only to !important, on every property a drag writes.
    for (const block of [sheet, bags])
      for (const prop of ['left', 'right', 'top', 'bottom', 'transform'])
        expect(block).toMatch(new RegExp(`\\b${prop}: [^;]+ !important;`));
  });
});
