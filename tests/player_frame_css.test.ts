import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

function ruleBlock(selector: string): string {
  const start = hudCss.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  return hudCss.slice(start, hudCss.indexOf('}', start));
}

describe('desktop player frame sizing', () => {
  it('keeps the full configured player frame width after dragging detaches it', () => {
    const docked = ruleBlock('#player-frame {');
    const detached = ruleBlock('#player-frame.pf-detached {');
    expect(docked).toContain('width: 612px;');
    expect(detached).toContain('width: 612px;');
    expect(hudCss).not.toContain('#player-frame.pf-detached .uf-bars');
  });
});
