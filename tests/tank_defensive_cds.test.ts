// Tank defensive cooldowns, one distinct mechanic per class:
//   - Warrior Ironhold: a flat 40% damage-taken reduction (shield_wall).
//   - Paladin Sacred Bulwark: a cheat-death that denies a lethal blow and restores 35%.
//   - Druid Primal Reflexes: a dodge cooldown (buff_dodge), usable while shapeshifted.
// Also covers the druid parity buff (Dire Bruin now +20% threat / +15% armor).
import { describe, expect, it } from 'vitest';
import { TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { type ArenaMatch, Sim } from '../src/sim/sim';
import type { Aura, Entity, PlayerClass } from '../src/sim/types';

function make(cls: string) {
  const sim = new Sim({ seed: 5, playerClass: cls as any, autoEquip: true });
  sim.setPlayerLevel(20);
  const pid = sim.playerId;
  const p = sim.entities.get(pid) as Entity & Record<string, unknown>;
  for (let i = 0; i < 5; i++) sim.tick();
  (p as any).resource = (p as any).maxResource;
  return { sim, p, pid };
}

function spawnMob(sim: Sim, p: Entity, dz: number) {
  const mob = createMob((sim as any).nextId++, MOBS.ridge_stalker, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = mob.hp = 1_000_000;
  mob.hostile = true;
  sim.entities.set(mob.id, mob);
  (sim as any).rebucket(mob);
  return mob;
}

// Cast an instant ability and let it resolve (ticks past the GCD).
function cast(sim: Sim, id: string, pid: number) {
  (sim.entities.get(pid) as any).resource = (sim.entities.get(pid) as any).maxResource;
  sim.castAbility(id, pid);
  for (let i = 0; i < 32; i++) sim.tick();
}

function guardianWard(pid: number): Aura {
  return {
    id: 'sacred_bulwark',
    name: 'Sacred Bulwark',
    kind: 'guardian_ward',
    remaining: 10,
    duration: 10,
    value: 0.35,
    sourceId: pid,
    school: 'holy',
  };
}

function advanceArena(sim: Sim, pid: number): ArenaMatch {
  for (let i = 0; i < 20 * 8; i++) {
    const match = sim.arenaMatchFor(pid);
    if (match?.state === 'active') return match;
    sim.tick();
  }
  throw new Error('arena did not become active');
}

function startArenaMode(format: '1v1' | 'fiesta' | 'yumi3') {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
  const classes: PlayerClass[] =
    format === '1v1'
      ? ['paladin', 'warrior']
      : format === 'fiesta'
        ? ['paladin', 'mage', 'rogue', 'priest']
        : ['paladin', 'mage', 'rogue', 'priest', 'hunter', 'druid'];
  const pids = classes.map((cls, i) => sim.addPlayer(cls, `P${i}`));
  for (const pid of pids) sim.arenaQueueJoin(pid, format);
  sim.tick();
  const match = advanceArena(sim, pids[0]);
  const victimPid = pids[0];
  const victimOnA = match.teamA.includes(victimPid);
  const sourcePid = (victimOnA ? match.teamB : match.teamA)[0];
  return { sim, match, victimPid, sourcePid };
}

describe('Tank defensive cooldowns: known by their class at 20', () => {
  it('warrior knows Ironhold, paladin Sacred Bulwark, druid Primal Reflexes', () => {
    const CD: Record<string, string> = {
      warrior: 'ironhold',
      paladin: 'sacred_bulwark',
      druid: 'primal_reflexes',
    };
    for (const [cls, id] of Object.entries(CD)) {
      const { sim } = make(cls);
      expect(!!sim.resolvedAbility(id), `${cls} knows ${id}`).toBe(true);
    }
  });

  it('pins costs, cooldowns, durations, values and off-GCD tuning', () => {
    const expected = [
      {
        cls: 'warrior',
        id: 'ironhold',
        cost: 10,
        cooldown: 180,
        duration: 8,
        value: 0.4,
      },
      {
        cls: 'paladin',
        id: 'sacred_bulwark',
        cost: 15,
        cooldown: 180,
        duration: 10,
        value: 0.35,
      },
      {
        cls: 'druid',
        id: 'primal_reflexes',
        cost: 0,
        cooldown: 60,
        duration: 6,
        value: 0.5,
      },
    ] as const;

    for (const tuning of expected) {
      const { sim } = make(tuning.cls);
      const resolved = sim.resolvedAbility(tuning.id)!;
      const effect = resolved.effects[0];
      expect(resolved.cost, `${tuning.id} cost`).toBe(tuning.cost);
      expect(resolved.cooldown, `${tuning.id} cooldown`).toBe(tuning.cooldown);
      expect(resolved.def.offGcd, `${tuning.id} offGcd`).toBe(true);
      expect(effect.type, `${tuning.id} effect`).toBe('selfBuff');
      if (effect.type !== 'selfBuff') throw new Error(`${tuning.id} is not a self buff`);
      expect(effect.duration, `${tuning.id} duration`).toBe(tuning.duration);
      expect(effect.value, `${tuning.id} value`).toBe(tuning.value);
    }
  });
});

describe('Ironhold (warrior): flat 40% mitigation', () => {
  it('reduces direct and sourceless damage of every school, then expires', () => {
    const { sim, p, pid } = make('warrior');
    cast(sim, 'ironhold', pid);
    expect(p.auras.some((a) => a.kind === 'shield_wall')).toBe(true);
    const mob = spawnMob(sim, p, 3);
    (p as any).maxHp = p.hp = 1_000_000;
    for (const school of ['physical', 'fire', 'shadow']) {
      const before = p.hp;
      (sim as any).dealDamage(mob, p, 100, false, school, null, 'hit');
      expect(before - p.hp).toBe(60); // 40% reduced
    }
    const beforeHazard = p.hp;
    (sim as any).dealDamage(null, p, 100, false, 'nature', 'Hazard', 'hit');
    expect(beforeHazard - p.hp).toBe(60);

    const wall = p.auras.find((a) => a.kind === 'shield_wall')!;
    const ticksUntilExpired = Math.ceil((wall.remaining + 0.1) * 20);
    for (let i = 0; i < ticksUntilExpired; i++) sim.tick();
    expect(p.auras.some((a) => a.kind === 'shield_wall')).toBe(false);
  });

  it('mitigates a real DoT tick even after its caster despawns', () => {
    const { sim, p, pid } = make('warrior');
    cast(sim, 'ironhold', pid);
    const mob = spawnMob(sim, p, 3);
    p.maxHp = p.hp = 1_000_000;
    p.auras.push({
      id: 'test_dot',
      name: 'Test DoT',
      kind: 'dot',
      remaining: 1,
      duration: 1,
      value: 100,
      tickInterval: 0.05,
      tickTimer: 0.05,
      sourceId: mob.id,
      school: 'shadow',
    });
    sim.entities.delete(mob.id);

    const before = p.hp;
    sim.tick();
    expect(before - p.hp).toBe(60);
  });
});

describe('Sacred Bulwark (paladin): divine cheat-death', () => {
  it('denies a lethal blow and restores 35% health, consuming the ward', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    expect(p.auras.some((a) => a.kind === 'guardian_ward')).toBe(true);
    const mob = spawnMob(sim, p, 3);
    p.hp = p.maxHp;
    (sim as any).dealDamage(mob, p, p.maxHp * 5, false, 'physical', null, 'hit'); // lethal
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(Math.round(p.maxHp * 0.35));
    expect(p.auras.some((a) => a.kind === 'guardian_ward')).toBe(false);

    (sim as any).dealDamage(mob, p, p.hp + 100, false, 'physical', null, 'hit');
    expect(p.dead).toBe(true);
  });

  it('a non-lethal blow leaves the ward intact', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    const mob = spawnMob(sim, p, 3);
    p.hp = p.maxHp;
    (sim as any).dealDamage(mob, p, 10, false, 'physical', null, 'hit');
    expect(p.auras.some((a) => a.kind === 'guardian_ward')).toBe(true);
  });

  it('does not trigger on sourceless environmental damage', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    p.hp = 100;
    (sim as any).dealDamage(null, p, 150, false, 'physical', 'Falling', 'hit');
    expect(p.dead).toBe(true);
    expect(sim.events.some((event) => event.type === 'heal' && event.targetId === pid)).toBe(false);
  });

  it('does not trigger on friendly sourced damage', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    const allyPid = sim.addPlayer('priest', 'Ally');
    const ally = sim.entities.get(allyPid)!;
    p.hp = 100;

    (sim as any).dealDamage(ally, p, 150, false, 'holy', 'Friendly Fire', 'hit');

    expect(p.dead).toBe(true);
    expect(sim.events.some((event) => event.type === 'heal' && event.targetId === pid)).toBe(false);
  });

  it('reads the restore percentage from the ward aura value', () => {
    const { sim, p, pid } = make('paladin');
    const mob = spawnMob(sim, p, 3);
    p.auras.push({ ...guardianWard(pid), value: 0.42 });
    p.hp = p.maxHp;

    (sim as any).dealDamage(mob, p, p.maxHp * 5, false, 'physical', null, 'hit');

    expect(p.dead).toBe(false);
    expect(p.hp).toBe(Math.round(p.maxHp * 0.42));
  });

  it('clamps overkill and still runs normal damage bookkeeping and interruptions', () => {
    const { sim, p, pid } = make('paladin');
    cast(sim, 'sacred_bulwark', pid);
    const sourcePid = sim.addPlayer('warrior', 'Attacker');
    const source = sim.entities.get(sourcePid)!;
    const sourceMeta = sim.players.get(sourcePid)!;
    const targetMeta = sim.players.get(pid)!;
    const duel = { a: pid, b: sourcePid, state: 'active' as const, timer: 0 };
    sim.ctx.duels.set(pid, duel);
    sim.ctx.duels.set(sourcePid, duel);
    source.auras.push({
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: source.id,
      school: 'physical',
    });
    source.stealthed = true;
    p.auras.push({
      id: 'test_cc',
      name: 'Test CC',
      kind: 'incapacitate',
      remaining: 10,
      duration: 10,
      value: 0,
      sourceId: source.id,
      school: 'shadow',
      breaksOnDamage: true,
    });
    p.auras.push({
      id: 'target_stealth',
      name: 'Target Stealth',
      kind: 'stealth',
      remaining: 10,
      duration: 10,
      value: 1,
      sourceId: p.id,
      school: 'physical',
    });
    p.stealthed = true;
    p.eating = { itemId: 'food', kind: 'food', hpPer2s: 10, manaPer2s: 0, remaining: 10 };
    p.drinking = { itemId: 'drink', kind: 'drink', hpPer2s: 0, manaPer2s: 10, remaining: 10 };
    p.sitting = true;
    p.castingAbility = 'holy_light';
    p.castRemaining = 1;
    p.castTotal = 2;
    source.resource = 0;
    p.hp = p.maxHp;
    const expectedDamage = p.hp;
    const restored = Math.round(p.maxHp * 0.35);
    sim.drainEvents();

    (sim as any).dealDamage(source, p, p.hp * 5, false, 'physical', null, 'hit');
    const events = sim.drainEvents();

    expect(p.hp).toBe(restored);
    expect(p.inCombat).toBe(true);
    expect(source.inCombat).toBe(true);
    expect(targetMeta.counters.damageTaken).toBe(expectedDamage);
    expect(sourceMeta.counters.damageDealt).toBe(expectedDamage);
    expect(sourceMeta.deedStats.counters.damageDealt).toBe(expectedDamage);
    expect(source.resource).toBeGreaterThan(0);
    expect(p.auras.some((a) => a.breaksOnDamage)).toBe(false);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(source.auras.some((a) => a.kind === 'stealth')).toBe(false);
    expect(p.eating).toBeNull();
    expect(p.drinking).toBeNull();
    expect(p.sitting).toBe(false);
    expect(p.castRemaining).toBeGreaterThan(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'damage', targetId: pid, amount: expectedDamage }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'heal', targetId: pid, amount: restored }),
    );
  });

  it.each(['duel', '1v1', 'fiesta', 'yumi3'] as const)(
    'saves the paladin from an enemy lethal hit in %s',
    (mode) => {
      let sim: Sim;
      let victimPid: number;
      let sourcePid: number;
      let match: ArenaMatch | null = null;
      if (mode === 'duel') {
        sim = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
        victimPid = sim.addPlayer('paladin', 'Paladin');
        sourcePid = sim.addPlayer('warrior', 'Warrior');
        const duel = { a: victimPid, b: sourcePid, state: 'active' as const, timer: 0 };
        sim.ctx.duels.set(victimPid, duel);
        sim.ctx.duels.set(sourcePid, duel);
      } else {
        ({ sim, match, victimPid, sourcePid } = startArenaMode(mode));
      }
      const victim = sim.entities.get(victimPid)!;
      const source = sim.entities.get(sourcePid)!;
      victim.auras.push(guardianWard(victimPid));
      victim.hp = victim.maxHp;
      expect(victim.dead).toBe(false);
      expect(victim.auras.some((a) => a.kind === 'guardian_ward')).toBe(true);
      sim.drainEvents();

      (sim as any).dealDamage(source, victim, victim.hp * 5, false, 'physical', null, 'hit');

      expect(victim.dead).toBe(false);
      expect(victim.hp).toBe(Math.round(victim.maxHp * 0.35));
      if (mode === 'duel') expect(sim.ctx.duels.has(victimPid)).toBe(true);
      if (mode === '1v1') expect(match!.defeated.has(victimPid)).toBe(false);
      if (mode === 'fiesta') expect(match!.fiesta!.respawn.has(victimPid)).toBe(false);
      if (mode === 'yumi3') expect(match!.yumi!.respawn.has(victimPid)).toBe(false);
    },
  );
});

describe('Primal Reflexes (druid): dodge cooldown', () => {
  it('raises dodge chance and works while shapeshifted', () => {
    const { sim, p, pid } = make('druid');
    const baseDodge = p.dodgeChance;
    cast(sim, 'primal_reflexes', pid);
    expect(p.auras.some((a) => a.kind === 'buff_dodge')).toBe(true);
    expect(p.dodgeChance).toBeCloseTo(baseDodge + 0.5, 10);

    // usable in bear form: shift, then pop it
    const { sim: sim2, p: p2, pid: pid2 } = make('druid');
    cast(sim2, 'bear_form', pid2);
    expect(p2.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    const bearDodge = p2.dodgeChance;
    cast(sim2, 'primal_reflexes', pid2);
    expect(p2.auras.some((a) => a.kind === 'buff_dodge')).toBe(true);
    expect(p2.dodgeChance).toBeCloseTo(bearDodge + 0.5, 10);
  });
});

describe('Druid parity: Dire Bruin threat/armor buff', () => {
  it('grants +20% threat and +15% armor', () => {
    const druid = TALENTS.druid!;
    const choice = druid.nodes.find((n: any) => n.id === 'feral_choice');
    const bruin = choice?.choices?.find((c: any) => c.id === 'feral_choice_bear');
    expect(bruin?.effect.global?.threatPct).toBe(0.2);
    expect(bruin?.effect.stats?.armorPct).toBe(0.15);
  });
});
