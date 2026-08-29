import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Comment-stripped before matching, so a commented-out copy of a pinned line
// cannot satisfy a positive match and a live regression cannot hide behind one.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const mainSource = stripComments(readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8'));

describe('pad cast main wiring', () => {
  it('routes flat slot presses through the hold-aware HUD entry point', () => {
    const start = mainSource.indexOf('function dispatchGamepadAction(id: string): void {');
    const end = mainSource.indexOf('const gamepad = new GamepadManager', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const dispatch = mainSource.slice(start, end);

    expect(dispatch).toContain("if (id.startsWith('slot')) {");
    expect(dispatch).toContain('hud.pressSlot(Number(id.slice(4)));');
    // An occurrence bound, not a byte-exact negative: any castSlot call in the
    // dispatch body would bypass the press/release cycle however it is spelled.
    expect(dispatch.match(/hud\.castSlot/g) ?? []).toHaveLength(0);
  });

  it('wires cross hotbar press and release through the routing module', () => {
    const start = mainSource.indexOf('const gamepad = new GamepadManager');
    const end = mainSource.indexOf('crossHotbar.attach(gamepad);', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const callbacks = mainSource.slice(start, end);

    expect(callbacks).toContain(
      'onCrossHotbarCast: (action) => padCastPress(hud, padTargetPick.autoTarget, action),',
    );
    expect(callbacks).toContain('onCastRelease: (hold) => padCastRelease(hud, hold),');
  });
});
