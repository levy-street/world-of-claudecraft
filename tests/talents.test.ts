import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import {
  ABILITIES,
  abilitiesKnownAt,
  CLASSES,
  type KnownAbility,
} from '../src/sim/content/classes';
import type { ChoiceRowOption } from '../src/sim/content/talent_rows';
import {
  type ClassTalents,
  computeTalentModifiers,
  dormantNodes,
  emptyAllocation,
  exportBuild,
  FIRST_TALENT_LEVEL,
  importBuild,
  MAX_LOADOUTS,
  pointsSpent,
  repairAllocation,
  TALENT_BUILD_VERSION,
  TALENTS,
  type TalentAllocation,
  type TalentEffect,
  talentPointsAtLevel,
  talentsFor,
  validateAllocation,
  validateTalentTree,
} from '../src/sim/content/talents';
import { WARRIOR_ROWS } from '../src/sim/content/warrior_rows';
import { Sim } from '../src/sim/sim';
import {
  type AbilityEffect,
  ALL_CLASSES,
  dist2d,
  type Entity,
  emptyMoveInput,
  MAX_LEVEL,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import {
  talentChoiceIconRef,
  talentEffectIconRef,
  talentNodeIconRef,
} from '../src/ui/talent_icons';

const alloc = (over: Partial<TalentAllocation> = {}): TalentAllocation => ({
  ...emptyAllocation(),
  ...over,
});

function warriorAtCap(seed = 7): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior' });
  sim.setPlayerLevel(MAX_LEVEL);
  return sim;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  expect(value, message).toBeTruthy();
  if (value == null) throw new Error(message);
  return value;
}

function requireTree(cls: (typeof ALL_CLASSES)[number]): ClassTalents {
  return requireValue(talentsFor(cls), `Missing talent tree for ${cls}`);
}

function requireMeta(sim: Sim, pid: number) {
  return requireValue(sim.meta(pid), `Missing player meta for ${pid}`);
}

function requireKnown(known: readonly KnownAbility[], id: string): KnownAbility {
  return requireValue(
    known.find((k) => k.def.id === id),
    `Missing known ability ${id}`,
  );
}

function nearestMob(sim: Sim): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = dist2d(sim.player.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return requireValue(best, 'Expected a nearby mob');
}

const effOf = (k: Pick<KnownAbility, 'effects'> | undefined, i = 0): AbilityEffect =>
  requireValue(requireValue(k, 'Missing known ability').effects[i], `Missing effect ${i}`);

function effectOfType<TType extends AbilityEffect['type']>(
  k: Pick<KnownAbility, 'effects'> | undefined,
  type: TType,
  i = 0,
): Extract<AbilityEffect, { type: TType }> {
  const effect = effOf(k, i);
  expect(effect.type).toBe(type);
  if (effect.type !== type) {
    throw new Error(`Expected effect type ${type}, got ${effect.type}`);
  }
  return effect as Extract<AbilityEffect, { type: TType }>;
}

// Resolve a spec-gated ability's RAW (unmodified) effects: a grant bypasses the
// spec filter (spec-gating 2026-07-07) without applying any spec mastery, so the
// resolved effect is the pristine base to snapshot against.
const grantMods = (ability: string) => {
  const m = computeTalentModifiers('warrior', alloc());
  m.grants.push({ ability, rank: 1 });
  return m;
};

describe('talent tree validation (load-time)', () => {
  it('every registered tree is structurally valid', () => {
    for (const ct of Object.values(TALENTS)) {
      expect(validateTalentTree(requireValue(ct, 'Missing registered talent tree'))).toEqual([]);
    }
  });

  it('registers all playable classes with populated class and spec trees', () => {
    for (const cls of ALL_CLASSES) {
      const ct = requireTree(cls);
      expect(ct.specs, cls).toHaveLength(3);
      expect(ct.nodes.filter((n) => n.tree === 'class').length, cls).toBeGreaterThanOrEqual(7);
      for (const s of ct.specs) {
        // Arms sits at 5 nodes since the obsolete Improved Brute Swing was
        // removed (Brute Swing is instant now, so its cast-time reduction did
        // nothing); every other spec keeps the 6-node floor.
        const floor = cls === 'warrior' && s.id === 'arms' ? 5 : 6;
        expect(
          ct.nodes.filter((n) => n.tree === 'spec' && n.specId === s.id).length,
          `${cls}:${s.id}`,
        ).toBeGreaterThanOrEqual(floor);
      }
    }
  });

  it('no longer carries the obsolete Improved Brute Swing node (slam is instant)', () => {
    // arms_imp_slam reduced the cast time of slam, which is instant by owner
    // decision, so the node was removed. Nothing may still require it.
    const ct = requireTree('warrior');
    expect(ct.nodes.some((n) => n.id === 'arms_imp_slam')).toBe(false);
    expect(ct.nodes.some((n) => (n.requires ?? []).includes('arms_imp_slam'))).toBe(false);
  });

  it('references only abilities that exist', () => {
    for (const cls of ALL_CLASSES) {
      const ct = requireTree(cls);
      for (const s of ct.specs)
        expect(ABILITIES[s.signature], `${cls}:${s.id}:${s.signature}`).toBeTruthy();
      for (const node of ct.nodes) {
        const effects = [node.effect, ...(node.choices ?? []).map((c) => c.effect)].filter(
          (eff): eff is TalentEffect => Boolean(eff),
        );
        for (const eff of effects) {
          if (eff.grant)
            expect(ABILITIES[eff.grant.ability], `${node.id}:${eff.grant.ability}`).toBeTruthy();
          for (const mod of eff.ability ?? [])
            expect(ABILITIES[mod.ability], `${node.id}:${mod.ability}`).toBeTruthy();
        }
      }
    }
  });

  it('keeps every spec signature grant-only', () => {
    const kitAbilities = new Set<string>();
    for (const cls of ALL_CLASSES) {
      for (const abilityId of CLASSES[cls].abilities) kitAbilities.add(abilityId);
    }

    for (const cls of ALL_CLASSES) {
      const ct = requireTree(cls);
      for (const s of ct.specs) {
        expect(ABILITIES[s.signature], `${cls}:${s.id}:${s.signature}`).toBeTruthy();
        expect(kitAbilities.has(s.signature), `${cls}:${s.id}:${s.signature}`).toBe(false);
      }
    }
  });

  it('derives painted icons for the release v0.7 class talent trees', () => {
    const affected = ['shaman', 'hunter', 'druid', 'paladin', 'rogue', 'mage', 'warlock'] as const;
    for (const cls of affected) {
      const ct = requireTree(cls);
      for (const node of ct.nodes) {
        const nodeIcon = talentNodeIconRef(node);
        expect(nodeIcon.kind, `${cls}:${node.id}`).toMatch(/^(ability|crest)$/);
        expect(nodeIcon.id, `${cls}:${node.id}`).toMatch(/^talent_|^[a-z0-9_]+$/);
        for (const choice of node.choices ?? []) {
          const choiceIcon = talentChoiceIconRef(choice);
          expect(choiceIcon.kind, `${cls}:${node.id}:${choice.id}`).toMatch(/^(ability|crest)$/);
          expect(choiceIcon.id, `${cls}:${node.id}:${choice.id}`).toMatch(/^talent_|^[a-z0-9_]+$/);
        }
      }
    }
  });

  it('maps the warrior Bloodbath row to its custom image-backed icon id', () => {
    const choice = requireValue(
      WARRIOR_ROWS.flatMap((row) => row.options).find((opt) => opt.id === 'war_row_bloodbath'),
      'Missing warrior Bloodbath row',
    );
    expect(talentEffectIconRef(choice.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'bloodbath',
    });
  });

  it('maps the warrior global-only row talents to their custom image-backed icon ids', () => {
    const byId = (id: string): ChoiceRowOption =>
      requireValue(
        WARRIOR_ROWS.flatMap((row) => row.options).find((opt) => opt.id === id),
        `Missing warrior row option ${id}`,
      );
    const secondWind = byId('war_row_second_wind');
    const colossalMight = byId('war_row_colossal_might');
    const pursuit = byId('war_row_pursuit');
    const lingeringDread = byId('war_row_lingering_dread');
    const angerManagement = byId('war_row_anger_management');
    const battleRhythm = byId('war_row_battle_rhythm');
    expect(talentEffectIconRef(secondWind.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'second_wind',
    });
    expect(talentEffectIconRef(colossalMight.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'colossal_might',
    });
    expect(talentEffectIconRef(pursuit.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'pursuit',
    });
    expect(talentEffectIconRef(lingeringDread.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'lingering_dread',
    });
    expect(talentEffectIconRef(angerManagement.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'anger_management',
    });
    expect(talentEffectIconRef(battleRhythm.effect, 'choice')).toEqual({
      kind: 'ability',
      id: 'battle_rhythm',
    });
  });

  it('detects cycles in the requires graph', () => {
    const broken = {
      class: 'warrior' as const,
      specs: requireTree('warrior').specs,
      nodes: [
        {
          id: 'a',
          tree: 'class' as const,
          kind: 'passive' as const,
          maxRank: 1,
          requires: ['b'],
          effect: {},
          icon: '',
          name: 'A',
          description: '',
          row: 1,
          col: 0,
        },
        {
          id: 'b',
          tree: 'class' as const,
          kind: 'passive' as const,
          maxRank: 1,
          requires: ['a'],
          effect: {},
          icon: '',
          name: 'B',
          description: '',
          row: 0,
          col: 0,
        },
      ],
    };
    expect(
      validateTalentTree(broken).some((e) => e.includes('cycle') || e.includes('not above')),
    ).toBe(true);
  });

  it('flags prereqs that reference a missing node', () => {
    const broken = {
      class: 'warrior' as const,
      specs: requireTree('warrior').specs,
      nodes: [
        {
          id: 'a',
          tree: 'class' as const,
          kind: 'passive' as const,
          maxRank: 1,
          requires: ['ghost'],
          effect: {},
          icon: '',
          name: 'A',
          description: '',
          row: 1,
          col: 0,
        },
      ],
    };
    expect(validateTalentTree(broken).some((e) => e.includes('missing node'))).toBe(true);
  });
});

describe('point economy', () => {
  it('grants no points before the first talent level', () => {
    expect(talentPointsAtLevel(FIRST_TALENT_LEVEL - 1)).toBe(0);
    expect(talentPointsAtLevel(1)).toBe(0);
  });
  it('grants one point per level from the first talent level, 11 at cap', () => {
    expect(talentPointsAtLevel(FIRST_TALENT_LEVEL)).toBe(1);
    expect(talentPointsAtLevel(MAX_LEVEL)).toBe(MAX_LEVEL - FIRST_TALENT_LEVEL + 1);
    expect(talentPointsAtLevel(MAX_LEVEL)).toBe(11);
  });
});

describe('allocation rules (server-validated)', () => {
  it('accepts a simple in-budget allocation', () => {
    const a = alloc({ ranks: { war_toughness: 3, war_cruelty: 2 } });
    expect(validateAllocation('warrior', a, 11).ok).toBe(true);
  });

  it('rejects exceeding max rank', () => {
    const a = alloc({ ranks: { war_toughness: 4 } });
    expect(validateAllocation('warrior', a, 11)).toMatchObject({ ok: false });
  });

  it('rejects exceeding the point budget', () => {
    const a = alloc({ ranks: { war_toughness: 3, war_cruelty: 3 } });
    expect(validateAllocation('warrior', a, 5)).toMatchObject({ ok: false });
  });

  it('enforces connection prerequisites', () => {
    // war_imp_heroic_strike requires war_toughness
    const noPrereq = alloc({ ranks: { war_imp_heroic_strike: 1, war_cruelty: 1 } });
    expect(validateAllocation('warrior', noPrereq, 11).ok).toBe(false);
    const withPrereq = alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 1 } });
    expect(validateAllocation('warrior', withPrereq, 11).ok).toBe(true);
  });

  it('enforces the cumulative points gate', () => {
    // war_tactical_choice needs 5 points spent above its row; with only 2 it fails
    const tooShallow = alloc({
      ranks: { war_toughness: 2, war_tactical_choice: 1 },
      choices: { war_tactical_choice: 'tc_cruelty' },
    });
    expect(validateAllocation('warrior', tooShallow, 11).ok).toBe(false);
    const deep = alloc({
      ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 },
      choices: { war_tactical_choice: 'tc_cruelty' },
    });
    expect(validateAllocation('warrior', deep, 11).ok).toBe(true);
  });

  it('requires a valid choice for choice nodes', () => {
    const noChoice = alloc({ ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 } });
    expect(validateAllocation('warrior', noChoice, 11).ok).toBe(false);
    const badChoice = alloc({
      ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 },
      choices: { war_tactical_choice: 'nope' },
    });
    expect(validateAllocation('warrior', badChoice, 11).ok).toBe(false);
  });

  it('rejects spec-tree points without the matching spec', () => {
    const a = alloc({ spec: null, ranks: { arms_imp_overpower: 1 } });
    expect(validateAllocation('warrior', a, 11).ok).toBe(false);
    const b = alloc({ spec: 'fury', ranks: { arms_imp_overpower: 1 } });
    expect(validateAllocation('warrior', b, 11).ok).toBe(false);
    const c = alloc({ spec: 'arms', ranks: { arms_imp_overpower: 1 } });
    expect(validateAllocation('warrior', c, 11).ok).toBe(true);
  });
});

describe('dormant-not-destroyed dependents', () => {
  it('marks a dependent dormant when its prereq is refunded, keeping its ranks', () => {
    const built = alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 2 } });
    expect(dormantNodes('warrior', built).size).toBe(0);
    // refund the upstream node (war_toughness) but keep the dependent's ranks
    const refunded = alloc({ ranks: { war_imp_heroic_strike: 2 } });
    const dormant = dormantNodes('warrior', refunded);
    expect(dormant.has('war_imp_heroic_strike')).toBe(true);
    expect(refunded.ranks.war_imp_heroic_strike).toBe(2); // not destroyed
    // re-adding the prereq clears dormancy
    const restored = alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 2 } });
    expect(dormantNodes('warrior', restored).has('war_imp_heroic_strike')).toBe(false);
  });

  it('precompute ignores dormant spec nodes (wrong spec)', () => {
    const mods = computeTalentModifiers(
      'warrior',
      alloc({ spec: 'fury', ranks: { arms_imp_overpower: 2 } }),
    );
    expect(mods.abilities.overpower).toBeUndefined();
  });
});

describe('precomputed modifiers', () => {
  it('folds passive stat ranks into a flat struct', () => {
    const mods = computeTalentModifiers(
      'warrior',
      alloc({ ranks: { war_toughness: 3, war_cruelty: 2 } }),
    );
    expect(mods.stats.armorPct).toBeCloseTo(0.12); // 0.04 * 3
    expect(mods.stats.crit).toBeCloseTo(0.02); // 0.01 * 2
  });

  it('applies the chosen option of a choice node only', () => {
    const base = alloc({
      ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 },
      choices: { war_tactical_choice: 'tc_bladed_armor' },
    });
    const mods = computeTalentModifiers('warrior', base);
    expect(mods.stats.apPct).toBeCloseTo(0.12);
    expect(mods.stats.dodge).toBe(0); // the dodge option was not chosen
  });

  it('grants the spec signature ability + mastery when a spec is chosen', () => {
    const mods = computeTalentModifiers('warrior', alloc({ spec: 'arms' }));
    expect(mods.spec).toBe('arms');
    expect(mods.role).toBe('dps');
    expect(mods.grants.some((g) => g.ability === 'mortal_strike')).toBe(true);
    // Master Armorer applies its +10% at HIT time (2H-gated, combat/damage.ts), not
    // as a baked ability mod, so the precomputed melee mult stays 0.
    expect(mods.global.meleeDmgPct).toBe(0);
  });

  it('makes every chosen spec signature available at the first talent level', () => {
    for (const cls of ALL_CLASSES) {
      const ct = requireTree(cls);
      for (const s of ct.specs) {
        const known = abilitiesKnownAt(
          cls,
          FIRST_TALENT_LEVEL,
          computeTalentModifiers(cls, alloc({ spec: s.id })),
        );
        expect(
          known.some((k) => k.def.id === s.signature),
          `${cls}:${s.id}:${s.signature}`,
        ).toBe(true);
      }
    }
  });

  it('grants every chosen spec signature through the sim known set', () => {
    for (const cls of ALL_CLASSES) {
      const ct = requireTree(cls);
      for (const s of ct.specs) {
        const sim = new Sim({ seed: 9, playerClass: cls });
        sim.setPlayerLevel(FIRST_TALENT_LEVEL);
        expect(sim.setSpec(s.id), `${cls}:${s.id}`).toBe(true);
        expect(
          sim.known.some((k) => k.def.id === s.signature),
          `${cls}:${s.id}:${s.signature}`,
        ).toBe(true);
      }
    }
  });

  it('accumulates per-ability modifiers across ranks', () => {
    const mods = computeTalentModifiers(
      'warrior',
      alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }),
    );
    expect(mods.abilities.overpower.dmgPct).toBeCloseTo(0.5); // 0.25 * 2
  });

  it('applies ability modifiers to shields, buffs, and imbues, not only damage spells', () => {
    const shield = requireKnown(
      abilitiesKnownAt(
        'priest',
        10,
        computeTalentModifiers(
          'priest',
          alloc({ spec: 'discipline', ranks: { disc_twin_disciplines: 1 } }),
        ),
      ),
      'power_word_shield',
    );
    expect(effectOfType(shield, 'absorb').amount).toBe(56); // 48 * (1 + 8% mastery + 8% talent)

    const fort = requireKnown(
      abilitiesKnownAt(
        'priest',
        20,
        computeTalentModifiers('priest', alloc({ ranks: { pri_imp_fortitude: 2 } })),
      ),
      'power_word_fortitude',
    );
    // buff_sta_pct base 5% raised +40% by pri_imp_fortitude r2 (percent-points survive the round)
    expect(effectOfType(fort, 'buffTarget').value).toBe(7); // 5% stamina * 1.40

    const demonSkin = requireKnown(
      abilitiesKnownAt(
        'warlock',
        20,
        computeTalentModifiers('warlock', alloc({ ranks: { wlk_demonic_skin: 2 } })),
      ),
      'demon_skin',
    );
    expect(effectOfType(demonSkin, 'selfBuff').value).toBe(112); // 80 armor * 1.40

    const seal = requireKnown(
      abilitiesKnownAt(
        'paladin',
        20,
        computeTalentModifiers(
          'paladin',
          alloc({ spec: 'retribution', ranks: { ret_seal_command: 2 } }),
        ),
      ),
      'seal_of_righteousness',
    );
    expect(effectOfType(seal, 'imbue')).toMatchObject({ bonus: 16, judgeMin: 44, judgeMax: 64 }); // mastery + 2 talent ranks
  });
});

describe('build strings (import/export)', () => {
  it('round-trips an allocation exactly', () => {
    const a = alloc({
      spec: 'prot',
      ranks: { prot_toughness: 3, prot_choice: 1 },
      choices: { prot_choice: 'pc_last_stand' },
    });
    const str = exportBuild('warrior', a);
    const imported = importBuild(str);
    expect(imported.ok).toBe(true);
    if (imported.ok) {
      expect(imported.cls).toBe('warrior');
      expect(imported.alloc).toEqual(a);
    }
  });

  it('rejects a malformed string', () => {
    expect(importBuild('not-base64-$$$').ok).toBe(false);
    expect(importBuild('').ok).toBe(false);
  });

  it('rejects a version-mismatched string', () => {
    const a = alloc({ spec: 'arms', ranks: { arms_imp_overpower: 1 } });
    const good = exportBuild('warrior', a);
    // hand-craft a payload with a future version
    const future = Buffer.from(
      JSON.stringify({ v: TALENT_BUILD_VERSION + 1, c: 'warrior', s: 'arms', r: {}, h: {} }),
    ).toString('base64');
    expect(importBuild(future)).toMatchObject({ ok: false });
    expect(importBuild(good).ok).toBe(true); // sanity: the current version still imports
  });
});

describe('Sim integration — passive talents', () => {
  it('applies a passive stat talent through recalcPlayerStats and reverts on respec', () => {
    const sim = warriorAtCap();
    const critBefore = sim.player.critChance;
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 3 } }))).toBe(true);
    expect(sim.player.critChance).toBeCloseTo(critBefore + 0.03); // +1% per rank
    expect(sim.respec()).toBe(true);
    expect(sim.player.critChance).toBeCloseTo(critBefore); // clean revert
    expect(sim.talentPoints().spent).toBe(0);
  });

  it('applies an armor-percent talent multiplicatively', () => {
    const sim = warriorAtCap();
    const armorBefore = sim.player.stats.armor;
    expect(sim.applyTalents(alloc({ ranks: { war_toughness: 3 } }))).toBe(true); // +12% armor
    expect(sim.player.stats.armor).toBeCloseTo(Math.round(armorBefore * 1.12), 0);
  });

  it('rejects an over-budget allocation server-side', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(10); // exactly 1 point
    expect(sim.talentPoints().total).toBe(1);
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 3 } }))).toBe(false);
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 1 } }))).toBe(true);
  });

  it('locks respec/allocation in combat', () => {
    const sim = warriorAtCap();
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 2 } }))).toBe(true);
    sim.player.inCombat = true;
    expect(sim.applyTalents(alloc({ ranks: { war_cruelty: 3 } }))).toBe(false);
    expect(sim.respec()).toBe(false);
    expect(sim.talentPoints().spent).toBe(2); // unchanged
  });

  it('persists talents across serialize -> addPlayer (JSONB round-trip, no migration)', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { war_cruelty: 2, arms_imp_overpower: 2 } }));
    const state = requireValue(sim.serializeCharacter(sim.playerId), 'Missing serialized state');
    expect(state.talents).toBeTruthy();

    const sim2 = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Reloaded', { state });
    const meta = requireMeta(sim2, pid);
    expect(meta.talents.spec).toBe('arms');
    expect(meta.talents.ranks.war_cruelty).toBe(2);
    expect(meta.talents.ranks.arms_imp_overpower).toBe(2);
    // and the precomputed struct is rebuilt on load
    expect(meta.talentMods.abilities.overpower.dmgPct).toBeCloseTo(0.5);
  });

  it('switching spec prunes the old spec tree but keeps the class tree', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { war_cruelty: 2, arms_imp_overpower: 2 } }));
    expect(sim.setSpec('fury')).toBe(true);
    const meta = requireMeta(sim, sim.playerId);
    expect(meta.talents.spec).toBe('fury');
    expect(meta.talents.ranks.arms_imp_overpower).toBeUndefined(); // pruned
    expect(meta.talents.ranks.war_cruelty).toBe(2); // class tree kept
  });
});

describe('Sim integration — active talents & ability modifiers', () => {
  it('grants spec signature + active-node abilities into the known set', () => {
    const sim = warriorAtCap();
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false);
    expect(sim.applyTalents(alloc({ spec: 'arms' }))).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true); // Arms signature

    // Fury whirlwind is an active node (gate: 2 points above row 1 -> fury_cruelty 2)
    expect(
      sim.applyTalents(alloc({ spec: 'fury', ranks: { fury_cruelty: 2, fury_whirlwind: 1 } })),
    ).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'whirlwind')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'bloodthirst')).toBe(true); // Fury signature
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false); // Arms signature gone
  });

  it('gates specialization to the spec-unlock level (5): blocked at 4, allowed at 5', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    sim.setPlayerLevel(4);
    expect(sim.setSpec('arms')).toBe(false); // below SPEC_UNLOCK_LEVEL
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(false);
    // Spec unlocks at level 5, even though talent POINTS still start at 10.
    sim.setPlayerLevel(5);
    expect(sim.setSpec('arms')).toBe(true);
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true); // signature granted
  });

  it('snapshot-locks Overpower damage before/after Improved Overpower (+ Arms mastery)', () => {
    const baseBonus = effectOfType(
      abilitiesKnownAt('warrior', 20, grantMods('overpower')).find((k) => k.def.id === 'overpower'),
      'weaponStrike',
    ).bonus;
    const mods = computeTalentModifiers(
      'warrior',
      alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }),
    );
    const buffed = effectOfType(
      abilitiesKnownAt('warrior', 20, mods).find((k) => k.def.id === 'overpower'),
      'weaponStrike',
    ).bonus;
    // Improved Overpower r2 (+50%) => x1.50. Master Armorer's +10% is now hit-time
    // (2H-gated), so it no longer bakes into the precomputed ability bonus.
    expect(buffed).toBe(Math.round(baseBonus * 1.5));
    expect(buffed).toBeGreaterThan(baseBonus);
    // shared content data must NOT be mutated by the modifier pass
    const baseAgain = effectOfType(
      abilitiesKnownAt('warrior', 20, grantMods('overpower')).find((k) => k.def.id === 'overpower'),
      'weaponStrike',
    ).bonus;
    expect(baseAgain).toBe(baseBonus);
  });

  it('snapshot-locks Heroic Strike cost before/after Improved Heroic Strike', () => {
    const baseCost = requireKnown(abilitiesKnownAt('warrior', 20), 'heroic_strike').cost;
    const mods = computeTalentModifiers(
      'warrior',
      alloc({ ranks: { war_toughness: 1, war_imp_heroic_strike: 2 } }),
    );
    const cost = requireKnown(abilitiesKnownAt('warrior', 20, mods), 'heroic_strike').cost;
    expect(cost).toBe(Math.round(baseCost * 0.8)); // -20%
  });

  it('applies cooldown and cast-time modifiers', () => {
    const taunt = requireKnown(
      abilitiesKnownAt(
        'warrior',
        20,
        computeTalentModifiers(
          'warrior',
          alloc({
            spec: 'prot',
            ranks: { prot_choice: 1 },
            choices: { prot_choice: 'pc_imp_taunt' },
          }),
        ),
      ),
      'taunt',
    );
    expect(taunt.cooldown).toBeCloseTo(10 * 0.8); // Improved Taunt -20% -> 8s
    // (The castPct fold itself is covered by the caster-class talents, e.g.
    // mage fireball; the warrior no longer has a cast-time talent since slam
    // went instant and Improved Brute Swing was removed.)
  });

  it('a choice node applies only the chosen option ability mod', () => {
    const baseMin = effectOfType(
      abilitiesKnownAt('warrior', 20, grantMods('cleave')).find((k) => k.def.id === 'cleave'),
      'aoeDamage',
    ).min;
    const sweeping = effectOfType(
      abilitiesKnownAt(
        'warrior',
        20,
        computeTalentModifiers(
          'warrior',
          alloc({
            spec: 'arms',
            ranks: { arms_choice: 1 },
            choices: { arms_choice: 'ac_sweeping' },
          }),
        ),
      ).find((k) => k.def.id === 'cleave'),
      'aoeDamage',
    ).min;
    const impale = effectOfType(
      abilitiesKnownAt(
        'warrior',
        20,
        computeTalentModifiers(
          'warrior',
          alloc({ spec: 'arms', ranks: { arms_choice: 1 }, choices: { arms_choice: 'ac_impale' } }),
        ),
      ).find((k) => k.def.id === 'cleave'),
      'aoeDamage',
    ).min;
    // Master Armorer's +10% is now hit-time (2H-gated), so only the chosen row
    // option's ability mod bakes into the precomputed damage here.
    expect(sweeping).toBe(Math.round(baseMin * 1.3)); // sweeping .30
    expect(impale).toBe(baseMin); // impale is a crit option, no damage mod
  });

  it('tank-role Vengeance Mastery multiplies generated threat (+30%)', () => {
    // Hobbling Cut (hamstring) is an ungated damage strike EVERY warrior knows, so
    // its damage-driven threat isolates the +30% Recompense threat mastery.
    // (Brute Swing is now arms/prot-gated so a no-spec warrior cannot cast it, and
    // sunder's flat threat is prot-only, so neither can be the base case.)
    const hamstringThreat = (vengeance: boolean): number => {
      const sim = new Sim({ seed: 3, playerClass: 'warrior' });
      sim.setPlayerLevel(20);
      if (vengeance) expect(sim.setSpec('prot')).toBe(true); // grants Vengeance (+30% threat)
      const mob = nearestMob(sim);
      sim.player.pos.x = mob.pos.x;
      sim.player.pos.z = mob.pos.z - 3;
      sim.player.pos.y = terrainHeight(sim.player.pos.x, sim.player.pos.z, sim.cfg.seed);
      sim.player.facing = Math.atan2(mob.pos.x - sim.player.pos.x, mob.pos.z - sim.player.pos.z);
      sim.player.resource = 100;
      sim.targetEntity(mob.id);
      sim.castAbility('hamstring');
      return mob.threat.get(sim.playerId) ?? 0;
    };
    const base = hamstringThreat(false);
    const venge = hamstringThreat(true);
    expect(base).toBeGreaterThan(0);
    // ~+30% (a tiny constant "seed" threat on combat entry isn't multiplied, so
    // assert the band rather than the exact ratio): clearly boosted, not doubled.
    expect(venge / base).toBeGreaterThan(1.25);
    expect(venge / base).toBeLessThan(1.31);
  });
});

describe('Sim integration — loadouts & build strings', () => {
  it('saves and switches loadouts, restoring talents + spec + bar', () => {
    const sim = warriorAtCap();
    expect(
      sim.saveLoadout(
        'Arms PvE',
        ['mortal_strike', 'overpower', null],
        alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }),
      ),
    ).toBe(0);
    expect(
      sim.saveLoadout(
        'Prot Tank',
        ['shield_slam', 'taunt'],
        alloc({ spec: 'prot', ranks: { prot_toughness: 3 } }),
      ),
    ).toBe(1);
    expect(sim.loadouts.length).toBe(2);
    expect(sim.talents.spec).toBe('prot');
    expect(sim.activeLoadout).toBe(1);

    expect(sim.switchLoadout(0)).toBe(true);
    expect(sim.talents.spec).toBe('arms');
    expect(sim.talents.ranks.arms_imp_overpower).toBe(2);
    expect(sim.talentSpec).toBe('arms');
    expect(sim.activeLoadout).toBe(0);
    expect(sim.loadouts[0].bar).toEqual(['mortal_strike', 'overpower', null]); // action bar travels with the build
    expect(sim.known.some((k) => k.def.id === 'mortal_strike')).toBe(true); // restored spec granted its signature
  });

  it('locks loadout switching in combat', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms' }));
    sim.saveLoadout('A', []);
    sim.player.inCombat = true;
    expect(sim.switchLoadout(0)).toBe(false);
  });

  it('deletes a loadout and repairs the active index', () => {
    const sim = warriorAtCap();
    sim.saveLoadout('one', [], alloc({ spec: 'arms', ranks: { arms_imp_overpower: 1 } }));
    sim.saveLoadout('two', [], alloc({ spec: 'prot', ranks: { prot_toughness: 1 } }));
    expect(sim.activeLoadout).toBe(1);
    expect(sim.deleteLoadout(0)).toBe(true);
    expect(sim.loadouts.length).toBe(1);
    expect(sim.loadouts[0].name).toBe('two');
    expect(sim.activeLoadout).toBe(0);
    expect(sim.talents.spec).toBe('prot');
  });

  it('caps loadouts at MAX_LOADOUTS', () => {
    const sim = warriorAtCap();
    for (let i = 0; i < MAX_LOADOUTS; i++) expect(sim.saveLoadout('L' + i, [])).toBe(i);
    expect(sim.saveLoadout('overflow', [])).toBe(-1);
  });

  it('imports a build string and re-validates it server-side on apply', () => {
    const author = warriorAtCap();
    author.applyTalents(
      alloc({ spec: 'prot', ranks: { prot_toughness: 3, prot_anticipation: 2 } }),
    );
    const str = exportBuild('warrior', author.talents);

    const target = warriorAtCap(11);
    const imported = importBuild(str);
    expect(imported.ok).toBe(true);
    if (imported.ok) expect(target.applyTalents(imported.alloc)).toBe(true);
    expect(target.talents.spec).toBe('prot');
    expect(target.talents.ranks.prot_toughness).toBe(3);

    // the SAME build is rejected for a character without the points (server-side)
    const lowbie = new Sim({ seed: 5, playerClass: 'warrior' });
    lowbie.setPlayerLevel(10); // only 1 point
    expect(lowbie.applyTalents(imported.ok ? imported.alloc : alloc())).toBe(false);
  });
});

describe('ClientWorld path (online display reflects server state)', () => {
  type BareClient = ClientWorld & {
    known: KnownAbility[];
  };

  type BareClientInternals = {
    applySnapshot(snapshot: unknown): void;
    eventQueue: unknown[];
    mouselookFacing: number | null;
  };

  function bareClient(pid: number): BareClient {
    const c = Object.create(ClientWorld.prototype) as BareClient;
    const internals = c as unknown as BareClientInternals;
    c.cfg = { seed: 20061, playerClass: 'warrior' };
    c.entities = new Map();
    c.playerId = pid;
    c.moveInput = emptyMoveInput();
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
    internals.eventQueue = [];
    internals.mouselookFacing = null;
    return c;
  }
  const selfWire = (over: Record<string, unknown> = {}) => ({
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

  it('decodes the talent snapshot field and recomputes known with granted abilities', () => {
    const c = bareClient(1);
    const internals = c as unknown as BareClientInternals;
    internals.applySnapshot({
      t: 'snap',
      tick: 1,
      time: 0,
      ents: [],
      self: selfWire({
        tal: {
          alloc: { spec: 'prot', ranks: { prot_toughness: 2 }, choices: {} },
          spec: 'prot',
          role: 'tank',
          loadouts: [{ name: 'MT', alloc: emptyAllocation(), bar: [] }],
          activeLoadout: 0,
        },
      }),
    });
    expect(c.talents.spec).toBe('prot');
    expect(c.talentSpec).toBe('prot');
    expect(c.talentRole).toBe('tank');
    expect(c.loadouts.length).toBe(1);
    expect(c.activeLoadout).toBe(0);
    // the client resolves known with the precomputed mods -> shield_slam granted
    expect(c.known.some((k) => k.def.id === 'shield_slam')).toBe(true);
    expect(c.talentPoints()).toMatchObject({ total: 11, spent: 2 });
  });
});

describe('repairAllocation (load-time revalidation)', () => {
  it('is the identity on an already-valid in-budget allocation', () => {
    const a = alloc({ spec: 'arms', ranks: { war_cruelty: 2, arms_imp_overpower: 2 } });
    const repaired = repairAllocation('warrior', a, talentPointsAtLevel(MAX_LEVEL));
    expect(repaired).toEqual(a);
  });

  it('is deterministic (same input -> same output)', () => {
    const a = alloc({
      spec: 'arms',
      ranks: { war_toughness: 3, war_cruelty: 3, war_deflection: 3, arms_imp_overpower: 2 },
    });
    const run = () => repairAllocation('warrior', a, 11);
    expect(run()).toEqual(run());
  });

  it('trims an over-budget allocation down to the level budget', () => {
    // Structurally legal nodes, but 14 points spent against an 11-point cap.
    const a = alloc({
      spec: 'arms',
      ranks: {
        war_toughness: 3,
        war_cruelty: 3,
        war_deflection: 3,
        arms_imp_overpower: 2,
        war_imp_heroic_strike: 2,
        war_imp_thunder_clap: 1,
      },
    });
    expect(pointsSpent(a)).toBeGreaterThan(11);
    const repaired = repairAllocation('warrior', a, 11);
    expect(pointsSpent(repaired)).toBeLessThanOrEqual(11);
    expect(validateAllocation('warrior', repaired, 11).ok).toBe(true);
  });

  it('drops a node whose prerequisite is no longer satisfied', () => {
    // war_deflection requires war_cruelty; persist it without the prereq.
    const a = alloc({ ranks: { war_deflection: 2 } });
    const repaired = repairAllocation('warrior', a, 11);
    expect(repaired.ranks.war_deflection).toBeUndefined();
  });

  it('drops a node whose points-gate is no longer met', () => {
    // war_imp_thunder_clap has pointsGate 2 (2 points required above its row);
    // persist it alone so nothing sits above it.
    const a = alloc({ ranks: { war_imp_thunder_clap: 2 } });
    const repaired = repairAllocation('warrior', a, 11);
    expect(repaired.ranks.war_imp_thunder_clap).toBeUndefined();
    expect(validateAllocation('warrior', repaired, 11).ok).toBe(true);
  });

  it('clamps a rank above its node maximum', () => {
    const a = alloc({ ranks: { war_toughness: 99 } }); // maxRank 3
    const repaired = repairAllocation('warrior', a, 11);
    expect(repaired.ranks.war_toughness).toBe(3);
  });

  it('drops a spec node when the spec no longer matches', () => {
    const a = alloc({ spec: 'fury', ranks: { arms_imp_overpower: 2 } });
    const repaired = repairAllocation('warrior', a, 11);
    expect(repaired.ranks.arms_imp_overpower).toBeUndefined();
  });

  it('keeps a spec with zero points when spec-unlocked, strips it when not (decoupled from points)', () => {
    const a = alloc({ spec: 'arms', ranks: {} });
    // A level-4 load (specUnlocked=false): the spec is illegal and dropped.
    expect(repairAllocation('warrior', a, 0, false).spec).toBeNull();
    // Spec-unlocked (level >= 5) keeps the spec even with zero talent points.
    expect(repairAllocation('warrior', a, 0, true).spec).toBe('arms');
  });

  it('rolls back a choice node whose points-gate is no longer met', () => {
    // war_tactical_choice has pointsGate 5; persist it with a VALID option id but
    // only 2 points above its row, so the validate-then-rollback branch fires and
    // strips both the rank and the choice while leaving the legal nodes intact.
    const a = alloc({
      ranks: { war_toughness: 2, war_tactical_choice: 1 },
      choices: { war_tactical_choice: 'tc_cruelty' },
    });
    const repaired = repairAllocation('warrior', a, 11);
    expect(repaired.ranks.war_toughness).toBe(2);
    expect(repaired.ranks.war_tactical_choice).toBeUndefined();
    expect(repaired.choices.war_tactical_choice).toBeUndefined();
    expect(validateAllocation('warrior', repaired, 11).ok).toBe(true);
  });

  it('drops ranks in a removed node (arms_imp_slam) without throwing, refunding the points', () => {
    // A persisted build from before the obsolete Improved Brute Swing talent
    // was removed still carries ranks under its id. Repair must drop the
    // unknown node, keep the still-valid picks, and refund the spent points.
    const a = alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2, arms_imp_slam: 2 } });
    let repaired!: TalentAllocation;
    expect(() => {
      repaired = repairAllocation('warrior', a, 11);
    }).not.toThrow();
    expect(repaired.ranks.arms_imp_slam).toBeUndefined();
    expect(repaired.ranks.arms_imp_overpower).toBe(2);
    expect(pointsSpent(repaired)).toBe(2);
    expect(validateAllocation('warrior', repaired, 11).ok).toBe(true);
  });

  it('drops a choice node whose selected option id is unknown', () => {
    // Enough points above the gate that the node would otherwise be legal; the only
    // reason it is dropped is the bogus option id (the unknown-choice guard). A known
    // option at the same spend survives, isolating the guard as the cause.
    const bogus = alloc({
      ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 },
      choices: { war_tactical_choice: 'tc_does_not_exist' },
    });
    const repaired = repairAllocation('warrior', bogus, 11);
    expect(repaired.ranks.war_tactical_choice).toBeUndefined();
    expect(repaired.choices.war_tactical_choice).toBeUndefined();

    const ok = repairAllocation(
      'warrior',
      alloc({
        ranks: { war_toughness: 3, war_cruelty: 2, war_tactical_choice: 1 },
        choices: { war_tactical_choice: 'tc_cruelty' },
      }),
      11,
    );
    expect(ok.choices.war_tactical_choice).toBe('tc_cruelty');
  });
});

describe('persisted talents are revalidated on load (FR security)', () => {
  it('trims an over-budget persisted build and does not grant its stats on load', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { war_cruelty: 3, arms_imp_overpower: 2 } }));
    const state = requireValue(sim.serializeCharacter(sim.playerId), 'Missing serialized state');
    // Tamper: a level-5 character (0 talent points) carrying a max-level build.
    state.level = 5;

    const sim2 = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Tampered', { state });
    const meta = requireMeta(sim2, pid);
    // 0 points available at level 5 -> the over-budget RANKS are trimmed to nothing,
    // but the spec itself is legal from level 5 (decoupled from talent points) so it
    // is kept with its mastery. The tampered per-rank bonuses do NOT survive.
    expect(pointsSpent(meta.talents)).toBe(0);
    expect(meta.talentMods.abilities.overpower?.dmgPct ?? 0).toBe(0);
    expect(meta.talentMods.spec).toBe('arms');
  });

  it('deleting the active loadout never auto-applies an illegal next loadout', () => {
    const sim = warriorAtCap();
    const cap = talentPointsAtLevel(MAX_LEVEL);
    // Loadout 0: a valid, active build.
    sim.saveLoadout('A', [], alloc({ spec: 'arms', ranks: { war_cruelty: 2 } }));
    // Loadout 1: an illegal (over-budget) build injected directly, as a tampered
    // save would arrive. saveLoadout would have rejected it, so inject it raw.
    const meta = requireMeta(sim, sim.playerId);
    meta.loadouts.push({
      name: 'Bad',
      alloc: alloc({
        spec: 'arms',
        ranks: {
          war_toughness: 3,
          war_cruelty: 3,
          war_deflection: 3,
          war_imp_heroic_strike: 2,
          war_imp_thunder_clap: 2,
          arms_imp_overpower: 2,
        },
      }),
      bar: [],
    });
    meta.activeLoadout = 0;
    // Deleting the active loadout collapses index 1 ("Bad") into slot 0 and
    // auto-applies it. It must be repaired, not granted wholesale.
    sim.deleteLoadout(0);
    expect(pointsSpent(meta.talents)).toBeLessThanOrEqual(cap);
    expect(validateAllocation('warrior', meta.talents, cap).ok).toBe(true);
  });

  it('still loads a legitimately valid build unchanged', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { war_cruelty: 2, arms_imp_overpower: 2 } }));
    const state = requireValue(sim.serializeCharacter(sim.playerId), 'Missing serialized state');
    const sim2 = new Sim({ seed: 9, playerClass: 'warrior', noPlayer: true });
    const pid = sim2.addPlayer('warrior', 'Honest', { state });
    const meta = requireMeta(sim2, pid);
    expect(meta.talents.ranks.war_cruelty).toBe(2);
    expect(meta.talents.ranks.arms_imp_overpower).toBe(2);
    expect(meta.talentMods.abilities.overpower.dmgPct).toBeCloseTo(0.5);
  });
});

describe('performance invariant (no per-tick tree walk)', () => {
  it('keeps the resolved known-ability set stable across many ticks', () => {
    const sim = warriorAtCap();
    sim.applyTalents(alloc({ spec: 'arms', ranks: { arms_imp_overpower: 2 } }));
    const knownRef = requireMeta(sim, sim.playerId).known;
    const overpowerRef = requireValue(
      knownRef.find((k) => k.def.id === 'overpower'),
      'Missing Overpower in known set',
    );
    for (let i = 0; i < 600; i++) sim.tick(); // 30s of ticks
    // identical array + object identity => talents resolved once, never per tick
    expect(requireMeta(sim, sim.playerId).known).toBe(knownRef);
    expect(requireMeta(sim, sim.playerId).known.find((k) => k.def.id === 'overpower')).toBe(
      overpowerRef,
    );
  });
});
