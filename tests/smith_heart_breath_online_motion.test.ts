// The Guardian of the Breath's server-driven motion as the ONLINE client
// reads it (server/movement_override_epoch.ts over a REAL Sim claim): while
// the encounter moves a player's body for several ticks (the gale ride to an
// isle and home, the Summit Roar's sliding throw) the movement override must
// stay ACTIVE, so the client stands its prediction down once and draws the
// authoritative motion, instead of a server-driven step every tick bumping
// the override epoch (the prediction suspending and resuming each snapshot:
// a jerky throw). Jose's online playtest of 2026-11-03.

import { describe, expect, it } from 'vitest';
import {
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  updateMovementOverrideEpochs,
} from '../server/movement_override_epoch';
import { BREATH } from '../src/sim/content/smith_heart_layout';
import {
  BREATH_AURAS,
  BREATH_CUES,
  ISLE_TUNING as IT,
  isleSpots,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT } from '../src/sim/types';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { type BreathFight, breathFight } from './helpers/breath_fight';

const ticks = (s: number) => Math.round(s / DT);

function pulled(n: number): BreathFight {
  const f = breathFight(n, 23);
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

function sessionOf(f: BreathFight, pid: number): MovementOverrideSessionState {
  return { pid, movementWireVersion: 2, ...createMovementOverrideSessionState() };
}

/** Step the server's per-tick override pass after each sim tick. */
function watch(f: BreathFight, s: MovementOverrideSessionState) {
  const log: { epoch: number; active: boolean }[] = [];
  return {
    log,
    tick(keepAlive = true) {
      const ev = f.tick(1, keepAlive);
      updateMovementOverrideEpochs(f.sim, [s]);
      log.push({ epoch: s.movementOverrideEpoch, active: s.movementOverrideActive });
      return ev;
    },
  };
}

describe('the Breath moves bodies the online client can draw', () => {
  it('the gale ride out holds the override the whole arc: one epoch edge, never one a tick', () => {
    const f = pulled(4);
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * 0.7) - 1;
    for (let i = 0; i < ticks(3) && !f.state()?.isles.round; i++) f.tick();
    const i = f.state()?.isles.round?.isles[0] as number;
    const p = f.players[2];
    const s = sessionOf(f, p.id);
    const w = watch(f, s);
    w.tick();
    const e0 = s.movementOverrideEpoch;
    f.put(p, isleSpots()[i].path.x, isleSpots()[i].path.z);
    w.tick();
    expect(p.carriedBy).toBeDefined();
    const startEpoch = s.movementOverrideEpoch;
    expect(startEpoch).toBeGreaterThan(e0);
    for (let k = 0; k < ticks(IT.rideSeconds) - 2; k++) {
      w.tick();
      expect(s.movementOverrideActive).toBe(true);
    }
    // Airborne for the whole arc without one more epoch bump.
    expect(s.movementOverrideEpoch).toBe(startEpoch);
  });

  it("an anchored player rides too, the override held the whole arc (Thessaly's calm never blocks it)", () => {
    const f = pulled(4);
    const b = f.boss();
    b.hp = Math.floor(b.maxHp * 0.7) - 1;
    for (let i = 0; i < ticks(3) && !f.state()?.isles.round; i++) f.tick();
    const i = f.state()?.isles.round?.isles[0] as number;
    const p = f.players[2];
    p.auras.push({
      id: BREATH_AURAS.anchor,
      name: 'Anchored in Calm',
      kind: 'internal_cd',
      remaining: 15,
      duration: 15,
      value: 0,
      sourceId: b.id,
      school: 'holy',
    });
    const s = sessionOf(f, p.id);
    const w = watch(f, s);
    w.tick();
    f.put(p, isleSpots()[i].path.x, isleSpots()[i].path.z);
    w.tick();
    expect(p.carriedBy).toBeDefined();
    const startEpoch = s.movementOverrideEpoch;
    for (let k = 0; k < ticks(IT.rideSeconds) - 2; k++) {
      w.tick();
      expect(s.movementOverrideActive).toBe(true);
    }
    expect(s.movementOverrideEpoch).toBe(startEpoch);
  });

  it("the Summit Roar's slide holds the override while the throw slides", () => {
    const f = pulled(4);
    const b = f.boss();
    const C = BREATH.cornice;
    const bw = f.world(C.x, C.z);
    b.pos.x = bw.x;
    b.pos.z = bw.z;
    b.pos.y = f.sim.ctx.groundPos(bw.x, bw.z).y;
    f.sim.ctx.rebucket(b);
    const near = f.players[1];
    const s = sessionOf(f, near.id);
    const w = watch(f, s);
    f.dev('/dev heart breath roar');
    let landed = false;
    let sliding = 0;
    let bumpsWhileSliding = 0;
    let last = -1;
    for (let k = 0; k < ticks(T.inhaleCast + T.gustCast + 3); k++) {
      if (!landed) f.put(near, C.x + 4, C.z);
      const ev = w.tick();
      if (ev.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.gust)) landed = true;
      const inSlide = f.state()?.roar?.slides.some((sl) => sl.id === near.id) ?? false;
      if (inSlide) {
        sliding++;
        expect(s.movementOverrideActive).toBe(true);
        expect(near.auras.some((a) => a.id === BREATH_AURAS.thrown)).toBe(true);
        if (last >= 0 && s.movementOverrideEpoch !== last) bumpsWhileSliding++;
      }
      last = s.movementOverrideEpoch;
    }
    expect(sliding).toBeGreaterThan(ticks(T.roarSlide) / 2);
    // The first slide tick may bump (the throw begins); after it, none.
    expect(bumpsWhileSliding).toBeLessThanOrEqual(1);
    // Landed: the hold goes, the player steers again.
    expect(near.auras.some((a) => a.id === BREATH_AURAS.thrown)).toBe(false);
    expect(s.movementOverrideActive).toBe(false);
  });

  it('the throw says its rule', () => {
    const d = auraEffectDescriptor({ id: BREATH_AURAS.thrown, kind: 'root', value: 0 });
    expect(d).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}|hudChrome/);
  });
});
