// The character sheet's live-world bridge (src/ui/char_stat_model_core.ts), and
// the two cells it added: Healing Power and Spell Crit.
//
// Three contracts, each driven through the REAL code path:
// 1. Spell Crit shows the exact chance the sim rolls (Sim.spellCrit), not a UI
//    re-derivation, and it is a separate pool from the weapon Crit Chance:
//    crit rating raises both by the same amount, Intellect only the spell side.
// 2. Healing Power shows entity.healPower, itemized as all of Spell Power plus
//    the heal-only gear affix.
// 3. Online parity: a ClientWorld-shaped self mirror, fed by the real server
//    emitter (server/self_scalar_wire.ts) through the real client decoder
//    (src/net/combat_scalar_wire.ts), yields the SAME model as the offline Sim
//    for every sheet cell, and the new `scb` self scalar is what makes Spell
//    Crit agree (without it the mirror under-reports a geared caster).
import { describe, expect, it } from 'vitest';
import { emitSelfScalarKeys } from '../server/self_scalar_wire';
import { blankEntity } from '../src/net/blank_entity';
import { applySelfCombatScalars } from '../src/net/combat_scalar_wire';
import { SPELL_CRIT_PER_INT, spellCritChance } from '../src/sim/combat/spell_combat';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, WorldContent } from '../src/sim/types';
import { type CharStatWorld, charStatModel } from '../src/ui/char_stat_model_core';
import { STAT_GRID } from '../src/ui/char_stats_view';

// Player-derived reads only, so strip ambient world content to keep each Sim
// construction cheap (the tests/stat_tooltip.test.ts subsystem-world pattern).
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

// A real cloth healer helmet carrying BOTH new inputs: a flat Healing Power
// affix and crit rating (plus Intellect), gated at level 20. Cloth, so every
// class under test can wear it.
const HEAL_HELM = 'emberscreed_helmet';

function caster(cls: PlayerClass, level: number, helm: boolean): Sim {
  const sim = new Sim({ seed: 7, playerClass: cls, world: WORLD });
  sim.setPlayerLevel(level);
  if (helm) {
    sim.addItem(HEAL_HELM, 1);
    sim.equipItem(HEAL_HELM);
    // Guard the fixture itself: a silently refused equip would zero every delta.
    expect(sim.equipment.helmet).toBe(HEAL_HELM);
  }
  return sim;
}

// The Sim-shaped world: the live offline Sim satisfies the read structurally.
const simWorld = (sim: Sim): CharStatWorld => sim;

// The ClientWorld-shaped world: a blank self mirror, filled the way the online
// client fills it. Level, the primary stats and the auras ride their own
// self-record channels (level, the `stats` key, the self auras channel), so
// they are copied; every combat scalar goes through the real server emitter and
// the real client decoder. `dropKey` omits one scalar, simulating a server that
// never sent it. Kept bespoke on purpose (not tests/helpers/bare_client.ts): the
// contract under test is exactly the self-scalar emit/decode pair, so the
// fixture drives those two functions and nothing else of ClientWorld.
function mirrorWorld(sim: Sim, dropKey?: string): CharStatWorld {
  const p = sim.player;
  const meta = sim.players.get(sim.playerId);
  if (!meta) throw new Error('local player meta missing');
  const record: Record<string, unknown> = {};
  emitSelfScalarKeys(
    (key, value) => {
      if (key !== dropKey) record[key] = value;
    },
    meta,
    p,
    'normal',
  );
  const mirror: Entity = blankEntity(p.id);
  mirror.level = p.level;
  mirror.stats = { ...p.stats };
  mirror.auras = p.auras.map((a) => ({ ...a }));
  applySelfCombatScalars(mirror, record);
  return { player: mirror, equipment: { ...sim.equipment }, cfg: sim.cfg };
}

describe('char_stat_model_core: Spell Crit is the sim roll, a pool of its own', () => {
  it('the Spell Crit cell equals the chance Sim.spellCrit rolls, for every class', () => {
    for (const cls of ['priest', 'mage', 'paladin', 'druid', 'warrior', 'rogue'] as const) {
      const sim = caster(cls, 20, false);
      // biome-ignore lint/suspicious/noExplicitAny: Sim.spellCrit is the private roll source
      const rolled = (sim as any).spellCrit(sim.player) as number;
      expect(charStatModel(simWorld(sim), 'spellCrit').statValue).toBeCloseTo(rolled * 100, 10);
    }
  });

  it('is a different number from the weapon Crit Chance (Intellect vs Agility)', () => {
    const sim = caster('priest', 20, false);
    const spell = charStatModel(simWorld(sim), 'spellCrit').statValue;
    const weapon = charStatModel(simWorld(sim), 'critChance').statValue;
    // A priest's Intellect far outweighs its Agility, so merging the two into one
    // "crit" number would misreport both.
    expect(spell).toBeGreaterThan(weapon);
  });

  it('crit rating raises both pools by the same amount; Intellect only the spell pool', () => {
    const bare = caster('priest', 20, false);
    const geared = caster('priest', 20, true);
    const helm = ITEMS[HEAL_HELM];
    expect(helm.critRating ?? 0).toBeGreaterThan(0);
    expect(helm.stats?.int ?? 0).toBeGreaterThan(0);
    const d = (stat: 'spellCrit' | 'critChance') =>
      charStatModel(simWorld(geared), stat).statValue -
      charStatModel(simWorld(bare), stat).statValue;
    // The weapon pool moves by exactly the shared core (the helm has no Agility)...
    expect(d('critChance')).toBeCloseTo(
      (geared.player.sharedCritBonus - bare.player.sharedCritBonus) * 100,
      10,
    );
    expect(d('critChance')).toBeGreaterThan(0);
    // ...and the spell pool by that same amount plus the helm's Intellect.
    expect(d('spellCrit') - d('critChance')).toBeCloseTo(
      (helm.stats?.int ?? 0) * SPELL_CRIT_PER_INT * 100,
      10,
    );
  });

  it('non-casters get the minor-benefit note on both new cells; casters do not', () => {
    const warrior = simWorld(caster('warrior', 20, false));
    const priest = simWorld(caster('priest', 20, false));
    expect(charStatModel(warrior, 'spellCrit').minorForClass).toBe(true);
    expect(charStatModel(warrior, 'healPower').minorForClass).toBe(true);
    expect(charStatModel(priest, 'spellCrit').minorForClass).toBe(false);
    expect(charStatModel(priest, 'healPower').minorForClass).toBe(false);
  });
});

describe('char_stat_model_core: Healing Power', () => {
  it('shows entity.healPower: all of Spell Power, plus the gear affix itemized', () => {
    const bare = caster('priest', 20, false);
    const bareModel = charStatModel(simWorld(bare), 'healPower');
    // No heal-only gear: Healing Power IS Spell Power, one "From Spell Power" line.
    expect(bareModel.statValue).toBe(bare.player.spellPower);
    expect(bareModel.sources).toEqual([
      { kind: 'attributes', value: bare.player.spellPower, fromStat: 'spellPower' },
    ]);

    const geared = caster('priest', 20, true);
    const p = geared.player;
    const model = charStatModel(simWorld(geared), 'healPower');
    expect(model.statValue).toBe(p.healPower);
    expect(p.healPower).toBe(p.spellPower + (ITEMS[HEAL_HELM].healPower ?? 0));
    expect(model.sources).toContainEqual({
      kind: 'attributes',
      value: p.spellPower,
      fromStat: 'spellPower',
    });
    expect(model.sources).toContainEqual({ kind: 'gear', value: ITEMS[HEAL_HELM].healPower });
    // The lines reconcile to the cell exactly.
    expect(model.sources.reduce((sum, s) => sum + s.value, 0)).toBe(model.statValue);
  });
});

describe('char_stat_model_core: the online self mirror reads the same sheet', () => {
  it('every sheet cell matches the offline Sim, for a geared caster and a warrior', () => {
    for (const sim of [caster('priest', 20, true), caster('warrior', 20, false)]) {
      const offline = simWorld(sim);
      const online = mirrorWorld(sim);
      for (const stat of STAT_GRID) {
        expect(charStatModel(online, stat), `${sim.cfg.playerClass} ${stat}`).toEqual(
          charStatModel(offline, stat),
        );
      }
    }
  });

  it('the scb self scalar is what makes Spell Crit agree online', () => {
    const sim = caster('priest', 20, true);
    // The geared caster's shared crit core is non-zero (the helm's crit rating).
    expect(sim.player.sharedCritBonus).toBeGreaterThan(0);
    const withScb = charStatModel(mirrorWorld(sim), 'spellCrit').statValue;
    const withoutScb = charStatModel(mirrorWorld(sim, 'scb'), 'spellCrit').statValue;
    expect(withScb).toBeCloseTo(spellCritChance(sim.player) * 100, 10);
    // A mirror that never received scb under-reports by exactly the shared core.
    expect(withScb - withoutScb).toBeCloseTo(sim.player.sharedCritBonus * 100, 10);
  });
});
