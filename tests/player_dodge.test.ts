import { describe, expect, it } from 'vitest';
import { dealDamage, handleDeath } from '../src/sim/combat/damage';
import { runEffects } from '../src/sim/combat/effect_dispatch';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  DODGE_DISTANCE,
  DODGE_DURATION,
  DODGE_ENDURANCE_COST,
  DODGE_ENDURANCE_MAX,
  DODGE_ENDURANCE_REGEN_PER_SECOND,
  isPlayerDodging,
  playerEndurance,
} from '../src/sim/player_dodge';
import type { ResolvedAbility } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import { type AbilityDef, DT, type Entity, type SimEvent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

function fixture(seed = 810): { sim: Sim; player: Entity; mob: Entity } {
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    playerDirectionalCombat: true,
  });
  placePlayerInOpenField(sim);
  const player = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, player.level, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 3,
  });
  mob.hostile = true;
  mob.hp = mob.maxHp = 100_000;
  sim.addEntity(mob);
  sim.drainEvents();
  return { sim, player, mob };
}

function damageEvents(events: SimEvent[]): Extract<SimEvent, { type: 'damage' }>[] {
  return events.filter(
    (event): event is Extract<SimEvent, { type: 'damage' }> => event.type === 'damage',
  );
}

describe('server-authoritative player dodge', () => {
  it('spends one charge, moves in the normalized direction and regenerates endurance', () => {
    const { sim, player } = fixture();
    const startX = player.pos.x;
    const startZ = player.pos.z;

    sim.dodge({ x: 0, z: 8 });
    expect(isPlayerDodging(player)).toBe(true);
    expect(playerEndurance(player)).toBe(DODGE_ENDURANCE_MAX - DODGE_ENDURANCE_COST);

    const ticks = Math.ceil(DODGE_DURATION / DT);
    for (let i = 0; i < ticks; i++) sim.tick();

    expect(isPlayerDodging(player)).toBe(false);
    expect(player.pos.x).toBeCloseTo(startX, 5);
    expect(player.pos.z - startZ).toBeCloseTo(DODGE_DISTANCE, 1);
    expect(playerEndurance(player)).toBeCloseTo(
      DODGE_ENDURANCE_MAX - DODGE_ENDURANCE_COST + ticks * DT * DODGE_ENDURANCE_REGEN_PER_SECOND,
      5,
    );
  });

  it('supports two charges, rejects a third and clamps regeneration at full', () => {
    const { sim, player } = fixture(811);
    const dodgeTicks = Math.ceil(DODGE_DURATION / DT);

    sim.dodge({ x: 1, z: 0 });
    for (let i = 0; i < dodgeTicks; i++) sim.tick();
    const beforeSecond = playerEndurance(player);
    sim.dodge({ x: -1, z: 0 });
    expect(playerEndurance(player)).toBeCloseTo(beforeSecond - DODGE_ENDURANCE_COST, 5);
    for (let i = 0; i < dodgeTicks; i++) sim.tick();

    const beforeRejected = playerEndurance(player);
    sim.dodge({ x: 0, z: 1 });
    expect(isPlayerDodging(player)).toBe(false);
    expect(playerEndurance(player)).toBe(beforeRejected);

    const regenTicks = Math.ceil(DODGE_ENDURANCE_MAX / (DODGE_ENDURANCE_REGEN_PER_SECOND * DT));
    for (let i = 0; i < regenTicks; i++) sim.tick();
    expect(playerEndurance(player)).toBe(DODGE_ENDURANCE_MAX);
    expect(player.endurance).toBeUndefined();
  });

  it('turns direct damage into a dodge result without losing health', () => {
    const { sim, player, mob } = fixture(812);
    const hp = player.hp;
    sim.dodge({ x: 1, z: 0 });

    dealDamage(sim.ctx, mob, player, 999, false, 'fire', 'Fireball', 'hit');

    expect(player.hp).toBe(hp);
    expect(damageEvents(sim.drainEvents())).toContainEqual(
      expect.objectContaining({
        sourceId: mob.id,
        targetId: player.id,
        amount: 0,
        kind: 'dodge',
      }),
    );
  });

  it('does not evade indirect periodic damage', () => {
    const { sim, player, mob } = fixture(813);
    const hp = player.hp;
    sim.dodge({ x: 1, z: 0 });

    dealDamage(sim.ctx, mob, player, 7, false, 'shadow', 'Bleed', 'hit', false, undefined, false);

    expect(player.hp).toBe(hp - 7);
  });

  it('evades a ground pulse before its damage, snare and rng roll', () => {
    const { sim, player } = fixture(816);
    const sourceId = sim.addPlayer('mage', 'Ground Caster', { autoEquip: true });
    const source = sim.entities.get(sourceId);
    if (!source) throw new Error('missing ground caster');
    sim.rebucket(player);
    source.pos = { ...player.pos };
    source.prevPos = { ...source.pos };
    sim.rebucket(source);
    const duel = {
      a: sourceId,
      b: player.id,
      state: 'active' as const,
      timer: 0,
      controlled: new Map<number, Set<number>>(),
    };
    sim.duels.set(sourceId, duel);
    sim.duels.set(player.id, duel);
    const hp = player.hp;
    sim.dodge({ x: 1, z: 0 });
    sim.ctx.pulseGroundAoE({
      sourceId,
      pos: { ...player.pos },
      radius: 8,
      min: 50,
      max: 50,
      remaining: 3,
      interval: 1,
      tickTimer: 1,
      school: 'frost',
      ability: 'Test Blizzard',
      abilityId: 'test_blizzard',
      slowMult: 0.5,
      slowDuration: 2,
    });

    expect(player.hp).toBe(hp);
    expect(player.auras.some((aura) => aura.kind === 'slow')).toBe(false);
    expect(damageEvents(sim.drainEvents())).toContainEqual(
      expect.objectContaining({ targetId: player.id, kind: 'dodge' }),
    );
  });

  it('evades a targeted attack as one packet including its condition', () => {
    const { sim, player } = fixture(817);
    const sourceId = sim.addPlayer('warlock', 'Condition Caster', { autoEquip: true });
    const source = sim.entities.get(sourceId);
    const sourceMeta = sim.players.get(sourceId);
    if (!source || !sourceMeta) throw new Error('missing condition caster');
    const duel = {
      a: sourceId,
      b: player.id,
      state: 'active' as const,
      timer: 0,
      controlled: new Map<number, Set<number>>(),
    };
    sim.duels.set(sourceId, duel);
    sim.duels.set(player.id, duel);
    const def: AbilityDef = {
      id: 'test_shadow_packet',
      name: 'Test Shadow Packet',
      class: 'warlock',
      learnLevel: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
      range: 30,
      school: 'shadow',
      requiresTarget: true,
      effects: [
        { type: 'directDamage', min: 20, max: 20 },
        { type: 'dot', total: 30, duration: 3, interval: 1 },
      ],
      description: '',
    };
    const resolved: ResolvedAbility = {
      def,
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
    const hp = player.hp;
    sim.dodge({ x: 1, z: 0 });
    runEffects(sim.ctx, source, sourceMeta, player, resolved);

    expect(player.hp).toBe(hp);
    expect(player.auras.some((aura) => aura.kind === 'dot')).toBe(false);
    expect(
      damageEvents(sim.drainEvents()).filter(
        (event) => event.targetId === player.id && event.kind === 'dodge',
      ),
    ).toHaveLength(1);
  });

  it('rejects malformed, rooted, airborne and mounted starts', () => {
    const { sim, player } = fixture(814);
    const attempt = (direction: { x: number; z: number }) => {
      sim.dodge(direction);
      expect(isPlayerDodging(player)).toBe(false);
      expect(playerEndurance(player)).toBe(DODGE_ENDURANCE_MAX);
    };

    attempt({ x: Number.NaN, z: 0 });
    player.onGround = false;
    attempt({ x: 1, z: 0 });
    player.onGround = true;
    player.mountKey = 'valorsteed';
    attempt({ x: 1, z: 0 });
    player.mountKey = '';
    player.auras.push({
      id: 'test-root',
      name: 'Root',
      kind: 'root',
      remaining: 2,
      duration: 2,
      value: 0,
      sourceId: player.id,
      school: 'frost',
    });
    attempt({ x: 1, z: 0 });
  });

  it('cancels a cast on start and refills when death clears the runtime state', () => {
    const { sim, player, mob } = fixture(815);
    player.castingAbility = 'hearthstone';
    player.castRemaining = 5;
    player.castTotal = 5;

    sim.dodge({ x: 1, z: 0 });
    expect(player.castingAbility).toBeNull();
    expect(playerEndurance(player)).toBe(50);
    handleDeath(sim.ctx, player, mob);
    expect(isPlayerDodging(player)).toBe(false);
    expect(playerEndurance(player)).toBe(DODGE_ENDURANCE_MAX);
  });
});
