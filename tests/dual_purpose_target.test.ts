// A dual-purpose (targetType 'any') ability heals a friend or strikes a foe. It
// read the current target and nothing else, so the paladin's instant heal
// (Solar Invocation) ignored a party-frame mouseover and refused an empty
// selection with "You have no target." where every friendly heal self-casts
// (src/sim/combat/dual_purpose_target.ts). These pin the press-time resolution
// order and, through live casts, that the instant finish lands on the unit the
// press resolved rather than re-reading the raw override.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isDualPurposeHeal, resolveDualPurposeTarget } from '../src/sim/combat/dual_purpose_target';
import { ABILITIES, BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent, WorldContent } from '../src/sim/types';
import { placePlayerInOpenField } from './helpers/open_field';

const TEST_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function healer(playerClass: PlayerClass, spec: string, level = 20): { sim: Sim; p: Entity } {
  const sim = new Sim({ seed: 717, playerClass, autoEquip: true, world: TEST_WORLD });
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  placePlayerInOpenField(sim);
  const p = sim.player as Entity;
  p.resource = p.maxResource;
  return { sim, p };
}

// A party member at half health, `dx` yards east of the healer.
function hurtAlly(sim: Sim, leader: Entity, name: string, dx: number): Entity {
  const pid = sim.addPlayer('warrior', name);
  sim.partyInvite(pid, leader.id);
  sim.partyAccept(pid);
  placePlayerInOpenField(sim, pid, { x: dx });
  const ally = sim.entities.get(pid) as Entity;
  ally.hp = Math.floor(ally.maxHp / 2);
  return ally;
}

function wolf(sim: Sim, p: Entity, dz: number, attacking: boolean): Entity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  });
  mob.maxHp = 5000;
  mob.hp = 5000;
  mob.hostile = true;
  mob.aiState = attacking ? 'chase' : 'idle';
  if (attacking) mob.aggroTargetId = p.id;
  sim.addEntity(mob);
  return mob;
}

function errorsOf(events: SimEvent[]): string[] {
  return events.flatMap((e) => (e.type === 'error' ? [e.text] : []));
}

const noAttacker = () => null;

describe('isDualPurposeHeal', () => {
  it('names the dual-purpose abilities that can heal', () => {
    for (const id of ['solar_invocation', 'scouring_mercy', 'holy_shock']) {
      expect(isDualPurposeHeal(ABILITIES[id]), id).toBe(true);
    }
  });

  it('covers exactly the shipped dual-purpose heals', () => {
    // Derived from the live table, so a new 'any' heal has to be looked at here.
    const heals = Object.values(ABILITIES)
      .filter((def) => isDualPurposeHeal(def))
      .map((def) => def.id)
      .sort();
    expect(heals).toEqual(['holy_shock', 'scouring_mercy', 'solar_invocation']);
  });

  it('keeps the client-shared module free of runtime imports', () => {
    // The mouseover core and the pad auto-target import this file into the client
    // bundle; a runtime import here would drag casting code along with it.
    const source = readFileSync(
      new URL('../src/sim/combat/dual_purpose_target.ts', import.meta.url),
      'utf8',
    );
    const imports = source.split('\n').filter((line) => line.startsWith('import '));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line, line).toMatch(/^import type /);
  });

  it('leaves out the dual-purpose abilities that never heal, and every other target type', () => {
    for (const id of ['shadowstep', 'spellsteal', 'voidfeast']) {
      expect(ABILITIES[id].targetType, id).toBe('any');
      expect(isDualPurposeHeal(ABILITIES[id]), id).toBe(false);
    }
    // A friendly heal is not dual-purpose; its own resolver already self-casts.
    expect(isDualPurposeHeal(ABILITIES.healing_wave)).toBe(false);
    expect(isDualPurposeHeal(ABILITIES.fireball)).toBe(false);
  });
});

describe('resolveDualPurposeTarget', () => {
  it('lets a live friendly mouseover override win over a hostile current target', () => {
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const enemy = wolf(sim, p, 6, false);
    sim.targetEntity(enemy.id);
    const def = ABILITIES.solar_invocation;
    expect(resolveDualPurposeTarget(sim.ctx, p, ally.id, def, noAttacker)).toBe(ally);
  });

  it('ignores a dead, hostile, or unknown override and reads the current target', () => {
    const { sim, p } = healer('paladin', 'holy');
    const selected = hurtAlly(sim, p, 'Selected', 5);
    const dead = hurtAlly(sim, p, 'Dead', 6);
    dead.dead = true;
    const enemy = wolf(sim, p, 6, false);
    sim.targetEntity(selected.id);
    const def = ABILITIES.solar_invocation;
    for (const override of [dead.id, enemy.id, 999_999]) {
      expect(resolveDualPurposeTarget(sim.ctx, p, override, def, noAttacker), `${override}`).toBe(
        selected,
      );
    }
  });

  it('keeps a stale selection for the caller to refuse rather than swapping it', () => {
    const { sim, p } = healer('paladin', 'holy');
    const enemy = wolf(sim, p, 6, false);
    sim.targetEntity(enemy.id);
    sim.ctx.entities.delete(enemy.id);
    let acquired = false;
    const acquire = () => {
      acquired = true;
      return null;
    };
    expect(resolveDualPurposeTarget(sim.ctx, p, null, ABILITIES.solar_invocation, acquire)).toBe(
      null,
    );
    expect(acquired, 'auto-acquire only runs with nothing selected').toBe(false);
  });

  it('with nothing selected, takes the attacker first and only then self-casts a heal', () => {
    const { sim, p } = healer('paladin', 'holy');
    const attacker = wolf(sim, p, 8, true);
    const def = ABILITIES.solar_invocation;
    expect(resolveDualPurposeTarget(sim.ctx, p, null, def, () => attacker)).toBe(attacker);
    expect(resolveDualPurposeTarget(sim.ctx, p, null, def, noAttacker)).toBe(p);
    // A dual-purpose ability that cannot heal has no sensible self fallback.
    expect(resolveDualPurposeTarget(sim.ctx, p, null, ABILITIES.shadowstep, noAttacker)).toBe(null);
  });

  it('lets a hovered ally win over a mob that is hitting you', () => {
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const attacker = wolf(sim, p, 8, true);
    const def = ABILITIES.solar_invocation;
    expect(resolveDualPurposeTarget(sim.ctx, p, ally.id, def, () => attacker)).toBe(ally);
  });

  it('turns a stale hover into a self heal, never a strike on the attacker', () => {
    const { sim, p } = healer('paladin', 'holy');
    const died = hurtAlly(sim, p, 'Died', 5);
    died.dead = true;
    const attacker = wolf(sim, p, 8, true);
    let acquired = false;
    const acquire = () => {
      acquired = true;
      return attacker;
    };
    expect(resolveDualPurposeTarget(sim.ctx, p, died.id, ABILITIES.solar_invocation, acquire)).toBe(
      p,
    );
    expect(acquired, 'a hover press is a heal press').toBe(false);
  });

  it('keeps a dead ally selection for the caller to refuse', () => {
    const { sim, p } = healer('paladin', 'holy');
    const dead = hurtAlly(sim, p, 'Dead', 5);
    dead.dead = true;
    sim.targetEntity(dead.id);
    expect(resolveDualPurposeTarget(sim.ctx, p, null, ABILITIES.solar_invocation, noAttacker)).toBe(
      dead,
    );
  });

  it('gives a dual-purpose ability that cannot heal no override at all', () => {
    // The client never sends one for these, and the sim does not honor one: the
    // selection and the attacker auto-acquire decide, exactly as before.
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const enemy = wolf(sim, p, 6, false);
    const attacker = wolf(sim, p, 8, true);
    const shadeslip = ABILITIES.shadowstep;
    expect(resolveDualPurposeTarget(sim.ctx, p, ally.id, shadeslip, () => attacker)).toBe(attacker);
    sim.targetEntity(enemy.id);
    expect(resolveDualPurposeTarget(sim.ctx, p, ally.id, shadeslip, noAttacker)).toBe(enemy);
  });
});

describe('Solar Invocation live casts', () => {
  it('heals the hovered party member with nothing selected', () => {
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const before = ally.hp;
    sim.targetEntity(null);

    sim.castAbilityOn('solar_invocation', ally.id);
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(ally.hp).toBeGreaterThan(before);
    // A mouseover heal must not grab a target of its own.
    expect(p.targetId).toBeNull();
  });

  it('heals the hovered member even while a mob is hitting the paladin', () => {
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const attacker = wolf(sim, p, 8, true);
    const before = ally.hp;
    sim.targetEntity(null);

    sim.castAbilityOn('solar_invocation', ally.id);
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(ally.hp).toBeGreaterThan(before);
    expect(attacker.hp).toBe(attacker.maxHp);
    expect(p.targetId).toBeNull();
  });

  it('self-heals rather than striking the attacker when the hovered member has died', () => {
    const { sim, p } = healer('paladin', 'holy');
    const died = hurtAlly(sim, p, 'Died', 5);
    died.dead = true;
    died.hp = 0;
    const attacker = wolf(sim, p, 8, true);
    p.hp = Math.floor(p.maxHp / 2);
    const before = p.hp;
    sim.targetEntity(null);

    sim.castAbilityOn('solar_invocation', died.id);
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(p.hp).toBeGreaterThan(before);
    expect(attacker.hp).toBe(attacker.maxHp);
    expect(p.targetId).toBeNull();
  });

  it('heals the hovered member instead of striking the selected enemy', () => {
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const enemy = wolf(sim, p, 6, false);
    sim.targetEntity(enemy.id);
    const before = ally.hp;

    sim.castAbilityOn('solar_invocation', ally.id);
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(ally.hp).toBeGreaterThan(before);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('falls back to the selected ally when the hovered member has died, without a finish refusal', () => {
    const { sim, p } = healer('paladin', 'holy');
    const selected = hurtAlly(sim, p, 'Selected', 5);
    const hovered = hurtAlly(sim, p, 'Hovered', 6);
    hovered.dead = true;
    hovered.hp = 0;
    sim.targetEntity(selected.id);
    const before = selected.hp;

    sim.castAbilityOn('solar_invocation', hovered.id);
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(selected.hp).toBeGreaterThan(before);
  });

  it('heals the paladin with nothing selected and nothing attacking', () => {
    const { sim, p } = healer('paladin', 'holy');
    p.hp = Math.floor(p.maxHp / 2);
    const before = p.hp;
    sim.targetEntity(null);

    sim.castAbility('solar_invocation');
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(p.hp).toBeGreaterThan(before);
  });

  it('still takes the attacker first with nothing selected (issue #2787 order)', () => {
    const { sim, p } = healer('paladin', 'holy');
    const attacker = wolf(sim, p, 8, true);
    sim.targetEntity(null);

    sim.castAbility('solar_invocation');
    expect(p.targetId).toBe(attacker.id);
    expect(attacker.hp).toBeLessThan(attacker.maxHp);
  });
});

describe('the instant finish lands on the unit the press resolved', () => {
  it('strikes the selected enemy even when a stray override rides the press', () => {
    // The press validated the selection; the finish used to re-read the raw
    // override and refuse ("You have no target.") on a friendly id.
    const { sim, p } = healer('paladin', 'holy');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const enemy = wolf(sim, p, 6, false);
    p.facing = Math.atan2(enemy.pos.x - p.pos.x, enemy.pos.z - p.pos.z);
    sim.targetEntity(enemy.id);

    sim.castAbilityOn('hammer_of_grace', ally.id);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 40; tick++) events.push(...sim.tick());
    expect(errorsOf(events)).toEqual([]);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });
});

describe('Scouring Mercy rides the same rule', () => {
  it('heals the hovered party member with nothing selected', () => {
    const { sim, p } = healer('priest', 'discipline');
    const ally = hurtAlly(sim, p, 'Tank', 5);
    const before = ally.hp;
    sim.targetEntity(null);

    sim.castAbilityOn('scouring_mercy', ally.id);
    expect(errorsOf(sim.tick())).toEqual([]);
    expect(ally.hp).toBeGreaterThan(before);
  });
});
