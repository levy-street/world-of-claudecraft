// The Smith's Heart's arrival (phase 2J, docs/design/raid/smith_heart.md
// section 5.17): the first tick a living player stands in the Heart, the
// claim's seal markers take the arrival bit (SMITH_HEART_AWAKE_BIT), which the
// renderer reads to play the arrival scene once (the heart crystal rising and
// binding the room's rocks into the Masterless Strength's body) and to show
// the body already whole to anyone who sees the heart awake already.
//   - a fresh claim starts asleep; the bit is set on the first tick a living
//     player stands in the Heart, and kept once set (a raid walking back out
//     leaves it awake), on every marker;
//   - it draws no rng and reads no clock (the same steps give the same
//     markers; the seal's tick leaves the rng where it was);
//   - presentation only: the final boss stays where it was, untouched;
//   - `/dev heart arrival` puts the heart back to sleep for its hold, then it
//     wakes again with the raid in the Heart; the readout reports it.

import { describe, expect, it } from 'vitest';
import {
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_SEAL_PREFIX,
} from '../src/sim/content/smith_heart';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { handleSmithHeartDevChat } from '../src/sim/dev/smith_heart_dev';
import {
  SMITH_HEART_ARRIVAL_REPLAY_HOLD,
  SMITH_HEART_AWAKE_BIT,
  smithHeartAwakeBitSet,
  smithHeartPlayerInHeart,
  smithHeartSealMaskOf,
  smithHeartSealTemplate,
  tickSmithHeartSeal,
} from '../src/sim/encounters/smith_heart';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const DUNGEON = DUNGEONS[SMITH_HEART_DUNGEON];
const TICK = 1 / 20;

function devSim(seed = 17) {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const dev = (line: string) => handleSmithHeartDevChat(sim.ctx, line, sim.player.id);
  const claim = () =>
    sim.ctx.instances.find((inst) => {
      if (inst.dungeonId !== SMITH_HEART_DUNGEON || inst.partyKey === null) return false;
      if (inst.exitId === null) return false;
      const o = instanceOrigin(DUNGEON.index, inst.slot);
      const p = sim.player.pos;
      return Math.abs(p.x - o.x) < 300 && Math.abs(p.z - o.z) < 250;
    }) ?? null;
  return { sim, dev, claim };
}

function markerValues(sim: Sim, inst: InstanceSlot): number[] {
  const out: number[] = [];
  for (const id of inst.objectIds) {
    const e = sim.ctx.entities.get(id);
    const m = e ? smithHeartSealMaskOf(e.templateId) : null;
    if (m !== null) out.push(m);
  }
  return out;
}

const awake = (sim: Sim, inst: InstanceSlot) => {
  const v = markerValues(sim, inst);
  expect(v.length).toBeGreaterThan(0);
  const on = v.map(smithHeartAwakeBitSet);
  // Every marker agrees.
  expect(new Set(on).size).toBe(1);
  return on[0];
};

function ticks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.tick();
}

describe("the Smith's Heart's arrival", () => {
  it('rides the seal markers as its own bit, round-tripping with the veins and the portal', () => {
    expect(SMITH_HEART_AWAKE_BIT).toBe(32);
    for (let m = 0; m < 64; m++) {
      expect(smithHeartSealMaskOf(smithHeartSealTemplate(m))).toBe(m);
      expect(smithHeartAwakeBitSet(m)).toBe(m >= 32);
    }
    expect(smithHeartSealMaskOf(`${SMITH_HEART_SEAL_PREFIX}64`)).toBeNull();
  });

  it('a fresh claim sleeps; the first living player in the Heart wakes it, and it stays awake', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    expect(inst).not.toBeNull();
    if (!inst) return;
    ticks(sim, 3);
    expect(smithHeartPlayerInHeart(sim.ctx, inst)).toBe(false);
    expect(awake(sim, inst)).toBe(false);
    dev('/dev heart tp heartroom');
    expect(smithHeartPlayerInHeart(sim.ctx, inst)).toBe(true);
    sim.tick();
    expect(awake(sim, inst)).toBe(true);
    // Back out on the main map: the heart stays awake.
    dev('/dev heart tp ring');
    expect(smithHeartPlayerInHeart(sim.ctx, inst)).toBe(false);
    ticks(sim, 40);
    expect(awake(sim, inst)).toBe(true);
  });

  it('a corpse in the Heart never wakes it', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    if (!inst) throw new Error('no claim');
    dev('/dev heart tp heartroom');
    sim.player.dead = true;
    expect(smithHeartPlayerInHeart(sim.ctx, inst)).toBe(false);
    tickSmithHeartSeal(sim.ctx, inst);
    expect(awake(sim, inst)).toBe(false);
  });

  it('draws no rng and reads no clock: the same steps give the same markers, the rng untouched', () => {
    const run = () => {
      const { sim, dev, claim } = devSim(29);
      dev('/dev heart enter');
      const inst = claim();
      if (!inst) throw new Error('no claim');
      ticks(sim, 5);
      dev('/dev heart tp heartroom');
      // The seal's own tick, alone: the arrival leaves the rng where it was.
      const rngState = () => (sim.ctx.rng as unknown as { s: number }).s;
      const s0 = rngState();
      tickSmithHeartSeal(sim.ctx, inst);
      expect(rngState()).toBe(s0);
      expect(markerValues(sim, inst).every((v) => smithHeartAwakeBitSet(v))).toBe(true);
      ticks(sim, 10);
      return { values: markerValues(sim, inst) };
    };
    const a = run();
    const b = run();
    expect(a.values).toEqual(b.values);
    expect(a.values.every((v) => smithHeartAwakeBitSet(v))).toBe(true);
  });

  it('is presentation only: the final boss stays put and untouched by the arrival', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    if (!inst) throw new Error('no claim');
    const boss = [...sim.ctx.entities.values()].find(
      (e) => e.templateId === SMITH_HEART_FINAL_BOSS && inst.mobIds.includes(e.id),
    );
    expect(boss).toBeDefined();
    if (!boss) return;
    const at = { ...boss.pos };
    const hp = boss.hp;
    dev('/dev heart tp heartroom');
    ticks(sim, 20);
    expect(awake(sim, inst)).toBe(true);
    expect(boss.dead).toBe(false);
    expect(boss.hp).toBe(hp);
    expect(Math.hypot(boss.pos.x - at.x, boss.pos.z - at.z)).toBeLessThan(0.01);
  });

  it('/dev heart arrival replays it: asleep for its hold, then awake again with the raid in the Heart', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    if (!inst) throw new Error('no claim');
    dev('/dev heart tp heartroom');
    sim.tick();
    expect(awake(sim, inst)).toBe(true);
    dev('/dev heart arrival');
    sim.tick();
    expect(awake(sim, inst)).toBe(false);
    // Still asleep through most of its hold...
    ticks(sim, Math.floor((SMITH_HEART_ARRIVAL_REPLAY_HOLD / TICK) * 0.8));
    expect(awake(sim, inst)).toBe(false);
    // ... and awake again once it has passed.
    ticks(sim, Math.ceil((SMITH_HEART_ARRIVAL_REPLAY_HOLD / TICK) * 0.4) + 2);
    expect(awake(sim, inst)).toBe(true);
  });

  it('the seal readout reports the arrival', () => {
    const { sim, dev, claim } = devSim();
    dev('/dev heart enter');
    const inst = claim();
    if (!inst) throw new Error('no claim');
    const seen: string[] = [];
    const read = () => {
      dev('/dev heart seal');
      for (const e of sim.tick() as SimEvent[]) if (e.type === 'log') seen.push(e.text);
    };
    read();
    dev('/dev heart tp heartroom');
    sim.tick();
    read();
    expect(seen.some((t) => /awake false/.test(t))).toBe(true);
    expect(seen.some((t) => /awake true/.test(t))).toBe(true);
  });
});
