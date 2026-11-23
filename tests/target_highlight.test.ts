import { describe, expect, it } from 'vitest';
import { BOOL_SETTINGS } from '../src/game/settings';
import { NameplatePaintGate } from '../src/render/nameplate_paint_gate_core';
import {
  edgeArrowInto,
  edgeArrowMarginX,
  edgeArrowMarginY,
  newEdgeArrowPlacement,
  newTargetHighlightFlags,
  TARGET_HIGHLIGHT_SETTING_FLAG,
  targetHighlightFlagFor,
} from '../src/render/target_highlight_core';
import { buildInterfaceControls, interfaceControlsForTab } from '../src/ui/options_view';

const W = 1280;
const H = 720;
const MX = edgeArrowMarginX(W);
const MY = edgeArrowMarginY(H);

describe('Style of Enemy Highlight settings', () => {
  it('ships four independent bool settings, all off by default', () => {
    for (const key of Object.keys(TARGET_HIGHLIGHT_SETTING_FLAG)) {
      expect(BOOL_SETTINGS[key as keyof typeof BOOL_SETTINGS]?.def).toBe(false);
    }
    expect(newTargetHighlightFlags()).toEqual({
      edgeArrow: false,
      nameplate: false,
      overhead: false,
      reticle: false,
    });
  });

  it('maps each setting to its own flag and ignores every other key', () => {
    expect(targetHighlightFlagFor('targetHighlightEdgeArrow')).toBe('edgeArrow');
    expect(targetHighlightFlagFor('targetHighlightNameplate')).toBe('nameplate');
    expect(targetHighlightFlagFor('targetHighlightOverhead')).toBe('overhead');
    expect(targetHighlightFlagFor('targetHighlightReticle')).toBe('reticle');
    expect(targetHighlightFlagFor('groundReticle')).toBeNull();
    expect(targetHighlightFlagFor('toString')).toBeNull();
    const flags = new Set(Object.values(TARGET_HIGHLIGHT_SETTING_FLAG));
    expect(flags.size).toBe(4);
  });

  it('lists the group on the Combat tab as a heading over four checkboxes', () => {
    const source = { num: () => 0, bool: () => false, range: () => ({ min: 0, max: 1 }) };
    const combat = interfaceControlsForTab(buildInterfaceControls(source), 'combat');
    const head = combat.findIndex(
      (c) => c.control === 'note' && c.textKey === 'hudChrome.options.enemyHighlightStyle',
    );
    expect(head).toBeGreaterThanOrEqual(0);
    expect(combat[head]).toMatchObject({ subhead: true });
    const rows = combat.slice(head + 1, head + 5);
    expect(rows.map((c) => ('key' in c ? c.key : ''))).toEqual([
      'targetHighlightEdgeArrow',
      'targetHighlightNameplate',
      'targetHighlightOverhead',
      'targetHighlightReticle',
    ]);
    for (const row of rows) expect(row).toMatchObject({ control: 'boolToggle', check: true });
  });
});

describe('edgeArrowInto', () => {
  it('insets in proportion to the viewport, never below the floor', () => {
    expect(MX).toBeCloseTo(192); // clears the side button rail at 1280 wide
    expect(MY).toBeCloseTo(158.4); // clears the unit frames at 720 tall
    expect(edgeArrowMarginX(200)).toBe(56);
  });

  it('reports an on-screen target and leaves the placement alone', () => {
    const out = newEdgeArrowPlacement();
    expect(edgeArrowInto(out, 0, 0, -10, 0.2, -0.4, W, H)).toBe(false);
    expect(out).toEqual({ x: 0, y: 0, angle: 0 });
  });

  it('pins a target off the right edge to the right inset, pointing right', () => {
    const out = newEdgeArrowPlacement();
    expect(edgeArrowInto(out, 30, 0, -10, 3, 0, W, H)).toBe(true);
    expect(out.x).toBeCloseTo(W - MX);
    expect(out.y).toBeCloseTo(H / 2);
    expect(out.angle).toBeCloseTo(0);
  });

  it('pins a target above the view to the top inset, pointing up', () => {
    const out = newEdgeArrowPlacement();
    expect(edgeArrowInto(out, 0, 30, -10, 0, 4, W, H)).toBe(true);
    expect(out.x).toBeCloseTo(W / 2);
    expect(out.y).toBeCloseTo(MY);
    expect(out.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('uses camera-space direction for a target behind the camera', () => {
    const out = newEdgeArrowPlacement();
    // Behind and to the left: the mirrored NDC would say "right", the arrow says left.
    expect(edgeArrowInto(out, -5, 0, 8, 0.5, 0, W, H)).toBe(true);
    expect(out.x).toBeCloseTo(MX);
    expect(Math.abs(out.angle)).toBeCloseTo(Math.PI);
  });

  it('points straight down for a target dead behind the camera', () => {
    const out = newEdgeArrowPlacement();
    expect(edgeArrowInto(out, 0, 0, 8, 0, 0, W, H)).toBe(true);
    expect(out.x).toBeCloseTo(W / 2);
    expect(out.y).toBeCloseTo(H - MY);
    expect(out.angle).toBeCloseTo(Math.PI / 2);
  });

  it('keeps every placement inside the inset rectangle', () => {
    const out = newEdgeArrowPlacement();
    for (let a = 0; a < Math.PI * 2; a += 0.37) {
      edgeArrowInto(out, 0, 0, -1, Math.cos(a) * 5, Math.sin(a) * 5, W, H);
      expect(out.x).toBeGreaterThanOrEqual(MX - 1e-6);
      expect(out.x).toBeLessThanOrEqual(W - MX + 1e-6);
      expect(out.y).toBeGreaterThanOrEqual(MY - 1e-6);
      expect(out.y).toBeLessThanOrEqual(H - MY + 1e-6);
    }
  });
});

describe('nameplate paint gate: the off-plate target cue', () => {
  const pass = (gate: NameplatePaintGate, kind: number, x: number, label = '') => {
    gate.beginPass(W, H, 1, 0);
    gate.noteOverlay(kind, x, 100, 0, label);
    const paint = gate.needsPaint();
    if (paint) gate.commit();
    return paint;
  };

  it('repaints when the cue appears, moves, relabels or vanishes, and only then', () => {
    const gate = new NameplatePaintGate();
    expect(pass(gate, 0, 0)).toBe(true); // first pass always paints
    expect(pass(gate, 0, 0)).toBe(false);
    expect(pass(gate, 2, 500, '30 yd')).toBe(true);
    expect(pass(gate, 2, 500.2, '30 yd')).toBe(false); // sub-pixel
    expect(pass(gate, 2, 520, '30 yd')).toBe(true);
    expect(pass(gate, 2, 520, '31 yd')).toBe(true);
    expect(pass(gate, 0, 0)).toBe(true);
    expect(pass(gate, 0, 0)).toBe(false);
  });
});
