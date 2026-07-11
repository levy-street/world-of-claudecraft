import { describe, expect, it } from 'vitest';
import { castAbility, updateCasting } from '../src/sim/combat/casting_lifecycle';
import { MOBS } from '../src/sim/data';
import { createMob, recalcPlayerStats } from '../src/sim/entity';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SetProc } from '../src/sim/types';

type ProcInternals = {
  players: Map<number, PlayerMeta>;
  applySetProcs(source: Entity, target: Entity | null, trigger: SetProc['trigger']): void;
  time: number;
};
type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const mournweaveEquipment = {
  chest: 'necromancers_starshroud',
  feet: 'necromancers_soulsteps',
  legs: 'necromancers_legwraps',
  shoulder: 'necromancers_soulspire_mantle',
};

function equipMournweave(sim: Sim): Entity {
  const internals = sim as unknown as ProcInternals;
  const p = sim.player;
  const meta = internals.players.get(p.id);
  if (!meta) throw new Error('missing player meta');
  p.level = 20;
  Object.assign(meta.equipment, mournweaveEquipment);
  recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
  return p;
}

// A full-pipeline caster in the 4-set, plus a beefy hostile target in range and
// faced, so a hostile cast passes every castAbility guard.
function makeCastingSim(cls: PlayerClass, seed: number): { sim: AnySim; p: AnyEntity; meta: any } {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: false }) as AnySim;
  sim.setPlayerLevel(20); // the real level-up path, so higher-learnLevel spells are known
  const p = equipMournweave(sim) as AnyEntity;
  const meta = sim.players.get(p.id);
  p.resource = p.maxResource;
  return { sim, p, meta };
}

function spawnTarget(sim: AnySim, p: AnyEntity): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 5, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 6,
  }) as AnyEntity;
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

const hasClearcasting = (p: Entity) => p.auras.some((a) => a.kind === 'next_cast_free');

// One full cast: reset the per-cast throttles, start, then drain the cast to
// completion (applyAbility runs inside updateCasting when the timer clears).
function castOnce(sim: AnySim, p: AnyEntity, meta: any, abilityId: string): void {
  p.resource = p.maxResource;
  p.gcdRemaining = 0;
  p.castingAbility = null;
  p.channeling = false;
  castAbility(sim.ctx, abilityId, p.id);
  let guard = 0;
  while (p.castingAbility && !p.channeling && guard++ < 400) updateCasting(sim.ctx, p, meta);
}

describe('Clearcasting set proc', () => {
  it('resolves from the 4-piece Mournweave caster set', () => {
    const sim = new Sim({ seed: 11, playerClass: 'mage', autoEquip: false });
    const p = equipMournweave(sim);

    expect(p.setProcs).toContainEqual({
      id: 'set_clearcasting',
      name: 'Clearcasting',
      trigger: 'spellCast',
      chance: 0.1,
      aura: 'next_cast_free',
      duration: 12,
      icd: 4,
    });
  });

  it('draws no rng and grants no aura when the player has no set procs', () => {
    const sim = new Sim({ seed: 12, playerClass: 'mage', autoEquip: false });
    const internals = sim as unknown as ProcInternals;
    const p = sim.player;
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });

    internals.applySetProcs(p, null, 'spellCast');
    sim.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(p.auras.some((a) => a.kind === 'next_cast_free')).toBe(false);
  });

  it('eventually grants Clearcasting and blocks another proc during the ICD', () => {
    const sim = new Sim({ seed: 13, playerClass: 'mage', autoEquip: false });
    const internals = sim as unknown as ProcInternals;
    const p = equipMournweave(sim);

    for (let i = 0; i < 500 && !p.auras.some((a) => a.kind === 'next_cast_free'); i++) {
      internals.applySetProcs(p, null, 'spellCast');
    }

    expect(p.auras.some((a) => a.id === 'set_clearcasting' && a.kind === 'next_cast_free')).toBe(
      true,
    );
    expect(p.procReadyAt.set_clearcasting).toBe(internals.time + 4);

    p.auras = p.auras.filter((a) => a.id !== 'set_clearcasting');
    let draws = 0;
    sim.rng.setObserver(() => {
      draws++;
    });

    internals.applySetProcs(p, null, 'spellCast');
    sim.rng.setObserver(null);

    expect(draws).toBe(0);
    expect(p.auras.some((a) => a.id === 'set_clearcasting')).toBe(false);
  });
});

// Regression for the dead-4pc bug: applySetProcs was wired into only two of the
// three applyAbility completion paths, so the projectile branch (every
// hostile-target non-physical spell) and channels never rolled. These drive the
// FULL cast pipeline (castAbility -> updateCasting -> applyAbility), so deleting
// a call site in casting_lifecycle.ts fails here, not just in the unit tests above.
describe('Clearcasting procs from real casts', () => {
  it('procs from a completed hostile cast-time spell (the projectile branch)', () => {
    const { sim, p, meta } = makeCastingSim('mage', 21);
    spawnTarget(sim, p);
    for (let i = 0; i < 300 && !hasClearcasting(p); i++) castOnce(sim, p, meta, 'fireball');
    expect(hasClearcasting(p)).toBe(true);
  });

  it('procs from starting a channel', () => {
    const { sim, p, meta } = makeCastingSim('mage', 22);
    spawnTarget(sim, p);
    for (let i = 0; i < 300 && !hasClearcasting(p); i++) castOnce(sim, p, meta, 'arcane_missiles');
    expect(hasClearcasting(p)).toBe(true);
  });

  it('procs from a friendly-target spell (a heal)', () => {
    const { sim, p, meta } = makeCastingSim('priest', 23);
    p.hp = 1; // keep the self-heal meaningful so the cast never no-ops
    for (let i = 0; i < 300 && !hasClearcasting(p); i++) {
      p.hp = 1;
      castOnce(sim, p, meta, 'lesser_heal');
    }
    expect(hasClearcasting(p)).toBe(true);
  });

  it('never procs from physical-school casts or toggle-offs (druid form flips)', () => {
    // Mournweave is cloth, so a druid can wear the full set; a form toggle is a
    // physical-school ability and its off-flip is a toggle-off: neither is a
    // spell, so 300 alternating flips (which would proc ~30 times ungated) stay dry.
    const { sim, p, meta } = makeCastingSim('druid', 24);
    for (let i = 0; i < 300 && !hasClearcasting(p); i++) castOnce(sim, p, meta, 'bear_form');
    expect(hasClearcasting(p)).toBe(false);
  });
});
