// 2026-07 shadow-vs-casters rebalance (the healers-wave recipe applied to the
// Vespers damage kit). Before this pass the shadow priest measured 34.4
// sustained DPS on scripts/caster_dps_probe.ts against 43.9 (elemental), 40.7
// (affliction) and 37.3 (frost floor), and an analytic Smite-spamming healer
// out-damaged the DPS spec's own kit. Three changes close it:
//   - Dirge of Decay gains its missing level-20 cap rank (sub-cap untouched),
//   - Litany of Woe gains a level-20 cap rank (its only rank was level 14),
//   - the filler joins the shadow spec baseline, and the Gloamveil mastery
//     carries Dark Descant: every 3rd Litany of Woe refunds 3 sec of
//     Mindfracture cooldown and makes the next one instant.
// Post-fix the same probe measures 42.2: second of five, inside the band.
// Every tuning literal is pinned here; the proc is exercised on a real Sim.
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { specBaselineFor } from '../src/sim/content/spec_baselines';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { ABILITIES, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Entity, MAX_LEVEL } from '../src/sim/types';

function known(cls: 'priest', id: string, level = MAX_LEVEL) {
  const ability = abilitiesKnownAt(cls, level).find((k) => k.def.id === id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

describe('shadow rank ladders (tuning literals pinned)', () => {
  it('Dirge of Decay: sub-cap ranks untouched, new cap rank 4 at 20', () => {
    const def = ABILITIES.shadow_word_pain;
    expect(def.cost).toBe(25);
    expect(def.effects).toEqual([{ type: 'dot', total: 30, duration: 18, interval: 3 }]);
    expect(def.ranks).toEqual([
      {
        rank: 2,
        level: 10,
        cost: 38,
        effects: [{ type: 'dot', total: 54, duration: 18, interval: 3 }],
      },
      {
        rank: 3,
        level: 16,
        cost: 55,
        effects: [{ type: 'dot', total: 84, duration: 18, interval: 3 }],
      },
      {
        rank: 4,
        level: 20,
        cost: 72,
        effects: [{ type: 'dot', total: 122, duration: 18, interval: 3 }],
      },
    ]);
  });

  it('Litany of Woe: base rank untouched, new cap rank 2 at 20', () => {
    const def = ABILITIES.mind_flay;
    expect(def.cost).toBe(45);
    expect(def.channel).toEqual({ duration: 3, ticks: 3 });
    expect(def.effects).toEqual([{ type: 'drainTick', min: 12, max: 12, healFrac: 0 }]);
    expect(def.ranks).toEqual([
      {
        rank: 2,
        level: 20,
        cost: 58,
        effects: [{ type: 'drainTick', min: 17, max: 17, healFrac: 0 }],
      },
    ]);
  });

  it('a level-20 priest resolves the cap ranks; a leveling priest keeps the old ones', () => {
    expect(known('priest', 'shadow_word_pain').effects).toEqual([
      { type: 'dot', total: 122, duration: 18, interval: 3 },
    ]);
    expect(known('priest', 'mind_flay').effects).toEqual([
      { type: 'drainTick', min: 17, max: 17, healFrac: 0 },
    ]);
    // Leveling is unchanged: at 19 both ladders still resolve the old top.
    expect(known('priest', 'shadow_word_pain', 19).effects).toEqual([
      { type: 'dot', total: 84, duration: 18, interval: 3 },
    ]);
    expect(known('priest', 'mind_flay', 19).effects).toEqual([
      { type: 'drainTick', min: 12, max: 12, healFrac: 0 },
    ]);
  });

  it('the shadow baseline covers the filler; the table stays passive-only', () => {
    const baseline = specBaselineFor('priest', 'shadow');
    expect(baseline?.ability).toContainEqual({
      ability: 'mind_flay',
      dmgPct: 0.15,
      costPct: -0.1,
    });
    expect(baseline?.proc).toBeUndefined();
  });

  it('Dark Descant rides the Gloamveil mastery for shadow only', () => {
    const shadowMods = computeTalentModifiers('priest', {
      ...emptyAllocation(),
      spec: 'shadow',
    } as never);
    const descant = shadowMods.procs.find((p) => p.id === 'pri_shadow_dark_descant');
    expect(descant).toBeDefined();
    expect(descant?.trigger).toEqual({ on: 'castNth', n: 3, abilities: ['mind_flay'] });
    expect(descant?.responses).toEqual([
      { kind: 'cooldownRefund', ability: 'mind_blast', seconds: 3 },
      { kind: 'empowerNext', aura: 'next_cast_instant', abilities: ['mind_blast'], duration: 8 },
    ]);
    for (const spec of ['discipline', 'holy'] as const) {
      const mods = computeTalentModifiers('priest', { ...emptyAllocation(), spec } as never);
      expect(
        mods.procs.find((p) => p.id === 'pri_shadow_dark_descant'),
        spec,
      ).toBeUndefined();
    }
  });
});

describe('Dark Descant on a live Sim', () => {
  function shadowRig() {
    const sim = new Sim({ seed: 4242, playerClass: 'priest', autoEquip: true }) as Sim &
      Record<string, any>;
    sim.setPlayerLevel(20);
    if (!sim.setSpec('shadow')) throw new Error('setSpec shadow failed');
    sim.tick();
    const p: Entity = sim.player;
    const dummy = createMob(93001, MOBS.training_dummy, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 5,
    });
    dummy.hostile = true;
    dummy.maxHp = 10_000_000;
    dummy.hp = 10_000_000;
    sim.addEntity(dummy);
    sim.targetEntity(dummy.id);
    p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);
    return { sim, p, dummy };
  }

  // Drive full Litany of Woe channels until `count` casts have STARTED, then
  // stop. Returns immediately after the tick in which the Nth cast began.
  function channelFlays(sim: any, p: Entity, count: number) {
    let started = 0;
    for (let i = 0; i < 20 * 60; i++) {
      if (!p.castingAbility && !p.channeling) sim.castAbility('mind_flay');
      for (const ev of sim.tick()) {
        if (ev.type === 'castStart' && ev.ability === 'mind_flay') started++;
      }
      if (started >= count) return;
    }
    throw new Error(`only ${started}/${count} flay casts started`);
  }

  it('every 3rd Litany of Woe refunds Mindfracture and arms an instant cast', () => {
    const { sim, p } = shadowRig();
    sim.castAbility('mind_blast');
    for (let i = 0; i < 20 * 2 && p.castingAbility; i++) sim.tick();
    const cdAfterBlast = p.cooldowns.get('mind_blast');
    expect(cdAfterBlast).toBeDefined();
    expect(cdAfterBlast!).toBeGreaterThan(6);

    // Two full channels: no proc yet, the cooldown just ticks naturally.
    channelFlays(sim, p, 2);
    expect(p.auras.some((a) => a.kind === 'next_cast_instant')).toBe(false);

    // The 3rd flay press fires Dark Descant: 3 sec refunded (which clears the
    // ~2 sec that naturally remain at this point) and the empower aura armed.
    channelFlays(sim, p, 1);
    expect(p.cooldowns.get('mind_blast')).toBeUndefined();
    const empower = p.auras.find((a) => a.kind === 'next_cast_instant');
    expect(empower).toBeDefined();
    expect(empower?.name).toBe('Dark Descant');

    // The armed Mindfracture completes instantly (a damage event on the very
    // tick of the press, no cast bar) and consumes the aura. Let the 3rd
    // channel and its GCD run out first; the 8 sec empower window covers it.
    for (let i = 0; i < 20 * 5 && (p.castingAbility || p.channeling); i++) sim.tick();
    for (let i = 0; i < 20; i++) sim.tick();
    let hit = false;
    let castBar = false;
    sim.castAbility('mind_blast');
    // The press consumes the aura and completes the cast on tick 0 (no cast
    // bar); the bolt is a homing projectile, so the damage lands a few travel
    // ticks later.
    const auraConsumedOnPress = !p.auras.some((a) => a.kind === 'next_cast_instant');
    for (let i = 0; i < 10 && !hit; i++) {
      for (const ev of sim.tick()) {
        if (ev.type === 'damage' && ev.ability === 'Mindfracture') hit = true;
        if (ev.type === 'castStart' && ev.ability === 'mind_blast') castBar = true;
      }
    }
    expect(auraConsumedOnPress).toBe(true);
    expect(hit).toBe(true);
    expect(castBar).toBe(false);
  });

  it('a holy priest channelling Litany of Woe never hears the Descant', () => {
    const sim = new Sim({ seed: 4242, playerClass: 'priest', autoEquip: true }) as Sim &
      Record<string, any>;
    sim.setPlayerLevel(20);
    if (!sim.setSpec('holy')) throw new Error('setSpec holy failed');
    sim.tick();
    const p: Entity = sim.player;
    const dummy = createMob(93001, MOBS.training_dummy, 20, {
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z + 5,
    });
    dummy.hostile = true;
    dummy.maxHp = 10_000_000;
    dummy.hp = 10_000_000;
    sim.addEntity(dummy);
    sim.targetEntity(dummy.id);
    p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);

    sim.castAbility('mind_blast');
    for (let i = 0; i < 20 * 2 && p.castingAbility; i++) sim.tick();
    expect(p.cooldowns.get('mind_blast')).toBeDefined();
    channelFlays(sim, p, 3);
    expect(p.auras.some((a) => a.kind === 'next_cast_instant')).toBe(false);
    // The natural cooldown is still running: nothing refunded it.
    expect(p.cooldowns.get('mind_blast')).toBeDefined();
  });

  it('classes.ts still lists the shadow kit in learn order (guard against drift)', () => {
    expect(CLASSES.priest.abilities).toContain('shadow_word_pain');
    expect(CLASSES.priest.abilities).toContain('mind_flay');
  });
});
