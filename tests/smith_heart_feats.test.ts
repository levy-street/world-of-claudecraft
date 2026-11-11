// The Smith's Heart's encounter feats over REAL Sims (src/sim/encounters/smith_heart/
// feats.ts on the fight helpers): each boss's rule met and broken through the fight's own
// code path, the grant landing on every player in the claim, and the meta that crowns the
// five (content/deeds.ts, content/smith_heart_rewards.ts).

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { CORNICE_GAPS, HAMMER_PIT } from '../src/sim/content/smith_heart_layout';
import {
  SMITH_HEART_FEAT_DEEDS,
  SMITH_HEART_FEAT_ORDER,
  SMITH_HEART_META_DEED,
} from '../src/sim/content/smith_heart_rewards';
import { COUNCIL_CASTS, COUNCIL_TUNING as T } from '../src/sim/encounters/smith_heart';
import { raisePillar } from '../src/sim/encounters/smith_heart/council_pillars';
import type { CouncilFightState } from '../src/sim/encounters/smith_heart/council_state';
import { smithHeartFeatMet } from '../src/sim/encounters/smith_heart/feats';
import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { breathFight } from './helpers/breath_fight';
import { type CouncilFight, councilFight } from './helpers/council_fight';
import { finalFight } from './helpers/final_fight';
import { heatFight } from './helpers/heat_fight';
import { quenchFight } from './helpers/quench_fight';

const sec = (s: number) => Math.ceil(s * 20);

function earned(sim: Sim, pids: readonly number[], deedId: string): boolean[] {
  return pids.map((pid) => sim.meta(pid)?.deedsEarned.has(deedId) ?? false);
}

/** The boss falls through the ordinary death path; its coordinator settles the feat. */
function fell(sim: Sim, boss: Entity, killer: Entity): void {
  sim.ctx.handleDeath(boss, killer);
}

// ---- the Hammer Council ----------------------------------------------------------------------

type Fight = CouncilFight & { st: CouncilFightState };

function councilPulled(n = 4): Fight {
  const f = councilFight(n, 17);
  f.dev('/dev heart council pull');
  f.tick();
  const st = f.state();
  if (!st) throw new Error('the council did not pull');
  st.weightTimer = 999;
  st.wakeTimer = 999;
  st.rockTimer = 999;
  st.boltTimer = 999;
  st.songTimer = 999;
  st.rushTimer = 999;
  st.pulseTimer = 999;
  st.songDue = null;
  st.energy = 0;
  return { ...f, st };
}

function plant(f: CouncilFight, e: Entity, x: number, z: number): void {
  const w = f.world(x, z);
  e.pos.x = w.x;
  e.pos.z = w.z;
  e.pos.y = f.sim.ctx.groundPos(w.x, w.z).y;
  e.prevPos = { ...e.pos };
  f.sim.ctx.rebucket(e);
}

/** One Rush with no columns standing: `aimAtCurse` puts the marked player just past the
 *  cursed pillar (it shatters), else on the far side of the middle (a miss). */
function runOneRush(f: Fight, aimAtCurse: boolean): void {
  const b = f.bodies();
  const g = b.guardian as Entity;
  const singer = b.singer as Entity;
  for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
  f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
  plant(f, g, HAMMER_PIT.x, HAMMER_PIT.z);
  plant(f, singer, HAMMER_PIT.x - 30, HAMMER_PIT.z + 25);
  f.players.forEach((p, i) => {
    f.put(p, HAMMER_PIT.x + 2 + i * 0.3, HAMMER_PIT.z + 3);
  });
  expect(f.dev('/dev heart council rush')).toBe(true);
  expect(g.castingAbility).toBe(COUNCIL_CASTS.rush);
  const target = f.sim.ctx.entities.get(g.castTargetId as number) as Entity;
  const cp = f.pillars().find((p) => p.cursed);
  if (!cp) throw new Error('no cursed pillar');
  const at = f.local(cp.e);
  const from = { x: HAMMER_PIT.x, z: HAMMER_PIT.z };
  const d = Math.hypot(at.x - from.x, at.z - from.z);
  const dir = { x: (at.x - from.x) / d, z: (at.z - from.z) / d };
  const k = aimAtCurse ? d + T.cursedR + 4 : -14;
  f.put(target, from.x + dir.x * k, from.z + dir.z * k);
  f.tick(sec(T.rushCast + T.rushWindup + 2));
}

describe("the Hammer Council's feat: Charge Through the Curse", () => {
  it('every Rush shattering the cursed pillar earns it for the whole claim at the fall', () => {
    const f = councilPulled(4);
    runOneRush(f, true);
    expect(f.st.feat?.count).toBe(1);
    expect(f.st.feat?.broken).toBe(false);
    const b = f.bodies();
    fell(f.sim, b.guardian as Entity, f.players[0]);
    fell(f.sim, b.singer as Entity, f.players[0]);
    f.tick(3);
    expect(f.state()?.finished).toBe(true);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.hammer_council)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('one Rush that misses the cursed pillar breaks it for the pull', () => {
    const f = councilPulled(4);
    runOneRush(f, true);
    // The broken curse stuns the Guardian; the next Rush comes once he stands again.
    f.tick(sec(T.rushStunSeconds + 1));
    runOneRush(f, false);
    expect(f.st.feat?.count).toBe(1);
    expect(f.st.feat?.broken).toBe(true);
    const b = f.bodies();
    fell(f.sim, b.guardian as Entity, f.players[0]);
    fell(f.sim, b.singer as Entity, f.players[0]);
    f.tick(3);
    expect(f.state()?.finished).toBe(true);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.hammer_council)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('a Rush stopped by an uncursed pillar (it is taken whole) breaks it too', () => {
    const f = councilPulled(4);
    const b = f.bodies();
    const g = b.guardian as Entity;
    for (const p of f.pillars()) f.sim.ctx.dropEntity(p.e.id);
    f.inst.objectIds = f.inst.objectIds.filter((id) => f.sim.ctx.entities.has(id));
    plant(f, g, HAMMER_PIT.x, HAMMER_PIT.z);
    plant(f, b.singer as Entity, HAMMER_PIT.x - 30, HAMMER_PIT.z + 25);
    f.players.forEach((p, i) => {
      f.put(p, HAMMER_PIT.x + 2 + i * 0.3, HAMMER_PIT.z + 3);
    });
    expect(f.dev('/dev heart council rush')).toBe(true);
    const target = f.sim.ctx.entities.get(g.castTargetId as number) as Entity;
    const cp = f.pillars().find((p) => p.cursed);
    if (!cp) throw new Error('no cursed pillar');
    const at = f.local(cp.e);
    const d = Math.hypot(at.x - HAMMER_PIT.x, at.z - HAMMER_PIT.z);
    const dir = { x: (at.x - HAMMER_PIT.x) / d, z: (at.z - HAMMER_PIT.z) / d };
    f.put(
      target,
      HAMMER_PIT.x + dir.x * (d + T.cursedR + 4),
      HAMMER_PIT.z + dir.z * (d + T.cursedR + 4),
    );
    const half = { x: (HAMMER_PIT.x + at.x) / 2, z: (HAMMER_PIT.z + at.z) / 2 };
    expect(raisePillar(f.sim.ctx, f.inst, g, [g], [], half.x, half.z, 1)).not.toBeNull();
    f.tick(sec(T.rushCast + T.rushWindup + 2));
    expect(f.pillars().some((p) => p.cursed)).toBe(true);
    expect(f.st.feat?.broken).toBe(true);
  });

  it('a kill with no Rush landed proves nothing (a dev kill earns no feat)', () => {
    const f = councilPulled(2);
    const b = f.bodies();
    fell(f.sim, b.guardian as Entity, f.players[0]);
    fell(f.sim, b.singer as Entity, f.players[0]);
    f.tick(3);
    expect(f.state()?.finished).toBe(true);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.hammer_council)).toEqual([false, false]);
  });
});

describe('the feat roster', () => {
  it('credits every player in the claim, a dead one too, and nobody outside it', () => {
    const f = councilPulled(4);
    runOneRush(f, true);
    const dead = f.players[2];
    const away = f.players[3];
    f.sim.ctx.dealDamage(null, dead, dead.hp + 1e6, false, 'physical', 'Test', 'hit', true);
    expect(dead.dead).toBe(true);
    // Out of the claim: back on the overworld, far from the instance band.
    away.pos.x = 0;
    away.pos.z = 0;
    away.prevPos = { ...away.pos };
    f.sim.ctx.rebucket(away);
    const b = f.bodies();
    fell(f.sim, b.guardian as Entity, f.players[0]);
    fell(f.sim, b.singer as Entity, f.players[0]);
    f.sim.tick();
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.hammer_council)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

// ---- the Breath ------------------------------------------------------------------------------

describe("the Breath's feat: Keep Your Feet", () => {
  function pulled() {
    const f = breathFight(3, 23);
    expect(f.dev('/dev heart breath pull')).toBe(true);
    f.tick(2);
    return f;
  }

  it('the storm broken and nobody lost to the void earns it', () => {
    const f = pulled();
    f.dev('/dev heart breath storm');
    f.tick(2);
    expect(f.state()?.half).not.toBe('wind');
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.breath)).toEqual([true, true, true]);
  });

  it('a raider fallen into the void mid-fight breaks it', () => {
    const f = pulled();
    // The void test's own walk (tests/smith_heart_breath_void.test.ts): out over a gap's lip.
    const lost = f.players[2];
    const gap = CORNICE_GAPS[0];
    const a = (gap.deg * Math.PI) / 180;
    f.put(lost, gap.x - Math.sin(a) * 4, gap.z - Math.cos(a) * 4);
    lost.facing = a;
    const meta = f.sim.players.get(lost.id);
    if (!meta) throw new Error('meta');
    meta.moveInput.forward = true;
    for (let i = 0; i < sec(15) && !lost.dead; i++) f.tick(1, false);
    meta.moveInput.forward = false;
    expect(lost.dead).toBe(true);
    expect(f.state()?.feat?.broken).toBe(true);
    f.dev('/dev heart breath storm');
    f.tick(2);
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.breath)).toEqual([false, false, false]);
  });

  it('a game master set back from the void is no fall: the feat holds', () => {
    const f = pulled();
    const gm = f.players[2];
    gm.gm = true;
    const gap = CORNICE_GAPS[0];
    const a = (gap.deg * Math.PI) / 180;
    f.put(gm, gap.x - Math.sin(a) * 4, gap.z - Math.cos(a) * 4);
    gm.facing = a;
    const meta = f.sim.players.get(gm.id);
    if (!meta) throw new Error('meta');
    meta.moveInput.forward = true;
    f.tick(sec(6), false);
    meta.moveInput.forward = false;
    expect(gm.dead).toBe(false);
    expect(f.state()?.feat?.broken ?? false).toBe(false);
  });

  it('a kill before the storm broke proves nothing', () => {
    const f = pulled();
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.breath)).toEqual([false, false, false]);
  });
});

// ---- the Quench ------------------------------------------------------------------------------

describe("the Quench's feat: No One Left in the Cold", () => {
  function pulled() {
    const f = quenchFight(3, 29);
    expect(f.dev('/dev heart quench pull')).toBe(true);
    f.tick(sec(3));
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.breathTimer = 999;
    return f;
  }

  it('the second half fought with nobody frozen earns it', () => {
    const f = pulled();
    f.dev('/dev heart quench phase2');
    f.tick(2);
    expect(f.state()?.half).not.toBe('lake');
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.quench)).toEqual([true, true, true]);
  });

  it('a kill in the first half proves nothing', () => {
    const f = pulled();
    expect(f.state()?.half).toBe('lake');
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.quench)).toEqual([false, false, false]);
  });

  it('one raider Encased in Rime breaks it', () => {
    const f = pulled();
    f.dev('/dev heart quench freeze', f.players[1].id);
    expect(f.state()?.feat?.broken).toBe(true);
    f.dev('/dev heart quench phase2');
    f.tick(2);
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.quench)).toEqual([false, false, false]);
  });
});

// ---- the Heat --------------------------------------------------------------------------------

describe("the Heat's feat: Turn Back the Cinders", () => {
  function pulled() {
    const f = heatFight(3, 31);
    expect(f.dev('/dev heart heat pull')).toBe(true);
    f.boss().threat.set(f.players[0].id, 1e6);
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.fistTimer = 999;
    st.flareTimer = 999;
    st.seedTimer = 999;
    st.zoneTimer = 999;
    st.cinderTimer = 999;
    f.dev('/dev heart heat phase 3');
    const st3 = f.state();
    if (st3) {
      st3.fistTimer = 999;
      st3.zoneTimer = 999;
      st3.cinderTimer = 999;
    }
    return f;
  }

  it('a Rolling Cinder called and none reaching its quarry earns it', () => {
    const f = pulled();
    f.dev('/dev heart heat cinder');
    expect(f.state()?.cindersCalled).toBeGreaterThanOrEqual(1);
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.heat)).toEqual([true, true, true]);
  });

  it('a kill before any Rolling Cinder was called proves nothing', () => {
    const f = pulled();
    expect(f.state()?.cindersCalled).toBe(0);
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.heat)).toEqual([false, false, false]);
  });

  it('a cinder that reaches its quarry breaks it', () => {
    const f = pulled();
    f.dev('/dev heart heat cinder');
    f.tick(sec(3));
    const st = f.state();
    const c = st?.cinders[0];
    expect(c).toBeDefined();
    const cinder = f.sim.ctx.entities.get(c?.id as number) as Entity;
    const quarry = f.sim.ctx.entities.get(c?.quarry as number) as Entity;
    for (let i = 0; i < sec(10) && !st?.feat?.broken; i++) {
      quarry.pos.x = cinder.pos.x;
      quarry.pos.z = cinder.pos.z;
      f.sim.ctx.rebucket(quarry);
      f.tick(1);
    }
    expect(f.state()?.feat?.broken).toBe(true);
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.heat)).toEqual([false, false, false]);
  });
});

// ---- the Masterless Strength ----------------------------------------------------------------

describe("the Masterless Strength's feat: Kept From the Brim", () => {
  function pulled() {
    const f = finalFight(3, 41);
    f.pullIn('heat');
    f.tick(2);
    return f;
  }

  it('both intermissions fought and no bar burst earns it', () => {
    const f = pulled();
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.phase.intermissions = 2;
    expect(st.bursts).toBe(0);
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.masterless)).toEqual([true, true, true]);
  });

  it('one Overload Burst breaks it', () => {
    const f = pulled();
    f.dev('/dev heart final burst');
    f.tick(1);
    const st = f.state();
    if (!st) throw new Error('no fight');
    expect(st.bursts).toBeGreaterThanOrEqual(1);
    st.phase.intermissions = 2;
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.masterless)).toEqual([false, false, false]);
  });

  it('a kill short of both intermissions proves nothing', () => {
    const f = pulled();
    fell(f.sim, f.boss(), f.players[0]);
    f.tick(3);
    expect(earned(f.sim, f.pids, SMITH_HEART_FEAT_DEEDS.masterless)).toEqual([false, false, false]);
  });
});

// ---- the rules and the meta -----------------------------------------------------------------

describe('the feat rules and the meta', () => {
  it('the encounter-to-deed ids are frozen literals', () => {
    expect(SMITH_HEART_FEAT_DEEDS).toEqual({
      hammer_council: 'dgn_heart_council_feat',
      breath: 'dgn_heart_breath_feat',
      quench: 'dgn_heart_quench_feat',
      heat: 'dgn_heart_heat_feat',
      masterless: 'dgn_heart_final_feat',
    });
  });

  it('a broken watch never passes, whatever else the pull did', () => {
    const broken = { broken: true, count: 9 };
    expect(
      smithHeartFeatMet({
        encounter: 'hammer_council',
        st: { feat: broken } as unknown as CouncilFightState,
      }),
    ).toBe(false);
  });

  it('the meta asks exactly the five feats and grants itself once all five are earned', () => {
    const meta = DEEDS[SMITH_HEART_META_DEED];
    expect(meta.trigger).toEqual({
      kind: 'meta',
      deedIds: SMITH_HEART_FEAT_ORDER.map((e) => SMITH_HEART_FEAT_DEEDS[e]),
    });
    const f = finalFight(1, 41);
    const pid = f.pids[0];
    const m = f.sim.meta(pid);
    if (!m) throw new Error('no meta');
    for (const e of SMITH_HEART_FEAT_ORDER.slice(0, 4))
      f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS[e]);
    f.tick(2);
    expect(m.deedsEarned.has(SMITH_HEART_META_DEED)).toBe(false);
    f.sim.ctx.grantDeed(m, SMITH_HEART_FEAT_DEEDS.masterless);
    f.tick(2);
    expect(m.deedsEarned.has(SMITH_HEART_META_DEED)).toBe(true);
  });
});
