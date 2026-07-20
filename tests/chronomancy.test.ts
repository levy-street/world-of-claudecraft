// Chronomancy Phase 1 (docs/prd/mage-chronomancy.md): the mage's third spec
// becomes the temporal healer. Internal spec id stays 'arcane' (persistence);
// the presentation is Chronomancy / healer. Kit: Temporal Mend (the reliable
// 2s direct heal, the spec signature) + Temporal Barrier (the 12s-cooldown
// single-target shield). The DPS gating trims the healer's book, never the
// fire/frost books.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation, TALENTS } from '../src/sim/content/talents';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

function chronoMage(level = 20) {
  const sim = new Sim({ seed: 41, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec('arcane')).toBe(true);
  sim.tick();
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

function knownIds(spec: 'arcane' | 'fire' | 'frost' | null, level = 20): string[] {
  const mods = computeTalentModifiers('mage', { ...emptyAllocation(), spec } as never);
  return abilitiesKnownAt('mage', level, mods).map((k) => k.def.id);
}

function collect(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < Math.round(seconds * 20); i++) out.push(...sim.tick());
  return out;
}

function addHostile(sim: Sim, dist = 6): Entity {
  const p = sim.player;
  const mob = createMob(9500, MOBS.training_dummy, 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dist,
  });
  mob.hostile = true;
  mob.maxHp = mob.hp = 100000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  return mob;
}

describe('the spec card', () => {
  it('Chronomancy is the healer, internal id still arcane', () => {
    const spec = TALENTS.mage?.specs.find((s) => s.id === 'arcane');
    expect(spec?.name).toBe('Chronomancy');
    expect(spec?.role).toBe('healer');
    expect(spec?.signature).toBe('temporal_mend');
    expect(spec?.mastery?.name).toBe('Chronoweave');
  });
});

describe('gating', () => {
  it('committing Chronomancy grants the healer kit; fire and frost never see it', () => {
    const chrono = knownIds('arcane');
    expect(chrono).toContain('temporal_mend');
    expect(chrono).toContain('temporal_barrier');
    for (const spec of ['fire', 'frost'] as const) {
      const book = knownIds(spec);
      expect(book, spec).not.toContain('temporal_mend');
      expect(book, spec).not.toContain('temporal_barrier');
    }
  });

  it('the healer keeps its arcane kit + shared utility and loses the DPS nukes', () => {
    const chrono = knownIds('arcane');
    for (const kept of [
      // The arcane school is Chronomancer-exclusive now (owner spec split 2026-07-14).
      'arcane_missiles',
      'arcane_explosion',
      'arcane_intellect',
      'polymorph',
      'blink',
      'fireball',
      'frostbolt',
      'frost_nova',
      'conjure_food',
      'conjure_water',
    ]) {
      expect(chrono, kept).toContain(kept);
    }
    // frost_armor is Frost identity (excludeSpecs hand-off, like Reaver Strike).
    for (const gone of [
      'fire_blast',
      'scorch',
      'pyroblast',
      'flamestrike',
      'ice_barrier',
      'frost_armor',
    ]) {
      expect(chrono, gone).not.toContain(gone);
    }
  });

  it('the owner spec split (2026-07-14): fire keeps the fire book, frost sheds it', () => {
    const fire = knownIds('fire');
    for (const kept of ['fire_blast', 'scorch', 'pyroblast', 'flamestrike', 'blazing_barrier']) {
      expect(fire, `fire:${kept}`).toContain(kept);
    }
    // Fire hands off the starter frost armor on commit (excludeSpecs), and its
    // barrier is Blazing Barrier at the spec pick: no shared Frostveil.
    expect(fire, 'fire:frost_armor').not.toContain('frost_armor');
    expect(fire, 'fire:ice_barrier').not.toContain('ice_barrier');
    const frost = knownIds('frost');
    // Frost keeps its own barrier + starter armor, but the fire nukes are
    // fire-only now (Lluvia de Ascuas / Escaldar / Lanza Ignea / Llamarada).
    expect(frost, 'frost:ice_barrier').toContain('ice_barrier');
    expect(frost, 'frost:frost_armor').toContain('frost_armor');
    for (const gone of ['fire_blast', 'scorch', 'pyroblast', 'flamestrike']) {
      expect(frost, `frost:${gone}`).not.toContain(gone);
    }
    // The arcane school stays Chronomancer-exclusive for both DPS specs.
    for (const spec of ['fire', 'frost'] as const) {
      for (const gone of ['arcane_missiles', 'arcane_explosion']) {
        expect(knownIds(spec), `${spec}:${gone}`).not.toContain(gone);
      }
    }
  });

  it('swapping the healer to a DPS spec swaps the exclusive kit both ways', () => {
    const { sim } = chronoMage();
    expect(sim.resolvedAbility('temporal_mend')).not.toBeNull();
    expect(sim.setSpec('fire')).toBe(true);
    expect(sim.resolvedAbility('temporal_mend')).toBeNull();
    expect(sim.resolvedAbility('temporal_barrier')).toBeNull();
    expect(sim.resolvedAbility('fire_blast')).not.toBeNull();
  });
});

describe('Temporal Mend', () => {
  it('heals the mage themself through the normal channel (cast, cost, no overheal)', () => {
    const { sim, p } = chronoMage();
    p.hp = Math.floor(p.maxHp * 0.5);
    const mana0 = p.resource;
    sim.castAbility('temporal_mend'); // no friendly target: resolves to self
    expect(p.castingAbility).toBe('temporal_mend'); // a real 2s cast
    const events = collect(sim, 2.5);
    const heal = events.find(
      (e): e is Extract<SimEvent, { type: 'heal2' }> =>
        e.type === 'heal2' && e.sourceId === p.id && e.targetId === p.id,
    );
    expect(heal).toBeDefined();
    expect(heal?.amount ?? 0).toBeGreaterThan(0);
    expect(p.resource).toBeLessThan(mana0); // billed
    expect(p.hp).toBeLessThanOrEqual(p.maxHp);
    // No overheal: a full-health recast clamps to zero effective healing.
    p.hp = p.maxHp;
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    sim.castAbility('temporal_mend');
    const events2 = collect(sim, 2.5);
    const heal2 = events2.find(
      (e): e is Extract<SimEvent, { type: 'heal2' }> =>
        e.type === 'heal2' && e.targetId === p.id && e.sourceId === p.id,
    );
    expect(heal2?.amount).toBe(0);
    expect(p.hp).toBe(p.maxHp);
  });

  it('heals a wounded ally, crits through the normal roll, and draws healing threat', () => {
    const { sim, p } = chronoMage();
    const ally = sim.addPlayer('warrior', 'Tanque');
    const allyEnt = sim.entities.get(ally);
    if (!allyEnt) throw new Error('ally missing');
    allyEnt.pos.x = p.pos.x + 5;
    allyEnt.pos.z = p.pos.z;
    const mob = addHostile(sim, 6);
    // The ally is fighting the mob (on its threat table): healing the ally
    // must then put the HEALER on that same table (classic healing threat).
    (
      sim as unknown as {
        dealDamage(
          s: Entity,
          t: Entity,
          n: number,
          c: boolean,
          sc: string,
          a: null,
          k: string,
        ): void;
      }
    ).dealDamage(allyEnt, mob, 1, false, 'physical', null, 'hit');
    allyEnt.hp = Math.max(1, Math.floor(allyEnt.maxHp * 0.4));
    p.stats.int = 2000; // spellCrit = 0.05 + int * 0.0008: forces the heal crit roll
    sim.targetEntity(ally);
    sim.castAbility('temporal_mend');
    const events = collect(sim, 2.5);
    const heal = events.find(
      (e): e is Extract<SimEvent, { type: 'heal2' }> =>
        e.type === 'heal2' && e.sourceId === p.id && e.targetId === ally,
    );
    expect(heal).toBeDefined();
    expect(heal?.crit).toBe(true); // the normal heal-crit roll, forced by stat
    // Threat: the healer entered the mob's table via the effective healing.
    const threat = (mob as unknown as { threat?: Map<number, number> }).threat;
    expect(threat?.has(p.id)).toBe(true);
  });

  it('respects range like every other heal', () => {
    const { sim, p } = chronoMage();
    const ally = sim.addPlayer('warrior', 'Lejano');
    const allyEnt = sim.entities.get(ally);
    if (!allyEnt) throw new Error('ally missing');
    allyEnt.pos.x = p.pos.x + 50; // beyond the 30yd heal range
    allyEnt.pos.z = p.pos.z;
    allyEnt.hp = Math.floor(allyEnt.maxHp * 0.4);
    sim.targetEntity(ally);
    sim.castAbility('temporal_mend');
    expect(p.castingAbility).toBeNull(); // refused: out of range
  });
});

describe('Temporal Barrier', () => {
  it('shields self or ally for the rank amount, absorbs, expires, and a recast replaces', () => {
    const { sim, p } = chronoMage();
    sim.castAbility('temporal_barrier'); // no target: self
    sim.tick();
    let shield = p.auras.find((a) => a.id === 'temporal_barrier');
    expect(shield?.kind).toBe('absorb');
    // Rank 3 base 160, scaled by the Chronoweave mastery (x1.15 at level 20)
    // like the heals, plus 25 percent of the caster's spell power (PR #2154's
    // barrier scaling; the autoEquip level-20 mage carries 40 spell power, so
    // 184 + 10 = 194).
    expect(shield?.value).toBe(194);
    // Absorption channels through the normal pipeline: a 100 hit leaves hp
    // untouched and the shell at 94.
    const mob = addHostile(sim);
    const hp0 = p.hp;
    (
      sim as unknown as {
        dealDamage(
          s: Entity,
          t: Entity,
          n: number,
          c: boolean,
          sc: string,
          a: null,
          k: string,
        ): void;
      }
    ).dealDamage(mob, p, 100, false, 'physical', null, 'hit');
    expect(p.hp).toBe(hp0);
    shield = p.auras.find((a) => a.id === 'temporal_barrier');
    expect(shield?.value).toBe(94);
    // A same-caster recast REPLACES to full (the documented absorb rule).
    p.cooldowns.delete('temporal_barrier');
    (p as unknown as { gcdRemaining: number }).gcdRemaining = 0;
    p.resource = p.maxResource;
    sim.castAbility('temporal_barrier');
    sim.tick();
    const shields = p.auras.filter((a) => a.id === 'temporal_barrier');
    expect(shields.length).toBe(1); // never stacks with itself
    expect(shields[0].value).toBe(194); // fresh full shell
    // Expiry: ride past the 10s window and the shell is gone.
    collect(sim, 10.5);
    expect(p.auras.some((a) => a.id === 'temporal_barrier')).toBe(false);
  });

  it('lands on an ally and is instant on the GCD', () => {
    const { sim, p } = chronoMage();
    const ally = sim.addPlayer('warrior', 'Escudado');
    const allyEnt = sim.entities.get(ally);
    if (!allyEnt) throw new Error('ally missing');
    allyEnt.pos.x = p.pos.x + 5;
    allyEnt.pos.z = p.pos.z;
    sim.targetEntity(ally);
    sim.castAbility('temporal_barrier');
    expect(p.castingAbility).toBeNull(); // instant
    expect((p as unknown as { gcdRemaining: number }).gcdRemaining).toBeGreaterThan(0); // on the GCD
    sim.tick();
    expect(allyEnt.auras.some((a) => a.id === 'temporal_barrier' && a.kind === 'absorb')).toBe(
      true,
    );
    expect(p.cooldowns.has('temporal_barrier')).toBe(true); // the 12s cooldown armed
  });
});

describe('persistence and loadouts', () => {
  it('the arcane spec id survives a serialize/addPlayer round-trip', () => {
    const { sim } = chronoMage();
    const state = sim.serializeCharacter(sim.playerId);
    expect(state?.talents?.spec).toBe('arcane');
    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const pid = sim2.addPlayer('mage', 'Persistida', { state: state ?? undefined });
    sim2.tick();
    const meta = (
      sim2 as unknown as { players: Map<number, { talents: { spec: string | null } }> }
    ).players.get(pid);
    expect(meta?.talents.spec).toBe('arcane');
    expect(sim2.resolvedAbility('temporal_mend', pid)).not.toBeNull();
    expect(sim2.resolvedAbility('temporal_barrier', pid)).not.toBeNull();
  });

  it('a saved loadout restores the healer spec', () => {
    const { sim } = chronoMage();
    const idx = sim.saveLoadout('sanadora', []);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(sim.setSpec('fire')).toBe(true);
    expect(sim.resolvedAbility('temporal_mend')).toBeNull();
    expect(sim.switchLoadout(idx)).toBe(true);
    expect(sim.resolvedAbility('temporal_mend')).not.toBeNull();
  });
});
