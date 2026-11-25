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
import { BREATH, CORNICE_BRIDGE, CORNICE_LANDING } from '../src/sim/content/smith_heart_layout';
import {
  BREATH_AURAS,
  BREATH_CUES,
  cornicePads,
  ISLE_TUNING as IT,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { BRIDGE_TUNING } from '../src/sim/encounters/smith_heart/breath_bridge_ids';
import { DT } from '../src/sim/types';
import { WIND_BLAST_AURA, WIND_GUST_AURA } from '../src/sim/wind_drift';
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

  it('the Wind Bridge current holds the override the whole ride: one epoch edge, never one a tick', () => {
    const f = breathFight(1, 23);
    const p = f.players[0];
    f.put(p, CORNICE_LANDING.x, CORNICE_LANDING.z + 2);
    expect(f.dev('/dev heart breath reset')).toBe(true);
    f.tick(4);
    const s = sessionOf(f, p.id);
    const w = watch(f, s);
    w.tick();
    f.put(p, CORNICE_BRIDGE.landing.x, CORNICE_BRIDGE.landing.z);
    w.tick();
    expect(p.carriedBy).toBeDefined();
    const startEpoch = s.movementOverrideEpoch;
    for (let k = 0; k < ticks(BRIDGE_TUNING.rideSeconds) - 2; k++) {
      w.tick();
      expect(s.movementOverrideActive).toBe(true);
    }
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

  it("the Summit Roar's throw holds the override its whole slide: one epoch edge, never one a tick", () => {
    // Jose's playtest of 2026-11-25: the Roar throws again (the blast read as
    // a slow walk backwards). Its slide wears an unbreakable root, so the
    // server's override stays active through it: the online client stands
    // its prediction down once and draws the server's motion.
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
    let thrown = 0;
    let startEpoch = -1;
    for (let k = 0; k < ticks(T.inhaleCast + T.gustCast + 5); k++) {
      if (!landed) f.put(near, C.x + 4, C.z);
      const ev = w.tick();
      if (ev.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.gust)) landed = true;
      if (!landed) continue;
      expect(near.auras.some((a) => a.id === WIND_BLAST_AURA)).toBe(false);
      if (near.auras.some((a) => a.id === BREATH_AURAS.thrown)) {
        thrown++;
        expect(s.movementOverrideActive).toBe(true);
        if (startEpoch < 0) startEpoch = s.movementOverrideEpoch;
        expect(s.movementOverrideEpoch).toBe(startEpoch);
      }
    }
    expect(thrown).toBeGreaterThan(ticks(T.roarThrowSlide) - 3);
    expect(thrown).toBeLessThanOrEqual(ticks(T.roarThrowSlide) + 1);
  });

  it("the Roar's follow-through gust is predicted: no override, no epoch edge while it blows", () => {
    // Jose's call of 2026-11-25: the gust is the kernel's steady wind
    // (WIND_GUST_AURA), stepped by both hosts, so the client predicts it.
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
    let gusted = 0;
    let epoch = -1;
    for (let k = 0; k < ticks(T.inhaleCast + T.gustCast + T.roarThrowSlide + 5); k++) {
      if (!landed) f.put(near, C.x + 4, C.z);
      const ev = w.tick();
      if (ev.some((e) => e.type === 'spellfx' && e.ability === BREATH_CUES.gust)) landed = true;
      if (!landed || !near.auras.some((a) => a.id === WIND_GUST_AURA)) continue;
      gusted++;
      expect(s.movementOverrideActive).toBe(false);
      if (epoch < 0) epoch = s.movementOverrideEpoch;
      expect(s.movementOverrideEpoch).toBe(epoch);
    }
    expect(gusted).toBeGreaterThan(ticks(1));
  });

  it('the throw says its rule', () => {
    const d = auraEffectDescriptor({ id: BREATH_AURAS.thrown, kind: 'root', value: 0 });
    expect(d).not.toBeNull();
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}|hudChrome/);
  });
});
