import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const windowSource = readFileSync(
  new URL('../src/ui/poker_playtest_window.ts', import.meta.url),
  'utf8',
);
const componentCss = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');

describe('poker playtest window contract', () => {
  it('quotes multi-class seats so positions and states survive HTML parsing', () => {
    expect(windowSource).toMatch(/<div class='\$\{esc\(classes\)\}'>/);
    expect(windowSource).not.toMatch(/<div class=\$\{classes\}>/);
  });

  it('does not arm the turn countdown while disconnected', () => {
    expect(windowSource).toContain(
      'state.connected && !this.invalidAmount && state.error === null',
    );
    expect(windowSource).toContain('if (updateTimer) this.armTimer(seconds)');
  });

  it('keeps every poker button at least 40 by 40 pixels', () => {
    expect(componentCss).toMatch(
      /\.poker-action,[^{]*\.poker-control,[^{]*\.poker-wager-step \{[^}]*min-width:\s*40px;[^}]*min-height:\s*40px;/s,
    );
  });

  it('defines portrait and landscape responsive poker layouts', () => {
    expect(mobileCss).toContain('(orientation: portrait)');
    expect(mobileCss).toContain('(orientation: landscape)');
    expect(mobileCss).toContain('#poker-playtest-window');
  });

  it('keeps showdown messages in document flow after the table', () => {
    expect(componentCss).toMatch(
      /\.poker-result-banner,[^}]*\.poker-showdown-banner \{[^}]*position:\s*relative;[^}]*transform:\s*translateX\(-50%\);/,
    );
    expect(componentCss).toMatch(
      /#lockpick-panel,[^}]*#delve-rite-panel \{[^}]*transform:\s*translate\(-50%, -50%\);/,
    );
    expect(componentCss).toContain('.poker-card.highlighted');
  });
});
