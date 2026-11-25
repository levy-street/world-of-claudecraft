// The Quench's cold, read at a glance (playtest 2026-11-25: the cold debuff was
// only an icon, and its level needed a hover). Display-only: the debuff icon
// badges the bar's value, and the proc overlay's five Wrack marks paint in
// frost blue, one per fifth of the bar, the fifth lit only when frozen solid.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import type { Aura } from '../src/sim/types';
import {
  QUENCH_COLD_MARKS,
  quenchColdBadge,
  quenchColdMarks,
} from '../src/ui/hud/dungeon/quench_cold_view';
import type { ProcOverlayPainter } from '../src/ui/proc_overlay_painter';
import { paintProcOverlayRoute } from '../src/ui/proc_overlay_route';

const cold = (value: number) => ({ id: QUENCH_AURAS.cold, value });

describe('quenchColdBadge', () => {
  it('badges the cold bar value, rounded and clamped', () => {
    expect(quenchColdBadge(QUENCH_AURAS.cold, 37.6)).toBe(38);
    expect(quenchColdBadge(QUENCH_AURAS.cold, 0)).toBe(0);
    expect(quenchColdBadge(QUENCH_AURAS.cold, 140)).toBe(100);
    expect(quenchColdBadge(QUENCH_AURAS.cold, undefined)).toBe(0);
  });

  it('leaves every other aura to the usual stack rule', () => {
    expect(quenchColdBadge(QUENCH_AURAS.frozen, 50)).toBeNull();
    expect(quenchColdBadge('battle_stance', 50)).toBeNull();
  });
});

describe('quenchColdMarks', () => {
  it('is null without the cold or the freeze, so the class art shows', () => {
    expect(quenchColdMarks([])).toBeNull();
    expect(quenchColdMarks([{ id: 'battle_stance' }])).toBeNull();
  });

  it('lights one mark per fifth of the bar, never the fifth before the freeze', () => {
    expect(quenchColdMarks([cold(0)])).toBe(0);
    expect(quenchColdMarks([cold(19)])).toBe(0);
    expect(quenchColdMarks([cold(20)])).toBe(1);
    expect(quenchColdMarks([cold(59)])).toBe(2);
    expect(quenchColdMarks([cold(80)])).toBe(4);
    expect(quenchColdMarks([cold(99.9)])).toBe(4);
    expect(quenchColdMarks([cold(100)])).toBe(4);
  });

  it('lights all five while frozen solid (the bar itself resets to 0)', () => {
    expect(quenchColdMarks([cold(0), { id: QUENCH_AURAS.frozen }])).toBe(QUENCH_COLD_MARKS);
    expect(quenchColdMarks([{ id: QUENCH_AURAS.frozen }])).toBe(QUENCH_COLD_MARKS);
  });
});

function painterSpy() {
  const calls: string[] = [];
  const painter = {
    paint: () => calls.push('fire'),
    paintChronoCharges: () => calls.push('chrono'),
    paintFrostCharges: () => calls.push('frost'),
    paintNecromancyCharges: () => calls.push('necromancy'),
    paintDestructionMarks: (n: number, _l: string, _s: string, quench = false) =>
      calls.push(`${quench ? 'quench' : 'destruction'}:${n}`),
  } as unknown as ProcOverlayPainter;
  return { painter, calls };
}

const auras = (...list: { id: string; value?: number }[]) => list as unknown as Aura[];

describe('paintProcOverlayRoute', () => {
  it('paints the frost marks while the player carries the cold, whatever the spec', () => {
    for (const spec of ['destruction', 'demonology', 'fire', 'arms', null]) {
      const { painter, calls } = painterSpy();
      paintProcOverlayRoute(painter, spec, auras(cold(45)));
      expect(calls, String(spec)).toEqual(['quench:2']);
    }
  });

  it('falls back to the spec art once the cold is gone', () => {
    const cases: [string | null, string][] = [
      ['destruction', 'destruction:0'],
      ['demonology', 'necromancy'],
      ['arcane', 'chrono'],
      ['frost', 'frost'],
      ['fire', 'fire'],
      [null, 'fire'],
    ];
    for (const [spec, want] of cases) {
      const { painter, calls } = painterSpy();
      paintProcOverlayRoute(painter, spec, auras());
      expect(calls, String(spec)).toEqual([want]);
    }
  });
});

describe('the frost marks stylesheet', () => {
  const hud = readFileSync('src/styles/hud.css', 'utf8');
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');

  it('remaps every Wrack colour to a frost token', () => {
    const ruin = [...tokens.matchAll(/--color-ruin-([a-z-]+):/g)].map((m) => m[1]);
    expect(ruin.length).toBeGreaterThan(0);
    const rule = hud.slice(hud.indexOf('#proc-overlay.destruction.quench {'));
    const body = rule.slice(0, rule.indexOf('}'));
    for (const name of ruin) {
      expect(body, name).toContain(`--color-ruin-${name}: var(--color-quench-mark-${name});`);
      expect(tokens, name).toMatch(new RegExp(`--color-quench-mark-${name}: #`));
    }
  });
});
