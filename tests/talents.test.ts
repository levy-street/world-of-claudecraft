import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  type ClassTalents,
  cloneAllocation,
  computeTalentModifiers,
  defaultBuild,
  emptyAllocation,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  MAX_LOADOUTS,
  OPTIONS_PER_ROW,
  ROW_COUNT,
  ROW_LEVELS,
  ROW_TREES,
  type RowTree,
  repairAllocation,
  rowForLevel,
  rowsPicked,
  rowTreeFor,
  sanitizeAllocation,
  TALENT_BUILD_VERSION,
  TALENTS,
  type TalentAllocation,
  type TalentEffect,
  type TalentRowLevel,
  talentsFor,
  validateAllocation,
  validateRowTree,
  validateTalentTree,
} from '../src/sim/content/talents';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import { talentRowOptionIconRef } from '../src/ui/talent_icons';

// 'personal_barrier' is the shieldConsumed SLOT sentinel (combat/talent_procs.ts):
// it resolves at runtime to whichever personal barrier the spec provides.
const SYNTHETIC_CAST_IDS = new Set(['auto_shot', 'personal_barrier']);

function allocation(
  spec: string | null = null,
  rows: Partial<Record<TalentRowLevel, string>> = {},
): TalentAllocation {
  return { spec, rows: { ...rows } };
}

function requiredTalents(cls: PlayerClass): ClassTalents {
  const talents = talentsFor(cls);
  if (!talents) throw new Error(`Missing talents for ${cls}`);
  return talents;
}

function requiredTree(cls: PlayerClass): RowTree {
  const tree = rowTreeFor(cls);
  if (!tree) throw new Error(`Missing row tree for ${cls}`);
  return tree;
}

function optionId(cls: PlayerClass, level: TalentRowLevel, index = 0): string {
  const option = rowForLevel(cls, level)?.options[index];
  if (!option) throw new Error(`Missing ${cls} level-${level} option ${index}`);
  return option.id;
}

function requiredMeta(sim: Sim, pid = sim.playerId): PlayerMeta {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`Missing player metadata for ${pid}`);
  return meta;
}

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function effectAbilityReferences(effect: TalentEffect): string[] {
  const references = [
    ...(effect.grant ? [effect.grant.ability] : []),
    ...(effect.ability ?? []).map((modifier) => modifier.ability),
  ];
  const proc = effect.proc;
  if (!proc) return references;

  const trigger = proc.trigger;
  if (trigger.on === 'castNth') references.push(...trigger.abilities);
  else if (trigger.on === 'spellCrit' && trigger.abilities) references.push(...trigger.abilities);
  else if (
    trigger.on === 'shieldConsumed' ||
    trigger.on === 'hotExpired' ||
    trigger.on === 'thornsReflect'
  ) {
    references.push(trigger.ability);
  }
  for (const response of proc.responses) {
    if (response.kind === 'cooldownRefund') references.push(response.ability);
    if (response.kind === 'empowerNext' && response.abilities) {
      references.push(...response.abilities);
    }
  }
  return references;
}

describe('Talents V2 registry and reachability', () => {
  it('registers exactly nine classes, 27 specs, 54 rows, and 162 options', () => {
    expect(ALL_CLASSES).toHaveLength(9);
    expect(Object.keys(TALENTS).sort()).toEqual([...ALL_CLASSES].sort());
    expect(Object.keys(ROW_TREES).sort()).toEqual([...ALL_CLASSES].sort());

    let specs = 0;
    let rows = 0;
    let options = 0;
    for (const cls of ALL_CLASSES) {
      const talents = requiredTalents(cls);
      const tree = requiredTree(cls);
      expect(validateTalentTree(talents), cls).toEqual([]);
      expect(validateRowTree(tree), cls).toEqual([]);
      expect(talents.specs, cls).toHaveLength(3);
      expect(tree, cls).toHaveLength(ROW_COUNT);
      expect(
        tree.map((row) => row.level),
        cls,
      ).toEqual(ROW_LEVELS);
      expect(
        tree.every((row) => row.options.length === OPTIONS_PER_ROW),
        cls,
      ).toBe(true);
      specs += talents.specs.length;
      rows += tree.length;
      options += tree.reduce((sum, row) => sum + row.options.length, 0);
    }

    expect(specs).toBe(27);
    expect(rows).toBe(54);
    expect(options).toBe(162);
  });

  it('resolves every spec signature and every ability referenced by an active row', () => {
    for (const cls of ALL_CLASSES) {
      for (const spec of requiredTalents(cls).specs) {
        expect(ABILITIES[spec.signature], `${cls}:${spec.id}:${spec.signature}`).toBeTruthy();
      }
      for (const row of requiredTree(cls)) {
        for (const option of row.options) {
          expect(
            Object.keys(option.effect).length,
            `${cls}:${option.id} is inactive`,
          ).toBeGreaterThan(0);
          for (const abilityId of effectAbilityReferences(option.effect)) {
            if (SYNTHETIC_CAST_IDS.has(abilityId)) continue;
            expect(ABILITIES[abilityId], `${cls}:${option.id}:${abilityId}`).toBeTruthy();
          }
        }
      }
    }
  });

  it('derives an ability or procedural crest icon for every active option', () => {
    for (const cls of ALL_CLASSES) {
      for (const row of requiredTree(cls)) {
        for (const option of row.options) {
          const icon = talentRowOptionIconRef(option);
          expect(icon.kind, `${cls}:${option.id}`).toMatch(/^(ability|crest)$/);
          expect(icon.id, `${cls}:${option.id}`).toMatch(/^[a-z0-9_]+$/);
        }
      }
    }
  });

  it('reports duplicate option ids and incorrect unlock levels', () => {
    const source = requiredTree('warrior');
    const first = source[0];
    const broken = [
      {
        ...first,
        level: 8,
        options: [first.options[0], first.options[0], first.options[2]],
      },
      ...source.slice(1),
    ] as unknown as RowTree;
    const errors = validateRowTree(broken);
    expect(errors.some((error) => error.includes('expected 5'))).toBe(true);
    expect(errors.some((error) => error.includes('duplicate option id'))).toBe(true);
  });

  it('reports duplicate specialization ids without a point-tree graph', () => {
    const warrior = requiredTalents('warrior');
    const broken: ClassTalents = {
      class: 'warrior',
      specs: [warrior.specs[0], warrior.specs[0]],
    };
    expect(validateTalentTree(broken)).toContain('duplicate spec id "arms"');
  });
});

describe('canonical allocation, unlocks, and repair', () => {
  it('unlocks one row at levels 5, 8, 11, 14, 17, and 20', () => {
    expect(FIRST_TALENT_LEVEL).toBe(5);
    expect(defaultBuild('warrior', 4)).toEqual(emptyAllocation());
    for (let index = 0; index < ROW_LEVELS.length; index++) {
      const level = ROW_LEVELS[index];
      const build = defaultBuild('warrior', level);
      expect(rowsPicked(build), `level ${level}`).toBe(index + 1);
      expect(validateAllocation('warrior', build, level), `level ${level}`).toEqual({ ok: true });
    }
  });

  it('accepts only the canonical spec/rows shape and unlocked class-owned options', () => {
    const valid = allocation('arms', {
      5: optionId('warrior', 5),
      8: optionId('warrior', 8, 1),
    });
    expect(validateAllocation('warrior', valid, 8)).toEqual({ ok: true });
    expect(validateAllocation('warrior', valid, 7)).toMatchObject({ ok: false });
    expect(
      validateAllocation('warrior', allocation('arms', { 5: optionId('mage', 5) }), 20),
    ).toMatchObject({ ok: false });
    expect(validateAllocation('warrior', allocation('missing'), 20)).toMatchObject({ ok: false });
    expect(
      validateAllocation(
        'warrior',
        { spec: 'arms', rows: {}, ranks: { removed: 1 }, choices: {} },
        20,
      ),
    ).toMatchObject({ ok: false });
  });

  it('keeps one mutually exclusive option per row', () => {
    const first = allocation(null, { 5: optionId('warrior', 5, 0) });
    const second = allocation(null, { 5: optionId('warrior', 5, 1) });
    expect(validateAllocation('warrior', first, 5)).toEqual({ ok: true });
    expect(validateAllocation('warrior', second, 5)).toEqual({ ok: true });
    expect(Object.keys(first.rows)).toEqual(['5']);
    expect(Object.keys(second.rows)).toEqual(['5']);
  });

  it('sanitizes hostile input and repairs stale rows deterministically and idempotently', () => {
    const sanitized = sanitizeAllocation({
      spec: 'arms',
      rows: { 5: optionId('warrior', 5), 8: 4, 9: 'bad', 11: '' },
      ranks: { removed: 5 },
      choices: { removed: 'old' },
    });
    expect(sanitized).toEqual(allocation('arms', { 5: optionId('warrior', 5) }));

    const repaired = repairAllocation(
      'warrior',
      allocation('arms', {
        5: optionId('warrior', 5),
        8: optionId('mage', 8),
        20: optionId('warrior', 20),
      }),
      8,
    );
    expect(repaired).toEqual(allocation('arms', { 5: optionId('warrior', 5) }));
    expect(repairAllocation('warrior', repaired, 8)).toEqual(repaired);
  });

  it('clones row state without sharing a second mutable row model', () => {
    const source = allocation('arms', { 5: optionId('warrior', 5) });
    const copy = cloneAllocation(source);
    copy.rows[8] = optionId('warrior', 8);
    expect(source.rows[8]).toBeUndefined();
    expect(Object.keys(copy).sort()).toEqual(['rows', 'spec']);
  });
});

describe('modifier bake and known-ability resolution', () => {
  it('folds the selected row once and never folds its two alternatives', () => {
    const doubleCharge = computeTalentModifiers(
      'warrior',
      allocation(null, { 5: 'war_row_double_charge' }),
    );
    expect(doubleCharge.abilities.charge?.bonusCharges).toBe(1);
    expect(doubleCharge.global.onKillSpeedPct).toBe(0);

    const pursuit = computeTalentModifiers('warrior', allocation(null, { 5: 'war_row_pursuit' }));
    expect(pursuit.abilities.charge).toBeUndefined();
    expect(pursuit.global.onKillSpeedPct).toBeCloseTo(0.3);
  });

  it('bakes only the winning Warrior spec mastery and signature', () => {
    const arms = computeTalentModifiers('warrior', allocation('arms'));
    expect(arms.grants).toContainEqual({ ability: 'mortal_strike', rank: 1 });
    expect(arms.global.masteryTwoHandDmgPct).toBeCloseTo(0.1);
    expect(arms.global.meleeDmgPct).toBe(0);

    const fury = computeTalentModifiers('warrior', allocation('fury'));
    expect(fury.grants).toContainEqual({ ability: 'bloodthirst', rank: 1 });
    expect(fury.stats.crit).toBeCloseTo(0.05);
    expect(fury.stats.ap).toBe(10);

    const prot = computeTalentModifiers('warrior', allocation('prot'));
    expect(prot.grants).toContainEqual({ ability: 'shield_slam', rank: 1 });
    expect(prot.global.threatPct).toBeCloseTo(0.3);
    expect(prot.stats).toMatchObject({ armorPct: 0.1, staPct: 0.4, armorFromStrPct: 0.7 });
  });

  it('makes every spec signature known at the first unlock level', () => {
    for (const cls of ALL_CLASSES) {
      for (const spec of requiredTalents(cls).specs) {
        const known = abilitiesKnownAt(
          cls,
          FIRST_TALENT_LEVEL,
          computeTalentModifiers(cls, allocation(spec.id), FIRST_TALENT_LEVEL),
        );
        expect(
          known.some((ability) => ability.def.id === spec.signature),
          `${cls}:${spec.id}:${spec.signature}`,
        ).toBe(true);
      }
    }
  });

  it('makes every row-granted ability known when that one option is selected', () => {
    for (const cls of ALL_CLASSES) {
      const spec = requiredTalents(cls).specs[0];
      for (const row of requiredTree(cls)) {
        for (const option of row.options) {
          const granted = option.effect.grant?.ability;
          if (!granted) continue;
          const mods = computeTalentModifiers(cls, allocation(spec.id, { [row.level]: option.id }));
          const known = abilitiesKnownAt(cls, MAX_LEVEL, mods);
          expect(
            known.some((ability) => ability.def.id === granted),
            `${cls}:${option.id}:${granted}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('canonical build strings', () => {
  const capBuild = allocation('arms', {
    5: 'war_row_double_charge',
    8: 'war_row_die_by_the_sword',
    11: 'war_row_storm_bolt',
    14: 'war_row_blood_offering',
    17: 'war_row_avatar',
    20: 'war_row_bladestorm',
  });

  it('round-trips only version, class, spec, and canonical rows', () => {
    const encoded = exportBuild('warrior', capBuild);
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(['c', 'r', 's', 'v']);
    expect(payload.v).toBe(TALENT_BUILD_VERSION);
    expect(importBuild(encoded)).toEqual({ ok: true, cls: 'warrior', alloc: capBuild });
  });

  it('rejects malformed, future-version, legacy, and unknown-class payloads', () => {
    expect(importBuild('')).toMatchObject({ ok: false });
    expect(importBuild('not-base64-$$$')).toMatchObject({ ok: false });
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
    expect(
      importBuild(encode({ v: TALENT_BUILD_VERSION + 1, c: 'warrior', s: 'arms', r: {} })),
    ).toMatchObject({ ok: false });
    expect(
      importBuild(encode({ v: TALENT_BUILD_VERSION, c: 'warrior', s: 'arms', ranks: {} })),
    ).toMatchObject({ ok: false });
    expect(
      importBuild(
        encode({
          v: TALENT_BUILD_VERSION,
          c: ['warrior', 'classic'].join('_'),
          s: null,
          r: {},
        }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe('Sim authoritative Talent V2 integration', () => {
  it('commits a spec at level 5 and applies its signature and mastery immediately', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(4);
    expect(sim.setSpec('fury')).toBe(false);
    expect(sim.known.some((ability) => ability.def.id === 'bloodthirst')).toBe(false);

    sim.setPlayerLevel(FIRST_TALENT_LEVEL);
    const critBefore = sim.player.critChance;
    expect(sim.setSpec('fury')).toBe(true);
    expect(sim.talents.spec).toBe('fury');
    expect(sim.known.some((ability) => ability.def.id === 'bloodthirst')).toBe(true);
    expect(sim.player.critChance).toBeGreaterThan(critBefore);
  });

  it('selects, replaces, and clears one row through the recompute choke point', () => {
    const sim = warriorAtCap();
    const meta = requiredMeta(sim);
    const revBefore = meta.wireRev;

    expect(sim.selectTalentRow(8, 'war_row_die_by_the_sword')).toBe(true);
    expect(sim.talents.rows[8]).toBe('war_row_die_by_the_sword');
    expect(sim.known.some((ability) => ability.def.id === 'die_by_sword')).toBe(true);
    expect(meta.wireRev).toBe(revBefore + 1);

    const selectedRev = meta.wireRev;
    expect(sim.selectTalentRow(8, 'war_row_die_by_the_sword')).toBe(true);
    expect(meta.wireRev).toBe(selectedRev);
    expect(meta.talentMods.grants.filter((grant) => grant.ability === 'die_by_sword')).toHaveLength(
      1,
    );

    expect(sim.selectTalentRow(8, 'war_row_victory_rush')).toBe(true);
    expect(sim.talents.rows[8]).toBe('war_row_victory_rush');
    expect(sim.known.some((ability) => ability.def.id === 'die_by_sword')).toBe(false);
    expect(sim.known.some((ability) => ability.def.id === 'victory_rush')).toBe(true);

    expect(sim.selectTalentRow(8, null)).toBe(true);
    expect(sim.talents.rows[8]).toBeUndefined();
    expect(sim.known.some((ability) => ability.def.id === 'victory_rush')).toBe(false);
  });

  it('rejects locked, unknown, and cross-class row selections', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(5);
    expect(sim.selectTalentRow(8, 'war_row_die_by_the_sword')).toBe(false);
    expect(sim.selectTalentRow(5, 'missing')).toBe(false);
    expect(sim.selectTalentRow(5, optionId('mage', 5))).toBe(false);
    expect(sim.talents).toEqual(emptyAllocation());
  });

  it('preserves class-wide rows across spec switches and clears only rows on respec', () => {
    const sim = warriorAtCap();
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.selectTalentRow(5, 'war_row_double_charge')).toBe(true);
    expect(sim.selectTalentRow(8, 'war_row_die_by_the_sword')).toBe(true);

    expect(sim.setSpec('fury')).toBe(true);
    expect(sim.talents).toEqual(
      allocation('fury', {
        5: 'war_row_double_charge',
        8: 'war_row_die_by_the_sword',
      }),
    );

    expect(sim.respec()).toBe(true);
    expect(sim.talents).toEqual(allocation('fury'));
    expect(sim.known.some((ability) => ability.def.id === 'bloodthirst')).toBe(true);
    expect(sim.known.some((ability) => ability.def.id === 'die_by_sword')).toBe(false);
  });

  it('locks allocations, row changes, specs, loadouts, and respec in combat', () => {
    const sim = warriorAtCap();
    expect(sim.saveLoadout('Safe', [], allocation('arms'))).toBe(0);
    sim.player.inCombat = true;
    expect(sim.applyTalents(allocation('fury'))).toBe(false);
    expect(sim.setSpec('fury')).toBe(false);
    expect(sim.selectTalentRow(5, 'war_row_double_charge')).toBe(false);
    expect(sim.switchLoadout(0)).toBe(false);
    expect(sim.respec()).toBe(false);
    expect(sim.talents).toEqual(allocation('arms'));
  });

  it('persists canonical rows and rebuilds modifiers and known abilities on load', () => {
    const sim = warriorAtCap();
    expect(
      sim.applyTalents(
        allocation('arms', {
          5: 'war_row_double_charge',
          8: 'war_row_die_by_the_sword',
        }),
      ),
    ).toBe(true);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Failed to serialize the Warrior');

    const restored = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Reloaded', { state });
    const meta = requiredMeta(restored, pid);
    expect(meta.talents).toEqual(
      allocation('arms', {
        5: 'war_row_double_charge',
        8: 'war_row_die_by_the_sword',
      }),
    );
    expect(meta.talentMods.abilities.charge?.bonusCharges).toBe(1);
    expect(meta.known.some((ability) => ability.def.id === 'die_by_sword')).toBe(true);
  });

  it('repairs locked persisted rows without guessing replacements', () => {
    const sim = warriorAtCap();
    expect(
      sim.applyTalents(
        allocation('arms', {
          5: 'war_row_double_charge',
          20: 'war_row_bladestorm',
        }),
      ),
    ).toBe(true);
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('Failed to serialize the Warrior');
    state.level = 8;

    const restored = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Repaired', { state });
    expect(requiredMeta(restored, pid).talents).toEqual(
      allocation('arms', { 5: 'war_row_double_charge' }),
    );
  });
});

describe('Sim loadouts and stable hot-path bake', () => {
  it('saves and switches canonical spec/row builds with their action bars', () => {
    const sim = warriorAtCap();
    expect(
      sim.saveLoadout(
        'Arms',
        ['mortal_strike', 'die_by_sword', null],
        allocation('arms', {
          5: 'war_row_double_charge',
          8: 'war_row_die_by_the_sword',
        }),
      ),
    ).toBe(0);
    expect(
      sim.saveLoadout(
        'Protection',
        ['shield_slam', 'victory_rush'],
        allocation('prot', {
          5: 'war_row_pursuit',
          8: 'war_row_victory_rush',
        }),
      ),
    ).toBe(1);
    expect(sim.talents.spec).toBe('prot');
    expect(sim.activeLoadout).toBe(1);

    expect(sim.switchLoadout(0)).toBe(true);
    expect(sim.talents).toEqual(
      allocation('arms', {
        5: 'war_row_double_charge',
        8: 'war_row_die_by_the_sword',
      }),
    );
    expect(sim.loadouts[0].bar).toEqual(['mortal_strike', 'die_by_sword', null]);
    expect(sim.known.some((ability) => ability.def.id === 'mortal_strike')).toBe(true);
    expect(sim.known.some((ability) => ability.def.id === 'die_by_sword')).toBe(true);
  });

  it('deletes loadouts, repairs the active index, and caps the collection', () => {
    const sim = warriorAtCap();
    expect(sim.saveLoadout('one', [], allocation('arms'))).toBe(0);
    expect(sim.saveLoadout('two', [], allocation('prot'))).toBe(1);
    expect(sim.deleteLoadout(0)).toBe(true);
    expect(sim.loadouts.map((loadout) => loadout.name)).toEqual(['two']);
    expect(sim.activeLoadout).toBe(0);
    expect(sim.talents.spec).toBe('prot');

    for (let index = 1; index < MAX_LOADOUTS; index++) {
      expect(sim.saveLoadout(`L${index}`, [])).toBe(index);
    }
    expect(sim.saveLoadout('overflow', [])).toBe(-1);
  });

  it('repairs an untrusted next loadout before auto-applying it on deletion', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(8);
    expect(sim.saveLoadout('Safe', [], allocation('arms', { 5: 'war_row_double_charge' }))).toBe(0);
    const meta = requiredMeta(sim);
    meta.loadouts.push({
      name: 'Tampered',
      alloc: allocation('arms', { 20: 'war_row_bladestorm' }),
      bar: [],
    });
    meta.activeLoadout = 0;

    expect(sim.deleteLoadout(0)).toBe(true);
    expect(meta.talents).toEqual(allocation('arms'));
    expect(validateAllocation('warrior', meta.talents, 8)).toEqual({ ok: true });
  });

  it('keeps the precomputed known set stable across ticks', () => {
    const sim = warriorAtCap();
    expect(sim.applyTalents(allocation('arms', { 8: 'war_row_die_by_the_sword' }))).toBe(true);
    const meta = requiredMeta(sim);
    const known = meta.known;
    const granted = known.find((ability) => ability.def.id === 'die_by_sword');
    expect(granted).toBeTruthy();

    for (let tick = 0; tick < 600; tick++) sim.tick();

    expect(meta.known).toBe(known);
    expect(meta.known.find((ability) => ability.def.id === 'die_by_sword')).toBe(granted);
  });
});

describe('spec switch cancels orphaned form auras', () => {
  it('drops Moonkin Form (and its buffs) when respeccing away from Balance', () => {
    const sim = new Sim({ seed: 11, playerClass: 'druid' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.setSpec('balance')).toBe(true);
    sim.castAbility('moonkin_form', sim.playerId);
    const p = sim.entities.get(sim.playerId)!;
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(true);
    const armorInForm = p.stats.armor;

    expect(sim.setSpec('restoration')).toBe(true);

    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(false);
    expect(p.stats.armor).toBeLessThan(armorInForm);
  });

  it('drops Gloamveil Form when respeccing a priest away from Shadow', () => {
    const sim = new Sim({ seed: 12, playerClass: 'priest' });
    sim.setPlayerLevel(MAX_LEVEL);
    expect(sim.setSpec('shadow')).toBe(true);
    sim.castAbility('shadowform', sim.playerId);
    const p = sim.entities.get(sim.playerId)!;
    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(true);

    expect(sim.setSpec('holy')).toBe(true);

    expect(p.auras.some((a) => a.kind === 'form_shadow')).toBe(false);
  });
});
