import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the HUD vehicle bar factory host seam', () => {
  it('stays welded to the private Hud members the factory reads', () => {
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    for (const anchor of [
      'private sim: IWorld,',
      'private renderer: Renderer,',
      'private keybinds: Keybinds,',
      'private readonly writerFacet = makeWriterFacet(',
      'private optionsHooks: OptionsHooks | null = null;',
      'private peekGuard = new TouchPeekGuard();',
      'private readonly playerGroundAim = new GroundAimController({',
      'private readonly empowerHold = new EmpowerHold();',
      '  attachTooltip(el: HTMLElement, html: () => string): void {',
      'this.vehicleBar ??= createHudVehicleBar(this);',
    ]) {
      expect(hudSource, anchor).toContain(anchor);
    }
  });
});
