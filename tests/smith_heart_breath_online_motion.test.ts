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
  cornicePads,
  ISLE_TUNING as IT,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT } from '../src/sim/types';
import { WIND_BLAST_AURA } from '../src/sim/wind_drift';
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
    b.hp = Math.floor(b.maxHp * 0.5) - 1;
    for (let i = 0; i < ticks(3) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
    const p = f.players[2];
    const s = sessionOf(f, p.id);
    const w = watch(f, s);
    w.tick();
    const e0 = s.movementOverrideEpoch;
    f.put(p, cornicePads()[0].x, cornicePads()[0].z);
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
    b.hp = Math.floor(b.maxHp * 0.5) - 1;
    for (let i = 0; i < ticks(3) && f.state()?.isles.stage !== 'nova'; i++) f.tick();
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
    f.put(p, cornicePads()[0].x, cornicePads()[0].z);
    w.tick();
    expect(p.carriedBy).toBeDefined();
    const startEpoch = s.movementOverrideEpoch;
    for (let k = 0; k < ticks(IT.rideSeconds) - 2; k++) {
      w.tick();
      expect(s.movementOverrideActive).toBe(true);
    }
    expect(s.movementOverrideEpoch).toBe(startEpoch);
  });

  it("the Summit Roar's blast is predicted: no override, no epoch edge, every step a wind's", () => {
    // The owner's call of 2026-11-17: the Roar's slid throw (a root the
    // override stood the client down for) read jerky online; its blast is the
    // shared kernel's wind (wind_drift.ts), stepped by both hosts.
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
    let blasted = 0;
    let last = -1;
    let bumps = 0;
    for (let k = 0; k < ticks(T.inhaleCast + T.gustCast + 5); k++) {
      if (!landed) f.put(near, C.x + 4, C.z);
      const before = s.movementOverrideEpoch;
      const ev = w.tick();
      if (ev.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.gust)) {
        landed = true;
        last = s.movementOverrideEpoch;
        continue;
      }
      if (!landed) continue;
      if (near.auras.some((a) => a.id === WIND_BLAST_AURA)) {
        blasted++;
        expect(s.movementOverrideActive).toBe(false);
        expect(near.auras.some((a) => a.id === BREATH_AURAS.thrown)).toBe(false);
        if (s.movementOverrideEpoch !== before) bumps++;
      }
    }
    expect(last).toBeGreaterThanOrEqual(0);
    expect(blasted).toBeGreaterThan(ticks(3));
    expect(bumps).toBe(0);
  });

  it('the throw says its rule', () => {
    const d = auraEffectDescriptor({ id: BREATH_AURAS.thrown, kind: 'root', value: 0 });
    expect(d).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}|hudChrome/);
  });
});
