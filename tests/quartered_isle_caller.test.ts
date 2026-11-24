// The Cinderscar Caller is the Quartered Isle's ranged caster: it holds at range and
// throws Burnway Flare through the hostile-caster petSpell path (mob/combat_profile.ts),
// telegraphed by a windup the renderer plays as the KayKit spell throw.

import { describe, expect, it } from 'vitest';
import { mobVisualKey, VISUALS } from '../src/render/characters/manifest';
import { BUILTIN_WORLD, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { MELEE_RANGE, type SimEvent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { OPEN_FIELD, placePlayerInOpenField } from './helpers/open_field';

const CALLER = MOBS.cinderscar_caller;

describe('the Cinderscar Caller', () => {
  it('is a ranged fire caster whose bolt matches its melee band per second', () => {
    const spell = CALLER.petSpell;
    expect(spell?.name).toBe('Burnway Flare');
    expect(spell?.school).toBe('fire');
    expect(spell?.range ?? 0).toBeGreaterThan(MELEE_RANGE * 3);
    // level 20: the bolt's rolled band (min/max plus the level terms in
    // sim.ts updateRangedPetAttack) per cast, against the melee weapon per swing
    const L = 20;
    const bolt = (spell!.min + L * 0.8 + spell!.max + L * 1.1) / 2 / spell!.every;
    const dmg = CALLER.dmgBase + CALLER.dmgPerLevel * (L - 1);
    const melee = (Math.round(dmg * 0.8) + Math.round(dmg * 1.25)) / 2 / CALLER.attackSpeed;
    expect(Math.abs(bolt - melee) / melee).toBeLessThan(0.1);
  });

  it('plays the spell throw, not the Ember Fiend chop, on its windup', () => {
    const def = VISUALS[mobVisualKey('cinderscar_caller')];
    expect(def.url).toBe(VISUALS.mob_hoard_ember_fiend.url);
    expect(def.clips.attack).toEqual(['Spellcast_Shoot']);
  });

  it('casts from range and never closes to melee', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      autoEquip: true,
      world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
    });
    placePlayerInOpenField(sim);
    const p = sim.player;
    p.maxHp = p.hp = 100000; // this test owns range, not survival
    const x = OPEN_FIELD.x;
    const z = OPEN_FIELD.z + 18;
    const caller = createMob(990401, CALLER, 20, { x, y: groundHeight(x, z, sim.cfg.seed), z });
    caller.hitBonus = 1; // force the bolts to land
    (sim as any).addEntity(caller);
    const events: SimEvent[] = [];
    let minDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20 * 10; i++) {
      // tick() drains and returns this tick's events
      events.push(...(sim.tick() as SimEvent[]));
      minDist = Math.min(minDist, Math.hypot(caller.pos.x - p.pos.x, caller.pos.z - p.pos.z));
    }
    const hits = events.filter(
      (e) => e.type === 'damage' && e.sourceId === caller.id && e.targetId === p.id,
    ) as Extract<SimEvent, { type: 'damage' }>[];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      expect(h.ability).toBe('Burnway Flare');
      expect(h.school).toBe('fire');
    }
    expect(
      events.some((e) => e.type === 'spellfx' && e.sourceId === caller.id && e.fx === 'windup'),
    ).toBe(true);
    expect(minDist).toBeGreaterThan(MELEE_RANGE * 2);
  });
});
