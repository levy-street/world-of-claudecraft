import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

describe('player-frame aura context-menu ownership', () => {
  it('stops a reparented aura context menu before opening the self menu', () => {
    const start = hudSource.indexOf("$('#player-frame').addEventListener('contextmenu', (ev) => {");
    const end = hudSource.indexOf("this.bindMobileFrameLongPress($('#player-frame')", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const handler = hudSource.slice(start, end);
    const auraGuard = handler.indexOf("closest('#buff-bar, #debuff-bar')");
    const preventDefault = handler.indexOf('ev.preventDefault()', auraGuard);
    const earlyReturn = handler.indexOf('return;', preventDefault);
    const openSelfMenu = handler.indexOf('this.openSelfContextMenu(', earlyReturn);

    expect(auraGuard).toBeGreaterThanOrEqual(0);
    expect(preventDefault).toBeGreaterThan(auraGuard);
    expect(earlyReturn).toBeGreaterThan(preventDefault);
    expect(openSelfMenu).toBeGreaterThan(earlyReturn);
    expect(handler.match(/this\.openSelfContextMenu\(/g)).toHaveLength(1);
  });
});
