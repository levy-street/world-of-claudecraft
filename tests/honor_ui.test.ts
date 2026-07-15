import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('Honor and ranked Arena chat feedback', () => {
  it('mirrors an Honor award to both panes but announces it exactly once', () => {
    const start = hud.indexOf("case 'honor':");
    const end = hud.indexOf("case 'levelup':", start);
    const handler = hud.slice(start, end);

    expect(handler).toContain("const honorMessage = t('hudChrome.warfare.honorGain'");
    // The chat pane carries the single announce (log -> #chat-live).
    expect(handler).toContain("this.log(honorMessage, '#ffd100')");
    // The combat pane is a SILENT visual mirror (appendLog, NOT combatLog), so a screen
    // reader hears the Honor gain once, matching the xp-float precedent / announce contract.
    expect(handler).toContain("this.appendLog(this.combatLogEl, honorMessage, '#ffd100')");
    expect(handler).not.toContain('this.combatLog(honorMessage');
    // Keeps the open character sheet's Honor balance live when an award lands.
    expect(handler).toContain('this.renderCharIfOpen()');
  });

  it('mirrors the ranked Arena result to both panes but announces it exactly once', () => {
    const start = hud.indexOf("case 'arenaEnd':");
    const end = hud.indexOf("case 'yumiStatus':", start);
    const handler = hud.slice(start, end);

    expect(handler).toContain('this.log(arenaResultLine, arenaResultColor)');
    expect(handler).toContain(
      'this.appendLog(this.combatLogEl, arenaResultLine, arenaResultColor)',
    );
    expect(handler).not.toContain('this.combatLog(arenaResultLine');
  });
});
