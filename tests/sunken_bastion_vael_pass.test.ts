// Vael the Fogbinder's encounter pass (src/sim/encounters/sunken_bastion:
// vael_intro.ts, vael_shadowstep.ts, vael_veil_gather.ts, vael.ts): his
// entrance (buried, rising and speaking round the Fogbeacon, untouchable, and
// only attackable at his place; the short entrance after a wipe), the Shadow
// Crossing as a chain of three steps on three different players, the fog
// gathering before the veil, and the beam's tells the HUD and every client read.

import { describe, expect, it, vi } from 'vitest';
import { SUNKEN_BASTION_SPAWNS } from '../src/sim/content/sunken_bastion';
import {
  CROWN,
  FOG_SHADE_ID,
  inBeam,
  OSSICK_ID,
  REAPER_POOL_TEMPLATE,
  TURNKEY_ID,
  VAEL_BEACON_LIT,
  VAEL_HOME,
  VAEL_HYMN_DROWNING,
  VAEL_ID,
  VAEL_INTRO_LINES,
  VAEL_INTRO_RISE,
  VAEL_INTRO_STOPS,
  VAEL_REAP_MARK,
  VAEL_RETURN_LINE,
  VAEL_SHADE_HOLLOW,
  VAEL_SHADOWSTEP,
  VAEL_SHROUDED,
  VAEL_SINK,
  VAEL_TUNING,
  VAEL_VEIL_GATHER,
  VAEL_VEIL_LINES,
  VAEL_VEIL_RISE,
  VAEL_VEIL_TRANSITION_SECONDS,
  vaelIntroSeconds,
} from '../src/sim/encounters/sunken_bastion';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { aura, boss, engage, type Fight, fight, put, run } from './helpers/bastion_fight';

vi.setConfig({ testTimeout: 60_000 });

const T = VAEL_TUNING;

/** Every Vael yell since the fight began, with the sim time it landed. */
interface Said {
  text: string;
  at: number;
}

function stepCollect(f: Fight, said: Said[], keep: () => void = () => {}): SimEvent[] {
  for (const p of [f.tank, ...f.others]) if (p.hp < 1e5 && !p.dead) p.hp = 1e6;
  keep();
  const evs = f.sim.tick();
  for (const ev of evs) {
    if (ev.type === 'damage')
      f.hits.push({ targetId: ev.targetId, amount: ev.amount, ability: ev.ability });
    if (ev.type === 'chat' && ev.channel === 'yell' && ev.entityId !== undefined) {
      const e = f.sim.ctx.entities.get(ev.entityId);
      if (
        e?.templateId === VAEL_ID &&
        !said.some((s) => s.text === ev.text && s.at === f.sim.ctx.time)
      )
        said.push({ text: ev.text, at: f.sim.ctx.time });
    }
  }
  return evs;
}

/** A Bastion with Vael alone on the roof (the gaol's bosses slain so they never
 *  join a pull), the party standing on the Keep Court below the crown. */
function court(extra = 3): Fight {
  const f = fight('normal', extra);
  for (const id of [OSSICK_ID, TURNKEY_ID]) f.sim.ctx.handleDeath(boss(f, id), f.tank);
  for (const [i, p] of [f.tank, ...f.others].entries()) put(f, p, -54 + i * 2, 160);
  return f;
}

function local(f: Fight, e: Entity): { x: number; z: number } {
  return { x: e.pos.x - f.ox, z: e.pos.z - f.oz };
}

// ---------------------------------------------------------------------------
describe('Vael: the entrance on the Beacon Crown', () => {
  it('lies buried and untouchable until a player climbs onto the crown', () => {
    const f = court();
    const vael = boss(f, VAEL_ID);
    const said: Said[] = [];
    for (let i = 0; i < 40; i++) stepCollect(f, said);
    expect(vael.vaelIntro?.phase).toBe('buried');
    expect(vael.hostile).toBe(false);
    expect(vael.damageImmune).toBe(true);
    expect(aura(vael, VAEL_SHROUDED)).toBeDefined();
    const floor = f.sim.ctx.groundPos(vael.pos.x, vael.pos.z).y;
    expect(vael.pos.y).toBeLessThan(floor - 10);
    expect(said).toHaveLength(0);
  });

  it('rises and speaks round the Fogbeacon untouchable, then becomes attackable only at his place', () => {
    const f = court();
    const vael = boss(f, VAEL_ID);
    const said: Said[] = [];
    for (let i = 0; i < 10; i++) stepCollect(f, said);
    // The tank climbs the crown stair onto the roof.
    put(f, f.tank, -14, 190);
    const start = f.sim.ctx.time;
    const rises: { x: number; z: number }[] = [];
    let attackableEarly = false;
    let hpLost = false;
    for (let t = 0; t < vaelIntroSeconds(false) + 2 && vael.vaelIntro?.phase !== 'done'; t += DT) {
      const before = vael.hp;
      if (vael.vaelIntro?.phase === 'playing') {
        // Strike him every tick of the entrance: nothing lands.
        f.sim.dealDamage(f.tank, vael, 5000, false, 'physical', 'Strike', 'hit', false);
        if (vael.hp < before) hpLost = true;
        if (vael.hostile || !vael.damageImmune || vael.inCombat) attackableEarly = true;
      }
      const was = vael.castingAbility;
      stepCollect(f, said, () => put(f, f.tank, -14, 190));
      if (vael.castingAbility === VAEL_INTRO_RISE && was !== VAEL_INTRO_RISE)
        rises.push(local(f, vael));
    }
    const took = f.sim.ctx.time - start;
    expect(attackableEarly).toBe(false);
    expect(hpLost).toBe(false);
    // Four rises: three round the beacon, then his place, each a different spot.
    expect(rises).toHaveLength(VAEL_INTRO_STOPS.length);
    for (let i = 0; i < rises.length; i++) {
      expect(
        Math.hypot(rises[i].x - VAEL_INTRO_STOPS[i].x, rises[i].z - VAEL_INTRO_STOPS[i].z),
      ).toBeLessThan(0.5);
      for (let j = 0; j < i; j++)
        expect(Math.hypot(rises[i].x - rises[j].x, rises[i].z - rises[j].z)).toBeGreaterThan(8);
    }
    for (const r of rises.slice(0, -1)) {
      const d = Math.hypot(r.x - CROWN.x, r.z - CROWN.z);
      expect(d).toBeGreaterThan(8);
      expect(d).toBeLessThan(CROWN.r - 4);
    }
    // Four lines, in order, once each.
    expect(said.map((s) => s.text)).toEqual([...VAEL_INTRO_LINES]);
    // Short: 10 to 15 seconds.
    expect(took).toBeGreaterThanOrEqual(10);
    expect(took).toBeLessThanOrEqual(15.5);
    expect(took).toBeCloseTo(vaelIntroSeconds(false), 0);
    // At his place he is handed back: hostile, touchable, standing on the flags.
    const at = local(f, vael);
    expect(Math.hypot(at.x - VAEL_HOME.x, at.z - VAEL_HOME.z)).toBeLessThan(0.5);
    expect(vael.hostile).toBe(true);
    expect(vael.damageImmune).toBe(false);
    expect(vael.encounterHeld).toBe(false);
    expect(aura(vael, VAEL_SHROUDED)).toBeUndefined();
    const floor = f.sim.ctx.groundPos(vael.pos.x, vael.pos.z).y;
    expect(Math.abs(vael.pos.y - floor)).toBeLessThan(0.2);
    const hp = vael.hp;
    f.sim.dealDamage(f.tank, vael, 100, false, 'physical', 'Strike', 'hit', false);
    expect(vael.hp).toBeLessThan(hp);
  });

  it('after a wipe the next climb plays only the short entrance: one rise at his place, one line', () => {
    const f = court(1);
    const vael = boss(f, VAEL_ID);
    const said: Said[] = [];
    for (let i = 0; i < 5; i++) stepCollect(f, said);
    put(f, f.tank, -14, 190);
    for (let t = 0; t < vaelIntroSeconds(false) + 1; t += DT) stepCollect(f, said);
    expect(vael.vaelIntro?.phase).toBe('done');
    // The pull, then the wipe: everyone falls on the roof.
    engage(f, vael);
    run(f, 2);
    for (const p of [f.tank, ...f.others]) f.sim.ctx.handleDeath(p, vael);
    let buried = false;
    for (let t = 0; t < 60 && !buried; t += DT) {
      f.sim.tick();
      buried = vael.vaelIntro?.phase === 'buried';
    }
    expect(buried).toBe(true);
    expect(vael.vaelIntro?.short).toBe(true);
    expect(vael.hostile).toBe(false);
    expect(vael.hp).toBe(vael.maxHp);
    // The group comes back up.
    for (const p of [f.tank, ...f.others]) {
      p.dead = false;
      p.ghost = false;
      p.hp = 1e6;
    }
    put(f, f.tank, -14, 190);
    put(f, f.others[0], -16, 188);
    said.length = 0;
    const start = f.sim.ctx.time;
    let rises = 0;
    for (let t = 0; t < 6 && vael.vaelIntro?.phase !== 'done'; t += DT) {
      const was = vael.castingAbility;
      stepCollect(f, said, () => put(f, f.tank, -14, 190));
      if (vael.castingAbility === VAEL_INTRO_RISE && was !== VAEL_INTRO_RISE) rises++;
    }
    expect(rises).toBe(1);
    expect(said.map((s) => s.text)).toEqual([VAEL_RETURN_LINE]);
    expect(f.sim.ctx.time - start).toBeLessThan(vaelIntroSeconds(true) + 0.5);
    const at = local(f, vael);
    expect(Math.hypot(at.x - VAEL_HOME.x, at.z - VAEL_HOME.z)).toBeLessThan(0.5);
    expect(vael.hostile).toBe(true);
  });

  it('a brief loss of his target mid-fight never buries him again', () => {
    const f = court();
    const vael = boss(f, VAEL_ID);
    put(f, f.tank, -14, 190);
    for (let t = 0; t < vaelIntroSeconds(false) + 1; t += DT) stepCollect(f, []);
    expect(vael.vaelIntro?.phase).toBe('done');
    engage(f, vael);
    run(f, 1);
    vael.aggroTargetId = null;
    run(f, DT);
    f.sim.ctx.aggroMob(vael, f.tank, false);
    run(f, 3);
    expect(vael.vaelIntro?.phase).toBe('done');
    expect(vael.hostile).toBe(true);
    expect(vael.encounterHeld).toBeFalsy();
  });

  it('pulled before he ever woke (a dev jump into the fight), he skips the entrance', () => {
    const f = court();
    const vael = boss(f, VAEL_ID);
    put(f, vael, VAEL_HOME.x, VAEL_HOME.z);
    put(f, f.tank, VAEL_HOME.x, VAEL_HOME.z - 3);
    engage(f, vael);
    run(f, 1);
    expect(vael.vaelIntro?.phase).toBe('done');
    expect(vael.hostile).toBe(true);
    expect(vael.inCombat).toBe(true);
  });

  it('his home is his spawn on the crown', () => {
    const spawn = SUNKEN_BASTION_SPAWNS.find((s) => s.mobId === VAEL_ID);
    expect(spawn?.x).toBe(VAEL_HOME.x);
    expect(spawn?.z).toBe(VAEL_HOME.z);
    expect(VAEL_INTRO_STOPS[VAEL_INTRO_STOPS.length - 1]).toEqual(VAEL_HOME);
  });
});

// ---------------------------------------------------------------------------
describe('Vael: the Shadow Crossing, three times on three different players', () => {
  function roof(extra = 3): { f: Fight; vael: Entity } {
    const f = court(extra);
    const vael = boss(f, VAEL_ID);
    put(f, vael, VAEL_HOME.x, VAEL_HOME.z);
    put(f, f.tank, VAEL_HOME.x, VAEL_HOME.z - 3);
    const spots = [
      [8, 218],
      [-16, 196],
      [10, 200],
    ];
    for (const [i, p] of f.others.entries()) put(f, p, spots[i][0], spots[i][1]);
    engage(f, vael);
    return { f, vael };
  }

  function still(f: Fight): () => void {
    const hold = [f.tank, ...f.others].map((p) => [p, local(f, p)] as const);
    return () => {
      for (const [p, at] of hold) {
        put(f, p, at.x, at.z);
        p.facing = 0;
      }
    };
  }

  /** Run one whole chain from its first sink; per step: the mark, the pool's
   *  spot and when it showed, and when the scythe landed. */
  function chain(f: Fight, vael: Entity) {
    const keep = still(f);
    const steps: {
      mark: number;
      pool: { x: number; z: number };
      poolAt: number;
      sweepAt: number;
    }[] = [];
    const said: Said[] = [];
    let open: (typeof steps)[number] | null = null;
    let sinks = 0;
    const from = f.hits.length;
    for (let t = 0; t < T.reapFirst + 20; t += DT) {
      const was = vael.castingAbility;
      stepCollect(f, said, keep);
      if (vael.castingAbility === VAEL_SHADOWSTEP && was !== VAEL_SHADOWSTEP) sinks++;
      const pool = [...f.sim.ctx.entities.values()].find(
        (e) => e.templateId === REAPER_POOL_TEMPLATE,
      );
      if (pool && !open) {
        const mark = [f.tank, ...f.others].find((p) => aura(p, VAEL_REAP_MARK));
        open = { mark: mark?.id ?? -1, pool: local(f, pool), poolAt: f.sim.ctx.time, sweepAt: -1 };
        steps.push(open);
      }
      if (!pool && open) {
        open.sweepAt = f.sim.ctx.time;
        open = null;
      }
      const st = vael.bastionFight;
      if (sinks > 0 && st?.kind === 'vael' && !st.reap && !open) break;
    }
    return { steps, sinks, from };
  }

  it('one chain is three steps, each behind a different player, never the tank while others stand', () => {
    const { f, vael } = roof();
    const { steps, sinks, from } = chain(f, vael);
    expect(sinks).toBe(T.reapChain);
    expect(steps).toHaveLength(3);
    const marks = steps.map((s) => s.mark);
    expect(new Set(marks).size).toBe(3);
    expect(marks).not.toContain(f.tank.id);
    for (const s of steps) {
      const mark = f.sim.ctx.entities.get(s.mark) as Entity;
      // The same readable telegraph every step: the pool behind the mark for
      // the whole warning before the blade lands.
      const at = local(f, mark);
      expect(Math.hypot(s.pool.x - at.x, s.pool.z - at.z)).toBeCloseTo(T.behind, 1);
      expect(s.pool.z).toBeLessThan(at.z);
      expect(s.sweepAt - s.poolAt).toBeGreaterThanOrEqual(T.poolSeconds + T.riseSeconds - DT * 1.5);
    }
    // The steps run back to back: sink, pool, rise, sweep, follow-through.
    const stepSeconds = T.vanishSeconds + T.poolSeconds + T.riseSeconds + T.reapRecover;
    for (let i = 1; i < steps.length; i++)
      expect(steps[i].poolAt - steps[i - 1].poolAt).toBeCloseTo(stepSeconds, 1);
    // Standing still in every arc, each mark took exactly one sweep in range.
    for (const s of steps) {
      let n = 0;
      for (let i = from; i < f.hits.length; i++) {
        const h = f.hits[i];
        if (h.targetId !== s.mark || h.ability !== 'Reaping Scythe') continue;
        n++;
        expect(h.amount).toBeGreaterThanOrEqual(T.sweepMin);
        expect(h.amount).toBeLessThanOrEqual(T.sweepMax);
      }
      expect(n).toBeGreaterThanOrEqual(1);
    }
    expect(vael.damageImmune).toBe(false);
  });

  it('he is touchable when he rises and in the follow-through, never while under the floor', () => {
    const { f, vael } = roof();
    const keep = still(f);
    const seen = { underHit: false, riseHit: false, recoverHit: false };
    for (let t = 0; t < T.reapFirst + 14; t += DT) {
      const st = vael.bastionFight;
      const phase = st?.kind === 'vael' ? st.reap?.phase : undefined;
      if (phase) {
        const hp = vael.hp;
        f.sim.dealDamage(f.tank, vael, 10, false, 'physical', 'Strike', 'hit', false);
        const hit = vael.hp < hp;
        if ((phase === 'vanish' || phase === 'pool') && hit) seen.underHit = true;
        if (phase === 'rise' && hit) seen.riseHit = true;
        if (phase === 'recover' && hit) seen.recoverHit = true;
      }
      stepCollect(f, [], keep);
    }
    expect(seen.underHit).toBe(false);
    expect(seen.riseHit).toBe(true);
    expect(seen.recoverHit).toBe(true);
  });

  it('a group of two gets a chain of two (the other first, then the tank); alone, one step', () => {
    for (const [extra, want] of [
      [1, 2],
      [0, 1],
    ] as const) {
      const { f, vael } = roof(extra);
      const { steps } = chain(f, vael);
      expect(steps).toHaveLength(want);
      expect(new Set(steps.map((s) => s.mark)).size).toBe(want);
      if (extra === 1) {
        expect(steps[0].mark).toBe(f.others[0].id);
        expect(steps[1].mark).toBe(f.tank.id);
      }
    }
  });

  it('the next chain comes 20 s of open fight after the last one ends (about 33 s a cycle)', () => {
    const { f, vael } = roof();
    const keep = still(f);
    const starts: number[] = [];
    const ends: number[] = [];
    for (let t = 0; t < T.reapFirst + 40; t += DT) {
      const st = vael.bastionFight;
      const before = st?.kind === 'vael' ? st.reaps : 0;
      const busy = st?.kind === 'vael' && st.reap !== null;
      stepCollect(f, [], keep);
      const after = vael.bastionFight;
      if (after?.kind === 'vael' && after.reaps > before) starts.push(f.sim.ctx.time);
      if (busy && after?.kind === 'vael' && after.reap === null) ends.push(f.sim.ctx.time);
    }
    expect(starts.length).toBeGreaterThanOrEqual(2);
    const chainSeconds = 3 * (T.vanishSeconds + T.poolSeconds + T.riseSeconds + T.reapRecover);
    expect(ends[0] - starts[0]).toBeCloseTo(chainSeconds, 1);
    const gap = starts[1] - ends[0];
    // The countdown runs only in the open fight: Mist Surge bars stretch it.
    expect(gap).toBeGreaterThanOrEqual(T.reapEvery - DT);
    expect(gap).toBeLessThanOrEqual(T.reapEvery * (13.5 / 12) + T.surgeCast + 0.2);
  });
});

// ---------------------------------------------------------------------------
describe('Vael: the fog gathers before the veil, and the beam tells', () => {
  function roof(): { f: Fight; vael: Entity; said: Said[] } {
    const f = court(2);
    const vael = boss(f, VAEL_ID);
    put(f, vael, VAEL_HOME.x, VAEL_HOME.z);
    put(f, f.tank, VAEL_HOME.x, VAEL_HOME.z - 3);
    put(f, f.others[0], 8, 218);
    put(f, f.others[1], -16, 196);
    engage(f, vael);
    const said: Said[] = [];
    for (let i = 0; i < 10; i++) stepCollect(f, said);
    return { f, vael, said };
  }

  function shades(f: Fight): Entity[] {
    return [...f.sim.ctx.entities.values()].filter((e) => e.templateId === FOG_SHADE_ID && !e.dead);
  }

  it('at 70 percent: he stills and speaks the beacon warning, untouchable, sinks, then four rise', () => {
    const { f, vael, said } = roof();
    vael.hp = Math.round(vael.maxHp * 0.69);
    const hpAt = vael.hp;
    const order: { cast: string; at: number }[] = [];
    const start = f.sim.ctx.time;
    let struck = false;
    for (let t = 0; t < VAEL_VEIL_TRANSITION_SECONDS + 0.5; t += DT) {
      const was = vael.castingAbility;
      if (vael.castingAbility === VAEL_VEIL_GATHER || vael.castingAbility === VAEL_SINK) {
        // Struck while the fog gathers: nothing lands, so nothing breaks early.
        f.sim.dealDamage(
          f.tank,
          vael,
          Math.ceil(vael.maxHp * 0.06),
          false,
          'physical',
          'Strike',
          'hit',
          false,
        );
        if (vael.hp < hpAt) struck = true;
        expect(shades(f)).toHaveLength(0);
      }
      stepCollect(f, said);
      if (vael.castingAbility && vael.castingAbility !== was)
        order.push({ cast: vael.castingAbility, at: f.sim.ctx.time - start });
    }
    expect(struck).toBe(false);
    expect(order.map((o) => o.cast)).toEqual([
      VAEL_VEIL_GATHER,
      VAEL_SINK,
      VAEL_VEIL_RISE,
      'bastion_drowning_hymn',
    ]);
    expect(order[1].at - order[0].at).toBeCloseTo(T.veilGatherSeconds, 1);
    expect(order[2].at - order[1].at).toBeCloseTo(T.vanishSeconds, 1);
    expect(said.map((s) => s.text)).toEqual([VAEL_VEIL_LINES[0]]);
    // The line lands as the fog begins to gather (before any figure rises).
    expect(said[0].at - start).toBeLessThan(order[2].at);
    expect(shades(f)).toHaveLength(3);
    for (const s of shades(f)) expect(s.castingAbility).toBe('bastion_drowning_hymn');
  });

  it('the beam marks the figure it touches: the real one Beacon-Lit, a shade Hollow, a breath after', () => {
    const { f, vael } = roof();
    vael.hp = Math.round(vael.maxHp * 0.69);
    run(f, VAEL_VEIL_TRANSITION_SECONDS + DT * 2);
    const lamp = [...f.sim.ctx.entities.values()].find(
      (e) => e.templateId === 'bastion_beacon_lamp',
    ) as Entity;
    const figures = [vael, ...shades(f)];
    expect(figures).toHaveLength(4);
    const lit = new Set<number>();
    let wrong = 0;
    let missing = 0;
    let lingered = false;
    for (let t = 0; t < T.beamPeriod + 0.2; t += DT) {
      stepCollect(f, []);
      for (const e of figures) {
        const at = local(f, e);
        const tell = aura(e, e === vael ? VAEL_BEACON_LIT : VAEL_SHADE_HOLLOW);
        // The wrong tell never shows on anyone.
        if (aura(e, e === vael ? VAEL_SHADE_HOLLOW : VAEL_BEACON_LIT)) wrong++;
        if (inBeam(lamp.facing, at.x, at.z)) {
          lit.add(e.id);
          if (!tell) missing++;
        } else if (tell && lit.has(e.id)) lingered = true;
      }
    }
    expect(wrong).toBe(0);
    expect(missing).toBe(0);
    expect(lingered).toBe(true);
    // One sweep finds every figure.
    for (const e of figures) expect(lit.has(e.id)).toBe(true);
  });

  it('players on the crown carry the Drowning Hymn while it sings; it lifts with the veil', () => {
    const { f, vael } = roof();
    vael.hp = Math.round(vael.maxHp * 0.69);
    run(f, VAEL_VEIL_TRANSITION_SECONDS + 1.2);
    const mark = aura(f.others[0], VAEL_HYMN_DROWNING);
    expect(mark).toBeDefined();
    expect(mark?.remaining ?? 0).toBeLessThanOrEqual(T.hymnSeconds - 1);
    expect(mark?.remaining ?? 0).toBeGreaterThan(T.hymnSeconds - 4);
    // The real one is struck: the veil breaks and the mark lifts at once.
    f.sim.dealDamage(
      f.tank,
      vael,
      Math.ceil(vael.maxHp * 0.051),
      false,
      'physical',
      'Strike',
      'hit',
      true,
    );
    run(f, DT * 2);
    expect(aura(f.others[0], VAEL_HYMN_DROWNING)).toBeUndefined();
    expect(aura(vael, VAEL_BEACON_LIT)).toBeUndefined();
  });

  it('the second veil speaks the shorter reminder', () => {
    const { f, vael, said } = roof();
    vael.hp = Math.round(vael.maxHp * 0.69);
    run(f, VAEL_VEIL_TRANSITION_SECONDS + T.hymnSeconds + 1);
    vael.hp = Math.round(vael.maxHp * 0.39);
    for (let t = 0; t < T.veilGatherSeconds; t += DT) stepCollect(f, said);
    expect(said.map((s) => s.text)).toEqual([VAEL_VEIL_LINES[1]]);
  });
});
