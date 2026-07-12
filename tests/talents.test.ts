import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import {
  CHOICE_ROW_LEVELS,
  CHOICE_ROWS,
  type ChoiceRowAllocation,
} from '../src/sim/content/choice_rows';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import {
  cloneAllocation,
  computeTalentModifiers,
  emptyAllocation,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  MAX_LOADOUTS,
  repairAllocation,
  TALENT_BUILD_VERSION,
  TALENTS,
  type TalentAllocation,
  talentsFor,
  validateAllocation,
  validateTalentTree,
} from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, MAX_LEVEL, type PlayerClass } from '../src/sim/types';

const CLASSES = ALL_CLASSES as readonly PlayerClass[];

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  spec: null,
  rows: {},
  ...over,
});

const rowOption = (cls: PlayerClass, rowIndex: number, optionIndex = 0): string =>
  CHOICE_ROWS[cls].rows[rowIndex].options[optionIndex].id;

const unlockedRowsAt = (level: number): number =>
  CHOICE_ROW_LEVELS.filter((rowLevel) => rowLevel <= level).length;

const pickedRows = (rows: ChoiceRowAllocation): number => Object.keys(rows).length;

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function decodeBuildPayload(str: string): unknown {
  return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
}

const effOf = (k: any, i = 0) => k.effects[i] as any;

describe('talent content registration', () => {
  it('keeps every registered class talent table structurally valid', () => {
    for (const ct of Object.values(TALENTS)) {
      expect(ct).toBeTruthy();
      expect(validateTalentTree(ct!)).toEqual([]);
    }
  });

  it('registers all playable classes with three specs and six choice rows', () => {
    for (const cls of CLASSES) {
      const ct = talentsFor(cls);
      expect(ct, cls).toBeTruthy();
      expect(ct!.specs, cls).toHaveLength(3);
      expect(
        CHOICE_ROWS[cls].rows.map((row) => row.level),
        cls,
      ).toEqual(CHOICE_ROW_LEVELS);
      for (const row of CHOICE_ROWS[cls].rows)
        expect(row.options, `${cls}:${row.level}`).toHaveLength(3);
    }
  });

  it('references only abilities that exist from specs, masteries, and choice rows', () => {
    const checkEffect = (id: string, effect: any) => {
      if (effect?.grant)
        expect(ABILITIES[effect.grant.ability], `${id}:${effect.grant.ability}`).toBeTruthy();
      for (const mod of effect?.ability ?? []) {
        expect(ABILITIES[mod.ability], `${id}:${mod.ability}`).toBeTruthy();
      }
    };

    for (const cls of CLASSES) {
      const ct = talentsFor(cls)!;
      for (const spec of ct.specs) {
        expect(ABILITIES[spec.signature], `${cls}:${spec.id}:${spec.signature}`).toBeTruthy();
        checkEffect(`${cls}:${spec.id}:mastery`, spec.mastery.effect);
      }
      for (const row of CHOICE_ROWS[cls].rows) {
        for (const option of row.options)
          checkEffect(`${cls}:${row.level}:${option.id}`, option.effect);
      }
    }
  });
});

describe('allocation contract', () => {
  it('emptyAllocation and cloneAllocation expose only spec plus rows', () => {
    const empty = emptyAllocation();
    expect(empty).toEqual({ spec: null, rows: {} });
    expect('ranks' in empty).toBe(false);
    expect('choices' in empty).toBe(false);

    const original = alloc({ spec: 'arms', rows: { 5: rowOption('warrior', 0) } });
    const cloned = cloneAllocation(original);
    cloned.rows[5] = rowOption('warrior', 0, 1);
    expect(original.rows[5]).toBe(rowOption('warrior', 0));
    expect(cloned).toEqual({ spec: 'arms', rows: { 5: rowOption('warrior', 0, 1) } });
  });

  it('validates known specs, first-talent-level spec gates, and row ownership', () => {
    const r5 = rowOption('warrior', 0);
    const r20 = rowOption('warrior', 5);
    expect(validateAllocation('warrior', alloc({ rows: { 5: r5 } }), 5).ok).toBe(true);
    expect(validateAllocation('warrior', alloc({ spec: 'arms' }), FIRST_TALENT_LEVEL - 1).ok).toBe(
      false,
    );
    expect(validateAllocation('warrior', alloc({ spec: 'arms' }), FIRST_TALENT_LEVEL).ok).toBe(
      true,
    );
    expect(validateAllocation('warrior', alloc({ spec: 'nope' }), MAX_LEVEL).ok).toBe(false);
    expect(validateAllocation('warrior', alloc({ rows: { 20: r20 } }), 19).ok).toBe(false);
    expect(validateAllocation('warrior', alloc({ rows: { 5: rowOption('mage', 0) } }), 5).ok).toBe(
      false,
    );
  });

  it('repairs rows, keeps legal specs, and silently drops legacy ranks and choices', () => {
    const legacy = {
      spec: 'arms',
      rows: { 5: rowOption('warrior', 0), 8: 'not_a_warrior_option', 20: rowOption('warrior', 5) },
      ranks: { war_cruelty: 3 },
      choices: { war_tactical_choice: 'tc_cruelty' },
    } as TalentAllocation;

    const repaired = repairAllocation('warrior', legacy, MAX_LEVEL);
    expect(repaired).toEqual({
      spec: 'arms',
      rows: { 5: rowOption('warrior', 0), 20: rowOption('warrior', 5) },
    });
    expect('ranks' in repaired).toBe(false);
    expect('choices' in repaired).toBe(false);
  });

  it('drops a spec committed below SPEC_UNLOCK_LEVEL and any not-yet-unlocked row picks', () => {
    // Under the warrior overhaul a spec is legal from SPEC_UNLOCK_LEVEL (5), which
    // coincides with the first choice-row level, so below it both the spec and the
    // not-yet-unlocked row picks are stripped.
    const repaired = repairAllocation(
      'warrior',
      alloc({ spec: 'arms', rows: { 5: rowOption('warrior', 0), 8: rowOption('warrior', 1) } }),
      4,
    );
    expect(repaired).toEqual({
      spec: null,
      rows: {},
    });
  });
});

describe('precomputed modifiers', () => {
  it('grants the spec signature ability and scales mastery by level', () => {
    const half = computeTalentModifiers('warrior', alloc({ spec: 'arms' }), 10);
    const full = computeTalentModifiers('warrior', alloc({ spec: 'arms' }), 20);
    expect(half.spec).toBe('arms');
    expect(half.role).toBe('dps');
    expect(half.grants.some((g) => g.ability === 'mortal_strike')).toBe(true);
    // Arms mastery (Master Armorer) is a two-handed damage bonus of 0.1 at max level,
    // scaled by min(1, level/20): 0.05 at level 10, 0.1 at level 20.
    expect(half.global.masteryTwoHandDmgPct).toBeCloseTo(0.05);
    expect(full.global.masteryTwoHandDmgPct).toBeCloseTo(0.1);
  });

  it('accumulates only spec and choice-row effects, ignoring legacy rank fields', () => {
    const legacyRanks = { war_cruelty: 3 };
    const mods = computeTalentModifiers(
      'warrior',
      { spec: null, rows: { 5: rowOption('warrior', 0) }, ranks: legacyRanks } as TalentAllocation,
      20,
    );
    expect(mods.stats.crit).toBe(0);
    expect(mods.abilities.charge.bonusCharges).toBe(1);
  });

  it('folds row grants into the known ability set without a spec', () => {
    const leap = computeTalentModifiers(
      'warrior',
      alloc({ rows: { 8: rowOption('warrior', 1, 0) } }),
      20,
    );
    expect(leap.grants.some((g) => g.ability === 'spell_reflect')).toBe(true);
    expect(leap.grants.some((g) => g.ability === 'mortal_strike')).toBe(false);
  });

  it('applies ability modifiers to shields, buffs, and imbues from specs and rows', () => {
    const shield = abilitiesKnownAt(
      'priest',
      10,
      computeTalentModifiers('priest', alloc({ spec: 'discipline' }), 10),
    ).find((k) => k.def.id === 'power_word_shield')!;
    // 48 base * (1 + absorbPct 0.3 * the level-10 mastery scaling of 0.5) = 55:
    // masteries reach full strength at 20 (min(1, level/20) in accumulate).
    expect(effOf(shield).amount).toBe(55);

    const fort = abilitiesKnownAt(
      'priest',
      20,
      computeTalentModifiers('priest', alloc({ rows: { 17: 'pri_r17_improved_fortitude' } }), 20),
    ).find((k) => k.def.id === 'power_word_fortitude')!;
    expect(effOf(fort).value).toBeGreaterThan(
      effOf(abilitiesKnownAt('priest', 20).find((k) => k.def.id === 'power_word_fortitude')!).value,
    );

    const seal = abilitiesKnownAt(
      'paladin',
      20,
      computeTalentModifiers('paladin', alloc({ spec: 'retribution' }), 20),
    ).find((k) => k.def.id === 'seal_of_righteousness')!;
    expect(effOf(seal).bonus).toBeGreaterThan(0);
  });
});

describe('build strings', () => {
  it('uses v2 payloads with class, spec, and rows only', () => {
    expect(TALENT_BUILD_VERSION).toBe(2);
    const a = alloc({
      spec: 'prot',
      rows: { 5: rowOption('warrior', 0), 20: rowOption('warrior', 5) },
    });
    const str = exportBuild('warrior', a);
    expect(decodeBuildPayload(str)).toEqual({
      v: 2,
      c: 'warrior',
      s: 'prot',
      w: { 5: rowOption('warrior', 0), 20: rowOption('warrior', 5) },
    });
    const imported = importBuild(str);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.cls).toBe('warrior');
      expect(imported.alloc).toEqual(a);
    }
  });

  it('rejects malformed strings and non-v2 payloads', () => {
    expect(importBuild('not-base64-$$$').ok).toBe(false);
    expect(importBuild('').ok).toBe(false);
    const v1 = Buffer.from(
      JSON.stringify({ v: 1, c: 'warrior', s: 'arms', r: {}, h: {}, w: {} }),
    ).toString('base64');
    expect(importBuild(v1)).toEqual({ ok: false, reason: 'incompatible build version' });
  });

  it('drops legacy rank and choice payload fields on import', () => {
    const payload = Buffer.from(
      JSON.stringify({
        v: 2,
        c: 'warrior',
        s: 'arms',
        r: { war_cruelty: 3 },
        h: { war_tactical_choice: 'tc_cruelty' },
        w: { 5: rowOption('warrior', 0) },
      }),
    ).toString('base64');
    const imported = importBuild(payload);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.alloc).toEqual({ spec: 'arms', rows: { 5: rowOption('warrior', 0) } });
      expect('ranks' in imported.alloc).toBe(false);
      expect('choices' in imported.alloc).toBe(false);
    }
  });
});

describe('Sim integration', () => {
  it('reports talent points as unlocked rows and picked rows', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(7);
    expect(sim.talentPoints()).toEqual({ total: unlockedRowsAt(7), spent: 0 });
    expect(sim.applyTalents(alloc({ rows: { 5: rowOption('warrior', 0) } }))).toBe(true);
    expect(sim.talentPoints()).toEqual({ total: 1, spent: 1 });
    sim.setPlayerLevel(20);
    expect(sim.talentPoints()).toEqual({ total: 6, spent: 1 });
  });

  it('gates specialization choice to the first talent level', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(FIRST_TALENT_LEVEL - 1);
    expect(sim.setSpec('arms')).toBe(false);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false);
    sim.setPlayerLevel(FIRST_TALENT_LEVEL);
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true);
  });

  it('applies, persists, and reloads spec plus row allocations', () => {
    const sim = warriorAtCap();
    const build = alloc({
      spec: 'arms',
      rows: { 8: rowOption('warrior', 1, 0), 20: rowOption('warrior', 5, 1) },
    });
    expect(sim.applyTalents(build)).toBe(true);
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.talents).toEqual(build);

    const sim2 = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Reloaded', { state });
    const meta = sim2.meta(pid)!;
    expect(meta.talents).toEqual(build);
    expect(meta.talentMods.spec).toBe('arms');
    expect(meta.talentMods.grants.some((g) => g.ability === 'spell_reflect')).toBe(true);
    expect(meta.talentMods.grants.some((g) => g.ability === 'bladestorm')).toBe(true);
  });

  it('locks allocation and loadout switching in combat', () => {
    const sim = warriorAtCap();
    expect(sim.applyTalents(alloc({ spec: 'arms' }))).toBe(true);
    expect(sim.saveLoadout('Arms', ['mortal_strike'], alloc({ spec: 'arms' }))).toBe(0);
    sim.player.inCombat = true;
    expect(sim.applyTalents(alloc({ spec: 'prot' }))).toBe(false);
    expect(sim.respec()).toBe(false);
    expect(sim.switchLoadout(0)).toBe(false);
    expect(sim.talents.spec).toBe('arms');
  });
});

describe('loadouts and build-string application', () => {
  it('saves and switches loadouts, restoring spec, rows, and action bar', () => {
    const sim = warriorAtCap();
    const arms = alloc({ spec: 'arms', rows: { 8: rowOption('warrior', 1, 0) } });
    const prot = alloc({
      spec: 'prot',
      rows: { 5: rowOption('warrior', 0), 17: rowOption('warrior', 4) },
    });

    expect(sim.saveLoadout('Arms PvE', ['mortal_strike', 'spell_reflect', null], arms)).toBe(0);
    expect(sim.saveLoadout('Prot Tank', ['shield_slam', 'shield_wall'], prot)).toBe(1);
    expect(sim.loadouts.length).toBe(2);
    expect(sim.talents).toEqual(prot);
    expect(sim.activeLoadout).toBe(1);

    expect(sim.switchLoadout(0)).toBe(true);
    expect(sim.talents).toEqual(arms);
    expect(sim.talentSpec).toBe('arms');
    expect(sim.activeLoadout).toBe(0);
    expect(sim.loadouts[0].bar).toEqual(['mortal_strike', 'spell_reflect', null]);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'spell_reflect')).toBe(true);
  });

  it('deletes a loadout, repairs the active index, and caps loadout count', () => {
    const sim = warriorAtCap();
    sim.saveLoadout('one', [], alloc({ spec: 'arms', rows: { 5: rowOption('warrior', 0) } }));
    sim.saveLoadout('two', [], alloc({ spec: 'prot', rows: { 5: rowOption('warrior', 0, 1) } }));
    expect(sim.activeLoadout).toBe(1);
    expect(sim.deleteLoadout(0)).toBe(true);
    expect(sim.loadouts).toHaveLength(1);
    expect(sim.loadouts[0].name).toBe('two');
    expect(sim.activeLoadout).toBe(0);
    expect(sim.talents).toEqual(alloc({ spec: 'prot', rows: { 5: rowOption('warrior', 0, 1) } }));

    const full = warriorAtCap(12);
    for (let i = 0; i < MAX_LOADOUTS; i++) expect(full.saveLoadout(`L${i}`, [])).toBe(i);
    expect(full.saveLoadout('overflow', [])).toBe(-1);
  });

  it('imports a build string and revalidates it server-side on apply', () => {
    const author = warriorAtCap();
    const build = alloc({
      spec: 'prot',
      rows: { 5: rowOption('warrior', 0), 20: rowOption('warrior', 5) },
    });
    expect(author.applyTalents(build)).toBe(true);
    const imported = importBuild(exportBuild('warrior', author.talents));
    expect(imported.ok).toBe(true);

    const target = warriorAtCap(11);
    if (imported.ok) expect(target.applyTalents(imported.alloc)).toBe(true);
    expect(target.talents).toEqual(build);

    const lowbie = new Sim({ seed: 5, playerClass: 'warrior' });
    lowbie.setPlayerLevel(10);
    expect(lowbie.applyTalents(imported.ok ? imported.alloc : alloc())).toBe(false);
  });
});

describe('ClientWorld wire path', () => {
  function bareClient(pid: number): any {
    const c: any = Object.create(ClientWorld.prototype);
    c.cfg = { seed: 20061, playerClass: 'warrior' };
    c.entities = new Map();
    c.playerId = pid;
    c.moveInput = {};
    c.inventory = [];
    c.equipment = {};
    c.copper = 0;
    c.xp = 0;
    c.known = [];
    c.questLog = new Map();
    c.questsDone = new Set();
    c.lastSnapAt = 0;
    c.snapInterval = 50;
    c.pendingFacingDelta = 0;
    c.connected = true;
    c.eventQueue = [];
    c.mouselookFacing = null;
    return c;
  }

  const selfWire = (over: any = {}) => ({
    id: 1,
    k: 'player',
    tid: 'warrior',
    nm: 'Tank',
    lv: 20,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    res: 0,
    mres: 100,
    rtype: 'rage',
    xp: 0,
    copper: 0,
    inv: [],
    equip: {},
    qlog: [],
    qdone: [],
    cds: {},
    gcd: 0,
    stats: { str: 1, agi: 1, sta: 1, int: 1, spi: 1, armor: 0 },
    weapon: { min: 1, max: 2, speed: 2 },
    ...over,
  });

  it('decodes the talent snapshot field and recomputes known from spec plus rows', () => {
    const c = bareClient(1);
    const snapshotAlloc = alloc({
      spec: 'prot',
      rows: { 8: rowOption('warrior', 1, 0), 17: rowOption('warrior', 4) },
    });
    c.applySnapshot({
      t: 'snap',
      tick: 1,
      time: 0,
      ents: [],
      self: selfWire({
        tal: {
          alloc: snapshotAlloc,
          spec: 'prot',
          role: 'tank',
          loadouts: [{ name: 'MT', alloc: emptyAllocation(), bar: [] }],
          activeLoadout: 0,
        },
      }),
    });
    expect(c.talents).toEqual(snapshotAlloc);
    expect(c.talentSpec).toBe('prot');
    expect(c.talentRole).toBe('tank');
    expect(c.loadouts.length).toBe(1);
    expect(c.activeLoadout).toBe(0);
    expect(c.known.some((k: any) => k.def.id === 'shield_slam')).toBe(true);
    expect(c.known.some((k: any) => k.def.id === 'spell_reflect')).toBe(true);
    expect(c.known.some((k: any) => k.def.id === 'reckless_vow')).toBe(true);
    expect(c.talentPoints()).toEqual({ total: 6, spent: pickedRows(snapshotAlloc.rows) });
  });

  it('rebuilds known ability cost/effects when the talent snapshot changes (online tooltip refresh)', () => {
    // Regression: the online client derives its known-ability list (and thus every
    // ability tooltip's cost / cooldown / effect text) from the `tal` snapshot field.
    // A talent that lowers an ability's cost (Crippling Strikes: Hamstring costs 66%
    // less) must be reflected in the client's known list once the new allocation
    // arrives, or the tooltip shows a stale cost.
    const c = bareClient(1);
    // First snapshot: no talents. Hamstring reads its base cost.
    c.applySnapshot({
      t: 'snap',
      tick: 1,
      time: 0,
      ents: [],
      self: selfWire({ tal: { alloc: emptyAllocation(), spec: null, role: null, loadouts: [] } }),
    });
    const baseCost = c.known.find((k: any) => k.def.id === 'hamstring')?.cost;
    expect(baseCost).toBeGreaterThan(0);
    // Second snapshot: Crippling Strikes picked. The derived cost must drop.
    c.applySnapshot({
      t: 'snap',
      tick: 2,
      time: 0,
      ents: [],
      self: selfWire({
        tal: {
          alloc: alloc({ rows: { 8: 'war_r8_crippling_strikes' } }),
          spec: null,
          role: null,
          loadouts: [],
        },
      }),
    });
    const moddedCost = c.known.find((k: any) => k.def.id === 'hamstring')?.cost;
    expect(moddedCost).toBe(Math.round(baseCost * (1 - 0.66)));
    expect(moddedCost).toBeLessThan(baseCost);
  });
});

describe('talent change wire refresh', () => {
  it('bumps the player wireRev on every live allocation change so online clients re-pull tal', () => {
    // The server only re-sends the heavy `tal` snapshot field (which the online client
    // rebuilds its known-ability list + tooltips from) when the player's wireRev advances
    // or the periodic backstop fires. recomputeTalents is the single choke point every live
    // talent change flows through, so it must bump wireRev, mirroring the Vale Cup / fiesta
    // kit swaps. Guards against a talent-mutating path leaving stale online tooltips.
    const sim = warriorAtCap();
    const meta = sim.players.get(sim.playerId)!;
    const before = meta.wireRev;
    expect(sim.applyTalents(alloc({ rows: { 8: 'war_r8_crippling_strikes' } }))).toBe(true);
    expect(meta.wireRev).toBeGreaterThan(before);
    const afterApply = meta.wireRev;
    expect(sim.saveLoadout('Build', ['mortal_strike'], alloc({ spec: 'arms' }))).toBe(0);
    expect(meta.wireRev).toBeGreaterThan(afterApply);
  });
});
