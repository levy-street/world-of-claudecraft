import { describe, expect, it } from 'vitest';
import { buildRealmSimConfig } from '../server/sim_boot_config';
import { offlineWorldConfig } from '../src/game/offline_world_config';
import { CRYPT_DOOR_POS, dungeonAt } from '../src/sim/data';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift';
import { Sim } from '../src/sim/sim';
import { inertVaultConsumptionAdmission } from '../src/sim/sim_context';
import { EMPTY_TEST_WORLD } from './sim_shared';

function shiftSim(
  opts: {
    offlineHost?: boolean;
    devCommands?: boolean;
    cls?: 'warrior' | 'warlock';
    fullWorld?: boolean;
  } = {},
) {
  const sim = new Sim({
    seed: 42,
    playerClass: opts.cls ?? 'warrior',
    devCommands: opts.devCommands ?? true,
    offlineHost: opts.offlineHost ?? true,
    world: opts.fullWorld ? undefined : EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(10);
  return sim;
}

function logs(sim: Sim, events = sim.events): string[] {
  return events.flatMap((ev) => (ev.type === 'log' ? [ev.text] : []));
}

function start(sim: Sim, pid = sim.playerId) {
  sim.chat('/dev graveyardshift start', pid);
  return graveyardShiftRunFor(sim.ctx, pid);
}

function castAndFinish(sim: Sim, id: string) {
  sim.castAbility(id);
  for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
}

function nearCryptDoor(sim: Sim, pid = sim.playerId): boolean {
  const p = sim.entities.get(pid)!;
  return Math.hypot(p.pos.x - CRYPT_DOOR_POS.x, p.pos.z - CRYPT_DOOR_POS.z) < 10;
}

describe('Graveyard Shift run shell', () => {
  it('starts in a private Crypt slot under its own key, facing the nave', () => {
    const sim = shiftSim();
    const nextIdBefore = sim.nextId;
    const run = start(sim);
    expect(run).not.toBeNull();
    expect(run!.slot.dungeonId).toBe('hollow_crypt');
    expect(run!.slot.partyKey).toBe(`gshift:${sim.playerId}`);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('hollow_crypt');
    expect(sim.player.facing).toBeCloseTo(Math.PI);
    // The only spawns are the three adventurers, in roster order.
    expect(run!.bots.map((b) => b.pid)).toEqual([nextIdBefore, nextIdBefore + 1, nextIdBefore + 2]);
    expect(run!.slot.mobIds).toEqual([]);
  });

  it('end walks the owner out to the Crypt door, restores the pools and frees the slot', () => {
    const sim = shiftSim();
    const p = sim.player;
    p.hp = Math.floor(p.maxHp / 2);
    p.cooldowns.set('heroic_strike', 3);
    const halfHp = p.hp;
    const run = start(sim)!;
    expect(p.hp).toBe(p.maxHp);
    expect(p.cooldowns.has('heroic_strike')).toBe(false);
    sim.chat('/dev graveyardshift end');
    const events = sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(dungeonAt(p.pos.x)).toBeNull();
    expect(nearCryptDoor(sim)).toBe(true);
    expect(p.hp).toBe(halfHp);
    expect(p.cooldowns.get('heroic_strike')).toBeCloseTo(3, 0);
    expect(run.slot.partyKey).toBeNull();
    expect(logs(sim, events)).toContain('[dev] Graveyard Shift ended (aborted).');
  });

  it('refuses outside the offline world, below level 10, in a party, or twice', () => {
    const online = shiftSim({ offlineHost: false });
    expect(start(online)).toBeNull();
    expect(logs(online)).toContain('[dev] Graveyard Shift runs offline only.');

    const low = shiftSim();
    low.setPlayerLevel(9);
    expect(start(low)).toBeNull();
    expect(logs(low)).toContain('[dev] You must be level 10 to cover a shift.');

    const grouped = shiftSim();
    const friend = grouped.addPlayer('priest', 'Friend');
    grouped.partyInvite(friend);
    grouped.partyAccept(friend);
    expect(grouped.partyOf(grouped.playerId)).not.toBeNull();
    expect(start(grouped)).toBeNull();
    expect(logs(grouped)).toContain('[dev] Leave your party first.');

    const busy = shiftSim();
    for (const inst of busy.ctx.instances) {
      if (inst.dungeonId === 'hollow_crypt') inst.partyKey = 'busy';
    }
    expect(start(busy)).toBeNull();
    expect(logs(busy)).toContain('[dev] Every crypt is busy. Try again soon.');

    const twice = shiftSim();
    const first = start(twice);
    expect(first).not.toBeNull();
    twice.chat('/dev graveyardshift start');
    expect(graveyardShiftRunFor(twice.ctx, twice.playerId)).toBe(first);
    expect(logs(twice)).toContain('[dev] You are already on shift.');
  });

  it('status reports whether a shift is running', () => {
    const sim = shiftSim();
    sim.chat('/dev graveyardshift status');
    start(sim);
    sim.chat('/dev graveyardshift status');
    expect(logs(sim)).toEqual(
      expect.arrayContaining([
        '[dev] Graveyard Shift: off shift.',
        '[dev] Graveyard Shift: on shift.',
      ]),
    );
  });

  it('a running shift survives well past the once-a-second instance reaper', () => {
    const sim = shiftSim();
    const run = start(sim)!;
    for (let i = 0; i < 20 * 60; i++) sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
    expect(run.slot.partyKey).toBe(`gshift:${sim.playerId}`);
    expect(dungeonAt(sim.player.pos.x)?.id).toBe('hollow_crypt');
  });

  it('is inert without dev commands', () => {
    const sim = shiftSim({ devCommands: false });
    expect(start(sim)).toBeNull();
    expect(sim.ctx.graveyardShiftRuns.size).toBe(0);
  });

  it('a teleport out ends the run in place, with the character restored', () => {
    const sim = shiftSim();
    const p = sim.player;
    p.hp = Math.floor(p.maxHp / 3);
    p.cooldowns.set('heroic_strike', 3);
    const hp = p.hp;
    const run = start(sim)!;
    sim.chat('/dev tp 10 10');
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(p.pos.x).toBeCloseTo(10, 0);
    expect(p.pos.z).toBeCloseTo(10, 0);
    expect(p.hp).toBe(hp);
    expect(p.cooldowns.get('heroic_strike')).toBeCloseTo(3, 0);
    expect(run.slot.partyKey).toBeNull();
    expect(run.slot.mobIds).toEqual([]);
  });

  it('a displacement that bypasses every command (a hearth-style move) is caught', () => {
    const sim = shiftSim();
    const run = start(sim)!;
    sim.player.pos = sim.ctx.groundPos(20, 20);
    sim.player.prevPos = { ...sim.player.pos };
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(run.slot.partyKey).toBeNull();
  });

  it('a death ends the run as a loss and revives the owner outside', () => {
    const sim = shiftSim();
    start(sim);
    sim.chat('/dev kill');
    expect(sim.player.dead).toBe(true);
    const events = sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(nearCryptDoor(sim)).toBe(true);
    expect(logs(sim, events)).toContain('[dev] Graveyard Shift ended (lost).');
  });

  it('a Release landing before the watch still revives the owner at the Crypt door', () => {
    const sim = shiftSim();
    start(sim);
    sim.chat('/dev kill');
    sim.releaseSpirit();
    expect(sim.player.ghost).toBe(true);
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(sim.player.dead).toBe(false);
    expect(sim.player.ghost).toBe(false);
    expect(nearCryptDoor(sim)).toBe(true);
  });

  it('stows the pet on the way in and hands back the one carried in', () => {
    const sim = shiftSim({ cls: 'warlock' });
    castAndFinish(sim, 'summon_imp');
    const carried = sim.petOf(sim.playerId)!;
    expect(carried).not.toBeNull();
    start(sim);
    expect(sim.petOf(sim.playerId)).toBeNull();
    // Morthen knows only his kit: no pet can be summoned on shift.
    castAndFinish(sim, 'summon_imp');
    expect(sim.petOf(sim.playerId)).toBeNull();
    sim.chat('/dev graveyardshift end');
    sim.tick();
    const pets = [...sim.entities.values()].filter(
      (e) => e.ownerId === sim.playerId && e.kind === 'mob' && !e.dead,
    );
    expect(pets).toHaveLength(1);
    expect(pets[0].templateId).toBe(carried.templateId);
    expect(sim.ctx.delvePetStash.has(sim.playerId)).toBe(false);
  });

  it('joining a party mid-run ends it', () => {
    const sim = shiftSim();
    const friend = sim.addPlayer('priest', 'Friend');
    start(sim);
    sim.partyInvite(sim.playerId, friend);
    sim.partyAccept(sim.playerId);
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBeNull();
    expect(nearCryptDoor(sim)).toBe(true);
  });

  it('a removed owner drops the run and frees the slot', () => {
    const sim = shiftSim();
    const owner = sim.addPlayer('mage', 'Owner');
    sim.setPlayerLevel(10, owner);
    const run = start(sim, owner)!;
    expect(run).not.toBeNull();
    sim.removePlayer(owner);
    sim.tick();
    expect(sim.ctx.graveyardShiftRuns.size).toBe(0);
    expect(run.slot.partyKey).toBeNull();
  });

  it('Reset All Instances leaves the run alone', () => {
    const sim = shiftSim();
    const run = start(sim)!;
    sim.resetDungeonInstances();
    sim.tick();
    expect(run.slot.partyKey).toBe(`gshift:${sim.playerId}`);
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)).toBe(run);
  });

  it.each([false, true])(
    'a run never shifts the shared rng stream (full world: %s)',
    (fullWorld) => {
      const draws = (withRun: boolean) => {
        const sim = shiftSim({ fullWorld });
        let count = 0;
        sim.rng.setObserver(() => count++);
        if (withRun) start(sim);
        for (let i = 0; i < 100; i++) sim.tick();
        if (withRun) sim.chat('/dev graveyardshift end');
        sim.tick();
        sim.rng.setObserver(null);
        return { count, next: sim.rng.next() };
      };
      expect(draws(true)).toEqual(draws(false));
    },
  );

  it('refuses a shift started in combat', () => {
    const sim = shiftSim();
    sim.player.inCombat = true;
    expect(start(sim)).toBeNull();
    expect(logs(sim)).toContain('[dev] Leave combat first.');
  });

  it('only the offline world turns the run on: the realm boot config leaves it off', () => {
    const realm = buildRealmSimConfig(undefined, inertVaultConsumptionAdmission);
    expect(realm.offlineHost).toBeUndefined();
    const offline = offlineWorldConfig({
      playerClass: 'warrior',
      name: 'Probe',
      devCommands: true,
    });
    expect(offline.offlineHost).toBe(true);
  });
});
