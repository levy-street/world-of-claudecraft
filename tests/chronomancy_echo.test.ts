// Chronomancy Phase 2 (docs/prd/mage-chronomancy.md section 13): Temporal Echo.
// The healer marks ONE ally; while the mark rides, a fraction of the mage's
// EFFECTIVE Arcane damage heals that ally (35% single-target, 15% area). The mark
// also does a small initial heal, is per-caster (sourceId), moves on re-cast, and
// is cleared on death and on leaving the spec. The conversion draws no rng, never
// rolls its own crit, and never recurses. Temporal Mend and Temporal Barrier keep
// working with no enemy present.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

// dealDamage's full signature including the Phase 2 `aoe` flag (last arg). This
// port's signature carries `abilityId` (the stable content id for talent-proc
// filters) between `alreadyFinal` and `aoe`.
type DealDamage = (
  source: Entity | null,
  target: Entity,
  amount: number,
  crit: boolean,
  school: string,
  ability: string | null,
  kind: 'hit' | 'miss' | 'dodge',
  noRage?: boolean,
  threatOpts?: { flat?: number; mult?: number },
  direct?: boolean,
  attackAnimationStarted?: boolean,
  alreadyFinal?: boolean,
  abilityId?: string | null,
  aoe?: boolean,
) => void;

function deal(sim: Sim, ...args: Parameters<DealDamage>): void {
  (sim as unknown as { dealDamage: DealDamage }).dealDamage(...args);
}
function drain(sim: Sim): SimEvent[] {
  return (sim as unknown as { drainEvents(): SimEvent[] }).drainEvents();
}

function chronoMage(level = 20) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

/** Add a friendly warrior ally near the mage, and return its entity. */
function addAlly(sim: Sim, name: string, dist = 5): Entity {
  const p = sim.player;
  const pid = sim.addPlayer('warrior', name);
  sim.setPlayerLevel(20, pid); // a real level-20 pool, so exact heals never clamp
  const ent = sim.entities.get(pid);
  if (!ent) throw new Error('ally missing');
  ent.pos.x = p.pos.x + dist;
  ent.pos.z = p.pos.z;
  return ent;
}

function addHostile(sim: Sim, dist = 6, hp = 100000): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = hp;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

/** Cast Temporal Echo from `caster` (default player) onto `ally`, settle one tick. */
function markEcho(sim: Sim, ally: Entity, casterPid?: number) {
  sim.targetEntity(ally.id, casterPid);
  sim.castAbility('temporal_echo', casterPid);
  sim.tick();
}

function echoMark(ally: Entity, mageId: number) {
  return ally.auras.find((a) => a.kind === 'temporal_echo' && a.sourceId === mageId);
}

describe('Temporal Echo: the mark', () => {
  it('is granted only to Chronomancy and appears on the healer book', () => {
    const { sim } = chronoMage();
    expect(sim.resolvedAbility('temporal_echo')).not.toBeNull();
    expect(sim.setSpec('fire')).toBe(true);
    expect(sim.resolvedAbility('temporal_echo')).toBeNull();
    expect(sim.setSpec('frost')).toBe(true);
    expect(sim.resolvedAbility('temporal_echo')).toBeNull();
  });

  it('applies a small initial heal and a per-caster mark, instant on the GCD', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Marcado');
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    const mana0 = p.resource;
    markEcho(sim, ally);
    expect(p.castingAbility).toBeNull(); // instant, no cast bar
    expect((p as unknown as { gcdRemaining: number }).gcdRemaining).toBeGreaterThan(0); // on GCD
    expect(ally.hp).toBeGreaterThan(hp0); // the initial heal landed
    expect(p.resource).toBeLessThan(mana0); // billed
    const mark = echoMark(ally, p.id);
    expect(mark).toBeDefined();
    expect(mark?.school).toBe('arcane');
    expect(mark?.remaining).toBeGreaterThan(0);
  });

  it('can be applied to the mage themself', () => {
    const { sim, p } = chronoMage();
    p.hp = Math.floor(p.maxHp * 0.5);
    sim.castAbility('temporal_echo'); // no friendly target -> self
    sim.tick();
    expect(echoMark(p, p.id)).toBeDefined();
  });

  it('re-casting on the SAME ally refreshes (never stacks a second mark)', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Refresco');
    markEcho(sim, ally);
    // Let some of the window elapse, then refresh.
    for (let i = 0; i < 100; i++) sim.tick(); // 5s
    const midway = echoMark(ally, p.id)?.remaining ?? 0;
    expect(midway).toBeLessThan(15);
    p.resource = p.maxResource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    markEcho(sim, ally);
    const marks = ally.auras.filter((a) => a.kind === 'temporal_echo' && a.sourceId === p.id);
    expect(marks.length).toBe(1); // never two
    expect(marks[0].remaining).toBeGreaterThan(midway); // refreshed to full
  });

  it('re-casting on a DIFFERENT ally MOVES the mark (one own mark at a time)', () => {
    const { sim, p } = chronoMage();
    const allyA = addAlly(sim, 'Primero', 5);
    const allyB = addAlly(sim, 'Segundo', 6);
    markEcho(sim, allyA);
    expect(echoMark(allyA, p.id)).toBeDefined();
    p.resource = p.maxResource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    markEcho(sim, allyB);
    expect(echoMark(allyA, p.id)).toBeUndefined(); // moved off A
    expect(echoMark(allyB, p.id)).toBeDefined(); // now on B
  });
});

describe('Temporal Echo: the Arcane-damage conversion', () => {
  it('heals the marked ally 35% of single-target Arcane damage', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Sanado');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    drain(sim);
    deal(sim, p, mob, 100, false, 'arcane', 'arcane_missiles', 'hit');
    expect(ally.hp - hp0).toBe(35); // round(100 * 0.35)
  });

  it('heals 15% of AREA Arcane damage (the reduced coefficient)', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'SanadoAoE');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    deal(
      sim,
      p,
      mob,
      100,
      false,
      'arcane',
      'arcane_explosion',
      'hit',
      false,
      undefined,
      true,
      false,
      false,
      'arcane_explosion',
      true,
    );
    expect(ally.hp - hp0).toBe(15); // round(100 * 0.15)
  });

  it('heals per Arcane impact (Arcane Missiles is many small heals)', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Goteo');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    for (let i = 0; i < 3; i++) {
      const before = ally.hp;
      deal(sim, p, mob, 20, false, 'arcane', 'arcane_missiles', 'hit');
      expect(ally.hp - before).toBe(7); // round(20 * 0.35) EACH hit
    }
  });

  it('a critical Arcane hit heals more (bigger damage) but rolls no second crit', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Critico');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    drain(sim);
    // crit=true carries an already-crit-inflated 100 (the caller resolved the
    // crit). The conversion uses it verbatim: 35, NOT 35*1.5.
    deal(sim, p, mob, 100, true, 'arcane', 'arcane_missiles', 'hit');
    expect(ally.hp - hp0).toBe(35);
    const heal = drain(sim).find(
      (e): e is Extract<SimEvent, { type: 'heal2' }> =>
        e.type === 'heal2' && e.targetId === ally.id && e.amount === 35,
    );
    expect(heal?.crit).toBe(false); // the conversion heal never crits
  });

  it('non-Arcane damage never triggers the echo', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Fisico');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    for (const school of ['physical', 'fire', 'frost', 'shadow']) {
      deal(sim, p, mob, 100, false, school, 'some_spell', 'hit');
    }
    expect(ally.hp).toBe(hp0); // untouched
  });

  it('absorbed (negated) enemy damage fabricates no healing', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Absorbido');
    const mob = addHostile(sim);
    // Shield the ENEMY so a 100 arcane hit is fully soaked (0 landed).
    mob.auras.push({
      id: 'test_shield',
      name: 'Shield',
      kind: 'absorb',
      remaining: 30,
      duration: 30,
      value: 500,
      sourceId: mob.id,
      school: 'arcane',
    });
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    deal(sim, p, mob, 100, false, 'arcane', 'arcane_missiles', 'hit');
    expect(ally.hp).toBe(hp0); // nothing landed -> no conversion
  });

  it('overkill beyond the enemy remaining health does not inflate the heal', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Remate');
    const mob = addHostile(sim, 6, 20); // only 20 hp
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    deal(sim, p, mob, 100, false, 'arcane', 'arcane_missiles', 'hit');
    // Only 20 damage actually landed (the rest is overkill): round(20 * 0.35) = 7.
    expect(ally.hp - hp0).toBe(7);
  });

  it('never heals a dead ally, and the conversion heal cannot re-trigger', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Muerto');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    ally.hp = Math.floor(ally.maxHp * 0.5);
    ally.dead = true; // dead but the mark still on it
    const hp0 = ally.hp;
    drain(sim);
    deal(sim, p, mob, 100, false, 'arcane', 'arcane_missiles', 'hit');
    expect(ally.hp).toBe(hp0); // dead guard: no heal
    // Exactly one damage event, zero conversion heals -> no recursion path.
    const evs = drain(sim);
    const heals = evs.filter((e) => e.type === 'heal2' && e.targetId === ally.id);
    expect(heals.length).toBe(0);
  });
});

describe('Temporal Echo: multiple chronomancers stay independent', () => {
  it('two mages keep separate marks on one ally; each heals via only its own', () => {
    const { sim, p } = chronoMage();
    const mage2Pid = sim.addPlayer('mage', 'Cronomante2');
    sim.setPlayerLevel(20, mage2Pid);
    expect(sim.setSpec('arcane', mage2Pid)).toBe(true);
    const mage2 = sim.entities.get(mage2Pid);
    if (!mage2) throw new Error('mage2 missing');
    mage2.pos.x = p.pos.x + 2;
    mage2.pos.z = p.pos.z;
    mage2.resource = mage2.maxResource;
    sim.tick();
    const ally = addAlly(sim, 'Compartido', 4);
    const mob = addHostile(sim);
    // Both mages mark the same ally.
    markEcho(sim, ally);
    markEcho(sim, ally, mage2Pid);
    const marks = ally.auras.filter((a) => a.kind === 'temporal_echo');
    expect(marks.length).toBe(2); // two independent marks
    expect(echoMark(ally, p.id)).toBeDefined();
    expect(echoMark(ally, mage2Pid)).toBeDefined();
    // Mage 1's arcane damage heals once (via mage1's mark), and mage2's mark is
    // untouched (still present).
    ally.hp = Math.floor(ally.maxHp * 0.5);
    const hp0 = ally.hp;
    deal(sim, p, mob, 100, false, 'arcane', 'arcane_missiles', 'hit');
    expect(ally.hp - hp0).toBe(35); // one conversion, not two
    expect(ally.auras.filter((a) => a.kind === 'temporal_echo').length).toBe(2); // both remain
  });
});

describe('Temporal Echo: cleanup', () => {
  it('leaving Chronomancy clears the marks this mage placed', () => {
    const { sim, p } = chronoMage();
    const ally = addAlly(sim, 'Limpieza');
    markEcho(sim, ally);
    expect(echoMark(ally, p.id)).toBeDefined();
    expect(sim.setSpec('fire')).toBe(true);
    expect(echoMark(ally, p.id)).toBeUndefined(); // stripped on spec loss
  });

  it('the ally dying sheds the mark through the normal death path', () => {
    const { sim } = chronoMage();
    const ally = addAlly(sim, 'Caido');
    const mob = addHostile(sim);
    markEcho(sim, ally);
    // Kill the ally through the real death path.
    deal(sim, mob, ally, ally.hp + 500, false, 'physical', null, 'hit');
    expect(ally.dead).toBe(true);
    expect(ally.auras.some((a) => a.kind === 'temporal_echo')).toBe(false);
  });
});

describe('Temporal Echo: determinism and enemy-free healing', () => {
  it('the same marked Arcane sequence heals identically on replay', () => {
    const run = () => {
      const { sim, p } = chronoMage();
      const ally = addAlly(sim, 'Determinista');
      const mob = addHostile(sim);
      markEcho(sim, ally);
      ally.hp = Math.floor(ally.maxHp * 0.5);
      const start = ally.hp;
      for (let i = 0; i < 5; i++) deal(sim, p, mob, 37, false, 'arcane', 'arcane_missiles', 'hit');
      return ally.hp - start;
    };
    const a = run();
    const b = run();
    expect(a).toBe(b);
    expect(a).toBe(5 * Math.round(37 * 0.35)); // 5 * 13 = 65
  });

  it('Temporal Mend and Temporal Barrier still work with no enemy in the world', () => {
    const { sim, p } = chronoMage();
    // No hostile added at all.
    p.hp = Math.floor(p.maxHp * 0.5);
    const hp0 = p.hp;
    sim.castAbility('temporal_mend'); // self
    for (let i = 0; i < 50; i++) sim.tick(); // 2.5s cast window
    expect(p.hp).toBeGreaterThan(hp0); // healed with no enemy present
    p.resource = p.maxResource;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('temporal_barrier'); // self
    sim.tick();
    expect(p.auras.some((a) => a.id === 'temporal_barrier' && a.kind === 'absorb')).toBe(true);
  });
});
