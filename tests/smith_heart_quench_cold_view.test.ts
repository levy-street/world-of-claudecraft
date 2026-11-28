// The Quench's cold, read at a glance (playtest 2026-11-25: the cold debuff was
// only an icon, and its level needed a hover). Display-only: the debuff icon
// badges the bar's value, 0 to 99, and at the freeze the cold's icon gives way
// to the freeze's own debuff. The playtest dropped the blue counter on the
// Warlock's Wrack marks, so the proc overlay stays the class's alone.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import {
  QUENCH_COLD_BADGE_MAX,
  quenchColdBadge,
  quenchColdIconHidden,
  quenchFrozenSolid,
} from '../src/ui/hud/dungeon/quench_cold_view';

const cold = (value: number) => ({ id: QUENCH_AURAS.cold, value });

describe('quenchColdBadge', () => {
  it('badges the cold bar value, rounded and clamped', () => {
    expect(quenchColdBadge(QUENCH_AURAS.cold, 37.6)).toBe(38);
    expect(quenchColdBadge(QUENCH_AURAS.cold, 0)).toBe(0);
    // Tops out at 99: a full bar is the freeze, which wears its own debuff.
    expect(quenchColdBadge(QUENCH_AURAS.cold, 99.4)).toBe(99);
    expect(quenchColdBadge(QUENCH_AURAS.cold, 100)).toBe(QUENCH_COLD_BADGE_MAX);
    expect(quenchColdBadge(QUENCH_AURAS.cold, 140)).toBe(99);
    expect(quenchColdBadge(QUENCH_AURAS.cold, undefined)).toBe(0);
  });

  it('leaves every other aura to the usual stack rule', () => {
    expect(quenchColdBadge(QUENCH_AURAS.frozen, 50)).toBeNull();
    expect(quenchColdBadge('battle_stance', 50)).toBeNull();
  });
});

describe('the cold icon gives way to the freeze', () => {
  it('hides only the cold, and only while frozen solid', () => {
    const frozen = quenchFrozenSolid([cold(0), { id: QUENCH_AURAS.frozen }]);
    expect(frozen).toBe(true);
    expect(quenchFrozenSolid([cold(80)])).toBe(false);
    expect(quenchColdIconHidden(QUENCH_AURAS.cold, true)).toBe(true);
    expect(quenchColdIconHidden(QUENCH_AURAS.cold, false)).toBe(false);
    expect(quenchColdIconHidden(QUENCH_AURAS.frozen, true)).toBe(false);
  });
});

describe('no cold counter on the proc overlay', () => {
  it('leaves the Wrack marks to the Warlock', () => {
    const hud = readFileSync('src/ui/hud.ts', 'utf8');
    const painter = readFileSync('src/ui/proc_overlay_painter.ts', 'utf8');
    const css = readFileSync('src/styles/hud.css', 'utf8');
    expect(hud).not.toMatch(/quench_cold_view|quenchCold/);
    expect(painter).not.toContain("'quench'");
    expect(css).not.toContain('#proc-overlay.destruction.quench');
  });
});
