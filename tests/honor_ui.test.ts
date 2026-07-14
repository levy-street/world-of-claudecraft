import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('Honor and ranked Arena chat feedback', () => {
  it('mirrors an Honor award to chat and the combat log', () => {
    const start = hud.indexOf("case 'honor':");
    const end = hud.indexOf("case 'levelup':", start);
    const handler = hud.slice(start, end);

    expect(handler).toContain("const honorMessage = t('hudChrome.warfare.honorGain'");
    expect(handler).toContain("this.log(honorMessage, '#ffd100')");
    expect(handler).toContain("this.combatLog(honorMessage, '#ffd100')");
  });

  it('mirrors the ranked Arena result line to chat and the combat log', () => {
    const start = hud.indexOf("case 'arenaEnd':");
    const end = hud.indexOf("case 'yumiStatus':", start);
    const handler = hud.slice(start, end);

    expect(handler).toContain('this.log(arenaResultLine, arenaResultColor)');
    expect(handler).toContain('this.combatLog(arenaResultLine, arenaResultColor)');
  });
});
