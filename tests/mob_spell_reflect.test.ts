// Innate "warded" mobs (Wyrmcult Necromancers) reflect flat damage onto any
// caster whose SPELL connects — the magic-school twin of melee thorns. The
// reflect lives in dealDamage, the single funnel every damage instance passes
// through, so driving dealDamage directly exercises the exact production path.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { MOBS } from '../src/sim/data';
import type { Entity } from '../src/sim/types';

function makeSim() {
  return new Sim({ seed: 42, playerClass: 'mage', autoEquip: true });
}

function spawnMob(sim: Sim, templateId: string, level: number): Entity {
  const tpl = MOBS[templateId];
  const id = (sim as any).nextId++;
  const mob = createMob(id, tpl, level, { x: 1, y: 0, z: 0 });
  mob.maxHp = 100000; // survive the scripted hits (death wipes state / suppresses the ward)
  mob.hp = mob.maxHp;
  sim.entities.set(id, mob);
  return mob;
}

// drive the production damage funnel exactly as a landed spell would
function spellHit(sim: Sim, caster: Entity, target: Entity, amount: number, school = 'fire') {
  (sim as any).dealDamage(caster, target, amount, false, school, 'Fireball', 'hit');
}

describe('mob spell reflect (Spectral Ward)', () => {
  it('reflects flat shadow damage onto a mage whose spell strikes the necromancer', () => {
    const sim = makeSim();
    const player = sim.player;
    player.maxHp = 100000;
    player.hp = player.maxHp;
    const necro = spawnMob(sim, 'wyrmcult_necromancer', 19);

    const ward = MOBS['wyrmcult_necromancer'].spellReflect!;
    const before = player.hp;
    spellHit(sim, player, necro, 50);

    // the caster eats exactly one ward reflect per connecting spell
    expect(before - player.hp).toBe(ward.value);
  });

  it('does not reflect a physical (melee) hit — that is the thorns domain', () => {
    const sim = makeSim();
    const player = sim.player;
    player.maxHp = 100000;
    player.hp = player.maxHp;
    const necro = spawnMob(sim, 'wyrmcult_necromancer', 19);

    const before = player.hp;
    spellHit(sim, player, necro, 50, 'physical');

    expect(player.hp).toBe(before);
  });

  it('a mob without the ward reflects nothing on a spell hit', () => {
    const sim = makeSim();
    const player = sim.player;
    player.maxHp = 100000;
    player.hp = player.maxHp;
    const plain = spawnMob(sim, 'boneclad_revenant', 19);
    expect(MOBS['boneclad_revenant'].spellReflect).toBeUndefined();

    const before = player.hp;
    spellHit(sim, player, plain, 50);

    expect(player.hp).toBe(before);
  });

  it('does not reflect when the killing blow drops the mob (no burst from a corpse)', () => {
    const sim = makeSim();
    const player = sim.player;
    player.maxHp = 100000;
    player.hp = player.maxHp;
    const necro = spawnMob(sim, 'wyrmcult_necromancer', 19);
    necro.hp = 5; // the incoming nuke is lethal

    const before = player.hp;
    spellHit(sim, player, necro, 50);

    expect(necro.hp).toBe(0);
    expect(player.hp).toBe(before);
  });

  it('the necromancer template carries a positive-value Spectral Ward', () => {
    const ward = MOBS['wyrmcult_necromancer'].spellReflect;
    expect(ward).toBeDefined();
    expect(ward!.value).toBeGreaterThan(0);
  });
});
