import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { retryPendingDifficultyChanges } from '../src/sim/instances/difficulty_selection';
import { enterDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

function setup() {
  const sim = new Sim({
    seed: 99,
    playerClass: 'warrior',
    noPlayer: true,
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
  const leader = sim.addPlayer('warrior', 'Lead');
  const member = sim.addPlayer('priest', 'Member');
  sim.partyInvite(member, leader);
  sim.partyAccept(member);
  expect(sim.enterDungeon('hollow_crypt', member)).toBe(true);
  const inst = sim.instances.find((i) => i.partyKey !== null && i.dungeonId === 'hollow_crypt')!;
  sim.drainEvents();
  return { sim, leader, member, inst };
}
function advance(sim: Sim) {
  const events = [];
  for (let i = 0; i < 20; i++) events.push(...sim.tick());
  return events;
}
describe('difficulty selection through the live Sim', () => {
  it('explains occupancy and queues a switch until the member exits', () => {
    const { sim, leader, member, inst } = setup();
    sim.setDungeonDifficulty('heroic', leader);
    const text = sim
      .drainEvents()
      .filter((e) => e.type === 'error')
      .map((e) => e.text);
    expect(text).toContain('You cannot reset instances while someone is still inside.');
    expect(text).toContain(
      'Difficulty change queued because someone or their corpse is still inside. It will apply when the instances are clear.',
    );
    expect(text).not.toContain('Dungeon difficulty set to Heroic.');
    expect(inst.difficulty).toBe('normal');
    expect(advance(sim).filter((e) => e.type === 'error')).toEqual([]);
    sim.leaveDungeon(member);
    const applied = advance(sim)
      .filter((e) => e.type === 'error')
      .map((e) => e.text);
    expect(inst.difficulty).toBe('heroic');
    expect(applied).toContain('Dungeon difficulty set to Heroic.');
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
  });
  it('lets a failed loot switch retry the same selected tier', () => {
    const { sim, leader, member, inst } = setup();
    sim.leaveDungeon(member);
    const mob = sim.entities.get(inst.mobIds[0])!;
    mob.lootable = true;
    sim.drainEvents();
    sim.setDungeonDifficulty('heroic', leader);
    expect(
      sim
        .drainEvents()
        .some(
          (e) =>
            e.type === 'error' &&
            e.text === 'You cannot reset instances while loot remains inside.',
        ),
    ).toBe(true);
    expect(inst.difficulty).toBe('normal');
    mob.lootable = false;
    sim.setDungeonDifficulty('heroic', leader);
    expect(inst.difficulty).toBe('heroic');
  });
  it('reports a changed queued blocker once and applies after loot clears', () => {
    const { sim, leader, member, inst } = setup();
    sim.setDungeonDifficulty('heroic', leader);
    sim.drainEvents();
    sim.entities.get(inst.mobIds[0])!.lootable = true;
    sim.leaveDungeon(member);
    expect(
      advance(sim)
        .filter((e) => e.type === 'error')
        .map((e) => e.text),
    ).toContain('You cannot reset instances while loot remains inside.');
    expect(advance(sim).filter((e) => e.type === 'error')).toEqual([]);
    sim.entities.get(inst.mobIds[0])!.lootable = false;
    advance(sim);
    expect(inst.difficulty).toBe('heroic');
  });
  it('cancels a pending switch when its leader leaves the party', () => {
    const { sim, leader, member, inst } = setup();
    sim.setDungeonDifficulty('heroic', leader);
    sim.partyLeave(leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
    sim.leaveDungeon(member);
    advance(sim);
    expect(inst.difficulty).toBe('normal');
  });
  it('cancels a pending switch when another member joins the party', () => {
    const { sim, leader, member, inst } = setup();
    const recruit = sim.addPlayer('mage', 'Recruit');
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.has(leader)).toBe(true);
    sim.partyInvite(recruit, leader);
    sim.partyAccept(recruit);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
    sim.leaveDungeon(member);
    advance(sim);
    expect(inst.difficulty).toBe('normal');
  });
  it('cancels a pending switch when a non-leader leaves an ongoing party', () => {
    const { sim, leader, member, inst } = setup();
    const recruit = sim.addPlayer('mage', 'Recruit');
    sim.partyInvite(recruit, leader);
    sim.partyAccept(recruit);
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.has(leader)).toBe(true);
    sim.partyLeave(recruit);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
    sim.leaveDungeon(member);
    advance(sim);
    expect(inst.difficulty).toBe('normal');
  });
  it('cancels a queued transition when the leader selects the current claim tier', () => {
    const { sim, leader, member, inst } = setup();
    sim.setDungeonDifficulty('heroic', leader);
    sim.setDungeonDifficulty('normal', leader);
    sim.leaveDungeon(member);
    advance(sim);
    expect(inst.difficulty).toBe('normal');
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
  });
  it('keeps a released ghost outside blocked by its corpse until recovery', () => {
    const { sim, leader, member, inst } = setup();
    const entity = sim.entities.get(member)!;
    const corpse = { ...entity.pos };
    sim.leaveDungeon(member);
    entity.ghost = true;
    entity.dead = true;
    entity.corpsePos = corpse;
    entity.corpseInstanceId = inst.exitId;
    sim.setDungeonDifficulty('heroic', leader);
    expect(inst.difficulty).toBe('normal');
    advance(sim);
    expect(inst.difficulty).toBe('normal');
    entity.ghost = false;
    entity.dead = false;
    entity.corpsePos = null;
    entity.corpseInstanceId = null;
    advance(sim);
    expect(inst.difficulty).toBe('heroic');
  });
  it('cancels leadership promotion immediately even if the leader is promoted back', () => {
    const { sim, leader, member, inst } = setup();
    sim.setDungeonDifficulty('heroic', leader);
    sim.partyPromote(member, leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
    sim.partyPromote(leader, member);
    sim.leaveDungeon(member);
    advance(sim);
    expect(inst.difficulty).toBe('normal');
  });
  it('cancels player removal without leaking requests to another Sim', () => {
    const { sim, leader } = setup();
    const other = setup().sim;
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(1);
    expect(other.ctx.pendingDifficultyChanges.size).toBe(0);
    sim.removePlayer(leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
  });
  it('reports the dungeon cooldown without falsely reporting a successful switch', () => {
    const { sim, leader, member, inst } = setup();
    sim.leaveDungeon(member);
    sim.setDungeonDifficulty('heroic', leader);
    sim.drainEvents();
    sim.setDungeonDifficulty('normal', leader);
    expect(inst.difficulty).toBe('heroic');
    expect(
      sim
        .drainEvents()
        .filter((e) => e.type === 'error')
        .map((e) => e.text),
    ).toEqual(['Instances can only be reset once every 5 minutes.']);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
  });
  it('reports a target-tier lockout without claiming success', () => {
    const { sim, leader, member, inst } = setup();
    sim.leaveDungeon(member);
    sim.players.get(leader)!.raidLockouts.set('hollow_crypt:heroic', Number.MAX_SAFE_INTEGER);
    sim.drainEvents();
    sim.setDungeonDifficulty('heroic', leader);
    expect(inst.difficulty).toBe('normal');
    expect(
      sim
        .drainEvents()
        .filter((e) => e.type === 'error')
        .map((e) => e.text),
    ).toEqual(['You are locked to Heroic The Hollow Crypt.']);
  });
  it('switches raid difficulty back immediately, preserving the raid cooldown exemption', () => {
    const { sim, leader, member, inst: dungeon } = setup();
    sim.leaveDungeon(member);
    // Keep the standard claim aligned so its five-minute rule is independent.
    dungeon.partyKey = null;
    while (sim.partyOf(leader)!.members.length < 5) {
      const pid = sim.addPlayer('priest', `Fill${sim.players.size}`);
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leader);
    sim.players.get(leader)!.questsDone.add('q_nythraxis_bound_guardian');
    expect(sim.enterDungeon('nythraxis_boss_arena', leader)).toBe(true);
    const raid = sim.instances.find(
      (i) => i.partyKey !== null && i.dungeonId === 'nythraxis_boss_arena',
    )!;
    sim.leaveDungeon(leader);
    sim.setDungeonDifficulty('heroic', leader);
    expect(raid.difficulty).toBe('heroic');
    expect(raid.resetAvailableAt).toBeLessThanOrEqual(sim.time);
    sim.setDungeonDifficulty('normal', leader);
    expect(raid.difficulty).toBe('normal');
  });
  it('does not scan players or instances without a pending request', () => {
    const { sim } = setup();
    const quietContext = Object.create(sim.ctx);
    Object.defineProperty(quietContext, 'players', {
      get: () => {
        throw new Error('idle scan');
      },
    });
    Object.defineProperty(quietContext, 'instances', {
      get: () => {
        throw new Error('idle scan');
      },
    });
    expect(() => retryPendingDifficultyChanges(quietContext)).not.toThrow();
  });

  it('queues occupancy even alongside cooldown, then reports cooldown once until expiry', () => {
    const { sim, leader, member, inst } = setup();
    inst.resetAvailableAt = sim.time + 60;
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(1);
    sim.drainEvents();
    sim.leaveDungeon(member);
    expect(
      advance(sim)
        .filter((e) => e.type === 'error')
        .map((e) => e.text),
    ).toContain('Instances can only be reset once every 5 minutes.');
    expect(advance(sim).filter((e) => e.type === 'error')).toEqual([]);
    inst.resetAvailableAt = sim.time;
    advance(sim);
    expect(inst.difficulty).toBe('heroic');
  });
  it('shares one player occupancy walk across a thousand pending players', () => {
    const { sim, leader, member, inst } = setup();
    sim.setDungeonDifficulty('heroic', leader);
    while (sim.players.size < 1000) {
      const pid = sim.addPlayer('warrior', `Waiting${sim.players.size}`);
      sim.players.get(pid)!.dungeonDifficulty = 'heroic';
      sim.ctx.pendingDifficultyChanges.set(pid, {
        key: sim.ctx.instanceKeyFor(pid),
        difficulty: 'heroic',
        lastReason: '',
      });
    }
    let walks = 0;
    const players = new Proxy(sim.players, {
      get(target, property) {
        if (property === 'values')
          return () => {
            walks++;
            return target.values();
          };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const context = Object.create(sim.ctx);
    Object.defineProperty(context, 'players', { value: players });
    retryPendingDifficultyChanges(context);
    expect(walks).toBe(1);
    expect(inst.difficulty).toBe('normal');
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(1);
    expect(sim.ctx.pendingDifficultyChanges.has(leader)).toBe(true);
    expect(sim.players.has(member)).toBe(true);
  });
  it('queues a linked Ignivar family switch while a deeper room is occupied', () => {
    const sim = new Sim({
      seed: 99,
      playerClass: 'warrior',
      noPlayer: true,
      devCommands: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    const leader = sim.addPlayer('warrior', 'Leader');
    // The dev entry fixture bypasses progression only, using real spawned claims.
    expect(enterDungeon(sim.ctx, 'ignivar_forge_lift', leader, true)).toBe(true);
    expect(enterDungeon(sim.ctx, 'ignivar_raid_arena', leader, true)).toBe(true);
    const lift = sim.instances.find(
      (i) => i.partyKey !== null && i.dungeonId === 'ignivar_forge_lift',
    )!;
    const deep = sim.instances.find(
      (i) => i.partyKey !== null && i.dungeonId === 'ignivar_raid_arena',
    )!;
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(1);
    expect(lift.difficulty).toBe('normal');
    advance(sim);
    expect(lift.difficulty).toBe('normal');
    const entity = sim.entities.get(leader)!;
    entity.pos = { x: 0, y: 0, z: 0 };
    entity.prevPos = { ...entity.pos };
    advance(sim);
    expect(lift.difficulty).toBe('heroic');
    expect(deep.partyKey).toBeNull();
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
  });
  it('retains the queued request through a target lockout and applies after expiry', () => {
    const { sim, leader, member, inst } = setup();
    sim.players.get(leader)!.raidLockouts.set('hollow_crypt:heroic', Number.MAX_SAFE_INTEGER);
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(1);
    sim.drainEvents();
    sim.leaveDungeon(member);
    expect(
      advance(sim)
        .filter((e) => e.type === 'error')
        .map((e) => e.text),
    ).toContain('You are locked to Heroic The Hollow Crypt.');
    expect(advance(sim).filter((e) => e.type === 'error')).toEqual([]);
    sim.players.get(leader)!.raidLockouts.delete('hollow_crypt:heroic');
    advance(sim);
    expect(inst.difficulty).toBe('heroic');
  });
  it('replays queued application with identical state, events, and RNG draws', () => {
    function replay() {
      const { sim, leader, member } = setup();
      const draws: number[] = [];
      sim.rng.setObserver((value) => draws.push(value));
      sim.setDungeonDifficulty('heroic', leader);
      const events = [...sim.drainEvents(), ...advance(sim)];
      sim.leaveDungeon(member);
      events.push(...sim.drainEvents(), ...advance(sim));
      return {
        events,
        draws,
        claims: sim.instances.map((i) => ({
          dungeonId: i.dungeonId,
          partyKey: i.partyKey,
          difficulty: i.difficulty,
          exitId: i.exitId,
          mobIds: [...i.mobIds],
        })),
        entities: [...sim.entities.values()].map((e) => ({
          id: e.id,
          pos: { ...e.pos },
          hp: e.hp,
          dead: e.dead,
        })),
        pending: [...sim.ctx.pendingDifficultyChanges],
      };
    }
    const first = replay();
    expect(first.draws.length).toBeGreaterThan(0);
    expect(replay()).toEqual(first);
  });
  it.each(['wrongClaim', 'outsideCorpse', 'livingStaleCorpse'] as const)(
    'does not let %s metadata block the optimized queued retry',
    (kind) => {
      const { sim, leader, member, inst } = setup();
      const entity = sim.entities.get(member)!;
      const corpse = { ...entity.pos };
      sim.setDungeonDifficulty('heroic', leader);
      sim.leaveDungeon(member);
      entity.ghost = kind !== 'livingStaleCorpse';
      entity.dead = entity.ghost;
      entity.corpsePos = kind === 'outsideCorpse' ? { x: 0, y: 0, z: 0 } : corpse;
      entity.corpseInstanceId = kind === 'wrongClaim' ? -1 : inst.exitId;
      advance(sim);
      expect(inst.difficulty).toBe('heroic');
      expect(sim.ctx.pendingDifficultyChanges.size).toBe(0);
    },
  );
  it('queues occupancy before pre-existing loot and waits for that loot after exit', () => {
    const { sim, leader, member, inst } = setup();
    sim.entities.get(inst.mobIds[0])!.lootable = true;
    sim.setDungeonDifficulty('heroic', leader);
    expect(sim.ctx.pendingDifficultyChanges.size).toBe(1);
    sim.leaveDungeon(member);
    advance(sim);
    expect(inst.difficulty).toBe('normal');
    sim.entities.get(inst.mobIds[0])!.lootable = false;
    advance(sim);
    expect(inst.difficulty).toBe('heroic');
  });
});
