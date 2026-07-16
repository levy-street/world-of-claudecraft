import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import { infernalLavaAt, tickInfernalAbyssLava } from '../src/sim/instances/infernal_abyss_hazards';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';

describe('Infernal Abyss lava hazards', () => {
  it('matches the authored lava pools and keeps their edge outside safe', () => {
    expect(infernalLavaAt(-78, 76)).toBe(true);
    expect(infernalLavaAt(-72.6, 76)).toBe(true);
    expect(infernalLavaAt(-72.4, 76)).toBe(false);
  });

  it('rotates fissure hit boxes with the rendered decor yaw', () => {
    expect(infernalLavaAt(-32, 76)).toBe(true);
    expect(infernalLavaAt(-27, 76)).toBe(true);
    expect(infernalLavaAt(-32, 79)).toBe(false);
  });

  it('matches the boss arena moat while keeping its inner island safe', () => {
    expect(infernalLavaAt(0, 216.5)).toBe(false);
    expect(infernalLavaAt(30, 216.5)).toBe(true);
    expect(infernalLavaAt(40, 216.5)).toBe(false);
  });

  it('keeps the authored entry, side rooms and boss position off lava', () => {
    for (const point of [
      { x: 0, z: -10 },
      { x: -66, z: 59 },
      { x: 48, z: 110 },
      { x: 0, z: 224 },
    ]) {
      expect(infernalLavaAt(point.x, point.z)).toBe(false);
    }
  });

  it('deals a deterministic eight percent health pulse to players in lava', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = -78;
    player.pos.z = 76;

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });

    expect(player.hp).toBe(920);
  });

  it('labels the pulse with the localizable Abyssal Lava damage source', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = -78;
    player.pos.z = 76;

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const sources: string[] = [];
    const realDeal = ctx.dealDamage;
    (ctx as { dealDamage: SimContext['dealDamage'] }).dealDamage = (...args) => {
      sources.push(args[5] as string);
      return realDeal(...args);
    };
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });
    (ctx as { dealDamage: SimContext['dealDamage'] }).dealDamage = realDeal;

    // The exact English the client matcher (sim_i18n AURA_NAME_KEY) re-localizes.
    expect(sources).toEqual(['Abyssal Lava']);
  });

  it('pulses exactly once per second on the live tick loop (behavioral cadence)', () => {
    // The load-bearing half of "8 percent per SECOND": drive the real sim (not
    // the module) with a player parked in a lava footprint and count the
    // Abyssal Lava pulses over two full seconds of ticks. A relocation of the
    // call under a per-tick path would land 40 pulses here, not 2.
    const sim = new Sim({ seed: 77, playerClass: 'warrior', playerName: 'Lead' });
    sim.setPlayerLevel(20);
    sim.enterDungeon('infernal_abyss');
    const inst = (
      sim as unknown as { instances: Array<{ dungeonId: string; slot: number }> }
    ).instances.find((slot) => slot.dungeonId === 'infernal_abyss');
    expect(inst, 'the dungeon claims an instance').toBeTruthy();
    if (!inst) return;
    const origin = instanceOrigin(DUNGEONS.infernal_abyss.index, inst.slot);

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const player = sim.player;
    // The maze lava pool at local (-78, 76), in world coordinates.
    expect(infernalLavaAt(-78, 76)).toBe(true);

    const pulses: number[] = [];
    const realDeal = ctx.dealDamage;
    (ctx as { dealDamage: SimContext['dealDamage'] }).dealDamage = (...args) => {
      if (args[5] === 'Abyssal Lava') pulses.push(ctx.tickCount);
      return realDeal(...args);
    };
    for (let i = 0; i < 40; i++) {
      // Re-park every tick so mob knockups or motion never move the probe.
      player.pos.x = origin.x - 78;
      player.pos.z = origin.z + 76;
      player.prevPos = { ...player.pos };
      player.hp = player.maxHp;
      sim.tick();
    }
    (ctx as { dealDamage: SimContext['dealDamage'] }).dealDamage = realDeal;

    expect(pulses).toHaveLength(2);
    expect(pulses[1] - pulses[0]).toBe(20);
  });

  it('never damages a player who is outside the instance envelope', () => {
    // The containment gate: a player whose LOCAL coordinates land in a lava
    // footprint but who stands outside this instance's envelope is skipped.
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = -78;
    player.pos.z = 76;

    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 }, () => false);
    expect(player.hp).toBe(1000);

    tickInfernalAbyssLava(ctx, { x: 0, z: 0 }, () => true);
    expect(player.hp).toBe(920);
  });

  it('runs at the once-a-second updateInstances cadence, never per tick', () => {
    // The 8 percent pulse is per SECOND: the only call site must sit inside
    // updateInstances, which self-gates on `tickCount % 20`. A relocation that
    // called the lava tick per 20 Hz tick would deal 160 percent per second.
    const source = readFileSync('src/sim/instances/dungeons.ts', 'utf8');
    const updateBody = source.slice(source.indexOf('export function updateInstances'));
    expect(updateBody).toContain('ctx.tickCount % 20');
    expect(updateBody.indexOf('tickInfernalAbyssLava')).toBeGreaterThan(
      updateBody.indexOf('ctx.tickCount % 20'),
    );
    // ...and nowhere else in the sim calls it.
    expect(source.split('tickInfernalAbyssLava').length).toBe(3); // import + one call
  });

  it('skips players outside lava and dead players entirely', () => {
    const sim = new Sim({ seed: 401, playerClass: 'warrior' });
    const player = sim.player;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;

    player.maxHp = 1000;
    player.hp = 1000;
    player.pos.x = 0;
    player.pos.z = -10; // authored entry, off lava
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });
    expect(player.hp).toBe(1000);

    player.pos.x = -78;
    player.pos.z = 76; // in the pool, but dead
    player.dead = true;
    player.hp = 0;
    tickInfernalAbyssLava(ctx, { x: 0, z: 0 });
    expect(player.hp).toBe(0);
  });
});
