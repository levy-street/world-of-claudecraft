// Source-scan guard for the prestige repaint wiring (the honor_ui.test.ts shape).
// prk rides every self snapshot, so the character sheet always has the new rank
// in hand; it just never repainted on prestige, leaving the open window showing
// the previous rank until it was closed and reopened. Node-only: reads the file
// as text, no DOM.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('prestige character-sheet refresh', () => {
  it('repaints the open character sheet when a prestige event lands', () => {
    const start = hud.indexOf("case 'prestige': {");
    expect(start, "the hud's prestige event case").toBeGreaterThan(-1);
    const end = hud.indexOf("case 'honor': {", start);
    const handler = hud.slice(start, end);

    expect(handler).toContain('this.renderCharIfOpen()');
  });
});
