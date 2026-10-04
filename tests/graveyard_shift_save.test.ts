// A save taken during a Graveyard Shift writes the owner's real character,
// never Morthen: level, talents, resource, health, cooldowns, sicknesses, a
// living body outside the Crypt. Every server save path reads
// serializeCharacter (autosave, a dropped socket's flush, logout, shutdown,
// the deed unlock's immediate save), so these pins cover them all.
import { describe, expect, it } from 'vitest';
import { emptyAllocation } from '../src/sim/content/talents';
import { CORPSE_RETURN_TICKS } from '../src/sim/graveyard_shift/corpse_run';
import {
  GRAVE_ENTITY_ID,
  GRAVE_POS,
  graveReturnSpot,
  TIBBS_ENTITY_ID,
} from '../src/sim/graveyard_shift/grave_entry';
import { hasMorthenIdentity } from '../src/sim/graveyard_shift/morthen_identity';
import { graveyardShiftDoorDrop } from '../src/sim/graveyard_shift/run_layout';
import { graveyardShiftRunFor } from '../src/sim/graveyard_shift/run_state';
import { RESURRECTION_SICKNESS_ID } from '../src/sim/resurrection';
import type { CharacterState } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

function mageSim(devCommands = false) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'mage',
    devCommands,
    offlineHost: true,
    world: EMPTY_TEST_WORLD,
  });
  sim.setPlayerLevel(15);
  const meta = sim.ctx.players.get(sim.playerId)!;
  meta.deedsEarned.set('dgn_hollow_crypt', '2026-10-01');
  expect(sim.selectTalentRow(8, 'mag_r8_temporal_rift')).toBe(true);
  // Owed on the way in: the run's clean slate sheds it, the save must not.
  sim.player.auras.push({
    id: RESURRECTION_SICKNESS_ID,
    name: "The Keeper's Toll",
    kind: 'debuff',
    remaining: 300,
    duration: 600,
  } as unknown as Aura);
  sim.player.hp = Math.floor(sim.player.maxHp * 0.8);
  // A real cooldown carried in, frozen by the run like the sickness.
  sim.player.cooldowns.set('frost_nova', 20);
  return sim;
}

function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  (sim as any).rebucket(e);
}

function takeShiftAtGrave(sim: Sim) {
  sim.tick();
  const spot = graveReturnSpot();
  place(sim, sim.player, spot.x, spot.z);
  sim.pickUpObject(GRAVE_ENTITY_ID);
  sim.tick();
  sim.targetEntity(TIBBS_ENTITY_ID);
  sim.interact();
  expect(graveyardShiftRunFor(sim.ctx, sim.playerId)?.entry).toBe('grave');
}

const lethal = (sim: Sim, target: Entity) =>
  (sim as any).dealDamage(
    sim.player,
    target,
    target.maxHp + 50,
    false,
    'shadow',
    null,
    'hit',
    true,
  );

// The fields a run temporarily replaces, as the real character carries them.
function realFields(s: CharacterState) {
  return {
    level: s.level,
    talents: s.talents,
    resource: s.resource,
    hp: s.hp,
    resSickness: s.resSickness,
    cooldowns: s.cooldowns,
  };
}

describe('a save taken during a Graveyard Shift', () => {
  it('writes the real character at every stage: start, fight, won scene', () => {
    const sim = mageSim();
    const before = sim.serializeCharacter(sim.playerId)!;
    expect(before.level).toBe(15);
    // A real build, so the talent pin below is not vacuous.
    expect(before.talents).not.toEqual(emptyAllocation());
    expect(before.resSickness).toBe(300);
    takeShiftAtGrave(sim);
    const p = sim.player;
    // The live body really is Morthen: level 10, Dread, the build parked.
    expect(hasMorthenIdentity(p)).toBe(true);
    expect(p.level).toBe(10);
    expect(p.resourceType).toBe('dread');
    // The sickness and the cooldown are frozen at the start (a few ticks after
    // `before`): the run hands back exactly what it snapshotted.
    const run = graveyardShiftRunFor(sim.ctx, sim.playerId)!;
    const sickness = run.pools.sickness!.remaining;
    const frostNova = run.pools.cooldowns.get('frost_nova')!;
    expect(sickness).toBeCloseTo(300, 0);
    expect(frostNova).toBeCloseTo(20, 0);
    const expected = {
      ...realFields(before),
      resSickness: sickness,
      cooldowns: { abilities: { frost_nova: frostNova } },
    };

    const atStart = sim.serializeCharacter(sim.playerId)!;
    expect(realFields(atStart)).toEqual(expected);
    // A grave shift saves its owner in front of the grave, alive.
    const spot = graveReturnSpot();
    expect(atStart.pos).toEqual({ x: spot.x, z: spot.z });
    expect(atStart.facing).toBeCloseTo(Math.atan2(GRAVE_POS.x - spot.x, GRAVE_POS.z - spot.z));
    expect(atStart.dead).toBe(false);
    expect(atStart.ghost).toBe(false);
    expect(atStart.corpsePos).toBeNull();

    // Mid-fight: Dread earned, health lost, kit on cooldown.
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    p.resource = 40;
    p.hp = 7;
    p.cooldowns.set('gshift_shadow_pulse', 30);
    expect(realFields(sim.serializeCharacter(sim.playerId)!)).toEqual(expected);

    // The won scene: the deed unlock's immediate save lands here.
    for (const b of run.bots) lethal(sim, sim.entities.get(b.pid)!);
    for (let i = 0; i < CORPSE_RETURN_TICKS + 1; i++) sim.tick();
    for (const b of run.bots) lethal(sim, sim.entities.get(b.pid)!);
    sim.tick();
    expect(run.outro?.kind).toBe('won');
    const won = sim.serializeCharacter(sim.playerId)!;
    expect(realFields(won)).toEqual(expected);
    expect(won.pos).toEqual({ x: spot.x, z: spot.z });
  });

  it('a dead owner in the lost scene still saves alive, outside, as himself', () => {
    const sim = mageSim();
    const before = sim.serializeCharacter(sim.playerId)!;
    takeShiftAtGrave(sim);
    const pools = graveyardShiftRunFor(sim.ctx, sim.playerId)!.pools;
    (sim as any).dealDamage(
      null,
      sim.player,
      sim.player.maxHp + 50,
      false,
      'physical',
      null,
      'hit',
      true,
    );
    sim.tick();
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)?.outro?.kind).toBe('lost');
    const lost = sim.serializeCharacter(sim.playerId)!;
    expect(lost.level).toBe(before.level);
    expect(lost.talents).toEqual(before.talents);
    expect(lost.resource).toBe(before.resource);
    expect(lost.hp).toBe(pools.hp);
    expect(lost.resSickness).toBe(pools.sickness!.remaining);
    expect(lost.dead).toBe(false);
  });

  it('a dev shift saves its owner at the Crypt door', () => {
    const sim = mageSim(true);
    sim.chat('/dev graveyardshift start');
    expect(graveyardShiftRunFor(sim.ctx, sim.playerId)?.entry).toBe('dev');
    const door = graveyardShiftDoorDrop();
    expect(sim.serializeCharacter(sim.playerId)!.pos).toEqual({ x: door.x, z: door.z });
  });

  it('a mid-run save reloads exactly like the save taken before the run', () => {
    const sim = mageSim();
    const before = sim.serializeCharacter(sim.playerId)!;
    takeShiftAtGrave(sim);
    sim.player.resource = 55;
    const saved = sim.serializeCharacter(sim.playerId)!;
    const reload = (state: CharacterState) => {
      const fresh = new Sim({
        seed: 7,
        playerClass: 'mage',
        noPlayer: true,
        world: EMPTY_TEST_WORLD,
      });
      const pid = fresh.addPlayer('mage', 'Reloaded', { state });
      return { fresh, pid, e: fresh.entities.get(pid)! };
    };
    const a = reload(before);
    const b = reload(saved);
    expect(b.e.level).toBe(15);
    expect(b.e.resourceType).toBe('mana');
    expect(hasMorthenIdentity(b.e)).toBe(false);
    expect(b.e.level).toBe(a.e.level);
    expect(b.e.resource).toBe(a.e.resource);
    expect(b.e.maxResource).toBe(a.e.maxResource);
    expect(b.e.hp).toBe(a.e.hp);
    expect(b.fresh.serializeCharacter(b.pid)!.talents).toEqual(before.talents);
    const spot = graveReturnSpot();
    expect(Math.hypot(b.e.pos.x - spot.x, b.e.pos.z - spot.z)).toBeLessThan(0.01);
  });

  it('leaves every save untouched with no run', () => {
    const sim = mageSim();
    const a = sim.serializeCharacter(sim.playerId)!;
    const b = sim.serializeCharacter(sim.playerId)!;
    expect(b).toEqual(a);
    expect(a.level).toBe(15);
  });
});
