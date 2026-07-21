import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { GroundAoE } from '../src/sim/entity_roster';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// Ground-targeted casting primitive (docs/design/arpg-spell-mechanics.md), exercised
// through Flamestrike (mage, targetMode 'position', range 30). The deterministic sim
// is the authority: the client only proposes a point, the sim clamps it to the
// ability's range and the spell's ground zone is created there (not on the caster).

function place(sim: Sim, id: number, x: number, z: number): void {
  const e = sim.entities.get(id);
  if (!e) throw new Error(`no entity ${id}`);
  e.pos = { x, y: groundHeight(x, z, sim.cfg.seed), z };
  e.prevPos = { ...e.pos };
}

function makeMage(): { sim: Sim; pid: number } {
  const sim = new Sim({ seed: 7, playerClass: 'mage', noPlayer: true });
  const pid = sim.addPlayer('mage', 'Mag');
  sim.setPlayerLevel(20, pid); // plenty of level for Flamestrike
  // The mage unify spec-gated Flamestrike into the fire kit (specs: ['fire']).
  if (!sim.setSpec('fire', pid)) throw new Error('no fire spec');
  const me = sim.entities.get(pid);
  if (!me) throw new Error('no mage');
  me.resource = 9999; // plenty of mana for the cast
  return { sim, pid };
}

// Flamestrike is an aimed BURST (aoeDamage at the clamped point plus a
// radius-carrying spellfxAt for the impact ring), not a lingering ground zone.
// Since the mage unify it is a real 2 s cast (owner rule 2026-07-11), so the
// burst lands at cast RESOLVE, not at the castAbility call.
function spawnWolfAt(sim: Sim, x: number, z: number): ReturnType<typeof createMob> {
  const s = sim as unknown as { nextId: number; addEntity(e: ReturnType<typeof createMob>): void };
  const mob = createMob(s.nextId++, MOBS.forest_wolf, 1, {
    x,
    y: groundHeight(x, z, sim.cfg.seed),
    z,
  });
  mob.maxHp = 5000;
  mob.hp = 5000;
  mob.hostile = true;
  mob.aiState = 'idle';
  s.addEntity(mob);
  return mob;
}

function aimedFx(sim: Sim): { x: number; z: number; radius?: number } | undefined {
  for (const e of sim.drainEvents()) {
    if (e.type === 'spellfxAt') return e;
  }
  return undefined;
}

// Tick the in-flight cast through to its resolve, returning the aimed impact
// event (spellfxAt) it emits, if any. Bounded well past the 2 s cast: melee
// pushback from an adjacent mob can stretch it.
function resolveAimedCast(sim: Sim, pid: number): ReturnType<typeof aimedFx> {
  const me = sim.entities.get(pid);
  if (!me) throw new Error(`no caster ${pid}`);
  let fx: ReturnType<typeof aimedFx>;
  for (let i = 0; i < 200 && me.castingAbility && !fx; i++) {
    fx = sim.tick().find((e) => e.type === 'spellfxAt');
  }
  return fx;
}

describe('ground-targeted casting (Flamestrike)', () => {
  it('detonates at the aimed point (ring event + damage there), not on the caster', () => {
    const { sim, pid } = makeMage();
    place(sim, pid, 0, 0);
    const atAim = spawnWolfAt(sim, 18, 0);
    const atCaster = spawnWolfAt(sim, 0, 2);
    sim.drainEvents();

    sim.castAbility('flamestrike', pid, { x: 18, z: 0 }); // within range 30

    const fx = resolveAimedCast(sim, pid);
    expect(fx).toBeDefined();
    expect(fx?.x).toBeCloseTo(18, 1);
    expect(fx?.radius).toBe(7); // the AoE ring size rides the event
    expect(atAim.hp).toBeLessThan(5000);
    expect(atCaster.hp).toBe(5000); // 16yd from the blast: untouched
  });

  it('clamps the aimed point to the ability range from the caster', () => {
    const { sim, pid } = makeMage();
    place(sim, pid, 0, 0);
    const atClamp = spawnWolfAt(sim, 30, 0);
    sim.drainEvents();

    sim.castAbility('flamestrike', pid, { x: 100, z: 0 }); // far beyond range 30

    const fx = resolveAimedCast(sim, pid);
    expect(fx?.x).toBeCloseTo(30, 0); // clamped onto the 30 yd range
    expect(atClamp.hp).toBeLessThan(5000);
  });

  it('falls back to the caster position when no point is chosen', () => {
    const { sim, pid } = makeMage();
    place(sim, pid, 5, 5);
    const nearCaster = spawnWolfAt(sim, 7, 5);
    sim.drainEvents();

    sim.castAbility('flamestrike', pid); // no aim (e.g. a keybind cast)
    resolveAimedCast(sim, pid); // no aim means no spellfxAt; just ride out the cast

    expect(nearCaster.hp).toBeLessThan(5000);
  });

  it('leaves no lingering ground zone (the burst is the whole spell)', () => {
    const { sim, pid } = makeMage();
    place(sim, pid, 0, 0);
    sim.castAbility('flamestrike', pid, { x: 18, z: 0 });
    expect(resolveAimedCast(sim, pid)).toBeDefined(); // the burst actually landed
    const zones = (sim as unknown as { groundAoEs: GroundAoE[] }).groundAoEs;
    expect(zones.some((z) => z.ability === 'Flamestrike')).toBe(false);
  });
});

// The thematic per-class ground-targeted spells. Rain of Fire (warlock), Volley
// (hunter) and Hurricane (druid) are CHANNELED: casting begins a channel aimed at
// the (clamped) point, and each tick pulses an AoE there via the channel-tick path.
// Earthquake (shaman) is an instant lingering ground zone (groundAoE).
describe('ground-targeted casting (thematic per-class spells)', () => {
  function castGroundSpell(cls: PlayerClass, spell: string, aim: { x: number; z: number }): Sim {
    const sim = new Sim({ seed: 7, playerClass: cls, noPlayer: true });
    const pid = sim.addPlayer(cls, 'Caster');
    sim.setPlayerLevel(20, pid);
    const me = sim.entities.get(pid);
    if (!me) throw new Error('no caster');
    me.resource = 9999;
    place(sim, pid, 0, 0);
    sim.castAbility(spell, pid, aim);
    return sim;
  }

  const channeled = [
    { cls: 'warlock', spell: 'rain_of_fire' },
    { cls: 'hunter', spell: 'volley' },
    { cls: 'druid', spell: 'hurricane' },
  ] as const;

  for (const c of channeled) {
    it(`${c.spell} (${c.cls}) begins a channel aimed at the (clamped) point`, () => {
      const sim = castGroundSpell(c.cls, c.spell, { x: 100, z: 0 }); // far beyond range
      const me = sim.entities.get(sim.playerId);
      expect(me?.channeling, `${c.spell} channeling`).toBe(true);
      // aim is clamped to the ability's range from the caster at (0,0)
      const range = sim.known.find((k) => k.def.id === c.spell)?.def.range ?? 0;
      expect(me?.castAim?.x).toBeCloseTo(range, 0);
      expect(me?.castAim?.z).toBeCloseTo(0, 1);
    });

    it(`${c.spell} (${c.cls}) emits a radius-carrying aimed pulse on channel tick`, () => {
      const sim = castGroundSpell(c.cls, c.spell, { x: 16, z: 0 });
      const radius = sim.known
        .find((k) => k.def.id === c.spell)
        ?.def.effects.find((eff) => eff.type === 'aoeDamage')?.radius;
      sim.drainEvents();

      let fx: ReturnType<typeof aimedFx>;
      for (let i = 0; i < 40 && !fx; i++) {
        fx = sim.tick().find((e) => e.type === 'spellfxAt');
      }

      expect(fx).toBeDefined();
      expect(fx?.x).toBeCloseTo(16, 1);
      expect(fx?.z).toBeCloseTo(0, 1);
      expect(fx?.radius).toBe(radius);
    });
  }

  it('a channeled ground spell damages enemies in the aimed area over its ticks', () => {
    // Flat dungeon-floor band (x > 600) for deterministic clear line-of-sight.
    const FLAT_X = 700;
    const sim = new Sim({ seed: 7, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Lock');
    sim.setPlayerLevel(20, pid);
    const me = sim.entities.get(pid);
    if (!me) throw new Error('no warlock');
    me.resource = 9999;
    place(sim, pid, FLAT_X, 0);
    const mob = createMob(9100, MOBS.forest_wolf, 20, sim.groundPos(FLAT_X + 6, 0));
    mob.hostile = true;
    sim.entities.set(9100, mob);
    const hp0 = mob.hp;

    sim.castAbility('rain_of_fire', pid, { x: FLAT_X + 6, z: 0 });
    // advance through enough of the 4 s channel for at least one tick to land
    for (let i = 0; i < 40; i++) sim.tick();

    expect(mob.hp).toBeLessThan(hp0);
  });

  it('a completed ground-targeted channel clears castAim (always cleared on resolve)', () => {
    const sim = castGroundSpell('warlock', 'rain_of_fire', { x: 16, z: 0 });
    const me = sim.entities.get(sim.playerId);
    expect(me?.channeling).toBe(true);
    expect(me?.castAim).not.toBeNull();
    for (let i = 0; i < 120 && me?.castingAbility; i++) sim.tick();
    expect(me?.castingAbility).toBeNull();
    expect(me?.castAim).toBeNull();
  });

  it('earthquake (shaman) drops a lingering nature zone at the aimed point', () => {
    const sim = castGroundSpell('shaman', 'earthquake', { x: 16, z: 0 });
    const fx = aimedFx(sim);
    expect(fx?.radius).toBe(8);
    const zone = (sim as unknown as { groundAoEs: GroundAoE[] }).groundAoEs.find(
      (z) => z.ability === 'Earthquake',
    );
    expect(zone).toBeDefined();
    expect(zone?.pos.x).toBeCloseTo(16, 1);
    expect(zone?.pos.z).toBeCloseTo(0, 1);
  });
});
