// A Dust Devil's throw is a SLIDE, not a blink (the team's playtest of
// 2026-11-25: touching one of the Masterless Strength's wind tornadoes
// "teleported you backwards"): over a REAL Sim claim the devil carries the
// body out over a short eased moment (src/sim/encounters/smith_heart/
// breath_shove.ts, the Breath's loose gale's toss), held by an unbreakable
// root so the online client draws the server's slide
// (server/movement_override_epoch.ts), the renderer lifting the body on its
// arc (render/thrown_hop_core.ts); every knockback immunity still holds.

import { describe, expect, it } from 'vitest';
import {
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  updateMovementOverrideEpochs,
} from '../server/movement_override_epoch';
import { stepThrownHop, THROWN_HOPS } from '../src/render/thrown_hop_core';
import { FINAL_AURAS, FINAL_OBJECTS, FINAL_TUNING as T } from '../src/sim/encounters/smith_heart';
import { shoveStep } from '../src/sim/encounters/smith_heart/breath_shove';
import { DT, type Entity } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { type FinalFight, finalFight } from './helpers/final_fight';

const ticks = (s: number) => Math.round(s / DT);
const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);

/** The boss pulled in the Breath, ONE live devil (the others held still). */
function oneDevil(seed = 41): { f: FinalFight; devil: Entity } {
  const f = finalFight(5, seed);
  f.pullIn('breath');
  f.dev('/dev heart final devils');
  const st = f.state();
  if (!st) throw new Error('no fight');
  // Only the first devil ticks: the others stand still and never strike.
  const devil = f.objects(FINAL_OBJECTS.devilPrefix)[0];
  st.whirls = st.whirls.filter((w) => w.objectId === devil.id);
  f.tick(ticks(T.devilWarn + 0.1));
  return { f, devil };
}

/** Hold `p` a yard off the devil's eye until it strikes them; returns the
 *  tick's index it struck (or -1) and where they stood then. */
function strikeOf(f: FinalFight, devil: Entity, p: Entity): { x: number; z: number } | null {
  for (let i = 0; i < ticks(T.devilHitEvery + 1); i++) {
    const eye = f.local(devil);
    f.put(p, eye.x + 1, eye.z);
    const start = { ...f.local(p) };
    f.tick(1);
    if (f.state()?.devilShoves.some((sl) => sl.id === p.id)) return start;
  }
  return null;
}

describe("a Dust Devil's throw slides", () => {
  it('the eased throw: fast off the eye, settling, its whole yards in its seconds', () => {
    const n = ticks(T.devilSlide);
    let sum = 0;
    for (let k = 0; k < n; k++) sum += shoveStep('out', T.devilKnockback, k, n);
    expect(sum).toBeCloseTo(T.devilKnockback, 6);
    expect(shoveStep('out', T.devilKnockback, 0, n)).toBeGreaterThan(
      shoveStep('out', T.devilKnockback, n - 1, n) * 3,
    );
    // A real moment, never a blink: several ticks, under a second.
    expect(n).toBeGreaterThanOrEqual(8);
    expect(T.devilSlide).toBeLessThan(1);
  });

  it('touching a devil slides the body out over the moment, never in one tick', () => {
    const { f, devil } = oneDevil();
    const p = f.players[3];
    const start = strikeOf(f, devil, p);
    expect(start).not.toBeNull();
    if (!start) return;
    expect(has(p, FINAL_AURAS.devilThrown)).toBe(true);
    const path: number[] = [Math.hypot(f.local(p).x - start.x, f.local(p).z - start.z)];
    for (let i = 0; i < ticks(T.devilSlide + 0.5); i++) {
      f.tick(1);
      const at = f.local(p);
      path.push(Math.hypot(at.x - start.x, at.z - start.z));
    }
    // No blink: the strike's tick moves a fraction of the throw.
    expect(path[0]).toBeLessThan(T.devilKnockback * 0.3);
    // Every tick a step, never a jump past a third of the throw.
    for (let i = 1; i < path.length; i++)
      expect(path[i] - path[i - 1]).toBeLessThan(T.devilKnockback * 0.3);
    // It got (near) the whole way out, then the hold let go.
    expect(path[path.length - 1]).toBeGreaterThan(T.devilKnockback * 0.85);
    expect(has(p, FINAL_AURAS.devilThrown)).toBe(false);
    expect(f.state()?.devilShoves.length).toBe(0);
  });

  it('holds the online override through the slide: one epoch edge at most', () => {
    const { f, devil } = oneDevil();
    const p = f.players[3];
    const s: MovementOverrideSessionState = {
      pid: p.id,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    };
    expect(strikeOf(f, devil, p)).not.toBeNull();
    updateMovementOverrideEpochs(f.sim, [s]);
    let sliding = 0;
    let bumps = 0;
    let last = s.movementOverrideEpoch;
    for (let i = 0; i < ticks(T.devilSlide + 1); i++) {
      f.tick(1);
      updateMovementOverrideEpochs(f.sim, [s]);
      if (f.state()?.devilShoves.some((sl) => sl.id === p.id)) {
        sliding++;
        expect(s.movementOverrideActive).toBe(true);
        if (s.movementOverrideEpoch !== last) bumps++;
      }
      last = s.movementOverrideEpoch;
    }
    expect(sliding).toBeGreaterThan(ticks(T.devilSlide) / 2);
    expect(bumps).toBeLessThanOrEqual(1);
    expect(s.movementOverrideActive).toBe(false);
  });

  it('a body still sliding is not thrown again, and an Ice Block keeps its feet', () => {
    const { f, devil } = oneDevil();
    const p = f.players[3];
    expect(strikeOf(f, devil, p)).not.toBeNull();
    expect(f.state()?.devilShoves.filter((sl) => sl.id === p.id).length).toBe(1);
    // An immune body: struck, never slid, never held.
    const q = f.players[4];
    q.auras.push({
      id: 'ice_block',
      name: 'Ice Block',
      kind: 'stasis',
      remaining: 30,
      duration: 30,
      value: 0,
      sourceId: q.id,
      school: 'frost',
    });
    expect(f.sim.ctx.isIceBlocked(q)).toBe(true);
    for (let i = 0; i < ticks(T.devilHitEvery + 1); i++) {
      const eye = f.local(devil);
      f.put(q, eye.x + 1, eye.z);
      f.tick(1);
    }
    expect(f.state()?.devilShoves.some((sl) => sl.id === q.id)).toBe(false);
    expect(has(q, FINAL_AURAS.devilThrown)).toBe(false);
  });

  it('a wipe drops every hold', () => {
    const { f, devil } = oneDevil();
    const p = f.players[3];
    expect(strikeOf(f, devil, p)).not.toBeNull();
    f.dev('/dev heart final reset');
    f.tick(2);
    expect(has(p, FINAL_AURAS.devilThrown)).toBe(false);
  });

  it('draws a hop and reads a tooltip', () => {
    const hop = THROWN_HOPS[FINAL_AURAS.devilThrown];
    expect(hop.seconds).toBe(T.devilSlide);
    const st = { seen: false, start: 0, seconds: 0, height: 0 };
    stepThrownHop(st, [{ id: FINAL_AURAS.devilThrown }], 10);
    expect(
      stepThrownHop(st, [{ id: FINAL_AURAS.devilThrown }], 10 + hop.seconds * 0.4),
    ).toBeGreaterThan(0.5);
    const d = auraEffectDescriptor({ id: FINAL_AURAS.devilThrown, kind: 'root', value: 0 });
    expect(d?.key).toBe('hudChrome.auraEffect.finalBoss.devilThrown');
    const text = t('hudChrome.auraEffect.finalBoss.devilThrown', d?.nums);
    expect(text).toContain(`${T.devilKnockback} yd`);
  });
});
