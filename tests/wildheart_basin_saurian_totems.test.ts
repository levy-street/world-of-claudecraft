// The Great Saurian's totem rework (src/sim/encounters/wildheart_basin/
// great_saurian.ts and its siblings saurian_totems.ts and saurian_drum.ts):
// the howdah's rider fights from the pull, throwing Sunbone Sap Totems that
// mend the beast until the group breaks them; a broken totem's backlash hands
// the group its damage back; the howdah still breaks at half health; and on
// heroic a second rider's drum quickens the Stomp until a broken totem
// silences it. On a real claimed Basin with a real party.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { handleWildheartBasinDevChat } from '../src/sim/dev/wildheart_basin_dev';
import {
  drumBeating,
  GREAT_SAURIAN_ID,
  HOWDAH_HEXCALLER_ID,
  SAP_BACKLASH_NAME,
  SAP_HEAL_NAME,
  SAP_TOTEM_ID,
  SAURIAN_DEED,
  SAURIAN_DRUM_BEAT,
  SAURIAN_DRUM_SILENCED,
  SAURIAN_SAP_BACKLASH,
  SAURIAN_SAP_TETHER,
  SAURIAN_SAPPED,
  SAURIAN_STOMP,
  SAURIAN_TOTEM_LOG,
  SAURIAN_TOTEM_THROW,
  SAURIAN_WAR_DRUM,
  sapTotems,
  SAURIAN_TUNING as T,
  tickWildheartEncounters,
  WILDHEART_DEV_TRIGGERS,
} from '../src/sim/encounters/wildheart_basin';
import type { Entity, SaurianFightState, SimEvent } from '../src/sim/types';
import {
  aura,
  boss,
  earned,
  engage,
  type Fight,
  fight,
  hitsOn,
  live,
  put,
  run,
  tick,
  wipe,
} from './helpers/wildheart_fight';

/** The Saurian pulled in the middle of the ford, the tank at its side and the
 *  others out of every strike's reach. */
function pull(difficulty: 'normal' | 'heroic' = 'normal', extra = 3): { f: Fight; s: Entity } {
  const f = fight(difficulty, extra, 'mage', [GREAT_SAURIAN_ID]);
  const s = boss(f, GREAT_SAURIAN_ID);
  s.dungeonPatrol = undefined;
  put(f, s, -18, -109);
  put(f, f.tank, -18, -103);
  f.others.forEach((p, i) => {
    put(f, p, -44 - i * 2, -100);
  });
  engage(f, s, 1e6);
  tick(f);
  return { f, s };
}

function state(s: Entity): SaurianFightState {
  const st = s.wildheartFight;
  if (st?.kind !== 'saurian') throw new Error('no saurian fight');
  return st;
}

/** Heals the Saurian took since event index `from`, by ability name. */
interface Heal {
  amount: number;
  ability: string | null;
}

function watchHeals(f: Fight, s: Entity, seconds: number): Heal[] {
  const out: Heal[] = [];
  for (let t = 0; t < seconds - 0.025; t += 0.05) {
    for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
    for (const ev of f.sim.tick()) {
      if (ev.type === 'heal2' && ev.targetId === s.id)
        out.push({ amount: ev.amount, ability: ev.ability });
      else if (ev.type === 'spellfx' && ev.ability) f.fx.push(ev.ability);
      else if (ev.type === 'log' || ev.type === 'chat') f.lines.push(ev.text);
      else if (ev.type === 'damage')
        f.hits.push({
          sourceId: ev.sourceId,
          targetId: ev.targetId,
          amount: ev.amount,
          ability: ev.ability,
          kind: ev.kind,
          school: ev.school,
        });
    }
  }
  return out;
}

function count(f: Fight, ability: string): number {
  return f.fx.filter((a) => a === ability).length;
}

/** A player breaks a totem with one blow. */
function breakTotem(f: Fight, totem: Entity, by: Entity = f.tank): void {
  f.sim.ctx.dealDamage(by, totem, totem.hp + 50, false, 'holy', 'Test', 'hit', true);
}

/** Straight to the handler (the chat seam's rate limit would drop a burst),
 *  then one tick. */
function dev(f: Fight, line: string): void {
  handleWildheartBasinDevChat(f.sim.ctx, line, f.tank.id);
  tick(f);
}

describe('the Sunbone Sap Totem (the body)', () => {
  it('is a small, still, unfightable post a lone player breaks in a couple of global cooldowns', () => {
    const t = MOBS[SAP_TOTEM_ID];
    expect(t.name).toBe('Sunbone Sap Totem');
    expect(t.moveSpeed).toBe(0);
    expect(t.ccImmune).toBe(true);
    expect(t.loot).toEqual([]);
    expect(t.xpMult).toBe(0);
    expect(t.trashKit).toBeUndefined();
    // Drawn clearly past a player (the Sunbone Totem's post at 1.6 stands 6.6 yd).
    expect(t.scale).toBeGreaterThanOrEqual(2);
    const { f, s } = pull('normal');
    dev(f, '/dev wildheart trigger totem');
    const [totem] = sapTotems(f.sim.ctx, state(s));
    // The planning party deals 30 a second a head at level 20: two to three
    // global cooldowns (1.5 s each) for one player.
    expect(totem.maxHp).toBe(80);
    expect(totem.maxHp / 30).toBeLessThanOrEqual(3 * 1.5);
    const h = pull('heroic');
    dev(h.f, '/dev wildheart trigger totem');
    const [heroic] = sapTotems(h.f.sim.ctx, state(h.s));
    // Heroic: 46 a second a head.
    expect(heroic.maxHp).toBe(160);
    expect(heroic.maxHp / 46).toBeLessThanOrEqual(3 * 1.5);
  });
});

describe('the rider throws from the howdah', () => {
  it('the first totem 5 s into the pull, then one every 10 s, each 14 yd off on the ford', () => {
    expect(T.totemFirst).toBe(5);
    expect(T.totemEvery).toBe(10);
    const { f, s } = pull();
    const st = state(s);
    run(f, T.totemFirst - 0.2);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(0);
    run(f, 0.3);
    const first = live(f, SAP_TOTEM_ID);
    expect(first).toHaveLength(1);
    expect(count(f, SAURIAN_TOTEM_THROW)).toBe(1);
    expect(f.lines.filter((l) => l === SAURIAN_TOTEM_LOG)).toHaveLength(1);
    const [a] = first;
    expect(a.kind).toBe('mob');
    expect(a.summonedAdd).toBe(true);
    expect(f.inst.mobIds.includes(a.id)).toBe(true);
    expect(st.totems.map((r) => r.id)).toEqual([a.id]);
    // It stands still, on the Saurian's own floor, past the Stomp's ring.
    run(f, T.totemEvery - 0.2);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(1);
    run(f, 0.3);
    const two = live(f, SAP_TOTEM_ID);
    expect(two).toHaveLength(2);
    // The emote is the first throw's only.
    expect(f.lines.filter((l) => l === SAURIAN_TOTEM_LOG)).toHaveLength(1);
    expect(T.totemRange).toBeGreaterThan(T.stompRadius);
    expect(T.totemRange).toBeGreaterThan(T.tailRange);
    for (const totem of two) {
      expect(Math.abs(totem.pos.y - s.pos.y)).toBeLessThan(1.2);
      expect(totem.castingAbility).toBe(SAURIAN_SAP_TETHER);
      expect(totem.castTargetId).toBe(s.id);
    }
    expect(
      Math.hypot(two[0].pos.x - two[1].pos.x, two[0].pos.z - two[1].pos.z),
    ).toBeGreaterThanOrEqual(T.totemSpacing);
  });

  it('lands each totem exactly 14 yd from where the Saurian stands at the throw', () => {
    const { f, s } = pull();
    run(f, T.totemFirst + 0.1);
    const [a] = live(f, SAP_TOTEM_ID);
    // The Saurian braced for no bar yet at 5 s (its Tail Swipe opens at 5 s
    // and holds it planted): it stands where the throw measured from.
    expect(Math.hypot(a.pos.x - s.pos.x, a.pos.z - s.pos.z)).toBeCloseTo(T.totemRange, 1);
  });

  it('three stand at most: with three up he holds his throw until one is broken', () => {
    const { f, s } = pull();
    const st = state(s);
    run(f, T.totemFirst + 2 * T.totemEvery + 0.2);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(3);
    run(f, T.totemEvery + 1);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(3);
    expect(st.totemsThrown).toBe(3);
    breakTotem(f, live(f, SAP_TOTEM_ID)[0]);
    run(f, T.totemRetry + 0.2);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(3);
    expect(st.totemsThrown).toBe(4);
    // A long real-time pull (about 38 s of a party's ticks): its own budget,
    // so a contended gate run never times it out.
  }, 120_000);

  it('the pick is hashed, never rolled: the same pull throws the same totems to the same spots', () => {
    const spots = (): string[] => {
      const { f, s } = pull();
      run(f, T.totemFirst + T.totemEvery + 0.2);
      return live(f, SAP_TOTEM_ID).map(
        (t) => `${(t.pos.x - s.pos.x).toFixed(3)},${(t.pos.z - s.pos.z).toFixed(3)}`,
      );
    };
    const a = spots();
    expect(a).toHaveLength(2);
    expect(spots()).toEqual(a);
  });
});

describe('a standing totem mends the Saurian', () => {
  it('nothing for its first 4 s, then 0.8 percent of its health every 2 s', () => {
    const { f, s } = pull();
    s.hp = s.maxHp * 0.9;
    dev(f, '/dev wildheart trigger totem');
    const st = state(s);
    st.totemTimer = 999;
    const per = Math.round(s.maxHp * T.totemHealPct);
    expect(T.totemHealPct).toBe(0.008);
    expect(T.totemArm).toBe(4);
    expect(T.totemHealEvery).toBe(2);
    expect(watchHeals(f, s, T.totemArm - 0.2)).toHaveLength(0);
    const heals = watchHeals(f, s, 0.3 + 2 * T.totemHealEvery);
    expect(heals).toHaveLength(3);
    for (const h of heals) {
      expect(h.amount).toBe(per);
      expect(h.ability).toBe(SAP_HEAL_NAME);
    }
    expect(count(f, SAURIAN_SAP_TETHER)).toBe(3);
    // Its bar is its clock: the seconds to the next mending.
    const [totem] = sapTotems(f.sim.ctx, st);
    expect(totem.castTotal).toBe(T.totemHealEvery);
    expect(totem.castRemaining).toBeGreaterThan(0);
    expect(totem.castRemaining).toBeLessThanOrEqual(T.totemHealEvery);
  });

  it('each totem mends on its own clock, and the Saurian wears a stack for each', () => {
    const { f, s } = pull();
    s.hp = s.maxHp * 0.5 + 1;
    const st = state(s);
    dev(f, '/dev wildheart trigger totem');
    expect(aura(s, SAURIAN_SAPPED)?.stacks).toBe(1);
    run(f, 1);
    dev(f, '/dev wildheart trigger totem');
    dev(f, '/dev wildheart trigger totem');
    st.totemTimer = 999;
    expect(aura(s, SAURIAN_SAPPED)?.stacks).toBe(3);
    expect(aura(s, SAURIAN_SAPPED)?.value).toBe(0);
    s.hp = s.maxHp * 0.6;
    // Over 10 s once all three are armed: five mendings each.
    watchHeals(f, s, T.totemArm);
    s.hp = s.maxHp * 0.6;
    const heals = watchHeals(f, s, 10);
    expect(heals.length).toBeGreaterThanOrEqual(14);
    expect(heals.length).toBeLessThanOrEqual(16);
    // Three totems give back 1.2 percent a second: under the planning party's
    // 1.5 (150 a second against about 10,000), so the fight still moves.
    const perSecond = (T.totemMax * T.totemHealPct) / T.totemHealEvery;
    expect(perSecond).toBeCloseTo(0.012, 6);
    expect(perSecond).toBeLessThan(150 / 10000);
    expect(perSecond).toBeGreaterThan((150 / 10000) * 0.5);
  });

  it('a broken totem mends no more, and its stack comes off', () => {
    const { f, s } = pull();
    s.hp = s.maxHp * 0.9;
    dev(f, '/dev wildheart trigger totem');
    const st = state(s);
    st.totemTimer = 999;
    watchHeals(f, s, T.totemArm + 0.2);
    const [totem] = sapTotems(f.sim.ctx, st);
    breakTotem(f, totem);
    tick(f);
    expect(st.totems).toHaveLength(0);
    expect(aura(s, SAURIAN_SAPPED)).toBeUndefined();
    s.hp = s.maxHp * 0.8;
    expect(watchHeals(f, s, 3 * T.totemHealEvery)).toHaveLength(0);
  });
});

describe('the backlash: breaking a totem never costs the group', () => {
  it('the Saurian takes exactly the totem health the group spent, from whoever broke it', () => {
    const { f, s } = pull();
    dev(f, '/dev wildheart trigger totem');
    const st = state(s);
    st.totemTimer = 999;
    const [totem] = sapTotems(f.sim.ctx, st);
    const pool = totem.maxHp;
    const mage = f.others[0];
    const from = f.hits.length;
    const before = s.hp;
    breakTotem(f, totem, mage);
    tick(f);
    const back = hitsOn(f, s, SAP_BACKLASH_NAME, from);
    expect(back).toHaveLength(1);
    expect(back[0].amount).toBe(pool);
    expect(back[0].sourceId).toBe(mage.id);
    expect(back[0].school).toBe('nature');
    expect(before - s.hp).toBe(pool);
    expect(count(f, SAURIAN_SAP_BACKLASH)).toBe(1);
  });

  it('a group that breaks each totem inside its arming bar is healed for nothing at all', () => {
    const { f, s } = pull();
    s.hp = s.maxHp * 0.9;
    const st = state(s);
    let healed = 0;
    let spent = 0;
    let returned = 0;
    // 35 s of the pull: totems at 5, 15, 25 and 35, each broken 3 s after it lands.
    const born = new Map<number, number>();
    for (let t = 0; t < 36; t += 0.05) {
      for (const totem of sapTotems(f.sim.ctx, st)) {
        if (!born.has(totem.id)) born.set(totem.id, t);
        if (t - (born.get(totem.id) ?? t) >= 3) {
          spent += totem.maxHp;
          breakTotem(f, totem);
        }
      }
      for (const p of [f.tank, ...f.others]) if (p.hp < 1e5) p.hp = 1e6;
      for (const ev of f.sim.tick()) {
        if (ev.type === 'heal2' && ev.targetId === s.id) healed += ev.amount;
        if (ev.type === 'damage' && ev.targetId === s.id && ev.ability === SAP_BACKLASH_NAME)
          returned += ev.amount;
      }
    }
    expect(st.totemsThrown).toBeGreaterThanOrEqual(3);
    expect(healed).toBe(0);
    expect(spent).toBeGreaterThan(0);
    expect(returned).toBe(spent);
    expect(3).toBeLessThan(T.totemArm);
  });
});

describe('the howdah still breaks at half health', () => {
  it('the rider leaps down, throws no more, and the totems standing mend on', () => {
    const { f, s } = pull();
    const st = state(s);
    run(f, T.totemFirst + 0.2);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(1);
    s.hp = Math.floor(s.maxHp * 0.49);
    tick(f);
    expect(st.howdahBroken).toBe(true);
    run(f, T.riderLandDelay + 0.1);
    expect(live(f, HOWDAH_HEXCALLER_ID)).toHaveLength(1);
    // He throws no more from the ground: 25 s on, still the one totem.
    const thrown = st.totemsThrown;
    s.hp = Math.floor(s.maxHp * 0.4);
    const heals = watchHeals(f, s, 2.5 * T.totemEvery);
    expect(st.totemsThrown).toBe(thrown);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(1);
    // The one standing still mends (his own Ancestral Sap beside it).
    const per = Math.round(s.maxHp * T.totemHealPct);
    expect(heals.filter((h) => h.amount === per).length).toBeGreaterThanOrEqual(10);
    expect(SAP_HEAL_NAME).toBe('Ancestral Sap');
  });

  it('the totems crumble with the Saurian, and Toppled Titan is still earned', () => {
    const { f, s } = pull();
    const st = state(s);
    run(f, T.totemFirst + 0.2);
    dev(f, '/dev wildheart trigger howdah');
    run(f, T.riderLandDelay + 0.1);
    const [rider] = live(f, HOWDAH_HEXCALLER_ID);
    const totems = live(f, SAP_TOTEM_ID);
    expect(totems).toHaveLength(1);
    f.sim.ctx.handleDeath(rider, f.tank);
    run(f, 2);
    const from = f.hits.length;
    f.sim.ctx.handleDeath(s, f.tank);
    tick(f);
    expect(live(f, SAP_TOTEM_ID)).toHaveLength(0);
    expect(st.totems).toHaveLength(0);
    // A totem that crumbles on its own strikes nobody back.
    expect(hitsOn(f, s, SAP_BACKLASH_NAME, from)).toHaveLength(0);
    expect(aura(s, SAURIAN_SAPPED)).toBeUndefined();
    expect(earned(f, f.tank, SAURIAN_DEED)).toBe(true);
  });

  it('a wipe takes the totems away with the fight', () => {
    const { f, s } = pull();
    run(f, T.totemFirst + T.totemEvery + 0.2);
    const totems = live(f, SAP_TOTEM_ID);
    expect(totems).toHaveLength(2);
    wipe(f, s);
    tick(f);
    expect(s.wildheartFight).toBeUndefined();
    for (const t of totems) {
      expect(f.sim.ctx.entities.has(t.id)).toBe(false);
      expect(f.inst.mobIds.includes(t.id)).toBe(false);
    }
    expect(aura(s, SAURIAN_SAPPED)).toBeUndefined();
  });
});

describe('heroic: the drum', () => {
  /** Seconds between the starts of the first two Stomp bars. */
  function stompGap(f: Fight, s: Entity, keep: () => void = () => {}): number {
    const starts: number[] = [];
    // A bar already running is no start: wait it out first.
    let was = s.castingAbility === SAURIAN_STOMP;
    for (let t = 0; t < 40 && starts.length < 2; t += 0.05) {
      keep();
      tick(f);
      const on = s.castingAbility === SAURIAN_STOMP;
      if (on && !was) starts.push(t);
      was = on;
    }
    return starts[1] - starts[0];
  }

  it('normal carries no drum', () => {
    const { f, s } = pull('normal');
    run(f, 1);
    expect(state(s).drum).toBeNull();
    expect(aura(s, SAURIAN_WAR_DRUM)).toBeUndefined();
    expect(count(f, SAURIAN_DRUM_BEAT)).toBe(0);
  });

  it('beats from the pull, once a second, and the Stomp comes twice as often', () => {
    const { f, s } = pull('heroic');
    const st = state(s);
    st.totemTimer = 999;
    expect(st.drum).not.toBeNull();
    expect(drumBeating(st)).toBe(true);
    expect(aura(s, SAURIAN_WAR_DRUM)).toBeDefined();
    run(f, 5);
    expect(count(f, SAURIAN_DRUM_BEAT)).toBeGreaterThanOrEqual(4);
    expect(count(f, SAURIAN_DRUM_BEAT)).toBeLessThanOrEqual(6);
    // Bar to bar: the 16 s clock at twice the pace (it waits out its own 2 s
    // bar and the Tail Swipe's 1 s bars, which run at the drum's pace too).
    const fast = stompGap(f, s, () => {
      st.totemTimer = 999;
    });
    const n = pull('normal');
    state(n.s).totemTimer = 999;
    const slow = stompGap(n.f, n.s, () => {
      state(n.s).totemTimer = 999;
    });
    expect(T.drumStompRate).toBe(2);
    expect(slow).toBeGreaterThanOrEqual(T.stompEvery - 0.1);
    expect(fast).toBeLessThanOrEqual(slow / 2 + 1.6);
    expect(fast).toBeGreaterThanOrEqual(T.stompEvery / 2 - 0.1);
  });

  it('a broken totem silences it for 6 s: the Stomp clock runs plain, then the drum picks up', () => {
    const { f, s } = pull('heroic');
    const st = state(s);
    dev(f, '/dev wildheart trigger totem');
    st.totemTimer = 999;
    const [totem] = sapTotems(f.sim.ctx, st);
    st.stompTimer = 100;
    run(f, 1);
    // Beating: a second of the pull takes two off the Stomp's clock.
    expect(st.stompTimer).toBeCloseTo(100 - 2, 1);
    breakTotem(f, totem);
    tick(f);
    expect(drumBeating(st)).toBe(false);
    expect(aura(s, SAURIAN_WAR_DRUM)).toBeUndefined();
    const hush = aura(s, SAURIAN_DRUM_SILENCED);
    expect(hush?.duration).toBe(T.drumSilence);
    expect(T.drumSilence).toBe(6);
    const beats = count(f, SAURIAN_DRUM_BEAT);
    st.stompTimer = 100;
    run(f, 3);
    expect(st.stompTimer).toBeCloseTo(100 - 3, 1);
    expect(count(f, SAURIAN_DRUM_BEAT)).toBe(beats);
    expect(aura(s, SAURIAN_DRUM_SILENCED)?.remaining).toBeCloseTo(T.drumSilence - 3, 0);
    // Still silent near the end of its 6 s, beating again just past it.
    run(f, T.drumSilence - 3 - 0.3);
    expect(drumBeating(st)).toBe(false);
    run(f, 0.5);
    expect(drumBeating(st)).toBe(true);
    expect(aura(s, SAURIAN_DRUM_SILENCED)).toBeUndefined();
    expect(aura(s, SAURIAN_WAR_DRUM)).toBeDefined();
    expect(count(f, SAURIAN_DRUM_BEAT)).toBeGreaterThan(beats);
  });

  it('the Stomp is priced to the drum: 0.7 of its roll while it is aboard, whole once the howdah breaks', () => {
    // The group that answers every totem inside its 4 s arming bar hears the
    // drum 4 s in every 10: 1.4 times the Stomps at 0.7 each is 0.98 of the
    // Stomp damage it took before.
    const uptime = (T.totemEvery - T.drumSilence) / T.totemEvery;
    const pace = 1 + uptime * (T.drumStompRate - 1);
    expect(pace).toBeCloseTo(1.4, 6);
    expect(pace * T.drumStompScale).toBeCloseTo(0.98, 6);
    expect(T.drumStompRate * T.drumStompScale).toBeCloseTo(1.4, 6);
    const { f, s } = pull('heroic');
    const st = state(s);
    st.totemTimer = 999;
    const mult = s.mechanicDamageMult ?? 1;
    put(f, f.others[0], -18, -101);
    const stomp = (): number => {
      const from = f.hits.length;
      dev(f, '/dev wildheart trigger stomp');
      run(f, T.stompCast + 0.1);
      const [hit] = hitsOn(f, f.others[0], 'Earthshaking Stomp', from);
      return hit.amount;
    };
    const drummed = stomp();
    expect(drummed).toBeGreaterThanOrEqual(Math.floor(T.stompMin * mult * T.drumStompScale) - 1);
    expect(drummed).toBeLessThanOrEqual(Math.ceil(T.stompMax * mult * T.drumStompScale) + 1);
    // Silenced but still aboard: the price holds (the 0.98 budget counts on
    // every Stomp while the drummer rides, beating or not).
    dev(f, '/dev wildheart trigger silence');
    expect(drumBeating(st)).toBe(false);
    expect(st.drum).not.toBeNull();
    const hushed = stomp();
    expect(hushed).toBeGreaterThanOrEqual(Math.floor(T.stompMin * mult * T.drumStompScale) - 1);
    expect(hushed).toBeLessThanOrEqual(Math.ceil(T.stompMax * mult * T.drumStompScale) + 1);
    dev(f, '/dev wildheart trigger howdah');
    expect(st.drum).toBeNull();
    expect(aura(s, SAURIAN_WAR_DRUM)).toBeUndefined();
    expect(aura(s, SAURIAN_DRUM_SILENCED)).toBeUndefined();
    const whole = stomp();
    expect(whole).toBeGreaterThanOrEqual(Math.floor(T.stompMin * mult) - 1);
    expect(whole).toBeLessThanOrEqual(Math.ceil(T.stompMax * mult) + 1);
  });

  it('a wipe stops the drum', () => {
    const { f, s } = pull('heroic');
    run(f, 1);
    wipe(f, s);
    tick(f);
    expect(aura(s, SAURIAN_WAR_DRUM)).toBeUndefined();
    expect(aura(s, SAURIAN_DRUM_SILENCED)).toBeUndefined();
  });
});

describe('/dev wildheart trigger: the totem rework', () => {
  it('lists totem, sap, drum and silence, and each jumps to its moment', () => {
    for (const name of ['totem', 'sap', 'drum', 'silence'])
      expect(WILDHEART_DEV_TRIGGERS.includes(name), name).toBe(true);
    const { f, s } = pull('normal');
    const st = state(s);
    s.hp = s.maxHp * 0.9;
    dev(f, '/dev wildheart trigger totem');
    expect(sapTotems(f.sim.ctx, st)).toHaveLength(1);
    const heals: SimEvent[] = [];
    handleWildheartBasinDevChat(f.sim.ctx, '/dev wildheart trigger sap', f.tank.id);
    for (let i = 0; i < 3; i++)
      for (const ev of f.sim.tick())
        if (ev.type === 'heal2' && ev.targetId === s.id) heals.push(ev);
    expect(heals).toHaveLength(1);
    dev(f, '/dev wildheart trigger drum');
    expect(drumBeating(st)).toBe(true);
    dev(f, '/dev wildheart trigger silence');
    expect(drumBeating(st)).toBe(false);
    expect(aura(s, SAURIAN_DRUM_SILENCED)).toBeDefined();
  });
});

describe('a lost target (the fight paused, never ended)', () => {
  it('the totems still mend, and one broken meanwhile still snaps back and silences the drum', () => {
    const { f, s } = pull('heroic');
    const st = state(s);
    s.hp = Math.round(s.maxHp * 0.9);
    dev(f, '/dev wildheart trigger totem');
    st.totemTimer = 999;
    run(f, T.totemArm + 0.1);
    const [totem] = sapTotems(f.sim.ctx, st);
    expect(drumBeating(st)).toBe(true);
    // The Saurian loses its target for a moment (a Vanish, the tank down):
    // still in combat, chasing nothing. The encounter pass alone, as the
    // Tusker's paused tests drive it, so the mob AI cannot re-take a target.
    s.aggroTargetId = null;
    s.aiState = 'chase';
    s.inCombat = true;
    const blip = (seconds: number): void => {
      for (let t = 0; t < seconds - 0.025; t += 0.05) tickWildheartEncounters(f.sim.ctx);
    };
    const stomp = st.stompTimer;
    const before = s.hp;
    blip(T.totemHealEvery + 0.2);
    // Paused, not ended: the Stomp's clock held (the paused branch ran)...
    expect(st.stompTimer).toBe(stomp);
    expect(s.wildheartFight).toBe(st);
    expect(st.totems).toHaveLength(1);
    // ...and the armed totem still mended.
    expect(s.hp).toBe(before + Math.round(s.maxHp * T.totemHealPct));
    const mended = s.hp;
    breakTotem(f, totem);
    blip(0.05);
    // The backlash: exactly the totem's own health, off the Saurian.
    expect(s.hp).toBe(mended - totem.maxHp);
    expect(drumBeating(st)).toBe(false);
    expect(aura(s, SAURIAN_DRUM_SILENCED)).toBeDefined();
    expect(st.totems).toHaveLength(0);
  });
});

describe('same seed, same ford', () => {
  it('two heroic pulls agree on every throw, mending, beat, backlash and health', () => {
    const play = (): string => {
      const { f, s } = pull('heroic');
      s.hp = Math.round(s.maxHp * 0.9);
      run(f, T.totemFirst + T.totemEvery + T.totemArm + 0.5);
      const [first] = live(f, SAP_TOTEM_ID);
      breakTotem(f, first);
      run(f, 8);
      return JSON.stringify({
        totems: live(f, SAP_TOTEM_ID).map((t) => [t.id, t.pos.x.toFixed(4), t.pos.z.toFixed(4)]),
        hp: s.hp,
        fx: f.fx,
        hits: f.hits.map((h) => `${h.ability}:${h.amount}`),
        drum: state(s).drum,
      });
    };
    const a = play();
    expect(JSON.parse(a).fx).toContain(SAURIAN_SAP_BACKLASH);
    expect(play()).toBe(a);
  });
});
