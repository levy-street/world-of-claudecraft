// The Council's, the Quench's and the Breath's personal alerts read the
// player's auras the same off the offline Sim (full Aura records) and off the
// online ClientWorld mirror, whose decoded auras can lack the optional fields
// (no duration on a timer-less aura, no value2/value3 when the wire sent none).
// A sparse mirror-shaped aura must still give the same kind, a finite 0..1
// progress and fully filled text (no "{token}" left, no NaN).

import { describe, expect, it } from 'vitest';
import { BREATH_AURAS } from '../src/sim/encounters/smith_heart/breath_ids';
import { COUNCIL_AURAS } from '../src/sim/encounters/smith_heart/council_ids';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';
import { buildCouncilAlertView } from '../src/ui/hud/dungeon/council_alert_view';
import { buildKnotAlertView } from '../src/ui/hud/dungeon/knot_alert_view';
import { buildQuenchAlertView } from '../src/ui/hud/dungeon/quench_alert_view';
import { setLanguage } from '../src/ui/i18n';

setLanguage('en');

type View = { visible: boolean; kind?: string; progress?: number } & Record<string, unknown>;

/** Every string field filled, the progress finite and in range. */
function sane(v: View): void {
  expect(v.visible).toBe(true);
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string') {
      expect(val, k).not.toMatch(/\{\w+\}/);
      expect(val, k).not.toContain('NaN');
    }
  }
  expect(Number.isFinite(v.progress)).toBe(true);
  expect(v.progress).toBeGreaterThanOrEqual(0);
  expect(v.progress).toBeLessThanOrEqual(1);
}

const full = (id: string, extra: Record<string, number> = {}) => ({
  id,
  remaining: 2.5,
  duration: 5,
  value: 0,
  ...extra,
});
/** What a decoded mirror aura can carry at its leanest. */
const sparse = (id: string) => ({ id, remaining: 2.5 });

describe("the Smith's Heart alerts read a mirror-shaped aura like a Sim one", () => {
  it('the Council', () => {
    for (const id of [
      COUNCIL_AURAS.rushMark,
      COUNCIL_AURAS.rockMark,
      COUNCIL_AURAS.wakeMark,
      COUNCIL_AURAS.resonance,
    ]) {
      const a = buildCouncilAlertView({ auras: [full(id)] }) as unknown as View;
      const b = buildCouncilAlertView({ auras: [sparse(id)] }) as unknown as View;
      sane(a);
      sane(b);
      expect(b.kind, id).toBe(a.kind);
    }
  });

  it('the Quench', () => {
    for (const id of [QUENCH_AURAS.frozen, QUENCH_AURAS.trapped, QUENCH_AURAS.marked]) {
      const a = buildQuenchAlertView({
        auras: [full(id, { value: 2, value2: 3 })],
      }) as unknown as View;
      const b = buildQuenchAlertView({ auras: [sparse(id)] }) as unknown as View;
      sane(a);
      sane(b);
      expect(b.kind, id).toBe(a.kind);
    }
  });

  it('the Breath', () => {
    const base = { pos: { x: 0, z: 0 }, interactKey: 'F', touch: false };
    for (const id of [BREATH_AURAS.portalA, BREATH_AURAS.portalD, BREATH_AURAS.laden]) {
      const a = buildKnotAlertView({ ...base, auras: [full(id)] }) as unknown as View;
      const b = buildKnotAlertView({ ...base, auras: [sparse(id)] }) as unknown as View;
      sane(a);
      sane(b);
      expect(b.kind, id).toBe(a.kind);
    }
  });
});
