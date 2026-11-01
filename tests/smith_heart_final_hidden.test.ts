// The Masterless Strength's hidden phase (encounters/smith_heart/final_hidden.ts,
// design doc 7.5) over a REAL Sim: Mythic only, the stop at 1 percent, the scene
// unharmable, exactly 20 percent, the fall order from the frozen bars, the 30 s
// clock, who dies and who does not, nothing over the void, the ring's wipe, a
// real kill, a reset restoring the floor, determinism.

import { describe, expect, it } from 'vitest';
import {
  HEART_COLLAPSE_LOOK,
  HEART_REBIRTH_BEATS,
  heartLandmarkFall,
  heartRebirthBeat,
  heartRebirthBeats,
  heartSlabPose,
  heartSlabsLive,
  newHeartCollapseState,
  newHeartCollapseView,
  readHeartCollapse,
  stepHeartCollapse,
} from '../src/render/smith_heart/heart_collapse_core';
import type { SmithHeartVein } from '../src/sim/content/smith_heart_layout';
import { HEART_ROOM } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterSpot,
} from '../src/sim/content/smith_heart_quarters';
import { FINAL_OBJECTS } from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_PHASE_DIFFICULTY,
  hiddenCellGoes,
  hiddenFallenAt,
  hiddenFallOrder,
  hiddenNextCode,
  hiddenNextOf,
  FINAL_PHASE_NAMES as N,
  FINAL_PHASES as P,
  quarterBit,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import type { Entity, SimEvent } from '../src/sim/types';
import { type FinalFight, finalFight } from './helpers/final_fight';

const sec = (s: number) => Math.round(s * 20);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
/** Long enough for any stretch of floor to go and a body on it to reach the bottom. */
const WHOLE_FALL = 2 + P.plungeSeconds;
const strike = (f: FinalFight, amount: number) =>
  f.sim.ctx.dealDamage(f.players[1], f.boss(), amount, false, 'physical', 'Strike', 'hit');

/** A Mythic fight in its final phase, the raid on the ring. */
function toFinal(tier: 'mythic' | 'heroic' | 'normal' = 'mythic', seed = 41): FinalFight {
  const f = finalFight(5, seed);
  if (tier !== 'normal') f.dev(`/dev heart final ${tier}`);
  f.pullIn('heat');
  f.dev('/dev heart final fill all 0');
  f.dev('/dev heart final last');
  f.gather(HEART_ROOM.x, HEART_ROOM.z, 5);
  for (let i = 0; i < sec(5) && f.state()?.phase.stage !== 'final'; i++) f.tick(1);
  expect(f.state()?.phase.stage).toBe('final');
  return f;
}

/** Keep the raid on the ring through `n` ticks. */
function onRing(f: FinalFight, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    for (const [j, p] of f.players.entries()) {
      if (p.dead) continue;
      const here = f.local(p);
      if (Math.hypot(here.x - HEART_ROOM.x, here.z - HEART_ROOM.z) > 12) {
        const a = (j / f.players.length) * Math.PI * 2;
        f.put(p, HEART_ROOM.x + Math.sin(a) * 5, HEART_ROOM.z + Math.cos(a) * 5);
      }
    }
    out.push(...f.tick(1));
  }
  return out;
}

function toCollapse(f: FinalFight): void {
  f.dev('/dev heart final collapse');
  expect(f.state()?.phase.stage).toBe('collapse');
}

describe('the rows and the pure helpers', () => {
  it('only Mythic has it', () => {
    expect(FINAL_PHASE_DIFFICULTY.mythic.hiddenPhase).toBe(true);
    expect(FINAL_PHASE_DIFFICULTY.heroic.hiddenPhase).toBe(false);
    expect(FINAL_PHASE_DIFFICULTY.normal.hiddenPhase).toBe(false);
  });
  it('the order: fullest first, ties from the last quarter clockwise', () => {
    const bars = { breath: 0.2, quench: 0.9, hammer: 0.5, heat: 0.1 };
    expect(hiddenFallOrder(bars, null)).toEqual(['quench', 'hammer', 'breath', 'heat']);
    const even = { breath: 0.5, quench: 0.5, hammer: 0.5, heat: 0.5 };
    expect(hiddenFallOrder(even, 'hammer')).toEqual(['hammer', 'heat', 'breath', 'quench']);
  });
  it('the fallen test is the zone test, the ring and its lip excepted', () => {
    const mask = quarterBit('heat');
    const s = heartQuarterSpot('heat');
    expect(hiddenFallenAt(mask, s.x, s.z)).toBe(true);
    expect(hiddenFallenAt(0, s.x, s.z)).toBe(false);
    const q = heartQuarterSpot('quench');
    expect(hiddenFallenAt(mask, q.x, q.z)).toBe(false);
    expect(hiddenFallenAt(0b1111, HEART_ROOM.x, HEART_ROOM.z)).toBe(false);
  });
  it('the next code round-trips', () => {
    for (const v of [...HEART_QUARTER_ORDER, 'ring', null] as const)
      expect(hiddenNextOf(hiddenNextCode(v))).toBe(v);
  });
});

describe('the stop at 1 percent and the scene', () => {
  it('Mythic stops at 1 percent, unkillable through the scene, and rises to exactly 20', () => {
    const f = toFinal();
    const b = f.boss();
    strike(f, b.maxHp * 2);
    expect(b.dead).toBe(false);
    expect(b.hp).toBe(Math.ceil(b.maxHp * P.hiddenAt));
    f.tick(1);
    expect(f.state()?.phase.stage).toBe('kneel');
    const low = b.hp;
    strike(f, b.maxHp * 2);
    expect(b.hp).toBe(low);
    onRing(f, sec(P.kneelSeconds) + 1);
    expect(f.state()?.phase.stage).toBe('rebirth');
    strike(f, b.maxHp * 2);
    expect(b.dead).toBe(false);
    expect(b.hp).toBeGreaterThanOrEqual(low);
    onRing(f, sec(P.rebirthSeconds) + 1);
    expect(f.state()?.phase.stage).toBe('collapse');
    expect(b.hp).toBe(Math.ceil(b.maxHp * P.rebirthTo));
    expect(b.damageImmune).toBeFalsy();
    expect(b.hostile).toBe(true);
  });

  it('every ability stops in the scene: no footprint, no bar, no hit from it', () => {
    const f = toFinal();
    onRing(f, sec(P.mixFirst + P.mixEvery * 2));
    strike(f, f.boss().maxHp * 2);
    f.tick(1);
    expect(f.state()?.phase.stage).toBe('kneel');
    expect(f.boss().castingAbility).toBeNull();
    for (const prefix of Object.values(FINAL_OBJECTS))
      expect(f.objects(prefix).length, prefix).toBe(0);
    const ev = onRing(f, sec(P.kneelSeconds));
    expect(ev.filter((e) => e.type === 'damage' && e.sourceId === f.boss().id).length).toBe(0);
  });

  it('Normal and Heroic die at 0 percent, with no hidden state ever', () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const f = toFinal(tier);
      const b = f.boss();
      strike(f, b.maxHp * 2);
      f.tick(1);
      expect(b.dead, tier).toBe(true);
      expect(f.state()?.phase.hidden ?? null, tier).toBeNull();
      expect(f.state()?.phase.fallenMask, tier).toBe(0);
    }
  });

  it('a Splinter alive at 1 percent ends cleanly', () => {
    const f = finalFight(5, 41);
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    f.dev('/dev heart final splinter heat');
    expect(f.state()?.phase.adds.length).toBe(1);
    f.dev('/dev heart final hidden');
    expect(f.state()?.phase.stage).toBe('kneel');
    expect(f.state()?.phase.adds.length).toBe(0);
    expect(aura(f.boss(), A.shield)).toBeUndefined();
  });

  it('the Fury does not run in the hidden phase', () => {
    const f = toFinal();
    f.dev('/dev heart final enrage');
    expect(aura(f.boss(), A.fury)).toBeDefined();
    f.dev('/dev heart final collapse');
    expect(aura(f.boss(), A.fury)).toBeUndefined();
    // The pulse the dev verb itself fired lands on the next tick's events.
    onRing(f, 2);
    const ev = onRing(f, sec(10));
    expect(ev.some((e) => e.type === 'damage' && e.ability === N.fury)).toBe(false);
  });
});

describe('the collapse', () => {
  it('freezes the bars: the fullest as the final phase began falls first, on a 30 s clock', () => {
    const f = finalFight(5, 41);
    f.dev('/dev heart final mythic');
    f.pullIn('heat');
    f.dev('/dev heart final fill heat 10');
    f.dev('/dev heart final fill quench 90');
    f.dev('/dev heart final fill breath 40');
    f.dev('/dev heart final fill hammer 70');
    f.dev('/dev heart final last');
    for (let i = 0; i < sec(5) && f.state()?.phase.stage !== 'final'; i++) f.tick(1);
    f.gather(HEART_ROOM.x, HEART_ROOM.z, 5);
    // The final phase switched the bars off; the order still reads them.
    expect(f.state()?.overload.quench).toBe(0);
    toCollapse(f);
    const st = f.state();
    expect(st?.phase.hidden?.order).toEqual(['quench', 'hammer', 'breath', 'heat']);
    const b = f.boss();
    const fallen = () => st?.phase.fallenMask ?? 0;
    onRing(f, sec(P.fallEvery - P.fallWarn) - 2);
    expect(aura(b, A.hidden)?.value2).toBe(hiddenNextCode('quench'));
    const warned = onRing(f, 4);
    expect(warned.some((e) => e.type === 'chat' && e.text.includes("Quench's quarter"))).toBe(true);
    // The warning: its floor is still safe.
    expect(fallen()).toBe(0);
    onRing(f, sec(P.fallWarn) - 3);
    expect(fallen()).toBe(0);
    onRing(f, 1);
    expect(fallen()).toBe(quarterBit('quench'));
    onRing(f, sec(P.fallEvery));
    expect(fallen()).toBe(quarterBit('quench') | quarterBit('hammer'));
    expect(aura(b, A.hidden)?.value).toBe(fallen());
    b.hp = b.maxHp;
    onRing(f, sec(P.fallEvery * 2));
    expect(fallen()).toBe(0b1111);
    expect(aura(b, A.hidden)?.value2).toBe(hiddenNextCode('ring'));
  });

  it('a player on a falling quarter dies, whatever shields them; the others do not', () => {
    const f = toFinal();
    toCollapse(f);
    const order = f.state()?.phase.hidden?.order as SmithHeartVein[];
    const onIt = heartQuarterSpot(order[0]);
    const safe = heartQuarterSpot(order[1]);
    const [doomed, shielded, survivor] = f.players;
    f.put(doomed, onIt.x, onIt.z);
    f.put(shielded, onIt.x + 1, onIt.z + 1);
    f.put(survivor, safe.x, safe.z);
    shielded.damageImmune = true;
    f.dev('/dev heart final fall');
    f.tick(sec(WHOLE_FALL));
    expect(doomed.dead).toBe(true);
    expect(shielded.dead).toBe(true);
    expect(survivor.dead).toBe(false);
    // The corpse lies on the ring: no resurrection lands over the void.
    const d = f.local(doomed);
    expect(heartQuarterAt(d.x, d.z)).toBe('ring');
    expect(doomed.pos.y).toBeGreaterThan(-1);
  });

  it('a body stands until its own stretch of floor has gone, then really falls', () => {
    const f = toFinal();
    toCollapse(f);
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    const spot = heartQuarterSpot(v);
    const p = f.players[2];
    f.put(p, spot.x, spot.z);
    const floor = p.pos.y;
    f.dev('/dev heart final fall');
    const goes = hiddenCellGoes(Math.hypot(spot.x - HEART_ROOM.x, spot.z - HEART_ROOM.z));
    f.tick(sec(goes) - 2);
    expect(p.pos.y).toBe(floor);
    expect(p.carriedBy).toBeUndefined();
    // Its floor goes: down it drops, held by nothing, past all control, still alive.
    f.tick(sec(1) + 2);
    expect(p.dead).toBe(false);
    expect(p.carriedBy).toBe(p.id);
    expect(f.sim.ctx.isStunned(p)).toBe(true);
    const a = p.pos.y;
    expect(a).toBeLessThan(floor - 3);
    f.tick(sec(0.5));
    expect(p.pos.y).toBeLessThan(a - 3);
    expect(p.dead).toBe(false);
    // At the bottom it is dead, and nothing is left holding it.
    const ev = f.tick(sec(P.plungeSeconds));
    expect(p.dead).toBe(true);
    expect(p.carriedBy).toBeUndefined();
    expect(aura(p, A.plunge)).toBeUndefined();
    expect(f.state()?.phase.hidden?.plunges).toEqual([]);
    expect(ev.some((e) => e.type === 'damage' && e.ability === N.falling)).toBe(true);
  });

  it('it falls deep and keeps the way of the step that took it over', () => {
    const f = toFinal();
    toCollapse(f);
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    f.dev('/dev heart final fall');
    f.tick(sec(WHOLE_FALL));
    // Walk off the ring's edge with real steps, straight over the fallen quarter.
    const spot = heartQuarterSpot(v);
    const dx = spot.x - HEART_ROOM.x;
    const dz = spot.z - HEART_ROOM.z;
    const d = Math.hypot(dx, dz);
    const p = f.players[2];
    const edge = HEART_QUARTERS.ringR - 1;
    f.put(p, HEART_ROOM.x + (dx / d) * edge, HEART_ROOM.z + (dz / d) * edge);
    for (let i = 0; i < sec(3) && p.carriedBy === undefined; i++) f.walkStep(p, spot.x, spot.z);
    expect(p.carriedBy).toBe(p.id);
    const from = f.local(p);
    const r0 = Math.hypot(from.x - HEART_ROOM.x, from.z - HEART_ROOM.z);
    let deepest = 0;
    let r1 = r0;
    for (let i = 0; i < sec(P.plungeSeconds) - 2; i++) {
      f.tick(1);
      deepest = Math.min(deepest, p.pos.y);
      const q = f.local(p);
      r1 = Math.hypot(q.x - HEART_ROOM.x, q.z - HEART_ROOM.z);
    }
    expect(deepest).toBeLessThan(-40);
    // It carried on outward, clear of the edge it stepped off.
    expect(r1).toBeGreaterThan(r0 + 2);
  });

  it('a body can outrun the break to the ring', () => {
    const f = toFinal();
    toCollapse(f);
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    const spot = heartQuarterSpot(v);
    const p = f.players[2];
    f.put(p, spot.x, spot.z);
    f.dev('/dev heart final fall');
    f.tick(2);
    f.put(p, HEART_ROOM.x, HEART_ROOM.z);
    f.tick(sec(WHOLE_FALL));
    expect(p.dead).toBe(false);
    expect(p.carriedBy).toBeUndefined();
  });

  it('walking onto fallen floor later drops it at once, and kills too', () => {
    const f = toFinal();
    toCollapse(f);
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    f.dev('/dev heart final fall');
    f.tick(sec(WHOLE_FALL));
    const spot = heartQuarterSpot(v);
    f.put(f.players[2], spot.x, spot.z);
    f.tick(1);
    expect(f.players[2].carriedBy).toBe(f.players[2].id);
    f.tick(sec(WHOLE_FALL));
    expect(f.players[2].dead).toBe(true);
  });

  it('a game master falls too, and is set back on the ring alive', () => {
    const f = toFinal();
    toCollapse(f);
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    const spot = heartQuarterSpot(v);
    const gm = f.players[3];
    gm.gm = true;
    f.put(gm, spot.x, spot.z);
    f.dev('/dev heart final fall');
    f.tick(sec(WHOLE_FALL));
    expect(gm.dead).toBe(false);
    expect(gm.carriedBy).toBeUndefined();
    const here = f.local(gm);
    expect(heartQuarterAt(here.x, here.z)).toBe('ring');
    expect(gm.pos.y).toBeGreaterThan(-1);
  });

  it('a fight ending mid-fall sets the body back on the ring, alive', () => {
    for (const end of ['kill', 'reset'] as const) {
      const f = toFinal();
      toCollapse(f);
      const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
      const spot = heartQuarterSpot(v);
      const p = f.players[2];
      f.put(p, spot.x, spot.z);
      f.dev('/dev heart final fall');
      for (let i = 0; i < sec(4) && p.carriedBy === undefined; i++) f.tick(1);
      f.tick(sec(0.6));
      expect(p.carriedBy).toBe(p.id);
      if (end === 'kill') {
        strike(f, f.boss().maxHp * 2);
        f.tick(2);
      } else f.dev('/dev heart final reset');
      expect(p.dead, end).toBe(false);
      expect(p.carriedBy, end).toBeUndefined();
      expect(aura(p, A.plunge), end).toBeUndefined();
      const here = f.local(p);
      expect(heartQuarterAt(here.x, here.z), end).toBe('ring');
      expect(p.pos.y, end).toBeGreaterThan(-1);
    }
  });

  it('dying on the way down leaves the corpse on the ring', () => {
    const f = toFinal();
    toCollapse(f);
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    const spot = heartQuarterSpot(v);
    const p = f.players[2];
    f.put(p, spot.x, spot.z);
    f.dev('/dev heart final fall');
    for (let i = 0; i < sec(4) && p.carriedBy === undefined; i++) f.tick(1);
    f.tick(sec(0.6));
    f.sim.ctx.handleDeath(p, null, 'Strike');
    f.tick(2);
    expect(p.dead).toBe(true);
    expect(p.carriedBy).toBeUndefined();
    const here = f.local(p);
    expect(heartQuarterAt(here.x, here.z)).toBe('ring');
    expect(p.pos.y).toBeGreaterThan(-1);
  });

  it('nothing is placed or left over fallen floor', () => {
    const f = toFinal();
    toCollapse(f);
    const order = f.state()?.phase.hidden?.order as SmithHeartVein[];
    f.dev('/dev heart final fall');
    f.dev('/dev heart final fall');
    f.dev('/dev heart final fall');
    const mask = f.state()?.phase.fallenMask ?? 0;
    const last = heartQuarterSpot(order[3]);
    // The raid at the last quarter's edge, the kit firing for a whole minute.
    for (const p of f.players) f.put(p, last.x, last.z);
    const prefixes = Object.values(FINAL_OBJECTS);
    for (let t = 0; t < sec(26); t++) {
      f.tick(1);
      for (const prefix of prefixes)
        for (const o of f.objects(prefix)) {
          const q = f.local(o);
          expect(hiddenFallenAt(mask, q.x, q.z), `${o.templateId}`).toBe(false);
        }
    }
    // And a footprint on a quarter when it falls goes with it.
    f.dev('/dev heart final ice');
    expect(f.objects(FINAL_OBJECTS.crackPrefix).length).toBeGreaterThan(0);
    f.dev('/dev heart final fall');
    expect(f.objects(FINAL_OBJECTS.crackPrefix).length).toBe(0);
  });

  it('the ring cracks after the last quarter, then breaks: a wipe', () => {
    const f = toFinal();
    toCollapse(f);
    const gm = f.players[4];
    gm.gm = true;
    f.dev('/dev heart final crack');
    expect(f.state()?.phase.fallenMask).toBe(0b1111);
    onRing(f, sec(P.ringWarn) - 2);
    expect(f.players[0].dead).toBe(false);
    const ev = onRing(f, 3);
    for (const p of f.players.slice(0, 4)) expect(p.dead).toBe(true);
    expect(gm.dead).toBe(false);
    expect(ev.some((e) => e.type === 'damage' && e.ability === N.anvilEnd)).toBe(true);
  });

  it('a real kill stops the collapse, with the normal end', () => {
    const f = toFinal();
    toCollapse(f);
    f.dev('/dev heart final fall');
    const b = f.boss();
    strike(f, b.maxHp * 2);
    expect(b.dead).toBe(true);
    f.tick(2);
    expect(f.state()?.finished).toBe(true);
    expect(aura(b, A.hidden)).toBeUndefined();
    expect(aura(b, A.phase)).toBeUndefined();
    for (const prefix of Object.values(FINAL_OBJECTS))
      expect(f.objects(prefix).length, prefix).toBe(0);
    // Nothing more falls, and walking where the floor was is safe.
    const v = f.state()?.phase.hidden?.order[0] as SmithHeartVein;
    const spot = heartQuarterSpot(v);
    f.put(f.players[2], spot.x, spot.z);
    f.tick(sec(35));
    expect(f.players[2].dead).toBe(false);
  });

  it('a reset restores every quarter', () => {
    const f = toFinal();
    toCollapse(f);
    f.dev('/dev heart final crack');
    f.tick(1);
    expect(aura(f.boss(), A.hidden)).toBeDefined();
    f.dev('/dev heart final reset');
    const b = f.boss();
    expect(b.smithHeartFinal ?? null).toBeNull();
    expect(aura(b, A.hidden)).toBeUndefined();
    expect(b.damageImmune).toBeFalsy();
    f.pullIn('quench');
    expect(f.state()?.phase.fallenMask).toBe(0);
    expect(f.state()?.phase.hidden).toBeNull();
    const spot = heartQuarterSpot('heat');
    f.put(f.players[2], spot.x, spot.z);
    f.tick(2);
    expect(f.players[2].dead).toBe(false);
  });

  it('a real wipe resets the fight and the floor', () => {
    const f = toFinal();
    toCollapse(f);
    f.dev('/dev heart final crack');
    for (let i = 0; i < sec(P.ringWarn) + 2; i++) f.tick(1, false);
    for (const p of f.players) expect(p.dead).toBe(true);
    for (let i = 0; i < sec(30) && f.boss().smithHeartFinal; i++) f.tick(1, false);
    expect(f.boss().smithHeartFinal ?? null).toBeNull();
    expect(aura(f.boss(), A.hidden)).toBeUndefined();
  });

  it('the same seed collapses the same way', () => {
    const run = () => {
      const f = toFinal('mythic', 77);
      strike(f, f.boss().maxHp * 2);
      const ev = onRing(f, sec(P.kneelSeconds + P.rebirthSeconds + 70));
      return ev
        .filter((e) => e.type === 'damage')
        .map((e) => (e.type === 'damage' ? `${e.ability}:${e.targetId}:${e.amount}` : ''))
        .join('|');
    };
    const a = run();
    expect(a.length).toBeGreaterThan(0);
    expect(run()).toBe(a);
  });

  it('the ring is exactly what stays: the geometry the kill reads', () => {
    expect(heartQuarterAt(HEART_ROOM.x + HEART_QUARTERS.ringR - 0.1, HEART_ROOM.z)).toBe('ring');
  });
});

describe('the room reads it (heart_collapse_core.ts)', () => {
  it('reads the stage, the fallen mask, the next and the seconds off the auras', () => {
    const f = toFinal();
    toCollapse(f);
    f.dev('/dev heart final fall');
    f.tick(1);
    const view = newHeartCollapseView();
    readHeartCollapse(f.boss().auras, view);
    expect(view.stage).toBe('collapse');
    expect(view.fallen).toBe(f.state()?.phase.fallenMask);
    expect(view.next).toBe(f.state()?.phase.hidden?.order[1]);
    expect(view.seconds).toBeGreaterThan(0);
    readHeartCollapse([], view);
    expect(view.stage).toBe('none');
    expect(view.fallen).toBe(0);
  });

  it('a quarter falls, the warned one cracks, a reset rises back whole', () => {
    const s = newHeartCollapseState();
    const v = newHeartCollapseView();
    v.stage = 'collapse';
    v.next = 'heat';
    v.seconds = 20;
    stepHeartCollapse(s, v, 0.05);
    for (let i = 0; i < 40; i++) stepHeartCollapse(s, v, 0.05);
    expect(s.quarters.heat.crack).toBeCloseTo(HEART_COLLAPSE_LOOK.nextMark, 3);
    v.seconds = P.fallWarn;
    for (let i = 0; i < 40; i++) stepHeartCollapse(s, v, 0.05);
    expect(s.quarters.heat.crack).toBe(1);
    expect(s.quarters.heat.t).toBe(-1);
    v.fallen = quarterBit('heat');
    v.next = 'breath';
    stepHeartCollapse(s, v, 0.05);
    expect(s.quarters.heat.t).toBe(0);
    expect(s.quarters.heat.crack).toBe(0);
    for (let i = 0; i < 40; i++) stepHeartCollapse(s, v, 0.05);
    const dimOne = s.dim;
    expect(dimOne).toBeGreaterThan(HEART_COLLAPSE_LOOK.dimRisen);
    v.stage = 'none';
    v.fallen = 0;
    v.next = null;
    for (let i = 0; i < 400; i++) stepHeartCollapse(s, v, 0.05);
    expect(s.quarters.heat.t).toBe(-1);
    expect(s.dim).toBe(0);
  });

  it('a late arrival sees the floor already gone, no replayed fall', () => {
    const s = newHeartCollapseState();
    const v = newHeartCollapseView();
    v.stage = 'collapse';
    v.fallen = quarterBit('quench');
    stepHeartCollapse(s, v, 0.05);
    expect(s.quarters.quench.t).toBe(HEART_COLLAPSE_LOOK.fallSeconds);
    expect(heartSlabsLive(s.quarters.quench.t)).toBe(false);
  });

  it('the beats close up and harden; slabs go from the wall inward; the landmark topples', () => {
    expect(heartRebirthBeats(P.rebirthSeconds)).toBe(HEART_REBIRTH_BEATS.length);
    expect(HEART_REBIRTH_BEATS[HEART_REBIRTH_BEATS.length - 1]).toBeLessThan(P.rebirthSeconds);
    const last = HEART_REBIRTH_BEATS[HEART_REBIRTH_BEATS.length - 1];
    expect(heartRebirthBeat(last)).toBeGreaterThan(heartRebirthBeat(HEART_REBIRTH_BEATS[0]));
    const out = { drop: 0, turn: 0, gone: false };
    const { ringR, rimR } = HEART_QUARTERS;
    heartSlabPose(rimR, 0, 0.8, out);
    const outer = out.drop;
    heartSlabPose(ringR + 2, 0, 0.8, out);
    expect(outer).toBeGreaterThan(out.drop);
    expect(heartLandmarkFall(-1).tilt).toBe(0);
    expect(heartLandmarkFall(HEART_COLLAPSE_LOOK.fallSeconds).gone).toBe(true);
  });
});
