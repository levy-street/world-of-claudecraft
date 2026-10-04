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
      '  private readonly fctPainter = new FctPainter(',
      '  attachTooltip(el: HTMLElement, html: () => string): void {',
      'this.vehicleBar ??= createHudVehicleBar(this);',
      "  showBanner(\n    text: string,\n    motion = true,\n    decorativeIconUrl?: string,\n    variant: BannerVariant = 'default',\n    subtext?: string | string[],\n    durationMs = 2600,\n    source: 'unstuck' | 'turret' | null = null,",
      "  private clearSourceBanner(source: 'unstuck' | 'turret'): void {",
      'private lastMinimapDrawAt = 0;',
    ]) {
      expect(hudSource, anchor).toContain(anchor);
    }
  });

  it('lets the seat spawn its damage numbers before the FCT painter steps, in one update', () => {
    // FctPainter's frame-ordering contract: a spawn after step() reuses a freed node unpainted.
    const hudSource = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
    const start = hudSource.indexOf('\n  update(paint = true): void {\n');
    expect(start).toBeGreaterThan(0);
    const update = hudSource.slice(start, hudSource.indexOf('\n  }\n', start));
    const spawn = update.indexOf('this.vehicleControls.update();');
    const step = update.indexOf('this.fctPainter.step(now);');
    expect(spawn).toBeGreaterThan(0);
    expect(step).toBeGreaterThan(spawn);
  });
});
