import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NAMEPLATE_BASE_WIDTH,
  NAMEPLATE_BOSS_WIDTH,
  NAMEPLATE_HEALTH_HEIGHT,
  NAMEPLATE_HEALTH_PICK_PADDING_Y,
  type NameplatePickCandidate,
  pickNameplateHealthBarAt,
} from '../src/render/nameplate_pick_core';

function plate(
  id: number,
  overrides: Partial<NameplatePickCandidate> = {},
): NameplatePickCandidate {
  return {
    id,
    sx: 200,
    sy: 100,
    hpVisible: true,
    castVisible: false,
    boss: false,
    pickable: true,
    ...overrides,
  };
}

describe('nameplate health-bar picking', () => {
  it('pins the drawn widths and a forgiving vertical hit area around the four-pixel bar', () => {
    expect(NAMEPLATE_BASE_WIDTH).toBe(80);
    expect(NAMEPLATE_BOSS_WIDTH).toBe(100);
    expect(NAMEPLATE_HEALTH_HEIGHT).toBe(4);
    expect(NAMEPLATE_HEALTH_PICK_PADDING_Y).toBe(6);

    const candidates = [plate(7)];
    // No cast bar: the health bar is drawn at anchorY - 7, from y=93 to y=97.
    expect(pickNameplateHealthBarAt(candidates, 1, 160, 87)).toBe(7);
    expect(pickNameplateHealthBarAt(candidates, 1, 240, 103)).toBe(7);
    expect(pickNameplateHealthBarAt(candidates, 1, 159.999, 95)).toBeNull();
    expect(pickNameplateHealthBarAt(candidates, 1, 200, 86.999)).toBeNull();
    expect(pickNameplateHealthBarAt(candidates, 1, 200, 103.001)).toBeNull();
  });

  it('uses the wider boss bar and follows the ten-pixel cast-bar lift', () => {
    const boss = plate(8, { boss: true, castVisible: true });
    // A visible cast bar moves the health bar from y=93 to y=83.
    expect(pickNameplateHealthBarAt([boss], 1, 150, 85)).toBe(8);
    expect(pickNameplateHealthBarAt([boss], 1, 250, 85)).toBe(8);
    expect(pickNameplateHealthBarAt([boss], 1, 149.999, 85)).toBeNull();
    expect(pickNameplateHealthBarAt([boss], 1, 200, 104)).toBeNull();
  });

  it('ignores hidden, stale, dead, and unused high-water candidates', () => {
    const candidates = [plate(1, { hpVisible: false }), plate(2, { pickable: false }), plate(3)];

    expect(pickNameplateHealthBarAt(candidates, 2, 200, 95)).toBeNull();
    expect(pickNameplateHealthBarAt(candidates, 3, 200, 95)).toBe(3);
    expect(pickNameplateHealthBarAt(candidates, 3, Number.NaN, 95)).toBeNull();
  });

  it('resolves a residual overlap to the plate drawn last', () => {
    const candidates = [plate(10), plate(11)];
    expect(pickNameplateHealthBarAt(candidates, 2, 200, 95)).toBe(11);
  });

  it('wires nameplates ahead of the direct 3D raycast without enabling overlay pointer events', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const canvas = readFileSync(
      new URL('../src/render/nameplate_canvas.ts', import.meta.url),
      'utf8',
    );

    const handlePick = main.indexOf('function handlePick(x: number, y: number, button: number)');
    const directEntityPick = main.indexOf('let id = renderer.pickDirect(x, y);', handlePick);
    const gatherNodePick = main.indexOf('renderer.pickGatherNode(x, y);', directEntityPick);
    const sloppyEntityPick = main.indexOf('renderer.pickSloppy(x, y);', gatherNodePick);
    expect(handlePick).toBeGreaterThanOrEqual(0);
    expect(directEntityPick).toBeGreaterThan(handlePick);
    expect(gatherNodePick).toBeGreaterThan(directEntityPick);
    expect(sloppyEntityPick).toBeGreaterThan(gatherNodePick);
    const directPick = renderer.indexOf(
      'pickDirect(clientX: number, clientY: number): number | null',
    );
    const nameplatePick = renderer.indexOf('this.nameplatePainter.pickEntityAt(', directPick);
    const nameplateWins = renderer.indexOf(
      'if (nameplate !== null) return nameplate;',
      nameplatePick,
    );
    const raycast = renderer.indexOf('this.raycaster.setFromCamera(', directPick);
    expect(directPick).toBeGreaterThanOrEqual(0);
    expect(nameplatePick).toBeGreaterThan(directPick);
    expect(nameplateWins).toBeGreaterThan(nameplatePick);
    expect(raycast).toBeGreaterThan(nameplateWins);
    expect(canvas).toContain("canvas.style.pointerEvents = 'none';");
  });
});
