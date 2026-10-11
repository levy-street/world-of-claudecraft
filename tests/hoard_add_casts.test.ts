// The hoard adds' own casts (src/sim/rift/hoard_add_casts.ts): a real bar on the
// mob, a kick cancels it for good, and its effect lands only when the bar ends.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import {
  HOARD_ADD_CAST_SCHOOLS,
  HOARD_ADD_CASTS,
  HOARD_WEB_CASTERS,
  tickHoardAddCasts,
} from '../src/sim/rift/hoard_add_casts';
import { HOARD_CONTROL_CAST_SEC } from '../src/sim/rift/hoard_control_casts';
import type { RiftInstance } from '../src/sim/rift/types';
import { makeVaultSeed } from '../src/sim/rift/vault_seed';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

function makeRoom(templateId: string, distance = 8): { sim: Sim; inst: RiftInstance; mob: Entity } {
  const sim = new Sim({ seed: 4412, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  const portal = {
    ...sim.player,
    id: -1,
    vaultOwnerPid: sim.player.id,
    vaultRarity: 'epic' as const,
  };
  sim.enterRift(makeVaultSeed(2, 77), 22, sim.player.id, undefined, portal);
  const inst = sim.riftInstances.find((candidate) => candidate.partyKey !== null);
  if (!inst) throw new Error('missing hoard');
  const mob = createMob(sim.ctx.nextId++, MOBS[templateId], 20, {
    ...sim.player.pos,
    x: sim.player.pos.x + distance,
  });
  sim.ctx.addEntity(mob);
  inst.mobIds.push(mob.id);
  mob.aiState = 'attack';
  mob.aggroTargetId = sim.player.id;
  sim.drainEvents();
  return { sim, inst, mob };
}

function tick(sim: Sim, mob: Entity, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds - DT * 0.5; elapsed += DT) {
    mob.aiState = 'attack';
    tickHoardAddCasts(sim.ctx);
    sim.drainEvents();
  }
}

const CASTERS = Object.keys(HOARD_ADD_CASTS);

describe('hoard add casts', () => {
  it('every cast is a kickable bar of the owner rule length on a real hoard mob', () => {
    for (const templateId of CASTERS) {
      const def = HOARD_ADD_CASTS[templateId];
      expect(MOBS[templateId], templateId).toBeDefined();
      expect(def.castSec).toBeGreaterThanOrEqual(2);
      expect(SCRIPTED_INTERRUPTIBLE_CHANNELS[def.castId]?.school).toBe(def.school);
      expect(HOARD_ADD_CAST_SCHOOLS[def.castId].school).toBe(def.school);
    }
    // The weaver's on-hit web is what the Webbing cast replaces.
    expect(HOARD_WEB_CASTERS).toContain('rift_venom_weaver');
    expect(MOBS.rift_venom_weaver.ensnare).toBeDefined();
    // The ritual is the longest bar, four seconds, as asked.
    expect(HOARD_ADD_CASTS.rift_marrow_golem.castSec).toBe(4);
    expect(HOARD_ADD_CASTS.rift_tide_thrall.castSec).toBe(2.5);
    expect(HOARD_ADD_CASTS.rift_venom_weaver.castSec).toBe(HOARD_CONTROL_CAST_SEC);
  });

  it('opens the bar after the first delay, and lands only when it completes', () => {
    const { sim, mob } = makeRoom('rift_venom_weaver');
    const def = HOARD_ADD_CASTS.rift_venom_weaver;
    tick(sim, mob, def.firstDelaySec + DT);
    expect(mob.castingAbility).toBe(def.castId);
    expect(mob.castTotal).toBe(def.castSec);
    expect(mob.castTargetId).toBe(sim.player.id);
    const rooted = () => sim.player.auras.some((aura) => aura.kind === 'root');
    tick(sim, mob, def.castSec - 0.3);
    expect(rooted()).toBe(false);
    tick(sim, mob, 0.4);
    expect(mob.castingAbility).toBeNull();
    expect(rooted()).toBe(true);
  });

  it('an interrupt drops the cast and its effect for good', () => {
    const { sim, mob } = makeRoom('rift_ember_fiend');
    const def = HOARD_ADD_CASTS.rift_ember_fiend;
    tick(sim, mob, def.firstDelaySec + DT);
    expect(mob.castingAbility).toBe(def.castId);
    const before = sim.player.hp;
    sim.ctx.cancelCast(mob);
    tick(sim, mob, def.castSec + 0.5);
    expect(sim.player.hp).toBe(before);
    expect(mob.castingAbility).toBeNull();
  });

  it('the hook drags its target to the thrall', () => {
    const { sim, mob } = makeRoom('rift_tide_thrall', 14);
    const def = HOARD_ADD_CASTS.rift_tide_thrall;
    const start = Math.hypot(sim.player.pos.x - mob.pos.x, sim.player.pos.z - mob.pos.z);
    tick(sim, mob, def.firstDelaySec + def.castSec + 0.2);
    expect(sim.player.auras.some((aura) => aura.kind === 'forced_move')).toBe(true);
    for (let i = 0; i < 40; i++) sim.tick();
    const end = Math.hypot(sim.player.pos.x - mob.pos.x, sim.player.pos.z - mob.pos.z);
    expect(end).toBeLessThan(start - 4);
  });

  it('the beam is a channel that hurts as it goes, and stops when its target leaves reach', () => {
    const { sim, mob } = makeRoom('rift_rime_elemental');
    const def = HOARD_ADD_CASTS.rift_rime_elemental;
    sim.chat('/dev god', sim.player.id);
    tick(sim, mob, def.firstDelaySec + DT);
    expect(mob.castingAbility).toBe(def.castId);
    expect(mob.channeling).toBe(true);
    const before = sim.player.hp;
    tick(sim, mob, 1.1);
    expect(sim.player.hp).toBeLessThan(before);
    sim.player.pos = { ...sim.player.pos, x: sim.player.pos.x + 200 };
    tick(sim, mob, 0.6);
    expect(mob.castingAbility).toBeNull();
  });

  it('the acolyte empowers every mob near it, itself included', () => {
    const { sim, inst, mob } = makeRoom('rift_void_acolyte');
    const def = HOARD_ADD_CASTS.rift_void_acolyte;
    const friend = createMob(sim.ctx.nextId++, MOBS.rift_dread_stalker, 20, {
      ...mob.pos,
      x: mob.pos.x + 5,
    });
    sim.ctx.addEntity(friend);
    inst.mobIds.push(friend.id);
    tick(sim, mob, def.firstDelaySec + def.castSec + 0.2);
    const buffed = (entity: Entity) => entity.auras.some((aura) => aura.id === def.castId);
    expect(buffed(mob)).toBe(true);
    expect(buffed(friend)).toBe(true);
    expect(buffed(sim.player)).toBe(false);
  });

  it('the ritual raises two warriors into the room, and not while they live', () => {
    const { sim, inst, mob } = makeRoom('rift_marrow_golem');
    const def = HOARD_ADD_CASTS.rift_marrow_golem;
    // The golem's own risen, and every one of them registered with the room.
    const warriors = () =>
      (mob.summonedIds ?? [])
        .map((id) => sim.ctx.entities.get(id))
        .filter((e): e is Entity => e !== undefined && e.templateId === 'rift_boneclad' && !e.dead);
    const inRoom = () => (mob.summonedIds ?? []).every((id) => inst.mobIds.includes(id));
    expect(warriors()).toHaveLength(0);
    tick(sim, mob, def.firstDelaySec + def.castSec + 0.2);
    expect(warriors()).toHaveLength(2);
    expect(inRoom()).toBe(true);
    // The next ritual waits while its warriors stand.
    tick(sim, mob, def.cooldownSec + 1);
    expect(mob.castingAbility).toBeNull();
    expect(warriors()).toHaveLength(2);
  });

  it('is silent outside a hoard and forgets the room when it empties', () => {
    const sim = new Sim({
      seed: 4413,
      playerClass: 'warrior',
      autoEquip: false,
      devCommands: true,
    });
    const mob = createMob(sim.ctx.nextId++, MOBS.rift_ember_fiend, 20, {
      ...sim.player.pos,
      x: sim.player.pos.x + 6,
    });
    sim.ctx.addEntity(mob);
    mob.aiState = 'attack';
    mob.aggroTargetId = sim.player.id;
    tick(sim, mob, 10);
    expect(mob.castingAbility).toBeNull();
  });
});
