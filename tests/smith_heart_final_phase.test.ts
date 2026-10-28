// The Masterless Strength, part 2 (encounters/smith_heart/final_intermission.ts,
// final_adds.ts, final_last.ts; design doc 7.5) over a REAL Sim: the
// intermissions at 70 and 40 percent (the stride, the shield, the Splinters per
// tier and the quarters they rise from, the quarter rules held still, the
// call's end and the poured elements), each Splinter's signature, no Splinter
// ever raising a body, the final phase at 15 percent (the mix, the soft
// enrage), determinism and a headless full fight 100 to 0 on every tier.

import { describe, expect, it } from 'vitest';
import type { SmithHeartVein } from '../src/sim/content/smith_heart_layout';
import {
  HEART_FINAL_PHASE_SHARE,
  HEART_QUARTER_ORDER,
  heartQuarterAt,
  heartQuarterSpot,
} from '../src/sim/content/smith_heart_quarters';
import { MOBS } from '../src/sim/data';
import {
  FINAL_AURAS,
  FINAL_CASTS,
  FINAL_NAMES,
  FINAL_OBJECTS,
  overloadAuraId,
} from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  ALL_QUARTERS_MASK,
  FINAL_PHASE_CASTS as C,
  FINAL_ADD_MOBS,
  FINAL_MIX,
  FINAL_PHASE_DIFFICULTY,
  FINAL_PHASE_OBJECTS,
  FINAL_STAGE_CODES,
  finalAddVein,
  finalStageOf,
  furyScale,
  inRingGap,
  MOUNTING_WEIGHT_AURA,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  pickAddQuarters,
  pouredAuraId,
  quarterBit,
  quenchRingGaps,
  quenchRingOf,
  quenchRingTemplate,
  splinterScale,
  veinsOfMask,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { addThreat } from '../src/sim/threat';
import type { Entity, SimEvent } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

type Damage = Extract<SimEvent, { type: 'damage' }>;
const hits = (ev: SimEvent[], name: string, target?: number): Damage[] =>
  ev.filter(
    (e): e is Damage =>
      e.type === 'damage' && e.ability === name && (target === undefined || e.targetId === target),
  );
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const sec = (s: number) => Math.round(s * 20);

/** Strike the boss as a raider would (its floors and its shield hold). */
function strike(f: FinalFight, amount: number): void {
  f.sim.ctx.dealDamage(f.players[1], f.boss(), amount, false, 'physical', 'Strike', 'hit');
}

/** The living Splinters of the claim. */
function splinters(f: FinalFight): Entity[] {
  return f.inst.mobIds
    .map((id) => f.sim.ctx.entities.get(id))
    .filter((e): e is Entity => !!e && !e.dead && finalAddVein(e.templateId) !== null);
}

/** Pull in `vein` and run it down to the first intermission's call. */
function toCall(f: FinalFight, vein: SmithHeartVein = 'heat'): void {
  f.pullIn(vein);
  strike(f, f.boss().maxHp);
  f.tick(sec(3.5));
}

describe('the pure part 2', () => {
  it('the Splinters rise from the fullest bars, ties to its last quarter then clockwise', () => {
    const bars = { breath: 0.2, quench: 0.6, hammer: 0.6, heat: 0.1 };
    expect(pickAddQuarters(bars, 'hammer', 2)).toEqual(['hammer', 'quench']);
    expect(pickAddQuarters(bars, 'quench', 2)).toEqual(['quench', 'hammer']);
    const flat = { breath: 0, quench: 0, hammer: 0, heat: 0 };
    expect(pickAddQuarters(flat, 'hammer', 3)).toEqual(['hammer', 'heat', 'breath']);
    expect(pickAddQuarters(flat, null, 4)).toEqual([...HEART_QUARTER_ORDER]);
  });

  it('a Quenching Ring carries its gaps in its template, the same for sim and painter', () => {
    const t = quenchRingTemplate(3, 4242);
    expect(t.startsWith(FINAL_PHASE_OBJECTS.ringPrefix)).toBe(true);
    expect(quenchRingOf(t)).toEqual({ gaps: 3, seed: 4242 });
    const g = quenchRingGaps(4242, 3);
    expect(g).toEqual(quenchRingGaps(4242, 3));
    expect(g.length).toBe(3);
    for (const b of g) expect(inRingGap(b, g)).toBe(true);
    expect(inRingGap(g[0] + Math.PI / 3, g)).toBe(false);
  });

  it('the ramps, the stages, the mask and the threshold agree with the room', () => {
    expect(splinterScale(0)).toBe(1);
    expect(splinterScale(10)).toBeCloseTo(1 + 10 * P.splinterRise);
    expect(furyScale(1)).toBe(1);
    expect(furyScale(3)).toBeGreaterThan(furyScale(2));
    for (const [k, v] of Object.entries(FINAL_STAGE_CODES)) expect(finalStageOf(v)).toBe(k);
    expect(veinsOfMask(ALL_QUARTERS_MASK)).toEqual([...HEART_QUARTER_ORDER]);
    expect(veinsOfMask(quarterBit('hammer'))).toEqual(['hammer']);
    expect(P.finalAt).toBe(HEART_FINAL_PHASE_SHARE);
    for (const tier of ['normal', 'heroic', 'mythic'] as const)
      expect(FINAL_PHASE_DIFFICULTY[tier].hiddenPhase).toBe(false);
  });

  it('every Splinter is a real mob template bigger than a player that raises nobody', () => {
    for (const v of HEART_QUARTER_ORDER) {
      const t = MOBS[FINAL_ADD_MOBS[v]];
      expect(t, v).toBeDefined();
      expect(t.scale).toBeGreaterThanOrEqual(2.2);
      expect(t.trashKit?.raise).toBeUndefined();
      expect(t.trashKit?.call).toBeUndefined();
      expect(t.trashKit?.grow).toBeUndefined();
      expect(finalAddVein(t.id)).toBe(v);
    }
  });
});

describe('the intermissions', () => {
  it('70 percent: a floor holds it there, it strides to the centre shielded and calls', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    const b = f.boss();
    strike(f, b.maxHp);
    // The floor held it exactly on the line.
    expect(b.hp).toBe(Math.ceil(b.maxHp * 0.7));
    f.tick(1);
    expect(f.state()?.phase.stage).toBe('leap');
    expect(b.damageImmune).toBe(true);
    expect(aura(b, A.shield)).toBeDefined();
    f.tick(sec(3.2));
    const st = f.state();
    expect(st?.phase.stage).toBe('call');
    expect(heartQuarterAt(f.local(b).x, f.local(b).z)).toBe('ring');
    expect(b.castingAbility).toBe(C.call);
    // Nothing harms it through the call.
    const hp = b.hp;
    strike(f, 5000);
    expect(b.hp).toBe(hp);
    expect(aura(b, A.phase)?.value).toBe(FINAL_STAGE_CODES.call);
  });

  for (const [tier, n] of [
    ['normal', 2],
    ['heroic', 3],
    ['mythic', 4],
  ] as const)
    it(`${tier}: ${n} Splinters rise, from the quarters with the fullest bars`, () => {
      const f = finalFight(6);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('heat');
      f.dev('/dev heart final fill all 0');
      f.dev('/dev heart final fill quench 70');
      f.dev('/dev heart final fill hammer 60');
      f.dev('/dev heart final fill breath 30');
      strike(f, f.boss().maxHp);
      f.tick(sec(3.5));
      const adds = splinters(f);
      expect(adds.length).toBe(n);
      const veins = adds.map((e) => finalAddVein(e.templateId));
      const want = (['quench', 'hammer', 'breath', 'heat'] as const).slice(0, n);
      expect(new Set(veins)).toEqual(new Set(want));
      for (const e of adds) {
        expect(e.maxHp).toBe(FINAL_PHASE_DIFFICULTY[tier].addHealth);
        // It rose in its own quarter.
        const q = f.local(e);
        expect(heartQuarterAt(q.x, q.z)).toBe(finalAddVein(e.templateId));
      }
      // The awake mask is theirs.
      let mask = 0;
      for (const v of want) mask |= quarterBit(v);
      expect(aura(f.boss(), A.phase)?.value2).toBe(mask);
      expect(aura(f.boss(), A.phase)?.stacks).toBe(n);
    });

  it('the quarter rules hold still: the bars, the switch mark, no Heart Unbound', () => {
    const f = finalFight(6);
    f.dev('/dev heart final heroic');
    f.pullIn('heat');
    // A switch first, so the raid is Vein-Shaken.
    f.dev('/dev heart final quarter hammer');
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const shakenBefore = aura(f.players[2], FINAL_AURAS.shaken)?.remaining ?? 0;
    expect(shakenBefore).toBeGreaterThan(10);
    strike(f, f.boss().maxHp);
    f.tick(sec(3.5));
    const bars = HEART_QUARTER_ORDER.map((v) => st.overload[v]);
    const mark = st.shakenLeft;
    // The raid stands by the boss in the ring the whole call.
    f.gather(170, 150, 3);
    const c = f.local(f.boss());
    f.gather(c.x, c.z, 4);
    const ev = f.tick(sec(15));
    expect(HEART_QUARTER_ORDER.map((v) => st.overload[v])).toEqual(bars);
    expect(st.shakenLeft).toBeCloseTo(mark, 5);
    expect(aura(f.players[2], FINAL_AURAS.shaken)?.remaining ?? 0).toBeCloseTo(shakenBefore, 0);
    expect(hits(ev, FINAL_NAMES.unbound).length).toBe(0);
    expect(hits(ev, FINAL_NAMES.pulse).length).toBe(0);
    expect(aura(f.boss(), FINAL_AURAS.unbound)).toBeUndefined();
    expect(aura(f.boss(), overloadAuraId('hammer'))?.value2).toBe(0);
  });

  it('all Splinters dead: the shield breaks at once, nothing poured, Heart Unbound held a while', () => {
    const f = finalFight(6);
    toCall(f);
    f.tick(sec(3));
    f.dev('/dev heart final killadds');
    f.tick(2);
    const st = f.state();
    expect(st?.phase.stage).toBe('fight');
    expect(f.boss().damageImmune).toBe(false);
    expect(aura(f.boss(), A.shield)).toBeUndefined();
    expect(f.boss().castingAbility).not.toBe(C.call);
    for (const v of HEART_QUARTER_ORDER) expect(aura(f.boss(), pouredAuraId(v))).toBeUndefined();
    // Standing in the ring right after, Heart Unbound waits out its grace.
    const ev = f.tick(sec(P.releaseGrace - 1));
    expect(hits(ev, FINAL_NAMES.unbound).length).toBe(0);
  });

  it('the call run out: every Splinter alive pours its element into the boss', () => {
    const f = finalFight(6);
    f.dev('/dev heart final heroic');
    toCall(f);
    const veins = splinters(f).map((e) => finalAddVein(e.templateId));
    expect(veins.length).toBe(3);
    // One dies; the others live to the end.
    const [first] = splinters(f);
    f.tick(sec(3));
    first.damageImmune = false;
    f.sim.ctx.dealDamage(f.players[1], first, first.hp + 1, false, 'physical', 'Strike', 'hit');
    const ev = f.tick(sec(P.callSeconds));
    expect(f.state()?.phase.stage).toBe('fight');
    const dead = finalAddVein(first.templateId);
    for (const v of veins) {
      const poured = aura(f.boss(), pouredAuraId(v as SmithHeartVein));
      if (v === dead) expect(poured, v ?? '').toBeUndefined();
      else expect(poured?.stacks, v ?? '').toBe(1);
    }
    expect(ev.some((e) => e.type === 'spellfx' && e.ability === 'heart_final_pour')).toBe(true);
    expect(splinters(f).length).toBe(0);
  });

  it('Splintered Strength ramps while they live, and no Splinter ever raises a body', () => {
    const f = finalFight(6);
    f.dev('/dev heart final mythic');
    toCall(f);
    const before = new Set(f.inst.mobIds);
    const ev = f.tick(sec(P.callSeconds - 2));
    const pulses = hits(ev, N.splinter, f.players[3].id);
    expect(pulses.length).toBeGreaterThan(8);
    expect(pulses[pulses.length - 1].amount).toBeGreaterThan(pulses[0].amount * 2);
    // Every mob of the claim now was there when the call began.
    for (const id of f.inst.mobIds) expect(before.has(id), String(id)).toBe(true);
  });
});

describe("each Splinter's signature", () => {
  /** A call with one Splinter of `vein` (the others gone), the raid round it. */
  function withSplinter(vein: SmithHeartVein, tier = 'normal'): { f: FinalFight; e: Entity } {
    const f = finalFight(6);
    if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
    toCall(f);
    f.dev('/dev heart final killadds');
    f.tick(1);
    // A fresh call keeps the stage: call one in by the verb.
    f.dev('/dev heart final inter40');
    f.tick(sec(3.5));
    f.dev('/dev heart final killadds');
    f.dev(`/dev heart final splinter ${vein}`);
    f.tick(sec(P.riseSeconds + 0.2));
    const e = splinters(f).find((m) => finalAddVein(m.templateId) === vein);
    if (!e) throw new Error('no splinter');
    return { f, e };
  }

  it('Shearing Blow: its target takes the tank share, anyone else in it the lethal one', () => {
    const { f, e } = withSplinter('hammer');
    const tank = f.players[0];
    const other = f.players[1];
    f.sim.ctx.aggroMob(e, tank, false);
    e.aggroTargetId = tank.id;
    const q = f.local(e);
    f.put(tank, q.x, q.z + 3);
    f.put(other, q.x + 0.5, q.z + 5);
    for (const p of f.players.slice(2)) f.put(p, q.x, q.z - 20);
    f.dev('/dev heart final shear');
    expect(e.castingAbility).toBe(C.shear);
    const ev = f.tick(sec(P.shearCast + 0.2));
    const t = hits(ev, N.shear, tank.id);
    const o = hits(ev, N.shear, other.id);
    expect(t.length).toBe(1);
    expect(o.length).toBe(1);
    expect(o[0].amount).toBeGreaterThan(t[0].amount * 2.5);
    for (const p of f.players.slice(2)) expect(hits(ev, N.shear, p.id).length).toBe(0);
  });

  it('the Heat: a Cinder Trail behind it as it is dragged, Bursting Coal on the group', () => {
    const { f, e } = withSplinter('heat');
    const before = f.objects(FINAL_OBJECTS.poolPrefix).length;
    // Dragged 15 yd along the floor.
    const q = f.local(e);
    for (let i = 0; i < 15; i++) {
      e.pos = f.sim.ctx.groundPos(e.pos.x + 1, e.pos.z);
      f.tick(1);
    }
    expect(f.objects(FINAL_OBJECTS.poolPrefix).length).toBeGreaterThan(before + 2);
    // The coal: the marked stands in the group; it bursts on them.
    f.gather(q.x + 15, q.z + 10, 2);
    f.dev('/dev heart final coal');
    const marked = f.players.filter((p) => aura(p, A.coal));
    expect(marked.length).toBe(1);
    const ev = f.tick(sec(P.coalSeconds + 0.2));
    const others = f.players.filter((p) => p !== marked[0]);
    expect(hits(ev, N.coal, others[0].id)[0]?.amount ?? 0).toBeGreaterThan(P.coalMin * 0.9);
    expect(aura(marked[0], A.coal)).toBeUndefined();
  });

  it('the Quench: Rime Toll rung out hits the raid; kicked, it does not', () => {
    const { f, e } = withSplinter('quench');
    f.dev('/dev heart final toll');
    expect(e.castingAbility).toBe(C.toll);
    let ev = f.tick(sec(P.tollCast + 0.2));
    expect(hits(ev, N.toll).length).toBe(f.players.length);
    // Kicked: the interrupt cancels it and locks its frost.
    f.tick(sec(1));
    f.dev('/dev heart final toll');
    expect(e.castingAbility).toBe(C.toll);
    f.sim.ctx.cancelCast(e);
    e.auras.push({
      id: 'test_kick_lockout',
      name: 'Kick',
      kind: 'lockout',
      remaining: 4,
      duration: 4,
      value: 0,
      sourceId: f.players[0].id,
      school: 'frost',
    });
    ev = f.tick(sec(P.tollCast + 0.2));
    expect(hits(ev, N.toll).length).toBe(0);
    // Locked out, it cannot toll again.
    expect(f.dev('/dev heart final toll')).toBe(true);
    expect(e.castingAbility).not.toBe(C.toll);
  });

  it('the Quench: a ring strikes whoever it crosses outside a gap, spares a gap', () => {
    const { f, e } = withSplinter('quench');
    f.dev('/dev heart final ring');
    const [obj] = f.objects(FINAL_PHASE_OBJECTS.ringPrefix);
    expect(obj).toBeDefined();
    const info = quenchRingOf(obj.templateId);
    if (!info) throw new Error('ring');
    const gaps = quenchRingGaps(info.seed, info.gaps);
    const c = f.local(obj);
    const inGap = f.players[1];
    const outGap = f.players[2];
    const g = gaps[0];
    const off = g + Math.PI / info.gaps;
    f.put(inGap, c.x + Math.sin(g) * 14, c.z + Math.cos(g) * 14);
    f.put(outGap, c.x + Math.sin(off) * 14, c.z + Math.cos(off) * 14);
    for (const p of [f.players[0], ...f.players.slice(3)]) f.put(p, c.x + 45, c.z);
    void e;
    const ev = f.tick(sec(3));
    expect(hits(ev, N.ring, outGap.id).length).toBe(1);
    expect(hits(ev, N.ring, inGap.id).length).toBe(0);
    expect(aura(outGap, A.chill)).toBeDefined();
  });

  it('the Hammer: Mounting Weight stacks on its target and its swings land harder', () => {
    const { f, e } = withSplinter('hammer');
    const tank = f.players[0];
    const base = e.weapon?.max ?? 0;
    tank.auras.push({
      id: MOUNTING_WEIGHT_AURA,
      name: N.weight,
      kind: 'dot',
      remaining: 20,
      duration: 20,
      value: 1,
      stacks: 5,
      tickInterval: 1,
      tickTimer: 1,
      sourceId: e.id,
      school: 'physical',
    });
    addThreat(e, tank.id, 1e6);
    e.aggroTargetId = tank.id;
    f.tick(1);
    expect(e.aggroTargetId).toBe(tank.id);
    expect(e.weapon?.max ?? 0).toBeGreaterThan(base * 1.6);
    // Its template rides the swing kernel's stacking hit.
    expect(MOBS[FINAL_ADD_MOBS.hammer].stackPoison?.name).toBe(N.weight);
  });

  it('the Breath: Gale Pounce leaps onto its quarry and buffets everyone else near it', () => {
    const { f, e } = withSplinter('breath');
    const tank = f.players[0];
    e.aggroTargetId = tank.id;
    const q = f.local(e);
    f.put(tank, q.x, q.z + 2);
    f.gather(q.x + 20, q.z, 2);
    f.put(tank, q.x, q.z + 2);
    f.dev('/dev heart final pounce');
    expect(e.castingAbility).toBe(C.pounce);
    const quarry = f.players.find((p) => aura(p, A.tether));
    expect(quarry).toBeDefined();
    expect(quarry?.id).not.toBe(tank.id);
    const ev = f.tick(sec(P.pounceCast + 2.2));
    if (!quarry) return;
    // It landed on its quarry and hunts it (its melee reach away at most).
    expect(Math.hypot(e.pos.x - quarry.pos.x, e.pos.z - quarry.pos.z)).toBeLessThan(8);
    expect(e.aggroTargetId).toBe(quarry.id);
    expect(hits(ev, N.pounce, quarry.id).length).toBe(1);
    expect(hits(ev, N.buffet, quarry.id).length).toBe(0);
    const near = f.players.filter((p) => p !== quarry && p !== tank);
    expect(near.some((p) => hits(ev, N.buffet, p.id).length > 0)).toBe(true);
    // Its circles: Storm Orbs round it.
    const orbs = f.objects(FINAL_OBJECTS.orbPrefix).length;
    f.dev('/dev heart final circles');
    expect(f.objects(FINAL_OBJECTS.orbPrefix).length).toBe(orbs + 2);
  });
});

describe('the final phase', () => {
  it('15 percent: it strides into the centre, all four quarters wake, the bars are off', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    f.dev('/dev heart final fill all 50');
    f.dev('/dev heart final last');
    f.tick(sec(3.5));
    const st = f.state();
    expect(st?.phase.stage).toBe('final');
    const b = f.boss();
    expect(heartQuarterAt(f.local(b).x, f.local(b).z)).toBe('ring');
    expect(b.damageImmune).toBe(false);
    expect(aura(b, A.phase)?.value2).toBe(ALL_QUARTERS_MASK);
    for (const v of HEART_QUARTER_ORDER) expect(st?.overload[v]).toBe(0);
    const ev = f.tick(sec(20));
    expect(hits(ev, FINAL_NAMES.unbound).length).toBe(0);
    expect(hits(ev, FINAL_NAMES.pulse).length).toBe(0);
    for (const v of HEART_QUARTER_ORDER) expect(st?.overload[v]).toBe(0);
  });

  it('mixes one ability of each element in turn, never two at once', () => {
    const f = finalFight(8);
    f.pullIn('heat');
    f.dev('/dev heart final last');
    f.tick(sec(3.5));
    const b = f.boss();
    const c = f.local(b);
    f.gather(c.x, c.z, 9);
    const seen: string[] = [];
    let whirls = 0;
    let cracks = 0;
    for (let t = 0; t < sec(30); t++) {
      const w = f.objects(FINAL_OBJECTS.whirlPrefix).length;
      const k = f.objects(FINAL_OBJECTS.crackPrefix).length;
      if (w > whirls && !seen.includes('heat')) seen.push('heat');
      if (k > cracks && !seen.includes('quench')) seen.push('quench');
      if (b.castingAbility === FINAL_CASTS.bolt && !seen.includes('breath')) seen.push('breath');
      if (b.castingAbility === FINAL_CASTS.anvil && !seen.includes('hammer')) seen.push('hammer');
      whirls = w;
      cracks = k;
      f.tick(1);
    }
    expect(seen).toEqual([...FINAL_MIX]);
  });

  it('two minutes in, Masterless Fury pulses harder and harder (warned first)', () => {
    const f = finalFight(6);
    f.pullIn('heat');
    f.dev('/dev heart final last');
    f.tick(sec(3.5));
    const b = f.boss();
    const c = f.local(b);
    f.gather(c.x, c.z, 9);
    const early = f.tick(sec(P.enrageAfter - 1));
    expect(hits(early, N.fury).length).toBe(0);
    expect(
      early.some((e) => e.type === 'chat' && e.textKey === 'hudChrome.finalBoss.warn.furySoon'),
    ).toBe(true);
    const late = f.tick(sec(8));
    const fury = hits(late, N.fury, f.players[2].id);
    expect(fury.length).toBeGreaterThanOrEqual(3);
    expect(fury[fury.length - 1].amount).toBeGreaterThan(fury[0].amount);
    expect(aura(b, A.fury)?.stacks ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('the poured elements', () => {
  it('a poured Heat keeps raising Fire Whirls wherever it stands, painful but slower', () => {
    const f = finalFight(6);
    toCall(f, 'hammer');
    f.dev('/dev heart final killadds');
    f.dev('/dev heart final splinter heat');
    f.tick(sec(3));
    f.dev('/dev heart final endcall');
    f.tick(1);
    expect(aura(f.boss(), pouredAuraId('heat'))?.stacks).toBe(1);
    // In the Hammer quarter now: still Fire Whirls.
    f.dev('/dev heart final quarter hammer');
    const spot = heartQuarterSpot('hammer');
    f.gather(spot.x, spot.z, 6);
    let whirls = 0;
    for (let t = 0; t < sec(30); t++) {
      if (f.objects(FINAL_OBJECTS.whirlPrefix).length > 0) whirls++;
      f.tick(1);
    }
    expect(whirls).toBeGreaterThan(0);
  });

  it('a poured Quench chills everywhere: alone, the cold rises at half its pace', () => {
    const f = finalFight(6);
    toCall(f, 'hammer');
    f.dev('/dev heart final killadds');
    f.dev('/dev heart final splinter quench');
    f.tick(sec(3));
    f.dev('/dev heart final endcall');
    f.dev('/dev heart final quarter breath');
    const spot = heartQuarterSpot('breath');
    f.players.forEach((p, i) => {
      f.put(p, spot.x + (i - 3) * 14, spot.z);
    });
    f.tick(sec(2));
    const cold = f.state()?.cold[f.players[5].id] ?? 0;
    expect(cold).toBeGreaterThan(10);
    expect(cold).toBeLessThan(30);
  });
});

describe('determinism', () => {
  it('the same seed fights the same intermission', () => {
    const run = () => {
      const f = finalFight(6, 77);
      f.dev('/dev heart final mythic');
      toCall(f);
      const ev = f.tick(sec(25));
      return ev
        .filter((e): e is Damage => e.type === 'damage')
        .map((e) => `${e.ability}:${e.targetId}:${e.amount}`)
        .join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('the headless full fight, 100 to 0', () => {
  for (const tier of ['normal', 'heroic', 'mythic'] as const)
    it(`${tier}: dragged round the quarters, both intermissions, the final phase, the kill`, () => {
      const f = finalFight(8, 91);
      if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
      f.pullIn('heat');
      const tank = f.players[0];
      const order: SmithHeartVein[] = ['breath', 'quench', 'hammer', 'heat'];
      let next = 0;
      let inZone = 0;
      const stages = new Set<string>();
      const names = new Set<string>();
      let calls = 0;
      let lastStage = 'fight';
      const b = f.boss();
      for (let t = 0; t < sec(900); t++) {
        const st = f.state();
        if (!st) break;
        const stage = st.phase.stage;
        stages.add(stage);
        if (stage === 'call' && lastStage !== 'call') calls++;
        lastStage = stage;
        if (stage === 'fight') {
          inZone++;
          if (inZone > sec(18) && st.rootLeft <= 0) {
            const target = heartQuarterSpot(order[next % 4]);
            f.put(tank, target.x, target.z);
            const here = f.local(b);
            if (heartQuarterAt(here.x, here.z) === order[next % 4]) {
              next++;
              inZone = 0;
            }
          }
        }
        // The raid burns the boss, and its Splinters first while they live.
        const adds = splinters(f).filter((e) => !e.damageImmune);
        if (adds.length > 0)
          f.sim.ctx.dealDamage(f.players[1], adds[0], 22, false, 'physical', 'Strike', 'hit');
        else strike(f, Math.round(b.maxHp / sec(300)));
        for (const e of f.tick(1)) if (e.type === 'damage' && e.ability) names.add(e.ability);
        if (b.dead) break;
      }
      expect(b.dead).toBe(true);
      expect(calls).toBe(2);
      for (const s of ['fight', 'leap', 'call', 'finalLeap', 'final'])
        expect(stages, s).toContain(s);
      expect(names).toContain(FINAL_NAMES.pulse);
      expect(names).toContain(N.splinter);
      expect(names).toContain(N.shear);
      const st = b.smithHeartFinal;
      expect(st?.finished).toBe(true);
      // The floor is clean: every footprint, ring and Splinter gone.
      for (const prefix of [...Object.values(FINAL_OBJECTS), FINAL_PHASE_OBJECTS.ringPrefix])
        expect(f.objects(prefix).length, prefix).toBe(0);
      expect(splinters(f).length).toBe(0);
      for (const p of f.players) {
        expect(aura(p, A.coal)).toBeUndefined();
        expect(aura(p, A.tether)).toBeUndefined();
      }
      expect(aura(b, A.phase)).toBeUndefined();
    });
});
