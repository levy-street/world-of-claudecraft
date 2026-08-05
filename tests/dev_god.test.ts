import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function godSim(devCommands = true): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 3, playerClass: 'warrior', autoEquip: true, devCommands });
  sim.setPlayerLevel(20);
  return { sim, pid: sim.playerId };
}

function spawnMob(sim: Sim, hp = 60000): Entity {
  const p = sim.player;
  const mob = createMob(9300, MOBS.forest_wolf, 20, { x: p.pos.x, y: p.pos.y, z: p.pos.z + 3 });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  mob.stats = { ...mob.stats, armor: 0 };
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

const deal = (sim: Sim, s: Entity | null, t: Entity, n: number) =>
  (
    sim as unknown as {
      dealDamage(
        s: Entity | null,
        t: Entity,
        n: number,
        c: boolean,
        sc: string,
        a: string | null,
        k: string,
      ): void;
    }
  ).dealDamage(s, t, n, false, 'physical', null, 'hit');

describe('/dev god cheat', () => {
  it('toggles god mode, makes the player invulnerable, and tops off resources', () => {
    const { sim, pid } = godSim();
    const p = sim.player;
    p.hp = Math.round(p.maxHp * 0.3);
    sim.chat('/dev god', pid);
    expect(p.devGod).toBe(true);
    expect(p.hp).toBe(p.maxHp); // topped off on enable
    // Invulnerable: a hit that would kill leaves hp untouched.
    const mob = spawnMob(sim);
    deal(sim, mob, p, p.maxHp * 2);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(p.maxHp);
    // Toggle off.
    sim.chat('/dev god', pid);
    expect(p.devGod).toBe(false);
  });

  it('makes a god-mode player hit for 100x so a solo tester can down a raid boss', () => {
    const { sim, pid } = godSim();
    const p = sim.player;
    sim.chat('/dev god', pid);
    const boss = spawnMob(sim, 100000);
    const before = boss.hp;
    deal(sim, p, boss, 100); // base 100 -> 100x = 10000 before armor (armor 0 here)
    expect(before - boss.hp).toBe(10000);
  });

  it('emits one zero-damage presentation event when a mob hits a devGod target', () => {
    // The renderer keys attacker swing animations and FCT off damage events,
    // so a silent invulnerability return made every melee mob look like a
    // passive follower during god-mode playtests. The hit must surface as a
    // zero-damage event, and ONLY as that event: no threat, deed, or proc
    // side effects ride along and the target never loses hp.
    const { sim, pid } = godSim();
    const p = sim.player;
    sim.chat('/dev god', pid);
    const mob = spawnMob(sim);
    sim.drainEvents();
    deal(sim, mob, p, 500);
    const events = sim.drainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'damage',
      sourceId: mob.id,
      targetId: p.id,
      amount: 0,
      school: 'physical',
    });
    expect(p.hp).toBe(p.maxHp);
  });

  it('keeps the zero-damage emit dev-only: no event without the gate, for GMs, or sourceless', () => {
    // devGod forced on without the dev gate (the production shape): silent.
    const off = godSim(false);
    off.sim.player.devGod = true;
    const offMob = spawnMob(off.sim);
    off.sim.drainEvents();
    deal(off.sim, offMob, off.sim.player, 500);
    expect(off.sim.drainEvents().filter((e) => e.type === 'damage')).toHaveLength(0);
    // A real GM (not devGod) stays fully silent even with dev commands on.
    const gm = godSim();
    gm.sim.player.gm = true;
    const gmMob = spawnMob(gm.sim);
    gm.sim.drainEvents();
    deal(gm.sim, gmMob, gm.sim.player, 500);
    expect(gm.sim.drainEvents().filter((e) => e.type === 'damage')).toHaveLength(0);
    // Sourceless damage (an environment tick) has no attacker to animate.
    const env = godSim();
    env.sim.chat('/dev god', env.sim.playerId);
    env.sim.drainEvents();
    deal(env.sim, null, env.sim.player, 500);
    expect(env.sim.drainEvents().filter((e) => e.type === 'damage')).toHaveLength(0);
  });

  it('is gated: without dev commands, /dev god does nothing', () => {
    const { sim, pid } = godSim(false);
    sim.chat('/dev god', pid);
    expect(sim.player.devGod).toBeFalsy();
    // And even if gm were somehow set, the 100x amp is dev-gated.
    const boss = spawnMob(sim, 60000);
    sim.player.devGod = true;
    const before = boss.hp;
    deal(sim, sim.player, boss, 100);
    expect(before - boss.hp).toBe(100); // no amp: plain 100
  });
});

describe('profiler-only invulnerability', () => {
  it('preserves incoming hit presentation without changing outgoing damage', () => {
    const { sim } = godSim();
    const player = sim.player;
    player.profilerInvulnerable = true;
    const attacker = spawnMob(sim);
    const target = spawnMob(sim, 60000);

    sim.drainEvents();
    deal(sim, attacker, player, 500);
    const events = sim.drainEvents();

    expect(player.hp).toBe(player.maxHp);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'damage',
      sourceId: attacker.id,
      targetId: player.id,
      amount: 0,
      school: 'physical',
    });

    const before = target.hp;
    deal(sim, player, target, 100);
    expect(before - target.hp).toBe(100);
  });

  it('does not grant profiler invulnerability when dev commands are disabled', () => {
    const { sim } = godSim(false);
    const player = sim.player;
    player.profilerInvulnerable = true;
    const attacker = spawnMob(sim);

    const before = player.hp;
    deal(sim, attacker, player, 500);

    expect(player.hp).toBe(before - 500);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'damage',
        sourceId: attacker.id,
        targetId: player.id,
        amount: 500,
      }),
    );
  });
});

describe('/dev attune + /dev raid cheats', () => {
  it('/dev attune marks every quest done, opening the raid attunement gate', () => {
    const { sim, pid } = godSim();
    sim.chat('/dev attune', pid);
    const meta = sim.players.get(pid)!;
    expect(meta.questsDone.has('q_nythraxis_bound_guardian')).toBe(true);
  });

  it('/dev attune does NOT wipe the in-progress quest log', () => {
    const { sim, pid } = godSim();
    const meta = sim.players.get(pid)!;
    const hadQuests = meta.questLog.size;
    sim.chat('/dev attune', pid);
    // Stamps questsDone but leaves any in-progress quest tracker intact.
    expect(meta.questLog.size).toBe(hadQuests);
  });

  it('is gated: without dev commands, /dev attune does nothing', () => {
    const { sim, pid } = godSim(false);
    const meta = sim.players.get(pid)!;
    sim.chat('/dev attune', pid);
    expect(meta.questsDone.has('q_nythraxis_bound_guardian')).toBe(false);
  });

  it('/dev raid heroic zones a lone player into the heroic Nythraxis arena', () => {
    const { sim, pid } = godSim();
    sim.chat('/dev raid heroic', pid);
    const inst = (
      sim as unknown as {
        instances: { dungeonId: string; difficulty: string; partyKey: string | null }[];
      }
    ).instances.find((i) => i.dungeonId === 'nythraxis_boss_arena' && i.partyKey !== null);
    expect(inst).toBeTruthy();
    expect(inst!.difficulty).toBe('heroic');
  });

  it('/dev raid reset clears raid lockouts', () => {
    const { sim, pid } = godSim();
    const meta = sim.players.get(pid)!;
    meta.raidLockouts.set('nythraxis_boss_arena:heroic', 999999);
    sim.chat('/dev raid reset', pid);
    expect(meta.raidLockouts.size).toBe(0);
  });

  it('is gated: without dev commands, /dev raid does not zone in', () => {
    const { sim, pid } = godSim(false);
    sim.chat('/dev raid heroic', pid);
    const claimed = (
      sim as unknown as { instances: { dungeonId: string; partyKey: string | null }[] }
    ).instances.some((i) => i.dungeonId === 'nythraxis_boss_arena' && i.partyKey !== null);
    expect(claimed).toBe(false);
  });
});
