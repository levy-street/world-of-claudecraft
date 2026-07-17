import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { onSpellCrit, onSpellHit } from '../src/sim/combat/talent_procs';
import { TALENTS, validateTalentTree } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { localizeTalentTitle } from '../src/ui/talent_i18n';

const DIRECT_FIRE_ABILITIES = ['fireball', 'fire_blast', 'scorch', 'pyroblast'] as const;

function mageSim(spec: 'arcane' | 'fire' | 'frost' = 'fire', seed = 177_201): Sim {
  const sim = new Sim({ seed, playerClass: 'mage', autoEquip: false });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec, rows: {} })).toBe(true);
  sim.player.resource = sim.player.maxResource;
  sim.player.critChance = 0;
  return sim;
}

function targetFor(sim: Sim, id = 97_501): Entity {
  const target = createMob(id, MOBS.forest_wolf, 20, {
    x: sim.player.pos.x,
    y: sim.player.pos.y,
    z: sim.player.pos.z + 8,
  });
  target.hostile = true;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  sim.entities.set(target.id, target);
  sim.rebucket(target);
  return target;
}

function realTargetFor(sim: Sim): Entity {
  const target = [...sim.entities.values()].find(
    (entity) => entity.kind === 'mob' && entity.hostile && !entity.dead,
  );
  if (!target) throw new Error('missing world target');
  target.level = 1;
  target.maxHp = 100_000;
  target.hp = target.maxHp;
  const player = sim.player;
  player.pos.x = target.pos.x;
  player.pos.z = target.pos.z - 8;
  player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
  player.prevPos = { ...player.pos };
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.onGround = true;
  player.fallStartY = player.pos.y;
  player.facing = Math.atan2(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
  sim.targetEntity(target.id);
  return target;
}

function arenaTargets(format: 'fiesta' | 'yumi3'): {
  sim: Sim;
  source: Entity;
  target: Entity;
} {
  const sim = new Sim({
    seed: format === 'fiesta' ? 177_204 : 177_205,
    playerClass: 'mage',
    noPlayer: true,
  });
  const classes: Array<'mage' | 'warrior' | 'rogue' | 'priest' | 'hunter' | 'druid'> =
    format === 'fiesta'
      ? ['mage', 'warrior', 'rogue', 'hunter']
      : ['mage', 'warrior', 'rogue', 'priest', 'hunter', 'druid'];
  const pids = classes.map((cls, index) => sim.addPlayer(cls, `${format}-${index}`));
  for (const [index, pid] of pids.entries()) {
    const player = sim.entities.get(pid);
    if (!player) throw new Error('missing arena player');
    player.pos.x = index * 4;
    player.pos.z = -40;
    player.pos.y = terrainHeight(player.pos.x, player.pos.z, sim.cfg.seed);
    player.prevPos = { ...player.pos };
    sim.rebucket(player);
  }
  const magePid = pids[0];
  sim.setPlayerLevel(20, magePid);
  expect(sim.applyTalents({ spec: 'fire', rows: {} }, magePid)).toBe(true);
  const mageMeta = sim.meta(magePid);
  if (!mageMeta) throw new Error('missing Mage metadata');
  const fireMods = mageMeta.talentMods;
  const fireKnown = mageMeta.known;
  for (const pid of pids) sim.arenaQueueJoin(pid, format);
  sim.tick();
  for (let guard = 0; guard < 20 * 10; guard++) {
    const match = sim.arenaMatchFor(magePid);
    if (match?.state === 'active') {
      // Fiesta standardizes every fighter to a default level-20 build when the
      // match forms and live talent changes are correctly locked. Restore only
      // this fixture's pre-match Fire overlay so the branch exercises Afterflame.
      if (format === 'fiesta') {
        mageMeta.fiestaMods = fireMods;
        mageMeta.known = fireKnown;
      }
      const opposingTeam = match.teamA.includes(magePid) ? match.teamB : match.teamA;
      const source = sim.entities.get(magePid);
      const target = sim.entities.get(opposingTeam[0]);
      if (!source || !target) throw new Error('missing arena combatants');
      return { sim, source, target };
    }
    sim.tick();
  }
  throw new Error(`${format} never became active`);
}

function dealDirectFire(
  sim: Sim,
  target: Entity,
  abilityId: (typeof DIRECT_FIRE_ABILITIES)[number],
  amount: number,
  crit: boolean,
): void {
  const ability = sim.resolvedAbility(abilityId)?.def;
  if (!ability) throw new Error(`missing ${abilityId}`);
  sim.ctx.dealDamage(
    sim.player,
    target,
    amount,
    crit,
    'fire',
    ability.name,
    'hit',
    false,
    undefined,
    true,
    false,
    true,
    abilityId,
  );
}

function tickUntil(
  sim: Sim,
  predicate: (events: ReturnType<Sim['tick']>) => boolean,
  message: string,
): ReturnType<Sim['tick']> {
  if (predicate([])) return [];
  for (let ticks = 0; ticks < 400; ticks++) {
    const events = sim.tick();
    if (predicate(events)) return events;
  }
  throw new Error(message);
}

function scheduledDamage(aura: Entity['auras'][number]): number {
  const interval = aura.tickInterval ?? 1;
  const untilNextTick = aura.tickTimer ?? interval;
  const ticksLeft =
    untilNextTick <= aura.remaining
      ? 1 + Math.max(0, Math.floor((aura.remaining - untilNextTick) / interval))
      : 0;
  return Math.round(aura.value * ticksLeft);
}

describe('Pyromancy Afterflame', () => {
  it('authors a valid direct-critical burn and Cinderfall detonation loop', () => {
    const fire = TALENTS.mage.specs.find((spec) => spec.id === 'fire');

    expect(validateTalentTree(TALENTS.mage)).toEqual([]);
    expect(fire?.signature).toBe('combustion');
    expect(fire?.mastery.name).toBe('Afterflame');
    expect(fire?.mastery.description).toContain('store 20% of the damage dealt');
    expect(fire?.mastery.description).toContain('rolling Afterflame over 6 sec');
    expect(fire?.mastery.description).toContain('Cinderfall detonates the remaining Afterflame');
    expect(fire?.mastery.effect).toEqual({
      global: { critDmgSpellPct: 0.5 },
      stats: { crit: 0.02 },
      procs: [
        {
          id: 'mag_afterflame',
          name: 'Afterflame',
          spec: 'fire',
          requiresKnownAbility: 'combustion',
          school: 'fire',
          trigger: { on: 'spellCrit', abilities: [...DIRECT_FIRE_ABILITIES] },
          responses: [{ kind: 'rollingDot', pctDamage: 0.2, duration: 6, interval: 2 }],
        },
        {
          id: 'mag_afterflame_detonate',
          name: 'Afterflame',
          spec: 'fire',
          requiresKnownAbility: 'combustion',
          school: 'fire',
          trigger: { on: 'spellHit', abilities: ['fire_blast'] },
          responses: [{ kind: 'detonateOwnedDot', auraId: 'mag_afterflame' }],
        },
      ],
    });
    expect(mageSim().player.resourceType).toBe('mana');
  });

  it('rolls every explicit direct Fire critical into one visible target-side burn', () => {
    const sim = mageSim();
    const target = targetFor(sim);

    for (const abilityId of DIRECT_FIRE_ABILITIES) {
      onSpellCrit(sim.ctx, sim.player, abilityId, target, 90);
      expect(target.auras.find((aura) => aura.id === 'mag_afterflame')).toMatchObject({
        name: 'Afterflame',
        kind: 'dot',
        remaining: 6,
        duration: 6,
        value: 6,
        tickInterval: 2,
        tickTimer: 2,
        sourceId: sim.player.id,
        school: 'fire',
      });
      target.auras = target.auras.filter((aura) => aura.id !== 'mag_afterflame');
    }

    onSpellCrit(sim.ctx, sim.player, 'frostbolt', target, 90);
    expect(target.auras.some((aura) => aura.id === 'mag_afterflame')).toBe(false);
  });

  it('banks fresh critical damage with the remaining burn instead of adding a second aura', () => {
    const sim = mageSim();
    const target = targetFor(sim);

    onSpellCrit(sim.ctx, sim.player, 'fireball', target, 90);
    onSpellCrit(sim.ctx, sim.player, 'pyroblast', target, 90);

    expect(target.auras.filter((aura) => aura.id === 'mag_afterflame')).toHaveLength(1);
    expect(target.auras.find((aura) => aura.id === 'mag_afterflame')).toMatchObject({
      value: 12,
      remaining: 6,
      duration: 6,
    });
  });

  it('detonates the old pool before a critical Cinderfall starts a fresh one', () => {
    const sim = mageSim();
    const target = targetFor(sim);
    dealDirectFire(sim, target, 'fireball', 90, true);
    expect(target.auras.find((aura) => aura.id === 'mag_afterflame')?.value).toBe(6);
    const before = target.hp;

    dealDirectFire(sim, target, 'fire_blast', 15, true);

    expect(before - target.hp).toBe(33);
    expect(target.auras.filter((aura) => aura.id === 'mag_afterflame')).toHaveLength(1);
    expect(target.auras.find((aura) => aura.id === 'mag_afterflame')).toMatchObject({
      value: 1,
      remaining: 6,
      duration: 6,
    });
  });

  it('processes one death when a landed Cinderfall survives but its detonation is lethal', () => {
    const sim = mageSim();
    const target = targetFor(sim);
    onSpellCrit(sim.ctx, sim.player, 'fireball', target, 90);
    target.hp = 20;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing Mage metadata');
    const killsBefore = meta.counters.kills;
    sim.events = [];

    dealDirectFire(sim, target, 'fire_blast', 5, false);

    expect(target.dead).toBe(true);
    expect(
      sim.events.filter((event) => event.type === 'death' && event.entityId === target.id),
    ).toHaveLength(1);
    expect(meta.counters.kills).toBe(killsBefore + 1);
  });

  it('processes one nonlethal down when recursive detonation bottoms out Fiesta or Yumi', () => {
    for (const format of ['fiesta', 'yumi3'] as const) {
      const { sim, source, target } = arenaTargets(format);
      onSpellCrit(sim.ctx, source, 'fireball', target, 90);
      expect(
        target.auras.find((aura) => aura.id === 'mag_afterflame'),
        `${format} should bank Afterflame before Cinderfall`,
      ).toBeDefined();
      target.hp = 20;
      sim.drainEvents();

      sim.ctx.dealDamage(
        source,
        target,
        5,
        false,
        'fire',
        'Cinderfall',
        'hit',
        false,
        undefined,
        true,
        false,
        true,
        'fire_blast',
      );

      const events = sim.drainEvents();
      const match = sim.arenaMatchFor(source.id);
      if (!match) throw new Error('missing active arena match');
      const downEvent = format === 'fiesta' ? 'fiestaDown' : 'yumiDown';
      expect(
        events.filter((event) => event.type === downEvent),
        `${format} events: ${JSON.stringify(events)}`,
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.type === 'death' && event.entityId === target.id),
      ).toHaveLength(1);
      expect(target.dead).toBe(true);
      expect(sim.ctx.arenaIsDown(match, target.id)).toBe(true);
      expect(
        format === 'fiesta'
          ? match.fiesta?.deaths.get(target.id)
          : match.yumi?.deaths.get(target.id),
      ).toBe(1);
      expect(
        format === 'fiesta' ? match.fiesta?.kills.get(source.id) : match.yumi?.kills.get(source.id),
      ).toBe(1);
    }
  });

  it('keeps stored Afterflame damage identical between elapsed ticks and detonation', () => {
    const run = (mode: 'ticks' | 'detonate'): number => {
      const sim = mageSim();
      const target = targetFor(sim, mode === 'ticks' ? 97_518 : 97_519);
      onSpellCrit(sim.ctx, sim.player, 'fireball', target, 90);
      sim.ctx.applyAura(sim.player, {
        id: 'test_live_damage_buff',
        name: 'Test Live Damage Buff',
        kind: 'buff_dmg_done',
        remaining: 30,
        duration: 30,
        value: 0.5,
        sourceId: sim.player.id,
        school: 'fire',
      });
      sim.ctx.applyAura(target, {
        id: 'test_live_target_vulnerability',
        name: 'Test Live Target Vulnerability',
        kind: 'spellvuln',
        remaining: 30,
        duration: 30,
        value: 0.5,
        sourceId: target.id,
        school: 'arcane',
      });
      const before = target.hp;
      if (mode === 'detonate') {
        onSpellHit(sim.ctx, sim.player, 'fire_blast', target, 1);
      } else {
        for (let guard = 0; target.auras.some((aura) => aura.id === 'mag_afterflame'); guard++) {
          if (guard >= 200) throw new Error('Afterflame did not expire');
          updateAuras(sim.ctx, target);
        }
      }
      return before - target.hp;
    };

    expect(run('ticks')).toBe(18);
    expect(run('detonate')).toBe(18);
  });

  it('plays the real crit, tick, rekindle, and Cinderfall detonation rotation', () => {
    const sim = mageSim('fire', 177_203);
    const target = realTargetFor(sim);
    sim.ctx.applyAura(sim.player, {
      id: 'test_guaranteed_spell_crit',
      name: 'Test Guaranteed Spell Crit',
      kind: 'buff_spellcrit',
      remaining: 30,
      duration: 30,
      value: 1,
      sourceId: sim.player.id,
      school: 'fire',
    });

    sim.castAbility('fireball');
    tickUntil(
      sim,
      () => target.auras.some((aura) => aura.id === 'mag_afterflame'),
      'real Cinderbolt never created Afterflame',
    );
    const first = target.auras.find((aura) => aura.id === 'mag_afterflame');
    if (!first) throw new Error('missing first Afterflame');
    target.auras = target.auras.filter((aura) => aura.id !== 'fireball');
    const firstTick = first.value;
    const beforeTick = target.hp;
    tickUntil(sim, () => target.hp < beforeTick, 'Afterflame never ticked');
    expect(beforeTick - target.hp).toBe(firstTick);

    sim.castAbility('fireball');
    tickUntil(
      sim,
      () => target.auras.some((aura) => aura.id === 'mag_afterflame' && aura.remaining > 5),
      'second Cinderbolt never rekindled Afterflame',
    );
    const rekindled = target.auras.find((aura) => aura.id === 'mag_afterflame');
    if (!rekindled) throw new Error('missing rekindled Afterflame');
    target.auras = target.auras.filter((aura) => aura.id !== 'fireball');
    expect(rekindled.tickTimer).toBeLessThan(2);
    const remainder = scheduledDamage(rekindled);
    sim.events = [];

    sim.castAbility('fire_blast');
    expect(sim.events.filter((event) => event.type === 'error')).toEqual([]);
    const detonationEvents = tickUntil(
      sim,
      (events) => events.some((event) => event.type === 'damage' && event.ability === 'Afterflame'),
      'Cinderfall never detonated Afterflame',
    );

    expect(
      detonationEvents.filter((event) => event.type === 'damage' && event.ability === 'Afterflame'),
    ).toEqual([expect.objectContaining({ amount: remainder })]);
    expect(target.auras.filter((aura) => aura.id === 'mag_afterflame')).toHaveLength(1);
  });

  it('requires actual post-absorb damage before either Afterflame response fires', () => {
    const sim = mageSim();
    const target = targetFor(sim);
    sim.ctx.applyAura(target, {
      id: 'test_absorb',
      name: 'Test Absorb',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 1_000,
      sourceId: target.id,
      school: 'arcane',
    });

    dealDirectFire(sim, target, 'fireball', 90, true);
    onSpellCrit(sim.ctx, sim.player, 'fireball', target, 0);
    onSpellHit(sim.ctx, sim.player, 'fire_blast', target, 0);

    expect(target.hp).toBe(target.maxHp);
    expect(target.auras.some((aura) => aura.id === 'mag_afterflame')).toBe(false);
  });

  it('gates the loop by Pyromancy and the known Flashfire signature', () => {
    const withoutSignature = mageSim();
    const meta = withoutSignature.meta(withoutSignature.playerId);
    if (!meta) throw new Error('missing Mage metadata');
    meta.known = meta.known.filter((ability) => ability.def.id !== 'combustion');

    for (const sim of [mageSim('arcane'), mageSim('frost'), withoutSignature]) {
      const target = targetFor(sim, 97_510 + sim.player.id);
      onSpellCrit(sim.ctx, sim.player, 'fireball', target, 90);
      onSpellHit(sim.ctx, sim.player, 'fire_blast', target, 15);

      expect(target.auras.some((aura) => aura.id === 'mag_afterflame')).toBe(false);
    }
  });

  it('removes caster-owned Afterflame when Pyromancy is left out of combat', () => {
    const sim = mageSim();
    const target = targetFor(sim);
    onSpellCrit(sim.ctx, sim.player, 'fireball', target, 90);
    expect(target.auras.some((aura) => aura.id === 'mag_afterflame')).toBe(true);

    expect(sim.applyTalents({ spec: 'arcane', rows: {} })).toBe(true);

    expect(target.auras.some((aura) => aura.id === 'mag_afterflame')).toBe(false);
  });

  it('adds no proc draws and replays the rolling pool exactly', () => {
    const run = () => {
      const sim = mageSim('fire', 177_202);
      const target = targetFor(sim);
      const draws: number[] = [];
      sim.ctx.rng.setObserver((value) => draws.push(value));
      onSpellCrit(sim.ctx, sim.player, 'fireball', target, 90);
      onSpellCrit(sim.ctx, sim.player, 'pyroblast', target, 90);
      onSpellHit(sim.ctx, sim.player, 'fire_blast', target, 15);
      sim.ctx.rng.setObserver(null);
      return {
        draws,
        pool: target.auras.find((aura) => aura.id === 'mag_afterflame')?.value ?? 0,
      };
    };

    expect(run()).toEqual({ draws: [], pool: 0 });
    expect(run()).toEqual(run());
  });

  it('localizes Afterflame in every non-Latin release locale', () => {
    for (const language of ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const) {
      expect(localizeTalentTitle('Afterflame', language)).not.toBe('Afterflame');
    }
  });
});
