// The Guardian of the Heat (docs/design/raid/smith_heart.md section 7.4) over
// a REAL Sim: the heat rising and driving the Hearth Pulse, the wind-up and
// Hearthburst at 100, the Kindled Crystals (the nearest player takes the ray
// and cools the Hearth; nobody near and the ray heats it), Crystal Burn's
// stacks and their fading, the crystals burning out, the channel's clock and
// its fire, heroic's three crystals, slower burns and Knell Embers, the
// stoking (the soft enrage), the wipe putting the Hearth back, the Heat vein
// and the seal's quarter lit by the fall, and determinism.

import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_CASTS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
} from '../src/sim/content/smith_heart';
import { HEARTH_CHANNEL, HEARTH_CRYSTAL_SOCKETS } from '../src/sim/content/smith_heart_layout';
import {
  burnAmp,
  channelOf,
  channelSide,
  crystalOf,
  embersOf,
  HEAT_AURAS,
  HEAT_CASTS,
  HEAT_CUES,
  HEAT_DIFFICULTY,
  HEAT_NAMES,
  HEAT_OBJECTS,
  inChannel,
  inHearthFloor,
  nearestInReach,
  pickSockets,
  pulseDamage,
  riseOf,
  smithHeartProgress,
  smithHeartVeinWon,
  stokeMult,
  HEAT_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { DT, type Entity, type SimEvent } from '../src/sim/types';
import { hitsOf } from './helpers/council_fight';
import { HEAT_WAIT_SPOTS, type HeatFight, heatFight } from './helpers/heat_fight';

const has = (e: Entity, id: string) => e.auras.some((a) => a.id === id);
const aura = (e: Entity, id: string) => e.auras.find((a) => a.id === id);
const ticks = (s: number) => Math.round(s / DT);

/** A pulled fight with its clocks held off (a test that wants one asks). */
function pulled(n = 5, seed = 31): HeatFight {
  const f = heatFight(n, seed);
  expect(f.dev('/dev heart heat pull')).toBe(true);
  f.tick(2);
  const st = f.state();
  if (!st) throw new Error('no fight');
  hold(f);
  return f;
}

/** Hold every clock but the heat's own (no Shed Heat, channel, stoking). */
function hold(f: HeatFight): void {
  const st = f.state();
  if (!st) throw new Error('no fight');
  st.shedTimer = 999;
  st.channel.remaining = 999;
  st.stokeTimer = 999;
}

/** Hold the trash kit's own casts (Molten Pour, Searing Knell) off the tank. */
function holdKit(f: HeatFight): void {
  const kit = f.boss().trashKit;
  if (!kit) throw new Error('no kit state');
  kit.timers.line = 999;
  kit.timers.screech = 999;
}

function until(f: HeatFight, pred: () => boolean, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds * 20 && !pred(); i++) out.push(...f.tick(1));
  return out;
}

const cues = (ev: readonly SimEvent[], ability: string) =>
  ev.filter(
    (e) =>
      (e.type === 'spellfx' || e.type === 'spellfxAt') &&
      (e as { ability?: string }).ability === ability,
  );

const warnKeys = (ev: readonly SimEvent[]) =>
  ev
    .filter((e) => e.type === 'chat')
    .map((e) => (e as { textKey?: string }).textKey ?? '')
    .filter((k) => k.startsWith('hudChrome.heatGuardian.'));

/** Put every player back on their waiting spot (out of every reach). */
function parkAll(f: HeatFight): void {
  f.players.forEach((p, i) => {
    const s = HEAT_WAIT_SPOTS[i];
    f.put(p, s.x, s.z);
  });
}

describe('Guardian of the Heat: the ids', () => {
  it("keeps the trash kit's cast ids (the knell's embers key on its stun)", () => {
    expect(HEAT_CASTS.knell).toBe(SMITH_HEART_CASTS.heatClang);
    expect(HEAT_CASTS.pour).toBe(SMITH_HEART_CASTS.heatPour);
    const kit = SMITH_HEART_MOBS[SMITH_HEART_GUARDIANS.heat].trashKit;
    expect(kit?.screech?.castId).toBe(HEAT_CASTS.knell);
    expect(kit?.screech?.stun).toBe(T.knellStun);
    expect(kit?.line?.castId).toBe(HEAT_CASTS.pour);
  });
});

describe('Guardian of the Heat: the geometry', () => {
  it('knows the floor, the channel and its halves, and the nearest body in reach', () => {
    expect(inHearthFloor(-214, 0)).toBe(true);
    expect(inHearthFloor(-150, 0)).toBe(false);
    for (const s of HEARTH_CRYSTAL_SOCKETS) expect(inHearthFloor(s.x, s.z)).toBe(true);
    for (const s of HEAT_WAIT_SPOTS) expect(inHearthFloor(s.x, s.z)).toBe(true);
    expect(inChannel(HEARTH_CHANNEL.x + 2.9, 10, T.channelHalf)).toBe(true);
    expect(inChannel(HEARTH_CHANNEL.x + 3.1, 10, T.channelHalf)).toBe(false);
    for (const s of HEARTH_CRYSTAL_SOCKETS) expect(channelSide(s.x)).toBe(s.side);
    const from = { x: 0, z: 0 };
    expect(
      nearestInReach(
        from,
        [
          { id: 3, x: 4, z: 0 },
          { id: 1, x: 0, z: 4 },
          { id: 2, x: 2, z: 0 },
        ],
        10,
      )?.id,
    ).toBe(2);
    // A tie goes to the lower id; nobody within reach is nobody.
    expect(
      nearestInReach(
        from,
        [
          { id: 7, x: 3, z: 0 },
          { id: 4, x: 0, z: 3 },
        ],
        10,
      )?.id,
    ).toBe(4);
    expect(nearestInReach(from, [{ id: 1, x: 11, z: 0 }], 10)).toBeNull();
  });

  it('raises one crystal each side of the channel, heroic a third alternating sides, never twice', () => {
    for (let w = 0; w < 12; w++) {
      const two = pickSockets(w, 2);
      expect(two.map((i) => HEARTH_CRYSTAL_SOCKETS[i].side).sort()).toEqual([-1, 1]);
      const three = pickSockets(w, 3);
      expect(new Set(three).size).toBe(3);
      expect(three.slice(0, 2)).toEqual(two);
      const third = HEARTH_CRYSTAL_SOCKETS[three[2]].side;
      expect(third).toBe(w % 2 === 0 ? 1 : -1);
    }
  });
});

describe('Guardian of the Heat: the heat', () => {
  it('rises about a point a second, on the guardian and on every player, and drives the Hearth Pulse', () => {
    const f = pulled();
    holdKit(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const before = st.heat;
    const ev = f.tick(ticks(10));
    expect(st.heat - before).toBeCloseTo(10, 0);
    expect(f.boss().resource).toBe(Math.round(st.heat));
    expect(f.boss().maxResource).toBe(T.heatMax);
    for (const p of f.players) {
      expect(aura(p, HEAT_AURAS.heat)?.value).toBe(Math.round(st.heat));
      expect(aura(p, HEAT_AURAS.heat)?.value2).toBe(1);
    }
    // A pulse every 3 s on everyone, its weight the heat's.
    const p0 = hitsOf(ev, HEAT_NAMES.pulse, f.players[3].id);
    expect(p0.length).toBe(3);
    expect(cues(ev, HEAT_CUES.pulse).length).toBe(3);
    // Hot, the same pulse is far heavier.
    st.heat = 80;
    const hot = hitsOf(f.tick(ticks(3)), HEAT_NAMES.pulse, f.players[3].id);
    expect(hot.length).toBe(1);
    expect(hot[0]).toBeGreaterThan(Math.max(...p0) * 3);
    expect(hot[0]).toBeGreaterThanOrEqual(Math.floor(pulseDamage(80) * (1 - T.pulseSpread)));
    expect(hot[0]).toBeLessThanOrEqual(Math.ceil(pulseDamage(80) * (1 + T.pulseSpread)));
  });

  it('winds up from 90 and overheats at 100: Hearthburst on everyone, then the Hearth has vented', () => {
    const f = pulled();
    holdKit(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    f.dev('/dev heart heat heat 89.5');
    let ev = f.tick(ticks(1));
    expect(st.windup).toBe(true);
    expect(has(f.boss(), HEAT_AURAS.overheating)).toBe(true);
    expect(warnKeys(ev)).toContain('hudChrome.heatGuardian.warn.windup');
    expect(cues(ev, HEAT_CUES.windup).length).toBe(1);
    ev = until(f, () => st.overheats > 0, 15);
    ev.push(...f.tick(1));
    expect(st.overheats).toBe(1);
    expect(st.heat).toBeLessThan(2);
    expect(has(f.boss(), HEAT_AURAS.overheating)).toBe(false);
    for (const p of f.players) {
      const hit = hitsOf(ev, HEAT_NAMES.overheat, p.id);
      expect(hit.length).toBe(1);
      expect(hit[0]).toBeGreaterThanOrEqual(HEAT_DIFFICULTY.normal.overheatMin);
    }
    expect(warnKeys(ev)).toContain('hudChrome.heatGuardian.warn.overheat');
  });

  it('a normal Hearthburst is a near wipe; a heroic one a wipe', () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const f = pulled(5, 33);
      holdKit(f);
      if (tier === 'heroic') f.dev('/dev heart heat heroic');
      for (const p of f.players) {
        p.maxHp = 1300;
        p.hp = 1300;
      }
      f.dev('/dev heart heat overheat');
      const dead = f.players.filter((p) => p.dead).length;
      if (tier === 'heroic') expect(dead).toBe(f.players.length);
      else for (const p of f.players) expect(p.dead || p.hp < 1300 * 0.35).toBe(true);
    }
  });

  it('the Hearth is stoked hotter every 40 s, without end (the soft enrage)', () => {
    const f = pulled();
    holdKit(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.stokeTimer = T.stokeEvery;
    f.tick(ticks(T.stokeEvery) + 1);
    expect(st.stokeStacks).toBe(1);
    expect(aura(f.boss(), HEAT_AURAS.stoked)?.stacks).toBe(1);
    st.heat = 0;
    f.tick(ticks(10));
    expect(st.heat).toBeCloseTo(10 * stokeMult(1), 0);
    f.tick(ticks(T.stokeEvery * 2));
    expect(st.stokeStacks).toBe(3);
  });
});

describe('Guardian of the Heat: the Kindled Crystals', () => {
  it('Shed Heat at 14 s shows the rise spots through its bar, then raises two crystals, one each side', () => {
    const f = heatFight();
    f.dev('/dev heart heat pull');
    f.tick(1);
    holdKit(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.channel.remaining = 999;
    let ev = until(f, () => f.boss().castingAbility === HEAT_CASTS.shed, 16);
    expect(st.clock).toBeGreaterThan(T.shedFirst - 0.2);
    const rises = f.objects(HEAT_OBJECTS.risePrefix);
    expect(rises.length).toBe(2);
    for (const r of rises) expect(riseOf(r.templateId)).toBeCloseTo(T.shedCast, 5);
    expect(warnKeys(ev)).toContain('hudChrome.heatGuardian.warn.crystals');
    ev = f.tick(ticks(T.shedCast) + 2);
    expect(f.objects(HEAT_OBJECTS.risePrefix)).toEqual([]);
    const crystals = f.objects(HEAT_OBJECTS.crystalPrefix);
    expect(crystals.length).toBe(2);
    for (const c of crystals) expect(crystalOf(c.templateId)).toBeCloseTo(T.crystalLife, 5);
    expect(st.crystals.map((c) => HEARTH_CRYSTAL_SOCKETS[c.socket].side).sort()).toEqual([-1, 1]);
    expect(cues(ev, HEAT_CUES.rise).length).toBe(2);
  });

  it('a ray strikes the NEAREST player in reach: a burn, a hit, and the Hearth cooled', () => {
    const f = pulled();
    holdKit(f);
    f.dev('/dev heart heat crystals');
    const st = f.state();
    if (!st) throw new Error('no fight');
    const [c] = st.crystals;
    // Two players near the first crystal: the nearer takes every ray.
    f.put(f.players[1], c.x + 3, c.z);
    f.put(f.players[2], c.x + 6, c.z);
    st.heat = 50;
    const ev = f.tick(ticks(T.rayFirst) + 1);
    const beams = cues(ev, HEAT_CUES.beam);
    expect(beams.length).toBe(1);
    expect((beams[0] as { sourceId: number }).sourceId).toBe(c.objectId);
    expect((beams[0] as { targetId: number }).targetId).toBe(f.players[1].id);
    expect(aura(f.players[1], HEAT_AURAS.burn)?.stacks).toBe(1);
    expect(has(f.players[2], HEAT_AURAS.burn)).toBe(false);
    expect(hitsOf(ev, HEAT_NAMES.ray, f.players[1].id).length).toBe(1);
    // The heat moved by the ray's cool, the other crystal's ray sent back
    // (nobody near it) and the rise of those ticks.
    const rise = (ticks(T.rayFirst) + 1) * DT * T.heatRise;
    expect(st.raysBack).toBe(1);
    expect(st.heat).toBeCloseTo(50 + rise - T.rayCool + T.rayBack, 5);
    expect(st.rays).toBe(1);
    expect(c.target).toBe(f.players[1].id);
    // The nearer steps away: the next ray takes the other.
    f.put(f.players[1], -190, -40);
    const ev2 = f.tick(ticks(T.rayEvery));
    expect((cues(ev2, HEAT_CUES.beam)[0] as { targetId: number }).targetId).toBe(f.players[2].id);
  });

  it('with nobody near enough the ray goes back into the guardian and heats the Hearth', () => {
    const f = pulled();
    holdKit(f);
    parkAll(f);
    f.dev('/dev heart heat crystals');
    const st = f.state();
    if (!st) throw new Error('no fight');
    // The tank too: nobody within reach of either crystal.
    for (const c of st.crystals)
      for (const p of f.players)
        expect(Math.hypot(f.local(p).x - c.x, f.local(p).z - c.z)).toBeGreaterThan(T.rayRange);
    st.heat = 40;
    const ev = f.tick(ticks(T.rayFirst) + 1);
    const back = cues(ev, HEAT_CUES.beamBack);
    expect(back.length).toBe(2);
    for (const b of back) expect((b as { targetId: number }).targetId).toBe(f.boss().id);
    expect(st.raysBack).toBe(2);
    expect(st.heat).toBeGreaterThan(40 + 2 * T.rayBack - 0.01);
  });

  it('Crystal Burn stacks, makes spell damage hurt more, and fades a stack every 6 s (10 s heroic)', () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const f = pulled();
      holdKit(f);
      if (tier === 'heroic') f.dev('/dev heart heat heroic');
      const p = f.players[3];
      f.dev('/dev heart heat burn 4', p.id);
      const a = aura(p, HEAT_AURAS.burn);
      expect(a?.stacks).toBe(4);
      expect(a?.kind).toBe('spellvuln');
      expect(a?.value).toBeCloseTo(burnAmp(4), 6);
      const decay = HEAT_DIFFICULTY[tier].burnDecay;
      f.tick(ticks(decay) - 4);
      expect(aura(p, HEAT_AURAS.burn)?.stacks).toBe(4);
      f.tick(6);
      expect(aura(p, HEAT_AURAS.burn)?.stacks).toBe(3);
      f.tick(ticks(decay * 3) + 4);
      expect(has(p, HEAT_AURAS.burn)).toBe(false);
    }
  });

  it('a burned player takes more from the Hearth Pulse', () => {
    const f = pulled();
    holdKit(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    const burned = f.players[3];
    const plain = f.players[4];
    f.dev('/dev heart heat burn 10', burned.id);
    st.heat = 60;
    const ev = f.tick(ticks(T.pulseEvery * 4));
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const b = sum(hitsOf(ev, HEAT_NAMES.pulse, burned.id));
    const n = sum(hitsOf(ev, HEAT_NAMES.pulse, plain.id));
    expect(b / n).toBeGreaterThan(1.35);
  });

  it('a crystal burns out after 20 s and stops firing', () => {
    const f = pulled();
    holdKit(f);
    f.dev('/dev heart heat crystals');
    const st = f.state();
    if (!st) throw new Error('no fight');
    let ev = f.tick(ticks(T.crystalLife) + 2);
    expect(st.crystals).toEqual([]);
    expect(f.objects(HEAT_OBJECTS.crystalPrefix)).toEqual([]);
    expect(cues(ev, HEAT_CUES.fade).length).toBe(2);
    // Ten rays each (one every 2 s from 1.5 s on), no more.
    expect(st.rays + st.raysBack).toBe(20);
    ev = f.tick(ticks(4));
    expect(cues(ev, HEAT_CUES.beam).length + cues(ev, HEAT_CUES.beamBack).length).toBe(0);
  });
});

describe('Guardian of the Heat: the channel', () => {
  it('lies still, brims 4 s (a raid warning), then flows 6 s, burning whoever stands in it, every 26 s', () => {
    const f = heatFight();
    f.dev('/dev heart heat pull');
    f.tick(1);
    holdKit(f);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.shedTimer = 999;
    const [obj] = f.objects(HEAT_OBJECTS.channelPrefix);
    expect(channelOf(obj.templateId)?.state).toBe('still');
    // One player in the channel's line, one beside it.
    const inIt = f.players[2];
    const beside = f.players[3];
    f.put(inIt, HEARTH_CHANNEL.x + 1, -20);
    f.put(beside, HEARTH_CHANNEL.x + 5, -20);
    let ev = until(f, () => st.channel.state === 'warn', 30);
    expect(st.clock).toBeCloseTo(T.channelFirst - T.channelWarn, 0);
    ev.push(...f.tick(1));
    expect(channelOf(obj.templateId)).toEqual({ state: 'warn', seconds: T.channelWarn });
    expect(warnKeys(ev)).toContain('hudChrome.heatGuardian.warn.channel');
    ev = until(f, () => st.channel.state === 'flow', 6);
    expect(st.clock).toBeCloseTo(T.channelFirst, 0);
    ev.push(...f.tick(ticks(T.channelFlow) + 2));
    expect(cues(ev, HEAT_CUES.flow).length).toBe(1);
    const burns = hitsOf(ev, HEAT_NAMES.channel, inIt.id);
    expect(burns.length).toBe(Math.round(T.channelFlow / T.channelTick));
    expect(hitsOf(ev, HEAT_NAMES.channel, beside.id)).toEqual([]);
    expect(st.channel.state).toBe('still');
    // The next brimming 26 s after the first.
    until(f, () => st.channel.state === 'warn', 30);
    expect(st.clock).toBeCloseTo(T.channelFirst - T.channelWarn + T.channelEvery, 0);
  });
});

describe('Guardian of the Heat: heroic', () => {
  it('raises three crystals', () => {
    const f = pulled();
    holdKit(f);
    f.dev('/dev heart heat heroic');
    expect(f.dev('/dev heart heat crystals')).toBe(true);
    expect(f.state()?.crystals.length).toBe(3);
    expect(f.objects(HEAT_OBJECTS.crystalPrefix).length).toBe(3);
  });

  it('Searing Knell leaves Knell Embers where each stunned player stood; never on normal', () => {
    for (const tier of ['normal', 'heroic'] as const) {
      const f = pulled();
      if (tier === 'heroic') f.dev('/dev heart heat heroic');
      const tank = f.players[0];
      const b = f.boss();
      // Everyone close to the guardian, then let the kit's knell land.
      f.put(f.players[1], f.local(b).x + 3, f.local(b).z + 1);
      f.put(tank, f.local(b).x + 2, f.local(b).z - 1);
      const st = f.state();
      if (!st) throw new Error('no fight');
      const ev = until(f, () => Object.keys(st.knellAt).length > 0, 30);
      ev.push(...f.tick(ticks(3)));
      expect(Object.keys(st.knellAt).length).toBeGreaterThan(0);
      const embers = f.objects(HEAT_OBJECTS.embersPrefix);
      if (tier === 'normal') {
        expect(embers).toEqual([]);
        continue;
      }
      expect(embers.length).toBe(Object.keys(st.knellAt).length);
      for (const e of embers) expect(embersOf(e.templateId)).toBeCloseTo(T.embersLife, 5);
      expect(cues(ev, HEAT_CUES.embers).length).toBe(embers.length);
    }
  });

  it('Knell Embers burn whoever stands in them every second, and burn out', () => {
    const f = pulled();
    holdKit(f);
    f.dev('/dev heart heat heroic');
    const p = f.players[3];
    f.dev('/dev heart heat embers', p.id);
    const ev = f.tick(ticks(3) + 1);
    expect(hitsOf(ev, HEAT_NAMES.embers, p.id).length).toBe(3);
    f.tick(ticks(T.embersLife));
    expect(f.objects(HEAT_OBJECTS.embersPrefix)).toEqual([]);
  });

  it('mythic is heroic whole behind its own switch', () => {
    expect(HEAT_DIFFICULTY.mythic).toEqual(HEAT_DIFFICULTY.heroic);
    const f = pulled();
    f.dev('/dev heart heat mythic');
    expect(f.state()?.difficulty).toBe('mythic');
    f.dev('/dev heart heat mythic off');
    expect(f.state()?.difficulty).toBe('normal');
  });
});

describe('Guardian of the Heat: the wipe and the fall', () => {
  it('a wipe puts the Hearth back: no heat, bar, crystal, burn, ember or marker, the channel gone', () => {
    const f = pulled();
    holdKit(f);
    f.dev('/dev heart heat heroic');
    f.dev('/dev heart heat crystals');
    f.dev('/dev heart heat burn 3', f.players[2].id);
    f.dev('/dev heart heat embers', f.players[2].id);
    f.dev('/dev heart heat heat 70');
    f.tick(4);
    expect(f.objects(HEAT_OBJECTS.crystalPrefix).length).toBe(3);
    // Everyone dies: the guardian walks home.
    for (const p of f.players) f.sim.ctx.handleDeath(p, f.boss());
    const ev = until(f, () => f.state() === null, 30);
    expect(f.state()).toBeNull();
    expect(warnKeys(ev)).toContain('hudChrome.heatGuardian.say.wipe');
    for (const prefix of Object.values(HEAT_OBJECTS)) expect(f.objects(prefix)).toEqual([]);
    for (const p of f.players) {
      expect(has(p, HEAT_AURAS.heat)).toBe(false);
      expect(has(p, HEAT_AURAS.burn)).toBe(false);
    }
    expect(f.boss().resource).toBe(0);
    expect(has(f.boss(), HEAT_AURAS.stoked)).toBe(false);
    expect(has(f.boss(), HEAT_AURAS.overheating)).toBe(false);
  });

  it("its fall lights the Heat vein and the seal's quarter; the Hearth settles", () => {
    const f = pulled(2);
    f.dev('/dev heart heat crystals');
    f.dev('/dev heart heat burn 2', f.players[1].id);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'heat')).toBe(false);
    f.sim.ctx.handleDeath(f.boss(), f.players[0]);
    const ev = f.tick(3);
    expect(smithHeartVeinWon(f.sim.ctx, f.inst, 'heat')).toBe(true);
    expect(smithHeartProgress(f.sim.ctx, f.inst).mask & 8).toBe(8);
    expect(warnKeys(ev)).toContain('hudChrome.heatGuardian.say.death');
    expect(cues(ev, HEAT_CUES.settle).length).toBe(1);
    expect(f.state()?.finished).toBe(true);
    for (const prefix of Object.values(HEAT_OBJECTS)) expect(f.objects(prefix)).toEqual([]);
    expect(has(f.players[1], HEAT_AURAS.burn)).toBe(false);
  });

  it('a player who leaves the floor loses the heat marker and the burn', () => {
    const f = pulled();
    holdKit(f);
    const p = f.players[3];
    f.dev('/dev heart heat burn 2', p.id);
    f.tick(2);
    expect(has(p, HEAT_AURAS.heat)).toBe(true);
    f.put(p, -150, 0);
    f.tick(2);
    expect(has(p, HEAT_AURAS.heat)).toBe(false);
    expect(has(p, HEAT_AURAS.burn)).toBe(false);
  });
});

describe('Guardian of the Heat: determinism', () => {
  it('the same seed and the same raid fight the same fight', () => {
    const run = () => {
      const f = heatFight(6, 43);
      f.dev('/dev heart heat pull');
      f.dev('/dev heart heat heroic');
      // A soaker at one socket, the rest waiting.
      f.put(f.players[2], -192, 2);
      f.put(f.players[3], -230, 26);
      const ev = f.tick(ticks(70));
      const st = f.state();
      return JSON.stringify({
        heat: Math.round((st?.heat ?? 0) * 1000),
        sheds: st?.sheds,
        rays: [st?.rays, st?.raysBack],
        burns: f.players.map((p) => aura(p, HEAT_AURAS.burn)?.stacks ?? 0),
        crystals: st?.crystals.map((c) => c.socket),
        hits: ev
          .filter((e) => e.type === 'damage')
          .map((e) => [(e as { ability?: string }).ability, (e as { amount?: number }).amount])
          .slice(0, 400),
      });
    };
    expect(run()).toBe(run());
  });
});
