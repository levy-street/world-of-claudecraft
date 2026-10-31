import { describe, expect, it } from 'vitest';
import { KORGATH_SPOT, LOCK_TERRACE } from '../src/sim/content/gravewyrm_sanctum_layout';
import { KORGATH_ID, SEAL_TOOLS } from '../src/sim/encounters/gravewyrm_sanctum';
import { claimBoss } from '../src/sim/encounters/gravewyrm_sanctum/claim';
import { breakChain, korgathState } from '../src/sim/encounters/gravewyrm_sanctum/korgath';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type PlayerClass, type SimEvent } from '../src/sim/types';

function room(playerClass: PlayerClass = 'warrior') {
  const sim = new Sim({ seed: 93, playerClass, autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  if (playerClass === 'paladin') expect(sim.setSpec('retribution')).toBe(true);
  sim.chat('/dev sanctum enter normal', sim.player.id);
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('missing Sanctum claim');
  const boss = claimBoss(sim.ctx, inst, KORGATH_ID);
  if (!boss) throw new Error('missing Korgath');
  // Keep the real claimed encounter and its runtime-created shackles, but no
  // unrelated road packs or other bosses in this boundary regression.
  for (const id of [...inst.mobIds]) {
    if (id !== boss.id) sim.ctx.dropEntity(id);
  }
  const origin = sim.ctx.instanceOriginOf(inst);
  const place = (entity: Entity, x: number, z: number) => {
    entity.pos = sim.ctx.groundPos(origin.x + x, origin.z + z);
    entity.prevPos = { ...entity.pos };
    sim.ctx.rebucket(entity);
    if (entity.kind === 'player') sim.playerGrid.update(entity);
  };
  const tank = sim.player;
  tank.hp = tank.maxHp = 1e6;
  place(tank, KORGATH_SPOT.x, KORGATH_SPOT.z - 3);
  sim.tick();
  sim.ctx.aggroMob(boss, tank, false);
  sim.tick();
  const state = korgathState(boss);
  if (!state?.engaged) throw new Error('Korgath did not engage');
  sim.drainEvents();
  return { sim, inst, boss, tank, state, place };
}

function tickFor(sim: Sim, seconds: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < 20 * seconds; i++) events.push(...sim.tick());
  return events;
}

describe('Korgath arena boundaries through the live simulation', () => {
  it('refuses free damage from a sole attacker outside the terrace and resets the pull', () => {
    const { sim, boss, tank, place } = room();
    place(tank, KORGATH_SPOT.x, KORGATH_SPOT.z - LOCK_TERRACE.r - 5);
    const hp = boss.hp;
    sim.ctx.dealDamage(tank, boss, 100, false, 'arcane', 'test', 'hit');
    expect(boss.hp).toBe(hp);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        sourceId: tank.id,
        targetId: boss.id,
        kind: 'evade',
      }),
    );
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.aggroTargetId).toBeNull();
    expect(boss.castingAbility).toBeNull();
  });

  it('keeps a player standing in the north gate recess in the fight', () => {
    const { sim, boss, tank, place } = room();
    place(tank, KORGATH_SPOT.x, KORGATH_SPOT.z + 22.6);
    const hp = boss.hp;
    sim.ctx.dealDamage(tank, boss, 100, false, 'arcane', 'test', 'hit');
    expect(boss.hp).toBeLessThan(hp);
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aggroTargetId).toBe(tank.id);
  });

  it('keeps an inside tank fighting while refusing damage from an outside party member', () => {
    const { sim, boss, tank, state, place } = room();
    const mageId = sim.addPlayer('mage', 'OutsideCaster');
    const mage = sim.entities.get(mageId);
    if (!mage) throw new Error('missing caster');
    mage.devNoAggro = true;
    sim.partyInvite(mage.id, tank.id);
    sim.partyAccept(mage.id);
    place(mage, KORGATH_SPOT.x, KORGATH_SPOT.z - LOCK_TERRACE.r - 5);
    const hp = boss.hp;
    sim.ctx.dealDamage(mage, boss, 100, false, 'arcane', 'test', 'hit');
    expect(boss.hp).toBe(hp);
    sim.tick();
    expect(boss.aiState).not.toBe('evade');
    expect(boss.aggroTargetId).toBe(tank.id);
    expect(korgathState(boss)).toBe(state);
    expect(state.chains.filter((chain) => chain.broken)).toHaveLength(0);
  });

  it('preserves legal ranged play inside the terrace and lets the chained boss answer with Stomp', () => {
    const { sim, boss, tank, state, place } = room();
    place(tank, KORGATH_SPOT.x, KORGATH_SPOT.z + LOCK_TERRACE.r - 1);
    const events = tickFor(sim, 10);
    expect(boss.aiState).not.toBe('evade');
    expect(korgathState(boss)).toBe(state);
    expect(state.chains.filter((chain) => chain.broken)).toHaveLength(0);
    expect(dist2d(boss.pos, boss.spawnPos)).toBeLessThanOrEqual(10 + 1e-6);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' &&
          event.sourceId === boss.id &&
          event.targetId === tank.id &&
          event.ability === 'Shuddering Stomp' &&
          event.amount > 0,
      ),
    ).toBe(true);
  });

  it("keeps the pull while Valkyr's Calling carries its inside paladin above the fighting floor", () => {
    const { sim, boss, tank, state, place } = room('paladin');
    place(tank, KORGATH_SPOT.x, KORGATH_SPOT.z - 12);
    tank.resource = tank.maxResource;
    tank.facing = Math.atan2(boss.pos.x - tank.pos.x, boss.pos.z - tank.pos.z);
    sim.targetEntity(boss.id);
    sim.castAbility('valkyrs_calling');
    expect(tank.valkyrsCalling).toBeTruthy();
    let highestAboveFloor = 0;
    for (let i = 0; i < 60 && tank.valkyrsCalling; i++) {
      sim.tick();
      highestAboveFloor = Math.max(highestAboveFloor, tank.pos.y - LOCK_TERRACE.h);
      expect(boss.aiState).not.toBe('evade');
      expect(boss.inCombat).toBe(true);
      expect(boss.aggroTargetId).toBe(tank.id);
      expect(boss.threat.has(tank.id)).toBe(true);
      expect(korgathState(boss)).toBe(state);
    }
    expect(highestAboveFloor).toBeGreaterThan(7);
    expect(tank.valkyrsCalling).toBeNull();
    expect(state.chains.filter((chain) => chain.broken)).toHaveLength(0);
  });

  it('resets a freed boss dragged past the arena and restores full health and all four chains', () => {
    const { sim, inst, boss, tank, state, place } = room();
    expect(breakChain(sim.ctx, inst, boss, state, 'anvil')).toBe(true);
    boss.hp = Math.floor(boss.maxHp / 2);
    place(boss, KORGATH_SPOT.x, KORGATH_SPOT.z + LOCK_TERRACE.r + 8);
    boss.leashAnchor = { ...boss.pos };
    place(tank, KORGATH_SPOT.x, KORGATH_SPOT.z + LOCK_TERRACE.r + 10);
    sim.tick();
    expect(boss.aiState).toBe('evade');
    expect(boss.aggroTargetId).toBeNull();
    expect(boss.castingAbility).toBeNull();
    tank.devNoAggro = true;
    tickFor(sim, 20);
    expect(boss.aiState).not.toBe('evade');
    expect(boss.hp).toBe(boss.maxHp);
    expect(dist2d(boss.pos, boss.spawnPos)).toBeLessThan(2);
    const fresh = korgathState(boss);
    expect(fresh).not.toBe(state);
    expect(fresh?.engaged).toBe(false);
    expect(fresh?.chains).toHaveLength(4);
    for (const tool of SEAL_TOOLS) {
      const chain = fresh?.chains.find((candidate) => candidate.tool === tool);
      expect(chain?.broken, tool).toBe(false);
      const shackle =
        chain?.shackleId !== null ? sim.entities.get(chain?.shackleId ?? -1) : undefined;
      expect(shackle?.dead, tool).toBe(false);
    }
  });
});
