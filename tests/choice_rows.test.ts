import { afterEach, describe, expect, it } from 'vitest';
import {
  CHOICE_ROW_LEVELS,
  CHOICE_ROWS,
  type ClassChoiceRows,
  repairRows,
  validateRows,
} from '../src/sim/content/choice_rows';
import {
  computeTalentModifiers,
  emptyAllocation,
  exportBuild,
  importBuild,
  repairAllocation,
  type TalentAllocation,
  validateAllocation,
} from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';

const cls = 'warrior';
const originalRows = CHOICE_ROWS[cls];
const PR5_CLASSES = ['warrior', 'mage', 'paladin', 'hunter', 'rogue', 'priest'] as const;

const fixtureRows: ClassChoiceRows = {
  rows: [
    {
      level: 5,
      theme: 'fixture',
      options: [
        {
          id: 'fixture_sta',
          name: 'Fixture Stamina',
          description: 'Adds stamina.',
          icon: 'fixture_sta',
          effect: { stats: { sta: 10 } },
        },
        {
          id: 'fixture_str',
          name: 'Fixture Strength',
          description: 'Adds strength.',
          icon: 'fixture_str',
          effect: { stats: { str: 5 } },
        },
        {
          id: 'fixture_fireball',
          name: 'Fixture Fireball',
          description: 'Improves Heroic Strike.',
          icon: 'fixture_fireball',
          effect: { ability: [{ ability: 'heroic_strike', dmgPct: 0.25 }] },
        },
      ],
    },
  ],
};

function withRows(): void {
  CHOICE_ROWS[cls] = fixtureRows;
}

function alloc(over: Partial<TalentAllocation> = {}): TalentAllocation {
  return { ...emptyAllocation(), ...over };
}

function simAtCap(): Sim {
  const sim = new Sim({ seed: 123, playerClass: cls });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

afterEach(() => {
  CHOICE_ROWS[cls] = originalRows;
});

describe('choice row validation and repair', () => {
  it('rejects unknown levels, wrong options, underlevel picks, and empty dormant rows', () => {
    withRows();
    expect(validateRows(cls, 20, { 6: 'fixture_sta' } as never).ok).toBe(false);
    expect(validateRows(cls, 20, { 5: 'missing' }).ok).toBe(false);
    expect(validateRows(cls, 4, { 5: 'fixture_sta' }).ok).toBe(false);
    expect(validateRows(cls, 20, { 5: 'fixture_sta', '05': 'fixture_str' } as never).ok).toBe(
      false,
    );

    CHOICE_ROWS[cls] = { rows: [] };
    expect(validateRows(cls, 20, { 5: 'fixture_sta' }).ok).toBe(false);
  });

  it('drops invalid picks during repair', () => {
    withRows();
    expect(
      repairRows(cls, 20, {
        5: 'fixture_sta',
        8: 'missing',
        11: '',
      }),
    ).toEqual({ 5: 'fixture_sta' });
  });

  it('validates rows as part of the whole allocation', () => {
    withRows();
    expect(validateAllocation(cls, alloc({ rows: { 5: 'fixture_sta' } }), 0, 5).ok).toBe(true);
    expect(validateAllocation(cls, alloc({ rows: { 5: 'fixture_sta' } }), 0, 4).ok).toBe(false);
    expect(validateAllocation(cls, alloc({ rows: { 5: 'missing' } }), 0, 20).ok).toBe(false);
  });

  it('repairs stale allocation rows on load', () => {
    withRows();
    const repaired = repairAllocation(
      cls,
      alloc({ rows: { 5: 'fixture_sta', 8: 'missing' } }),
      0,
      20,
    );
    expect(repaired.rows).toEqual({ 5: 'fixture_sta' });
  });

  it('round-trips rows through build strings', () => {
    const imported = importBuild(exportBuild(cls, alloc({ rows: { 5: 'fixture_sta' } })));
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(imported.alloc.rows).toEqual({ 5: 'fixture_sta' });
  });
});

describe('choice row effects and sim facade', () => {
  it('folds fixture option effects into baked talent modifiers and recalculated stats', () => {
    withRows();
    const mods = computeTalentModifiers(cls, alloc({ rows: { 5: 'fixture_sta' } }));
    expect(mods.stats.sta).toBe(10);

    const sim = simAtCap();
    const before = sim.player.stats.sta;
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(true);
    expect(sim.talents.rows).toEqual({ 5: 'fixture_sta' });
    expect(sim.player.stats.sta).toBe(before + 10);
  });

  it('applies and resets rows through the Sim facade with combat and arena locks', () => {
    withRows();
    const sim = simAtCap();
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(true);
    expect(sim.resetRows()).toBe(true);
    expect(sim.talents.rows).toEqual({});

    sim.player.inCombat = true;
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(false);
    sim.player.inCombat = false;

    sim.arenaMatches.set(sim.playerId, {} as never);
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(false);
    expect(sim.resetRows()).toBe(false);
  });

  it('round-trips rows through persistence and saved loadouts', () => {
    withRows();
    const sim = simAtCap();
    expect(sim.chooseRow(5, 'fixture_sta')).toBe(true);
    expect(sim.saveLoadout('Rows', [])).toBe(0);
    expect(sim.resetRows()).toBe(true);
    expect(sim.switchLoadout(0)).toBe(true);
    expect(sim.talents.rows).toEqual({ 5: 'fixture_sta' });
    expect(sim.loadouts[0].alloc.rows).toEqual({ 5: 'fixture_sta' });

    const state = sim.serializeCharacter(sim.playerId);
    expect(state).not.toBeNull();
    if (!state) throw new Error('expected serialized character state');
    const restored = new Sim({ seed: 456, playerClass: cls, noPlayer: true });
    const pid = restored.addPlayer(cls, 'Restored', { state });
    expect(restored.meta(pid)?.talents.rows).toEqual({ 5: 'fixture_sta' });
    expect(restored.meta(pid)?.loadouts[0].alloc.rows).toEqual({ 5: 'fixture_sta' });
  });

  it('ships dormant empty rows for every class', () => {
    for (const playerClass of ALL_CLASSES) {
      if ((PR5_CLASSES as readonly PlayerClass[]).includes(playerClass)) continue;
      expect(CHOICE_ROWS[playerClass].rows).toEqual([]);
      expect(validateRows(playerClass, 20, { 5: 'anything' }).ok).toBe(false);
    }
  });
});

describe('choice row real content for PR5 classes', () => {
  it('ships exactly six rows and three options per row for the PR5 classes', () => {
    for (const playerClass of PR5_CLASSES) {
      const rows = CHOICE_ROWS[playerClass].rows;
      expect(rows.map((row) => row.level)).toEqual([...CHOICE_ROW_LEVELS]);
      for (const row of rows) expect(row.options).toHaveLength(3);
    }
  });

  it('has resolvable effects for every PR5 option', () => {
    for (const playerClass of PR5_CLASSES) {
      for (const row of CHOICE_ROWS[playerClass].rows) {
        for (const option of row.options) {
          if (option.effect.grant) {
            expect(ABILITIES[option.effect.grant.ability], option.id).toBeDefined();
          }
          for (const abilityMod of option.effect.ability ?? []) {
            expect(ABILITIES[abilityMod.ability], option.id).toBeDefined();
          }
        }
      }
    }
  });

  it('grants every granted PR5 row ability through the sim facade', () => {
    for (const playerClass of PR5_CLASSES) {
      for (const row of CHOICE_ROWS[playerClass].rows) {
        for (const option of row.options) {
          const grant = option.effect.grant?.ability;
          if (!grant) continue;
          const sim = new Sim({ seed: 987, playerClass });
          sim.setPlayerLevel(MAX_LEVEL);
          expect(sim.resolvedAbility(grant), `${option.id} should not be known before pick`).toBe(
            null,
          );
          expect(sim.chooseRow(row.level, option.id)).toBe(true);
          expect(sim.resolvedAbility(grant), `${option.id} should grant ${grant}`).not.toBeNull();
        }
      }
    }
  });

  it('lands authored mod numbers in resolved abilities', () => {
    const warrior = simAtLevel('warrior', MAX_LEVEL);
    const baseCharge = expectResolved(warrior, 'charge');
    expect(warrior.chooseRow(5, 'war_r5_juggernaut')).toBe(true);
    expect(expectResolved(warrior, 'charge').cooldown).toBe(baseCharge.cooldown * 0.5);

    const mage = simAtLevel('mage', MAX_LEVEL);
    const baseFireBlast = expectResolved(mage, 'fire_blast');
    expect(mage.chooseRow(5, 'mag_r5_impulse')).toBe(true);
    expect(expectResolved(mage, 'fire_blast').cooldown).toBe(baseFireBlast.cooldown * 0.5);
  });

  it('lands P5 addEffects row options in resolved abilities', () => {
    const warbringer = simAtLevel('warrior', MAX_LEVEL);
    expect(warbringer.chooseRow(5, 'war_r5_warbringer')).toBe(true);
    expect(expectResolved(warbringer, 'charge').effects).toContainEqual({
      type: 'root',
      duration: 1.5,
    });

    const concussiveClap = simAtLevel('warrior', MAX_LEVEL);
    expect(concussiveClap.chooseRow(8, 'war_r8_concussive_clap')).toBe(true);
    expect(expectResolved(concussiveClap, 'thunder_clap').effects).toContainEqual({
      type: 'aoeRoot',
      duration: 1,
      radius: 8,
      min: 0,
      max: 0,
    });
  });

  it('lands Iron Hide armor in recalc and Shatter crit in player mods', () => {
    const warrior = simAtLevel('warrior', MAX_LEVEL);
    const armorBefore = warrior.player.stats.armor;
    expect(warrior.chooseRow(17, 'war_r17_iron_hide')).toBe(true);
    expect(warrior.player.stats.armor).toBeCloseTo(Math.round(armorBefore * 1.12), 0);

    const mage = simAtLevel('mage', MAX_LEVEL);
    expect(mage.chooseRow(11, 'mag_r11_shatter')).toBe(true);
    const meta = mage.meta(mage.playerId);
    expect(meta).not.toBeNull();
    if (!meta) throw new Error('missing mage meta');
    const mods = (
      mage as never as {
        playerMods(m: NonNullable<typeof meta>): { global: { critVsRooted: number } };
      }
    ).playerMods(meta);
    expect(mods.global.critVsRooted).toBeCloseTo(0.3);
  });

  it('makes Scorch castable while moving through Firestarter', () => {
    const mage = simAtLevel('mage', MAX_LEVEL);
    expect(expectResolved(mage, 'scorch').castWhileMoving).toBeUndefined();
    expect(mage.chooseRow(5, 'mag_r5_firestarter')).toBe(true);
    expect(expectResolved(mage, 'scorch').castWhileMoving).toBe(true);
  });

  it('lands representative Wave B1 mod numbers in resolved abilities', () => {
    const paladin = simAtLevel('paladin', MAX_LEVEL);
    const baseJudgement = expectResolved(paladin, 'judgement');
    expect(paladin.chooseRow(5, 'pal_r5_crusaders_zeal')).toBe(true);
    expect(expectResolved(paladin, 'judgement').cooldown).toBeCloseTo(baseJudgement.cooldown * 0.6);

    const hunter = simAtLevel('hunter', MAX_LEVEL);
    const baseArcaneShot = expectResolved(hunter, 'arcane_shot');
    expect(hunter.chooseRow(5, 'hun_r5_quick_shots')).toBe(true);
    expect(expectResolved(hunter, 'arcane_shot').cooldown).toBeCloseTo(
      baseArcaneShot.cooldown * 0.6,
    );

    const rogue = simAtLevel('rogue', MAX_LEVEL);
    const baseSinister = expectResolved(rogue, 'sinister_strike');
    expect(rogue.chooseRow(5, 'rog_r5_relentless_strikes')).toBe(true);
    expect(expectResolved(rogue, 'sinister_strike').cost).toBe(Math.round(baseSinister.cost * 0.8));

    const priest = simAtLevel('priest', MAX_LEVEL);
    const baseMindBlast = expectResolved(priest, 'mind_blast');
    expect(priest.chooseRow(14, 'pri_r14_mind_melt')).toBe(true);
    expect(expectResolved(priest, 'mind_blast').cooldown).toBeCloseTo(baseMindBlast.cooldown * 0.6);
  });

  it('lands representative Wave B1 stats and P5 effects', () => {
    const hunter = simAtLevel('hunter', MAX_LEVEL);
    const dodgeBefore = hunter.player.dodgeChance;
    expect(hunter.chooseRow(11, 'hun_r11_survival_instincts')).toBe(true);
    expect(hunter.player.dodgeChance).toBeCloseTo(dodgeBefore + 0.02);

    const serpent = simAtLevel('hunter', MAX_LEVEL);
    expect(serpent.chooseRow(14, 'hun_r14_serpents_venom')).toBe(true);
    expect(expectResolved(serpent, 'arcane_shot').effects).toContainEqual({
      type: 'dot',
      total: 24,
      duration: 6,
      interval: 2,
    });

    const priest = simAtLevel('priest', MAX_LEVEL);
    const spiritBefore = priest.player.stats.spi;
    expect(priest.chooseRow(17, 'pri_r17_inner_fire')).toBe(true);
    expect(priest.player.stats.spi).toBe(spiritBefore + 3);
  });

  it('defines every new PR5 interrupt as a physical-school interrupt', () => {
    for (const id of ['rebuke', 'counter_shot', 'kick'] as const) {
      const def = ABILITIES[id];
      expect(def.school, id).toBe('physical');
      expect(def.effects, id).toContainEqual({ type: 'interrupt', lockout: 4 });
    }
  });
});

function simAtLevel(playerClass: PlayerClass, level: number): Sim {
  const sim = new Sim({ seed: 654, playerClass });
  sim.setPlayerLevel(level);
  return sim;
}

function expectResolved(sim: Sim, abilityId: string) {
  const resolved = sim.resolvedAbility(abilityId);
  expect(resolved, `${abilityId} should resolve`).not.toBeNull();
  if (!resolved) throw new Error(`${abilityId} should resolve`);
  return resolved;
}
