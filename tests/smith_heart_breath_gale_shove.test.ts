// A loose gale's toss is a SHOVE, not a blink (Jose's playtest of
// 2026-11-04: touching a Breath tornado threw him sideways like a teleport):
// over a REAL Sim claim the toss slides the body out over a short eased
// moment (src/sim/encounters/smith_heart/breath_shove.ts, shared with the
// Summit Roar), held by an unbreakable root so the online client draws the
// server's slide (server/movement_override_epoch.ts), and the anchored keep
// their feet.

import { describe, expect, it } from 'vitest';
import {
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  updateMovementOverrideEpochs,
} from '../server/movement_override_epoch';
import { BREATH } from '../src/sim/content/smith_heart_layout';
import {
  BREATH_AURAS,
  BREATH_OBJECTS,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { shoveEase, shoveStep } from '../src/sim/encounters/smith_heart/breath_shove';
import { DT, type Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s / DT);
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

function pulled(seed = 23): BreathFight {
  const f = breathFight(4, seed);
  expect(f.dev('/dev heart breath pull')).toBe(true);
  f.tick(2);
  f.dev('/dev heart breath calm');
  const st = f.state();
  if (st) {
    st.wind.remaining = 9999;
    st.inhaleTimer = 9999;
    st.circleTimer = 9999;
  }
  const b = f.boss();
  f.players.forEach((p, i) => {
    if (!b.threat.has(p.id)) b.threat.set(p.id, 10 - i);
  });
  return f;
}

/** Loose the gales and stand `p` a breath off the first one's middle, on the
 *  Cornice's side away from the rim, so its toss carries them inward. */
function intoGale(f: BreathFight, p: Entity): { gx: number; gz: number } {
  f.dev('/dev heart breath tornado');
  const g = f.objects(BREATH_OBJECTS.gale)[0];
  const gl = f.local(g);
  const C = BREATH.cornice;
  const dx = C.x - gl.x;
  const dz = C.z - gl.z;
  const d = Math.hypot(dx, dz) || 1;
  f.put(p, gl.x + (dx / d) * 1.2, gl.z + (dz / d) * 1.2);
  return { gx: gl.x, gz: gl.z };
}

describe("a loose gale's toss slides", () => {
  it('the eased shove: fast off the gale, settling, its whole throw in its seconds', () => {
    const n = ticks(T.galeSlide);
    let sum = 0;
    for (let k = 0; k < n; k++) sum += shoveStep('out', T.galeThrow, k, n);
    expect(sum).toBeCloseTo(T.galeThrow, 6);
    expect(shoveStep('out', T.galeThrow, 0, n)).toBeGreaterThan(
      shoveStep('out', T.galeThrow, n - 1, n) * 3,
    );
    expect(shoveEase('linear', 0.5)).toBe(0.5);
    expect(shoveEase('out', 0.5)).toBeGreaterThan(0.5);
    // A real moment, never a blink: several ticks, under a second.
    expect(n).toBeGreaterThanOrEqual(8);
    expect(T.galeSlide).toBeLessThan(1);
  });

  it('touching a gale slides the body out over the moment, never in one tick', () => {
    const f = pulled();
    const p = f.players[1];
    intoGale(f, p);
    const start = { ...f.local(p) };
    // The tick it is struck: only the first step of the shove.
    let struckAt = -1;
    const path: number[] = [];
    for (let i = 0; i < ticks(T.galeSlide + 1); i++) {
      f.tick(1, true);
      const at = f.local(p);
      const d = Math.hypot(at.x - start.x, at.z - start.z);
      path.push(d);
      if (struckAt < 0 && d > 0.05) struckAt = i;
      // Keep the gale from striking again (one toss per gale per 2 s anyway).
    }
    expect(struckAt).toBeGreaterThanOrEqual(0);
    // No blink: the first step is a fraction of the throw.
    expect(path[struckAt]).toBeLessThan(T.galeThrow * 0.3);
    // Every tick moves a step, never a jump past a third of the throw.
    for (let i = struckAt + 1; i < path.length; i++)
      expect(path[i] - path[i - 1]).toBeLessThan(T.galeThrow * 0.3);
    // It got the whole way (or near: the slide settles).
    const end = path[path.length - 1];
    expect(end).toBeGreaterThan(T.galeThrow * 0.85);
    expect(has(p, BREATH_AURAS.tossed)).toBe(false);
  });

  it('holds the online override through the slide: one epoch edge at most', () => {
    const f = pulled();
    const p = f.players[1];
    const s: MovementOverrideSessionState = {
      pid: p.id,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    };
    intoGale(f, p);
    let sliding = 0;
    let bumps = 0;
    let last = -1;
    for (let i = 0; i < ticks(T.galeSlide + 1); i++) {
      f.tick(1, true);
      updateMovementOverrideEpochs(f.sim, [s]);
      const inSlide = f.state()?.galeShoves.some((sl) => sl.id === p.id) ?? false;
      if (inSlide) {
        sliding++;
        expect(s.movementOverrideActive).toBe(true);
        expect(has(p, BREATH_AURAS.tossed)).toBe(true);
        if (last >= 0 && s.movementOverrideEpoch !== last) bumps++;
      }
      last = s.movementOverrideEpoch;
    }
    expect(sliding).toBeGreaterThan(ticks(T.galeSlide) / 2);
    expect(bumps).toBeLessThanOrEqual(1);
    expect(s.movementOverrideActive).toBe(false);
  });

  it('the anchored keep their feet: struck, never slid, never held', () => {
    const f = pulled();
    const p = f.players[1];
    p.auras.push({
      id: BREATH_AURAS.anchor,
      name: 'Anchored in Calm',
      kind: 'internal_cd',
      remaining: 15,
      duration: 15,
      value: 0,
      sourceId: f.boss().id,
      school: 'holy',
    });
    intoGale(f, p);
    const hp0 = p.hp;
    const start = { ...f.local(p) };
    f.tick(ticks(0.3), true);
    const at = f.local(p);
    expect(p.hp).toBeLessThan(hp0);
    expect(Math.hypot(at.x - start.x, at.z - start.z)).toBeLessThan(0.5);
    expect(has(p, BREATH_AURAS.tossed)).toBe(false);
  });

  it('a reset drops every hold and slide', () => {
    const f = pulled();
    const p = f.players[1];
    intoGale(f, p);
    f.tick(3, true);
    expect(has(p, BREATH_AURAS.tossed)).toBe(true);
    f.dev('/dev heart breath reset');
    expect(has(p, BREATH_AURAS.tossed)).toBe(false);
  });

  it('the toss says its rule', () => {
    const d = auraEffectDescriptor({ id: BREATH_AURAS.tossed, kind: 'root', value: 0 });
    expect(d).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}|hudChrome/);
    expect(text).toMatch(/Loose Gale/);
  });
});
